'use strict';
const print=(...args)=>{if(require.main===module)console.log(...args);};
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {freshFactory,createSession,file,imports,until,delay}=require('./storage-harness.cjs');
const outputDir=path.join(__dirname,'output');
fs.mkdirSync(outputDir,{recursive:true});
const results=[],sessions=[];

function state(ctx){return ctx.doc.getElementById('storage-status').dataset.state;}
function statusText(ctx){return ctx.doc.getElementById('storage-status').textContent;}
function remember(ctx){return ctx.doc.getElementById('remember-collection');}
function paths(ctx){return Array.from(ctx.doc.querySelectorAll('[role="tab"]')).map(tab=>tab.title);}
async function session(factory=freshFactory()){
 const ctx=createSession(factory);sessions.push(ctx);
 await until(()=>state(ctx)&&state(ctx)!=='loading','initialization');
 return ctx;
}
async function saved(ctx){await until(()=>state(ctx)==='saved','saved state: '+statusText(ctx));}

// Hold the real file-read promise, allowing a storage transaction to complete
// while the interface is importing. This exercises independent asynchronous
// operations through the public UI, without exposing private application state.
function slowImport(ctx,name,content){
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const inputFile=file(ctx,name,content);
 inputFile.arrayBuffer=async()=>{await gate;return new TextEncoder().encode(content).buffer;};
 const input=ctx.doc.getElementById('file-input');
 Object.defineProperty(input,'files',{configurable:true,value:[inputFile]});
 input.dispatchEvent(new ctx.win.Event('change',{bubbles:true}));
 return async()=>{release();await until(()=>ctx.doc.getElementById('busy-indicator').hidden,'import complete');};
}

async function seedMalformedEnvelope(factory,envelope={enabled:true,snapshot:{schema:1,docs:[],assets:[]}}){
 await new Promise((resolve,reject)=>{
  const request=factory.open('folio-local-collection-v1',1);
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{
   const db=request.result,tx=db.transaction('collections','readwrite');
   // A missing revision cannot be safely converted to revision zero: an old
   // tab may still hold a revision and later attempt a write.
   tx.objectStore('collections').put(envelope,'/Folio.html');
   tx.oncomplete=()=>{db.close();resolve();};
   tx.onabort=()=>{db.close();reject(tx.error);};
  };
 });
}

async function check(name,run){
 try{await run();results.push({name,status:'PASS'});print('PASS '+name);}
 catch(error){results.push({name,status:'FAIL',message:error.stack||String(error)});print('FAIL '+name+' — '+error.message);}
}

