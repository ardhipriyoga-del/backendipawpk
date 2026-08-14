import React, { useState, useEffect, useCallback } from 'react';
import { getDB, Patient, UraianKonfirmasi, UraianRiwayat } from '../lib/db';
import { generateUUID } from '../lib/auth';
import { patientEpisodeKey } from '../lib/patientIdentity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Printer, FileDown, Save, RotateCcw, Plus, Trash2,
  Loader2, FileText, Eye, Edit2, ClipboardList,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDate, formatDateTime } from '../lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type FormData = Omit<UraianKonfirmasi, 'noRM' | 'episodeNo' | 'recordKey' | 'riwayat' | 'updatedAt' | 'updatedBy'>;

interface AuthUser {
  id: number;
  username?: string;
  namaLengkap: string;
  role?: string;
}

interface Props {
  patient: Patient;
  user: AuthUser;
  onClose: () => void;
}

// ── Template form state ────────────────────────────────────────────────────────

type DijaminOpt = 'Dijamin' | 'Tidak Dijamin';
type AdaOpt = 'Sudah Ada' | 'Belum Ada';
type SelisihOpt = 'Internal' | 'Bayar di Tempat';

interface TemplateFormState {
  konfirmasiMasukDengan: string;
  vitamin: DijaminOpt;
  suplemen: DijaminOpt;
  herbal: DijaminOpt;
  nonMedis: DijaminOpt;
  selisihBayar: SelisihOpt;
  benefitAneka: string;
  batasanKonfirmasi: string;
  lma: AdaOpt;
  jaminanAwal: AdaOpt;
  suratPernyataan: AdaOpt;
}

