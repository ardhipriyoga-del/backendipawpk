import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getDB, MasterTarifItem, EstimasiItem, EstimasiBiaya } from '../lib/db';
import {
  parseCPExcel, lookupHarga, isObatKategori,
  fmtRp, calcAdmin, ADMIN_RATE, ADMIN_MAX, MATERAI_DEFAULT,
  normalizeMasterTarifClass, type MatchStatus, type CPRow,
} from '../lib/estimasi';
import { generateUUID } from '../lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Upload, Save, Trash2, Plus, AlertCircle, RefreshCw,
  FileSpreadsheet, DollarSign, Printer,
} from 'lucide-react';
import type { Patient } from '../lib/db';
import { formatDateTime } from '../lib/utils';

interface AuthUser {
  id: number;
  username: string;
  namaLengkap: string;
  role: 'superuser' | 'officer';
}

interface Props {
  isOpen: boolean;
  patient: Patient;
  user: AuthUser;
  onClose: () => void;
  isInline?: boolean;
}

const MATCH_LABEL: Record<MatchStatus, string> = {
  exact: '✓ Cocok',
  alias: '≈ Alias',
  fuzzy: '~ Fuzzy',
  unmapped: '! Belum Dipetakan',
  manual: '✎ Manual',
};
const MATCH_COLOR: Record<MatchStatus, string> = {
  exact:   'bg-emerald-100 text-emerald-700',
  alias:   'bg-blue-100 text-blue-700',
  fuzzy:   'bg-amber-100 text-amber-700',
  unmapped:'bg-red-100 text-red-700',
  manual:  'bg-purple-100 text-purple-700',
};

function computeDefaultLamaRawat(admissionDate: string, dischargeDate: string | null): number {
  try {
    const adm = new Date(admissionDate);
    const dis = dischargeDate ? new Date(dischargeDate) : new Date();
    const diff = Math.ceil((dis.getTime() - adm.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, diff);
  } catch {
    return 1;
  }
}

// ── QtyInput: allows clearing / free-typing without snapping back ────────────
function QtyInput({ value, onChange, className = '' }: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  // Sync when parent resets the value externally
  useEffect(() => { setDraft(String(value)); }, [value]);

  return (
    <Input
      type="number"
      min={0}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const n = parseFloat(draft);
        const final = isNaN(n) || draft.trim() === '' ? 1 : n;
        setDraft(String(final));
        onChange(final);
      }}
      className={className}
    />
  );
}

function LamaRawatInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <Input
      type="number"
      min={1}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const n = parseInt(draft);
        const final = isNaN(n) || draft.trim() === '' ? 1 : Math.max(1, n);
        setDraft(String(final));
        onChange(final);
      }}
      className="h-9 w-24 text-sm"
    />
  );
}

