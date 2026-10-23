/* Folio — optional, browser-local persistence. No network or localStorage.
 *
 * read() -> { enabled, revision, snapshot }
 * write(snapshot, expectedRevision) / remove(expectedRevision) -> same envelope
 * after transaction completion. A missing record has revision 0.
 *
 * The application owns snapshot validation, consent, debounce and conflict UI.
 * Mutations use compare-and-swap in one readwrite transaction. remove() retains
 * a revision-bearing tombstone; never delete this record to disable persistence.
 * No mutation is retried automatically, including after a timeout or conflict.
 */
(function (global) {
  'use strict';

  const DATABASE = 'folio-local-collection-v1';
  const STORE = 'collections';
  const VERSION = 1;
  const TIMEOUT_MS = 5000;
  const SCOPE = global.location.pathname || '/';

  class FolioStorageError extends Error {
    constructor(code, message, cause, current) {
      super(message);
      this.name = 'FolioStorageError';
      this.code = code;
      if (cause) this.cause = cause;
      if (current) this.current = current;
    }
  }

  function storageError(cause) {
    if (cause instanceof FolioStorageError) return cause;
    const name = cause && cause.name;
    if (name === 'QuotaExceededError') {
      return new FolioStorageError('quota',
        'L’espace disponible dans ce navigateur ne suffit pas pour enregistrer la collection.', cause);
    }
    if (name === 'VersionError') {
      return new FolioStorageError('blocked',
        'Une autre version de Folio utilise cet enregistrement local. Fermez ses autres onglets.', cause);
    }
    if (name === 'DataCloneError' || name === 'DataError') {
      return new FolioStorageError('invalid',
        'Les données de cette collection ne peuvent pas être enregistrées.', cause);
    }
    return new FolioStorageError('unavailable',
      'L’enregistrement local est indisponible ou a été interrompu dans ce navigateur.', cause);
  }

  function validRevision(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function envelope(record) {
    if (record === undefined) return { enabled: false, revision: 0, snapshot: null };
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        typeof record.enabled !== 'boolean' || !validRevision(record.revision) ||
        (!record.enabled && record.snapshot != null)) {
      throw new FolioStorageError('invalid', 'L’enregistrement local de cette page est illisible.');
    }
    return {
      enabled: record.enabled,
      revision: record.revision,
      snapshot: record.enabled ? record.snapshot : null
    };
  }

  function operate(kind, snapshot, expectedRevision) {
    return new Promise(function (resolve, reject) {
      const mutating = kind !== 'read';
      if (mutating && (!validRevision(expectedRevision) ||
          expectedRevision === Number.MAX_SAFE_INTEGER)) {
        reject(new FolioStorageError('invalid', 'La révision de la collection est invalide.'));
        return;
      }
      if (kind === 'write' && (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))) {
        reject(new FolioStorageError('invalid', 'La collection à enregistrer est invalide.'));
        return;
      }

      let settled = false;
      let db = null;
      let transaction = null;
      let result;
      let operationError = null;
      let request;

      // One deadline covers both opening and the entire transaction. Late open
      // callbacks still close/abort their connection instead of leaking it.
      const timer = global.setTimeout(function () {
        fail(new FolioStorageError('blocked',
          'L’enregistrement local ne répond pas. Le résultat de l’opération n’est pas confirmé.'));
      }, TIMEOUT_MS);

      function settle(error, value) {
        if (settled) return;
        settled = true;
        global.clearTimeout(timer);
        if (db) {
          try { db.close(); } catch (_) { /* Already closed. */ }
        }
        if (error) reject(error);
        else resolve(value);
      }

      function fail(error) {
        if (settled) return;
        operationError = storageError(error);
        if (transaction) {
          try { transaction.abort(); } catch (_) { /* Already completed/aborted. */ }
        }
        settle(operationError);
      }

      try {
        if (!global.indexedDB || typeof global.indexedDB.open !== 'function') {
          fail(new FolioStorageError('unavailable',
            'Ce navigateur ne permet pas de conserver la collection localement.'));
          return;
        }
        request = global.indexedDB.open(DATABASE, VERSION);
      } catch (error) {
        fail(error);
        return;
      }

      request.onblocked = function () {
        fail(new FolioStorageError('blocked',
          'Un autre onglet bloque l’enregistrement local. Fermez-le puis réessayez.'));
      };

      request.onerror = function () {
        fail(request.error);
      };

      request.onupgradeneeded = function () {
        if (settled) {
          try { request.transaction.abort(); } catch (_) { /* Already aborted. */ }
          return;
        }
        try {
          const upgradingDb = request.result;
          if (!upgradingDb.objectStoreNames.contains(STORE)) upgradingDb.createObjectStore(STORE);
        } catch (error) {
          try { request.transaction.abort(); } catch (_) { /* Already aborted. */ }
          fail(error);
        }
      };

      request.onsuccess = function () {
        db = request.result;
        if (settled) {
          db.close();
          return;
        }

        // close() permits an already-running transaction to finish and unblocks
        // database upgrades/deletion as soon as that transaction has settled.
        db.onversionchange = function () { db.close(); };
        db.onclose = function () {
          fail(new FolioStorageError('unavailable',
            'Le navigateur a fermé l’enregistrement local avant la fin de l’opération.'));
        };

        try {
          transaction = db.transaction(STORE, mutating ? 'readwrite' : 'readonly');
          transaction.oncomplete = function () {
            // Request success alone must never be exposed as a committed save.
            if (result === undefined) {
              settle(new FolioStorageError('unavailable',
                'L’enregistrement local s’est terminé sans résultat.'));
            } else {
              settle(null, result);
            }
          };
          transaction.onabort = function () {
            settle(operationError || storageError(transaction.error));
          };
          transaction.onerror = function (event) {
            // Do not preventDefault(): a failed request must abort the atomic
            // transaction. Retain its error because tx.error may still be null.
            if (!operationError) {
              const target = event.target;
              operationError = storageError(target && target.error || transaction.error);
            }
          };

          const store = transaction.objectStore(STORE);
          const getRequest = store.get(SCOPE);
          getRequest.onsuccess = function () {
            if (settled) return;
            try {
              const current = envelope(getRequest.result);
              if (!mutating) {
                result = current;
                return;
              }
              if (current.revision !== expectedRevision) {
                fail(new FolioStorageError('conflict',
                  'La copie locale a été modifiée ou effacée depuis un autre onglet.',
                  null, { enabled: current.enabled, revision: current.revision }));
                return;
              }
              result = {
                enabled: kind === 'write',
                revision: current.revision + 1,
                snapshot: kind === 'write' ? snapshot : null
              };
              // IndexedDB clones the raw snapshot during put(). The caller must
              // treat its snapshot as immutable until this promise has settled.
              store.put(result, SCOPE);
            } catch (error) {
              fail(error);
            }
          };
        } catch (error) {
          fail(error);
        }
      };
    });
  }

  global.FolioStorage = Object.freeze({
    read: function () { return operate('read'); },
    write: function (snapshot, expectedRevision) {
      return operate('write', snapshot, expectedRevision);
    },
    remove: function (expectedRevision) {
      return operate('remove', null, expectedRevision);
    }
  });
})(window);
