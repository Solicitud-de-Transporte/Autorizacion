/* ============================================================
   Configuración global - Insopesca El Morro
   v1.9.1
   ============================================================ */

window.CONFIG = Object.freeze({

  APP_NAME:       'Insopesca El Morro',
  APP_VERSION:    '1.9.1',
  STORAGE_PREFIX: 'insopesca_',

  ADMIN_WHATSAPP: '+584262840546',
  ADMIN_ID:       '4M4N3C3R',
  USERS_FILE:     './users.json',

  ROLES: {
    ADMIN:    'admin',
    BALANCE:  'balance',
    OPERADOR: 'operador'
  },

  STATUS: {
    PENDIENTE: 'pendiente',
    APROBADA:  'aprobada',
    RECHAZADA: 'rechazada'
  },

  PROFILE_PHOTO_MAX_DIM:   200,
  PROFILE_PHOTO_QUALITY:   0.7,
  PROFILE_PHOTO_MAX_BYTES: 60 * 1024,

  USERS_CACHE_TTL: 5 * 60 * 1000,

  SYNC_ENABLED:  true,
  SYNC_ROOM:     'insopesca-puerto-el-morro-v1',
  SYNC_META_KEY: 'sync_room',

  MULTI_PORT_ENABLED: false,
  DEFAULT_PORT_NAME:  'El Morro',
  AVAILABLE_PORTS: [
    'El Morro'
  ],

  NOTIFICATIONS_ENABLED: true,
  NOTIF_ICON: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect width="100" height="100" rx="20" fill="%230d3b66"/%3E%3Ctext x="50" y="68" font-size="52" text-anchor="middle"%3E🐟%3C/text%3E%3C/svg%3E',

  BACKUP_ENABLED:    true,
  BACKUP_MAX_COUNT:  5,
  BACKUP_DEBOUNCE_MS: 5000,
  BACKUP_INTERVAL_MS: 24 * 60 * 60 * 1000,
  BACKUP_AUDIT_LIMIT: 100,

  EXPORT: {
    PDF_LIBS: [
      'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
      'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'
    ],
    XLSX_LIB: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    PDF_FILENAME_PREFIX:   'insopesca_solicitudes_',
    EXCEL_FILENAME_PREFIX: 'insopesca_solicitudes_'
  },

  AUDIT_MAX_ENTRIES: 500,

  ISO_DATE_RE: /^\d{4}-\d{2}-\d{2}$/
});
