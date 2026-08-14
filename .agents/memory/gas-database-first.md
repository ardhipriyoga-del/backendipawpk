---
name: GAS database-first contract
description: The Google Apps Script Spreadsheet remains the authoritative IPAW database while IndexedDB provides cache and offline fallback.
---

The GAS Spreadsheet is the source of truth when the browser is online. IndexedDB must be treated as a temporary cache/offline fallback, not as the authoritative copy. The existing full snapshot `save`/`restore` contract remains for bootstrap, backup, and recovery; row-level `readStore`, `upsertRecord`, and `deleteRecord` operations are additive for database-first flows.

**Why:** The project owner explicitly chose to retain the GAS Spreadsheet rather than migrate operational data to Replit PostgreSQL, while still wanting database-first behavior.

**How to apply:** Any new online read should refresh from GAS before rendering authoritative data, and any online mutation should be written to GAS before refreshing the local cache. If the GAS deployment has not been updated with `gas/BackupCloudSpreadsheet.gs`, row-level actions return `Unknown action`; keep the IndexedDB fallback and communicate that the GAS Web App must be redeployed.