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
    // Android APK (file://): WebView часто ошибочно reports offline
    if (window.location.protocol === "file:") return true;
    return false;
  }

  function isConfigured() {
    return Boolean(getBotToken() && getChatId() && getSyncSecret());
  }

  function isSyncReady() {
    return syncActive && isConfigured() && getFamilyCode();
  }

  function getFamilyCode() {
    return localStorage.getItem(FAMILY_CODE_KEY) || "";
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
    if (useLocalTgProxy()) {
      qs.set("token", token);
      return `${window.location.origin}/tg-proxy/api/${method}?${qs}`;
    }
    return `https://api.telegram.org/bot${token}/${method}?${qs}`;
  }

  function tgFileUrl(filePath) {
    const token = getBotToken();
    if (useLocalTgProxy()) {
      const qs = new URLSearchParams({ token, path: filePath });
      return `${window.location.origin}/tg-proxy/file?${qs}`;
    }
    return `https://api.telegram.org/file/bot${token}/${filePath}`;
  }

  function tgPostUrl(method) {
    const token = getBotToken();
    if (useLocalTgProxy()) {
      const qs = new URLSearchParams({ token });
      return `${window.location.origin}/tg-proxy/api/${method}?${qs}`;
    }
    return `https://api.telegram.org/bot${token}/${method}`;
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
      updateSyncStatus("offline", `Telegram: ${error.message || "ошибка"}`);
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
    const localVersion = Number(localStorage.getItem(LOCAL_VERSION_KEY) || 0);
    if (pendingBotRev <= 0) {
      if (remoteVersion <= localVersion) return null;
    } else if (remoteVersion < localVersion) {
      // Старый LOCAL_VERSION мог быть завышен при отправке FC_PUSH — всё равно тянем ответ бота.
    }

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
    const deletedIds = (() => {
      const ids = new Set();
      try {
        const tombRaw = localStorage.getItem("family-counter-deleted-person-ids");
        const tomb = tombRaw ? JSON.parse(tombRaw) : [];
        if (Array.isArray(tomb)) tomb.forEach((id) => ids.add(id));
        const raw = localStorage.getItem("family-counter-v1");
        if (raw) {
          const parsed = JSON.parse(raw);
          (parsed.deletedPersonIds || []).forEach((id) => ids.add(id));
        }
      } catch {
        // ignore broken local tombstones
      }
      return ids;
    })();
    const localPeopleCount = (() => {
      try {
        const raw = localStorage.getItem("family-counter-v1");
        if (!raw) return 0;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.people) ? parsed.people.length : 0;
      } catch {
        return 0;
      }
    })();
    const remotePeopleCount = Array.isArray(payload.state?.people)
      ? payload.state.people.filter((person) => !deletedIds.has(person.id)).length
      : 0;
    const isStaleState = localPushRev > 0 && remoteVersion > 0 && remoteVersion < localPushRev;

    if (payload.botExport && onBotExportRemote) {
      onBotExportRemote(payload.botExport);
    }

    const allowByVersion = remoteVersion >= localVersion;
    const allowMorePeople = remotePeopleCount > localPeopleCount && localPushRev === 0;
    const staleOk = !isStaleState || remotePeopleCount <= localPeopleCount;
    const rejectStaleExtraPeople = localPeopleCount > 0
      && remotePeopleCount > localPeopleCount
      && remoteVersion <= localVersion;

    const shouldApplyState = payload.type === "state"
      && payload.state
      && onRemoteUpdate
      && !rejectStaleExtraPeople
      && (allowByVersion || allowMorePeople)
      && staleOk;

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

  async function pushToTelegram(localState, botExport) {
    const code = getFamilyCode();
    const revision = Date.now();

    const payload = {
      type: "push",
      familyCode: code,
      revision,
      deviceId: getDeviceId(),
      state: localState,
      botExport: botExport || null,
      atMs: revision,
    };

    const caption = `FC_PUSH:${code}:${revision}:${getDeviceId()}`;
    await uploadEncryptedFile(payload, caption);

    localStorage.setItem(LOCAL_VERSION_KEY, String(revision));
    localStorage.setItem(LOCAL_PUSH_REVISION_KEY, String(revision));

    if (!botExport) return;

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
    updateSyncStatus("online", "Telegram…");

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

  function push(localState) {
    if (!isSyncReady()) return;
    const pendingBotRev = Number(localStorage.getItem(PENDING_BOT_REVISION_KEY) || 0);
    if (pendingBotRev > 0) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      if (!isNetworkAvailable()) {
        updateSyncStatus("offline", "Офлайн");
        return;
      }
      updateSyncStatus("online", "Отправка…");
      pushToTelegram(localState, null).then(() => {
        updateSyncStatus("synced", "Синхронизировано");
      }).catch((error) => {
        console.warn("tg push", error);
        updateSyncStatus("offline", "Ошибка Telegram");
      });
    }, 600);
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

  const baseMerge = window.FamilySync?.mergeStates;

  window.FamilySync = {
    isConfigured,
    isSyncReady,
    isNetworkAvailable,
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
