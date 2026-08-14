import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CloudOff, ExternalLink, Mail, RefreshCw, Search } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getDB, type OutlookEmail, type Patient } from '../lib/db';
import {
  getOutlookSettings,
  getOutlookStatus,
  syncOutlookEmails,
  type OutlookSettings,
  type OutlookStatus,
} from '../lib/outlook';
import { formatDateTime } from '../lib/utils';

const INITIAL_STATUS: OutlookStatus = {
  connected: false,
  emailAddress: null,
  provider: 'microsoft-outlook',
  message: 'Belum diotorisasi melalui Microsoft.',
};

export default function MailAsuransiPage() {
  const [emails, setEmails] = useState<OutlookEmail[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [settings, setSettings] = useState<OutlookSettings | null>(null);
  const [status, setStatus] = useState<OutlookStatus>(INITIAL_STATUS);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDB();
      const [storedEmails, activePatients, storedSettings, outlookStatus] = await Promise.all([
        db.getAll('outlookEmails'),
        db.getAll('patients'),
        getOutlookSettings(),
        getOutlookStatus().catch(() => INITIAL_STATUS),
      ]);
      setEmails(storedEmails);
      setPatients(activePatients.filter(patient => patient.status === 'aktif'));
      setSettings(storedSettings);
      setLastSyncAt(storedSettings.lastSyncAt);
      setStatus(outlookStatus);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const db = await getDB();
      const activePatients = (await db.getAll('patients')).filter(patient => patient.status === 'aktif');
      await syncOutlookEmails(activePatients);
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const patientByKey = useMemo(
    () => new Map(patients.map(patient => [`${patient.noRM}::${patient.episodeNo}`, patient])),
    [patients],
  );

  const filteredEmails = useMemo(() => {
    const term = search.trim().toLowerCase();
    return emails
      .map(email => ({
        email,
        patient: patientByKey.get(`${email.matchedNoRM}::${email.matchedEpisodeNo}`),
      }))
      .filter(({ email, patient }) => {
        if (!term) return true;
        return [email.subject, email.senderName, email.senderAddress, patient?.namaPasien, email.matchedNoRM]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(term));
      })
      .sort((a, b) => new Date(b.email.receivedAt).getTime() - new Date(a.email.receivedAt).getTime());
  }, [emails, patientByKey, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mail Asuransi</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Email Inbox Outlook yang subjeknya memuat nama pasien rawat inap aktif.
          </p>
        </div>
        <Button onClick={() => void sync()} disabled={syncing || !status.connected || !settings?.enabled} className="gap-2">
          {syncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {syncing ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}
        </Button>
      </div>

      <Card className={status.connected ? 'border-emerald-200' : 'border-amber-200'}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            {status.connected ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <CloudOff className="h-5 w-5 text-amber-600" />
            )}
            <div>
              <p className="font-semibold">{status.connected ? 'Outlook terhubung' : 'Outlook belum terhubung'}</p>
              <p className="text-sm text-muted-foreground">
                {status.emailAddress ?? status.message}
                {lastSyncAt ? ` · Sinkronisasi terakhir ${formatDateTime(lastSyncAt)}` : ''}
              </p>
            </div>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
            {emails.length} email cocok
          </span>
        </CardContent>
      </Card>

      {!status.connected && (
        <Card className="border-dashed">
          <CardContent className="p-5 text-sm text-muted-foreground">
            Otorisasi Microsoft Outlook diperlukan untuk mengambil email baru. Data di bawah hanya berasal dari cache
            lokal yang sudah pernah berhasil disinkronkan.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-sky-600" /> Email yang Cocok dengan Pasien
          </CardTitle>
          <CardDescription>
            Pencocokan dilakukan pada subjek email berdasarkan nama pasien rawat inap aktif.
          </CardDescription>
          <div className="relative max-w-md pt-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-0.5 text-muted-foreground" />
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari pasien, subjek, atau pengirim..." className="pl-9" />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Memuat cache email...</div>
          ) : filteredEmails.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              Belum ada email Outlook yang cocok dengan pasien rawat inap aktif.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredEmails.map(({ email, patient }) => (
                <div key={email.id} className="rounded-xl border p-4 transition-colors hover:bg-muted/30">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{email.subject}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Dari {email.senderName || email.senderAddress || '-'} · {formatDateTime(email.receivedAt)}
                      </p>
                    </div>
                    {email.webLink && (
                      <a href={email.webLink} target="_blank" rel="noreferrer">
                        <Button variant="outline" size="sm" className="gap-1.5">
                          Buka di Outlook <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </a>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                      {patient?.namaPasien ?? 'Pasien tidak ada di cache aktif'}
                    </span>
                    <span className="rounded-full bg-muted px-2.5 py-1 font-mono">
                      RM {email.matchedNoRM} · Episode {email.matchedEpisodeNo || '-'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}