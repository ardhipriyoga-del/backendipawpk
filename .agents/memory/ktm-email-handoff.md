---
name: KTM email handoff
description: The KTM workflow hands the prepared message to the workstation email app instead of sending mail from the server.
---

KTM email delivery is intentionally a local email-app handoff: the browser opens a prefilled draft with the insurance recipient, patient/card-number subject, and editable body; it does not send silently from the application.

**Why:** Staff must be able to review or adjust the request before sending, and the existing app is designed for offline/local operation without storing insurer credentials or adding a mail provider.

**How to apply:** Keep the patient insurance email and card number as local patient fields, validate them before enabling KTM email, and preserve the exact subject format `Nama Pasien // No Kartu // Konfirmasi Tindakan Medis`.