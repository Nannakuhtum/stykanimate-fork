/** Review notes: how a person viewing a script in the app talks back to the agent.
 *
 * Notes live in a sidecar file next to the script ("duel.stykscript.json" →
 * "duel.stykscript.review.json") so the agent can read them with any tool and
 * the app can watch for replies. Every change is a small operation applied to
 * the latest file contents (read, apply, write), so a person adding a note and
 * an agent replying at the same time do not overwrite each other's work.
 */
export const REVIEW_VERSION = 1;
export const MAX_REVIEW_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 4000;
const STATUSES = new Set(['open', 'resolved']);

export function reviewPathFor(scriptPath) {
  const base = scriptPath.replace(/\.json$/i, '').replace(/\.stykscript$/i, '.stykscript');
  return `${base}.review.json`;
}

export function emptyReview(scriptName = '') {
  return {stykreview: REVIEW_VERSION, script: scriptName, notes: []};
}

const text = (value, limit = MAX_TEXT) => typeof value === 'string' ? value.slice(0, limit) : '';
const whole = value => Number.isInteger(value) && value >= 0 && value <= 10000000 ? value : null;

/** Accepts anything and returns a valid review (unknown fields on notes are kept). */
export function normalizeReview(input, scriptName = '') {
  const review = emptyReview(typeof input?.script === 'string' ? input.script : scriptName);
  if (!input || typeof input !== 'object' || !Array.isArray(input.notes)) return review;
  const ids = new Set();
  for (const raw of input.notes.slice(0, 5000)) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^n\d{1,9}$/.test(raw.id) || ids.has(raw.id)) continue;
    ids.add(raw.id);
    review.notes.push({
      ...raw,
      status: STATUSES.has(raw.status) ? raw.status : 'open',
      text: text(raw.text),
      frame: whole(raw.frame),
      replies: Array.isArray(raw.replies) ? raw.replies.filter(r => r && typeof r.text === 'string').slice(0, 200)
        .map(r => ({from: r.from === 'person' ? 'person' : 'agent', text: text(r.text), at: text(r.at, 40)})) : [],
    });
  }
  return review;
}

export function parseReview(textContent, scriptName = '') {
  if (!textContent || !textContent.trim()) return emptyReview(scriptName);
  return normalizeReview(JSON.parse(textContent), scriptName);
}

export function serializeReview(review) {
  const out = `${JSON.stringify(review, null, 2)}\n`;
  if (out.length > MAX_REVIEW_BYTES) throw new RangeError('The review file is too large.');
  return out;
}

const nextId = review => `n${review.notes.reduce((largest, note) => Math.max(largest, Number(note.id.slice(1))), 0) + 1}`;

/**
 * Applies one operation and returns {review, note}.
 *   {op: 'add', text, frame, entry, figure, line, suggestion}
 *   {op: 'reply', id, text, from, resolve}
 *   {op: 'status', id, status}
 *   {op: 'delete', id}
 */
export function applyReviewOperation(input, operation, {now = new Date().toISOString()} = {}) {
  const review = normalizeReview(structuredClone(input));
  const find = () => {
    const note = review.notes.find(n => n.id === operation.id);
    if (!note) throw new Error(`There is no note "${operation.id}".`);
    return note;
  };
  switch (operation?.op) {
    case 'add': {
      if (!text(operation.text).trim() && !operation.suggestion) throw new Error('A note needs text or a suggested pose.');
      const note = {id: nextId(review), status: 'open', created: now, from: 'person', text: text(operation.text).trim(),
        frame: whole(operation.frame), entry: typeof operation.entry === 'string' ? operation.entry.slice(0, 40) : null,
        figure: typeof operation.figure === 'string' ? operation.figure.slice(0, 40) : null,
        line: whole(operation.line), replies: []};
      if (operation.suggestion && typeof operation.suggestion === 'object') note.suggestion = structuredClone(operation.suggestion);
      review.notes.push(note);
      return {review, note};
    }
    case 'reply': {
      const note = find();
      if (!text(operation.text).trim()) throw new Error('A reply needs text.');
      note.replies.push({from: operation.from === 'person' ? 'person' : 'agent', text: text(operation.text).trim(), at: now});
      if (operation.resolve === true) note.status = 'resolved';
      if (operation.resolve === false) note.status = 'open';
      return {review, note};
    }
    case 'status': {
      const note = find();
      if (!STATUSES.has(operation.status)) throw new Error('Status is "open" or "resolved".');
      note.status = operation.status;
      return {review, note};
    }
    case 'delete': {
      const note = find();
      review.notes = review.notes.filter(n => n !== note);
      return {review, note};
    }
    default: throw new Error('Unknown review operation.');
  }
}

/** A plain-text summary of notes for agents and terminals. */
export function formatNotes(review, {all = false} = {}) {
  const notes = review.notes.filter(note => all || note.status === 'open');
  if (!notes.length) return all ? 'No notes yet.' : 'No open notes.';
  return notes.map(note => {
    const where = [note.frame !== null ? `frame ${note.frame}` : null, note.entry ? `entry "${note.entry}"` : null,
      note.figure ? `figure "${note.figure}"` : null, note.line ? `script line ${note.line}` : null].filter(Boolean).join(', ');
    const lines = [`${note.id} [${note.status}]${where ? ` (${where})` : ''}: ${note.text || '(no text)'}`];
    if (note.suggestion) lines.push(`  suggested change: ${JSON.stringify(note.suggestion)}`);
    for (const reply of note.replies) lines.push(`  ${reply.from}: ${reply.text}`);
    return lines.join('\n');
  }).join('\n');
}
