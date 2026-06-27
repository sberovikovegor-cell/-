// УСТАРЕЛО — не используется. Синхронизация через telegram-config.js + TELEGRAM_СИНХРОНИЗАЦИЯ.md
// Один раз настрой Firebase (см. СИНХРОНИЗАЦИЯ_СЕМЬИ.md), затем enabled: true
window.FAMILY_SYNC_CONFIG = {
  enabled: false,
  firebase: {
    apiKey: "ВАШ_API_KEY",
    authDomain: "ВАШ_PROJECT.firebaseapp.com",
    projectId: "ВАШ_PROJECT_ID",
    storageBucket: "ВАШ_PROJECT.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123",
  },
};
