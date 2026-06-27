(function () {
  const FAMILY_CODE_KEY = "family-counter-family-code";
  const SERVER_URL_KEY = "family-counter-server-url";
  const LOCAL_VERSION_KEY = "family-counter-local-version";
  let pollTimer = null;
  let pushTimer = null;
  let onRemoteUpdate = null;
  let onBotExportRemote = null;
  let onOnlineCallback = null;
  let onLocalStateMerged = null;
  let syncActive = false;

  function mergeStates(localState, remoteState) {
    if (window.FamilyMerge?.mergeStates) {
      return window.FamilyMerge.mergeStates(localState, remoteState);
    }
    return remoteState || localState;
  }

  function normalizeServerUrl(url) {
    const trimmed = String(url || "").trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    if (!/^https?:\/\//i.test(trimmed)) {
      return `http://${trimmed}`;
    }
    return trimmed;
  }

  function getServerUrl() {
    const fromStorage = localStorage.getItem(SERVER_URL_KEY);
    if (fromStorage) return normalizeServerUrl(fromStorage);
    const cfg = window.FAMILY_SERVER_CONFIG;
    return normalizeServerUrl(cfg?.serverUrl || "");
  }

  function setServerUrl(url) {
    const normalized = normalizeServerUrl(url);
    if (!normalized) return false;
    localStorage.setItem(SERVER_URL_KEY, normalized);
    return true;
  }

  function isConfigured() {
    const cfg = window.FAMILY_SERVER_CONFIG;
    return Boolean(cfg?.enabled && getServerUrl());
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

  function apiUrl(path) {
    return `${getServerUrl()}${path}`;
  }

  function updateSyncStatus(status, text) {
    const node = document.querySelector("#syncStatus");
    if (!node) return;
    node.dataset.status = status;
    node.textContent = text;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const message = data.error || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return data;
  }

  async function pullRemote() {
    const code = getFamilyCode();
    if (!code || !isConfigured()) return null;
    const data = await fetchJson(apiUrl(`/api/family/${encodeURIComponent(code)}`));
    return data;
  }

  async function pushToServer(localState, botExport) {
    const code = getFamilyCode();
    if (!code || !isConfigured()) throw new Error("sync not ready");

    const clientVersion = Number(localStorage.getItem(LOCAL_VERSION_KEY) || 0);
    const body = {
      state: localState,
      clientVersion,
    };
    if (botExport) body.botExport = botExport;

    const data = await fetchJson(apiUrl(`/api/family/${encodeURIComponent(code)}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const version = Number(data.version || Date.now());
    localStorage.setItem(LOCAL_VERSION_KEY, String(version));

    if (data.state && onLocalStateMerged) {
      const mergedJson = JSON.stringify(data.state);
      const localJson = JSON.stringify(localState);
      if (mergedJson !== localJson) {
        onLocalStateMerged(data.state);
      }
    }

    if (data.botExport && onBotExportRemote) {
      onBotExportRemote(data.botExport);
    }

    return data;
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!navigator.onLine || !isSyncReady()) return;
      try {
        const data = await pullRemote();
        if (!data?.state) return;

        const remoteVersion = Number(data.version || 0);
        const localVersion = Number(localStorage.getItem(LOCAL_VERSION_KEY) || 0);

        if (remoteVersion > localVersion && onRemoteUpdate) {
          onRemoteUpdate(data.state, remoteVersion);
          localStorage.setItem(LOCAL_VERSION_KEY, String(remoteVersion));
        }

        if (data.botExport && onBotExportRemote) {
          onBotExportRemote(data.botExport);
        }

        updateSyncStatus("synced", "Синхронизировано");
      } catch (error) {
        console.warn("Sync pull failed", error);
        updateSyncStatus("offline", "ПК недоступен");
      }
    }, 12000);
  }

  function initSync(callback) {
    if (!isConfigured()) {
      updateSyncStatus("local", "ПК не настроен");
      return false;
    }

    const code = getFamilyCode();
    if (!code) return false;

    syncActive = true;
    onRemoteUpdate = callback;

    updateSyncStatus("online", "Подключение к ПК…");

    pullRemote().then((data) => {
      if (data?.state && onRemoteUpdate) {
        const remoteVersion = Number(data.version || 0);
        const localVersion = Number(localStorage.getItem(LOCAL_VERSION_KEY) || 0);
        if (remoteVersion > localVersion) {
          onRemoteUpdate(data.state, remoteVersion);
        }
        localStorage.setItem(LOCAL_VERSION_KEY, String(remoteVersion));
      }
      if (data?.botExport && onBotExportRemote) {
        onBotExportRemote(data.botExport);
      }
      updateSyncStatus(navigator.onLine ? "synced" : "offline", navigator.onLine ? "Синхронизировано" : "Офлайн");
    }).catch((error) => {
      console.warn("Initial sync failed", error);
      updateSyncStatus("offline", "ПК недоступен");
    });

    startPolling();

    window.addEventListener("online", () => {
      updateSyncStatus("online", "В сети");
      if (onOnlineCallback) onOnlineCallback();
    });
    window.addEventListener("offline", () => updateSyncStatus("offline", "Офлайн"));

    if (!navigator.onLine) updateSyncStatus("offline", "Офлайн");
    return true;
  }

  function push(localState) {
    if (!isSyncReady()) return;

    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      if (!navigator.onLine) {
        updateSyncStatus("offline", "Офлайн");
        return;
      }
      updateSyncStatus("online", "Сохранение…");
      pushToServer(localState).then(() => {
        updateSyncStatus("synced", "Синхронизировано");
      }).catch((error) => {
        console.warn("Sync push failed", error);
        updateSyncStatus("offline", "ПК недоступен");
      });
    }, 600);
  }

  function cancelPendingPush() {
    clearTimeout(pushTimer);
    pushTimer = null;
  }

  function pushBotExport(botExport) {
    if (!isSyncReady()) return Promise.reject(new Error("sync not ready"));
    if (!navigator.onLine) return Promise.reject(new Error("offline"));

    const code = getFamilyCode();
    return fetchJson(apiUrl(`/api/family/${encodeURIComponent(code)}/bot`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botExport }),
    }).then((data) => {
      if (data.botExport && onBotExportRemote) {
        onBotExportRemote(data.botExport);
      }
      updateSyncStatus("synced", "Синхронизировано");
      return data;
    });
  }

  window.FamilySync = {
    isConfigured,
    isSyncReady,
    getServerUrl,
    setServerUrl,
    getFamilyCode,
    setFamilyCode,
    createFamilyCode,
    mergeStates,
    initFirebase: initSync,
    initSync,
    push,
    cancelPendingPush,
    pushBotExport,
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
