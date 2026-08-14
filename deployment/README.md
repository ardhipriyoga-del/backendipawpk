# IPAW v3 Deployment

Dokumentasi ini menjelaskan setup deployment IPAW v3 dengan pemisahan:

- **Frontend**: Google Apps Script Web App
- **Backend**: Netlify Functions
- **TrakCare**: diakses hanya dari backend

## Struktur folder

```text
deployment/
├── README.md
├── ipaw-gas/
    ├── Code.gs
    └── ipawv3.html
└── ipaw-backend/
    ├── netlify.toml
    ├── package.json
    └── netlify/
        └── functions/
            └── api.js
```

## Setup Google Apps Script

### 1) Buat project GAS

1. Buka Google Apps Script.
2. Buat project baru.
3. Tambahkan file:
   - `Code.gs`
   - `ipawv3.html`

### 2) Isi `Code.gs`

Gunakan file `deployment/ipaw-gas/Code.gs` yang sudah disediakan. Isinya hanya
menampilkan HTML frontend:

```javascript
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('ipawv3').setTitle('IPAW');
}
```

### 3) Copy HTML aplikasi

Gunakan file `deployment/ipaw-gas/ipawv3.html` yang sudah dibuat dari bundle
produksi IPAW terbaru, lalu:

- simpan sebagai `ipawv3.html`
- pastikan nilai `IPAW_BACKEND_URL` di dalam bundle menunjuk ke URL site Netlify
- jangan menambahkan token atau password TrakCare ke HTML

```javascript
const IPAW_BACKEND_URL = 'https://DOMAIN-NETLIFY-SAYA.netlify.app';
```

### 4) Deploy GAS

1. Klik **Deploy** → **New deployment**
2. Pilih **Web app**
3. Set:
   - **Execute as**: Me
   - **Who has access**: sesuai kebutuhan
4. Deploy dan salin URL web app

## Setup Netlify Backend

### 1) Buat project Netlify

Gunakan folder `deployment/ipaw-backend/` sebagai root publish Netlify.

### 2) File backend

- `netlify.toml` mengatur fungsi Netlify dan redirect `/api/*`
- `package.json` disediakan minimal tanpa dependency runtime
- `netlify/functions/api.js` berisi semua handler API

### 3) Environment Variables

Wajib:

- `TRAKCARE_BASE_URL`

Opsional:

- `TRAKCARE_TOKEN`
- `TRAKCARE_ALLOWED_ORIGINS`
- `NETLIFY_ALLOWED_ORIGIN`
- `IPAW_API_KEY` — hanya untuk klien yang dapat mengirim header rahasia;
  jangan diaktifkan untuk bundle GAS tanpa menambahkan mekanisme autentikasi
  yang aman.

### 4) Deploy Netlify

1. Hubungkan repo ke Netlify
2. Atur base directory ke `deployment/ipaw-backend`
3. Publish
4. Set environment variables pada site settings

## Environment Variables

### `TRAKCARE_BASE_URL`

Base URL TrakCare. Wajib diisi.

Contoh:

```text
https://apps.emc.id/trakcare
```

### `TRAKCARE_TOKEN`

Token server-side untuk dipasang sebagai `Authorization: Bearer ...` saat backend mem-forward request.

### `TRAKCARE_ALLOWED_ORIGINS`

Comma-separated origins tambahan yang boleh diakses backend.

Contoh:

```text
https://apps.emc.id,https://another-trakcare.example
```

### `NETLIFY_ALLOWED_ORIGIN`

Origin CORS yang diizinkan. Jika kosong, default CORS adalah `*`.

Contoh:

```text
https://script.google.com
```

## Endpoint API

### Health check

```http
GET /api/health
```

Contoh response:

```json
{
  "success": true,
  "status": 200,
  "data": {
    "service": "IPAW Backend",
    "status": "online"
  }
}
```

Health check sengaja tetap dapat dipanggil walaupun `TRAKCARE_BASE_URL` belum
diisi, sehingga URL backend dapat diuji sebelum konfigurasi TrakCare selesai.

