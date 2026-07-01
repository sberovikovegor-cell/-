// Синхронизация семьи через Firebase Realtime Database (REST + streaming).
// Каркас: включается только если задан FAMILY_FIREBASE_CONFIG.databaseURL и enabled.
// Иначе молчит — активной остаётся синхронизация через Telegram (sync-telegram.js).
//
// Данные шифруются на устройстве (тем же FamilyTelegramCrypto, ключ = код семьи + секрет),
// поэтому Firebase/третьи лица видят только зашифрованный blob.
(function () {
  const cfg = window.FAMILY_FIREBASE_CONFIG || {};
  const dbUrl = String(cfg.databaseURL || "").replace(/\/+$/, "");
  if (!cfg.enabled || !dbUrl) return; // не настроено — не трогаем Telegram

  const FAMILY_CODE_KEY = "family-counter-family-code";
  const TG_SECRET_KEY = "family-counter-telegram-secret"; // общий секрет шифрования
  const LOCAL_VERSION_KEY = "family-counter-local-version";
  const LOCAL_PUSH_REVISION_KEY = "family-counter-local-push-revision";
  const DEVICE_ID_KEY = "family-counter-device-id";
  const APPLIED_REMOTE_PULL_KEY = "family-counter-applied-remote-pull";

  let syncActive = false;
  let onRemoteUpdate = null;
  let onLocalStateMerged = null;
  let onBotExportRemote = null;
  let onOnlineCallback = null;
  let onPushComplete = null;
  let onBeforeSyncedStatus = null;
  let pushTimer = null;
  let pollTimer = null;
  let eventSource = null;
  let streamDebounce = null;

  // ── утилиты ──
  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `d-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }

  function getFamilyCode() {
    const stored = localStorage.getItem(FAMILY_CODE_KEY);
    if (stored) return stored;
    const fromCfg = String(window.FAMILY_TELEGRAM_CONFIG?.familyCode || "")
      .trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return fromCfg.length >= 4 ? fromCfg : "";
  }

  function setFamilyCode(code) {
    const normalized = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normalized.length < 4) return false;
    localStorage.setItem(FAMILY_CODE_KEY, normalized);
    return true;
  }

  function createFamilyCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
    setFamilyCode(code);
    return code;
  }

  function getSyncSecret() {
    return localStorage.getItem(TG_SECRET_KEY) || window.FAMILY_TELEGRAM_CONFIG?.syncSecret || "";
  }
  function setSyncSecret(secret) {
    const s = String(secret || "").trim();
    if (!s) return false;
    localStorage.setItem(TG_SECRET_KEY, s);
    return true;
  }

  // Заглушки полей Telegram — чтобы окно «Код семьи» сохранялось без ошибок.
  const noopStore = (key) => (val) => {
    const v = String(val || "").trim();
    if (v) localStorage.setItem(key, v);
    return true;
  };

  function isConfigured() {
    return Boolean(dbUrl && getSyncSecret());
  }
  function isSyncReady() {
    return syncActive && isConfigured() && getFamilyCode();
  }
  function isNetworkAvailable() {
    if (typeof navigator.onLine === "boolean") return navigator.onLine;
    return true;
  }
  function getSyncBlockedReason() {
    if (!dbUrl) return "Не задан databaseURL в firebase-config.js";
    if (!getSyncSecret()) return "Введите секрет синхронизации";
    if (!getFamilyCode()) return "Введите код семьи и нажмите Сохранить";
    if (!syncActive) return "Синхронизация не запущена";
    return null;
  }

  function updateSyncStatus(status, text) {
    const node = document.querySelector("#syncStatus");
    if (!node) return;
    node.dataset.status = status;
    node.textContent = text;
  }

  function hasLocalUnsyncedEdits() {
    return Number(localStorage.getItem(LOCAL_PUSH_REVISION_KEY) || 0) > 0;
  }
  function markLocalEditPending() {
    localStorage.setItem(LOCAL_PUSH_REVISION_KEY, String(Date.now()));
  }
  function safeSyncedStatus(message) {
    if (onBeforeSyncedStatus?.()) return;
    if (hasLocalUnsyncedEdits()) return;
    updateSyncStatus("synced", message);
  }

  function bytesToBase64(bytes) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function nodeUrl() {
    const code = getFamilyCode();
    const auth = cfg.authToken ? `?auth=${encodeURIComponent(cfg.authToken)}` : "";
    return `${dbUrl}/families/${encodeURIComponent(code)}.json${auth}`;
  }

  // ── шифрование ──
  async function encryptState(stateObj, revision) {
    const code = getFamilyCode();
    const secret = getSyncSecret();
    const encrypted = await window.FamilyTelegramCrypto.encryptJson(code, secret, {
      type: "state",
      state: stateObj,
      revision,
      atMs: revision,
    });
    return { payload: bytesToBase64(encrypted), revision, deviceId: getDeviceId(), atMs: revision };
  }

  async function decryptNode(node) {
    if (!node || !node.payload) return null;
    const code = getFamilyCode();
    const secret = getSyncSecret();
    const bytes = base64ToBytes(node.payload);
    try {
      const data = await window.FamilyTelegramCrypto.decryptJson(code, secret, bytes);
      return { state: data.state, revision: Number(node.revision || data.revision || 0) };
    } catch (error) {
      // Не смогли расшифровать = другой код семьи или секрет на этом устройстве.
      const err = new Error("Секрет/код не совпадает с облаком");
      err.code = "secret-mismatch";
      throw err;
    }
  }

  // ── сеть ──
  async function downloadRemote() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(nodeUrl(), { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const node = await res.json();
      if (!node) return null;
      return decryptNode(node);
    } finally {
      clearTimeout(timer);
    }
  }

  async function uploadState(stateObj) {
    const revision = Date.now();
    const body = await encryptState(stateObj, revision);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(nodeUrl(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 100); } catch { /* noop */ }
      throw new Error(`HTTP ${res.status}${detail ? ` ${detail}` : ""}`);
    }
    localStorage.setItem(LOCAL_VERSION_KEY, String(revision));
    return revision;
  }

  // ── pull ──
  async function pullFromFirebase() {
    const remote = await downloadRemote();
    if (!remote || !remote.state) return { ok: true, applied: false };
    const { state: remoteState, revision } = remote;
    const lastApplied = Number(localStorage.getItem(APPLIED_REMOTE_PULL_KEY) || 0);

    const localEmpty = typeof window.hasLocalAppData === "function"
      ? !window.hasLocalAppData(readLocalState())
      : false;
    const remoteHasData = typeof window.hasRemoteAppData === "function"
      ? window.hasRemoteAppData(remoteState)
      : Boolean(remoteState?.people?.length || remoteState?.history?.length);
    const needsInitial = localEmpty && remoteHasData;

    if ((revision > lastApplied || needsInitial) && onRemoteUpdate) {
      onRemoteUpdate(remoteState, revision);
      if (revision > 0) localStorage.setItem(APPLIED_REMOTE_PULL_KEY, String(revision));
      return { ok: true, applied: true };
    }
    return { ok: true, applied: false };
  }

  function readLocalState() {
    try {
      const raw = localStorage.getItem("family-counter-v1");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function pullNow() {
    if (!isNetworkAvailable() || !isSyncReady()) return Promise.resolve(false);
    return pullFromFirebase();
  }

  // Самостоятельная отправка локального состояния (не зависит от app.js).
  // Нужна, чтобы «засеять» пустую базу и повторять отправку после сбоя.
  function attemptSelfPush(force) {
    if (!isSyncReady() || !isNetworkAvailable()) return;
    const local = readLocalState();
    const localHasData = typeof window.hasLocalAppData === "function"
      ? window.hasLocalAppData(local)
      : Boolean(local?.people?.length || local?.history?.length);
    if (!force && !localHasData && !hasLocalUnsyncedEdits()) return;
    if (!localHasData && !hasLocalUnsyncedEdits()) return;
    runPush(local);
  }

  // ── push (со слиянием) ──
  async function pushState(localState) {
    let stateToPush = localState;
    try {
      const remote = await downloadRemote();
      if (remote?.state && window.FamilyMerge?.mergeStates) {
        stateToPush = window.FamilyMerge.mergeStates(localState, remote.state);
        if (typeof window.enforceLocalPeopleOrderOnPush === "function") {
          stateToPush = window.enforceLocalPeopleOrderOnPush(localState, stateToPush);
        }
      }
    } catch (error) {
      // Если не расшифровали чужие данные — НЕ затираем их своими.
      if (error?.code === "secret-mismatch") throw error;
      console.warn("firebase merge before push", error);
    }
    if (stateToPush && typeof window.sanitizeStateForCloud === "function") {
      stateToPush = window.sanitizeStateForCloud(stateToPush);
    }
    await uploadState(stateToPush);
    localStorage.removeItem(LOCAL_PUSH_REVISION_KEY);
    return stateToPush;
  }

  function push(localState) {
    if (!isSyncReady()) {
      const reason = getSyncBlockedReason();
      if (reason) updateSyncStatus("local", reason);
      return;
    }
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => runPush(localState), 600);
  }

  function runPush(localState) {
    if (!isSyncReady()) return;
    if (!isNetworkAvailable()) {
      updateSyncStatus("offline", "Офлайн");
      markLocalEditPending();
      return;
    }
    updateSyncStatus("online", "Отправка…");
    pushState(localState)
      .then((pushed) => {
        if (onPushComplete) onPushComplete(true, pushed);
        else safeSyncedStatus("Синхронизировано");
      })
      .catch((error) => {
        console.warn("firebase push", error);
        updateSyncStatus("offline", `Firebase: ${error?.message || "ошибка"}`);
        markLocalEditPending();
        if (onPushComplete) onPushComplete(false);
      });
  }

  function pushImmediate(localState) {
    if (!isSyncReady()) {
      const reason = getSyncBlockedReason() || "Синхронизация не готова";
      updateSyncStatus("local", reason);
      return Promise.reject(new Error(reason));
    }
    clearTimeout(pushTimer);
    updateSyncStatus("online", "Отправка…");
    return pushState(localState)
      .then((pushed) => {
        if (onPushComplete) onPushComplete(true, pushed);
        else safeSyncedStatus("Синхронизировано");
        return pushed;
      })
      .catch((error) => {
        console.warn("firebase push immediate", error);
        updateSyncStatus("offline", `Firebase: ${error?.message || "ошибка"}`);
        markLocalEditPending();
        if (onPushComplete) onPushComplete(false);
        throw error;
      });
  }

  function cancelPendingPush() {
    clearTimeout(pushTimer);
    pushTimer = null;
  }

  // ── realtime стрим + опрос как запас ──
  function startStream() {
    stopStream();
    try {
      eventSource = new EventSource(nodeUrl());
      const onChange = () => {
        clearTimeout(streamDebounce);
        streamDebounce = setTimeout(() => {
          if (!isSyncReady() || !isNetworkAvailable()) return;
          pullFromFirebase()
            .then((r) => {
              if (r?.applied || (r?.ok && !hasLocalUnsyncedEdits())) safeSyncedStatus("Синхронизировано");
            })
            .catch(() => {});
        }, 300);
      };
      eventSource.addEventListener("put", onChange);
      eventSource.addEventListener("patch", onChange);
      eventSource.onerror = () => { /* авто-reconnect у EventSource */ };
    } catch (error) {
      console.warn("firebase stream", error);
    }
  }
  function stopStream() {
    if (eventSource) {
      try { eventSource.close(); } catch { /* noop */ }
      eventSource = null;
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!isNetworkAvailable() || !isSyncReady()) return;
      if (hasLocalUnsyncedEdits()) {
        attemptSelfPush(false);
        return;
      }
      pullFromFirebase()
        .then((r) => {
          if (r?.applied || (r?.ok && !hasLocalUnsyncedEdits())) safeSyncedStatus("Синхронизировано");
        })
        .catch((error) => updateSyncStatus("offline", `Firebase: ${error?.message || "нет связи"}`));
    }, 15000);
  }

  function initSync(callback) {
    if (!isConfigured()) {
      updateSyncStatus("local", "Firebase не настроен");
      return false;
    }
    if (!getFamilyCode()) return false;
    syncActive = true;
    onRemoteUpdate = callback;
    updateSyncStatus("online", "Подключение к Firebase…");

    pullFromFirebase()
      .catch((error) => console.warn("firebase initial pull", error))
      .finally(() => {
        if (!isNetworkAvailable()) {
          updateSyncStatus("offline", "Офлайн");
          return;
        }
        // Засеваем базу локальными данными (или дожимаем неотправленное).
        setTimeout(() => attemptSelfPush(false), 1200);
        if (hasLocalUnsyncedEdits()) updateSyncStatus("online", "Отправка…");
        else safeSyncedStatus("Синхронизировано");
      });

    startStream();
    startPolling();

    window.addEventListener("online", () => {
      updateSyncStatus("online", "В сети");
      if (onOnlineCallback) onOnlineCallback();
    });
    window.addEventListener("offline", () => updateSyncStatus("offline", "Офлайн"));
    return true;
  }

  function mergeStates(localState, remoteState) {
    if (window.FamilyMerge?.mergeStates) return window.FamilyMerge.mergeStates(localState, remoteState);
    return remoteState || localState;
  }

  // Бот-экспорт (умные переменные Telegram-бота) в этом канале не поддержан —
  // просто пушим состояние. Интеграцию с ботом можно оставить на Telegram.
  function pushBotExport() { return Promise.resolve(); }
  function pushWithBotExport(localState) { return pushImmediate(localState); }
  function notifyBotExportPending() {}
  function stopPendingBotPoll() {}

  window.FamilySync = {
    isConfigured,
    isSyncReady,
    isNetworkAvailable,
    getSyncBlockedReason,
    getSyncMode: () => "firebase",
    testTelegramConnection: () => Promise.resolve({ ok: true }),
    getBotToken: () => localStorage.getItem("family-counter-telegram-token") || "",
    setBotToken: noopStore("family-counter-telegram-token"),
    getChatId: () => localStorage.getItem("family-counter-telegram-chat") || "",
    setChatId: noopStore("family-counter-telegram-chat"),
    getSyncSecret,
    setSyncSecret,
    getServerUrl: () => "",
    setServerUrl: () => false,
    getFamilyCode,
    setFamilyCode,
    createFamilyCode,
    mergeStates,
    initFirebase: (callback) => initSync(callback),
    initSync,
    push,
    pushImmediate,
    cancelPendingPush,
    pushBotExport,
    pushWithBotExport,
    pullNow,
    stopPendingBotPoll,
    notifyBotExportPending,
    markLocalEditPending,
    updateSyncStatus,
    set onLocalStateMerged(fn) { onLocalStateMerged = fn; },
    set onBotExportRemote(fn) { onBotExportRemote = fn; },
    set onOnline(fn) { onOnlineCallback = fn; },
    set onPushComplete(fn) { onPushComplete = fn; },
    set onBeforeSyncedStatus(fn) { onBeforeSyncedStatus = fn; },
  };

  console.info("FamilySync: Firebase-режим активен");
})();
