// Rasterize a TrueType font (Geist) onto a crisp integer pixel grid and emit
// filled cells as merged integer rectangles (shape-rendering="crispEdges").
import opentype from "opentype.js";

export const P = 2;

export const pixelSizeFor = (capHeightPx) => (capHeightPx < 24 ? 1 : P);

const CAP_RATIO = 0.71;

export function loadFont(path) {
  return opentype.loadSync(path);
}

function flatten(commands) {
  const contours = [];
  let cur = null;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const c of commands) {
    if (c.type === "M") {
      cur = [{ x: c.x, y: c.y }];
      contours.push(cur);
      cx = sx = c.x; cy = sy = c.y;
    } else if (c.type === "L") {
      cur.push({ x: c.x, y: c.y });
      cx = c.x; cy = c.y;
    } else if (c.type === "Q") {
      const n = 8;
      for (let i = 1; i <= n; i++) {
        const t = i / n, mt = 1 - t;
        cur.push({
          x: mt * mt * cx + 2 * mt * t * c.x1 + t * t * c.x,
          y: mt * mt * cy + 2 * mt * t * c.y1 + t * t * c.y,
        });
      }
      cx = c.x; cy = c.y;
    } else if (c.type === "C") {
      const n = 10;
      for (let i = 1; i <= n; i++) {
        const t = i / n, mt = 1 - t;
        cur.push({
          x: mt*mt*mt*cx + 3*mt*mt*t*c.x1 + 3*mt*t*t*c.x2 + t*t*t*c.x,
          y: mt*mt*mt*cy + 3*mt*mt*t*c.y1 + 3*mt*t*t*c.y2 + t*t*t*c.y,
        });
      }
      cx = c.x; cy = c.y;
    } else if (c.type === "Z") {
      cx = sx; cy = sy;
    }
  }
  return contours;
}

function inside(contours, x, y) {
  let hit = false;
  for (const pts of contours) {
    const n = pts.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = pts[i].x, yi = pts[i].y;
      const xj = pts[j].x, yj = pts[j].y;
      if ((yi > y) !== (yj > y)) {
        const xt = xi + ((y - yi) / (yj - yi)) * (xj - xi);
        if (x < xt) hit = !hit;
      }
    }
  }
  return hit;
}

export function rasterText(font, str, fontSize, cell = P) {
  const path = font.getPath(str, 0, 0, fontSize);
  if (!path.commands.length) return { grid: [], cols: 0, rows: 0, minX: 0, minY: 0 };
  const bb = path.getBoundingBox();
  const pad = cell;
  const minX = bb.x1 - pad;
  const minY = bb.y1 - pad;
  const cols = Math.max(1, Math.ceil((bb.x2 - bb.x1 + 2 * pad) / cell));
  const rows = Math.max(1, Math.ceil((bb.y2 - bb.y1 + 2 * pad) / cell));
  const contours = flatten(path.commands);
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const cy = minY + (r + 0.5) * cell;
    const row = [];
    for (let c = 0; c < cols; c++) {
      const cx = minX + (c + 0.5) * cell;
      row.push(inside(contours, cx, cy));
    }
    grid.push(row);
  }
  return { grid, cols, rows, minX, minY };
}

function mergeRects(grid, cols, rows) {
  const used = grid.map((row) => row.map(() => false));
  const rects = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] && !used[r][c]) {
        let w = 1;
        while (c + w < cols && grid[r][c + w] && !used[r][c + w]) w++;
        let h = 1;
        outer: while (r + h < rows) {
          for (let k = 0; k < w; k++) {
            if (!(grid[r + h][c + k] && !used[r + h][c + k])) break outer;
          }
          h++;
        }
        for (let rr = r; rr < r + h; rr++)
          for (let cc = c; cc < c + w; cc++) used[rr][cc] = true;
        rects.push({ x: c, y: r, w, h });
      }
    }
  }
  return rects;
}

const glyphCache = new WeakMap();
function getCharGrid(font, ch, capHeightPx) {
  let fMap = glyphCache.get(font);
  if (!fMap) { fMap = new Map(); glyphCache.set(font, fMap); }
  const key = `${ch}@${capHeightPx}`;
  if (fMap.has(key)) return fMap.get(key);

  const fontSize = capHeightPx / CAP_RATIO;
  const wHH = font.getPath("HH", 0, 0, fontSize).getBoundingBox();
  const wHchH = font.getPath("H" + ch + "H", 0, 0, fontSize).getBoundingBox();
  const adv = Math.max(1, Math.round((wHchH.x2 - wHchH.x1) - (wHH.x2 - wHH.x1)));

  const path = font.getPath(ch, 0, 0, fontSize);
  if (!path.commands.length) {
    const empty = { rects: [], adv };
    fMap.set(key, empty);
    return empty;
  }
  const bb = path.getBoundingBox();
  const lsb = Math.round(bb.x1);
  const shiftX = 1.08 - bb.x1;
  const cols = Math.max(1, Math.ceil(bb.x2 - bb.x1) + 3);
  const y0 = Math.floor(-capHeightPx) - 4;
  const rows = Math.ceil(capHeightPx) + 12;
  const rawContours = flatten(path.commands);
  const contours = rawContours.map((pts) => pts.map((p) => ({ x: p.x + shiftX, y: p.y })));

  const grid = [];
  for (let r = 0; r < rows; r++) {
    const cy = y0 + r + 0.5;
    const row = [];
    for (let c = 0; c < cols; c++) {
      const cx = c + 0.5;
      const hit =
        inside(contours, cx, cy) ||
        inside(contours, cx - 0.26, cy) ||
        inside(contours, cx + 0.26, cy);
      row.push(hit);
    }
    grid.push(row);
  }
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 0; c < cols - 3; c++) {
      if (!grid[r][c] && grid[r][c+1] && grid[r][c+2] && grid[r][c+3] && !grid[r][c+4]) {
        if (grid[r-1][c+1] && grid[r+1][c+1] && grid[r-1][c+3] && grid[r+1][c+3]) {
          grid[r][c+3] = false;
        }
      }
    }
  }
  const merged = mergeRects(grid, cols, rows).map((rc) => ({
    x: (rc.x - 1) + lsb,
    y: Math.round(y0 + capHeightPx) + rc.y,
    w: rc.w,
    h: rc.h,
  }));
  const res = { rects: merged, adv };
  fMap.set(key, res);
  return res;
}

export function textPixels(font, str, capHeightPx, x, y, cell = 1) {
  let curX = Math.round(x);
  const sy = Math.round(y);
  const rects = [];
  let totalW = 0;
  for (const ch of String(str)) {
    const g = getCharGrid(font, ch, capHeightPx);
    for (const r of g.rects) {
      rects.push({
        x: curX + r.x,
        y: sy + r.y,
        w: r.w,
        h: r.h,
      });
    }
    curX += g.adv;
    totalW += g.adv;
  }
  return { rects, width: totalW, height: Math.round(capHeightPx), cell: 1 };
}

export function rectsToPath(rects) {
  let d = "";
  for (const r of rects) {
    const x = Math.round(r.x), y = Math.round(r.y);
    const w = Math.round(r.w), h = Math.round(r.h);
    d += `M${x} ${y}h${w}v${h}h${-w}z`;
  }
  return d;
}