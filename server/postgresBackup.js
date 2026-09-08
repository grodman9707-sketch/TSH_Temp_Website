// Optional Railway Postgres backup of the live JSON store.
// The site still reads/writes db.json. When DATABASE_URL is set, each save
// also stores a restore-ready snapshot (including login secrets) in Postgres.

const SNAPSHOT_KEEP = 30;

let pool = null;
let last = { ok: false, at: "", id: null, error: "" };

export function postgresConfigured() {
  return Boolean(String(process.env.DATABASE_URL || "").trim());
}

export function postgresStatus() {
  return { configured: postgresConfigured(), ...last };
}

function sslFor(url) {
  const u = String(url || "");
  if (/sslmode=disable/i.test(u)) return false;
  if (/\.railway\.internal/i.test(u) && !/sslmode=require/i.test(u)) return false;
  return { rejectUnauthorized: false };
}

async function loadPg() {
  const mod = await import("pg");
  return mod.default || mod;
}

async function getPool() {
  if (!postgresConfigured()) return null;
  if (!pool) {
    const pg = await loadPg();
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslFor(process.env.DATABASE_URL),
      max: 2,
    });
  }
  return pool;
}

export async function ensurePostgresSchema() {
  const client = await getPool();
  if (!client) throw new Error("DATABASE_URL is not set. Add PostgreSQL on Railway and set DATABASE_URL on the web service.");
  await client.query(`
    CREATE TABLE IF NOT EXISTS league_snapshots (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL DEFAULT 'auto',
      users_count INTEGER NOT NULL DEFAULT 0,
      fixtures_count INTEGER NOT NULL DEFAULT 0,
      payload JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS league_snapshots_created_at_idx ON league_snapshots (created_at DESC);
  `);
}

export function snapshotPayload(db) {
  return JSON.parse(
    JSON.stringify({
      league: db.league,
      content: db.content,
      regionals: db.regionals || [],
      leagues: db.leagues || [],
      users: db.users || [],
      applications: db.applications || [],
      leagueRequests: db.leagueRequests || [],
      announcements: db.announcements || [],
      fixtures: db.fixtures || [],
      adminProfiles: db.adminProfiles || [],
      approvals: db.approvals || [],
      bounty: db.bounty || null,
    })
  );
}

export async function savePostgresSnapshot(db, { source = "auto" } = {}) {
  try {
    await ensurePostgresSchema();
    const client = await getPool();
    const payload = snapshotPayload(db);
    const inserted = await client.query(
      `INSERT INTO league_snapshots (source, users_count, fixtures_count, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, created_at, source, users_count, fixtures_count`,
      [source, (db.users || []).length, (db.fixtures || []).length, JSON.stringify(payload)]
    );
    await client.query(
      `DELETE FROM league_snapshots
       WHERE id NOT IN (
         SELECT id FROM league_snapshots ORDER BY created_at DESC, id DESC LIMIT $1
       )`,
      [SNAPSHOT_KEEP]
    );
    const row = inserted.rows[0];
    last = { ok: true, at: new Date().toISOString(), id: Number(row.id), error: "" };
    return {
      id: Number(row.id),
      createdAt: row.created_at,
      source: row.source,
      usersCount: Number(row.users_count),
      fixturesCount: Number(row.fixtures_count),
    };
  } catch (err) {
    last = { ok: false, at: new Date().toISOString(), id: last.id || null, error: String(err.message || err) };
    throw err;
  }
}

export async function listPostgresSnapshots(limit = 12) {
  if (!postgresConfigured()) return [];
  await ensurePostgresSchema();
  const client = await getPool();
  const result = await client.query(
    `SELECT id, created_at, source, users_count, fixtures_count
     FROM league_snapshots
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    createdAt: row.created_at,
    source: row.source,
    usersCount: Number(row.users_count),
    fixturesCount: Number(row.fixtures_count),
  }));
}

export async function loadPostgresSnapshot(id) {
  await ensurePostgresSchema();
  const client = await getPool();
  const result = await client.query(`SELECT id, created_at, source, payload FROM league_snapshots WHERE id = $1`, [Number(id)]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    createdAt: row.created_at,
    source: row.source,
    payload: row.payload,
  };
}

export async function closePostgres() {
  if (!pool) return;
  const ending = pool;
  pool = null;
  await ending.end();
}
