# Insopesca El Morro — Solicitud de Autorización de Transporte

App web **local-first** para registrar solicitudes de autorización de transporte de carga. Funciona 100% offline, sincroniza entre dispositivos vía P2P y se instala como PWA. Sin servidores ni bases de datos externas.

**Autor:** Emmanuel Manosalva · **Versión:** 1.9.1

---

## 📋 Características

- ✅ Formulario completo con autocompletado, validaciones y detección de CGT vencido.
- ✅ Historial con búsqueda por placa / destino / chofer y filtro por fecha.
- ✅ Roles: administrador, operador y Centro de Balance.
- ✅ Autorización por WhatsApp: cada nuevo usuario envía su ID al admin.
- ✅ Suspender / reactivar / eliminar usuarios desde el panel de admin.
- ✅ Centro de Balance: aprobar / rechazar solicitudes, con observaciones.
- ✅ Notificaciones locales cuando cambia el estado de una solicitud propia.
- ✅ Sincronización P2P automática entre dispositivos conectados al mismo tiempo.
- ✅ Respaldos automáticos en IndexedDB (últimos 5) con exportación manual.
- ✅ Exportación a PDF y Excel del historial y de la auditoría.
- ✅ Indicador de almacenamiento en vivo en el panel de admin.
- ✅ Offline real tras la primera carga.

---

## 📁 Estructura

📁 raíz
📄 index.html          → Interfaz principal
📄 manifest.json       → PWA manifest
📄 users.json          → Lista de usuarios autorizados (tú la editas)
📄 sw.js               → Service Worker (offline)
📄 README.md           → Este archivo
📁 js
📄 config.js           → Constantes globales
📄 db.js               → Capa IndexedDB
📄 identity.js         → Registro, autorización, perfil
📄 admin.js            → Panel de administración
📄 balance.js          → Centro de Balance
📄 backup.js           → Respaldos automáticos
📄 sync.js             → Sincronización P2P
📄 app.js              → Lógica principal

