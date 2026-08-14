import React, { useState, useEffect, useCallback } from 'react';
import { getDB, Pending, Patient } from '../lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Search, Clock, AlertCircle, CheckCircle2, MessageSquare,
  Plus, Filter, X, Upload, Calendar, User
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { getCurrentShift, generateUUID } from '../lib/auth';
import { enqueueCloudRecordMutation } from '../lib/cloudSync';
import { EpisodeLink } from '@/components/EpisodeLink';
import { findMatchingPatient, getPatientDisplayName } from '../lib/patientIdentity';
import { formatDate, formatDateTime } from '../lib/utils';

const KATEGORI_LIST = [
  'Konfirmasi Billing',
  'Konfirmasi DPJP',
  'Konfirmasi Ruangan',
  'Konfirmasi Penjamin',
  'Konfirmasi Tindakan',
  'Administrasi',
  'Lainnya',
];

export default function PendingPage() {
  const [pendings, setPendings] = useState<Pending[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPrioritas, setFilterPrioritas] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  // Resolve modal
  const [selectedPending, setSelectedPending] = useState<Pending | null>(null);
  const [isResolveOpen, setIsResolveOpen] = useState(false);
  const [komentar, setKomentar] = useState('');

  // Add pending modal
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [form, setForm] = useState({
    kategori: 'Konfirmasi Billing',
    isiPending: '',
    prioritas: 'normal' as 'normal' | 'urgent' | 'critical',
    shift: getCurrentShift(),
    deadline: '',
    fotoBase64: '',
  });
  const [saving, setSaving] = useState(false);

  const { user } = useAuth();

  const loadData = useCallback(async () => {
    const db = await getDB();
    const all = await db.getAll('pendings');
    const sorted = [...all].sort((a, b) => {
      const sw = { pending: 1, diproses: 2, selesai: 3 };
      const pw = { critical: 1, urgent: 2, normal: 3 };
      if (sw[a.status] !== sw[b.status]) return sw[a.status] - sw[b.status];
      if (pw[a.prioritas] !== pw[b.prioritas]) return pw[a.prioritas] - pw[b.prioritas];
      return b.createdAt - a.createdAt;
    });
    const allPatients = await db.getAll('patients');
    const visiblePatients = allPatients.filter(
      p => p.status === 'aktif' || p.status === 'pulang_pending',
    );
    setPatients(visiblePatients);
    // Pending is episode-scoped for rawat inap. Operan yang dibuat dari IGD
    // tetap harus terlihat walaupun pasien IGD belum ada di object store
    // patients; pada kondisi itu nama/ruangan/episode diambil dari record
    // Pending yang tersimpan.
    setPendings(sorted.filter(p =>
      Boolean(findMatchingPatient(visiblePatients, p)) || p.kategori === 'IGD Ward',
    ));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const handleCloudRefresh = () => { void loadData(); };
    window.addEventListener('ipaw:pendings-cloud-refreshed', handleCloudRefresh);
    return () => window.removeEventListener('ipaw:pendings-cloud-refreshed', handleCloudRefresh);
  }, [loadData]);

  // Patient search for add modal
  useEffect(() => {
    if (!patientSearch.trim()) { setPatientResults([]); return; }
    const q = patientSearch.toLowerCase();
    const res = patients.filter(
      p => p.noRM.includes(q) || p.namaPasien.toLowerCase().includes(q)
    ).slice(0, 8);
    setPatientResults(res);
  }, [patientSearch, patients]);

  const filtered = pendings.filter(p => {
    const q = searchTerm.toLowerCase();
    const linkedPatient = findMatchingPatient(patients, p);
    const displayName = linkedPatient ? getPatientDisplayName(linkedPatient) : p.namaPasien;
    const matchSearch = !q ||
      displayName.toLowerCase().includes(q) ||
      p.noRM.includes(q) ||
      p.isiPending.toLowerCase().includes(q);
    const matchPrio = filterPrioritas === 'all' || p.prioritas === filterPrioritas;
    const matchStatus = filterStatus === 'all' || p.status === filterStatus;
    return matchSearch && matchPrio && matchStatus;
  });

  const displayPendingName = (pending: Pending) =>
    getPatientDisplayName(findMatchingPatient(patients, pending) ?? {
      namaPasien: pending.namaPasien,
      dob: '',
      sexDesc: '',
    });

  const handleProses = async (p: Pending) => {
    if (p.status !== 'pending') return;
    const db = await getDB();
    const updated = { ...p, status: 'diproses' as const, updatedAt: Date.now() };
    if (user) {
      updated.auditLog = [...(p.auditLog ?? []), {
        action: 'Mulai Diproses', userId: user.id, userName: user.namaLengkap, timestamp: Date.now()
      }];
    }
    await db.put('pendings', updated);
    try {
      await enqueueCloudRecordMutation('upsertRecord', 'pendings', 'id', { record: updated });
    } catch {
      toast.warning('Status tersimpan di perangkat, tetapi belum masuk antrean Cloud.');
    }
    toast.success('Status diubah ke Diproses');
    loadData();
  };

  const handleSelesaikan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPending || !user || !komentar.trim()) return;
    const db = await getDB();
    const updated = {
      ...selectedPending,
      status: 'selesai' as const,
      updatedAt: Date.now(),
      komentar: [...(selectedPending.komentar ?? []), {
        text: komentar, userId: user.id, userName: user.namaLengkap, timestamp: Date.now()
      }],
      auditLog: [...(selectedPending.auditLog ?? []), {
        action: 'Selesai', userId: user.id, userName: user.namaLengkap, timestamp: Date.now()
      }],
    };
    await db.put('pendings', updated);
    try {
      await enqueueCloudRecordMutation('upsertRecord', 'pendings', 'id', { record: updated });
    } catch {
      toast.warning('Penyelesaian tersimpan di perangkat, tetapi belum masuk antrean Cloud.');
    }
    toast.success('Pending berhasil diselesaikan');
    setIsResolveOpen(false);
    setKomentar('');
    setSelectedPending(null);
    loadData();
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Foto maksimal 2MB'); return; }
    const reader = new FileReader();
    reader.onload = ev => setForm(f => ({ ...f, fotoBase64: ev.target?.result as string }));
    reader.readAsDataURL(file);
  };

  const handleAddPending = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!selectedPatient) { toast.error('Pilih pasien terlebih dahulu'); return; }
    if (!form.isiPending.trim()) { toast.error('Isi pending tidak boleh kosong'); return; }

    setSaving(true);
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
        kategori: form.kategori,
        isiPending: form.isiPending.trim(),
        prioritas: form.prioritas,
        status: 'pending',
        deadline: form.deadline || null,
        fotoBase64: form.fotoBase64 || undefined,
        shift: form.shift,
        userId: user.id,
        userName: user.namaLengkap,
        komentar: [],
        auditLog: [{ action: 'Dibuat', userId: user.id, userName: user.namaLengkap, timestamp: now }],
        createdAt: now,
        updatedAt: now,
      };
      await db.put('pendings', pending);
      try {
        await enqueueCloudRecordMutation('upsertRecord', 'pendings', 'id', { record: pending });
      } catch {
        toast.warning('Pending tersimpan di perangkat, tetapi belum masuk antrean Cloud.');
      }
      toast.success('Pending berhasil ditambahkan');
      setIsAddOpen(false);
      resetAddForm();
      loadData();
    } catch {
      toast.error('Gagal menyimpan pending');
    } finally {
      setSaving(false);
    }
  };

  const resetAddForm = () => {
    setSelectedPatient(null);
    setPatientSearch('');
    setPatientResults([]);
    setForm({
      kategori: 'Konfirmasi Billing',
      isiPending: '',
      prioritas: 'normal',
      shift: getCurrentShift(),
      deadline: '',
      fotoBase64: '',
    });
  };

  const openAdd = () => { resetAddForm(); setIsAddOpen(true); };

  const prioritasColor = (p: string) =>
    p === 'critical' ? 'border-l-red-500' :
    p === 'urgent'   ? 'border-l-orange-500' :
                       'border-l-emerald-500';

  const prioritasBadge = (p: string) =>
    p === 'critical' ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400' :
    p === 'urgent'   ? 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400' :
                       'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400';

  const statusBadge = (s: string) =>
    s === 'selesai'  ? 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30' :
    s === 'diproses' ? 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30' :
                       'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30';

  const counts = {
    pending: pendings.filter(p => p.status === 'pending').length,
    diproses: pendings.filter(p => p.status === 'diproses').length,
    selesai: pendings.filter(p => p.status === 'selesai').length,
  };

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pending Operan</h1>
          <p className="text-muted-foreground mt-1">Monitor dan selesaikan tugas-tugas admission.</p>
        </div>
        <Button size="lg" className="gap-2 font-bold shadow-md" onClick={openAdd} data-testid="button-add-pending">
          <Plus className="w-5 h-5" /> Tambah Pending Baru
        </Button>
      </div>

      {/* Summary Chips */}
      <div className="flex gap-3 flex-wrap">
        {[
          { label: 'Menunggu', count: counts.pending, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
          { label: 'Diproses', count: counts.diproses, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
          { label: 'Selesai', count: counts.selesai, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
        ].map(c => (
          <span key={c.label} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border ${c.color}`}>
            {c.label}: {c.count}
          </span>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3 items-center bg-card p-4 rounded-xl border border-border shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari pasien, No RM, atau isi pending..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-10 h-10 bg-background"
            data-testid="input-search-pending"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={filterPrioritas}
            onChange={e => setFilterPrioritas(e.target.value)}
            className="h-10 px-3 border border-input rounded-md bg-background text-sm"
            data-testid="select-filter-prioritas"
          >
            <option value="all">Semua Prioritas</option>
            <option value="critical">Critical</option>
            <option value="urgent">Urgent</option>
            <option value="normal">Normal</option>
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="h-10 px-3 border border-input rounded-md bg-background text-sm"
            data-testid="select-filter-status"
          >
            <option value="all">Semua Status</option>
            <option value="pending">Pending</option>
            <option value="diproses">Diproses</option>
            <option value="selesai">Selesai</option>
          </select>
          {(filterPrioritas !== 'all' || filterStatus !== 'all' || searchTerm) && (
            <Button variant="ghost" size="icon" onClick={() => { setFilterPrioritas('all'); setFilterStatus('all'); setSearchTerm(''); }}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {filtered.map(p => (
          <Card key={p.id} className={`shadow-sm overflow-hidden border-l-4 ${prioritasColor(p.prioritas)} ${p.status === 'selesai' ? 'opacity-60' : ''}`} data-testid={`card-pending-${p.id}`}>
            <CardContent className="p-0">
              <div className="flex flex-col md:flex-row items-stretch">
                <div className="flex-1 p-5 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold bg-muted px-2 py-0.5 rounded">{p.noRM}</span>
                    <span className="font-bold text-base">{displayPendingName(p)}</span>
                    <span className="text-xs text-muted-foreground">Episode: <EpisodeLink episode={p.episodeNo} /></span>
                    <span className="text-sm text-muted-foreground">| {p.ruangan} | {p.kelas}</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${statusBadge(p.status)}`}>
                      {p.status.toUpperCase()}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${prioritasBadge(p.prioritas)}`}>
                      {p.prioritas.toUpperCase()}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border border-border text-muted-foreground">
                      {p.kategori}
                    </span>
                    {p.deadline && new Date(p.deadline) < new Date() && p.status !== 'selesai' && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-300 dark:bg-red-900/30 dark:text-red-400">
                        OVERDUE
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed text-foreground">{p.isiPending}</p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border/50 flex-wrap">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatDateTime(p.createdAt)} | Shift {p.shift}</span>
                    <span className="flex items-center gap-1"><User className="w-3 h-3" /> {p.userName}</span>
                    {p.deadline && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Deadline: {formatDate(p.deadline)}</span>}
                    {(p.komentar?.length ?? 0) > 0 && <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {p.komentar.length} komentar</span>}
                  </div>
                </div>

                <div className="bg-muted/30 p-4 flex flex-row md:flex-col justify-end gap-2 md:w-44 border-t md:border-t-0 md:border-l border-border shrink-0">
                  {p.status === 'pending' && (
                    <Button size="sm" onClick={() => handleProses(p)} className="w-full bg-blue-600 hover:bg-blue-700 text-white" data-testid={`button-proses-${p.id}`}>
                      Mulai Proses
                    </Button>
                  )}
                  {p.status !== 'selesai' && (
                    <Button
                      size="sm"
                      onClick={() => { setSelectedPending(p); setIsResolveOpen(true); }}
                      variant={p.status === 'diproses' ? 'default' : 'outline'}
                      className="w-full"
                      data-testid={`button-selesai-${p.id}`}
                    >
                      {p.status === 'diproses' ? 'Selesaikan' : 'Langsung Selesai'}
                    </Button>
                  )}
                  {p.status === 'selesai' && (
                    <div className="flex flex-col items-center justify-center h-full text-emerald-600 gap-1">
                      <CheckCircle2 className="w-7 h-7" />
                      <span className="text-xs font-semibold text-center">Selesai</span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-20 text-muted-foreground bg-card rounded-xl border border-border">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 opacity-20 text-primary" />
            <p className="text-lg font-semibold">Tidak ada pending ditemukan</p>
            <p className="text-sm mt-1">Semua clear atau coba ubah filter.</p>
          </div>
        )}
      </div>

      {/* ===== DIALOG TAMBAH PENDING ===== */}
      <Dialog open={isAddOpen} onOpenChange={v => { if (!v) resetAddForm(); setIsAddOpen(v); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">Tambah Pending Baru</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddPending} className="space-y-5 pt-2">

            {/* Patient Search */}
            <div className="space-y-2">
              <label className="text-sm font-semibold">Cari Pasien <span className="text-red-500">*</span></label>
              {selectedPatient ? (
                <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-700 rounded-lg p-3">
                  <div>
                    <p className="font-bold text-emerald-800 dark:text-emerald-300">{getPatientDisplayName(selectedPatient)}</p>
                    <p className="text-sm text-emerald-700 dark:text-emerald-400">
                      No RM: {selectedPatient.noRM} | {selectedPatient.ward || selectedPatient.roomName} | {selectedPatient.roomType}
                    </p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-500">Dokter: {selectedPatient.dpjp}</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => { setSelectedPatient(null); setPatientSearch(''); }}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Ketik No RM atau nama pasien..."
                    value={patientSearch}
                    onChange={e => setPatientSearch(e.target.value)}
                    className="pl-10"
                    autoComplete="off"
                  />
                  {patientResults.length > 0 && (
                    <div className="absolute z-50 w-full bg-popover border border-border rounded-lg shadow-lg mt-1 max-h-52 overflow-y-auto">
                      {patientResults.map(p => (
                        <button
                          key={p.noRM}
                          type="button"
                          className="w-full text-left px-4 py-3 hover:bg-accent transition-colors border-b border-border/50 last:border-0"
                          onClick={() => { setSelectedPatient(p); setPatientSearch(''); setPatientResults([]); }}
                        >
                          <p className="font-semibold text-sm">{getPatientDisplayName(p)}</p>
                          <p className="text-xs text-muted-foreground">{p.noRM} | {p.ward || p.roomName} | {p.roomType}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {patientSearch.length > 1 && patientResults.length === 0 && (
                    <div className="absolute z-50 w-full bg-popover border border-border rounded-lg shadow-lg mt-1 p-4 text-center text-sm text-muted-foreground">
                      Pasien tidak ditemukan
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Kategori */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Kategori <span className="text-red-500">*</span></label>
                <select
                  value={form.kategori}
                  onChange={e => setForm(f => ({ ...f, kategori: e.target.value }))}
                  className="h-10 w-full px-3 border border-input rounded-md bg-background text-sm"
                  required
                >
                  {KATEGORI_LIST.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Shift</label>
                <select
                  value={form.shift}
                  onChange={e => setForm(f => ({ ...f, shift: e.target.value as any }))}
                  className="h-10 w-full px-3 border border-input rounded-md bg-background text-sm"
                >
                  <option value="pagi">Pagi (07:00–14:00)</option>
                  <option value="sore">Sore (14:00–21:00)</option>
                  <option value="malam">Malam (21:00–07:00)</option>
                </select>
              </div>
            </div>

            {/* Isi Pending */}
            <div className="space-y-2">
              <label className="text-sm font-semibold">Isi Pending <span className="text-red-500">*</span></label>
              <textarea
                className="w-full min-h-[120px] flex rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Jelaskan pending yang perlu ditindaklanjuti..."
                value={form.isiPending}
                onChange={e => setForm(f => ({ ...f, isiPending: e.target.value }))}
                required
              />
            </div>

            {/* Prioritas */}
            <div className="space-y-2">
              <label className="text-sm font-semibold">Prioritas <span className="text-red-500">*</span></label>
              <div className="flex gap-3">
                {(['normal', 'urgent', 'critical'] as const).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, prioritas: p }))}
                    className={`flex-1 py-2.5 rounded-lg border-2 text-sm font-semibold transition-all ${
                      form.prioritas === p
                        ? p === 'critical' ? 'bg-red-500 border-red-500 text-white'
                          : p === 'urgent' ? 'bg-orange-500 border-orange-500 text-white'
                          : 'bg-emerald-500 border-emerald-500 text-white'
                        : 'bg-background border-border text-muted-foreground hover:border-primary'
                    }`}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Deadline + Foto */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Deadline (opsional)</label>
                <Input
                  type="datetime-local"
                  value={form.deadline}
                  onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))}
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Lampiran Foto (opsional)</label>
                <label className="flex items-center gap-2 h-10 px-3 border border-input rounded-md bg-background cursor-pointer hover:bg-accent transition-colors">
                  <Upload className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground truncate">
                    {form.fotoBase64 ? 'Foto dipilih' : 'Pilih foto...'}
                  </span>
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                </label>
              </div>
            </div>

            {form.fotoBase64 && (
              <div className="relative inline-block">
                <img src={form.fotoBase64} alt="Preview" className="h-24 w-auto rounded-lg border border-border object-cover" />
                <button type="button" onClick={() => setForm(f => ({ ...f, fotoBase64: '' }))} className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => { resetAddForm(); setIsAddOpen(false); }}>Batal</Button>
              <Button type="submit" disabled={saving || !selectedPatient} className="min-w-[130px]" data-testid="button-submit-pending">
                {saving ? 'Menyimpan...' : 'Simpan Pending'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===== DIALOG SELESAIKAN ===== */}
      <Dialog open={isResolveOpen} onOpenChange={v => { if (!v) setKomentar(''); setIsResolveOpen(v); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Selesaikan Pending</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSelesaikan} className="space-y-4 py-2">
            {selectedPending && (
              <div className="bg-muted/60 p-4 rounded-lg space-y-1">
                <p className="font-semibold text-sm">{displayPendingName(selectedPending)} — {selectedPending.ruangan}</p>
                <p className="text-sm">{selectedPending.isiPending}</p>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${prioritasBadge(selectedPending.prioritas)}`}>
                  {selectedPending.prioritas.toUpperCase()}
                </span>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-semibold">Komentar Penyelesaian <span className="text-red-500">*</span></label>
              <textarea
                className="w-full min-h-[100px] flex rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Jelaskan apa yang sudah dilakukan untuk menyelesaikan pending ini..."
                value={komentar}
                onChange={e => setKomentar(e.target.value)}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setIsResolveOpen(false); setKomentar(''); }}>Batal</Button>
              <Button type="submit" disabled={!komentar.trim()} data-testid="button-confirm-selesai">
                Konfirmasi Selesai
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