module.exports=(async()=>{
await check('Désactivation derrière une écriture : la purge reprend après un import concurrent',async()=>{
 const ctx=await session();await imports(ctx,[file(ctx,'secret.md','# Copie à effacer')]);
 ctx.controls.holdCommit=true;remember(ctx).click();
 await until(()=>ctx.events.some(event=>event.type==='mutation-success'),'put before held commit');
 remember(ctx).click();
 const finishImport=slowImport(ctx,'nouveau.md','# Nouveau document');
 assert.equal(ctx.doc.getElementById('busy-indicator').hidden,false);
 ctx.controls.holdCommit=false;
 await until(()=>ctx.events.some(event=>event.type==='transaction-complete'&&event.mode==='readwrite'),'commit while file read is held');
 await delay(30);await finishImport();
 await until(()=>state(ctx)==='off','queued purge completion: '+statusText(ctx));
 const record=await ctx.win.FolioStorage.read();
 assert.equal(remember(ctx).checked,false);assert.equal(record.enabled,false);assert.equal(record.snapshot,null);
 assert.deepEqual(paths(ctx),['secret.md','nouveau.md']);
 ctx.close();
});

await check('Réessayer un effacement pendant un import reprend après la lecture du fichier',async()=>{
 const ctx=await session();await imports(ctx,[file(ctx,'secret.md','# Copie à effacer')]);
 remember(ctx).click();await saved(ctx);const savedRecord=await ctx.win.FolioStorage.read();
 ctx.controls.quota=true;remember(ctx).click();await until(()=>state(ctx)==='error','failed removal shown');
 ctx.controls.quota=false;
 const finishImport=slowImport(ctx,'nouveau.md','# Nouveau document');
 ctx.doc.getElementById('storage-retry').click();
 await finishImport();await until(()=>state(ctx)==='off','retry purge completion: '+statusText(ctx));
 const record=await ctx.win.FolioStorage.read();
 assert.equal(record.enabled,false);assert.equal(record.snapshot,null);assert(record.revision>savedRecord.revision);
 assert.equal(remember(ctx).checked,false);assert.deepEqual(paths(ctx),['secret.md','nouveau.md']);
 ctx.close();
});

await check('Enveloppe corrompue : diagnostic exact, récupération expliquée, aucune fausse suppression',async()=>{
 const factory=freshFactory(),seed=await session(factory);seed.close();await seedMalformedEnvelope(factory);
 const ctx=await session(factory);
 assert.equal(state(ctx),'corrupt');assert.match(statusText(ctx),/illisible/i);
 assert.match(statusText(ctx),/données de ce site/i);assert.match(statusText(ctx),/réglages du navigateur/i);
 assert.equal(remember(ctx).disabled,true);assert.equal(ctx.doc.getElementById('storage-retry').hidden,true);
 assert.equal(ctx.events.filter(event=>event.type==='mutation-request').length,0);
 await assert.rejects(()=>ctx.win.FolioStorage.read(),error=>error.code==='invalid');
 await imports(ctx,[file(ctx,'lisible.md','# Lecture disponible')]);
 assert.equal(ctx.doc.querySelector('#article h1').textContent,'Lecture disponible');assert.equal(state(ctx),'corrupt');
 assert.equal(ctx.doc.getElementById('export-toggle').disabled,false);
 ctx.close();
});

await check('Snapshot invalide avec révision valide : rejet atomique et effacement sans perdre les nouveaux imports',async()=>{
 const factory=freshFactory(),seed=await session(factory);
 const initial=await seed.win.FolioStorage.write({schema:1,docs:[{path:'correct.md',content:'# Correct'},{path:'invalide.md',content:'\u0000'}],assets:[],activePath:'correct.md'},0);
 seed.close();const ctx=await session(factory);
 assert.deepEqual(paths(ctx),[]);assert.equal(state(ctx),'error');
 assert.match(ctx.doc.getElementById('storage-retry').textContent,/Effacer/i);
 await imports(ctx,[file(ctx,'nouveau.md','# Nouveau document')]);ctx.doc.getElementById('storage-retry').click();
 await until(()=>state(ctx)==='off','invalid snapshot removal');
 const record=await ctx.win.FolioStorage.read();assert.equal(record.enabled,false);assert.equal(record.snapshot,null);
 assert(record.revision>initial.revision);assert.deepEqual(paths(ctx),['nouveau.md']);
 ctx.close();
});

await check('Enveloppe désactivée avec données résiduelles : corruption signalée, aucun faux état temporaire',async()=>{
 const factory=freshFactory(),seed=await session(factory);seed.close();
 await seedMalformedEnvelope(factory,{enabled:false,revision:7,snapshot:{schema:1,docs:[{path:'secret.md',content:'# Données résiduelles'}],assets:[]}});
 const ctx=await session(factory);
 assert.equal(state(ctx),'corrupt');assert.match(statusText(ctx),/illisible/i);
 assert.doesNotMatch(statusText(ctx),/rien n’est mémorisé/);
 assert.equal(remember(ctx).disabled,true);assert.equal(ctx.doc.getElementById('storage-retry').hidden,true);
 assert.equal(ctx.events.filter(event=>event.type==='mutation-request').length,0);
 await assert.rejects(()=>ctx.win.FolioStorage.read(),error=>error.code==='invalid');
 assert.deepEqual(paths(ctx),[]);ctx.close();
});

for(const ctx of sessions){
 if(ctx.requests.length||ctx.errors.length)results.push({name:'Aucun réseau ni erreur JavaScript dans la session',status:'FAIL',message:[...ctx.requests,...ctx.errors].join('\n')});
 ctx.close();
}
const report={generatedAt:new Date().toISOString(),type:'state-regressions',passed:results.filter(result=>result.status==='PASS').length,total:results.length,tests:results,limitations:['Tests de DOM avec jsdom et IndexedDB simulé par fake-indexeddb, sans véritable navigateur.','Les délais de transaction, les échecs de quota et les lectures retenues sont injectés pour reproduire les courses de façon déterministe.']};
fs.writeFileSync(path.join(outputDir,'rapport-state-regressions.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(outputDir,'rapport-state-regressions.txt'),[`Régressions état/persistance : ${report.passed}/${report.total}`,...results.map(result=>result.status+' — '+result.name+(result.message?'\n'+result.message:'')),'','Limites :',...report.limitations.map(item=>'- '+item)].join('\n'));
print(JSON.stringify(report,null,2));process.exitCode=report.passed===report.total?0:1;
})().catch(error=>{for(const ctx of sessions)ctx.close();console.error(error.stack);process.exitCode=1;});
