/**
 * Billing Rule Settings
 * Full CRUD + Rule Builder for billing validation rules.
 */

import React, { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  getDB, BillingRule, RuleCondition, RuleField, RuleOperator, RuleAction, RuleLogic,
  RuleSeverity, RuleType, RuleConditionGroup,
} from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { writeLog } from '../lib/writeLog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, Copy, Download, Upload, Search,
  ChevronUp, ChevronDown, ToggleLeft, ToggleRight, X, CheckCircle2,
  AlertTriangle, XCircle, EyeOff, Database, MessageSquare, ArrowUpDown,
  SlidersHorizontal,
} from 'lucide-react';

// ── Constants ──────────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<RuleField, string> = {
  penjamin:     'Penjamin',
  nama_item:    'Nama Item',
  kategori_item:'Kategori Item',
  kelas:        'Kelas Perawatan',
  kode_tarif:   'Kode Tarif',
  kelompok:     'Kelompok Tarif',
  dokter:       'Dokter',
  ruangan:      'Ruangan',
  lokasi:       'Ruangan / Lokasi',
  los:          'Lama Rawat (LOS)',
  hari_ke:      'Hari Ke',
  hari_pulang:  'Hari Pulang',
  diagnosa:     'Diagnosa',
  jenis_pelayanan: 'Jenis Pelayanan',
  episode:      'Episode',
  qty:          'Qty',
  tarif:        'Tarif',
  harga_billing:'Harga Billing',
  harga_master: 'Harga Master',
  nominal:      'Nominal',
  selisih:      'Selisih',
  ada_item_lain:'Ada/Tidak Item Lain',
};

const NUMERIC_FIELDS: RuleField[] = ['qty', 'los', 'hari_ke', 'tarif', 'harga_billing', 'harga_master', 'nominal', 'selisih'];

const OPERATOR_LABELS: Record<RuleOperator, string> = {
  eq:          '= Sama dengan',
  neq:         '≠ Tidak sama dengan',
  gt:          '> Lebih besar dari',
  gte:         '≥ Lebih besar/sama',
  lt:          '< Lebih kecil dari',
  lte:         '≤ Lebih kecil/sama',
  contains:    'Mengandung',
  not_contains:'Tidak mengandung',
  in:          'Dalam daftar',
  not_in:      'Tidak dalam daftar',
  empty:       'Kosong',
  not_empty:   'Tidak kosong',
};

const TEXT_OPERATORS: RuleOperator[]    = ['eq', 'neq', 'contains', 'not_contains', 'in', 'not_in', 'empty', 'not_empty'];
const NUMERIC_OPERATORS: RuleOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'];

const ACTION_CONFIG: Record<RuleAction, { label: string; color: string; icon: React.ReactNode }> = {
  lolos:        { label: 'Lolos Validasi',        color: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 className="w-3 h-3" /> },
  warning:      { label: 'Warning',               color: 'bg-amber-100 text-amber-700',     icon: <AlertTriangle className="w-3 h-3" /> },
  error:        { label: 'Error',                  color: 'bg-red-100 text-red-700',         icon: <XCircle className="w-3 h-3" /> },
  info:         { label: 'Informasi',              color: 'bg-blue-100 text-blue-700',       icon: <MessageSquare className="w-3 h-3" /> },
  abaikan:      { label: 'Abaikan Item',           color: 'bg-gray-100 text-gray-600',       icon: <EyeOff className="w-3 h-3" /> },
  gunakan_master:{ label: 'Gunakan Harga Master',  color: 'bg-blue-100 text-blue-700',       icon: <Database className="w-3 h-3" /> },
  gunakan_tarif_master:{ label: 'Tarif Master',    color: 'bg-blue-100 text-blue-700',       icon: <Database className="w-3 h-3" /> },
  gunakan_tarif_khusus:{ label: 'Tarif Khusus',   color: 'bg-violet-100 text-violet-700',   icon: <Database className="w-3 h-3" /> },
  pesan_khusus: { label: 'Tampilkan Pesan Khusus', color: 'bg-purple-100 text-purple-700',   icon: <MessageSquare className="w-3 h-3" /> },
  ubah_harga_acuan:{ label: 'Ubah Harga Acuan',   color: 'bg-cyan-100 text-cyan-700',       icon: <SlidersHorizontal className="w-3 h-3" /> },
  ubah_qty_acuan:{ label: 'Ubah Qty Acuan',        color: 'bg-cyan-100 text-cyan-700',       icon: <SlidersHorizontal className="w-3 h-3" /> },
  ubah_tarif_acuan:{ label: 'Ubah Tarif Acuan',    color: 'bg-cyan-100 text-cyan-700',       icon: <SlidersHorizontal className="w-3 h-3" /> },
  formula:{ label: 'Gunakan Formula',             color: 'bg-indigo-100 text-indigo-700',   icon: <SlidersHorizontal className="w-3 h-3" /> },
  hitung_selisih:{ label: 'Hitung Selisih',       color: 'bg-orange-100 text-orange-700',   icon: <ArrowUpDown className="w-3 h-3" /> },
  tandai_tidak_valid:{ label: 'Tandai Tidak Valid',color: 'bg-red-100 text-red-700',         icon: <XCircle className="w-3 h-3" /> },
};

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#6b7280', '#0f766e',
];

