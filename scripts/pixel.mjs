// Rasterize a TrueType font (Geist) onto a coarse pixel grid and emit the
// filled cells as merged rectangles. This reproduces the "pixelated Geist" look
// used across the profile's existing SVG assets (crispEdges, chunky 2px strokes).
import opentype from "opentype.js";

export const P = 2; // default pixel size in output units (matches existing assets)

// Sample cell size for a given cap height. Chunky 2px cells are the house style
// and fine for headings, but below ~20px of cap height a 2px cell is too coarse
// to resolve letterforms (the "c" aperture closes, "a" fills in, "k" loses its
// leg, so "Oct" renders as "Out"): those sizes sample on a 1px grid instead.
export const pixelSizeFor = (capHeightPx) => (capHeightPx < 20 ? 1 : P);

const CAP_RATIO = 0.72; // Geist cap-height / em (approx)

// Load a font once.
export function loadFont(path) {
  return opentype.loadSync(path);
}

// Flatten opentype path commands into an array of contours (polygons of {x,y}).
function flatten(commands) {
  const contours = [];
  let cur = null;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const lerp = (a, b, t) => a + (b - a) * t;
  for (const c of commands) {
    if (c.type === "M") {
      cur = [{ x: c.x, y: c.y }];
      contours.push(cur);
      cx = sx = c.x; cy = sy = c.y;
    } else if (c.type === "L") {
      cur.push({ x: c.x, y: c.y });
      cx = c.x; cy = c.y;
    } else if (c.type === "Q") {
      const n = 6;
      for (let i = 1; i <= n; i++) {
        const t = i / n, mt = 1 - t;
        const x = mt * mt * cx + 2 * mt * t * c.x1 + t * t * c.x;
        const y = mt * mt * cy + 2 * mt * t * c.y1 + t * t * c.y;
        cur.push({ x, y });
      }
      cx = c.x; cy = c.y;
    } else if (c.type === "C") {
      const n = 8;
      for (let i = 1; i <= n; i++) {
        const t = i / n, mt = 1 - t;
        const x = mt*mt*mt*cx + 3*mt*mt*t*c.x1 + 3*mt*t*t*c.x2 + t*t*t*c.x;
        const y = mt*mt*mt*cy + 3*mt*mt*t*c.y1 + 3*mt*t*t*c.y2 + t*t*t*c.y;
        cur.push({ x, y });
      }
      cx = c.x; cy = c.y;
    } else if (c.type === "Z") {
      cx = sx; cy = sy;
    }
  }
  return contours;
}

// Even-odd point-in-polygon test with a ray cast to +Infinity on x.
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

// Rasterize a string at a given fontSize (output units) with pixel size P.
// Returns { grid, cols, rows, minX, minY } where grid[r][c] is boolean.
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

// Greedy merge of filled cells into larger rectangles (cell units).
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

// Public: rasterize text and return merged rects in OUTPUT units, positioned so
// the ink's top-left lands at (x, y). Returns { rects, width, height, cell }.
// The origin is snapped to the cell grid, so the blocks stay on-grid and the
// text does not land on half-pixels of the 2px style.
export function textPixels(font, str, capHeightPx, x, y, cell = pixelSizeFor(capHeightPx)) {
  const fontSize = capHeightPx / CAP_RATIO;
  const sx = Math.round(x / cell) * cell;
  const sy = Math.round(y / cell) * cell;
  const { grid, cols, rows, minX, minY } = rasterText(font, str, fontSize, cell);
  const cellRects = mergeRects(grid, cols, rows);
  const rects = cellRects.map((rc) => ({
    x: sx + rc.x * cell, // origin snapped to the cell grid
    y: sy + rc.y * cell,
    w: rc.w * cell,
    h: rc.h * cell,
  }));
  return { rects, width: cols * cell, height: rows * cell, cell };
}

// Convert a list of rects {x,y,w,h} into a single SVG path 'd' string.
export function rectsToPath(rects) {
  let d = "";
  for (const r of rects) {
    const x = Math.round(r.x), y = Math.round(r.y);
    const w = Math.round(r.w), h = Math.round(r.h);
    d += `M${x} ${y}h${w}v${h}h${-w}z`;
  }
  return d;
}
