import * as XLSX from 'xlsx';
import {
  ChecklistEpisode,
  ChecklistHistory,
  ChecklistMaster,
  ChecklistFieldType,
  OperatingTheatrePatient,
  Patient,
  getDB,
} from './db';
import { generateUUID } from './auth';
import { findUniqueMatchingPatient } from './patientIdentity';
import { formatDateTime } from './utils';

export const DEFAULT_CHECKLIST_MASTERS: Omit<ChecklistMaster, 'createdAt' | 'updatedAt'>[] = [
  { id: 'cek-kelas-kamar', nama: 'Cek Kelas Kamar', tipe: 'checkbox', pilihan: [], wajib: true, aktif: true, urutan: 1, reminderAktif: false },
  { id: 'verifikasi-penjamin', nama: 'Verifikasi Penjamin', tipe: 'checkbox', pilihan: [], wajib: true, aktif: true, urutan: 2, reminderAktif: false },
  { id: 'nomor-hp-penanggung-jawab', nama: 'Nomor HP Penanggung Jawab', tipe: 'phone', pilihan: [], wajib: true, aktif: true, urutan: 3, reminderAktif: false },
  { id: 'verifikasi-dpjp', nama: 'Verifikasi DPJP', tipe: 'checkbox', pilihan: [], wajib: true, aktif: true, urutan: 4, reminderAktif: false },
  { id: 'rencana-tindakan', nama: 'Ada Rencana Tindakan?', tipe: 'yesno', pilihan: [], wajib: true, aktif: true, urutan: 5, reminderAktif: false },
  { id: 'tanggal-rencana-tindakan', nama: 'Tanggal Rencana Tindakan', tipe: 'date', pilihan: [], wajib: true, aktif: true, urutan: 6, reminderAktif: true, kondisi: { fieldId: 'rencana-tindakan', operator: 'equals', value: 'Ya' } },
  { id: 'jam-tindakan', nama: 'Jam Tindakan', tipe: 'time', pilihan: [], wajib: false, aktif: true, urutan: 7, reminderAktif: false, kondisi: { fieldId: 'rencana-tindakan', operator: 'equals', value: 'Ya' } },
  { id: 'billing-tindakan', nama: 'Billing Tindakan Sudah Dicek', tipe: 'checkbox', pilihan: [], wajib: true, aktif: true, urutan: 8, reminderAktif: false, kondisi: { fieldId: 'rencana-tindakan', operator: 'equals', value: 'Ya' } },
  { id: 'billing-awal', nama: 'Billing Awal Sudah Dicek', tipe: 'checkbox', pilihan: [], wajib: true, aktif: true, urutan: 9, reminderAktif: false },
  { id: 'kirim-estimasi', nama: 'Kirim Estimasi Biaya', tipe: 'checkbox', pilihan: [], wajib: false, aktif: true, urutan: 10, reminderAktif: false },
  { id: 'catatan-admission', nama: 'Catatan Admission', tipe: 'textarea', pilihan: [], wajib: false, aktif: true, urutan: 11, reminderAktif: false },
];

export type ChecklistStatus = 'terlambat' | 'reminder' | 'belum_selesai' | 'selesai';

export interface ChecklistView extends ChecklistEpisode {
  patient: Patient;
  masters: ChecklistMaster[];
  visibleMasters: ChecklistMaster[];
  completedCount: number;
  totalRequired: number;
  status: ChecklistStatus;
  hasPlan: boolean;
  daysInCare: number;
  billingActionReminderToday: boolean;
  billingActionOverdue: boolean;
}

function valueText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

