---
name: Cloud restore master data
description: Compatibility behavior for restoring users and tariff master data from older GAS snapshots.
---

Cloud restore validates that `users` is non-empty, but older snapshots can legitimately contain only the seeded `admin` account. Older tariff snapshots can contain `masterTarifItems` while omitting the `masterTarifs` parent records; restore must synthesize parent metadata from the item rows so the Master Tarif page can display the restored set.

**Why:** The detail rows alone are not visible in the Master Tarif UI because it lists parent records first, and changing the user merge policy could remove the only local login account.

**How to apply:** Treat the Cloud snapshot as authoritative for the users it contains, preserve the local seed admin only under the documented seed rule, and reconstruct missing tariff parents by `masterTarifId` from the first item’s hospital/type/effective-date fields.