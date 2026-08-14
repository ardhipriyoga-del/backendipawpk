---
name: Billing WhatsApp QR
description: Billing messages use a locally generated QR that opens a prefilled WhatsApp chat to the patient's family number.
---

The billing QR is intended for RS staff to scan with the staff phone. It encodes a `wa.me` link addressed to the guardian/family number and includes the generated billing message; WhatsApp still requires the staff member to review and press Send.

**Why:** The hospital internal network may block WhatsApp Web, while QR generation can remain local/offline and the staff phone can use its own mobile or Wi-Fi connection.

**How to apply:** Require a guardian number and positive billing amount, generate the QR locally in the browser, and make clear that offline IPAW can create the QR but cannot deliver WhatsApp messages without internet on the scanning phone.