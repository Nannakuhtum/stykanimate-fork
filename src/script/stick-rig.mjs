/** The scripted stick rig: Blue, the figure File → New starts with.
 *
 * Scripts name Blue's ten bones and give each one the screen direction it
 * points in, in degrees: 0 right, 90 down, 180 left, -90 (or 270) up. The
 * root is the hip joint; the torso and both thighs start there, the head and
 * arms start at the top of the torso (the neck). This file owns the mapping
 * between those names/degrees and Blue's native segment records (absolute
 * radians in the same screen convention), so the compiler, the preview and
 * the app's "capture pose" share one definition.
 */
import {createBlueStartupPose} from '../startup-blue-data.mjs';

const DEG = Math.PI / 180;

/** Script joint names in Blue's native segment order. */
export const JOINTS = Object.freeze(['torso', 'head', 'armL', 'forearmL', 'armR', 'forearmR', 'thighL', 'shinL', 'thighR', 'shinR']);
/** Accepted spellings: Blue's own segment names (shown in the app) and a few natural ones. */
const ALIASES = new Map([
  ['body', 'torso'], ['spine', 'torso'], ['neck', 'head'],
  ['upperarml', 'armL'], ['upperarmr', 'armR'], ['lowerarml', 'forearmL'], ['lowerarmr', 'forearmR'],
  ['legl', 'thighL'], ['legr', 'thighR'], ['lowerlegl', 'shinL'], ['lowerlegr', 'shinR'], ['calfl', 'shinL'], ['calfr', 'shinR'],
  ['left upper arm', 'armL'], ['left forearm', 'forearmL'], ['right upper arm', 'armR'], ['right forearm', 'forearmR'],
  ['left thigh', 'thighL'], ['left lower leg', 'shinL'], ['right thigh', 'thighR'], ['right lower leg', 'shinR'],
]);
for (const name of JOINTS) ALIASES.set(name.toLowerCase(), name);
export const jointName = name => ALIASES.get(String(name).trim().toLowerCase()) ?? null;

/** Blue's bone lengths (scale 1), parents (index, -1 = hip root) and thickness. */
const BLUE = createBlueStartupPose();
export const SEGMENTS = Object.freeze(BLUE.figure.segments.map((segment, index) => Object.freeze({
  joint: JOINTS[index], index, length: segment.length, thickness: segment.thickness,
  parent: segment.parent_id ? segment.parent_id - 1 : -1, circle: segment.segment_type === 'circle',
})));

const neutral = Object.fromEntries(JOINTS.map((joint, index) => [joint, round(BLUE.object.angles[index] / DEG)]));

/** Built-in poses, authored facing right (toward +x). Unlisted joints come from "neutral". */
export const BUILTIN_POSES = Object.freeze(Object.fromEntries(Object.entries({
  neutral,
  stand: {torso: -90, head: -90, armL: 72, forearmL: 82, armR: 108, forearmR: 98, thighL: 80, shinL: 88, thighR: 100, shinR: 92},
  ready: {torso: -84, head: -80, armL: 35, forearmL: -55, armR: 105, forearmR: -60, thighL: 62, shinL: 96, thighR: 118, shinR: 100},
  punch: {torso: -78, head: -76, armL: 2, forearmL: 0, armR: 112, forearmR: -45, thighL: 55, shinL: 92, thighR: 126, shinR: 102},
  kick: {torso: -106, head: -98, armL: 40, forearmL: -70, armR: 125, forearmR: -55, thighL: -8, shinL: -4, thighR: 98, shinR: 92},
  block: {torso: -96, head: -100, armL: -20, forearmL: -95, armR: 60, forearmR: -80, thighL: 70, shinL: 95, thighR: 115, shinR: 100},
  hit: {torso: -122, head: -135, armL: -40, forearmL: -10, armR: 170, forearmR: 150, thighL: 70, shinL: 80, thighR: 105, shinR: 115},
  crouch: {torso: -60, head: -56, armL: 30, forearmL: -10, armR: 52, forearmR: 4, thighL: 20, shinL: 140, thighR: 25, shinR: 142},
  jump: {torso: -80, head: -80, armL: -55, forearmL: -80, armR: -100, forearmR: -105, thighL: 10, shinL: 120, thighR: 32, shinR: 132},
  walk1: {torso: -88, head: -88, armL: 62, forearmL: 70, armR: 120, forearmR: 108, thighL: 62, shinL: 82, thighR: 122, shinR: 112},
  walk2: {torso: -88, head: -88, armL: 120, forearmL: 108, armR: 62, forearmR: 70, thighL: 122, shinL: 112, thighR: 62, shinR: 82},
  run1: {torso: -74, head: -74, armL: 40, forearmL: -40, armR: 140, forearmR: 80, thighL: 38, shinL: 82, thighR: 140, shinR: 170},
  run2: {torso: -74, head: -74, armL: 140, forearmL: 80, armR: 40, forearmR: -40, thighL: 140, shinL: 170, thighR: 38, shinR: 82},
  fall: {torso: -150, head: -152, armL: -60, forearmL: -30, armR: -110, forearmR: -150, thighL: 20, shinL: 40, thighR: 50, shinR: 70},
  lie: {torso: 180, head: 180, armL: 8, forearmL: 2, armR: -4, forearmR: -2, thighL: 0, shinL: 0, thighR: 4, shinR: 2},
  sit: {torso: -90, head: -88, armL: 70, forearmL: 10, armR: 80, forearmR: 15, thighL: 0, shinL: 90, thighR: 4, shinR: 94},
  wave: {torso: -90, head: -86, armL: 72, forearmL: 82, armR: -30, forearmR: -80, thighL: 80, shinL: 88, thighR: 100, shinR: 92},
  cheer: {torso: -90, head: -90, armL: -60, forearmL: -72, armR: -120, forearmR: -108, thighL: 76, shinL: 86, thighR: 104, shinR: 94},
}).map(([name, pose]) => [name, Object.freeze({...neutral, ...pose})])));

