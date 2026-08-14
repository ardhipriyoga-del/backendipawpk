import {
  getDB,
  type PatchActivityLog,
  type PatchBackup,
  type PatchData,
  type PatchManifest,
  type PatchRegistryEntry,
  type PatchStatus,
} from './db';
import { createRestorePoint } from './cloudSync';
import { writeLog } from './writeLog';

export type { PatchActivityLog, PatchRegistryEntry } from './db';

export const IPAW_VERSION = '1.0.0';
const PATCH_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PATCH_EVENT = 'ipaw:patches-changed';
const PATCH_DATA_PREFIX = 'patch:';

export interface PatchMenuItem {
  path: string;
  label: string;
  description: string;
}

interface PatchDefinition {
  id: string;
  name: string;
  version: string;
  menu?: PatchMenuItem | PatchMenuItem[];
  install?: (context: PatchContext) => void | Promise<void>;
  activate?: (context: PatchContext) => void | Promise<void>;
  deactivate?: (context: PatchContext) => void | Promise<void>;
  uninstall?: (context: PatchContext) => void | Promise<void>;
}

export interface PatchContext {
  patchId: string;
  manifest: PatchManifest;
  storage: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
  ui: {
    registerMenuItem: (item: PatchMenuItem) => void;
    unregisterMenuItems: () => void;
  };
}

export interface PatchFilePayload {
  manifest: PatchManifest;
  code: string;
  fileName: string;
  checksum: string;
}

export interface PatchValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  payload?: PatchFilePayload;
  existing?: PatchRegistryEntry;
  dependencyStatus: Array<{ id: string; minVersion: string; availableVersion?: string; ok: boolean }>;
}

export interface PatchActionResult {
  ok: boolean;
  message: string;
}

export const PATCH_TEMPLATE = {
  manifest: {
    id: 'ipaw-nama-fitur',
    name: 'IPAW Nama Fitur',
    version: '1.0.0',
    author: 'Nama Pembuat',
    description: 'Deskripsi singkat fitur patch.',
    minIPAWVersion: IPAW_VERSION,
    dependencies: [],
  },
  code: `IPAW.registerPatch({
  id: "ipaw-nama-fitur",
  name: "IPAW Nama Fitur",
  version: "1.0.0",
  install(context) {
    // Simpan konfigurasi patch melalui context.storage.set("key", value).
  },
  activate(context) {
    context.ui.registerMenuItem({
      path: "/patch/ipaw-nama-fitur/fitur",
      label: "Nama Fitur",
      description: "Menu dari patch.",
    });
  },
  deactivate(context) {
    context.ui.unregisterMenuItems();
  },
  uninstall(context) {
    context.ui.unregisterMenuItems();
  }
});`,
};

export const DEMO_PATCH_PAYLOAD: PatchFilePayload = {
  manifest: {
    id: 'ipaw-demo-patch',
    name: 'IPAW Demo Patch',
    version: '1.0.0',
    author: 'IPAW',
    description: 'Patch demo untuk menguji siklus install, enable, disable, rollback, dan uninstall.',
    minIPAWVersion: IPAW_VERSION,
    dependencies: [],
  },
  code: `IPAW.registerPatch({
  id: "ipaw-demo-patch",
  name: "IPAW Demo Patch",
  version: "1.0.0",
  install(context) {
    return context.storage.set("installed", true);
  },
  activate(context) {
    context.ui.registerMenuItem({
      path: "/patch/ipaw-demo-patch/patch-test",
      label: "Patch Test",
      description: "Menu demo dari IPAW Patch Manager.",
    });
  },
  deactivate(context) {
    context.ui.unregisterMenuItems();
  },
  uninstall(context) {
    context.ui.unregisterMenuItems();
    return context.storage.remove("installed");
  }
});`,
  fileName: 'ipaw-demo-patch-1.0.0.ipawpatch',
  checksum: '',
};

const runtimeDefinitions = new Map<string, PatchDefinition>();
const runtimeMenus = new Map<string, PatchMenuItem[]>();
let activeInitialization: Promise<void> | null = null;

function emitPatchChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PATCH_EVENT));
}

export function subscribeToPatchChanges(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(PATCH_EVENT, listener);
  return () => window.removeEventListener(PATCH_EVENT, listener);
}

export function getPatchMenus(): PatchMenuItem[] {
  return Array.from(runtimeMenus.values()).flat();
}

function compareVersions(left: string, right: string): number {
  const a = left.split('-')[0].split('.').map(Number);
  const b = right.split('-')[0].split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0) ? 1 : -1;
  }
  return 0;
}

function normalizeManifest(value: any): PatchManifest {
  const source = value && typeof value === 'object' ? value : {};
  const dependencies = Array.isArray(source.dependencies)
    ? source.dependencies.map((dependency: any) => {
        if (typeof dependency === 'string') {
          const [id, version = '0.0.0'] = dependency.split(/\s*>=\s*/);
          return { id: id.trim(), minVersion: version.trim() };
        }
        return {
          id: String(dependency?.id ?? '').trim(),
          minVersion: String(dependency?.minVersion ?? dependency?.version ?? '0.0.0').trim(),
        };
      })
    : [];
  return {
    id: String(source.id ?? '').trim(),
    name: String(source.name ?? '').trim(),
    version: String(source.version ?? '').trim(),
    author: String(source.author ?? '').trim(),
    description: String(source.description ?? '').trim(),
    minIPAWVersion: String(source.minIPAWVersion ?? '0.0.0').trim(),
    dependencies,
    ...(source.checksum ? { checksum: String(source.checksum).trim() } : {}),
  };
}

