import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export const IPAW_SESSION_COOKIE = "ipaw_session";
const SESSION_MAX_AGE_SECONDS = 30 * 60;

export interface SessionUser {
  id: number;
  username: string;
  namaLengkap: string;
  role: "superuser" | "officer";
}

interface SessionPayload {
  user: SessionUser;
  issuedAt: number;
  expiresAt: number;
}

function getSessionSecret(): string {
  const secret = process.env["SESSION_SECRET"]?.trim();
  if (!secret) {
    throw new Error("SESSION_SECRET belum dikonfigurasi.");
  }
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string): string {
  return createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function signaturesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").flatMap(part => {
      const separator = part.indexOf("=");
      if (separator < 0) return [];
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      return key ? [[key, decodeURIComponent(value)] as const] : [];
    }),
  );
}

export function createSessionToken(user: SessionUser): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    user,
    issuedAt,
    expiresAt: issuedAt + SESSION_MAX_AGE_SECONDS,
  };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function readSessionUser(req: Request): SessionUser | null {
  const token = parseCookies(req.headers.cookie)[IPAW_SESSION_COOKIE];
  if (!token) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = token.slice(0, separator);
  const receivedSignature = token.slice(separator + 1);
  if (!signaturesMatch(sign(encoded), receivedSignature)) return null;

  try {
    const payload = JSON.parse(decode(encoded)) as SessionPayload;
    if (!payload?.user || payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    if (
      !Number.isFinite(payload.user.id) ||
      !payload.user.username ||
      !["superuser", "officer"].includes(payload.user.role)
    ) {
      return null;
    }
    return payload.user;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, user: SessionUser): void {
  const secure = process.env["NODE_ENV"] === "production";
  res.cookie(IPAW_SESSION_COOKIE, createSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(IPAW_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
  });
}

export function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = readSessionUser(req);
  if (!user) {
    res.status(401).json({ success: false, message: "Sesi tidak valid atau sudah berakhir." });
    return;
  }
  res.locals.authUser = user;
  next();
}