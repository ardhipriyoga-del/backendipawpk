import React from 'react';
import { useAppContext } from '../context/AppContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Code2 } from 'lucide-react';

const VERSION = '1.0.0';
const APP_NAME = 'IP Admission Workspace';
const TAGLINE = 'Integrated Inpatient Admission & Operational Workspace';

export default function AboutPage() {
  const { rsLogo } = useAppContext();

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* ── Hero ── */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
        <CardContent className="pt-10 pb-10 flex flex-col items-center text-center gap-4">
          <div className="w-20 h-20 rounded-full bg-gradient-to-b from-[hsl(186,73%,50%)] to-[hsl(186,73%,37%)] flex items-center justify-center shadow-sm">
            {rsLogo ? (
              <img src={rsLogo} alt="Logo" className="w-12 h-12 object-contain" />
            ) : (
              <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-11 h-11">
                <rect x="6" y="24" width="52" height="16" rx="4" fill="white" fillOpacity="0.9"/>
                <rect x="24" y="6" width="16" height="52" rx="4" fill="white" fillOpacity="0.9"/>
              </svg>
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-primary">{APP_NAME}</h1>
            <p className="text-sm font-medium text-muted-foreground mt-1">Version {VERSION}</p>
            <p className="text-xs text-primary/70 font-semibold mt-1 tracking-wide uppercase">{TAGLINE}</p>
          </div>
          <div className="text-sm text-muted-foreground max-w-3xl leading-relaxed text-justify space-y-4">
            <p>
              {APP_NAME} adalah aplikasi operasional rumah sakit yang dirancang untuk membantu petugas
              Admission Rawat Inap dalam mengelola seluruh proses kerja secara cepat, akurat, dan terintegrasi.
            </p>
            <p>
              Aplikasi ini menggabungkan berbagai modul operasional ke dalam satu workspace, sehingga pengguna
              tidak perlu berpindah aplikasi untuk menyelesaikan aktivitas operasional sehari-hari. IPAW
              dikembangkan dengan konsep <strong className="text-foreground">Offline First</strong> menggunakan
              penyimpanan lokal, sehingga tetap dapat berfungsi secara optimal pada lingkungan jaringan internal
              rumah sakit.
            </p>
            <p>
              IPAW dikembangkan secara mandiri sebagai sebuah inisiatif untuk mendukung peningkatan efisiensi
              proses kerja tim Admission. Seluruh fitur dirancang berdasarkan kebutuhan operasional di lapangan
              dengan tujuan menyederhanakan alur kerja, mengurangi proses manual, meningkatkan akurasi, serta
              membantu petugas Admission memberikan pelayanan yang lebih efektif dan efisien.
            </p>
            <p>
              Aplikasi ini terus dikembangkan secara berkelanjutan dengan mengutamakan kemudahan penggunaan,
              kecepatan akses, serta penyesuaian terhadap kebutuhan operasional yang terus berkembang di
              lingkungan rumah sakit.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Developer ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Code2 className="w-5 h-5 text-violet-500" /> Developer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-semibold text-foreground">Dedi Supriadi</p>
          <div className="text-muted-foreground space-y-1">
            <p>📱 <a href="https://wa.me/6208190261688" className="hover:text-primary transition-colors">08190261688</a></p>
            <p>✉️ <a href="mailto:nuxarcodex@gmail.com" className="hover:text-primary transition-colors">nuxarcodex@gmail.com</a></p>
          </div>
        </CardContent>
      </Card>

      {/* ── License notice ── */}
      <Card className="border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-900/10">
        <CardContent className="pt-5 pb-5 text-sm text-muted-foreground leading-relaxed">
          <p>
            <strong className="text-foreground">{APP_NAME}</strong> dibuat khusus sebagai sistem operasional
            internal rumah sakit.
          </p>
          <p className="mt-2 font-semibold text-amber-700 dark:text-amber-400">
            Tidak diperkenankan untuk diperjualbelikan atau didistribusikan tanpa izin dari pengembang.
          </p>
          <p className="mt-3 text-xs">© 2026 {APP_NAME} · All Rights Reserved. · Developed by Dedi Supriadi</p>
        </CardContent>
      </Card>
    </div>
  );
}
