import * as XLSX from 'xlsx';
import { MasterTarifItem, BillingRule, BillingCheckItem, BillingRuleResult, BillingOverallStatus, BillingItemStatus } from './db';
import { lookupHarga } from './estimasi';
import { evaluateRules, type BillingRowContext } from './billingRuleEngine';

// ── Billing Excel Parser ──────────────────────────────────────────────────────
// TrakCare billing format:
// ITM_Date | ARCIM_Code | ARCIM_Desc | ARCBG_Desc | CTLOC_Desc | ITM_DailyQty | ITM_LineTotal

export interface BillingRawItem {
  itemCode: string;
  namaItem: string;
  kategori: string;
  qty: number;
  totalBilling: number;
  hargaBilling: number; // unit price (totalBilling / qty)
}

export function parseBillingExcel(buffer: ArrayBuffer): BillingRawItem[] {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const rowMap = new Map<string, { namaItem: string; kategori: string; qty: number; total: number }>();

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!raw.length) continue;

    let hRow = -1;
    let colCode = -1, colDesc = -1, colCat = -1, colQty = -1, colTotal = -1;

    for (let r = 0; r < Math.min(10, raw.length); r++) {
      const row = raw[r] ?? [];
      for (let c = 0; c < row.length; c++) {
        const v = String(row[c] ?? '').trim().toUpperCase();
        if (v === 'ARCIM_CODE') colCode = c;
        if (v === 'ARCIM_DESC') colDesc = c;
        if (v === 'ARCBG_DESC') colCat = c;
        if (v === 'ITM_DAILYQTY') colQty = c;
        if (v === 'ITM_LINETOTAL') colTotal = c;
      }
      if (colDesc >= 0 && (colCode >= 0 || colQty >= 0)) { hRow = r; break; }
    }

    if (hRow < 0) continue;
    if (colQty < 0) colQty = 5;
    if (colTotal < 0) colTotal = 6;

    for (let r = hRow + 1; r < raw.length; r++) {
      const row = raw[r] ?? [];
      const code = String(row[colCode] ?? '').trim();
      const desc = String(row[colDesc] ?? '').trim();
      if (!desc) continue;

      const qRaw = row[colQty];
      const tRaw = row[colTotal];
      const qty = typeof qRaw === 'number' ? qRaw : parseFloat(String(qRaw ?? '').replace(/[^0-9.-]/g, '')) || 0;
      const total = typeof tRaw === 'number' ? tRaw : parseFloat(String(tRaw ?? '').replace(/[^0-9.-]/g, '')) || 0;

      const key = code || desc;
      if (!rowMap.has(key)) {
        rowMap.set(key, { namaItem: desc, kategori: String(row[colCat] ?? '').trim(), qty: 0, total: 0 });
      }
      const entry = rowMap.get(key)!;
      entry.qty += qty;
      entry.total += total;
    }
  }

  return Array.from(rowMap.entries()).map(([code, v]) => ({
    itemCode: code,
    namaItem: v.namaItem,
    kategori: v.kategori,
    qty: v.qty,
    totalBilling: v.total,
    hargaBilling: v.qty > 0 ? Math.round(v.total / v.qty) : 0,
  }));
}

// ── Item Checker ──────────────────────────────────────────────────────────────

export function checkBillingItems(
  rawItems: BillingRawItem[],
  masterItems: MasterTarifItem[],
  kelasTarif: string,
): BillingCheckItem[] {
  return rawItems.map(raw => {
    const lookup = lookupHarga(raw.namaItem, kelasTarif, masterItems);
    const hargaMaster = lookup.price;
    const hargaBilling = raw.hargaBilling;
    const selisih = hargaBilling - hargaMaster;

    let status: BillingItemStatus;
    if (lookup.status === 'unmapped') {
      status = 'tidak_ditemukan';
    } else if (hargaMaster === 0 || Math.abs(selisih) < 1) {
      status = 'sesuai';
    } else {
      status = 'selisih';
    }

    return {
      itemCode: raw.itemCode,
      namaItem: raw.namaItem,
      kategori: raw.kategori,
      qty: raw.qty,
      hargaBilling,
      totalBilling: raw.totalBilling,
      hargaMaster,
      selisih,
      totalSelisih: selisih * raw.qty,
      status,
      matchedMasterName: lookup.matchedName,
    };
  });
}

