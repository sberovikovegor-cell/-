// Токен sync-бота и канал (бот должен быть админом канала)
window.FAMILY_TELEGRAM_CONFIG = {
  enabled: true,
  botToken: "8953030903:AAFdn4uwN2zJHM3e3Qbpqp6lpvqddZL-76M",
  chatId: "-1004291671029",
  familyCode: "12312312",
  syncSecret: "123123123",
  // Смена номера = полная очистка старых тестовых данных (ver. 81+)
  dataEpoch: 81,
  // Если на телефоне блокируют api.telegram.org — укажите прокси (ПК run_app.py:8080 в одной Wi‑Fi):
  // telegramApiBase: "http://192.168.1.100:8080/tg-proxy/api",
};
