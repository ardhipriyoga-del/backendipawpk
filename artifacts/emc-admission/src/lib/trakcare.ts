import { getDB, Patient, Episode } from './db';
import { fetchFromInpatientUrl, getEndpoints } from './trakcareClient';
import { shouldConfirmMissingInpatient } from './storageMode';
import { normalizeTrakCareBirthDate } from './trakcareDate';

// ── Sync result ───────────────────────────────────────────────────────────────

export interface SyncResult {
  newPatients: number;
  updatedPatients: number;
  dischargedPatients: number;
  pendingDischargePatients: number;
  errors: number;
  duration: number;
}

// ── Main sync function ────────────────────────────────────────────────────────

export async function syncTrakCare(): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    newPatients: 0,
    updatedPatients: 0,
    dischargedPatients: 0,
    pendingDischargePatients: 0,
    errors: 0,
    duration: 0,
  };

  // 1. Fetch parsed data — uses proxy (online) or direct fetch (offline file://)
  let rawPatients: any[] = [];
  try {
    const eps = await getEndpoints();
    rawPatients = await fetchFromInpatientUrl(eps.inpatient);
  } catch (err: any) {
    throw new Error(
      `Sinkronisasi gagal. Menggunakan data terakhir yang tersimpan. (${err.message})`
    );
  }

  const db = await getDB();
  const tcRMSet = new Set<string>();

  // ── Helper: upsert episode record ──────────────────────────────────────────
  // Cari episode berdasarkan noRM + episodeNo. Jika ada → update, jika tidak → buat baru.
  // Ini memastikan setiap pasien TrakCare selalu punya record di riwayat episode.
  const upsertEpisode = async (
    noRM: string,
    episodeNo: string,
    namaPasien: string,
    admissionDate: string,
    status: 'aktif' | 'pulang',
    dischargeDate: string | null,
  ) => {
    const eps = await db.getAllFromIndex('episodes', 'noRM', noRM);
    const existing = eps.find(e => e.episodeNo === episodeNo);
    if (existing && existing.id != null) {
      // Update episode yang sudah ada
      await db.put('episodes', {
        ...existing,
        namaPasien,
        admissionDate: admissionDate || existing.admissionDate,
        status,
        dischargeDate,
        // Episode yang masih aktif (termasuk menunggu konfirmasi pulang)
        // tidak boleh terlihat sebagai arsip di halaman Riwayat.
        archivedAt: status === 'pulang' ? Date.now() : 0,
      });
    } else {
      // Buat episode baru
      const newEp: Episode = {
        noRM,
        episodeNo,
        namaPasien,
        admissionDate,
        dischargeDate,
        status,
        archivedAt: status === 'pulang' ? Date.now() : 0,
      };
      await db.add('episodes', newEp);
    }
  };

  // 2. Upsert patients from TrakCare
  for (const raw of rawPatients) {
    const noRM: string = (raw.noRM ?? '').trim();
    if (!noRM) continue;

    try {
      tcRMSet.add(noRM);
      const existing = await db.get('patients', noRM);
      const now = Date.now();

      if (!existing) {
        // Pasien baru dari TrakCare — simpan ke patients + buat episode aktif
        const newPatient: Patient = {
          noRM,
          namaPasien: raw.namaPasien ?? '',
          episodeNo: raw.episodeNo ?? '',
          ward: raw.ward ?? '',
          roomName: raw.roomName ?? raw.ward ?? '',
          roomType: raw.roomType ?? '',
          bedCode: raw.bedCode ?? '',
          dpjp: raw.dpjp ?? '',
           dob: normalizeTrakCareBirthDate(raw.dob ?? ''),
          agama: '',
          sexDesc: raw.sexDesc ?? '',
          admissionDate: raw.admissionDate ?? '',
          dischargeDate: null,
          medicalDischarge: null,
          payor: raw.payor ?? '',
          statusBPJS: '',
          diagnosaMasuk: '',
          diagnosakUtama: '',
          diagnosaTambahan: '',
          alertVIP: '',
          status: 'aktif',
          sumberData: 'trakcare',
          bookmarked: false,
          createdAt: now,
          updatedAt: now,
        };
        await db.put('patients', newPatient);
        // Buat episode aktif agar muncul di riwayat saat nanti pulang
        await upsertEpisode(
          noRM,
          raw.episodeNo ?? '',
          raw.namaPasien ?? '',
          raw.admissionDate ?? '',
          'aktif',
          null,
        );
        result.newPatients++;
      } else {
        // Pasien lama — update field TrakCare, pertahankan field internal
        const updatedEpisodeNo = raw.episodeNo || existing.episodeNo;
        if (updatedEpisodeNo && updatedEpisodeNo !== existing.episodeNo) {
          // One RM can receive a new inpatient episode. Close the previous
          // episode instead of leaving it active beside the new episode.
          const previousEpisodes = await db.getAllFromIndex('episodes', 'noRM', noRM);
          const previousEpisode = previousEpisodes.find(
            episode => episode.episodeNo === existing.episodeNo,
          );
          if (previousEpisode?.id != null && previousEpisode.status === 'aktif') {
            const inferredDischargeDate = new Date().toISOString();
            await db.put('episodes', {
              ...previousEpisode,
              status: 'pulang',
              dischargeDate: previousEpisode.dischargeDate || inferredDischargeDate,
              archivedAt: Date.now(),
            });
          }
        }
        const updated: Patient = {
          ...existing,
          namaPasien: raw.namaPasien || existing.namaPasien,
          episodeNo: updatedEpisodeNo,
          ward: raw.ward || existing.ward,
          roomName: raw.roomName || existing.roomName,
          roomType: raw.roomType || existing.roomType,
          bedCode: raw.bedCode || existing.bedCode,
          dpjp: raw.dpjp || existing.dpjp,
          admissionDate: raw.admissionDate || existing.admissionDate,
          payor: raw.payor || existing.payor,
          sexDesc: raw.sexDesc || existing.sexDesc,
           dob: normalizeTrakCareBirthDate(raw.dob || existing.dob),
          sumberData: 'trakcare',
          status: 'aktif',
          dischargeDate: null,
          updatedAt: now,
        };
        await db.put('patients', updated);
        // Pastikan episode aktif sudah ada (upsert — tidak overwrite jika sudah ada)
        await upsertEpisode(
          noRM,
          updatedEpisodeNo,
          updated.namaPasien,
          updated.admissionDate,
          'aktif',
          null,
        );
        result.updatedPatients++;
      }
    } catch {
      result.errors++;
    }
  }

  // 3. Handle patients yang hilang dari TrakCare (sudah pulang)
  const allPatients = await db.getAll('patients');
  for (const patient of allPatients) {
    if (patient.sumberData !== 'trakcare') continue;
    if (patient.status === 'pulang') continue;          // sudah diproses sebelumnya
    if (patient.status === 'pulang_pending') {
      // Versi sebelumnya sempat menulis episode sebagai "pulang" ketika
      // pasien baru menunggu konfirmasi. Pulihkan episode ke aktif agar data
      // lama tidak bocor ke halaman Riwayat.
      try {
        await upsertEpisode(
          patient.noRM,
          patient.episodeNo,
          patient.namaPasien,
          patient.admissionDate,
          'aktif',
          null,
        );
      } catch {
        result.errors++;
      }
      continue;
    }
    if (tcRMSet.has(patient.noRM)) continue;             // masih aktif di TrakCare

    try {
      const allPendings = await db.getAllFromIndex('pendings', 'noRM', patient.noRM);
      const activePendings = allPendings.filter(
        p => p.status !== 'selesai' && p.episodeNo === patient.episodeNo
      );
      const dischargeDate = new Date().toISOString();

      if (shouldConfirmMissingInpatient()) {
        // Online and ipawv2 keep the patient visible until staff confirms that
        // the final guarantee has been issued. The episode remains active so
        // it cannot appear in History before that confirmation.
        await db.put('patients', {
          ...patient,
          status: 'pulang_pending',
          dischargeDate,
          updatedAt: Date.now(),
        });
        // Hilang dari sumber belum sama dengan sudah dikonfirmasi pulang.
        // Pertahankan episode aktif sampai petugas menekan "Pasien Pulang".
        await upsertEpisode(
          patient.noRM,
          patient.episodeNo,
          patient.namaPasien,
          patient.admissionDate,
          'aktif',
          null,
        );
        result.pendingDischargePatients++;
        continue;
      }

      if (activePendings.length > 0) {
        // Masih ada pending aktif — tandai pulang_pending agar tetap muncul di dashboard pending
        await db.put('patients', {
          ...patient,
          status: 'pulang_pending',
          dischargeDate,
          updatedAt: Date.now(),
        });
      } else {
        // Tidak ada pending — langsung pulang
        await db.put('patients', {
          ...patient,
          status: 'pulang',
          dischargeDate,
          updatedAt: Date.now(),
        });
      }

      // Hanya arsipkan episode pada alur legacy yang memang langsung pulang.
      // Alur konfirmasi sudah continue di atas dan tetap berstatus aktif.
      await upsertEpisode(
        patient.noRM,
        patient.episodeNo,
        patient.namaPasien,
        patient.admissionDate,
        'pulang',
        dischargeDate,
      );

      result.dischargedPatients++;
    } catch {
      result.errors++;
    }
  }

  result.duration = Date.now() - startTime;

  // 4. Save sync log
  const now = new Date();
  await db.put('syncLogs', {
    // Keep the machine-readable date key stable; formatDate is applied only
    // when the value is rendered.
    tanggal: now.toISOString().split('T')[0],
    jam: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    newPatients: result.newPatients,
    updatedPatients: result.updatedPatients,
    dischargedPatients: result.dischargedPatients,
    errors: result.errors,
    duration: result.duration,
    createdAt: Date.now(),
  } as any);

  // 5. Update last sync timestamp
  await db.put('settings', { key: 'lastSyncTime', value: Date.now() });

  return result;
}

// ── Utility helpers ───────────────────────────────────────────────────────────

export async function getLastSyncTime(): Promise<number | null> {
  try {
    const db = await getDB();
    const s = await db.get('settings', 'lastSyncTime');
    return s?.value ?? null;
  } catch {
    return null;
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} detik`;
}
