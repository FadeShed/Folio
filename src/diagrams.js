/* Folio — local Mermaid rendering. Only generated SVG becomes an image;
 * imported HTML never gains permission to insert SVG or active resources.
 */
(function () {
  'use strict';
  const limits = Object.freeze({
    maxDiagrams: 50,
    maxDiagramLength: 16384,
    maxTotalDiagramLength: 131072,
    maxSvgBytes: 1024 * 1024,
    maxEdges: 500
  });
  const config = {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    maxTextSize: limits.maxDiagramLength,
    maxEdges: limits.maxEdges,
    htmlLabels: false,
    arrowMarkerAbsolute: false,
    fontFamily: 'Arial, sans-serif',
    altFontFamily: 'Arial, sans-serif',
    theme: 'default',
    themeCSS: '',
    look: 'classic',
    layout: 'dagre',
    flowchart: {htmlLabels: false, useMaxWidth: true},
    deterministicIds: false
  };
  // Both frontmatter and init directives must respect the local reader's
  // resource policy, rendering budgets and predictable fonts/theme.
  config.secure = [...Object.keys(config), 'secure', 'themeVariables', 'dompurifyConfig'];
  if (window.mermaid) window.mermaid.initialize(config);
  let nextId = 0;
  let queue = Promise.resolve();

  function sourcePanel(pre) {
    const details = document.createElement('details');
    details.className = 'mermaid-source';
    const summary = document.createElement('summary');
    summary.textContent = 'Voir le code Mermaid';
    details.append(summary, pre);
    return details;
  }

  function diagramImage(svg) {
    if (typeof svg !== 'string' || new TextEncoder().encode(svg).length > limits.maxSvgBytes) {
      throw new Error('Le diagramme produit trop de SVG (limite : 1 Mio). Simplifiez-le.');
    }
    // Parse without attaching to the document. A data SVG image is an isolated
    // image document: scripts, handlers, CSS and IDs cannot affect Folio or its
    // exports. It also preserves marker/gradient references across collections.
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg' || parsed.querySelector('parsererror')) {
      throw new Error('Le moteur a produit un SVG illisible.');
    }
    const image = document.createElement('img');
    image.className = 'mermaid-diagram';
    const title = root.querySelector('title')?.textContent.trim();
    const description = root.querySelector('desc')?.textContent.trim();
    image.alt = [title || 'Diagramme Mermaid', description].filter(Boolean).join(' — ');
    image.decoding = 'sync';
    // Reserve the final aspect ratio before the image decodes, so outlines and
    // saved reading positions do not shift after a document has been selected.
    const box = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
      image.width = Math.ceil(box[2]);
      image.height = Math.ceil(box[3]);
      // Percentage-sized roots have no intrinsic size in an SVG data image.
      // Give them real dimensions so small diagrams are not enlarged to the
      // entire article width, while CSS can still shrink them on mobile.
      root.setAttribute('width', String(image.width));
      root.setAttribute('height', String(image.height));
    }
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root));
    return image;
  }

  function checkMathCommands(source, unsupportedMathCommand) {
    if (typeof unsupportedMathCommand !== 'function') return;
    // Mermaid has its own KaTeX instance. Inspect the source and a conservative
    // decoded form: some label paths decode entities or collapse double
    // backslashes before invoking it. Never change the displayed/source text.
    const decoder = document.createElement('textarea');
    const normalized = source.replace(/&(?:amp;)+/gi, '&').replace(
      /&(?:#(?:x[\da-f]+|\d+)|[a-z][a-z\d]*);?|#(?:x[\da-f]+|\+?\d+|[a-z][a-z\d]*);/gi,
      reference => {
        decoder.innerHTML = reference[0] === '&' ? reference
          : /^#(?:x[\da-f]+|\+?\d+);$/i.test(reference) ? '&' + reference.replace('#+', '#')
          : '&' + reference.slice(1);
        return decoder.value;
      }
    ).replace(/\\\\/g, '\\');
    for (const text of new Set([source, normalized])) {
      const parts = text.split('$$');
      // Check every interval, not just alternating pairs: an unmatched delimiter
      // in a different label or comment must not hide another label's formula.
      for (let i = 1; i < parts.length - 1; i++) {
        const command = unsupportedMathCommand(parts[i]);
        if (command) throw new Error('La commande \\' + command + ' n’est pas prise en charge dans les formules Mermaid. Écrivez la formule sans définition de macro ni commande interne.');
      }
    }
  }

  async function renderDiagrams(fragment, unsupportedMathCommand) {
    // Only complete code blocks qualify; inline code stays literal. Classes on
    // imported HTML have already been normalised by FolioRenderer.
    const blocks = [...fragment.querySelectorAll('pre > code.language-mermaid')];
    const diagramWarnings = [];
    let totalLength = 0;
    for (const [index, code] of blocks.entries()) {
      const pre = code.parentElement, source = code.textContent;
      const figure = document.createElement('figure');
      figure.className = 'folio-mermaid';
      pre.replaceWith(figure);
      const details = sourcePanel(pre);
      let stage;
      try {
        totalLength += source.length;
        if (index >= limits.maxDiagrams) throw new Error('Limite de 50 diagrammes par document atteinte. Scindez le document.');
        if (source.length > limits.maxDiagramLength) throw new Error('Ce diagramme dépasse 16 384 caractères. Simplifiez-le.');
        if (totalLength > limits.maxTotalDiagramLength) throw new Error('Les diagrammes dépassent 131 072 caractères cumulés. Scindez le document.');
        checkMathCommands(source, unsupportedMathCommand);
        if (!window.mermaid) throw new Error('Le moteur Mermaid est indisponible.');
        // Mermaid needs a connected, measurable container; display:none would
        // give zero-sized text. Its temporary nodes are always removed below.
        stage = document.createElement('div');
        stage.className = 'mermaid-render-stage';
        stage.setAttribute('aria-hidden', 'true');
        stage.inert = true;
        document.body.append(stage);
        window.mermaid.initialize(config);
        const {svg} = await window.mermaid.render('folio-mermaid-' + (++nextId), source, stage);
        const viewport = document.createElement('div');
        viewport.className = 'mermaid-viewport';
        viewport.append(diagramImage(svg));
        figure.append(viewport);
      } catch (error) {
        const message = String(error.message || error).slice(0, 1200);
        const warning = document.createElement('p');
        warning.className = 'mermaid-error';
        warning.textContent = 'Diagramme Mermaid non rendu : ' + message;
        figure.append(warning);
        details.open = true;
        diagramWarnings.push({source, message});
      } finally {
        stage?.remove();
      }
      figure.append(details);
    }
    return {diagramCount: blocks.length, diagramWarnings};
  }

  function render(fragment, unsupportedMathCommand) {
    // Imports, restored collections and file watchers can overlap. Mermaid's
    // global configuration/temporary DOM must have a single owner at a time.
    const pending = queue.then(() => renderDiagrams(fragment, unsupportedMathCommand));
    queue = pending.catch(() => {});
    return pending;
  }
  window.FolioDiagrams = Object.freeze({render, limits, version: '12.2.0'});
})();
