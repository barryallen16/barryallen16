// Generates the three profile stat cards (stats, top-langs, streak) AND compacts
// the static profile SVG assets (title, row-*, h-*, btn-*, tools) onto an exact
// 1:1 physical-pixel grid (shape-rendering="crispEdges") with Gestalt spacing laws
// (Law of Proximity, Common Region padding, and 3-tier vertical rhythm) so the
// entire profile README fits on one screen without scrolling or breaking pixels.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { textPixels, rectsToPath } from "./pixel.mjs";
import { themes, fonts } from "./theme.mjs";
import { chartIcon, flameIcon, codeIcon } from "./icons.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "assets");
const USER = process.env.TARGET_USER || "barryallen16";

const STATS_URL = `https://github-readme-stats.vercel.app/api?username=${encodeURIComponent(USER)}&show_icons=true&locale=en`;
const LANGS_URL = `https://github-readme-stats.vercel.app/api/top-langs?username=${encodeURIComponent(USER)}&show_icons=true&locale=en&layout=compact&hide=Jupyter%20Notebook`;
const STREAK_HOSTS = [
  "https://github-readme-streak-stats.herokuapp.com/",
  "https://streak-stats.demolab.com/",
];

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
const int = (raw) => {
  const m = String(raw).trim().match(/^(\d[\d,]*(?:\.\d+)?)\s*([km]?)$/i);
  if (!m) throw new Error(`not a number: ${JSON.stringify(raw)}`);
  const suffix = m[2].toLowerCase();
  const n = Number(m[1].replace(/,/g, "")) * (suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : 1);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${JSON.stringify(raw)}`);
  return Math.round(n);
};

export function parseStatsCard(svg) {
  const title = tag(svg, "title");
  const desc = tag(svg, "desc");
  const metric = (label) => {
    const m = desc.match(new RegExp(`${label}[^:]*:\\s*([\\d,]+(?:\\.\\d+)?[km]?)`, "i"));
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
// SVG primitives — CSS width/height = 0.80 * viewBox so on a 1.25x (125%)
// display, 0.80 * 1.25 = 1.0000 physical screen pixel per viewBox unit!
// ---------------------------------------------------------------------------
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function text(str, capPx, x, y, font) {
  return textPixels(font, str, capPx, x, y);
}

function svgOpen(vbW, vbH, label) {
  const cssW = Math.round(vbW * 0.8);
  const cssH = Math.round(vbH * 0.8);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cssW}" height="${cssH}" viewBox="0 0 ${vbW} ${vbH}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges"><title>${esc(label)}</title>`;
}

function dottedRule(y, width, color) {
  let d = "";
  for (let x = 2; x < width - 2; x += 8) d += `M${x} ${y}h4v4h-4z`;
  return `<path fill="${color}" d="${d}"/>`;
}

function dottedVRule(x, y1, y2, color) {
  let d = "";
  for (let y = y1; y <= y2 - 4; y += 8) d += `M${x} ${y}h4v4h-4z`;
  return `<path fill="${color}" d="${d}"/>`;
}

function frame(width, height, color) {
  const t = 2;
  return `<path fill="${color}" d="M2 0h${width - 4}v${t}h${-(width - 4)}z M2 ${height - t}h${width - 4}v${t}h${-(width - 4)}z M0 2h${t}v${height - 4}h${-t}z M${width - t} 2h${t}v${height - 4}h${-t}z"/>`;
}

// ---------------------------------------------------------------------------
// Compact Static SVG Assets with Gestalt Proximity & Common Region Spacing
// ---------------------------------------------------------------------------
function getBounds(dStr) {
  const tokens = dStr.match(/[MVHZ]|[-+]?\d*\.?\d+/g) || [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "M") {
      const x = Number(tokens[i+1]), y = Number(tokens[i+2]);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      i += 3;
    } else if (t === "H") {
      const x = Number(tokens[i+1]);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      i += 2;
    } else if (t === "V") {
      const y = Number(tokens[i+1]);
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      i += 2;
    } else i += 1;
  }
  return { minX, maxX, minY, maxY };
}

