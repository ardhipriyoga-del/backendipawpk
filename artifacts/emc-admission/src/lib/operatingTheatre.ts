import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  apiUrl,
  getApiBaseUrl,
  getOfflineOperatingTheatreProxyBase,
  hasApiProxy,
  ipawApi,
  isGasHosted,
} from './apiConfig';
import {
  getDB,
  OperatingTheatreCache,
  OperatingTheatreCompletedCache,
  OperatingTheatreCompletedPatient,
  OperatingTheatreInProgressCache,
  OperatingTheatreInProgressPatient,
  OperatingTheatrePreadmissionCache,
  OperatingTheatrePatient,
  Patient,
} from './db';
import { findMatchingPatient, normalizePatientIdentifier, normalizePatientName } from './patientIdentity';
import { backupCloud } from './cloudSync';

export type { OperatingTheatrePatient } from './db';
export type { OperatingTheatreCompletedPatient } from './db';
export type { OperatingTheatreInProgressPatient } from './db';
export type { OperatingTheatrePreadmissionCache } from './db';

export const DEFAULT_OPERATING_THEATRE_ENDPOINT =
  '/trakcare/operatingtheatre/otrequest/dashboard/trakcareANLT/hospital/4';
export const DEFAULT_OPERATING_THEATRE_IN_PROGRESS_ENDPOINT =
  '/trakcare/operatingtheatre/otrequest/status/list/hospital/4?status=inprogress';

export type OperatingTheatreRefreshInterval = 'manual' | '30' | '60' | '120';

export interface OperatingTheatreConfig {
  endpoint: string;
  username: string;
  password: string;
  refreshInterval: OperatingTheatreRefreshInterval;
  soundEnabled: boolean;
  popupEnabled: boolean;
}

export const DEFAULT_OPERATING_THEATRE_CONFIG: OperatingTheatreConfig = {
  endpoint: DEFAULT_OPERATING_THEATRE_ENDPOINT,
  username: '',
  password: '',
  refreshInterval: 'manual',
  soundEnabled: true,
  popupEnabled: true,
};

