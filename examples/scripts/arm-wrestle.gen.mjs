// Generates examples/scripts/arm-wrestle.stykscript.json:  node examples/scripts/arm-wrestle.gen.mjs
// A script can be written by hand; this one is generated because the crowd, the tremble and the confetti are
// many small keys, and because the wrestlers' bodies are solved from the table geometry below.
// The wrestlers' bodies are derived from the table: elbows planted, one shared grip, shoulders
// on a circle around each elbow, hips under the leaning torso, feet pinned in a lunge.
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {nativeAngles, lowestOffset, BUILTIN_POSES} from '../../src/script/stick-rig.mjs';

const OUT = process.argv[2] ?? fileURLToPath(new URL('./arm-wrestle.stykscript.json', import.meta.url));
const D = Math.PI / 180, cos = a => Math.cos(a * D), sin = a => Math.sin(a * D);
const R1 = v => Math.round(v * 10) / 10;
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rr = (a, b) => a + (b - a) * rnd(), ri = (a, b) => Math.round(rr(a, b));

// ---- Stage
const GR = 500, S = 1.3;                         // floor; wrestler scale
const U = 53 * S, F = 48 * S, TOR = 78 * S;      // upper arm, forearm, torso
const TABLE_TOP = 346, TABLE_X = [404, 556];     // table top line (12 thick: surface at 340)
const E0 = {x: 480, y: 340 - 7.8};               // where the elbows rest (joint centre on the surface)
const EB = {x: E0.x - 9, y: E0.y};               // Blue's elbow; Red's is mirrored
const mx = x => 960 - x;                         // mirror about the table centre
const FEET = {front: {x: 436, y: GR - 9}, back: {x: 318, y: GR - 9}};

// Body for one key. θ: the forearms' screen angle (-90 upright; toward 0 = Red's side, toward -180 = Blue's).
// psi: direction from elbow to shoulder (in the wrestler's own facing-right frame). a: torso angle (same frame).
function body(side, theta, psi, a, extra = {}) {
  const grip = {x: E0.x + F * cos(theta), y: E0.y + F * sin(theta)};
  const ex = EB.x, sx = ex + U * cos(psi), sy = EB.y + U * sin(psi);
  const hx = sx - TOR * cos(a), hy = sy - TOR * sin(a);
  const X = side === 'blue' ? x => x : mx;
  const reach = {
    handR: {x: R1(grip.x), y: R1(grip.y), bend: 'down'},
    footL: {x: X(FEET.front.x), y: FEET.front.y, bend: 'forward'},
    footR: {x: X(FEET.back.x), y: FEET.back.y, bend: 'forward'},
    ...extra.reach,
  };
  return {pose: {base: 'stand', torso: R1(a), head: R1(extra.head ?? a - 26 - 34 * Math.min(1, Math.max(0, (-142 - psi) / 20))), armL: R1(a + 165), forearmL: R1(a + 150)}, x: R1(X(hx)), y: R1(hy), reach, ...(extra.ease ? {ease: extra.ease} : {})};
}

// ---- The match: base keys [frame, θ, blue ψ, blue a, red ψ, red a]; tremble is added between them.
const W = 132;                                   // the slam
// ψ: -132 at rest; the attacker's shoulder rolls over the table (toward -108), the defender is pushed back (toward -146).
// Shoulders stay back so the arms form a tent; the defender crouches (ψ toward -160), the attacker rises over (-124).
const base = [
  [1,   -90, -142, -60, -142, -60],
  [21,  -90, -142, -60, -142, -60],
  [27,  -96, -146, -62, -136, -58],
  [40,  -112, -152, -65, -130, -55],
  [52,  -124, -157, -67, -126, -53],
  [60,  -134, -162, -70, -123, -52],
  [76,  -138, -164, -71, -122, -51],
  [86,  -122, -154, -66, -128, -55],
  [96,  -108, -147, -62, -136, -58],
  [106, -90, -142, -60, -142, -60],
  [114, -76, -136, -58, -148, -63],
  [122, -62, -128, -54, -155, -66],
  [126, -52, -125, -52, -158, -67],
];
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
function sampleBase(f) {
  let i = 0; while (i < base.length - 2 && base[i + 1][0] <= f) i++;
  const [f0, ...p0] = base[i], [f1, ...p1] = base[i + 1], t = smooth(Math.min(1, Math.max(0, (f - f0) / (f1 - f0))));
  return p0.map((v, k) => lerp(v, p1[k], t));
}

