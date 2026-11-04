/* ============================================================
   Panel de administración - Insopesca El Morro
   v1.9.0:
   - Suspender / reactivar usuarios
   - Indicador de almacenamiento en vivo
   ============================================================ */

window.Admin = (function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    users: [],
    adminWhatsApp: '',
    adminId: '',
    libsLoaded: { jsPDF: false, xlsx: false },
    mounted: false,
    cachedAudit: [],
    cachedBackups: [],
    pendingUserChanges: new Set()
  };

  function toast(msg) {
    if (typeof window.toast === 'function') window.toast(msg);
    else console.log('[toast]', msg);
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
  function relativeTime(ts) {
    if (!ts) return 'nunca';
    const diff = Date.now() - ts;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'hace segundos';
    const min = Math.floor(sec / 60);
    if (min < 60) return 'hace ' + min + ' min';
    const hr = Math.floor(min / 60);
    if (hr < 24) return 'hace ' + hr + ' h';
    const day = Math.floor(hr / 24);
    if (day < 7) return 'hace ' + day + ' día' + (day > 1 ? 's' : '');
    return fmtDateTime(ts);
  }
  function timestampSuffix() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
           '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }
  function parseFechaToISO(fecha) {
    const m = String(fecha || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return m[3] + '-' + m[2] + '-' + m[1];
    if (CONFIG.ISO_DATE_RE.test(fecha)) return fecha;
    return '';
  }

  /* ---------- librerías on-demand ---------- */
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="' + url + '"]');
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Fallo ' + url)));
        return;
      }
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = () => { s.dataset.loaded = '1'; resolve(); };
      s.onerror = () => reject(new Error('Fallo al cargar ' + url));
      document.head.appendChild(s);
    });
  }
  async function ensureJsPDF() {
    if (state.libsLoaded.jsPDF) return;
    for (const url of CONFIG.EXPORT.PDF_LIBS) await loadScript(url);
    state.libsLoaded.jsPDF = true;
  }
  async function ensureXLSX() {
    if (state.libsLoaded.xlsx) return;
    await loadScript(CONFIG.EXPORT.XLSX_LIB);
    state.libsLoaded.xlsx = true;
  }

  /* ---------- export historial ---------- */
  function recordToRow(r) {
    return {
      'Fecha': r.fecha || '',
      'Placa': r.placa || '',
      'Cajas': r.cajas || '',
      'Especie': r.especie || '',
      'Presentación': r.presentacion || r.sardina || '',
      'Marca': r.marca || '',
      'CGT': r.cgt || '',
      'Vence CGT': r.venceCgt || '',
      'Propietario': r.propietario || '',
      'C.I. Propietario': r.ciPropietario || '',
      'Chofer': r.chofer || '',
      'C.I. Chofer': r.ciChofer || '',
      'Destino': r.destino || '',
      'Estado': r.estado || '',
      'Municipio': r.municipio || '',
      'Parroquia': r.parroquia || '',
      'Recibe': r.recibe || '',
      'Teléfono': r.telefono || '',
      'Origen': r.origen || '',
      'Productor': r.productor || '',
      'Observación': r.observacion || '',
      'Estado solicitud': r.status || '',
      'Observaciones balance': r.observations || '',
      'Enviada al balance': r.sent_to_balance ? 'Sí' : 'No',
      'Creado por': (r.created_by && r.created_by.name) || '',
      'Editado por': (r.updated_by && r.updated_by.name) || '',
      'Guardado': fmtDateTime(r.updated_at || (r.savedAt ? new Date(r.savedAt).getTime() : 0))
    };
  }

  async function exportRecordsPDF(records, extraLabel) {
    if (!records || !records.length) { toast('⚠️ No hay registros para exportar'); return; }
    await ensureJsPDF();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text(CONFIG.APP_NAME + ' — Solicitudes', 40, 40);
    doc.setFontSize(10);
    doc.text('Generado: ' + new Date().toLocaleString('es-VE'), 40, 58);
    if (extraLabel) doc.text('Filtro: ' + extraLabel, 40, 72);
    doc.text('Total: ' + records.length, 40, 86);
    const rows = records.map(recordToRow);
    const headers = Object.keys(rows[0]);
    doc.autoTable({
      head: [headers],
      body: rows.map(r => headers.map(h => String(r[h] == null ? '' : r[h]))),
      startY: 100,
      styles: { fontSize: 6, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [13, 59, 102], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 244, 248] },
      margin: { left: 20, right: 20 }
    });
    doc.save(CONFIG.EXPORT.PDF_FILENAME_PREFIX + timestampSuffix() + '.pdf');
    toast('📄 PDF descargado');
  }

  async function exportRecordsExcel(records, extraLabel) {
    if (!records || !records.length) { toast('⚠️ No hay registros para exportar'); return; }
    await ensureXLSX();
    const XLSX = window.XLSX;
    const rows = records.map(recordToRow);
    const ws = XLSX.utils.json_to_sheet(rows);
    const headers = Object.keys(rows[0]);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(12, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Solicitudes');
    if (extraLabel) {
      const meta = XLSX.utils.aoa_to_sheet([
        ['Generado', new Date().toLocaleString('es-VE')],
        ['Filtro', extraLabel],
        ['Total', records.length]
      ]);
      XLSX.utils.book_append_sheet(wb, meta, 'Info');
    }
    XLSX.writeFile(wb, CONFIG.EXPORT.EXCEL_FILENAME_PREFIX + timestampSuffix() + '.xlsx');
    toast('📊 Excel descargado');
  }

  /* ---------- auditoría ---------- */
  const AUDIT_LABEL = {
    'create': 'Creó solicitud',
    'update': 'Editó solicitud',
    'delete_local': 'Ocultó (local)',
    'delete_global': 'Borró (global)',
    'login': 'Inició sesión',
    'register_request': 'Solicitud de registro',
    'admin_add_user': 'Agregó usuario',
    'admin_remove_user': 'Quitó usuario',
    'admin_suspend_user': 'Suspendió usuario',
    'admin_reactivate_user': 'Reactivó usuario',
    'change_sync_room': 'Cambió sala/puerto',
    'status_change': 'Cambió estado',
    'send_to_balance': 'Envió al Balance',
    'backup_create': 'Creó respaldo',
    'backup_export': 'Exportó respaldo',
    'backup_import': 'Importó respaldo',
    'profile_update': 'Actualizó perfil'
  };

  function auditToRow(e) {
    return {
      'Fecha/hora': fmtDateTime(e.ts),
      'Acción': AUDIT_LABEL[e.action] || e.action || '',
      'Actor': (e.actor && e.actor.name) || '',
      'ID actor': (e.actor && e.actor.id) || '',
      'Objetivo': (e.target && (e.target.label || e.target.id)) || '',
      'Dispositivo': e.device_id || '',
      'Detalle': e.meta ? JSON.stringify(e.meta) : ''
    };
  }

  async function exportAuditPDF(entries) {
    if (!entries || !entries.length) { toast('⚠️ No hay eventos'); return; }
    await ensureJsPDF();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text(CONFIG.APP_NAME + ' — Auditoría', 40, 40);
    doc.setFontSize(10);
    doc.text('Generado: ' + new Date().toLocaleString('es-VE'), 40, 58);
    doc.text('Total: ' + entries.length, 40, 72);
    const rows = entries.map(auditToRow);
    const headers = Object.keys(rows[0]);
    doc.autoTable({
      head: [headers],
      body: rows.map(r => headers.map(h => String(r[h] == null ? '' : r[h]))),
      startY: 90,
      styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [27, 154, 170], textColor: 255, fontStyle: 'bold' },
      margin: { left: 20, right: 20 }
    });
    doc.save(CONFIG.EXPORT.PDF_FILENAME_PREFIX + 'auditoria_' + timestampSuffix() + '.pdf');
    toast('📄 Auditoría PDF descargada');
  }

  async function exportAuditExcel(entries) {
    if (!entries || !entries.length) { toast('⚠️ No hay eventos'); return; }
    await ensureXLSX();
    const XLSX = window.XLSX;
    const rows = entries.map(auditToRow);
    const ws = XLSX.utils.json_to_sheet(rows);
    const headers = Object.keys(rows[0]);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(14, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Auditoría');
    XLSX.writeFile(wb, CONFIG.EXPORT.EXCEL_FILENAME_PREFIX + 'auditoria_' + timestampSuffix() + '.xlsx');
    toast('📊 Auditoría Excel descargada');
  }

  /* ---------- dashboard ---------- */
  function computeStats(records) {
    const byStatus = { pendiente: 0, aprobada: 0, rechazada: 0 };
    const byUser = {}, byDay = {};
    let totalApproveTime = 0, countApproveTime = 0;
    records.forEach(r => {
      const st = r.status || CONFIG.STATUS.PENDIENTE;
      byStatus[st] = (byStatus[st] || 0) + 1;
      const uname = (r.created_by && r.created_by.name) || 'Sin identificar';
      byUser[uname] = (byUser[uname] || 0) + 1;
      const day = r.fecha ? parseFechaToISO(r.fecha) : (r.savedAt ? r.savedAt.slice(0, 10) : '');
      if (day) byDay[day] = (byDay[day] || 0) + 1;
      if (r.status_changed_at && r.updated_at && r.status !== 'pendiente') {
        const t = r.status_changed_at - (r.savedAt ? new Date(r.savedAt).getTime() : r.updated_at);
        if (t > 0) { totalApproveTime += t; countApproveTime++; }
      }
    });
    const avgMs = countApproveTime ? Math.round(totalApproveTime / countApproveTime) : 0;
    const avgH = Math.round(avgMs / 3600000 * 10) / 10;
    return { total: records.length, byStatus, byUser, byDay, avgHours: avgH };
  }

  async function renderStorageInfo() {
    const el = $('adminStorageInfo');
    if (!el) return;
    if (!navigator.storage || !navigator.storage.estimate) {
      el.innerHTML = '💾 <strong>Almacenamiento:</strong> estimación no disponible en este navegador.';
      return;
    }
    try {
      const est = await navigator.storage.estimate();
      const usedMB = (est.usage / 1024 / 1024).toFixed(2);
      const quotaMB = (est.quota / 1024 / 1024).toFixed(0);
      const pct = est.quota ? ((est.usage / est.quota) * 100).toFixed(2) : '0';
      el.innerHTML = '💾 <strong>Almacenamiento:</strong> ' +
        usedMB + ' MB usados de ' + quotaMB + ' MB disponibles (' + pct + '%)';
    } catch (e) {
      el.innerHTML = '💾 <strong>Almacenamiento:</strong> no se pudo estimar.';
    }
  }

  function renderDashboard(records) {
    const stats = computeStats(records);
    const el = $('adminDashboard');
    if (!el) return;
    const labels = { pendiente: '⏳ Pendientes', aprobada: '✅ Aprobadas', rechazada: '❌ Rechazadas' };
    const statusCards = Object.keys(labels).map(k =>
      '<div class="stat-card"><div class="stat-label">' + labels[k] + '</div>' +
      '<div class="stat-value">' + (stats.byStatus[k] || 0) + '</div></div>'
    ).join('');
    const daysSorted = Object.keys(stats.byDay).sort().slice(-14);
    const maxDay = Math.max.apply(null, daysSorted.map(d => stats.byDay[d]).concat([1]));
    const bars = daysSorted.map(d =>
      '<div class="bar-row"><div class="bar-label">' + d + '</div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + Math.round(stats.byDay[d] / maxDay * 100) + '%"></div></div>' +
      '<div class="bar-count">' + stats.byDay[d] + '</div></div>'
    ).join('');
    const userRows = Object.keys(stats.byUser)
      .sort((a, b) => stats.byUser[b] - stats.byUser[a])
      .map(u => '<div class="stat-user-row"><span>' + esc(u) + '</span><strong>' + stats.byUser[u] + '</strong></div>')
      .join('');
    el.innerHTML =
      '<div class="stat-total"><div class="stat-label">📋 Total</div>' +
        '<div class="stat-value" style="font-size:2rem">' + stats.total + '</div></div>' +
      '<div class="stat-grid">' + statusCards + '</div>' +
      '<div class="stat-time"><div class="stat-label">⏱️ Tiempo promedio hasta decisión</div>' +
        '<div class="stat-value">' + (stats.avgHours || 0) + ' h</div></div>' +
      '<h4 class="admin-h4">📅 Últimos 14 días</h4>' +
      '<div class="bars-wrap">' + (bars || '<div class="empty-mini">Sin registros</div>') + '</div>' +
      '<h4 class="admin-h4">👥 Por usuario</h4>' +
      '<div class="stat-users">' + (userRows || '<div class="empty-mini">Sin registros</div>') + '</div>';

    const pendientes = records
      .filter(r => (r.status || 'pendiente') === 'pendiente')
      .sort((a, b) => ((a.savedAt || 0) < (b.savedAt || 0)) ? -1 : 1)
      .slice(0, 15);
    const quickEl = $('adminPendingList');
    if (quickEl) {
      if (!pendientes.length) quickEl.innerHTML = '<div class="empty-mini">Sin solicitudes pendientes 🎉</div>';
      else quickEl.innerHTML = pendientes.map(r =>
        '<div class="pending-row">' +
          '<div class="pending-info">' +
            '<div class="user-name">🚗 ' + esc(r.placa) + ' · ' + esc(r.destino) + '</div>' +
            '<div class="user-id">' +
              esc((r.created_by && r.created_by.name) || '—') +
              ' · ' + esc(r.cajas) + ' cajas · ' + esc(r.fecha || '') +
              (r.sent_to_balance ? ' · 📤 Enviada' : '') +
            '</div>' +
          '</div>' +
          '<div class="pending-actions">' +
            '<button class="hbtn hbtn-approve" onclick="Balance.openChange(' + r.id + ',\'aprobada\')">✅</button>' +
            '<button class="hbtn hbtn-reject" onclick="Balance.openChange(' + r.id + ',\'rechazada\')">❌</button>' +
          '</div>' +
        '</div>'
      ).join('');
    }
  }

  /* ---------- en línea ---------- */
  async function renderOnlineUsers() {
    const el = $('adminOnline');
    if (!el) return;
    if (!CONFIG.SYNC_ENABLED) {
      el.innerHTML = '<div class="empty-mini">🟢 En línea: 0 · (sync desactivado)</div>';
      return;
    }

    const lastSeenMap = await DB.getAllLastSeen();
    const onlinePeers = (window.Sync && Sync.getOnlinePeers) ? Sync.getOnlinePeers() : [];
    const onlineById = new Map();
    onlinePeers.forEach(p => { if (p.id) onlineById.set(p.id, p); });

    const combined = new Map();
    state.users.forEach(u => {
      combined.set(u.id, {
        id: u.id,
        name: u.name,
        role: u.role || 'operador',
        online: onlineById.has(u.id),
        lastSeen: lastSeenMap[u.id] || null,
        authorized: true,
        suspended: u.suspended === true
      });
    });
    Object.keys(lastSeenMap).forEach(id => {
      if (!combined.has(id)) {
        const ls = lastSeenMap[id];
        combined.set(id, {
          id,
          name: (ls && ls.name) || id,
          role: (ls && ls.role) || 'operador',
          online: onlineById.has(id),
          lastSeen: ls,
          authorized: false,
          suspended: false
        });
      }
    });

    const list = Array.from(combined.values());
    const onlineList = list.filter(u => u.online);
    const recentlyList = list.filter(u => !u.online && u.lastSeen).sort((a, b) => (b.lastSeen.ts || 0) - (a.lastSeen.ts || 0));
    const neverList = list.filter(u => !u.online && !u.lastSeen);

    let html = '<div class="online-label">🟢 En línea ahora (' + onlineList.length + ')</div>';
    if (!onlineList.length) html += '<div class="empty-mini">Nadie conectado ahora</div>';
    else html += onlineList.map(u =>
      '<div class="online-user">👤 ' + esc(u.name) +
        ' · <span style="opacity:.65">' + esc(u.role) + '</span>' +
        (u.suspended ? ' · <em>suspendido</em>' : '') + '</div>'
    ).join('');

    html += '<div class="online-label" style="color:var(--text-light);margin-top:14px">🕒 Vistos recientemente</div>';
    if (!recentlyList.length) html += '<div class="empty-mini">Nadie visto recientemente</div>';
    else html += recentlyList.map(u =>
      '<div class="online-user offline">👤 ' + esc(u.name) +
        ' · <span style="opacity:.65">' + esc(u.role) + '</span>' +
        ' · <span class="seen-time">' + relativeTime(u.lastSeen.ts) + '</span>' +
        (u.lastSeen.ts ? ' <span class="seen-abs">(' + fmtDateTime(u.lastSeen.ts) + ')</span>' : '') +
      '</div>'
    ).join('');

    if (neverList.length) {
      html += '<div class="online-label" style="color:var(--text-light);margin-top:14px">⚪ Nunca vistos en este dispositivo</div>';
      html += neverList.map(u =>
        '<div class="online-user offline">👤 ' + esc(u.name) +
          ' · <span style="opacity:.65">' + esc(u.role) + '</span>' +
          (u.authorized ? '' : ' · <em>no autorizado</em>') +
          (u.suspended ? ' · <em>suspendido</em>' : '') + '</div>'
      ).join('');
    }

    html += '<div class="hint" style="margin-top:12px">La "última conexión" se mide solo desde este dispositivo.</div>';
    el.innerHTML = html;
  }

  /* ---------- gestión de usuarios ---------- */
  function renderUsersList() {
    const el = $('adminUsersList');
    if (!el) return;
    if (!state.users.length) {
      el.innerHTML = '<div class="empty-mini">No hay usuarios autorizados</div>';
      renderPendingBanner();
      return;
    }
    el.innerHTML = state.users.map(u => {
      const isMe = u.id === state.adminId;
      const isSuspended = u.suspended === true;
      const pending = state.pendingUserChanges.has(u.id);
      let actions = '';
      if (isMe) {
        actions = '<span class="tag-admin">Tú (admin)</span>';
      } else if (isSuspended) {
        actions =
          '<button class="hbtn hbtn-reactivate" data-reactivate-user="' + esc(u.id) + '" title="Reactivar">▶️</button>' +
          '<button class="hbtn hbtn-del" data-remove-user="' + esc(u.id) + '" title="Eliminar">🗑️</button>';
      } else {
        actions =
          '<button class="hbtn hbtn-suspend" data-suspend-user="' + esc(u.id) + '" title="Suspender">⏸️</button>' +
          '<button class="hbtn hbtn-del" data-remove-user="' + esc(u.id) + '" title="Eliminar">🗑️</button>';
      }
      return '<div class="user-row' +
        (isSuspended ? ' user-row-suspended' : '') +
        (pending ? ' user-row-pending' : '') + '">' +
        '<div class="user-info">' +
          '<div class="user-name">' + esc(u.name) +
            (isSuspended ? ' <span class="tag-suspended">⏸️ Suspendido</span>' : '') +
          '</div>' +
          '<div class="user-id">' + esc(u.id) + ' · ' + esc(u.role || 'operador') + '</div>' +
        '</div>' +
        '<div class="user-actions">' + actions + '</div>' +
      '</div>';
    }).join('');

    el.querySelectorAll('[data-remove-user]').forEach(btn => {
      btn.addEventListener('click', () => removeUser(btn.getAttribute('data-remove-user')));
    });
    el.querySelectorAll('[data-suspend-user]').forEach(btn => {
      btn.addEventListener('click', () => suspendUser(btn.getAttribute('data-suspend-user')));
    });
    el.querySelectorAll('[data-reactivate-user]').forEach(btn => {
      btn.addEventListener('click', () => reactivateUser(btn.getAttribute('data-reactivate-user')));
    });
    renderPendingBanner();
  }

  function renderPendingBanner() {
    const banner = $('adminPendingBanner');
    if (!banner) return;
    const n = state.pendingUserChanges.size;
    if (n === 0) { banner.style.display = 'none'; banner.innerHTML = ''; return; }
    banner.style.display = 'flex';
    banner.innerHTML = '⚠️ Tienes <strong>' + n + ' cambio' + (n > 1 ? 's' : '') +
      '</strong> sin publicar. Cuando termines, pulsa <strong>⬇️ Descargar users.json</strong> y súbelo a GitHub.';
  }

  function markUserChange(id) {
    if (id) state.pendingUserChanges.add(id);
    else state.pendingUserChanges.add('__bulk__');
    renderPendingBanner();
  }

  async function addUser(id, name, role) {
    id = String(id || '').trim();
    name = String(name || '').trim();
    role = String(role || CONFIG.ROLES.OPERADOR).trim();
    if (!id || !name) { toast('⚠️ ID y nombre son obligatorios'); return false; }
    if (!/^usr_[a-z0-9]+$/i.test(id)) { toast('⚠️ ID debe tener formato usr_xxxxxxxx'); return false; }
    if (state.users.some(u => u.id === id)) { toast('⚠️ Ese ID ya está registrado'); return false; }
    state.users.push({ id, name, role });
    markUserChange(id);
    renderUsersList();
    await DB.addAudit({
      action: 'admin_add_user',
      actor: { id: state.adminId, name: 'Admin' },
      target: { id },
      meta: { name, role }
    });
    toast('✅ Agregado. Se publicará al descargar users.json.');
    return true;
  }

  async function removeUser(id) {
    if (id === state.adminId) { toast('⚠️ No puedes quitarte'); return; }
    if (!confirm('¿Eliminar definitivamente a este usuario?\n\nSe perderá su registro en users.json. Sus solicitudes creadas NO se borran.')) return;
    const removed = state.users.find(u => u.id === id);
    state.users = state.users.filter(u => u.id !== id);
    markUserChange(id);
    renderUsersList();
    await DB.addAudit({
      action: 'admin_remove_user',
      actor: { id: state.adminId, name: 'Admin' },
      target: { id },
      meta: { name: removed ? removed.name : '' }
    });
    toast('🗑️ Quitado. Se publicará al descargar users.json.');
  }

  async function suspendUser(id) {
    if (id === state.adminId) { toast('⚠️ No puedes suspenderte'); return; }
    const user = state.users.find(u => u.id === id);
    if (!user) return;
    if (!confirm('¿Suspender temporalmente a ' + user.name + '?\n\nNo podrá entrar pero sus datos se conservan.')) return;
    user.suspended = true;
    markUserChange(id);
    renderUsersList();
    await DB.addAudit({
      action: 'admin_suspend_user',
      actor: { id: state.adminId, name: 'Admin' },
      target: { id },
      meta: { name: user.name }
    });
    toast('⏸️ Suspendido. Se publicará al descargar users.json.');
  }

  async function reactivateUser(id) {
    const user = state.users.find(u => u.id === id);
    if (!user) return;
    if (!confirm('¿Reactivar a ' + user.name + '?')) return;
    delete user.suspended;
    markUserChange(id);
    renderUsersList();
    await DB.addAudit({
      action: 'admin_reactivate_user',
      actor: { id: state.adminId, name: 'Admin' },
      target: { id },
      meta: { name: user.name }
    });
    toast('▶️ Reactivado. Se publicará al descargar users.json.');
  }

  function downloadUsersJson() {
    const payload = {
      version: 1,
      updated: new Date().toISOString(),
      adminWhatsApp: state.adminWhatsApp || CONFIG.ADMIN_WHATSAPP,
      adminId: state.adminId || CONFIG.ADMIN_ID,
      users: state.users
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    state.pendingUserChanges.clear();
    renderUsersList();
    toast('⬇️ users.json descargado. Reemplázalo en tu repo y haz push.');
  }

  /* ---------- auditoría ---------- */
  async function loadAuditAndRender() {
    state.cachedAudit = await DB.getAuditLog(200);
    renderAudit(filterAudit(state.cachedAudit));
  }

  function filterAudit(entries) {
    const from = ($('auditFrom') || {}).value || '';
    const to = ($('auditTo') || {}).value || '';
    const action = ($('auditAction') || {}).value || '';
    const actor = (($('auditActor') || {}).value || '').trim().toLowerCase();
    return entries.filter(e => {
      const d = new Date(e.ts);
      const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (from && iso < from) return false;
      if (to && iso > to) return false;
      if (action && e.action !== action) return false;
      if (actor) {
        const an = ((e.actor && e.actor.name) || '').toLowerCase();
        if (an.indexOf(actor) === -1) return false;
      }
      return true;
    });
  }

  function renderAudit(entries) {
    const el = $('adminAuditList');
    if (!el) return;
    if (!entries.length) { el.innerHTML = '<div class="empty-mini">Sin eventos</div>'; return; }
    el.innerHTML = entries.map(e => {
      const label = AUDIT_LABEL[e.action] || e.action;
      const actorName = (e.actor && e.actor.name) || '—';
      const target = (e.target && (e.target.label || e.target.id)) || '';
      return '<div class="audit-row"><div class="audit-icon">•</div><div class="audit-body">' +
        '<div class="audit-line"><strong>' + esc(actorName) + '</strong> · ' + esc(label) +
        (target ? ' → ' + esc(target) : '') + '</div>' +
        '<div class="audit-time">' + esc(fmtDateTime(e.ts)) + '</div></div></div>';
    }).join('');
  }

  /* ---------- sync room ---------- */
  async function renderSyncRoom() {
    const input = $('adminSyncRoom');
    if (!input) return;
    input.value = await DB.getSyncRoom();
  }
  async function changeSyncRoom(room) {
    room = String(room || '').trim();
    if (!/^[a-z0-9_\-]{3,60}$/i.test(room)) { toast('⚠️ Solo letras, números, guion y guion bajo'); return; }
    await DB.setSyncRoom(room);
    await DB.addAudit({
      action: 'change_sync_room',
      actor: { id: state.adminId, name: 'Admin' },
      meta: { newRoom: room }
    });
    toast('✅ Sala cambiada. Reinicia para aplicar.');
  }

  /* ---------- respaldos ---------- */
  async function renderBackupsList() {
    const el = $('adminBackupsList');
    if (!el) return;
    state.cachedBackups = await DB.getBackups();
    if (!state.cachedBackups.length) {
      el.innerHTML = '<div class="empty-mini">Sin respaldos todavía.</div>';
      return;
    }
    el.innerHTML = state.cachedBackups.map(b => {
      const date = fmtDateTime(b.created_at);
      const sizeKB = Math.max(1, Math.round(JSON.stringify(b.snapshot || {}).length / 1024));
      const count = (b.snapshot && b.snapshot.records) ? b.snapshot.records.length : 0;
      const reason = (b.meta && b.meta.reason) ? b.meta.reason : '';
      return '<div class="backup-row">' +
        '<div class="backup-info">' +
          '<div class="backup-date">' + esc(date) + '</div>' +
          '<div class="backup-meta">' + count + ' registros · ~' + sizeKB + ' KB' +
            (reason ? ' · <em>' + esc(reason) + '</em>' : '') + '</div>' +
        '</div>' +
        '<div class="pending-actions">' +
          '<button class="hbtn hbtn-view" title="Descargar" data-backup-export="' + b.id + '">⬇️</button>' +
          '<button class="hbtn hbtn-edit" title="Restaurar (merge)" data-backup-restore="' + b.id + '">🔄</button>' +
          '<button class="hbtn hbtn-del" title="Eliminar" data-backup-delete="' + b.id + '">🗑️</button>' +
        '</div>' +
      '</div>';
    }).join('');

    el.querySelectorAll('[data-backup-export]').forEach(btn => {
      btn.addEventListener('click', () => Backup.exportToFile(parseInt(btn.getAttribute('data-backup-export'), 10)));
    });
    el.querySelectorAll('[data-backup-restore]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-backup-restore'), 10);
        const bk = state.cachedBackups.find(b => b.id === id);
        if (!bk) return;
        if (!confirm('⚠️ Restaurar este respaldo combinará sus datos con los actuales (los más recientes ganan).\n\n¿Continuar?')) return;
        const file = new File([JSON.stringify(bk.snapshot)], 'backup.json', { type: 'application/json' });
        await Backup.importFromFile(file, 'merge');
        await renderBackupsList();
      });
    });
    el.querySelectorAll('[data-backup-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este respaldo?')) return;
        await Backup.remove(parseInt(btn.getAttribute('data-backup-delete'), 10));
        await renderBackupsList();
      });
    });
  }

  async function handleBackupCreate() {
    toast('⏳ Creando respaldo…');
    const row = await Backup.create('manual');
    if (row) { await renderBackupsList(); toast('✅ Respaldo creado'); }
    else toast('⚠️ No se pudo crear el respaldo');
  }
  async function handleBackupExport() { await Backup.exportToFile(null); }
  function handleBackupImportClick() { const f = $('backupImportFile'); if (f) f.click(); }
  async function handleBackupImportFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const modeEl = $('backupImportMode');
    const mode = modeEl ? modeEl.value : 'merge';
    const ok = await Backup.importFromFile(file, mode);
    if (ok) await renderBackupsList();
  }
  async function handleBackupClearAll() {
    if (!confirm('¿Eliminar TODOS los respaldos guardados?')) return;
    await Backup.clearAll();
    await renderBackupsList();
    toast('🗑️ Respaldos eliminados');
  }

  /* ---------- panel HTML ---------- */
  function buildPanelHTML() {
    return '' +
'<div class="admin-panel">' +
  '<h2 class="admin-title">⚙️ Panel de Administración</h2>' +
  '<p class="admin-sub">Solo visible para el administrador.</p>' +

  '<section class="admin-section"><h3>📊 Dashboard</h3>' +
    '<div id="adminStorageInfo" class="admin-storage-info">💾 Calculando almacenamiento…</div>' +
    '<div id="adminDashboard"></div></section>' +

  '<section class="admin-section"><h3>⚖️ Pendientes de aprobar</h3>' +
    '<div id="adminPendingList"></div></section>' +

  '<section class="admin-section"><h3>🟢 Usuarios en línea / última conexión</h3>' +
    '<div id="adminOnline"></div></section>' +

  '<section class="admin-section"><h3>👥 Usuarios autorizados</h3>' +
    '<div id="adminPendingBanner" class="pending-banner" style="display:none"></div>' +
    '<div class="admin-form-row">' +
      '<input type="text" id="adminNewUserId" placeholder="ID (usr_xxxxxxxx)">' +
      '<input type="text" id="adminNewUserName" placeholder="Nombre y apellido">' +
      '<select id="adminNewUserRole">' +
        '<option value="operador">Operador</option>' +
        '<option value="balance">Centro de Balance</option>' +
        '<option value="admin">Admin</option></select>' +
      '<button id="adminAddUserBtn" class="btn btn-primary btn-sm">➕ Agregar</button></div>' +
    '<div id="adminUsersList" style="margin-top:12px"></div>' +
    '<div class="admin-actions">' +
      '<button id="adminDownloadUsersBtn" class="btn btn-primary btn-sm">⬇️ Descargar users.json</button></div>' +
    '<div class="hint" style="margin-top:8px">Agrega, suspende o elimina a los usuarios que necesites y al final descarga este archivo una sola vez.</div></section>' +

  '<section class="admin-section"><h3>💾 Respaldos</h3>' +
    '<div class="admin-form-row">' +
      '<button id="backupCreateBtn" class="btn btn-primary btn-sm">➕ Crear ahora</button>' +
      '<button id="backupExportBtn" class="btn btn-secondary btn-sm">⬇️ Exportar actual</button>' +
    '</div>' +
    '<div class="admin-form-row">' +
      '<input type="file" id="backupImportFile" accept=".json,application/json" style="display:none">' +
      '<button id="backupImportBtn" class="btn btn-secondary btn-sm">⬆️ Importar archivo</button>' +
      '<select id="backupImportMode">' +
        '<option value="merge">Combinar (recomendado)</option>' +
        '<option value="replace">Reemplazar todo</option></select>' +
    '</div>' +
    '<div id="adminBackupsList" style="margin-top:12px"></div>' +
    '<div class="admin-actions" style="margin-top:10px">' +
      '<button id="backupClearAllBtn" class="btn btn-secondary btn-sm">🗑️ Eliminar todos</button>' +
    '</div>' +
    '<div class="hint" style="margin-top:8px">Solo se conservan los últimos ' + CONFIG.BACKUP_MAX_COUNT + ' respaldos.</div>' +
  '</section>' +

  '<section class="admin-section"><h3>📄 Exportar historial</h3>' +
    '<div class="admin-form-row">' +
      '<input type="date" id="adminExportFrom">' +
      '<input type="date" id="adminExportTo">' +
      '<input type="text" id="adminExportQuery" placeholder="Buscar placa/destino/chofer">' +
      '<select id="adminExportFilter">' +
        '<option value="placa">Por placa</option>' +
        '<option value="destino">Por destino</option>' +
        '<option value="chofer">Por chofer</option></select></div>' +
    '<div class="admin-form-row">' +
      '<button id="adminExportPdfBtn" class="btn btn-primary btn-sm">📄 PDF</button>' +
      '<button id="adminExportExcelBtn" class="btn btn-secondary btn-sm">📊 Excel</button></div></section>' +

  '<section class="admin-section"><h3>🔍 Auditoría</h3>' +
    '<div class="admin-form-row">' +
      '<input type="date" id="auditFrom">' +
      '<input type="date" id="auditTo">' +
      '<select id="auditAction">' +
        '<option value="">Todas</option>' +
        '<option value="create">Creó solicitud</option>' +
        '<option value="update">Editó solicitud</option>' +
        '<option value="delete_local">Ocultó (local)</option>' +
        '<option value="delete_global">Borró (global)</option>' +
        '<option value="login">Inició sesión</option>' +
        '<option value="register_request">Solicitud registro</option>' +
        '<option value="admin_add_user">Agregó usuario</option>' +
        '<option value="admin_remove_user">Quitó usuario</option>' +
        '<option value="admin_suspend_user">Suspendió usuario</option>' +
        '<option value="admin_reactivate_user">Reactivó usuario</option>' +
        '<option value="status_change">Cambió estado</option>' +
        '<option value="send_to_balance">Envió al Balance</option>' +
        '<option value="backup_create">Creó respaldo</option>' +
        '<option value="backup_export">Exportó respaldo</option>' +
        '<option value="backup_import">Importó respaldo</option>' +
        '<option value="profile_update">Actualizó perfil</option>' +
        '<option value="change_sync_room">Cambió sala</option></select>' +
      '<input type="text" id="auditActor" placeholder="Buscar actor"></div>' +
    '<div class="admin-form-row">' +
      '<button id="auditExportPdfBtn" class="btn btn-primary btn-sm">📄 PDF</button>' +
      '<button id="auditExportExcelBtn" class="btn btn-secondary btn-sm">📊 Excel</button></div>' +
    '<div id="adminAuditList" style="margin-top:12px"></div></section>' +

  '<section class="admin-section"><h3>🌐 Sala de sincronización</h3>' +
    '<div class="admin-form-row">' +
      '<input type="text" id="adminSyncRoom" placeholder="insopesca-puerto-el-morro-v1">' +
      '<button id="adminSyncRoomBtn" class="btn btn-secondary btn-sm">Guardar</button></div>' +
    '<div class="hint" style="margin-top:8px">Cambia la sala si este dispositivo pertenece a otro puerto.</div></section>' +

  '<section class="admin-section admin-danger"><h3>🚪 Cuenta</h3>' +
    '<button id="adminLogoutBtn" class="btn btn-secondary btn-sm">Cerrar sesión en este dispositivo</button></section>' +
'</div>';
  }

  /* ---------- filtros export ---------- */
  async function getFilteredRecords() {
    const all = await DB.getAllRecords();
    const from = ($('adminExportFrom') || {}).value || '';
    const to   = ($('adminExportTo') || {}).value || '';
    const q    = (($('adminExportQuery') || {}).value || '').trim().toLowerCase();
    const f    = ($('adminExportFilter') || {}).value || 'placa';
    return all.filter(r => {
      const day = r.fecha ? parseFechaToISO(r.fecha) : (r.savedAt ? r.savedAt.slice(0, 10) : '');
      if (from && day && day < from) return false;
      if (to && day && day > to) return false;
      if (q && String(r[f] || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function buildFilterLabel() {
    const parts = [];
    const from = ($('adminExportFrom') || {}).value;
    const to   = ($('adminExportTo') || {}).value;
    const q    = (($('adminExportQuery') || {}).value || '').trim();
    const f    = ($('adminExportFilter') || {}).value;
    if (from) parts.push('desde ' + from);
    if (to) parts.push('hasta ' + to);
    if (q) parts.push('"' + q + '" por ' + f);
    return parts.join(' · ');
  }

  /* ---------- bind ---------- */
  function bindPanelEvents() {
    if ($('adminAddUserBtn')) $('adminAddUserBtn').addEventListener('click', async () => {
      const ok = await addUser(
        ($('adminNewUserId') || {}).value,
        ($('adminNewUserName') || {}).value,
        ($('adminNewUserRole') || {}).value
      );
      if (ok) {
        if ($('adminNewUserId')) $('adminNewUserId').value = '';
        if ($('adminNewUserName')) $('adminNewUserName').value = '';
        if ($('adminNewUserId')) $('adminNewUserId').focus();
      }
    });
    if ($('adminDownloadUsersBtn')) $('adminDownloadUsersBtn').addEventListener('click', downloadUsersJson);

    if ($('backupCreateBtn')) $('backupCreateBtn').addEventListener('click', handleBackupCreate);
    if ($('backupExportBtn')) $('backupExportBtn').addEventListener('click', handleBackupExport);
    if ($('backupImportBtn')) $('backupImportBtn').addEventListener('click', handleBackupImportClick);
    if ($('backupImportFile')) $('backupImportFile').addEventListener('change', handleBackupImportFile);
    if ($('backupClearAllBtn')) $('backupClearAllBtn').addEventListener('click', handleBackupClearAll);

    if ($('adminExportPdfBtn')) $('adminExportPdfBtn').addEventListener('click', async () => {
      try { await exportRecordsPDF(await getFilteredRecords(), buildFilterLabel()); }
      catch (e) { console.error(e); toast('⚠️ Error al generar PDF'); }
    });
    if ($('adminExportExcelBtn')) $('adminExportExcelBtn').addEventListener('click', async () => {
      try { await exportRecordsExcel(await getFilteredRecords(), buildFilterLabel()); }
      catch (e) { console.error(e); toast('⚠️ Error al generar Excel'); }
    });
    if ($('auditExportPdfBtn')) $('auditExportPdfBtn').addEventListener('click', async () => {
      try { await exportAuditPDF(filterAudit(state.cachedAudit)); }
      catch (e) { console.error(e); toast('⚠️ Error al generar PDF'); }
    });
    if ($('auditExportExcelBtn')) $('auditExportExcelBtn').addEventListener('click', async () => {
      try { await exportAuditExcel(filterAudit(state.cachedAudit)); }
      catch (e) { console.error(e); toast('⚠️ Error al generar Excel'); }
    });
    if ($('adminSyncRoomBtn')) $('adminSyncRoomBtn').addEventListener('click', async () => {
      await changeSyncRoom(($('adminSyncRoom') || {}).value);
    });
    if ($('adminLogoutBtn')) $('adminLogoutBtn').addEventListener('click', () => {
      if (typeof Identity !== 'undefined' && Identity.logout) Identity.logout();
    });
    ['auditFrom', 'auditTo', 'auditAction', 'auditActor'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', () => renderAudit(filterAudit(state.cachedAudit)));
      el.addEventListener('change', () => renderAudit(filterAudit(state.cachedAudit)));
    });
  }

  /* ---------- mount ---------- */
  async function mount(containerId) {
    const container = $(containerId);
    if (!container) return;
    container.innerHTML = buildPanelHTML();

    const file = await Identity.loadUsersFile(true);
    if (file) {
      state.users = (file.users || []).slice();
      state.adminWhatsApp = file.adminWhatsApp || CONFIG.ADMIN_WHATSAPP;
      state.adminId = file.adminId || CONFIG.ADMIN_ID;
    } else {
      state.users = [{ id: CONFIG.ADMIN_ID, name: 'Admin', role: 'admin' }];
      state.adminWhatsApp = CONFIG.ADMIN_WHATSAPP;
      state.adminId = CONFIG.ADMIN_ID;
    }

    renderUsersList();
    await renderSyncRoom();
    bindPanelEvents();

    await renderStorageInfo();
    renderDashboard(await DB.getAllRecords());
    await renderOnlineUsers();
    await loadAuditAndRender();
    await renderBackupsList();

    state.mounted = true;
  }

  async function refreshDashboard() {
    if (!state.mounted) return;
    await renderStorageInfo();
    renderDashboard(await DB.getAllRecords());
  }
  async function refreshOnline() {
    if (!state.mounted) return;
    await renderOnlineUsers();
  }
  async function refreshAudit() {
    if (!state.mounted) return;
    await loadAuditAndRender();
  }

  return {
    mount, refreshDashboard, refreshOnline, refreshAudit,
    exportRecordsPDF, exportRecordsExcel, exportAuditPDF, exportAuditExcel
  };
})();
