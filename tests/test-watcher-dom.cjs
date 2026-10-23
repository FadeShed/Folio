'use strict';
const print=(...args)=>{if(require.main===module)console.log(...args);};
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const outputDir=path.join(__dirname,'output');
fs.mkdirSync(outputDir,{recursive:true});
const {freshFactory,createSession,file,imports,activeTab,selectByTitle,delay,until}=require('./storage-harness.cjs');
const results=[],sessions=[];
function status(c){return c.doc.getElementById('watch-status').dataset.state;}
function storageStatus(c){return c.doc.getElementById('storage-status').dataset.state;}
function checkWatch(c){return c.doc.getElementById('watch-toggle');}
async function setup(factory=freshFactory(),supported=true){
 let chosen=null;const pickerCalls=[];
 const c=createSession(factory,{beforeParse(win){Object.defineProperty(win,'isSecureContext',{value:supported,configurable:true});if(supported)win.showOpenFilePicker=async options=>{pickerCalls.push(options);if(chosen instanceof Error)throw chosen;return [chosen];};}});sessions.push(c);
 c.select=h=>chosen=h;c.pickerCalls=pickerCalls;
 c.makeHandle=(name)=>{
  const m={content:'# Version externe 1',lastModified:1,permission:'granted',requestResult:'granted',requests:0,reads:0,queryCalls:0};
  const h={kind:'file',name,async queryPermission(){m.queryCalls++;return m.permission;},async requestPermission(){m.requests++;m.permission=m.requestResult;return m.requestResult;},async getFile(){m.reads++;const f=new c.win.File([m.content],name,{type:'text/markdown',lastModified:m.lastModified});if(m.arrayBufferGate){f.arrayBuffer=async()=>{m.arrayBufferEntered=true;await m.arrayBufferGate;return new TextEncoder().encode(m.content).buffer;};}return f;}};
  return {handle:h,model:m};
 };
 await until(()=>c.win.FolioWatcher&&storageStatus(c)&&storageStatus(c)!=='loading','UI initialized');assert.equal(c.errors.length,0,c.errors.join('\n'));return c;
}
async function fixture(c){await imports(c,[file(c,'a.md','# Version importée A'),file(c,'b.md','# Version importée B')]);}
function id(c,path){return [...c.doc.querySelectorAll('[role="tab"]')].find(t=>t.title===path)?.dataset.docId;}
async function link(c,path,handle){selectByTitle(c,path);c.select(handle);checkWatch(c).click();await until(()=>status(c)==='watching','watching '+path);}
async function test(name,fn){try{await fn();results.push({name,status:'PASS'});print('PASS '+name);}catch(e){results.push({name,status:'FAIL',message:e.stack||String(e)});print('FAIL '+name+' — '+e.message);}}
module.exports=(async()=>{
await test('Suivi indisponible : contrôle explicite et lecture normale préservée',async()=>{
 const c=await setup(freshFactory(),false);await fixture(c);assert.equal(status(c),'unavailable');assert.equal(checkWatch(c).disabled,true);assert.equal(c.doc.querySelector('#article h1').textContent,'Version importée A');c.close();
});
await test('Liaison par document : mise à jour active, source préservée, onglet inactif non sélectionné',async()=>{
 const c=await setup();await fixture(c);const {handle,model}=c.makeHandle('a.md');await link(c,'a.md',handle);assert.equal(c.doc.querySelector('#article h1').textContent,'Version externe 1');assert.equal(c.pickerCalls.length,1);
 const a=id(c,'a.md');c.doc.getElementById('source-toggle').click();model.content='# Version externe 2\n\nUne formule $x^2$.';model.lastModified=2;assert.equal(await c.win.FolioWatcher.checkNow(a),true);assert.equal(c.doc.getElementById('source-view').hidden,false);assert.equal(c.doc.getElementById('source-view').textContent,model.content);
 selectByTitle(c,'b.md');assert.equal(checkWatch(c).checked,false);model.content='# Version externe 3';model.lastModified=3;assert.equal(await c.win.FolioWatcher.checkNow(a),true);assert.equal(activeTab(c).title,'b.md');assert.equal(c.doc.querySelector('#article h1').textContent,'Version importée B');selectByTitle(c,'a.md');assert.equal(c.doc.querySelector('#article h1').textContent,'Version externe 3');assert.equal(checkWatch(c).checked,true);c.win.FolioWatcher.stopAll();c.close();
});
await test('Mauvais original refusé et permission rétablie uniquement par clic explicite',async()=>{
 const c=await setup();await fixture(c);const wrong=c.makeHandle('autre.md');c.select(wrong.handle);checkWatch(c).click();await until(()=>c.doc.getElementById('toast-message').textContent.includes('Choisissez le fichier'),'wrong original error');assert.equal(checkWatch(c).checked,false);assert.equal(c.doc.querySelector('#article h1').textContent,'Version importée A');
 const {handle,model}=c.makeHandle('a.md');await link(c,'a.md',handle);model.permission='prompt';await c.win.FolioWatcher.checkNow(id(c,'a.md'));assert.equal(status(c),'paused');assert.equal(model.requests,0);assert.equal(c.doc.getElementById('watch-reconnect').hidden,false);
 c.doc.getElementById('watch-reconnect').click();await until(()=>status(c)==='watching','permission restored');assert.equal(model.requests,1);c.win.FolioWatcher.stopAll();c.close();
});
await test('Arrêter ou fermer pendant lecture asynchrone empêche toute mise à jour tardive',async()=>{
 const c=await setup();await fixture(c);const {handle,model}=c.makeHandle('a.md');await link(c,'a.md',handle);const a=id(c,'a.md');let release;
 model.arrayBufferGate=new Promise(r=>release=r);model.content='# Version tardive';model.lastModified=2;const work=c.win.FolioWatcher.checkNow(a);await until(()=>model.arrayBufferEntered,'asynchronous read begun');checkWatch(c).click();assert.equal(checkWatch(c).checked,false);release();assert.equal(await work,false);await delay(20);assert.equal(c.doc.querySelector('#article h1').textContent,'Version externe 1');
 model.arrayBufferGate=null;model.arrayBufferEntered=false;await link(c,'a.md',handle);let release2;model.arrayBufferGate=new Promise(r=>release2=r);model.content='# Version après fermeture';model.lastModified=3;const late=c.win.FolioWatcher.checkNow(a);await until(()=>model.arrayBufferEntered,'second async read begun');c.doc.querySelector('[data-close-id="'+a+'"]').click();release2();assert.equal(await late,false);await delay(20);assert.equal(c.doc.querySelectorAll('[role="tab"]').length,1);assert.equal(activeTab(c).title,'b.md');assert.equal(c.doc.querySelector('#article h1').textContent,'Version importée B');c.close();
});
await test('Handle non clonable : copie mémorisée sans handle, intention de suivi restaurée avec reconnexion',async()=>{
 const factory=freshFactory(),c=await setup(factory);await fixture(c);const {handle}=c.makeHandle('a.md');await link(c,'a.md',handle);c.doc.getElementById('remember-collection').click();await until(()=>storageStatus(c)==='saved','save fallback');const record=await c.win.FolioStorage.read();const watched=record.snapshot.docs.find(d=>d.path==='a.md');assert.equal(watched.watch.enabled,true);assert.equal(watched.watch.handle,null);assert(c.doc.getElementById('remember-help').textContent.includes('reliés'));
 c.win.FolioWatcher.stopAll();c.close();const next=await setup(factory);assert.equal(activeTab(next).title,'a.md');assert.equal(checkWatch(next).checked,true);assert.equal(status(next),'paused');assert.equal(next.doc.getElementById('watch-reconnect').hidden,false);assert.equal(next.doc.querySelector('#article h1').textContent,'Version externe 1');next.close();
});

await test('Réimport du même nom : nouveau contenu conservé, ancien suivi et callback tardif arrêtés',async()=>{
 const c=await setup();await fixture(c);const {handle,model}=c.makeHandle('a.md');await link(c,'a.md',handle);const a=id(c,'a.md');let release;
 model.arrayBufferGate=new Promise(r=>release=r);model.content='# Ancien original modifié';model.lastModified=2;const pending=c.win.FolioWatcher.checkNow(a);await until(()=>model.arrayBufferEntered,'old callback started before reimport');
 await imports(c,[file(c,'a.md','# Nouveau contenu B')]);assert.equal(id(c,'a.md'),a);assert.equal(c.doc.querySelector('#article h1').textContent,'Nouveau contenu B');assert.equal(checkWatch(c).checked,false);assert.equal(status(c),'off');
 release();assert.equal(await pending,false);assert.equal(await c.win.FolioWatcher.checkNow(a),false);c.win.dispatchEvent(new c.win.Event('focus'));await delay(30);assert.equal(c.doc.querySelector('#article h1').textContent,'Nouveau contenu B');assert.equal(c.doc.querySelectorAll('[role="tab"]').length,2);c.close();
});
await test('Mise à jour externe : focus conservé sur l’onglet et la ligne de document',async()=>{
 const c=await setup();await fixture(c);const {handle,model}=c.makeHandle('a.md');await link(c,'a.md',handle);const a=id(c,'a.md');
 activeTab(c).focus();model.content='# Actualisation au clavier';model.lastModified=2;assert.equal(await c.win.FolioWatcher.checkNow(a),true);assert.equal(c.doc.activeElement.getAttribute('role'),'tab');assert.equal(c.doc.activeElement.dataset.docId,a);
 const row=c.doc.querySelector('#file-list .file-button[data-doc-id="'+a+'"]');row.focus();model.content='# Autre actualisation';model.lastModified=3;assert.equal(await c.win.FolioWatcher.checkNow(a),true);assert(c.doc.activeElement.matches('#file-list .file-button'));assert.equal(c.doc.activeElement.dataset.docId,a);c.win.FolioWatcher.stopAll();c.close();
});
for(const c of sessions){assert.equal(c.requests.length,0,c.requests.join('\n'));assert.equal(c.errors.length,0,c.errors.join('\n'));c.close();}
const report={generatedAt:new Date().toISOString(),type:'watcher-dom',passed:results.filter(r=>r.status==='PASS').length,total:results.length,tests:results,limitations:['DOM et handles simulés : le sélecteur du navigateur et l’accès aux fichiers réels ne sont pas validés.','Le test de persistance couvre le repli lorsque le handle n’est pas clonable; le clone natif de FileSystemFileHandle dans IndexedDB nécessite un vrai navigateur.']};
fs.writeFileSync(path.join(outputDir,'rapport-watcher-dom.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(outputDir,'rapport-watcher-dom.txt'),[`Validation raccord watcher : ${report.passed}/${report.total}`,...results.map(r=>r.status+' — '+r.name+(r.message?'\n'+r.message:'')),'','Limites :',...report.limitations.map(x=>'- '+x)].join('\n'));print(JSON.stringify(report,null,2));process.exitCode=report.passed===report.total?0:1;
})().catch(e=>{for(const c of sessions)c.close();console.error(e.stack);process.exitCode=1;});