async function checksumFor(value: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return `sha256-${Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function validateCodeSafety(code: string): string[] {
  const forbidden = [
    { pattern: /\beval\s*\(/i, label: 'eval()' },
    { pattern: /\bnew\s+Function\b/i, label: 'new Function()' },
    { pattern: /\bimport\s*\(/i, label: 'dynamic import' },
    { pattern: /\b(?:window|globalThis|self)\b/i, label: 'akses global browser' },
    { pattern: /\b(?:document|indexedDB|localStorage|sessionStorage)\b/i, label: 'akses storage/DOM langsung' },
    { pattern: /\b(?:fetch|XMLHttpRequest|WebSocket)\b/i, label: 'akses jaringan' },
    { pattern: /\bdeleteDatabase\b/i, label: 'penghapusan database' },
  ];
  return forbidden.filter(item => item.pattern.test(code)).map(item => `Code patch mengandung ${item.label} yang tidak diizinkan.`);
}

export async function parsePatchFile(file: File): Promise<PatchFilePayload> {
  if (!file.name.toLowerCase().endsWith('.ipawpatch')) {
    throw new Error('File patch harus menggunakan ekstensi .ipawpatch.');
  }
  const text = await file.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Format patch harus berupa JSON yang valid.');
  }
  const manifest = normalizeManifest(parsed.manifest ?? parsed);
  const code = typeof parsed.code === 'string' ? parsed.code : '';
  if (!code.trim()) throw new Error('Field code pada patch wajib diisi.');
  const checksum = await checksumFor(code);
  return { manifest, code, fileName: file.name, checksum };
}

export async function preparePatchDownload(
  payload: Pick<PatchFilePayload, 'manifest' | 'code'>,
  fileName: string,
): Promise<void> {
  const checksum = await checksumFor(payload.code);
  const content = JSON.stringify({
    manifest: { ...payload.manifest, checksum },
    code: payload.code,
  }, null, 2);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function prepareDemoPatchDownload(): Promise<void> {
  await preparePatchDownload(DEMO_PATCH_PAYLOAD, DEMO_PATCH_PAYLOAD.fileName);
}

function getPatchDependencies(registry: PatchRegistryEntry[], manifest: PatchManifest) {
  return manifest.dependencies.map(dependency => {
    const match = registry.find(entry => entry.id === dependency.id && entry.status === 'active');
    return {
      ...dependency,
      availableVersion: match?.manifest.version,
      ok: Boolean(match && compareVersions(match.manifest.version, dependency.minVersion) >= 0),
    };
  });
}

export async function validatePatchFile(file: File): Promise<PatchValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let payload: PatchFilePayload | undefined;
  try {
    payload = await parsePatchFile(file);
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)], warnings: [], dependencyStatus: [] };
  }
  const db = await getDB();
  const registry = await db.getAll('patchRegistry');
  const existing = registry.find(entry => entry.id === payload!.manifest.id);
  const manifest = payload.manifest;
  if (!PATCH_ID_PATTERN.test(manifest.id)) errors.push('ID patch hanya boleh berisi huruf kecil, angka, titik, garis bawah, dan tanda hubung.');
  if (!manifest.name) errors.push('Nama patch wajib diisi.');
  if (!SEMVER_PATTERN.test(manifest.version)) errors.push('Version harus mengikuti format semver, misalnya 1.0.0.');
  if (!manifest.author) errors.push('Author wajib diisi.');
  if (!SEMVER_PATTERN.test(manifest.minIPAWVersion)) errors.push('minIPAWVersion harus mengikuti format semver.');
  if (compareVersions(manifest.minIPAWVersion, IPAW_VERSION) > 0) {
    errors.push(`Patch membutuhkan IPAW ${manifest.minIPAWVersion}, sedangkan versi aplikasi ini ${IPAW_VERSION}.`);
  }
  const dependencyStatus = getPatchDependencies(registry, manifest);
  dependencyStatus.filter(item => !item.ok).forEach(item => {
    errors.push(`Dependency ${item.id} >= ${item.minVersion} belum tersedia atau belum aktif.`);
  });
  if (existing && compareVersions(manifest.version, existing.manifest.version) < 0) {
    errors.push(`Versi patch lebih lama dari versi terpasang (${existing.manifest.version}).`);
  } else if (existing && compareVersions(manifest.version, existing.manifest.version) === 0) {
    errors.push('Patch dengan ID dan versi yang sama sudah terpasang.');
  } else if (existing) {
    warnings.push(`Ini akan memperbarui patch dari versi ${existing.manifest.version}.`);
  }
  if (manifest.checksum && manifest.checksum !== payload.checksum) {
    errors.push('Checksum code patch tidak cocok.');
  }
  errors.push(...validateCodeSafety(payload.code));
  if (!/\bIPAW\s*\.\s*registerPatch\b|\bregisterPatch\s*\(/.test(payload.code)) {
    errors.push('Code patch harus mendaftarkan definisinya melalui IPAW.registerPatch(...).');
  }
  return { valid: errors.length === 0, errors, warnings, payload, existing, dependencyStatus };
}

function makeDefinitionCollector(expected: PatchManifest): {
  getDefinition: () => PatchDefinition | null;
  sandbox: Record<string, unknown>;
} {
  let definition: PatchDefinition | null = null;
  const registerPatch = (candidate: PatchDefinition) => {
    if (!candidate || candidate.id !== expected.id || candidate.version !== expected.version) {
      throw new Error('Definisi patch tidak cocok dengan manifest ID/version.');
    }
    definition = candidate;
  };
  const sandbox = {
    version: IPAW_VERSION,
    registerPatch,
  };
  return { getDefinition: () => definition, sandbox };
}

function executePatchCode(payload: PatchFilePayload): PatchDefinition {
  const collector = makeDefinitionCollector(payload.manifest);
  // Patch code is deliberately evaluated only after strict manifest and source
  // checks. The exposed API contains no database handle, network client, DOM
  // reference, or ability to address an existing application store.
  const execute = new Function('IPAW', 'registerPatch', `"use strict";\n${payload.code}`);
  try {
    execute(collector.sandbox, collector.sandbox.registerPatch);
  } catch (error) {
    throw new Error(`Code patch gagal dimuat: ${error instanceof Error ? error.message : String(error)}`);
  }
  const definition = collector.getDefinition();
  if (!definition) throw new Error('Code patch tidak mendaftarkan definisi yang valid.');
  return definition;
}

function patchContext(manifest: PatchManifest): PatchContext {
  return {
    patchId: manifest.id,
    manifest,
    storage: {
      get: async key => {
        const db = await getDB();
        const row = await db.get('patchData', `${PATCH_DATA_PREFIX}${manifest.id}:${key}`);
        return row?.value;
      },
      set: async (key, value) => {
        const db = await getDB();
        const row: PatchData = {
          key: `${PATCH_DATA_PREFIX}${manifest.id}:${key}`,
          patchId: manifest.id,
          value,
          updatedAt: Date.now(),
        };
        await db.put('patchData', row);
      },
      remove: async key => {
        const db = await getDB();
        await db.delete('patchData', `${PATCH_DATA_PREFIX}${manifest.id}:${key}`);
      },
    },
    ui: {
      registerMenuItem: item => {
        if (!item.path.startsWith(`/patch/${manifest.id}`)) {
          throw new Error('Menu patch hanya boleh menggunakan path namespace patch tersebut.');
        }
        const existing = runtimeMenus.get(manifest.id) ?? [];
        runtimeMenus.set(manifest.id, [...existing.filter(menu => menu.path !== item.path), item]);
        emitPatchChange();
      },
      unregisterMenuItems: () => {
        runtimeMenus.delete(manifest.id);
        emitPatchChange();
      },
    },
  };
}

async function loadDefinition(entry: PatchRegistryEntry): Promise<PatchDefinition> {
  const definition = executePatchCode({
    manifest: entry.manifest,
    code: entry.code,
    fileName: `${entry.id}.ipawpatch`,
    checksum: entry.checksum,
  });
  runtimeDefinitions.set(entry.id, definition);
  return definition;
}

async function invokePatch(entry: PatchRegistryEntry, hook: keyof Pick<PatchDefinition, 'install' | 'activate' | 'deactivate' | 'uninstall'>): Promise<void> {
  const definition = runtimeDefinitions.get(entry.id) ?? await loadDefinition(entry);
  const handler = definition[hook];
  if (typeof handler === 'function') await handler(patchContext(entry.manifest));
}

async function writePatchActivity(
  entry: Pick<PatchRegistryEntry, 'id' | 'manifest'>,
  action: string,
  status: PatchActivityLog['status'],
  detail: string,
): Promise<void> {
  const session = typeof localStorage !== 'undefined' ? localStorage.getItem('emc_session') : null;
  let user = { username: 'system', namaUser: 'System', role: 'system' as const };
  try {
    const parsed = session ? JSON.parse(session) : null;
    if (parsed?.user) user = { username: parsed.user.username, namaUser: parsed.user.namaLengkap ?? parsed.user.username, role: parsed.user.role };
  } catch {
    // Audit logging must never block a patch action.
  }
  const db = await getDB();
  await db.add('patchActivityLogs', {
    patchId: entry.id,
    patchName: entry.manifest.name,
    version: entry.manifest.version,
    action,
    status,
    detail,
    ...user,
    timestamp: Date.now(),
  });
  await writeLog({ modul: 'Patch Manager', aktivitas: action, detail: `${entry.manifest.name}: ${detail}`, status });
}

async function snapshotPatchState(
  entry: PatchRegistryEntry | null,
  action: PatchBackup['action'],
  patchId = entry?.id ?? 'unknown',
): Promise<PatchBackup> {
  const db = await getDB();
  const previousData = entry ? await db.getAllFromIndex('patchData', 'patchId', entry.id) : [];
  const backup: PatchBackup = {
    id: `patch-backup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    patchId,
    createdAt: Date.now(),
    action,
    previousRegistry: entry,
    previousData,
  };
  await db.put('patchBackups', backup);
  return backup;
}

