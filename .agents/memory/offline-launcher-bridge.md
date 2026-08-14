---
name: Offline launcher bridge
description: Windows offline distribution behavior for desktop-style launch and cloud backup.
---

The standalone launcher opens the bundled HTML in Chrome or Edge `--app` mode and starts a localhost PowerShell bridge. The bridge must handle Cloud Backup/Restore/Status plus every live TrakCare route used by the app (inpatient/discharge, IGD, IGD Ward, KTM, and Operating Theatre) so offline behavior follows the online API contract while traffic uses the workstation's hospital-network connection rather than a cloud-hosted proxy. Cloud and TrakCare requests should honor FortiGate/Windows proxy settings and TLS 1.2.

**Why:** A `file://` browser page cannot reliably use the same-origin API, and a cloud proxy may be unable to reach or be permitted by the RS network even though the workstation can reach Google Apps Script.

**How to apply:** Keep the offline bundle's API base pointed at `http://127.0.0.1:8765`, preserve `save` for backup and `restore` for restore, allow large JSON request bodies, and retain direct browser TrakCare fallback for older launchers/internal-network access. The PowerShell bridge should prefer `IPAW_HTTPS_PROXY`, then standard proxy environment variables, then the Windows system proxy with default credentials; retry TrakCare directly when a proxy refuses internal hosts; never disable TLS certificate validation or embed proxy passwords in launcher files. In a quoted `set "APP_URL=..."` batch assignment, keep the query-string `&` literal; escaping it as `^&` can leak `^` into the browser URL.

The row-level Cloud contract also requires localhost forwarding for `GET /api/cloud/store` (`readStore`) and `POST /api/cloud/record` (`upsertRecord`/`deleteRecord`); legacy bridge copies without these routes are only partially compatible with current `ipawv2.html`.

**Why:** The LocalDB-first app now uses row-level outbox and Pending refresh paths, and an active bridge causes those requests to target localhost instead of falling through to direct GAS.

**How to apply:** Keep the PowerShell bridge routes aligned with `artifacts/api-server/src/routes/cloud.ts` and the GAS actions, then regenerate both offline distribution copies together.

Large Cloud backups use `saveStart`, `saveChunk`, and `saveCommit`; those envelopes do not contain `database.users`. The bridge must forward these actions before applying the legacy full-payload Master User validation.

PowerShell Windows may expose `DefaultWebProxy` as a `WebProxyWrapper`, but `Invoke-WebRequest -Proxy` on the affected host expects a `System.Uri`; resolve the proxy with `GetProxy()` and pass only its URI, or omit `-Proxy` for direct/PAC routing.

If the launcher is opened twice, the second bridge must detect the existing `/health` service and exit cleanly instead of treating the `HttpListener` port conflict as a fatal application error.