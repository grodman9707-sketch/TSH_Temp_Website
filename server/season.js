/** Circle-method round-robin. Odd player counts get a bye (no fixture that week). */
export function roundRobinWeeks(playerIds, { doubleRound = false } = {}) {
  const ids = [...new Set(playerIds.map(Number).filter(Boolean))];
  if (ids.length < 2) return [];
  const list = ids.length % 2 === 1 ? [...ids, null] : [...ids];
  const n = list.length;
  const rounds = n - 1;
  const half = n / 2;
  const weeks = [];
  for (let round = 0; round < rounds; round++) {
    const matches = [];
    for (let i = 0; i < half; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (!a || !b) continue;
      if (round % 2 === 0) matches.push({ homeId: a, awayId: b });
      else matches.push({ homeId: b, awayId: a });
    }
    weeks.push(matches);
    list.splice(1, 0, list.pop());
  }
  if (doubleRound) {
    const returnWeeks = weeks.map((matches) => matches.map((m) => ({ homeId: m.awayId, awayId: m.homeId })));
    weeks.push(...returnWeeks);
  }
  return weeks;
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function pairingKey(homeId, awayId) {
  return `${Number(homeId)}-${Number(awayId)}`;
}
