---
name: Operating Theatre preadmission flow
description: Planned OT rows are split by active inpatient mapping into preadmission and completed-action history.
---

For Operating Theatre, a live planned row that does not safely match a patient record with status `aktif` is Preadmission. Historical `pulang` and `pulang_pending` records must never suppress Preadmission or receive its due-today warning. A row with an estimated admission date equal to today (operation date tomorrow) must raise a deduplicated attention notification, popup, and configurable sound. A row is recorded as completed action only when it safely matches a patient record with status `aktif`; a missing source row by itself is not enough. The planned screen should not retain active mapped rows.

**Why:** A planned OT date can represent an expected admission on the previous day, while an active inpatient indicates the procedure has moved out of the preadmission queue. A temporary source omission must not create a false completed record.

**How to apply:** Use the shared two-field patient identity resolver for the split. Keep Preadmission in its own durable local and Cloud-backed cache, merge successful live rows with retained rows, remove rows only on local-calendar H+1 after the operation date, and never classify In Progress rows through the planned source.