function round(value, places = 1) { const f = 10 ** places; return Math.round(value * f) / f; }

/** Mirrors a direction about the vertical axis (a figure facing left). */
export const mirrorDirection = degrees => 180 - degrees;

/** Script degrees (complete pose, facing right) → native absolute radians. */
export function nativeAngles(pose, {facing = 'right', rotate = 0} = {}) {
  return JOINTS.map(joint => {
    let degrees = pose[joint] + rotate;
    if (facing === 'left') degrees = mirrorDirection(degrees);
    return degrees * DEG;
  });
}

/** Native radians → script degrees as authored for `facing`, normalized to (-180, 180]. */
export function scriptPose(angles, {facing = 'right'} = {}) {
  const pose = {};
  JOINTS.forEach((joint, index) => {
    let degrees = angles[index] / DEG;
    if (facing === 'left') degrees = mirrorDirection(degrees);
    degrees = ((degrees % 360) + 540) % 360 - 180;
    pose[joint] = round(degrees === -180 ? 180 : degrees);
  });
  return pose;
}

/** Joint end points for native angles from the hip root, used for grounding and IK targets. */
export function forwardKinematics(angles, {x = 0, y = 0, scale = 1} = {}) {
  const ends = [];
  for (const segment of SEGMENTS) {
    const start = segment.parent < 0 ? {x, y} : ends[segment.parent];
    const length = segment.length * scale;
    ends.push({x: start.x + Math.cos(angles[segment.index]) * length, y: start.y + Math.sin(angles[segment.index]) * length, start});
  }
  return ends;
}

/** Distance from the hip root down to the lowest drawn point (feet include half their thickness). */
export function lowestOffset(angles, scale = 1) {
  let lowest = 0;
  for (const [index, end] of forwardKinematics(angles, {scale}).entries()) {
    const segment = SEGMENTS[index];
    if (segment.circle) {
      const cy = (end.y + end.start.y) / 2;
      lowest = Math.max(lowest, cy + segment.length * scale / 2);
    } else lowest = Math.max(lowest, end.y + segment.thickness * scale / 2, end.start.y);
  }
  return lowest;
}

/** A fresh Blue figure definition and template object (independent copies). */
export function blueTemplate() { return createBlueStartupPose(); }

/** Two-bone chains a script can aim: the limb's two joints and where the chain starts. */
export const LIMBS = Object.freeze({
  handL: Object.freeze({bones: [2, 3], kind: 'arm'}), handR: Object.freeze({bones: [4, 5], kind: 'arm'}),
  footL: Object.freeze({bones: [6, 7], kind: 'leg'}), footR: Object.freeze({bones: [8, 9], kind: 'leg'}),
});
const BEND_DIRECTIONS = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]};

/**
 * Aims one limb's hand or foot at a scene point (two-bone IK) and returns new native angles.
 * `bend` picks which side the elbow or knee goes: up, down, left, right, forward or back
 * (forward/back follow `facing`). Default: elbows down, knees forward. A target out of reach
 * straightens the limb toward it; `reached` reports how far short it fell (0 when it touches).
 */
export function solveReach(angles, {x, y, scale = 1, facing = 'right'}, limb, target, bend) {
  const {bones: [first, second], kind} = LIMBS[limb];
  const ends = forwardKinematics(angles, {x, y, scale});
  const base = ends[first].start, l1 = SEGMENTS[first].length * scale, l2 = SEGMENTS[second].length * scale;
  const dx = target.x - base.x, dy = target.y - base.y, full = Math.hypot(dx, dy);
  const d = Math.min(Math.max(full, Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6);
  const toward = Math.atan2(dy, dx), spread = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const side = bend ?? (kind === 'arm' ? 'down' : 'forward');
  const forward = facing === 'left' ? -1 : 1;
  const direction = side === 'forward' ? [forward, 0] : side === 'back' ? [-forward, 0] : BEND_DIRECTIONS[side];
  let best = null;
  for (const sign of [1, -1]) {
    const a1 = toward + sign * spread, elbow = {x: base.x + Math.cos(a1) * l1, y: base.y + Math.sin(a1) * l1};
    const reachEnd = {x: base.x + Math.cos(toward) * d, y: base.y + Math.sin(toward) * d};
    const a2 = Math.atan2(reachEnd.y - elbow.y, reachEnd.x - elbow.x);
    const score = (elbow.x - (base.x + reachEnd.x) / 2) * direction[0] + (elbow.y - (base.y + reachEnd.y) / 2) * direction[1];
    if (!best || score > best.score) best = {score, a1, a2};
  }
  const next = [...angles];
  next[first] = unwrapNear(best.a1, angles[first]);
  next[second] = unwrapNear(best.a2, angles[second]);
  return {angles: next, short: Math.max(0, full - (l1 + l2))};
}
const unwrapNear = (angle, near) => angle + Math.round((near - angle) / (2 * Math.PI)) * 2 * Math.PI;
