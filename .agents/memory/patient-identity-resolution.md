---
name: Patient identity resolution
description: Cross-feature inpatient matching rules, aliases, and conflict handling.
---

The inpatient patient record is the source of truth for cross-feature identity. Normalize honorific aliases (`Tn.`, `Ny.`, `Nn.`, `An.`, `By.`) before comparison, but do not merge on a single field. A record must match at least two of name, RM, and episode; if any shared field conflicts, reject the match. Episode-scoped records must remain separate when the same RM has multiple active episodes.

**Why:** Names and identifiers arrive from TrakCare, Excel, cached snapshots, and manual records with inconsistent punctuation and honorifics. Single-field matching can silently mix episodes or patients.

**How to apply:** Use the shared identity resolver for joins and display names. Preserve legacy fields/stores for compatibility, but write new patient-linked records with an episode key whenever possible. Treat missing episode data as incomplete mapping rather than guessing from name alone.