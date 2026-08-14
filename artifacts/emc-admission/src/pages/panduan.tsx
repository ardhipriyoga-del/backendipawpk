import React, { useState } from 'react';
import {
  LayoutDashboard, Users, Clock, History, RefreshCw, FileBarChart,
  Receipt, Settings, FileSpreadsheet, Download, Upload, BookOpen,
  ChevronRight, Info, AlertTriangle, Lightbulb, CheckCircle2,
  Search, Plus, Pencil, Trash2, FileDown, Send, Eye, RotateCcw,
  Shield, Database, UserCog, Wifi, WifiOff, FileText, Bell,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
interface Step {
  text: string;
  sub?: string[];
}
interface TipBlock {
  kind: 'tip' | 'warning' | 'info';
  text: string;
}
interface Section {
  title: string;
  steps?: Step[];
  tips?: TipBlock[];
  text?: string;
}
interface Module {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
  description: string;
  sections: Section[];
}

/* ─────────────────────────────────────────────
   Panduan content
───────────────────────────────────────────── */
const MODULES: Module[] = [
  {
    id: 'hak-akses',
    label: 'Hak Akses & Keamanan',
    icon: <Shield className="w-4 h-4" />,
    badge: 'ISO-aligned',
    badgeVariant: 'outline',
    description: 'Matriks akses Officer dan Superuser untuk menjaga kerahasiaan data kesehatan, akuntabilitas, dan pemisahan tanggung jawab.',
    sections: [
      {
        title: 'Prinsip yang digunakan',
        steps: [
          { text: 'Least privilege: setiap user hanya diberi akses minimum yang diperlukan untuk tugas resminya.' },
          { text: 'Need-to-know: data pasien digunakan hanya untuk proses admission, handover, monitoring, billing, dan tindak lanjut yang ditugaskan.' },
          { text: 'Pemisahan tanggung jawab: pengaturan sistem, master data, backup/restore, dan manajemen user berada pada Superuser.' },
          { text: 'Akuntabilitas: aktivitas penting dicatat pada audit trail dan akses perlu ditinjau berkala oleh penanggung jawab.' },
        ],
        tips: [
          { kind: 'info', text: 'Kontrol ini selaras dengan prinsip keamanan informasi kesehatan ISO 27799 dan pengendalian proses ISO 9001. Implementasi kontrol organisasi, pelatihan, dan review berkala tetap diperlukan untuk pemenuhan standar secara menyeluruh.' },
        ],
      },
      {
        title: 'Akses Officer',
        steps: [
          { text: 'Dapat melihat dan menggunakan Dashboard, Pasien Rawat Inap, Preadmission, Rencana Tindakan, In Progress, dan Selesai Tindakan.' },
          { text: 'Dapat menjalankan Checklist Pasien, Pending Operan, Pesan Kasir, Monitoring KTM, IGD Ward, Billing Checker, dan Estimasi Biaya Tindakan.' },
          { text: 'Dapat melihat Riwayat Pasien dan Laporan Operasional untuk kebutuhan pekerjaan.' },
          { text: 'Dapat mengubah Profil, Sesi & Keamanan, serta preferensi Notifikasi miliknya sendiri.' },
        ],
      },
      {
        title: 'Akses yang dibatasi untuk Superuser',
        steps: [
          { text: 'Master User, perubahan role, dan status akun.' },
          { text: 'Konfigurasi aplikasi/rumah sakit, endpoint, integrasi TrakCare, dan sinkronisasi teknis.' },
          { text: 'Import massal, Cloud Backup/Restore, Download Aplikasi, dan distribusi offline.' },
          { text: 'Master Tarif, Master Checklist, Template Pesan Kasir, Billing Rule, dan Log Aktivitas.' },
        ],
        tips: [
          { kind: 'warning', text: 'Officer yang membutuhkan akses tambahan harus mendapat persetujuan penanggung jawab dan penetapan role yang sesuai. Jangan berbagi username atau password.' },
        ],
      },
      {
        title: 'Review akses',
        steps: [
          { text: 'Superuser meninjau daftar akun dan role secara berkala serta ketika terjadi mutasi jabatan atau perubahan tugas.' },
          { text: 'Akun yang tidak lagi diperlukan harus dinonaktifkan segera.' },
          { text: 'Insiden, akses tidak sah, atau kesalahan data dilaporkan melalui prosedur internal rumah sakit.' },
        ],
      },
    ],
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: <LayoutDashboard className="w-4 h-4" />,
    description: 'Halaman utama yang menampilkan ringkasan operasional admission secara real-time.',
    sections: [
      {
        title: 'Membaca Kartu Statistik',
        steps: [
          { text: 'Kartu Pasien Aktif — jumlah pasien rawat inap yang masih berstatus aktif.' },
          { text: 'Kartu Pending Operan — jumlah tugas yang belum diselesaikan dari shift sebelumnya.' },
          { text: 'Kartu Pasien IGD — pasien dari IGD yang terpantau oleh TrakCare Sync.' },
          { text: 'Kartu Rencana Pulang — pasien yang dijadwalkan pulang hari ini.' },
        ],
      },
      {
        title: 'Panel Sinkronisasi TrakCare',
        steps: [
          { text: 'Status koneksi (Online/Offline) ditampilkan di pojok kanan atas.' },
          { text: 'Klik tombol Sync untuk memperbarui data pasien dari TrakCare secara manual.' },
          { text: 'Waktu sinkronisasi terakhir ditampilkan di bawah tombol.' },
        ],
        tips: [
          { kind: 'tip', text: 'Dashboard diperbarui otomatis setiap beberapa menit selama aplikasi terbuka dan ada koneksi.' },
        ],
      },
    ],
  },
  {
    id: 'patients',
    label: 'Pasien Rawat Inap',
    icon: <Users className="w-4 h-4" />,
    description: 'Modul inti untuk mengelola seluruh data pasien rawat inap — dari pendaftaran hingga pemulangan.',
    sections: [
      {
        title: 'Menambah Pasien Baru',
        steps: [
          { text: 'Klik tombol + Tambah Pasien di sudut kanan atas.' },
          { text: 'Isi formulir: No. RM, Nama Pasien, Tanggal Masuk, Ruangan, Kelas, Diagnosa, Dokter, dan Jaminan.' },
          { text: 'Klik Simpan untuk menyimpan data — pasien akan muncul di daftar dengan status Aktif.' },
        ],
        tips: [
          { kind: 'tip', text: 'Data pasien dari TrakCare dapat disinkronkan otomatis — klik tombol Sync TrakCare untuk mengimpor tanpa mengetik manual.' },
        ],
      },
      {
        title: 'Mencari dan Memfilter Pasien',
        steps: [
          { text: 'Gunakan kotak pencarian untuk mencari berdasarkan nama atau nomor RM.' },
          { text: 'Filter berdasarkan ruangan, kelas, atau jaminan menggunakan dropdown filter.' },
          { text: 'Klik header kolom untuk mengurutkan data.' },
        ],
      },
      {
        title: 'Mengedit Data Pasien',
        steps: [
          { text: 'Klik ikon Pensil (Edit) pada baris pasien yang ingin diubah.' },
          { text: 'Perbarui field yang diperlukan, lalu klik Simpan.' },
        ],
      },
      {
        title: 'Memulangkan Pasien',
        steps: [
          { text: 'Klik ikon aksi pada baris pasien, lalu pilih Pulangkan.' },
          { text: 'Isi tanggal dan jam pulang, serta catatan jika diperlukan.' },
          { text: 'Status pasien akan berubah menjadi Pulang dan dipindah ke Riwayat.' },
        ],
        tips: [
          { kind: 'warning', text: 'Pasien yang sudah dipulangkan tidak dapat diedit. Pastikan data sudah benar sebelum mengkonfirmasi.' },
        ],
      },
      {
        title: 'Sinkronisasi TrakCare',
        steps: [
          { text: 'Pastikan perangkat terhubung ke jaringan RS.' },
          { text: 'Klik Sync TrakCare — aplikasi akan menarik data pasien aktif dari sistem TrakCare.' },
          { text: 'Data baru akan ditandai dengan badge "Baru dari TrakCare" agar mudah dikenali.' },
          { text: 'Konfirmasi data sebelum disimpan ke database lokal.' },
        ],
        tips: [
          { kind: 'info', text: 'Sync hanya membaca data dari TrakCare — tidak menulis atau mengubah data di sistem TrakCare.' },
        ],
      },
    ],
  },
  {
    id: 'operating-theatre',
    label: 'Operating Theatre',
    icon: <FileText className="w-4 h-4" />,
    badge: 'H-1',
    badgeVariant: 'outline',
    description: 'Pemantauan rencana operasi, pasien Preadmission, pasien In Progress, dan pasien yang sudah selesai tindakan dengan sumber data TrakCare.',
    sections: [
      {
        title: 'Memahami empat status Operating Theatre',
        steps: [
          { text: 'Rencana Tindakan menampilkan pasien dari rencana operasi yang sudah terpetakan ke pasien rawat inap aktif.' },
          { text: 'Preadmission menampilkan pasien dari rencana operasi yang belum terpetakan ke rawat inap aktif.' },
          { text: 'In Progress menampilkan pasien yang sedang menjalani proses tindakan di Operating Theatre.' },
          { text: 'Selesai Tindakan menampilkan pasien yang telah selesai dipantau dan masih terkait dengan rawat inap aktif.' },
        ],
        tips: [
          { kind: 'info', text: 'Data pasien aktif rawat inap ditentukan dari status Aktif dan pencocokan identitas pasien. Pasien berstatus Pulang atau Pulang Pending tidak dianggap sebagai rawat inap aktif.' },
        ],
      },
      {
        title: 'Rencana Tindakan',
        steps: [
          { text: 'Buka menu Pasien Rencana Tindakan.' },
          { text: 'Gunakan tab Rencana Tindakan untuk melihat pasien yang sudah terpetakan ke rawat inap aktif.' },
          { text: 'Gunakan pencarian, filter tanggal, pilihan tampilan kartu/tabel, atau pagination untuk menemukan pasien.' },
          { text: 'Klik kartu atau baris pasien untuk membuka detail rencana operasi, tanggal tindakan, ruang operasi, DPJP, penjamin, dan PBO bila tersedia.' },
          { text: 'Klik Refresh untuk mengambil snapshot terbaru dari TrakCare. Status sumber data menunjukkan apakah data berasal dari TrakCare live atau cache terakhir.' },
        ],
        tips: [
          { kind: 'warning', text: 'Rencana Tindakan hanya menampilkan pasien rawat inap aktif. Pasien yang belum rawat inap tidak dimasukkan ke daftar ini, tetapi dipindahkan ke Preadmission.' },
        ],
      },
      {
        title: 'Preadmission dan Masuk Hari Ini',
        steps: [
          { text: 'Buka menu Pasien Preadmission untuk melihat semua pasien yang belum rawat inap aktif.' },
          { text: 'Di dalam halaman Preadmission, gunakan pilihan Semua Preadmission untuk melihat seluruh daftar.' },
          { text: 'Gunakan pilihan Masuk Hari Ini untuk memfilter pasien yang diperkirakan masuk rawat inap hari ini.' },
          { text: 'Logika Masuk Hari Ini adalah H-1: tanggal operasi besok berarti estimasi masuk rawat inap hari ini. Contoh: operasi 11/08/2026 → estimasi masuk 10/08/2026.' },
          { text: 'Periksa badge Masuk Hari Ini, tanggal operasi, No. RM, episode, serta status Current atau Belum Rawat inap pada detail pasien.' },
          { text: 'Gunakan tombol Excel atau PDF untuk mengekspor daftar yang sedang difilter.' },
        ],
        tips: [
          { kind: 'info', text: 'Perhitungan H-1 menggunakan kalender lokal dan format tanggal DD/MM/YYYY. Ini mencegah tanggal bergeser akibat perbedaan zona waktu.' },
          { kind: 'warning', text: 'Preadmission disimpan di cache lokal dan cloud. Data tidak langsung hilang ketika sumber URL sementara kosong; pasien kedaluwarsa setelah H+1 dari tanggal rencana tindakan sesuai kebijakan aplikasi.' },
        ],
      },
      {
        title: 'In Progress dan Selesai Tindakan',
        steps: [
          { text: 'Pilih tab In Progress untuk melihat tindakan yang sedang berlangsung, termasuk waktu dibuat, rencana tindakan, ruang operasi, DPJP, penjamin, dan keterangan.' },
          { text: 'Pilih tab Selesai Tindakan untuk melihat pasien yang sudah selesai dipantau.' },
          { text: 'Gunakan filter tanggal dan pencarian pada In Progress bila daftar sedang panjang.' },
          { text: 'Buka detail pasien untuk memeriksa status pemetaan identitas dan informasi tindakan.' },
          { text: 'Gunakan ekspor Excel/PDF bila daftar perlu dibagikan untuk koordinasi operasional.' },
        ],
        tips: [
          { kind: 'info', text: 'Sumber Rencana Tindakan dan In Progress tetap dipisahkan. Data In Progress tidak digunakan untuk mengisi daftar rencana tindakan.' },
        ],
      },
      {
        title: 'Jika data TrakCare tidak tersedia',
        steps: [
          { text: 'Periksa indikator sumber data pada header halaman: Cache terakhir berarti aplikasi menampilkan data lokal yang terakhir berhasil diambil.' },
          { text: 'Jangan menghapus cache browser ketika koneksi sedang bermasalah karena cache diperlukan untuk kesinambungan operasional.' },
          { text: 'Periksa koneksi jaringan RS dan pengaturan Integrasi TrakCare jika data live tidak kembali.' },
          { text: 'Setelah koneksi pulih, klik Refresh dan pastikan tanggal rencana serta status pasien sudah sesuai.' },
        ],
      },
    ],
  },
  {
    id: 'pending',
    label: 'Pending Operan',
    icon: <Clock className="w-4 h-4" />,
    description: 'Manajemen tugas yang belum terselesaikan dan perlu dilanjutkan shift berikutnya.',
    sections: [
      {
        title: 'Menambah Pending Baru',
        steps: [
          { text: 'Klik tombol + Tambah Pending.' },
          { text: 'Isi nama pasien atau nomor RM, jenis tugas, prioritas (Normal / Mendesak), dan keterangan.' },
          { text: 'Klik Simpan — pending muncul di daftar dengan status Menunggu.' },
        ],
      },
      {
        title: 'Mengelola Status Pending',
        steps: [
          { text: 'Status Menunggu → Diproses: klik tombol Proses saat tugas sedang dikerjakan.' },
          { text: 'Status Diproses → Selesai: klik Selesai setelah tugas tuntas.' },
          { text: 'Pending yang sudah Selesai secara otomatis tersimpan ke riwayat.' },
        ],
        tips: [
          { kind: 'warning', text: 'Pending dengan prioritas Mendesak ditampilkan di urutan paling atas — tangani terlebih dahulu.' },
        ],
      },
      {
        title: 'Filter dan Pencarian',
        steps: [
          { text: 'Gunakan filter Status untuk melihat hanya yang Menunggu, Diproses, atau Selesai.' },
          { text: 'Cari berdasarkan nama pasien atau keterangan tugas via kotak pencarian.' },
        ],
      },
    ],
  },
  {
    id: 'checklist',
    label: 'Checklist Pasien',
    icon: <CheckCircle2 className="w-4 h-4" />,
    description: 'Daftar pemeriksaan pasien aktif, reminder hari ini, checklist terlambat, checklist yang dibuat otomatis dari rencana tindakan, dan history penyelesaian.',
    sections: [
      {
        title: 'Membaca ringkasan Checklist',
        steps: [
          { text: 'Total Checklist Aktif menunjukkan seluruh checklist pasien yang masih berjalan.' },
          { text: 'Belum Selesai menunjukkan checklist yang belum dipindahkan ke history.' },
          { text: 'Reminder Hari Ini menunjukkan pasien yang memiliki item pemeriksaan dengan batas hari ini.' },
          { text: 'Checklist Terlambat menunjukkan item yang melewati batas waktu.' },
          { text: 'Selesai Hari Ini menunjukkan checklist yang sudah diselesaikan pada hari berjalan.' },
        ],
      },
      {
        title: 'Menampilkan pasien Reminder Hari Ini',
        steps: [
          { text: 'Buka menu Checklist Pasien.' },
          { text: 'Klik kartu Reminder Hari Ini di bagian ringkasan.' },
          { text: 'Aplikasi berpindah ke daftar aktif dan otomatis menerapkan filter reminder hari ini.' },
          { text: 'Klik pasien yang dimaksud untuk membuka detail checklist.' },
          { text: 'Setelah data pemeriksaan lengkap, klik Simpan Checklist.' },
        ],
        tips: [
          { kind: 'info', text: 'Filter reminder dipertahankan ketika dibuka dari popup atau Pusat Notifikasi, sehingga pengguna langsung melihat pasien yang perlu ditindaklanjuti.' },
        ],
      },
      {
        title: 'Mengisi dan menyelesaikan Checklist',
        steps: [
          { text: 'Klik kartu pasien pada daftar aktif untuk membuka dialog detail.' },
          { text: 'Isi setiap item sesuai tipe field: teks, angka, tanggal, waktu, ya/tidak, dropdown, checkbox, atau catatan.' },
          { text: 'Periksa indikator progress untuk memastikan item penting tidak terlewat.' },
          { text: 'Gunakan kolom catatan untuk informasi tambahan yang relevan dengan proses admission.' },
          { text: 'Klik Simpan Checklist. Jika seluruh item wajib selesai, checklist dipindahkan otomatis ke History Checklist.' },
        ],
        tips: [
          { kind: 'warning', text: 'Jangan menandai item selesai tanpa melakukan pemeriksaan yang diminta. Checklist adalah catatan proses kerja dan dapat digunakan untuk audit internal.' },
        ],
      },
      {
        title: 'Checklist dari Operating Theatre dan Billing',
        steps: [
          { text: 'Badge Otomatis dari Rencana Tindakan berarti checklist dibuat berdasarkan rencana tindakan Operating Theatre yang cocok dengan pasien aktif.' },
          { text: 'Periksa tanggal tindakan yang ditampilkan pada dialog detail checklist.' },
          { text: 'Badge Cek Billing Tindakan Hari Ini berarti item billing perlu diverifikasi pada hari ini.' },
          { text: 'Badge Billing Tindakan Terlambat berarti batas verifikasi billing telah lewat dan perlu segera ditindaklanjuti.' },
          { text: 'Superuser dapat menggunakan Arsip Manual bila checklist perlu diarsipkan melalui kewenangan khusus.' },
        ],
      },
      {
        title: 'History Checklist',
        steps: [
          { text: 'Buka tab History pada halaman Checklist Pasien.' },
          { text: 'Cari berdasarkan nama pasien, No. RM, episode, atau user penyelesai.' },
          { text: 'Periksa tanggal selesai, user yang menyelesaikan, dan lama penyelesaian.' },
          { text: 'Gunakan Export Excel untuk menyimpan rekap history yang sedang ditampilkan.' },
        ],
      },
    ],
  },
  {
    id: 'notifications',
    label: 'Pusat Notifikasi',
    icon: <Bell className="w-4 h-4" />,
    badge: '5 terbaru',
    badgeVariant: 'secondary',
    description: 'Pusat pemberitahuan untuk KTM baru, perubahan Operating Theatre, Preadmission masuk hari ini, reminder Checklist, dan kebutuhan pengecekan Billing.',
    sections: [
      {
        title: 'Membuka Pusat Notifikasi',
        steps: [
          { text: 'Klik ikon lonceng di header aplikasi.' },
          { text: 'Badge angka pada lonceng menunjukkan jumlah notifikasi yang belum dibaca.' },
          { text: 'Panel menampilkan maksimal lima notifikasi terbaru, diurutkan dari yang paling baru.' },
          { text: 'Riwayat yang lebih lama tetap disimpan hingga 100 notifikasi dan tidak hilang hanya karena panel menampilkan lima item.' },
          { text: 'Klik satu notifikasi untuk menandainya sebagai dibaca dan membuka halaman tujuan yang sesuai.' },
        ],
      },
      {
        title: 'Jenis notifikasi dan tindakan lanjut',
        steps: [
          { text: 'KTM baru mengarahkan pengguna ke Monitoring KTM.' },
          { text: 'Operating Theatre mengarahkan pengguna ke Rencana Tindakan untuk melihat pasien baru atau perubahan status.' },
          { text: 'Preadmission masuk hari ini mengarahkan pengguna ke halaman Masuk Hari Ini dengan filter H-1.' },
          { text: 'Checklist mengarahkan pengguna ke Checklist Pasien dengan filter Reminder Hari Ini.' },
          { text: 'Billing mengarahkan pengguna ke pasien yang membutuhkan pengecekan item billing tindakan.' },
        ],
      },
      {
        title: 'Popup dan suara notifikasi',
        steps: [
          { text: 'Popup prioritas tetap terlihat sampai pengguna melakukan tindakan, menutup, atau menggesernya.' },
          { text: 'Suara notifikasi berhenti ketika popup diklik, termasuk ketika pengguna menekan tombol aksi di dalam popup.' },
          { text: 'Tombol Hentikan semua suara pada Pusat Notifikasi menghentikan suara aktif secara manual.' },
          { text: 'Pengaturan popup dan suara dapat diubah melalui Pengaturan → Notifikasi.' },
          { text: 'Suara hanya diputar untuk event baru yang lolos deduplikasi, sehingga polling berulang tidak membuat suara berulang untuk data yang sama.' },
        ],
        tips: [
          { kind: 'warning', text: 'Jika popup dan suara tidak diinginkan sementara, nonaktifkan keduanya pada Pengaturan → Notifikasi. Jangan menghapus data browser hanya untuk membersihkan notifikasi.' },
        ],
      },
      {
        title: 'Tandai dan hapus riwayat',
        steps: [
          { text: 'Klik Tandai semua dibaca untuk mengubah seluruh notifikasi tersimpan menjadi sudah dibaca.' },
          { text: 'Klik Hapus riwayat hanya jika memang diperlukan karena tindakan ini menghapus riwayat notifikasi lokal.' },
          { text: 'Penghapusan riwayat tidak menghapus data pasien, checklist, atau data Operating Theatre.' },
        ],
      },
    ],
  },
  {
    id: 'history',
    label: 'Riwayat Pasien',
    icon: <History className="w-4 h-4" />,
    description: 'Arsip seluruh pasien yang sudah pulang dan riwayat operan shift yang sudah selesai.',
    sections: [
      {
        title: 'Mencari Riwayat',
        steps: [
          { text: 'Ketik nama pasien atau nomor RM di kotak pencarian.' },
          { text: 'Filter berdasarkan rentang tanggal masuk atau tanggal pulang.' },
          { text: 'Filter berdasarkan ruangan, dokter, atau jaminan.' },
        ],
      },
      {
        title: 'Melihat Detail Riwayat',
        steps: [
          { text: 'Klik baris pasien untuk membuka detail lengkap — diagnosa, dokter, kelas, tindakan, dan catatan.' },
          { text: 'Tab Riwayat Operan menampilkan semua handover shift yang pernah dicatat untuk pasien tersebut.' },
        ],
        tips: [
          { kind: 'info', text: 'Data riwayat tersimpan lokal di perangkat — tidak akan hilang meski offline selama tidak ada reset database.' },
        ],
      },
    ],
  },
  {
    id: 'sync-history',
    label: 'Riwayat Sinkronisasi',
    icon: <RefreshCw className="w-4 h-4" />,
    description: 'Log lengkap setiap sesi sinkronisasi dengan TrakCare — berapa data ditarik, berhasil atau gagal.',
    sections: [
      {
        title: 'Membaca Log Sinkronisasi',
        steps: [
          { text: 'Setiap baris mewakili satu sesi sync — menampilkan waktu, jumlah data ditarik, dan status.' },
          { text: 'Status Berhasil (hijau): data berhasil diambil dari TrakCare.' },
          { text: 'Status Gagal (merah): koneksi bermasalah atau TrakCare tidak merespons.' },
          { text: 'Klik baris untuk melihat detail data apa saja yang disinkronkan.' },
        ],
        tips: [
          { kind: 'tip', text: 'Jika sering muncul status Gagal, periksa koneksi jaringan RS atau konfirmasi ke IT apakah endpoint TrakCare aktif.' },
        ],
      },
    ],
  },
  {
    id: 'reports',
    label: 'Laporan',
    icon: <FileBarChart className="w-4 h-4" />,
    description: 'Generate laporan PDF operan dan pending berdasarkan rentang tanggal yang dipilih.',
    sections: [
      {
        title: 'Membuat Laporan PDF',
        steps: [
          { text: 'Pilih jenis laporan: Operan Harian, Rekap Pending, atau Laporan Gabungan.' },
          { text: 'Tentukan rentang tanggal (Dari — Sampai).' },
          { text: 'Pilih filter tambahan jika diperlukan (ruangan, shift, status).' },
          { text: 'Klik Buat Laporan — pratinjau PDF akan muncul di layar.' },
          { text: 'Klik Unduh PDF untuk menyimpan file ke perangkat.' },
        ],
        tips: [
          { kind: 'tip', text: 'Laporan dapat dicetak langsung dari browser dengan Ctrl+P setelah pratinjau muncul.' },
          { kind: 'info', text: 'Laporan dihasilkan sepenuhnya dari data lokal — tidak membutuhkan koneksi internet.' },
        ],
      },
    ],
  },
  {
    id: 'kasir',
    label: 'Pesan Kasir',
    icon: <Receipt className="w-4 h-4" />,
    description: 'Generate pesan terformat untuk koordinasi dengan kasir via WhatsApp atau media lain.',
    sections: [
      {
        title: 'Membuat Pesan Kasir',
        steps: [
          { text: 'Pilih pasien dari daftar atau cari berdasarkan nama / nomor RM.' },
          { text: 'Sistem otomatis mengisi data pasien: nama, ruangan, kelas, jaminan, dokter.' },
          { text: 'Tambahkan catatan khusus jika diperlukan (misal: permintaan rincian biaya, cicilan, dll.).' },
          { text: 'Klik Salin Pesan — teks terformat langsung tersalin ke clipboard.' },
          { text: 'Tempelkan (paste) ke WhatsApp atau aplikasi pesan lainnya.' },
        ],
        tips: [
          { kind: 'tip', text: 'Format pesan sudah disesuaikan agar mudah dibaca kasir — pastikan data pasien sudah lengkap sebelum disalin.' },
        ],
      },
    ],
  },
  {
    id: 'master-tarif',
    label: 'Master Tarif',
    icon: <FileSpreadsheet className="w-4 h-4" />,
    description: 'Import dan kelola daftar tarif layanan RS dari file Excel untuk digunakan di fitur estimasi biaya.',
    sections: [
      {
        title: 'Mengakses Master Tarif',
        steps: [
          { text: 'Buka menu Pengaturan di sidebar.' },
          { text: 'Pilih tab Master Tarif.' },
        ],
      },
      {
        title: 'Import Tarif dari Excel',
        steps: [
          { text: 'Siapkan file Excel (.xlsx) dengan format: kolom Kode, Nama Layanan, Tarif, Kelas, Kategori.' },
          { text: 'Klik tombol Import Excel dan pilih file dari perangkat.' },
          { text: 'Pratinjau data akan muncul — periksa apakah kolom sudah terpetakan dengan benar.' },
          { text: 'Klik Simpan untuk menyimpan semua tarif ke database lokal.' },
        ],
        tips: [
          { kind: 'warning', text: 'Import baru akan menimpa data tarif yang sudah ada. Pastikan file Excel sudah final sebelum diimport.' },
          { kind: 'tip', text: 'Gunakan file Excel dari sistem billing RS sebagai sumber utama agar data tarif selalu akurat.' },
        ],
      },
      {
        title: 'Mengaktifkan / Menonaktifkan Tarif',
        steps: [
          { text: 'Cari tarif menggunakan kotak pencarian.' },
          { text: 'Klik toggle Aktif/Nonaktif pada kolom status untuk mengubah ketersediaan tarif.' },
          { text: 'Tarif nonaktif tidak akan muncul di pilihan estimasi biaya.' },
        ],
      },
      {
        title: 'Menghapus Semua Tarif',
        steps: [
          { text: 'Klik tombol Hapus Semua di bagian bawah halaman.' },
          { text: 'Konfirmasi penghapusan — seluruh data tarif akan dihapus dari database lokal.' },
        ],
        tips: [
          { kind: 'warning', text: 'Hapus Semua tidak dapat diurungkan. Lakukan backup terlebih dahulu jika ragu.' },
        ],
      },
    ],
  },
  {
    id: 'import',
    label: 'Import Data',
    icon: <Upload className="w-4 h-4" />,
    description: 'Import data pasien dan catatan operasional dari file Excel ke dalam database lokal aplikasi.',
    sections: [
      {
        title: 'Import Data dari Excel',
        steps: [
          { text: 'Buka menu Pengaturan → tab Import Data.' },
          { text: 'Pilih jenis data yang akan diimport: Pasien, Pending, atau Operan.' },
          { text: 'Klik Pilih File Excel dan pilih file dari perangkat (.xlsx).' },
          { text: 'Pratinjau data akan muncul — verifikasi jumlah baris dan kolom.' },
          { text: 'Klik Import untuk memasukkan data ke database lokal.' },
        ],
        tips: [
          { kind: 'info', text: 'Gunakan template Excel yang sesuai agar kolom terpetakan dengan benar. Template dapat diunduh dari halaman Import.' },
          { kind: 'warning', text: 'Data duplikat (berdasarkan No. RM dan tanggal masuk) akan dilewati secara otomatis.' },
        ],
      },
    ],
  },
  {
    id: 'settings',
    label: 'Pengaturan',
    icon: <Settings className="w-4 h-4" />,
    description: 'Konfigurasi aplikasi, manajemen pengguna, backup & restore, dan pengaturan sinkronisasi.',
    sections: [
      {
        title: 'Profil & Informasi RS',
        steps: [
          { text: 'Buka tab Profil untuk mengubah nama RS, logo, dan informasi institusi.' },
          { text: 'Upload logo RS dalam format PNG/JPG — akan ditampilkan di halaman login, about, dan footer.' },
          { text: 'Klik Simpan setelah selesai mengubah.' },
        ],
      },
      {
        title: 'Sesi & Keamanan',
        steps: [
          { text: 'Atur durasi sesi login otomatis (berapa menit aplikasi akan logout otomatis saat tidak aktif).' },
          { text: 'Aktifkan atau nonaktifkan konfirmasi logout.' },
          { text: 'Klik Simpan Pengaturan Sesi.' },
        ],
      },
      {
        title: 'Sinkronisasi TrakCare',
        steps: [
          { text: 'Masukkan URL endpoint TrakCare yang diberikan oleh tim IT RS.' },
          { text: 'Atur interval sinkronisasi otomatis (dalam menit).' },
          { text: 'Klik Simpan — sinkronisasi akan berjalan sesuai jadwal.' },
        ],
        tips: [
          { kind: 'info', text: 'Pengaturan sinkronisasi tersimpan lokal di perangkat. Setiap komputer perlu dikonfigurasi sendiri.' },
        ],
      },
      {
        title: 'Backup Data',
        steps: [
          { text: 'Buka tab Backup & Restore.' },
          { text: 'Klik Export Database — file Excel (.xlsx) akan diunduh berisi seluruh data operasional.' },
          { text: 'Simpan file backup di lokasi aman (drive eksternal, cloud storage, dll.).' },
        ],
        tips: [
          { kind: 'tip', text: 'Lakukan backup minimal seminggu sekali, atau sebelum melakukan import / restore data besar.' },
          { kind: 'info', text: 'File backup tidak menyertakan Master Tarif agar ukuran file tetap kecil.' },
        ],
      },
      {
        title: 'Restore Data',
        steps: [
          { text: 'Buka tab Backup & Restore → klik Import / Restore.' },
          { text: 'Pilih file backup (.xlsx) yang sebelumnya diekspor dari aplikasi ini.' },
          { text: 'Konfirmasi — data saat ini akan ditimpa oleh data dari file backup.' },
        ],
        tips: [
          { kind: 'warning', text: 'Restore akan menimpa SEMUA data saat ini (kecuali Master Tarif). Pastikan Anda yakin sebelum melanjutkan.' },
        ],
      },
      {
        title: 'Manajemen User (Superuser)',
        steps: [
          { text: 'Buka tab Master User — hanya tersedia untuk akun Superuser.' },
          { text: 'Klik + Tambah User, isi username, nama lengkap, password, dan pilih role (Officer / Superuser).' },
          { text: 'Gunakan Ubah Nama untuk memperbarui nama tampilan user tanpa mengubah username.' },
          { text: 'Gunakan Nonaktifkan/Aktifkan untuk menghentikan atau mengembalikan akses user tanpa menghapus data akunnya.' },
          { text: 'Untuk menghapus user, klik Hapus lalu baca dialog konfirmasi dengan teliti.' },
          { text: 'Masukkan password akun Superuser yang sedang digunakan untuk mengonfirmasi penghapusan, lalu klik Ya, Hapus User.' },
          { text: 'Setelah berhasil, user dihapus dari perangkat lokal, disinkronkan ke cloud, dan aktivitasnya dicatat pada Log Aktivitas.' },
        ],
        tips: [
          { kind: 'warning', text: 'Superuser tidak dapat menghapus dirinya sendiri. Superuser terakhir juga tidak dapat dihapus karena sistem harus selalu memiliki administrator.' },
          { kind: 'info', text: 'Password konfirmasi hanya diverifikasi untuk proses penghapusan dan tidak disimpan atau ditulis ke audit log.' },
        ],
      },
      {
        title: 'Download Aplikasi (Superuser)',
        steps: [
          { text: 'Buka tab Download Aplikasi — hanya tersedia untuk akun Superuser.' },
          { text: 'Unduh file HTML mandiri untuk digunakan secara offline di komputer lain.' },
          { text: 'Unduh juga file .bat untuk menjalankan dengan sinkronisasi TrakCare aktif (Windows only).' },
        ],
      },
    ],
  },
  {
    id: 'offline',
    label: 'Penggunaan Offline',
    icon: <WifiOff className="w-4 h-4" />,
    description: 'Cara menggunakan aplikasi secara penuh tanpa koneksi internet menggunakan file HTML mandiri.',
    sections: [
      {
        title: 'Menjalankan Aplikasi Offline',
        steps: [
          { text: 'Unduh file ipaw.html dari menu Pengaturan → Download Aplikasi (Superuser).' },
          { text: 'Simpan file di folder yang mudah diakses, misalnya D:\\IPAW\\.' },
          { text: 'Untuk penggunaan biasa: klik dua kali file HTML → akan terbuka di Chrome.' },
          { text: 'Untuk sinkronisasi TrakCare: klik dua kali file buka-ipaw-offline.bat (Windows only).' },
        ],
        tips: [
          { kind: 'info', text: 'Semua data tersimpan di IndexedDB browser — data tetap ada meski browser ditutup dan dibuka kembali selama menggunakan browser yang sama.' },
          { kind: 'warning', text: 'Jangan hapus cache/data browser atau data aplikasi akan hilang. Selalu lakukan backup rutin.' },
        ],
      },
      {
        title: 'Update Versi Offline',
        steps: [
          { text: 'Saat ada versi baru, Superuser mengunduh file HTML terbaru dari server.' },
          { text: 'Ganti file HTML lama dengan yang baru di folder yang sama.' },
          { text: 'File .bat tidak perlu diganti — tetap dapat digunakan.' },
          { text: 'Data lokal di browser tidak terpengaruh oleh update file HTML.' },
        ],
        tips: [
          { kind: 'tip', text: 'Versi aplikasi dapat dilihat di menu Tentang Aplikasi (About). Bandingkan dengan versi di server untuk mengetahui apakah ada update.' },
        ],
      },
      {
        title: 'Perbedaan Mode Online vs Offline',
        text: 'Mode Online (akses via browser ke server): mendapatkan sinkronisasi TrakCare otomatis, pembaruan real-time antar perangkat, dan tidak perlu update file manual. Mode Offline (file HTML lokal): berjalan tanpa internet, data tersimpan di perangkat masing-masing, sinkronisasi TrakCare memerlukan file .bat dan koneksi jaringan RS.',
      },
    ],
  },
];

/* ─────────────────────────────────────────────
   Sub-components
───────────────────────────────────────────── */
function TipBox({ kind, text }: TipBlock) {
  const styles = {
    tip: {
      wrapper: 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300',
      icon: <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5" />,
      label: 'Tips',
    },
    warning: {
      wrapper: 'bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300',
      icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />,
      label: 'Perhatian',
    },
    info: {
      wrapper: 'bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300',
      icon: <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />,
      label: 'Info',
    },
  }[kind];

  return (
    <div className={`flex gap-2 rounded-md px-3 py-2 text-xs ${styles.wrapper}`}>
      {styles.icon}
      <div>
        <span className="font-semibold">{styles.label}: </span>
        {text}
      </div>
    </div>
  );
}

function SectionBlock({ section }: { section: Section }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
        <ChevronRight className="w-3.5 h-3.5 text-primary" />
        {section.title}
      </h3>
      {section.text && (
        <p className="text-sm text-muted-foreground leading-relaxed pl-5">{section.text}</p>
      )}
      {section.steps && (
        <ol className="pl-5 space-y-1.5">
          {section.steps.map((step, i) => (
            <li key={i} className="text-sm text-muted-foreground">
              <span className="inline-flex items-start gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="leading-relaxed">
                  {step.text}
                  {step.sub && (
                    <ul className="mt-1 ml-2 space-y-0.5 list-disc list-inside text-xs text-muted-foreground/80">
                      {step.sub.map((s, j) => <li key={j}>{s}</li>)}
                    </ul>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {section.tips && (
        <div className="pl-5 space-y-1.5">
          {section.tips.map((tip, i) => <TipBox key={i} {...tip} />)}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main Page
───────────────────────────────────────────── */
export default function PanduanPage() {
  const [activeId, setActiveId] = useState(MODULES[0].id);
  const active = MODULES.find(m => m.id === activeId)!;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Sidebar nav ── */}
      <nav className="w-56 shrink-0 border-r bg-muted/30 overflow-y-auto p-2 space-y-0.5">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-2">
          Modul
        </p>
        {MODULES.map(mod => (
          <button
            key={mod.id}
            onClick={() => setActiveId(mod.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-left transition-colors
              ${activeId === mod.id
                ? 'bg-primary text-primary-foreground font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <span className="shrink-0">{mod.icon}</span>
            <span className="truncate">{mod.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Content ── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6 space-y-5">

          {/* Header */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-primary">{active.icon}</span>
              <h1 className="text-xl font-bold">{active.label}</h1>
              {active.badge && (
                <Badge variant={active.badgeVariant ?? 'secondary'}>{active.badge}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{active.description}</p>
          </div>

          <hr className="border-border" />

          {/* Sections */}
          <div className="space-y-6">
            {active.sections.map((sec, i) => (
              <SectionBlock key={i} section={sec} />
            ))}
          </div>

          {/* Footer note */}
          <div className="pt-4 flex items-center gap-2 text-xs text-muted-foreground/60">
            <BookOpen className="w-3.5 h-3.5" />
            <span>IP Admission Workspace — Panduan Penggunaan</span>
          </div>
        </div>
      </main>
    </div>
  );
}
