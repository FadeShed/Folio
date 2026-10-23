'use strict';
const print=(...args)=>{if(require.main===module)console.log(...args);};
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const outputDir=path.join(__dirname,'output');
fs.mkdirSync(outputDir,{recursive:true});
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');
const root = path.resolve(__dirname,'..');
const reports = [], bugs = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(test, reason) { for(let n=0;n<150;n++){if(test())return;await delay(10);}throw new Error('Timeout: '+reason); }
function createDOM(html, url='https://folio.test/Folio.html') {
  const errors=[],warnings=[],requests=[],downloads=[],blobs=new Map(),scrollTargets=[];
  const virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>errors.push(error.message));
  virtualConsole.on('error',(...args)=>errors.push(args.join(' ')));
  virtualConsole.on('warn',(...args)=>warnings.push(args.join(' ')));
  const dom=new JSDOM(html,{url,runScripts:'dangerously',resources:{interceptors:[requestInterceptor(request=>{requests.push(request.url);return Promise.resolve(new Response('',{status:200}));})]},pretendToBeVisual:true,virtualConsole,beforeParse(win){
    win.TextDecoder=TextDecoder;win.TextEncoder=TextEncoder;
    win.matchMedia=q=>({matches:false,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
    win.Element.prototype.scrollIntoView=function(){scrollTargets.push(this.id||this.tagName);};
    win.scrollTo=()=>{};win.print=()=>{};
    win.File.prototype.arrayBuffer=function(){return new Promise((resolve,reject)=>{const reader=new win.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsArrayBuffer(this);});};
    win.Blob.prototype.text=function(){return new Promise((resolve,reject)=>{const reader=new win.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(this);});};
    win.URL.createObjectURL=blob=>{const id='blob:folio-qa-'+blobs.size;blobs.set(id,blob);return id;};
    win.URL.revokeObjectURL=()=>{};
    const click=win.HTMLAnchorElement.prototype.click;
    win.HTMLAnchorElement.prototype.click=function(){if(this.download){downloads.push({filename:this.download,blob:blobs.get(this.href)});return;}return click.call(this);};
    if(!win.HTMLDialogElement.prototype.showModal)win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
    if(!win.HTMLDialogElement.prototype.close)win.HTMLDialogElement.prototype.close=function(){this.open=false;};
    win.fetch=(...args)=>{requests.push('fetch: '+String(args[0]));throw new Error('Network forbidden in QA');};
    win.navigator.sendBeacon=(...args)=>{requests.push('beacon: '+String(args[0]));return false;};
  }});
  return {dom,win:dom.window,doc:dom.window.document,errors,warnings,requests,downloads,scrollTargets};
}
function file(ctx,name,content,relativePath) {
 const f=new ctx.win.File([content],name,{type:/\.png$/.test(name)?'image/png':'text/markdown'});
 if(relativePath)Object.defineProperty(f,'webkitRelativePath',{value:relativePath});
 return f;
}
async function imports(ctx,files,folder=false){
 const input=ctx.doc.getElementById(folder?'folder-input':'file-input');
 Object.defineProperty(input,'files',{configurable:true,value:files});
 input.dispatchEvent(new ctx.win.Event('change',{bubbles:true}));
 await until(()=>ctx.doc.getElementById('busy-indicator').hidden,'import completed');
 await delay(35);
}
function activeTab(ctx){return ctx.doc.querySelector('[role="tab"][aria-selected="true"]');}
function selectByTitle(ctx,title){const t=[...ctx.doc.querySelectorAll('[role="tab"]')].find(n=>n.title===title);assert(t,'Missing tab '+title);t.click();return t;}
function capture(ctx){return {errorCount:ctx.errors.length,requests:[...ctx.requests]};}
async function check(name,fn){try{await fn();reports.push({name,status:'PASS'});}catch(error){reports.push({name,status:'FAIL',message:error.stack||String(error)});bugs.push({name,message:String(error.message||error)});}}
module.exports=(async()=>{
const ctx=createDOM(fs.readFileSync(path.join(root,'Folio.html'),'utf8'));
await delay(30);
await check('Initialisation autonome, état vide et absence d’erreur JS',()=>{
 assert.equal(ctx.errors.length,0,ctx.errors.join('\n'));assert.equal(ctx.doc.getElementById('welcome').hidden,false);assert.equal(ctx.doc.getElementById('doc-count').textContent,'0');assert.equal(ctx.requests.length,0);
});
await check('Exemples intégrés : trois documents, tableau et cases à cocher',async()=>{
 ctx.doc.getElementById('load-demo').click();await until(()=>ctx.doc.getElementById('busy-indicator').hidden,'demo imported');await delay(35);
 assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length,3);
 assert.equal(ctx.doc.querySelector('#article h1').textContent,'Vos idées, au clair');
 assert.equal(ctx.doc.querySelectorAll('#article table').length,1);
 assert.equal(ctx.doc.querySelectorAll('#article input[type="checkbox"]').length,4);
 assert([...ctx.doc.querySelectorAll('#article input')].every(e=>e.disabled));
});
await check('Mathématiques : KaTeX embarqué, délimiteurs et navigation de démonstration',async()=>{
 const link=ctx.doc.querySelector('#article a[href^="Mathematiques"]');assert(link);link.click();await delay(35);
 assert.equal(activeTab(ctx).title,'Mathematiques.md');assert.equal(ctx.doc.querySelectorAll('#article .katex').length,6);
 assert(ctx.scrollTargets.includes('folio-h-une-integrale'));assert.equal(ctx.doc.querySelectorAll('#article .katex-error').length,0);
});
await check('Navigation clavier des onglets et focus',()=>{
 const current=activeTab(ctx);current.focus();current.dispatchEvent(new ctx.win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
 assert.equal(activeTab(ctx).title,'Mode-emploi.md');assert.equal(ctx.doc.activeElement,activeTab(ctx));
 activeTab(ctx).dispatchEvent(new ctx.win.KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert.equal(activeTab(ctx).title,'Bienvenue.md');
});
ctx.doc.getElementById('confirm-clear').click();
const source=String.raw`# Accueil été

## Déjà vu — été

[Guide](../guide.md#installation-1)

[Ancre locale](#deja-vu--ete)

[Ancre HTML](#custom)

[Ambigu](manual.md)

[Externe](https://example.invalid/article)

![Pixel local](images/pixel.png)

![Pixel distant](https://example.invalid/tracking.png)

<img src="https://example.invalid/raw.png" onerror="window.__folio_xss=true">
<script>window.__folio_xss=true</script>
<iframe src="https://example.invalid/iframe"></iframe>
<form id="app"><input name="render"></form>
<svg onload="window.__folio_xss=true"><script>window.__folio_xss=true</script></svg>
<a href="javascript:window.__folio_xss=true">Lien piégé</a>
<a id="custom">Destination personnalisée</a>

Une formule $E=mc^2$ et \(a^2+b^2=c^2\).

$$
\frac{1}{2} + \int_0^1 x\,dx = 1
$$

\[\begin{pmatrix}1&2\\3&4\end{pmatrix}\]

Code en ligne : §$code$§.

~~~html
</script><script>window.__folio_xss=true</script>
$code$
~~~

| Nom | Valeur |
| --- | ---: |
| α | 42 |

- [x] Fait
- [ ] À faire
`.replaceAll('§',String.fromCharCode(96));
await check('Import multiple avec chemins, image locale et fichiers ignorés',async()=>{
 await imports(ctx,[
 file(ctx,'index.md',source,'notes/index.md'),
 file(ctx,'guide.md','# Guide\n\n## Installation\n\nPremière.\n\n## Installation\n\nDeuxième.\n\n[Retour](notes/index.md#deja-vu--ete)','guide.md'),
 file(ctx,'manual.md','# Manuel A','a/manual.md'),file(ctx,'manual.md','# Manuel B','b/manual.md'),
 file(ctx,'pixel.png',png,'notes/images/pixel.png'),file(ctx,'ignore.txt','ignoré')
 ],true);
 assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length,4);assert.equal(ctx.doc.getElementById('doc-count').textContent,'4');
 assert.equal(activeTab(ctx).title,'notes/index.md');assert(ctx.doc.getElementById('toast-message').textContent.includes('non pris en charge'));
 assert(ctx.doc.querySelector('#article img[src^="data:image/png;base64,"]'));
});
await check('Sécurité : XSS, protocoles actifs, clobbering et ressources distantes',()=>{
 assert.equal(ctx.win.__folio_xss,undefined);assert.equal(ctx.doc.querySelectorAll('#article script,#article iframe,#article form,#article svg').length,2,'Only SVG icons inside image placeholders expected');
 assert.equal(ctx.doc.querySelectorAll('#article [onerror],#article [onload],#article a[href^="javascript:"],#article [name]').length,0);
 assert.equal(ctx.doc.querySelectorAll('#article img[src^="http"]').length,0);assert.equal(ctx.doc.querySelectorAll('#article .image-placeholder').length,2);
 assert.equal(ctx.doc.querySelectorAll('#app').length,0);assert.equal(ctx.requests.length,0,ctx.requests.join('\n'));
 const external=[...ctx.doc.querySelectorAll('#article a')].find(a=>a.textContent==='Externe');assert.equal(external.target,'_blank');assert.equal(external.rel,'noopener noreferrer');
});
await check('Maths et code : quatre expressions, code conservé, titres et IDs stables',()=>{
 assert.equal(ctx.doc.querySelectorAll('#article .katex').length,4);
 assert(ctx.doc.querySelector('#article pre code').textContent.includes('$code$'));assert(ctx.doc.querySelector('#article pre code').textContent.includes('</script><script>'));
 const ids=[...ctx.doc.querySelectorAll('#article [id]')].map(n=>n.id);assert.equal(new Set(ids).size,ids.length);assert(ids.includes('folio-h-deja-vu--ete'));assert(ids.includes('folio-anchor-custom'));
});
await check('Vue source : texte littéral et aller-retour vers rendu',()=>{
 ctx.doc.getElementById('source-toggle').click();assert.equal(ctx.doc.getElementById('source-view').hidden,false);assert.equal(ctx.doc.getElementById('article').hidden,true);
 assert.equal(ctx.doc.getElementById('source-view').textContent,source);assert.equal(ctx.doc.getElementById('source-view').children.length,0);assert.equal(ctx.win.__folio_xss,undefined);
 ctx.doc.getElementById('source-toggle').click();assert.equal(ctx.doc.getElementById('article').hidden,false);
});
await check('Liens : chemins relatifs, titres répétés, ancres et ambiguïté',async()=>{
 [...ctx.doc.querySelectorAll('#article a')].find(a=>a.textContent==='Guide').click();await delay(35);assert.equal(activeTab(ctx).title,'guide.md');assert(ctx.scrollTargets.includes('folio-h-installation-1'));
 [...ctx.doc.querySelectorAll('#article a')].find(a=>a.textContent==='Retour').click();await delay(35);assert.equal(activeTab(ctx).title,'notes/index.md');assert(ctx.scrollTargets.includes('folio-h-deja-vu--ete'));
 [...ctx.doc.querySelectorAll('#article a')].find(a=>a.textContent==='Ancre HTML').click();assert(ctx.scrollTargets.includes('folio-anchor-custom'));
 [...ctx.doc.querySelectorAll('#article a')].find(a=>a.textContent==='Ambigu').click();assert.equal(activeTab(ctx).title,'notes/index.md');assert(ctx.doc.getElementById('toast-message').textContent.includes('Plusieurs documents'));
});
await check('Recherche : accents, caractères littéraux et aucune injection',()=>{
 const search=ctx.doc.getElementById('search');search.value='deja vu';search.dispatchEvent(new ctx.win.Event('input',{bubbles:true}));assert.equal(ctx.doc.querySelectorAll('#file-list .file-button').length,1);
 search.value='<script>';search.dispatchEvent(new ctx.win.Event('input',{bubbles:true}));assert.equal(ctx.doc.querySelectorAll('#file-list .file-button').length,1);assert.equal(ctx.doc.querySelectorAll('#file-list script').length,0);
 search.value='a+b[1]';search.dispatchEvent(new ctx.win.Event('input',{bubbles:true}));assert.equal(ctx.doc.querySelectorAll('#file-list .file-button').length,1);const activeCard=ctx.doc.querySelector('#file-list .file-item.active.outside-search');assert(activeCard);assert.equal(activeCard.querySelector('.file-button').dataset.docId,activeTab(ctx).dataset.docId);assert.match(activeCard.textContent,/En lecture\s*·\s*hors résultats/);search.value='';search.dispatchEvent(new ctx.win.Event('input',{bubbles:true}));
});
let standaloneHTML='',collectionHTML='';
await check('Export individuel : téléchargement capturé et HTML autonome reparsable',async()=>{
 ctx.doc.getElementById('export-current').click();await until(()=>ctx.downloads.length>=1,'individual export');
 const output=ctx.downloads[0];assert.equal(output.filename,'index.html');standaloneHTML=await output.blob.text();fs.writeFileSync(path.join(outputDir,'export-individuel.html'),standaloneHTML);
 const out=createDOM(standaloneHTML,'file:///notes/index.html');await delay(25);
 assert.equal(out.errors.length,0,out.errors.join('\n'));assert.equal(out.doc.querySelectorAll('script').length,0);assert.equal(out.win.__folio_xss,undefined);assert.equal(out.doc.querySelectorAll('.katex').length,4);
 assert(out.doc.querySelector('img[src^="data:image/png;base64,"]'));assert.equal(out.doc.querySelectorAll('img[src^="http"]').length,0);assert.equal(out.requests.length,0);
 const guide=[...out.doc.querySelectorAll('a')].find(a=>a.textContent==='Guide');assert.equal(guide.getAttribute('href'),'../guide.html#folio-page-0-folio-h-installation-1');
 const ids=[...out.doc.querySelectorAll('[id]')].map(n=>n.id);assert.equal(new Set(ids).size,ids.length);
 out.win.close();
});
await check('Export collection : onglets, isolation des IDs et liens croisés hors ligne',async()=>{
 ctx.doc.getElementById('export-collection').click();await until(()=>ctx.downloads.length>=2,'collection export');
 const output=ctx.downloads[1];assert.equal(output.filename,'Folio-collection.html');collectionHTML=await output.blob.text();fs.writeFileSync(path.join(outputDir,'export-collection.html'),collectionHTML);
 const out=createDOM(collectionHTML,'file:///Folio-collection.html');await delay(25);
 assert.equal(out.errors.length,0,out.errors.join('\n'));assert.equal(out.win.__folio_xss,undefined);assert.equal(out.doc.querySelectorAll('[role="tab"]').length,4);assert.equal(out.doc.querySelectorAll('.export-doc:not([hidden])').length,1);
 const ids=[...out.doc.querySelectorAll('[id]')].map(n=>n.id);assert.equal(new Set(ids).size,ids.length);
 const guide=[...out.doc.querySelectorAll('a')].find(a=>a.textContent==='Guide');assert.equal(guide.getAttribute('href'),'#folio-page-1-folio-h-installation-1');guide.click();await delay(25);assert.equal(out.doc.querySelector('.export-doc:not([hidden])').id,'folio-page-1');
 const firstTab=out.doc.querySelector('[role="tab"]');firstTab.click();assert.equal(out.doc.querySelector('.export-doc:not([hidden])').id,'folio-page-0');firstTab.focus();firstTab.dispatchEvent(new out.win.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.equal(out.doc.querySelector('.export-doc:not([hidden])').id,'folio-page-3');
 assert.equal(out.requests.length,0);assert(out.doc.querySelector('img[src^="data:image/png;base64,"]'));
 out.win.close();
});
await check('Réimport : mise à jour sans doublon, fichier vide et UTF-8 invalide isolé',async()=>{
 await imports(ctx,[file(ctx,'guide.md','# Guide mis à jour\n\nRévision.'),file(ctx,'vide.md',''),file(ctx,'invalide.md',Buffer.from([0xff,0xff]))]);
 assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length,5);assert.equal(ctx.doc.querySelector('#article h1').textContent,'Guide mis à jour');assert(ctx.doc.getElementById('toast-message').textContent.includes('UTF-8'));
 selectByTitle(ctx,'vide.md');assert(ctx.doc.querySelector('#article .notice-empty'));assert.equal(ctx.doc.querySelector('#article h1').textContent,'vide');
});
await check('Fermeture active, dernier onglet puis réimport',async()=>{
 while(ctx.doc.querySelector('[role="tab"]')) {const current=activeTab(ctx);current.focus();current.dispatchEvent(new ctx.win.KeyboardEvent('keydown',{key:'Delete',bubbles:true}));}
 assert.equal(ctx.doc.getElementById('welcome').hidden,false);assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length,0);
 await imports(ctx,[file(ctx,'retour.md','# Retour')]);assert.equal(ctx.doc.querySelectorAll('[role="tab"]').length,1);assert.equal(ctx.doc.querySelector('#article h1').textContent,'Retour');
});
await check('État final : aucune erreur JS et aucun appel réseau observé',()=>{assert.equal(ctx.errors.length,0,ctx.errors.join('\n'));assert.equal(ctx.requests.length,0,ctx.requests.join('\n'));});
const summary={generatedAt:new Date().toISOString(),environment:'jsdom '+require('jsdom/package.json').version,tests:reports,bugs,appErrors:ctx.errors,networkRequests:ctx.requests,limitations:['DOM exécuté sans navigateur; pas de validation visuelle ni du layout.','CSP et chargements de polices non simulés par jsdom.','Les interactions de fichiers utilisent des File synthétiques; File.arrayBuffer, scroll, matchMedia et téléchargements sont simulés.']};
fs.writeFileSync(path.join(outputDir,'rapport-dom.json'),JSON.stringify(summary,null,2));
const lines=['# Validation DOM de Folio','',summary.environment+' — '+summary.generatedAt,'',`${reports.filter(x=>x.status==='PASS').length}/${reports.length} vérifications réussies.`,...reports.map(x=>`- ${x.status} — ${x.name}${x.message?' : '+x.message.split('\n')[0]:''}`),'','## Limites',...summary.limitations.map(x=>'- '+x)];
fs.writeFileSync(path.join(outputDir,'rapport-dom.txt'),lines.join('\n'));
print(JSON.stringify(summary,null,2));ctx.win.close();
process.exitCode=bugs.length?1:0;
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
