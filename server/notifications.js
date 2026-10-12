// Match notification engine. Email (Resend), SMS (Twilio), and Web Push share
// one set of per-fixture dedupe markers. A stamp means the event was claimed,
// whichever channels were selected.
//
// `runDueNotifications(db, now)` is a pure function: it scans fixtures, decides
// which notifications are due, stamps per-fixture dedupe markers, and returns the
// messages to send plus whether the db changed. The server persists the markers
// (claiming them) before actually sending, so a restart never double-sends.

import { zonedWallTimeToUtc, zonedYmd, wallStringToUtc } from "./timezones.js";
import { isFixtureReleased } from "./fixtureRelease.js";
import { sendSms, smsConfigStatus } from "./sms.js";
import { deliverPushMessage, pushPublicStatus } from "./webpush.js";

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
export function wantsMatchEmail(u) {
  return wantsEmail(u);
}
export function wantsMatchSms(u) {
  return !!u && u.notifyPrefs?.sms === true && !!u.phoneVerifiedAt && !!String(u.phone || "").trim();
}
export function wantsMatchPush(u) {
  return !!u && u.notifyPrefs?.push === true && Array.isArray(u.pushSubscriptions) && u.pushSubscriptions.some((sub) => sub?.endpoint && sub?.keys?.p256dh && sub?.keys?.auth);
}
function clipSms(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > 300 ? `${s.slice(0, 297)}...` : s;
}
function localKickoffLabel(to, startUtc, tz) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: to.timezone || tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(startUtc);
}
function pushSubs(u) {
  return (u.pushSubscriptions || [])
    .filter((sub) => sub?.endpoint && sub?.keys?.p256dh && sub?.keys?.auth)
    .map((sub) => ({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }));
}
function enqueueChannels(outbox, user, { type, fixtureId, email, text, push }) {
  if (wantsEmail(user) && email) outbox.push({ channel: "email", ...email });
  if (wantsMatchSms(user) && text) {
    outbox.push({ channel: "sms", to: user.phone, body: clipSms(text), userId: user.id, type, fixtureId });
  }
  if (wantsMatchPush(user) && push) {
    outbox.push({ channel: "push", userId: user.id, type, fixtureId, subscriptions: pushSubs(user), payload: push });
  }
}
export function matchChatEmail(to, fromUser, fixture, leagueName, preview) {
  const fromName = displayName(fromUser);
  const snippet = String(preview || "").trim();
  const subject = `New message from ${fromName} about your TSH match`;
  const html =
    `<p>Hi ${esc(displayName(to))},</p>` +
    `<p><b>${esc(fromName)}</b> sent you a message about your match in <b>${esc(leagueName)}</b> (Week ${esc(fixture.week)}).</p>` +
    (snippet ? `<p>${esc(snippet)}</p>` : "") +
    `<p>Open <b>My Matches</b> to read it and reply. The arrange chat stays open until the result is sent for admin approval.</p>` +
    `<p>— TSH Darts League</p>`;
  return { channel: "email", to: to.email, subject, html, userId: to.id, type: "match_chat", fixtureId: fixture.id };
}
export function matchChatDeliveries(to, fromUser, fixture, leagueName, preview) {
  const fromName = displayName(fromUser);
  const snippet = String(preview || "").trim();
  const short = snippet.length > 140 ? `${snippet.slice(0, 137)}...` : snippet;
  const outbox = [];
  enqueueChannels(outbox, to, {
    type: "match_chat",
    fixtureId: fixture.id,
    email: matchChatEmail(to, fromUser, fixture, leagueName, preview),
    text: short
      ? `TSH: ${fromName} messaged you about your match: ${short} Open My Matches to reply.`
      : `TSH: ${fromName} messaged you about your match. Open My Matches to reply.`,
    push: {
      title: `Message from ${fromName}`,
      body: short || "New arrange-chat message. Open My Matches to reply.",
      url: `/my-matches?fixture=${fixture.id}`,
    },
  });
  return outbox;
}

