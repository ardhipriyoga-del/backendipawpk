---
name: Cloud status proxy
description: Cloud status depends on the managed API Server proxy being available.
---

The frontend's Cloud status check uses the same-origin `/api/cloud/status` proxy. A stopped API Server makes the UI report Cloud offline with HTTP 502 even when the Google Apps Script deployment itself is reachable. After a new GAS deployment, validate `status`, `readStore`, and full `restore` from the same application environment; a transient 404 can clear after deployment propagation.

**Why:** The app routes cloud requests through the API Server for proxying and network compatibility.

**How to apply:** When Cloud suddenly shows offline, check and restart `artifacts/api-server: API Server` before changing the GAS URL or browser data.