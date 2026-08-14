---
name: Operating Theatre planned cache
description: Durable retention and live updates for Operating Theatre planned patients
---

Rencana Tindakan is a durable local and Cloud-backed snapshot containing only patients safely mapped to an active inpatient episode. A missing or empty source response must not delete a previously observed active patient; retained planned rows are removed on local-calendar H+1 after the operation date. When live data contains the same patient identity, the live row replaces the cached row, including a changed operation date. Patients not mapped to an active inpatient episode belong only in the separate Preadmission cache.

**Why:** TrakCare master rows can temporarily disappear or return partial data, while operation dates may be rescheduled and need to update without losing an active patient. Mixing preadmission rows into the planned cache makes the two workflows inaccurate.

**How to apply:** Merge by the shared two-field identity resolver, preserve Episode/IPK when TrakCare sends it in a combined RM header, treat live rows as authoritative for fields they provide, preserve retained rows when the response is empty/partial, prune both planned and Preadmission caches only at local-calendar H+1, and keep Restore Cloud from replacing a newer local planned snapshot with an older or empty remote snapshot.