async function clearPatchData(patchId: string): Promise<void> {
  const db = await getDB();
  const rows = await db.getAllFromIndex('patchData', 'patchId', patchId);
  await Promise.all(rows.map(row => db.delete('patchData', row.key)));
}

async function restorePatchBackup(backup: PatchBackup): Promise<void> {
  const db = await getDB();
  await clearPatchData(backup.patchId);
  if (backup.previousRegistry) {
    await db.put('patchRegistry', backup.previousRegistry);
    for (const row of backup.previousData) await db.put('patchData', row);
    runtimeDefinitions.delete(backup.patchId);
    runtimeMenus.delete(backup.patchId);
    if (backup.previousRegistry.status === 'active') {
      await invokePatch(backup.previousRegistry, 'activate');
    }
  } else {
    await db.delete('patchRegistry', backup.patchId);
    runtimeDefinitions.delete(backup.patchId);
    runtimeMenus.delete(backup.patchId);
  }
  emitPatchChange();
}

export async function initializeActivePatches(): Promise<void> {
  if (activeInitialization) return activeInitialization;
  activeInitialization = (async () => {
    const db = await getDB();
    const entries = await db.getAll('patchRegistry');
    for (const entry of entries.filter(item => item.status === 'active')) {
      try {
        runtimeMenus.delete(entry.id);
        await invokePatch(entry, 'activate');
      } catch (error) {
        const failed: PatchRegistryEntry = {
          ...entry,
          status: 'error',
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: Date.now(),
        };
        await db.put('patchRegistry', failed);
        await writePatchActivity(failed, 'Aktivasi otomatis', 'Failed', failed.lastError ?? 'Gagal aktivasi.');
      }
    }
    emitPatchChange();
  })().finally(() => {
    activeInitialization = null;
  });
  return activeInitialization;
}

