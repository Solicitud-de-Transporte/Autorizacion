/* ============================================================
   Capa IndexedDB - Insopesca El Morro
   v5: añade helpers de last_seen.
   ============================================================ */

(function () {
  'use strict';

  const DB_NAME    = 'insopesca_db';
  const DB_VERSION = 4;
  const S = {
    RECORDS:      'records',
    META:         'meta',
    IDENTITY:     'identity',
    LOCAL_HIDDEN: 'local_hidden',
    BURNED_IDS:   'burned_ids',
    AUDIT:        'audit_log',
    NOTIFS:       'status_notifications',
    BACKUPS:      'backups'
  };
  const OLD_LS_KEY = 'insopesca_history_v1';

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains(S.RECORDS)) {
          const st = db.createObjectStore(S.RECORDS, { keyPath: 'id' });
          st.createIndex('updated_at', 'updated_at');
          st.createIndex('status', 'status');
          st.createIndex('status_changed_at', 'status_changed_at');
          st.createIndex('created_by_id', 'created_by.id');
        }
        if (!db.objectStoreNames.contains(S.META)) {
          db.createObjectStore(S.META, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(S.IDENTITY)) {
          db.createObjectStore(S.IDENTITY, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(S.LOCAL_HIDDEN)) {
          db.createObjectStore(S.LOCAL_HIDDEN, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(S.BURNED_IDS)) {
          db.createObjectStore(S.BURNED_IDS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(S.AUDIT)) {
          const st = db.createObjectStore(S.AUDIT, { keyPath: 'id', autoIncrement: true });
          st.createIndex('ts', 'ts');
        }
        if (!db.objectStoreNames.contains(S.NOTIFS)) {
          const st = db.createObjectStore(S.NOTIFS, { keyPath: 'id', autoIncrement: true });
          st.createIndex('ts', 'ts');
          st.createIndex('target_user_id', 'target_user_id');
        }
        if (!db.objectStoreNames.contains(S.BACKUPS)) {
          const st = db.createObjectStore(S.BACKUPS, { keyPath: 'id', autoIncrement: true });
          st.createIndex('created_at', 'created_at');
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    return dbPromise;
  }

  async function getAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function putOne(storeName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
      tx.onabort    = () => reject(tx.error);
    });
  }

  async function putMany(storeName, values) {
    if (!values || !values.length) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      values.forEach(v => store.put(v));
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
      tx.onabort    = () => reject(tx.error);
    });
  }

  async function deleteOne(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }

  async function getOne(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  }

  const DB = {

    async getMeta(key) {
      const row = await getOne(S.META, key);
      return row ? row.value : undefined;
    },
    async setMeta(key, value) {
      return putOne(S.META, { key, value });
    },
    async getDeviceId() {
      let id = await this.getMeta('device_id');
      if (!id) {
        id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        await this.setMeta('device_id', id);
      }
      return id;
    },
    async getSyncRoom() {
      const v = await this.getMeta(CONFIG.SYNC_META_KEY);
      return v || CONFIG.SYNC_ROOM;
    },
    async setSyncRoom(room) { return this.setMeta(CONFIG.SYNC_META_KEY, room); },

    /* ---------- LAST SEEN (por usuario, local a este dispositivo) ---------- */
    async setLastSeen(userId, info) {
      if (!userId) return;
      return this.setMeta('last_seen_' + userId, info);
    },
    async getAllLastSeen() {
      const all = await getAll(S.META);
      const seen = {};
      all.forEach(row => {
        if (row.key && row.key.startsWith('last_seen_')) {
          const userId = row.key.slice('last_seen_'.length);
          seen[userId] = row.value;
        }
      });
      return seen;
    },

    async getIdentity() { return getOne(S.IDENTITY, 'current'); },
    async setIdentity(identity) { return putOne(S.IDENTITY, Object.assign({ key: 'current' }, identity)); },
    async clearIdentity() { return deleteOne(S.IDENTITY, 'current'); },

    async getLocalHiddenSet() {
      const rows = await getAll(S.LOCAL_HIDDEN);
      return new Set(rows.map(r => r.id));
    },
    async addLocalHidden(id) {
      const deviceId = await this.getDeviceId();
      return putOne(S.LOCAL_HIDDEN, { id, device_id: deviceId, ts: Date.now() });
    },
    async removeLocalHidden(id) { return deleteOne(S.LOCAL_HIDDEN, id); },
    async clearLocalHidden() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(S.LOCAL_HIDDEN, 'readwrite');
        tx.objectStore(S.LOCAL_HIDDEN).clear();
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    },

    async isBurned(id) { return !!(await getOne(S.BURNED_IDS, id)); },
    async markBurned(id, info) {
      return putOne(S.BURNED_IDS, Object.assign({ id, ts: Date.now() }, info || {}));
    },
    async getBurnedIds() { return getAll(S.BURNED_IDS); },

    async addAudit(entry) {
      const deviceId = await this.getDeviceId();
      const row = Object.assign({ ts: Date.now(), device_id: deviceId }, entry);
      await putOne(S.AUDIT, row);
      const all = await getAll(S.AUDIT);
      if (all.length > CONFIG.AUDIT_MAX_ENTRIES) {
        const toDelete = all.sort((a, b) => a.ts - b.ts)
          .slice(0, all.length - CONFIG.AUDIT_MAX_ENTRIES);
        const db = await openDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(S.AUDIT, 'readwrite');
          const st = tx.objectStore(S.AUDIT);
          toDelete.forEach(r => st.delete(r.id));
          tx.oncomplete = () => resolve();
          tx.onerror    = () => reject(tx.error);
        });
      }
    },
    async getAuditLog(limit) {
      const all = await getAll(S.AUDIT);
      const sorted = all.sort((a, b) => b.ts - a.ts);
      return limit ? sorted.slice(0, limit) : sorted;
    },
    async clearAuditLog() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(S.AUDIT, 'readwrite');
        tx.objectStore(S.AUDIT).clear();
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    },

    async getAllRecords() {
      const [all, hidden, burned] = await Promise.all([
        getAll(S.RECORDS),
        this.getLocalHiddenSet(),
        this.getBurnedIds().then(rows => new Set(rows.map(r => r.id)))
      ]);
      return all
        .filter(r => !r.deleted && !hidden.has(r.id) && !burned.has(r.id))
        .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    },
    async getAllRecordsRaw() { return getAll(S.RECORDS); },
    async getRecord(id) { return getOne(S.RECORDS, id); },

    async putRecord(record) {
      if (record && record.id && !record.deleted) {
        const burned = await getOne(S.BURNED_IDS, record.id);
        if (burned) return;
      }
      return putOne(S.RECORDS, record);
    },
    async putRecords(records) { return putMany(S.RECORDS, records); },

    async softDeleteLocal(id) { return this.addLocalHidden(id); },

    async softDeleteGlobal(id, actor) {
      const existing = await this.getRecord(id);
      if (!existing) return;
      const deviceId = await this.getDeviceId();
      await this.putRecord(Object.assign({}, existing, {
        deleted: true, updated_at: Date.now(), device_id: deviceId, deleted_by: actor || null
      }));
      await this.markBurned(id, { by: actor || null });
    },

    async hardDeleteRecord(id) { return deleteOne(S.RECORDS, id); },

    async replaceAllRecords(records) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(S.RECORDS, 'readwrite');
        const store = tx.objectStore(S.RECORDS);
        store.clear();
        (records || []).forEach(r => store.put(r));
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    },

    async getStatusSeenMap(userId) {
      const v = await this.getMeta('status_seen_' + userId);
      return v || {};
    },
    async setStatusSeen(userId, recordId, ts) {
      const map = await this.getStatusSeenMap(userId);
      map[recordId] = ts || Date.now();
      return this.setMeta('status_seen_' + userId, map);
    },

    async addStatusNotification(notif) {
      const row = Object.assign({ ts: Date.now(), read: false }, notif);
      return putOne(S.NOTIFS, row);
    },
    async getStatusNotifications(userId, unreadOnly) {
      const all = await getAll(S.NOTIFS);
      return all
        .filter(n => n.target_user_id === userId)
        .filter(n => unreadOnly ? !n.read : true)
        .sort((a, b) => b.ts - a.ts);
    },
    async markNotificationRead(id) {
      const row = await getOne(S.NOTIFS, id);
      if (!row) return;
      row.read = true;
      return putOne(S.NOTIFS, row);
    },
    async clearNotifications(userId) {
      const all = await getAll(S.NOTIFS);
      const toDelete = all.filter(n => n.target_user_id === userId);
      if (!toDelete.length) return;
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(S.NOTIFS, 'readwrite');
        const st = tx.objectStore(S.NOTIFS);
        toDelete.forEach(n => st.delete(n.id));
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    },

    async saveBackup(snapshot, meta) {
      const deviceId = await this.getDeviceId();
      const row = {
        created_at: Date.now(),
        device_id: deviceId,
        version: CONFIG.APP_VERSION,
        meta: meta || {},
        snapshot: snapshot
      };
      await putOne(S.BACKUPS, row);
      const all = await getAll(S.BACKUPS);
      if (all.length > CONFIG.BACKUP_MAX_COUNT) {
        const toDelete = all.sort((a, b) => a.created_at - b.created_at)
          .slice(0, all.length - CONFIG.BACKUP_MAX_COUNT);
        const db = await openDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(S.BACKUPS, 'readwrite');
          const st = tx.objectStore(S.BACKUPS);
          toDelete.forEach(r => st.delete(r.id));
          tx.oncomplete = () => resolve();
          tx.onerror    = () => reject(tx.error);
        });
      }
      return row;
    },
    async getBackups() {
      const all = await getAll(S.BACKUPS);
      return all.sort((a, b) => b.created_at - a.created_at);
    },
    async getBackup(id) { return getOne(S.BACKUPS, id); },
    async deleteBackup(id) { return deleteOne(S.BACKUPS, id); },
    async clearBackups() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(S.BACKUPS, 'readwrite');
        tx.objectStore(S.BACKUPS).clear();
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    },

    async migrateFromLocalStorage() {
      const raw = localStorage.getItem(OLD_LS_KEY);
      if (!raw) return { migrated: 0 };
      try {
        const old = JSON.parse(raw);
        if (!Array.isArray(old) || !old.length) return { migrated: 0 };
        const deviceId = await this.getDeviceId();
        const existing = await this.getAllRecordsRaw();
        const existingIds = new Set(existing.map(r => r.id));
        const toImport = old
          .filter(r => r && r.id != null && !existingIds.has(r.id))
          .map(r => Object.assign({}, r, {
            device_id: deviceId,
            updated_at: r.savedAt ? new Date(r.savedAt).getTime() : (r.id || Date.now()),
            deleted: false,
            status: CONFIG.STATUS.PENDIENTE,
            status_changed_at: 0,
            status_changed_by: null,
            observations: '',
            sent_to_balance: false,
            sent_to_balance_at: 0,
            created_by: null,
            updated_by: null
          }));
        if (toImport.length) await this.putRecords(toImport);
        return { migrated: toImport.length };
      } catch (e) {
        console.error('[DB] migración falló:', e);
        return { migrated: 0, error: e.message };
      }
    }
  };

  window.DB = DB;
})();
