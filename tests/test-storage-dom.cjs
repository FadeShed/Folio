'use strict';
const print=(...args)=>{if(require.main===module)console.log(...args);};
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const outputDir=path.join(__dirname,'output');
fs.mkdirSync(outputDir,{recursive:true});
const H=require('./storage-harness.cjs');
const {freshFactory,createSession,file,imports,activeTab,selectByTitle,imagePNG,delay,until}=H;
const results=[],sessions=[];
const sourcePath=path.resolve(__dirname,'..','Folio.html');
function state(ctx){return ctx.doc.getElementById('storage-status').dataset.state;}
function statusText(ctx){return ctx.doc.getElementById('storage-status').textContent;}
function remember(ctx){return ctx.doc.getElementById('remember-collection');}
function count(ctx){return ctx.doc.querySelectorAll('[role="tab"]').length;}
function docsIn(record){return record.snapshot?.docs||record.snapshot?.documents||[];}
function assetsIn(record){return record.snapshot?.assets||record.snapshot?.images||[];}
function docPaths(record){return docsIn(record).map(d=>d.path);}
function checkedSnapshot(record){assert.equal(record.enabled,true);assert(record.snapshot&&typeof record.snapshot==='object');return record.snapshot;}
async function ready(ctx){await until(()=>ctx.win.FolioStorage&&state(ctx)&&state(ctx)!=='loading','initial storage read');assert.equal(ctx.errors.length,0,ctx.errors.join('\n'));}
async function session(factory,options){const ctx=createSession(factory,options);sessions.push(ctx);await ready(ctx);return ctx;}
async function read(ctx){return await ctx.win.FolioStorage.read();}
async function saved(ctx){await until(()=>state(ctx)==='saved','saved UI: '+statusText(ctx),{attempts:500});await delay(15);}
async function errorState(ctx,accepted=['error']){await until(()=>accepted.includes(state(ctx)),'error UI: '+statusText(ctx),{attempts:500});}
async function enable(ctx){if(!remember(ctx).checked)remember(ctx).click();await saved(ctx);return await read(ctx);}
async function disable(ctx){if(remember(ctx).checked)remember(ctx).click();await until(()=>state(ctx)==='off','disabled UI: '+statusText(ctx),{attempts:500});return await read(ctx);}
async function fixture(ctx){
 await imports(ctx,[
  file(ctx,'a.md','# Document A\n\n![Image](images/pixel.png)\n\n[Document B](b.md)','notes/a.md'),
  file(ctx,'b.md','# Document B\n\nUne formule $E=mc^2$.\n\n![Image](images/pixel.png)\n\n<script>window.__persist_xss=true</script>','notes/b.md'),
  file(ctx,'pixel.png',imagePNG,'notes/images/pixel.png')
 ],true);
}
function closeDoc(ctx,path){const tab=[...ctx.doc.querySelectorAll('[role="tab"]')].find(t=>t.title===path);assert(tab);const close=ctx.doc.querySelector('[data-close-id="'+tab.dataset.docId+'"]');assert(close);close.click();}
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});print('PASS '+name);}catch(error){results.push({name,status:'FAIL',message:error.stack||String(error)});print('FAIL '+name+' — '+error.message);}}
module.exports=(async()=>{
await check('Opt-in désactivé par défaut : import non persistant et rechargement vide',async()=>{
 const factory=freshFactory(),a=await session(factory);assert.equal(state(a),'off');assert.equal(remember(a).checked,false);
 await fixture(a);assert.equal(count(a),2);await delay(600);const record=await read(a);assert.equal(record.enabled,false);assert.equal(record.revision,0);assert.equal(record.snapshot,null);assert.equal(a.events.filter(e=>e.type==='mutation-request').length,0);
 assert.equal(a.win.localStorage.length,0);assert.equal(a.win.sessionStorage.length,0);assert.equal(a.doc.cookie,'');
 const b=await session(factory);assert.equal(count(b),0);assert.equal(state(b),'off');assert.equal(remember(b).checked,false);a.close();b.close();
});
await check('Activation annoncée seulement après commit, données et onglet restaurés dans deux sessions',async()=>{
 const factory=freshFactory(),a=await session(factory);await fixture(a);selectByTitle(a,'notes/b.md');a.observe(a.doc.getElementById('storage-status'));
 a.controls.holdCommit=true;remember(a).click();await until(()=>a.events.some(e=>e.type==='mutation-success'),'request success before held commit');
 assert.notEqual(state(a),'saved');assert.equal(a.events.filter(e=>e.type==='transaction-complete'&&e.mode==='readwrite').length,0);
 a.controls.holdCommit=false;await saved(a);const record=await read(a);checkedSnapshot(record);assert.deepEqual(docPaths(record),['notes/a.md','notes/b.md']);assert.equal(assetsIn(record).length,1);
 const commit=a.events.find(e=>e.type==='transaction-complete'&&e.mode==='readwrite');const notice=a.events.find(e=>e.type==='ui-status'&&e.attributes.some(([k,v])=>k==='data-state'&&v==='saved'));assert(commit&&notice);assert(commit.sequence<notice.sequence);
 const b=await session(factory);assert.equal(count(b),2);assert.equal(activeTab(b).title,'notes/b.md');assert.equal(remember(b).checked,true);assert.equal(b.doc.querySelectorAll('#article .katex').length,1);assert(b.doc.querySelector('#article img[src^="data:image/png;base64,"]'));assert.equal(b.win.__persist_xss,undefined);
 b.close();const c=await session(factory);assert.equal(count(c),2);assert.equal(activeTab(c).title,'notes/b.md');assert(c.doc.querySelector('#article img[src^="data:image/png;base64,"]'));a.close();c.close();
});
await check('Désactivation : suppression des données avec tombstone et mode off au rechargement',async()=>{
 const factory=freshFactory(),a=await session(factory);await fixture(a);const first=await enable(a);const removed=await disable(a);assert.equal(removed.enabled,false);assert.equal(removed.snapshot,null);assert(removed.revision>first.revision);assert.equal(count(a),2);
 const b=await session(factory);assert.equal(count(b),0);assert.equal(remember(b).checked,false);assert.equal(state(b),'off');const persisted=await read(b);assert.equal(persisted.snapshot,null);a.close();b.close();
});
await check('Suppression d’un document et vidage de collection conservés au rechargement',async()=>{
 const factory=freshFactory(),a=await session(factory);await fixture(a);await enable(a);closeDoc(a,'notes/a.md');await saved(a);assert.deepEqual(docPaths(await read(a)),['notes/b.md']);
 const b=await session(factory);assert.equal(count(b),1);assert.equal(activeTab(b).title,'notes/b.md');b.close();
 a.doc.getElementById('confirm-clear').click();await saved(a);const emptied=await read(a);assert.equal(emptied.enabled,true);assert.equal(docsIn(emptied).length,0);assert.equal(assetsIn(emptied).length,0);
 const c=await session(factory);assert.equal(count(c),0);assert.equal(remember(c).checked,true);assert.equal(state(c),'saved');a.close();c.close();
});
await check('Quota à l’activation : erreur explicite, aucune fausse sauvegarde et documents lisibles',async()=>{
 const factory=freshFactory(),a=await session(factory);await fixture(a);a.controls.quota=true;remember(a).click();await errorState(a);assert(statusText(a).trim());assert.equal(count(a),2);assert.notEqual(state(a),'saved');
 a.controls.quota=false;const record=await read(a);assert.equal(record.enabled,false);assert.equal(record.snapshot,null);
 const b=await session(factory);assert.equal(count(b),0);assert.equal(remember(b).checked,false);a.close();b.close();
});
await check('IndexedDB refusé : état erreur sans bloquer la lecture ni annoncer une réussite',async()=>{
 const factory=freshFactory(),a=await session(factory,{controls:{denyOpen:true}});assert(['error','unavailable'].includes(state(a)));await fixture(a);assert.equal(count(a),2);assert.notEqual(state(a),'saved');assert.equal(a.errors.length,0,a.errors.join('\n'));a.close();
});
await check('Transaction annulée après succès de put : pas de message saved ni de données restaurées',async()=>{
 const factory=freshFactory(),a=await session(factory);await fixture(a);a.controls.abortWrite=true;remember(a).click();await errorState(a);assert(a.events.some(e=>e.type==='mutation-success'));assert(a.events.some(e=>e.type==='transaction-abort'));assert.notEqual(state(a),'saved');
 a.controls.abortWrite=false;const record=await read(a);assert.equal(record.enabled,false);assert.equal(record.snapshot,null);const b=await session(factory);assert.equal(count(b),0);a.close();b.close();
});
await check('Quota pendant autosauvegarde : ancienne copie conservée, modification non annoncée comme sauvée',async()=>{
 const factory=freshFactory(),a=await session(factory);await imports(a,[file(a,'a.md','# A')]);const initial=await enable(a);a.controls.quota=true;await imports(a,[file(a,'b.md','# B')]);await errorState(a);assert.equal(count(a),2);a.controls.quota=false;
 const record=await read(a);assert.equal(record.revision,initial.revision);assert.deepEqual(docPaths(record),['a.md']);const b=await session(factory);assert.equal(count(b),1);assert.equal(activeTab(b).title,'a.md');a.close();b.close();
});
await check('Échec de désactivation : copie conservée et état erreur, pas de fausse suppression',async()=>{
 const factory=freshFactory(),a=await session(factory);await fixture(a);const initial=await enable(a);a.controls.quota=true;remember(a).click();await errorState(a);assert.notEqual(state(a),'off');a.controls.quota=false;
 const record=await read(a);assert.equal(record.enabled,true);assert.equal(record.revision,initial.revision);const b=await session(factory);assert.equal(count(b),2);assert.equal(remember(b).checked,true);a.close();b.close();
});
await check('Conflit multi-onglets : édition obsolète ne rétablit ni document retiré ni collection effacée',async()=>{
 const factory=freshFactory(),a=await session(factory);await fixture(a);await enable(a);const b=await session(factory);assert.equal(count(b),2);
 closeDoc(a,'notes/a.md');await saved(a);const afterRemoval=await read(a);await imports(b,[file(b,'obsolete.md','# Ancien onglet')]);await errorState(b,['conflict','error']);const afterStale=await read(a);assert.equal(afterStale.revision,afterRemoval.revision);assert.deepEqual(docPaths(afterStale),['notes/b.md']);
 const c=await session(factory);assert.equal(count(c),1);c.close();const tombstone=await disable(a);
 await imports(b,[file(b,'late.md','# Toujours obsolète')]);await delay(650);const final=await read(a);assert.equal(final.enabled,false);assert.equal(final.snapshot,null);assert.equal(final.revision,tombstone.revision);
 const d=await session(factory);assert.equal(count(d),0);assert.equal(remember(d).checked,false);a.close();b.close();d.close();
});
await check('Aucun accès réseau ni erreur JavaScript pendant les scénarios',()=>{
 for(const ctx of sessions){assert.equal(ctx.requests.length,0,ctx.requests.join('\n'));assert.equal(ctx.errors.length,0,ctx.errors.join('\n'));}
});
for(const ctx of sessions)ctx.close();
const report={generatedAt:new Date().toISOString(),environment:'jsdom 30.1.3 + fake-indexeddb 6.2.6',source:sourcePath,tests:results,passed:results.filter(x=>x.status==='PASS').length,total:results.length,limitations:['Tests de DOM et IndexedDB simulés, sans navigateur et sans validation visuelle.','Le refus de stockage, le quota et l’annulation de transaction sont injectés; les politiques de chaque navigateur restent à vérifier sur navigateur réel.','La factory est partagée entre sessions au même chemin; aucune émulation de BroadcastChannel afin d’exercer les protections CAS.']};
fs.writeFileSync(path.join(outputDir,'rapport-stockage.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(outputDir,'rapport-stockage.txt'),['Validation du stockage local Folio',`${report.passed}/${report.total} scénarios réussis.`,...results.map(r=>`${r.status} — ${r.name}${r.message?'\n'+r.message:''}`),'','Limites :',...report.limitations.map(x=>'- '+x)].join('\n'));
print(JSON.stringify(report,null,2));process.exitCode=report.passed===report.total?0:1;
})().catch(error=>{for(const ctx of sessions)ctx.close();console.error(error.stack);process.exitCode=1;});
