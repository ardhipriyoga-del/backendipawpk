---
name: Procedure estimates
description: Durable data and pricing rules for Estimasi Biaya Tindakan.
---

Estimasi Biaya Tindakan in the current IPAW app uses the Pengaturan > Master Tarif and Master Tarif Item stores as its only pricing source. Patient and episode details are selected from the existing patient store. The dedicated masterEstimasi stores are reserved for a future project and are not part of this app's estimate flow.

**Why:** Master Tarif is the maintained operational tariff source in this app; keeping a second tariff master in the estimate flow creates ambiguity about which class and price staff should trust.

**How to apply:** Resolve estimate classes and item prices from the active Master Tarif in Pengaturan, while preserving the separate dedicated stores and backup coverage without reading them into the current estimate UI.

Legacy Master Tarif consumers should normalize class whitespace and compare parent/item IDs numerically rather than relying on IndexedDB key type equality.

**Why:** Cloud and backup restores can serialize numeric tariff IDs as strings, which otherwise makes a valid active tariff appear to have no classes or items.

**How to apply:** Apply the normalization at the read/filter boundary for both the legacy estimate panel and the newer action estimate form; keep the active-parent rule intact.