---
name: Offline Cloud fetch
description: Browser behavior when standalone ipaw.html accesses Google Apps Script from file://.
---

A standalone `file://` page may open a Google Apps Script URL successfully while JavaScript `fetch` to the same deployment fails because redirects, CORS, or hospital browser/proxy policy apply differently to navigation and API requests. When the local bridge is active, the standalone app should detect its health endpoint and route Cloud operations through `127.0.0.1:8765`; direct GAS remains only a fallback.

**Why:** Internal hospital networks can allow Google navigation but block cross-origin POST/JSON reads from a local file, which otherwise appears as a misleading Cloud OFFLINE state.

**How to apply:** Keep the standalone distribution bundle current, run `buka-ipaw-offline.bat` with the HTML and PowerShell bridge in the same folder, and treat direct `file://` GAS access as best-effort rather than the reliable hospital-network path.