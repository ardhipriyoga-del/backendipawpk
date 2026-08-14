/**
 * Client-side KTM HTML parser.
 *
 * Port dari artifacts/api-server/src/routes/ktm.ts agar monitoring KTM bisa
 * melakukan direct browser fetch ke TrakCare tanpa memerlukan backend proxy.
 *
 * Digunakan ketika hasTrakCareProxy() = false (misal Netlify tanpa internal server)
 * dan browser pengguna terhubung ke jaringan internal RS EMC.
 */

export interface KTMPatientParsed {
  noRM: string;
  episodeNo: string;
  namaPasien: string;
  ruangan: string;
  kelas: string;
  dpjp: string;
  tanggalKTM: string;
  jamKTM: string;
  tanggalJamKTM: string;
  ward: string;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function splitByBr(html: string): string[] {
  return html
    .replace(/<br\s*\/?>/gi, '|')
    .split('|')
    .map((s) => stripTags(s).trim())
    .filter(Boolean);
}

export function parseKTMPatients(html: string): KTMPatientParsed[] {
  const mapped = parseKTMPatientsByHeaders(html);
  return mapped.length > 0 ? mapped : parseLegacyKTMPatients(html);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function normaliseHeader(value: string): string {
  return decodeEntities(stripTags(value))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function cellText(cell: string): string {
  return decodeEntities(stripTags(cell.replace(/<br\s*\/?>/gi, ' ')))
    .replace(/\s+/g, ' ')
    .trim();
}

function headerIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) =>
    aliases.some((alias) => header === alias || header.includes(alias)),
  );
}

function splitDateTime(date: string, time: string): {
  tanggalKTM: string;
  jamKTM: string;
  tanggalJamKTM: string;
} {
  const rawDate = date.trim();
  const rawTime = time.trim();
  if (!rawTime && /\s+\d{1,2}:\d{2}/.test(rawDate)) {
    const match = rawDate.match(/^(.*?)\s+(\d{1,2}:\d{2}(?::\d{2})?)$/);
    if (match) return { tanggalKTM: match[1], jamKTM: match[2], tanggalJamKTM: rawDate };
  }
  return {
    tanggalKTM: rawDate,
    jamKTM: rawTime,
    tanggalJamKTM: [rawDate, rawTime].filter(Boolean).join(' '),
  };
}

function parseKTMPatientsByHeaders(html: string): KTMPatientParsed[] {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]);
  const sources = tables.length > 0 ? tables : [html];
  const patients: KTMPatientParsed[] = [];

  for (const table of sources) {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
    const headerRow = rows.find((row) => /<th\b/i.test(row));
    if (!headerRow) continue;
    const headers = [...headerRow.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
      .map((m) => normaliseHeader(m[1]));
    if (headers.length === 0) continue;

    const dateIndex = headerIndex(headers, ['date', 'tanggal']);
    const timeIndex = headerIndex(headers, ['time', 'waktu']);
    const nameIndex = headerIndex(headers, ['name', 'patient name', 'nama pasien']);
    const episodeIndex = headerIndex(headers, ['current episode', 'episode rawat inap', 'episode']);
    const doctorIndex = headerIndex(headers, ['primary doctor', 'dpjp']);
    const roomIndex = headerIndex(headers, ['ward class room', 'ward/class/room', 'ruangan pas']);
    const mrnIndex = headerIndex(headers, ['mrn', 'medical record number', 'no rm', 'no. rm', 'rm']);

    // Header-aware mapping is only accepted when the requested KTM columns
    // are present. This prevents unrelated tables on the page from becoming
    // false KTM records.
    if (dateIndex < 0 || timeIndex < 0 || nameIndex < 0 || episodeIndex < 0 || doctorIndex < 0 || roomIndex < 0) {
      continue;
    }

    for (const row of rows) {
      if (row === headerRow || /<th\b/i.test(row)) continue;
      const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
      if (cells.length === 0) continue;
      const valueAt = (index: number) => index >= 0 && index < cells.length ? cellText(cells[index]) : '';
      const namaPasien = valueAt(nameIndex);
      const episodeNo = valueAt(episodeIndex);
      if (!namaPasien || !episodeNo) continue;

      const mrn = valueAt(mrnIndex);
      const noRM = /^\d{6,8}$/.test(mrn)
        ? mrn
        : cells.map(cellText).find((value) => /^\d{6,8}$/.test(value)) || '';
      const dateTime = splitDateTime(valueAt(dateIndex), valueAt(timeIndex));
      const ruangan = valueAt(roomIndex);
      patients.push({
        noRM,
        episodeNo,
        namaPasien,
        ruangan,
        kelas: '',
        dpjp: valueAt(doctorIndex),
        ...dateTime,
        ward: ruangan,
      });
    }
  }

  return patients;
}

