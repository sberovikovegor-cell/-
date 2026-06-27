(function () {
  const cfg = window.FAMILY_TELEGRAM_CONFIG || {};
  const isApk = window.location.protocol === "file:";
  if (!cfg.enabled && !isApk) return;

  const FAMILY_CODE_KEY = "family-counter-family-code";
  const LOCAL_VERSION_KEY = "family-counter-local-version";
  const LOCAL_PUSH_REVISION_KEY = "family-counter-local-push-revision";
  const PENDING_BOT_REVISION_KEY = "family-counter-pending-bot-revision";
  const TG_TOKEN_KEY = "family-counter-telegram-token";
  const TG_CHAT_KEY = "family-counter-telegram-chat";
  const TG_SECRET_KEY = "family-counter-telegram-secret";
  const DEVICE_ID_KEY = "family-counter-device-id";

  let pollTimer = null;
  let pendingPollTimer = null;
  let pendingPollTimeout = null;
  let pushTimer = null;
  let pendingPushOptions = null;
  let onRemoteUpdate = null;
  let onBotExportRemote = null;
  let onOnlineCallback = null;
  let onLocalStateMerged = null;
  let syncActive = false;

  /** Не чаще 1 сообщения/сек и не более 20/мин в канал. */
  const channelSendLimiter = (() => {
    const queue = [];
    let workerRunning = false;
    const sendTimes = [];
    let lastSend = 0;

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function waitSlot() {
      while (true) {
        const now = Date.now();
        while (sendTimes.length && now - sendTimes[0] >= 60000) {
          sendTimes.shift();
        }
        if (sendTimes.length >= 20) {
          await sleep(60000 - (now - sendTimes[0]) + 50);
          continue;
        }
        const since = now - lastSend;
        if (since < 1500) {
          await sleep(1500 - since);
          continue;
        }
        sendTimes.push(Date.now());
        lastSend = Date.now();
        break;
      }
    }

    async function drain() {
      workerRunning = true;
      while (queue.length) {
        const job = queue.shift();
        try {
          await waitSlot();
          const result = await job.fn();
          job.resolve(result);
        } catch (error) {
          const msg = String(error?.message || "");
          const rateLimited = msg.includes("429") || msg.includes("Too Many Requests");
          if (rateLimited) {
            updateSyncStatus("online", "Лимит Telegram — пауза…");
            await sleep(4500);
            queue.unshift(job);
            continue;
          }
          job.reject(error);
        }
      }
      workerRunning = false;
    }

    function run(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        if (!workerRunning) drain();
      });
    }

    return { run };
  })();

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `d-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }

  function getBotToken() {
    return localStorage.getItem(TG_TOKEN_KEY) || cfg.botToken || "";
  }

  function setBotToken(token) {
    const t = String(token || "").trim();
    if (!t) return false;
    localStorage.setItem(TG_TOKEN_KEY, t);
    return true;
  }

  function getChatId() {
    return localStorage.getItem(TG_CHAT_KEY) || cfg.chatId || "";
  }

  function setChatId(chatId) {
    const id = String(chatId || "").trim();
    if (!id) return false;
    localStorage.setItem(TG_CHAT_KEY, id);
    return true;
  }

  function getSyncSecret() {
    return localStorage.getItem(TG_SECRET_KEY) || cfg.syncSecret || "";
  }

  function setSyncSecret(secret) {
    const s = String(secret || "").trim();
    if (!s) return false;
    localStorage.setItem(TG_SECRET_KEY, s);
    return true;
  }

  function isNetworkAvailable() {
    if (navigator.onLine) return true;
    if (window.location.protocol === "file:") return true;
    return false;
  }

  function schedulePostPushPull() {
    [2500, 6000, 12000, 25000].forEach((ms) => {
      setTimeout(() => {
        if (!isSyncReady() || !isNetworkAvailable()) return;
        pullFromTelegram()
          .then((pulled) => {
            if (pulled) updateSyncStatus("synced", "Синхронизировано");
          })
          .catch(() => {});
      }, ms);
    });
  }

  function getSyncBlockedReason() {
    if (!isConfigured()) return "Укажите токен бота, ID канала и секрет";
    if (!getFamilyCode()) return "Введите код семьи и нажмите Сохранить";
    if (!syncActive) return "Синхронизация не запущена — откройте «Код семьи» и сохраните";
    return null;
  }

  function getCustomApiRoot() {
    const raw = String(cfg.telegramApiBase || cfg.apiBaseUrl || "").trim().replace(/\/+$/, "");
    return raw || null;
  }

  async function testTelegramConnection() {
    try {
      await tgGet("getMe", {});
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  function isConfigured() {
    return Boolean(getBotToken() && getChatId() && getSyncSecret());
  }

  function isSyncReady() {
    return syncActive && isConfigured() && getFamilyCode();
  }

  function getFamilyCode() {
    const stored = localStorage.getItem(FAMILY_CODE_KEY);
    if (stored) return stored;
    const fromCfg = String(cfg.familyCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
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
    for (let i = 0; i < 6; i += 1) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    setFamilyCode(code);
    return code;
  }

  function updateSyncStatus(status, text) {
    const node = document.querySelector("#syncStatus");
    if (!node) return;
    node.dataset.status = status;
    node.textContent = text;
  }

  function useLocalTgProxy() {
    if (window.location.protocol === "file:") return false;
    const host = window.location.hostname || "";
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (host.startsWith("192.168.") || host.startsWith("10.")) return true;
    return window.location.port === "8080";
  }

  function tgApiUrl(method, params) {
    const token = getBotToken();
    const qs = new URLSearchParams(params);
    const custom = getCustomApiRoot();
    if (custom) {
      qs.set("token", token);
      return `${custom}/${method}?${qs}`;
    }
    if (useLocalTgProxy()) {
      qs.set("token", token);
      return `${window.location.origin}/tg-proxy/api/${method}?${qs}`;
    }
    return `https://api.telegram.org/bot${token}/${method}?${qs}`;
  }

  function tgFileUrl(filePath) {
    const token = getBotToken();
    const custom = getCustomApiRoot();
    if (custom) {
      const root = custom.replace(/\/api\/?$/, "");
      const qs = new URLSearchParams({ token, path: filePath });
      return `${root}/file?${qs}`;
    }
    if (useLocalTgProxy()) {
      const qs = new URLSearchParams({ token, path: filePath });
      return `${window.location.origin}/tg-proxy/file?${qs}`;
    }
    return `https://api.telegram.org/file/bot${token}/${filePath}`;
  }

  function tgPostUrl(method) {
    const token = getBotToken();
    const custom = getCustomApiRoot();
    if (custom) {
      const qs = new URLSearchParams({ token });
      return `${custom}/${method}?${qs}`;
    }
    if (useLocalTgProxy()) {
      const qs = new URLSearchParams({ token });
      return `${window.location.origin}/tg-proxy/api/${method}?${qs}`;
    }
    return `https://api.telegram.org/bot${token}/${method}`;
  }

  async function tgPostJson(method, params = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(tgPostUrl(method), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!data.ok) throw new Error(data.description || `Telegram ${method}`);
      return data.result;
    } catch (error) {
      const msg = error?.message || "ошибка";
      if (msg.includes("abort") || msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        throw new Error("Нет связи с Telegram (сеть или блокировка API)");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function tgGet(method, params) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(tgApiUrl(method, params), { signal: controller.signal });
      const data = await response.json();
      if (!data.ok) throw new Error(data.description || `Telegram ${method}`);
      return data.result;
    } catch (error) {
      console.warn("tg get", method, error);
      const msg = error?.message || "ошибка";
      if (msg.includes("abort") || msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        updateSyncStatus("offline", "Нет связи с Telegram");
      } else {
        updateSyncStatus("offline", `Telegram: ${msg}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function downloadPinnedState() {
    const code = getFamilyCode();
    const secret = getSyncSecret();
    const chatId = getChatId();
    const pendingBotRev = Number(localStorage.getItem(PENDING_BOT_REVISION_KEY) || 0);
    const chat = await tgGet("getChat", { chat_id: chatId });
    const pinned = chat.pinned_message;
    if (!pinned?.document) {
      if (pendingBotRev > 0) {
        updateSyncStatus("online", "Ожидание FC_STATE в канале…");
      }
      return null;
    }

    const caption = pinned.caption || "";
    if (!caption.startsWith("FC_STATE:")) {
      if (pendingBotRev > 0) {
        updateSyncStatus("online", "В канале нет закреплённого FC_STATE — ждём ответ бота…");
      }
      return null;
    }
    const parts = caption.split(":");
    if (parts[1] !== code) return null;

    const remoteVersion = Number(parts[2] || 0);

    const fileMeta = await tgGet("getFile", { file_id: pinned.document.file_id });
    const fileUrl = tgFileUrl(fileMeta.file_path);
    const fileController = new AbortController();
    const fileTimer = setTimeout(() => fileController.abort(), 12000);
    const bin = await fetch(fileUrl, { signal: fileController.signal });
    clearTimeout(fileTimer);
    if (!bin.ok) throw new Error("download failed");
    const bytes = new Uint8Array(await bin.arrayBuffer());
    const payload = await window.FamilyTelegramCrypto.decryptJson(code, secret, bytes);
    return { payload, remoteVersion };
  }

  async function pullFromTelegram() {
    const result = await downloadPinnedState();
    if (!result) return false;

    const { payload, remoteVersion } = result;
    const localVersion = Number(localStorage.getItem(LOCAL_VERSION_KEY) || 0);
    const localPushRev = Number(localStorage.getItem(LOCAL_PUSH_REVISION_KEY) || 0);

    if (payload.botExport && onBotExportRemote) {
      onBotExportRemote(payload.botExport);
    }

    // Не подменять локальное состояние устаревшим FC_STATE, пока ждём ответ бота на FC_PUSH
    const staleWhileBotPending = localPushRev > 0
      && remoteVersion > 0
      && remoteVersion < localPushRev;

    const shouldApplyState = payload.type === "state"
      && payload.state
      && onRemoteUpdate
      && !staleWhileBotPending;

    if (shouldApplyState) {
      onRemoteUpdate(payload.state, remoteVersion);
    }
    if (remoteVersion >= localVersion) {
      localStorage.setItem(LOCAL_VERSION_KEY, String(remoteVersion));
      if (remoteVersion >= localPushRev && localPushRev > 0) {
        localStorage.removeItem(LOCAL_PUSH_REVISION_KEY);
      }
    } else if (
      payload.botExport?.status === "applied"
      && remoteVersion > 0
      && remoteVersion < localVersion
    ) {
      localStorage.setItem(LOCAL_VERSION_KEY, String(remoteVersion));
    }
    return true;
  }

  async function uploadEncryptedFile(payload, caption) {
    return channelSendLimiter.run(async () => {
      const code = getFamilyCode();
      const secret = getSyncSecret();
      const chatId = getChatId();
      const encrypted = await window.FamilyTelegramCrypto.encryptJson(code, secret, payload);
      const blob = new Blob([encrypted], { type: "application/octet-stream" });
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", caption);
      form.append("document", blob, "family-sync.fcenc");
      const response = await fetch(tgPostUrl("sendDocument"), {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const desc = data?.description || `HTTP ${response.status}`;
        throw new Error(desc);
      }
      return data;
    });
  }

  async function publishPinnedState(localState) {
    const code = getFamilyCode();
    const revision = Number(localStorage.getItem(LOCAL_VERSION_KEY) || Date.now());
    const payload = {
      type: "state",
      familyCode: code,
      revision,
      state: localState,
      botExport: null,
      atMs: revision,
    };
    const caption = `FC_STATE:${code}:${revision}`;
    const data = await uploadEncryptedFile(payload, caption);
    const msgId = data?.result?.message_id;
    if (!msgId) return;
    const chatId = getChatId();
    try {
      await tgPostJson("unpinAllChatMessages", { chat_id: chatId });
    } catch (error) {
      console.warn("unpinAllChatMessages", error);
    }
    await tgPostJson("pinChatMessage", {
      chat_id: chatId,
      message_id: msgId,
      disable_notification: true,
    });
  }

  async function pushToTelegram(localState, botExport, pushOptions = {}) {
    const code = getFamilyCode();
    const revision = Date.now();

    let stateToPush = localState;
    const replaceRemote = Boolean(pushOptions.replaceRemote);
    if (!botExport && !replaceRemote && localState && window.FamilyMerge?.mergeStates) {
      try {
        const remote = await downloadPinnedState();
        if (remote?.payload?.type === "state" && remote.payload.state) {
          stateToPush = window.FamilyMerge.mergeStates(localState, remote.payload.state);
        }
      } catch (error) {
        console.warn("merge before push", error);
      }
    }

    const payload = {
      type: "push",
      familyCode: code,
      revision,
      deviceId: getDeviceId(),
      state: stateToPush,
      botExport: botExport || null,
      atMs: revision,
    };

    const caption = `FC_PUSH:${code}:${revision}:${getDeviceId()}`;
    await uploadEncryptedFile(payload, caption);

    localStorage.setItem(LOCAL_VERSION_KEY, String(revision));

    if (!botExport) {
      localStorage.removeItem(LOCAL_PUSH_REVISION_KEY);
      try {
        await publishPinnedState(stateToPush);
        updateSyncStatus("synced", "Данные в канале");
      } catch (pinError) {
        console.warn("publishPinnedState", pinError);
        updateSyncStatus("online", "Отправлено — ждём слияния…");
        schedulePostPushPull();
      }
      return;
    }

    localStorage.setItem(LOCAL_PUSH_REVISION_KEY, String(revision));

    updateSyncStatus("online", "Ожидание ответа бота…");
    startPendingBotPoll();
  }

  async function pullNow() {
    if (!isNetworkAvailable() || !isSyncReady()) return false;
    return pullFromTelegram();
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!isNetworkAvailable() || !isSyncReady()) return;
      try {
        const pulled = await pullFromTelegram();
        updateSyncStatus("synced", pulled ? "Синхронизировано" : "Telegram");
      } catch (error) {
        console.warn("tg pull", error);
        updateSyncStatus("offline", "Telegram недоступен");
      }
    }, 15000);
  }

  function stopPendingBotPoll() {
    if (pendingPollTimer) {
      clearInterval(pendingPollTimer);
      pendingPollTimer = null;
    }
    if (pendingPollTimeout) {
      clearTimeout(pendingPollTimeout);
      pendingPollTimeout = null;
    }
  }

  function startPendingBotPoll() {
    stopPendingBotPoll();

    const tick = async () => {
      const pendingBotRev = Number(localStorage.getItem(PENDING_BOT_REVISION_KEY) || 0);
      if (!pendingBotRev || !isNetworkAvailable() || !isSyncReady()) {
        stopPendingBotPoll();
        return;
      }
      try {
        await pullFromTelegram();
        if (!localStorage.getItem(PENDING_BOT_REVISION_KEY)) {
          stopPendingBotPoll();
        }
      } catch (error) {
        console.warn("tg pull pending", error);
      }
    };

    pendingPollTimeout = setTimeout(() => {
      pendingPollTimeout = null;
      tick();
      pendingPollTimer = setInterval(tick, 3500);
    }, 2500);
  }

  function notifyBotExportPending() {
    startPendingBotPoll();
  }

  function initSync(callback, options = {}) {
    if (!isConfigured()) {
      updateSyncStatus("local", "Telegram не настроен");
      return false;
    }
    const code = getFamilyCode();
    if (!code) return false;

    syncActive = true;
    onRemoteUpdate = callback;
    updateSyncStatus("online", "Проверка Telegram…");

    testTelegramConnection().then((result) => {
      if (!result.ok) {
        updateSyncStatus("offline", `Telegram: ${result.error}`);
      }
    });

    const runInitialPull = () => {
      pullFromTelegram().finally(() => {
        const pendingRev = Number(localStorage.getItem(PENDING_BOT_REVISION_KEY) || 0);
        if (pendingRev > 0) {
          startPendingBotPoll();
        }
        updateSyncStatus(isNetworkAvailable() ? "synced" : "offline", isNetworkAvailable() ? "Синхронизировано" : "Офлайн");
      });
    };

    const delayMs = Number(options.delayInitialPullMs || 0);
    if (delayMs > 0) {
      setTimeout(runInitialPull, delayMs);
    } else {
      runInitialPull();
    }

    startPolling();

    window.addEventListener("online", () => {
      updateSyncStatus("online", "В сети");
      if (onOnlineCallback) onOnlineCallback();
    });
    window.addEventListener("offline", () => {
      if (window.location.protocol === "file:") return;
      updateSyncStatus("offline", "Офлайн");
    });

    return true;
  }

  function push(localState, pushOptions) {
    if (!isSyncReady()) {
      const reason = getSyncBlockedReason();
      if (reason) updateSyncStatus("local", reason);
      return;
    }
    const pendingBotRev = Number(localStorage.getItem(PENDING_BOT_REVISION_KEY) || 0);
    if (pendingBotRev > 0) return;
    clearTimeout(pushTimer);
    pendingPushOptions = pushOptions || null;
    pushTimer = setTimeout(() => {
      runPush(localState);
    }, 600);
  }

  function runPush(localState) {
    if (!isSyncReady()) return;
    if (!isNetworkAvailable()) {
      updateSyncStatus("offline", "Офлайн");
      return;
    }
    const pushOptions = pendingPushOptions;
    pendingPushOptions = null;
    updateSyncStatus("online", "Отправка…");
    pushToTelegram(localState, null, pushOptions).then(() => {
      updateSyncStatus("synced", "Синхронизировано");
    }).catch((error) => {
      console.warn("tg push", error);
      const msg = error?.message || "ошибка";
      updateSyncStatus("offline", `Telegram: ${msg}`);
    });
  }

  function pushImmediate(localState, pushOptions) {
    if (!isSyncReady()) {
      const reason = getSyncBlockedReason() || "Синхронизация не готова";
      updateSyncStatus("local", reason);
      return Promise.reject(new Error(reason));
    }
    const pendingBotRev = Number(localStorage.getItem(PENDING_BOT_REVISION_KEY) || 0);
    if (pendingBotRev > 0) return Promise.resolve();
    cancelPendingPush();
    updateSyncStatus("online", "Отправка…");
    return pushToTelegram(localState, null, pushOptions || {}).catch((error) => {
      console.warn("tg push immediate", error);
      const msg = error?.message || "ошибка";
      updateSyncStatus("offline", `Telegram: ${msg}`);
      throw error;
    });
  }

  function cancelPendingPush() {
    clearTimeout(pushTimer);
    pushTimer = null;
  }

  function pushBotExport(botExport) {
    if (!isSyncReady()) return Promise.reject(new Error("sync not ready"));
    if (!isNetworkAvailable()) return Promise.reject(new Error("offline"));
    console.warn("pushBotExport without state — use pushWithBotExport");
    return pushToTelegram(null, botExport);
  }

  function pushWithBotExport(localState, botExport) {
    if (!isSyncReady()) return Promise.reject(new Error("sync not ready"));
    if (!isNetworkAvailable()) return Promise.reject(new Error("offline"));
    return pushToTelegram(localState, botExport);
  }

  function ensureFamilyCodeStored() {
    if (localStorage.getItem(FAMILY_CODE_KEY)) return;
    const fromCfg = String(cfg.familyCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (fromCfg.length >= 4) setFamilyCode(fromCfg);
  }

  ensureFamilyCodeStored();

  const baseMerge = window.FamilySync?.mergeStates;

  window.FamilySync = {
    isConfigured,
    isSyncReady,
    isNetworkAvailable,
    getSyncBlockedReason,
    testTelegramConnection,
    getSyncMode: () => "telegram",
    getBotToken,
    setBotToken,
    getChatId,
    setChatId,
    getSyncSecret,
    setSyncSecret,
    getServerUrl: () => "",
    setServerUrl: () => false,
    getFamilyCode,
    setFamilyCode,
    createFamilyCode,
    mergeStates: baseMerge || ((a, b) => b),
    initFirebase: (callback, options) => initSync(callback, options),
    initSync,
    push,
    pushImmediate,
    cancelPendingPush,
    pushBotExport,
    pushWithBotExport,
    pullNow,
    stopPendingBotPoll,
    notifyBotExportPending,
    markLocalEditPending: () => {
      localStorage.setItem(LOCAL_PUSH_REVISION_KEY, String(Date.now()));
    },
    updateSyncStatus,
    set onLocalStateMerged(fn) {
      onLocalStateMerged = fn;
    },
    set onBotExportRemote(fn) {
      onBotExportRemote = fn;
    },
    set onOnline(fn) {
      onOnlineCallback = fn;
    },
  };
})();