export function dateKey(value: string | number | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const serial = Number(value);
    // Excel stores a date as days since 1899-12-30. This is common after
    // importing the inpatient list from an .xlsx file.
    if (serial >= 20_000 && serial <= 100_000) {
      const excelDate = new Date(1899, 11, 30);
      excelDate.setDate(excelDate.getDate() + Math.floor(serial));
      return dateKey(excelDate);
    }
  }
  const raw = String(value).trim();
  const iso = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const local = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (local) {
    const year = Number(local[3]) < 100 ? Number(local[3]) + 2000 : Number(local[3]);
    return `${year}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  }
  const named = raw.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s,]*(\d{2,4})/);
  if (named) {
    const months: Record<string, number> = {
      jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maart: 3, apr: 4,
      april: 4, may: 5, mei: 5, jun: 6, juni: 6, jul: 7, juli: 7,
      aug: 8, agustus: 8, sep: 9, sept: 9, september: 9, oct: 10,
      oktober: 10, nov: 11, november: 11, dec: 12, desember: 12,
    };
    const month = months[named[2].toLowerCase()];
    if (month) {
      const year = Number(named[3]) < 100 ? Number(named[3]) + 2000 : Number(named[3]);
      return `${year}-${String(month).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
    }
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? ''
    : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function todayKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysBetween(start: string, end = todayKey()): number {
  const a = new Date(`${start}T12:00:00`).getTime();
  const b = new Date(`${end}T12:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

function isActivePatient(patient: Patient): boolean {
  const status = valueText(patient.status).toLowerCase().replace(/[\s-]+/g, '_');
  // Checklist must be driven by an explicit current inpatient status. An
  // empty/unknown status is not proof that the patient is still hospitalized.
  return ['aktif', 'active', 'current'].includes(status);
}

function isEligibleAdmissionDate(value: string | number | Date): boolean {
  const admission = dateKey(value);
  if (!admission) return false;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return admission <= dateKey(yesterday);
}

function isEligibleActionDate(value: string | number | Date | null | undefined): boolean {
  if (!value) return false;
  const actionDate = dateKey(value);
  if (!actionDate) return false;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return actionDate <= dateKey(yesterday);
}

function addDaysKey(value: string, days: number): string {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setDate(parsed.getDate() + days);
  return dateKey(parsed);
}

export function getActionBillingReminderState(
  actionDate: string | number | Date | null | undefined,
): 'overdue' | 'today' | null {
  const normalized = dateKey(actionDate);
  if (!normalized) return null;
  const dueDate = addDaysKey(normalized, 1);
  if (!dueDate) return null;
  if (dueDate < todayKey()) return 'overdue';
  if (dueDate === todayKey()) return 'today';
  return null;
}

function isVisible(master: ChecklistMaster, answers: Record<string, string>): boolean {
  if (!master.kondisi) return true;
  return valueText(answers[master.kondisi.fieldId]).toLowerCase() === master.kondisi.value.toLowerCase();
}

export function isChecklistAnswerComplete(master: ChecklistMaster, value: string | undefined): boolean {
  const answer = valueText(value).toLowerCase();
  if (master.tipe === 'checkbox') return answer === 'true' || answer === 'ya' || answer === '1';
  // A yes/no answer is only complete when the requested action/verification
  // is confirmed with "Ya". "Tidak", "Belum", and an empty answer remain
  // pending so the episode cannot be moved to checklist history.
  if (master.tipe === 'yesno') return answer === 'ya';
  return Boolean(answer);
}

function reminderState(master: ChecklistMaster, value: string | undefined): 'overdue' | 'today' | null {
  if (!master.reminderAktif || !valueText(value)) return null;
  const key = dateKey(value);
  if (!key) return null;
  if (key < todayKey()) return 'overdue';
  if (key === todayKey()) return 'today';
  return null;
}

export function getVisibleMasters(masters: ChecklistMaster[], answers: Record<string, string>): ChecklistMaster[] {
  return masters.filter(master => master.aktif && isVisible(master, answers)).sort((a, b) => a.urutan - b.urutan);
}

export function getChecklistStatus(
  masters: ChecklistMaster[],
  answers: Record<string, string>,
): { status: ChecklistStatus; completedCount: number; totalRequired: number; overdue: boolean; reminderToday: boolean } {
  const visible = getVisibleMasters(masters, answers);
  const required = visible.filter(master => master.wajib);
  const completedCount = visible.filter(master => isChecklistAnswerComplete(master, answers[master.id])).length;
  // A reminder-enabled date field represents a deadline. The date may already
  // be filled while other required checklist items are still pending, so do
  // not require the reminder field itself to be empty before surfacing its
  // overdue/today state.
  const billingActionPending = !['true', 'ya', '1'].includes(
    valueText(answers['billing-tindakan']).toLowerCase(),
  );
  const actionBillingReminder = valueText(answers['rencana-tindakan']).toLowerCase() === 'ya' && billingActionPending
    ? getActionBillingReminderState(answers['tanggal-rencana-tindakan'])
    : null;
  // The action date is the source date for the H+1 billing task. It should
  // not raise a generic reminder on the operation date itself.
  const deadlineMasters = visible.filter(master => master.id !== 'tanggal-rencana-tindakan');
  const overdue = deadlineMasters.some(master => reminderState(master, answers[master.id]) === 'overdue') ||
    actionBillingReminder === 'overdue';
  const reminderToday = deadlineMasters.some(master => reminderState(master, answers[master.id]) === 'today') ||
    actionBillingReminder === 'today';
  const complete = required.every(master => isChecklistAnswerComplete(master, answers[master.id]));
  return {
    status: complete ? 'selesai' : overdue ? 'terlambat' : reminderToday ? 'reminder' : 'belum_selesai',
    completedCount,
    totalRequired: required.length,
    overdue,
    reminderToday,
  };
}

function patientToEpisode(patient: Patient, current?: ChecklistEpisode): ChecklistEpisode {
  const actionDate = current?.tanggalRencanaTindakan || current?.answers?.['tanggal-rencana-tindakan'];
  const noHpPJ = valueText(patient.noHpPJ) || valueText(current?.answers?.['nomor-hp-penanggung-jawab']);
  return {
    episodeNo: patient.episodeNo,
    noRM: patient.noRM,
    namaPasien: patient.namaPasien,
    tanggalMasuk: patient.admissionDate,
    penjamin: patient.payor,
    dpjp: patient.dpjp,
    ruangan: [patient.ward, patient.roomName, patient.bedCode].filter(Boolean).join(' / '),
    createdAt: current?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    answers: {
      ...(current?.answers ?? {}),
      ...(noHpPJ ? { 'nomor-hp-penanggung-jawab': noHpPJ } : {}),
      ...(actionDate
        ? {
            'rencana-tindakan': current?.answers?.['rencana-tindakan'] || 'Ya',
            'tanggal-rencana-tindakan': dateKey(actionDate),
          }
        : {}),
    },
    catatan: current?.catatan ?? '',
    ...(actionDate ? { tanggalRencanaTindakan: dateKey(actionDate) } : {}),
    ...(current?.rencanaTindakanSumber ? { rencanaTindakanSumber: current.rencanaTindakanSumber } : {}),
    ...(current?.rencanaTindakanSourceId ? { rencanaTindakanSourceId: current.rencanaTindakanSourceId } : {}),
  };
}

export async function ensureDefaultChecklistMasters(): Promise<ChecklistMaster[]> {
  const db = await getDB();
  let masters = await db.getAll('checklistMasters');
  if (!masters.length) {
    const now = Date.now();
    masters = DEFAULT_CHECKLIST_MASTERS.map(master => ({ ...master, createdAt: now, updatedAt: now }));
    await Promise.all(masters.map(master => db.put('checklistMasters', master)));
  } else if (!masters.some(master => master.id === 'billing-tindakan')) {
    // Add the action-billing item to installations that already had the
    // original checklist master without overwriting custom master changes.
    const now = Date.now();
    const billingActionMaster = DEFAULT_CHECKLIST_MASTERS.find(master => master.id === 'billing-tindakan');
    if (billingActionMaster) {
      const added = { ...billingActionMaster, createdAt: now, updatedAt: now };
      await db.put('checklistMasters', added);
      masters = [...masters, added];
    }
  }
  return masters.sort((a, b) => a.urutan - b.urutan);
}

export async function getChecklistMasters(): Promise<ChecklistMaster[]> {
  const db = await getDB();
  const masters = await db.getAll('checklistMasters');
  return masters.sort((a, b) => a.urutan - b.urutan);
}

export async function saveChecklistMaster(master: ChecklistMaster): Promise<void> {
  const db = await getDB();
  await db.put('checklistMasters', { ...master, nama: master.nama.trim(), updatedAt: Date.now() });
}

export async function deleteChecklistMaster(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('checklistMasters', id);
}

export async function getChecklistEpisodes(): Promise<ChecklistEpisode[]> {
  const db = await getDB();
  return db.getAll('checklistEpisodes');
}

export async function savePatientActionPlan(patient: Patient, actionDate: string): Promise<ChecklistEpisode> {
  const normalizedDate = dateKey(actionDate);
  if (!normalizedDate) throw new Error('Tanggal rencana tindakan tidak valid.');
  const db = await getDB();
  const current = await db.get('checklistEpisodes', patient.episodeNo);
  const episode = patientToEpisode(patient, current);
  const updated: ChecklistEpisode = {
    ...episode,
    tanggalRencanaTindakan: normalizedDate,
    rencanaTindakanSumber: 'manual',
    rencanaTindakanSourceId: undefined,
    answers: {
      ...episode.answers,
      'rencana-tindakan': 'Ya',
      'tanggal-rencana-tindakan': normalizedDate,
    },
    updatedAt: Date.now(),
  };
  await db.put('checklistEpisodes', updated);
  return updated;
}

/**
 * Synchronize planned Operating Theatre actions into the centralized
 * inpatient checklist. Ambiguous or incomplete identity matches are skipped.
 */
export async function syncOperatingTheatreActionPlans(
  patients: Patient[],
  plannedPatients: Pick<OperatingTheatrePatient, 'id' | 'noRM' | 'episodeNo' | 'namaPasien' | 'tanggalOperasi'>[],
): Promise<number> {
  const db = await getDB();
  const activePatients = patients.filter(patient => isActivePatient(patient) && valueText(patient.episodeNo));
  const plansByEpisode = new Map<string, { actionDate: string; sourceId: string }>();

  for (const plan of plannedPatients) {
    const actionDate = dateKey(plan.tanggalOperasi);
    if (!actionDate) continue;
    const matched = findUniqueMatchingPatient(activePatients, plan);
    if (!matched) continue;
    const previous = plansByEpisode.get(matched.episodeNo);
    if (!previous || actionDate < previous.actionDate) {
      plansByEpisode.set(matched.episodeNo, { actionDate, sourceId: plan.id });
    }
  }

  let changed = 0;
  for (const [episodeNo, plan] of plansByEpisode) {
    const patient = activePatients.find(item => item.episodeNo === episodeNo);
    if (!patient) continue;
    const current = await db.get('checklistEpisodes', episodeNo);
    const episode = patientToEpisode(patient, current);
    const currentDate = dateKey(current?.tanggalRencanaTindakan || current?.answers?.['tanggal-rencana-tindakan']);
    const dateChanged = currentDate !== plan.actionDate;
    const updated: ChecklistEpisode = {
      ...episode,
      tanggalRencanaTindakan: plan.actionDate,
      rencanaTindakanSumber: 'operating_theatre',
      rencanaTindakanSourceId: plan.sourceId,
      answers: {
        ...episode.answers,
        'rencana-tindakan': 'Ya',
        'tanggal-rencana-tindakan': plan.actionDate,
        ...(dateChanged ? { 'billing-tindakan': 'false' } : {}),
      },
      updatedAt: Date.now(),
    };
    if (
      !current ||
      current.tanggalRencanaTindakan !== updated.tanggalRencanaTindakan ||
      current.rencanaTindakanSumber !== updated.rencanaTindakanSumber ||
      current.rencanaTindakanSourceId !== updated.rencanaTindakanSourceId ||
      dateChanged
    ) {
      await db.put('checklistEpisodes', updated);
      changed += 1;
    }
  }
  return changed;
}

export async function getChecklistHistory(): Promise<ChecklistHistory[]> {
  const db = await getDB();
  return (await db.getAll('checklistHistory')).sort((a, b) => b.selesaiPada - a.selesaiPada);
}

export async function syncChecklistPatients(patients: Patient[], masters: ChecklistMaster[]): Promise<ChecklistView[]> {
  const db = await getDB();
  const [existing, history] = await Promise.all([
    db.getAll('checklistEpisodes'),
    db.getAll('checklistHistory'),
  ]);
  const existingMap = new Map(existing.map(item => [item.episodeNo, item]));
  const latestHistoryByEpisode = new Map<string, ChecklistHistory>();
  for (const item of history) {
    const previous = latestHistoryByEpisode.get(item.episodeNo);
    if (!previous || item.selesaiPada > previous.selesaiPada) latestHistoryByEpisode.set(item.episodeNo, item);
  }
  const result: ChecklistView[] = [];
  for (const patient of patients.filter(item => isActivePatient(item) && valueText(item.episodeNo))) {
    const current = existingMap.get(patient.episodeNo);
    // Include admissions from yesterday and earlier. Patients admitted today
    // are intentionally held back until the next day.
    if (!isEligibleAdmissionDate(patient.admissionDate) && !isEligibleActionDate(current?.tanggalRencanaTindakan)) continue;
    // A completed/archived episode is kept out of the active list by its
    // history entry, even though the patient may still be hospitalized.
    const previousHistory = latestHistoryByEpisode.get(patient.episodeNo);
    const actionDate = current?.tanggalRencanaTindakan || current?.answers?.['tanggal-rencana-tindakan'];
    const previousActionDate = previousHistory?.answers?.['tanggal-rencana-tindakan'];
    // A new action plan starts a new checklist cycle for an episode that may
    // already have an older completed admission checklist.
    if (previousHistory && (!actionDate || dateKey(actionDate) === dateKey(previousActionDate))) continue;
    const episode = patientToEpisode(patient, current);
    if (!current) await db.put('checklistEpisodes', episode);
    else if (current.noRM !== patient.noRM || current.namaPasien !== patient.namaPasien || current.dpjp !== patient.dpjp || current.ruangan !== episode.ruangan) await db.put('checklistEpisodes', episode);
    const status = getChecklistStatus(masters, episode.answers);
    const billingActionPending = !['true', 'ya', '1'].includes(
      valueText(episode.answers['billing-tindakan']).toLowerCase(),
    );
    const actionBillingReminder = billingActionPending
      ? getActionBillingReminderState(
          episode.answers['tanggal-rencana-tindakan'] || episode.tanggalRencanaTindakan,
        )
      : null;
    if (status.status === 'selesai') continue;
    result.push({
      ...episode,
      patient,
      masters,
      visibleMasters: getVisibleMasters(masters, episode.answers),
      completedCount: status.completedCount,
      totalRequired: status.totalRequired,
      status: status.status,
      hasPlan: valueText(episode.answers['rencana-tindakan']).toLowerCase() === 'ya',
      daysInCare: daysBetween(dateKey(episode.tanggalMasuk)),
      billingActionReminderToday: actionBillingReminder === 'today',
      billingActionOverdue: actionBillingReminder === 'overdue',
    });
  }
  return result;
}

export async function saveChecklistEpisode(
  episode: ChecklistEpisode,
  masters: ChecklistMaster[],
  userName: string,
): Promise<{ completed: boolean; history?: ChecklistHistory }> {
  const db = await getDB();
  const patient = await db.get('patients', episode.noRM);
  if (!patient || !isActivePatient(patient) || patient.episodeNo !== episode.episodeNo) {
    throw new Error('Pasien sudah tidak aktif rawat inap. Checklist tidak dapat diproses.');
  }
  const existingHistory = await db.getAll('checklistHistory');
  const hasCompletedCurrentCycle = existingHistory.some(item => {
    if (item.episodeNo !== episode.episodeNo) return false;
    const completedActionDate = dateKey(item.answers?.['tanggal-rencana-tindakan']);
    const currentActionDate = dateKey(
      episode.tanggalRencanaTindakan || episode.answers?.['tanggal-rencana-tindakan'],
    );
    // A changed action date intentionally starts a new checklist cycle.
    return completedActionDate === currentActionDate;
  });
  if (hasCompletedCurrentCycle) {
    throw new Error('Checklist pasien ini sudah pernah diproses.');
  }
  const updated = { ...episode, updatedAt: Date.now() };
  const noHpPJ = valueText(updated.answers['nomor-hp-penanggung-jawab']);
  if (noHpPJ !== valueText(patient.noHpPJ)) {
    await db.put('patients', { ...patient, noHpPJ, updatedAt: Date.now() });
  }
  const status = getChecklistStatus(masters, updated.answers);
  if (status.status !== 'selesai') {
    await db.put('checklistEpisodes', updated);
    return { completed: false };
  }
  const history: ChecklistHistory = {
    id: generateUUID(),
    episodeNo: updated.episodeNo,
    noRM: updated.noRM,
    namaPasien: updated.namaPasien,
    tanggalMasuk: updated.tanggalMasuk,
    penjamin: updated.penjamin,
    dpjp: updated.dpjp,
    ruangan: updated.ruangan,
    answers: updated.answers,
    catatan: updated.catatan,
    rencanaTindakanSumber: updated.rencanaTindakanSumber,
    rencanaTindakanSourceId: updated.rencanaTindakanSourceId,
    selesaiPada: Date.now(),
    selesaiOleh: userName,
    tipeSelesai: 'selesai',
    lamaPenyelesaianHari: daysBetween(dateKey(updated.tanggalMasuk)),
  };
  await db.put('checklistHistory', history);
  await db.delete('checklistEpisodes', updated.episodeNo);
  return { completed: true, history };
}

export async function archiveChecklistEpisode(episode: ChecklistEpisode, userName: string): Promise<void> {
  const db = await getDB();
  const masters = await ensureDefaultChecklistMasters();
  const status = getChecklistStatus(masters, episode.answers);
  if (status.status !== 'selesai') {
    throw new Error('Checklist belum selesai. Semua item wajib harus dijawab Ya atau dicentang sebelum masuk riwayat.');
  }
  const history: ChecklistHistory = {
    id: generateUUID(),
    episodeNo: episode.episodeNo,
    noRM: episode.noRM,
    namaPasien: episode.namaPasien,
    tanggalMasuk: episode.tanggalMasuk,
    penjamin: episode.penjamin,
    dpjp: episode.dpjp,
    ruangan: episode.ruangan,
    answers: episode.answers,
    catatan: episode.catatan,
    rencanaTindakanSumber: episode.rencanaTindakanSumber,
    rencanaTindakanSourceId: episode.rencanaTindakanSourceId,
    selesaiPada: Date.now(),
    selesaiOleh: userName,
    tipeSelesai: 'arsip_manual',
    lamaPenyelesaianHari: daysBetween(dateKey(episode.tanggalMasuk)),
  };
  await db.put('checklistHistory', history);
  await db.delete('checklistEpisodes', episode.episodeNo);
}

export function exportChecklistHistoryExcel(history: ChecklistHistory[]): void {
  const rows = history.map(item => ({
    'Nama Pasien': item.namaPasien,
    'No. RM': item.noRM,
    'No. Episode': item.episodeNo,
    'Tanggal Masuk': item.tanggalMasuk,
    'Tanggal Selesai': formatDateTime(item.selesaiPada),
    'Diselesaikan Oleh': item.selesaiOleh,
    'Lama Penyelesaian (Hari)': item.lamaPenyelesaianHari,
    Catatan: item.catatan,
    Jawaban: JSON.stringify(item.answers),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'History Checklist');
  XLSX.writeFile(workbook, `history-checklist-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function checklistFieldLabel(type: ChecklistFieldType): string {
  return {
    checkbox: 'Checkbox',
    yesno: 'Ya / Tidak',
    text: 'Text',
    textarea: 'Text Area',
    number: 'Angka',
    dropdown: 'Dropdown',
    date: 'Tanggal',
    time: 'Jam',
    datetime: 'Date Time',
    phone: 'Nomor Telepon',
  }[type];
}