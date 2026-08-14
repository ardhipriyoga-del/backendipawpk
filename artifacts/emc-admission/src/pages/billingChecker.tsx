import React, { useState, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { formatDate } from '../lib/utils';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getDB } from '../lib/db';
import { evaluateRules, BillingRowContext, RuleMatchResult } from '../lib/billingRuleEngine';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle,
  XCircle, TrendingUp, Download, FileText, Search,
  RotateCcw, ChevronLeft, ChevronRight,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BillingRow {
  date: string;
  code: string;
  desc: string;
  category: string;
  location: string;
  qty: number;
  lineTotal: number;
  tarifBilling: number;    // LineTotal ÷ Qty
  tarifMaster: number | null;
  tarifSeharusnya?: number | null;
  qtySeharusnya?: number | null;
  selisih: number | null;
  status: 'Sesuai' | 'Selisih' | 'Tidak Ditemukan';
  ruleResult?: RuleMatchResult;  // first matching billing rule (if any)
}

type FilterStatus = 'Semua' | 'Sesuai' | 'Selisih' | 'Tidak Ditemukan';

const TOLERANCE = 1; // ±Rp 1 dianggap sama (pembulatan)
const PAGE_SIZE = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

const toRp = (n: number) =>
  'Rp ' + Math.round(n).toLocaleString('id-ID');

const toRpRaw = (n: number) =>
  Math.round(n).toLocaleString('id-ID');

function baseStatusBadge(status: BillingRow['status']) {
  if (status === 'Sesuai')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <CheckCircle2 className="w-3 h-3" /> Sesuai
      </span>
    );
  if (status === 'Selisih')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
        <AlertTriangle className="w-3 h-3" /> Selisih
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
      <XCircle className="w-3 h-3" /> Tidak Ditemukan
    </span>
  );
}

function statusBadge(row: BillingRow) {
  const base = baseStatusBadge(row.status);
  if (!row.ruleResult) return base;

  const { aksi, ruleName, pesan, warna } = row.ruleResult;
  const ruleLabel =
    aksi === 'lolos'         ? '✅ Lolos (Rule)' :
    aksi === 'warning'       ? '⚠️ Warning' :
    aksi === 'error'         ? '❌ Error (Rule)' :
    aksi === 'abaikan'       ? '🚫 Abaikan' :
    aksi === 'gunakan_master'? '📋 Gunakan Master' :
    pesan || ruleName;

  return (
    <div className="flex flex-col items-center gap-0.5">
      {aksi !== 'lolos' && aksi !== 'error' && aksi !== 'abaikan' && base}
      {aksi === 'lolos' && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="w-3 h-3" /> Sesuai (Rule)
        </span>
      )}
      {aksi === 'error' && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700">
          <XCircle className="w-3 h-3" /> Error (Rule)
        </span>
      )}
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
        style={{ background: warna }}
        title={`${ruleName}: ${pesan}`}
      >
        {ruleLabel}
      </span>
    </div>
  );
}

function rowBg(row: BillingRow) {
  if (row.ruleResult?.aksi === 'abaikan') return 'opacity-50 bg-gray-50/60 dark:bg-gray-900/20';
  if (row.ruleResult?.aksi === 'lolos')   return 'bg-emerald-50/40 dark:bg-emerald-950/20';
  if (row.ruleResult?.aksi === 'error')   return 'bg-red-50/40 dark:bg-red-950/20';
  if (row.ruleResult?.aksi === 'warning') return 'bg-amber-50/40 dark:bg-amber-950/20';
  if (row.status === 'Sesuai')   return 'bg-emerald-50/40 dark:bg-emerald-950/20';
  if (row.status === 'Selisih')  return 'bg-amber-50/40 dark:bg-amber-950/20';
  return 'bg-red-50/40 dark:bg-red-950/20';
}