### Proxy TrakCare umum

```http
POST /api/trakcare
```

Body:

```json
{
  "endpoint": "/some/path",
  "method": "GET",
  "payload": null,
  "headers": {
    "Accept": "application/json"
  }
}
```

### Operating Theatre

```http
POST /api/trakcare/operating-theatre
```

Body:

```json
{
  "endpoint": "https://apps.emc.id/trakcare/operatingtheatre/otrequest/dashboard/trakcareANLT/hospital/4",
  "username": "user",
  "password": "secret",
  "clientId": "browser-client-id",
  "forceLogin": false,
  "view": "dashboard"
}
```

## Contoh curl

### Health check

```bash
curl -i https://YOUR-NETLIFY-SITE.netlify.app/api/health
```

### TrakCare proxy

```bash
curl -i https://YOUR-NETLIFY-SITE.netlify.app/api/trakcare \
  -H 'Content-Type: application/json' \
  -d '{
    "endpoint": "/patient",
    "method": "GET",
    "payload": null
  }'
```

### Operating Theatre

```bash
curl -i https://YOUR-NETLIFY-SITE.netlify.app/api/trakcare/operating-theatre \
  -H 'Content-Type: application/json' \
  -d '{
    "endpoint": "https://apps.emc.id/trakcare/operatingtheatre/otrequest/dashboard/trakcareANLT/hospital/4",
    "username": "USERNAME",
    "password": "PASSWORD",
    "clientId": "test-client",
    "forceLogin": true,
    "view": "dashboard"
  }'
```

## CORS troubleshooting

Jika request dari GAS/browser gagal karena CORS:

1. Pastikan backend Netlify aktif.
2. Jika ingin semua origin diizinkan, kosongkan `NETLIFY_ALLOWED_ORIGIN`.
3. Jika ingin membatasi origin, isi `NETLIFY_ALLOWED_ORIGIN` dengan origin frontend yang tepat.
4. Pastikan frontend mengirim request ke URL Netlify, bukan langsung ke TrakCare.

## Troubleshooting koneksi TrakCare

Jika backend mengembalikan error:

- pastikan `TRAKCARE_BASE_URL` terisi
- pastikan endpoint TrakCare benar
- pastikan origin tujuan ada di `TRAKCARE_ALLOWED_ORIGINS` bila dibatasi
- pastikan token jika dibutuhkan tersedia di `TRAKCARE_TOKEN`
- cek apakah request timeout karena jaringan internal RS

## Cara generate / copy HTML GAS

1. Build frontend IPAW.
2. Jalankan generator offline:

   ```bash
   pnpm --filter @workspace/emc-admission run build
   node scripts/build-offline.mjs
   ```

3. Salin `artifacts/emc-admission/public/ipawv3.html` ke project GAS sebagai
   `ipawv3.html`.
4. Isi URL Netlify pada konstanta `IPAW_BACKEND_URL` sebelum deploy.
5. Semua jalur TrakCare pada mode GAS sudah menggunakan helper `ipawApi()`;
   tidak perlu memindahkan logic UI, IndexedDB, parser, atau event handler.

```javascript
const result = await ipawApi('/api/trakcare', {
  method: 'POST',
  body: {
    endpoint: '/trakcare/dashboard/...',
    method: 'GET'
  }
});
```

Bundle GAS tidak menjalankan fallback direct-fetch TrakCare. Fallback direct
fetch tetap dipertahankan hanya untuk distribusi `file://` lama/launcher offline
agar fitur offline yang sudah ada tidak hilang.

## Catatan migrasi

- Kredensial TrakCare tidak boleh ada di HTML frontend.
- Token TrakCare tetap di server Netlify.
- Session login Operating Theatre disimpan sementara di memori server-side per `clientId`.
- Backend mengembalikan envelope konsisten:
  - sukses: `{success:true,status,data}`
  - error: `{success:false,status,error,details?}`
- `ipawApi()` menangani GET, POST, PUT, PATCH, DELETE, timeout, HTTP error,
  dan response backend yang bukan JSON.
