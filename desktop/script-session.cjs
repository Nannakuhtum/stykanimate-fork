'use strict';
/**
 * Scripts the person opens (or that an agent opens the app with) and their
 * review notes. The renderer never names paths: it receives an opaque id for a
 * file the person picked or the launch named, and can only read that script,
 * read its sidecar review file and apply review operations to it.
 *
 * Both files are watched (fs.watch for low latency plus a slow stat poll for
 * file systems that do not report changes), and every change is pushed to the
 * window as `styk:script-changed`. Review writes are read-apply-write with an
 * atomic rename, so an agent replying from a terminal and the person adding a
 * note do not overwrite each other.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const MAX_SCRIPT_BYTES = 8 * 1024 * 1024;
const POLL_MS = 900;
const SCRIPT_FILE = /\.stykscript(\.json)?$/i;

class ScriptSessions {
  constructor({ appRoot, send }) {
    this.appRoot = appRoot;
    this.send = send;
    this.sessions = new Map();
    this.reviewModule = null;
  }

  static isScriptFile(file) { return SCRIPT_FILE.test(String(file)); }

  async review() {
    this.reviewModule ??= import(pathToFileURL(path.join(this.appRoot, 'src', 'script', 'review.mjs')).href);
    return this.reviewModule;
  }

  async open(filePath) {
    const absolute = path.resolve(String(filePath));
    for (const session of this.sessions.values()) if (session.path === absolute) return this.describe(session);
    const { reviewPathFor } = await this.review();
    const session = { id: crypto.randomUUID(), path: absolute, reviewPath: reviewPathFor(absolute), text: null, reviewText: null };
    session.text = await this.readText(session.path, true);
    session.reviewText = await this.readText(session.reviewPath, false);
    this.sessions.set(session.id, session);
    this.watch(session);
    return this.describe(session);
  }

  async describe(session) {
    return { id: session.id, name: path.basename(session.path), folder: path.dirname(session.path),
      reviewName: path.basename(session.reviewPath), text: session.text, review: await this.parsedReview(session) };
  }

  async parsedReview(session) {
    const { parseReview } = await this.review();
    try { return parseReview(session.reviewText ?? '', path.basename(session.path)); }
    catch { return { ...parseReview('', path.basename(session.path)), unreadable: true }; }
  }

  async readText(file, required) {
    try {
      const stat = await fsp.stat(file);
      if (stat.size > MAX_SCRIPT_BYTES) throw new Error(`${path.basename(file)} is larger than 8 MB.`);
      return await fsp.readFile(file, 'utf8');
    } catch (error) {
      if (!required && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('That script is no longer open.');
    return session;
  }

  async read(id) { return this.describe(this.get(id)); }

  watch(session) {
    let pending = null;
    const check = () => { pending = null; void this.refresh(session).catch(() => {}); };
    const soon = () => { if (!pending) pending = setTimeout(check, 80); };
    const names = new Set([path.basename(session.path), path.basename(session.reviewPath)]);
    try {
      // Editors and agents often replace files by rename, so watch the folder, not the file.
      session.watcher = fs.watch(path.dirname(session.path), { persistent: false }, (_type, name) => { if (!name || names.has(String(name))) soon(); });
      session.watcher.on('error', () => {});
    } catch { session.watcher = null; }
    session.poll = setInterval(soon, POLL_MS);
    session.poll.unref?.();
  }

  async refresh(session) {
    if (!this.sessions.has(session.id)) return;
    let text = session.text, reviewText = session.reviewText, missing = false;
    try { text = await this.readText(session.path, true); } catch { missing = true; }
    try { reviewText = await this.readText(session.reviewPath, false); } catch { /* keep the last review */ }
    const scriptChanged = !missing && text !== session.text, reviewChanged = reviewText !== session.reviewText;
    if (missing !== Boolean(session.missing)) { session.missing = missing; this.send({ id: session.id, missing }); }
    if (!scriptChanged && !reviewChanged) return;
    session.text = text; session.reviewText = reviewText;
    this.send({ id: session.id, ...(scriptChanged ? { text } : {}), ...(reviewChanged ? { review: await this.parsedReview(session) } : {}) });
  }

  async applyReview(id, operation) {
    const session = this.get(id);
    const { parseReview, applyReviewOperation, serializeReview } = await this.review();
    const current = parseReview((await this.readText(session.reviewPath, false)) ?? '', path.basename(session.path));
    const { review, note } = applyReviewOperation(current, operation);
    const text = serializeReview(review);
    const temporary = `${session.reviewPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(temporary, text, 'utf8');
    await fsp.rename(temporary, session.reviewPath);
    session.reviewText = text;
    return { review, note };
  }

  close(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.watcher?.close();
    clearInterval(session.poll);
    this.sessions.delete(id);
    return true;
  }

  dispose() { for (const id of [...this.sessions.keys()]) this.close(id); }
}

module.exports = { ScriptSessions };
