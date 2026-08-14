---
name: Checklist reminder deadlines
description: Rule for interpreting date-based reminders in the inpatient checklist.
---

Reminder-enabled checklist dates represent deadlines, not incomplete fields.

**Why:** A date can be entered while the remaining required checklist work is still pending; hiding the reminder after entry prevents overdue and due-today work from being surfaced.

**How to apply:** Calculate overdue/today state from the stored date independently of whether that date field is filled. Use the overall required-field completion state separately for checklist completion.