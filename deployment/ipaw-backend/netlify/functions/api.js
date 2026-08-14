const TRAKCARE_TIMEOUT_MS = 20_000;
const OPERATING_THEATRE_TIMEOUT_MS = 20_000;
const DEFAULT_CORS_ORIGIN = "*";
const OPERATING_THEATRE_SESSION_TTL_MS = 90 * 60_000;
const OPERATING_THEATRE_DASHBOARD_PATH = "/trakcare/operatingtheatre/otrequest/dashboard/trakcareANLT/hospital/4";
const OPERATING_THEATRE_IN_PROGRESS_PATH = "/trakcare/operatingtheatre/otrequest/status/list/hospital/4?status=inprogress";

const operatingTheatreSessions = new Map();

function json(status, body, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function getHeader(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : "";
}

function corsOrigin(event) {
  const allowed = process.env.NETLIFY_ALLOWED_ORIGIN?.trim();
  if (!allowed) return DEFAULT_CORS_ORIGIN;
  const origin = getHeader(event, "origin");
  if (!origin) return allowed;
  return origin === allowed ? origin : allowed;
}

function corsHeaders(event) {
  return {
    "access-control-allow-origin": corsOrigin(event),
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization, X-Requested-With, X-IPAW-API-Key",
    "access-control-max-age": "86400",
    Vary: "Origin",
  };
}

function hasValidApiKey(event) {
  const expected = process.env.IPAW_API_KEY?.trim();
  if (!expected) return true;
  const provided = getHeader(event, "x-ipaw-api-key") ||
    getHeader(event, "authorization").replace(/^Bearer\s+/i, "").trim();
  return Boolean(provided) && provided === expected;
}

function fail(status, error, details) {
  const body = { success: false, status, error };
  if (details !== undefined) body.details = details;
  return json(status, body);
}

function success(status, data) {
  return json(status, { success: true, status, data });
}

function parseBody(event) {
  if (!event.body) return null;
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}

function parseJsonBody(event) {
  const raw = parseBody(event);
  if (raw === null || raw === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isSafeProtocol(url) {
  return url.protocol === "https:" || url.protocol === "http:";
}

function normalizeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function allowedOrigins() {
  const base = process.env.TRAKCARE_BASE_URL;
  const list = new Set();
  if (base) list.add(normalizeOrigin(base));
  const extras = (process.env.TRAKCARE_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const origin of extras) list.add(normalizeOrigin(origin));
  return [...list].filter(Boolean);
}

function resolveTarget(endpoint, baseUrl) {
  if (!baseUrl) throw new Error("TRAKCARE_BASE_URL belum diatur.");
  const base = new URL(baseUrl);
  const target = new URL(endpoint, base);
  if (!isSafeProtocol(target)) throw Object.assign(new Error("Protokol tujuan tidak aman."), { status: 403 });
  const allowed = allowedOrigins();
  if (allowed.length && !allowed.includes(target.origin)) {
    throw Object.assign(new Error("Target TrakCare di luar origin yang diizinkan."), { status: 403 });
  }
  return target;
}

function safeForwardHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const k = key.toLowerCase();
    if (["accept", "content-type", "x-requested-with"].includes(k)) out[key] = value;
  }
  return out;
}

function responseHeaders(response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

async function readSafeBody(response) {
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();
  const isJson = contentType.includes("json") || body.trim().startsWith("{") || body.trim().startsWith("[");
  return {
    body: isJson ? safeJsonParse(body) : body,
    contentType,
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function externalError(status, upstreamStatus) {
  if (status === 400) return "Permintaan ke TrakCare tidak valid.";
  if (status === 401) return "Autentikasi TrakCare ditolak.";
  if (status === 403) return "Akses TrakCare ditolak.";
  if (status === 404) return "Endpoint TrakCare tidak ditemukan.";
  if (status >= 500) return upstreamStatus ? `TrakCare mengembalikan HTTP ${upstreamStatus}.` : "TrakCare sedang bermasalah.";
  return "Permintaan ke TrakCare gagal.";
}

async function forwardRequest(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Timeout")), options.timeoutMs || TRAKCARE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function handleGenericTrakCare(event) {
  const body = parseJsonBody(event);
  if (body === null) return fail(400, "Body harus berupa JSON yang valid.");
  const endpoint = String(body.endpoint || "").trim();
  const method = String(body.method || "GET").toUpperCase();
  if (!endpoint) return fail(400, "Field endpoint wajib diisi.");
  const baseUrl = process.env.TRAKCARE_BASE_URL;
  if (!baseUrl) return fail(500, "TRAKCARE_BASE_URL belum diatur.");

  let target;
  try {
    target = resolveTarget(endpoint, baseUrl);
  } catch (error) {
    return fail(error.status || 403, error.message);
  }

  const headers = safeForwardHeaders(body.headers || {});
  if (process.env.TRAKCARE_TOKEN) headers.Authorization = `Bearer ${process.env.TRAKCARE_TOKEN}`;
  const payload = body.payload;
  const init = { method, headers };
  if (payload !== undefined && method !== "GET" && method !== "HEAD") {
    init.body = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (!headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";
  }
  try {
    const response = await forwardRequest(target.toString(), { ...init, timeoutMs: TRAKCARE_TIMEOUT_MS });
    const content = await readSafeBody(response);
    const isOk = response.ok;
    const upstreamStatus = response.status;
    if (!isOk) {
      return fail(upstreamStatus, externalError(upstreamStatus, upstreamStatus), {
        upstreamStatus,
        endpoint: target.toString(),
        contentType: content.contentType,
      });
    }
    return success(200, {
      body: content.body,
      contentType: content.contentType,
      headers: responseHeaders(response),
      upstreamStatus,
      endpoint: target.toString(),
    });
  } catch (error) {
    const message = /timeout/i.test(String(error?.message || "")) ? "Permintaan TrakCare timeout." : "Gagal terhubung ke TrakCare.";
    return fail(502, message, { endpoint: target.toString() });
  }
}

function sessionKey(clientId) {
  return String(clientId || "default").slice(0, 200);
}

function getSession(clientId) {
  const session = operatingTheatreSessions.get(sessionKey(clientId));
  if (!session) return null;
  if (Date.now() - session.updatedAt > OPERATING_THEATRE_SESSION_TTL_MS) {
    operatingTheatreSessions.delete(sessionKey(clientId));
    return null;
  }
  return session;
}

function setSession(clientId, session) {
  operatingTheatreSessions.set(sessionKey(clientId), { ...session, updatedAt: Date.now() });
}

function cookieHeader(existing, response) {
  const cookies = [];
  const current = existing ? existing.split(/;\s*/) : [];
  cookies.push(...current.filter(Boolean));
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookies.push(setCookie.split(/,(?=[^;]+=)/g)[0]);
  return [...new Map(cookies.map((cookie) => [cookie.split("=")[0], cookie]))].map(([, cookie]) => cookie).join("; ");
}

function isLoginPage(html) {
  return /name=["']username["']/i.test(html) && /name=["']password["']/i.test(html);
}

async function fetchWithCookies(url, options, cookies) {
  const headers = { ...(options.headers || {}) };
  if (cookies) headers.Cookie = cookies;
  return forwardRequest(url, { ...options, headers, timeoutMs: OPERATING_THEATRE_TIMEOUT_MS });
}

async function handleOperatingTheatre(event) {
  const body = parseJsonBody(event);
  if (body === null) return fail(400, "Body harus berupa JSON yang valid.");
  const endpoint = String(body.endpoint || "").trim();
  const username = String(body.username || "");
  const password = String(body.password || "");
  const clientId = sessionKey(body.clientId);
  const forceLogin = Boolean(body.forceLogin);
  const view = body.view === "inprogress" ? "inprogress" : "dashboard";
  if (!endpoint || !username || !password) return fail(400, "endpoint, username, dan password wajib diisi.");
  if (!process.env.TRAKCARE_BASE_URL) return fail(500, "TRAKCARE_BASE_URL belum diatur.");

  const loginEndpoint = new URL(endpoint, process.env.TRAKCARE_BASE_URL);
  loginEndpoint.pathname = loginEndpoint.pathname.replace(/\/otrequest\/dashboard\/.*$/i, "/login");
  loginEndpoint.search = `route=trakcare.operatingtheatre.otrequest.dashboard.hospital&url=${encodeURIComponent(endpoint)}`;
  const target = new URL(view === "inprogress" ? OPERATING_THEATRE_IN_PROGRESS_PATH : endpoint, process.env.TRAKCARE_BASE_URL);
  const session = forceLogin ? null : getSession(clientId);
  let cookies = session?.cookies || "";
  try {
    if (!cookies) {
      const loginPage = await fetchWithCookies(loginEndpoint.toString(), { method: "GET", headers: { Accept: "text/html" } }, cookies);
      cookies = cookieHeader(cookies, loginPage);
      const loginHtml = await loginPage.text();
      if (!loginPage.ok || !isLoginPage(loginHtml)) return fail(401, "Login ke TrakCare gagal.");
      const token = loginHtml.match(/name=["']_token["'][^>]+value=["']([^"']+)/i)?.[1];
      const form = new URLSearchParams();
      if (token) form.set("_token", token);
      form.set("username", username);
      form.set("password", password);
      const submit = await fetchWithCookies(loginEndpoint.toString(), { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" } }, cookies);
      cookies = cookieHeader(cookies, submit);
      if (!submit.ok) return fail(401, "Login ke TrakCare gagal.");
      const verify = await fetchWithCookies(target.toString(), { method: "GET", headers: { Accept: "text/html,application/json" } }, cookies);
      cookies = cookieHeader(cookies, verify);
      const verifyBody = await verify.text();
      if (!verify.ok || isLoginPage(verifyBody)) return fail(401, "Login ke TrakCare gagal.");
      setSession(clientId, { cookies, fingerprint: `${endpoint}\u0000${username}` });
    }
    const response = await fetchWithCookies(target.toString(), { method: "GET", headers: { Accept: "text/html,application/json" } }, cookies);
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (!response.ok) return fail(response.status, externalError(response.status, response.status), { endpoint: target.toString() });
    if (!text || isLoginPage(text)) return fail(401, "Login ke TrakCare gagal.");
    const data = text.trim().startsWith("{") || text.trim().startsWith("[") || contentType.includes("json")
      ? { body: safeJsonParse(text), contentType, headers: responseHeaders(response), upstreamStatus: response.status, endpoint: target.toString() }
      : { html: text, contentType, baseUrl: target.toString() };
    return success(200, {
      ...data,
      patients: [],
      total: 0,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return fail(502, /timeout/i.test(String(error?.message || "")) ? "Permintaan TrakCare timeout." : "Gagal terhubung ke TrakCare.", { endpoint });
  }
}

exports.handler = async (event) => {
  const headers = corsHeaders(event);
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  try {
    const path = (event.path || "").replace(/^\/\.netlify\/functions\/api/, "/api");
    let response;
    if (event.httpMethod === "GET" && /\/api\/health$/i.test(path)) {
      response = success(200, { service: "IPAW Backend", status: "online" });
    } else if (!hasValidApiKey(event)) {
      response = fail(401, "API key IPAW tidak valid.");
    } else if (!process.env.TRAKCARE_BASE_URL) {
      response = fail(500, "TRAKCARE_BASE_URL belum diatur.");
    } else if (event.httpMethod === "POST" && /\/api\/trakcare\/operating-theatre$/i.test(path)) {
      response = await handleOperatingTheatre(event);
    } else if (/^\/api\/trakcare(?:\/|$)/i.test(path)) {
      response = await handleGenericTrakCare(event);
    } else {
      response = fail(404, "Endpoint tidak ditemukan.");
    }
    response.headers = { ...(response.headers || {}), ...headers };
    return response;
  } catch (error) {
    return { ...fail(500, "Terjadi kesalahan pada backend."), headers };
  }
};