// ── Build tarif lookup map from IndexedDB ─────────────────────────────────────
// Key: orderItemCode (ARCIM_Code), Value: lowest price among active tarifs
async function buildTarifMap(): Promise<Map<string, number>> {
  const db = await getDB();

  // 1. Find all active master tarif IDs
  const allTarifs = await db.getAll('masterTarifs');
  const activeIds = new Set(
    allTarifs.filter(t => t.status === 'aktif').map(t => t.id as number)
  );

  if (activeIds.size === 0) return new Map();

  // 2. Load all tarif items — build map: code → price
  const allItems = await db.getAll('masterTarifItems');
  const map = new Map<string, number>();

  for (const item of allItems) {
    if (!activeIds.has(item.masterTarifId)) continue;
    const code = item.orderItemCode?.trim();
    if (!code) continue;
    // If code appears in multiple tarifs, take the first / use Map (first-wins)
    if (!map.has(code)) {
      map.set(code, item.price ?? 0);
    }
  }

  return map;
}

// ── Parse uploaded billing Excel ──────────────────────────────────────────────
function parseBillingFile(
  data: ArrayBuffer,
  tarifMap: Map<string, number>
): BillingRow[] {
  const wb = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });

  const rows: BillingRow[] = [];

  for (const r of raw) {
    const code      = String(r['ARCIM_Code'] ?? '').trim();
    const desc      = String(r['ARCIM_Desc'] ?? '').trim();
    const category  = String(r['ARCBG_Desc'] ?? '').trim();
    const location  = String(r['CTLOC_Desc'] ?? '').trim();
    const qty       = Number(r['ITM_DailyQty']) || 1;
    const lineTotal = Number(r['ITM_LineTotal']) || 0;

    // Date: may come as a JS Date object or string/number
    let date = '';
    const rawDate = r['ITM_Date'];
    if (rawDate instanceof Date) {
      date = formatDate(rawDate);
    } else if (rawDate) {
      date = formatDate(String(rawDate));
    }

    if (!code && !desc) continue; // skip completely empty rows

    const tarifBilling = qty > 0 ? lineTotal / qty : lineTotal;
    const tarifMaster  = tarifMap.has(code) ? (tarifMap.get(code) ?? 0) : null;
    const selisih      = tarifMaster !== null ? tarifBilling - tarifMaster : null;

    let status: BillingRow['status'];
    if (tarifMaster === null) {
      status = 'Tidak Ditemukan';
    } else if (Math.abs(selisih!) <= TOLERANCE) {
      status = 'Sesuai';
    } else {
      status = 'Selisih';
    }

    rows.push({ date, code, desc, category, location, qty, lineTotal, tarifBilling, tarifMaster, selisih, status });
  }

  return rows;
}

// ── Export helpers ─────────────────────────────────────────────────────────────

function exportToExcel(rows: BillingRow[], filename = 'billing-checker') {
  const data = rows.map((r, i) => ({
    'No': i + 1,
    'Tanggal': r.date,
    'Kode': r.code,
    'Nama Tindakan': r.desc,
    'Kategori': r.category,
    'Lokasi': r.location,
    'Qty': r.qty,
    'Tarif Billing (Rp)': Math.round(r.tarifBilling),
    'Tarif Master (Rp)': r.tarifMaster !== null ? Math.round(r.tarifMaster) : '',
    'Selisih (Rp)': r.selisih !== null ? Math.round(r.selisih) : '',
    'Status': r.status,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  // Column widths
  ws['!cols'] = [4, 12, 14, 36, 22, 22, 6, 16, 16, 16, 16].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Billing Checker');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

function exportToPDF(rows: BillingRow[], summary: Summary, filename = 'billing-checker') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(14);
  doc.text('Billing Checker — Laporan Perbandingan Tarif', 14, 14);
  doc.setFontSize(9);
  doc.text(
    `Total: ${summary.total}  |  Sesuai: ${summary.sesuai}  |  Selisih: ${summary.selisih}  |  Tidak Ditemukan: ${summary.tidakDitemukan}  |  Total Selisih: Rp ${Math.round(summary.totalNominalSelisih).toLocaleString('id-ID')}`,
    14, 21
  );

  autoTable(doc, {
    startY: 26,
    head: [['#', 'Tgl', 'Kode', 'Nama Tindakan', 'Kategori', 'Lokasi', 'Qty', 'T.Billing', 'T.Master', 'Selisih', 'Status']],
    body: rows.map((r, i) => [
      i + 1,
      r.date,
      r.code,
      r.desc,
      r.category,
      r.location,
      r.qty,
      toRpRaw(r.tarifBilling),
      r.tarifMaster !== null ? toRpRaw(r.tarifMaster) : '-',
      r.selisih !== null ? toRpRaw(r.selisih) : '-',
      r.status,
    ]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [15, 118, 110], fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 18 },
      2: { cellWidth: 22 },
      3: { cellWidth: 52 },
      4: { cellWidth: 28 },
      5: { cellWidth: 28 },
      6: { cellWidth: 10 },
      7: { cellWidth: 22 },
      8: { cellWidth: 22 },
      9: { cellWidth: 22 },
      10: { cellWidth: 24 },
    },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 10) {
        const v = data.cell.raw as string;
        if (v === 'Sesuai')           data.cell.styles.textColor = [5, 150, 105];
        else if (v === 'Selisih')     data.cell.styles.textColor = [217, 119, 6];
        else                          data.cell.styles.textColor = [220, 38, 38];
      }
    },
  });

  doc.save(`${filename}.pdf`);
}

