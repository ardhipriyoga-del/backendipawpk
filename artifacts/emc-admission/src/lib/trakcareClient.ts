/**
 * Smart TrakCare fetch client.
 *
 * Automatically switches strategy based on runtime context:
 *  - file:// (offline standalone HTML)  → fetch TrakCare directly (CORS bypassed by bat file)
 *  - http:// dengan API proxy tersedia  → backend proxy di /api/trakcare/...
 *    URL proxy ditentukan oleh VITE_API_BASE_URL (absolut) atau relative jika local dev.
 *
 * Import dari sini, bukan panggil fetch('/api/trakcare/...') langsung.
 */

import { getDB } from './db';
import {
  parseInpatientHTML,
  parseIGDHTML,
  parseIGDWardHTML,
  RawInpatientPatient,
  RawIGDPatient,
} from './trakcareParser';
import { apiRequest, apiUrl, hasApiProxy, hasTrakCareProxy, isGasHosted } from './apiConfig';
import { normalizeTrakCareBirthDate } from './trakcareDate';

// ── Default endpoint URLs ─────────────────────────────────────────────────────

export const DEFAULT_EP = {
  inpatient:        'https://apps.emc.id/trakcare/dashboard/dailyinpatient/trakcareANLT/hospital/4',
  igd:              'https://apps.emc.id/trakcare/dashboard/dailyemergencywaitingtime/trakcareANLT/hospital/4',
  medicalDischarge: 'https://apps.emc.id/trakcare/dashboard/dailyinpatient/trakcareANLT/hospital/4?medical=Y',
  nurseDischarge:   'https://apps.emc.id/trakcare/dashboard/dailyinpatient/trakcareANLT/hospital/4?nurse=Y',
  pharmacyDischarge:'https://apps.emc.id/trakcare/dashboard/dailyinpatient/trakcareANLT/hospital/4?pharmacy=Y',
};

// ── Offline detection ─────────────────────────────────────────────────────────

/** Returns true when the app is running as a local file:// standalone HTML. */
export function isOfflineMode(): boolean {
  return window.location.protocol === 'file:';
}

// ── Read configured endpoints from IndexedDB ──────────────────────────────────

export async function getEndpoints() {
  const db = await getDB();
  const get = async (key: string, def: string): Promise<string> =>
    (await db.get('settings', key))?.value || def;
  return {
    inpatient:        await get('endpointInpatient',        DEFAULT_EP.inpatient),
    igd:              await get('endpointIGD',              DEFAULT_EP.igd),
    medicalDischarge: await get('endpointMedicalDischarge', DEFAULT_EP.medicalDischarge),
    nurseDischarge:   await get('endpointNurseDischarge',   DEFAULT_EP.nurseDischarge),
    pharmacyDischarge:await get('endpointPharmacyDischarge',DEFAULT_EP.pharmacyDischarge),
  };
}

// ── Logging helpers ───────────────────────────────────────────────────────────

function logRequest(tag: string, url: string): void {
  console.log(`[TrakCare][${tag}] → ${url}`);
}

function logResponse(tag: string, status: number, ok: boolean): void {
  const icon = ok ? '✓' : '✗';
  console.log(`[TrakCare][${tag}] ${icon} HTTP ${status}`);
}

export interface GasTrakCareResponse {
  success: boolean;
  status: number;
  contentType?: string;
  body: string;
  fetchedAt?: string;
}

/**
 * Read a TrakCare page through the GAS Web App when ipawv3 is hosted there.
 * The GAS endpoint fetches the internal/public TrakCare page server-side and
 * returns the original HTML so the existing parsers remain unchanged.
 */
export async function fetchTrakCareViaGas(
  endpoint: string,
  targetUrl: string,
): Promise<GasTrakCareResponse> {
  const result = await apiRequest<GasTrakCareResponse>(
    `?action=trakcare&kind=${encodeURIComponent(endpoint)}&url=${encodeURIComponent(targetUrl)}&apiKey=IPAW-EMC`,
    {
      method: 'GET',
      cache: 'no-store',
      debugLabel: `trakcare/${endpoint}`,
    },
  );
  const payload = result.data;
  if (!payload?.success || typeof payload.body !== 'string') {
    throw new Error(payload?.body || `TrakCare ${endpoint} tidak mengembalikan data.`);
  }
  return payload;
}

