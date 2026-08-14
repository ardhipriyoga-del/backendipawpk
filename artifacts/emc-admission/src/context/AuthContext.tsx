import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { getDB } from '../lib/db';
import { ensureDefaultAdmin, initDefaultSettingsAndAdmin } from '../lib/auth';
import { writeLog } from '../lib/writeLog';
import {
  backupCloud,
  isOfflineMode,
  restoreCloud,
  startBackgroundBackupSync,
  syncPendingsFromCloud,
} from '../lib/cloudSync';
import { isLocalFirstMode } from '../lib/storageMode';
import { hasApiProxy } from '../lib/apiConfig';
import { getBackendSession, logoutFromBackend } from '../lib/authApi';

interface AuthUser {
  id: number;
  username: string;
  namaLengkap: string;
  role: 'superuser' | 'officer';
}

interface AuthContextType {
  user: AuthUser | null;
  isInitialized: boolean;
  login: (user: AuthUser) => void;
  logout: () => Promise<void>;
  isLoggingOut: boolean;
  cloudRestoreState: 'pending' | 'success' | 'empty' | 'failed' | 'local';
  updateSession: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [cloudRestoreState, setCloudRestoreState] = useState<'pending' | 'success' | 'empty' | 'failed' | 'local'>('pending');
  const logoutInProgress = useRef(false);
  const startupRestoreReady = useRef<Promise<void>>(Promise.resolve());
  const [, setLocation] = useLocation();

