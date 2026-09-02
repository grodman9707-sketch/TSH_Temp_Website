export const SEASON_START = "2026-09-14T00:00:00.000Z";
export const MYSTERY_REVEAL_AT = "2026-09-07T00:00:00.000Z";
export const DISCORD_CLAIM_CHANNEL = "#Claim_PreSeason_Bounty";
export const DISCORD_INVITE = "https://discord.gg/PjXMqRQCfS";

export const TIERS = [
  { id: "t1", name: "Tier 1", avgLabel: "55+ Avg", minAvg: 55, maxAvg: Infinity, blurb: "Highest averages. Same-tier matches only for these bounties." },
  { id: "t2", name: "Tier 2", avgLabel: "40–55 Avg", minAvg: 40, maxAvg: 55, blurb: "Mid averages. Same-tier matches only for these bounties." },
  { id: "t3", name: "Tier 3", avgLabel: "Below 40 Avg", minAvg: 0, maxAvg: 40, blurb: "Developing averages. Same-tier matches only for these bounties." },
];

export const BOUNTIES = [
  {
    id: "t1-century",
    tierId: "t1",
    kind: "tier",
    points: 2,
    name: "The Century",
    how: "Hit 3 checkouts of 100 or more in a single match.",
  },
  {
    id: "t1-max-mayhem",
    tierId: "t1",
    kind: "tier",
    points: 2,
    name: "Max Mayhem",
    how: "Hit 3 maximums (180s) in a single match.",
  },
  {
    id: "t1-sprinter",
    tierId: "t1",
    kind: "tier",
    points: 2,
    name: "The Sprinter",
    how: "Finish a leg in 15 darts or fewer.",
  },
  {
    id: "t1-apex",
    tierId: "t1",
    kind: "tier",
    points: 2,
    name: "Apex Predator",
    how: "Defeat 2 different opponents back to back without losing a single leg.",
  },
  {
    id: "t2-finish-him",
    tierId: "t2",
    kind: "tier",
    points: 2,
    name: "Finish Him",
    how: "Hit a 100+ checkout in a match.",
  },
  {
    id: "t2-heavy-hitter",
    tierId: "t2",
    kind: "tier",
    points: 2,
    name: "Heavy Hitter",
    how: "Score 120 or more twice in a single leg.",
  },
  {
    id: "t2-get-low",
    tierId: "t2",
    kind: "tier",
    points: 2,
    name: "Get Low",
    how: "Finish a leg in 20 darts or fewer.",
  },
  {
    id: "t2-bull-hitter",
    tierId: "t2",
    kind: "tier",
    points: 2,
    name: "Bull-Hitter",
    how: "Finish a leg on the inner bullseye (50).",
  },
  {
    id: "t3-weight-lifter",
    tierId: "t3",
    kind: "tier",
    points: 2,
    name: "Weight Lifter",
    how: "Score a 140 during a match.",
  },
  {
    id: "t3-double-double",
    tierId: "t3",
    kind: "tier",
    points: 2,
    name: "Double Double",
    how: "Finish a score of 64 with D16–D16.",
  },
  {
    id: "t3-clean-sweep",
    tierId: "t3",
    kind: "tier",
    points: 2,
    name: "Clean Sweep",
    how: "Finish a match 3–0 against an opponent.",
  },
  {
    id: "t3-true-aim",
    tierId: "t3",
    kind: "tier",
    points: 2,
    name: "True Aim",
    how: "Hit 20 × 6 in a row.",
    note: "Your opponent must verify this one.",
  },
  {
    id: "u-social-butterfly",
    tierId: null,
    kind: "universal",
    points: 1,
    name: "Social Butterfly",
    how: "Play 10 different TSH opponents before the season starts.",
  },
  {
    id: "u-hockey-fan",
    tierId: null,
    kind: "universal",
    points: 1,
    name: "Hockey Fan",
    how: "The hat trick of darts: three inner bullseyes in a row (50–50–50).",
  },
  {
    id: "u-double-trouble",
    tierId: null,
    kind: "universal",
    points: 1,
    name: "Double Trouble",
    how: "Finish a leg with three doubles.",
  },
  {
    id: "u-mystery",
    tierId: null,
    kind: "universal",
    points: 1,
    name: "Mystery Target",
    how: "Each tier has its own mystery target. Beat yours to unlock this point.",
    mystery: true,
  },
];

