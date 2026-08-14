import * as XLSX from 'xlsx';
import { MasterTarifItem } from './db';

// ── Smart Matching ────────────────────────────────────────────────────────────

function normStr(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeMasterTarifClass(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = cur;
    }
  }
  return dp[n];
}

export type MatchStatus = 'exact' | 'alias' | 'fuzzy' | 'unmapped' | 'manual';

export interface LookupResult {
  price: number;
  status: MatchStatus;
  matchedName: string;
  masterTarifItemId?: number;
}

export function lookupHarga(
  namaItem: string,
  kelasTarif: string,
  items: MasterTarifItem[],
  penjamin?: string,
): LookupResult {
  const selectedClass = normalizeMasterTarifClass(kelasTarif);
  const byKelas = items.filter(i => normalizeMasterTarifClass(i.kelasTarif) === selectedClass);
  if (!byKelas.length) return { price: 0, status: 'unmapped', matchedName: namaItem };

  // Some Master Tarif files carry the payer/product family in Hospitals or
  // Jenistarif while older files only carry the class. Prefer payer-matching
  // rows when that metadata is present, but retain class-only compatibility.
  const payer = (penjamin ?? '').trim().toLowerCase();
  const payerMatched = payer
    ? byKelas.filter(i =>
        [i.hospitals, i.jenisTarif]
          .filter(Boolean)
          .some(value => value.toLowerCase().includes(payer) || payer.includes(value.toLowerCase()))
      )
    : [];
  const scoped = payerMatched.length > 0 ? payerMatched : byKelas;

  const trimmed = namaItem.trim();

  // 1. Exact (case-insensitive)
  const exact = scoped.find(i => i.orderItem.trim().toLowerCase() === trimmed.toLowerCase());
  if (exact) return { price: exact.price, status: 'exact', matchedName: exact.orderItem, masterTarifItemId: exact.id };

  // 2. Contains / partial (alias)
  const qNorm = normStr(trimmed);
  const partial = scoped.find(i => {
    const iNorm = normStr(i.orderItem);
    return (iNorm.length >= 3 && qNorm.includes(iNorm)) || (qNorm.length >= 3 && iNorm.includes(qNorm));
  });
  if (partial) return { price: partial.price, status: 'alias', matchedName: partial.orderItem, masterTarifItemId: partial.id };

  // 3. Fuzzy (Levenshtein ≤ 35% of max length)
  let best: MasterTarifItem | null = null;
  let bestD = Infinity;
  for (const item of scoped) {
    const iNorm = normStr(item.orderItem);
    const d = levenshtein(qNorm, iNorm);
    const threshold = Math.max(qNorm.length, iNorm.length) * 0.35;
    if (d <= threshold && d < bestD) { best = item; bestD = d; }
  }
  if (best) return { price: best.price, status: 'fuzzy', matchedName: best.orderItem, masterTarifItemId: best.id };

  return { price: 0, status: 'unmapped', matchedName: trimmed };
}

// ── CP Excel Parser ───────────────────────────────────────────────────────────

export interface CPRow {
  kategori: string;
  namaItem: string;
  qty: number;
}

const KETER_KEYWORDS = ['keterangan', 'uraian', 'nama item', 'item', 'tindakan'];
const JMLH_KEYWORDS  = ['jumlah', 'qty', 'jml'];

// Items whose names should be skipped (auto-handled as admin/materai)
const SKIP_ITEM_PATTERN = /administrasi|materai|\badmin\b/i;
// Category/section headers that look like summary rows — don't use as category label, skip items under them
const SKIP_SECTION_PATTERN = /total\s+biaya|^total$|grand\s+total/i;

export function parseCPExcel(buffer: ArrayBuffer): CPRow[] {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!raw.length) return [];

  // Merge map: fill merged cells with their top-left value
  const mv: Record<string, any> = {};
  for (const m of (ws['!merges'] ?? [])) {
    const tl = ws[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })];
    const v = tl?.v ?? '';
    for (let r = m.s.r; r <= m.e.r; r++)
      for (let c = m.s.c; c <= m.e.c; c++)
        if (r !== m.s.r || c !== m.s.c) mv[`${r}_${c}`] = v;
  }
  const cell = (r: number, c: number) => mv[`${r}_${c}`] ?? raw[r]?.[c] ?? '';

  // Find header row
  let hRow = -1, kCol = -1, qCol = -1;
  for (let r = 0; r < Math.min(40, raw.length); r++) {
    for (let c = 0; c < (raw[r]?.length ?? 0); c++) {
      const v = String(cell(r, c)).trim().toLowerCase();
      if (KETER_KEYWORDS.includes(v)) { hRow = r; kCol = c; break; }
    }
    if (hRow === r) {
      for (let c = 0; c < (raw[r]?.length ?? 0); c++) {
        if (JMLH_KEYWORDS.includes(String(cell(r, c)).trim().toLowerCase())) { qCol = c; break; }
      }
      // Check next row for split headers
      if (qCol < 0 && hRow + 1 < raw.length) {
        for (let c = 0; c < (raw[hRow + 1]?.length ?? 0); c++) {
          if (JMLH_KEYWORDS.includes(String(cell(hRow + 1, c)).trim().toLowerCase())) { qCol = c; break; }
        }
      }
      break;
    }
  }
  if (hRow < 0 || kCol < 0) return [];
  if (qCol < 0) qCol = kCol + 1;

  const results: CPRow[] = [];
  let kat = '';

  for (let r = hRow + 1; r < raw.length; r++) {
    const keter = String(cell(r, kCol)).trim();
    if (!keter) continue;

    const qRaw = cell(r, qCol);
    const qStr  = String(qRaw ?? '').trim();
    const qty   = !qStr ? 0 : typeof qRaw === 'number' ? qRaw : parseFloat(qStr.replace(/[^0-9.]/g, '')) || 0;

    if (qty <= 0) {
      // Don't set summary/total rows as a category label
      if (!SKIP_SECTION_PATTERN.test(keter)) kat = keter;
      continue;
    }

    if (SKIP_ITEM_PATTERN.test(keter)) continue;
    // Skip items whose current category is a summary section
    if (SKIP_SECTION_PATTERN.test(kat)) continue;

    results.push({ kategori: kat, namaItem: keter, qty });
  }

  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export const OBAT_KEYWORDS = ['obat', 'farmasi', 'drug', 'apotik', 'apotek'];

export function isObatKategori(k: string): boolean {
  const n = k.toLowerCase();
  return OBAT_KEYWORDS.some(w => n.includes(w));
}

export const fmtRp = (n: number) =>
  'Rp' + Math.round(n).toLocaleString('id-ID');

export const ADMIN_RATE = 0.06;
export const ADMIN_MAX  = 4_000_000;
export const MATERAI_DEFAULT = 10_000;

export function calcAdmin(total: number, override: number | null): number {
  if (override !== null) return override;
  return Math.min(total * ADMIN_RATE, ADMIN_MAX);
}
