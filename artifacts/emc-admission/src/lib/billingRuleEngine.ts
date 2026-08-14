/**
 * Data-driven Billing Rule Engine.
 *
 * The evaluator deliberately does not use eval/new Function. Formulas are
 * tokenized and calculated from a small, documented set of billing variables.
 * Older v2 rules remain valid through the legacy conditions/logicType fields.
 */

import {
  BillingRule,
  RuleAction,
  RuleCondition,
  RuleField,
  RuleSeverity,
} from './db';

export interface BillingRowContext {
  penjamin: string;
  kelas: string;
  kode: string;
  namaItem: string;
  kelompok: string;
  kategori?: string;
  lokasi: string;
  ruangan?: string;
  dokter?: string;
  los?: number;
  hariKe?: number;
  hariPulang?: boolean;
  diagnosa?: string;
  jenisPelayanan?: string;
  episode?: string;
  qty: number;
  hargaBilling: number;
  hargaMaster: number | null;
  selisih: number | null;
  nominal?: number;
  otherItems?: string[];
}

export interface RuleMatchResult {
  ruleId: number;
  ruleName: string;
  aksi: BillingRule['aksi'];
  pesan: string;
  warna: string;
  detail: string;
  severity: RuleSeverity;
  qtySeharusnya?: number | null;
  tarifSeharusnya?: number | null;
  selisih?: number | null;
  jenisPelanggaran?: string;
}

export interface RuleEvaluation {
  matches: RuleMatchResult[];
  qtySeharusnya: number | null;
  tarifSeharusnya: number | null;
  ignored: boolean;
}

export const NUMERIC_FIELDS: RuleField[] = [
  'qty', 'los', 'hari_ke', 'tarif', 'harga_billing', 'harga_master', 'nominal', 'selisih',
];

const TEXT_FIELDS: RuleField[] = [
  'penjamin', 'nama_item', 'kode_tarif', 'kategori_item', 'kelompok', 'dokter',
  'kelas', 'ruangan', 'lokasi', 'hari_pulang', 'diagnosa', 'jenis_pelayanan',
  'episode', 'ada_item_lain',
];

function normalize(value: unknown): string {
  return String(value ?? '').toLowerCase().trim();
}

function getFieldValue(field: RuleField, row: BillingRowContext): string | number | boolean | null {
  switch (field) {
    case 'penjamin': return row.penjamin;
    case 'nama_item': return row.namaItem;
    case 'kode_tarif': return row.kode;
    case 'kategori_item':
    case 'kelompok': return row.kategori || row.kelompok;
    case 'dokter': return row.dokter || '';
    case 'kelas': return row.kelas;
    case 'ruangan':
    case 'lokasi': return row.ruangan || row.lokasi;
    case 'los': return row.los ?? null;
    case 'hari_ke': return row.hariKe ?? null;
    case 'hari_pulang': return row.hariPulang ?? false;
    case 'diagnosa': return row.diagnosa || '';
    case 'jenis_pelayanan': return row.jenisPelayanan || '';
    case 'episode': return row.episode || '';
    case 'qty': return row.qty;
    case 'tarif':
    case 'harga_billing': return row.hargaBilling;
    case 'harga_master': return row.hargaMaster;
    case 'nominal': return row.nominal ?? row.hargaBilling * row.qty;
    case 'selisih': return row.selisih;
    case 'ada_item_lain': return (row.otherItems || []).join(', ');
    default: return '';
  }
}

function asList(value: string): string[] {
  return value.split(/[,\n;|]/).map(v => normalize(v)).filter(Boolean);
}

function evalCondition(cond: RuleCondition, row: BillingRowContext): boolean {
  const raw = getFieldValue(cond.field, row);
  const rawText = normalize(raw);
  const targetText = normalize(cond.value);
  const numeric = Number(raw);
  const targetNumeric = Number(cond.value);
  const list = asList(cond.value);

  if (cond.field === 'hari_pulang' && ['eq', 'neq'].includes(cond.operator)) {
    const target = ['true', 'ya', 'yes', '1'].includes(targetText);
    return cond.operator === 'eq' ? Boolean(raw) === target : Boolean(raw) !== target;
  }

  switch (cond.operator) {
    case 'eq': return NUMERIC_FIELDS.includes(cond.field) && !Number.isNaN(numeric) && !Number.isNaN(targetNumeric)
      ? numeric === targetNumeric : rawText === targetText;
    case 'neq': return NUMERIC_FIELDS.includes(cond.field) && !Number.isNaN(numeric) && !Number.isNaN(targetNumeric)
      ? numeric !== targetNumeric : rawText !== targetText;
    case 'gt': return !Number.isNaN(numeric) && !Number.isNaN(targetNumeric) && numeric > targetNumeric;
    case 'gte': return !Number.isNaN(numeric) && !Number.isNaN(targetNumeric) && numeric >= targetNumeric;
    case 'lt': return !Number.isNaN(numeric) && !Number.isNaN(targetNumeric) && numeric < targetNumeric;
    case 'lte': return !Number.isNaN(numeric) && !Number.isNaN(targetNumeric) && numeric <= targetNumeric;
    case 'contains': return rawText.includes(targetText);
    case 'not_contains': return !rawText.includes(targetText);
    case 'in': return list.includes(rawText);
    case 'not_in': return !list.includes(rawText);
    case 'empty': return raw === null || raw === undefined || rawText === '';
    case 'not_empty': return raw !== null && raw !== undefined && rawText !== '';
    default: return false;
  }
}

