/* ============================================================
   App principal - Insopesca El Morro
   v2.0.1: botón ⏳ Pendiente en modal de detalle
   ============================================================ */

var NL = String.fromCharCode(10);
var PIN = '\uD83D\uDCCC';

var state = {
  records: [],
  loaded: false,
  editingId: null,
  pendingDeleteId: null,
  pendingProfilePhoto: null
};

var staticEventsBound = false;
var currentFilter = 'placa';

var EMPRESAS = [
  {label:'Contupesca, El Morro', estado:'Sucre', municipio:'Arismendi', parroquia:'El Morro'},
  {label:'Inv. Buenaventura 2014, C.A., Puerto Santo', estado:'Sucre', municipio:'Arismendi', parroquia:'Puerto Santo'},
  {label:'Inv. La Piragua, C.A., El Morro', estado:'Sucre', municipio:'Arismendi', parroquia:'El Morro'},
  {label:'Inv. Tort Mar, C.A., El Morro', estado:'Sucre', municipio:'Arismendi', parroquia:'El Morro'},
  {label:'Inv. Xouba, Puerto Santo', estado:'Sucre', municipio:'Arismendi', parroquia:'Puerto Santo'},
  {label:'Inv. Yurianjor, C.A., Puerto Santo', estado:'Sucre', municipio:'Arismendi', parroquia:'Puerto Santo'},
  {label:'Mi Esfuerzo, El Morro', estado:'Sucre', municipio:'Arismendi', parroquia:'El Morro'},
  {label:'Salmar, El Morro', estado:'Sucre', municipio:'Arismendi', parroquia:'El Morro'},
  {label:'UPSA Luisa Cáceres de Arismendi, El Morro', estado:'Sucre', municipio:'Arismendi', parroquia:'El Morro'}
];
var MARCAS_VEHICULOS = ['Kenworth','Chevrolet','Ford','Mack','Volvo','Scania','Mercedes-Benz','Iveco','Freightliner','International','Hino','Isuzu','JAC','Foton','JMC','Dongfeng','Mitsubishi','Nissan','Toyota','Hyundai','Kia','Peugeot','Renault','Citroën','Fiat','MAN','DAF','Peterbilt','Western Star','Sterling','Autocar','UD Trucks','Tata','Ashok Leyland','Sinotruk','Shacman','FAW','CAMC','Dayun','Maxus','JBC','Mazda','Dodge','Ram'];

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(function (e) {
    console.warn('[SW] registration failed:', e);
  });
}

var deferredPrompt = null;
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  deferredPrompt = e;
  var el = document.getElementById('installBanner');
  if (el) el.classList.add('show');
});
function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt = null;
    var el = document.getElementById('installBanner');
    if (el) el.classList.remove('show');
  }
}

