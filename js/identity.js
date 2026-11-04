/* ============================================================
   Identidad y autorización - Insopesca El Morro
   v1.9.0:
   - Generación de ID con crypto.getRandomValues
   - Verificación anti-colisión contra users.json
   - Soporte de usuarios suspendidos
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

  /* ---------- users.json ---------- */
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

  /* ---------- generación de ID ---------- */
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
    /* Fallback casi imposible: usa timestamp */
    return 'usr_' + Date.now().toString(36);
  }

  function buildExistingIdSet(file) {
    const set = new Set();
    if (file && Array.isArray(file.users)) {
      file.users.forEach(u => { if (u && u.id) set.add(u.id); });
    }
    return set;
  }

  /* ---------- foto ---------- */
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

  /* ---------- autorización ---------- */
  async function checkAuthorization(id, force) {
    const u = await findUserById(id, force);
    const adminWhatsApp = (state.usersFile && state.usersFile.adminWhatsApp) || CONFIG.ADMIN_WHATSAPP;

    if (!u) return {
      authorized: false,
      suspended: false,
      role: null,
      name: null,
      adminWhatsApp
    };

    if (u.suspended === true) return {
      authorized: false,
      suspended: true,
      role: u.role || CONFIG.ROLES.OPERADOR,
      name: u.name || '',
      adminWhatsApp
    };

    return {
      authorized: true,
      suspended: false,
      role: u.role || CONFIG.ROLES.OPERADOR,
      name: u.name || '',
      adminWhatsApp
    };
  }

  /* ---------- UI ---------- */
  function showFirstBootModal() {
    const manualCb = $('ifb_manualToggle');
    if (manualCb) manualCb.checked = false;
    const manualWrap = $('ifb_manualWrap');
    if (manualWrap) manualWrap.style.display = 'none';
    const manualInp = $('ifb_manualId');
    if (manualInp) manualInp.value = '';
    const nameInp = $('ifb_name');
    if (nameInp) nameInp.value = '';

    const portSel = $('ifb_port');
    if (portSel) {
      portSel.innerHTML = CONFIG.AVAILABLE_PORTS
        .map(p => '<option value="' + p + '">' + p + '</option>').join('');
      portSel.value = CONFIG.DEFAULT_PORT_NAME;
    }
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
    const msg =
      'Hola Emmanuel, soy ' + (name || '(sin nombre)') +
      '. Mi ID es ' + id + ' (Puerto: ' + (port || '—') + '). ' +
      'Solicito acceso a Insopesca El Morro.';
    const number = CONFIG.ADMIN_WHATSAPP.replace(/\D/g, '');
    return 'https://wa.me/' + number + '?text=' + encodeURIComponent(msg);
  }

  /* ---------- submit primer boot ---------- */
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
      /* Generar ID con verificación anti-colisión */
      const file = await loadUsersFile(true);
      const existingIds = buildExistingIdSet(file);
      id = generateId(existingIds);
    }

    const portSel = $('ifb_port');
    const port = portSel ? portSel.value : CONFIG.DEFAULT_PORT_NAME;

    const identity = {
      id,
      name,
      port,
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
        identity.authorized = true;
        await DB.setIdentity(identity);
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

    const url = buildWhatsAppURL(identity.name, identity.id, identity.port);
    window.open(url, '_blank');

    hideFirstBootModal();
    showWaitingScreen(identity.id, false);
  }

  /* ---------- verificar ---------- */
  async function refreshAuthorization() {
    if (!state.identity) { toast('⚠️ No hay identidad guardada'); return; }

    const btn = $('iwm_checkBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Verificando…'; }
    try {
      const auth = await checkAuthorization(state.identity.id, true);
      if (auth.authorized) {
        state.identity.role = auth.role;
        state.identity.name = auth.name || state.identity.name;
        state.identity.authorized = true;
        await DB.setIdentity(state.identity);
        await DB.addAudit({
          action: 'login',
          actor: { id: state.identity.id, name: state.identity.name },
          meta: { role: state.identity.role }
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

  /* ---------- entrar ---------- */
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

  /* ---------- init ---------- */
  async function init() {
    if (state.initialized) return state.identity;
    state.initialized = true;

    const stored = await DB.getIdentity();
    if (!stored) {
      showFirstBootModal();
      return null;
    }

    state.identity = stored;

    const auth = await checkAuthorization(stored.id, false);
    if (auth.authorized) {
      state.identity.role = auth.role;
      state.identity.name = auth.name || state.identity.name;
      state.identity.authorized = true;
      await DB.setIdentity(state.identity);
      enterApp(state.identity);
      return state.identity;
    }

    if (auth.suspended) {
      showWaitingScreen(stored.id, true);
      return null;
    }

    /* Fallback offline: si alguna vez estuvo autorizado y no hay red, dejar entrar */
    if (!state.usersFile && stored.authorized) {
      enterApp(stored);
      return stored;
    }

    showWaitingScreen(stored.id, false);
    return null;
  }

  /* ---------- logout ---------- */
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

  /* ---------- updateProfile ---------- */
  async function updateProfile(updates) {
    if (!state.identity) return null;
    const merged = Object.assign({}, state.identity, updates);
    await DB.setIdentity(merged);
    state.identity = merged;
    return merged;
  }

  /* ---------- públicos ---------- */
  function getCurrentUser() { return state.identity ? Object.assign({}, state.identity) : null; }
  function isAdmin()    { return !!(state.identity && state.identity.role === CONFIG.ROLES.ADMIN); }
  function isBalance()  { return !!(state.identity && state.identity.role === CONFIG.ROLES.BALANCE); }

  /* ---------- setupUI ---------- */
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
    init,
    setupUI,
    getCurrentUser,
    isAdmin,
    isBalance,
    refreshAuthorization,
    logout,
    loadUsersFile,
    findUserById,
    updateProfile,
    compressPhotoFromFile,
    set onAuthorized(fn) { onAuthorizedCb = fn; }
  };
})();
