import React, { useState, useEffect, useCallback, useRef } from 'react';

import { getDB, Patient, Pending, JustInfo, OutlookEmail } from '../lib/db';
import { syncTrakCare, getLastSyncTime, SyncResult } from '../lib/trakcare';
import { triggerAutoBackup } from '../lib/cloudSync';
import EstimasiPanel from '../components/EstimasiPanel';
import UraianKonfirmasiPanel from '../components/UraianKonfirmasiPanel';
import { dateKey, savePatientActionPlan } from '../lib/checklist';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Search, Star, Clock, Info, FileText, Plus, X, Upload,
  Calendar, ChevronRight, User2, BedDouble, Stethoscope, MapPin, ShieldCheck,
  CreditCard, AlertCircle, CheckCircle2, Phone, Save, DollarSign,
  RefreshCw, Cloud, CloudOff, Users, Database, UserPlus, Mail,
  Pencil, Trash2, Printer, Activity, Cake, ClipboardCheck, ArrowRight,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { getCurrentShift, generateUUID } from '../lib/auth';
import { formatDate, formatDateTime } from '../lib/utils';
import { EpisodeLink } from '@/components/EpisodeLink';
import { parseWardRoomDisplay, ParsedWardRoom } from '../lib/wardRoom';
import { getPatientDisplayName, patientIdentityMatches } from '../lib/patientIdentity';
import { loadPatientDataBundle } from '../lib/dataRepository';
import { shouldConfirmMissingInpatient } from '../lib/storageMode';
import { normalizeTrakCareBirthDate } from '../lib/trakcareDate';
import { getOutlookSettings, syncOutlookEmails } from '../lib/outlook';

const KATEGORI_LIST = [
  'Konfirmasi Billing',
  'Konfirmasi DPJP',
  'Konfirmasi Ruangan',
  'Konfirmasi Penjamin',
  'Konfirmasi Tindakan',
  'Administrasi',
  'Lainnya',
];

const EMPTY_PATIENT_FORM = {
  noRM: '',
  namaPasien: '',
  episodeNo: '',
  ward: '',
  roomType: '',
  bedCode: '',
  dpjp: '',
  admissionDate: '',
  payor: '',
  statusBPJS: '',
  sexDesc: '',
  dob: '',
  agama: '',
  diagnosaMasuk: '',
  alertVIP: '',
  emailAsuransi: '',
  noKartuAsuransi: '',
};

