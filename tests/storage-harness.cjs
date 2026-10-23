'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM,VirtualConsole,requestInterceptor}=require('jsdom');
const fdb=require('fake-indexeddb');
const sourcePath=path.resolve(__dirname,'..','Folio.html');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,reason,{attempts=300,interval=10}={}){
 for(let n=0;n<attempts;n++){if(await predicate())return;await delay(interval);}
 throw new Error('Timeout: '+reason);
}
function freshFactory(){return new fdb.IDBFactory();}
function createSession(factory,options={}){
 const events=[],errors=[],warnings=[],requests=[],downloads=[],connections=new Set();
 const controls={denyOpen:false,quota:false,abortWrite:false,holdCommit:false,...options.controls};
 let serial=0,ctx;
 const record=(type,data={})=>{events.push({sequence:++serial,type,...data});};
 function instrumentConnection(db){
  if(connections.has(db))return;
  connections.add(db);
  const transaction=db.transaction.bind(db),close=db.close.bind(db);
  db.close=()=>{record('connection-close');close();};
  db.transaction=(stores,mode='readonly',txOptions)=>{
   const tx=transaction(stores,mode,txOptions);const id=serial+1;
   record('transaction-start',{id,mode,stores:String(stores)});
   tx.addEventListener('complete',()=>record('transaction-complete',{id,mode}));
   tx.addEventListener('abort',()=>record('transaction-abort',{id,mode,error:tx.error?.name||null}));
   tx.addEventListener('error',()=>record('transaction-error',{id,mode,error:tx.error?.name||null}));
   const objectStore=tx.objectStore.bind(tx);const wrapped=new Map();let held=false;
   tx.objectStore=name=>{
    if(wrapped.has(name))return wrapped.get(name);
    const store=objectStore(name);wrapped.set(name,store);
    const rawGet=store.get.bind(store);
    if(mode==='readwrite'&&controls.holdCommit&&!held){
     held=true;
     const keepAlive=()=>{if(!controls.holdCommit)return;try{const request=rawGet('__folio_qa_hold__');request.addEventListener('success',keepAlive);}catch(_) {}};
     keepAlive();
    }
    for(const method of ['put','add','delete','clear']){
     const original=store[method].bind(store);
     store[method]=(...args)=>{
      record('mutation-request',{id,method,store:name,key:args[1],value:method==='put'||method==='add'?args[0]:undefined});
      if(controls.quota&&mode==='readwrite'){
       record('injected-quota',{id});throw new DOMException('Simulated quota limit','QuotaExceededError');
      }
      const request=original(...args);
      request.addEventListener('success',()=>{
       record('mutation-success',{id,method});
       if(controls.abortWrite&&mode==='readwrite'){
        record('injected-abort',{id});try{tx.abort();}catch(_){}
       }
      });
      return request;
     };
    }
    return store;
   };
   return tx;
  };
 }
 const indexedDB=new Proxy(factory,{get(target,key){
  if(key==='open')return(...args)=>{
   record('open',{name:args[0]});
   if(controls.denyOpen)throw new DOMException('IndexedDB denied by user settings','SecurityError');
   const request=target.open(...args);
   request.addEventListener('success',()=>instrumentConnection(request.result));
   return request;
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const vc=new VirtualConsole();
 vc.on('jsdomError',error=>errors.push(error.message));vc.on('error',(...args)=>errors.push(args.join(' ')));vc.on('warn',(...args)=>warnings.push(args.join(' ')));
 const html=options.html||fs.readFileSync(sourcePath,'utf8');
 const dom=new JSDOM(html,{url:options.url||'https://folio.test/Folio.html',runScripts:'dangerously',pretendToBeVisual:true,
 resources:{interceptors:[requestInterceptor(request=>{requests.push(request.url);return Promise.resolve(new Response('',{status:200}));})]},virtualConsole:vc,
 beforeParse(win){
  win.TextDecoder=TextDecoder;win.TextEncoder=TextEncoder;win.structuredClone=structuredClone;
  Object.defineProperty(win,'indexedDB',{value:indexedDB,configurable:true});
  for(const key of Object.keys(fdb)){if(/^IDB/.test(key))win[key]=fdb[key];}
  win.matchMedia=q=>({matches:false,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
  win.Element.prototype.scrollIntoView=function(){};win.scrollTo=()=>{};win.print=()=>{};
  win.File.prototype.arrayBuffer=function(){return new Promise((resolve,reject)=>{const r=new win.FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsArrayBuffer(this);});};
  win.Blob.prototype.text=function(){return new Promise((resolve,reject)=>{const r=new win.FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsText(this);});};
  const blobs=new Map();win.URL.createObjectURL=blob=>{const id='blob:folio-qa-'+blobs.size;blobs.set(id,blob);return id;};win.URL.revokeObjectURL=()=>{};
  const click=win.HTMLAnchorElement.prototype.click;win.HTMLAnchorElement.prototype.click=function(){if(this.download){downloads.push({filename:this.download,blob:blobs.get(this.href)});return;}return click.call(this);};
  if(!win.HTMLDialogElement.prototype.showModal)win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  if(!win.HTMLDialogElement.prototype.close)win.HTMLDialogElement.prototype.close=function(){this.open=false;};
  win.fetch=(...args)=>{requests.push('fetch: '+String(args[0]));throw new Error('Network forbidden in QA');};win.navigator.sendBeacon=(...args)=>{requests.push('beacon: '+String(args[0]));return false;};
  if(options.beforeParse)options.beforeParse(win);
 }});
 ctx={dom,win:dom.window,doc:dom.window.document,factory,controls,events,errors,warnings,requests,downloads,record,
 close(){controls.holdCommit=false;for(const db of connections){try{db.close();}catch(_){}}dom.window.close();},
 observe(element){const observer=new dom.window.MutationObserver(()=>record('ui-status',{text:element.textContent,checked:element.checked,attributes:[...element.attributes].map(a=>[a.name,a.value])}));observer.observe(element,{childList:true,subtree:true,attributes:true,characterData:true});return observer;}
 };
 return ctx;
}
function file(ctx,name,content,relativePath){
 const f=new ctx.win.File([content],name,{type:/\.png$/i.test(name)?'image/png':'text/markdown'});
 if(relativePath)Object.defineProperty(f,'webkitRelativePath',{value:relativePath});return f;
}
async function imports(ctx,files,folder=false){
 const input=ctx.doc.getElementById(folder?'folder-input':'file-input');Object.defineProperty(input,'files',{configurable:true,value:files});input.dispatchEvent(new ctx.win.Event('change',{bubbles:true}));
 await until(()=>ctx.doc.getElementById('busy-indicator').hidden,'import complete');await delay(30);
}
function activeTab(ctx){return ctx.doc.querySelector('[role="tab"][aria-selected="true"]');}
function selectByTitle(ctx,title){const tab=[...ctx.doc.querySelectorAll('[role="tab"]')].find(t=>t.title===title);if(!tab)throw new Error('Missing tab '+title);tab.click();return tab;}
const imagePNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
module.exports={freshFactory,createSession,file,imports,activeTab,selectByTitle,imagePNG,delay,until};
