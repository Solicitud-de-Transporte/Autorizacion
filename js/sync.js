/* ============================================================
   Sincronización P2P - Insopesca El Morro
   v1.8.0: guarda last_seen por usuario al detectar hello / leave.
   ============================================================ */

window.Sync = (function () {
  'use strict';

  const S = {
    enabled: false,
    connected: false,
    room: null,
    roomName: null,
    selfId: null,
    deviceId: null,
    peers: new Map(),
    trystero: null,
    senders: { hello: null, requestState: null, state: null, change: null },
    healthTimer: null,
    startedAt: null
  };

  async function loadTrystero() {
    if (S.trystero) return S.trystero;
    try {
      const mod = await import('https://esm.sh/trystero@0.21.6');
      S.trystero = mod;
      return mod;
    } catch (e) {
      console.warn('[Sync] No se pudo cargar Trystero:', e);
      return null;
    }
  }

  async function recordLastSeen(userId, info) {
    try {
      await DB.setLastSeen(userId, info);
    } catch (e) { /* silencio */ }
  }

  async function applyIncomingRecord(incoming) {
    if (!incoming || incoming.id == null) return false;

    if (incoming.deleted) {
      if (await DB.isBurned(incoming.id)) return false;
      await DB.putRecord(incoming);
      await DB.markBurned(incoming.id, { by: incoming.deleted_by || null });
      return true;
    }

    if (await DB.isBurned(incoming.id)) return false;

    const existing = await DB.getRecord(incoming.id);
    if (!existing || (incoming.updated_at || 0) > (existing.updated_at || 0)) {
      await DB.putRecord(incoming);
      const user = Identity.getCurrentUser();
      if (user && incoming.created_by && incoming.created_by.id === user.id && existing) {
        if (existing.status !== incoming.status && incoming.status_changed_at) {
          if (window.Balance && Balance.notifyStatusChange) {
            try { await Balance.notifyStatusChange(incoming); } catch (e) {}
          }
        }
      }
      return true;
    }
    return false;
  }

  async function applyIncomingState(records) {
    if (!Array.isArray(records)) return false;
    let changed = false;
    for (let i = 0; i < records.length; i++) {
      try {
        if (await applyIncomingRecord(records[i])) changed = true;
      } catch (e) {
        console.warn('[Sync] merge error', e);
      }
    }
    return changed;
  }

  async function reloadAndNotify() {
    try {
      if (typeof window.reloadRecordsFromDB === 'function') await window.reloadRecordsFromDB();
      if (typeof window.updateBadges === 'function') window.updateBadges();
      if (typeof window.renderHistory === 'function') await window.renderHistory();
      if (window.Admin && typeof Admin.refreshDashboard === 'function') {
        Admin.refreshDashboard().catch(function () {});
      }
      if (window.Balance && typeof Balance.renderList === 'function') {
        Balance.renderList().catch(function () {});
      }
      if (window.Backup && typeof Backup.schedule === 'function') {
        Backup.schedule('sync');
      }
    } catch (e) {
      console.warn('[Sync] reloadAndNotify', e);
    }
  }

  async function handleHello(data, peerId) {
    if (!data || !data.id) return;
    S.peers.set(peerId, {
      peerId: peerId, id: data.id,
      name: data.name || 'Sin nombre',
      role: data.role || 'operador',
      port: data.port || '',
      joinedAt: Date.now()
    });
    /* Registrar last_seen */
    await recordLastSeen(data.id, {
      name: data.name || 'Sin nombre',
      role: data.role || 'operador',
      port: data.port || '',
      ts: Date.now(),
      online: true
    });
    updatePeersUI();
    await sendFullState(peerId);
  }

  async function handleRequestState(_data, peerId) { await sendFullState(peerId); }

  async function handleState(data) {
    if (!data || !Array.isArray(data.records)) return;
    const changed = await applyIncomingState(data.records);
    if (changed) await reloadAndNotify();
  }

  async function handleChange(data) {
    if (!data || !data.record) return;
    const changed = await applyIncomingRecord(data.record);
    if (changed) await reloadAndNotify();
  }

  async function sendFullState(peerId) {
    if (!S.senders.state) return;
    try {
      const raw = await DB.getAllRecordsRaw();
      const payload = { records: raw };
      if (peerId) S.senders.state(payload, peerId);
      else S.senders.state(payload);
    } catch (e) { console.warn('[Sync] sendFullState', e); }
  }

  async function broadcastChange(record) {
    if (!S.senders.change || !record) return;
    try { S.senders.change({ record: record }); }
    catch (e) { console.warn('[Sync] broadcastChange', e); }
  }

  function updatePeersUI() {
    if (window.Admin && typeof Admin.refreshOnline === 'function') Admin.refreshOnline();
  }

  async function start() {
    if (S.enabled) return true;
    if (!CONFIG.SYNC_ENABLED) return false;
    const user = Identity.getCurrentUser();
    if (!user) return false;
    S.selfId = user.id;
    S.deviceId = await DB.getDeviceId();

    const trystero = await loadTrystero();
    if (!trystero || typeof trystero.joinRoom !== 'function') return false;

    S.roomName = await DB.getSyncRoom();
    try {
      S.room = trystero.joinRoom({ appId: 'insopesca-morro-sync-v1' }, S.roomName);
    } catch (e) { console.error('[Sync] joinRoom falló:', e); return false; }

    const [sendHello, getHello] = S.room.makeAction('hello');
    const [sendRequestState, getRequestState] = S.room.makeAction('req');
    const [sendState, getState] = S.room.makeAction('state');
    const [sendChange, getChange] = S.room.makeAction('change');

    S.senders = { hello: sendHello, requestState: sendRequestState, state: sendState, change: sendChange };

    getHello((d, p) => handleHello(d, p));
    getRequestState((d, p) => handleRequestState(d, p));
    getState((d, p) => handleState(d, p));
    getChange((d, p) => handleChange(d, p));

    S.room.onPeerJoin(function (peerId) {
      try {
        sendHello({
          id: S.selfId, name: user.name, role: user.role,
          port: user.port || '', deviceId: S.deviceId
        });
      } catch (e) { console.warn('[Sync] hello send failed', e); }
    });

    S.room.onPeerLeave(function (peerId) {
      const peer = S.peers.get(peerId);
      if (peer && peer.id) {
        /* Guardar last_seen del que se fue (marca offline) */
        recordLastSeen(peer.id, {
          name: peer.name || 'Sin nombre',
          role: peer.role || 'operador',
          port: peer.port || '',
          ts: Date.now(),
          online: false
        });
      }
      S.peers.delete(peerId);
      updatePeersUI();
    });

    S.healthTimer = setInterval(function () {
      if (!S.senders.requestState) return;
      try { S.senders.requestState({}); } catch (e) {}
    }, 30000);

    window.addEventListener('insopesca:record-changed', function (ev) {
      if (ev && ev.detail) broadcastChange(ev.detail);
    });

    S.enabled = true;
    S.connected = true;
    S.startedAt = Date.now();
    updatePeersUI();
    console.log('[Sync] iniciado · sala:', S.roomName);
    return true;
  }

  function stop() {
    if (S.healthTimer) { clearInterval(S.healthTimer); S.healthTimer = null; }
    if (S.room) { try { S.room.leave(); } catch (e) {} }
    S.room = null;
    S.enabled = false;
    S.connected = false;
    S.peers.clear();
    updatePeersUI();
  }

  function getOnlinePeers() {
    const byId = new Map();
    S.peers.forEach(function (p) { if (p.id) byId.set(p.id, p); });
    return Array.from(byId.values());
  }
  function getOnlineCount() { return getOnlinePeers().length; }
  function isConnected()    { return S.connected; }
  function getRoomName()    { return S.roomName; }

  return { start, stop, getOnlinePeers, getOnlineCount, isConnected, getRoomName, broadcastChange };
})();
