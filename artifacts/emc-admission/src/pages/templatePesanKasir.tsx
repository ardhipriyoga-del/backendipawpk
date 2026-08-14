import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getDB, KasirTemplate } from '../lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, Eye, EyeOff, ArrowUp, ArrowDown,
  Info, FileText, ToggleLeft, ToggleRight, Copy, CheckCircle2, RefreshCw,
  Save, Cloud, FileSpreadsheet, Loader2,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { triggerAutoBackup } from '../lib/cloudSync';
import { backupData } from '../lib/backup';

// ── Placeholder catalog ───────────────────────────────────────────────────────
const PLACEHOLDER_LIST = [
  { key: '{{nama_pasien}}', label: 'Nama Pasien', auto: true },
  { key: '{{no_rm}}', label: 'No. Rekam Medis', auto: true },
  { key: '{{episode}}', label: 'No. Episode', auto: true },
  { key: '{{ruangan}}', label: 'Ruangan / Bed', auto: true },
  { key: '{{kelas}}', label: 'Kelas Rawat', auto: true },
  { key: '{{dokter}}', label: 'DPJP', auto: true },
  { key: '{{penjamin}}', label: 'Penjamin / Payor', auto: true },
  { key: '{{tanggal_lahir}}', label: 'Tanggal Lahir Pasien', auto: true },
  { key: '{{email_asuransi}}', label: 'Email Asuransi', auto: true },
  { key: '{{no_kartu_asuransi}}', label: 'No. Kartu Asuransi', auto: true },
  { key: '{{diagnosa}}', label: 'Diagnosa Pasien', auto: true },
  { key: '{{salam}}', label: 'Salam (Pagi/Siang/Sore/Malam)', auto: true },
  { key: '{{tanggal}}', label: 'Tanggal Hari Ini', auto: true },
  { key: '{{jam}}', label: 'Jam Saat Ini', auto: true },
  { key: '{{nama_petugas}}', label: 'Nama Petugas (Login)', auto: true },
  { key: '{{no_hp_penanggung_jawab}}', label: 'No HP Penanggung Jawab', auto: true },
  { key: '{{hari_rawat}}', label: 'Hari Rawat (Notifikasi Billing)', auto: true },
  { key: '{{estimasi_billing}}', label: 'Estimasi Billing Sementara (Notifikasi Billing)', auto: true },
  { key: '{{tanggal_masuk}}', label: 'Tanggal Masuk Pasien (Notifikasi Billing)', auto: true },
  { key: '{{permintaan}}', label: 'Permintaan (input manual)', auto: false },
  { key: '{{nama_penanggung_jawab}}', label: 'Nama Penanggung Jawab', auto: false },
  { key: '{{billing}}', label: 'Billing (Rp - input manual)', auto: false },
  { key: '{{deposit}}', label: 'Deposit (Rp - input manual)', auto: false },
  { key: '{{sisa_deposit}}', label: 'Sisa Deposit (Rp - input manual)', auto: false },
  { key: '{{kekurangan}}', label: 'Kekurangan Bayar (Rp - input manual)', auto: false },
];

export const BILLING_TEMPLATE_CATEGORY = 'Notifikasi Billing';
export const BILLING_TEMPLATE_NAME = 'Notifikasi Billing Sementara';
export const DEFAULT_BILLING_TEMPLATE_BODY = `Selamat {{salam}}.

Salam Sehat.

Yth. Bapak/Ibu Keluarga Pasien,

Kami ingin menyampaikan informasi mengenai estimasi sementara biaya perawatan pasien sebagai berikut:

Nama Pasien : {{nama_pasien}}
No. Rekam Medis : {{no_rm}}
Penjamin : {{penjamin}}
Hari Perawatan : Hari ke-{{hari_rawat}}

Berdasarkan perhitungan hingga saat ini, estimasi total biaya perawatan sementara adalah sebesar {{estimasi_billing}}.

Perlu kami sampaikan bahwa nominal tersebut masih bersifat estimasi dan dapat mengalami perubahan sesuai dengan perkembangan kondisi pasien, tindakan medis, pemeriksaan penunjang, pemberian obat, penggunaan alat kesehatan, maupun pelayanan lainnya selama masa perawatan.

Apabila Bapak/Ibu memerlukan informasi lebih lanjut mengenai rincian biaya perawatan, silakan menghubungi Bagian Kasir Rawat Inap RS EMC Pekayon.

Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.

Hormat kami,

Kasir Rawat Inap
RS EMC Pekayon`;

