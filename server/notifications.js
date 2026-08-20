// Match notification engine (Phase 1: email via Resend HTTP API, zero-dependency).
//
// `runDueNotifications(db, now)` is a pure function: it scans fixtures, decides
// which notifications are due, stamps per-fixture dedupe markers, and returns the
// messages to send plus whether the db changed. The server persists the markers
// (claiming them) before actually sending, so a restart never double-sends.

import { zonedWallTimeToUtc, zonedYmd, wallStringToUtc } from "./timezones.js";

const LEAGUE_TZ = process.env.LEAGUE_TIMEZONE || "Europe/London";
const REMINDER_MINUTES = Number(process.env.MATCH_REMINDER_MINUTES) || 30;
const WEEK_AHEAD_DAYS = 7;
const DEFAULT_FROM = "TSH Darts League <onboarding@resend.dev>";

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
}

// Absolute kickoff instant. Prefers the stored UTC `startAt`; falls back to
// interpreting a legacy fixture's naive date/time in the league timezone.
function fixtureStartUtc(f, tz) {
  if (f.startAt) {
    const d = new Date(f.startAt);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (f.scheduleStatus !== "agreed") return null;
  return wallStringToUtc(f.date, f.time, tz);
}

function displayName(u) {
  return (u && (u.nickname || u.name)) || "your opponent";
}
function wantsEmail(u) {
  return !!u && !!u.email && (!u.notifyPrefs || u.notifyPrefs.email !== false);
}

function weeklyEmail(to, opp, f, leagueName) {
  const oppName = displayName(opp);
  const subject = `Your TSH match this week vs ${oppName}`;
  const html =
    `<p>Hi ${esc(displayName(to))},</p>` +
    `<p>You have an upcoming match in <b>${esc(leagueName)}</b> (Week ${esc(f.week)}) against <b>${esc(oppName)}</b>.</p>` +
    `<p>Open <b>My Matches</b> to agree a date and time, then play on DartCounter.</p>` +
    `<p>— TSH Darts League</p>`;
  return { to: to.email, subject, html, userId: to.id, type: "weekly", fixtureId: f.id };
}
function reminderEmail(to, opp, f, startUtc, tz) {
  const oppName = displayName(opp);
  // Show the kickoff in the recipient's own timezone.
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: to.timezone || tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(startUtc);
  const subject = `Your TSH match starts soon vs ${oppName}`;
  const html =
    `<p>Hi ${esc(displayName(to))},</p>` +
    `<p>Your match against <b>${esc(oppName)}</b> starts at <b>${esc(when)}</b> (your local time).</p>` +
    `<p>Get DartCounter ready — good luck!</p>` +
    `<p>— TSH Darts League</p>`;
  return { to: to.email, subject, html, userId: to.id, type: "reminder", fixtureId: f.id };
}

// Pure: detect due notifications, stamp dedupe markers on fixtures, return work.
export function runDueNotifications(db, now = new Date(), opts = {}) {
  const tz = opts.timeZone || LEAGUE_TZ;
  const reminderMin = opts.reminderMinutes || REMINDER_MINUTES;
  const users = new Map((db.users || []).map((u) => [u.id, u]));
  const leagues = new Map((db.leagues || []).map((l) => [l.id, l]));
  const outbox = [];
  let changed = false;

  const today = zonedYmd(now, tz);
  const startOfToday = zonedWallTimeToUtc(today.y, today.mo, today.d, 0, 0, tz).getTime();
  const weekAhead = startOfToday + WEEK_AHEAD_DAYS * 86400000;

  for (const f of db.fixtures || []) {
    if (f.status === "played") continue;
    if (!f.notify || typeof f.notify !== "object") {
      f.notify = { weekHomeAt: null, weekAwayAt: null, remind30At: null };
      changed = true;
    }
    const home = users.get(f.homeId);
    const away = users.get(f.awayId);
    const leagueName = leagues.get(f.leagueId)?.name || "your league";

    // 1) "Your match this week" — fixture's target date falls within the next 7 days.
    const dd = parseYmd(f.date);
    if (dd) {
      const dayUtc = zonedWallTimeToUtc(dd.y, dd.mo, dd.d, 0, 0, tz).getTime();
      if (dayUtc >= startOfToday && dayUtc < weekAhead) {
        if (home && !f.notify.weekHomeAt) {
          if (wantsEmail(home)) outbox.push(weeklyEmail(home, away, f, leagueName));
          f.notify.weekHomeAt = now.toISOString();
          changed = true;
        }
        if (away && !f.notify.weekAwayAt) {
          if (wantsEmail(away)) outbox.push(weeklyEmail(away, home, f, leagueName));
          f.notify.weekAwayAt = now.toISOString();
          changed = true;
        }
      }
    }

    // 2) "Starts soon" — agreed time is within the reminder window (default 30 min).
    if (!f.notify.remind30At) {
      const startUtc = fixtureStartUtc(f, tz);
      if (startUtc) {
        const diffMin = (startUtc.getTime() - now.getTime()) / 60000;
        if (diffMin >= 0 && diffMin <= reminderMin) {
          if (home && wantsEmail(home)) outbox.push(reminderEmail(home, away, f, startUtc, tz));
          if (away && wantsEmail(away)) outbox.push(reminderEmail(away, home, f, startUtc, tz));
          f.notify.remind30At = now.toISOString();
          changed = true;
        }
      }
    }
  }

  return { outbox, changed };
}

// Deliver one message. With no EMAIL_API_KEY set it logs instead of sending,
// so development and tests work without any provider.
export async function sendEmail(msg) {
  const key = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM || DEFAULT_FROM;
  if (!key) {
    console.log(`[notify:dev] would email ${msg.to} — "${msg.subject}" (${msg.type})`);
    return { ok: true, dev: true };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  console.log(`[notify] emailed ${msg.to} — "${msg.subject}" (${msg.type})`);
  return { ok: true };
}