const PRESET_ICONS = ['📋', '⚠️', '❌', '✅', '🔍', '💰', '🏥', '📊', '🔒', '⚡', '🎯', '📌'];

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  tidak_boleh_ada: 'Tidak Boleh Ada',
  harus_ada: 'Harus Ada',
  maksimal_qty: 'Maksimal Qty',
  minimal_qty: 'Minimal Qty',
  qty_tetap: 'Qty Tetap',
  qty_berdasarkan_los: 'Qty Berdasarkan LOS',
  qty_maksimal_berdasarkan_los: 'Qty Maksimal Berdasarkan LOS',
  qty_per_hari: 'Qty Per Hari',
  tarif_sesuai_master: 'Tarif Sesuai Master',
  tarif_master_persentase_plus: 'Tarif Master + Persentase',
  tarif_master_persentase_minus: 'Tarif Master - Persentase',
  tarif_tetap: 'Tarif Tetap',
  tarif_formula: 'Tarif Formula',
  tidak_boleh_charge_hari_pulang: 'Tidak Charge Hari Pulang',
  hanya_salah_satu: 'Hanya Salah Satu Item',
  wajib_bersamaan: 'Wajib Bersamaan',
  wajib_tarif_tertentu: 'Wajib Tarif Tertentu',
  custom_formula: 'Custom Formula',
};

const SEVERITY_LABELS: Record<RuleSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Informasi',
};

// ── Helper: generate condition id ─────────────────────────────────────────────
function genId() { return Math.random().toString(36).slice(2, 10); }

// ── Default empty rule ─────────────────────────────────────────────────────────
const DEFAULT_RULE: Omit<BillingRule, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'> = {
  nama: '',
  deskripsi: '',
  prioritas: 10,
  aktif: true,
  warna: '#3b82f6',
  ikon: '📋',
  pesan: '',
  logicType: 'AND',
  conditions: [],
  aksi: 'warning',
  jenisRule: 'custom_formula',
  severity: 'warning',
  penjamin: '',
  berlakuUntuk: [],
  groupsLogic: 'AND',
  actionConfig: { value: '', formula: '' },
  effectiveDate: '',
  expiredDate: '',
};

