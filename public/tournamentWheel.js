// Draw wheel for a tournament signup field.
// Slice 0 starts at the top and runs clockwise. The pointer stays at the top.
// A stop rotation centers that slice under the pointer.

export const WHEEL_STEP_MS = 2200;

export function wheelStepMs(landings) {
  const n = Number(landings) || 0;
  if (n > 16) return 1100;
  if (n > 8) return 1600;
  return WHEEL_STEP_MS;
}

export function wheelStopRotation(index, count) {
  const n = Math.max(1, Number(count) || 1);
  const i = ((Math.floor(Number(index)) % n) + n) % n;
  const slice = 360 / n;
  return -((i + 0.5) * slice);
}

// Next clockwise rotation that centers `index`, at least `turns` full spins past `current`.
export function nextWheelRotation(current, index, count, turns = 4) {
  const stop = wheelStopRotation(index, count);
  let target = stop;
  const min = Number(current) + Math.max(0, Number(turns) || 0) * 360;
  let guard = 0;
  while (target < min && guard < 80) {
    target += 360;
    guard += 1;
  }
  return target;
}

export function wheelPlan(now, startedAt, count, stepMs) {
  const total = Math.max(0, Number(count) || 0);
  const step = Math.max(1, Number(stepMs) || WHEEL_STEP_MS);
  const started = Number(startedAt);
  if (!total || !Number.isFinite(started)) return { phase: "idle", index: -1, delayMs: 0, into: 0, donePairs: 0 };
  if (now < started) return { phase: "wait", index: 0, delayMs: started - now, into: 0, donePairs: 0 };
  const elapsed = now - started;
  if (elapsed >= total * step) return { phase: "done", index: total - 1, delayMs: 0, into: step, donePairs: Math.ceil(total / 2) };
  const index = Math.floor(elapsed / step);
  const into = elapsed - index * step;
  return { phase: "spin", index, delayMs: 0, into, donePairs: Math.floor(index / 2), remain: step - into };
}

function escXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function num(value) {
  return String(Math.round(Number(value) * 100) / 100);
}

function polar(cx, cy, radius, degFromTop) {
  const rad = (degFromTop * Math.PI) / 180;
  return [cx + radius * Math.sin(rad), cy - radius * Math.cos(rad)];
}

function sliceFill(index, count) {
  const gold = index % 2 === 0;
  if (gold && count % 2 === 1 && index === count - 1) return ["#8d6a16", "#fff6dd"];
  return gold ? ["#e8b425", "#1a1404"] : ["#1b2740", "#f4f1e6"];
}

function wheelLabel(name, count) {
  const text = String(name || "Player").trim() || "Player";
  const max = count <= 4 ? 16 : count <= 8 ? 12 : count <= 12 ? 9 : count <= 20 ? 7 : 5;
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function slicePath(startDeg, endDeg) {
  const [x1, y1] = polar(200, 200, 188, startDeg);
  const [x2, y2] = polar(200, 200, 188, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M 200 200 L ${num(x1)} ${num(y1)} A 188 188 0 ${large} 1 ${num(x2)} ${num(y2)} Z`;
}

export function wheelSvg(players) {
  const list = Array.isArray(players) ? players : [];
  if (!list.length) {
    return `<svg viewBox="0 0 400 400" aria-hidden="true"><circle cx="200" cy="200" r="188" fill="#141b2b" stroke="#e8b425" stroke-width="8"></circle><text x="200" y="200" text-anchor="middle" dominant-baseline="middle" fill="#e8b425" font-family="Inter, sans-serif" font-size="22" font-weight="800">TSH</text></svg>`;
  }
  const n = list.length;
  const slice = 360 / n;
  const font = n <= 4 ? 18 : n <= 8 ? 14 : n <= 12 ? 12 : n <= 20 ? 10 : 8;
  const textR = n >= 6 ? 128 : 118;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const [fill, ink] = sliceFill(i, n);
    const name = String(list[i]?.name || "Player");
    const mid = (i + 0.5) * slice;
    const [tx, ty] = polar(200, 200, textR, mid);
    let textRot = mid;
    if (mid > 90 && mid < 270) textRot += 180;
    const path = n === 1 ? `<circle cx="200" cy="200" r="188" fill="${fill}"></circle>` : `<path d="${slicePath(i * slice, (i + 1) * slice)}" fill="${fill}"></path>`;
    parts.push(
      `<g>${path}<title>${escXml(name)}</title><text x="${num(tx)}" y="${num(ty)}" fill="${ink}" font-family="Inter, sans-serif" font-size="${font}" font-weight="800" text-anchor="middle" dominant-baseline="middle" transform="rotate(${num(textRot)} ${num(tx)} ${num(ty)})">${escXml(wheelLabel(name, n))}</text></g>`
    );
  }
  const hub = `<circle cx="200" cy="200" r="46" fill="#090b11" stroke="#e8b425" stroke-width="4"></circle><text x="200" y="202" text-anchor="middle" dominant-baseline="middle" fill="#e8b425" font-family="Inter, sans-serif" font-size="16" font-weight="800">TSH</text>`;
  return `<svg viewBox="0 0 400 400" aria-hidden="true">${parts.join("")}${hub}</svg>`;
}
