/** StykScript: a text description of a stick animation that compiles to an
 * ordinary editable StykAnimate document.
 *
 * The compiler is pure (no DOM, no workers, no files) so the desktop app, the
 * agent command line and the tests share it. Every figure and moving prop gets
 * its own layer, and each script key becomes a key on that layer's track with
 * its own easing, so what the person sees in the timeline is exactly what the
 * script says. See docs/AGENT-SCRIPTING.md for the format.
 */
import {parseJsonc, lineOf, escapeKey, ScriptSyntaxError} from './jsonc.mjs';
import {JOINTS, BUILTIN_POSES, LIMBS, jointName, nativeAngles, scriptPose, solveReach, lowestOffset, forwardKinematics, blueTemplate} from './stick-rig.mjs';
import {emptyDocument, createFrame, createObject} from '../demo.mjs';
import {ensureLayerState, LAYER_COLORS} from '../layers.mjs';

export const SCRIPT_VERSION = 1;
export const EASE_NAMES = Object.freeze({
  smooth: 'auto', auto: 'auto', linear: 'linear', 'ease-in': 'ease-in', 'ease-out': 'ease-out',
  'ease-in-out': 'bezier', bezier: 'bezier', hold: 'constant', constant: 'constant', step: 'constant',
});
const CANVASES = {landscape: [960, 540], portrait: [540, 960], square: [720, 720], hd: [1920, 1080]};
const TOP_KEYS = new Set(['stykscript', 'title', 'canvas', 'fps', 'background', 'ground', 'length', 'defaults', 'poses', 'figures', 'props', 'timeline', 'notes']);
const FIGURE_KEYS = new Set(['name', 'color', 'scale', 'x', 'y', 'facing', 'pose', 'rotate', 'reach', 'hands', 'z', 'group', 'note']);
const PROP_KEYS = new Set(['name', 'shape', 'color', 'thickness', 'fill', 'from', 'to', 'r', 'x', 'y', 'rotate', 'scale', 'z', 'group', 'note']);
const STATE_KEYS = new Set(['pose', 'x', 'y', 'facing', 'rotate', 'scale', 'reach', 'ease', 'bezier']);
const CAMERA_KEYS = new Set(['x', 'y', 'zoom', 'rotate', 'ease', 'bezier']);
const ENTRY_KEYS = new Set(['at', 'id', 'note', 'ease', 'camera']);
const RESERVED_IDS = new Set([...ENTRY_KEYS, 'scene']);
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
const PALETTE = ['#0d99ff', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6', '#ffb224', '#12a594', '#d6409f'];
const LAYER_COLOR_IDS = Object.keys(LAYER_COLORS);

export class ScriptError extends Error {
  constructor(diagnostics) {
    const first = diagnostics.find(d => d.level === 'error') ?? diagnostics[0];
    super(first ? `Line ${first.line}: ${first.message}` : 'The script could not be compiled.');
    this.name = 'ScriptError';
    this.diagnostics = diagnostics;
  }
}

/** Parses and compiles. Returns {ok, diagnostics, report, index, script}; never throws for script mistakes. */
export function compileScript(input) {
  const diagnostics = [];
  let script, lines = new Map();
  try {
    if (typeof input === 'string') ({value: script, lines} = parseJsonc(input));
    else script = input;
  } catch (error) {
    if (!(error instanceof ScriptSyntaxError)) throw error;
    return {ok: false, diagnostics: [{level: 'error', line: error.line, path: '', message: error.message}], report: null, index: null, script: null};
  }
  const context = new Context(script, lines, diagnostics);
  let result = null;
  try { result = context.compile(); }
  catch (error) { if (!(error instanceof Abort)) throw error; }
  diagnostics.sort((a, b) => a.line - b.line || (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  const ok = !diagnostics.some(d => d.level === 'error');
  return {ok, diagnostics, report: ok ? result.report : null, index: ok ? result.index : null, script};
}

/** Like compileScript, but throws a ScriptError when the script has errors. */
export function compileScriptOrThrow(input) {
  const result = compileScript(input);
  if (!result.ok) throw new ScriptError(result.diagnostics);
  return result;
}

class Abort extends Error {}
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);

class Context {
  constructor(script, lines, diagnostics) { Object.assign(this, {script, lines, diagnostics}); }
  report(level, path, message) { this.diagnostics.push({level, line: lineOf(this.lines, path), path, message}); }
  error(path, message) { this.report('error', path, message); }
  warn(path, message) { this.report('warning', path, message); }
  fatal(path, message) { this.error(path, message); throw new Abort(); }
  unknownKeys(object, allowed, path, what) {
    for (const key of Object.keys(object)) if (!allowed.has(key)) this.warn(`${path}/${escapeKey(key)}`, `Unknown ${what} property "${key}" is ignored.`);
  }
  number(value, path, {min = -Infinity, max = Infinity, name}) {
    if (!finite(value) || value < min || value > max) { this.error(path, `${name} must be a number${min > -Infinity ? ` from ${min}` : ''}${max < Infinity ? ` to ${max}` : ''}.`); return null; }
    return value;
  }
  color(value, path, fallback) {
    if (value === undefined) return fallback;
    const match = typeof value === 'string' && /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(value.trim());
    if (!match) { this.error(path, 'Colors are written "#rrggbb".'); return fallback; }
    const hex = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1];
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  }

  compile() {
    const s = this.script;
    if (!isRecord(s)) this.fatal('', 'A script is a JSON object.');
    if (s.stykscript !== SCRIPT_VERSION) this.error('/stykscript', `Start the script with "stykscript": ${SCRIPT_VERSION}.`);
    this.unknownKeys(s, TOP_KEYS, '', 'script');
    const report = emptyDocument();
    report._styk.name = typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0, 120) : 'Scripted animation';
    if (s.title !== undefined && typeof s.title !== 'string') this.error('/title', 'The title is text.');
    const [width, height] = this.canvas(s.canvas);
    report.canvas_width = width; report.canvas_height = height;
    if (s.fps !== undefined) report.fps = this.number(s.fps, '/fps', {min: 1, max: 120, name: 'fps'}) ?? 24;
    this.width = width; this.height = height;
    this.ground = s.ground === undefined ? null : this.number(s.ground, '/ground', {name: 'ground'});
    const defaults = isRecord(s.defaults) ? s.defaults : {};
    if (s.defaults !== undefined && !isRecord(s.defaults)) this.error('/defaults', '"defaults" is an object.');
    else this.unknownKeys(defaults, new Set(['ease']), '/defaults', 'defaults');
    this.defaultEase = defaults.ease === undefined ? {interpolation: 'auto'} : this.ease(defaults.ease, undefined, '/defaults/ease');

    this.poses = this.poseLibrary(s.poses);
    const entities = this.entities(s);
    const {entries, length} = this.timeline(s, entities);
    this.background(report, s.background);
    return this.build(report, entities, entries, length);
  }

  canvas(value) {
    if (value === undefined) return CANVASES.landscape;
    if (typeof value === 'string') {
      if (CANVASES[value]) return CANVASES[value];
      this.error('/canvas', `Canvas is {"width", "height"} or one of ${Object.keys(CANVASES).join(', ')}.`);
      return CANVASES.landscape;
    }
    if (!isRecord(value)) { this.error('/canvas', 'Canvas is {"width", "height"}.'); return CANVASES.landscape; }
    this.unknownKeys(value, new Set(['width', 'height']), '/canvas', 'canvas');
    const w = this.number(value.width, '/canvas/width', {min: 16, max: 8000, name: 'Canvas width'});
    const h = this.number(value.height, '/canvas/height', {min: 16, max: 8000, name: 'Canvas height'});
    return [Math.round(w ?? 960), Math.round(h ?? 540)];
  }

  background(report, value) {
    if (value === undefined) return;
    const rgb = this.color(value, '/background', null);
    if (!rgb) return;
    const color = (0xff000000 | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) >>> 0;
    report.backgrounds = [{background_id: 1, kind: 2, color, name: `Color ${value.replace('#', '').toUpperCase()}`}];
    this.backgroundId = 1;
    this.backgroundRgb = rgb;
  }

  ease(value, bezier, path) {
    const id = typeof value === 'string' ? EASE_NAMES[value.trim().toLowerCase()] : undefined;
    if (!id) { this.error(path, `Unknown ease "${value}". Use ${Object.keys(EASE_NAMES).filter(n => !['auto', 'constant', 'step', 'bezier'].includes(n)).join(', ')}.`); return {interpolation: 'auto'}; }
    if (bezier !== undefined) {
      if (!Array.isArray(bezier) || bezier.length !== 4 || !bezier.every(v => finite(v) && v >= 0 && v <= 1)) this.error(path.replace(/ease$/, 'bezier'), '"bezier" is four numbers from 0 to 1.');
      else return {interpolation: 'bezier', bezier: [...bezier]};
    }
    return id === 'bezier' ? {interpolation: 'bezier', bezier: [0.42, 0, 0.58, 1]} : {interpolation: id};
  }

  /** Named poses: built-ins, then the script's own (which may extend each other with "base"). */
  poseLibrary(value) {
    const library = new Map(Object.entries(BUILTIN_POSES));
    if (value === undefined) return library;
    if (!isRecord(value)) { this.error('/poses', '"poses" maps names to poses.'); return library; }
    const pending = new Map(Object.entries(value)), resolving = new Set();
    const resolve = name => {
      if (!pending.has(name)) return library.get(name);
      const path = `/poses/${escapeKey(name)}`;
      if (resolving.has(name)) { this.error(path, `Pose "${name}" extends itself.`); return BUILTIN_POSES.neutral; }
      resolving.add(name);
      const spec = pending.get(name);
      let pose = BUILTIN_POSES.neutral;
      if (!isRecord(spec)) this.error(path, `Pose "${name}" is an object of joint directions.`);
      else {
        let base = BUILTIN_POSES.neutral;
        if (spec.base !== undefined) {
          if (typeof spec.base !== 'string' || !(pending.has(spec.base) || library.has(spec.base))) this.error(`${path}/base`, `Unknown base pose "${spec.base}".`);
          else base = resolve(spec.base);
        }
        pose = this.poseJoints(spec, base, path);
      }
      pending.delete(name); resolving.delete(name);
      library.set(name, pose);
      return pose;
    };
    for (const name of [...pending.keys()]) {
      if (!ID_PATTERN.test(name)) this.error(`/poses/${escapeKey(name)}`, `Pose names use letters, digits, "-" and "_".`);
      if (BUILTIN_POSES[name]) this.warn(`/poses/${escapeKey(name)}`, `Pose "${name}" replaces the built-in pose of that name.`);
      resolve(name);
    }
    return library;
  }

  poseJoints(spec, base, path) {
    const pose = {...base};
    for (const [key, degrees] of Object.entries(spec)) {
      if (key === 'base') continue;
      const joint = jointName(key), at = `${path}/${escapeKey(key)}`;
      if (!joint) { this.error(at, `Unknown joint "${key}". Joints: ${JOINTS.join(', ')}.`); continue; }
      if (!finite(degrees)) { this.error(at, `"${key}" is a direction in degrees.`); continue; }
      pose[joint] = degrees;
    }
    return Object.freeze(pose);
  }

  pose(value, previous, path) {
    if (typeof value === 'string') {
      const pose = this.poses.get(value);
      if (!pose) { this.error(path, `Unknown pose "${value}". Built-in poses: ${Object.keys(BUILTIN_POSES).join(', ')}.`); return previous; }
      return pose;
    }
    if (!isRecord(value)) { this.error(path, 'A pose is a name or an object of joint directions.'); return previous; }
    let base = previous;
    if (value.base !== undefined) {
      if (typeof value.base !== 'string' || !this.poses.has(value.base)) this.error(`${path}/base`, `Unknown base pose "${value.base}".`);
      else base = this.poses.get(value.base);
    }
    return this.poseJoints(value, base, path);
  }

  entities(s) {
    const entities = new Map();
    const add = (kind, group) => {
      const value = s[group];
      if (value === undefined) return;
      if (!isRecord(value)) { this.error(`/${group}`, `"${group}" maps names to ${group}.`); return; }
      for (const [id, spec] of Object.entries(value)) {
        const path = `/${group}/${escapeKey(id)}`;
        if (!ID_PATTERN.test(id) || RESERVED_IDS.has(id)) { this.error(path, `"${id}" can't be used as a name: use letters, digits, "-" and "_", and not ${[...RESERVED_IDS].join(', ')}.`); continue; }
        if (entities.has(id)) { this.error(path, `"${id}" is already a figure or prop.`); continue; }
        if (!isRecord(spec)) { this.error(path, `"${id}" is an object.`); continue; }
        const entity = kind === 'figure' ? this.figure(id, spec, path, entities.size) : this.prop(id, spec, path);
        entity.order = entities.size;
        entity.z = spec.z === undefined ? null : this.number(spec.z, `${path}/z`, {min: -1000, max: 1000, name: 'z'});
        if (spec.group !== undefined && (typeof spec.group !== 'string' || !spec.group.trim())) this.error(`${path}/group`, '"group" is the name of a folder to put this layer in.');
        entity.group = typeof spec.group === 'string' && spec.group.trim() ? spec.group.trim().slice(0, 80) : null;
        entities.set(id, entity);
      }
    };
    add('figure', 'figures');
    add('prop', 'props');
    if (!entities.size) this.warn('/figures', 'The script has no figures.');
    return entities;
  }

  figure(id, spec, path, order) {
    this.unknownKeys(spec, FIGURE_KEYS, path, 'figure');
    const figure = {kind: 'figure', id, path, line: lineOf(this.lines, path),
      name: typeof spec.name === 'string' && spec.name.trim() ? spec.name.trim().slice(0, 80) : id,
      color: this.color(spec.color, `${path}/color`, this.color(PALETTE[order % PALETTE.length], path, [13, 153, 255])),
      keys: []};
    const state = {pose: BUILTIN_POSES.neutral, x: this.width / 2, y: null, facing: 'right', rotate: 0, scale: 1, ease: undefined};
    if (spec.hands !== undefined && typeof spec.hands !== 'boolean') this.error(`${path}/hands`, '"hands" is true (fists at the wrists) or false.');
    figure.hands = spec.hands === true;
    figure.initial = this.applyState(figure, state, spec, path, {initial: true});
    return figure;
  }

  prop(id, spec, path) {
    this.unknownKeys(spec, PROP_KEYS, path, 'prop');
    const shape = spec.shape ?? 'line';
    const prop = {kind: 'prop', id, path, line: lineOf(this.lines, path), shape,
      name: typeof spec.name === 'string' && spec.name.trim() ? spec.name.trim().slice(0, 80) : id,
      color: this.color(spec.color, `${path}/color`, [51, 51, 51]),
      thickness: spec.thickness === undefined ? (shape === 'line' ? 4 : 0) : this.number(spec.thickness, `${path}/thickness`, {min: 0, max: 400, name: 'thickness'}) ?? 4,
      fill: spec.fill !== false, keys: []};
    const state = {x: 0, y: 0, rotate: 0, scale: 1, ease: undefined};
    if (shape === 'line') {
      const point = (value, at) => Array.isArray(value) && value.length === 2 && value.every(finite) ? value : (this.error(at, 'Points are [x, y].'), [0, 0]);
      const from = point(spec.from ?? [0, this.ground ?? this.height * 0.8], `${path}/from`);
      const to = point(spec.to ?? [this.width, from[1]], `${path}/to`);
      prop.length = Math.max(1, Math.hypot(to[0] - from[0], to[1] - from[1]));
      prop.angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
      Object.assign(state, {x: from[0], y: from[1]});
    } else if (shape === 'circle') {
      prop.r = this.number(spec.r ?? 12, `${path}/r`, {min: 0.5, max: 4000, name: 'r'}) ?? 12;
      Object.assign(state, {x: this.width / 2, y: this.height / 2});
    } else this.error(`${path}/shape`, 'Props are "line" or "circle".');
    prop.initial = this.applyState(prop, state, spec, path, {initial: true});
    return prop;
  }

  /** One key's state for an entity: everything not given carries over from `previous`. */
  applyState(entity, previous, spec, path, {initial = false} = {}) {
    const next = {...previous};
    if (!initial) this.unknownKeys(spec, entity.kind === 'figure' ? STATE_KEYS : new Set(['x', 'y', 'rotate', 'scale', 'ease', 'bezier']), path, 'key');
    if (entity.kind === 'prop' && spec.pose !== undefined && !initial) this.error(`${path}/pose`, 'Props have no pose.');
    const relative = (value, base, at, name) => {
      if (finite(value)) return value;
      const match = typeof value === 'string' && /^([+-])\s*(\d+(?:\.\d+)?)$/.exec(value.trim());
      if (match) return base + (match[1] === '-' ? -1 : 1) * Number(match[2]);
      this.error(at, `${name} is a number, or "+n"/"-n" to move from the previous key.`);
      return base;
    };
    if (spec.x !== undefined) next.x = relative(spec.x, previous.x, `${path}/x`, 'x');
    if (spec.y !== undefined) {
      if (spec.y === 'ground' && entity.kind === 'figure') {
        if (this.ground === null) this.error(`${path}/y`, '"y": "ground" needs "ground" (the floor\'s y) at the top of the script.');
        next.y = 'ground';
      } else next.y = relative(spec.y, previous.y === 'ground' || previous.y === null ? this.groundedY(entity, previous) : previous.y, `${path}/y`, 'y');
    }
    if (spec.rotate !== undefined) next.rotate = relative(spec.rotate, previous.rotate, `${path}/rotate`, 'rotate');
    if (spec.scale !== undefined) next.scale = this.number(spec.scale, `${path}/scale`, {min: 0.05, max: 50, name: 'scale'}) ?? previous.scale;
    if (entity.kind === 'figure') {
      if (spec.facing !== undefined) {
        if (spec.facing !== 'left' && spec.facing !== 'right') this.error(`${path}/facing`, '"facing" is "left" or "right".');
        else next.facing = spec.facing;
      }
      if (spec.pose !== undefined) next.pose = this.pose(spec.pose, previous.pose, `${path}/pose`);
      if (spec.reach !== undefined) next.pose = this.reach(entity, next, spec.reach, `${path}/reach`);
    }
    next.ease = spec.ease !== undefined || spec.bezier !== undefined ? this.ease(spec.ease ?? 'ease-in-out', spec.bezier, `${path}/${spec.ease !== undefined ? 'ease' : 'bezier'}`) : undefined;
    if (initial && next.y === null) next.y = entity.kind === 'figure' && this.ground !== null ? 'ground' : this.height * 0.52;
    return next;
  }

  /** Aims hands and feet at scene points; the solved angles become the key's pose, so later keys carry them. */
  reach(entity, state, spec, path) {
    if (!isRecord(spec)) { this.error(path, '"reach" maps handL, handR, footL or footR to a point [x, y] or {"x", "y", "bend"}.'); return state.pose; }
    const y = state.y === 'ground' || state.y === null ? this.groundedY(entity, {...state, y: null}) : state.y;
    let angles = nativeAngles(state.pose, state);
    for (const [limb, value] of Object.entries(spec)) {
      const at = `${path}/${escapeKey(limb)}`;
      if (!LIMBS[limb]) { this.error(at, `Unknown limb "${limb}". Use ${Object.keys(LIMBS).join(', ')}.`); continue; }
      const point = Array.isArray(value) ? {x: value[0], y: value[1]} : isRecord(value) ? value : null;
      if (!point || !finite(point.x) || !finite(point.y)) { this.error(at, 'A reach target is [x, y] or {"x", "y", "bend"} in scene pixels.'); continue; }
      if (point.bend !== undefined && !['up', 'down', 'left', 'right', 'forward', 'back'].includes(point.bend)) { this.error(`${at}/bend`, '"bend" is up, down, left, right, forward or back.'); continue; }
      if (LIMBS[limb].kind === 'leg' && state.y === 'ground') this.warn(at, 'Feet that reach for a point and "y": "ground" disagree about where the feet are; give the figure a numeric y.');
      const solved = solveReach(angles, {x: state.x, y, scale: state.scale, facing: state.facing}, limb, point, point.bend);
      if (solved.short > 2) this.warn(at, `${entity.id}'s ${limb} falls ${Math.round(solved.short)} px short of [${point.x}, ${point.y}]; move the figure closer.`);
      angles = solved.angles;
    }
    // Back to script terms: undo the facing mirror and the whole-figure rotation.
    const pose = scriptPose(angles, {facing: state.facing});
    for (const joint of JOINTS) pose[joint] -= state.rotate ?? 0;
    return Object.freeze(pose);
  }

  groundedY(entity, state) {
    if (entity.kind !== 'figure') return state.y ?? 0;
    if (this.ground === null) return this.height * 0.52;
    return this.ground - lowestOffset(nativeAngles(state.pose, state), state.scale);
  }

  timeline(s, entities) {
    const entries = [];
    if (s.timeline === undefined) return {entries, length: s.length ?? 24};
    if (!Array.isArray(s.timeline)) { this.error('/timeline', '"timeline" is a list of keys.'); return {entries, length: 24}; }
    const ids = new Set();
    let frame = 1, previousFrame = 0;
    s.timeline.forEach((entry, index) => {
      const path = `/timeline/${index}`;
      if (!isRecord(entry)) { this.error(path, 'Each timeline entry is an object with "at".'); return; }
      if (entry.at === undefined) this.error(path, 'Each timeline entry needs "at": a frame number (1 is the first frame) or "+n" frames after the previous entry.');
      else if (finite(entry.at) && Number.isInteger(entry.at) && entry.at >= 1) frame = entry.at;
      else if (typeof entry.at === 'string' && /^\+\d+$/.test(entry.at.trim())) frame = previousFrame + Number(entry.at.trim().slice(1));
      else this.error(`${path}/at`, '"at" is a whole frame number from 1, or "+n".');
      if (frame <= previousFrame && index > 0) this.error(`${path}/at`, `Entries must go forward in time: frame ${frame} comes after frame ${previousFrame}.`);
      previousFrame = Math.max(previousFrame, frame);
      const id = entry.id === undefined ? `k${index + 1}` : String(entry.id);
      if (entry.id !== undefined && (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id))) this.error(`${path}/id`, 'Entry ids use letters, digits, "-" and "_".');
      if (ids.has(id)) this.error(`${path}/id`, `Entry id "${id}" is used twice.`);
      ids.add(id);
      if (entry.note !== undefined && typeof entry.note !== 'string') this.error(`${path}/note`, 'A note is text.');
      const targets = Object.keys(entry).filter(key => !ENTRY_KEYS.has(key));
      for (const key of targets) if (!entities.has(key)) this.error(`${path}/${escapeKey(key)}`, `"${key}" is not a figure or prop in this script. Known: ${[...entities.keys()].join(', ') || 'none'}.`);
      if (entry.camera !== undefined && !isRecord(entry.camera)) this.error(`${path}/camera`, '"camera" is an object.');
      if (!targets.length && entry.camera === undefined) this.warn(path, 'This entry changes nothing.');
      entries.push({entry, path, index, frame, tick: frame - 1, id, note: entry.note ?? '', line: lineOf(this.lines, path), targets: targets.filter(key => entities.has(key))});
    });
    const last = entries.at(-1)?.frame ?? 1;
    let length = last + 12;
    if (s.length !== undefined) {
      length = this.number(s.length, '/length', {min: 1, max: 100000, name: 'length'}) ?? length;
      if (length < last) this.warn('/length', `"length" (${length}) ends before the last entry (frame ${last}); the film is extended to frame ${last}.`);
      length = Math.max(Math.round(length), last);
    }
    return {entries, length};
  }

  build(report, entities, entries, length) {
    const template = blueTemplate();
    report.figure_types = [];
    report._styk.frameSources = {};
    const layers = ensureLayerState(report);
    Object.assign(layers, {order: [], byId: {}, assignments: {}, nextId: 1});
    const tracks = {}, sources = report._styk.frameSources;
    let sourceSerial = 1, cellSerial = 1, uid = 1;
    const source = frame => { const id = `frame-${sourceSerial++}`; frame._styk = {...frame._styk, frameId: id}; sources[id] = frame; return id; };
    const key = (tick, frame, easing) => ({id: `cell-${cellSerial++}`, tick, value: {frameId: source(frame)}, ...easing});
    const addLayer = (name, color) => {
      const id = `layer-${layers.nextId++}`;
      layers.order.push(id);
      layers.byId[id] = {name: name.slice(0, 160), visible: true, locked: false, ...(color ? {color} : {})};
      return id;
    };
    const index = {title: report._styk.name, length, fps: report.fps, canvas: {width: this.width, height: this.height}, ground: this.ground, background: this.backgroundRgb ?? [255, 255, 255],
      entries: entries.map(({id, frame, tick, line, note, targets, entry}) => ({id, frame, tick, line, note, targets, camera: entry.camera !== undefined})),
      figures: {}, poses: [...this.poses.keys()]};

    // Props that never move share one "Set" layer at the back; everything else gets its own layer.
    // Back to front: the Set (props that never move and have no "z"), then by "z" (default 0), then script order.
    const moving = new Set(entries.flatMap(e => e.targets));
    const onSet = entity => entity.kind === 'prop' && !moving.has(entity.id) && entity.z === null;
    const depth = entity => onSet(entity) ? -Infinity : entity.z ?? 0;
    const sorted = [...entities.values()].sort((a, b) => depth(a) - depth(b) || a.order - b.order);
    // A group's layers stay together (a folder is one block in the stack), where its first member falls.
    const ordered = [], placed = new Set();
    for (const entity of sorted) {
      if (placed.has(entity)) continue;
      const members = entity.group && !onSet(entity) ? sorted.filter(other => other.group === entity.group && !onSet(other)) : [entity];
      for (const member of members) { placed.add(member); ordered.push(member); }
    }
    const folders = new Map();
    const initialObjects = [];
    let setLayer = null, figureCount = 0;
    for (const entity of ordered) {
      const typeId = report.figure_types.length + 1, objectUid = uid++;
      report.figure_types.push(entity.kind === 'figure' ? this.figureType(template, entity, typeId) : this.propType(entity, typeId));
      const isStatic = onSet(entity);
      const layerId = isStatic ? (setLayer ??= addLayer('Set')) : addLayer(entity.name, entity.kind === 'figure' ? LAYER_COLOR_IDS[figureCount++ % LAYER_COLOR_IDS.length] : undefined);
      layers.assignments[String(objectUid)] = layerId;
      if (entity.group && !isStatic) {
        if (!folders.has(entity.group)) folders.set(entity.group, `folder-${folders.size + 1}`);
        layers.byId[layerId].folderId = folders.get(entity.group);
      }
      Object.assign(entity, {typeId, uid: objectUid, layerId, figureType: report.figure_types.at(-1)});
      // Each entity's own key list, carrying state forward from its initial spec.
      let state = entity.initial;
      const keys = [{tick: 0, state, entry: null}];
      for (const e of entries) {
        if (!e.targets.includes(entity.id)) continue;
        const spec = e.entry[entity.id], path = `${e.path}/${escapeKey(entity.id)}`;
        if (!isRecord(spec)) { this.error(path, `"${entity.id}" in a timeline entry is an object of changes (pose, x, y, ...).`); continue; }
        const entryEase = e.entry.ease !== undefined ? this.ease(e.entry.ease, undefined, `${e.path}/ease`) : undefined;
        state = this.applyState(entity, {...state}, spec, path);
        state.ease ??= entryEase;
        if (e.tick === 0) keys[0] = {tick: 0, state, entry: e};
        else keys.push({tick: e.tick, state, entry: e, path});
      }
      this.checkTurns(entity, keys);
      const objects = keys.map(k => this.object(entity, k.state, template));
      initialObjects.push({entity, object: objects[0]});
      if (isStatic) entity.staticObject = objects[0];
      else tracks[layerId] = {end: length, keys: keys.map((k, i) => key(k.tick, createFrame([objects[i]], 1), k.state.ease ?? this.defaultEase))};
      index.figures[entity.id] = {kind: entity.kind, name: entity.name, uid: objectUid, layerId, line: entity.line,
        keys: keys.map(k => ({tick: k.tick, frame: k.tick + 1, entry: k.entry?.id ?? null, facing: k.state.facing ?? 'right', line: k.entry ? lineOf(this.lines, `${k.entry.path}/${escapeKey(entity.id)}`) : entity.line}))};
    }
    if (setLayer) {
      const statics = ordered.filter(e => e.staticObject).map(e => e.staticObject);
      tracks[setLayer] = {end: length, keys: [key(0, createFrame(statics.map(o => ({...o})), 1), {interpolation: 'constant'})]};
    }
    if (!layers.order.length) addLayer('Layer 1');
    for (const id of layers.order) tracks[id] ??= {end: length, keys: [key(0, createFrame([], 1), {interpolation: 'constant'})]};
    if (folders.size) layers.folders = {nextId: folders.size + 1, byId: Object.fromEntries([...folders].map(([name, id]) => [id, {name}]))};
    layers.defaultLayerId = layers.order[0];
    layers.activeId = layers.order.find(id => id !== setLayer) ?? layers.order[0];

    tracks.camera = {end: length, keys: this.cameraKeys(entries).map(k => key(k.tick, {...createFrame([], 1), camera: k.camera}, k.ease))};
    const scene = createFrame([], 1);
    if (this.backgroundId) scene.background_id = this.backgroundId;
    tracks.scene = {end: length, keys: [key(0, scene, {interpolation: 'constant'})]};

    // The native frame list holds the opening frame; the sheet owns all timing.
    const opening = createFrame(initialObjects.map(({object}) => ({...object})), 1);
    opening.camera = tracks.camera.keys[0] && sources[tracks.camera.keys[0].value.frameId].camera;
    if (this.backgroundId) opening.background_id = this.backgroundId;
    opening._styk = {easing: {interpolation: 'constant'}};
    report.keyframes = [opening];
    const stage = {scene: tracks.scene, camera: tracks.camera};
    report._styk.layerSheet = {version: 1, duration: length, nextId: cellSerial, tracks: {...stage, ...Object.fromEntries(layers.order.map(id => [id, tracks[id]]))}};
    report._styk.script = {version: SCRIPT_VERSION};
    return {report, index};
  }

  figureType(template, figure, typeId) {
    const type = structuredClone(template.figure);
    type.figure_type_id = typeId;
    type.name = figure.name;
    for (const segment of type.segments) segment.color_rgb = [...figure.color];
    // Fists: a filled disc continuing each forearm, keyed with the forearm's own angle so it turns with it.
    if (figure.hands) for (const parent of [4, 6]) {
      const forearm = type.segments[parent - 1], id = type.segments.length + 1;
      type.segments.push({...structuredClone(forearm), segment_id: id, parent_id: parent, length: 15, thickness: 0, primitive_code: 3, flags: 3,
        segment_type: 'circle', segment_kind: 'circleFill', z_order: id, name: parent === 4 ? 'Left fist' : 'Right fist'});
    }
    type.segment_count = type.segments.length;
    return type;
  }

  propType(prop, typeId) {
    const base = {bend_rad: 0, aux_code: 0, transparency: 0, visible: true, z_order: 1, segment_id: 1, parent_id: 0, name: prop.name};
    const segment = prop.shape === 'circle'
      ? {...base, length: prop.r * 2, angle_rad: -Math.PI / 2, thickness: prop.thickness, primitive_code: prop.fill ? 3 : 1, flags: prop.fill ? 3 : 1,
        segment_type: 'circle', segment_kind: prop.fill ? 'circleFill' : 'circle', color_rgb: [...prop.color]}
      : {...base, length: prop.length ?? 100, angle_rad: prop.angle ?? 0, thickness: prop.thickness, primitive_code: 0, flags: 0,
        segment_type: 'line', segment_kind: 'line', color_rgb: [...prop.color]};
    return {figure_type_id: typeId, name: prop.name, segment_count: 1, segments: [segment], polyfills: [], image_assets: [], text_assets: []};
  }

  object(entity, state, template) {
    if (entity.kind === 'prop') {
      // A circle's root sits under its center so x/y name the center.
      const rotate = (state.rotate ?? 0) * Math.PI / 180, r = entity.shape === 'circle' ? entity.r * state.scale : 0;
      const object = createObject(entity.figureType, entity.uid, state.x, state.y + r, {scale: state.scale});
      object.angles = [(entity.shape === 'circle' ? -Math.PI / 2 : entity.angle) + rotate];
      return object;
    }
    const angles = nativeAngles(state.pose, state);
    const y = state.y === 'ground' ? this.ground - lowestOffset(angles, state.scale) : state.y;
    const object = structuredClone(template.object);
    Object.assign(object, {unique_id: entity.uid, figure_type_id: entity.typeId, root_x: round(state.x), root_y: round(y), scale: state.scale,
      angles: entity.hands ? [...angles, angles[3], angles[5]] : angles});
    // The hand/foot controllers keep scene-space targets: start them where the hands and feet are.
    const ends = forwardKinematics(angles, {x: object.root_x, y: object.root_y, scale: state.scale});
    for (const [id, control] of Object.entries(object._stykIK ?? {})) {
      const end = ends[Number(id) - 1];
      if (end && control.target) Object.assign(control.target, {x: end.x, y: end.y});
    }
    return object;
  }

  /** Joints always turn the short way between keys. Flag spins the author probably meant the long way. */
  checkTurns(entity, keys) {
    if (entity.kind !== 'figure') return;
    for (let i = 1; i < keys.length; i++) {
      const before = keys[i - 1].state, after = keys[i].state;
      if (keys[i - 1].state.ease?.interpolation === 'constant') continue;
      if (Math.abs((after.rotate ?? 0) - (before.rotate ?? 0)) > 180) {
        this.warn(`${keys[i].path}/rotate`, `${entity.id} rotates ${Math.abs(after.rotate - before.rotate)}° in one key, but joints turn the short way round: split spins and flips into keys less than 180° apart.`);
        continue;
      }
      const a = nativeAngles(before.pose, before), b = nativeAngles(after.pose, after);
      const ambiguous = JOINTS.filter((_, j) => Math.abs(Math.abs(((b[j] - a[j]) * 180 / Math.PI % 360 + 540) % 360 - 180)) > 172);
      if (ambiguous.length) this.warn(keys[i].path, `${entity.id}'s ${ambiguous.join(', ')} turn almost exactly half a circle from the previous key, so the direction they swing is a coin toss: add an in-between key.`);
    }
  }

  cameraKeys(entries) {
    let state = {x: this.width / 2, y: this.height / 2, zoom: 1, rotate: 0};
    const out = [];
    const native = s => ({is_default: s.x === this.width / 2 && s.y === this.height / 2 && s.zoom === 1 && s.rotate === 0,
      x: s.x - this.width / 2, y: s.y - this.height / 2, scale: 1 / s.zoom, angle_rad: s.rotate * Math.PI / 180});
    out.push({tick: 0, camera: native(state), ease: this.defaultEase});
    for (const e of entries) {
      const spec = e.entry.camera;
      if (!isRecord(spec)) continue;
      const path = `${e.path}/camera`;
      this.unknownKeys(spec, CAMERA_KEYS, path, 'camera');
      const next = {...state};
      for (const name of ['x', 'y', 'rotate']) if (spec[name] !== undefined) {
        const value = spec[name], match = typeof value === 'string' && /^([+-])\s*(\d+(?:\.\d+)?)$/.exec(value.trim());
        if (finite(value)) next[name] = value;
        else if (match) next[name] = state[name] + (match[1] === '-' ? -1 : 1) * Number(match[2]);
        else this.error(`${path}/${name}`, `camera ${name} is a number or "+n"/"-n".`);
      }
      if (spec.zoom !== undefined) next.zoom = this.number(spec.zoom, `${path}/zoom`, {min: 0.05, max: 40, name: 'zoom'}) ?? state.zoom;
      const ease = spec.ease !== undefined || spec.bezier !== undefined ? this.ease(spec.ease ?? 'ease-in-out', spec.bezier, `${path}/ease`)
        : e.entry.ease !== undefined ? this.ease(e.entry.ease, undefined, `${e.path}/ease`) : this.defaultEase;
      state = next;
      const camera = native(state);
      if (e.tick === 0) out[0] = {tick: 0, camera, ease};
      else out.push({tick: e.tick, camera, ease});
    }
    return out;
  }
}

function round(value) { return Math.round(value * 1000) / 1000; }
