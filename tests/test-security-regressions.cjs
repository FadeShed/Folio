'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {JSDOM, VirtualConsole, requestInterceptor} = require('jsdom');
const {freshFactory, createSession, file, imports, until, imagePNG} = require('./storage-harness.cjs');
const root = path.resolve(__dirname, '..');
const outputDir = path.join(__dirname, 'output');
fs.mkdirSync(outputDir, {recursive:true});
const tests = [], measurements = [], sessions = [];
const print = (...args) => { if (require.main === module) console.log(...args); };

function rendererSession() {
  const errors = [], requests = [], console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url:'https://folio.test/Folio.html', runScripts:'outside-only', virtualConsole:console,
    resources:{interceptors:[requestInterceptor(request => { requests.push(request.url); return Promise.resolve(new Response('')); })]}
  });
  for (const source of ['vendor/vendor.js','vendor/math-vendor.js','src/renderer.js']) dom.window.eval(fs.readFileSync(path.join(root, source), 'utf8'));
  return {dom, win:dom.window, doc:dom.window.document, errors, requests, close(){dom.window.close();}};
}
function boundedRender(ctx, source, timeout=8000) {
  ctx.win.__securitySource = source;
  try { return vm.runInContext('FolioRenderer.render(__securitySource)', ctx.dom.getInternalVMContext(), {timeout}); }
  finally { delete ctx.win.__securitySource; }
}
function assertLimit(ctx, source, limit) {
  assert.throws(() => boundedRender(ctx, source), error => {
    assert.equal(error.name, 'FolioRenderError');
    assert.equal(error.code, 'render_limit');
    assert.equal(error.limit, limit);
    assert.match(error.message, /limite|trop/i);
    assert(!error.message.includes('Please report this'));
    return true;
  });
}
async function check(name, run) {
  try { await run(); tests.push({name,status:'PASS'}); print('PASS '+name); }
  catch (error) { tests.push({name,status:'FAIL',message:error.stack || String(error)}); print('FAIL '+name+' — '+error.message); }
}
function activeContent(root) {
  return [...root.querySelectorAll('*')].filter(node =>
    ['script','iframe','object','embed','style','link','form'].includes(node.localName)
    || [...node.attributes].some(attr => /^on/i.test(attr.name) || ['srcdoc','srcset','name'].includes(attr.name))
    || node.localName === 'a' && /^(javascript|data|vbscript|file):/i.test(node.getAttribute('href') || ''));
}

