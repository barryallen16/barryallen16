// Generates the three profile stat cards (stats, top-langs, streak) as local
// SVGs in the profile's existing pixelarticons + pixelated-Geist style.
//
// Data is fetched LIVE from the same public card APIs the README widgets use —
// no GitHub token is involved:
//   github-readme-stats.vercel.app/api            -> stats card (its own title/desc)
//   github-readme-stats.vercel.app/api/top-langs  -> language rows + bar colours
//   github-readme-streak-stats.herokuapp.com      -> streak numbers + date ranges
// Run: node generate.mjs   (set TARGET_USER to render someone else)
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { textPixels, rectsToPath } from "./pixel.mjs";
import { themes, fonts } from "./theme.mjs";
import { chartIcon, flameIcon, codeIcon } from "./icons.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "assets");
const USER = process.env.TARGET_USER || "barryallen16";

const STATS_URL = `https://github-readme-stats.vercel.app/api?username=${encodeURIComponent(USER)}&show_icons=true&locale=en`;
// hide Jupyter Notebook: notebooks embed base64 plot images, and banksim alone
// carries 130MB of them, which outweighs every other language on the profile.
const LANGS_URL = `https://github-readme-stats.vercel.app/api/top-langs?username=${encodeURIComponent(USER)}&show_icons=true&locale=en&layout=compact&hide=Jupyter%20Notebook`;
// The legacy herokuapp host is the one the README widget links, but it is
// unreliable (it has served 503s and then hung); the maintained demolab host
// serves the same card byte-for-byte. Both are tried, so one bad host cannot
// leave the card ungenerated.
const STREAK_HOSTS = [
  "https://github-readme-streak-stats.herokuapp.com/",
  "https://streak-stats.demolab.com/",
];

// ---------------------------------------------------------------------------
// Live data fetching. These are shared public instances (the streak service is
// the README widget's own host), so requests are sequential and retried on the
// statuses those hosts use when they are busy.
// ---------------------------------------------------------------------------
// Every attempt is bounded: these hosts can accept the connection and then never
// answer, which would otherwise stall a scheduled run. Retries cover 429/5xx and
// network failures; a real 4xx answer is not retried.
export async function get(url, tries = 3, timeoutMs = 15000) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "profile-readme-stats" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${url} -> HTTP ${res.status}`);
      } else if (!res.ok) {
        throw new Error(`${url} -> HTTP ${res.status}`);
      } else {
        return await res.text();
      }
    } catch (e) {
      if (String(e.message).startsWith(`${url} -> HTTP`)) throw e;
      lastErr = e;
    }
    if (attempt < tries - 1) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`${url}: ${lastErr ? lastErr.message : "no response"} (${tries} tries, ${timeoutMs}ms each)`);
}

const unescape = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");
const strip = (html) => unescape(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const tag = (svg, name) => {
  const m = svg.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? strip(m[1]) : "";
};
// The cards print counts with thousands separators ("1,183"), and once a count
// gets big they shorten it ("84.0k"). Both forms are expanded here, and anything
// else throws, so a format change can never be read as a wrong number.
const int = (raw) => {
  const m = String(raw).trim().match(/^(\d[\d,]*(?:\.\d+)?)\s*([km]?)$/i);
  if (!m) throw new Error(`not a number: ${JSON.stringify(raw)}`);
  const suffix = m[2].toLowerCase();
  const n = Number(m[1].replace(/,/g, "")) * (suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : 1);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${JSON.stringify(raw)}`);
  return Math.round(n);
};

