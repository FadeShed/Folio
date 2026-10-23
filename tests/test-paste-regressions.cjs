'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./storage-harness.cjs');

const outputDir = path.join(__dirname, 'output');
const tests = [], sessions = [];
const fixedTime = new Date(2026, 9, 23, 14, 5, 6).getTime();
const baseName = 'Collage-2026-10-23_14-05-06';
const print = (...args) => { if (require.main === module) console.log(...args); };
const count = ctx => ctx.doc.querySelectorAll('[role="tab"]').length;

async function check(name, run) {
  const first = sessions.length;
  try {
    await run();
    for (const ctx of sessions.slice(first)) {
      assert.deepEqual(ctx.errors, [], 'No unexpected JavaScript errors');
      assert.deepEqual(ctx.requests, [], 'Pasting must not issue network requests');
      assert.deepEqual(ctx.clipboardReads, [], 'The clipboard is read only from the paste event');
    }
    tests.push({name, status: 'PASS'});
  } catch (error) { tests.push({name, status: 'FAIL', message: error.stack || String(error)}); }
}

async function session(factory = H.freshFactory()) {
  const clipboardReads = [];
  const ctx = H.createSession(factory, {beforeParse(win) {
    const NativeDate = win.Date;
    win.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixedTime])); }
      static now() { return fixedTime; }
    };
    Object.defineProperty(win.navigator, 'clipboard', {configurable: true, value: {
      read: async () => { clipboardReads.push('read'); throw new Error('Unexpected clipboard.read'); },
      readText: async () => { clipboardReads.push('readText'); throw new Error('Unexpected clipboard.readText'); }
    }});
  }});
  ctx.clipboardReads = clipboardReads;
  sessions.push(ctx);
  await H.until(() => ctx.doc.getElementById('storage-status').dataset.state !== 'loading', 'initialization');
  return ctx;
}

function paste(ctx, target, text, options = {}) {
  const event = new ctx.win.Event('paste', {bubbles: true, cancelable: true});
  const reads = [];
  Object.defineProperty(event, 'clipboardData', {value: {
    types: options.types || ['text/plain'], files: options.files || [], items: options.items || [],
    getData(type) { reads.push(type); return type === 'text/plain' ? text : type === 'text/html' ? options.html || '' : ''; }
  }});
  if (options.prevented) event.preventDefault();
  target.dispatchEvent(event);
  return {event, reads};
}

async function settled(ctx) {
  await H.until(() => ctx.doc.getElementById('busy-indicator').hidden, 'import completed');
  await H.delay(30);
}

function openDialog(ctx) {
  const button = ctx.doc.querySelector('[data-action="paste"]');
  assert(button, 'A visible action must open the paste dialog');
  button.focus(); button.click();
  assert.equal(ctx.doc.getElementById('paste-dialog').open, true);
  assert.equal(ctx.doc.activeElement, ctx.doc.getElementById('paste-input'));
}

function draft(ctx, value) {
  const input = ctx.doc.getElementById('paste-input');
  input.value = value;
  input.dispatchEvent(new ctx.win.Event('input', {bubbles: true}));
  return input;
}

function shortcut(ctx, modifier = 'ctrlKey') {
  const event = new ctx.win.KeyboardEvent('keydown', {key: 'Enter', [modifier]: true, bubbles: true, cancelable: true});
  ctx.doc.getElementById('paste-input').dispatchEvent(event);
  return event;
}

