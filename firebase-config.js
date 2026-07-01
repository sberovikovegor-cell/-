// ── Синхронизация через Firebase Realtime Database ──
// Пока enabled:false — приложение работает на Telegram (как раньше).
// Как заполнить (5 минут):
//   1) console.firebase.google.com → Add project
//   2) Build → Realtime Database → Create Database (регион, режим locked)
//   3) Project settings → General → Your apps → Web (</>) → firebaseConfig
//   4) Вставь databaseURL ниже и поставь enabled: true
//
// databaseURL выглядит так:
//   https://ИМЯ-ПРОЕКТА-default-rtdb.europe-west1.firebasedatabase.app
//   (или ...firebaseio.com)
//
// Код семьи и «Секрет синхронизации» вводятся в приложении
// (кнопка «Код семьи» в окне +Карта) — они общие с Telegram.
// Данные шифруются на телефоне: Firebase хранит только зашифрованный «мусор».
window.FAMILY_FIREBASE_CONFIG = {
  enabled: true,
  databaseURL: "https://shifr-femeli-default-rtdb.europe-west1.firebasedatabase.app",
  // Необязательно (нужно только если включишь правила с авторизацией по токену):
  apiKey: "",
  projectId: "shifr-femeli",
};
