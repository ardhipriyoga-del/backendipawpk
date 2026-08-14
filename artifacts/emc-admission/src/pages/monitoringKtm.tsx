import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, RefreshCw, Search, Filter, Eye, Clock, CheckCircle2, WifiOff, History, X, ShieldOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { getApiBaseUrl, hasTrakCareProxy, isGasHosted } from '@/lib/apiConfig';
import { parseKTMPatients } from '@/lib/ktmParser';
import { fetchTrakCareViaGas } from '@/lib/trakcareClient';
import { getDB, type Patient } from '@/lib/db';
import { EpisodeLink } from '@/components/EpisodeLink';
import { getNotificationSettings, playNotificationSound, stopNotificationSound } from '@/lib/notificationSettings';
import { formatDate, formatDateTime } from '@/lib/utils';
const getApiBase = () => getApiBaseUrl();

// Status jaringan dari perspektif browser pengguna
// 'unknown'  — belum dicek
// 'internal' — appsprn.emc.id bisa dijangkau (jaringan RS)
// 'public'   — appsprn.emc.id tidak bisa dijangkau (internet publik)
// 'cors'     — server bisa dijangkau tapi CORS block (jaringan RS, perlu config IT)
type NetworkStatus = 'unknown' | 'internal' | 'public' | 'cors';

/**
 * Cek apakah appsprn.emc.id bisa dijangkau dari browser ini.
 * Menggunakan mode: 'no-cors' agar tidak membutuhkan header CORS dari server.
 * - Jika fetch berhasil (response.type === 'opaque') → server reachable → jaringan RS
 * - Jika fetch lempar TypeError (network error) → tidak reachable → internet publik
 */
async function checkInternalNetwork(url: string): Promise<'internal' | 'public'> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8_000);
  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    // no-cors fetch sukses → opaque response → server bisa dijangkau
    return 'internal';
  } catch {
    // TypeError / AbortError → server tidak bisa dijangkau dari jaringan ini
    return 'public';
  } finally {
    window.clearTimeout(timeoutId);
  }
}

const KTM_DIRECT_URL = 'https://appsprn.emc.id/trakcare/dashboard/list/trakcareANLT/type/ktm/hospital/4?ward=';
// GAS servers cannot resolve the internal appsprn hostname. The public
// apps.emc.id host serves the same KTM dashboard and is used only by ipawv3.
const KTM_GAS_URL = 'https://apps.emc.id/trakcare/dashboard/list/trakcareANLT/type/ktm/hospital/4?ward=';

// ── Types ─────────────────────────────────────────────────────────────────────

interface KTMPatient {
  noRM: string;
  episodeNo: string;
  namaPasien: string;
  ruangan: string;
  kelas: string;
  dpjp: string;
  tanggalKTM: string;
  jamKTM: string;
  tanggalJamKTM: string;
  ward: string;
}

type KtmDirectFetchError = Error & {
  networkStatus?: 'public' | 'cors';
};

