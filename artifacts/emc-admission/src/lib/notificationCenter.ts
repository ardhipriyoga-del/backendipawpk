import { getDB } from './db';
import { backupCloud } from './cloudSync';

export type NotificationCategory = 'ktm' | 'igd' | 'operating-theatre' | 'checklist' | 'billing' | 'pending' | 'system';
export type NotificationPriority = 'normal' | 'attention';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  description: string;
  destination?: string;
  priority: NotificationPriority;
  createdAt: number;
  readAt?: number;
}

const HISTORY_KEY = 'notificationHistory';
const NOTIFICATION_EVENT = 'ipaw:notification-created';
const MAX_HISTORY_ITEMS = 100;
const FINGERPRINTS_KEY = 'ipaw:notification-fingerprints:v1';
// Fingerprints are deliberately retained much longer than visible history.
// History is capped for UI size, but a previously surfaced event must not
// become eligible again merely because many later events were recorded.
const MAX_FINGERPRINTS = 10_000;
let historyWriteQueue: Promise<unknown> = Promise.resolve();

function scheduleCloudHistoryBackup(): void {
  // Notification history is part of the full IndexedDB backup. Keep this
  // fire-and-forget so a Cloud outage can never block the alert or its popup.
  void backupCloud().catch(() => {
    // Local history remains authoritative while the device is offline.
  });
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fingerprintHash(value: string): string {
  // Keep patient identifiers out of localStorage while retaining a stable
  // browser-local identity for the same notification event.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function readNotificationFingerprints(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(FINGERPRINTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(item => typeof item === 'string').slice(0, MAX_FINGERPRINTS)
      : [];
  } catch {
    return [];
  }
}

function notificationLegacyFingerprint(notification: AppNotification): string {
  return [
    notification.category,
    notification.title,
    notification.description,
    notification.destination ?? '',
  ].join('|');
}

function canonicalHistoryFingerprints(notification: AppNotification): string[] {
  if (notification.category !== 'igd') return [];
  const titleMatch = notification.title.match(/Pasien IGD dengan SPRI\s*·\s*(.+)$/i);
  const noRmMatch = notification.description.match(/No\.\s*RM\s+([^·.]+)/i);
  const identity = (noRmMatch?.[1] || titleMatch?.[1] || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return identity && identity !== '-'
    ? [`igd:spri:${identity}`]
    : [];
}

function writeNotificationFingerprints(values: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = readNotificationFingerprints();
    const hashes = values
      .map(value => fingerprintHash(value.trim()))
      .filter(Boolean);
    window.localStorage.setItem(
      FINGERPRINTS_KEY,
      JSON.stringify([...new Set([...hashes, ...existing])].slice(0, MAX_FINGERPRINTS)),
    );
  } catch {
    // Browser storage can be unavailable in private/restricted contexts.
  }
}

/**
 * Seeds the durable dedupe ledger from notification history created by older
 * versions. This runs before the first poll so an existing history entry is
 * not surfaced again after the app is restored.
 */
export async function seedNotificationFingerprintsFromHistory(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const history = await getNotificationHistory();
    if (history.length) {
      writeNotificationFingerprints(history.flatMap(notification => [
        notificationLegacyFingerprint(notification),
        ...canonicalHistoryFingerprints(notification),
      ]));
    }
  } catch {
    // A missing/temporarily unavailable history must not block monitoring.
  }
}

/**
 * Re-seed after a Cloud restore. Restore replaces the IndexedDB settings
 * payload, while the browser-local fingerprint ledger intentionally survives.
 */
export async function refreshNotificationFingerprintLedger(): Promise<void> {
  await seedNotificationFingerprintsFromHistory();
}

/**
 * Claims a notification event for this browser. This storage is deliberately
 * separate from IndexedDB because restore/reset replaces application stores.
 * Returning false means the exact event was already surfaced before.
 */
export function claimNotificationFingerprint(fingerprints: string | string[]): boolean {
  const values = Array.isArray(fingerprints) ? fingerprints : [fingerprints];
  const hashes = values
    .map(value => fingerprintHash(value.trim()))
    .filter(Boolean);
  if (!hashes.length || typeof window === 'undefined') return true;

  const existing = readNotificationFingerprints();
  // Older builds accidentally passed already-hashed values to
  // writeNotificationFingerprints(), which hashed them a second time. Treat
  // both forms as claimed so an existing browser ledger remains effective
  // after an app refresh/upgrade.
  const legacyDoubleHashes = hashes.map(hash => fingerprintHash(hash));
  if (hashes.some(hash => existing.includes(hash)) ||
      legacyDoubleHashes.some(hash => existing.includes(hash))) {
    return false;
  }

  // writeNotificationFingerprints() accepts raw fingerprints and hashes them
  // exactly once. Keeping this boundary explicit prevents repeat alerts after
  // a page refresh.
  writeNotificationFingerprints(values);
  return true;
}

export async function getNotificationHistory(): Promise<AppNotification[]> {
  const db = await getDB();
  const entry = await db.get('settings', HISTORY_KEY);
  if (!Array.isArray(entry?.value)) return [];
  return (entry.value as AppNotification[])
    .filter(item => item && typeof item.id === 'string' && typeof item.createdAt === 'number')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_HISTORY_ITEMS);
}

async function saveNotificationHistory(history: AppNotification[]): Promise<void> {
  const db = await getDB();
  await db.put('settings', {
    key: HISTORY_KEY,
    value: history.slice(0, MAX_HISTORY_ITEMS),
  });
}

function withHistoryLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = historyWriteQueue.then(operation);
  historyWriteQueue = next.catch(() => undefined);
  return next;
}

export async function addNotification(
  input: Omit<AppNotification, 'id' | 'createdAt' | 'readAt'>,
): Promise<AppNotification> {
  const notification: AppNotification = {
    ...input,
    id: makeId(),
    createdAt: Date.now(),
  };
  await withHistoryLock(async () => {
    const history = await getNotificationHistory();
    await saveNotificationHistory([notification, ...history]);
    window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: notification }));
    scheduleCloudHistoryBackup();
  });
  return notification;
}

export async function markNotificationRead(id: string): Promise<void> {
  await withHistoryLock(async () => {
    const history = await getNotificationHistory();
    const next = history.map(item => item.id === id && !item.readAt
      ? { ...item, readAt: Date.now() }
      : item);
    await saveNotificationHistory(next);
    window.dispatchEvent(new Event(NOTIFICATION_EVENT));
    scheduleCloudHistoryBackup();
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await withHistoryLock(async () => {
    const now = Date.now();
    const history = await getNotificationHistory();
    await saveNotificationHistory(history.map(item => item.readAt ? item : { ...item, readAt: now }));
    window.dispatchEvent(new Event(NOTIFICATION_EVENT));
    scheduleCloudHistoryBackup();
  });
}

export async function clearNotificationHistory(): Promise<void> {
  await withHistoryLock(async () => {
    await saveNotificationHistory([]);
    window.dispatchEvent(new Event(NOTIFICATION_EVENT));
    scheduleCloudHistoryBackup();
  });
}

export function subscribeToNotificationChanges(listener: () => void): () => void {
  window.addEventListener(NOTIFICATION_EVENT, listener);
  return () => window.removeEventListener(NOTIFICATION_EVENT, listener);
}