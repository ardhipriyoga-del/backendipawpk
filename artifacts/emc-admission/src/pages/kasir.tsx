import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import QRCode from 'qrcode';
import { getDB, Patient, NotifikasiBillingStatus, KasirTemplate } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import {
  BILLING_TEMPLATE_CATEGORY,
  BILLING_TEMPLATE_NAME,
  DEFAULT_BILLING_TEMPLATE_BODY,
  ensureDefaultKasirTemplates,
} from './templatePesanKasir';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Search, Copy, MessageCircle, X, Phone, User2, CreditCard,
  Bell, Check, CheckCheck, BellRing, FileText, Settings, Pencil, Save, QrCode, Mail,
} from 'lucide-react';
import { useLocation } from 'wouter';
import { EpisodeLink } from '@/components/EpisodeLink';
import { formatDate } from '../lib/utils';
import { triggerAutoBackup } from '../lib/cloudSync';
import { sendWhatsApp } from '../lib/whatsapp';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

// ── Helpers ──────────────────────────────────────────────────────────────────
const getGreeting = () => {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'Pagi';
  if (h >= 12 && h < 15) return 'Siang';
  if (h >= 15 && h < 18) return 'Sore';
  return 'Malam';
};

const toRupiah = (val: string) => {
  const num = parseInt(val.replace(/\D/g, ''), 10);
  if (isNaN(num)) return '';
  return 'Rp ' + num.toLocaleString('id-ID');
};

const parseRupiah = (val: string) => val.replace(/\D/g, '');

const waLink = (hp: string, msg: string) => {
  let num = hp.replace(/\D/g, '');
  if (num.startsWith('0')) num = '62' + num.slice(1);
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
};

const fmtDate = (d: string) => {
  return formatDate(d);
};

const calcHariRawat = (admissionDate: string): number => {
  try {
    return Math.floor((Date.now() - new Date(admissionDate).getTime()) / 86400000);
  } catch { return 0; }
};

const calcHariRawatAt = (admissionDate: string, timestamp: number): number => {
  try {
    return Math.floor((timestamp - new Date(admissionDate).getTime()) / 86400000);
  } catch { return 0; }
};

function billingCycleHariRawat(hariRawat: number): number | null {
  return hariRawat >= 2 && hariRawat % 2 === 0 ? hariRawat : null;
}

// ── Placeholder utilities ─────────────────────────────────────────────────────
const RUPIAH_KEYS = new Set(['billing', 'deposit', 'sisa_deposit', 'kekurangan', 'estimasi_billing']);

const AUTO_KEYS = new Set([
  'nama_pasien', 'no_rm', 'episode', 'ruangan', 'kelas', 'dokter',
  'penjamin', 'tanggal_lahir', 'email_asuransi', 'no_kartu_asuransi',
  'diagnosa', 'salam', 'tanggal', 'jam', 'nama_petugas', 'no_hp_penanggung_jawab',
  // billing-tab auto fields
  'hari_rawat', 'estimasi_billing', 'tanggal_masuk',
]);

function getManualPlaceholders(isiTemplate: string): string[] {
  const matches = isiTemplate.match(/\{\{([^}]+)\}\}/g) ?? [];
  const keys = matches.map(m => m.slice(2, -2).trim());
  return [...new Set(keys.filter(k => !AUTO_KEYS.has(k)))];
}

function applyPlaceholders(
  isiTemplate: string,
  patient: Patient,
  currentUser: { namaLengkap: string; username: string },
  manualFields: Record<string, string>,
): string {
  const now = new Date();
  const tanggal = formatDate(now);
  const jam = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const ruangan = [patient.ward, patient.roomName, patient.bedCode].filter(Boolean).join(' / ');

  // Normalize common legacy spellings so older templates stored in IndexedDB
  // also produce the corrected wording without requiring a destructive reset.
  let msg = isiTemplate
    .replace(/\btindakn medis\b/gi, 'tindakan medis')
    .replace(/\btindakan media\b/gi, 'tindakan medis');
  msg = msg.replace(/\{\{salam\}\}/g, getGreeting());
  msg = msg.replace(/\{\{nama_pasien\}\}/g, patient.namaPasien || '');
  msg = msg.replace(/\{\{no_rm\}\}/g, patient.noRM || '');
  msg = msg.replace(/\{\{episode\}\}/g, patient.episodeNo || '');
  msg = msg.replace(/\{\{ruangan\}\}/g, ruangan || '-');
  msg = msg.replace(/\{\{kelas\}\}/g, patient.roomType || '-');
  msg = msg.replace(/\{\{dokter\}\}/g, patient.dpjp || '-');
  msg = msg.replace(/\{\{penjamin\}\}/g, patient.payor || '-');
  msg = msg.replace(/\{\{tanggal_lahir\}\}/g, patient.dob ? formatDate(patient.dob) : '-');
  msg = msg.replace(/\{\{email_asuransi\}\}/g, patient.emailAsuransi || '-');
  msg = msg.replace(/\{\{no_kartu_asuransi\}\}/g, patient.noKartuAsuransi || '-');
  msg = msg.replace(
    /\{\{diagnosa\}\}/g,
    patient.diagnosakUtama || patient.diagnosaMasuk || patient.diagnosaTambahan || '-',
  );
  msg = msg.replace(/\{\{no_hp_penanggung_jawab\}\}/g, patient.noHpPJ || '-');
  msg = msg.replace(/\{\{tanggal\}\}/g, tanggal);
  msg = msg.replace(/\{\{jam\}\}/g, jam);
  msg = msg.replace(/\{\{nama_petugas\}\}/g, currentUser.namaLengkap || currentUser.username);

  Object.entries(manualFields).forEach(([key, val]) => {
    const display = RUPIAH_KEYS.has(key) && val
      ? 'Rp ' + parseInt(val.replace(/\D/g, '') || '0', 10).toLocaleString('id-ID')
      : val;
    msg = msg.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), display);
  });

  return msg;
}

