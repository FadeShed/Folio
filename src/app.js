/* Folio — interface autonome. Optional opt-in IndexedDB copies; no analytics or network APIs. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ICONS = {
    brand:'<rect x="7" y="3" width="13" height="17" rx="1.5"/><path d="M4 7v14a1 1 0 0 0 1 1h11M11 8h5M11 12h5"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    file:'<path d="M14 3H5v18h14V8zM14 3v6h5M8 13h8M8 17h6"/>',
    shield:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    moon:'<path d="M20.9 13.2A9 9 0 0 1 10.8 3.1a9 9 0 1 0 10.1 10.1Z"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.4 8.5a2.7 2.7 0 0 1 5.2.8c0 2-2.6 2.1-2.6 4.2M12 17h.01"/>',
    chevron:'<path d="m9 6 6 6-6 6"/>',
    down:'<path d="m6 9 6 6 6-6"/>',
    arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>',
    trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
    paste:'<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 3h6v4H9zM9 12h6M9 16h4"/>',
    upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
    download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    tabs:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v5M15 4v5"/>',
    math:'<path d="M4 13h3l3 7L15 4h6M17 10l4 6m0-6-4 6"/>',
    code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
    print:'<path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7zM17 11h.01"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    sync:'<path d="M3 11a9 9 0 0 1 15.5-6.3L21 7M21 3v4h-4M21 13a9 9 0 0 1-15.5 6.3L3 17M3 21v-4h4"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 16-6-6L3 21"/>'
  };
  function icon(name) { return '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(ICONS[name]||ICONS.file)+'</svg>'; }
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML=icon(el.dataset.icon); });
  const state = {docs:[], assets:new Map(), active:null, next:1, source:false, busy:false, dragDepth:0};
  const pasteState = {submitting:false,returnFocus:null};
  const local = {ready:false, requested:false, committed:false, revision:0, running:false, dirty:false, timer:0, error:null, blocked:null, savedCount:0, handlesDisabled:false};
  const MAX_DOC = 5*1024*1024, MAX_IMAGE=15*1024*1024, MAX_TOTAL=80*1024*1024, MAX_COUNT=200;
  const MAX_ASSETS=3000, MAX_IMPORT_ENTRIES=3000, MAX_DEPTH=64, MAX_PATH=4096, MAX_RENDER_NODES=200000, MAX_EXPORT=80*1024*1024;
  const MD_PATTERN=/\.(?:md|markdown|mdown|mkd)$/i;
  const IMAGE_TYPES={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif'};
  const DEMOS = [
    {path:'Bienvenue.md', content:String.raw`# Vos idées, au clair

Un espace calme pour lire vos notes, vos cours et vos documents de recherche. **Tout se passe dans votre navigateur.**

## Une collection à parcourir

Importez vos fichiers Markdown, puis passez d’un document à l’autre avec les onglets. Chaque titre alimente automatiquement le sommaire.

> La mise en page laisse respirer le texte. À vous de lui donner quelque chose à raconter.

- Des **titres** qui structurent la lecture.
- Des *citations*, des listes et des tableaux lisibles.
- Des formules mathématiques, même sans connexion.

## Les petits détails font la différence

| Élément | Exemple | Prise en charge |
| :-- | :-- | :--: |
| Mise en forme | Gras, italique, liens | Oui |
| Navigation | Onglets et sommaire | Oui |
| Mathématiques | Fractions, intégrales, matrices | Oui |
| Export | Page seule ou collection | Oui |

### Quelques cases à cocher

- [x] Lire un premier document
- [x] Retrouver ses titres dans le sommaire
- [ ] Importer ses propres notes
- [ ] Télécharger une collection HTML

## Et maintenant ?

Ouvrez le [carnet de mathématiques](Mathematiques.md#une-integrale), ou découvrez les [conseils d’utilisation](Mode-emploi.md).

Ces trois documents sont des exemples. Vous pouvez les fermer ou vider la collection avant d’importer vos fichiers.
`},
    {path:'Mathematiques.md', content:String.raw`# Un carnet de mathématiques

La notation mathématique fait partie de la lecture. Une formule en ligne, comme $E = mc^2$, s’intègre naturellement à la phrase.

## Une intégrale

Les formules en bloc disposent de leur propre espace :

$$
\int_0^1 x^2\,\mathrm{d}x = \left[\frac{x^3}{3}\right]_0^1 = \frac{1}{3}
$$

## Des matrices

$$
A = \begin{pmatrix}
1 & 2 \\
3 & 4
\end{pmatrix}, \qquad \det(A) = 1\cdot4 - 2\cdot3 = -2
$$

## Sommes et probabilités

La formule du binôme :

$$
(a+b)^n = \sum_{k=0}^{n} \binom{n}{k} a^{n-k}b^k
$$

Une densité gaussienne :

\[
f(x)=\frac{1}{\sigma\sqrt{2\pi}}\exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right)
\]

### Écrire une formule

Les délimiteurs dollar et les parenthèses précédées d’une barre oblique inverse sont reconnus.

Pour une vraie formule en ligne : \(a^2+b^2=c^2\).

Un prix n’est pas une formule : écrivez \$12 pour afficher un dollar littéral.

[Retour à l’accueil](Bienvenue.md)
`},
    {path:'Mode-emploi.md', content:'# Emporter sa bibliothèque\n\nQuelques repères pour profiter de Folio.\n\n## Importer des documents\n\nSélectionnez plusieurs fichiers `.md` ou `.markdown`, ou glissez-les dans la fenêtre. Le bouton **Ouvrir un dossier** permet de conserver l’arborescence d’un ensemble de notes.\n\n### Images locales\n\nImportez les images avec vos notes. Un chemin comme `images/schema.png` sera résolu à partir du dossier du Markdown. Les images distantes restent bloquées pour préserver la confidentialité.\n\n## Télécharger des pages\n\nLe menu **Télécharger** propose deux formats :\n\n1. **Le document affiché** : une page HTML déjà rendue.\n2. **Toute la collection** : un HTML autonome avec tous les onglets.\n\nLa mise en page, les formules et les images locales sont intégrées. Vous pouvez ouvrir ou héberger le résultat tel quel.\n\n## Le code reste du code\n\n```python\ndef energie(masse, c=299_792_458):\n    return masse * c ** 2\n\nprint(energie(1))\n```\n\n```markdown\nUne formule $E = mc^2$ est conservée telle quelle\ndans un bloc de code.\n```\n\n## Votre espace reste local\n\nAucun compte ni envoi de documents. Sans mémorisation, recharger la page vide la collection. Pour retrouver vos notes à la prochaine ouverture, cochez **Mémoriser cette collection sur cet appareil** dans la colonne de gauche. Une copie reste alors dans ce navigateur ; décocher la case l’efface. Les fichiers téléchargés restent disponibles à l’endroit où vous les enregistrez.\n\n[Revenir au carnet de mathématiques](Mathematiques.md)\n'}
  ];
  let toastTimer=0, scrollFrame=0;
  function notify(message, long=false) { clearTimeout(toastTimer); $('toast-message').textContent=message; $('toast').hidden=false; toastTimer=setTimeout(()=>$('toast').hidden=true,long?12000:5500); }
  function normalizePath(value) {
    const parts=[];
    for (const part of String(value||'').replace(/\\/g,'/').split('/')) {
      if(!part || part==='.') continue;
      if(part==='..') {parts.pop();continue;}
      parts.push(part);
    }
    return parts.join('/');
  }
  const baseName=path=>path.split('/').pop()||path;
  const directory=path=>path.includes('/')?path.slice(0,path.lastIndexOf('/')+1):'';
  const normalizeSearch=value=>String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr');
  const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const plainTitle=doc=>doc.rendered.title||baseName(doc.path).replace(MD_PATTERN,'');
  const activeDoc=()=>state.docs.find(doc=>doc.id===state.active);
  const newWatch=()=>({enabled:false,handle:null,status:'off',message:'',choosing:false,updatedAt:null});
  function setBusyUI(busy) {
    state.busy=busy;
    document.querySelectorAll('[data-action],.file-remove,#clear-all,#confirm-clear,#load-demo,#export-toggle').forEach(button=>button.disabled=busy);
    updateStorageUI();updateWatchUI();updatePasteUI();
  }
  function updateStorageUI() {
    const input=$('remember-collection'),status=$('storage-status'),retry=$('storage-retry');
    input.checked=local.requested;
    input.disabled=!local.ready||state.busy||['unavailable','conflict','corrupt'].includes(local.blocked);
    retry.hidden=!local.error||local.blocked==='corrupt';retry.disabled=local.running;
    retry.textContent=local.blocked==='conflict'||local.blocked==='unavailable'?'Recharger la page':local.blocked==='invalid'?'Effacer la copie illisible':'Réessayer';
    let mode='off',message='Session temporaire · rien n’est mémorisé.';
    if(!local.ready){mode='loading';message='Recherche d’une collection mémorisée…';}
    else if(local.blocked==='corrupt'){mode='corrupt';message='L’enregistrement local est illisible ; son effacement n’est pas confirmé. Effacez les données de ce site dans les réglages du navigateur, puis rechargez Folio. La lecture et les exports restent disponibles.';}
    else if(local.blocked==='conflict'){mode='conflict';message='Copie modifiée dans un autre onglet. Enregistrement suspendu : rechargez la page pour la retrouver.';}
    else if(local.blocked==='unavailable'){mode='unavailable';message='Mémorisation indisponible. La lecture et les exports restent disponibles.';}
    else if(local.error){mode='error';message=local.blocked==='invalid'?'La copie enregistrée est illisible. Vous pouvez l’effacer puis réimporter vos documents.':!local.requested?'Effacement non confirmé. Une copie peut encore être présente dans ce navigateur.':local.committed?'Modifications non enregistrées. La dernière copie mémorisée a été conservée.':'Collection non mémorisée. '+(local.error.code==='quota'?'L’espace disponible est insuffisant.':'L’enregistrement a échoué.');}
    else if(local.running||local.dirty){mode=local.requested?'saving':'removing';message=local.requested?'Enregistrement de la collection…':'Effacement de la copie mémorisée…';}
    else if(local.committed){mode='saved';message='Collection mémorisée · '+local.savedCount+' document'+(local.savedCount>1?'s':'')+'.';}
    status.dataset.state=mode;status.textContent=message;$('remember-control').dataset.status=mode;
    $('remember-help').textContent=local.handlesDisabled?'Copie locale ; les originaux devront être reliés à la prochaine ouverture.':'Une copie locale, dans ce navigateur.';
  }
  function collectionSnapshot() {
    return {schema:1,docs:state.docs.map(doc=>({path:doc.path,content:doc.content,size:doc.size,watch:{enabled:!!doc.watch?.enabled,handle:doc.watch?.enabled&&!local.handlesDisabled?doc.watch.handle:null}})),assets:[...state.assets.values()].map(item=>({path:item.path,data:item.data,size:item.size})),activePath:activeDoc()?.path||null};
  }
  function persistenceChanged(delay=0) {
    if(!local.ready||!local.requested||local.blocked)return;
    local.dirty=true;clearTimeout(local.timer);local.timer=0;updateStorageUI();
    if(local.error||state.busy)return;
    if(delay)local.timer=setTimeout(()=>{local.timer=0;flushPersistence();},delay);
    else flushPersistence();
  }
  async function flushPersistence() {
    if(!local.ready||state.busy||local.running||local.blocked||local.error||!local.dirty)return;
    clearTimeout(local.timer);local.timer=0;local.running=true;updateStorageUI();
    while(local.dirty&&!local.blocked&&!local.error&&!state.busy){
      const requested=local.requested,snapshot=requested?collectionSnapshot():null;local.dirty=false;
      try {
        const result=requested?await FolioStorage.write(snapshot,local.revision):await FolioStorage.remove(local.revision);
        local.revision=result.revision;local.committed=result.enabled;local.savedCount=snapshot?.docs.length||0;
      } catch(error) {
        // Some implementations cannot clone file handles. Preserve the document
        // copies and the intent to follow, then ask to link originals next time.
        if(requested&&error.cause?.name==='DataCloneError'&&!local.handlesDisabled&&snapshot.docs.some(doc=>doc.watch.handle)){
          local.handlesDisabled=true;local.dirty=true;continue;
        }
        local.error=error;local.dirty=true;
        if(error.code==='conflict')local.blocked='conflict';
        notify(error.code==='conflict'?'Un autre onglet a modifié la copie locale. Vos documents restent affichés ; exportez-les avant de recharger si nécessaire.':!requested?'L’effacement local n’a pas pu être confirmé. Utilisez « Réessayer » dans la colonne de gauche.':'La collection n’a pas pu être enregistrée. Vos documents restent affichés ; vous pouvez les exporter.',true);
      }
    }
    local.running=false;updateStorageUI();
  }
  function validReadHandle(handle) {return !!handle&&handle.kind==='file'&&typeof handle.getFile==='function'&&typeof handle.queryPermission==='function'&&typeof handle.requestPermission==='function';}
  async function restoreSnapshot(snapshot) {
    const invalid=()=>{throw new Error('Copie locale invalide.');};
    if(!snapshot||snapshot.schema!==1||!Array.isArray(snapshot.docs)||!Array.isArray(snapshot.assets)||snapshot.docs.length>MAX_COUNT||snapshot.assets.length>MAX_ASSETS)invalid();
    const docs=[],assets=new Map(),paths=new Set();let total=0,nodes=0;
    for(const item of snapshot.docs){
      if(!item||typeof item.path!=='string'||!item.path||item.path.length>MAX_PATH||typeof item.content!=='string'||item.content.includes('\0'))invalid();
      const path=normalizePath(item.path);if(!path||paths.has(path)||!MD_PATTERN.test(path))invalid();paths.add(path);
      const size=new TextEncoder().encode(item.content).length;if(size>MAX_DOC||(total+=size)>MAX_TOTAL)invalid();
      const rendered=await FolioRenderer.renderAsync(item.content),watch=newWatch();
      if((nodes+=rendered.nodeCount)>MAX_RENDER_NODES)invalid();
      if(item.watch?.enabled===true){watch.enabled=true;watch.handle=validReadHandle(item.watch.handle)?item.watch.handle:null;watch.status='paused';watch.message=watch.handle?'Vérification de l’accès au fichier…':'Choisissez le fichier original pour reprendre le suivi.';}
      docs.push({id:'d'+state.next++,path,content:item.content,size,rendered,scroll:0,sourceScroll:0,search:normalizeSearch(path+'\n'+rendered.title+'\n'+item.content),watch});
    }
    for(const item of snapshot.assets){
      if(!item||typeof item.path!=='string'||!item.path||item.path.length>MAX_PATH||typeof item.data!=='string')invalid();
      const path=normalizePath(item.path);if(!path||assets.has(path))invalid();
      const match=/^data:image\/(?:png|jpeg|gif|webp|avif);base64,([A-Za-z0-9+/]*={0,2})$/.exec(item.data);if(!match||match[1].length%4!==0)invalid();
      const size=match[1].length*3/4-(match[1].endsWith('==')?2:match[1].endsWith('=')?1:0);if(size>MAX_IMAGE||(total+=size)>MAX_TOTAL)invalid();
      assets.set(path,{path,data:item.data,size});
    }
    state.docs=docs;state.assets=assets;
    const active=docs.find(doc=>doc.path===snapshot.activePath)||docs[0];
    if(active)setActive(active.id,{closeSidebar:false,skipPersist:true});else showEmpty();
  }
  async function initializePersistence() {
    setBusyUI(true);
    try {
      const saved=await FolioStorage.read();local.revision=saved.revision;local.requested=saved.enabled;local.committed=saved.enabled;
      if(saved.enabled){
        try{await restoreSnapshot(saved.snapshot);local.savedCount=state.docs.length;}
        catch(error){local.error=error;local.blocked='invalid';}
      }
    }catch(error){local.error=error;local.blocked=error.code==='invalid'?'corrupt':'unavailable';}
    finally{local.ready=true;setBusyUI(false);}
    if(!local.blocked)for(const doc of state.docs)if(doc.watch.enabled&&doc.watch.handle)startWatching(doc);
  }
  function closeWatchMenu(returnFocus=false) {
    const open=!$('watch-menu').hidden;$('watch-menu').hidden=true;$('watch-menu-toggle').setAttribute('aria-expanded','false');
    if(open&&returnFocus)$('watch-menu-toggle').focus();
  }
  function updateWatchUI() {
    const doc=activeDoc(),watch=doc?.watch||newWatch(),available=!!window.FolioWatcher?.supported;
    const toggle=$('watch-toggle'),status=$('watch-status'),reconnect=$('watch-reconnect');
    if(!toggle)return;
    toggle.checked=watch.enabled;toggle.disabled=!doc||state.busy||watch.choosing||!available&&!watch.enabled;
    $('watch-filename').textContent=doc?baseName(doc.path):'';
    let mode=watch.choosing?'checking':watch.status;
    let message=watch.choosing?'Choisissez le fichier original dans le sélecteur du navigateur.':watch.message;
    if(!available){mode='unavailable';message='Suivi indisponible dans ce navigateur ou ce contexte. Réimportez le Markdown pour le mettre à jour.';}
    else if(!watch.enabled){mode='off';message='Cochez la case puis sélectionnez l’original. Folio relira ce fichier pendant que la page est ouverte.';}
    else if(mode==='watching')message='Suivi actif · vérification environ toutes les 2 s quand la page est visible.'+(watch.updatedAt?' Mis à jour à '+new Date(watch.updatedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+'.':'');
    status.dataset.state=mode;status.textContent=message||'Vérification du fichier…';
    $('watch-menu-toggle').dataset.state=watch.enabled?mode:'off';
    $('watch-menu-toggle').title=watch.enabled?'Suivi du fichier : '+(mode==='watching'?'actif':'en attente'):'Suivi du fichier original';
    reconnect.hidden=!available||!watch.enabled||watch.choosing||!['paused','error'].includes(mode);
    reconnect.disabled=state.busy;
    reconnect.textContent=watch.handle?'Rétablir l’accès':'Choisir l’original';
    $('watch-relink').hidden=!available||!watch.enabled||!watch.handle||watch.choosing;
    $('watch-relink').disabled=state.busy;
  }
  async function applyWatchedFile(doc,watch,file,context) {
    const current=()=>context.isCurrent()&&state.docs.includes(doc)&&doc.watch===watch&&watch.enabled;
    if(!current()||state.busy)return false;
    if(file.size>MAX_DOC||totalBytes()-doc.size+file.size>MAX_TOTAL)throw new Error('Le fichier dépasse la limite de taille. La dernière version lisible reste affichée.');
    const bytes=await file.arrayBuffer();if(!current()||state.busy)return false;
    let content;try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');}catch(_){throw new Error('Enregistrez le fichier en UTF-8 pour reprendre le suivi.');}
    if(content.includes('\0'))throw new Error('Ce fichier ne semble pas être du texte Markdown. La dernière version lisible reste affichée.');
    if(totalBytes()-doc.size+file.size>MAX_TOTAL)throw new Error('La collection dépasse la limite de 80 Mio.');
    if(content===doc.content)return true;
    const rendered=await FolioRenderer.renderAsync(content);if(!current()||state.busy)return false;
    if(totalBytes()-doc.size+file.size>MAX_TOTAL)throw new Error('La collection dépasse la limite de 80 Mio.');
    checkRenderBudget(rendered,doc);
    doc.content=content;doc.size=file.size;doc.rendered=rendered;doc.search=normalizeSearch(doc.path+'\n'+rendered.title+'\n'+content);watch.updatedAt=Date.now();
    if(state.active===doc.id)setActive(doc.id,{closeSidebar:false,preserveSource:true,keepMenus:true,skipPersist:true});else updateFileList();
    persistenceChanged();return true;
  }
  function startWatching(doc) {
    const watch=doc.watch;if(!watch?.enabled||!watch.handle)return;
    if(!FolioWatcher.supported){watch.status='paused';watch.message='Ce navigateur ne permet pas de reprendre le suivi de l’original.';updateWatchUI();return;}
    return FolioWatcher.watch(doc.id,watch.handle,{
      onChange:(file,context)=>applyWatchedFile(doc,watch,file,context),
      onStatus:(mode,message)=>{if(!state.docs.includes(doc)||doc.watch!==watch)return;watch.status=mode;watch.message=message;if(state.active===doc.id)updateWatchUI();}
    });
  }
  async function linkOriginal(doc) {
    if(!doc||state.busy||doc.watch.choosing||!FolioWatcher.supported)return;
    const selection=FolioWatcher.link(); // Must remain directly in the user's gesture.
    doc.watch.choosing=true;updateWatchUI();
    try {
      const handle=await selection;if(!state.docs.includes(doc))return;
      if(handle.name!==baseName(doc.path))throw new Error('Choisissez le fichier « '+baseName(doc.path)+' ». Pour un autre nom, importez d’abord ce document.');
      FolioWatcher.unwatch(doc.id);doc.watch={...newWatch(),enabled:true,handle,status:'checking',message:'Vérification du fichier original…'};
      updateWatchUI();persistenceChanged();startWatching(doc);
    }catch(error){if(error.name!=='AbortError')notify('Le suivi n’a pas pu être activé : '+(error.name==='SecurityError'?'le navigateur bloque ce sélecteur dans ce contexte. Ouvrez Folio directement dans un navigateur compatible, depuis un site HTTPS.':error.message||'accès indisponible.'),true);}
    finally{doc.watch.choosing=false;if(state.docs.includes(doc))updateWatchUI();}
  }
  function splitReference(reference) {
    let raw=String(reference||'').trim(), hash='';
    const index=raw.indexOf('#'); if(index>=0){hash=raw.slice(index+1);raw=raw.slice(0,index);}
    raw=raw.split('?')[0];
    try {raw=decodeURIComponent(raw);} catch(_){}
    return {path:raw.replace(/\\/g,'/'),hash};
  }
  function resolvePath(reference, fromPath, collection) {
    const ref=splitReference(reference), values=Array.isArray(collection)?collection:[...collection.values()];
    if(!ref.path) return {item:values.find(item=>item.path===fromPath)||null, hash:ref.hash};
    const relative=normalizePath((ref.path.startsWith('/')?'':directory(fromPath))+ref.path);
    let matches=values.filter(item=>item.path===relative);
    if(matches.length===1) return {item:matches[0],hash:ref.hash};
    const direct=normalizePath(ref.path);
    matches=values.filter(item=>item.path===direct);
    if(matches.length===1) return {item:matches[0],hash:ref.hash};
    // Native file systems may spell the same accent with composed/decomposed
    // Unicode. Keep exact identities; use a canonical match only if unique.
    for(const candidate of [relative,direct]){
      matches=values.filter(item=>item.path.normalize('NFC')===candidate.normalize('NFC'));
      if(matches.length===1)return {item:matches[0],hash:ref.hash};
      if(matches.length>1)return {item:null,ambiguous:true,hash:ref.hash};
    }
    // Directory imports include a root folder name; accept a unique exact suffix.
    if(direct.includes('/') && !ref.path.includes('..')) {
      matches=values.filter(item=>item.path.normalize('NFC').endsWith('/'+direct.normalize('NFC')));
      if(matches.length===1) return {item:matches[0],hash:ref.hash};
      if(matches.length>1) return {item:null,ambiguous:true,hash:ref.hash};
    }
    matches=values.filter(item=>baseName(item.path)===baseName(ref.path));
    if(!matches.length)matches=values.filter(item=>baseName(item.path).normalize('NFC')===baseName(ref.path).normalize('NFC'));
    return {item:matches.length===1?matches[0]:null,ambiguous:matches.length>1,hash:ref.hash};
  }
  const isExternal=href=>/^(?:https?:)?\/\//i.test(href);
  const isScheme=href=>/^[a-z][a-z\d+.-]*:/i.test(href);
  function syncDocumentPanels() {
    const card=$('file-list').querySelector('.file-item.active'),actions=$('document-actions'),metadata=$('document-metadata');
    const actionSlot=card?.querySelector('.file-actions-slot')||$('document-actions-parking');
    const metaSlot=card&&matchMedia('(max-width:1050px)').matches?card.querySelector('.file-meta-slot'):$('metadata-sidebar-slot');
    if(actions.parentElement!==actionSlot)actionSlot.append(actions);
    if(metadata.parentElement!==metaSlot)metaSlot.append(metadata);
    actions.hidden=!card;metadata.hidden=!state.active;
    actions.setAttribute('aria-label',activeDoc()?'Actions pour '+baseName(activeDoc().path):'Actions du document');
  }
  function focusCollectionControl(control) {
    if(matchMedia('(max-width:760px)').matches&&!$('sidebar').classList.contains('is-open'))$('sidebar-toggle').focus({preventScroll:true});
    else control?.focus({preventScroll:true});
  }
  function setSidebar(open,options={}) {
    $('sidebar').classList.toggle('is-open',open);$('mobile-backdrop').classList.toggle('is-open',open);$('sidebar-toggle').setAttribute('aria-expanded',String(open));
    if(open&&options.focus)$('sidebar-close').focus();
    if(!open&&options.returnFocus)$('sidebar-toggle').focus();
  }
  function updateFileList() {
    const focused=document.activeElement,actions=$('document-actions'),metadata=$('document-metadata'),list=$('file-list');
    const actionFocused=actions.contains(focused),fileFocused=focused?.matches('.file-button,.file-remove');
    const focusedId=fileFocused?(focused.dataset.docId||focused.dataset.removeId):null,removeFocused=!!focused?.dataset.removeId;
    const scroll=list.scrollTop;
    const query=normalizeSearch($('search').value.trim());
    const matches=state.docs.filter(doc=>!query||doc.search.includes(query));
    // Keep the document being read, and its controls, available while filtering.
    const docs=state.docs.filter(doc=>doc.id===state.active||matches.includes(doc));
    $('doc-count').textContent=String(state.docs.length);
    $('clear-all').hidden=!state.docs.length&&!state.assets.size;
    // Park the live controls before replacing cards: listeners, open menus and
    // file permissions belong to this one panel, never to a cloned toolbar.
    $('document-actions-parking').append(actions);
    $('metadata-sidebar-slot').append(metadata);
    const fragment=document.createDocumentFragment();
    if(!matches.length) {
      const li=document.createElement('li');li.className='sidebar-empty';
      li.innerHTML=icon(query?'search':'file');
      const text=document.createElement('span');text.textContent=query?'Aucun document trouvé.':'Votre collection commence ici.\nAjoutez vos premiers documents.';text.style.whiteSpace='pre-line';li.append(text);fragment.append(li);
    }
    docs.forEach(doc=>{
      const active=state.active===doc.id,outside=!!query&&!doc.search.includes(query);
      const li=document.createElement('li');li.className='file-item'+(active?' active':'')+(outside?' outside-search':'');li.dataset.docId=doc.id;
      const header=document.createElement('div');header.className='file-card-header';
      const button=document.createElement('button');button.className='file-button'+(state.active===doc.id?' active':'');button.dataset.docId=doc.id;button.title=doc.path;button.setAttribute('aria-current',state.active===doc.id?'page':'false');button.innerHTML=icon('file');
      const info=document.createElement('span');info.className='file-info';
      const name=document.createElement('span');name.className='file-name';name.textContent=baseName(doc.path);
      const subtitle=document.createElement('span');subtitle.className='file-path';subtitle.textContent=directory(doc.path).replace(/\/$/,'')||plainTitle(doc);
      info.append(name,subtitle);button.append(info);
      const remove=document.createElement('button');remove.type='button';remove.className='file-remove';remove.dataset.removeId=doc.id;remove.disabled=state.busy;remove.setAttribute('aria-label','Supprimer '+baseName(doc.path)+' de la collection');remove.title='Supprimer de la collection · l’original est conservé';remove.innerHTML=icon('trash');
      header.append(button,remove);li.append(header);
      if(outside){const context=document.createElement('p');context.className='file-context';context.textContent='En lecture · hors résultats';li.append(context);}
      const metaSlot=document.createElement('div');metaSlot.className='file-meta-slot';
      const actionSlot=document.createElement('div');actionSlot.className='file-actions-slot';li.append(metaSlot,actionSlot);fragment.append(li);
    });
    list.replaceChildren(fragment);syncDocumentPanels();list.scrollTop=scroll;
    if(actionFocused&&state.active)focusCollectionControl(focused);
    else if(focusedId)focusCollectionControl(list.querySelector(removeFocused?'.file-remove[data-remove-id="'+focusedId+'"]':'.file-button[data-doc-id="'+focusedId+'"]'));
  }
  function updateTabs() {
    const focused=document.activeElement?.closest('.tab-item'),focusedId=focused?.querySelector('[data-doc-id]')?.dataset.docId,focusedClose=!!document.activeElement?.dataset.closeId;
    const fragment=document.createDocumentFragment();
    if(!state.docs.length){const empty=document.createElement('div');empty.className='welcome-tab';empty.innerHTML=icon('file');empty.append(document.createTextNode('Votre espace de lecture'));fragment.append(empty);}
    state.docs.forEach(doc=>{
      const item=document.createElement('div');item.className='tab-item'+(doc.id===state.active?' active':'');item.setAttribute('role','presentation');
      const button=document.createElement('button');button.className='doc-tab';button.id='tab-'+doc.id;button.dataset.docId=doc.id;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(doc.id===state.active));button.setAttribute('aria-controls','reader');button.tabIndex=doc.id===state.active?0:-1;button.title=doc.path;button.innerHTML=icon('file');
      const label=document.createElement('span');label.className='tab-title';label.textContent=baseName(doc.path);button.append(label);
      const close=document.createElement('button');close.className='tab-close';close.dataset.closeId=doc.id;close.setAttribute('aria-label','Retirer '+baseName(doc.path)+' de la collection');close.title='Retirer de la collection';close.tabIndex=-1;close.innerHTML=icon('close');
      item.append(button,close);fragment.append(item);
    });
    $('tab-list').replaceChildren(fragment);
    if(focusedId){const target=focusedClose?$('tab-list').querySelector('[data-close-id="'+focusedId+'"]'):$('tab-'+focusedId);target?.focus({preventScroll:true});}
    const selected=$('tab-'+state.active); if(selected)selected.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  function imagePlaceholder(img,reason) {
    const box=document.createElement('span');box.className='image-placeholder';box.innerHTML=icon('image');
    const text=document.createElement('span'),title=document.createElement('strong'),description=document.createElement('small');
    title.textContent=img.getAttribute('alt')||'Image';description.textContent=reason;text.append(title,description);box.append(text);img.replaceWith(box);
  }
  function hydrateImages(root,doc) {
    for(const img of root.querySelectorAll('img')) {
      // Only the local diagram module creates this class after sanitisation.
      // Its SVG data image is already complete and is not an imported asset.
      if(img.classList.contains('mermaid-diagram'))continue;
      const src=img.getAttribute('data-folio-src')||'';img.removeAttribute('data-folio-src');
      if(/^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(src)) {img.src=src;continue;}
      if(isExternal(src)||isScheme(src)) {imagePlaceholder(img,'Image distante bloquée · importez une copie locale pour l’afficher.');continue;}
      const match=src?resolvePath(src,doc.path,state.assets):{};
      if(match.item) {img.src=match.item.data;img.addEventListener('error',()=>imagePlaceholder(img,'Cette image locale ne peut pas être lue.'),{once:true});}
      else imagePlaceholder(img,match.ambiguous?'Plusieurs images portent ce nom. Importez le dossier avec ses chemins.':'Image locale manquante'+(src?' : '+splitReference(src).path:''));
    }
  }
  function decorateCode(root,interactive) {
    for(const pre of root.querySelectorAll('pre')) {
      const code=pre.querySelector('code');if(!code)continue;
      const wrapper=document.createElement('div');wrapper.className='code-wrap';
      const bar=document.createElement('div');bar.className='code-bar';
      const language=document.createElement('span'),label=(code.className.match(/language-([a-z0-9_+-]+)/i)||[])[1]||'texte';language.textContent=label.length>80?label.slice(0,79)+'…':label;bar.append(language);
      if(interactive){const copy=document.createElement('button');copy.type='button';copy.className='copy-code';copy.textContent='Copier';copy.setAttribute('aria-label','Copier le bloc de code');copy.addEventListener('click',async()=>{if(await copyText(code.textContent)){copy.textContent='Copié';setTimeout(()=>copy.textContent='Copier',1800);}});bar.append(copy);}
      pre.replaceWith(wrapper);wrapper.append(bar,pre);
    }
  }
  async function copyText(text) {
    try { if(navigator.clipboard && window.isSecureContext){await navigator.clipboard.writeText(text);return true;} } catch(_){}
    const textarea=document.createElement('textarea');textarea.value=text;textarea.style.cssText='position:fixed;left:-10000px;top:0';document.body.append(textarea);textarea.select();
    let success=false;try{success=document.execCommand('copy');}catch(_){}textarea.remove();if(!success)notify('La copie automatique est indisponible. Sélectionnez le texte du bloc.');return success;
  }
  function buildContent(doc,interactive) {
    const container=document.createElement('div');container.append(doc.rendered.fragment.cloneNode(true));
    if(!doc.rendered.headings.some(h=>h.level===1)) {const title=document.createElement('h1');title.textContent=plainTitle(doc);container.prepend(title);}
    if(!doc.content.trim()) {const note=document.createElement('p');note.className='notice-empty';note.textContent='Ce document est vide.';container.append(note);}
    hydrateImages(container,doc);decorateCode(container,interactive);return container;
  }
  function updateOutline(doc) {
    const container=$('outline-list');container.replaceChildren();
    let headings=doc.rendered.headings.filter(h=>h.level>1&&h.level<5);
    if(!headings.length)headings=doc.rendered.headings.slice(0,40);
    if(!headings.length){const p=document.createElement('p');p.className='outline-empty';p.textContent='Les titres de votre document apparaîtront ici.';container.append(p);return;}
    for(const heading of headings){const button=document.createElement('button');button.className='outline-link level-'+heading.level;button.dataset.heading=heading.id;button.textContent=heading.text;button.addEventListener('click',()=>jumpTo(heading.id));container.append(button);}
  }
  function updateProgress() {
    const scroll=$('reader-scroll');const max=scroll.scrollHeight-scroll.clientHeight;
    $('progress-bar').style.width=(max>0?Math.min(100,Math.max(0,scroll.scrollTop/max*100)):100)+'%';
    const doc=activeDoc();if(!doc||state.source)return;
    let selected=null;const top=scroll.getBoundingClientRect().top;
    for(const heading of doc.rendered.headings){const node=$(heading.id);if(node&&node.getBoundingClientRect().top<top+100)selected=heading.id;}
    $('outline-list').querySelectorAll('[data-heading]').forEach(button=>button.classList.toggle('current',button.dataset.heading===selected));
  }
  function rememberScroll() {const doc=activeDoc();if(doc)doc[state.source?'sourceScroll':'scroll']=$('reader-scroll').scrollTop;}
  function setActive(id,options={}) {
    const doc=state.docs.find(item=>item.id===id);if(!doc)return;
    const changed=state.active!==id,source=!!(options.preserveSource&&state.source);
    const focusFromSidebar=options.closeSidebar!==false&&$('sidebar').classList.contains('is-open')&&$('sidebar').contains(document.activeElement);
    rememberScroll();state.active=id;state.source=source;
    $('welcome').hidden=true;$('reader').hidden=false;$('reader').classList.toggle('source-mode',source);$('source-view').hidden=!source;$('article').hidden=source;$('source-toggle').setAttribute('aria-pressed',String(source));$('source-toggle').title=source?'Afficher la page mise en forme':'Afficher le Markdown source';
    $('document-kicker').textContent=doc.path;
    $('reading-time').textContent=Math.max(1,Math.ceil(doc.rendered.wordCount/220))+' min de lecture';
    $('word-count').textContent=doc.rendered.wordCount.toLocaleString('fr-FR')+' mots';
    $('reader').setAttribute('aria-labelledby','tab-'+doc.id);
    const content=buildContent(doc,true);$('article').replaceChildren(...content.childNodes);
    $('source-view').textContent=doc.content;
    const warnings=doc.rendered.mathWarnings.length;$('math-warning').hidden=!warnings;if(warnings)$('math-warning').textContent=warnings+' formule'+(warnings>1?'s n’ont':' n’a')+' pas pu être rendue'+(warnings>1?'s':'')+'. Le texte original reste visible dans le document.';
    updateFileList();updateTabs();updateOutline(doc);updateWatchUI();
    $('reader-scroll').scrollTop=doc[source?'sourceScroll':'scroll']||0;
    requestAnimationFrame(()=>{if(state.active!==id)return;if(options.hash)navigateAnchor(doc,options.hash,{focus:options.focusContent});else if(options.focusContent)focusContent($('article'));updateProgress();});
    if(options.focus)$('tab-'+id)?.focus();
    if(options.closeSidebar!==false)setSidebar(false);
    if(focusFromSidebar)$('tab-'+id)?.focus({preventScroll:true});
    if(!options.keepMenus){closeExport();closeWatchMenu();}
    if(changed&&!options.skipPersist)persistenceChanged(250);
  }
  function showEmpty() {state.active=null;state.source=false;$('welcome').hidden=false;$('reader').hidden=true;$('article').replaceChildren();$('source-view').textContent='';updateFileList();updateTabs();updateWatchUI();closeExport();closeWatchMenu();}
  function focusContent(target) {target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}
  function jumpTo(id,options={}) {const target=$(id);if(target){target.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});if(options.focus)focusContent(target);return true;}return false;}
  function navigateAnchor(doc,hash,options={}) {if(!hash){$('reader-scroll').scrollTop=0;if(options.focus)focusContent($('article'));return;}const id=FolioRenderer.resolveAnchor(doc.rendered,hash);if(!id||!jumpTo(id,options)){notify('Cette section est introuvable dans le document.');if(options.focus)focusContent($('article'));}}
  function closeDoc(id,options={}) {
    if(state.busy){notify('La collection est en cours de chargement. Patientez un instant.');return;}
    const index=state.docs.findIndex(doc=>doc.id===id);if(index<0)return;
    FolioWatcher.unwatch(id);
    const removed=state.docs[index],wasActive=state.active===id;state.docs.splice(index,1);
    if(!state.docs.length){showEmpty();persistenceChanged();focusCollectionControl(document.querySelector('[data-action="import"]'));notify(baseName(removed.path)+' retiré de la collection.');return;}
    const neighbor=state.docs[Math.min(index,state.docs.length-1)];
    if(wasActive)setActive(neighbor.id,{focus:!options.fromCollection,closeSidebar:!options.fromCollection});else{updateFileList();updateTabs();}
    if(options.fromCollection){const next=$('file-list').querySelector('.file-button[data-doc-id="'+neighbor.id+'"]')||$('file-list').querySelector('.file-button.active');focusCollectionControl(next);}
    else $('tab-'+state.active)?.focus({preventScroll:true});
    persistenceChanged();notify(baseName(removed.path)+' retiré de la collection.');
  }
  function totalBytes() {return state.docs.reduce((n,doc)=>n+doc.size,0)+[...state.assets.values()].reduce((n,item)=>n+item.size,0);}
  function checkRenderBudget(rendered,prior) {
    const total=state.docs.reduce((count,doc)=>count+(doc===prior?0:doc.rendered.nodeCount),0)+rendered.nodeCount;
    if(total>MAX_RENDER_NODES)throw new Error('La collection contient trop d’éléments de mise en page. Retirez quelques documents avant cet ajout.');
  }
  async function addDocument(path,content,size) {
    const prior=state.docs.find(doc=>doc.path===path), rendered=await FolioRenderer.renderAsync(content);
    checkRenderBudget(rendered,prior);
    if(prior)FolioWatcher.unwatch(prior.id);
    // A File imported under the same name does not prove the same disk identity.
    // Forget the old handle so it cannot overwrite this explicit new import.
    const doc={id:prior?.id||'d'+state.next++,path,content,size,rendered,scroll:0,sourceScroll:0,search:normalizeSearch(path+'\n'+rendered.title+'\n'+content),watch:newWatch()};
    if(prior)state.docs[state.docs.indexOf(prior)]=doc;else state.docs.push(doc);return {doc,updated:!!prior,watchStopped:!!prior?.watch?.enabled};
  }
  function readDataURL(file,mime) {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Image illisible'));reader.onload=()=>{const value=String(reader.result||'');resolve('data:'+mime+';base64,'+value.slice(value.indexOf(',')+1));};reader.readAsDataURL(file);});}
  async function importFiles(files,quiet=false,options={}) {
    if(state.busy){notify('La collection est en cours de chargement. Patientez un instant.');return;}
    if(!files.length)return;
    if(files.length>MAX_IMPORT_ENTRIES){notify('Cette sélection contient plus de 3 000 fichiers. Sélectionnez un sous-dossier.',true);return;}
    setBusyUI(true);$('busy-indicator').hidden=false;
    let added=0,updated=0,images=0,ignored=0,watchStopped=0,first=null;const errors=[];
    // FileList order is preserved; paths are available for folder imports and directory drops.
    try {
      for(const input of files){
        const file=input.file||input,path=normalizePath(input.path||file.webkitRelativePath||file.name);
        if(!path||path.length>MAX_PATH){errors.push('Chemin de fichier vide ou trop long.');continue;}
        const extension=path.split('.').pop().toLowerCase(),isMD=MD_PATTERN.test(path),mime=Object.hasOwn(IMAGE_TYPES,extension)?IMAGE_TYPES[extension]:null;
        if(!isMD&&!mime){ignored++;continue;}
        if(isMD&&file.size>MAX_DOC||mime&&file.size>MAX_IMAGE){errors.push(baseName(path)+' : fichier trop volumineux.');continue;}
        const oldSize=isMD?(state.docs.find(doc=>doc.path===path)?.size||0):(state.assets.get(path)?.size||0);
        if(totalBytes()-oldSize+file.size>MAX_TOTAL){errors.push(baseName(path)+' : limite de 80 Mio atteinte.');continue;}
        if(isMD&&!state.docs.some(doc=>doc.path===path)&&state.docs.length>=MAX_COUNT){errors.push('Limite de 200 documents atteinte.');continue;}
        if(mime&&!state.assets.has(path)&&state.assets.size>=MAX_ASSETS){errors.push('Limite de 3 000 images atteinte.');continue;}
        try {
          if(isMD){
            const bytes=await file.arrayBuffer();let content;
            try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');}catch(_){throw new Error('enregistrez ce fichier en UTF-8.');}
            if(content.includes('\0'))throw new Error('ce fichier ne semble pas être du texte Markdown.');
            const result=await addDocument(path,content,file.size);if(!first)first=result.doc.id;result.updated?updated++:added++;if(result.watchStopped)watchStopped++;
          } else {const data=await readDataURL(file,mime);state.assets.set(path,{path,data,size:file.size});images++;}
        }catch(error){errors.push(baseName(path)+' : '+(error.message||'lecture impossible.'));}
        if((added+updated+images)%5===0)await new Promise(resolve=>requestAnimationFrame(resolve));
      }
    } finally {
      setBusyUI(false);$('busy-indicator').hidden=true;
      if(first)setActive(first);else if(state.active&&!options.keepCurrentOnFailure)setActive(state.active);else{updateFileList();updateTabs();}
      $('file-input').value='';$('folder-input').value='';
      if(added||updated||images)persistenceChanged();
      // An opt-out or a failed removal retried during this import may be queued
      // while requested is false, so it must resume independently of saves.
      flushPersistence();
    }
    const parts=[];if(added)parts.push(added+' document'+(added>1?'s':'')+' ajouté'+(added>1?'s':''));if(updated)parts.push(updated+' mis à jour');if(images)parts.push(images+' image'+(images>1?'s':'')+' disponible'+(images>1?'s':''));if(ignored)parts.push(ignored+' fichier'+(ignored>1?'s':'')+' non pris en charge');
    if(watchStopped)parts.push('Suivi désactivé pour '+watchStopped+' document'+(watchStopped>1?'s':'')+' réimporté'+(watchStopped>1?'s':'')+' : reliez à nouveau leur original pour le reprendre.');
    if(errors.length)parts.push(errors.slice(0,3).join('\n')+(errors.length>3?'\nEt '+(errors.length-3)+' autre(s) erreur(s).':''));
    if(!quiet)notify(parts.join(' · ')||'Aucun fichier compatible dans cette sélection.',!!errors.length);
    return {added,updated,images,first,errors};
  }
  function updatePasteUI() {
    const input=$('paste-input'),button=$('paste-import');
    if(!input||!button)return;
    input.readOnly=pasteState.submitting;
    button.disabled=state.busy||pasteState.submitting||!input.value.trim();
    button.textContent=pasteState.submitting?'Création…':'Créer le document';
    $('paste-dialog').setAttribute('aria-busy',String(pasteState.submitting));
    $('paste-dialog').querySelectorAll('[data-close]').forEach(control=>control.disabled=pasteState.submitting);
  }
  function pasteError(message,dialog) {
    if(dialog){$('paste-error').textContent=message;$('paste-error').hidden=false;$('paste-input').setAttribute('aria-invalid','true');}
    else notify(message,true);
  }
  function openPasteDialog() {
    if(state.busy){notify('La collection est en cours de chargement. Patientez un instant.');return;}
    pasteState.returnFocus=document.activeElement;
    $('paste-error').hidden=true;$('paste-input').removeAttribute('aria-invalid');
    updatePasteUI();$('paste-dialog').showModal();$('paste-input').focus();
  }
  function closePasteDialog(created=false) {
    if(pasteState.submitting&&!created)return;
    $('paste-dialog').close();
    if(created){$('paste-input').value='';$('paste-error').hidden=true;$('paste-input').removeAttribute('aria-invalid');}
    else if(pasteState.returnFocus?.isConnected){
      if($('sidebar').contains(pasteState.returnFocus))focusCollectionControl(pasteState.returnFocus);
      else pasteState.returnFocus.focus({preventScroll:true});
    }
  }
  function pastedDocumentName() {
    const now=new Date(),pad=(value,width=2)=>String(value).padStart(width,'0');
    const stem='Collage-'+pad(now.getFullYear(),4)+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate())+'_'+pad(now.getHours())+'-'+pad(now.getMinutes())+'-'+pad(now.getSeconds());
    const paths=new Set(state.docs.map(doc=>doc.path.normalize('NFC').toLowerCase()));
    let path=stem+'.md',suffix=2;
    while(paths.has(path.toLowerCase()))path=stem+'-'+(suffix++)+'.md';
    return path;
  }
  async function importPastedText(text,dialog=false) {
    if(state.busy){pasteError('La collection est en cours de chargement. Patientez un instant, puis collez à nouveau.',dialog);return false;}
    if(typeof text!=='string'){pasteError('Collez du texte Markdown avant de créer le document.',dialog);return false;}
    // Reject an obviously oversized clipboard string before allocating a File.
    // The shared import then checks its exact UTF-8 size and all render budgets.
    if(text.length>MAX_DOC){pasteError('Ce texte dépasse la limite de 5 Mio par document. Collez une partie plus courte.',dialog);return false;}
    if(!text.trim()){pasteError('Collez du texte Markdown avant de créer le document.',dialog);return false;}
    try {
      const path=pastedDocumentName();
      const result=await importFiles([new File([text],path,{type:'text/markdown'})],true,{keepCurrentOnFailure:true});
      if(!result?.added){pasteError(result?.errors.join('\n')||'Le document n’a pas pu être créé. Réessayez le collage.',dialog);return false;}
      $('search').value='';updateFileList();
      if(dialog)closePasteDialog(true);
      focusContent($('article'));
      notify(path+' ajouté à la collection.');
      return true;
    } catch(error){pasteError('Le collage n’a pas abouti : '+(error.message||'erreur inattendue.'),dialog);return false;}
  }
  async function submitPastedDraft() {
    if(pasteState.submitting)return;
    if(state.busy){pasteError('La collection est en cours de chargement. Patientez un instant.',true);return;}
    const text=$('paste-input').value;
    pasteState.submitting=true;updatePasteUI();
    try{await importPastedText(text,true);}
    finally{pasteState.submitting=false;updatePasteUI();}
  }
  function pasteTargetsInput(event) {
    const target=event.target instanceof Element?event.target:event.target?.parentElement;
    if(!target)return false;
    if(target.closest('input,textarea,select,[role="textbox"]'))return true;
    const editable=target.closest('[contenteditable]');
    return target.isContentEditable||!!editable&&editable.getAttribute('contenteditable').toLowerCase()!=='false';
  }
  function receivePaste(event) {
    if(event.defaultPrevented||pasteTargetsInput(event)||document.querySelector('dialog[open]'))return;
    const clipboard=event.clipboardData;
    if(!clipboard||clipboard.files?.length||Array.from(clipboard.items||[]).some(item=>item.kind==='file')||Array.from(clipboard.types||[]).includes('Files'))return;
    // Read only this paste event, synchronously. Never request background
    // clipboard access or insert its rich HTML representation into the page.
    let text;try{text=clipboard.getData('text/plain');}catch(_){return;}
    if(!text||text.length<=MAX_DOC&&!text.trim())return;
    event.preventDefault();void importPastedText(text);
  }
  async function walkEntry(entry,prefix='',budget={count:0},depth=0) {
    if(++budget.count>MAX_IMPORT_ENTRIES)throw new Error('La sélection contient plus de 3 000 fichiers et dossiers. Sélectionnez un sous-dossier.');
    if(depth>MAX_DEPTH)throw new Error('Cette arborescence dépasse 64 niveaux. Sélectionnez un sous-dossier.');
    if((prefix+entry.name).length>MAX_PATH)throw new Error('Un chemin de fichier est trop long.');
    if(entry.isFile)return new Promise((resolve,reject)=>entry.file(file=>resolve([{file,path:prefix+file.name}]),reject));
    if(entry.isDirectory){const reader=entry.createReader(),result=[];let entries;do{entries=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));for(const child of entries)result.push(...await walkEntry(child,prefix+entry.name+'/',budget,depth+1));}while(entries.length);return result;}
    return [];
  }
  function closeExport(returnFocus=false) {const wasOpen=!$('export-menu').hidden;$('export-menu').hidden=true;$('export-toggle').setAttribute('aria-expanded','false');if(returnFocus&&wasOpen)$('export-toggle').focus();}
  function exportPaths() {
    const key=path=>path.normalize('NFC').toLowerCase(),counts=new Map(),used=new Set(),paths=new Map();
    for(const doc of state.docs){const preferred=key(doc.path.replace(MD_PATTERN,'.html'));counts.set(preferred,(counts.get(preferred)||0)+1);}
    for(const doc of [...state.docs].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)){
      const normal=doc.path.replace(MD_PATTERN,'.html'),base=counts.get(key(normal))>1?doc.path+'.html':normal;
      let candidate=base,suffix=2;
      while(used.has(key(candidate)))candidate=base.slice(0,-5)+'-'+(suffix++)+'.html';
      used.add(key(candidate));paths.set(doc.id,candidate);
    }
    return paths;
  }
  function relativeHTML(from,to) {const fromParts=directory(from).split('/').filter(Boolean),toParts=to.split('/');while(fromParts.length&&toParts.length&&fromParts[0]===toParts[0]){fromParts.shift();toParts.shift();}return '../'.repeat(fromParts.length)+toParts.map(part=>encodeURIComponent(part)).join('/');}
  function checkExportBudget(docs,paths) {
    const encoder=new TextEncoder(),bytes=value=>encoder.encode(String(value)).length;
    let size=65536+['app-styles','reading-styles','math-styles'].reduce((n,id)=>n+bytes($(id).textContent),0);
    const add=value=>{size+=value;if(size>MAX_EXPORT)throw new Error('L’export dépasse la limite de 80 Mio, notamment avec les images répétées. Exportez moins de documents ou utilisez des images plus légères.');};
    for(const doc of docs){
      // htmlByteLength counts escaped content without cloning or serializing it.
      // Reserve extra space for prefixes, code controls, navigation and sections.
      add(doc.rendered.htmlByteLength+64*doc.rendered.nodeCount+4096+bytes(escapeHTML(doc.path))+bytes(escapeHTML(plainTitle(doc))));
      for(const heading of doc.rendered.headings)add(512+bytes(escapeHTML(heading.text))+2*bytes(heading.id));
      const imageCache=new Map();
      for(const img of doc.rendered.fragment.querySelectorAll('img')){
        add(2048);const src=img.getAttribute('data-folio-src')||'';
        if(!src||/^data:/i.test(src)||isExternal(src)||isScheme(src))continue;
        if(!imageCache.has(src))imageCache.set(src,resolvePath(src,doc.path,state.assets).item);
        const item=imageCache.get(src);if(item)add(item.data.length);
      }
      for(const link of doc.rendered.fragment.querySelectorAll('a[href]')){
        const href=link.getAttribute('href');if(isExternal(href)||isScheme(href))continue;
        const match=resolvePath(href,doc.path,state.docs);
        if(match.item)add(256+bytes(escapeHTML(relativeHTML(paths.get(doc.id),paths.get(match.item.id)))));
      }
    }
  }
  function exportRuntime() {
    const tabs=[...document.querySelectorAll('[role="tab"]')];
    function select(id,focus){tabs.forEach(tab=>{const active=tab.dataset.panel===id;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;document.getElementById(tab.dataset.panel).hidden=!active;if(active&&focus)tab.focus();});}
    function decodeHash(value){try{return decodeURIComponent(value);}catch(_){return value;}}
    function followHash(){const hash=decodeHash(location.hash.slice(1));if(!hash)return;const target=document.getElementById(hash);if(target){const section=target.closest('.export-doc');if(section){select(section.id,false);requestAnimationFrame(()=>target.scrollIntoView({block:'start'}));}}}
    tabs.forEach(tab=>tab.addEventListener('click',()=>{select(tab.dataset.panel,false);history.replaceState(null,'','#'+tab.dataset.panel);window.scrollTo(0,0);}));
    document.querySelector('[role="tablist"]')?.addEventListener('keydown',event=>{const index=tabs.indexOf(document.activeElement);if(index<0)return;let next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();select(tabs[next].dataset.panel,true);});
    document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(!link)return;const id=decodeHash(link.getAttribute('href').slice(1));const target=document.getElementById(id);if(!target)return;const section=target.closest('.export-doc');if(section)select(section.id,false);});
    window.addEventListener('hashchange',followHash);followHash();
  }
  function makeExport(docs,paths) {
    checkExportBudget(docs,paths);
    const multi=docs.length>1, exportedSet=new Set(docs.map(doc=>doc.id)), panels=new Map();
    docs.forEach((doc,index)=>panels.set(doc.id,{panel:'folio-page-'+index,prefix:'folio-page-'+index+'-',index}));
    const sections=docs.map(doc=>{
      const meta=panels.get(doc.id),root=buildContent(doc,false);
      for(const node of root.querySelectorAll('[id]'))node.id=meta.prefix+node.id;
      for(const link of root.querySelectorAll('a[href]')){
        const href=link.getAttribute('href');if(isExternal(href)||isScheme(href))continue;
        const match=resolvePath(href,doc.path,state.docs);
        if(!match.item){link.removeAttribute('href');link.title=match.ambiguous?'Lien ambigu : plusieurs documents portent ce nom.':'Document non inclus dans la collection.';continue;}
        const anchor=match.hash?FolioRenderer.resolveAnchor(match.item.rendered,match.hash):null;
        if(exportedSet.has(match.item.id)){const target=panels.get(match.item.id);link.setAttribute('href','#'+(anchor?target.prefix+anchor:target.panel));}
        else {link.setAttribute('href',relativeHTML(paths.get(doc.id),paths.get(match.item.id))+(anchor?'#folio-page-0-'+anchor:''));link.removeAttribute('target');link.removeAttribute('rel');}
      }
      // Redundant metadata is not needed in the delivered HTML; KaTeX keeps accessible MathML.
      root.querySelectorAll('[data-folio-tex]').forEach(node=>node.removeAttribute('data-folio-tex'));
      const headings=doc.rendered.headings.filter(h=>h.level>1&&h.level<5);
      const toc=headings.length?'<details class="export-toc"><summary>Sur cette page</summary><ul>'+headings.map(h=>'<li class="toc-depth-'+h.level+'"><a href="#'+escapeHTML(meta.prefix+h.id)+'">'+escapeHTML(h.text)+'</a></li>').join('')+'</ul></details>':'';
      return '<section id="'+meta.panel+'" class="export-doc" '+(multi?'role="tabpanel" aria-labelledby="export-tab-'+meta.index+'" tabindex="0"':'')+(multi&&meta.index?' hidden':'')+'><p class="document-kicker">'+escapeHTML(doc.path)+'</p>'+toc+'<article class="prose">'+root.innerHTML+'</article></section>';
    }).join('\n');
    const title=multi?'Collection Folio · '+docs.length+' documents':plainTitle(docs[0]);
    const styles=['app-styles','reading-styles','math-styles'].map(id=>'<style>'+$(id).textContent+'</style>').join('\n');
    const tablist=multi?'<nav class="export-tabs" role="tablist" aria-label="Documents">'+docs.map((doc,index)=>'<button id="export-tab-'+index+'" class="export-tab" role="tab" data-panel="folio-page-'+index+'" aria-controls="folio-page-'+index+'" aria-selected="'+(index===0)+'" tabindex="'+(index===0?0:-1)+'">'+escapeHTML(baseName(doc.path))+'</button>').join('')+'</nav>':'';
    const script=multi?'<scr'+'ipt>('+exportRuntime.toString()+')();</scr'+'ipt>':'';
    const csp="default-src 'none'; script-src "+(multi?"'unsafe-inline'":"'none'")+"; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
    return '<!doctype html>\n<html lang="fr" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><title>'+escapeHTML(title)+'</title><link rel="icon" href="'+document.querySelector('link[rel="icon"]').getAttribute('href')+'">'+styles+'</head><body class="export-body"><header class="export-header"><div class="brand"><span class="brand-mark">'+icon('brand')+'</span><span class="wordmark">folio</span></div><div class="export-label">'+(multi?docs.length+' documents':'Document HTML')+'<br>Copie autonome · lecture hors connexion</div></header><main class="export-shell">'+tablist+sections+'<footer class="export-footer">Créé avec Folio · Les formules, les diagrammes, la mise en page et les images locales sont intégrés.</footer></main>'+script+'</body></html>';
  }
  function download(blob,filename) {const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  async function exportHTML(all) {
    const focusFromMenu=$('export-menu').contains(document.activeElement);
    closeExport();const doc=activeDoc();if(!doc)return;
    const button=$('export-toggle');button.disabled=true;
    try {await new Promise(resolve=>requestAnimationFrame(resolve));const docs=all?[...state.docs]:[doc],paths=exportPaths();const html=makeExport(docs,paths);download(new Blob([html],{type:'text/html;charset=utf-8'}),all&&docs.length>1?'Folio-collection.html':baseName(paths.get(doc.id)));notify(all&&docs.length>1?'Collection exportée avec ses onglets, ses formules, ses diagrammes et ses images locales.':'Page HTML exportée. Elle peut être ouverte hors connexion.');}
    catch(error){notify('L’export n’a pas abouti : '+(error.message||'erreur inattendue.'),true);}
    finally{button.disabled=state.busy;if(focusFromMenu&&!button.disabled&&state.active)focusCollectionControl(button);}
  }
  $('file-list').addEventListener('click',event=>{const remove=event.target.closest('.file-remove[data-remove-id]');if(remove){closeDoc(remove.dataset.removeId,{fromCollection:true});return;}const button=event.target.closest('.file-button[data-doc-id]');if(button)setActive(button.dataset.docId);});
  $('tab-list').addEventListener('click',event=>{const close=event.target.closest('[data-close-id]');if(close){closeDoc(close.dataset.closeId);return;}const tab=event.target.closest('[data-doc-id]');if(tab)setActive(tab.dataset.docId,{focus:true});});
  $('tab-list').addEventListener('keydown',event=>{
    const focused=event.target.closest('[role="tab"]');if(!focused)return;const index=state.docs.findIndex(doc=>doc.id===focused.dataset.docId);let target=index;
    if(event.key==='ArrowRight')target=(index+1)%state.docs.length;else if(event.key==='ArrowLeft')target=(index-1+state.docs.length)%state.docs.length;else if(event.key==='Home')target=0;else if(event.key==='End')target=state.docs.length-1;else if(event.key==='Delete'){event.preventDefault();closeDoc(focused.dataset.docId);return;}else return;
    event.preventDefault();setActive(state.docs[target].id,{focus:true});
  });
  $('article').addEventListener('click',event=>{
    const link=event.target.closest('a[href]');if(!link)return;const href=link.getAttribute('href');
    if(isExternal(href)||/^(?:mailto|tel):/i.test(href))return;
    event.preventDefault();const doc=activeDoc();if(!doc)return;const ref=splitReference(href);
    if(!ref.path){navigateAnchor(doc,ref.hash,{focus:true});return;}
    const match=resolvePath(href,doc.path,state.docs);
    if(match.item){setActive(match.item.id,{hash:match.hash,focusContent:true});return;}
    notify(match.ambiguous?'Plusieurs documents portent ce nom. Utilisez un chemin relatif précis.':'Ce document n’est pas importé : '+ref.path);
  });
  document.querySelectorAll('[data-action="import"]').forEach(button=>button.addEventListener('click',()=>$('file-input').click()));
  document.querySelectorAll('[data-action="folder"]').forEach(button=>button.addEventListener('click',()=>$('folder-input').click()));
  document.querySelectorAll('[data-action="paste"]').forEach(button=>button.addEventListener('click',openPasteDialog));
  document.addEventListener('paste',receivePaste);
  $('paste-input').addEventListener('input',()=>{$('paste-error').hidden=true;$('paste-input').removeAttribute('aria-invalid');updatePasteUI();});
  $('paste-input').addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&!event.isComposing){event.preventDefault();void submitPastedDraft();}});
  $('paste-import').addEventListener('click',submitPastedDraft);
  $('paste-dialog').addEventListener('cancel',event=>{event.preventDefault();closePasteDialog();});
  $('file-input').addEventListener('change',event=>importFiles([...event.target.files]));
  $('folder-input').addEventListener('change',event=>importFiles([...event.target.files]));
  $('search').addEventListener('input',updateFileList);
  $('reader-scroll').addEventListener('scroll',()=>{if(!scrollFrame)scrollFrame=requestAnimationFrame(()=>{updateProgress();scrollFrame=0;});},{passive:true});
  $('source-toggle').addEventListener('click',()=>{const doc=activeDoc();if(!doc)return;rememberScroll();state.source=!state.source;$('reader').classList.toggle('source-mode',state.source);$('article').hidden=state.source;$('source-view').hidden=!state.source;$('source-toggle').setAttribute('aria-pressed',String(state.source));$('source-toggle').title=state.source?'Afficher la page mise en forme':'Afficher le Markdown source';$('reader-scroll').scrollTop=doc[state.source?'sourceScroll':'scroll']||0;updateProgress();if(matchMedia('(max-width:760px)').matches){setSidebar(false);focusContent($(state.source?'source-view':'article'));}});
  $('print-doc').addEventListener('click',()=>{if(state.source)$('source-toggle').click();window.print();});
  $('export-toggle').addEventListener('click',()=>{closeWatchMenu();const hidden=!$('export-menu').hidden;$('export-menu').hidden=hidden;$('export-toggle').setAttribute('aria-expanded',String(!hidden));if(!hidden)$('export-current').focus();});
  $('export-current').addEventListener('click',()=>exportHTML(false));$('export-collection').addEventListener('click',()=>exportHTML(true));
  document.addEventListener('click',event=>{if(!event.target.closest('.export-container'))closeExport();if(!event.target.closest('.watch-container'))closeWatchMenu();});
  $('watch-menu-toggle').addEventListener('click',()=>{closeExport();const open=$('watch-menu').hidden;$('watch-menu').hidden=!open;$('watch-menu-toggle').setAttribute('aria-expanded',String(open));if(open){updateWatchUI();$('watch-toggle').focus();}});
  $('watch-toggle').addEventListener('change',()=>{
    const doc=activeDoc();if(!doc)return;
    if($('watch-toggle').checked){linkOriginal(doc);return;}
    FolioWatcher.unwatch(doc.id);doc.watch=newWatch();updateWatchUI();persistenceChanged();
  });
  $('watch-reconnect').addEventListener('click',()=>{const doc=activeDoc();if(!doc||state.busy)return;if(doc.watch.handle)FolioWatcher.resume(doc.id);else linkOriginal(doc);});
  $('watch-relink').addEventListener('click',()=>linkOriginal(activeDoc()));
  $('remember-collection').addEventListener('change',()=>{
    if(!local.ready||state.busy||['conflict','unavailable','corrupt'].includes(local.blocked)){updateStorageUI();return;}
    local.requested=$('remember-collection').checked;
    if(local.blocked==='invalid'&&local.requested){updateStorageUI();return;}
    local.error=null;local.blocked=null;local.dirty=true;flushPersistence();
  });
  $('storage-retry').addEventListener('click',()=>{
    if(local.blocked==='conflict'||local.blocked==='unavailable'){state.reloadRequested=true;location.reload();return;}
    if(local.blocked==='invalid'){local.requested=false;local.blocked=null;}
    local.error=null;local.dirty=true;flushPersistence();
  });
  $('load-demo').addEventListener('click',()=>{const files=DEMOS.map(doc=>new File([doc.content],doc.path,{type:'text/markdown'}));importFiles(files);});
  $('theme-toggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';$('theme-toggle').innerHTML=icon(dark?'sun':'moon');$('theme-toggle').setAttribute('aria-label',dark?'Activer le thème clair':'Activer le thème sombre');});
  $('help-open').addEventListener('click',()=>$('help-dialog').showModal());
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.dataset.close==='paste-dialog'?closePasteDialog():$(button.dataset.close).close()));
  $('clear-all').addEventListener('click',()=>$('clear-dialog').showModal());
  $('confirm-clear').addEventListener('click',()=>{if(state.busy)return;FolioWatcher.stopAll();state.docs=[];state.assets.clear();$('search').value='';$('clear-dialog').close();showEmpty();persistenceChanged();notify(local.requested?'La collection a été vidée. Vérifiez la confirmation de mémorisation dans la colonne de gauche.':'Les documents ont été retirés de cette session.');});
  $('sidebar-toggle').addEventListener('click',()=>{const open=!$('sidebar').classList.contains('is-open');setSidebar(open,{focus:open,returnFocus:!open});});
  $('sidebar-close').addEventListener('click',()=>setSidebar(false,{returnFocus:true}));$('mobile-backdrop').addEventListener('click',()=>setSidebar(false,{returnFocus:true}));
  $('toast-close').addEventListener('click',()=>$('toast').hidden=true);
  document.addEventListener('keydown',event=>{if(document.querySelector('dialog[open]'))return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(matchMedia('(max-width:760px)').matches)setSidebar(true);$('search').focus();$('search').select();}if(event.key==='Escape'){closeExport(true);closeWatchMenu(true);const sidebarOpen=$('sidebar').classList.contains('is-open');setSidebar(false,{returnFocus:sidebarOpen});$('drop-overlay').hidden=true;state.dragDepth=0;}});
  if(!/Mac|iPhone|iPad/.test(navigator.platform))document.querySelector('.search-box kbd').textContent='Ctrl K';
  const hasFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
  document.addEventListener('dragenter',event=>{if(!hasFiles(event))return;event.preventDefault();state.dragDepth++;$('drop-overlay').hidden=false;});
  document.addEventListener('dragover',event=>{if(hasFiles(event)){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
  document.addEventListener('dragleave',event=>{if(!hasFiles(event))return;state.dragDepth=Math.max(0,state.dragDepth-1);if(!state.dragDepth)$('drop-overlay').hidden=true;});
  document.addEventListener('drop',async event=>{
    if(!hasFiles(event))return;event.preventDefault();state.dragDepth=0;$('drop-overlay').hidden=true;
    if(state.busy){notify('La collection est en cours de chargement. Patientez un instant.');return;}
    const fallback=[...event.dataTransfer.files],entries=Array.from(event.dataTransfer.items||[]).filter(item=>item.kind==='file').map(item=>item.webkitGetAsEntry?.()).filter(Boolean);
    setBusyUI(true);$('busy-indicator').hidden=false;let files;
    try{files=[];if(entries.length){const budget={count:0};for(const entry of entries)files.push(...await walkEntry(entry,'',budget));}else files=fallback;}
    catch(error){files=null;notify('Lecture du dépôt impossible : '+error.message+' Utilisez le bouton d’import.',true);}
    finally{setBusyUI(false);$('busy-indicator').hidden=true;}
    if(files)await importFiles(files);
    flushPersistence();
  });
  window.addEventListener('resize',()=>{syncDocumentPanels();updateProgress();const focused=document.activeElement,mobile=matchMedia('(max-width:760px)').matches;if(!mobile){setSidebar(false);if(focused===$('sidebar-toggle')||focused===$('sidebar-close'))$('file-list').querySelector('.file-button.active')?.focus({preventScroll:true});}else if(!$('sidebar').classList.contains('is-open')&&$('sidebar').contains(focused))$('sidebar-toggle').focus({preventScroll:true});});
  window.addEventListener('beforeunload',event=>{if(local.running||local.dirty&&(local.requested||local.committed)||state.reloadRequested&&(state.docs.length||state.assets.size)){event.preventDefault();event.returnValue='';}state.reloadRequested=false;});
  showEmpty();
  initializePersistence();
})();
