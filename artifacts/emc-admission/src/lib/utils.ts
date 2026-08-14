import { twMerge } from 'tailwind-merge';

import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type DateValue = string | number | Date | null | undefined;

function parseDateValue(value: DateValue): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Parse date-only values as local dates so timezone conversion cannot shift
  // a displayed hospital date to the previous/next day.
  let match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    const parsed = new Date(year, Number(match[2]) - 1, Number(match[1]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const monthNames: Record<string, number> = {
    januari: 0,
    februari: 1,
    maret: 2,
    april: 3,
    mei: 4,
    juni: 5,
    juli: 6,
    agustus: 7,
    september: 8,
    oktober: 9,
    november: 10,
    desember: 11,
  };
  match = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/i);
  if (match) {
    const month = monthNames[match[2].toLowerCase()];
    if (month !== undefined) {
      const parsed = new Date(Number(match[3]), month, Number(match[1]));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** Display-only date formatter used throughout the application. */
export function formatDate(value: DateValue): string {
  const parsed = parseDateValue(value);
  if (!parsed) return typeof value === 'string' && value.trim() ? value.trim() : '-';
  return `${twoDigits(parsed.getDate())}/${twoDigits(parsed.getMonth() + 1)}/${parsed.getFullYear()}`;
}

/** Display-only timestamp formatter used throughout the application. */
export function formatDateTime(value: DateValue): string {
  const parsed = parseDateValue(value);
  if (!parsed) return formatDate(value);
  return `${formatDate(parsed)} ${twoDigits(parsed.getHours())}:${twoDigits(parsed.getMinutes())}`;
}
