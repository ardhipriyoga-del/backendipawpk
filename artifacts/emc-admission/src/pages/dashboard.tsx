import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDB } from '../lib/db';
import { fetchFromInpatientUrl, fetchIGDData, getEndpoints } from '../lib/trakcareClient';
import { Users, Clock, CheckCircle2, AlertTriangle, AlertCircle, Share2, Eye, EyeOff, X, Activity, RefreshCw, Info, Bell, FileSignature } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { hashPassword, generateUUID, getCurrentShift } from '../lib/auth';
import { generateHandoverPDF } from '../lib/pdfExport';
import { getNotificationSettings, playNotificationSound, stopNotificationSound } from '../lib/notificationSettings';
import { EpisodeLink } from '@/components/EpisodeLink';
import { formatDate, formatDateTime } from '../lib/utils';

interface IGDPatient {
  nama: string;
  noRM: string;
  dokter: string;
  lokasi: string;
  episode: string;
  dob: string;
  timerOutpatient: string;
  timerTransfer: string;
  timerColor: string;
}

interface DischargePatient {
  noRM: string;
  namaPasien: string;
  ruang: string;
  payor: string;
  status: 'pharmacy' | 'nurse' | 'medical';
}

const DISCHARGE_STATUS_META = {
  pharmacy: { icon: CheckCircle2, iconColor: 'text-emerald-600 dark:text-emerald-400', label: 'Farmasi Selesai',      priority: 1, badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800' },
  nurse:    { icon: Activity, iconColor: 'text-orange-600 dark:text-orange-400', label: 'Keperawatan Selesai',  priority: 2, badgeClass: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800' },
  medical:  { icon: Clock, iconColor: 'text-amber-600 dark:text-amber-400', label: 'Rencana Pulang',       priority: 3, badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800' },
} as const;


const IGD_TIMER_STYLE: Record<string, string> = {
  merah:  'bg-red-500 text-white border-red-600 shadow-sm',
  hitam:  'bg-slate-800 text-white border-slate-900 shadow-sm dark:bg-slate-900 dark:border-slate-800',
  kuning: 'bg-yellow-400 text-yellow-950 border-yellow-500 shadow-sm',
  hijau:  'bg-emerald-500 text-white border-emerald-600 shadow-sm',
  '':     'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800',
};

function isIgdWardPatient(patient: { ward?: string; roomName?: string }) {
  return [patient.ward, patient.roomName]
    .some(value => (value ?? '').trim().toLowerCase().includes('igd ward'));
}

export default function Dashboard() {
  const { user, login } = useAuth();
  const [stats, setStats] = useState({ activePatients: 0, totalPending: 0, pendingTodayCompleted: 0, pendingUnfinished: 0, pendingCritical: 0, operanToday: 0 });
  const [pendingByCategory, setPendingByCategory] = useState<any[]>([]);
  const [operanHistory, setOperanHistory] = useState<any[]>([]);
  const [recentPendings, setRecentPendings] = useState<any[]>([]);
  const [activeJustInfosDash, setActiveJustInfosDash] = useState<any[]>([]);

  // IGD SPRI state
  const [igdPatients, setIgdPatients] = useState<IGDPatient[]>([]);
  const [igdLoading, setIgdLoading] = useState(false);
  const [igdError, setIgdError] = useState<string | null>(null);
  const [igdLastFetch, setIgdLastFetch] = useState<string | null>(null);
  const prevIgdRMs = useRef<Set<string>>(new Set());
  const igdFirstLoad = useRef(true);

  // Notif sound loop state
  const [sirenActive, setSirenActive] = useState(false);
  const [bellActive,  setBellActive]  = useState(false);
  const sirenLoopRef  = useRef(false);
  const bellLoopRef   = useRef(false);
  const [sirenLabel, setSirenLabel] = useState('');
  const [bellLabel,  setBellLabel]  = useState('');

  // KTM widget state (baca dari localStorage cache monitoring KTM)
  const [ktmDashPatients, setKtmDashPatients] = useState<any[]>([]);
  useEffect(() => {
    function readKtm() {
      try {
        const raw = localStorage.getItem('ktm_monitoring_cache');
        if (!raw) { setKtmDashPatients([]); return; }
        const map: Record<string, any> = JSON.parse(raw);
        const list = Object.values(map).sort((a: any, b: any) => {
          // baru dulu, lalu urut pertamaKaliMuncul terbaru
          if (a.status === 'baru' && b.status !== 'baru') return -1;
          if (b.status === 'baru' && a.status !== 'baru') return 1;
          return new Date(b.pertamaKaliMuncul).getTime() - new Date(a.pertamaKaliMuncul).getTime();
        });
        setKtmDashPatients(list.slice(0, 5));
      } catch { setKtmDashPatients([]); }
    }
    readKtm();
    // refresh tiap 30 detik jika user tetap di dashboard
    const t = setInterval(readKtm, 30_000);
    return () => clearInterval(t);
  }, []);

  // Rencana Pasien Pulang state
  const [dischargePlan, setDischargePlan] = useState<DischargePatient[]>([]);
  const [dischargeLoading, setDischargeLoading] = useState(false);
  const [dischargeError, setDischargeError] = useState<string | null>(null);
  const [dischargeLastFetch, setDischargeLastFetch] = useState<string | null>(null);
  const [dischargeSearch, setDischargeSearch] = useState('');

  // Operan shift modal state
  const [isOperanOpen, setIsOperanOpen] = useState(false);
  const [operanStep, setOperanStep] = useState<1 | 2 | 3>(1);
  const [activePendings, setActivePendings] = useState<any[]>([]);
  const [activeJustInfos, setActiveJustInfos] = useState<any[]>([]);
  const [penerimaNama, setPenerimaNama] = useState('');
  const [penerimaPass, setPenerimaPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [operanLoading, setOperanLoading] = useState(false);
  const [operanResult, setOperanResult] = useState<any>(null);

  const loadDashboard = useCallback(async () => {
    const db = await getDB();
    const today = new Date().toISOString().split('T')[0];
    const [patients, pendings, operans, justInfos] = await Promise.all([
      db.getAll('patients'),
      db.getAll('pendings'),
      db.getAll('operanShifts'),
      db.getAll('justInfos'),
    ]);

    const active = patients.filter(p => p.status === 'aktif');
    const activeRMs = new Set(active.map(p => p.noRM));
    const activePend = pendings.filter(p => p.status !== 'selesai');
    const critical = activePend.filter(p => p.prioritas === 'critical');
    const todayDone = pendings.filter(p => p.status === 'selesai' && new Date(p.updatedAt).toISOString().split('T')[0] === today);
    const operanToday = operans.filter(o => o.tanggal.startsWith(today));

    setStats({
      activePatients: active.length,
      totalPending: activePend.length,
      pendingTodayCompleted: todayDone.length,
      pendingUnfinished: activePend.length,
      pendingCritical: critical.length,
      operanToday: operanToday.length,
    });

    const catMap: Record<string, number> = {};
    activePend.forEach(p => { catMap[p.kategori] = (catMap[p.kategori] || 0) + 1; });
    setPendingByCategory(Object.entries(catMap).map(([name, count]) => ({ name: name.replace('Konfirmasi ', ''), count })));

    const last7 = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(); d.setDate(d.getDate() - i);
      return d.toISOString().split('T')[0];
    }).reverse();
    setOperanHistory(last7.map(date => ({ date: date.substring(5), count: operans.filter(o => o.tanggal.startsWith(date)).length })));

    const sorted = [...activePend].sort((a, b) => {
      const pw = { critical: 1, urgent: 2, normal: 3 };
      return pw[a.prioritas as keyof typeof pw] - pw[b.prioritas as keyof typeof pw] || b.createdAt - a.createdAt;
    }).slice(0, 5);
    setRecentPendings(sorted);

    // Just Info aktif = just info milik pasien yang masih aktif, diurutkan terbaru
    const patientNameMap = new Map(active.map(p => [p.noRM, p.namaPasien ?? p.noRM]));
    const igdWardRMs = new Set(
      active.filter(patient => isIgdWardPatient(patient)).map(patient => patient.noRM),
    );
    const activeInfos = justInfos
      .filter(j => activeRMs.has(j.noRM) && !igdWardRMs.has(j.noRM))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(j => ({ ...j, namaPasien: patientNameMap.get(j.noRM) ?? j.noRM }));
    setActiveJustInfosDash(activeInfos);
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  useEffect(() => () => {
    sirenLoopRef.current = false;
    bellLoopRef.current = false;
    stopNotificationSound();
  }, []);

  // ── IGD SPRI ──────────────────────────────────────────────────────────────
  const stopSiren = useCallback(() => {
    sirenLoopRef.current = false;
    setSirenActive(false);
    stopNotificationSound();
  }, []);

  const startSiren = useCallback(async (label: string) => {
    const settings = await getNotificationSettings();
    if (!settings.popupEnabled) return;
    if (sirenLoopRef.current) { setSirenLabel(label); return; }
    sirenLoopRef.current = true;
    setSirenActive(true);
    setSirenLabel(label);
    await playNotificationSound('igd');
  }, []);

  // Bell: ding-dong loop for rencana pulang farmasi selesai
  const stopBell = useCallback(() => {
    bellLoopRef.current = false;
    setBellActive(false);
    stopNotificationSound();
  }, []);

  const startBell = useCallback(async (label: string) => {
    const settings = await getNotificationSettings();
    if (!settings.popupEnabled) return;
    if (bellLoopRef.current) { setBellLabel(label); return; }
    bellLoopRef.current = true;
    setBellActive(true);
    setBellLabel(label);
    await playNotificationSound('billing');
  }, []);

  const prevPharmacyRMs = useRef<Set<string>>(new Set());
  const dischargeFirstLoad = useRef(true);

  const fetchDischargePlan = useCallback(async () => {
    setDischargeLoading(true);
    setDischargeError(null);
    try {
      const eps = await getEndpoints();

      const fetchGroup = async (url: string): Promise<{ noRM: string; namaPasien: string; ruang: string; payor: string }[]> => {
        try {
          const patients = await fetchFromInpatientUrl(url);
          return patients.map(p => ({ noRM: p.noRM, namaPasien: p.namaPasien, ruang: p.ward || p.roomName || '', payor: p.payor || '' }));
        } catch { return []; }
      };

      const [medical, nurse, pharmacy] = await Promise.all([
        fetchGroup(eps.medicalDischarge),
        fetchGroup(eps.nurseDischarge),
        fetchGroup(eps.pharmacyDischarge),
      ]);

      // Merge by noRM with highest-priority status
      const map = new Map<string, DischargePatient>();
      const applyStatus = (list: typeof medical, status: DischargePatient['status']) => {
        for (const p of list) {
          const existing = map.get(p.noRM);
          const newPriority = DISCHARGE_STATUS_META[status].priority;
          if (!existing || newPriority < DISCHARGE_STATUS_META[existing.status].priority) {
            map.set(p.noRM, { ...p, status });
          }
        }
      };
      applyStatus(medical,  'medical');
      applyStatus(nurse,    'nurse');
      applyStatus(pharmacy, 'pharmacy');

      // Balik urutan dari API (entry terakhir = paling baru), lalu stable-sort per status
      const sorted = Array.from(map.values()).reverse().sort(
        (a, b) => DISCHARGE_STATUS_META[a.status].priority - DISCHARGE_STATUS_META[b.status].priority
      );
      // Detect newly-added pharmacy patients and play bell
      if (!dischargeFirstLoad.current) {
        const pharmacyPatients = Array.from(map.values()).filter(p => p.status === 'pharmacy');
        const added = pharmacyPatients.filter(p => !prevPharmacyRMs.current.has(p.noRM));
        if (added.length > 0) {
          startBell(added.map(p => p.namaPasien).join(', '));
        }
      }
      dischargeFirstLoad.current = false;
      prevPharmacyRMs.current = new Set(
        Array.from(map.values()).filter(p => p.status === 'pharmacy').map(p => p.noRM)
      );

      setDischargePlan(sorted);
      setDischargeLastFetch(new Date().toLocaleTimeString('id-ID'));
    } catch (e: any) {
      setDischargeError(e.message ?? 'Gagal mengambil data rencana pulang');
    } finally {
      setDischargeLoading(false);
    }
  }, [startBell]);

  const fetchIGD = useCallback(async () => {
    setIgdLoading(true);
    setIgdError(null);
    try {
      const eps = await getEndpoints();
      const patients: IGDPatient[] = await fetchIGDData(eps.igd);

      // Detect newly-added patients and play notification
      if (!igdFirstLoad.current) {
        const added = patients.filter(p => !prevIgdRMs.current.has(p.noRM));
        if (added.length > 0) {
          startSiren(added.map(p => p.nama).join(', '));
        }
      }
      igdFirstLoad.current = false;
      prevIgdRMs.current = new Set(patients.map(p => p.noRM));

      // Urutkan: timer terkecil = pasien paling baru masuk IGD
      const parseTimer = (t: string) => {
        const parts = (t ?? '').split(':').map(Number);
        return (parts[0] || 0) * 60 + (parts[1] || 0);
      };
      const sortedIGD = [...patients].sort(
        (a, b) => parseTimer(a.timerTransfer) - parseTimer(b.timerTransfer)
      );
      setIgdPatients(sortedIGD);
      setIgdLastFetch(new Date().toLocaleTimeString('id-ID'));
    } catch (e: any) {
      setIgdError(e.message ?? 'Gagal mengambil data IGD');
    } finally {
      setIgdLoading(false);
    }
  }, [startSiren]);

  useEffect(() => {
    fetchIGD();
    const id = setInterval(fetchIGD, 60_000);
    return () => clearInterval(id);
  }, [fetchIGD]);

  useEffect(() => {
    fetchDischargePlan();
    const id = setInterval(fetchDischargePlan, 60_000);
    return () => clearInterval(id);
  }, [fetchDischargePlan]);

  // Open operan shift modal — load pending data
  const openOperan = async () => {
    const db = await getDB();
    const pendings = await db.getAll('pendings');
    const justInfos = await db.getAll('justInfos');
    const ap = pendings.filter(p => p.status !== 'selesai').sort((a, b) => {
      const pw = { critical: 1, urgent: 2, normal: 3 };
      return pw[a.prioritas as keyof typeof pw] - pw[b.prioritas as keyof typeof pw];
    });
    setActivePendings(ap);
    setActiveJustInfos(justInfos);
    setPenerimaNama('');
    setPenerimaPass('');
    setShowPass(false);
    setOperanStep(1);
    setOperanResult(null);
    setIsOperanOpen(true);
  };

  const handleOperanLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setOperanLoading(true);
    try {
      const db = await getDB();
      const users = await db.getAll('users');
      const hashed = hashPassword(penerimaPass);
      const penerima = users.find(u => u.username === penerimaNama && u.passwordHash === hashed);

      if (!penerima) { toast.error('Username atau password penerima salah'); setOperanLoading(false); return; }
      if (!penerima.aktif) { toast.error('Akun penerima tidak aktif'); setOperanLoading(false); return; }
      if (penerima.id === user.id) { toast.error('Penerima tidak boleh sama dengan penyerah'); setOperanLoading(false); return; }

      // Build operan record
      const now = Date.now();
      const tanggal = new Date().toISOString();
      const shiftSerah = getCurrentShift();
      const shiftTerima = shiftSerah === 'pagi' ? 'sore' : shiftSerah === 'sore' ? 'malam' : 'pagi';

      const patients = await db.getAll('patients');
      const totalPasien = patients.filter(p => p.status === 'aktif').length;
      const allPendings = await db.getAll('pendings');
      const totalPending = allPendings.filter(p => p.status !== 'selesai').length;
      const totalSelesai = allPendings.filter(p => p.status === 'selesai').length;

      // Generate PDF
      const operanId = generateUUID();
      let pdfBase64 = '';
      try {
        pdfBase64 = await generateHandoverPDF(operanId, user.namaLengkap, penerima.namaLengkap, activePendings, activeJustInfos);
      } catch { /* pdf generation non-critical */ }

      const operan = {
        id: operanId,
        tanggal,
        shiftSerah,
        shiftTerima,
        userSerahId: user.id,
        userSerahNama: user.namaLengkap,
        userTerimaId: penerima.id!,
        userTerimaNama: penerima.namaLengkap,
        jamOperan: new Date().toLocaleTimeString('id-ID'),
        totalPasien,
        totalPending,
        totalPendingSelesai: totalSelesai,
        totalPendingBerlanjut: totalPending,
        ringkasanPending: activePendings.map(p => ({ noRM: p.noRM, namaPasien: p.namaPasien, episodeNo: p.episodeNo, payor: p.payor, isiPending: p.isiPending, prioritas: p.prioritas, status: p.status })),
        pdfBase64,
        createdAt: now,
      };
      await db.put('operanShifts', operan);

      // Activity log
      await db.add('activityLogs', {
        userId: user.id, username: user.namaLengkap, namaUser: user.namaLengkap,
        aktivitas: 'OPERAN_SHIFT', modul: 'operanShifts',
        detail: `Operan dari ${user.namaLengkap} ke ${penerima.namaLengkap}`,
        timestamp: now,
        tanggal: new Date(now).toISOString().split('T')[0],
        jam: new Date(now).toLocaleTimeString('id-ID'),
        role: (user.role ?? 'officer') as 'superuser' | 'officer' | 'system',
        noRM: '', episodeNo: '', namaPasien: '',
        oldValue: '', newValue: '',
        browser: '', device: '', os: '',
        status: 'Success' as const,
        keterangan: '', durasi: 0, errorCode: '', errorMessage: '',
      });

      // Auto-download PDF
      if (pdfBase64) {
        const link = document.createElement('a');
        link.href = pdfBase64;
        link.download = `Operan_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
        link.click();
      }

      setOperanResult({ operan, penerima });
      setOperanStep(3);

      // Switch session to penerima
      login({ id: penerima.id!, username: penerima.username, namaLengkap: penerima.namaLengkap, role: penerima.role });
      toast.success(`Operan berhasil! Sesi beralih ke ${penerima.namaLengkap}`);
      loadDashboard();
    } catch (err) {
      toast.error('Terjadi kesalahan saat proses operan');
    } finally {
      setOperanLoading(false);
    }
  };

  const prioritasBadge = (p: string) =>
    p === 'critical' ? 'bg-red-500 text-white border-red-600' :
    p === 'urgent'   ? 'bg-orange-500 text-white border-orange-600' :
                       'bg-emerald-500 text-white border-emerald-600';

  return (
    <div className="p-6 space-y-4 max-w-[1600px] mx-auto pb-12">
      {/* ── Notif banner: IGD SPRI siren ── */}
      {sirenActive && (
        <div onClick={() => stopNotificationSound()} className="flex items-center justify-between gap-4 rounded-md border border-red-300 bg-red-50/80 dark:bg-red-950/40 dark:border-red-800/50 px-5 py-3 shadow-sm animate-in fade-in slide-in-from-top-4 mb-2">
          <div className="flex items-start gap-4 min-w-0">
            <div className="p-2 bg-red-100 dark:bg-red-900/50 rounded shrink-0 animate-pulse">
               <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div className="min-w-0 pt-0.5">
              <p className="font-bold text-red-800 dark:text-red-300 text-[13px]">Pasien IGD Sudah SPRI</p>
              <p className="text-[12px] font-medium text-red-600/90 dark:text-red-400/90 truncate mt-0.5">{sirenLabel}</p>
            </div>
          </div>
          <Button onClick={stopSiren} variant="destructive" className="shrink-0 gap-2 font-bold shadow-sm rounded h-8 text-xs">
            <X className="w-3.5 h-3.5" /> Stop Peringatan
          </Button>
        </div>
      )}

      {/* ── Notif banner: Farmasi Selesai bell ── */}
      {bellActive && (
        <div onClick={() => stopNotificationSound()} className="flex items-center justify-between gap-4 rounded-md border border-emerald-300 bg-emerald-50/80 dark:bg-emerald-950/40 dark:border-emerald-800/50 px-5 py-3 shadow-sm animate-in fade-in slide-in-from-top-4 mb-2">
          <div className="flex items-start gap-4 min-w-0">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 rounded shrink-0 animate-pulse">
               <Bell className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0 pt-0.5">
              <p className="font-bold text-emerald-800 dark:text-emerald-300 text-[13px]">Rencana Pulang — Farmasi Selesai</p>
              <p className="text-[12px] font-medium text-emerald-600/90 dark:text-emerald-400/90 truncate mt-0.5">{bellLabel}</p>
            </div>
          </div>
          <Button onClick={stopBell} className="shrink-0 gap-2 font-bold shadow-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded h-8 text-xs">
            <X className="w-3.5 h-3.5" /> Stop Peringatan
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 pb-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Dashboard Operasional</h1>
          <p className="text-[13px] font-medium text-muted-foreground max-w-xl">
            Ringkasan aktivitas pasien rawat inap, status operan, dan pemantauan IGD real-time.
          </p>
        </div>
        <Button className="gap-2.5 font-bold shadow-sm bg-emerald-600 hover:bg-emerald-700 text-white transition-all hover:shadow-md h-9 text-xs" onClick={openOperan} data-testid="button-mulai-operan">
          <Share2 className="w-4 h-4" /> Mulai Operan Shift
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard title="Pasien Aktif" value={stats.activePatients} icon={Users} color="text-blue-600 dark:text-blue-400" bg="bg-blue-100/50 dark:bg-blue-900/30" border="border-blue-500" />
        <StatCard title="Total Pending" value={stats.totalPending} icon={Clock} color="text-slate-600 dark:text-slate-400" bg="bg-slate-100 dark:bg-slate-800" border="border-slate-500" />
        <StatCard title="Selesai Hari Ini" value={stats.pendingTodayCompleted} icon={CheckCircle2} color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-100/50 dark:bg-emerald-900/30" border="border-emerald-500" />
        <StatCard title="Belum Selesai" value={stats.pendingUnfinished} icon={AlertTriangle} color="text-orange-600 dark:text-orange-400" bg="bg-orange-100/50 dark:bg-orange-900/30" border="border-orange-500" />
        <StatCard title="Pending Critical" value={stats.pendingCritical} icon={AlertCircle} color="text-red-600 dark:text-red-400" bg="bg-red-100/50 dark:bg-red-900/30" border="border-red-500" />
        <StatCard title="Operan Hari Ini" value={stats.operanToday} icon={Share2} color="text-primary" bg="bg-primary/10" border="border-primary" />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* KTM Widget */}
        <Card className="col-span-1 lg:col-span-2 shadow-sm flex flex-col rounded-md border border-border h-[380px]">
          <CardHeader className="py-2.5 px-4 border-b border-border bg-muted/20 shrink-0">
            <CardTitle className="text-[13px] font-bold flex items-center gap-2">
              <div className="p-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                <Bell className="w-3.5 h-3.5" />
              </div>
              Pasien Rawat Inap KTM
              {ktmDashPatients.length > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                  {ktmDashPatients.filter((p: any) => p.status === 'baru').length > 0 ? `${ktmDashPatients.filter((p: any) => p.status === 'baru').length} Baru` : ktmDashPatients.length}
                </Badge>
              )}
              <a href="#/monitoring-ktm" className="ml-auto text-[11px] font-bold text-primary hover:underline transition-colors">Lihat Semua &rarr;</a>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-3 overflow-hidden flex flex-col">
            {ktmDashPatients.length === 0 ? (
              <EmptyState icon={Bell} title="Tidak ada data KTM" description="Buka Monitoring KTM untuk memulai pemantauan pasien secara real-time" />
            ) : (
              <div className="grid grid-cols-1 gap-2 content-start flex-1 overflow-y-auto pr-1 scrollbar-thin">
                {ktmDashPatients.map((p: any) => (
                  <div key={p.noRM} className={`group relative flex items-start gap-2.5 rounded px-3 py-2.5 transition-all border ${p.status === 'baru' ? 'bg-amber-50/50 border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-900/50' : 'bg-card border-border/50 hover:bg-muted/40'}`}>
                    {p.status === 'baru' && (
                      <span className="absolute -left-1 -top-1 flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500 border-2 border-white dark:border-background"></span>
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[13px] text-foreground truncate group-hover:text-primary transition-colors">{p.namaPasien}</span>
                        {p.status === 'baru' && <span className="shrink-0 text-[8px] font-extrabold px-1 py-0.5 rounded uppercase tracking-wider bg-amber-500 text-white">Baru</span>}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                         <span className="text-[11px] font-medium text-foreground bg-muted px-1 py-0.5 rounded">{p.noRM}</span>
                         {p.episodeNo && <span className="text-[11px] text-muted-foreground flex items-center gap-0.5"><span className="text-muted-foreground/40">•</span> Ep: <EpisodeLink episode={p.episodeNo} /></span>}
                        {(p.ruangan || p.ward) && <span className="text-[11px] text-muted-foreground flex items-center gap-0.5"><span className="text-muted-foreground/40">•</span> {p.ruangan || p.ward}</span>}
                        {p.kelas && <span className="text-[11px] text-muted-foreground flex items-center gap-0.5"><span className="text-muted-foreground/40">•</span> {p.kelas}</span>}
                      </div>
                      {p.dpjp && (
                        <p className="text-[10px] font-medium text-muted-foreground mt-1.5 truncate flex items-center gap-1 bg-muted/30 w-max px-1.5 py-0.5 rounded border border-border/40">
                          <Users className="w-2.5 h-2.5 text-muted-foreground/70" /> {p.dpjp}
                        </p>
                      )}
                    </div>
                    {p.tanggalJamKTM && (
                      <div className="shrink-0 text-right mt-0.5">
                        <span className="inline-flex text-[9px] font-bold text-muted-foreground whitespace-nowrap bg-muted px-1.5 py-0.5 rounded">{p.tanggalJamKTM}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* IGD SPRI Panel */}
        <Card className="col-span-1 shadow-sm flex flex-col rounded-md border border-border h-[380px]">
          <CardHeader className="py-2.5 px-4 border-b border-border bg-muted/20 shrink-0">
            <CardTitle className="text-[13px] font-bold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400">
                  <Activity className="w-3.5 h-3.5" />
                </div>
                IGD ke SPRI
                <Badge variant="secondary" className={`ml-0.5 px-1.5 py-0 text-[10px] font-bold ${igdPatients.length > 0 ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300 border-red-200 dark:border-red-800' : 'bg-muted text-muted-foreground'}`}>
                  {igdPatients.length}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {igdLastFetch && <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider hidden sm:inline-block">Update: {igdLastFetch}</span>}
                <button onClick={fetchIGD} disabled={igdLoading} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors" title="Refresh data IGD" data-testid="button-refresh-igd">
                  <RefreshCw className={`w-3.5 h-3.5 ${igdLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-3 overflow-hidden flex flex-col">
            {igdError && (
              <div className="flex items-center gap-2 text-[11px] font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded p-2 mb-3 shrink-0">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {igdError}
              </div>
            )}
            {igdLoading && igdPatients.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span className="text-[11px] font-medium">Memuat data IGD...</span>
              </div>
            )}
            {!igdLoading && igdPatients.length === 0 && !igdError ? (
              <EmptyState icon={CheckCircle2} title="Semua Pasien Terlayani" description="Tidak ada antrean pasien IGD ber-SPRI saat ini." colorClass="bg-emerald-100/50 dark:bg-emerald-900/20 text-emerald-500" />
            ) : (
              <div className="space-y-2 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                {igdPatients.map(p => {
                  const timerStyle = IGD_TIMER_STYLE[p.timerColor] ?? IGD_TIMER_STYLE[''];
                  return (
                    <div key={p.noRM} className="group flex items-center justify-between p-2.5 rounded border border-border/50 bg-card hover:bg-muted/40 transition-all">
                      <div className="min-w-0 pr-2">
                        <p className="text-[13px] font-bold truncate text-foreground group-hover:text-primary transition-colors">{p.nama}</p>
                        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
                          <span className="font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">{p.noRM}</span>
                          <span className="text-muted-foreground/40">•</span>
                          {p.episode && <EpisodeLink episode={p.episode} className="font-mono" />}
                          {p.dob && <span className="text-[10px]">Lahir {p.dob}</span>}
                          <span className="truncate font-medium">{p.lokasi}</span>
                        </div>
                      </div>
                      <div className={`shrink-0 flex items-center justify-center min-w-[3rem] px-1.5 py-1 rounded border tabular-nums text-[12px] font-bold ${timerStyle}`}>
                        {p.timerTransfer}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rencana Pasien Pulang */}
        <Card className="col-span-1 lg:col-span-2 shadow-sm flex flex-col rounded-md border border-border h-[380px]">
          <CardHeader className="py-2.5 px-4 border-b border-border bg-muted/20 shrink-0">
            <CardTitle className="text-[13px] font-bold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
                Rencana Pasien Pulang
                <Badge variant="secondary" className={`ml-0.5 px-1.5 py-0 text-[10px] font-bold ${dischargePlan.length > 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-muted text-muted-foreground'}`}>
                  {dischargePlan.length}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {dischargeLastFetch && <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider hidden sm:inline-block">Update: {dischargeLastFetch}</span>}
                <button onClick={fetchDischargePlan} disabled={dischargeLoading} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors" title="Refresh rencana pulang" data-testid="button-refresh-discharge">
                  <RefreshCw className={`w-3.5 h-3.5 ${dischargeLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-3 p-3 overflow-hidden">
            <Input placeholder="Cari No. RM, Nama, atau Ruang..." value={dischargeSearch} onChange={e => setDischargeSearch(e.target.value)} className="h-8 text-[12px] bg-muted/30 focus-visible:bg-transparent rounded shrink-0" />

            {dischargeError && (
              <div className="flex items-center gap-2 text-[11px] font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded p-2 shrink-0">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {dischargeError}
              </div>
            )}

            {dischargeLoading && dischargePlan.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span className="text-[11px] font-medium">Memuat data rencana pulang...</span>
              </div>
            )}

            {(() => {
              const q = dischargeSearch.toLowerCase();
              const filtered = dischargePlan.filter(p => !q || p.noRM.toLowerCase().includes(q) || p.namaPasien.toLowerCase().includes(q) || p.ruang.toLowerCase().includes(q) || p.payor.toLowerCase().includes(q));

              if (!dischargeLoading && filtered.length === 0 && !dischargeError) {
                return <EmptyState icon={CheckCircle2} title={dischargeSearch ? 'Tidak ada hasil pencarian' : 'Belum ada rencana pulang'} description="Data akan otomatis muncul ketika ada update" />;
              }

              return (
                <div className="grid grid-cols-1 gap-2 content-start flex-1 overflow-y-auto pr-1 scrollbar-thin">
                  {filtered.map((p) => {
                    const meta = DISCHARGE_STATUS_META[p.status];
                    const Icon = meta.icon;
                    return (
                      <div key={p.noRM} className="group flex items-start gap-2.5 p-2.5 rounded border border-border/50 bg-card hover:bg-muted/40 transition-all">
                        <div className={`mt-0.5 p-1.5 rounded border bg-background shadow-sm ${meta.iconColor}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-foreground group-hover:text-primary transition-colors truncate">{p.namaPasien}</p>
                          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
                            <span className="font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">{p.noRM}</span>
                            <span className="text-muted-foreground/40">•</span>
                            <span className="truncate font-medium">Rg. {p.ruang}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/40">
                            <span className={`inline-flex items-center text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider border ${meta.badgeClass}`}>{meta.label}</span>
                            {p.payor && <span className="truncate text-[9px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50 max-w-[100px]">{p.payor}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Just Info Aktif */}
        <Card className="col-span-1 shadow-sm flex flex-col rounded-md border border-border h-[380px]">
          <CardHeader className="py-2.5 px-4 border-b border-border bg-muted/20 shrink-0">
            <CardTitle className="text-[13px] font-bold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400">
                  <Info className="w-3.5 h-3.5" />
                </div>
                Just Info Aktif
                {activeJustInfosDash.length > 0 && (
                  <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                    {activeJustInfosDash.length}
                  </Badge>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-3 overflow-hidden flex flex-col">
            {activeJustInfosDash.length === 0 ? (
              <EmptyState icon={Info} title="Tidak ada Just Info" description="Seluruh catatan observasi sudah ditindaklanjuti" />
            ) : (
              <div className="space-y-2 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                {activeJustInfosDash.map(j => (
                  <div key={j.id} className="group flex items-start gap-2.5 p-2.5 rounded border border-border/50 bg-card hover:bg-muted/40 transition-all">
                    <div className="mt-0.5 p-1.5 rounded border bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 shrink-0 border-blue-100 dark:border-blue-800/50">
                      <Info className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[13px] font-bold text-foreground group-hover:text-primary transition-colors truncate">{j.namaPasien}</p>
                        <span className="text-[9px] font-bold text-muted-foreground whitespace-nowrap bg-muted px-1.5 py-0.5 rounded">
                          {new Date(j.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-1 mb-2 text-[11px] text-muted-foreground">
                        <span className="font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">{j.noRM}</span>
                        {j.shift && <span className="flex items-center gap-1"><span className="text-muted-foreground/40">•</span> Shift {j.shift}</span>}
                        {j.userName && <span className="truncate flex items-center gap-1"><span className="text-muted-foreground/40">•</span> {j.userName}</span>}
                      </div>
                      <p className="text-[12px] text-foreground/90 line-clamp-3 leading-relaxed bg-muted/30 p-2 rounded border border-border/50">
                        {j.isi}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ===== DIALOG OPERAN SHIFT ===== */}
      <Dialog open={isOperanOpen} onOpenChange={v => { if (!v && operanStep !== 3) setIsOperanOpen(false); if (operanStep === 3) setIsOperanOpen(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 rounded-md border-0 shadow-2xl">

          {/* STEP 1: Ringkasan + Konfirmasi Mulai */}
          {operanStep === 1 && (
            <div className="p-6">
              <DialogHeader className="mb-6">
                <DialogTitle className="text-2xl font-extrabold flex items-center gap-3 text-foreground">
                  <div className="p-2 rounded bg-emerald-100 dark:bg-emerald-900/50 shadow-sm border border-emerald-200 dark:border-emerald-800">
                    <Share2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  Mulai Operan Shift
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-6">
                <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/50 rounded-md p-5 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full -mr-16 -mt-16 blur-xl pointer-events-none"></div>
                  <p className="text-xs font-bold text-emerald-800/70 dark:text-emerald-400/70 mb-1.5 uppercase tracking-wider relative z-10">Penyerah Operan</p>
                  <p className="text-xl font-extrabold text-emerald-900 dark:text-emerald-300 relative z-10">{user?.namaLengkap} <span className="text-base font-semibold text-emerald-700/70 dark:text-emerald-500/70 ml-1">({user?.username})</span></p>
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-500 mt-2 flex items-center gap-2 relative z-10">
                    <Clock className="w-4 h-4" /> Shift: {getCurrentShift().toUpperCase()} <span className="text-emerald-300 dark:text-emerald-700">•</span> {formatDateTime(new Date())}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-900/50 rounded-md p-4 shadow-sm">
                    <p className="text-3xl font-black text-amber-600 dark:text-amber-500">{activePendings.filter(p => p.status === 'pending').length}</p>
                    <p className="text-xs font-bold text-amber-800/70 dark:text-amber-400/70 mt-1.5 uppercase tracking-wider">Menunggu</p>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200/50 dark:border-blue-900/50 rounded-md p-4 shadow-sm">
                    <p className="text-3xl font-black text-blue-600 dark:text-blue-500">{activePendings.filter(p => p.status === 'diproses').length}</p>
                    <p className="text-xs font-bold text-blue-800/70 dark:text-blue-400/70 mt-1.5 uppercase tracking-wider">Diproses</p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-900/50 rounded-md p-4 shadow-sm">
                    <p className="text-3xl font-black text-red-600 dark:text-red-500">{activePendings.filter(p => p.prioritas === 'critical').length}</p>
                    <p className="text-xs font-bold text-red-800/70 dark:text-red-400/70 mt-1.5 uppercase tracking-wider">Critical</p>
                  </div>
                </div>

                {activePendings.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-bold text-foreground flex items-center gap-2">
                      Daftar Tugas Pending <Badge variant="secondary" className="px-2 py-0.5 shadow-sm rounded">{activePendings.length}</Badge>
                    </p>
                    <div className="max-h-[240px] overflow-y-auto space-y-2.5 pr-2 scrollbar-thin">
                      {activePendings.map(p => (
                        <div key={p.id} className="flex items-start gap-3.5 p-3.5 bg-card border border-border/60 rounded-md shadow-sm hover:border-border transition-colors">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-extrabold border uppercase tracking-wider shadow-sm ${prioritasBadge(p.prioritas)}`}>
                            {p.prioritas.slice(0,3)}
                          </span>
                          <div className="flex-1 min-w-0 mt-[-2px]">
                            <p className="text-[13px] font-bold truncate text-foreground">{p.namaPasien} <span className="font-semibold text-muted-foreground text-[11px] ml-1">({p.noRM})</span></p>
                            <p className="text-[11px] font-medium text-muted-foreground mt-0.5 flex items-center gap-1">
                              {p.ruangan} <span className="text-border">•</span> {p.kategori}
                            </p>
                            <p className="text-[12px] mt-2 line-clamp-2 leading-relaxed bg-muted/40 p-2 rounded border border-border/50">
                              {p.isiPending}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activePendings.length === 0 && (
                  <div className="text-center py-6 text-muted-foreground bg-muted/10 rounded-md border border-dashed border-border/60">
                    <div className="p-2 bg-emerald-100/50 dark:bg-emerald-900/20 rounded inline-block mb-2">
                      <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                    </div>
                    <p className="text-[13px] font-bold text-foreground/80 mb-1">Tidak ada pending aktif</p>
                    <p className="text-[11px]">Semua tugas sudah diselesaikan</p>
                  </div>
                )}

                {activeJustInfos.length > 0 && (
                  <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/50 rounded-md p-4 shadow-sm">
                    <p className="text-[11px] font-bold text-blue-800/70 dark:text-blue-400/70 mb-2 uppercase tracking-wider flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5" /> Just Info <Badge variant="secondary" className="px-1 py-0 text-[9px] bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 ml-auto border-blue-200 dark:border-blue-800 rounded">{activeJustInfos.length}</Badge>
                    </p>
                    <div className="space-y-2">
                      {activeJustInfos.slice(0, 3).map(j => (
                        <p key={j.id} className="text-[11px] font-medium text-blue-900/80 dark:text-blue-300/80 bg-blue-100/50 dark:bg-blue-900/30 p-2 rounded border border-blue-200/50 dark:border-blue-800/50">{j.isi}</p>
                      ))}
                      {activeJustInfos.length > 3 && <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 mt-1.5 px-1 uppercase tracking-wider">...dan {activeJustInfos.length - 3} lainnya</p>}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter className="pt-5 mt-5 border-t border-border/40 gap-2">
                <Button variant="outline" className="font-bold border-border/80 h-10 rounded" onClick={() => setIsOperanOpen(false)}>Batal</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-bold shadow-sm h-10 rounded" onClick={() => setOperanStep(2)} data-testid="button-lanjut-operan">
                  Lanjutkan Operan <Share2 className="w-4 h-4 ml-1" />
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* STEP 2: Login penerima */}
          {operanStep === 2 && (
            <div className="p-6">
              <DialogHeader className="mb-5">
                <DialogTitle className="text-2xl font-extrabold flex items-center gap-3">
                   <div className="p-2 rounded bg-amber-100 dark:bg-amber-900/50 shadow-sm border border-amber-200 dark:border-amber-800">
                    <Users className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                  </div>
                  Otentikasi Penerima
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleOperanLogin} className="space-y-5">
                <div className="bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 rounded-md p-3.5 flex gap-3 shadow-sm">
                  <div className="mt-0.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-500" />
                  </div>
                  <div>
                    <p className="font-bold text-amber-900 dark:text-amber-300 text-[13px] mb-0.5">Validasi Penerima Shift</p>
                    <p className="text-amber-800/80 dark:text-amber-400/80 text-[12px] leading-relaxed">
                      Silakan masukkan username dan password petugas yang akan menerima operan untuk mencatat serah terima secara resmi.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-foreground uppercase tracking-wider">Username <span className="text-destructive">*</span></label>
                    <Input
                      value={penerimaNama}
                      onChange={e => setPenerimaNama(e.target.value)}
                      placeholder="e.g. perawat_malam"
                      required
                      autoFocus
                      className="h-10 shadow-sm font-medium bg-muted/30 focus-visible:bg-transparent rounded"
                      data-testid="input-penerima-username"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-foreground uppercase tracking-wider">Password <span className="text-destructive">*</span></label>
                    <div className="relative">
                      <Input
                        type={showPass ? 'text' : 'password'}
                        value={penerimaPass}
                        onChange={e => setPenerimaPass(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="h-10 pr-10 shadow-sm font-medium tracking-widest bg-muted/30 focus-visible:bg-transparent rounded"
                        data-testid="input-penerima-password"
                      />
                      <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground transition-colors p-0.5 bg-background rounded">
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <DialogFooter className="pt-5 mt-5 border-t border-border/40 gap-2">
                  <Button type="button" variant="outline" className="font-bold h-10 rounded" onClick={() => setOperanStep(1)}>Kembali</Button>
                  <Button type="submit" disabled={operanLoading || !penerimaNama || !penerimaPass} className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[200px] font-bold shadow-sm transition-all h-10 rounded" data-testid="button-konfirmasi-operan">
                    {operanLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                    {operanLoading ? 'Memverifikasi...' : 'Konfirmasi Operan'}
                  </Button>
                </DialogFooter>
              </form>
            </div>
          )}

          {/* STEP 3: Sukses */}
          {operanStep === 3 && operanResult && (
            <div className="p-8 text-center">
              <div className="mx-auto w-14 h-14 bg-emerald-100 dark:bg-emerald-900/50 rounded flex items-center justify-center mb-5 shadow-sm border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <DialogTitle className="text-2xl font-extrabold mb-1.5">Operan Berhasil!</DialogTitle>
              <p className="text-[13px] font-medium text-muted-foreground mb-6">Sesi telah dialihkan ke petugas shift berikutnya.</p>

              <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/50 rounded-md p-4 mb-6 text-left shadow-sm">
                <div className="grid grid-cols-2 gap-y-4 gap-x-4 text-[13px]">
                  <div>
                    <p className="text-[9px] font-bold text-emerald-800/60 dark:text-emerald-400/60 uppercase tracking-wider mb-0.5">Penyerah</p>
                    <p className="font-bold text-foreground truncate">{operanResult.operan.userSerahNama}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-emerald-800/60 dark:text-emerald-400/60 uppercase tracking-wider mb-0.5">Penerima</p>
                    <p className="font-bold text-foreground truncate">{operanResult.operan.userTerimaNama}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-emerald-800/60 dark:text-emerald-400/60 uppercase tracking-wider mb-0.5">Shift Berakhir</p>
                    <p className="font-bold text-foreground capitalize">{operanResult.operan.shiftSerah}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-emerald-800/60 dark:text-emerald-400/60 uppercase tracking-wider mb-0.5">Waktu</p>
                    <p className="font-bold text-foreground">{operanResult.operan.jamOperan}</p>
                  </div>
                  <div className="col-span-2 pt-3 border-t border-emerald-200/50 dark:border-emerald-800/50 flex justify-between items-center">
                    <div>
                      <p className="text-[9px] font-bold text-emerald-800/60 dark:text-emerald-400/60 uppercase tracking-wider mb-0.5">Total Pasien</p>
                      <p className="font-black text-base text-emerald-700 dark:text-emerald-400">{operanResult.operan.totalPasien}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-bold text-emerald-800/60 dark:text-emerald-400/60 uppercase tracking-wider mb-0.5">Pending Berlanjut</p>
                      <p className="font-black text-base text-emerald-700 dark:text-emerald-400">{operanResult.operan.totalPendingBerlanjut}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-[11px] font-medium text-emerald-700/80 dark:text-emerald-400/80 mb-5 bg-emerald-100/50 dark:bg-emerald-900/30 py-1.5 px-3 rounded inline-flex items-center gap-1.5">
                {operanResult.operan.pdfBase64 ? <><FileSignature className="w-3.5 h-3.5" /> PDF laporan operan telah diunduh otomatis</> : 'Laporan operan tersimpan dalam riwayat'}
              </div>

              <Button className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm rounded" onClick={() => setIsOperanOpen(false)} data-testid="button-tutup-operan">
                Tutup & Mulai Shift Baru
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color, bg, border }: any) {
  return (
    <Card className={`shadow-sm transition-all duration-200 hover:shadow-md border-b-[3px] border-t-0 border-x-0 rounded-md group ${border}`}>
      <CardContent className="p-3.5 flex items-center gap-3.5 h-full min-h-[76px]">
        <div className={`p-2 rounded-md shrink-0 ${bg}`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider truncate mb-0.5">{title}</p>
          <h3 className="text-xl font-black tracking-tight text-foreground leading-none">{value}</h3>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ icon: Icon, title, description, colorClass }: any) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground bg-muted/10 rounded border border-dashed border-border/60">
      <div className={`p-2.5 rounded ${colorClass || 'bg-muted'}`}>
        <Icon className="w-6 h-6 opacity-60" />
      </div>
      <div className="text-center px-4">
        <p className="text-[13px] font-semibold text-foreground/80 mb-0.5">{title}</p>
        <p className="text-[11px] max-w-[220px] mx-auto leading-tight">{description}</p>
      </div>
    </div>
  );
}
