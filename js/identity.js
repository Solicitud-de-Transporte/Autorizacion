/* ============================================================
   Identidad y autorización - Insopesca El Morro
   v2.0.1: la sala del operador en users.json es autoritativa
   ============================================================ */

window.Identity = (function () {
  'use strict';

  const state = {
    identity: null,
    usersFile: null,
    usersFileFetchedAt: 0,
    initialized: false
  };

  let onAuthorizedCb = null;
  const $ = (id) => document.getElementById(id);

  function showModal(id) { const el = $(id); if (el) el.classList.add('show'); }
  function hideModal(id) { const el = $(id); if (el) el.classList.remove('show'); }
  function toast(msg) {
    if (typeof window.toast === 'function') window.toast(msg);
    else console.log('[toast]', msg);
  }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  async function loadUsersFile(force) {
    const now = Date.now();
    if (!force && state.usersFile && (now - state.usersFileFetchedAt) < CONFIG.USERS_CACHE_TTL) {
      return state.usersFile;
    }
    try {
      const res = await fetch(CONFIG.USERS_FILE + '?t=' + now, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (!json || !Array.isArray(json.users)) throw new Error('users.json inválido');
      state.usersFile = json;
      state.usersFileFetchedAt = now;
      return json;
    } catch (e) {
      console.warn('[Identity] No se pudo cargar users.json:', e.message);
      return state.usersFile;
    }
  }

  async function findUserById(id, force) {
    const file = await loadUsersFile(force);
    if (!file) return null;
    return (file.users || []).find(x => x && x.id === id) || null;
  }

  function generateId(existingIds) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const canCrypto = !!(window.crypto && typeof window.crypto.getRandomValues === 'function');
    for (let attempt = 0; attempt < 5; attempt++) {
      let result = '';
      if (canCrypto) {
        const bytes = new Uint8Array(8);
        window.crypto.getRandomValues(bytes);
        for (let i = 0; i < 8; i++) result += alphabet[bytes[i] % alphabet.length];
      } else {
        for (let i = 0; i < 8; i++) result += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      const id = 'usr_' + result;
      if (!existingIds || !existingIds.has(id)) return id;
    }
    return 'usr_' + Date.now().toString(36);
  }
  function buildExistingIdSet(file) {
    const set = new Set();
    if (file && Array.isArray(file.users)) {
      file.users.forEach(u => { if (u && u.id) set.add(u.id); });
    }
    return set;
  }

  async function compressPhoto(file) {
    const maxDim = CONFIG.PROFILE_PHOTO_MAX_DIM;
    const quality = CONFIG.PROFILE_PHOTO_QUALITY;
    const maxBytes = CONFIG.PROFILE_PHOTO_MAX_BYTES;

    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = URL.createObjectURL(file);
    });

    let q = quality;
    let dataUrl = '';
    let bytes = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL('image/jpeg', q);
      bytes = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);
      if (bytes <= maxBytes) break;
      q = Math.max(0.3, q - 0.15);
    }
    return { dataUrl, bytes };
  }

  async function compressPhotoFromFile(file) {
    if (!file) return null;
    try {
      const { dataUrl } = await compressPhoto(file);
      return dataUrl;
    } catch (e) {
      console.error('[Identity] compressPhotoFromFile', e);
      toast('⚠️ No se pudo procesar la imagen');
      return null;
    }
  }

  async function checkAuthorization(id, force) {
    const u = await findUserById(id, force);
    const adminWhatsApp = (state.usersFile && state.usersFile.adminWhatsApp) || CONFIG.ADMIN_WHATSAPP;

    if (!u) return {
      authorized: false, suspended: false,
      role: null, name: null, room: null, adminWhatsApp
    };
    if (u.suspended === true) return {
      authorized: false, suspended: true,
      role: u.role || CONFIG.ROLES.OPERADOR,
      name: u.name || '', room: u.room || null, adminWhatsApp
    };
    return {
      authorized: true, suspended: false,
      role: u.role || CONFIG.ROLES.OPERADOR,
      name: u.name || '', room: u.room || null, adminWhatsApp
    };
  }

  async function getAvailableRooms() {
    const file = await loadUsersFile(false);
    if (file && Array.isArray(file.rooms) && file.rooms.length) {
      return file.rooms.slice();
    }
    return CONFIG.DEFAULT_PORTS.slice();
  }

  function showFirstBootModal() {
    const manualCb = $('ifb_manualToggle');
    if (manualCb) manualCb.checked = false;
    const manualWrap = $('ifb_manualWrap');
    if (manualWrap) manualWrap.style.display = 'none';
    const manualInp = $('ifb_manualId');
    if (manualInp) manualInp.value = '';
    const nameInp = $('ifb_name');
    if (nameInp) nameInp.value = '';

    getAvailableRooms().then(rooms => {
      const portSel = $('ifb_port');
      if (portSel) {
        portSel.innerHTML = rooms.map(p => '<option value="' + p + '">' + p + '</option>').join('');
        portSel.value = rooms[0] || 'El Morro';
      }
    });
    showModal('identityFirstBootModal');
  }
  function hideFirstBootModal() { hideModal('identityFirstBootModal'); }

  function showWaitingScreen(id, suspended) {
    setText('iwm_idDisplay', id || '—');
    setText('iwm_whatsapp', CONFIG.ADMIN_WHATSAPP);
    const title = document.querySelector('#identityWaitingModal .modal-title');
    if (title) title.textContent = suspended ? '⏸️ Cuenta suspendida' : '⏳ Esperando autorización';
    const desc = $('iwm_description');
    if (desc) desc.textContent = suspended
      ? 'Tu cuenta está temporalmente suspendida. Cuando el administrador te reactive, pulsa "🔄 Verificar de nuevo".'
      : 'Tu ID fue enviado al administrador. Cuando te autorice podrás entrar.';
    showModal('identityWaitingModal');
  }
  function hideWaitingScreen() { hideModal('identityWaitingModal'); }

  function buildWhatsAppURL(name, id, port) {
    const msg = 'Hola Emmanuel, soy ' + (name || '(sin nombre)') +
      '. Mi ID es ' + id + ' (Sala: ' + (port || '—') + '). ' +
      'Solicito acceso a Insopesca El Morro.';
    const number = CONFIG.ADMIN_WHATSAPP.replace(/\D/g, '');
    return 'https://wa.me/' + number + '?text=' + encodeURIComponent(msg);
  }

  async function submitFirstBoot() {
    const nameInp = $('ifb_name');
    const name = nameInp ? nameInp.value.trim() : '';
    if (!name || name.length < 3) {
      toast('⚠️ Escribe tu nombre y apellido');
      if (nameInp) nameInp.focus();
      return;
    }

    const manualCb = $('ifb_manualToggle');
    const isAdmin = !!(manualCb && manualCb.checked);
    let id;
    if (isAdmin) {
      const manualInp = $('ifb_manualId');
      const manualId = manualInp ? manualInp.value.trim() : '';
      if (!manualId) { toast('⚠️ Ingresa tu ID de administrador'); return; }
      if (manualId !== CONFIG.ADMIN_ID) {
        toast('⚠️ Ese ID no corresponde al administrador');
        return;
      }
      id = manualId;
    } else {
      const file = await loadUsersFile(true);
      const existingIds = buildExistingIdSet(file);
      id = generateId(existingIds);
    }

    const portSel = $('ifb_port');
    const port = portSel ? portSel.value : (CONFIG.DEFAULT_PORTS[0] || 'El Morro');

    const identity = {
      id, name, port,
      role: isAdmin ? CONFIG.ROLES.ADMIN : CONFIG.ROLES.OPERADOR,
      photo: null,
      createdAt: Date.now(),
      authorized: false
    };

    await DB.setIdentity(identity);
    state.identity = identity;

    await DB.addAudit({
      action: 'register_request',
      actor: { id: identity.id, name: identity.name },
      target: { id: identity.id },
      meta: { port, role: identity.role }
    });

    if (isAdmin) {
      const auth = await checkAuthorization(id, true);
      if (auth.authorized) {
        identity.role = auth.role;
        identity.name = auth.name || identity.name;
        /* Admin: en primera autorización, respetar la sala de users.json si existe */
        if (auth.room) identity.port = auth.room;
        identity.authorized = true;
        await DB.setIdentity(identity);
        await DB.setSyncRoom(CONFIG.portToRoom(identity.port));
        await DB.addAudit({
          action: 'login',
          actor: { id: identity.id, name: identity.name },
          meta: { role: identity.role }
        });
        hideFirstBootModal();
        enterApp(identity);
        return;
      }
      if (auth.suspended) {
        toast('⏸️ Tu cuenta de administrador está suspendida');
        return;
      }
    }

    await DB.setSyncRoom(CONFIG.portToRoom(port));
    const url = buildWhatsAppURL(identity.name, identity.id, identity.port);
    window.open(url, '_blank');
    hideFirstBootModal();
    showWaitingScreen(identity.id, false);
  }

  async function refreshAuthorization() {
    if (!state.identity) { toast('⚠️ No hay identidad guardada'); return; }
    const btn = $('iwm_checkBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Verificando…'; }
    try {
      const auth = await checkAuthorization(state.identity.id, true);
      if (auth.authorized) {
        state.identity.role = auth.role;
        state.identity.name = auth.name || state.identity.name;
        /* Sala autoritativa desde users.json */
        if (auth.room) state.identity.port = auth.room;
        state.identity.authorized = true;
        await DB.setIdentity(state.identity);
        await DB.setSyncRoom(CONFIG.portToRoom(state.identity.port));
        await DB.addAudit({
          action: 'login',
          actor: { id: state.identity.id, name: state.identity.name },
          meta: { role: state.identity.role, room: state.identity.port }
        });
        hideWaitingScreen();
        enterApp(state.identity);
        return;
      }
      if (auth.suspended) {
        showWaitingScreen(state.identity.id, true);
        toast('⏸️ Tu cuenta está suspendida');
      } else {
        showWaitingScreen(state.identity.id, false);
        toast('⏳ Aún no autorizado. El admin debe agregarte a users.json');
      }
    } catch (e) {
      console.error(e);
      toast('⚠️ Error al verificar');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Verificar de nuevo'; }
    }
  }

  function enterApp(identity) {
    hideFirstBootModal();
    hideWaitingScreen();
    const bootView = $('identityBootView');
    const appView = $('appView');
    if (bootView) bootView.style.display = 'none';
    if (appView) appView.style.display = '';
    if (typeof onAuthorizedCb === 'function') {
      try { onAuthorizedCb(identity); } catch (e) { console.error(e); }
    }
  }

  async function init() {
    if (state.initialized) return state.identity;
    state.initialized = true;

    const stored = await DB.getIdentity();
    if (!stored) { showFirstBootModal(); return null; }
    state.identity = stored;

    const auth = await checkAuthorization(stored.id, false);

    if (auth.authorized) {
      state.identity.role = auth.role;
      state.identity.name = auth.name || state.identity.name;
      /* Solo operador: la sala siempre se sobrescribe (es fija) */
      if (auth.room && auth.role === CONFIG.ROLES.OPERADOR) {
        state.identity.port = auth.room;
      }
      state.identity.authorized = true;
      await DB.setIdentity(state.identity);
    }

    /* Sincronizar sync_room con el port actual */
    const expectedRoom = CONFIG.portToRoom(state.identity.port);
    const currentRoom = await DB.getSyncRoom();
    if (currentRoom !== expectedRoom) {
      await DB.setSyncRoom(expectedRoom);
    }

    if (auth.authorized) {
      enterApp(state.identity);
      return state.identity;
    }

    if (auth.suspended) {
      showWaitingScreen(stored.id, true);
      return null;
    }

    if (!state.usersFile && stored.authorized) {
      enterApp(stored);
      return stored;
    }
    showWaitingScreen(stored.id, false);
    return null;
  }

  async function logout() {
    if (!confirm('¿Borrar la identidad de este dispositivo? Tendrás que volver a registrarte.')) return;
    await DB.clearIdentity();
    state.identity = null;
    state.initialized = false;
    const appView = $('appView');
    if (appView) appView.style.display = 'none';
    const bootView = $('identityBootView');
    if (bootView) bootView.style.display = '';
    showFirstBootModal();
  }

  async function updateProfile(updates) {
    if (!state.identity) return null;
    const merged = Object.assign({}, state.identity, updates);
    await DB.setIdentity(merged);
    if (updates && updates.port) {
      await DB.setSyncRoom(CONFIG.portToRoom(updates.port));
    }
    state.identity = merged;
    return merged;
  }

  function getCurrentUser() { return state.identity ? Object.assign({}, state.identity) : null; }
  function isAdmin()    { return !!(state.identity && state.identity.role === CONFIG.ROLES.ADMIN); }
  function isBalance()  { return !!(state.identity && state.identity.role === CONFIG.ROLES.BALANCE); }

  function setupUI() {
    const manualCb = $('ifb_manualToggle');
    if (manualCb) {
      manualCb.addEventListener('change', function () {
        const wrap = $('ifb_manualWrap');
        if (!wrap) return;
        wrap.style.display = manualCb.checked ? '' : 'none';
        const submitBtn = $('ifb_submitBtn');
        if (submitBtn) submitBtn.textContent = manualCb.checked
          ? '✅ Entrar como administrador'
          : '📱 Enviar solicitud por WhatsApp';
      });
    }
    const submitBtn = $('ifb_submitBtn');
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        submitFirstBoot().catch(e => { console.error(e); toast('⚠️ Error al registrarte'); });
      });
    }
    const checkBtn = $('iwm_checkBtn');
    if (checkBtn) {
      checkBtn.addEventListener('click', function () {
        refreshAuthorization().catch(e => console.error(e));
      });
    }
    const retryWhatsBtn = $('iwm_whatsappBtn');
    if (retryWhatsBtn) {
      retryWhatsBtn.addEventListener('click', function () {
        if (!state.identity) return;
        const url = buildWhatsAppURL(state.identity.name, state.identity.id, state.identity.port);
        window.open(url, '_blank');
      });
    }
  }

  return {
    init, setupUI,
    getCurrentUser, isAdmin, isBalance,
    refreshAuthorization, logout,
    loadUsersFile, findUserById,
    updateProfile, compressPhotoFromFile, getAvailableRooms,
    set onAuthorized(fn) { onAuthorizedCb = fn; }
  };
})();