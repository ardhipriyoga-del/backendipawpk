import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/context/AuthContext';
import {
  DEFAULT_OPERATING_THEATRE_CONFIG,
  fetchOperatingTheatre,
  fetchOperatingTheatreInProgress,
  getOperatingTheatreConfig,
  isInProgressOperatingTheatrePatient,
  saveOperatingTheatreLiveSnapshot,
  saveOperatingTheatrePreadmissionCache,
  type OperatingTheatreConfig,
} from '@/lib/operatingTheatre';
import { apiUrl, getApiBaseUrl, hasTrakCareProxy, isGasHosted } from '@/lib/apiConfig';
import { parseKTMPatients } from '@/lib/ktmParser';
import {
  getNotificationSettings,
  NOTIFICATION_KIND_META,
  playNotificationSound,
  stopNotificationSound,
} from '@/lib/notificationSettings';
import {
  addNotification,
  claimNotificationFingerprint,
  seedNotificationFingerprintsFromHistory,
} from '@/lib/notificationCenter';
import { getDB } from '@/lib/db';
import { findMatchingPatient } from '@/lib/patientIdentity';
import { formatDate } from '@/lib/utils';
import { showPersistentNotification } from '@/lib/notificationToast';
import {
  ensureDefaultChecklistMasters,
  syncChecklistPatients,
  syncOperatingTheatreActionPlans,
} from '@/lib/checklist';
import { requestChecklistFilter } from '@/lib/checklistNavigation';
import { fetchIGDData, fetchTrakCareViaGas, getEndpoints, type RawIGDPatient } from '@/lib/trakcareClient';

const KTM_DIRECT_URL = 'https://appsprn.emc.id/trakcare/dashboard/list/trakcareANLT/type/ktm/hospital/4?ward=';
const KTM_GAS_URL = 'https://apps.emc.id/trakcare/dashboard/list/trakcareANLT/type/ktm/hospital/4?ward=';
const POLL_INTERVAL_MS = 45_000;

interface GlobalKtmPatient {
  noRM: string;
  episodeNo: string;
  namaPasien: string;
  tanggalJamKTM: string;
}

type Snapshot = Set<string> | null;

function ktmKey(patient: GlobalKtmPatient): string {
  return [
    eventPart(patient.noRM).replace(/[^a-z0-9]/g, ''),
    eventPart(patient.episodeNo).replace(/[^a-z0-9]/g, ''),
    eventPart(patient.namaPasien).replace(/[^a-z0-9]/g, ''),
  ].join('|');
}

