import { readCloudStore } from './cloudDatabase';
import { getDB, Patient, Pending, JustInfo } from './db';
import { patientIdentityMatches } from './patientIdentity';
import { isLocalFirstMode } from './storageMode';

export type DataSource = 'cloud' | 'local';

export interface StoreReadResult<T> {
  records: T[];
  source: DataSource;
  error?: unknown;
  localRecords?: T[];
}

export interface PatientDataBundle {
  patient: Patient;
  pendings: Pending[];
  justInfos: JustInfo[];
  sourceByStore: Record<string, DataSource>;
  unavailableStores: string[];
}

const STORE_KEY_FIELDS: Record<string, string> = {
  users: 'id',
  patients: 'noRM',
  episodes: 'id',
  pendings: 'id',
  justInfos: 'id',
  operanShifts: 'id',
  importLogs: 'id',
  activityLogs: 'id',
  settings: 'key',
  outlookEmails: 'id',
  masterTarifs: 'id',
  masterTarifItems: 'id',
  syncLogs: 'id',
  estimasiBiaya: 'id',
  billingRules: 'id',
  billingChecks: 'id',
  notifikasiBilling: 'id',
  kasirTemplates: 'id',
  uraianKonfirmasi: 'noRM',
  uraianKonfirmasiEpisodes: 'recordKey',
  masterTemplateTindakan: 'id',
  estimasiTindakan: 'id',
  masterEstimasiTindakan: 'id',
  masterEstimasiTarif: 'id',
  masterEstimasiKategori: 'id',
  masterEstimasiMappings: 'id',
  masterEstimasiMeta: 'key',
  checklistEpisodes: 'episodeNo',
  checklistHistory: 'id',
};

const PATIENT_RELATED_STORES = [
  'episodes',
  'pendings',
  'justInfos',
  'estimasiBiaya',
  'billingChecks',
  'notifikasiBilling',
  'uraianKonfirmasi',
  'uraianKonfirmasiEpisodes',
  'estimasiTindakan',
  'checklistEpisodes',
  'checklistHistory',
] as const;

function recordKey(store: string, record: any): string {
  const keyField = STORE_KEY_FIELDS[store];
  const value = keyField ? record?.[keyField] : record?.id;
  return value === null || value === undefined ? '' : String(value);
}

async function getLocalRecords(store: string): Promise<any[]> {
  const db = await getDB();
  return db.getAll(store as any) as Promise<any[]>;
}

async function cacheCloudRecords(store: string, records: any[]): Promise<void> {
  const db = await getDB();
  const localRecords = await getLocalRecords(store);
  const pendingEntries = (await db.getAll('syncOutbox')).filter(entry => entry.store === store);
  const pendingUpserts = new Map<string, any>();
  const pendingDeletes = new Set<string>();
  for (const entry of pendingEntries) {
    const key = entry.action === 'upsertRecord'
      ? recordKey(store, entry.record)
      : String(entry.key ?? '');
    if (!key) continue;
    if (entry.action === 'upsertRecord') {
      const local = localRecords.find(record => recordKey(store, record) === key);
      if (local) pendingUpserts.set(key, local);
    } else {
      pendingDeletes.add(key);
    }
  }
  const tx = db.transaction(store as any, 'readwrite');
  await tx.objectStore(store as any).clear();
  for (const record of records) {
    if (record && typeof record === 'object') {
      await (tx.objectStore(store as any) as any).put(record);
    }
  }
  for (const [key, record] of pendingUpserts) {
    if (!pendingDeletes.has(key)) {
      await (tx.objectStore(store as any) as any).put(record);
    }
  }
  await tx.done;
}

/**
 * Return Cloud records first and keep the local replica as an explicit fallback.
 *
 * Pending local mutations win for their keys. This prevents a successful Cloud
 * read from visually undoing a change that is still waiting in syncOutbox.
 */
export async function readStoreCloudFirst<T = any>(store: string): Promise<StoreReadResult<T>> {
  const db = await getDB();
  const localRecords = await getLocalRecords(store);
  if (isLocalFirstMode()) {
    return {
      records: localRecords as T[],
      source: 'local',
      localRecords: localRecords as T[],
    };
  }
  const pendingEntries = (await db.getAll('syncOutbox')).filter(entry => entry.store === store);
  const pendingKeys = new Map<string, 'upsert' | 'delete'>();

  for (const entry of pendingEntries) {
    const key = entry.action === 'upsertRecord'
      ? recordKey(store, entry.record)
      : String(entry.key ?? '');
    if (key) pendingKeys.set(key, entry.action === 'upsertRecord' ? 'upsert' : 'delete');
  }

  try {
    const response = await readCloudStore<T>(store);
    const cloudRecords = Array.isArray(response.records) ? response.records : [];
    if (cloudRecords.length === 0 && localRecords.length > 0) {
      return {
        records: localRecords as T[],
        source: 'local',
        localRecords: localRecords as T[],
      };
    }
    const localByKey = new Map(localRecords.map(record => [recordKey(store, record), record]));
    // Cloud wins when the same key exists. Local-only records remain visible
    // as per-record fallback, which is important for a patient created or
    // edited on a workstation before it reached the Spreadsheet.
    const mergedByKey = new Map(localRecords.map(record => [recordKey(store, record), record]));
    for (const record of cloudRecords) {
      const key = recordKey(store, record);
      if (key) mergedByKey.set(key, record);
    }
    for (const [key, action] of pendingKeys) {
      if (action === 'upsert') {
        const localRecord = localByKey.get(key);
        if (localRecord) mergedByKey.set(key, localRecord);
      } else {
        mergedByKey.delete(key);
      }
    }

    const records = [...mergedByKey.values()];
    await cacheCloudRecords(store, records);

    return {
      records,
      source: records.length > cloudRecords.length ? 'local' : 'cloud',
      localRecords: localRecords as T[],
    };
  } catch (error) {
    return {
      records: localRecords as T[],
      source: 'local',
      error,
      localRecords: localRecords as T[],
    };
  }
}

