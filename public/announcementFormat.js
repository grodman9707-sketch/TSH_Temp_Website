// Safe announcement body formatting. Markup is escaped first so stored text
// cannot inject HTML. Supported:
//   blank line          → new paragraph
//   single newline      → line break
//   [center]...[/center] → centered block
//   [indent]...[/indent] → indented block
//   [right]...[/right]   → right-aligned block
//   **bold**  *italic*
//   a line of ---        → divider
//   lines starting "- "  → bullet list
// Unicode (including emoji) is left as-is.

const BLOCK_ALIGN = {
  center: "news-center",
  indent: "news-indent",
  right: "news-right",
};

export const NEWS_EMOJIS = [
  "🎯", "🏆", "🥇", "🥈", "🥉", "🔥", "🎉", "🥳", "👏", "💪",
  "⭐", "✨", "💥", "🚀", "📣", "📅", "⏰", "🍻", "❤️", "💙",
  "⚡", "👑", "🎊", "🙌", "👍", "✅", "❗", "📌",
];

export const NEWS_HOME_MS = 7 * 24 * 60 * 60 * 1000;
export const NEWS_GLOW_MS = 48 * 60 * 60 * 1000;

export function announcementAgeMs(item, now = Date.now()) {
  const t = Date.parse(item?.createdAt);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return now - t;
}

export function isAnnouncementWithin(item, windowMs, now = Date.now()) {
  const age = announcementAgeMs(item, now);
  return age >= 0 && age < windowMs;
}

export function announcementsForHome(items, now = Date.now()) {
  return (Array.isArray(items) ? items : []).filter((item) => isAnnouncementWithin(item, NEWS_HOME_MS, now));
}

export function newsTabShouldGlow(items, now = Date.now()) {
  return (Array.isArray(items) ? items : []).some((item) => isAnnouncementWithin(item, NEWS_GLOW_MS, now));
}

export function escapeAnnouncement(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatAnnouncementBody(raw) {
  const text = String(raw ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return "";
  return formatBlocks(text).join("");
}

function formatBlocks(text) {
  const parts = [];
  const re = /\[(center|indent|right)\]([\s\S]*?)\[\/\1\]/gi;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(formatFlow(text.slice(last, m.index)));
    const cls = BLOCK_ALIGN[m[1].toLowerCase()];
    const inner = formatBlocks(m[2]);
    parts.push(`<div class="${cls}">${inner}</div>`);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(formatFlow(text.slice(last)));
  return parts;
}

function formatFlow(text) {
  const chunks = text.split(/\n{2,}/);
  return chunks.map(formatChunk).join("");
}

function formatChunk(chunk) {
  const trimmed = chunk.replace(/[ \t]+\n/g, "\n").replace(/^\n+|\n+$/g, "");
  if (!trimmed) return "";
  if (/^-{3,}$/.test(trimmed.trim())) return `<hr class="news-rule">`;
  const lines = trimmed.split("\n");
  if (lines.length && lines.every((line) => /^\s*-\s+/.test(line))) {
    const items = lines
      .map((line) => `<li>${formatInline(line.replace(/^\s*-\s+/, ""))}</li>`)
      .join("");
    return `<ul class="news-list">${items}</ul>`;
  }
  return `<p>${formatInline(trimmed).replace(/\n/g, "<br>")}</p>`;
}

function formatInline(s) {
  let html = escapeAnnouncement(s);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, "$1<em>$2</em>");
  return html;
}

export function applyAnnouncementFormat(value, start, end, kind, extra = "") {
  const text = String(value ?? "");
  const from = Math.max(0, Math.min(Number(start) || 0, text.length));
  const to = Math.max(from, Math.min(Number(end) || 0, text.length));
  const selected = text.slice(from, to);
  let insert = "";
  let selFrom = from;
  let selTo = from;

  if (kind === "bold") {
    const inner = selected || "bold text";
    insert = `**${inner}**`;
    selFrom = from + 2;
    selTo = selFrom + inner.length;
  } else if (kind === "italic") {
    const inner = selected || "italic text";
    insert = `*${inner}*`;
    selFrom = from + 1;
    selTo = selFrom + inner.length;
  } else if (kind === "center" || kind === "indent" || kind === "right") {
    const inner = selected || (kind === "center" ? "centered text" : kind === "right" ? "right-aligned text" : "indented text");
    insert = `[${kind}]${inner}[/${kind}]`;
    selFrom = from + kind.length + 2;
    selTo = selFrom + inner.length;
  } else if (kind === "para") {
    insert = selected ? `${selected}\n\n` : "\n\n";
    selFrom = selTo = from + insert.length;
  } else if (kind === "rule") {
    const needsLead = from > 0 && text[from - 1] !== "\n";
    const needsTrail = to < text.length && text[to] !== "\n";
    insert = `${needsLead ? "\n" : ""}---${needsTrail ? "\n" : ""}`;
    selFrom = selTo = from + insert.length;
  } else if (kind === "list") {
    const inner = selected || "list item";
    const items = inner.split("\n").map((line) => {
      const t = line.replace(/^\s*-\s+/, "").trimEnd();
      return t ? `- ${t.replace(/^\s+/, "")}` : "- ";
    });
    insert = items.join("\n");
    selFrom = from + 2;
    selTo = from + insert.length;
  } else if (kind === "emoji") {
    insert = String(extra || "");
    selFrom = selTo = from + insert.length;
  } else {
    insert = selected;
    selFrom = from;
    selTo = from + insert.length;
  }

  return {
    value: text.slice(0, from) + insert + text.slice(to),
    start: selFrom,
    end: selTo,
  };
}
