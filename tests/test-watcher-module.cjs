'use strict';
const print=(...args)=>{if(require.main===module)console.log(...args);};
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const outputDir=path.join(__dirname,'output');
fs.mkdirSync(outputDir,{recursive:true});
const {freshFactory,createSession,delay,until}=require('./storage-harness.cjs');
const source=fs.readFileSync(path.resolve(__dirname,'..','src','watcher.js'),'utf8');
const results=[],contexts=[];
function setup(supported=true){
 let chosen=null,pickerCalls=[];
 const ctx=createSession(freshFactory(),{html:'<!doctype html><script>'+source+'</script>',beforeParse(win){
  Object.defineProperty(win,'isSecureContext',{value:supported,configurable:true});
  if(supported)win.showOpenFilePicker=async options=>{pickerCalls.push(options);return [chosen];};
 }});contexts.push(ctx);
 ctx.makeHandle=(name='document.md')=>{
  const model={content:'# Initial',lastModified:1,permission:'granted',requestResult:'granted',reads:0,queries:0,requests:0,sequence:[],readWait:null};
  const h={kind:'file',name,async queryPermission(){model.queries++;return model.permission;},async requestPermission(){model.requests++;model.permission=model.requestResult;return model.requestResult;},async getFile(){model.reads++;if(model.readWait)return await model.readWait;const value=model.sequence.length?model.sequence.shift():model;if(value.error)throw value.error;return new ctx.win.File([value.content],name,{type:'text/markdown',lastModified:value.lastModified});}};
  return {handle:h,model};
 };
 ctx.select=h=>chosen=h;ctx.pickerCalls=pickerCalls;ctx.api=ctx.win.FolioWatcher;return ctx;
}
async function test(name,fn){try{await fn();results.push({name,status:'PASS'});print('PASS '+name);}catch(e){results.push({name,status:'FAIL',message:e.stack||String(e)});print('FAIL '+name+' — '+e.message);}}
module.exports=(async()=>{
await test('Disponibilité et sélecteur natif limités au Markdown',async()=>{
 const c=setup();const {handle}=c.makeHandle();c.select(handle);assert.equal(c.api.supported,true);assert.equal(await c.api.link(),handle);assert.equal(c.pickerCalls.length,1);assert.equal(c.pickerCalls[0].multiple,false);assert.equal(c.pickerCalls[0].excludeAcceptAllOption,true);
 const u=setup(false);assert.equal(u.api.supported,false);await assert.rejects(u.api.link(),e=>e.code==='unsupported');c.close();u.close();
});
await test('Lecture initiale stable, modification externe appliquée et version identique ignorée',async()=>{
 const c=setup(),{handle,model}=c.makeHandle(),changes=[],statuses=[];
 assert.equal(await c.api.watch('a',handle,{onChange:async file=>{changes.push(await file.text());},onStatus:s=>statuses.push(s)}),true);assert.equal(model.reads,2);assert.deepEqual(changes,['# Initial']);
 assert.equal(await c.api.checkNow('a'),false);assert.equal(changes.length,1);model.content='# Version suivante';model.lastModified=2;
 assert.equal(await c.api.checkNow('a'),true);assert.deepEqual(changes,['# Initial','# Version suivante']);assert.equal(statuses.at(-1),'watching');assert.equal(model.requests,0);c.api.stopAll();c.close();
});
await test('Fichier en cours d’écriture ignoré puis relu, inspections concurrentes mutualisées',async()=>{
 const c=setup(),{handle,model}=c.makeHandle(),changes=[];model.sequence=[{content:'partiel',lastModified:1},{content:'terminé',lastModified:2}];model.content='terminé';model.lastModified=2;
 assert.equal(await c.api.watch('a',handle,{onChange:async f=>changes.push(await f.text())}),false);assert.equal(changes.length,0);
 const first=c.api.checkNow('a'),second=c.api.checkNow('a');assert.equal(first,second);assert.equal(await first,true);assert.deepEqual(changes,['terminé']);c.api.stopAll();c.close();
});
await test('Permission expirée : pause sans sollicitation automatique, reprise explicite seule',async()=>{
 const c=setup(),{handle,model}=c.makeHandle(),changes=[],statuses=[];model.permission='prompt';assert.equal(await c.api.watch('a',handle,{onChange:f=>changes.push(f),onStatus:s=>statuses.push(s)}),false);
 assert.equal(statuses.at(-1),'paused');assert.equal(model.reads,0);assert.equal(model.requests,0);assert.equal(await c.api.checkNow('a'),false);assert.equal(model.requests,0);
 assert.equal(await c.api.resume('a'),true);assert.equal(model.requests,1);assert.equal(changes.length,1);assert.equal(statuses.at(-1),'watching');c.api.stopAll();c.close();
});
await test('Version rejetée par le lecteur : pas d’acquittement, nouvelle tentative possible',async()=>{
 const c=setup(),{handle}=c.makeHandle();let accepted=false,calls=0;const statuses=[];
 assert.equal(await c.api.watch('a',handle,{onChange(){calls++;return accepted;},onStatus:s=>statuses.push(s)}),false);assert.equal(calls,1);accepted=true;
 assert.equal(await c.api.checkNow('a'),true);assert.equal(calls,2);assert.equal(statuses.at(-1),'watching');c.api.stopAll();c.close();
});
await test('Arrêt pendant traitement asynchrone : token invalidé et aucune application tardive',async()=>{
 const c=setup(),{handle}=c.makeHandle();let release,entered=false,applied=false,context;
 const wait=new Promise(r=>release=r);const work=c.api.watch('a',handle,{async onChange(file,token){context=token;entered=true;await wait;if(!token.isCurrent()||token.signal.aborted)return false;applied=true;return true;}});
 await until(()=>entered,'change callback started');c.api.unwatch('a');assert.equal(context.isCurrent(),false);assert.equal(context.signal.aborted,true);release();assert.equal(await work,false);await delay(10);assert.equal(applied,false);c.close();
});
await test('Page masquée : lecture suspendue, reprise à la visibilité',async()=>{
 const c=setup(),{handle,model}=c.makeHandle();let visibility='hidden',changes=0;Object.defineProperty(c.doc,'visibilityState',{configurable:true,get:()=>visibility});
 assert.equal(await c.api.watch('a',handle,{onChange(){changes++;}}),false);assert.equal(model.reads,0);c.win.dispatchEvent(new c.win.Event('focus'));await delay(20);assert.equal(model.reads,0);
 visibility='visible';c.doc.dispatchEvent(new c.win.Event('visibilitychange'));await until(()=>changes===1,'visible resume');assert.equal(model.reads,2);c.api.stopAll();c.close();
});

await test('Disparition temporaire pendant sauvegarde : retour automatique sans pause durable',async()=>{
 const c=setup(),{handle,model}=c.makeHandle(),changes=[],statuses=[];
 model.sequence=[{error:new c.win.DOMException('temporary atomic replacement','NotFoundError')}];
 assert.equal(await c.api.watch('a',handle,{onChange:async f=>changes.push(await f.text()),onStatus:s=>statuses.push(s)}),false);assert.equal(statuses.at(-1),'checking');assert.equal(changes.length,0);
 model.content='# Fichier revenu';model.lastModified=2;assert.equal(await c.api.checkNow('a'),true);assert.deepEqual(changes,['# Fichier revenu']);assert.equal(statuses.at(-1),'watching');assert.equal(model.requests,0);c.api.stopAll();c.close();
});
await test('Disparition persistante : trois observations espacées, focus rapides sans épuiser le délai',async()=>{
 const c=setup(),{handle,model}=c.makeHandle(),statuses=[];let now=10000;c.win.Date.now=()=>now;model.error=new c.win.DOMException('missing','NotFoundError');
 assert.equal(await c.api.watch('a',handle,{onChange:()=>true,onStatus:s=>statuses.push(s)}),false);assert.equal(statuses.at(-1),'checking');
 for(let i=0;i<6;i++){c.win.dispatchEvent(new c.win.Event('focus'));await c.api.checkNow('a');}assert.equal(statuses.at(-1),'checking');
 now+=1800;await c.api.checkNow('a');assert.equal(statuses.at(-1),'checking');now+=1799;await c.api.checkNow('a');assert.equal(statuses.at(-1),'checking');now+=1;await c.api.checkNow('a');assert.equal(statuses.at(-1),'paused');
 const reads=model.reads;await c.api.checkNow('a');assert.equal(model.reads,reads);delete model.error;assert.equal(await c.api.resume('a'),true);assert.equal(statuses.at(-1),'watching');c.api.stopAll();c.close();
});
await test('Message d’erreur du lecteur transmis, normalisé, borné et non répété sans changement',async()=>{
 const c=setup(),{handle}=c.makeHandle(),statuses=[];let calls=0;const detail=' Réenregistrez ce fichier en UTF-8.\n\t'+'x'.repeat(400);
 const callback={onChange(){calls++;throw new Error(detail);},onStatus:(state,message)=>statuses.push({state,message})};
 assert.equal(await c.api.watch('a',handle,callback),false);assert.equal(statuses.at(-1).state,'error');assert(statuses.at(-1).message.startsWith('Réenregistrez ce fichier en UTF-8.'));assert.equal(statuses.at(-1).message.length,360);assert(!/[\r\n\t]/.test(statuses.at(-1).message));
 const count=statuses.length;assert.equal(await c.api.checkNow('a'),false);assert.equal(calls,2);assert.equal(statuses.length,count);c.api.stopAll();c.close();
});
for(const c of contexts){assert.equal(c.errors.length,0,c.errors.join('\n'));assert.equal(c.requests.length,0,c.requests.join('\n'));c.close();}
const report={generatedAt:new Date().toISOString(),type:'watcher-module',passed:results.filter(r=>r.status==='PASS').length,total:results.length,tests:results,limitations:['Handles de fichiers simulés; aucun accès au système de fichiers réel.','Ces tests valident le module et ses callbacks, pas encore le raccord UI.','Les autorisations propres aux navigateurs et le clone IndexedDB de FileSystemFileHandle natifs ne sont pas reproduits.']};
fs.writeFileSync(path.join(outputDir,'rapport-watcher-module.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(outputDir,'rapport-watcher-module.txt'),[`Validation module watcher : ${report.passed}/${report.total}`, ...results.map(r=>r.status+' — '+r.name+(r.message?'\n'+r.message:'')),'','Limites :',...report.limitations.map(x=>'- '+x)].join('\n'));print(JSON.stringify(report,null,2));process.exitCode=report.passed===report.total?0:1;
})().catch(e=>{for(const c of contexts)c.close();console.error(e.stack);process.exitCode=1;});
