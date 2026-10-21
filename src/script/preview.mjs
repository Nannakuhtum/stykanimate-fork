/** Headless previews of a compiled script, for agents that cannot open the app.
 *
 * Frames are evaluated by the app's own Editor and geometry (the same poses,
 * easing and camera the timeline plays), then drawn with a small software
 * rasterizer: lines with round caps and circles, which is everything the
 * scripted rig and props use. Output is SVG, PNG (contact sheets or single
 * frames) or raw RGB frames for a video encoder. Sprites, text, effects and
 * drawing layers are not drawn here; the app remains the reference.
 */
import {deflateSync} from 'node:zlib';
import {Editor} from '../editor.mjs';
import {cameraMatrix} from '../renderer-geometry.mjs';

/** Loads a compiled report into a private Editor for sampling. */
export function previewSession(report) {
  const editor = new Editor({demo: false, layerTimeline: true});
  editor.load(structuredClone(report));
  return editor;
}

/** The drawable primitives of one frame in output pixels (`width` wide, camera applied). */
export function sampleFrame(editor, tick, {width = editor.report.canvas_width} = {}) {
  const report = editor.report, frame = editor.seek(tick), geometry = editor.geometry;
  const factor = width / report.canvas_width;
  const [a, b, c, d, e, f] = cameraMatrix({report, frame});
  const map = p => ({x: (a * p.x + c * p.y + e) * factor, y: (b * p.x + d * p.y + f) * factor});
  const scale = Math.hypot(a, b) * factor;
  const items = [];
  for (const drawable of geometry.drawables) {
    if (drawable.alpha === 0 || drawable.opacity === 0 || drawable.seg?.visible === false) continue;
    const rgb = drawable.rgb ?? [0, 0, 0], alpha = (drawable.alpha ?? 1) * (drawable.opacity ?? 1);
    if (drawable.type === 'line') {
      items.push({type: 'line', a: map(drawable.start), b: map(drawable.end), width: Math.max(0.6, drawable.thickness * scale), rgb, alpha});
    } else if (drawable.type === 'circle') {
      const s = map(drawable.start), t = map(drawable.end), fill = /fill/i.test(drawable.seg?.segment_kind ?? '');
      items.push({type: 'circle', c: {x: (s.x + t.x) / 2, y: (s.y + t.y) / 2}, r: Math.hypot(t.x - s.x, t.y - s.y) / 2,
        width: Math.max(fill ? 0 : 0.8, drawable.thickness * scale), fill, rgb, alpha});
    }
  }
  return {items, width, height: Math.round(report.canvas_height * factor), tick};
}

const hex = rgb => `#${rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** A contact sheet (or a single frame) as SVG markup. */
export function sheetSVG(frames, {columns = 4, background = [255, 255, 255], labels = [], gap = 8, labelHeight = 18} = {}) {
  const w = frames[0]?.width ?? 320, h = frames[0]?.height ?? 180, rows = Math.ceil(frames.length / columns);
  const cell = (frame, i) => {
    const x = gap + (i % columns) * (w + gap), y = gap + Math.floor(i / columns) * (h + gap + labelHeight);
    const shapes = frame.items.map(item => item.type === 'line'
      ? `<line x1="${item.a.x.toFixed(1)}" y1="${item.a.y.toFixed(1)}" x2="${item.b.x.toFixed(1)}" y2="${item.b.y.toFixed(1)}" stroke="${hex(item.rgb)}" stroke-width="${item.width.toFixed(2)}" stroke-linecap="round" stroke-opacity="${item.alpha}"/>`
      : `<circle cx="${item.c.x.toFixed(1)}" cy="${item.c.y.toFixed(1)}" r="${item.r.toFixed(1)}" ${item.fill ? `fill="${hex(item.rgb)}"` : `fill="none" stroke="${hex(item.rgb)}" stroke-width="${item.width.toFixed(2)}"`} opacity="${item.alpha}"/>`).join('');
    return `<g transform="translate(${x} ${y})"><svg width="${w}" height="${h}" overflow="hidden"><rect width="${w}" height="${h}" fill="${hex(background)}"/>${shapes}</svg>` +
      `<text x="0" y="${h + 13}" font-family="sans-serif" font-size="12" fill="#444">${escapeXml(labels[i] ?? `frame ${frame.tick + 1}`)}</text></g>`;
  };
  const width = gap + columns * (w + gap), height = gap + rows * (h + gap + labelHeight);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#e9e9e4"/>${frames.map(cell).join('')}</svg>`;
}
const escapeXml = text => String(text).replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'}[c]));