// ── Summary type ──────────────────────────────────────────────────────────────
interface Summary {
  total: number;
  sesuai: number;
  selisih: number;
  tidakDitemukan: number;
  totalNominalSelisih: number;
}

function calcSummary(rows: BillingRow[]): Summary {
  let sesuai = 0, selisih = 0, tidakDitemukan = 0, totalNominalSelisih = 0;
  for (const r of rows) {
    if (r.status === 'Sesuai') sesuai++;
    else if (r.status === 'Selisih') { selisih++; totalNominalSelisih += Math.abs(r.selisih ?? 0); }
    else tidakDitemukan++;
  }
  return { total: rows.length, sesuai, selisih, tidakDitemukan, totalNominalSelisih };
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function BillingCheckerPage() {
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('Semua');
  const [search, setSearch] = useState('');
  const [penjamin, setPenjamin] = useState('');
  const [los, setLos] = useState(1);
  const [page, setPage] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const summary = useMemo(() => calcSummary(rows), [rows]);

  const filtered = useMemo(() => {
    let result = rows;
    if (filter !== 'Semua') result = result.filter(r => r.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        r => r.code.toLowerCase().includes(q) ||
             r.desc.toLowerCase().includes(q) ||
             r.category.toLowerCase().includes(q) ||
             r.location.toLowerCase().includes(q)
      );
    }
    return result;
  }, [rows, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  // Reset to page 1 when filter/search changes
  const setFilterReset = (f: FilterStatus) => { setFilter(f); setPage(1); };
  const setSearchReset = (s: string)       => { setSearch(s); setPage(1); };

  const processFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast.error('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv');
      return;
    }
    setLoading(true);
    setRows([]);
    setFileName(file.name);
    setFilter('Semua');
    setSearch('');
    setPage(1);
    try {
      const [buffer, tarifMap, db] = await Promise.all([
        file.arrayBuffer(),
        buildTarifMap(),
        getDB(),
      ]);

      if (tarifMap.size === 0) {
        toast.warning('Tidak ada Master Tarif aktif. Semua item akan ditandai Tidak Ditemukan.');
      }

      const parsed = parseBillingFile(buffer, tarifMap);

      // Apply active billing rules to each row
      const allRules = await db.getAll('billingRules');
      const activeRules = allRules.filter(r => r.aktif);
      const result: BillingRow[] = parsed.map(row => {
        if (activeRules.length === 0) return row;
        const ctx: BillingRowContext = {
          // Standalone checker has no patient episode; these values are
          // explicitly supplied in the page header instead of being hidden.
          // This keeps payer-specific rules deterministic.
          penjamin:    penjamin,
          kelas:       '',
          kode:        row.code,
          namaItem:    row.desc,
          kelompok:    row.category,
          lokasi:      row.location,
          qty:         row.qty,
          hargaBilling:row.tarifBilling,
          hargaMaster: row.tarifMaster,
          selisih:     row.selisih,
          los,
          hariKe: los,
        };
        const evaluation = evaluateRules(activeRules, ctx);
        const ruleResult = evaluation.matches[0];
        return {
          ...row,
          ruleResult,
          qtySeharusnya: evaluation.qtySeharusnya,
          tarifSeharusnya: evaluation.tarifSeharusnya,
        };
      });
      setRows(result);

      if (result.length === 0) {
        toast.error('Tidak ada data yang dapat dibaca dari file ini. Pastikan format kolom sesuai.');
      } else {
        toast.success(`${result.length.toLocaleString('id-ID')} baris berhasil diproses.`);
      }
    } catch (err: any) {
      toast.error('Gagal membaca file: ' + (err?.message ?? 'Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [penjamin, los]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const reset = () => {
    setRows([]); setFileName(''); setFilter('Semua'); setSearch(''); setPage(1);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing Checker</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Bandingkan tarif billing TrakCare dengan Master Tarif yang aktif.
          </p>
        </div>
        {rows.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => exportToExcel(filtered)} className="gap-1.5">
              <FileSpreadsheet className="w-4 h-4" /> Export Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportToPDF(filtered, summary)} className="gap-1.5">
              <FileText className="w-4 h-4" /> Export PDF
            </Button>
            <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5 text-muted-foreground">
              <RotateCcw className="w-4 h-4" /> Reset
            </Button>
          </div>
        )}
      </div>

      {/* Upload zone */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[220px]">
            <label className="text-xs font-semibold">Penjamin untuk pemeriksaan</label>
            <Input value={penjamin} onChange={e => setPenjamin(e.target.value)} placeholder="Contoh: BPJS Kesehatan" className="h-9 text-sm" />
          </div>
          <div className="space-y-1 w-32">
            <label className="text-xs font-semibold">LOS / hari</label>
            <Input type="number" min={1} value={los} onChange={e => setLos(Math.max(1, Number(e.target.value) || 1))} className="h-9 text-sm" />
          </div>
          <p className="text-xs text-muted-foreground pb-2">Konteks ini dipakai oleh rule berbasis penjamin, LOS, dan hari ke.</p>
        </CardContent>
      </Card>

      {rows.length === 0 && (
        <div
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => !loading && fileInputRef.current?.click()}
          className={`
            border-2 border-dashed rounded-2xl p-12 text-center transition-colors cursor-pointer
            ${loading
              ? 'border-primary/40 bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-muted/40'}
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={onFileChange}
          />
          {loading ? (
            <div className="space-y-3">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-muted-foreground">Memproses file <span className="font-medium">{fileName}</span>…</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <Upload className="w-7 h-7 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-base">Unggah File Billing TrakCare</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Drag &amp; drop, atau klik untuk memilih file
                </p>
                <p className="text-xs text-muted-foreground mt-1">Format: .xlsx · .xls · .csv</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {rows.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Card className="border-border">
              <CardContent className="py-3 px-4">
                <p className="text-xs text-muted-foreground">Total Item</p>
                <p className="text-2xl font-bold">{summary.total.toLocaleString('id-ID')}</p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{fileName}</p>
              </CardContent>
            </Card>
            <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
              <CardContent className="py-3 px-4">
                <p className="text-xs text-emerald-600 dark:text-emerald-400">Sesuai</p>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{summary.sesuai.toLocaleString('id-ID')}</p>
                <p className="text-xs text-emerald-600/70 mt-0.5">
                  {summary.total > 0 ? Math.round(summary.sesuai / summary.total * 100) : 0}%
                </p>
              </CardContent>
            </Card>
            <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
              <CardContent className="py-3 px-4">
                <p className="text-xs text-amber-600 dark:text-amber-400">Selisih</p>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{summary.selisih.toLocaleString('id-ID')}</p>
                <p className="text-xs text-amber-600/70 mt-0.5">
                  {summary.total > 0 ? Math.round(summary.selisih / summary.total * 100) : 0}%
                </p>
              </CardContent>
            </Card>
            <Card className="border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20">
              <CardContent className="py-3 px-4">
                <p className="text-xs text-red-600 dark:text-red-400">Tidak Ditemukan</p>
                <p className="text-2xl font-bold text-red-700 dark:text-red-300">{summary.tidakDitemukan.toLocaleString('id-ID')}</p>
                <p className="text-xs text-red-600/70 mt-0.5">
                  {summary.total > 0 ? Math.round(summary.tidakDitemukan / summary.total * 100) : 0}%
                </p>
              </CardContent>
            </Card>
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 col-span-2 sm:col-span-1">
              <CardContent className="py-3 px-4">
                <p className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Total Selisih
                </p>
                <p className="text-lg font-bold text-blue-700 dark:text-blue-300 leading-tight mt-0.5">
                  {toRp(summary.totalNominalSelisih)}
                </p>
                <p className="text-xs text-blue-600/70 mt-0.5">akumulasi absolut</p>
              </CardContent>
            </Card>
          </div>

          {/* Filter + search */}
          <div className="flex gap-2 flex-wrap items-center">
            {(['Semua', 'Sesuai', 'Selisih', 'Tidak Ditemukan'] as FilterStatus[]).map(f => (
              <button
                key={f}
                onClick={() => setFilterReset(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                  filter === f
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                }`}
              >
                {f}
                {f !== 'Semua' && (
                  <span className="ml-1.5 opacity-70">
                    ({f === 'Sesuai' ? summary.sesuai : f === 'Selisih' ? summary.selisih : summary.tidakDitemukan})
                  </span>
                )}
              </button>
            ))}
            <div className="relative flex-1 min-w-[200px] max-w-xs ml-auto">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Cari kode, nama, kategori..."
                value={search}
                onChange={e => setSearchReset(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
          </div>

          {/* Table */}
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/60 border-b border-border">
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">Tanggal</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">Kode</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground min-w-[200px]">Nama Tindakan</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">Kategori</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">Lokasi</th>
                    <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Qty / Acuan</th>
                    <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">Tarif Billing</th>
                    <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap">Tarif Acuan</th>
                    <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Selisih</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginated.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center py-12 text-muted-foreground">
                        Tidak ada data yang cocok dengan filter saat ini.
                      </td>
                    </tr>
                  ) : (
                    paginated.map((r, i) => (
                        <tr key={i} className={`${rowBg(r)} hover:brightness-95 transition-all`}>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{r.date}</td>
                        <td className="px-3 py-2 font-mono font-medium whitespace-nowrap">{r.code}</td>
                        <td className="px-3 py-2">{r.desc}</td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.category}</td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.location}</td>
                        <td className="px-3 py-2 text-right">
                          {r.qty}
                          {r.qtySeharusnya !== null && r.qtySeharusnya !== undefined && (
                            <span className="block text-[10px] text-muted-foreground">/ {r.qtySeharusnya}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{toRp(r.tarifBilling)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {r.tarifSeharusnya !== null && r.tarifSeharusnya !== undefined
                            ? toRp(r.tarifSeharusnya)
                            : r.tarifMaster !== null ? toRp(r.tarifMaster) : <span className="text-red-500">—</span>}
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold tabular-nums ${
                          r.selisih === null ? 'text-muted-foreground' :
                          r.selisih > TOLERANCE ? 'text-amber-600 dark:text-amber-400' :
                          r.selisih < -TOLERANCE ? 'text-blue-600 dark:text-blue-400' : ''
                        }`}>
                          {r.selisih !== null
                            ? (r.selisih >= 0 ? '+' : '') + toRpRaw(r.selisih)
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">{statusBadge(r)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/30">
                <p className="text-xs text-muted-foreground">
                  Menampilkan {((page - 1) * PAGE_SIZE + 1).toLocaleString('id-ID')}–{Math.min(page * PAGE_SIZE, filtered.length).toLocaleString('id-ID')} dari {filtered.length.toLocaleString('id-ID')} baris
                </p>
                <div className="flex gap-1">
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      // Show pages around current
                      let p: number;
                      if (totalPages <= 7) p = i + 1;
                      else if (page <= 4) p = i + 1;
                      else if (page >= totalPages - 3) p = totalPages - 6 + i;
                      else p = page - 3 + i;
                      if (p < 1 || p > totalPages) return null;
                      return (
                        <button
                          key={p}
                          onClick={() => setPage(p)}
                          className={`h-7 min-w-[28px] px-1 rounded text-xs font-medium transition-colors ${
                            p === page ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
                          }`}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* File info footer */}
          <p className="text-xs text-muted-foreground text-center">
            File: <span className="font-medium">{fileName}</span> · {rows.length.toLocaleString('id-ID')} total baris · Ditampilkan: {filtered.length.toLocaleString('id-ID')} baris
            {filter !== 'Semua' || search ? ' (filter aktif)' : ''}
          </p>
        </>
      )}
    </div>
  );
}
