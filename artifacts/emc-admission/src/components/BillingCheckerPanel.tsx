import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getDB, Patient, User, BillingCheck, BillingRule,
  MasterTarif, MasterTarifItem,
} from '../lib/db';
import {
  parseBillingExcel, checkBillingItems, runRuleEngine,
  calcOverallStatus, calcLamaRawat, fmtRpBilling,
} from '../lib/billing';
import { generateUUID } from '../lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import {
  Upload, CheckCircle2, AlertTriangle, XCircle, FileText,
  History, Loader2, FileSpreadsheet, Download, ChevronDown, ChevronUp,
} from 'lucide-react';
import { formatDateTime } from '../lib/utils';

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  valid:   { label: 'Billing Valid',       cls: 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400', Icon: CheckCircle2 },
  warning: { label: 'Billing Perlu Dicek', cls: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400',   Icon: AlertTriangle },
  invalid: { label: 'Billing Tidak Valid', cls: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400',            Icon: XCircle },
} as const;

const ITEM_CLS: Record<string, string> = {
  sesuai:          'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  selisih:         'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  tidak_ditemukan: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  patient: Patient;
  user: User;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BillingCheckerPanel({ patient, user }: Props) {
  const [checks, setChecks]               = useState<BillingCheck[]>([]);
  const [currentCheck, setCurrentCheck]   = useState<BillingCheck | null>(null);
  const [isProcessing, setIsProcessing]   = useState(false);
  const [activeTarif, setActiveTarif]     = useState<MasterTarif | null>(null);
  const [masterItems, setMasterItems]     = useState<MasterTarifItem[]>([]);
  const [rules, setRules]                 = useState<BillingRule[]>([]);
  const [resultTab, setResultTab]         = useState<'items' | 'rules'>('items');
  const [showHistory, setShowHistory]     = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const kelasTarif = masterItems
    .map(item => item.kelasTarif.trim())
    .filter(Boolean)
    .find(option => option.toLowerCase() === (patient.roomType || '').trim().toLowerCase()) || '';
  const lamaRawat  = calcLamaRawat(patient.admissionDate, patient.dischargeDate);

  const loadData = useCallback(async () => {
    const db = await getDB();
    const [tarifs, allRules] = await Promise.all([
      db.getAll('masterTarifs'),
      db.getAll('billingRules'),
    ]);
    const aktif = tarifs.find(t => t.status === 'aktif') ?? null;
    setActiveTarif(aktif);
    if (aktif?.id) {
      const items = await db.getAllFromIndex('masterTarifItems', 'masterTarifId', aktif.id);
      setMasterItems(items);
    } else {
      setMasterItems([]);
    }
    const patientChecks = await db.getAllFromIndex('billingChecks', 'noRM', patient.noRM);
    const sorted = patientChecks
      .filter(c => c.episodeNo === patient.episodeNo)
      .sort((a, b) => b.createdAt - a.createdAt);
    setChecks(sorted);
    if (sorted.length > 0) setCurrentCheck(prev => prev ?? sorted[0]);
    setRules(allRules);
  }, [patient.noRM, patient.episodeNo]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Upload handler ──────────────────────────────────────────────────────────

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!activeTarif) {
      toast.error('Tidak ada Master Tarif aktif. Upload Master Tarif di Pengaturan → Master Tarif.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (!kelasTarif) {
      toast.error('Kelas pasien belum cocok dengan kolom Kelastarif pada Master Tarif aktif.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setIsProcessing(true);
    try {
      const buf       = await file.arrayBuffer();
      const rawItems  = parseBillingExcel(buf);
      if (!rawItems.length) { toast.error('Tidak ada data billing yang dapat dibaca dari file ini.'); return; }

      const checkedItems  = checkBillingItems(rawItems, masterItems, kelasTarif);
      const ruleResults   = runRuleEngine(checkedItems, rules, patient.payor || '', lamaRawat, {
        kelas: kelasTarif,
        ruangan: patient.ward,
        lokasi: patient.roomName,
        dokter: patient.dpjp,
        los: lamaRawat,
        hariKe: lamaRawat,
        hariPulang: Boolean(patient.dischargeDate),
        diagnosa: [patient.diagnosaMasuk, patient.diagnosakUtama, patient.diagnosaTambahan].filter(Boolean).join('; '),
        episode: patient.episodeNo,
        jenisPelayanan: 'Rawat Inap',
      });
      const overallStatus = calcOverallStatus(checkedItems, ruleResults);
      const now = Date.now();

      const check: BillingCheck = {
        id: generateUUID(),
        noRM:             patient.noRM,
        episodeNo:        patient.episodeNo,
        namaPasien:       patient.namaPasien,
        namaFileBilling:  file.name,
        masterTarifId:    activeTarif.id!,
        masterTarifNama:  activeTarif.nama,
        penjamin:         patient.payor || '-',
        kelasTarif,
        lamaRawat,
        items:            checkedItems,
        ruleResults,
        totalItem:            checkedItems.length,
        itemSesuai:           checkedItems.filter(i => i.status === 'sesuai').length,
        itemSelisih:          checkedItems.filter(i => i.status === 'selisih').length,
        itemTidakDitemukan:   checkedItems.filter(i => i.status === 'tidak_ditemukan').length,
        totalBilling:         checkedItems.reduce((s, i) => s + i.totalBilling, 0),
        totalSelisih:         checkedItems.reduce((s, i) => s + Math.abs(i.totalSelisih), 0),
        ruleTerpenuhi:        ruleResults.filter(r => r.status === 'ok').length,
        ruleTidakTerpenuhi:   ruleResults.filter(r => r.status !== 'ok').length,
        overallStatus,
        catatan:      '',
        checkedById:   user.id!,
        checkedByName: user.namaLengkap,
        createdAt:    now,
      };

      const db = await getDB();
      await db.put('billingChecks', check);
      setCurrentCheck(check);
      await loadData();
      toast.success(`Selesai: ${checkedItems.length} item diproses, ${check.itemTidakDitemukan} tidak ditemukan, ${check.itemSelisih} selisih.`);
    } catch (err: any) {
      toast.error('Gagal memproses: ' + (err?.message ?? 'Error tidak diketahui'));
    } finally {
      setIsProcessing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── Export Excel ─────────────────────────────────────────────────────────────

  const handleExportExcel = () => {
    if (!currentCheck) return;
    const wb = XLSX.utils.book_new();

    // Ringkasan
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { Keterangan: 'Pasien',             Nilai: currentCheck.namaPasien },
      { Keterangan: 'No RM',              Nilai: currentCheck.noRM },
      { Keterangan: 'Penjamin',           Nilai: currentCheck.penjamin },
      { Keterangan: 'Kelas Tarif',        Nilai: currentCheck.kelasTarif },
      { Keterangan: 'Lama Rawat (hari)',  Nilai: currentCheck.lamaRawat },
      { Keterangan: 'Master Tarif',       Nilai: currentCheck.masterTarifNama },
      { Keterangan: 'File Billing',       Nilai: currentCheck.namaFileBilling },
      { Keterangan: 'Tanggal Periksa',    Nilai: formatDateTime(currentCheck.createdAt) },
      { Keterangan: 'Diperiksa Oleh',     Nilai: currentCheck.checkedByName },
      { Keterangan: 'Total Item',         Nilai: currentCheck.totalItem },
      { Keterangan: 'Item Sesuai',        Nilai: currentCheck.itemSesuai },
      { Keterangan: 'Item Selisih',       Nilai: currentCheck.itemSelisih },
      { Keterangan: 'Tidak Ditemukan',    Nilai: currentCheck.itemTidakDitemukan },
      { Keterangan: 'Total Billing',      Nilai: currentCheck.totalBilling },
      { Keterangan: 'Total Selisih',      Nilai: currentCheck.totalSelisih },
      { Keterangan: 'Rule Terpenuhi',     Nilai: currentCheck.ruleTerpenuhi },
      { Keterangan: 'Rule Tidak Terpenuhi', Nilai: currentCheck.ruleTidakTerpenuhi },
      { Keterangan: 'Status',             Nilai: currentCheck.overallStatus === 'valid' ? 'VALID' : currentCheck.overallStatus === 'warning' ? 'PERLU CEK' : 'TIDAK VALID' },
    ]), 'Ringkasan');

    // Detail Item
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      currentCheck.items.map((i, idx) => ({
        No:             idx + 1,
        'Nama Item':    i.namaItem,
        'Item Master':  i.matchedMasterName,
        Kategori:       i.kategori,
        Qty:            i.qty,
        'Harga Billing': i.hargaBilling,
        'Total Billing': i.totalBilling,
        'Harga Master':  i.hargaMaster,
        'Selisih/Unit':  i.selisih,
        'Total Selisih': i.totalSelisih,
        Status:          i.status === 'sesuai' ? 'Sesuai' : i.status === 'selisih' ? 'Ada Selisih' : 'Tidak Ditemukan',
      }))
    ), 'Detail Item');

    // Rule Billing
    if (currentCheck.ruleResults.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        currentCheck.ruleResults.map((r, idx) => ({
          No:         idx + 1,
          'Nama Item': r.namaItem,
          Tipe:        r.tipe,
          Keterangan:  r.keterangan,
          Status:      r.status === 'ok' ? 'OK' : r.status === 'warning' ? 'Warning' : 'Error',
          Detail:      r.detail,
        }))
      ), 'Rule Billing');
    }

    const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    XLSX.writeFile(wb, `BillingChecker_${currentCheck.noRM}_${ts}.xlsx`);
    toast.success('Export Excel berhasil didownload.');
  };

  // ── No active tarif guard ─────────────────────────────────────────────────

  if (!activeTarif) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3 text-muted-foreground">
        <FileSpreadsheet className="w-12 h-12 opacity-20" />
        <p className="font-semibold">Tidak Ada Master Tarif Aktif</p>
        <p className="text-sm max-w-xs">Pergi ke Pengaturan → Master Tarif untuk mengupload dan mengaktifkan Master Tarif terlebih dahulu.</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const cur = currentCheck;

  return (
    <div className="space-y-4">

      {/* Header info + upload */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-muted-foreground">Master Tarif:</span>
            <span className="font-medium">{activeTarif.nama}</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span>Penjamin: <b className="text-foreground">{patient.payor || '-'}</b></span>
            <span>Kelas: <b className="text-foreground">{kelasTarif}</b></span>
            <span>Lama Rawat: <b className="text-foreground">{lamaRawat} hari</b></span>
          </div>
        </div>

        <label className="cursor-pointer shrink-0">
          <span className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors
            ${isProcessing
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer'
            }`}
          >
            {isProcessing
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Memproses...</>
              : <><Upload className="w-4 h-4" /> Upload Billing Excel</>
            }
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleUpload}
            disabled={isProcessing}
          />
        </label>
      </div>

      {/* Empty state */}
      {!cur && !isProcessing && (
        <div className="flex flex-col items-center justify-center py-14 border border-dashed border-border rounded-xl text-center gap-3 text-muted-foreground">
          <FileText className="w-10 h-10 opacity-20" />
          <p className="font-semibold text-sm">Belum Ada Hasil Billing Checker</p>
          <p className="text-xs max-w-xs">Upload file Billing Excel hasil TrakCare untuk memulai pemeriksaan otomatis.</p>
        </div>
      )}

      {/* Processing state */}
      {isProcessing && (
        <div className="flex items-center justify-center gap-3 py-10 text-primary text-sm border border-primary/20 rounded-xl bg-primary/5">
          <Loader2 className="w-5 h-5 animate-spin" />
          Memproses dan mencocokkan billing dengan Master Tarif...
        </div>
      )}

      {/* Results */}
      {cur && !isProcessing && (() => {
        const cfg = STATUS_CFG[cur.overallStatus];
        const Icon = cfg.Icon;
        return (
          <div className="space-y-4">

            {/* Status + file info + export */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold border ${cfg.cls}`}>
                  <Icon className="w-4 h-4" /> {cfg.label}
                </span>
                <p className="text-xs text-muted-foreground">
                  {cur.namaFileBilling} · {formatDateTime(cur.createdAt)} · {cur.checkedByName}
                </p>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={handleExportExcel}>
                <Download className="w-3.5 h-3.5" /> Export Excel
              </Button>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <SummaryCard label="Total Item"      value={cur.totalItem}           cls="text-foreground" />
              <SummaryCard label="Sesuai"          value={cur.itemSesuai}          cls="text-emerald-600 dark:text-emerald-400" />
              <SummaryCard label="Selisih"         value={cur.itemSelisih}         cls="text-amber-600 dark:text-amber-400" />
              <SummaryCard label="Tdk Ditemukan"   value={cur.itemTidakDitemukan}  cls="text-red-600 dark:text-red-400" />
              <SummaryCard label="Rule OK"         value={cur.ruleTerpenuhi}       cls="text-emerald-600 dark:text-emerald-400" />
              <SummaryCard label="Rule Error"      value={cur.ruleTidakTerpenuhi}  cls="text-red-600 dark:text-red-400" />
            </div>

            {/* Selisih info */}
            {cur.totalSelisih > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                Total selisih harga: <span className="font-bold">{fmtRpBilling(cur.totalSelisih)}</span>
                <span className="text-xs ml-1.5 opacity-75">(dari {cur.itemSelisih} item)</span>
              </div>
            )}

            {/* Result tabs */}
            <div className="border-b border-border">
              <div className="flex">
                <TabBtn active={resultTab === 'items'} onClick={() => setResultTab('items')}>
                  Detail Item ({cur.totalItem})
                </TabBtn>
                {cur.ruleResults.length > 0 && (
                  <TabBtn active={resultTab === 'rules'} onClick={() => setResultTab('rules')}>
                    Rule Billing ({cur.ruleResults.length})
                  </TabBtn>
                )}
              </div>
            </div>

            {/* ── Detail Item table ── */}
            {resultTab === 'items' && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-left">
                      <th className="px-3 py-2 font-semibold">Nama Item</th>
                      <th className="px-3 py-2 font-semibold">Kategori</th>
                       <th className="px-3 py-2 font-semibold text-right">Qty Billing / Seharusnya</th>
                      <th className="px-3 py-2 font-semibold text-right">Harga Billing</th>
                       <th className="px-3 py-2 font-semibold text-right">Tarif Acuan</th>
                      <th className="px-3 py-2 font-semibold text-right">Selisih</th>
                       <th className="px-3 py-2 font-semibold">Rule / Pesan</th>
                      <th className="px-3 py-2 font-semibold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cur.items.map((item, idx) => (
                      <tr
                        key={idx}
                        className={`border-b border-border last:border-0 ${
                          item.status === 'tidak_ditemukan' ? 'bg-red-50/60 dark:bg-red-900/10' :
                          item.status === 'selisih'        ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''
                        }`}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium">{item.namaItem}</div>
                          {item.matchedMasterName && item.matchedMasterName !== item.namaItem && (
                            <div className="text-[10px] text-muted-foreground">→ {item.matchedMasterName}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{item.kategori || '-'}</td>
                         <td className="px-3 py-2 text-right font-mono">
                           {item.qty.toLocaleString('id-ID')}
                           {item.qtySeharusnya !== null && item.qtySeharusnya !== undefined && (
                             <span className="block text-[10px] text-muted-foreground">/ {item.qtySeharusnya.toLocaleString('id-ID')}</span>
                           )}
                         </td>
                        <td className="px-3 py-2 text-right font-mono">{fmtRpBilling(item.hargaBilling)}</td>
                        <td className="px-3 py-2 text-right font-mono">
                           {item.tarifSeharusnya !== null && item.tarifSeharusnya !== undefined
                             ? fmtRpBilling(item.tarifSeharusnya)
                             : item.status === 'tidak_ditemukan'
                               ? <span className="text-muted-foreground">—</span>
                               : fmtRpBilling(item.hargaMaster)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {item.status === 'selisih' ? (
                            <span className={item.selisih > 0 ? 'text-red-600' : 'text-emerald-600'}>
                              {item.selisih > 0 ? '+' : ''}{fmtRpBilling(item.selisih)}
                            </span>
                          ) : item.status === 'tidak_ditemukan' ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className="text-emerald-600">0</span>
                          )}
                        </td>
                         <td className="px-3 py-2 max-w-[240px]">
                           {item.ruleIds?.length ? (
                             <div className="space-y-0.5">
                               <div className="font-medium text-primary">{item.ruleIds.map(id => `#${id}`).join(', ')}</div>
                               {item.jenisPelanggaran && <div className="text-[10px] text-muted-foreground">{item.jenisPelanggaran}</div>}
                               {item.pesanValidasi && <div className="text-[10px] text-muted-foreground italic">{item.pesanValidasi}</div>}
                             </div>
                           ) : <span className="text-muted-foreground">—</span>}
                         </td>
                         <td className="px-3 py-2 text-center">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${ITEM_CLS[item.status]}`}>
                            {item.status === 'sesuai' ? 'Sesuai' : item.status === 'selisih' ? 'Selisih' : 'Tdk Ditemukan'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Rule Billing results ── */}
            {resultTab === 'rules' && (
              <div className="space-y-2">
                {cur.ruleResults.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm border border-dashed rounded-lg">
                    Tidak ada rule billing untuk penjamin "{cur.penjamin}"
                  </div>
                ) : (
                  cur.ruleResults.map((r, idx) => {
                    const RIcon = r.status === 'ok' ? CheckCircle2 : r.status === 'warning' ? AlertTriangle : XCircle;
                    const clr = r.status === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : r.status === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
                    const border = r.status === 'ok' ? 'border-emerald-200 dark:border-emerald-800' : r.status === 'warning' ? 'border-amber-200 dark:border-amber-800' : 'border-red-200 dark:border-red-800';
                    return (
                      <div key={idx} className={`flex items-start gap-3 p-3 rounded-lg border bg-card ${border}`}>
                        <RIcon className={`w-4 h-4 mt-0.5 shrink-0 ${clr}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{r.namaItem}</span>
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{r.tipe.replace(/_/g, ' ')}</span>
                          </div>
                          <p className="text-xs mt-0.5">{r.detail}</p>
                          {r.keterangan && <p className="text-xs text-muted-foreground/70 mt-0.5 italic">{r.keterangan}</p>}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* History */}
      {checks.length > 1 && (
        <div className="border-t border-border pt-4">
          <button
            onClick={() => setShowHistory(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <History className="w-4 h-4" />
            Riwayat Pemeriksaan ({checks.length})
            {showHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showHistory && (
            <div className="mt-3 space-y-2">
              {checks.map(c => {
                const cfg2 = STATUS_CFG[c.overallStatus];
                const Icon2 = cfg2.Icon;
                const isSelected = c.id === currentCheck?.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => { setCurrentCheck(c); setResultTab('items'); }}
                    className={`w-full text-left flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30 bg-card'
                    }`}
                  >
                    <Icon2 className={`w-4 h-4 shrink-0 ${
                      c.overallStatus === 'valid' ? 'text-emerald-500' : c.overallStatus === 'warning' ? 'text-amber-500' : 'text-red-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium truncate max-w-[200px]">{c.namaFileBilling}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDateTime(c.createdAt)}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {c.totalItem} item · {c.itemSelisih} selisih · {c.itemTidakDitemukan} tdk ditemukan · {c.checkedByName}
                      </div>
                    </div>
                    {isSelected && <span className="text-[10px] text-primary font-semibold shrink-0">Ditampilkan</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <Card className="shadow-none">
      <CardContent className="px-3 py-2 text-center">
        <div className={`text-xl font-bold ${cls}`}>{value}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{label}</div>
      </CardContent>
    </Card>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
