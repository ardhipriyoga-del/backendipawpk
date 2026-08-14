import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getDB } from './db';
import { formatDate, formatDateTime } from './utils';

export const generateHandoverPDF = async (
  operanId: string,
  userSerah: string,
  userTerima: string,
  pendings: any[],
  justInfos: any[]
): Promise<string> => {
  const db = await getDB();
  const settings = await db.getAll('settings');
  const rsName = settings.find(s => s.key === 'rsName')?.value || 'RS EMC Pekayon';
  
  const doc = new jsPDF('p', 'pt', 'a4');
  
  // Header
  doc.setFontSize(16);
  doc.text(rsName, 40, 40);
  doc.setFontSize(14);
  doc.text('Laporan Operan Shift Admission', 40, 60);
  doc.setFontSize(10);
  doc.text(`Waktu: ${formatDateTime(new Date())}`, 40, 75);
  doc.text(`Dari: ${userSerah}   Ke: ${userTerima}`, 40, 90);

  // Pre-load patients map for Just Info lookup
  const allPatients = await db.getAll('patients');
  const patientMap: Record<string, any> = {};
  for (const p of allPatients) patientMap[p.noRM] = p;

  let startY = 110;

  // ── Pending Items Table ──────────────────────────────────────────────────
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Ringkasan Pending', 40, startY);
  doc.setFont('helvetica', 'normal');
  startY += 10;

  if (pendings.length === 0) {
    doc.setFontSize(9);
    doc.text('Tidak ada pending yang aktif.', 40, startY + 10);
    startY += 25;
  } else {
    autoTable(doc, {
      startY: startY,
      head: [['No RM', 'Nama Pasien', 'Penjamin', 'Isi Pending']],
      body: pendings.map(p => [
        p.noRM || '-',
        p.namaPasien || '-',
        p.payor || '-',
        p.isiPending || '-'
      ]),
      styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak' },
      headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 65 },
        1: { cellWidth: 120 },
        2: { cellWidth: 90 },
        3: { cellWidth: 'auto' }
      },
      margin: { left: 40, right: 40 }
    });
    startY = (doc as any).lastAutoTable.finalY + 20;
  }

  // ── Just Info Table ──────────────────────────────────────────────────────
  if (justInfos.length > 0) {
    // Add new page if not enough space
    if (startY > doc.internal.pageSize.height - 120) {
      doc.addPage();
      startY = 40;
    }
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Just Info', 40, startY);
    doc.setFont('helvetica', 'normal');
    startY += 10;

    autoTable(doc, {
      startY: startY,
      head: [['No RM', 'Nama Pasien', 'Penjamin', 'Info']],
      body: justInfos.map(j => {
        const pat = patientMap[j.noRM];
        return [
          j.noRM || '-',
          pat?.namaPasien || j.namaPasien || '-',
          pat?.payor || '-',
          j.isi || '-'
        ];
      }),
      styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak' },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 65 },
        1: { cellWidth: 120 },
        2: { cellWidth: 90 },
        3: { cellWidth: 'auto' }
      },
      margin: { left: 40, right: 40 }
    });
  }

  // Footer
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(`Dicetak otomatis oleh IP Admission Workspace | ${formatDateTime(new Date())} | Hal ${i} dari ${pageCount}`, 40, doc.internal.pageSize.height - 30);
  }

  // Return base64 string
  return doc.output('datauristring');
};

export const generateReportPDF = async (data: any[], rsName: string, title: string) => {
  const doc = new jsPDF('p', 'pt', 'a4');
  
  doc.setFontSize(16);
  doc.text(rsName, 40, 40);
  doc.setFontSize(14);
  doc.text(title, 40, 60);
  doc.setFontSize(10);
    doc.text(`Dicetak: ${formatDateTime(new Date())}`, 40, 75);

  autoTable(doc, {
    startY: 90,
    head: [['No RM', 'Nama', 'Kategori', 'Prioritas', 'Status', 'Tgl']],
    body: data.map(d => [d.noRM, d.namaPasien, d.kategori, d.prioritas, d.status, formatDate(d.createdAt)]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [15, 118, 110] }
  });

  return doc;
};
