import { useEffect, useRef, useState } from 'react';
import { getDB, MasterEstimasiKategori, MasterEstimasiMapping } from '@/lib/db';
import {
  ESTIMASI_KELAS_LABELS,
  componentKey,
  importEstimasiMasters,
  loadEstimasiMasterData,
} from '@/lib/estimasiTindakanMaster';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';

const MASTER_ESTIMASI_CHANGED = 'ipaw:master-estimasi-changed';
export const dispatchMasterEstimasiChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MASTER_ESTIMASI_CHANGED));
};

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function MasterEstimasiTindakanPanel({ importedBy = 'Superuser' }: { importedBy?: string }) {
  const [actionsCount, setActionsCount] = useState(0);
  const [tariffs, setTariffs] = useState<Awaited<ReturnType<typeof loadEstimasiMasterData>>['tariffs']>([]);
  const [categories, setCategories] = useState<MasterEstimasiKategori[]>([]);
  const [mappings, setMappings] = useState<MasterEstimasiMapping[]>([]);
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof loadEstimasiMasterData>>['meta']>(undefined);
  const [actionFile, setActionFile] = useState<File | null>(null);
  const [tariffFile, setTariffFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  async function load() {
    const data = await loadEstimasiMasterData();
    setActionsCount(data.actions.length);
    setTariffs(data.tariffs);
    setCategories(data.categories);
    setMappings(data.mappings);
    setMeta(data.meta);
  }

  useEffect(() => {
    void load();
  }, []);

  const handleImport = async () => {
    if (!actionFile || !tariffFile) {
      toast.error('Upload kedua file Excel terlebih dahulu.');
      return;
    }
    setImporting(true);
    try {
      const result = await importEstimasiMasters(
        actionFile,
        tariffFile,
        importedBy,
      );
      toast.success(result.changed
        ? `Master diperbarui: ${result.actions} tindakan dan ${result.tariffs} tarif.`
        : 'Isi kedua master tidak berubah. Data lokal tidak ditulis ulang.');
      await load();
      dispatchMasterEstimasiChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import master gagal.');
    } finally {
      setImporting(false);
    }
  };

  const saveCategory = async () => {
    const nama = newCategory.trim();
    if (!nama) {
      toast.error('Nama kategori wajib diisi.');
      return;
    }
    const db = await getDB();
    const now = Date.now();
    await db.put('masterEstimasiKategori', {
      id: editingId || id('mek'),
      nama,
      urutan: editingId
        ? categories.find(item => item.id === editingId)?.urutan ?? categories.length + 1
        : categories.length + 1,
      aktif: editingId ? categories.find(item => item.id === editingId)?.aktif ?? true : true,
      createdAt: editingId ? categories.find(item => item.id === editingId)?.createdAt ?? now : now,
      updatedAt: now,
    });
    setNewCategory('');
    setEditingId(null);
    setEditingName('');
    await load();
    dispatchMasterEstimasiChanged();
  };

  const editCategory = (category: MasterEstimasiKategori) => {
    setEditingId(category.id);
    setEditingName(category.nama);
    setNewCategory(category.nama);
  };

  const deleteCategory = async (category: MasterEstimasiKategori) => {
    if (!confirm(`Hapus kategori "${category.nama}"? Mapping komponen ke kategori ini juga akan dihapus.`)) return;
    const db = await getDB();
    const tx = db.transaction(['masterEstimasiKategori', 'masterEstimasiMappings'], 'readwrite');
    await tx.objectStore('masterEstimasiKategori').delete(category.id);
    const linked = mappings.filter(item => item.kategoriId === category.id);
    for (const mapping of linked) await tx.objectStore('masterEstimasiMappings').delete(mapping.id);
    await tx.done;
    await load();
    dispatchMasterEstimasiChanged();
  };

  const toggleCategory = async (category: MasterEstimasiKategori) => {
    const db = await getDB();
    await db.put('masterEstimasiKategori', { ...category, aktif: !category.aktif, updatedAt: Date.now() });
    await load();
    dispatchMasterEstimasiChanged();
  };

  const moveCategory = async (category: MasterEstimasiKategori, direction: -1 | 1) => {
    const ordered = [...categories].sort((a, b) => a.urutan - b.urutan);
    const index = ordered.findIndex(item => item.id === category.id);
    const other = ordered[index + direction];
    if (!other) return;
    const db = await getDB();
    const tx = db.transaction('masterEstimasiKategori', 'readwrite');
    await tx.store.put({ ...category, urutan: other.urutan, updatedAt: Date.now() });
    await tx.store.put({ ...other, urutan: category.urutan, updatedAt: Date.now() });
    await tx.done;
    await load();
    dispatchMasterEstimasiChanged();
  };

  const saveMapping = async (component: string, kategoriId: string) => {
    const db = await getDB();
    const existing = mappings.find(item => item.komponenKey === componentKey(component));
    if (!kategoriId) {
      if (existing) await db.delete('masterEstimasiMappings', existing.id);
    } else {
      await db.put('masterEstimasiMappings', {
        id: existing?.id || id('mem'),
        komponenKey: componentKey(component),
        komponen: existing?.komponen || component,
        kategoriId,
        updatedAt: Date.now(),
      });
    }
    await load();
    dispatchMasterEstimasiChanged();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Master Estimasi Biaya Tindakan
          </CardTitle>
          <CardDescription>
            Upload Master Penggolongan dan Master Tarif Bedah Mata. Data disimpan di perangkat dan hanya ditulis ulang bila isinya berubah.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="rounded-lg border border-dashed p-4 space-y-2">
              <span className="text-sm font-semibold">Master Penggolongan Tindakan</span>
              <span className="block text-xs text-muted-foreground">Kolom: Golongan, Tindakan</span>
              <Input type="file" accept=".xlsx,.xls" onChange={event => setActionFile(event.target.files?.[0] || null)} />
              {actionFile && <Badge variant="outline">{actionFile.name}</Badge>}
            </label>
            <label className="rounded-lg border border-dashed p-4 space-y-2">
              <span className="text-sm font-semibold">Master Tarif Tindakan</span>
              <span className="block text-xs text-muted-foreground">Golongan, Komponen, KLS III–SUITE</span>
              <Input type="file" accept=".xlsx,.xls" onChange={event => setTariffFile(event.target.files?.[0] || null)} />
              {tariffFile && <Badge variant="outline">{tariffFile.name}</Badge>}
            </label>
          </div>
          <Button onClick={handleImport} disabled={importing || !actionFile || !tariffFile} className="gap-2">
            <Upload className="h-4 w-4" />
            {importing ? 'Memproses...' : 'Simpan Master'}
          </Button>
          {meta && (
            <div className="rounded-lg bg-muted/40 p-3 text-sm flex flex-wrap gap-x-5 gap-y-1">
              <span><strong>{actionsCount}</strong> tindakan</span>
              <span><strong>{tariffs.length}</strong> baris tarif</span>
              <span>Import terakhir: {new Date(meta.importedAt).toLocaleString('id-ID')}</span>
              <span className="text-muted-foreground">{meta.importedBy}</span>
            </div>
          )}
          {!meta && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              Master belum tersedia. Estimasi belum dapat menghitung tarif.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kategori Item Estimasi</CardTitle>
          <CardDescription>Kategori, status, dan urutan dikelola sepenuhnya oleh Superuser.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newCategory}
              onChange={event => setNewCategory(event.target.value)}
              placeholder={editingId ? `Ubah ${editingName}` : 'Nama kategori baru'}
              onKeyDown={event => { if (event.key === 'Enter') void saveCategory(); }}
            />
            <Button onClick={() => void saveCategory()} className="gap-2">
              {editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingId ? 'Simpan' : 'Tambah'}
            </Button>
            {editingId && <Button variant="outline" onClick={() => { setEditingId(null); setNewCategory(''); }}>Batal</Button>}
          </div>
          {categories.length === 0 ? (
            <div className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
              Belum ada kategori. Tambahkan kategori sebelum memetakan komponen tarif.
            </div>
          ) : (
            <div className="space-y-2">
              {categories.map((category, index) => (
                <div key={category.id} className="flex items-center gap-2 rounded-lg border p-2">
                  <span className="w-8 text-center text-sm text-muted-foreground">{index + 1}</span>
                  <span className={`flex-1 text-sm ${!category.aktif ? 'line-through text-muted-foreground' : ''}`}>{category.nama}</span>
                  <Badge variant={category.aktif ? 'default' : 'outline'}>{category.aktif ? 'Aktif' : 'Nonaktif'}</Badge>
                  <Button size="icon" variant="ghost" onClick={() => void moveCategory(category, -1)} disabled={index === 0} title="Naik">↑</Button>
                  <Button size="icon" variant="ghost" onClick={() => void moveCategory(category, 1)} disabled={index === categories.length - 1} title="Turun">↓</Button>
                  <Button size="icon" variant="ghost" onClick={() => editCategory(category)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => void toggleCategory(category)} title="Aktif/nonaktif"><CheckCircle2 className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => void deleteCategory(category)} title="Hapus"><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary" /> Mapping Komponen Tarif</CardTitle>
          <CardDescription>Komponen tanpa mapping akan diberi peringatan pada form estimasi.</CardDescription>
        </CardHeader>
        <CardContent>
          {tariffs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Upload Master Tarif terlebih dahulu.</p>
          ) : (
            <div className="space-y-2">
              {tariffs.map(tariff => {
                const mapping = mappings.find(item => item.komponenKey === componentKey(tariff.komponen));
                return (
                  <div key={tariff.id} className="grid gap-2 md:grid-cols-[1fr_220px] items-center border-b py-2">
                    <div className="text-sm">
                      <div className="font-medium">{tariff.komponen}</div>
                      <div className="text-xs text-muted-foreground">Golongan {tariff.golongan} · {ESTIMASI_KELAS_LABELS['KLS III']} {tariff.harga['KLS III'].toLocaleString('id-ID')}</div>
                    </div>
                    <select
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={mapping?.kategoriId || ''}
                      onChange={event => void saveMapping(tariff.komponen, event.target.value)}
                    >
                      <option value="">-- Belum dipetakan --</option>
                      {categories.filter(category => category.aktif).map(category => (
                        <option key={category.id} value={category.id}>{category.nama}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}