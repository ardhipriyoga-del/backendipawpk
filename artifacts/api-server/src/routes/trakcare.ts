import { Router, type IRouter } from "express";

const router: IRouter = Router();

interface OperatingTheatreSession {
  cookies: string;
  updatedAt: number;
  fingerprint: string;
}

const operatingTheatreSessions = new Map<string, OperatingTheatreSession>();

const OPERATING_THEATRE_DASHBOARD_URL =
  "https://apps.emc.id/trakcare/operatingtheatre/otrequest/dashboard/trakcareANLT/hospital/4";
const OPERATING_THEATRE_IN_PROGRESS_URL =
  "https://apps.emc.id/trakcare/operatingtheatre/otrequest/status/list/hospital/4?status=inprogress";

function isInProgressOperatingTheatreUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /\/otrequest\/status\/list(?:\/|$)/i.test(url.pathname)
      || url.searchParams.get("status")?.toLowerCase() === "inprogress";
  } catch {
    return /status\/list|status=inprogress/i.test(value);
  }
}

function operatingTheatreLoginUrl(endpoint: string = OPERATING_THEATRE_DASHBOARD_URL): string {
  const url = new URL(endpoint);
  url.pathname = url.pathname.replace(/\/otrequest\/dashboard\/.*$/i, "/login");
  url.search = `route=trakcare.operatingtheatre.otrequest.dashboard.hospital&url=${encodeURIComponent(endpoint)}`;
  return url.toString();
}

function responseCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [];
  return values.length ? values : (response.headers.get("set-cookie") ?? "").split(/,(?=[^;]+=[^;]+)/);
}

function mergeCookies(existing: string, response: Response): string {
  const jar = new Map<string, string>();
  for (const part of existing.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name && value.length) jar.set(name, `${name}=${value.join("=")}`);
  }
  for (const cookie of responseCookies(response)) {
    const pair = cookie.split(";")[0]?.trim();
    const [name, ...value] = pair.split("=");
    if (name && value.length) jar.set(name, `${name}=${value.join("=")}`);
  }
  return [...jar.values()].join("; ");
}

