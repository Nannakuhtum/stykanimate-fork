/** JSON with comments and trailing commas, plus the source line of every value.
 *
 * Scripts are written by agents and read by people, so `//` and block comments
 * are allowed and every diagnostic can point at a line. `parseJsonc(text)`
 * returns `{value, lines}`, where `lines` maps a JSON Pointer-like path
 * ("/timeline/3/hero/pose") to the 1-based line its value starts on.
 */
export class ScriptSyntaxError extends Error {
  constructor(message, line, column) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'ScriptSyntaxError';
    this.line = line;
    this.column = column;
  }
}

export function parseJsonc(text) {
  if (typeof text !== 'string') throw new TypeError('Script text must be a string.');
  let i = 0, line = 1, lineStart = 0;
  const lines = new Map();
  const fail = message => { throw new ScriptSyntaxError(message, line, i - lineStart + 1); };
  const skip = () => {
    for (;;) {
      const c = text[i];
      if (c === '\n') { i++; line++; lineStart = i; }
      else if (c === ' ' || c === '\t' || c === '\r' || c === '﻿') i++;
      else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; }
      else if (c === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        if (end < 0) fail('Unterminated comment');
        for (let j = i; j < end; j++) if (text[j] === '\n') { line++; lineStart = j + 1; }
        i = end + 2;
      } else return;
    }
  };
  const string = () => {
    i++;
    let out = '';
    for (;;) {
      if (i >= text.length) fail('Unterminated string');
      const c = text[i++];
      if (c === '"') return out;
      if (c === '\n') fail('Line break inside a string');
      if (c !== '\\') { out += c; continue; }
      const e = text[i++];
      const simple = {'"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t'}[e];
      if (simple !== undefined) out += simple;
      else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i, i + 4))) { out += String.fromCharCode(parseInt(text.slice(i, i + 4), 16)); i += 4; }
      else fail('Invalid escape in string');
    }
  };
  const value = path => {
    skip();
    lines.set(path, line);
    const c = text[i];
    if (c === '{') {
      i++;
      const out = {};
      for (;;) {
        skip();
        if (text[i] === '}') { i++; return out; }
        if (text[i] !== '"') fail('Expected a quoted property name');
        const key = string();
        if (Object.hasOwn(out, key)) fail(`Duplicate property "${key}"`);
        skip();
        if (text[i] !== ':') fail(`Expected ":" after "${key}"`);
        i++;
        out[key] = value(`${path}/${escapeKey(key)}`);
        skip();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return out; }
        fail('Expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const out = [];
      for (;;) {
        skip();
        if (text[i] === ']') { i++; return out; }
        out.push(value(`${path}/${out.length}`));
        skip();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return out; }
        fail('Expected "," or "]"');
      }
    }
    if (c === '"') return string();
    const literal = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!literal) fail(i >= text.length ? 'Unexpected end of script' : `Unexpected character "${c}"`);
    i += literal[0].length;
    return literal[0] === 'true' ? true : literal[0] === 'false' ? false : literal[0] === 'null' ? null : Number(literal[0]);
  };
  const result = value('');
  skip();
  if (i < text.length) fail('Unexpected text after the script');
  return {value: result, lines};
}

export const escapeKey = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

/** The line of `path`, or of its nearest ancestor that has one. */
export function lineOf(lines, path) {
  for (let p = path; ; p = p.slice(0, p.lastIndexOf('/'))) {
    if (lines?.has(p)) return lines.get(p);
    if (!p) return 1;
  }
}
