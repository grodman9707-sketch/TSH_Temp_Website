// Arrange-chat for a fixture. The two players, and that division's admin, can
// post while the match is still pending. The chat locks once the result is
// submitted for admin approval, and the messages are removed once that result
// is published.

export const CHAT_MAX_BODY = 500;
export const CHAT_MAX_MESSAGES = 200;
export const CHAT_EMAIL_WINDOW_MS = 10 * 60 * 1000;

export function chatPhase(fixture) {
  if (!fixture) return "gone";
  if (fixture.bye || fixture.status === "bye") return "gone";
  if (fixture.status === "played") return "gone";
  if (fixture.status === "submitted") return "locked";
  if (fixture.status === "scheduled" || fixture.status === "pending_verify") return "open";
  return "gone";
}

export function ensureMatchChats(db) {
  if (!Array.isArray(db.matchChats)) db.matchChats = [];
  if (!Array.isArray(db.matchChatReads)) db.matchChatReads = [];
}

export function sweepMatchChats(db) {
  ensureMatchChats(db);
  const live = new Set();
  for (const fixture of db.fixtures || []) {
    if (chatPhase(fixture) !== "gone") live.add(Number(fixture.id));
  }
  const before = db.matchChats.length + db.matchChatReads.length;
  db.matchChats = db.matchChats.filter((message) => live.has(Number(message.fixtureId)));
  db.matchChatReads = db.matchChatReads.filter((stamp) => live.has(Number(stamp.fixtureId)));
  return db.matchChats.length + db.matchChatReads.length !== before;
}

export function cleanChatBody(raw) {
  const text = String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
  if (!text) return { error: "Write a message first" };
  if (text.length > CHAT_MAX_BODY) return { error: `Message is too long (${CHAT_MAX_BODY} characters max)` };
  return { text };
}

function inMatch(fixture, user) {
  if (!fixture || !user) return false;
  return Number(fixture.homeId) === Number(user.id) || Number(fixture.awayId) === Number(user.id);
}

export function canViewFixtureChat(fixture, user, scope = {}) {
  if (!user || !fixture) return false;
  const phase = chatPhase(fixture);
  if (phase === "gone") return false;
  if (scope.owner || scope.headAdmin) return true;
  const leagues = (scope.adminLeagueIds || []).map(Number);
  if (leagues.includes(Number(fixture.leagueId))) return true;
  if (phase !== "open") return false;
  if (!inMatch(fixture, user)) return false;
  if (scope.released === false) return false;
  return true;
}

export function canPostFixtureChat(fixture, user, scope = {}) {
  if (!user || chatPhase(fixture) !== "open") return false;
  if (scope.released === false) return false;
  if (inMatch(fixture, user)) return true;
  const leagues = (scope.adminLeagueIds || []).map(Number);
  return leagues.includes(Number(fixture.leagueId));
}

export function messagesForFixture(db, fixtureId) {
  ensureMatchChats(db);
  return db.matchChats
    .filter((message) => Number(message.fixtureId) === Number(fixtureId))
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || Number(a.id) - Number(b.id));
}

export function readStamp(db, fixtureId, userId) {
  ensureMatchChats(db);
  return (
    db.matchChatReads.find(
      (stamp) => Number(stamp.fixtureId) === Number(fixtureId) && Number(stamp.userId) === Number(userId)
    ) || null
  );
}

export function unreadForUser(db, fixtureId, userId) {
  const stamp = readStamp(db, fixtureId, userId);
  const since = Date.parse(stamp?.readAt || "");
  const hasSince = Number.isFinite(since);
  return messagesForFixture(db, fixtureId).filter((message) => {
    if (Number(message.userId) === Number(userId)) return false;
    if (!hasSince) return true;
    const at = Date.parse(message.createdAt);
    return Number.isFinite(at) && at > since;
  });
}

export function markChatRead(db, fixtureId, userId, now = new Date()) {
  ensureMatchChats(db);
  const readAt = now.toISOString();
  const stamp = readStamp(db, fixtureId, userId);
  if (!stamp) {
    db.matchChatReads.push({
      fixtureId: Number(fixtureId),
      userId: Number(userId),
      readAt,
      lastNotifiedAt: "",
    });
    return true;
  }
  if (stamp.readAt === readAt) return false;
  stamp.readAt = readAt;
  return true;
}

export function chatEmailDue(db, fixtureId, userId, now = new Date(), windowMs = CHAT_EMAIL_WINDOW_MS) {
  const stamp = readStamp(db, fixtureId, userId);
  if (!stamp?.lastNotifiedAt) return true;
  const last = Date.parse(stamp.lastNotifiedAt);
  if (!Number.isFinite(last)) return true;
  const readAt = Date.parse(stamp.readAt || "");
  if (Number.isFinite(readAt) && readAt >= last) return true;
  return now.getTime() - last >= windowMs;
}

export function noteChatEmail(db, fixtureId, userId, now = new Date()) {
  ensureMatchChats(db);
  const stamp = readStamp(db, fixtureId, userId);
  const lastNotifiedAt = now.toISOString();
  if (!stamp) {
    db.matchChatReads.push({
      fixtureId: Number(fixtureId),
      userId: Number(userId),
      readAt: "",
      lastNotifiedAt,
    });
    return;
  }
  stamp.lastNotifiedAt = lastNotifiedAt;
}
