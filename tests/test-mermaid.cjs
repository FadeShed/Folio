'use strict';
// Mermaid needs real browser geometry. These integration scenarios replace only
// its layout engine with a deterministic SVG producer; Folio's actual renderer,
// sanitization, UI, storage, and export code still run unchanged.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const H = require('./storage-harness.cjs');
const outputDir = path.join(__dirname, 'output');
const tests = [], sessions = [];
const print = (...args) => { if (require.main === module) console.log(...args); };
const fence = (source, language = 'mermaid') => '```' + language + '\n' + source + '\n```';
const xml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));

function testSVG(id, source) {
  return '<svg xmlns="http://www.w3.org/2000/svg" id="' + id + '" viewBox="0 0 479.25 119.75" width="100%" height="100%" role="img" aria-labelledby="' + id + '-title ' + id + '-desc">' +
    '<title id="' + id + '-title">Diagramme de test</title><desc id="' + id + '-desc">' + xml(source) + '</desc>' +
    '<style>#' + id + '{font-family:Arial,sans-serif}</style>' +
    '<defs><marker id="' + id + '-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6"><path d="M0 0L10 5L0 10Z"/></marker></defs>' +
    '<path d="M20 60L440 60" stroke="#24664d" marker-end="url(#' + id + '-arrow)"/><text x="20" y="35">' + xml(source) + '</text></svg>';
}

async function session({factory = H.freshFactory(), watch = false} = {}) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'Folio.html'), 'utf8');
  const vendor = /<script id="vendor-mermaid">[\s\S]*?<\/script>/;
  assert.match(html, vendor, 'The distributed HTML must include the offline Mermaid bundle');
  const engine = {
    calls: [], configurations: [], beforeRender: null,
    initialize(config) { this.configurations.push(config); },
    async render(id, source, container) {
      this.calls.push({id, source, container});
      if (this.beforeRender) await this.beforeRender(id, source, container);
      if (source.includes('INVALID_DIAGRAM')) throw new Error('Syntaxe Mermaid invalide : <img src="https://example.invalid/error" onerror="alert(1)">');
      if (source.includes('OVERSIZED_SVG')) return {svg: testSVG(id, 'x'.repeat(1024 * 1024))};
      return {svg: testSVG(id, source)};
    }
  };
  const copied = [];
  let chosen;
  const ctx = H.createSession(factory, {
    html: html.replace(vendor, '<script id="vendor-mermaid">/* Layout stub for DOM tests. */</script>'),
    beforeParse(win) {
      win.mermaid = engine;
      Object.defineProperty(win, 'isSecureContext', {value: true, configurable: true});
      Object.defineProperty(win.navigator, 'clipboard', {value: {writeText: async text => { copied.push(text); }}, configurable: true});
      if (watch) win.showOpenFilePicker = async () => [chosen];
    }
  });
  ctx.engine = engine; ctx.copied = copied; ctx.choose = handle => { chosen = handle; };
  sessions.push(ctx);
  await H.until(() => ctx.doc.getElementById('storage-status').dataset.state !== 'loading', 'initialization');
  assert.equal(typeof ctx.win.FolioRenderer.renderAsync, 'function');
  return ctx;
}

function svgText(img) {
  const value = img.getAttribute('src');
  assert.match(value, /^data:image\/svg\+xml(?:;charset=utf-8)?(?:;base64)?,/i);
  const comma = value.indexOf(',');
  return /;base64$/i.test(value.slice(0, comma)) ? Buffer.from(value.slice(comma + 1), 'base64').toString('utf8') : decodeURIComponent(value.slice(comma + 1));
}

async function exportDocument(ctx, all = false) {
  const previous = ctx.downloads.length;
  ctx.doc.getElementById(all ? 'export-collection' : 'export-toggle').click();
  await H.until(() => ctx.downloads.length > previous, 'HTML download');
  const download = ctx.downloads.at(-1), html = await download.blob.text();
  return {html, filename: download.filename, document: new ctx.win.DOMParser().parseFromString(html, 'text/html')};
}