const CONFIG_KEY = 'operatingTheatreConfig';
const CLIENT_ID_KEY = 'ipaw_operating_theatre_client_id';

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_.:/()[\]-]+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function splitCombinedOtIdentity(value: string, allowWhitespace = false): { noRM: string; episodeNo: string } {
  const raw = value.replace(/\s+/g, ' ').trim();
  const cleanPart = (part: string, label: 'rm' | 'episode') => part
    .replace(
      label === 'rm'
        ? /^(?:(?:no\.?\s*)?(?:rm|mr)|mrn)\s*[:#-]?\s*/i
        : /^(?:no\.?\s*)?(?:episode|ipk)\s*[:#-]?\s*/i,
      '',
    )
    .trim();
  const labeled = raw.match(
    /^(?:(?:(?:no\.?\s*)?(?:rm|mr)|mrn)\s*[:#-]?\s*([A-Za-z0-9]+).*?(?:no\.?\s*)?(?:episode|ipk)\s*[:#-]?\s*([A-Za-z0-9]+)|(?:no\.?\s*)?(?:episode|ipk)\s*[:#-]?\s*([A-Za-z0-9]+).*?(?:(?:no\.?\s*)?(?:rm|mr)|mrn)\s*[:#-]?\s*([A-Za-z0-9]+))$/i,
  );
  if (labeled) {
    return labeled[1]
      ? { noRM: labeled[1], episodeNo: labeled[2] }
      : { noRM: labeled[4], episodeNo: labeled[3] };
  }
  const parts = raw
    .split(allowWhitespace ? /\s*(?:\||\/|\u2022|\s+)\s*/ : /\s*(?:\||\/|\u2022)\s*/)
    .map(part => part.trim())
    .filter(Boolean);
  return parts.length >= 2
    ? { noRM: cleanPart(parts[0], 'rm'), episodeNo: cleanPart(parts[1], 'episode') }
    : { noRM: cleanPart(raw, 'rm'), episodeNo: '' };
}

function isCombinedIdentityKey(key: string): boolean {
  const normalized = normalize(key);
  const recordPart = '(?:nomr|mrn|mr|rm|medicalrecord|rekammedis)';
  const episodePart = '(?:episode|ipk)';
  return new RegExp(
    `(?:${recordPart}).*(?:${episodePart})|(?:${episodePart}).*(?:${recordPart})`,
  ).test(normalized);
}

function normalizePboUrl(raw: string, baseUrl = ''): string {
  const value = raw.replace(/&amp;/gi, '&').trim();
  if (!value || /^(?:javascript:|mailto:|#|data:)/i.test(value)) return '';
  try {
    const url = new URL(value, baseUrl || window.location.href);
    return /^https?:$/i.test(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function firstValue(record: Record<string, unknown>, candidates: string[]): string {
  const entries = Object.entries(record);
  const wanted = candidates.map(normalize);
  const found = entries.find(([key, value]) => wanted.includes(normalize(key)) && text(value));
  return found ? text(found[1]) : '';
}

function findArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  for (const key of ['patients', 'data', 'rows', 'results', 'requests', 'otRequests']) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
    const nested = findArray(candidate);
    if (nested.length) return nested;
  }
  for (const candidate of Object.values(record)) {
    const nested = findArray(candidate);
    if (nested.length) return nested;
  }
  return [];
}

function mapRecord(record: Record<string, unknown>, index: number, baseUrl = ''): OperatingTheatrePatient {
  const consumed = new Set<string>();
  const pick = (candidates: string[]) => {
    const entries = Object.entries(record);
    const wanted = candidates.map(normalize);
    const found = entries.find(([key, value]) => wanted.includes(normalize(key)) && text(value));
    if (found) consumed.add(found[0]);
    return found ? text(found[1]) : '';
  };
  const noRMKey = Object.keys(record).find(key => (
    (
      [
        'No MR', 'No. MR', 'No RM', 'No. RM', 'MR', 'RM', 'MRN', 'MR No', 'MR No.',
        'Medical Record Number', 'Medical Record No', 'MedicalRecordNumber',
        'No Rekam Medis', 'Nomor Rekam Medis', 'Rekam Medis',
        'No MR Episode', 'No RM Episode', 'MRN Episode', 'MR No Episode',
        'No MR / Episode', 'No RM / Episode', 'MRN / Episode', 'MR No / Episode',
        'No MR / No Episode', 'No RM / No Episode', 'MRN / No Episode',
        'No MR / IPK', 'No RM / IPK', 'MRN / IPK', 'RM / Episode', 'MR / Episode',
      ].map(normalize).includes(normalize(key))
      || isCombinedIdentityKey(key)
    )
    && text(record[key])
  ));
  let noRM = noRMKey ? text(record[noRMKey]) : pick([
    'No MR', 'No. MR', 'No RM', 'No. RM', 'MR', 'RM', 'MRN', 'MR No', 'MR No.',
    'Medical Record Number', 'Medical Record No', 'MedicalRecordNumber',
    'No Rekam Medis', 'Nomor Rekam Medis', 'Rekam Medis',
    'No MR Episode', 'No RM Episode', 'MRN Episode', 'MR No Episode',
    'No MR / Episode', 'No RM / Episode', 'MRN / Episode', 'MR No / Episode',
    'No MR / No Episode', 'No RM / No Episode', 'MRN / No Episode',
    'No MR / IPK', 'No RM / IPK', 'MRN / IPK', 'RM / Episode', 'MR / Episode',
  ]);
  let episodeNo = pick([
    'Episode', 'Episode No', 'Episode No.', 'Episode Number', 'EpisodeNo',
    'No Episode', 'No. Episode', 'IPK', 'No IPK', 'No. IPK', 'IPK No',
    'IPK Number', 'Episode ID',
  ]);
  if (!episodeNo) {
    const split = splitCombinedOtIdentity(noRM, Boolean(noRMKey && isCombinedIdentityKey(noRMKey)));
    noRM = split.noRM;
    episodeNo = split.episodeNo;
  }
  const dibuat = pick(['Create', 'Created', 'Created At', 'Created Date', 'Create Date', 'Created On', 'Dibuat', 'CreatedDate', 'CreatedTime', 'Date Created', 'Request Date']);
  const namaPasien = pick(['Patient Name', 'PatientName', 'Patient Full Name', 'Patient Fullname', 'Nama Pasien', 'Nama', 'Name', 'Patient']);
  const tanggalOperasi = pick(['Operation Date', 'OperationDate', 'Tanggal Operasi', 'Tanggal Tindakan', 'Date']);
  const jamOperasi = pick(['Operation Time', 'OperationTime', 'Jam Operasi', 'Jam Tindakan', 'Time']);
  const ruangOperasi = pick(['Operating Room', 'OperatingRoom', 'Operation Room', 'Ruang Operasi', 'Room']);
  const dpjp = pick(['Surgeon Doctor', 'SurgeonDoctor', 'Surgeon', 'DPJP', 'Doctor', 'Dokter']);
  const pboUrl = Object.entries(record).reduce((found, [key, value]) => {
    if (found || typeof value !== 'string') return found;
    if (!/(?:pbo|ebo|url|link|action)/i.test(key) && !/\b(?:e|p)bo\b/i.test(value)) return '';
    return normalizePboUrl(value, baseUrl) || value.match(/https?:\/\/[^"'\\\s)]+|(?:\/|\.\/)[^"'\\\s)]+/i)?.[0]
      ? normalizePboUrl(value.match(/https?:\/\/[^"'\\\s)]+|(?:\/|\.\/)[^"'\\\s)]+/i)?.[0] || '', baseUrl)
      : '';
  }, '');
  const extraFields = Object.fromEntries(
    Object.entries(record)
      .filter(([key, value]) => !consumed.has(key) && text(value))
      .map(([key, value]) => [key, text(value)]),
  );
  return {
    id: `${noRM || namaPasien || 'row'}-${tanggalOperasi}-${jamOperasi}`,
    noRM,
    episodeNo: episodeNo || undefined,
    dibuat,
    namaPasien,
    tanggalOperasi,
    jamOperasi,
    ruangOperasi,
    dpjp,
    pboUrl: pboUrl || undefined,
    extraFields,
  };
}

export function isInProgressOperatingTheatrePatient(patient: OperatingTheatrePatient): boolean {
  return Object.entries(patient.extraFields ?? {}).some(([key, value]) =>
    /status/i.test(key) && /in\s*[-_]?\s*progress/i.test(value),
  );
}

function mapInProgressRecord(record: Record<string, unknown>, index: number): OperatingTheatreInProgressPatient {
  const entries = Object.entries(record);
  const consumed = new Set<string>();
  const pick = (candidates: string[]) => {
    const wanted = candidates.map(normalize);
    const found = entries.find(([key, value]) => wanted.includes(normalize(key)) && text(value));
    if (found) consumed.add(found[0]);
    return found ? text(found[1]) : '';
  };
  const noRM = pick(['No MR', 'No. MR', 'No RM', 'No. RM', 'MRN', 'Medical Record Number', 'MedicalRecordNumber']);
  const episodeNo = pick(['Episode', 'Episode No', 'Episode Number', 'EpisodeNo', 'No Episode', 'No. Episode', 'IPK', 'No IPK']);
  const dibuat = pick(['Create', 'Created', 'Created At', 'Dibuat', 'CreatedDate', 'CreatedTime', 'Date Created']);
  const namaPasien = pick(['Patient Name', 'PatientName', 'Nama Pasien', 'Name', 'Patient']);
  const rencanaTindakan = pick(['Operation', 'Operation Name', 'Procedure', 'Planned Operation', 'Rencana Tindakan', 'Tindakan']);
  const ruangOperasi = pick(['Operating Room', 'OperatingRoom', 'Operation Room', 'Ruang Operasi', 'Room']);
  const dpjp = pick(['Surgeon Doctor', 'SurgeonDoctor', 'Surgeon', 'DPJP', 'Doctor', 'Dokter']);
  const penjamin = pick(['Penjamin', 'Payer', 'Payor', 'Guarantor', 'Insurance']);
  const keterangan = pick(['Message', 'Keterangan', 'Description', 'Remark', 'Remarks', 'Note']);
  const status = pick(['Status', 'Request Status', 'OT Status']) || 'In Progress';
  const extraFields = Object.fromEntries(
    entries
      .filter(([key, value]) => !consumed.has(key) && text(value))
      .map(([key, value]) => [key, text(value)]),
  );
  return {
    id: `${noRM || namaPasien || 'row'}-${dibuat}`,
    noRM,
    episodeNo: episodeNo || undefined,
    dibuat,
    namaPasien,
    rencanaTindakan,
    ruangOperasi,
    dpjp,
    penjamin,
    keterangan,
    status,
    extraFields,
  };
}

function parseJsonPayload(payload: unknown, baseUrl = ''): OperatingTheatrePatient[] {
  const rows = findArray(payload);
  return rows
    .filter(row => row && typeof row === 'object' && !Array.isArray(row))
    .map((row, index) => mapRecord(row as Record<string, unknown>, index, baseUrl));
}

function parseInProgressJsonPayload(payload: unknown): OperatingTheatreInProgressPatient[] {
  return findArray(payload)
    .filter(row => row && typeof row === 'object' && !Array.isArray(row))
    .map((row, index) => mapInProgressRecord(row as Record<string, unknown>, index));
}

function stripHtml(value: string): string {
  const el = document.createElement('div');
  el.innerHTML = value;
  return text(el.textContent || el.innerText || '');
}

function parseHtmlPayload(html: string, baseUrl = ''): OperatingTheatrePatient[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tables = Array.from(doc.querySelectorAll('table'));
  const knownHeader = (value: string) => {
    const key = normalize(value);
    return [
       'nomr', 'mrn', 'nomrepisode', 'nomrnoepisode', 'nomripk', 'rmepisode', 'mrepisode',
       'medicalrecordnumber', 'create', 'created', 'createdat', 'createddate',
      'createdtime', 'datecreated', 'requestdate', 'dibuat',
      'patient', 'patientname', 'namapasien',
      'operation', 'operationdate', 'operationtime', 'tanggaloperasi', 'jamoperasi',
      'operatingroom', 'ruangoperasi', 'surgeon', 'surgeondoctor', 'dpjp', 'doctor',
    ].some(candidate => key.includes(candidate) || candidate.includes(key));
  };
  const parseRows = (table: Element, headerIndex: number) => {
    const rows = Array.from(table.querySelectorAll('tr'));
    const headers = Array.from(rows[headerIndex].querySelectorAll('th,td')).map(cell => text(cell.textContent));
    return rows.slice(headerIndex + 1)
      .map((row, index) => {
        const cells = Array.from(row.querySelectorAll('td,th')).map(cell => text(cell.textContent));
        if (!cells.length || cells.every(cell => !cell) || cells.join(' ') === headers.join(' ')) return null;
        const record = Object.fromEntries(headers.map((header, i) => [header || `Field ${i + 1}`, cells[i] || '']));
        const link = Array.from(row.querySelectorAll('a')).find(anchor =>
          /\b(?:e|p)bo\b/i.test(text(anchor.textContent)) || /\b(?:e|p)bo\b/i.test(anchor.getAttribute('href') || ''),
        );
        if (link?.getAttribute('href')) record.pboUrl = normalizePboUrl(link.getAttribute('href') || '', baseUrl);
        return mapRecord(record, index, baseUrl);
      })
      .filter((row): row is OperatingTheatrePatient => Boolean(row));
  };

  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll('tr'));
    const headerIndex = rows.findIndex(row => {
      const values = Array.from(row.querySelectorAll('th,td')).map(cell => text(cell.textContent));
      return values.length >= 2 && values.filter(knownHeader).length >= 2;
    });
    if (headerIndex >= 0) {
      const parsed = parseRows(table, headerIndex);
      if (parsed.length) return parsed;
    }
  }

  // Older layouts may use only <td> cells and localized headings.
  const fallbackTable = tables
    .map(table => ({ table, rows: table.querySelectorAll('tr').length }))
    .sort((a, b) => b.rows - a.rows)[0];
  if (fallbackTable && fallbackTable.rows >= 2) return parseRows(fallbackTable.table, 0);
  return [];
}

function parseInProgressHtmlPayload(html: string): OperatingTheatreInProgressPatient[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tables = Array.from(doc.querySelectorAll('table'));
  const knownHeader = (value: string) => {
    const key = normalize(value);
    return ['create', 'created', 'patient', 'patientname', 'nomr', 'mrn', 'operation', 'operatingroom', 'surgeon', 'penjamin', 'message', 'status']
      .some(candidate => key.includes(candidate) || candidate.includes(key));
  };
  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll('tr'));
    const headerIndex = rows.findIndex(row => {
      const values = Array.from(row.querySelectorAll('th,td')).map(cell => text(cell.textContent));
      return values.length >= 2 && values.filter(knownHeader).length >= 2;
    });
    if (headerIndex < 0) continue;
    const headers = Array.from(rows[headerIndex].querySelectorAll('th,td')).map(cell => text(cell.textContent));
    const parsed = rows.slice(headerIndex + 1).map((row, index) => {
      const values = Array.from(row.querySelectorAll('td,th')).map(cell => text(cell.textContent));
      if (!values.length || values.every(value => !value)) return null;
      return mapInProgressRecord(
        Object.fromEntries(headers.map((header, i) => [header || `Field ${i + 1}`, values[i] || ''])),
        index,
      );
    }).filter((row): row is OperatingTheatreInProgressPatient => Boolean(row));
    if (parsed.length) return parsed;
  }
  return [];
}

export function parseOperatingTheatreResponse(body: string, contentType = '', baseUrl = ''): OperatingTheatrePatient[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseJsonPayload(JSON.parse(trimmed), baseUrl);
    } catch {
      // Fall through to HTML parsing for mislabeled responses.
    }
  }
  return parseHtmlPayload(trimmed, baseUrl);
}

export function parseOperatingTheatreInProgressResponse(
  body: string,
  contentType = '',
): OperatingTheatreInProgressPatient[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseInProgressJsonPayload(JSON.parse(trimmed));
    } catch {
      // Fall through to HTML parsing for mislabeled responses.
    }
  }
  return parseInProgressHtmlPayload(trimmed);
}

export async function getOperatingTheatreConfig(): Promise<OperatingTheatreConfig> {
  const db = await getDB();
  const saved = await db.get('settings', CONFIG_KEY);
  return {
    ...DEFAULT_OPERATING_THEATRE_CONFIG,
    ...(saved?.value ?? {}),
    endpoint: DEFAULT_OPERATING_THEATRE_ENDPOINT,
  };
}

export async function saveOperatingTheatreConfig(config: OperatingTheatreConfig): Promise<void> {
  const db = await getDB();
  await db.put('settings', {
    key: CONFIG_KEY,
    value: { ...config, endpoint: DEFAULT_OPERATING_THEATRE_ENDPOINT },
  });
}

function getClientId(): string {
  if (typeof window === 'undefined') return 'server';
  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  window.localStorage.setItem(CLIENT_ID_KEY, id);
  return id;
}

function loginUrlForEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  url.pathname = url.pathname.replace(/\/otrequest\/dashboard\/.*$/i, '/login');
  url.search = `route=trakcare.operatingtheatre.otrequest.dashboard.hospital&url=${encodeURIComponent(endpoint)}`;
  return url.toString();
}

function isLoginPage(body: string): boolean {
  return /<input[^>]+name=["']username["']/i.test(body)
    && /<input[^>]+name=["']password["']/i.test(body);
}

function isLoginRedirect(response: Response): boolean {
  if (response.status < 300 || response.status >= 400) return false;
  return /\/login(?:[/?]|$)/i.test(response.headers.get('location') || '');
}

function isOfflineFileMode(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'file:';
}

async function fetchOperatingTheatreViaProxy(
  config: OperatingTheatreConfig,
  forceLogin: boolean,
  view: 'dashboard' | 'inprogress',
): Promise<OperatingTheatrePatient[] | OperatingTheatreInProgressPatient[]> {
  if (isGasHosted()) {
    const body = await ipawApi<{
      patients?: OperatingTheatrePatient[] | OperatingTheatreInProgressPatient[];
      html?: string;
      contentType?: string;
      baseUrl?: string;
    }>('/api/trakcare/operating-theatre', {
      method: 'POST',
      body: {
        endpoint: DEFAULT_OPERATING_THEATRE_ENDPOINT,
        username: config.username,
        password: config.password,
        clientId: getClientId(),
        forceLogin,
        ...(view === 'inprogress' ? { view } : {}),
      },
      debugLabel: `trakcare/operating-theatre/${view}`,
    });
    if (Array.isArray(body?.patients)) {
      return body.patients;
    }
    if (typeof body?.html === 'string') {
      return view === 'inprogress'
        ? parseOperatingTheatreInProgressResponse(body.html, body.contentType || 'text/html')
        : parseOperatingTheatreResponse(
            body.html,
            body.contentType || 'text/html',
            body.baseUrl || DEFAULT_OPERATING_THEATRE_ENDPOINT,
          );
    }
    return [];
  }

  const proxyBase = getOfflineOperatingTheatreProxyBase() || getApiBaseUrl();
  const response = await fetch(`${proxyBase}/api/trakcare/operating-theatre`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: DEFAULT_OPERATING_THEATRE_ENDPOINT,
      username: config.username,
      password: config.password,
      clientId: getClientId(),
      forceLogin,
      ...(view === 'inprogress' ? { view } : {}),
    }),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || 'Server TrakCare tidak dapat dihubungi.');
  }
  if (Array.isArray(body?.patients)) {
    return view === 'inprogress'
      ? body.patients as OperatingTheatreInProgressPatient[]
      : body.patients as OperatingTheatrePatient[];
  }
  if (typeof body?.html === 'string') {
    return view === 'inprogress'
      ? parseOperatingTheatreInProgressResponse(body.html, body.contentType || 'text/html')
      : parseOperatingTheatreResponse(body.html, body.contentType || 'text/html', body.baseUrl || DEFAULT_OPERATING_THEATRE_ENDPOINT);
  }
  return [];
}

export function getOperatingTheatreInProgressEndpoint(config: OperatingTheatreConfig = DEFAULT_OPERATING_THEATRE_CONFIG): string {
  void config;
  return DEFAULT_OPERATING_THEATRE_IN_PROGRESS_ENDPOINT;
}

async function fetchDirect(
  config: OperatingTheatreConfig,
  view: 'dashboard' | 'inprogress' = 'dashboard',
): Promise<OperatingTheatrePatient[] | OperatingTheatreInProgressPatient[]> {
  try {
    const dashboardEndpoint = DEFAULT_OPERATING_THEATRE_ENDPOINT;
    const loginUrl = loginUrlForEndpoint(dashboardEndpoint);
    // Browser fetches from the offline launcher cannot inspect cross-origin
    // 3xx responses with redirect: "manual" (Chrome exposes them as an
    // opaque response with status 0). Follow the TrakCare redirect instead,
    // then validate the final HTML below.
    const loginResponse = await fetch(loginUrl, {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!loginResponse.ok) throw new Error('Login ke TrakCare gagal.');
    const loginHtml = await loginResponse.text();
    if (!isLoginPage(loginHtml)) throw new Error('Login ke TrakCare gagal.');
    const tokenMatch = loginHtml.match(/name=["']_token["'][^>]+value=["']([^"']+)/i);
    const form = new URLSearchParams();
    if (tokenMatch) form.set('_token', tokenMatch[1]);
    form.set('username', config.username);
    form.set('password', config.password);
    const loginSubmit = await fetch(loginUrl, {
      method: 'POST',
      body: form,
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'follow',
    });
    if (!loginSubmit.ok) throw new Error('Login ke TrakCare gagal.');
    const loginResultHtml = await loginSubmit.text();
    if (isLoginPage(loginResultHtml)) throw new Error('Login ke TrakCare gagal.');
    const target = view === 'inprogress' ? DEFAULT_OPERATING_THEATRE_IN_PROGRESS_ENDPOINT : dashboardEndpoint;
    const response = await fetch(target, {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
    });
    if (response.status === 401) throw new Error('Login ke TrakCare gagal.');
    if (!response.ok) throw new Error('Server TrakCare tidak dapat dihubungi.');
    const body = await response.text();
    if (isLoginPage(body)) throw new Error('Login ke TrakCare gagal.');
    return view === 'inprogress'
      ? parseOperatingTheatreInProgressResponse(body, response.headers.get('content-type') || '')
      : parseOperatingTheatreResponse(body, response.headers.get('content-type') || '', target);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (
      message.includes('failed to fetch') ||
      message.includes('networkerror') ||
      message.includes('load failed') ||
      message.includes('network request failed')
    ) {
      throw new Error(
        'TrakCare Operating Theatre tidak dapat diakses. ' +
        'Jalankan ipaw.html melalui buka-ipaw-offline.bat saat terhubung ke jaringan internal RS EMC.',
      );
    }
    throw error;
  }
}

export async function fetchOperatingTheatre(config: OperatingTheatreConfig, forceLogin = false): Promise<OperatingTheatrePatient[]> {
  // The offline bundle may contain a reachable API server URL. Prefer it so
  // the server owns the TrakCare HttpOnly session; skip the older Cloud-only
  // deployment because it does not expose the Operating Theatre route.
  const canUseProxy =
    getOfflineOperatingTheatreProxyBase() !== '' ||
    isGasHosted() ||
    (!isOfflineFileMode() && (hasApiProxy() || getApiBaseUrl() !== ''));
  if (canUseProxy) {
    try {
      return (await fetchOperatingTheatreViaProxy(config, forceLogin, 'dashboard')) as OperatingTheatrePatient[];
    } catch (error) {
      if (!isOfflineFileMode()) throw error;
      console.warn('[TrakCare OT] API proxy tidak dapat diakses dari ipaw.html; mencoba koneksi langsung.', error);
    }
  }
  return (await fetchDirect(config, 'dashboard')) as OperatingTheatrePatient[];
}

export async function fetchOperatingTheatreInProgress(
  config: OperatingTheatreConfig,
  forceLogin = false,
): Promise<OperatingTheatreInProgressPatient[]> {
  const canUseProxy =
    getOfflineOperatingTheatreProxyBase() !== '' ||
    isGasHosted() ||
    (!isOfflineFileMode() && (hasApiProxy() || getApiBaseUrl() !== ''));
  if (canUseProxy) {
    try {
      return (await fetchOperatingTheatreViaProxy(config, forceLogin, 'inprogress')) as OperatingTheatreInProgressPatient[];
    } catch (error) {
      if (!isOfflineFileMode()) throw error;
      console.warn('[TrakCare OT] API proxy tidak dapat diakses dari ipaw.html; mencoba koneksi langsung.', error);
    }
  }
  return (await fetchDirect(config, 'inprogress')) as OperatingTheatreInProgressPatient[];
}

export async function getOperatingTheatreCache(): Promise<OperatingTheatreCache | undefined> {
  const db = await getDB();
  const cache = await db.get('operatingTheatreCache', 'latest');
  if (!cache) return undefined;
  const activePatients = cache.patients.filter(patient => !isOperatingTheatrePatientExpired(patient));
  if (activePatients.length === cache.patients.length) return cache;

  const prunedCache: OperatingTheatreCache = {
    ...cache,
    patients: activePatients,
  };
  await db.put('operatingTheatreCache', prunedCache);
  void backupCloud().catch(error => {
    console.warn('[Operating Theatre] Backup penghapusan Rencana Tindakan kedaluwarsa gagal:', error);
  });
  return prunedCache;
}

export async function saveOperatingTheatreCache(
  patients: OperatingTheatrePatient[],
  endpoint: string,
  source: 'live' | 'cache' = 'live',
  excludedPatients: OperatingTheatrePatient[] = [],
  retainedPatients?: OperatingTheatrePatient[],
): Promise<OperatingTheatreCache> {
  const existing = await getOperatingTheatreCache();
  const excludedKeys = new Set(excludedPatients.map(patientIdentity));
  const retained = (retainedPatients ?? existing?.patients ?? []).filter(patient =>
    !isOperatingTheatrePatientExpired(patient) && !excludedKeys.has(patientIdentity(patient)),
  );
  const incoming = patients.filter(patient =>
    !isOperatingTheatrePatientExpired(patient) && !excludedKeys.has(patientIdentity(patient)),
  );
  const byIdentity = new Map(retained.map(patient => [patientIdentity(patient), patient]));
  incoming.forEach(patient => byIdentity.set(patientIdentity(patient), patient));
  const mergedPatients = [...byIdentity.values()];
  const cache: OperatingTheatreCache = {
    key: 'latest',
    patients: mergedPatients,
    fetchedAt: Date.now(),
    source,
    endpoint,
  };
  const db = await getDB();
  await db.put('operatingTheatreCache', cache);
  if (!samePatients(existing?.patients ?? [], mergedPatients)) {
    void backupCloud().catch(error => {
      console.warn('[Operating Theatre] Backup cache Rencana Tindakan gagal:', error);
    });
  }
  return cache;
}

function patientIdentity(patient: OperatingTheatrePatient): string {
  const noRM = normalizePatientIdentifier(patient.noRM);
  const episodeNo = normalizePatientIdentifier(patient.episodeNo);
  const name = normalizePatientName(patient.namaPasien);
  if (noRM && episodeNo) return `rm-episode:${noRM}:${episodeNo}`;
  if (noRM && name) return `rm-name:${noRM}:${name}`;
  if (episodeNo && name) return `episode-name:${episodeNo}:${name}`;
  // A single source field is not enough to decide that two OT rows are the
  // same inpatient episode.
  return `id:${patient.id}`;
}

function localDateKey(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmy) {
    const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function todayDateKey(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

/**
 * Planned and Preadmission rows are retained through the operation date and
 * removed on H+1. Date-only values are compared as local calendar dates to
 * avoid UTC shifts. This also applies when the upstream source disappears.
 */
function isOperatingTheatrePatientExpired(patient: OperatingTheatrePatient): boolean {
  const actionKey = localDateKey(patient.tanggalOperasi);
  if (!actionKey) return false;
  const [year, month, day] = actionKey.split('-').map(Number);
  const expiry = new Date(year, month - 1, day + 1);
  const expiryKey = `${expiry.getFullYear()}-${String(expiry.getMonth() + 1).padStart(2, '0')}-${String(expiry.getDate()).padStart(2, '0')}`;
  return todayDateKey() >= expiryKey;
}

function samePatients(left: OperatingTheatrePatient[], right: OperatingTheatrePatient[]): boolean {
  const normalizePatients = (patients: OperatingTheatrePatient[]) =>
    patients
      .slice()
      .sort((a, b) => patientIdentity(a).localeCompare(patientIdentity(b)))
      .map(patient => JSON.stringify(patient));
  return JSON.stringify(normalizePatients(left)) === JSON.stringify(normalizePatients(right));
}

export async function getOperatingTheatreCompletedCache(): Promise<OperatingTheatreCompletedCache | undefined> {
  const db = await getDB();
  return db.get('operatingTheatreCompletedCache', 'latest');
}

export async function getOperatingTheatrePreadmissionCache(): Promise<OperatingTheatrePreadmissionCache | undefined> {
  const db = await getDB();
  const cache = await db.get('operatingTheatrePreadmissionCache', 'latest');
  if (!cache) return undefined;
  const activePatients = cache.patients.filter(patient => !isOperatingTheatrePatientExpired(patient));
  if (activePatients.length === cache.patients.length) return cache;
  const prunedCache: OperatingTheatrePreadmissionCache = {
    ...cache,
    patients: activePatients,
  };
  await db.put('operatingTheatrePreadmissionCache', prunedCache);
  void backupCloud().catch(error => {
    console.warn('[Operating Theatre] Backup penghapusan Preadmission kedaluwarsa gagal:', error);
  });
  return prunedCache;
}

export async function saveOperatingTheatrePreadmissionCache(
  patients: OperatingTheatrePatient[],
  endpoint: string,
  source: 'live' | 'cache' = 'live',
  excludedPatients: OperatingTheatrePatient[] = [],
): Promise<OperatingTheatrePreadmissionCache> {
  const existing = await getOperatingTheatrePreadmissionCache();
  const excludedKeys = new Set(excludedPatients.map(patientIdentity));
  const retained = (existing?.patients ?? []).filter(patient =>
    !isOperatingTheatrePatientExpired(patient) && !excludedKeys.has(patientIdentity(patient)),
  );
  const incoming = patients.filter(patient =>
    !isOperatingTheatrePatientExpired(patient) && !excludedKeys.has(patientIdentity(patient)),
  );
  const byIdentity = new Map(retained.map(patient => [patientIdentity(patient), patient]));
  incoming.forEach(patient => byIdentity.set(patientIdentity(patient), patient));
  const mergedPatients = [...byIdentity.values()];
  const changed = !samePatients(existing?.patients ?? [], mergedPatients);
  const cache: OperatingTheatrePreadmissionCache = {
    key: 'latest',
    patients: mergedPatients,
    fetchedAt: Date.now(),
    source,
    endpoint,
  };
  const db = await getDB();
  await db.put('operatingTheatrePreadmissionCache', cache);
  if (changed) {
    void backupCloud().catch(error => {
      console.warn('[Operating Theatre] Backup cache Preadmission gagal:', error);
    });
  }
  return cache;
}

export async function saveOperatingTheatreCompletedCache(
  patients: OperatingTheatreCompletedPatient[],
): Promise<OperatingTheatreCompletedCache> {
  const cache: OperatingTheatreCompletedCache = {
    key: 'latest',
    patients,
    updatedAt: Date.now(),
  };
  const db = await getDB();
  await db.put('operatingTheatreCompletedCache', cache);
  return cache;
}

export function filterOperatingTheatreCompletedPatients(
  patients: OperatingTheatreCompletedPatient[],
  inpatientPatients: Patient[],
): OperatingTheatreCompletedPatient[] {
  const activeInpatientPatients = inpatientPatients.filter(patient => patient.status === 'aktif');
  return patients.filter(patient => Boolean(findMatchingPatient(activeInpatientPatients, patient)));
}

export function filterOperatingTheatrePatientsByActiveInpatient(
  patients: OperatingTheatrePatient[],
  inpatientPatients: Patient[],
): OperatingTheatrePatient[] {
  const activeInpatientPatients = inpatientPatients.filter(patient => patient.status === 'aktif');
  return patients.filter(patient => Boolean(findMatchingPatient(activeInpatientPatients, patient)));
}

/**
 * Records planned patients that disappeared from a successful live snapshot.
 * A failed request must never call this function, so network failures cannot
 * incorrectly mark every planned patient as completed.
 */
export async function reconcileOperatingTheatreCompletedPatients(
  previousPatients: OperatingTheatrePatient[],
  currentPatients: OperatingTheatrePatient[],
  activeMappedPatients: OperatingTheatrePatient[] = [],
  activeInpatientPatients: Patient[] = [],
): Promise<OperatingTheatreCompletedPatient[]> {
  const existing = (await getOperatingTheatreCompletedCache())?.patients ?? [];
  const currentKeys = new Set(currentPatients.map(patientIdentity));
  const activeKeys = new Set(activeMappedPatients.map(patientIdentity));
  const isActiveInpatient = (patient: OperatingTheatrePatient) =>
    Boolean(findMatchingPatient(activeInpatientPatients, patient));
  const previousKeys = new Set<string>();
  const missing = previousPatients.filter(patient => {
    const key = patientIdentity(patient);
    if (previousKeys.has(key) || currentKeys.has(key) || !isActiveInpatient(patient)) return false;
    previousKeys.add(key);
    return true;
  });
  const activeCandidates = activeMappedPatients.filter(patient => {
    const key = patientIdentity(patient);
    return isActiveInpatient(patient) && !previousKeys.has(key) && !existing.some(item => patientIdentity(item) === key);
  });
  const retained = existing.filter(patient => {
    const key = patientIdentity(patient);
    return isActiveInpatient(patient) && (!currentKeys.has(key) || activeKeys.has(key));
  });
  const retainedKeys = new Set(retained.map(patientIdentity));
  const additions = [...missing, ...activeCandidates]
    .filter(patient => !retainedKeys.has(patientIdentity(patient)))
    .map(patient => ({ ...patient, selesaiPada: Date.now() }));
  const completed = [...retained, ...additions].sort((a, b) => b.selesaiPada - a.selesaiPada);
  await saveOperatingTheatreCompletedCache(completed);
  return completed;
}

export async function saveOperatingTheatreLiveSnapshot(
  patients: OperatingTheatrePatient[],
  endpoint: string,
  activeMappedPatients: OperatingTheatrePatient[] = [],
  activeInpatientPatients: Patient[] = [],
): Promise<{
  cache: OperatingTheatreCache;
  completed: OperatingTheatreCompletedPatient[];
  newlyCompleted: OperatingTheatreCompletedPatient[];
}> {
  const previous = await getOperatingTheatreCache();
  const previousPatients = previous?.patients ?? [];
  const activeCachedPatients = activeInpatientPatients
    ? previousPatients.filter(patient => Boolean(findMatchingPatient(activeInpatientPatients, patient)))
    : [];
  const mappedPatients = [...new Map(
    [...activeCachedPatients, ...activeMappedPatients].map(patient => [patientIdentity(patient), patient]),
  ).values()];
  // Keep the durable planned snapshot when the upstream page is empty or
  // incomplete. Live rows overwrite the same identity, so an updated
  // operation date is reflected immediately without losing older patients.
  const cache = await saveOperatingTheatreCache(
    mappedPatients,
    endpoint,
    'live',
    [],
    mappedPatients,
  );
  const newlyCompletedKeys = new Set(mappedPatients.map(patientIdentity));
  const completed = await reconcileOperatingTheatreCompletedPatients(
    previousPatients,
    cache.patients,
    mappedPatients,
    activeInpatientPatients,
  );
  const newlyCompleted = completed.filter(patient => newlyCompletedKeys.has(patientIdentity(patient)));
  return { cache, completed, newlyCompleted };
}

export async function getOperatingTheatreInProgressCache(): Promise<OperatingTheatreInProgressCache | undefined> {
  const db = await getDB();
  return db.get('operatingTheatreInProgressCache', 'latest');
}

export async function saveOperatingTheatreInProgressCache(
  patients: OperatingTheatreInProgressPatient[],
  endpoint: string,
): Promise<OperatingTheatreInProgressCache> {
  const cache: OperatingTheatreInProgressCache = {
    key: 'latest',
    patients,
    fetchedAt: Date.now(),
    source: 'live',
    endpoint,
  };
  const db = await getDB();
  await db.put('operatingTheatreInProgressCache', cache);
  return cache;
}

export async function exportOperatingTheatreExcel(
  patients: OperatingTheatrePatient[],
  label = 'Pasien Rencana Tindakan',
): Promise<void> {
  const rows = patients.map(patient => ({
    'No. RM': patient.noRM || '-',
    'Nama Pasien': patient.namaPasien || '-',
    'Tanggal Operasi': patient.tanggalOperasi || '-',
    'Jam Operasi': patient.jamOperasi || '-',
    'Ruang Operasi': patient.ruangOperasi || '-',
    DPJP: patient.dpjp || '-',
    ...patient.extraFields,
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), label.slice(0, 31));
  XLSX.writeFile(workbook, `${label.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportOperatingTheatrePdf(
  patients: OperatingTheatrePatient[],
  label = 'Pasien Rencana Tindakan',
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.text(label, 14, 14);
  autoTable(doc, {
    startY: 20,
    head: [['No. RM', 'Nama Pasien', 'Tanggal Operasi', 'Jam Operasi', 'Ruang Operasi', 'DPJP']],
    body: patients.map(patient => [
      patient.noRM || '-',
      patient.namaPasien || '-',
      patient.tanggalOperasi || '-',
      patient.jamOperasi || '-',
      patient.ruangOperasi || '-',
      patient.dpjp || '-',
    ]),
    styles: { fontSize: 8 },
  });
  doc.save(`pasien-rencana-tindakan-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export async function exportOperatingTheatreInProgressExcel(
  patients: OperatingTheatreInProgressPatient[],
): Promise<void> {
  const rows = patients.map(patient => ({
    Dibuat: patient.dibuat || '-',
    'No. RM': patient.noRM || '-',
    'Nama Pasien': patient.namaPasien || '-',
    'Rencana Tindakan': patient.rencanaTindakan || '-',
    'Ruang Operasi': patient.ruangOperasi || '-',
    DPJP: patient.dpjp || '-',
    Penjamin: patient.penjamin || '-',
    Status: patient.status || 'In Progress',
    Keterangan: patient.keterangan || '-',
    ...patient.extraFields,
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'In Progress');
  XLSX.writeFile(workbook, `pasien-in-progress-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportOperatingTheatreInProgressPdf(patients: OperatingTheatreInProgressPatient[]): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Pasien In Progress', 14, 14);
  autoTable(doc, {
    startY: 20,
    head: [['Dibuat', 'No. RM', 'Nama Pasien', 'Rencana Tindakan', 'Ruang Operasi', 'DPJP', 'Penjamin', 'Status', 'Keterangan']],
    body: patients.map(patient => [
      patient.dibuat || '-',
      patient.noRM || '-',
      patient.namaPasien || '-',
      patient.rencanaTindakan || '-',
      patient.ruangOperasi || '-',
      patient.dpjp || '-',
      patient.penjamin || '-',
      patient.status || 'In Progress',
      patient.keterangan || '-',
    ]),
    styles: { fontSize: 8 },
  });
  doc.save(`pasien-in-progress-${new Date().toISOString().slice(0, 10)}.pdf`);
}
