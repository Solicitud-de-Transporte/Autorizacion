# Insopesca El Morro — Solicitud de Autorización de Transporte

App web **local-first** para registrar solicitudes de autorización de transporte. 100% offline, sincroniza entre dispositivos vía P2P, instalable como PWA/APK. Sin servidores.

**Autor:** Emmanuel Manosalva · **Versión:** 2.0.0

---

## 📋 Características

- Formulario completo con autocompletado, validaciones y detección de CGT vencido.
- Historial con búsqueda por placa / destino / chofer, filtro de fecha exacto y filtro por sala.
- Roles: administrador, operador y Centro de Balance.
- Autorización por WhatsApp.
- Suspender / reactivar / eliminar usuarios desde el panel de admin.
- **Multi-puerto con salas**: El Morro, Guaca, La Esmeralda (Admin puede crear más).
- Centro de Balance con aprobación/rechazo y observaciones.
- Notificaciones locales.
- Sincronización P2P automática.
- Respaldos automáticos (últimos 5) + exportación manual.
- Exportación a PDF / Excel (historial y auditoría).
- Indicador de almacenamiento en vivo.
- **Instalable como APK** (standalone).
- Offline real tras la primera carga.

---

## 📁 Estructura

- 📁 raíz
- 📄 index.html          → Interfaz principal
- 📄 manifest.json       → PWA manifest
- 📄 users.json          → Lista de usuarios autorizados (tú la editas)
- 📄 sw.js               → Service Worker (offline)
- 📄 README.md           → Este archivo
- 📁 js
- 📄 config.js           → Constantes globales
- 📄 db.js               → Capa IndexedDB
- 📄 identity.js         → Registro, autorización, perfil
- 📄 rooms.js      ← NUEVO
- 📄 admin.js            → Panel de administración
- 📄 balance.js          → Centro de Balance
- 📄 backup.js           → Respaldos automáticos
- 📄 sync.js             → Sincronización P2P
- 📄 app.js              → Lógica principal

