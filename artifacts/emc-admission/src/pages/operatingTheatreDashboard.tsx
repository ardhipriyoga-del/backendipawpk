import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock3, Download, ExternalLink, FileText, LayoutGrid,
  MapPin, RefreshCw, Search, SlidersHorizontal, Table2, UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  DEFAULT_OPERATING_THEATRE_CONFIG,
  exportOperatingTheatreExcel,
  exportOperatingTheatrePdf,
  fetchOperatingTheatre,
  fetchOperatingTheatreInProgress,
  getOperatingTheatreCache,
  getOperatingTheatreCompletedCache,
  getOperatingTheatreInProgressCache,
  getOperatingTheatrePreadmissionCache,
  getOperatingTheatreConfig,
  filterOperatingTheatreCompletedPatients,
  filterOperatingTheatrePatientsByActiveInpatient,
  isInProgressOperatingTheatrePatient,
  saveOperatingTheatreLiveSnapshot,
  saveOperatingTheatrePreadmissionCache,
  saveOperatingTheatreInProgressCache,
  exportOperatingTheatreInProgressExcel,
  exportOperatingTheatreInProgressPdf,
  type OperatingTheatreConfig,
  type OperatingTheatreCompletedPatient,
  type OperatingTheatreInProgressPatient,
  type OperatingTheatrePatient,
  type OperatingTheatreRefreshInterval,
} from '@/lib/operatingTheatre';
import { getNotificationSettings, playNotificationSound, stopNotificationSound } from '@/lib/notificationSettings';
import { getDB, Patient } from '@/lib/db';
import {
  findMatchingPatient,
  getPatientDisplayName,
  normalizePatientIdentifier,
  normalizePatientName,
} from '@/lib/patientIdentity';
import { syncOperatingTheatreActionPlans } from '@/lib/checklist';
import { formatDate, formatDateTime } from '@/lib/utils';
import { showPersistentNotification } from '@/lib/notificationToast';

type ViewMode = 'card' | 'table';
type DateFilter = 'all' | 'today' | 'tomorrow' | 'custom';
type DashboardTab = 'planned' | 'preadmission' | 'inprogress' | 'completed';
type InProgressDateFilter = 'all' | 'today' | 'yesterday';
const PAGE_SIZE = 12;

function display(value: string): string {
  return value?.trim() || '-';
}

function PboButton({ url, stopPropagation = false }: { url?: string; stopPropagation?: boolean }) {
  if (!url) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={event => {
        if (stopPropagation) event.stopPropagation();
        window.open(url, '_blank', 'noopener,noreferrer');
      }}
    >
      <ExternalLink className="w-3.5 h-3.5" /> Lihat PBO
    </Button>
  );
}