// ── Direct fetch helper (offline mode only) ───────────────────────────────────

/**
 * Fetch URL TrakCare langsung dari browser dengan timeout.
 *
 * Menggunakan credentials: 'omit' agar kompatibel dengan CORS server internal
 * yang merespons Access-Control-Allow-Origin: * (tidak boleh dipakai bersamaan
 * dengan credentials: include). Dashboard TrakCare internal umumnya tidak
 * memerlukan cookies sesi — aksesnya berbasis jaringan (hanya dari IP RS).
 *
 * Bekerja ketika:
 *   - Perangkat terhubung ke jaringan internal RS EMC
 *   - Server TrakCare memiliki header CORS (Access-Control-Allow-Origin: *)
 *   - Mode offline file:// dengan launcher .bat yang disable CORS
 */
async function fetchDirectWithTimeout(url: string, timeoutMs = 20_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  logRequest('direct', url);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',   // omit agar CORS wildcard (*) tetap bekerja
      cache: 'no-store',     // selalu ambil data terbaru
    });
    clearTimeout(timer);
    logResponse('direct', res.status, res.ok);

    if (!res.ok) {
      throw new Error(`Server TrakCare merespons HTTP ${res.status}. Periksa URL endpoint di Pengaturan.`);
    }
    return await res.text();
  } catch (err: any) {
    clearTimeout(timer);

    if (err.name === 'AbortError') {
      throw new Error('Timeout: TrakCare tidak merespons dalam 20 detik. Periksa koneksi jaringan RS.');
    }

    // Gagal fetch — bisa CORS, jaringan tidak tersedia, atau domain tidak resolve
    if (
      err.message?.toLowerCase().includes('failed to fetch') ||
      err.message?.toLowerCase().includes('networkerror') ||
      err.message?.toLowerCase().includes('cors') ||
      err.message?.toLowerCase().includes('load failed') ||
      err.message?.toLowerCase().includes('network request failed')
    ) {
      throw new Error(
        'Tidak dapat terhubung ke TrakCare. ' +
        'Pastikan perangkat terhubung ke jaringan internal RS EMC. ' +
        'Jika sudah terhubung dan masih gagal, TrakCare mungkin memblokir akses CORS — ' +
        'hubungi IT RS untuk mengaktifkan header CORS pada server TrakCare, ' +
        'atau konfigurasikan VITE_API_BASE_URL ke server proxy internal.'
      );
    }

    throw err;
  }
}

// ── Proxy fetch helper (online mode via Express API server) ───────────────────

async function fetchViaProxy(endpoint: string, targetUrl: string): Promise<Response> {
  const fullUrl = apiUrl(`/api/trakcare/${endpoint}?url=${encodeURIComponent(targetUrl)}`);
  logRequest(`proxy/${endpoint}`, fullUrl);
  const res = await fetch(fullUrl);
  logResponse(`proxy/${endpoint}`, res.status, res.ok);
  if (res.status === 404) {
    throw new Error(
      `HTTP 404 — endpoint proxy TrakCare tidak ditemukan (${fullUrl}). ` +
      'Pastikan API server berjalan dan VITE_API_BASE_URL sudah dikonfigurasi dengan benar.',
    );
  }
  return res;
}

const EPISODE_DETAIL_BASE =
  'https://apps.emc.id/trakcare/dokumen/print/dokumen/trakcareANLT?episode=';