function stripHtmlText(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function normalizeOtKey(value: string): string {
  return value.toLowerCase().replace(/[\s_.:/()[\]-]+/g, "").replace(/[^a-z0-9]/g, "");
}

function splitCombinedOtIdentity(value: string, allowWhitespace = false): { noRM: string; episodeNo: string } {
  const raw = value.replace(/\s+/g, " ").trim();
  const cleanPart = (part: string, label: "rm" | "episode") => part
    .replace(
      label === "rm"
        ? /^(?:(?:no\.?\s*)?(?:rm|mr)|mrn)\s*[:#-]?\s*/i
        : /^(?:no\.?\s*)?(?:episode|ipk)\s*[:#-]?\s*/i,
      "",
    )
    .trim();
  const labeled = raw.match(
    /^(?:(?:(?:no\.?\s*)?(?:rm|mr)|mrn)\s*[:#-]?\s*([A-Za-z0-9]+).*?(?:no\.?\s*)?(?:episode|ipk)\s*[:#-]?\s*([A-Za-z0-9]+)|(?:no\.?\s*)?(?:episode|ipk)\s*[:#-]?\s*([A-Za-z0-9]+).*?(?:(?:no\.?\s*)?(?:rm|mr)|mrn)\s*[:#-]?\s*([A-Za-z0-9]+))$/i,
  );
  if (labeled) {
    return labeled[1]
      ? { noRM: labeled[1], episodeNo: labeled[2] }
      : { noRM: labeled[4], episodeNo: labeled[3] };
  }
  const parts = raw
    .split(allowWhitespace ? /\s*(?:\||\/|\u2022|\s+)\s*/ : /\s*(?:\||\/|\u2022)\s*/)
    .map(part => part.trim())
    .filter(Boolean);
  return parts.length >= 2
    ? { noRM: cleanPart(parts[0], "rm"), episodeNo: cleanPart(parts[1], "episode") }
    : { noRM: cleanPart(raw, "rm"), episodeNo: "" };
}

function isCombinedIdentityKey(key: string): boolean {
  const normalized = normalizeOtKey(key);
  const recordPart = "(?:nomr|mrn|mr|rm|medicalrecord|rekammedis)";
  const episodePart = "(?:episode|ipk)";
  return new RegExp(
    `(?:${recordPart}).*(?:${episodePart})|(?:${episodePart}).*(?:${recordPart})`,
  ).test(normalized);
}

function normalizePboUrl(raw: string, baseUrl: string): string {
  const value = raw
    .replace(/&amp;/gi, "&")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .trim();
  if (!value || /^(?:javascript:|mailto:|#|data:)/i.test(value)) return "";
  try {
    const url = new URL(value, baseUrl);
    return /^https?:$/i.test(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function extractPboUrlFromHtml(rowHtml: string, baseUrl: string): string {
  const anchors = [...rowHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const match of anchors) {
    const href = match[1];
    const label = stripHtmlText(match[2]);
    if (/\b(?:e|p)bo\b/i.test(label) || /(?:\/|_|-)(?:e|p)bo(?:\/|[?.#]|$)/i.test(href) || /\b(?:e|p)bo\b/i.test(href)) {
      const normalized = normalizePboUrl(href, baseUrl);
      if (normalized) return normalized;
    }
  }
  const dataLink = rowHtml.match(/(?:data-(?:url|href)|onclick)\s*=\s*["']([^"']*(?:e|p)bo[^"']*)["']/i)?.[1] ?? "";
  const embeddedUrl = dataLink.match(/https?:\/\/[^"'\\\s)]+|(?:\/|\.\/)[^"'\\\s)]+/i)?.[0] ?? dataLink;
  return normalizePboUrl(embeddedUrl, baseUrl);
}

function extractPboUrlFromRecord(record: Record<string, unknown>, baseUrl: string): string {
  for (const [key, value] of Object.entries(record)) {
    const text = typeof value === "string" ? value : "";
    if (/(?:pbo|ebo|url|link|action)/i.test(key) || /\b(?:e|p)bo\b/i.test(text)) {
      const direct = normalizePboUrl(text, baseUrl);
      if (direct) return direct;
      const embedded = text.match(/https?:\/\/[^"'\\\s)]+|(?:\/|\.\/)[^"'\\\s)]+/i)?.[0] ?? "";
      const normalized = normalizePboUrl(embedded, baseUrl);
      if (normalized) return normalized;
    }
  }
  return "";
}

function mapOtRow(headers: string[], values: string[], index: number, pboUrl = "") {
  const record = Object.fromEntries(headers.map((header, i) => [header || `Field ${i + 1}`, values[i] ?? ""]));
  const entries = Object.entries(record);
  const pick = (candidates: string[]) => {
    const wanted = candidates.map(normalizeOtKey);
    const found = entries.find(([key, value]) => wanted.includes(normalizeOtKey(key)) && value.trim());
    return found?.[1]?.trim() ?? "";
  };
  const noRMEntry = entries.find(([key, value]) => (
    (
      [
        "No MR", "No. MR", "No RM", "No. RM", "MR", "RM", "MRN", "MR No", "MR No.",
        "Medical Record Number", "Medical Record No", "MedicalRecordNumber",
        "No Rekam Medis", "Nomor Rekam Medis", "Rekam Medis",
        "No MR Episode", "No RM Episode", "MRN Episode", "MR No Episode",
        "No MR / Episode", "No RM / Episode", "MRN / Episode", "MR No / Episode",
        "No MR / No Episode", "No RM / No Episode", "MRN / No Episode",
        "No MR / IPK", "No RM / IPK", "MRN / IPK", "RM / Episode", "MR / Episode",
      ].map(normalizeOtKey).includes(normalizeOtKey(key))
      || isCombinedIdentityKey(key)
    )
    && value.trim()
  ));
  let noRM = noRMEntry?.[1]?.trim() ?? pick([
    "No MR", "No. MR", "No RM", "No. RM", "MR", "RM", "MRN", "MR No", "MR No.",
    "Medical Record Number", "Medical Record No", "MedicalRecordNumber",
    "No Rekam Medis", "Nomor Rekam Medis", "Rekam Medis",
    "No MR Episode", "No RM Episode", "MRN Episode", "MR No Episode",
    "No MR / Episode", "No RM / Episode", "MRN / Episode", "MR No / Episode",
    "No MR / No Episode", "No RM / No Episode", "MRN / No Episode",
    "No MR / IPK", "No RM / IPK", "MRN / IPK", "RM / Episode", "MR / Episode",
  ]);
  let episodeNo = pick([
    "Episode", "Episode No", "Episode No.", "Episode Number", "EpisodeNo",
    "No Episode", "No. Episode", "IPK", "No IPK", "No. IPK", "IPK No",
    "IPK Number", "Episode ID",
  ]);
  if (!episodeNo) {
    const combinedHeader = Boolean(noRMEntry && isCombinedIdentityKey(noRMEntry[0]));
    const split = splitCombinedOtIdentity(noRM, combinedHeader);
    noRM = split.noRM;
    episodeNo = split.episodeNo;
  }
  const dibuat = pick(["Create", "Created", "Created At", "Created Date", "Create Date", "Created On", "Dibuat", "CreatedDate", "CreatedTime", "Date Created", "Request Date"]);
  const namaPasien = pick(["Patient Name", "PatientName", "Patient Full Name", "Patient Fullname", "Nama Pasien", "Nama", "Name", "Patient"]);
  const tanggalOperasi = pick(["Operation Date", "OperationDate", "Tanggal Operasi", "Tanggal Tindakan", "Date"]);
  const jamOperasi = pick(["Operation Time", "OperationTime", "Jam Operasi", "Jam Tindakan", "Time"]);
  const ruangOperasi = pick(["Operating Room", "OperatingRoom", "Operation Room", "Ruang Operasi", "Room"]);
  const dpjp = pick(["Surgeon Doctor", "SurgeonDoctor", "Surgeon", "DPJP", "Doctor", "Dokter"]);
  const consumed = new Set(
    entries
      .filter(([key]) => [noRM, namaPasien, tanggalOperasi, jamOperasi, ruangOperasi, dpjp].includes(record[key]))
      .map(([key]) => key),
  );
  if (dibuat) {
    for (const [key, value] of entries) {
      if (value === dibuat) consumed.add(key);
    }
  }
  const extraFields = Object.fromEntries(entries.filter(([key, value]) => !consumed.has(key) && value.trim()));
  return {
    id: `${noRM || namaPasien || "row"}-${tanggalOperasi}-${jamOperasi}-${index}`,
    noRM, episodeNo, dibuat, namaPasien, tanggalOperasi, jamOperasi, ruangOperasi, dpjp, pboUrl, extraFields,
  };
}

function mapInProgressRecord(record: Record<string, unknown>, index: number) {
  const entries = Object.entries(record);
  const textValue = (value: unknown) => typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).replace(/\s+/g, " ").trim()
    : "";
  const pick = (candidates: string[]) => {
    const wanted = candidates.map(normalizeOtKey);
    return entries.find(([key, value]) => wanted.includes(normalizeOtKey(key)) && textValue(value))?.[1] ?? "";
  };
  const noRM = textValue(pick(["No MR", "No. MR", "No RM", "No. RM", "MRN", "Medical Record Number", "MedicalRecordNumber"]));
  const dibuat = textValue(pick(["Create", "Created", "Created At", "Dibuat", "CreatedDate", "CreatedTime", "Date Created"]));
  const namaPasien = textValue(pick(["Patient Name", "PatientName", "Nama Pasien", "Name", "Patient"]));
  const rencanaTindakan = textValue(pick(["Operation", "Operation Name", "Procedure", "Planned Operation", "Rencana Tindakan", "Tindakan"]));
  const ruangOperasi = textValue(pick(["Operating Room", "OperatingRoom", "Operation Room", "Ruang Operasi", "Room"]));
  const dpjp = textValue(pick(["Surgeon Doctor", "SurgeonDoctor", "Surgeon", "DPJP", "Doctor", "Dokter"]));
  const penjamin = textValue(pick(["Penjamin", "Payer", "Payor", "Guarantor", "Insurance"]));
  const keterangan = textValue(pick(["Message", "Keterangan", "Description", "Remark", "Remarks", "Note"]));
  const status = textValue(pick(["Status", "Request Status", "OT Status"])) || "In Progress";
  const consumed = new Set(entries
    .filter(([key]) => [
      "Create", "Created", "Created At", "CreatedDate", "CreatedTime", "Date Created",
      "Patient Name", "PatientName", "Nama Pasien", "Name", "Patient",
      "Operation", "Operation Name", "Procedure", "Planned Operation", "Rencana Tindakan", "Tindakan",
      "Operating Room", "OperatingRoom", "Operation Room", "Ruang Operasi", "Room",
      "Surgeon Doctor", "SurgeonDoctor", "Surgeon", "DPJP", "Doctor", "Dokter",
      "Penjamin", "Payer", "Payor", "Guarantor", "Insurance",
      "Message", "Keterangan", "Description", "Remark", "Remarks", "Note",
    ].some(candidate => normalizeOtKey(candidate) === normalizeOtKey(key)))
    .map(([key]) => key));
  const extraFields = Object.fromEntries(entries
    .map(([key, value]) => [key, textValue(value)] as const)
    .filter(([key, value]) => !consumed.has(key) && value));
  return {
    id: `${noRM || namaPasien || "row"}-${dibuat}-${index}`,
    noRM,
    dibuat,
    namaPasien,
    rencanaTindakan,
    ruangOperasi,
    dpjp,
    penjamin,
    keterangan,
    status,
    extraFields,
  };
}

function parseInProgressHtml(html: string) {
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map(match => match[1]);
  const cells = (row: string) => [...row.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
    .map(match => stripHtmlText(match[1]));
  for (const table of tables) {
    const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => match[1]);
    const rowCells = rows.map(cells);
    const headerIndex = rowCells.findIndex(values =>
      values.length >= 2 && values.some(value => /create|patient|nomr|mrn|operation|room|surgeon|penjamin|message|status/i.test(value)),
    );
    if (headerIndex < 0) continue;
    const headers = rowCells[headerIndex];
    const parsed = rowCells.slice(headerIndex + 1).map((values, index) => {
      if (!values.length || values.every(value => !value)) return null;
      return mapInProgressRecord(Object.fromEntries(headers.map((header, i) => [header || `Field ${i + 1}`, values[i] ?? ""])), index);
    }).filter(Boolean);
    if (parsed.length) return parsed;
  }
  return [];
}

function parseInProgressPayload(body: string, contentType: string) {
  if (contentType.includes("json") || body.trim().startsWith("{") || body.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(body) as unknown;
      const findRows = (value: unknown): unknown[] => {
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== "object") return [];
        for (const candidate of Object.values(value as Record<string, unknown>)) {
          const rows = findRows(candidate);
          if (rows.length) return rows;
        }
        return [];
      };
      return findRows(parsed)
        .filter(row => row && typeof row === "object" && !Array.isArray(row))
        .map((row, index) => mapInProgressRecord(row as Record<string, unknown>, index));
    } catch {
      // Fall through to HTML parsing.
    }
  }
  return parseInProgressHtml(body);
}

function parseOperatingTheatreHtml(html: string, baseUrl: string) {
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map(match => match[1]);
  const cells = (row: string) => [...row.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
    .map(match => stripHtmlText(match[1]));
  const knownHeader = (value: string) => {
    const key = normalizeOtKey(value);
    return [
       "nomr", "mrn", "nomrepisode", "nomrnoepisode", "nomripk", "rmepisode", "mrepisode",
       "medicalrecordnumber", "nomrepisode", "mrnepisode", "patient", "patientname", "namapasien",
      "operation", "operationdate", "operationtime", "tanggaloperasi", "jamoperasi",
      "operatingroom", "ruangoperasi", "surgeon", "surgeondoctor", "dpjp", "doctor",
    ].some(candidate => key.includes(candidate) || candidate.includes(key));
  };
  const tableRows = (tableHtml: string) =>
    [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => match[1]);

  for (const table of tables) {
    const rows = tableRows(table);
    const rowCells = rows.map(cells);
    const headerIndex = rowCells.findIndex(values =>
      values.length >= 2 && values.filter(knownHeader).length >= 2,
    );
    if (headerIndex < 0) continue;
    const headers = rowCells[headerIndex];
    const parsed = rowCells.slice(headerIndex + 1)
      .map((values, index) => {
        if (!values.length || values.every(value => !value) || values.join(" ") === headers.join(" ")) return null;
        const rowHtml = rows[headerIndex + 1 + index] ?? "";
        return mapOtRow(headers, values, index, extractPboUrlFromHtml(rowHtml, baseUrl));
      })
      .filter(Boolean);
    if (parsed.length) return parsed;
  }

  // Fallback for older TrakCare layouts where the table uses only <td>
  // cells or localized labels that are not present in the alias list.
  const candidates = tables
    .map(table => {
      const rows = tableRows(table);
      const rowCells = rows.map(cells);
      return { rowCells, score: rowCells.length * 10 + Math.max(...rowCells.map(row => row.length), 0) };
    })
    .filter(candidate => candidate.rowCells.length >= 2)
    .sort((a, b) => b.score - a.score);
  const fallback = candidates[0];
  if (fallback) {
    const headers = fallback.rowCells[0];
    const fallbackTableHtml = tables.find(table => tableRows(table).map(cells).length === fallback.rowCells.length) ?? "";
    const fallbackRows = tableRows(fallbackTableHtml);
    const parsed = fallback.rowCells.slice(1)
      .map((values, index) => values.length ? mapOtRow(headers, values, index, extractPboUrlFromHtml(
        fallbackRows[index + 1] ?? "",
        baseUrl,
      )) : null)
      .filter(Boolean);
    if (parsed.length) return parsed;
  }
  return [];
}

function isLoginPage(body: string): boolean {
  return /<input[^>]+name=["']username["']/i.test(body)
    && /<input[^>]+name=["']password["']/i.test(body);
}

function isLoginRedirect(response: Response): boolean {
  if (response.status < 300 || response.status >= 400) return false;
  const location = response.headers.get("location");
  return Boolean(location && /\/login(?:[/?]|$)/i.test(location));
}

function parseOperatingTheatrePayload(body: string, contentType: string, baseUrl: string) {
  // Never let an In Progress status-list response be interpreted as the
  // planned-action dashboard, even when TrakCare exposes it as a linked
  // fallback endpoint.
  if (isInProgressOperatingTheatreUrl(baseUrl)) return [];

  const isInProgressRow = (row: NonNullable<ReturnType<typeof mapOtRow>>) =>
    Object.entries(row.extraFields).some(([key, value]) =>
      /status/i.test(key) && /in\s*[-_]?\s*progress/i.test(value),
    );

  if (contentType.includes("json") || body.trim().startsWith("{") || body.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(body) as unknown;
      const findRows = (value: unknown): unknown[] => {
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== "object") return [];
        for (const candidate of Object.values(value as Record<string, unknown>)) {
          const rows = findRows(candidate);
          if (rows.length) return rows;
        }
        return [];
      };
      return findRows(parsed).map((row, index) => {
        const record = row as Record<string, unknown>;
        const headers = Object.keys(record);
        const values = headers.map(key => String(record[key] ?? ""));
        return mapOtRow(headers, values, index, extractPboUrlFromRecord(record, baseUrl));
      }).filter(row => !isInProgressRow(row));
    } catch {
      // Continue with HTML parsing for an incorrectly labelled response.
    }
  }
  return parseOperatingTheatreHtml(body, baseUrl)
    .filter((row): row is NonNullable<ReturnType<typeof mapOtRow>> => Boolean(row))
    .filter(row => !isInProgressRow(row));
}

function extractDashboardUrls(source: string, baseUrl: string): string[] {
  const found = new Set<string>();
  const add = (raw: string) => {
    const value = raw
      .replace(/&amp;/gi, "&")
      .replace(/\\u002F/g, "/")
      .replace(/\\\//g, "/")
      .trim();
    if (!value || /^(?:javascript:|mailto:|#|data:)/i.test(value)) return;
    try {
      const url = new URL(value, baseUrl);
      const base = new URL(baseUrl);
      if (url.origin !== base.origin || /\.(?:css|png|jpe?g|gif|svg|ico|woff2?|ttf)(?:$|\?)/i.test(url.pathname)) return;
      found.add(url.toString());
    } catch {
      // Ignore malformed or non-URL script strings.
    }
  };

  for (const match of source.matchAll(/\b(?:src|href|action|data-url|data-source|data-endpoint)\s*=\s*["']([^"']+)["']/gi)) {
    add(match[1]);
  }
  for (const match of source.matchAll(/(?:fetch|ajax|axios|\.get|\.post|url\s*:)\s*\(\s*["'`]([^"'`]+)["'`]/gi)) {
    add(match[1]);
  }
  for (const match of source.matchAll(/["'`]((?:\/|https?:\/\/)[^"'`\s<>]+)["'`]/g)) {
    const value = match[1];
    if (/(?:api|ajax|data|dashboard|request|operation|patient|otrequest|list|table)/i.test(value)) add(value);
  }
  return [...found];
}

async function discoverOperatingTheatreData(
  dashboardHtml: string,
  endpoint: string,
  requestDashboard: (target?: string) => Promise<Response>,
  parser: (body: string, contentType: string, baseUrl: string) => any[],
): Promise<{ patients: ReturnType<typeof parseOperatingTheatrePayload>; source: string }> {
  const pageUrls = extractDashboardUrls(dashboardHtml, endpoint);
  const scriptUrls = pageUrls.filter(url => /\.m?js(?:$|\?)/i.test(url));
  const dataUrls = pageUrls.filter(url =>
    !scriptUrls.includes(url)
    && !isInProgressOperatingTheatreUrl(url)
    && /(?:api|ajax|data|dashboard|request|operation|patient|otrequest|list|table)/i.test(url),
  );
  const discovered = new Set<string>(dataUrls);

  for (const scriptUrl of scriptUrls.slice(0, 12)) {
    const scriptResponse = await requestDashboard(scriptUrl).catch(() => null);
    if (!scriptResponse?.ok) continue;
    const scriptBody = await scriptResponse.text().catch(() => "");
    for (const url of extractDashboardUrls(scriptBody, endpoint)) {
      if (!/\.m?js(?:$|\?)/i.test(url) && !isInProgressOperatingTheatreUrl(url)) discovered.add(url);
    }
  }

  for (const dataUrl of [...discovered].slice(0, 20)) {
    if (isInProgressOperatingTheatreUrl(dataUrl)) continue;
    const response = await requestDashboard(dataUrl).catch(() => null);
    if (!response?.ok) continue;
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text().catch(() => "");
    if (!body || isLoginPage(body)) continue;
    const patients = parser(body, contentType, dataUrl);
    if (patients.length) return { patients, source: dataUrl };
  }
  return { patients: [], source: "" };
}

// ── POST /api/trakcare/operating-theatre ───────────────────────────────────────
// The server keeps only the short-lived session cookie per browser client.
// Credentials are used for login and are never persisted.
router.post("/trakcare/operating-theatre", async (req, res) => {
  const endpoint = String(req.body?.endpoint ?? "").trim();
  const username = String(req.body?.username ?? "");
  const password = String(req.body?.password ?? "");
  const clientId = String(req.body?.clientId ?? "default").slice(0, 200);
  const forceLogin = Boolean(req.body?.forceLogin);
  const view = req.body?.view === "inprogress" ? "inprogress" : "dashboard";

  if (!endpoint || !username || !password) {
    res.status(400).json({ error: "Konfigurasi login TrakCare belum lengkap." });
    return;
  }

  try {
    const cached = operatingTheatreSessions.get(clientId);
    const fingerprint = `${OPERATING_THEATRE_DASHBOARD_URL}\u0000${username}`;
    let cookies = forceLogin || cached?.fingerprint !== fingerprint ? "" : (cached?.cookies ?? "");
    let shouldLogin = !cookies || !cached || cached.fingerprint !== fingerprint || Date.now() - cached.updatedAt > 90 * 60_000;

    const requestTarget = async (url: string, init: RequestInit = {}) => fetch(url, {
      ...init,
      headers: {
        Accept: "text/html,application/json",
        "User-Agent": "IPAW-TrakCare-Proxy/1.0",
        Referer: OPERATING_THEATRE_DASHBOARD_URL,
        ...(init.headers ?? {}),
        ...(cookies ? { Cookie: cookies } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });

    const requestDashboard = async (target = endpoint): Promise<Response> => {
      let response = await requestTarget(target, { redirect: "manual" });
      for (let redirectCount = 0; redirectCount < 3; redirectCount += 1) {
        cookies = mergeCookies(cookies, response);
        if (!isLoginRedirect(response) && (response.status < 300 || response.status >= 400)) {
          return response;
        }
        const location = response.headers.get("location");
        if (!location || /\/login(?:[/?]|$)/i.test(location)) return response;
        response = await requestTarget(new URL(location, target).toString(), { redirect: "manual" });
      }
      return response;
    };

    const dataEndpoint = view === "inprogress"
      ? OPERATING_THEATRE_IN_PROGRESS_URL
      : OPERATING_THEATRE_DASHBOARD_URL;

    const login = async (): Promise<boolean> => {
      const loginUrl = operatingTheatreLoginUrl();
      const loginPage = await requestTarget(loginUrl, { redirect: "manual" });
      if (!loginPage.ok) {
        return false;
      }
      cookies = mergeCookies(cookies, loginPage);
      const loginHtml = await loginPage.text();
      if (!isLoginPage(loginHtml)) return false;
      const token = loginHtml.match(/name=["']_token["'][^>]+value=["']([^"']+)/i)?.[1];
      const form = new URLSearchParams();
      if (token) form.set("_token", token);
      form.set("username", username);
      form.set("password", password);
      const submitted = await requestTarget(loginUrl, {
        method: "POST",
        body: form,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        redirect: "manual",
      });
      cookies = mergeCookies(cookies, submitted);
      const submittedLocation = submitted.headers.get("location") ?? "";
      if (isLoginRedirect(submitted)) {
        console.warn("[TrakCare OT] login rejected: redirected to login", { status: submitted.status });
        return false;
      }
      if (submitted.status >= 400) return false;
      if (submitted.status === 200 && isLoginPage(await submitted.text().catch(() => ""))) {
        return false;
      }

      // A successful-looking 302 is not enough: this TrakCare installation
      // also redirects invalid credentials to the dashboard URL, then sends
      // that request back to /login. Verify the protected page before
      // retaining the session.
      const verificationTarget = submittedLocation && !isLoginRedirect(submitted)
        ? new URL(submittedLocation, loginUrl).toString()
        : OPERATING_THEATRE_DASHBOARD_URL;
      const verification = await requestDashboard(verificationTarget);
      if (isLoginRedirect(verification) || verification.status === 401) {
        console.warn("[TrakCare OT] login rejected during dashboard verification", {
          status: verification.status,
        });
        return false;
      }
      if (!verification.ok || isLoginPage(await verification.text().catch(() => ""))) {
        return false;
      }

      operatingTheatreSessions.set(clientId, { cookies, updatedAt: Date.now(), fingerprint });
      shouldLogin = false;
      console.info("[TrakCare OT] login accepted", {
        status: submitted.status,
        redirectedToDashboard: Boolean(submittedLocation),
      });
      return true;
    };

    if (shouldLogin && !(await login())) {
      res.status(401).json({ error: "Login ke TrakCare gagal." });
      return;
    }

    const hadCachedSession = !shouldLogin;
    let response = await requestDashboard(dataEndpoint);
    if (response.status === 401 || isLoginRedirect(response)) {
      operatingTheatreSessions.delete(clientId);
      if (hadCachedSession) {
        // Retry once with a fresh login when the TrakCare session expired.
        cookies = "";
        if (!(await login())) {
          res.status(401).json({ error: "Login ke TrakCare gagal." });
          return;
        }
        response = await requestDashboard(dataEndpoint);
      }
    }
    if (isLoginRedirect(response) || response.status === 401) {
      res.status(401).json({ error: "Login ke TrakCare gagal." });
      return;
    }
    if (!response.ok) {
      res.status(502).json({ error: "Server TrakCare tidak dapat dihubungi." });
      return;
    }
    const body = await response.text();
    if (isLoginPage(body)) {
      operatingTheatreSessions.delete(clientId);
      res.status(401).json({ error: "Login ke TrakCare gagal." });
      return;
    }
    const contentType = response.headers.get("content-type") ?? "";
    let patients = view === "inprogress"
      ? parseInProgressPayload(body, contentType)
      : parseOperatingTheatrePayload(body, contentType, dataEndpoint);
    let dataSource = "dashboard";
    if (!patients.length) {
      const discovered = await discoverOperatingTheatreData(
        body,
        dataEndpoint,
        requestDashboard,
        view === "inprogress"
          ? (payload, type) => parseInProgressPayload(payload, type)
          : (payload, type, baseUrl) => parseOperatingTheatrePayload(payload, type, baseUrl),
      );
      patients = discovered.patients;
      dataSource = discovered.source || "dashboard-empty";
    }
    console.info("[TrakCare OT] dashboard response", {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bodyBytes: Buffer.byteLength(body, "utf8"),
      patients: patients.length,
      dataSource,
      discoveredUrls: extractDashboardUrls(body, endpoint).length,
      containsTable: /<table\b/i.test(body),
      containsScript: /<script\b/i.test(body),
    });
    operatingTheatreSessions.set(clientId, { cookies, updatedAt: Date.now(), fingerprint });
    res.json({ patients, total: patients.length, fetchedAt: new Date().toISOString() });
  } catch (error: any) {
    res.status(502).json({
      error: error?.name === "TimeoutError"
        ? "Server TrakCare tidak dapat dihubungi."
        : "Server TrakCare tidak dapat dihubungi.",
    });
  }
});

const TRAKCARE_URL =
  "https://apps.emc.id/trakcare/dashboard/dailyinpatient/trakcareANLT/hospital/4";
const EPISODE_DETAIL_BASE_URL =
  "https://apps.emc.id/trakcare/dokumen/print/dokumen/trakcareANLT?episode=";

// ── HTML parsers (regex-based, no DOM needed in Node.js) ─────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

function splitByBr(html: string): string[] {
  return html
    .replace(/<br\s*\/?>/gi, "|")
    .split("|")
    .map((s) => stripTags(s).trim())
    .filter(Boolean);
}

function normalizeBirthDate(value: string): string {
  const raw = value.replace(/\s+/g, " ").trim();
  if (!raw || /^[-—]+$/.test(raw)) return "";

  const valid = (day: number, month: number, year: number): string => {
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
      ? `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`
      : raw;
  };
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return valid(Number(match[3]), Number(match[2]), Number(match[1]));
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (match) return valid(Number(match[1]), Number(match[2]), Number(match[3]));
  return raw;
}

function parseEpisodeBirthDate(html: string): string {
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(stripTags(cellMatch[1]).replace(/\s+/g, " ").trim());
    }
    if (/^tanggal lahir$/i.test(cells[0] ?? "")) {
      return normalizeBirthDate(cells[2] ?? cells[1] ?? "");
    }
  }
  return "";
}

async function fetchEpisodeBirthDate(episode: string): Promise<string> {
  const response = await fetch(
    `${EPISODE_DETAIL_BASE_URL}${encodeURIComponent(episode)}`,
    {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) return "";
  return parseEpisodeBirthDate(await response.text());
}

async function enrichBirthDates<T extends { episodeNo?: string; episode?: string; dob?: string }>(
  patients: T[],
): Promise<T[]> {
  const episodes = [...new Set(
    patients
      .filter(patient => !patient.dob)
      .map(patient => (patient.episodeNo ?? patient.episode ?? "").trim())
      .filter(Boolean),
  )];
  const dates = new Map<string, string>();
  for (let index = 0; index < episodes.length; index += 6) {
    const results = await Promise.all(
      episodes.slice(index, index + 6).map(async episode => {
        try {
          return [episode, await fetchEpisodeBirthDate(episode)] as const;
        } catch {
          return [episode, ""] as const;
        }
      }),
    );
    for (const [episode, dob] of results) {
      if (dob) dates.set(episode, dob);
    }
  }
  return patients.map(patient => {
    const episode = (patient.episodeNo ?? patient.episode ?? "").trim();
    const dob = dates.get(episode);
    return {
      ...patient,
      dob: dob || normalizeBirthDate(patient.dob ?? ""),
    };
  });
}

function parseWardRoom(text: string): {
  ward: string;
  room: string;
  bed: string;
} {
  // Format: "{WardName} PK {RoomCode} PK {BedCode}"
  // e.g. "Jasmine PK 520 PK B2 - II"  → ward:"Jasmine", room:"PK 520", bed:"PK B2 - II"
  // e.g. "Ruang Pelayanan Intensive PK ICU PK B2 - ICU"
  const parts = text.split(/ PK /);
  if (parts.length >= 3) {
    return {
      ward: parts[0].trim(),
      room: `PK ${parts[1].trim()}`,
      bed: `PK ${parts.slice(2).join(" PK ").trim()}`,
    };
  } else if (parts.length === 2) {
    return {
      ward: parts[0].trim(),
      room: `PK ${parts[1].trim()}`,
      bed: "",
    };
  }
  return { ward: text.trim(), room: text.trim(), bed: "" };
}

interface TrakCarePatient {
  noRM: string;
  episodeNo: string;
  namaPasien: string;
  dob: string;
  sexDesc: string;
  payor: string;
  dpjp: string;
  ward: string;
  roomName: string;
  roomType: string;
  bedCode: string;
  admissionDate: string;
}

function parsePatients(html: string): TrakCarePatient[] {
  const patients: TrakCarePatient[] = [];

  // Extract tbody
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return patients;

  // Extract each row
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(tbodyMatch[1])) !== null) {
    const rowHTML = rowMatch[1];

    // Extract each cell
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowHTML)) !== null) {
      cells.push(cellMatch[1]);
    }

    if (cells.length < 8) continue;

    // col[0]: Ward Room Bed (plain text after stripping)
    const wardRoomText = stripTags(
      cells[0].replace(/<br\s*\/?>/gi, " ")
    ).trim();

    // col[1]: Class / Kelas
    const roomType = stripTags(cells[1]).trim();

    // col[2]: MRN<br>Episode
    const mrnParts = splitByBr(cells[2]);
    const noRM = mrnParts[0] ?? "";
    const episodeNo = mrnParts[1] ?? "";
    if (!noRM) continue;

    // col[3]: Nama
    const namaPasien = stripTags(cells[3]).trim();

    // col[4]: DOB<br>Sex
    const dobParts = splitByBr(cells[4]);
    const dob = dobParts[0] ?? "";
    const sexDesc = dobParts[1] ?? "";

    // col[5]: Payor
    const payor = stripTags(cells[5]).trim();

    // col[6]: LOS — calculate admission date
    const losMatch = stripTags(cells[6]).match(/(\d+)/);
    const losDays = losMatch ? parseInt(losMatch[1], 10) : 0;
    const admissionDate =
      losDays > 0
        ? new Date(Date.now() - losDays * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0]
        : new Date().toISOString().split("T")[0];

    // col[7]: DPJP
    const dpjp = stripTags(cells[7]).trim();

    const { ward, room, bed } = parseWardRoom(wardRoomText);

    patients.push({
      noRM,
      episodeNo,
      namaPasien,
    dob: normalizeBirthDate(dob),
      sexDesc,
      payor,
      dpjp,
      ward,
      roomName: room,
      roomType,
      bedCode: bed,
      admissionDate,
    });
  }

  return patients;
}

// ── GET /api/trakcare/patients ────────────────────────────────────────────────
router.get("/trakcare/patients", async (req, res) => {
  const targetUrl = (req.query.url as string | undefined) || TRAKCARE_URL;
  try {
    const response = await fetch(targetUrl, {
      headers: { Accept: "text/html" },
      // 15-second timeout
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      res
        .status(502)
        .json({ error: `TrakCare responded with HTTP ${response.status}` });
      return;
    }

    const html = await response.text();
    const patients = await enrichBirthDates(parsePatients(html));

    res.json({
      patients,
      total: patients.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    const message =
      err?.name === "TimeoutError"
        ? "Request ke TrakCare timeout (>15 detik)."
        : err?.message ?? "Unknown error";
    res.status(502).json({ error: message });
  }
});

// ── IGD Emergency Waiting Time ────────────────────────────────────────────────

const IGD_URL =
  "https://apps.emc.id/trakcare/dashboard/dailyemergencywaitingtime/trakcareANLT/hospital/4";

interface IGDPatient {
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
  timerColor: string; // 'merah' | 'kuning' | 'hijau' | 'hitam' | ''
}

function parseIGDPatients(html: string): IGDPatient[] {
  const modernPatients = parseModernIGDPatients(html);
  if (modernPatients.length > 0) {
    return modernPatients.filter((patient) => patient.timerTransfer !== "--");
  }

  const patients: IGDPatient[] = [];

  // Split by card boundary
  const cardBlocks = html.split('<div class="col-md-3 mb-4">').slice(1);

  for (const block of cardBlocks) {
    if (!block.includes("background-color:lavender")) continue;

    // Extract two timer cells (col-6 text-center h1 [colorClass])
    const timerRegex =
      /<div class="col-6 text-center h1\s*([^"]*)">([\s\S]*?)<\/div>/gi;
    const timers: { colorClass: string; value: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = timerRegex.exec(block)) !== null && timers.length < 2) {
      timers.push({ colorClass: m[1].trim(), value: stripTags(m[2]).trim() });
    }

    if (timers.length < 2) continue;

    // Patient has SPRI only when TRANSFER INPATIENT timer is not "--"
    const timerTransfer = timers[1].value;
    if (!timerTransfer || timerTransfer === "--") continue;

    // Extract patient info rows (col-12 font-weight-bold)
    const infoRegex =
      /<div class="col-12 font-weight-bold[^"]*">([\s\S]*?)<\/div>/gi;
    const infos: string[] = [];
    let im: RegExpExecArray | null;
    while ((im = infoRegex.exec(block)) !== null) {
      const t = stripTags(im[1]).trim();
      if (t) infos.push(t);
    }

    if (infos.length < 2) continue;

    patients.push({
      nama: infos[0] ?? "",
      noRM: infos[1] ?? "",
      dokter: infos[2] ?? "",
      lokasi: infos[3] ?? "",
      transferDestination: "",
      episode: "",
      dob: "",
      tanggalKedatangan: "",
      penjamin: "",
      timerOutpatient: timers[0].value,
      timerTransfer,
      timerColor: timers[1].colorClass,
    });
  }

  return patients;
}

/**
 * The IGD dashboard changed from Bootstrap cards to the newer
 * `.patient-card` layout. Keep the extraction here deliberately class-based:
 * the visual classes can change without changing the patient data contract.
 */
function extractModernIGDCardBlocks(html: string): string[] {
  const cardStart = /<div\b[^>]*class=["'][^"']*\bpatient-card\b[^"']*["'][^>]*>/gi;
  const starts = [...html.matchAll(cardStart)].map((match) => match.index ?? -1).filter((index) => index >= 0);
  return starts.map((start, index) => html.slice(start, starts[index + 1] ?? html.length));
}

function extractClassTexts(html: string, className: string): string[] {
  const pattern = new RegExp(
    `<[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "gi",
  );
  return [...html.matchAll(pattern)]
    .map((match) => stripTags(match[1]).replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractModernIGDFlowValues(block: string): string[] {
  const currentTitle = /<[^>]*class=["'][^"']*\bflow-title\b[^"']*["'][^>]*>\s*(?:CURRENT(?:\s+LOCATION)?)[\s\S]*?<\/[^>]+>/i.exec(block);
  if (!currentTitle) return [];

  const currentStart = currentTitle.index ?? 0;
  const destinationStart = /<[^>]*class=["'][^"']*\bflow-title\b[^"']*["'][^>]*>\s*DESTINATION[\s\S]*?<\/[^>]+>/i.exec(block)?.index;
  const currentSection = block.slice(currentStart, destinationStart ?? block.length);
  return extractClassTexts(currentSection, "flow-value");
}

function deriveModernIGDLocation(flowValues: string[]): string {
  const values = flowValues
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value && value !== "-");
  if (values.length === 0) return "";

  // For discharge lounge rows the second value is the active destination.
  if (values.length >= 2 && /discharge\s+lounge/i.test(values[1])) {
    return values[1];
  }

  // Ward rows are represented as "Emergency PK", "Emergency PK", "9".
  if (values.length >= 3 && /^\d+$/.test(values[values.length - 1])) {
    return `${values[values.length - 2]}/${values[values.length - 1]}`;
  }

  return values[1] ?? values[0];
}

function deriveModernIGDDestination(values: string[]): string {
  return values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value && value !== "-")
    .join(" / ");
}

function parseModernIGDPatients(html: string): IGDPatient[] {
  const patients: IGDPatient[] = [];

  for (const block of extractModernIGDCardBlocks(html)) {
    const names = extractClassTexts(block, "patient-name");
    const medicalRecordNumbers = extractClassTexts(block, "mr");
    if (!names[0] || !medicalRecordNumbers[0]) continue;

    const timerValues = extractClassTexts(block, "timer-value");
    const timerValueClasses = [...block.matchAll(
      /<[^>]*class=["']([^"']*\btimer-value\b[^"']*)["'][^>]*>/gi,
    )].map((match) => match[1]);
    const priorityClass = block.match(/\bpriority-(green|yellow|red|black)\b/i)?.[1] ?? "";
    const flowValues = extractModernIGDFlowValues(block);
    const destinationTitle = /<[^>]*class=["'][^"']*\bflow-title\b[^"']*["'][^>]*>\s*DESTINATION[\s\S]*?<\/[^>]+>/i.exec(block);
    const destinationSection = destinationTitle
      ? block.slice(destinationTitle.index ?? 0)
      : "";
    const destinationValues = extractClassTexts(destinationSection, "flow-value");

    patients.push({
      nama: names[0],
      noRM: medicalRecordNumbers[0].replace(/^MR\s+/i, "").trim(),
      dokter: extractClassTexts(block, "doctor")[0] ?? "",
      lokasi: deriveModernIGDLocation(flowValues),
      transferDestination: deriveModernIGDDestination(destinationValues),
      episode: extractClassTexts(block, "episode")[0] ?? "",
      dob: normalizeBirthDate(extractClassTexts(block, "dob")[0] ?? ""),
      tanggalKedatangan: extractClassTexts(block, "arrival")[0] ?? "",
      penjamin: extractClassTexts(block, "payor")[0] ?? "",
      timerOutpatient: timerValues[0] ?? "--",
      timerTransfer: timerValues[1] ?? "--",
      timerColor: timerValueClasses[1] ?? (priorityClass ? `priority-${priorityClass}` : ""),
    });
  }

  return patients;
}

// ── GET /api/trakcare/discharge ───────────────────────────────────────────────
// Generic discharge endpoint — callers pass the full target URL as ?url=<encoded>
router.get("/trakcare/discharge", async (req, res) => {
  const targetUrl = req.query.url as string | undefined;
  if (!targetUrl) {
    res.status(400).json({ error: "Missing required query param: url" });
    return;
  }
  try {
    const response = await fetch(targetUrl, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      res.status(502).json({ error: `TrakCare responded with HTTP ${response.status}` });
      return;
    }
    const html = await response.text();
    const patients = parsePatients(html);
    res.json({ patients, total: patients.length, fetchedAt: new Date().toISOString() });
  } catch (err: any) {
    const message = err?.name === "TimeoutError"
      ? "Request ke TrakCare timeout (>15 detik)."
      : err?.message ?? "Unknown error";
    res.status(502).json({ error: message });
  }
});

// ── IGD Ward: ALL patients (no timerTransfer filter) ─────────────────────────

function parseAllIGDPatients(html: string): IGDPatient[] {
  const modernPatients = parseModernIGDPatients(html);
  if (modernPatients.length > 0) return modernPatients;

  const patients: IGDPatient[] = [];
  const cardBlocks = html.split('<div class="col-md-3 mb-4">').slice(1);

  for (const block of cardBlocks) {
    if (!block.includes("background-color:lavender")) continue;

    // Extract timer cells
    const timerRegex =
      /<div class="col-6 text-center h1\s*([^"]*)">([\s\S]*?)<\/div>/gi;
    const timers: { colorClass: string; value: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = timerRegex.exec(block)) !== null && timers.length < 2) {
      timers.push({ colorClass: m[1].trim(), value: stripTags(m[2]).trim() });
    }

    const timerOutpatient = timers[0]?.value ?? "--";
    const timerTransfer = timers[1]?.value ?? "--";

    // Extract patient info rows (col-12 font-weight-bold)
    const infoRegex =
      /<div class="col-12 font-weight-bold[^"]*">([\s\S]*?)<\/div>/gi;
    const infos: string[] = [];
    let im: RegExpExecArray | null;
    while ((im = infoRegex.exec(block)) !== null) {
      const t = stripTags(im[1]).trim();
      if (t) infos.push(t);
    }

    if (infos.length < 2) continue;

    patients.push({
      nama: infos[0] ?? "",
      noRM: infos[1] ?? "",
      dokter: infos[2] ?? "",
      lokasi: infos[3] ?? "",
      transferDestination: "",
      episode: "",
      dob: "",
      tanggalKedatangan: "",
      penjamin: "",
      timerOutpatient,
      timerTransfer,
      timerColor: timers[1]?.colorClass ?? "",
    });
  }

  return patients;
}

// ── GET /api/trakcare/igd-ward ────────────────────────────────────────────────
// Returns ALL IGD patients (including those without timerTransfer) for IGD Ward.
router.get("/trakcare/igd-ward", async (req, res) => {
  const targetUrl = (req.query.url as string | undefined) || IGD_URL;
  try {
    const response = await fetch(targetUrl, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      res
        .status(502)
        .json({ error: `TrakCare responded with HTTP ${response.status}` });
      return;
    }

    const html = await response.text();
    const patients = await enrichBirthDates(parseAllIGDPatients(html));

    res.json({
      patients,
      total: patients.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    const message =
      err?.name === "TimeoutError"
        ? "Request ke TrakCare timeout (>15 detik)."
        : err?.message ?? "Unknown error";
    res.status(502).json({ error: message });
  }
});

// ── GET /api/trakcare/igd-patients ────────────────────────────────────────────
router.get("/trakcare/igd-patients", async (req, res) => {
  const targetUrl = (req.query.url as string | undefined) || IGD_URL;
  try {
    const response = await fetch(targetUrl, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      res
        .status(502)
        .json({ error: `TrakCare responded with HTTP ${response.status}` });
      return;
    }

    const html = await response.text();
    const patients = await enrichBirthDates(parseIGDPatients(html));

    res.json({
      patients,
      total: patients.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    const message =
      err?.name === "TimeoutError"
        ? "Request ke TrakCare timeout (>15 detik)."
        : err?.message ?? "Unknown error";
    res.status(502).json({ error: message });
  }
});

// ── GET /api/trakcare/episode — read the birth date from an episode detail ─────
router.get("/trakcare/episode", async (req, res) => {
  const requestedUrl = String(req.query.url ?? "").trim();
  let episode = String(req.query.episode ?? "").trim();
  if (!episode && requestedUrl) {
    try {
      episode = new URL(requestedUrl).searchParams.get("episode")?.trim() ?? "";
    } catch {
      episode = "";
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(episode)) {
    res.status(400).json({ error: "Nomor episode tidak valid." });
    return;
  }
  try {
    res.json({ episode, dob: await fetchEpisodeBirthDate(episode) });
  } catch (error: any) {
    res.status(502).json({
      error: error?.name === "TimeoutError"
        ? "Request detail episode timeout (>12 detik)."
        : error?.message ?? "Gagal mengambil detail episode.",
    });
  }
});

export default router;
