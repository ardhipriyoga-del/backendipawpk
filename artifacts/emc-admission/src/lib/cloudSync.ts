import {
  getDB,
  type Pending,
  type SyncOutboxAction,
  type SyncOutboxEntry,
  type RestorePoint,
  type OperatingTheatreCache,
  type OperatingTheatrePatient,
  type OperatingTheatrePreadmissionCache,
  setDatabaseMutationListener,
  withDatabaseMutationSuppressed,
  type DatabaseMutation,
} from './db';
import { activateOfflineBridge, apiRequest, apiUrl, GAS_API_URL, hasApiProxy } from './apiConfig';
import {
  DEFAULT_ADMIN_PASSWORD_HASH,
  DEFAULT_ADMIN_USERNAME,
  initDefaultSettingsAndAdmin,
} from './auth';
import { isLocalFirstMode } from './storageMode';

// ── Constants ──────────────────────────────────────────────────────────────────

// URL default Google Apps Script — dapat diubah via Pengaturan > Backup & Restore
export const DEFAULT_CLOUD_API = GAS_API_URL;

const LEGACY_CLOUD_APIS = new Set([
  'https://script.google.com/macros/s/AKfycbyuJjKjo6_MOyW8z2Yk56yh4Zm_6wzGgm_f2dlNqzSiWzi5cax5L2QoMYYURqU0qWfk/exec',
  'https://script.google.com/macros/s/AKfycbyQtf5jYxJGHPcbHTCw2MYTYw50dsI0jg42l95fDNhYXOmaoGIgYIayXp-DdGPXa9OF5w/exec',
  'https://script.google.com/macros/s/AKfycbw4yrZkPdpzO14Y0tcuOdLnXU-tztRnNYclUDPTsk3Vw2FDAznuKsKvYwIxVTrEJ7P9nQ/exec',
  'https://script.google.com/macros/s/AKfycbzaZQohZ2CobI1auBmKWNF4bvONWM4WU1RHurPeWtm1jN-pHepS8Y8dAkO1eMv_eB-JeA/exec',
]);

// Alias untuk backward compat (komponen lain mengimpor CLOUD_API)
export const CLOUD_API = DEFAULT_CLOUD_API;

const API_KEY = 'IPAW-EMC';
const LOCAL_STORAGE_BACKUP_STORE = '__localStorage';
const LOCAL_CLOUD_CHANGE_REVISION_KEY = 'localCloudChangeRevision';
const CLOUD_CHANGE_REVISION_KEY = 'cloudChangeRevision';
const NON_RESTORABLE_LOCAL_STORAGE_KEYS = new Set([
  // Authentication/session and device identity must never move between
  // browsers or users through a shared cloud backup.
  'emc_session',
  'ipaw_operating_theatre_client_id',
]);
const CLOUD_BACKUP_ENTRY_CHUNK_SIZE = 30_000;
const CLOUD_BACKUP_REQUEST_TARGET = 300_000;
const CLOUD_SYNC_TIMEOUT_MS = 60_000;
const CLOUD_BACKUP_CHUNK_TIMEOUT = CLOUD_SYNC_TIMEOUT_MS;
const FULL_BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const REALTIME_SYNC_INTERVAL_MS = 15 * 1000;
const CLOUD_BACKED_OPERATING_THEATRE_STORES = [
  'operatingTheatreCache',
  'operatingTheatrePreadmissionCache',
] as const;

const CLOUD_SYNC_IGNORED_SETTINGS = new Set([
  'pendingCloudSync',
  LOCAL_CLOUD_CHANGE_REVISION_KEY,
  CLOUD_CHANGE_REVISION_KEY,
  'lastCloudBackup',
  'cloudApiUrl',
  'autoCloudBackup',
]);

function mergeUsersRestore(localUsers: any[], incomingUsers: any[]): any[] {
  const localSeedAdmin = localUsers.find(user =>
    typeof user?.username === 'string' &&
    user.username.trim().toLowerCase() === DEFAULT_ADMIN_USERNAME &&
    user.passwordHash === DEFAULT_ADMIN_PASSWORD_HASH,
  );
  const incomingAdmin = incomingUsers.find(user =>
    typeof user?.username === 'string' &&
    user.username.trim().toLowerCase() === DEFAULT_ADMIN_USERNAME,
  );

  // A fresh downloaded app creates the hardcoded admin locally before the
  // background restore starts. Keep that seed credential if an older Cloud
  // snapshot has a different admin hash, so first login remains possible.
  // Once the local admin password is changed, the local hash no longer matches
  // the seed and Cloud restore is allowed to replace it normally.
  if (localSeedAdmin && (!incomingAdmin || incomingAdmin.passwordHash !== DEFAULT_ADMIN_PASSWORD_HASH)) {
    return [
      ...incomingUsers.filter(user =>
        typeof user?.username !== 'string' ||
        user.username.trim().toLowerCase() !== DEFAULT_ADMIN_USERNAME,
      ),
      localSeedAdmin,
    ];
  }
  return incomingUsers;
}

export type CloudBackupProgressStatus =
  | 'idle'
  | 'preparing'
  | 'uploading'
  | 'committing'
  | 'success'
  | 'error';

export interface CloudBackupProgress {
  status: CloudBackupProgressStatus;
  percent: number;
  message: string;
  currentChunk: number;
  totalChunks: number;
  updatedAt: number;
  error?: string;
}

const CLOUD_BACKUP_PROGRESS_EVENT = 'ipaw:cloud-backup-progress';
const INITIAL_CLOUD_BACKUP_PROGRESS: CloudBackupProgress = {
  status: 'idle',
  percent: 0,
  message: '',
  currentChunk: 0,
  totalChunks: 0,
  updatedAt: 0,
};
let currentCloudBackupProgress = INITIAL_CLOUD_BACKUP_PROGRESS;

export function getCloudBackupProgress(): CloudBackupProgress {
  return currentCloudBackupProgress;
}

export function subscribeToCloudBackupProgress(
  listener: (progress: CloudBackupProgress) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleProgress = (event: Event) => {
    const progress = (event as CustomEvent<CloudBackupProgress>).detail;
    if (progress) listener(progress);
  };
  window.addEventListener(CLOUD_BACKUP_PROGRESS_EVENT, handleProgress);
  return () => window.removeEventListener(CLOUD_BACKUP_PROGRESS_EVENT, handleProgress);
}

