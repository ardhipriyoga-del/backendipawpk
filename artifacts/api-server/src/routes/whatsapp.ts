import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  getWhatsAppQr,
  getWhatsAppStatus,
  logoutWhatsApp,
  sendWhatsAppMessage,
} from "../lib/whatsapp";

const router: IRouter = Router();
const rateWindowMs = 60_000;
const maxSendsPerWindow = 5;
const sendAttempts = new Map<string, { startedAt: number; count: number }>();

function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = String(req.header("x-ipaw-role") ?? "").toLowerCase();
    if (!allowedRoles.includes(role)) {
      res.status(403).json({
        success: false,
        message: "Akses WhatsApp tidak diizinkan untuk role ini.",
      });
      return;
    }
    next();
  };
}

const requireSuperuser = requireRole(["superuser"]);
const requireWhatsAppSender = requireRole(["superuser", "officer"]);

function rateLimitSend(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const previous = sendAttempts.get(key);
  if (!previous || now - previous.startedAt >= rateWindowMs) {
    sendAttempts.set(key, { startedAt: now, count: 1 });
    next();
    return;
  }
  if (previous.count >= maxSendsPerWindow) {
    res.status(429).json({
      success: false,
      message: "Batas pengiriman tercapai. Coba lagi beberapa saat.",
    });
    return;
  }
  previous.count += 1;
  next();
}

router.get("/whatsapp/status", requireSuperuser, async (_req, res) => {
  res.json(getWhatsAppStatus());
});

router.get("/whatsapp/qr", requireSuperuser, async (_req, res) => {
  try {
    const dataUrl = await getWhatsAppQr();
    if (!dataUrl) {
      res.status(404).json({ success: false, message: "QR WhatsApp belum tersedia." });
      return;
    }
    res.json({ success: true, dataUrl });
  } catch {
    res.status(503).json({ success: false, message: "QR WhatsApp belum dapat dibuat." });
  }
});

router.post("/whatsapp/send", requireWhatsAppSender, rateLimitSend, async (req, res) => {
  const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  try {
    const result = await sendWhatsAppMessage(phone, message);
    res.json({
      success: true,
      message: "Pesan berhasil dikirim.",
      messageId: result.messageId,
      phone: result.phone,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Pesan WhatsApp gagal dikirim.",
    });
  }
});

router.post("/whatsapp/test", requireWhatsAppSender, rateLimitSend, async (req, res) => {
  const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
  try {
    const result = await sendWhatsAppMessage(phone, "Test WhatsApp IPAW berhasil.");
    res.json({
      success: true,
      message: "Pesan test berhasil dikirim.",
      messageId: result.messageId,
      phone: result.phone,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Pesan test gagal dikirim.",
    });
  }
});

router.post("/whatsapp/logout", requireSuperuser, async (_req, res) => {
  try {
    await logoutWhatsApp();
    res.json({ success: true, message: "WhatsApp berhasil diputuskan." });
  } catch {
    res.status(500).json({ success: false, message: "WhatsApp gagal diputuskan." });
  }
});

export default router;