// ── Action badge ───────────────────────────────────────────────────────────────
function ActionBadge({ aksi }: { aksi: RuleAction }) {
  const cfg = ACTION_CONFIG[aksi];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ── Condition row in builder ───────────────────────────────────────────────────
function ConditionRow({
  cond, onChange, onRemove, showLogic, logicType, onLogicChange,
}: {
  cond: RuleCondition;
  onChange: (c: RuleCondition) => void;
  onRemove: () => void;
  showLogic: boolean;
  logicType: RuleLogic;
  onLogicChange: (l: RuleLogic) => void;
}) {
  const isNumeric = NUMERIC_FIELDS.includes(cond.field);
  const operators = isNumeric ? NUMERIC_OPERATORS : TEXT_OPERATORS;
  const noValue = cond.operator === 'empty' || cond.operator === 'not_empty';

  return (
    <div className="space-y-1">
      {showLogic && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => onLogicChange(logicType === 'AND' ? 'OR' : 'AND')}
            className="text-xs font-bold px-3 py-0.5 rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
          >
            {logicType}
          </button>
        </div>
      )}
      <div className="flex gap-2 items-start">
        {/* Field */}
        <select
          value={cond.field}
          onChange={e => {
            const f = e.target.value as RuleField;
            const ops = NUMERIC_FIELDS.includes(f) ? NUMERIC_OPERATORS : TEXT_OPERATORS;
            onChange({ ...cond, field: f, operator: ops[0], value: '' });
          }}
          className="h-9 px-2 rounded-md border border-input bg-background text-sm flex-1 min-w-0"
        >
          {(Object.keys(FIELD_LABELS) as RuleField[]).map(f => (
            <option key={f} value={f}>{FIELD_LABELS[f]}</option>
          ))}
        </select>
        {/* Operator */}
        <select
          value={cond.operator}
          onChange={e => onChange({ ...cond, operator: e.target.value as RuleOperator, value: '' })}
          className="h-9 px-2 rounded-md border border-input bg-background text-sm flex-1 min-w-0"
        >
          {operators.map(op => (
            <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
          ))}
        </select>
        {/* Value */}
        {!noValue && (
          <Input
            type={isNumeric ? 'number' : 'text'}
            value={cond.value}
            onChange={e => onChange({ ...cond, value: e.target.value })}
            placeholder="Nilai..."
            className="h-9 text-sm flex-1 min-w-0"
          />
        )}
        <button
          type="button"
          onClick={onRemove}
          className="h-9 w-9 flex items-center justify-center rounded-md border border-border hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Rule Form Dialog ───────────────────────────────────────────────────────────
function RuleFormDialog({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: BillingRule | null;
  onClose: () => void;
  onSave: (rule: Omit<BillingRule, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'> & { id?: number }) => void;
}) {
  const [form, setForm] = useState({ ...DEFAULT_RULE, conditions: [] as RuleCondition[] });
  const [groupMode, setGroupMode] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial
        ? {
            ...initial,
            conditions: initial.conditions.map(c => ({ ...c })),
            conditionGroups: initial.conditionGroups?.map(group => ({
              ...group,
              conditions: group.conditions.map(c => ({ ...c })),
            })),
          }
        : { ...DEFAULT_RULE, conditions: [] }
      );
      setGroupMode(Boolean(initial?.conditionGroups?.length));
    }
  }, [open, initial]);

  const addCondition = () =>
    setForm(f => ({
      ...f,
      conditions: [...f.conditions, { id: genId(), field: 'nama_item', operator: 'contains', value: '' }],
    }));

  const updateCond = (idx: number, c: RuleCondition) =>
    setForm(f => { const cs = [...f.conditions]; cs[idx] = c; return { ...f, conditions: cs }; });

  const removeCond = (idx: number) =>
    setForm(f => ({ ...f, conditions: f.conditions.filter((_, i) => i !== idx) }));

  const enableGroupMode = () => {
    setGroupMode(true);
    setForm(f => ({
      ...f,
      conditionGroups: f.conditionGroups?.length
        ? f.conditionGroups
        : [{
            id: genId(),
            logic: f.logicType,
            conditions: f.conditions.length ? f.conditions : [{ id: genId(), field: 'nama_item', operator: 'contains', value: '' }],
          }],
    }));
  };

  const addGroup = () => setForm(f => ({
    ...f,
    conditionGroups: [
      ...(f.conditionGroups || []),
      { id: genId(), logic: 'AND', conditions: [{ id: genId(), field: 'nama_item', operator: 'contains', value: '' }] },
    ],
  }));

  const updateGroup = (groupIndex: number, group: RuleConditionGroup) => setForm(f => ({
    ...f,
    conditionGroups: (f.conditionGroups || []).map((current, index) => index === groupIndex ? group : current),
  }));

  const removeGroup = (groupIndex: number) => setForm(f => ({
    ...f,
    conditionGroups: (f.conditionGroups || []).filter((_, index) => index !== groupIndex),
  }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nama.trim()) { toast.error('Nama rule wajib diisi'); return; }
    if (groupMode
      ? !(form.conditionGroups || []).some(group => group.conditions.length > 0)
      : form.conditions.length === 0) {
      toast.error('Tambahkan minimal 1 kondisi');
      return;
    }
    onSave(form);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial?.id ? 'Edit Rule' : 'Tambah Rule Baru'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 py-2">

          {/* Info dasar */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1">
              <label className="text-sm font-semibold">Nama Rule *</label>
              <Input value={form.nama} onChange={e => setForm(f => ({ ...f, nama: e.target.value }))} placeholder="Contoh: BPJS Qty > 1" required />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-sm font-semibold">Deskripsi</label>
              <Input value={form.deskripsi} onChange={e => setForm(f => ({ ...f, deskripsi: e.target.value }))} placeholder="Keterangan singkat tentang rule ini" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold">Prioritas</label>
              <Input type="number" min={1} max={999} value={form.prioritas} onChange={e => setForm(f => ({ ...f, prioritas: Number(e.target.value) }))} />
              <p className="text-xs text-muted-foreground">Angka lebih kecil dijalankan lebih dahulu</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold">Status</label>
              <div className="flex items-center gap-2 h-9">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, aktif: !f.aktif }))}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${form.aktif ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-border text-muted-foreground'}`}
                >
                  {form.aktif ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  {form.aktif ? 'Aktif' : 'Nonaktif'}
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-border p-3 bg-muted/20">
            <div className="space-y-1">
              <label className="text-sm font-semibold">Jenis Rule</label>
              <select
                value={form.jenisRule || 'custom_formula'}
                onChange={e => setForm(f => ({ ...f, jenisRule: e.target.value as RuleType }))}
                className="h-9 w-full px-2 rounded-md border border-input bg-background text-sm"
              >
                {(Object.keys(RULE_TYPE_LABELS) as RuleType[]).map(type => (
                  <option key={type} value={type}>{RULE_TYPE_LABELS[type]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold">Severity</label>
              <select
                value={form.severity || 'warning'}
                onChange={e => setForm(f => ({ ...f, severity: e.target.value as RuleSeverity }))}
                className="h-9 w-full px-2 rounded-md border border-input bg-background text-sm"
              >
                {(Object.keys(SEVERITY_LABELS) as RuleSeverity[]).map(level => (
                  <option key={level} value={level}>{SEVERITY_LABELS[level]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold">Penjamin (opsional)</label>
              <Input value={form.penjamin || ''} onChange={e => setForm(f => ({ ...f, penjamin: e.target.value }))} placeholder="Contoh: BPJS Kesehatan" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold">Berlaku untuk item/kode</label>
              <Input
                value={(form.berlakuUntuk || []).join(', ')}
                onChange={e => setForm(f => ({ ...f, berlakuUntuk: e.target.value.split(',').map(v => v.trim()).filter(Boolean) }))}
                placeholder="Pisahkan dengan koma"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold">Effective date</label>
              <Input type="date" value={form.effectiveDate || ''} onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold">Expired date</label>
              <Input type="date" value={form.expiredDate || ''} onChange={e => setForm(f => ({ ...f, expiredDate: e.target.value }))} />
            </div>
          </div>

          {/* Ikon + Warna */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Ikon</label>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_ICONS.map(ic => (
                  <button key={ic} type="button" onClick={() => setForm(f => ({ ...f, ikon: ic }))}
                    className={`w-8 h-8 rounded border text-base transition-colors ${form.ikon === ic ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'}`}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Warna Label</label>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setForm(f => ({ ...f, warna: c }))}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${form.warna === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          {(form.jenisRule !== 'custom_formula' || form.aksi === 'formula' || form.aksi.includes('ubah') || form.aksi === 'gunakan_tarif_khusus') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-border p-3">
              <div className="space-y-1">
                <label className="text-sm font-semibold">Nilai acuan / persentase</label>
                <Input
                  type="number"
                  value={form.actionConfig?.value || ''}
                  onChange={e => setForm(f => ({ ...f, actionConfig: { ...(f.actionConfig || {}), value: e.target.value } }))}
                  placeholder="Contoh: 3 atau 1"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold">Formula custom</label>
                <Input
                  value={form.actionConfig?.formula || ''}
                  onChange={e => setForm(f => ({ ...f, actionConfig: { ...(f.actionConfig || {}), formula: e.target.value } }))}
                  placeholder="Contoh: master + 3% atau master * qty * los"
                />
                <p className="text-[11px] text-muted-foreground">Variabel: master, billing, qty, los, nominal.</p>
              </div>
            </div>
          )}

          {/* Conditions builder */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-semibold">Kondisi (IF) *</label>
                <p className="text-[11px] text-muted-foreground">Prioritas aturan tetap mengikuti angka terkecil lebih dahulu.</p>
              </div>
              <div className="flex gap-2">
                {!groupMode && (
                  <Button type="button" variant="outline" size="sm" onClick={addCondition} className="h-7 gap-1 text-xs">
                    <Plus className="w-3 h-3" /> Tambah Kondisi
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={enableGroupMode} className="h-7 gap-1 text-xs">
                  <SlidersHorizontal className="w-3 h-3" /> {groupMode ? 'Mode Grup Aktif' : 'Gunakan Grup'}
                </Button>
              </div>
            </div>
            {groupMode ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">Hubungkan hasil grup dengan</span>
                  <select
                    value={form.groupsLogic || 'AND'}
                    onChange={e => setForm(f => ({ ...f, groupsLogic: e.target.value as RuleLogic }))}
                    className="h-8 px-2 rounded-md border border-input bg-background text-xs"
                  >
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                  </select>
                  <Button type="button" variant="outline" size="sm" onClick={addGroup} className="h-8 gap-1 text-xs">
                    <Plus className="w-3 h-3" /> Tambah Grup
                  </Button>
                </div>
                {(form.conditionGroups || []).map((group, groupIndex) => (
                  <div key={group.id} className="border border-primary/30 rounded-lg p-3 space-y-2 bg-primary/5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-primary">Grup {groupIndex + 1}</span>
                      <div className="flex items-center gap-2">
                        <select
                          value={group.logic}
                          onChange={e => updateGroup(groupIndex, { ...group, logic: e.target.value as RuleLogic })}
                          className="h-7 px-2 rounded-md border border-input bg-background text-xs"
                        >
                          <option value="AND">Semua kondisi (AND)</option>
                          <option value="OR">Salah satu (OR)</option>
                        </select>
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeGroup(groupIndex)} className="h-7 text-destructive">
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    {group.conditions.map((cond, conditionIndex) => (
                      <ConditionRow
                        key={cond.id}
                        cond={cond}
                        onChange={next => updateGroup(groupIndex, {
                          ...group,
                          conditions: group.conditions.map((current, index) => index === conditionIndex ? next : current),
                        })}
                        onRemove={() => updateGroup(groupIndex, {
                          ...group,
                          conditions: group.conditions.filter((_, index) => index !== conditionIndex),
                        })}
                        showLogic={conditionIndex > 0}
                        logicType={group.logic}
                        onLogicChange={logic => updateGroup(groupIndex, { ...group, logic })}
                      />
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => updateGroup(groupIndex, {
                        ...group,
                        conditions: [...group.conditions, { id: genId(), field: 'nama_item', operator: 'contains', value: '' }],
                      })}
                      className="h-7 gap-1 text-xs"
                    >
                      <Plus className="w-3 h-3" /> Kondisi di grup
                    </Button>
                  </div>
                ))}
              </div>
            ) : form.conditions.length === 0 ? (
              <div className="border border-dashed border-border rounded-lg py-6 text-center text-sm text-muted-foreground">
                Belum ada kondisi. Klik "Tambah Kondisi" untuk mulai.
              </div>
            ) : (
              <div className="border border-border rounded-lg p-3 space-y-2 bg-muted/20">
                {form.conditions.map((cond, idx) => (
                  <ConditionRow
                    key={cond.id}
                    cond={cond}
                    onChange={c => updateCond(idx, c)}
                    onRemove={() => removeCond(idx)}
                    showLogic={idx > 0}
                    logicType={form.logicType}
                    onLogicChange={l => setForm(f => ({ ...f, logicType: l }))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Action (THEN) */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">Aksi (THEN) *</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(Object.keys(ACTION_CONFIG) as RuleAction[]).map(a => {
                const cfg = ACTION_CONFIG[a];
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, aksi: a }))}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all text-left ${
                      form.aksi === a ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${cfg.color}`}>
                      {cfg.icon}
                    </span>
                    <span className="text-xs leading-tight">{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pesan */}
          <div className="space-y-1">
            <label className="text-sm font-semibold">Pesan yang Ditampilkan</label>
            <Input value={form.pesan} onChange={e => setForm(f => ({ ...f, pesan: e.target.value }))} placeholder="Pesan ketika rule ini cocok..." />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
            <Button type="submit">{initial?.id ? 'Simpan Perubahan' : 'Buat Rule'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function BillingRuleSettings() {
  const { user } = useAuth();
  const [rules, setRules] = useState<BillingRule[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'semua' | 'aktif' | 'nonaktif'>('semua');
  const [sortDesc, setSortDesc] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editRule, setEditRule] = useState<BillingRule | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const loadRules = useCallback(async () => {
    const db = await getDB();
    const all = await db.getAll('billingRules');
    setRules(all.sort((a, b) => sortDesc ? b.prioritas - a.prioritas : a.prioritas - b.prioritas));
  }, [sortDesc]);

  useEffect(() => { loadRules(); }, [loadRules]);

  const filtered = rules.filter(r => {
    const matchSearch = !search.trim() || r.nama.toLowerCase().includes(search.toLowerCase()) || r.deskripsi.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'semua' || (filterStatus === 'aktif' ? r.aktif : !r.aktif);
    return matchSearch && matchStatus;
  });

  const handleSave = async (form: Omit<BillingRule, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'> & { id?: number }) => {
    const db = await getDB();
    const now = Date.now();
    const isEdit = !!form.id;

    if (isEdit) {
      const updated: BillingRule = { ...form as BillingRule, updatedAt: now };
      await db.put('billingRules', updated);
      await writeLog({ modul: 'Billing Rule', aktivitas: `Edit rule "${form.nama}"`, status: 'Success', oldValue: editRule, newValue: form });
      toast.success('Rule berhasil diperbarui.');
    } else {
      const newRule: BillingRule = { ...form, createdAt: now, updatedAt: now, createdBy: user?.username ?? 'unknown' };
      await db.add('billingRules', newRule);
      await writeLog({ modul: 'Billing Rule', aktivitas: `Tambah rule "${form.nama}"`, status: 'Success', newValue: form });
      toast.success('Rule berhasil ditambahkan.');
    }
    setIsFormOpen(false);
    setEditRule(null);
    loadRules();
  };

  const handleDelete = async (id: number) => {
    const db = await getDB();
    const rule = rules.find(r => r.id === id);
    await db.delete('billingRules', id);
    await writeLog({ modul: 'Billing Rule', aktivitas: `Hapus rule "${rule?.nama}"`, status: 'Warning', oldValue: rule });
    toast.success('Rule dihapus.');
    setConfirmDeleteId(null);
    loadRules();
  };

  const handleDuplicate = async (rule: BillingRule) => {
    const db = await getDB();
    const now = Date.now();
    const copy: BillingRule = {
      ...rule,
      id: undefined,
      nama: `Salinan: ${rule.nama}`,
      aktif: false,
      createdAt: now,
      updatedAt: now,
      createdBy: user?.username ?? 'unknown',
      conditions: rule.conditions.map(c => ({ ...c, id: genId() })),
    };
    await db.add('billingRules', copy);
    await writeLog({ modul: 'Billing Rule', aktivitas: `Duplikasi rule "${rule.nama}"`, status: 'Success' });
    toast.success('Rule berhasil diduplikasi.');
    loadRules();
  };

  const handleToggle = async (rule: BillingRule) => {
    const db = await getDB();
    const updated = { ...rule, aktif: !rule.aktif, updatedAt: Date.now() };
    await db.put('billingRules', updated);
    await writeLog({ modul: 'Billing Rule', aktivitas: `${updated.aktif ? 'Aktifkan' : 'Nonaktifkan'} rule "${rule.nama}"`, status: 'Info' });
    toast.success(`Rule ${updated.aktif ? 'diaktifkan' : 'dinonaktifkan'}.`);
    loadRules();
  };

  const handleExport = () => {
    const rows = rules.map(rule => ({
      ...rule,
      conditions: JSON.stringify(rule.conditions || []),
      conditionGroups: JSON.stringify(rule.conditionGroups || []),
      berlakuUntuk: JSON.stringify(rule.berlakuUntuk || []),
      actionConfig: JSON.stringify(rule.actionConfig || {}),
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Master Rule Billing');
    XLSX.writeFile(workbook, `master-rule-billing-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Master Rule Billing berhasil diekspor ke Excel.');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      let imported: BillingRule[];
      if (file.name.toLowerCase().endsWith('.json')) {
        imported = JSON.parse(await file.text());
      } else {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
        imported = rows.map(row => ({
          ...row,
          conditions: typeof row.conditions === 'string' ? JSON.parse(row.conditions || '[]') : (row.conditions || []),
          conditionGroups: typeof row.conditionGroups === 'string' ? JSON.parse(row.conditionGroups || '[]') : (row.conditionGroups || []),
          berlakuUntuk: typeof row.berlakuUntuk === 'string' ? JSON.parse(row.berlakuUntuk || '[]') : (row.berlakuUntuk || []),
          actionConfig: typeof row.actionConfig === 'string' ? JSON.parse(row.actionConfig || '{}') : (row.actionConfig || {}),
          prioritas: Number(row.prioritas || 10),
          aktif: row.aktif === true || String(row.aktif).toLowerCase() === 'true',
        })) as BillingRule[];
      }
      if (!Array.isArray(imported)) throw new Error('Format tidak valid');
      const db = await getDB();
      const now = Date.now();
      let count = 0;
      for (const rule of imported) {
        if (!rule.nama || !rule.conditions || !rule.aksi) continue;
        await db.add('billingRules', {
          ...rule,
          id: undefined,
          nama: `[Import] ${rule.nama}`,
          aktif: false,
          createdAt: now,
          updatedAt: now,
          createdBy: user?.username ?? 'import',
          conditions: (rule.conditions || []).map((c: RuleCondition) => ({ ...c, id: genId() })),
        });
        count++;
      }
      await writeLog({ modul: 'Billing Rule', aktivitas: `Import ${count} rule`, status: 'Success' });
      toast.success(`${count} rule berhasil diimpor (status nonaktif).`);
      loadRules();
    } catch (err: any) {
      toast.error('Gagal mengimpor: ' + (err?.message ?? 'Format file tidak valid'));
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-primary" />
                Master Rule Billing
              </CardTitle>
              <CardDescription className="mt-1">
                Kelola rule validasi billing, prioritas, periode berlaku, formula, dan hasil yang diharapkan.
              </CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
                <Download className="w-4 h-4" /> Export
              </Button>
              <label className="cursor-pointer">
                <Button variant="outline" size="sm" className="gap-1.5" asChild>
                  <span><Upload className="w-4 h-4" /> Import</span>
                </Button>
                <input type="file" accept=".xlsx,.xls,.json" className="hidden" onChange={handleImport} />
              </label>
              <Button size="sm" className="gap-1.5" onClick={() => { setEditRule(null); setIsFormOpen(true); }}>
                <Plus className="w-4 h-4" /> Tambah Rule
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filter + Search */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari rule..." className="pl-8 h-9 text-sm" />
            </div>
            {(['semua', 'aktif', 'nonaktif'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors capitalize ${filterStatus === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {s === 'semua' ? `Semua (${rules.length})` : s === 'aktif' ? `Aktif (${rules.filter(r => r.aktif).length})` : `Nonaktif (${rules.filter(r => !r.aktif).length})`}
              </button>
            ))}
            <button
              onClick={() => setSortDesc(d => !d)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              Prioritas {sortDesc ? '↓' : '↑'}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Rule list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
          {rules.length === 0
            ? 'Belum ada Billing Rule. Klik "Tambah Rule" untuk membuat yang pertama.'
            : 'Tidak ada rule yang cocok dengan filter.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(rule => (
            <Card key={rule.id} className={`border-l-4 transition-opacity ${rule.aktif ? 'opacity-100' : 'opacity-60'}`}
              style={{ borderLeftColor: rule.warna }}
            >
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Left: info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg">{rule.ikon}</span>
                      <span className="font-semibold text-sm">{rule.nama}</span>
                      <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">
                        Prioritas {rule.prioritas}
                      </span>
                      {rule.aktif
                        ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">Aktif</Badge>
                        : <Badge variant="outline" className="text-xs text-muted-foreground">Nonaktif</Badge>
                      }
                      <ActionBadge aksi={rule.aksi} />
                    </div>
                    {rule.deskripsi && (
                      <p className="text-xs text-muted-foreground mt-1">{rule.deskripsi}</p>
                    )}
                    {/* Conditions preview */}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {rule.conditions.map((c, i) => (
                        <React.Fragment key={c.id}>
                          {i > 0 && (
                            <span className="text-xs font-bold text-primary px-1">{rule.logicType}</span>
                          )}
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
                            {FIELD_LABELS[c.field]} {OPERATOR_LABELS[c.operator].split(' ')[0]} {c.value && `"${c.value}"`}
                          </span>
                        </React.Fragment>
                      ))}
                    </div>
                    {rule.pesan && (
                      <p className="text-xs italic text-muted-foreground mt-1.5">💬 {rule.pesan}</p>
                    )}
                  </div>
                  {/* Right: actions */}
                  <div className="flex gap-1 shrink-0">
                    <button title={rule.aktif ? 'Nonaktifkan' : 'Aktifkan'} onClick={() => handleToggle(rule)}
                      className="h-8 w-8 flex items-center justify-center rounded-md border border-border hover:bg-muted transition-colors"
                    >
                      {rule.aktif ? <ToggleRight className="w-4 h-4 text-emerald-600" /> : <ToggleLeft className="w-4 h-4 text-muted-foreground" />}
                    </button>
                    <button title="Duplikasi" onClick={() => handleDuplicate(rule)}
                      className="h-8 w-8 flex items-center justify-center rounded-md border border-border hover:bg-muted transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button title="Edit" onClick={() => { setEditRule(rule); setIsFormOpen(true); }}
                      className="h-8 w-8 flex items-center justify-center rounded-md border border-border hover:bg-muted transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button title="Hapus" onClick={() => setConfirmDeleteId(rule.id!)}
                      className="h-8 w-8 flex items-center justify-center rounded-md border border-border hover:bg-destructive/10 hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Summary footer */}
      {rules.length > 0 && (
        <p className="text-xs text-center text-muted-foreground">
          {rules.filter(r => r.aktif).length} rule aktif · {rules.filter(r => !r.aktif).length} nonaktif · Total {rules.length} rule
        </p>
      )}

      {/* Form Dialog */}
      <RuleFormDialog
        open={isFormOpen}
        initial={editRule}
        onClose={() => { setIsFormOpen(false); setEditRule(null); }}
        onSave={handleSave}
      />

      {/* Confirm Delete Dialog */}
      <Dialog open={confirmDeleteId !== null} onOpenChange={() => setConfirmDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Rule?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Rule <strong>"{rules.find(r => r.id === confirmDeleteId)?.nama}"</strong> akan dihapus permanen.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>Batal</Button>
            <Button variant="destructive" onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}>Hapus</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
