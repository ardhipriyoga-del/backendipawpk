---
name: Cloud backup payloads
description: Durable protocol and request-size rules for the Google Apps Script cloud backup.
---

Cloud backup sends the complete IndexedDB snapshot in one JSON request, including the Operating Theatre planned and Preadmission cache stores, so the API body parser must allow substantially more than Express's default limit. The upload and restore actions are distinct: `save` writes the database, while `restore` reads it.

**Why:** Restore can appear healthy while backup fails because restore has a small request and backup carries the entire local database. Using the read action for direct upload also makes offline backup fail even when the endpoint is reachable.

**How to apply:** Keep the API payload limit comfortably above expected patient/history data size, preserve clear 413 errors, require the Operating Theatre cache stores in the exported database, merge them during restore without allowing older/empty cloud snapshots to erase newer local rows, use staged `saveStart`/`saveChunk`/`saveCommit` uploads for large snapshots, normalize action names before comparing them in GAS, run upload work from a session-independent background queue while the tab remains open, use `restore` only for reads, and distinguish a reachable-but-empty cloud from an offline cloud in startup status messaging.