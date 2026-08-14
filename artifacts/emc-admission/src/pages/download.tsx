import React from 'react';
import { Download, FileCode2, HardDrive, Info, CheckCircle2, Terminal, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function DownloadPage() {

  const htmlFileUrl = `${import.meta.env.BASE_URL}ipaw.html`;
  const htmlDownloadName = 'ipaw.html';
  const htmlV2FileUrl = `${import.meta.env.BASE_URL}ipawv2.html`;
  const htmlV3FileUrl = `${import.meta.env.BASE_URL}ipawv3.html`;
  const htmlV2DownloadName = 'ipawv2.html';
  const batV2FileUrl = `${import.meta.env.BASE_URL}buka-ipawv2-offline.bat`;
  const batFileUrl  = `${import.meta.env.BASE_URL}buka-ipaw-offline.bat`;
  const proxyFileUrl = `${import.meta.env.BASE_URL}ipaw-offline-proxy.ps1`;
  const gasFileUrl = `${import.meta.env.BASE_URL}BackupCloudSpreadsheet.txt`;

  const steps = [
    'Pilih ipaw.html (V1) atau ipawv2.html (LocalDB-first), lalu download file HTML dan file bridge yang diperlukan ke folder yang sama, misalnya D:\\IPAW\\.',
    'Di jaringan internal RS, jalankan launcher yang sesuai: buka-ipaw-offline.bat untuk V1 atau buka-ipawv2-offline.bat untuk V2. Launcher menyalakan bridge lokal sehingga Cloud Backup/Restore dan TrakCare memakai koneksi workstation rumah sakit.',
    'Jika bridge tidak digunakan, file HTML tetap dapat dibuka langsung. Browser/proxy rumah sakit dapat mengizinkan membuka URL GAS tetapi memblokir fetch backup dari file://.',
    'Seluruh fitur tersedia di kedua versi offline. V2 menyimpan data kerja ke LocalDB terlebih dahulu; backup Cloud dan pemulihan tetap tersedia secara terkontrol.',
    'Saat ada update aplikasi, download ulang file versi yang digunakan beserta launcher/PS1 yang sesuai dan ganti file lama.',
  ];

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FileCode2 className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Download Aplikasi</h1>
          <Badge variant="secondary" className="ml-1">Offline</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
           Unduh file HTML mandiri yang dapat dijalankan dengan LocalDB tanpa internet — mencakup fitur:
           Dashboard, Pasien Rawat Inap, Pending Operan, Riwayat Pasien, Kasir, Laporan, Master Tarif,
           Operating Theatre, Backup Cloud, Log Aktivitas (Audit Trail), Sinkronisasi TrakCare, dan cache email Outlook.
           Fitur Cloud, TrakCare, dan Outlook memerlukan jaringan serta koneksi/otorisasi masing-masing.
           Tersedia juga launcher khusus untuk mengaktifkan akses TrakCare KTM di versi offline.
        </p>
      </div>

      {/* Download Cards */}
      <div className="space-y-3">

        {/* HTML File */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-5 flex flex-col sm:flex-row items-center gap-4">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-primary" />
                <span className="font-semibold text-base">ipaw.html</span>
                <Badge variant="outline" className="text-xs">Wajib</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                 Aplikasi lengkap · Cloud Backup melalui bridge/GAS · Data TrakCare melalui launcher jaringan RS
              </p>
               <p className="text-xs text-muted-foreground">Ukuran: ± 3,5 MB</p>
            </div>
            <a href={htmlFileUrl} download={htmlDownloadName}>
              <Button size="lg" className="gap-2 w-full sm:w-auto">
                <Download className="w-5 h-5" />
                Download HTML
              </Button>
            </a>
          </CardContent>
        </Card>

        <Card className="border-violet-300/70 bg-violet-50/70 dark:border-violet-700/50 dark:bg-violet-950/20">
          <CardContent className="p-5 flex flex-col sm:flex-row items-center gap-4">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                <span className="font-semibold text-base">ipawv3.html</span>
                <Badge variant="outline" className="text-xs border-violet-400 text-violet-700 dark:text-violet-300">
                  Deploy ke GAS
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Versi online self-contained untuk diunggah sebagai file HTML pada project Google Apps Script
              </p>
              <p className="text-xs text-muted-foreground">
                Tidak membutuhkan file://, launcher BAT, atau bridge offline. Pasangkan dengan kode GAS yang menyediakan view <code>?view=ipawv3</code>.
              </p>
            </div>
            <a href={htmlV3FileUrl} download="ipawv3.html">
              <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto border-violet-400 text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:border-violet-600 dark:hover:bg-violet-950">
                <Download className="w-5 h-5" />
                Download V3
              </Button>
            </a>
          </CardContent>
        </Card>

        <Card className="border-emerald-300/60 bg-emerald-50/60 dark:border-emerald-700/40 dark:bg-emerald-950/20">
          <CardContent className="p-5 flex flex-col sm:flex-row items-center gap-4">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <span className="font-semibold text-base">ipawv2.html</span>
                <Badge variant="outline" className="text-xs border-emerald-400 text-emerald-700 dark:text-emerald-300">
                  LocalDB-first
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                 Versi LocalDB-first · data kerja disimpan di LocalDB · Cloud hanya sebagai backup
              </p>
              <p className="text-xs text-muted-foreground">
                 Tetap dapat digunakan saat internet terputus; backup otomatis dilanjutkan saat koneksi tersedia.
                 Cache email Outlook yang sudah tersimpan tetap tampil. Sinkronisasi Outlook memerlukan koneksi
                 Microsoft yang aktif. Untuk Windows, gunakan launcher V2 di bawah.
              </p>
            </div>
            <a href={htmlV2FileUrl} download={htmlV2DownloadName}>
              <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto border-emerald-400 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:border-emerald-600 dark:hover:bg-emerald-950">
                <Download className="w-5 h-5" />
                Download V2
              </Button>
            </a>
          </CardContent>
        </Card>

        <Card className="border-emerald-200/80 bg-emerald-50/30 dark:border-emerald-800/50 dark:bg-emerald-950/10">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-start gap-3 flex-1">
              <Terminal className="w-5 h-5 text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-sm">buka-ipawv2-offline.bat</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Launcher Windows untuk ipawv2.html · mengaktifkan bridge Cloud dan akses TrakCare
                </p>
              </div>
            </div>
            <a href={batV2FileUrl} download="buka-ipawv2-offline.bat">
              <Button variant="outline" size="sm" className="gap-2 w-full sm:w-auto border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300">
                <Download className="w-4 h-4" />
                Download Launcher V2
              </Button>
            </a>
          </CardContent>
        </Card>

        {/* BAT File */}
        <Card className="border-amber-300/60 bg-amber-50/60 dark:border-amber-700/40 dark:bg-amber-950/20">
          <CardContent className="p-5 flex flex-col sm:flex-row items-center gap-4">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <span className="font-semibold text-base">buka-ipaw-offline.bat</span>
                <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-300">
                   Untuk TrakCare
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                  Launcher Windows · Membuka Chrome dengan CORS bypass untuk TrakCare KTM dan Operating Theatre
              </p>
              <p className="text-xs text-muted-foreground">
                  Wajib untuk Monitoring KTM dan Pasien Rencana Tindakan: komputer harus terhubung ke jaringan internal RS EMC
              </p>
            </div>
            <a href={batFileUrl} download="buka-ipaw-offline.bat">
              <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto border-amber-400 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:border-amber-600 dark:hover:bg-amber-950">
                <Download className="w-5 h-5" />
                Download BAT
              </Button>
            </a>
          </CardContent>
        </Card>

        <Card className="border-sky-300/60 bg-sky-50/60 dark:border-sky-700/40 dark:bg-sky-950/20">
          <CardContent className="p-5 flex flex-col sm:flex-row items-center gap-4">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                <span className="font-semibold text-base">ipaw-offline-proxy.ps1</span>
                <Badge variant="outline" className="text-xs border-sky-400 text-sky-700 dark:text-sky-300">Wajib</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Bridge lokal untuk login TrakCare dari jaringan internal RS EMC
              </p>
              <p className="text-xs text-muted-foreground">
                Harus berada di folder yang sama dengan ipaw.html dan file .bat
              </p>
            </div>
            <a href={proxyFileUrl} download="ipaw-offline-proxy.ps1">
              <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto border-sky-400 text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:border-sky-600 dark:hover:bg-sky-950">
                <Download className="w-5 h-5" />
                Download PS1
              </Button>
            </a>
          </CardContent>
        </Card>

        <Card className="border-violet-300/60 bg-violet-50/60 dark:border-violet-700/40 dark:bg-violet-950/20">
          <CardContent className="p-5 flex flex-col sm:flex-row items-center gap-4">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                <span className="font-semibold text-base">BackupCloudSpreadsheet.txt</span>
                <Badge variant="outline" className="text-xs border-violet-400 text-violet-700 dark:text-violet-300">
                  Google Apps Script
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Kode lengkap untuk Cloud Backup/Restore IPAW di Google Apps Script
              </p>
              <p className="text-xs text-muted-foreground">
                Buka file ini, salin seluruh isinya ke project Google Apps Script, lalu deploy sebagai Web App.
              </p>
            </div>
            <a href={gasFileUrl} download="BackupCloudSpreadsheet.txt">
              <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto border-violet-400 text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:border-violet-600 dark:hover:bg-violet-950">
                <Download className="w-5 h-5" />
                Download GAS
              </Button>
            </a>
          </CardContent>
        </Card>

      </div>

      {/* Cara Pakai */}
      <Card className="shadow-none border-border">
        <CardHeader className="py-3 px-4 bg-muted/40 border-b border-border rounded-t-lg">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Info className="w-4 h-4" /> Cara Menggunakan
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </div>
              <p className="text-sm">{step}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Penjelasan BAT */}
      <Card className="shadow-none border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> Apa yang dilakukan file .bat?
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-400">
             File <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">buka-ipaw-offline.bat</code> membuka Chrome dengan flag{' '}
            <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">--disable-web-security</code> dan profil browser terpisah
            (<code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">ChromeIPAW_Profile</code>) khusus untuk aplikasi ini.
             Ini memungkinkan Monitoring KTM mengakses endpoint TrakCare langsung dari file lokal tanpa hambatan CORS.
          </p>
          <ul className="text-sm text-amber-700 dark:text-amber-400 space-y-1.5">
            {[
              'Gunakan window Chrome ini hanya untuk IP Admission Workspace — jangan untuk browsing internet.',
              'Profil Chrome khusus dibuat di folder Temp, tidak akan mempengaruhi profil Chrome utama Anda.',
              'File .bat hanya berjalan di Windows. Di Mac/Linux, gunakan file HTML langsung (tanpa TrakCare sync).',
              'Jika Chrome tidak ditemukan otomatis, edit baris CHROME= di dalam file .bat sesuai lokasi instalasi.',
            ].map((note, i) => (
              <li key={i} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Catatan Umum */}
      <Card className="shadow-none border-border bg-muted/30">
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Info className="w-4 h-4" /> Catatan Umum
          </p>
          <ul className="text-sm text-muted-foreground space-y-1.5">
            {[
              'Data pasien tersimpan di browser komputer tersebut (IndexedDB), tidak ikut di file HTML.',
              'Gunakan fitur Backup & Restore di menu Pengaturan untuk memindahkan data antar komputer.',
              'Gunakan Google Chrome atau Microsoft Edge — jangan Internet Explorer.',
            ].map((note, i) => (
              <li key={i} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

    </div>
  );
}