function publishCloudBackupProgress(
  progress: Omit<CloudBackupProgress, 'updatedAt'>,
): void {
  currentCloudBackupProgress = { ...progress, updatedAt: Date.now() };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<CloudBackupProgress>(CLOUD_BACKUP_PROGRESS_EVENT, {
      detail: currentCloudBackupProgress,
    }));
  }
}

/** Deteksi mode offline: app dibuka sebagai file lokal (file:// protocol). */
export function isOfflineMode(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'file:';
}

let activeBackup: Promise<void> | null = null;
let activeRestore: Promise<void> | null = null;
let backupRequested = false;
let backgroundBackupStarted = false;
let backgroundBackupTimer: number | null = null;
let outboxSyncInFlight: Promise<void> | null = null;
let pendingSyncInFlight: Promise<boolean> | null = null;
let allStoreSyncInFlight: Promise<number> | null = null;

function shouldSyncObservedMutation(mutation: DatabaseMutation): boolean {
  if (mutation.store === 'settings') {
    const key = String(mutation.record?.key ?? mutation.key ?? '');
    return !CLOUD_SYNC_IGNORED_SETTINGS.has(key);
  }
  return !['syncOutbox', 'restorePoints', 'outlookEmails'].includes(mutation.store);
}

setDatabaseMutationListener(mutation => {
  if (!shouldSyncObservedMutation(mutation)) return;
  void enqueueCloudRecordMutation(
    mutation.action,
    mutation.store,
    mutation.keyField,
    mutation.action === 'upsertRecord'
      ? { record: mutation.record }
      : { key: mutation.key },
    false,
  ).catch(error => {
    logError(`observe/${mutation.store}`, error);
  });
});

function isBrowserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

async function markCloudSyncPending(pending = true): Promise<void> {
  try {
    const db = await getDB();
    if (pending) {
      const previous = await db.get('settings', LOCAL_CLOUD_CHANGE_REVISION_KEY);
      const previousRevision = Number(previous?.value) || 0;
      await db.put('settings', {
        key: LOCAL_CLOUD_CHANGE_REVISION_KEY,
        value: Math.max(Date.now(), previousRevision + 1),
      });
    }
    await db.put('settings', {
      key: 'pendingCloudSync',
      value: pending,
    });
  } catch (error) {
    logError('pending-sync-marker', error);
  }
}

export async function getPendingSyncCount(): Promise<number> {
  try {
    const db = await getDB();
    const [outbox, pending] = await Promise.all([
      db.getAll('syncOutbox'),
      db.get('settings', 'pendingCloudSync'),
    ]);
    return outbox.length + (pending?.value ? 1 : 0);
  } catch {
    return 0;
  }
}

/**
 * Add a row-level change to the durable offline outbox.
 *
 * Modules can call this after updating their local IndexedDB replica. The
 * operation is retained until GAS acknowledges it, so closing ipaw.html or
 * losing the network cannot silently discard the change.
 */
export async function enqueueCloudRecordMutation(
  action: SyncOutboxAction,
  store: string,
  keyField: string,
  payload: { record?: any; key?: string | number },
  markSnapshot = true,
): Promise<void> {
  const db = await getDB();
  const entry: SyncOutboxEntry = {
    action,
    store,
    keyField,
    ...(action === 'upsertRecord' ? { record: payload.record } : { key: payload.key }),
    createdAt: Date.now(),
    attempts: 0,
  };
  await db.add('syncOutbox', entry);
  if (markSnapshot) {
    await markCloudSyncPending(true);
  }
  // The standalone LocalDB-first launcher may be opened as file://. When its
  // optional local bridge is running, the same durable outbox can sync through
  // that bridge just like the normal web app. If the bridge is unavailable,
  // the entry remains durable and the next retry will send it.
  if (isBrowserOnline()) {
    void flushSyncOutbox();
  }
}

async function sendOutboxEntry(entry: SyncOutboxEntry): Promise<void> {
  const cloudUrl = await getCloudApiUrl();
  let json: any = null;
  const payload = {
    action: entry.action,
    apiKey: API_KEY,
    store: entry.store,
    keyField: entry.keyField,
    ...(entry.action === 'upsertRecord'
      ? { record: entry.record }
      : { key: String(entry.key) }),
  };

  if (hasApiProxy()) {
    const requestUrl = apiUrl(`/api/cloud/record?url=${encodeURIComponent(cloudUrl)}`);
    const response = await fetchWithTimeout(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(payload),
    }, CLOUD_SYNC_TIMEOUT_MS);
    try {
      json = await response.json();
    } catch {
      // parse below as a normal HTTP failure
    }
    if (!response.ok) {
      throw new Error(json?.error || `Server merespons HTTP ${response.status}`);
    }
  } else {
    json = (await apiRequest('', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: CLOUD_SYNC_TIMEOUT_MS,
      debugLabel: `record/${entry.action}`,
    }, cloudUrl)).data;
  }
  if (json?.success === false) {
    throw new Error(json?.error || 'GAS menolak perubahan data.');
  }
}

/**
 * Flush acknowledged row-level changes in insertion order.
 */
export async function flushSyncOutbox(): Promise<void> {
  if (outboxSyncInFlight) return outboxSyncInFlight;
  if (!isBrowserOnline()) return;

  outboxSyncInFlight = (async () => {
    const db = await getDB();
    const entries = (await db.getAll('syncOutbox')).sort(
      (a, b) => (a.id ?? 0) - (b.id ?? 0),
    );
    const compacted = new Map<string, {
      entry: SyncOutboxEntry;
      supersededIds: number[];
    }>();
    for (const entry of entries) {
      const key = entry.action === 'upsertRecord'
        ? entry.record?.[entry.keyField]
        : entry.key;
      const identity = key === undefined || key === null || String(key).trim() === ''
        ? ''
        : `${entry.store}\u0000${entry.keyField}\u0000${String(key)}`;
      if (!identity || entry.id === undefined) {
        const fallbackKey = `entry:${entry.id ?? `${entry.store}:${entry.createdAt}`}`;
        compacted.set(fallbackKey, { entry, supersededIds: [] });
        continue;
      }
      const previous = compacted.get(identity);
      compacted.set(identity, {
        entry,
        supersededIds: [
          ...(previous?.supersededIds ?? []),
          ...(previous?.entry.id !== undefined ? [previous.entry.id] : []),
        ],
      });
    }

    for (const { entry, supersededIds } of [...compacted.values()].sort(
      (a, b) => (a.entry.id ?? 0) - (b.entry.id ?? 0),
    )) {
      try {
        await sendOutboxEntry(entry);
        if (entry.id !== undefined) await db.delete('syncOutbox', entry.id);
        for (const id of supersededIds) {
          await db.delete('syncOutbox', id);
        }
      } catch (error) {
        const updated: SyncOutboxEntry = {
          ...entry,
          attempts: (entry.attempts ?? 0) + 1,
          lastAttemptAt: Date.now(),
          lastError: error instanceof Error ? error.message : String(error),
        };
        if (entry.id !== undefined) await db.put('syncOutbox', updated);
        logError(`outbox/${entry.store}`, error);
        // Preserve ordering. A later mutation may depend on this one.
        break;
      }
    }
    // Do not clear pendingCloudSync here. The marker can represent a full
    // snapshot that still needs to be uploaded after the row-level outbox is
    // empty. Only a successfully committed full backup may clear it.
  })().finally(() => {
    outboxSyncInFlight = null;
  });
  return outboxSyncInFlight;
}