function evaluateConditions(rule: BillingRule, row: BillingRowContext): boolean {
  const groups = rule.conditionGroups?.filter(g => g.conditions?.length) || [];
  if (groups.length) {
    const results = groups.map(group =>
      group.logic === 'OR'
        ? group.conditions.some(c => evalCondition(c, row))
        : group.conditions.every(c => evalCondition(c, row)),
    );
    return (rule.groupsLogic || 'AND') === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }

  const conditions = rule.conditions || [];
  if (!conditions.length) return false;
  return rule.logicType === 'OR'
    ? conditions.some(c => evalCondition(c, row))
    : conditions.every(c => evalCondition(c, row));
}

function isWithinEffectivePeriod(rule: BillingRule, now = new Date()): boolean {
  const current = now.toISOString().slice(0, 10);
  if (rule.effectiveDate && current < rule.effectiveDate) return false;
  if (rule.expiredDate && current > rule.expiredDate) return false;
  return true;
}

function ruleTargetsRow(rule: BillingRule, row: BillingRowContext): boolean {
  if (rule.penjamin && normalize(rule.penjamin) !== normalize(row.penjamin)) return false;
  if (rule.berlakuUntuk?.length) {
    const item = normalize(row.namaItem);
    const code = normalize(row.kode);
    if (!rule.berlakuUntuk.some(target => normalize(target) === item || normalize(target) === code)) return false;
  }
  return true;
}

export function evalRule(rule: BillingRule, row: BillingRowContext): boolean {
  return Boolean(
    rule.aktif &&
    isWithinEffectivePeriod(rule) &&
    ruleTargetsRow(rule, row) &&
    evaluateConditions(rule, row),
  );
}

function severityFor(rule: BillingRule): RuleSeverity {
  if (rule.severity) return rule.severity;
  if (rule.aksi === 'error' || rule.aksi === 'tandai_tidak_valid') return 'error';
  if (rule.aksi === 'warning') return 'warning';
  return 'info';
}

function actionFor(rule: BillingRule): RuleAction {
  if (rule.aksi) return rule.aksi;
  return 'info';
}

