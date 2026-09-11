// Pull-feed for Google Sheets (IMPORTDATA) and other clients.
// Same player / standings / fixture columns as the Airtable staff spreadsheet.
// Never includes passwords or reset codes.

import crypto from "crypto";
import { AIRTABLE_TABLES } from "./airtableSync.js";

const KEY_PREFIX = "tsh_";

export const SHEETS_TABLES = AIRTABLE_TABLES.map((spec) => ({
  id: String(spec.name).toLowerCase(),
  title: spec.name,
  key: spec.key,
  fields: spec.fields.map((f) => f.name),
  records: spec.records,
}));

export function generateSheetsApiKey() {
  return `${KEY_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
}

export function sheetsExportState(db) {
  const key = String(db?.sheetsExport?.key || "").trim();
  return {
    configured: Boolean(key),
    key,
    createdAt: db?.sheetsExport?.createdAt || "",
    createdById: db?.sheetsExport?.createdById ?? null,
  };
}

export function setSheetsApiKey(db, { key, userId } = {}) {
  const next = String(key || "").trim() || generateSheetsApiKey();
  db.sheetsExport = {
    key: next,
    createdAt: new Date().toISOString(),
    createdById: userId ?? null,
  };
  return sheetsExportState(db);
}

export function clearSheetsApiKey(db) {
  db.sheetsExport = { key: "", createdAt: "", createdById: null };
  return sheetsExportState(db);
}

export function keysEqual(a, b) {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  if (!x.length || x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export function sheetsApiKeyValid(db, provided) {
  const expected = String(db?.sheetsExport?.key || "").trim();
  const got = String(provided || "").trim();
  if (!expected || !got) return false;
  return keysEqual(expected, got);
}

export function sheetsApiKeyFrom(req, url) {
  const header = String(req?.headers?.authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const named = req?.headers?.["x-api-key"];
  if (named) return String(named).trim();
  return String(url?.searchParams?.get("key") || url?.searchParams?.get("apiKey") || "").trim();
}

export function resolveSheetsTable(name) {
  const id = String(name || "")
    .trim()
    .toLowerCase();
  return SHEETS_TABLES.find((t) => t.id === id) || null;
}

export function sheetsRows(db, tableName) {
  const spec = resolveSheetsTable(tableName);
  if (!spec) return null;
  return spec.records(db).map((r) => r.fields);
}

function csvCell(value) {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function toCsv(rows, headers) {
  const cols = Array.isArray(headers) && headers.length ? headers : rows[0] ? Object.keys(rows[0]) : [];
  const lines = [cols.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(cols.map((h) => csvCell(row?.[h])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function sheetsCsv(db, tableName) {
  const spec = resolveSheetsTable(tableName);
  if (!spec) return null;
  return toCsv(sheetsRows(db, tableName), spec.fields);
}

export function sheetsExportUrls(origin, key) {
  const base = String(origin || "").replace(/\/$/, "");
  const q = `key=${encodeURIComponent(key || "YOUR_KEY")}`;
  const out = {};
  for (const t of SHEETS_TABLES) {
    out[t.id] = {
      csv: `${base}/api/export/${t.id}.csv?${q}`,
      json: `${base}/api/export/${t.id}.json?${q}`,
    };
  }
  return out;
}

export function sheetsImportFormulas(origin, key) {
  const urls = sheetsExportUrls(origin, key);
  const out = {};
  for (const t of SHEETS_TABLES) {
    out[t.id] = `=IMPORTDATA("${urls[t.id].csv}")`;
  }
  return out;
}

// Official staff Google Sheet. Override with GOOGLE_SHEETS_SPREADSHEET_ID if needed.
export const DEFAULT_STAFF_SPREADSHEET_ID = "1Frq5HEWdD_Dld8bIOCq0_CqH7BaTY_ikgIHzqYMMmLY";

export function staffSpreadsheetId() {
  return String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || DEFAULT_STAFF_SPREADSHEET_ID).trim();
}

export function staffSpreadsheetUrl(id = staffSpreadsheetId()) {
  const sheetId = String(id || "").trim();
  return sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : "";
}

export function staffWorkbook(origin, key) {
  const id = staffSpreadsheetId();
  const formulas = sheetsImportFormulas(origin, key);
  return {
    id,
    url: staffSpreadsheetUrl(id),
    tabs: SHEETS_TABLES.map((t) => ({
      id: t.id,
      title: t.title,
      cell: "A1",
      formula: formulas[t.id] || "",
    })),
  };
}

export function sheetsKeyPayload(origin, state = {}) {
  const configured = Boolean(state.configured);
  const key = configured ? String(state.key || "").trim() : "";
  const formulaKey = key || "YOUR_KEY";
  return {
    ok: true,
    configured,
    key,
    createdAt: state.createdAt || "",
    urls: sheetsExportUrls(origin, formulaKey),
    formulas: sheetsImportFormulas(origin, formulaKey),
    workbook: staffWorkbook(origin, formulaKey),
  };
}

export const EXPORT_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-Api-Key, Content-Type",
  "Access-Control-Max-Age": "86400",
};