const EMPTY_TEMPLATE: TemplateFormState = {
  konfirmasiMasukDengan: '',
  vitamin: 'Dijamin',
  suplemen: 'Dijamin',
  herbal: 'Dijamin',
  nonMedis: 'Dijamin',
  selisihBayar: 'Internal',
  benefitAneka: '',
  batasanKonfirmasi: '',
  lma: 'Belum Ada',
  jaminanAwal: 'Belum Ada',
  suratPernyataan: 'Belum Ada',
};

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_FORM: FormData = {
  noKartu: '',
  kelasDitempati: '',
  jatahKelas: '',
  apsPenuhSesuai: '',
  tlpAsuransi: '',
  email: '',
  konfirmasiMasukDengan: '',
  vitamin: 'dijamin',
  suplemen: 'dijamin',
  nonMedis: 'dijamin',
  herbal: 'dijamin',
  selisihBayar: 'internal',
  benefitAneka: '',
  batasanKonfirmasi: '',
  lma: 'belum_ada',
  jaminan: 'belum_ada',
  suratPernyataan: 'belum_ada',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const todayStr = () =>
  formatDate(new Date());

const nowStr = () =>
  new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

/** Escape HTML special chars */
const escHtml = (s: string) =>
  (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const dash = (v?: string | null) => (v && v.trim()) ? v : '-';

/** Build formatted uraian text from template form */
function buildTemplateText(t: TemplateFormState): string {
  const lines: string[] = [];

  lines.push(`KONFIRMASI PASIEN MASUK DENGAN: ${t.konfirmasiMasukDengan || '...'}`);
  lines.push('');
  lines.push(`VITAMIN                    : ${t.vitamin}`);
   lines.push(`SUPLEMEN                    : ${t.suplemen}`);
  lines.push(`HERBAL                     : ${t.herbal}`);
  lines.push(`NON MEDIS                  : ${t.nonMedis}`);
  lines.push(`SELISIH BAYAR              : ${t.selisihBayar}`);
  lines.push('');
  lines.push(`BENEFIT ANEKA KEPERAWATAN  :`);
  lines.push(t.benefitAneka.trim() || '-');
  lines.push('');
   lines.push(`BATASAN KONFIRMASI OBAT/LAB/RADIOLOGI :`);
  lines.push(t.batasanKonfirmasi.trim() || '-');
  lines.push('');
  lines.push(`LMA                        : ${t.lma}`);
  lines.push(`JAMINAN AWAL               : ${t.jaminanAwal}`);
  lines.push(`SURAT PERNYATAAN           : ${t.suratPernyataan}`);

  return lines.join('\n');
}

// ── Print HTML ────────────────────────────────────────────────────────────────

function buildPrintHTML(patient: Patient, form: FormData, riwayat: UraianRiwayat[]): string {
  const diagnosa = patient.diagnosaMasuk || patient.diagnosakUtama || '-';
  const printedAt = formatDateTime(new Date());

  const dataRows = riwayat
    .map(
      r => `
      <tr class="data-row">
        <td class="col-tgl">${escHtml(dash(r.tanggal))}</td>
        <td class="col-jam">${escHtml(dash(r.jam))}</td>
        <td class="col-uraian" style="white-space:pre-wrap">${escHtml(r.uraian || '')}</td>
        <td class="col-ptgs">${escHtml(dash(r.petugas))}</td>
      </tr>`,
    )
    .join('');

  // Filler rows script — runs in both preview iframe and print window
  // Measures remaining vertical space after table and inserts bordered empty rows
  const fillerScript = `
<script>
(function(){
  var MIN_ROW_H = 20; // px — minimum height per empty row

  function emptyRow() {
    var tr = document.createElement('tr');
    tr.className = 'filler-row';
    tr.innerHTML =
      '<td class="col-tgl"></td>' +
      '<td class="col-jam"></td>' +
      '<td class="col-uraian"></td>' +
      '<td class="col-ptgs"></td>';
    return tr;
  }

  function fill() {
    var tbody  = document.getElementById('ub');
    var footer = document.getElementById('ft');
    if (!tbody) return;

    // Remove previously inserted fillers
    [].slice.call(tbody.querySelectorAll('.filler-row')).forEach(function(el){ el.remove(); });

    // Available content-area height.
    // In the preview iframe clientHeight ≈ iframe outer height.
    // In a print window beforeprint fires with the real printable height.
    var pageH   = Math.max(document.documentElement.clientHeight,
                           document.documentElement.scrollHeight);
    var ftH     = footer ? footer.offsetHeight + 6 : 20;
    var tbotY   = tbody.getBoundingClientRect().bottom;
    var remaining = pageH - tbotY - ftH;

    if (remaining < MIN_ROW_H) return; // nothing to fill

    var count = Math.floor(remaining / MIN_ROW_H);
    var frag  = document.createDocumentFragment();
    for (var i = 0; i < count; i++) { frag.appendChild(emptyRow()); }
    tbody.appendChild(frag);
  }

  // Run on load and on resize (covers iframe resize in preview)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fill);
  } else {
    fill();
  }
  window.addEventListener('resize', fill);

  // Re-run just before browser opens the print dialog so it
  // measures the actual print-area height
  window.addEventListener('beforeprint', function(){
    [].slice.call(
      document.querySelectorAll('#ub .filler-row')
    ).forEach(function(el){ el.remove(); });
    fill();
  });
})();
</script>`;

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>Uraian Konfirmasi — ${escHtml(patient.namaPasien)}</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html {
    height: 100%;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 10pt;
    color: #000;
  }
  body {
    min-height: 100%;
    display: flex;
    flex-direction: column;
  }

  /* ── Title ── */
  .title {
    text-align: center;
    font-size: 14pt;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-bottom: 8px;
    padding-bottom: 5px;
    border-bottom: 2px solid #000;
  }

  /* ── Info grid ── */
  .info-grid {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 8px;
    font-size: 10pt;
  }
  .info-grid td { padding: 2px 3px; vertical-align: top; }
  .info-grid .lbl  { font-weight: bold; white-space: nowrap; width: 122px; }
  .info-grid .colon { width: 8px; text-align: center; }
  .info-grid .gap  { width: 16px; }

  /* ── Table wrap grows to fill remaining vertical space ── */
  .tbl-wrap { flex: 1; display: flex; flex-direction: column; }

  /* ── Uraian table ── */
  .uraian-tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 10pt;
    page-break-inside: auto;
  }
  .uraian-tbl thead { display: table-header-group; }
  .uraian-tbl th {
    border: 1px solid #444;
    padding: 5px 6px;
    font-weight: bold;
    text-align: center;
    background: #F2F2F2;
    font-size: 10pt;
  }
  .uraian-tbl td {
    border: 1px solid #444;
    padding: 5px 6px;
    vertical-align: top;
    font-size: 10pt;
  }
  .data-row   { page-break-inside: avoid; }
  .filler-row { page-break-inside: avoid; }
  .filler-row td { border: 1px solid #444; height: 20px; }

  .col-tgl    { width: 13%; }
  .col-jam    { width: 9%;  }
  .col-uraian { width: 63%; }
  .col-ptgs   { width: 15%; }

  /* ── Footer ── */
  .footer {
    font-size: 8pt;
    color: #555;
    text-align: right;
    padding-top: 4px;
    flex-shrink: 0;
  }

  /* ── Print: hide browser chrome ── */
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

  <div class="title">URAIAN KONFIRMASI ASURANSI DAN PERUSAHAAN</div>

  <!-- ── Identity grid ── -->
  <table class="info-grid">
    <tr>
      <td class="lbl">NAMA PASIEN</td>
      <td class="colon">:</td>
      <td class="val"><strong>${escHtml(patient.namaPasien)}</strong></td>
      <td class="gap"></td>
      <td class="lbl">NO. KARTU</td>
      <td class="colon">:</td>
      <td class="val">${escHtml(dash(form.noKartu))}</td>
    </tr>
    <tr>
      <td class="lbl">NOMOR RM</td>
      <td class="colon">:</td>
      <td class="val">${escHtml(patient.noRM)}</td>
      <td class="gap"></td>
      <td class="lbl">KELAS DITEMPATI</td>
      <td class="colon">:</td>
      <td class="val">${escHtml(dash(form.kelasDitempati))}</td>
    </tr>
    <tr>
      <td class="lbl">TANGGAL LAHIR</td>
      <td class="colon">:</td>
      <td class="val">${escHtml(dash(patient.dob))}</td>
      <td class="gap"></td>
      <td class="lbl">JATAH KELAS</td>
      <td class="colon">:</td>
      <td class="val">${escHtml(dash(form.jatahKelas))}</td>
    </tr>
    <tr>
      <td class="lbl">JENIS KELAMIN</td>
      <td class="colon">:</td>
      <td class="val">${escHtml(dash(patient.sexDesc))}</td>
      <td class="gap"></td>
      <td class="lbl">APS / PENUH / SESUAI</td>
      <td class="colon">:</td>
      <td class="val">${escHtml(dash(form.apsPenuhSesuai))}</td>
    </tr>
    <tr>
      <td class="lbl">DPJP</td>
      <td class="colon">:</td>
      <td class="val">${escHtml(dash(patient.dpjp))}</td>
      <td class="gap"></td>
      <td class="lbl">NOMOR HP</td>
      <td class="colon">:</td>
      <td class="val">${escHtml(dash(form.tlpAsuransi))}</td>
    </tr>
    <tr>
      <td class="lbl">DIAGNOSA</td>
      <td class="colon">:</td>
      <td class="val">${escHtml(dash(diagnosa))}</td>
      <td class="gap"></td>
      <td class="lbl">EMAIL</td>
      <td class="colon">:</td>
      <td class="val">${escHtml(dash(form.email))}</td>
    </tr>
    <tr>
      <td class="lbl">PENJAMIN</td>
      <td class="colon">:</td>
      <td class="val">${escHtml(dash(patient.payor))}</td>
      <td class="gap"></td>
      <td></td><td></td><td></td>
    </tr>
  </table>

  <!-- ── Uraian table — fills remaining vertical space ── -->
  <div class="tbl-wrap">
    <table class="uraian-tbl">
      <thead>
        <tr>
          <th class="col-tgl">TANGGAL</th>
          <th class="col-jam">JAM</th>
          <th class="col-uraian">URAIAN</th>
          <th class="col-ptgs">PETUGAS</th>
        </tr>
      </thead>
      <tbody id="ub">
        ${dataRows}
      </tbody>
    </table>
  </div>

  <div class="footer" id="ft">Dicetak: ${printedAt}</div>

  ${fillerScript}
</body>
</html>`;
}

// ── PDF Export ────────────────────────────────────────────────────────────────

function generateUraianPDF(patient: Patient, form: FormData, riwayat: UraianRiwayat[]): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const diagnosa = patient.diagnosaMasuk || patient.diagnosakUtama || '-';
  const mL = 15;
  const mR = 15;
  const pageW = 210;
  const usableW = pageW - mL - mR;
  let y = 15;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('URAIAN KONFIRMASI ASURANSI DAN PERUSAHAAN', pageW / 2, y, { align: 'center' });
  y += 5;
  doc.setLineWidth(0.5);
  doc.line(mL, y, pageW - mR, y);
  y += 6;

  doc.setFontSize(10);
  const lblW = 36;
  const colGap = 6;
  const halfW = usableW / 2;
  const midX = mL + halfW + colGap / 2;

  const left: [string, string][] = [
    ['NAMA PASIEN', patient.namaPasien],
    ['NOMOR RM', patient.noRM],
    ['TANGGAL LAHIR', dash(patient.dob)],
    ['JENIS KELAMIN', dash(patient.sexDesc)],
    ['DPJP', dash(patient.dpjp)],
    ['DIAGNOSA', dash(diagnosa)],
    ['PENJAMIN', dash(patient.payor)],
  ];
  const right: [string, string][] = [
    ['NO. KARTU', dash(form.noKartu)],
    ['KELAS DITEMPATI', dash(form.kelasDitempati)],
    ['JATAH KELAS', dash(form.jatahKelas)],
    ['APS/PENUH/SESUAI', dash(form.apsPenuhSesuai)],
    ['NOMOR HP', dash(form.tlpAsuransi)],
    ['EMAIL', dash(form.email)],
  ];

  const rowH = 6;

  left.forEach(([lbl, val], i) => {
    const ry = y + i * rowH;
    doc.setFont('helvetica', 'bold');
    doc.text(lbl, mL, ry);
    doc.setFont('helvetica', 'normal');
    const valText = `: ${val}`;
    const maxW = halfW - lblW - 2;
    const lines = doc.splitTextToSize(valText, maxW);
    doc.text(lines[0], mL + lblW, ry);
  });
  right.forEach(([lbl, val], i) => {
    const ry = y + i * rowH;
    doc.setFont('helvetica', 'bold');
    doc.text(lbl, midX, ry);
    doc.setFont('helvetica', 'normal');
    const valText = `: ${val}`;
    const maxW = halfW - lblW - 2;
    const lines = doc.splitTextToSize(valText, maxW);
    doc.text(lines[0], midX + lblW, ry);
  });

  y += Math.max(left.length, right.length) * rowH + 4;

  // ── Estimate empty rows needed to fill the first page ──
  // A4 content height = 297 - 15(top) - 15(bottom) = 267 mm
  // Header area (title + info + table header) ≈ y + 8 mm (table th)
  const tableHeaderH = 8; // mm for the <th> row
  const pageContentH = 267; // mm
  const footerH = 6;        // mm reserved for timestamp footer
  const availableForRows = pageContentH - y - tableHeaderH - footerH;
  const minRowH = 8;         // mm — minimum empty row height in PDF
  const rowsNeeded = Math.max(0, Math.ceil(availableForRows / minRowH) - riwayat.length);

  const dataRows = riwayat.map(r => [
    formatDate(r.tanggal),
    r.jam || '-',
    r.uraian || '',
    r.petugas || '-',
  ]);

  // Pad with empty rows so the table reaches the bottom of page 1
  const fillerRows: string[][] = Array.from({ length: rowsNeeded }, () => ['', '', '', '']);
  const tableBody = dataRows.length > 0
    ? [...dataRows, ...fillerRows]
    : [...fillerRows.slice(0, Math.max(fillerRows.length, 1))];

  const tglW = 24;
  const jamW = 16;
  const ptgsW = 30;
  const uraianW = usableW - tglW - jamW - ptgsW;

  autoTable(doc, {
    startY: y,
    head: [['TANGGAL', 'JAM', 'URAIAN', 'PETUGAS']],
    body: tableBody,
    theme: 'grid',
    styles: {
      fontSize: 10,
      cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
      minCellHeight: minRowH,
      valign: 'top',
      overflow: 'linebreak',
      font: 'helvetica',
      lineColor: [68, 68, 68],
      lineWidth: 0.3,
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 10,
    },
    columnStyles: {
      0: { cellWidth: tglW },
      1: { cellWidth: jamW },
      2: { cellWidth: uraianW },
      3: { cellWidth: ptgsW },
    },
    margin: { left: mL, right: mR },
    showHead: 'everyPage',
  });

  const pageCount = (doc.internal as any).getNumberOfPages?.() ?? 1;
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Dicetak: ${formatDateTime(new Date())}`,
      pageW - mR,
      297 - 8,
      { align: 'right' },
    );
    doc.setTextColor(0, 0, 0);
  }

  doc.save(`UraianKonfirmasi_${patient.noRM}_${patient.namaPasien.replace(/\s+/g, '_')}.pdf`);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
      <span className="text-sm font-medium">
        {value?.trim() ? value : <span className="italic text-muted-foreground/50">—</span>}
      </span>
    </div>
  );
}

