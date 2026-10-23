/* Folio rendering layer. Dependencies: Marked 18.1.1; DOMPurify 3.4.17.
 * No file access or network activity: all images are left inert for the UI.
 */
(function () {
  'use strict';
  const ALLOWED_TAGS = [
    'h1','h2','h3','h4','h5','h6','p','div','span','section','article',
    'blockquote','pre','code','strong','em','del','s','strike','br','hr',
    'ul','ol','li','dl','dt','dd','table','caption','thead','tbody','tfoot',
    'tr','th','td','a','img','input','details','summary','sup','sub','kbd',
    'samp','var','abbr','cite','q','time','mark','figure','figcaption',
    'ins','b','i','u','small','ruby','rt','rp'
  ];
  const ALLOWED_ATTR = [
    'href','title','alt','class','start','reversed','value','type','checked',
    'disabled','align','colspan','rowspan','scope','datetime','open',
    'data-folio-src','data-folio-original-id','data-folio-math-token'
  ];
  const prefix = 'folio-h-';

  // These budgets apply to one document, including imported HTML and generated
  // KaTeX nodes. They are checked before returning a replacement to the UI.
  // Lexing/HTML budgets also bound work before a DOM tree can be inspected.
  const limits = Object.freeze({
    maxSourceBytes: 5 * 1024 * 1024,
    maxMathExpressions: 1000,
    maxMathExpressionLength: 16384,
    maxTotalMathLength: 131072,
    maxMathExpansions: 256,
    maxHtmlBytes: 16 * 1024 * 1024,
    maxMathHtmlBytes: 1024 * 1024,
    maxNodes: 40000,
    maxDepth: 128,
    maxParserSteps: 100000
  });

  function limitError(limit, message) {
    const error = new Error(message);
    error.name = 'FolioRenderError';
    error.code = 'render_limit';
    error.limit = limit;
    return error;
  }

  const macroDefinitions = new Set(['def','gdef','edef','xdef','let','futurelet','newcommand','renewcommand','providecommand','global','long']);
  function unsupportedMathCommand(formula) {
    // Mirror KaTeX's control-word boundaries, while leaving comments, escaped
    // backslashes and \verb literals alone. User definitions can expand a few
    // hundred source characters into millions of nodes before an output limit
    // can run. Internal @ commands can expose KaTeX's own temporary macros.
    for (let i = 0; i < formula.length; i++) {
      if (formula[i] === '%') {
        const newline = formula.indexOf('\n', i + 1);
        if (newline === -1) break;
        i = newline;
      } else if (formula[i] === '\\') {
        let end = i + 1;
        while (end < formula.length && /[a-zA-Z@]/.test(formula[end])) end++;
        const command = formula.slice(i + 1, end);
        if (!command) { i++; continue; }
        if (macroDefinitions.has(command) || command.includes('@')) return command;
        if (command === 'verb') {
          if (formula[end] === '*') end++;
          const delimiter = formula[end];
          const close = delimiter ? formula.indexOf(delimiter, end + 1) : -1;
          if (close !== -1 && !formula.slice(end, close).includes('\n')) { i = close; continue; }
        }
        i = end - 1;
      }
    }
    return null;
  }

  // Count UTF-8 bytes without allocating another copy of large source/HTML.
  // Lone surrogates encode as the replacement character, as in TextEncoder.
  function utf8ByteLength(value) {
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code < 0x80) bytes++;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }

  function escapedByteLength(value, attribute) {
    let bytes = utf8ByteLength(value);
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '&') bytes += 4;
      else if (value[i] === '<' || value[i] === '>') bytes += 3;
      else if (attribute && value[i] === '"') bytes += 5;
      else if (value.charCodeAt(i) === 0xa0) bytes += 4;
    }
    return bytes;
  }

  function checkMarkup(html, math) {
    if (utf8ByteLength(html) > (math ? limits.maxMathHtmlBytes : limits.maxHtmlBytes)) {
      throw limitError(math ? 'math_html' : 'html_bytes', math
        ? 'Une formule produit trop de HTML (limite : 1 Mio par formule). Simplifiez cette expression.'
        : 'Le rendu produit trop de HTML (limite : 16 Mio par document). Scindez le document.');
    }
    // A conservative preflight: '<' in raw comments/attributes can count too.
    // This stops a tiny-tag source before allocating hundreds of thousands of
    // nodes; a precise count, including text nodes, follows DOM construction.
    let markers = 0;
    for (let i = html.indexOf('<'); i !== -1; i = html.indexOf('<', i + 1)) {
      if (++markers > limits.maxNodes * 2) throw limitError('nodes', 'Le document contient trop de balises pour être affiché. Scindez-le (limite : 40 000 nœuds de rendu).');
    }
  }

  function measureTree(root, includeBytes) {
    let nodeCount = 0, elementCount = 0, htmlByteLength = 0, depth = 1;
    let node = root.firstChild;
    while (node) {
      if (++nodeCount > limits.maxNodes) throw limitError('nodes', 'Le document produit trop de contenu à afficher (limite : 40 000 nœuds de rendu, formules comprises). Scindez-le.');
      if (depth > limits.maxDepth) throw limitError('depth', 'Le document est trop profondément imbriqué (limite : 128 niveaux). Simplifiez sa structure.');
      if (node.nodeType === 1) {
        elementCount++;
        if (includeBytes) {
          // Includes a closing tag even for void elements: deliberately an
          // upper bound, useful to preflight exports without cloning the DOM.
          htmlByteLength += 5 + 2 * utf8ByteLength(node.localName);
          for (const attr of node.attributes) htmlByteLength += 4 + utf8ByteLength(attr.name) + escapedByteLength(attr.value, true);
        }
      } else if (includeBytes && node.nodeType === 3) htmlByteLength += escapedByteLength(node.data, false);
      else if (includeBytes && node.nodeType === 8) htmlByteLength += 8 + utf8ByteLength(node.data);
      if (node.firstChild) { node = node.firstChild; depth++; continue; }
      while (node && node !== root && !node.nextSibling) { node = node.parentNode; depth--; }
      if (!node || node === root) break;
      node = node.nextSibling;
    }
    if (includeBytes && htmlByteLength > limits.maxHtmlBytes) throw limitError('html_bytes', 'Le rendu produit trop de HTML (limite : 16 Mio par document). Scindez le document.');
    return {nodeCount, elementCount, htmlByteLength};
  }

  function safeUrl(value, image) {
    if (typeof value !== 'string') return '';
    const url = value.trim();
    if (!url || /[\u0000-\u001f\u007f]/.test(url)) return '';
    // Data SVG, HTML and arbitrary blob URLs from a document are not accepted.
    if (image && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(url)) return url;
    const protocol = /^([a-z][a-z\d+.-]*):/i.exec(url);
    if (protocol && !(image ? /^(https?)$/i : /^(https?|mailto|tel)$/i).test(protocol[1])) return '';
    return url;
  }

  function slug(text, deaccent) {
    let value = String(text).trim().toLowerCase();
    if (deaccent) value = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    return value.replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
  }

  function mathExtensions(mathTokens) {
    const seed = new Uint32Array(4);
    crypto.getRandomValues(seed);
    const nonce = [...seed].map(n => n.toString(16).padStart(8, '0')).join('');
    const missingClosers = new WeakMap();
    const startHints = new WeakMap();
    let activeStream;
    let expressionCount = 0, totalMathLength = 0, parserSteps = 0;
    function step() {
      if (++parserSteps > limits.maxParserSteps) throw limitError('parser_steps', 'Le document contient trop de constructions Markdown à analyser. Scindez-le (limite : 100 000 étapes de lecture).');
    }
    function startHint(src, context, block) {
      const pattern = block ? /(?:^|\n)[ \t]{0,3}(?:\$\$|\\\[)/ : /\$|\\\(/;
      // Marked calls start() on current source.slice(1), after trying this
      // tokenizer. Cache the next opener in coordinates measured from the end
      // of the same lexer invocation. Otherwise ordinary paragraphs before a late
      // formula also cause the entire remaining document to be rescanned.
      if (!context || src.length !== context.length - 1) {
        const match = pattern.exec(src);
        return match ? match.index : undefined;
      }
      let cache = startHints.get(context);
      if (!cache) { cache = new Map(); startHints.set(context, cache); }
      const key = block ? 'block' : 'inline', saved = cache.get(key);
      if (saved && src.length <= saved.length && (saved.remaining === null || src.length >= saved.remaining)) {
        return saved.remaining === null ? undefined : src.length - saved.remaining;
      }
      const match = pattern.exec(src);
      cache.set(key, {length:src.length, remaining:match ? src.length - match.index : null});
      return match ? match.index : undefined;
    }
    function findClose(src, closer, from, block) {
      // Within a lexer invocation the source is a shrinking suffix. Marked can
      // reuse a token array for separate blockquote continuations, so that
      // array is NOT a safe cache key. The provideLexer hook assigns a distinct
      // stream object to every blockTokens/inlineTokens call instead.
      let missing = missingClosers.get(activeStream);
      if (!missing) { missing = new Map(); missingClosers.set(activeStream, missing); }
      const key = (block ? 'block:' : 'inline:') + closer;
      if (missing.has(key) && src.length <= missing.get(key)) return -1;
      for (let at = src.indexOf(closer, from); at !== -1; at = src.indexOf(closer, at + closer.length)) {
        if (!block) return at;
        let after = at + closer.length;
        while (src[after] === ' ' || src[after] === '\t') after++;
        if (after === src.length || src[after] === '\n') return at;
      }
      missing.set(key, src.length);
      return -1;
    }
    function token(src, from, to, end, displayMode, block) {
      if (to - from > limits.maxMathExpressionLength) throw limitError('math_length', 'Une formule est trop longue (limite : 16 384 caractères). Scindez cette expression.');
      if (++expressionCount > limits.maxMathExpressions) throw limitError('math_count', 'Le document contient trop de formules (limite : 1 000 par document). Scindez-le.');
      totalMathLength += to - from;
      if (totalMathLength > limits.maxTotalMathLength) throw limitError('math_total', 'Les formules sont trop volumineuses (limite cumulée : 131 072 caractères par document). Scindez-le.');
      return {type: block ? 'folioMathBlock' : 'folioMathInline', raw: src.slice(0, end), text: src.slice(from, to).trim(), displayMode};
    }
    function placeholder(token) {
      const key = nonce + '-' + mathTokens.size;
      mathTokens.set(key, {formula: token.text, displayMode: token.displayMode});
      return '<span data-folio-math-token="' + key + '"></span>';
    }
    const extensions = [
      {
        name: 'folioMathBlock', level: 'block',
        start(src) {
          return startHint(src, activeStream, true);
        },
        tokenizer(src) {
          step();
          activeStream.length = src.length;
          const opening = /^ {0,3}(\$\$|\\\[)/.exec(src);
          if (!opening) return;
          const closer = opening[1] === '$$' ? '$$' : '\\]';
          const at = findClose(src, closer, opening[0].length + 1, true);
          if (at === -1) return;
          let end = at + closer.length;
          while (src[end] === ' ' || src[end] === '\t') end++;
          if (src[end] === '\n') end++;
          return token(src, opening[0].length, at, end, true, true);
        },
        renderer: placeholder
      },
      {
        name:'folioMathInline', level:'inline',
        start(src) {
          return startHint(src, activeStream, false);
        },
        tokenizer(src) {
          step();
          activeStream.length = src.length;
          // Inline HTML code is literal, like fenced/indented/code-span tokens.
          // Consume it as HTML so a formula cannot cross its closing tag.
          const code = /^<code(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(src);
          if (code) {
            const closing = /<\/code\s*>/i.exec(src.slice(code[0].length));
            const end = closing ? code[0].length + closing.index + closing[0].length : src.length;
            const raw = src.slice(0, end);
            return {type:'html', raw, text:raw, block:false};
          }
          if (this.lexer.state.inRawBlock) return;
          const displayMode = src.startsWith('$$');
          if (displayMode || src.startsWith('\\(')) {
            const closer = displayMode ? '$$' : '\\)';
            const at = findClose(src, closer, 3, false);
            if (at !== -1) return token(src, 2, at, at + 2, displayMode, false);
            return;
          }
          if (src[0] !== '$') return;
          // A single-dollar expression ends at the first unescaped dollar or
          // newline. This scan never crosses a rejected closing delimiter.
          for (let at = 1; at < src.length; at++) {
            if (src[at] === '\n') return;
            if (src[at] === '\\') { if (src[at + 1] === '\n') return; at++; continue; }
            if (src[at] === '$') {
              if (at > 1 && src[at + 1] !== '$') return token(src, 1, at, at + 1, false, false);
              return;
            }
          }
        },
        renderer: placeholder
      }
    ];
    return {extensions, hooks:{
      provideLexer() {
        return (source, options) => {
          const lexer = new marked.Lexer(options);
          for (const method of ['blockTokens','inlineTokens']) {
            const tokenize = lexer[method];
            lexer[method] = function (...args) {
              const parentStream = activeStream;
              activeStream = {};
              try { return tokenize.apply(this, args); }
              finally { activeStream = parentStream; }
            };
          }
          return lexer.lex(source);
        };
      }
    }};
  }

  function render(markdown) {
    if (typeof markdown !== 'string') throw new TypeError('Un texte Markdown est attendu.');
    if (utf8ByteLength(markdown) > limits.maxSourceBytes) throw limitError('source_bytes', 'Le document est trop volumineux (limite : 5 Mio en UTF-8). Scindez-le.');
    const mathTokens = new Map();
    const parser = new marked.Marked({gfm:true, breaks:false, async:false, ...mathExtensions(mathTokens)});
    // Template contents are inert: no raw scripts, custom elements, frames or
    // image loads can run while we remove every active resource attribute.
    const template = document.createElement('template');
    let html;
    try { html = parser.parse(markdown.replace(/^\uFEFF/, '')); }
    catch (error) {
      // Marked adds its bug-report invitation even for intentional limits.
      if (error.code === 'render_limit') error.message = error.message.split('\nPlease report this')[0];
      throw error;
    }
    checkMarkup(html, false);
    template.innerHTML = html;
    measureTree(template.content, false);
    for (const node of template.content.querySelectorAll('*')) {
      const originalId = node.getAttribute('id') || (node.localName === 'a' ? node.getAttribute('name') : '');
      // Do not trust pre-existing application metadata in imported HTML.
      node.removeAttribute('data-folio-src');
      node.removeAttribute('data-folio-original-id');
      if (originalId) node.setAttribute('data-folio-original-id', originalId);
      if (node.localName === 'img') {
        const source = safeUrl(node.getAttribute('src'), true);
        if (source) node.setAttribute('data-folio-src', source);
      }
      for (const attr of [...node.attributes]) {
        if (!ALLOWED_ATTR.includes(attr.name)) node.removeAttribute(attr.name);
      }
      if (node.localName !== 'a') node.removeAttribute('href');
      if (node.localName !== 'code') node.removeAttribute('class');
    }
    const fragment = DOMPurify.sanitize(template.content, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      FORBID_TAGS: ['style','script','iframe','object','embed','form','svg','math','template'],
      FORBID_ATTR: ['style','id','name','src','srcset'],
      SANITIZE_DOM: true,
      SANITIZE_NAMED_PROPS: true,
      RETURN_DOM_FRAGMENT: true,
      KEEP_CONTENT: true
    });
    const initialBudget = measureTree(fragment, true);
    let renderedNodeCount = initialBudget.nodeCount, renderedHtmlBytes = initialBudget.htmlByteLength;
    const mathWarnings = [];
    for (const node of fragment.querySelectorAll('[data-folio-math-token]')) {
      const token = mathTokens.get(node.getAttribute('data-folio-math-token'));
      node.removeAttribute('data-folio-math-token');
      if (!token) { node.replaceWith(document.createTextNode(node.textContent)); continue; }
      const wrapper = document.createElement(token.displayMode ? 'div' : 'span');
      wrapper.className = token.displayMode ? 'folio-math-display' : 'folio-math-inline';
      wrapper.dataset.folioTex = token.formula;
      try {
        if (!window.katex) throw new Error('Le moteur mathématique est indisponible.');
        const unsupported = unsupportedMathCommand(token.formula);
        if (unsupported) throw new Error('La commande \\' + unsupported + ' est conservée en texte : Folio ne développe pas les définitions de macros utilisateur ni les commandes internes contenant @. Écrivez la formule explicitement.');
        // Only KaTeX-generated output bypasses sanitization. User HTML never does.
        const mathHtml = window.katex.renderToString(token.formula, {
          displayMode:token.displayMode, throwOnError:false, trust:false,
          strict:'warn', maxExpand:limits.maxMathExpansions, maxSize:20, output:'htmlAndMathml'
        });
        checkMarkup(mathHtml, true);
        renderedHtmlBytes += utf8ByteLength(mathHtml);
        if (renderedHtmlBytes > limits.maxHtmlBytes) throw limitError('html_bytes', 'Les formules produisent trop de HTML (limite : 16 Mio par document). Scindez-le.');
        wrapper.innerHTML = mathHtml;
        const error = wrapper.querySelector('.katex-error');
        if (error) mathWarnings.push({formula:token.formula, message:error.getAttribute('title') || 'Formule non reconnue.'});
      } catch (error) {
        if (error.code === 'render_limit') throw error;
        wrapper.textContent = token.formula;
        wrapper.classList.add('folio-math-error');
        wrapper.title = String(error.message || error);
        mathWarnings.push({formula:token.formula, message:wrapper.title});
      }
      renderedNodeCount += measureTree(wrapper, false).nodeCount;
      if (renderedNodeCount > limits.maxNodes) throw limitError('nodes', 'Les formules produisent trop de contenu à afficher (limite : 40 000 nœuds de rendu par document). Scindez-le.');
      node.replaceWith(wrapper);
    }
    function plainText(node) {
      const parts = [];
      let child = node.firstChild;
      while (child) {
        const formula = child.nodeType === 1 ? child.getAttribute('data-folio-tex') : null;
        if (formula !== null) parts.push(formula);
        else if (child.nodeType === 3) parts.push(child.data);
        if (formula === null && child.firstChild) { child = child.firstChild; continue; }
        while (child && child !== node && !child.nextSibling) child = child.parentNode;
        if (!child || child === node) break;
        child = child.nextSibling;
      }
      return parts.join('');
    }
    const headings = [];
    const anchorMap = Object.create(null);
    const usedIds = new Set();
    const nextIdSuffix = new Map();
    const headingCounts = new Map();
    function addAnchor(alias, id) {
      if (alias && !Object.hasOwn(anchorMap, alias)) anchorMap[alias] = id;
    }
    function uniqueId(base) {
      let n = nextIdSuffix.get(base) || 0;
      let id = n ? base + '-' + n : base;
      while (usedIds.has(id)) id = base + '-' + ++n;
      nextIdSuffix.set(base, n + 1);
      usedIds.add(id);
      return id;
    }
    // Derive safe, predictable heading IDs; repeated headings get -1, -2, ...
    for (const node of fragment.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      const text = plainText(node).trim() || 'Section';
      const canonical = slug(text, false) || 'section';
      const count = headingCounts.get(canonical) || 0;
      headingCounts.set(canonical, count + 1);
      const suffix = count ? '-' + count : '';
      const id = uniqueId(prefix + (slug(text, true) || 'section') + suffix);
      node.id = id;
      addAnchor(canonical + suffix, id);
      addAnchor(slug(text, true) + suffix, id);
      addAnchor(id, id);
      addAnchor(node.getAttribute('data-folio-original-id'), id);
      node.removeAttribute('data-folio-original-id');
      headings.push({id, text, level: Number(node.tagName.slice(1))});
    }
    // Preserve explicitly named HTML anchors without letting them shadow UI IDs.
    for (const node of fragment.querySelectorAll('[data-folio-original-id]')) {
      const alias = node.getAttribute('data-folio-original-id');
      const id = uniqueId('folio-anchor-' + (slug(alias, true) || 'section'));
      node.id = id;
      addAnchor(alias, id);
      addAnchor(id, id);
      node.removeAttribute('data-folio-original-id');
    }
    for (const node of fragment.querySelectorAll('a')) {
      const href = safeUrl(node.getAttribute('href'), false);
      node.removeAttribute('href');
      if (href) node.setAttribute('href', href);
      if (/^(?:https?:)?\/\//i.test(href)) {
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
      }
    }
    for (const node of fragment.querySelectorAll('img')) {
      const source = safeUrl(node.getAttribute('data-folio-src'), true);
      node.removeAttribute('data-folio-src');
      if (source) node.setAttribute('data-folio-src', source);
      if (!node.hasAttribute('alt')) node.alt = '';
      node.loading = 'lazy';
      node.decoding = 'async';
      node.referrerPolicy = 'no-referrer';
    }
    for (const node of fragment.querySelectorAll('input')) {
      if (node.getAttribute('type') !== 'checkbox') { node.remove(); continue; }
      const checked = node.hasAttribute('checked');
      for (const attr of [...node.attributes]) node.removeAttribute(attr.name);
      node.type = 'checkbox';
      node.disabled = true;
      node.checked = checked;
      if (checked) node.setAttribute('checked', '');
      node.setAttribute('aria-label', checked ? 'Tâche terminée' : 'Tâche à faire');
      if (node.parentElement?.tagName === 'LI') node.parentElement.classList.add('task-list-item');
    }
    for (const node of fragment.querySelectorAll('code')) {
      const language = (node.className || '').match(/(?:^|\s)language-([a-z0-9_+-]+)(?:\s|$)/i);
      node.removeAttribute('class');
      if (language) node.className = 'language-' + language[1].toLowerCase();
    }
    for (const table of fragment.querySelectorAll('table')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'table-wrap';
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', 'Tableau, défilement horizontal si nécessaire');
      table.replaceWith(wrapper);
      wrapper.append(table);
    }
    const text = plainText(fragment);
    const words = /[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu;
    let wordCount = 0;
    while (words.exec(text)) wordCount++;
    const title = headings.find(h => h.level === 1)?.text || headings[0]?.text || '';
    const budget = measureTree(fragment, true);
    return {fragment, headings, title, wordCount, anchorMap, mathWarnings, mathCount:mathTokens.size, diagramWarnings:[], diagramCount:0, ...budget};
  }
  async function renderAsync(markdown) {
    const result = render(markdown);
    if (result.fragment.querySelector('pre > code.language-mermaid')) {
      Object.assign(result, await FolioDiagrams.render(result.fragment, unsupportedMathCommand));
      // Embedded SVG data counts towards the same document/collection/export
      // budgets as the rest of the rendered content.
      Object.assign(result, measureTree(result.fragment, true));
    }
    return result;
  }
  function resolveAnchor(result, rawAnchor) {
    let anchor = String(rawAnchor || '').replace(/^#/, '');
    try { anchor = decodeURIComponent(anchor); } catch (_) {}
    return result.anchorMap[anchor] || result.anchorMap[slug(anchor, false)] || result.anchorMap[slug(anchor, true)] || null;
  }
  window.FolioRenderer = Object.freeze({render, renderAsync, resolveAnchor, safeUrl, slug, limits, versions: {marked:'18.1.1', dompurify:'3.4.17', mermaid:'12.2.0'}});
})();
