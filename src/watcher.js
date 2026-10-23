/* Folio — read-only watching of explicitly linked local Markdown files.
 * No FileSystemObserver, network request, or write to the original file.
 *
 * watch/checkNow/resume resolve to true only when onChange accepted a version.
 * onChange(file, {signal,isCurrent}) may be asynchronous: the application must
 * check isCurrent() after its own awaits before changing a document's content.
 * link() and resume() must be called directly from a user interaction.
 */
(function (global) {
  'use strict';

  const POLL_MS = 2000;
  const STABILITY_MS = 250;
  const MISSING_LIMIT = 3;
  const MISSING_SPACING_MS = 1800;
  const watchers = new Map();
  const document = global.document;
  const supported = global.isSecureContext === true &&
    typeof global.showOpenFilePicker === 'function';
  let timer = null;
  let pageActive = true;

  function isVisible() {
    return pageActive && document.visibilityState !== 'hidden';
  }

  function isCurrent(record) {
    return watchers.get(record.id) === record && !record.controller.signal.aborted;
  }

  function mayRead(record) {
    return isCurrent(record) && !record.paused && isVisible();
  }

  function notify(record, state, message) {
    if (!isCurrent(record) || record.state === state && record.message === message) return;
    record.state = state;
    record.message = message;
    try {
      const pending = record.onStatus(state, message);
      if (pending && typeof pending.catch === 'function') pending.catch(function () {});
    } catch (_) { /* A presentation callback must not break the watcher. */ }
  }

  function pause(record, message, error) {
    if (!isCurrent(record)) return;
    record.paused = true;
    notify(record, error ? 'error' : 'paused', message);
  }

  function abortedError() {
    const error = new Error('La surveillance de ce fichier a été arrêtée.');
    error.name = 'AbortError';
    return error;
  }

  // Native handle promises cannot be cancelled. Race their result against the
  // watch lifecycle so closing/replacing a document releases our pending work.
  function cancellable(promise, record) {
    return new Promise(function (resolve, reject) {
      const signal = record.controller.signal;
      let done = false;
      function finish(error, value) {
        if (done) return;
        done = true;
        signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(value);
      }
      function onAbort() { finish(abortedError()); }
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(promise).then(function (value) { finish(null, value); }, finish);
      if (signal.aborted) onAbort();
    });
  }

  function waitForStability(record) {
    return new Promise(function (resolve) {
      const signal = record.controller.signal;
      let done = false;
      const timeout = global.setTimeout(function () { finish(true); }, STABILITY_MS);
      function finish(value) {
        if (done) return;
        done = true;
        global.clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      }
      function onAbort() { finish(false); }
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }

  function signature(file) {
    if (!file || !Number.isFinite(file.lastModified) || !Number.isFinite(file.size) ||
        file.size < 0 || typeof file.text !== 'function') {
      throw new Error('Le fichier lié est illisible.');
    }
    return String(file.lastModified) + ':' + String(file.size);
  }

  async function inspect(record) {
    if (!mayRead(record)) return false;
    let attemptedSignature = null;
    try {
      const permission = await cancellable(record.handle.queryPermission({ mode: 'read' }), record);
      if (!mayRead(record)) return false;
      if (permission !== 'granted') {
        pause(record, 'Autorisation de lecture à renouveler. Cliquez sur « Rétablir l’accès ».');
        return false;
      }

      const first = await cancellable(record.handle.getFile(), record);
      if (!mayRead(record)) return false;
      record.missingCount = 0;
      record.lastMissingAt = null;
      const firstSignature = signature(first);
      if (firstSignature === record.signature) {
        notify(record, 'watching', 'Surveillance active — fichier à jour.');
        return false;
      }

      if (firstSignature !== record.pendingSignature) {
        notify(record, 'checking', 'Vérification de la nouvelle version du fichier…');
      }
      if (!await waitForStability(record) || !mayRead(record)) return false;
      const second = await cancellable(record.handle.getFile(), record);
      if (!mayRead(record)) return false;
      const secondSignature = signature(second);
      if (firstSignature !== secondSignature) {
        notify(record, 'checking', 'Enregistrement en cours — attente d’une version stable.');
        return false;
      }

      const context = Object.freeze({
        signal: record.controller.signal,
        isCurrent: function () { return isCurrent(record); }
      });
      attemptedSignature = secondSignature;
      const accepted = await cancellable(record.onChange(second, context), record);
      if (!isCurrent(record)) return false;
      if (accepted === false) {
        record.pendingSignature = secondSignature;
        notify(record, 'checking', 'Mise à jour reportée — nouvelle vérification à venir.');
        return false;
      }
      record.signature = secondSignature;
      record.pendingSignature = null;
      notify(record, 'watching', 'Surveillance active — fichier à jour.');
      return true;
    } catch (error) {
      if (!isCurrent(record)) return false;
      if (error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        pause(record, 'Autorisation de lecture à renouveler. Cliquez sur « Rétablir l’accès ».');
      } else if (error && error.name === 'NotFoundError') {
        // Some editors briefly remove the file during an atomic save. Rapid
        // focus/manual probes must not exhaust the grace period in one instant.
        const now = global.Date.now();
        if (!record.missingCount || now - record.lastMissingAt >= MISSING_SPACING_MS) {
          record.missingCount += 1;
          record.lastMissingAt = now;
        }
        if (record.missingCount >= MISSING_LIMIT) {
          pause(record, 'Fichier toujours introuvable : il a peut-être été déplacé ou remplacé. Cliquez sur « Choisir à nouveau ».');
        } else {
          notify(record, 'checking', 'Fichier temporairement introuvable — nouvelle vérification à venir.');
        }
      } else if (error && error.name === 'NotReadableError') {
        // Editors may briefly lock/replace the file while saving. Preserve the
        // acknowledged version and retry at the next ordinary polling interval.
        notify(record, 'checking', 'Fichier temporairement indisponible — nouvelle vérification à venir.');
      } else {
        // A rejected content version must not disable the watch. Retry the next
        // poll, suppressing repeated status notifications for the same metadata.
        if (attemptedSignature) record.pendingSignature = attemptedSignature;
        let detail = '';
        if (attemptedSignature && error && typeof error.message === 'string') {
          detail = error.message.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 360);
        }
        notify(record, 'error', detail || 'La nouvelle version est illisible. La dernière version lisible est conservée.');
      }
      return false;
    }
  }

  function checkNow(id) {
    const record = watchers.get(id);
    if (!record || !mayRead(record)) return Promise.resolve(false);
    if (record.work) return record.work;
    // Defer inspect by one microtask so record.work is already assigned when a
    // synchronous UI callback asks for another inspection of the same file.
    const work = Promise.resolve().then(function () { return inspect(record); });
    record.work = work.finally(function () {
      if (isCurrent(record)) record.work = null;
    });
    return record.work;
  }

  function checkAll() {
    if (!isVisible()) return;
    for (const id of watchers.keys()) void checkNow(id);
  }

  function stopTimer() {
    if (timer !== null) global.clearInterval(timer);
    timer = null;
  }

  function startTimer() {
    if (timer === null && watchers.size && isVisible()) {
      timer = global.setInterval(checkAll, POLL_MS);
    }
  }

  function unwatch(id) {
    const record = watchers.get(id);
    if (!record) return;
    watchers.delete(id);
    record.controller.abort();
    if (!watchers.size) stopTimer();
  }

  function watch(id, handle, callbacks) {
    if (id === null || id === undefined || !handle || handle.kind !== 'file' ||
        typeof handle.getFile !== 'function' || typeof handle.queryPermission !== 'function' ||
        !callbacks || typeof callbacks.onChange !== 'function') {
      throw new TypeError('Un fichier local lisible et un rappel de mise à jour sont nécessaires.');
    }
    unwatch(id);
    const record = {
      id: id,
      handle: handle,
      onChange: callbacks.onChange,
      onStatus: typeof callbacks.onStatus === 'function' ? callbacks.onStatus : function () {},
      controller: new global.AbortController(),
      paused: false,
      signature: null,
      pendingSignature: null,
      missingCount: 0,
      lastMissingAt: null,
      state: '',
      message: '',
      work: null,
      permissionWork: null
    };
    watchers.set(id, record);
    notify(record, 'checking', 'Vérification du fichier lié…');
    startTimer();
    return checkNow(id);
  }

  function resume(id) {
    const record = watchers.get(id);
    if (!record || !isCurrent(record)) return Promise.resolve(false);
    if (record.permissionWork) return record.permissionWork;
    let request;
    try {
      // This is deliberately the only requestPermission call in the module.
      // Invoke it before any await so the caller's user activation is retained.
      if (typeof record.handle.requestPermission !== 'function') {
        pause(record, 'Cliquez sur « Choisir à nouveau » pour autoriser la lecture de ce fichier.');
        return Promise.resolve(false);
      }
      request = record.handle.requestPermission({ mode: 'read' });
    } catch (_) {
      pause(record, 'Autorisation non accordée. Cliquez sur « Rétablir l’accès » ou « Choisir à nouveau ».');
      return Promise.resolve(false);
    }
    record.permissionWork = cancellable(request, record).then(async function (permission) {
      if (!isCurrent(record)) return false;
      if (permission !== 'granted') {
        pause(record, 'Autorisation non accordée. Cliquez sur « Rétablir l’accès » ou « Choisir à nouveau ».');
        return false;
      }
      if (record.work) await record.work;
      if (!isCurrent(record)) return false;
      record.paused = false;
      record.missingCount = 0;
      record.lastMissingAt = null;
      notify(record, 'checking', 'Reprise de la surveillance du fichier…');
      return checkNow(id);
    }).catch(function () {
      if (isCurrent(record)) pause(record, 'Autorisation non accordée. Cliquez sur « Rétablir l’accès » ou « Choisir à nouveau ».');
      return false;
    }).finally(function () {
      if (isCurrent(record)) record.permissionWork = null;
    });
    return record.permissionWork;
  }

  async function link() {
    if (!supported) {
      const error = new Error('La liaison directe à un fichier local n’est pas disponible dans ce navigateur ou sur cette page.');
      error.code = 'unsupported';
      throw error;
    }
    // Called directly during a click; no asynchronous work before the picker.
    const handles = await global.showOpenFilePicker({
      multiple: false,
      excludeAcceptAllOption: true,
      types: [{
        description: 'Documents Markdown',
        accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'] }
      }]
    });
    const handle = handles && handles[0];
    if (!handle || handle.kind !== 'file' || typeof handle.getFile !== 'function') {
      throw new TypeError('Aucun fichier Markdown n’a été sélectionné.');
    }
    return handle;
  }

  function stopAll() {
    for (const id of Array.from(watchers.keys())) unwatch(id);
    stopTimer();
  }

  document.addEventListener('visibilitychange', function () {
    if (!isVisible()) {
      stopTimer();
      return;
    }
    startTimer();
    checkAll();
  });
  global.addEventListener('focus', checkAll);
  global.addEventListener('pagehide', function () {
    pageActive = false;
    stopTimer();
  });
  global.addEventListener('pageshow', function () {
    pageActive = true;
    startTimer();
    checkAll();
  });

  global.FolioWatcher = Object.freeze({
    supported: supported,
    link: link,
    watch: watch,
    checkNow: checkNow,
    resume: resume,
    unwatch: unwatch,
    stopAll: stopAll
  });
})(window);
