import { apiUrl } from "./apiConfig";

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

function roleHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const raw = localStorage.getItem("emc_session");
    const session = raw ? JSON.parse(raw) : null;
    if (session?.user?.role) headers["X-IPAW-Role"] = session.user.role;
    if (session?.user?.username) headers["X-IPAW-User"] = session.user.username;
  } catch {
    // The API will reject requests without a valid superuser role header.
  }
  return headers;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...roleHeaders(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    throw new Error(data.message ?? "Permintaan WhatsApp gagal.");
  }
  return data;
}

export async function getWhatsAppStatus(): Promise<WhatsAppStatusResponse> {
  return request<WhatsAppStatusResponse>("/api/whatsapp/status");
}

export async function getWhatsAppQr(): Promise<string> {
  const result = await request<{ success: boolean; dataUrl: string }>("/api/whatsapp/qr");
  return result.dataUrl;
}

export async function sendWhatsApp(
  phone: string,
  message: string,
): Promise<{ success: boolean; message: string; messageId?: string }> {
  return request("/api/whatsapp/send", {
    method: "POST",
    body: JSON.stringify({ phone, message }),
  });
}

export async function testWhatsApp(phone: string): Promise<{ success: boolean; message: string }> {
  return request("/api/whatsapp/test", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export async function logoutWhatsApp(): Promise<{ success: boolean; message: string }> {
  return request("/api/whatsapp/logout", { method: "POST" });
}