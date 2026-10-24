'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./storage-harness.cjs');
const tests = [], sessions = [];
const outputDir = path.join(__dirname, 'output');
const print = (...args) => { if (require.main === module) console.log(...args); };
const byId = (ctx, id) => ctx.doc.getElementById(id);
const source = ctx => byId(ctx, 'source-toggle');
const numbers = ctx => byId(ctx, 'line-numbers-toggle');
const scroll = ctx => byId(ctx, 'reader-scroll');
const remove = (ctx, name) => [...ctx.doc.querySelectorAll('.file-item')].find(card => card.querySelector('.file-button').title === name).querySelector('.file-remove').click();

async function session(options = {}, factory = H.freshFactory()) {
  const ctx = H.createSession(factory, options); sessions.push(ctx);
  await H.until(() => byId(ctx, 'storage-status').dataset.state !== 'loading', 'initialization');
  return ctx;
}
async function check(name, fn) {
  const first = sessions.length;
  try {
    await fn();
    for (const ctx of sessions.slice(first)) {
      assert.deepEqual(ctx.errors, [], 'No unexpected JavaScript error');
      assert.deepEqual(ctx.requests, [], 'No network request');
    }
    tests.push({name, status: 'PASS'});
  } catch (error) { tests.push({name, status: 'FAIL', message: error.stack || String(error)}); }
  finally { for (const ctx of sessions.slice(first)) ctx.close(); }
}
async function download(ctx, all = false) {
  const count = ctx.downloads.length;
  byId(ctx, all ? 'export-collection' : 'export-toggle').click();
  await H.until(() => ctx.downloads.length > count, 'download');
  const item = ctx.downloads.at(-1), text = await item.blob.text();
  return {...item, text, document: new ctx.win.DOMParser().parseFromString(text, 'text/html')};
}
async function saved(ctx) {
  await H.until(() => byId(ctx, 'storage-status').dataset.state === 'saved', 'saved');
  return ctx.win.FolioStorage.read();
}

