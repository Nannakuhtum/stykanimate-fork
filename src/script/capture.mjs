/** Turns what is on the canvas back into script terms.
 *
 * A person who wants a different pose can drag the figure in the app and
 * attach the result to a note. This writes that pose in the same vocabulary
 * the agent uses (joint directions in degrees, hip position), as a timeline
 * entry the agent can paste in or adapt.
 */
import {scriptPose} from './stick-rig.mjs';

const round = (value, places = 1) => Math.round(value * 10 ** places) / 10 ** places;

/** The script entity that owns `uid`, or null. */
export function entityForUid(index, uid) {
  for (const [id, entity] of Object.entries(index?.figures ?? {})) if (entity.uid === uid) return {id, ...entity};
  return null;
}

/** The script entry (if any) whose key the figure holds at `tick`, and its facing there. */
export function keyAt(entity, tick) {
  let found = entity.keys[0];
  for (const key of entity.keys) if (key.tick <= tick) found = key;
  return found;
}

/**
 * A suggested timeline entry for the object as it is now: `{at, <id>: {pose, x, y, facing?}}`.
 * `object` is the evaluated pose record (root_x, root_y, angles, scale); `figureType` its definition.
 */
export function captureSuggestion(index, object, {tick, figureType} = {}) {
  const entity = entityForUid(index, object.unique_id);
  if (!entity) return null;
  const frame = tick + 1, key = keyAt(entity, tick);
  if (entity.kind === 'prop') {
    const segment = figureType?.segments?.[0];
    const circle = segment?.segment_type === 'circle';
    const r = circle ? segment.length / 2 * (object.scale ?? 1) : 0;
    return {at: frame, [entity.id]: {x: round(object.root_x), y: round(object.root_y - r)}};
  }
  const facing = key?.facing ?? 'right';
  const state = {pose: scriptPose(object.angles, {facing}), x: round(object.root_x), y: round(object.root_y)};
  if (facing === 'left') state.facing = 'left';
  if ((object.scale ?? 1) !== 1) state.scale = round(object.scale, 3);
  return {at: frame, [entity.id]: state};
}
