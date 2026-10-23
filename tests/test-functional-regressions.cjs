'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./storage-harness.cjs');
const outputDir = path.join(__dirname, 'output');
const tests = [];
const sessions = [];
const print = (...args) => { if (require.main === module) console.log(...args); };
async function check(name, fn) {
  const firstSession = sessions.length;
  try {
    await fn();
    for (const ctx of sessions.slice(firstSession)) {
      assert.deepEqual(ctx.errors, [], 'No unexpected JavaScript error during the scenario');
      assert.deepEqual(ctx.requests, [], 'No network request during the scenario');
    }
    tests.push({name, status: 'PASS'});
  }
  catch (error) { tests.push({name, status: 'FAIL', message: error.stack || String(error)}); }
}
async function session(options = {}, factory = H.freshFactory()) {
  const ctx = H.createSession(factory, options);
  sessions.push(ctx);
  await H.until(() => ctx.doc.getElementById('storage-status').dataset.state !== 'loading', 'initialization');
  return ctx;
}
async function exported(ctx) {
  const count = ctx.downloads.length;
  ctx.doc.getElementById('export-toggle').click();
  ctx.doc.getElementById('export-current').click();
  await H.until(() => ctx.downloads.length > count, 'download');
  const output = ctx.downloads.at(-1);
  return {filename: output.filename, document: new ctx.win.DOMParser().parseFromString(await output.blob.text(), 'text/html')};
}
function dropped(ctx, entries) {
  const event = new ctx.win.Event('drop', {bubbles: true, cancelable: true});
  Object.defineProperty(event, 'dataTransfer', {value: {
    types: ['Files'], files: [], items: entries.map(entry => ({kind: 'file', webkitGetAsEntry: () => entry}))
  }});
  ctx.doc.dispatchEvent(event);
}
function directory(name, children) {
  return {name, isDirectory: true, isFile: false, createReader() {
    let position = 0;
    return {readEntries(resolve) {
      const chunk = children.slice(position, position + 100); position += chunk.length; resolve(chunk);
    }};
  }};
}
function fileEntry(ctx, name, content, counter) {
  return {name, isDirectory: false, isFile: true, file(resolve) { counter.reads++; resolve(H.file(ctx, name, content)); }};
}
function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function luminance(color) {
  const channels = (Array.isArray(color) ? color : rgb(color)).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels.reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(foreground, background, opacity = 1) {
  const fg = rgb(foreground), bg = rgb(background);
  const values = [luminance(fg.map((v, i) => v * opacity + bg[i] * (1 - opacity))), luminance(bg)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}
function variables(rule) {
  return Object.fromEntries([...rule.matchAll(/--([\w-]+)\s*:\s*(#[\da-f]{6})\s*;/gi)].map(match => [match[1], match[2]]));
}

module.exports = (async () => {
  await check('Exports individuels : noms uniques et liens cohérents pour extensions Markdown concurrentes', async () => {
    const ctx = await session();
    try {
      await H.imports(ctx, [
        H.file(ctx, 'note.md', '# First\n\n[Second](note.markdown#second)'),
        H.file(ctx, 'note.markdown', '# Second\n\n[First](note.md#first)')
      ]);
      H.selectByTitle(ctx, 'note.md'); const first = await exported(ctx);
      H.selectByTitle(ctx, 'note.markdown'); const second = await exported(ctx);
      assert.notEqual(first.filename, second.filename, 'Distinct documents must not download under the same HTML filename');
      for (const [from, to, label] of [[first, second, 'Second'], [second, first, 'First']]) {
        const link = [...from.document.querySelectorAll('article a')].find(a => a.textContent === label);
        assert(link, 'Cross-document link retained');
        const url = new URL(link.getAttribute('href'), 'https://export.test/' + encodeURIComponent(from.filename));
        assert.equal(decodeURIComponent(url.pathname.slice(1)), to.filename, 'Link must point to the actual other download name');
        assert(to.document.getElementById(decodeURIComponent(url.hash.slice(1))), 'Link fragment must exist in the destination HTML');
      }
    } finally { ctx.close(); }
  });
  await check('Export au clavier : retour du focus au déclencheur visible après téléchargement', async () => {
    const ctx = await session();
    try {
      await H.imports(ctx, [H.file(ctx, 'focus.md', '# Focus')]);
      ctx.doc.getElementById('export-toggle').focus();
      await exported(ctx);
      const trigger = ctx.doc.getElementById('export-toggle');
      assert.match(trigger.getAttribute('aria-label') || trigger.getAttribute('title') || '', /télécharger/i,
        'The download button needs a name when its visible label is hidden on narrow screens');
      assert.equal(trigger.disabled, false);
      assert.equal(ctx.doc.getElementById('export-menu').hidden, true);
      assert.equal(ctx.doc.activeElement, trigger);
      assert.equal(ctx.doc.activeElement.closest('[hidden]'), null);
    } finally { ctx.close(); }
  });
  await check('Cartouche actif : commandes uniques, recherche et métadonnées accessibles selon la largeur', async () => {
    let width = 1280, prints = 0;
    const ctx = await session({beforeParse(win) {
      win.matchMedia = query => ({matches: width <= Number(query.match(/max-width:\s*(\d+)px/)?.[1] || 0), media: query, addEventListener(){}, removeEventListener(){}});
      Object.defineProperty(win, 'isSecureContext', {value: true});
      win.showOpenFilePicker = async () => [];
      win.print = () => { prints++; };
    }});
    try {
      const actions = ctx.doc.getElementById('document-actions');
      const metadata = ctx.doc.getElementById('document-metadata');
      const sidebarSlot = ctx.doc.getElementById('metadata-sidebar-slot');
      const source = ctx.doc.getElementById('source-toggle');
      const resize = value => {
        width = value;
        // jsdom does not apply viewport CSS media queries with our matchMedia
        // stub. Expose the mobile controls so its focus rules model that viewport.
        ctx.doc.querySelectorAll('.mobile-toggle').forEach(button => { button.style.display = value <= 760 ? 'inline-flex' : ''; });
        ctx.win.dispatchEvent(new ctx.win.Event('resize'));
      };
      const markdown = '# Second document\n\n## Section\n\nMatching search target.';
      assert(actions.closest('[hidden]'), 'Document actions are unavailable in the empty state');
      await H.imports(ctx, [H.file(ctx, 'first.md', '# First document'), H.file(ctx, 'tools.md', markdown)]);
      const activeCard = () => ctx.doc.querySelector('.file-item.active');
      assert.equal(actions.parentElement, activeCard().querySelector(':scope > .file-actions-slot'));
      assert.equal(metadata.parentElement, sidebarSlot);
      assert.equal(sidebarSlot.nextElementSibling, ctx.doc.getElementById('outline'), 'Metadata precedes the TOC');
      assert.equal(ctx.doc.querySelector('#reader > .reader-tools'), null, 'No toolbar row above the reading layout');
      assert.equal(ctx.doc.querySelector('.reader-status'), null, 'No duplicate bottom status banner');
      for (const id of ['document-actions', 'source-toggle', 'watch-toggle', 'print-doc', 'export-toggle']) {
        assert.equal(ctx.doc.querySelectorAll('#' + id).length, 1, 'One live instance of ' + id);
        assert(actions === ctx.doc.getElementById(id) || actions.contains(ctx.doc.getElementById(id)));
      }
      const search = ctx.doc.getElementById('search');
      search.value = 'Matching search target';
      search.dispatchEvent(new ctx.win.Event('input', {bubbles: true}));
      assert.equal(H.activeTab(ctx).title, 'first.md');
      assert(activeCard().classList.contains('outside-search'));
      assert.match(activeCard().textContent, /En lecture\s*·\s*hors résultats/);
      assert.equal(actions.closest('.file-item'), activeCard());
      assert.equal(actions.closest('[hidden]'), null, 'A filtered active document keeps its commands accessible');
      assert.equal(ctx.doc.querySelectorAll('.file-button').length, 2, 'Keep the active card alongside the matching result');
      resize(900);
      assert.equal(metadata.parentElement, activeCard().querySelector(':scope > .file-meta-slot'));
      assert.equal(actions.closest('.file-item'), activeCard(), 'Commands stay in the left collection at compact widths');
      const next = [...ctx.doc.querySelectorAll('.file-button')].find(button => button.title === 'tools.md');
      next.click();
      assert.equal(H.activeTab(ctx).title, 'tools.md');
      assert.equal(actions.closest('.file-item'), activeCard());
      assert.equal(metadata.closest('.file-item'), activeCard());
      assert.equal(activeCard().classList.contains('outside-search'), false);
      assert.equal(ctx.doc.querySelectorAll('.file-button').length, 1, 'A previously active nonmatching card leaves the results');
      source.click();
      assert.equal(ctx.doc.getElementById('source-view').textContent, markdown);
      assert.equal(ctx.doc.getElementById('source-view').hidden, false);
      ctx.doc.getElementById('reader-scroll').scrollTop = 137;
      resize(600);
      assert.equal(ctx.doc.getElementById('reader-scroll').scrollTop, 137);
      assert.equal(ctx.doc.getElementById('source-view').hidden, false, 'Responsive metadata moves preserve Source mode');
      ctx.doc.getElementById('sidebar-toggle').click();
      ctx.doc.getElementById('watch-menu-toggle').click();
      assert.equal(ctx.doc.getElementById('watch-menu').hidden, false);
      assert.equal(ctx.doc.activeElement, ctx.doc.getElementById('watch-toggle'));
      ctx.doc.dispatchEvent(new ctx.win.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
      assert.equal(ctx.doc.getElementById('watch-menu').hidden, true);
      assert.equal(ctx.doc.getElementById('sidebar').classList.contains('is-open'), false);
      assert.equal(ctx.doc.activeElement, ctx.doc.getElementById('sidebar-toggle'));
      ctx.doc.getElementById('sidebar-toggle').click();
      source.click();
      assert.equal(ctx.doc.getElementById('source-view').hidden, true);
      assert.equal(ctx.doc.getElementById('sidebar').classList.contains('is-open'), false);
      assert.equal(ctx.doc.activeElement, ctx.doc.getElementById('article'));
      ctx.doc.getElementById('sidebar-toggle').click();
      source.click();
      assert.equal(ctx.doc.getElementById('source-view').hidden, false);
      assert.equal(ctx.doc.getElementById('sidebar').classList.contains('is-open'), false);
      assert.equal(ctx.doc.activeElement, ctx.doc.getElementById('source-view'));
      resize(1280);
      assert.equal(metadata.parentElement, sidebarSlot);
      assert.equal(actions.closest('.file-item'), activeCard());
      ctx.doc.getElementById('print-doc').click();
      assert.equal(prints, 1);
      assert.equal(ctx.doc.getElementById('source-view').hidden, true, 'Printing selects the rendered document');
      assert.equal(H.activeTab(ctx).title, 'tools.md', 'Using a card command must not reselect an enclosing row');
      source.focus(); resize(600);
      assert.equal(ctx.doc.activeElement, ctx.doc.getElementById('sidebar-toggle'), 'A now-hidden collection command transfers focus to the visible mobile opener');
      resize(1280);
      assert(ctx.doc.activeElement.matches('.file-button.active'), 'The now-hidden mobile opener transfers focus back to the visible active card');
      assert.equal(ctx.doc.activeElement.title, 'tools.md');
    } finally { ctx.close(); }
  });
  await check('Corbeilles de collection : sélection, focus mobile et retraits mémorisés restent cohérents', async () => {
    const factory = H.freshFactory();
    const ctx = await session({beforeParse(win) {
      win.matchMedia = query => ({matches: 600 <= Number(query.match(/max-width:\s*(\d+)px/)?.[1] || 0), media: query, addEventListener(){}, removeEventListener(){}});
    }}, factory);
    const remove = name => {
      const card = [...ctx.doc.querySelectorAll('.file-item')].find(item => item.querySelector('.file-button')?.title === name);
      const button = card?.querySelector('.file-remove[data-remove-id]');
      assert(button, 'Each card exposes its own removal button');
      assert.match(button.getAttribute('aria-label') || '', new RegExp('Supprimer .*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.* de la collection'));
      button.focus(); button.click();
    };
    try {
      await H.imports(ctx, [H.file(ctx, 'one.md', '# One'), H.file(ctx, 'two.md', '# Two'), H.file(ctx, 'three.md', '# Three')]);
      ctx.doc.getElementById('remember-collection').click();
      await H.until(() => ctx.doc.getElementById('storage-status').dataset.state === 'saved', 'initial collection saved');
      ctx.doc.getElementById('sidebar-toggle').click();
      remove('three.md');
      assert.equal(H.activeTab(ctx).title, 'one.md', 'Deleting an inactive card must preserve the current document');
      assert.equal(ctx.doc.querySelector('#article h1').textContent, 'One');
      assert.equal(ctx.doc.getElementById('sidebar').classList.contains('is-open'), true);
      assert(ctx.doc.activeElement.matches('.file-button'));
      assert(ctx.doc.activeElement.isConnected);
      remove('one.md');
      assert.equal(H.activeTab(ctx).title, 'two.md');
      assert.equal(ctx.doc.activeElement.title, 'two.md');
      assert.equal(ctx.doc.getElementById('sidebar').classList.contains('is-open'), true);
      await H.until(() => ctx.doc.getElementById('storage-status').dataset.state === 'saved', 'removals saved');
      assert.deepEqual((await ctx.win.FolioStorage.read()).snapshot.docs.map(doc => doc.path), ['two.md']);
      const restored = await session({}, factory);
      try { assert.equal(H.activeTab(restored).title, 'two.md'); assert.equal(restored.doc.querySelectorAll('[role="tab"]').length, 1); }
      finally { restored.close(); }
      remove('two.md');
      assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length, 0);
      assert.equal(ctx.doc.getElementById('welcome').hidden, false);
      assert(ctx.doc.activeElement.matches('[data-action="import"]'));
      assert.equal(ctx.doc.activeElement.closest('[hidden]'), null);
      assert(ctx.doc.getElementById('document-actions').closest('[hidden]'));
      await H.until(() => ctx.doc.getElementById('storage-status').dataset.state === 'saved', 'empty collection saved');
      assert.equal((await ctx.win.FolioStorage.read()).snapshot.docs.length, 0);
    } finally { ctx.close(); }
  });
  await check('Corbeille pendant une lecture suivie : arrêt du suivi sans réapparition du document', async () => {
    let handle, release;
    const ctx = await session({beforeParse(win) {
      Object.defineProperty(win, 'isSecureContext', {value: true});
      win.showOpenFilePicker = async () => [handle];
    }});
    const model = {content: '# Original', version: 1, gate: null, entered: false, reads: 0};
    handle = {kind: 'file', name: 'tracked.md', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      getFile: async () => {
        model.reads++; const content = model.content, gate = model.gate;
        const result = new ctx.win.File([content], 'tracked.md', {lastModified: model.version});
        if (gate) result.arrayBuffer = async () => { model.entered = true; await gate; return new TextEncoder().encode(content).buffer; };
        return result;
      }};
    try {
      await H.imports(ctx, [H.file(ctx, 'tracked.md', '# Imported'), H.file(ctx, 'other.md', '# Other')]);
      const id = H.activeTab(ctx).dataset.docId;
      ctx.doc.getElementById('watch-toggle').click();
      await H.until(() => ctx.doc.getElementById('watch-status').dataset.state === 'watching', 'linked original');
      model.content = '# Too late'; model.version = 2; model.gate = new Promise(resolve => { release = resolve; });
      const pending = ctx.win.FolioWatcher.checkNow(id);
      await H.until(() => model.entered, 'pending original read');
      ctx.doc.querySelector('.file-remove[data-remove-id="' + id + '"]').click();
      release(); assert.equal(await pending, false);
      assert.equal(H.activeTab(ctx).title, 'other.md');
      assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length, 1);
      assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Other');
      const reads = model.reads;
      assert.equal(await ctx.win.FolioWatcher.checkNow(id), false);
      ctx.win.dispatchEvent(new ctx.win.Event('focus')); await H.delay(30);
      assert.equal(model.reads, reads, 'No later disk read after removal');
    } finally { if (release) release(); ctx.close(); }
  });
  await check('Libellé de code borné : le fence très long ne duplique pas son langage et conserve le code source', async () => {
    const ctx = await session();
    try {
      const code = 'const preserved = "$raw$";\n';
      const source = '# Code\n\n```' + 'x'.repeat(200000) + '\n' + code + '```\n';
      await H.imports(ctx, [H.file(ctx, 'long-language.md', source)]);
      const label = ctx.doc.querySelector('#article .code-bar > span');
      assert(label && label.textContent.length <= 81, 'Displayed language label must be bounded, including any ellipsis');
      assert.equal(ctx.doc.querySelector('#article pre code').textContent, code);
      ctx.doc.getElementById('source-toggle').click();
      assert.equal(ctx.doc.getElementById('source-view').textContent, source, 'Source view must keep the entire original Markdown');
      const output = await exported(ctx);
      assert(output.document.querySelector('.code-bar > span').textContent.length <= 81);
      assert.equal(output.document.querySelector('pre code').textContent, code);
    } finally { ctx.close(); }
  });
  await check('Liste mobile : la sélection d’un document transfère le focus vers l’onglet affiché', async () => {
    const ctx = await session({beforeParse(win) {
      win.matchMedia = q => ({matches: 600 <= Number(q.match(/max-width:\s*(\d+)px/)?.[1] || 0), media: q, addEventListener(){}, removeEventListener(){}});
    }});
    try {
      await H.imports(ctx, [H.file(ctx, 'one.md', '# One'), H.file(ctx, 'two.md', '# Two')]);
      ctx.doc.getElementById('sidebar-toggle').click();
      const button = [...ctx.doc.querySelectorAll('.file-button')].find(b => b.title === 'two.md');
      button.focus(); button.click();
      assert.equal(ctx.doc.getElementById('sidebar').classList.contains('is-open'), false);
      assert.equal(H.activeTab(ctx).title, 'two.md');
      assert.equal(ctx.doc.activeElement, H.activeTab(ctx));
    } finally { ctx.close(); }
  });
  await check('Liens : repli Unicode sûr, chemins exacts et focus de lecture après navigation', async () => {
    const ctx = await session();
    const nfc = 'café.md', nfd = 'cafe\u0301.md';
    const chooseLink = async (label, focusSelector = '#article') => {
      const link = [...ctx.doc.querySelectorAll('#article a')].find(a => a.textContent === label);
      assert(link); link.focus(); link.click();
      await H.until(() => ctx.doc.activeElement === ctx.doc.querySelector(focusSelector), 'reading focus after ' + label);
    };
    try {
      await H.imports(ctx, [
        H.file(ctx, 'index.md', '# Index\n\n[NFC](caf%C3%A9.md#section)\n\n[NFD](cafe%CC%81.md)'),
        H.file(ctx, nfd, '# Decomposed filename\n\n## Section\n\n[Local](#section)')
      ]);
      await chooseLink('NFC', '#article h2');
      assert.equal(H.activeTab(ctx).title, nfd, 'A unique canonically equivalent path should resolve');
      await H.imports(ctx, [H.file(ctx, nfc, '# Composed filename\n\n## Section')]);
      assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length, 3, 'Different original paths remain distinct documents');
      H.selectByTitle(ctx, 'index.md'); await chooseLink('NFC', '#article h2');
      assert.equal(H.activeTab(ctx).title, nfc, 'Exact NFC path wins over equivalence fallback');
      assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Composed filename');
      H.selectByTitle(ctx, 'index.md'); await chooseLink('NFD');
      assert.equal(H.activeTab(ctx).title, nfd, 'Exact NFD path wins over equivalence fallback');
      assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Decomposed filename');
      await chooseLink('Local', '#article h2');
    } finally { ctx.close(); }
    const ambiguous = await session();
    try {
      await H.imports(ambiguous, [
        H.file(ambiguous, 'index.md', '# Index\n\n[Ambiguous](caf%C3%A9.md)', 'index.md'),
        H.file(ambiguous, nfd, '# First equivalent', 'a/' + nfd),
        H.file(ambiguous, nfd, '# Second equivalent', 'b/' + nfd)
      ], true);
      ambiguous.doc.querySelector('#article a').click();
      assert.equal(H.activeTab(ambiguous).title, 'index.md', 'Ambiguous canonical paths must not silently select a document');
      assert.match(ambiguous.doc.getElementById('toast-message').textContent, /Plusieurs documents/);
    } finally { ambiguous.close(); }
  });
  await check('Dépôt de plusieurs dossiers : un budget global arrête la traversée avant import partiel', async () => {
    const ctx = await session(), counter = {reads: 0};
    try {
      const roots = ['first', 'second'].map(name => directory(name, [
        ...Array.from({length: 1600}, (_, i) => fileEntry(ctx, `ignored-${i}.txt`, '', counter)),
        fileEntry(ctx, 'marker.md', '# ' + name, counter)
      ]));
      dropped(ctx, roots);
      await H.until(() => !!ctx.doc.getElementById('toast-message').textContent, 'drop limit feedback');
      assert.match(ctx.doc.getElementById('toast-message').textContent, /trop|limite|3\s*000/i);
      assert(counter.reads <= 3000, `Traversal read ${counter.reads} files before enforcing its global budget`);
      assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length, 0, 'No partial collection after rejected traversal');
      assert.equal(ctx.doc.getElementById('busy-indicator').hidden, true);
      await H.imports(ctx, [H.file(ctx, 'recovery.md', '# Recovery')]);
      assert.equal(H.activeTab(ctx).title, 'recovery.md', 'Rejected drop must not leave imports busy');
    } finally { ctx.close(); }
  });
  await check('Dépôt profondément imbriqué : arrêt avant lecture et interface récupérable', async () => {
    const ctx = await session(), counter = {reads: 0};
    try {
      let root = fileEntry(ctx, 'deep.md', '# Deep', counter);
      for (let i = 0; i < 70; i++) root = directory('d' + i, [root]);
      dropped(ctx, [root]);
      await H.until(() => !!ctx.doc.getElementById('toast-message').textContent, 'depth limit feedback');
      assert.match(ctx.doc.getElementById('toast-message').textContent, /profond|imbriqu|niveau|limite/i);
      assert.equal(counter.reads, 0);
      assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length, 0);
      await H.imports(ctx, [H.file(ctx, 'recovery.md', '# Recovery')]);
      assert.equal(H.activeTab(ctx).title, 'recovery.md');
    } finally { ctx.close(); }
  });
  await check('Contraste : petits textes secondaires et extensions atteignent 4,5:1 dans les deux thèmes', async () => {
    const ctx = await session();
    try {
      const css = ctx.doc.getElementById('app-styles').textContent;
      const rules = {light: css.match(/:root\s*\{([^}]+)\}/)?.[1], dark: css.match(/:root\[data-theme=dark\]\s*\{([^}]+)\}/)?.[1]};
      const extRule = css.match(/\.file-ext\s*\{([^}]+)\}/)?.[1] || '';
      const extOpacity = Number(extRule.match(/(?:^|;)\s*opacity\s*:\s*([\d.]+)/)?.[1] || 1);
      const extVariable = extRule.match(/(?:^|;)\s*color\s*:\s*var\(--([\w-]+)/)?.[1];
      for (const [theme, rule] of Object.entries(rules)) {
        assert(rule, 'Theme variables present: ' + theme);
        const vars = variables(rule);
        for (const background of ['surface', 'panel', 'accent-soft', 'canvas']) {
          const value = contrast(vars.muted, vars[background]);
          assert(value >= 4.5, `${theme} muted on ${background}: ${value.toFixed(3)}:1`);
        }
        for (const [background, inherited] of [['surface', 'text'], ['panel', 'text'], ['accent-soft', 'accent']]) {
          const value = contrast(vars[extVariable || inherited], vars[background], extOpacity);
          assert(value >= 4.5, `${theme} extension on ${background}: ${value.toFixed(3)}:1`);
        }
      }
    } finally { ctx.close(); }
  });
  const report = {
    generatedAt: new Date().toISOString(), tests,
    passed: tests.filter(test => test.status === 'PASS').length, total: tests.length,
    limitations: [
      'Exécution DOM jsdom : aucune validation visuelle, de layout ou avec lecteur d’écran.',
      'Les régressions de focus vérifient une destination explicite ; les comportements natifs de floutage restent à vérifier dans les navigateurs.',
      'Le dépôt utilise des FileSystemEntry synthétiques avec lots de 100 entrées.',
      'Le contraste est calculé depuis les couleurs CSS explicites ; ce test ne constitue pas un audit WCAG complet.'
    ]
  };
  fs.mkdirSync(outputDir, {recursive: true});
  fs.writeFileSync(path.join(outputDir, 'functional-report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(outputDir, 'functional-report.md'), ['# Régressions fonctionnelles', '', `${report.passed}/${report.total} vérifications réussies.`, '', ...tests.map(test => `- ${test.status} — ${test.name}${test.message ? ': ' + test.message.split('\n')[0] : ''}`), '', '## Limites', '', ...report.limitations.map(text => '- ' + text)].join('\n') + '\n');
  print(JSON.stringify(report, null, 2));
  process.exitCode = report.passed === report.total ? 0 : 1;
  return report;
})().catch(error => { print(error.stack || error); process.exitCode = 1; });