const script = {
  stykscript: 1, title: 'Arm wrestle', canvas: 'landscape', fps: 24, background: '#f6efe2', ground: GR, length: W + 88,
  defaults: {ease: 'smooth'},
  poses: {
    watch: {base: 'stand', armL: 80, forearmL: 70, armR: 100, forearmR: 60},
    pump: {base: 'stand', armR: -55, forearmR: -100, armL: 80, forearmL: 55},
    pumpLow: {base: 'stand', armR: 15, forearmR: -55, armL: 80, forearmL: 55},
    clapOpen: {base: 'stand', armL: 45, forearmL: -35, armR: 60, forearmR: -10},
    clapShut: {base: 'stand', armL: 40, forearmL: -20, armR: 45, forearmR: -25},
    handsHead: {base: 'stand', armL: -60, forearmL: 160, armR: -120, forearmR: 20},
    cheerA: {base: 'cheer', armL: -55, forearmL: -70, armR: -125, forearmR: -110},
    cheerB: {base: 'cheer', armL: -72, forearmL: -95, armR: -108, forearmR: -85},
    refPoint: {base: 'stand', armR: -8, forearmR: -12, armL: 95, forearmL: 85},
    flex: {base: 'stand', armL: -20, forearmL: -110, armR: -160, forearmR: -70},
  },
  figures: {}, props: {}, timeline: [],
};
const at = new Map();
const entry = f => { if (!at.has(f)) at.set(f, {at: f}); return at.get(f); };
const label = (f, id, note) => Object.assign(entry(f), {id, note});

// ---- Crowd: two rows on bleachers, small and pale, facing the table.
const ROWS = [
  {riser: 214, scale: 0.40, n: 11, x0: 40, dx: 88, z: -4, colors: ['#c5c9cf', '#cfc4b8', '#c3cdc0', '#cbbdc9', '#bfcbd4', '#d4c6b4']},
  {riser: 268, scale: 0.50, n: 9, x0: 78, dx: 101, z: -3, colors: ['#a3adb8', '#b8a898', '#a2b49d', '#b49fb0', '#9fb4c4', '#c1a88e']},
];
const fans = [];
ROWS.forEach((row, r) => {
  for (let i = 0; i < row.n; i++) {
    const id = `fan${r + 1}_${i + 1}`, x = row.x0 + i * row.dx + ri(-10, 10), scale = row.scale + ri(-3, 3) / 100;
    if (r === 1 && Math.abs(x - 480) < 40) continue;          // keep the space behind the grip clear
    const facing = x < 480 ? 'right' : 'left';
    const footY = row.riser - 4;
    const hip = () => R1(footY - lowestOffset(nativeAngles(BUILTIN_POSES.stand), scale));
    fans.push({id, x, scale, row: r, hip: hip(), phase: ri(0, 5), beat: ri(5, 7)});
    script.figures[id] = {name: `Fan ${fans.length}`, group: 'Crowd', z: row.z, color: row.colors[i % row.colors.length], scale, x, y: hip(), facing, pose: 'watch'};
  }
});

// ---- Referee, behind the table, hands on the grip until GO.
const GRIP0 = {x: E0.x, y: E0.y - F};
const REF_GRIP = {pose: {base: 'stand', torso: -92, head: -72}, reach: {handL: {x: GRIP0.x - 6, y: GRIP0.y - 9, bend: 'forward'}, handR: {x: GRIP0.x + 2, y: GRIP0.y - 2, bend: 'forward'}}};
script.figures.ref = {name: 'Referee', z: -2, color: '#3d3d46', scale: 1.1, hands: true, x: 486, y: 'ground', facing: 'left', ...REF_GRIP};

// ---- The wrestlers.
const first = sampleBase(1);
script.figures.blue = {name: 'Blue', z: 1, color: '#0d99ff', scale: S, hands: true, ...body('blue', first[0], first[1], first[2])};
script.figures.red = {name: 'Red', z: 1, color: '#e5484d', scale: S, hands: true, facing: 'left', ...body('red', first[0], first[3], first[4])};