function RemapInput({ namaItem, kelasTarif, masterItems, onRemap }: {
  namaItem: string;
  kelasTarif: string;
  masterItems: MasterTarifItem[];
  onRemap: (newName: string, price: number, status: MatchStatus, matchedName: string, id?: number) => void;
}) {
  const [val, setVal] = useState(namaItem);
  const [suggestions, setSuggestions] = useState<MasterTarifItem[]>([]);

  const search = (q: string) => {
    setVal(q);
    if (!q.trim()) { setSuggestions([]); return; }
    const norm = q.toLowerCase();
    const filtered = masterItems
      .filter(i => i.kelasTarif === kelasTarif && i.orderItem.toLowerCase().includes(norm))
      .slice(0, 6);
    setSuggestions(filtered);
  };

  return (
    <div className="relative">
      <Input
        value={val}
        onChange={e => search(e.target.value)}
        placeholder="Cari item Master Tarif..."
        className="h-7 text-xs pr-2"
        autoFocus
      />
      {suggestions.length > 0 && (
        <div className="absolute top-full left-0 z-50 bg-white border border-border rounded-md shadow-lg w-64 max-h-48 overflow-y-auto mt-0.5">
          {suggestions.map(s => (
            <button
              key={s.id}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
              onMouseDown={() => {
                onRemap(val, s.price, 'manual', s.orderItem, s.id);
                setSuggestions([]);
              }}
            >
              <div className="font-medium truncate">{s.orderItem}</div>
              <div className="text-muted-foreground">{fmtRp(s.price)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EstimasiPanel({ isOpen, patient, user, onClose, isInline = false }: Props) {
  const isSuperuser = user.role === 'superuser';

  const [masterItems, setMasterItems]         = useState<MasterTarifItem[]>([]);
  const [hasMasterTarif, setHasMasterTarif]   = useState(false);
  const [kelasPerawatan, setKelasPerawatan]   = useState('');
  const [kelasTarif, setKelasTarif]           = useState('');
  const [namaFileCP, setNamaFileCP]           = useState('');
  const [diagnosa, setDiagnosa]               = useState('');
  const [lamaRawat, setLamaRawat]             = useState(1);
  const [items, setItems]                     = useState<EstimasiItem[]>([]);
  const [bulkObatTotal, setBulkObatTotal]     = useState(0);
  const [bulkObatInput, setBulkObatInput]     = useState('0');
  const [obatDetailItems, setObatDetailItems] = useState<CPRow[]>([]);
  const [materaiHarga, setMateraiHarga]       = useState(MATERAI_DEFAULT);
  const [adminOverride, setAdminOverride]     = useState<number | null>(null);
  const [adminOverrideInput, setAdminOverrideInput]     = useState('');
  const [editingAdminOverride, setEditingAdminOverride] = useState(false);
  const [remapItemId, setRemapItemId]         = useState<string | null>(null);
  const [saving, setSaving]                   = useState(false);
  const [obatDetailOpen, setObatDetailOpen]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const masterClassOptions = useMemo(
    () => [...new Set(masterItems.map(item => normalizeMasterTarifClass(item.kelasTarif)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'id')),
    [masterItems],
  );

  // ── Load master tarif items + existing estimasi ──────────────────────────
  const loadData = useCallback(async () => {
    const db = await getDB();
    const tarifs = await db.getAll('masterTarifs');
    const activeTarif = tarifs
      .filter(t => String(t.status).toLowerCase() === 'aktif')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    let masterClasses: string[] = [];
    if (activeTarif) {
      const mItems = (await db.getAll('masterTarifItems'))
        .filter(item => Number(item.masterTarifId) === Number(activeTarif.id))
        .map(item => ({ ...item, kelasTarif: normalizeMasterTarifClass(item.kelasTarif) }));
      masterClasses = [...new Set(mItems.map(item => item.kelasTarif.trim()).filter(Boolean))];
      setMasterItems(mItems);
      setHasMasterTarif(true);
      const materai = mItems.find(i => i.orderItem.toLowerCase().includes('materai'));
      if (materai) setMateraiHarga(materai.price);
    } else {
      setMasterItems([]);
      setHasMasterTarif(false);
    }

    const allEstimasi = await db.getAllFromIndex('estimasiBiaya', 'noRM', patient.noRM);
    const existing = allEstimasi.find(e => e.episodeNo === patient.episodeNo);
    if (existing) {
      setKelasPerawatan(existing.kelasPerawatan);
      setKelasTarif(masterClasses.includes(existing.kelasTarif) ? existing.kelasTarif : '');
      setNamaFileCP(existing.namaFileCP);
      setDiagnosa(existing.diagnosa ?? '');
      setLamaRawat(existing.lamaRawat ?? computeDefaultLamaRawat(patient.admissionDate, patient.dischargeDate));
      setItems(existing.items);
      setBulkObatTotal(existing.bulkObatTotal);
      setBulkObatInput(String(existing.bulkObatTotal));
      setObatDetailItems(existing.obatDetailItems ?? []);
      if (existing.adminOverrideValue != null) {
        setAdminOverride(existing.adminOverrideValue);
        setAdminOverrideInput(String(existing.adminOverrideValue));
      }
    } else {
      const defaultKelas = normalizeMasterTarifClass(patient.roomType);
      const defaultTarif = masterClasses.find(
        option => option.toLowerCase() === defaultKelas.toLowerCase(),
      ) || '';
      setKelasPerawatan(defaultKelas);
      setKelasTarif(defaultTarif);
      setDiagnosa(patient.diagnosaMasuk || patient.diagnosakUtama || '');
      setLamaRawat(computeDefaultLamaRawat(patient.admissionDate, patient.dischargeDate));
    }
  }, [patient.noRM, patient.episodeNo, patient.roomType, patient.admissionDate, patient.dischargeDate, patient.diagnosaMasuk, patient.diagnosakUtama]);

  useEffect(() => {
    if (isOpen) loadData();
  }, [isOpen, loadData]);

  // ── Kelas change → re-match items ────────────────────────────────────────
  const handleKelasChange = (tarif: string) => {
    setKelasTarif(tarif);
    if (masterItems.length > 0) {
      setItems(prev => prev.map(item => {
        if (item.hargaOverride) return item;
        const res = lookupHarga(item.namaItem, tarif, masterItems);
        return { ...item, harga: res.price, matchStatus: res.status, matchedName: res.matchedName, masterTarifItemId: res.masterTarifItemId };
      }));
        const materai = masterItems.find(
          i => normalizeMasterTarifClass(i.kelasTarif) === normalizeMasterTarifClass(tarif)
            && i.orderItem.toLowerCase().includes('materai'),
        );
      setMateraiHarga(materai ? materai.price : MATERAI_DEFAULT);
    }
  };

  // ── CP Excel Upload ──────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!kelasTarif) { toast.error('Pilih Kelas Tarif terlebih dahulu'); return; }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const buf = ev.target!.result as ArrayBuffer;
        const rows = parseCPExcel(buf);
        if (!rows.length) { toast.error('Tidak ada item ditemukan di file CP. Pastikan format sesuai.'); return; }

        const obatRows: CPRow[] = [];
        const newItems: EstimasiItem[] = [];

        for (const row of rows) {
          if (isObatKategori(row.kategori)) {
            obatRows.push(row);
            continue;
          }
          const res = lookupHarga(row.namaItem, kelasTarif, masterItems);
          newItems.push({
            id: generateUUID(),
            kategori: row.kategori,
            namaItem: row.namaItem,
            qty: row.qty,
            harga: res.price,
            hargaOverride: false,
            matchStatus: res.status,
            matchedName: res.matchedName,
            masterTarifItemId: res.masterTarifItemId,
          });
        }

        setItems(newItems);
        setObatDetailItems(obatRows);
        setNamaFileCP(file.name);
        toast.success(`${newItems.length} item berhasil dimuat dari ${file.name}`);
        if (obatRows.length) toast.info(`${obatRows.length} item Obat dimasukkan ke Kelola Detail Obat`);
      } catch (err: any) {
        toast.error('Gagal membaca file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // ── Item mutations ───────────────────────────────────────────────────────
  const updateItem = (id: string, changes: Partial<EstimasiItem>) =>
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...changes } : it));

  const deleteItem = (id: string) =>
    setItems(prev => prev.filter(it => it.id !== id));

  const addManualItem = (kategori: string) => {
    setItems(prev => [...prev, {
      id: generateUUID(),
      kategori,
      namaItem: '',
      qty: 1,
      harga: 0,
      hargaOverride: true,
      matchStatus: 'manual' as MatchStatus,
      matchedName: '',
    }]);
  };

  const handleRemap = (id: string, newName: string, price: number, status: MatchStatus, matchedName: string, mId?: number) => {
    updateItem(id, { namaItem: newName, harga: price, matchStatus: status, matchedName, masterTarifItemId: mId });
    setRemapItemId(null);
  };

  // ── Calculations ─────────────────────────────────────────────────────────
  const totalSebelumAdmin = useMemo(() => {
    const itemsTotal = items.reduce((s, it) => s + it.qty * it.harga, 0);
    return itemsTotal + bulkObatTotal;
  }, [items, bulkObatTotal]);

  const biayaAdmin  = useMemo(() => calcAdmin(totalSebelumAdmin, adminOverride), [totalSebelumAdmin, adminOverride]);
  const grandTotal  = useMemo(() => totalSebelumAdmin + biayaAdmin + materaiHarga, [totalSebelumAdmin, biayaAdmin, materaiHarga]);

  // ── Grouped categories ───────────────────────────────────────────────────
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const it of items) if (!seen.includes(it.kategori)) seen.push(it.kategori);
    return seen;
  }, [items]);

  const hasObatCategory = useMemo(() =>
    items.some(it => isObatKategori(it.kategori)) || bulkObatTotal > 0 || obatDetailItems.length > 0,
    [items, bulkObatTotal, obatDetailItems]);

  const obatKategoriLabel = useMemo(() =>
    items.find(it => isObatKategori(it.kategori))?.kategori || 'OBAT RAWAT INAP & OBAT PULANG',
    [items]);

  const nonObatCategories = useMemo(() => categories.filter(c => !isObatKategori(c)), [categories]);

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!kelasTarif) { toast.error('Pilih Kelas Tarif terlebih dahulu'); return; }
    setSaving(true);
    try {
      const db = await getDB();
      const allEstimasi = await db.getAllFromIndex('estimasiBiaya', 'noRM', patient.noRM);
      const existing = allEstimasi.find(e => e.episodeNo === patient.episodeNo);
      const now = Date.now();
      const estimasi: EstimasiBiaya = {
        id: existing?.id ?? generateUUID(),
        noRM: patient.noRM,
        episodeNo: patient.episodeNo,
        namaPasien: patient.namaPasien,
        namaFileCP,
        kelasTarif,
        kelasPerawatan,
        diagnosa,
        lamaRawat,
        items,
        bulkObatTotal,
        obatDetailItems,
        adminOverrideValue: adminOverride ?? undefined,
        adminOverrideBy: adminOverride !== null ? user.namaLengkap : undefined,
        totalSebelumAdmin,
        biayaAdmin,
        biayaMaterai: materaiHarga,
        grandTotal,
        uploadedBy: user.namaLengkap,
        uploadedAt: existing?.uploadedAt ?? now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await db.put('estimasiBiaya', estimasi);
      toast.success('Estimasi biaya berhasil disimpan');
    } catch (err: any) {
      toast.error('Gagal menyimpan: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setItems([]);
    setBulkObatTotal(0);
    setBulkObatInput('0');
    setNamaFileCP('');
    setObatDetailItems([]);
    setAdminOverride(null);
    setAdminOverrideInput('');
    setEditingAdminOverride(false);
  };

  // ── Print ────────────────────────────────────────────────────────────────
  const handlePrint = () => {
    const year = new Date().getFullYear();

    let bodyRows = '';

    // Non-obat categories
    for (const kat of nonObatCategories) {
      bodyRows += `<tr class="cat-row"><td colspan="4">${escHtml(kat)}</td></tr>`;
      for (const item of items.filter(it => it.kategori === kat)) {
        bodyRows += `<tr>
          <td>${escHtml(item.namaItem)}</td>
          <td class="tc">${item.qty}</td>
          <td class="tr">${escHtml(fmtRp(item.harga))}</td>
          <td class="tr">${escHtml(fmtRp(item.qty * item.harga))}</td>
        </tr>`;
      }
    }

    // Obat category (bulk)
    if (hasObatCategory) {
      bodyRows += `<tr class="cat-row"><td colspan="4">${escHtml(obatKategoriLabel)}</td></tr>`;
      bodyRows += `<tr>
        <td>Total Obat Rawat Inap &amp; Obat Pulang</td>
        <td class="tc">1</td>
        <td class="tr">${escHtml(fmtRp(bulkObatTotal))}</td>
        <td class="tr">${escHtml(fmtRp(bulkObatTotal))}</td>
      </tr>`;
      // Obat detail items (reference list)
      if (obatDetailItems.length > 0) {
        for (const od of obatDetailItems) {
          bodyRows += `<tr style="color:#555;font-style:italic">
            <td style="padding-left:20px">↳ ${escHtml(od.namaItem)}</td>
            <td class="tc">${od.qty}</td>
            <td></td><td></td>
          </tr>`;
        }
      }
    }

    // Footer summary
    bodyRows += `<tr class="total-row">
      <td colspan="3">TOTAL BIAYA SEBELUM ADMINISTRASI</td>
      <td class="tr">${escHtml(fmtRp(totalSebelumAdmin))}</td>
    </tr>`;
    bodyRows += `<tr>
      <td>Admin (${(ADMIN_RATE * 100).toFixed(0)}%, Maks. ${fmtRp(ADMIN_MAX)})${adminOverride !== null ? ' — Override' : ''}</td>
      <td class="tc">1</td>
      <td></td>
      <td class="tr">${escHtml(fmtRp(biayaAdmin))}</td>
    </tr>`;
    bodyRows += `<tr>
      <td>Materai</td>
      <td class="tc">1</td>
      <td class="tr">${escHtml(fmtRp(materaiHarga))}</td>
      <td class="tr">${escHtml(fmtRp(materaiHarga))}</td>
    </tr>`;
    bodyRows += `<tr class="grand-total-row">
      <td colspan="3">TOTAL BIAYA SETELAH ADMINISTRASI</td>
      <td class="tr">${escHtml(fmtRp(grandTotal))}</td>
    </tr>`;

    const printedAt = formatDateTime(new Date());

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<title>Estimasi Biaya – ${escHtml(patient.namaPasien)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10pt; margin: 0; padding: 12mm 15mm; }
  .hdr-table { border-collapse: collapse; margin-bottom: 10px; }
  .hdr-table td { padding: 2px 6px; border: none; vertical-align: top; }
  .hdr-table .lbl { width: 110px; font-weight: bold; white-space: nowrap; }
  .rs-title { font-weight: bold; font-size: 11pt; margin: 10px 0 2px; }
  .kelas-badge {
    display: inline-block;
    background: #4472C4; color: #fff;
    padding: 2px 10px; border-radius: 4px;
    font-weight: bold; font-size: 10pt;
    margin-bottom: 8px;
  }
  table.main { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.main th, table.main td { border: 1px solid #000; padding: 4px 7px; }
  table.main th { background: #4472C4; color: #fff; font-size: 10pt; }
  .cat-row td { background: #4472C4; color: #fff; font-weight: bold; }
  .total-row td { background: #4472C4; color: #fff; font-weight: bold; }
  .grand-total-row td { background: #70AD47; color: #fff; font-weight: bold; font-size: 11pt; }
  .tc { text-align: center; }
  .tr { text-align: right; white-space: nowrap; }
  .footer { margin-top: 20px; font-size: 8.5pt; color: #666; }
  @media print {
    @page { margin: 10mm 12mm; size: A4 portrait; }
    body { padding: 0; }
  }
</style>
</head>
<body>
<table class="hdr-table">
  <tr><td class="lbl">Nama Pasien</td><td>: <strong>${escHtml(patient.namaPasien)}</strong></td></tr>
  <tr><td class="lbl">No RM</td><td>: ${escHtml(patient.noRM)}</td></tr>
  <tr><td class="lbl">Diagnosa</td><td>: ${escHtml(diagnosa || '—')}</td></tr>
  <tr><td class="lbl">Lama rawat</td><td>: ${lamaRawat} hari</td></tr>
</table>

<div class="rs-title">Tarif UMUM RS EMC Healthcare Group tahun ${year}</div>
<div class="kelas-badge">${escHtml(kelasTarif)}</div>

<table class="main">
  <thead>
    <tr>
      <th style="width:50%;text-align:left">Keterangan</th>
      <th style="width:8%" class="tc">Jumlah</th>
      <th style="width:21%" class="tr">Biaya</th>
      <th style="width:21%" class="tr">Total Biaya</th>
    </tr>
  </thead>
  <tbody>
    ${bodyRows}
  </tbody>
</table>

</body>
</html>`;

    const w = window.open('', '_blank', 'width=860,height=700');
    if (!w) { toast.error('Popup diblokir browser — izinkan popup untuk mencetak.'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };

  // ── Table cell helpers ───────────────────────────────────────────────────
  const CategoryRow = ({ label }: { label: string }) => (
    <tr className="bg-slate-100 dark:bg-slate-800">
      <td colSpan={5} className="px-3 py-1.5 font-bold text-sm text-slate-700 dark:text-slate-200 uppercase tracking-wide">
        {label}
      </td>
    </tr>
  );

  const SummaryRow = ({ label, value, className = '' }: { label: string; value: number; className?: string }) => (
    <tr className={`font-bold ${className}`}>
      <td colSpan={3} className="px-3 py-2 text-sm border-t border-slate-200 dark:border-slate-700">{label}</td>
      <td className="px-3 py-2 text-sm text-right border-t border-slate-200 dark:border-slate-700 font-mono">{fmtRp(value)}</td>
      <td className="border-t border-slate-200 dark:border-slate-700" />
    </tr>
  );

  // ── Shared inner content ─────────────────────────────────────────────────
  const innerContent = (
    <>
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 bg-muted/40 border border-border rounded-lg p-3 mt-1">
        {/* Row 1: Kelas + Upload */}
        <div className="flex flex-wrap gap-3 items-end">
          {/* Kelas Tarif from Master Tarif */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground">Kelas Tarif</label>
            <select
              value={kelasTarif}
              onChange={e => handleKelasChange(e.target.value)}
              disabled={!masterClassOptions.length}
              className="h-9 px-3 border border-input rounded-md bg-background text-sm min-w-[180px]"
            >
              <option value="">
                {masterClassOptions.length ? '— Pilih dari Master Tarif —' : '— Master Tarif belum tersedia —'}
              </option>
              {masterClassOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          {/* KelasTarif badge */}
          {kelasTarif && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground">Kelas Tarif</label>
              <span className="inline-flex items-center h-9 px-3 rounded-md bg-emerald-100 text-emerald-800 text-sm font-semibold border border-emerald-200">
                {kelasTarif}
              </span>
            </div>
          )}

          {/* Lama Rawat */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground">Lama Rawat (hari)</label>
            <LamaRawatInput value={lamaRawat} onChange={setLamaRawat} />
          </div>

          {/* Upload CP */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground">File CP Excel</label>
            <label className={`flex items-center gap-2 h-9 px-3 rounded-md border text-sm cursor-pointer transition-colors
              ${kelasTarif ? 'bg-primary text-primary-foreground hover:bg-primary/90 border-primary' : 'bg-muted text-muted-foreground border-input cursor-not-allowed'}`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload File CP</span>
              <input
                ref={fileRef}
                type="file"
                accept=".xls,.xlsx"
                className="hidden"
                disabled={!kelasTarif}
                onChange={handleFileChange}
              />
            </label>
          </div>

          {namaFileCP && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground bg-background border border-border rounded-md px-3 h-9">
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span className="max-w-[180px] truncate">{namaFileCP}</span>
            </div>
          )}

          {!hasMasterTarif && (
            <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 h-9">
              <AlertCircle className="w-3.5 h-3.5" />
              Tidak ada Master Tarif aktif — harga tidak dapat dilookup
            </div>
          )}
        </div>

        {/* Row 2: Diagnosa */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground">Diagnosa</label>
          <Input
            value={diagnosa}
            onChange={e => setDiagnosa(e.target.value)}
            placeholder="Masukkan diagnosa pasien (tampil di cetakan)..."
            className="h-9 text-sm w-full"
          />
        </div>
      </div>

      {/* ── No items state ──────────────────────────────────────────── */}
      {items.length === 0 && bulkObatTotal === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <FileSpreadsheet className="w-12 h-12 opacity-20" />
          <p className="font-semibold">Belum ada estimasi biaya</p>
          <p className="text-sm">Upload file CP Excel untuk memulai, atau tambah item manual.</p>
          {kelasTarif && (
            <Button variant="outline" size="sm" onClick={() => addManualItem('TINDAKAN')}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Tambah Item Manual
            </Button>
          )}
        </div>
      )}

      {/* ── Estimasi Table ──────────────────────────────────────────── */}
      {(items.length > 0 || bulkObatTotal > 0 || obatDetailItems.length > 0) && (
        <div className="overflow-x-auto rounded-lg border border-border mt-1">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-700 text-white">
                <th className="px-3 py-2 text-left font-semibold">Keterangan</th>
                <th className="px-3 py-2 text-center font-semibold w-20">Jumlah</th>
                <th className="px-3 py-2 text-right font-semibold w-36">Biaya</th>
                <th className="px-3 py-2 text-right font-semibold w-36">Total Biaya</th>
                <th className="px-3 py-2 text-center font-semibold w-16">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {/* ── Non-obat categories ──────────────────────────── */}
              {nonObatCategories.map(kat => (
                <React.Fragment key={kat}>
                  <CategoryRow label={kat} />
                  {items.filter(it => it.kategori === kat).map((item, idx) => (
                    <tr key={item.id} className={`border-b border-slate-100 dark:border-slate-800 ${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-900/20'}`}>
                      {/* Keterangan */}
                      <td className="px-3 py-1.5">
                        {item.matchStatus === 'unmapped' && remapItemId !== item.id ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-slate-500 line-through text-xs">{item.namaItem}</span>
                            <div className="flex items-center gap-1">
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${MATCH_COLOR[item.matchStatus]}`}>
                                {MATCH_LABEL[item.matchStatus]}
                              </span>
                              <button className="text-xs text-blue-600 underline" onClick={() => setRemapItemId(item.id)}>
                                Petakan
                              </button>
                            </div>
                          </div>
                        ) : remapItemId === item.id ? (
                          <div className="flex items-center gap-2">
                            <RemapInput
                              namaItem={item.namaItem}
                              kelasTarif={kelasTarif}
                              masterItems={masterItems}
                              onRemap={(n, p, s, mn, id) => handleRemap(item.id, n, p, s, mn, id)}
                            />
                            <button className="text-xs text-muted-foreground" onClick={() => setRemapItemId(null)}>✕</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {item.matchStatus !== 'exact' && item.matchStatus !== 'manual' && (
                              <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${MATCH_COLOR[item.matchStatus]}`}>
                                {MATCH_LABEL[item.matchStatus]}
                              </span>
                            )}
                            <Input
                              value={item.namaItem}
                              onChange={e => updateItem(item.id, { namaItem: e.target.value, matchStatus: 'manual' })}
                              className="h-7 text-sm border-0 bg-transparent p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                          </div>
                        )}
                      </td>
                      {/* Jumlah */}
                      <td className="px-3 py-1.5 text-center">
                        <QtyInput
                          value={item.qty}
                          onChange={n => updateItem(item.id, { qty: n })}
                          className="h-7 text-sm text-center w-16 mx-auto"
                        />
                      </td>
                      {/* Biaya */}
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {item.hargaOverride && <span className="text-xs text-amber-600">✎</span>}
                          <Input
                            type="number"
                            min={0}
                            value={item.harga}
                            onChange={e => updateItem(item.id, { harga: parseFloat(e.target.value) || 0, hargaOverride: true })}
                            className="h-7 text-sm text-right w-32"
                          />
                        </div>
                      </td>
                      {/* Total */}
                      <td className="px-3 py-1.5 text-right font-mono font-medium">
                        {fmtRp(item.qty * item.harga)}
                      </td>
                      {/* Aksi */}
                      <td className="px-3 py-1.5 text-center">
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="text-slate-400 hover:text-red-500 transition-colors"
                          title="Hapus item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={5} className="px-3 py-1">
                      <button
                        className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                        onClick={() => addManualItem(kat)}
                      >
                        <Plus className="w-3 h-3" /> Tambah Item
                      </button>
                    </td>
                  </tr>
                </React.Fragment>
              ))}

              {/* ── Obat Category (bulk) ─────────────────────────── */}
              {(hasObatCategory || items.length > 0) && (
                <>
                  <CategoryRow label={obatKategoriLabel} />
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium">Total Obat Rawat Inap &amp; Obat Pulang</span>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-muted-foreground">Input estimasi biaya obat:</label>
                          <Input
                            type="number"
                            min={0}
                            value={bulkObatInput}
                            onChange={e => {
                              setBulkObatInput(e.target.value);
                              setBulkObatTotal(parseFloat(e.target.value) || 0);
                            }}
                            placeholder="0"
                            className="h-7 text-sm w-40"
                          />
                          {obatDetailItems.length > 0 && (
                            <button className="text-xs text-blue-600 underline" onClick={() => setObatDetailOpen(true)}>
                              Kelola Detail Obat ({obatDetailItems.length} item)
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center text-sm">1</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtRp(bulkObatTotal)}</td>
                    <td className="px-3 py-2 text-right font-mono font-medium">{fmtRp(bulkObatTotal)}</td>
                    <td />
                  </tr>
                </>
              )}

              {/* ── Footer ──────────────────────────────────────── */}
              <SummaryRow
                label="TOTAL BIAYA SEBELUM ADMINISTRASI"
                value={totalSebelumAdmin}
                className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100"
              />

              {/* Administrasi row */}
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 text-sm">
                  <div>
                    Administrasi
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({(ADMIN_RATE * 100).toFixed(0)}%, Maks. {fmtRp(ADMIN_MAX)})
                    </span>
                    {adminOverride !== null && (
                      <span className="ml-1 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Override</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-center text-sm">1</td>
                <td className="px-3 py-2 text-right">
                  {isSuperuser && editingAdminOverride ? (
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        type="number"
                        min={0}
                        max={ADMIN_MAX}
                        value={adminOverrideInput}
                        onChange={e => setAdminOverrideInput(e.target.value)}
                        onBlur={() => {
                          const v = parseFloat(adminOverrideInput) || 0;
                          setAdminOverride(v);
                          setEditingAdminOverride(false);
                        }}
                        className="h-7 text-sm text-right w-32"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      <span className="font-mono text-sm">{fmtRp(biayaAdmin)}</span>
                      {isSuperuser && (
                        <button
                          className="text-xs text-blue-500 hover:text-blue-700"
                          title="Override (Superuser)"
                          onClick={() => {
                            setAdminOverrideInput(String(biayaAdmin));
                            setEditingAdminOverride(true);
                          }}
                        >
                          ✎
                        </button>
                      )}
                      {adminOverride !== null && (
                        <button
                          className="text-xs text-red-400 hover:text-red-600"
                          title="Reset ke auto"
                          onClick={() => { setAdminOverride(null); setAdminOverrideInput(''); }}
                        >
                          <RefreshCw className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono font-medium">{fmtRp(biayaAdmin)}</td>
                <td />
              </tr>

              {/* Materai row */}
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 text-sm">Materai</td>
                <td className="px-3 py-2 text-center text-sm">1</td>
                <td className="px-3 py-2 text-right font-mono text-sm">{fmtRp(materaiHarga)}</td>
                <td className="px-3 py-2 text-right font-mono font-medium">{fmtRp(materaiHarga)}</td>
                <td />
              </tr>

              <SummaryRow
                label="TOTAL BIAYA SETELAH ADMINISTRASI"
                value={grandTotal}
                className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200"
              />
            </tbody>
          </table>
        </div>
      )}

      {/* ── Action Buttons ───────────────────────────────────────────── */}
      <div className="flex justify-between items-center pt-2 border-t border-border mt-2">
        <Button variant="ghost" size="sm" onClick={handleReset} className="text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Reset
        </Button>
        <div className="flex gap-2">
          {!isInline && (
            <Button variant="outline" onClick={onClose}>Tutup</Button>
          )}
          {(items.length > 0 || bulkObatTotal > 0) && (
            <Button variant="outline" onClick={handlePrint} className="gap-2 border-slate-400">
              <Printer className="w-4 h-4" /> Cetak
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="w-4 h-4" />
            {saving ? 'Menyimpan...' : 'Simpan Estimasi'}
          </Button>
        </div>
      </div>
    </>
  );

  // ── Obat Detail Modal (shared) ───────────────────────────────────────────
  const obatDetailDialog = (
    <Dialog open={obatDetailOpen} onOpenChange={setObatDetailOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Detail Obat Rawat Inap &amp; Obat Pulang</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Item-item berikut berasal dari file CP. Biaya dihitung secara bulk — masukkan total estimasi biaya di panel utama.
        </p>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted">
                <th className="px-3 py-2 text-left font-semibold">Item</th>
                <th className="px-3 py-2 text-center font-semibold w-16">Qty</th>
              </tr>
            </thead>
            <tbody>
              {obatDetailItems.length === 0 ? (
                <tr><td colSpan={2} className="px-3 py-4 text-center text-muted-foreground text-xs">Tidak ada detail obat</td></tr>
              ) : (
                obatDetailItems.map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-1.5">{row.namaItem}</td>
                    <td className="px-3 py-1.5 text-center">{row.qty}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setObatDetailOpen(false)}>Tutup</Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  // ── Inline mode: render content directly (no Dialog wrapper) ────────────
  if (isInline) {
    return (
      <>
        {innerContent}
        {obatDetailDialog}
      </>
    );
  }

  // ── Dialog mode (default) ────────────────────────────────────────────────
  return (
    <>
      <Dialog open={isOpen} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <DollarSign className="w-5 h-5 text-emerald-600" />
              <span>Estimasi Biaya Rawat</span>
              <span className="font-normal text-sm text-muted-foreground">—</span>
              <span className="text-base font-semibold">{patient.namaPasien}</span>
              <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{patient.noRM}</span>
            </DialogTitle>
          </DialogHeader>
          {innerContent}
        </DialogContent>
      </Dialog>
      {obatDetailDialog}
    </>
  );
}

// ── Utility ──────────────────────────────────────────────────────────────────
function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