function getParsedWardRoom(patient: Patient): ParsedWardRoom | null {
  const combinedLocation = [patient.ward, patient.roomName, patient.bedCode]
    .filter(Boolean)
    .join(' ');
  const candidates = [
    patient.ward,
    patient.roomName,
    combinedLocation,
    patient.roomType && !combinedLocation.includes('-')
      ? `${combinedLocation} - ${patient.roomType}`
      : '',
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = parseWardRoomDisplay(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function getPatientRoomLabel(patient: Patient): string {
  const parsed = getParsedWardRoom(patient);
  if (parsed) {
    return [parsed.ward, parsed.room, parsed.roomType].filter(Boolean).join(' ');
  }

  const ward = (patient.ward || '').trim();
  const room = (patient.roomName || '').trim().replace(/^PK\s+/i, '');
  const roomType = (patient.roomType || '').trim();
  return [ward, room, roomType].filter(Boolean).join(' ') || '-';
}

function formatPatientDate(value: string | number | null | undefined): string {
  const normalized = dateKey(value);
  if (!normalized) return '-';
  const parsed = new Date(`${normalized}T00:00:00`);
  return formatDate(parsed);
}

function getPatientLengthOfStay(value: string | number | null | undefined): number | string {
  const normalized = dateKey(value);
  if (!normalized) return '-';
  const admission = new Date(`${normalized}T00:00:00`);
  const today = new Date();
  const start = new Date(admission.getFullYear(), admission.getMonth(), admission.getDate());
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.max(1, days);
}

function getPatientAge(value: string | number | null | undefined): number | null {
  const normalized = dateKey(value);
  if (!normalized) return null;
  const birth = new Date(`${normalized}T00:00:00`);
  const today = new Date();
  if (Number.isNaN(birth.getTime()) || birth > today) return null;

  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

export default function Patients() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [pendings, setPendings] = useState<Pending[]>([]);
  const [justInfos, setJustInfos] = useState<JustInfo[]>([]);
  const [outlookEmails, setOutlookEmails] = useState<OutlookEmail[]>([]);
  const [isLoadingPatients, setIsLoadingPatients] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterRuangan, setFilterRuangan] = useState('all');
  const [filterSumber, setFilterSumber] = useState<'all' | 'manual' | 'trakcare'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'aktif' | 'rencana_pulang' | 'pending'>('all');

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [autoSyncInterval, setAutoSyncInterval] = useState<string>('manual');
  const autoSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [outlookSyncInterval, setOutlookSyncInterval] = useState<string>('manual');
  const outlookSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outlookSyncInProgressRef = useRef(false);

  // Detail modal
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isLoadingPatientDetail, setIsLoadingPatientDetail] = useState(false);
  const [patientDetailSource, setPatientDetailSource] = useState<'cloud' | 'local' | null>(null);
  const [actionPlanPatient, setActionPlanPatient] = useState<Patient | null>(null);
  const [actionPlanDate, setActionPlanDate] = useState('');
  const [savingActionPlan, setSavingActionPlan] = useState(false);
  const [pendingDischargePatient, setPendingDischargePatient] = useState<Patient | null>(null);
  const [confirmingDischarge, setConfirmingDischarge] = useState(false);

  // Tambah Pending modal (dari detail pasien)
  const [isAddPendingOpen, setIsAddPendingOpen] = useState(false);
  const [pendingForm, setPendingForm] = useState({
    kategori: 'Konfirmasi Billing',
    isiPending: '',
    prioritas: 'normal' as 'normal' | 'urgent' | 'critical',
    shift: getCurrentShift(),
    deadline: '',
    fotoBase64: '',
  });
  const parsedSelectedWardRoom = selectedPatient ? getParsedWardRoom(selectedPatient) : null;
  const [savingPending, setSavingPending] = useState(false);

  // Tambah Just Info modal
  const [isAddInfoOpen, setIsAddInfoOpen] = useState(false);
  const [infoText, setInfoText] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);

  // Edit Just Info
  const [editingInfo, setEditingInfo] = useState<JustInfo | null>(null);
  const [editInfoText, setEditInfoText] = useState('');
  const [savingEditInfo, setSavingEditInfo] = useState(false);

  // Hapus Just Info
  const [confirmDeleteInfoId, setConfirmDeleteInfoId] = useState<string | null>(null);
  const [deletingInfo, setDeletingInfo] = useState(false);

  // No HP Penanggung Jawab
  const [noHpPJ, setNoHpPJ] = useState('');
  const [savingHp, setSavingHp] = useState(false);
  const [emailAsuransi, setEmailAsuransi] = useState('');
  const [noKartuAsuransi, setNoKartuAsuransi] = useState('');
  const [savingInsurance, setSavingInsurance] = useState(false);

  // Detail tab
  const [detailTab, setDetailTab] = useState<'info' | 'mail' | 'operan' | 'estimasi'>('info');

  // Uraian Konfirmasi Asuransi
  const [uraianPatient, setUraianPatient] = useState<Patient | null>(null);

  // Tambah Pasien Manual
  const [isAddPatientOpen, setIsAddPatientOpen] = useState(false);
  const [addPatientForm, setAddPatientForm] = useState(EMPTY_PATIENT_FORM);
  const [savingPatient, setSavingPatient] = useState(false);
  const [addPatientError, setAddPatientError] = useState('');

  // ── Load data ───────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setIsLoadingPatients(true);
    try {
      const db = await getDB();
      const [allPatients, allPendings, allJustInfos, allOutlookEmails] = await Promise.all([
        db.getAll('patients'),
        db.getAll('pendings'),
        db.getAll('justInfos'),
        db.getAll('outlookEmails'),
      ]);
      const showDischargeCandidates = shouldConfirmMissingInpatient();
      setPatients(allPatients.filter(p =>
        p.status === 'aktif' || (showDischargeCandidates && p.status === 'pulang_pending'),
      ));
      setPendings(allPendings);
      setJustInfos(allJustInfos);
      setOutlookEmails(allOutlookEmails);
    } finally {
      setIsLoadingPatients(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    const ts = await getLastSyncTime();
    setLastSyncTime(ts);
    const db = await getDB();
    const [syncSetting, outlookSettings] = await Promise.all([
      db.get('settings', 'autoSyncInterval'),
      getOutlookSettings(),
    ]);
    setAutoSyncInterval(syncSetting?.value || 'manual');
    setOutlookSyncInterval(
      outlookSettings.enabled && outlookSettings.emailAddress.trim()
        ? outlookSettings.syncInterval
        : 'manual',
    );
  }, []);

  useEffect(() => {
    loadData();
    loadSettings();
  }, [loadData, loadSettings]);

  // ── Auto sync interval ──────────────────────────────────────────────────────
  useEffect(() => {
    if (autoSyncRef.current) {
      clearInterval(autoSyncRef.current);
      autoSyncRef.current = null;
    }
    if (autoSyncInterval === 'manual') return;
    const minutes = parseInt(autoSyncInterval);
    if (isNaN(minutes) || minutes <= 0) return;
    autoSyncRef.current = setInterval(() => {
      handleSync(true);
    }, minutes * 60 * 1000);
    return () => {
      if (autoSyncRef.current) clearInterval(autoSyncRef.current);
    };
  }, [autoSyncInterval]);

  // Outlook email monitoring follows the interval saved in Pengaturan. It is
  // deliberately silent when Microsoft OAuth is unavailable so an unconnected
  // account does not create repeated error toasts for operational users.
  useEffect(() => {
    if (outlookSyncRef.current) {
      clearInterval(outlookSyncRef.current);
      outlookSyncRef.current = null;
    }
    if (outlookSyncInterval === 'manual') return;
    const minutes = Number.parseInt(outlookSyncInterval, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    const syncInBackground = async () => {
      if (outlookSyncInProgressRef.current) return;
      outlookSyncInProgressRef.current = true;
      try {
        const db = await getDB();
        const activePatients = (await db.getAll('patients')).filter(patient => patient.status === 'aktif');
        await syncOutlookEmails(activePatients);
        setOutlookEmails(await db.getAll('outlookEmails'));
      } catch {
        // The Settings panel remains the place for explicit sync errors.
      } finally {
        outlookSyncInProgressRef.current = false;
      }
    };

    outlookSyncRef.current = setInterval(() => {
      void syncInBackground();
    }, minutes * 60 * 1000);
    return () => {
      if (outlookSyncRef.current) clearInterval(outlookSyncRef.current);
    };
  }, [outlookSyncInterval]);

  // ── Sync TrakCare ───────────────────────────────────────────────────────────
  const handleSync = async (silent = false) => {
    if (isSyncing) return;
    setIsSyncing(true);
    if (!silent) toast.loading('Sedang sinkronisasi data TrakCare...', { id: 'sync' });
    try {
      const result: SyncResult = await syncTrakCare();
      setLastSyncTime(Date.now());
      await loadData();
      if (!silent) {
        toast.success(
          `Sinkronisasi selesai: ${result.newPatients} baru, ${result.updatedPatients} diperbarui, ${
            result.pendingDischargePatients > 0
              ? `${result.pendingDischargePatients} menunggu konfirmasi pulang`
              : `${result.dischargedPatients} pulang`
          }.`,
          { id: 'sync', duration: 5000 }
        );
      } else {
        toast.info(
          `Auto-sync: ${result.newPatients} baru, ${result.updatedPatients} diperbarui, ${
            result.pendingDischargePatients > 0
              ? `${result.pendingDischargePatients} menunggu konfirmasi pulang`
              : `${result.dischargedPatients} pulang`
          }.`,
          { duration: 4000 }
        );
      }
    } catch (err: any) {
      toast.error(err.message || 'Sinkronisasi gagal.', { id: 'sync', duration: 5000 });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleConfirmPatientDischarge = async () => {
    if (!pendingDischargePatient) return;
    setConfirmingDischarge(true);
    try {
      const db = await getDB();
      const dischargeDate = pendingDischargePatient.dischargeDate || new Date().toISOString();
      const tx = db.transaction(['patients', 'episodes'], 'readwrite');
      const patientStore = tx.objectStore('patients');
      const episodeStore = tx.objectStore('episodes');
      const currentPatient = await patientStore.get(pendingDischargePatient.noRM);
      if (!currentPatient) throw new Error('Data pasien sudah tidak tersedia.');

      await patientStore.put({
        ...currentPatient,
        status: 'pulang',
        dischargeDate,
        updatedAt: Date.now(),
      });

      const episodes = await episodeStore.index('noRM').getAll(currentPatient.noRM);
      const episode = episodes.find(item => item.episodeNo === currentPatient.episodeNo);
      if (episode) {
        await episodeStore.put({
          ...episode,
          status: 'pulang',
          dischargeDate,
          archivedAt: Date.now(),
        });
      } else {
        await episodeStore.add({
          noRM: currentPatient.noRM,
          episodeNo: currentPatient.episodeNo,
          namaPasien: currentPatient.namaPasien,
          admissionDate: currentPatient.admissionDate,
          status: 'pulang',
          dischargeDate,
          archivedAt: Date.now(),
        });
      }
      await tx.done;

      setPendingDischargePatient(null);
      setSelectedPatient(currentPatient);
      await loadData();
      void triggerAutoBackup();
      toast.success(`${currentPatient.namaPasien} dipindahkan ke Riwayat Pasien Pulang.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal memindahkan pasien ke riwayat.');
    } finally {
      setConfirmingDischarge(false);
    }
  };

  // ── Bookmark ────────────────────────────────────────────────────────────────
  const toggleBookmark = async (patient: Patient, e: React.MouseEvent) => {
    e.stopPropagation();
    const db = await getDB();
    await db.put('patients', { ...patient, bookmarked: !patient.bookmarked });
    loadData();
  };

  // ── No HP PJ ────────────────────────────────────────────────────────────────
  const handleSaveNoHpPJ = async () => {
    if (!selectedPatient) return;
    setSavingHp(true);
    try {
      const db = await getDB();
      const updated = { ...selectedPatient, noHpPJ: noHpPJ.trim(), updatedAt: Date.now() };
      await db.put('patients', updated);
      setSelectedPatient(updated);
      toast.success('No HP Penanggung Jawab berhasil disimpan.');
      loadData();
      triggerAutoBackup();
    } catch {
      toast.error('Gagal menyimpan.');
    } finally {
      setSavingHp(false);
    }
  };

  const handleSaveInsurance = async () => {
    if (!selectedPatient) return;
    const email = emailAsuransi.trim();
    const cardNumber = noKartuAsuransi.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Format email asuransi belum valid.');
      return;
    }
    setSavingInsurance(true);
    try {
      const db = await getDB();
      const updated = {
        ...selectedPatient,
        emailAsuransi: email,
        noKartuAsuransi: cardNumber,
        updatedAt: Date.now(),
      };
      await db.put('patients', updated);
      setSelectedPatient(updated);
      setPatients(previous => previous.map(patient => (
        patient.noRM === updated.noRM ? updated : patient
      )));
      await triggerAutoBackup();
      toast.success('Email dan nomor kartu asuransi berhasil disimpan.');
    } catch {
      toast.error('Gagal menyimpan data asuransi.');
    } finally {
      setSavingInsurance(false);
    }
  };

  // ── Open detail ─────────────────────────────────────────────────────────────
  const openDetail = (patient: Patient) => {
    setSelectedPatient(patient);
    setNoHpPJ(patient.noHpPJ || '');
    setEmailAsuransi(patient.emailAsuransi || '');
    setNoKartuAsuransi(patient.noKartuAsuransi || '');
    setDetailTab('info');
    setIsDetailOpen(true);
    setIsLoadingPatientDetail(true);
    setPatientDetailSource(null);
    void loadPatientDataBundle(patient)
      .then(bundle => {
        setSelectedPatient(bundle.patient);
        setNoHpPJ(bundle.patient.noHpPJ || '');
        setEmailAsuransi(bundle.patient.emailAsuransi || '');
        setNoKartuAsuransi(bundle.patient.noKartuAsuransi || '');
        setPendings(previous => [
          ...previous.filter(item => !patientIdentityMatches(patient, item)),
          ...bundle.pendings,
        ]);
        setJustInfos(previous => [
          ...previous.filter(item => !patientIdentityMatches(patient, item)),
          ...bundle.justInfos,
        ]);
        setPatientDetailSource(
          Object.values(bundle.sourceByStore).every(source => source === 'cloud')
            ? 'cloud'
            : 'local',
        );
        if (bundle.unavailableStores.length > 0) {
          toast.info('Sebagian data Cloud tidak tersedia. Data lokal digunakan untuk bagian tersebut.');
        }
      })
      .catch(error => {
        console.warn('[Patients] Patient Cloud hydration failed:', error);
        setPatientDetailSource('local');
        toast.info('Data Cloud pasien tidak tersedia. Menampilkan data lokal.');
      })
      .finally(() => setIsLoadingPatientDetail(false));
  };

  const openActionPlan = async (patient: Patient, event?: React.MouseEvent) => {
    event?.stopPropagation();
    const db = await getDB();
    const episode = await db.get('checklistEpisodes', patient.episodeNo);
    setActionPlanPatient(patient);
    setActionPlanDate(episode?.tanggalRencanaTindakan || episode?.answers?.['tanggal-rencana-tindakan'] || '');
  };

  const handleSaveActionPlan = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!actionPlanPatient || !actionPlanDate) return;
    setSavingActionPlan(true);
    try {
      await savePatientActionPlan(actionPlanPatient, actionPlanDate);
      toast.success(`Rencana tindakan ${actionPlanDate} tersimpan. Pasien akan masuk Checklist mulai hari berikutnya.`);
      setActionPlanPatient(null);
      triggerAutoBackup();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Rencana tindakan gagal disimpan.');
    } finally {
      setSavingActionPlan(false);
    }
  };

  const getPatientPendings = (patient: Patient) =>
    pendings.filter(p => patientIdentityMatches(patient, p) && p.status !== 'selesai');
  const getPatientJustInfos = (patient: Patient) =>
    justInfos.filter(j => patientIdentityMatches(patient, j));

  // ── Filters ─────────────────────────────────────────────────────────────────
  const ruanganList = Array.from(new Set(patients.map(p => p.ward || p.roomName).filter(Boolean)));

  const filtered = patients
    .filter(p => {
      const q = searchTerm.toLowerCase();
      const matchSearch = !q ||
        p.namaPasien.toLowerCase().includes(q) ||
        p.noRM.toLowerCase().includes(q) ||
        (p.dpjp || '').toLowerCase().includes(q);
      const matchRuangan = filterRuangan === 'all' || (p.ward || p.roomName) === filterRuangan;
      const sumber = p.sumberData ?? 'manual';
      const matchSumber = filterSumber === 'all' || sumber === filterSumber;
      const matchStatus =
        filterStatus === 'all' ||
        (filterStatus === 'aktif' && (p.status === 'aktif' || p.status === 'pulang_pending')) ||
        (filterStatus === 'rencana_pulang' && p.status === 'pulang_pending') ||
        (filterStatus === 'pending' && getPatientPendings(p).length > 0);
      return matchSearch && matchRuangan && matchSumber && matchStatus;
    })
    // Pasien terbaru masuk rawat inap tampil paling kiri/atas
    .sort((a, b) => {
      const ta = a.admissionDate ? new Date(a.admissionDate).getTime() : 0;
      const tb = b.admissionDate ? new Date(b.admissionDate).getTime() : 0;
      return tb - ta;
    });

  // ── Stats ───────────────────────────────────────────────────────────────────
  const totalPasien = patients.length;
  const pasienAktif = patients.filter(p => p.status === 'aktif' || p.status === 'pulang_pending').length;
  const pasienRencanaPulang = patients.filter(p => p.status === 'pulang_pending').length;
  const pasienPending = patients.filter(p => getPatientPendings(p).length > 0).length;
  const pasienManual = patients.filter(p => !p.sumberData || p.sumberData === 'manual').length;
  const pasienTrakCare = patients.filter(p => p.sumberData === 'trakcare').length;
  const lastSyncLabel = lastSyncTime
    ? formatDateTime(lastSyncTime)
    : 'Belum pernah';

  // ── Tambah Pending ──────────────────────────────────────────────────────────
  const openAddPending = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingForm({
      kategori: 'Konfirmasi Billing',
      isiPending: '',
      prioritas: 'normal',
      shift: getCurrentShift(),
      deadline: '',
      fotoBase64: '',
    });
    setIsAddPendingOpen(true);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Foto maksimal 2MB'); return; }
    const reader = new FileReader();
    reader.onload = ev => setPendingForm(f => ({ ...f, fotoBase64: ev.target?.result as string }));
    reader.readAsDataURL(file);
  };

  const handleSavePending = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedPatient) return;
    if (!pendingForm.isiPending.trim()) { toast.error('Isi pending tidak boleh kosong'); return; }
    setSavingPending(true);
    try {
      const db = await getDB();
      const now = Date.now();
      const pending: Pending = {
        id: generateUUID(),
        noRM: selectedPatient.noRM,
        episodeNo: selectedPatient.episodeNo,
        namaPasien: selectedPatient.namaPasien,
        ruangan: selectedPatient.ward || selectedPatient.roomName || '-',
        kelas: selectedPatient.roomType || '-',
        dpjp: selectedPatient.dpjp || '-',
        payor: selectedPatient.payor || '-',
        kategori: pendingForm.kategori,
        isiPending: pendingForm.isiPending.trim(),
        prioritas: pendingForm.prioritas,
        status: 'pending',
        deadline: pendingForm.deadline || null,
        fotoBase64: pendingForm.fotoBase64 || undefined,
        shift: pendingForm.shift,
        userId: user.id,
        userName: user.namaLengkap,
        komentar: [],
        auditLog: [{ action: 'Dibuat', userId: user.id, userName: user.namaLengkap, timestamp: now }],
        createdAt: now,
        updatedAt: now,
      };
      await db.put('pendings', pending);
      toast.success('Pending berhasil ditambahkan');
      setIsAddPendingOpen(false);
      loadData();
    } catch {
      toast.error('Gagal menyimpan pending');
    } finally {
      setSavingPending(false);
    }
  };

  // ── Tambah Just Info ────────────────────────────────────────────────────────
  const openAddInfo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInfoText('');
    setIsAddInfoOpen(true);
  };

  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedPatient) return;
    if (!infoText.trim()) { toast.error('Isi informasi tidak boleh kosong'); return; }
    setSavingInfo(true);
    try {
      const db = await getDB();
      const info: JustInfo = {
        id: generateUUID(),
        noRM: selectedPatient.noRM,
        episodeNo: selectedPatient.episodeNo,
        isi: infoText.trim(),
        shift: getCurrentShift(),
        userId: user.id,
        userName: user.namaLengkap,
        createdAt: Date.now(),
      };
      await db.put('justInfos', info);
      toast.success('Info berhasil ditambahkan');
      setIsAddInfoOpen(false);
      loadData();
    } catch {
      toast.error('Gagal menyimpan info');
    } finally {
      setSavingInfo(false);
    }
  };

  // ── Edit Just Info ──────────────────────────────────────────────────────────
  const openEditInfo = (info: JustInfo) => {
    setEditingInfo(info);
    setEditInfoText(info.isi);
  };

  const handleSaveEditInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInfo || !editInfoText.trim()) return;
    setSavingEditInfo(true);
    try {
      const db = await getDB();
      const updated: JustInfo = { ...editingInfo, isi: editInfoText.trim() };
      await db.put('justInfos', updated);
      toast.success('Info berhasil diperbarui.');
      setEditingInfo(null);
      loadData();
    } catch {
      toast.error('Gagal memperbarui info.');
    } finally {
      setSavingEditInfo(false);
    }
  };

  // ── Hapus Just Info ─────────────────────────────────────────────────────────
  const handleDeleteInfo = async () => {
    if (!confirmDeleteInfoId) return;
    setDeletingInfo(true);
    try {
      const db = await getDB();
      await db.delete('justInfos', confirmDeleteInfoId);
      toast.success('Info berhasil dihapus.');
      setConfirmDeleteInfoId(null);
      loadData();
    } catch {
      toast.error('Gagal menghapus info.');
    } finally {
      setDeletingInfo(false);
    }
  };

  // ── Tambah Pasien Manual ────────────────────────────────────────────────────
  const openAddPatient = () => {
    setAddPatientForm(EMPTY_PATIENT_FORM);
    setAddPatientError('');
    setIsAddPatientOpen(true);
  };

  const handleSavePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddPatientError('');
    if (!addPatientForm.noRM.trim()) { setAddPatientError('No RM wajib diisi.'); return; }
    if (!addPatientForm.namaPasien.trim()) { setAddPatientError('Nama pasien wajib diisi.'); return; }
    if (addPatientForm.emailAsuransi.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addPatientForm.emailAsuransi.trim())) {
      setAddPatientError('Format email asuransi belum valid.');
      return;
    }
    setSavingPatient(true);
    try {
      const db = await getDB();
      const existing = await db.get('patients', addPatientForm.noRM.trim());
      if (existing) {
        setAddPatientError(`No RM ${addPatientForm.noRM.trim()} sudah terdaftar.`);
        return;
      }
      const now = Date.now();
      const newPatient: Patient = {
        noRM: addPatientForm.noRM.trim(),
        namaPasien: addPatientForm.namaPasien.trim(),
        episodeNo: addPatientForm.episodeNo.trim(),
        ward: addPatientForm.ward.trim(),
        roomName: addPatientForm.ward.trim(),
        roomType: addPatientForm.roomType.trim(),
        bedCode: addPatientForm.bedCode.trim(),
        dpjp: addPatientForm.dpjp.trim(),
        dob: addPatientForm.dob,
        agama: addPatientForm.agama.trim(),
        sexDesc: addPatientForm.sexDesc,
        admissionDate: addPatientForm.admissionDate,
        dischargeDate: null,
        medicalDischarge: null,
        payor: addPatientForm.payor.trim(),
        statusBPJS: addPatientForm.statusBPJS.trim(),
        diagnosaMasuk: addPatientForm.diagnosaMasuk.trim(),
        diagnosakUtama: '',
        diagnosaTambahan: '',
        alertVIP: addPatientForm.alertVIP.trim(),
        emailAsuransi: addPatientForm.emailAsuransi.trim(),
        noKartuAsuransi: addPatientForm.noKartuAsuransi.trim(),
        status: 'aktif',
        sumberData: 'manual',
        bookmarked: false,
        createdAt: now,
        updatedAt: now,
      };
      await db.put('patients', newPatient);
      toast.success(`Pasien ${newPatient.namaPasien} berhasil ditambahkan.`);
      setIsAddPatientOpen(false);
      loadData();
    } catch (err: any) {
      setAddPatientError('Gagal menyimpan: ' + err.message);
    } finally {
      setSavingPatient(false);
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const prioritasColor = (p: string) =>
    p === 'critical' ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400' :
    p === 'urgent'   ? 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400' :
                       'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400';

  const statusColor = (s: string) =>
    s === 'selesai'  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30' :
    s === 'diproses' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30' :
                       'bg-amber-100 text-amber-700 dark:bg-amber-900/30';

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/.08),transparent_28rem)] p-3 sm:p-5 lg:p-6 max-w-[1600px] mx-auto space-y-5">

      {/* Header + action buttons */}
      <div className="operating-theatre-header rounded-2xl px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
              <Activity className="h-3.5 w-3.5" /> Admission · Rawat Inap
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Pasien Rawat Inap</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Pantau pasien aktif, perhatian admission, dan rencana pulang dari satu ruang kerja.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={openAddPatient}
              data-testid="button-add-patient"
              className="gap-1.5 bg-card/70"
            >
              <UserPlus className="h-4 w-4" /> Tambah Pasien
            </Button>
            <Button
              size="sm"
              onClick={() => handleSync(false)}
              disabled={isSyncing}
              data-testid="button-sync-trakcare"
              className="gap-1.5"
            >
              <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Menyinkronkan...' : 'Sinkronisasi'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { loadData(); loadSettings(); }}
              aria-label="Muat ulang data pasien"
              data-testid="button-refresh-patients"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Ringkasan inti */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Users className="w-5 h-5 text-primary" />}
          label="Total Pasien"
          value={totalPasien}
          color="bg-primary/10"
        />
        <StatCard
          icon={<User2 className="w-5 h-5 text-slate-600" />}
          label="Sumber manual"
          value={pasienManual}
          color="bg-slate-100 dark:bg-slate-800"
          onClick={() => setFilterSumber(filterSumber === 'manual' ? 'all' : 'manual')}
          active={filterSumber === 'manual'}
        />
        <StatCard
          icon={<Cloud className="w-5 h-5 text-blue-500" />}
          label="Sumber TrakCare"
          value={pasienTrakCare}
          color="bg-blue-50 dark:bg-blue-900/20"
          onClick={() => setFilterSumber(filterSumber === 'trakcare' ? 'all' : 'trakcare')}
          active={filterSumber === 'trakcare'}
        />
        <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3">
          {lastSyncTime
            ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            : <CloudOff className="w-5 h-5 text-muted-foreground shrink-0" />
          }
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Data terakhir disinkronkan</div>
            <div className="text-sm font-semibold truncate">{lastSyncLabel}</div>
            {autoSyncInterval !== 'manual' && (
              <div className="text-xs text-blue-500 mt-0.5">Auto setiap {autoSyncInterval} menit</div>
            )}
          </div>
        </div>
      </div>

      {/* Status kerja — tiga angka ini menjadi filter cepat, bukan ringkasan yang berulang */}
      <div className="rounded-2xl border border-border/80 bg-card/80 p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold">Prioritas daftar</p>
            <p className="text-xs text-muted-foreground">Pilih status untuk mempersempit pasien yang perlu dipantau.</p>
          </div>
          <span className="text-xs font-medium text-muted-foreground">{filtered.length} ditampilkan</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <StatCard
          icon={<Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
          label="Pasien Aktif"
          value={pasienAktif}
          color="bg-blue-50 dark:bg-blue-950/30"
          onClick={() => setFilterStatus(filterStatus === 'aktif' ? 'all' : 'aktif')}
          active={filterStatus === 'aktif'}
        />
        <StatCard
          icon={<ClipboardCheck className="w-5 h-5 text-orange-600 dark:text-orange-400" />}
          label="Rencana Pulang"
          value={pasienRencanaPulang}
          color="bg-orange-50 dark:bg-orange-950/30"
          onClick={() => setFilterStatus(filterStatus === 'rencana_pulang' ? 'all' : 'rencana_pulang')}
          active={filterStatus === 'rencana_pulang'}
        />
        <StatCard
          icon={<Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
          label="Pasien Pending"
          value={pasienPending}
          color="bg-amber-50 dark:bg-amber-950/30"
          onClick={() => setFilterStatus(filterStatus === 'pending' ? 'all' : 'pending')}
          active={filterStatus === 'pending'}
        />
        </div>
      </div>

      {/* Sync progress indicator */}
      {isSyncing && (
        <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3 text-blue-700 dark:text-blue-300 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
          <span>Sedang mengambil data dari TrakCare, harap tunggu...</span>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold">Cari dan saring pasien</p>
            <p className="text-xs text-muted-foreground">Gunakan No. RM, nama, atau DPJP. Filter dapat digabungkan.</p>
          </div>
          {(searchTerm || filterRuangan !== 'all' || filterSumber !== 'all' || filterStatus !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchTerm('');
                setFilterRuangan('all');
                setFilterSumber('all');
                setFilterStatus('all');
              }}
              data-testid="button-reset-patient-filters"
              className="h-8 shrink-0 gap-1 text-xs text-primary"
            >
              <X className="h-3.5 w-3.5" /> Reset
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari No. RM, nama pasien, atau DPJP..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            aria-label="Cari pasien berdasarkan No. RM, nama, atau DPJP"
            data-testid="input-search-patients"
            className="h-10 bg-background pl-10"
          />
          </div>
        <select
          value={filterRuangan}
          onChange={e => setFilterRuangan(e.target.value)}
           aria-label="Filter ruangan"
           data-testid="select-filter-ruangan"
           className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm md:min-w-[160px]"
        >
          <option value="all">Semua Ruangan</option>
          {ruanganList.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select
          value={filterSumber}
          onChange={e => setFilterSumber(e.target.value as any)}
           aria-label="Filter sumber data"
           data-testid="select-filter-sumber"
           className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm md:min-w-[150px]"
        >
          <option value="all">Semua Sumber</option>
          <option value="manual">Manual</option>
          <option value="trakcare">TrakCare</option>
        </select>
        </div>
      </div>

      {/* Patient Cards Grid */}
      {isLoadingPatients ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-[330px] animate-pulse rounded-2xl border border-border bg-card/80 p-5">
              <div className="flex gap-3"><div className="h-10 w-10 rounded-xl bg-muted" /><div className="flex-1 space-y-2"><div className="h-3 w-1/3 rounded bg-muted" /><div className="h-5 w-3/4 rounded bg-muted" /></div></div>
              <div className="mt-6 grid grid-cols-2 gap-2"><div className="h-16 rounded-xl bg-muted" /><div className="h-16 rounded-xl bg-muted" /><div className="h-16 rounded-xl bg-muted" /><div className="h-16 rounded-xl bg-muted" /></div>
              <div className="mt-4 h-14 rounded-xl bg-muted" />
            </div>
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {filtered.map(patient => {
          const ptPendings = getPatientPendings(patient);
          const critical = ptPendings.filter(p => p.prioritas === 'critical').length;
          const urgent   = ptPendings.filter(p => p.prioritas === 'urgent').length;
          const normal   = ptPendings.filter(p => p.prioritas === 'normal').length;
          const infoCount = getPatientJustInfos(patient).length;
          const patientEmails = outlookEmails
            .filter(email => email.matchedNoRM === patient.noRM)
            .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
          const sideColor = critical > 0 ? 'bg-red-500' : urgent > 0 ? 'bg-orange-500' : 'bg-cyan-500';
          const isTrakCare = patient.sumberData === 'trakcare';
           const isDischargePending = patient.status === 'pulang_pending';
           const diagnosis = patient.diagnosakUtama || patient.diagnosaMasuk || patient.diagnosaTambahan;
           const admissionDiagnosis = patient.diagnosakUtama && patient.diagnosaMasuk && patient.diagnosakUtama !== patient.diagnosaMasuk
             ? patient.diagnosaMasuk
             : '';
           const age = getPatientAge(patient.dob);
          const hasAttention = critical > 0 || urgent > 0 || infoCount > 0;

          return (
            <Card
              key={patient.noRM}
               role="button"
               tabIndex={0}
               aria-label={`Buka detail pasien ${patient.namaPasien}`}
               onKeyDown={event => {
                 if (event.target !== event.currentTarget) return;
                 if (event.key === 'Enter' || event.key === ' ') {
                   event.preventDefault();
                   openDetail(patient);
                 }
               }}
               className="group cursor-pointer overflow-hidden border-cyan-100 bg-card shadow-sm outline-none transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              onClick={() => openDetail(patient)}
            >
              <div className={`h-1.5 ${sideColor}`} />
               <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300">
                      <User2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] font-semibold tracking-wide text-muted-foreground">
                          {patient.noRM}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          isTrakCare
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}>
                          {isTrakCare ? <Cloud className="h-3 w-3" /> : <User2 className="h-3 w-3" />}
                          {isTrakCare ? 'TrakCare' : 'Manual'}
                        </span>
                      </div>
                      <h3 className="mt-1 line-clamp-2 text-base font-bold leading-tight text-foreground transition-colors group-hover:text-primary">
                        {getPatientDisplayName(patient)}
                      </h3>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                         Episode <span className="font-mono">{patient.episodeNo || '-'}</span>
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={patient.bookmarked ? 'Hapus penanda pasien' : 'Tandai pasien'}
                    onClick={e => toggleBookmark(patient, e)}
                    className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-950/30"
                  >
                    <Star className={`h-5 w-5 ${patient.bookmarked ? 'fill-amber-500 text-amber-500' : ''}`} />
                  </button>
                </div>

                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${
                      isDischargePending
                        ? 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-300'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                    }`}>
                      <Activity className="h-3 w-3" /> {isDischargePending ? 'Menunggu konfirmasi pulang' : 'Rawat inap aktif'}
                   </span>
                   {patient.sexDesc && (
                     <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                       <User2 className="h-3 w-3" /> {patient.sexDesc}
                     </span>
                   )}
                   {age !== null && (
                     <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                       <Cake className="h-3 w-3" /> {age} tahun
                     </span>
                   )}
                   {patient.dob && (
                     <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-[10px] font-semibold text-cyan-700 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-300">
                       <Cake className="h-3 w-3" /> Lahir {normalizeTrakCareBirthDate(patient.dob)}
                     </span>
                   )}
                   {patient.alertVIP && (
                     <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                       <ShieldCheck className="h-3 w-3" /> {patient.alertVIP}
                     </span>
                   )}
                 </div>

                 <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                   <div className="min-w-0 rounded-xl border border-cyan-100 bg-cyan-50/80 px-3 py-2.5 dark:border-cyan-900/40 dark:bg-cyan-950/25">
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                      <MapPin className="h-3 w-3" /> Lokasi
                    </div>
                    <p className="truncate text-xs font-bold text-foreground" title={getPatientRoomLabel(patient)}>{getPatientRoomLabel(patient)}</p>
                  </div>
                  <div className="min-w-0 rounded-xl bg-muted/60 px-3 py-2.5">
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Stethoscope className="h-3 w-3" /> DPJP
                    </div>
                    <p className="truncate text-xs font-bold text-foreground">{patient.dpjp ? `Dr. ${patient.dpjp}` : '-'}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Dokter penanggung jawab</p>
                  </div>
                  <div className="min-w-0 rounded-xl bg-muted/60 px-3 py-2.5">
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Calendar className="h-3 w-3" /> Masuk
                    </div>
                    <p className="text-xs font-bold text-foreground">{formatPatientDate(patient.admissionDate)}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Hari ke-{getPatientLengthOfStay(patient.admissionDate)}</p>
                  </div>
                  <div className="min-w-0 rounded-xl bg-blue-50 px-3 py-2.5 dark:bg-blue-950/30">
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                      <ShieldCheck className="h-3 w-3" /> Penjamin
                    </div>
                    <p className="truncate text-xs font-bold text-blue-800 dark:text-blue-200">{patient.payor || 'Belum diisi'}</p>
                    <p className="mt-0.5 truncate text-[11px] text-blue-700/70 dark:text-blue-300/70">{patient.statusBPJS || 'Status belum diisi'}</p>
                  </div>
                 </div>

                 <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                   <div className="min-w-0 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2.5 dark:border-blue-900/50 dark:bg-blue-950/20">
                     <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                       <Mail className="h-3 w-3" /> Email Asuransi
                     </div>
                     {patient.emailAsuransi ? (
                       <p className="truncate text-xs font-bold text-blue-900 dark:text-blue-200" title={patient.emailAsuransi}>{patient.emailAsuransi}</p>
                     ) : (
                       <p className="text-xs font-medium text-muted-foreground">Belum diisi</p>
                     )}
                   </div>
                   <div className="min-w-0 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2.5 dark:border-violet-900/50 dark:bg-violet-950/20">
                     <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                       <CreditCard className="h-3 w-3" /> No. Kartu Asuransi
                     </div>
                     <p className={`truncate text-xs font-bold ${patient.noKartuAsuransi ? 'text-violet-900 dark:text-violet-200' : 'text-muted-foreground'}`} title={patient.noKartuAsuransi || undefined}>
                       {patient.noKartuAsuransi || 'Belum diisi'}
                     </p>
                   </div>
                 </div>

                {diagnosis && (
                   <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/[0.035] px-3 py-2.5">
                     <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                       <FileText className="h-3.5 w-3.5" />
                     </div>
                    <div className="min-w-0">
                       <div className="flex items-center gap-2">
                         <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Diagnosa utama</p>
                         {admissionDiagnosis && <span className="text-[10px] text-muted-foreground">+ diagnosa masuk</span>}
                       </div>
                       <p className="mt-0.5 line-clamp-2 text-xs font-semibold leading-relaxed text-foreground" title={diagnosis}>{diagnosis}</p>
                       {admissionDiagnosis && (
                         <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground" title={admissionDiagnosis}>
                           Masuk: {admissionDiagnosis}
                         </p>
                       )}
                    </div>
                  </div>
                )}

                {patientEmails.length > 0 && (
                  <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2.5 dark:border-sky-900/50 dark:bg-sky-950/20">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                        <Mail className="h-3.5 w-3.5" /> Email Outlook
                      </p>
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-900/50 dark:text-sky-300">
                        {patientEmails.length}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {patientEmails.slice(0, 2).map(email => (
                        <div key={email.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <p className="min-w-0 truncate font-semibold text-sky-900 dark:text-sky-200" title={email.subject}>
                            {email.subject}
                          </p>
                          {email.webLink ? (
                            <a
                              href={email.webLink}
                              target="_blank"
                              rel="noreferrer"
                              onClick={event => event.stopPropagation()}
                              className="shrink-0 text-[10px] font-bold text-sky-700 hover:underline dark:text-sky-300"
                            >
                              Buka
                            </a>
                          ) : (
                            <span className="shrink-0 text-[10px] text-sky-700/70 dark:text-sky-300/70">
                              {new Date(email.receivedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                      ))}
                      {patientEmails.length > 2 && (
                        <p className="text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                          +{patientEmails.length - 2} email lainnya
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className={`mt-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                  hasAttention
                    ? 'border-orange-100 bg-orange-50/70 dark:border-orange-900/40 dark:bg-orange-950/20'
                    : 'border-emerald-100 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/20'
                }`}>
                  <div className="flex min-w-0 items-center gap-2">
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      hasAttention ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300'
                    }`}>
                      {hasAttention ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-xs font-bold ${hasAttention ? 'text-orange-800 dark:text-orange-200' : 'text-emerald-800 dark:text-emerald-200'}`}>
                        {hasAttention ? 'Perlu perhatian' : 'Tidak ada pending aktif'}
                      </p>
                      <p className={`truncate text-[11px] ${hasAttention ? 'text-orange-700 dark:text-orange-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                        {critical > 0 ? `${critical} critical · ` : ''}{urgent > 0 ? `${urgent} urgent · ` : ''}{normal > 0 ? `${normal} normal · ` : ''}{infoCount > 0 ? `${infoCount} info` : !ptPendings.length ? 'Data pasien clear' : ''}
                      </p>
                    </div>
                  </div>
                  {critical > 0 && <span className="shrink-0 rounded-full bg-red-500 px-2 py-1 text-[10px] font-bold text-white">CRITICAL</span>}
                  {critical === 0 && urgent > 0 && <span className="shrink-0 rounded-full bg-orange-500 px-2 py-1 text-[10px] font-bold text-white">URGENT</span>}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border/70 pt-3">
                   <button
                     type="button"
                     onClick={e => { e.stopPropagation(); openDetail(patient); }}
                     className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                   >
                     Buka Detail <ChevronRight className="h-3.5 w-3.5" />
                   </button>
                   {shouldConfirmMissingInpatient() && isDischargePending && (
                     <button
                       type="button"
                       onClick={e => { e.stopPropagation(); setPendingDischargePatient(patient); }}
                       className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-orange-300 bg-orange-50 px-2.5 text-[11px] font-bold text-orange-700 transition-colors hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300"
                     >
                       <CheckCircle2 className="h-3.5 w-3.5" /> Pasien Pulang
                     </button>
                   )}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setUraianPatient(patient); }}
                    title="Cetak Uraian Konfirmasi Asuransi"
                    className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                  >
                    <Printer className="h-3.5 w-3.5" /> Cetak Uraian
                  </button>
                  <button
                    type="button"
                    onClick={e => openActionPlan(patient, e)}
                    title="Masukkan tanggal rencana tindakan"
                    className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2.5 text-[11px] font-semibold text-orange-700 transition-colors hover:bg-orange-100 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-300"
                  >
                    <Calendar className="h-3.5 w-3.5" /> Rencana Tindakan
                  </button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      )}

      {!isLoadingPatients && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-primary/30 bg-card px-5 py-16 text-center text-muted-foreground shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {patients.length === 0 ? <Users className="h-7 w-7" /> : <Search className="h-7 w-7" />}
          </div>
          <p className="text-lg font-semibold text-foreground">{patients.length === 0 ? 'Belum ada pasien rawat inap' : 'Tidak ada pasien yang cocok'}</p>
          <p className="text-sm mt-1">
            {patients.length === 0
              ? 'Tambahkan pasien manual atau jalankan sinkronisasi TrakCare untuk memulai daftar.'
              : 'Ubah kata kunci atau filter untuk melihat hasil lainnya.'}
          </p>
          {patients.length === 0 && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={openAddPatient} data-testid="button-empty-add-patient"><UserPlus className="h-4 w-4" /> Tambah pasien</Button>
              <Button size="sm" variant="outline" onClick={() => handleSync(false)} data-testid="button-empty-sync"><RefreshCw className="h-4 w-4" /> Sinkronisasi</Button>
            </div>
          )}
        </div>
      )}

      {/* ───── DETAIL MODAL ───────────────────────────────── */}
      {selectedPatient && (
        <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2 flex-wrap">
                <span>{getPatientDisplayName(selectedPatient)}</span>
                <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded">{selectedPatient.noRM}</span>
                {selectedPatient.bookmarked && <Star className="w-4 h-4 fill-amber-500 text-amber-500" />}
                {selectedPatient.sumberData === 'trakcare' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-700">
                    <Cloud className="w-3 h-3" /> TrakCare
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">
                    <User2 className="w-3 h-3" /> Manual
                  </span>
                )}
              </DialogTitle>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {isLoadingPatientDetail ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Mengambil data lengkap pasien dari Cloud...
                  </>
                ) : patientDetailSource === 'cloud' ? (
                  <>
                    <Cloud className="w-3.5 h-3.5 text-blue-500" />
                    Data detail dari Cloud Spreadsheet
                  </>
                ) : patientDetailSource === 'local' ? (
                  <>
                    <Database className="w-3.5 h-3.5" />
                    Sebagian data menggunakan cache lokal
                  </>
                ) : null}
              </div>
            </DialogHeader>

            <Tabs value={detailTab} onValueChange={v => setDetailTab(v as 'info' | 'mail' | 'operan' | 'estimasi')} className="mt-2">
              <TabsList className="mb-4">
                <TabsTrigger value="info" className="gap-1.5">
                  <User2 className="w-3.5 h-3.5" /> Informasi Pasien
                </TabsTrigger>
                <TabsTrigger value="mail" className="gap-1.5">
                  <Mail className="w-3.5 h-3.5" /> Mail Asuransi
                  {outlookEmails.filter(email => email.matchedNoRM === selectedPatient.noRM).length > 0 && (
                    <span className="rounded-full bg-sky-100 px-1.5 text-[10px] text-sky-700">
                      {outlookEmails.filter(email => email.matchedNoRM === selectedPatient.noRM).length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="operan" className="gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Operan
                </TabsTrigger>
                <TabsTrigger value="estimasi" className="gap-1.5">
                  <DollarSign className="w-3.5 h-3.5" /> Estimasi Rawat
                </TabsTrigger>
              </TabsList>

              <TabsContent value="mail" className="space-y-4">
                <Card className="shadow-none border-sky-200 bg-sky-50/30 dark:border-sky-900/50 dark:bg-sky-950/10">
                  <CardHeader className="py-2.5 px-4 bg-sky-50/80 border-b border-sky-200 rounded-t-lg dark:bg-sky-950/30 dark:border-sky-900/50">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Mail className="w-4 h-4 text-sky-600 dark:text-sky-300" /> Email Asuransi Teridentifikasi
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    {outlookEmails
                      .filter(email => email.matchedNoRM === selectedPatient.noRM)
                      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
                      .map(email => (
                        <div key={email.id} className="rounded-lg border bg-background p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold">{email.subject}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Dari {email.senderName || email.senderAddress || '-'} · {formatDateTime(email.receivedAt)}
                              </p>
                            </div>
                            {email.webLink && (
                              <a href={email.webLink} target="_blank" rel="noreferrer">
                                <Button variant="outline" size="sm" className="gap-1.5">
                                  Buka Outlook
                                </Button>
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    {outlookEmails.filter(email => email.matchedNoRM === selectedPatient.noRM).length === 0 && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        Belum ada email Outlook yang subjeknya cocok dengan nama pasien ini.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── Tab: Informasi Pasien ── */}
              <TabsContent value="info" className="space-y-4">
                <Card className="shadow-none border-border">
                  <CardHeader className="py-2.5 px-4 bg-muted/40 border-b border-border rounded-t-lg">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <User2 className="w-4 h-4" /> Informasi Pasien
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3 text-sm">
                    {[
                      { label: 'No Episode', value: selectedPatient.episodeNo },
                      { label: 'Tanggal Lahir', value: normalizeTrakCareBirthDate(selectedPatient.dob) },
                      { label: 'Tgl Masuk', value: selectedPatient.admissionDate },
                      { label: 'Jenis Kelamin', value: selectedPatient.sexDesc },
                      { label: 'Agama', value: selectedPatient.agama },
                    ].map(row => (
                      <div key={row.label}>
                        <span className="text-xs text-muted-foreground">{row.label}</span>
                        <p className="font-medium">{row.label === 'No Episode' ? <EpisodeLink episode={row.value} /> : (row.value || '-')}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                 <Card className="shadow-none border-blue-200 bg-blue-50/30 dark:border-blue-900/50 dark:bg-blue-950/10">
                   <CardHeader className="py-2.5 px-4 bg-blue-50/80 border-b border-blue-200 rounded-t-lg dark:bg-blue-950/30 dark:border-blue-900/50">
                     <CardTitle className="text-sm font-semibold flex items-center gap-2">
                       <Mail className="w-4 h-4 text-blue-600 dark:text-blue-300" /> Data Asuransi
                     </CardTitle>
                   </CardHeader>
                   <CardContent className="p-4 space-y-3">
                     <p className="text-xs text-muted-foreground">Digunakan untuk pengiriman KTM melalui aplikasi email.</p>
                     <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                       <div className="space-y-1.5">
                         <label className="text-xs font-semibold">Email Asuransi</label>
                         <Input
                           type="email"
                           value={emailAsuransi}
                           onChange={e => setEmailAsuransi(e.target.value)}
                           placeholder="contoh@asuransi.co.id"
                           className="h-9 text-sm"
                         />
                       </div>
                       <div className="space-y-1.5">
                         <label className="text-xs font-semibold">No. Kartu Asuransi</label>
                         <Input
                           value={noKartuAsuransi}
                           onChange={e => setNoKartuAsuransi(e.target.value)}
                           placeholder="Nomor kartu peserta"
                           className="h-9 text-sm"
                         />
                       </div>
                     </div>
                     <Button
                       size="sm"
                       onClick={handleSaveInsurance}
                       disabled={savingInsurance}
                       className="gap-1.5 h-9"
                     >
                       <Save className="w-3.5 h-3.5" />
                       {savingInsurance ? 'Menyimpan...' : 'Simpan Data Asuransi'}
                     </Button>
                   </CardContent>
                 </Card>

                <Card className="shadow-none border-border">
                  <CardHeader className="py-2.5 px-4 bg-muted/40 border-b border-border rounded-t-lg">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <BedDouble className="w-4 h-4" /> Ruang & Dokter
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3 text-sm">
                    {(parsedSelectedWardRoom
                      ? [
                          { label: 'Ruangan', value: parsedSelectedWardRoom.ward },
                          { label: 'Kamar', value: parsedSelectedWardRoom.room },
                          { label: 'Bed', value: parsedSelectedWardRoom.bed },
                          { label: 'Kelas', value: parsedSelectedWardRoom.roomType },
                          { label: 'DPJP', value: selectedPatient.dpjp },
                        ]
                      : [
                          { label: 'Ruangan', value: `${selectedPatient.ward || selectedPatient.roomName} — ${selectedPatient.roomType}` },
                          { label: 'Bed', value: selectedPatient.bedCode },
                          { label: 'DPJP', value: selectedPatient.dpjp },
                        ]
                    ).map(row => (
                      <div key={row.label}>
                        <span className="text-xs text-muted-foreground">{row.label}</span>
                        <p className="font-medium">{row.value || '-'}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="shadow-none border-border">
                  <CardHeader className="py-2.5 px-4 bg-muted/40 border-b border-border rounded-t-lg">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <CreditCard className="w-4 h-4" /> Penjaminan
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3 text-sm">
                    {[
                      { label: 'Penjamin', value: selectedPatient.payor },
                      { label: 'Status BPJS', value: selectedPatient.statusBPJS },
                      { label: 'Alert VIP', value: selectedPatient.alertVIP },
                    ].map(row => (
                      <div key={row.label}>
                        <span className="text-xs text-muted-foreground">{row.label}</span>
                        <p className="font-medium">{row.value || '-'}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="shadow-none border-primary/30 bg-primary/5">
                  <CardHeader className="py-2.5 px-4 bg-primary/10 border-b border-primary/20 rounded-t-lg">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Phone className="w-4 h-4 text-primary" /> No HP Penanggung Jawab
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Digunakan untuk generate Pesan Kasir via WhatsApp.</p>
                    <div className="flex gap-2">
                      <Input
                        value={noHpPJ}
                        onChange={e => setNoHpPJ(e.target.value)}
                        placeholder="cth: 08123456789"
                        inputMode="tel"
                        className="flex-1 h-9 text-sm"
                      />
                      <Button
                        size="sm"
                        onClick={handleSaveNoHpPJ}
                        disabled={savingHp}
                        className="gap-1.5 h-9 shrink-0"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {savingHp ? 'Menyimpan...' : 'Simpan'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {(selectedPatient.diagnosaMasuk || selectedPatient.diagnosakUtama) && (
                  <Card className="shadow-none border-border">
                    <CardHeader className="py-2.5 px-4 bg-muted/40 border-b border-border rounded-t-lg">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Stethoscope className="w-4 h-4" /> Diagnosa
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 space-y-2 text-sm">
                      {selectedPatient.diagnosaMasuk && (
                        <div>
                          <span className="text-xs text-muted-foreground">Diagnosa Masuk</span>
                          <p className="font-medium">{selectedPatient.diagnosaMasuk}</p>
                        </div>
                      )}
                      {selectedPatient.diagnosakUtama && (
                        <div>
                          <span className="text-xs text-muted-foreground">Diagnosa Utama</span>
                          <p className="font-medium">{selectedPatient.diagnosakUtama}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ── Tab: Operan ── */}
              <TabsContent value="operan" className="space-y-5">

                {/* Daftar Pending */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-base">
                      Daftar Pending
                       {getPatientPendings(selectedPatient).length > 0 && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                           ({getPatientPendings(selectedPatient).length} aktif)
                        </span>
                      )}
                    </h3>
                    <Button size="sm" className="gap-1.5 h-8" onClick={openAddPending}>
                      <Plus className="w-3.5 h-3.5" /> Tambah Pending
                    </Button>
                  </div>

                  <div className="space-y-2.5">
                     {getPatientPendings(selectedPatient).length === 0 ? (
                      <div className="text-center py-8 border border-dashed border-border rounded-lg text-muted-foreground text-sm">
                        <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        Belum ada pending aktif untuk pasien ini
                      </div>
                    ) : (
                       getPatientPendings(selectedPatient).map(p => (
                        <div key={p.id} className={`p-3 rounded-lg border-l-4 bg-card border border-border ${
                          p.prioritas === 'critical' ? 'border-l-red-500' :
                          p.prioritas === 'urgent'   ? 'border-l-orange-500' :
                                                       'border-l-emerald-500'
                        }`}>
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold border ${prioritasColor(p.prioritas)}`}>
                              {p.prioritas.toUpperCase()}
                            </span>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${statusColor(p.status)}`}>
                              {p.status.toUpperCase()}
                            </span>
                            <span className="text-xs text-muted-foreground">{p.kategori}</span>
                          </div>
                          <p className="text-sm leading-snug">{p.isiPending}</p>
                          <p className="text-xs text-muted-foreground mt-1.5">
                            {formatDateTime(p.createdAt)} · {p.userName}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Just Info */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-base">
                      Just Info
                       {getPatientJustInfos(selectedPatient).length > 0 && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                           ({getPatientJustInfos(selectedPatient).length})
                        </span>
                      )}
                    </h3>
                    <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={openAddInfo}>
                      <Plus className="w-3.5 h-3.5" /> Tambah Info
                    </Button>
                  </div>

                  <div className="space-y-2">
                     {getPatientJustInfos(selectedPatient).length === 0 ? (
                      <div className="text-center py-8 border border-dashed border-border rounded-lg text-muted-foreground text-sm">
                        <Info className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        Belum ada just info untuk pasien ini
                      </div>
                    ) : (
                       getPatientJustInfos(selectedPatient).map(j => (
                        <div key={j.id} className="flex gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                          <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm leading-snug">{j.isi}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatDateTime(j.createdAt)} · {j.userName}
                            </p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditInfo(j)}
                              title="Edit info"
                              className="p-1.5 rounded hover:bg-blue-200 dark:hover:bg-blue-800 text-blue-600 dark:text-blue-400 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteInfoId(j.id)}
                              title="Hapus info"
                              className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-500 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* ── Tab: Estimasi Rawat ── */}
              <TabsContent value="estimasi">
                {user && (
                  <EstimasiPanel
                    isInline
                    isOpen={detailTab === 'estimasi'}
                    patient={selectedPatient}
                    user={user}
                    onClose={() => setDetailTab('info')}
                  />
                )}
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}

      <Dialog
        open={!!pendingDischargePatient}
        onOpenChange={open => {
          if (!open && !confirmingDischarge) setPendingDischargePatient(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Konfirmasi Pasien Pulang</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm font-semibold text-foreground">
              Pasien sudah pulang. Pastikan jaminan akhir sudah terbit
            </p>
            {pendingDischargePatient && (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <div className="font-semibold">{pendingDischargePatient.namaPasien}</div>
                <div className="text-xs text-muted-foreground">
                  No. RM {pendingDischargePatient.noRM} · Episode {pendingDischargePatient.episodeNo || '-'}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Pilih “Iya” untuk memindahkan pasien ke Riwayat Pasien Pulang.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDischargePatient(null)}
              disabled={confirmingDischarge}
            >
              Tidak
            </Button>
            <Button
              type="button"
              onClick={handleConfirmPatientDischarge}
              disabled={confirmingDischarge}
              className="gap-2 bg-orange-600 text-white hover:bg-orange-700"
            >
              {confirmingDischarge ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Iya, Pasien Pulang
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(actionPlanPatient)} onOpenChange={open => { if (!open) setActionPlanPatient(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex flex-col gap-1">
              <span className="flex items-center gap-2"><Calendar className="w-4 h-4 text-orange-600" /> Pasien Ada Tindakan</span>
              {actionPlanPatient && <span className="text-sm font-normal text-muted-foreground">{actionPlanPatient.namaPasien} · {actionPlanPatient.noRM}</span>}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveActionPlan} className="space-y-4">
            <div className="rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 p-3 text-sm text-orange-800 dark:text-orange-300">
              Masukkan tanggal rencana tindakan. Pasien akan tampil di Checklist Pasien mulai hari berikutnya untuk pengecekan billing tindakan.
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Tanggal Rencana Tindakan <span className="text-red-500">*</span></label>
              <Input type="date" value={actionPlanDate} onChange={event => setActionPlanDate(event.target.value)} required autoFocus />
              <p className="text-xs text-muted-foreground">Contoh: tindakan 2 Agustus 2026 akan muncul di Checklist pada 3 Agustus 2026.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setActionPlanPatient(null)}>Batal</Button>
              <Button type="submit" disabled={savingActionPlan || !actionPlanDate} className="bg-orange-600 hover:bg-orange-700 text-white">
                {savingActionPlan ? 'Menyimpan...' : 'Simpan Rencana Tindakan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ───── MODAL TAMBAH PASIEN MANUAL ────────────────── */}
      <Dialog open={isAddPatientOpen} onOpenChange={v => { setIsAddPatientOpen(v); if (!v) setAddPatientError(''); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5" /> Tambah Pasien Manual
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSavePatient} className="space-y-4 pt-1">
            {addPatientError && (
              <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg px-3 py-2">
                {addPatientError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* No RM */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">No RM <span className="text-red-500">*</span></label>
                <Input
                  value={addPatientForm.noRM}
                  onChange={e => setAddPatientForm(f => ({ ...f, noRM: e.target.value }))}
                  placeholder="cth: 1234567"
                  required
                  autoFocus
                />
              </div>

              {/* Nama Pasien */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Nama Pasien <span className="text-red-500">*</span></label>
                <Input
                  value={addPatientForm.namaPasien}
                  onChange={e => setAddPatientForm(f => ({ ...f, namaPasien: e.target.value }))}
                  placeholder="Nama lengkap pasien"
                  required
                />
              </div>

              {/* Episode No */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">No Episode</label>
                <Input
                  value={addPatientForm.episodeNo}
                  onChange={e => setAddPatientForm(f => ({ ...f, episodeNo: e.target.value }))}
                  placeholder="cth: EP-20260720-001"
                />
              </div>

              {/* Tanggal Masuk */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Tanggal Masuk</label>
                <Input
                  type="date"
                  value={addPatientForm.admissionDate}
                  onChange={e => setAddPatientForm(f => ({ ...f, admissionDate: e.target.value }))}
                />
              </div>

              {/* Ruangan */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Ruangan</label>
                <Input
                  value={addPatientForm.ward}
                  onChange={e => setAddPatientForm(f => ({ ...f, ward: e.target.value }))}
                  placeholder="cth: MELATI"
                />
              </div>

              {/* Kelas */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Kelas</label>
                <Input
                  value={addPatientForm.roomType}
                  onChange={e => setAddPatientForm(f => ({ ...f, roomType: e.target.value }))}
                  placeholder="cth: KELAS 1"
                />
              </div>

              {/* No Bed */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Nomor Bed</label>
                <Input
                  value={addPatientForm.bedCode}
                  onChange={e => setAddPatientForm(f => ({ ...f, bedCode: e.target.value }))}
                  placeholder="cth: ML-01A"
                />
              </div>

              {/* DPJP */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Dokter DPJP</label>
                <Input
                  value={addPatientForm.dpjp}
                  onChange={e => setAddPatientForm(f => ({ ...f, dpjp: e.target.value }))}
                  placeholder="Nama dokter"
                />
              </div>

              {/* Penjamin */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Penjamin</label>
                <Input
                  value={addPatientForm.payor}
                  onChange={e => setAddPatientForm(f => ({ ...f, payor: e.target.value }))}
                  placeholder="cth: BPJS / Umum / Asuransi"
                />
              </div>

              {/* Status BPJS */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Status BPJS</label>
                <Input
                  value={addPatientForm.statusBPJS}
                  onChange={e => setAddPatientForm(f => ({ ...f, statusBPJS: e.target.value }))}
                  placeholder="cth: Aktif / Non-aktif"
                />
              </div>

              {/* Jenis Kelamin */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Jenis Kelamin</label>
                <select
                  value={addPatientForm.sexDesc}
                  onChange={e => setAddPatientForm(f => ({ ...f, sexDesc: e.target.value }))}
                  className="h-10 w-full px-3 border border-input rounded-md bg-background text-sm"
                >
                  <option value="">— Pilih —</option>
                  <option value="L">Laki-laki</option>
                  <option value="P">Perempuan</option>
                </select>
              </div>

              {/* Tanggal Lahir */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Tanggal Lahir</label>
                <Input
                  type="date"
                  value={addPatientForm.dob}
                  onChange={e => setAddPatientForm(f => ({ ...f, dob: e.target.value }))}
                />
              </div>
            </div>

            {/* Diagnosa Masuk */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Diagnosa Masuk</label>
              <Input
                value={addPatientForm.diagnosaMasuk}
                onChange={e => setAddPatientForm(f => ({ ...f, diagnosaMasuk: e.target.value }))}
                placeholder="Diagnosa masuk pasien"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Email Asuransi</label>
                <Input
                  type="email"
                  value={addPatientForm.emailAsuransi}
                  onChange={e => setAddPatientForm(f => ({ ...f, emailAsuransi: e.target.value }))}
                  placeholder="contoh@asuransi.co.id"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">No. Kartu Asuransi</label>
                <Input
                  value={addPatientForm.noKartuAsuransi}
                  onChange={e => setAddPatientForm(f => ({ ...f, noKartuAsuransi: e.target.value }))}
                  placeholder="Nomor kartu peserta"
                />
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-400">
              <b>Catatan:</b> Pasien manual tidak akan terpengaruh oleh proses sinkronisasi TrakCare.
            </div>

            <DialogFooter className="pt-1">
              <Button type="button" variant="outline" onClick={() => setIsAddPatientOpen(false)}>Batal</Button>
              <Button type="submit" disabled={savingPatient} className="min-w-[140px]">
                {savingPatient ? 'Menyimpan...' : 'Simpan Pasien'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ───── MODAL TAMBAH PENDING ──────────────────────── */}
      <Dialog open={isAddPendingOpen} onOpenChange={v => setIsAddPendingOpen(v)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-col gap-0.5">
              <span>Tambah Pending</span>
              {selectedPatient && (
                <span className="text-sm font-normal text-muted-foreground">
                  {selectedPatient.namaPasien} · {selectedPatient.noRM}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {selectedPatient && (
            <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground flex gap-4 flex-wrap mb-1">
              <span>Ruangan: <b className="text-foreground">{selectedPatient.ward || selectedPatient.roomName}</b></span>
              <span>Kelas: <b className="text-foreground">{selectedPatient.roomType}</b></span>
              <span>DPJP: <b className="text-foreground">{selectedPatient.dpjp}</b></span>
              <span>Penjamin: <b className="text-foreground">{selectedPatient.payor}</b></span>
            </div>
          )}

          <form onSubmit={handleSavePending} className="space-y-4 pt-1">
            {/* Kategori + Shift */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Kategori <span className="text-red-500">*</span></label>
                <select
                  value={pendingForm.kategori}
                  onChange={e => setPendingForm(f => ({ ...f, kategori: e.target.value }))}
                  className="h-10 w-full px-3 border border-input rounded-md bg-background text-sm"
                  required
                >
                  {KATEGORI_LIST.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Shift</label>
                <select
                  value={pendingForm.shift}
                  onChange={e => setPendingForm(f => ({ ...f, shift: e.target.value as any }))}
                  className="h-10 w-full px-3 border border-input rounded-md bg-background text-sm"
                >
                  <option value="pagi">Pagi (07–14)</option>
                  <option value="sore">Sore (14–21)</option>
                  <option value="malam">Malam (21–07)</option>
                </select>
              </div>
            </div>

            {/* Isi Pending */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Isi Pending <span className="text-red-500">*</span></label>
              <textarea
                className="w-full min-h-[110px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                placeholder="Jelaskan tugas yang perlu ditindaklanjuti oleh shift berikutnya..."
                value={pendingForm.isiPending}
                onChange={e => setPendingForm(f => ({ ...f, isiPending: e.target.value }))}
                required
                autoFocus
              />
            </div>

            {/* Prioritas */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Prioritas <span className="text-red-500">*</span></label>
              <div className="grid grid-cols-3 gap-2">
                {(['normal', 'urgent', 'critical'] as const).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPendingForm(f => ({ ...f, prioritas: p }))}
                    className={`py-2.5 rounded-lg border-2 text-sm font-semibold transition-all ${
                      pendingForm.prioritas === p
                        ? p === 'critical' ? 'bg-red-500 border-red-500 text-white shadow-sm'
                          : p === 'urgent' ? 'bg-orange-500 border-orange-500 text-white shadow-sm'
                          : 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                        : 'bg-background border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Deadline + Foto */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> Deadline <span className="font-normal text-muted-foreground">(opsional)</span>
                </label>
                <Input
                  type="datetime-local"
                  value={pendingForm.deadline}
                  onChange={e => setPendingForm(f => ({ ...f, deadline: e.target.value }))}
                  className="h-10 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold flex items-center gap-1">
                  <Upload className="w-3.5 h-3.5" /> Foto <span className="font-normal text-muted-foreground">(opsional)</span>
                </label>
                <label className="flex items-center gap-2 h-10 px-3 border border-input rounded-md bg-background cursor-pointer hover:bg-accent transition-colors text-sm">
                  <span className="text-muted-foreground truncate">
                    {pendingForm.fotoBase64 ? '✓ Foto dipilih' : 'Pilih foto...'}
                  </span>
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                </label>
              </div>
            </div>

            {pendingForm.fotoBase64 && (
              <div className="relative inline-block">
                <img src={pendingForm.fotoBase64} alt="Preview" className="h-20 w-auto rounded-lg border border-border object-cover" />
                <button
                  type="button"
                  onClick={() => setPendingForm(f => ({ ...f, fotoBase64: '' }))}
                  className="absolute -top-2 -right-2 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            <DialogFooter className="pt-1">
              <Button type="button" variant="outline" onClick={() => setIsAddPendingOpen(false)}>Batal</Button>
              <Button type="submit" disabled={savingPending} className="min-w-[130px]">
                {savingPending ? 'Menyimpan...' : 'Simpan Pending'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ───── MODAL TAMBAH JUST INFO ────────────────────── */}
      <Dialog open={isAddInfoOpen} onOpenChange={v => setIsAddInfoOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex flex-col gap-0.5">
              <span>Tambah Just Info</span>
              {selectedPatient && (
                <span className="text-sm font-normal text-muted-foreground">
                  {selectedPatient.namaPasien} · {selectedPatient.noRM}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveInfo} className="space-y-4 pt-1">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-400">
              <b>Just Info</b> adalah catatan informasi penting yang perlu diketahui shift berikutnya, namun tidak memerlukan tindak lanjut khusus.
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Isi Informasi <span className="text-red-500">*</span></label>
              <textarea
                className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                placeholder="Contoh: Pasien meminta dipindah ke ruang VIP, sudah dikonfirmasi ke keluarga. Menunggu konfirmasi kamar dari housekeeping."
                value={infoText}
                onChange={e => setInfoText(e.target.value)}
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground text-right">{infoText.length} karakter</p>
            </div>

            <div className="bg-muted/50 rounded-lg p-2.5 text-xs text-muted-foreground flex gap-3">
              <span>Shift: <b className="text-foreground capitalize">{getCurrentShift()}</b></span>
              <span>Dicatat oleh: <b className="text-foreground">{user?.namaLengkap}</b></span>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddInfoOpen(false)}>Batal</Button>
              <Button
                type="submit"
                disabled={savingInfo || !infoText.trim()}
                className="min-w-[130px] bg-blue-600 hover:bg-blue-700 text-white"
              >
                {savingInfo ? 'Menyimpan...' : 'Simpan Info'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ───── MODAL EDIT JUST INFO ──────────────────────── */}
      <Dialog open={!!editingInfo} onOpenChange={v => { if (!v) setEditingInfo(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-blue-500" /> Edit Just Info
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveEditInfo} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Isi Informasi <span className="text-red-500">*</span></label>
              <textarea
                className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                placeholder="Isi informasi..."
                value={editInfoText}
                onChange={e => setEditInfoText(e.target.value)}
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground text-right">{editInfoText.length} karakter</p>
            </div>
            {editingInfo && (
              <div className="bg-muted/50 rounded-lg p-2.5 text-xs text-muted-foreground flex gap-3">
                <span>Dicatat oleh: <b className="text-foreground">{editingInfo.userName}</b></span>
                <span>Shift: <b className="text-foreground capitalize">{editingInfo.shift}</b></span>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingInfo(null)}>Batal</Button>
              <Button
                type="submit"
                disabled={savingEditInfo || !editInfoText.trim()}
                className="min-w-[130px] bg-blue-600 hover:bg-blue-700 text-white"
              >
                {savingEditInfo ? 'Menyimpan...' : 'Simpan Perubahan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ───── URAIAN KONFIRMASI ASURANSI ────────────────── */}
      {uraianPatient && user && (
        <UraianKonfirmasiPanel
          patient={uraianPatient}
          user={user}
          onClose={() => setUraianPatient(null)}
        />
      )}

      {/* ───── KONFIRMASI HAPUS JUST INFO ────────────────── */}
      <Dialog open={!!confirmDeleteInfoId} onOpenChange={v => { if (!v) setConfirmDeleteInfoId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-4 h-4" /> Hapus Just Info
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Apakah Anda yakin ingin menghapus info ini? Tindakan ini tidak dapat dibatalkan.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteInfoId(null)}>Batal</Button>
            <Button
              variant="destructive"
              disabled={deletingInfo}
              onClick={handleDeleteInfo}
              className="min-w-[110px]"
            >
              {deletingInfo ? 'Menghapus...' : 'Ya, Hapus'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Payor badge component ─────────────────────────────────────────────────────
function PayorBadge({ payor }: { payor?: string }) {
  if (!payor) return null;
  const upper = payor.toUpperCase();
  let cls = '';
  let dot = '';
  if (upper.includes('BPJS')) {
    cls = 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700';
    dot = 'bg-blue-500';
  } else {
    cls = 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700';
    dot = 'bg-emerald-500';
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      {payor}
    </span>
  );
}

// ── Stat card component ───────────────────────────────────────────────────────
function StatCard({
  icon, label, value, color, onClick, active,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      onKeyDown={event => {
        if (!onClick) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? active : undefined}
      data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}
      className={`rounded-xl border px-4 py-3 flex items-center gap-3 transition-all
        ${onClick ? 'cursor-pointer hover:shadow-md' : ''}
        ${active ? 'border-primary ring-1 ring-primary/40' : 'border-border bg-card'}
        ${color}`}
    >
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold leading-tight">{value.toLocaleString('id-ID')}</div>
      </div>
    </div>
  );
}