function shiftD(dStr, dx, dy) {
  const tokens = dStr.match(/[MVHZ]|[-+]?\d*\.?\d+/g) || [];
  let out = "", i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "M") {
      out += `M${Math.round(Number(tokens[i+1]) + dx)} ${Math.round(Number(tokens[i+2]) + dy)}`;
      i += 3;
    } else if (t === "H") {
      out += `H${Math.round(Number(tokens[i+1]) + dx)}`;
      i += 2;
    } else if (t === "V") {
      out += `V${Math.round(Number(tokens[i+1]) + dy)}`;
      i += 2;
    } else if (t === "Z") {
      out += "Z";
      i += 1;
    } else i += 1;
  }
  return out;
}

function compactStaticAssets() {
  const VB_FULL_W = 1000;
  const titleFile = join(OUT, "title-dark.svg");
  if (!existsSync(titleFile)) return;
  const origTitle = readFileSync(titleFile, "utf8");

  // 1. Hero Title (vbH = 85):
  //    - Heading ("Hi, I'm Jayadithya"): y = 0..46
  //    - 6px gap -> Subtitle ("A Curious AI Engineer"): y = 52..75 (including g descender)
  //    - 5px gap -> Dotted rule at y = 80..84
  const tPaths = [...origTitle.matchAll(/<path fill="[^"]+" d="([^"]+)"\/>/g)].map((m) => m[1]);
  const [handD, hiD, subD] = tPaths;
  const hiB = getBounds(hiD);
  const subB = getBounds(subD);
  const hiShifted = shiftD(hiD, 0, -hiB.minY);
  const subShifted = shiftD(subD, 0, 50 - subB.minY);
  for (const [mode, th] of Object.entries(themes)) {
    const vbW = VB_FULL_W, vbH = 90;
    const svg = `${svgOpen(vbW, vbH, "Hi, I'm Jayadithya. A Curious AI Engineer")}<g transform="translate(0 -5) scale(2)"><path fill="${th.text}" d="${handD}"/></g><path fill="${th.text}" d="${hiShifted}"/><path fill="${th.muted}" d="${subShifted}"/><rect x="285" y="52" width="14" height="19" fill="${th.accent}"><animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="1.1s" begin="0.4s" repeatCount="indefinite"/></rect>${dottedRule(77, vbW, th.border)}</svg>`;
    writeFileSync(join(OUT, `title-${mode}.svg`), svg);
  }

  // 2. Section Headings (h-connect, h-tools) (vbH = 40):
  //    Law of Proximity: 9px top margin inside SVG (17px total break from previous section),
  //    4px gap below 'Languages' g-descender to dotted rule at y=36..40.
  for (const [hname, label] of [["h-connect", "Connect with me:"], ["h-tools", "Languages and Tools:"]]) {
    const origH = readFileSync(join(OUT, `${hname}-dark.svg`), "utf8");
    const hp = [...origH.matchAll(/<path fill="[^"]+" d="([^"]+)"\/>/g)].map((m) => m[1]);
    const hB = getBounds(hp[1]);
    const txtShifted = shiftD(hp[1], 0, 14 - hB.minY);
    for (const [mode, th] of Object.entries(themes)) {
      const vbW = VB_FULL_W, vbH = 45;
      const svg = `${svgOpen(vbW, vbH, label)}<g transform="translate(0 11)"><path fill="${th.text}" d="${hp[0]}"/></g><path fill="${th.text}" d="${txtShifted}"/>${dottedRule(40, vbW, th.border)}</svg>`;
      writeFileSync(join(OUT, `${hname}-${mode}.svg`), svg);
    }
  }

  // 3. Bio/Contact Rows (row-learning, row-email, row-projects, row-resume) (vbH = 25):
  const rowConfigs = [
    ["row-learning", "Currently learning: Rust and Inference Engineering", false, "text", 705],
    ["row-email", "How to reach me: rjayadithya11@gmail.com", true, "accent", 625],
    ["row-projects", "My projects: jayadithya.is-a.dev", true, "accent", 540],
    ["row-resume", "My experience: jayadithya.is-a.dev/resume", true, "accent", 640],
  ];
  for (const [rname, label, hasUline, valKey, vbW] of rowConfigs) {
    const origR = readFileSync(join(OUT, `${rname}-dark.svg`), "utf8");
    const rp = [...origR.matchAll(/<path fill="[^"]+" d="([^"]+)"\/>/g)].map((m) => m[1]);
    const dy = 1 - getBounds(rp[1]).minY;
    const lblShifted = shiftD(rp[1], 0, dy);
    const valShifted = shiftD(rp[2], 0, dy);
    const vbH = 25;
    const ulineMatch = origR.match(/<rect x="303" y="[^"]+" width="(\d+)"/);
    const ulineW = hasUline && ulineMatch ? Number(ulineMatch[1]) : 0;
    for (const [mode, th] of Object.entries(themes)) {
      const ulineSvg = hasUline ? `<rect x="303" y="23" width="${ulineW}" height="2" fill="${th.accent}"/>` : "";
      const svg = `${svgOpen(vbW, vbH, label)}<g transform="translate(0 -1)"><path fill="${th.text}" d="${rp[0]}"/></g><path fill="${th.muted}" d="${lblShifted}"/><path fill="${th[valKey]}" d="${valShifted}"/>${ulineSvg}</svg>`;
      writeFileSync(join(OUT, `${rname}-${mode}.svg`), svg);
    }
  }

  // 4. Social Buttons (btn-github, btn-linkedin, btn-leetcode) (vbH = 35):
  const btnConfigs = [
    ["btn-github", "GitHub", 150, 48],
    ["btn-linkedin", "LinkedIn", 165, 49],
    ["btn-leetcode", "LeetCode", 175, 49],
  ];
  for (const [bname, label, vbW, targetMinX] of btnConfigs) {
    const origB = readFileSync(join(OUT, `${bname}-dark.svg`), "utf8");
    const bp = [...origB.matchAll(/<path fill="[^"]+" d="([^"]+)"\/>/g)].map((m) => m[1]);
    const vbH = 35;
    const tB = getBounds(bp[2]);
    const txtShifted = shiftD(bp[2], targetMinX - tB.minX, 8 - tB.minY);
    for (const [mode, th] of Object.entries(themes)) {
      const svg = `${svgOpen(vbW, vbH, label)}${frame(vbW, vbH, th.border)}<g transform="translate(11 6)"><path fill="${th.text}" d="${bp[1]}"/></g><path fill="${th.text}" d="${txtShifted}"/></svg>`;
      writeFileSync(join(OUT, `${bname}-${mode}.svg`), svg);
    }
  }

  // 5. Tool Badges Grid (tools) (vbH = 110):
  //    8px horizontal gap, 7px vertical gap between rows, and 9px bottom margin
  //    inside the SVG so the Stats Table sits 15px below the last badge row.
  const origTools = readFileSync(join(OUT, "tools-dark.svg"), "utf8");
  const ariaTools = origTools.match(/aria-label="([^"]+)"/)[1];
  const badgeGroups = [...origTools.matchAll(/<g transform="translate\(\d+ \d+\)"><path fill="[^"]+" d="M2 0h(\d+)v2[^"]+"\/>\s*<path fill="[^"]+" d="([^"]+)"\/><\/g>/g)];
  const padX = 11, gapX = 8, badgeH = 29, gapY = 7;
  const rows = [[]];
  let curW = 0;
  for (const m of badgeGroups) {
    const rawTxt = m[2];
    const tB = getBounds(rawTxt);
    const txtW = Math.round(tB.maxX - tB.minX);
    const bw = txtW + 2 * padX;
    const txtShifted = shiftD(rawTxt, padX - tB.minX, 5 - tB.minY);
    if (curW + (curW > 0 ? gapX : 0) + bw <= VB_FULL_W) {
      curW += (curW > 0 ? gapX : 0) + bw;
      rows[rows.length - 1].push([bw, txtShifted]);
    } else {
      rows.push([[bw, txtShifted]]);
      curW = bw;
    }
  }
  const vbH = 110;
  for (const [mode, th] of Object.entries(themes)) {
    let groupsSvg = "";
    rows.forEach((rBadges, rIdx) => {
      let cx = 0;
      const yOff = rIdx * (badgeH + gapY);
      for (const [bw, txtShifted] of rBadges) {
        groupsSvg += `<g transform="translate(${cx} ${yOff})">${frame(bw, badgeH, th.border)}<path fill="${th.text}" d="${txtShifted}"/></g>`;
        cx += bw + gapX;
      }
    });
    const svg = `${svgOpen(VB_FULL_W, vbH, ariaTools)}${groupsSvg}</svg>`;
    writeFileSync(join(OUT, `tools-${mode}.svg`), svg);
  }
  console.log("Compacted all 22 static SVG assets with Gestalt spacing!");
}

// ---------------------------------------------------------------------------
// Dynamic Stat Cards (stats, top-langs, streak)
// ---------------------------------------------------------------------------
const CARD_W = Number(process.env.CARD_W) || 475;
const STREAK_W = Number(process.env.STREAK_W) || 985;

function statsCard(data, theme, minH = 0) {
  const F = fonts();
  const W = CARD_W;
  const rows = [
    ["Total Stars", data.stars],
    ["Commits (last year)", data.commits],
    ["Total PRs", data.prs],
    ["Total Issues", data.issues],
    ["Contributed To", data.contributedTo],
  ];
  if (data.rank) rows.push(["Rank", data.rank]);
  const padX = 20;
  const rowH = 24;
  const top = 46;
  const rawH = Math.max(top + rows.length * rowH + 10, minH);
  const H = Math.ceil(rawH / 5) * 5;

  let paths = `<rect width="${W}" height="${H}" fill="${theme.bg}"/>`;
  paths += `<path fill="${theme.accent}" d="${rectsToPath(chartIcon.at(padX, 10))}"/>`;
  const title = text("GITHUB STATS", 18, padX + chartIcon.width + 12, 11, F.medium);
  paths += `<path fill="${theme.text}" d="${rectsToPath(title.rects)}"/>`;
  paths += dottedRule(34, W, theme.border);

  rows.forEach((r, i) => {
    const yTop = top + i * rowH;
    const lbl = text(r[0], 14, padX, yTop, F.regular);
    paths += `<path fill="${theme.muted}" d="${rectsToPath(lbl.rects)}"/>`;
    const vStr = String(r[1]);
    const vCap = 18;
    const probe = text(vStr, vCap, 0, 0, F.medium);
    const vx = W - padX - probe.width;
    const vy = yTop - 3;
    const val = text(vStr, vCap, vx, vy, F.medium);
    paths += `<path fill="${theme.accent}" d="${rectsToPath(val.rects)}"/>`;
  });

  paths += frame(W, H, theme.border);
  return { W, H, svg: `${svgOpen(W, H, `${data.name}'s GitHub stats`)}${paths}</svg>` };
}

function langsCard(langs, theme, minH = 0) {
  const F = fonts();
  const W = CARD_W;
  const padX = 20;
  const rowH = 24;
  const top = 46;
  const rawH = Math.max(top + langs.length * rowH + 10, minH);
  const H = Math.ceil(rawH / 5) * 5;

  let paths = `<rect width="${W}" height="${H}" fill="${theme.bg}"/>`;
  paths += `<path fill="${theme.accent}" d="${rectsToPath(codeIcon.at(padX, 10))}"/>`;
  const title = text("MOST USED LANGUAGES", 18, padX + codeIcon.width + 12, 11, F.medium);
  paths += `<path fill="${theme.text}" d="${rectsToPath(title.rects)}"/>`;
  paths += dottedRule(34, W, theme.border);

  const barX = padX;
  const barW = W - 2 * padX;
  langs.forEach((l, i) => {
    const yTop = top + i * rowH;
    // Swatch + label + right-aligned percentage
    paths += `<rect x="${barX}" y="${yTop - 1}" width="10" height="10" fill="${l.color}"/>`;
    const nm = text(l.name, 13, barX + 16, yTop - 4, F.medium);
    paths += `<path fill="${theme.text}" d="${rectsToPath(nm.rects)}"/>`;
    const pctStr = `${l.pct < 1 && l.pct > 0 ? "<1" : Math.round(l.pct)}%`;
    const probe = text(pctStr, 13, 0, 0, F.regular);
    const px = W - barX - probe.width;
    const pct = text(pctStr, 13, px, yTop - 4, F.regular);
    paths += `<path fill="${theme.muted}" d="${rectsToPath(pct.rects)}"/>`;
    // Progress bar 2px clear of p/y descenders (yTop + 14..18) and 6px above next row
    const barY = yTop + 14;
    paths += `<rect x="${barX}" y="${barY}" width="${barW}" height="4" fill="${theme.track}"/>`;
    const fillW = Math.max(2, Math.round((barW * l.pct) / 100));
    paths += `<rect x="${barX}" y="${barY}" width="${fillW}" height="4" fill="${l.color}"/>`;
  });

  paths += frame(W, H, theme.border);
  return { W, H, svg: `${svgOpen(W, H, "Most used languages")}${paths}</svg>` };
}

function streakCard(c, theme) {
  const F = fonts();
  const W = STREAK_W;
  const H = 85;
  const padX = 20;

  let paths = `<rect width="${W}" height="${H}" fill="${theme.bg}"/>`;
  paths += `<path fill="${theme.accent}" d="${rectsToPath(flameIcon.at(padX, 8))}"/>`;
  const title = text("CONTRIBUTION STREAK", 18, padX + flameIcon.width + 12, 11, F.medium);
  paths += `<path fill="${theme.text}" d="${rectsToPath(title.rects)}"/>`;
  paths += dottedRule(33, W, theme.border);

  // Col 1: Current Streak
  const big = text(String(c.curLen), 26, padX, 46, F.medium);
  paths += `<path fill="${theme.accent}" d="${rectsToPath(big.rects)}"/>`;
  const dayLbl = text(c.curLen === 1 ? "DAY CURRENT STREAK" : "DAYS CURRENT STREAK", 14,
    padX + big.width + 14, 45, F.medium);
  paths += `<path fill="${theme.text}" d="${rectsToPath(dayLbl.rects)}"/>`;
  const range = text(c.curRange, 13, padX + big.width + 14, 62, F.regular);
  paths += `<path fill="${theme.muted}" d="${rectsToPath(range.rects)}"/>`;

  paths += dottedVRule(356, 43, 76, theme.border);

  // Col 2: Longest Streak
  const l1 = text(`Longest Streak: ${c.bestLen}`, 14, 382, 45, F.medium);
  paths += `<path fill="${theme.text}" d="${rectsToPath(l1.rects)}"/>`;
  const l1range = text(c.bestRange, 13, 382, 62, F.regular);
  paths += `<path fill="${theme.muted}" d="${rectsToPath(l1range.rects)}"/>`;

  paths += dottedVRule(660, 43, 76, theme.border);

  // Col 3: Total Contributions + Date Range (balanced 2-line hierarchy across all 3 columns)
  const tot = text(`Total Contributions: ${c.total}`, 14, 686, 45, F.medium);
  paths += `<path fill="${theme.accent}" d="${rectsToPath(tot.rects)}"/>`;
  if (c.totalRange) {
    const trange = text(c.totalRange, 13, 686, 62, F.regular);
    paths += `<path fill="${theme.muted}" d="${rectsToPath(trange.rects)}"/>`;
  }

  paths += frame(W, H, theme.border);
  return { W, H, svg: `${svgOpen(W, H, `Contribution streak: ${c.curLen} days`)}${paths}</svg>` };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  compactStaticAssets();

  let stats, langs, streak;
  if (process.env.OFFLINE_DATA === "1") {
    stats = { name: "Jayadithya", rank: "B-", stars: 37, commits: 842, prs: 3, issues: 2, contributedTo: 2 };
    langs = [
      { name: "Python", pct: 45.0, color: "#3572A5" },
      { name: "JavaScript", pct: 26.0, color: "#f1e05a" },
      { name: "HTML", pct: 17.0, color: "#e34c26" },
      { name: "TypeScript", pct: 8.0, color: "#3178c6" },
      { name: "Rust", pct: 3.0, color: "#dea584" },
      { name: "CSS", pct: 0.8, color: "#663399" },
    ];
    streak = {
      total: 1334,
      totalRange: "May 18, 2023 - Present",
      current: 122,
      currentRange: "Jun 25 - Oct 24",
      longest: 122,
      longestRange: "Jun 25 - Oct 24",
    };
  } else {
    stats = parseStatsCard(await get(STATS_URL));
    langs = parseLangsCard(await get(LANGS_URL));
    streak = await fetchStreak();
  }
  const rowHeight = Math.max(statsCard(stats, themes.dark).H, langsCard(langs, themes.dark).H);
  const cards = [
    ["stats", (th) => statsCard(stats, th, rowHeight)],
    ["top-langs", (th) => langsCard(langs, th, rowHeight)],
    ["streak", (th) => streakCard({
      total: streak.total,
      totalRange: streak.totalRange,
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}