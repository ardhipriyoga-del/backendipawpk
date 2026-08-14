import * as XLSX from 'xlsx';
import {
  getDB,
  MasterEstimasiMapping,
  MasterEstimasiMeta,
  MasterEstimasiTarif,
  MasterEstimasiTindakan,
  EstimasiTindakanKelas,
} from './db';

export const ESTIMASI_KELAS: EstimasiTindakanKelas[] = [
  'KLS III',
  'KLS II',
  'KLS I',
  'DELUXE',
  'SUITE',
];

export const ESTIMASI_KELAS_LABELS: Record<EstimasiTindakanKelas, string> = {
  'KLS III': 'Kelas III',
  'KLS II': 'Kelas II',
  'KLS I': 'Kelas I',
  DELUXE: 'Deluxe',
  SUITE: 'Suite',
};

const clean = (value: unknown) => String(value ?? '').trim();
const headerKey = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');

export function normalizeEstimasiClass(roomType: string): EstimasiTindakanKelas | '' {
  const raw = clean(roomType).toLowerCase();
  const key = headerKey(roomType);
  if (/\b(?:kelas|kls)\s*(?:iii|3)\b/.test(raw) || key.includes('iii') || key.includes('kls3')) return 'KLS III';
  if (/\b(?:kelas|kls)\s*(?:ii|2)\b/.test(raw) || key.includes('klsii') || key.includes('kls2')) return 'KLS II';
  if (/\b(?:kelas|kls)\s*(?:i|1)\b/.test(raw) || key === 'kelasi' || key === 'klsi' || key === 'kls1') return 'KLS I';
  if (key.includes('deluxe') || key.includes('vip')) return 'DELUXE';
  if (key.includes('suite') || key.includes('vvip')) return 'SUITE';
  return '';
}

export function componentKey(value: string): string {
  return clean(value).toLowerCase().replace(/\s+/g, ' ');
}

