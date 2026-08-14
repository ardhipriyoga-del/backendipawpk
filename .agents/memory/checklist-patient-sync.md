---
name: Checklist patient synchronization
description: Durable rules for selecting inpatient patients for the checklist.
---

Checklist patient selection must normalize admission dates and require an explicit active inpatient status (`aktif`, `active`, or `current`), while including episodes admitted yesterday or earlier until their checklist is completed.

**Why:** TrakCare, Excel imports, and cloud restores can represent the same date or active status with different formats and casing. Treating an empty or unknown status as active causes discharged/stale patients to reappear. The checklist starts from H-1; older unfinished patients must not disappear, while same-day admissions should wait until the next day.

**How to apply:** Convert ISO, slash-delimited, named-month, timestamp, and Excel serial dates to a local calendar key. Include only explicit active statuses and dates on or before local yesterday, skip episodes already represented in history, reject stale saves after a patient is no longer active, and refresh when the page regains focus or patient data changes.