// Pixel icons drawn on the same 2-unit pixel grid the profile's existing assets
// use (pixelarticons are 24x24 grid, fill=currentColor). Each icon is a list of
// strings; '#' = a filled 1x1 block. The renderer scales blocks to output units.
// Kept minimal + on-brand so the new stat cards match the existing SVG assets.

// Merge horizontal runs of '#' into rectangles (in block units).
function gridToRects(rows, block) {
  const rects = [];
  for (let y = 0; y < rows.length; y++) {
    let x = 0;
    const row = rows[y];
    while (x < row.length) {
      if (row[x] === "#") {
        let w = 1;
        while (x + w < row.length && row[x + w] === "#") w++;
        rects.push({ x: x * block, y: y * block, w: w * block, h: block });
        x += w;
      } else x++;
    }
  }
  return rects;
}

// Build an icon renderer. block = pixel size in output units (2 to match assets).
export function makeIcon(rows, block = 2) {
  const rects = gridToRects(rows, block);
  const width = Math.max(...rows.map((r) => r.length)) * block;
  const height = rows.length * block;
  return {
    width,
    height,
    // returns rects translated to (x, y)
    at(x, y) {
      return rects.map((r) => ({ x: x + r.x, y: y + r.y, w: r.w, h: r.h }));
    },
  };
}

// ---- Icon definitions (pixelarticons-style, on a ~14px grid) ----

// Bar chart (stats card): three ascending bars on a baseline.
export const chartIcon = makeIcon([
  "..............",
  "..........##..",
  "..........##..",
  ".......##.##..",
  ".......##.##..",
  "..##...##.##..",
  "..##...##.##..",
  "..##...##.##..",
  "..##...##.##..",
  "##############",
]);

// Flame (streak card): a pixel fire.
export const flameIcon = makeIcon([
  "......##......",
  ".....####.....",
  ".....####.....",
  "....######....",
  "...########...",
  "...########...",
  "...########...",
  "..##########..",
  "..##########..",
  "..##########..",
  "...######.##..",
  "....####..##..",
]);

// Code brackets / terminal (languages card).
export const codeIcon = makeIcon([
  "..............",
  ".##.......##..",
  ".###.....###..",
  "..###...###...",
  "...########...",
  "....######....",
  "...########...",
  "..###...###...",
  ".###.....###..",
  ".##.......##..",
]);

// Star (small stat marker, e.g. total stars).
export const starIcon = makeIcon([
  "......##......",
  "......##......",
  ".....####.....",
  ".....####.....",
  "##############",
  ".############.",
  "..##########..",
  "...########...",
  "...###..###...",
  "..###....###..",
]);

// Person / followers marker.
export const personIcon = makeIcon([
  "....####......",
  "...######.....",
  "...######.....",
  "....####......",
  "...######.....",
  "..########....",
  ".##########...",
  ".##########...",
  ".##.####.##...",
  ".##......##...",
]);
