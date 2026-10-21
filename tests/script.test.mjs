import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileScript} from '../src/script/compile.mjs';
import {parseJsonc} from '../src/script/jsonc.mjs';
import {nativeAngles, scriptPose, BUILTIN_POSES, lowestOffset} from '../src/script/stick-rig.mjs';
import {captureSuggestion} from '../src/script/capture.mjs';
import {applyReviewOperation, emptyReview, reviewPathFor, formatNotes, parseReview, serializeReview} from '../src/script/review.mjs';
import {previewSession, sampleFrame, rasterizeFrame, encodePNG} from '../src/script/preview.mjs';
import {Editor} from '../src/editor.mjs';

const DEG = Math.PI / 180;
const load = report => { const editor = new Editor({demo: false, layerTimeline: true}); editor.load(structuredClone(report)); return editor; };
const base = extra => ({stykscript: 1, ground: 400, figures: {hero: {x: 100, y: 'ground', pose: 'stand'}}, ...extra});

test('JSONC keeps comments, trailing commas and the line of every value', () => {
  const {value, lines} = parseJsonc('// film\n{\n  "a": 1, /* note */\n  "b": [\n    {"c": true},\n  ],\n}\n');
  assert.deepEqual(value, {a: 1, b: [{c: true}]});
  assert.equal(lines.get('/a'), 3);
  assert.equal(lines.get('/b/0/c'), 5);
  assert.throws(() => parseJsonc('{"a": 1 "b": 2}'), /line 1/);
});

test('syntax and semantic errors carry line numbers and produce no document', () => {
  const syntax = compileScript('{\n "stykscript": 1,\n "figures": {\n}\n');
  assert.equal(syntax.ok, false);
  assert.ok(syntax.diagnostics[0].line >= 4);
  const semantic = compileScript('{\n "stykscript": 1,\n "figures": {"hero": {"pose": "stand"}},\n "timeline": [\n  {"at": 5, "villain": {"pose": "punch"}},\n  {"at": 3, "hero": {"pose": "flying"}}\n ]\n}');
  assert.equal(semantic.ok, false);
  assert.equal(semantic.report, null);
  const messages = semantic.diagnostics.map(d => `${d.line}:${d.message}`).join('\n');
  assert.match(messages, /^5:"villain" is not a figure/m);
  assert.match(messages, /^6:Entries must go forward/m);
  assert.match(messages, /Unknown pose "flying"/);
});

test('unknown properties are warnings, not silent', () => {
  const result = compileScript(base({timeline: [{at: 4, hero: {pos: 'cheer'}}]}));
  assert.equal(result.ok, true);
  assert.match(result.diagnostics.map(d => d.message).join(), /Unknown key property "pos"/);
});

test('each figure keys only at its own entries, with its own easing, in the app\'s evaluator', () => {
  const result = compileScript({stykscript: 1, figures: {a: {x: 100, y: 300, pose: 'stand'}, b: {x: 500, y: 300, pose: 'stand'}},
    timeline: [{at: 13, b: {x: 700, ease: 'linear'}}, {at: 25, a: {x: 340, pose: {armR: -45}}, b: {x: 500}}]});
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const {report, index} = result;
  const tracks = report._styk.layerSheet.tracks;
  assert.deepEqual(tracks[index.figures.a.layerId].keys.map(k => k.tick), [0, 24]);
  assert.deepEqual(tracks[index.figures.b.layerId].keys.map(k => k.tick), [0, 12, 24]);
  const editor = load(report);
  const at = tick => Object.fromEntries(editor.seek(tick).objects.map(o => [o.unique_id, o]));
  // a moves smoothly from frame 1 to 25 (auto easing): halfway at the midpoint, ignoring b's key at 13.
  assert.ok(Math.abs(at(12)[index.figures.a.uid].root_x - 220) < 1);
  // b eases linearly on its first span.
  assert.ok(Math.abs(at(6)[index.figures.b.uid].root_x - 600) < 0.5);
  // Inline poses change only the joints they name.
  const end = at(24)[index.figures.a.uid];
  assert.ok(Math.abs(end.angles[4] / DEG - -45) < 1e-6);
  assert.ok(Math.abs(end.angles[2] / DEG - BUILTIN_POSES.stand.armL) < 1e-6);
  assert.equal(editor.totalTicks, 37);
});