function numericConfig(rule: BillingRule): number | null {
  const raw = rule.actionConfig?.value ?? rule.actionConfig?.tarifKhusus;
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Supports Master, Qty, LOS, Tarif, HargaBilling, HargaMaster and Nominal.
 * Operators are evaluated left-to-right with * and / before + and -.
 */
export function evaluateFormula(formula: string, row: BillingRowContext): number | null {
  if (!formula?.trim()) return null;
  const variables: Record<string, number> = {
    master: row.hargaMaster ?? 0,
    harga_master: row.hargaMaster ?? 0,
    billing: row.hargaBilling,
    harga_billing: row.hargaBilling,
    tarif: row.hargaBilling,
    qty: row.qty,
    los: row.los ?? 1,
    nominal: row.nominal ?? row.hargaBilling * row.qty,
  };
  let expression = formula.toLowerCase()
    .replace(/master\s*([+−-])\s*(\d+(?:[.,]\d+)?)\s*%/g, (_, op, pct) =>
      `${variables.master}${op === '−' ? '-' : op}${variables.master}*${Number(String(pct).replace(',', '.')) / 100}`,
    )
    .replace(/master\s*[×x]\s*/g, 'master*')
    .replace(/([a-z_]+)\s*([×x])\s*/g, '$1*')
    .replace(/\b(master|harga_master|billing|harga_billing|tarif|qty|los|nominal)\b/g, name => String(variables[name]));
  expression = expression.replace(/,/g, '.').replace(/[^0-9+\-*/().\s]/g, '');
  const matchedTokens = expression.match(/(?:\d+(?:\.\d+)?|[()+\-*/])/g);
  if (!matchedTokens || matchedTokens.join('') !== expression.replace(/\s/g, '')) return null;

  let values: string[] = [...matchedTokens];
  const reduce = (ops: string[]) => {
    const next: string[] = [];
    for (let i = 0; i < values.length; i++) {
      if (ops.includes(values[i])) {
        const operator = values[i];
        const left = Number(next.pop());
        const right = Number(values[++i]);
        if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
        if (operator === '/' && right === 0) return false;
        const result = operator === '*' ? left * right : left / right;
        next.push(String(result));
      } else next.push(values[i]);
    }
    values = next;
    return true;
  };
  while (values.includes('(')) {
    const close = values.indexOf(')');
    const open = close >= 0 ? values.slice(0, close).lastIndexOf('(') : -1;
    if (open < 0 || close < 0) return null;
    values = values.slice(0, open).concat(String(evaluateSimple(values.slice(open + 1, close))), values.slice(close + 1));
  }
  if (!reduce(['*', '/'])) return null;
  return evaluateSimple(values);
}

function evaluateSimple(values: string[]): number {
  let result = Number(values[0]);
  for (let i = 1; i < values.length; i += 2) {
    const value = Number(values[i + 1]);
    if (values[i] === '+') result += value;
    else if (values[i] === '-') result -= value;
  }
  return result;
}

function expectedValues(rule: BillingRule, row: BillingRowContext): { qty: number | null; tarif: number | null } {
  const action = actionFor(rule);
  const configured = numericConfig(rule);
  const type = rule.jenisRule;
  if (type === 'qty_tetap') return { qty: configured, tarif: null };
  if (type === 'qty_berdasarkan_los' || type === 'qty_per_hari') return { qty: row.los ?? 1, tarif: null };
  if (type === 'qty_maksimal_berdasarkan_los') return { qty: Math.min(row.qty, row.los ?? 1), tarif: null };
  if (type === 'maksimal_qty') return { qty: configured, tarif: null };
  if (type === 'minimal_qty') return { qty: configured, tarif: null };
  if (type === 'tarif_sesuai_master') return { qty: null, tarif: row.hargaMaster };
  if (type === 'tarif_master_persentase_plus') return { qty: null, tarif: (row.hargaMaster ?? 0) * (1 + (configured ?? 0) / 100) };
  if (type === 'tarif_master_persentase_minus') return { qty: null, tarif: (row.hargaMaster ?? 0) * (1 - (configured ?? 0) / 100) };
  if (type === 'tarif_tetap' || type === 'wajib_tarif_tertentu') return { qty: null, tarif: configured };
  if (type === 'tarif_formula' || type === 'custom_formula' || action === 'formula') {
    return { qty: null, tarif: evaluateFormula(rule.actionConfig?.formula || '', row) };
  }
  if (action === 'gunakan_master' || action === 'gunakan_tarif_master') return { qty: null, tarif: row.hargaMaster };
  if (action === 'ubah_qty_acuan') return { qty: configured, tarif: null };
  if (action === 'ubah_harga_acuan' || action === 'ubah_tarif_acuan') return { qty: null, tarif: configured };
  return { qty: null, tarif: null };
}

function conditionSummary(rule: BillingRule): string {
  const groups = rule.conditionGroups?.length
    ? rule.conditionGroups.flatMap(g => g.conditions)
    : rule.conditions || [];
  const logic = rule.groupsLogic || rule.logicType || 'AND';
  return groups.map(c => `${c.field} ${c.operator} "${c.value}"`).join(` ${logic} `);
}

export function evaluateRules(rules: BillingRule[], row: BillingRowContext): RuleEvaluation {
  const matches: RuleMatchResult[] = [];
  let qtySeharusnya: number | null = null;
  let tarifSeharusnya: number | null = null;
  let ignored = false;

  const active = [...rules]
    .filter(r => r.aktif && isWithinEffectivePeriod(r) && ruleTargetsRow(r, row))
    .sort((a, b) => a.prioritas - b.prioritas);

  for (const rule of active) {
    if (!evaluateConditions(rule, row)) continue;
    const action = actionFor(rule);
    const expected = expectedValues(rule, row);
    // Rules are ordered by ascending priority. The first rule that supplies
    // an expected value wins; later rules remain visible as diagnostics but
    // cannot silently override the higher-priority reference.
    if (expected.qty !== null && qtySeharusnya === null) qtySeharusnya = expected.qty;
    if (expected.tarif !== null && tarifSeharusnya === null) tarifSeharusnya = expected.tarif;
    if (action === 'abaikan') ignored = true;
    const severity = severityFor(rule);
    const status = severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'ok';
    matches.push({
      ruleId: rule.id!,
      ruleName: rule.nama,
      aksi: action,
      pesan: rule.pesan || rule.deskripsi || rule.nama,
      warna: rule.warna || '#6366f1',
      severity,
      qtySeharusnya: expected.qty,
      tarifSeharusnya: expected.tarif,
      selisih: expected.tarif === null ? null : row.hargaBilling - expected.tarif,
      jenisPelanggaran: rule.jenisRule || action,
      detail: `IF ${conditionSummary(rule)} THEN ${rule.jenisRule || action}`,
      ...(status ? { } : {}),
    });
  }
  return { matches, qtySeharusnya, tarifSeharusnya, ignored };
}

/** Backwards-compatible first match helper used by the standalone checker. */
export function applyRules(rules: BillingRule[], row: BillingRowContext): RuleMatchResult | null {
  return evaluateRules(rules, row).matches[0] || null;
}