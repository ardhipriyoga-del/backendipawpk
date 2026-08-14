import React from 'react';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import { useHashLocation } from './lib/hashLocation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from 'next-themes';

import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import { Layout } from './components/Layout';

import Login from './pages/login';
import Dashboard from './pages/dashboard';
import Patients from './pages/patients';
import PendingPage from './pages/pending';
import History from './pages/history';
import ImportPage from './pages/import';
import Reports from './pages/reports';
import Settings from './pages/settings';
import About from './pages/about';
import KasirPage from './pages/kasir';
import DownloadPage from './pages/download';
import MasterTarifPage from './pages/masterTarif';
import SyncHistoryPage from './pages/syncHistory';
import PanduanPage from './pages/panduan';
import CloudBackupPage from './pages/cloudBackup';
import ActivityLogPage from './pages/activityLog';
import MonitoringKtmPage from './pages/monitoringKtm';
import BillingCheckerPage from './pages/billingChecker';
import BillingRuleSettings from './pages/billingRuleSettings';
import IGDWardPage from './pages/igdWard';
import EstimasiBiayaTindakanPage from './pages/estimasiBiayaTindakan';
import OperatingTheatreDashboard from './pages/operatingTheatreDashboard';
import ChecklistPasienPage from './pages/checklistPasien';
import PatchSurface from './pages/patchSurface';
import MailAsuransiPage from './pages/mailAsuransi';
import NotFound from './pages/not-found';
import GlobalNotificationMonitor from './components/GlobalNotificationMonitor';
import { canAccessPath, type AppRole } from './lib/accessControl';
import { hydrateRouteData } from './lib/dataRepository';
import { isLocalFirstMode } from './lib/storageMode';
import { initializeActivePatches } from './lib/patchManager';
import { Database, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const queryClient = new QueryClient();

function AccessDenied({ role }: { role: AppRole }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-lg rounded-xl border bg-card p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Akses dibatasi</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Role <strong>{role}</strong> tidak memiliki kewenangan untuk membuka modul ini.
          Hubungi superuser bila akses diperlukan untuk tugas resmi.
        </p>
      </div>
    </div>
  );
}