function FieldRow({
  label,
  value,
  onChange,
  editable,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
      {editable ? (
        <Input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || label}
          className="h-8 text-sm"
        />
      ) : (
        <span className="text-sm font-medium">
          {value?.trim() ? value : <span className="italic text-muted-foreground/50">—</span>}
        </span>
      )}
    </div>
  );
}

// ── Template Form Dialog ───────────────────────────────────────────────────────

function TemplateFormDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (text: string) => void;
}) {
  const [form, setForm] = useState<TemplateFormState>({ ...EMPTY_TEMPLATE });

  const set = <K extends keyof TemplateFormState>(key: K, val: TemplateFormState[K]) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const handleConfirm = () => {
    onConfirm(buildTemplateText(form));
    setForm({ ...EMPTY_TEMPLATE });
    onClose();
  };

  const handleClose = () => {
    setForm({ ...EMPTY_TEMPLATE });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-lg w-[96vw] max-h-[92vh] flex flex-col p-0 overflow-hidden"
        onInteractOutside={e => e.preventDefault()}
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm font-bold">
            <ClipboardList className="w-4 h-4 text-emerald-600" />
            Form Template Uraian Konfirmasi
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Isi form di bawah, lalu klik <strong>Masukkan ke Tabel</strong>.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* 1. Konfirmasi Pasien Masuk Dengan */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              1. Konfirmasi Pasien Masuk Dengan
            </Label>
            <Input
              value={form.konfirmasiMasukDengan}
              onChange={e => set('konfirmasiMasukDengan', e.target.value)}
              placeholder="Contoh: Surat Jaminan, BPJS, Asuransi XYZ..."
              className="text-sm h-8"
            />
          </div>

          {/* Dropdown group */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

            {/* 2. Vitamin */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                2. Vitamin
              </Label>
              <Select value={form.vitamin} onValueChange={v => set('vitamin', v as DijaminOpt)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Dijamin">Dijamin</SelectItem>
                  <SelectItem value="Tidak Dijamin">Tidak Dijamin</SelectItem>
                </SelectContent>
              </Select>
            </div>

             {/* 3. Suplemen */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                 3. Suplemen
              </Label>
              <Select value={form.suplemen} onValueChange={v => set('suplemen', v as DijaminOpt)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Dijamin">Dijamin</SelectItem>
                  <SelectItem value="Tidak Dijamin">Tidak Dijamin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 4. Herbal */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                4. Herbal
              </Label>
              <Select value={form.herbal} onValueChange={v => set('herbal', v as DijaminOpt)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Dijamin">Dijamin</SelectItem>
                  <SelectItem value="Tidak Dijamin">Tidak Dijamin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 5. Non Medis */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                5. Non Medis
              </Label>
              <Select value={form.nonMedis} onValueChange={v => set('nonMedis', v as DijaminOpt)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Dijamin">Dijamin</SelectItem>
                  <SelectItem value="Tidak Dijamin">Tidak Dijamin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 6. Selisih Bayar */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                6. Selisih Bayar
              </Label>
              <Select value={form.selisihBayar} onValueChange={v => set('selisihBayar', v as SelisihOpt)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Internal">Internal</SelectItem>
                  <SelectItem value="Bayar di Tempat">Bayar di Tempat</SelectItem>
                </SelectContent>
              </Select>
            </div>

          </div>

          {/* 7. Benefit Aneka Keperawatan */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              7. Benefit Aneka Keperawatan
            </Label>
            <Textarea
              value={form.benefitAneka}
              onChange={e => set('benefitAneka', e.target.value)}
              placeholder="Isi bebas..."
              className="text-sm min-h-[64px] resize-y"
            />
          </div>

          {/* 8. Batasan Konfirmasi */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
               8. Batasan Konfirmasi Obat / Lab / Radiologi
            </Label>
            <Textarea
              value={form.batasanKonfirmasi}
              onChange={e => set('batasanKonfirmasi', e.target.value)}
              placeholder="Contoh: Rp. 5.000.000  /  Unlimited  /  Tidak Ada"
              className="text-sm min-h-[56px] resize-y"
            />
          </div>

          {/* 9-11. LMA / Jaminan / Surat Pernyataan */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                9. LMA
              </Label>
              <Select value={form.lma} onValueChange={v => set('lma', v as AdaOpt)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Sudah Ada">Sudah Ada</SelectItem>
                  <SelectItem value="Belum Ada">Belum Ada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                10. Jaminan Awal
              </Label>
              <Select value={form.jaminanAwal} onValueChange={v => set('jaminanAwal', v as AdaOpt)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Sudah Ada">Sudah Ada</SelectItem>
                  <SelectItem value="Belum Ada">Belum Ada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                11. Surat Pernyataan
              </Label>
              <Select value={form.suratPernyataan} onValueChange={v => set('suratPernyataan', v as AdaOpt)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Sudah Ada">Sudah Ada</SelectItem>
                  <SelectItem value="Belum Ada">Belum Ada</SelectItem>
                </SelectContent>
              </Select>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center justify-end gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={handleClose} className="h-8 text-xs">
            Batal
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <ClipboardList className="w-3.5 h-3.5 mr-1" />
            Masukkan ke Tabel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function UraianKonfirmasiPanel({ patient, user, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [form, setForm] = useState<FormData>({ ...EMPTY_FORM });
  const [riwayat, setRiwayat] = useState<UraianRiwayat[]>([]);
  const [lastSavedBy, setLastSavedBy] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDB();
      let data = await db.get('uraianKonfirmasiEpisodes', patientEpisodeKey(patient));
      if (!data) {
        const legacy = await db.get('uraianKonfirmasi', patient.noRM);
        const activeSameRm = (await db.getAll('patients')).filter(
          candidate => candidate.status === 'aktif' && candidate.noRM === patient.noRM,
        );
        if (legacy && activeSameRm.length === 1) {
          data = { ...legacy, episodeNo: patient.episodeNo, recordKey: patientEpisodeKey(patient) };
        }
      }
      if (data) {
        const { riwayat: r, noRM: _n, episodeNo: _e, recordKey: _k, updatedAt: _t, updatedBy, ...rest } = data;
        setForm({ ...EMPTY_FORM, ...rest });
        setRiwayat(r || []);
        setLastSavedBy(updatedBy || '');
        setIsEditMode(false);
      } else {
        setForm({ ...EMPTY_FORM });
        setRiwayat([]);
        setLastSavedBy('');
        setIsEditMode(true);
      }
    } catch {
      toast.error('Gagal memuat data uraian konfirmasi');
    } finally {
      setLoading(false);
    }
  }, [patient.noRM, patient.episodeNo]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      const db = await getDB();
      const record: UraianKonfirmasi = {
        ...form,
        noRM: patient.noRM,
        episodeNo: patient.episodeNo,
        recordKey: patientEpisodeKey(patient),
        riwayat,
        updatedAt: Date.now(),
        updatedBy: user.namaLengkap,
      };
      await db.put('uraianKonfirmasiEpisodes', record);
      setLastSavedBy(user.namaLengkap);
      setIsEditMode(false);
      toast.success('Draft berhasil disimpan');
    } catch {
      toast.error('Gagal menyimpan data');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => loadData();

  const handleReset = () => {
    if (!confirm('Reset semua data uraian konfirmasi untuk pasien ini? Tindakan ini tidak dapat dibatalkan.')) return;
    setForm({ ...EMPTY_FORM });
    setRiwayat([]);
    setLastSavedBy('');
    setIsEditMode(true);
  };

  const handlePreview = () => {
    setPreviewHtml(buildPrintHTML(patient, form, riwayat));
    setShowPreview(true);
  };

  const handlePrint = () => {
    const html = buildPrintHTML(patient, form, riwayat);
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) { toast.error('Gagal membuka jendela cetak. Periksa pop-up blocker.'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 700);
  };

  const handleExportPDF = () => generateUraianPDF(patient, form, riwayat);

  // ── Riwayat CRUD ──────────────────────────────────────────────────────────

  const addEmptyRow = () => {
    setRiwayat(prev => [
      ...prev,
      { id: generateUUID(), tanggal: todayStr(), jam: nowStr(), uraian: '', petugas: user.namaLengkap },
    ]);
    if (!isEditMode) setIsEditMode(true);
  };

  /** Called by TemplateFormDialog when user clicks "Masukkan ke Tabel" */
  const handleTemplateConfirm = (text: string) => {
    setRiwayat(prev => [
      ...prev,
      { id: generateUUID(), tanggal: todayStr(), jam: nowStr(), uraian: text, petugas: user.namaLengkap },
    ]);
    if (!isEditMode) setIsEditMode(true);
  };

  const updateRow = (id: string, field: keyof UraianRiwayat, value: string) =>
    setRiwayat(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));

  const removeRow = (id: string) =>
    setRiwayat(prev => prev.filter(r => r.id !== id));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Template Form Dialog ───────────────────────────────────────── */}
      <TemplateFormDialog
        open={showTemplateForm}
        onClose={() => setShowTemplateForm(false)}
        onConfirm={handleTemplateConfirm}
      />

      {/* ── Main Dialog ────────────────────────────────────────────────── */}
      <Dialog open onOpenChange={() => onClose()}>
        <DialogContent
          className="max-w-5xl w-[98vw] max-h-[96vh] flex flex-col p-0 overflow-hidden"
          onInteractOutside={e => e.preventDefault()}
        >

          {/* Header */}
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-start gap-3">
              <div className="flex-1 min-w-0">
                <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                  <FileText className="w-5 h-5 text-emerald-600 shrink-0" />
                  Uraian Konfirmasi Asuransi
                </DialogTitle>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 truncate">
                  {patient.namaPasien}
                  {' · '}
                  <span className="font-mono">{patient.noRM}</span>
                  {patient.payor ? ` · ${patient.payor}` : ''}
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center flex-wrap gap-1.5 shrink-0">
                {isEditMode ? (
                  <>
                    <Button
                      variant="outline" size="sm"
                      onClick={handleCancel} disabled={saving}
                      className="h-8 text-xs"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      Batal
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave} disabled={saving}
                      className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      {saving
                        ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                        : <Save className="w-3.5 h-3.5 mr-1" />}
                      Simpan Draft
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setIsEditMode(true)}
                    className="h-8 text-xs"
                  >
                    <Edit2 className="w-3.5 h-3.5 mr-1" />
                    Edit
                  </Button>
                )}

                <Button variant="outline" size="sm" onClick={handlePreview} className="h-8 text-xs">
                  <Eye className="w-3.5 h-3.5 mr-1" />
                  Preview
                </Button>
                <Button variant="outline" size="sm" onClick={handlePrint} className="h-8 text-xs">
                  <Printer className="w-3.5 h-3.5 mr-1" />
                  Cetak
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportPDF} className="h-8 text-xs">
                  <FileDown className="w-3.5 h-3.5 mr-1" />
                  Export PDF
                </Button>
                <Button
                  variant="ghost" size="sm"
                  onClick={handleReset}
                  className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  Reset
                </Button>
              </div>
            </div>
          </DialogHeader>

          {/* Body */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center py-16">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground text-sm">Memuat data...</span>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* ── Section 1: Informasi Pasien ── */}
              <Card className="shadow-none border-border">
                 <CardHeader className="py-2.5 px-4 bg-muted/25 border-b border-border border-l-2 border-l-primary rounded-t-lg">
                   <CardTitle className="text-xs font-bold text-foreground uppercase tracking-wide">
                    Informasi Pasien
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3">

                    {/* Kolom kiri — otomatis */}
                    <div className="space-y-3">
                      <InfoRow label="Nama Pasien"    value={patient.namaPasien} />
                      <InfoRow label="Nomor RM"       value={patient.noRM} />
                      <InfoRow label="Tanggal Lahir"  value={patient.dob} />
                      <InfoRow label="Jenis Kelamin"  value={patient.sexDesc} />
                      <InfoRow label="DPJP"           value={patient.dpjp} />
                      <InfoRow label="Diagnosa"       value={patient.diagnosaMasuk || patient.diagnosakUtama} />
                      <InfoRow label="Penjamin"       value={patient.payor} />
                    </div>

                    {/* Kolom kanan — diisi manual */}
                    <div className="space-y-3">
                      <FieldRow
                        label="No. Kartu"
                        value={form.noKartu}
                        onChange={v => setForm(f => ({ ...f, noKartu: v }))}
                        editable={isEditMode}
                      />
                      <FieldRow
                        label="Kelas Ditempati"
                        value={form.kelasDitempati}
                        onChange={v => setForm(f => ({ ...f, kelasDitempati: v }))}
                        editable={isEditMode}
                        placeholder={patient.roomType}
                      />
                      <FieldRow
                        label="Jatah Kelas"
                        value={form.jatahKelas}
                        onChange={v => setForm(f => ({ ...f, jatahKelas: v }))}
                        editable={isEditMode}
                      />
                      <FieldRow
                        label="APS / Penuh / Sesuai"
                        value={form.apsPenuhSesuai}
                        onChange={v => setForm(f => ({ ...f, apsPenuhSesuai: v }))}
                        editable={isEditMode}
                      />
                      <FieldRow
                        label="Nomor HP"
                        value={form.tlpAsuransi}
                        onChange={v => setForm(f => ({ ...f, tlpAsuransi: v }))}
                        editable={isEditMode}
                      />
                      <FieldRow
                        label="Email"
                        value={form.email}
                        onChange={v => setForm(f => ({ ...f, email: v }))}
                        editable={isEditMode}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* ── Section 2: Tabel Uraian ── */}
              <Card className="shadow-none border-border">
                 <CardHeader className="py-2.5 px-4 bg-muted/25 border-b border-border border-l-2 border-l-primary rounded-t-lg">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                     <CardTitle className="text-xs font-bold text-foreground uppercase tracking-wide">
                      Tabel Uraian Konfirmasi
                      {riwayat.length > 0 && (
                        <span className="ml-2 font-normal text-muted-foreground normal-case">
                          ({riwayat.length} baris)
                        </span>
                      )}
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button
                        size="sm" variant="outline"
                        onClick={() => setShowTemplateForm(true)}
                         className="h-7 text-xs gap-1.5 border-primary/40 text-primary hover:bg-primary/5"
                      >
                        <ClipboardList className="w-3.5 h-3.5" />
                        Tambah Template
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        onClick={addEmptyRow}
                        className="h-7 text-xs gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Tambah Baris
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-0">
                  {riwayat.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground text-sm">
                      <FileText className="w-8 h-8 mx-auto mb-2.5 opacity-20" />
                      <p>Belum ada baris uraian.</p>
                      <p className="mt-1 text-xs">
                        Klik <strong>Tambah Template</strong> untuk membuka form konfirmasi, atau{' '}
                        <strong>Tambah Baris</strong> untuk baris kosong.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="bg-muted/40">
                            <th className="text-left px-3 py-2 border border-border font-semibold text-xs w-[110px]">
                              Tanggal
                            </th>
                            <th className="text-left px-3 py-2 border border-border font-semibold text-xs w-[80px]">
                              Jam
                            </th>
                            <th className="text-left px-3 py-2 border border-border font-semibold text-xs">
                              Uraian
                            </th>
                            <th className="text-left px-3 py-2 border border-border font-semibold text-xs w-[130px]">
                              Petugas
                            </th>
                            <th className="w-9 border border-border" />
                          </tr>
                        </thead>
                        <tbody>
                          {riwayat.map(row => (
                            <tr key={row.id} className="hover:bg-muted/10 align-top">

                              {/* Tanggal */}
                              <td className="px-2 py-2 border border-border align-top">
                                {isEditMode ? (
                                  <Input
                                    value={row.tanggal}
                                    onChange={e => updateRow(row.id, 'tanggal', e.target.value)}
                                    className="h-7 text-xs"
                                  />
                                ) : (
                                  <span className="text-xs leading-relaxed">{formatDate(row.tanggal)}</span>
                                )}
                              </td>

                              {/* Jam */}
                              <td className="px-2 py-2 border border-border align-top">
                                {isEditMode ? (
                                  <Input
                                    value={row.jam}
                                    onChange={e => updateRow(row.id, 'jam', e.target.value)}
                                    className="h-7 text-xs"
                                  />
                                ) : (
                                  <span className="text-xs leading-relaxed">{row.jam}</span>
                                )}
                              </td>

                              {/* Uraian */}
                              <td className="px-2 py-2 border border-border align-top">
                                {isEditMode ? (
                                  <Textarea
                                    value={row.uraian}
                                    onChange={e => updateRow(row.id, 'uraian', e.target.value)}
                                    className="min-h-[80px] text-xs resize-y leading-relaxed font-mono"
                                    placeholder="Isi uraian konfirmasi..."
                                  />
                                ) : (
                                  <span className="text-xs whitespace-pre-wrap leading-relaxed block font-mono">
                                    {row.uraian}
                                  </span>
                                )}
                              </td>

                              {/* Petugas */}
                              <td className="px-2 py-2 border border-border align-top">
                                {isEditMode ? (
                                  <Input
                                    value={row.petugas}
                                    onChange={e => updateRow(row.id, 'petugas', e.target.value)}
                                    className="h-7 text-xs"
                                  />
                                ) : (
                                  <span className="text-xs leading-relaxed">{row.petugas}</span>
                                )}
                              </td>

                              {/* Delete */}
                              <td className="px-1 py-2 border border-border text-center align-top">
                                {isEditMode && (
                                  <button
                                    type="button"
                                    onClick={() => removeRow(row.id)}
                                    className="p-1.5 rounded text-destructive hover:bg-destructive/10 transition-colors"
                                    title="Hapus baris"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

            </div>
          )}

          {/* Footer */}
          <div className="px-6 py-3 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
            <p className="text-xs text-muted-foreground">
              {lastSavedBy
                ? `Terakhir disimpan oleh: ${lastSavedBy}`
                : 'Belum pernah disimpan'}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
                Tutup
              </Button>
              {isEditMode && (
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {saving
                    ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    : <Save className="w-3.5 h-3.5 mr-1" />}
                  Simpan Draft
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Preview Dialog ─────────────────────────────────────────────── */}
      {showPreview && (
        <Dialog open onOpenChange={() => setShowPreview(false)}>
          <DialogContent
            className="max-w-5xl w-[97vw] max-h-[97vh] flex flex-col p-0 overflow-hidden"
            onInteractOutside={e => e.preventDefault()}
          >
            <DialogHeader className="px-5 py-3 border-b border-border shrink-0">
              <div className="flex items-center justify-between">
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <Eye className="w-4 h-4 text-emerald-600" />
                  Preview Cetak — {patient.namaPasien}
                </DialogTitle>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handlePrint} className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Printer className="w-3.5 h-3.5 mr-1" />
                    Cetak Langsung
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleExportPDF} className="h-8 text-xs">
                    <FileDown className="w-3.5 h-3.5 mr-1" />
                    Export PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowPreview(false)} className="h-8 text-xs">
                    Tutup
                  </Button>
                </div>
              </div>
            </DialogHeader>

            {/* A4 preview area */}
            <div className="flex-1 overflow-auto bg-slate-300 dark:bg-slate-700 p-6 flex justify-center">
              <iframe
                srcDoc={previewHtml}
                title="Preview Uraian Konfirmasi"
                sandbox="allow-same-origin allow-scripts"
                className="shadow-2xl"
                style={{
                  width: '210mm',
                  minHeight: '297mm',
                  background: 'white',
                  border: 'none',
                  display: 'block',
                }}
              />
            </div>

            <div className="px-5 py-2 border-t border-border bg-muted/30 shrink-0">
              <p className="text-xs text-muted-foreground text-center">
                Preview ini identik dengan hasil cetak · Ukuran kertas: A4 Portrait · Margin: 15 mm
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
