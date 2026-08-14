import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response as ExpressResponse,
} from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";

const router: IRouter = Router();
const connectors = new ReplitConnectors();

function requireReadRole(req: Request, res: ExpressResponse, next: NextFunction) {
  const role = String(req.header("x-ipaw-role") ?? "").toLowerCase();
  if (!["superuser", "officer"].includes(role)) {
    res.status(403).json({
      success: false,
      message: "Akses Outlook tidak diizinkan untuk role ini.",
    });
    return;
  }
  next();
}

function connectorErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not connected|unauthorized|401|oauth|credential/i.test(message)) {
    return "Belum diotorisasi melalui Microsoft.";
  }
  return "Koneksi Outlook belum dapat diperiksa.";
}

function graphPath(path: string): string {
  return path.startsWith("/v1.0/") ? path : `/v1.0${path.startsWith("/") ? path : `/${path}`}`;
}

async function graphGet<T>(path: string): Promise<{ response: globalThis.Response; data: T }> {
  const response = await connectors.proxy("outlook", graphPath(path), {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { response, data };
}

router.get("/outlook/status", requireReadRole, async (_req, res) => {
  try {
    const { response, data } = await graphGet<{
      mail?: string | null;
      userPrincipalName?: string | null;
    }>("/me?$select=mail,userPrincipalName");

    if (!response.ok) {
      res.json({
        connected: false,
        emailAddress: null,
        provider: "microsoft-outlook",
        message: "Belum diotorisasi melalui Microsoft.",
      });
      return;
    }

    res.json({
      connected: true,
      emailAddress: data.mail || data.userPrincipalName || null,
      provider: "microsoft-outlook",
      message: "Koneksi Microsoft Graph aktif.",
    });
  } catch (error) {
    res.json({
      connected: false,
      emailAddress: null,
      provider: "microsoft-outlook",
      message: connectorErrorMessage(error),
    });
  }
});

router.get("/outlook/messages", requireReadRole, async (_req, res) => {
  try {
    const query = new URLSearchParams({
      "$select": "id,subject,from,receivedDateTime,webLink",
      "$orderby": "receivedDateTime desc",
      "$top": "50",
    });
    const { response, data } = await graphGet<{
      value?: Array<{
        id?: string;
        subject?: string | null;
        from?: { emailAddress?: { name?: string | null; address?: string | null } };
        receivedDateTime?: string;
        webLink?: string | null;
      }>;
      error?: { message?: string };
    }>(`/me/mailFolders/inbox/messages?${query.toString()}`);

    if (!response.ok) {
      res.status(response.status === 401 || response.status === 403 ? 503 : 502).json({
        success: false,
        code: "OUTLOOK_NOT_CONNECTED",
        message: response.status === 401 || response.status === 403
          ? "Outlook belum terhubung. Otorisasi Microsoft diperlukan."
          : data.error?.message ?? "Inbox Outlook tidak dapat dibaca.",
      });
      return;
    }

    const messages = (data.value ?? [])
      .filter(message => Boolean(message.id && message.subject && message.receivedDateTime))
      .map(message => ({
        id: message.id as string,
        subject: message.subject as string,
        senderName: message.from?.emailAddress?.name ?? "",
        senderAddress: message.from?.emailAddress?.address ?? "",
        receivedAt: message.receivedDateTime as string,
        webLink: message.webLink ?? null,
      }));

    res.json({ messages, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({
      success: false,
      code: "OUTLOOK_NOT_CONNECTED",
      message: connectorErrorMessage(error),
    });
  }
});

export default router;
