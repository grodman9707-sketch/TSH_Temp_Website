/** Owner-only staff activity log. Kept off Head Admin / Division Admin desks. */

export const STAFF_LOG_MAX = 500;
const APPROVE = "approve_result";
const OVERRIDE = "override_result";

function userIsStaff(u) {
  const roles = Array.isArray(u?.roles) ? u.roles : u?.role ? [u.role] : [];
  if (roles.includes("owner") || roles.includes("head_admin") || roles.includes("admin")) return true;
  if (u?.role === "owner" || u?.role === "head_admin" || u?.role === "admin") return true;
  if (u?.adminLeagueId || (Array.isArray(u?.adminLeagueIds) && u.adminLeagueIds.length)) return true;
  return false;
}

function staffRoleLabel(u) {
  const roles = Array.isArray(u?.roles) ? u.roles : [];
  if (u?.role === "owner" || roles.includes("owner")) return "Owner";
  if (u?.role === "head_admin" || roles.includes("head_admin")) return "Head Admin";
  return "Division Admin";
}

export function appendStaffLog(db, actor, event, now = new Date()) {
  if (!db || !actor || !event?.action) return null;
  if (!Array.isArray(db.staffLog)) db.staffLog = [];
  const id = Math.max(0, ...db.staffLog.map((e) => Number(e.id) || 0)) + 1;
  const entry = {
    id,
    at: now.toISOString(),
    actorId: Number(actor.id),
    actorName: String(actor.nickname || actor.name || "Staff").slice(0, 80),
    actorRole: staffRoleLabel(actor),
    action: String(event.action).slice(0, 40),
    summary: String(event.summary || event.action).slice(0, 280),
    leagueId: event.leagueId != null ? Number(event.leagueId) : null,
    fixtureId: event.fixtureId != null ? Number(event.fixtureId) : null,
    targetUserId: event.targetUserId != null ? Number(event.targetUserId) : null,
  };
  db.staffLog.unshift(entry);
  if (db.staffLog.length > STAFF_LOG_MAX) db.staffLog.length = STAFF_LOG_MAX;
  return entry;
}

export function summarizeStaffLog(db, now = new Date()) {
  const entries = Array.isArray(db.staffLog) ? db.staffLog : [];
  const t = now.getTime();
  const day7 = t - 7 * 86400000;
  const day30 = t - 30 * 86400000;
  const inWindow = (e, start) => {
    const at = Date.parse(e.at);
    return Number.isFinite(at) && at >= start && at <= t;
  };
  const staff = (db.users || []).filter(userIsStaff);
  const byActor = staff
    .map((u) => {
      const mine = entries.filter((e) => Number(e.actorId) === Number(u.id));
      const latest = [...mine].sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0))[0];
      const in7 = mine.filter((e) => inWindow(e, day7));
      const in30 = mine.filter((e) => inWindow(e, day30));
      const count = (list, action) => list.filter((e) => e.action === action).length;
      return {
        actorId: u.id,
        actorName: u.nickname || u.name || "Staff",
        role: staffRoleLabel(u),
        lastAt: latest?.at || null,
        lastSummary: latest?.summary || null,
        approvals7d: count(in7, APPROVE),
        approvals30d: count(in30, APPROVE),
        overrides30d: count(in30, OVERRIDE),
        actions7d: in7.length,
        actions30d: in30.length,
      };
    })
    .sort((a, b) => b.approvals7d - a.approvals7d || b.actions7d - a.actions7d || String(a.actorName).localeCompare(String(b.actorName)));
  return {
    days7: 7,
    days30: 30,
    byActor,
    totalEntries: entries.length,
    approvals7d: entries.filter((e) => e.action === APPROVE && inWindow(e, day7)).length,
    approvals30d: entries.filter((e) => e.action === APPROVE && inWindow(e, day30)).length,
  };
}

export function staffLogPayload(db, now = new Date()) {
  const entries = Array.isArray(db.staffLog) ? db.staffLog : [];
  return {
    entries,
    summary: summarizeStaffLog(db, now),
  };
}
