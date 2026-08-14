import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  CircleDollarSign,
  ClipboardList,
  Copy,
  FileDown,
  FileSignature,
  Info,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import {
  EstimasiTindakan,
  EstimasiTindakanItem,
  getDB,
  MasterTarif,
  MasterTarifItem,
  Patient,
} from '../lib/db';
import { fmtRp, normalizeMasterTarifClass } from '../lib/estimasi';
import { writeLog } from '../lib/writeLog';
import { formatDate } from '../lib/utils';
import { enqueueCloudRecordMutation } from '../lib/cloudSync';
import { fetchIGDWardData, getEndpoints, type RawIGDPatient } from '../lib/trakcareClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type WorkflowStatus =
  | 'Menunggu Konfirmasi'
  | 'Disetujui'
  | 'Tidak Disetujui'
  | 'Draft'
  | 'Final';

type SnapshotItem = EstimasiTindakanItem & {
  kodeTarif?: string;
  subtotal?: number;
  hargaSnapshot?: number;
};

type EstimasiRecord = Omit<EstimasiTindakan, 'status' | 'items' | 'grandTotal'> & {
  status: WorkflowStatus;
  items: SnapshotItem[];
  grandTotal: number;
  totalEstimasi?: number;
  catatan?: string;
  sumberPasien?: string;
  ruangan?: string;
  snapshotAt?: number;
  confirmedAt?: number;
  confirmedBy?: string;
  rejectionNote?: string;
};

type FormMode = 'create' | 'edit' | 'view';
type PatientSource = 'all' | 'rawat-inap' | 'igd';
type PatientCandidate = Patient & { sourceLabel: 'Rawat Inap' | 'IGD' };

const STATUS_OPTIONS: WorkflowStatus[] = [
  'Menunggu Konfirmasi',
  'Disetujui',
  'Tidak Disetujui',
];

