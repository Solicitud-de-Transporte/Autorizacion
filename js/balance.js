/* ============================================================
   Centro de Balance - Insopesca El Morro
   - Cambio de estado (aprobada / rechazada)
   - Observaciones por solicitud
   - Envío de solicitudes operador → balance
   - Notificaciones locales al operador dueño
   - Marcar como visto
   ============================================================ */

window.Balance = (function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    mounted: false,
    filter: 'todos',       // todos | pendiente | aprobada | rechazada
    pendingChangeId: null,
    pendingChangeStatus: null
  };

  /* ---------- helpers ---------- */
  function toast(msg) {
    if (typeof window.toast === 'function') window.toast(msg);
    else console.log('[balance]', msg);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtDateTime(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString('es-VE'); }
    catch (e) { return String(ts); }
  }

  /* ---------- permisos ---------- */
  function canManage() {
    const u = Identity.getCurrentUser();
    if (!u) return false;
    return u.role === CONFIG.ROLES.BALANCE || u.role === CONFIG.ROLES.ADMIN;
  }
  function isBalanceOrAdmin() { return canManage(); }

  /* ---------- notificaciones locales ---------- */
  async function ensureNotificationPermission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    try { return await Notification.requestPermission(); }
    catch (e) { return 'denied'; }
  }

  async function notifyStatusChange(record) {
    if (!CONFIG.NOTIFICATIONS_ENABLED) return;
    const user = Identity.getCurrentUser();
    if (!user) return;
    if (!record || !record.created_by || record.created_by.id !== user.id) return;

    const statusLabel = {
      aprobada:  'APROBADA ✅',
      rechazada: 'RECHAZADA ❌',
      pendiente: 'PENDIENTE ⏳'
    }[record.status] || record.status;

    const title = 'Insopesca · Solicitud ' + (record.placa || '');
    const body = 'Estado: ' + statusLabel +
      (record.observations ? '\n' + record.observations : '');

    /* Guardar en IndexedDB para mostrar en el centro de notificaciones */
    await DB.addStatusNotification({
      target_user_id: user.id,
      record_id: record.id,
      plate: record.placa || '',
      status: record.status,
      message: body
    });

    /* Toast si la app está en foreground */
    if (document.visibilityState === 'visible') {
      toast('🔔 ' + title + ' — ' + statusLabel);
    }

    /* Notification API si está permitida y la app está en background */
    if ('Notification' in window && Notification.permission === 'granted') {
      if (document.visibilityState !== 'visible') {
        try {
          new Notification(title, {
            body: body,
            icon: CONFIG.NOTIF_ICON,
            tag: 'insopesca-status-' + record.id,
            renotify: true
          });
        } catch (e) { /* algunos navegadores requieren SW */ }
      }
    }

    /* Refrescar campanita en el header */
    if (typeof window.refreshNotificationBadge === 'function') {
      window.refreshNotificationBadge();
    }
  }

  /* ---------- cambio de estado ---------- */
  async function changeStatus(recordId, newStatus, observation) {
    if (!canManage()) { toast('⛔ Sin permiso para cambiar estado'); return false; }
    const user = Identity.getCurrentUser();
    if (!user) return false;

    const existing = await DB.getRecord(recordId);
    if (!existing) { toast('⚠️ Registro no encontrado'); return false; }

    const deviceId = await DB.getDeviceId();
    const updated = Object.assign({}, existing, {
      status: newStatus,
      observations: (observation != null ? observation : existing.observations || ''),
      status_changed_at: Date.now(),
      status_changed_by: { id: user.id, name: user.name },
      updated_at: Date.now(),
      updated_by: { id: user.id, name: user.name },
      device_id: deviceId
    });

    await DB.putRecord(updated);
    await DB.addAudit({
      action: 'status_change',
      actor: { id: user.id, name: user.name },
      target: { id: updated.id, label: updated.placa },
      meta: { from: existing.status || 'pendiente', to: newStatus }
    });

    /* Actualizar cache local */
    const idx = (window.state && window.state.records) ?
      window.state.records.findIndex(r => r.id === recordId) : -1;
    if (idx >= 0) window.state.records[idx] = updated;

    /* Avisar a la UI */
    if (typeof window.updateBadges === 'function') window.updateBadges();
    if (typeof window.renderHistory === 'function') window.renderHistory();
    if (window.Admin && Admin.refreshDashboard) Admin.refreshDashboard();

    /* Disparar sync */
    window.dispatchEvent(new CustomEvent('insopesca:record-changed', { detail: updated }));

    /* Notificar al operador dueño si es este dispositivo */
    await notifyStatusChange(updated);

    toast('✅ Estado actualizado a ' + newStatus);
    return true;
  }

  /* ---------- envío al balance (operador) ---------- */
  async function sendToBalance(recordId) {
    const user = Identity.getCurrentUser();
    if (!user) return false;
    const existing = await DB.getRecord(recordId);
    if (!existing) return false;
    if (existing.sent_to_balance) { toast('📤 Ya está enviada al Balance'); return false; }
    if (existing.status === CONFIG.STATUS.APROBADA || existing.status === CONFIG.STATUS.RECHAZADA) {
      toast('⚠️ Esta solicitud ya fue procesada por Balance');
      return false;
    }
    const deviceId = await DB.getDeviceId();
    const updated = Object.assign({}, existing, {
      sent_to_balance: true,
      sent_to_balance_at: Date.now(),
      updated_at: Date.now(),
      updated_by: { id: user.id, name: user.name },
      device_id: deviceId
    });
    await DB.putRecord(updated);
    await DB.addAudit({
      action: 'send_to_balance',
      actor: { id: user.id, name: user.name },
      target: { id: updated.id, label: updated.placa }
    });
    const idx = (window.state && window.state.records) ?
      window.state.records.findIndex(r => r.id === recordId) : -1;
    if (idx >= 0) window.state.records[idx] = updated;
    if (typeof window.renderHistory === 'function') window.renderHistory();
    window.dispatchEvent(new CustomEvent('insopesca:record-changed', { detail: updated }));
    toast('📤 Enviada al Centro de Balance');
    return true;
  }

  /* ---------- visto / no visto ---------- */
  async function hasUnseenStatus(record) {
    const user = Identity.getCurrentUser();
    if (!user) return false;
    if (!record || !record.status_changed_at) return false;
    if (!record.created_by || record.created_by.id !== user.id) return false;
    const map = await DB.getStatusSeenMap(user.id);
    const seen = map[record.id] || 0;
    return record.status_changed_at > seen;
  }
  async function markStatusSeen(recordId) {
    const user = Identity.getCurrentUser();
    if (!user) return;
    const record = await DB.getRecord(recordId);
    if (!record || !record.status_changed_at) return;
    await DB.setStatusSeen(user.id, recordId, record.status_changed_at);
  }

  /* ---------- vista ---------- */
  function statusBadgeHtml(status) {
    const map = {
      pendiente: { label: '⏳ Pendiente', cls: 'status-pending' },
      aprobada:  { label: '✅ Aprobada',  cls: 'status-approved' },
      rechazada: { label: '❌ Rechazada', cls: 'status-rejected' }
    };
    const v = map[status] || map.pendiente;
    return '<span class="status-badge ' + v.cls + '">' + v.label + '</span>';
  }

  function filterRecords(records) {
    if (state.filter === 'todos') return records;
    return records.filter(r => (r.status || 'pendiente') === state.filter);
  }

  async function renderList() {
    const all = (window.state && window.state.records) || [];
    const filtered = filterRecords(all);
    const list = $('balanceList');
    const count = $('balanceCount');
    if (count) count.textContent = filtered.length + ' solicitud' + (filtered.length !== 1 ? 'es' : '');
    if (!list) return;

    if (!filtered.length) {
      list.innerHTML = '<div class="empty-state"><div class="big">⚖️</div>' +
        '<div style="font-weight:700">Sin solicitudes</div>' +
        '<div style="font-size:.78rem;margin-top:4px">No hay solicitudes para este filtro</div></div>';
      return;
    }

    const items = await Promise.all(filtered.map(async (r) => {
      const unseen = await hasUnseenStatus(r);
      const sentBadge = r.sent_to_balance ? '<span class="status-badge status-sent">📤 Enviada</span>' : '';
      const newBadge  = unseen ? '<span class="status-badge status-new">🔔 NUEVA</span>' : '';
      const obsHtml = r.observations
        ? '<div class="balance-obs"><strong>📝 Balance:</strong> ' + esc(r.observations) + '</div>'
        : '';
      return '<div class="history-item balance-item">' +
        '<div class="history-header">' +
          '<div>' +
            '<div class="history-plate">🚗 ' + esc(r.placa) + '</div>' +
            '<div style="font-size:.75rem;color:var(--text-light);margin-top:2px">' + esc(r.chofer) + '</div>' +
          '</div>' +
          '<div class="balance-badges">' + statusBadgeHtml(r.status) + sentBadge + newBadge + '</div>' +
        '</div>' +
        '<div class="history-meta">📍 <strong>' + esc(r.destino) + '</strong><br>' +
          '🐟 ' + esc((r.especie || 'Sardina') + (r.presentacion ? ' ' + r.presentacion : '')) +
          ' · ' + esc(r.cajas) + ' cajas · Origen: ' + esc(r.origen) + '</div>' +
        '<div class="record-author">👤 <strong>' +
          esc((r.created_by && r.created_by.name) || 'Sin identificar') + '</strong>' +
          (r.status_changed_by ? ' · revisada por ' + esc(r.status_changed_by.name) : '') +
          (r.status_changed_at ? ' · ' + fmtDateTime(r.status_changed_at) : '') + '</div>' +
        obsHtml +
        '<div class="history-actions">' +
          '<button class="hbtn hbtn-view" onclick="Balance.viewDetail(' + r.id + ')">👁️ Ver</button>' +
          '<button class="hbtn hbtn-approve" onclick="Balance.openChange(' + r.id + ',\'aprobada\')">✅ Aprobar</button>' +
          '<button class="hbtn hbtn-reject" onclick="Balance.openChange(' + r.id + ',\'rechazada\')">❌ Rechazar</button>' +
        '</div></div>';
    }));
    list.innerHTML = items.join('');
  }

  /* ---------- modal de cambio ---------- */
  async function openChange(recordId, newStatus) {
    if (!canManage()) { toast('⛔ Sin permiso'); return; }
    const record = await DB.getRecord(recordId);
    if (!record) return;
    state.pendingChangeId = recordId;
    state.pendingChangeStatus = newStatus;

    const title = $('balanceChangeTitle');
    if (title) title.textContent = (newStatus === 'aprobada' ? '✅ Aprobar solicitud' : '❌ Rechazar solicitud');

    const info = $('balanceChangeInfo');
    if (info) {
      info.innerHTML = '<strong>' + esc(record.placa) + '</strong> · ' + esc(record.destino) +
        '<br><span style="font-size:.78rem;color:var(--text-light)">Por: ' +
        esc((record.created_by && record.created_by.name) || '—') + '</span>';
    }

    const obs = $('balanceChangeObs');
    if (obs) obs.value = record.observations || '';

    const overlay = $('balanceChangeModal');
    if (overlay) overlay.classList.add('show');
  }

  function closeChange() {
    const overlay = $('balanceChangeModal');
    if (overlay) overlay.classList.remove('show');
    state.pendingChangeId = null;
    state.pendingChangeStatus = null;
  }

  async function confirmChange() {
    if (!state.pendingChangeId) return;
    const obs = $('balanceChangeObs');
    const observation = obs ? obs.value.trim() : '';
    const ok = await changeStatus(state.pendingChangeId, state.pendingChangeStatus, observation);
    if (ok) {
      closeChange();
      await renderList();
    }
  }

  /* ---------- detalle rápido (reusa el modal global) ---------- */
  function viewDetail(id) {
    if (typeof window.viewRecord === 'function') window.viewRecord(id);
  }

  /* ---------- filtros ---------- */
  function setFilter(f) {
    state.filter = f;
    document.querySelectorAll('.balance-filter-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.f === f);
    });
    renderList();
  }

  /* ---------- mount ---------- */
  async function mount(containerId) {
    const container = $(containerId);
    if (!container) return;
    if (!canManage()) {
      container.innerHTML = '<div class="admin-section"><p>⛔ Esta sección es solo para el Centro de Balance o el Administrador.</p></div>';
      return;
    }
    if (!state.mounted) {
      container.innerHTML = buildPanelHTML();
      bindEvents();
      state.mounted = true;
    }
    await ensureNotificationPermission();
    await renderList();
  }

  function buildPanelHTML() {
    return '' +
'<div class="admin-panel">' +
  '<h2 class="admin-title">⚖️ Centro de Balance</h2>' +
  '<p class="admin-sub">Revisa, aprueba o rechaza las solicitudes enviadas desde los puertos.</p>' +
  '<section class="admin-section">' +
    '<div class="balance-filter-tabs">' +
      '<button class="balance-filter-tab active" data-f="todos" onclick="Balance.setFilter(\'todos\')">Todas</button>' +
      '<button class="balance-filter-tab" data-f="pendiente" onclick="Balance.setFilter(\'pendiente\')">⏳ Pendientes</button>' +
      '<button class="balance-filter-tab" data-f="aprobada" onclick="Balance.setFilter(\'aprobada\')">✅ Aprobadas</button>' +
      '<button class="balance-filter-tab" data-f="rechazada" onclick="Balance.setFilter(\'rechazada\')">❌ Rechazadas</button>' +
    '</div>' +
    '<div id="balanceCount" class="results-count"></div>' +
    '<div id="balanceList"></div>' +
  '</section>' +
'</div>';
  }

  function bindEvents() {
    const confirmBtn = $('balanceChangeConfirm');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmChange);
    const cancelBtn = $('balanceChangeCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeChange);
  }

  /* ---------- API pública ---------- */
  return {
    mount: mount,
    renderList: renderList,
    setFilter: setFilter,
    openChange: openChange,
    closeChange: closeChange,
    confirmChange: confirmChange,
    viewDetail: viewDetail,
    changeStatus: changeStatus,
    sendToBalance: sendToBalance,
    notifyStatusChange: notifyStatusChange,
    hasUnseenStatus: hasUnseenStatus,
    markStatusSeen: markStatusSeen,
    isBalanceOrAdmin: isBalanceOrAdmin,
    ensureNotificationPermission: ensureNotificationPermission
  };
})();
