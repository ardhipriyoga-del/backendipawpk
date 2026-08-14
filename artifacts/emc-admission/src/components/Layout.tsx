import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../context/AuthContext';
import { useAppContext } from '../context/AppContext';
import {
  LayoutDashboard, Users, Clock, History,
  FileBarChart, Settings, LogOut, Moon, Sun, Menu, Info, MessageSquare,
  RefreshCw, BookOpen, CloudCog, ClipboardList, Loader2, Bell,
  UserCircle2, UserRound, HelpCircle, ChevronDown, ShieldCheck, Activity, FileSignature, SlidersHorizontal, Hospital,
  CheckCheck, ExternalLink, VolumeX, X, Clock3, CheckCircle2, AlertCircle, HardDrive, Wifi, WifiOff, Mail,
  Puzzle,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { stopNotificationSound } from '@/lib/notificationSettings';
import { requestChecklistFilter } from '@/lib/checklistNavigation';
import { canAccessPath } from '@/lib/accessControl';
import { formatDate } from '@/lib/utils';
import {
  clearNotificationHistory,
  getNotificationHistory,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToNotificationChanges,
  type AppNotification,
} from '@/lib/notificationCenter';
import {
  getCloudBackupProgress,
  subscribeToCloudBackupProgress,
  type CloudBackupProgress,
} from '@/lib/cloudSync';
import { getPendingSyncCount } from '@/lib/cloudSync';
import { isLocalFirstMode } from '@/lib/storageMode';
import { getPatchMenus, subscribeToPatchChanges, type PatchMenuItem } from '@/lib/patchManager';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ── Avatar initials helper ────────────────────────────────────────────────────
function getInitials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Role badge colour (subtle)
const ROLE_COLOR: Record<string, string> = {
  admin:   'bg-violet-500',
  dokter:  'bg-blue-500',
  perawat: 'bg-teal-500',
  kasir:   'bg-amber-500',
};
function avatarBg(role: string | undefined): string {
  return ROLE_COLOR[role?.toLowerCase() ?? ''] ?? 'bg-primary';
}

function formatNotificationTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} hari lalu`;
  return formatDate(timestamp);
}

type NavigationItem = {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const notificationCategoryLabel: Record<AppNotification['category'], string> = {
  ktm: 'Monitoring KTM',
  igd: 'IGD Ward',
  'operating-theatre': 'Operating Theatre',
  checklist: 'Checklist Pasien',
  billing: 'Billing Checker',
  pending: 'Pending Operan',
  system: 'Sistem',
};

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, logout, isLoggingOut } = useAuth();
  const { rsName, rsLogo } = useAppContext();
  const { theme, setTheme } = useTheme();
  const [location, navigate] = useLocation();
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [cloudBackupProgress, setCloudBackupProgress] = useState<CloudBackupProgress>(() => getCloudBackupProgress());
  const progressDismissTimer = useRef<number | null>(null);

  const loadNotifications = () => {
    void getNotificationHistory().then(setNotifications).catch(() => setNotifications([]));
  };

  useEffect(() => {
    loadNotifications();
    return subscribeToNotificationChanges(loadNotifications);
  }, []);

  useEffect(() => {
    return subscribeToCloudBackupProgress((progress) => {
      if (progressDismissTimer.current !== null) {
        window.clearTimeout(progressDismissTimer.current);
        progressDismissTimer.current = null;
      }
      setCloudBackupProgress(progress);
      if (progress.status === 'success' || progress.status === 'error') {
        progressDismissTimer.current = window.setTimeout(() => {
          setCloudBackupProgress(getCloudBackupProgress().status === progress.status
            ? { ...getCloudBackupProgress(), status: 'idle', percent: 0, message: '' }
            : getCloudBackupProgress());
          progressDismissTimer.current = null;
        }, 7_000);
      }
    });
  }, []);

  useEffect(() => () => {
    if (progressDismissTimer.current !== null) window.clearTimeout(progressDismissTimer.current);
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter(notification => !notification.readAt).length,
    [notifications],
  );
  const recentNotifications = useMemo(
    () => notifications.slice(0, 5),
    [notifications],
  );
  const backupInProgress = ['preparing', 'uploading', 'committing'].includes(cloudBackupProgress.status);
  const localFirst = isLocalFirstMode();
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [patchMenus, setPatchMenus] = useState<PatchMenuItem[]>(() => getPatchMenus());

  useEffect(() => {
    const refreshPatchMenus = () => setPatchMenus(getPatchMenus());
    refreshPatchMenus();
    return subscribeToPatchChanges(refreshPatchMenus);
  }, []);

  useEffect(() => {
    if (!localFirst) return;
    const refreshPending = () => void getPendingSyncCount().then(setPendingSyncCount).catch(() => {});
    const online = () => setBrowserOnline(true);
    const offline = () => setBrowserOnline(false);
    refreshPending();
    const timer = window.setInterval(refreshPending, 5000);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [localFirst]);

  const openNotification = async (notification: AppNotification) => {
    if (!notification.readAt) await markNotificationRead(notification.id);
    setNotificationOpen(false);
    if (notification.destination) {
      if (notification.category === 'checklist' && notification.destination === '/checklist-pasien') {
        requestChecklistFilter('today');
      }
      navigate(notification.destination);
    }
  };

  const menuGroups: Array<{ label: string; items: NavigationItem[] }> = [
    {
      label: 'Operasional',
      items: [
        { path: '/',               label: 'Dashboard',            icon: LayoutDashboard },
        { path: '/patients',       label: 'Pasien Rawat Inap',    icon: Users },
        { path: '/mail-asuransi',  label: 'Mail Asuransi',        icon: Mail },
        { path: '/pasien-preadmission', label: 'Pasien Preadmission', icon: UserRound },
        { path: '/checklist-pasien', label: 'Checklist Pasien', icon: ClipboardList },
        { path: '/monitoring-ktm', label: 'Monitoring KTM',       icon: Bell },
        { path: '/pasien-rencana-tindakan', label: 'Pasien Rencana Tindakan', icon: Hospital },
        { path: '/pending',        label: 'Pending Operan',       icon: Clock },
        { path: '/kasir',          label: 'Pesan Kasir',          icon: MessageSquare },
        { path: '/billing-checker', label: 'Billing Checker',      icon: ShieldCheck },
        { path: '/igd-ward',        label: 'IGD Ward',             icon: Activity },
         { path: '/estimasi-biaya-tindakan', label: 'Estimasi Biaya Tindakan', icon: FileSignature },
      ],
    },
    {
      label: 'Data',
      items: [
        { path: '/history',         label: 'Riwayat Pasien',       icon: History },
        { path: '/sync-history',    label: 'Riwayat Sinkronisasi', icon: RefreshCw },
        { path: '/reports',         label: 'Laporan',              icon: FileBarChart },
      ],
    },
    {
      label: 'Sistem',
      items: [
        { path: '/cloud-backup',   label: 'Cloud Backup',         icon: CloudCog },
        { path: '/master-rule-billing', label: 'Master Rule Billing', icon: SlidersHorizontal },
        { path: '/activity-log',   label: 'Log Aktivitas',        icon: ClipboardList },
        { path: '/panduan',        label: 'Panduan',              icon: BookOpen },
        { path: '/settings',       label: 'Pengaturan',           icon: Settings },
        { path: '/about',          label: 'Tentang Aplikasi',     icon: Info },
      ],
    },
    ...(patchMenus.length > 0 ? [{
      label: 'Patch Aktif',
      items: patchMenus.map(item => ({ path: item.path, label: item.label, icon: Puzzle })),
    }] : []),
  ];

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside className={`
        ${isSidebarOpen ? 'w-64' : 'w-16'}
        transition-all duration-300 ease-in-out
        bg-sidebar text-sidebar-foreground border-r border-sidebar-border
        flex flex-col shrink-0
      `}>
        {/* Sidebar header — logo + collapse toggle */}
        <div className="h-14 flex items-center justify-between px-3 border-b border-sidebar-border gap-2 shrink-0 bg-sidebar">
          {isSidebarOpen && (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 shrink-0 bg-primary/10 rounded flex items-center justify-center">
                <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
                  <rect x="3" y="10" width="22" height="8" rx="2" fill="hsl(var(--primary))" />
                  <rect x="10" y="3" width="8" height="22" rx="2" fill="hsl(var(--primary))" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="font-bold text-[13px] text-white truncate leading-tight tracking-tight">
                  IP Admission
                </div>
                {rsName && (
                  <div className="text-[10px] text-cyan-100/75 truncate leading-tight uppercase tracking-wider font-semibold mt-0.5">
                    {rsName}
                  </div>
                )}
              </div>
            </div>
          )}
          {!isSidebarOpen && (
            <div className="mx-auto w-8 h-8 flex items-center justify-center bg-primary/10 rounded">
              <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
                <rect x="3" y="10" width="22" height="8" rx="2" fill="hsl(var(--primary))" />
                <rect x="10" y="3" width="8" height="22" rx="2" fill="hsl(var(--primary))" />
              </svg>
            </div>
          )}
          <Button
            variant="ghost" size="icon"
            onClick={() => setSidebarOpen(!isSidebarOpen)}
            className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground shrink-0"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-5 scrollbar-thin">
          {menuGroups.map((group, gi) => {
            const visibleItems = group.items.filter(item => user && canAccessPath(user.role, item.path));
            if (!visibleItems.length) return null;
            return (
            <div key={group.label} className="space-y-1">
              {isSidebarOpen && (
                <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/50 select-none">
                  {group.label}
                </p>
              )}
              {!isSidebarOpen && gi > 0 && (
                <div className="mx-3 my-2 border-t border-sidebar-border" />
              )}
              <div className="space-y-0.5">
                {visibleItems.map(item => {
                  const Icon = item.icon;
                  const isActive =
                    location === item.path ||
                    (item.path !== '/' && location.startsWith(item.path));
                  return (
                    <Link key={item.path} href={item.path}>
                      <div
                        className={`
                          flex items-center gap-2.5 px-3 py-1.5 rounded-sm cursor-pointer transition-all duration-200
                          ${isActive
                            ? 'bg-sidebar-primary text-sidebar-primary-foreground font-semibold shadow-sm'
                            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground font-medium'}
                        `}
                        title={!isSidebarOpen ? item.label : undefined}
                      >
                        <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'opacity-100' : 'opacity-70'}`} />
                        {isSidebarOpen && (
                          <span className="truncate text-[13px]">{item.label}</span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
            );
          })}
        </nav>

        {/* Sidebar bottom — theme toggle only */}
        <div className={`p-3 border-t border-sidebar-border flex ${isSidebarOpen ? 'justify-start' : 'justify-center'}`}>
          <Button
            variant="ghost" size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="text-sidebar-foreground hover:bg-sidebar-accent"
            title={theme === 'dark' ? 'Mode Terang' : 'Mode Gelap'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </aside>

      {/* ── Main area (header + content + footer) ────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 bg-background">

        {/* ── Top header bar ─────────────────────────────────────────────────── */}
        <header className="h-14 shrink-0 border-b border-sidebar-border bg-sidebar text-sidebar-foreground flex items-center justify-between px-5 gap-3 z-10 shadow-sm">
          {localFirst ? (
            <div
              className="flex min-w-0 items-center gap-2 rounded-full bg-sidebar-accent/70 px-3 py-1.5 text-[11px] font-semibold"
              title="Perubahan disimpan ke LocalDB terlebih dahulu. Cloud hanya digunakan sebagai backup."
            >
              {browserOnline ? (
                <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-300" />
              )}
              <span className="hidden truncate sm:inline">
                LocalDB utama
                <span className="ml-1.5 font-normal text-sidebar-foreground/65">
                  · {browserOnline ? 'online' : 'offline'}
                </span>
              </span>
              {pendingSyncCount > 0 && (
                <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">
                  {pendingSyncCount} menunggu backup
                </span>
              )}
            </div>
          ) : <div />}

          <div className="ml-auto flex items-center gap-2">
            {/* Notification center */}
            <Popover open={notificationOpen} onOpenChange={setNotificationOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-sidebar-foreground/80 hover:text-sidebar-accent-foreground relative h-8 w-8 rounded-full bg-sidebar-accent/60 hover:bg-sidebar-accent"
                  title="Riwayat notifikasi"
                  aria-label={`Riwayat notifikasi${unreadCount ? `, ${unreadCount} belum dibaca` : ''}`}
                >
                  <Bell className={`h-[18px] w-[18px] ${unreadCount ? 'animate-[pulse_2s_ease-in-out_infinite]' : ''}`} />
                  {backupInProgress && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 animate-pulse rounded-full border-2 border-sidebar bg-sky-400"
                      title="Backup Cloud sedang berjalan"
                    />
                  )}
                  {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 min-w-4 h-4 px-1 rounded-full bg-amber-400 text-[9px] leading-4 font-bold text-slate-900 shadow-sm">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={10}
                className="w-[min(410px,calc(100vw-24px))] p-0 overflow-hidden rounded-xl shadow-xl"
              >
                <div className="border-b border-border/70 bg-muted/30 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold tracking-tight">Pusat Notifikasi</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {unreadCount ? `${unreadCount} notifikasi belum dibaca` : 'Semua notifikasi sudah dibaca'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title="Hentikan semua suara"
                        aria-label="Hentikan semua suara notifikasi"
                        onClick={stopNotificationSound}
                      >
                        <VolumeX className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title="Tutup panel"
                        aria-label="Tutup panel notifikasi"
                        onClick={() => setNotificationOpen(false)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-7 px-2 text-[11px] text-muted-foreground"
                    onClick={() => void markAllNotificationsRead()}
                    disabled={!unreadCount}
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Tandai semua dibaca
                  </Button>
                  {cloudBackupProgress.status !== 'idle' && (
                    <div className={`mt-3 rounded-lg border px-3 py-2.5 ${
                      cloudBackupProgress.status === 'error'
                        ? 'border-destructive/25 bg-destructive/5'
                        : cloudBackupProgress.status === 'success'
                        ? 'border-emerald-500/25 bg-emerald-500/5'
                        : 'border-sky-500/25 bg-sky-500/5'
                    }`}>
                      <div className="flex items-start gap-2.5">
                        {cloudBackupProgress.status === 'error' ? (
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        ) : cloudBackupProgress.status === 'success' ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        ) : (
                          <CloudCog className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-sky-600" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold">Backup Cloud</p>
                            <span className="text-[11px] font-bold tabular-nums text-muted-foreground">
                              {cloudBackupProgress.percent}%
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                            {cloudBackupProgress.error || cloudBackupProgress.message}
                          </p>
                          <Progress
                            value={cloudBackupProgress.percent}
                            className={`mt-2 h-1.5 ${
                              cloudBackupProgress.status === 'error'
                                ? '[&>div]:bg-destructive'
                                : cloudBackupProgress.status === 'success'
                                ? '[&>div]:bg-emerald-500'
                                : '[&>div]:bg-sky-500'
                            }`}
                            aria-label={`Progres backup Cloud ${cloudBackupProgress.percent}%`}
                          />
                          {cloudBackupProgress.totalChunks > 0 && cloudBackupProgress.status === 'uploading' && (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {cloudBackupProgress.currentChunk} dari {cloudBackupProgress.totalChunks} bagian
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="max-h-[390px] overflow-y-auto p-2">
                  {notifications.length === 0 ? (
                    <div className="px-5 py-10 text-center">
                      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Bell className="h-5 w-5" />
                      </div>
                      <p className="text-sm font-semibold">Belum ada notifikasi</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Peringatan baru akan muncul di sini.
                      </p>
                    </div>
                  ) : (
                    recentNotifications.map(notification => (
                      <button
                        type="button"
                        key={notification.id}
                        className={`group w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 ${
                          notification.readAt ? 'border-transparent' : 'border-primary/20 bg-primary/[0.04]'
                        }`}
                        onClick={() => void openNotification(notification)}
                      >
                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                            notification.priority === 'attention' ? 'bg-amber-500' : 'bg-primary'
                          }`} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              <span className="text-xs font-bold leading-4">{notification.title}</span>
                              {!notification.readAt && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                            </span>
                            <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
                              {notification.description}
                            </span>
                            <span className="mt-2 flex items-center gap-2 text-[10px] font-medium text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <Clock3 className="h-3 w-3" />
                                {formatNotificationTime(notification.createdAt)}
                              </span>
                              <span className="text-border">·</span>
                              <span>{notificationCategoryLabel[notification.category]}</span>
                              {notification.destination && (
                                <ExternalLink className="ml-auto h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                              )}
                            </span>
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
                {notifications.length > 0 && (
                  <div className="flex items-center justify-between border-t border-border/70 px-3 py-2">
                    <span className="text-[10px] text-muted-foreground">
                      Menampilkan {Math.min(notifications.length, 5)} notifikasi terbaru
                      {notifications.length > 5 && ` dari ${notifications.length}`}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
                      onClick={() => void clearNotificationHistory()}
                    >
                      <X className="h-3.5 w-3.5" />
                      Hapus riwayat
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            <div className="h-5 w-px bg-sidebar-border"></div>

            {/* User avatar dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2.5 rounded-full pl-1.5 pr-2 py-1 hover:bg-sidebar-accent/70 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                  {/* Avatar circle */}
                  <span className={`
                    w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 shadow-sm
                    ${avatarBg(user?.role)}
                  `}>
                    {getInitials(user?.namaLengkap)}
                  </span>
                  {/* Name — hidden on small screens */}
                  <span className="hidden sm:flex flex-col items-start leading-none gap-0.5">
                    <span className="text-[13px] font-semibold text-sidebar-foreground truncate max-w-[120px]">
                      {user?.namaLengkap ?? user?.username}
                    </span>
                    <span className="text-[10px] text-sidebar-foreground/70 font-medium uppercase tracking-wider">
                      {user?.role}
                    </span>
                  </span>
                  <ChevronDown className="hidden sm:block h-3.5 w-3.5 text-sidebar-foreground/70" />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="w-52 animate-in fade-in-0 zoom-in-95 duration-150"
              >
                {/* Identity label */}
                <DropdownMenuLabel className="pb-1.5">
                  <p className="font-semibold text-sm truncate">{user?.namaLengkap ?? user?.username}</p>
                  <p className="text-xs text-muted-foreground font-normal capitalize">{user?.role}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={() => navigate('/about')} className="gap-2 cursor-pointer">
                  <UserCircle2 className="h-4 w-4 text-muted-foreground" />
                  Profil
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/settings')} className="gap-2 cursor-pointer">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  Pengaturan
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/panduan')} className="gap-2 cursor-pointer">
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  Bantuan
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => void logout()}
                  disabled={isLoggingOut}
                  className="gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                >
                  {isLoggingOut
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <LogOut className="h-4 w-4" />
                  }
                  {isLoggingOut ? 'Menyimpan...' : 'Keluar'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* ── Page content ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-muted/20">
          {children}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <footer className="h-10 shrink-0 border-t bg-card text-card-foreground flex items-center justify-between px-6 text-[11px] text-muted-foreground font-medium">
          <div className="flex items-center gap-2">
            {rsLogo ? (
              <img src={rsLogo} alt="Logo" className="w-3.5 h-3.5 object-contain grayscale opacity-60" />
            ) : (
              <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-muted-foreground">
                <rect x="6" y="24" width="52" height="16" rx="4" fill="currentColor" />
                <rect x="24" y="6" width="16" height="52" rx="4" fill="currentColor" />
              </svg>
            )}
            <span>© 2026 IP Admission Workspace</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:block">Developed by Dedi Supriadi</span>
            <span className="w-1 h-1 rounded-full bg-border hidden sm:block"></span>
            <span>Version 1.0.0</span>
          </div>
        </footer>
      </main>
    </div>
  );
};
