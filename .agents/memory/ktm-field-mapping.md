---
name: KTM field mapping
description: Stable mapping rules for the TrakCare KTM monitoring feed.
---

KTM data should be mapped by the source table headers, not only by column positions:

- Date → tanggalKTM
- Time → jamKTM
- Name → namaPasien
- Current Episode → episodeNo
- Primary Doctor → dpjp
- Ward Class Room → ruangan

**Why:** TrakCare layouts can change column order, and positional parsing caused the offline bundle to show the wrong patient, episode, doctor, room, and KTM timestamp fields.

**How to apply:** Keep the header-aware parser in both the browser/direct-fetch path and the API proxy path; retain the old positional parser only as a compatibility fallback when the expected headers are absent.