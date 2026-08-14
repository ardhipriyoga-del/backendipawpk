import { Router, type IRouter, type Request, type Response } from "express";
import { requireSession, type SessionUser } from "../lib/session";
import { mutateGas, restoreGasDatabase } from "../lib/gas";

const router: IRouter = Router();

const STORE_KEY_FIELDS: Record<string, string> = {
  users: "id",
  patients: "noRM",
  episodes: "id",
  pendings: "id",
  justInfos: "id",
  operanShifts: "id",
  importLogs: "id",
  activityLogs: "id",
  settings: "key",
  masterTarifs: "id",
  masterTarifItems: "id",
  estimasiBiaya: "id",
  syncLogs: "id",
  billingRules: "id",
  billingChecks: "id",
  notifikasiBilling: "id",
  kasirTemplates: "id",
  uraianKonfirmasi: "noRM",
  uraianKonfirmasiEpisodes: "recordKey",
  masterTemplateTindakan: "id",
  estimasiTindakan: "id",
  masterEstimasiTindakan: "id",
  masterEstimasiTarif: "id",
  masterEstimasiKategori: "id",
  masterEstimasiMappings: "id",
  masterEstimasiMeta: "key",
  operatingTheatreCache: "key",
  operatingTheatreCompletedCache: "key",
  operatingTheatrePreadmissionCache: "key",
  operatingTheatreInProgressCache: "key",
  checklistMasters: "id",
  checklistEpisodes: "episodeNo",
  checklistHistory: "id",
  patchRegistry: "id",
  patchData: "key",
  patchBackups: "id",
  patchActivityLogs: "id",
};

const MAX_SYNC_CHANGES = 200;

function requestUser(res: Response): SessionUser {
  return res.locals.authUser as SessionUser;
}

function candidateUrl(query: Record<string, unknown>): string | undefined {
  return typeof query.url === "string" ? query.url : undefined;
}

function validateStore(store: unknown): { name: string; keyField: string } {
  const name = typeof store === "string" ? store.trim() : "";
  const keyField = STORE_KEY_FIELDS[name];
  if (!keyField) throw new Error("Object store tidak diizinkan.");
  if (name === "users") throw new Error("Master User memiliki alur perubahan khusus.");
  return { name, keyField };
}

function recordWithMetadata(
  data: unknown,
  keyField: string,
  id: unknown,
  user: SessionUser,
  deleted = false,
): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Data record harus berupa object.");
  }
  const record = { ...(data as Record<string, unknown>) };
  const key = String(id ?? record[keyField] ?? "").trim();
  if (!key || key.length > 500) throw new Error("Record ID tidak valid.");
  record[keyField] = id ?? record[keyField];
  record.updatedAt = Date.now();
  record.updatedBy = user.username;
  record.version = Number.isFinite(Number(record.version))
    ? Number(record.version) + 1
    : 1;
  record.deleted = deleted;
  return record;
}

async function writeRecord(
  req: Request,
  res: Response,
  operation: "create" | "update" | "delete",
): Promise<void> {
  const user = requestUser(res);
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const { name, keyField } = validateStore(body.store);
  const candidate = candidateUrl(req.query as Record<string, unknown>);
  const id = body.id;

  if (operation === "delete") {
    const record = recordWithMetadata(body.data || { [keyField]: id }, keyField, id, user, true);
    const result = await mutateGas("upsertRecord", {
      store: name,
      keyField,
      record,
    }, candidate);
    res.json({
      success: true,
      action: "delete",
      store: name,
      record,
      cloud: result,
    });
    return;
  }

  const record = recordWithMetadata(body.data, keyField, id, user);
  const result = await mutateGas("upsertRecord", {
    store: name,
    keyField,
    record,
  }, candidate);
  res.json({
    success: true,
    action: operation,
    store: name,
    record,
    cloud: result,
  });
}

router.get("/data/restore", requireSession, async (req, res) => {
  try {
    const result = await restoreGasDatabase(candidateUrl(req.query as Record<string, unknown>));
    res.json({ success: true, data: result.database, metadata: result.metadata });
  } catch (error) {
    req.log.error({ err: error }, "Authenticated GAS restore failed");
    res.status(502).json({
      success: false,
      message: error instanceof Error ? error.message : "Restore Cloud gagal.",
    });
  }
});

router.post("/data/create", requireSession, async (req, res) => {
  try {
    await writeRecord(req, res, "create");
  } catch (error) {
    req.log.error({ err: error }, "Authenticated GAS create failed");
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Create gagal." });
  }
});

router.put("/data/update", requireSession, async (req, res) => {
  try {
    await writeRecord(req, res, "update");
  } catch (error) {
    req.log.error({ err: error }, "Authenticated GAS update failed");
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Update gagal." });
  }
});

router.delete("/data/delete", requireSession, async (req, res) => {
  try {
    await writeRecord(req, res, "delete");
  } catch (error) {
    req.log.error({ err: error }, "Authenticated GAS delete failed");
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Delete gagal." });
  }
});

router.post("/sync", requireSession, async (req, res) => {
  const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
  if (changes.length > MAX_SYNC_CHANGES) {
    res.status(400).json({ success: false, message: `Maksimal ${MAX_SYNC_CHANGES} perubahan per sync.` });
    return;
  }

  const user = requestUser(res);
  const results: Array<Record<string, unknown>> = [];
  for (const change of changes) {
    try {
      const { name, keyField } = validateStore(change?.store);
      const record = recordWithMetadata(
        change?.payload,
        keyField,
        change?.recordId,
        user,
        change?.operation === "delete",
      );
      const cloud = await mutateGas("upsertRecord", {
        store: name,
        keyField,
        record,
      }, candidateUrl(req.query as Record<string, unknown>));
      results.push({ success: true, store: name, recordId: change?.recordId, cloud });
    } catch (error) {
      results.push({
        success: false,
        store: change?.store,
        recordId: change?.recordId,
        message: error instanceof Error ? error.message : "Perubahan gagal.",
      });
    }
  }
  res.json({
    success: results.every(result => result.success),
    results,
    user: { id: user.id, username: user.username },
  });
});

export default router;