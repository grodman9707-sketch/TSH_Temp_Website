/** Commentary for one division, built only from published results.
 *
 * Played fixtures are the season record. The latest week that has a published
 * result is the story. The following public week is the reason to come back.
 * Submitted or unverified stats are ignored until an admin publishes them.
 */

function clean(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function firstName(name) {
  const token = clean(name).split(" ")[0];
  return token && token.length > 1 ? token : clean(name);
}

function spoken(name, names) {
  const first = firstName(name);
  const clashes = names.filter((other) => firstName(other).toLowerCase() === first.toLowerCase());
  return clashes.length > 1 ? clean(name) : first;
}

function nameList(names) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function scoreLine(winnerLegs, loserLegs) {
  return `${winnerLegs}–${loserLegs}`;
}

const SMALL_NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function wordNum(value) {
  const n = Number(value) || 0;
  return SMALL_NUMBERS[n] || String(n);
}

function recordPhrase(row) {
  const won = Number(row.won) || 0;
  const played = Number(row.played) || 0;
  const word = won === 1 ? "win" : "wins";
  return `${wordNum(won)} ${word} from ${wordNum(played)}`;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function checkoutOf(fixture, side) {
  return Math.round(num(fixture[`${side}Checkout`]));
}

function averageOf(fixture, side) {
  return num(fixture[`${side}Avg`]);
}

function tonsOf(fixture, side) {
  return num(fixture[`${side}180`] || fixture[`${side}OneEighties`]);
}

function isBye(fixture) {
  return Boolean(fixture?.bye) || fixture?.status === "bye" || !clean(fixture?.homeName) || clean(fixture?.homeName) === "Bye" || !clean(fixture?.awayName) || clean(fixture?.awayName) === "Bye";
}

function isPlayed(fixture) {
  return fixture?.status === "played" && Number.isFinite(Number(fixture.homeLegs)) && Number.isFinite(Number(fixture.awayLegs));
}

function describeMatch(fixture) {
  const home = clean(fixture.homeName);
  const away = clean(fixture.awayName);
  const homeLegs = Number(fixture.homeLegs);
  const awayLegs = Number(fixture.awayLegs);
  const homeWon = homeLegs > awayLegs;
  const winnerLegs = Math.max(homeLegs, awayLegs);
  const loserLegs = Math.min(homeLegs, awayLegs);
  return {
    fixture,
    week: Number(fixture.week) || 0,
    home,
    away,
    winner: homeWon ? home : away,
    loser: homeWon ? away : home,
    winnerSide: homeWon ? "home" : "away",
    loserSide: homeWon ? "away" : "home",
    winnerLegs,
    loserLegs,
    score: scoreLine(winnerLegs, loserLegs),
    decider: winnerLegs - loserLegs === 1,
    whitewash: loserLegs === 0 && winnerLegs >= 4,
    involves(name) {
      const key = clean(name);
      return key === home || key === away;
    },
    side(name) {
      return clean(name) === home ? "home" : "away";
    },
  };
}

function orderedStandings(standings) {
  return [...(standings || [])].sort(
    (a, b) => num(b.points) - num(a.points) || num(b.diff) - num(a.diff) || num(b.legsFor) - num(a.legsFor) || clean(a.name).localeCompare(clean(b.name))
  );
}

function leadersOf(standings) {
  if (!standings.length || num(standings[0].played) === 0 && num(standings[0].points) === 0) return [];
  const top = num(standings[0].points);
  return standings.filter((row) => num(row.points) === top && num(row.played) > 0);
}

function rankOf(standings, name) {
  const index = standings.findIndex((row) => clean(row.name) === clean(name));
  return index === -1 ? null : index + 1;
}

function placeWord(rank) {
  if (rank === 2) return "second";
  if (rank === 3) return "third";
  return "";
}

export function divisionReview({ divisionName, standings, fixtures }) {
  const title = `What's happening in ${clean(divisionName) || "this division"}`;
  const rows = orderedStandings(standings);
  const names = rows.map((row) => clean(row.name)).filter(Boolean);
  const visible = (fixtures || []).filter((fixture) => !isBye(fixture));
  const played = visible.filter(isPlayed).map(describeMatch);
  const publicWeek = visible.reduce((max, fixture) => Math.max(max, Number(fixture.week) || 0), 0);
  const resultsWeek = played.reduce((max, match) => Math.max(max, match.week), 0);

  if (!played.length) {
    const opening = visible.filter((fixture) => Number(fixture.week) === (publicWeek || 1));
    const paragraphs = ["Nothing is on the table yet. The first published results will write this."];
    if (opening.length) {
      const cards = opening.map((fixture) => `${clean(fixture.homeName)} against ${clean(fixture.awayName)}`);
      paragraphs.push(`First up: ${nameList(cards)}. Come back when those land.`);
    }
    return { title, paragraphs };
  }

  const leaders = leadersOf(rows);
  const leaderNames = new Set(leaders.map((row) => clean(row.name)));
  const weekPlayed = played.filter((match) => match.week === resultsWeek);
  const weekWaiting = visible.filter((fixture) => Number(fixture.week) === resultsWeek && !isPlayed(fixture));
  const forwardWeek = visible.some((fixture) => Number(fixture.week) === resultsWeek + 1) ? resultsWeek + 1 : 0;
  const forward = visible.filter((fixture) => Number(fixture.week) === forwardWeek);
  const resultsAreCurrent = publicWeek <= resultsWeek;
  const when = resultsAreCurrent ? "This week" : `In week ${resultsWeek}`;

  const paragraphs = [];
  paragraphs.push(leaderParagraph({ leaders, weekPlayed, weekWaiting, when, names }));

  const featured = new Set();
  for (const match of weekPlayed) {
    if ([...leaderNames].some((name) => match.involves(name))) featured.add(match);
  }
  const rest = weekPlayed.filter((match) => !featured.has(match));
  const middle = otherMatchesParagraph(rest);
  if (middle) paragraphs.push(middle);

  const ahead = forwardParagraph({
    forward,
    forwardWeek,
    resultsAreCurrent,
    weekPlayed,
    weekWaiting,
    leaders,
    leaderNames,
    rows,
    names,
    featuredWaiting: weekWaiting.filter((fixture) => leaderNames.has(clean(fixture.homeName)) || leaderNames.has(clean(fixture.awayName))),
  });
  if (ahead) paragraphs.push(ahead);

  return { title, paragraphs };
}

function leaderParagraph({ leaders, weekPlayed, weekWaiting, when, names }) {
  if (leaders.length > 1) return jointLeaderParagraph({ leaders, weekPlayed, weekWaiting, when, names });
  const leader = leaders[0];
  const leaderName = clean(leader.name);
  let text = `${leaderName} is top after ${recordPhrase(leader)}.`;
  const match = weekPlayed.find((item) => item.involves(leaderName));
  if (match) {
    text += ` ${singleResultSentence(match, leaderName, when, names, weekPlayed)}`;
    return text;
  }
  const waiting = weekWaiting.find((fixture) => clean(fixture.homeName) === leaderName || clean(fixture.awayName) === leaderName);
  if (waiting) {
    const opponent = clean(waiting.homeName) === leaderName ? clean(waiting.awayName) : clean(waiting.homeName);
    text += ` ${spoken(leaderName, names)} against ${opponent} has not landed yet, so the lead is not finished.`;
    return text;
  }
  if (!weekPlayed.length) text += " The lead is waiting on a published result.";
  return text;
}

function jointLeaderParagraph({ leaders, weekPlayed, weekWaiting, when, names }) {
  const leaderNames = leaders.map((row) => clean(row.name));
  const unbeaten = leaders.every((row) => num(row.won) === num(row.played) && num(row.played) > 0);
  const unbeatenWord = leaders.length === 2 ? "both unbeaten" : "all unbeaten";
  let text = `${nameList(leaderNames)} are joint top${unbeaten ? `, ${unbeatenWord}` : ""}.`;
  const bits = [];
  for (const row of leaders) {
    const match = weekPlayed.find((item) => item.involves(row.name));
    if (!match) continue;
    bits.push(jointResultBit(match, clean(row.name), names, weekPlayed));
  }
  if (bits.length) text += ` ${when} ${bits.join(" ")}`;
  const waiting = weekWaiting.filter((fixture) => leaderNames.includes(clean(fixture.homeName)) || leaderNames.includes(clean(fixture.awayName)));
  if (waiting.length) {
    const fixture = waiting[0];
    text += ` ${clean(fixture.homeName)} against ${clean(fixture.awayName)} has not landed yet, so the joint lead is not finished.`;
  }
  return text;
}

function jointResultBit(match, name, names, weekPlayed) {
  const who = spoken(name, names);
  if (match.winner !== name) return `${who} dropped one to ${match.winner}, ${scoreLine(match.loserLegs, match.winnerLegs)}.`;
  const finish = finishOfWeek(weekPlayed);
  if (finish && finish.match === match) return finishSentence(finish);
  const extras = resultExtras(match, name, weekPlayed);
  const verb = match.whitewash ? "put" : match.decider ? "edged" : "beat";
  const action = match.whitewash ? `${verb} ${match.loser} away ${match.score}` : `${verb} ${match.loser} ${match.score}`;
  return extras ? `${who} ${action}, ${extras}.` : `${who} ${action}.`;
}

function singleResultSentence(match, name, when, names, weekPlayed) {
  const who = spoken(name, names);
  if (match.winner !== name) {
    return `${when} ${match.winner} took the points, ${match.score}. The lead survived it.`;
  }
  const verb = match.whitewash ? `put ${match.loser} away ${match.score}` : match.decider ? `edged ${match.loser} ${match.score}` : `beat ${match.loser} ${match.score}`;
  const extras = resultExtras(match, name, weekPlayed);
  let line = extras ? `${when} ${who} ${verb}, ${extras}.` : `${when} ${who} ${verb}.`;
  const checkout = checkoutOf(match.fixture, match.side(name));
  const highlight = match.whitewash || extras.includes("best average") || extras.includes("180") || checkout >= 100;
  if (highlight) line += ` Enjoy it, ${who}.`;
  if (checkout > 0 && checkout < 80) line += ` A ${checkout} checkout is the one bit of that win you would quietly redo.`;
  else if (checkout >= 100) line += ` A ${checkout} checkout finished it in style.`;
  return line;
}

function resultExtras(match, name, weekPlayed) {
  const side = match.side(name);
  const parts = [];
  const avg = averageOf(match.fixture, side);
  if (avg && avg === bestAverage(weekPlayed)) parts.push("with the best average in the division");
  const tons = tonsOf(match.fixture, side);
  if (tons > 0) parts.push(tons === 1 ? "with a 180" : `with ${tons} 180s`);
  if (parts.length === 2) return "with the best average in the division and a 180";
  return parts.join(" ");
}

function bestAverage(matches) {
  let best = 0;
  let count = 0;
  for (const match of matches) {
    for (const side of ["home", "away"]) {
      const avg = averageOf(match.fixture, side);
      if (!avg) continue;
      if (avg > best) {
        best = avg;
        count = 1;
      } else if (avg === best) count += 1;
    }
  }
  return count === 1 ? best : 0;
}

function finishOfWeek(matches) {
  let best = null;
  for (const match of matches) {
    for (const side of ["winner", "loser"]) {
      const name = side === "winner" ? match.winner : match.loser;
      const checkout = checkoutOf(match.fixture, match.side(name));
      if (checkout < 100) continue;
      if (!best || checkout > best.checkout) best = { match, name, checkout, won: name === match.winner };
    }
  }
  return best;
}

function otherMatchesParagraph(matches) {
  if (!matches.length) return "";
  const deciders = matches.filter((match) => match.decider);
  const finish = finishOfWeek(matches);
  const sentences = [];
  if (deciders.length === 1) sentences.push("One match went to a last-leg decider.");
  else if (deciders.length > 1) sentences.push(deciders.length === 2 ? "Two matches went to a last-leg decider." : "A few matches went to a last-leg decider.");

  const used = new Set();
  if (finish && deciders.includes(finish.match)) {
    sentences.push(finishSentence(finish));
    used.add(finish.match);
  }
  const scruffy = deciders.find((match) => !used.has(match) && !bigFinish(match));
  if (scruffy) {
    sentences.push(`${scruffy.winner} nicked ${scruffy.loser} ${scruffy.score} the scruffy way, no finish either of them will be retelling. A win is a win.`);
    used.add(scruffy);
  }
  for (const match of deciders) {
    if (used.has(match) || sentences.length >= 4) continue;
    sentences.push(`${match.winner} edged ${match.loser} ${match.score}.`);
    used.add(match);
  }
  if (!deciders.length) {
    const pick = [...matches].sort((a, b) => b.winnerLegs - b.loserLegs - (a.winnerLegs - a.loserLegs))[0];
    const verb = pick.whitewash ? `put ${pick.loser} away ${pick.score}` : `beat ${pick.loser} ${pick.score}`;
    sentences.push(`${pick.winner} ${verb}.`);
    if (finish && finish.match === pick && !finish.won) sentences.push(finishSentence(finish));
  }
  return sentences.join(" ");
}

function bigFinish(match) {
  return checkoutOf(match.fixture, match.winnerSide) >= 100 || checkoutOf(match.fixture, match.loserSide) >= 100;
}

function finishSentence(finish) {
  if (finish.won) {
    return `${finish.match.winner} beat ${finish.match.loser} ${finish.match.score}, and closed it with a ${finish.checkout} checkout, the finish of the week.`;
  }
  const winner = spoken(finish.match.winner, [finish.match.winner, finish.match.loser]);
  const loser = spoken(finish.name, [finish.match.winner, finish.match.loser]);
  return `${finish.match.winner} beat ${finish.match.loser} ${finish.match.score}, and ${loser} still walked off with a ${finish.checkout} checkout, the finish of the week. ${winner} has the points. ${loser} has the moment.`;
}

function forwardParagraph({ forward, forwardWeek, resultsAreCurrent, weekPlayed, weekWaiting, leaders, leaderNames, rows, names, featuredWaiting }) {
  const sentences = [];
  const otherWaiting = weekWaiting.filter((fixture) => !featuredWaiting.includes(fixture));
  if (otherWaiting.length === 1) {
    const fixture = otherWaiting[0];
    sentences.push(`${clean(fixture.homeName)} against ${clean(fixture.awayName)} has not landed yet, so the table is not finished for the week.`);
  } else if (otherWaiting.length > 1) {
    sentences.push(`${otherWaiting.length} matches have not landed yet, so the table is not finished for the week.`);
  }

  if (!forward.length) {
    if (!sentences.length && resultsAreCurrent) sentences.push("Next week is not on the board yet. The table will be waiting when it drops.");
    return sentences.join(" ");
  }

  const stories = [];
  const used = new Set();
  const shot = shotAtLeader(forward, leaderNames, rows);
  if (shot) {
    const challenger = spoken(shot.challenger, names);
    const leader = spoken(shot.leader, names);
    const scraped = freshScrape(weekPlayed, shot.challenger);
    const opener = scraped ? `${challenger}, fresh off that scrape, gets ${leader}.` : `${clean(shot.challenger)} gets ${leader}.`;
    const rank = rankOf(rows, shot.challenger);
    const nearBottom = rank != null && rank >= Math.max(rows.length - 2, Math.ceil(rows.length * 0.75));
    stories.push(`${opener} ${nearBottom ? "A player near the bottom, with a direct shot at the leader." : "A direct shot at the leader."}`);
    used.add(pairKey(shot.fixture));
  }

  const answer = answerMatch(forward, weekPlayed, used, rows);
  if (answer) {
    const where = placeWord(rankOf(rows, answer.opponent));
    const spot = where ? ` in ${where}` : "";
    stories.push(`${clean(answer.victim)} gets ${clean(answer.opponent)}${spot}, and a chance to answer the ${answer.score}.`);
    used.add(pairKey(answer.fixture));
  }

  const hunting = firstWinMatch(forward, rows, used);
  if (hunting) {
    stories.push(`${clean(hunting.player)}, still looking for a first win, plays ${clean(hunting.opponent)}.`);
    used.add(pairKey(hunting.fixture));
  }

  if (!stories.length) {
    const fixture = forward[0];
    stories.push(`${clean(fixture.homeName)} plays ${clean(fixture.awayName)}.`);
  }

  const intro = resultsAreCurrent ? "Next week is worth coming back for." : `Week ${forwardWeek} is the one to come back for.`;
  const closer = stories.length === 1 ? "That one moves the table." : `One of those ${stories.length === 2 ? "two" : "three"} moves the table.`;
  return [sentences.join(" "), intro, ...stories, closer].filter(Boolean).join(" ");
}

function pairKey(fixture) {
  return [clean(fixture.homeName), clean(fixture.awayName)].sort().join("|");
}

function shotAtLeader(forward, leaderNames, rows) {
  let best = null;
  for (const fixture of forward) {
    const home = clean(fixture.homeName);
    const away = clean(fixture.awayName);
    const homeLeads = leaderNames.has(home);
    const awayLeads = leaderNames.has(away);
    if (homeLeads === awayLeads) continue;
    const challenger = homeLeads ? away : home;
    const leader = homeLeads ? home : away;
    const rank = rankOf(rows, challenger) || 0;
    if (!best || rank > best.rank) best = { fixture, challenger, leader, rank };
  }
  return best;
}

function freshScrape(weekPlayed, name) {
  const match = weekPlayed.find((item) => item.involves(name));
  return Boolean(match && match.decider && match.winner === clean(name));
}

function answerMatch(forward, weekPlayed, used, rows) {
  const wash = weekPlayed.find((match) => match.whitewash);
  if (!wash) return null;
  const fixture = forward.find((item) => !used.has(pairKey(item)) && (clean(item.homeName) === wash.loser || clean(item.awayName) === wash.loser));
  if (!fixture) return null;
  const victim = wash.loser;
  const opponent = clean(fixture.homeName) === victim ? clean(fixture.awayName) : clean(fixture.homeName);
  return { fixture, victim, opponent, score: wash.score };
}

function firstWinMatch(forward, rows, used) {
  const hunting = rows.filter((row) => num(row.won) === 0);
  hunting.sort((a, b) => num(b.played) - num(a.played));
  for (const row of hunting) {
    const fixture = forward.find((item) => !used.has(pairKey(item)) && (clean(item.homeName) === clean(row.name) || clean(item.awayName) === clean(row.name)));
    if (!fixture) continue;
    const player = clean(row.name);
    const opponent = clean(fixture.homeName) === player ? clean(fixture.awayName) : clean(fixture.homeName);
    return { fixture, player, opponent };
  }
  return null;
}