/**
 * Pull only the shared Pending store for LocalDB-first workstations.
 *
 * This is intentionally not a full Cloud restore: each workstation keeps its
 * local database as the primary workspace. A Cloud record can replace a local
 * record only when it is newer and the local record is not waiting in the
 * durable outbox. Local-only records are retained.
 */
async function reconcilePendingsFromCloud(): Promise<boolean> {
  if (!isBrowserOnline()) return false;

  // Send the local outbox first. This makes a just-completed handover visible
  // to the read below and prevents an older Cloud copy from being selected.
  await flushSyncOutbox();

  const cloudUrl = await getCloudApiUrl();
  let json: any = null;
  if (hasApiProxy()) {
    const requestUrl = apiUrl(
      `/api/cloud/store?url=${encodeURIComponent(cloudUrl)}&store=pendings`,
    );
    const response = await fetchWithTimeout(requestUrl, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' },
      cache: 'no-store',
    }, CLOUD_SYNC_TIMEOUT_MS);
    try {
      json = await response.json();
    } catch {
      // The error below provides the HTTP status for non-JSON responses.
    }
    if (!response.ok) {
      throw new Error(json?.error || `Server merespons HTTP ${response.status}`);
    }
  } else {
    json = (await apiRequest(
      `?action=readStore&apiKey=${encodeURIComponent(API_KEY)}&store=pendings`,
      {
        method: 'GET',
        cache: 'no-store',
        timeoutMs: CLOUD_SYNC_TIMEOUT_MS,
        debugLabel: 'readStore/pendings',
      },
      cloudUrl,
    )).data;
  }
  if (json?.success === false) {
    throw new Error(json?.error || 'Cloud menolak pembacaan data.');
  }

  const cloudPendings = Array.isArray(json?.records)
    ? json.records.filter((record: any) => record && typeof record.id === 'string')
    : [];
  const db = await getDB();
  const [localPendings, outbox] = await Promise.all([
    db.getAll('pendings'),
    db.getAll('syncOutbox'),
  ]);
  const protectedKeys = new Set(
    outbox
      .filter(entry => entry.store === 'pendings')
      .map(entry => entry.action === 'upsertRecord'
        ? String(entry.record?.id ?? '')
        : String(entry.key ?? ''))
      .filter(Boolean),
  );
  const localByKey = new Map(localPendings.map(record => [String(record.id), record]));
  const cloudByKey = new Map(cloudPendings.map((record: Pending) => [String(record.id), record]));
  const updates: Pending[] = [];
  const uploads: Pending[] = [];
  const queuedKeys = new Set(
    outbox
      .filter(entry => entry.store === 'pendings')
      .map(entry => entry.action === 'upsertRecord'
        ? String(entry.record?.id ?? '')
        : String(entry.key ?? ''))
      .filter(Boolean),
  );

  const recordTime = (record: Pending | undefined): number =>
    Number(record?.updatedAt) || Number(record?.createdAt) || 0;
  const recordSignature = (record: Pending): string => {
    try {
      return JSON.stringify(record);
    } catch {
      return '';
    }
  };

  for (const cloudRecord of cloudPendings as Pending[]) {
    const key = String(cloudRecord.id);
    if (protectedKeys.has(key)) continue;
    const localRecord = localByKey.get(key);
    const localUpdatedAt = recordTime(localRecord);
    const cloudUpdatedAt = recordTime(cloudRecord);
    if (!localRecord ||
        cloudUpdatedAt > localUpdatedAt ||
        (cloudUpdatedAt === localUpdatedAt &&
          recordSignature(cloudRecord) >= recordSignature(localRecord))) {
      updates.push(cloudRecord);
    } else if (!queuedKeys.has(key)) {
      // This can happen for records created by an older launcher build before
      // the durable outbox existed. Re-queue them so they reach other devices.
      uploads.push(localRecord);
    }
  }

  // Also publish local-only Pending rows. This is what makes a new Pending
  // created on computer A appear on computer B without a destructive restore.
  for (const localRecord of localPendings) {
    const key = String(localRecord.id);
    if (!key || protectedKeys.has(key) || cloudByKey.has(key) || queuedKeys.has(key)) continue;
    uploads.push(localRecord);
  }

  if (updates.length > 0) {
    const tx = db.transaction('pendings', 'readwrite');
    for (const record of updates) {
      await tx.store.put(record);
    }
    await tx.done;
  }

  for (const record of uploads) {
    const key = String(record.id);
    if (queuedKeys.has(key)) continue;
    queuedKeys.add(key);
    await enqueueCloudRecordMutation('upsertRecord', 'pendings', 'id', { record });
  }
  if (uploads.length > 0) {
    await flushSyncOutbox();
  }

  if (updates.length > 0 || uploads.length > 0) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ipaw:pendings-cloud-refreshed'));
    }
  }

  return updates.length > 0 || uploads.length > 0;
}

/**
 * Reconcile the shared Pending store in both directions.
 *
 * LocalDB remains authoritative for a record with a durable outbox entry.
 * Otherwise the newest record wins; records missing on either side are
 * retained and sent to the other side. The in-flight guard prevents startup
 * and post-login refreshes from enqueueing the same row twice.
 */
export async function syncPendingsFromCloud(): Promise<boolean> {
  if (!isBrowserOnline()) return false;
  if (pendingSyncInFlight) return pendingSyncInFlight;

  const current = reconcilePendingsFromCloud();
  pendingSyncInFlight = current;
  try {
    return await current;
  } finally {
    if (pendingSyncInFlight === current) pendingSyncInFlight = null;
  }
}

