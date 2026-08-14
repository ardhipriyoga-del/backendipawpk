import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CloudOff, ExternalLink, Loader2, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  DEFAULT_OUTLOOK_SETTINGS,
  getOutlookSettings,
  getOutlookStatus,
  saveOutlookSettings,
  syncOutlookEmails,
  type OutlookSettings,
  type OutlookStatus,
} from '../lib/outlook';
import { getDB } from '../lib/db';

const initialStatus: OutlookStatus = {
  connected: false,
  emailAddress: null,
  provider: 'microsoft-outlook',
  message: 'Belum diotorisasi melalui Microsoft.',
};

export default function OutlookSettingsPanel() {
  const [settings, setSettings] = useState<OutlookSettings>(DEFAULT_OUTLOOK_SETTINGS);
  const [status, setStatus] = useState<OutlookStatus>(initialStatus);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [emailCount, setEmailCount] = useState(0);
  const [connectionGuideOpen, setConnectionGuideOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [storedSettings, nextStatus, db] = await Promise.all([
        getOutlookSettings(),
        getOutlookStatus(),
        getDB(),
      ]);
      setSettings(storedSettings);
      setStatus(nextStatus);
      setEmailCount((await db.getAll('outlookEmails')).length);
    } catch (error) {
      setStatus(initialStatus);
      toast.error(error instanceof Error ? error.message : 'Status Outlook gagal dibaca.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveOutlookSettings(settings);
      toast.success('Pengaturan Outlook berhasil disimpan.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Pengaturan Outlook gagal disimpan.');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const db = await getDB();
      const activePatients = (await db.getAll('patients')).filter(patient => patient.status === 'aktif');
      const count = await syncOutlookEmails(activePatients);
      setEmailCount((await db.getAll('outlookEmails')).length);
      setSettings(await getOutlookSettings());
      toast.success(`${count} email Outlook cocok dengan pasien aktif.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sinkronisasi Outlook gagal.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-sky-600" />
          Integrasi Outlook Kantor
        </CardTitle>
        <CardDescription>
          Subject email yang memuat nama pasien aktif dapat ditampilkan pada card pasien.
          IPAW hanya menyimpan metadata email yang sudah cocok, bukan isi email atau password.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-4">
          <div className="flex items-center gap-3">
            {status.connected ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <CloudOff className="h-5 w-5 text-amber-600" />
            )}
            <div>
              <p className="font-semibold">{status.connected ? 'Terhubung ke Outlook' : 'Belum terhubung'}</p>
              <p className="text-sm text-muted-foreground">
                {status.emailAddress ?? status.message}
              </p>
            </div>
          </div>
          <Badge variant={status.connected ? 'default' : 'secondary'}>
            {loading ? 'Memeriksa...' : status.connected ? 'Terhubung' : 'Menunggu otorisasi'}
          </Badge>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <p className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4" /> Password tidak diperlukan
          </p>
          <p className="mt-1 leading-relaxed">
            Saat koneksi tersedia, login dilakukan di halaman resmi Microsoft dengan OAuth.
            Jangan masukkan password email kantor ke IPAW.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-semibold">Alamat email Outlook</label>
            <Input
              type="email"
              value={settings.emailAddress}
              onChange={event => setSettings(current => ({ ...current, emailAddress: event.target.value }))}
              placeholder="nama@rs-emc.id"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold">Interval sinkronisasi</label>
            <select
              value={settings.syncInterval}
              onChange={event => setSettings(current => ({ ...current, syncInterval: event.target.value as OutlookSettings['syncInterval'] }))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="manual">Manual</option>
              <option value="1">Setiap 1 menit</option>
              <option value="5">Setiap 5 menit</option>
              <option value="15">Setiap 15 menit</option>
              <option value="30">Setiap 30 menit</option>
            </select>
          </div>
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border p-3">
          <span>
            <span className="block text-sm font-semibold">Aktifkan pemantauan email</span>
            <span className="block text-xs text-muted-foreground">Email yang tidak cocok dengan pasien aktif tidak disimpan.</span>
          </span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={settings.enabled}
            onChange={event => setSettings(current => ({ ...current, enabled: event.target.checked }))}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void handleSave()} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
          </Button>
          <Button variant="outline" onClick={() => void handleSync()} disabled={syncing || !status.connected} className="gap-2">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}
          </Button>
          {!status.connected && (
            <Button variant="outline" onClick={() => setConnectionGuideOpen(true)} className="gap-2">
              <ExternalLink className="h-4 w-4" /> Cara menghubungkan Outlook
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Cache lokal saat ini: {emailCount} email yang cocok
          {settings.lastSyncAt ? ` · Sinkronisasi terakhir ${new Date(settings.lastSyncAt).toLocaleString('id-ID')}` : ''}
        </p>
      </CardContent>
      <Dialog open={connectionGuideOpen} onOpenChange={setConnectionGuideOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-sky-600" />
              Hubungkan Microsoft Outlook
            </DialogTitle>
            <DialogDescription>
              Login Microsoft untuk konektor Outlook dikelola oleh Replit, sehingga password tidak pernah dimasukkan ke IPAW.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <ol className="list-decimal space-y-2 pl-5 leading-relaxed">
              <li>Buka menu <strong>Integrations</strong> pada Project Editor Replit.</li>
              <li>Pilih konektor <strong>Microsoft Outlook</strong>, lalu lanjutkan OAuth di halaman resmi Microsoft.</li>
              <li>Kembali ke IPAW dan tekan <strong>Periksa koneksi</strong> untuk memperbarui status.</li>
            </ol>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-semibold">Belum terhubung?</p>
              <p className="mt-1 leading-relaxed">
                Sinkronisasi Outlook akan tetap nonaktif dan tidak menghasilkan error berulang sampai konektor diotorisasi.
              </p>
            </div>
            <a
              href="https://docs.replit.com/features/integrations/overview"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary underline underline-offset-4"
            >
              Baca dokumentasi Integrations Replit <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectionGuideOpen(false)}>
              Tutup
            </Button>
            <Button
              onClick={() => {
                setConnectionGuideOpen(false);
                void load();
              }}
              disabled={loading}
              className="gap-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Periksa koneksi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