function relatedToPatient(patient: Patient, record: any): boolean {
  return patientIdentityMatches(patient, record);
}

/**
 * Hydrate the selected patient and the operational records shown in its detail
 * view. Each store independently falls back to the local replica when Cloud
 * is unavailable, so one optional store cannot blank the whole patient view.
 */
export async function loadPatientDataBundle(localPatient: Patient): Promise<PatientDataBundle> {
  const storeNames = ['patients', ...PATIENT_RELATED_STORES] as const;
  const results = await Promise.all(
    storeNames.map(async store => [store, await readStoreCloudFirst(store)] as const),
  );
  const byStore = new Map(results);
  const patientResult = byStore.get('patients') as StoreReadResult<Patient>;

  const cloudPatient = patientResult.records.find(candidate =>
    patientIdentityMatches(localPatient, candidate),
  );
  const patient = cloudPatient || localPatient;

  const pendingResult = byStore.get('pendings') as StoreReadResult<Pending>;
  const infoResult = byStore.get('justInfos') as StoreReadResult<JustInfo>;
  const localPendingRecords = (pendingResult.localRecords ?? []).filter(record => relatedToPatient(patient, record));
  const localInfoRecords = (infoResult.localRecords ?? []).filter(record => relatedToPatient(patient, record));
  const cloudPendingRecords = pendingResult.records.filter(record => relatedToPatient(patient, record));
  const cloudInfoRecords = infoResult.records.filter(record => relatedToPatient(patient, record));
  const pendings = cloudPendingRecords.length > 0 ? cloudPendingRecords : localPendingRecords;
  const justInfos = cloudInfoRecords.length > 0 ? cloudInfoRecords : localInfoRecords;

  // If Cloud has the store but not this selected patient, keep that patient's
  // local records available instead of leaving the detail view incomplete.
  if (cloudPendingRecords.length === 0 && localPendingRecords.length > 0) {
    await cacheCloudRecords('pendings', [...pendingResult.records, ...localPendingRecords]);
  }
  if (cloudInfoRecords.length === 0 && localInfoRecords.length > 0) {
    await cacheCloudRecords('justInfos', [...infoResult.records, ...localInfoRecords]);
  }

  return {
    patient,
    pendings,
    justInfos,
    sourceByStore: Object.fromEntries(
      results.map(([store, result]) => [store, result.source]),
    ),
    unavailableStores: results
      .filter(([, result]) => result.source === 'local' && result.error)
      .map(([store]) => store),
  };
}

export function patientRelatedStoreNames(): readonly string[] {
  return PATIENT_RELATED_STORES;
}

const ROUTE_STORE_GROUPS: Array<{ matches: (path: string) => boolean; stores: readonly string[] }> = [
  {
    matches: path => ['/','/patients','/pending','/history','/reports','/kasir','/billing-checker',
      '/estimasi-biaya-tindakan','/checklist-pasien'].some(prefix => path === prefix || path.startsWith(`${prefix}/`)),
    stores: ['patients', ...PATIENT_RELATED_STORES, 'estimasiTindakan'],
  },
  {
    matches: path => path === '/pasien-rencana-tindakan' || path.startsWith('/pasien-preadmission'),
    stores: ['patients', 'operatingTheatreCache', 'operatingTheatreCompletedCache',
      'operatingTheatrePreadmissionCache', 'operatingTheatreInProgressCache', ...PATIENT_RELATED_STORES],
  },
  {
    matches: path => ['/master-tarif','/master-rule-billing','/settings'].includes(path),
    stores: ['masterTarifs', 'masterTarifItems', 'billingRules', 'settings',
      'masterTemplateTindakan', 'masterEstimasiTindakan', 'masterEstimasiTarif',
      'masterEstimasiKategori', 'masterEstimasiMappings', 'masterEstimasiMeta'],
  },
  {
    matches: path => ['/monitoring-ktm','/igd-ward'].includes(path),
    stores: ['patients', 'episodes', 'settings'],
  },
  {
    matches: path => path === '/activity-log' || path === '/sync-history',
    stores: ['activityLogs', 'syncLogs'],
  },
];

export function storesForRoute(path: string): readonly string[] {
  return ROUTE_STORE_GROUPS.find(group => group.matches(path))?.stores ?? ['patients'];
}

export interface RouteHydrationResult {
  sourceByStore: Record<string, DataSource>;
  unavailableStores: string[];
}

/**
 * Hydrate the stores needed by the active menu before that menu renders.
 * Pages can continue using their existing IndexedDB queries because the
 * successful Cloud result has already been written to the local replica.
 */
export async function hydrateRouteData(path: string): Promise<RouteHydrationResult> {
  const stores = [...new Set(storesForRoute(path))];
  if (isLocalFirstMode()) {
    return {
      sourceByStore: Object.fromEntries(stores.map(store => [store, 'local'])),
      unavailableStores: [],
    };
  }
  const results = await Promise.all(
    stores.map(async store => [store, await readStoreCloudFirst(store)] as const),
  );
  return {
    sourceByStore: Object.fromEntries(results.map(([store, result]) => [store, result.source])),
    unavailableStores: results
      .filter(([, result]) => result.source === 'local' && result.error)
      .map(([store]) => store),
  };
}