function numeric(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = clean(value).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${hash >>> 0}-${text.length}`;
}

function rowsFromFile(file: File): Promise<any[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Gagal membaca ${file.name}.`));
    reader.onload = () => {
      try {
        const workbook = XLSX.read(new Uint8Array(reader.result as ArrayBuffer), { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' }));
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function findHeader(rows: any[][], required: string[]): { row: number; columns: Record<string, number> } {
  for (let row = 0; row < Math.min(rows.length, 30); row += 1) {
    const columns: Record<string, number> = {};
    (rows[row] ?? []).forEach((value, index) => {
      const key = headerKey(value);
      const matched = required.find(item => headerKey(item) === key);
      if (matched) columns[matched] = index;
    });
    if (required.every(item => columns[item] !== undefined)) return { row, columns };
  }
  throw new Error(`Header Excel tidak ditemukan. Kolom wajib: ${required.join(', ')}.`);
}

export async function parseEstimasiPenggolongan(file: File): Promise<MasterEstimasiTindakan[]> {
  const rows = await rowsFromFile(file);
  const { row, columns } = findHeader(rows, ['Golongan', 'Tindakan']);
  const result: MasterEstimasiTindakan[] = [];
  const seen = new Set<string>();
  for (const values of rows.slice(row + 1)) {
    const golongan = clean(values[columns.Golongan]);
    const namaTindakan = clean(values[columns.Tindakan]);
    const key = `${golongan.toLowerCase()}|${namaTindakan.toLowerCase()}`;
    if (!golongan || !namaTindakan || seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: `emt-${fingerprint(key)}`,
      namaTindakan,
      golongan,
      aktif: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  if (!result.length) throw new Error('Master Penggolongan tidak memiliki baris tindakan yang valid.');
  return result;
}

export async function parseEstimasiTarif(file: File): Promise<MasterEstimasiTarif[]> {
  const rows = await rowsFromFile(file);
  const { row, columns } = findHeader(rows, ['Golongan', 'Komponen', ...ESTIMASI_KELAS]);
  const result: MasterEstimasiTarif[] = [];
  const seen = new Set<string>();
  for (const values of rows.slice(row + 1)) {
    const golongan = clean(values[columns.Golongan]);
    const komponen = clean(values[columns.Komponen]);
    const key = `${golongan.toLowerCase()}|${componentKey(komponen)}`;
    if (!golongan || !komponen || seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: `emt-${fingerprint(key)}`,
      golongan,
      komponen,
      harga: Object.fromEntries(ESTIMASI_KELAS.map(kelas => [kelas, numeric(values[columns[kelas]])])) as Record<EstimasiTindakanKelas, number>,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  if (!result.length) throw new Error('Master Tarif tidak memiliki baris tarif yang valid.');
  return result;
}

export async function importEstimasiMasters(
  penggolonganFile: File,
  tarifFile: File,
  importedBy: string,
): Promise<{ changed: boolean; actions: number; tariffs: number }> {
  const [actions, tariffs] = await Promise.all([
    parseEstimasiPenggolongan(penggolonganFile),
    parseEstimasiTarif(tarifFile),
  ]);
  const actionFingerprint = fingerprint(
    actions.map(item => ({
      namaTindakan: item.namaTindakan,
      golongan: item.golongan,
      aktif: item.aktif,
    })).sort((a, b) =>
      `${a.golongan}|${a.namaTindakan}`.localeCompare(`${b.golongan}|${b.namaTindakan}`),
    ),
  );
  const tariffFingerprint = fingerprint(
    tariffs.map(item => ({
      golongan: item.golongan,
      komponen: item.komponen,
      harga: item.harga,
    })).sort((a, b) =>
      `${a.golongan}|${a.komponen}`.localeCompare(`${b.golongan}|${b.komponen}`),
    ),
  );
  const db = await getDB();
  const previous = await db.get('masterEstimasiMeta', 'latest');
  if (
    previous?.penggolonganFingerprint === actionFingerprint
    && previous.tarifFingerprint === tariffFingerprint
  ) {
    return { changed: false, actions: actions.length, tariffs: tariffs.length };
  }
  const now = Date.now();
  const tx = db.transaction(
    ['masterEstimasiTindakan', 'masterEstimasiTarif', 'masterEstimasiMeta'],
    'readwrite',
  );
  await tx.objectStore('masterEstimasiTindakan').clear();
  await tx.objectStore('masterEstimasiTarif').clear();
  for (const action of actions) await tx.objectStore('masterEstimasiTindakan').put({ ...action, createdAt: now, updatedAt: now });
  for (const tariff of tariffs) await tx.objectStore('masterEstimasiTarif').put({ ...tariff, createdAt: now, updatedAt: now });
  const meta: MasterEstimasiMeta = {
    key: 'latest',
    penggolonganFingerprint: actionFingerprint,
    tarifFingerprint: tariffFingerprint,
    penggolonganFileName: penggolonganFile.name,
    tarifFileName: tarifFile.name,
    importedBy,
    importedAt: now,
    jumlahTindakan: actions.length,
    jumlahTarif: tariffs.length,
  };
  await tx.objectStore('masterEstimasiMeta').put(meta);
  await tx.done;
  return { changed: true, actions: actions.length, tariffs: tariffs.length };
}

export function findEstimasiTarif(
  tariffs: MasterEstimasiTarif[],
  golongan: string,
  kelas: EstimasiTindakanKelas | '',
): MasterEstimasiTarif[] {
  return tariffs.filter(item => item.golongan.trim().toLowerCase() === golongan.trim().toLowerCase())
    .map(item => ({ ...item, harga: { ...item.harga, ...(kelas ? { [kelas]: item.harga[kelas] } : {}) } }));
}

export async function loadEstimasiMasterData() {
  const db = await getDB();
  const [actions, tariffs, categories, mappings, meta] = await Promise.all([
    db.getAll('masterEstimasiTindakan'),
    db.getAll('masterEstimasiTarif'),
    db.getAll('masterEstimasiKategori'),
    db.getAll('masterEstimasiMappings'),
    db.get('masterEstimasiMeta', 'latest'),
  ]);
  return { actions, tariffs, categories: categories.sort((a, b) => a.urutan - b.urutan), mappings, meta };
}

export type EstimasiMasterData = Awaited<ReturnType<typeof loadEstimasiMasterData>>;

export function mappingForComponent(mappings: MasterEstimasiMapping[], component: string) {
  return mappings.find(item => item.komponenKey === componentKey(component));
}