// ── Default templates (seeded on first use) ───────────────────────────────────
export const DEFAULT_KASIR_TEMPLATES: Omit<KasirTemplate, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    namaTemplate: 'Konfirmasi Obat — Pribadi',
    kategori: 'Konfirmasi Obat',
    isiTemplate: `Selamat {{salam}}
Salam Sehat.

Kami dari bagian kasir rawat inap RS EMC Pekayon.
Konfirmasi untuk pasien *{{nama_pasien}}* dari dokter diresepkan obat :

{{daftar_obat}}

Apakah dari pihak keluarga bersedia untuk acc pribadi dilakukan/diberikan?

Terimakasih.`,
    aktif: true,
    urutan: 1,
  },
  {
    namaTemplate: 'Konfirmasi Pemeriksaan — Pribadi',
    kategori: 'Konfirmasi Pemeriksaan',
    isiTemplate: `Selamat {{salam}}
Salam Sehat.

Kami dari bagian kasir rawat inap RS EMC Pekayon.
Konfirmasi untuk pasien *{{nama_pasien}}* dari dokter disarankan pemeriksaan :

{{daftar_periksa}}

Apakah dari pihak keluarga bersedia untuk acc pribadi untuk dilakukan?

Terimakasih.`,
    aktif: true,
    urutan: 2,
  },
  {
    namaTemplate: 'Konfirmasi Obat & Pemeriksaan — Pribadi',
    kategori: 'Konfirmasi Obat & Pemeriksaan',
    isiTemplate: `Selamat {{salam}}
Salam Sehat.

Kami dari bagian kasir rawat inap RS EMC Pekayon.
Konfirmasi untuk pasien *{{nama_pasien}}* dari dokter disarankan pemeriksaan dan diresepkan obat :

{{daftar_obat_periksa}}

Apakah dari pihak keluarga bersedia untuk acc pribadi untuk dilakukan/diberikan?

Terimakasih.`,
    aktif: true,
    urutan: 3,
  },
  {
    namaTemplate: 'Konfirmasi Obat — Asuransi Tidak Dijamin',
    kategori: 'Konfirmasi Obat',
    isiTemplate: `Selamat {{salam}}
Salam Sehat.

Kami dari bagian kasir rawat inap RS EMC Pekayon.
Konfirmasi untuk pasien *{{nama_pasien}}* dari dokter diresepkan obat :

{{daftar_obat}}

Karena dari asuransi, obat tersebut tidak dijaminkan.

Apakah dari pihak keluarga bersedia untuk acc pribadi untuk diberikan?

Terimakasih.`,
    aktif: true,
    urutan: 4,
  },
  {
    namaTemplate: 'Konfirmasi Obat — Asuransi Overlimit',
    kategori: 'Konfirmasi Obat',
    isiTemplate: `Selamat {{salam}}
Salam Sehat.

Kami dari bagian kasir rawat inap RS EMC Pekayon.
Konfirmasi untuk pasien *{{nama_pasien}}* dari dokter diresepkan obat :

{{daftar_obat}}

Dikarenakan manfaat asuransi peserta telah mencapai batas limit yang ditentukan, tindakan/obat tersebut kemungkinan masih dapat diproses melalui asuransi, namun berpotensi menimbulkan selisih/ekses yang perlu dibayarkan secara pribadi oleh peserta.

Apakah dari pihak keluarga bersedia untuk acc pribadi untuk diberikan?

Terimakasih.`,
    aktif: true,
    urutan: 5,
  },
  {
    namaTemplate: 'Konfirmasi Pemeriksaan — Asuransi Tidak Dijamin',
    kategori: 'Konfirmasi Pemeriksaan',
    isiTemplate: `Selamat {{salam}}
Salam Sehat.

Kami dari bagian kasir rawat inap RS EMC Pekayon.
Konfirmasi untuk pasien *{{nama_pasien}}* dari dokter disarankan untuk pemeriksaan :

{{daftar_periksa}}

Karena dari asuransi, tindakan/pemeriksaan tersebut tidak dijaminkan.

Apakah dari pihak keluarga bersedia untuk acc pribadi untuk dilakukan?

Terimakasih.`,
    aktif: true,
    urutan: 6,
  },
  {
    namaTemplate: 'Selisih Jaminan Akhir Asuransi',
    kategori: 'Selisih Jaminan',
    isiTemplate: `Selamat {{salam}}
Salam Sehat.

Kami dari bagian kasir rawat inap RS EMC Pekayon.
Menginfokan terkait jaminan akhir asuransi pasien *{{nama_pasien}}* telah terbit.
Biaya yang kami ajukan ke asuransi adalah {{billing}} dan yang dijaminkan asuransi {{deposit}}.
Terdapat selisih {{kekurangan}} yang harus dibayarkan oleh peserta. Rincian/jaminan akhir kami lampirkan.

Pembayarannya dapat melalui transfer ke no rekening:
BCA 6042 87 9998
BNI 0717 40 1635
a/n PT Kurnia Sejahtera Utama

Terimakasih.`,
    aktif: true,
    urutan: 7,
  },
  {
    namaTemplate: BILLING_TEMPLATE_NAME,
    kategori: BILLING_TEMPLATE_CATEGORY,
    isiTemplate: DEFAULT_BILLING_TEMPLATE_BODY,
    aktif: true,
    urutan: 8,
  },
  {
    namaTemplate: 'Kirim KTM — Konfirmasi Tindakan Medis',
    kategori: 'Kirim KTM',
    isiTemplate: `Yth. Tim Penjamin,

Berikut kami sampaikan permintaan konfirmasi tindakan medis pasien:

Nama Pasien       : {{nama_pasien}}
Tanggal Lahir     : {{tanggal_lahir}}
Penjamin          : {{penjamin}}
No. Kartu Asuransi: {{no_kartu_asuransi}}

Permintaan Tindakan:
{{permintaan}}

Mohon diproses untuk penerbitan penjaminan tindakan medis.

Terima kasih atas bantuan dan kerja samanya.

Hormat kami,
{{nama_petugas}}
Kasir Rawat Inap RS EMC Pekayon`,
    aktif: true,
    urutan: 9,
  },
];