/** Rasterizes one sampled frame into an RGB buffer (anti-aliased by coverage). */
export function rasterizeFrame(frame, {background = [255, 255, 255], target, stride, offsetX = 0, offsetY = 0} = {}) {
  const {width, height} = frame;
  stride ??= width;
  const out = target ?? new Uint8ClampedArray(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = ((y + offsetY) * stride + x + offsetX) * 3;
    out[o] = background[0]; out[o + 1] = background[1]; out[o + 2] = background[2];
  }
  for (const item of frame.items) {
    const half = item.width / 2;
    let x0, x1, y0, y1;
    if (item.type === 'line') {
      x0 = Math.min(item.a.x, item.b.x) - half - 1; x1 = Math.max(item.a.x, item.b.x) + half + 1;
      y0 = Math.min(item.a.y, item.b.y) - half - 1; y1 = Math.max(item.a.y, item.b.y) + half + 1;
    } else { x0 = item.c.x - item.r - half - 1; x1 = item.c.x + item.r + half + 1; y0 = item.c.y - item.r - half - 1; y1 = item.c.y + item.r + half + 1; }
    const xs = Math.max(0, Math.floor(x0)), xe = Math.min(width - 1, Math.ceil(x1)), ys = Math.max(0, Math.floor(y0)), ye = Math.min(height - 1, Math.ceil(y1));
    const dx = item.b ? item.b.x - item.a.x : 0, dy = item.b ? item.b.y - item.a.y : 0, len2 = dx * dx + dy * dy;
    for (let y = ys; y <= ye; y++) for (let x = xs; x <= xe; x++) {
      const px = x + 0.5, py = y + 0.5;
      let distance;
      if (item.type === 'line') {
        const t = len2 ? Math.max(0, Math.min(1, ((px - item.a.x) * dx + (py - item.a.y) * dy) / len2)) : 0;
        distance = Math.hypot(px - item.a.x - t * dx, py - item.a.y - t * dy) - half;
      } else {
        const r = Math.hypot(px - item.c.x, py - item.c.y);
        distance = item.fill ? r - item.r - half : Math.abs(r - item.r) - half;
      }
      const coverage = Math.max(0, Math.min(1, 0.5 - distance)) * item.alpha;
      if (coverage <= 0) continue;
      const o = ((y + offsetY) * stride + x + offsetX) * 3;
      for (let k = 0; k < 3; k++) out[o + k] = out[o + k] + (item.rgb[k] - out[o + k]) * coverage;
    }
  }
  return out;
}

/** Contact sheet as an RGB buffer: thumbnails in a grid with a frame-number tick bar under each. */
export function rasterizeSheet(frames, {columns = 4, background = [255, 255, 255], gap = 8} = {}) {
  const w = frames[0].width, h = frames[0].height, rows = Math.ceil(frames.length / columns), bar = 6;
  const width = gap + columns * (w + gap), height = gap + rows * (h + gap + bar);
  const out = new Uint8ClampedArray(width * height * 3).fill(228);
  frames.forEach((frame, i) => {
    const ox = gap + (i % columns) * (w + gap), oy = gap + Math.floor(i / columns) * (h + gap + bar);
    rasterizeFrame(frame, {background, target: out, stride: width, offsetX: ox, offsetY: oy});
  });
  return {width, height, rgb: out};
}

let crcTable;
function crc32(bytes) {
  crcTable ??= Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Encodes an RGB buffer as a PNG file. */
export function encodePNG(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, {level: 6})), chunk('IEND', Buffer.alloc(0))]);
}

/** Default frames for a contact sheet: every key, plus midpoints between keys when there is room. */
export function sheetTicks(index, {max = 16} = {}) {
  const keys = [...new Set([0, ...index.entries.map(e => e.tick), index.length - 1])].sort((a, b) => a - b);
  let ticks = keys;
  if (keys.length * 2 - 1 <= max) ticks = keys.flatMap((t, i) => i ? [Math.round((keys[i - 1] + t) / 2), t] : [t]);
  ticks = [...new Set(ticks)].sort((a, b) => a - b);
  if (ticks.length > max) ticks = Array.from({length: max}, (_, i) => ticks[Math.round(i * (ticks.length - 1) / (max - 1))]);
  return [...new Set(ticks)];
}
