/**
 * writeLog — Global Audit Trail logger.
 * All modules must call this function to record user activity.
 */

import { getDB } from './db';
import { enqueueCloudRecordMutation } from './cloudSync';

export type LogStatus = 'Success' | 'Warning' | 'Failed' | 'Info';

export interface WriteLogParams {
  modul: string;
  aktivitas: string;
  detail?: string;
  status?: LogStatus;
  noRM?: string;
  episodeNo?: string;
  namaPasien?: string;
  oldValue?: any;
  newValue?: any;
  keterangan?: string;
  durasi?: number;
  errorCode?: string;
  errorMessage?: string;
  // override user (for login events before session exists)
  overrideUser?: { id: number; username: string; namaUser: string; role: 'superuser' | 'officer' | 'system' };
}

function detectBrowser(ua: string): string {
  if (ua.includes('Edg/')) return 'Microsoft Edge';
  if (ua.includes('OPR/') || ua.includes('Opera/')) return 'Opera';
  if (ua.includes('Chrome/')) return 'Google Chrome';
  if (ua.includes('Firefox/')) return 'Mozilla Firefox';
  if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Apple Safari';
  return 'Unknown Browser';
}

function detectOS(ua: string): string {
  if (ua.includes('Windows NT 10.0')) return 'Windows 10/11';
  if (ua.includes('Windows NT 6.3')) return 'Windows 8.1';
  if (ua.includes('Windows NT 6.1')) return 'Windows 7';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS X')) return 'macOS';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  if (ua.includes('Linux')) return 'Linux';
  return 'Unknown OS';
}

function detectDevice(ua: string): string {
  if (ua.includes('iPhone')) return 'iPhone';
  if (ua.includes('iPad')) return 'iPad';
  if (ua.includes('Android') && ua.includes('Mobile')) return 'Android Phone';
  if (ua.includes('Android')) return 'Android Tablet';
  return 'Desktop';
}

export async function writeLog(params: WriteLogParams): Promise<void> {
  try {
    const now = new Date();
    const tanggal = now.toISOString().split('T')[0];
    const jam = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const timestamp = now.getTime();

    // Get current user from session or override
    let userId = 0;
    let username = 'system';
    let namaUser = 'System';
    let role: 'superuser' | 'officer' | 'system' = 'system';

    if (params.overrideUser) {
      userId = params.overrideUser.id;
      username = params.overrideUser.username;
      namaUser = params.overrideUser.namaUser;
      role = params.overrideUser.role;
    } else {
      const storedSession = localStorage.getItem('emc_session');
      if (storedSession) {
        try {
          const session = JSON.parse(storedSession);
          const u = session.user;
          if (u) {
            userId = u.id ?? 0;
            username = u.username ?? 'unknown';
            namaUser = u.namaLengkap ?? u.username ?? 'Unknown';
            role = u.role ?? 'officer';
          }
        } catch { /* ignore */ }
      }
    }

    const ua = navigator.userAgent;

    const db = await getDB();
    const logRecord = {
      timestamp,
      tanggal,
      jam,
      userId,
      username,
      namaUser,
      role,
      modul: params.modul,
      aktivitas: params.aktivitas,
      noRM: params.noRM ?? '',
      episodeNo: params.episodeNo ?? '',
      namaPasien: params.namaPasien ?? '',
      detail: params.detail ?? '',
      oldValue: params.oldValue != null ? JSON.stringify(params.oldValue) : '',
      newValue: params.newValue != null ? JSON.stringify(params.newValue) : '',
      browser: detectBrowser(ua),
      device: detectDevice(ua),
      os: detectOS(ua),
      status: params.status ?? 'Info',
      keterangan: params.keterangan ?? '',
      durasi: params.durasi ?? 0,
      errorCode: params.errorCode ?? '',
      errorMessage: params.errorMessage ?? '',
    };
    const id = await db.add('activityLogs', logRecord);
    // Keep the local replica immediately usable, but also persist this
    // row-level change in the offline outbox. GAS acknowledges it when a
    // connection is available; otherwise it survives closing ipaw.html.
    await enqueueCloudRecordMutation('upsertRecord', 'activityLogs', 'id', {
      record: { ...logRecord, id },
    });
  } catch (err) {
    // Never throw — logging must not break the app
    console.warn('[writeLog] Failed to write log:', err);
  }
}
