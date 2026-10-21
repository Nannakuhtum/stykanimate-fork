/** The Script panel: shows a script an agent wrote, plays it as a project, and
 * carries the person's notes back to the agent.
 *
 *   header     the script's name, Live while the file is watched, Open script…
 *   banner     the script changed but could not reload in place (edited, or
 *              another project in front), or the file went missing
 *   problems   compile errors and warnings with their lines; with errors the
 *              last version that worked stays on the canvas
 *   Keys       every timeline entry: frame, id, who it moves and its note;
 *              the one under the playhead is marked, a click goes there
 *   Script     the source with line numbers; the playhead's lines are marked
 *   Notes      a note at the playhead (frame, key and selected figure filled
 *              in), optionally carrying the selected figure's pose from the
 *              canvas in script terms; the list shows the agent's replies
 *
 * The desktop backend watches the files (desktop/script-session.cjs). In the
 * browser a picked file is polled and notes stay in the window (Copy notes).
 */
import {compileScript} from './compile.mjs';
import {captureSuggestion, entityForUid} from './capture.mjs';
import {applyReviewOperation, emptyReview} from './review.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** Desktop: ids for files main.cjs opened. Browser: a picked file, polled, with notes in memory. */
function scriptBackend(desktop, win) {
  if (desktop?.openScript) return {
    live: true, notesInFile: true,
    pick: () => desktop.openScript(),
    launch: () => desktop.takeLaunchScript?.() ?? null,
    review: (id, operation) => desktop.reviewScript(id, operation),
    close: id => desktop.closeScript(id),
    subscribe: callback => desktop.onScriptChanged(callback),
  };
  const listeners = new Set(), reviews = new Map();
  let polling = null;
  return {
    live: Boolean(win.showOpenFilePicker), notesInFile: false,
    async pick() {
      let handle, file;
      if (win.showOpenFilePicker) {
        try { [handle] = await win.showOpenFilePicker({types: [{description: 'StykScript', accept: {'application/json': ['.json', '.stykscript']}}]}); }
        catch (error) { if (error?.name === 'AbortError') return null; throw error; }
        file = await handle.getFile();
      } else {
        file = await new Promise(resolve => {
          const input = Object.assign(win.document.createElement('input'), {type: 'file', accept: '.json,.stykscript'});
          input.addEventListener('change', () => resolve(input.files?.[0] ?? null), {once: true});
          input.click();
        });
        if (!file) return null;
      }
      const id = `browser-${Date.now()}`, text = await file.text();
      reviews.set(id, emptyReview(file.name));
      if (handle) {
        clearInterval(polling);
        let last = file.lastModified;
        polling = setInterval(async () => {
          try {
            const next = await handle.getFile();
            if (next.lastModified === last) return;
            last = next.lastModified;
            const changed = await next.text();
            for (const listener of listeners) listener({id, text: changed});
          } catch { /* permission withdrawn or file gone: stop quietly */ }
        }, 1000);
      }
      return {id, name: file.name, text, review: reviews.get(id), reviewName: null};
    },
    launch: () => null,
    async review(id, operation) {
      const result = applyReviewOperation(reviews.get(id) ?? emptyReview(), operation);
      reviews.set(id, result.review);
      return result;
    },
    close: id => { reviews.delete(id); clearInterval(polling); },
    subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  };
}

