import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface User {
  id?: number;
  username: string;
  namaLengkap: string;
  role: 'superuser' | 'officer';
  passwordHash: string;
  aktif: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Patient {
  noRM: string;
  namaPasien: string;
  episodeNo: string;
  ward: string;
  roomName: string;
  roomType: string;
  bedCode: string;
  dpjp: string;
  dob: string;
  agama: string;
  sexDesc: string;
  admissionDate: string;
  dischargeDate: string | null;
  medicalDischarge: string | null;
  payor: string;
  statusBPJS: string;
  diagnosaMasuk: string;
  diagnosakUtama: string;
  diagnosaTambahan: string;
  alertVIP: string;
  noHpPJ?: string;
  emailAsuransi?: string;
  noKartuAsuransi?: string;
  status: 'aktif' | 'pulang' | 'pulang_pending';
  sumberData?: 'manual' | 'trakcare';
  bookmarked: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Episode {
  id?: number;
  noRM: string;
  episodeNo: string;
  namaPasien: string;
  admissionDate: string;
  dischargeDate: string | null;
  status: 'aktif' | 'pulang';
  archivedAt: number;
}

export interface Pending {
  id: string;
  noRM: string;
  episodeNo: string;
  namaPasien: string;
  ruangan: string;
  kelas: string;
  dpjp: string;
  payor: string;
  kategori: string;
  isiPending: string;
  prioritas: 'normal' | 'urgent' | 'critical';
  status: 'pending' | 'diproses' | 'selesai';
  deadline: string | null;
  fotoBase64?: string;
  shift: 'pagi' | 'sore' | 'malam';
  userId: number;
  userName: string;
  komentar: Array<{
    text: string;
    userId: number;
    userName: string;
    timestamp: number;
  }>;
  auditLog: Array<{
    action: string;
    userId: number;
    userName: string;
    timestamp: number;
  }>;
  createdAt: number;
  updatedAt: number;
}

export interface JustInfo {
  id: string;
  noRM: string;
  episodeNo: string;
  isi: string;
  shift: string;
  userId: number;
  userName: string;
  createdAt: number;
}

export interface OutlookEmail {
  id: string;
  subject: string;
  senderName: string;
  senderAddress: string;
  receivedAt: string;
  webLink: string | null;
  matchedNoRM: string;
  matchedEpisodeNo: string;
}

export interface OperanShift {
  id: string;
  tanggal: string;
  shiftSerah: string;
  shiftTerima: string;
  userSerahId: number;
  userSerahNama: string;
  userTerimaId: number;
  userTerimaNama: string;
  jamOperan: string;
  totalPasien: number;
  totalPending: number;
  totalPendingSelesai: number;
  totalPendingBerlanjut: number;
  ringkasanPending: any[];
  pdfBase64: string;
  createdAt: number;
}

export interface ImportLog {
  id?: number;
  tanggal: string;
  userNama: string;
  totalRows: number;
  newPatients: number;
  updatedPatients: number;
  archivedPatients: number;
  errors: string[];
  createdAt: number;
}

export interface ActivityLog {
  id?: number;
  timestamp: number;
  tanggal: string;
  jam: string;
  userId: number;
  username: string;
  namaUser: string;
  role: 'superuser' | 'officer' | 'system';
  modul: string;
  aktivitas: string;
  noRM: string;
  episodeNo: string;
  namaPasien: string;
  detail: string;
  oldValue: string;
  newValue: string;
  browser: string;
  device: string;
  os: string;
  status: 'Success' | 'Warning' | 'Failed' | 'Info';
  keterangan: string;
  durasi: number;
  errorCode: string;
  errorMessage: string;
}

export interface Setting {
  key: string;
  value: any;
}

// ── Sync Log ──────────────────────────────────────────────────────────────────

export interface SyncLog {
  id?: number;
  tanggal: string;
  jam: string;
  newPatients: number;
  updatedPatients: number;
  dischargedPatients: number;
  errors: number;
  duration: number;
  createdAt: number;
}

export type SyncOutboxAction = 'upsertRecord' | 'deleteRecord';

export interface SyncOutboxEntry {
  id?: number;
  action: SyncOutboxAction;
  store: string;
  keyField: string;
  key?: string | number;
  record?: any;
  createdAt: number;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
}

// ── Master Tarif ──────────────────────────────────────────────────────────────

export interface MasterTarif {
  id?: number;
  nama: string;
  rumahSakit: string;
  jenisTarif: string;
  tanggalBerlaku: string;
  tanggalImport: string;
  jumlahItem: number;
  status: 'aktif' | 'nonaktif';
  importedBy: string;
  createdAt: number;
}

export interface MasterTarifItem {
  id?: number;
  masterTarifId: number;
  hospitals: string;
  jenisTarif: string;
  fromDateTarif: string;
  itpRowId: string;
  orderItem: string;
  orderItemCode: string;
  kelasTarif: string;
  price: number;
}

// ── Estimasi Biaya Rawat ──────────────────────────────────────────────────────

export interface EstimasiItem {
  id: string;
  kategori: string;
  namaItem: string;
  qty: number;
  harga: number;
  hargaOverride: boolean;
  matchStatus: 'exact' | 'alias' | 'fuzzy' | 'unmapped' | 'manual';
  matchedName: string;
  masterTarifItemId?: number;
}

export interface EstimasiBiaya {
  id: string;
  noRM: string;
  episodeNo: string;
  namaPasien: string;
  namaFileCP: string;
  kelasTarif: string;
  kelasPerawatan: string;
  diagnosa: string;
  lamaRawat: number;
  items: EstimasiItem[];
  bulkObatTotal: number;
  obatDetailItems: Array<{ kategori: string; namaItem: string; qty: number }>;
  adminOverrideValue?: number;
  adminOverrideBy?: string;
  totalSebelumAdmin: number;
  biayaAdmin: number;
  biayaMaterai: number;
  grandTotal: number;
  uploadedBy: string;
  uploadedAt: number;
  createdAt: number;
  updatedAt: number;
}

// ── Estimasi Biaya Tindakan ────────────────────────────────────────────────────

export interface MasterTemplateItem {
  id: string;
  kategori: string;
  namaItem: string;
  qtyDefault: number;
  satuan: string;
  urutan: number;
}

export interface MasterTemplateTindakan {
  id: string;
  namaTemplate: string;
  jenisOperasi: string;
  deskripsi: string;
  items: MasterTemplateItem[];
  aktif: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface EstimasiTindakanItem {
  id: string;
  kategori: string;
  namaItem: string;
  qty: number;
  satuan: string;
  harga: number;
  hargaMaster?: number;
  hargaOverride: boolean;
  matchStatus: 'exact' | 'alias' | 'fuzzy' | 'unmapped' | 'manual';
  matchedName: string;
  masterTarifItemId?: number;
}

export interface EstimasiTindakan {
  id: string;
  nomorEstimasi: string;
  status: 'Draft' | 'Final';
  noRM: string;
  episodeNo: string;
  namaPasien: string;
  tanggalLahir: string;
  umur: number;
  jenisKelamin: string;
  dokterOperator: string;
  tindakan: string;
  jenisOperasi: string;
  penjamin: string;
  kelas: string;
  kelasTarif: string;
  diagnosis: string;
  items: EstimasiTindakanItem[];
  grandTotal: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  finalizedAt?: number;
  finalizedBy?: string;
}

// ── Master Estimasi Biaya Tindakan (data-driven) ─────────────────────────────

export type EstimasiTindakanKelas = 'KLS III' | 'KLS II' | 'KLS I' | 'DELUXE' | 'SUITE';

export interface MasterEstimasiTindakan {
  id: string;
  namaTindakan: string;
  golongan: string;
  aktif: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MasterEstimasiTarif {
  id: string;
  golongan: string;
  komponen: string;
  harga: Record<EstimasiTindakanKelas, number>;
  createdAt: number;
  updatedAt: number;
}

export interface MasterEstimasiKategori {
  id: string;
  nama: string;
  urutan: number;
  aktif: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MasterEstimasiMapping {
  id: string;
  komponenKey: string;
  komponen: string;
  kategoriId: string;
  updatedAt: number;
}

export interface MasterEstimasiMeta {
  key: 'latest';
  penggolonganFingerprint: string;
  tarifFingerprint: string;
  penggolonganFileName: string;
  tarifFileName: string;
  importedBy: string;
  importedAt: number;
  jumlahTindakan: number;
  jumlahTarif: number;
}

// ── Dashboard Pasien Rencana Tindakan ──────────────────────────────────────────

export interface OperatingTheatrePatient {
  id: string;
  noRM: string;
  /** Episode supplied by TrakCare when the dashboard includes it. */
  episodeNo?: string;
  dibuat: string;
  namaPasien: string;
  tanggalOperasi: string;
  jamOperasi: string;
  ruangOperasi: string;
  dpjp: string;
  /** Original EBO/PBO link supplied by TrakCare, when available. */
  pboUrl?: string;
  extraFields: Record<string, string>;
}

export interface OperatingTheatreCache {
  key: 'latest';
  patients: OperatingTheatrePatient[];
  fetchedAt: number;
  source: 'live' | 'cache';
  endpoint: string;
}

export interface OperatingTheatreCompletedPatient extends OperatingTheatrePatient {
  selesaiPada: number;
}

export interface OperatingTheatreCompletedCache {
  key: 'latest';
  patients: OperatingTheatreCompletedPatient[];
  updatedAt: number;
}

export interface OperatingTheatrePreadmissionCache {
  key: 'latest';
  patients: OperatingTheatrePatient[];
  fetchedAt: number;
  source: 'live' | 'cache';
  endpoint: string;
}

export interface OperatingTheatreInProgressPatient {
  id: string;
  noRM: string;
  episodeNo?: string;
  dibuat: string;
  namaPasien: string;
  rencanaTindakan: string;
  ruangOperasi: string;
  dpjp: string;
  penjamin: string;
  keterangan: string;
  status: string;
  extraFields: Record<string, string>;
}

export interface OperatingTheatreInProgressCache {
  key: 'latest';
  patients: OperatingTheatreInProgressPatient[];
  fetchedAt: number;
  source: 'live' | 'cache';
  endpoint: string;
}

// ── Checklist Pasien Rawat Inap ───────────────────────────────────────────────

export type ChecklistFieldType =
  | 'checkbox'
  | 'yesno'
  | 'text'
  | 'textarea'
  | 'number'
  | 'dropdown'
  | 'date'
  | 'time'
  | 'datetime'
  | 'phone';

export interface ChecklistCondition {
  fieldId: string;
  operator: 'equals';
  value: string;
}

export interface ChecklistMaster {
  id: string;
  nama: string;
  tipe: ChecklistFieldType;
  pilihan: string[];
  wajib: boolean;
  aktif: boolean;
  urutan: number;
  reminderAktif: boolean;
  kondisi?: ChecklistCondition;
  createdAt: number;
  updatedAt: number;
}

export interface ChecklistEpisode {
  episodeNo: string;
  noRM: string;
  namaPasien: string;
  tanggalMasuk: string;
  tanggalRencanaTindakan?: string;
  rencanaTindakanSumber?: 'manual' | 'operating_theatre';
  rencanaTindakanSourceId?: string;
  penjamin: string;
  dpjp: string;
  ruangan: string;
  createdAt: number;
  updatedAt: number;
  answers: Record<string, string>;
  catatan: string;
}

export interface ChecklistHistory {
  id: string;
  episodeNo: string;
  noRM: string;
  namaPasien: string;
  tanggalMasuk: string;
  penjamin: string;
  dpjp: string;
  ruangan: string;
  answers: Record<string, string>;
  catatan: string;
  rencanaTindakanSumber?: 'manual' | 'operating_theatre';
  rencanaTindakanSourceId?: string;
  selesaiPada: number;
  selesaiOleh: string;
  tipeSelesai: 'selesai' | 'arsip_manual';
  lamaPenyelesaianHari: number;
}

// ── Billing Check ─────────────────────────────────────────────────────────────

export type BillingItemStatus = 'sesuai' | 'selisih' | 'tidak_ditemukan';
export type BillingOverallStatus = 'valid' | 'warning' | 'invalid';

export interface BillingCheckItem {
  itemCode: string;
  namaItem: string;
  kategori: string;
  qty: number;
  qtySeharusnya?: number | null;
  hargaBilling: number;
  totalBilling: number;
  hargaMaster: number;
  tarifSeharusnya?: number | null;
  selisih: number;
  totalSelisih: number;
  status: BillingItemStatus;
  matchedMasterName: string;
  jenisPelanggaran?: string;
  pesanValidasi?: string;
  severity?: RuleSeverity;
  ruleIds?: number[];
}

export interface BillingRuleResult {
  ruleId: number;
  namaItem: string;
  tipe: string;
  keterangan: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
  qtyBilling?: number;
  qtySeharusnya?: number | null;
  tarifBilling?: number;
  tarifSeharusnya?: number | null;
  selisih?: number | null;
  jenisPelanggaran?: string;
  severity?: RuleSeverity;
}

// ── Billing Rule (data-driven rule engine) ───────────────────────────────────

export type RuleOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'not_contains' | 'in' | 'not_in'
  | 'empty' | 'not_empty';
export type RuleField =
  | 'penjamin' | 'nama_item' | 'kode_tarif' | 'kategori_item' | 'kelompok'
  | 'dokter' | 'kelas' | 'ruangan' | 'lokasi' | 'los' | 'hari_ke'
  | 'hari_pulang' | 'diagnosa' | 'jenis_pelayanan' | 'episode' | 'qty'
  | 'tarif' | 'harga_billing' | 'harga_master' | 'nominal' | 'selisih'
  | 'ada_item_lain';
export type RuleAction =
  | 'lolos' | 'warning' | 'error' | 'info' | 'abaikan'
  | 'gunakan_master' | 'gunakan_tarif_master' | 'gunakan_tarif_khusus'
  | 'pesan_khusus' | 'ubah_harga_acuan' | 'ubah_qty_acuan'
  | 'ubah_tarif_acuan' | 'formula' | 'hitung_selisih' | 'tandai_tidak_valid';
export type RuleLogic = 'AND' | 'OR';
export type RuleSeverity = 'error' | 'warning' | 'info';
export type RuleType =
  | 'tidak_boleh_ada' | 'harus_ada' | 'maksimal_qty' | 'minimal_qty'
  | 'qty_tetap' | 'qty_berdasarkan_los' | 'qty_maksimal_berdasarkan_los'
  | 'qty_per_hari' | 'tarif_sesuai_master' | 'tarif_master_persentase_plus'
  | 'tarif_master_persentase_minus' | 'tarif_tetap' | 'tarif_formula'
  | 'tidak_boleh_charge_hari_pulang' | 'hanya_salah_satu' | 'wajib_bersamaan'
  | 'wajib_tarif_tertentu' | 'custom_formula';

export interface RuleCondition {
  id: string;
  field: RuleField;
  operator: RuleOperator;
  value: string;
  group?: number;
}

export interface RuleActionConfig {
  value?: string;
  formula?: string;
  tarifKhusus?: number;
  targetItem?: string;
  targetField?: 'qty' | 'tarif';
}

export interface RuleConditionGroup {
  id: string;
  logic: RuleLogic;
  conditions: RuleCondition[];
}

export interface BillingRule {
  id?: number;
  nama: string;
  deskripsi: string;
  prioritas: number;
  aktif: boolean;
  warna: string;
  ikon: string;
  pesan: string;
  logicType: RuleLogic;
  conditions: RuleCondition[];
  aksi: RuleAction;
  jenisRule?: RuleType;
  severity?: RuleSeverity;
  penjamin?: string;
  berlakuUntuk?: string[];
  conditionGroups?: RuleConditionGroup[];
  groupsLogic?: RuleLogic;
  actionConfig?: RuleActionConfig;
  effectiveDate?: string;
  expiredDate?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

export interface BillingCheck {
  id: string;
  noRM: string;
  episodeNo: string;
  namaPasien: string;
  namaFileBilling: string;
  masterTarifId: number;
  masterTarifNama: string;
  penjamin: string;
  kelasTarif: string;
  lamaRawat: number;
  items: BillingCheckItem[];
  ruleResults: BillingRuleResult[];
  totalItem: number;
  itemSesuai: number;
  itemSelisih: number;
  itemTidakDitemukan: number;
  totalBilling: number;
  totalSelisih: number;
  ruleTerpenuhi: number;
  ruleTidakTerpenuhi: number;
  overallStatus: BillingOverallStatus;
  catatan: string;
  checkedById: number;
  checkedByName: string;
  createdAt: number;
}

export interface RestorePoint {
  key: string;
  createdAt: number;
  label: string;
  database: Record<string, any[]>;
}

// ── IPAW Patch Manager ────────────────────────────────────────────────────────

export interface PatchDependency {
  id: string;
  minVersion: string;
}

export interface PatchManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  minIPAWVersion: string;
  dependencies: PatchDependency[];
  checksum?: string;
}

export type PatchStatus = 'active' | 'disabled' | 'error';

export interface PatchRegistryEntry {
  id: string;
  manifest: PatchManifest;
  code: string;
  checksum: string;
  status: PatchStatus;
  installedAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface PatchData {
  key: string;
  patchId: string;
  value: any;
  updatedAt: number;
}

export interface PatchBackup {
  id: string;
  patchId: string;
  createdAt: number;
  action: 'install' | 'update' | 'enable' | 'disable' | 'rollback' | 'uninstall';
  previousRegistry: PatchRegistryEntry | null;
  previousData: PatchData[];
  restorePointCreatedAt?: number;
}

export interface PatchActivityLog {
  id?: number;
  patchId: string;
  patchName: string;
  version: string;
  action: string;
  status: 'Success' | 'Warning' | 'Failed' | 'Info';
  detail: string;
  username: string;
  namaUser: string;
  role: 'superuser' | 'officer' | 'system';
  timestamp: number;
}

// ── Notifikasi Billing Sementara ──────────────────────────────────────────────

export interface NotifikasiBillingStatus {
  id: string;         // episodeNo as key
  noRM: string;
  episodeNo: string;
  estimasiBilling: number;
  sudahDikirim: boolean;
  /** Kelipatan 2 hari rawat yang sedang diproses (2, 4, 6, ...). */
  siklusHariRawat?: number;
  sentAt?: number;
  updatedAt: number;
}

export interface KasirTemplate {
  id?: number;
  namaTemplate: string;
  kategori: string;
  isiTemplate: string;
  aktif: boolean;
  urutan: number;
  createdAt: number;
  updatedAt: number;
}

// ── Uraian Konfirmasi Asuransi ─────────────────────────────────────────────────

export interface UraianRiwayat {
  id: string;
  tanggal: string;
  jam: string;
  uraian: string;
  petugas: string;
}

export interface UraianKonfirmasi {
  noRM: string;
  episodeNo?: string;
  recordKey?: string;
  // Manual fields
  noKartu: string;
  kelasDitempati: string;
  jatahKelas: string;
  apsPenuhSesuai: string;
  tlpAsuransi: string;
  email: string;
  // Riwayat
  riwayat: UraianRiwayat[];
  // Checklist
  konfirmasiMasukDengan: string;
  vitamin: 'dijamin' | 'tidak_dijamin';
  suplemen: 'dijamin' | 'tidak_dijamin';
  nonMedis: 'dijamin' | 'tidak_dijamin';
  herbal: 'dijamin' | 'tidak_dijamin';
  selisihBayar: 'internal' | 'bayar_ditempat';
  benefitAneka: string;
  batasanKonfirmasi: string;
  lma: 'ada' | 'belum_ada';
  jaminan: 'sudah_ada' | 'belum_ada';
  suratPernyataan: 'ada' | 'belum_ada';
  // Meta
  updatedAt: number;
  updatedBy: string;
}

// ── DB Schema ─────────────────────────────────────────────────────────────────

interface EMCDBSchema extends DBSchema {
  users: {
    key: number;
    value: User;
  };
  patients: {
    key: string;
    value: Patient;
  };
  episodes: {
    key: number;
    value: Episode;
    indexes: {
      'noRM': string;
      'episodeNo': string;
    };
  };
  pendings: {
    key: string;
    value: Pending;
    indexes: {
      'noRM': string;
      'episodeNo': string;
      'status': string;
    };
  };
  justInfos: {
    key: string;
    value: JustInfo;
    indexes: {
      'noRM': string;
      'episodeNo': string;
    };
  };
  outlookEmails: {
    key: string;
    value: OutlookEmail;
    indexes: {
      'matchedNoRM': string;
      'receivedAt': string;
    };
  };
  operanShifts: {
    key: string;
    value: OperanShift;
    indexes: {
      'tanggal': string;
    };
  };
  importLogs: {
    key: number;
    value: ImportLog;
  };
  activityLogs: {
    key: number;
    value: ActivityLog;
    indexes: {
      'timestamp': number;
      'username': string;
      'modul': string;
      'status': string;
    };
  };
  settings: {
    key: string;
    value: Setting;
  };
  // v2 stores
  masterTarifs: {
    key: number;
    value: MasterTarif;
  };
  masterTarifItems: {
    key: number;
    value: MasterTarifItem;
    indexes: {
      'masterTarifId': number;
    };
  };
  // v3 stores
  estimasiBiaya: {
    key: string;
    value: EstimasiBiaya;
    indexes: {
      'noRM': string;
    };
  };
  // v4 stores
  syncLogs: {
    key: number;
    value: SyncLog;
  };
  syncOutbox: {
    key: number;
    value: SyncOutboxEntry;
  };
  // v5 stores
  billingRules: {
    key: number;
    value: BillingRule;
  };
  billingChecks: {
    key: string;
    value: BillingCheck;
    indexes: {
      'noRM': string;
    };
  };
  // v7 stores
  notifikasiBilling: {
    key: string;
    value: NotifikasiBillingStatus;
    indexes: {
      'noRM': string;
    };
  };
  // v8 stores
  kasirTemplates: {
    key: number;
    value: KasirTemplate;
  };
  // v9 stores
  uraianKonfirmasi: {
    key: string;
    value: UraianKonfirmasi;
  };
  uraianKonfirmasiEpisodes: {
    key: string;
    value: UraianKonfirmasi;
  };
  // v11 stores
  masterTemplateTindakan: {
    key: string;
    value: MasterTemplateTindakan;
  };
  estimasiTindakan: {
    key: string;
    value: EstimasiTindakan;
    indexes: {
      'noRM': string;
      'status': string;
      'updatedAt': number;
    };
  };
  masterEstimasiTindakan: {
    key: string;
    value: MasterEstimasiTindakan;
  };
  masterEstimasiTarif: {
    key: string;
    value: MasterEstimasiTarif;
  };
  masterEstimasiKategori: {
    key: string;
    value: MasterEstimasiKategori;
  };
  masterEstimasiMappings: {
    key: string;
    value: MasterEstimasiMapping;
  };
  masterEstimasiMeta: {
    key: string;
    value: MasterEstimasiMeta;
  };
  operatingTheatreCache: {
    key: string;
    value: OperatingTheatreCache;
  };
  operatingTheatreCompletedCache: {
    key: string;
    value: OperatingTheatreCompletedCache;
  };
  operatingTheatrePreadmissionCache: {
    key: string;
    value: OperatingTheatrePreadmissionCache;
  };
  operatingTheatreInProgressCache: {
    key: string;
    value: OperatingTheatreInProgressCache;
  };
  checklistMasters: {
    key: string;
    value: ChecklistMaster;
    indexes: {
      'urutan': number;
      'aktif': string;
    };
  };
  checklistEpisodes: {
    key: string;
    value: ChecklistEpisode;
    indexes: {
      'updatedAt': number;
    };
  };
  checklistHistory: {
    key: string;
    value: ChecklistHistory;
    indexes: {
      'selesaiPada': number;
      'episodeNo': string;
    };
  };
  restorePoints: {
    key: string;
    value: RestorePoint;
  };
  patchRegistry: {
    key: string;
    value: PatchRegistryEntry;
  };
  patchData: {
    key: string;
    value: PatchData;
    indexes: {
      'patchId': string;
    };
  };
  patchBackups: {
    key: string;
    value: PatchBackup;
    indexes: {
      'patchId': string;
      'createdAt': number;
    };
  };
  patchActivityLogs: {
    key: number;
    value: PatchActivityLog;
    indexes: {
      'patchId': string;
      'timestamp': number;
    };
  };
}

export type DatabaseMutationAction = 'upsertRecord' | 'deleteRecord';

export interface DatabaseMutation {
  action: DatabaseMutationAction;
  store: string;
  keyField: string;
  record?: any;
  key?: string | number;
}

export type DatabaseMutationListener = (mutation: DatabaseMutation) => void;

const DB_KEY_FIELDS: Record<string, string> = {
  users: 'id',
  patients: 'noRM',
  episodes: 'id',
  pendings: 'id',
  justInfos: 'id',
  outlookEmails: 'id',
  operanShifts: 'id',
  importLogs: 'id',
  activityLogs: 'id',
  settings: 'key',
  masterTarifs: 'id',
  masterTarifItems: 'id',
  estimasiBiaya: 'id',
  syncLogs: 'id',
  billingRules: 'id',
  billingChecks: 'id',
  notifikasiBilling: 'id',
  kasirTemplates: 'id',
  uraianKonfirmasi: 'noRM',
  uraianKonfirmasiEpisodes: 'recordKey',
  masterTemplateTindakan: 'id',
  estimasiTindakan: 'id',
  masterEstimasiTindakan: 'id',
  masterEstimasiTarif: 'id',
  masterEstimasiKategori: 'id',
  masterEstimasiMappings: 'id',
  masterEstimasiMeta: 'key',
  operatingTheatreCache: 'key',
  operatingTheatreCompletedCache: 'key',
  operatingTheatrePreadmissionCache: 'key',
  operatingTheatreInProgressCache: 'key',
  checklistMasters: 'id',
  checklistEpisodes: 'episodeNo',
  checklistHistory: 'id',
  restorePoints: 'key',
  patchRegistry: 'id',
  patchData: 'key',
  patchBackups: 'id',
  patchActivityLogs: 'id',
};

const LOCAL_ONLY_MUTATION_STORES = new Set([
  'syncOutbox',
  'restorePoints',
  'outlookEmails',
]);

let dbMutationListener: DatabaseMutationListener | null = null;
let dbMutationSuppressionDepth = 0;

export function setDatabaseMutationListener(
  listener: DatabaseMutationListener | null,
): void {
  dbMutationListener = listener;
}

export async function withDatabaseMutationSuppressed<T>(
  callback: () => Promise<T>,
): Promise<T> {
  dbMutationSuppressionDepth += 1;
  try {
    return await callback();
  } finally {
    dbMutationSuppressionDepth -= 1;
  }
}

function notifyDatabaseMutation(mutation: DatabaseMutation): void {
  if (
    dbMutationSuppressionDepth > 0 ||
    !dbMutationListener ||
    LOCAL_ONLY_MUTATION_STORES.has(mutation.store)
  ) {
    return;
  }
  try {
    dbMutationListener(mutation);
  } catch {
    // A sync observer must never break the local IndexedDB write.
  }
}

function keyFieldForStore(store: string): string {
  return DB_KEY_FIELDS[store] || 'id';
}

function cloneMutationRecord(value: any, keyField: string, generatedKey?: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = { ...value };
  if (
    (record[keyField] === undefined || record[keyField] === null || record[keyField] === '') &&
    generatedKey !== undefined
  ) {
    record[keyField] = generatedKey;
  }
  return record;
}

function mutationKey(record: any, keyField: string, generatedKey?: any): string | number | undefined {
  const value = record?.[keyField] ?? generatedKey;
  return value === undefined || value === null ? undefined : value;
}

function observeObjectStore(store: any, storeName: string): any {
  if (!store || typeof store !== 'object') return store;
  const keyField = keyFieldForStore(storeName);
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === 'put' || property === 'add') {
        return (...args: any[]) => {
          const value = args[0];
          const requestedKey = args[1];
          const operation = Reflect.get(target, property, target).apply(target, args);
          return Promise.resolve(operation).then((generatedKey: any) => {
            const record = cloneMutationRecord(value, keyField, requestedKey ?? generatedKey);
            notifyDatabaseMutation({
              action: 'upsertRecord',
              store: storeName,
              keyField,
              record,
            });
            return generatedKey;
          });
        };
      }

      if (property === 'delete') {
        return (key: any) => {
          const operation = Reflect.get(target, property, target).call(target, key);
          return Promise.resolve(operation).then((result: any) => {
            notifyDatabaseMutation({
              action: 'deleteRecord',
              store: storeName,
              keyField,
              key,
            });
            return result;
          });
        };
      }

      if (property === 'clear') {
        return (...args: any[]) => {
          // Queue one deletion per existing row. Both requests are issued
          // synchronously so an active IndexedDB transaction stays alive.
          const recordsPromise = target.getAll();
          const operation = Reflect.get(target, property, target).apply(target, args);
          return Promise.all([recordsPromise, operation]).then(([records, result]) => {
            for (const record of records as any[]) {
              const key = mutationKey(record, keyField);
              if (key !== undefined) {
                notifyDatabaseMutation({
                  action: 'deleteRecord',
                  store: storeName,
                  keyField,
                  key,
                });
              }
            }
            return result;
          });
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function observeTransaction(transaction: any): any {
  if (!transaction || typeof transaction !== 'object') return transaction;
  const storeCache = new Map<string, any>();
  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property === 'store') {
        const storeName = String(target.store?.name || '');
        if (!storeCache.has(storeName)) {
          storeCache.set(storeName, observeObjectStore(target.store, storeName));
        }
        return storeCache.get(storeName);
      }
      if (property === 'objectStore') {
        return (storeName: string) => {
          const name = String(storeName);
          if (!storeCache.has(name)) {
            storeCache.set(name, observeObjectStore(target.objectStore(name), name));
          }
          return storeCache.get(name);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function observeDatabase(database: IDBPDatabase<EMCDBSchema>): IDBPDatabase<EMCDBSchema> {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'transaction') {
        return (...args: any[]) => observeTransaction(
          Reflect.get(target, property, target).apply(target, args),
        );
      }

      if (property === 'put' || property === 'add') {
        return (...args: any[]) => {
          const storeName = String(args[0]);
          const value = args[1];
          const requestedKey = args[2];
          const keyField = keyFieldForStore(storeName);
          const operation = Reflect.get(target, property, target).apply(target, args);
          return Promise.resolve(operation).then((generatedKey: any) => {
            const record = cloneMutationRecord(value, keyField, requestedKey ?? generatedKey);
            notifyDatabaseMutation({
              action: 'upsertRecord',
              store: storeName,
              keyField,
              record,
            });
            return generatedKey;
          });
        };
      }

      if (property === 'delete') {
        return (storeName: string, key: any) => {
          const operation = target.delete(storeName as any, key);
          return Promise.resolve(operation).then((result: any) => {
            notifyDatabaseMutation({
              action: 'deleteRecord',
              store: String(storeName),
              keyField: keyFieldForStore(String(storeName)),
              key,
            });
            return result;
          });
        };
      }

      if (property === 'clear') {
        return (storeName: string) => {
          const name = String(storeName);
          const keyField = keyFieldForStore(name);
          const recordsPromise = target.getAll(name as any);
          const operation = target.clear(name as any);
          return Promise.all([recordsPromise, operation]).then(([records, result]) => {
            for (const record of records as any[]) {
              const key = mutationKey(record, keyField);
              if (key !== undefined) {
                notifyDatabaseMutation({
                  action: 'deleteRecord',
                  store: name,
                  keyField,
                  key,
                });
              }
            }
            return result;
          });
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

let dbPromise: Promise<IDBPDatabase<EMCDBSchema>> | null = null;

export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<EMCDBSchema>('emc_admission_db', 23, {
      upgrade(db, oldVersion, _newVersion, tx) {
        // v1 stores
        if (!db.objectStoreNames.contains('users')) {
          db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('patients')) {
          db.createObjectStore('patients', { keyPath: 'noRM' });
        }
        if (!db.objectStoreNames.contains('episodes')) {
          const epStore = db.createObjectStore('episodes', { keyPath: 'id', autoIncrement: true });
          epStore.createIndex('noRM', 'noRM');
          epStore.createIndex('episodeNo', 'episodeNo');
        }
        if (!db.objectStoreNames.contains('pendings')) {
          const pendStore = db.createObjectStore('pendings', { keyPath: 'id' });
          pendStore.createIndex('noRM', 'noRM');
          pendStore.createIndex('episodeNo', 'episodeNo');
          pendStore.createIndex('status', 'status');
        }
        if (!db.objectStoreNames.contains('justInfos')) {
          const jiStore = db.createObjectStore('justInfos', { keyPath: 'id' });
          jiStore.createIndex('noRM', 'noRM');
          jiStore.createIndex('episodeNo', 'episodeNo');
        }
        if (!db.objectStoreNames.contains('outlookEmails')) {
          const emailStore = db.createObjectStore('outlookEmails', { keyPath: 'id' });
          emailStore.createIndex('matchedNoRM', 'matchedNoRM');
          emailStore.createIndex('receivedAt', 'receivedAt');
        }
        if (!db.objectStoreNames.contains('operanShifts')) {
          const osStore = db.createObjectStore('operanShifts', { keyPath: 'id' });
          osStore.createIndex('tanggal', 'tanggal');
        }
        if (!db.objectStoreNames.contains('importLogs')) {
          db.createObjectStore('importLogs', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('activityLogs')) {
          db.createObjectStore('activityLogs', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        // v2 stores
        if (!db.objectStoreNames.contains('masterTarifs')) {
          db.createObjectStore('masterTarifs', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('masterTarifItems')) {
          const mtiStore = db.createObjectStore('masterTarifItems', { keyPath: 'id', autoIncrement: true });
          mtiStore.createIndex('masterTarifId', 'masterTarifId');
        }
        // v3 stores
        if (!db.objectStoreNames.contains('estimasiBiaya')) {
          const ebStore = db.createObjectStore('estimasiBiaya', { keyPath: 'id' });
          ebStore.createIndex('noRM', 'noRM');
        }
        // v4 stores
        if (!db.objectStoreNames.contains('syncLogs')) {
          db.createObjectStore('syncLogs', { keyPath: 'id', autoIncrement: true });
        }
        // v21: durable row-level outbox for offline create/update/delete.
        if (!db.objectStoreNames.contains('syncOutbox')) {
          db.createObjectStore('syncOutbox', { keyPath: 'id', autoIncrement: true });
        }
        // v5 stores
        if (!db.objectStoreNames.contains('billingRules')) {
          db.createObjectStore('billingRules', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('billingChecks')) {
          const bcStore = db.createObjectStore('billingChecks', { keyPath: 'id' });
          bcStore.createIndex('noRM', 'noRM');
        }
        // v7 stores
        if (!db.objectStoreNames.contains('notifikasiBilling')) {
          const nbStore = db.createObjectStore('notifikasiBilling', { keyPath: 'id' });
          nbStore.createIndex('noRM', 'noRM');
        }
        // v8 stores
        if (!db.objectStoreNames.contains('kasirTemplates')) {
          db.createObjectStore('kasirTemplates', { keyPath: 'id', autoIncrement: true });
        }
        // v9 stores
        if (!db.objectStoreNames.contains('uraianKonfirmasi')) {
          db.createObjectStore('uraianKonfirmasi', { keyPath: 'noRM' });
        }
        if (!db.objectStoreNames.contains('uraianKonfirmasiEpisodes')) {
          db.createObjectStore('uraianKonfirmasiEpisodes', { keyPath: 'recordKey' });
        }
        // v11: Estimasi Biaya Tindakan
        if (!db.objectStoreNames.contains('masterTemplateTindakan')) {
          db.createObjectStore('masterTemplateTindakan', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('estimasiTindakan')) {
          const etStore = db.createObjectStore('estimasiTindakan', { keyPath: 'id' });
          etStore.createIndex('noRM', 'noRM');
          etStore.createIndex('status', 'status');
          etStore.createIndex('updatedAt', 'updatedAt');
        }
        // v19: data-driven master for procedure estimates.
        if (!db.objectStoreNames.contains('masterEstimasiTindakan')) {
          db.createObjectStore('masterEstimasiTindakan', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('masterEstimasiTarif')) {
          db.createObjectStore('masterEstimasiTarif', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('masterEstimasiKategori')) {
          db.createObjectStore('masterEstimasiKategori', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('masterEstimasiMappings')) {
          db.createObjectStore('masterEstimasiMappings', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('masterEstimasiMeta')) {
          db.createObjectStore('masterEstimasiMeta', { keyPath: 'key' });
        }
        // v13: cache the last successful operating-theatre dashboard response.
        if (!db.objectStoreNames.contains('operatingTheatreCache')) {
          db.createObjectStore('operatingTheatreCache', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('operatingTheatreCompletedCache')) {
          db.createObjectStore('operatingTheatreCompletedCache', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('operatingTheatrePreadmissionCache')) {
          db.createObjectStore('operatingTheatrePreadmissionCache', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('operatingTheatreInProgressCache')) {
          db.createObjectStore('operatingTheatreInProgressCache', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('checklistMasters')) {
          const store = db.createObjectStore('checklistMasters', { keyPath: 'id' });
          store.createIndex('urutan', 'urutan');
          store.createIndex('aktif', 'aktif');
        }
        if (!db.objectStoreNames.contains('checklistEpisodes')) {
          const store = db.createObjectStore('checklistEpisodes', { keyPath: 'episodeNo' });
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('checklistHistory')) {
          const store = db.createObjectStore('checklistHistory', { keyPath: 'id' });
          store.createIndex('selesaiPada', 'selesaiPada');
          store.createIndex('episodeNo', 'episodeNo');
        }
        if (!db.objectStoreNames.contains('restorePoints')) {
          db.createObjectStore('restorePoints', { keyPath: 'key' });
        }
        // v23: additive stores for the offline-first IPAW Patch Manager.
        // Existing patient, user, and operational stores are never recreated
        // or altered by this migration.
        if (!db.objectStoreNames.contains('patchRegistry')) {
          db.createObjectStore('patchRegistry', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('patchData')) {
          const store = db.createObjectStore('patchData', { keyPath: 'key' });
          store.createIndex('patchId', 'patchId');
        }
        if (!db.objectStoreNames.contains('patchBackups')) {
          const store = db.createObjectStore('patchBackups', { keyPath: 'id' });
          store.createIndex('patchId', 'patchId');
          store.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('patchActivityLogs')) {
          const store = db.createObjectStore('patchActivityLogs', { keyPath: 'id', autoIncrement: true });
          store.createIndex('patchId', 'patchId');
          store.createIndex('timestamp', 'timestamp');
        }
        // v10: ensure the rule store exists. Do not recreate an existing store:
        // older installations may already contain user-authored rules.
        if (oldVersion < 10) {
          if (!db.objectStoreNames.contains('billingRules')) {
            db.createObjectStore('billingRules', { keyPath: 'id', autoIncrement: true });
          }
        }
        // v12: extended BillingRule fields are optional and require no store
        // recreation. Keeping the existing object store preserves local rules.
        if (oldVersion < 12 && db.objectStoreNames.contains('billingRules')) {
          const store = tx.objectStore('billingRules');
          void store;
        }
        // v6: add indexes on activityLogs for fast filtering
        // Use the upgrade transaction (tx) directly — never open a new transaction inside upgrade
        if (oldVersion < 6 && db.objectStoreNames.contains('activityLogs')) {
          const store = tx.objectStore('activityLogs');
          if (!store.indexNames.contains('timestamp')) store.createIndex('timestamp', 'timestamp');
          if (!store.indexNames.contains('username')) store.createIndex('username', 'username');
          if (!store.indexNames.contains('modul')) store.createIndex('modul', 'modul');
          if (!store.indexNames.contains('status')) store.createIndex('status', 'status');
        }
        if (db.objectStoreNames.contains('justInfos')) {
          const justInfoStore = tx.objectStore('justInfos');
          if (!justInfoStore.indexNames.contains('episodeNo')) justInfoStore.createIndex('episodeNo', 'episodeNo');
        }
      },
    }).then(database => observeDatabase(database));
  }
  return dbPromise;
};

export const getDB = async () => {
  return await initDB();
};