// Seed default templates only when the master is genuinely new.
//
// Important: do not recreate individual defaults when they are deleted.
// A missing default can be an intentional user choice, and automatically
// adding it back on every page load makes the Delete action appear broken.
export async function ensureDefaultKasirTemplates() {
  const db = await getDB();
  const existing = await db.getAll('kasirTemplates');
  const initializedKey = 'kasirTemplatesInitialized';
  const initialized = await db.get('settings', initializedKey);
  const ktmInitializedKey = 'kasirKtmTemplateInitialized';
  const ktmInitialized = await db.get('settings', ktmInitializedKey);
  const defaultKtm = DEFAULT_KASIR_TEMPLATES.find(template => template.kategori === 'Kirim KTM');

  // Add the KTM default once for existing installations as an additive migration.
  // The separate marker prevents a later intentional deletion from being undone.
  if (initialized && !ktmInitialized && defaultKtm && !existing.some(template => template.kategori === 'Kirim KTM')) {
    const now = Date.now();
    await db.add('kasirTemplates', { ...defaultKtm, createdAt: now, updatedAt: now });
    await db.put('settings', { key: ktmInitializedKey, value: true });
    return;
  }
  if (initialized) return;
  if (existing.length > 0) {
    // Existing installations predate this marker. Preserve their current
    // collection, but add the new KTM default as an additive migration.
    if (defaultKtm && !existing.some(template => template.kategori === 'Kirim KTM')) {
      const now = Date.now();
      await db.add('kasirTemplates', { ...defaultKtm, createdAt: now, updatedAt: now });
    }
    await db.put('settings', { key: initializedKey, value: true });
    await db.put('settings', { key: ktmInitializedKey, value: true });
    return;
  }

  const now = Date.now();
  for (const tpl of DEFAULT_KASIR_TEMPLATES) {
    await db.add('kasirTemplates', { ...tpl, createdAt: now, updatedAt: now });
  }
  await db.put('settings', { key: initializedKey, value: true });
  await db.put('settings', { key: ktmInitializedKey, value: true });
}

