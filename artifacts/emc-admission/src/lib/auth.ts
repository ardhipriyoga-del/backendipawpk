import CryptoJS from 'crypto-js';
import { getDB } from './db';

export const hashPassword = (password: string) => {
  return CryptoJS.SHA256(password).toString();
};

// Seeder akun awal untuk instalasi browser baru. Password tidak pernah
// disimpan mentah di IndexedDB; hanya hash SHA-256 yang disimpan.
export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD_HASH =
  'ddfa08f04ffbedd937ce079026ead9826c0f4572feee5e45ff2a66d058c0c9d5';

export const ensureDefaultAdmin = async () => {
  const db = await getDB();
  const users = await db.getAll('users');
  const existingAdmin = users.find(user =>
    user.username.trim().toLowerCase() === DEFAULT_ADMIN_USERNAME,
  );
  if (existingAdmin) return existingAdmin;

  const now = Date.now();
  const admin = {
    username: DEFAULT_ADMIN_USERNAME,
    namaLengkap: 'Administrator',
    role: 'superuser' as const,
    passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
    aktif: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.put('users', admin);
  const admins = await db.getAll('users');
  return admins.find(user => user.username === DEFAULT_ADMIN_USERNAME) ?? admin;
};

export const repairDefaultAdminCredential = async () => {
  const db = await getDB();
  const users = await db.getAll('users');
  const existingAdmin = users.find(user =>
    user.username.trim().toLowerCase() === DEFAULT_ADMIN_USERNAME,
  );

  if (!existingAdmin) return ensureDefaultAdmin();
  if (
    existingAdmin.passwordHash === DEFAULT_ADMIN_PASSWORD_HASH &&
    existingAdmin.aktif &&
    existingAdmin.role === 'superuser'
  ) {
    return existingAdmin;
  }

  // This path runs only after the user has supplied the hardcoded seed
  // credential on the login form. It repairs stale browser data left by an
  // older standalone build; it never exposes or stores the plaintext password.
  const repairedAdmin = {
    ...existingAdmin,
    username: DEFAULT_ADMIN_USERNAME,
    namaLengkap: existingAdmin.namaLengkap || 'Administrator',
    role: 'superuser' as const,
    aktif: true,
    passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
    updatedAt: Date.now(),
  };
  await db.put('users', repairedAdmin);
  return repairedAdmin;
};

export const initDefaultSettingsAndAdmin = async () => {
  const db = await getDB();
  
  // Settings
  const rsName = await db.get('settings', 'rsName');
  if (!rsName) {
    await db.put('settings', { key: 'rsName', value: 'RS EMC Pekayon' });
    await db.put('settings', { key: 'timeoutMins', value: 30 });
  }
};

export const logActivity = async (
  userId: number,
  userName: string,
  action: string,
  entityType: string,
  entityId: string | number,
  detail: string
) => {
  const db = await getDB();
  const now = Date.now();
  const d = new Date(now);
  await db.put('activityLogs', {
    userId,
    username: userName,
    namaUser: userName,
    aktivitas: action,
    modul: entityType,
    detail: entityId ? `[${entityType}:${entityId}] ${detail}` : detail,
    timestamp: now,
    // Keep the machine-readable date key stable; formatDate is applied only
    // when the value is rendered.
    tanggal: d.toISOString().split('T')[0],
    jam: d.toLocaleTimeString('id-ID'),
    role: 'officer' as const,
    noRM: '', episodeNo: '', namaPasien: '',
    oldValue: '', newValue: '',
    browser: '', device: '', os: '',
    status: 'Success' as const,
    keterangan: '', durasi: 0, errorCode: '', errorMessage: '',
  });
};

export const getCurrentShift = (): 'pagi' | 'sore' | 'malam' => {
  const hour = new Date().getHours();
  if (hour >= 7 && hour < 14) return 'pagi';
  if (hour >= 14 && hour < 21) return 'sore';
  return 'malam';
};

export const generateUUID = () => {
  return crypto.randomUUID();
};