module.exports = (async () => {
  await check('Téléchargement direct : Markdown littéral en Source, HTML affiché en lecture, collection à côté du +', async () => {
    const ctx = await session();
    const markdown = '# Été\n\nUn texte $x^2$.\n';
    await H.imports(ctx, [H.file(ctx, 'note.markdown', markdown), H.file(ctx, 'autre.md', '# Autre')]);
    const collection = byId(ctx, 'export-collection');
    assert(collection.previousElementSibling.matches('[data-action="import"]'));
    assert.equal(collection.closest('#document-actions'), null);
    assert.equal(byId(ctx, 'export-menu'), null); assert.equal(byId(ctx, 'export-current'), null);
    numbers(ctx).click();
    const html = await download(ctx);
    assert.equal(html.filename, 'note.html'); assert.match(html.blob.type, /^text\/html/);
    assert(html.document.querySelector('article.numbered .folio-reference'));
    assert.equal(html.document.scripts.length, 0);
    source(ctx).click();
    assert.match(byId(ctx, 'export-toggle').getAttribute('aria-label'), /Markdown/);
    const raw = await download(ctx);
    assert.equal(raw.filename, 'note.markdown', 'Keep the original Markdown extension so source links remain coherent'); assert.match(raw.blob.type, /^text\/markdown/);
    assert.equal(raw.text, markdown, 'The source download must not contain a gutter or HTML markup');
    const all = await download(ctx, true);
    assert.equal(all.filename, 'Folio-collection.html');
    assert.equal(all.document.querySelectorAll('.export-doc').length, 2);
    assert.equal(all.document.querySelectorAll('.source-view').length, 0, 'The collection remains an autonomous HTML reader');
    assert.equal(byId(ctx, 'source-view').hidden, false, 'Downloading must not change the active viewing mode');
  });

  await check('Repères HTML : paragraphes, éléments de liste et blocs atomiques, sans compter les lignes visuelles', async () => {
    const copied = [];
    const ctx = await session({beforeParse(win) {
      Object.defineProperty(win, 'isSecureContext', {value: true});
      Object.defineProperty(win.navigator, 'clipboard', {value: {writeText: async text => copied.push(text)}});
    }});
    const markdown = '# Titre\n\nPremière ligne\nseconde ligne du même paragraphe.\n\nDeuxième paragraphe.\n\n- Premier\n- Second\n\n> Une citation.\n\n```js\na();\nb();\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |';
    await H.imports(ctx, [H.file(ctx, 'repères.md', markdown)]);
    const blocks = () => [...ctx.doc.querySelectorAll('#article [data-folio-ref]')];
    assert.deepEqual(blocks().map(node => node.localName), ['p', 'p', 'li', 'li', 'p', 'pre', 'table']);
    assert.deepEqual(blocks().map(node => node.dataset.folioRef), ['1', '2', '3', '4', '5', '6', '7']);
    numbers(ctx).click();
    assert.equal(ctx.doc.querySelectorAll('#article .folio-reference').length, 7);
    assert.equal(ctx.doc.querySelector('#article .folio-reference').tagName, 'BUTTON', 'Copying a live reference is a keyboard-accessible action');
    assert.equal(ctx.doc.querySelectorAll('#article h1 .folio-reference').length, 0);
    const identities = blocks().map(node => [node.id, node.dataset.folioRef, node.textContent]);
    ctx.win.dispatchEvent(new ctx.win.Event('resize'));
    assert.deepEqual(blocks().map(node => [node.id, node.dataset.folioRef, node.textContent]), identities);
    ctx.doc.querySelector('#article .folio-reference').click();
    await H.until(() => copied.length === 1, 'reference copied');
    assert.equal(copied[0], 'repères.md, repère 1');
    source(ctx).click();
    assert.equal(byId(ctx, 'source-view').querySelectorAll('.source-line').length, markdown.split('\n').length);
    assert.equal(byId(ctx, 'source-view').textContent, markdown);
  });

  await check('Exports : mêmes repères, ancres valides et conservation des identifiants HTML explicites', async () => {
    const ctx = await session();
    const markdown = '# Références\n\n<p id="nom" data-folio-ref="999">Un paragraphe nommé.</p>\n\n- Un élément\n\n  Un autre paragraphe dans le même élément.\n\n[Retour](#nom)';
    await H.imports(ctx, [H.file(ctx, 'a.md', markdown), H.file(ctx, 'b.md', markdown)]);
    numbers(ctx).click();
    const original = [...ctx.doc.querySelectorAll('#article [data-folio-ref]')].map(node => [node.dataset.folioRef, node.textContent]);
    assert(!original.some(([number]) => number === '999'));
    const single = await download(ctx);
    const outBlocks = [...single.document.querySelectorAll('article [data-folio-ref]')];
    assert.deepEqual(outBlocks.map(node => [node.dataset.folioRef, node.textContent]), original);
    assert(single.document.getElementById('folio-page-0-folio-anchor-nom'));
    for (const marker of single.document.querySelectorAll('.folio-reference')) assert(single.document.getElementById(marker.getAttribute('href').slice(1)));
    H.selectByTitle(ctx, 'b.md'); numbers(ctx).click();
    const all = await download(ctx, true);
    const ids = [...all.document.querySelectorAll('[id]')].map(node => node.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const marker of all.document.querySelectorAll('.folio-reference')) assert(all.document.getElementById(marker.getAttribute('href').slice(1)));
    assert.equal(all.document.querySelectorAll('article.numbered').length, 2);
  });

  await check('Reprise : onglet, modes, positions HTML et Source de chaque fichier sont mémorisés', async () => {
    const factory = H.freshFactory(), first = await session({}, factory);
    await H.imports(first, [H.file(first, 'a.md', '# Alpha\n\nTexte'), H.file(first, 'b.md', '# Bêta')]);
    scroll(first).scrollTop = 431; source(first).click(); scroll(first).scrollTop = 137;
    H.selectByTitle(first, 'b.md'); scroll(first).scrollTop = 287;
    first.doc.getElementById('remember-collection').click();
    const record = await saved(first), a = record.snapshot.docs.find(doc => doc.path === 'a.md');
    assert.equal(a.sourceMode, true); assert.equal(a.scroll, 431); assert.equal(a.sourceScroll, 137);
    assert.equal(record.snapshot.activePath, 'b.md');
    first.close();
    const restored = await session({}, factory);
    assert.equal(H.activeTab(restored).title, 'b.md'); assert.equal(scroll(restored).scrollTop, 287);
    H.selectByTitle(restored, 'a.md');
    assert.equal(byId(restored, 'source-view').hidden, false); assert.equal(scroll(restored).scrollTop, 137);
    source(restored).click(); assert.equal(scroll(restored).scrollTop, 431);
    scroll(restored).scrollTop = 555;
    scroll(restored).dispatchEvent(new restored.win.Event('scroll'));
    await H.until(() => byId(restored, 'storage-status').dataset.state === 'saving', 'scroll queued for storage');
    const updated = await saved(restored);
    assert.equal(updated.snapshot.docs.find(doc => doc.path === 'a.md').scroll, 555);
    assert.equal(updated.snapshot.docs.find(doc => doc.path === 'a.md').sourceMode, false);
  });

  await check('Reprise : anciennes copies et préférences facultatives invalides restent lisibles', async () => {
    const factory = H.freshFactory(), seed = await session({}, factory);
    await seed.win.FolioStorage.write({schema: 1, docs: [
      {path: 'ancien.md', content: '# Ancien'},
      {path: 'positions.md', content: '# Positions', scroll: -5, sourceScroll: 'invalide', sourceMode: 'true'}
    ], assets: [], activePath: 'ancien.md'}, 0);
    seed.close();
    const ctx = await session({}, factory);
    assert.equal(byId(ctx, 'storage-status').dataset.state, 'saved');
    assert.equal(scroll(ctx).scrollTop, 0);
    H.selectByTitle(ctx, 'positions.md');
    assert.equal(byId(ctx, 'source-view').hidden, true); assert.equal(scroll(ctx).scrollTop, 0);
    source(ctx).click(); assert.equal(scroll(ctx).scrollTop, 0);
  });

  await check('Annulation : le dernier retrait restaure ordre, contenu, mode, numérotation et position', async () => {
    const ctx = await session();
    await H.imports(ctx, [H.file(ctx, 'a.md', '# Alpha\n\nTexte'), H.file(ctx, 'b.md', '# Bêta'), H.file(ctx, 'c.md', '# Gamma')]);
    source(ctx).click(); numbers(ctx).click(); scroll(ctx).scrollTop = 137;
    remove(ctx, 'a.md');
    assert.equal(byId(ctx, 'undo-remove').hidden, false);
    assert.equal(H.activeTab(ctx).title, 'b.md');
    byId(ctx, 'undo-remove').click();
    assert.deepEqual([...ctx.doc.querySelectorAll('[role="tab"]')].map(tab => tab.title), ['a.md', 'b.md', 'c.md']);
    assert.equal(H.activeTab(ctx).title, 'a.md');
    assert.equal(byId(ctx, 'source-view').textContent, '# Alpha\n\nTexte');
    assert.equal(byId(ctx, 'source-view').hidden, false);
    assert.equal(numbers(ctx).getAttribute('aria-pressed'), 'true'); assert.equal(scroll(ctx).scrollTop, 137);
    remove(ctx, 'c.md'); remove(ctx, 'b.md'); byId(ctx, 'undo-remove').click();
    assert.deepEqual([...ctx.doc.querySelectorAll('[role="tab"]')].map(tab => tab.title), ['a.md', 'b.md'], 'Only the most recent removal is retained');
  });

  await check('Annulation : dernier onglet et mémorisation, sans conserver une corbeille dans IndexedDB', async () => {
    const ctx = await session();
    await H.imports(ctx, [H.file(ctx, 'unique.md', '# Unique')]);
    byId(ctx, 'remember-collection').click(); await saved(ctx);
    remove(ctx, 'unique.md');
    const empty = await saved(ctx);
    assert.equal(empty.snapshot.docs.length, 0);
    assert(!JSON.stringify(empty.snapshot).includes('# Unique'));
    assert.equal(byId(ctx, 'export-collection').disabled, true);
    assert.equal(byId(ctx, 'welcome').hidden, false);
    byId(ctx, 'undo-remove').click();
    const restored = await saved(ctx);
    assert.equal(restored.snapshot.docs[0].content, '# Unique');
    assert.equal(byId(ctx, 'undo-remove').hidden, true);
  });

  await check('Annulation : expiration, vidage et réimport ne rétablissent pas un contenu retiré', async () => {
    let expire;
    const ctx = await session({beforeParse(win) {
      const schedule = win.setTimeout.bind(win);
      win.setTimeout = (fn, delay, ...args) => { if (delay === 30000) expire = fn; return schedule(fn, delay, ...args); };
    }});
    await H.imports(ctx, [H.file(ctx, 'a.md', '# Ancien')]);
    remove(ctx, 'a.md'); assert.equal(typeof expire, 'function'); expire();
    assert.equal(byId(ctx, 'undo-remove').hidden, true);
    byId(ctx, 'undo-remove').click(); assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length, 0);
    await H.imports(ctx, [H.file(ctx, 'a.md', '# Ancien')]); remove(ctx, 'a.md');
    await H.imports(ctx, [H.file(ctx, 'a.md', '# Nouveau')]);
    assert.equal(byId(ctx, 'undo-remove').hidden, true); byId(ctx, 'undo-remove').click();
    assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Nouveau');
    await H.imports(ctx, [H.file(ctx, 'b.md', '# Autre')]); remove(ctx, 'b.md');
    byId(ctx, 'clear-all').click(); byId(ctx, 'confirm-clear').click();
    assert.equal(byId(ctx, 'undo-remove').hidden, true); byId(ctx, 'undo-remove').click();
    assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length, 0);
  });

  await check('Annulation : les limites de collection restent applicables sans écraser un document', async () => {
    const ctx = await session();
    await H.imports(ctx, [H.file(ctx, 'retiré.md', '# À rétablir')]); remove(ctx, 'retiré.md');
    await H.imports(ctx, Array.from({length: 200}, (_, i) => H.file(ctx, 'note-' + i + '.md', '# Note ' + i)));
    byId(ctx, 'undo-remove').click();
    assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length, 200);
    assert.match(byId(ctx, 'toast-message').textContent, /plus assez de place/);
    assert(![...ctx.doc.querySelectorAll('[role="tab"]')].some(tab => tab.title === 'retiré.md'));
  });

  await check('Annulation et suivi : un ancien callback reste obsolète après réouverture du même onglet', async () => {
    let handle, release;
    const ctx = await session({beforeParse(win) {
      Object.defineProperty(win, 'isSecureContext', {value: true}); win.showOpenFilePicker = async () => [handle];
    }});
    const model = {content: '# Original', version: 1, gate: null, entered: false};
    handle = {kind: 'file', name: 'suivi.md', queryPermission: async () => 'granted', requestPermission: async () => 'granted', getFile: async () => {
      const content = model.content, gate = model.gate;
      const file = new ctx.win.File([content], 'suivi.md', {lastModified: model.version});
      if (gate) file.arrayBuffer = async () => { model.entered = true; await gate; return new TextEncoder().encode(content).buffer; };
      return file;
    }};
    try {
      await H.imports(ctx, [H.file(ctx, 'suivi.md', '# Importé')]);
      const id = H.activeTab(ctx).dataset.docId;
      byId(ctx, 'watch-toggle').click();
      await H.until(() => byId(ctx, 'watch-status').dataset.state === 'watching', 'watching');
      model.content = '# Trop tard'; model.version = 2; model.gate = new Promise(resolve => { release = resolve; });
      const pending = ctx.win.FolioWatcher.checkNow(id);
      await H.until(() => model.entered, 'pending read');
      remove(ctx, 'suivi.md'); model.content = '# Original'; model.version = 1; model.gate = null;
      byId(ctx, 'undo-remove').click();
      release(); assert.equal(await pending, false);
      await H.until(() => byId(ctx, 'watch-status').dataset.state === 'watching', 'fresh watcher');
      assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Original');
      assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length, 1);
    } finally { release?.(); }
  });

  const report = {generatedAt: new Date().toISOString(), tests, passed: tests.filter(test => test.status === 'PASS').length, total: tests.length};
  fs.mkdirSync(outputDir, {recursive: true});
  fs.writeFileSync(path.join(outputDir, 'rapport-reading-features.json'), JSON.stringify(report, null, 2) + '\n');
  print(JSON.stringify(report, null, 2));
  process.exitCode = report.passed === report.total ? 0 : 1;
  return report;
})();