function eventPart(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function eventDatePart(value: unknown): string {
  const raw = eventPart(value);
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmy) {
    const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return raw;
}

function plannedKey(patient: {
  id: string;
  noRM?: string;
  episodeNo?: string;
  namaPasien?: string;
  tanggalOperasi?: string;
  jamOperasi?: string;
  ruangOperasi?: string;
  dibuat?: string;
  rencanaTindakan?: string;
}): string {
  const noRM = eventPart(patient.noRM);
  const episodeNo = eventPart(patient.episodeNo);
  const name = eventPart(patient.namaPasien);
  const identity = noRM && episodeNo
    ? `rm-episode:${noRM}:${episodeNo}`
    : noRM && name
      ? `rm-name:${noRM}:${name}`
      : episodeNo && name
        ? `episode-name:${episodeNo}:${name}`
        : `name:${name || eventPart(patient.id)}`;
  const actionDate = eventDatePart(patient.tanggalOperasi);
  const actionTime = eventPart(patient.jamOperasi);
  const action = eventPart(patient.rencanaTindakan);
  // Room and created-at values are presentation/source-refresh fields. They
  // must not turn the same operation into a new notification.
  return [identity, actionDate, actionTime, action].join('|');
}

function igdPatientKey(patient: RawIGDPatient): string {
  const noRM = eventPart(patient.noRM).replace(/[^a-z0-9]/g, '');
  const name = eventPart(patient.nama).replace(/[^a-z0-9]/g, '');
  // Timer, color, and location are live display fields and change when the
  // TrakCare page refreshes. They must never define notification identity.
  return noRM || name;
}

function hasSprI(patient: RawIGDPatient): boolean {
  return Boolean(patient.timerTransfer && patient.timerTransfer !== '--');
}

function billingCycleHariRawat(admissionDate: string, now = Date.now()): number | null {
  const admission = new Date(admissionDate).getTime();
  if (!Number.isFinite(admission)) return null;
  const days = Math.floor((now - admission) / 86400000);
  return days >= 2 && days % 2 === 0 ? days : null;
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

function isPreadmissionDueToday(tanggalOperasi: string): boolean {
  return Boolean(tanggalOperasi) && toDateKey(tanggalOperasi) === dateKeyFromOffset(1);
}

async function fetchDirectKtm(): Promise<GlobalKtmPatient[]> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(KTM_DIRECT_URL, {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`KTM merespons HTTP ${response.status}.`);
    return parseKTMPatients(await response.text());
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchKtmForNotifications(): Promise<GlobalKtmPatient[]> {
  if (isGasHosted()) {
    const response = await fetchTrakCareViaGas('ktm', KTM_GAS_URL);
    return parseKTMPatients(response.body).map(patient => ({
      ...patient,
      tanggalJamKTM: patient.tanggalJamKTM,
    }));
  }

  if (hasTrakCareProxy()) {
    try {
      const response = await fetch(`${apiUrl('/api/trakcare/ktm')}?ward=`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`KTM proxy merespons HTTP ${response.status}.`);
      const body = await response.json() as { patients?: GlobalKtmPatient[]; html?: string };
      if (Array.isArray(body.patients)) return body.patients;
      if (typeof body.html === 'string') {
        return parseKTMPatients(body.html).map(patient => ({
          noRM: patient.noRM,
          episodeNo: patient.episodeNo,
          namaPasien: patient.namaPasien,
          tanggalJamKTM: patient.tanggalJamKTM,
        }));
      }
      return [];
    } catch {
      // The public proxy may not resolve the internal hospital host. Try the
      // browser path as a fallback when the user is on the RS network.
    }
  }
  return fetchDirectKtm();
}

function addedKeys<T>(current: T[], previous: Snapshot, keyOf: (value: T) => string): string[] {
  if (!previous) return [];
  return current.map(keyOf).filter(key => !previous.has(key));
}

function rememberNotification(
  input: Parameters<typeof addNotification>[0],
  fingerprint: string,
): boolean {
  const legacyFingerprint = [
    input.category,
    input.title,
    input.description,
    input.destination ?? '',
  ].join('|');
  if (!claimNotificationFingerprint([fingerprint, legacyFingerprint])) return false;
  void addNotification(input).catch(() => {
    // Notification history must never interrupt live monitoring or toast display.
  });
  return true;
}

export default function GlobalNotificationMonitor() {
  const { user, isInitialized } = useAuth();
  const [, navigate] = useLocation();
  const ktmSnapshot = useRef<Snapshot>(null);
  const plannedSnapshot = useRef<Snapshot>(null);
  const inProgressSnapshot = useRef<Snapshot>(null);
  const igdSnapshot = useRef<Snapshot>(null);
  const billingCycleSnapshot = useRef<Snapshot>(null);
  const checklistReminderSnapshot = useRef<Snapshot>(null);
  const preadmissionDueSnapshot = useRef<Snapshot>(null);
  const billingActionReminderSnapshot = useRef<Snapshot>(null);
  const pendingSnapshot = useRef<Snapshot>(null);
  const running = useRef(false);
  const fingerprintsSeeded = useRef(false);
  const recentNotifications = useRef(new Map<string, number>());
  const lastSoundAt = useRef(new Map<string, number>());

  const canNotify = (key: string, cooldownMs = 60_000) => {
    const now = Date.now();
    const previous = recentNotifications.current.get(key) ?? 0;
    if (now - previous < cooldownMs) return false;
    recentNotifications.current.set(key, now);
    return true;
  };

  const playSoundOnce = (kind: Parameters<typeof playNotificationSound>[0]) => {
    const now = Date.now();
    const previous = lastSoundAt.current.get(kind) ?? 0;
    if (now - previous < 8_000) return;
    lastSoundAt.current.set(kind, now);
    void playNotificationSound(kind);
  };

  useEffect(() => {
    if (!user) {
      stopNotificationSound();
      ktmSnapshot.current = null;
      plannedSnapshot.current = null;
      inProgressSnapshot.current = null;
      igdSnapshot.current = null;
      billingCycleSnapshot.current = null;
      checklistReminderSnapshot.current = null;
      preadmissionDueSnapshot.current = null;
      billingActionReminderSnapshot.current = null;
      pendingSnapshot.current = null;
      fingerprintsSeeded.current = false;
    }
  }, [user]);

  useEffect(() => {
    const handleRestore = () => {
      // A restore replaces source data and notification history. The next
      // poll must establish a fresh baseline, while the fingerprint ledger
      // is reseeded from the restored history before any alert is surfaced.
      ktmSnapshot.current = null;
      plannedSnapshot.current = null;
      inProgressSnapshot.current = null;
      igdSnapshot.current = null;
      billingCycleSnapshot.current = null;
      checklistReminderSnapshot.current = null;
      preadmissionDueSnapshot.current = null;
      billingActionReminderSnapshot.current = null;
      pendingSnapshot.current = null;
      fingerprintsSeeded.current = false;
    };
    window.addEventListener('ipaw:notification-restore', handleRestore);
    return () => window.removeEventListener('ipaw:notification-restore', handleRestore);
  }, []);

  useEffect(() => {
    if (!isInitialized || !user) return;

    const poll = async () => {
      if (running.current) return;
      running.current = true;
      try {
        if (!fingerprintsSeeded.current) {
          await seedNotificationFingerprintsFromHistory();
          fingerprintsSeeded.current = true;
        }
        const settings = await getNotificationSettings();
        const config: OperatingTheatreConfig =
          await getOperatingTheatreConfig().catch(() => DEFAULT_OPERATING_THEATRE_CONFIG);

        try {
          const db = await getDB();
          const [billingPatients, billingStatuses] = await Promise.all([
            db.getAll('patients'),
            db.getAll('notifikasiBilling'),
          ]);
          const statusByEpisode = new Map(billingStatuses.map(status => [status.id, status]));
          const billingCandidates = billingPatients
            .filter(patient =>
              (patient.status === 'aktif' || patient.status === 'pulang_pending') &&
              Boolean(patient.payor) &&
              !patient.payor.toUpperCase().includes('BPJS') &&
              Boolean(patient.admissionDate),
            )
            .map(patient => ({
              patient,
              cycle: billingCycleHariRawat(patient.admissionDate),
            }))
            .filter((entry): entry is { patient: typeof billingPatients[number]; cycle: number } => entry.cycle !== null);
          const billingKeys = new Set(
            billingCandidates.map(({ patient, cycle }) => `${patient.episodeNo}:${cycle}`),
          );
          const previousBillingCycles = billingCycleSnapshot.current;
          billingCycleSnapshot.current = billingKeys;
          const newBillingCycles = previousBillingCycles
            ? billingCandidates.filter(({ patient, cycle }) =>
                !previousBillingCycles.has(`${patient.episodeNo}:${cycle}`),
              )
            : [];
          let surfacedBillingCycle = false;
          newBillingCycles.slice(0, 5).forEach(({ patient, cycle }) => {
            const status = statusByEpisode.get(patient.episodeNo);
            if (status?.sudahDikirim && status.siklusHariRawat === cycle) return;
            const notificationKey = `billing-cycle:${patient.episodeNo}:${cycle}`;
            if (!canNotify(notificationKey)) return;
            const surfaced = rememberNotification({
              category: 'billing',
              title: `Billing Sementara butuh di konfirmasi · ${patient.namaPasien}`,
              description: `Hari rawat ke-${cycle} · Estimasi billing perlu diisi dan dikirim ulang.`,
              destination: '/kasir',
              priority: 'attention',
            }, notificationKey);
            if (!surfaced) return;
            surfacedBillingCycle = true;
            if (settings.popupEnabled) {
              showPersistentNotification('warning', `Billing Sementara butuh di konfirmasi · ${patient.namaPasien}`, {
                description: `Hari rawat ke-${cycle} · Estimasi billing perlu diisi dan dikirim ulang.`,
                action: {
                  label: 'Buka Notifikasi Billing',
                  onClick: () => navigate('/kasir'),
                },
              });
            }
          });
          if (newBillingCycles.length > 5) {
            const remaining = newBillingCycles.length - 5;
            const batchFingerprint = `billing-cycle:batch:${newBillingCycles
              .map(({ patient, cycle }) => `${patient.episodeNo}:${cycle}`)
              .sort()
              .join(',')}`;
            if (canNotify(batchFingerprint)) {
              const surfaced = rememberNotification({
                category: 'billing',
                title: `Billing Sementara butuh di konfirmasi · ${remaining} pasien`,
                description: 'Buka Kasir > Notifikasi Billing untuk memproses ulang.',
                destination: '/kasir',
                priority: 'attention',
              }, batchFingerprint);
              if (surfaced) {
                surfacedBillingCycle = true;
                if (settings.popupEnabled) {
                  showPersistentNotification('warning', `Billing Sementara butuh di konfirmasi · ${remaining} pasien`, {
                    description: 'Buka Kasir > Notifikasi Billing untuk memproses ulang.',
                    action: {
                      label: 'Buka Notifikasi Billing',
                      onClick: () => navigate('/kasir'),
                    },
                  });
                }
              }
            }
          }
          if (surfacedBillingCycle && settings.soundEnabled) playSoundOnce('billing');
        } catch {
          // Billing notification monitoring is local-only and must not block
          // the network-backed monitors.
        }

        try {
          const endpoints = await getEndpoints();
          const igdPatients = await fetchIGDData(endpoints.igd);
          const spriPatients = igdPatients.filter(hasSprI);
          const hadIgdBaseline = igdSnapshot.current !== null;
          const newIgdKeys = addedKeys(spriPatients, igdSnapshot.current, igdPatientKey);
          const currentIgdKeys = new Set(spriPatients.map(igdPatientKey));
          igdSnapshot.current = new Set([
            ...(igdSnapshot.current ?? []),
            ...currentIgdKeys,
          ]);
          const newIgdPatients = hadIgdBaseline
            ? spriPatients.filter(patient => newIgdKeys.includes(igdPatientKey(patient)))
            : spriPatients;
          let surfacedIgdNotification = false;

          // fetchIGDData only returns patients with a SPRI/transfer timer.
          // The fingerprint ledger makes this safe across polling, reloads,
          // IndexedDB restore, and multiple browser tabs.
          newIgdPatients.slice(0, 5).forEach(patient => {
            const patientKey = igdPatientKey(patient);
            if (!patientKey) return;
            const notificationKey = `igd:spri:${patientKey}`;
            if (!canNotify(notificationKey)) return;
            const surfaced = rememberNotification({
              category: 'igd',
              title: `Pasien IGD dengan SPRI · ${patient.nama}`,
              description: `No. RM ${patient.noRM || '-'} · ${patient.lokasi || 'Lokasi belum tersedia'} · Perlu ditindaklanjuti di IGD Ward.`,
              destination: NOTIFICATION_KIND_META.igd.destination,
              priority: 'attention',
            }, notificationKey);
            if (!surfaced) return;
            surfacedIgdNotification = true;
            if (settings.popupEnabled) {
              showPersistentNotification('warning', `Pasien IGD dengan SPRI · ${patient.nama}`, {
                description: `No. RM ${patient.noRM || '-'} · ${patient.lokasi || 'Lokasi belum tersedia'}.`,
                action: {
                  label: 'Buka IGD Ward',
                  onClick: () => navigate(NOTIFICATION_KIND_META.igd.destination),
                },
              });
            }
          });

          if (newIgdPatients.length > 5) {
            const remaining = newIgdPatients.length - 5;
            const batchFingerprint = `igd:spri:batch:${newIgdPatients
              .map(igdPatientKey)
              .filter(Boolean)
              .sort()
              .join(',')}`;
            if (canNotify(batchFingerprint)) {
              const surfaced = rememberNotification({
                category: 'igd',
                title: `${remaining} pasien IGD dengan SPRI lainnya`,
                description: 'Periksa IGD Ward untuk melihat seluruh pasien yang sudah memiliki SPRI.',
                destination: NOTIFICATION_KIND_META.igd.destination,
                priority: 'attention',
              }, batchFingerprint);
              if (surfaced) {
                surfacedIgdNotification = true;
                if (settings.popupEnabled) {
                  showPersistentNotification('warning', `${remaining} pasien IGD dengan SPRI lainnya`, {
                    description: 'Periksa IGD Ward untuk melihat seluruh pasien yang sudah memiliki SPRI.',
                    action: {
                      label: 'Buka IGD Ward',
                      onClick: () => navigate(NOTIFICATION_KIND_META.igd.destination),
                    },
                  });
                }
              }
            }
          }

          if (surfacedIgdNotification && settings.soundEnabled) {
            playSoundOnce('igd');
          }
        } catch {
          // IGD network/proxy failures must not block the other global monitors.
        }

        try {
          const ktmPatients = await fetchKtmForNotifications();
          const newKtmKeys = addedKeys(ktmPatients, ktmSnapshot.current, ktmKey);
          const currentKtmKeys = new Set(ktmPatients.map(ktmKey));
          ktmSnapshot.current = new Set([
            ...(ktmSnapshot.current ?? []),
            ...currentKtmKeys,
          ]);
          if (newKtmKeys.length) {
            let surfacedKtmNotification = false;
            const newPatients = ktmPatients.filter(patient => newKtmKeys.includes(ktmKey(patient)));
            newPatients.slice(0, 5).forEach(patient => {
              const notificationKey = `ktm:${ktmKey(patient)}`;
              if (!canNotify(notificationKey)) return;
              const surfaced = rememberNotification({
                category: 'ktm',
                title: `KTM baru · ${patient.namaPasien}`,
                description: `No. RM ${patient.noRM} · Perlu ditinjau di Monitoring KTM.`,
                destination: NOTIFICATION_KIND_META.ktm.destination,
                priority: 'attention',
              }, notificationKey);
              if (!surfaced) return;
              surfacedKtmNotification = true;
              if (settings.popupEnabled) {
                showPersistentNotification('warning', `KTM baru · ${patient.namaPasien}`, {
                  description: `No. RM ${patient.noRM} · Perlu ditinjau di Monitoring KTM.`,
                  action: {
                    label: 'Buka KTM',
                    onClick: () => navigate(NOTIFICATION_KIND_META.ktm.destination),
                  },
                });
              }
            });
            if (newPatients.length > 5) {
              const remaining = newPatients.length - 5;
              const batchFingerprint = `ktm:batch:${newKtmKeys.slice().sort().join(',')}`;
              if (canNotify(batchFingerprint)) {
                const surfaced = rememberNotification({
                  category: 'ktm',
                  title: `${remaining} KTM baru lainnya`,
                  description: 'Buka Monitoring KTM untuk melihat seluruh antrean.',
                  destination: NOTIFICATION_KIND_META.ktm.destination,
                  priority: 'attention',
                }, batchFingerprint);
                if (surfaced) {
                  surfacedKtmNotification = true;
                }
                if (surfaced && settings.popupEnabled) {
                  showPersistentNotification('warning', `${remaining} KTM baru lainnya`, {
                    description: 'Buka Monitoring KTM untuk melihat seluruh antrean.',
                    action: {
                      label: 'Buka KTM',
                      onClick: () => navigate(NOTIFICATION_KIND_META.ktm.destination),
                    },
                  });
                }
              }
            }
            if (surfacedKtmNotification && settings.soundEnabled) playSoundOnce('ktm');
          }
        } catch {
          // A failed KTM poll must not clear the last known snapshot or
          // interfere with notifications from the other data sources.
        }

        if (config.username && config.password) {
          try {
            const [plannedResponse, inProgress] = await Promise.all([
              fetchOperatingTheatre(config),
              fetchOperatingTheatreInProgress(config),
            ]);
            const planned = plannedResponse.filter(patient => !isInProgressOperatingTheatrePatient(patient));
            const db = await getDB();
            const inpatientPatients = await db.getAll('patients');
            const activeInpatientPatients = inpatientPatients.filter(
              patient => patient.status === 'aktif' || patient.status === 'pulang_pending',
            );
            const preadmission = planned.filter(patient => !findMatchingPatient(activeInpatientPatients, patient));
            const activeMapped = planned.filter(patient => findMatchingPatient(activeInpatientPatients, patient));
            const { cache: plannedCache } = await saveOperatingTheatreLiveSnapshot(
              activeMapped,
              config.endpoint,
              activeMapped,
              activeInpatientPatients,
            );
            const preadmissionCache = await saveOperatingTheatrePreadmissionCache(
              preadmission,
              config.endpoint,
              'live',
              activeMapped,
            );
            await syncOperatingTheatreActionPlans(activeInpatientPatients, planned);
            const newPlannedKeys = addedKeys(plannedCache.patients, plannedSnapshot.current, plannedKey);
            const newInProgressKeys = addedKeys(inProgress, inProgressSnapshot.current, plannedKey);
            plannedSnapshot.current = new Set(plannedCache.patients.map(plannedKey));
             if (inProgress.length > 0 || inProgressSnapshot.current === null) {
               inProgressSnapshot.current = new Set(inProgress.map(plannedKey));
             }

            const newOperatingTheatreCount = newPlannedKeys.length + newInProgressKeys.length;
            if (newOperatingTheatreCount) {
              const otKey = `operating-theatre:${[...newPlannedKeys, ...newInProgressKeys].sort().join(',')}`;
              if (canNotify(otKey)) {
                const surfaced = rememberNotification({
                  category: 'operating-theatre',
                  title: `${newOperatingTheatreCount} pasien baru di Operating Theatre`,
                  description: `${newPlannedKeys.length} rencana tindakan · ${newInProgressKeys.length} In Progress`,
                  destination: '/pasien-rencana-tindakan',
                  priority: 'attention',
                }, otKey);
                if (surfaced && settings.soundEnabled && config.soundEnabled) playSoundOnce('operating-theatre');
                if (surfaced && settings.popupEnabled && config.popupEnabled) {
                  showPersistentNotification('info', `${newOperatingTheatreCount} pasien baru di Operating Theatre`, {
                    description: `${newPlannedKeys.length} rencana tindakan · ${newInProgressKeys.length} In Progress`,
                    action: {
                      label: 'Buka daftar',
                      onClick: () => navigate('/pasien-rencana-tindakan'),
                    },
                  });
                }
              }
            }

             const dueToday = preadmissionCache.patients.filter(patient => isPreadmissionDueToday(patient.tanggalOperasi));
             const dueTodayKeys = new Set(
               dueToday.map(patient => `${plannedKey(patient)}:${toDateKey(patient.tanggalOperasi)}`),
             );
             const previousDueToday = preadmissionDueSnapshot.current;
             preadmissionDueSnapshot.current = dueTodayKeys;
             const newDueToday = previousDueToday
               ? dueToday.filter(patient =>
                   !previousDueToday.has(`${plannedKey(patient)}:${toDateKey(patient.tanggalOperasi)}`),
                 )
               : dueToday;
            let surfacedPreadmissionWarning = false;
             newDueToday.slice(0, 5).forEach(patient => {
              const actionDate = toDateKey(patient.tanggalOperasi);
              const warningKey = `preadmission-due-today:${plannedKey(patient)}:${actionDate}`;
              if (!canNotify(warningKey)) return;
              const surfaced = rememberNotification({
                category: 'operating-theatre',
                title: `Preadmission masuk hari ini · ${patient.namaPasien}`,
                description: `Rencana tindakan ${formatDate(patient.tanggalOperasi)} · No. RM ${patient.noRM || '-'}.`,
                destination: '/pasien-preadmission/masuk-hari-ini',
                priority: 'attention',
              }, warningKey);
              if (!surfaced) return;
              surfacedPreadmissionWarning = true;
              if (settings.popupEnabled && config.popupEnabled) {
                showPersistentNotification('warning', `Preadmission masuk hari ini · ${patient.namaPasien}`, {
                  description: `Rencana tindakan ${formatDate(patient.tanggalOperasi)} · No. RM ${patient.noRM || '-'}.`,
                  action: {
                    label: 'Buka Masuk Hari Ini',
                    onClick: () => navigate('/pasien-preadmission/masuk-hari-ini'),
                  },
                });
              }
            });
             if (newDueToday.length > 5) {
               const remaining = newDueToday.length - 5;
               const batchKey = `preadmission-due-today:batch:${newDueToday
                .map(patient => `${plannedKey(patient)}:${toDateKey(patient.tanggalOperasi)}`)
                .sort()
                .join(',')}`;
              if (canNotify(batchKey)) {
                const surfaced = rememberNotification({
                  category: 'operating-theatre',
                  title: `${remaining} pasien Preadmission masuk hari ini`,
                  description: 'Periksa submenu Preadmission untuk melihat seluruh pasien.',
                  destination: '/pasien-preadmission',
                  priority: 'attention',
                }, batchKey);
                if (surfaced) surfacedPreadmissionWarning = true;
                if (surfaced && settings.popupEnabled && config.popupEnabled) {
                  showPersistentNotification('warning', `${remaining} pasien Preadmission masuk hari ini`, {
                    description: 'Periksa submenu Preadmission untuk melihat seluruh pasien.',
                    action: {
                      label: 'Buka Preadmission',
                      onClick: () => navigate('/pasien-preadmission'),
                    },
                  });
                }
              }
            }
            if (surfacedPreadmissionWarning && settings.soundEnabled && config.soundEnabled) {
              playSoundOnce('operating-theatre');
            }
          } catch {
            // TrakCare credentials/network may be unavailable. The page-level
            // monitor will show its own error when the user opens the feature.
          }
        }

        try {
          const db = await getDB();
           const [patients, checklistMasters] = await Promise.all([
            db.getAll('patients'),
            ensureDefaultChecklistMasters(),
          ]);
            const activePatients = patients.filter(
              patient => patient.status === 'aktif' || patient.status === 'pulang_pending',
            );
           const activePending = (await db.getAll('pendings'))
              .filter(item =>
                item.status !== 'selesai' &&
                (Boolean(findMatchingPatient(activePatients, item)) || item.kategori === 'IGD Ward'),
              );
             const pendingKeys = new Set(activePending.map(item => item.id));
           const previousPending = pendingSnapshot.current;
           pendingSnapshot.current = pendingKeys;
           const newPending = previousPending
               ? activePending.filter(item => !previousPending.has(item.id))
             : [];
           if (newPending.length) {
             let surfacedPendingNotification = false;
             newPending.slice(0, 5).forEach(item => {
                const notificationKey = `pending:${item.id}`;
               if (!canNotify(notificationKey)) return;
               const priority = item.prioritas === 'critical' || item.prioritas === 'urgent'
                 ? 'attention'
                 : 'normal';
               const surfaced = rememberNotification({
                 category: 'pending',
                 title: `Pending ${item.prioritas === 'critical' ? 'Critical' : item.prioritas === 'urgent' ? 'Urgent' : 'baru'} · ${item.namaPasien}`,
                 description: `${item.isiPending} · No. RM ${item.noRM}`,
                 destination: NOTIFICATION_KIND_META.pending.destination,
                 priority,
               }, notificationKey);
               if (!surfaced) return;
               surfacedPendingNotification = true;
               if (settings.popupEnabled) {
                 showPersistentNotification(
                   priority === 'attention' ? 'warning' : 'info',
                   `Pending ${item.prioritas === 'critical' ? 'Critical' : item.prioritas === 'urgent' ? 'Urgent' : 'baru'} · ${item.namaPasien}`,
                   {
                     description: `${item.isiPending} · No. RM ${item.noRM}`,
                     action: {
                       label: 'Buka Pending',
                       onClick: () => navigate(NOTIFICATION_KIND_META.pending.destination),
                     },
                   },
                 );
               }
             });
             if (newPending.length > 5) {
               const remaining = newPending.length - 5;
               const batchFingerprint = `pending:batch:${newPending
                 .map(item => item.id)
                 .sort()
                 .join(',')}`;
               if (canNotify(batchFingerprint)) {
                 const surfaced = rememberNotification({
                   category: 'pending',
                   title: `${remaining} pending lainnya perlu ditindaklanjuti`,
                   description: 'Buka Pending Operan untuk melihat seluruh daftar.',
                   destination: NOTIFICATION_KIND_META.pending.destination,
                   priority: 'attention',
                 }, batchFingerprint);
                 if (surfaced) {
                   surfacedPendingNotification = true;
                   if (settings.popupEnabled) {
                     showPersistentNotification('warning', `${remaining} pending lainnya perlu ditindaklanjuti`, {
                       description: 'Buka Pending Operan untuk melihat seluruh daftar.',
                       action: {
                         label: 'Buka Pending',
                         onClick: () => navigate(NOTIFICATION_KIND_META.pending.destination),
                       },
                     });
                   }
                 }
               }
             }
             if (surfacedPendingNotification && settings.soundEnabled) playSoundOnce('pending');
           }
          if (checklistMasters.length) {
            const checklistViews = await syncChecklistPatients(patients, checklistMasters);
            const reminderKeys = new Set(
              checklistViews
                .filter(item => item.status === 'reminder')
                .map(item => `${item.episodeNo}:reminder`),
            );
            const previousReminders = checklistReminderSnapshot.current;
            checklistReminderSnapshot.current = reminderKeys;
             const newReminderKeys = previousReminders
               ? [...reminderKeys].filter(key => !previousReminders.has(key))
               : [];
             const newReminderCount = newReminderKeys.length;
             if (newReminderCount) {
               const checklistNotificationKey = `checklist:${newReminderKeys.sort().join(',')}`;
              if (canNotify(checklistNotificationKey)) {
                const surfaced = rememberNotification({
                  category: 'checklist',
                  title: `${newReminderCount} checklist pasien perlu ditinjau`,
                  description: 'Reminder hari ini tersedia di Checklist Pasien.',
                  destination: '/checklist-pasien',
                  priority: 'attention',
                }, checklistNotificationKey);
                if (surfaced && settings.soundEnabled) playSoundOnce('checklist');
                if (surfaced && settings.popupEnabled) {
                  showPersistentNotification('warning', `${newReminderCount} checklist pasien perlu ditinjau`, {
                    description: 'Reminder hari ini tersedia di Checklist Pasien.',
                    action: {
                      label: 'Buka checklist',
                     onClick: () => {
                       requestChecklistFilter('today');
                       navigate('/checklist-pasien');
                     },
                    },
                  });
                }
              }
            }
             const billingReminderKeys = new Set(
               checklistViews
                 .filter(item => item.billingActionReminderToday || item.billingActionOverdue)
                 .map(item => `${item.episodeNo}:billing-action`),
             );
             const previousBillingReminders = billingActionReminderSnapshot.current;
             billingActionReminderSnapshot.current = billingReminderKeys;
             const newBillingReminderItems = previousBillingReminders
               ? checklistViews.filter(item =>
                   billingReminderKeys.has(`${item.episodeNo}:billing-action`) &&
                   !previousBillingReminders.has(`${item.episodeNo}:billing-action`),
                 )
               : checklistViews.filter(item => billingReminderKeys.has(`${item.episodeNo}:billing-action`));
               if (newBillingReminderItems.length) {
                let surfacedBillingNotification = false;
                newBillingReminderItems.slice(0, 5).forEach(item => {
                  const actionDate = item.tanggalRencanaTindakan || item.answers['tanggal-rencana-tindakan'] || '';
                  const notificationKey = `billing:${item.episodeNo}:${actionDate}`;
                  if (!canNotify(notificationKey)) return;
                   const surfaced = rememberNotification({
                     category: 'billing',
                     title: `Billing perlu dicek · ${item.namaPasien}`,
                     description: `Rencana ${actionDate} · No. RM ${item.noRM}`,
                     destination: '/billing-checker',
                     priority: 'attention',
                   }, notificationKey);
                   if (!surfaced) return;
                   surfacedBillingNotification = true;
                   if (settings.popupEnabled) {
                     showPersistentNotification('warning', `Billing perlu dicek · ${item.namaPasien}`, {
                       description: `Rencana ${actionDate} · No. RM ${item.noRM}`,
                       action: {
                         label: 'Buka billing',
                         onClick: () => navigate('/billing-checker'),
                       },
                     });
                   }
                });
                  if (surfacedBillingNotification && settings.soundEnabled) playSoundOnce('billing');
                 if (newBillingReminderItems.length > 5) {
                  const remaining = newBillingReminderItems.length - 5;
                      const batchFingerprint = `billing:batch:${newBillingReminderItems
                       .map(item => `${item.episodeNo}:${item.tanggalRencanaTindakan || item.answers['tanggal-rencana-tindakan'] || ''}`)
                       .sort()
                       .join(',')}`;
                   if (canNotify(batchFingerprint)) {
                     const surfaced = rememberNotification({
                       category: 'billing',
                       title: `${remaining} pasien lain perlu cek billing`,
                       description: 'Buka Billing Checker untuk melihat seluruh daftar.',
                       destination: '/billing-checker',
                       priority: 'attention',
                     }, batchFingerprint);
                    if (surfaced && settings.soundEnabled && !surfacedBillingNotification) playSoundOnce('billing');
                    if (surfaced && settings.popupEnabled) {
                      showPersistentNotification('warning', `${remaining} pasien lain perlu cek billing`, {
                        description: 'Buka Billing Checker untuk melihat seluruh daftar.',
                        action: {
                          label: 'Buka billing',
                          onClick: () => navigate('/billing-checker'),
                        },
                      });
                    }
                }
               }
             }
          }
        } catch {
          // Checklist monitoring is local-only and must not block KTM/OT polling.
        }
      } finally {
        running.current = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      stopNotificationSound();
    };
  }, [isInitialized, user]);

  return null;
}