test('"ground" plants the lowest point on the floor, and facing left mirrors', () => {
  const {report, index} = compileScript(base({timeline: [{at: 10, hero: {pose: 'crouch', y: 'ground', facing: 'left'}}]}));
  const editor = load(report);
  for (const tick of [0, 9]) {
    const object = editor.seek(tick).objects.find(o => o.unique_id === index.figures.hero.uid);
    assert.ok(Math.abs(object.root_y + lowestOffset(object.angles) - 400) < 0.01);
  }
  const crouched = editor.seek(9).objects.find(o => o.unique_id === index.figures.hero.uid);
  assert.deepEqual(scriptPose(crouched.angles, {facing: 'left'}), scriptPose(nativeAngles(BUILTIN_POSES.crouch)));
});

test('camera keys use scene coordinates and zoom', () => {
  const {report} = compileScript({stykscript: 1, figures: {hero: {}}, timeline: [{at: 11, camera: {x: 580, y: 270, zoom: 2, ease: 'linear'}}]});
  const editor = load(report);
  const camera = editor.seek(10).camera;
  assert.deepEqual([camera.x, camera.y, camera.scale], [100, 0, 0.5]);
  assert.ok(Math.abs(editor.seek(5).camera.x - 50) < 1e-9);
});

test('relative values, "+n" entry times and props compile', () => {
  const {report, index, ok, diagnostics} = compileScript({stykscript: 1, ground: 400, length: 30,
    figures: {hero: {x: 100}}, props: {ball: {shape: 'circle', r: 10, x: 300, y: 200}, floor: {shape: 'line', from: [0, 400], to: [960, 400]}},
    timeline: [{at: 5, hero: {x: '+50'}}, {at: '+5', hero: {x: '-20'}, ball: {y: '+100'}}]});
  assert.ok(ok, JSON.stringify(diagnostics));
  assert.deepEqual(index.entries.map(e => e.frame), [5, 10]);
  const editor = load(report);
  const frame = editor.seek(9);
  assert.equal(frame.objects.find(o => o.unique_id === index.figures.hero.uid).root_x, 130);
  assert.equal(frame.objects.find(o => o.unique_id === index.figures.ball.uid).root_y, 310);
  assert.equal(report._styk.layers.byId[index.figures.floor.layerId].name, 'Set');
  assert.equal(editor.totalTicks, 30);
});

test('capturing a pose round-trips into the script vocabulary', () => {
  const {report, index} = compileScript(base({figures: {hero: {x: 100, y: 'ground', pose: 'punch', facing: 'left'}}}));
  const editor = load(report);
  const object = editor.seek(0).objects.find(o => o.unique_id === index.figures.hero.uid);
  const suggestion = captureSuggestion(index, object, {tick: 0});
  assert.equal(suggestion.at, 1);
  assert.equal(suggestion.hero.facing, 'left');
  for (const [joint, degrees] of Object.entries(suggestion.hero.pose)) assert.ok(Math.abs(((degrees - BUILTIN_POSES.punch[joint]) % 360 + 540) % 360 - 180) < 0.1, joint);
  const replay = compileScript(base({figures: {hero: {...suggestion.hero}}}));
  const again = load(replay.report).seek(0).objects[0];
  assert.ok(again.angles.every((a, i) => Math.abs(Math.sin(a - object.angles[i])) < 1e-3));
});

test('review operations add, reply, resolve and survive a round trip', () => {
  assert.equal(reviewPathFor('/x/duel.stykscript.json'), '/x/duel.stykscript.review.json');
  let {review, note} = applyReviewOperation(emptyReview('duel'), {op: 'add', text: 'Punch is slow', frame: 43, entry: 'attack', figure: 'red', line: 38, suggestion: {at: 43}});
  assert.equal(note.id, 'n1');
  ({review} = applyReviewOperation(review, {op: 'add', text: 'More hang time', frame: 60}));
  ({review, note} = applyReviewOperation(review, {op: 'reply', id: 'n1', text: 'Shortened to 2 frames', resolve: true}));
  assert.equal(note.status, 'resolved');
  const reread = parseReview(serializeReview(review));
  assert.match(formatNotes(reread), /^n2 \[open\] \(frame 60\): More hang time$/);
  assert.match(formatNotes(reread, {all: true}), /agent: Shortened to 2 frames/);
  assert.throws(() => applyReviewOperation(reread, {op: 'reply', id: 'n9', text: 'x'}), /no note/);
});

test('the example film compiles cleanly and previews', () => {
  const result = compileScript(readFileSync(new URL('../examples/scripts/duel.stykscript.json', import.meta.url), 'utf8'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics.filter(d => d.level === 'error'), []);
  const editor = previewSession(result.report), frame = sampleFrame(editor, 42, {width: 160});
  assert.ok(frame.items.length >= 21);
  const png = encodePNG(frame.width, frame.height, rasterizeFrame(frame, {background: result.index.background}));
  assert.deepEqual([...png.subarray(1, 4)], [80, 78, 71]);
});