// ---- Set and the table (the table is in front of the referee and behind the arms).
Object.assign(script.props, {
  floor: {shape: 'line', from: [0, GR], to: [960, GR], color: '#3b3b3b', thickness: 4},
  bleacherBack: {shape: 'line', from: [0, ROWS[0].riser], to: [960, ROWS[0].riser], color: '#e2d8c6', thickness: 8},
  bleacherFront: {shape: 'line', from: [0, ROWS[1].riser], to: [960, ROWS[1].riser], color: '#d6cab4', thickness: 10},
  tableTop: {shape: 'line', z: 0, from: [TABLE_X[0], TABLE_TOP], to: [TABLE_X[1], TABLE_TOP], color: '#6f4a2b', thickness: 12},
  tablePost: {shape: 'line', z: 0, from: [480, TABLE_TOP], to: [480, GR - 6], color: '#6f4a2b', thickness: 14},
  tableFoot: {shape: 'line', z: 0, from: [436, GR - 4], to: [524, GR - 4], color: '#6f4a2b', thickness: 8},
});

// ---- Match keys: every 3 frames from GO to the slam, with a tremble that grows with the strain.
label(1, 'setup', 'The referee holds the grip. The crowd waits.');
label(21, 'go', 'GO! The referee lets go.');
label(40, 'redPush', 'Red drives Blue’s hand down.');
label(60, 'nearLoss', 'Blue is an inch from the table, shaking.');
label(86, 'comeback', 'Blue fights back up.');
label(106, 'even', 'Dead even.');
label(122, 'bluePush', 'Blue rolls over the top.');
label(W, 'slam', 'SLAM. Blue pins Red’s hand.');
for (let f = 1; f <= 126; f += (f < 21 ? 20 : 3)) {
  const [theta, bpsi, ba, rpsi, ra] = sampleBase(f);
  const strain = f < 24 ? 0 : Math.min(1, (f - 24) / 30) * (f >= 52 && f <= 80 ? 1.6 : 1);
  const j = (k) => (rnd() * 2 - 1) * k * strain;
  const t = theta + j(3), b = ba + j(1.5), r = ra + j(1.5);
  entry(f).blue = body('blue', t, bpsi, b);
  entry(f).red = body('red', t, rpsi, r);
}
// The slam: accelerate, hit, a small bounce.
// The rollover is fast and wide, so it is keyed on every frame: both arms then follow one path and the fists stay locked.
{
  const [theta0, bpsi0, ba0, rpsi0, ra0] = sampleBase(126), end = [-8, -120, -48, -121, -50];
  for (let f = 127; f < W; f++) {
    const t = (f - 126) / (W - 126), k = t * t;   // accelerating into the table
    const v = [theta0, bpsi0, ba0, rpsi0, ra0].map((value, i) => value + (end[i] - value) * (i === 0 ? k : t));
    entry(f).blue = body('blue', v[0], v[1], v[2], {ease: 'linear'});
    entry(f).red = body('red', v[0], v[3], v[4], {ease: 'linear'});
  }
}
entry(W).blue = body('blue', -8, -120, -48, {ease: 'ease-out'});
entry(W).red = body('red', -8, -121, -50, {head: -128, ease: 'ease-out'});
entry(W + 1).blue = body('blue', -4, -120, -48);
entry(W + 1).red = body('red', -4, -121, -50, {head: -134});
entry(W + 4).blue = body('blue', -7, -120, -48);
entry(W + 4).red = body('red', -7, -121, -50, {head: -118});

// Red collapses over the table; Blue lets go and stands up.
label(W + 9, 'slump', 'Red slumps over the table, beaten.');
entry(W + 9).red = {pose: {base: 'stand', torso: -30, head: 40}, x: 604, y: 372, reach: {handR: {x: 514, y: 428, bend: 'forward'}, handL: {x: 528, y: 434, bend: 'forward'},
  footL: {x: mx(FEET.front.x), y: FEET.front.y, bend: 'forward'}, footR: {x: mx(FEET.back.x), y: FEET.back.y, bend: 'forward'}}, ease: 'ease-in'};