function toDateKey(value: string): string {
  const displayedDate = formatDate(value);
  const match = displayedDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

function dateKeyFromOffset(offset: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatLocalCalendarDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function estimatedAdmissionDate(value: string): string {
  const key = toDateKey(value);
  if (!key) return '-';
  const [year, month, day] = key.split('-').map(Number);
  const estimated = new Date(year, month - 1, day);
  estimated.setDate(estimated.getDate() - 1);
  return formatLocalCalendarDate(estimated);
}

function isPreadmissionDueToday(value: string): boolean {
  return activeTabDateKey(value) === dateKeyFromOffset(1);
}

function activeTabDateKey(value: string): string {
  return toDateKey(value);
}

function createdDateKey(value: string): string {
  const parsed = parseCreatedTimestamp(value);
  return parsed === null ? '' : new Date(parsed).toISOString().slice(0, 10);
}

function parseCreatedTimestamp(value: string): number | null {
  const raw = display(value);
  if (raw === '-') return null;
  const match = raw.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const [, dayValue, monthValue, yearValue, hour = '0', minute = '0', second = '0'] = match;
    const yearNumber = Number(yearValue);
    const timestamp = new Date(
      yearNumber < 100 ? yearNumber + 2000 : yearNumber,
      Number(monthValue) - 1,
      Number(dayValue),
      Number(hour),
      Number(minute),
      Number(second),
    ).getTime();
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function sortInProgressPatients(patients: OperatingTheatreInProgressPatient[]): OperatingTheatreInProgressPatient[] {
  return [...patients].sort((a, b) => {
    const created = (parseCreatedTimestamp(b.dibuat) ?? -Infinity) - (parseCreatedTimestamp(a.dibuat) ?? -Infinity);
    if (created) return created;
    return display(a.namaPasien).localeCompare(display(b.namaPasien), 'id');
  });
}

function sortPatients<T extends OperatingTheatrePatient>(patients: T[]): T[] {
  return [...patients].sort((a, b) => {
    const created = (parseCreatedTimestamp(b.dibuat) ?? -Infinity) - (parseCreatedTimestamp(a.dibuat) ?? -Infinity);
    if (created) return created;
    return display(a.namaPasien).localeCompare(display(b.namaPasien), 'id');
  });
}

const dashboardTabs: Array<{ id: DashboardTab; label: string }> = [
  { id: 'planned', label: 'Rencana Tindakan' },
  { id: 'preadmission', label: 'Preadmission' },
  { id: 'inprogress', label: 'In Progress' },
  { id: 'completed', label: 'Selesai Tindakan' },
];

function DashboardTabs({
  activeTab,
  onChange,
  counts,
}: {
  activeTab: DashboardTab;
  onChange: (tab: DashboardTab) => void;
  counts: Record<DashboardTab, number>;
}) {
  const visibleTabs = dashboardTabs.filter(tab => tab.id !== 'preadmission');

  return (
    <nav aria-label="Navigasi Operating Theatre" className="operating-theatre-tabs -mx-1 flex gap-1 overflow-x-auto border-b border-border/80 px-1">
      {visibleTabs.map(tab => (
        <Button
          key={tab.id}
          type="button"
          variant="ghost"
          data-testid={`tab-operating-theatre-${tab.id}`}
          onClick={() => onChange(tab.id)}
          className={`operating-theatre-tab shrink-0 rounded-none border-b-2 px-3 text-sm ${
            activeTab === tab.id
              ? 'border-primary bg-primary/5 font-semibold text-primary'
              : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          }`}
        >
          {tab.label}
          {counts[tab.id] > 0 && (
            <Badge variant={activeTab === tab.id ? 'default' : 'secondary'} className="ml-2 min-w-6 justify-center px-1.5">
              {counts[tab.id]}
            </Badge>
          )}
        </Button>
      ))}
    </nav>
  );
}

function CacheStatus({
  fromCache,
  updatedAt,
  label = 'Data TrakCare',
}: {
  fromCache: boolean;
  updatedAt: number | null;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="status-operating-theatre-data">
      <span className={`h-2 w-2 rounded-full ${fromCache ? 'bg-amber-500' : 'bg-emerald-500'}`} />
      <span>{fromCache ? 'Cache terakhir' : `${label} live`}</span>
      {updatedAt && <span className="text-muted-foreground/70">· Diperbarui {formatDateTime(updatedAt)}</span>}
    </div>
  );
}

function LoadingState({ label = 'Memuat daftar pasien...' }: { label?: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 py-12">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary/50" />
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary/70 [animation-delay:120ms]" />
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:240ms]" />
        </div>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-52 flex-col items-center justify-center px-6 py-12 text-center">
        <div className="mb-3 rounded-full bg-muted p-3 text-muted-foreground">
          <Search className="h-5 w-5" />
        </div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export default function OperatingTheatreDashboard({
  initialTab = 'planned',
  standalonePreadmission = false,
  preadmissionDueTodayOnly = false,
}: {
  initialTab?: DashboardTab;
  standalonePreadmission?: boolean;
  preadmissionDueTodayOnly?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<DashboardTab>(initialTab);
  const [patients, setPatients] = useState<OperatingTheatrePatient[]>([]);
  const [preadmissionPatients, setPreadmissionPatients] = useState<OperatingTheatrePatient[]>([]);
  const [inProgressPatients, setInProgressPatients] = useState<OperatingTheatreInProgressPatient[]>([]);
  const [completedPatients, setCompletedPatients] = useState<OperatingTheatreCompletedPatient[]>([]);
  const [config, setConfig] = useState<OperatingTheatreConfig>(DEFAULT_OPERATING_THEATRE_CONFIG);
  const [loading, setLoading] = useState(true);
  const [inProgressLoading, setInProgressLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inProgressRefreshing, setInProgressRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [inProgressFromCache, setInProgressFromCache] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [inProgressLastUpdated, setInProgressLastUpdated] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customDate, setCustomDate] = useState('');
  const [doctorFilter, setDoctorFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<OperatingTheatrePatient | null>(null);
  const [selectedInProgress, setSelectedInProgress] = useState<OperatingTheatreInProgressPatient | null>(null);
  const [newPatientIds, setNewPatientIds] = useState<string[]>([]);
  const [newInProgressIds, setNewInProgressIds] = useState<string[]>([]);
  const [inProgressDateFilter, setInProgressDateFilter] = useState<InProgressDateFilter>('all');
  const [inProgressDoctorFilter, setInProgressDoctorFilter] = useState('');
  const [inProgressRoomFilter, setInProgressRoomFilter] = useState('');
  const [inProgressPayerFilter, setInProgressPayerFilter] = useState('');
  const [inProgressOperationFilter, setInProgressOperationFilter] = useState('');
  const [inpatientPatients, setInpatientPatients] = useState<Patient[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const linkedInpatient = (patient: OperatingTheatrePatient | OperatingTheatreInProgressPatient) =>
    findMatchingPatient(inpatientPatients, patient);
  const displayPatientName = (patient: OperatingTheatrePatient | OperatingTheatreInProgressPatient) => {
    const linked = linkedInpatient(patient);
    return linked ? getPatientDisplayName(linked) : display(patient.namaPasien);
  };
  const patientMappingLabel = (patient: OperatingTheatrePatient | OperatingTheatreInProgressPatient) =>
    linkedInpatient(patient) ? 'Current' : 'Belum Rawat inap';

  const mappingDiagnostics = (patient: OperatingTheatrePatient, activeRows: Patient[]) => {
    const record = {
      nama: normalizePatientName(patient.namaPasien),
      noRM: normalizePatientIdentifier(patient.noRM),
      episode: normalizePatientIdentifier(patient.episodeNo),
    };
    const candidates = activeRows.map(candidate => {
      const fields = [
        ['nama', record.nama, normalizePatientName(candidate.namaPasien)],
        ['noRM', record.noRM, normalizePatientIdentifier(candidate.noRM)],
        ['episode', record.episode, normalizePatientIdentifier(candidate.episodeNo)],
      ] as const;
      const comparable = fields.filter(([, left, right]) => left && right);
      return {
        candidate,
        matches: comparable.filter(([, left, right]) => left === right).length,
        conflicts: comparable.filter(([, left, right]) => left !== right).map(([field]) => field),
      };
    });
    const best = candidates
      .sort((left, right) => right.matches - left.matches)[0];
    return {
      noRM: patient.noRM,
      episodeNo: patient.episodeNo ?? '',
      namaPasien: patient.namaPasien,
      bestMatchCount: best?.matches ?? 0,
      bestConflicts: best?.conflicts ?? [],
      bestCandidate: best
        ? { noRM: best.candidate.noRM, episodeNo: best.candidate.episodeNo, namaPasien: best.candidate.namaPasien }
        : null,
    };
  };

  useEffect(() => {
    void getDB().then(db => db.getAll('patients')).then(all => {
      setInpatientPatients(all.filter(patient => patient.status === 'aktif'));
    }).catch(() => setInpatientPatients([]));
  }, []);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    const previousIds = new Set(patients.map(patient => patient.id));
    try {
      const nextConfig = await getOperatingTheatreConfig();
      setConfig(nextConfig);
       const live = (await fetchOperatingTheatre(nextConfig)).filter(patient => !isInProgressOperatingTheatrePatient(patient));
       const inpatientRows = await getDB().then(db => db.getAll('patients'));
       const activeInpatientRows = inpatientRows.filter(patient => patient.status === 'aktif');
        const preadmission = live.filter(patient => !findMatchingPatient(activeInpatientRows, patient));
       await syncOperatingTheatreActionPlans(activeInpatientRows, live);
       const activeMapped = live.filter(patient => findMatchingPatient(activeInpatientRows, patient));
        console.info('[TrakCare OT] mapping diagnostic', {
          live: live.length,
          activeInpatient: activeInpatientRows.length,
          activeMapped: activeMapped.length,
          preadmission: preadmission.length,
          unmatched: preadmission.map(patient => mappingDiagnostics(patient, activeInpatientRows)),
        });
        const { cache, completed, newlyCompleted } = await saveOperatingTheatreLiveSnapshot(
           activeMapped,
          nextConfig.endpoint,
          activeMapped,
          activeInpatientRows,
        );
        const preadmissionCache = await saveOperatingTheatrePreadmissionCache(
          preadmission,
          nextConfig.endpoint,
          'live',
          activeMapped,
        );
        const added = cache.patients.filter(patient => !previousIds.has(patient.id)).map(patient => patient.id);
        setPatients(cache.patients);
        setPreadmissionPatients(preadmissionCache.patients);
        setCompletedPatients(completed);
        setFromCache(false);
        setLastUpdated(cache.fetchedAt);
       if (newlyCompleted.length) {
         toast.success(`${newlyCompleted.length} pasien dipindahkan ke Pasien Selesai Tindakan.`);
       }
        if (added.length && previousIds.size) {
          setNewPatientIds(added);
          const notification = await getNotificationSettings();
          if (nextConfig.popupEnabled && notification.popupEnabled) {
           showPersistentNotification('info', `${added.length} pasien baru masuk ke rencana tindakan.`);
            if (nextConfig.soundEnabled && notification.soundEnabled) {
              await playNotificationSound('ktm');
            }
         }
          window.setTimeout(() => setNewPatientIds([]), 5 * 60_000);
        }
    } catch (error: any) {
        const cache = await getOperatingTheatreCache();
        const completedCache = await getOperatingTheatreCompletedCache();
        const inpatientRows = await getDB().then(db => db.getAll('patients')).catch(() => []);
       const preadmissionCache = await getOperatingTheatrePreadmissionCache();
        if (cache || preadmissionCache) {
          const cachedPatients = cache?.patients ?? [];
          setPatients(filterOperatingTheatrePatientsByActiveInpatient(
            cachedPatients.filter(patient => !isInProgressOperatingTheatrePatient(patient)),
            inpatientRows,
          ));
          setPreadmissionPatients(
            (preadmissionCache?.patients ?? []).filter(patient => !findMatchingPatient(
              inpatientRows.filter(row => row.status === 'aktif'),
              patient,
            )),
          );
          setCompletedPatients(filterOperatingTheatreCompletedPatients(completedCache?.patients ?? [], inpatientRows));
        setFromCache(true);
          setLastUpdated(cache?.fetchedAt ?? preadmissionCache?.fetchedAt ?? null);
          toast.warning('Server TrakCare tidak dapat dihubungi. Menampilkan cache terakhir.');
        } else {
          setPatients([]);
          setPreadmissionPatients([]);
          toast.error(error?.message || 'Server TrakCare tidak dapat dihubungi.');
        }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [patients]);

  const loadInProgress = useCallback(async (silent = false) => {
    if (silent) setInProgressRefreshing(true); else setInProgressLoading(true);
    const previousIds = new Set(inProgressPatients.map(patient => patient.id));
    try {
      const nextConfig = await getOperatingTheatreConfig();
      setConfig(nextConfig);
      const live = await fetchOperatingTheatreInProgress(nextConfig);
      const cache = await saveOperatingTheatreInProgressCache(live, nextConfig.endpoint);
      const added = live.filter(patient => !previousIds.has(patient.id)).map(patient => patient.id);
      setInProgressPatients(live);
      setInProgressFromCache(false);
      setInProgressLastUpdated(cache.fetchedAt);
      if (added.length && previousIds.size) {
        setNewInProgressIds(added);
        const notification = await getNotificationSettings();
        if (nextConfig.popupEnabled && notification.popupEnabled) {
          showPersistentNotification('info', `${added.length} pasien baru masuk status In Progress.`);
          if (nextConfig.soundEnabled && notification.soundEnabled) await playNotificationSound('ktm');
        }
        window.setTimeout(() => setNewInProgressIds([]), 5 * 60_000);
      }
    } catch (error: any) {
      const cache = await getOperatingTheatreInProgressCache();
      if (cache) {
        setInProgressPatients(cache.patients);
        setInProgressFromCache(true);
        setInProgressLastUpdated(cache.fetchedAt);
        toast.warning('Server TrakCare tidak dapat dihubungi. Menampilkan cache In Progress terakhir.');
      } else {
        setInProgressPatients([]);
        toast.error(error?.message || 'Server TrakCare tidak dapat dihubungi.');
      }
    } finally {
      setInProgressLoading(false);
      setInProgressRefreshing(false);
    }
  }, [inProgressPatients]);

  useEffect(() => {
    void load();
    void loadInProgress();
  }, []); // Initial load only; auto-refresh below calls the stable action.

  useEffect(() => () => {
    stopNotificationSound();
  }, []);

  useEffect(() => {
    if (config.refreshInterval === 'manual') return;
    const timer = window.setInterval(() => void load(true), Number(config.refreshInterval) * 1000);
    return () => window.clearInterval(timer);
  }, [config.refreshInterval, load]);

  useEffect(() => {
    if (config.refreshInterval === 'manual') return;
    const timer = window.setInterval(() => void loadInProgress(true), Number(config.refreshInterval) * 1000);
    return () => window.clearInterval(timer);
  }, [config.refreshInterval, loadInProgress]);

  const plannedSource = activeTab === 'preadmission'
    ? preadmissionPatients.filter(patient => !preadmissionDueTodayOnly || isPreadmissionDueToday(patient.tanggalOperasi))
    : patients;
  const doctors = useMemo(() => [...new Set(plannedSource.map(patient => patient.dpjp).filter(Boolean))].sort(), [plannedSource]);
  const rooms = useMemo(() => [...new Set(plannedSource.map(patient => patient.ruangOperasi).filter(Boolean))].sort(), [plannedSource]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const targetDate = dateFilter === 'today' ? dateKeyFromOffset(0) : dateFilter === 'tomorrow' ? dateKeyFromOffset(1) : dateFilter === 'custom' ? customDate : '';
    return sortPatients(plannedSource).filter(patient => {
      const matchesSearch = !query || [patient.noRM, patient.namaPasien, patient.dpjp, patient.ruangOperasi].some(value => value.toLowerCase().includes(query));
      const matchesDate = !targetDate || toDateKey(patient.tanggalOperasi) === targetDate;
      return matchesSearch && matchesDate && (!doctorFilter || patient.dpjp === doctorFilter) && (!roomFilter || patient.ruangOperasi === roomFilter);
    });
  }, [plannedSource, search, dateFilter, customDate, doctorFilter, roomFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const inProgressDoctors = useMemo(() => [...new Set(inProgressPatients.map(patient => patient.dpjp).filter(Boolean))].sort(), [inProgressPatients]);
  const inProgressRooms = useMemo(() => [...new Set(inProgressPatients.map(patient => patient.ruangOperasi).filter(Boolean))].sort(), [inProgressPatients]);
  const inProgressPayers = useMemo(() => [...new Set(inProgressPatients.map(patient => patient.penjamin).filter(Boolean))].sort(), [inProgressPatients]);
  const inProgressOperations = useMemo(() => [...new Set(inProgressPatients.map(patient => patient.rencanaTindakan).filter(Boolean))].sort(), [inProgressPatients]);
  const inProgressFiltered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const targetDate = inProgressDateFilter === 'today' ? dateKeyFromOffset(0) : inProgressDateFilter === 'yesterday' ? dateKeyFromOffset(-1) : '';
    return sortInProgressPatients(inProgressPatients).filter(patient => {
      const searchable = [patient.namaPasien, patient.dpjp, patient.ruangOperasi, patient.penjamin, patient.rencanaTindakan];
      const matchesSearch = !query || searchable.some(value => value.toLowerCase().includes(query));
      const matchesDate = !targetDate || createdDateKey(patient.dibuat) === targetDate;
      return matchesSearch && matchesDate
        && (!inProgressDoctorFilter || patient.dpjp === inProgressDoctorFilter)
        && (!inProgressRoomFilter || patient.ruangOperasi === inProgressRoomFilter)
        && (!inProgressPayerFilter || patient.penjamin === inProgressPayerFilter)
        && (!inProgressOperationFilter || patient.rencanaTindakan === inProgressOperationFilter);
    });
  }, [inProgressPatients, search, inProgressDateFilter, inProgressDoctorFilter, inProgressRoomFilter, inProgressPayerFilter, inProgressOperationFilter]);
  const inProgressVisible = inProgressFiltered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const inProgressTotalPages = Math.max(1, Math.ceil(inProgressFiltered.length / PAGE_SIZE));
  const activeRooms = new Set(inProgressPatients.map(patient => patient.ruangOperasi).filter(Boolean)).size;
  const activeDoctors = new Set(inProgressPatients.map(patient => patient.dpjp).filter(Boolean)).size;
  const activePayers = new Set(inProgressPatients.map(patient => patient.penjamin).filter(Boolean)).size;

  useEffect(() => setPage(1), [activeTab, search, dateFilter, customDate, doctorFilter, roomFilter, viewMode, inProgressDateFilter, inProgressDoctorFilter, inProgressRoomFilter, inProgressPayerFilter, inProgressOperationFilter]);

  const refresh = () => {
    const scroll = scrollRef.current?.scrollTop ?? 0;
    const request = activeTab === 'inprogress' ? loadInProgress(true) : load(true);
    void request.finally(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scroll;
    });
  };

  if (activeTab === 'inprogress') {
    return (
      <div ref={scrollRef} className="operating-theatre-shell min-h-[100dvh] p-4 sm:p-6">
        <div className="mx-auto max-w-[1500px] space-y-5">
          <div className="operating-theatre-header flex flex-wrap items-start justify-between gap-4 rounded-xl p-4 sm:p-5">
            <div>
              <div className="flex items-center gap-3">
                <span className="rounded-lg bg-primary/10 p-2 text-primary"><Clock3 className="h-5 w-5" /></span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Pasien In Progress</h1>
                    <Badge variant="secondary">{inProgressFiltered.length} pasien</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Monitoring pasien yang sedang dalam proses tindakan operasi.</p>
                </div>
              </div>
              <div className="mt-3 pl-0 sm:pl-12"><CacheStatus fromCache={inProgressFromCache} updatedAt={inProgressLastUpdated} /></div>
          </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button data-testid="button-refresh-operating-theatre" variant="outline" size="sm" onClick={refresh} disabled={inProgressRefreshing} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${inProgressRefreshing ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button data-testid="button-export-operating-theatre-excel" variant="outline" size="sm" onClick={() => void exportOperatingTheatreInProgressExcel(inProgressFiltered)} disabled={!inProgressFiltered.length} className="gap-2">
              <Download className="w-4 h-4" /> Excel
            </Button>
            <Button data-testid="button-export-operating-theatre-pdf" variant="outline" size="sm" onClick={() => exportOperatingTheatreInProgressPdf(inProgressFiltered)} disabled={!inProgressFiltered.length} className="gap-2">
              <FileText className="w-4 h-4" /> PDF
            </Button>
          </div>
          {!standalonePreadmission && (
            <DashboardTabs
              activeTab={activeTab}
              onChange={setActiveTab}
              counts={{ planned: patients.length, preadmission: preadmissionPatients.length, inprogress: inProgressPatients.length, completed: completedPatients.length }}
            />
          )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Total In Progress', inProgressPatients.length],
            ['Ruang Operasi Aktif', activeRooms],
            ['DPJP Aktif', activeDoctors],
            ['Jumlah Penjamin', activePayers],
          ].map(([label, value]) => (
            <Card key={String(label)} className="border-border/70"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tracking-tight">{value}</p></CardContent></Card>
          ))}
        </div>

        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari nama, DPJP, ruang, penjamin, tindakan..." className="pl-9" />
              </div>
              <select value={inProgressDateFilter} onChange={event => setInProgressDateFilter(event.target.value as InProgressDateFilter)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">Semua Data</option>
                <option value="today">Hari Ini</option>
                <option value="yesterday">Kemarin</option>
              </select>
              <select value={inProgressDoctorFilter} onChange={event => setInProgressDoctorFilter(event.target.value)} className="h-9 max-w-[200px] rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Semua DPJP</option>{inProgressDoctors.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
              <select value={inProgressRoomFilter} onChange={event => setInProgressRoomFilter(event.target.value)} className="h-9 max-w-[200px] rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Semua Ruang Operasi</option>{inProgressRooms.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
              <select value={inProgressPayerFilter} onChange={event => setInProgressPayerFilter(event.target.value)} className="h-9 max-w-[200px] rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Semua Penjamin</option>{inProgressPayers.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
              <select value={inProgressOperationFilter} onChange={event => setInProgressOperationFilter(event.target.value)} className="h-9 max-w-[220px] rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Semua Tindakan</option>{inProgressOperations.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
              <div className="flex border rounded-md overflow-hidden ml-auto">
                <Button variant={viewMode === 'card' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('card')} className="rounded-none gap-1"><LayoutGrid className="w-4 h-4" /> Card</Button>
                <Button variant={viewMode === 'table' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('table')} className="rounded-none gap-1"><Table2 className="w-4 h-4" /> Tabel</Button>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span><SlidersHorizontal className="w-3.5 h-3.5 inline mr-1" />Filter aktif: {inProgressFiltered.length} dari {inProgressPatients.length}</span>
              <span>Auto refresh: {config.refreshInterval === 'manual' ? 'Manual' : `${config.refreshInterval} detik`}</span>
            </div>
          </CardContent>
        </Card>

        {inProgressLoading ? (
          <LoadingState label="Memuat pasien In Progress..." />
        ) : !inProgressVisible.length ? (
          <EmptyState title="Tidak ada pasien In Progress" description="Belum ada pasien yang sesuai dengan filter saat ini." />
        ) : viewMode === 'card' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {inProgressVisible.map(patient => (
              <Card key={patient.id} data-testid={`card-in-progress-${patient.id}`} onClick={() => setSelectedInProgress(patient)} className={`operating-theatre-card cursor-pointer ${newInProgressIds.includes(patient.id) ? 'ring-2 ring-emerald-400 animate-pulse' : ''}`}>
                <CardHeader className="pb-3"><CardTitle className="text-base">{display(patient.namaPasien)}</CardTitle><p className="text-xs text-muted-foreground mt-1">{display(patient.dibuat)}</p></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {[
                    ['Rencana Tindakan', patient.rencanaTindakan],
                    ['Ruang Operasi', patient.ruangOperasi],
                    ['DPJP', patient.dpjp],
                    ['Penjamin', patient.penjamin],
                    ['Keterangan', patient.keterangan],
                  ].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{display(value)}</p></div>)}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="overflow-hidden border-border/70"><div className="overflow-x-auto"><table className="operating-theatre-table w-full min-w-[850px] text-sm">
            <thead className="bg-muted/60 text-left"><tr>{['Dibuat', 'Nama Pasien', 'Rencana Tindakan', 'Ruang Operasi', 'DPJP', 'Penjamin', 'Keterangan'].map(header => <th key={header} className="px-4 py-3 font-semibold whitespace-nowrap">{header}</th>)}</tr></thead>
            <tbody>{inProgressVisible.map(patient => <tr key={patient.id} onClick={() => setSelectedInProgress(patient)} className={`border-t cursor-pointer hover:bg-muted/30 ${newInProgressIds.includes(patient.id) ? 'bg-emerald-50 dark:bg-emerald-950/20' : ''}`}>
              {[patient.dibuat, patient.namaPasien, patient.rencanaTindakan, patient.ruangOperasi, patient.dpjp, patient.penjamin, patient.keterangan].map((value, index) => <td key={index} className={`px-4 py-3 ${index === 1 ? 'font-medium' : ''}`}>{display(value)}</td>)}
            </tr>)}</tbody>
          </table></div></Card>
        )}

        {inProgressTotalPages > 1 && <div className="flex items-center justify-center gap-3"><Button variant="outline" size="icon" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page === 1}><ChevronLeft className="w-4 h-4" /></Button><span className="text-sm">Halaman {page} dari {inProgressTotalPages}</span><Button variant="outline" size="icon" onClick={() => setPage(value => Math.min(inProgressTotalPages, value + 1))} disabled={page === inProgressTotalPages}><ChevronRight className="w-4 h-4" /></Button></div>}

        <Dialog open={Boolean(selectedInProgress)} onOpenChange={() => setSelectedInProgress(null)}>
          <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Detail Pasien In Progress</DialogTitle></DialogHeader>
            {selectedInProgress && <div className="space-y-4">
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-4"><p className="text-lg font-bold">{displayPatientName(selectedInProgress)}</p><p className="text-sm text-muted-foreground">Status: In Progress · {patientMappingLabel(selectedInProgress)}</p></div>
              <div className="grid grid-cols-2 gap-4 text-sm">{[
                ['Dibuat', selectedInProgress.dibuat], ['Rencana Tindakan', selectedInProgress.rencanaTindakan],
                ['Ruang Operasi', selectedInProgress.ruangOperasi], ['DPJP', selectedInProgress.dpjp],
                ['Penjamin', selectedInProgress.penjamin], ['Keterangan', selectedInProgress.keterangan],
              ].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{display(value)}</p></div>)}</div>
              {Object.keys(selectedInProgress.extraFields).length > 0 && <div className="border-t pt-3"><p className="text-sm font-semibold mb-2">Informasi Tambahan</p><div className="space-y-2 text-sm">{Object.entries(selectedInProgress.extraFields).map(([key, value]) => <div key={key} className="flex justify-between gap-4"><span className="text-muted-foreground">{key}</span><span className="text-right">{display(String(value))}</span></div>)}</div></div>}
            </div>}
          </DialogContent>
        </Dialog>
      </div>
      </div>
    );
  }

  if (activeTab === 'completed') {
    const query = search.trim().toLowerCase();
    const completedFiltered = sortPatients(completedPatients).filter(patient => {
      const matchesSearch = !query || [patient.noRM, patient.namaPasien, patient.dpjp, patient.ruangOperasi].some(value => value.toLowerCase().includes(query));
      const targetDate = dateFilter === 'today' ? dateKeyFromOffset(0) : dateFilter === 'tomorrow' ? dateKeyFromOffset(1) : dateFilter === 'custom' ? customDate : '';
      const matchesDate = !targetDate || toDateKey(patient.tanggalOperasi) === targetDate;
      return matchesSearch && matchesDate && (!doctorFilter || patient.dpjp === doctorFilter) && (!roomFilter || patient.ruangOperasi === roomFilter);
    });
    const completedTotalPages = Math.max(1, Math.ceil(completedFiltered.length / PAGE_SIZE));
    const completedVisible = completedFiltered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    return (
      <div ref={scrollRef} className="operating-theatre-shell min-h-[100dvh] p-4 sm:p-6">
       <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="operating-theatre-header flex flex-wrap items-start justify-between gap-4 rounded-xl p-4 sm:p-5">
          <div>
            <div className="flex items-center gap-3">
              <span className="rounded-lg bg-primary/10 p-2 text-primary"><Clock3 className="h-5 w-5" /></span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Pasien Selesai Tindakan</h1>
                  <Badge variant="secondary">{completedFiltered.length} pasien</Badge>
                </div>
                 <p className="mt-1 text-sm text-muted-foreground">Hanya pasien yang terpetakan ke rawat inap aktif.</p>
              </div>
            </div>
            <div className="mt-3 pl-0 text-xs text-muted-foreground sm:pl-12"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500" />Riwayat tersimpan di perangkat ini</div>
          </div>
          <Button data-testid="button-refresh-operating-theatre" variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh Rencana
          </Button>
        </div>

       {!standalonePreadmission && (
         <DashboardTabs
           activeTab={activeTab}
           onChange={setActiveTab}
           counts={{ planned: patients.length, preadmission: preadmissionPatients.length, inprogress: inProgressPatients.length, completed: completedPatients.length }}
         />
       )}

        <Card className="border-border/70 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari No. RM, nama, DPJP, ruang operasi..." className="pl-9" />
              </div>
              <select value={dateFilter} onChange={event => setDateFilter(event.target.value as DateFilter)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">Semua Data</option><option value="today">Hari Ini</option><option value="tomorrow">Besok</option><option value="custom">Tanggal Operasi</option>
              </select>
              {dateFilter === 'custom' && <Input type="date" value={customDate} onChange={event => setCustomDate(event.target.value)} className="w-auto" />}
              <select value={doctorFilter} onChange={event => setDoctorFilter(event.target.value)} className="h-9 max-w-[220px] rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Semua DPJP</option>{doctors.map(doctor => <option key={doctor} value={doctor}>{doctor}</option>)}
              </select>
              <select value={roomFilter} onChange={event => setRoomFilter(event.target.value)} className="h-9 max-w-[220px] rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Semua Ruang Operasi</option>{rooms.map(room => <option key={room} value={room}>{room}</option>)}
              </select>
            </div>
            <div className="text-xs text-muted-foreground">Filter aktif: {completedFiltered.length} dari {completedPatients.length}</div>
          </CardContent>
        </Card>

        {loading ? (
          <LoadingState label="Memuat riwayat tindakan..." />
        ) : !completedVisible.length ? (
          <EmptyState title="Belum ada pasien selesai tindakan" description="Riwayat tindakan yang tersimpan di perangkat akan tampil di sini." />
        ) : viewMode === 'card' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {completedVisible.map(patient => (
              <Card key={`${patient.id}-${patient.selesaiPada}`} className="operating-theatre-card border-emerald-200 dark:border-emerald-900">
                <CardHeader className="pb-3">
                  <div className="flex justify-between gap-3">
                    <div><CardTitle className="text-base">{displayPatientName(patient)}</CardTitle><p className="text-xs text-muted-foreground mt-1">No. RM: {display(patient.noRM)} · {patientMappingLabel(patient)}</p></div>
                    <Badge variant="outline">Selesai</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-muted-foreground">Tanggal Operasi</p><p className="font-medium">{formatDate(patient.tanggalOperasi)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Selesai Dipantau</p><p className="font-medium">{formatDateTime(patient.selesaiPada)}</p></div>
                  <div><p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />Ruang Operasi</p><p className="font-medium">{display(patient.ruangOperasi)}</p></div>
                  <div><p className="text-xs text-muted-foreground flex items-center gap-1"><UserRound className="w-3 h-3" />DPJP</p><p className="font-medium">{display(patient.dpjp)}</p></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="overflow-hidden border-border/70"><div className="overflow-x-auto"><table className="operating-theatre-table w-full min-w-[760px] text-sm">
            <thead className="bg-muted/60 text-left"><tr>{['No. RM', 'Nama Pasien', 'Tanggal Operasi', 'Selesai Dipantau', 'Ruang Operasi', 'DPJP'].map(header => <th key={header} className="px-4 py-3 font-semibold whitespace-nowrap">{header}</th>)}</tr></thead>
            <tbody>{completedVisible.map(patient => <tr key={`${patient.id}-${patient.selesaiPada}`} className="border-t hover:bg-muted/30">
              <td className="px-4 py-3">{display(patient.noRM)}</td><td className="px-4 py-3 font-medium">{displayPatientName(patient)}</td><td className="px-4 py-3">{formatDate(patient.tanggalOperasi)}</td><td className="px-4 py-3">{formatDateTime(patient.selesaiPada)}</td><td className="px-4 py-3">{display(patient.ruangOperasi)}</td><td className="px-4 py-3">{display(patient.dpjp)}</td>
            </tr>)}</tbody>
          </table></div></Card>
        )}

        {completedTotalPages > 1 && <div className="flex items-center justify-center gap-3"><Button variant="outline" size="icon" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page === 1}><ChevronLeft className="w-4 h-4" /></Button><span className="text-sm">Halaman {page} dari {completedTotalPages}</span><Button variant="outline" size="icon" onClick={() => setPage(value => Math.min(completedTotalPages, value + 1))} disabled={page === completedTotalPages}><ChevronRight className="w-4 h-4" /></Button></div>}
       </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="operating-theatre-shell min-h-[100dvh] p-4 sm:p-6">
      <div className="mx-auto max-w-[1500px] space-y-5">
      <div className="operating-theatre-header flex flex-wrap items-start justify-between gap-4 rounded-xl p-4 sm:p-5">
        <div>
          <div className="flex items-center gap-2">
            {activeTab === 'preadmission' ? <UserRound className="w-6 h-6 text-primary" /> : <CalendarDays className="w-6 h-6 text-primary" />}
            <h1 className="text-2xl font-bold tracking-tight">
              {activeTab === 'preadmission'
                ? (preadmissionDueTodayOnly ? 'Pasien Masuk Hari Ini' : 'Pasien Preadmission')
                : 'Pasien Rencana Tindakan'}
            </h1>
            <Badge variant="secondary">{filtered.length} pasien</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
             {activeTab === 'preadmission'
               ? (preadmissionDueTodayOnly
                 ? 'Pasien Preadmission dengan perkiraan masuk rawat inap hari ini (H-1 dari tanggal operasi).'
                 : 'Pasien yang diperkirakan masuk rawat inap H-1 sebelum tanggal operasi dan belum berstatus aktif.')
              : 'Monitoring rencana tindakan operasi dari TrakCare secara real-time.'}
          </p>
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <span className={`w-2 h-2 rounded-full ${fromCache ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            {fromCache ? 'Data dari cache terakhir' : 'Data live dari TrakCare'}
            {lastUpdated && <> · {formatDateTime(lastUpdated)}</>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => void exportOperatingTheatreExcel(filtered, activeTab === 'preadmission' ? (preadmissionDueTodayOnly ? 'Pasien Masuk Hari Ini' : 'Pasien Preadmission') : 'Pasien Rencana Tindakan')} disabled={!filtered.length} className="gap-2">
            <Download className="w-4 h-4" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportOperatingTheatrePdf(filtered, activeTab === 'preadmission' ? (preadmissionDueTodayOnly ? 'Pasien Masuk Hari Ini' : 'Pasien Preadmission') : 'Pasien Rencana Tindakan')} disabled={!filtered.length} className="gap-2">
            <FileText className="w-4 h-4" /> PDF
          </Button>
        </div>
      </div>

      {standalonePreadmission && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card p-2 shadow-sm" aria-label="Navigasi Preadmission">
          <Link href="/pasien-preadmission">
            <Button
              type="button"
              variant={!preadmissionDueTodayOnly ? 'default' : 'ghost'}
              size="sm"
              className="gap-2"
            >
              <UserRound className="h-4 w-4" /> Semua Preadmission
            </Button>
          </Link>
          <Link href="/pasien-preadmission/masuk-hari-ini">
            <Button
              type="button"
              variant={preadmissionDueTodayOnly ? 'default' : 'ghost'}
              size="sm"
              className="gap-2"
            >
              <Clock3 className="h-4 w-4" /> Masuk Hari Ini
              {preadmissionPatients.filter(patient => isPreadmissionDueToday(patient.tanggalOperasi)).length > 0 && (
                <Badge variant={preadmissionDueTodayOnly ? 'secondary' : 'outline'} className="ml-1 min-w-5 justify-center px-1">
                  {preadmissionPatients.filter(patient => isPreadmissionDueToday(patient.tanggalOperasi)).length}
                </Badge>
              )}
            </Button>
          </Link>
        </div>
      )}

      {!standalonePreadmission && (
        <DashboardTabs
          activeTab={activeTab}
          onChange={setActiveTab}
          counts={{ planned: patients.length, preadmission: preadmissionPatients.length, inprogress: inProgressPatients.length, completed: completedPatients.length }}
        />
      )}

      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari No. RM, nama, DPJP, ruang operasi..." className="pl-9" />
            </div>
            <select value={dateFilter} onChange={event => setDateFilter(event.target.value as DateFilter)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="all">Semua Data</option>
              <option value="today">Hari Ini</option>
              <option value="tomorrow">Besok</option>
              <option value="custom">Tanggal Operasi</option>
            </select>
            {dateFilter === 'custom' && <Input type="date" value={customDate} onChange={event => setCustomDate(event.target.value)} className="w-auto" />}
            <select value={doctorFilter} onChange={event => setDoctorFilter(event.target.value)} className="h-9 max-w-[220px] rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Semua DPJP</option>
              {doctors.map(doctor => <option key={doctor} value={doctor}>{doctor}</option>)}
            </select>
            <select value={roomFilter} onChange={event => setRoomFilter(event.target.value)} className="h-9 max-w-[220px] rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Semua Ruang Operasi</option>
              {rooms.map(room => <option key={room} value={room}>{room}</option>)}
            </select>
            <div className="flex border rounded-md overflow-hidden ml-auto">
              <Button variant={viewMode === 'card' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('card')} className="rounded-none gap-1"><LayoutGrid className="w-4 h-4" /> Card</Button>
              <Button variant={viewMode === 'table' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('table')} className="rounded-none gap-1"><Table2 className="w-4 h-4" /> Tabel</Button>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span><SlidersHorizontal className="w-3.5 h-3.5 inline mr-1" />Filter aktif: {filtered.length} dari {plannedSource.length}</span>
            <span>Auto refresh: {config.refreshInterval === 'manual' ? 'Manual' : `${config.refreshInterval} detik`}</span>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <LoadingState />
      ) : !visible.length ? (
        <EmptyState
          title={activeTab === 'preadmission'
            ? (preadmissionDueTodayOnly ? 'Tidak ada pasien masuk hari ini' : 'Tidak ada pasien preadmission')
            : 'Tidak ada pasien rencana tindakan'}
          description={preadmissionDueTodayOnly
            ? 'Tidak ada pasien Preadmission dengan perkiraan masuk rawat inap hari ini.'
            : 'Belum ada pasien yang sesuai dengan filter saat ini.'}
        />
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(patient => (
            <Card key={patient.id} data-testid={`card-planned-${patient.id}`} onClick={() => setSelected(patient)} className={`operating-theatre-card cursor-pointer ${newPatientIds.includes(patient.id) ? 'ring-2 ring-emerald-400 animate-pulse' : ''}`}>
              <CardHeader className="pb-3">
                <div className="flex justify-between gap-3">
                  <div><CardTitle className="text-base">{displayPatientName(patient)}</CardTitle><p className="text-xs text-muted-foreground mt-1">No. RM: {display(patient.noRM)} · {patientMappingLabel(patient)}</p></div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline">{display(patient.jamOperasi)}</Badge>
                    {activeTab === 'preadmission' && isPreadmissionDueToday(patient.tanggalOperasi) && <Badge variant="destructive">Masuk Hari Ini</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Tanggal Operasi</p><p className="font-medium">{formatDate(patient.tanggalOperasi)}</p></div>
                {activeTab === 'preadmission' && <div><p className="text-xs text-muted-foreground">Perkiraan Masuk Rawat Inap</p><p className="font-medium">{estimatedAdmissionDate(patient.tanggalOperasi)}</p></div>}
                <div><p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />Ruang Operasi</p><p className="font-medium">{display(patient.ruangOperasi)}</p></div>
                <div className="col-span-2"><p className="text-xs text-muted-foreground flex items-center gap-1"><UserRound className="w-3 h-3" />DPJP</p><p className="font-medium">{display(patient.dpjp)}</p></div>
                <div className="col-span-2 pt-1"><PboButton url={patient.pboUrl} stopPropagation /></div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden border-border/70">
          <div className="overflow-x-auto">
            <table className="operating-theatre-table w-full min-w-[900px] text-sm">
              <thead className="bg-muted/60 text-left"><tr>{['No. RM', 'Nama Pasien', 'Tanggal Operasi', ...(activeTab === 'preadmission' ? ['Perkiraan Masuk'] : []), 'Jam Operasi', 'Ruang Operasi', 'DPJP', 'Aksi'].map(header => <th key={header} className="px-4 py-3 font-semibold whitespace-nowrap">{header}</th>)}</tr></thead>
              <tbody>{visible.map(patient => <tr key={patient.id} onClick={() => setSelected(patient)} className={`border-t cursor-pointer hover:bg-muted/30 ${newPatientIds.includes(patient.id) ? 'bg-emerald-50 dark:bg-emerald-950/20' : ''}`}><td className="px-4 py-3">{display(patient.noRM)}</td><td className="px-4 py-3 font-medium">{displayPatientName(patient)}</td><td className="px-4 py-3">{formatDate(patient.tanggalOperasi)}</td>{activeTab === 'preadmission' && <td className="px-4 py-3">{estimatedAdmissionDate(patient.tanggalOperasi)}</td>}<td className="px-4 py-3">{display(patient.jamOperasi)}</td><td className="px-4 py-3">{display(patient.ruangOperasi)}</td><td className="px-4 py-3">{display(patient.dpjp)}</td><td className="px-4 py-3" onClick={event => event.stopPropagation()}><PboButton url={patient.pboUrl} /></td></tr>)}</tbody>
            </table>
          </div>
        </Card>
      )}

      {totalPages > 1 && <div className="flex items-center justify-center gap-3"><Button variant="outline" size="icon" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page === 1}><ChevronLeft className="w-4 h-4" /></Button><span className="text-sm">Halaman {page} dari {totalPages}</span><Button variant="outline" size="icon" onClick={() => setPage(value => Math.min(totalPages, value + 1))} disabled={page === totalPages}><ChevronRight className="w-4 h-4" /></Button></div>}

      <Dialog open={Boolean(selected)} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{activeTab === 'preadmission' ? (preadmissionDueTodayOnly ? 'Detail Pasien Masuk Hari Ini' : 'Detail Pasien Preadmission') : 'Detail Pasien Rencana Tindakan'}</DialogTitle></DialogHeader>
          {selected && <div className="space-y-4">
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-4"><p className="text-lg font-bold">{displayPatientName(selected)}</p><p className="text-sm text-muted-foreground">No. RM: {display(selected.noRM)} · {patientMappingLabel(selected)}</p></div>
            <div className="grid grid-cols-2 gap-4 text-sm">{[['DPJP', selected.dpjp], ['Ruang Operasi', selected.ruangOperasi], ['Tanggal Operasi', formatDate(selected.tanggalOperasi)], ...(activeTab === 'preadmission' ? [['Perkiraan Masuk Rawat Inap', estimatedAdmissionDate(selected.tanggalOperasi)]] : []), ['Jam Operasi', selected.jamOperasi]].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{display(value)}</p></div>)}</div>
            <PboButton url={selected.pboUrl} />
            {Object.keys(selected.extraFields).length > 0 && <div className="border-t pt-3"><p className="text-sm font-semibold mb-2">Informasi Tambahan</p><div className="space-y-2 text-sm">{Object.entries(selected.extraFields).map(([key, value]) => <div key={key} className="flex justify-between gap-4"><span className="text-muted-foreground">{key}</span><span className="text-right">{display(String(value))}</span></div>)}</div></div>}
          </div>}
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}