function $(id) { return document.getElementById(id); }
function toast(msg) {
  var t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._to);
  t._to = setTimeout(function () { t.classList.remove('show'); }, 2600);
}
function todayStr() {
  var d = new Date();
  var dd = ('0' + d.getDate()).slice(-2);
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  return dd + '/' + mm + '/' + d.getFullYear();
}
function fmtDate(iso) {
  if (!iso) return '';
  var d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('es-VE');
}
function formatCI(v) {
  v = String(v || '').replace(/\D/g, '');
  return v.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function dateToISO(s) {
  if (!s) return '';
  if (CONFIG.ISO_DATE_RE.test(s)) return s;
  var m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
  if (s.length >= 10 && s.indexOf('-') === 4) return s.slice(0, 10);
  return '';
}
function localDateFromISO(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function normalizeText(s) {
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function getRecordLocalISO(r) {
  if (r && r.fecha) {
    var iso = dateToISO(r.fecha);
    if (iso) return iso;
  }
  if (r && r.savedAt) {
    var local = localDateFromISO(r.savedAt);
    if (local) return local;
  }
  return '';
}

function getHistory() { return state.records; }
async function reloadRecordsFromDB() { state.records = await DB.getAllRecords(); }
function generateId() {
  var id = Date.now();
  var existing = new Set(state.records.map(function (r) { return r.id; }));
  while (existing.has(id)) id++;
  return id;
}
async function migrateHistory() {
  var changed = false;
  for (var i = 0; i < state.records.length; i++) {
    var r = state.records[i];
    if (r.especie === undefined) { r.especie = 'Sardina'; changed = true; }
    if (r.presentacion === undefined) { r.presentacion = r.sardina || ''; changed = true; }
    if (r.status === undefined) { r.status = CONFIG.STATUS.PENDIENTE; changed = true; }
    if (r.status_changed_at === undefined) { r.status_changed_at = 0; changed = true; }
    if (r.sent_to_balance === undefined) { r.sent_to_balance = false; changed = true; }
    if (r.observations === undefined) { r.observations = ''; changed = true; }
    if (r.room === undefined) { r.room = CONFIG.DEFAULT_PORTS[0] || 'El Morro'; changed = true; }
  }
  if (changed) await DB.putRecords(state.records);
}
function updateBadges() {
  var n = state.records.length;
  var navBadge = $('navBadge');
  var histCountBadge = $('histCountBadge');
  if (navBadge) navBadge.textContent = n;
  if (histCountBadge) histCountBadge.textContent = n;
}

function canManageBalance() {
  var u = Identity.getCurrentUser();
  if (!u) return false;
  return u.role === CONFIG.ROLES.BALANCE || u.role === CONFIG.ROLES.ADMIN;
}

function updateProfileHeader(user) {
  if (!user) return;
  var nameEl = $('profileName'), roleEl = $('profileRole'), photoEl = $('profilePhoto');
  if (nameEl) nameEl.textContent = user.name || 'Usuario';
  if (roleEl) {
    var roleLabel = { admin: 'Administrador', balance: 'Centro de Balance', operador: 'Operador' };
    roleEl.textContent = (roleLabel[user.role] || user.role || 'operador') +
      (user.port ? ' · ' + user.port : '');
  }
  if (photoEl) {
    if (user.photo) photoEl.innerHTML = '<img src="' + user.photo + '" alt="perfil">';
    else photoEl.textContent = (user.name || '?').charAt(0).toUpperCase();
    photoEl.title = 'Cambiar foto / nombre';
  }
}

function openProfileModal() {
  var user = Identity.getCurrentUser();
  if (!user) return;
  state.pendingProfilePhoto = user.photo || null;

  var avatar = $('profileModalAvatar');
  if (avatar) {
    if (user.photo) avatar.innerHTML = '<img src="' + user.photo + '" alt="perfil">';
    else avatar.textContent = (user.name || '?').charAt(0).toUpperCase();
  }
  var nameInp = $('profileModalName');
  if (nameInp) nameInp.value = user.name || '';

  var portRow = $('profileModalPortRow');
  var canChangeRoom = (user.role === CONFIG.ROLES.ADMIN || user.role === CONFIG.ROLES.BALANCE);
  if (portRow) portRow.style.display = canChangeRoom ? '' : 'none';

  if (canChangeRoom) {
    Identity.getAvailableRooms().then(rooms => {
      var sel = $('profileModalPort');
      if (sel) {
        sel.innerHTML = rooms.map(p => '<option value="' + esc(p) + '">' + esc(p) + '</option>').join('');
        sel.value = user.port || rooms[0] || 'El Morro';
      }
    });
  }

  var fileInp = $('profileModalPhoto');
  if (fileInp) fileInp.value = '';
  var overlay = $('profileModal');
  if (overlay) overlay.classList.add('show');
}

function closeProfileModal() {
  var overlay = $('profileModal');
  if (overlay) overlay.classList.remove('show');
  state.pendingProfilePhoto = null;
}

async function onProfilePhotoSelected(event) {
  var file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  var dataUrl = await Identity.compressPhotoFromFile(file);
  if (!dataUrl) return;
  state.pendingProfilePhoto = dataUrl;
  var avatar = $('profileModalAvatar');
  if (avatar) avatar.innerHTML = '<img src="' + dataUrl + '" alt="perfil">';
  toast('📷 Foto lista. Pulsa Guardar.');
}

async function removeProfilePhoto() {
  state.pendingProfilePhoto = null;
  var user = Identity.getCurrentUser();
  var avatar = $('profileModalAvatar');
  if (avatar) avatar.textContent = ((user && user.name) || '?').charAt(0).toUpperCase();
  toast('🗑️ Foto quitada. Pulsa Guardar.');
}

async function saveProfileChanges() {
  var nameInp = $('profileModalName');
  var newName = nameInp ? nameInp.value.trim() : '';
  if (!newName || newName.length < 3) {
    toast('⚠️ El nombre debe tener al menos 3 caracteres');
    if (nameInp) nameInp.focus();
    return;
  }
  var user = Identity.getCurrentUser();
  var updates = { name: newName, photo: state.pendingProfilePhoto };

  var portRow = $('profileModalPortRow');
  var portSel = $('profileModalPort');
  var canChangeRoom = (user.role === CONFIG.ROLES.ADMIN || user.role === CONFIG.ROLES.BALANCE);
  if (canChangeRoom && portRow && portRow.style.display !== 'none' && portSel && portSel.value) {
    var oldPort = user.port;
    var newPort = portSel.value;
    if (oldPort !== newPort) {
      updates.port = newPort;
      await DB.setSyncRoom(CONFIG.portToRoom(newPort));
    }
  }

  var updated = await Identity.updateProfile(updates);
  if (!updated) { toast('⚠️ No se pudo guardar'); return; }

  updateProfileHeader(updated);
  await DB.addAudit({
    action: 'profile_update',
    actor: { id: updated.id, name: updated.name },
    target: { id: updated.id }
  });

  if (updates.port && window.Sync && Sync.isConnected()) {
    try { Sync.stop(); await Sync.start(); } catch (e) {}
    await reloadRecordsFromDB();
    await renderHistory();
  }

  closeProfileModal();
  toast('✅ Perfil actualizado');
}

function bindCIFormat(inputId, prefixId) {
  var inp = $(inputId), pre = $(prefixId);
  if (!inp || !pre) return;
  inp.addEventListener('input', function () {
    var raw = inp.value.replace(/\D/g, '');
    inp.value = pre.value === 'J-' ? raw : formatCI(raw);
  });
  pre.addEventListener('change', function () {
    var raw = inp.value.replace(/\D/g, '');
    inp.value = pre.value === 'J-' ? raw : formatCI(raw);
    if (prefixId === 'f_ciPropPrefijo') {
      var hint = $('ciPropHint');
      if (hint) hint.textContent = pre.value === 'J-' ? 'RIF: sin separación de miles' : 'Cédula: con puntos de mil';
    }
  });
}
function setCI(prefixId, inputId, full) {
  var pre = $(prefixId), inp = $(inputId);
  if (!pre || !inp) return;
  var p = 'V-', num = full || '';
  if (num.indexOf('J-') === 0) { p = 'J-'; num = num.slice(2); }
  else if (num.indexOf('E-') === 0) { p = 'E-'; num = num.slice(2); }
  else if (num.indexOf('V-') === 0) { p = 'V-'; num = num.slice(2); }
  pre.value = p;
  var raw = num.replace(/\D/g, '');
  inp.value = (p === 'J-') ? raw : formatCI(raw);
}
function syncMismoProp() {
  var cb = $('f_mismoProp');
  if (!cb || !cb.checked) return;
  if ($('f_ciPropPrefijo').value === 'J-') { cb.checked = false; toggleMismoProp(); return; }
  $('f_chofer').value = $('f_propietario').value;
  $('f_ciChofPrefijo').value = $('f_ciPropPrefijo').value;
  $('f_ciChofer').value = $('f_ciPropietario').value;
}
function toggleMismoProp() {
  var cb = $('f_mismoProp');
  var checked = cb.checked;
  if (checked && $('f_ciPropPrefijo').value === 'J-') {
    toast('⚠️ Un RIF no puede usarse como C.I. del chofer');
    cb.checked = false; checked = false;
  }
  if (checked) {
    syncMismoProp();
    $('f_chofer').readOnly = true; $('f_ciChofer').readOnly = true; $('f_ciChofPrefijo').disabled = true;
    $('f_chofer').classList.add('readonly-input'); $('f_ciChofer').classList.add('readonly-input'); $('f_ciChofPrefijo').classList.add('readonly-input');
  } else {
    $('f_chofer').readOnly = false; $('f_ciChofer').readOnly = false; $('f_ciChofPrefijo').disabled = false;
    $('f_chofer').classList.remove('readonly-input'); $('f_ciChofer').classList.remove('readonly-input'); $('f_ciChofPrefijo').classList.remove('readonly-input');
  }
}
function checkCGT() {
  var v = $('f_vence').value;
  var alert = $('cgtAlert');
  if (!alert) return;
  if (!v) { alert.className = 'cgt-alert'; return; }
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var exp = new Date(v + 'T00:00:00');
  var diff = Math.ceil((exp - today) / 86400000);
  alert.className = 'cgt-alert show';
  if (diff < 0) {
    alert.classList.add('expired');
    alert.innerHTML = '⚠️ <span>CGT VENCIDO hace ' + Math.abs(diff) + ' día' + (Math.abs(diff) > 1 ? 's' : '') + '.</span>';
  } else if (diff <= 30) {
    alert.classList.add('warning');
    alert.innerHTML = '⏳ <span>CGT vence en ' + diff + ' día' + (diff > 1 ? 's' : '') + '.</span>';
  } else {
    alert.classList.add('ok');
    alert.innerHTML = '✅ <span>CGT vigente.</span>';
  }
}
function fillForm(d) {
  $('f_cajas').value = d.cajas || '';
  $('f_especie').value = d.especie || 'Sardina';
  $('f_presentacion').value = d.presentacion || d.sardina || '';
  $('f_propietario').value = d.propietario || '';
  setCI('f_ciPropPrefijo', 'f_ciPropietario', d.ciPropietario || '');
  $('f_chofer').value = d.chofer || '';
  setCI('f_ciChofPrefijo', 'f_ciChofer', d.ciChofer || '');
  var same = !!(d.chofer && d.propietario && d.chofer === d.propietario && d.ciChofer === d.ciPropietario);
  $('f_mismoProp').checked = same;
  toggleMismoProp();
  $('f_cgt').value = d.cgt || '';
  $('f_vence').value = d.venceCgt || '';
  checkCGT();
  $('f_marca').value = d.marca || '';
  $('f_destino').value = d.destino || '';
  $('f_estado').value = d.estado || '';
  $('f_municipio').value = d.municipio || '';
  $('f_parroquia').value = d.parroquia || '';
  $('f_recibe').value = d.recibe || '';
  $('f_telefono').value = d.telefono || '';
  $('f_origen').value = d.origen || '';
  $('f_productor').value = d.productor || '';
  $('f_observacion').value = d.observacion || '';
}
function clearFormSilent() {
  document.querySelectorAll('#authForm input, #authForm textarea').forEach(function (i) {
    if (i.id !== 'f_fecha' && i.type !== 'checkbox') i.value = '';
  });
  $('f_especie').value = 'Sardina';
  $('f_presentacion').value = '';
  $('f_mismoProp').checked = false;
  $('cgtAlert').className = 'cgt-alert';
}

function renderMarcaSuggestions() {
  var q = $('f_marca').value.trim().toLowerCase();
  var list = $('marcaSuggestions');
  if (!q) { list.classList.remove('show'); list.innerHTML = ''; return; }
  var nq = normalizeText(q);
  var matches = MARCAS_VEHICULOS.filter(function (m) { return normalizeText(m).indexOf(nq) > -1; });
  if (!matches.length) { list.classList.remove('show'); list.innerHTML = ''; return; }
  list.innerHTML = matches.map(function (m) {
    return '<div class="suggestion-item" onmousedown="selectMarca(\'' + m + '\',event)">' + m + '</div>';
  }).join('');
  list.classList.add('show');
}
function selectMarca(m, ev) {
  if (ev) ev.preventDefault();
  $('f_marca').value = m;
  $('marcaSuggestions').classList.remove('show');
}
function renderDestinoSuggestions() {
  var q = $('f_destino').value.trim().toLowerCase();
  var list = $('destinoSuggestions');
  if (!q) { list.classList.remove('show'); list.innerHTML = ''; return; }
  var nq = normalizeText(q);
  var matches = [];
  for (var i = 0; i < EMPRESAS.length; i++) {
    if (normalizeText(EMPRESAS[i].label).indexOf(nq) > -1) matches.push(i);
  }
  if (!matches.length) { list.classList.remove('show'); list.innerHTML = ''; return; }
  list.innerHTML = matches.map(function (i) {
    return '<div class="suggestion-item" data-i="' + i + '" onmousedown="selectEmpresa(' + i + ',event)">' + esc(EMPRESAS[i].label) + '</div>';
  }).join('');
  list.classList.add('show');
}
function selectEmpresa(i, ev) {
  if (ev) ev.preventDefault();
  var e = EMPRESAS[i];
  $('f_destino').value = e.label;
  if (e.estado) $('f_estado').value = e.estado;
  if (e.municipio) $('f_municipio').value = e.municipio;
  if (e.parroquia) $('f_parroquia').value = e.parroquia;
  $('destinoSuggestions').classList.remove('show');
}

function collectForm() {
  var fechaBase = todayStr();
  if (state.editingId) {
    var ex = state.records.find(function (r) { return r.id === state.editingId; });
    if (ex && ex.fecha) fechaBase = ex.fecha;
  }
  return {
    fecha: fechaBase,
    placa: $('f_placa').value.trim().toUpperCase(),
    cajas: $('f_cajas').value.trim(),
    especie: $('f_especie').value,
    presentacion: $('f_presentacion').value,
    propietario: $('f_propietario').value.trim(),
    ciPropietario: $('f_ciPropPrefijo').value + $('f_ciPropietario').value.trim(),
    chofer: $('f_chofer').value.trim(),
    ciChofer: $('f_ciChofPrefijo').value + $('f_ciChofer').value.trim(),
    cgt: $('f_cgt').value.trim(),
    venceCgt: $('f_vence').value,
    marca: $('f_marca').value.trim(),
    destino: $('f_destino').value.trim(),
    estado: $('f_estado').value.trim(),
    municipio: $('f_municipio').value.trim(),
    parroquia: $('f_parroquia').value.trim(),
    recibe: $('f_recibe').value.trim(),
    telefono: $('f_telefono').value.trim(),
    origen: $('f_origen').value.trim(),
    productor: $('f_productor').value.trim(),
    observacion: $('f_observacion').value.trim()
  };
}
function validateForm() {
  var req = [
    ['f_placa', 'la placa'], ['f_cajas', 'las cajas'], ['f_presentacion', 'la presentación'],
    ['f_propietario', 'el propietario'], ['f_ciPropietario', 'la C.I. del propietario'],
    ['f_chofer', 'el chofer'], ['f_ciChofer', 'la C.I. del chofer'],
    ['f_cgt', 'el CGT'], ['f_vence', 'el vencimiento del CGT'],
    ['f_destino', 'el destino'], ['f_origen', 'el origen'], ['f_productor', 'el productor']
  ];
  for (var i = 0; i < req.length; i++) {
    var el = $(req[i][0]);
    if (!el || !el.value.trim()) {
      toast('⚠️ Falta ' + req[i][1]);
      if (el) { el.focus(); el.style.borderColor = '#c0392b';
        (function (elem) { setTimeout(function () { elem.style.borderColor = ''; }, 2000); })(el); }
      return false;
    }
  }
  return true;
}
function validateForWhatsApp() {
  var req = [
    ['f_placa', 'la placa'], ['f_cajas', 'las cajas'], ['f_presentacion', 'la presentación'],
    ['f_marca', 'la marca'], ['f_propietario', 'el propietario'],
    ['f_ciPropietario', 'la C.I./RIF del propietario'], ['f_chofer', 'el chofer'],
    ['f_ciChofer', 'la C.I. del chofer'], ['f_cgt', 'el N° de CGT'],
    ['f_vence', 'el vencimiento del CGT'], ['f_estado', 'el estado'],
    ['f_municipio', 'el municipio'], ['f_parroquia', 'la parroquia'],
    ['f_recibe', 'el nombre de quien recibe'], ['f_telefono', 'el teléfono de quien recibe'],
    ['f_destino', 'el destino'], ['f_origen', 'el origen'], ['f_productor', 'el productor']
  ];
  for (var i = 0; i < req.length; i++) {
    var el = $(req[i][0]);
    if (!el || !el.value.trim()) {
      toast('⚠️ Falta ' + req[i][1] + ' para WhatsApp');
      if (el) { el.focus(); el.style.borderColor = '#c0392b';
        (function (elem) { setTimeout(function () { elem.style.borderColor = ''; }, 2500); })(el); }
      return false;
    }
  }
  return true;
}

async function saveToHistory() {
  if (!validateForm()) return;
  var user = Identity.getCurrentUser();
  if (!user) { toast('⚠️ No hay usuario autenticado'); return; }
  var data = collectForm();
  try {
    var deviceId = await DB.getDeviceId();
    if (state.editingId) {
      var existing = await DB.getRecord(state.editingId);
      if (!existing) { toast('⚠️ Registro no encontrado'); state.editingId = null; return; }
      var updated = Object.assign({}, existing, data, {
        updated_at: Date.now(),
        updated_by: { id: user.id, name: user.name },
        device_id: deviceId
      });
      await DB.putRecord(updated);
      var idx = state.records.findIndex(function (r) { return r.id === state.editingId; });
      if (idx >= 0) state.records[idx] = updated;
      await DB.addAudit({ action: 'update', actor: { id: user.id, name: user.name }, target: { id: updated.id, label: updated.placa } });
      window.dispatchEvent(new CustomEvent('insopesca:record-changed', { detail: updated }));
      state.editingId = null;
      hideEditBanner();
      toast('💾 Actualizado');
    } else {
      var record = Object.assign({}, data, {
        id: generateId(),
        savedAt: new Date().toISOString(),
        device_id: deviceId,
        updated_at: Date.now(),
        deleted: false,
        status: CONFIG.STATUS.PENDIENTE,
        status_changed_at: 0,
        status_changed_by: null,
        observations: '',
        sent_to_balance: false,
        sent_to_balance_at: 0,
        room: user.port || (CONFIG.DEFAULT_PORTS[0] || 'El Morro'),
        created_by: { id: user.id, name: user.name },
        updated_by: { id: user.id, name: user.name }
      });
      await DB.putRecord(record);
      state.records.unshift(record);
      await DB.addAudit({ action: 'create', actor: { id: user.id, name: user.name }, target: { id: record.id, label: record.placa } });
      window.dispatchEvent(new CustomEvent('insopesca:record-changed', { detail: record }));
      toast('💾 Guardado en historial');
    }
    updateBadges();
    await renderHistory();
    if (window.Admin && Admin.refreshDashboard) Admin.refreshDashboard();
    if (window.Balance && Balance.renderList) Balance.renderList();
  } catch (e) {
    console.error('[saveToHistory]', e);
    toast('⚠️ Error al guardar');
  }
}

function startNewForm() {
  state.editingId = null; hideEditBanner(); clearFormSilent();
  $('placaHint').style.display = 'none';
  switchView('form');
}
function cancelEdit() {
  state.editingId = null; hideEditBanner(); clearFormSilent();
  $('placaHint').style.display = 'none';
  switchView('form');
}
function showEditBanner(id, plate) {
  var b = $('editBanner'); var p = $('editBannerPlate');
  if (p) p.textContent = plate || ('#' + id);
  if (b) b.style.display = 'flex';
}
function hideEditBanner() { var b = $('editBanner'); if (b) b.style.display = 'none'; }

function deleteRecord(id) {
  if (!Identity.isAdmin()) { toast('⛔ Solo el administrador puede eliminar'); return; }
  state.pendingDeleteId = id;
  var m = $('deleteModal'); if (m) m.classList.add('show');
}
function hideDeleteModal() {
  var m = $('deleteModal'); if (m) m.classList.remove('show');
  state.pendingDeleteId = null;
}
async function doDeleteLocal() {
  var id = state.pendingDeleteId; if (!id) return;
  try {
    await DB.softDeleteLocal(id);
    state.records = state.records.filter(function (r) { return r.id !== id; });
    var user = Identity.getCurrentUser();
    await DB.addAudit({ action: 'delete_local', actor: { id: user.id, name: user.name }, target: { id: id } });
    hideDeleteModal(); updateBadges(); await renderHistory();
    if (window.Admin && Admin.refreshDashboard) Admin.refreshDashboard();
    if (window.Balance && Balance.renderList) Balance.renderList();
    toast('👁️ Oculto localmente');
  } catch (e) { console.error('[doDeleteLocal]', e); toast('⚠️ Error'); }
}
async function doDeleteGlobal() {
  var id = state.pendingDeleteId; if (!id) return;
  if (!confirm('¿Borrar para TODOS los dispositivos? Esta acción es irreversible.')) return;
  try {
    var user = Identity.getCurrentUser();
    await DB.softDeleteGlobal(id, { id: user.id, name: user.name });
    state.records = state.records.filter(function (r) { return r.id !== id; });
    await DB.addAudit({ action: 'delete_global', actor: { id: user.id, name: user.name }, target: { id: id } });
    var tombstone = await DB.getRecord(id);
    if (tombstone) window.dispatchEvent(new CustomEvent('insopesca:record-changed', { detail: tombstone }));
    hideDeleteModal(); updateBadges(); await renderHistory();
    if (window.Admin && Admin.refreshDashboard) Admin.refreshDashboard();
    if (window.Balance && Balance.renderList) Balance.renderList();
    toast('🗑️ Borrado general aplicado');
  } catch (e) { console.error('[doDeleteGlobal]', e); toast('⚠️ Error'); }
}

function buildMessage(d) {
  var L = [
    ['*Solicitud de Autorización*', ''],
    ['Fecha', d.fecha], ['Placa', d.placa], ['Cajas', d.cajas],
    ['Especie', d.especie || 'Sardina'], ['Presentación', d.presentacion || d.sardina || ''],
    ['Propietario', d.propietario], ['C.I.', d.ciPropietario],
    ['Chofer', d.chofer], ['C.I.', d.ciChofer],
    ['CGT', d.cgt], ['Vence CGT', fmtDate(d.venceCgt)], ['Marca', d.marca],
    ['Destino', d.destino], ['Estado', d.estado], ['Municipio', d.municipio],
    ['Parroquia', d.parroquia], ['Recibe', d.recibe], ['Teléfono', d.telefono],
    ['Origen', d.origen], ['Productor', d.productor]
  ];
  if (d.observacion && d.observacion.trim()) L.push(['Observación', d.observacion]);
  if (d.observations && d.observations.trim()) L.push(['Observación Balance', d.observations]);
  if (d.status) L.push(['Estado solicitud', d.status]);
  if (d.room) L.push(['Sala', d.room]);
  var m = '';
  for (var i = 0; i < L.length; i++) {
    if (i === 0) { m += L[i][0] + NL + NL; continue; }
    m += PIN + ' *' + L[i][0] + ':* ' + L[i][1];
    if (i < L.length - 1) m += NL;
  }
  return m;
}
function sendWhatsApp() {
  if (!validateForWhatsApp()) return;
  var data = collectForm();
  window.open('https://wa.me/?text=' + encodeURIComponent(buildMessage(data)), '_blank');
}

async function pasteData() {
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      toast('⚠️ Tu navegador no permite leer el portapapeles'); return;
    }
    var text = await navigator.clipboard.readText();
    if (!text || !text.trim()) { toast('📋 El portapapeles está vacío'); return; }
    fillFromText(text);
  } catch (e) { toast('⚠️ Permite el acceso al portapapeles e intenta de nuevo'); }
}
function parseDateValue(v) {
  if (!v) return '';
  v = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  var m = v.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    var dd = m[1].padStart(2, '0'), mm = m[2].padStart(2, '0'), yyyy = m[3];
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    return yyyy + '-' + mm + '-' + dd;
  }
  return '';
}
function applyCIValue(prefixId, inputId, value) {
  var pre = $(prefixId), inp = $(inputId);
  var str = String(value || '').trim().toUpperCase();
  var prefix = 'V-';
  if (str.charAt(0) === 'J') { prefix = 'J-'; str = str.slice(1).replace(/^[\-\s\.]+/, ''); }
  else if (str.charAt(0) === 'E') { prefix = 'E-'; str = str.slice(1).replace(/^[\-\s\.]+/, ''); }
  else if (str.charAt(0) === 'V') { prefix = 'V-'; str = str.slice(1).replace(/^[\-\s\.]+/, ''); }
  var clean = str.replace(/[^0-9A-Z]/gi, '');
  pre.value = prefix;
  inp.value = (prefix === 'J-') ? clean : formatCI(clean);
}
function parseCGTText(rawText) {
  var data = {};
  var text = rawText.replace(/\s+/g, ' ').trim();
  var placaMatch = text.match(/(?:Placa[\/\s]*Matr[íi]cula|Placa)[:\s]*([A-Z0-9]{5,10})/i);
  if (placaMatch) data.placa = placaMatch[1].toUpperCase();
  var marcaMatch = text.match(/Marca[:\s]*([A-Za-z0-9\s\-\.]+?)(?=\s*Modelo|\s*Tipo|\s*Serial|\s*Capacidad|\s*Año|\s*$)/i);
  if (marcaMatch) data.marca = marcaMatch[1].trim();
  var cgtMatch = text.match(/(?:CGT|C\.G\.T\.?)[:\s]*([A-Z0-9]{8,20})/i);
  if (cgtMatch) data.cgt = cgtMatch[1].replace(/CGT/i, '').trim();
  else {
    var fb = text.match(/\b(CGT[0-9]{10,15})\b/i);
    if (fb) data.cgt = fb[1].replace(/CGT/i, '').trim();
  }
  var venceMatch = text.match(/(?:Fecha\s*De\s*Vencimiento|Vencimiento)[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
  if (venceMatch) data.venceCgt = venceMatch[1];
  var propMatch = text.match(/Nombre\s*y\s*apellido[s]?[:\s]*(.*?)(?=\s*Tipo\s*de\s*documento|\s*N[°o]\s*de\s*documento|\s*$)/i);
  if (propMatch) data.propietario = propMatch[1].trim();
  var tipoDoc = text.match(/Tipo\s*de\s*documento[:\s]*([VEJ])/i);
  var numDoc = text.match(/N[°o]\s*de\s*documento[:\s]*([0-9\.]+)/i);
  if (tipoDoc && numDoc) data.ciPropietario = tipoDoc[1].toUpperCase() + '-' + numDoc[1].replace(/[\.\s]/g, '');
  else if (numDoc) data.ciPropietario = 'J-' + numDoc[1].replace(/[\.\s]/g, '');
  else {
    var rifMatch = text.match(/\b([VEJ])[-\s]*([0-9]{7,9})\b/i);
    if (rifMatch) data.ciPropietario = rifMatch[1].toUpperCase() + '-' + rifMatch[2];
  }
  return data;
}
function parsePastedText(text) {
  var data = {}, context = null;
  var lines = String(text || '').split(/\r?\n/);
  var labelMap = {
    'placa':'placa','placa del vehiculo':'placa','numero de placa':'placa',
    'cajas':'cajas','cantidad de cajas':'cajas','numero de cajas':'cajas','n cajas':'cajas','num cajas':'cajas','cant cajas':'cajas',
    'especie':'especie','tipo de pescado':'especie','pescado':'especie',
    'presentacion':'presentacion','presentacion del producto':'presentacion','corte':'presentacion',
    'propietario':'propietario','nombre del propietario':'propietario',
    'chofer':'chofer','conductor':'chofer','nombre del chofer':'chofer','nombre del conductor':'chofer',
    'cgt':'cgt','n cgt':'cgt','n de cgt':'cgt','num cgt':'cgt','numero cgt':'cgt','numero de cgt':'cgt','cgt n':'cgt',
    'vence cgt':'venceCgt','vence':'venceCgt','vencimiento':'venceCgt','vencimiento cgt':'venceCgt','fecha de vencimiento':'venceCgt','fecha de vencimiento cgt':'venceCgt',
    'marca':'marca','marca del vehiculo':'marca',
    'destino':'destino','empresa destino':'destino',
    'estado':'estado','municipio':'municipio','parroquia':'parroquia',
    'recibe':'recibe','quien recibe':'recibe','nombre de quien recibe':'recibe','receptor':'recibe',
    'telefono':'telefono','tlf':'telefono','tel':'telefono','celular':'telefono','numero de telefono':'telefono',
    'origen':'origen','puerto':'origen','productor':'productor','maquina':'productor','picadora':'productor',
    'observacion':'observacion','observaciones':'observacion','nota':'observacion','notas':'observacion'
  };
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]; var c = line.indexOf(':'); if (c === -1) continue;
    var labelRaw = line.slice(0, c);
    var value = line.slice(c + 1).replace(/\*/g, '').trim();
    if (!value) continue;
    var label = labelRaw.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!label) continue;
    var isCI = /^(c\s*i|cedula|rif|documento)\b/.test(label);
    var isProp = /propietario/.test(label);
    var isChof = /chofer|conductor/.test(label);
    if (isCI) {
      if (isProp) data.ciPropietario = value;
      else if (isChof) data.ciChofer = value;
      else if (context === 'propietario') data.ciPropietario = value;
      else if (context === 'chofer') data.ciChofer = value;
      else { if (!data.ciPropietario) data.ciPropietario = value; else if (!data.ciChofer) data.ciChofer = value; }
      continue;
    }
    if (isProp) { data.propietario = value; context = 'propietario'; continue; }
    if (isChof) { data.chofer = value; context = 'chofer'; continue; }
    var field = labelMap[label];
    if (!field) {
      var keys = Object.keys(labelMap);
      for (var k = 0; k < keys.length; k++) { if (label.indexOf(keys[k]) > -1) { field = labelMap[keys[k]]; break; } }
    }
    if (field) { if (field === 'cgt') value = value.replace(/CGT/gi, '').trim(); if (!data[field]) data[field] = value; }
  }
  return data;
}
function fillFromText(text) {
  text = text || '';
  var genericData = parsePastedText(text);
  var cgtData = parseCGTText(text);
  var isCGTDocument = /CERTIFICADO GENERAL DE TRANSPORTE/i.test(text) || /CGT[:\s]*\d{8,}/i.test(text) || Object.keys(cgtData).length > 0;
  var data = isCGTDocument ? Object.assign({}, cgtData) : genericData;

  if (!Object.keys(data).length || Object.values(data).every(function (v) { return !v; })) {
    toast('⚠️ No se reconoció información válida'); return;
  }
  startNewForm();
  $('f_ciPropPrefijo').value = 'V-';
  $('f_ciChofPrefijo').value = 'V-';
  var filled = 0;
  if (data.placa) { $('f_placa').value = data.placa.toUpperCase(); filled++; }
  if (data.cajas) { var cz = String(data.cajas).replace(/[^0-9]/g, ''); if (cz) { $('f_cajas').value = cz; filled++; } }
  if (data.especie) {
    var esp = normalizeText(data.especie);
    if (esp.indexOf('machuelo') > -1) { $('f_especie').value = 'Machuelo'; filled++; }
    else if (esp.indexOf('sardina') > -1) { $('f_especie').value = 'Sardina'; filled++; }
  }
  if (data.presentacion) {
    var pres = normalizeText(data.presentacion);
    var sel = $('f_presentacion');
    for (var si = 0; si < sel.options.length; si++) {
      var optN = normalizeText(sel.options[si].value);
      if (optN && pres.indexOf(optN) > -1) { sel.selectedIndex = si; filled++; break; }
    }
  }
  if (data.propietario) { $('f_propietario').value = data.propietario; filled++; }
  if (data.ciPropietario) { applyCIValue('f_ciPropPrefijo', 'f_ciPropietario', data.ciPropietario); filled++; }
  if (data.chofer) { $('f_chofer').value = data.chofer; filled++; }
  if (data.ciChofer) { applyCIValue('f_ciChofPrefijo', 'f_ciChofer', data.ciChofer); filled++; }
  if (data.cgt) { $('f_cgt').value = String(data.cgt).replace(/CGT/gi, '').trim(); filled++; }
  if (data.venceCgt) { var iso = parseDateValue(data.venceCgt); if (iso) { $('f_vence').value = iso; filled++; } }
  if (data.marca) { $('f_marca').value = data.marca; filled++; }
  if (!isCGTDocument) {
    if (data.destino) { $('f_destino').value = data.destino; filled++; }
    if (data.estado) { $('f_estado').value = data.estado; filled++; }
    if (data.municipio) { $('f_municipio').value = data.municipio; filled++; }
    if (data.parroquia) { $('f_parroquia').value = data.parroquia; filled++; }
    if (data.recibe) { $('f_recibe').value = data.recibe; filled++; }
    if (data.telefono) { $('f_telefono').value = data.telefono; filled++; }
    if (data.origen) { $('f_origen').value = data.origen; filled++; }
    if (data.productor) { $('f_productor').value = data.productor; filled++; }
    if (data.observacion) { $('f_observacion').value = data.observacion; filled++; }
  }
  checkCGT();
  var same = !!($('f_propietario').value && $('f_chofer').value &&
    $('f_propietario').value === $('f_chofer').value &&
    $('f_ciPropietario').value === $('f_ciChofer').value &&
    $('f_ciPropPrefijo').value === $('f_ciChofPrefijo').value &&
    $('f_ciPropPrefijo').value !== 'J-');
  $('f_mismoProp').checked = same;
  toggleMismoProp();
  if (filled > 0) toast('✓ ' + filled + ' campo' + (filled > 1 ? 's' : '') + ' rellenado' + (filled > 1 ? 's' : ''));
  else toast('⚠️ No se reconoció información válida');
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.filter-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.f === f); });
  var labels = { placa: 'Buscar por placa…', destino: 'Buscar por destino…', chofer: 'Buscar por chofer…' };
  $('searchInput').placeholder = labels[f];
  $('searchInput').value = '';
  renderHistory();
}
function clearDateFilter() {
  var from = $('histFrom'); var to = $('histTo');
  if (from) from.value = ''; if (to) to.value = '';
  renderHistory();
}