entry(W + 30).red = {pose: {base: 'stand', torso: -26, head: 52}, x: 606, y: 376, reach: {handR: {x: 520, y: 436, bend: 'forward'}, handL: {x: 532, y: 440, bend: 'forward'},
  footL: {x: mx(FEET.front.x), y: FEET.front.y, bend: 'forward'}, footR: {x: mx(FEET.back.x), y: FEET.back.y, bend: 'forward'}}};
label(W + 10, 'win', 'Blue throws both arms up. The crowd erupts. Confetti!');
entry(W + 8).blue = {...body('blue', -70, -128, -66), ease: 'ease-out'};
entry(W + 10).blue = {pose: {base: 'stand', armL: -20, forearmL: -55, armR: -50, forearmR: -85}, x: 380, y: 'ground', ease: 'linear'};
entry(W + 13).blue = {pose: 'cheerA', x: 372, y: 'ground', ease: 'ease-out'};
for (const [f, pose, dy, ease] of [[W + 21, 'cheerB', -44, 'ease-out'], [W + 28, 'cheerA', 0, 'ease-in'], [W + 36, 'cheerB', -40, 'ease-out'], [W + 43, 'cheerA', 0, 'ease-in'],
  [W + 54, 'flex', 0, 'smooth'], [W + 68, 'cheerA', 0, 'smooth']]) entry(f).blue = {pose, y: dy ? R1(GR - lowestOffset(nativeAngles(BUILTIN_POSES.cheer), S) + dy) : 'ground', ease};

// Referee: GO, steps back right, watches; points at the winner.
entry(19).ref = {...REF_GRIP, ease: 'ease-out'};
entry(21).ref = {pose: {base: 'stand', armL: 10, forearmL: -50, armR: -20, forearmR: -60}, y: 'ground', ease: 'linear'};
entry(23).ref = {pose: 'cheerA', y: 'ground', ease: 'ease-in-out'};
entry(28).ref = {pose: {base: 'walk1', armL: -55, forearmL: -70, armR: -125, forearmR: -110}, x: 560, y: 'ground'};
entry(34).ref = {pose: {base: 'walk2', armL: -50, forearmL: -60, armR: -120, forearmR: -100}, x: 640, y: 'ground'};
entry(40).ref = {pose: 'pump', x: 712, y: 'ground'};
entry(46).ref = {pose: 'watch', y: 'ground'};
entry(64).ref = {pose: {base: 'watch', torso: -78, head: -60}, y: 'ground'};
entry(100).ref = {pose: 'watch', y: 'ground'};
entry(W).ref = {pose: 'watch', y: 'ground', ease: 'ease-out'};
entry(W + 4).ref = {pose: 'refPoint', y: 'ground', ease: 'ease-out'};
entry(W + 40).ref = {pose: 'clapOpen', y: 'ground'};
for (let f = W + 46; f < W + 80; f += 6) entry(f).ref = {pose: (f / 6) % 2 < 1 ? 'clapShut' : 'clapOpen', y: 'ground'};

// Crowd behaviour by phase.
for (const fan of fans) {
  const set = (f, pose, lift = 0, ease) => { entry(f)[fan.id] = {pose, y: R1(fan.hip - lift), ...(ease ? {ease} : {})}; };
  let toggle = false;
  for (let f = 6 + fan.phase; f < W + 82; f += f < 21 ? 10 : f < W ? fan.beat : fan.beat - 1) {
    toggle = !toggle;
    if (f < 21) set(f, toggle ? 'clapOpen' : 'clapShut');
    else if (f < 52) set(f, toggle ? 'pump' : 'pumpLow', toggle ? 2 : 0);
    else if (f < 86) set(f, fan.row ? (toggle ? 'handsHead' : 'pump') : (toggle ? 'clapOpen' : 'clapShut'), toggle ? 3 : 0);
    else if (f < W) set(f, toggle ? 'pump' : 'pumpLow', toggle ? 3 : 0);
    else set(f, toggle ? 'cheerB' : 'cheerA', toggle ? 12 : 0, toggle ? 'ease-out' : 'ease-in');
  }
}

