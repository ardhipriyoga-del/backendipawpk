---
name: Master tariff activation
description: How tariff class selection behaves when imported master tariff parents are inactive or restored from legacy data.
---

The first imported Master Tarif should be active automatically so the estimate form can offer its tariff classes immediately. If a legacy workspace has tariff items but no active parent, the estimate form may temporarily use the latest parent with items and must explain that the user should activate the intended parent.

**Why:** Imported tariff parents historically defaulted to nonaktif, which left the class selector disabled even though tariff rows were present. Cloud and older snapshots can also preserve that state.

**How to apply:** Keep the active-parent filter when an active parent exists. Only use the latest populated parent as a recovery path when no active parent exists, and surface a link to Master Tarif so the operator can make the choice explicit.