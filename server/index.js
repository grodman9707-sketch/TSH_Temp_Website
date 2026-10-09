import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { getPdcTicker, warmPdcTicker } from "./pdcTicker.js";
import { roundRobinWeeks, addDays, pairingKey } from "./season.js";
import { fillMissingRosterByes } from "./rosterFixtures.js";
import { alignLaggingDivisionWeeks } from "./fixtureCalendar.js";
import { divisionReview } from "./divisionReview.js";
import { standingsForLeague } from "./standings.js";
import { injuredLeagueIds, isInjuredIn } from "./injury.js";
import { leagueHighlights } from "./leagueHighlights.js";
import { fixturePublishMeta, fixtureReleaseAt, isFixtureReleased, releasedFixtures } from "./fixtureRelease.js";
import { appendStaffLog, staffLogPayload } from "./staffLog.js";
import { runDueNotifications, sendEmail, emailConfigStatus, wantsMatchEmail, matchChatEmail } from "./notifications.js";
import {
  CHAT_MAX_MESSAGES,
  chatPhase,
  sweepMatchChats,
  cleanChatBody,
  canViewFixtureChat,
  canPostFixtureChat,
  messagesForFixture,
  unreadForUser,
  markChatRead,
  chatEmailDue,
  noteChatEmail,
} from "./fixtureChat.js";
import { wallStringToUtc, isValidTimeZone, defaultTimezoneForRegional } from "./timezones.js";
import { EXTRACT_STAT_FIELDS, hasNumericExtracted, overlayExtractedStats } from "../public/ocrParse.js";
import { airtableConfigured, backupOverview, loadPostgresSnapshot, postgresConfigured, runOffsiteSync, scheduleOffsiteSync } from "./offsite.js";
import {
  EXPORT_CORS,
  clearSheetsApiKey,
  resolveSheetsTable,
  setSheetsApiKey,
  sheetsApiKeyFrom,
  sheetsApiKeyValid,
  sheetsCsv,
  sheetsExportState,
  sheetsExportUrls,
  sheetsImportFormulas,
  sheetsKeyPayload,
  sheetsRows,
} from "./sheetsExport.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const seedDbPath = path.join(root, "data", "db.json");
const leagueRulesPath = path.join(root, "data", "leagueRules.json");
const leagueRules = JSON.parse(fs.readFileSync(leagueRulesPath, "utf8"));
const aboutPath = path.join(root, "data", "about.json");
const aboutContent = JSON.parse(fs.readFileSync(aboutPath, "utf8"));
const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME);
function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (!onRailway) return path.join(root, "data");
  try {
    fs.mkdirSync("/data", { recursive: true });
    fs.accessSync("/data", fs.constants.W_OK);
    return "/data";
  } catch {
    console.warn("Railway /data is not writable. Attach a Volume mounted at /data so signups survive deploys.");
    return path.join(root, "data");
  }
}
const dataDir = resolveDataDir();
const dbPath = path.join(dataDir, "db.json");
const sessionsPath = path.join(dataDir, "sessions.json");
const uploadsDir = path.join(dataDir, "uploads");
const publicDir = path.join(root, "public");
const MAX_OWNERS = 3;
const RESET_CODE_TTL_MS = 30 * 60 * 1000;
const FOUNDING_OWNER_EMAIL = "grodman9707@gmail.com";
const JASON_JACKSON_EMAIL = "jasonjackson@tshdartsleague.com";
const JASON_JACKSON_PASSWORD = "owner123";
const LEAGUE_CONTACT_EMAIL = "thesocialhubinformation@gmail.com";
const LEAGUE_SUPPORT_EMAIL = "Support@tshdartsleague.com";
const LEAGUE_MESSENGER_INVITES = [
  {
    id: "friendlies",
    label: "TSH Waiting List",
    shortLabel: "TSH Waiting List",
    href: "https://m.me/j/vlpYxGLbrtubBKI6/?send_source=gc%3Acopy_invite_link_c",
    blurb: "Open the TSH Waiting List.",
  },
  {
    id: "tsh",
    label: "TSH General Chat",
    shortLabel: "TSH General Chat",
    href: "https://m.me/j/0cIs92X7ME8Bhrbf/?send_source=gc%3Acopy_invite_link_c",
    blurb: "Open TSH General Chat.",
  },
];
function messengerInvitesNeedUpdate(list) {
  if (!Array.isArray(list) || list.length !== LEAGUE_MESSENGER_INVITES.length) return true;
  return LEAGUE_MESSENGER_INVITES.some((want, i) => {
    const have = list[i] || {};
    return (
      have.id !== want.id ||
      have.label !== want.label ||
      have.shortLabel !== want.shortLabel ||
      have.href !== want.href ||
      have.blurb !== want.blurb
    );
  });
}
const LEGACY_CONTACT_EMAIL = "worlddartsleagueinfo@gmail.com";
const MOCK_EMAILS = new Set([
  "admin@tshdarts.com",
  "alex@tshdarts.com",
  "morgan@tshdarts.com",
  "riley@tshdarts.com",
  "sam@tshdarts.com",
  "jordan@tshdarts.com",
  "casey@tshdarts.com",
  "taylor@tshdarts.com",
  "drew@tshdarts.com",
]);
const cookieSecure = onRailway || process.env.NODE_ENV === "production";

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function ensureStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.copyFileSync(seedDbPath, dbPath);
  }
}

function loadSessions() {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionsPath, "utf8"));
    return new Map(Object.entries(raw).map(([token, userId]) => [token, Number(userId)]));
  } catch {
    return new Map();
  }
}

