---
name: Checklist contact and audit history
description: Rules for guardian phone synchronization and completed checklist auditability.
---

The guardian phone number belongs to the inpatient patient record and the checklist answer is a synchronized view of that value. Completed checklist history must retain the answers and remain inspectable item by item, including the completion metadata and notes.

**Why:** Billing, patient, and checklist workflows use the same guardian contact, while a completed checklist is an operational audit record rather than only a completion count.

**How to apply:** Seed the checklist phone field from the current patient record, write edits back to that patient record when the checklist is saved, trigger the normal cloud backup path after checklist mutations, and keep history detail available even if current checklist masters later change.