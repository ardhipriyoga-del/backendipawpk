import { apiUrl } from './apiConfig';
import { getDB, type OutlookEmail, type Patient } from './db';

export type OutlookSyncInterval = 'manual' | '1' | '5' | '15' | '30';

export interface OutlookSettings {
  emailAddress: string;
  enabled: boolean;
  syncInterval: OutlookSyncInterval;
  lastSyncAt: number | null;
}

export interface OutlookStatus {
  connected: boolean;
  emailAddress: string | null;
  provider: 'microsoft-outlook';
  message: string;
}

export const DEFAULT_OUTLOOK_SETTINGS: OutlookSettings = {
  emailAddress: '',
  enabled: false,
  syncInterval: '5',
  lastSyncAt: null,
};

function roleHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const raw = localStorage.getItem('emc_session');
    const session = raw ? JSON.parse(raw) : null;
    if (session?.user?.role) headers['X-IPAW-Role'] = session.user.role;
    if (session?.user?.username) headers['X-IPAW-User'] = session.user.username;
  } catch {
    // The API rejects requests without a valid application role.
  }
  return headers;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: { ...roleHeaders(), ...(init.headers ?? {}) },
  });
  const data = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    throw new Error(data.message ?? 'Permintaan Outlook gagal.');
  }
  return data;
}

export async function getOutlookSettings(): Promise<OutlookSettings> {
  const db = await getDB();
  const stored = await db.get('settings', 'outlookSettings');
  return { ...DEFAULT_OUTLOOK_SETTINGS, ...(stored?.value ?? {}) };
}

export async function saveOutlookSettings(settings: OutlookSettings): Promise<void> {
  const db = await getDB();
  await db.put('settings', {
    key: 'outlookSettings',
    value: {
      ...settings,
      emailAddress: settings.emailAddress.trim(),
    },
  });
}

export async function getOutlookStatus(): Promise<OutlookStatus> {
  return request<OutlookStatus>('/api/outlook/status');
}

async function getRecentOutlookEmails(): Promise<OutlookEmail[]> {
  const result = await request<{ messages: OutlookEmail[] }>('/api/outlook/messages');
  return Array.isArray(result.messages) ? result.messages : [];
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchesPatient(subject: string, patientName: string): boolean {
  const normalizedSubject = normalizeForMatch(subject);
  const normalizedName = normalizeForMatch(patientName);
  return normalizedName.length >= 3 && normalizedSubject.includes(normalizedName);
}

export async function syncOutlookEmails(activePatients: Patient[]): Promise<number> {
  const settings = await getOutlookSettings();
  if (!settings.enabled || !settings.emailAddress.trim()) return 0;

  const messages = await getRecentOutlookEmails();
  const matched = messages
    .map(message => {
      const patient = activePatients.find(candidate =>
        matchesPatient(message.subject, candidate.namaPasien),
      );
      return patient
        ? { ...message, matchedNoRM: patient.noRM, matchedEpisodeNo: patient.episodeNo }
        : null;
    })
    .filter((message): message is OutlookEmail => message !== null);

  const db = await getDB();
  const currentIds = new Set(matched.map(message => message.id));
  const existing = await db.getAll('outlookEmails');
  for (const message of existing) {
    if (!currentIds.has(message.id)) {
      await db.delete('outlookEmails', message.id);
    }
  }
  for (const message of matched) {
    await db.put('outlookEmails', message);
  }
  await saveOutlookSettings({ ...settings, lastSyncAt: Date.now() });
  return matched.length;
}
