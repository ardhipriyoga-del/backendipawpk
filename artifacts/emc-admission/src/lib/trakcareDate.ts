const MONTHS: Record<string, number> = {
  januari: 1,
  january: 1,
  februari: 2,
  february: 2,
  maret: 3,
  march: 3,
  april: 4,
  mei: 5,
  may: 5,
  juni: 6,
  june: 6,
  juli: 7,
  july: 7,
  agustus: 8,
  august: 8,
  september: 9,
  oktober: 10,
  october: 10,
  november: 11,
  desember: 12,
  december: 12,
};

function validDate(day: number, month: number, year: number): string | null {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return null;
  }
  if (year < 100) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`;
}

/**
 * Normalizes TrakCare birth dates to the application's display/storage format:
 * DD-MM-YYYY (HH-BB-TTTT).
 */
export function normalizeTrakCareBirthDate(value: unknown): string {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!raw || /^[-—]+$/.test(raw)) return '';

  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    return validDate(Number(match[3]), Number(match[2]), Number(match[1])) ?? raw;
  }

  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (match) {
    return validDate(Number(match[1]), Number(match[2]), Number(match[3])) ?? raw;
  }

  match = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/i);
  if (match) {
    const month = MONTHS[match[2].toLowerCase()];
    return month ? validDate(Number(match[1]), month, Number(match[3])) ?? raw : raw;
  }

  match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) {
    return validDate(Number(match[3]), Number(match[2]), Number(match[1])) ?? raw;
  }

  return raw;
}