function parseEpisodeBirthDate(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const row of Array.from(doc.querySelectorAll('tr'))) {
    const cells = Array.from(row.querySelectorAll('td')).map(cell =>
      (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    if (/^tanggal lahir$/i.test(cells[0] ?? '')) {
      return normalizeTrakCareBirthDate(cells[2] ?? cells[1] ?? '');
    }
  }
  return '';
}

async function fetchEpisodeBirthDate(episode: string): Promise<string> {
  const value = episode.trim();
  if (!value) return '';
  const targetUrl = `${EPISODE_DETAIL_BASE}${encodeURIComponent(value)}`;

  if (isGasHosted()) {
    const response = await fetchTrakCareViaGas('episode', targetUrl);
    return parseEpisodeBirthDate(response.body);
  }

  if (isOfflineMode() && hasTrakCareProxy()) {
    try {
      const response = await fetchViaProxy('episode', targetUrl);
      if (response.ok) {
        const body = await response.json();
        return normalizeTrakCareBirthDate(body?.dob ?? '');
      }
    } catch {
      // The standalone launcher can still use its direct TrakCare fallback.
    }
  }

  if (!isOfflineMode() && hasApiProxy()) {
    const response = await fetchViaProxy('episode', targetUrl);
    if (!response.ok) return '';
    const body = await response.json();
    return normalizeTrakCareBirthDate(body?.dob ?? '');
  }

  return parseEpisodeBirthDate(await fetchDirectWithTimeout(targetUrl));
}

export async function enrichTrakCareBirthDates<T extends { episodeNo?: string; episode?: string; dob?: string }>(
  patients: T[],
): Promise<T[]> {
  const episodeNumbers = [...new Set(
    patients
      .filter(patient => !patient.dob)
      .map(patient => (patient.episodeNo ?? patient.episode ?? '').trim())
      .filter(Boolean),
  )];
  if (episodeNumbers.length === 0) return patients;

  const birthDates = new Map<string, string>();
  for (let index = 0; index < episodeNumbers.length; index += 6) {
    const batch = episodeNumbers.slice(index, index + 6);
    const results = await Promise.all(
      batch.map(async episode => {
        try {
          return [episode, await fetchEpisodeBirthDate(episode)] as const;
        } catch {
          return [episode, ''] as const;
        }
      }),
    );
    for (const [episode, dob] of results) {
      if (dob) birthDates.set(episode, dob);
    }
  }

  return patients.map(patient => {
    const episode = (patient.episodeNo ?? patient.episode ?? '').trim();
    const fetchedDob = birthDates.get(episode);
    return fetchedDob
      ? { ...patient, dob: fetchedDob }
      : patient.dob
        ? { ...patient, dob: normalizeTrakCareBirthDate(patient.dob) }
        : patient;
  });
}

// ── Inpatient fetcher ─────────────────────────────────────────────────────────

/**
 * Fetch and parse any TrakCare inpatient-format page.
 * Works for the main patient list AND all discharge filter views (medical=Y etc.).
 *
 * Online  → POST to backend proxy  /api/trakcare/discharge?url=<encoded>
 * Offline → fetch URL directly in browser (CORS bypassed by .bat launcher)
 */
export async function fetchFromInpatientUrl(url: string): Promise<RawInpatientPatient[]> {
  if (isGasHosted()) {
    const response = await fetchTrakCareViaGas('inpatient', url);
    return enrichTrakCareBirthDates(parseInpatientHTML(response.body));
  }

  // The standalone launcher exposes the same JSON proxy contract as the
  // online app. Keep direct fetch as a fallback for older bundles/launchers.
  if (isOfflineMode() && hasTrakCareProxy()) {
    try {
      const res = await fetchViaProxy('discharge', url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
       if (Array.isArray(body?.patients)) return enrichTrakCareBirthDates(body.patients);
       if (typeof body?.html === 'string') return enrichTrakCareBirthDates(parseInpatientHTML(body.html));
      return [];
    } catch (error) {
      console.warn('[TrakCare] Bridge lokal tidak tersedia; mencoba akses langsung.', error);
    }
  }

  if (isOfflineMode()) {
    const html = await fetchDirectWithTimeout(url);
    return enrichTrakCareBirthDates(parseInpatientHTML(html));
  }

  // Proxy tersedia (local dev / Replit / VITE_API_BASE_URL dikonfigurasi) → lewat proxy
  if (hasApiProxy()) {
    const res = await fetchViaProxy('discharge', url);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b?.error ?? `HTTP ${res.status}`);
    }
    return enrichTrakCareBirthDates((await res.json()).patients ?? []);
  }

  // Tidak ada proxy (Netlify / hosting statis tanpa VITE_API_BASE_URL) →
  // coba fetch langsung dari browser. Berhasil jika user di jaringan RS
  // dan TrakCare mengizinkan CORS. Gagal dengan pesan CORS jika tidak.
  console.log('[TrakCare] Tidak ada proxy — mencoba direct fetch dari browser...');
  const html = await fetchDirectWithTimeout(url);
  return enrichTrakCareBirthDates(parseInpatientHTML(html));
}

