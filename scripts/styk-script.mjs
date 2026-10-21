#!/usr/bin/env node
/** The agent's side of StykScript: write a script, check it, look at it, read the person's notes.
 *
 *   npm run script -- <command> [arguments]
 *
 * Commands
 *   new <file>                     Write a starter script.
 *   check <script>                 Compile and list errors/warnings with line numbers (exit 1 on errors).
 *   preview <script> [options]     Contact sheet PNG of key frames (default <script>.preview.png).
 *       --frames 1,12,30   --width 320   --columns 4   --svg   --out <file>
 *   frame <script> <n> [--width 960] [--out <file>]   One frame as a PNG.
 *   video <script> [--out film.mp4|film.gif] [--width 640]   Quick whole-film preview (needs ffmpeg on PATH).
 *   render <script> [--out film.mp4] [--size 1080|720|original] [--stills 1,60]
 *                                  The film through the desktop app's own renderer and MP4 export.
 *   compile <script> [--out <file>]  Write the StykAnimate document (.json; opens with File → Open).
 *   rig                            Joint names, bone lengths and the built-in poses.
 *   notes <script> [--all] [--json]  The person's review notes (open ones by default).
 *   reply <script> <note> <text> [--resolve]   Answer a note; --resolve closes it.
 *   open <script>                  Open the script in the desktop app, live-reloading as you edit.
 */
import {readFile, writeFile, rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {compileScript} from '../src/script/compile.mjs';
import {JOINTS, SEGMENTS, BUILTIN_POSES} from '../src/script/stick-rig.mjs';
import {previewSession, sampleFrame, sheetSVG, rasterizeSheet, rasterizeFrame, encodePNG, sheetTicks} from '../src/script/preview.mjs';
import {reviewPathFor, parseReview, serializeReview, applyReviewOperation, formatNotes} from '../src/script/review.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...rest] = process.argv.slice(2);
const flags = {}, args = [];
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i];
  if (arg.startsWith('--')) {
    const [name, inline] = arg.slice(2).split('=');
    flags[name] = inline ?? (rest[i + 1] && !rest[i + 1].startsWith('--') && !['all', 'json', 'svg', 'resolve'].includes(name) ? rest[++i] : true);
  } else args.push(arg);
}
const fail = message => { console.error(message); process.exit(1); };

async function load(file) {
  if (!file) fail('Give the script file.');
  const text = await readFile(file, 'utf8').catch(() => fail(`Can't read ${file}.`));
  const result = compileScript(text);
  for (const d of result.diagnostics) console.error(`${file}:${d.line}: ${d.level}: ${d.message}`);
  if (!result.ok) fail(`${file}: ${result.diagnostics.filter(d => d.level === 'error').length} error(s); nothing was produced.`);
  return result;
}
const output = (file, suffix) => flags.out ?? file.replace(/\.json$/i, '').replace(/\.stykscript$/i, '') + suffix;
async function atomicWrite(file, data) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, file);
}

