import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { getDB, MasterTarif, MasterTarifItem } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Upload, Search, FileSpreadsheet, CheckCircle2, XCircle,
  Trash2, Eye, Download, Plus, RefreshCw, ChevronLeft, ChevronRight
} from 'lucide-react';
import { formatDateTime, formatDate } from '../lib/utils';

const REQUIRED_COLS = ['Hospitals', 'Jenistarif', 'From Date Tarif', 'ITP RowId', 'Order Item', 'Order Item Code', 'Kelastarif', 'Price'];
const PAGE_SIZE = 50;
const MASTER_TARIF_CHANGED_EVENT = 'ipaw:master-tarif-changed';

const normalizeHeader = (value: unknown) =>
  String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();

const normalizeMasterValue = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const notifyMasterTarifChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(MASTER_TARIF_CHANGED_EVENT));
  }
};

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmtDate = (ts: number) => formatDateTime(ts);

export default function MasterTarifPage() {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  // List
  const [tarifs, setTarifs] = useState<MasterTarif[]>([]);
  const [loading, setLoading] = useState(false);

  // Import
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importForm, setImportForm] = useState({ nama: '', rumahSakit: '', jenisTarif: '', tanggalBerlaku: '' });
  const [importPreview, setImportPreview] = useState<MasterTarifItem[]>([]);
  const [importRaw, setImportRaw] = useState<any[]>([]);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

  // Detail
  const [selectedTarif, setSelectedTarif] = useState<MasterTarif | null>(null);
  const [detailItems, setDetailItems] = useState<MasterTarifItem[]>([]);
  const [detailSearch, setDetailSearch] = useState('');
  const [detailPage, setDetailPage] = useState(1);

  const load = useCallback(async () => {
    const db = await getDB();
    const all = await db.getAll('masterTarifs');
    setTarifs(all.sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Import Excel ──────────────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportPreview([]);
    setImportRaw([]);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (rows.length === 0) { setImportError('File Excel kosong.'); return; }

        // Validate columns (case-insensitive key match)
        const firstRow = rows[0];
        const actualKeys = Object.keys(firstRow);
        const missing = REQUIRED_COLS.filter(req =>
          !actualKeys.some(k => normalizeHeader(k) === normalizeHeader(req))
        );
        if (missing.length > 0) {
          setImportError(`Kolom tidak ditemukan: ${missing.join(', ')}`);
          return;
        }

        // Normalize keys
        const normalizeKey = (obj: any) => {
          const n: any = {};
          for (const k of Object.keys(obj)) {
            const match = REQUIRED_COLS.find(r => normalizeHeader(r) === normalizeHeader(k));
            if (match) n[match] = obj[k];
          }
          return n;
        };

        const normalized = rows.map(normalizeKey);

        // Auto-fill form from data
        const firstItem = normalized[0];
        setImportForm(f => ({
          nama: f.nama || `Master Tarif ${firstItem['Jenistarif'] || ''} ${firstItem['From Date Tarif'] || ''}`.trim(),
          rumahSakit: f.rumahSakit || String(firstItem['Hospitals'] || ''),
          jenisTarif: f.jenisTarif || String(firstItem['Jenistarif'] || ''),
          tanggalBerlaku: f.tanggalBerlaku || String(firstItem['From Date Tarif'] || ''),
        }));

        setImportRaw(normalized);
        setImportPreview(normalized.slice(0, 5).map(r => ({
          masterTarifId: 0,
          hospitals: String(r['Hospitals']),
          jenisTarif: String(r['Jenistarif']),
          fromDateTarif: String(r['From Date Tarif']),
          itpRowId: String(r['ITP RowId']),
          orderItem: String(r['Order Item']),
          orderItemCode: String(r['Order Item Code']),
          kelasTarif: normalizeMasterValue(r['Kelastarif']),
          price: Number(String(r['Price']).replace(/[^0-9.]/g, '')) || 0,
        })));
      } catch (err: any) {
        setImportError('Gagal membaca file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImport = async () => {
    if (!importForm.nama.trim()) { toast.error('Nama Master Tarif harus diisi.'); return; }
    if (importRaw.length === 0) { toast.error('Tidak ada data untuk diimpor.'); return; }

    setImporting(true);
    try {
      const db = await getDB();
      const existingTarifs = await db.getAll('masterTarifs');
      const hasActiveTarif = existingTarifs.some(
        (existing) => String(existing.status ?? '').trim().toLowerCase() === 'aktif',
      );

      // Log activity
      const tarif: MasterTarif = {
        nama: importForm.nama.trim(),
        rumahSakit: importForm.rumahSakit.trim(),
        jenisTarif: importForm.jenisTarif.trim(),
        tanggalBerlaku: importForm.tanggalBerlaku.trim(),
        tanggalImport: formatDate(new Date()),
        jumlahItem: importRaw.length,
        // The first imported tariff is immediately usable. Later imports
        // remain selectable as versions until the user activates one.
        status: hasActiveTarif ? 'nonaktif' : 'aktif',
        importedBy: user?.namaLengkap || '-',
        createdAt: Date.now(),
      };

      const id = await db.add('masterTarifs', tarif);

      // Batch insert items
      const tx = db.transaction('masterTarifItems', 'readwrite');
      const promises = importRaw.map(r => tx.store.add({
        masterTarifId: id as number,
        hospitals: String(r['Hospitals'] || ''),
        jenisTarif: String(r['Jenistarif'] || ''),
        fromDateTarif: String(r['From Date Tarif'] || ''),
        itpRowId: String(r['ITP RowId'] || ''),
        orderItem: String(r['Order Item'] || ''),
        orderItemCode: String(r['Order Item Code'] || ''),
        kelasTarif: normalizeMasterValue(r['Kelastarif']),
        price: Number(String(r['Price']).replace(/[^0-9.]/g, '')) || 0,
      }));
      await Promise.all(promises);
      await tx.done;

      toast.success(`Import berhasil! ${importRaw.length.toLocaleString()} item tarif tersimpan.`);
      setIsImportOpen(false);
      setImportRaw([]);
      setImportPreview([]);
      setImportError('');
      setImportForm({ nama: '', rumahSakit: '', jenisTarif: '', tanggalBerlaku: '' });
      if (fileRef.current) fileRef.current.value = '';
      await load();
      notifyMasterTarifChanged();
    } catch (err: any) {
      toast.error('Import gagal: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  // ── Activate ──────────────────────────────────────────────────────────────

  const handleActivate = async (tarif: MasterTarif) => {
    if (tarif.status === 'aktif') return;
    const db = await getDB();
    const all = await db.getAll('masterTarifs');
    const tx = db.transaction('masterTarifs', 'readwrite');
    for (const t of all) {
      await tx.store.put({ ...t, status: t.id === tarif.id ? 'aktif' : 'nonaktif' });
    }
    await tx.done;
    toast.success(`Master Tarif "${tarif.nama}" sekarang aktif.`);
    await load();
    notifyMasterTarifChanged();
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (tarif: MasterTarif) => {
    if (!confirm(`Hapus Master Tarif "${tarif.nama}" beserta ${tarif.jumlahItem.toLocaleString()} item? Tindakan ini tidak dapat dibatalkan.`)) return;
    const db = await getDB();
    await db.delete('masterTarifs', tarif.id!);
    // Delete items
    const items = await db.getAllFromIndex('masterTarifItems', 'masterTarifId', tarif.id!);
    const tx = db.transaction('masterTarifItems', 'readwrite');
    for (const item of items) await tx.store.delete(item.id!);
    await tx.done;
    toast.success('Master Tarif berhasil dihapus.');
    if (selectedTarif?.id === tarif.id) setSelectedTarif(null);
    await load();
    notifyMasterTarifChanged();
  };

  // ── Detail view ───────────────────────────────────────────────────────────

  const openDetail = async (tarif: MasterTarif) => {
    setSelectedTarif(tarif);
    setDetailSearch('');
    setDetailPage(1);
    setLoading(true);
    try {
      const db = await getDB();
      const items = await db.getAllFromIndex('masterTarifItems', 'masterTarifId', tarif.id!);
      setDetailItems(items);
    } finally {
      setLoading(false);
    }
  };

  const filteredDetail = detailItems.filter(it =>
    !detailSearch ||
    it.orderItem.toLowerCase().includes(detailSearch.toLowerCase()) ||
    it.orderItemCode.toLowerCase().includes(detailSearch.toLowerCase()) ||
    it.kelasTarif.toLowerCase().includes(detailSearch.toLowerCase())
  );
  const totalPages = Math.ceil(filteredDetail.length / PAGE_SIZE);
  const pagedItems = filteredDetail.slice((detailPage - 1) * PAGE_SIZE, detailPage * PAGE_SIZE);

  // ── Export detail ─────────────────────────────────────────────────────────

  const handleExportDetail = () => {
    if (!selectedTarif || detailItems.length === 0) return;
    const rows = detailItems.map(it => ({
      Hospitals: it.hospitals,
      Jenistarif: it.jenisTarif,
      'From Date Tarif': it.fromDateTarif,
      'ITP RowId': it.itpRowId,
      'Order Item': it.orderItem,
      'Order Item Code': it.orderItemCode,
      Kelastarif: it.kelasTarif,
      Price: it.price,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master Tarif');
    XLSX.writeFile(wb, `MasterTarif_${selectedTarif.nama.replace(/\s+/g, '_')}.xlsx`);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Master Tarif</h1>
          <p className="text-muted-foreground mt-1">
            Database referensi tarif untuk seluruh modul aplikasi. Hanya satu Master Tarif yang dapat aktif.
          </p>
        </div>
        <Button onClick={() => { setIsImportOpen(true); setImportError(''); }} className="gap-2 shrink-0">
          <Upload className="w-4 h-4" /> Import Excel
        </Button>
      </div>

      {/* Active tarif banner */}
      {(() => {
        const active = tarifs.find(t => t.status === 'aktif');
        if (!active) return null;
        return (
          <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-700 rounded-xl p-4">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="text-sm">
              <span className="font-semibold text-emerald-800 dark:text-emerald-300">Aktif: </span>
              <span className="text-emerald-700 dark:text-emerald-400">{active.nama}</span>
              <span className="text-muted-foreground ml-2">({active.jumlahItem.toLocaleString()} item · {active.jenisTarif})</span>
            </div>
          </div>
        );
      })()}

      {/* List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="w-4 h-4" /> Daftar Master Tarif ({tarifs.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {tarifs.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">Belum ada Master Tarif</p>
              <p className="text-sm mt-1">Import file Excel untuk mulai menggunakan fitur ini.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Nama</th>
                    <th className="px-4 py-3 text-left font-semibold">Rumah Sakit</th>
                    <th className="px-4 py-3 text-left font-semibold">Jenis Tarif</th>
                    <th className="px-4 py-3 text-left font-semibold">Tgl Berlaku</th>
                    <th className="px-4 py-3 text-left font-semibold">Tgl Import</th>
                    <th className="px-4 py-3 text-right font-semibold">Jumlah Item</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {tarifs.map(t => (
                    <tr key={t.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium max-w-[180px] truncate">{t.nama}</td>
                      <td className="px-4 py-3 text-muted-foreground">{t.rumahSakit || '-'}</td>
                      <td className="px-4 py-3">{t.jenisTarif || '-'}</td>
                      <td className="px-4 py-3">{t.tanggalBerlaku || '-'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(t.createdAt)}</td>
                      <td className="px-4 py-3 text-right font-mono">{t.jumlahItem.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center">
                        {t.status === 'aktif' ? (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-emerald-300">
                            Aktif
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Nonaktif</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => openDetail(t)} title="Lihat Item">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {t.status !== 'aktif' && (
                            <Button size="sm" variant="outline" onClick={() => handleActivate(t)}
                              className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-700 dark:hover:bg-emerald-900/20 text-xs">
                              Aktifkan
                            </Button>
                          )}
                          <Button size="sm" variant="ghost"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDelete(t)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      {selectedTarif && (
        <Dialog open={!!selectedTarif} onOpenChange={() => setSelectedTarif(null)}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span>{selectedTarif.nama}</span>
                {selectedTarif.status === 'aktif' && (
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">Aktif</Badge>
                )}
                <span className="text-sm font-normal text-muted-foreground ml-auto">
                  {detailItems.length.toLocaleString()} item
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="flex gap-3 shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cari nama item, kode, atau kelas tarif..."
                  value={detailSearch}
                  onChange={e => { setDetailSearch(e.target.value); setDetailPage(1); }}
                  className="pl-10 h-9 text-sm"
                />
              </div>
              <Button size="sm" variant="outline" onClick={handleExportDetail} className="gap-1.5 shrink-0">
                <Download className="w-3.5 h-3.5" /> Export
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto border rounded-lg">
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 sticky top-0 border-b border-border">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-semibold">Kode</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Nama Item</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Kelas Tarif</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Harga</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedItems.map(it => (
                      <tr key={it.id} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono text-muted-foreground">{it.orderItemCode}</td>
                        <td className="px-3 py-2 font-medium">{it.orderItem}</td>
                        <td className="px-3 py-2 text-muted-foreground">{it.kelasTarif}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmtRp(it.price)}</td>
                      </tr>
                    ))}
                    {pagedItems.length === 0 && (
                      <tr><td colSpan={4} className="text-center py-10 text-muted-foreground">Item tidak ditemukan.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground shrink-0 pt-1">
                <span>{filteredDetail.length.toLocaleString()} hasil · Hal {detailPage}/{totalPages}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={detailPage === 1} onClick={() => setDetailPage(p => p - 1)}>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" disabled={detailPage >= totalPages} onClick={() => setDetailPage(p => p + 1)}>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Import Dialog */}
      <Dialog open={isImportOpen} onOpenChange={v => { setIsImportOpen(v); if (!v) { setImportRaw([]); setImportPreview([]); setImportError(''); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Upload className="w-4 h-4" /> Import Master Tarif</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* File picker */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">File Excel <span className="text-red-500">*</span></label>
              <p className="text-xs text-muted-foreground">
                Kolom wajib: {REQUIRED_COLS.join(', ')}
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
              />
              {importError && (
                <div className="flex items-center gap-2 text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm">
                  <XCircle className="w-4 h-4 shrink-0" />
                  {importError}
                </div>
              )}
            </div>

            {/* Form info */}
            {importRaw.length > 0 && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold">Nama Master Tarif <span className="text-red-500">*</span></label>
                    <Input value={importForm.nama} onChange={e => setImportForm(f => ({ ...f, nama: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold">Rumah Sakit</label>
                    <Input value={importForm.rumahSakit} onChange={e => setImportForm(f => ({ ...f, rumahSakit: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold">Jenis Tarif</label>
                    <Input value={importForm.jenisTarif} onChange={e => setImportForm(f => ({ ...f, jenisTarif: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold">Tanggal Berlaku</label>
                    <Input value={importForm.tanggalBerlaku} onChange={e => setImportForm(f => ({ ...f, tanggalBerlaku: e.target.value }))} />
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total Item', value: importRaw.length.toLocaleString() },
                    { label: 'Kode Unik', value: new Set(importRaw.map((r: any) => r['Order Item Code'])).size.toLocaleString() },
                    { label: 'Kelas Tarif', value: new Set(importRaw.map((r: any) => r['Kelastarif'])).size.toLocaleString() },
                  ].map(s => (
                    <div key={s.label} className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-xl font-bold">{s.value}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* Preview */}
                <div>
                  <p className="text-sm font-semibold mb-2">Preview 5 baris pertama:</p>
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60 border-b">
                        <tr>
                          <th className="px-3 py-2 text-left">Kode</th>
                          <th className="px-3 py-2 text-left">Nama Item</th>
                          <th className="px-3 py-2 text-left">Kelas</th>
                          <th className="px-3 py-2 text-right">Harga</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.map((it, i) => (
                          <tr key={i} className="border-b border-border/30">
                            <td className="px-3 py-1.5 font-mono">{it.orderItemCode}</td>
                            <td className="px-3 py-1.5">{it.orderItem}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{it.kelasTarif}</td>
                            <td className="px-3 py-1.5 text-right">{fmtRp(it.price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsImportOpen(false)}>Batal</Button>
            <Button
              onClick={handleImport}
              disabled={importing || importRaw.length === 0 || !!importError}
              className="gap-2"
            >
              {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {importing ? 'Mengimpor...' : `Import ${importRaw.length > 0 ? importRaw.length.toLocaleString() + ' item' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