function statusBadge(status) {
  var map = {
    pendiente: { label: '⏳ Pendiente', cls: 'status-pending' },
    aprobada:  { label: '✅ Aprobada',  cls: 'status-approved' },
    rechazada: { label: '❌ Rechazada', cls: 'status-rejected' }
  };
  var v = map[status] || map.pendiente;
  return '<span class="status-badge ' + v.cls + '">' + v.label + '</span>';
}

async function renderHistory() {
  var qRaw = ($('searchInput') ? $('searchInput').value : '').trim();
  var q = normalizeText(qRaw);
  var from = $('histFrom') ? $('histFrom').value : '';
  var to = $('histTo') ? $('histTo').value : '';
  var all = getHistory();
  var currentUser = Identity.getCurrentUser();
  var currentRoom = currentUser ? currentUser.port : null;

  var filtered = all.filter(function (h) {
    if (currentRoom && h.room && h.room !== currentRoom) return false;
    if (from || to) {
      var day = getRecordLocalISO(h);
      if (!day) return false;
      if (from && day < from) return false;
      if (to && day > to) return false;
    }
    if (q) {
      var val = normalizeText(h[currentFilter] || '');
      if (val.indexOf(q) === -1) return false;
    }
    return true;
  });

  $('resultsCount').innerHTML = '<span class="room-indicator">📍 ' + esc(currentRoom || '—') + '</span> · ' +
    filtered.length + ' registro' + (filtered.length !== 1 ? 's' : '') +
    ((qRaw || from || to) ? ' encontrado' + (filtered.length !== 1 ? 's' : '') : ' en total');

  var list = $('historyList');
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><div class="big">🗂️</div><div style="font-weight:700">Sin registros</div><div style="font-size:.78rem;margin-top:4px">' +
      ((qRaw || from || to) ? 'No hay coincidencias' : 'Guarde su primera solicitud') + '</div></div>';
    return;
  }
  var isAdmin = Identity.isAdmin();
  var unseenMap = {};
  if (window.Balance) {
    await Promise.all(filtered.map(async function (h) { unseenMap[h.id] = await Balance.hasUnseenStatus(h); }));
  }
  var items = filtered.map(function (h) {
    var esp = h.especie || 'Sardina';
    var pres = h.presentacion || h.sardina || '';
    var author = h.created_by && h.created_by.name ? h.created_by.name : 'Sin identificar';
    var edited = h.updated_by && h.created_by && h.updated_by.id !== h.created_by.id
      ? ' · editado por ' + esc(h.updated_by.name) : '';
    var delBtn = isAdmin ? '<button class="hbtn hbtn-del" onclick="deleteRecord(' + h.id + ')">🗑️</button>' : '';
    var badge = statusBadge(h.status);
    var newBadge = unseenMap[h.id] ? '<span class="status-badge status-new">🔔 NUEVA</span>' : '';
    var sentBadge = h.sent_to_balance ? '<span class="status-badge status-sent">📤 Enviada</span>' : '';
    return '<div class="history-item">' +
      '<div class="history-header">' +
        '<div><div class="history-plate">🚗 ' + esc(h.placa) + '</div>' +
          '<div style="font-size:.75rem;color:var(--text-light);margin-top:2px">' + esc(h.chofer) + '</div></div>' +
        '<div class="history-date">' + fmtDate(h.savedAt ? h.savedAt.slice(0, 10) : '') + '</div>' +
      '</div>' +
      '<div class="status-row">' + badge + sentBadge + newBadge + '</div>' +
      '<div class="history-meta">📍 <strong>' + esc(h.destino) + '</strong><br>🐟 ' + esc(esp + (pres ? ' ' + pres : '')) + ' · ' + esc(h.cajas) + ' cajas · Origen: ' + esc(h.origen) + '</div>' +
      '<div class="record-author">👤 <strong>' + esc(author) + '</strong>' + edited + '</div>' +
      '<div class="history-actions">' +
        '<button class="hbtn hbtn-view" onclick="viewRecord(' + h.id + ')">👁️ Ver</button>' +
        '<button class="hbtn hbtn-edit" onclick="editRecord(' + h.id + ')">✏️ Editar</button>' +
        '<button class="hbtn hbtn-new" onclick="newFromRecord(' + h.id + ')">📄 Nueva</button>' +
        delBtn +
      '</div></div>';
  });
  list.innerHTML = items.join('');
}