export function createScriptPanel({root, editor, desktop, t, toast = () => {}, fail = error => { throw error; }, openDocument, seek, select,
  window: win = globalThis.window, onActivity = () => {}}) {
  const backend = scriptBackend(desktop, win);
  const state = {session: null, text: '', compiled: null, good: null, review: emptyReview(), pending: false, missing: false,
    report: null, tab: 'keys', showResolved: false, attachPose: true};
  root.classList.add('script-panel');
  root.innerHTML = `
    <div class="script-head">
      <div class="script-title"><span class="script-name"></span><span class="script-live" hidden></span></div>
      <p class="script-summary"></p>
      <button type="button" class="ui-button" data-size="sm" data-variant="outline" data-action="open"></button>
    </div>
    <div class="script-banner" role="status" hidden><span class="script-banner-text"></span><button type="button" class="ui-button" data-size="sm" data-variant="primary" data-action="reload"></button></div>
    <ul class="script-problems" hidden></ul>
    <div class="ui-segmented script-tabs" data-size="sm" data-fill role="tablist">
      <button type="button" class="ui-segmented-item" role="tab" data-tab="keys"></button>
      <button type="button" class="ui-segmented-item" role="tab" data-tab="source"></button>
      <button type="button" class="ui-segmented-item" role="tab" data-tab="notes"></button>
    </div>
    <div class="script-body">
      <ol class="script-keys" data-pane="keys"></ol>
      <pre class="script-source" data-pane="source" hidden></pre>
      <div class="script-notes" data-pane="notes" hidden>
        <form class="script-composer">
          <p class="script-composer-where"></p>
          <textarea class="ui-field script-note-text" rows="3"></textarea>
          <label class="script-attach"><input type="checkbox" class="script-attach-pose" checked><span></span></label>
          <div class="script-composer-actions"><button type="submit" class="ui-button" data-size="sm" data-variant="primary"></button></div>
        </form>
        <label class="script-show-resolved"><input type="checkbox"><span></span></label>
        <button type="button" class="ui-button script-copy-notes" data-size="sm" data-variant="ghost" data-action="copy-notes" hidden></button>
        <ol class="script-note-list"></ol>
      </div>
    </div>
    <div class="ui-empty script-empty">
      <h3 class="ui-empty-title"></h3>
      <p class="ui-empty-text"></p>
      <div class="ui-empty-actions"><button type="button" class="ui-button" data-variant="primary" data-action="open"></button></div>
    </div>`;
  const $ = selector => root.querySelector(selector);
  const parts = {name: $('.script-name'), live: $('.script-live'), summary: $('.script-summary'), banner: $('.script-banner'), bannerText: $('.script-banner-text'),
    reload: $('[data-action="reload"]'), problems: $('.script-problems'), keys: $('.script-keys'), source: $('.script-source'), notes: $('.script-note-list'),
    where: $('.script-composer-where'), text: $('.script-note-text'), attach: $('.script-attach-pose'), attachLabel: $('.script-attach > span'),
    composer: $('.script-composer'), showResolved: $('.script-show-resolved > input'), copyNotes: $('.script-copy-notes'), empty: $('.script-empty')};

  // ---- Static words (re-applied when the language changes) ----
  function words() {
    for (const button of root.querySelectorAll('[data-action="open"]')) button.textContent = t('script.open');
    parts.live.textContent = t('script.live');
    $('.script-empty .ui-empty-title').textContent = t('script.title');
    $('.script-empty .ui-empty-text').textContent = t('script.empty');
    $('[data-tab="keys"]').textContent = t('script.tabKeys');
    $('[data-tab="source"]').textContent = t('script.tabSource');
    parts.text.placeholder = t('script.notePlaceholder');
    $('.script-composer button[type="submit"]').textContent = t('script.addNote');
    $('.script-show-resolved > span').textContent = t('script.showResolved');
    parts.copyNotes.textContent = t('script.copyNotes');
  }

  // ---- What the playhead and selection point at ----
  function context() {
    const index = state.good?.index;
    if (!index || editor.report !== state.report) return null;
    const tick = editor.tick, entries = index.entries;
    let entry = null;
    for (const candidate of entries) if (candidate.tick <= tick) entry = candidate;
    const exact = entry?.tick === tick ? entry : null;
    const figure = editor.selectedUid != null ? entityForUid(index, editor.selectedUid) : null;
    const key = figure ? [...figure.keys].reverse().find(k => k.tick <= tick) : null;
    return {tick, frame: tick + 1, entry, exact, figure, line: key?.tick === tick ? key.line : exact?.line ?? null};
  }

  // ---- Rendering ----
  function render() {
    const has = Boolean(state.session);
    parts.empty.hidden = has;
    for (const element of root.querySelectorAll(':scope > :not(.script-empty)')) element.hidden = !has;
    if (!has) return;
    parts.name.textContent = state.session.name;
    parts.name.title = state.session.folder ? `${state.session.folder}/${state.session.name}` : state.session.name;
    parts.live.hidden = !backend.live || state.missing;
    const index = state.good?.index;
    parts.summary.textContent = state.compiled && !state.compiled.ok
      ? (state.good ? t('script.problems') : t('script.problemsNoVersion'))
      : index ? t('script.summary', {frames: index.length, fps: index.fps, entities: Object.values(index.figures).map(f => f.name).join(', ')}) : '';
    parts.summary.dataset.tone = state.compiled && !state.compiled.ok ? 'danger' : '';
    renderBanner();
    renderProblems();
    renderTabs();
    renderKeys();
    renderSource();
    renderNotes();
    track();
  }

  function renderBanner() {
    const elsewhere = state.report && editor.report !== state.report;
    parts.banner.hidden = !state.pending && !state.missing;
    parts.reload.hidden = state.missing;
    parts.bannerText.textContent = state.missing ? t('script.missing')
      : elsewhere ? t('script.pendingElsewhere') : editor.dirty ? t('script.pendingEdited') : t('script.pending');
    parts.reload.textContent = elsewhere ? t('script.openAgain') : t('script.reload');
  }

  function renderProblems() {
    const list = state.compiled?.diagnostics ?? [];
    parts.problems.hidden = !list.length;
    parts.problems.innerHTML = list.slice(0, 50).map(d => `<li data-level="${d.level}"><button type="button" data-line="${d.line}">` +
      `<span class="script-problem-line">${escape(t('script.line', {line: d.line}))}</span> ${escape(d.message)}</button></li>`).join('');
  }

  function renderTabs() {
    const open = state.review.notes.filter(note => note.status === 'open').length;
    $('[data-tab="notes"]').textContent = open ? t('script.tabNotesCount', {count: open}) : t('script.tabNotes');
    for (const button of root.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === state.tab));
    for (const pane of root.querySelectorAll('[data-pane]')) pane.hidden = pane.dataset.pane !== state.tab;
  }

  function renderKeys() {
    const index = state.good?.index;
    if (!index) { parts.keys.innerHTML = ''; return; }
    const name = id => index.figures[id]?.name ?? id;
    parts.keys.innerHTML = index.entries.map(entry => `<li><button type="button" data-tick="${entry.tick}" data-line="${entry.line}">` +
      `<span class="script-key-frame">${escape(entry.frame)}</span><span class="script-key-id">${escape(entry.id)}</span>` +
      `<span class="script-key-who">${escape([...entry.targets.map(name), ...(entry.camera ? ['camera'] : [])].join(' · '))}</span>` +
      (entry.note ? `<span class="script-key-note">${escape(entry.note)}</span>` : '') + `</button></li>`).join('');
  }

  let renderedText = null;
  function renderSource() {
    if (renderedText === state.text) return;
    tracked = null;
    renderedText = state.text;
    const errors = new Map((state.compiled?.diagnostics ?? []).map(d => [d.line, d.level]));
    parts.source.innerHTML = state.text.split('\n').map((line, i) => `<span class="script-line" data-line="${i + 1}"${errors.has(i + 1) ? ` data-level="${errors.get(i + 1)}"` : ''}>` +
      `<span class="script-gutter">${i + 1}</span>${escape(line) || ' '}</span>`).join('');
  }

  function renderNotes() {
    parts.copyNotes.hidden = backend.notesInFile || !state.review.notes.length;
    parts.showResolved.checked = state.showResolved;
    const notes = state.review.notes.filter(note => state.showResolved || note.status === 'open').slice().reverse();
    if (!notes.length) { parts.notes.innerHTML = `<li class="script-note-empty">${escape(backend.notesInFile ? t('script.noNotes') : `${t('script.noNotes')} ${t('script.browserNotes')}`)}</li>`; return; }
    parts.notes.innerHTML = notes.map(note => {
      const where = [note.frame !== null ? t('script.frame', {frame: note.frame}) : '', note.entry ? `“${note.entry}”` : '', note.figure ?? ''].filter(Boolean).join(' · ');
      return `<li class="script-note" data-id="${escape(note.id)}" data-status="${note.status}">
        <div class="script-note-head"><span class="script-note-where">${escape(where)}</span>
          <span class="script-note-status">${escape(note.status === 'open' ? t('script.statusOpen') : t('script.statusResolved'))}</span></div>
        ${note.text ? `<p class="script-note-text">${escape(note.text)}</p>` : ''}
        ${note.suggestion ? `<details class="script-suggestion"><summary>${escape(t('script.suggestedPose'))}</summary><pre>${escape(JSON.stringify(note.suggestion, null, 1))}</pre></details>` : ''}
        ${note.replies.map(reply => `<p class="script-reply" data-from="${reply.from}"><b>${escape(reply.from === 'agent' ? t('script.fromAgent') : t('script.fromPerson'))}</b> ${escape(reply.text)}</p>`).join('')}
        <div class="script-note-actions">
          ${note.frame !== null ? `<button type="button" class="ui-button" data-size="sm" data-variant="ghost" data-note-action="go">${escape(t('script.goTo'))}</button>` : ''}
          <button type="button" class="ui-button" data-size="sm" data-variant="ghost" data-note-action="${note.status === 'open' ? 'resolve' : 'reopen'}">${escape(note.status === 'open' ? t('script.resolve') : t('script.reopen'))}</button>
          <button type="button" class="ui-button" data-size="sm" data-variant="ghost" data-tone="danger" data-note-action="delete">${escape(t('script.delete'))}</button>
        </div></li>`;
    }).join('');
  }

  /** Marks the key and source lines under the playhead and fills the composer's context. Cheap; runs on seek. */
  let tracked = null;
  function track() {
    const here = context(), tick = here?.entry?.tick ?? null;
    if (tracked !== `${tick}|${here?.line}`) {
      tracked = `${tick}|${here?.line}`;
      for (const button of parts.keys.querySelectorAll('[data-tick]')) button.toggleAttribute('data-current', Number(button.dataset.tick) === tick);
      const lines = new Set([here?.entry?.line, here?.line].filter(Boolean));
      for (const line of parts.source.querySelectorAll('[data-current]')) line.removeAttribute('data-current');
      for (const line of lines) parts.source.querySelector(`[data-line="${line}"]`)?.setAttribute('data-current', '');
      parts.keys.querySelector('[data-current]')?.scrollIntoView?.({block: 'nearest'});
    }
    parts.where.textContent = !here ? '' : here.exact ? t('script.noteAtEntry', {frame: here.frame, entry: here.exact.id}) : t('script.noteAt', {frame: here.frame});
    const figure = here?.figure;
    parts.attach.disabled = !figure;
    parts.attachLabel.textContent = figure ? t('script.attachPose', {figure: figure.name}) : t('script.attachPoseNone');
    parts.composer.querySelector('button[type="submit"]').disabled = !here;
  }

  // ---- Script life cycle ----
  async function adopt(session) {
    if (!session) return false;
    if (state.session && state.session.id !== session.id) void backend.close(state.session.id);
    Object.assign(state, {session, text: '', compiled: null, good: null, review: session.review ?? emptyReview(), pending: false, missing: false, report: null});
    renderedText = null;
    await update(session.text, {initial: true});
    return true;
  }

  async function update(text, {initial = false} = {}) {
    state.text = text;
    const compiled = compileScript(text);
    state.compiled = compiled;
    if (compiled.ok) {
      state.good = compiled;
      if (initial || !state.report) await show(compiled, {fresh: true});
      else if (editor.report === state.report && !editor.dirty) await show(compiled, {fresh: false});
      else state.pending = true;
    }
    render();
    onActivity();
  }

  async function show(compiled, {fresh}) {
    const name = state.session.name.replace(/\.json$/i, '').replace(/\.stykscript$/i, '');
    const report = structuredClone(compiled.report);
    if (fresh) {
      if (!await openDocument(report, name)) return false;
    } else {
      editor.load(report, editor.name, {initialTick: Math.min(editor.tick, compiled.index.length - 1)});
      toast(t('script.reloaded'));
    }
    state.report = editor.report;
    state.pending = false;
    return true;
  }

  async function open() {
    try { return await adopt(await backend.pick()); }
    catch (error) { toast(t('script.couldNotOpen', {message: error?.message ?? String(error)})); return false; }
  }

  async function review(operation) {
    const {review: next} = await backend.review(state.session.id, operation);
    state.review = next;
    renderTabs();
    renderNotes();
    return next;
  }

  // ---- Events ----
  root.addEventListener('click', event => {
    const target = event.target.closest('button, [data-line]');
    if (!target || !root.contains(target)) return;
    const action = target.dataset.action, noteAction = target.dataset.noteAction;
    if (action === 'open') return void open();
    if (action === 'reload') {
      if (!state.good) return;
      const fresh = editor.report !== state.report;
      return void show(state.good, {fresh}).then(render).catch(fail);
    }
    if (action === 'copy-notes') return void win.navigator.clipboard?.writeText(JSON.stringify(state.review, null, 2)).then(() => toast(t('script.copied')), fail);
    if (target.dataset.tab) { state.tab = target.dataset.tab; renderTabs(); renderSource(); tracked = null; track(); return; }
    if (target.dataset.tick !== undefined) return void seek(Number(target.dataset.tick));
    if (noteAction) {
      const id = target.closest('[data-id]')?.dataset.id, note = state.review.notes.find(n => n.id === id);
      if (!note) return;
      if (noteAction === 'go') {
        seek(Math.max(0, note.frame - 1));
        const uid = note.figure ? state.good?.index.figures[note.figure]?.uid : null;
        if (uid != null) select(uid);
        return;
      }
      const operation = noteAction === 'delete' ? {op: 'delete', id} : {op: 'status', id, status: noteAction === 'resolve' ? 'resolved' : 'open'};
      return void review(operation).catch(fail);
    }
    if (target.dataset.line !== undefined) {
      const line = Number(target.dataset.line), entry = [...(state.good?.index.entries ?? [])].reverse().find(e => e.line <= line);
      if (target.closest('.script-problems')) { state.tab = 'source'; renderTabs(); renderSource(); }
      if (entry && target.closest('.script-source')) seek(entry.tick);
      parts.source.querySelector(`[data-line="${line}"]`)?.scrollIntoView?.({block: 'center'});
    }
  });
  parts.showResolved.addEventListener('change', () => { state.showResolved = parts.showResolved.checked; renderNotes(); });
  parts.attach.addEventListener('change', () => { state.attachPose = parts.attach.checked; });
  parts.composer.addEventListener('submit', event => {
    event.preventDefault();
    const here = context();
    if (!here || !state.session) return;
    let suggestion = null;
    if (state.attachPose && here.figure) {
      const object = editor.evaluatedFrame.objects.find(o => o.unique_id === here.figure.uid);
      const figureType = editor.report.figure_types.find(type => type.figure_type_id === object?.figure_type_id);
      if (object) suggestion = captureSuggestion(state.good.index, object, {tick: here.tick, figureType});
    }
    const text = parts.text.value.trim();
    if (!text && !suggestion) { parts.text.focus(); return; }
    void review({op: 'add', text, frame: here.frame, entry: here.exact?.id ?? here.entry?.id ?? null, figure: here.figure?.id ?? null, line: here.line ?? here.entry?.line ?? null,
      ...(suggestion ? {suggestion} : {})}).then(() => { parts.text.value = ''; toast(t('script.noteAdded')); }).catch(fail);
  });
  parts.text.addEventListener('keydown', event => {
    event.stopPropagation();   // typing a note never triggers editor shortcuts
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) parts.composer.requestSubmit();
  });

  const unsubscribe = backend.subscribe(change => {
    if (!state.session || change.id !== state.session.id) return;
    if (change.missing !== undefined) { state.missing = change.missing; renderBanner(); render(); }
    if (change.review) { state.review = change.review; renderTabs(); renderNotes(); onActivity(); }
    if (change.text !== undefined) void update(change.text).catch(fail);
  });
  let frame = 0;
  const onEditor = event => {
    if (!state.session) return;
    const kind = event.detail?.kind;
    if (kind === 'document' || kind === 'saved' || kind === 'edit' || kind === 'history') renderBanner();
    if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; track(); });
  };
  editor.addEventListener('change', onEditor);

  words();
  render();
  return {
    state,
    open,
    adopt,
    /** Opens the script the app was launched with, if any (desktop only). */
    async launch() { const session = await backend.launch(); return session ? adopt(session) : false; },
    words: () => { words(); render(); },
    dispose() { unsubscribe?.(); editor.removeEventListener('change', onEditor); if (state.session) void backend.close(state.session.id); },
  };
}
