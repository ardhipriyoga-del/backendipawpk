import { timingSafeEqual } from "node:crypto";

export const DEFAULT_GAS_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbzAnMrxuit5itGRjFMuHy94pEGFBnA_RVKowtQCRJX_OotdaKBwayy5Tuq8-s-K94QUdA/exec";

const DEFAULT_GAS_API_KEY = "IPAW-EMC";

export function getGasApiKey(): string {
  return process.env["GAS_API_KEY"]?.trim() || DEFAULT_GAS_API_KEY;
}

export function resolveGasWebAppUrl(candidate?: string): string {
  const configured = process.env["GAS_WEB_APP_URL"]?.trim();
  const value = candidate?.trim() || configured || DEFAULT_GAS_WEB_APP_URL;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("URL Google Apps Script tidak valid.");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "script.google.com" ||
    !/^\/macros\/s\/[^/]+\/exec$/i.test(parsed.pathname)
  ) {
    throw new Error("URL Google Apps Script tidak diizinkan.");
  }

  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export async function fetchGasJson(
  url: string,
  init: RequestInit,
  timeoutMs = 60_000,
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
    });
    const body = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(body);
    } catch {
      // The caller receives a clear non-JSON error below.
    }

    if (!response.ok) {
      throw new Error(`Google Apps Script merespons HTTP ${response.status}.`);
    }
    if (!json || typeof json !== "object") {
      throw new Error("Respons Google Apps Script bukan JSON yang valid.");
    }
    if (json.success === false) {
      throw new Error(String(json.error || json.message || "Operasi Google Apps Script gagal."));
    }
    return json;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request ke Google Apps Script timeout.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readGasStore<T = any>(
  store: string,
  candidateUrl?: string,
): Promise<T[]> {
  const baseUrl = resolveGasWebAppUrl(candidateUrl);
  const url = new URL(baseUrl);
  url.searchParams.set("action", "readStore");
  url.searchParams.set("apiKey", getGasApiKey());
  url.searchParams.set("store", store);

  const response = await fetchGasJson(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "IPAW-Replit-API/1.0",
    },
  });
  const records = Array.isArray(response.records)
    ? response.records
    : Array.isArray(response.data)
      ? response.data
      : [];
  return records as T[];
}

export async function restoreGasDatabase(
  candidateUrl?: string,
): Promise<{ database: Record<string, any[]>; metadata?: any }> {
  const baseUrl = resolveGasWebAppUrl(candidateUrl);
  const response = await fetchGasJson(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
      Accept: "application/json, text/plain, */*",
      "User-Agent": "IPAW-Replit-API/1.0",
    },
    body: JSON.stringify({ action: "restore", apiKey: getGasApiKey() }),
  }, 60_000);
  const database = response.database || response.data;
  if (!database || typeof database !== "object" || Array.isArray(database)) {
    throw new Error("Respons restore Google Apps Script tidak memiliki database yang valid.");
  }
  return {
    database: database as Record<string, any[]>,
    metadata: response.metadata,
  };
}

export async function mutateGas(
  action: "upsertRecord" | "deleteRecord",
  payload: Record<string, unknown>,
  candidateUrl?: string,
): Promise<any> {
  const baseUrl = resolveGasWebAppUrl(candidateUrl);
  return fetchGasJson(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
      Accept: "application/json, text/plain, */*",
      "User-Agent": "IPAW-Replit-API/1.0",
    },
    body: JSON.stringify({
      action,
      apiKey: getGasApiKey(),
      ...payload,
    }),
  }, 60_000);
}

export function safeHashMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}