function saveSessions() {
  writeJson(sessionsPath, Object.fromEntries(sessions));
}
function clearSessionsForUser(userId) {
  for (const [token, id] of sessions) {
    if (Number(id) === Number(userId)) sessions.delete(token);
  }
}
function htmlEsc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function newResetCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}
function codesEqual(a, b) {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  if (!x.length || x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
function findUserByEmail(db, email) {
  const key = normIdent(email);
  if (!key) return null;
  return (db.users || []).find((u) => normIdent(u.email) === key) || null;
}
function passwordResetEmail(user, code) {
  const name = htmlEsc(user.nickname || user.name || "there");
  return {
    to: user.email,
    subject: "Your TSH Darts League password reset code",
    html:
      `<p>Hi ${name},</p>` +
      `<p>Your TSH Darts League password reset code is:</p>` +
      `<p style="font-size:28px;letter-spacing:6px;font-weight:700">${htmlEsc(code)}</p>` +
      `<p>Enter this code on the Forgot Password page, then choose a new password. It expires in 30 minutes.</p>` +
      `<p>If you did not ask to reset your password, you can ignore this email — your current password still works.</p>` +
      `<p>— TSH Darts League</p>`,
    userId: user.id,
    type: "password_reset",
  };
}

function cookieSecureFor(req) {
  const proto = String(req?.headers?.["x-forwarded-proto"] || "");
  if (proto.includes("https")) return true;
  if (proto.includes("http")) return false;
  return cookieSecure;
}

function sessionCookie(token, { remember = false, clear = false, req } = {}) {
  const secure = cookieSecureFor(req) ? "; Secure" : "";
  if (clear) return `tsh_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  const persist = remember
    ? `; Max-Age=2592000; Expires=${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString()}`
    : "";
  return `tsh_token=${token}; Path=/; HttpOnly; SameSite=Lax${persist}${secure}`;
}

ensureStore();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function readDb() {
  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  if (!Array.isArray(db.approvals)) db.approvals = [];
  if (!Array.isArray(db.adminProfiles)) db.adminProfiles = [];
  if (!Array.isArray(db.leagueRequests)) db.leagueRequests = [];
  if (!Array.isArray(db.matchChats)) db.matchChats = [];
  if (!Array.isArray(db.matchChatReads)) db.matchChatReads = [];
  return db;
}
function writeDb(db) {
  sweepMatchChats(db);
  writeJson(dbPath, db);
  scheduleOffsiteSync(() => readDb());
}
function recordStaff(db, actor, action, extra = {}) {
  appendStaffLog(db, actor, { action, ...extra });
}
function publicUser(u, db) {
  const { password, avatarFile, passwordReset, ...rest } = u;
  const leagueIds = userLeagueIds(u);
  const adminIds = adminLeagueIds(u);
  const roles = userRoles(u);
  return {
    ...rest,
    role: primaryRole(u),
    roles,
    leagueId: leagueIds[0] || null,
    leagueIds,
    leagueTitles: db
      ? leagueIds.map((id) => leagueTitle(db, db.leagues.find((l) => l.id === id) || { name: "League", regionalId: 0 }))
      : [],
    adminLeagueId: adminIds[0] || null,
    adminLeagueIds: adminIds,
    adminLeagueTitles: db
      ? adminIds.map((id) => leagueTitle(db, db.leagues.find((l) => l.id === id) || { name: "Unassigned", regionalId: 0 }))
      : [],
    hasAvatar: Boolean(avatarFile),
    avatarUrl: avatarFile ? `/api/users/${u.id}/avatar?v=${encodeURIComponent(u.avatarUpdatedAt || "1")}` : "",
    notifyPrefs: { email: u.notifyPrefs?.email !== false },
    timezone: u.timezone || "",
    hasPendingApplication: db ? userHasPendingApplication(db, u.id) : false,
    fullyPlaced: db ? isFullyPlaced(db, u) : false,
    leagues: db ? userLeagueSummaries(db, u) : [],
    injuredLeagueIds: injuredLeagueIds(u),
    injuredLeagues: db ? userLeagueSummaries(db, u).filter((league) => isInjuredIn(u, league.id)) : [],
    openJoinRegional: db ? openJoinRegional(db, u) : null,
    openJoinRegionals: db ? openJoinRegionals(db, u) : [],
    pendingLeagueRequests: db ? pendingLeagueRequestsForUser(db, u.id) : [],
    communityJoinPending: Boolean(u.communityJoinPending),
  };
}
function nextId(list) {
  return Math.max(0, ...(Array.isArray(list) ? list : []).map((x) => Number(x.id) || 0)) + 1;
}
function normIdent(value) {
  return String(value || "").trim().toLowerCase();
}
function identityConflict(db, { email, username, dartcounterName } = {}, excludeUserId = null) {
  const emailKey = normIdent(email);
  const usernameKey = normIdent(username);
  const dcKey = normIdent(dartcounterName);
  for (const u of db.users || []) {
    if (excludeUserId != null && Number(u.id) === Number(excludeUserId)) continue;
    const uEmail = normIdent(u.email);
    const uUser = normIdent(u.username);
    const uDc = normIdent(u.dartcounterName);
    if (emailKey && uEmail === emailKey) return "That email is already registered. Sign in instead.";
    if (emailKey && uUser === emailKey) return "That email is already used as a username.";
    if (usernameKey && uUser === usernameKey) return "That username is already in use.";
    if (usernameKey && uEmail === usernameKey) return "That username matches an existing account email.";
    if (dcKey && uDc === dcKey) return "That DartCounter name is already registered. Each player may only have one TSH account.";
  }
  return null;
}
function userHasPendingApplication(db, userId) {
  return (db.applications || []).some((a) => Number(a.userId) === Number(userId) && a.status === "pending");
}
function publicApproval(a, db) {
  const target = db.users.find((u) => u.id === a.targetUserId);
  const requester = db.users.find((u) => u.id === a.requestedById);
  const league = a.leagueId ? db.leagues.find((l) => l.id === Number(a.leagueId)) : null;
  return {
    id: a.id,
    kind: a.kind,
    targetUserId: a.targetUserId,
    targetName: target ? target.name : "Unknown player",
    leagueId: a.leagueId || null,
    leagueTitle: league ? leagueTitle(db, league) : "",
    requestedById: a.requestedById,
    requestedByName: requester ? requester.name : "Unknown",
    createdAt: a.createdAt,
  };
}
function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  res.end(JSON.stringify(data));
}
function tokenFrom(req, url) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  const queryToken = url?.searchParams?.get("token");
  if (queryToken) return queryToken;
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)tsh_token=([a-f0-9]+)/i);
  return m ? m[1] : "";
}
function currentUser(req, db, url) {
  const id = sessions.get(tokenFrom(req, url));
  return db.users.find((u) => u.id === id) || null;
}
function userRoles(u) {
  const roles = Array.isArray(u?.roles) ? u.roles.map(String) : [];
  if (u?.role && u.role !== "player") roles.unshift(String(u.role));
  return [...new Set(roles.filter((r) => r && r !== "player"))];
}
function hasRole(u, role) {
  if (!u) return false;
  if (role === "player") return true;
  return userRoles(u).includes(role);
}
function primaryRole(u) {
  const roles = userRoles(u);
  if (roles.includes("owner")) return "owner";
  if (roles.includes("head_admin")) return "head_admin";
  if (roles.includes("admin")) return "admin";
  return "player";
}
function addRole(u, role) {
  if (!role || role === "player") {
    u.roles = userRoles(u);
    u.role = primaryRole(u);
    return;
  }
  u.roles = [...new Set([...userRoles(u), role])];
  u.role = primaryRole(u);
}
function removeRole(u, role) {
  const roles = userRoles(u).filter((r) => r !== role);
  u.roles = roles;
  u.role = roles.includes("owner")
    ? "owner"
    : roles.includes("head_admin")
      ? "head_admin"
      : roles.includes("admin")
        ? "admin"
        : "player";
}
function adminLeagueIds(u) {
  const ids = Array.isArray(u?.adminLeagueIds) ? u.adminLeagueIds.map(Number) : [];
  if (u?.adminLeagueId) ids.unshift(Number(u.adminLeagueId));
  return [...new Set(ids.filter(Boolean))];
}
function syncAdminLeagues(u) {
  const ids = [...new Set((Array.isArray(u.adminLeagueIds) ? u.adminLeagueIds : []).map(Number).filter(Boolean))];
  u.adminLeagueIds = ids;
  u.adminLeagueId = ids[0] || null;
  if (ids.length) addRole(u, "admin");
  else removeRole(u, "admin");
}
function isOwner(u) {
  return hasRole(u, "owner");
}
function isHeadAdmin(u) {
  return hasRole(u, "head_admin");
}
function isDivisionAdmin(u) {
  return hasRole(u, "admin") || adminLeagueIds(u).length > 0;
}
function canOverride(u) {
  return isOwner(u) || isHeadAdmin(u);
}
function isStaff(u) {
  return isOwner(u) || isHeadAdmin(u) || isDivisionAdmin(u);
}
function staffStatusLabel(status) {
  if (status === "owner") return "Owner";
  if (status === "deputy") return "Deputy Admin";
  return "Admin";
}
function staffProfileKey(p) {
  return `${Number(p.userId)}:${p.status}:${Number(p.leagueId) || 0}`;
}
function desiredStaffSlots(u) {
  const slots = [];
  if (isOwner(u)) slots.push({ status: "owner", leagueId: null });
  if (isHeadAdmin(u)) slots.push({ status: "deputy", leagueId: null });
  for (const leagueId of adminLeagueIds(u)) {
    slots.push({ status: "admin", leagueId });
  }
  return slots;
}
function ensureAdminProfiles(db) {
  if (!Array.isArray(db.adminProfiles)) db.adminProfiles = [];
  const wanted = new Set();
  const byKey = new Map(db.adminProfiles.map((p) => [staffProfileKey(p), p]));
  let changed = false;
  for (const u of db.users) {
    const slots = desiredStaffSlots(u);
    const existingForUser = db.adminProfiles.filter((p) => Number(p.userId) === Number(u.id));
    const template = {
      contactEmail: existingForUser.find((p) => p.contactEmail)?.contactEmail || u.email || "",
    };
    for (const slot of slots) {
      const key = `${Number(u.id)}:${slot.status}:${Number(slot.leagueId) || 0}`;
      wanted.add(key);
      if (!byKey.has(key)) {
        const profile = {
          id: nextId(db.adminProfiles),
          userId: u.id,
          status: slot.status,
          leagueId: slot.leagueId,
          contactEmail: template.contactEmail,
          createdAt: new Date().toISOString(),
        };
        db.adminProfiles.push(profile);
        byKey.set(key, profile);
        changed = true;
      }
    }
  }
  const kept = db.adminProfiles.filter((p) => wanted.has(staffProfileKey(p)));
  if (kept.length !== db.adminProfiles.length) {
    db.adminProfiles = kept;
    changed = true;
  }
  return changed;
}
function persistDb(db) {
  ensureAdminProfiles(db);
  writeDb(db);
}
function publicStaffProfile(p, db) {
  const u = db.users.find((x) => x.id === Number(p.userId));
  if (!u) return null;
  const league = p.leagueId ? db.leagues.find((l) => l.id === Number(p.leagueId)) : null;
  return {
    id: p.id,
    userId: u.id,
    name: u.name,
    nickname: u.nickname || "",
    hasAvatar: Boolean(u.avatarFile),
    avatarUrl: u.avatarFile ? `/api/users/${u.id}/avatar?v=${encodeURIComponent(u.avatarUpdatedAt || "1")}` : "",
    status: p.status,
    statusLabel: staffStatusLabel(p.status),
    leagueId: p.leagueId || null,
    leagueTitle: league ? leagueTitle(db, league) : "",
    contactEmail: p.contactEmail || "",
  };
}
function publicStaffProfiles(db) {
  const roleOrder = ["owner", "deputy", "admin"];
  const roleName = { owner: "Owner", deputy: "Deputy Admin", admin: "Admin" };
  const grouped = new Map();
  for (const row of (db.adminProfiles || []).map((p) => publicStaffProfile(p, db)).filter(Boolean)) {
    let card = grouped.get(row.userId);
    if (!card) {
      card = {
        id: row.id,
        userId: row.userId,
        name: row.name,
        nickname: row.nickname,
        hasAvatar: row.hasAvatar,
        avatarUrl: row.avatarUrl,
        roleKeys: [],
        leagues: [],
        contactEmail: row.contactEmail || "",
      };
      grouped.set(row.userId, card);
    }
    if (row.status && !card.roleKeys.includes(row.status)) card.roleKeys.push(row.status);
    if (row.leagueId && !card.leagues.some((l) => l.id === row.leagueId)) {
      card.leagues.push({ id: row.leagueId, title: row.leagueTitle });
    }
    if (row.contactEmail) card.contactEmail = row.contactEmail;
  }
  return [...grouped.values()]
    .map((card) => {
      const roleKeys = roleOrder.filter((key) => card.roleKeys.includes(key));
      const roles = roleKeys.map((key) => roleName[key]);
      const leagueTitles = card.leagues.map((l) => l.title).filter(Boolean);
      return {
        ...card,
        roleKeys,
        roles,
        roleLabel: roles.join(" · "),
        status: roleKeys[0] || "admin",
        statusLabel: roles.join(" · "),
        leagueId: card.leagues[0]?.id || null,
        leagueTitle: leagueTitles.join(" · "),
        leagueTitles,
      };
    })
    .sort((a, b) => {
      const so = roleOrder.indexOf(a.roleKeys[0] || "admin") - roleOrder.indexOf(b.roleKeys[0] || "admin");
      if (so) return so;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
}
function ownStaffProfiles(db, user) {
  return publicStaffProfiles(db).filter((p) => p.userId === user.id);
}
function normalizeStaffEmail(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (s.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
    const err = new Error("Enter a valid contact email");
    err.status = 400;
    throw err;
  }
  return s;
}
function managesLeague(u, leagueId) {
  if (!u) return false;
  if (isOwner(u) || isHeadAdmin(u)) return true;
  return isDivisionAdmin(u) && adminLeagueIds(u).includes(Number(leagueId));
}
function ownerCount(db) {
  return db.users.filter((u) => isOwner(u)).length;
}
function divisionAdminsForLeague(db, leagueId) {
  return db.users.filter((u) => adminLeagueIds(u).includes(Number(leagueId))).map((u) => publicUser(u, db));
}
function divisionName(league) {
  const raw = String(league?.name || "").trim();
  const m = raw.match(/^League\s+(\d+)$/i);
  return m ? `Division ${m[1]}` : raw;
}
const INTERNATIONAL_DIVISION_LADDER = ["Division 1", "Division 2", "Division 3", "Division 4", "Division 5", "Division 6"];
const INTERNATIONAL_REGIONAL_ID = 3;
const SIGNUP_REGIONALS_SOON_ERROR = "Regional leagues are coming soon. Sign up for the International League.";
function europeRegional(db) {
  return (db.regionals || []).find((r) => r.slug === "europe" || Number(r.id) === 1) || null;
}
function americasRegional(db) {
  return (db.regionals || []).find((r) => r.slug === "americas" || Number(r.id) === 2) || null;
}
function internationalRegional(db) {
  return (db.regionals || []).find((r) => r.slug === "international" || r.slug === "world") || null;
}
function isInternationalRegional(r) {
  return Boolean(r && (r.slug === "international" || r.slug === "world"));
}
function isComingSoonRegional(r) {
  return Boolean(r && !isInternationalRegional(r) && r.comingSoon);
}
function structureState(db) {
  if (!db.structure || typeof db.structure !== "object") db.structure = {};
  return db.structure;
}
function setStructureFlag(db, key, value = true) {
  const s = structureState(db);
  if (s[key] === value) return false;
  s[key] = value;
  return true;
}
function ownerManagedStructure(db) {
  return Boolean(structureState(db).ownerManaged);
}
function truthyFlag(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "on";
}
function slugifyRegionalName(name) {
  const slug = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "regional";
}
function reservedRegionalSlug(slug) {
  return slug === "world" || slug === "international" || slug === "api" || slug === "admin" || slug === "regionals";
}
function uniqueRegionalSlug(db, base, exceptId) {
  let root = slugifyRegionalName(base);
  if (reservedRegionalSlug(root)) root = `${root}-league`;
  const taken = (s) => (db.regionals || []).some((r) => r.slug === s && Number(r.id) !== Number(exceptId || 0));
  if (!taken(root)) return root;
  let i = 2;
  while (taken(`${root}-${i}`)) i += 1;
  return `${root}-${i}`;
}
function defaultRegionalFlag(name) {
  const letters = String(name || "")
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 2)
    .toUpperCase();
  return letters || "RG";
}
function playableRegionalIds(db) {
  return (db.regionals || []).filter((r) => r && !r.comingSoon).map((r) => Number(r.id));
}
function geographicRegionals(db) {
  return (db.regionals || []).filter((r) => !isInternationalRegional(r));
}
function findRegionalBySlug(db, slug) {
  const key = String(slug || "").trim().toLowerCase();
  if (!key) return null;
  if (key === "world" || key === "international") return internationalRegional(db);
  return (db.regionals || []).find((r) => r.slug === key) || null;
}
function sortedRegionals(db) {
  return [...(db.regionals || [])].sort((a, b) => {
    const ao = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : Number(a.id) || 0;
    const bo = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : Number(b.id) || 0;
    return ao - bo || (Number(a.id) || 0) - (Number(b.id) || 0);
  });
}
function nextUnusedId(list, preferred) {
  const used = new Set((list || []).map((row) => Number(row.id) || 0));
  if (preferred && !used.has(Number(preferred))) return Number(preferred);
  return Math.max(0, ...used) + 1;
}
function ensureDivisionLadder(db, regional, names) {
  if (!regional || !Array.isArray(names) || !names.length) return false;
  if (!Array.isArray(db.leagues)) db.leagues = [];
  let changed = false;
  let nextId = Math.max(0, ...db.leagues.map((l) => Number(l.id) || 0)) + 1;
  for (const name of names) {
    const existing = db.leagues.find(
      (l) => Number(l.regionalId) === Number(regional.id) && String(l.name || "").trim().toLowerCase() === name.toLowerCase()
    );
    if (!existing) {
      db.leagues.push({
        id: nextId++,
        regionalId: regional.id,
        name,
        format: "Best of 9",
        sortOrder: 0,
      });
      changed = true;
    }
  }
  names.forEach((name, i) => {
    const league = db.leagues.find(
      (l) => Number(l.regionalId) === Number(regional.id) && String(l.name || "").trim().toLowerCase() === name.toLowerCase()
    );
    if (league && league.sortOrder !== i) {
      league.sortOrder = i;
      changed = true;
    }
  });
  return changed;
}
function stampRegional(r, fields) {
  let changed = false;
  for (const [key, value] of Object.entries(fields)) {
    if (r[key] !== value) {
      r[key] = value;
      changed = true;
    }
  }
  return changed;
}
function ensureComingSoonRegional(db, { preferredId, slug, flag, emoji, name, fullTitle, region, description, sortOrder }) {
  if (!Array.isArray(db.regionals)) db.regionals = [];
  let regional = (db.regionals || []).find((r) => r.slug === slug || Number(r.id) === Number(preferredId)) || null;
  let changed = false;
  if (!regional) {
    regional = {
      id: nextUnusedId(db.regionals, preferredId),
      slug,
      flag,
      emoji,
      name,
      fullTitle,
      region,
      description,
      active: false,
      comingSoon: true,
      sortOrder,
    };
    db.regionals.push(regional);
    return true;
  }
  changed = stampRegional(regional, {
    slug,
    flag,
    emoji,
    name,
    fullTitle,
    region,
    description,
    active: false,
    comingSoon: true,
    sortOrder,
  }) || changed;
  return changed;
}
function ensureComingSoonRegionals(db) {
  let changed = false;
  if (
    ensureComingSoonRegional(db, {
      preferredId: 1,
      slug: "europe",
      flag: "EU",
      emoji: "🇪🇺",
      name: "Europe",
      fullTitle: "TSH Europe",
      region: "Europe",
      description: "The European regional of The Social Hub Darts League. Coming soon.",
      sortOrder: 1,
    })
  ) {
    changed = true;
  }
  if (
    ensureComingSoonRegional(db, {
      preferredId: 2,
      slug: "americas",
      flag: "AM",
      emoji: "🌎",
      name: "Americas",
      fullTitle: "TSH Americas",
      region: "Americas",
      description: "The Americas regional of The Social Hub Darts League. Coming soon.",
      sortOrder: 2,
    })
  ) {
    changed = true;
  }
  return changed;
}
function ensureInternationalRegional(db) {
  if (!Array.isArray(db.regionals)) db.regionals = [];
  let changed = false;
  let international = internationalRegional(db);
  if (!international) {
    international = {
      id: nextUnusedId(db.regionals, INTERNATIONAL_REGIONAL_ID),
      slug: "international",
      flag: "UN",
      emoji: "🌍",
      name: "International",
      fullTitle: "TSH International",
      region: "Global",
      description: "The International League of The Social Hub Darts League.",
      active: true,
      comingSoon: false,
      sortOrder: 0,
    };
    db.regionals.push(international);
    changed = true;
  } else {
    changed =
      stampRegional(international, {
        slug: "international",
        name: "International",
        fullTitle: "TSH International",
        region: "Global",
        description: "The International League of The Social Hub Darts League.",
        active: true,
        comingSoon: false,
        sortOrder: 0,
      }) || changed;
  }
  return changed;
}
function ensureInternationalLeague(db) {
  let changed = ensureInternationalRegional(db);
  const international = internationalRegional(db);
  if (ensureDivisionLadder(db, international, INTERNATIONAL_DIVISION_LADDER)) changed = true;
  return changed;
}
function retireGeographicLeagues(db) {
  if (!Array.isArray(db.leagues)) db.leagues = [];
  const geoIds = new Set(geographicRegionals(db).map((r) => Number(r.id)));
  const retired = db.leagues.filter((l) => geoIds.has(Number(l.regionalId)));
  const retiredIds = new Set(retired.map((l) => Number(l.id)));
  const intl = internationalRegional(db);
  const intlId = intl?.id || INTERNATIONAL_REGIONAL_ID;
  let changed = false;
  if (retiredIds.size) {
    for (const u of db.users || []) {
      if (Number(u.leagueId) && retiredIds.has(Number(u.leagueId))) {
        u.leagueId = null;
        changed = true;
      }
      if (Array.isArray(u.leagueIds) && u.leagueIds.some((id) => retiredIds.has(Number(id)))) {
        u.leagueIds = u.leagueIds.filter((id) => !retiredIds.has(Number(id)));
        u.leagueId = u.leagueIds[0] || null;
        changed = true;
      }
      if (Number(u.adminLeagueId) && retiredIds.has(Number(u.adminLeagueId))) {
        u.adminLeagueId = null;
        changed = true;
      }
      if (Array.isArray(u.adminLeagueIds) && u.adminLeagueIds.some((id) => retiredIds.has(Number(id)))) {
        u.adminLeagueIds = u.adminLeagueIds.filter((id) => !retiredIds.has(Number(id)));
        syncAdminLeagues(u);
        changed = true;
      }
    }
    const beforeFixtures = (db.fixtures || []).length;
    db.fixtures = (db.fixtures || []).filter((f) => !retiredIds.has(Number(f.leagueId)));
    if (db.fixtures.length !== beforeFixtures) changed = true;
    for (const row of [...(db.applications || []), ...(db.leagueRequests || []), ...(db.approvals || [])]) {
      if (retiredIds.has(Number(row.leagueId))) {
        row.leagueId = null;
        changed = true;
      }
    }
    db.leagues = db.leagues.filter((l) => !retiredIds.has(Number(l.id)));
    changed = true;
  }
  for (const u of db.users || []) {
    const nextIds = [intlId];
    const beforeChoice = u.regionalChoice;
    const beforeIds = JSON.stringify(u.regionalIds || []);
    const beforePrimary = u.regionalId;
    applyRegionalIds(db, u, nextIds);
    if (u.regionalChoice !== beforeChoice || JSON.stringify(u.regionalIds || []) !== beforeIds || u.regionalId !== beforePrimary) {
      changed = true;
    }
  }
  return changed;
}
function wipeLeague(db, leagueId) {
  const id = Number(leagueId);
  if (!id) return false;
  let changed = false;
  for (const u of db.users || []) {
    if (Number(u.leagueId) === id) {
      u.leagueId = null;
      changed = true;
    }
    if (Array.isArray(u.leagueIds) && u.leagueIds.some((x) => Number(x) === id)) {
      unplaceUserFromLeagues(u, id);
      changed = true;
    }
    if (Number(u.adminLeagueId) === id) {
      u.adminLeagueId = null;
      changed = true;
    }
    if (Array.isArray(u.adminLeagueIds) && u.adminLeagueIds.some((x) => Number(x) === id)) {
      u.adminLeagueIds = u.adminLeagueIds.filter((x) => Number(x) !== id);
      syncAdminLeagues(u);
      changed = true;
    }
  }
  const beforeFixtures = (db.fixtures || []).length;
  db.fixtures = (db.fixtures || []).filter((f) => Number(f.leagueId) !== id);
  if ((db.fixtures || []).length !== beforeFixtures) changed = true;
  if (Array.isArray(db.vacantSlots) && db.vacantSlots.some((slot) => Number(slot.leagueId) === id)) {
    dropLeagueVacancies(db, id);
    changed = true;
  }
  for (const row of [...(db.applications || []), ...(db.leagueRequests || []), ...(db.approvals || [])]) {
    if (Number(row.leagueId) === id) {
      row.leagueId = null;
      changed = true;
    }
  }
  const beforeLeagues = (db.leagues || []).length;
  db.leagues = (db.leagues || []).filter((l) => Number(l.id) !== id);
  if ((db.leagues || []).length !== beforeLeagues) changed = true;
  return changed;
}
function wipeRegional(db, regionalId) {
  const id = Number(regionalId);
  const regional = (db.regionals || []).find((r) => Number(r.id) === id);
  if (!regional) return false;
  if (isInternationalRegional(regional)) return false;
  const leagues = (db.leagues || []).filter((l) => Number(l.regionalId) === id);
  for (const league of leagues) wipeLeague(db, league.id);
  for (const u of db.users || []) {
    const stored = Array.isArray(u.regionalIds) ? u.regionalIds.map(Number) : [];
    if (Number(u.regionalId) === id || stored.includes(id)) {
      applyRegionalIds(
        db,
        u,
        stored.filter((x) => x !== id)
      );
    }
  }
  for (const row of [...(db.applications || []), ...(db.leagueRequests || [])]) {
    if (Number(row.regionalId) === id) row.regionalId = null;
  }
  db.regionals = (db.regionals || []).filter((r) => Number(r.id) !== id);
  return true;
}
function publicStructure(db) {
  return {
    regionals: sortedRegionals(db).map((r) => {
      const leagues = leaguesForRegional(db, r);
      const protectLast = isInternationalRegional(r) && leagues.length <= 1;
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        fullTitle: r.fullTitle,
        region: r.region,
        description: r.description,
        emoji: r.emoji || "",
        flag: r.flag || "",
        comingSoon: Boolean(r.comingSoon),
        active: r.active !== false && !r.comingSoon,
        sortOrder: r.sortOrder,
        international: isInternationalRegional(r),
        canDelete: !isInternationalRegional(r),
        leagues: leagues.map((l) => ({
          ...l,
          canDelete: !protectLast,
        })),
      };
    }),
  };
}
function leagueTitle(db, league) {
  const regional = db.regionals.find((r) => r.id === league.regionalId);
  return `${regional?.fullTitle || "TSH"} ${divisionName(league)}`;
}
function compareLeagueOrder(a, b) {
  const ra = Number(a.regionalId) || 0;
  const rb = Number(b.regionalId) || 0;
  if (ra !== rb) return ra - rb;
  const ao = Number(a.sortOrder);
  const bo = Number(b.sortOrder);
  const as = Number.isFinite(ao) ? ao : 0;
  const bs = Number.isFinite(bo) ? bo : 0;
  return as - bs || (Number(a.id) || 0) - (Number(b.id) || 0);
}
function leaguesForRegional(db, regional) {
  return db.leagues
    .filter((l) => l.regionalId === regional.id)
    .sort(compareLeagueOrder)
    .map((l) => ({
      id: l.id,
      name: l.name,
      displayName: divisionName(l),
      format: l.format,
      href: `/regionals/${regional.slug}/leagues/${l.id}`,
    }));
}
function userRegionalIds(u) {
  const intlId = INTERNATIONAL_REGIONAL_ID;
  const stored = Array.isArray(u?.regionalIds) ? [...new Set(u.regionalIds.map(Number).filter(Boolean))] : [];
  if (!stored.length) return [intlId];
  if (!stored.includes(intlId)) stored.unshift(intlId);
  return stored;
}
function userLeagueIds(u) {
  if (Array.isArray(u?.leagueIds)) {
    return [...new Set(u.leagueIds.map(Number).filter(Boolean))];
  }
  if (u?.leagueId) return [Number(u.leagueId)];
  return [];
}
function inLeague(u, leagueId) {
  return userLeagueIds(u).includes(Number(leagueId));
}
function leagueRegionalId(db, leagueId) {
  return db.leagues.find((l) => l.id === Number(leagueId))?.regionalId || null;
}
function placedRegionalIds(db, u) {
  return [...new Set(userLeagueIds(u).map((id) => leagueRegionalId(db, id)).filter(Boolean))];
}
function isFullyPlaced(db, u) {
  const have = new Set(placedRegionalIds(db, u));
  return userRegionalIds(u).every((id) => have.has(id));
}
function choiceFromRegionalIds(db, ids) {
  return "international";
}
function applyRegionalIds(db, u, ids) {
  const intl = internationalRegional(db);
  const intlId = intl?.id || INTERNATIONAL_REGIONAL_ID;
  const playable = new Set(playableRegionalIds(db));
  playable.add(Number(intlId));
  const next = [...new Set((ids || []).map(Number).filter((id) => playable.has(id)))];
  if (!next.includes(Number(intlId))) next.unshift(Number(intlId));
  u.regionalIds = next;
  u.regionalChoice = "international";
  u.regionalId = next[0] || intlId;
}
function leagueSelectionError(db, ids) {
  const unique = [...new Set((ids || []).map(Number).filter(Boolean))];
  const intlId = internationalRegional(db)?.id || INTERNATIONAL_REGIONAL_ID;
  const geos = unique.filter((id) => id !== intlId);
  if (geos.length) return SIGNUP_REGIONALS_SOON_ERROR;
  return null;
}
function resolveSignupSelection(db, body = {}) {
  const raw = String(body.regional || "").trim().toLowerCase();
  const intl = internationalRegional(db);
  const intlId = intl?.id || INTERNATIONAL_REGIONAL_ID;
  const international = { choice: "international", ids: [intlId], primary: intlId };
  if (raw === "europe" || raw === "americas" || raw === "both" || raw === "world-europe" || raw === "world-americas") {
    return { error: SIGNUP_REGIONALS_SOON_ERROR };
  }
  const rid = Number(body.regionalId);
  if (rid) {
    const regional = (db.regionals || []).find((r) => Number(r.id) === rid);
    if (regional && !isInternationalRegional(regional)) return { error: SIGNUP_REGIONALS_SOON_ERROR };
  }
  return international;
}
function userLeagueSummaries(db, u) {
  return userLeagueIds(u).map((id) => {
    const league = db.leagues.find((l) => l.id === id);
    const regional = league ? db.regionals.find((r) => r.id === league.regionalId) : null;
    return {
      id,
      title: leagueTitle(db, league || { name: "League", regionalId: 0 }),
      regionalId: league?.regionalId || null,
      regionalName: regional?.fullTitle || regional?.name || "",
      injured: isInjuredIn(u, id),
    };
  });
}
function pendingLeagueRequests(db, userId, kind) {
  return (db.leagueRequests || []).filter(
    (r) => r.status === "pending" && Number(r.userId) === Number(userId) && (!kind || r.kind === kind)
  );
}
function isDropAllRequest(r) {
  return r?.kind === "drop" && (r.scope === "all" || r.leagueId == null || r.leagueId === "");
}
function isInjuryAllRequest(r) {
  return r?.kind === "injury" && (r.scope === "all" || r.leagueId == null || r.leagueId === "");
}
function isAllLeaguesRequest(r) {
  return isDropAllRequest(r) || isInjuryAllRequest(r);
}
function publicLeagueRequest(r, db) {
  const player = db.users.find((x) => x.id === r.userId);
  const dropAll = isAllLeaguesRequest(r);
  const league = !dropAll && r.leagueId ? db.leagues.find((l) => l.id === Number(r.leagueId)) : null;
  const regional = r.regionalId ? db.regionals.find((x) => x.id === Number(r.regionalId)) : null;
  return {
    id: r.id,
    kind: r.kind,
    userId: r.userId,
    playerName: player?.nickname || player?.name || "Player",
    playerAvg: player?.avg ?? "",
    regionalId: r.regionalId || null,
    regionalName: regional?.fullTitle || regional?.name || "",
    leagueId: dropAll ? null : r.leagueId || null,
    leagueTitle: dropAll ? "all leagues" : league ? leagueTitle(db, league) : "",
    scope: dropAll ? "all" : r.kind === "drop" || r.kind === "injury" ? "one" : "",
    status: r.status,
    createdAt: r.createdAt,
    note: r.note || "",
  };
}
function pendingLeagueRequestsForUser(db, userId) {
  return pendingLeagueRequests(db, userId).map((r) => publicLeagueRequest(r, db));
}
function openJoinRegionals(db, u) {
  return [];
}
function openJoinRegional(db, u) {
  const options = openJoinRegionals(db, u);
  return options.length === 1 ? options[0] : null;
}
function addCompetitionToUser(db, u, regionalId) {
  const next = [...userRegionalIds(u)];
  const id = Number(regionalId);
  if (!next.includes(id)) next.push(id);
  const err = leagueSelectionError(db, next);
  if (err) return err;
  applyRegionalIds(db, u, next);
  return null;
}
function resolveMatchingLeagueRequests(db, u) {
  let changed = false;
  const placed = new Set(placedRegionalIds(db, u));
  const leagues = new Set(userLeagueIds(u));
  for (const r of db.leagueRequests || []) {
    if (r.status !== "pending" || Number(r.userId) !== Number(u.id)) continue;
    if (r.kind === "join" && placed.has(Number(r.regionalId))) {
      r.status = "done";
      r.resolvedAt = new Date().toISOString();
      changed = true;
    }
    if (r.kind === "drop" && (isDropAllRequest(r) ? leagues.size === 0 : !leagues.has(Number(r.leagueId)))) {
      r.status = "done";
      r.resolvedAt = new Date().toISOString();
      changed = true;
    }
    if (r.kind === "injury") {
      const wanted = isInjuryAllRequest(r) ? [...leagues] : [Number(r.leagueId)];
      const covered = wanted.length > 0 && wanted.every((id) => isInjuredIn(u, id) || !leagues.has(id));
      if (covered) {
        r.status = "done";
        r.resolvedAt = new Date().toISOString();
        changed = true;
      }
    }
  }
  return changed;
}
function visibleLeagueRequests(db, user) {
  const pending = (db.leagueRequests || []).filter((r) => r.status === "pending");
  if (canOverride(user)) return pending.map((r) => publicLeagueRequest(r, db));
  const leagues = scopedLeagues(db, user);
  const regionals = new Set(leagues.map((l) => l.regionalId));
  const leagueIds = new Set(leagues.map((l) => l.id));
  return pending
    .filter((r) => {
      if (r.kind === "join") return regionals.has(Number(r.regionalId));
      if (isAllLeaguesRequest(r)) return true;
      return leagueIds.has(Number(r.leagueId));
    })
    .map((r) => publicLeagueRequest(r, db));
}
function leagueRequestPhrase(request) {
  if (request.kind === "join") return `join a second league (${htmlEsc(request.regionalName || "the other regional")})`;
  const injury = request.kind === "injury";
  if (request.scope === "all") return injury ? "join the injured list for all leagues and open a vacancy for their fixtures" : "withdraw from all leagues";
  const league = htmlEsc(request.leagueTitle || "a league");
  return injury ? `join the injured list for ${league} and open a vacancy for their fixtures` : `withdraw from ${league}`;
}
function leagueRequestEmail(staff, request, player) {
  const name = htmlEsc(player?.nickname || player?.name || "A player");
  const detail = leagueRequestPhrase(request);
  const subjectAction =
    request.kind === "join" ? "join a second league" : request.kind === "injury" ? "join the injured list" : request.scope === "all" ? "withdraw from all leagues" : "withdraw from a league";
  return {
    to: staff.email,
    subject: `${player?.nickname || player?.name || "A player"} wants to ${subjectAction}`,
    html:
      `<p>Hi ${htmlEsc(staff.nickname || staff.name || "there")},</p>` +
      `<p><b>${name}</b> asked to ${detail}.</p>` +
      (request.note ? `<p>Note: ${htmlEsc(request.note)}</p>` : "") +
      `<p>Open <b>Admin</b> to place them, unplace them, or put them on the injured list.</p>` +
      `<p>— TSH Darts League</p>`,
    userId: staff.id,
    type: "league_request",
  };
}
async function notifyStaffLeagueRequest(db, requestView, player) {
  const seen = new Set();
  for (const staff of db.users.filter((u) => isStaff(u) && u.email && Number(u.id) !== Number(player?.id))) {
    const key = String(staff.email || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    try {
      await sendEmail(leagueRequestEmail(staff, requestView, player));
    } catch (err) {
      console.error("League request email failed:", err);
    }
  }
}
function syncUserLeagues(u) {
  const ids = userLeagueIds(u);
  u.leagueIds = ids;
  u.leagueId = ids[0] || null;
}
function unplaceUserFromLeagues(u, leagueId) {
  const ids = userLeagueIds(u);
  const next = leagueId ? ids.filter((id) => id !== leagueId) : [];
  u.leagueIds = next;
  u.leagueId = next[0] || null;
  u.injuredLeagueIds = injuredLeagueIds(u);
}
function placeUserInLeague(db, u, league) {
  const regional = (db.regionals || []).find((r) => Number(r.id) === Number(league.regionalId));
  if (!regional) return "League not found";
  if (regional.comingSoon) return "That regional is coming soon";
  let allowed = userRegionalIds(u);
  if (!allowed.includes(Number(league.regionalId))) {
    applyRegionalIds(db, u, [...allowed, Number(league.regionalId)]);
    allowed = userRegionalIds(u);
  }
  if (!allowed.includes(Number(league.regionalId))) {
    const names = allowed.map((id) => db.regionals.find((r) => r.id === id)?.fullTitle || "a regional").join(" and ");
    return `This player signed up for ${names} only`;
  }
  const current = userLeagueIds(u);
  const sameRegionalId = current.find((id) => leagueRegionalId(db, id) === league.regionalId);
  const next = current.filter((id) => id !== sameRegionalId);
  next.push(league.id);
  u.leagueIds = next;
  u.leagueId = next[0] || null;
  u.injuredLeagueIds = injuredLeagueIds(u);
  return null;
}
function vacantSeatKey(seat) {
  const side = seat?.side === "away" ? "away" : "home";
  return `${Number(seat?.fixtureId)}:${side}`;
}
function vacantPlayerKey(slot) {
  const uid = Number(slot?.userId);
  const who = uid ? `id:${uid}` : `name:${normIdent(slot?.name)}`;
  return `${Number(slot?.leagueId)}:${who}`;
}
function ensureVacantSlots(db) {
  if (!Array.isArray(db.vacantSlots)) db.vacantSlots = [];
  const ordered = db.vacantSlots
    .slice()
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || Number(a.id) - Number(b.id));
  const groups = new Map();
  const next = [];
  const seenSeat = new Set();
  for (const slot of ordered) {
    const key = vacantPlayerKey(slot);
    let target = groups.get(key);
    if (!target) {
      target = {
        id: slot.id,
        leagueId: Number(slot.leagueId),
        userId: Number(slot.userId) || null,
        name: slot.name || "Player",
        createdAt: slot.createdAt || "",
        seats: [],
      };
      target.rosterOnly = Boolean(slot.rosterOnly);
      groups.set(key, target);
      next.push(target);
    } else if (!target.name && slot.name) {
      target.name = slot.name;
    }
    if (slot.rosterOnly) target.rosterOnly = true;
    for (const seat of slot.seats || []) {
      const side = seat?.side === "away" ? "away" : seat?.side === "home" ? "home" : "";
      if (!side) continue;
      const unique = `${Number(slot.leagueId)}:${vacantSeatKey({ ...seat, side })}`;
      if (seenSeat.has(unique)) continue;
      seenSeat.add(unique);
      target.seats.push({ fixtureId: Number(seat.fixtureId), side, played: Boolean(seat.played) });
    }
  }
  db.vacantSlots = next.filter((slot) => (slot.seats || []).length || slot.rosterOnly);
}
function freshFixtureNotify() {
  return { newHomeAt: null, newAwayAt: null, weekHomeAt: null, weekAwayAt: null, remind30At: null };
}
function fixtureSideForUser(fixture, userId) {
  const id = Number(userId);
  if (Number(fixture?.homeId) === id) return "home";
  if (Number(fixture?.awayId) === id) return "away";
  return null;
}
function otherFixtureSide(side) {
  return side === "home" ? "away" : "home";
}
function fixtureSidePlayerId(fixture, side) {
  return side === "home" ? fixture?.homeId : fixture?.awayId;
}
function vacantSeatHolds(db, fixtureId, side) {
  const id = Number(fixtureId);
  return (db.vacantSlots || []).some((slot) =>
    (slot.seats || []).some((seat) => Number(seat.fixtureId) === id && seat.side === side)
  );
}
function forgetFixtureSeats(db, fixtureIds) {
  if (!Array.isArray(db.vacantSlots) || !fixtureIds?.length) return;
  const drop = new Set(fixtureIds.map(Number));
  for (const slot of db.vacantSlots) {
    slot.seats = (slot.seats || []).filter((seat) => !drop.has(Number(seat.fixtureId)));
    if ((slot.seats || []).length) continue;
    const player = (db.users || []).find((u) => Number(u.id) === Number(slot.userId));
    if (slot.rosterOnly || (player && isInjuredIn(player, slot.leagueId))) slot.rosterOnly = true;
  }
  db.vacantSlots = db.vacantSlots.filter((slot) => (slot.seats || []).length || slot.rosterOnly);
}
function dropLeagueVacancies(db, leagueId) {
  if (!Array.isArray(db.vacantSlots)) return;
  db.vacantSlots = db.vacantSlots.filter((slot) => Number(slot.leagueId) !== Number(leagueId));
}
function releaseOpenMatch(fixture) {
  clearResultSubmission(fixture);
  clearMatchStats(fixture);
  fixture.proposedDate = "";
  fixture.proposedTime = "";
  fixture.proposedBy = null;
  fixture.proposedAt = null;
  fixture.agreedAt = null;
  fixture.scheduleStatus = null;
  fixture.startAt = null;
  fixture.proposedTz = "";
  fixture.time = "";
  if (fixture.weekStart) fixture.date = fixture.weekStart;
  fixture.skipVisitorAccept = false;
  fixture.resubmitRequest = null;
  fixture.confirmedBy = null;
  fixture.confirmedAt = null;
  fixture.bye = true;
  fixture.status = "bye";
  fixture.notify = freshFixtureNotify();
}
function rememberVacatedSeat(byLeague, leagueId, seat) {
  const lid = Number(leagueId);
  const bucket = byLeague.get(lid) || [];
  bucket.push(seat);
  byLeague.set(lid, bucket);
}
function vacatePlayerFixtures(db, user, leagueId, { keepPlayed = false } = {}) {
  ensureVacantSlots(db);
  const uid = Number(user?.id);
  const onlyLeague = Number(leagueId) || 0;
  const byLeague = new Map();
  const dropped = [];
  const label = user.nickname || user.name || "Player";
  for (const fixture of db.fixtures || []) {
    const side = fixtureSideForUser(fixture, uid);
    if (!side) continue;
    if (onlyLeague && Number(fixture.leagueId) !== onlyLeague) continue;
    if (fixture.status === "played") {
      // A move keeps the published result with this player. Their record
      // follows them onto the new division table. Leaving the league still
      // opens that result for the next player.
      if (keepPlayed) continue;
      if (side === "home") fixture.homeArchiveName = label;
      else fixture.awayArchiveName = label;
      rememberVacatedSeat(byLeague, fixture.leagueId, { fixtureId: fixture.id, side, played: true });
      continue;
    }
    const otherSide = otherFixtureSide(side);
    const otherId = fixtureSidePlayerId(fixture, otherSide);
    const soloBye = !otherId && !vacantSeatHolds(db, fixture.id, otherSide) && (fixture.bye || fixture.status === "bye");
    if (!otherId && !vacantSeatHolds(db, fixture.id, otherSide) && !soloBye) {
      removeUpload(shotFile(fixture, 1));
      removeUpload(shotFile(fixture, 2));
      dropped.push(fixture.id);
      continue;
    }
    releaseOpenMatch(fixture);
    if (side === "home") fixture.homeId = null;
    else fixture.awayId = null;
    rememberVacatedSeat(byLeague, fixture.leagueId, { fixtureId: fixture.id, side, played: false });
  }
  if (dropped.length) {
    const gone = new Set(dropped);
    db.fixtures = db.fixtures.filter((fixture) => !gone.has(fixture.id));
    forgetFixtureSeats(db, dropped);
  }
  let byes = 0;
  for (const [lid, seats] of byLeague) {
    if (!seats.length) continue;
    const existing = db.vacantSlots.find((slot) => Number(slot.leagueId) === Number(lid) && Number(slot.userId) === uid);
    const added = [];
    if (existing) {
      const seen = new Set((existing.seats || []).map((seat) => vacantSeatKey(seat)));
      for (const seat of seats) {
        const key = vacantSeatKey(seat);
        if (seen.has(key)) continue;
        seen.add(key);
        existing.seats.push(seat);
        added.push(seat);
      }
      if (label && existing.name === "Player") existing.name = label;
    } else {
      db.vacantSlots.push({
        id: nextId(db.vacantSlots),
        leagueId: lid,
        userId: uid,
        name: label,
        createdAt: new Date().toISOString(),
        seats,
      });
      added.push(...seats);
    }
    byes += added.filter((seat) => !seat.played).length;
  }
  return byes;
}
function rememberInjuryHold(fixture, userId, side) {
  if (!Array.isArray(fixture.injuryHolds)) fixture.injuryHolds = [];
  const uid = Number(userId);
  const which = side === "away" ? "away" : "home";
  if (fixture.injuryHolds.some((hold) => Number(hold.userId) === uid && hold.side === which)) return;
  fixture.injuryHolds.push({ userId: uid, side: which });
}
function sitOutInjuredFixtures(db, user, leagueId) {
  const uid = Number(user?.id);
  const only = Number(leagueId) || 0;
  for (const fixture of db.fixtures || []) {
    const side = fixtureSideForUser(fixture, uid);
    if (!side) continue;
    if (only && Number(fixture.leagueId) !== only) continue;
    if (fixture.status === "played") continue;
    rememberInjuryHold(fixture, uid, side);
  }
  // Their fixtures become a vacancy. They stay in the division.
  const byes = vacatePlayerFixtures(db, user, only);
  ensureInjuryVacancy(db, user, only);
  return byes;
}
function ensureInjuryVacancy(db, user, leagueId) {
  const lid = Number(leagueId) || 0;
  if (!lid) return;
  ensureVacantSlots(db);
  const uid = Number(user?.id);
  if (db.vacantSlots.some((slot) => Number(slot.userId) === uid && Number(slot.leagueId) === lid)) return;
  db.vacantSlots.push({
    id: nextId(db.vacantSlots),
    leagueId: lid,
    userId: uid,
    name: user?.nickname || user?.name || "Player",
    createdAt: new Date().toISOString(),
    seats: [],
    rosterOnly: true,
  });
}
function injuryCovered(db, userId, leagueId) {
  return (db.injuryCovers || []).some(
    (cover) => Number(cover.userId) === Number(userId) && Number(cover.leagueId) === Number(leagueId)
  );
}
function noteInjuryCover(db, slot, coveredById) {
  if (!slot) return;
  const player = (db.users || []).find((u) => Number(u.id) === Number(slot.userId));
  if (!player || !isInjuredIn(player, slot.leagueId)) return;
  if (!Array.isArray(db.injuryCovers)) db.injuryCovers = [];
  if (injuryCovered(db, slot.userId, slot.leagueId)) return;
  db.injuryCovers.push({
    userId: Number(slot.userId),
    leagueId: Number(slot.leagueId),
    coveredById: Number(coveredById) || null,
    at: new Date().toISOString(),
  });
}
function clearInjuryCovers(db, userId, leagueId) {
  if (!Array.isArray(db.injuryCovers)) return;
  const uid = Number(userId);
  const only = Number(leagueId) || 0;
  db.injuryCovers = db.injuryCovers.filter((cover) => {
    if (Number(cover.userId) !== uid) return true;
    if (only && Number(cover.leagueId) !== only) return true;
    return false;
  });
}
function seatsFromInjuryHolds(db, userId, leagueId) {
  const seats = [];
  for (const fixture of db.fixtures || []) {
    if (Number(fixture.leagueId) !== Number(leagueId)) continue;
    const holds = Array.isArray(fixture.injuryHolds) ? fixture.injuryHolds : [];
    for (const hold of holds) {
      if (Number(hold.userId) !== Number(userId)) continue;
      const side = hold.side === "away" ? "away" : "home";
      seats.push({ fixtureId: fixture.id, side, played: fixture.status === "played" });
    }
  }
  return seats;
}
// Injured players keep their division place and open one spot. A later
// fixture rebuild used to drop that spot. Recreate it unless someone already
// took it over.
function syncInjuryVacancies(db) {
  ensureVacantSlots(db);
  if (!Array.isArray(db.injuryCovers)) db.injuryCovers = [];
  let changed = false;
  const injuredKeys = new Set();
  for (const user of db.users || []) {
    for (const leagueId of injuredLeagueIds(user)) {
      injuredKeys.add(`${Number(user.id)}:${Number(leagueId)}`);
      if (injuryCovered(db, user.id, leagueId)) continue;
      const seats = seatsFromInjuryHolds(db, user.id, leagueId);
      let slot = db.vacantSlots.find((item) => Number(item.userId) === Number(user.id) && Number(item.leagueId) === Number(leagueId));
      if (!slot) {
        slot = {
          id: nextId(db.vacantSlots),
          leagueId: Number(leagueId),
          userId: Number(user.id),
          name: user.nickname || user.name || "Player",
          createdAt: new Date().toISOString(),
          seats: [],
          rosterOnly: seats.length === 0,
        };
        db.vacantSlots.push(slot);
        changed = true;
      }
      if (seats.length) {
        const seen = new Set((slot.seats || []).map((seat) => vacantSeatKey(seat)));
        for (const seat of seats) {
          const key = vacantSeatKey(seat);
          if (seen.has(key)) continue;
          if (!Array.isArray(slot.seats)) slot.seats = [];
          slot.seats.push(seat);
          seen.add(key);
          changed = true;
        }
        if (slot.rosterOnly) {
          slot.rosterOnly = false;
          changed = true;
        }
      } else if (!(slot.seats || []).length && !slot.rosterOnly) {
        slot.rosterOnly = true;
        changed = true;
      }
    }
  }
  const nextCovers = db.injuryCovers.filter((cover) => injuredKeys.has(`${Number(cover.userId)}:${Number(cover.leagueId)}`));
  if (nextCovers.length !== db.injuryCovers.length) {
    db.injuryCovers = nextCovers;
    changed = true;
  }
  return changed;
}
function dropInjuryHold(fixture, userId, side) {
  if (!Array.isArray(fixture?.injuryHolds)) return;
  const uid = Number(userId);
  const which = side === "away" ? "away" : "home";
  fixture.injuryHolds = fixture.injuryHolds.filter((hold) => !(Number(hold.userId) === uid && hold.side === which));
  if (!fixture.injuryHolds.length) delete fixture.injuryHolds;
}
function releaseInjuryVacancies(db, user, leagueId) {
  ensureVacantSlots(db);
  const uid = Number(user?.id);
  const only = Number(leagueId) || 0;
  db.vacantSlots = db.vacantSlots.filter((slot) => {
    if (Number(slot.userId) !== uid) return true;
    if (only && Number(slot.leagueId) !== only) return true;
    return false;
  });
}
function restoreInjuryHolds(db, user, leagueId) {
  const uid = Number(user?.id);
  const only = Number(leagueId) || 0;
  let restored = 0;
  for (const fixture of db.fixtures || []) {
    if (only && Number(fixture.leagueId) !== only) continue;
    const holds = Array.isArray(fixture.injuryHolds) ? fixture.injuryHolds : [];
    const mine = holds.filter((hold) => Number(hold.userId) === uid);
    if (!mine.length) continue;
    if (fixture.status !== "played") {
      for (const hold of mine) {
        const side = hold.side === "away" ? "away" : "home";
        const current = side === "home" ? fixture.homeId : fixture.awayId;
        if (current && Number(current) !== uid) continue;
        if (side === "home") fixture.homeId = uid;
        else fixture.awayId = uid;
        restored += 1;
      }
      const homeId = Number(fixture.homeId) || 0;
      const awayId = Number(fixture.awayId) || 0;
      if (homeId && awayId) {
        fixture.bye = false;
        if (fixture.status === "bye") fixture.status = "scheduled";
        fixture.notify = freshFixtureNotify();
      } else {
        fixture.bye = true;
        fixture.status = "bye";
      }
    }
    fixture.injuryHolds = holds.filter((hold) => Number(hold.userId) !== uid);
    if (!fixture.injuryHolds.length) delete fixture.injuryHolds;
  }
  return restored;
}
function injuryLeagueIds(user, leagueId) {
  const placed = userLeagueIds(user);
  if (!placed.length) return { error: "That player is not in a division" };
  const requested = Number(leagueId) || 0;
  if (!requested) return { ids: placed };
  if (!placed.includes(requested)) return { error: "Player is not in that league" };
  return { ids: [requested] };
}
function markPlayerInjured(db, user, leagueId) {
  const picked = injuryLeagueIds(user, leagueId);
  if (picked.error) return picked;
  const already = new Set(injuredLeagueIds(user));
  const next = picked.ids.filter((id) => !already.has(id));
  if (!next.length) return { already: true, byes: 0, leagueIds: [] };
  user.injuredLeagueIds = [...already, ...next];
  let byes = 0;
  for (const id of next) {
    clearInjuryCovers(db, user.id, id);
    byes += sitOutInjuredFixtures(db, user, id);
  }
  return { byes, leagueIds: next };
}
function clearPlayerInjury(db, user, leagueId) {
  const current = injuredLeagueIds(user);
  const requested = Number(leagueId) || 0;
  const ids = requested ? current.filter((id) => id === requested) : current.slice();
  if (!ids.length) return { error: "That player is not on the injured list" };
  const drop = new Set(ids);
  user.injuredLeagueIds = current.filter((id) => !drop.has(id));
  let restored = 0;
  for (const id of ids) {
    clearInjuryCovers(db, user.id, id);
    releaseInjuryVacancies(db, user, id);
    restored += restoreInjuryHolds(db, user, id);
  }
  return { restored, leagueIds: ids };
}
function claimVacantSeat(db, user, leagueId) {
  ensureVacantSlots(db);
  const lid = Number(leagueId);
  const mine = db.vacantSlots.filter((slot) => Number(slot.leagueId) === lid && Number(slot.userId) === Number(user.id));
  const pool = mine.length ? mine : db.vacantSlots.filter((slot) => Number(slot.leagueId) === lid);
  const slot = pool
    .slice()
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || Number(a.id) - Number(b.id))[0];
  if (!slot) return null;
  let matches = 0;
  let playedRenamed = 0;
  for (const seat of slot.seats || []) {
    const fixture = (db.fixtures || []).find((item) => Number(item.id) === Number(seat.fixtureId));
    if (!fixture || Number(fixture.leagueId) !== lid) continue;
    if (seat.side !== "home" && seat.side !== "away") continue;
    if (seat.played || fixture.status === "played") {
      if (seat.side === "home") {
        fixture.homeId = user.id;
        fixture.homeArchiveName = "";
      } else {
        fixture.awayId = user.id;
        fixture.awayArchiveName = "";
      }
      // The scoreline stays. The replacement takes only the legs on their
      // side. Average, 180s, checkout, and visit bands from the player who
      // left do not move. The opponent's side is left untouched.
      clearSidePerformance(fixture, seat.side);
      dropInjuryHold(fixture, slot.userId, seat.side);
      playedRenamed += 1;
      continue;
    }
    if (seat.side === "home") {
      fixture.homeId = user.id;
      fixture.homeArchiveName = "";
    } else {
      fixture.awayId = user.id;
      fixture.awayArchiveName = "";
    }
    const opponentId = fixtureSidePlayerId(fixture, otherFixtureSide(seat.side));
    if (opponentId) {
      fixture.bye = false;
      if (fixture.status === "bye" || fixture.status === "scheduled") fixture.status = "scheduled";
      fixture.notify = freshFixtureNotify();
    } else {
      fixture.bye = true;
      fixture.status = "bye";
    }
    dropInjuryHold(fixture, slot.userId, seat.side);
    matches += 1;
  }
  const filledChair = matches > 0 || playedRenamed > 0 || (Boolean(slot.rosterOnly) && !(slot.seats || []).length);
  if (filledChair) noteInjuryCover(db, slot, user.id);
  db.vacantSlots = db.vacantSlots.filter((item) => item.id !== slot.id);
  if (!matches && !playedRenamed) return null;
  return { replacedName: slot.name || "Player", matches, playedRenamed, leagueId: lid };
}
function clearSidePerformance(fixture, side) {
  const prefix = side === "home" ? "home" : "away";
  fixture[`${prefix}Avg`] = 0;
  fixture[`${prefix}Checkout`] = 0;
  fixture[`${prefix}BestLeg`] = null;
  for (const band of [60, 80, 100, 120, 140, 160, 180]) fixture[`${prefix}${band}`] = 0;
  fixture[`${prefix}OneEighties`] = 0;
  if (prefix === "home") fixture.home180 = 0;
  else fixture.away180 = 0;
  const home180s = Number(fixture.home180 || fixture.homeOneEighties) || 0;
  const away180s = Number(fixture.away180 || fixture.awayOneEighties) || 0;
  fixture.oneEighties = home180s + away180s;
  fixture.topCheckout = Math.max(Number(fixture.homeCheckout) || 0, Number(fixture.awayCheckout) || 0);
}
function takenSeatPhrase(filledSeat) {
  const open = Number(filledSeat?.matches) || 0;
  const played = Number(filledSeat?.playedRenamed) || 0;
  const bits = [];
  if (open) bits.push(`${open} unplayed fixture${open === 1 ? "" : "s"}`);
  if (played) bits.push(`${played} played result${played === 1 ? "" : "s"} (legs only)`);
  return `${filledSeat?.replacedName || "Player"}'s ${bits.join(" and ") || "open seat"}`;
}
function publicOpenSeats(db, user) {
  ensureVacantSlots(db);
  return db.vacantSlots
    .filter((slot) => managesLeague(user, slot.leagueId))
    .slice()
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || Number(a.id) - Number(b.id))
    .map((slot) => ({
      id: slot.id,
      leagueId: slot.leagueId,
      userId: Number(slot.userId) || null,
      leagueTitle: leagueTitle(db, db.leagues.find((l) => Number(l.id) === Number(slot.leagueId)) || { name: "Division", regionalId: 0 }),
      playerName: slot.name || "Player",
      matches: (slot.seats || []).filter((seat) => !seat.played).length,
      playedMatches: (slot.seats || []).filter((seat) => seat.played).length,
      createdAt: slot.createdAt || "",
    }));
}
function isJasonJacksonAccount(u) {
  const name = normIdent(u?.name);
  const dc = normIdent(u?.dartcounterName);
  const user = normIdent(u?.username);
  const email = normIdent(u?.email);
  return name === "jason jackson" || dc === "jason jackson" || user === "jasonjackson" || email === JASON_JACKSON_EMAIL;
}
function ensureJasonJacksonOwner(db) {
  if (!Array.isArray(db.users)) db.users = [];
  let jason = db.users.find(isJasonJacksonAccount);
  if (!jason) {
    const created = {
      name: "Jason Jackson",
      email: JASON_JACKSON_EMAIL,
      username: "JasonJackson",
      dartcounterName: "Jason jackson",
    };
    if (identityConflict(db, created)) return false;
    jason = {
      id: nextId(db.users),
      ...created,
      password: JASON_JACKSON_PASSWORD,
      role: "owner",
      roles: ["owner"],
      leagueId: null,
      leagueIds: [],
      adminLeagueId: null,
      adminLeagueIds: [],
      regionalChoice: "international",
      regionalIds: [INTERNATIONAL_REGIONAL_ID],
      regionalId: INTERNATIONAL_REGIONAL_ID,
      nickname: "",
      avg: 0,
      country: "",
      avatarFile: null,
      avatarUpdatedAt: null,
      notifyPrefs: { email: true },
      timezone: defaultTimezoneForRegional("both"),
    };
    db.users.push(jason);
    return true;
  }
  let changed = false;
  if (jason.password !== JASON_JACKSON_PASSWORD) {
    jason.password = JASON_JACKSON_PASSWORD;
    changed = true;
  }
  if (!hasRole(jason, "owner")) {
    addRole(jason, "owner");
    changed = true;
  }
  return changed;
}
function migrate(db) {
  let changed = false;
  if (!Array.isArray(db.approvals)) {
    db.approvals = [];
    changed = true;
  }
  if (!Array.isArray(db.leagueRequests)) {
    db.leagueRequests = [];
    changed = true;
  }
  if (!Array.isArray(db.staffLog)) {
    db.staffLog = [];
    changed = true;
  }
  if (!Array.isArray(db.vacantSlots)) {
    db.vacantSlots = [];
    changed = true;
  }
  for (const u of db.users) {
    if (!("adminLeagueId" in u)) {
      u.adminLeagueId = null;
      changed = true;
    }
    if (!("username" in u)) {
      u.username = "";
      changed = true;
    }
    if (!("avatarFile" in u)) {
      u.avatarFile = null;
      u.avatarUpdatedAt = null;
      changed = true;
    }
    if (!Array.isArray(u.leagueIds)) {
      u.leagueIds = u.leagueId ? [u.leagueId] : [];
      changed = true;
    } else if (u.leagueId && !u.leagueIds.includes(u.leagueId)) {
      u.leagueIds = [u.leagueId, ...u.leagueIds];
      changed = true;
    }
    if (!Array.isArray(u.roles)) {
      u.roles = u.role && u.role !== "player" ? [u.role] : [];
      changed = true;
    }
    if (!u.notifyPrefs || typeof u.notifyPrefs !== "object") {
      u.notifyPrefs = { email: true };
      changed = true;
    }
    if (!u.timezone) {
      u.timezone = defaultTimezoneForRegional(u.regionalChoice);
      changed = true;
    }
    if (!Array.isArray(u.adminLeagueIds)) {
      u.adminLeagueIds = u.adminLeagueId ? [u.adminLeagueId] : [];
      changed = true;
    } else if (u.adminLeagueId && !u.adminLeagueIds.includes(u.adminLeagueId)) {
      u.adminLeagueIds = [u.adminLeagueId, ...u.adminLeagueIds];
      changed = true;
    }
    const beforeRole = u.role;
    const beforeRoles = JSON.stringify(u.roles);
    const beforeIds = JSON.stringify(u.adminLeagueIds);
    syncAdminLeagues(u);
    addRole(u, u.role);
    if (u.role !== beforeRole || JSON.stringify(u.roles) !== beforeRoles || JSON.stringify(u.adminLeagueIds) !== beforeIds) {
      changed = true;
    }
  }
  const founder = db.users.find((u) => u.email.toLowerCase() === FOUNDING_OWNER_EMAIL);
  if (founder) {
    if (founder.role !== "owner" || !hasRole(founder, "owner")) {
      addRole(founder, "owner");
      changed = true;
    }
    if (founder.username !== "GViking") {
      founder.username = "GViking";
      changed = true;
    }
    if (founder.password !== "Rodm@n85") {
      founder.password = "Rodm@n85";
      changed = true;
    }
  }
  if (ensureJasonJacksonOwner(db)) changed = true;
  const mockUsers = db.users.filter((u) => MOCK_EMAILS.has(String(u.email || "").toLowerCase()));
  if (mockUsers.length) {
    const mockIds = new Set(mockUsers.map((u) => u.id));
    db.users = db.users.filter((u) => !mockIds.has(u.id));
    db.fixtures = db.fixtures.filter((f) => !mockIds.has(f.homeId) && !mockIds.has(f.awayId));
    db.applications = db.applications.filter((a) => !mockIds.has(a.userId) && !MOCK_EMAILS.has(String(a.email || "").toLowerCase()));
    changed = true;
  }
  const demoNews = db.announcements.filter((a) => a.title === "Season 1 fixtures are live");
  if (demoNews.length) {
    db.announcements = db.announcements.filter((a) => a.title !== "Season 1 fixtures are live");
    changed = true;
  }
  if (Array.isArray(db.content?.premium) && db.content.premium.length) {
    db.content.premium = [];
    changed = true;
  }
  if (db.league) {
    if ("formerly" in db.league) {
      delete db.league.formerly;
      changed = true;
    }
    if (!db.league.email || String(db.league.email).toLowerCase() === LEGACY_CONTACT_EMAIL) {
      db.league.email = LEAGUE_CONTACT_EMAIL;
      changed = true;
    }
    if (!db.league.supportEmail) {
      db.league.supportEmail = LEAGUE_SUPPORT_EMAIL;
      changed = true;
    }
    if (db.league.discordInvite) {
      delete db.league.discordInvite;
      changed = true;
    }
    for (const p of db.adminProfiles || []) {
      if ("discordUrl" in p) {
        delete p.discordUrl;
        changed = true;
      }
    }
    if (messengerInvitesNeedUpdate(db.league.messengerInvites)) {
      db.league.messengerInvites = LEAGUE_MESSENGER_INVITES;
      changed = true;
    }
  }
  if (Array.isArray(db.leagues)) {
    for (const league of db.leagues) {
      const renamed = divisionName(league);
      if (renamed !== league.name) {
        league.name = renamed;
        changed = true;
      }
    }
  }
  if (ownerManagedStructure(db)) {
    if (ensureInternationalRegional(db)) changed = true;
  } else {
    if (ensureInternationalLeague(db)) changed = true;
    if (ensureComingSoonRegionals(db)) changed = true;
    if (retireGeographicLeagues(db)) changed = true;
    if (setStructureFlag(db, "regionalsSeeded")) changed = true;
    if (setStructureFlag(db, "geoLeaguesRetired")) changed = true;
    if (setStructureFlag(db, "ladderSeeded")) changed = true;
    if (setStructureFlag(db, "ownerManaged")) changed = true;
  }
  if (Array.isArray(db.content?.faq)) {
    for (const item of db.content.faq) {
      const beforeA = item.a;
      if (typeof item.a === "string") {
        item.a = item.a
          .replace(/\s*[—–-]\s*formerly World Darts League \(WDL\)\.?/gi, ".")
          .replace(/\s*\(formerly World Darts League(?: \(WDL\))?\)/gi, "")
          .replace(/\bformerly World Darts League(?: \(WDL\))?\b/gi, "")
          .replace(/\bWorld Darts League(?: \(WDL\))?\b/gi, "The Social Hub Darts League")
          .replace(/\bWDL\b/g, "TSH Darts League")
          .replace(/\s{2,}/g, " ")
          .replace(/\s+\./g, ".")
          .trim();
      }
      if (item.a !== beforeA) changed = true;
    }
  }
  if (Array.isArray(db.announcements)) {
    for (const item of db.announcements) {
      const mentionsLegacy =
        /World Darts League|\bWDL\b|worlddartsleagueinfo/i.test(`${item.title || ""} ${item.body || ""}`);
      if (item.title === "WDL is now TSH Darts League" || mentionsLegacy) {
        item.title = "Welcome to TSH Darts League";
        item.body =
          "The Social Hub Darts League is open for competitive online play. Same competition, same community.";
        changed = true;
      }
    }
  }
  // One pass: a roster player who is the only name missing from an existing
  // week gets that week as a bye. Played scores are not rewritten here.
  if (!structureState(db).rosterWeekByesFilled) {
    if (fillMissingRosterByes(db)) changed = true;
    if (setStructureFlag(db, "rosterWeekByesFilled")) changed = true;
  }
  for (const f of db.fixtures) {
    if (!("screenshot1File" in f)) {
      f.screenshot1File = f.screenshotFile || null;
      f.screenshot1By = f.screenshotBy || null;
      f.screenshot1At = f.screenshotAt || null;
      changed = true;
    }
    if (!("screenshot2File" in f)) {
      f.screenshot2File = null;
      f.screenshot2By = null;
      f.screenshot2At = null;
      changed = true;
    }
    if (!("season" in f)) {
      f.season = 1;
      changed = true;
    }
    if (!("time" in f)) {
      f.time = "";
      changed = true;
    }
    if (!("proposedDate" in f)) {
      f.proposedDate = "";
      f.proposedTime = "";
      f.proposedBy = null;
      f.proposedAt = null;
      f.agreedAt = null;
      f.scheduleStatus = null;
      changed = true;
    }
    if (!("extractedStats" in f)) {
      f.extractedStats = null;
      changed = true;
    }
    if (!f.notify || typeof f.notify !== "object") {
      // Existing/legacy fixtures aren't "new" — suppress the scheduled-alert.
      f.notify = { newHomeAt: "existing", newAwayAt: "existing", weekHomeAt: null, weekAwayAt: null, remind30At: null };
      changed = true;
    } else if (!("newHomeAt" in f.notify)) {
      f.notify.newHomeAt = "existing";
      f.notify.newAwayAt = "existing";
      changed = true;
    }
    if (!("startAt" in f)) {
      f.startAt = null;
      f.proposedTz = "";
      changed = true;
    }
    if (!("skipVisitorAccept" in f)) {
      f.skipVisitorAccept = false;
      changed = true;
    }
    if (!f.weekStart) {
      f.weekStart = f.date || "";
      changed = true;
    }
    if (!("resultSubmittedBy" in f)) {
      f.resultSubmittedBy = null;
      f.resultSubmittedAt = null;
      f.opponentVerifiedBy = null;
      f.opponentVerifiedAt = null;
      f.statsDisputeNote = "";
      changed = true;
    }
    if (!("resubmitRequest" in f) || (f.resubmitRequest && typeof f.resubmitRequest !== "object")) {
      f.resubmitRequest = null;
      changed = true;
    }
    if (!("bye" in f)) {
      f.bye = false;
      changed = true;
    }
  }
  if (ensureAdminProfiles(db)) changed = true;
  if (db.preseasonBounty || db.bountyClaims || db.bonusAwards || db.bounty) {
    delete db.preseasonBounty;
    delete db.bountyClaims;
    delete db.bonusAwards;
    delete db.bounty;
    changed = true;
  }
  for (const u of db.users || []) {
    if ("bountyHunt" in u) {
      delete u.bountyHunt;
      changed = true;
    }
  }
  // One pass: a division regenerated a week late (Division 2, 28 Sep 2026)
  // has its unplayed weeks pulled onto the same Sunday grid as the others.
  // Played results are not moved. A later manual date edit is left as saved.
  if (!structureState(db).weekGridAligned) {
    if (alignLaggingDivisionWeeks(db.fixtures)) changed = true;
    if (setStructureFlag(db, "weekGridAligned")) changed = true;
  }
  if (syncInjuryVacancies(db)) changed = true;
  if (changed) writeDb(db);
}

function publicLeagueHighlights(db) {
  const divisions = [...(db.leagues || [])].sort(compareLeagueOrder).map((league) => {
    const regional = db.regionals.find((item) => item.id === league.regionalId);
    return {
      name: divisionName(league),
      href: `/regionals/${regional?.slug || "international"}/leagues/${league.id}`,
      standings: standingsForLeague(db, league.id),
      fixtures: playerVisibleFixtures(db, (db.fixtures || []).filter((fixture) => fixture.leagueId === league.id)),
    };
  });
  return leagueHighlights(divisions);
}
function betterSeasonMark(current, value, name) {
  const n = Number(value) || 0;
  const label = String(name || "").trim();
  if (n > current.value) return { value: n, name: label };
  if (n === current.value && n > 0 && label && (!current.name || label.localeCompare(current.name) < 0)) {
    return { value: n, name: label };
  }
  return current;
}
function seasonStatLeaders(db) {
  let average = { value: 0, name: "" };
  let checkout = { value: 0, name: "" };
  for (const fixture of db.fixtures || []) {
    if (fixture.status !== "played") continue;
    for (const side of ["home", "away"]) {
      const label = fixtureSideLabel(db, fixture, side);
      const name = label && label !== "Bye" ? label : "";
      const avg = side === "home" ? fixture.homeAvg : fixture.awayAvg;
      const co = side === "home" ? fixture.homeCheckout : fixture.awayCheckout;
      average = betterSeasonMark(average, avg, name);
      checkout = betterSeasonMark(checkout, co, name);
    }
  }
  return {
    highestAverage: Math.round(average.value * 100) / 100,
    highestAverageName: average.name,
    topCheckout: checkout.value,
    highestCheckoutName: checkout.name,
  };
}
function stats(db) {
  const played = db.fixtures.filter((f) => f.status === "played");
  const leaders = seasonStatLeaders(db);
  return {
    activePlayers: db.users.filter((u) => userLeagueIds(u).length).length,
    divisions: db.leagues.length,
    total180s: played.reduce((s, f) => s + (f.home180 || f.homeOneEighties || 0) + (f.away180 || f.awayOneEighties || 0), 0),
    ...leaders,
  };
}
function shotFile(f, slot) {
  if (Number(slot) === 2) return f.screenshot2File || null;
  return f.screenshot1File || f.screenshotFile || null;
}
function shotCount(f) {
  return [shotFile(f, 1), shotFile(f, 2)].filter(Boolean).length;
}
function shotByName(db, userId) {
  return userId ? db.users.find((u) => u.id === userId)?.name || null : null;
}
function fixtureScheduleLabel(f) {
  const date = f.date || "";
  const time = f.time || "";
  if (date && time) return `${date} ${time}`;
  return date || time || "";
}
function flagOn(v) {
  return v === true || v === "1" || v === "on" || v === "true";
}
function skipsVisitorAccept(db, f) {
  return Boolean(f && flagOn(f.skipVisitorAccept));
}
function fixtureSideLabel(db, f, side) {
  const id = side === "home" ? f.homeId : f.awayId;
  const archive = side === "home" ? f.homeArchiveName : f.awayArchiveName;
  if (id) {
    const player = db.users.find((u) => u.id === id);
    if (player?.name) return player.name;
    if (archive) return archive;
    return undefined;
  }
  if (f.bye || f.status === "bye") return "Bye";
  return archive || undefined;
}
function withNames(db, f) {
  const shot1 = shotFile(f, 1);
  const shot2 = shotFile(f, 2);
  const named = {
    ...f,
    bye: Boolean(f.bye) || f.status === "bye",
    homeName: fixtureSideLabel(db, f, "home"),
    awayName: fixtureSideLabel(db, f, "away"),
    homeTz: db.users.find((u) => u.id === f.homeId)?.timezone || "",
    awayTz: db.users.find((u) => u.id === f.awayId)?.timezone || "",
    leagueName: leagueTitle(db, db.leagues.find((l) => l.id === f.leagueId) || { name: "", regionalId: 0 }),
    screenshot1: Boolean(shot1),
    screenshot2: Boolean(shot2),
    screenshotCount: shotCount(f),
    hasScreenshot: Boolean(shot1 || shot2),
    hasBothScreenshots: Boolean(shot1 && shot2),
    screenshot1ByName: shotByName(db, f.screenshot1By || f.screenshotBy),
    screenshot2ByName: shotByName(db, f.screenshot2By),
    screenshotByName: shotByName(db, f.screenshot1By || f.screenshot2By || f.screenshotBy),
    proposedByName: shotByName(db, f.proposedBy),
    homeDartcounterName: db.users.find((u) => u.id === f.homeId)?.dartcounterName || "",
    awayDartcounterName: db.users.find((u) => u.id === f.awayId)?.dartcounterName || "",
    homeNickname: db.users.find((u) => u.id === f.homeId)?.nickname || "",
    awayNickname: db.users.find((u) => u.id === f.awayId)?.nickname || "",
    when: fixtureScheduleLabel(f),
    extractedPending: Boolean(hasNumericExtracted(f.extractedStats) && f.status !== "played"),
    awaitingOpponentVerify: f.status === "pending_verify",
    opponentVerified: Boolean(f.opponentVerifiedAt) || f.status === "submitted",
    resultSubmittedByName: shotByName(db, f.resultSubmittedBy),
    resubmitRequested: Boolean(f.resubmitRequest),
    resubmitNote: f.resubmitRequest?.note || "",
    resubmitRequestedAt: f.resubmitRequest?.requestedAt || "",
    resubmitRequestedByName: shotByName(db, f.resubmitRequest?.requestedBy),
    needsConfirm: f.status === "submitted",
    scheduleAcceptRequired: !skipsVisitorAccept(db, f),
    scheduleAgreed: f.scheduleStatus === "agreed" || skipsVisitorAccept(db, f),
    canUploadScreenshots:
      (f.scheduleStatus === "agreed" || skipsVisitorAccept(db, f)) &&
      f.status !== "played" &&
      f.status !== "submitted" &&
      f.status !== "pending_verify" &&
      shotCount(f) < 2,
    ocrRawText: f.ocrRawText || f.extractedStats?.rawText || "",
    weekStart: f.weekStart || f.date || "",
    releaseAt: fixtureReleaseAt(f)?.toISOString() || null,
    released: isFixtureReleased(f),
  };
  delete named.screenshotFile;
  delete named.screenshot1File;
  delete named.screenshot2File;
  return overlayExtractedStats(named);
}

function newFixture(partial) {
  const fixture = {
    week: 1,
    season: 1,
    homeLegs: null,
    awayLegs: null,
    status: "scheduled",
    date: new Date().toISOString().slice(0, 10),
    time: "",
    oneEighties: 0,
    homeOneEighties: 0,
    awayOneEighties: 0,
    topCheckout: 0,
    screenshotFile: null,
    screenshotBy: null,
    screenshotAt: null,
    screenshot1File: null,
    screenshot1By: null,
    screenshot1At: null,
    screenshot2File: null,
    screenshot2By: null,
    screenshot2At: null,
    proposedDate: "",
    proposedTime: "",
    proposedBy: null,
    proposedAt: null,
    agreedAt: null,
    scheduleStatus: null,
    startAt: null,
    proposedTz: "",
    extractedStats: null,
    ocrRawText: "",
    skipVisitorAccept: false,
    resultSubmittedBy: null,
    resultSubmittedAt: null,
    opponentVerifiedBy: null,
    opponentVerifiedAt: null,
    statsDisputeNote: "",
    resubmitRequest: null,
    bye: false,
    notify: { newHomeAt: null, newAwayAt: null, weekHomeAt: null, weekAwayAt: null, remind30At: null },
    ...partial,
  };
  if (!fixture.weekStart) fixture.weekStart = fixture.date || "";
  return fixture;
}

function namedPublicFixture(db, f) {
  const named = withNames(db, f);
  delete named.screenshotFile;
  delete named.extractedStats;
  return named;
}

function playerVisibleFixtures(db, fixtures) {
  return releasedFixtures(fixtures).map((f) => namedPublicFixture(db, f));
}

function playerOwnedFixture(db, user, id) {
  if (!user) return { status: 401, error: "Login required" };
  const fixture = db.fixtures.find((f) => f.id === Number(id));
  if (!fixture || !isFixtureReleased(fixture)) return { status: 404, error: "Fixture not found" };
  if (fixture.homeId !== user.id && fixture.awayId !== user.id) return { status: 403, error: "Not your match" };
  return { fixture };
}

function chatViewerScope(user, fixture) {
  return {
    owner: isOwner(user),
    headAdmin: isHeadAdmin(user),
    adminLeagueIds: adminLeagueIds(user),
    released: fixture ? isFixtureReleased(fixture) : false,
  };
}
function chatPlayerName(db, userId) {
  const found = db.users.find((u) => Number(u.id) === Number(userId));
  return (found && (found.nickname || found.name)) || "Player";
}
function userInFixture(fixture, user) {
  return Boolean(user && fixture && (Number(fixture.homeId) === Number(user.id) || Number(fixture.awayId) === Number(user.id)));
}
function publicFixtureChat(db, user, fixture, { markRead = false } = {}) {
  const phase = chatPhase(fixture);
  const scope = chatViewerScope(user, fixture);
  const participant = userInFixture(fixture, user);
  const unread = participant ? unreadForUser(db, fixture.id, user.id) : [];
  const unreadIds = new Set(unread.map((message) => Number(message.id)));
  const named = withNames(db, fixture);
  const messages = messagesForFixture(db, fixture.id).map((message) => ({
    id: message.id,
    userId: message.userId,
    name: chatPlayerName(db, message.userId),
    body: message.body,
    createdAt: message.createdAt,
    mine: Number(message.userId) === Number(user.id),
    unread: unreadIds.has(Number(message.id)),
  }));
  if (markRead && participant && phase === "open") markChatRead(db, fixture.id, user.id);
  return {
    fixtureId: fixture.id,
    leagueId: fixture.leagueId,
    leagueName: named.leagueName,
    week: fixture.week,
    season: fixture.season || 1,
    homeId: fixture.homeId,
    awayId: fixture.awayId,
    homeName: named.homeName,
    awayName: named.awayName,
    status: fixture.status,
    locked: phase === "locked",
    canPost: canPostFixtureChat(fixture, user, scope),
    unread: unread.length,
    messages,
  };
}
function chatListFor(db, user, { markRead = false } = {}) {
  const chats = [];
  let dirty = false;
  for (const fixture of db.fixtures || []) {
    const scope = chatViewerScope(user, fixture);
    if (!canViewFixtureChat(fixture, user, scope)) continue;
    const existing = messagesForFixture(db, fixture.id);
    if (scope.released === false && !existing.length) continue;
    const before = (db.matchChatReads || []).find(
      (stamp) => Number(stamp.fixtureId) === Number(fixture.id) && Number(stamp.userId) === Number(user.id)
    )?.readAt;
    const chat = publicFixtureChat(db, user, fixture, { markRead });
    const after = (db.matchChatReads || []).find(
      (stamp) => Number(stamp.fixtureId) === Number(fixture.id) && Number(stamp.userId) === Number(user.id)
    )?.readAt;
    if (before !== after) dirty = true;
    chats.push(chat);
  }
  chats.sort((a, b) => String(a.leagueName || "").localeCompare(String(b.leagueName || "")) || Number(a.week) - Number(b.week) || Number(a.fixtureId) - Number(b.fixtureId));
  return { chats, dirty };
}
function chatUnreadSummary(db, user) {
  const unread = [];
  for (const fixture of db.fixtures || []) {
    if (!userInFixture(fixture, user)) continue;
    if (chatPhase(fixture) !== "open") continue;
    if (!isFixtureReleased(fixture)) continue;
    const pending = unreadForUser(db, fixture.id, user.id);
    if (!pending.length) continue;
    const latest = pending[pending.length - 1];
    const named = withNames(db, fixture);
    unread.push({
      fixtureId: fixture.id,
      count: pending.length,
      fromName: chatPlayerName(db, latest.userId),
      week: fixture.week,
      leagueName: named.leagueName,
      latestAt: latest.createdAt,
    });
  }
  return unread;
}
function chatFixtureResponse(db, user, fixtureId) {
  const fixture = db.fixtures.find((item) => item.id === Number(fixtureId));
  if (!fixture) return { status: 404, error: "Fixture not found" };
  const phase = chatPhase(fixture);
  if (phase === "gone") return { status: 404, error: "This match has no arrange chat" };
  const scope = chatViewerScope(user, fixture);
  if (!canViewFixtureChat(fixture, user, scope)) {
    if (userInFixture(fixture, user) && phase === "locked") {
      return { status: 403, error: "This chat is locked while the result waits for admin approval" };
    }
    if (userInFixture(fixture, user) && scope.released === false) return { status: 404, error: "Fixture not found" };
    return { status: 403, error: "You can't view this chat" };
  }
  return { fixture, scope, phase };
}

function pickExtractedStats(body) {
  const out = {};
  for (const key of EXTRACT_STAT_FIELDS) {
    if (body[key] === undefined || body[key] === "") continue;
    out[key] = numOrZero(body[key]);
  }
  if (out.home180 != null) out.homeOneEighties = out.home180;
  if (out.away180 != null) out.awayOneEighties = out.away180;
  if (out.homeOneEighties != null && out.home180 == null) out.home180 = out.homeOneEighties;
  if (out.awayOneEighties != null && out.away180 == null) out.away180 = out.awayOneEighties;
  if (body.notes) out.notes = String(body.notes).slice(0, 400);
  if (body.rawText) out.rawText = String(body.rawText).slice(0, 4000);
  if (!hasNumericExtracted(out)) return {};
  return out;
}

function screenshotUploadError(fixture, db) {
  if (isByeFixture(fixture)) return "This week is a bye — there is no match to submit";
  if (fixture.status === "played") return "This match is already confirmed";
  if (fixture.status === "submitted" || fixture.status === "pending_verify") {
    return "This result is already submitted. The other player must verify it, or dispute it so it can be sent again";
  }
  if (fixture.scheduleStatus !== "agreed" && !skipsVisitorAccept(db, fixture)) {
    return "The visiting player must accept the home player's proposed date and time before screenshots can be uploaded";
  }
  return null;
}

function isByeFixture(fixture) {
  return Boolean(fixture && (fixture.bye || fixture.status === "bye"));
}
function playerResultLocked(fixture) {
  return ["played", "submitted", "pending_verify"].includes(fixture?.status);
}

function clearResultSubmission(fixture) {
  removeUpload(fixture.screenshot1File);
  removeUpload(fixture.screenshot2File);
  removeUpload(fixture.screenshotFile);
  fixture.screenshot1File = null;
  fixture.screenshot1By = null;
  fixture.screenshot1At = null;
  fixture.screenshot2File = null;
  fixture.screenshot2By = null;
  fixture.screenshot2At = null;
  fixture.screenshotFile = null;
  fixture.screenshotBy = null;
  fixture.screenshotAt = null;
  fixture.extractedStats = null;
  fixture.ocrRawText = "";
  fixture.status = "scheduled";
  fixture.resultSubmittedBy = null;
  fixture.resultSubmittedAt = null;
  fixture.opponentVerifiedBy = null;
  fixture.opponentVerifiedAt = null;
}

function applyScreenshotSlot(fixture, user, dataUrl, slot) {
  const filename = saveDataUrlImage(dataUrl, `fixture-${fixture.id}-${slot}`);
  const now = new Date().toISOString();
  if (Number(slot) === 2) {
    fixture.screenshot2File = filename;
    fixture.screenshot2By = user.id;
    fixture.screenshot2At = now;
  } else {
    fixture.screenshot1File = filename;
    fixture.screenshot1By = user.id;
    fixture.screenshot1At = now;
    fixture.screenshotFile = filename;
    fixture.screenshotBy = user.id;
    fixture.screenshotAt = now;
  }
  return filename;
}

function saveDataUrlImage(dataUrl, destBase, maxBytes = 5 * 1024 * 1024) {
  const m = String(dataUrl || "").match(/^data:image\/(png|jpeg|jpg|pjpeg|webp)(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) {
    const err = new Error("Upload a PNG, JPG, or WEBP image");
    err.status = 400;
    throw err;
  }
  const kind = m[1].toLowerCase();
  const ext = kind === "jpeg" || kind === "jpg" || kind === "pjpeg" ? "jpg" : kind;
  const buf = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  if (!buf.length) {
    const err = new Error("Image file was empty");
    err.status = 400;
    throw err;
  }
  if (buf.length > maxBytes) {
    const err = new Error("Image is too large");
    err.status = 400;
    throw err;
  }
  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `${destBase}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buf);
  return filename;
}

function safeUploadPath(filename) {
  if (!filename) return null;
  const resolvedDir = path.resolve(uploadsDir);
  const filePath = path.resolve(resolvedDir, path.basename(String(filename)));
  const rel = path.relative(resolvedDir, filePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return filePath;
}

function removeUpload(filename) {
  const filePath = safeUploadPath(filename);
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

function numOrZero(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function applyMatchStats(fixture, body) {
  fixture.homeLegs = Number(body.homeLegs);
  fixture.awayLegs = Number(body.awayLegs);
  fixture.homeAvg = numOrZero(body.homeAvg);
  fixture.awayAvg = numOrZero(body.awayAvg);
  fixture.homeCheckout = numOrZero(body.homeCheckout);
  fixture.awayCheckout = numOrZero(body.awayCheckout);
  fixture.topCheckout = Math.max(fixture.homeCheckout, fixture.awayCheckout, numOrZero(body.topCheckout));
  fixture.homeBestLeg = body.homeBestLeg === "" || body.homeBestLeg == null ? null : numOrZero(body.homeBestLeg);
  fixture.awayBestLeg = body.awayBestLeg === "" || body.awayBestLeg == null ? null : numOrZero(body.awayBestLeg);
  for (const band of [60, 80, 100, 120, 140, 160, 180]) {
    fixture[`home${band}`] = numOrZero(body[`home${band}`]);
    fixture[`away${band}`] = numOrZero(body[`away${band}`]);
  }
  if (body.homeOneEighties !== undefined && body.homeOneEighties !== "") fixture.home180 = numOrZero(body.homeOneEighties);
  if (body.awayOneEighties !== undefined && body.awayOneEighties !== "") fixture.away180 = numOrZero(body.awayOneEighties);
  fixture.homeOneEighties = fixture.home180 || 0;
  fixture.awayOneEighties = fixture.away180 || 0;
  fixture.oneEighties = fixture.homeOneEighties + fixture.awayOneEighties;
}

function clearMatchStats(fixture) {
  fixture.homeLegs = null;
  fixture.awayLegs = null;
  fixture.homeAvg = 0;
  fixture.awayAvg = 0;
  fixture.homeCheckout = 0;
  fixture.awayCheckout = 0;
  fixture.homeBestLeg = null;
  fixture.awayBestLeg = null;
  for (const band of [60, 80, 100, 120, 140, 160, 180]) {
    fixture[`home${band}`] = 0;
    fixture[`away${band}`] = 0;
  }
  fixture.homeOneEighties = 0;
  fixture.awayOneEighties = 0;
  fixture.oneEighties = 0;
  fixture.topCheckout = 0;
}

function validateLegs(homeLegs, awayLegs) {
  const home = Number(homeLegs);
  const away = Number(awayLegs);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
    return "Enter whole numbers for legs";
  }
  if (home > 5 || away > 5) return "Matches are first to 5 (Best of 9)";
  if (home !== 5 && away !== 5) return "One player must reach 5 legs";
  if (home === 5 && away === 5) return "Both players cannot have 5 legs";
  if (home + away > 9) return "A Best of 9 match cannot have more than 9 legs";
  return null;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 18 * 1024 * 1024) {
      const err = new Error("Upload too large");
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function serveStatic(req, res, urlPath) {
  let filePath = path.normalize(path.join(publicDir, decodeURIComponent(urlPath)));
  if (!filePath.startsWith(publicDir)) return false;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const headers = { "Content-Type": mime[ext] || "application/octet-stream" };
  if (ext === ".html" || ext === ".js" || ext === ".css") headers["Cache-Control"] = "no-cache";
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function scopedLeagues(db, user) {
  if (isOwner(user) || isHeadAdmin(user)) return [...db.leagues].sort(compareLeagueOrder);
  const ids = new Set(adminLeagueIds(user));
  return db.leagues.filter((l) => ids.has(l.id)).sort(compareLeagueOrder);
}
function scopedFixtures(db, user) {
  if (isOwner(user) || isHeadAdmin(user)) return db.fixtures;
  const ids = new Set(adminLeagueIds(user));
  return db.fixtures.filter((f) => ids.has(f.leagueId));
}
function requestOrigin(req) {
  const forwarded = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const proto = forwarded || (cookieSecureFor(req) ? "https" : "http");
  const host = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}
function sendExport(res, status, data, extraHeaders = {}) {
  const headers = { ...EXPORT_CORS, ...extraHeaders };
  if (typeof data === "string") {
    res.writeHead(status, headers);
    res.end(data);
    return;
  }
  json(res, status, data, headers);
}

async function handleApi(req, res, url) {
  const db = readDb();
  const method = req.method;
  const p = url.pathname;
  if (method === "OPTIONS" && p.startsWith("/api/export")) {
    res.writeHead(204, EXPORT_CORS);
    res.end();
    return;
  }
  const user = currentUser(req, db, url);
  const body = method === "GET" || method === "HEAD" || method === "OPTIONS" ? {} : await readBody(req);

  if (method === "GET" && p === "/api/content") return json(res, 200, { ok: true, content: db.content, league: db.league });
  if (method === "GET" && p === "/api/rules") return json(res, 200, { ok: true, ...leagueRules });
  if (method === "GET" && p === "/api/about") return json(res, 200, { ok: true, ...aboutContent });
  if (method === "GET" && p === "/api/staff-profiles") {
    if (ensureAdminProfiles(db)) writeDb(db);
    return json(res, 200, {
      ok: true,
      leagueEmail: db.league?.email || LEAGUE_CONTACT_EMAIL,
      supportEmail: db.league?.supportEmail || LEAGUE_SUPPORT_EMAIL,
      messengerInvites: Array.isArray(db.league?.messengerInvites) && db.league.messengerInvites.length ? db.league.messengerInvites : LEAGUE_MESSENGER_INVITES,
      profiles: publicStaffProfiles(db),
    });
  }
  if (method === "GET" && p === "/api/stats") return json(res, 200, { ...stats(db), highlights: publicLeagueHighlights(db) });
  if (method === "GET" && p === "/api/regionals") {
    const regionals = sortedRegionals(db).map((r) => ({ ...r, leagues: leaguesForRegional(db, r) }));
    return json(res, 200, { ok: true, regionals });
  }
  if (method === "GET" && p === "/api/announcements") {
    return json(res, 200, {
      ok: true,
      announcements: db.announcements,
      canPost: isStaff(user),
      canDelete: canOverride(user),
    });
  }
  if (method === "GET" && p === "/api/ticker") return json(res, 200, await getPdcTicker(), { "Cache-Control": "public, max-age=60" });
  if ((method === "GET" || method === "HEAD") && (p === "/api/export" || p.startsWith("/api/export/"))) {
    const provided = sheetsApiKeyFrom(req, url);
    if (!sheetsExportState(db).configured) {
      return sendExport(res, 401, { ok: false, error: "No Google Sheets API key is set. Generate one from Owner desk." });
    }
    if (!sheetsApiKeyValid(db, provided)) {
      return sendExport(res, 401, { ok: false, error: "Invalid API key" });
    }
    const exportHeaders = { "Cache-Control": "no-store" };
    if (p === "/api/export" || p === "/api/export/") {
      const origin = requestOrigin(req);
      const key = sheetsExportState(db).key;
      return sendExport(res, 200, {
        ok: true,
        tables: ["players", "standings", "fixtures"],
        formats: ["csv", "json"],
        urls: sheetsExportUrls(origin, key),
        formulas: sheetsImportFormulas(origin, key),
      }, exportHeaders);
    }
    const exportMatch = /^\/api\/export\/([a-zA-Z]+)(?:\.(csv|json))?$/.exec(p);
    if (!exportMatch || !resolveSheetsTable(exportMatch[1])) {
      return sendExport(res, 404, { ok: false, error: "Unknown export table. Use players, standings, or fixtures." });
    }
    const table = exportMatch[1];
    const format = (exportMatch[2] || url.searchParams.get("format") || "json").toLowerCase();
    if (format === "csv") {
      const csv = sheetsCsv(db, table);
      return sendExport(res, 200, method === "HEAD" ? "" : csv, {
        ...exportHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `inline; filename="tsh-${table}.csv"`,
      });
    }
    return sendExport(res, 200, { ok: true, table: resolveSheetsTable(table).id, rows: sheetsRows(db, table) }, exportHeaders);
  }

  const regionalMatch = p.match(/^\/api\/regionals\/([^/]+)$/);
  if (method === "GET" && regionalMatch) {
    const regional = findRegionalBySlug(db, regionalMatch[1]);
    if (!regional) return json(res, 404, { ok: false, error: "Not found" });
    const leagues = db.leagues
      .filter((l) => l.regionalId === regional.id)
      .sort(compareLeagueOrder)
      .map((l) => ({
        ...l,
        displayName: divisionName(l),
        divisionAdmins: divisionAdminsForLeague(db, l.id).map((a) => ({ id: a.id, name: a.name, nickname: a.nickname })),
      }));
    const players = db.users.filter((u) => placedRegionalIds(db, u).includes(regional.id));
    return json(res, 200, { ok: true, regional, leagues, counts: { players: players.length, teams: 0, leagues: leagues.length } });
  }

  const leagueMatch = p.match(/^\/api\/leagues\/(\d+)$/);
  if (method === "GET" && leagueMatch) {
    const league = db.leagues.find((l) => l.id === Number(leagueMatch[1]));
    if (!league) return json(res, 404, { ok: false, error: "Not found" });
    const regional = db.regionals.find((r) => r.id === league.regionalId);
    const leagueFixtures = db.fixtures.filter((f) => f.leagueId === league.id);
    const standings = standingsForLeague(db, league.id);
    const fixtures = playerVisibleFixtures(db, leagueFixtures);
    return json(res, 200, {
      ok: true,
      league: { ...league, title: leagueTitle(db, league), displayName: divisionName(league) },
      regional,
      standings,
      divisionAdmins: divisionAdminsForLeague(db, league.id),
      fixtures,
      review: divisionReview({ divisionName: divisionName(league), standings, fixtures }),
      ...fixturePublishMeta(leagueFixtures),
    });
  }

  const playerMatch = p.match(/^\/api\/player\/(\d+)$/);
  if (method === "GET" && playerMatch) {
    const found = db.users.find((u) => u.id === Number(playerMatch[1]));
    if (!found) return json(res, 404, { ok: false, error: "Not found" });
    const playerFixtures = db.fixtures.filter((f) => f.homeId === found.id || f.awayId === found.id);
    return json(res, 200, {
      ok: true,
      player: publicUser(found, db),
      league: db.leagues.find((l) => l.id === userLeagueIds(found)[0]) || null,
      leagues: userLeagueIds(found).map((id) => db.leagues.find((l) => l.id === id)).filter(Boolean).map((l) => ({ ...l, title: leagueTitle(db, l) })),
      regional: db.regionals.find((r) => r.id === found.regionalId) || null,
      regionals: [...new Set(placedRegionalIds(db, found))].map((id) => db.regionals.find((r) => r.id === id)).filter(Boolean),
      fixtures: playerVisibleFixtures(db, playerFixtures),
      ...fixturePublishMeta(playerFixtures),
    });
  }

  if (method === "POST" && p === "/api/auth/check-signup") {
    const email = String(body.email || "").trim();
    const username = String(body.username || "").trim();
    const dartcounterName = String(body.dartcounterName || "").trim();
    if (!email && !username && !dartcounterName) {
      return json(res, 400, { ok: false, error: "Enter an email or DartCounter name to check" });
    }
    const conflict = identityConflict(db, { email, username, dartcounterName });
    if (conflict) return json(res, 400, { ok: false, error: conflict });
    return json(res, 200, { ok: true, available: true });
  }

  if (method === "POST" && p === "/api/auth/register") {
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const username = String(body.username || "").trim();
    const dartcounterName = String(body.dartcounterName || "").trim() || name;
    if (!name || !email || !password) return json(res, 400, { ok: false, error: "Name, email and password are required" });
    const conflict = identityConflict(db, { email, username, dartcounterName });
    if (conflict) return json(res, 400, { ok: false, error: conflict });
    const selection = resolveSignupSelection(db, body);
    if (selection.error) return json(res, 400, { ok: false, error: selection.error });
    const created = {
      id: Math.max(0, ...db.users.map((u) => u.id)) + 1,
      name,
      email,
      username,
      password,
      role: "player",
      roles: [],
      leagueId: null,
      leagueIds: [],
      adminLeagueId: null,
      adminLeagueIds: [],
      regionalChoice: selection.choice,
      regionalIds: selection.ids,
      regionalId: selection.primary,
      dartcounterName,
      nickname: String(body.nickname || "").trim(),
      avg: Number(String(body.avg || "0").replace(/[^0-9.]/g, "")) || 0,
      country: "",
      avatarFile: null,
      avatarUpdatedAt: null,
      notifyPrefs: { email: true },
      timezone: isValidTimeZone(body.timezone) ? body.timezone : defaultTimezoneForRegional(selection.choice),
      communityJoinPending: true,
    };
    db.users.push(created);
    db.applications.push({
      id: Math.max(0, ...db.applications.map((a) => a.id)) + 1,
      userId: created.id,
      name: created.name,
      email: created.email,
      regionalChoice: created.regionalChoice,
      regionalId: created.regionalId,
      regionalIds: created.regionalIds,
      avg: created.avg,
      dartcounterName: created.dartcounterName,
      nickname: created.nickname,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    writeDb(db);
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, created.id);
    saveSessions();
    return json(res, 200, { ok: true, token, user: publicUser(created, db) }, { "Set-Cookie": sessionCookie(token, { remember: true, req }) });
  }

  if (method === "POST" && p === "/api/auth/login") {
    const ident = String(body.email || body.username || "").trim().toLowerCase();
    const found = db.users.find((u) => {
      if (!ident || u.password !== body.password) return false;
      if (u.email.toLowerCase() === ident) return true;
      return String(u.username || "").toLowerCase() === ident;
    });
    if (!found) return json(res, 401, { ok: false, error: "Invalid username or password" });
    const remember = body.remember === true || body.remember === "1" || body.remember === "on";
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, found.id);
    saveSessions();
    return json(res, 200, { ok: true, token, user: publicUser(found, db), remember }, { "Set-Cookie": sessionCookie(token, { remember, req }) });
  }

  if (method === "POST" && p === "/api/auth/forgot-password") {
    const email = String(body.email || "").trim();
    if (!email) return json(res, 400, { ok: false, error: "Enter the email on your account" });
    const found = findUserByEmail(db, email);
    const generic = { ok: true, sent: true, message: "If that email is registered, we sent a reset code." };
    if (!found || !found.email) return json(res, 200, generic);
    const code = newResetCode();
    found.passwordReset = { code, expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS).toISOString() };
    writeDb(db);
    try {
      await sendEmail(passwordResetEmail(found, code));
    } catch (err) {
      console.error("Password reset email failed:", err);
      return json(res, 500, { ok: false, error: "Could not send the reset email. Try again in a moment." });
    }
    return json(res, 200, generic);
  }

  if (method === "POST" && p === "/api/auth/reset-password") {
    const email = String(body.email || "").trim();
    const code = String(body.code || "").replace(/\s+/g, "");
    const newPassword = String(body.newPassword || body.password || "");
    if (!email || !code) return json(res, 400, { ok: false, error: "Email and reset code are required" });
    if (newPassword.length < 6) return json(res, 400, { ok: false, error: "New password must be at least 6 characters" });
    const found = findUserByEmail(db, email);
    const reset = found?.passwordReset;
    const expiresAt = reset?.expiresAt ? Date.parse(reset.expiresAt) : NaN;
    const expired = !Number.isFinite(expiresAt) || expiresAt < Date.now();
    if (!found || !reset?.code || expired || !codesEqual(reset.code, code)) {
      return json(res, 400, { ok: false, error: "Invalid or expired reset code" });
    }
    found.password = newPassword;
    found.passwordReset = null;
    writeDb(db);
    clearSessionsForUser(found.id);
    saveSessions();
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, found.id);
    saveSessions();
    return json(res, 200, { ok: true, token, user: publicUser(found, db) }, { "Set-Cookie": sessionCookie(token, { remember: true, req }) });
  }

  if (!user && p.startsWith("/api/") && !p.startsWith("/api/auth") && !["/api/content", "/api/stats", "/api/regionals", "/api/announcements", "/api/ticker", "/api/staff-profiles", "/api/rules", "/api/about"].some((x) => p === x || p.startsWith("/api/regionals/") || p.startsWith("/api/leagues/") || p.startsWith("/api/player/"))) {
    if (["/api/my-fixtures", "/api/auth/me", "/api/auth/logout", "/api/admin", "/api/fixtures", "/api/account"].some((x) => p === x || p.startsWith(x))) {
      return json(res, 401, { ok: false, error: "Login required" });
    }
  }

  if (method === "GET" && p === "/api/auth/me") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    return json(res, 200, {
      ok: true,
      token: tokenFrom(req, url),
      user: publicUser(user, db),
      staffProfiles: ownStaffProfiles(db, user),
      ownerSlots: { used: ownerCount(db), max: MAX_OWNERS },
    });
  }
  if (method === "POST" && p === "/api/auth/logout") {
    sessions.delete(tokenFrom(req, url));
    saveSessions();
    return json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", { clear: true, req }) });
  }

  const avatarGet = p.match(/^\/api\/users\/(\d+)\/avatar$/);
  if (method === "GET" && avatarGet) {
    const found = db.users.find((u) => u.id === Number(avatarGet[1]));
    if (!found?.avatarFile) return json(res, 404, { ok: false, error: "No avatar" });
    const filePath = safeUploadPath(found.avatarFile);
    if (!filePath || !fs.existsSync(filePath)) return json(res, 404, { ok: false, error: "No avatar" });
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mime[ext] || "image/jpeg", "Cache-Control": "public, max-age=3600" });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (method === "POST" && p === "/api/account/profile") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const u = db.users.find((x) => x.id === user.id);
    const name = String(body.name || "").trim();
    if (!name) return json(res, 400, { ok: false, error: "Name is required" });
    u.name = name;
    u.nickname = String(body.nickname || "").trim();
    const dartcounterName = String(body.dartcounterName || "").trim() || u.name;
    const dcConflict = identityConflict(db, { dartcounterName }, u.id);
    if (dcConflict) return json(res, 400, { ok: false, error: dcConflict });
    u.dartcounterName = dartcounterName;
    if (body.avg !== undefined && body.avg !== "") {
      u.avg = Number(String(body.avg).replace(/[^0-9.]/g, "")) || 0;
    }
    writeDb(db);
    return json(res, 200, { ok: true, user: publicUser(u, db) });
  }

  if (method === "POST" && p === "/api/account/community-join") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const u = db.users.find((x) => x.id === user.id);
    if (!u) return json(res, 400, { ok: false, error: "Player not found" });
    u.communityJoinPending = false;
    writeDb(db);
    return json(res, 200, { ok: true, user: publicUser(u, db) });
  }

  if (method === "POST" && p === "/api/account/staff-profile") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    if (!isStaff(user)) return json(res, 403, { ok: false, error: "Only league staff can edit a contact profile" });
    let contactEmail;
    try {
      contactEmail = normalizeStaffEmail(body.contactEmail);
    } catch (err) {
      return json(res, err.status || 400, { ok: false, error: err.message });
    }
    const mine = (db.adminProfiles || []).filter((p) => Number(p.userId) === Number(user.id));
    if (!mine.length) return json(res, 400, { ok: false, error: "No staff contact profile to update" });
    const profileId = body.profileId != null && body.profileId !== "" ? Number(body.profileId) : null;
    const targets = profileId ? mine.filter((p) => p.id === profileId) : mine;
    if (profileId && !targets.length) return json(res, 404, { ok: false, error: "Profile not found" });
    for (const p of targets) {
      p.contactEmail = contactEmail;
      delete p.discordUrl;
    }
    persistDb(db);
    return json(res, 200, { ok: true, user: publicUser(user, db), staffProfiles: ownStaffProfiles(db, user) });
  }

  if (method === "POST" && p === "/api/account") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const u = db.users.find((x) => x.id === user.id);
    const email = String(body.email || "").trim();
    const username = String(body.username || "").trim();
    if (!email) return json(res, 400, { ok: false, error: "Email is required" });
    const accountConflict = identityConflict(db, { email, username }, u.id);
    if (accountConflict) return json(res, 400, { ok: false, error: accountConflict });
    const newPassword = String(body.newPassword || "");
    if (newPassword) {
      if (String(body.currentPassword || "") !== u.password) {
        return json(res, 400, { ok: false, error: "Current password is incorrect" });
      }
      if (newPassword.length < 6) return json(res, 400, { ok: false, error: "New password must be at least 6 characters" });
      u.password = newPassword;
    }
    u.email = email;
    u.username = username;
    writeDb(db);
    return json(res, 200, { ok: true, user: publicUser(u, db) });
  }

  if (method === "POST" && p === "/api/account/notifications") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const u = db.users.find((x) => x.id === user.id);
    const emailOn = !(body.email === false || body.email === "false" || body.email === 0 || body.email === "0" || body.email === "off");
    u.notifyPrefs = { ...(u.notifyPrefs || {}), email: emailOn };
    writeDb(db);
    return json(res, 200, { ok: true, user: publicUser(u, db) });
  }

  if (method === "POST" && p === "/api/account/timezone") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const u = db.users.find((x) => x.id === user.id);
    if (!isValidTimeZone(body.timezone)) return json(res, 400, { ok: false, error: "Unknown timezone" });
    u.timezone = body.timezone;
    writeDb(db);
    return json(res, 200, { ok: true, user: publicUser(u, db) });
  }

  if (method === "POST" && p === "/api/account/avatar") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const u = db.users.find((x) => x.id === user.id);
    try {
      const filename = saveDataUrlImage(body.image, `avatar-${u.id}`, 2 * 1024 * 1024);
      if (u.avatarFile && u.avatarFile !== filename) removeUpload(u.avatarFile);
      u.avatarFile = filename;
      u.avatarUpdatedAt = Date.now().toString();
    } catch (err) {
      return json(res, err.status || 400, { ok: false, error: err.message === "Image is too large" ? "Avatar must be under 2MB" : err.message });
    }
    writeDb(db);
    return json(res, 200, { ok: true, user: publicUser(u, db) });
  }
  if (method === "POST" && p === "/api/account/league-request") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const u = db.users.find((x) => x.id === user.id);
    if (!u) return json(res, 404, { ok: false, error: "Account not found" });
    const kind = String(body.kind || "").trim();
    const note = String(body.note || "").trim().slice(0, 300);
    if (kind !== "join" && kind !== "drop" && kind !== "injury") return json(res, 400, { ok: false, error: "Choose join, withdraw, or injured list" });
    let request;
    if (kind === "join") {
      const open = openJoinRegionals(db, u);
      if (!open.length) {
        return json(res, 400, { ok: false, error: SIGNUP_REGIONALS_SOON_ERROR });
      }
      const regionalId = Number(body.regionalId || (open.length === 1 ? open[0].id : 0));
      if (!open.some((r) => r.id === regionalId)) {
        return json(res, 400, { ok: false, error: "Regional leagues are coming soon. The International League is the only competition open right now." });
      }
      const addError = addCompetitionToUser(db, u, regionalId);
      if (addError) return json(res, 400, { ok: false, error: addError });
      const pendingApp = (db.applications || []).find((a) => Number(a.userId) === Number(u.id) && a.status === "pending");
      if (pendingApp) {
        pendingApp.regionalChoice = u.regionalChoice;
        pendingApp.regionalIds = u.regionalIds;
        pendingApp.regionalId = regionalId;
      } else {
        db.applications.push({
          id: Math.max(0, ...db.applications.map((a) => a.id)) + 1,
          userId: u.id,
          name: u.name,
          email: u.email,
          regionalChoice: u.regionalChoice,
          regionalId,
          regionalIds: u.regionalIds,
          avg: Number(u.avg) || 0,
          dartcounterName: u.dartcounterName || u.name,
          nickname: u.nickname || "",
          status: "pending",
          createdAt: new Date().toISOString(),
        });
      }
      request = {
        id: nextId(db.leagueRequests),
        userId: u.id,
        kind: "join",
        regionalId,
        leagueId: null,
        status: "pending",
        note,
        createdAt: new Date().toISOString(),
      };
    } else {
      const placedIds = userLeagueIds(u);
      if (!placedIds.length) return json(res, 400, { ok: false, error: "You are not in a league yet" });
      const leaveAll = body.scope === "all" || body.leagueId === "all" || body.leagueId === "" || body.leagueId == null;
      const injury = kind === "injury";
      if (leaveAll) {
        const pendingAll = pendingLeagueRequests(db, u.id, kind).some((r) => (injury ? isInjuryAllRequest(r) : isDropAllRequest(r)));
        if (pendingAll) {
          return json(res, 400, {
            ok: false,
            error: injury
              ? "You already asked to join the injured list for all leagues. An admin will review it."
              : "You already asked to withdraw from all leagues. An admin will review it.",
          });
        }
        if (injury && placedIds.every((id) => isInjuredIn(u, id))) {
          return json(res, 400, { ok: false, error: "You are already on the injured list" });
        }
        request = {
          id: nextId(db.leagueRequests),
          userId: u.id,
          kind,
          regionalId: null,
          leagueId: null,
          scope: "all",
          status: "pending",
          note,
          createdAt: new Date().toISOString(),
        };
      } else {
        const leagueId = Number(body.leagueId);
        if (!placedIds.includes(leagueId)) return json(res, 400, { ok: false, error: "You are not in that league" });
        if (pendingLeagueRequests(db, u.id, kind).some((r) => Number(r.leagueId) === leagueId)) {
          return json(res, 400, {
            ok: false,
            error: injury
              ? "You already asked to join the injured list for that league. An admin will review it."
              : "You already asked to drop from that league. An admin will review it.",
          });
        }
        if (injury && isInjuredIn(u, leagueId)) {
          return json(res, 400, { ok: false, error: "You are already on the injured list for that division" });
        }
        request = {
          id: nextId(db.leagueRequests),
          userId: u.id,
          kind,
          regionalId: leagueRegionalId(db, leagueId),
          leagueId,
          scope: "one",
          status: "pending",
          note,
          createdAt: new Date().toISOString(),
        };
      }
    }
    db.leagueRequests.push(request);
    writeDb(db);
    const view = publicLeagueRequest(request, db);
    await notifyStaffLeagueRequest(db, view, u);
    return json(res, 200, { ok: true, request: view, user: publicUser(u, db) });
  }
  if (method === "POST" && p === "/api/account/league-request/cancel") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const request = (db.leagueRequests || []).find((r) => Number(r.id) === Number(body.id) && Number(r.userId) === Number(user.id));
    if (!request || request.status !== "pending") return json(res, 404, { ok: false, error: "Request not found" });
    request.status = "cancelled";
    request.resolvedAt = new Date().toISOString();
    const u = db.users.find((x) => x.id === user.id);
    if (u && request.kind === "join") {
      const rid = Number(request.regionalId);
      if (rid && !placedRegionalIds(db, u).includes(rid)) {
        applyRegionalIds(
          db,
          u,
          userRegionalIds(u).filter((id) => id !== rid)
        );
      }
    }
    writeDb(db);
    return json(res, 200, { ok: true, user: publicUser(u, db) });
  }
  if (method === "GET" && p === "/api/my-fixtures") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const mine = db.fixtures.filter((f) => f.homeId === user.id || f.awayId === user.id);
    return json(res, 200, {
      ok: true,
      fixtures: releasedFixtures(mine).map((f) => withNames(db, f)),
      ...fixturePublishMeta(mine),
    });
  }

  const screenshotGet = p.match(/^\/api\/fixtures\/(\d+)\/screenshot$/);
  if (method === "GET" && screenshotGet) {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const fixture = db.fixtures.find((f) => f.id === Number(screenshotGet[1]));
    const slot = Number(url.searchParams.get("slot") || 1) === 2 ? 2 : 1;
    const filename = fixture ? shotFile(fixture, slot) : null;
    if (!fixture || !filename) return json(res, 404, { ok: false, error: "No screenshot" });
    const inMatch = fixture.homeId === user.id || fixture.awayId === user.id;
    if (!inMatch && !managesLeague(user, fixture.leagueId)) return json(res, 403, { ok: false, error: "Forbidden" });
    if (inMatch && !managesLeague(user, fixture.leagueId) && !isFixtureReleased(fixture)) {
      return json(res, 404, { ok: false, error: "No screenshot" });
    }
    const filePath = safeUploadPath(filename);
    if (!filePath || !fs.existsSync(filePath)) return json(res, 404, { ok: false, error: "No screenshot" });
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mime[ext] || "image/jpeg", "Cache-Control": "private, max-age=60" });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const screenshotPost = p.match(/^\/api\/my-fixtures\/(\d+)\/screenshot$/);
  if (method === "POST" && screenshotPost) {
    const owned = playerOwnedFixture(db, user, screenshotPost[1]);
    if (owned.error) return json(res, owned.status, { ok: false, error: owned.error });
    const fixture = owned.fixture;
    const blocked = screenshotUploadError(fixture, db);
    if (blocked) return json(res, 400, { ok: false, error: blocked });
    const requested = Number(body.slot);
    const slot = requested === 1 || requested === 2 ? requested : shotFile(fixture, 1) ? 2 : 1;
    if (shotFile(fixture, slot)) return json(res, 400, { ok: false, error: `Screenshot ${slot} is already uploaded` });
    try {
      applyScreenshotSlot(fixture, user, body.image, slot);
    } catch (err) {
      return json(res, err.status || 400, { ok: false, error: err.message });
    }
    if (shotCount(fixture) >= 2) {
      return json(res, 400, { ok: false, error: "Submit both screenshots together with the match stats" });
    }
    writeDb(db);
    return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
  }

  const screenshotsPost = p.match(/^\/api\/my-fixtures\/(\d+)\/screenshots$/);
  if (method === "POST" && screenshotsPost) {
    const owned = playerOwnedFixture(db, user, screenshotsPost[1]);
    if (owned.error) return json(res, owned.status, { ok: false, error: owned.error });
    const fixture = owned.fixture;
    const blocked = screenshotUploadError(fixture, db);
    if (blocked) return json(res, 400, { ok: false, error: blocked });
    if (shotCount(fixture) >= 2) return json(res, 400, { ok: false, error: "Both screenshots are already uploaded" });
    if (shotCount(fixture) > 0) return json(res, 400, { ok: false, error: "This match already has a screenshot. Submit both together on a fresh match." });
    if (!body.image1 || !body.image2) return json(res, 400, { ok: false, error: "Upload both match screenshots before submitting" });
    if (body.homeLegs == null || body.homeLegs === "" || body.awayLegs == null || body.awayLegs === "") {
      return json(res, 400, { ok: false, error: "Enter the match stats with the screenshots" });
    }
    const legsError = validateLegs(body.homeLegs, body.awayLegs);
    if (legsError) return json(res, 400, { ok: false, error: legsError });
    const extracted = pickExtractedStats(body);
    if (!hasNumericExtracted(extracted)) {
      return json(res, 400, { ok: false, error: "Enter the match stats with the screenshots" });
    }
    const saved = [];
    try {
      saved.push(applyScreenshotSlot(fixture, user, body.image1, 1));
      saved.push(applyScreenshotSlot(fixture, user, body.image2, 2));
    } catch (err) {
      for (const filename of saved) removeUpload(filename);
      fixture.screenshot1File = null;
      fixture.screenshot1By = null;
      fixture.screenshot1At = null;
      fixture.screenshot2File = null;
      fixture.screenshot2By = null;
      fixture.screenshot2At = null;
      fixture.screenshotFile = null;
      fixture.screenshotBy = null;
      fixture.screenshotAt = null;
      return json(res, err.status || 400, { ok: false, error: err.message });
    }
    const now = new Date().toISOString();
    fixture.extractedStats = {
      ...extracted,
      extractedAt: now,
      extractedBy: user.id,
      pending: true,
      source: "manual",
    };
    fixture.status = "pending_verify";
    fixture.resultSubmittedBy = user.id;
    fixture.resultSubmittedAt = now;
    fixture.opponentVerifiedBy = null;
    fixture.opponentVerifiedAt = null;
    fixture.statsDisputeNote = "";
    fixture.resubmitRequest = null;
    writeDb(db);
    return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
  }

  const extractedPost = p.match(/^\/api\/my-fixtures\/(\d+)\/extracted-stats$/);
  if (method === "POST" && extractedPost) {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const fixture = db.fixtures.find((f) => f.id === Number(extractedPost[1]));
    if (!fixture || (!isFixtureReleased(fixture) && !managesLeague(user, fixture.leagueId))) {
      return json(res, 404, { ok: false, error: "Fixture not found" });
    }
    const inMatch = fixture.homeId === user.id || fixture.awayId === user.id;
    if (!inMatch && !managesLeague(user, fixture.leagueId)) return json(res, 403, { ok: false, error: "Not your match" });
    if (!managesLeague(user, fixture.leagueId)) {
      return json(res, 403, { ok: false, error: "Players enter stats when they submit the screenshots. The other player then verifies them." });
    }
    if (fixture.status === "played") return json(res, 400, { ok: false, error: "This match is already confirmed" });
    if (body.rawText) fixture.ocrRawText = String(body.rawText).slice(0, 8000);
    const extracted = pickExtractedStats(body);
    if (!Object.keys(extracted).length) {
      writeDb(db);
      return json(res, 200, { ok: true, parsed: false, fixture: withNames(db, fixture) });
    }
    fixture.extractedStats = {
      ...extracted,
      extractedAt: new Date().toISOString(),
      extractedBy: user.id,
      pending: true,
    };
    writeDb(db);
    return json(res, 200, { ok: true, parsed: true, fixture: withNames(db, fixture) });
  }

  const proposeMatch = p.match(/^\/api\/fixtures\/(\d+)\/propose$/);
  if (method === "POST" && proposeMatch) {
    const owned = playerOwnedFixture(db, user, proposeMatch[1]);
    if (owned.error) return json(res, owned.status, { ok: false, error: owned.error });
    const fixture = owned.fixture;
    if (isByeFixture(fixture)) return json(res, 400, { ok: false, error: "This week is a bye — there is no match to schedule" });
    if (fixture.homeId !== user.id) return json(res, 403, { ok: false, error: "Only the home player can propose a date and time" });
    if (fixture.status === "played") return json(res, 400, { ok: false, error: "This match is already completed" });
    if (playerResultLocked(fixture) || shotCount(fixture) > 0) {
      return json(res, 400, { ok: false, error: "Screenshots are already in — the kickoff time cannot be changed" });
    }
    const raw = String(body.datetime || `${body.date || ""}T${body.time || ""}`);
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (!m) return json(res, 400, { ok: false, error: "Choose a date and time" });
    const proposedDate = m[1];
    const proposedTime = m[2];
    // Interpret the proposer's chosen wall-clock time in their own timezone so we
    // can store an absolute instant. Everyone then sees it in their local time.
    const tz = isValidTimeZone(body.tz) ? body.tz : user.timezone || defaultTimezoneForRegional(user.regionalChoice);
    const startAt = wallStringToUtc(proposedDate, proposedTime, tz);
    fixture.proposedDate = proposedDate;
    fixture.proposedTime = proposedTime;
    fixture.proposedBy = user.id;
    fixture.proposedAt = new Date().toISOString();
    fixture.proposedTz = tz;
    fixture.startAt = startAt ? startAt.toISOString() : null;
    fixture.scheduleStatus = "proposed";
    fixture.agreedAt = null;
    writeDb(db);
    return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
  }

  const acceptTime = p.match(/^\/api\/fixtures\/(\d+)\/accept-time$/);
  if (method === "POST" && acceptTime) {
    const owned = playerOwnedFixture(db, user, acceptTime[1]);
    if (owned.error) return json(res, owned.status, { ok: false, error: owned.error });
    const fixture = owned.fixture;
    if (isByeFixture(fixture)) return json(res, 400, { ok: false, error: "This week is a bye — there is no match to schedule" });
    if (fixture.awayId !== user.id) return json(res, 403, { ok: false, error: "Only the visiting player can accept the proposed time" });
    if (fixture.status === "played") return json(res, 400, { ok: false, error: "This match is already completed" });
    if (!fixture.proposedDate || !fixture.proposedTime || !fixture.proposedBy) {
      return json(res, 400, { ok: false, error: "No time has been proposed yet" });
    }
    if (Number(fixture.proposedBy) === user.id) {
      return json(res, 400, { ok: false, error: "The home player proposed this time — you need to accept it" });
    }
    fixture.date = fixture.proposedDate;
    fixture.time = fixture.proposedTime;
    fixture.scheduleStatus = "agreed";
    fixture.agreedAt = new Date().toISOString();
    // startAt was set when the time was proposed; recompute as a fallback.
    if (!fixture.startAt && fixture.proposedTz) {
      const s = wallStringToUtc(fixture.proposedDate, fixture.proposedTime, fixture.proposedTz);
      fixture.startAt = s ? s.toISOString() : null;
    }
    writeDb(db);
    return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
  }

  const verifyStats = p.match(/^\/api\/fixtures\/(\d+)\/verify-stats$/);
  if (method === "POST" && verifyStats) {
    const owned = playerOwnedFixture(db, user, verifyStats[1]);
    if (owned.error) return json(res, owned.status, { ok: false, error: owned.error });
    const fixture = owned.fixture;
    if (isByeFixture(fixture)) return json(res, 400, { ok: false, error: "This week is a bye — there is no match to verify" });
    if (fixture.status !== "pending_verify") {
      return json(res, 400, { ok: false, error: "There is no submitted result waiting for you to verify" });
    }
    if (Number(fixture.resultSubmittedBy) === Number(user.id)) {
      return json(res, 403, { ok: false, error: "The other player has to verify the stats you submitted" });
    }
    if (!hasNumericExtracted(fixture.extractedStats)) {
      return json(res, 400, { ok: false, error: "No stats were submitted with this result" });
    }
    const now = new Date().toISOString();
    fixture.status = "submitted";
    fixture.opponentVerifiedBy = user.id;
    fixture.opponentVerifiedAt = now;
    fixture.extractedStats = { ...fixture.extractedStats, opponentVerifiedBy: user.id, opponentVerifiedAt: now, pending: true };
    writeDb(db);
    return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
  }

  const disputeStats = p.match(/^\/api\/fixtures\/(\d+)\/dispute-stats$/);
  if (method === "POST" && disputeStats) {
    const owned = playerOwnedFixture(db, user, disputeStats[1]);
    if (owned.error) return json(res, owned.status, { ok: false, error: owned.error });
    const fixture = owned.fixture;
    if (fixture.status !== "pending_verify") {
      return json(res, 400, { ok: false, error: "There is no submitted result to send back" });
    }
    if (Number(fixture.resultSubmittedBy) === Number(user.id)) {
      return json(res, 403, { ok: false, error: "Wait for the other player to verify, or ask them to dispute if the numbers are wrong" });
    }
    fixture.statsDisputeNote = String(body.note || "").trim().slice(0, 400);
    clearResultSubmission(fixture);
    writeDb(db);
    return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
  }

  if (method === "GET" && p === "/api/fixtures/chats") {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    if (url.searchParams.get("summary") === "1") {
      return json(res, 200, { ok: true, unread: chatUnreadSummary(db, user) });
    }
    const listed = chatListFor(db, user, { markRead: true });
    if (listed.dirty) writeDb(db);
    return json(res, 200, { ok: true, chats: listed.chats });
  }

  const chatGet = p.match(/^\/api\/fixtures\/(\d+)\/chat$/);
  if (chatGet && (method === "GET" || method === "POST")) {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    const found = chatFixtureResponse(db, user, chatGet[1]);
    if (found.error) return json(res, found.status, { ok: false, error: found.error });
    const fixture = found.fixture;
    if (method === "GET") {
      const chat = publicFixtureChat(db, user, fixture, { markRead: true });
      if (userInFixture(fixture, user) && found.phase === "open") writeDb(db);
      return json(res, 200, { ok: true, chat });
    }
    if (!canPostFixtureChat(fixture, user, found.scope)) {
      if (found.phase === "locked") {
        return json(res, 403, { ok: false, error: "This chat is locked while the result waits for admin approval" });
      }
      return json(res, 403, { ok: false, error: "Only the two players in a pending match can send a message" });
    }
    const cleaned = cleanChatBody(body.body ?? body.text);
    if (cleaned.error) return json(res, 400, { ok: false, error: cleaned.error });
    if (messagesForFixture(db, fixture.id).length >= CHAT_MAX_MESSAGES) {
      return json(res, 400, { ok: false, error: "This chat is full" });
    }
    const now = new Date();
    db.matchChats.push({
      id: nextId(db.matchChats),
      fixtureId: fixture.id,
      userId: user.id,
      body: cleaned.text,
      createdAt: now.toISOString(),
    });
    markChatRead(db, fixture.id, user.id, now);
    const opponentId = Number(fixture.homeId) === Number(user.id) ? fixture.awayId : fixture.homeId;
    const opponent = db.users.find((item) => Number(item.id) === Number(opponentId));
    let email = null;
    if (opponent && wantsMatchEmail(opponent) && chatEmailDue(db, fixture.id, opponent.id, now)) {
      noteChatEmail(db, fixture.id, opponent.id, now);
      const leagueName = leagueTitle(db, db.leagues.find((league) => league.id === fixture.leagueId) || { name: "your league", regionalId: 0 });
      const preview = cleaned.text.length > 160 ? `${cleaned.text.slice(0, 157)}...` : cleaned.text;
      email = matchChatEmail(opponent, user, fixture, leagueName, preview);
    }
    writeDb(db);
    if (email) Promise.resolve(sendEmail(email)).catch((err) => console.error("Match chat email failed:", err));
    return json(res, 200, { ok: true, chat: publicFixtureChat(db, user, fixture), notified: Boolean(email) });
  }

  if (p.startsWith("/api/admin")) {
    if (!user) return json(res, 401, { ok: false, error: "Login required" });
    if (!isStaff(user)) return json(res, 403, { ok: false, error: "Forbidden" });
    if (method === "GET" && p === "/api/admin/me") return json(res, 200, { ok: true, user: publicUser(user, db) });
    if (method === "GET" && p === "/api/admin/activity") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Forbidden" });
      return json(res, 200, { ok: true, ...staffLogPayload(db) });
    }
    if (method === "GET" && p === "/api/admin/notifications/config") {
      return json(res, 200, { ok: true, ...emailConfigStatus() });
    }
    if (method === "GET" && p === "/api/admin/backup") {
      if (!canOverride(user)) return json(res, 403, { ok: false, error: "Only owners and head admins can view backups" });
      return json(res, 200, { ok: true, ...(await backupOverview()) });
    }
    if (method === "POST" && p === "/api/admin/backup/run") {
      if (!canOverride(user)) return json(res, 403, { ok: false, error: "Only owners and head admins can run a backup" });
      const result = await runOffsiteSync(db, { source: "manual" });
      const ok = Boolean(result.postgres || result.airtable);
      return json(res, ok ? 200 : 400, { ok, ...result });
    }
    if (method === "POST" && p === "/api/admin/backup/restore") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can restore from Postgres" });
      if (!postgresConfigured()) return json(res, 400, { ok: false, error: "DATABASE_URL is not set" });
      try {
        const snap = await loadPostgresSnapshot(body.id);
        if (!snap?.payload) return json(res, 404, { ok: false, error: "Snapshot not found" });
        writeJson(dbPath, snap.payload);
        migrate(readDb());
        const restored = readDb();
        return json(res, 200, { ok: true, restoredId: snap.id, users: (restored.users || []).length });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err.message || err) });
      }
    }
    if (method === "GET" && p === "/api/admin/export-key") {
      if (!canOverride(user)) return json(res, 403, { ok: false, error: "Only owners and head admins can manage the Google Sheets key" });
      return json(res, 200, sheetsKeyPayload(requestOrigin(req), sheetsExportState(db)));
    }
    if (method === "POST" && p === "/api/admin/export-key") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can generate the Google Sheets key" });
      const state = setSheetsApiKey(db, { userId: user.id });
      persistDb(db);
      return json(res, 200, sheetsKeyPayload(requestOrigin(req), state));
    }
    if (method === "POST" && p === "/api/admin/export-key/revoke") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can revoke the Google Sheets key" });
      clearSheetsApiKey(db);
      persistDb(db);
      return json(res, 200, { ok: true, configured: false, key: "", createdAt: "" });
    }
    if (method === "POST" && p === "/api/admin/notifications/test") {
      const to = String(body.email || user.email || "").trim();
      if (!to) return json(res, 400, { ok: false, error: "No email address to send to" });
      const cfg = emailConfigStatus();
      try {
        const r = await sendEmail({
          to,
          subject: "TSH Darts League — test notification",
          html: "<p>This is a test email from TSH Darts League. If you received it, match notifications are configured correctly.</p>",
          type: "test",
        });
        return json(res, 200, { ok: true, sent: !r.dev, dev: Boolean(r.dev), configured: cfg.configured, from: cfg.from, warning: cfg.warning, to });
      } catch (err) {
        return json(res, 200, { ok: false, error: String(err.message || err), configured: cfg.configured, from: cfg.from, warning: cfg.warning, to });
      }
    }
    if (method === "GET" && p === "/api/admin/overview") {
      const leagues = scopedLeagues(db, user).map((l) => ({ ...l, title: leagueTitle(db, l) }));
      const fixtures = scopedFixtures(db, user).map((f) => withNames(db, f));
      const adminIds = adminLeagueIds(user);
      const users = canOverride(user)
        ? db.users.map((u) => publicUser(u, db))
        : db.users
            .filter((u) => {
              if (adminIds.some((id) => inLeague(u, id)) || u.id === user.id) return true;
              if (isOwner(u)) return false;
              return scopedLeagues(db, user).some((league) => {
                if (!userRegionalIds(u).includes(league.regionalId)) return false;
                return !placedRegionalIds(db, u).includes(league.regionalId);
              });
            })
            .map((u) => publicUser(u, db));
      const enrichApp = (a) => {
        const applicant = db.users.find((x) => x.id === a.userId);
        return {
          ...a,
          placedLeagues: applicant ? publicUser(applicant, db).leagueTitles : [],
          fullyPlaced: applicant ? isFullyPlaced(db, applicant) : false,
        };
      };
      const applications = (canOverride(user) ? db.applications : db.applications.filter((a) => {
        const regionals = new Set(scopedLeagues(db, user).map((l) => l.regionalId));
        return regionals.has(a.regionalId) || (a.regionalIds || []).some((id) => regionals.has(id));
      }))
        .map(enrichApp)
        .filter((a) => {
          if (a.fullyPlaced) return false;
          if (canOverride(user)) return true;
          const applicant = db.users.find((x) => x.id === a.userId);
          if (!applicant) return true;
          return scopedLeagues(db, user).some((league) => !placedRegionalIds(db, applicant).includes(league.regionalId));
        });
      const visibleApprovals = db.approvals
        .filter((a) => {
          if (a.requestedById === user.id) return true;
          if (a.kind === "remove_owner") return user.id === a.targetUserId;
          if (a.kind === "remove_division_admin") return isOwner(user);
          return false;
        })
        .map((a) => ({
          ...publicApproval(a, db),
          canApprove: a.kind === "remove_owner" ? isOwner(user) && user.id === a.targetUserId : isOwner(user),
          mine: a.requestedById === user.id,
        }));
      if (syncInjuryVacancies(db)) writeDb(db);
      return json(res, 200, {
        ok: true,
        stats: stats(db),
        me: publicUser(user, db),
        isOwner: isOwner(user),
        isHeadAdmin: isHeadAdmin(user),
        canOverride: canOverride(user),
        ownerSlots: { used: ownerCount(db), max: MAX_OWNERS },
        users,
        owners: db.users.filter((u) => isOwner(u)).map((u) => publicUser(u, db)),
        headAdmins: db.users.filter((u) => isHeadAdmin(u)).map((u) => publicUser(u, db)),
        leagueAdmins: db.users.flatMap((u) =>
          adminLeagueIds(u).map((id) => ({
            ...publicUser(u, db),
            adminLeagueId: id,
            adminLeagueTitle: leagueTitle(db, db.leagues.find((l) => l.id === id) || { name: "Unassigned", regionalId: 0 }),
          }))
        ),
        approvals: visibleApprovals,
        applications,
        leagueRequests: visibleLeagueRequests(db, user),
        backup: canOverride(user)
          ? { postgresConfigured: postgresConfigured(), airtableConfigured: airtableConfigured() }
          : null,
        leagues,
        allLeagues: [...db.leagues].sort(compareLeagueOrder).map((l) => ({ ...l, title: leagueTitle(db, l) })),
        openSeats: publicOpenSeats(db, user),
        fixtures,
        structure: isOwner(user) ? publicStructure(db) : null,
      });
    }
    if (method === "POST" && p === "/api/admin/structure/regionals") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can add a region" });
      const name = String(body.name || "").trim();
      if (!name) return json(res, 400, { ok: false, error: "Enter a region or league name" });
      if (!Array.isArray(db.regionals)) db.regionals = [];
      const slug = uniqueRegionalSlug(db, body.slug || name);
      const comingSoon = !("comingSoon" in body) ? true : truthyFlag(body.comingSoon);
      const sortOrder = Number.isFinite(Number(body.sortOrder))
        ? Number(body.sortOrder)
        : Math.max(0, ...(db.regionals || []).map((r) => Number(r.sortOrder) || 0)) + 1;
      const regional = {
        id: nextUnusedId(db.regionals),
        slug,
        flag: String(body.flag || defaultRegionalFlag(name)).trim().slice(0, 4) || defaultRegionalFlag(name),
        emoji: String(body.emoji || "🎯").trim().slice(0, 8) || "🎯",
        name,
        fullTitle: String(body.fullTitle || `TSH ${name}`).trim() || `TSH ${name}`,
        region: String(body.region || name).trim() || name,
        description: String(body.description || `${name} in The Social Hub Darts League.`).trim(),
        active: !comingSoon,
        comingSoon,
        sortOrder,
      };
      db.regionals.push(regional);
      recordStaff(db, user, "add_region", { summary: `Added region ${regional.name}` });
      persistDb(db);
      return json(res, 200, { ok: true, regional, structure: publicStructure(db) });
    }
    if (method === "POST" && p === "/api/admin/structure/regionals/update") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can update a region" });
      const regional = (db.regionals || []).find((r) => Number(r.id) === Number(body.id));
      if (!regional) return json(res, 400, { ok: false, error: "Region not found" });
      if (body.name != null) {
        const name = String(body.name || "").trim();
        if (!name) return json(res, 400, { ok: false, error: "Enter a region or league name" });
        regional.name = name;
        if (body.fullTitle == null) regional.fullTitle = isInternationalRegional(regional) ? regional.fullTitle : `TSH ${name}`;
      }
      if (body.fullTitle != null) regional.fullTitle = String(body.fullTitle).trim() || regional.fullTitle;
      if (body.region != null) regional.region = String(body.region).trim() || regional.region;
      if (body.description != null) regional.description = String(body.description);
      if (body.emoji != null) regional.emoji = String(body.emoji).trim().slice(0, 8) || regional.emoji;
      if (body.flag != null) regional.flag = String(body.flag).trim().slice(0, 4) || regional.flag;
      if ("comingSoon" in body) {
        if (isInternationalRegional(regional)) {
          return json(res, 400, { ok: false, error: "The International League stays open" });
        }
        regional.comingSoon = truthyFlag(body.comingSoon);
        regional.active = !regional.comingSoon;
      }
      recordStaff(db, user, "update_region", { summary: `Updated region ${regional.name}` });
      persistDb(db);
      return json(res, 200, { ok: true, regional, structure: publicStructure(db) });
    }
    if (method === "POST" && p === "/api/admin/structure/regionals/delete") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can remove a region" });
      const regional = (db.regionals || []).find((r) => Number(r.id) === Number(body.id));
      if (!regional) return json(res, 400, { ok: false, error: "Region not found" });
      if (isInternationalRegional(regional)) {
        return json(res, 400, { ok: false, error: "The International League cannot be removed" });
      }
      const regionalName = regional.name;
      wipeRegional(db, regional.id);
      recordStaff(db, user, "delete_region", { summary: `Removed region ${regionalName}` });
      persistDb(db);
      return json(res, 200, { ok: true, structure: publicStructure(db) });
    }
    if (method === "POST" && p === "/api/admin/structure/leagues") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can add a division" });
      const regional = (db.regionals || []).find((r) => Number(r.id) === Number(body.regionalId));
      if (!regional) return json(res, 400, { ok: false, error: "Choose a region" });
      if (!Array.isArray(db.leagues)) db.leagues = [];
      const siblings = db.leagues.filter((l) => Number(l.regionalId) === Number(regional.id));
      const name = String(body.name || "").trim() || `Division ${siblings.length + 1}`;
      if (siblings.some((l) => String(l.name || "").trim().toLowerCase() === name.toLowerCase())) {
        return json(res, 400, { ok: false, error: "That division already exists in this region" });
      }
      const league = {
        id: nextUnusedId(db.leagues),
        regionalId: regional.id,
        name,
        format: String(body.format || "Best of 9").trim() || "Best of 9",
        sortOrder: Number.isFinite(Number(body.sortOrder))
          ? Number(body.sortOrder)
          : Math.max(-1, ...siblings.map((l) => Number(l.sortOrder) || 0)) + 1,
      };
      db.leagues.push(league);
      recordStaff(db, user, "add_division", {
        summary: `Added division ${leagueTitle(db, league)}`,
        leagueId: league.id,
      });
      persistDb(db);
      return json(res, 200, { ok: true, league: { ...league, title: leagueTitle(db, league), displayName: divisionName(league) }, structure: publicStructure(db) });
    }
    if (method === "POST" && p === "/api/admin/structure/leagues/update") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can rename a division" });
      const league = (db.leagues || []).find((l) => Number(l.id) === Number(body.id));
      if (!league) return json(res, 400, { ok: false, error: "Division not found" });
      const name = String(body.name || "").trim();
      if (!name) return json(res, 400, { ok: false, error: "Enter a division name" });
      if (name.length > 40) return json(res, 400, { ok: false, error: "Division name must be 40 characters or fewer" });
      const siblings = (db.leagues || []).filter(
        (l) => Number(l.regionalId) === Number(league.regionalId) && Number(l.id) !== Number(league.id)
      );
      const taken = siblings.some((l) => divisionName(l).toLowerCase() === divisionName({ name }).toLowerCase());
      if (taken) return json(res, 400, { ok: false, error: "That division already exists in this region" });
      if (league.name !== name) {
        const previous = leagueTitle(db, league);
        league.name = name;
        recordStaff(db, user, "rename_division", {
          summary: `Renamed division ${previous} to ${leagueTitle(db, league)}`,
          leagueId: league.id,
        });
        persistDb(db);
      }
      return json(res, 200, {
        ok: true,
        league: { ...league, title: leagueTitle(db, league), displayName: divisionName(league) },
        structure: publicStructure(db),
      });
    }
    if (method === "POST" && p === "/api/admin/structure/leagues/delete") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can remove a division" });
      const league = (db.leagues || []).find((l) => Number(l.id) === Number(body.id));
      if (!league) return json(res, 400, { ok: false, error: "Division not found" });
      const regional = (db.regionals || []).find((r) => Number(r.id) === Number(league.regionalId));
      const siblingCount = (db.leagues || []).filter((l) => Number(l.regionalId) === Number(league.regionalId)).length;
      if (isInternationalRegional(regional) && siblingCount <= 1) {
        return json(res, 400, { ok: false, error: "The International League must keep at least one division" });
      }
      const removedTitle = leagueTitle(db, league);
      wipeLeague(db, league.id);
      recordStaff(db, user, "delete_division", {
        summary: `Removed division ${removedTitle}`,
        leagueId: league.id,
      });
      persistDb(db);
      return json(res, 200, { ok: true, structure: publicStructure(db) });
    }
    if (method === "POST" && p === "/api/admin/assign-owner") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can do this" });
      if (ownerCount(db) >= MAX_OWNERS) return json(res, 400, { ok: false, error: `There can only be ${MAX_OWNERS} owners` });
      const u = db.users.find((x) => x.id === Number(body.userId));
      if (!u) return json(res, 400, { ok: false, error: "Player not found" });
      if (isOwner(u)) return json(res, 400, { ok: false, error: "Already an owner" });
      addRole(u, "owner");
      recordStaff(db, user, "assign_owner", {
        summary: `Made ${u.name} an owner`,
        targetUserId: u.id,
      });
      persistDb(db);
      return json(res, 200, { ok: true, user: publicUser(u, db) });
    }
    if (method === "POST" && p === "/api/admin/assign-admin") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can assign division admins" });
      const u = db.users.find((x) => x.id === Number(body.userId));
      const league = db.leagues.find((l) => l.id === Number(body.leagueId));
      if (!u || !league) return json(res, 400, { ok: false, error: "Choose a registered player and a league" });
      if (adminLeagueIds(u).includes(league.id)) return json(res, 400, { ok: false, error: "Already the admin of that division" });
      u.adminLeagueIds = [...adminLeagueIds(u), league.id];
      syncAdminLeagues(u);
      recordStaff(db, user, "assign_admin", {
        summary: `Assigned ${u.name} as Division Admin of ${leagueTitle(db, league)}`,
        leagueId: league.id,
        targetUserId: u.id,
      });
      persistDb(db);
      return json(res, 200, { ok: true, user: publicUser(u, db) });
    }
    if (method === "POST" && p === "/api/admin/assign-head-admin") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can assign head admins" });
      const u = db.users.find((x) => x.id === Number(body.userId));
      if (!u) return json(res, 400, { ok: false, error: "Player not found" });
      if (isHeadAdmin(u)) return json(res, 400, { ok: false, error: "Already a head admin" });
      addRole(u, "head_admin");
      recordStaff(db, user, "assign_head_admin", {
        summary: `Made ${u.name} a Head Admin`,
        targetUserId: u.id,
      });
      persistDb(db);
      return json(res, 200, { ok: true, user: publicUser(u, db) });
    }
    if (method === "POST" && p === "/api/admin/revoke-admin") {
      const u = db.users.find((x) => x.id === Number(body.userId));
      if (!u) return json(res, 400, { ok: false, error: "Player not found" });
      const which = String(body.role || "admin");
      if (which === "head_admin") {
        if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can remove Head Admins" });
        if (!isHeadAdmin(u)) return json(res, 400, { ok: false, error: "Not a head admin" });
        removeRole(u, "head_admin");
        recordStaff(db, user, "revoke_head_admin", {
          summary: `Removed ${u.name} as Head Admin`,
          targetUserId: u.id,
        });
        persistDb(db);
        return json(res, 200, { ok: true, user: publicUser(u, db) });
      }
      if (which === "owner") {
        // Owners can never be removed directly. Only another owner may request it,
        // and it takes effect solely after the targeted owner approves it.
        if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can remove owners" });
        if (!isOwner(u)) return json(res, 400, { ok: false, error: "Not an owner" });
        if (u.id === user.id) return json(res, 400, { ok: false, error: "You cannot remove yourself as an owner" });
        if (db.approvals.some((a) => a.kind === "remove_owner" && a.targetUserId === u.id)) {
          return json(res, 400, { ok: false, error: "That owner already has a removal request awaiting their approval" });
        }
        const request = { id: nextId(db.approvals), kind: "remove_owner", targetUserId: u.id, leagueId: null, requestedById: user.id, createdAt: new Date().toISOString() };
        db.approvals.push(request);
        recordStaff(db, user, "request_remove_owner", {
          summary: `Asked ${u.name} to approve owner removal`,
          targetUserId: u.id,
        });
        writeDb(db);
        return json(res, 200, { ok: true, pending: true, approval: publicApproval(request, db) });
      }
      // Division Admin removal.
      if (!isDivisionAdmin(u)) return json(res, 400, { ok: false, error: "Not a division admin" });
      const leagueId = Number(body.leagueId || u.adminLeagueId);
      if (isOwner(user)) {
        u.adminLeagueIds = adminLeagueIds(u).filter((id) => id !== leagueId);
        if (!leagueId) u.adminLeagueIds = [];
        syncAdminLeagues(u);
        recordStaff(db, user, "revoke_admin", {
          summary: `Removed ${u.name} as Division Admin`,
          leagueId: leagueId || null,
          targetUserId: u.id,
        });
        persistDb(db);
        return json(res, 200, { ok: true, user: publicUser(u, db) });
      }
      if (isHeadAdmin(user)) {
        // A Head Admin can only request the removal; an owner must approve it.
        if (db.approvals.some((a) => a.kind === "remove_division_admin" && a.targetUserId === u.id && Number(a.leagueId) === leagueId)) {
          return json(res, 400, { ok: false, error: "That removal is already awaiting an owner's approval" });
        }
        const request = { id: nextId(db.approvals), kind: "remove_division_admin", targetUserId: u.id, leagueId: leagueId || null, requestedById: user.id, createdAt: new Date().toISOString() };
        db.approvals.push(request);
        recordStaff(db, user, "request_remove_admin", {
          summary: `Requested removal of ${u.name} as Division Admin`,
          leagueId: leagueId || null,
          targetUserId: u.id,
        });
        writeDb(db);
        return json(res, 200, { ok: true, pending: true, approval: publicApproval(request, db) });
      }
      return json(res, 403, { ok: false, error: "You cannot remove Division Admins" });
    }
    if (method === "POST" && /^\/api\/admin\/approvals\/\d+\/(approve|reject)$/.test(p)) {
      const m = p.match(/^\/api\/admin\/approvals\/(\d+)\/(approve|reject)$/);
      const id = Number(m[1]);
      const action = m[2];
      const idx = db.approvals.findIndex((a) => a.id === id);
      if (idx === -1) return json(res, 404, { ok: false, error: "Request not found" });
      const a = db.approvals[idx];
      const target = db.users.find((x) => x.id === a.targetUserId);
      const isApprover = a.kind === "remove_owner" ? isOwner(user) && user.id === a.targetUserId : isOwner(user);
      const isRequester = user.id === a.requestedById;
      if (action === "reject") {
        if (!isApprover && !isRequester) return json(res, 403, { ok: false, error: "You cannot dismiss this request" });
        db.approvals.splice(idx, 1);
        recordStaff(db, user, "reject_removal", {
          summary: `Dismissed ${a.kind === "remove_owner" ? "owner" : "admin"} removal${target ? ` for ${target.name}` : ""}`,
          targetUserId: a.targetUserId,
          leagueId: a.leagueId || null,
        });
        writeDb(db);
        return json(res, 200, { ok: true, dismissed: true });
      }
      if (!isApprover) {
        return json(res, 403, { ok: false, error: a.kind === "remove_owner" ? "Only the owner being removed can approve this" : "Only owners can approve this" });
      }
      if (!target) {
        db.approvals.splice(idx, 1);
        writeDb(db);
        return json(res, 400, { ok: false, error: "That player no longer exists" });
      }
      if (a.kind === "remove_owner") {
        if (isOwner(target)) removeRole(target, "owner");
      } else {
        const leagueId = Number(a.leagueId);
        target.adminLeagueIds = adminLeagueIds(target).filter((lid) => lid !== leagueId);
        if (!leagueId) target.adminLeagueIds = [];
        syncAdminLeagues(target);
      }
      db.approvals.splice(idx, 1);
      recordStaff(db, user, "approve_removal", {
        summary: `Approved ${a.kind === "remove_owner" ? "owner" : "admin"} removal of ${target.name}`,
        targetUserId: target.id,
        leagueId: a.leagueId || null,
      });
      persistDb(db);
      return json(res, 200, { ok: true, user: publicUser(target, db) });
    }
    if (method === "POST" && p === "/api/admin/league-requests/resolve") {
      const request = (db.leagueRequests || []).find((r) => Number(r.id) === Number(body.id));
      if (!request || request.status !== "pending") return json(res, 404, { ok: false, error: "Request not found" });
      const action = String(body.action || "").trim();
      if (action !== "done" && action !== "dismiss") return json(res, 400, { ok: false, error: "Choose done or dismiss" });
      const u = db.users.find((x) => x.id === request.userId);
      if (!u) return json(res, 404, { ok: false, error: "Player not found" });
      const visible = visibleLeagueRequests(db, user).some((r) => r.id === request.id);
      if (!visible) return json(res, 403, { ok: false, error: "Not your request to review" });
      if (action === "dismiss") {
        if (!canOverride(user)) return json(res, 403, { ok: false, error: "Only owners and head admins can dismiss a request" });
        request.status = "dismissed";
        request.resolvedAt = new Date().toISOString();
        request.resolvedById = user.id;
        recordStaff(db, user, "dismiss_request", {
          summary: `Dismissed ${request.kind} request from ${u.name}`,
          targetUserId: u.id,
          leagueId: request.leagueId || null,
        });
        writeDb(db);
        return json(res, 200, { ok: true, user: publicUser(u, db) });
      }
      let droppedByes = 0;
      if (request.kind === "drop") {
        if (!canOverride(user)) return json(res, 403, { ok: false, error: "Only owners and head admins can drop a player from a league" });
        if (isDropAllRequest(request)) {
          unplaceUserFromLeagues(u);
          droppedByes = vacatePlayerFixtures(db, u, 0);
        } else {
          const leagueId = Number(request.leagueId);
          if (userLeagueIds(u).includes(leagueId)) {
            unplaceUserFromLeagues(u, leagueId);
            droppedByes = vacatePlayerFixtures(db, u, leagueId);
          }
        }
        for (const appn of db.applications.filter((a) => a.userId === u.id)) {
          appn.status = isFullyPlaced(db, u) ? "placed" : "pending";
        }
      } else if (request.kind === "injury") {
        if (!canOverride(user)) return json(res, 403, { ok: false, error: "Only owners and head admins can place a player on the injured list" });
        const marked = markPlayerInjured(db, u, isInjuryAllRequest(request) ? 0 : Number(request.leagueId));
        if (marked.error) return json(res, 400, { ok: false, error: marked.error });
        droppedByes = marked.byes || 0;
      } else if (request.kind === "join") {
        if (!placedRegionalIds(db, u).includes(Number(request.regionalId))) {
          return json(res, 400, { ok: false, error: "Place them in that regional first, then mark this done." });
        }
      }
      request.status = "done";
      request.resolvedAt = new Date().toISOString();
      request.resolvedById = user.id;
      resolveMatchingLeagueRequests(db, u);
      recordStaff(db, user, request.kind === "injury" ? "injury_list" : "resolve_request", {
        summary: request.kind === "injury" ? `Placed ${u.name} on the injured list` : `Marked ${request.kind} request from ${u.name} done`,
        targetUserId: u.id,
        leagueId: request.leagueId || null,
      });
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(u, db), byes: droppedByes, kind: request.kind });
    }
    if (method === "POST" && p === "/api/admin/injury") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can update the injured list" });
      const u = db.users.find((x) => x.id === Number(body.userId));
      if (!u) return json(res, 400, { ok: false, error: "Player not found" });
      const rawLeague = body.leagueId;
      const leagueId = rawLeague === "" || rawLeague == null || rawLeague === "all" ? 0 : Number(rawLeague);
      const marked = markPlayerInjured(db, u, leagueId);
      if (marked.error) return json(res, 400, { ok: false, error: marked.error });
      if (marked.already) return json(res, 400, { ok: false, error: "Already on the injured list for that division" });
      resolveMatchingLeagueRequests(db, u);
      recordStaff(db, user, "injury_list", {
        summary: `Placed ${u.name} on the injured list`,
        targetUserId: u.id,
        leagueId: leagueId || null,
      });
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(u, db), byes: marked.byes || 0 });
    }
    if (method === "POST" && p === "/api/admin/injury/clear") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can update the injured list" });
      const u = db.users.find((x) => x.id === Number(body.userId));
      if (!u) return json(res, 400, { ok: false, error: "Player not found" });
      const rawLeague = body.leagueId;
      const leagueId = rawLeague === "" || rawLeague == null || rawLeague === "all" ? 0 : Number(rawLeague);
      const cleared = clearPlayerInjury(db, u, leagueId);
      if (cleared.error) return json(res, 400, { ok: false, error: cleared.error });
      recordStaff(db, user, "clear_injury", {
        summary: `Returned ${u.name} from the injured list`,
        targetUserId: u.id,
        leagueId: leagueId || null,
      });
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(u, db), restored: cleared.restored || 0 });
    }
    if (method === "POST" && p === "/api/admin/place-player") {
      const u = db.users.find((x) => x.id === Number(body.userId));
      const league = db.leagues.find((l) => l.id === Number(body.leagueId));
      if (!u || !league) return json(res, 400, { ok: false, error: "Invalid player or league" });
      if (!managesLeague(user, league.id)) return json(res, 403, { ok: false, error: "You can only place players in your league" });
      const beforeLeagues = userLeagueIds(u);
      const alreadyThere = beforeLeagues.includes(Number(league.id));
      const placeError = placeUserInLeague(db, u, league);
      if (placeError) return json(res, 400, { ok: false, error: placeError });
      const afterLeagues = userLeagueIds(u);
      for (const id of beforeLeagues) {
        if (!afterLeagues.includes(id)) vacatePlayerFixtures(db, u, id, { keepPlayed: true });
      }
      syncInjuryVacancies(db);
      const filledSeat = alreadyThere ? null : claimVacantSeat(db, u, league.id);
      const apps = db.applications.filter((a) => a.userId === u.id || a.id === Number(body.applicationId));
      for (const appn of apps) {
        appn.status = isFullyPlaced(db, u) ? "placed" : "pending";
      }
      resolveMatchingLeagueRequests(db, u);
      recordStaff(db, user, "place_player", {
        summary: filledSeat
          ? `Placed ${u.name} in ${leagueTitle(db, league)}, taking over ${takenSeatPhrase(filledSeat)}`
          : `Placed ${u.name} in ${leagueTitle(db, league)}`,
        leagueId: league.id,
        targetUserId: u.id,
      });
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(u, db), fullyPlaced: isFullyPlaced(db, u), filledSeat });
    }
    if (method === "POST" && p === "/api/admin/fixtures") {
      const leagueId = Number(body.leagueId);
      if (!managesLeague(user, leagueId)) return json(res, 403, { ok: false, error: "You can only create fixtures in your league" });
      const homeBye = String(body.homeId || "").trim().toLowerCase() === "bye";
      const awayBye = String(body.awayId || "").trim().toLowerCase() === "bye";
      if (homeBye && awayBye) return json(res, 400, { ok: false, error: "A bye needs one player" });
      let home = null;
      let away = null;
      if (homeBye || awayBye) {
        const player = db.users.find((x) => x.id === Number(homeBye ? body.awayId : body.homeId));
        if (!player) return json(res, 400, { ok: false, error: "Choose the player who has the bye" });
        if (!inLeague(player, leagueId)) return json(res, 400, { ok: false, error: "That player must already be placed in that league" });
        if (isInjuredIn(player, leagueId)) return json(res, 400, { ok: false, error: "That player is on the injured list" });
        if (homeBye) away = player;
        else home = player;
      } else {
        home = db.users.find((x) => x.id === Number(body.homeId));
        away = db.users.find((x) => x.id === Number(body.awayId));
        if (!home || !away || home.id === away.id) return json(res, 400, { ok: false, error: "Choose two different players" });
        if (!inLeague(home, leagueId) || !inLeague(away, leagueId)) {
          return json(res, 400, { ok: false, error: "Both players must already be placed in that league" });
        }
        if (isInjuredIn(home, leagueId) || isInjuredIn(away, leagueId)) {
          return json(res, 400, { ok: false, error: "That player is on the injured list" });
        }
      }
      const bye = homeBye || awayBye;
      const fixture = newFixture({
        id: Math.max(0, ...db.fixtures.map((f) => f.id)) + 1,
        leagueId,
        week: Number(body.week) || 1,
        season: Number(body.season) || 1,
        homeId: home?.id || null,
        awayId: away?.id || null,
        bye,
        status: bye ? "bye" : "scheduled",
        date: body.date || new Date().toISOString().slice(0, 10),
        time: bye ? "" : String(body.time || "").slice(0, 5),
        skipVisitorAccept: bye ? false : flagOn(body.skipVisitorAccept),
        weekStart: body.date || new Date().toISOString().slice(0, 10),
      });
      db.fixtures.push(fixture);
      const homeLabel = homeBye ? "Bye" : shotByName(db, home.id);
      const awayLabel = awayBye ? "Bye" : shotByName(db, away.id);
      recordStaff(db, user, "create_fixture", {
        summary: bye
          ? `Added a bye for ${home?.name || away?.name} (week ${fixture.week})`
          : `Created ${homeLabel} vs ${awayLabel} (week ${fixture.week})`,
        leagueId,
        fixtureId: fixture.id,
      });
      writeDb(db);
      return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
    }
    if (method === "POST" && p === "/api/admin/fixtures/generate") {
      const leagueId = Number(body.leagueId);
      if (!managesLeague(user, leagueId)) return json(res, 403, { ok: false, error: "You can only generate fixtures in your league" });
      const league = db.leagues.find((l) => l.id === leagueId);
      if (!league) return json(res, 400, { ok: false, error: "League not found" });
      const roster = db.users.filter((u) => inLeague(u, leagueId));
      const players = roster.filter((u) => !isInjuredIn(u, leagueId));
      if (players.length < 2) {
        return json(res, 400, {
          ok: false,
          error:
            roster.length >= 2
              ? "Not enough players are available. Players on the injured list keep their spot and are left out of this draw."
              : "Place at least two players in this league first",
        });
      }
      const season = Number(body.season) || 1;
      // One season of fixtures per league. Block generating a different season
      // while another season's fixtures still exist (clear them first).
      const otherSeasons = [
        ...new Set(db.fixtures.filter((f) => f.leagueId === leagueId).map((f) => Number(f.season || 1))),
      ].filter((s) => s !== season);
      if (otherSeasons.length) {
        return json(res, 400, {
          ok: false,
          error: `This league already has Season ${otherSeasons.join(", ")} fixtures. Only one season per league is allowed — clear the existing fixtures before generating Season ${season}.`,
        });
      }
      const doubleRound = body.doubleRound === true || body.doubleRound === "1" || body.doubleRound === "on";
      const replaceScheduled = body.replaceScheduled === true || body.replaceScheduled === "1" || body.replaceScheduled === "on";
      const startDate = String(body.startDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const weekGapDays = 7;
      if (replaceScheduled) {
        const keep = [];
        const removedIds = [];
        for (const f of db.fixtures) {
          if (f.leagueId === leagueId && Number(f.season || 1) === season && f.status === "scheduled" && shotCount(f) === 0) {
            removedIds.push(f.id);
            continue;
          }
          keep.push(f);
        }
        db.fixtures = keep;
        forgetFixtureSeats(db, removedIds);
      }
      const existing = new Set(
        db.fixtures
          .filter((f) => f.leagueId === leagueId && Number(f.season || 1) === season)
          .map((f) => pairingKey(f.homeId, f.awayId))
      );
      const weeks = roundRobinWeeks(players.map((p) => p.id), { doubleRound });
      let nextId = Math.max(0, ...db.fixtures.map((f) => f.id)) + 1;
      const created = [];
      weeks.forEach((matches, index) => {
        const week = index + 1;
        const date = addDays(startDate, (week - 1) * weekGapDays);
        for (const m of matches) {
          const key = pairingKey(m.homeId, m.awayId);
          if (existing.has(key)) continue;
          existing.add(key);
          const fixture = newFixture({
            id: nextId++,
            leagueId,
            season,
            week,
            homeId: m.homeId,
            awayId: m.awayId,
            date,
            weekStart: date,
          });
          db.fixtures.push(fixture);
          created.push(fixture);
        }
      });
      recordStaff(db, user, "generate_fixtures", {
        summary: `Generated ${created.length} fixture${created.length === 1 ? "" : "s"} (${weeks.length} weeks) in ${leagueTitle(db, league)}`,
        leagueId,
      });
      writeDb(db);
      return json(res, 200, {
        ok: true,
        created: created.length,
        weeks: weeks.length,
        skipped: weeks.reduce((n, m) => n + m.length, 0) - created.length,
        fixtures: created.map((f) => withNames(db, f)),
      });
    }
    const declineStats = p.match(/^\/api\/admin\/fixtures\/(\d+)\/decline-stats$/);
    if (method === "POST" && declineStats) {
      const fixture = db.fixtures.find((f) => f.id === Number(declineStats[1]));
      if (!fixture) return json(res, 404, { ok: false, error: "Fixture not found" });
      if (!managesLeague(user, fixture.leagueId)) return json(res, 403, { ok: false, error: "Not your league" });
      if (fixture.status !== "submitted") {
        return json(res, 400, { ok: false, error: "Only player-verified stats can be declined" });
      }
      const note = String(body.note || "").trim().slice(0, 400);
      clearResultSubmission(fixture);
      fixture.resubmitRequest = {
        requestedBy: user.id,
        requestedAt: new Date().toISOString(),
        note,
      };
      const pair = `${shotByName(db, fixture.homeId) || "Home"} vs ${shotByName(db, fixture.awayId) || "Away"}`;
      recordStaff(db, user, "decline_stats", {
        summary: `Declined stats for ${pair} and asked them to resubmit`,
        fixtureId: fixture.id,
        leagueId: fixture.leagueId,
      });
      writeDb(db);
      return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
    }
    const confirmMatch = p.match(/^\/api\/admin\/fixtures\/(\d+)\/result$/);
    if (method === "POST" && confirmMatch) {
      const fixture = db.fixtures.find((f) => f.id === Number(confirmMatch[1]));
      if (!fixture) return json(res, 404, { ok: false, error: "Fixture not found" });
      if (!managesLeague(user, fixture.leagueId)) return json(res, 403, { ok: false, error: "Not your league" });
      if (isByeFixture(fixture)) return json(res, 400, { ok: false, error: "This week is a bye — there is no match to score" });
      if (!canOverride(user) && fixture.status !== "submitted") {
        return json(res, 400, { ok: false, error: "Wait for the opposing player to verify the submitted stats" });
      }
      if (!canOverride(user) && shotCount(fixture) < 2 && !(fixture.status === "submitted" && shotCount(fixture) >= 1)) {
        return json(res, 400, { ok: false, error: "Wait for both match screenshots" });
      }
      if (fixture.status === "played" && !canOverride(user)) return json(res, 400, { ok: false, error: "Only a head admin or owner can overwrite a confirmed result" });
      const legsError = validateLegs(body.homeLegs, body.awayLegs);
      if (legsError) return json(res, 400, { ok: false, error: legsError });
      const wasPlayed = fixture.status === "played";
      applyMatchStats(fixture, body);
      fixture.status = "played";
      fixture.confirmedBy = user.id;
      fixture.confirmedAt = new Date().toISOString();
      fixture.extractedStats = fixture.extractedStats ? { ...fixture.extractedStats, pending: false, verifiedBy: user.id, verifiedAt: fixture.confirmedAt } : null;
      fixture.resubmitRequest = null;
      if (canOverride(user) && wasPlayed) {
        fixture.overwrittenBy = user.id;
        fixture.overwrittenAt = fixture.confirmedAt;
      }
      const pair = `${shotByName(db, fixture.homeId) || "Home"} vs ${shotByName(db, fixture.awayId) || "Away"}`;
      const score = `${Number(body.homeLegs)}–${Number(body.awayLegs)}`;
      recordStaff(db, user, wasPlayed ? "override_result" : "approve_result", {
        summary: wasPlayed
          ? `Changed result for ${pair} to ${score}`
          : `Approved ${pair} ${score}`,
        fixtureId: fixture.id,
        leagueId: fixture.leagueId,
      });
      writeDb(db);
      return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
    }
    if (method === "POST" && p === "/api/admin/create-player") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can add players" });
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim();
      const password = String(body.password || "").trim();
      const username = String(body.username || "").trim();
      const dartcounterName = String(body.dartcounterName || "").trim() || name;
      if (!name || !email || !password) return json(res, 400, { ok: false, error: "Name, email and password are required" });
      const conflict = identityConflict(db, { email, username, dartcounterName });
      if (conflict) return json(res, 400, { ok: false, error: conflict });
      const league = body.leagueId ? db.leagues.find((l) => l.id === Number(body.leagueId)) : null;
      const international = internationalRegional(db);
      const intlId = international?.id || INTERNATIONAL_REGIONAL_ID;
      if (league && !isInternationalRegional(db.regionals.find((r) => r.id === league.regionalId))) {
        return json(res, 400, { ok: false, error: SIGNUP_REGIONALS_SOON_ERROR });
      }
      const created = {
        id: Math.max(0, ...db.users.map((u) => u.id)) + 1,
        name,
        email,
        username,
        password,
        role: "player",
        roles: [],
        leagueId: league ? league.id : null,
        leagueIds: league ? [league.id] : [],
        adminLeagueId: null,
        adminLeagueIds: [],
        regionalChoice: "international",
        regionalIds: [intlId],
        regionalId: intlId,
        dartcounterName,
        nickname: String(body.nickname || "").trim(),
        avg: Number(String(body.avg || "0").replace(/[^0-9.]/g, "")) || 0,
        country: "",
        avatarFile: null,
        avatarUpdatedAt: null,
      };
      const filledSeat = league ? claimVacantSeat(db, created, league.id) : null;
      db.users.push(created);
      recordStaff(db, user, "create_player", {
        summary: filledSeat
          ? `Created player ${created.name}, taking over ${takenSeatPhrase(filledSeat)}`
          : `Created player ${created.name}`,
        targetUserId: created.id,
        leagueId: created.leagueId || null,
      });
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(created, db), filledSeat });
    }
    if (method === "POST" && p === "/api/admin/unplace-player") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can remove players from a league" });
      const u = db.users.find((x) => x.id === Number(body.userId));
      if (!u) return json(res, 400, { ok: false, error: "Player not found" });
      const rawLeague = body.leagueId;
      const leagueId = rawLeague === "" || rawLeague == null ? 0 : Number(rawLeague);
      const ids = userLeagueIds(u);
      if (leagueId) {
        if (!ids.includes(leagueId)) return json(res, 400, { ok: false, error: "Player is not in that league" });
        unplaceUserFromLeagues(u, leagueId);
      } else {
        unplaceUserFromLeagues(u);
      }
      const byes = vacatePlayerFixtures(db, u, leagueId);
      for (const appn of db.applications.filter((a) => a.userId === u.id)) {
        appn.status = isFullyPlaced(db, u) ? "placed" : "pending";
      }
      resolveMatchingLeagueRequests(db, u);
      const byeNote = byes ? ` ${byes} unplayed match${byes === 1 ? "" : "es"} now a bye until that seat is filled.` : "";
      recordStaff(db, user, "unplace_player", {
        summary: (leagueId ? `Unplaced ${u.name} from ${leagueTitle(db, db.leagues.find((l) => l.id === leagueId) || { name: "league" })}` : `Unplaced ${u.name} from all leagues`) + byeNote,
        targetUserId: u.id,
        leagueId: leagueId || null,
      });
      writeDb(db);
      return json(res, 200, { ok: true, user: publicUser(u, db), byes });
    }
    if (method === "POST" && p === "/api/admin/delete-player") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can delete players" });
      const u = db.users.find((x) => x.id === Number(body.userId));
      if (!u) return json(res, 400, { ok: false, error: "Player not found" });
      if (isOwner(u)) return json(res, 400, { ok: false, error: "Owners cannot be deleted here" });
      if (u.avatarFile) removeUpload(u.avatarFile);
      const byes = vacatePlayerFixtures(db, u, 0);
      db.applications = db.applications.filter((a) => a.userId !== u.id);
      db.adminProfiles = (db.adminProfiles || []).filter((p) => Number(p.userId) !== Number(u.id));
      db.users = db.users.filter((x) => x.id !== u.id);
      const byeNote = byes ? ` ${byes} unplayed match${byes === 1 ? "" : "es"} now a bye until that seat is filled.` : "";
      recordStaff(db, user, "delete_player", {
        summary: `Deleted player ${u.name}.${byeNote}`,
        targetUserId: u.id,
      });
      persistDb(db);
      return json(res, 200, { ok: true, byes });
    }
    const clearMatch = p.match(/^\/api\/admin\/fixtures\/(\d+)\/clear$/);
    if (method === "POST" && clearMatch) {
      if (!canOverride(user)) return json(res, 403, { ok: false, error: "Only a head admin or owner can clear results" });
      const fixture = db.fixtures.find((f) => f.id === Number(clearMatch[1]));
      if (!fixture) return json(res, 404, { ok: false, error: "Fixture not found" });
      if (!managesLeague(user, fixture.leagueId)) return json(res, 403, { ok: false, error: "Not your league" });
      clearMatchStats(fixture);
      fixture.status = shotCount(fixture) >= 2 ? "submitted" : "scheduled";
      fixture.confirmedBy = null;
      fixture.confirmedAt = null;
      recordStaff(db, user, "clear_result", {
        summary: `Cleared result for ${shotByName(db, fixture.homeId) || "Home"} vs ${shotByName(db, fixture.awayId) || "Away"}`,
        fixtureId: fixture.id,
        leagueId: fixture.leagueId,
      });
      writeDb(db);
      return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
    }
    if (method === "POST" && p === "/api/admin/fixtures/clear-league") {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can clear fixtures" });
      const leagueId = Number(body.leagueId);
      const league = db.leagues.find((l) => l.id === leagueId);
      if (!league) return json(res, 400, { ok: false, error: "Choose a league" });
      const season = body.season ? Number(body.season) : null;
      const toRemove = db.fixtures.filter((f) => f.leagueId === leagueId && (season == null || Number(f.season || 1) === season));
      for (const f of toRemove) {
        removeUpload(shotFile(f, 1));
        removeUpload(shotFile(f, 2));
      }
      const ids = new Set(toRemove.map((f) => f.id));
      db.fixtures = db.fixtures.filter((f) => !ids.has(f.id));
      forgetFixtureSeats(db, [...ids]);
      recordStaff(db, user, "clear_league", {
        summary: `Cleared ${toRemove.length} fixture${toRemove.length === 1 ? "" : "s"} from ${leagueTitle(db, league)}${season ? ` season ${season}` : ""}`,
        leagueId,
      });
      writeDb(db);
      return json(res, 200, { ok: true, removed: toRemove.length });
    }
    const skipAcceptMatch = p.match(/^\/api\/admin\/fixtures\/(\d+)\/skip-accept$/);
    if (method === "POST" && skipAcceptMatch) {
      const fixture = db.fixtures.find((f) => f.id === Number(skipAcceptMatch[1]));
      if (!fixture) return json(res, 404, { ok: false, error: "Fixture not found" });
      if (!managesLeague(user, fixture.leagueId)) return json(res, 403, { ok: false, error: "Not your league" });
      fixture.skipVisitorAccept = flagOn(body.skipVisitorAccept);
      recordStaff(db, user, "skip_accept", {
        summary: `${fixture.skipVisitorAccept ? "Skipped" : "Restored"} visitor accept for ${shotByName(db, fixture.homeId) || "Home"} vs ${shotByName(db, fixture.awayId) || "Away"}`,
        fixtureId: fixture.id,
        leagueId: fixture.leagueId,
      });
      writeDb(db);
      return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
    }
    const editMatch = p.match(/^\/api\/admin\/fixtures\/(\d+)$/);
    if (method === "POST" && editMatch) {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can edit fixtures" });
      const fixture = db.fixtures.find((f) => f.id === Number(editMatch[1]));
      if (!fixture) return json(res, 404, { ok: false, error: "Fixture not found" });
      const week = Number(body.week);
      if (!Number.isInteger(week) || week < 1) return json(res, 400, { ok: false, error: "Enter a week number" });
      const weekStart = String(body.weekStart || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return json(res, 400, { ok: false, error: "Enter the week start date" });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "").slice(0, 10)) ? String(body.date).slice(0, 10) : weekStart;
      const homeBye = String(body.homeId || "").trim().toLowerCase() === "bye";
      const awayBye = String(body.awayId || "").trim().toLowerCase() === "bye";
      if (homeBye && awayBye) return json(res, 400, { ok: false, error: "A bye needs one player" });
      const played = fixture.status === "played";
      if (played && (homeBye || awayBye)) return json(res, 400, { ok: false, error: "A played match needs both players" });
      const resolveSide = (raw, isBye) => {
        if (isBye) return { user: null };
        const player = db.users.find((x) => x.id === Number(raw));
        if (!player) return { error: "Choose both players" };
        if (!inLeague(player, fixture.leagueId)) return { error: "Both players must already be placed in that league" };
        const alreadyOnFixture = Number(fixture.homeId) === Number(player.id) || Number(fixture.awayId) === Number(player.id);
        if (isInjuredIn(player, fixture.leagueId) && !alreadyOnFixture) return { error: "That player is on the injured list" };
        return { user: player };
      };
      const homeSide = resolveSide(body.homeId, homeBye);
      const awaySide = resolveSide(body.awayId, awayBye);
      if (homeSide.error) return json(res, 400, { ok: false, error: homeSide.error });
      if (awaySide.error) return json(res, 400, { ok: false, error: awaySide.error });
      if (homeSide.user && awaySide.user && homeSide.user.id === awaySide.user.id) {
        return json(res, 400, { ok: false, error: "Choose two different players" });
      }
      const legsSent = body.homeLegs !== undefined && body.homeLegs !== "" && body.awayLegs !== undefined && body.awayLegs !== "";
      if (played && legsSent) {
        const legsError = validateLegs(body.homeLegs, body.awayLegs);
        if (legsError) return json(res, 400, { ok: false, error: legsError });
      }
      fixture.week = week;
      fixture.weekStart = weekStart;
      fixture.date = date;
      fixture.time = homeBye || awayBye ? "" : String(body.time || "").slice(0, 5);
      fixture.homeId = homeSide.user?.id || null;
      fixture.awayId = awaySide.user?.id || null;
      if (homeBye || awayBye) {
        releaseOpenMatch(fixture);
        fixture.homeId = homeSide.user?.id || null;
        fixture.awayId = awaySide.user?.id || null;
      } else if (fixture.status === "bye") {
        fixture.bye = false;
        fixture.status = "scheduled";
        fixture.notify = freshFixtureNotify();
      }
      if (played && legsSent) {
        fixture.homeLegs = Number(body.homeLegs);
        fixture.awayLegs = Number(body.awayLegs);
        fixture.status = "played";
        fixture.bye = false;
      }
      const homeLabel = homeBye ? "Bye" : homeSide.user.name;
      const awayLabel = awayBye ? "Bye" : awaySide.user.name;
      recordStaff(db, user, "edit_fixture", {
        summary: `Edited ${homeLabel} vs ${awayLabel} (week ${fixture.week})`,
        fixtureId: fixture.id,
        leagueId: fixture.leagueId,
      });
      writeDb(db);
      return json(res, 200, { ok: true, fixture: withNames(db, fixture) });
    }
    const deleteMatch = p.match(/^\/api\/admin\/fixtures\/(\d+)\/delete$/);
    if (method === "POST" && deleteMatch) {
      if (!isOwner(user)) return json(res, 403, { ok: false, error: "Only owners can delete fixtures" });
      const id = Number(deleteMatch[1]);
      const fixture = db.fixtures.find((f) => f.id === id);
      if (!fixture) return json(res, 404, { ok: false, error: "Fixture not found" });
      removeUpload(shotFile(fixture, 1));
      removeUpload(shotFile(fixture, 2));
      recordStaff(db, user, "delete_fixture", {
        summary: `Deleted ${shotByName(db, fixture.homeId) || "Home"} vs ${shotByName(db, fixture.awayId) || "Away"}`,
        fixtureId: fixture.id,
        leagueId: fixture.leagueId,
      });
      db.fixtures = db.fixtures.filter((f) => f.id !== id);
      forgetFixtureSeats(db, [id]);
      writeDb(db);
      return json(res, 200, { ok: true });
    }
    if (method === "POST" && p === "/api/admin/announcements") {
      if (!isStaff(user)) return json(res, 403, { ok: false, error: "Only league staff can post news" });
      const title = String(body.title || "").trim();
      const text = String(body.body ?? "");
      if (!title || !text.trim()) return json(res, 400, { ok: false, error: "Title and body are required" });
      const item = {
        id: Math.max(0, ...db.announcements.map((a) => a.id)) + 1,
        title,
        body: text,
        createdAt: new Date().toISOString(),
        postedById: user.id,
      };
      db.announcements.unshift(item);
      recordStaff(db, user, "post_news", {
        summary: `Posted news “${title.slice(0, 80)}”`,
      });
      writeDb(db);
      return json(res, 200, { ok: true, announcement: item });
    }
    const deleteNews = p.match(/^\/api\/admin\/announcements\/(\d+)\/delete$/);
    if (method === "POST" && deleteNews) {
      if (!canOverride(user)) return json(res, 403, { ok: false, error: "Only owners and head admins can delete news" });
      const id = Number(deleteNews[1]);
      const found = db.announcements.find((a) => a.id === id);
      if (!found) return json(res, 404, { ok: false, error: "Announcement not found" });
      db.announcements = db.announcements.filter((a) => a.id !== id);
      recordStaff(db, user, "delete_news", {
        summary: `Deleted news “${String(found.title || "").slice(0, 80)}”`,
      });
      writeDb(db);
      return json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { ok: false, error: "Not found" });
}

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";

migrate(readDb());
const sessions = loadSessions();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/health") return json(res, 200, { ok: true });
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (serveStatic(req, res, url.pathname)) return;
    const index = path.join(publicDir, "index.html");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(index).pipe(res);
  } catch (err) {
    console.error(err);
    json(res, err.status || 500, { ok: false, error: err.status === 413 ? err.message : "Server error" });
  }
});

server.listen(port, host, () => {
  console.log(`TSH Darts League running on ${host}:${port}`);
  console.log(`Data directory: ${dataDir}`);
  try {
    const stored = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    console.log(`Stored accounts: ${(stored.users || []).length}`);
  } catch {
    console.log("Stored accounts: none yet");
  }
  if (onRailway && dataDir === "/data") {
    console.log("Railway data stays on the /data volume. Attach a volume at /data so signups survive deploys.");
  }
  warmPdcTicker();
  const emailCfg = emailConfigStatus();
  if (emailCfg.configured) {
    console.log(`Email notifications: ON — sending via Resend as ${emailCfg.from} (tz ${emailCfg.timezone}, reminder ${emailCfg.reminderMinutes} min).`);
  } else {
    console.log("Email notifications: OFF — EMAIL_API_KEY not set; notifications are logged only, not emailed.");
  }
  if (emailCfg.warning) console.warn(`Email notifications WARNING: ${emailCfg.warning}`);
  if (postgresConfigured()) console.log("Postgres backups: ON — snapshots go to DATABASE_URL after each save.");
  else console.log("Postgres backups: OFF — add a Railway PostgreSQL plugin and set DATABASE_URL on this service.");
  if (airtableConfigured()) console.log("Airtable sync: ON — Players, Standings, and Fixtures will update after each save.");
  else console.log("Airtable sync: OFF — set AIRTABLE_TOKEN and AIRTABLE_BASE_ID to push the staff spreadsheet.");
  startNotificationLoop();
});

function startNotificationLoop(intervalMs = 60000) {
  const tick = () => {
    let outbox = [];
    try {
      const db = readDb();
      const result = runDueNotifications(db, new Date());
      outbox = result.outbox;
      // Persist the dedupe markers before sending so a crash/restart never
      // re-sends. This claim is synchronous, so it can't clobber concurrent
      // request writes.
      if (result.changed) writeDb(db);
    } catch (err) {
      console.error("Notification poll failed:", err);
      return;
    }
    for (const msg of outbox) {
      Promise.resolve(sendEmail(msg)).catch((err) => console.error("Notification email failed:", err));
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
}
