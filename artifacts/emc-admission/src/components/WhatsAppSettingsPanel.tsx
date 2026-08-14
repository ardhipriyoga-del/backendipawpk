import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, LogOut, MessageCircle, RefreshCw, Send, Smartphone, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getWhatsAppQr,
  getWhatsAppStatus,
  logoutWhatsApp,
  testWhatsApp,
  type WhatsAppStatusResponse,
} from "../lib/whatsapp";

const initialStatus: WhatsAppStatusResponse = {
  connected: false,
  phone: null,
  status: "disconnected",
};

export default function WhatsAppSettingsPanel() {
  const [whatsapp, setWhatsapp] = useState(initialStatus);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [qrLoading, setQrLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getWhatsAppStatus();
      setWhatsapp(next);
      if (next.status !== "qr_required") setQrDataUrl("");
      if (next.status === "qr_required" && !qrDataUrl) {
        setQrLoading(true);
        try {
          setQrDataUrl(await getWhatsAppQr());
        } finally {
          setQrLoading(false);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Status WhatsApp gagal dibaca.");
    } finally {
      setLoading(false);
    }
  }, [qrDataUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (whatsapp.status === "connected") return;
    const interval = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(interval);
  }, [refresh, whatsapp.status]);

  const handleRefreshQr = async () => {
    setQrLoading(true);
    try {
      setQrDataUrl(await getWhatsAppQr());
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "QR WhatsApp gagal dimuat.");
    } finally {
      setQrLoading(false);
    }
  };

  const handleTest = async () => {
    if (!testPhone.trim()) {
      toast.error("Masukkan nomor WhatsApp untuk test.");
      return;
    }
    setTestLoading(true);
    try {
      const result = await testWhatsApp(testPhone);
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pesan test gagal dikirim.");
    } finally {
      setTestLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!window.confirm("Putuskan koneksi WhatsApp dan hapus session gateway?")) return;
    setLogoutLoading(true);
    try {
      const result = await logoutWhatsApp();
      setWhatsapp(initialStatus);
      setQrDataUrl("");
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Logout WhatsApp gagal.");
    } finally {
      setLogoutLoading(false);
    }
  };

  const statusLabel: Record<WhatsAppStatusResponse["status"], string> = {
    connected: "Terhubung",
    disconnected: "Belum terhubung",
    qr_required: "Menunggu scan QR",
    reconnecting: "Menghubungkan ulang",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-[#25D366]" />
          WhatsApp Gateway
        </CardTitle>
        <CardDescription>
          Satu koneksi WhatsApp bersama untuk mengirim pesan dari IPAW. Session disimpan di backend, bukan di browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-4">
          <div className="flex items-center gap-3">
            {whatsapp.connected ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <WifiOff className="h-5 w-5 text-amber-600" />
            )}
            <div>
              <p className="font-semibold">{statusLabel[whatsapp.status]}</p>
              <p className="text-sm text-muted-foreground">
                {whatsapp.phone ? `Nomor: ${whatsapp.phone}` : "Nomor belum tersedia"}
              </p>
            </div>
          </div>
          <Badge variant={whatsapp.connected ? "default" : "secondary"}>
            {loading ? "Memeriksa..." : whatsapp.status}
          </Badge>
        </div>

        {!whatsapp.connected && whatsapp.status === "qr_required" && (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Buka WhatsApp di ponsel, pilih Perangkat tertaut, lalu scan QR berikut.
            </div>
            <div className="flex justify-center rounded-xl border bg-white p-4">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="QR koneksi WhatsApp IPAW" className="h-72 w-72 max-w-full" />
              ) : (
                <div className="flex h-72 w-72 items-center justify-center text-center text-sm text-muted-foreground">
                  {qrLoading ? "Membuat QR..." : "QR belum tersedia"}
                </div>
              )}
            </div>
            <Button variant="outline" onClick={handleRefreshQr} disabled={qrLoading} className="gap-2">
              {qrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Muat ulang QR
            </Button>
          </div>
        )}

        {!whatsapp.connected && whatsapp.status !== "qr_required" && (
          <Button onClick={handleRefreshQr} disabled={qrLoading} className="gap-2">
            {qrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
            Hubungkan WhatsApp
          </Button>
        )}

        {whatsapp.connected && (
          <div className="space-y-3 rounded-lg border p-4">
            <p className="font-semibold">Test pengiriman</p>
            <p className="text-sm text-muted-foreground">
              Kirim “Test WhatsApp IPAW berhasil.” ke nomor tujuan untuk memastikan gateway siap digunakan.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={testPhone}
                onChange={(event) => setTestPhone(event.target.value)}
                placeholder="081234567890"
                inputMode="tel"
              />
              <Button onClick={handleTest} disabled={testLoading} className="gap-2">
                {testLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Test WhatsApp
              </Button>
            </div>
          </div>
        )}

        <Button
          variant="outline"
          onClick={handleLogout}
          disabled={logoutLoading || (!whatsapp.connected && whatsapp.status === "disconnected")}
          className="gap-2 text-destructive hover:text-destructive"
        >
          {logoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          Putuskan WhatsApp
        </Button>
      </CardContent>
    </Card>
  );
}