function assertInert(root) {
  assert.equal(root.querySelectorAll('script,iframe,object,embed,svg,style').length, 0, 'Generated SVG remains in image context, outside the document DOM');
  for (const element of root.querySelectorAll('*')) {
    assert(!Array.from(element.attributes).some(attr => /^on/i.test(attr.name)), 'No event handler from diagram content');
  }
  for (const img of root.querySelectorAll('img')) assert.match(img.getAttribute('src') || '', /^data:image\/svg\+xml/i);
}

async function check(name, fn) {
  try { await fn(); tests.push({name, status: 'PASS'}); print('PASS ' + name); }
  catch (error) { tests.push({name, status: 'FAIL', message: error.stack || String(error)}); print('FAIL ' + name + ' — ' + error.message); }
}

module.exports = (async () => {
  await check('Blocs Mermaid : rendu asynchrone, plusieurs langages et source conservée', async () => {
    const ctx = await session();
    const markdown = ['# Diagrammes', fence('flowchart LR\n  A --> B'), fence('sequenceDiagram\n  Alice->>Bob: Bonjour', 'MeRmAiD'), fence('graph LR\n  X --> Y', 'text'), '`mermaid` reste du texte.'].join('\n\n');
    const plain = ctx.win.FolioRenderer.render(markdown);
    assert.equal(typeof plain.then, 'undefined', 'The existing synchronous renderer remains available');
    assert.equal(ctx.engine.calls.length, 0);
    const rendered = await ctx.win.FolioRenderer.renderAsync(markdown);
    assert.equal(rendered.diagramCount, 2);
    assert.deepEqual(Array.from(rendered.fragment.querySelectorAll('[data-folio-ref]'), node => node.localName), ['figure', 'figure', 'pre', 'p'], 'Each diagram is one stable block; its retained source is not numbered again');
    assert.equal(rendered.diagramWarnings.length, 0);
    assert.equal(rendered.fragment.querySelectorAll('.folio-mermaid img.mermaid-diagram').length, 2);
    for (const image of rendered.fragment.querySelectorAll('.mermaid-diagram')) {
      assert.equal(image.getAttribute('width'), '480', 'Image reserves the rounded-up viewBox width');
      assert.equal(image.getAttribute('height'), '120', 'Image reserves the rounded-up viewBox height');
      const svg = new ctx.win.DOMParser().parseFromString(svgText(image), 'image/svg+xml').documentElement;
      assert.equal(svg.getAttribute('width'), '480', 'Percentage SVG width becomes an intrinsic pixel width');
      assert.equal(svg.getAttribute('height'), '120', 'Percentage SVG height becomes an intrinsic pixel height');
      assert.equal(svg.getAttribute('viewBox'), '0 0 479.25 119.75', 'Original drawing coordinates remain intact');
    }
    assert.equal(rendered.fragment.querySelectorAll('.mermaid-source').length, 2);
    assert(Array.from(rendered.fragment.querySelectorAll('.mermaid-source')).every(details => !details.open));
    assert.equal(rendered.fragment.querySelectorAll('pre code.language-text').length, 1);
    assert.equal(ctx.engine.calls.length, 2);
    assert.notEqual(ctx.engine.calls[0].id, ctx.engine.calls[1].id, 'Every render has its own SVG namespace');
    assertInert(rendered.fragment);
    ctx.close();
  });

  await check('Code Mermaid littéral, caractères HTML et mathématiques voisines', async () => {
    const ctx = await session();
    const source = 'flowchart LR\n  A["A < B & $x$"] --> B["été"]';
    const rendered = await ctx.win.FolioRenderer.renderAsync('Une formule $E = mc^2$.\n\n' + fence(source));
    assert.equal(ctx.engine.calls[0].source.trimEnd(), source);
    assert.equal(rendered.fragment.querySelector('.mermaid-source pre code').textContent.trimEnd(), source);
    assert.equal(rendered.fragment.querySelectorAll('.katex').length, 1, 'Math parsing does not enter diagram source');
    assert.match(svgText(rendered.fragment.querySelector('.mermaid-diagram')), /&lt; B &amp; \$x\$/);
    assert.equal(rendered.mathWarnings.length, 0);
    ctx.close();
  });

  await check('Erreur isolée : source visible, message inerte et diagramme suivant rendu', async () => {
    const ctx = await session();
    const rendered = await ctx.win.FolioRenderer.renderAsync([fence('INVALID_DIAGRAM'), fence('flowchart TD\n A --> B')].join('\n\n'));
    assert.equal(rendered.diagramCount, 2);
    assert.equal(rendered.diagramWarnings.length, 1);
    assert.equal(rendered.fragment.querySelectorAll('.mermaid-error').length, 1);
    assert.equal(rendered.fragment.querySelectorAll('img.mermaid-diagram').length, 1);
    const failedSource = Array.from(rendered.fragment.querySelectorAll('.mermaid-source')).find(details => details.textContent.includes('INVALID_DIAGRAM'));
    assert(failedSource?.open, 'The source of a failed diagram is immediately visible');
    assert.match(rendered.fragment.textContent, /INVALID_DIAGRAM/);
    assertInert(rendered.fragment);
    ctx.close();
  });

  await check('Configuration Mermaid stricte et absence de HTML actif issu du source', async () => {
    const ctx = await session();
    const source = 'flowchart LR\n A["<img src=https://example.invalid/tracker onerror=alert(1)>"] --> B["<script>alert(1)</script>"]';
    const rendered = await ctx.win.FolioRenderer.renderAsync(fence(source));
    const config = ctx.engine.configurations.at(-1);
    assert(config, 'Folio initializes its bundled renderer');
    assert.equal(config.securityLevel, 'strict');
    assert.equal(config.startOnLoad, false);
    assert.equal(config.htmlLabels, false);
    assert.equal(config.arrowMarkerAbsolute, false, 'SVG arrows use local references that survive autonomous export');
    for (const key of ['securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'themeCSS', 'htmlLabels', 'arrowMarkerAbsolute']) assert(config.secure.includes(key), key + ' cannot be overridden by diagram config');
    assert.equal(rendered.fragment.querySelector('.mermaid-source pre code').textContent.trimEnd(), source);
    assertInert(rendered.fragment);
    assert.deepEqual(ctx.requests, []);
    ctx.close();
  });

  await check('Limites de diagrammes : nombre, longueur et volume cumulé gardent le source', async () => {
    const ctx = await session();
    let rendered = await ctx.win.FolioRenderer.renderAsync(fence('flowchart LR\n' + 'x'.repeat(16385)));
    assert.equal(rendered.diagramWarnings.length, 1);
    assert.equal(ctx.engine.calls.length, 0, 'Oversized definitions never reach the layout engine');
    assert(rendered.fragment.querySelector('.mermaid-source[open]'));
    rendered = await ctx.win.FolioRenderer.renderAsync(Array.from({length: 51}, () => fence('flowchart LR\n A --> B')).join('\n\n'));
    assert.equal(ctx.engine.calls.length, 50, 'No more than 50 diagrams are rendered per document');
    assert.equal(rendered.diagramWarnings.length, 1);
    const before = ctx.engine.calls.length;
    rendered = await ctx.win.FolioRenderer.renderAsync(Array.from({length: 9}, () => fence('flowchart LR\n' + 'x'.repeat(15000))).join('\n\n'));
    assert(ctx.engine.calls.length - before < 9, 'The total source budget is checked before layout');
    assert(rendered.diagramWarnings.length > 0);
    ctx.close();
  });

  await check('Mathématiques Mermaid : macros et commandes internes refusées avant le moteur', async () => {
    const ctx = await session();
    const formulas = [
      String.raw`\def\foo{EXPANDED}\foo`,
      String.raw`\\newcommand{\\foo}{EXPANDED}\\foo`,
      String.raw`\html@mathml{a}{b}`,
      '&#92;def&#92;foo{EXPANDED}&#92;foo',
      '&bsol;def&bsol;foo{EXPANDED}&bsol;foo',
      '#92;def#92;foo{EXPANDED}#92;foo',
      '&amp;#92;def&amp;#92;foo{EXPANDED}&amp;#92;foo'
    ];
    const sources = formulas.map(formula => 'sequenceDiagram\nA->>B: $$' + formula + '$$');
    // Odd delimiters in another label must not shift the guard's pairing.
    sources.push(String.raw`flowchart LR
 A["$$"] --> B["$$\def\foo{EXPANDED}\foo$$"]`);
    sources.push('sequenceDiagram\nA->>B: &#36;&#36;&#92;def&#92;foo{EXPANDED}&#92;foo&#36;&#36;');
    const valid = String.raw`sequenceDiagram
A->>B: $$\frac{1}{2}$$`;
    const rendered = await ctx.win.FolioRenderer.renderAsync([...sources, valid].map(source => fence(source)).join('\n\n'));
    assert.equal(rendered.diagramWarnings.length, sources.length);
    assert.equal(ctx.engine.calls.length, 1, 'Rejected formulas never reach Mermaid’s internal KaTeX instance');
    assert.equal(ctx.engine.calls[0].source.trimEnd(), valid);
    assert.equal(rendered.fragment.querySelectorAll('.mermaid-source[open]').length, sources.length);
    assert.equal(rendered.fragment.querySelectorAll('.mermaid-diagram').length, 1, 'A later valid diagram still renders');
    const retained = Array.from(rendered.fragment.querySelectorAll('.mermaid-source pre code'), node => node.textContent.trimEnd());
    assert.deepEqual(retained, [...sources, valid], 'The guard never rewrites the original diagram text');
    ctx.close();
  });

  await check('SVG trop volumineux : repli local et poursuite de la lecture', async () => {
    const ctx = await session();
    const rendered = await ctx.win.FolioRenderer.renderAsync(fence('OVERSIZED_SVG') + '\n\n' + fence('flowchart LR\n A --> B'));
    assert.equal(rendered.diagramWarnings.length, 1);
    assert.equal(rendered.fragment.querySelectorAll('.mermaid-diagram').length, 1);
    assert.match(rendered.fragment.querySelector('.mermaid-source[open]').textContent, /OVERSIZED_SVG/);
    ctx.close();
  });

  await check('Import, mode Source et copie du code Mermaid dans la lecture', async () => {
    const ctx = await session();
    const source = 'flowchart LR\n A[Entrée] --> B[Sortie]';
    const markdown = '# Lecture\n\n' + fence(source);
    await H.imports(ctx, [H.file(ctx, 'diagramme.md', markdown)]);
    const image = ctx.doc.querySelector('#article .mermaid-diagram');
    assert(image); assert.match(svgText(image), /Entrée/);
    const code = ctx.doc.querySelector('#article .mermaid-source pre code');
    ctx.doc.querySelector('#article .mermaid-source .copy-code').click();
    await H.until(() => ctx.copied.length === 1, 'source copied');
    assert.equal(ctx.copied[0], code.textContent);
    ctx.doc.getElementById('source-toggle').click();
    assert.equal(ctx.doc.getElementById('source-view').textContent, markdown);
    assert.equal(ctx.doc.getElementById('source-view').hidden, false);
    ctx.doc.getElementById('source-toggle').click();
    assert.equal(ctx.doc.querySelectorAll('#article .mermaid-diagram').length, 1);
    assert.equal(ctx.engine.calls.length, 1, 'Switching source/reading does not render again');
    ctx.close();
  });

  await check('Import asynchrone : téléchargement disponible une fois le diagramme prêt', async () => {
    const ctx = await session();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    ctx.engine.beforeRender = () => gate;
    const importing = H.imports(ctx, [H.file(ctx, 'attendre.md', '# Attendre\n\n' + fence('flowchart LR\n A --> B'))]);
    await H.until(() => ctx.engine.calls.length === 1, 'diagram rendering started');
    assert.equal(ctx.doc.getElementById('busy-indicator').hidden, false);
    assert.equal(ctx.doc.getElementById('export-toggle').disabled, true);
    assert.equal(ctx.doc.getElementById('print-doc').disabled, true, 'Printing must not target an intermediate source view');
    release(); await importing;
    assert.equal(ctx.doc.getElementById('export-toggle').disabled, false);
    assert.equal(ctx.doc.getElementById('print-doc').disabled, false);
    assert.equal(ctx.doc.querySelectorAll('#article .mermaid-diagram').length, 1);
    ctx.close();
  });

  await check('Exports individuels et collection : SVG autonomes et références internes préservées', async () => {
    const ctx = await session();
    await H.imports(ctx, [H.file(ctx, 'a.md', '# Premier\n\n' + fence('flowchart LR\n A --> B')), H.file(ctx, 'b.md', '# Second\n\n' + fence('sequenceDiagram\n A->>B: Bonjour'))]);
    const original = svgText(ctx.doc.querySelector('#article .mermaid-diagram'));
    const single = await exportDocument(ctx);
    assert.equal(single.document.querySelectorAll('.mermaid-diagram').length, 1);
    assert.equal(svgText(single.document.querySelector('.mermaid-diagram')), original, 'Heading prefixing must not change IDs inside SVG images');
    assert.equal(single.document.querySelectorAll('script').length, 0, 'Single-document export needs no execution engine');
    const collection = await exportDocument(ctx, true);
    assert.equal(collection.document.querySelectorAll('.mermaid-diagram').length, 2);
    assert.equal(collection.document.querySelectorAll('script').length, 1, 'Only the existing tab-navigation runtime is exported');
    assert.equal(collection.document.querySelectorAll('script[src],link[href^="http"],img[src^="http"]').length, 0);
    for (const image of collection.document.querySelectorAll('.mermaid-diagram')) {
      const svg = new ctx.win.DOMParser().parseFromString(svgText(image), 'image/svg+xml');
      assert.equal(svg.querySelectorAll('parsererror').length, 0);
      const marker = svg.querySelector('[marker-end]').getAttribute('marker-end').match(/^url\(#(.+)\)$/)[1];
      assert(svg.getElementById(marker), 'The arrow still references its embedded SVG marker');
      for (const id of svg.documentElement.getAttribute('aria-labelledby').split(/\s+/)) assert(svg.getElementById(id));
    }
    assert.equal(ctx.engine.calls.length, 2, 'Exports use the rendered images without running Mermaid again');
    ctx.close();
  });

  await check('Réimport : le nouveau diagramme remplace la version affichée et exportée', async () => {
    const ctx = await session();
    await H.imports(ctx, [H.file(ctx, 'suivi.md', '# Version un\n\n' + fence('flowchart LR\n A[Ancien] --> B'))]);
    const oldSVG = svgText(ctx.doc.querySelector('#article .mermaid-diagram'));
    await H.imports(ctx, [H.file(ctx, 'suivi.md', '# Version deux\n\n' + fence('flowchart LR\n A[Nouveau] --> B'))]);
    assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length, 1);
    const newSVG = svgText(ctx.doc.querySelector('#article .mermaid-diagram'));
    assert.notEqual(newSVG, oldSVG); assert.match(newSVG, /Nouveau/);
    const exported = await exportDocument(ctx);
    assert.equal(svgText(exported.document.querySelector('.mermaid-diagram')), newSVG);
    ctx.close();
  });

  await check('Mémorisation : seul le Markdown est conservé, le diagramme est reconstruit à la restauration', async () => {
    const factory = H.freshFactory(), first = await session({factory});
    const markdown = '# À retrouver\n\n' + fence('flowchart LR\n A --> B');
    await H.imports(first, [H.file(first, 'memoire.md', markdown)]);
    first.doc.getElementById('remember-collection').click();
    await H.until(() => first.doc.getElementById('storage-status').dataset.state === 'saved', 'collection saved');
    const record = await first.win.FolioStorage.read();
    assert.equal(record.snapshot.docs[0].content, markdown);
    assert.doesNotMatch(JSON.stringify(record.snapshot), /data:image\/svg\+xml/);
    first.close();
    const restored = await session({factory});
    assert.equal(H.activeTab(restored).title, 'memoire.md');
    assert.equal(restored.engine.calls.length, 1);
    assert.equal(restored.doc.querySelectorAll('#article .mermaid-diagram').length, 1);
    restored.close();
  });

  await check('Suivi interrompu pendant un rendu Mermaid : aucune mise à jour tardive', async () => {
    const ctx = await session({watch: true});
    const original = '# Original\n\n' + fence('flowchart LR\n A --> B');
    await H.imports(ctx, [H.file(ctx, 'original.md', original)]);
    const model = {content: original, modified: 1};
    const handle = {kind:'file', name:'original.md', async queryPermission(){return 'granted';}, async requestPermission(){return 'granted';}, async getFile(){return new ctx.win.File([model.content], 'original.md', {type:'text/markdown', lastModified:model.modified});}};
    ctx.choose(handle); ctx.doc.getElementById('watch-toggle').click();
    await H.until(() => ctx.doc.getElementById('watch-status').dataset.state === 'watching', 'watch linked');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    ctx.engine.beforeRender = (id, source) => source.includes('Tardif') ? gate : undefined;
    model.content = '# Tardif\n\n' + fence('flowchart LR\n A[Tardif] --> B'); model.modified++;
    const pending = ctx.win.FolioWatcher.checkNow(H.activeTab(ctx).dataset.docId);
    await H.until(() => ctx.engine.calls.some(call => call.source.includes('Tardif')), 'watched Mermaid layout started');
    ctx.doc.getElementById('watch-toggle').click(); release();
    assert.equal(await pending, false);
    await H.delay(20);
    assert.equal(ctx.doc.querySelector('#article h1').textContent, 'Original');
    assert.doesNotMatch(svgText(ctx.doc.querySelector('#article .mermaid-diagram')), /Tardif/);
    ctx.close();
  });

  for (const ctx of sessions) {
    if (ctx.errors.length || ctx.requests.length) tests.push({name:'Aucun réseau ni erreur JavaScript dans les scénarios Mermaid', status:'FAIL', message:[...ctx.errors, ...ctx.requests].join('\n')});
    ctx.close();
  }
  fs.mkdirSync(outputDir, {recursive: true});
  const report = {generatedAt:new Date().toISOString(), type:'mermaid-dom', passed:tests.filter(test => test.status === 'PASS').length, total:tests.length, tests,
    limitations:['Tests d’intégration DOM avec jsdom et IndexedDB simulé. Le moteur de disposition Mermaid est remplacé par un générateur SVG déterministe.', 'La géométrie des diagrammes, leur lisibilité, les téléchargements natifs et l’impression doivent être vérifiés dans un véritable navigateur avec le bundle officiel.']};
  fs.writeFileSync(path.join(outputDir, 'rapport-mermaid.json'), JSON.stringify(report, null, 2));
  print(JSON.stringify(report, null, 2));
  process.exitCode = report.passed === report.total ? 0 : 1;
})().catch(error => { for (const ctx of sessions) ctx.close(); console.error(error.stack || error); process.exitCode = 1; });
