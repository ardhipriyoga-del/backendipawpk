import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, CalendarClock, CheckCircle2, ClipboardCheck, Download, Eye, History, Loader2, Search, Settings2, SlidersHorizontal, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { getDB, ChecklistEpisode, ChecklistHistory, ChecklistMaster, Patient } from '../lib/db';
import {
  archiveChecklistEpisode,
  checklistFieldLabel,
  exportChecklistHistoryExcel,
  getChecklistHistory,
  getChecklistMasters,
  getChecklistStatus,
  isChecklistAnswerComplete,
  saveChecklistEpisode,
  syncChecklistPatients,
  type ChecklistStatus,
  type ChecklistView,
} from '../lib/checklist';
import { triggerAutoBackup } from '../lib/cloudSync';
import { getPatientDisplayName } from '../lib/patientIdentity';
import { formatDate, formatDateTime } from '../lib/utils';
import { CHECKLIST_FILTER_INTENT_EVENT, consumeChecklistFilter } from '../lib/checklistNavigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type PageTab = 'active' | 'history';
type ActiveFilter = 'all' | 'unfinished' | 'today' | 'overdue' | 'plan' | 'payer' | 'doctor' | 'room';

const statusMeta: Record<ChecklistStatus, { label: string; className: string }> = {
  terlambat: { label: 'Terlambat', className: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800' },
  reminder: { label: 'Reminder Hari Ini', className: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800' },
  belum_selesai: { label: 'Belum Selesai', className: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700' },
  selesai: { label: 'Selesai', className: 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800' },
};

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dateKey(value: string): string {
  const iso = value.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function display(value: string | undefined): string {
  return value?.trim() || '-';
}

function statusFor(view: ChecklistView): ChecklistStatus {
  return view.status;
}

function StatusBadge({ status }: { status: ChecklistStatus }) {
  const meta = statusMeta[status];
  return (
    <Badge
      variant="outline"
      className={`${meta.className} h-5 shrink-0 whitespace-nowrap px-1.5 py-0 text-[10px] leading-4`}
    >
      {meta.label}
    </Badge>
  );
}

function FieldInput({
  master,
  value,
  onChange,
}: {
  master: ChecklistMaster;
  value: string;
  onChange: (value: string) => void;
}) {
  const common = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
  if (master.tipe === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={value === 'true'} onChange={event => onChange(event.target.checked ? 'true' : 'false')} className="h-4 w-4 accent-primary" />
        <span>{value === 'true' ? 'Sudah selesai' : 'Belum selesai'}</span>
      </label>
    );
  }
  if (master.tipe === 'yesno') {
    return (
      <select value={value} onChange={event => onChange(event.target.value)} className={common}>
        <option value="">Pilih jawaban</option><option value="Ya">Ya</option><option value="Belum">Belum</option><option value="Tidak">Tidak</option>
      </select>
    );
  }
  if (master.tipe === 'dropdown') {
    return (
      <select value={value} onChange={event => onChange(event.target.value)} className={common}>
        <option value="">Pilih jawaban</option>
        {master.pilihan.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  const type = master.tipe === 'phone' ? 'tel' : master.tipe === 'number' ? 'number' : master.tipe === 'date' ? 'date' : master.tipe === 'time' ? 'time' : master.tipe === 'datetime' ? 'datetime-local' : 'text';
  if (master.tipe === 'textarea') return <textarea value={value} onChange={event => onChange(event.target.value)} className={`${common} min-h-20`} />;
  return <Input type={type} value={value} onChange={event => onChange(event.target.value)} />;
}

export default function ChecklistPasienPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<PageTab>('active');
  const [masters, setMasters] = useState<ChecklistMaster[]>([]);
  const [active, setActive] = useState<ChecklistView[]>([]);
  const [history, setHistory] = useState<ChecklistHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ChecklistView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [catatan, setCatatan] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const [selectedHistory, setSelectedHistory] = useState<ChecklistHistory | null>(null);

  useEffect(() => {
    const applyReminderFilter = () => {
      setTab('active');
      setFilter('today');
      setSearch('');
    };
    if (consumeChecklistFilter() === 'today') applyReminderFilter();
    window.addEventListener(CHECKLIST_FILTER_INTENT_EVENT, applyReminderFilter);
    return () => window.removeEventListener(CHECKLIST_FILTER_INTENT_EVENT, applyReminderFilter);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDB();
      const [patientRows, masterRows] = await Promise.all([
        db.getAll('patients'),
        getChecklistMasters().then(rows => rows.length ? rows : []),
      ]);
      const ensuredMasters = masterRows.length ? masterRows : await (await import('../lib/checklist')).ensureDefaultChecklistMasters();
      const [views, historyRows] = await Promise.all([
        syncChecklistPatients(patientRows as Patient[], ensuredMasters),
        getChecklistHistory(),
      ]);
      setMasters(ensuredMasters);
      setActive(views);
      setHistory(historyRows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Checklist pasien gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const refreshOnFocus = () => { void load(); };
    const refreshOnVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnVisibility);
    const interval = window.setInterval(() => { void load(); }, 60_000);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
      window.clearInterval(interval);
    };
  }, [load]);

  const openDetail = (view: ChecklistView) => {
    setSelected(view);
    setAnswers({ ...view.answers });
    setCatatan(view.catatan);
  };

  const historyMasters = useMemo(
    // Keep inactive masters visible in history so older completed checklists
    // remain auditable after the master checklist is later changed.
    () => [...masters].sort((a, b) => a.urutan - b.urutan),
    [masters],
  );

  const save = async () => {
    if (!selected || !user) return;
    setSaving(true);
    try {
      const result = await saveChecklistEpisode({ ...selected, answers, catatan, updatedAt: Date.now() }, masters, user.namaLengkap || user.username);
      if (result.completed) toast.success('Checklist selesai dan dipindahkan ke History Checklist.');
      else toast.success('Checklist pasien tersimpan.');
      setSelected(null);
      await triggerAutoBackup();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Checklist gagal disimpan.');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!selected || !user || user.role !== 'superuser') return;
    if (!window.confirm(`Arsipkan checklist ${selected.namaPasien} secara manual?`)) return;
    try {
      await archiveChecklistEpisode(selected, user.namaLengkap || user.username);
      setSelected(null);
      toast.success('Checklist diarsipkan ke History Checklist.');
      await triggerAutoBackup();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Checklist belum dapat diarsipkan.');
    }
  };

  const filteredActive = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...active]
      .filter(item => {
        const values = [item.namaPasien, item.noRM, item.episodeNo, item.dpjp, item.ruangan].join(' ').toLowerCase();
        if (query && !values.includes(query)) return false;
        if (filter === 'unfinished' && item.status === 'selesai') return false;
        if (filter === 'today' && item.status !== 'reminder') return false;
        if (filter === 'overdue' && item.status !== 'terlambat') return false;
        if (filter === 'plan' && !item.hasPlan) return false;
        if (filter === 'payer' && !item.penjamin) return false;
        if (filter === 'doctor' && !item.dpjp) return false;
        if (filter === 'room' && !item.ruangan) return false;
        return true;
      })
      .sort((a, b) => {
        const priority = (status: ChecklistStatus) => status === 'terlambat' ? 0 : status === 'reminder' ? 1 : 2;
        return b.daysInCare - a.daysInCare || priority(statusFor(a)) - priority(statusFor(b)) || b.updatedAt - a.updatedAt;
      });
  }, [active, filter, search]);

  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    return history.filter(item => !query || [item.namaPasien, item.noRM, item.episodeNo, item.selesaiOleh].join(' ').toLowerCase().includes(query));
  }, [history, historySearch]);

  const reminderCount = active.filter(item => item.status === 'reminder').length;
  const overdueCount = active.filter(item => item.status === 'terlambat').length;
  const completedToday = history.filter(item => dateKey(new Date(item.selesaiPada).toISOString()) === todayKey()).length;
  const focusReminderPatients = () => {
    setTab('active');
    setFilter('today');
    setSearch('');
    window.requestAnimationFrame(() => {
      document.getElementById('checklist-active-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1500px] mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><ClipboardCheck className="w-6 h-6 text-primary" /><h1 className="text-2xl font-bold tracking-tight">Checklist Pasien</h1><Badge variant="secondary">{active.length} aktif</Badge></div>
          <p className="text-sm text-muted-foreground mt-1">Pasien masuk kemarin atau sebelumnya akan tetap tampil sampai checklistnya selesai.</p>
        </div>
        {tab === 'history' && <Button variant="outline" onClick={() => exportChecklistHistoryExcel(filteredHistory)} disabled={!filteredHistory.length} className="gap-2"><Download className="w-4 h-4" /> Export Excel</Button>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total Checklist Aktif', value: active.length, color: 'text-primary' },
          { label: 'Belum Selesai', value: active.length, color: 'text-slate-600' },
          { label: 'Reminder Hari Ini', value: reminderCount, color: 'text-amber-600', action: focusReminderPatients },
          { label: 'Checklist Terlambat', value: overdueCount, color: 'text-red-600' },
          { label: 'Selesai Hari Ini', value: completedToday, color: 'text-emerald-600' },
        ].map(({ label, value, color, action }) => (
          <Card
            key={label}
            onClick={action}
            onKeyDown={event => {
              if (action && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                action();
              }
            }}
            role={action ? 'button' : undefined}
            tabIndex={action ? 0 : undefined}
            className={action ? 'cursor-pointer transition-shadow hover:shadow-md hover:ring-1 hover:ring-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500' : undefined}
          >
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
              {action && <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">Klik untuk melihat pasien</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        <Button variant="ghost" onClick={() => setTab('active')} className={`rounded-b-none border-b-2 whitespace-nowrap ${tab === 'active' ? 'border-primary text-primary' : 'border-transparent'}`}><ClipboardCheck className="w-4 h-4 mr-1" /> Checklist Aktif</Button>
        <Button variant="ghost" onClick={() => setTab('history')} className={`rounded-b-none border-b-2 whitespace-nowrap ${tab === 'history' ? 'border-primary text-primary' : 'border-transparent'}`}><History className="w-4 h-4 mr-1" /> History Checklist <Badge variant="secondary" className="ml-2">{history.length}</Badge></Button>
      </div>

      {tab === 'active' ? (
        <>
          <Card><CardContent className="p-4 flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[220px]"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari nama, No. RM, episode, DPJP, ruangan..." className="pl-9" /></div>
            <select value={filter} onChange={event => setFilter(event.target.value as ActiveFilter)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="all">Semua</option><option value="unfinished">Belum Selesai</option><option value="today">Reminder Hari Ini</option><option value="overdue">Terlambat</option><option value="plan">Ada Rencana Tindakan</option><option value="payer">Ada Penjamin</option><option value="doctor">Ada DPJP</option><option value="room">Ada Ruangan</option>
            </select>
            <span className="text-xs text-muted-foreground"><SlidersHorizontal className="w-3.5 h-3.5 inline mr-1" />{filteredActive.length} pasien tampil</span>
          </CardContent></Card>
          {loading ? <div id="checklist-active-list" className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div> : !filteredActive.length ? <Card id="checklist-active-list"><CardContent className="py-16 text-center text-muted-foreground">Tidak ada checklist pasien aktif.</CardContent></Card> : (
            <div id="checklist-active-list" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredActive.map(item => (
                <Card key={item.episodeNo} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openDetail(item)}>
                  <CardHeader className="pb-3"><div className="flex justify-between gap-2"><div><CardTitle className="text-base">{getPatientDisplayName(item.patient)}</CardTitle><p className="text-xs text-muted-foreground mt-1">RM {display(item.noRM)} · Ep {display(item.episodeNo)}</p><div className="flex flex-wrap gap-1.5 mt-2">{item.rencanaTindakanSumber === 'operating_theatre' && <Badge variant="outline" className="text-[10px] border-cyan-300 text-cyan-700 dark:text-cyan-300">Otomatis dari Rencana Tindakan</Badge>}{item.billingActionReminderToday && <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-300">Cek Billing Tindakan Hari Ini</Badge>}{item.billingActionOverdue && <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 dark:text-red-300">Billing Tindakan Terlambat</Badge>}</div></div><StatusBadge status={item.status} /></div></CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="grid grid-cols-2 gap-3"><div><p className="text-xs text-muted-foreground">Tanggal Masuk</p><p className="font-medium">{display(item.tanggalMasuk)}</p></div><div><p className="text-xs text-muted-foreground">Hari Rawat</p><p className="font-medium">{item.daysInCare} hari</p></div><div><p className="text-xs text-muted-foreground">Penjamin</p><p className="font-medium">{display(item.penjamin)}</p></div><div><p className="text-xs text-muted-foreground">DPJP</p><p className="font-medium">{display(item.dpjp)}</p></div><div className="col-span-2"><p className="text-xs text-muted-foreground">Ruangan</p><p className="font-medium">{display(item.ruangan)}</p></div></div>
                    <div><div className="flex justify-between text-xs mb-1"><span>Progress Checklist</span><span className="font-semibold">{item.completedCount}/{item.visibleMasters.length}</span></div><div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${item.visibleMasters.length ? Math.round(item.completedCount / item.visibleMasters.length * 100) : 0}%` }} /></div></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <Card><CardContent className="p-4"><div className="relative max-w-xl"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input value={historySearch} onChange={event => setHistorySearch(event.target.value)} placeholder="Cari nama, No. RM, episode, user..." className="pl-9" /></div></CardContent></Card>
            {!filteredHistory.length ? <Card><CardContent className="py-16 text-center text-muted-foreground">Belum ada history checklist.</CardContent></Card> : <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60 text-left"><tr>{['Nama Pasien', 'No. RM', 'Episode', 'Tanggal Masuk', 'Selesai', 'User', 'Lama', 'Detail'].map(header => <th key={header} className="px-4 py-3 font-semibold whitespace-nowrap">{header}</th>)}</tr></thead><tbody>{filteredHistory.map(item => <tr key={item.id} className="border-t hover:bg-muted/30"><td className="px-4 py-3 font-medium">{item.namaPasien}</td><td className="px-4 py-3">{item.noRM}</td><td className="px-4 py-3">{item.episodeNo}</td><td className="px-4 py-3">{formatDate(item.tanggalMasuk)}</td><td className="px-4 py-3">{formatDateTime(item.selesaiPada)}</td><td className="px-4 py-3">{item.selesaiOleh}</td><td className="px-4 py-3">{item.lamaPenyelesaianHari} hari</td><td className="px-4 py-3"><Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSelectedHistory(item)}><Eye className="w-3.5 h-3.5" /> Lihat</Button></td></tr>)}</tbody></table></div></Card>}
        </>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Checklist {selected ? getPatientDisplayName(selected.patient) : '-'}</DialogTitle></DialogHeader>
          {selected && <div className="space-y-4">
             <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-muted/40 p-3 text-sm"><div><p className="text-xs text-muted-foreground">No. RM</p><p className="font-medium">{selected.noRM}</p></div><div><p className="text-xs text-muted-foreground">Episode</p><p className="font-medium">{selected.episodeNo}</p></div><div><p className="text-xs text-muted-foreground">Penjamin</p><p className="font-medium">{display(selected.penjamin)}</p></div><div><p className="text-xs text-muted-foreground">Hari Rawat</p><p className="font-medium">{selected.daysInCare} hari</p></div></div>
             {selected.rencanaTindakanSumber === 'operating_theatre' && <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-200">Checklist ini dibuat otomatis dari Rencana Tindakan. Tanggal tindakan: <strong>{display(selected.tanggalRencanaTindakan)}</strong>.</div>}
             {(selected.billingActionReminderToday || selected.billingActionOverdue) && <div className={`rounded-lg border px-3 py-2 text-sm ${selected.billingActionOverdue ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'}`}>Periksa item <strong>Billing Tindakan Sudah Dicek</strong>. Batas pengecekan adalah sehari setelah tanggal tindakan.</div>}
            <div className="space-y-3">{selected.visibleMasters.map(master => <div key={master.id} className="space-y-1.5"><label className="text-sm font-medium flex items-center gap-1">{master.nama}{master.wajib && <span className="text-destructive">*</span>}<span className="text-xs text-muted-foreground font-normal ml-auto">{checklistFieldLabel(master.tipe)}</span></label><FieldInput master={master} value={answers[master.id] || ''} onChange={value => setAnswers(previous => ({ ...previous, [master.id]: value }))}/></div>)}</div>
            <div className="space-y-1.5"><label className="text-sm font-medium">Catatan</label><textarea value={catatan} onChange={event => setCatatan(event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-20" /></div>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>Batal</Button>{user?.role === 'superuser' && <Button variant="outline" onClick={() => void archive()} className="gap-2 text-destructive"><Archive className="w-4 h-4" /> Arsip Manual</Button>}<Button onClick={() => void save()} disabled={saving} className="gap-2">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Simpan Checklist</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedHistory)} onOpenChange={open => { if (!open) setSelectedHistory(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detail History Checklist</DialogTitle>
          </DialogHeader>
          {selectedHistory && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-muted/40 p-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Nama Pasien</p><p className="font-medium">{selectedHistory.namaPasien}</p></div>
                <div><p className="text-xs text-muted-foreground">No. RM</p><p className="font-medium">{selectedHistory.noRM}</p></div>
                <div><p className="text-xs text-muted-foreground">Episode</p><p className="font-medium">{selectedHistory.episodeNo}</p></div>
                <div><p className="text-xs text-muted-foreground">Tanggal Masuk</p><p className="font-medium">{formatDate(selectedHistory.tanggalMasuk)}</p></div>
                <div><p className="text-xs text-muted-foreground">Diselesaikan</p><p className="font-medium">{formatDateTime(selectedHistory.selesaiPada)}</p></div>
                <div><p className="text-xs text-muted-foreground">Oleh</p><p className="font-medium">{selectedHistory.selesaiOleh}</p></div>
                <div><p className="text-xs text-muted-foreground">Status</p><Badge variant="outline">{selectedHistory.tipeSelesai === 'arsip_manual' ? 'Arsip Manual' : 'Selesai'}</Badge></div>
                <div><p className="text-xs text-muted-foreground">Lama Penyelesaian</p><p className="font-medium">{selectedHistory.lamaPenyelesaianHari} hari</p></div>
              </div>
              <div>
                <h3 className="font-semibold mb-2">Item Checklist</h3>
                <div className="rounded-lg border divide-y">
                  {historyMasters.map(master => {
                    const answer = selectedHistory.answers?.[master.id] || '';
                    const visible = !master.kondisi || String(selectedHistory.answers?.[master.kondisi.fieldId] || '').toLowerCase() === master.kondisi.value.toLowerCase();
                    if (!visible) return null;
                    const checked = isChecklistAnswerComplete(master, answer);
                    return (
                      <div key={master.id} className="flex items-start justify-between gap-4 px-3 py-2.5 text-sm">
                        <div><p className="font-medium">{master.nama}</p><p className="text-xs text-muted-foreground">{checklistFieldLabel(master.tipe)}</p></div>
                        <div className={`text-right ${checked ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}>
                          <p className="font-medium">{answer || 'Belum diisi'}</p>
                          <p className="text-xs">{checked ? 'Sudah dicek' : 'Belum dicek'}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <h3 className="font-semibold mb-1">Catatan</h3>
                <p className="rounded-lg border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap">{selectedHistory.catatan || 'Tidak ada catatan.'}</p>
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setSelectedHistory(null)}>Tutup</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}