// ── Highlight placeholders in preview text ────────────────────────────────────
function HighlightedTemplate({ text }: { text: string }) {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return (
    <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">
      {parts.map((part, i) =>
        /^\{\{[^}]+\}\}$/.test(part) ? (
          <span key={i} className="bg-primary/15 text-primary font-medium rounded px-0.5">{part}</span>
        ) : part
      )}
    </pre>
  );
}

// ── Template Form Dialog ──────────────────────────────────────────────────────
interface FormState {
  namaTemplate: string;
  kategori: string;
  isiTemplate: string;
  aktif: boolean;
  urutan: number;
}

const EMPTY_FORM: FormState = {
  namaTemplate: '',
  kategori: '',
  isiTemplate: '',
  aktif: true,
  urutan: 99,
};

function TemplateFormDialog({
  open,
  onClose,
  initial,
  maxUrutan,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initial?: KasirTemplate | null;
  maxUrutan: number;
  onSave: (f: FormState, id?: number) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setForm(
        initial
          ? {
              namaTemplate: initial.namaTemplate,
              kategori: initial.kategori,
              isiTemplate: initial.isiTemplate,
              aktif: initial.aktif,
              urutan: initial.urutan,
            }
          : { ...EMPTY_FORM, urutan: maxUrutan + 1 }
      );
      setPreview(false);
    }
  }, [open, initial, maxUrutan]);

  const insertPlaceholder = (key: string) => {
    const el = textareaRef.current;
    if (!el) {
      setForm(f => ({ ...f, isiTemplate: f.isiTemplate + key }));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const newVal = el.value.slice(0, start) + key + el.value.slice(end);
    setForm(f => ({ ...f, isiTemplate: newVal }));
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + key.length, start + key.length);
    }, 0);
  };

  const handleSave = async () => {
    if (!form.namaTemplate.trim()) { toast.error('Nama template wajib diisi.'); return; }
    if (!form.isiTemplate.trim()) { toast.error('Isi template wajib diisi.'); return; }
    setSaving(true);
    try {
      await onSave(form, initial?.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Template' : 'Tambah Template Baru'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Nama + Kategori */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nama Template <span className="text-destructive">*</span></label>
              <Input
                value={form.namaTemplate}
                onChange={e => setForm(f => ({ ...f, namaTemplate: e.target.value }))}
                placeholder="Contoh: Konfirmasi Obat Pribadi"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Kategori <span className="text-destructive">*</span></label>
              <Input
                value={form.kategori}
                onChange={e => setForm(f => ({ ...f, kategori: e.target.value }))}
                placeholder="Contoh: Konfirmasi Obat"
                list="kategori-list"
              />
            </div>
          </div>

          {/* Urutan + Aktif */}
          <div className="flex items-center gap-4">
            <div className="space-y-1.5 w-32">
              <label className="text-sm font-medium">Urutan</label>
              <Input
                type="number"
                min={1}
                value={form.urutan}
                onChange={e => setForm(f => ({ ...f, urutan: parseInt(e.target.value) || 1 }))}
              />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, aktif: !f.aktif }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.aktif ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.aktif ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <span className="text-sm font-medium">{form.aktif ? 'Aktif' : 'Nonaktif'}</span>
            </div>
          </div>

          {/* Placeholder chips */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Placeholder — klik untuk sisipkan ke isi template:</p>
            <div className="flex flex-wrap gap-1.5 p-3 bg-muted/50 rounded-lg border">
              {PLACEHOLDER_LIST.map(ph => (
                <button
                  key={ph.key}
                  type="button"
                  onClick={() => insertPlaceholder(ph.key)}
                  title={ph.label}
                  className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors hover:bg-primary hover:text-primary-foreground ${
                    ph.auto
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-400'
                      : 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400'
                  }`}
                >
                  {ph.key}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground flex gap-4">
              <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />Otomatis diisi dari data pasien/sistem</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1" />Perlu input manual saat menggunakan template</span>
            </p>
          </div>

          {/* Isi Template */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Isi Template <span className="text-destructive">*</span></label>
              <button
                type="button"
                onClick={() => setPreview(v => !v)}
                className="text-xs flex items-center gap-1 text-primary hover:underline"
              >
                {preview ? <><EyeOff className="w-3 h-3" /> Tutup Preview</> : <><Eye className="w-3 h-3" /> Preview</>}
              </button>
            </div>
            {preview ? (
              <div className="rounded-md border bg-muted/30 p-4 min-h-[160px]">
                <HighlightedTemplate text={form.isiTemplate || '(isi template kosong)'} />
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                className="w-full min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                placeholder="Tulis isi template di sini. Gunakan {{placeholder}} untuk data dinamis."
                value={form.isiTemplate}
                onChange={e => setForm(f => ({ ...f, isiTemplate: e.target.value }))}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Menyimpan...' : initial ? 'Simpan Perubahan' : 'Tambah Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TemplatePesanKasirContent() {
  const { user } = useAuth();
  const isSuperuser = user?.role === 'superuser';

  const [templates, setTemplates] = useState<KasirTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [backingUpExcel, setBackingUpExcel] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<KasirTemplate | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<KasirTemplate | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDB();
      const all = await db.getAll('kasirTemplates');
      setTemplates(all.sort((a, b) => a.urutan - b.urutan));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    ensureDefaultKasirTemplates().then(load);
  }, [load]);

  const maxUrutan = templates.length > 0 ? Math.max(...templates.map(t => t.urutan)) : 0;

  const handleSaveAll = async () => {
    if (!isSuperuser || savingAll || templates.length === 0) return;
    const invalid = templates.find(t => !t.namaTemplate.trim() || !t.isiTemplate.trim());
    if (invalid) {
      toast.error('Nama dan isi setiap template wajib diisi sebelum disimpan.');
      return;
    }

    setSavingAll(true);
    try {
      const db = await getDB();
      const now = Date.now();
      const tx = db.transaction('kasirTemplates', 'readwrite');
      for (const template of templates) {
        await tx.store.put({
          ...template,
          namaTemplate: template.namaTemplate.trim(),
          kategori: template.kategori.trim(),
          isiTemplate: template.isiTemplate,
          updatedAt: now,
        });
      }
      await tx.done;

      const backupStatus = await triggerAutoBackup();
      await load();
      toast.success(
        backupStatus === 'synced'
          ? 'Seluruh template tersimpan dan sudah dicadangkan ke Cloud.'
          : 'Seluruh template tersimpan di perangkat. Backup Cloud akan dilanjutkan saat koneksi tersedia.',
      );
    } catch (error: any) {
      toast.error(`Gagal menyimpan seluruh template: ${error?.message ?? 'Unknown error'}`);
    } finally {
      setSavingAll(false);
    }
  };

  const handleBackupExcel = async () => {
    if (backingUpExcel) return;
    setBackingUpExcel(true);
    try {
      await backupData();
      toast.success('Backup Excel lengkap berhasil didownload, termasuk seluruh Template Pesan Kasir.');
    } catch (error: any) {
      toast.error(`Gagal membuat backup Excel: ${error?.message ?? 'Unknown error'}`);
    } finally {
      setBackingUpExcel(false);
    }
  };

  const handleSave = async (form: FormState, id?: number) => {
    const db = await getDB();
    const now = Date.now();
    if (id != null) {
      const existing = await db.get('kasirTemplates', id);
      if (existing) {
        await db.put('kasirTemplates', { ...existing, ...form, updatedAt: now });
        await triggerAutoBackup();
        toast.success('Template berhasil diperbarui.');
      }
    } else {
      await db.add('kasirTemplates', { ...form, createdAt: now, updatedAt: now });
      await triggerAutoBackup();
      toast.success('Template berhasil ditambahkan.');
    }
    await load();
  };

  const toggleAktif = async (tpl: KasirTemplate) => {
    if (!isSuperuser) return;
    const db = await getDB();
    await db.put('kasirTemplates', { ...tpl, aktif: !tpl.aktif, updatedAt: Date.now() });
    await triggerAutoBackup();
    toast.success(`Template ${!tpl.aktif ? 'diaktifkan' : 'dinonaktifkan'}.`);
    await load();
  };

  const handleDelete = async () => {
    if (!deleteConfirm?.id) return;
    const db = await getDB();
    await db.delete('kasirTemplates', deleteConfirm.id);
    await triggerAutoBackup();
    toast.success('Template dihapus.');
    setDeleteConfirm(null);
    await load();
  };

  const moveUrutan = async (tpl: KasirTemplate, dir: 'up' | 'down') => {
    const sorted = [...templates].sort((a, b) => a.urutan - b.urutan);
    const idx = sorted.findIndex(t => t.id === tpl.id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const db = await getDB();
    const now = Date.now();
    const a = sorted[idx];
    const b = sorted[swapIdx];
    await db.put('kasirTemplates', { ...a, urutan: b.urutan, updatedAt: now });
    await db.put('kasirTemplates', { ...b, urutan: a.urutan, updatedAt: now });
    await triggerAutoBackup();
    await load();
  };

  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      const db = await getDB();
      const now = Date.now();
      for (const tpl of DEFAULT_KASIR_TEMPLATES) {
        await db.add('kasirTemplates', { ...tpl, createdAt: now, updatedAt: now });
      }
      await triggerAutoBackup();
      toast.success('Template default berhasil dimuat.');
      await load();
    } catch {
      toast.error('Gagal memuat template default.');
    } finally {
      setSeeding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        Memuat template...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Template Pesan Kasir</h2>
          <p className="text-sm text-muted-foreground">
            {isSuperuser
              ? 'Kelola template pesan WhatsApp kasir. Placeholder otomatis diganti saat digunakan.'
              : 'Template aktif yang tersedia untuk digunakan di halaman Pesan Kasir.'}
          </p>
        </div>
        {isSuperuser && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveAll}
              disabled={savingAll || templates.length === 0}
              className="gap-2"
            >
              {savingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {savingAll ? 'Menyimpan...' : 'Simpan Semua Template'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackupExcel}
              disabled={backingUpExcel}
              className="gap-2"
            >
              {backingUpExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              {backingUpExcel ? 'Menyiapkan...' : 'Backup Excel Lengkap'}
            </Button>
            {templates.length === 0 && (
              <Button variant="outline" size="sm" onClick={handleSeedDefaults} disabled={seeding} className="gap-2">
                <RefreshCw className={`w-4 h-4 ${seeding ? 'animate-spin' : ''}`} />
                Load Default
              </Button>
            )}
            <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }} className="gap-2">
              <Plus className="w-4 h-4" /> Tambah Template
            </Button>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-700 dark:text-blue-300">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="space-y-0.5">
          <p><strong>Placeholder otomatis:</strong> {'{{'+'nama_pasien}}'}, {'{{'+'no_rm}}'}, {'{{'+'ruangan}}'}, {'{{'+'kelas}}'}, {'{{'+'dokter}}'}, {'{{'+'penjamin}}'}, {'{{'+'diagnosa}}'}, {'{{'+'salam}}'}, {'{{'+'tanggal}}'}, {'{{'+'jam}}'}, {'{{'+'nama_petugas}}'}, {'{{'+'no_hp_penanggung_jawab}}'}</p>
          <p><strong>Input manual:</strong> {'{{'+'nama_penanggung_jawab}}'}, {'{{'+'billing}}'}, {'{{'+'deposit}}'}, {'{{'+'sisa_deposit}}'}, {'{{'+'kekurangan}}'}, atau placeholder kustom lainnya</p>
        </div>
      </div>

      {isSuperuser && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
          <Cloud className="h-4 w-4 shrink-0" />
          <span>
            Tombol Simpan Semua Template menyimpan seluruh daftar ke perangkat dan mencadangkannya ke Cloud.
            Backup Excel Lengkap juga menyertakan semua template ini.
          </span>
        </div>
      )}

      {/* Empty state */}
      {templates.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <FileText className="w-10 h-10 mx-auto text-muted-foreground" />
            <p className="font-medium text-muted-foreground">Belum ada template</p>
            {isSuperuser ? (
              <p className="text-sm text-muted-foreground">
                Tambah template baru atau muat template default untuk memulai.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Hubungi Superuser untuk menambahkan template.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Template list */}
      <div className="space-y-2">
        {templates.map((tpl, idx) => {
          const isPreviewOpen = previewId === tpl.id;
          return (
            <Card key={tpl.id} className={`transition-opacity ${tpl.aktif ? '' : 'opacity-60'}`}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start gap-3">
                  {/* Urutan + reorder */}
                  {isSuperuser && (
                    <div className="flex flex-col items-center gap-0.5 shrink-0 pt-0.5">
                      <button
                        onClick={() => moveUrutan(tpl, 'up')}
                        disabled={idx === 0}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs font-mono text-muted-foreground w-5 text-center">{tpl.urutan}</span>
                      <button
                        onClick={() => moveUrutan(tpl, 'down')}
                        disabled={idx === templates.length - 1}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{tpl.namaTemplate}</span>
                      {tpl.kategori && (
                        <Badge variant="outline" className="text-xs">{tpl.kategori}</Badge>
                      )}
                      <Badge
                        variant={tpl.aktif ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {tpl.aktif ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {tpl.isiTemplate.slice(0, 120)}{tpl.isiTemplate.length > 120 ? '…' : ''}
                    </p>

                    {/* Preview */}
                    {isPreviewOpen && (
                      <div className="mt-3 p-3 bg-muted/40 rounded-lg border">
                        <HighlightedTemplate text={tpl.isiTemplate} />
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setPreviewId(isPreviewOpen ? null : (tpl.id ?? null))}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title="Preview"
                    >
                      {isPreviewOpen ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>

                    {isSuperuser && (
                      <>
                        <button
                          onClick={() => toggleAktif(tpl)}
                          className={`p-1.5 rounded hover:bg-muted ${tpl.aktif ? 'text-emerald-600' : 'text-muted-foreground'}`}
                          title={tpl.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                        >
                          {tpl.aktif ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => { setEditing(tpl); setDialogOpen(true); }}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(tpl)}
                          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          title="Hapus"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Form dialog */}
      <TemplateFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        initial={editing}
        maxUrutan={maxUrutan}
        onSave={handleSave}
      />

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={v => !v && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus Template?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Template <strong>"{deleteConfirm?.namaTemplate}"</strong> akan dihapus permanen dan tidak bisa dikembalikan.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Batal</Button>
            <Button variant="destructive" onClick={handleDelete}>Hapus</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
