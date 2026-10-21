// Renders a StykScript to video through the desktop app itself (its renderer and its MP4 export), so the
// result is exactly what the person sees in StykAnimate. Optionally saves stills of chosen frames.
//
//   node scripts/render-script.mjs <script> [--out film.mp4] [--size 1080|720|original] [--stills 1,60,120]
//   (on Linux without a display: xvfb-run -a node scripts/render-script.mjs …)
//
// Needs the bundled encoder (npm run build:video-encoder).
import { mkdtemp, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '../tests/support/playwright.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const script = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!script || !existsSync(script)) { console.error('Usage: node scripts/render-script.mjs <script> [--out film.mp4] [--size 1080] [--stills 1,60]'); process.exit(1); }
const out = path.resolve(flag('out') ?? script.replace(/\.json$/i, '').replace(/\.stykscript$/i, '') + '.mp4');
const size = flag('size') ?? '1080', stills = (flag('stills') ?? '').split(',').filter(Boolean).map(Number);
const ffmpeg = path.join(appRoot, 'build', 'video-encoder', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
if (!existsSync(ffmpeg)) { console.error('The bundled encoder is missing. Run npm run build:video-encoder.'); process.exit(2); }
const profile = await mkdtemp(path.join(os.tmpdir(), 'styk-render-'));
await writeFile(path.join(profile, 'telemetry-state.json'), JSON.stringify({ decided: true, consent: { analytics: false, diagnostics: false, policyVersion: '2026-09-10', updatedAt: Date.now() } }));

const app = await electron.launch({ args: [appRoot, `--script=${path.resolve(script)}`], cwd: appRoot, timeout: 60000, env: { ...process.env, STYK_USER_DATA_DIR: profile } });
try {
  const page = await app.firstWindow({ timeout: 60000 });
  await page.setViewportSize?.({ width: 1600, height: 960 });
  await page.waitForFunction(() => window.styk?.ready === true, undefined, { timeout: 60000 });
  await page.waitForFunction(() => window.styk.script?.state.report && window.styk.editor.report === window.styk.script.state.report, undefined, { timeout: 60000 });
  for (const selector of ['.styk-privacy [data-decline]', '.release-splash [aria-label="Close welcome screen"]']) await page.locator(selector).click({ timeout: 1500 }).catch(() => {});
  const problems = await page.evaluate(() => window.styk.script.state.compiled.diagnostics.filter(d => d.level === 'error'));
  if (problems.length) throw new Error(`The script has errors: ${problems.map(d => `line ${d.line}: ${d.message}`).join('; ')}`);
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, out);
  await page.evaluate(sizePreset => {
    window.styk.state.settings.exportPreferences = { format: 'mp4', sizePreset, videoQuality: 'high', smoothing: 'edges', lockRatio: true };
    window.styk.actions.export();
  }, size);
  await page.locator('#export-submit').click({ timeout: 20000 });
  const started = Date.now();
  let last = -1;
  for (let stable = 0; stable < 4;) {
    if (Date.now() - started > 15 * 60000) throw new Error('The export did not finish in 15 minutes.');
    await delay(500);
    const now = existsSync(out) ? (await stat(out)).size : -1;
    const busy = await page.evaluate(() => Boolean(document.querySelector('#export-progress:not([hidden])')));
    stable = now > 0 && now === last && !busy ? stable + 1 : 0; last = now;
  }
  console.log(`Wrote ${out} (${(last / 1e6).toFixed(1)} MB) in ${((Date.now() - started) / 1000).toFixed(0)} s.`);
  // Stills come from the exported film itself, so they show exactly what the video shows.
  const fps = await page.evaluate(() => window.styk.editor.report.fps);
  for (const frame of stills) {
    const file = out.replace(/\.[a-z0-9]+$/i, `.frame-${frame}.png`);
    const run = spawnSync(ffmpeg, ['-v', 'error', '-y', '-ss', String((frame - 0.5) / fps), '-i', out, '-frames:v', '1', file]);
    if (run.status !== 0) throw new Error(`Could not take frame ${frame}: ${run.stderr}`);
    console.log(`Still: ${file}`);
  }
} finally {
  await app.close().catch(() => {});
}
