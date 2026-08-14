# IP Admission Workspace

IP Admission Workspace is an Indonesian-language operational workspace for EMC hospital inpatient admission, handover, monitoring, billing, and local/cloud backup.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API proxy
- `pnpm --filter @workspace/emc-admission run dev` — run the web app
- `pnpm --filter @workspace/emc-admission run typecheck` — typecheck the frontend
- `pnpm --filter @workspace/emc-admission run build` — build the frontend
- `pnpm --filter @workspace/api-server run typecheck` — typecheck the API
- `pnpm --filter @workspace/api-server run build` — build the API
- `node scripts/build-offline.mjs` — inline the latest frontend build into `public/ipaw.html` and `public/ipawv2.html`

The app uses the configured `SESSION_SECRET` for server session support when needed. The legacy web app and `ipaw.html` use the configured Google Apps Script Spreadsheet as their online source of truth, with IndexedDB as cache/offline fallback. `ipawv2.html` intentionally reverses that policy: IndexedDB is the local workspace and Cloud is backup/recovery only.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React, Vite, Tailwind CSS, IndexedDB cache
- API: Express 5 proxy for cloud backup, KTM, and TrakCare requests
- Local exports: XLSX, PDF, and JSON backup support
- Offline delivery: one self-contained HTML file with inlined CSS/JavaScript

## Where things live

- `artifacts/emc-admission/src/App.tsx` — hash-based protected app routes
- `artifacts/emc-admission/src/pages/` — dashboard, patients, pending, history, cashier, KTM, IGD, billing, settings, and download pages
- `artifacts/emc-admission/src/lib/db.ts` — IndexedDB schema and domain types
- `artifacts/emc-admission/src/lib/cloudSync.ts` — cloud backup/restore and auto-backup
- `artifacts/emc-admission/src/lib/notificationSettings.ts` — persistent notification preferences and Web Audio playback
- `artifacts/emc-admission/src/components/EpisodeLink.tsx` — shared TrakCare episode link
- `artifacts/api-server/src/routes/` — cloud, KTM, and TrakCare proxy endpoints
- `artifacts/emc-admission/public/ipaw.html` — generated standalone offline distribution
- `artifacts/emc-admission/public/ipawv2.html` — generated LocalDB-first standalone distribution

## Architecture decisions

- V1 (`ipaw.html` and the regular web app) treats the Google Apps Script Spreadsheet as the online source of truth; IndexedDB is refreshed from Cloud and retained as a temporary cache/offline fallback.
- V2 (`ipawv2.html`) treats IndexedDB as the primary local database. Local changes remain usable without a network, enter the durable backup queue, and are sent to Cloud in the background when connectivity returns. A full Cloud restore is explicit/manual, while newer Pending records may be refreshed safely without overwriting local changes that are still queued.
- The browser uses hash navigation so the standalone `file://` distribution can navigate without a web server.
- Cloud data uses the existing Google Apps Script Spreadsheet endpoint. The Express API provides a safer proxy path where available, and row-level `readStore`/`upsertRecord`/`deleteRecord` operations are additive to the existing full snapshot `save`/`restore` contract.
- KTM rows match existing inpatient records by normalized patient name plus episode number; KTM does not create new patients.
- Episode numbers use one shared component that opens the TrakCare ANLT document in a new tab.
- Access control uses a centralized least-privilege matrix: officers receive operational admission access, while superusers retain configuration, bulk data, backup/restore, master-data, user-management, and audit administration access.

## Product

- Maintain inpatient patient records, pending items, handover shifts, activity logs, and cashier follow-up.
- Import and review inpatient, IGD, KTM, tariff, and billing data.
- Monitor KTM admissions with inpatient matching, room/doctor/class mapping, sorting, and new-row highlighting.
- Visualize IGD locations using contains-based ED Transit and numbered transit mappings.
- Configure persistent notification sounds, per-type patterns, volume, popups, and looping.
- Back up and restore local data as JSON/Excel, and synchronize the authoritative operational snapshot through the configured GAS Spreadsheet.
- Download and run `ipaw.html` completely offline; the Windows BAT launcher is optional for direct TrakCare access.
- Download and run `ipawv2.html` when the workstation LocalDB should be the primary workspace and Cloud should only receive backups. Use `buka-ipawv2-offline.bat` on Windows when the local bridge is needed.

## User preferences

- Preserve existing product features when modifying the imported IPAW/EMC Admission app.
- Keep the AI Assistant removed from the application.
- Keep user-facing copy in Indonesian unless the user asks otherwise.

## Gotchas

- Run the frontend build before `node scripts/build-offline.mjs`; the script reads hashed files from `dist/public`.
- The offline build generates both standalone files from the same production bundle. The `ipawv2.html` bootstrap injects LocalDB-first mode without changing the legacy `ipaw.html` policy.
- The offline HTML stores data in the browser that opens it; use Backup & Restore to move data between computers.
- Direct TrakCare access from a local HTML file depends on the user’s network and browser CORS policy. The BAT launcher uses an isolated Chrome profile with web security disabled and should only be used for this app.
- The API workflow must be running for proxied cloud/KTM/TrakCare routes in the Replit preview.
- After changing `gas/BackupCloudSpreadsheet.gs`, paste the file into the deployed Google Apps Script project and create/update the Web App deployment. The workspace code cannot update a GAS deployment automatically.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