function newMatchEmail(to, opp, f, leagueName) {
  const oppName = displayName(opp);
  const subject = `You're scheduled to play ${oppName} — TSH ${leagueName}`;
  const html =
    `<p>Hi ${esc(displayName(to))},</p>` +
    `<p>You have a new match in <b>${esc(leagueName)}</b> (Week ${esc(f.week)}) against <b>${esc(oppName)}</b>.</p>` +
    `<p>Open <b>My Matches</b> — the home player proposes a date and time, then the visiting player accepts it. You'll each see it in your own local time.</p>` +
    `<p>— TSH Darts League</p>`;
  return { channel: "email", to: to.email, subject, html, userId: to.id, type: "new_match", fixtureId: f.id };
}
function weeklyEmail(to, opp, f, leagueName) {
  const oppName = displayName(opp);
  const subject = `Your TSH match this week vs ${oppName}`;
  const html =
    `<p>Hi ${esc(displayName(to))},</p>` +
    `<p>You have an upcoming match in <b>${esc(leagueName)}</b> (Week ${esc(f.week)}) against <b>${esc(oppName)}</b>.</p>` +
    `<p>Open <b>My Matches</b> if you still need to accept the home player's proposed time, then play on DartCounter.</p>` +
    `<p>— TSH Darts League</p>`;
  return { channel: "email", to: to.email, subject, html, userId: to.id, type: "weekly", fixtureId: f.id };
}
function reminderEmail(to, opp, f, startUtc, tz) {
  const oppName = displayName(opp);
  // Show the kickoff in the recipient's own timezone.
  const when = localKickoffLabel(to, startUtc, tz);
  const subject = `Your TSH match starts soon vs ${oppName}`;
  const html =
    `<p>Hi ${esc(displayName(to))},</p>` +
    `<p>Your match against <b>${esc(oppName)}</b> starts at <b>${esc(when)}</b> (your local time).</p>` +
    `<p>Get DartCounter ready — good luck!</p>` +
    `<p>— TSH Darts League</p>`;
  return { channel: "email", to: to.email, subject, html, userId: to.id, type: "reminder", fixtureId: f.id, when };
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
    if (f.status === "played" || f.bye || f.status === "bye") continue;
    if (!isFixtureReleased(f, now)) continue;
    if (!f.notify || typeof f.notify !== "object") {
      f.notify = { newHomeAt: null, newAwayAt: null, weekHomeAt: null, weekAwayAt: null, remind30At: null };
      changed = true;
    }
    const home = users.get(f.homeId);
    const away = users.get(f.awayId);
    const leagueName = leagues.get(f.leagueId)?.name || "your league";

    // 0) "You've been scheduled" — fires once, right after a fixture is created.
    if (home && !f.notify.newHomeAt) {
      const oppName = displayName(away);
      enqueueChannels(outbox, home, {
        type: "new_match",
        fixtureId: f.id,
        email: newMatchEmail(home, away, f, leagueName),
        text: `TSH: New match vs ${oppName} in ${leagueName}, Week ${f.week}. Open My Matches to arrange a time.`,
        push: { title: "New TSH match", body: `You play ${oppName} in ${leagueName}, Week ${f.week}.`, url: "/my-matches" },
      });
      f.notify.newHomeAt = now.toISOString();
      changed = true;
    }
    if (away && !f.notify.newAwayAt) {
      const oppName = displayName(home);
      enqueueChannels(outbox, away, {
        type: "new_match",
        fixtureId: f.id,
        email: newMatchEmail(away, home, f, leagueName),
        text: `TSH: New match vs ${oppName} in ${leagueName}, Week ${f.week}. Open My Matches to arrange a time.`,
        push: { title: "New TSH match", body: `You play ${oppName} in ${leagueName}, Week ${f.week}.`, url: "/my-matches" },
      });
      f.notify.newAwayAt = now.toISOString();
      changed = true;
    }

    // 1) "Your match this week" — fixture's target date falls within the next 7 days.
    const dd = parseYmd(f.date);
    if (dd) {
      const dayUtc = zonedWallTimeToUtc(dd.y, dd.mo, dd.d, 0, 0, tz).getTime();
      if (dayUtc >= startOfToday && dayUtc < weekAhead) {
        if (home && !f.notify.weekHomeAt) {
          const oppName = displayName(away);
          enqueueChannels(outbox, home, {
            type: "weekly",
            fixtureId: f.id,
            email: weeklyEmail(home, away, f, leagueName),
            text: `TSH: You play ${oppName} this week in ${leagueName}, Week ${f.week}. Open My Matches if you still need to agree a time.`,
            push: { title: "TSH match this week", body: `You play ${oppName} in ${leagueName}, Week ${f.week}.`, url: "/my-matches" },
          });
          f.notify.weekHomeAt = now.toISOString();
          changed = true;
        }
        if (away && !f.notify.weekAwayAt) {
          const oppName = displayName(home);
          enqueueChannels(outbox, away, {
            type: "weekly",
            fixtureId: f.id,
            email: weeklyEmail(away, home, f, leagueName),
            text: `TSH: You play ${oppName} this week in ${leagueName}, Week ${f.week}. Open My Matches if you still need to agree a time.`,
            push: { title: "TSH match this week", body: `You play ${oppName} in ${leagueName}, Week ${f.week}.`, url: "/my-matches" },
          });
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
          if (home) {
            const mail = reminderEmail(home, away, f, startUtc, tz);
            enqueueChannels(outbox, home, {
              type: "reminder",
              fixtureId: f.id,
              email: mail,
              text: `TSH: Your match vs ${displayName(away)} starts at ${mail.when} (your local time). Get DartCounter ready.`,
              push: { title: "TSH match starting soon", body: `Vs ${displayName(away)} at ${mail.when}.`, url: "/my-matches" },
            });
          }
          if (away) {
            const mail = reminderEmail(away, home, f, startUtc, tz);
            enqueueChannels(outbox, away, {
              type: "reminder",
              fixtureId: f.id,
              email: mail,
              text: `TSH: Your match vs ${displayName(home)} starts at ${mail.when} (your local time). Get DartCounter ready.`,
              push: { title: "TSH match starting soon", body: `Vs ${displayName(home)} at ${mail.when}.`, url: "/my-matches" },
            });
          }
          f.notify.remind30At = now.toISOString();
          changed = true;
        }
      }
    }
  }

  return { outbox, changed };
}

