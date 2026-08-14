import type { Patient } from './db';

export interface PatientIdentityReference {
  namaPasien?: string | null;
  noRM?: string | null;
  episodeNo?: string | null;
}

const ALIAS_PREFIX = /^(?:tn|ny|nn|an|by|tuan|nyonya|nona|anak|bayi)\.?\s+/i;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

export function normalizePatientName(value: unknown): string {
  let name = text(value).toLocaleUpperCase('id-ID').replace(/\s+/g, ' ').trim();
  while (ALIAS_PREFIX.test(name)) name = name.replace(ALIAS_PREFIX, '').trim();
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function normalizePatientIdentifier(value: unknown): string {
  return text(value).toLocaleUpperCase('id-ID').replace(/[^A-Z0-9]/g, '');
}

function parseDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  const local = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  let date: Date;
  if (iso) {
    date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  } else if (local) {
    const year = Number(local[3]) < 100 ? Number(local[3]) + 2000 : Number(local[3]);
    date = new Date(year, Number(local[2]) - 1, Number(local[1]));
  } else {
    date = new Date(raw);
  }
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getPatientAge(dob: unknown, today = new Date()): number | null {
  const birth = parseDate(dob);
  if (!birth || birth > today) return null;
  let age = today.getFullYear() - birth.getFullYear();
  if (
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
  ) age -= 1;
  return age >= 0 ? age : null;
}

function isFemale(sex: unknown): boolean {
  return /^(p|perempuan|wanita|female|f|女)$/i.test(text(sex));
}

function isMale(sex: unknown): boolean {
  return /^(l|laki[-\s]?laki|pria|male|m)$/i.test(text(sex));
}

export function getPatientAlias(patient: Pick<Patient, 'dob' | 'sexDesc' | 'namaPasien'>): string {
  const age = getPatientAge(patient.dob);
  if (age !== null && age < 1) return 'By.';
  if (age !== null && age < 18) return 'An.';
  if (isFemale(patient.sexDesc)) {
    // Marital status is not available from the inpatient feed. Preserve an
    // explicit Nn. source alias; otherwise use the application's adult
    // female default, Ny.
    const sourceAlias = text(patient.namaPasien).match(/^(Ny|Nn)\.?\s+/i)?.[1];
    return sourceAlias?.toLowerCase() === 'nn' ? 'Nn.' : 'Ny.';
  }
  if (isMale(patient.sexDesc)) return 'Tn.';

  const original = text(patient.namaPasien);
  const match = original.match(/^(Tn|Ny|Nn|An|By)\.?\s+/i);
  return match ? `${match[1]}.` : '';
}

export function getPatientDisplayName(patient: Pick<Patient, 'dob' | 'sexDesc' | 'namaPasien'>): string {
  const raw = text(patient.namaPasien);
  if (!raw) return '-';
  const name = raw.replace(ALIAS_PREFIX, '').trim() || raw;
  const alias = getPatientAlias(patient);
  return alias ? `${alias} ${name}` : name;
}

/**
 * A record belongs to an inpatient only when the normalized name matches and
 * at least one independent identifier also matches: RM or episode.
 * Name-only, RM-only, and episode-only matches are intentionally rejected.
 */
export function patientIdentityMatches(
  patient: PatientIdentityReference,
  record: PatientIdentityReference,
): boolean {
  const patientName = normalizePatientName(patient.namaPasien);
  const recordName = normalizePatientName(record.namaPasien);
  const patientRM = normalizePatientIdentifier(patient.noRM);
  const recordRM = normalizePatientIdentifier(record.noRM);
  const patientEpisode = normalizePatientIdentifier(patient.episodeNo);
  const recordEpisode = normalizePatientIdentifier(record.episodeNo);
  const fields = [
    [patientName, recordName],
    [patientRM, recordRM],
    [patientEpisode, recordEpisode],
  ] as const;
  const comparable = fields.filter(([left, right]) => left && right);
  const conflicts = comparable.some(([left, right]) => left !== right);
  const matches = comparable.filter(([left, right]) => left === right).length;

  // The accepted pairs are name+RM, name+episode, or RM+episode. A record
  // with any conflicting shared identifier is rejected before pair matching,
  // so a name+RM match cannot override a conflicting episode number.
  return !conflicts && matches >= 2;
}

export function findMatchingPatient<T extends PatientIdentityReference>(
  patients: Patient[],
  record: T,
): Patient | undefined {
  return patients.find(patient => patientIdentityMatches(patient, record));
}

export function findUniqueMatchingPatient<T extends PatientIdentityReference>(
  patients: Patient[],
  record: T,
): Patient | undefined {
  const matches = patients.filter(patient => patientIdentityMatches(patient, record));
  return matches.length === 1 ? matches[0] : undefined;
}

export function patientEpisodeKey(patient: PatientIdentityReference): string {
  return `${normalizePatientIdentifier(patient.noRM)}::${normalizePatientIdentifier(patient.episodeNo)}`;
}