module.exports = (async () => {
  await check('Collage global : source normalisée, nouveau document actif et noms datés sans écrasement', async () => {
    const ctx = await session();
    try {
      await H.imports(ctx, [H.file(ctx, baseName + '.md', '# Original à préserver'), H.file(ctx, 'existing.md', '# Existing')]);
      ctx.doc.getElementById('source-toggle').click();
      const search = ctx.doc.getElementById('search');
      search.value = 'original'; search.dispatchEvent(new ctx.win.Event('input', {bubbles: true}));
      const raw = '\uFEFF# Collé en UTF-8\r\n\r\nUn paragraphe avec été et $x^2$.\r\n\r\n```text\r$literal$\r```\r';
      const expected = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
      const result = paste(ctx, ctx.doc.getElementById('article'), raw);
      assert.equal(result.event.defaultPrevented, true);
      await settled(ctx);
      assert.equal(count(ctx), 3);
      assert.equal(H.activeTab(ctx).title, baseName + '-2.md');
      assert.equal(ctx.doc.getElementById('source-view').textContent, expected);
      assert.equal(ctx.doc.getElementById('source-view').hidden, true, 'A new pasted document opens as rendered HTML');
      assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Collé en UTF-8');
      assert.equal(ctx.doc.querySelectorAll('#article .katex').length, 1);
      assert.equal(ctx.doc.querySelector('#article pre code').textContent, '$literal$\n');
      assert.equal(search.value, '');
      assert.equal(ctx.doc.activeElement, ctx.doc.getElementById('article'));
      assert.deepEqual(result.reads, ['text/plain']);
      H.selectByTitle(ctx, baseName + '.md');
      assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Original à préserver');
      paste(ctx, ctx.doc.body, 'Un second paragraphe sans titre.');
      await settled(ctx);
      assert.equal(count(ctx), 4);
      assert.equal(H.activeTab(ctx).title, baseName + '-3.md');
      assert.equal(ctx.doc.querySelector('#article p').textContent, 'Un second paragraphe sans titre.');
      H.selectByTitle(ctx, baseName + '-2.md');
      assert.equal(ctx.doc.getElementById('source-view').textContent, expected, 'Same-second paste must preserve the previous pasted source');
    } finally { ctx.close(); }
  });

  await check('Collage global : champs éditables, dialogue ouvert et événement déjà traité restent libres', async () => {
    const ctx = await session();
    try {
      await H.imports(ctx, [H.file(ctx, 'existing.md', '# Existing')]);
      const fixtures = ctx.doc.createElement('section');
      fixtures.innerHTML = '<input><textarea></textarea><select><option>Choice</option></select><div contenteditable="true"><span>Nested editable</span></div><div contenteditable="plaintext-only"><b>Plain editor</b></div><div role="textbox"><span>Custom editor</span></div>';
      ctx.doc.body.append(fixtures);
      for (const selector of ['input', 'textarea', 'select', '[contenteditable="true"] span', '[contenteditable="plaintext-only"] b', '[role="textbox"] span']) {
        const result = paste(ctx, fixtures.querySelector(selector), '# Leave native paste alone');
        assert.equal(result.event.defaultPrevented, false, selector + ' must keep its native paste behavior');
      }
      const prehandled = paste(ctx, ctx.doc.body, '# Already handled', {prevented: true});
      assert.equal(prehandled.event.defaultPrevented, true);
      ctx.doc.getElementById('help-dialog').showModal();
      const modal = paste(ctx, ctx.doc.body, '# Dialog must keep control');
      assert.equal(modal.event.defaultPrevented, false);
      ctx.doc.getElementById('help-dialog').close();
      await settled(ctx);
      assert.equal(count(ctx), 1);
      assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Existing');
    } finally { ctx.close(); }
  });

  await check('Formats du presse-papiers : fichiers et HTML seuls ignorés, texte brut prioritaire', async () => {
    const ctx = await session();
    try {
      const ignored = [
        paste(ctx, ctx.doc.body, '', {types: ['text/html'], html: '<h1>HTML only</h1>'}),
        paste(ctx, ctx.doc.body, '# File payload', {types: ['Files', 'text/plain'], files: [H.file(ctx, 'clipboard.md', '# File')]}),
        paste(ctx, ctx.doc.body, '# File item', {items: [{kind: 'file', type: 'text/markdown'}]}),
        paste(ctx, ctx.doc.body, ' \t\r\n ')
      ];
      for (const result of ignored) assert.equal(result.event.defaultPrevented, false);
      await settled(ctx); assert.equal(count(ctx), 0);
      const rich = paste(ctx, ctx.doc.body, '# Plain version', {types: ['text/html', 'text/plain'], html: '<h1>Wrong version</h1><script>window.__paste_html=1</script>'});
      assert.equal(rich.event.defaultPrevented, true);
      await settled(ctx);
      assert.equal(count(ctx), 1);
      assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Plain version');
      assert.deepEqual(rich.reads, ['text/plain']);
      assert.equal(ctx.win.__paste_html, undefined);
    } finally { ctx.close(); }
  });

  await check('Rendu du texte collé : assainissement, images distantes bloquées et mathématiques locales', async () => {
    const ctx = await session();
    try {
      const raw = '# Safe paste\n\n<script>window.__paste_xss=1</script>\n\n<img src="https://never.invalid/pixel.png" onerror="window.__paste_xss=2">\n\n[Unsafe](javascript:alert(1))\n\nUne formule $E=mc^2$.';
      paste(ctx, ctx.doc.body, raw); await settled(ctx);
      assert.equal(count(ctx), 1);
      assert.equal(ctx.win.__paste_xss, undefined);
      assert.equal(ctx.doc.querySelectorAll('#article script,#article [onerror],#article [onload],#article a[href^="javascript:"]').length, 0);
      assert.equal(ctx.doc.querySelectorAll('#article img[src^="http"]').length, 0);
      assert(ctx.doc.querySelector('#article .image-placeholder'));
      assert.equal(ctx.doc.querySelectorAll('#article .katex').length, 1);
      assert.equal(ctx.doc.getElementById('source-view').textContent, raw, 'Sanitizing the rendering must not rewrite the source');
    } finally { ctx.close(); }
  });

  await check('Dialogue : collage natif dans le brouillon, création explicite et annulation sans ajout', async () => {
    const ctx = await session();
    try {
      openDialog(ctx);
      const textarea = ctx.doc.getElementById('paste-input');
      const event = paste(ctx, textarea, '# Draft');
      assert.equal(event.event.defaultPrevented, false);
      await settled(ctx); assert.equal(count(ctx), 0);
      draft(ctx, '# Draft\n\nCreated explicitly.');
      ctx.doc.getElementById('paste-import').click();
      await H.until(() => !ctx.doc.getElementById('paste-dialog').open, 'dialog closes after creation');
      assert.equal(count(ctx), 1);
      assert.equal(H.activeTab(ctx).title, baseName + '.md');
      assert.equal(textarea.value, '');
      assert.equal(ctx.doc.getElementById('paste-error').hidden, true);
      assert.equal(ctx.doc.getElementById('source-view').hidden, true);
      assert.equal(ctx.doc.activeElement, ctx.doc.getElementById('article'));
      openDialog(ctx); draft(ctx, '# Cancelled draft');
      ctx.doc.querySelector('#paste-dialog [data-close="paste-dialog"]').click();
      assert.equal(ctx.doc.getElementById('paste-dialog').open, false);
      assert.equal(count(ctx), 1);
      assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Draft');
    } finally { ctx.close(); }
  });

  await check('Raccourcis du dialogue : Ctrl Entrée et Commande Entrée créent chacun un seul document', async () => {
    const ctx = await session();
    try {
      for (const [index, modifier] of ['ctrlKey', 'metaKey'].entries()) {
        openDialog(ctx); draft(ctx, '# Shortcut ' + modifier);
        const key = shortcut(ctx, modifier);
        assert.equal(key.defaultPrevented, true);
        await H.until(() => !ctx.doc.getElementById('paste-dialog').open, modifier + ' submit completed');
        assert.equal(count(ctx), index + 1);
        assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Shortcut ' + modifier);
        assert.equal(ctx.doc.activeElement, ctx.doc.getElementById('article'));
      }
    } finally { ctx.close(); }
  });

  await check('Erreurs de collage : brouillon conservé, limite UTF-8 et limite de rendu puis reprise', async () => {
    const ctx = await session();
    try {
      await H.imports(ctx, [H.file(ctx, 'existing.md', '# Existing')]);
      ctx.doc.getElementById('source-toggle').click();
      ctx.doc.getElementById('reader-scroll').scrollTop = 91;
      openDialog(ctx);
      for (const [label, value] of [['empty', ' \n\t'], ['UTF-8 size', 'é'.repeat(3 * 1024 * 1024)], ['render limit', '$x$ '.repeat(1001)]]) {
        const input = draft(ctx, value);
        shortcut(ctx);
        await H.until(() => !ctx.doc.getElementById('paste-error').hidden, label + ' inline error');
        await H.until(() => !input.readOnly, label + ' submission released');
        assert.equal(ctx.doc.getElementById('paste-dialog').open, true);
        assert.equal(input.value === value, true, label + ' failure must keep the complete draft');
        assert.equal(ctx.doc.getElementById('paste-error').getAttribute('role'), 'alert');
        assert(ctx.doc.getElementById('paste-error').textContent.trim());
        assert.equal(input.getAttribute('aria-invalid'), 'true');
        assert.equal(count(ctx), 1);
        assert.equal(H.activeTab(ctx).title, 'existing.md');
        assert.equal(ctx.doc.getElementById('source-view').hidden, false, 'Rejected paste must preserve the reading mode');
        assert.equal(ctx.doc.getElementById('reader-scroll').scrollTop, 91, 'Rejected paste must preserve the reading position');
      }
      draft(ctx, '# Recovered'); ctx.doc.getElementById('paste-import').click();
      await H.until(() => !ctx.doc.getElementById('paste-dialog').open, 'recovery succeeds');
      assert.equal(count(ctx), 2);
      assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Recovered');
      assert.equal(ctx.doc.getElementById('paste-input').getAttribute('aria-invalid'), null);
    } finally { ctx.close(); }
  });

  await check('Import en cours : collage capturé sans ajout différé ni création concurrente', async () => {
    const ctx = await session(); let release;
    try {
      await H.imports(ctx, [H.file(ctx, 'existing.md', '# Existing')]);
      const gate = new Promise(resolve => { release = resolve; }); let entered = false;
      const input = H.file(ctx, 'slow.md', '# Slow import');
      input.arrayBuffer = async () => { entered = true; await gate; return new TextEncoder().encode('# Slow import').buffer; };
      const importing = H.imports(ctx, [input]);
      await H.until(() => entered, 'slow import started');
      const blocked = paste(ctx, ctx.doc.body, '# Must not be queued');
      assert.equal(blocked.event.defaultPrevented, true);
      assert.match(ctx.doc.getElementById('toast-message').textContent, /collection.*en cours/i);
      assert.equal(count(ctx), 1);
      release(); await importing;
      assert.equal(count(ctx), 2);
      assert.equal(H.activeTab(ctx).title, 'slow.md');
      paste(ctx, ctx.doc.body, '# After the import'); await settled(ctx);
      assert.equal(count(ctx), 3);
      assert.equal(ctx.doc.querySelector('#article h1').textContent, 'After the import');
      assert.equal([...ctx.doc.querySelectorAll('[role="tab"]')].filter(tab => tab.title.startsWith('Collage-')).length, 1);
    } finally { if (release) release(); ctx.close(); }
  });

  await check('Collection pleine : le collage respecte les 200 documents sans changer la sélection ni la recherche', async () => {
    const ctx = await session();
    try {
      await H.imports(ctx, Array.from({length: 200}, (_, index) => H.file(ctx, `doc-${index}.md`, '# Document ' + index)));
      assert.equal(count(ctx), 200);
      const active = H.activeTab(ctx).title;
      const search = ctx.doc.getElementById('search');
      search.value = 'Document 199'; search.dispatchEvent(new ctx.win.Event('input', {bubbles: true}));
      const result = paste(ctx, ctx.doc.body, '# Too many documents');
      assert.equal(result.event.defaultPrevented, true);
      await settled(ctx);
      assert.equal(count(ctx), 200);
      assert.equal(H.activeTab(ctx).title, active);
      assert.equal(search.value, 'Document 199');
      assert.match(ctx.doc.getElementById('toast-message').textContent, /200/);
      assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Document 0');
    } finally { ctx.close(); }
  });

  await check('Mémorisation : aucun enregistrement sans opt-in, copies collées restaurées sans suivi implicite', async () => {
    const factory = H.freshFactory();
    const ctx = await session(factory);
    try {
      const before = ctx.events.filter(event => event.type === 'mutation-request').length;
      paste(ctx, ctx.doc.body, '# First pasted copy'); await settled(ctx); await H.delay(300);
      assert.equal(ctx.events.filter(event => event.type === 'mutation-request').length, before);
      const off = await ctx.win.FolioStorage.read();
      assert.equal(off.enabled, false); assert.equal(off.snapshot, null);
      ctx.doc.getElementById('remember-collection').click();
      await H.until(() => ctx.doc.getElementById('storage-status').dataset.state === 'saved', 'opt-in saved');
      paste(ctx, ctx.doc.body, '# Second pasted copy'); await settled(ctx);
      await H.until(() => ctx.doc.getElementById('storage-status').dataset.state === 'saved', 'second paste saved');
      const stored = await ctx.win.FolioStorage.read();
      assert.equal(stored.enabled, true);
      assert.equal(stored.snapshot.docs.length, 2);
      assert.deepEqual(stored.snapshot.docs.map(doc => doc.path), [baseName + '.md', baseName + '-2.md']);
      assert.deepEqual(stored.snapshot.docs.map(doc => doc.content), ['# First pasted copy', '# Second pasted copy']);
      for (const doc of stored.snapshot.docs) {
        assert.equal(doc.watch.enabled, false);
        assert.equal(doc.watch.handle, null);
      }
      ctx.close();
      const restored = await session(factory);
      try {
        assert.equal(count(restored), 2);
        assert.equal(H.activeTab(restored).title, baseName + '-2.md');
        assert.equal(restored.doc.querySelector('#article h1').textContent, 'Second pasted copy');
        assert.equal(restored.doc.getElementById('watch-toggle').checked, false);
        H.selectByTitle(restored, baseName + '.md');
        assert.equal(restored.doc.getElementById('source-view').textContent, '# First pasted copy');
      } finally { restored.close(); }
    } finally { ctx.close(); }
  });

  for (const ctx of sessions) ctx.close();
  const report = {
    generatedAt: new Date().toISOString(), type: 'paste-regressions', tests,
    passed: tests.filter(test => test.status === 'PASS').length, total: tests.length,
    limitations: [
      'DOM et événements de presse-papiers simulés : aucun accès au presse-papiers natif ni validation des permissions du navigateur.',
      'La saisie native dans le textarea est simulée après vérification que son événement paste reste libre ; jsdom n’exécute pas cette action par défaut.',
      'La date locale est figée pour vérifier les collisions dans la même seconde. Les plafonds UTF-8, de rendu et de nombre de documents passent par le pipeline réel d’import.'
    ]
  };
  fs.mkdirSync(outputDir, {recursive: true});
  fs.writeFileSync(path.join(outputDir, 'rapport-paste-regressions.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outputDir, 'rapport-paste-regressions.txt'), [`Collage Markdown : ${report.passed}/${report.total}`,
    ...tests.map(test => test.status + ' — ' + test.name + (test.message ? '\n' + test.message : '')), '', 'Limites :', ...report.limitations.map(value => '- ' + value)].join('\n'));
  print(JSON.stringify(report, null, 2));
  process.exitCode = report.passed === report.total ? 0 : 1;
})().catch(error => { for (const ctx of sessions) ctx.close(); console.error(error.stack); process.exitCode = 1; });
