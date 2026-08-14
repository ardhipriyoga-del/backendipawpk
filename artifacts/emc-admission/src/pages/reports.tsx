import React, { useState, useEffect } from 'react';
import { getDB } from '../lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Download, Search, FileText } from 'lucide-react';
import { generateReportPDF } from '../lib/pdfExport';
import { useAppContext } from '../context/AppContext';
import { formatDate } from '../lib/utils';

export default function ReportsPage() {
  const [operans, setOperans] = useState<any[]>([]);
  const [pendings, setPendings] = useState<any[]>([]);
  const { rsName } = useAppContext();
  
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    // Set default dates to current month
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    setDateFrom(firstDay);
    setDateTo(lastDay);
  }, []);

  const loadData = async () => {
    const db = await getDB();
    const ops = await db.getAll('operanShifts');
    const pends = await db.getAll('pendings');

    // Filter by date
    const fOps = ops.filter(o => o.tanggal.split('T')[0] >= dateFrom && o.tanggal.split('T')[0] <= dateTo);
    const fPends = pends.filter(p => {
      const d = new Date(p.createdAt).toISOString().split('T')[0];
      return d >= dateFrom && d <= dateTo;
    });

    setOperans(fOps.sort((a,b) => b.createdAt - a.createdAt));
    setPendings(fPends.sort((a,b) => b.createdAt - a.createdAt));
  };

  useEffect(() => {
    if (dateFrom && dateTo) {
      loadData();
    }
  }, [dateFrom, dateTo]);

  const handleExportPDF = async () => {
    const doc = await generateReportPDF(pendings, rsName, `Laporan Pending Admission (${dateFrom} s/d ${dateTo})`);
    doc.save(`Laporan_Pending_${dateFrom}_${dateTo}.pdf`);
  };

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Laporan & Analitik</h1>
          <p className="text-muted-foreground mt-1">Tarik data rekapitulasi operan dan performa admission.</p>
        </div>
        <Button onClick={handleExportPDF} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
          <Download className="w-4 h-4" /> Export PDF
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1 w-full space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Dari Tanggal</label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div className="flex-1 w-full space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Sampai Tanggal</label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <Button onClick={loadData} variant="secondary" className="w-full sm:w-auto h-10">Refresh Data</Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Statistik Periode Ini</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-muted-foreground">Total Operan Shift</span>
              <span className="font-bold text-lg">{operans.length}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-muted-foreground">Total Pending Dibuat</span>
              <span className="font-bold text-lg">{pendings.length}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-muted-foreground">Pending Diselesaikan</span>
              <span className="font-bold text-lg text-emerald-600">{pendings.filter(p => p.status === 'selesai').length}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-muted-foreground">Pending Belum Selesai</span>
              <span className="font-bold text-lg text-destructive">{pendings.filter(p => p.status !== 'selesai').length}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg">Riwayat Log Operan</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto max-h-[300px] p-0">
            {operans.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-3 font-medium">Tanggal</th>
                    <th className="text-left p-3 font-medium">Shift</th>
                    <th className="text-left p-3 font-medium">Serah → Terima</th>
                  </tr>
                </thead>
                <tbody>
                  {operans.map(o => (
                    <tr key={o.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                      <td className="p-3">{formatDate(o.tanggal)}</td>
                      <td className="p-3 uppercase text-xs font-bold">{o.shiftSerah}</td>
                      <td className="p-3">{o.userSerahNama} → {o.userTerimaNama}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-20" />
                Tidak ada data operan di periode ini.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