// Camera.
const cam = (f, x, y, zoom, ease) => { entry(f).camera = {x, y, zoom, ...(ease ? {ease} : {})}; };
cam(1, 480, 290, 1); cam(16, 480, 290, 1, 'ease-in-out'); cam(32, 478, 312, 1.3); cam(56, 470, 316, 1.5);
cam(76, 462, 318, 1.62); cam(106, 480, 314, 1.45); cam(126, 486, 316, 1.68, 'ease-in');
cam(W, 492, 320, 1.85, 'linear'); cam(W + 1, 499, 314, 1.79, 'linear'); cam(W + 3, 486, 324, 1.83, 'linear'); cam(W + 5, 494, 318, 1.8);
cam(W + 6, 492, 318, 1.78, 'ease-in-out'); cam(W + 15, 480, 270, 1.0); cam(W + 50, 480, 270, 1.0); cam(W + 88, 470, 292, 1.08);

// Confetti: strips and dots fall, swaying and spinning, from just after the slam; some land on the table.
const colors = ['#ff4d6d', '#ffc300', '#3bceac', '#0ead69', '#5e60ce', '#ff9f1c', '#00bbf9', '#f15bb5'];
for (let i = 0; i < 64; i++) {
  const id = `c${i + 1}`, dot = i % 5 === 4, x0 = ri(15, 945), color = colors[i % colors.length];
  const len = ri(8, 13), startY = -ri(15, 260), speed = rr(5.5, 8.5), sway = rr(10, 26), spin = rr(14, 30) * (rnd() < .5 ? -1 : 1);
  const onTable = x0 > TABLE_X[0] + 6 && x0 < TABLE_X[1] - 14 && rnd() < 0.7;
  const land = onTable ? TABLE_TOP - 7 : ri(GR - 14, GR + 22);
  script.props[id] = dot ? {shape: 'circle', group: 'Confetti', z: 5, r: 3.5, color, x: x0, y: -400}
    : {shape: 'line', group: 'Confetti', z: 5, from: [x0, -400], to: [x0 + len, -400], color, thickness: 4.5};
  entry(1)[id] = {y: -400, ease: 'hold'};
  const t0 = W + 2 + ri(0, 14), phase = rr(0, 6.28);
  let f = t0, y = startY, rot = 0;
  while (true) {
    const done = y >= land;
    const x = R1(x0 + Math.sin(phase + (f - t0) / 6) * sway);
    entry(f)[id] = {x, y: R1(Math.min(y, land)), ...(dot ? {} : {rotate: R1(done ? Math.round(rot / 180) * 180 + ri(-12, 12) : rot)}), ease: done ? 'hold' : 'smooth'};
    if (done || f >= W + 82) break;
    f += 4; y += speed * 4; rot += spin * 4;
  }
}

// ---- Write: one entity per line.
script.timeline = [...at.keys()].sort((a, b) => a - b).map(f => at.get(f));
const head = `// Arm wrestle. The referee holds the grip, GO, Red nearly wins, Blue comes back and slams it,
// the crowd erupts and confetti falls. Generated by examples/scripts/arm-wrestle.gen.mjs: the wrestlers'
// bodies are solved from the table (elbows planted, one shared grip, hips under the lean, feet in a lunge).
`;
const line = ([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
const text = JSON.stringify({...script, figures: 0, props: 0, timeline: 0}, null, 2)
  .replace('"figures": 0', `"figures": {\n${Object.entries(script.figures).map(line).join(',\n')}\n  }`)
  .replace('"props": 0', `"props": {\n${Object.entries(script.props).map(line).join(',\n')}\n  }`)
  .replace('"timeline": 0', `"timeline": [\n${script.timeline.map(o => {
    const {at: f, id, note, camera, ...rest} = o;
    const top = JSON.stringify({at: f, ...(id ? {id} : {}), ...(note ? {note} : {}), ...(camera ? {camera} : {})}).slice(1, -1);
    return `    {${[top, ...Object.entries(rest).map(([k, v]) => `\n      ${JSON.stringify(k)}: ${JSON.stringify(v)}`)].join(',')}}`;
  }).join(',\n')}\n  ]`);
writeFileSync(OUT, head + text + '\n');
console.log(`Wrote ${OUT}: ${script.timeline.length} entries, ${Object.keys(script.figures).length} figures, ${Object.keys(script.props).length} props.`);