export const RULES = [
  { title: "Who can play", text: "You must be signed up. You do not need to be placed in a division." },
  { title: "Opt in", text: "Anyone with an account can join the hunt or sit it out." },
  { title: "Tier bounties", text: "Worth 2 bonus points for season standings. Claim each one only once. You must be in that tier and playing another player from the same tier." },
  { title: "Universal bounties", text: "Worth 1 bonus point each. Any signed-up player can claim them in any match against another TSH league player. Once per player." },
];

export const CLAIM_STEPS = [
  "Play the match against a TSH league player (same tier for average-based bounties).",
  `Post a screenshot of the match and proof of the bounty in Discord ${DISCORD_CLAIM_CHANNEL}.`,
  "Open a ticket so an admin can review it.",
  "If asked, have your opponent sign off or verify the claim.",
];

export function calendarDayLabel(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const day = Number(m[3]);
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${months[Number(m[2]) - 1]} ${day}${suffix}`;
}

export function bountyById(id) {
  return BOUNTIES.find((b) => b.id === id) || null;
}

export function tierById(id) {
  return TIERS.find((t) => t.id === id) || null;
}

export function parseAvg(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function tierForAvg(avg) {
  const n = parseAvg(avg);
  if (n >= 55) return TIERS[0];
  if (n >= 40) return TIERS[1];
  return TIERS[2];
}

export function defaultBountySettings() {
  return { mysteryRevealed: false, mysteryTargets: { t1: "", t2: "", t3: "" } };
}

export function ensureBountyState(db) {
  let changed = false;
  if (!Array.isArray(db.bountyClaims)) {
    db.bountyClaims = [];
    changed = true;
  }
  if (!db.preseasonBounty || typeof db.preseasonBounty !== "object") {
    db.preseasonBounty = defaultBountySettings();
    changed = true;
  } else {
    if (typeof db.preseasonBounty.mysteryRevealed !== "boolean") {
      db.preseasonBounty.mysteryRevealed = false;
      changed = true;
    }
    if (!db.preseasonBounty.mysteryTargets || typeof db.preseasonBounty.mysteryTargets !== "object") {
      db.preseasonBounty.mysteryTargets = { t1: "", t2: "", t3: "" };
      changed = true;
    } else {
      for (const key of ["t1", "t2", "t3"]) {
        if (typeof db.preseasonBounty.mysteryTargets[key] !== "string") {
          db.preseasonBounty.mysteryTargets[key] = "";
          changed = true;
        }
      }
    }
  }
  for (const u of db.users || []) {
    if (typeof u.bountyHunt !== "boolean") {
      u.bountyHunt = false;
      changed = true;
    }
  }
  return changed;
}

export function isMysteryRevealed(settings, now = new Date()) {
  if (settings?.mysteryRevealed) return true;
  const t = now instanceof Date ? now : new Date(now);
  return t.getTime() >= Date.parse(MYSTERY_REVEAL_AT);
}

function publicBounty(bounty, { claimed = false, mysteryRevealed = false, mysteryTargets = {} } = {}) {
  const row = {
    id: bounty.id,
    tierId: bounty.tierId,
    kind: bounty.kind,
    points: bounty.points,
    name: bounty.name,
    how: bounty.how,
    note: bounty.note || "",
    mystery: Boolean(bounty.mystery),
    claimed: Boolean(claimed),
  };
  if (bounty.mystery) {
    row.mysteryRevealed = mysteryRevealed;
    row.mysteryTargets = mysteryRevealed
      ? {
          t1: String(mysteryTargets.t1 || "").trim(),
          t2: String(mysteryTargets.t2 || "").trim(),
          t3: String(mysteryTargets.t3 || "").trim(),
        }
      : { t1: "", t2: "", t3: "" };
    if (!mysteryRevealed) {
      row.how = `Locked. Each tier’s target is revealed 7 days before season start (${calendarDayLabel(MYSTERY_REVEAL_AT)}).`;
    }
  }
  return row;
}

export function claimsForUser(db, userId) {
  return (db.bountyClaims || []).filter((c) => Number(c.userId) === Number(userId));
}

export function claimedIds(db, userId) {
  return claimsForUser(db, userId).map((c) => c.bountyId);
}

export function pointsForClaims(ids) {
  let total = 0;
  for (const id of ids) {
    const b = bountyById(id);
    if (b) total += b.points;
  }
  return total;
}

export function maxPoints() {
  return BOUNTIES.reduce((sum, b) => sum + b.points, 0);
}

export function maxPointsForTier(tierId) {
  return BOUNTIES.filter((b) => b.kind === "universal" || b.tierId === tierId).reduce((sum, b) => sum + b.points, 0);
}

function hunterName(u) {
  return String(u.nickname || u.name || "Player");
}

export function playerSummary(db, u, { now } = {}) {
  const settings = db.preseasonBounty || defaultBountySettings();
  const mysteryRevealed = isMysteryRevealed(settings, now);
  const ids = claimedIds(db, u.id);
  const tier = tierForAvg(u.avg);
  const tierClaimed = ids.filter((id) => bountyById(id)?.kind === "tier").length;
  const universalClaimed = ids.filter((id) => bountyById(id)?.kind === "universal").length;
  return {
    userId: u.id,
    name: u.name,
    nickname: u.nickname || "",
    displayName: hunterName(u),
    avg: parseAvg(u.avg),
    tierId: tier.id,
    tierName: tier.name,
    avgLabel: tier.avgLabel,
    joined: Boolean(u.bountyHunt) || ids.length > 0,
    claimedIds: ids,
    claimedCount: ids.length,
    tierClaimed,
    tierTotal: BOUNTIES.filter((b) => b.kind === "tier" && b.tierId === tier.id).length,
    universalClaimed,
    universalTotal: BOUNTIES.filter((b) => b.kind === "universal").length,
    points: pointsForClaims(ids),
    maxPoints: maxPointsForTier(tier.id),
    mysteryRevealed,
  };
}

export function publicHunt(db, { user = null, now = new Date(), canAward = false, canEditMystery = false } = {}) {
  ensureBountyState(db);
  const settings = db.preseasonBounty;
  const mysteryRevealed = isMysteryRevealed(settings, now);
  const mysteryTargets = settings.mysteryTargets || { t1: "", t2: "", t3: "" };
  const myIds = user ? new Set(claimedIds(db, user.id)) : new Set();
  const bounties = BOUNTIES.map((b) =>
    publicBounty(b, { claimed: myIds.has(b.id), mysteryRevealed, mysteryTargets })
  );
  const hunters = (db.users || [])
    .map((u) => playerSummary(db, u, { now }))
    .filter((h) => h.joined)
    .sort((a, b) => b.points - a.points || String(a.displayName).localeCompare(String(b.displayName)));

  const payload = {
    title: "PreSeason Bounty Hunt",
    intro: "Hunt bonuses before the season starts. Signed-up players can join even if they are not placed yet. Bonus points count toward season standings.",
    seasonStart: SEASON_START,
    seasonStartLabel: calendarDayLabel(SEASON_START),
    mysteryRevealAt: MYSTERY_REVEAL_AT,
    mysteryRevealLabel: calendarDayLabel(MYSTERY_REVEAL_AT),
    discordChannel: DISCORD_CLAIM_CHANNEL,
    discordInvite: DISCORD_INVITE,
    rules: RULES,
    claimSteps: CLAIM_STEPS,
    tiers: TIERS.map((t) => ({ id: t.id, name: t.name, avgLabel: t.avgLabel, blurb: t.blurb })),
    bounties,
    mysteryRevealed,
    hunters,
    me: user ? playerSummary(db, user, { now }) : null,
    canAward,
    canEditMystery,
  };

  if (canAward) {
    payload.awardPlayers = (db.users || [])
      .map((u) => {
        const s = playerSummary(db, u, { now });
        return {
          id: u.id,
          name: u.name,
          nickname: u.nickname || "",
          displayName: s.displayName,
          avg: s.avg,
          tierId: s.tierId,
          tierName: s.tierName,
          joined: s.joined,
          claimedIds: s.claimedIds,
          points: s.points,
        };
      })
      .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
    payload.claims = (db.bountyClaims || [])
      .map((c) => {
        const u = (db.users || []).find((x) => x.id === c.userId);
        const b = bountyById(c.bountyId);
        return {
          id: c.id,
          userId: c.userId,
          bountyId: c.bountyId,
          playerName: u ? hunterName(u) : "Player",
          bountyName: b?.name || c.bountyId,
          points: b?.points || 0,
          awardedAt: c.awardedAt,
        };
      })
      .sort((a, b) => String(b.awardedAt || "").localeCompare(String(a.awardedAt || "")));
  }

  if (canEditMystery) {
    payload.mysteryTargets = {
      t1: String(mysteryTargets.t1 || ""),
      t2: String(mysteryTargets.t2 || ""),
      t3: String(mysteryTargets.t3 || ""),
    };
    payload.mysteryForced = Boolean(settings.mysteryRevealed);
  }

  return payload;
}

export function joinHunt(db, user) {
  if (!user) return { ok: false, error: "Login required", status: 401 };
  ensureBountyState(db);
  user.bountyHunt = true;
  return { ok: true };
}

export function leaveHunt(db, user) {
  if (!user) return { ok: false, error: "Login required", status: 401 };
  ensureBountyState(db);
  user.bountyHunt = false;
  return { ok: true };
}

export function awardBounty(db, { staff, userId, bountyId, now = new Date() }) {
  if (!staff) return { ok: false, error: "Login required", status: 401 };
  ensureBountyState(db);
  const bounty = bountyById(String(bountyId || ""));
  if (!bounty) return { ok: false, error: "Unknown bounty", status: 400 };
  const target = (db.users || []).find((u) => u.id === Number(userId));
  if (!target) return { ok: false, error: "Player not found", status: 400 };
  if ((db.bountyClaims || []).some((c) => c.userId === target.id && c.bountyId === bounty.id)) {
    return { ok: false, error: "That player already claimed this bounty", status: 400 };
  }
  if (bounty.kind === "tier") {
    const playerTier = tierForAvg(target.avg);
    if (playerTier.id !== bounty.tierId) {
      const need = tierById(bounty.tierId);
      return {
        ok: false,
        error: `This bounty is for ${need.name} (${need.avgLabel}). ${hunterName(target)} is ${playerTier.name} (${parseAvg(target.avg)} 3DA).`,
        status: 400,
      };
    }
  }
  if (bounty.mystery && !isMysteryRevealed(db.preseasonBounty, now)) {
    return { ok: false, error: `Mystery Target is still locked until ${calendarDayLabel(MYSTERY_REVEAL_AT)}`, status: 400 };
  }
  const claim = {
    id: Math.max(0, ...(db.bountyClaims || []).map((c) => Number(c.id) || 0)) + 1,
    userId: target.id,
    bountyId: bounty.id,
    awardedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    awardedById: staff.id,
  };
  db.bountyClaims.push(claim);
  target.bountyHunt = true;
  return { ok: true, claim };
}

export function revokeBounty(db, { userId, bountyId }) {
  ensureBountyState(db);
  const before = db.bountyClaims.length;
  db.bountyClaims = db.bountyClaims.filter(
    (c) => !(Number(c.userId) === Number(userId) && c.bountyId === String(bountyId || ""))
  );
  if (db.bountyClaims.length === before) return { ok: false, error: "Claim not found", status: 400 };
  return { ok: true };
}

export function saveMysteryTargets(db, { t1, t2, t3, revealed }) {
  ensureBountyState(db);
  db.preseasonBounty.mysteryTargets = {
    t1: String(t1 || "").trim(),
    t2: String(t2 || "").trim(),
    t3: String(t3 || "").trim(),
  };
  if (revealed === true || revealed === "1" || revealed === "on") db.preseasonBounty.mysteryRevealed = true;
  if (revealed === false || revealed === "0") db.preseasonBounty.mysteryRevealed = false;
  return { ok: true, settings: db.preseasonBounty };
}