// ── IGD fetcher ───────────────────────────────────────────────────────────────

/**
 * Fetch and parse TrakCare IGD waiting-time page.
 * Returns only patients who have a SPRI (transfer to inpatient) timer set.
 *
 * Online  → backend proxy  /api/trakcare/igd-patients?url=<encoded>
 * Offline → fetch URL directly in browser
 */
export async function fetchIGDData(url: string): Promise<RawIGDPatient[]> {
  if (isGasHosted()) {
    const response = await fetchTrakCareViaGas('igd', url);
    return enrichTrakCareBirthDates(parseIGDHTML(response.body));
  }

  if (isOfflineMode() && hasTrakCareProxy()) {
    try {
      const res = await fetchViaProxy('igd-patients', url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
       if (Array.isArray(body?.patients)) return enrichTrakCareBirthDates(body.patients);
       if (typeof body?.html === 'string') return enrichTrakCareBirthDates(parseIGDHTML(body.html));
      return [];
    } catch (error) {
      console.warn('[TrakCare] Bridge lokal IGD tidak tersedia; mencoba akses langsung.', error);
    }
  }

  if (isOfflineMode()) {
    const html = await fetchDirectWithTimeout(url);
    return enrichTrakCareBirthDates(parseIGDHTML(html));
  }

  // Proxy tersedia → lewat proxy
  if (hasApiProxy()) {
    try {
      const res = await fetchViaProxy('igd-patients', url);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      return enrichTrakCareBirthDates((await res.json()).patients ?? []);
    } catch (error) {
      console.warn('[TrakCare] Proxy IGD gagal; mencoba akses langsung dari browser.', error);
    }
  }

  // Tidak ada proxy → coba direct fetch dari browser
  console.log('[TrakCare] Tidak ada proxy — mencoba direct fetch IGD dari browser...');
  const html = await fetchDirectWithTimeout(url);
  return enrichTrakCareBirthDates(parseIGDHTML(html));
}

/**
 * Fetch the complete IGD Ward feed.
 *
 * Unlike fetchIGDData(), this intentionally does not filter by transfer timer.
 * It uses the same /igd-ward proxy and parser as the IGD Ward page, so the
 * estimation picker contains every patient currently visible in IGD Ward.
 */
export async function fetchIGDWardData(url: string): Promise<RawIGDPatient[]> {
  const offline = isOfflineMode();

  if (isGasHosted()) {
    const response = await fetchTrakCareViaGas('igd-ward', url);
    return enrichTrakCareBirthDates(parseIGDWardHTML(response.body));
  }

  if (hasApiProxy() || (offline && hasTrakCareProxy())) {
    try {
      const res = await fetchViaProxy('igd-ward', url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
      if (Array.isArray(body?.patients)) return enrichTrakCareBirthDates(body.patients);
      if (typeof body?.html === 'string') {
        return enrichTrakCareBirthDates(parseIGDWardHTML(body.html));
      }
      return [];
    } catch (error) {
      if (!offline) throw error;
      console.warn('[TrakCare] Bridge lokal IGD Ward tidak tersedia; mencoba akses langsung.', error);
    }
  }

  const html = await fetchDirectWithTimeout(url);
  return enrichTrakCareBirthDates(parseIGDWardHTML(html));
}

export type { RawInpatientPatient, RawIGDPatient };
