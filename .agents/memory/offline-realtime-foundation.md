---
name: Offline realtime foundation
description: Local-first standalone authentication and durable synchronization rules for the offline IPAW bundle.
---

The standalone `ipaw.html` must authenticate against the GAS Spreadsheet users store on every login attempt, including when opened from `file://`. IndexedDB is only a cache/fallback for non-standalone offline operation; a new standalone file with no Cloud connection must reject login rather than inventing local credentials. Cloud restore is optional for hydration and must never overwrite unsynced local work. Offline changes use a durable outbox and pending snapshot marker, then synchronize to GAS when connectivity returns.

**Why:** The spreadsheet is the authoritative account database, so a blank browser database cannot determine which credentials are valid. A file-opened bundle must still show the form immediately, but authentication requires the live Cloud database.

**How to apply:** Keep the login form usable in `file://` mode, call `readStore(users)` through the bridge or direct GAS on submit, cache successful users locally, reject standalone login when GAS is unreachable, and apply the same Cloud-first repository to every menu and selected entity. Merge Cloud records over local records by key, retain local-only records as fallback, exclude internal sync stores from full snapshots, flush row-level outbox entries before any restore, and reject snapshot restore while legacy local changes remain pending. Migrate operational modules to row-level mutations before claiming full realtime behavior.

For LocalDB-first `ipawv2.html`, a full Cloud restore remains manual, but the shared Pending store may be refreshed automatically using newer `updatedAt` records. Never replace a local Pending record protected by the outbox, and retain local-only records.

**Why:** Workstations need completed handovers from another computer without silently replacing unrelated local work or requiring a destructive full restore.

**How to apply:** Queue every Pending create/status mutation, wait for the logout backup, then run a guarded Pending-only pull on standalone startup/login; compare timestamps and preserve queued local keys.