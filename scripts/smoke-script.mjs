// End-to-end check of the agent loop in the desktop app (docs/AGENT-SCRIPTING.md):
//
//   node scripts/smoke-script.mjs            (on Linux without a display: xvfb-run -a node scripts/smoke-script.mjs)
//
// 1. The app starts with --script=<copy of the example>, opens it as a project and shows the Script panel.
// 2. Editing the file (as an agent would) reloads the project in place.
// 3. A note with the selected figure's pose, added in the panel, lands in the review file in script terms.
// 4. The agent's reply from the command line appears in the panel.
// 5. A script with an error keeps the last good version and names the line.
// Screenshots go to artifacts/script-smoke/.
import { mkdtemp, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '../tests/support/playwright.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(appRoot, 'artifacts', 'script-smoke');
await mkdir(artifacts, { recursive: true });
const work = await mkdtemp(path.join(os.tmpdir(), 'styk-script-'));
const profile = await mkdtemp(path.join(os.tmpdir(), 'styk-script-profile-'));
await writeFile(path.join(profile, 'telemetry-state.json'), JSON.stringify({ decided: true, consent: { analytics: false, diagnostics: false, policyVersion: '2026-09-10', updatedAt: Date.now() } }));
const script = path.join(work, 'duel.stykscript.json'), reviewFile = path.join(work, 'duel.stykscript.review.json');
await copyFile(path.join(appRoot, 'examples', 'scripts', 'duel.stykscript.json'), script);

const failures = [];
const expect = (name, condition, detail = '') => { if (!condition) failures.push(name); console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const cli = (...args) => execFileSync(process.execPath, [path.join(appRoot, 'scripts', 'styk-script.mjs'), ...args], { encoding: 'utf8' });
let app;
try {
  app = await electron.launch({ args: [appRoot, `--script=${script}`], cwd: appRoot, timeout: 60000,
    env: { ...process.env, STYK_USER_DATA_DIR: profile } });
  const page = await app.firstWindow({ timeout: 60000 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize?.({ width: 1440, height: 900 });
  await page.waitForFunction(() => window.styk?.ready === true, undefined, { timeout: 60000 });
  await page.waitForFunction(() => window.styk.script?.state.report && window.styk.editor?.report === window.styk.script.state.report, undefined, { timeout: 30000 });
  for (const selector of ['.styk-privacy [data-decline]', '.release-splash [aria-label="Close welcome screen"]']) await page.locator(selector).click({ timeout: 1500 }).catch(() => {});
  const opened = await page.evaluate(() => ({
    layers: window.styk.editor.report._styk.layers.order.map(id => window.styk.editor.report._styk.layers.byId[id].name),
    ticks: window.styk.editor.totalTicks, name: window.styk.editor.name,
    panelVisible: !document.getElementById('script-panel').hidden,
    keys: document.querySelectorAll('#script-panel .script-keys [data-tick]').length,
  }));
  expect('The launch script opens as a project with one layer per figure', JSON.stringify(opened.layers) === JSON.stringify(['Set', 'Blue', 'Red']), opened.layers.join(', '));
  expect('The film has the script\'s length', opened.ticks === 84, String(opened.ticks));
  expect('The Script panel shows with every key', opened.panelVisible && opened.keys === 11, `${opened.keys} keys`);
  await page.click('#script-panel .script-keys [data-tick="42"]');
  await page.waitForFunction(() => window.styk.editor.tick === 42);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(artifacts, '1-opened.png') });

  // 2. The agent edits the file: Red gets a new colour and the attack moves two frames later.
  const reportBefore = await page.evaluate(() => { window.__before = window.styk.editor.report; return true; });
  const edited = (await readFile(script, 'utf8')).replace('"color": "#e5484d"', '"color": "#8e4ec6"').replace('{"at": 43, "id": "attack"', '{"at": 44, "id": "attack"');
  await writeFile(script, edited);
  await page.waitForFunction(() => window.styk.editor.report !== window.__before && window.styk.editor.report === window.styk.script.state.report, undefined, { timeout: 15000 });
  const reloaded = await page.evaluate(() => ({ tick: window.styk.editor.tick, color: window.styk.editor.report.figure_types.find(f => f.name === 'Red').segments[0].color_rgb,
    attack: window.styk.script.state.good.index.entries.find(e => e.id === 'attack').frame }));
  expect('Saving the script reloads the project in place, keeping the playhead', reloaded.tick === 42 && JSON.stringify(reloaded.color) === '[142,78,198]' && reloaded.attack === 44, JSON.stringify(reloaded));
  void reportBefore;

  // 3. The person selects Red, bends its arm on the canvas and leaves a note with that pose.
  await page.evaluate(() => {
    const editor = window.styk.editor, index = window.styk.script.state.good.index;
    editor.select(index.figures.red.uid, 4);
    editor.rotateJoint(-0.6);
  });
  await page.click('#script-panel [data-tab="notes"]');
  await page.fill('#script-panel .script-note-text', 'Make the rear arm swing up more before the punch.');
  await page.click('#script-panel .script-composer button[type="submit"]');
  await page.waitForFunction(() => window.styk.script.state.review.notes.length === 1, undefined, { timeout: 10000 });
  const review = JSON.parse(await readFile(reviewFile, 'utf8'));
  const note = review.notes[0];
  expect('The note is saved next to the script with frame, key, figure and line', note?.frame === 43 && note.figure === 'red' && note.entry === 'windup' && Number.isInteger(note.line), JSON.stringify({ frame: note?.frame, entry: note?.entry, figure: note?.figure, line: note?.line }));
  expect('The note carries Red\'s pose from the canvas in script terms', note?.suggestion?.at === 43 && typeof note.suggestion.red?.pose?.armR === 'number' && note.suggestion.red.facing === 'left', JSON.stringify(note?.suggestion?.red?.pose));
  const listed = cli('notes', script);
  expect('The agent reads the note from the command line', /n1 \[open\] \(frame 43, entry "windup", figure "red"/.test(listed), listed.split('\n')[0]);
  await page.screenshot({ path: path.join(artifacts, '2-note.png') });

  // 4. The agent replies and resolves it; the panel shows the reply.
  cli('reply', script, 'n1', 'Raised the rear arm in "windup".', '--resolve');
  await page.waitForFunction(() => window.styk.script.state.review.notes[0]?.status === 'resolved', undefined, { timeout: 10000 });
  await page.check('#script-panel .script-show-resolved input');
  const replyShown = await page.locator('#script-panel .script-reply[data-from="agent"]').innerText();
  expect('The agent\'s reply appears in the panel', /Raised the rear arm/.test(replyShown), replyShown);
  await page.screenshot({ path: path.join(artifacts, '3-reply.png') });

  // 5. A broken script keeps the last good version and points at the line.
  const goodReport = await page.evaluate(() => { window.__good = window.styk.editor.report; return true; });
  void goodReport;
  await page.evaluate(() => { window.styk.editor.dirty = false; });
  await writeFile(script, edited.replace('"pose": "lie"', '"pose": "nap"'));
  await page.waitForFunction(() => window.styk.script.state.compiled && !window.styk.script.state.compiled.ok, undefined, { timeout: 15000 });
  const broken = await page.evaluate(() => ({ kept: window.styk.editor.report === window.__good, problems: [...document.querySelectorAll('#script-panel .script-problems li')].map(li => li.innerText) }));
  expect('An error keeps the last good version and names the line', broken.kept && broken.problems.some(text => /Line \d+.*Unknown pose "nap"/s.test(text)), broken.problems[0]);
  await page.click('#script-panel [data-tab="source"]');
  await page.screenshot({ path: path.join(artifacts, '4-problem.png') });
  expect('No page errors', !errors.length, errors.join(' | '));
} finally {
  await app?.close().catch(() => {});
}
console.log(`Screenshots: ${artifacts}`);
if (!existsSync(reviewFile)) failures.push('review file');
if (failures.length) { console.error(`${failures.length} check(s) failed.`); process.exit(1); }