const commands = {
  async new([file]) {
    if (!file) fail('Give a file name, for example film.stykscript.json');
    if (existsSync(file)) fail(`${file} already exists.`);
    await writeFile(file, STARTER);
    console.log(`Wrote ${file}. Check it with: npm run script -- check ${file}`);
  },

  async check([file]) {
    const {index, diagnostics} = await load(file);
    const figures = Object.entries(index.figures).map(([id, f]) => `${id} (${f.kind}, ${f.keys.length} key${f.keys.length === 1 ? '' : 's'})`);
    console.log(`OK: "${index.title}", ${index.length} frames at ${index.fps} fps (${(index.length / index.fps).toFixed(2)} s), ${index.canvas.width}×${index.canvas.height}.`);
    console.log(`Entities: ${figures.join(', ') || 'none'}. Entries: ${index.entries.length}. Warnings: ${diagnostics.length}.`);
  },

  async preview([file]) {
    const {report, index} = await load(file);
    const editor = previewSession(report), width = Number(flags.width ?? 320), columns = Number(flags.columns ?? 4);
    const ticks = flags.frames ? String(flags.frames).split(',').map(v => Number(v.trim()) - 1).filter(t => t >= 0 && t < index.length) : sheetTicks(index);
    const frames = ticks.map(t => sampleFrame(editor, t, {width}));
    const entryAt = new Map(index.entries.map(e => [e.tick, e.id]));
    const labels = ticks.map(t => `frame ${t + 1}${entryAt.has(t) ? ` · ${entryAt.get(t)}` : ''}`);
    if (flags.svg) {
      const out = output(file, '.preview.svg');
      await atomicWrite(out, sheetSVG(frames, {columns, background: index.background, labels}));
      console.log(`Wrote ${out} (${ticks.length} frames: ${ticks.map(t => t + 1).join(', ')}).`);
      return;
    }
    const sheet = rasterizeSheet(frames, {columns, background: index.background});
    const out = output(file, '.preview.png');
    await atomicWrite(out, encodePNG(sheet.width, sheet.height, sheet.rgb));
    console.log(`Wrote ${out}: frames ${labels.join(', ')} (left to right, top to bottom).`);
  },

  async frame([file, number]) {
    const {report, index} = await load(file);
    const frameNumber = Number(number);
    if (!Number.isInteger(frameNumber) || frameNumber < 1 || frameNumber > index.length) fail(`Frame is 1–${index.length}.`);
    const editor = previewSession(report), sampled = sampleFrame(editor, frameNumber - 1, {width: Number(flags.width ?? index.canvas.width)});
    const out = output(file, `.frame-${frameNumber}.png`);
    await atomicWrite(out, encodePNG(sampled.width, sampled.height, rasterizeFrame(sampled, {background: index.background})));
    console.log(`Wrote ${out}.`);
  },

  async video([file]) {
    const {report, index} = await load(file);
    if (spawnSync('ffmpeg', ['-version']).status !== 0) fail('ffmpeg is not on PATH; use preview or frame instead.');
    const width = Math.round(Number(flags.width ?? 640) / 2) * 2, editor = previewSession(report);
    const height = Math.round(width * index.canvas.height / index.canvas.width / 2) * 2;
    const out = output(file, '.preview.mp4'), gif = /\.gif$/i.test(out);
    const encoder = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', String(index.fps), '-i', '-',
      ...(gif ? ['-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse'] : ['-pix_fmt', 'yuv420p', '-c:v', 'libx264']), out], {stdio: ['pipe', 'inherit', 'inherit']});
    for (let tick = 0; tick < index.length; tick++) {
      const sampled = sampleFrame(editor, tick, {width});
      sampled.height = height;
      const rgb = rasterizeFrame(sampled, {background: index.background});
      if (!encoder.stdin.write(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength))) await new Promise(resolve => encoder.stdin.once('drain', resolve));
    }
    encoder.stdin.end();
    const code = await new Promise(resolve => encoder.on('close', resolve));
    if (code) fail('ffmpeg failed.');
    console.log(`Wrote ${out} (${index.length} frames, ${width}×${height}).`);
  },

  async render() {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'render-script.mjs'), ...process.argv.slice(3)], {stdio: 'inherit'});
    const code = await new Promise(resolve => child.on('close', resolve));
    if (code) fail('Rendering failed. On Linux without a display, run it under xvfb-run -a.');
  },

  async compile([file]) {
    const {report} = await load(file);
    const out = output(file, '.styk.json');
    await atomicWrite(out, JSON.stringify(report));
    console.log(`Wrote ${out}. Open it in StykAnimate with File → Open.`);
  },

  async rig() {
    console.log('Directions are degrees on screen: 0 right, 90 down, 180 left, -90 up. Poses are authored facing right.');
    console.log('The figure\'s x/y is its hip joint. Torso and thighs start at the hip; head and arms at the top of the torso.\n');
    console.log('joint      parent     length  thickness');
    for (const s of SEGMENTS) console.log(`${s.joint.padEnd(10)} ${(s.parent < 0 ? 'hip' : JOINTS[s.parent]).padEnd(10)} ${String(s.length).padStart(6)}  ${String(s.thickness).padStart(9)}${s.circle ? '  (circle: length is its diameter)' : ''}`);
    console.log('\nBuilt-in poses:');
    for (const [name, pose] of Object.entries(BUILTIN_POSES)) console.log(`  ${name.padEnd(8)} ${JOINTS.map(j => `${j} ${pose[j]}`).join(', ')}`);
  },

  async notes([file]) {
    if (!file) fail('Give the script file.');
    const reviewFile = reviewPathFor(file);
    const review = parseReview(existsSync(reviewFile) ? await readFile(reviewFile, 'utf8') : '', path.basename(file));
    if (flags.json) console.log(JSON.stringify(flags.all ? review.notes : review.notes.filter(n => n.status === 'open'), null, 2));
    else console.log(formatNotes(review, {all: Boolean(flags.all)}));
  },

  async reply([file, id, ...words]) {
    if (!file || !id || !words.length) fail('Usage: reply <script> <note id> <text> [--resolve]');
    const reviewFile = reviewPathFor(file);
    const current = parseReview(existsSync(reviewFile) ? await readFile(reviewFile, 'utf8') : '', path.basename(file));
    const {review, note} = applyReviewOperation(current, {op: 'reply', id, text: words.join(' '), from: 'agent', resolve: flags.resolve ? true : undefined});
    await atomicWrite(reviewFile, serializeReview(review));
    console.log(`Replied to ${note.id}${note.status === 'resolved' ? ' and resolved it' : ''}.`);
  },

  async open([file]) {
    if (!file) fail('Give the script file.');
    const electron = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    spawn(electron, [ROOT, `--script=${path.resolve(file)}`], {detached: true, stdio: 'ignore', env}).unref();
    console.log(`Opening ${file} in StykAnimate. It reloads whenever the file changes; notes appear in ${reviewPathFor(file)}.`);
  },
};

const STARTER = `// StykScript: see docs/AGENT-SCRIPTING.md. Frames start at 1; directions are degrees (0 right, 90 down).
{
  "stykscript": 1,
  "title": "My animation",
  "canvas": "landscape",
  "fps": 24,
  "background": "#ffffff",
  "ground": 440,
  "figures": {
    "hero": {"color": "#0d99ff", "x": 200, "y": "ground", "pose": "stand"}
  },
  "props": {
    "floor": {"shape": "line", "from": [0, 440], "to": [960, 440], "thickness": 4}
  },
  "timeline": [
    {"at": 1, "id": "start", "note": "Hero stands."},
    {"at": 12, "hero": {"pose": "walk1", "x": "+60", "y": "ground"}},
    {"at": 24, "hero": {"pose": "walk2", "x": "+60", "y": "ground"}},
    {"at": 36, "id": "cheer", "hero": {"pose": "cheer", "y": "ground"}}
  ]
}
`;

if (!commands[command]) {
  console.log((await readFile(fileURLToPath(import.meta.url), 'utf8')).split('\n').slice(1, 20).map(l => l.replace(/^ ?\*\/?\s?|^\/\*\*\s?/, '')).join('\n'));
  process.exit(command ? 1 : 0);
}
await commands[command](args);
