import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { logger } from "./logger";

export type WhatsAppStatus =
  | "connected"
  | "disconnected"
  | "qr_required"
  | "reconnecting";

export type WhatsAppStatusResponse = {
  connected: boolean;
  phone: string | null;
  status: WhatsAppStatus;
};

const authDir =
  process.env["WHATSAPP_AUTH_DIR"] ??
  path.resolve(process.cwd(), "data", "whatsapp-auth");
const maxReconnectAttempts = 8;

let socket: WASocket | null = null;
let qrValue: string | null = null;
let status: WhatsAppStatus = "disconnected";
let phone: string | null = null;
let initialization: Promise<void> | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;

type BaileysLogger = {
  level: string;
  child: (obj: Record<string, unknown>) => BaileysLogger;
  trace: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

const baileysLogger: BaileysLogger = {
  level: "silent",
  child: () => baileysLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function log(message: string, data?: Record<string, unknown>) {
  logger.info({ ...data, module: "whatsapp" }, `[WhatsApp] ${message}`);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function disconnectCode(error: unknown): number | undefined {
  return (error as { output?: { statusCode?: number } })?.output?.statusCode;
}

function isPermanentDisconnect(code: number | undefined): boolean {
  return (
    code === DisconnectReason.loggedOut ||
    code === DisconnectReason.badSession ||
    code === DisconnectReason.connectionReplaced ||
    code === DisconnectReason.forbidden ||
    code === DisconnectReason.multideviceMismatch
  );
}

function clearRuntimeState() {
  socket = null;
  phone = null;
  qrValue = null;
}

async function resetAuthState() {
  clearRuntimeState();
  await rm(authDir, { recursive: true, force: true });
  status = "disconnected";
}

function scheduleReconnect() {
  if (reconnectTimer || initialization) return;
  if (reconnectAttempts >= maxReconnectAttempts) {
    status = "disconnected";
    log("Reconnect stopped after maximum attempts");
    return;
  }

  reconnectAttempts += 1;
  const delay = Math.min(30_000, 1_000 * 2 ** (reconnectAttempts - 1));
  status = "reconnecting";
  log("Reconnecting", { attempt: reconnectAttempts, delayMs: delay });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void initializeWhatsApp();
  }, delay);
}

function scheduleReconnectAfterInitialization() {
  setTimeout(() => scheduleReconnect(), 0);
}

async function connectWhatsApp(): Promise<void> {
  await mkdir(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  log("Session loaded");

  const nextSocket = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu("IPAW"),
    logger: baileysLogger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldIgnoreJid: (jid) => jid === "status@broadcast",
  });
  socket = nextSocket;

  nextSocket.ev.on("creds.update", saveCreds);
  nextSocket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrValue = qr;
      phone = null;
      status = "qr_required";
      log("QR generated");
    }

    if (connection === "open") {
      const rawPhone = nextSocket.user?.id?.split(":")[0]?.split("@")[0];
      phone = rawPhone || null;
      qrValue = null;
      status = "connected";
      reconnectAttempts = 0;
      log("Connected", { phone: phone ?? "unknown" });
      return;
    }

    if (connection !== "close") return;
    const code = disconnectCode(lastDisconnect?.error);
    clearRuntimeState();

    if (isPermanentDisconnect(code)) {
      status = "disconnected";
      log("Disconnected", { reason: code ?? "permanent" });
      if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
        void resetAuthState().then(scheduleReconnectAfterInitialization);
      }
      return;
    }

    status = "reconnecting";
    log("Disconnected", { reason: code ?? "temporary" });
    scheduleReconnectAfterInitialization();
  });
}

export async function initializeWhatsApp(): Promise<void> {
  if (initialization) return initialization;
  if (socket && (status === "connected" || status === "qr_required")) return;

  initialization = connectWhatsApp()
    .catch((error) => {
      clearRuntimeState();
      status = "disconnected";
      logger.warn(
        { module: "whatsapp", error: errorMessage(error) },
        "[WhatsApp] Initialization failed; IPAW will continue without WhatsApp",
      );
      scheduleReconnectAfterInitialization();
    })
    .finally(() => {
      initialization = null;
    });
  return initialization;
}

export function getWhatsAppStatus(): WhatsAppStatusResponse {
  return {
    connected: status === "connected",
    phone,
    status,
  };
}

export async function getWhatsAppQr(): Promise<string | null> {
  await initializeWhatsApp();
  if (!qrValue) return null;
  return QRCode.toDataURL(qrValue, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 360,
  });
}

export function normalizeWhatsAppNumber(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

export function validateWhatsAppNumber(value: string): string | null {
  const normalized = normalizeWhatsAppNumber(value);
  if (!/^\d{8,15}$/.test(normalized)) return null;
  if (normalized.startsWith("62") && !/^628\d{7,12}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export async function sendWhatsAppMessage(
  phoneInput: string,
  message: string,
): Promise<{ messageId: string; phone: string }> {
  const normalizedPhone = validateWhatsAppNumber(phoneInput);
  if (!normalizedPhone) {
    throw new Error("Nomor WhatsApp tidak valid.");
  }
  const text = message.trim();
  if (!text || text.length > 4096) {
    throw new Error("Pesan wajib diisi dan maksimal 4096 karakter.");
  }
  if (status !== "connected" || !socket) {
    throw new Error("WhatsApp belum terhubung.");
  }

  const jid = `${normalizedPhone}@s.whatsapp.net`;
  const result = await socket.sendMessage(jid, { text });
  const messageId = result?.key?.id;
  if (!messageId) throw new Error("WhatsApp tidak mengembalikan ID pesan.");
  log("Message sent", { phone: normalizedPhone, messageId });
  return { phone: normalizedPhone, messageId };
}

export async function logoutWhatsApp(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  const currentSocket = socket;
  clearRuntimeState();
  status = "disconnected";
  try {
    await currentSocket?.logout();
  } finally {
    await resetAuthState();
    log("Logged out");
  }
}

// WhatsApp is an optional feature. Startup must never wait for it or fail IPAW.
log("Initializing", { authDir });
void initializeWhatsApp();