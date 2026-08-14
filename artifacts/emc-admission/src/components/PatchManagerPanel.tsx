import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileCode2,
  History,
  Loader2,
  Package,
  Play,
  Power,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '../lib/utils';
import {
  DEMO_PATCH_PAYLOAD,
  PATCH_TEMPLATE,
  disablePatch,
  enablePatch,
  installPatch,
  listPatchActivityLogs,
  listPatchRegistry,
  prepareDemoPatchDownload,
  preparePatchDownload,
  rollbackPatch,
  subscribeToPatchChanges,
  uninstallPatch,
  validatePatchFile,
  type PatchActivityLog,
  type PatchFilePayload,
  type PatchRegistryEntry,
  type PatchValidationResult,
} from '../lib/patchManager';

function statusLabel(status: PatchRegistryEntry['status']): string {
  if (status === 'active') return 'Active';
  if (status === 'disabled') return 'Disabled';
  return 'Error';
}

function statusClass(status: PatchRegistryEntry['status']): string {
  if (status === 'active') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
  if (status === 'disabled') return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300';
}

export default function PatchManagerPanel({ isSuperuser }: { isSuperuser: boolean }) {
  const [patches, setPatches] = useState<PatchRegistryEntry[]>([]);
  const [logs, setLogs] = useState<PatchActivityLog[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<PatchValidationResult | null>(null);
  const [previewPayload, setPreviewPayload] = useState<PatchFilePayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    const [nextPatches, nextLogs] = await Promise.all([listPatchRegistry(), listPatchActivityLogs()]);
    setPatches(nextPatches);
    setLogs(nextLogs);
  };

  useEffect(() => {
    void refresh();
    return subscribeToPatchChanges(() => void refresh());
  }, []);

  const latestLogs = useMemo(() => logs.slice(0, 12), [logs]);

  const selectPatchFile = async (file: File | undefined) => {
    setSelectedFile(file ?? null);
    setValidation(null);
    setPreviewPayload(null);
    if (!file) return;
    setBusy('validate');
    try {
      const result = await validatePatchFile(file);
      setValidation(result);
      if (result.valid && result.payload) setPreviewPayload(result.payload);
      else toast.error(result.errors[0] ?? 'Patch tidak valid.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Validasi patch gagal.');
    } finally {
      setBusy(null);
    }
  };

  const installSelected = async () => {
    if (!previewPayload || !validation?.valid) return;
    setBusy('install');
    const result = await installPatch(previewPayload);
    setBusy(null);
    if (result.ok) {
      toast.success(result.message);
      setSelectedFile(null);
      setValidation(null);
      setPreviewPayload(null);
      await refresh();
    } else {
      toast.error(result.message);
      await refresh();
    }
  };

  const installDemo = async () => {
    setBusy('demo');
    const result = await installPatch(DEMO_PATCH_PAYLOAD);
    setBusy(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
    await refresh();
  };

  const runAction = async (id: string, action: 'enable' | 'disable' | 'rollback' | 'uninstall') => {
    if (!isSuperuser) {
      toast.error('Hanya superuser yang dapat mengubah status patch.');
      return;
    }
    const entry = patches.find(patch => patch.id === id);
    if (!entry) return;
    const labels = { enable: 'mengaktifkan', disable: 'menonaktifkan', rollback: 'rollback', uninstall: 'menghapus' };
    if (!window.confirm(`Yakin ingin ${labels[action]} patch "${entry.manifest.name}"?`)) return;
    setBusy(`${action}:${id}`);
    const result = action === 'enable'
      ? await enablePatch(id)
      : action === 'disable'
      ? await disablePatch(id)
      : action === 'rollback'
      ? await rollbackPatch(id)
      : await uninstallPatch(id);
    setBusy(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
    await refresh();
  };

  const downloadTemplate = async () => {
    await preparePatchDownload(PATCH_TEMPLATE, 'ipaw-patch-template.ipawpatch');
    toast.success('Template patch berhasil diunduh.');
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <Card className="border-primary/25 bg-gradient-to-br from-primary/[0.06] via-background to-background">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            IPAW Patch Manager
            <Badge variant="secondary" className="ml-1">Offline First</Badge>
          </CardTitle>
          <CardDescription>
            Tambahkan fitur secara modular melalui file <code>.ipawpatch</code> tanpa mengganti aplikasi inti.
            Patch berjalan dalam namespace storage sendiri dan tidak dapat mengakses data pasien secara langsung.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-background/80 p-4">
            <ShieldCheck className="mb-2 h-5 w-5 text-emerald-600" />
            <p className="text-sm font-semibold">Validasi berlapis</p>
            <p className="mt-1 text-xs text-muted-foreground">Manifest, versi, dependency, checksum, dan pemeriksaan code.</p>
          </div>
          <div className="rounded-xl border bg-background/80 p-4">
            <RotateCcw className="mb-2 h-5 w-5 text-sky-600" />
            <p className="text-sm font-semibold">Backup & rollback</p>
            <p className="mt-1 text-xs text-muted-foreground">Backup dibuat sebelum install, update, perubahan status, dan uninstall.</p>
          </div>
          <div className="rounded-xl border bg-background/80 p-4">
            <History className="mb-2 h-5 w-5 text-violet-600" />
            <p className="text-sm font-semibold">Audit aktivitas</p>
            <p className="mt-1 text-xs text-muted-foreground">Setiap aksi patch tercatat di perangkat dan audit log IPAW.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-primary" /> Upload Patch</CardTitle>
          <CardDescription>
            Alur instalasi: upload → validasi → preview → backup → install → activate.
            {isSuperuser ? ' Hanya superuser yang dapat menginstall patch.' : ' Mode officer hanya dapat melihat registry dan log.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSuperuser ? (
            <>
              <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/30 bg-primary/[0.03] px-4 text-center transition-colors hover:border-primary/60 hover:bg-primary/[0.06]">
                <FileCode2 className="mb-2 h-7 w-7 text-primary" />
                <span className="text-sm font-semibold">{selectedFile?.name ?? 'Pilih file .ipawpatch'}</span>
                <span className="mt-1 text-xs text-muted-foreground">Format patch adalah JSON dan dapat dibuat dari template.</span>
                <Input type="file" accept=".ipawpatch,application/json" className="hidden" onChange={event => void selectPatchFile(event.target.files?.[0])} />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="gap-2" onClick={() => void downloadTemplate()}>
                  <Download className="h-4 w-4" /> Download Patch Template
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => void prepareDemoPatchDownload()}>
                  <Play className="h-4 w-4" /> Download Patch Demo
                </Button>
                <Button variant="secondary" className="gap-2" onClick={() => void installDemo()} disabled={busy === 'demo'}>
                  {busy === 'demo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Install Demo Langsung
                </Button>
                {busy === 'validate' && <span className="inline-flex items-center gap-2 px-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Memvalidasi...</span>}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-200">
              Officer dapat melihat status patch dan riwayat aktivitas. Instalasi, perubahan status, rollback, dan uninstall memerlukan superuser.
            </div>
          )}

          {validation && (
            <div className={`rounded-xl border p-4 ${validation.valid ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20' : 'border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/20'}`}>
              <div className="flex items-start gap-3">
                {validation.valid ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />}
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <p className="font-semibold">{validation.valid ? 'Patch valid dan siap dipreview' : 'Patch ditolak oleh validator'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{selectedFile?.name}</p>
                  </div>
                  {validation.errors.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-red-700 dark:text-red-300">{validation.errors.map(error => <li key={error}>{error}</li>)}</ul>}
                  {validation.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-700 dark:text-amber-300">{validation.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
                  {validation.valid && previewPayload && (
                    <div className="rounded-lg border bg-background/80 p-3 text-xs">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <span><strong>ID:</strong> {previewPayload.manifest.id}</span>
                        <span><strong>Versi:</strong> {previewPayload.manifest.version}</span>
                        <span><strong>Author:</strong> {previewPayload.manifest.author}</span>
                        <span><strong>Checksum:</strong> <code className="break-all">{previewPayload.checksum}</code></span>
                      </div>
                      <p className="mt-2 text-muted-foreground">{previewPayload.manifest.description}</p>
                      <pre className="mt-3 max-h-44 overflow-auto rounded-md bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">{previewPayload.code}</pre>
                    </div>
                  )}
                  {validation.valid && isSuperuser && <Button className="gap-2" onClick={() => void installSelected()} disabled={busy === 'install'}>{busy === 'install' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Backup & Install</Button>}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Patch Registry</CardTitle>
          <CardDescription>Daftar patch yang tersimpan di IndexedDB perangkat ini.</CardDescription>
        </CardHeader>
        <CardContent>
          {patches.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Belum ada patch terpasang. Unduh dan upload Patch Demo untuk mencoba alurnya.</div>
          ) : (
            <div className="space-y-3">
              {patches.map(entry => (
                <div key={entry.id} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{entry.manifest.name}</p>
                        <Badge className={statusClass(entry.status)}>{statusLabel(entry.status)}</Badge>
                        <span className="text-xs text-muted-foreground">v{entry.manifest.version}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{entry.manifest.description}</p>
                      <p className="mt-2 text-[11px] text-muted-foreground">ID: <code>{entry.id}</code> · Author: {entry.manifest.author} · Dipasang: {formatDateTime(entry.installedAt)}</p>
                      {entry.lastError && <p className="mt-2 text-xs text-red-600">Error: {entry.lastError}</p>}
                    </div>
                    {isSuperuser && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {entry.status === 'active' ? (
                          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy === `disable:${entry.id}`} onClick={() => void runAction(entry.id, 'disable')}><Power className="h-3.5 w-3.5" /> Disable</Button>
                        ) : (
                          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy === `enable:${entry.id}`} onClick={() => void runAction(entry.id, 'enable')}><Power className="h-3.5 w-3.5" /> Enable</Button>
                        )}
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void runAction(entry.id, 'rollback')}><RotateCcw className="h-3.5 w-3.5" /> Rollback</Button>
                        <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => void runAction(entry.id, 'uninstall')}><Trash2 className="h-3.5 w-3.5" /> Uninstall</Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" /> Patch Activity Log</CardTitle>
          <CardDescription>Riwayat install, update, status, rollback, dan uninstall patch.</CardDescription>
        </CardHeader>
        <CardContent>
          {latestLogs.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada aktivitas patch.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr><th className="p-3">Waktu</th><th className="p-3">Patch</th><th className="p-3">Aksi</th><th className="p-3">Status</th><th className="p-3">User</th><th className="p-3">Detail</th></tr>
                </thead>
                <tbody>
                  {latestLogs.map(log => <tr key={`${log.timestamp}-${log.patchId}-${log.action}`} className="border-b last:border-0"><td className="whitespace-nowrap p-3 text-xs">{formatDateTime(log.timestamp)}</td><td className="p-3 font-medium">{log.patchName}<div className="text-[11px] text-muted-foreground">v{log.version}</div></td><td className="p-3">{log.action}</td><td className="p-3"><Badge variant={log.status === 'Failed' ? 'destructive' : 'secondary'}>{log.status}</Badge></td><td className="p-3 text-xs">{log.namaUser}</td><td className="max-w-xs p-3 text-xs text-muted-foreground">{log.detail}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