function parseLegacyKTMPatients(html: string): KTMPatientParsed[] {
  const patients: KTMPatientParsed[] = [];

  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const bodyContent = tbodyMatch ? tbodyMatch[1] : html;

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(bodyContent)) !== null) {
    const rowHTML = rowMatch[1];
    if (/<th[^>]*>/i.test(rowHTML)) continue;

    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowHTML)) !== null) {
      cells.push(cellMatch[1]);
    }

    if (cells.length < 4) continue;

    if (cells.length >= 6) {
      let noRM = '';
      let episodeNo = '';
      let namaPasien = '';
      let ruangan = '';
      let kelas = '';
      let dpjp = '';
      let tanggalJamKTM = '';
      let ward = '';

      for (let i = 0; i < cells.length; i++) {
        const text = stripTags(cells[i]).trim();
        const parts = splitByBr(cells[i]);
        if (!noRM && /^\d{6,8}$/.test(text)) {
          noRM = text;
          if (parts[1]) episodeNo = parts[1];
          continue;
        }
        if (!noRM && parts.length >= 2 && /^\d{6,8}$/.test(parts[0])) {
          noRM = parts[0];
          episodeNo = parts[1];
          continue;
        }
      }

      if (cells.length >= 8) {
        const wardText = stripTags(cells[0].replace(/<br\s*\/?>/gi, ' ')).trim();
        ward = wardText.split(/\s+PK\s+/)[0] || wardText;
        kelas = stripTags(cells[1]).trim();
        const mrnParts = splitByBr(cells[2]);
        noRM = mrnParts[0] || '';
        episodeNo = mrnParts[1] || '';
        if (!noRM) continue;
        namaPasien = stripTags(cells[3]).trim();
        dpjp = stripTags(cells[7]).trim();
        tanggalJamKTM = stripTags(cells[6]).trim();
        ruangan = wardText;
      } else if (cells.length >= 6) {
        ruangan = stripTags(cells[1]).trim() || stripTags(cells[0]).trim();
        const mrnParts = splitByBr(cells[2]);
        noRM = mrnParts[0] || '';
        episodeNo = mrnParts[1] || '';
        if (!noRM) {
          const alt = splitByBr(cells[1]);
          noRM = alt[0] || '';
          episodeNo = alt[1] || '';
          ruangan = stripTags(cells[0]).trim();
        }
        if (!noRM) continue;
        namaPasien = stripTags(cells[3]).trim();
        dpjp = cells.length > 4 ? stripTags(cells[4]).trim() : '';
        tanggalJamKTM = cells.length > 5 ? stripTags(cells[5]).trim() : '';
        ward = ruangan;
      }

      if (!noRM) continue;

      let tanggalKTM = '';
      let jamKTM = '';
      if (tanggalJamKTM) {
        const parts = tanggalJamKTM.split(/\s+/);
        if (parts.length >= 2) {
          tanggalKTM = parts.slice(0, -1).join(' ');
          jamKTM = parts[parts.length - 1];
        } else {
          tanggalKTM = tanggalJamKTM;
        }
      }

      patients.push({
        noRM,
        episodeNo,
        namaPasien,
        ruangan: ruangan || ward,
        kelas,
        dpjp,
        tanggalKTM,
        jamKTM,
        tanggalJamKTM: tanggalJamKTM || `${tanggalKTM} ${jamKTM}`.trim(),
        ward,
      });
    }
  }

  return patients;
}
