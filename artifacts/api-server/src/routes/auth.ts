import { Router, type IRouter, type Request } from "express";
import { createHash } from "node:crypto";
import { readGasStore, safeHashMatches } from "../lib/gas";
import {
  clearSessionCookie,
  requireSession,
  setSessionCookie,
  type SessionUser,
} from "../lib/session";

const router: IRouter = Router();

interface GasUser {
  id?: string | number;
  username?: string;
  namaLengkap?: string;
  nama?: string;
  role?: string;
  passwordHash?: string;
  aktif?: boolean;
  status?: string;
}

interface LoginAttempt {
  failures: number;
  blockedUntil: number;
}

const attempts = new Map<string, LoginAttempt>();
const MAX_FAILURES = 5;
const BLOCK_MS = 5 * 60 * 1000;

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function passwordHash(password: string): string {
  return createHash("sha256").update(password, "utf8").digest("hex");
}

function normaliseRole(value: unknown): SessionUser["role"] {
  return String(value).trim().toLowerCase() === "superuser" ? "superuser" : "officer";
}

function toSessionUser(user: GasUser): SessionUser | null {
  const id = Number(user.id);
  const username = String(user.username || "").trim();
  if (!Number.isFinite(id) || !username) return null;
  return {
    id,
    username,
    namaLengkap: String(user.namaLengkap || user.nama || username),
    role: normaliseRole(user.role),
  };
}

function isActive(user: GasUser): boolean {
  if (typeof user.aktif === "boolean") return user.aktif;
  return String(user.status || "").trim().toLowerCase() === "active";
}

function isBlocked(key: string): boolean {
  const attempt = attempts.get(key);
  return Boolean(attempt && attempt.blockedUntil > Date.now());
}

function recordFailure(key: string): void {
  const current = attempts.get(key) || { failures: 0, blockedUntil: 0 };
  const failures = current.failures + 1;
  attempts.set(key, {
    failures,
    blockedUntil: failures >= MAX_FAILURES ? Date.now() + BLOCK_MS : 0,
  });
}

function clearFailures(key: string): void {
  attempts.delete(key);
}

router.post("/auth/login", async (req, res) => {
  const key = clientKey(req);
  if (isBlocked(key)) {
    res.status(429).json({
      success: false,
      message: "Terlalu banyak percobaan login. Coba lagi beberapa menit kemudian.",
    });
    return;
  }

  const username = typeof req.body?.username === "string"
    ? req.body.username.trim()
    : "";
  const password = typeof req.body?.password === "string"
    ? req.body.password
    : "";
  const candidateUrl = typeof req.query.url === "string" ? req.query.url : undefined;

  if (!username || !password || username.length > 120 || password.length > 1024) {
    recordFailure(key);
    res.status(401).json({ success: false, message: "Username atau password salah." });
    return;
  }

  let users: GasUser[];
  try {
    users = await readGasStore<GasUser>("users", candidateUrl);
  } catch (error) {
    req.log.error({ err: error }, "GAS users lookup failed");
    res.status(502).json({
      success: false,
      message: "Database Cloud tidak dapat diakses. Data lokal tetap aman.",
    });
    return;
  }

  const normalisedUsername = username.toLowerCase();
  const found = users.find(user =>
    String(user.username || "").trim().toLowerCase() === normalisedUsername,
  );
  const expectedHash = found?.passwordHash;
  const validPassword = Boolean(
    expectedHash &&
    safeHashMatches(String(expectedHash), passwordHash(password)),
  );

  if (!found || !validPassword || !isActive(found)) {
    recordFailure(key);
    res.status(401).json({ success: false, message: "Username atau password salah." });
    return;
  }

  const sessionUser = toSessionUser(found);
  if (!sessionUser) {
    recordFailure(key);
    res.status(401).json({ success: false, message: "Username atau password salah." });
    return;
  }

  clearFailures(key);
  setSessionCookie(res, sessionUser);
  res.json({ success: true, user: sessionUser });
});

router.get("/auth/me", requireSession, (req, res) => {
  res.json({ success: true, user: res.locals.authUser });
});

router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

export default router;