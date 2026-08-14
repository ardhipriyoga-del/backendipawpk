import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAppContext } from '../context/AppContext';
import { getDB } from '../lib/db';
import {
  analyzeRestoreFile,
  applySmartRestore,
  backupData,
  restoreData,
  backupDataJSON,
  restoreDataJSON,
  type SmartRestorePlan,
  type SmartRestoreResult,
} from '../lib/backup';
import {
  backupCloud,
  triggerAutoBackup,
  restoreCloud,
  restoreLatestRestorePoint,
  syncStatus as getCloudSyncStatus,
  DEFAULT_CLOUD_API,
  getCloudApiUrl,
} from '../lib/cloudSync';

// Backup snapshot lengkap di background. Jika offline, triggerAutoBackup
// menyimpan penanda pending agar perubahan user dikirim saat koneksi kembali.
const autoBackupUsers = () => triggerAutoBackup();
import { hashPassword } from '../lib/auth';
import { importExcel } from '../lib/importExcel';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Save, Download, Upload, Shield, Users, Building, Database, KeyRound, Eye, EyeOff, FileSpreadsheet, RefreshCw, Cloud, CloudOff, HardDrive, Terminal, Info, CheckCircle2, AlertCircle, Loader2, ShieldAlert, FileCode2, AlertTriangle, Timer, ShieldCheck, PackageOpen, WifiOff, MessageSquare, SlidersHorizontal, Volume2, Trash2, Mail } from 'lucide-react';
import MasterTarifContent from './masterTarif';
import BillingRuleSettings from './billingRuleSettings';
import TemplatePesanKasirContent from './templatePesanKasir';
import MasterChecklistPasien from '../components/MasterChecklistPasien';
import WhatsAppSettingsPanel from '../components/WhatsAppSettingsPanel';
import OutlookSettingsPanel from '../components/OutlookSettingsPanel';
import PatchManagerPanel from '../components/PatchManagerPanel';
import {
  DEFAULT_OPERATING_THEATRE_CONFIG,
  fetchOperatingTheatre,
  getOperatingTheatreConfig,
  saveOperatingTheatreConfig,
  type OperatingTheatreConfig,
  type OperatingTheatreRefreshInterval,
} from '../lib/operatingTheatre';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_KIND_LABELS,
  NOTIFICATION_SOUND_LABELS,
  getNotificationSettings,
  playNotificationPreview,
  saveNotificationSettings,
  stopNotificationSound,
  type NotificationKind,
  type NotificationSettings,
  type NotificationSound,
} from '../lib/notificationSettings';
import { formatDateTime } from '../lib/utils';
import { ACCESS_POLICY, canAccessSettingsTab, type SettingsTab } from '../lib/accessControl';
import { writeLog } from '../lib/writeLog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function SettingsPage() {
  const { user } = useAuth();
  const { rsName, refreshSettings } = useAppContext();
  const isSuperuser = user?.role === 'superuser';
  
  const [activeTab, setActiveTab] = useState<SettingsTab>('profil');

  // Import Data state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<any>(null);
  
  // Auto Logout setting
  const [autoLogoutEnabled, setAutoLogoutEnabled] = useState(true);
  const [autoLogoutMins, setAutoLogoutMins] = useState(30);
  const [savingSession, setSavingSession] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const [savingNotifications, setSavingNotifications] = useState(false);

  // Auto Sync setting
  const [autoSyncInterval, setAutoSyncInterval] = useState<string>('manual');
  const [savingSync, setSavingSync] = useState(false);
  const [operatingTheatreConfig, setOperatingTheatreConfig] = useState<OperatingTheatreConfig>(DEFAULT_OPERATING_THEATRE_CONFIG);
  const [savingOperatingTheatre, setSavingOperatingTheatre] = useState(false);
  const [testingOperatingTheatre, setTestingOperatingTheatre] = useState(false);

  // Endpoint URL settings (superuser only)
  const DEFAULT_EP = {
    inpatient: 'https://apps.emc.id/trakcare/dashboard/dailyinpatient/trakcareANLT/hospital/4',
    igd: 'https://apps.emc.id/trakcare/dashboard/dailyemergencywaitingtime/trakcareANLT/hospital/4',
    medicalDischarge: 'https://apps.emc.id/trakcare/dashboard/dailyinpatient/trakcareANLT/hospital/4?medical=Y',
    nurseDischarge: 'https://apps.emc.id/trakcare/dashboard/dailyinpatient/trakcareANLT/hospital/4?nurse=Y',
    pharmacyDischarge: 'https://apps.emc.id/trakcare/dashboard/dailyinpatient/trakcareANLT/hospital/4?pharmacy=Y',
  };
  const [epInpatient, setEpInpatient] = useState(DEFAULT_EP.inpatient);
  const [epIGD, setEpIGD] = useState(DEFAULT_EP.igd);
  const [epMedical, setEpMedical] = useState(DEFAULT_EP.medicalDischarge);
  const [epNurse, setEpNurse] = useState(DEFAULT_EP.nurseDischarge);
  const [epPharmacy, setEpPharmacy] = useState(DEFAULT_EP.pharmacyDischarge);
  const [savingEndpoints, setSavingEndpoints] = useState(false);
  
  // App Config
  const [appNameInput, setAppNameInput] = useState(rsName);
  
  // Users
  const [usersList, setUsersList] = useState<any[]>([]);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', namaLengkap: '', password: '', confirmPassword: '', role: 'officer' });
  const [deleteUserTarget, setDeleteUserTarget] = useState<any>(null);
  const [deleteUserPassword, setDeleteUserPassword] = useState('');
  const [deletingUser, setDeletingUser] = useState(false);

  // Edit Nama
  const [isEditNameOpen, setIsEditNameOpen] = useState(false);
  const [editNameTarget, setEditNameTarget] = useState<any>(null);
  const [editNameValue, setEditNameValue] = useState('');

  // Change Password
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwLoading, setPwLoading] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Backup lokal (Excel legacy)
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Post-restore dialog
  const [postRestoreOpen, setPostRestoreOpen] = useState(false);
  const [postRestoreMissingTarif, setPostRestoreMissingTarif] = useState(false);
  const [postRestoreMissingItem, setPostRestoreMissingItem] = useState(false);

  // Cloud sync state
  const [cloudStatus, setCloudStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [lastCloudBackup, setLastCloudBackup] = useState<number | null>(null);
  const [cloudBackingUp, setCloudBackingUp] = useState(false);
  const [cloudRestoring, setCloudRestoring] = useState(false);
  // Backup/Restore JSON lokal
  const [restoreJsonFile, setRestoreJsonFile] = useState<File | null>(null);
  const [restoringJson, setRestoringJson] = useState(false);
  const [smartRestorePlan, setSmartRestorePlan] = useState<SmartRestorePlan | null>(null);
  const [smartRestoreApplying, setSmartRestoreApplying] = useState(false);
  const [smartRestoreResult, setSmartRestoreResult] = useState<SmartRestoreResult | null>(null);
  const [smartRestoreResultOpen, setSmartRestoreResultOpen] = useState(false);

  // Cloud API URL (configurable)
  const [cloudApiUrl, setCloudApiUrl] = useState('');
  const [savingCloudUrl, setSavingCloudUrl] = useState(false);

  useEffect(() => {
    if (user && !canAccessSettingsTab(user.role, activeTab)) {
      setActiveTab('profil');
      return;
    }
    if (user?.role === 'superuser' && activeTab === 'users') {
      loadUsers();
    }
    if (activeTab === 'sinkronisasi') {
      loadSyncSettings();
    }
    if (activeTab === 'session') {
      loadSessionSettings();
    }
    if (activeTab === 'notifikasi') {
      loadNotificationSettings();
    }
    if (activeTab === 'backup') {
      loadCloudStatus();
    }
    if (activeTab === 'integrasiTrakCare' && isSuperuser) {
      void loadOperatingTheatreConfig();
    } else if (activeTab === 'integrasiTrakCare' && !isSuperuser) {
      // Defensively close the tab if a non-superuser reaches it through
      // restored state or a programmatic navigation.
      setActiveTab('profil');
    }
  }, [activeTab, user, isSuperuser]);

  const loadOperatingTheatreConfig = async () => {
    if (!isSuperuser) return;
    setOperatingTheatreConfig(await getOperatingTheatreConfig());
  };

  const updateOperatingTheatreConfig = <K extends keyof OperatingTheatreConfig>(
    key: K,
    value: OperatingTheatreConfig[K],
  ) => setOperatingTheatreConfig(previous => ({ ...previous, [key]: value }));

  const handleSaveOperatingTheatreConfig = async () => {
    if (!isSuperuser) {
      toast.error('Hanya superuser yang dapat mengubah Integrasi TrakCare.');
      return;
    }
    setSavingOperatingTheatre(true);
    try {
      await saveOperatingTheatreConfig(operatingTheatreConfig);
      toast.success('Konfigurasi Integrasi TrakCare berhasil disimpan.');
    } catch (error: any) {
      toast.error(`Gagal menyimpan konfigurasi: ${error?.message ?? 'Unknown error'}`);
    } finally {
      setSavingOperatingTheatre(false);
    }
  };

  const handleTestOperatingTheatreConnection = async () => {
    if (!isSuperuser) {
      toast.error('Hanya superuser yang dapat menguji koneksi TrakCare.');
      return;
    }
    if (!operatingTheatreConfig.endpoint.trim() || !operatingTheatreConfig.username.trim() || !operatingTheatreConfig.password) {
      toast.error('Endpoint, username, dan password wajib diisi untuk test connection.');
      return;
    }
    setTestingOperatingTheatre(true);
    try {
      const patients = await fetchOperatingTheatre(operatingTheatreConfig, true);
      toast.success(`Koneksi TrakCare berhasil. ${patients.length} pasien rencana tindakan terbaca.`);
    } catch (error: any) {
      toast.error(error?.message || 'Login ke TrakCare gagal.');
    } finally {
      setTestingOperatingTheatre(false);
    }
  };

  // Load on mount too (for the sync indicator in header)
  useEffect(() => {
    loadSyncSettings();
    loadSessionSettings();
    // Cek apakah ada redirect post-restore ke tab tertentu
    const postRestoreTab = sessionStorage.getItem('ipaw_post_restore_tab');
    if (postRestoreTab) {
      sessionStorage.removeItem('ipaw_post_restore_tab');
      setActiveTab(postRestoreTab as any);
    }
  }, []);

  const loadSessionSettings = async () => {
    const db = await getDB();
    const s = await db.get('settings', 'timeoutMins');
    // s?.value === 0 means disabled; undefined/null falls back to 30
    if (s === undefined || s === null) {
      setAutoLogoutEnabled(true);
      setAutoLogoutMins(30);
    } else {
      const val: number = s.value ?? 30;
      setAutoLogoutEnabled(val !== 0);
      setAutoLogoutMins(val === 0 ? 30 : val);
    }
  };

  const loadNotificationSettings = async () => {
    setNotificationSettings(await getNotificationSettings());
  };

  const handleSaveNotificationSettings = async () => {
    setSavingNotifications(true);
    try {
      await saveNotificationSettings(notificationSettings);
      if (!notificationSettings.soundEnabled) {
        stopNotificationSound();
      }
      toast.success('Pengaturan notifikasi berhasil disimpan.');
    } catch (err: any) {
      toast.error('Gagal menyimpan pengaturan notifikasi: ' + err.message);
    } finally {
      setSavingNotifications(false);
    }
  };

  const updateNotification = <K extends keyof NotificationSettings>(
    key: K,
    value: NotificationSettings[K],
  ) => setNotificationSettings(prev => ({ ...prev, [key]: value }));

  const updateNotificationSound = (kind: NotificationKind, sound: NotificationSound) => {
    setNotificationSettings(prev => ({ ...prev, sounds: { ...prev.sounds, [kind]: sound } }));
  };

  const handleSaveSessionSettings = async () => {
    setSavingSession(true);
    try {
      const db = await getDB();
      const valueToStore = autoLogoutEnabled ? autoLogoutMins : 0;
      await db.put('settings', { key: 'timeoutMins', value: valueToStore });
      toast.success(
        autoLogoutEnabled
          ? `Auto logout diaktifkan — sesi akan berakhir setelah ${autoLogoutMins} menit tidak aktif.`
          : 'Auto logout dinonaktifkan — sesi tidak akan berakhir otomatis.'
      );
    } catch (err: any) {
      toast.error('Gagal menyimpan: ' + err.message);
    } finally {
      setSavingSession(false);
    }
  };

  const loadSyncSettings = async () => {
    const db = await getDB();
    const s = await db.get('settings', 'autoSyncInterval');
    setAutoSyncInterval(s?.value || 'manual');
    // Load endpoint URLs
    const ep = async (key: string, def: string) => (await db.get('settings', key))?.value || def;
    setEpInpatient(await ep('endpointInpatient', DEFAULT_EP.inpatient));
    setEpIGD(await ep('endpointIGD', DEFAULT_EP.igd));
    setEpMedical(await ep('endpointMedicalDischarge', DEFAULT_EP.medicalDischarge));
    setEpNurse(await ep('endpointNurseDischarge', DEFAULT_EP.nurseDischarge));
    setEpPharmacy(await ep('endpointPharmacyDischarge', DEFAULT_EP.pharmacyDischarge));
  };

  const handleSaveEndpoints = async () => {
    setSavingEndpoints(true);
    try {
      const db = await getDB();
      await db.put('settings', { key: 'endpointInpatient',        value: epInpatient });
      await db.put('settings', { key: 'endpointIGD',              value: epIGD });
      await db.put('settings', { key: 'endpointMedicalDischarge',  value: epMedical });
      await db.put('settings', { key: 'endpointNurseDischarge',    value: epNurse });
      await db.put('settings', { key: 'endpointPharmacyDischarge', value: epPharmacy });
      toast.success('URL endpoint berhasil disimpan.');
    } catch (err: any) {
      toast.error('Gagal menyimpan: ' + err.message);
    } finally {
      setSavingEndpoints(false);
    }
  };

  const handleSaveSyncSettings = async () => {
    setSavingSync(true);
    try {
      const db = await getDB();
      await db.put('settings', { key: 'autoSyncInterval', value: autoSyncInterval });
      toast.success('Pengaturan sinkronisasi berhasil disimpan.');
    } catch (err: any) {
      toast.error('Gagal menyimpan: ' + err.message);
    } finally {
      setSavingSync(false);
    }
  };

  const loadUsers = async () => {
    const db = await getDB();
    const u = await db.getAll('users');
    setUsersList(u);
  };

  const handleSaveAppConfig = async () => {
    const db = await getDB();
    await db.put('settings', { key: 'rsName', value: appNameInput });
    refreshSettings();
    toast.success('Konfigurasi aplikasi berhasil disimpan.');
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newUser.password !== newUser.confirmPassword) {
      toast.error('Password dan konfirmasi password tidak cocok!');
      return;
    }
    const db = await getDB();
    const existing = await db.getAll('users');
    if (existing.find(u => u.username === newUser.username)) {
      toast.error('Username sudah digunakan!');
      return;
    }
    
    await db.put('users', {
      username: newUser.username,
      namaLengkap: newUser.namaLengkap,
      role: newUser.role as 'superuser' | 'officer',
      passwordHash: hashPassword(newUser.password),
      aktif: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    
    toast.success('Pengguna berhasil ditambahkan. Sinkronisasi Cloud dimulai.');
    setIsAddUserOpen(false);
    setNewUser({ username: '', namaLengkap: '', password: '', confirmPassword: '', role: 'officer' });
    loadUsers();
    void autoBackupUsers().then(status => {
      if (status === 'synced') {
        toast.success('Master User berhasil dibackup ke Cloud.');
      } else {
        toast.warning('User tersimpan lokal. Backup Cloud tertunda dan akan dicoba kembali saat koneksi tersedia.');
      }
    });
  };

  const handleEditName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editNameTarget || !editNameValue.trim()) return;
    const db = await getDB();
    const updated = { ...editNameTarget, namaLengkap: editNameValue.trim(), updatedAt: Date.now() };
    await db.put('users', updated);
    toast.success('Nama berhasil diperbarui.');
    setIsEditNameOpen(false);
    setEditNameTarget(null);
    setEditNameValue('');
    loadUsers();
    autoBackupUsers();
  };

  const handleToggleUserStatus = async (u: any) => {
    if (u.username === user?.username) {
      toast.error('Tidak bisa menonaktifkan diri sendiri!');
      return;
    }
    const db = await getDB();
    u.aktif = !u.aktif;
    u.updatedAt = Date.now();
    await db.put('users', u);
    loadUsers();
    toast.success(`User ${u.username} ${u.aktif ? 'diaktifkan' : 'dinonaktifkan'}.`);
    autoBackupUsers();
  };

  const handleDeleteUser = async () => {
    if (!deleteUserTarget || !isSuperuser || !user) return;
    if (deleteUserTarget.username === user.username) {
      toast.error('Tidak bisa menghapus akun yang sedang digunakan.');
      setDeleteUserTarget(null);
      setDeleteUserPassword('');
      return;
    }
    if (!deleteUserPassword) {
      toast.error('Masukkan password superuser Anda untuk mengonfirmasi penghapusan.');
      return;
    }

    setDeletingUser(true);
    try {
      const db = await getDB();
      const allUsers = await db.getAll('users');
      const currentUser = allUsers.find(item => item.username === user.username);
      if (!currentUser || currentUser.role !== 'superuser') {
        throw new Error('Sesi superuser tidak valid. Silakan login ulang.');
      }
      if (currentUser.passwordHash !== hashPassword(deleteUserPassword)) {
        throw new Error('Password superuser tidak sesuai.');
      }

      const target = allUsers.find(item => item.id === deleteUserTarget.id);
      if (!target?.id) {
        throw new Error('User tidak ditemukan.');
      }
      if (target.username === currentUser.username || target.id === currentUser.id) {
        throw new Error('Tidak bisa menghapus akun superuser yang sedang digunakan.');
      }

      const superuserCount = allUsers.filter(item => item.role === 'superuser').length;
      if (target.role === 'superuser' && superuserCount <= 1) {
        throw new Error('Superuser terakhir tidak dapat dihapus.');
      }

      await db.delete('users', target.id);
      setUsersList(current => current.filter(item => item.id !== target.id));
      setDeleteUserTarget(null);
      setDeleteUserPassword('');
      toast.success(`User ${target.username} berhasil dihapus.`);
      await writeLog({
        modul: 'Master User',
        aktivitas: 'Menghapus user',
        detail: `User ${target.username} (${target.namaLengkap}) dihapus dari Master User.`,
        status: 'Success',
      });
      autoBackupUsers();
    } catch (err: any) {
      toast.error(err?.message || 'Gagal menghapus user.');
    } finally {
      setDeletingUser(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (pwForm.next !== pwForm.confirm) {
      toast.error('Password baru dan konfirmasi tidak cocok!');
      return;
    }
    if (pwForm.next.length < 6) {
      toast.error('Password baru minimal 6 karakter!');
      return;
    }
    setPwLoading(true);
    try {
      const db = await getDB();
      const allUsers = await db.getAll('users');
      const dbUser = allUsers.find(u => u.username === user.username);
      if (!dbUser) throw new Error('User tidak ditemukan');
      if (dbUser.passwordHash !== hashPassword(pwForm.current)) {
        toast.error('Password lama tidak sesuai!');
        return;
      }
      dbUser.passwordHash = hashPassword(pwForm.next);
      dbUser.updatedAt = Date.now();
      await db.put('users', dbUser);
      toast.success('Password berhasil diubah. Silakan login ulang berikutnya.');
      setPwForm({ current: '', next: '', confirm: '' });
      autoBackupUsers();
    } catch (err: any) {
      toast.error('Gagal mengubah password: ' + err.message);
    } finally {
      setPwLoading(false);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setImportFile(e.target.files[0]);
      setImportResult(null);
    }
  };

  const handleImport = async () => {
    if (!importFile || !user) return;
    setImporting(true);
    setImportProgress(0);
    setImportResult(null);
    try {
      const stats = await importExcel(importFile, user.id, user.namaLengkap, (p: number) => setImportProgress(p));
      setImportResult(stats);
      toast.success('Import data pasien berhasil diselesaikan.');
    } catch (err: any) {
      toast.error('Gagal melakukan import: ' + err.message);
    } finally {
      setImporting(false);
      setImportFile(null);
      const el = document.getElementById('settings-file-upload') as HTMLInputElement;
      if (el) el.value = '';
    }
  };

  const handleBackup = async () => {
    try {
      await backupData();
      toast.success('Backup berhasil didownload.');
    } catch(e: any) {
      toast.error('Gagal backup: ' + e.message);
    }
  };

  const handleRestore = async () => {
    if (!restoreFile) return;
    setRestoring(true);
    const toastId = toast.loading('Melakukan restore data...');
    try {
      const plan = await analyzeRestoreFile(restoreFile);
      toast.dismiss(toastId);
      setSmartRestorePlan(plan);
    } catch(e: any) {
      toast.dismiss(toastId);
      toast.error('Gagal menganalisis backup: ' + e.message);
    } finally {
      setRestoring(false);
    }
  };

  // ── Cloud Sync handlers ──────────────────────────────────────────────────────

  const loadCloudStatus = async () => {
    setCloudStatus('checking');
    try {
      // Load configurable GAS URL
      const url = await getCloudApiUrl();
      setCloudApiUrl(url);

      const s = await getCloudSyncStatus();
      setCloudStatus(s.status);
      setLastCloudBackup(s.lastBackup);
    } catch {
      setCloudStatus('offline');
    }
  };

  const handleSaveCloudUrl = async () => {
    setSavingCloudUrl(true);
    try {
      const db = await getDB();
      const trimmed = cloudApiUrl.trim();
      if (trimmed && !trimmed.startsWith('https://script.google.com/')) {
        toast.error('URL tidak valid. Harus dimulai dengan https://script.google.com/');
        return;
      }
      // Jika kosong, hapus setting (pakai default)
      if (!trimmed) {
        await db.delete('settings' as any, 'cloudApiUrl');
        setCloudApiUrl(DEFAULT_CLOUD_API);
        toast.success('URL dikembalikan ke default.');
      } else {
        await db.put('settings', { key: 'cloudApiUrl', value: trimmed });
        toast.success('URL Google Apps Script berhasil disimpan.');
      }
      // Cek ulang status dengan URL baru
      setCloudStatus('checking');
      setTimeout(() => loadCloudStatus(), 300);
    } catch (e: any) {
      toast.error('Gagal menyimpan URL: ' + e.message);
    } finally {
      setSavingCloudUrl(false);
    }
  };

  const handleBackupJSON = async () => {
    try {
      await backupDataJSON();
      toast.success('Backup JSON berhasil didownload ke perangkat Anda.');
    } catch(e: any) {
      toast.error('Gagal backup JSON: ' + e.message);
    }
  };

  const handleRestoreJSON = async () => {
    if (!restoreJsonFile) return;
    setRestoringJson(true);
    const toastId = toast.loading('Memproses restore JSON...');
    try {
      const plan = await analyzeRestoreFile(restoreJsonFile);
      toast.dismiss(toastId);
      setSmartRestorePlan(plan);
    } catch(e: any) {
      toast.dismiss(toastId);
      toast.error('Gagal menganalisis backup JSON: ' + e.message);
    } finally {
      setRestoringJson(false);
    }
  };

  const handleApplySmartRestore = async () => {
    if (!smartRestorePlan) return;
    setSmartRestoreApplying(true);
    try {
      const result = await applySmartRestore(smartRestorePlan);
      setSmartRestoreResult(result);
      setSmartRestoreResultOpen(true);
      setSmartRestorePlan(null);
      setRestoreFile(null);
      setRestoreJsonFile(null);
      await writeLog({
        modul: 'Backup & Restore',
        aktivitas: 'Smart Restore',
        detail: `Restore ${smartRestorePlan.sourceName}: ${result.created} baru, ${result.updated} update, ${result.conflicts} konflik, ${result.invalid} invalid.`,
        status: result.conflicts || result.invalid ? 'Warning' : 'Success',
        durasi: result.duration,
      });
    } catch (error: any) {
      toast.error('Smart Restore gagal: ' + error.message);
    } finally {
      setSmartRestoreApplying(false);
    }
  };

  const handleUndoSmartRestore = async () => {
    try {
      await restoreLatestRestorePoint();
      toast.success('Restore dibatalkan. Data dikembalikan ke kondisi sebelum Smart Restore.');
      setSmartRestoreResultOpen(false);
      setTimeout(() => window.location.reload(), 500);
    } catch (error: any) {
      toast.error('Undo Restore gagal: ' + error.message);
    }
  };

  const handleBackupCloud = async () => {
    setCloudBackingUp(true);
    try {
      await backupCloud();
      setLastCloudBackup(Date.now());
      toast.success('Backup Cloud berhasil! Data tersimpan di Cloud.');
    } catch(e: any) {
      toast.error('Backup Cloud gagal: ' + e.message);
    } finally {
      setCloudBackingUp(false);
    }
  };

  const handleRestoreCloud = async () => {
    if (!confirm(
      'Peringatan: Restore Cloud akan menimpa SEMUA data lokal saat ini dengan data dari Cloud. ' +
      'Perubahan lokal yang belum diunggah juga akan dibuang dan tidak dapat dipulihkan dari Cloud. Lanjutkan?',
    )) return;
    setCloudRestoring(true);
    const toastId = toast.loading('Mengambil data dari Cloud...');
    try {
      await restoreCloud();
      toast.dismiss(toastId);
      toast.success('Restore Cloud berhasil! Memuat ulang aplikasi...');
      setTimeout(() => window.location.reload(), 1500);
    } catch(e: any) {
      toast.dismiss(toastId);
      // Data lokal TIDAK terhapus karena restore gagal sebelum menimpa
      toast.error('Restore Cloud gagal: ' + e.message);
    } finally {
      setCloudRestoring(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pengaturan Sistem</h1>
        <p className="text-muted-foreground mt-1">
          {isSuperuser
            ? 'Konfigurasi aplikasi dan manajemen pengguna.'
            : 'Pengaturan pribadi untuk menjaga keamanan sesi dan notifikasi.'}
        </p>
      </div>

      {!isSuperuser && (
        <Card className="border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="w-4 h-4 text-sky-700 dark:text-sky-300" />
              Hak Akses Officer
            </CardTitle>
            <CardDescription>
              Akses diberikan berdasarkan kebutuhan tugas operasional, prinsip least privilege,
              dan pemisahan tanggung jawab.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 text-sm">
            <div>
              <p className="font-semibold text-emerald-700 dark:text-emerald-300 mb-2">Dapat melihat dan menggunakan</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                {ACCESS_POLICY.officer.allowed.map(item => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-amber-700 dark:text-amber-300 mb-2">Tidak termasuk kewenangan officer</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                {ACCESS_POLICY.officer.restricted.map(item => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex border-b border-border mb-6 flex-wrap">
        <TabButton active={activeTab === 'profil'} onClick={() => setActiveTab('profil')} icon={Shield} label="Profil Saya" />
        <TabButton active={activeTab === 'session'} onClick={() => setActiveTab('session')} icon={Timer} label="Sesi & Keamanan" />
        <TabButton active={activeTab === 'notifikasi'} onClick={() => setActiveTab('notifikasi')} icon={Volume2} label="Notifikasi" />
        {isSuperuser && <TabButton active={activeTab === 'backup'} onClick={() => setActiveTab('backup')} icon={Database} label="Backup & Restore" />}
        {isSuperuser && <TabButton active={activeTab === 'sinkronisasi'} onClick={() => setActiveTab('sinkronisasi')} icon={RefreshCw} label="Sinkronisasi" />}
        {isSuperuser && (
          <TabButton
            active={activeTab === 'integrasiTrakCare'}
            onClick={() => setActiveTab('integrasiTrakCare')}
            icon={Terminal}
            label="Integrasi TrakCare"
          />
        )}
         {isSuperuser && <TabButton active={activeTab === 'whatsapp'} onClick={() => setActiveTab('whatsapp')} icon={MessageSquare} label="WhatsApp" />}
         {isSuperuser && <TabButton active={activeTab === 'outlook'} onClick={() => setActiveTab('outlook')} icon={Mail} label="Outlook" />}
        {isSuperuser && <TabButton active={activeTab === 'import'} onClick={() => setActiveTab('import')} icon={Upload} label="Import Data" />}
        {isSuperuser && <TabButton active={activeTab === 'masterTarif'} onClick={() => setActiveTab('masterTarif')} icon={FileSpreadsheet} label="Master Tarif" />}
        {user?.role === 'superuser' && <TabButton active={activeTab === 'masterChecklist'} onClick={() => setActiveTab('masterChecklist')} icon={CheckCircle2} label="Master Checklist Pasien" />}
        {isSuperuser && <TabButton active={activeTab === 'templatePesan'} onClick={() => setActiveTab('templatePesan')} icon={MessageSquare} label="Template Pesan Kasir" />}
        {isSuperuser && <TabButton active={activeTab === 'billingRule'} onClick={() => setActiveTab('billingRule')} icon={SlidersHorizontal} label="Billing Rule" />}
        <TabButton active={activeTab === 'patchManager'} onClick={() => setActiveTab('patchManager')} icon={FileCode2} label="Patch Manager" />
        {user?.role === 'superuser' && (
          <>
            <TabButton active={activeTab === 'app'} onClick={() => setActiveTab('app')} icon={Building} label="Aplikasi" />
            <TabButton active={activeTab === 'users'} onClick={() => setActiveTab('users')} icon={Users} label="Master User" />
            <TabButton active={activeTab === 'download'} onClick={() => setActiveTab('download')} icon={Download} label="Download Aplikasi" />
          </>
        )}
      </div>

      {activeTab === 'whatsapp' && isSuperuser && <WhatsAppSettingsPanel />}
      {activeTab === 'outlook' && isSuperuser && <OutlookSettingsPanel />}

      {activeTab === 'profil' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profil Pengguna</CardTitle>
              <CardDescription>Informasi akun Anda saat ini.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-md">
              <div>
                <label className="text-sm font-semibold text-muted-foreground">Nama Lengkap</label>
                <div className="text-lg font-medium">{user?.namaLengkap}</div>
              </div>
              <div>
                <label className="text-sm font-semibold text-muted-foreground">Username</label>
                <div className="text-lg">{user?.username}</div>
              </div>
              <div>
                <label className="text-sm font-semibold text-muted-foreground">Role Akses</label>
                <div className="inline-block mt-1 uppercase tracking-wider text-xs font-bold bg-primary/10 text-primary px-3 py-1 rounded-md">
                  {user?.role}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5" /> Ubah Password
              </CardTitle>
              <CardDescription>Masukkan password lama untuk verifikasi, lalu tetapkan password baru.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Password Lama</label>
                  <div className="relative">
                    <Input
                      type={showCurrent ? 'text' : 'password'}
                      value={pwForm.current}
                      onChange={e => setPwForm({ ...pwForm, current: e.target.value })}
                      placeholder="Masukkan password saat ini"
                      required
                      className="pr-10"
                    />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowCurrent(v => !v)}>
                      {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Password Baru</label>
                  <div className="relative">
                    <Input
                      type={showNext ? 'text' : 'password'}
                      value={pwForm.next}
                      onChange={e => setPwForm({ ...pwForm, next: e.target.value })}
                      placeholder="Minimal 6 karakter"
                      required
                      className="pr-10"
                    />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowNext(v => !v)}>
                      {showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Konfirmasi Password Baru</label>
                  <div className="relative">
                    <Input
                      type={showConfirm ? 'text' : 'password'}
                      value={pwForm.confirm}
                      onChange={e => setPwForm({ ...pwForm, confirm: e.target.value })}
                      placeholder="Ulangi password baru"
                      required
                      className="pr-10"
                    />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowConfirm(v => !v)}>
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {pwForm.confirm && pwForm.next !== pwForm.confirm && (
                    <p className="text-xs text-destructive">Password tidak cocok.</p>
                  )}
                </div>
                <Button type="submit" disabled={pwLoading} className="gap-2">
                  <KeyRound className="w-4 h-4" />
                  {pwLoading ? 'Menyimpan...' : 'Simpan Password Baru'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'session' && (
        <div className="space-y-6 max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                Auto Logout
              </CardTitle>
              <CardDescription>
                Atur berapa lama sesi login otomatis berakhir saat tidak ada aktivitas. Berlaku untuk semua pengguna di perangkat ini.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Toggle on/off */}
              <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-muted/30">
                <div>
                  <div className="font-semibold text-sm">Aktifkan Auto Logout</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {autoLogoutEnabled
                      ? `Sesi berakhir setelah ${autoLogoutMins} menit tidak aktif`
                      : 'Sesi tidak akan berakhir otomatis'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoLogoutEnabled(v => !v)}
                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary
                    ${autoLogoutEnabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                  aria-checked={autoLogoutEnabled}
                  role="switch"
                >
                  <span
                    className={`pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow-md ring-0 transition-transform duration-200
                      ${autoLogoutEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                  />
                </button>
              </div>

              {/* Duration picker */}
              {autoLogoutEnabled && (
                <div className="space-y-3">
                  <label className="text-sm font-semibold">Durasi Tidak Aktif Sebelum Logout</label>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {[
                      { value: 5,   label: '5 menit' },
                      { value: 10,  label: '10 menit' },
                      { value: 15,  label: '15 menit' },
                      { value: 30,  label: '30 menit' },
                      { value: 60,  label: '1 jam' },
                      { value: 120, label: '2 jam' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setAutoLogoutMins(opt.value)}
                        className={`py-2.5 px-3 rounded-lg border-2 text-sm font-medium transition-all text-center ${
                          autoLogoutMins === opt.value
                            ? 'bg-primary border-primary text-primary-foreground shadow-sm'
                            : 'bg-background border-border text-foreground hover:border-primary/50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Info banners */}
              {autoLogoutEnabled ? (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm text-primary">
                  <b>Auto Logout Aktif</b> — Sistem akan otomatis logout setelah{' '}
                  <b>{autoLogoutMins} menit</b> tidak ada aktivitas (klik / ketik / scroll).
                  Timer akan direset setiap kali Anda berinteraksi dengan aplikasi.
                </div>
              ) : (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-300">
                  <b>Auto Logout Dinonaktifkan</b> — Sesi tidak akan berakhir otomatis.
                  Pastikan Anda logout manual saat meninggalkan perangkat.
                </div>
              )}

              <Button onClick={handleSaveSessionSettings} disabled={savingSession} className="gap-2">
                <Save className="w-4 h-4" />
                {savingSession ? 'Menyimpan...' : 'Simpan Pengaturan Sesi'}
              </Button>
            </CardContent>
          </Card>

          {/* Info card */}
          <Card className="shadow-none bg-muted/20 border-border">
            <CardContent className="p-4 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <Info className="w-4 h-4" /> Informasi
              </p>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                {[
                  'Pengaturan ini berlaku untuk semua pengguna yang login di perangkat ini.',
                  'Timer inaktivitas direset setiap kali ada klik, ketikan, atau scroll pada aplikasi.',
                  'Saat sesi berakhir, Anda akan diarahkan ke halaman login dan perlu login ulang.',
                  'Data yang belum tersimpan saat sesi berakhir tidak akan hilang — tersimpan di IndexedDB browser.',
                ].map((note, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'notifikasi' && (
        <div className="space-y-6 max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-primary" /> Pengaturan Notifikasi
              </CardTitle>
              <CardDescription>
                Pengaturan tersimpan di IndexedDB perangkat ini dan tetap berlaku saat aplikasi dibuka offline.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3">
                {[
                  { key: 'soundEnabled' as const, title: 'Aktifkan suara', description: 'Putar suara saat notifikasi baru diterima.' },
                  { key: 'popupEnabled' as const, title: 'Tampilkan popup', description: 'Tampilkan dialog popup untuk notifikasi baru.' },
                   { key: 'loop' as const, title: 'Ulangi suara untuk prioritas tinggi', description: 'Nada akan diulang dengan jarak aman agar perubahan penting tidak terlewat.' },
                ].map(item => (
                  <label key={item.key} className="flex items-center justify-between gap-4 rounded-lg border p-4 cursor-pointer hover:bg-muted/30">
                    <span>
                      <span className="block text-sm font-semibold">{item.title}</span>
                      <span className="block text-xs text-muted-foreground mt-0.5">{item.description}</span>
                    </span>
                    <input
                       type="checkbox"
                       data-testid={`input-notification-${item.key}`}
                      className="h-4 w-4 accent-primary"
                      checked={notificationSettings[item.key]}
                      onChange={e => updateNotification(item.key, e.target.checked)}
                    />
                  </label>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="notification-volume" className="text-sm font-semibold">Volume suara</label>
                  <span className="text-sm text-muted-foreground">{Math.round(notificationSettings.volume * 100)}%</span>
                </div>
                <input
                   id="notification-volume"
                   data-testid="input-notification-volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={notificationSettings.volume}
                  onChange={e => updateNotification('volume', Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>

              <div className="space-y-3">
                <div>
                   <p className="text-sm font-semibold">Suara per jenis notifikasi</p>
                   <p className="text-xs text-muted-foreground">Pilih pola suara agar jenis notifikasi mudah dibedakan tanpa menaikkan volume.</p>
                </div>
                {Object.entries(NOTIFICATION_KIND_LABELS).map(([kind, label]) => (
                   <div key={kind} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/15 p-3">
                     <div className="min-w-0">
                    <label htmlFor={`notification-sound-${kind}`} className="text-sm">{label}</label>
                     <p className="text-[11px] text-muted-foreground mt-0.5">{kind === 'ktm' ? 'Antrean KTM baru' : kind === 'igd' ? 'Perubahan antrean IGD' : kind === 'billing' ? 'Tindakan billing' : 'Operan yang tertunda'}</p>
                     </div>
                     <div className="flex items-center gap-2 shrink-0">
                    <select
                      id={`notification-sound-${kind}`}
                       data-testid={`select-notification-sound-${kind}`}
                      value={notificationSettings.sounds[kind as NotificationKind]}
                      onChange={e => updateNotificationSound(kind as NotificationKind, e.target.value as NotificationSound)}
                      className="h-9 min-w-40 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {Object.entries(NOTIFICATION_SOUND_LABELS).map(([sound, soundLabel]) => (
                        <option key={sound} value={sound}>{soundLabel}</option>
                      ))}
                    </select>
                     <Button
                       type="button"
                       variant="ghost"
                       size="icon"
                       aria-label={`Pratinjau suara ${label}`}
                       data-testid={`button-preview-sound-${kind}`}
                       onClick={() => playNotificationPreview(notificationSettings.sounds[kind as NotificationKind], notificationSettings.volume)}
                       disabled={!notificationSettings.soundEnabled}
                     >
                       <Volume2 className="w-4 h-4" />
                     </Button>
                     </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                   onClick={() => playNotificationPreview(notificationSettings.sounds.ktm, notificationSettings.volume)}
                   data-testid="button-test-notification-sound"
                  disabled={!notificationSettings.soundEnabled}
                >
                  <Volume2 className="w-4 h-4" /> Tes Suara KTM
                </Button>
                 <Button type="button" variant="ghost" onClick={stopNotificationSound} data-testid="button-stop-notification-sound">Hentikan suara</Button>
                 <Button onClick={handleSaveNotificationSettings} disabled={savingNotifications} className="gap-2 ml-auto" data-testid="button-save-notification-settings">
                  <Save className="w-4 h-4" />
                  {savingNotifications ? 'Menyimpan...' : 'Simpan Pengaturan Notifikasi'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'app' && user?.role === 'superuser' && (
        <Card>
          <CardHeader>
            <CardTitle>Konfigurasi Rumah Sakit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 max-w-md">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Nama Rumah Sakit</label>
              <Input value={appNameInput} onChange={e => setAppNameInput(e.target.value)} />
            </div>
            <Button onClick={handleSaveAppConfig} className="gap-2"><Save className="w-4 h-4"/> Simpan Konfigurasi</Button>
          </CardContent>
        </Card>
      )}

      {activeTab === 'users' && user?.role === 'superuser' && (
        <Card>
          <CardHeader className="flex flex-row justify-between items-center">
            <div>
              <CardTitle>Manajemen Pengguna</CardTitle>
              <CardDescription>Kelola akses officer admission.</CardDescription>
            </div>
            <Button onClick={() => setIsAddUserOpen(true)}>Tambah User</Button>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground text-left">
                <tr>
                  <th className="p-3">Username</th>
                  <th className="p-3">Nama Lengkap</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {usersList.map(u => (
                  <tr key={u.id} className="border-b border-border">
                    <td className="p-3 font-medium">{u.username}</td>
                    <td className="p-3">{u.namaLengkap}</td>
                    <td className="p-3 uppercase text-xs">{u.role}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded-md text-xs font-bold ${u.aktif ? 'bg-emerald-100 text-emerald-700' : 'bg-destructive/10 text-destructive'}`}>
                        {u.aktif ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="p-3 text-right flex gap-2 justify-end">
                      <Button variant="outline" size="sm" onClick={() => { setEditNameTarget(u); setEditNameValue(u.namaLengkap); setIsEditNameOpen(true); }}>
                        Ubah Nama
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleToggleUserStatus(u)}>
                        {u.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => {
                          setDeleteUserTarget(u);
                          setDeleteUserPassword('');
                        }}
                        disabled={u.username === user?.username}
                        title={u.username === user?.username ? 'Akun yang sedang digunakan tidak dapat dihapus' : 'Hapus user'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Hapus
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {activeTab === 'backup' && isSuperuser && (
        <div className="space-y-6 max-w-4xl">

          {/* ── Cloud Status Banner ─────────────────────────────────────── */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  {cloudStatus === 'checking' ? (
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : cloudStatus === 'online' ? (
                    <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                      <Cloud className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center shrink-0">
                      <CloudOff className="w-5 h-5 text-red-600 dark:text-red-400" />
                    </div>
                  )}
                  <div>
                    <div className="font-semibold text-sm flex items-center gap-2">
                      ☁️ Cloud Status:{' '}
                      <span className={
                        cloudStatus === 'online'   ? 'text-emerald-600 dark:text-emerald-400' :
                        cloudStatus === 'offline'  ? 'text-red-600 dark:text-red-400' :
                        'text-muted-foreground'
                      }>
                        {cloudStatus === 'online' ? 'ONLINE' : cloudStatus === 'offline' ? 'OFFLINE' : 'Mengecek...'}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      LAST BACKUP:{' '}
                      {lastCloudBackup
                        ? formatDateTime(lastCloudBackup)
                        : 'Belum pernah backup ke Cloud'}
                    </div>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={loadCloudStatus} disabled={cloudStatus === 'checking'} className="gap-1.5 shrink-0">
                  <RefreshCw className={`w-3.5 h-3.5 ${cloudStatus === 'checking' ? 'animate-spin' : ''}`} />
                  Cek Ulang
                </Button>
              </div>

              {/* Offline notice */}
              {cloudStatus === 'offline' && (
                <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Tidak ada koneksi internet atau layanan Cloud tidak dapat diakses.
                    Perubahan data tetap tersimpan di IndexedDB lokal.
                    Tombol Cloud Backup/Restore dinonaktifkan sementara.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── 4 Action Cards ─────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Backup Lokal JSON */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-emerald-600" />
                  Backup Lokal (.json)
                </CardTitle>
                <CardDescription>
                  Download seluruh database IndexedDB ke file JSON di perangkat Anda. Tidak membutuhkan internet.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleBackupJSON} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                  <Download className="w-4 h-4" /> Download Backup JSON
                </Button>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  Simpan file ini di tempat aman. Dapat digunakan untuk restore kapan saja.
                </p>
              </CardContent>
            </Card>

            {/* Restore Lokal JSON */}
            <Card className="border-amber-200/80 dark:border-amber-800/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-amber-600" />
                  Restore Lokal (.json)
                </CardTitle>
                <CardDescription>
                  Pulihkan data dari file JSON backup lokal.{' '}
                  <strong className="text-amber-700 dark:text-amber-400">Menimpa data saat ini.</strong>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  type="file"
                  accept=".json"
                  onChange={e => setRestoreJsonFile(e.target.files?.[0] || null)}
                  disabled={restoringJson}
                />
                {restoreJsonFile && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    {restoreJsonFile.name} ({(restoreJsonFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
                <Button
                  onClick={handleRestoreJSON}
                  disabled={!restoreJsonFile || restoringJson}
                  className="w-full gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20"
                  variant="outline"
                >
                  {restoringJson
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Memproses...</>
                    : <><Upload className="w-4 h-4" /> Jalankan Restore JSON</>
                  }
                </Button>
              </CardContent>
            </Card>

            {/* Backup Cloud */}
            <Card className={cloudStatus === 'offline' ? 'opacity-60' : ''}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-blue-600" />
                  Backup Cloud
                </CardTitle>
                <CardDescription>
                  Kirim seluruh database ke Cloud. Membutuhkan internet.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={handleBackupCloud}
                  disabled={cloudBackingUp || cloudStatus !== 'online'}
                  className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                >
                  {cloudBackingUp
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengirim ke Cloud...</>
                    : <><Cloud className="w-4 h-4" /> Backup Cloud</>
                  }
                </Button>
                {cloudStatus === 'offline' && (
                  <p className="text-xs text-muted-foreground text-center mt-2">Tidak tersedia saat offline</p>
                )}
                {cloudStatus === 'online' && (
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Data akan tersimpan sebagai <code className="bg-muted px-1 rounded">database.json</code> di Cloud.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Restore Cloud */}
            <Card className={`border-destructive/30 ${cloudStatus === 'offline' ? 'opacity-60' : ''}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-destructive">
                  <Cloud className="w-4 h-4" />
                  Restore Cloud
                </CardTitle>
                <CardDescription>
                  Ambil data dari Cloud lalu timpa database lokal.{' '}
                  <strong className="text-destructive">Hanya jalan jika download berhasil.</strong>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={handleRestoreCloud}
                  disabled={cloudRestoring || cloudStatus !== 'online'}
                  variant="destructive"
                  className="w-full gap-2 disabled:opacity-50"
                >
                  {cloudRestoring
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengambil dari Cloud...</>
                    : <><Upload className="w-4 h-4" /> Restore Cloud</>
                  }
                </Button>
                {cloudStatus === 'offline' && (
                  <p className="text-xs text-muted-foreground text-center mt-2">Tidak tersedia saat offline</p>
                )}
                {cloudStatus === 'online' && (
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Data lokal TIDAK akan diubah jika koneksi ke Cloud gagal.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Auto Backup ────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Backup Otomatis Cloud
              </CardTitle>
              <CardDescription>
                Backup berjalan di latar belakang selama aplikasi masih terbuka dan tetap
                dilanjutkan setelah user logout.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-muted/30">
                <div>
                  <div className="font-semibold text-sm">Backup Otomatis ke Cloud</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Aktif permanen — perubahan data masuk antrean backup dan diproses
                    bertahap agar tidak menumpuk.
                  </div>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  Selalu aktif
                </span>
              </div>

              {cloudStatus === 'offline' && (
                <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Internet tidak tersedia sekarang. Perubahan hanya disimpan di IndexedDB lokal.
                    Backup otomatis akan aktif kembali saat koneksi tersedia.
                  </span>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Jika koneksi terputus, data tetap tersimpan di IndexedDB lokal dan akan
                dicoba ulang saat koneksi tersedia.
              </p>
            </CardContent>
          </Card>

          {/* ── Konfigurasi URL Google Apps Script ─────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="w-4 h-4" /> URL Google Apps Script
              </CardTitle>
              <CardDescription>
                URL endpoint Google Apps Script untuk backup & restore cloud.
                Kosongkan untuk menggunakan URL default. Ubah jika script diganti atau di-deploy ulang.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  URL Web App GAS
                </label>
                <Input
                  value={cloudApiUrl}
                  onChange={e => setCloudApiUrl(e.target.value)}
                  placeholder={DEFAULT_CLOUD_API}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Harus diawali dengan <code className="bg-muted px-1 rounded">https://script.google.com/macros/s/</code>.
                  Pastikan GAS di-deploy dengan akses <strong>"Anyone"</strong> atau <strong>"Anyone, even anonymous"</strong>.
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={handleSaveCloudUrl} disabled={savingCloudUrl} className="gap-2">
                  <Save className="w-4 h-4" />
                  {savingCloudUrl ? 'Menyimpan...' : 'Simpan URL'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setCloudApiUrl(DEFAULT_CLOUD_API); }}
                  className="gap-2 text-muted-foreground"
                  disabled={cloudApiUrl === DEFAULT_CLOUD_API}
                >
                  Reset ke Default
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── Excel portable snapshot ────────────────────────────────── */}
          <Card className="shadow-none bg-muted/10 border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" /> Backup Lengkap (.xlsx)
              </CardTitle>
              <CardDescription className="text-xs">
                Snapshot lengkap untuk memindahkan operan, pasien, transaksi, konfigurasi, dan seluruh master antar perangkat.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3 items-center">
              <Button size="sm" variant="outline" onClick={handleBackup} className="gap-1.5">
                <Download className="w-3.5 h-3.5" /> Download Backup Excel
              </Button>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept=".xlsx"
                  className="max-w-[200px] text-xs h-8"
                  onChange={e => setRestoreFile(e.target.files?.[0] || null)}
                  disabled={restoring}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRestore}
                  disabled={!restoreFile || restoring}
                  className="gap-1.5 shrink-0"
                >
                  {restoring
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Restore...</>
                    : <><Upload className="w-3.5 h-3.5" /> Restore Excel</>
                  }
                </Button>
              </div>
            </CardContent>
          </Card>

        </div>
      )}

      {activeTab === 'masterTarif' && isSuperuser && (
        <MasterTarifContent />
      )}

      {activeTab === 'masterChecklist' && user?.role === 'superuser' && (
        <MasterChecklistPasien />
      )}

      {activeTab === 'templatePesan' && isSuperuser && (
        <TemplatePesanKasirContent />
      )}

      {activeTab === 'billingRule' && isSuperuser && (
        <BillingRuleSettings />
      )}
      {activeTab === 'patchManager' && (
        <PatchManagerPanel isSuperuser={isSuperuser} />
      )}

      {activeTab === 'import' && isSuperuser && (
        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Import Data Pasien</CardTitle>
              <CardDescription>Perbarui data pasien rawat inap dari file Excel Sistem HIS.</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="border-2 border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center bg-muted/20 text-center transition-colors hover:bg-muted/40">
                <FileSpreadsheet className="w-16 h-16 text-primary mb-4" />
                <h3 className="text-lg font-semibold mb-2">Upload File Excel (.xlsx)</h3>
                <p className="text-sm text-muted-foreground max-w-md mb-6">
                  Pastikan format file sesuai dengan hasil export laporan pasien aktif dari sistem HIS.
                  Proses ini akan otomatis memutakhirkan status pasien, ruangan, dan kelas.
                </p>
                <input
                  type="file"
                  id="settings-file-upload"
                  className="hidden"
                  accept=".xlsx, .xls"
                  onChange={handleImportFile}
                  disabled={importing}
                />
                <label
                  htmlFor="settings-file-upload"
                  className="cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-8"
                >
                  Pilih File Excel
                </label>
                {importFile && (
                  <div className="mt-4 p-3 bg-card border border-border rounded-lg text-sm font-medium flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
                  </div>
                )}
              </div>

              {importing && (
                <div className="mt-6 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold text-primary flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Memproses Data...
                    </span>
                    <span>{importProgress}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: `${importProgress}%` }} />
                  </div>
                </div>
              )}

              <div className="mt-6 flex justify-end">
                <Button size="lg" onClick={handleImport} disabled={!importFile || importing} className="w-full sm:w-auto">
                  {importing ? 'Sedang Import...' : 'Mulai Import Data'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {importResult && (
            <Card className="border-emerald-500/30 shadow-sm bg-emerald-50/30 dark:bg-emerald-950/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-xl flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" /> Hasil Import
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  <div className="bg-background p-4 rounded-lg border border-border">
                    <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Total Baris</div>
                    <div className="text-2xl font-bold">{importResult.total}</div>
                  </div>
                  <div className="bg-background p-4 rounded-lg border border-border">
                    <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider text-emerald-600">Pasien Baru</div>
                    <div className="text-2xl font-bold text-emerald-600">{importResult.new}</div>
                  </div>
                  <div className="bg-background p-4 rounded-lg border border-border">
                    <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider text-blue-600">Diupdate</div>
                    <div className="text-2xl font-bold text-blue-600">{importResult.updated}</div>
                  </div>
                  <div className="bg-background p-4 rounded-lg border border-border">
                    <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider text-orange-600">Pulang/Arsip</div>
                    <div className="text-2xl font-bold text-orange-600">{importResult.archived}</div>
                  </div>
                </div>
                {importResult.errors && importResult.errors.length > 0 && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                    <h4 className="font-semibold text-destructive flex items-center gap-2 mb-2">
                      <AlertCircle className="w-4 h-4" /> Ada {importResult.errors.length} Error:
                    </h4>
                    <ul className="text-sm space-y-1 text-destructive/80 max-h-32 overflow-y-auto list-disc pl-5">
                      {importResult.errors.map((e: string, i: number) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'download' && user?.role === 'superuser' && (() => {
        const htmlFileUrl = `${import.meta.env.BASE_URL}ipaw.html`;
        const htmlV2FileUrl = `${import.meta.env.BASE_URL}ipawv2.html`;
        const htmlV3FileUrl = `${import.meta.env.BASE_URL}ipawv3.html`;
        const batFileUrl  = `${import.meta.env.BASE_URL}buka-ipaw-offline.bat`;
        const batV2FileUrl = `${import.meta.env.BASE_URL}buka-ipawv2-offline.bat`;
        const proxyFileUrl = `${import.meta.env.BASE_URL}ipaw-offline-proxy.ps1`;
        const gasFileUrl = `${import.meta.env.BASE_URL}BackupCloudSpreadsheet.txt`;
        const steps = [
          'Pilih ipaw.html (V1) atau ipawv2.html (LocalDB-first), lalu download file HTML dan bridge yang diperlukan ke folder yang sama, misalnya D:\\IPAW\\.',
           'Gunakan buka-ipaw-offline.bat untuk V1 atau buka-ipawv2-offline.bat untuk V2. Launcher menyalakan bridge lokal agar Cloud, pasien rawat inap, IGD, KTM, Operating Theatre, dan fitur live lain memakai alur yang sama seperti versi online.',
           'Komputer harus terhubung ke internet untuk Cloud dan ke jaringan internal RS EMC untuk data TrakCare. Data lokal tetap dapat dibuka saat salah satu koneksi tidak tersedia.',
           'Bridge PowerShell mengikuti proxy Windows/Fortinet dan TLS 1.2. Jika RS memberi URL proxy khusus, set environment variable Windows IPAW_HTTPS_PROXY sebelum menjalankan BAT, misalnya: setx IPAW_HTTPS_PROXY http://proxy-rs:8080.',
          'Saat ada update aplikasi, download ulang file versi yang digunakan beserta launcher/PS1 yang sesuai dan ganti file lama.',
        ];
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <FileCode2 className="w-6 h-6 text-primary" />
              <h2 className="text-xl font-bold">Download Aplikasi</h2>
              <Badge variant="secondary">Superuser Only</Badge>
            </div>
             <p className="text-muted-foreground text-sm -mt-4">
                Unduh file HTML mandiri beserta launcher dan bridge lokal untuk akses Monitoring KTM
               melalui jaringan internal RS EMC.
            </p>

            <div className="space-y-3">
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="p-5 flex flex-col sm:flex-row items-center gap-4">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <HardDrive className="w-5 h-5 text-primary" />
                      <span className="font-semibold text-base">ipaw.html</span>
                      <Badge variant="outline" className="text-xs">Wajib</Badge>
                    </div>
                     <p className="text-sm text-muted-foreground">Bundle aplikasi offline dengan dukungan Cloud dan seluruh fitur data live melalui bridge lokal</p>
                     <p className="text-xs text-muted-foreground">Ukuran: ± 3,5 MB</p>
                  </div>
                  <a href={htmlFileUrl} download="ipaw.html">
                    <Button size="lg" className="gap-2 w-full sm:w-auto">
                      <Download className="w-5 h-5" /> Download HTML
                    </Button>
                  </a>
                </CardContent>
              </Card>

              <Card className="border-emerald-300/60 bg-emerald-50/60 dark:border-emerald-700/40 dark:bg-emerald-950/20">
                <CardContent className="p-5 flex flex-col sm:flex-row items-center gap-4">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <HardDrive className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-semibold text-base">ipawv2.html</span>
                      <Badge variant="outline" className="text-xs border-emerald-400 text-emerald-700 dark:text-emerald-300">
                        LocalDB-first
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Versi V2 dengan LocalDB sebagai penyimpanan utama. Cloud hanya digunakan sebagai backup.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Tetap dapat digunakan saat offline; perubahan akan diantrikan dan dicadangkan saat koneksi tersedia.
                    </p>
                  </div>
                  <a href={htmlV2FileUrl} download="ipawv2.html">
                    <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto border-emerald-400 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:border-emerald-600 dark:hover:bg-emerald-950">
                      <Download className="w-5 h-5" /> Download V2
                    </Button>
                  </a>
                </CardContent>
              </Card>

              <Card className="border-violet-300/70 bg-violet-50/70 dark:border-violet-700/50 dark:bg-violet-950/20">
                <CardContent className="p-5 flex flex-col sm:flex-row items-center gap-4">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <FileCode2 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                      <span className="font-semibold text-base">ipawv3.html</span>
                      <Badge variant="outline" className="text-xs border-violet-400 text-violet-700 dark:text-violet-300">Deploy ke GAS</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">Versi online self-contained untuk diunggah sebagai file HTML pada project Google Apps Script</p>
                    <p className="text-xs text-muted-foreground">
                      Tidak memerlukan file://, launcher BAT, atau bridge offline. Kode GAS harus menyediakan view <code>?view=ipawv3</code>.
                    </p>
                  </div>
                  <a href={htmlV3FileUrl} download="ipawv3.html">
                    <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto border-violet-400 text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:border-violet-600 dark:hover:bg-violet-950">
                      <Download className="w-5 h-5" /> Download V3
                    </Button>
                  </a>
                </CardContent>
              </Card>

              <Card className="border-emerald-200/80 bg-emerald-50/30 dark:border-emerald-800/50 dark:bg-emerald-950/10">
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-start gap-3 flex-1">
                    <Terminal className="w-5 h-5 text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-sm">buka-ipawv2-offline.bat</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Launcher Windows khusus untuk ipawv2.html dan bridge Cloud/TrakCare
                      </p>
                    </div>
                  </div>
                  <a href={batV2FileUrl} download="buka-ipawv2-offline.bat">
                    <Button variant="outline" size="sm" className="gap-2 w-full sm:w-auto border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300">
                      <Download className="w-4 h-4" /> Download Launcher V2
                    </Button>
                  </a>
                </CardContent>
              </Card>

              <Card className="border-amber-300/60 bg-amber-50/60 dark:border-amber-700/40 dark:bg-amber-950/20">
                <CardContent className="p-5 flex flex-col sm:flex-row items-center gap-4">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                      <span className="font-semibold text-base">buka-ipaw-offline.bat</span>
                       <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-300">Untuk Monitoring KTM</Badge>
                    </div>
                   <p className="text-sm text-muted-foreground">Launcher Windows · Membuka Chrome dengan CORS bypass</p>
                   <p className="text-xs text-muted-foreground">Wajib untuk KTM dan komputer harus terhubung ke jaringan internal RS EMC</p>
                  </div>
                  <a href={batFileUrl} download="buka-ipaw-offline.bat">
                    <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto border-amber-400 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:border-amber-600 dark:hover:bg-amber-950">
                      <Download className="w-5 h-5" /> Download BAT
                    </Button>
                  </a>
                </CardContent>
              </Card>

              <Card className="border-sky-300/60 bg-sky-50/60 dark:border-sky-700/40 dark:bg-sky-950/20">
                <CardContent className="p-5 flex flex-col sm:flex-row items-center gap-4">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                      <span className="font-semibold text-base">ipaw-offline-proxy.ps1</span>
                      <Badge variant="outline" className="text-xs border-sky-400 text-sky-700 dark:text-sky-300">Wajib</Badge>
                    </div>
                     <p className="text-sm text-muted-foreground">Bridge lokal untuk Cloud Backup dan login TrakCare dari jaringan internal RS EMC</p>
                     <p className="text-xs text-muted-foreground">Mengikuti proxy Windows/Fortinet, HTTPS TLS 1.2, dan kredensial Windows bila proxy memintanya</p>
                  </div>
                  <a href={proxyFileUrl} download="ipaw-offline-proxy.ps1">
                    <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto border-sky-400 text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:border-sky-600 dark:hover:bg-sky-950">
                      <Download className="w-5 h-5" /> Download PS1
                    </Button>
                  </a>
                </CardContent>
              </Card>

              <Card className="border-violet-300/60 bg-violet-50/60 dark:border-violet-700/40 dark:bg-violet-950/20">
                <CardContent className="p-5 flex flex-col sm:flex-row items-center gap-4">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <FileCode2 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                      <span className="font-semibold text-base">BackupCloudSpreadsheet.txt</span>
                      <Badge variant="outline" className="text-xs border-violet-400 text-violet-700 dark:text-violet-300">Google Apps Script</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">Kode lengkap untuk Cloud Backup/Restore IPAW di Google Apps Script</p>
                    <p className="text-xs text-muted-foreground">Salin seluruh isi file ke project Google Apps Script, lalu deploy sebagai Web App.</p>
                  </div>
                  <a href={gasFileUrl} download="BackupCloudSpreadsheet.txt">
                    <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto border-violet-400 text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:border-violet-600 dark:hover:bg-violet-950">
                      <Download className="w-5 h-5" /> Download GAS
                    </Button>
                  </a>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-none border-border">
              <CardHeader className="py-3 px-4 bg-muted/40 border-b border-border rounded-t-lg">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Info className="w-4 h-4" /> Cara Menggunakan
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</div>
                    <p className="text-sm">{step}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="shadow-none border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
              <CardContent className="p-4 space-y-3">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" /> Apa yang dilakukan file .bat?
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  File <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">buka-ipaw-offline.bat</code> membuka Chrome dengan flag{' '}
                  <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">--disable-web-security</code> dan profil browser terpisah khusus untuk aplikasi ini.
                </p>
                <ul className="text-sm text-amber-700 dark:text-amber-400 space-y-1.5">
                  {[
                    'Gunakan window Chrome ini hanya untuk IP Admission Workspace — jangan untuk browsing internet.',
                    'Profil Chrome khusus dibuat di folder Temp, tidak akan mempengaruhi profil Chrome utama Anda.',
                    'File .bat hanya berjalan di Windows. Di Mac/Linux, gunakan file HTML langsung (tanpa TrakCare sync).',
                    'Jika Chrome tidak ditemukan otomatis, edit baris CHROME= di dalam file .bat sesuai lokasi instalasi.',
                  ].map((note, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /><span>{note}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="shadow-none border-border bg-muted/30">
              <CardContent className="p-4 space-y-2">
                <p className="text-sm font-semibold flex items-center gap-1.5"><Info className="w-4 h-4" /> Catatan Umum</p>
                <ul className="text-sm text-muted-foreground space-y-1.5">
                  {[
                    'Data pasien tersimpan di browser komputer tersebut (IndexedDB), tidak ikut di file HTML.',
                    'Gunakan fitur Backup & Restore di tab Backup & Restore untuk memindahkan data antar komputer.',
                    'Gunakan Google Chrome atau Microsoft Edge — jangan Internet Explorer.',
                  ].map((note, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" /><span>{note}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {activeTab === 'sinkronisasi' && isSuperuser && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="w-5 h-5 text-blue-500" /> Pengaturan Auto Sinkronisasi TrakCare
              </CardTitle>
              <CardDescription>
                Atur interval sinkronisasi otomatis data pasien dari TrakCare. Sinkronisasi manual tetap tersedia dari halaman Pasien Rawat Inap.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 max-w-md">
              <div className="space-y-3">
                <label className="text-sm font-semibold">Interval Sinkronisasi Otomatis</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'manual', label: 'Manual saja' },
                    { value: '5', label: 'Setiap 5 menit' },
                    { value: '10', label: 'Setiap 10 menit' },
                    { value: '15', label: 'Setiap 15 menit' },
                    { value: '30', label: 'Setiap 30 menit' },
                    { value: '60', label: 'Setiap 1 jam' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAutoSyncInterval(opt.value)}
                      className={`py-2.5 px-3 rounded-lg border-2 text-sm font-medium transition-all text-left ${
                        autoSyncInterval === opt.value
                          ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                          : 'bg-background border-border text-foreground hover:border-blue-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {autoSyncInterval !== 'manual' && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-700 dark:text-blue-300">
                  <b>Auto Sync Aktif</b> — Aplikasi akan otomatis mengambil data dari TrakCare setiap <b>{autoSyncInterval} menit</b> selama halaman Pasien Rawat Inap terbuka.
                </div>
              )}

              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-400">
                <b>Catatan:</b> Auto sync hanya aktif saat halaman Pasien Rawat Inap sedang dibuka. Data manual tidak akan terpengaruh oleh sinkronisasi otomatis.
              </div>

              <Button onClick={handleSaveSyncSettings} disabled={savingSync} className="gap-2">
                <Save className="w-4 h-4" />
                {savingSync ? 'Menyimpan...' : 'Simpan Pengaturan'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Endpoint TrakCare</CardTitle>
              <CardDescription>URL sumber data yang sedang digunakan untuk sinkronisasi dan monitoring.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Rawat Inap (Sinkronisasi)', value: epInpatient },
                { label: 'IGD (Monitoring SPRI)', value: epIGD },
                { label: 'Medical Discharge', value: epMedical },
                { label: 'Nurse Discharge', value: epNurse },
                { label: 'Pharmacy Discharge', value: epPharmacy },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground mb-1">{label}</p>
                  <div className="bg-muted rounded-lg px-4 py-2 font-mono text-xs break-all text-muted-foreground">{value}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          {user?.role === 'superuser' && (
            <Card className="border-primary/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-primary" /> Konfigurasi URL Endpoint
                  <Badge variant="secondary" className="ml-1">Superuser</Badge>
                </CardTitle>
                <CardDescription>
                  Sesuaikan URL sumber data TrakCare. Kosongkan untuk menggunakan nilai default.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 max-w-2xl">
                {[
                  { label: 'URL Rawat Inap (Sinkronisasi Pasien)', val: epInpatient, set: setEpInpatient, def: DEFAULT_EP.inpatient },
                  { label: 'URL IGD (Monitoring Pasien SPRI)', val: epIGD, set: setEpIGD, def: DEFAULT_EP.igd },
                  { label: 'URL Medical Discharge', val: epMedical, set: setEpMedical, def: DEFAULT_EP.medicalDischarge },
                  { label: 'URL Nurse Discharge', val: epNurse, set: setEpNurse, def: DEFAULT_EP.nurseDischarge },
                  { label: 'URL Pharmacy Discharge', val: epPharmacy, set: setEpPharmacy, def: DEFAULT_EP.pharmacyDischarge },
                ].map(({ label, val, set, def }) => (
                  <div key={label} className="space-y-1.5">
                    <label className="text-sm font-semibold">{label}</label>
                    <div className="flex gap-2">
                      <Input
                        value={val}
                        onChange={e => set(e.target.value)}
                        placeholder={def}
                        className="font-mono text-xs"
                      />
                      <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => set(def)}>
                        Reset
                      </Button>
                    </div>
                  </div>
                ))}
                <Button onClick={handleSaveEndpoints} disabled={savingEndpoints} className="gap-2 mt-2">
                  <Save className="w-4 h-4" />
                  {savingEndpoints ? 'Menyimpan...' : 'Simpan URL Endpoint'}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'integrasiTrakCare' && isSuperuser && (
        <div className="space-y-6 max-w-3xl">
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-primary" /> Integrasi TrakCare
              </CardTitle>
              <CardDescription>
                Konfigurasi login dan sumber data Dashboard → Pasien Rencana Tindakan. Password disimpan lokal di browser dan tidak ditulis ke source code.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-semibold">URL Endpoint</label>
                <Input
                  value={operatingTheatreConfig.endpoint}
                  readOnly
                  placeholder={DEFAULT_OPERATING_THEATRE_CONFIG.endpoint}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Sumber pasien rencana tindakan dikunci ke URL dashboard OT resmi.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Username</label>
                  <Input
                    value={operatingTheatreConfig.username}
                    onChange={event => updateOperatingTheatreConfig('username', event.target.value)}
                    autoComplete="username"
                    placeholder="Username TrakCare"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Password</label>
                  <Input
                    type="password"
                    value={operatingTheatreConfig.password}
                    onChange={event => updateOperatingTheatreConfig('password', event.target.value)}
                    autoComplete="current-password"
                    placeholder="Password TrakCare"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold">Interval Auto Refresh</label>
                <select
                  value={operatingTheatreConfig.refreshInterval}
                  onChange={event => updateOperatingTheatreConfig('refreshInterval', event.target.value as OperatingTheatreRefreshInterval)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="manual">Manual</option>
                  <option value="30">30 detik</option>
                  <option value="60">60 detik</option>
                  <option value="120">2 menit</option>
                </select>
              </div>
              <div className="grid gap-3">
                {[
                  { key: 'soundEnabled' as const, label: 'Aktifkan suara notifikasi pasien baru' },
                  { key: 'popupEnabled' as const, label: 'Tampilkan popup pasien baru' },
                ].map(option => (
                  <label key={option.key} className="flex items-center justify-between gap-4 rounded-lg border p-3 cursor-pointer">
                    <span className="text-sm font-medium">{option.label}</span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={operatingTheatreConfig[option.key]}
                      onChange={event => updateOperatingTheatreConfig(option.key, event.target.checked)}
                    />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void handleTestOperatingTheatreConnection()} disabled={testingOperatingTheatre} className="gap-2">
                  {testingOperatingTheatre ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {testingOperatingTheatre ? 'Menguji...' : 'Test Connection'}
                </Button>
                <Button onClick={() => void handleSaveOperatingTheatreConfig()} disabled={savingOperatingTheatre} className="gap-2">
                  <Save className="w-4 h-4" />
                  {savingOperatingTheatre ? 'Menyimpan...' : 'Simpan'}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-none bg-muted/20">
            <CardContent className="p-4 text-sm text-muted-foreground space-y-2">
              <p className="font-semibold text-foreground">Catatan koneksi</p>
              <p>Session TrakCare dikelola otomatis oleh proxy saat aplikasi web berjalan. Jika session habis, sistem akan login ulang saat refresh berikutnya.</p>
              <p>Jika aplikasi dibuka offline melalui launcher jaringan internal, browser mencoba akses langsung ke endpoint TrakCare.</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Post-Restore Dialog */}
      <Dialog open={postRestoreOpen} onOpenChange={() => {}}>
        <DialogContent className="max-w-md" onPointerDownOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-5 h-5" /> Restore Berhasil
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 space-y-2">
              <div className="flex items-start gap-2">
                <PackageOpen className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800 dark:text-amber-300">
                    <strong>Backup Excel terbaru menyertakan seluruh master</strong>, termasuk Master Tarif dan Master Item.
                  Silakan upload kembali data berikut:
                </p>
              </div>
              <ul className="pl-7 text-sm text-amber-700 dark:text-amber-400 space-y-1">
                {postRestoreMissingTarif && (
                  <li className="flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" /> Master Tarif belum tersedia
                  </li>
                )}
                {postRestoreMissingItem && (
                  <li className="flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" /> Master Item belum tersedia
                  </li>
                )}
              </ul>
            </div>

            <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3 space-y-1">
              <p>• Dashboard, Operan, Pengaturan, dan menu lainnya tetap dapat digunakan.</p>
              <p>• Menu Billing Checker dan Buat CP akan menampilkan peringatan apabila Master Tarif atau Master Item belum diupload.</p>
              <p>• Setelah upload selesai, seluruh fitur akan kembali aktif tanpa restore ulang.</p>
            </div>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            {(postRestoreMissingTarif || postRestoreMissingItem) && (
              <Button
                onClick={() => {
                  sessionStorage.setItem('ipaw_post_restore_tab', 'masterTarif');
                  setPostRestoreOpen(false);
                  setTimeout(() => window.location.reload(), 100);
                }}
                className="gap-2"
              >
                <FileSpreadsheet className="w-4 h-4" />
                {postRestoreMissingTarif && postRestoreMissingItem
                  ? 'Upload Master Tarif & Item'
                  : postRestoreMissingTarif
                  ? 'Upload Master Tarif'
                  : 'Upload Master Item'}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setPostRestoreOpen(false);
                setTimeout(() => window.location.reload(), 100);
              }}
            >
              Lewati
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Nama Modal */}
      <Dialog open={isEditNameOpen} onOpenChange={setIsEditNameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah Nama Pengguna</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditName} className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Username</label>
              <Input value={editNameTarget?.username ?? ''} disabled />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Nama Lengkap Baru</label>
              <Input value={editNameValue} onChange={e => setEditNameValue(e.target.value)} required placeholder="Masukkan nama lengkap baru" />
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsEditNameOpen(false)}>Batal</Button>
              <Button type="submit">Simpan Nama</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add User Modal */}
      <Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah Pengguna Baru</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddUser} className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Username</label>
              <Input value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Nama Lengkap</label>
              <Input value={newUser.namaLengkap} onChange={e => setNewUser({...newUser, namaLengkap: e.target.value})} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Password</label>
              <Input type="password" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Konfirmasi Password</label>
              <Input type="password" value={newUser.confirmPassword} onChange={e => setNewUser({...newUser, confirmPassword: e.target.value})} required placeholder="Ulangi password" />
              {newUser.confirmPassword && newUser.password !== newUser.confirmPassword && (
                <p className="text-xs text-destructive">Password tidak cocok</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Role</label>
              <select className="w-full h-10 px-3 rounded-md border border-input bg-background" value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})}>
                <option value="officer">Officer</option>
                <option value="superuser">Superuser / Admin</option>
              </select>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsAddUserOpen(false)}>Batal</Button>
              <Button type="submit">Simpan User</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteUserTarget)}
        onOpenChange={open => {
          if (!open && !deletingUser) setDeleteUserTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Hapus user?
            </AlertDialogTitle>
            <AlertDialogDescription>
              User <strong>{deleteUserTarget?.username}</strong> ({deleteUserTarget?.namaLengkap}) akan dihapus permanen
              dari Master User pada perangkat ini dan disinkronkan ke cloud. Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label htmlFor="delete-user-password" className="text-sm font-semibold">
              Password superuser Anda
            </label>
            <Input
              id="delete-user-password"
              type="password"
              value={deleteUserPassword}
              onChange={event => setDeleteUserPassword(event.target.value)}
              placeholder="Masukkan password Anda"
              autoComplete="current-password"
              disabled={deletingUser}
              onKeyDown={event => {
                if (event.key === 'Enter' && deleteUserPassword) {
                  event.preventDefault();
                  void handleDeleteUser();
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              Masukkan password akun superuser yang sedang Anda gunakan untuk melanjutkan.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingUser}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={event => {
                event.preventDefault();
                void handleDeleteUser();
              }}
              disabled={deletingUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingUser ? 'Menghapus...' : 'Ya, Hapus User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: any) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-2 px-6 py-3 border-b-2 font-medium transition-colors ${active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'}`}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}