// Resend requires "email@example.com" or "Name <email@example.com>". A bare
// "<email@example.com>" (brackets, no display name) is rejected with a 422, so
// strip the stray brackets before sending.
function normalizeFrom(from) {
  const f = String(from || "").trim();
  if (!f) return DEFAULT_FROM;
  const bracketOnly = /^<\s*([^<>\s]+@[^<>\s]+)\s*>$/.exec(f);
  return bracketOnly ? bracketOnly[1] : f;
}
function senderAddress(from) {
  const m = /<([^>]+)>/.exec(from);
  return String((m ? m[1] : from) || "").trim().toLowerCase();
}
// Flags sender addresses that can't actually deliver to players.
function senderConcern(from) {
  const addr = senderAddress(from);
  const domain = addr.split("@")[1] || "";
  if (addr === "onboarding@resend.dev") {
    return "EMAIL_FROM is the Resend sandbox sender (onboarding@resend.dev), which can ONLY deliver to your own Resend account address — players will not receive emails. Verify a domain in Resend and set EMAIL_FROM to an address on it.";
  }
  const free = ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"];
  if (free.includes(domain)) {
    return `EMAIL_FROM uses a free mailbox domain (${domain}) — providers can't send as these. Verify your own domain in Resend and use an address on it.`;
  }
  return "";
}

// Whether real email sending is configured, plus the effective settings.
export function emailConfigStatus() {
  const raw = process.env.EMAIL_FROM || DEFAULT_FROM;
  const from = normalizeFrom(raw);
  let warning = senderConcern(from);
  if (!warning && from !== raw.trim()) {
    warning = `EMAIL_FROM was "${raw.trim()}", which Resend rejects (needs "email@domain" or "Name <email@domain>"). Using "${from}" — update the variable to remove the stray angle brackets.`;
  }
  return {
    configured: Boolean(process.env.EMAIL_API_KEY),
    from,
    warning,
    timezone: LEAGUE_TZ,
    reminderMinutes: REMINDER_MINUTES,
  };
}

// Deliver one message. With no EMAIL_API_KEY set it logs instead of sending,
// so development and tests work without any provider.
export async function sendEmail(msg) {
  const key = process.env.EMAIL_API_KEY;
  const from = normalizeFrom(process.env.EMAIL_FROM || DEFAULT_FROM);
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

export function alertsConfigStatus() {
  const email = emailConfigStatus();
  const sms = smsConfigStatus();
  const push = pushPublicStatus();
  return { ...email, sms, push };
}

// Send one outbox item on its channel. Push returns gone endpoints (404/410)
// so the caller can drop those subscriptions.
export async function deliverNotification(msg) {
  if (msg?.channel === "sms") return sendSms({ to: msg.to, body: msg.body });
  if (msg?.channel === "push") return deliverPushMessage(msg);
  return sendEmail(msg);
}