const STATUS_STYLE: Record<string, string> = {
  'Menunggu Konfirmasi': 'border-amber-200 bg-amber-50 text-amber-800',
  Disetujui: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'Tidak Disetujui': 'border-rose-200 bg-rose-50 text-rose-800',
  Draft: 'border-slate-200 bg-slate-50 text-slate-700',
  Final: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

function generateId() {
  return `EST-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStatus(status: WorkflowStatus): WorkflowStatus {
  if (status === 'Draft') return 'Menunggu Konfirmasi';
  if (status === 'Final') return 'Disetujui';
  return status;
}

function normalizeItem(item: EstimasiTindakanItem & Partial<SnapshotItem>): SnapshotItem {
  const qty = Math.max(1, Number(item.qty) || 1);
  const harga = Number(item.harga) || 0;
  return {
    ...item,
    id: item.id || generateId(),
    qty,
    harga,
    hargaSnapshot: Number(item.hargaSnapshot ?? item.hargaMaster ?? harga),
    subtotal: Number(item.subtotal ?? harga * qty),
    kategori: item.kategori || 'Master Tarif',
    namaItem: item.namaItem || 'Item tanpa nama',
    satuan: item.satuan || 'Tindakan',
    matchStatus: item.matchStatus || 'manual',
    matchedName: item.matchedName || item.namaItem || '',
    hargaOverride: Boolean(item.hargaOverride),
  };
}

function normalizeRecord(
  record: (EstimasiTindakan & Partial<EstimasiRecord>) | EstimasiRecord,
): EstimasiRecord {
  const items = (record.items || []).map(normalizeItem);
  const total = items.reduce((sum, item) => sum + (item.subtotal ?? item.harga * item.qty), 0);
  return {
    ...record,
    status: normalizeStatus(record.status as WorkflowStatus),
    items,
    grandTotal: Number(record.totalEstimasi ?? record.grandTotal ?? total),
    totalEstimasi: Number(record.totalEstimasi ?? record.grandTotal ?? total),
    catatan: record.catatan || '',
  };
}

function getClassLabel(value: string) {
  return value;
}

function normalizeMasterTarifRecord(master: MasterTarif): MasterTarif {
  const numericId = Number(master.id);
  return {
    ...master,
    id: Number.isFinite(numericId) ? numericId : master.id,
    status: String(master.status ?? '').trim().toLowerCase() === 'aktif' ? 'aktif' : 'nonaktif',
  };
}

function patientIsEligible(patient: Patient) {
  const searchable = `${patient.ward} ${patient.roomName} ${patient.roomType}`.toLowerCase();
  return patient.status !== 'pulang' && Boolean(searchable.trim());
}

function mapIGDPatient(patient: RawIGDPatient): PatientCandidate {
  const now = Date.now();
  return {
    noRM: patient.noRM,
    namaPasien: patient.nama,
    episodeNo: patient.episode,
    ward: patient.lokasi || 'IGD',
    roomName: patient.lokasi || 'IGD',
    roomType: '',
    bedCode: '',
    dpjp: patient.dokter,
    dob: patient.dob,
    agama: '',
    sexDesc: '',
    admissionDate: patient.tanggalKedatangan,
    dischargeDate: null,
    medicalDischarge: null,
    payor: patient.penjamin,
    statusBPJS: '',
    diagnosaMasuk: '',
    diagnosakUtama: '',
    diagnosaTambahan: '',
    alertVIP: '',
    status: 'aktif',
    sumberData: 'trakcare',
    bookmarked: false,
    createdAt: now,
    updatedAt: now,
    sourceLabel: 'IGD',
  };
}

export default function EstimasiBiayaTindakanPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('list');
  const [records, setRecords] = useState<EstimasiRecord[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [masterTarifs, setMasterTarifs] = useState<MasterTarif[]>([]);
  const [masterItems, setMasterItems] = useState<MasterTarifItem[]>([]);
  const [igdPatients, setIgdPatients] = useState<PatientCandidate[]>([]);
  const [igdLoading, setIgdLoading] = useState(false);
  const [igdError, setIgdError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [listStatus, setListStatus] = useState('All');
  const [patientSearch, setPatientSearch] = useState('');
  const [patientSource, setPatientSource] = useState<PatientSource>('all');
  const [tariffSearch, setTariffSearch] = useState('');
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [formData, setFormData] = useState<Partial<EstimasiRecord>>({});

  const currentUser = user?.namaLengkap || user?.username || 'System';

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const db = await getDB();
      const [rawRecords, rawPatients, rawMasters, rawItems] = await Promise.all([
        db.getAll('estimasiTindakan'),
        db.getAll('patients'),
        db.getAll('masterTarifs'),
        db.getAll('masterTarifItems'),
      ]);
      setRecords(
        (rawRecords as unknown as (EstimasiTindakan & Partial<EstimasiRecord>)[])
          .map(normalizeRecord)
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
      setPatients((rawPatients as Patient[]).filter(patientIsEligible));
      setMasterTarifs((rawMasters as MasterTarif[]).map(normalizeMasterTarifRecord));
      setMasterItems(
        (rawItems as MasterTarifItem[]).map((item) => ({
          ...item,
          masterTarifId: Number.isFinite(Number(item.masterTarifId)) ? Number(item.masterTarifId) : item.masterTarifId,
          kelasTarif: normalizeMasterTarifClass(item.kelasTarif),
        })),
      );
    } catch (error) {
      console.error(error);
      setLoadError('Data estimasi belum dapat dimuat dari penyimpanan lokal.');
      toast.error('Gagal memuat data estimasi');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadIGDPatients = useCallback(async () => {
    setIgdLoading(true);
    setIgdError('');
    try {
      const endpoints = await getEndpoints();
      const rawPatients = await fetchIGDWardData(endpoints.igd);
      setIgdPatients(rawPatients.map(mapIGDPatient).filter(patient => patient.noRM || patient.namaPasien));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Data IGD tidak dapat dimuat.';
      setIgdError(message);
      setIgdPatients([]);
    } finally {
      setIgdLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const refresh = () => void loadData();
    window.addEventListener('ipaw:master-tarif-changed', refresh);
    return () => window.removeEventListener('ipaw:master-tarif-changed', refresh);
  }, [loadData]);

  useEffect(() => {
    if (patientSource === 'igd' && !igdPatients.length && !igdLoading) {
      void loadIGDPatients();
    }
  }, [igdLoading, igdPatients.length, loadIGDPatients, patientSource]);

  const activeMasterIds = useMemo(
    () => new Set(
      masterTarifs
        .filter((master) => String(master.status).toLowerCase() === 'aktif')
        .map((master) => Number(master.id))
        .filter((id) => Number.isFinite(id)),
    ),
    [masterTarifs],
  );

  const fallbackMasterId = useMemo(() => {
    if (activeMasterIds.size > 0 || !masterTarifs.length) return null;
    const candidates = [...masterTarifs]
      .filter((master) => Number.isFinite(Number(master.id)))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return candidates.find((master) =>
      masterItems.some((item) => Number(item.masterTarifId) === Number(master.id)),
    )?.id ?? null;
  }, [activeMasterIds, masterItems, masterTarifs]);

  const usableMasterItems = useMemo(
    () =>
      masterItems.filter(
        (item) => {
          if (!masterTarifs.length) return true;
          if (item.masterTarifId === undefined || !Number.isFinite(Number(item.masterTarifId))) return true;
          if (activeMasterIds.size > 0) return activeMasterIds.has(Number(item.masterTarifId));
          // A legacy/imported workspace can contain a tariff set without an
          // active parent yet. Keep the form usable with the latest set until
          // the user activates a master in Pengaturan > Master Tarif.
          return fallbackMasterId !== null && Number(item.masterTarifId) === Number(fallbackMasterId);
        },
      ),
    [activeMasterIds, fallbackMasterId, masterItems, masterTarifs.length],
  );

  const usingFallbackMasterTarif = masterTarifs.length > 0 && activeMasterIds.size === 0 && usableMasterItems.length > 0;

  const classOptions = useMemo(() => {
    return [...new Set(
      usableMasterItems
        .map((item) => normalizeMasterTarifClass(item.kelasTarif))
        .filter(Boolean),
    )].sort((a, b) => a.localeCompare(b, 'id'));
  }, [usableMasterItems]);

  const filteredRecords = useMemo(() => {
    const query = listSearch.trim().toLowerCase();
    return records.filter((record) => {
      const matchesQuery =
        !query ||
        `${record.nomorEstimasi} ${record.namaPasien} ${record.noRM} ${record.episodeNo} ${record.tindakan}`
          .toLowerCase()
          .includes(query);
      const matchesStatus = listStatus === 'All' || normalizeStatus(record.status) === listStatus;
      return matchesQuery && matchesStatus;
    });
  }, [listSearch, listStatus, records]);

  const filteredPatients = useMemo(() => {
    const query = patientSearch.trim().toLowerCase();
    const candidates: PatientCandidate[] = [
      ...patients.map(patient => ({ ...patient, sourceLabel: 'Rawat Inap' as const })),
      ...igdPatients,
    ];
    const unique = new Map<string, PatientCandidate>();
    for (const patient of candidates) {
      const key = `${patient.sourceLabel}:${patient.noRM}:${patient.episodeNo}`;
      if (!unique.has(key)) unique.set(key, patient);
    }
    return [...unique.values()]
      .filter((patient) => patientSource === 'all' || (patient.sourceLabel === 'IGD' ? patientSource === 'igd' : patientSource === 'rawat-inap'))
      .filter((patient) => {
        const haystack = `${patient.noRM} ${patient.namaPasien} ${patient.episodeNo} ${patient.ward} ${patient.roomName}`.toLowerCase();
        return !query || haystack.includes(query);
      })
      .slice(0, 8);
  }, [igdPatients, patientSearch, patientSource, patients]);

  const filteredTariffItems = useMemo(() => {
    const query = tariffSearch.trim().toLowerCase();
    const selectedClass = formData.kelasTarif || '';
    return usableMasterItems
      .filter((item) => !selectedClass || normalizeMasterTarifClass(item.kelasTarif) === normalizeMasterTarifClass(selectedClass))
      .filter((item) => {
        const haystack = `${item.orderItem} ${item.orderItemCode} ${item.itpRowId} ${item.jenisTarif}`.toLowerCase();
        return !query || haystack.includes(query);
      })
      .slice(0, 18);
  }, [formData.kelasTarif, tariffSearch, usableMasterItems]);

  const total = useMemo(
    () => (formData.items || []).reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.harga) || 0), 0),
    [formData.items],
  );

  const categoryTotals = useMemo(
    () =>
      (formData.items || []).reduce<Record<string, number>>((result, item) => {
        const category = item.kategori || 'Master Tarif';
        result[category] = (result[category] || 0) + (Number(item.qty) || 0) * (Number(item.harga) || 0);
        return result;
      }, {}),
    [formData.items],
  );

  const canEdit = formMode !== 'view' && formData.status !== 'Disetujui';

  function updateForm(field: keyof EstimasiRecord, value: unknown) {
    setFormData((previous) => ({ ...previous, [field]: value }));
  }

  async function nextEstimateNumber() {
    const date = new Date();
    const prefix = `EST-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
      date.getDate(),
    ).padStart(2, '0')}-`;
    const sequence = records
      .filter((record) => record.nomorEstimasi.startsWith(prefix))
      .map((record) => Number(record.nomorEstimasi.split('-').pop()))
      .filter(Number.isFinite)
      .reduce((max, value) => Math.max(max, value), 0);
    return `${prefix}${String(sequence + 1).padStart(4, '0')}`;
  }

  async function handleCreateNew() {
    const now = Date.now();
    setFormData({
      id: generateId(),
      nomorEstimasi: await nextEstimateNumber(),
      status: 'Menunggu Konfirmasi',
      noRM: '',
      episodeNo: '',
      namaPasien: '',
      tanggalLahir: '',
      umur: 0,
      jenisKelamin: '',
      dokterOperator: '',
      tindakan: 'Estimasi Tindakan',
      jenisOperasi: '',
      penjamin: '',
      kelas: '',
      kelasTarif: '',
      diagnosis: '',
      ruangan: '',
      items: [],
      grandTotal: 0,
      totalEstimasi: 0,
      catatan: '',
      createdBy: currentUser,
      createdAt: now,
      updatedAt: now,
    });
    setPatientSearch('');
    setPatientSource('all');
    setTariffSearch('');
    setFormMode('create');
    setActiveTab('form');
  }

  function handleOpen(record: EstimasiRecord, mode: FormMode) {
    setFormData({ ...normalizeRecord(record) });
    setFormMode(mode);
    setPatientSearch('');
    setTariffSearch('');
    setActiveTab('form');
  }

  function handlePatientSelect(patient: PatientCandidate) {
    const dob = patient.dob ? new Date(patient.dob) : null;
    const today = new Date();
    const age = dob
      ? Math.max(0, today.getFullYear() - dob.getFullYear() - (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0))
      : 0;
    const patientClass = (patient.roomType || '').trim().toLowerCase();
    const availableClass = classOptions.find(
      (option) => normalizeMasterTarifClass(option).toLowerCase() === normalizeMasterTarifClass(patientClass).toLowerCase(),
    ) || '';
    setFormData((previous) => ({
      ...previous,
      noRM: patient.noRM,
      episodeNo: patient.episodeNo || '',
      namaPasien: patient.namaPasien,
      tanggalLahir: patient.dob || '',
      umur: age,
      jenisKelamin: patient.sexDesc || '',
      penjamin: patient.payor || '',
      kelas: patient.roomType || patient.roomName || patient.ward || '',
      ruangan: patient.roomName || patient.ward || 'IGD',
      kelasTarif: availableClass,
      diagnosis: patient.diagnosakUtama || patient.diagnosaMasuk || '',
      dokterOperator: patient.dpjp || '',
      sumberPasien: patient.sourceLabel,
    }));
    setPatientSearch(patient.namaPasien);
    if (!availableClass) {
      toast.info('Kelas tarif belum terpetakan. Silakan pilih kelas tarif secara manual.');
    }
  }

  function changeTariffClass(value: string) {
    const previousItems = formData.items || [];
    const nextItems = previousItems.map((item) => {
      const match = usableMasterItems.find(
        (master) =>
          normalizeMasterTarifClass(master.kelasTarif) === normalizeMasterTarifClass(value) &&
          ((item.kodeTarif &&
            master.orderItemCode.trim().toLowerCase() === item.kodeTarif.trim().toLowerCase()) ||
            master.orderItem.trim().toLowerCase() === item.namaItem.trim().toLowerCase()),
      );
      if (!match) return item;
      return {
        ...item,
        harga: match.price,
        hargaMaster: match.price,
        hargaSnapshot: match.price,
        subtotal: match.price * item.qty,
        matchStatus: 'exact' as const,
        matchedName: match.orderItem,
        masterTarifItemId: match.id,
        kodeTarif: match.orderItemCode,
      };
    });
    setFormData((previous) => ({ ...previous, kelasTarif: value, items: nextItems }));
  }

  function addTariffItem(master: MasterTarifItem) {
    if (!formData.kelasTarif) {
      toast.error('Pilih kelas tarif sebelum menambahkan item.');
      return;
    }
    const existingIndex = (formData.items || []).findIndex(
      (item) =>
        (item.masterTarifItemId !== undefined &&
          master.id !== undefined &&
          Number(item.masterTarifItemId) === Number(master.id)) ||
        (item.kodeTarif &&
          master.orderItemCode &&
          item.kodeTarif.trim().toLowerCase() === master.orderItemCode.trim().toLowerCase()),
    );
    if (existingIndex >= 0) {
      updateItem(existingIndex, 'qty', (formData.items?.[existingIndex]?.qty || 1) + 1);
      toast.success('Qty item ditambah menjadi ' + ((formData.items?.[existingIndex]?.qty || 1) + 1));
      return;
    }
    const item: SnapshotItem = {
      id: generateId(),
      kategori: master.jenisTarif || 'Master Tarif',
      namaItem: master.orderItem,
      kodeTarif: master.orderItemCode || master.itpRowId,
      qty: 1,
      satuan: 'Tindakan',
      harga: Number(master.price) || 0,
      hargaMaster: Number(master.price) || 0,
      hargaSnapshot: Number(master.price) || 0,
      subtotal: Number(master.price) || 0,
      hargaOverride: false,
      matchStatus: 'exact',
      matchedName: master.orderItem,
      masterTarifItemId: master.id,
    };
    setFormData((previous) => ({ ...previous, items: [...(previous.items || []), item] }));
    toast.success('Item ditambahkan ke rincian.');
  }

  function updateItem(index: number, field: keyof SnapshotItem, value: unknown) {
    setFormData((previous) => {
      const items = [...(previous.items || [])];
      const item = items[index];
      if (!item) return previous;
      const next = { ...item, [field]: value };
      if (field === 'qty') {
        next.qty = Math.max(1, Number(value) || 1);
        next.subtotal = next.qty * next.harga;
      }
      items[index] = next;
      return { ...previous, items };
    });
  }

  function removeItem(index: number) {
    setFormData((previous) => {
      const items = [...(previous.items || [])];
      items.splice(index, 1);
      return { ...previous, items };
    });
  }

  function moveItem(index: number, direction: -1 | 1) {
    setFormData((previous) => {
      const items = [...(previous.items || [])];
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= items.length) return previous;
      [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
      return { ...previous, items };
    });
  }

  async function handleSave() {
    if (!formData.noRM || !formData.namaPasien) {
      toast.error('Pilih pasien Rawat Inap atau IGD terlebih dahulu.');
      return;
    }
    if (!formData.kelasTarif) {
      toast.error('Kelas tarif wajib dipilih.');
      return;
    }
    if (!formData.items?.length) {
      toast.error('Tambahkan minimal satu item Master Tarif.');
      return;
    }
    const now = Date.now();
    const snapshotItems = formData.items.map((item) => {
      const qty = Math.max(1, Number(item.qty) || 1);
      const harga = Number(item.harga) || 0;
      return { ...normalizeItem(item), qty, harga, hargaSnapshot: harga, subtotal: qty * harga };
    });
    const snapshotTotal = snapshotItems.reduce((sum, item) => sum + (item.subtotal || 0), 0);
    const doc: EstimasiRecord = {
      ...(formData as EstimasiRecord),
      status: 'Menunggu Konfirmasi',
      items: snapshotItems,
      grandTotal: snapshotTotal,
      totalEstimasi: snapshotTotal,
      updatedAt: now,
      snapshotAt: now,
    };
    try {
      const db = await getDB();
      const existing = await db.get('estimasiTindakan', doc.id);
      if (existing) await db.put('estimasiTindakan', doc as unknown as EstimasiTindakan);
      else await db.add('estimasiTindakan', doc as unknown as EstimasiTindakan);
      await enqueueCloudRecordMutation('upsertRecord', 'estimasiTindakan', 'id', { record: doc });
      await writeLog({
        modul: 'Estimasi Tindakan',
        aktivitas: 'Simpan Estimasi IPAW v2',
        noRM: doc.noRM,
        namaPasien: doc.namaPasien,
        detail: `${doc.nomorEstimasi} · ${fmtRp(snapshotTotal)} · Menunggu Konfirmasi`,
        status: 'Success',
      });
      toast.success('Estimasi disimpan dan menunggu konfirmasi.');
      await loadData();
      setActiveTab('list');
    } catch (error) {
      console.error(error);
      toast.error('Estimasi tidak dapat disimpan.');
    }
  }

  async function changeStatus(record: EstimasiRecord, status: 'Disetujui' | 'Tidak Disetujui') {
    const question =
      status === 'Disetujui'
        ? `Setujui estimasi ${record.nomorEstimasi}?`
        : `Tandai estimasi ${record.nomorEstimasi} sebagai Tidak Disetujui?`;
    if (!window.confirm(question)) return;
    try {
      const next: EstimasiRecord = {
        ...record,
        status,
        updatedAt: Date.now(),
        confirmedAt: Date.now(),
        confirmedBy: currentUser,
      };
      const db = await getDB();
      await db.put('estimasiTindakan', next as unknown as EstimasiTindakan);
      await enqueueCloudRecordMutation('upsertRecord', 'estimasiTindakan', 'id', { record: next });
      await writeLog({
        modul: 'Estimasi Tindakan',
        aktivitas: status,
        noRM: record.noRM,
        namaPasien: record.namaPasien,
        detail: `${record.nomorEstimasi} · ${status}`,
        status: status === 'Disetujui' ? 'Success' : 'Warning',
      });
      toast.success(`Status diubah menjadi ${status}.`);
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error('Status tidak dapat diubah.');
    }
  }

  async function handleDelete(record: EstimasiRecord) {
    if (!window.confirm(`Hapus ${record.nomorEstimasi} dari riwayat?`)) return;
    try {
      const db = await getDB();
      await db.delete('estimasiTindakan', record.id);
      await enqueueCloudRecordMutation('deleteRecord', 'estimasiTindakan', 'id', { key: record.id });
      await writeLog({
        modul: 'Estimasi Tindakan',
        aktivitas: 'Hapus Estimasi',
        noRM: record.noRM,
        namaPasien: record.namaPasien,
        detail: `Hapus ${record.nomorEstimasi}`,
        status: 'Success',
      });
      toast.success('Estimasi dihapus.');
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error('Estimasi tidak dapat dihapus.');
    }
  }

  async function handleDuplicate(record: EstimasiRecord) {
    const now = Date.now();
    setFormData({
      ...record,
      id: generateId(),
      nomorEstimasi: await nextEstimateNumber(),
      status: 'Menunggu Konfirmasi',
      createdAt: now,
      updatedAt: now,
      confirmedAt: undefined,
      confirmedBy: undefined,
    });
    setFormMode('create');
    setActiveTab('form');
    toast.info('Salinan dibuat. Periksa kembali lalu simpan.');
  }

  function generatePDF(record: EstimasiRecord, action: 'print' | 'download') {
    const pdf = new jsPDF({ format: 'a4', unit: 'mm' });
    const teal: [number, number, number] = [11, 103, 112];
    const ink: [number, number, number] = [25, 49, 52];
    const muted: [number, number, number] = [88, 101, 103];
    const lightGray: [number, number, number] = [244, 246, 246];
    const border: [number, number, number] = [197, 210, 210];

    pdf.setDrawColor(...teal);
    pdf.setLineWidth(0.7);
    pdf.line(16, 27, 194, 27);
    pdf.setTextColor(...ink);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text('Konfirmasi Tindakan Medis', 105, 15, { align: 'center' });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...muted);
    pdf.text('Rincian tindakan dan perkiraan biaya', 105, 23, { align: 'center' });

    pdf.setDrawColor(...border);
    pdf.setLineWidth(0.25);
    pdf.line(16, 38, 194, 38);
    pdf.setTextColor(...teal);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text('DATA PASIEN', 16, 44);

    const drawInlineField = (
      label: string,
      value: string,
      x: number,
      y: number,
      width: number,
      labelWidth: number,
    ) => {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6);
      pdf.setTextColor(...muted);
      pdf.text(label.toUpperCase(), x, y);
      pdf.text(':', x + labelWidth - 2, y);
      const valueX = x + labelWidth + 2;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.3);
      pdf.setTextColor(...ink);
      const lines = pdf.splitTextToSize(value || '-', Math.max(12, width - (valueX - x)));
      pdf.text(lines[0] || '-', valueX, y);
    };

    drawInlineField('Nama pasien', record.namaPasien, 16, 52, 60, 24);
    drawInlineField('No. RM', record.noRM, 80, 52, 58, 22);
    drawInlineField('Episode', record.episodeNo || '-', 144, 52, 50, 25);
    drawInlineField('Ruangan', record.ruangan || '-', 16, 61, 60, 24);
    drawInlineField('Penjamin', record.penjamin || '-', 80, 61, 58, 22);
    drawInlineField('Kelas tarif', getClassLabel(record.kelasTarif || '-'), 144, 61, 50, 25);
    drawInlineField('Tindakan', record.tindakan || '-', 16, 70, 60, 24);
    drawInlineField('DPJP', record.dokterOperator || '-', 80, 70, 58, 22);
    drawInlineField('Tanggal', formatDate(record.updatedAt), 144, 70, 50, 25);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(...teal);
    pdf.text('RINCIAN TINDAKAN', 16, 81);

    const tableRows = record.items.map((item) => [
      item.namaItem,
      String(item.qty),
      fmtRp(item.harga),
      fmtRp(item.subtotal ?? item.qty * item.harga),
    ]);
    autoTable(pdf, {
      startY: 85,
      head: [['Rincian item', 'Qty', 'Harga satuan', 'Subtotal']],
      body: tableRows,
      theme: 'plain',
      styles: {
        fontSize: 8.5,
        cellPadding: { top: 3.5, right: 3, bottom: 3.5, left: 3 },
        textColor: ink,
        lineColor: border,
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: lightGray,
        textColor: ink,
        fontStyle: 'bold',
        cellPadding: { top: 3.5, right: 3, bottom: 3.5, left: 3 },
      },
      alternateRowStyles: { fillColor: [252, 253, 253] },
      columnStyles: {
        0: { cellWidth: 94 },
        1: { halign: 'right', cellWidth: 20 },
        2: { halign: 'right', cellWidth: 32 },
        3: { halign: 'right', cellWidth: 32 },
      },
      margin: { left: 16, right: 16 },
    });

    let y = ((pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 85) + 9;
    const ensureSpace = (height: number) => {
      if (y + height > 268) {
        pdf.addPage();
        y = 22;
      }
    };

    ensureSpace(24);
    pdf.setDrawColor(...border);
    pdf.setLineWidth(0.45);
    pdf.line(112, y - 6, 194, y - 6);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(...teal);
    pdf.text('TOTAL ESTIMASI', 119, y + 2);
    pdf.setFontSize(13);
    pdf.text(fmtRp(record.totalEstimasi ?? record.grandTotal), 189, y + 2, { align: 'right' });
    y += 23;

    if (record.catatan) {
      const noteLines = pdf.splitTextToSize(record.catatan, 168).slice(0, 6);
      const noteHeight = Math.max(18, 10 + noteLines.length * 4.5);
      ensureSpace(noteHeight + 7);
      pdf.setDrawColor(193, 148, 62);
      pdf.setLineWidth(1);
      pdf.line(16, y - 4, 16, y - 4 + noteHeight);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(129, 91, 25);
      pdf.text('CATATAN', 21, y + 3);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(...ink);
      pdf.text(noteLines, 21, y + 10);
      y += noteHeight + 8;
    }

    ensureSpace(27);
    pdf.setDrawColor(...border);
    pdf.setLineWidth(0.25);
    pdf.line(16, y - 4, 194, y - 4);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(...teal);
    pdf.text('INFORMASI PENTING', 21, y + 4);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...muted);
    pdf.text('Dokumen ini merupakan perkiraan biaya, bukan tagihan akhir.', 21, y + 10);
    pdf.text('Biaya aktual dapat berubah sesuai kondisi medis, layanan, dan ketentuan penjamin.', 21, y + 16);
    y += 34;

    ensureSpace(77);
    pdf.setDrawColor(...border);
    pdf.setLineWidth(0.25);
    pdf.rect(16, y - 4, 178, 72);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(...teal);
    pdf.text('KONFIRMASI KELUARGA / PENJAMIN', 21, y + 5);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...muted);
    pdf.text('Saya telah menerima penjelasan mengenai tindakan dan perkiraan biaya di atas.', 21, y + 12);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.8);
    pdf.setTextColor(...muted);
    pdf.text('PILIHAN KEPUTUSAN', 21, y + 20);
    pdf.setDrawColor(100, 112, 113);
    pdf.rect(21, y + 23, 4, 4);
    pdf.rect(67, y + 23, 4, 4);
    pdf.setTextColor(...ink);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text('MENYETUJUI', 28, y + 26);
    pdf.text('TIDAK MENYETUJUI', 74, y + 26);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.8);
    pdf.setTextColor(...muted);
    pdf.text('TANDA TANGAN KELUARGA / PENJAMIN', 112, y + 20);
    pdf.setDrawColor(100, 112, 113);
    pdf.rect(112, y + 23, 77, 22);
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(7);
    pdf.setTextColor(150, 158, 158);
    pdf.text('Bubuhkan tanda tangan di sini', 150.5, y + 36, { align: 'center' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...muted);
    pdf.text('Nama jelas:', 21, y + 55);
    pdf.line(42, y + 55.5, 96, y + 55.5);
    pdf.text('Hubungan:', 21, y + 65);
    pdf.line(42, y + 65.5, 96, y + 65.5);
    pdf.text('Tanggal:', 112, y + 55);
    pdf.line(130, y + 55.5, 189, y + 55.5);

    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page);
      pdf.setDrawColor(...border);
      pdf.setLineWidth(0.2);
      pdf.line(16, 281, 194, 281);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(...muted);
      pdf.text('Konfirmasi Tindakan Medis', 16, 286);
      pdf.text(`Halaman ${page} dari ${pageCount}`, 194, 286, { align: 'right' });
    }

    if (action === 'print') {
      pdf.autoPrint();
      window.open(pdf.output('bloburl'), '_blank');
    } else {
    pdf.save(`Konfirmasi_Tindakan_Medis_${record.noRM || 'pasien'}.pdf`);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background px-4 py-5 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1480px] space-y-6">
        <header className="relative overflow-hidden rounded-2xl border border-primary/15 bg-card px-5 py-6 shadow-sm sm:px-8">
          <div className="absolute right-0 top-0 h-40 w-40 translate-x-12 -translate-y-20 rounded-full bg-primary/10" />
          <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Estimasi Biaya Tindakan</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Susun rincian biaya dari Master Tarif, simpan snapshot, lalu kirim untuk konfirmasi keluarga atau penjamin.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CircleDollarSign className="h-4 w-4 text-primary" />
              <span data-testid="text-master-item-count">{usableMasterItems.length} item Master Tarif tersedia</span>
            </div>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList className="w-fit bg-muted/70">
              <TabsTrigger value="list" data-testid="tab-estimasi-history">Riwayat estimasi</TabsTrigger>
              <TabsTrigger value="form" disabled={!formData.id} data-testid="tab-estimasi-form">Buat estimasi</TabsTrigger>
            </TabsList>
            {activeTab === 'list' && (
              <Button onClick={() => void handleCreateNew()} className="gap-2" data-testid="button-create-estimasi">
                <Plus className="h-4 w-4" /> Buat estimasi baru
              </Button>
            )}
          </div>

          <TabsContent value="list" className="mt-5 space-y-4">
            <Card className="overflow-hidden">
              <CardHeader className="border-b bg-card pb-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <CardTitle className="text-lg">Riwayat estimasi</CardTitle>
                    <CardDescription className="mt-1">Pantau dokumen yang menunggu konfirmasi, disetujui, atau tidak disetujui.</CardDescription>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="search"
                        placeholder="Cari nomor, pasien, atau RM"
                        value={listSearch}
                        onChange={(event) => setListSearch(event.target.value)}
                        className="w-full pl-9 sm:w-64"
                        data-testid="input-search-estimasi"
                      />
                    </div>
                    <select
                      value={listStatus}
                      onChange={(event) => setListStatus(event.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      data-testid="select-filter-status"
                    >
                      <option value="All">Semua status</option>
                      {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    <Button variant="outline" size="icon" onClick={() => void loadData()} title="Muat ulang" data-testid="button-refresh-estimasi">
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="space-y-3 p-5" data-testid="loading-estimasi">
                    {[1, 2, 3].map((row) => <div key={row} className="h-14 animate-pulse rounded-lg bg-muted" />)}
                  </div>
                ) : loadError ? (
                  <div className="flex flex-col items-center gap-3 px-5 py-14 text-center" data-testid="error-estimasi">
                    <AlertCircle className="h-8 w-8 text-destructive" />
                    <p className="text-sm text-muted-foreground">{loadError}</p>
                    <Button variant="outline" onClick={() => void loadData()} data-testid="button-retry-estimasi">Coba lagi</Button>
                  </div>
                ) : filteredRecords.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 px-5 py-16 text-center" data-testid="empty-estimasi">
                    <div className="rounded-2xl bg-primary/10 p-4 text-primary"><ClipboardList className="h-8 w-8" /></div>
                    <div>
                      <p className="font-semibold">{records.length ? 'Tidak ada hasil yang cocok' : 'Belum ada estimasi tindakan'}</p>
                      <p className="mt-1 text-sm text-muted-foreground">Mulai dari pasien Rawat Inap atau IGD dan tambahkan item Master Tarif.</p>
                    </div>
                    <Button onClick={() => void handleCreateNew()} className="gap-2" data-testid="button-empty-create-estimasi"><Plus className="h-4 w-4" /> Buat estimasi</Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1040px] text-sm">
                      <thead className="border-b bg-muted/45">
                        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-5 py-3">Dokumen</th>
                          <th className="px-5 py-3">Pasien</th>
                          <th className="px-5 py-3">Kelas tarif</th>
                          <th className="px-5 py-3 text-right">Total estimasi</th>
                          <th className="px-5 py-3">Status</th>
                          <th className="px-5 py-3 text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRecords.map((record) => (
                          <tr key={record.id} className="border-b last:border-0 hover:bg-muted/20" data-testid={`row-estimasi-${record.id}`}>
                            <td className="px-5 py-4">
                              <div className="font-semibold">{record.nomorEstimasi}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{formatDate(record.updatedAt)}</div>
                            </td>
                            <td className="px-5 py-4">
                              <div className="font-medium">{record.namaPasien}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{record.noRM} · {record.episodeNo || 'Episode aktif'}</div>
                            </td>
                            <td className="px-5 py-4 text-muted-foreground">{getClassLabel(record.kelasTarif || '-')}</td>
                            <td className="px-5 py-4 text-right font-semibold tabular-nums">{fmtRp(record.totalEstimasi ?? record.grandTotal)}</td>
                            <td className="px-5 py-4">
                              <Badge variant="outline" className={STATUS_STYLE[record.status]} data-testid={`status-estimasi-${record.id}`}>{normalizeStatus(record.status)}</Badge>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="icon" title="Lihat" onClick={() => handleOpen(record, 'view')} data-testid={`button-view-estimasi-${record.id}`}><Info className="h-4 w-4" /></Button>
                                {record.status !== 'Disetujui' && (
                                  <Button variant="ghost" size="icon" title="Edit" onClick={() => handleOpen(record, 'edit')} data-testid={`button-edit-estimasi-${record.id}`}><Pencil className="h-4 w-4" /></Button>
                                )}
                                <Button variant="ghost" size="icon" title="Duplikasi" onClick={() => void handleDuplicate(record)} data-testid={`button-duplicate-estimasi-${record.id}`}><Copy className="h-4 w-4" /></Button>
                                {record.status === 'Menunggu Konfirmasi' && (
                                  <>
                                    <Button variant="ghost" size="icon" title="Setujui" className="text-emerald-700" onClick={() => void changeStatus(record, 'Disetujui')} data-testid={`button-approve-estimasi-${record.id}`}><Check className="h-4 w-4" /></Button>
                                    <Button variant="ghost" size="icon" title="Tidak disetujui" className="text-rose-700" onClick={() => void changeStatus(record, 'Tidak Disetujui')} data-testid={`button-reject-estimasi-${record.id}`}><X className="h-4 w-4" /></Button>
                                </>
                                )}
                                <Button variant="ghost" size="icon" title="Cetak" onClick={() => generatePDF(record, 'print')} data-testid={`button-print-estimasi-${record.id}`}><Printer className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" title="Unduh PDF" onClick={() => generatePDF(record, 'download')} data-testid={`button-download-estimasi-${record.id}`}><FileDown className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" title="Hapus" className="text-destructive" onClick={() => void handleDelete(record)} data-testid={`button-delete-estimasi-${record.id}`}><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="form" className="mt-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="outline" onClick={() => setActiveTab('list')} className="gap-2" data-testid="button-back-estimasi"><ChevronLeft className="h-4 w-4" /> Kembali ke riwayat</Button>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{formData.nomorEstimasi}</span>
                <Badge variant="outline" className={STATUS_STYLE[formData.status || 'Menunggu Konfirmasi']}>{normalizeStatus((formData.status || 'Menunggu Konfirmasi') as WorkflowStatus)}</Badge>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)]">
              <Card className="overflow-hidden border-t-4 border-t-primary">
                <CardHeader className="border-b bg-muted/20">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-primary/10 p-2 text-primary"><UserRound className="h-5 w-5" /></div>
                    <div>
                      <CardTitle>1. Pilih pasien</CardTitle>
                      <CardDescription className="mt-1">Gunakan data pasien aktif Rawat Inap atau IGD yang sudah tersedia.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 p-5">
                  <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="search"
                        disabled={!canEdit}
                        value={patientSearch}
                        onChange={(event) => setPatientSearch(event.target.value)}
                        placeholder="Cari nama, No. RM, episode, ruangan"
                        className="pl-9"
                        data-testid="input-search-patient"
                      />
                    </div>
                    <select value={patientSource} onChange={(event) => setPatientSource(event.target.value as PatientSource)} disabled={!canEdit} className="h-9 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-patient-source">
                      <option value="all">Semua sumber</option>
                      <option value="rawat-inap">Rawat Inap</option>
                      <option value="igd">IGD</option>
                    </select>
                  </div>
                  {canEdit && patientSearch.trim() && !formData.noRM && (
                    <div className="divide-y rounded-xl border bg-muted/20" data-testid="patient-search-results">
                      {igdLoading && patientSource === 'igd' ? (
                        <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> Memuat pasien IGD...</div>
                      ) : igdError && patientSource === 'igd' ? (
                        <div className="space-y-2 px-4 py-5 text-sm text-muted-foreground"><p>Data IGD belum tersedia.</p><Button size="sm" variant="outline" onClick={() => void loadIGDPatients()}>Coba lagi</Button></div>
                      ) : filteredPatients.length ? filteredPatients.map((patient) => (
                        <button key={patient.noRM} type="button" onClick={() => handlePatientSelect(patient)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-primary/5" data-testid={`button-select-patient-${patient.noRM}`}>
                          <span>
                            <span className="block font-semibold">{patient.namaPasien}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">{patient.noRM} · {patient.episodeNo || 'Episode aktif'} · {patient.ward || patient.roomName || 'Rawat Inap'}</span>
                          </span>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">{patient.sourceLabel}</span>
                        </button>
                      )) : <p className="px-4 py-5 text-sm text-muted-foreground">Pasien aktif tidak ditemukan.</p>}
                    </div>
                  )}
                  {formData.noRM ? (
                    <div className="rounded-xl border border-primary/20 bg-primary/[0.045] p-4" data-testid="selected-patient-summary">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Pasien terpilih</p>
                          <p className="mt-1 text-lg font-bold">{formData.namaPasien}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{formData.noRM} · {formData.episodeNo || 'Episode aktif'} · {formData.kelas || 'Kelas belum tercatat'}</p>
                        </div>
                        {canEdit && <Button variant="ghost" size="sm" onClick={() => { updateForm('noRM', ''); updateForm('namaPasien', ''); setPatientSearch(''); }} data-testid="button-clear-patient"><X className="mr-1 h-4 w-4" /> Ganti</Button>}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                      <UserRound className="mx-auto mb-2 h-6 w-6 text-primary/60" />
                      Ketik nama atau No. RM untuk memilih pasien.
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kelas pasien</label><Input readOnly value={formData.kelas || '-'} className="bg-muted/30" data-testid="text-patient-class" /></div>
                    <div><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Penjamin</label><Input readOnly value={formData.penjamin || '-'} className="bg-muted/30" data-testid="text-patient-payer" /></div>
                    <div><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Diagnosis utama</label><Input readOnly value={formData.diagnosis || '-'} className="bg-muted/30" data-testid="text-patient-diagnosis" /></div>
                    <div><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">DPJP</label><Input readOnly value={formData.dokterOperator || '-'} className="bg-muted/30" placeholder="Mengikuti data pasien" data-testid="input-doctor" /></div>
                  </div>
                </CardContent>
              </Card>

              <Card className="h-fit">
                <CardHeader className="border-b bg-muted/20">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-primary/10 p-2 text-primary"><CircleDollarSign className="h-5 w-5" /></div>
                    <div>
                      <CardTitle>2. Aturan tarif</CardTitle>
                      <CardDescription className="mt-1">Harga item mengikuti kelas yang dipilih.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 p-5">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold">Kelas tarif <span className="text-destructive">*</span></label>
                     <select value={formData.kelasTarif || ''} onChange={(event) => changeTariffClass(event.target.value)} disabled={!canEdit || !classOptions.length} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-tariff-class">
                       <option value="">{classOptions.length ? 'Pilih kelas tarif dari Master Tarif' : 'Belum ada kelas tarif di Master Tarif'}</option>
                      {classOptions.map((option) => <option key={option} value={option}>{getClassLabel(option)}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Item tersimpan</p><p className="mt-1 text-xl font-bold">{formData.items?.length || 0}</p></div>
                    <div className="rounded-lg bg-primary/10 p-3"><p className="text-xs text-primary">Total saat ini</p><p className="mt-1 text-lg font-bold text-primary">{fmtRp(total)}</p></div>
                  </div>
                   {!masterItems.length ? (
                     <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                       <AlertCircle className="h-4 w-4 shrink-0" />
                       <span>Item Master Tarif belum tersedia di penyimpanan lokal. Silakan import Master Tarif beserta rincian itemnya.</span>
                     </div>
                   ) : usingFallbackMasterTarif ? (
                     <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                       <AlertCircle className="h-4 w-4 shrink-0" />
                       <span>
                         Belum ada Master Tarif aktif. Kelas tarif dari Master Tarif terakhir tetap dapat dipilih sementara.
                         Aktifkan Master Tarif yang benar melalui <a href="#/master-tarif" className="font-semibold underline">Pengaturan Master Tarif</a>.
                       </span>
                     </div>
                   ) : null}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="border-b bg-muted/20">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-primary/10 p-2 text-primary"><ClipboardList className="h-5 w-5" /></div>
                    <div>
                      <CardTitle>3. Rincian biaya</CardTitle>
                      <CardDescription className="mt-1">Cari berdasarkan nama, kode, atau keyword lalu tambahkan ke dokumen.</CardDescription>
                    </div>
                  </div>
                  <div className="relative w-full lg:w-96">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input type="search" disabled={!canEdit || !formData.kelasTarif} value={tariffSearch} onChange={(event) => setTariffSearch(event.target.value)} placeholder={formData.kelasTarif ? 'Cari nama / kode tarif' : 'Pilih kelas tarif terlebih dahulu'} className="pl-9" data-testid="input-search-tariff" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-5">
                {canEdit && tariffSearch.trim() && (
                  <div className="divide-y rounded-xl border bg-muted/15" data-testid="tariff-search-results">
                    {filteredTariffItems.length ? filteredTariffItems.map((master) => (
                      <div key={`${master.id}-${master.kelasTarif}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{master.orderItem}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{master.jenisTarif || 'Master Tarif'} · {fmtRp(master.price)}</p>
                        </div>
                        <Button size="sm" className="shrink-0 gap-1.5" onClick={() => addTariffItem(master)} data-testid={`button-add-tariff-${master.id}`}><Plus className="h-3.5 w-3.5" /> Tambah</Button>
                      </div>
                    )) : <p className="px-4 py-5 text-sm text-muted-foreground">Item tarif tidak ditemukan untuk kelas ini.</p>}
                  </div>
                )}
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full min-w-[850px] text-sm">
                    <thead className="bg-muted/45">
                      <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3">Nama item</th><th className="w-24 px-4 py-3 text-right">Qty</th><th className="w-36 px-4 py-3 text-right">Harga</th><th className="w-40 px-4 py-3 text-right">Subtotal</th><th className="w-28 px-4 py-3 text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formData.items?.length ? formData.items.map((item, index) => (
                        <tr key={item.id} className="border-t" data-testid={`row-estimasi-item-${item.id}`}>
                          <td className="px-4 py-3 align-top"><p className="font-medium">{item.namaItem}</p><p className="mt-1 text-xs text-muted-foreground">{item.kategori} · {item.satuan}</p></td>
                          <td className="px-4 py-3 align-top">{canEdit ? <Input type="number" min={1} value={item.qty} onChange={(event) => updateItem(index, 'qty', event.target.value)} className="h-8 text-right" data-testid={`input-qty-${item.id}`} /> : <p className="text-right">{item.qty}</p>}</td>
                          <td className="px-4 py-3 text-right align-top tabular-nums text-muted-foreground">{fmtRp(item.harga)}</td>
                          <td className="px-4 py-3 text-right align-top font-semibold tabular-nums">{fmtRp(item.qty * item.harga)}</td>
                          <td className="px-4 py-3 align-top"><div className="flex justify-center gap-0.5">
                            {canEdit && <><Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0} onClick={() => moveItem(index, -1)} title="Pindah ke atas" data-testid={`button-move-up-${item.id}`}><ArrowUp className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="icon" className="h-7 w-7" disabled={index === (formData.items?.length || 1) - 1} onClick={() => moveItem(index, 1)} title="Pindah ke bawah" data-testid={`button-move-down-${item.id}`}><ArrowDown className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeItem(index)} title="Hapus item" data-testid={`button-remove-item-${item.id}`}><Trash2 className="h-3.5 w-3.5" /></Button></>}
                          </div></td>
                        </tr>
                       )) : <tr><td colSpan={5} className="px-5 py-14 text-center text-sm text-muted-foreground"><ClipboardList className="mx-auto mb-2 h-7 w-7 text-primary/50" />Belum ada item. Cari Master Tarif di kolom atas untuk menambahkan.</td></tr>}
                    </tbody>
                    <tfoot className="bg-primary/[0.045]">
                       {Object.entries(categoryTotals).map(([category, categoryTotal]) => <tr key={category} className="border-t border-primary/10"><td colSpan={3} className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground">Subtotal {category}</td><td className="px-4 py-2 text-right text-sm font-semibold tabular-nums">{fmtRp(categoryTotal)}</td><td /></tr>)}
                       <tr className="border-t border-primary/15"><td colSpan={3} className="px-4 py-4 text-right text-sm font-bold uppercase tracking-wide text-primary">Total estimasi</td><td className="px-4 py-4 text-right text-xl font-bold tabular-nums text-primary" data-testid="text-total-estimasi">{fmtRp(total)}</td><td /></tr>
                    </tfoot>
                  </table>
                </div>
                <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold">Catatan <span className="font-normal text-muted-foreground">(opsional)</span></label>
                    <textarea value={formData.catatan || ''} onChange={(event) => updateForm('catatan', event.target.value)} disabled={!canEdit} placeholder="Tambahkan konteks untuk keluarga atau penjamin..." className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60" data-testid="textarea-estimasi-note" />
                  </div>
                  <div className="rounded-xl border bg-muted/25 p-4 text-sm">
                    <div className="flex items-center justify-between"><span className="text-muted-foreground">Jumlah item</span><strong>{formData.items?.length || 0}</strong></div>
                    <div className="mt-3 flex items-center justify-between border-t pt-3"><span className="font-semibold">TOTAL ESTIMASI</span><strong className="text-lg text-primary" data-testid="text-total-summary">{fmtRp(total)}</strong></div>
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Harga dan jumlah disimpan sebagai snapshot saat estimasi dikirim.</p>
                  </div>
                </div>
              </CardContent>
              {canEdit ? (
                <CardFooter className="flex flex-col justify-between gap-3 border-t bg-muted/20 p-5 sm:flex-row sm:items-center">
                  <p className="flex items-center gap-2 text-xs text-muted-foreground"><Send className="h-3.5 w-3.5 text-primary" /> Setelah disimpan, status menjadi Menunggu Konfirmasi.</p>
                  <Button onClick={() => void handleSave()} className="w-full gap-2 sm:w-auto" data-testid="button-save-estimasi"><FileSignature className="h-4 w-4" /> Simpan estimasi</Button>
                </CardFooter>
              ) : (
                <CardFooter className="flex justify-end gap-3 border-t bg-muted/20 p-5">
                  <Button variant="outline" onClick={() => generatePDF(formData as EstimasiRecord, 'print')} className="gap-2" data-testid="button-form-print"><Printer className="h-4 w-4" /> Cetak</Button>
                  <Button onClick={() => generatePDF(formData as EstimasiRecord, 'download')} className="gap-2" data-testid="button-form-download"><FileDown className="h-4 w-4" /> Unduh PDF</Button>
                </CardFooter>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}