export async function listPatchRegistry(): Promise<PatchRegistryEntry[]> {
  const db = await getDB();
  return (await db.getAll('patchRegistry')).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

export async function listPatchActivityLogs(): Promise<PatchActivityLog[]> {
  const db = await getDB();
  return (await db.getAll('patchActivityLogs')).sort((a, b) => b.timestamp - a.timestamp);
}

export async function installPatch(payload: PatchFilePayload): Promise<PatchActionResult> {
  const normalizedPayload: PatchFilePayload = {
    ...payload,
    checksum: payload.checksum || await checksumFor(payload.code),
  };
  const validation = await validatePatchFile(new File([JSON.stringify({ manifest: normalizedPayload.manifest, code: normalizedPayload.code })], normalizedPayload.fileName, { type: 'application/json' }));
  if (!validation.valid) return { ok: false, message: validation.errors.join(' ') };
  const definition = executePatchCode(normalizedPayload);
  const db = await getDB();
  const existing = validation.existing;
  if (existing) await createRestorePoint(`Sebelum update patch ${payload.manifest.name}`);
  else await createRestorePoint(`Sebelum install patch ${payload.manifest.name}`);
  await snapshotPatchState(existing ?? null, existing ? 'update' : 'install', payload.manifest.id);
  const entry: PatchRegistryEntry = {
    id: normalizedPayload.manifest.id,
    manifest: normalizedPayload.manifest,
    code: normalizedPayload.code,
    checksum: normalizedPayload.checksum,
    status: 'active',
    installedAt: existing?.installedAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  try {
    if (existing?.status === 'active') await invokePatch(existing, 'deactivate');
    runtimeDefinitions.set(entry.id, definition);
    runtimeMenus.delete(entry.id);
    await db.put('patchRegistry', entry);
    await invokePatch(entry, 'install');
    await invokePatch(entry, 'activate');
    await writePatchActivity(entry, existing ? 'Update patch' : 'Install patch', 'Success', 'Patch berhasil diinstall dan diaktifkan.');
    emitPatchChange();
    return { ok: true, message: `Patch ${entry.manifest.name} berhasil diaktifkan.` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    try {
      const backups = await db.getAllFromIndex('patchBackups', 'patchId', entry.id);
      const backup = backups.sort((a, b) => b.createdAt - a.createdAt)[0];
      if (backup) await restorePatchBackup(backup);
    } catch {
      await db.delete('patchRegistry', entry.id);
      await clearPatchData(entry.id);
    }
    await writePatchActivity(entry, existing ? 'Update patch' : 'Install patch', 'Failed', detail);
    return { ok: false, message: `Patch gagal diinstall dan sudah di-rollback: ${detail}` };
  }
}

async function mutatePatch(id: string, action: 'enable' | 'disable'): Promise<PatchActionResult> {
  const db = await getDB();
  const entry = await db.get('patchRegistry', id);
  if (!entry) return { ok: false, message: 'Patch tidak ditemukan.' };
  await createRestorePoint(`Sebelum ${action === 'enable' ? 'enable' : 'disable'} patch ${entry.manifest.name}`);
  const backup = await snapshotPatchState(entry, action);
  try {
    await invokePatch(entry, action === 'enable' ? 'activate' : 'deactivate');
    const next: PatchRegistryEntry = { ...entry, status: action === 'enable' ? 'active' : 'disabled', lastError: undefined, updatedAt: Date.now() };
    await db.put('patchRegistry', next);
    if (action === 'disable') {
      runtimeMenus.delete(id);
      runtimeDefinitions.delete(id);
    }
    await writePatchActivity(next, action === 'enable' ? 'Enable patch' : 'Disable patch', 'Success', 'Status patch berhasil diubah.');
    emitPatchChange();
    return { ok: true, message: `Patch ${entry.manifest.name} berhasil ${action === 'enable' ? 'diaktifkan' : 'dinonaktifkan'}.` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    try {
      await restorePatchBackup(backup);
    } catch {
      // Keep the error status below if the defensive restore itself fails.
    }
    const failed = { ...entry, status: 'error' as PatchStatus, lastError: detail, updatedAt: Date.now() };
    await db.put('patchRegistry', failed);
    await writePatchActivity(failed, action, 'Failed', detail);
    emitPatchChange();
    return { ok: false, message: `Aksi patch gagal: ${detail}` };
  }
}

export const enablePatch = (id: string) => mutatePatch(id, 'enable');
export const disablePatch = (id: string) => mutatePatch(id, 'disable');

export async function rollbackPatch(id: string): Promise<PatchActionResult> {
  const db = await getDB();
  const entry = await db.get('patchRegistry', id);
  if (!entry) return { ok: false, message: 'Patch tidak ditemukan.' };
  const backups = await db.getAllFromIndex('patchBackups', 'patchId', id);
  const backup = backups.sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!backup) return { ok: false, message: 'Belum ada backup patch untuk di-rollback.' };
  await createRestorePoint(`Sebelum rollback patch ${entry.manifest.name}`);
  try {
    if (entry.status === 'active') await invokePatch(entry, 'deactivate');
    await restorePatchBackup(backup);
    await writePatchActivity(backup.previousRegistry ?? entry, 'Rollback patch', 'Success', 'Patch berhasil dikembalikan ke keadaan sebelumnya.');
    emitPatchChange();
    return { ok: true, message: `Patch ${entry.manifest.name} berhasil di-rollback.` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await writePatchActivity(entry, 'Rollback patch', 'Failed', detail);
    return { ok: false, message: `Rollback gagal: ${detail}` };
  }
}

export async function uninstallPatch(id: string): Promise<PatchActionResult> {
  const db = await getDB();
  const entry = await db.get('patchRegistry', id);
  if (!entry) return { ok: false, message: 'Patch tidak ditemukan.' };
  await createRestorePoint(`Sebelum uninstall patch ${entry.manifest.name}`);
  await snapshotPatchState(entry, 'uninstall');
  try {
    if (entry.status === 'active') await invokePatch(entry, 'deactivate');
    await invokePatch(entry, 'uninstall');
    await clearPatchData(id);
    await db.delete('patchRegistry', id);
    runtimeDefinitions.delete(id);
    runtimeMenus.delete(id);
    await writePatchActivity(entry, 'Uninstall patch', 'Success', 'Patch dan data namespace-nya berhasil dihapus.');
    emitPatchChange();
    return { ok: true, message: `Patch ${entry.manifest.name} berhasil di-uninstall.` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await writePatchActivity(entry, 'Uninstall patch', 'Failed', detail);
    return { ok: false, message: `Uninstall gagal: ${detail}` };
  }
}
