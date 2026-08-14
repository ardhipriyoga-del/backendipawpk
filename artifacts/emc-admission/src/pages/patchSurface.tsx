import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Puzzle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPatchMenus, subscribeToPatchChanges, type PatchMenuItem } from '../lib/patchManager';

export default function PatchSurface() {
  const [location, navigate] = useLocation();
  const [menus, setMenus] = useState<PatchMenuItem[]>(() => getPatchMenus());
  useEffect(() => subscribeToPatchChanges(() => setMenus(getPatchMenus())), []);
  const current = menus.find(menu => menu.path === location);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Puzzle className="h-5 w-5 text-primary" />{current?.label ?? 'Patch Feature'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{current?.description ?? 'Menu patch ini sudah tidak aktif atau belum terdaftar.'}</p>
          <p className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
            Ini adalah area fitur yang didaftarkan oleh patch. Patch Demo menampilkan menu ini untuk membuktikan bahwa Patch Manager dapat mengaktifkan dan menonaktifkan modul tanpa mengubah IPAW Core.
          </p>
          <Button variant="outline" className="gap-2" onClick={() => navigate('/settings')}><ArrowLeft className="h-4 w-4" /> Kembali ke Pengaturan</Button>
        </CardContent>
      </Card>
    </div>
  );
}
