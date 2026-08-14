import { getDB } from './db';
import * as XLSX from 'xlsx';
import { logActivity } from './auth';

export const importExcel = async (
  file: File, 
  userId: number, 
  userName: string,
  onProgress?: (progress: number) => void
) => {
  return new Promise<{ total: number, new: number, updated: number, archived: number, errors: string[] }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });

        // Remove header row
        jsonData.shift();

        const db = await getDB();
        let stats = { total: 0, new: 0, updated: 0, archived: 0, errors: [] as string[] };
        let currentWard = '';
        let currentRoom = '';
        let currentClass = '';
        
        let validRowsCount = 0;
        let processedCount = 0;

        const importedRM = new Set<string>();

        for (const row of jsonData) {
          const noRM = row[7]?.toString();
          if (!noRM || !noRM.match(/^\d/)) continue;
          validRowsCount++;
        }

        const tx = db.transaction(['patients', 'episodes', 'pendings'], 'readwrite');
        const storePatients = tx.objectStore('patients');
        const storeEpisodes = tx.objectStore('episodes');

        for (const row of jsonData) {
          try {
            const noRM = row[7]?.toString();
            // Skip invalid NO RM
            if (!noRM || !noRM.match(/^\d/)) {
              continue;
            }

            // Carry forward ward, room, class
            if (row[1]) currentWard = row[1];
            if (row[2]) currentRoom = row[2];
            if (row[3]) currentClass = row[3];

            const namaPasien = row[8] || '';
            const episodeNo = row[9]?.toString() || '';
            
            importedRM.add(noRM);

            const existingPatient = await storePatients.get(noRM);
            
            const newPatientData = {
              noRM,
              namaPasien,
              episodeNo,
              ward: currentWard,
              roomName: currentRoom,
              roomType: currentClass,
              bedCode: row[4] || '',
              dpjp: row[10] || '',
              dob: row[11] || '',
              agama: row[12] || '',
              sexDesc: row[13] || '',
              admissionDate: row[14] || '',
              dischargeDate: row[15] || null,
              medicalDischarge: row[16] || null,
              payor: row[17] || '',
              statusBPJS: row[18] || '',
              diagnosaMasuk: row[19] || '',
              diagnosakUtama: row[20] || '',
              diagnosaTambahan: row[21] || '',
              alertVIP: row[22] || '',
              status: 'aktif' as const,
              // Preserve internal fields if patient already exists
              sumberData: existingPatient?.sumberData ?? ('manual' as const),
              noHpPJ: existingPatient?.noHpPJ ?? '',
              bookmarked: existingPatient ? existingPatient.bookmarked : false,
              updatedAt: Date.now(),
              createdAt: existingPatient ? existingPatient.createdAt : Date.now()
            };

            if (!existingPatient) {
              await storePatients.put(newPatientData);
              await storeEpisodes.put({
                noRM,
                episodeNo,
                namaPasien,
                admissionDate: newPatientData.admissionDate,
                dischargeDate: null,
                status: 'aktif',
                archivedAt: 0
              });
              stats.new++;
            } else {
              if (existingPatient.episodeNo !== episodeNo) {
                // Archive old episode
                const allEps = await storeEpisodes.index('noRM').getAll(noRM);
                const oldEp = allEps.find(e => e.episodeNo === existingPatient.episodeNo);
                if (oldEp) {
                  oldEp.status = 'pulang';
                  oldEp.archivedAt = Date.now();
                  oldEp.dischargeDate = new Date().toISOString();
                  await storeEpisodes.put(oldEp);
                }
                
                await storePatients.put(newPatientData);
                await storeEpisodes.put({
                  noRM,
                  episodeNo,
                  namaPasien,
                  admissionDate: newPatientData.admissionDate,
                  dischargeDate: null,
                  status: 'aktif',
                  archivedAt: 0
                });
                stats.updated++;
              } else {
                await storePatients.put(newPatientData);
                stats.updated++;
              }
            }

            stats.total++;
            processedCount++;
            if (onProgress) onProgress(Math.floor((processedCount / validRowsCount) * 80));

          } catch (e: any) {
            stats.errors.push(`Error baris ${row[7]}: ${e.message}`);
          }
        }
        await tx.done;

        // Step 2: Handle discharged patients (in DB but not in importedRM)
        const allPatients = await db.getAll('patients');
        const pendingsTx = db.transaction('pendings', 'readonly');
        const pendingsIdx = pendingsTx.store.index('noRM');
        
        let dischargeCount = 0;
        
        for (const patient of allPatients) {
          if (patient.status === 'aktif' && !importedRM.has(patient.noRM)) {
            // Check pendings
            const pends = await pendingsIdx.getAll(patient.noRM);
            const activePends = pends.filter(p => p.status !== 'selesai' && p.episodeNo === patient.episodeNo);
            
            if (activePends.length === 0) {
              patient.status = 'pulang';
              patient.dischargeDate = new Date().toISOString();
              const updateTx = db.transaction(['patients', 'episodes'], 'readwrite');
              await updateTx.objectStore('patients').put(patient);
              
              const eps = await updateTx.objectStore('episodes').index('noRM').getAll(patient.noRM);
              const ep = eps.find(e => e.episodeNo === patient.episodeNo);
              if (ep) {
                ep.status = 'pulang';
                ep.dischargeDate = patient.dischargeDate;
                ep.archivedAt = Date.now();
                await updateTx.objectStore('episodes').put(ep);
              }
              await updateTx.done;
              stats.archived++;
              dischargeCount++;
            }
          }
        }

        if (onProgress) onProgress(100);

        await db.put('importLogs', {
          tanggal: new Date().toISOString(),
          userNama: userName,
          totalRows: stats.total,
          newPatients: stats.new,
          updatedPatients: stats.updated,
          archivedPatients: stats.archived,
          errors: stats.errors,
          createdAt: Date.now()
        });

        await logActivity(userId, userName, 'Import Excel', 'Patient', 'N/A', `Imported ${stats.total} patients, ${stats.new} new, ${stats.updated} updated, ${stats.archived} discharged`);

        resolve(stats);

      } catch (err: any) {
        reject(err);
      }
    };
    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(file);
  });
};
