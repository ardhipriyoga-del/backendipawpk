---
name: Notification deduplication across resets
description: Notification fingerprints must survive IndexedDB reset and Cloud restore so existing source data is not announced again.
---

Notification “baru” must be claimed through a browser-local fingerprint ledger that is separate from application IndexedDB stores. Seed that ledger from legacy notification history before the first monitoring poll, and gate history, popup, and sound on the same claim. Source snapshots should suppress repeat polling events, except IGD-SPRI intentionally surfaces the current SPRI list once on the first poll after login. Never include live timer/color/location fields, row indexes, refresh timestamps, or batch counts in event identity.

**Why:** Reset and restore replace local application stores and can clear in-memory snapshots, causing unchanged KTM, operating-theatre, checklist, or billing records to look newly added. TrakCare refreshes can also change display timers, row order, or temporarily return empty/partial data without changing the underlying event.

**How to apply:** When adding a notification source, create a stable event fingerprint from the source category and durable record identity (include the action date when the same episode can start a new cycle). Establish a source baseline after the first poll unless the product explicitly requires existing actionable records to alert immediately, as with IGD-SPRI. Preserve the last known snapshot through empty/partial source responses. Derive checklist/batch alerts from newly added stable item keys, not the full current list or item count. Do not store raw patient identifiers in the ledger. Keep notification history in the full local database backup so it reaches Cloud, and reseed the browser ledger after restore.