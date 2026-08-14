import React, { useState, useEffect, useCallback } from 'react';
import { getDB, SyncLog } from '../lib/db';
import { formatDuration } from '../lib/trakcare';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckCircle2, AlertCircle, Users, UserPlus, LogOut, Clock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '../lib/utils';

export default function SyncHistoryPage() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDB();
      const all = await db.getAll('syncLogs');
      // Sort descending by createdAt
      all.sort((a, b) => b.createdAt - a.createdAt);
      setLogs(all);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const handleClearAll = async () => {
    if (!confirm('Hapus seluruh riwayat sinkronisasi? Aksi ini tidak dapat dibatalkan.')) return;
    const db = await getDB();
    await db.clear('syncLogs');
    toast.success('Riwayat sinkronisasi berhasil dihapus.');
    loadLogs();
  };

  const totalNew     = logs.reduce((s, l) => s + l.newPatients, 0);
  const totalUpdated = logs.reduce((s, l) => s + l.updatedPatients, 0);
  const totalDisch   = logs.reduce((s, l) => s + l.dischargedPatients, 0);
  const totalErrors  = logs.reduce((s, l) => s + l.errors, 0);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Riwayat Sinkronisasi</h1>
          <p className="text-muted-foreground mt-1">
            Log setiap proses sinkronisasi data TrakCare.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadLogs} className="gap-1.5">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
          {logs.length > 0 && (
            <Button variant="destructive" size="sm" onClick={handleClearAll} className="gap-1.5">
              <Trash2 className="w-4 h-4" /> Hapus Semua
            </Button>
          )}
        </div>
      </div>

      {/* Summary stats */}
      {logs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard icon={<UserPlus className="w-5 h-5 text-emerald-600" />} label="Total Pasien Baru" value={totalNew} color="emerald" />
          <StatCard icon={<Users className="w-5 h-5 text-blue-600" />} label="Total Diperbarui" value={totalUpdated} color="blue" />
          <StatCard icon={<LogOut className="w-5 h-5 text-orange-500" />} label="Total Pulang" value={totalDisch} color="orange" />
          <StatCard icon={<AlertCircle className="w-5 h-5 text-red-500" />} label="Total Error" value={totalErrors} color="red" />
        </div>
      )}

      {/* Log list */}
      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <RefreshCw className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-lg font-semibold">Belum ada riwayat sinkronisasi</p>
            <p className="text-sm mt-1">Lakukan sinkronisasi TrakCare dari halaman Pasien Rawat Inap.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <Card key={log.id} className="overflow-hidden">
              <CardHeader className="py-3 px-5 bg-muted/30 border-b border-border flex flex-row items-center justify-between">
                <div className="flex items-center gap-3">
                  {log.errors === 0
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    : <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  }
                  <div>
                    <CardTitle className="text-sm font-semibold">{formatDate(log.tanggal)}</CardTitle>
                    <CardDescription className="text-xs">{log.jam}</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  {formatDuration(log.duration)}
                </div>
              </CardHeader>
              <CardContent className="py-3 px-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <LogItem label="Pasien Baru" value={log.newPatients} color="text-emerald-600" />
                  <LogItem label="Pasien Update" value={log.updatedPatients} color="text-blue-600" />
                  <LogItem label="Pasien Pulang" value={log.dischargedPatients} color="text-orange-500" />
                  <LogItem label="Error" value={log.errors} color={log.errors > 0 ? 'text-red-600' : 'text-muted-foreground'} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  const bg: Record<string, string> = {
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20',
    blue: 'bg-blue-50 dark:bg-blue-900/20',
    orange: 'bg-orange-50 dark:bg-orange-900/20',
    red: 'bg-red-50 dark:bg-red-900/20',
  };
  return (
    <div className={`rounded-xl p-4 ${bg[color] || 'bg-muted/30'}`}>
      <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
      <div className="text-2xl font-bold">{value.toLocaleString('id-ID')}</div>
    </div>
  );
}

function LogItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className={`font-bold text-base ${color}`}>{value.toLocaleString('id-ID')}</p>
    </div>
  );
}
