import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAppContext } from '../context/AppContext';
import { getDB } from '../lib/db';
import {
  hashPassword,
} from '../lib/auth';
import { writeLog } from '../lib/writeLog';
import { readCloudStore } from '../lib/cloudDatabase';
import { isOfflineMode } from '../lib/cloudSync';
import { isLocalFirstMode } from '../lib/storageMode';
import { hasApiProxy } from '../lib/apiConfig';
import { loginWithBackend } from '../lib/authApi';
import { useLocation } from 'wouter';
import { Eye, EyeOff, ShieldAlert, CloudDownload, Info } from 'lucide-react';
import { toast } from 'sonner';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login, user, isInitialized, cloudRestoreState } = useAuth();
  const { rsLogo, rsName } = useAppContext();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user) setLocation('/');
  }, [user, setLocation]);

  // Local initialization controls only whether the form can render. Cloud
  // restore is deliberately independent, so a slow Cloud snapshot never
  // blocks the user from seeing or using the login form.
  const restoring = !isInitialized;
  const restoreFailed = cloudRestoreState === 'failed';
  const cloudIsEmpty = cloudRestoreState === 'empty';
  const cloudRestoring = isInitialized && cloudRestoreState === 'pending';
  const standaloneOffline = isOfflineMode();
  const localFirst = isLocalFirstMode();
  const loginBlockedByCloud = false;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginBlockedByCloud) return;
    setLoading(true);
    try {
      if (!localFirst && hasApiProxy()) {
        try {
          const result = await loginWithBackend(username, password);
          if (result.response.ok && result.body.user) {
            const backendUser = result.body.user;
            login(backendUser);
            await writeLog({
              modul: 'Login', aktivitas: 'Login Berhasil',
              detail: `Login berhasil sebagai ${backendUser.role}`, status: 'Success',
              overrideUser: {
                id: backendUser.id,
                username: backendUser.username,
                namaUser: backendUser.namaLengkap,
                role: backendUser.role,
              },
            });
            toast.success(`Selamat datang, ${backendUser.namaLengkap}`);
            setLocation('/');
            return;
          }
          if (result.response.status === 401 || result.response.status === 429) {
            toast.error(result.body.message || 'Username atau password salah.');
            await writeLog({
              modul: 'Login', aktivitas: 'Login Gagal',
              detail: 'Login ditolak oleh server authentication',
              status: 'Failed',
            });
            return;
          }
          throw new Error(result.body.message || `Backend login HTTP ${result.response.status}`);
        } catch (backendError) {
          // The existing local/cloud fallback remains available when the
          // Replit API or GAS is temporarily unreachable.
          console.warn('[Login] Backend authentication unavailable; using existing fallback:', backendError);
        }
      }

      const db = await getDB();
      const localUsers = await db.getAll('users');
      let users: typeof localUsers;
      let cloudLookupError: unknown = null;

      if (localFirst) {
        users = localUsers;
      } else {
        // Legacy ipaw.html remains Cloud-first for authentication, with local
        // fallback only when the Cloud lookup cannot be reached.
        try {
          const cloudUsers = await readCloudStore<typeof localUsers[number]>('users');
          users = Array.isArray(cloudUsers.records) ? cloudUsers.records : [];
          const tx = db.transaction('users', 'readwrite');
          await tx.objectStore('users').clear();
          for (const cloudUser of users) {
            await tx.objectStore('users').put(cloudUser);
          }
          await tx.done;
        } catch (cloudError) {
          cloudLookupError = cloudError;
          if (standaloneOffline) {
            throw new Error(
              'Database Cloud tidak dapat diakses. Login ipaw.html harus terhubung ke Spreadsheet.',
            );
          }
          console.warn('[Login] Cloud users unavailable; using IndexedDB fallback:', cloudError);
          users = localUsers;
        }
      }

      if (cloudLookupError && users.length === 0) {
        throw new Error(
          'Database Cloud tidak dapat diakses dan database lokal belum memiliki akun.',
        );
      }
      const hashed = hashPassword(password);
      const normalizedUsername = username.trim().toLowerCase();
      const found = users.find(u =>
        u.username.trim().toLowerCase() === normalizedUsername &&
        u.passwordHash === hashed,
      );
      if (found) {
        if (!found.aktif) {
          toast.error('Akun anda nonaktif. Hubungi Administrator.');
          await writeLog({
            modul: 'Login', aktivitas: 'Login Gagal',
            detail: `Akun nonaktif: ${username}`, status: 'Warning',
            overrideUser: { id: found.id!, username: found.username, namaUser: found.namaLengkap, role: found.role },
          });
          setLoading(false);
          return;
        }
        const userData = { id: found.id!, username: found.username, namaLengkap: found.namaLengkap, role: found.role };
        login(userData);
        await writeLog({
          modul: 'Login', aktivitas: 'Login Berhasil',
          detail: `Login berhasil sebagai ${found.role}`, status: 'Success',
          overrideUser: { id: found.id!, username: found.username, namaUser: found.namaLengkap, role: found.role },
        });
        toast.success(`Selamat datang, ${found.namaLengkap}`);
        setLocation('/');
      } else {
        toast.error('Username atau password salah.');
        await writeLog({
          modul: 'Login', aktivitas: 'Login Gagal',
          detail: `Username tidak ditemukan atau password salah: ${username}`, status: 'Failed',
        });
      }
    } catch (e: any) {
      toast.error('Terjadi kesalahan saat login.');
      await writeLog({
        modul: 'Login', aktivitas: 'Login Gagal',
        detail: `Error saat login: ${username}`, status: 'Failed',
        errorMessage: e?.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #26c6da 0%, #00acc1 50%, #0097a7 100%)' }}
    >
      {/* ── Card ── */}
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl flex" style={{ minHeight: '400px' }}>

        {/* ── Left panel — teal branding ── */}
        <div
          className="w-5/12 flex flex-col items-center justify-center p-10 gap-5 text-center"
          style={{ background: 'linear-gradient(160deg, #4dd8e6 0%, #26c6da 40%, #00acc1 100%)' }}
        >
          {/* Cross circle */}
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.25)' }}
          >
            {rsLogo ? (
              <img src={rsLogo} alt="Logo" className="w-14 h-14 object-contain" />
            ) : (
              <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-12 h-12">
                <rect x="4" y="18" width="40" height="12" rx="3" fill="white" />
                <rect x="18" y="4" width="12" height="40" rx="3" fill="white" />
              </svg>
            )}
          </div>

          {/* Title — satu baris, rata tengah */}
          <div className="space-y-1.5">
            <p className="text-xl font-bold text-white leading-snug">
              IP Admission Workspace
            </p>
            <p className="text-sm italic font-light text-white/85">
              We Care with Passion
            </p>
            {rsName && (
              <p className="text-white/70 text-sm font-medium mt-1">
                {rsName}
              </p>
            )}
          </div>
        </div>

        {/* ── Right panel — white form ── */}
        <div className="flex-1 bg-white flex flex-col justify-center px-10 py-10 gap-6">
          {/* Heading */}
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Log In</h1>
            <p className="text-sm text-gray-500 mt-1">
              Masukkan kredensial Anda untuk melanjutkan
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-6">
            {/* Username */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">Username</label>
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                autoFocus
                className="w-full border-0 border-b-2 border-gray-200 focus:border-[#00acc1] outline-none bg-transparent py-2 text-sm text-gray-800 placeholder-gray-400 transition-colors"
              />
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full border-0 border-b-2 border-gray-200 focus:border-[#00acc1] outline-none bg-transparent py-2 text-sm text-gray-800 placeholder-gray-400 transition-colors pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-0 top-2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || loginBlockedByCloud}
              className="w-full py-3 rounded-full text-sm font-bold text-white transition-all disabled:opacity-60"
              style={{ background: 'linear-gradient(90deg, #26c6da, #00acc1)' }}
            >
              {restoring
                ? 'Menyiapkan aplikasi...'
                : localFirst
                ? (loading ? 'Memverifikasi di LocalDB...' : 'Masuk dengan LocalDB')
                : cloudRestoring
                ? 'Memverifikasi ke Cloud...'
                : loading
                ? 'Memverifikasi...'
                : 'Submit'}
            </button>
          </form>

          {/* Status bawah */}
          <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400">
            {restoring ? (
              <><CloudDownload className="w-3.5 h-3.5 animate-pulse text-[#00acc1]" /><span>Menyiapkan login lokal...</span></>
            ) : cloudRestoring ? (
              <><CloudDownload className="w-3.5 h-3.5 animate-pulse text-[#00acc1]" /><span>Sinkronisasi data Cloud berjalan di latar belakang...</span></>
            ) : localFirst ? (
              <><Info className="w-3.5 h-3.5 text-[#00acc1]" /><span>LocalDB aktif — Cloud hanya untuk backup</span></>
            ) : standaloneOffline ? (
                <><CloudDownload className="w-3.5 h-3.5 text-[#00acc1]" /><span>Login diverifikasi ke Cloud Spreadsheet</span></>
              ) : restoreFailed ? (
              <><ShieldAlert className="w-3.5 h-3.5 text-amber-400" /><span>Cloud tidak tersedia — data lokal digunakan</span></>
            ) : cloudIsEmpty ? (
              <><Info className="w-3.5 h-3.5 text-[#00acc1]" /><span>Cloud terhubung — belum ada backup, data lokal digunakan</span></>
            ) : (
              <><Info className="w-3.5 h-3.5 text-[#00acc1]" /><span>Empowering Admission Teams</span></>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 text-center">
        <a
          href="https://wa.me/6281902616888"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/60 hover:text-white/90 text-xs transition-colors"
        >
          Developed by Dedi Supriadi
        </a>
      </div>
    </div>
  );
}