async function viewRecord(id) {
  var h = getHistory().find(function (x) { return x.id === id; });
  if (!h) return;
  if (window.Balance) await Balance.markStatusSeen(id);

  var user = Identity.getCurrentUser();
  var isMine = user && h.created_by && h.created_by.id === user.id;
  var canBalance = canManageBalance();

  var fields = [
    ['Fecha', h.fecha], ['Placa', h.placa], ['Cajas', h.cajas],
    ['Especie', h.especie || 'Sardina'], ['Presentación', h.presentacion || h.sardina || ''],
    ['Propietario', h.propietario], ['C.I. Propietario', h.ciPropietario],
    ['Chofer', h.chofer], ['C.I. Chofer', h.ciChofer],
    ['CGT', h.cgt], ['Vence CGT', fmtDate(h.venceCgt)], ['Marca', h.marca],
    ['Destino', h.destino], ['Estado', h.estado], ['Municipio', h.municipio],
    ['Parroquia', h.parroquia], ['Recibe', h.recibe], ['Teléfono', h.telefono],
    ['Origen', h.origen], ['Productor', h.productor],
    ['Sala', h.room || '—'],
    ['Estado solicitud', h.status || 'pendiente']
  ];
  var html = '<div class="detail-grid">';
  fields.forEach(function (f) {
    html += '<div class="detail-item"><div class="detail-label">' + f[0] + '</div><div class="detail-value">' + esc(f[1]) + '</div></div>';
  });
  html += '<div class="detail-item full"><div class="detail-label">Observación</div><div class="detail-value">' + esc(h.observacion) + '</div></div>';
  var author = h.created_by && h.created_by.name ? h.created_by.name : 'Sin identificar';
  html += '<div class="detail-item full"><div class="detail-label">Creado por</div><div class="detail-value">' + esc(author) + '</div></div>';
  if (h.updated_by && h.created_by && h.updated_by.id !== h.created_by.id) {
    html += '<div class="detail-item full"><div class="detail-label">Última edición por</div><div class="detail-value">' + esc(h.updated_by.name) + '</div></div>';
  }
  if (h.observations) {
    html += '<div class="detail-item full"><div class="detail-label">Observaciones del Balance</div><div class="detail-value">' + esc(h.observations) + '</div></div>';
  }
  if (h.status_changed_by) {
    html += '<div class="detail-item full"><div class="detail-label">Estado cambiado por</div><div class="detail-value">' +
      esc(h.status_changed_by.name) + (h.status_changed_at ? ' · ' + new Date(h.status_changed_at).toLocaleString('es-VE') : '') +
      '</div></div>';
  }
  html += '</div>';
  html += '<div class="detail-actions">';
  html += '<button class="btn btn-whatsapp btn-sm" onclick="sendRecordWA(' + h.id + ')">📱 WhatsApp</button>';
  if (isMine && !h.sent_to_balance && (h.status || 'pendiente') === 'pendiente') {
    html += '<button class="btn btn-primary btn-sm" onclick="sendToBalanceAction(' + h.id + ')">📤 Enviar al Balance</button>';
  }
  if (canBalance) {
    html += '<button class="btn btn-approve btn-sm" onclick="approveFromDetail(' + h.id + ')">✅ Aprobar</button>';
    html += '<button class="btn btn-reject btn-sm" onclick="rejectFromDetail(' + h.id + ')">❌ Rechazar</button>';
    html += '<button class="btn btn-pending btn-sm" onclick="pendingFromDetail(' + h.id + ')">⏳ Pendiente</button>';
  }
  html += '<button class="btn btn-secondary btn-sm" onclick="closeModal()">Cerrar</button>';
  html += '</div>';

  $('modalBody').innerHTML = html;
  $('modalTitle').textContent = '📋 ' + h.placa;
  $('modalOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('modalOverlay').classList.remove('show');
  document.body.style.overflow = '';
}
async function sendToBalanceAction(id) { closeModal(); if (window.Balance) await Balance.sendToBalance(id); }
function approveFromDetail(id) { closeModal(); if (window.Balance) Balance.openChange(id, 'aprobada'); }
function rejectFromDetail(id) { closeModal(); if (window.Balance) Balance.openChange(id, 'rechazada'); }
function pendingFromDetail(id) { closeModal(); if (window.Balance) Balance.openChange(id, 'pendiente'); }

function editRecord(id) {
  var h = getHistory().find(function (x) { return x.id === id; });
  if (!h) return;
  switchView('form');
  state.editingId = id;
  clearFormSilent(); fillForm(h);
  showEditBanner(id, h.placa);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function newFromRecord(id) {
  var h = getHistory().find(function (x) { return x.id === id; });
  if (!h) return;
  switchView('form');
  state.editingId = null; hideEditBanner(); clearFormSilent();
  $('f_placa').value = h.placa; fillForm(h);
  $('placaHint').style.display = 'block';
  toast('📄 Nueva solicitud basada en ' + h.placa);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function sendRecordWA(id) {
  var h = getHistory().find(function (x) { return x.id === id; });
  if (!h) return;
  window.open('https://wa.me/?text=' + encodeURIComponent(buildMessage(h)), '_blank');
}

async function switchView(v) {
  var isForm = v === 'form';
  var isHistory = v === 'history';
  var isAdmin = v === 'admin';
  var isBalance = v === 'balance';
  $('viewForm').classList.toggle('hidden', !isForm);
  $('viewHistory').classList.toggle('hidden', !isHistory);
  $('viewAdmin').classList.toggle('hidden', !isAdmin);
  if ($('viewBalance')) $('viewBalance').classList.toggle('hidden', !isBalance);
  $('tabForm').classList.toggle('active', isForm);
  $('tabHistory').classList.toggle('active', isHistory);
  if ($('tabAdmin')) $('tabAdmin').classList.toggle('active', isAdmin);
  if ($('tabBalance')) $('tabBalance').classList.toggle('active', isBalance);
  if ($('navForm')) $('navForm').classList.toggle('active', isForm);
  if ($('navHistory')) $('navHistory').classList.toggle('active', isHistory);
  if (isHistory) await renderHistory();
  if (isAdmin && window.Admin) Admin.mount('adminPanelContainer').catch(function (e) { console.error(e); });
  if (isBalance && window.Balance) Balance.mount('balancePanelContainer').catch(function (e) { console.error(e); });
  window.scrollTo({ top: 0 });
}

function bindStaticEvents() {
  if (staticEventsBound) return;
  staticEventsBound = true;

  var placa = $('f_placa');
  if (placa) {
    placa.addEventListener('input', function (e) { e.target.value = e.target.value.toUpperCase(); });
    placa.addEventListener('input', function () {
      var val = this.value.trim().toUpperCase();
      var hint = $('placaHint');
      if (val.length < 3) { hint.style.display = 'none'; return; }
      var match = getHistory().find(function (h) { return h.placa === val; });
      if (match && !state.editingId) { fillForm(match); hint.style.display = 'block'; toast('✓ Datos cargados de: ' + val); }
      else hint.style.display = 'none';
    });
  }
  var vence = $('f_vence'); if (vence) vence.addEventListener('change', checkCGT);
  var marca = $('f_marca');
  if (marca) {
    marca.addEventListener('input', renderMarcaSuggestions);
    marca.addEventListener('blur', function () { setTimeout(function () { $('marcaSuggestions').classList.remove('show'); }, 180); });
  }
  var destino = $('f_destino');
  if (destino) {
    destino.addEventListener('input', renderDestinoSuggestions);
    destino.addEventListener('blur', function () { setTimeout(function () { $('destinoSuggestions').classList.remove('show'); }, 180); });
  }
  var prop = $('f_propietario'), ciProp = $('f_ciPropietario'), preProp = $('f_ciPropPrefijo');
  if (prop) prop.addEventListener('input', syncMismoProp);
  if (ciProp) ciProp.addEventListener('input', syncMismoProp);
  if (preProp) preProp.addEventListener('change', syncMismoProp);
  bindCIFormat('f_ciPropietario', 'f_ciPropPrefijo');
  bindCIFormat('f_ciChofer', 'f_ciChofPrefijo');

  var avatar = $('profilePhoto');
  if (avatar) {
    avatar.style.cursor = 'pointer';
    avatar.addEventListener('click', openProfileModal);
  }
  if ($('profileModalSave')) $('profileModalSave').addEventListener('click', saveProfileChanges);
  if ($('profileModalCancel')) $('profileModalCancel').addEventListener('click', closeProfileModal);
  if ($('profileModalPhoto')) $('profileModalPhoto').addEventListener('change', onProfilePhotoSelected);
  if ($('profileModalRemovePhoto')) $('profileModalRemovePhoto').addEventListener('click', removeProfilePhoto);
  var profileOverlay = $('profileModal');
  if (profileOverlay) {
    profileOverlay.addEventListener('click', function (e) {
      if (e.target === profileOverlay) closeProfileModal();
    });
  }
}

async function bootAfterIdentity(user) {
  updateProfileHeader(user);
  var adminTab = $('tabAdmin');
  if (adminTab) adminTab.style.display = user.role === CONFIG.ROLES.ADMIN ? '' : 'none';
  var balanceTab = $('tabBalance');
  if (balanceTab) {
    balanceTab.style.display = (user.role === CONFIG.ROLES.BALANCE || user.role === CONFIG.ROLES.ADMIN) ? '' : 'none';
  }
  $('f_fecha').value = todayStr();
  bindStaticEvents();
  try {
    await DB.getDeviceId();
    await DB.setSyncRoom(CONFIG.portToRoom(user.port));

    var mig = await DB.migrateFromLocalStorage();
    if (mig.migrated > 0) toast('✓ ' + mig.migrated + ' registro(s) migrado(s)');
    await reloadRecordsFromDB();
    await migrateHistory();
    await reloadRecordsFromDB();
    state.loaded = true;
    updateBadges();
    await renderHistory();

    if (window.Balance) {
      try { await Balance.ensureNotificationPermission(); } catch (e) {}
    }
    if (window.Backup) {
      try { await Backup.init(); } catch (e) { console.warn('[boot] Backup.init', e); }
    }
    if (window.Sync && CONFIG.SYNC_ENABLED) {
      try {
        await Sync.start();
        if (Sync.isConnected()) console.log('[boot] Sync conectado · sala:', Sync.getRoomName());
      } catch (e) { console.warn('[boot] Sync no pudo iniciar:', e); }
    }
  } catch (e) {
    console.error('[bootAfterIdentity]', e);
    toast('⚠️ Error al cargar datos');
  }
}

document.addEventListener('DOMContentLoaded', function () {
  $('f_fecha').value = todayStr();
  Identity.onAuthorized = function (user) { bootAfterIdentity(user); };
  Identity.setupUI();
  Identity.init().catch(function (e) {
    console.error('[Identity.init]', e);
    toast('⚠️ Error al iniciar sesión local');
  });
});