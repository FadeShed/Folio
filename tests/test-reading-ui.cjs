'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./storage-harness.cjs');
const tests = [], sessions = [];
const outputDir = path.join(__dirname, 'output');
const print = (...args) => { if (require.main === module) console.log(...args); };

async function session(options = {}, factory = H.freshFactory()) {
  const ctx = H.createSession(factory, options);
  sessions.push(ctx);
  await H.until(() => ctx.doc.getElementById('storage-status').dataset.state !== 'loading', 'initialization');
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
const source = ctx => ctx.doc.getElementById('source-toggle');
const numbers = ctx => ctx.doc.getElementById('line-numbers-toggle');
const view = ctx => ctx.doc.getElementById('source-view');

module.exports = (async () => {
  await check('Onglets : positions et modes propres à chaque fichier, sans défilement lissé implicite', async () => {
    const ctx = await session();
    assert.equal(source(ctx).disabled, true);
    assert.equal(numbers(ctx).disabled, true);
    assert.equal(ctx.doc.getElementById('outline-toggle').disabled, true);
    await H.imports(ctx, [H.file(ctx, 'a.md', '# Alpha\n\nUn texte.'), H.file(ctx, 'b.md', '# Bêta\n\nUn autre texte.')]);
    const scroll = ctx.doc.getElementById('reader-scroll');
    assert.equal(ctx.win.getComputedStyle(scroll).scrollBehavior, 'auto');
    scroll.scrollTop = 431;
    source(ctx).click(); scroll.scrollTop = 137;
    H.selectByTitle(ctx, 'b.md');
    assert.equal(view(ctx).hidden, true);
    scroll.scrollTop = 287;
    H.selectByTitle(ctx, 'a.md');
    assert.equal(view(ctx).hidden, false, 'Returning to a source tab keeps that file in Source mode');
    assert.equal(scroll.scrollTop, 137);
    assert.equal(source(ctx).querySelector('.source-label').textContent, 'HTML');
    source(ctx).click(); assert.equal(scroll.scrollTop, 431);
    H.selectByTitle(ctx, 'b.md'); assert.equal(scroll.scrollTop, 287);
    await H.delay(40); assert.equal(scroll.scrollTop, 287, 'Deferred UI work must not move the document');
  });

  await check('Lien entre documents : une cible laissée en Source repasse en HTML pour rejoindre son ancre', async () => {
    const ctx = await session();
    await H.imports(ctx, [H.file(ctx, 'a.md', '# Alpha\n\n[Vers Bêta](b.md#cible)'), H.file(ctx, 'b.md', '# Bêta\n\n## Cible\n\nTexte')]);
    H.selectByTitle(ctx, 'b.md'); source(ctx).click();
    H.selectByTitle(ctx, 'a.md');
    ctx.doc.querySelector('#article a').click();
    await H.delay(40);
    assert.equal(H.activeTab(ctx).title, 'b.md');
    assert.equal(view(ctx).hidden, true);
    assert.equal(ctx.doc.getElementById('article').hidden, false);
    assert.equal(ctx.doc.activeElement.id, 'folio-h-cible');
  });

  await check('Numéros de ligne : bouton dans la cartouche, choix par fichier et source strictement littérale', async () => {
    const ctx = await session();
    const markdown = '# Alpha\n\n\tUn accent : été.\n<img src=x onerror="window.__line_xss=1">\n';
    await H.imports(ctx, [H.file(ctx, 'a.md', markdown), H.file(ctx, 'b.md', '# Bêta')]);
    assert.equal(numbers(ctx).previousElementSibling, source(ctx));
    assert.equal(numbers(ctx).closest('#document-actions'), source(ctx).closest('#document-actions'));
    assert.equal(numbers(ctx).disabled, false, 'Numbering is available in both HTML and Source views');
    source(ctx).click(); numbers(ctx).click();
    assert.equal(numbers(ctx).getAttribute('aria-pressed'), 'true');
    assert.equal(view(ctx).textContent, markdown);
    assert.equal(view(ctx).querySelectorAll('.source-line').length, markdown.split('\n').length);
    assert.equal(view(ctx).querySelectorAll('img,script').length, 0);
    assert.equal(ctx.win.__line_xss, undefined);
    H.selectByTitle(ctx, 'b.md'); source(ctx).click();
    assert.equal(numbers(ctx).getAttribute('aria-pressed'), 'false');
    assert.equal(view(ctx).children.length, 0);
    H.selectByTitle(ctx, 'a.md');
    assert.equal(numbers(ctx).getAttribute('aria-pressed'), 'true');
    assert.equal(view(ctx).textContent, markdown);
    numbers(ctx).click();
    assert.equal(view(ctx).children.length, 0);
    assert.equal(view(ctx).textContent, markdown, 'Turning numbering off must not rewrite source whitespace');
  });

  await check('Numérotation : mémorisation facultative et réimport gardent le choix propre au fichier', async () => {
    const factory = H.freshFactory(), first = await session({}, factory);
    await H.imports(first, [H.file(first, 'a.md', '# Alpha\n\nTexte'), H.file(first, 'b.md', '# Bêta')]);
    source(first).click(); numbers(first).click();
    assert.equal((await first.win.FolioStorage.read()).enabled, false, 'Changing a display preference must not opt in to storage');
    await H.imports(first, [H.file(first, 'a.md', '# Alpha corrigé\n\nAutre texte')]);
    assert.equal(view(first).hidden, false);
    assert.equal(numbers(first).getAttribute('aria-pressed'), 'true');
    assert.equal(view(first).textContent, '# Alpha corrigé\n\nAutre texte');
    first.doc.getElementById('remember-collection').click();
    await H.until(() => first.doc.getElementById('storage-status').dataset.state === 'saved', 'saved');
    const saved = await first.win.FolioStorage.read();
    assert.equal(saved.snapshot.docs.find(doc => doc.path === 'a.md').lineNumbers, true);
    assert.equal(saved.snapshot.docs.find(doc => doc.path === 'b.md').lineNumbers, false);
    first.close();
    const restored = await session({}, factory);
    assert.equal(view(restored).hidden, false, 'The saved source mode is restored along with numbering');
    assert.equal(numbers(restored).getAttribute('aria-pressed'), 'true');
    assert(view(restored).classList.contains('numbered'));
    H.selectByTitle(restored, 'b.md'); source(restored).click();
    assert.equal(numbers(restored).getAttribute('aria-pressed'), 'false');
  });

  await check('Volets : repli indépendant, commandes de réouverture et raccourci de recherche accessibles', async () => {
    const ctx = await session();
    await H.imports(ctx, [H.file(ctx, 'a.md', '# Alpha'), H.file(ctx, 'b.md', '# Bêta')]);
    const left = ctx.doc.getElementById('sidebar-toggle'), right = ctx.doc.getElementById('outline-toggle');
    right.click(); left.click();
    assert.equal(left.getAttribute('aria-expanded'), 'false');
    assert.equal(right.getAttribute('aria-expanded'), 'false');
    assert(ctx.doc.querySelector('.shell').classList.contains('collection-collapsed'));
    assert(ctx.doc.getElementById('sidebar').inert);
    assert(ctx.doc.getElementById('reader').classList.contains('outline-collapsed'));
    assert.equal(ctx.doc.getElementById('document-metadata').closest('.file-item'), ctx.doc.querySelector('.file-item.active'));
    H.selectByTitle(ctx, 'b.md');
    assert.equal(left.getAttribute('aria-expanded'), 'false', 'Changing tabs must not reopen either panel');
    assert.equal(right.getAttribute('aria-expanded'), 'false');
    ctx.doc.dispatchEvent(new ctx.win.KeyboardEvent('keydown', {key: 'k', ctrlKey: true, bubbles: true}));
    assert.equal(left.getAttribute('aria-expanded'), 'true');
    assert.equal(ctx.doc.activeElement, ctx.doc.getElementById('search'));
    assert.equal(right.getAttribute('aria-expanded'), 'false');
    right.click();
    assert.equal(ctx.doc.getElementById('document-metadata').parentElement.id, 'metadata-sidebar-slot');
    assert.equal(ctx.doc.querySelectorAll('#document-actions').length, 1);
  });

  await check('Volets : le repli de bureau n’empêche pas l’ouverture mobile et le focus reste visible', async () => {
    let width = 1280;
    const ctx = await session({beforeParse(win) {
      win.matchMedia = query => ({matches: width <= Number(query.match(/max-width:\s*(\d+)px/)?.[1] || 0), media: query});
    }});
    await H.imports(ctx, [H.file(ctx, 'a.md', '# Alpha\n\nTexte')]);
    const left = ctx.doc.getElementById('sidebar-toggle'), sidebar = ctx.doc.getElementById('sidebar');
    const resize = value => { width = value; ctx.win.dispatchEvent(new ctx.win.Event('resize')); };
    left.click(); resize(600);
    left.click();
    assert(sidebar.classList.contains('is-open'));
    assert.equal(sidebar.inert, false);
    assert.equal(left.getAttribute('aria-expanded'), 'true');
    source(ctx).focus(); resize(1280);
    assert.equal(sidebar.inert, true, 'The desktop collapsed preference survives the mobile overlay');
    assert.equal(ctx.doc.activeElement, left);
    left.click();
    assert.equal(sidebar.inert, false);
    assert.equal(left.getAttribute('aria-expanded'), 'true');
  });

  await check('Numérotation : un bloc source géant ne crée pas une quantité illimitée de lignes DOM', async () => {
    const ctx = await session();
    const markdown = '```text\n' + '\n'.repeat(40000) + '```';
    await H.imports(ctx, [H.file(ctx, 'long.md', markdown)]);
    source(ctx).click(); numbers(ctx).click();
    assert.equal(numbers(ctx).getAttribute('aria-pressed'), 'false');
    assert.equal(view(ctx).children.length, 0);
    assert.equal(view(ctx).textContent, markdown);
    assert.match(ctx.doc.getElementById('toast-message').textContent, /40 000 lignes/);
  });

  const report = {generatedAt: new Date().toISOString(), tests, passed: tests.filter(test => test.status === 'PASS').length, total: tests.length};
  fs.mkdirSync(outputDir, {recursive: true});
  fs.writeFileSync(path.join(outputDir, 'rapport-reading-ui.json'), JSON.stringify(report, null, 2) + '\n');
  print(JSON.stringify(report, null, 2));
  process.exitCode = report.passed === report.total ? 0 : 1;
  return report;
})();
