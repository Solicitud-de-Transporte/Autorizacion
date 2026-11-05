/* ============================================================
   Módulo de Salas / Puertos - Insopesca El Morro
   - getAvailable() : lista de salas (users.json + locales no publicadas)
   - getCurrent()   : sala actual del usuario
   - switchTo()     : cambia de sala y reinicia sync
   - renderSwitcher(): pinta botones
   - registerLocalRoom() / clearLocalRooms(): para salas aún no publicadas
   ============================================================ */

window.Rooms = (function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function toast(msg) {
    if (typeof window.toast === 'function') window.toast(msg);
    else console.log('[rooms]', msg);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function getLocalRooms() {
    try {
      const v = await DB.getMeta('local_rooms');
      return Array.isArray(v) ? v.slice() : [];
    } catch (e) { return []; }
  }

  async function registerLocalRoom(name) {
    name = String(name || '').trim();
    if (!name) return;
    const list = await getLocalRooms();
    if (!list.includes(name)) {
      list.push(name);
      await DB.setMeta('local_rooms', list);
    }
  }

  async function clearLocalRooms() {
    try { await DB.setMeta('local_rooms', []); } catch (e) {}
  }

  async function getAvailable() {
    const file = await Identity.loadUsersFile(false);
    const set = new Set();

    if (file && Array.isArray(file.rooms)) {
      file.rooms.forEach(r => { if (r) set.add(String(r)); });
    }
    if (!set.size) {
      CONFIG.DEFAULT_PORTS.forEach(r => set.add(r));
    }

    const local = await getLocalRooms();
    local.forEach(r => set.add(r));

    return Array.from(set);
  }

  function getCurrent() {
    const u = Identity.getCurrentUser();
    return u ? (u.port || null) : null;
  }

  function canChangeRoom() {
    const u = Identity.getCurrentUser();
    if (!u) return false;
    return u.role === CONFIG.ROLES.ADMIN || u.role === CONFIG.ROLES.BALANCE;
  }

  async function switchTo(portName) {
    if (!portName) return false;
    const current = Identity.getCurrentUser();
    if (!current) return false;
    if (current.port === portName) return true;
    if (!canChangeRoom()) {
      toast('🔒 Tu sala está bloqueada por el administrador');
      return false;
    }
    if (!confirm('¿Cambiar a la sala "' + portName + '"?\n\nVerás solo los registros de esa sala y la sincronización se reiniciará.')) {
      return false;
    }

    await Identity.updateProfile({ port: portName });
    await DB.setSyncRoom(CONFIG.portToRoom(portName));

    if (window.Sync && Sync.isConnected()) {
      try { Sync.stop(); } catch (e) {}
      try { await Sync.start(); } catch (e) { console.warn('[rooms] sync restart', e); }
    }

    await DB.addAudit({
      action: 'change_sync_room',
      actor: { id: current.id, name: current.name },
      meta: { newRoom: portName, previousRoom: current.port }
    });

    if (typeof window.reloadRecordsFromDB === 'function') await window.reloadRecordsFromDB();
    if (typeof window.renderHistory === 'function') await window.renderHistory();
    if (window.Admin && Admin.refreshDashboard) Admin.refreshDashboard();
    if (window.Balance && Balance.renderList) Balance.renderList();

    toast('✅ Sala cambiada a ' + portName);
    return true;
  }

  async function renderSwitcher(containerId, options) {
    options = options || {};
    const el = $(containerId);
    if (!el) return;

    const current = Identity.getCurrentUser();
    if (!current) { el.innerHTML = ''; return; }

    if (!canChangeRoom()) {
      el.innerHTML =
        '<div class="room-locked">🔒 Tu sala asignada: <strong>' +
        esc(current.port || '—') + '</strong></div>';
      return;
    }

    const rooms = await getAvailable();

    let html = '<div class="room-buttons">';
    html += rooms.map(r =>
      '<button type="button" class="room-btn' + (r === current.port ? ' active' : '') +
      '" data-room="' + esc(r) + '">' + esc(r) + '</button>'
    ).join('');
    if (options.allowCreate) {
      html += '<button type="button" class="room-btn room-btn-add" id="roomAddBtn">➕ Nueva sala</button>';
    }
    html += '</div>';
    el.innerHTML = html;

    el.querySelectorAll('[data-room]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const r = btn.getAttribute('data-room');
        if (r === current.port) return;
        const ok = await switchTo(r);
        if (ok) await renderSwitcher(containerId, options);
      });
    });

    const addBtn = el.querySelector('#roomAddBtn');
    if (addBtn && typeof options.onCreate === 'function') {
      addBtn.addEventListener('click', () => options.onCreate());
    }
  }

  return {
    getAvailable,
    getCurrent,
    switchTo,
    renderSwitcher,
    registerLocalRoom,
    clearLocalRooms,
    canChangeRoom
  };
})();