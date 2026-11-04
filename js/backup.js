/* ============================================================
   Respaldos automáticos - Insopesca El Morro
   - Snapshot en IndexedDB tras cada cambio (debounced)
   - Rotación automática (últimos N)
   - Exportar a archivo .json
   - Importar desde archivo (merge o replace)
   ============================================================ */

window.Backup = (function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    initialized: false,
    debounceTimer: null,
    lastBackupAt: 0,
    running: false
  };

  function toast(msg) {
    if (typeof window.toast === 'function') window.toast(msg);
    else console.log('[backup]', msg);
  }

  /* ---------- snapshot ---------- */
  async function buildSnapshot() {
    const records = await DB.getAllRecordsRaw();
    const hidden = await DB.getLocalHiddenSet();
    const burned = await DB.getBurnedIds();
    const audit = await DB.getAuditLog(CONFIG.BACKUP_AUDIT_LIMIT);
    const deviceId = await DB.getDeviceId();
    const syncRoom = await DB.getSyncRoom();
    return {
      version: CONFIG.APP_VERSION,
      device_id: deviceId,
      sync_room: syncRoom,
      exported_at: new Date().toISOString(),
      records: records,
      local_hidden: Array.from(hidden),
      burned_ids: burned.map(b => ({ id: b.id, ts: b.ts, by: b.by })),
      audit: audit
    };
  }

  /* ---------- crear respaldo ---------- */
  async function create(reason) {
    if (state.running) return null;
    state.running = true;
    try {
      const snapshot = await buildSnapshot();
      const recordCount = snapshot.records.length;
      const row = await DB.saveBackup(snapshot, {
        reason: reason || 'manual',
        records: recordCount
      });
      state.lastBackupAt = Date.now();
      console.log('[backup] creado', reason, '· registros:', recordCount);
      return row;
    } catch (e) {
      console.warn('[backup] create falló:', e);
      return null;
    } finally {
      state.running = false;
    }
  }

  /* ---------- programar (debounced) ---------- */
  function schedule(reason) {
    if (!CONFIG.BACKUP_ENABLED) return;
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(function () {
      state.debounceTimer = null;
      create(reason || 'auto');
    }, CONFIG.BACKUP_DEBOUNCE_MS);
  }

  /* ---------- listar / borrar ---------- */
  async function list() { return DB.getBackups(); }
  async function remove(id) { return DB.deleteBackup(id); }
  async function clearAll() { return DB.clearBackups(); }

  /* ---------- exportar a archivo ---------- */
  function buildFilename(prefix, meta) {
    const d = new Date(meta && meta.created_at ? meta.created_at : Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    const ts = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
               '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    return prefix + ts + '.json';
  }

  async function exportToFile(backupId) {
    let snapshot, meta;
    if (backupId) {
      const row = await DB.getBackup(backupId);
      if (!row) { toast('⚠️ Respaldo no encontrado'); return false; }
      snapshot = row.snapshot;
      meta = Object.assign({ created_at: row.created_at, reason: row.meta && row.meta.reason }, row.meta || {});
    } else {
      snapshot = await buildSnapshot();
      meta = { created_at: Date.now(), reason: 'manual_export' };
    }
    const payload = Object.assign({
      _meta: {
        app: CONFIG.APP_NAME,
        app_version: CONFIG.APP_VERSION,
        exported_at: new Date().toISOString()
      }
    }, snapshot);

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildFilename('insopesca_respaldo_', meta);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    try {
      await DB.addAudit({
        action: 'backup_export',
        actor: { id: 'admin', name: 'Admin' },
        meta: { filename: a.download }
      });
    } catch (e) {}
    toast('⬇️ Respaldo descargado');
    return true;
  }

  /* ---------- aplicar snapshot ---------- */
  async function applySnapshot(snapshot, mode) {
    if (!snapshot || !Array.isArray(snapshot.records)) {
      toast('⚠️ Snapshot inválido');
      return false;
    }
    let imported = 0, ignored = 0;

    if (mode === 'replace') {
      await DB.replaceAllRecords(snapshot.records);
      imported = snapshot.records.length;
      if (Array.isArray(snapshot.burned_ids)) {
        for (const b of snapshot.burned_ids) {
          await DB.markBurned(b.id, { by: b.by, ts: b.ts });
        }
      }
      await DB.clearLocalHidden();
      if (Array.isArray(snapshot.local_hidden)) {
        for (const id of snapshot.local_hidden) {
          await DB.addLocalHidden(id);
        }
      }
    } else {
      /* merge: LWW por updated_at, tombstones prevalecientes */
      for (const r of snapshot.records) {
        if (!r || r.id == null) { ignored++; continue; }
        if (r.deleted) {
          await DB.putRecord(r);
          await DB.markBurned(r.id, { by: r.deleted_by });
          imported++;
        } else if (await DB.isBurned(r.id)) {
          ignored++;
        } else {
          const existing = await DB.getRecord(r.id);
          if (!existing || (r.updated_at || 0) > (existing.updated_at || 0)) {
            await DB.putRecord(r);
            imported++;
          } else {
            ignored++;
          }
        }
      }
      if (Array.isArray(snapshot.burned_ids)) {
        for (const b of snapshot.burned_ids) {
          await DB.markBurned(b.id, { by: b.by, ts: b.ts });
        }
      }
    }

    /* refrescar UI */
    if (typeof window.reloadRecordsFromDB === 'function') {
      await window.reloadRecordsFromDB();
    }
    if (typeof window.updateBadges === 'function') window.updateBadges();
    if (typeof window.renderHistory === 'function') await window.renderHistory();
    if (window.Admin && Admin.refreshDashboard) Admin.refreshDashboard();
    if (window.Balance && Balance.renderList) Balance.renderList();

    /* difundir cambios */
    for (const r of (snapshot.records || [])) {
      if (r && r.id != null) {
        window.dispatchEvent(new CustomEvent('insopesca:record-changed', { detail: r }));
      }
    }
    return { imported, ignored };
  }

  /* ---------- importar desde archivo ---------- */
  async function importFromFile(file, mode) {
    if (!file) return false;
    let data;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch (e) {
      toast('⚠️ El archivo no es un JSON válido');
      return false;
    }
    if (!data || !Array.isArray(data.records)) {
      toast('⚠️ El archivo no tiene el formato esperado');
      return false;
    }

    mode = (mode === 'replace') ? 'replace' : 'merge';

    if (mode === 'replace') {
      if (!confirm('⚠️ MODO REEMPLAZAR: se borrarán TODOS los datos actuales y se restaurarán los del archivo.\n\n¿Continuar?')) {
        return false;
      }
      if (!confirm('⚠️ ÚLTIMA CONFIRMACIÓN: esta acción es irreversible.\n\n¿Está completamente seguro?')) {
        return false;
      }
    }

    /* hacer respaldo de seguridad antes de importar */
    await create('pre_import');

    const result = await applySnapshot(data, mode);
    if (!result) return false;

    try {
      await DB.addAudit({
        action: 'backup_import',
        actor: { id: 'admin', name: 'Admin' },
        meta: { mode: mode, imported: result.imported, ignored: result.ignored }
      });
    } catch (e) {}

    toast('✅ ' + result.imported + ' importados, ' + result.ignored + ' ignorados');
    return true;
  }

  /* ---------- init ---------- */
  async function init() {
    if (state.initialized) return;
    state.initialized = true;
    if (!CONFIG.BACKUP_ENABLED) return;

    /* respaldo inicial si nunca hubo o pasó más de 24h */
    try {
      const existing = await DB.getBackups();
      const last = existing[0];
      const shouldBackup = !last || (Date.now() - last.created_at) > CONFIG.BACKUP_INTERVAL_MS;
      if (shouldBackup) schedule('init');
      else state.lastBackupAt = last.created_at;
    } catch (e) { console.warn('[backup] init check', e); }

    /* programar tras cada cambio */
    window.addEventListener('insopesca:record-changed', function () {
      schedule('change');
    });
  }

  return {
    init: init,
    schedule: schedule,
    create: create,
    list: list,
    remove: remove,
    clearAll: clearAll,
    exportToFile: exportToFile,
    importFromFile: importFromFile
  };
})();