// The stats card states every metric in its own <desc>, e.g.
// "Total Stars Earned: 37, Total Commits (last year) : 710, ..."
export function parseStatsCard(svg) {
  const title = tag(svg, "title");
  const desc = tag(svg, "desc");
  const metric = (label) => {
    const m = desc.match(new RegExp(`${label}[^:]*:\\s*(\\d[\\d,]*(?:\\.\\d+)?[km]?)`, "i"));
    if (!m) throw new Error(`stats card is missing "${label}" (desc: ${JSON.stringify(desc)})`);
    return int(m[1]);
  };
  return {
    name: (title.match(/^(.*?)\s*'s GitHub Stats/i)?.[1] || "").trim(),
    rank: (title.match(/Rank:\s*([^,]+)/i)?.[1] || "").trim(),
    stars: metric("Total Stars Earned"),
    commits: metric("Total Commits"),
    prs: metric("Total PRs"),
    issues: metric("Total Issues"),
    contributedTo: metric("Contributed to"),
  };
}

// Each language row is "<name> <pct>%" next to a data-testid="lang-progress"
// bar painted in that language's colour, in the same order.
export function parseLangsCard(svg) {
  const names = [...svg.matchAll(/<text[^>]*data-testid="lang-name"[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => strip(m[1]));
  const colors = [...svg.matchAll(/<rect[^>]*data-testid="lang-progress"[^>]*?fill="(#[0-9a-fA-F]{6})"/g)]
    .map((m) => m[1]);
  if (!names.length) throw new Error("top-langs card has no language rows");
  if (names.length !== colors.length)
    throw new Error(`top-langs card: ${names.length} rows but ${colors.length} bar colours`);
  return names.map((row, i) => {
    const m = row.match(/^(.*\S)\s+([\d.]+)%$/);
    if (!m) throw new Error(`unexpected top-langs row: ${JSON.stringify(row)}`);
    return { name: m[1], pct: Number(m[2]), color: colors[i] };
  });
}

// Fetches the streak card, trying each host in turn. The optional host list is
// what the tests use to exercise the fallback path deliberately.
export async function fetchStreak(username = USER, hosts = STREAK_HOSTS) {
  const errors = [];
  for (const host of hosts) {
    try {
      return parseStreakCard(await get(`${host}?user=${encodeURIComponent(username)}&`, 2, 10000));
    } catch (e) {
      errors.push(`${host.replace(/^https:\/\//, "")}: ${e.message}`);
    }
  }
  throw new Error(`no streak host answered:\n  ${errors.join("\n  ")}`);
}

// The streak card repeats three columns (total / current / longest), each a
// 28px value, a 14px label and a 12px date range, positioned by translate(x, y).
// Columns are found by that label, never by left-to-right order: a positional read
// would put each number on the wrong label if the card ever reorders them, and that
// is exactly the silent wrong number this file refuses to produce anywhere else.
export function parseStreakCard(svg) {
  const rows = [...svg.matchAll(/<g transform='translate\(([-\d.]+), ([-\d.]+)\)'[^>]*>\s*<text([^>]*)>([\s\S]*?)<\/text>/g)]
    .map((m) => ({
      col: Number(m[1]),
      size: (m[3].match(/font-size='([^']+)'/) || [, "0"])[1],
      text: strip(m[4]),
    }));
  const cols = [...new Set(rows.map((r) => r.col))].sort((a, b) => a - b);
  if (cols.length !== 3) throw new Error(`streak card: expected 3 columns, found ${cols.length}`);
  const pick = (col, size, what) => {
    const row = rows.find((r) => r.col === col && r.size === size);
    if (!row) throw new Error(`streak card is missing the ${size} ${what} of column ${col}`);
    return row.text;
  };
  const byLabel = (word) => {
    const col = cols.find((c) => pick(c, "14px", "label").includes(word));
    if (col === undefined) throw new Error(`streak card has no "${word}" column`);
    return {
      value: int(pick(col, "28px", "value")),
      range: pick(col, "12px", "range"),
    };
  };
  const total = byLabel("Total"), current = byLabel("Current"), longest = byLabel("Longest");
  return {
    total: total.value,
    totalRange: total.range,
    current: current.value,
    currentRange: current.range,
    longest: longest.value,
    longestRange: longest.range,
  };
}

// ---------------------------------------------------------------------------
// SVG primitives — all coordinates land on the P=2 pixel grid (crispEdges)
// ---------------------------------------------------------------------------
// Also escapes the quote: the label lands in an aria-label="..." attribute, and a
// display name containing " would otherwise close it and emit invalid XML.
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

// Returns { rects, width, height }. (x, y) is the ink's TOP-LEFT corner.
function text(str, capPx, x, y, font) {
  return textPixels(font, str, capPx, x, y);
}

function svgOpen(w, h, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges"><title>${esc(label)}</title>`;
}

// dotted footer divider used across the existing assets
function dottedRule(y, width, color) {
  let d = "";
  for (let x = 2; x < width - 2; x += 8) d += `M${x} ${y}h4v4h-4z`;
  return `<path fill="${color}" d="${d}"/>`;
}

// 2px inner border, matching btn-*.svg
function frame(width, height, color) {
  const t = 2;
  return `<path fill="${color}" d="M2 0h${width - 4}v${t}h${-(width - 4)}z M2 ${height - t}h${width - 4}v${t}h${-(width - 4)}z M0 2h${t}v${height - 4}h${-t}z M${width - t} 2h${t}v${height - 4}h${-t}z"/>`;
}

// ---------------------------------------------------------------------------
// Card 1 — GitHub Stats
// ---------------------------------------------------------------------------
function statsCard(data, theme) {
  const F = fonts();
  const W = 460;
  const rows = [
    ["Total Stars", data.stars],
    ["Commits (last year)", data.commits],
    ["Total PRs", data.prs],
    ["Total Issues", data.issues],
    ["Contributed To", data.contributedTo],
  ];
  if (data.rank) rows.push(["Rank", data.rank]);
  const rowH = 36;
  const top = 78;
  const H = top + rows.length * rowH + 30;

  let paths = `<rect width="${W}" height="${H}" fill="${theme.bg}"/>`;
  // header icon + title (vertically centered on each other)
  const t20 = 20;
  const iconY = 26;
  paths += `<path fill="${theme.accent}" d="${rectsToPath(chartIcon.at(24, iconY))}"/>`;
  const title = text("GITHUB STATS", 20, 24 + chartIcon.width + 14, 28, F.medium);
  paths += `<path fill="${theme.text}" d="${rectsToPath(title.rects)}"/>`;
  paths += dottedRule(top - 20, W, theme.border);

  rows.forEach((r, i) => {
    const yTop = top + i * rowH;
    const lbl = text(r[0], 15, 26, yTop, F.regular);
    paths += `<path fill="${theme.muted}" d="${rectsToPath(lbl.rects)}"/>`;
    const vStr = String(r[1]);
    const vCap = 22;
    // measure first (draw at 0), then place right-aligned
    const probe = text(vStr, vCap, 0, 0, F.medium);
    const vx = W - 26 - probe.width;
    const vy = yTop - 4;
    const val = text(vStr, vCap, vx, vy, F.medium);
    paths += `<path fill="${theme.accent}" d="${rectsToPath(val.rects)}"/>`;
  });

  paths += dottedRule(H - 20, W, theme.border);
  paths += frame(W, H, theme.border);
  return { W, H, svg: `${svgOpen(W, H, `${data.name}'s GitHub stats`)}${paths}</svg>` };
}

// ---------------------------------------------------------------------------
// Card 2 — Most Used Languages
// ---------------------------------------------------------------------------
function langsCard(langs, theme) {
  const F = fonts();
  const W = 460;
  const rowH = 40;
  const top = 78;
  const H = top + langs.length * rowH + 30;

  let paths = `<rect width="${W}" height="${H}" fill="${theme.bg}"/>`;
  paths += `<path fill="${theme.accent}" d="${rectsToPath(codeIcon.at(24, 26))}"/>`;
  const title = text("MOST USED LANGUAGES", 20, 24 + codeIcon.width + 14, 28, F.medium);
  paths += `<path fill="${theme.text}" d="${rectsToPath(title.rects)}"/>`;
  paths += dottedRule(top - 20, W, theme.border);

  const barX = 26;
  const barW = W - 52;
  langs.forEach((l, i) => {
    const yTop = top + i * rowH;
    // language color swatch (filled square)
    paths += `<rect x="${barX}" y="${yTop}" width="14" height="14" fill="${l.color}"/>`;
    // name
    const nm = text(l.name, 15, barX + 22, yTop - 1, F.medium);
    paths += `<path fill="${theme.text}" d="${rectsToPath(nm.rects)}"/>`;
    // percentage right-aligned
    const pctStr = `${l.pct < 1 && l.pct > 0 ? "<1" : Math.round(l.pct)}%`;
    const probe = text(pctStr, 15, 0, 0, F.regular);
    const px = W - 26 - probe.width;
    const pct = text(pctStr, 15, px, yTop - 1, F.regular);
    paths += `<path fill="${theme.muted}" d="${rectsToPath(pct.rects)}"/>`;
    // bar track + fill
    const barY = yTop + 22;
    paths += `<rect x="${barX}" y="${barY}" width="${barW}" height="8" fill="${theme.track}"/>`;
    const fillW = Math.max(2, Math.round((barW * l.pct) / 100));
    paths += `<rect x="${barX}" y="${barY}" width="${fillW}" height="8" fill="${l.color}"/>`;
  });

  paths += dottedRule(H - 20, W, theme.border);
  paths += frame(W, H, theme.border);
  return { W, H, svg: `${svgOpen(W, H, "Most used languages")}${paths}</svg>` };
}

// ---------------------------------------------------------------------------
// Card 3 — Contribution Streak (numbers only; deliberately no calendar graph)
// ---------------------------------------------------------------------------
function streakCard(c, theme) {
  const F = fonts();
  const W = 460;
  const H = 220; // header + numbers only, no calendar graph

  let paths = `<rect width="${W}" height="${H}" fill="${theme.bg}"/>`;
  // header
  paths += `<path fill="${theme.accent}" d="${rectsToPath(flameIcon.at(24, 24))}"/>`;
  const title = text("CONTRIBUTION STREAK", 20, 24 + flameIcon.width + 14, 26, F.medium);
  paths += `<path fill="${theme.text}" d="${rectsToPath(title.rects)}"/>`;
  paths += dottedRule(70, W, theme.border);

  // big current streak number + label
  const big = text(String(c.curLen), 44, 26, 90, F.medium);
  paths += `<path fill="${theme.accent}" d="${rectsToPath(big.rects)}"/>`;
  const dayLbl = text(c.curLen === 1 ? "DAY CURRENT STREAK" : "DAYS CURRENT STREAK", 14,
    26 + big.width + 12, 96, F.regular);
  paths += `<path fill="${theme.text}" d="${rectsToPath(dayLbl.rects)}"/>`;
  const range = text(c.curRange, 13, 26 + big.width + 12, 116, F.regular);
  paths += `<path fill="${theme.muted}" d="${rectsToPath(range.rects)}"/>`;

  // longest streak row
  const l1 = text(`Longest Streak: ${c.bestLen}`, 14, 26, 142, F.regular);
  paths += `<path fill="${theme.muted}" d="${rectsToPath(l1.rects)}"/>`;
  const l1s = c.bestRange;
  const l1probe = text(l1s, 12, 0, 0, F.regular);
  const l1x = W - 26 - l1probe.width;
  const l1range = text(l1s, 12, l1x, 145, F.regular);
  paths += `<path fill="${theme.border}" d="${rectsToPath(l1range.rects)}"/>`;

  // totals row — the streak service exposes no daily calendar, and this card
  // deliberately draws no contribution graph
  paths += dottedRule(172, W, theme.border);
  const tot = text(`Total Contributions: ${c.total}`, 14, 26, 188, F.regular);
  paths += `<path fill="${theme.muted}" d="${rectsToPath(tot.rects)}"/>`;

  paths += frame(W, H, theme.border);
  return { W, H, svg: `${svgOpen(W, H, `Contribution streak: ${c.curLen} days`)}${paths}</svg>` };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  mkdirSync(OUT, { recursive: true });
  // Sequential (not parallel) to stay polite to the shared public instances.
  const stats = parseStatsCard(await get(STATS_URL));
  const langs = parseLangsCard(await get(LANGS_URL));
  const streak = await fetchStreak();
  console.log("stats:", stats);
  console.log("langs:", langs.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(", "));
  console.log("streak:", { total: streak.total, cur: streak.current, best: streak.longest });

  const cards = [
    ["stats", (th) => statsCard(stats, th)],
    ["top-langs", (th) => langsCard(langs, th)],
    ["streak", (th) => streakCard({
      total: streak.total,
      curLen: streak.current,
      curRange: streak.currentRange,
      bestLen: streak.longest,
      bestRange: streak.longestRange,
    }, th)],
  ];
  for (const [name, make] of cards) {
    for (const thName of ["dark", "light"]) {
      const { svg } = make(themes[thName]);
      const file = join(OUT, `${name}-${thName}.svg`);
      writeFileSync(file, svg);
      console.log("wrote", file, `${svg.length} bytes`);
    }
  }
}

// Runs when invoked as a script (`node generate.mjs`, absolute or relative) but
// not when imported, so the parsers can be tested without rewriting the assets.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