function labelForPlaceholder(key: string): string {
  const map: Record<string, string> = {
    billing: 'Billing (Rp)',
    deposit: 'Deposit (Rp)',
    sisa_deposit: 'Sisa Deposit (Rp)',
    kekurangan: 'Kekurangan (Rp)',
    permintaan: 'Permintaan Tindakan Medis',
    nama_penanggung_jawab: 'Nama Penanggung Jawab',
    daftar_obat: 'Daftar Obat & Estimasi',
    daftar_periksa: 'Daftar Pemeriksaan & Estimasi',
    daftar_obat_periksa: 'Daftar Obat & Pemeriksaan',
  };
  return map[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function buildBillingMessageFromTemplate(
  p: Patient,
  hariRawat: number,
  estimasi: number,
  template: string,
  currentUser: { namaLengkap: string; username: string } = { namaLengkap: '', username: '' },
): string {
  return applyPlaceholders(template, p, currentUser, {
    hari_rawat: String(hariRawat),
    estimasi_billing: String(estimasi),
    tanggal_masuk: fmtDate(p.admissionDate),
  });
}

// ── Notifikasi Billing Tab ────────────────────────────────────────────────────
function NotifikasiBillingTab() {
  const { user } = useAuth();
  const [patients, setPatients]         = useState<Patient[]>([]);
  const [statusMap, setStatusMap]       = useState<Map<string, NotifikasiBillingStatus>>(new Map());
  const [estimasiInputs, setEstimasiInputs] = useState<Map<string, string>>(new Map());
  const [filterStatus, setFilterStatus] = useState<'semua' | 'belum' | 'sudah'>('semua');
  const [filterHariRawat, setFilterHariRawat] = useState<number | 'semua'>('semua');
  const [filterPenjamin, setFilterPenjamin]   = useState<string>('semua');
  const [searchTerm, setSearchTerm]     = useState('');
  const [resetCycleIds, setResetCycleIds] = useState<Set<string>>(new Set());

  // ── Inline edit No HP PJ ──────────────────────────────────────────────────
  const [hpEditing, setHpEditing]   = useState<Set<string>>(new Set());
  const [hpInputs, setHpInputs]     = useState<Map<string, string>>(new Map());
  const [hpSaving, setHpSaving]     = useState<Set<string>>(new Set());
  const [qrLoading, setQrLoading] = useState(false);
  const [qrPayload, setQrPayload] = useState<{
    patient: Patient;
    phone: string;
    message: string;
    dataUrl: string;
  } | null>(null);
  const [billingTemplate, setBillingTemplate] = useState<KasirTemplate | null>(null);
  const [templateDraft, setTemplateDraft] = useState(DEFAULT_BILLING_TEMPLATE_BODY);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const templateTextareaRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const db = await getDB();
    await ensureDefaultKasirTemplates();
    const all = await db.getAll('patients');
    const allTemplates = await db.getAll('kasirTemplates');
    const savedBillingTemplate = allTemplates.find(template =>
      template.namaTemplate === BILLING_TEMPLATE_NAME &&
      template.kategori === BILLING_TEMPLATE_CATEGORY &&
      template.aktif,
    );
    setBillingTemplate(savedBillingTemplate ?? null);
    const today = Date.now();
    const filtered = all.filter(p => {
      if (p.status !== 'aktif' && p.status !== 'pulang_pending') return false;
      if (!p.payor || p.payor.toUpperCase().includes('BPJS')) return false;
      if (!p.admissionDate) return false;
      const hari = Math.floor((today - new Date(p.admissionDate).getTime()) / 86400000);
      return hari >= 2 && hari % 2 === 0;
    });
    setPatients(filtered);

    const statuses = await db.getAll('notifikasiBilling');
    const map = new Map<string, NotifikasiBillingStatus>();
    const inputs = new Map<string, string>();
    const statusById = new Map(statuses.map(status => [status.id, status]));
    const normalizedStatuses: NotifikasiBillingStatus[] = [];
    const resetIds = new Set<string>();
    for (const patient of filtered) {
      const cycle = billingCycleHariRawat(calcHariRawat(patient.admissionDate));
      if (cycle === null) continue;
      const existing = statusById.get(patient.episodeNo);
      if (!existing) continue;

      // Older records did not store a cycle. Infer it from the send time when
      // possible, so a previously sent notification is reset only on the next
      // actual 2-day cycle rather than on the first visit after this release.
      const recordedCycle = existing.siklusHariRawat ??
        (existing.sudahDikirim && existing.sentAt
          ? billingCycleHariRawat(calcHariRawatAt(patient.admissionDate, existing.sentAt))
          : null);
      const isNewCycle = existing.sudahDikirim && recordedCycle !== null && recordedCycle !== cycle;
      const normalized: NotifikasiBillingStatus = isNewCycle
        ? {
            id: patient.episodeNo,
            noRM: patient.noRM,
            episodeNo: patient.episodeNo,
            estimasiBilling: 0,
            sudahDikirim: false,
            siklusHariRawat: cycle,
            updatedAt: Date.now(),
          }
        : {
            ...existing,
            noRM: patient.noRM,
            episodeNo: patient.episodeNo,
            siklusHariRawat: cycle,
          };
      if (
        normalized.siklusHariRawat !== existing.siklusHariRawat ||
        normalized.estimasiBilling !== existing.estimasiBilling ||
        normalized.sudahDikirim !== existing.sudahDikirim ||
        normalized.sentAt !== existing.sentAt
      ) {
        await db.put('notifikasiBilling', normalized);
      }
      if (isNewCycle) resetIds.add(patient.episodeNo);
      normalizedStatuses.push(normalized);
    }
    for (const s of statuses) {
      const normalized = normalizedStatuses.find(item => item.id === s.id) ?? s;
      map.set(s.id, normalized);
      if (normalized.estimasiBilling > 0 || resetIds.has(s.id)) {
        inputs.set(s.id, String(normalized.estimasiBilling));
      }
    }
    setStatusMap(map);
    setEstimasiInputs(inputs);
    setResetCycleIds(resetIds);
    if (resetIds.size) await triggerAutoBackup();
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const getBillingMessage = (p: Patient, hariRawat: number, estimasi: number) =>
    buildBillingMessageFromTemplate(
      p,
      hariRawat,
      estimasi,
      billingTemplate?.isiTemplate ?? DEFAULT_BILLING_TEMPLATE_BODY,
      user ?? { namaLengkap: '', username: '' },
    );

  const hariRawatValues = useMemo(() => {
    const vals = new Set<number>();
    patients.forEach(p => vals.add(calcHariRawat(p.admissionDate)));
    return Array.from(vals).sort((a, b) => a - b);
  }, [patients]);

  const penjaminValues = useMemo(() => {
    const vals = new Set<string>();
    patients.forEach(p => { if (p.payor) vals.add(p.payor); });
    return Array.from(vals).sort();
  }, [patients]);

  const displayPatients = useMemo(() => {
    return patients.filter(p => {
      const st = statusMap.get(p.episodeNo);
      const hari = calcHariRawat(p.admissionDate);
      if (filterStatus === 'belum' && st?.sudahDikirim) return false;
      if (filterStatus === 'sudah' && !st?.sudahDikirim) return false;
      if (filterHariRawat !== 'semua' && hari !== filterHariRawat) return false;
      if (filterPenjamin !== 'semua' && p.payor !== filterPenjamin) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        if (!p.namaPasien.toLowerCase().includes(q) && !p.noRM.toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a, b) => calcHariRawat(a.admissionDate) - calcHariRawat(b.admissionDate));
  }, [patients, statusMap, filterStatus, filterHariRawat, filterPenjamin, searchTerm]);

  const saveEstimasi = async (p: Patient, rawDigits: string) => {
    const amount = parseInt(rawDigits.replace(/\D/g, ''), 10) || 0;
    const db = await getDB();
    const existing = statusMap.get(p.episodeNo);
    const cycle = billingCycleHariRawat(calcHariRawat(p.admissionDate));
    const updated: NotifikasiBillingStatus = {
      id: p.episodeNo,
      noRM: p.noRM,
      episodeNo: p.episodeNo,
      estimasiBilling: amount,
      sudahDikirim: existing?.sudahDikirim ?? false,
      siklusHariRawat: cycle ?? existing?.siklusHariRawat,
      sentAt: existing?.sentAt,
      updatedAt: Date.now(),
    };
    await db.put('notifikasiBilling', updated);
    setStatusMap(prev => new Map(prev).set(p.episodeNo, updated));
    await triggerAutoBackup();
  };

  const tandaiDikirim = async (p: Patient, sudah: boolean) => {
    const db = await getDB();
    const existing = statusMap.get(p.episodeNo);
    const cycle = billingCycleHariRawat(calcHariRawat(p.admissionDate));
    const updated: NotifikasiBillingStatus = {
      id: p.episodeNo,
      noRM: p.noRM,
      episodeNo: p.episodeNo,
      estimasiBilling: existing?.estimasiBilling ?? 0,
      sudahDikirim: sudah,
      siklusHariRawat: cycle ?? existing?.siklusHariRawat,
      sentAt: sudah ? Date.now() : undefined,
      updatedAt: Date.now(),
    };
    await db.put('notifikasiBilling', updated);
    setStatusMap(prev => new Map(prev).set(p.episodeNo, updated));
    await triggerAutoBackup();
    toast.success(sudah ? 'Ditandai sudah dikirim!' : 'Status dikembalikan ke belum dikirim.');
  };

  const copyBillingMessage = (p: Patient, hariRawat: number, estimasi: number) => {
    const msg = getBillingMessage(p, hariRawat, estimasi);
    navigator.clipboard.writeText(msg).then(() => toast.success('Pesan disalin ke clipboard!'));
  };

  const openBillingWhatsApp = (p: Patient, hariRawat: number, estimasi: number) => {
    if (!p.noHpPJ) {
      toast.error('No HP Penanggung Jawab belum diisi di data pasien.');
      return;
    }
    const msg = getBillingMessage(p, hariRawat, estimasi);
    window.open(waLink(p.noHpPJ, msg), '_blank');
  };

  const openBillingQr = async (p: Patient, hariRawat: number, estimasi: number) => {
    if (!p.noHpPJ) {
      toast.error('No HP Penanggung Jawab belum diisi di data pasien.');
      return;
    }
    if (estimasi <= 0) {
      toast.error('Masukkan nilai estimasi billing terlebih dahulu.');
      return;
    }

    const message = getBillingMessage(p, hariRawat, estimasi);
    setQrLoading(true);
    try {
      const dataUrl = await QRCode.toDataURL(waLink(p.noHpPJ, message), {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 360,
      });
      setQrPayload({ patient: p, phone: p.noHpPJ, message, dataUrl });
    } catch (error) {
      console.error('[Kasir] QR generation failed:', error);
      toast.error('QR Code gagal dibuat. Silakan coba lagi.');
    } finally {
      setQrLoading(false);
    }
  };

  const openTemplateEditor = () => {
    setTemplateDraft(billingTemplate?.isiTemplate ?? DEFAULT_BILLING_TEMPLATE_BODY);
    setTemplateDialogOpen(true);
  };

  const insertTemplatePlaceholder = (placeholder: string) => {
    const textarea = templateTextareaRef.current;
    if (!textarea) {
      setTemplateDraft(current => `${current}${placeholder}`);
      return;
    }
    const start = textarea.selectionStart ?? templateDraft.length;
    const end = textarea.selectionEnd ?? templateDraft.length;
    const next = templateDraft.slice(0, start) + placeholder + templateDraft.slice(end);
    setTemplateDraft(next);
    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + placeholder.length, start + placeholder.length);
    }, 0);
  };

  const saveBillingTemplate = async () => {
    const content = templateDraft.trim();
    if (!content) {
      toast.error('Isi pesan tidak boleh kosong.');
      return;
    }
    setTemplateSaving(true);
    try {
      const db = await getDB();
      const now = Date.now();
      const existing = await db.getAll('kasirTemplates');
      const saved = existing.find(template =>
        template.namaTemplate === BILLING_TEMPLATE_NAME &&
        template.kategori === BILLING_TEMPLATE_CATEGORY,
      );
      const updated: KasirTemplate = {
        ...(saved ?? {
          namaTemplate: BILLING_TEMPLATE_NAME,
          kategori: BILLING_TEMPLATE_CATEGORY,
          aktif: true,
          urutan: 8,
          createdAt: now,
        }),
        isiTemplate: templateDraft,
        updatedAt: now,
      };
      if (saved?.id != null) {
        await db.put('kasirTemplates', updated);
      } else {
        const id = await db.add('kasirTemplates', updated);
        updated.id = id;
      }
      setBillingTemplate(updated);
      setTemplateDialogOpen(false);
      await triggerAutoBackup();
      toast.success('Pesan Notifikasi Billing Sementara berhasil disimpan.');
    } catch (error) {
      console.error('[Kasir] save billing template failed:', error);
      toast.error('Gagal menyimpan pesan billing. Coba lagi.');
    } finally {
      setTemplateSaving(false);
    }
  };

  // ── Inline HP PJ handlers ─────────────────────────────────────────────────
  const startEditHp = (episodeNo: string, current: string) => {
    setHpInputs(prev => new Map(prev).set(episodeNo, current));
    setHpEditing(prev => new Set(prev).add(episodeNo));
  };

  const cancelEditHp = (episodeNo: string) => {
    setHpEditing(prev => { const s = new Set(prev); s.delete(episodeNo); return s; });
    setHpInputs(prev => { const m = new Map(prev); m.delete(episodeNo); return m; });
  };

  const saveHpPJ = async (p: Patient) => {
    const raw = (hpInputs.get(p.episodeNo) ?? '').trim();
    if (!raw) { toast.error('Nomor HP tidak boleh kosong.'); return; }
    setHpSaving(prev => new Set(prev).add(p.episodeNo));
    try {
      const db = await getDB();
      const existing = await db.get('patients', p.noRM);
      if (!existing) { toast.error('Data pasien tidak ditemukan.'); return; }
      const updated = { ...existing, noHpPJ: raw, updatedAt: Date.now() };
      await db.put('patients', updated);
      // Update local patients state so UI reflects immediately
      setPatients(prev => prev.map(pt => pt.episodeNo === p.episodeNo ? { ...pt, noHpPJ: raw } : pt));
      cancelEditHp(p.episodeNo);
      toast.success('No HP Penanggung Jawab berhasil disimpan.');
    } catch {
      toast.error('Gagal menyimpan No HP. Coba lagi.');
    } finally {
      setHpSaving(prev => { const s = new Set(prev); s.delete(p.episodeNo); return s; });
    }
  };

  const belumCount = patients.filter(p => !statusMap.get(p.episodeNo)?.sudahDikirim).length;
  const sudahCount = patients.filter(p => statusMap.get(p.episodeNo)?.sudahDikirim === true).length;

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4 text-primary" />
              Pesan Notifikasi Billing Sementara
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Pesan custom ini digunakan untuk Copy Pesan, WhatsApp, dan QR pada semua kartu pasien.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={openTemplateEditor} className="shrink-0 gap-2">
            <Pencil className="h-3.5 w-3.5" />
            Custom Pesan
          </Button>
        </CardContent>
      </Card>

      {/* Summary counts */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4 text-center">
          <p className="text-2xl font-bold">{patients.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Pasien</p>
        </div>
        <div className="rounded-xl border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 p-4 text-center">
          <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{belumCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Belum Dikirim</p>
        </div>
        <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 p-4 text-center">
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{sudahCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Sudah Dikirim</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari nama atau No RM..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            {/* Status filter */}
            <div className="flex gap-1 bg-muted rounded-lg p-1">
              {(['semua', 'belum', 'sudah'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    filterStatus === s
                      ? 'bg-background shadow text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {s === 'semua' ? 'Semua' : s === 'belum' ? 'Belum Dikirim' : 'Sudah Dikirim'}
                </button>
              ))}
            </div>

            {/* Hari rawat filter */}
            <select
              className="text-xs border border-input bg-background rounded-lg px-3 py-1.5 h-8 focus:outline-none focus:ring-1 focus:ring-ring"
              value={filterHariRawat}
              onChange={e => setFilterHariRawat(e.target.value === 'semua' ? 'semua' : Number(e.target.value))}
            >
              <option value="semua">Semua Hari Rawat</option>
              {hariRawatValues.map(h => (
                <option key={h} value={h}>Hari ke-{h}</option>
              ))}
            </select>

            {/* Penjamin filter */}
            <select
              className="text-xs border border-input bg-background rounded-lg px-3 py-1.5 h-8 focus:outline-none focus:ring-1 focus:ring-ring"
              value={filterPenjamin}
              onChange={e => setFilterPenjamin(e.target.value)}
            >
              <option value="semua">Semua Penjamin</option>
              {penjaminValues.map(pj => (
                <option key={pj} value={pj}>{pj}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Patient cards */}
      {displayPatients.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">Tidak ada pasien yang memenuhi kriteria</p>
           <p className="text-xs mt-1 opacity-70">Pasien non-BPJS aktif atau menunggu konfirmasi pulang dengan hari rawat kelipatan 2 (2, 4, 6, 8, ...)</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayPatients.map(p => {
            const hariRawat  = calcHariRawat(p.admissionDate);
            const stored     = statusMap.get(p.episodeNo);
            const sudahDikirim = stored?.sudahDikirim ?? false;
            const cycleHariRawat = billingCycleHariRawat(hariRawat);
            const wasResetForNewCycle = resetCycleIds.has(p.episodeNo);
            const rawInput   = estimasiInputs.get(p.episodeNo) ?? (stored?.estimasiBilling ? String(stored.estimasiBilling) : '');
            const estimasiNum = parseInt(rawInput.replace(/\D/g, ''), 10) || 0;

            return (
              <div
                key={p.episodeNo}
                className={`rounded-xl border p-4 space-y-3 transition-all ${
                  sudahDikirim
                    ? 'bg-emerald-50/60 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800'
                    : 'bg-card border-border hover:border-primary/30'
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-base leading-tight truncate">{p.namaPasien}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                      <span>RM: <span className="font-medium text-foreground">{p.noRM}</span></span>
                      <span>Ep: <EpisodeLink episode={p.episodeNo} className="font-medium text-foreground" /></span>
                    </div>
                  </div>
                   {p.status === 'pulang_pending' && (
                     <span className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full border border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300">
                       Menunggu konfirmasi pulang
                     </span>
                   )}
                  <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${
                    sudahDikirim
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                      : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                  }`}>
                    {sudahDikirim ? `✓ Sudah Dikirim · Hari ke-${stored?.siklusHariRawat ?? cycleHariRawat ?? hariRawat}` : 'Belum Dikirim'}
                  </span>
                </div>

                {/* Info grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Penjamin</p>
                    <p className="font-semibold truncate">{p.payor || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ruangan/Kamar</p>
                    <p className="font-semibold truncate">{p.ward || p.roomName || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tanggal Masuk</p>
                    <p className="font-semibold">{fmtDate(p.admissionDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Hari Rawat</p>
                    <p className="font-bold text-primary text-base">Hari ke-{hariRawat}</p>
                  </div>
                  <div className="col-span-2">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-xs text-muted-foreground">No. HP Penanggung Jawab</p>
                      {!hpEditing.has(p.episodeNo) && (
                        <button
                          onClick={() => startEditHp(p.episodeNo, p.noHpPJ || '')}
                          className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                          title={p.noHpPJ ? 'Ubah No HP' : 'Tambah No HP'}
                        >
                          <Pencil className="w-3 h-3" />
                          {p.noHpPJ ? 'Ubah' : 'Tambah'}
                        </button>
                      )}
                    </div>

                    {hpEditing.has(p.episodeNo) ? (
                      /* ── Inline edit form ── */
                      <div className="flex gap-2 items-center mt-1">
                        <Input
                          autoFocus
                          inputMode="tel"
                          placeholder="Contoh: 08123456789"
                          value={hpInputs.get(p.episodeNo) ?? ''}
                          onChange={e => setHpInputs(prev => new Map(prev).set(p.episodeNo, e.target.value))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveHpPJ(p);
                            if (e.key === 'Escape') cancelEditHp(p.episodeNo);
                          }}
                          className="h-8 text-sm flex-1"
                        />
                        <Button
                          size="sm"
                          className="h-8 px-3 gap-1 text-xs"
                          onClick={() => saveHpPJ(p)}
                          disabled={hpSaving.has(p.episodeNo)}
                        >
                          <Save className="w-3.5 h-3.5" />
                          {hpSaving.has(p.episodeNo) ? '...' : 'Simpan'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2"
                          onClick={() => cancelEditHp(p.episodeNo)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : p.noHpPJ ? (
                      /* ── HP tersedia ── */
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5" /> {p.noHpPJ}
                        </span>
                        <a
                          href={waLink(p.noHpPJ, getBillingMessage(p, hariRawat, estimasiNum))}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#25D366]/10 text-[#128C7E] border border-[#25D366]/30 hover:bg-[#25D366]/20 transition-colors"
                        >
                          <MessageCircle className="w-3 h-3" /> WhatsApp
                        </a>
                      </div>
                    ) : (
                      /* ── HP belum diisi ── */
                      <button
                        onClick={() => startEditHp(p.episodeNo, '')}
                        className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        No HP belum diisi — klik untuk menambahkan
                      </button>
                    )}
                  </div>
                </div>

                {/* Estimasi billing input */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold">Estimasi Billing Sementara</label>
                    <span className="text-[11px] text-muted-foreground">
                      Siklus {cycleHariRawat ? `hari ke-${cycleHariRawat}` : 'berikutnya'}
                    </span>
                  </div>
                  {wasResetForNewCycle && (
                    <div className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                      Siklus baru: estimasi direset ke Rp 0 dan status kembali Belum Dikirim.
                    </div>
                  )}
                  <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground select-none">Rp</span>
                      <Input
                        className="pl-9 font-semibold"
                        inputMode="numeric"
                        placeholder="0"
                        value={rawInput}
                        onChange={e => {
                          const digits = e.target.value.replace(/\D/g, '');
                          setEstimasiInputs(prev => new Map(prev).set(p.episodeNo, digits));
                        }}
                        onBlur={() => saveEstimasi(p, rawInput)}
                      />
                    </div>
                    {estimasiNum > 0 && (
                      <p className="text-sm font-bold text-primary whitespace-nowrap shrink-0">
                        {estimasiNum.toLocaleString('id-ID')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 min-w-[9rem] gap-1.5 text-xs h-8"
                    onClick={() => copyBillingMessage(p, hariRawat, estimasiNum)}
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy Pesan
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 min-w-[9rem] gap-1.5 text-xs h-8 border-primary/40 text-primary hover:bg-primary/10"
                    onClick={() => openBillingQr(p, hariRawat, estimasiNum)}
                    disabled={qrLoading || !p.noHpPJ || estimasiNum <= 0}
                    title={!p.noHpPJ ? 'Isi No HP Penanggung Jawab terlebih dahulu' : estimasiNum <= 0 ? 'Masukkan estimasi billing terlebih dahulu' : 'Buat QR untuk dipindai HP petugas'}
                  >
                    <QrCode className="w-3.5 h-3.5" /> {qrLoading ? 'Membuat QR...' : 'Tampilkan QR'}
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 min-w-[9rem] gap-1.5 text-xs h-8 bg-[#25D366] hover:bg-[#20bd5a] text-white border-0"
                    onClick={() => {
                      if (!p.noHpPJ) {
                        startEditHp(p.episodeNo, '');
                        return;
                      }
                      openBillingWhatsApp(p, hariRawat, estimasiNum);
                    }}
                    title={!p.noHpPJ ? 'Klik untuk mengisi No HP PJ terlebih dahulu' : `Kirim ke ${p.noHpPJ}`}
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    {p.noHpPJ ? 'WhatsApp' : 'Isi No HP & Kirim'}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  QR akan membuka chat WhatsApp keluarga di HP petugas dengan pesan billing yang sudah terisi. Petugas tetap menekan tombol Kirim di WhatsApp.
                </p>

                <Button
                  size="sm"
                  variant={sudahDikirim ? 'outline' : 'default'}
                  className={`w-full gap-2 text-xs h-8 ${
                    sudahDikirim
                      ? 'border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                      : ''
                  }`}
                  onClick={() => tandaiDikirim(p, !sudahDikirim)}
                >
                  {sudahDikirim ? (
                    <><CheckCheck className="w-3.5 h-3.5" /> Sudah Dikirim — Batalkan</>
                  ) : (
                    <><Check className="w-3.5 h-3.5" /> Tandai Sudah Dikirim</>
                  )}
                </Button>

              </div>
            );
          })}
        </div>
      )}
      <Dialog open={templateDialogOpen} onOpenChange={open => !open && setTemplateDialogOpen(false)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Custom Pesan Notifikasi Billing Sementara</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ubah susunan kalimat sesuai kebutuhan. Placeholder akan otomatis diganti saat pesan dibuat.
            </p>
            <div className="flex flex-wrap gap-1.5 rounded-lg border bg-muted/30 p-3">
              {[
                ['{{salam}}', 'Salam'],
                ['{{nama_pasien}}', 'Nama Pasien'],
                ['{{no_rm}}', 'No. RM'],
                ['{{penjamin}}', 'Penjamin'],
                ['{{tanggal_lahir}}', 'Tanggal Lahir'],
                ['{{email_asuransi}}', 'Email Asuransi'],
                ['{{no_kartu_asuransi}}', 'No. Kartu Asuransi'],
                ['{{permintaan}}', 'Permintaan Tindakan'],
                ['{{hari_rawat}}', 'Hari Rawat'],
                ['{{estimasi_billing}}', 'Estimasi Billing'],
                ['{{tanggal_masuk}}', 'Tanggal Masuk'],
                ['{{ruangan}}', 'Ruangan'],
                ['{{dokter}}', 'DPJP'],
                ['{{nama_petugas}}', 'Nama Petugas'],
              ].map(([placeholder, label]) => (
                <button
                  key={placeholder}
                  type="button"
                  onClick={() => insertTemplatePlaceholder(placeholder)}
                  className="rounded border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                  title={`Sisipkan ${label}`}
                >
                  {placeholder}
                </button>
              ))}
            </div>
            <textarea
              ref={templateTextareaRef}
              value={templateDraft}
              onChange={event => setTemplateDraft(event.target.value)}
              className="min-h-[360px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm font-mono leading-relaxed shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label="Isi custom pesan Notifikasi Billing Sementara"
            />
            <p className="text-xs text-muted-foreground">
              Estimasi billing akan ditampilkan dalam format Rupiah. Pesan lama dapat dikembalikan dengan tombol “Gunakan Default”.
            </p>
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTemplateDraft(DEFAULT_BILLING_TEMPLATE_BODY)}
              disabled={templateSaving}
            >
              Gunakan Default
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setTemplateDialogOpen(false)} disabled={templateSaving}>
                Batal
              </Button>
              <Button type="button" onClick={saveBillingTemplate} disabled={templateSaving || !templateDraft.trim()}>
                {templateSaving ? 'Menyimpan...' : 'Simpan Pesan'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(qrPayload)} onOpenChange={open => { if (!open) setQrPayload(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-primary" />
              QR WhatsApp Keluarga Pasien
            </DialogTitle>
          </DialogHeader>
          {qrPayload && (
            <div className="space-y-4">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                <p className="font-semibold text-foreground">{qrPayload.patient.namaPasien}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  No. HP keluarga: <span className="font-medium text-foreground">{qrPayload.phone}</span>
                </p>
              </div>
              <div className="flex justify-center rounded-xl border bg-white p-4">
                <img
                  src={qrPayload.dataUrl}
                  alt={`QR WhatsApp untuk keluarga pasien ${qrPayload.patient.namaPasien}`}
                  className="h-72 w-72 max-w-full"
                />
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <strong>Cara menggunakan:</strong> buka pemindai QR di HP petugas, arahkan ke kode ini, lalu periksa pesan dan tekan <strong>Kirim</strong> di WhatsApp.
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Isi pesan</p>
                <p className="max-h-36 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
                  {qrPayload.message}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Pesan Kasir Tab — dynamic templates from DB ───────────────────────────────
type KasirSection = 'pesan' | 'notifikasi' | 'ktm';

function PesanKasirTab({ section = 'pesan' }: { section?: 'pesan' | 'ktm' }) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const [patients, setPatients]           = useState<Patient[]>([]);
  const [templates, setTemplates]         = useState<KasirTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [searchTerm, setSearchTerm]       = useState('');
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<KasirTemplate | null>(null);
  const [manualFields, setManualFields]   = useState<Record<string, string>>({});
  const [manualPlaceholders, setManualPlaceholders] = useState<string[]>([]);
  const [message, setMessage]             = useState('');
  const [hpEditing, setHpEditing]         = useState(false);
  const [hpInput, setHpInput]              = useState('');
  const [hpSaving, setHpSaving]            = useState(false);
  const [qrLoading, setQrLoading]          = useState(false);
  const [qrPayload, setQrPayload] = useState<{
    patient: Patient;
    phone: string;
    message: string;
    dataUrl: string;
  } | null>(null);

  // Load patients + templates (seed defaults if empty)
  const loadAll = useCallback(async () => {
    const db = await getDB();
    const [allPatients] = await Promise.all([
      db.getAll('patients'),
      ensureDefaultKasirTemplates(),
    ]);
    setPatients(allPatients.filter(p => p.status === 'aktif' || p.status === 'pulang_pending'));

    const allTpls = await db.getAll('kasirTemplates');
    setTemplates(
      allTpls
        .filter(t => t.aktif && (section === 'ktm' ? t.kategori === 'Kirim KTM' : t.kategori !== 'Kirim KTM'))
        .sort((a, b) => a.urutan - b.urutan),
    );
    setLoadingTemplates(false);
  }, [section]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Search patients
  useEffect(() => {
    if (!searchTerm.trim()) { setSearchResults([]); return; }
    const q = searchTerm.toLowerCase();
    setSearchResults(
      patients.filter(p =>
        p.noRM.toLowerCase().includes(q) || p.namaPasien.toLowerCase().includes(q)
      ).slice(0, 8)
    );
  }, [searchTerm, patients]);

  // Re-generate message whenever template, patient, or manual fields change
  useEffect(() => {
    if (!selectedTemplate || !selectedPatient || !user) { setMessage(''); return; }
    const generated = applyPlaceholders(selectedTemplate.isiTemplate, selectedPatient, user, manualFields);
    setMessage(generated);
  }, [selectedTemplate, selectedPatient, user, manualFields]);

  const selectPatient = (p: Patient) => {
    setSelectedPatient(p);
    setSearchTerm('');
    setSearchResults([]);
    setSelectedTemplate(null);
    setManualFields({});
    setManualPlaceholders([]);
    setMessage('');
  };

  const clearPatient = () => {
    setSelectedPatient(null);
    setSelectedTemplate(null);
    setManualFields({});
    setManualPlaceholders([]);
    setMessage('');
    setHpEditing(false);
    setHpInput('');
    setQrPayload(null);
  };

  const selectTemplate = (tpl: KasirTemplate) => {
    setSelectedTemplate(tpl);
    setManualFields({});
    setManualPlaceholders(getManualPlaceholders(tpl.isiTemplate));
  };

  const setField = (key: string, val: string) =>
    setManualFields(f => ({ ...f, [key]: val }));

  const handleRupiahInput = (key: string, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    setField(key, digits);
  };

  const copyMessage = () => {
    if (!message) return;
    navigator.clipboard.writeText(message).then(() => toast.success('Pesan disalin ke clipboard!'));
  };

  const openWhatsApp = async () => {
    if (!message) return;
    const hp = selectedPatient?.noHpPJ || '';
    if (!hp) { toast.error('No HP Penanggung Jawab belum diisi di data pasien.'); return; }
    try {
      const result = await sendWhatsApp(hp, message);
      toast.success(result.message || 'WhatsApp berhasil dikirim.');
    } catch (error) {
      toast.error(`WhatsApp gagal dikirim: ${error instanceof Error ? error.message : 'Terjadi kesalahan.'}`);
    }
  };

  const openInsuranceEmail = () => {
    if (!selectedPatient || !message) return;
    const recipient = selectedPatient.emailAsuransi?.trim() || '';
    const cardNumber = selectedPatient.noKartuAsuransi?.trim() || '';
    if (!recipient) {
      toast.error('Email asuransi belum diisi di data pasien.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      toast.error('Format email asuransi belum valid.');
      return;
    }
    if (!cardNumber) {
      toast.error('No kartu asuransi belum diisi di data pasien.');
      return;
    }
    const subject = `${selectedPatient.namaPasien} // ${cardNumber} // Konfirmasi Tindakan Medis`;
    window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  };

  const startHpEdit = () => {
    setHpInput(selectedPatient?.noHpPJ || '');
    setHpEditing(true);
  };

  const cancelHpEdit = () => {
    setHpEditing(false);
    setHpInput('');
  };

  const saveHp = async () => {
    if (!selectedPatient) return;
    const raw = hpInput.trim();
    if (!raw) {
      toast.error('Nomor HP tidak boleh kosong.');
      return;
    }
    setHpSaving(true);
    try {
      const db = await getDB();
      const existing = await db.get('patients', selectedPatient.noRM);
      if (!existing) {
        toast.error('Data pasien tidak ditemukan.');
        return;
      }
      const updated = { ...existing, noHpPJ: raw, updatedAt: Date.now() };
      await db.put('patients', updated);
      setSelectedPatient(updated);
      setPatients(prev => prev.map(p => p.noRM === updated.noRM ? updated : p));
      setHpEditing(false);
      setHpInput('');
      await triggerAutoBackup();
      toast.success('No HP Penanggung Jawab berhasil disimpan.');
    } catch (error) {
      console.error('[Kasir] save guardian phone failed:', error);
      toast.error('Gagal menyimpan No HP. Coba lagi.');
    } finally {
      setHpSaving(false);
    }
  };

  const openMessageQr = async () => {
    if (!selectedPatient || !message) return;
    if (!allFieldsFilled) {
      toast.error('Lengkapi data pesan terlebih dahulu.');
      return;
    }
    const phone = selectedPatient.noHpPJ || '';
    if (!phone) {
      toast.error('No HP Penanggung Jawab belum diisi di data pasien.');
      return;
    }

    setQrLoading(true);
    try {
      const dataUrl = await QRCode.toDataURL(waLink(phone, message), {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 360,
      });
      setQrPayload({ patient: selectedPatient, phone, message, dataUrl });
    } catch (error) {
      console.error('[Kasir] QR generation failed:', error);
      toast.error('QR Code gagal dibuat. Silakan coba lagi.');
    } finally {
      setQrLoading(false);
    }
  };

  // Group templates by category
  const grouped = useMemo(() => {
    const map = new Map<string, KasirTemplate[]>();
    for (const t of templates) {
      const cat = t.kategori || 'Lainnya';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(t);
    }
    return map;
  }, [templates]);

  const categories = useMemo(() => Array.from(grouped.keys()), [grouped]);
  const [activeCategory, setActiveCategory] = useState<string>('');

  // Set active category when templates load or change
  useEffect(() => {
    if (categories.length > 0 && !categories.includes(activeCategory)) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  // Strip category prefix from template name for shorter display
  const shortName = (tpl: KasirTemplate) => {
    const prefix = tpl.kategori ? tpl.kategori + ' — ' : '';
    return tpl.namaTemplate.startsWith(prefix)
      ? tpl.namaTemplate.slice(prefix.length)
      : tpl.namaTemplate;
  };

  const currentTemplates = grouped.get(activeCategory) ?? [];
  const allFieldsFilled = manualPlaceholders.length === 0 || manualPlaceholders.every(k => !!manualFields[k]);

  // Current step: 1 = pilih pasien, 2 = pilih template, 3 = kirim
  const step = !selectedPatient ? 1 : !selectedTemplate ? 2 : 3;

  return (
    <div className="space-y-4">

      {/* ── Step 1: Pilih Pasien ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${step >= 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>1</span>
          <p className="text-sm font-semibold text-foreground">Pilih Pasien</p>
        </div>

        {selectedPatient ? (
          <div className="flex items-center justify-between gap-3 bg-card border border-border border-l-2 border-l-primary rounded-lg px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm text-foreground truncate">{selectedPatient.namaPasien}</p>
              <p className="text-xs text-muted-foreground truncate">
                {selectedPatient.noRM}
                {selectedPatient.ward ? ` · ${selectedPatient.ward}` : ''}
                {selectedPatient.payor ? ` · ${selectedPatient.payor}` : ''}
              </p>
              {hpEditing ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    value={hpInput}
                    onChange={e => setHpInput(e.target.value)}
                    placeholder="Contoh: 081234567890"
                    type="tel"
                    inputMode="tel"
                    autoFocus
                    className="h-8 w-56 bg-background text-xs"
                    aria-label="Nomor HP Penanggung Jawab"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={saveHp}
                    disabled={hpSaving || !hpInput.trim()}
                    className="h-8 gap-1 text-xs"
                  >
                    <Save className="w-3.5 h-3.5" /> {hpSaving ? 'Menyimpan...' : 'Simpan'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={cancelHpEdit}
                    disabled={hpSaving}
                    className="h-8 text-xs"
                  >
                    Batal
                  </Button>
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {selectedPatient.noHpPJ ? (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {selectedPatient.noHpPJ}
                    </span>
                  ) : (
                    <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <Phone className="w-3 h-3" /> No HP PJ belum diisi
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={startHpEdit}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                  >
                    <Pencil className="w-3 h-3" />
                    {selectedPatient.noHpPJ ? 'Ubah No HP' : 'Tambah No HP'}
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={clearPatient}
              className="text-muted-foreground hover:text-destructive shrink-0 p-1 rounded-md hover:bg-destructive/10 transition-colors"
              title="Ganti pasien"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Ketik nama atau No RM pasien..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-10"
              autoComplete="off"
            />
            {searchResults.length > 0 && (
              <div className="absolute z-50 w-full bg-popover border border-border rounded-xl shadow-lg mt-1 max-h-56 overflow-y-auto">
                {searchResults.map(p => (
                  <button
                    key={p.noRM}
                    type="button"
                    className="w-full text-left px-4 py-3 hover:bg-accent transition-colors border-b border-border/50 last:border-0 first:rounded-t-xl last:rounded-b-xl"
                    onClick={() => selectPatient(p)}
                  >
                    <p className="font-semibold text-sm">{p.namaPasien}</p>
                    <p className="text-xs text-muted-foreground">{p.noRM} · {p.ward || p.roomName} · {p.payor}</p>
                  </button>
                ))}
              </div>
            )}
            {searchTerm.length > 1 && searchResults.length === 0 && (
              <div className="absolute z-50 w-full bg-popover border border-border rounded-xl shadow-lg mt-1 p-4 text-center text-sm text-muted-foreground">
                Pasien tidak ditemukan
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Step 2: Pilih Template ── */}
      {selectedPatient && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${step >= 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>2</span>
              <p className="text-sm font-semibold text-foreground">Pilih Jenis Pesan</p>
            </div>
            <button
              onClick={() => setLocation('/settings')}
              className="text-xs flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
            >
              <Settings className="w-3 h-3" /> Kelola
            </button>
          </div>

          {loadingTemplates ? (
            <p className="text-sm text-muted-foreground px-1">Memuat...</p>
          ) : templates.length === 0 ? (
            <div className="text-center py-8 space-y-2 border border-dashed rounded-xl">
              <FileText className="w-7 h-7 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Belum ada template aktif.</p>
              <button onClick={() => setLocation('/settings')} className="text-xs text-primary hover:underline">
                Tambahkan di Pengaturan
              </button>
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden bg-card">
              {/* Category tab bar */}
              {categories.length > 1 && (
                <div className="flex overflow-x-auto border-b border-border bg-muted/40 scrollbar-hide">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`flex-shrink-0 px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${
                        activeCategory === cat
                          ? 'border-primary text-primary bg-background'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}

              {/* Template list for active category */}
              <div className="divide-y divide-border">
                {currentTemplates.map(t => {
                  const isSelected = selectedTemplate?.id === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => selectTemplate(t)}
                      className={`w-full text-left px-4 py-3 flex items-center justify-between gap-3 transition-colors ${
                        isSelected
                           ? 'bg-primary/[0.04] text-primary'
                          : 'hover:bg-muted/60 text-foreground'
                      }`}
                    >
                      <span className="text-sm font-medium">{shortName(t)}</span>
                      {isSelected && (
                        <span className="shrink-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                          <Check className="w-3 h-3 text-primary-foreground" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Isi data + kirim ── */}
      {selectedTemplate && selectedPatient && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 bg-primary text-primary-foreground">3</span>
            <p className="text-sm font-semibold text-foreground">
              {manualPlaceholders.length > 0 ? 'Lengkapi Data & Kirim' : 'Preview & Kirim'}
            </p>
          </div>

          <div className="border border-border rounded-lg overflow-hidden bg-card">
            {/* Manual fields (only if needed) */}
            {manualPlaceholders.length > 0 && (
              <div className="p-4 space-y-3 border-b border-border bg-muted/20">
                {manualPlaceholders.map(key => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {labelForPlaceholder(key)}
                    </label>
                    {RUPIAH_KEYS.has(key) ? (
                      <div className="space-y-1">
                        <Input
                          placeholder="Contoh: 5000000"
                          value={manualFields[key] || ''}
                          onChange={e => handleRupiahInput(key, e.target.value)}
                          inputMode="numeric"
                          className="h-9 text-sm"
                        />
                        {manualFields[key] && (
                          <p className="text-xs text-primary font-medium pl-1">{toRupiah(manualFields[key])}</p>
                        )}
                      </div>
                    ) : (
                      <textarea
                        className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                        placeholder={`Isi ${labelForPlaceholder(key)}...`}
                        value={manualFields[key] || ''}
                        onChange={e => setField(key, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

             {/* Message preview */}
             <div className="p-4 space-y-3">
               <div className="flex items-start justify-between gap-3">
                 <div>
                   <p className="text-sm font-semibold text-foreground">Isi Konfirmasi Tindakan Medis</p>
                   <p className="mt-0.5 text-xs text-muted-foreground">
                     Periksa kembali isi pesan sebelum dikirim ke penjamin.
                   </p>
                 </div>
                 <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                   {message.length.toLocaleString('id-ID')} karakter
                 </span>
               </div>
              <textarea
                 aria-label="Isi Konfirmasi Tindakan Medis"
                 className="w-full min-h-[210px] rounded-md border border-input bg-background px-4 py-3 text-sm font-sans leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                value={message}
                onChange={e => setMessage(e.target.value)}
                 placeholder="Pesan konfirmasi akan muncul di sini..."
              />

              {/* Action buttons */}
              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={copyMessage}
                  disabled={!message}
                  variant="outline"
                  size="sm"
                  className="flex-1 min-w-[8rem] gap-1.5 text-xs"
                >
                  <Copy className="w-3.5 h-3.5" /> Salin
                </Button>
                <Button
                  onClick={openMessageQr}
                  disabled={!message || !allFieldsFilled || !selectedPatient.noHpPJ || qrLoading}
                  variant="outline"
                  size="sm"
                  className="flex-1 min-w-[8rem] gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10"
                  title={!selectedPatient.noHpPJ ? 'Isi No HP Penanggung Jawab terlebih dahulu' : !allFieldsFilled ? 'Lengkapi data pesan terlebih dahulu' : 'Buat QR untuk dipindai HP petugas'}
                >
                  <QrCode className="w-3.5 h-3.5" /> {qrLoading ? 'Membuat QR...' : 'Tampilkan QR'}
                </Button>
                <Button
                  onClick={openWhatsApp}
                  disabled={!message || !allFieldsFilled}
                  size="sm"
                  className="flex-1 min-w-[8rem] gap-1.5 text-xs bg-[#25D366] hover:bg-[#1fbc59] text-white border-0 shadow-sm"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  {selectedPatient.noHpPJ ? 'Kirim WhatsApp' : 'No HP belum diisi'}
                </Button>
                {section === 'ktm' && selectedTemplate.kategori === 'Kirim KTM' && (
                  <Button
                    onClick={openInsuranceEmail}
                    disabled={!message || !allFieldsFilled || !selectedPatient.emailAsuransi || !selectedPatient.noKartuAsuransi}
                    size="sm"
                    variant="outline"
                    className="flex-1 min-w-[8rem] gap-1.5 text-xs border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
                    title={
                      !selectedPatient.emailAsuransi
                        ? 'Isi email asuransi terlebih dahulu'
                        : !selectedPatient.noKartuAsuransi
                          ? 'Isi no kartu asuransi terlebih dahulu'
                          : 'Buka aplikasi email dengan penerima, subjek, dan pesan KTM'
                    }
                  >
                    <Mail className="w-3.5 h-3.5" /> Kirim KTM
                  </Button>
                )}
              </div>

              {!selectedPatient.noHpPJ && (
                <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                  Tambahkan No HP Penanggung Jawab di kartu pasien di atas agar bisa membuat QR atau kirim WhatsApp langsung.
                </p>
              )}
              {section === 'ktm' && (!selectedPatient.emailAsuransi || !selectedPatient.noKartuAsuransi) && (
                <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                  Isi email asuransi dan No. Kartu Asuransi pada data pasien untuk mengaktifkan Kirim KTM.
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                QR akan membuka chat WhatsApp keluarga di HP petugas dengan pesan ini sudah terisi. Petugas tetap menekan tombol Kirim di WhatsApp.
              </p>
            </div>
          </div>
        </div>
      )}
      <Dialog open={Boolean(qrPayload)} onOpenChange={open => { if (!open) setQrPayload(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-primary" />
              QR WhatsApp Pesan Kasir
            </DialogTitle>
          </DialogHeader>
          {qrPayload && (
            <div className="space-y-4">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                <p className="font-semibold text-foreground">{qrPayload.patient.namaPasien}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  No. HP keluarga: <span className="font-medium text-foreground">{qrPayload.phone}</span>
                </p>
              </div>
              <div className="flex justify-center rounded-xl border bg-white p-4">
                <img
                  src={qrPayload.dataUrl}
                  alt={`QR WhatsApp untuk keluarga pasien ${qrPayload.patient.namaPasien}`}
                  className="h-72 w-72 max-w-full"
                />
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <strong>Cara menggunakan:</strong> buka pemindai QR di HP petugas, arahkan ke kode ini, lalu periksa pesan dan tekan <strong>Kirim</strong> di WhatsApp.
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Isi pesan</p>
                <p className="max-h-36 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
                  {qrPayload.message}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Page component ────────────────────────────────────────────────────────────
export default function KasirPage({ section = 'pesan' }: { section?: KasirSection }) {
  const [location, setLocation] = useLocation();
  const activeSection: KasirSection = location === '/kasir/ktm'
    ? 'ktm'
    : location === '/kasir/notifikasi-billing'
      ? 'notifikasi'
      : section;
  const title = activeSection === 'ktm'
    ? 'Konfirmasi Tindakan Medis'
    : activeSection === 'notifikasi'
      ? 'Notifikasi Billing Sementara'
      : 'Pesan Kasir';
  const description = activeSection === 'ktm'
    ? 'Siapkan dan kirim permintaan konfirmasi tindakan medis ke penjamin pasien.'
    : activeSection === 'notifikasi'
      ? 'Kelola notifikasi billing sementara untuk pasien rawat inap.'
      : 'Generate pesan konfirmasi WhatsApp untuk penanggung jawab pasien.';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-1">{description}</p>
      </div>

      <div className="flex flex-wrap gap-1 bg-muted p-1 rounded-xl w-fit">
        {([
          { key: 'pesan', label: 'Pesan Kasir', icon: MessageCircle, path: '/kasir' },
          { key: 'notifikasi', label: 'Notifikasi Billing Sementara', icon: BellRing, path: '/kasir/notifikasi-billing' },
          { key: 'ktm', label: 'Kirim KTM', icon: Mail, path: '/kasir/ktm' },
        ] as const).map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setLocation(tab.path)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeSection === tab.key
                  ? 'bg-background shadow text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeSection === 'notifikasi'
        ? <NotifikasiBillingTab />
        : <PesanKasirTab section={activeSection === 'ktm' ? 'ktm' : 'pesan'} />}
    </div>
  );
}
