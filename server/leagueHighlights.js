/** One home-page highlight across every division, from published results only. */

function clean(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function firstName(name) {
  const token = clean(name).split(" ")[0];
  return token && token.length > 1 ? token : clean(name);
}

function spoken(name, names) {
  const first = firstName(name);
  const clashes = (names || []).filter((other) => firstName(other).toLowerCase() === first.toLowerCase());
  return clashes.length > 1 ? clean(name) : first;
}

function nameList(names) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value) {
  return { text: String(value) };
}

function link(label, href) {
  return { text: label, href: href || "" };
}

function isBye(fixture) {
  const home = clean(fixture?.homeName);
  const away = clean(fixture?.awayName);
  return Boolean(fixture?.bye) || fixture?.status === "bye" || !home || home === "Bye" || !away || away === "Bye";
}

function isPlayed(fixture) {
  return fixture?.status === "played" && Number.isFinite(Number(fixture.homeLegs)) && Number.isFinite(Number(fixture.awayLegs));
}

function describe(fixture, division) {
  const home = clean(fixture.homeName);
  const away = clean(fixture.awayName);
  const homeLegs = Number(fixture.homeLegs);
  const awayLegs = Number(fixture.awayLegs);
  const homeWon = homeLegs > awayLegs;
  const winnerLegs = Math.max(homeLegs, awayLegs);
  const loserLegs = Math.min(homeLegs, awayLegs);
  return {
    division,
    fixture,
    week: Number(fixture.week) || 0,
    home,
    away,
    winner: homeWon ? home : away,
    loser: homeWon ? away : home,
    winnerSide: homeWon ? "home" : "away",
    loserSide: homeWon ? "away" : "home",
    score: `${winnerLegs}–${loserLegs}`,
    decider: winnerLegs - loserLegs === 1,
    whitewash: loserLegs === 0 && winnerLegs >= 4,
    side(name) {
      return clean(name) === home ? "home" : "away";
    },
    avg(name) {
      return num(fixture[`${this.side(name)}Avg`]);
    },
    checkout(name) {
      return Math.round(num(fixture[`${this.side(name)}Checkout`]));
    },
  };
}

function ordered(standings) {
  return [...(standings || [])].sort(
    (a, b) => num(b.points) - num(a.points) || num(b.diff) - num(a.diff) || num(b.legsFor) - num(a.legsFor) || clean(a.name).localeCompare(clean(b.name))
  );
}

function leadersOf(rows) {
  if (!rows.length || (num(rows[0].played) === 0 && num(rows[0].points) === 0)) return [];
  const top = num(rows[0].points);
  return rows.filter((row) => num(row.points) === top && num(row.played) > 0);
}

function sameMatch(a, b) {
  return a && b && a.fixture === b.fixture;
}

export function leagueHighlights(divisions) {
  const boards = (divisions || [])
    .map((division) => ({
      name: clean(division.name),
      href: division.href || "",
      rows: ordered(division.standings),
      fixtures: (division.fixtures || []).filter((fixture) => !isBye(fixture)),
    }))
    .filter((division) => division.name);

  const played = [];
  for (const division of boards) {
    for (const fixture of division.fixtures) {
      if (isPlayed(fixture)) played.push(describe(fixture, division));
    }
  }
  if (!played.length) return null;

  const focusWeek = played.reduce((max, match) => Math.max(max, match.week), 0);
  const week = played.filter((match) => match.week === focusWeek);
  const names = week.flatMap((match) => [match.winner, match.loser]);
  const lead = leadStory(week);
  const finish = finishStory(week, lead);
  const paragraph = [];
  if (lead) paragraph.push(...leadSentence(lead, names));
  if (finish) {
    if (paragraph.length) paragraph.push(text(" "));
    paragraph.push(...finishSentence(finish));
  }
  const openers = tablesToOpen(boards, focusWeek);
  const second = openerSentence(openers);
  return {
    title: "Around the league",
    paragraphs: [paragraph, second].filter((parts) => parts.length),
  };
}

