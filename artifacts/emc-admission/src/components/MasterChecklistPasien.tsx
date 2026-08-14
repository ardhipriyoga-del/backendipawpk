import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ChecklistCondition, ChecklistFieldType, ChecklistMaster } from '../lib/db';
import {
  checklistFieldLabel,
  deleteChecklistMaster,
  ensureDefaultChecklistMasters,
  getChecklistMasters,
  saveChecklistMaster,
} from '../lib/checklist';
import { generateUUID } from '../lib/auth';
import { backupCloud } from '../lib/cloudSync';

const FIELD_TYPES: ChecklistFieldType[] = ['checkbox', 'yesno', 'text', 'textarea', 'number', 'dropdown', 'date', 'time', 'datetime', 'phone'];

type Draft = {
  nama: string;
  tipe: ChecklistFieldType;
  pilihan: string;
  wajib: boolean;
  aktif: boolean;
  reminderAktif: boolean;
  kondisiFieldId: string;
  kondisiValue: string;
};

const EMPTY_DRAFT: Draft = {
  nama: '',
  tipe: 'checkbox',
  pilihan: '',
  wajib: true,
  aktif: true,
  reminderAktif: false,
  kondisiFieldId: '',
  kondisiValue: '',
};

function toDraft(master: ChecklistMaster): Draft {
  return {
    nama: master.nama,
    tipe: master.tipe,
    pilihan: master.pilihan.join('\n'),
    wajib: master.wajib,
    aktif: master.aktif,
    reminderAktif: master.reminderAktif,
    kondisiFieldId: master.kondisi?.fieldId ?? '',
    kondisiValue: master.kondisi?.value ?? '',
  };
}