// ── Baca URL GAS dari settings (dengan fallback ke DEFAULT) ───────────────────

export const getCloudApiUrl = async (): Promise<string> => {
  // If the Windows bridge is already running, prefer it even when the user
  // opened ipaw.html directly instead of using the launcher URL override.
  // This avoids browser CORS/file-origin restrictions on hospital networks.
  await activateOfflineBridge();
  try {
    const db = await getDB();
    const entry = await db.get('settings', 'cloudApiUrl');
    const url: string = entry?.value?.trim();
    if (url && url.startsWith('https://script.google.com/')) {
      // Migrate devices that still have the previous deployment URL saved.
      if (LEGACY_CLOUD_APIS.has(url)) {
        await db.put('settings', { key: 'cloudApiUrl', value: DEFAULT_CLOUD_API });
        return DEFAULT_CLOUD_API;
      }
      return url;
    }
  } catch {
    // fallback
  }
  return DEFAULT_CLOUD_API;
};

// ── Logging helper ─────────────────────────────────────────────────────────────

function logRequest(tag: string, url: string): void {
  console.log(`[CloudSync][${tag}] → ${url}`);
}

function logResponse(tag: string, status: number, ok: boolean): void {
  const icon = ok ? '✓' : '✗';
  console.log(`[CloudSync][${tag}] ${icon} HTTP ${status}`);
}