  useEffect(() => {
    const init = async () => {
      await initDefaultSettingsAndAdmin();
      const standaloneOffline = isOfflineMode();
      const localFirst = isLocalFirstMode();
      if (localFirst) {
        // V2 must be useful on a new workstation before any Cloud request.
        // Seed only the browser-local account if this database has no users.
        await ensureDefaultAdmin();
      }

      // Local IndexedDB becomes available immediately. Login itself verifies
      // credentials against the Cloud users store, so a new standalone file
      // does not need a pre-populated local database.
      const restoreOnStartup = async () => {
        if (standaloneOffline || localFirst) {
          // A downloaded ipaw.html shows immediately, but login itself still
          // uses the local replica in local-first mode. Cloud restore is an
          // optional manual recovery action and must not replace local work.
          // Refresh only the shared Pending store with newer Cloud records so
          // another workstation can see completed handovers without a full
          // destructive restore.
          setCloudRestoreState('local');
          if (localFirst) {
            void syncPendingsFromCloud().catch(error => {
              console.warn('[Auth] Pending Cloud refresh failed:', error);
            });
          }
          return;
        }
        try {
          // The timeout belongs to the fetch itself, so a late response cannot
          // continue into importAllStores after the local app is usable.
          // Large master-tariff snapshots can be tens of megabytes. Restore
          // stays in the background, so a longer network timeout does not
          // block local IndexedDB login.
           await restoreCloud({ timeoutMs: 60000 });
          setCloudRestoreState('success');
        } catch (error) {
          console.warn('[Auth] Startup cloud restore failed; local data retained:', error);
          const message = error instanceof Error ? error.message : String(error);
          setCloudRestoreState(
            message.toLowerCase().includes('belum ada backup yang tersimpan')
              ? 'empty'
              : 'failed',
          );
        }
      };

      const storedSession = localStorage.getItem('emc_session');
      setIsInitialized(true);

      // Restore is a background hydration step. It must not block the login
      // form or stored-session resumption because authentication performs its
      // own Cloud users lookup when the user submits the form.
      const restorePromise = restoreOnStartup();
      startupRestoreReady.current = restorePromise;
      const resumeStoredSession = async () => {
        if (!storedSession) return;
        try {
          if (!localFirst && !standaloneOffline && hasApiProxy()) {
            const backendUser = await getBackendSession();
            if (!backendUser) {
              localStorage.removeItem('emc_session');
              return;
            }
          }
          const session = JSON.parse(storedSession);
          const now = Date.now();
          // Re-read settings and users after restore so the session is checked
          // against the restored database, not the pre-restore local snapshot.
          const db = await getDB();
          const timeoutSetting = await db.get('settings', 'timeoutMins');
          const timeoutMins: number = timeoutSetting?.value ?? 30;
          const expired = timeoutMins > 0
            ? now - session.lastActivity > timeoutMins * 60 * 1000
            : false;
          const users = await db.getAll('users');
          const restoredUser = users.find(item =>
            item.id === session.user?.id ||
            item.username.trim().toLowerCase() === String(session.user?.username ?? '').trim().toLowerCase(),
          );
          if (expired || !restoredUser || !restoredUser.aktif) {
            localStorage.removeItem('emc_session');
            return;
          }
          const userData = {
            id: restoredUser.id!,
            username: restoredUser.username,
            namaLengkap: restoredUser.namaLengkap,
            role: restoredUser.role,
          };
          setUser(userData);
          localStorage.setItem('emc_session', JSON.stringify({
            ...session,
            user: userData,
            lastActivity: now,
          }));
        } catch {
          localStorage.removeItem('emc_session');
        }
      };
      // Resume an existing local session immediately. After the Cloud restore
      // finishes, re-check it against the refreshed local users store so a
      // removed or deactivated account is not kept active indefinitely.
      void resumeStoredSession();
      void restorePromise.then(
        () => resumeStoredSession(),
        () => resumeStoredSession(),
      ).finally(() => {
        // The standalone build also needs the connection-restored listener so
        // its durable outbox can retry. The worker skips a stale startup
        // snapshot in file:// mode and only syncs explicitly pending changes.
        startBackgroundBackupSync();
      });
    };
    init();
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      const session = localStorage.getItem('emc_session');
      if (session) {
        const db = await getDB();
        const timeoutSetting = await db.get('settings', 'timeoutMins');
        const timeoutMins: number = timeoutSetting?.value ?? 30;
        // timeoutMins = 0 means disabled — skip check
        if (timeoutMins === 0) return;
        const parsed = JSON.parse(session);
        if (Date.now() - parsed.lastActivity > timeoutMins * 60 * 1000) {
          logout();
          window.alert("Sesi telah berakhir karena tidak ada aktivitas.");
        }
      }
    }, 60000); // check every minute
    return () => clearInterval(interval);
  }, []);

  const login = (userData: AuthUser) => {
    setUser(userData);
    localStorage.setItem('emc_session', JSON.stringify({
      user: userData,
      loginAt: Date.now(),
      lastActivity: Date.now()
    }));
    if (isLocalFirstMode()) {
      void syncPendingsFromCloud().catch(error => {
        console.warn('[Auth] Pending Cloud refresh after login failed:', error);
      });
    }
  };

  const logout = async () => {
    if (logoutInProgress.current) return;

    logoutInProgress.current = true;
    setIsLoggingOut(true);

    try {
      try {
        await logoutFromBackend();
      } catch (error) {
        console.warn('[Auth] Backend logout failed:', error);
      }

      // Log before clearing session so the logout event is included in the backup.
      try {
        await writeLog({
          modul: 'Login',
          aktivitas: 'Logout',
          detail: 'User logout dari sistem',
          status: 'Info',
        });
      } catch (error) {
        // The cloud snapshot is more important than a local audit-log failure.
        console.warn('[Auth] Logout activity log failed:', error);
      }

      // Wait for the logout backup before changing route. Local-first mode uses
      // separate IndexedDB databases per workstation, so this is the last
      // reliable opportunity to send a completed pending record to Cloud
      // before the user opens the app on another computer.
      try {
        await startupRestoreReady.current.catch(() => undefined);
        await backupCloud();
      } catch (error) {
        // Keep the local logout usable even when Cloud is unreachable. The
        // durable pending marker/outbox will retry while the app remains open.
        console.warn('[Auth] Logout cloud backup failed:', error);
      }
    } finally {
      setUser(null);
      localStorage.removeItem('emc_session');
      logoutInProgress.current = false;
      setIsLoggingOut(false);
      setLocation('/login');
    }
  };

  const updateSession = () => {
    const session = localStorage.getItem('emc_session');
    if (session) {
      const parsed = JSON.parse(session);
      parsed.lastActivity = Date.now();
      localStorage.setItem('emc_session', JSON.stringify(parsed));
    }
  };

  return (
      <AuthContext.Provider value={{ user, isInitialized, login, logout, isLoggingOut, cloudRestoreState, updateSession }}>
      <div onClick={updateSession} onKeyDown={updateSession}>
        {children}
      </div>
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