async function fetchDirectKTM(): Promise<KTMPatient[]> {
  const reach = await checkInternalNetwork(KTM_DIRECT_URL);
  if (reach === 'public') {
    throw Object.assign(
      new Error('TrakCare tidak dapat dijangkau dari jaringan ini.'),
      { networkStatus: 'public' as const },
    );
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(KTM_DIRECT_URL, {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`TrakCare merespons HTTP ${response.status}.`);
    }
    return parseKTMPatients(await response.text());
  } catch (error) {
    const typedError = error as KtmDirectFetchError;
    typedError.networkStatus ??= 'cors';
    throw typedError;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

interface MonitoredKTM extends KTMPatient {
  status: 'baru' | 'sudah-dilihat';
  pertamaKaliMuncul: string;
  terakhirTerlihat: string;
  isNew: boolean;
  connectionStatus: 'terhubung' | 'belum-terhubung';
}

interface RiwayatKTM extends KTMPatient {
  pertamaKaliMuncul: string;
  terakhirTerlihat: string;
  tanggalHapus: string;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'ktm_monitoring_cache';
const RIWAYAT_KEY = 'ktm_riwayat_cache';

function loadCache(): Record<string, MonitoredKTM> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCache(data: Record<string, MonitoredKTM>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { }
}

function loadRiwayat(): RiwayatKTM[] {
  try {
    const raw = localStorage.getItem(RIWAYAT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRiwayat(data: RiwayatKTM[]) {
  try { localStorage.setItem(RIWAYAT_KEY, JSON.stringify(data.slice(-200))); } catch { }
}

// ── Sound helper ──────────────────────────────────────────────────────────────

function normalize(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function ktmTimestamp(patient: Pick<KTMPatient, 'tanggalKTM' | 'jamKTM'>): number {
  const raw = `${patient.tanggalKTM ?? ''} ${patient.jamKTM ?? ''}`.trim();
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return parsed;
  const numbers = raw.match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length >= 3) {
    const [day, month, year] = numbers;
    return new Date(year < 100 ? year + 2000 : year, month - 1, day, numbers[3] ?? 0, numbers[4] ?? 0).getTime();
  }
  return 0;
}

function patientKey(name: string, episode: string): string {
  return `${normalize(name)}|${normalize(episode)}`;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function MonitoringKtmPage() {
  const [patients, setPatients] = useState<Record<string, MonitoredKTM>>(() => loadCache());
  const [riwayat, setRiwayat] = useState<RiwayatKTM[]>(() => loadRiwayat());
  const [isOffline, setIsOffline] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRuangan, setFilterRuangan] = useState('semua');
  const [newCount, setNewCount] = useState(0);
  const [popupPatients, setPopupPatients] = useState<MonitoredKTM[]>([]);
  const [showPopup, setShowPopup] = useState(false);
  const [activeTab, setActiveTab] = useState<'aktif' | 'riwayat'>('aktif');
  // Status jaringan: unknown saat pertama kali, lalu internal/public/cors
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>('unknown');

  const soundPlayingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch KTM data ──────────────────────────────────────────────────────────

  const fetchKTM = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      let incoming: KTMPatient[];

      if (isGasHosted()) {
        const response = await fetchTrakCareViaGas('ktm', KTM_GAS_URL);
        incoming = parseKTMPatients(response.body);
        setNetworkStatus('internal');
      } else if (hasTrakCareProxy()) {
        // Proxy cloud dapat tidak memiliki akses ke domain internal RS.
        // Jika proxy gagal, lanjutkan melalui browser pengguna di jaringan EMC.
        try {
          const base = getApiBase();
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), 20_000);
          let response: Response;
          try {
            response = await fetch(`${base}/api/trakcare/ktm?ward=`, {
              signal: controller.signal,
            });
          } finally {
            window.clearTimeout(timeoutId);
          }
          if (!response.ok) {
            throw new Error(`KTM proxy merespons HTTP ${response.status}.`);
          }
          const data: { patients?: KTMPatient[]; html?: string; fetchedAt?: string } =
            await response.json();
          incoming = Array.isArray(data.patients)
            ? data.patients
            : typeof data.html === 'string'
              ? parseKTMPatients(data.html)
              : [];
          setNetworkStatus('internal');
        } catch {
          try {
            incoming = await fetchDirectKTM();
            setNetworkStatus('internal');
          } catch (directError) {
            const error = directError as KtmDirectFetchError;
            setNetworkStatus(error.networkStatus ?? 'cors');
            setIsOffline(true);
            return;
          }
        }
      } else {
        try {
          incoming = await fetchDirectKTM();
          setNetworkStatus('internal');
        } catch (directError) {
          const error = directError as KtmDirectFetchError;
          setNetworkStatus(error.networkStatus ?? 'cors');
          setIsOffline(true);
          return;
        }
      }

      setIsOffline(false);
      setLastUpdate(formatDateTime(new Date()));

      const db = await getDB();
      const inpatientPatients = await db.getAll('patients');
      const inpatientByKey = new Map(
        inpatientPatients.map((patient: Patient) => [
          patientKey(patient.namaPasien, patient.episodeNo),
          patient,
        ]),
      );
      const linkedIncoming = incoming.map((raw) => {
        const matched = inpatientByKey.get(patientKey(raw.namaPasien, raw.episodeNo));
        return {
          ...raw,
          ...(matched
            ? {
                noRM: matched.noRM,
                namaPasien: matched.namaPasien,
                episodeNo: matched.episodeNo,
                ruangan: matched.roomName || matched.ward || raw.ruangan,
                ward: matched.ward || raw.ward,
                dpjp: matched.dpjp || raw.dpjp,
                kelas: matched.roomType || raw.kelas,
              }
            : {}),
          connectionStatus: matched ? 'terhubung' as const : 'belum-terhubung' as const,
        };
      });
      const incomingMap: Record<string, (typeof linkedIncoming)[number]> = {};
      linkedIncoming.forEach(p => { incomingMap[patientKey(p.namaPasien, p.episodeNo)] = p; });

      setPatients(prev => {
        const now = new Date().toISOString();
        const updated: Record<string, MonitoredKTM> = {};
        const newlyFound: MonitoredKTM[] = [];

        // Add / update existing
        linkedIncoming.forEach(p => {
          const key = patientKey(p.namaPasien, p.episodeNo);
          const existing = prev[key];
          if (!existing) {
            // Brand new patient
            const newEntry: MonitoredKTM = {
              ...p,
              status: 'baru',
              pertamaKaliMuncul: now,
              terakhirTerlihat: now,
              isNew: true,
            };
            updated[key] = newEntry;
            newlyFound.push(newEntry);
          } else {
            updated[key] = {
              ...existing,
              ...p,
              terakhirTerlihat: now,
              isNew: false,
            };
          }
        });

        // Move removed patients to riwayat (don't remove from cache on error)
        const removed: RiwayatKTM[] = [];
        Object.values(prev).forEach(p => {
          if (!incomingMap[patientKey(p.namaPasien, p.episodeNo)]) {
            removed.push({
              ...p,
              pertamaKaliMuncul: p.pertamaKaliMuncul,
              terakhirTerlihat: p.terakhirTerlihat,
              tanggalHapus: now,
            });
          }
        });

        if (removed.length > 0) {
          setRiwayat(r => {
            const updated = [...r, ...removed];
            saveRiwayat(updated);
            return updated;
          });
        }

        // Notify new patients
        if (newlyFound.length > 0) {
          void getNotificationSettings().then((settings) => {
            if (!settings.popupEnabled) return;
            setPopupPatients(newlyFound);
            setShowPopup(true);
            if (settings.soundEnabled) void playNotificationSound('ktm');
          });
          setNewCount(c => c + newlyFound.length);
        }

        saveCache(updated);
        return updated;
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') setIsOffline(true);
    } finally {
      if (isManual) setIsRefreshing(false);
    }
  }, []);

  // ── Auto-refresh ────────────────────────────────────────────────────────────
  // Jangan poll jika sudah dipastikan pengguna di internet publik (tidak akan berhasil)

  useEffect(() => {
    fetchKTM();
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        // Jika sudah terkonfirmasi publik, tidak perlu poll ulang.
        // Cukup cek ulang jaringan setiap 60 detik (misalnya user berpindah ke WiFi RS).
        fetchKTM();
      }, 45_000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchKTM]);

  // Reset new-count when popup is closed
  useEffect(() => {
    if (!showPopup) {
      soundPlayingRef.current = false;
      stopNotificationSound();
    }
  }, [showPopup]);

  useEffect(() => () => {
    stopNotificationSound();
  }, []);

  // ── Mark as seen ────────────────────────────────────────────────────────────

  const markSeen = (noRM: string) => {
    setPatients(prev => {
      const updated: Record<string, MonitoredKTM> = {
        ...prev,
        [noRM]: { ...prev[noRM], status: 'sudah-dilihat' as const, isNew: false },
      };
      saveCache(updated);
      return updated;
    });
    setNewCount(c => Math.max(0, c - 1));
  };

  const markAllSeen = () => {
    setPatients(prev => {
      const updated: Record<string, MonitoredKTM> = {};
      Object.entries(prev).forEach(([k, v]) => {
        updated[k] = { ...v, status: 'sudah-dilihat', isNew: false };
      });
      saveCache(updated);
      return updated;
    });
    setNewCount(0);
    setShowPopup(false);
  };

  // ── Filter / search ─────────────────────────────────────────────────────────

  const allPatients = Object.values(patients);

  const ruanganList = ['semua', ...Array.from(new Set(allPatients.map(p => p.ruangan || p.ward).filter(Boolean)))];

  const filtered = allPatients.filter(p => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || p.namaPasien.toLowerCase().includes(q) || p.noRM.includes(q);
    const ruanganVal = p.ruangan || p.ward;
    const matchRuangan = filterRuangan === 'semua' || ruanganVal === filterRuangan;
    return matchSearch && matchRuangan;
  }).sort((a, b) => {
    // New first, then by time
    if (a.status === 'baru' && b.status !== 'baru') return -1;
    if (b.status === 'baru' && a.status !== 'baru') return 1;
    return ktmTimestamp(b) - ktmTimestamp(a);
  });

  const newPatients = allPatients.filter(p => p.status === 'baru');

  // ── Render ──────────────────────────────────────────────────────────────────

  // ── Layar khusus: pengguna di internet publik ──────────────────────────────
  if (networkStatus === 'public') {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="max-w-sm w-full">
          <div className="flex justify-center mb-5">
            <div className="bg-muted rounded-full p-5">
              <ShieldOff className="w-10 h-10 text-muted-foreground" />
            </div>
          </div>
          <h2 className="text-lg font-semibold mb-2">Fitur Tidak Tersedia</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Monitoring KTM hanya dapat digunakan saat perangkat terhubung ke
            <span className="font-medium text-foreground"> jaringan internal RS EMC</span>.
          </p>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              setNetworkStatus('unknown');
              fetchKTM(true);
            }}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Coba Lagi
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Bell className="w-7 h-7 text-primary" />
            {newCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-0.5">
                {newCount > 99 ? '99+' : newCount}
              </span>
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold">Monitoring KTM</h1>
            <p className="text-xs text-muted-foreground">Konfirmasi Tindakan Medis · RS EMC Pekayon</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Status indicator */}
          {networkStatus === 'unknown' && !lastUpdate ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Memeriksa jaringan...</span>
            </div>
          ) : isOffline ? (
            <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 px-2.5 py-1 rounded-full">
              <WifiOff className="w-3.5 h-3.5" />
              <span>TrakCare Offline</span>
            </div>
          ) : lastUpdate ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              <span>Update: {lastUpdate}</span>
            </div>
          ) : null}

          {/* Auto refresh toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="auto-refresh"
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
            />
            <Label htmlFor="auto-refresh" className="text-xs cursor-pointer">
              Auto Refresh {autoRefresh ? 'ON' : 'OFF'}
            </Label>
          </div>

          {/* Manual refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchKTM(true)}
            disabled={isRefreshing}
            className="gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {/* Riwayat toggle */}
          <Button
            variant={activeTab === 'riwayat' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(activeTab === 'aktif' ? 'riwayat' : 'aktif')}
            className="gap-1.5"
          >
            <History className="w-3.5 h-3.5" />
            Riwayat {riwayat.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{riwayat.length}</Badge>}
          </Button>
        </div>
      </div>

      {/* Warning: CORS block (di jaringan RS tapi server belum konfigurasi CORS) */}
      {networkStatus === 'cors' && (
        <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldOff className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm text-amber-700 dark:text-amber-400">CORS Tidak Dikonfigurasi di TrakCare</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Perangkat terdeteksi berada di jaringan RS EMC, namun browser memblokir akses karena server TrakCare
                tidak mengirim header <code className="bg-muted px-1 rounded text-[11px]">Access-Control-Allow-Origin</code>.
                Hubungi IT RS untuk menambahkan header CORS pada server <code className="bg-muted px-1 rounded text-[11px]">appsprn.emc.id</code>,
                atau deploy API Server ke server internal RS dan atur <code className="bg-muted px-1 rounded text-[11px]">VITE_API_BASE_URL</code> di Netlify.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Offline Warning: di jaringan RS tapi TrakCare tidak merespons */}
      {isOffline && networkStatus !== 'cors' && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-start gap-3 py-4">
            <WifiOff className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm text-destructive">Server TrakCare Tidak Merespons</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tidak dapat mengambil data dari TrakCare. Pastikan server TrakCare aktif dan dapat diakses dari jaringan RS.
                Monitoring akan otomatis mencoba kembali.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">Total Aktif</p>
            <p className="text-2xl font-bold text-primary">{allPatients.length}</p>
          </CardContent>
        </Card>
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">KTM Baru</p>
            <p className="text-2xl font-bold text-destructive">{newPatients.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">Sudah Dilihat</p>
            <p className="text-2xl font-bold">{allPatients.filter(p => p.status === 'sudah-dilihat').length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground">Riwayat</p>
            <p className="text-2xl font-bold">{riwayat.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filter */}
      {activeTab === 'aktif' && (
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Cari nama atau No. RM..."
              className="pl-8"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={filterRuangan} onValueChange={setFilterRuangan}>
            <SelectTrigger className="w-44">
              <Filter className="w-3.5 h-3.5 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ruanganList.map(r => (
                <SelectItem key={r} value={r}>{r === 'semua' ? 'Semua Ruangan' : r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {newPatients.length > 0 && (
            <Button variant="outline" size="sm" onClick={markAllSeen} className="gap-1.5 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Tandai Semua Dilihat
            </Button>
          )}
        </div>
      )}

      {/* Patient Cards — Aktif */}
      {activeTab === 'aktif' && (
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Bell className="w-12 h-12 text-muted-foreground/30 mb-3" />
              <p className="font-medium text-muted-foreground">
                {allPatients.length === 0 ? 'Tidak ada KTM aktif saat ini' : 'Tidak ada hasil yang cocok'}
              </p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                {allPatients.length === 0 ? 'Monitoring berjalan. Data akan muncul otomatis saat ada KTM baru.' : 'Coba ubah filter pencarian.'}
              </p>
            </div>
          ) : (
            filtered.map(p => (
              <KTMCard key={p.noRM} patient={p} onMarkSeen={() => markSeen(p.noRM)} />
            ))
          )}
        </div>
      )}

      {/* Riwayat Tab */}
      {activeTab === 'riwayat' && (
        <div className="space-y-2">
          {riwayat.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <History className="w-12 h-12 text-muted-foreground/30 mb-3" />
              <p className="font-medium text-muted-foreground">Belum ada riwayat KTM</p>
            </div>
          ) : (
            [...riwayat].reverse().map((p, i) => (
              <RiwayatCard key={`${p.noRM}-${i}`} patient={p} />
            ))
          )}
        </div>
      )}

      {/* Popup Notification */}
      <Dialog
        open={showPopup}
        onOpenChange={(open) => {
          if (open) setShowPopup(true);
        }}
      >
        <DialogContent
          className="max-w-md"
          onPointerDown={() => stopNotificationSound()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Bell className="w-5 h-5 animate-bounce" />
              KTM Baru Ditemukan!
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {popupPatients.map(p => (
              <div key={p.noRM} className="border rounded-lg p-3 bg-destructive/5 border-destructive/20">
                <p className="font-semibold">{p.namaPasien || '(Nama tidak tersedia)'}</p>
                <p className="text-sm text-muted-foreground">No. RM: {p.noRM}</p>
                <p className="text-sm text-muted-foreground">Ruangan Pas: {p.ruangan || p.ward || '-'}</p>
                <p className="text-sm text-muted-foreground">
                  Episode Rawat Inap: <EpisodeLink episode={p.episodeNo} />
                </p>
                <p className="text-sm text-muted-foreground">DPJP: {p.dpjp}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Tanggal Pembuatan KTM: {p.tanggalKTM || '-'} · Waktu Pembuatan KTM: {p.jamKTM || '-'}
                </p>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="default" className="flex-1" onClick={markAllSeen}>
              <CheckCircle2 className="w-4 h-4 mr-1" />
              Tandai Sudah Dilihat
            </Button>
            <Button variant="outline" onClick={() => setShowPopup(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Patient Card ──────────────────────────────────────────────────────────────

function KTMCard({ patient: p, onMarkSeen }: { patient: MonitoredKTM; onMarkSeen: () => void }) {
  const isNew = p.status === 'baru';
  return (
    <Card className={`transition-all ${isNew ? 'border-destructive/50 bg-destructive/5 shadow-sm' : 'border-border'}`}>
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
      <span className="font-semibold truncate">{p.namaPasien || '(Nama tidak tersedia)'}</span>
              <Badge variant={isNew ? 'destructive' : 'secondary'} className="text-[10px] shrink-0">
                {isNew ? 'Baru' : 'Sudah Dilihat'}
              </Badge>
              <Badge variant={p.connectionStatus === 'terhubung' ? 'outline' : 'secondary'} className="text-[10px] shrink-0">
                {p.connectionStatus === 'terhubung' ? 'Terhubung' : 'Belum Terhubung'}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
              <span>No. RM: <span className="font-mono text-foreground">{p.noRM}</span></span>
              {p.episodeNo && <span>Episode Rawat Inap: <EpisodeLink episode={p.episodeNo} /></span>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
              <span>Ruangan Pas: <span className="text-foreground">{p.ruangan || p.ward || '-'}</span></span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
              <span>DPJP: <span className="text-foreground">{p.dpjp || '-'}</span></span>
            </div>
            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              <span><Clock className="w-3 h-3 inline mr-1" />Tanggal Pembuatan KTM: {p.tanggalKTM || '-'}</span>
              <span>Waktu Pembuatan KTM: {p.jamKTM || '-'}</span>
            </div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">
              Pertama muncul: {formatDateTime(p.pertamaKaliMuncul)}
            </div>
          </div>
          <div className="shrink-0">
            {isNew && (
              <Button size="sm" variant="outline" onClick={onMarkSeen} className="gap-1.5 text-xs">
                <Eye className="w-3.5 h-3.5" />
                Tandai Dilihat
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Riwayat Card ──────────────────────────────────────────────────────────────

function RiwayatCard({ patient: p }: { patient: RiwayatKTM }) {
  return (
    <Card className="border-border/60 opacity-80">
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{p.namaPasien || '(Nama tidak tersedia)'}</span>
              <Badge variant="outline" className="text-[10px]">Riwayat</Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              No. RM: <span className="font-mono text-foreground">{p.noRM}</span>
              {p.ruangan && <span className="ml-3">Ruangan Pas: {p.ruangan}</span>}
            </div>
            <div className="text-sm text-muted-foreground">
              Episode Rawat Inap: <EpisodeLink episode={p.episodeNo} />
            </div>
            <div className="text-sm text-muted-foreground">DPJP: {p.dpjp || '-'}</div>
            <div className="text-xs text-muted-foreground">
              Tanggal Pembuatan KTM: {p.tanggalKTM || '-'} · Waktu Pembuatan KTM: {p.jamKTM || '-'}
            </div>
            <div className="text-xs text-muted-foreground/60">
              Muncul: {formatDateTime(p.pertamaKaliMuncul)} ·
              Dihapus: {formatDateTime(p.tanggalHapus)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