function leadStory(matches) {
  let best = null;
  for (const match of matches) {
    const avg = match.avg(match.winner);
    if (!avg) continue;
    const rank = avg * 1000 + (match.whitewash ? 20 : 0);
    if (!best || rank > best.rank) best = { match, avg, rank };
  }
  if (best) return best;
  const washed = matches.find((match) => match.whitewash);
  return washed ? { match: washed, avg: 0 } : matches[0] ? { match: matches[0], avg: 0 } : null;
}

function leadSentence(lead, names) {
  const match = lead.match;
  const who = match.winner;
  const verb = match.whitewash ? `put ${match.loser} away ${match.score}` : match.decider ? `edged ${match.loser} ${match.score}` : `beat ${match.loser} ${match.score}`;
  const bits = [text(`${who} ${verb} in `), link(match.division.name, match.division.href)];
  if (lead.avg) bits.push(text(", the highest average of the week"));
  bits.push(text("."));
  if (match.whitewash || lead.avg) bits.push(text(` Enjoy it, ${spoken(who, names)}.`));
  return bits;
}

function finishStory(matches, lead) {
  let best = null;
  for (const match of matches) {
    if (lead && sameMatch(match, lead.match) && lead.avg) continue;
    for (const name of [match.winner, match.loser]) {
      const checkout = match.checkout(name);
      if (checkout < 100) continue;
      if (!best || checkout > best.checkout) best = { match, name, checkout, won: name === match.winner };
    }
  }
  return best;
}

function finishSentence(finish) {
  const division = finish.match.division;
  const who = clean(finish.name);
  if (!finish.won && finish.match.decider) {
    return [
      link(division.name, division.href),
      text(` still owns the finish: ${who} lost a last-leg decider and walked off with a ${finish.checkout} checkout.`),
    ];
  }
  const action = finish.won ? `${who} closed a ${finish.match.score} with a ${finish.checkout} checkout` : `${who} walked off with a ${finish.checkout} checkout`;
  return [link(division.name, division.href), text(` has the finish of the week: ${action}.`)];
}

function tablesToOpen(divisions, focusWeek) {
  const picked = [];
  for (const division of divisions) {
    const reason = openReason(division, focusWeek);
    if (reason) picked.push({ division, ...reason });
  }
  picked.sort((a, b) => b.score - a.score || a.division.name.localeCompare(b.division.name));
  return picked.slice(0, 2);
}

function openReason(division, focusWeek) {
  const leaders = leadersOf(division.rows);
  const leaderNames = new Set(leaders.map((row) => clean(row.name)));
  const next = division.fixtures.filter((fixture) => Number(fixture.week) === focusWeek + 1 && fixture.status !== "played");
  let bestShot = null;
  for (const fixture of next) {
    const home = clean(fixture.homeName);
    const away = clean(fixture.awayName);
    const homeLeads = leaderNames.has(home);
    const awayLeads = leaderNames.has(away);
    if (homeLeads === awayLeads) continue;
    const challenger = homeLeads ? away : home;
    const leader = homeLeads ? home : away;
    const rank = division.rows.findIndex((row) => clean(row.name) === challenger) + 1;
    if (!bestShot || rank > bestShot.rank) bestShot = { challenger, leader, rank };
  }
  if (leaders.length > 1) {
    return { score: 3, clause: `where ${nameList(leaders.map((row) => clean(row.name)))} are joint top` };
  }
  if (bestShot && bestShot.rank >= Math.max(division.rows.length - 2, Math.ceil(division.rows.length * 0.6))) {
    return { score: 2, clause: `where ${bestShot.challenger} has a shot at ${bestShot.leader}` };
  }
  return null;
}

function openerSentence(openers) {
  if (!openers.length) return [];
  const parts = [text(openers.length === 1 ? "The table to open is " : "The tables to open are ")];
  openers.forEach((opener, index) => {
    if (index === 1 && openers.length === 2) parts.push(text(", and "));
    parts.push(link(opener.division.name, opener.division.href));
    parts.push(text(`, ${opener.clause}`));
  });
  parts.push(text("."));
  return parts;
}
