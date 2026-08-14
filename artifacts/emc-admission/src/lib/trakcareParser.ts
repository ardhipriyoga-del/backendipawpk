/**
 * Client-side TrakCare HTML parsers.
 * Runs in the browser (DOMParser + regex), no Node.js dependencies.
 * Used in offline mode (file:// protocol) where backend proxy is unavailable.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

import { normalizeTrakCareBirthDate } from './trakcareDate';

export interface RawInpatientPatient {
  noRM: string;
  episodeNo: string;
  namaPasien: string;
  ward: string;
  roomName: string;
  roomType: string;
  bedCode: string;
  dpjp: string;
  dob: string;
  sexDesc: string;
  payor: string;
  admissionDate: string;
}

export interface RawIGDPatient {
  nama: string;
  noRM: string;
  dokter: string;
  lokasi: string;
  transferDestination: string;
  episode: string;
  dob: string;
  tanggalKedatangan: string;
  penjamin: string;
  timerOutpatient: string;
  timerTransfer: string;
  timerColor: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseWardRoom(text: string): { ward: string; room: string; bed: string } {
  const parts = text.split(/ PK /);
  if (parts.length >= 3) {
    return {
      ward: parts[0].trim(),
      room: `PK ${parts[1].trim()}`,
      bed: `PK ${parts.slice(2).join(' PK ').trim()}`,
    };
  } else if (parts.length === 2) {
    return { ward: parts[0].trim(), room: `PK ${parts[1].trim()}`, bed: '' };
  }
  return { ward: text.trim(), room: text.trim(), bed: '' };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

// ── Inpatient parser (DOMParser) ──────────────────────────────────────────────
// Parses the standard dailyinpatient table (ALL, medical=Y, nurse=Y, pharmacy=Y)

export function parseInpatientHTML(html: string): RawInpatientPatient[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const patients: RawInpatientPatient[] = [];

  doc.querySelectorAll('tbody tr').forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 8) return;

    // col[0]: Ward PK Room PK Bed
    const wardRoomText = (cells[0].textContent ?? '').replace(/\s+/g, ' ').trim();

    // col[1]: Room type/class
    const roomType = cells[1].textContent?.trim() ?? '';

    // col[2]: NoRM <br> EpisodeNo
    const mrnParts = cells[2].innerHTML
      .replace(/<br\s*\/?>/gi, '|')
      .split('|')
      .map(s => s.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);
    const noRM = mrnParts[0] ?? '';
    const episodeNo = mrnParts[1] ?? '';
    if (!noRM) return;

    // col[3]: Patient name
    const namaPasien = cells[3].textContent?.trim() ?? '';

    // col[4]: DOB <br> Sex
    const dobParts = cells[4].innerHTML
      .replace(/<br\s*\/?>/gi, '|')
      .split('|')
      .map(s => s.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);
    const dob = normalizeTrakCareBirthDate(dobParts[0] ?? '');
    const sexDesc = dobParts[1] ?? '';

    // col[5]: Payor
    const payor = cells[5].textContent?.trim() ?? '';

    // col[6]: LOS → derive admission date
    const losMatch = cells[6].textContent?.match(/(\d+)/);
    const losDays = losMatch ? parseInt(losMatch[1], 10) : 0;
    const admissionDate = losDays > 0
      ? new Date(Date.now() - losDays * 86_400_000).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    // col[7]: DPJP
    const dpjp = cells[7].textContent?.trim() ?? '';

    const { ward, room, bed } = parseWardRoom(wardRoomText);

    patients.push({
      noRM, episodeNo, namaPasien,
      ward, roomName: room, roomType, bedCode: bed,
      dpjp, dob, sexDesc, payor, admissionDate,
    });
  });

  return patients;
}

// ── IGD parser ────────────────────────────────────────────────────────────────
// The dashboard currently uses `.patient-card` elements. The legacy parser is
// retained below for downloaded/offline pages built from the former markup.

function textFromClass(element: Element, className: string): string[] {
  return Array.from(element.querySelectorAll(`.${className}`))
    .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function deriveModernIGDLocation(values: string[]): string {
  const meaningful = values.filter((value) => value && value !== '-');
  if (meaningful.length === 0) return '';
  if (meaningful.length >= 2 && /discharge\s+lounge/i.test(meaningful[1])) {
    return meaningful[1];
  }
  if (meaningful.length >= 3 && /^\d+$/.test(meaningful[meaningful.length - 1])) {
    return `${meaningful[meaningful.length - 2]}/${meaningful[meaningful.length - 1]}`;
  }
  return meaningful[1] ?? meaningful[0];
}

function deriveModernIGDDestination(values: string[]): string {
  return values
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => value && value !== '-')
    .join(' / ');
}

function parseModernIGDPatients(html: string): RawIGDPatient[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const patients: RawIGDPatient[] = [];

  doc.querySelectorAll('.patient-card').forEach((card) => {
    const nama = textFromClass(card, 'patient-name')[0] ?? '';
    const noRM = (textFromClass(card, 'mr')[0] ?? '').replace(/^MR\s+/i, '').trim();
    if (!nama || !noRM) return;

    const timerValues = textFromClass(card, 'timer-value');
    const timerNodes = Array.from(card.querySelectorAll('.timer-value'));
    const currentTitle = Array.from(card.querySelectorAll('.flow-title'))
      .find((node) => /CURRENT(?:\s+LOCATION)?/i.test(node.textContent ?? ''));
    const destinationTitle = Array.from(card.querySelectorAll('.flow-title'))
      .find((node) => /DESTINATION/i.test(node.textContent ?? ''));
    const flowValues = Array.from(card.querySelectorAll('.flow-value'))
      .filter((node) => {
        if (!currentTitle) return false;
        const currentPosition = currentTitle.compareDocumentPosition(node);
        const afterCurrent = Boolean(currentPosition & Node.DOCUMENT_POSITION_FOLLOWING);
        const beforeDestination = destinationTitle
          ? Boolean(destinationTitle.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING)
          : true;
        return afterCurrent && beforeDestination;
      })
      .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim());
    const destinationValues = destinationTitle
      ? Array.from(card.querySelectorAll('.flow-value'))
        .filter((node) => Boolean(destinationTitle.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))
        .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())
      : [];

    const priority = Array.from(card.querySelectorAll('.priority-bar'))
      .map((node) => Array.from(node.classList).find((className) => /^priority-/.test(className)) ?? '')[0] ?? '';

    patients.push({
      nama,
      noRM,
      dokter: textFromClass(card, 'doctor')[0] ?? '',
      lokasi: deriveModernIGDLocation(flowValues),
      transferDestination: deriveModernIGDDestination(destinationValues),
      episode: textFromClass(card, 'episode')[0] ?? '',
      dob: normalizeTrakCareBirthDate(textFromClass(card, 'dob')[0] ?? ''),
      tanggalKedatangan: textFromClass(card, 'arrival')[0] ?? '',
      penjamin: textFromClass(card, 'payor')[0] ?? '',
      timerOutpatient: timerValues[0] ?? '--',
      timerTransfer: timerValues[1] ?? '--',
      timerColor: Array.from(timerNodes[1]?.classList ?? []).join(' ') || priority,
    });
  });

  return patients;
}

function parseLegacyIGDHTML(html: string, onlyWithTransfer: boolean): RawIGDPatient[] {
  const patients: RawIGDPatient[] = [];
  const cardBlocks = html.split('<div class="col-md-3 mb-4">').slice(1);

  for (const block of cardBlocks) {
    if (!block.includes('background-color:lavender')) continue;

    // Extract the two timer cells
    const timerRegex = /<div class="col-6 text-center h1\s*([^"]*)">([\s\S]*?)<\/div>/gi;
    const timers: { colorClass: string; value: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = timerRegex.exec(block)) !== null && timers.length < 2) {
      timers.push({ colorClass: m[1].trim(), value: stripTags(m[2]).trim() });
    }
    if (timers.length < 2) continue;

    const timerTransfer = timers[1].value;
    if (onlyWithTransfer && (!timerTransfer || timerTransfer === '--')) continue;

    // Extract patient info rows
    const infoRegex = /<div class="col-12 font-weight-bold[^"]*">([\s\S]*?)<\/div>/gi;
    const infos: string[] = [];
    let im: RegExpExecArray | null;
    while ((im = infoRegex.exec(block)) !== null) {
      const t = stripTags(im[1]).trim();
      if (t) infos.push(t);
    }
    if (infos.length < 2) continue;

    patients.push({
      nama: infos[0] ?? '',
      noRM: infos[1] ?? '',
      dokter: infos[2] ?? '',
      lokasi: infos[3] ?? '',
      transferDestination: '',
      episode: '',
      dob: '',
      tanggalKedatangan: '',
      penjamin: '',
      timerOutpatient: timers[0].value,
      timerTransfer,
      timerColor: timers[1].colorClass,
    });
  }

  return patients;
}

export function parseIGDHTML(html: string): RawIGDPatient[] {
  const modernPatients = parseModernIGDPatients(html);
  if (modernPatients.length > 0) {
    return modernPatients.filter((patient) => patient.timerTransfer !== '--');
  }
  return parseLegacyIGDHTML(html, true);
}

export function parseIGDWardHTML(html: string): RawIGDPatient[] {
  const modernPatients = parseModernIGDPatients(html);
  if (modernPatients.length > 0) return modernPatients;
  return parseLegacyIGDHTML(html, false);
}