export default function MasterChecklistPasien() {
  const [masters, setMasters] = useState<ChecklistMaster[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    const rows = await getChecklistMasters();
    setMasters(rows.length ? rows : await ensureDefaultChecklistMasters());
  };

  useEffect(() => { void load(); }, []);

  const reset = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const syncMastersToCloud = async (action: string) => {
    try {
      await backupCloud();
      toast.success(`${action} Master Checklist tersimpan di Cloud.`);
    } catch {
      toast.warning(`${action} tersimpan di browser, tetapi belum tersinkron ke Cloud. Coba Backup Cloud saat koneksi tersedia.`);
    }
  };

  const save = async () => {
    if (!draft.nama.trim()) {
      toast.error('Nama checklist wajib diisi.');
      return;
    }
    const now = Date.now();
    const existing = editingId ? masters.find(master => master.id === editingId) : undefined;
    const condition: ChecklistCondition | undefined = draft.kondisiFieldId && draft.kondisiValue
      ? { fieldId: draft.kondisiFieldId, operator: 'equals', value: draft.kondisiValue }
      : undefined;
    await saveChecklistMaster({
      id: editingId ?? generateUUID(),
      nama: draft.nama.trim(),
      tipe: draft.tipe,
      pilihan: draft.pilihan.split('\n').map(value => value.trim()).filter(Boolean),
      wajib: draft.wajib,
      aktif: draft.aktif,
      urutan: existing?.urutan ?? (masters.length ? Math.max(...masters.map(master => master.urutan)) + 1 : 1),
      reminderAktif: draft.reminderAktif,
      ...(condition ? { kondisi: condition } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    const action = editingId ? 'Perubahan' : 'Checklist baru';
    toast.success(`${action} tersimpan di browser.`);
    reset();
    await load();
    await syncMastersToCloud(action);
  };

  const remove = async (master: ChecklistMaster) => {
    if (!window.confirm(`Hapus checklist "${master.nama}"? Jawaban lama tetap tersimpan, tetapi item ini tidak lagi aktif.`)) return;
    await deleteChecklistMaster(master.id);
    toast.success('Checklist dihapus dari browser.');
    await load();
    await syncMastersToCloud('Penghapusan');
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= masters.length) return;
    const current = masters[index];
    const other = masters[target];
    await saveChecklistMaster({ ...current, urutan: other.urutan });
    await saveChecklistMaster({ ...other, urutan: current.urutan });
    await load();
    await syncMastersToCloud('Perubahan urutan');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Master Checklist Pasien</h2>
        <p className="text-sm text-muted-foreground mt-1">Kelola item checklist yang digunakan oleh seluruh pengguna dan setiap episode pasien.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{editingId ? 'Ubah Checklist' : 'Tambah Checklist'}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5 md:col-span-2"><label className="text-sm font-medium">Nama Checklist</label><Input value={draft.nama} onChange={event => setDraft(current => ({ ...current, nama: event.target.value }))} placeholder="Contoh: Verifikasi Penjamin" /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Jenis Input</label><select value={draft.tipe} onChange={event => setDraft(current => ({ ...current, tipe: event.target.value as ChecklistFieldType }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{FIELD_TYPES.map(type => <option key={type} value={type}>{checklistFieldLabel(type)}</option>)}</select></div>
          {draft.tipe === 'dropdown' && <div className="space-y-1.5"><label className="text-sm font-medium">Pilihan Dropdown</label><textarea value={draft.pilihan} onChange={event => setDraft(current => ({ ...current, pilihan: event.target.value }))} placeholder="Satu pilihan per baris" className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>}
          <div className="flex flex-wrap gap-4 items-center md:col-span-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.wajib} onChange={event => setDraft(current => ({ ...current, wajib: event.target.checked }))} /> Wajib</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.aktif} onChange={event => setDraft(current => ({ ...current, aktif: event.target.checked }))} /> Aktif</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.reminderAktif} onChange={event => setDraft(current => ({ ...current, reminderAktif: event.target.checked }))} /> Reminder tanggal</label>
          </div>
          <div className="space-y-1.5"><label className="text-sm font-medium">Tampil jika jawaban item</label><select value={draft.kondisiFieldId} onChange={event => setDraft(current => ({ ...current, kondisiFieldId: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Selalu tampil</option>{masters.filter(master => master.id !== editingId).map(master => <option key={master.id} value={master.id}>{master.nama}</option>)}</select></div>
          {draft.kondisiFieldId && <div className="space-y-1.5"><label className="text-sm font-medium">Sama dengan nilai</label><Input value={draft.kondisiValue} onChange={event => setDraft(current => ({ ...current, kondisiValue: event.target.value }))} placeholder="Contoh: Ya" /></div>}
          <div className="flex gap-2 md:col-span-2"><Button onClick={() => void save()} className="gap-2"><Save className="w-4 h-4" /> {editingId ? 'Simpan Perubahan' : 'Tambah Checklist'}</Button>{editingId && <Button variant="outline" onClick={reset}>Batal</Button>}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Daftar Checklist ({masters.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!masters.length ? <p className="text-sm text-muted-foreground">Belum ada checklist.</p> : masters.map((master, index) => (
            <div key={master.id} className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${!master.aktif ? 'opacity-60' : ''}`}>
              <div className="w-8 text-center font-semibold text-muted-foreground">{index + 1}</div>
              <div className="flex-1 min-w-[220px]"><p className="font-medium">{master.nama}</p><p className="text-xs text-muted-foreground">{checklistFieldLabel(master.tipe)}{master.pilihan.length ? ` · ${master.pilihan.join(', ')}` : ''}</p></div>
              <Badge variant="outline">{master.wajib ? 'Wajib' : 'Opsional'}</Badge><Badge variant={master.aktif ? 'default' : 'secondary'}>{master.aktif ? 'Aktif' : 'Nonaktif'}</Badge>
              <div className="flex items-center gap-1"><Button variant="ghost" size="icon" onClick={() => void move(index, -1)} disabled={index === 0} title="Naik"><ArrowUp className="w-4 h-4" /></Button><Button variant="ghost" size="icon" onClick={() => void move(index, 1)} disabled={index === masters.length - 1} title="Turun"><ArrowDown className="w-4 h-4" /></Button><Button variant="ghost" size="icon" onClick={() => { setEditingId(master.id); setDraft(toDraft(master)); }} title="Ubah"><Pencil className="w-4 h-4" /></Button><Button variant="ghost" size="icon" onClick={() => void remove(master)} title="Hapus" className="text-destructive"><Trash2 className="w-4 h-4" /></Button></div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}