function ProtectedRoute({ path, children }: { path: string; children: React.ReactNode }) {
  const { user, isInitialized } = useAuth();
  const [hydrating, setHydrating] = React.useState(false);
  const [usedLocalFallback, setUsedLocalFallback] = React.useState(false);

  React.useEffect(() => {
    if (!user || !isInitialized) return;
    if (isLocalFirstMode()) {
      setHydrating(false);
      setUsedLocalFallback(false);
      return;
    }
    let active = true;
    setHydrating(true);
    void hydrateRouteData(path)
      .then(result => {
        if (!active) return;
        setUsedLocalFallback(result.unavailableStores.length > 0);
        if (result.unavailableStores.length > 0) {
          toast.info('Sebagian data Cloud tidak tersedia. Menu menggunakan cache lokal untuk data tersebut.', {
            id: `cloud-fallback:${path}`,
          });
        }
      })
      .catch(error => {
        if (!active) return;
        console.warn(`[CloudRouteHydration] ${path} failed:`, error);
        setUsedLocalFallback(true);
      })
      .finally(() => {
        if (active) {
          setHydrating(false);
        }
      });
    return () => {
      active = false;
    };
  }, [path, user, isInitialized]);

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Memuat aplikasi...</p>
        </div>
      </div>
    );
  }
  if (!user) return <Redirect to="/login" />;
  return (
    <Layout>
      {hydrating && (
        <div className="mx-4 mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
          Menyelaraskan data Cloud di latar belakang...
        </div>
      )}
      {usedLocalFallback && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <Database className="h-3.5 w-3.5 shrink-0" />
          Sebagian data menu ini berasal dari cache lokal karena Cloud tidak tersedia.
        </div>
      )}
      {canAccessPath(user.role, path) ? children : <AccessDenied role={user.role} />}
    </Layout>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <ProtectedRoute path="/"><Dashboard /></ProtectedRoute>
      </Route>
      <Route path="/patients">
        <ProtectedRoute path="/patients"><Patients /></ProtectedRoute>
      </Route>
      <Route path="/mail-asuransi">
        <ProtectedRoute path="/mail-asuransi"><MailAsuransiPage /></ProtectedRoute>
      </Route>
      <Route path="/pending">
        <ProtectedRoute path="/pending"><PendingPage /></ProtectedRoute>
      </Route>
      <Route path="/history">
        <ProtectedRoute path="/history"><History /></ProtectedRoute>
      </Route>
      <Route path="/import">
        <ProtectedRoute path="/import"><ImportPage /></ProtectedRoute>
      </Route>
      <Route path="/reports">
        <ProtectedRoute path="/reports"><Reports /></ProtectedRoute>
      </Route>
      <Route path="/settings">
        <ProtectedRoute path="/settings"><Settings /></ProtectedRoute>
      </Route>
      <Route path="/about">
        <ProtectedRoute path="/about"><About /></ProtectedRoute>
      </Route>
      <Route path="/kasir">
        <ProtectedRoute path="/kasir"><KasirPage /></ProtectedRoute>
      </Route>
      <Route path="/kasir/notifikasi-billing">
        <ProtectedRoute path="/kasir/notifikasi-billing"><KasirPage section="notifikasi" /></ProtectedRoute>
      </Route>
      <Route path="/kasir/ktm">
        <ProtectedRoute path="/kasir/ktm"><KasirPage section="ktm" /></ProtectedRoute>
      </Route>
      <Route path="/download">
        <ProtectedRoute path="/download"><DownloadPage /></ProtectedRoute>
      </Route>
      <Route path="/master-tarif">
        <ProtectedRoute path="/master-tarif"><MasterTarifPage /></ProtectedRoute>
      </Route>
      <Route path="/sync-history">
        <ProtectedRoute path="/sync-history"><SyncHistoryPage /></ProtectedRoute>
      </Route>
      <Route path="/panduan">
        <ProtectedRoute path="/panduan"><PanduanPage /></ProtectedRoute>
      </Route>
      <Route path="/cloud-backup">
        <ProtectedRoute path="/cloud-backup"><CloudBackupPage /></ProtectedRoute>
      </Route>
      <Route path="/activity-log">
        <ProtectedRoute path="/activity-log"><ActivityLogPage /></ProtectedRoute>
      </Route>
      <Route path="/monitoring-ktm">
        <ProtectedRoute path="/monitoring-ktm"><MonitoringKtmPage /></ProtectedRoute>
      </Route>
      <Route path="/billing-checker">
        <ProtectedRoute path="/billing-checker"><BillingCheckerPage /></ProtectedRoute>
      </Route>
      <Route path="/master-rule-billing">
        <ProtectedRoute path="/master-rule-billing"><BillingRuleSettings /></ProtectedRoute>
      </Route>
      <Route path="/igd-ward">
        <ProtectedRoute path="/igd-ward"><IGDWardPage /></ProtectedRoute>
      </Route>
      <Route path="/estimasi-biaya-tindakan">
        <ProtectedRoute path="/estimasi-biaya-tindakan"><EstimasiBiayaTindakanPage /></ProtectedRoute>
      </Route>
      <Route path="/pasien-rencana-tindakan">
        <ProtectedRoute path="/pasien-rencana-tindakan"><OperatingTheatreDashboard /></ProtectedRoute>
      </Route>
      <Route path="/pasien-preadmission/masuk-hari-ini">
        <ProtectedRoute path="/pasien-preadmission/masuk-hari-ini">
          <OperatingTheatreDashboard initialTab="preadmission" standalonePreadmission preadmissionDueTodayOnly />
        </ProtectedRoute>
      </Route>
      <Route path="/pasien-preadmission">
        <ProtectedRoute path="/pasien-preadmission"><OperatingTheatreDashboard initialTab="preadmission" standalonePreadmission /></ProtectedRoute>
      </Route>
      <Route path="/checklist-pasien">
        <ProtectedRoute path="/checklist-pasien"><ChecklistPasienPage /></ProtectedRoute>
      </Route>
      <Route path="/patch/:patchId/:feature">
        <ProtectedRoute path="/patch/:patchId/:feature"><PatchSurface /></ProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  React.useEffect(() => {
    void initializeActivePatches();
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppProvider>
            <WouterRouter hook={useHashLocation}>
              <AuthProvider>
                <GlobalNotificationMonitor />
                <AppRouter />
              </AuthProvider>
            </WouterRouter>
          </AppProvider>
          <Toaster
            richColors
            closeButton
            position="top-right"
            visibleToasts={4}
            expand={false}
            duration={6500}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