function logError(tag: string, err: unknown): void {
  console.error(`[CloudSync][${tag}] ✗ Error:`, err);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 60_000,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(`Request timeout after ${timeoutMs}ms`);
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// ── Export semua stores ke plain object ────────────────────────────────────────

export const exportAllStores = async (): Promise<Record<string, any[]>> => {
  // Pastikan proses inisialisasi akun sudah selesai sebelum membaca store.
  // Ini juga memulihkan akun admin default bila database browser masih kosong
  // setelah instalasi baru atau migrasi IndexedDB.
  await initDefaultSettingsAndAdmin();
  const db = await getDB();
  const result: Record<string, any[]> = {};
  const internalStores = new Set(['restorePoints', 'syncOutbox', 'outlookEmails']);
  // Read every object store that exists in the current browser database. This
  // automatically includes new feature stores added in future schema versions.
  for (const store of Array.from(db.objectStoreNames)) {
    if (internalStores.has(store)) continue;
    result[store] = await db.getAll(store as any);
  }
  // Keep these two operational snapshots explicit in the cloud contract.
  // They are normally returned by objectStoreNames, but an older browser
  // database/migration can expose the stores late during startup. A backup
  // must never silently omit the planned and preadmission queues.
  for (const store of CLOUD_BACKED_OPERATING_THEATRE_STORES) {
    if (!Array.isArray(result[store])) {
      result[store] = await db.getAll(store as any);
    }
  }
  if (typeof window !== 'undefined') {
    result[LOCAL_STORAGE_BACKUP_STORE] = Object.keys(window.localStorage)
      .map(key => ({ key, value: window.localStorage.getItem(key) ?? '' }));
  }
  // This is a device-local control flag, not application data. Never copy a
  // transient "pending" state into the shared Cloud snapshot.
  if (Array.isArray(result.settings)) {
    result.settings = result.settings.filter(row => row?.key !== 'pendingCloudSync');
  }
  if (!Array.isArray(result.users) || result.users.length === 0) {
    throw new Error(
      'Master User belum tersedia di perangkat ini. Buka ulang aplikasi atau login kembali, lalu ulangi backup.',
    );
  }
  return result;
};

export const createRestorePoint = async (label = 'Auto Backup Before Restore'): Promise<RestorePoint> => {
  const database = await exportAllStores();
  const point: RestorePoint = {
    key: 'latest',
    createdAt: Date.now(),
    label,
    database,
  };
  const db = await getDB();
  await db.put('restorePoints', point);
  return point;
};

export const restoreLatestRestorePoint = async (): Promise<void> => {
  const db = await getDB();
  const point = await db.get('restorePoints', 'latest');
  if (!point?.database) throw new Error('Restore point belum tersedia.');

  const protectedStores = new Set(['restorePoints']);
  for (const store of Array.from(db.objectStoreNames)) {
    if (protectedStores.has(store)) continue;
    const rows = Array.isArray(point.database[store]) ? point.database[store] : [];
    const tx = db.transaction(store as any, 'readwrite');
    await tx.objectStore(store as any).clear();
    for (const row of rows) await (tx.objectStore(store as any) as any).put(row);
    await tx.done;
  }
};

interface CloudBackupEntry {
  store: string;
  recordIndex: number;
  chunkIndex: number;
  chunkTotal: number;
  jsonChunk: string;
}

function createCloudBackupId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ipaw-${Date.now()}-${random}`;
}

function buildCloudBackupChunks(database: Record<string, any[]>): CloudBackupEntry[][] {
  const entries: CloudBackupEntry[] = [];
  for (const store of Object.keys(database).sort()) {
    const records = Array.isArray(database[store]) ? database[store] : [];
    records.forEach((record, recordIndex) => {
      const serialized = JSON.stringify(record);
      const chunks: string[] = [];
      for (let start = 0; start < serialized.length; start += CLOUD_BACKUP_ENTRY_CHUNK_SIZE) {
        chunks.push(serialized.slice(start, start + CLOUD_BACKUP_ENTRY_CHUNK_SIZE));
      }
      if (!chunks.length) chunks.push('');
      chunks.forEach((jsonChunk, chunkIndex) => {
        entries.push({ store, recordIndex, chunkIndex, chunkTotal: chunks.length, jsonChunk });
      });
    });
  }

  const batches: CloudBackupEntry[][] = [];
  let batch: CloudBackupEntry[] = [];
  let batchBytes = 0;
  for (const entry of entries) {
    const entryBytes = JSON.stringify(entry).length + 32;
    if (batch.length && batchBytes + entryBytes > CLOUD_BACKUP_REQUEST_TARGET) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(entry);
    batchBytes += entryBytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function sendCloudBackupOperation(
  cloudUrl: string,
  payload: Record<string, unknown>,
  timeoutMs = CLOUD_BACKUP_CHUNK_TIMEOUT,
): Promise<any> {
  const body = JSON.stringify(payload);
  if (!hasApiProxy()) {
    return (await apiRequest('', {
      method: 'POST',
      body,
      timeoutMs,
      debugLabel: `backup/${String(payload.action)}`,
    }, cloudUrl)).data;
  }

  const requestUrl = apiUrl(`/api/cloud/backup?url=${encodeURIComponent(cloudUrl)}`);
  logRequest(`backup/${String(payload.action)}`, requestUrl);
  const response = await fetchWithTimeout(requestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }, timeoutMs);
  logResponse(`backup/${String(payload.action)}`, response.status, response.ok);
  let json: any = null;
  try { json = await response.json(); } catch { /* handled below */ }
  if (!response.ok || json?.success === false) {
    throw new Error(json?.error || `Server merespons HTTP ${response.status}`);
  }
  return json;
}

function preadmissionPatientKey(patient: OperatingTheatrePatient): string {
  const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const noRM = normalize(patient.noRM);
  const episodeNo = normalize(patient.episodeNo);
  const name = normalize(patient.namaPasien);
  if (noRM && episodeNo) return `rm-episode:${noRM}:${episodeNo}`;
  if (noRM && name) return `rm-name:${noRM}:${name}`;
  if (episodeNo && name) return `episode-name:${episodeNo}:${name}`;
  return `id:${patient.id}`;
}

function preadmissionDateKey(value: string): string {
  const raw = value.trim();
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmy) {
    const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function isExpiredPreadmission(patient: OperatingTheatrePatient): boolean {
  const operationKey = preadmissionDateKey(patient.tanggalOperasi);
  if (!operationKey) return false;
  const [year, month, day] = operationKey.split('-').map(Number);
  const expiry = new Date(year, month - 1, day + 1);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const expiryKey = `${expiry.getFullYear()}-${String(expiry.getMonth() + 1).padStart(2, '0')}-${String(expiry.getDate()).padStart(2, '0')}`;
  return todayKey >= expiryKey;
}

function isExpiredOperatingTheatrePatient(patient: OperatingTheatrePatient): boolean {
  const operationKey = preadmissionDateKey(patient.tanggalOperasi);
  if (!operationKey) return false;
  const [year, month, day] = operationKey.split('-').map(Number);
  const expiry = new Date(year, month - 1, day + 1);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const expiryKey = `${expiry.getFullYear()}-${String(expiry.getMonth() + 1).padStart(2, '0')}-${String(expiry.getDate()).padStart(2, '0')}`;
  return todayKey >= expiryKey;
}

function mergePreadmissionRestore(
  localRows: unknown[],
  cloudRows: unknown[],
): OperatingTheatrePreadmissionCache[] {
  const local = localRows.find(row => row && typeof row === 'object') as OperatingTheatrePreadmissionCache | undefined;
  const cloud = cloudRows.find(row => row && typeof row === 'object') as OperatingTheatrePreadmissionCache | undefined;
  if (!local && !cloud) return [];
  const patients = new Map<string, OperatingTheatrePatient>();
  for (const patient of [...(local?.patients ?? []), ...(cloud?.patients ?? [])]) {
    if (!patient || isExpiredPreadmission(patient)) continue;
    patients.set(preadmissionPatientKey(patient), patient);
  }
  return [{
    key: 'latest',
    patients: [...patients.values()],
    fetchedAt: Math.max(local?.fetchedAt ?? 0, cloud?.fetchedAt ?? 0, Date.now()),
    source: 'cache',
    endpoint: cloud?.endpoint || local?.endpoint || '',
  }];
}

function mergeOperatingTheatreRestore(
  localRows: unknown[],
  cloudRows: unknown[],
): OperatingTheatreCache[] {
  const local = localRows.find(row => row && typeof row === 'object') as OperatingTheatreCache | undefined;
  const cloud = cloudRows.find(row => row && typeof row === 'object') as OperatingTheatreCache | undefined;
  if (!local && !cloud) return [];
  const patients = new Map<string, OperatingTheatrePatient>();
  const sources = local && cloud && local.fetchedAt > cloud.fetchedAt
    ? [cloud, local]
    : [local, cloud];
  for (const source of sources) {
    for (const patient of source?.patients ?? []) {
      if (patient && !isExpiredOperatingTheatrePatient(patient)) {
        patients.set(preadmissionPatientKey(patient), patient);
      }
    }
  }
  return [{
    key: 'latest',
    patients: [...patients.values()],
    fetchedAt: Math.max(local?.fetchedAt ?? 0, cloud?.fetchedAt ?? 0),
    source: 'cache',
    endpoint: cloud?.endpoint || local?.endpoint || '',
  }];
}

function ensureMasterTarifParents(
  incomingRows: any[],
  incomingItems: any[],
  localRows: any[],
): any[] {
  const parents = Array.isArray(incomingRows) ? [...incomingRows] : [];
  const parentIds = new Set(
    parents
      .map(row => Number(row?.id))
      .filter(id => Number.isFinite(id)),
  );
  const localById = new Map(
    localRows
      .filter(row => Number.isFinite(Number(row?.id)))
      .map(row => [Number(row.id), row]),
  );
  const grouped = new Map<number, any[]>();

  for (const item of incomingItems) {
    const masterTarifId = Number(item?.masterTarifId);
    if (!Number.isFinite(masterTarifId)) continue;
    const rows = grouped.get(masterTarifId) ?? [];
    rows.push(item);
    grouped.set(masterTarifId, rows);
  }

  for (const [masterTarifId, items] of grouped) {
    if (parentIds.has(masterTarifId)) continue;
    const first = items[0] ?? {};
    const local = localById.get(masterTarifId);
    parents.push(local ?? {
      id: masterTarifId,
      nama: `Master Tarif ${String(first.jenisTarif ?? '')} ${String(first.fromDateTarif ?? '')}`.trim(),
      rumahSakit: String(first.hospitals ?? ''),
      jenisTarif: String(first.jenisTarif ?? ''),
      tanggalBerlaku: String(first.fromDateTarif ?? ''),
      tanggalImport: new Date().toISOString(),
      jumlahItem: items.length,
      status: 'aktif',
      importedBy: 'Cloud restore',
      createdAt: Date.now(),
    });
  }

  return parents;
}

// ── Import semua stores dari plain object ─────────────────────────────────────

export const importAllStores = async (data: Record<string, any[]>): Promise<void> => {
  if (!Array.isArray(data.users) || data.users.length === 0) {
    throw new Error('Data Cloud tidak memiliki Master User. Restore dibatalkan agar akun lokal tidak terhapus.');
  }

  const localStorageRows = data[LOCAL_STORAGE_BACKUP_STORE];
  if (typeof window !== 'undefined' && Array.isArray(localStorageRows)) {
    const incomingKeys = new Set<string>();
    for (const row of localStorageRows) {
      const key = typeof row?.key === 'string' ? row.key : '';
      if (!key || NON_RESTORABLE_LOCAL_STORAGE_KEYS.has(key)) continue;
      incomingKeys.add(key);
    }
    // Restore the browser-local app cache as a complete snapshot, but never
    // move authentication/session or device identity between browsers.
    for (const key of Object.keys(window.localStorage)) {
      if (!NON_RESTORABLE_LOCAL_STORAGE_KEYS.has(key) && !incomingKeys.has(key)) {
        window.localStorage.removeItem(key);
      }
    }
    for (const row of localStorageRows) {
      const key = typeof row?.key === 'string' ? row.key : '';
      if (key && !NON_RESTORABLE_LOCAL_STORAGE_KEYS.has(key)) {
        window.localStorage.setItem(key, String(row.value ?? ''));
      }
    }
  }

  const db = await getDB();
  const restoreData = { ...data };
  const incomingTarifItems = Array.isArray(data.masterTarifItems)
    ? data.masterTarifItems
    : [];
  const incomingTarifParents = Array.isArray(data.masterTarifs)
    ? data.masterTarifs
    : [];
  if (incomingTarifItems.length > 0) {
    // Older Cloud snapshots may contain the 54k+ tariff detail rows but omit
    // the masterTarifs parent records. Recreate those parents so the Master
    // Tarif page can display and activate the restored tariff set.
    restoreData.masterTarifs = ensureMasterTarifParents(
      incomingTarifParents,
      incomingTarifItems,
      await db.getAll('masterTarifs'),
    );
  }

  for (const store of Object.keys(restoreData)) {
    if (!Array.isArray(restoreData[store])) continue;
    if (store === LOCAL_STORAGE_BACKUP_STORE) continue;
    // Never allow a cloud payload to address an arbitrary IndexedDB store.
    if (!(db.objectStoreNames as DOMStringList).contains(store)) continue;
    const rows = store === 'settings'
      ? restoreData[store].filter((row: any) => row?.key !== 'pendingCloudSync')
      : store === 'users'
      ? mergeUsersRestore(await db.getAll('users'), restoreData[store])
      : store === 'operatingTheatreCache'
      ? mergeOperatingTheatreRestore(
        await db.getAll('operatingTheatreCache'),
        restoreData[store],
      )
      : store === 'operatingTheatrePreadmissionCache'
      ? mergePreadmissionRestore(
        await db.getAll('operatingTheatrePreadmissionCache'),
        restoreData[store],
      )
      : restoreData[store];
    const tx = db.transaction(store as any, 'readwrite');
    await tx.objectStore(store as any).clear();
    for (const row of rows) {
      await (tx.objectStore(store as any) as any).put(row);
    }
    await tx.done;
  }
};

// ── Cek status koneksi ke cloud ───────────────────────────────────────────────

export const checkCloudStatus = async (): Promise<'online' | 'offline'> => {
  if (!navigator.onLine) return 'offline';

  try {
    const cloudUrl = await getCloudApiUrl();
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), CLOUD_SYNC_TIMEOUT_MS);

    if (!hasApiProxy()) {
      // Static hosting without a proxy: call GAS directly
      try {
        const json = (await apiRequest(
          `?action=status&apiKey=${encodeURIComponent(API_KEY)}`,
          {
            method: 'GET',
            timeoutMs: CLOUD_SYNC_TIMEOUT_MS,
            debugLabel: 'status',
          },
          cloudUrl,
        )).data as any;
        clearTimeout(timeout);
        return json.status === 'ok' || json.success === true ? 'online' : 'offline';
      } catch (err) {
        clearTimeout(timeout);
        logError('status', err);
        return 'offline';
      }
    } else {
      // Mode online lewat proxy API server
      const proxyUrl = apiUrl(`/api/cloud/status?url=${encodeURIComponent(cloudUrl)}`);
      logRequest('status/proxy', proxyUrl);
      try {
        const res = await fetch(proxyUrl, { signal: ctrl.signal });
        clearTimeout(timeout);
        logResponse('status/proxy', res.status, res.ok);
        if (!res.ok) {
          console.warn(
            `[CloudSync][status/proxy] HTTP ${res.status} — endpoint tidak tersedia. ` +
            'Periksa apakah API server berjalan dan VITE_API_BASE_URL sudah dikonfigurasi dengan benar.',
          );
          return 'offline';
        }
        const json = await res.json();
        return json.online ? 'online' : 'offline';
      } catch (err) {
        clearTimeout(timeout);
        logError('status/proxy', err);
        return 'offline';
      }
    }
  } catch (err) {
    logError('status', err);
    return 'offline';
  }
};

// ── Sync status lengkap ────────────────────────────────────────────────────────

export interface SyncStatusResult {
  status: 'online' | 'offline';
  lastBackup: number | null;
  autoBackupEnabled: boolean;
}

export const syncStatus = async (): Promise<SyncStatusResult> => {
  const [status, db] = await Promise.all([checkCloudStatus(), getDB()]);
  const [lastBackupEntry, autoEntry] = await Promise.all([
    db.get('settings', 'lastCloudBackup'),
    db.get('settings', 'autoCloudBackup'),
  ]);
  return {
    status,
    lastBackup: lastBackupEntry?.value ?? null,
    autoBackupEnabled: autoEntry?.value ?? false,
  };
};

// ── Backup ke Cloud ───────────────────────────────────────────────────────────

const performBackupCloud = async (): Promise<void> => {
  publishCloudBackupProgress({
    status: 'preparing',
    percent: 3,
    message: 'Menyiapkan data backup...',
    currentChunk: 0,
    totalChunks: 0,
  });
  const cloudUrl = await getCloudApiUrl();
  // ipawv2.html is LocalDB-first. Merge the shared Pending store before
  // exporting the full snapshot so a backup from one computer cannot omit
  // rows that were created or completed on another computer.
  if (isLocalFirstMode()) {
    await syncPendingsFromCloud();
  }
  const database = await exportAllStores();
  // Make the contract visible and fail loudly if a cache store is missing.
  // This prevents a successful-looking backup that only contains ordinary
  // patient data while losing the two Operating Theatre queues.
  for (const store of CLOUD_BACKED_OPERATING_THEATRE_STORES) {
    if (!Array.isArray(database[store])) {
      throw new Error(`Store Cloud ${store} tidak tersedia. Backup dibatalkan.`);
    }
  }

  const backupId = createCloudBackupId();
  const batches = buildCloudBackupChunks(database);
  const totalEntries = batches.reduce((total, batch) => total + batch.length, 0);
  publishCloudBackupProgress({
    status: 'uploading',
    percent: 8,
    message: 'Memulai pengiriman data...',
    currentChunk: 0,
    totalChunks: batches.length,
  });
  await sendCloudBackupOperation(cloudUrl, {
    action: 'saveStart',
    apiKey: API_KEY,
    backupId,
    totalChunks: batches.length,
    totalEntries,
    stores: Object.keys(database),
  });
  for (let index = 0; index < batches.length; index += 1) {
    await sendCloudBackupOperation(cloudUrl, {
      action: 'saveChunk',
      apiKey: API_KEY,
      backupId,
      chunkIndex: index,
      totalChunks: batches.length,
      entries: batches[index],
    });
    const uploadedChunks = index + 1;
    console.info(`[CloudSync][backup] chunk ${index + 1}/${batches.length}`);
    publishCloudBackupProgress({
      status: 'uploading',
      percent: 8 + Math.round((uploadedChunks / batches.length) * 82),
      message: `Mengirim bagian ${uploadedChunks} dari ${batches.length}...`,
      currentChunk: uploadedChunks,
      totalChunks: batches.length,
    });
  }
  publishCloudBackupProgress({
    status: 'committing',
    percent: 93,
    message: 'Menyelesaikan backup...',
    currentChunk: batches.length,
    totalChunks: batches.length,
  });
  await sendCloudBackupOperation(cloudUrl, {
    action: 'saveCommit',
    apiKey: API_KEY,
    backupId,
    totalChunks: batches.length,
    totalEntries,
    stores: Object.keys(database),
  }, CLOUD_SYNC_TIMEOUT_MS);

  const db = await getDB();
  await db.put('settings', { key: 'lastCloudBackup', value: Date.now() });
  const remainingOutbox = await db.count('syncOutbox');
  await markCloudSyncPending(remainingOutbox > 0);
  publishCloudBackupProgress({
    status: 'success',
    percent: 100,
    message: 'Backup Cloud selesai.',
    currentChunk: batches.length,
    totalChunks: batches.length,
  });
};

/**
 * Serialize full-browser backups. Every call gets its own snapshot after
 * previous requests finish, so logout always sends the newest local browser
 * state even when an automatic backup was already in progress.
 */
export const backupCloud = async (): Promise<void> => {
  // Coalesce triggers while a large snapshot is in flight. A second complete
  // snapshot is only started after the current one finishes, so logout,
  // autosave, and manual clicks cannot create a queue of 27 MB uploads.
  backupRequested = true;
  if (!activeBackup) {
    activeBackup = (async () => {
      try {
        while (backupRequested) {
          backupRequested = false;
          await performBackupCloud();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishCloudBackupProgress({
          status: 'error',
          percent: 0,
          message: 'Backup Cloud gagal.',
          currentChunk: 0,
          totalChunks: 0,
          error: message,
        });
        throw error;
      }
    })();
  }
  const current = activeBackup;
  try {
    await current;
  } finally {
    if (activeBackup === current) activeBackup = null;
  }
};

async function backgroundBackupTick(reason: string): Promise<void> {
  if (!isBrowserOnline()) return;
  if (isOfflineMode() && reason === 'startup') {
    const db = await getDB();
    const [pending, outboxCount] = await Promise.all([
      db.get('settings', 'pendingCloudSync'),
      db.count('syncOutbox'),
    ]);
    if (!pending?.value && outboxCount === 0) return;
  }
  try {
    await syncPendingCloudChanges();
    const db = await getDB();
    const lastBackup = await db.get('settings', 'lastCloudBackup');
    const stale = !lastBackup?.value ||
      Date.now() - Number(lastBackup.value) >= FULL_BACKUP_INTERVAL_MS;
    if (stale || reason !== 'interval') {
      await backupCloud();
      console.info(`[CloudSync][background] Backup selesai (${reason})`);
    }
  } catch (error) {
    // Keep the worker alive. The next interval or online event retries without
    // blocking login, navigation, or logout.
    logError(`background/${reason}`, error);
  }
}

/**
 * Reconcile changes made while disconnected. Row-level mutations are sent
 * first; the legacy full snapshot follows only when no outbox item remains.
 */
export async function syncPendingCloudChanges(): Promise<void> {
  if (!isBrowserOnline()) return;
  // The offline launcher uses the same worker as the web app. Pull and
  // publish Pending rows before considering the full snapshot marker.
  await syncPendingsFromCloud();
  await flushSyncOutbox();
  const db = await getDB();
  const pendingSnapshot = await db.get('settings', 'pendingCloudSync');
  const remaining = await db.count('syncOutbox');
  if (remaining > 0) return;
  if (pendingSnapshot?.value) {
    await backupCloud();
  }
}

/**
 * Keep cloud backup independent from the current authenticated route. This
 * worker lives for as long as the app tab is open, including after logout.
 */
export const startBackgroundBackupSync = (): (() => void) => {
  if (typeof window === 'undefined' || backgroundBackupStarted) return () => {};
  backgroundBackupStarted = true;

  void backgroundBackupTick('startup');
  backgroundBackupTimer = window.setInterval(() => {
    void backgroundBackupTick('interval');
  }, FULL_BACKUP_INTERVAL_MS);

  const retry = () => {
    void syncPendingCloudChanges().catch(error => {
      logError('connection-restored', error);
    });
  };
  window.addEventListener('online', retry);
  const stop = () => {
    if (backgroundBackupTimer !== null) {
      window.clearInterval(backgroundBackupTimer);
      backgroundBackupTimer = null;
    }
    window.removeEventListener('online', retry);
    backgroundBackupStarted = false;
  };
  return stop;
};

async function discardPendingLocalChangesAfterRestore(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['syncOutbox', 'settings'], 'readwrite');
  await tx.objectStore('syncOutbox').clear();
  await tx.objectStore('settings').put({ key: 'pendingCloudSync', value: false });
  await tx.objectStore('settings').put({
    key: LOCAL_CLOUD_CHANGE_REVISION_KEY,
    value: Date.now(),
  });
  await tx.done;
}

// ── Restore dari Cloud ────────────────────────────────────────────────────────
// KEAMANAN: data lokal TIDAK akan dihapus jika download atau validasi gagal.
// Setelah Cloud berhasil diunduh dan divalidasi, Cloud menjadi sumber utama:
// perubahan lokal yang belum diunggah dibuang agar Restore tidak berhenti pada
// pendingCloudSync dan tidak langsung ditimpa kembali oleh worker backup.

async function performRestoreCloud(options: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? CLOUD_SYNC_TIMEOUT_MS;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Perangkat sedang offline; data lokal digunakan.');
  }
  const cloudUrl = await getCloudApiUrl();

  // Do not let an already-running snapshot upload overwrite the Cloud copy
  // immediately after this restore. A failed backup must not block restore.
  if (activeBackup) {
    try {
      await activeBackup;
    } catch (error) {
      logError('restore/wait-backup', error);
    }
  }

  // GAS doGet dengan action=restore mengembalikan data yang tersimpan
  let json: any;

  if (!hasApiProxy()) {
    // Static hosting without a proxy: GET directly from GAS
    try {
      json = (await apiRequest(
        `?action=restore&apiKey=${encodeURIComponent(API_KEY)}`,
        {
          method: 'GET',
          timeoutMs,
          debugLabel: 'restore',
        },
        cloudUrl,
      )).data;
    } catch (err) {
      logError('restore/direct', err);
      throw err;
    }
  } else {
    // Mode online: lewat proxy API server
    const restoreUrl = `${cloudUrl}?action=restore&apiKey=${API_KEY}`;
    const proxyUrl = apiUrl(`/api/cloud/restore?url=${encodeURIComponent(restoreUrl)}`);
    logRequest('restore/proxy', proxyUrl);
    let res: Response;
    try {
       res = await fetchWithTimeout(proxyUrl, {
        method: 'GET',
       }, timeoutMs);
      logResponse('restore/proxy', res.status, res.ok);
    } catch (err) {
      logError('restore/proxy', err);
      throw err;
    }
    if (!res.ok) {
      let errMsg = `Server merespons HTTP ${res.status} — data lokal tidak diubah`;
      if (res.status === 404) {
        errMsg =
          `HTTP 404 — endpoint restore tidak ditemukan. ` +
          `Pastikan API server berjalan dan VITE_API_BASE_URL dikonfigurasi. ` +
          `URL yang dipanggil: ${res.url} — data lokal tidak diubah`;
      } else {
        try {
          const j = await res.json();
          if (j?.error) errMsg = j.error + ' — data lokal tidak diubah';
        } catch { /* ignore */ }
      }
      throw new Error(errMsg);
    }

    try {
      json = await res.json();
    } catch {
      throw new Error('Respons dari Cloud bukan JSON yang valid — data lokal tidak diubah');
    }
  }

  if (!json?.success) {
    throw new Error(json?.error || 'Download gagal — data lokal tidak diubah');
  }

  // Proxy mengembalikan { success, data } — GAS langsung: { success, database }
  const data: Record<string, any[]> = json.data ?? json.database;
  if (!data || typeof data !== 'object') {
    throw new Error('Format data dari Cloud tidak valid — data lokal tidak diubah');
  }
  if (!Array.isArray(data.users) || data.users.length === 0) {
    throw new Error('Data Cloud tidak memiliki Master User — data lokal tidak diubah');
  }

  // 2. Restore — hanya dijalankan jika download berhasil
  await importAllStores(data);
  await discardPendingLocalChangesAfterRestore();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ipaw:master-estimasi-changed'));
    window.dispatchEvent(new Event('ipaw:notification-restore'));
  }

  const restoreDb = await getDB();
  await restoreDb.put('settings', { key: 'lastCloudBackup', value: Date.now() });
}

export const restoreCloud = async (options: { timeoutMs?: number } = {}): Promise<void> => {
  if (activeRestore) return activeRestore;
  const current = performRestoreCloud(options);
  activeRestore = current;
  try {
    await current;
  } finally {
    if (activeRestore === current) activeRestore = null;
  }
};

// ── Sync users dari cloud ke IndexedDB lokal (silent, hanya users) ────────────
// Dipakai saat startup agar user yang dibuat di perangkat lain langsung tersedia.

export const syncUsersFromCloud = async (): Promise<void> => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  try {
    const cloudUrl = await getCloudApiUrl();
    let json: any;
    if (!hasApiProxy()) {
      json = (await apiRequest(
        `?action=restore&apiKey=${encodeURIComponent(API_KEY)}`,
        {
          method: 'GET',
          timeoutMs: CLOUD_SYNC_TIMEOUT_MS,
          debugLabel: 'syncUsers',
        },
        cloudUrl,
      )).data;
    } else {
      const restoreUrl = `${cloudUrl}?action=restore&apiKey=${API_KEY}`;
      const proxyUrl = apiUrl(`/api/cloud/restore?url=${encodeURIComponent(restoreUrl)}`);
      logRequest('syncUsers/proxy', proxyUrl);
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), CLOUD_SYNC_TIMEOUT_MS);
      const res = await fetch(proxyUrl, { signal: ctrl.signal });
      clearTimeout(timeout);
      logResponse('syncUsers/proxy', res.status, res.ok);
      if (!res.ok) {
        console.warn(`[CloudSync][syncUsers] HTTP ${res.status} — sync user dibatalkan`);
        return;
      }
      try {
        json = await res.json();
      } catch {
        return;
      }
    }
    if (!json?.success) return;

    const data: Record<string, any[]> = json.data ?? json.database;
    if (!Array.isArray(data?.users) || data.users.length === 0) return;

    // Upsert users saja — jangan clear, agar user lokal yang belum ter-backup tetap ada
    const db = await getDB();
    const tx = db.transaction('users', 'readwrite');
    for (const u of data.users) {
      await (tx.objectStore('users') as any).put(u);
    }
    await tx.done;
  } catch (err) {
    // Silent fail — jangan pernah memblokir startup app
    logError('syncUsers', err);
  }
};

// ── Auto Backup (panggil setelah perubahan data penting) ──────────────────────

export const triggerAutoBackup = async (): Promise<'synced' | 'pending'> => {
  // Set the marker before any network work. This also protects a concurrent
  // startup restore from importing an older Cloud snapshot over local edits.
  await markCloudSyncPending(true);
  if (!isBrowserOnline() || isOfflineMode()) {
    return 'pending';
  }
  try {
    // Existing modules still write to IndexedDB directly. Until each module
    // uses row-level mutations, retain a durable pending marker and upload the
    // complete local snapshot after any queued row changes are acknowledged.
    await flushSyncOutbox();
    await backupCloud();
    return 'synced';
  } catch (err) {
    await markCloudSyncPending(true);
    logError('autoBackup', err);
    return 'pending';
  }
};