module.exports = (async () => {
  const ctx = rendererSession(); sessions.push(ctx);
  await check('Délimiteurs non fermés : lecture bornée et erreur avant blocage du thread', () => {
    const start = performance.now();
    const small = boundedRender(ctx, '\\('.repeat(64000));
    assert.equal(small.mathCount, 0);
    assert(small.fragment.textContent.trimEnd() === '('.repeat(64000), 'Escaped parentheses must remain literal text');
    const smallMs = performance.now() - start;
    const largeStart = performance.now();
    assertLimit(ctx, '\\('.repeat(256000), 'parser_steps');
    measurements.push({scenario:'unclosed-math',bytes:128000,ms:Math.round(smallMs),largeBytes:512000,largeMs:Math.round(performance.now()-largeStart)});
  });

  await check('Ancres répétées : 16 000 IDs uniques sans reparcourir les suffixes précédents', () => {
    const start = performance.now();
    const result = boundedRender(ctx, '<span id="same">x</span>'.repeat(16000));
    const ids = [...result.fragment.querySelectorAll('span[id]')].map(node => node.id);
    assert.equal(ids.length, 16000); assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids[0], 'folio-anchor-same'); assert.equal(ids.at(-1), 'folio-anchor-same-15999');
    assert.equal(ctx.win.FolioRenderer.resolveAnchor(result, '#same'), ids[0]);
    measurements.push({scenario:'duplicate-anchors',bytes:384000,ms:Math.round(performance.now()-start),elements:result.elementCount});
    const collision = boundedRender(ctx, '<a id="x-1"></a><a id="x"></a><a id="x"></a><a id="x-1"></a>\n\n# Été\n\n# Ete\n\n# Été');
    const collisionIds = [...collision.fragment.querySelectorAll('[id]')].map(node => node.id);
    assert.equal(new Set(collisionIds).size, collisionIds.length);
  });

  await check('Indices de début math : paragraphes longs, sources imbriquées et formules successives', () => {
    const source = ('ordinary text '.repeat(20)+'\n\n').repeat(5000)+'\n$$x$$\n';
    const start = performance.now(), result = boundedRender(ctx, source);
    assert.equal(result.mathCount, 1); assert.equal(result.fragment.querySelectorAll('p').length, 5000);
    measurements.push({scenario:'paragraphs-before-final-formula',bytes:Buffer.byteLength(source),ms:Math.round(performance.now()-start)});
    const nested = '# T $x$\n\n- alpha $a$\n- *bravo $b$*\n\n> gamma \\(c\\)\n\npara\n\n$$d$$\n\n*e* $f$\n';
    assert.equal(boundedRender(ctx, nested).mathCount, 6);
    assert.equal(boundedRender(ctx, '$a$ and $b$ and \\(c\\)\n\n\\[d\\]\n\n$$e$$').mathCount, 5);
    // Marked reuses a blockquote token array across independent lazy-line
    // continuations. A cache keyed only by that array hides the later formula.
    const continuation = '> '+'Long ordinary text '.repeat(8)+'\nlazy continuation\n> \\[x\\]';
    assert.equal(boundedRender(ctx, continuation).mathCount, 1);
  });

  await check('Code Markdown et HTML : math littérale, y compris code imbriqué et balise non fermée', () => {
    for (const source of ['`$x$`','```latex\n$x$\n```','    $x$','<code>$x$</code>','<pre><code>$x$</code></pre>','<code class="x"><span>$x$</span></code>','<code>$unclosed']) {
      const result = boundedRender(ctx, source);
      assert.equal(result.mathCount, 0, source);
      assert.equal(result.fragment.querySelectorAll('.katex').length, 0, source);
      assert(result.fragment.textContent.includes('$'), source);
    }
    const mixed = boundedRender(ctx, '<code>$unclosed</code> then $x$');
    assert.equal(mixed.mathCount, 1); assert.equal(mixed.fragment.querySelector('code').textContent, '$unclosed');
  });

  await check('Limites de formules avant KaTeX : nombre, taille individuelle et cumul', () => {
    const original = ctx.win.katex.renderToString; let calls = 0;
    ctx.win.katex.renderToString = (...args) => { calls++; return original(...args); };
    try {
      assertLimit(ctx, '$x$ '.repeat(1001), 'math_count');
      assertLimit(ctx, '$'+'x'.repeat(16385)+'$', 'math_length');
      assertLimit(ctx, ('$'+'x'.repeat(16384)+'$ ').repeat(9), 'math_total');
      assert.equal(calls, 0, 'All preflight limits must run before formula expansion');
    } finally { ctx.win.katex.renderToString = original; }
  });

  await check('Limites UTF-8, balises avant DOM et profondeur du document', () => {
    assert(Object.isFrozen(ctx.win.FolioRenderer.limits));
    assertLimit(ctx, 'é'.repeat(5*1024*1024/2+1), 'source_bytes');
    assertLimit(ctx, '<br>'.repeat(80001), 'nodes');
    assertLimit(ctx, '<div>'.repeat(129)+'x'+'</div>'.repeat(129), 'depth');
  });

  await check('Le budget DOM comprend les nœuds générés par les formules', () => {
    assertLimit(ctx, ('$'+'x'.repeat(12000)+'$ ').repeat(2), 'nodes');
  });

  await check('Macro expansive : source de 418 caractères conservée en texte avant expansion', () => {
    const formula = '\\def\\a{'+'x'.repeat(256)+'}\\def\\b{'+'\\a'.repeat(64)+'}'+'\\b'.repeat(8);
    const start = performance.now(), result = boundedRender(ctx, '$'+formula+'$');
    assert.equal(formula.length+2, 418);
    assert.equal(result.mathWarnings.length, 1);
    assert.match(result.mathWarnings[0].message, /conservée en texte/);
    assert.equal(result.fragment.querySelector('.folio-math-error').textContent, formula);
    assert(result.nodeCount < 10);
    measurements.push({scenario:'nested-macro-expansion',bytes:418,ms:Math.round(performance.now()-start),nodes:result.nodeCount});
    for (const command of ['def','gdef','edef','xdef','let','futurelet','newcommand','renewcommand','providecommand','global','long','df@tag']) {
      const blocked = boundedRender(ctx, '$\\'+command+'{x}$');
      assert.match(blocked.mathWarnings[0].message, /conservée en texte/, command);
    }
  });

  await check('KaTeX usuel conservé : intégrale, matrice, tag, commentaire et verb littéral', () => {
    const source = String.raw`$\int_0^1 x^2\,dx=\frac13$ $\begin{pmatrix}a&b\\c&d\end{pmatrix}$

$$x=1\tag{A}$$

$\verb|\def\a{x}|$

$$x % \def ignored in this comment
+y$$`;
    const result = boundedRender(ctx, source);
    assert.equal(result.mathCount, 5); assert.equal(result.mathWarnings.length, 0);
    assert.equal(result.fragment.querySelectorAll('.katex').length, 5);
  });

  await check('Mesures de rendu : majorant UTF-8 utilisable avant clonage et export', () => {
    const result = boundedRender(ctx, '# Été & "id"\n\n<abbr title="&quot;&lt;&gt;&amp;">é 😀 </abbr> $\\frac{x}{2}$\n\n![x](tiny.png)\n\n<table><tr><td>&amp;</td></tr></table>');
    const host = ctx.doc.createElement('div'); host.append(result.fragment.cloneNode(true));
    assert.equal(result.elementCount, host.querySelectorAll('*').length);
    assert(result.nodeCount > result.elementCount);
    assert(result.htmlByteLength >= Buffer.byteLength(host.innerHTML));
  });

  await check('Charge hostile : HTML nettoyé, URL actives refusées, aucune ressource distante après reparsing', () => {
    const payloads = [
      '<script>window.__securityXSS=1</script><img src="https://example.invalid/x" onerror="window.__securityXSS=2">',
      '<svg onload="window.__securityXSS=3"><foreignObject><img src=x onerror="window.__securityXSS=4"></foreignObject></svg>',
      '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=window.__securityXSS=5>">',
      '<noscript><p title="</noscript><img src=x onerror=window.__securityXSS=6>">',
      '<template><img src="https://example.invalid/t" onerror="window.__securityXSS=7"></template>',
      '<a id="article" name="FolioRenderer" href="javascript:window.__securityXSS=8">x</a><input type=image src="https://example.invalid/i">',
      '<a href="java&#10;script:window.__securityXSS=9">x</a><a href="data:text/html;base64,PHNjcmlwdD4=">y</a>',
      '<iframe srcdoc="<script>window.__securityXSS=10</script>"></iframe><object data="https://example.invalid/o"></object>',
      '<div data-folio-math-token="forged"><img data-folio-src="data:image/svg+xml,bad" srcset="https://example.invalid/s 1x"></div>',
      '$\\href{javascript:window.__securityXSS=11}{click}$ $\\includegraphics{https://example.invalid/m}$ $\\htmlStyle{position:fixed}{x}$',
      '$\\text{</title><script>window.__securityXSS=12</script>}$',
      '<style>@import "https://example.invalid/css"</style><link rel=stylesheet href="https://example.invalid/l">'
    ];
    for (const source of payloads) {
      const result = boundedRender(ctx, source), host = ctx.doc.createElement('div'); host.append(result.fragment);
      assert.equal(activeContent(host).length, 0); assert.equal(host.querySelectorAll('img[src]').length, 0);
      const reparsed = new JSDOM('<!doctype html>'+host.innerHTML, {runScripts:'dangerously',virtualConsole:new VirtualConsole(),
        resources:{interceptors:[requestInterceptor(request => {ctx.requests.push(request.url); return Promise.resolve(new Response(''));})]}});
      try { assert.equal(activeContent(reparsed.window.document).length, 0); assert.equal(reparsed.window.__securityXSS, undefined); }
      finally { reparsed.window.close(); }
    }
    assert.equal(ctx.requests.length, 0); assert.equal(ctx.errors.length, 0);
  });

  await check('Extension constructor ignorée ; collection mémorisée puis restaurée sans corruption', async () => {
    const factory = freshFactory(), app = createSession(factory); sessions.push(app);
    await until(() => app.doc.getElementById('storage-status').dataset.state === 'off', 'empty storage');
    await imports(app, [file(app,'safe.md','# Document conservé'),file(app,'payload.constructor','unexpected')]);
    app.doc.getElementById('remember-collection').click();
    await until(() => app.doc.getElementById('storage-status').dataset.state === 'saved', 'saved collection');
    const saved = await app.win.FolioStorage.read();
    assert.equal(saved.snapshot.assets.length, 0); assert.equal(saved.snapshot.docs.length, 1); app.close();
    const restored = createSession(factory); sessions.push(restored);
    await until(() => restored.doc.querySelector('#article h1'), 'collection restored');
    assert.equal(restored.doc.querySelector('#article h1').textContent, 'Document conservé');
    assert.equal(restored.doc.getElementById('storage-status').dataset.state, 'saved'); restored.close();
  });

  await check('Réimport rejeté par le budget : la dernière version valide reste disponible', async () => {
    const app = createSession(freshFactory()); sessions.push(app);
    await until(() => app.doc.getElementById('storage-status').dataset.state === 'off', 'empty storage');
    await imports(app, [file(app,'safe.md','# Dernière version valide')]);
    await imports(app, [file(app,'safe.md','$x$ '.repeat(1001))]);
    assert.equal(app.doc.querySelectorAll('[role="tab"]').length, 1);
    assert.equal(app.doc.querySelector('#article h1').textContent, 'Dernière version valide');
    assert.match(app.doc.getElementById('toast-message').textContent, /1 000|formules/);
    app.doc.getElementById('source-toggle').click();
    assert.equal(app.doc.getElementById('source-view').textContent, '# Dernière version valide'); app.close();
  });

  await check('Image répétée : export supérieur à 80 Mio refusé avant clonage et téléchargement', async () => {
    const app = createSession(freshFactory()); sessions.push(app);
    await until(() => app.doc.getElementById('storage-status').dataset.state === 'off', 'empty storage');
    const image = Buffer.alloc(1024*1024); imagePNG.copy(image);
    await imports(app, [file(app,'repeat.md','# Images\n\n'+('![pixel](pixel.png)\n\n').repeat(64)),file(app,'pixel.png',image)]);
    const clone = app.win.Node.prototype.cloneNode; let clones = 0;
    app.win.Node.prototype.cloneNode = function(...args){clones++; return clone.apply(this,args);};
    try {
      app.doc.getElementById('export-toggle').click();
      await until(() => !app.doc.getElementById('export-toggle').disabled, 'export budget checked');
    }
    finally { app.win.Node.prototype.cloneNode = clone; }
    assert.equal(app.downloads.length, 0); assert.equal(clones, 0);
    assert.match(app.doc.getElementById('toast-message').textContent, /80 Mio/); app.close();
  });

  await check('Sélections et chemins excessifs refusés avant lecture du contenu', async () => {
    const app = createSession(freshFactory()); sessions.push(app);
    await until(() => app.doc.getElementById('storage-status').dataset.state === 'off', 'empty storage');
    const item = file(app,'safe.md','# Texte'); let reads = 0;
    item.arrayBuffer = async () => {reads++; throw new Error('Unexpected file read');};
    await imports(app, Array(3001).fill(item));
    assert.equal(reads, 0); assert.equal(app.doc.querySelectorAll('[role="tab"]').length, 0);
    assert.match(app.doc.getElementById('toast-message').textContent, /3 000/);
    await imports(app, [file(app,'x'.repeat(4097)+'.md','# Texte')]);
    assert.equal(app.doc.querySelectorAll('[role="tab"]').length, 0);
    assert.match(app.doc.getElementById('toast-message').textContent, /chemin.*long/i); app.close();
  });

  for (const session of sessions) {
    if (session.requests.length || session.errors.length) tests.push({name:'Aucun réseau ni erreur JS dans une session sécurité',status:'FAIL',message:[...session.requests,...session.errors].join('\n')});
    session.close();
  }
  const report = {generatedAt:new Date().toISOString(),type:'security-regressions',passed:tests.filter(test=>test.status==='PASS').length,total:tests.length,tests,measurements,
    limitations:['DOM exécuté avec jsdom et IndexedDB simulé ; pas de validation dans un navigateur natif.','Les délais VM bornent les cas pathologiques ; les temps mesurés ne sont pas des objectifs de performance multi-appareils.','CSP, décodeurs d’images et polices ne sont pas exécutés comme dans un vrai navigateur ; ces tests ne prouvent pas l’absence universelle de XSS.']};
  fs.writeFileSync(path.join(outputDir,'rapport-security-regressions.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(outputDir,'rapport-security-regressions.txt'),[`Régressions sécurité : ${report.passed}/${report.total}`,...tests.map(test=>test.status+' — '+test.name+(test.message?'\n'+test.message:'')),'','Limites :',...report.limitations.map(item=>'- '+item)].join('\n'));
  print(JSON.stringify(report,null,2)); process.exitCode = report.passed === report.total ? 0 : 1;
})().catch(error => {for (const session of sessions)session.close(); console.error(error.stack); process.exitCode=1;});
