import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { getDB, ActivityLog } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { writeLog } from '../lib/writeLog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import {
  ClipboardList, RefreshCw, Download, Trash2,
  ChevronLeft, ChevronRight, AlertCircle, CheckCircle2,
  AlertTriangle, Info, X, Search, Eye,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { EpisodeLink } from '@/components/EpisodeLink';
import { formatDate, formatDateTime } from '../lib/utils';

// ── Constants ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;

const STATUS_META: Record<string, { label: string; icon: React.ReactNode; badgeClass: string }> = {
  Success: { label: 'Success', icon: <CheckCircle2 className="w-3.5 h-3.5" />, badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  Warning: { label: 'Warning', icon: <AlertTriangle className="w-3.5 h-3.5" />, badgeClass: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
  Failed:  { label: 'Failed',  icon: <AlertCircle   className="w-3.5 h-3.5" />, badgeClass: 'bg-red-100 text-red-700 border-red-300' },
  Info:    { label: 'Info',    icon: <Info           className="w-3.5 h-3.5" />, badgeClass: 'bg-blue-100 text-blue-700 border-blue-300' },
};

const MODUL_LIST = [
  'Login', 'Data Pasien', 'Operan', 'Billing Checker', 'Rule Billing',
  'Master Tarif', 'Master Item', 'Estimasi Biaya', 'Backup & Restore',
  'Pengaturan', 'Sinkronisasi', 'Dashboard', 'Sistem', 'Log Aktivitas',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTs(ts: number) {
  return formatDateTime(ts);
}

function todayStr() { return new Date().toISOString().split('T')[0]; }

// ── Detail Modal ───────────────────────────────────────────────────────────────

function DetailModal({ log, onClose }: { log: ActivityLog; onClose: () => void }) {
  const meta = STATUS_META[log.status] ?? STATUS_META.Info;

  const renderValue = (val: string) => {
    if (!val) return <span className="text-muted-foreground italic">—</span>;
    try {
      const parsed = JSON.parse(val);
      return (
        <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap break-all">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    } catch {
      return <span className="text-sm">{val}</span>;
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5" />
            Detail Log Aktivitas
            <span className={`ml-auto inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${meta.badgeClass}`}>
              {meta.icon}{meta.label}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <section>
            <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">Informasi User</h3>
            <div className="grid grid-cols-3 gap-2 bg-muted/40 rounded-lg p-3">
              <div><p className="text-xs text-muted-foreground">Username</p><p className="font-medium">{log.username}</p></div>
              <div><p className="text-xs text-muted-foreground">Nama</p><p className="font-medium">{log.namaUser}</p></div>
              <div><p className="text-xs text-muted-foreground">Role</p><p className="font-medium capitalize">{log.role}</p></div>
            </div>
          </section>

          {(log.noRM || log.namaPasien) && (
            <section>
              <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">Informasi Pasien</h3>
              <div className="grid grid-cols-3 gap-2 bg-muted/40 rounded-lg p-3">
                <div><p className="text-xs text-muted-foreground">No. RM</p><p className="font-medium">{log.noRM || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Episode</p><p className="font-medium"><EpisodeLink episode={log.episodeNo} /></p></div>
                <div><p className="text-xs text-muted-foreground">Nama Pasien</p><p className="font-medium">{log.namaPasien || '—'}</p></div>
              </div>
            </section>
          )}

          <section>
            <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">Aktivitas</h3>
            <div className="grid grid-cols-2 gap-2 bg-muted/40 rounded-lg p-3">
              <div><p className="text-xs text-muted-foreground">Modul</p><p className="font-medium">{log.modul}</p></div>
              <div><p className="text-xs text-muted-foreground">Aktivitas</p><p className="font-medium">{log.aktivitas}</p></div>
              {log.detail && <div className="col-span-2"><p className="text-xs text-muted-foreground">Detail</p><p className="font-medium break-words">{log.detail}</p></div>}
              {log.keterangan && <div className="col-span-2"><p className="text-xs text-muted-foreground">Keterangan</p><p className="font-medium">{log.keterangan}</p></div>}
            </div>
          </section>

          {(log.oldValue || log.newValue) && (
            <section>
              <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">Perubahan Data</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-red-50 dark:bg-red-950/20 rounded-lg p-3 border border-red-200 dark:border-red-900">
                  <p className="text-xs text-red-600 font-semibold mb-1">Sebelum</p>
                  {renderValue(log.oldValue)}
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-3 border border-emerald-200 dark:border-emerald-900">
                  <p className="text-xs text-emerald-600 font-semibold mb-1">Sesudah</p>
                  {renderValue(log.newValue)}
                </div>
              </div>
            </section>
          )}

          <section>
            <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">Informasi Sistem</h3>
            <div className="grid grid-cols-2 gap-2 bg-muted/40 rounded-lg p-3">
              <div><p className="text-xs text-muted-foreground">Browser</p><p className="font-medium">{log.browser || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Device</p><p className="font-medium">{log.device || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Sistem Operasi</p><p className="font-medium">{log.os || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Durasi Proses</p><p className="font-medium">{log.durasi ? `${log.durasi} ms` : '—'}</p></div>
              <div className="col-span-2"><p className="text-xs text-muted-foreground">Timestamp</p><p className="font-medium">{formatTs(log.timestamp)}</p></div>
            </div>
          </section>

          {(log.errorCode || log.errorMessage) && (
            <section>
              <h3 className="font-semibold text-xs uppercase tracking-wider text-red-600 mb-2">Error</h3>
              <div className="bg-red-50 dark:bg-red-950/20 rounded-lg p-3 border border-red-200 dark:border-red-900 space-y-1">
                {log.errorCode && <p><span className="text-xs text-red-500">Error Code:</span> <span className="font-mono font-medium">{log.errorCode}</span></p>}
                {log.errorMessage && <p><span className="text-xs text-red-500">Error Message:</span> <span className="font-medium">{log.errorMessage}</span></p>}
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ActivityLogPage() {
  const { user } = useAuth();

  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterUser, setFilterUser] = useState('all');
  const [filterModul, setFilterModul] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const today = todayStr();

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDB();
      const all = await db.getAll('activityLogs');
      all.sort((a, b) => b.timestamp - a.timestamp);
      setLogs(all);
    } catch (e: any) {
      toast.error('Gagal memuat log: ' + (e?.message ?? ''));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const userList = useMemo(() => Array.from(new Set(logs.map(l => l.username))).sort(), [logs]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return logs.filter(l => {
      if (filterDate && l.tanggal !== filterDate) return false;
      if (filterUser !== 'all' && l.username !== filterUser) return false;
      if (filterModul !== 'all' && l.modul !== filterModul) return false;
      if (filterStatus !== 'all' && l.status !== filterStatus) return false;
      if (q && ![l.username, l.namaUser, l.modul, l.aktivitas, l.noRM, l.namaPasien, l.detail]
        .some(v => v?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [logs, search, filterDate, filterUser, filterModul, filterStatus]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, filterDate, filterUser, filterModul, filterStatus]);

  // ── Export ───────────────────────────────────────────────────────────────────

  const exportData = filtered.map(l => ({
    'ID': l.id,
    'Timestamp': formatTs(l.timestamp),
    'Tanggal': formatDate(l.tanggal),
    'Jam': l.jam,
    'Username': l.username,
    'Nama User': l.namaUser,
    'Role': l.role,
    'Modul': l.modul,
    'Aktivitas': l.aktivitas,
    'No. RM': l.noRM,
    'Episode': l.episodeNo,
    'Nama Pasien': l.namaPasien,
    'Detail': l.detail,
    'Old Value': l.oldValue,
    'New Value': l.newValue,
    'Browser': l.browser,
    'Device': l.device,
    'OS': l.os,
    'Status': l.status,
    'Keterangan': l.keterangan,
    'Durasi (ms)': l.durasi,
    'Error Code': l.errorCode,
    'Error Message': l.errorMessage,
  }));

  const handleExportExcel = async () => {
    const t0 = Date.now();
    try {
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Log Aktivitas');
      XLSX.writeFile(wb, `log_aktivitas_${today}.xlsx`);
      toast.success('Export Excel berhasil');
      await writeLog({ modul: 'Log Aktivitas', aktivitas: 'Export Excel', detail: `${filtered.length} baris`, status: 'Success', durasi: Date.now() - t0 });
    } catch (e: any) {
      toast.error('Export Excel gagal');
      await writeLog({ modul: 'Log Aktivitas', aktivitas: 'Export Excel', status: 'Failed', errorMessage: e?.message });
    }
  };

  const handleExportCSV = async () => {
    const t0 = Date.now();
    try {
      const ws = XLSX.utils.json_to_sheet(exportData);
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `log_aktivitas_${today}.csv`; a.click();
      URL.revokeObjectURL(url);
      toast.success('Export CSV berhasil');
      await writeLog({ modul: 'Log Aktivitas', aktivitas: 'Export CSV', detail: `${filtered.length} baris`, status: 'Success', durasi: Date.now() - t0 });
    } catch (e: any) {
      toast.error('Export CSV gagal');
      await writeLog({ modul: 'Log Aktivitas', aktivitas: 'Export CSV', status: 'Failed', errorMessage: e?.message });
    }
  };

  const handleExportPDF = async () => {
    const t0 = Date.now();
    try {
      const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
      doc.setFontSize(12);
      doc.text('Log Aktivitas — IP Admission Workspace', 14, 14);
      doc.setFontSize(8);
      doc.text(`Dicetak: ${formatDateTime(new Date())} · Total: ${filtered.length} data`, 14, 20);
      autoTable(doc, {
        startY: 24,
        head: [['Waktu', 'Username', 'Nama', 'Modul', 'Aktivitas', 'Pasien', 'Status']],
        body: filtered.map(l => [
          `${l.tanggal} ${l.jam}`, l.username, l.namaUser, l.modul, l.aktivitas,
          l.namaPasien ? `${l.namaPasien} (${l.noRM})` : '—', l.status,
        ]),
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [20, 168, 167] },
        alternateRowStyles: { fillColor: [245, 250, 250] },
      });
      doc.save(`log_aktivitas_${today}.pdf`);
      toast.success('Export PDF berhasil');
      await writeLog({ modul: 'Log Aktivitas', aktivitas: 'Export PDF', detail: `${filtered.length} baris`, status: 'Success', durasi: Date.now() - t0 });
    } catch (e: any) {
      toast.error('Export PDF gagal');
      await writeLog({ modul: 'Log Aktivitas', aktivitas: 'Export PDF', status: 'Failed', errorMessage: e?.message });
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteReason.trim()) { toast.error('Alasan penghapusan wajib diisi.'); return; }
    setDeleteLoading(true);
    const t0 = Date.now();
    try {
      const db = await getDB();
      const all = await db.getAll('activityLogs');
      const toDelete = all.filter(l => {
        if (filterDate && l.tanggal !== filterDate) return false;
        if (filterUser !== 'all' && l.username !== filterUser) return false;
        if (filterModul !== 'all' && l.modul !== filterModul) return false;
        if (filterStatus !== 'all' && l.status !== filterStatus) return false;
        return true;
      });
      for (const l of toDelete) {
        if (l.id != null) await db.delete('activityLogs', l.id);
      }
      await writeLog({
        modul: 'Log Aktivitas', aktivitas: 'Hapus Log',
        detail: `Menghapus ${toDelete.length} log`,
        keterangan: `Alasan: ${deleteReason}`,
        status: 'Warning', durasi: Date.now() - t0,
      });
      toast.success(`${toDelete.length} log berhasil dihapus.`);
      setShowDeleteDialog(false);
      setDeleteReason('');
      await loadLogs();
    } catch (e: any) {
      toast.error('Gagal menghapus log: ' + (e?.message ?? ''));
    } finally {
      setDeleteLoading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            Log Aktivitas
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Audit Trail seluruh aktivitas pengguna</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadLogs} disabled={loading} className="gap-1.5">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Table card */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="text-sm font-normal text-muted-foreground">
                {filtered.length} dari {logs.length} log
              </span>
            </CardTitle>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleExportExcel}>
                <Download className="w-3.5 h-3.5" /> Excel
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleExportCSV}>
                <Download className="w-3.5 h-3.5" /> CSV
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleExportPDF}>
                <Download className="w-3.5 h-3.5" /> PDF
              </Button>
              {user?.role === 'superuser' && (
                <Button variant="destructive" size="sm" className="gap-1.5 text-xs" onClick={() => setShowDeleteDialog(true)}>
                  <Trash2 className="w-3.5 h-3.5" /> Hapus Log
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 pt-0">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Cari username, modul, aktivitas, pasien..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
            <Input
              type="date"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              className="h-8 text-sm w-36"
            />
            <Select value={filterUser} onValueChange={setFilterUser}>
              <SelectTrigger className="h-8 text-sm w-36"><SelectValue placeholder="User" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua User</SelectItem>
                {userList.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterModul} onValueChange={setFilterModul}>
              <SelectTrigger className="h-8 text-sm w-40"><SelectValue placeholder="Modul" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Modul</SelectItem>
                {MODUL_LIST.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 text-sm w-32"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="Success">Success</SelectItem>
                <SelectItem value="Warning">Warning</SelectItem>
                <SelectItem value="Failed">Failed</SelectItem>
                <SelectItem value="Info">Info</SelectItem>
              </SelectContent>
            </Select>
            {(filterDate || filterUser !== 'all' || filterModul !== 'all' || filterStatus !== 'all' || search) && (
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground"
                onClick={() => { setSearch(''); setFilterDate(''); setFilterUser('all'); setFilterModul('all'); setFilterStatus('all'); }}>
                <X className="w-3 h-3" /> Reset
              </Button>
            )}
          </div>

          {/* Table */}
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs w-36">Waktu</TableHead>
                    <TableHead className="text-xs w-28">User</TableHead>
                    <TableHead className="text-xs w-28">Modul</TableHead>
                    <TableHead className="text-xs">Aktivitas</TableHead>
                    <TableHead className="text-xs w-36">Pasien</TableHead>
                    <TableHead className="text-xs w-24">Status</TableHead>
                    <TableHead className="text-xs w-16 text-center">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                        Memuat log...
                      </TableCell>
                    </TableRow>
                  ) : paginated.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">
                          {search || filterDate || filterUser !== 'all' || filterModul !== 'all' || filterStatus !== 'all'
                            ? 'Tidak ada hasil yang sesuai filter.'
                            : 'Belum ada log aktivitas.'}
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : paginated.map((log, i) => {
                    const meta = STATUS_META[log.status] ?? STATUS_META.Info;
                    return (
                      <TableRow key={log.id ?? i} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="text-xs font-mono whitespace-nowrap">
                          <p>{formatDate(log.tanggal)}</p>
                          <p className="text-muted-foreground">{log.jam}</p>
                        </TableCell>
                        <TableCell className="text-xs">
                          <p className="font-medium">{log.username}</p>
                          <p className="text-muted-foreground capitalize">{log.role}</p>
                        </TableCell>
                        <TableCell className="text-xs font-medium">{log.modul}</TableCell>
                        <TableCell className="text-xs max-w-[200px]">
                          <p className="font-medium">{log.aktivitas}</p>
                          {log.detail && <p className="text-muted-foreground truncate">{log.detail}</p>}
                        </TableCell>
                        <TableCell className="text-xs">
                          {log.namaPasien ? (
                            <>
                              <p className="font-medium truncate max-w-[120px]">{log.namaPasien}</p>
                              <p className="text-muted-foreground">{log.noRM}</p>
                            </>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${meta.badgeClass}`}>
                            {meta.icon}{meta.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedLog(log)}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {filtered.length === 0
                ? '0 data'
                : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} dari ${filtered.length} data`}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="px-2">Hal {page} / {totalPages}</span>
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detail modal */}
      {selectedLog && <DetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />}

      {/* Delete dialog */}
      {showDeleteDialog && (
        <Dialog open onOpenChange={() => setShowDeleteDialog(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <Trash2 className="w-5 h-5" />
                Hapus Log Aktivitas
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="bg-destructive/10 rounded-lg p-3 text-sm text-destructive">
                Anda akan menghapus <strong>{filtered.length} log</strong> yang sesuai filter aktif. Tindakan ini tidak dapat dibatalkan.
              </div>
              <div>
                <label className="text-sm font-medium">Alasan Penghapusan <span className="text-destructive">*</span></label>
                <Input
                  className="mt-1.5"
                  placeholder="Masukkan alasan penghapusan log..."
                  value={deleteReason}
                  onChange={e => setDeleteReason(e.target.value)}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Batal</Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading || !deleteReason.trim()}>
                  {deleteLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-1.5" /> : <Trash2 className="w-4 h-4 mr-1.5" />}
                  Hapus
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
