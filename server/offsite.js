import { airtableConfigured, airtableStatus, syncAirtable } from "./airtableSync.js";
import {
  listPostgresSnapshots,
  loadPostgresSnapshot,
  postgresConfigured,
  postgresStatus,
  savePostgresSnapshot,
} from "./postgresBackup.js";

const DELAY_MS = 2500;
let timer = null;
let pendingSource = "auto";

export function offsiteStatus() {
  return {
    postgres: postgresStatus(),
    airtable: airtableStatus(),
  };
}

export function offsiteConfigured() {
  return postgresConfigured() || airtableConfigured();
}

export async function runOffsiteSync(db, { source = "auto" } = {}) {
  const result = { postgres: null, airtable: null, errors: [] };
  if (postgresConfigured()) {
    try {
      result.postgres = await savePostgresSnapshot(db, { source });
    } catch (err) {
      result.errors.push(`Postgres: ${err.message || err}`);
      console.error("Postgres backup failed:", err);
    }
  }
  if (airtableConfigured()) {
    try {
      result.airtable = await syncAirtable(db);
    } catch (err) {
      result.errors.push(`Airtable: ${err.message || err}`);
      console.error("Airtable sync failed:", err);
    }
  }
  if (!postgresConfigured() && !airtableConfigured()) {
    result.errors.push("Neither DATABASE_URL nor Airtable is configured.");
  }
  return result;
}

export function scheduleOffsiteSync(getDb, { source = "auto" } = {}) {
  if (!offsiteConfigured()) return;
  pendingSource = source;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    let db;
    try {
      db = getDb();
    } catch (err) {
      console.error("Offsite sync skipped; could not read db:", err);
      return;
    }
    runOffsiteSync(db, { source: pendingSource }).catch((err) => console.error("Offsite sync failed:", err));
  }, DELAY_MS);
  timer.unref?.();
}

export async function backupOverview() {
  const status = offsiteStatus();
  let snapshots = [];
  if (postgresConfigured()) {
    try {
      snapshots = await listPostgresSnapshots();
    } catch (err) {
      status.postgres = { ...status.postgres, ok: false, error: String(err.message || err) };
    }
  }
  return { ...status, snapshots };
}

export { loadPostgresSnapshot, postgresConfigured, airtableConfigured };