// ── Rule Engine ───────────────────────────────────────────────────────────────

export function runRuleEngine(
  items: BillingCheckItem[],
  rules: BillingRule[],
  penjamin: string,
  lamaRawat = 1,
  context: Partial<BillingRowContext> = {},
): BillingRuleResult[] {
  const results: BillingRuleResult[] = [];
  const allItemNames = items.map(item => item.namaItem);

  for (const item of items) {
    const row: BillingRowContext = {
      penjamin,
      kelas: context.kelas || '',
      kode: item.itemCode,
      namaItem: item.namaItem,
      kelompok: item.kategori,
      kategori: item.kategori,
      lokasi: context.lokasi || '',
      ruangan: context.ruangan || '',
      dokter: context.dokter || '',
      los: context.los ?? lamaRawat,
      hariKe: context.hariKe,
      hariPulang: context.hariPulang,
      diagnosa: context.diagnosa || '',
      jenisPelayanan: context.jenisPelayanan || '',
      episode: context.episode || '',
      qty: item.qty,
      hargaBilling: item.hargaBilling,
      hargaMaster: item.hargaMaster,
      selisih: item.selisih,
      nominal: item.totalBilling,
      otherItems: allItemNames.filter(name => name !== item.namaItem),
    };
    const evaluation = evaluateRules(rules, row);
    if (!evaluation.matches.length) continue;

    const expectedQty = evaluation.qtySeharusnya;
    const expectedTarif = evaluation.tarifSeharusnya;
    const primary = evaluation.matches[0];
    const qtyDiff = expectedQty === null ? null : item.qty - expectedQty;
    const tarifDiff = expectedTarif === null ? item.selisih : item.hargaBilling - expectedTarif;
    const hasMismatch = (qtyDiff !== null && Math.abs(qtyDiff) > 0) ||
      (tarifDiff !== null && Math.abs(tarifDiff) > 1);

    if (expectedQty !== null) item.qtySeharusnya = expectedQty;
    if (expectedTarif !== null) item.tarifSeharusnya = expectedTarif;
    item.ruleIds = evaluation.matches.map(match => match.ruleId);
    item.jenisPelanggaran = primary.jenisPelanggaran;
    item.pesanValidasi = primary.pesan;
    item.severity = primary.severity;
    if (hasMismatch && primary.aksi !== 'abaikan') {
      item.status = primary.severity === 'error' ? 'selisih' : item.status;
      item.selisih = tarifDiff ?? item.selisih;
      item.totalSelisih = item.selisih * item.qty;
    }

    for (const match of evaluation.matches) {
      const status: BillingRuleResult['status'] =
        match.severity === 'error' ? 'error' :
        match.severity === 'warning' ? 'warning' : 'ok';
      results.push({
        ruleId: match.ruleId,
        namaItem: item.namaItem,
        tipe: match.aksi,
        keterangan: match.pesan,
        status,
        detail: match.detail,
        qtyBilling: item.qty,
        qtySeharusnya: match.qtySeharusnya,
        tarifBilling: item.hargaBilling,
        tarifSeharusnya: match.tarifSeharusnya,
        selisih: match.selisih,
        jenisPelanggaran: match.jenisPelanggaran,
        severity: match.severity,
      });
    }
  }

  return results;
}

// ── Overall Status ────────────────────────────────────────────────────────────

export function calcOverallStatus(
  items: BillingCheckItem[],
  ruleResults: BillingRuleResult[],
): BillingOverallStatus {
  if (ruleResults.some(r => r.status === 'error')) return 'invalid';
  if (ruleResults.some(r => r.status === 'warning') || items.some(i => i.status !== 'sesuai')) return 'warning';
  return 'valid';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function calcLamaRawat(admissionDate: string, dischargeDate?: string | null): number {
  if (!admissionDate) return 1;
  try {
    const d1 = new Date(admissionDate);
    const d2 = dischargeDate ? new Date(dischargeDate) : new Date();
    return Math.max(1, Math.floor((d2.getTime() - d1.getTime()) / 86400000));
  } catch { return 1; }
}

export const fmtRpBilling = (n: number) =>
  'Rp\u00A0' + Math.abs(Math.round(n)).toLocaleString('id-ID');
