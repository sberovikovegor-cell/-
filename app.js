// Если открыли app.js напрямую (не через index.html) — переход на приложение.
(function () {
  const href = String(window.location.href || "");
  const path = String(window.location.pathname || "");
  if (/app\.js($|[?#])/i.test(path) || /\/app\.js[?#]/i.test(href)) {
    const base = href.replace(/app\.js.*$/i, "");
    window.location.replace(`${base}index.html`);
    return;
  }
})();

const STORAGE_KEY = "family-counter-v1";
const STORAGE_BACKUP_KEY = "family-counter-v1-backup";
const BOT_REVISION_KEY = "family-counter-bot-revision";
const PENDING_BOT_REVISION_KEY = "family-counter-pending-bot-revision";
const BOT_EXPORT_SENT_REVISION_KEY = "family-counter-bot-export-sent-revision";
const LAST_APPLIED_BOT_REVISION_KEY = "family-counter-last-applied-bot-revision";
const PENDING_BOT_AT_KEY = "family-counter-pending-bot-at";
const LAST_BOT_APPLY_KEY = "family-counter-last-bot-apply";
const LOCAL_PUSH_REVISION_KEY = "family-counter-local-push-revision";
const DELETED_PERSON_IDS_KEY = "family-counter-deleted-person-ids";
const DELETED_FOLDER_IDS_KEY = "family-counter-deleted-folder-ids";
const BOT_SENT_REVISIONS_KEY = "family-counter-bot-sent-revisions";
const CLOUD_WIPE_AT_KEY = "family-counter-cloud-wipe-at";
const DATA_EPOCH_KEY = "family-counter-data-epoch";
const FACTORY_RESET_PENDING_KEY = "family-counter-factory-reset-pending";
const DEVICE_ID_KEY = "family-counter-device-id";
const SESSION_ACTIVE_KEY = "family-counter-session-active";
const STARTUP_PUSH_DONE_KEY = "family-counter-startup-push-done";
const CLOUD_CONFIRM_FP_KEY = "family-counter-cloud-confirm-fp";
const APP_BUILD = "164";

const PERSON_BANK_THEMES = [
  { id: "", label: "Без банка", short: "—" },
  { id: "ozon", label: "Озон", short: "Oz" },
  { id: "yoomoney", label: "ЮMoney", short: "Ю" },
  { id: "cupis", label: "ЦУПИС", short: "ЦУ" },
  { id: "yandex", label: "Яндекс", short: "Я" },
  { id: "wildberries", label: "Wildberries", short: "WB" },
  { id: "sber", label: "Сбер", short: "✓" },
  { id: "otp", label: "ОТП", short: "ОТП" },
  { id: "raif", label: "Райффайзен", short: "R" },
  { id: "tinkoff", label: "Тинькофф", short: "T" },
  { id: "alfa", label: "Альфа", short: "A" },
  { id: "psb", label: "ПСБ", short: "ПС" },
];
const PERSON_BANK_THEME_IDS = new Set(PERSON_BANK_THEMES.map((item) => item.id));
const PERSON_DRAG_LONG_PRESS_MS = 1200;
const PERSON_DRAG_MOVE_CANCEL_PX = 12;

let coldAppLaunch = false;
let cloudConfirmTimer = null;
let startupPushScheduled = false;

const SYNC_SETTINGS_KEYS = new Set([
  "family-counter-family-code",
  "family-counter-telegram-token",
  "family-counter-telegram-chat",
  "family-counter-telegram-secret",
  "family-counter-server-url",
  DEVICE_ID_KEY,
]);

function getRequiredDataEpoch() {
  return Number(window.FAMILY_TELEGRAM_CONFIG?.dataEpoch || 0);
}

function clearAllFamilyCounterStorage(options = {}) {
  const keepSync = Boolean(options.keepSyncSettings);
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("family-counter-")) continue;
    if (keepSync && SYNC_SETTINGS_KEYS.has(key)) continue;
    keysToRemove.push(key);
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

function clearAppCaches() {
  if (!("caches" in window)) return Promise.resolve();
  return caches.keys()
    .then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("family-counter-cache-")).map((key) => caches.delete(key)),
    ))
    .catch(() => {});
}

function enforceDataEpochOnStartup() {
  const required = getRequiredDataEpoch();
  if (!required) return false;
  const stored = Number(localStorage.getItem(DATA_EPOCH_KEY) || 0);
  if (stored >= required) return false;

  localStorage.setItem(DATA_EPOCH_KEY, String(required));

  const upgradeStoredState = (raw) => {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      parsed.dataEpoch = Math.max(Number(parsed.dataEpoch || 0), required);
      const json = JSON.stringify(parsed);
      localStorage.setItem(STORAGE_KEY, json);
      localStorage.setItem(STORAGE_BACKUP_KEY, json);
    } catch {
      // ignore broken storage
    }
  };
  upgradeStoredState(localStorage.getItem(STORAGE_KEY));
  upgradeStoredState(localStorage.getItem(STORAGE_BACKUP_KEY));
  return true;
}

function remoteMeetsDataEpoch(remoteState) {
  const required = getRequiredDataEpoch();
  if (!required) return true;
  return Number(remoteState?.dataEpoch || 0) >= required;
}

function hasRemoteAppData(remoteState) {
  const deleted = getDeletedPersonIdsFrom(remoteState);
  const people = (remoteState?.people || []).filter((person) => !deleted.has(person.id));
  return people.length > 0 || (remoteState?.history || []).length > 0;
}

function flushPendingFactoryResetToCloud() {
  if (!localStorage.getItem(FACTORY_RESET_PENDING_KEY)) return;
  if (!window.FamilySync?.isSyncReady?.()) return;

  const required = getRequiredDataEpoch();
  state = normalizeLoadedState(state);
  if (required > 0) state.dataEpoch = required;
  if (!state.wipedAtMs) state.wipedAtMs = Date.now();
  state.uiUpdatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.setItem(STORAGE_BACKUP_KEY, JSON.stringify(state));
  localStorage.setItem(CLOUD_WIPE_AT_KEY, String(state.wipedAtMs));
  if (required > 0) localStorage.setItem(DATA_EPOCH_KEY, String(required));

  if (!FamilySync.pushImmediate) {
    FamilySync.push(state, { replaceRemote: true });
    localStorage.removeItem(FACTORY_RESET_PENDING_KEY);
    return;
  }

  localStorage.removeItem(FACTORY_RESET_PENDING_KEY);
  FamilySync.pushImmediate(state, { replaceRemote: true }).catch(() => {
    localStorage.setItem(FACTORY_RESET_PENDING_KEY, "1");
  });
}

function scheduleOverwriteStaleCloud() {
  if (!window.FamilySync?.pushImmediate) return;
  const required = getRequiredDataEpoch();
  if (!required) return;
  const marker = `family-counter-epoch-cloud-${required}`;
  setTimeout(() => {
    if (!FamilySync.isSyncReady?.()) return;
    state = ensureStateDataEpoch(state);
    FamilySync.pushImmediate(state, { replaceRemote: true })
      .then(() => localStorage.setItem(marker, String(Date.now())))
      .catch(() => {});
  }, 2500);
}

function scheduleCloudEpochOverwriteOnce() {
  const required = getRequiredDataEpoch();
  if (!required) return;
  const marker = `family-counter-epoch-cloud-${required}`;
  if (localStorage.getItem(marker)) return;
  scheduleOverwriteStaleCloud();
}

function blurActiveInput() {
  const active = document.activeElement;
  if (active && active !== document.body && typeof active.blur === "function") {
    active.blur();
  }
}
const TYPE_LABELS = {
  income: "Пополнение",
  purchase: "Покупка",
  transfer: "Перевод",
  balance_set: "Коррекция баланса",
};

function showBootError(message) {
  const text = String(message || "ошибка");
  if (window.__bootLog) window.__bootLog(text);
  if (elements.syncNoticeRow && elements.syncNoticeText) {
    elements.syncNoticeRow.hidden = false;
    elements.syncNoticeText.textContent = `Ошибка: ${text}`;
    elements.syncNoticeRow.dataset.level = "error";
  }
}

function isBenignAsyncError(reason) {
  const name = String(reason?.name || "");
  const msg = String(reason?.message || reason || "");
  if (name === "AbortError") return true;
  if (/abort|aborted/i.test(msg)) return true;
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) return true;
  return false;
}

function hideBootScreen() {
  const screen = document.querySelector("#bootErrorScreen");
  if (screen) screen.classList.add("boot-error-screen--hidden");
}

window.addEventListener("error", (event) => {
  console.error(event.error || event.message);
  showBootError(event.message || "ошибка загрузки");
});

window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
  if (isBenignAsyncError(event.reason)) return;
  const msg = String(event.reason?.message || event.reason || "");
  showBootError(msg || "ошибка");
});

let state;
try {
  enforceDataEpochOnStartup();
  state = loadState();
  if (state.wipedAtMs > 0) {
    const prevCloudWipe = Number(localStorage.getItem(CLOUD_WIPE_AT_KEY) || 0);
    localStorage.setItem(CLOUD_WIPE_AT_KEY, String(Math.max(prevCloudWipe, state.wipedAtMs)));
  }
} catch (error) {
  console.error("loadState failed", error);
  showBootError(error?.message || String(error));
  state = getDefaultState();
}
let editingPersonId = null;
let phoneAutoPrefixSuppressed = false;
let currentOperation = null;
let personDragSession = null;
let amountEntryText = "";
let deferredInstallPrompt = null;
let activeView = "main";
let activeHistoryPeriod = null;
let botSuccessTimer = null;
let botExportWorkerBusy = false;
let filtersAutoCleared = false;

const elements = {
  mainView: document.querySelector("#mainView"),
  detailsView: document.querySelector("#detailsView"),
  detailsPeopleList: document.querySelector("#detailsPeopleList"),
  detailsCopyAll: document.querySelector("#detailsCopyAll"),
  detailsToggleButton: document.querySelector("#detailsToggleButton"),
  historyView: document.querySelector("#historyView"),
  historyToggleButton: document.querySelector("#historyToggleButton"),
  syncStatus: document.querySelector("#syncStatus"),
  appVersion: document.querySelector("#appVersion"),
  openSyncDialogButton: document.querySelector("#openSyncDialogButton"),
  syncDialog: document.querySelector("#syncDialog"),
  syncForm: document.querySelector("#syncForm"),
  telegramBotTokenInput: document.querySelector("#telegramBotTokenInput"),
  telegramChatIdInput: document.querySelector("#telegramChatIdInput"),
  telegramSecretInput: document.querySelector("#telegramSecretInput"),
  serverUrlInput: document.querySelector("#serverUrlInput"),
  familyCodeInput: document.querySelector("#familyCodeInput"),
  createFamilyCodeButton: document.querySelector("#createFamilyCodeButton"),
  clearLocalDataButton: document.querySelector("#clearLocalDataButton"),
  clearCloudDataButton: document.querySelector("#clearCloudDataButton"),
  cancelSyncButton: document.querySelector("#cancelSyncButton"),
  familyTotal: document.querySelector("#familyTotal"),
  familyPurchaseTotal: document.querySelector("#familyPurchaseTotal"),
  familyTransferTotal: document.querySelector("#familyTransferTotal"),
  folderList: document.querySelector("#folderList"),
  firstNameFilterList: document.querySelector("#firstNameFilterList"),
  peopleList: document.querySelector("#peopleList"),
  historyList: document.querySelector("#historyList"),
  personFilter: document.querySelector("#personFilter"),
  typeFilter: document.querySelector("#typeFilter"),
  commentFilter: document.querySelector("#commentFilter"),
  addPersonButton: document.querySelector("#addPersonButton"),
  addFolderButton: document.querySelector("#addFolderButton"),
  deleteFolderButton: document.querySelector("#deleteFolderButton"),
  singleFilterToggle: document.querySelector("#singleFilterToggle"),
  incomeCount: document.querySelector("#incomeCount"),
  purchaseCount: document.querySelector("#purchaseCount"),
  transferCount: document.querySelector("#transferCount"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  nextMonthButton: document.querySelector("#nextMonthButton"),
  historyPeriodSelect: document.querySelector("#historyPeriodSelect"),
  personDialog: document.querySelector("#personDialog"),
  personForm: document.querySelector("#personForm"),
  personDialogTitle: document.querySelector("#personDialogTitle"),
  personFirstNameInput: document.querySelector("#personFirstNameInput"),
  personLastNameInput: document.querySelector("#personLastNameInput"),
  personBalanceInput: document.querySelector("#personBalanceInput"),
  personPhoneInput: document.querySelector("#personPhoneInput"),
  personCardNumberInput: document.querySelector("#personCardNumberInput"),
  personCardDetailsInput: document.querySelector("#personCardDetailsInput"),
  personProfileNoteInput: document.querySelector("#personProfileNoteInput"),
  personCardTintPicker: document.querySelector("#personCardTintPicker"),
  personUseInBotCheckbox: document.querySelector("#personUseInBotCheckbox"),
  personFolderPicker: document.querySelector("#personFolderPicker"),
  deletePersonButton: document.querySelector("#deletePersonButton"),
  cancelPersonButton: document.querySelector("#cancelPersonButton"),
  folderDialog: document.querySelector("#folderDialog"),
  folderForm: document.querySelector("#folderForm"),
  folderNameInput: document.querySelector("#folderNameInput"),
  cancelFolderButton: document.querySelector("#cancelFolderButton"),
  deleteFolderDialog: document.querySelector("#deleteFolderDialog"),
  deleteFolderForm: document.querySelector("#deleteFolderForm"),
  deleteFolderSelect: document.querySelector("#deleteFolderSelect"),
  cancelDeleteFolderButton: document.querySelector("#cancelDeleteFolderButton"),
  operationDialog: document.querySelector("#operationDialog"),
  operationForm: document.querySelector("#operationForm"),
  operationPerson: document.querySelector("#operationPerson"),
  operationTitle: document.querySelector("#operationTitle"),
  selectedAmountInput: document.querySelector("#selectedAmountInput"),
  amountKeypad: document.querySelector("#amountKeypad"),
  transferToggleRow: document.querySelector("#transferToggleRow"),
  transferCheckbox: document.querySelector("#transferCheckbox"),
  noteInput: document.querySelector("#noteInput"),
  resetAmountButton: document.querySelector("#resetAmountButton"),
  confirmOperationButton: document.querySelector("#confirmOperationButton"),
  cancelOperationButton: document.querySelector("#cancelOperationButton"),
  exitOperationButton: document.querySelector("#exitOperationButton"),
  installButton: document.querySelector("#installButton"),
  emptyStateTemplate: document.querySelector("#emptyStateTemplate"),
  botPendingBanner: document.querySelector("#botPendingBanner"),
  botSuccessBanner: document.querySelector("#botSuccessBanner"),
  botOfflineDialog: document.querySelector("#botOfflineDialog"),
  syncAlertBanner: document.querySelector("#syncAlertBanner"),
  syncNoticeRow: document.querySelector("#syncNoticeRow"),
  syncNoticeText: document.querySelector("#syncNoticeText"),
};

function init() {
  try {
    coldAppLaunch = detectColdAppLaunch();
    if (window.location.protocol === "file:") {
      document.body.classList.add("android-webview");
    }
    renderAppVersion();
    bindEvents();
    setupSyncDialogMode();
    reconcileStaleBotPending();
    initFamilySync();
    if (hasBotPendingSync()) {
      scheduleBotExportWorker();
    }
    render(true);
    registerServiceWorker();
    hideBootScreen();
  } catch (error) {
    console.error(error);
    showBootError(error?.message || String(error));
  }
}

function reconcileStaleBotPending() {
  if (!hasBotPendingSync()) return;

  const pendingRev = Number(localStorage.getItem(PENDING_BOT_REVISION_KEY) || 0);
  const pendingAt = Number(localStorage.getItem(PENDING_BOT_AT_KEY) || 0);
  const ageMs = pendingAt ? Date.now() - pendingAt : Infinity;

  if (!pendingRev || ageMs > 120000) {
    resetAllBotPendingUi();
  }
}

function resetAllBotPendingUi() {
  state.people = state.people.map((person) => {
    const confirmed = resolvePersonInBotFlag(person);
    return normalizePerson({
      ...person,
      botPendingSync: false,
      botPendingAction: null,
      useInBot: confirmed,
      botConfirmedInBot: confirmed,
    });
  });
  localStorage.removeItem(PENDING_BOT_REVISION_KEY);
  localStorage.removeItem(PENDING_BOT_AT_KEY);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (window.FamilySync?.stopPendingBotPoll) {
    FamilySync.stopPendingBotPoll();
  }
}

function renderAppVersion() {
  if (elements.appVersion) {
    elements.appVersion.textContent = `вер. ${APP_BUILD}`;
  }
}

function setupSyncDialogMode() {
  const tg = window.FAMILY_TELEGRAM_CONFIG?.enabled;
  document.querySelectorAll(".telegram-sync-field").forEach((el) => {
    el.hidden = !tg;
  });
  document.querySelectorAll(".pc-sync-field").forEach((el) => {
    el.hidden = Boolean(tg);
  });
  const hint = document.querySelector("#syncModeHint");
  if (hint) {
    hint.textContent = tg
      ? "Telegram: зашифрованный файл в канал. Работает с мобильной сети."
      : "ПК: адрес компьютера с ботом (Wi‑Fi / Tailscale).";
  }
}

function initFamilySync() {
  if (!window.FamilySync) return;

  FamilySync.shouldRejectStaleRemote = shouldRejectStaleRemoteState;

  FamilySync.onLocalStateMerged = (mergedState) => {
    if (!mergedState) return;
    const remoteVersion = Number(localStorage.getItem("family-counter-local-version") || 0);
    applyRemoteState(mergedState, remoteVersion);
  };

  FamilySync.onBotExportRemote = handleRemoteBotExport;
  FamilySync.onPushComplete = (success, pushedState) => {
    if (!success) {
      localStorage.removeItem(CLOUD_CONFIRM_FP_KEY);
      renderSyncNoticeRow();
      return;
    }
    if (pushedState) {
      const fp = stateCloudFingerprint(pushedState);
      if (fp) localStorage.setItem(CLOUD_CONFIRM_FP_KEY, fp);
    }
    if (localStorage.getItem(CLOUD_CONFIRM_FP_KEY) && FamilySync.updateSyncStatus) {
      FamilySync.updateSyncStatus("online", "Проверка канала…");
    }
    scheduleCloudConfirmPoll();
    renderSyncNoticeRow();
  };
  FamilySync.onBeforeSyncedStatus = () => Boolean(localStorage.getItem(CLOUD_CONFIRM_FP_KEY));

  FamilySync.onOnline = () => {
    retryBotExportIfNeeded();
    if (!FamilySync.isSyncReady()) {
      renderSyncNoticeRow();
      return;
    }
    state = ensureStateDataEpoch(state);
    (async () => {
      try {
        if (FamilySync.pullNow) await FamilySync.pullNow();
      } catch (error) {
        console.warn("online pull", error);
      }
      if (hasBotPendingSync()) {
        renderSyncNoticeRow();
        return;
      }
      const offlinePending = Number(localStorage.getItem(LOCAL_PUSH_REVISION_KEY) || 0) > 0;
      if (offlinePending) {
        FamilySync.push(state);
      } else if (coldAppLaunch && !isStartupPushDone()) {
        scheduleStartupCloudPush();
      }
      renderSyncNoticeRow();
    })();
  };

  const code = FamilySync.getFamilyCode();
  if (code) {
    elements.familyCodeInput.value = code;
    if (FamilySync.getBotToken) {
      elements.telegramBotTokenInput.value = FamilySync.getBotToken() || "";
      elements.telegramChatIdInput.value = FamilySync.getChatId() || "";
      elements.telegramSecretInput.value = FamilySync.getSyncSecret() || "";
    }
    if (FamilySync.getServerUrl) {
      elements.serverUrlInput.value = FamilySync.getServerUrl() || "";
    }
    startCloudSync();
    flushPendingFactoryResetToCloud();
    scheduleCloudEpochOverwriteOnce();
  } else if (!FamilySync.isConfigured()) {
    FamilySync.updateSyncStatus("local", window.FAMILY_TELEGRAM_CONFIG?.enabled
      ? "Введите код семьи (кнопка ниже)"
      : "ПК не настроен");
  } else {
    FamilySync.updateSyncStatus("local", "Введите код семьи (кнопка ниже)");
    // На APK showModal при старте часто ломает WebView — только в браузере
    if (window.location.protocol !== "file:") {
      setTimeout(() => openSyncDialog(), 400);
    }
  }
}

function markLocalEditPending() {
  localStorage.setItem(LOCAL_PUSH_REVISION_KEY, String(Date.now()));
}

function detectColdAppLaunch() {
  try {
    if (sessionStorage.getItem(SESSION_ACTIVE_KEY)) return false;
    sessionStorage.setItem(SESSION_ACTIVE_KEY, "1");
    return true;
  } catch {
    return true;
  }
}

function isStartupPushDone() {
  try {
    return Boolean(sessionStorage.getItem(STARTUP_PUSH_DONE_KEY));
  } catch {
    return false;
  }
}

function markStartupPushDone() {
  try {
    sessionStorage.setItem(STARTUP_PUSH_DONE_KEY, "1");
  } catch {
    // ignore sessionStorage errors
  }
}

function stateCloudFingerprint(appState) {
  if (!appState) return "";
  const normalized = applyDeletedPersonFilter(normalizeLoadedState(appState));
  const deleted = getDeletedPersonIdsFrom(normalized);
  const people = (normalized.people || [])
    .filter((person) => person && !deleted.has(person.id))
    .map((person) => `${person.id}|${Number(person.balance || 0)}|${getPersonFirstName(person)}|${person.phone || ""}|${getCardNumberForBot(person)}`)
    .sort()
    .join(",");
  const histLen = (normalized.history || []).length;
  const histClear = Number(normalized.historyClearedAtMs || 0);
  const histMonths = (normalized.historyMonths || []).length;
  const folders = (normalized.folders || []).length;
  const ui = Number(normalized.uiUpdatedAt || 0);
  const wipe = Number(normalized.wipedAtMs || 0);
  const epoch = Number(normalized.dataEpoch || 0);
  return `e${epoch}|w${wipe}|u${ui}|p${people}|h${histLen}|hc${histClear}|hm${histMonths}|f${folders}`;
}

function tryConfirmCloudSync(remoteState) {
  const pending = localStorage.getItem(CLOUD_CONFIRM_FP_KEY);
  if (!pending) return false;
  const target = remoteState
    ? applyDeletedPersonFilter(normalizeLoadedState(remoteState))
    : state;
  if (stateCloudFingerprint(target) !== pending) return false;
  localStorage.removeItem(CLOUD_CONFIRM_FP_KEY);
  if (window.FamilySync?.updateSyncStatus) {
    FamilySync.updateSyncStatus("synced", "Синхронизировано");
  }
  renderSyncNoticeRow();
  return true;
}

function scheduleCloudConfirmPoll() {
  if (!localStorage.getItem(CLOUD_CONFIRM_FP_KEY)) return;
  if (cloudConfirmTimer) return;
  const started = Date.now();
  const tick = async () => {
    const pending = localStorage.getItem(CLOUD_CONFIRM_FP_KEY);
    if (!pending) {
      cloudConfirmTimer = null;
      return;
    }
    if (Date.now() - started > 120000) {
      if (FamilySync?.updateSyncStatus) {
        FamilySync.updateSyncStatus("online", "В канале — ПК обновится позже");
      }
      cloudConfirmTimer = null;
      return;
    }
    try {
      if (FamilySync?.pullNow) await FamilySync.pullNow();
      tryConfirmCloudSync(state);
    } catch {
      // ignore pull errors during confirm poll
    }
    if (!localStorage.getItem(CLOUD_CONFIRM_FP_KEY)) {
      cloudConfirmTimer = null;
      return;
    }
    cloudConfirmTimer = setTimeout(tick, 4000);
  };
  cloudConfirmTimer = setTimeout(tick, 2500);
}

function scheduleStartupCloudPush() {
  if (!coldAppLaunch || isStartupPushDone()) return;
  if (startupPushScheduled) return;
  startupPushScheduled = true;
  if (localStorage.getItem(FACTORY_RESET_PENDING_KEY)) return;
  if (hasBotPendingSync()) return;

  const attempt = () => {
    if (!coldAppLaunch || isStartupPushDone()) return;
    if (!window.FamilySync?.isSyncReady?.()) return;
    if (!isNetworkAvailable()) {
      if (FamilySync?.updateSyncStatus) {
        FamilySync.updateSyncStatus("offline", "Запуск — отправим при сети");
      }
      return;
    }
    const hasData = hasLocalAppData(state)
      || Number(localStorage.getItem(LOCAL_PUSH_REVISION_KEY) || 0) > 0;
    if (!hasData) {
      markStartupPushDone();
      return;
    }
    markStartupPushDone();
    if (FamilySync.pushImmediate) {
      FamilySync.pushImmediate(state).catch(() => {});
    } else if (FamilySync.push) {
      FamilySync.push(state);
    }
  };

  setTimeout(() => {
    attempt();
    if (isStartupPushDone()) return;
    let tries = 0;
    const retryId = setInterval(() => {
      tries += 1;
      if (isStartupPushDone() || tries > 20) {
        clearInterval(retryId);
        return;
      }
      attempt();
      if (isStartupPushDone()) clearInterval(retryId);
    }, 2000);
  }, 4000);
}

function startCloudSync() {
  if (!window.FamilySync?.initFirebase) return;

  const started = FamilySync.initFirebase((remoteState, remoteVersion) => {
    applyRemoteState(remoteState, remoteVersion ?? 0);
  }, { delayInitialPullMs: 3000 });

  if (started && FamilySync.isConfigured() && coldAppLaunch) {
    scheduleStartupCloudPush();
  }
}

function applyRemoteState(remoteState, remoteVersion = 0) {
  if (!window.FamilySync?.mergeStates) return;
  const normalizedRemote = applyDeletedPersonFilter(
    normalizeLoadedState(filterRemotePeople(remoteState)),
  );
  const localBefore = applyDeletedPersonFilter(normalizeLoadedState(state));
  if (shouldReplaceWithRemoteWipe(localBefore, normalizedRemote)) {
    applyRemoteStateAsReplace(normalizedRemote, remoteVersion);
    return;
  }
  if (shouldRejectStaleRemoteState(localBefore, normalizedRemote)) {
    applySyncMetaFromRemote(normalizedRemote);
    if (!remoteMeetsDataEpoch(normalizedRemote)) {
      scheduleOverwriteStaleCloud();
    }
    render();
    return;
  }
  applySyncMetaFromRemote(normalizedRemote);
  state = applyDeletedPersonFilter(
    normalizeLoadedState(FamilySync.mergeStates(localBefore, normalizedRemote)),
  );
  state = mergePeoplePreservingLocalEdits(localBefore, normalizedRemote, state);
  state = dropRemoteOnlyGhosts(localBefore, normalizedRemote, state);
  state = preserveLocalBotFields(localBefore, state);
  state = applyDeletedPersonFilter(state);
  state = preferLocalFiltersWhenShrunk(localBefore, normalizedRemote, state);
  state = scrubFiltersToPeople(state);
  state = applyDeletedFolderFilter(state);
  state = finalizePeopleAfterMerge(localBefore, normalizedRemote, state);
  state = preserveLocalBalanceOverrides(localBefore, state);
  syncBalancesFromHistory();
  state = ensureStateDataEpoch(state);
  state.deletedPersonIds = [...getDeletedPersonIds()];
  state.deletedFolderIds = [...getDeletedFolderIds()];
  state.wipedAtMs = Math.max(
    Number(state.wipedAtMs || 0),
    Number(localBefore.wipedAtMs || 0),
    Number(normalizedRemote.wipedAtMs || 0),
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.setItem(STORAGE_BACKUP_KEY, JSON.stringify(state));
  reconcileDeletedPersonIds(normalizedRemote);
  reconcileDeletedFolderIds(normalizedRemote);
  if (remoteVersion > 0) {
    const localVersion = Number(localStorage.getItem("family-counter-local-version") || 0);
    if (remoteVersion >= localVersion) {
      localStorage.setItem("family-counter-local-version", String(remoteVersion));
    }
    const localPushRev = Number(localStorage.getItem(LOCAL_PUSH_REVISION_KEY) || 0);
    if (remoteVersion >= localPushRev && localPushRev > 0) {
      localStorage.removeItem(LOCAL_PUSH_REVISION_KEY);
    }
  }
  reconcileFiltersAfterSync();
  reconcileBotPendingFromRemote(normalizedRemote);
  tryConfirmCloudSync(state);
  render();
}

function getDeletedPersonIdsFrom(appState) {
  const merged = new Set();
  (appState?.deletedPersonIds || []).forEach((id) => merged.add(id));
  try {
    const raw = localStorage.getItem(DELETED_PERSON_IDS_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    if (Array.isArray(ids)) ids.filter(Boolean).forEach((id) => merged.add(id));
  } catch {
    // ignore broken tombstone storage
  }
  return merged;
}

function getDeletedPersonIds() {
  return getDeletedPersonIdsFrom(state);
}

function addDeletedPersonId(personId) {
  if (!personId) return;
  const deleted = getDeletedPersonIds();
  deleted.add(personId);
  state.deletedPersonIds = [...deleted];
  localStorage.setItem(DELETED_PERSON_IDS_KEY, JSON.stringify(state.deletedPersonIds));
}

function reconcileDeletedPersonIds(remoteState) {
  const remoteDeleted = remoteState?.deletedPersonIds || [];
  if (!remoteDeleted.length) return;
  const deleted = getDeletedPersonIds();
  remoteDeleted.forEach((id) => deleted.add(id));
  state.deletedPersonIds = [...deleted];
  localStorage.setItem(DELETED_PERSON_IDS_KEY, JSON.stringify(state.deletedPersonIds));
}

function getDeletedFolderIdsFrom(appState) {
  const merged = new Set();
  (appState?.deletedFolderIds || []).forEach((id) => merged.add(id));
  try {
    const raw = localStorage.getItem(DELETED_FOLDER_IDS_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    if (Array.isArray(ids)) ids.filter(Boolean).forEach((id) => merged.add(id));
  } catch {
    // ignore broken tombstone storage
  }
  return merged;
}

function getDeletedFolderIds() {
  return getDeletedFolderIdsFrom(state);
}

function addDeletedFolderId(folderId) {
  if (!folderId) return;
  const deleted = getDeletedFolderIds();
  deleted.add(folderId);
  state.deletedFolderIds = [...deleted];
  localStorage.setItem(DELETED_FOLDER_IDS_KEY, JSON.stringify(state.deletedFolderIds));
}

function reconcileDeletedFolderIds(remoteState) {
  const remoteDeleted = remoteState?.deletedFolderIds || [];
  if (!remoteDeleted.length) return;
  const deleted = getDeletedFolderIds();
  remoteDeleted.forEach((id) => deleted.add(id));
  state.deletedFolderIds = [...deleted];
  localStorage.setItem(DELETED_FOLDER_IDS_KEY, JSON.stringify(state.deletedFolderIds));
}

function applyDeletedFolderFilter(appState) {
  const deleted = getDeletedFolderIdsFrom(appState);
  if (!deleted.size) return appState;
  const folders = (appState.folders || []).filter((folder) => !deleted.has(folder.id));
  const folderIds = new Set(folders.map((folder) => folder.id));
  return {
    ...appState,
    folders,
    activeFolderIds: (appState.activeFolderIds || []).filter((id) => folderIds.has(id)),
    people: (appState.people || []).map((person) => ({
      ...person,
      folderIds: Array.isArray(person.folderIds)
        ? person.folderIds.filter((id) => folderIds.has(id))
        : [],
    })),
    deletedFolderIds: [...deleted],
  };
}

function filterRemoteFolders(remoteState) {
  const deleted = getDeletedFolderIdsFrom(remoteState);
  const remoteDeleted = remoteState?.deletedFolderIds || [];
  remoteDeleted.forEach((id) => deleted.add(id));
  if (!deleted.size) return remoteState;
  const folders = (remoteState.folders || []).filter((folder) => !deleted.has(folder.id));
  const folderIds = new Set(folders.map((folder) => folder.id));
  return {
    ...remoteState,
    folders,
    activeFolderIds: (remoteState.activeFolderIds || []).filter((id) => folderIds.has(id)),
    deletedFolderIds: [...deleted],
  };
}

function applyDeletedPersonFilter(appState) {
  const deleted = getDeletedPersonIdsFrom(appState);
  if (!deleted.size) return appState;
  const filteredPeople = (appState.people || []).filter((person) => !deleted.has(person.id));
  return {
    ...appState,
    people: filteredPeople,
    deletedPersonIds: [...deleted],
  };
}

function filterRemotePeople(remoteState) {
  const filtered = filterRemoteFolders(remoteState);
  const deleted = getDeletedPersonIdsFrom(filtered);
  const remoteDeleted = remoteState?.deletedPersonIds || [];
  remoteDeleted.forEach((id) => deleted.add(id));
  if (!deleted.size) return filtered;
  return {
    ...filtered,
    people: (filtered.people || []).filter((person) => !deleted.has(person.id)),
    deletedPersonIds: [...deleted],
  };
}

function dedupePeopleById(people) {
  if (window.FamilyMerge?.dedupePeopleById) {
    return window.FamilyMerge.dedupePeopleById(people);
  }
  const map = new Map();
  (people || []).forEach((person) => {
    if (person?.id && !map.has(person.id)) map.set(person.id, person);
  });
  return [...map.values()];
}

function orderPeopleLike(templatePeople, mergedPeople) {
  if (window.FamilyMerge?.orderPeopleLike) {
    return window.FamilyMerge.orderPeopleLike(templatePeople, mergedPeople);
  }
  const byId = new Map((mergedPeople || []).filter((p) => p?.id).map((p) => [p.id, p]));
  const ordered = [];
  const seen = new Set();
  (templatePeople || []).forEach((person) => {
    if (!person?.id || seen.has(person.id)) return;
    const merged = byId.get(person.id);
    if (merged) {
      ordered.push(merged);
      seen.add(person.id);
    }
  });
  (mergedPeople || []).forEach((person) => {
    if (person?.id && !seen.has(person.id)) {
      ordered.push(person);
      seen.add(person.id);
    }
  });
  return ordered;
}

function finalizePeopleAfterMerge(localState, remoteState, mergedState) {
  let people = dedupePeopleById(mergedState.people || []);
  const localUi = Number(localState?.uiUpdatedAt || 0);
  const remoteUi = Number(remoteState?.uiUpdatedAt || 0);
  const template = localUi >= remoteUi ? localState?.people : remoteState?.people;
  people = orderPeopleLike(template, people);
  return { ...mergedState, people };
}

function dropRemoteOnlyGhosts(localState, remoteState, mergedState) {
  const deletedPeople = getDeletedPersonIdsFrom(localState);
  const deletedFolders = getDeletedFolderIdsFrom(localState);
  let people = (mergedState.people || []).filter((person) => !deletedPeople.has(person.id));
  let folders = (mergedState.folders || []).filter((folder) => !deletedFolders.has(folder.id));
  const folderIds = new Set(folders.map((folder) => folder.id));
  return {
    ...mergedState,
    people,
    folders,
    activeFolderIds: (mergedState.activeFolderIds || []).filter((id) => folderIds.has(id)),
  };
}

function scrubFiltersToPeople(appState) {
  const names = new Set((appState.people || []).map((person) => getPersonFirstName(person)));
  const folderIds = new Set((appState.folders || []).map((folder) => folder.id));
  return {
    ...appState,
    activeFirstNames: (appState.activeFirstNames || []).filter((name) => names.has(name)),
    activeFolderIds: (appState.activeFolderIds || []).filter((id) => folderIds.has(id)),
  };
}

function preferLocalFiltersWhenShrunk(localState, remoteState, mergedState) {
  const localPeople = (localState.people || []).length;
  const remotePeople = (remoteState.people || []).length;
  const localFolders = (localState.folders || []).length;
  const remoteFolders = (remoteState.folders || []).length;
  const shouldPreferLocal = localPeople > 0
    && (localPeople < remotePeople || localFolders < remoteFolders);
  if (!shouldPreferLocal) return mergedState;
  const names = new Set((mergedState.people || []).map((person) => getPersonFirstName(person)));
  const folderIds = new Set((mergedState.folders || []).map((folder) => folder.id));
  return {
    ...mergedState,
    activeFirstNames: (localState.activeFirstNames || []).filter((name) => names.has(name)),
    activeFolderIds: (localState.activeFolderIds || []).filter((id) => folderIds.has(id)),
    singleFilterMode: Boolean(localState.singleFilterMode),
  };
}

function mergePeoplePreservingLocalEdits(localState, remoteState, mergedState) {
  const remoteIds = new Set((remoteState.people || []).map((person) => person.id));
  const byId = new Map();

  (mergedState.people || []).forEach((person) => {
    if (person?.id) byId.set(person.id, normalizePerson(person));
  });

  (localState.people || []).forEach((person) => {
    if (person?.id && !remoteIds.has(person.id)) {
      byId.set(person.id, normalizePerson(person));
    }
  });

  if ((localState.people || []).length === 0 && (remoteState.people || []).length > 0) {
    const deleted = getDeletedPersonIdsFrom(localState);
    (remoteState.people || []).forEach((person) => {
      if (person?.id && !deleted.has(person.id)) {
        byId.set(person.id, normalizePerson(person));
      }
    });
  }

  return { ...mergedState, people: dedupePeopleById([...byId.values()]) };
}

function preserveLocalBotFields(localState, mergedState) {
  const localById = new Map((localState.people || []).map((p) => [p.id, p]));
  return {
    ...mergedState,
    people: (mergedState.people || []).map((person) => {
      const local = localById.get(person.id);
      if (!local) return normalizePerson(person);
      if (!local.botPendingSync && local.botConfirmedInBot == null) {
        return normalizePerson(person);
      }
      return normalizePerson({
        ...person,
        useInBot: local.botPendingSync ? local.useInBot : (
          local.botConfirmedInBot != null ? local.botConfirmedInBot : person.useInBot
        ),
        botConfirmedInBot: local.botConfirmedInBot != null
          ? local.botConfirmedInBot
          : person.botConfirmedInBot,
        botSlotIndex: local.botSlotIndex != null ? local.botSlotIndex : person.botSlotIndex,
        botPendingSync: local.botPendingSync,
        botPendingAction: local.botPendingAction,
      });
    }),
  };
}

function preserveLocalPeople(localState, mergedState) {
  const mergedIds = new Set((mergedState.people || []).map((person) => person.id));
  const restored = [...(mergedState.people || [])];
  (localState.people || []).forEach((person) => {
    if (!mergedIds.has(person.id)) {
      restored.push(normalizePerson(person));
    }
  });
  return { ...mergedState, people: restored };
}

function openAppDialog(dialog) {
  if (!dialog) return;
  blurActiveInput();
  try {
    if (!dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
      blurActiveInput();
      setTimeout(blurActiveInput, 0);
      setTimeout(blurActiveInput, 120);
      pushAppBackHistory();
      return;
    }
  } catch (error) {
    console.warn("showModal failed", error);
  }
  if (!dialog.open) {
    dialog.setAttribute("open", "");
    blurActiveInput();
    setTimeout(blurActiveInput, 0);
    setTimeout(blurActiveInput, 120);
    pushAppBackHistory();
  }
}

const APP_BACK_DIALOGS = [
  elements?.operationDialog,
  elements?.personDialog,
  elements?.syncDialog,
  elements?.deleteFolderDialog,
  elements?.folderDialog,
  elements?.botOfflineDialog,
].filter(Boolean);

let appBackStackDepth = 0;
let suppressDialogBackSync = false;

function pushAppBackHistory() {
  try {
    history.pushState({ fcBack: 1 }, "");
    appBackStackDepth += 1;
  } catch (error) {
    // ignore
  }
}

function popAppBackHistoryWithBrowser() {
  if (appBackStackDepth <= 0) return;
  try {
    history.back();
  } catch (error) {
    appBackStackDepth = Math.max(0, appBackStackDepth - 1);
  }
}

function closeAppDialog(dialog) {
  if (!dialog || !dialog.open) return;
  suppressDialogBackSync = true;
  dialog.close();
  suppressDialogBackSync = false;
  if (appBackStackDepth > 0) {
    popAppBackHistoryWithBrowser();
  }
}

function closeTopAppDialog() {
  for (const dialog of APP_BACK_DIALOGS) {
    if (dialog && dialog.open) {
      suppressDialogBackSync = true;
      dialog.close();
      suppressDialogBackSync = false;
      return true;
    }
  }
  return false;
}

function reconcileUiAfterSystemBack() {
  blurActiveInput();
  if (closeTopAppDialog()) return true;
  if (activeView !== "main") {
    activeView = "main";
    updateViewMode();
    return true;
  }
  return false;
}

function handleAppBackNavigation() {
  if (!reconcileUiAfterSystemBack()) return false;
  if (appBackStackDepth > 0) {
    appBackStackDepth -= 1;
  }
  return true;
}

window.handleAppBackNavigation = handleAppBackNavigation;

function isNetworkAvailable() {
  if (window.FamilySync?.isNetworkAvailable) {
    return window.FamilySync.isNetworkAvailable();
  }
  if (typeof navigator.onLine === "boolean") return navigator.onLine;
  return true;
}

function openSyncDialog() {
  try {
    if (!window.FamilySync) {
      alert("Синхронизация не загрузилась. Обновите приложение до вер. 58.");
      return;
    }
    if (elements.familyCodeInput) {
      elements.familyCodeInput.value = FamilySync.getFamilyCode() || "";
    }
    if (FamilySync.getBotToken && elements.telegramBotTokenInput) {
      elements.telegramBotTokenInput.value = FamilySync.getBotToken() || "";
      elements.telegramChatIdInput.value = FamilySync.getChatId() || "";
      elements.telegramSecretInput.value = FamilySync.getSyncSecret() || "";
    }
    if (FamilySync.getServerUrl && elements.serverUrlInput) {
      elements.serverUrlInput.value = FamilySync.getServerUrl() || "";
    }
    openAppDialog(elements.syncDialog);
  } catch (error) {
    console.error("openSyncDialog", error);
    alert(`Не открылось окно синхронизации: ${error?.message || error}`);
  }
}

function saveFamilyCode(event) {
  event.preventDefault();
  if (FamilySync.setBotToken) {
    if (!FamilySync.setBotToken(elements.telegramBotTokenInput.value)) {
      alert("Укажите токен бота.");
      return;
    }
    if (!FamilySync.setChatId(elements.telegramChatIdInput.value)) {
      alert("Укажите ID канала (например -100...).");
      return;
    }
    if (!FamilySync.setSyncSecret(elements.telegramSecretInput.value)) {
      alert("Укажите секрет синхронизации.");
      return;
    }
  } else if (FamilySync.setServerUrl) {
    const serverOk = FamilySync.setServerUrl(elements.serverUrlInput.value);
    if (!serverOk) {
      alert("Адрес ПК: например http://192.168.1.100:8767");
      return;
    }
  }
  const ok = FamilySync.setFamilyCode(elements.familyCodeInput.value);
  if (!ok) {
    alert("Код семьи: минимум 4 буквы или цифры.");
    return;
  }
  closeAppDialog(elements.syncDialog);
  startCloudSync();
  FamilySync.push(state);
  retryBotExportIfNeeded();
  if (FamilySync.testTelegramConnection) {
    FamilySync.testTelegramConnection().then((result) => {
      if (!result.ok) {
        alert(
          `Код семьи сохранён, но Telegram не отвечает: ${result.error}\n\n`
          + "Проверьте: бот — админ канала с правом «закреплять»; токен не отозван; "
          + "на телефоне не блокируют api.telegram.org (VPN или telegramApiBase в telegram-config.js).",
        );
      }
    });
  }
}

function bindSyncDialogOpen() {
  let lastOpenAt = 0;
  const open = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const now = Date.now();
    if (now - lastOpenAt < 400) return;
    lastOpenAt = now;
    openSyncDialog();
  };
  if (elements.openSyncDialogButton) {
    elements.openSyncDialogButton.addEventListener("click", open);
    elements.openSyncDialogButton.addEventListener("touchend", open, { passive: false });
  }
  if (elements.syncStatus) {
    elements.syncStatus.style.cursor = "pointer";
    elements.syncStatus.addEventListener("click", open);
    elements.syncStatus.addEventListener("touchend", open, { passive: false });
  }
}

function bindPersonFormEnterNavigation() {
  const fields = [
    elements.personFirstNameInput,
    elements.personLastNameInput,
    elements.personBalanceInput,
    elements.personPhoneInput,
    elements.personCardNumberInput,
    elements.personCardDetailsInput,
    elements.personProfileNoteInput,
  ].filter(Boolean);

  fields.slice(0, -1).forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const index = fields.indexOf(input);
      const next = fields[index + 1];
      if (next) next.focus();
    });
  });
}

function bindEvents() {
  if (!elements.addPersonButton) {
    showBootError("Не загрузился интерфейс (index.html)");
    return;
  }
  elements.addPersonButton.addEventListener("click", () => openPersonDialog());
  elements.detailsToggleButton.addEventListener("click", toggleDetailsView);
  elements.historyToggleButton.addEventListener("click", toggleHistoryView);
  bindSyncDialogOpen();
  elements.cancelSyncButton.addEventListener("click", () => closeAppDialog(elements.syncDialog));
  elements.syncForm.addEventListener("submit", saveFamilyCode);
  elements.createFamilyCodeButton.addEventListener("click", () => {
    elements.familyCodeInput.value = FamilySync.createFamilyCode();
  });
  if (elements.clearLocalDataButton) {
    elements.clearLocalDataButton.addEventListener("click", () => wipeAllAppData({ pushToCloud: false }));
  }
  if (elements.clearCloudDataButton) {
    elements.clearCloudDataButton.addEventListener("click", () => wipeAllAppData({ pushToCloud: true }));
  }
  elements.cancelPersonButton.addEventListener("click", () => closeAppDialog(elements.personDialog));
  elements.personForm.addEventListener("submit", savePerson);
  bindPersonFormEnterNavigation();
  if (elements.personCardNumberInput) {
    elements.personCardNumberInput.addEventListener("input", handleCardNumberInput);
  }
  if (elements.personCardDetailsInput) {
    elements.personCardDetailsInput.addEventListener("input", handleCardDetailsInput);
  }
  if (elements.personPhoneInput) {
    elements.personPhoneInput.addEventListener("input", handlePhoneInput);
  }
  elements.addFolderButton.addEventListener("click", openFolderDialog);
  elements.deleteFolderButton.addEventListener("click", openDeleteFolderDialog);
  elements.cancelFolderButton.addEventListener("click", () => closeAppDialog(elements.folderDialog));
  elements.folderForm.addEventListener("submit", saveFolder);
  elements.cancelDeleteFolderButton.addEventListener("click", () => closeAppDialog(elements.deleteFolderDialog));
  elements.deleteFolderForm.addEventListener("submit", deleteSelectedFolder);
  elements.folderList.addEventListener("click", handleFolderClick);
  elements.firstNameFilterList.addEventListener("click", handleFirstNameFilterClick);
  elements.singleFilterToggle.addEventListener("click", toggleSingleFilterMode);
  elements.deletePersonButton.addEventListener("click", deleteEditingPerson);

  elements.clearHistoryButton.addEventListener("click", clearHistory);
  if (elements.nextMonthButton) {
    elements.nextMonthButton.addEventListener("click", nextMonthArchive);
  }
  if (elements.historyPeriodSelect) {
    elements.historyPeriodSelect.addEventListener("change", () => {
      const value = elements.historyPeriodSelect.value;
      activeHistoryPeriod = value === "current" ? null : Number(value);
      renderFilters();
      renderHistory();
      renderHistoryPeriodSelect();
    });
  }
  elements.personFilter.addEventListener("change", renderHistory);
  elements.historyList.addEventListener("change", handleHistoryTypeChange);
  elements.historyList.addEventListener("blur", handleHistoryNoteBlur, true);
  elements.historyList.addEventListener("keydown", handleHistoryNoteKeydown);
  if (elements.commentFilter) {
    elements.commentFilter.addEventListener("input", renderHistory);
  }
  elements.typeFilter.addEventListener("change", () => {
    syncTabs(elements.typeFilter.value);
    renderHistory();
  });

  document.querySelectorAll(".tab[data-type]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const type = tab.dataset.type;
      elements.typeFilter.value = type;
      syncTabs(type);
      renderHistory();
    });
  });

  elements.peopleList.addEventListener("click", handlePeopleClick);
  bindPeopleDragReorder();
  elements.detailsPeopleList.addEventListener("click", handleDetailsPeopleClick);
  elements.detailsCopyAll.addEventListener("click", handleDetailsCopyAllClick);
  elements.operationForm.addEventListener("submit", confirmOperation);
  elements.cancelOperationButton.addEventListener("click", closeOperationDialog);
  elements.exitOperationButton.addEventListener("click", closeOperationDialog);
  if (elements.amountKeypad) {
    elements.amountKeypad.addEventListener("click", handleAmountKeypadClick);
  }
  elements.resetAmountButton.addEventListener("click", clearAmountAll);

  elements.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.installButton.hidden = false;
  });

  window.addEventListener("popstate", () => {
    appBackStackDepth = Math.max(0, appBackStackDepth - 1);
    reconcileUiAfterSystemBack();
  });

  APP_BACK_DIALOGS.forEach((dialog) => {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeAppDialog(dialog);
    });
  });
}

function getDefaultState() {
  const requiredEpoch = getRequiredDataEpoch();
  return {
    people: [],
    history: [],
    historyMonths: [],
    historyClearedAtMs: 0,
    folders: [],
    activeFolderIds: [],
    activeFirstNames: [],
    singleFilterMode: false,
    botGroupId: null,
    uiUpdatedAt: 0,
    wipedAtMs: 0,
    dataEpoch: requiredEpoch > 0 ? requiredEpoch : 0,
    deletedPersonIds: [],
    deletedFolderIds: [],
  };
}

function hasLocalAppData(appState) {
  const deleted = getDeletedPersonIdsFrom(appState);
  const people = (appState?.people || []).filter((person) => !deleted.has(person.id));
  return people.length > 0 || (appState?.history || []).length > 0;
}

function shouldReplaceWithRemoteWipe(localState, remoteState) {
  const remoteWipe = Number(remoteState?.wipedAtMs || 0);
  const localWipe = Number(localState?.wipedAtMs || 0);
  return remoteWipe > 0 && remoteWipe >= localWipe;
}

function countActivePeople(appState) {
  const deleted = getDeletedPersonIdsFrom(appState);
  return (appState?.people || []).filter((person) => !deleted.has(person.id)).length;
}

function ensureStateDataEpoch(appState) {
  const required = getRequiredDataEpoch();
  if (!required || !appState) return appState;
  const current = Number(appState.dataEpoch || 0);
  if (current >= required) return appState;
  return { ...appState, dataEpoch: required };
}

function shouldRejectStaleRemoteState(localState, remoteState) {
  const requiredEpoch = getRequiredDataEpoch();
  if (requiredEpoch > 0 && !remoteMeetsDataEpoch(remoteState) && hasRemoteAppData(remoteState)) {
    return true;
  }

  const localWipe = Number(localState?.wipedAtMs || 0);
  const remoteWipe = Number(remoteState?.wipedAtMs || 0);
  const cloudWipe = Number(localStorage.getItem(CLOUD_WIPE_AT_KEY) || 0);
  const effectiveLocalWipe = Math.max(localWipe, cloudWipe);
  const localCount = countActivePeople(localState);
  const remoteCount = countActivePeople(remoteState);

  if (remoteWipe > 0 && remoteWipe >= effectiveLocalWipe) return false;

  if (effectiveLocalWipe > 0 && remoteWipe < effectiveLocalWipe) {
    if (remoteCount > localCount + 2) return true;
    if (remoteCount > localCount + 1 && remoteWipe === 0) return true;
    return false;
  }

  if (remoteCount > localCount + 2 && effectiveLocalWipe >= remoteWipe && remoteWipe > 0) {
    return true;
  }
  return false;
}

function reconcileFiltersAfterSync() {
  if (!state.people.length) return;
  const visible = getVisiblePeople();
  if (visible.length >= state.people.length) return;
  state.activeFolderIds = [];
  state.activeFirstNames = [...new Set(
    state.people.map((person) => getPersonFirstName(person)).filter(Boolean),
  )];
  state.uiUpdatedAt = Date.now();
  filtersAutoCleared = true;
}

function applyRemoteStateAsReplace(normalizedRemote, remoteVersion = 0) {
  state = applyDeletedPersonFilter(
    applyDeletedFolderFilter(normalizeLoadedState(filterRemotePeople(ensureStateDataEpoch(normalizedRemote)))),
  );
  state.people = (state.people || []).map((person) => normalizePerson({
    ...person,
    botPendingSync: false,
    botPendingAction: null,
  }));
  state.deletedPersonIds = [...(state.deletedPersonIds || [])];
  state.deletedFolderIds = [...(state.deletedFolderIds || [])];
  localStorage.setItem(DELETED_PERSON_IDS_KEY, JSON.stringify(state.deletedPersonIds));
  localStorage.setItem(DELETED_FOLDER_IDS_KEY, JSON.stringify(state.deletedFolderIds));
  applySyncMetaFromRemote(state);
  syncBalancesFromHistory();
  if (state.wipedAtMs > 0) {
    localStorage.setItem(CLOUD_WIPE_AT_KEY, String(state.wipedAtMs));
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.setItem(STORAGE_BACKUP_KEY, JSON.stringify(state));
  if (remoteVersion > 0) {
    localStorage.setItem("family-counter-local-version", String(remoteVersion));
    localStorage.removeItem(LOCAL_PUSH_REVISION_KEY);
  }
  reconcileFiltersAfterSync();
  reconcileBotPendingFromRemote(normalizedRemote);
  tryConfirmCloudSync(state);
  render();
}

function wipeAllAppData(options = {}) {
  const pushToCloud = Boolean(options.pushToCloud);
  const message = pushToCloud
    ? "Удалить ВСЕ карты, банки и историю на телефоне и ЗАМЕНИТЬ данные в Telegram на пустое состояние? Другие телефоны при синхронизации тоже очистятся."
    : "Удалить ВСЕ данные только на этом телефоне? (Карты, банки, история, фильтры)";
  if (!confirm(message)) return;

  clearAllFamilyCounterStorage({ keepSyncSettings: true });
  clearAppCaches();
  state = getDefaultState();
  state.wipedAtMs = Date.now();
  state.uiUpdatedAt = Date.now();
  const requiredEpoch = getRequiredDataEpoch();
  if (requiredEpoch > 0) {
    state.dataEpoch = requiredEpoch;
    localStorage.setItem(DATA_EPOCH_KEY, String(requiredEpoch));
  }
  localStorage.setItem(CLOUD_WIPE_AT_KEY, String(state.wipedAtMs));
  localStorage.setItem(FACTORY_RESET_PENDING_KEY, "1");
  editingPersonId = null;
  currentOperation = null;
  saveState({ skipPush: true });
  render();

  if (pushToCloud && window.FamilySync) {
    if (FamilySync.pushImmediate) {
      FamilySync.pushImmediate(state, { replaceRemote: true })
        .then(() => {
          localStorage.setItem(CLOUD_WIPE_AT_KEY, String(state.wipedAtMs));
          alert("Данные очищены и отправлены в облако Telegram.");
        })
        .catch(() => alert("Данные очищены на телефоне. Облако: нет сети или ошибка отправки."));
    } else if (FamilySync.push) {
      FamilySync.push(state, { replaceRemote: true });
      alert("Данные очищены и отправлены в облако Telegram.");
    }
  } else {
    alert("Локальные данные удалены.");
  }
}

function loadState() {
  let primary = null;
  let backup = null;

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) primary = normalizeLoadedState(JSON.parse(saved));
  } catch {
    // ignore broken primary storage
  }

  try {
    const raw = localStorage.getItem(STORAGE_BACKUP_KEY);
    if (raw) backup = normalizeLoadedState(JSON.parse(raw));
  } catch {
    // ignore broken backup
  }

  const hasData = (parsed) =>
    (parsed?.people?.length || 0) > 0 || (parsed?.history?.length || 0) > 0;

  let loaded = null;
  if (primary && hasData(primary)) {
    loaded = primary;
  } else if (backup && hasData(backup)) {
    loaded = backup;
  } else if (primary) {
    loaded = primary;
  } else if (backup) {
    loaded = backup;
  }

  if (!loaded) return getDefaultState();

  loaded = migrateDeletedPersonIds(loaded);
  loaded = migrateDeletedFolderIds(loaded);
  const filtered = ensureStateDataEpoch(
    applyDeletedPersonFilter(applyDeletedFolderFilter(loaded)),
  );
  if (window.FamilyMerge?.replayBalancesFromHistory) {
    const fullHistory = window.FamilyMerge.collectAllHistory
      ? FamilyMerge.collectAllHistory(filtered)
      : (filtered.history || []);
    filtered.people = FamilyMerge.replayBalancesFromHistory(filtered.people, fullHistory);
  }
  const json = JSON.stringify(filtered);
  localStorage.setItem(STORAGE_KEY, json);
  localStorage.setItem(STORAGE_BACKUP_KEY, json);
  return filtered;
}

function migrateDeletedPersonIds(appState) {
  const merged = new Set();
  (appState.deletedPersonIds || []).forEach((id) => merged.add(id));
  try {
    const raw = localStorage.getItem(DELETED_PERSON_IDS_KEY);
    const stored = raw ? JSON.parse(raw) : [];
    if (Array.isArray(stored)) stored.forEach((id) => merged.add(id));
  } catch {
    // ignore broken tombstone storage
  }
  const deletedPersonIds = [...merged];
  localStorage.setItem(DELETED_PERSON_IDS_KEY, JSON.stringify(deletedPersonIds));
  return { ...appState, deletedPersonIds };
}

function migrateDeletedFolderIds(appState) {
  const merged = new Set();
  (appState.deletedFolderIds || []).forEach((id) => merged.add(id));
  try {
    const raw = localStorage.getItem(DELETED_FOLDER_IDS_KEY);
    const stored = raw ? JSON.parse(raw) : [];
    if (Array.isArray(stored)) stored.forEach((id) => merged.add(id));
  } catch {
    // ignore broken tombstone storage
  }
  const deletedFolderIds = [...merged];
  localStorage.setItem(DELETED_FOLDER_IDS_KEY, JSON.stringify(deletedFolderIds));
  return { ...appState, deletedFolderIds };
}

function normalizeLoadedState(parsed) {
  if (!parsed) return getDefaultState();
  let withTombstones = migrateDeletedPersonIds(migrateDeletedFolderIds(parsed));
  withTombstones = applyDeletedPersonFilter(applyDeletedFolderFilter(withTombstones));
  const folders = Array.isArray(withTombstones.folders) ? withTombstones.folders : [];
  const folderIds = new Set(folders.map((folder) => folder.id));
  const people = dedupePeopleById(
    Array.isArray(withTombstones.people)
      ? withTombstones.people.map((person) => normalizePerson({
        ...person,
        folderIds: Array.isArray(person.folderIds)
          ? person.folderIds.filter((id) => folderIds.has(id))
          : [],
      }))
      : [],
  );
  const existingFirstNames = new Set(people.map((person) => getPersonFirstName(person)));
  const botGroupId = withTombstones.botGroupId != null && withTombstones.botGroupId !== ""
    ? Number(withTombstones.botGroupId)
    : null;
  return {
    people,
    history: Array.isArray(withTombstones.history) ? withTombstones.history : [],
    historyMonths: Array.isArray(withTombstones.historyMonths)
      ? withTombstones.historyMonths
        .map((month) => normalizeHistoryMonth(month))
        .filter(Boolean)
      : [],
    historyClearedAtMs: Number(withTombstones.historyClearedAtMs || 0),
    folders,
    activeFolderIds: Array.isArray(withTombstones.activeFolderIds)
      ? withTombstones.activeFolderIds.filter((id) => folderIds.has(id))
      : [],
    activeFirstNames: Array.isArray(withTombstones.activeFirstNames)
      ? withTombstones.activeFirstNames.filter((name) => existingFirstNames.has(name))
      : [],
    singleFilterMode: Boolean(withTombstones.singleFilterMode),
    botGroupId: Number.isFinite(botGroupId) ? botGroupId : null,
    uiUpdatedAt: Number(withTombstones.uiUpdatedAt || 0),
    wipedAtMs: Number(withTombstones.wipedAtMs || 0),
    dataEpoch: Number(withTombstones.dataEpoch || 0),
    syncAlert: withTombstones.syncAlert || null,
    syncHealth: withTombstones.syncHealth || null,
    deletedPersonIds: Array.isArray(withTombstones.deletedPersonIds)
      ? withTombstones.deletedPersonIds.filter(Boolean)
      : [],
    deletedFolderIds: Array.isArray(withTombstones.deletedFolderIds)
      ? withTombstones.deletedFolderIds.filter(Boolean)
      : [],
  };
}

function resolvePersonInBotFlag(person) {
  if (!person) return false;
  if (person.botPendingSync && person.botPendingAction === "upsert") return true;
  if (person.botPendingSync && person.botPendingAction === "clear") return false;
  if (person.botConfirmedInBot != null) return Boolean(person.botConfirmedInBot);
  return Boolean(person.useInBot);
}

function sanitizePersonForCloud(person) {
  const normalized = normalizePerson(person);
  const inBot = resolvePersonInBotFlag(normalized);
  return normalizePerson({
    ...normalized,
    useInBot: inBot,
    botConfirmedInBot: inBot,
    botPendingSync: false,
    botPendingAction: null,
  });
}

function sanitizeStateForCloud(appState) {
  if (!appState) return appState;
  return {
    ...appState,
    people: (appState.people || []).map((person) => sanitizePersonForCloud(person)),
  };
}

window.sanitizeStateForCloud = sanitizeStateForCloud;

function reconcileBotPendingFromRemote(normalizedRemote) {
  if (!hasBotPendingSync() || !normalizedRemote) return;
  const remoteById = new Map((normalizedRemote.people || []).map((person) => [person.id, person]));
  state.people = state.people.map((person) => {
    if (!person.botPendingSync) return normalizePerson(person);
    const remote = remoteById.get(person.id);
    if (!remote) return normalizePerson(person);
    const remoteInBot = remote.botConfirmedInBot != null
      ? Boolean(remote.botConfirmedInBot)
      : Boolean(remote.useInBot);
    if (person.botPendingAction === "upsert" && remoteInBot) {
      return normalizePerson({
        ...person,
        useInBot: true,
        botConfirmedInBot: true,
        botSlotIndex: remote.botSlotIndex != null ? remote.botSlotIndex : person.botSlotIndex,
        botPendingSync: false,
        botPendingAction: null,
      });
    }
    if (person.botPendingAction === "clear" && !remoteInBot) {
      return normalizePerson({
        ...person,
        useInBot: false,
        botConfirmedInBot: false,
        botSlotIndex: null,
        botPendingSync: false,
        botPendingAction: null,
      });
    }
    return normalizePerson(person);
  });
  if (!hasBotPendingSync()) {
    localStorage.removeItem(PENDING_BOT_REVISION_KEY);
    localStorage.removeItem(PENDING_BOT_AT_KEY);
    if (window.FamilySync?.stopPendingBotPoll) {
      FamilySync.stopPendingBotPoll();
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizePerson(person) {
  let firstName = String(person.firstName ?? "").trim();
  let lastName = String(person.lastName ?? "").trim();

  if (!firstName && person.name) {
    const parts = String(person.name).trim().split(/\s+/);
    firstName = parts[0] || "";
    lastName = parts.slice(1).join(" ");
  }

  const pending = Boolean(person.botPendingSync);
  const hasExplicitConfirmed = person.botConfirmedInBot != null;
  const confirmed = hasExplicitConfirmed
    ? Boolean(person.botConfirmedInBot)
    : Boolean(person.useInBot);
  const useInBot = pending && person.botPendingAction === "upsert"
    ? true
    : (pending && person.botPendingAction === "clear"
      ? Boolean(person.useInBot)
      : confirmed);

  return {
    ...person,
    firstName,
    lastName,
    name: formatPersonName(firstName, lastName),
    phone: String(person.phone ?? "").trim(),
    cardNumber: String(person.cardNumber ?? "").trim(),
    cardDetails: String(person.cardDetails ?? "").trim(),
    profileNote: String(person.profileNote ?? "").trim(),
    cardTint: normalizeCardTint(person.cardTint),
    useInBot,
    botPendingSync: pending,
    botPendingAction: person.botPendingAction || null,
    botConfirmedInBot: confirmed,
    botSlotIndex: person.botSlotIndex != null && Number.isFinite(Number(person.botSlotIndex))
      ? Number(person.botSlotIndex)
      : null,
    fieldUpdatedAt: person.fieldUpdatedAt && typeof person.fieldUpdatedAt === "object"
      ? { ...person.fieldUpdatedAt }
      : {},
  };
}

function formatPersonName(firstName, lastName) {
  const first = String(firstName).trim();
  const last = String(lastName).trim();
  return last ? `${first} ${last}` : first;
}

function getPersonFirstName(person) {
  return String(person.firstName ?? "").trim() || getFirstName(person.name);
}

function getPersonLastName(person) {
  const last = String(person.lastName ?? "").trim();
  if (last) return last;
  const name = String(person.name ?? "").trim();
  if (!name) return "";
  const parts = name.split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : "";
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `d-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function touchPersonFields(person, fields, at = Date.now()) {
  const fieldUpdatedAt = { ...(person.fieldUpdatedAt || {}) };
  fields.forEach((field) => {
    fieldUpdatedAt[field] = at;
  });
  return normalizePerson({ ...person, fieldUpdatedAt });
}

function normalizeCardTint(value) {
  const tint = String(value ?? "").trim();
  return PERSON_BANK_THEME_IDS.has(tint) ? tint : "";
}

function getBankThemeMeta(cardTint) {
  const id = normalizeCardTint(cardTint);
  return PERSON_BANK_THEMES.find((item) => item.id === id) || PERSON_BANK_THEMES[0];
}

function getPersonCardTintClass(cardTint) {
  const tint = normalizeCardTint(cardTint);
  return tint ? `person-card-bank-${tint}` : "";
}

const BANK_ICON_MARK_IDS = new Set(PERSON_BANK_THEMES.map((item) => item.id).filter(Boolean));

function buildBankIconMark(meta) {
  const mark = document.createElement("span");
  mark.className = "bank-app-icon-mark";
  if (!meta.id || !BANK_ICON_MARK_IDS.has(meta.id)) {
    mark.textContent = meta.short;
    return mark;
  }
  mark.classList.add(`bank-app-icon-mark--${meta.id}`);
  if (meta.id === "otp") {
    mark.classList.add("bank-app-icon-mark--otp-text");
  }
  mark.textContent = meta.short;
  return mark;
}

function touchPersonProfileFields(person, at = Date.now()) {
  return touchPersonFields(person, [
    "firstName",
    "lastName",
    "name",
    "phone",
    "cardNumber",
    "cardDetails",
    "profileNote",
    "cardTint",
    "folderIds",
  ], at);
}

function touchPersonBalanceField(person, at = Date.now()) {
  return touchPersonFields(person, ["balance"], at);
}

function touchPersonUseInBot(personId, enabled, at = Date.now()) {
  state.people = state.people.map((person) => {
    if (person.id !== personId) return normalizePerson(person);
    return touchPersonFields(normalizePerson({
      ...person,
      useInBot: enabled,
    }), ["useInBot", "botSlotIndex"], at);
  });
}

function getBotConfirmedInBot(person) {
  return resolvePersonInBotFlag(person);
}

function getBotDisplayInBot(person) {
  return resolvePersonInBotFlag(person);
}

function renderBotToggleButton(botToggle, person) {
  if (!botToggle) return;
  const pending = Boolean(person.botPendingSync);
  const displayInBot = getBotDisplayInBot(person);
  const slotLabel = person.botSlotIndex != null
    ? person.botSlotIndex + 1
    : (getPersonNumber(person) || "");
  let ariaLabel = "Не в боте";
  let icon = "\u2715";
  if (pending) {
    ariaLabel = "Ожидание ответа бота";
    icon = "";
  } else if (displayInBot) {
    ariaLabel = slotLabel ? `В боте ${slotLabel}` : "В боте";
    icon = "\u2713";
  }
  botToggle.textContent = icon;
  botToggle.setAttribute("aria-label", ariaLabel);
  botToggle.classList.remove("active", "inactive", "pending");
  if (pending) {
    botToggle.classList.add("pending");
  } else if (displayInBot) {
    botToggle.classList.add("active");
  } else {
    botToggle.classList.add("inactive");
  }
}

function renderSyncNoticeRow() {
  const noticeRow = elements.syncNoticeRow;
  const noticeText = elements.syncNoticeText;
  if (!noticeRow || !noticeText) return;

  const cloudPending = localStorage.getItem(CLOUD_CONFIRM_FP_KEY);
  const offlineEdits = Number(localStorage.getItem(LOCAL_PUSH_REVISION_KEY) || 0) > 0;
  const pending = hasBotPendingSync() && !canPushBotNow();
  const alert = state.syncAlert;
  const health = state.syncHealth;
  const syncMsg = alert?.message || (health && !health.ok ? health.message : "");
  const successVisible = elements.botSuccessBanner && !elements.botSuccessBanner.hidden;

  let text = "";
  let level = "warn";
  if (cloudPending) {
    text = "Проверка синхронизации в канале…";
    level = "warn";
  } else if (offlineEdits && !isNetworkAvailable()) {
    text = "Изменения сохранены — отправим при подключении к сети";
    level = "warn";
  } else if (pending) {
    text = "Ожидание ответа бота на ПК…";
    level = "warn";
  } else if (syncMsg) {
    text = `Синхронизация: ${syncMsg}`;
    level = alert?.level === "error" || (health && !health.ok) ? "error" : "warn";
  } else if (successVisible && !cloudPending && !hasBotPendingSync()) {
    text = "Данные успешно отправлены";
    level = "ok";
  }

  if (!text) {
    noticeRow.hidden = true;
    noticeText.textContent = "";
    noticeRow.dataset.level = "";
    return;
  }

  noticeRow.hidden = false;
  noticeText.textContent = text;
  noticeRow.dataset.level = level;
}

function renderSyncAlertBanner() {
  renderSyncNoticeRow();
}

function applySyncMetaFromRemote(remoteState) {
  if (!remoteState) return;
  if (remoteState.syncAlert) {
    state.syncAlert = remoteState.syncAlert;
  }
  if (remoteState.syncHealth) {
    state.syncHealth = remoteState.syncHealth;
    if (!remoteState.syncHealth.ok) {
      state.syncAlert = {
        message: remoteState.syncHealth.message || "Проблема с каналом",
        atMs: remoteState.syncHealth.atMs || Date.now(),
        level: "error",
      };
    } else if (!remoteState.syncAlert) {
      state.syncAlert = null;
    }
  }
  renderSyncAlertBanner();
}

function preserveLocalBalanceOverrides(localState, mergedState) {
  const pending = Number(localStorage.getItem(LOCAL_PUSH_REVISION_KEY) || 0) > 0;
  const localHistory = localState?.history || [];
  const mergedHistory = mergedState?.history || [];
  const localById = new Map((localState.people || []).map((person) => [person.id, person]));

  let history = mergedHistory;
  if (pending) {
    const localSets = localHistory.filter((entry) => entry.type === "balance_set");
    if (localSets.length) {
      const withoutSets = mergedHistory.filter((entry) => entry.type !== "balance_set");
      history = [...withoutSets, ...localSets].sort(
        (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0),
      );
    }
  }

  const people = (mergedState.people || []).map((person) => {
    if (!pending) return person;
    const local = localById.get(person.id);
    if (!local) return person;
    const localBal = Number(local.balance || 0);
    const mergedBal = Number(person.balance || 0);
    if (localBal === mergedBal) return person;
    const hasLocalSet = localHistory.some(
      (entry) => entry.personId === person.id && entry.type === "balance_set",
    );
    const localManual = Number(local.balanceManualAt || 0);
    if (hasLocalSet || localManual > 0) {
      return {
        ...person,
        balance: localBal,
        balanceManualAt: local.balanceManualAt,
      };
    }
    return person;
  });

  if (!pending && history === mergedHistory) return mergedState;
  return { ...mergedState, history, people };
}

function syncBalancesFromHistory() {
  if (!window.FamilyMerge?.replayBalancesFromHistory) return;
  const fullHistory = window.FamilyMerge.collectAllHistory
    ? FamilyMerge.collectAllHistory(state)
    : (state.history || []);
  state.people = FamilyMerge.replayBalancesFromHistory(state.people, fullHistory);
}

function applyManualBalanceCorrection(personId, personName, balance, at) {
  state.history = (state.history || []).filter(
    (entry) => entry.personId !== personId || entry.type !== "balance_set",
  );
  state.history.push({
    id: makeId(),
    personId,
    personName,
    type: "balance_set",
    direction: "plus",
    amount: 0,
    balanceAfter: balance,
    note: "",
    createdAt: at,
    deviceId: getDeviceId(),
  });
}

function saveState(options = {}) {
  syncBalancesFromHistory();
  state = ensureStateDataEpoch(state);
  state.deletedPersonIds = [...getDeletedPersonIds()];
  state.deletedFolderIds = [...getDeletedFolderIds()];
  const json = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, json);
  localStorage.setItem(STORAGE_BACKUP_KEY, json);
  if (options.skipPush || !window.FamilySync) return;
  markLocalEditPending();
  const pushOptions = options.replaceRemote ? { replaceRemote: true } : null;
  if (options.immediatePush && FamilySync.pushImmediate) {
    FamilySync.pushImmediate(state, pushOptions).catch((error) => {
      console.warn("sync push immediate", error);
    });
    return;
  }
  if (FamilySync.push) {
    FamilySync.push(state, pushOptions);
  }
}

function normalizeHistoryMonth(month) {
  const index = Number(month?.index);
  if (!Number.isFinite(index) || index < 1) return null;
  return {
    index,
    title: String(month.title || `Месяц ${index}`),
    archivedAt: Number(month.archivedAt || 0),
    history: Array.isArray(month.history) ? month.history.filter((item) => item?.id) : [],
  };
}

function getHistoryMonths() {
  return Array.isArray(state.historyMonths) ? state.historyMonths : [];
}

function getActiveHistoryEntries() {
  if (activeHistoryPeriod == null) return state.history;
  const month = getHistoryMonths().find((item) => item.index === activeHistoryPeriod);
  return month?.history || [];
}

function renderHistoryPeriodSelect() {
  if (!elements.historyPeriodSelect) return;
  const months = getHistoryMonths();
  const selected = elements.historyPeriodSelect.value;
  elements.historyPeriodSelect.innerHTML = "<option value=\"current\">Текущий период</option>";
  months.forEach((month) => {
    const option = document.createElement("option");
    option.value = String(month.index);
    const count = (month.history || []).length;
    option.textContent = `${month.title} (${count})`;
    elements.historyPeriodSelect.append(option);
  });
  if (activeHistoryPeriod != null && months.some((month) => month.index === activeHistoryPeriod)) {
    elements.historyPeriodSelect.value = String(activeHistoryPeriod);
  } else if (selected === "current") {
    elements.historyPeriodSelect.value = "current";
    activeHistoryPeriod = null;
  } else if (months.some((month) => String(month.index) === selected)) {
    elements.historyPeriodSelect.value = selected;
    activeHistoryPeriod = Number(selected);
  } else {
    elements.historyPeriodSelect.value = "current";
    activeHistoryPeriod = null;
  }
  const viewingArchive = activeHistoryPeriod != null;
  if (elements.nextMonthButton) elements.nextMonthButton.disabled = viewingArchive;
  if (elements.clearHistoryButton) {
    elements.clearHistoryButton.disabled = viewingArchive;
  }
}

function stateRenderFingerprint(appState = state) {
  if (!appState) return "";
  const people = (appState.people || [])
    .map((p) => `${p.id}:${Number(p.balance || 0)}:${p.cardTint || ""}:${Boolean(p.useInBot)}:${Boolean(p.botPendingSync)}:${p.botPendingAction || ""}:${p.botConfirmedInBot}:${p.botSlotIndex ?? ""}`)
    .join("|");
  const historySig = (appState.history || [])
    .map((h) => `${h.id}:${h.type}:${h.amount}:${h.note || ""}:${Number(h.balanceAfter || 0)}`)
    .join("|");
  return JSON.stringify({
    people,
    historySig,
    folders: (appState.folders || []).map((f) => `${f.id}:${f.name}`).join(","),
    activeFolderIds: (appState.activeFolderIds || []).join(","),
    activeFirstNames: (appState.activeFirstNames || []).join(","),
    view: activeView,
    period: activeHistoryPeriod,
  });
}

let lastRenderFingerprint = "";

function render(force = false) {
  const fp = stateRenderFingerprint();
  if (!force && fp === lastRenderFingerprint) return;
  lastRenderFingerprint = fp;
  renderSyncNoticeRow();
  renderHistoryPeriodSelect();
  renderTotal();
  renderFolders();
  renderFirstNameFilters();
  renderPeople();
  renderDetailsPeople();
  renderHistoryTotals();
  renderFilters();
  renderHistory();
}

function renderHistoryTotals() {
  const counts = {
    income: 0,
    purchase: 0,
    transfer: 0,
  };
  state.history.forEach((item) => {
    if (counts[item.type] !== undefined) {
      counts[item.type] += 1;
    }
  });
  elements.incomeCount.textContent = String(counts.income);
  elements.purchaseCount.textContent = String(counts.purchase);
  elements.transferCount.textContent = String(counts.transfer);
}

function toggleHistoryView() {
  if (activeView === "history") {
    activeView = "main";
    updateViewMode();
    popAppBackHistoryWithBrowser();
    return;
  }
  activeView = "history";
  updateViewMode();
  pushAppBackHistory();
}

function toggleDetailsView() {
  if (activeView === "details") {
    activeView = "main";
    updateViewMode();
    popAppBackHistoryWithBrowser();
    return;
  }
  activeView = "details";
  updateViewMode();
  pushAppBackHistory();
}

function updateViewMode() {
  elements.mainView.hidden = activeView !== "main";
  elements.detailsView.hidden = activeView !== "details";
  elements.historyView.hidden = activeView !== "history";
  elements.historyToggleButton.textContent = activeView === "history" ? "Назад" : "История";
  elements.historyToggleButton.classList.toggle("active", activeView === "history");
  elements.detailsToggleButton.textContent = activeView === "details" ? "Назад" : "Подробней";
  elements.detailsToggleButton.classList.toggle("active", activeView === "details");
  if (activeView === "history") {
    renderHistory();
  }
  if (activeView === "details") {
    renderDetailsPeople();
  }
}

function renderSingleFilterToggle() {
  elements.singleFilterToggle.textContent = state.singleFilterMode ? "✅" : "🚫";
  elements.singleFilterToggle.classList.toggle("on", state.singleFilterMode);
}

function renderTotal() {
  const balance = state.people.reduce((sum, person) => sum + person.balance, 0);
  let purchaseTotal = 0;
  let transferTotal = 0;
  state.history.forEach((item) => {
    if (item.type === "purchase") purchaseTotal += item.amount;
    if (item.type === "transfer") transferTotal += item.amount;
  });
  elements.familyTotal.textContent = formatMoney(balance);
  elements.familyPurchaseTotal.textContent = formatMoney(purchaseTotal);
  elements.familyTransferTotal.textContent = formatMoney(transferTotal);
}

function renderPeople() {
  renderPeopleList(elements.peopleList, false);
}

function renderDetailsPeople() {
  renderPeopleList(elements.detailsPeopleList, true);
}

function buildPersonCard(person, stats, detailed) {
  const card = document.createElement("article");
  const tintClass = getPersonCardTintClass(person.cardTint);
  card.className = detailed
    ? `person-card person-card-detailed${tintClass ? ` ${tintClass}` : ""}`
    : `person-card${tintClass ? ` ${tintClass}` : ""}`;
  card.dataset.personId = person.id;
  card.draggable = false;
  const topActionsHtml = detailed
    ? ""
    : `
      <div class="person-top-actions">
        <button class="mini minus" type="button" data-action="expense">Трата</button>
        <button class="mini plus" type="button" data-action="income">Пополнить</button>
      </div>`;
  const detailsBlock = detailed
    ? `
    <div class="person-details-block">
      <div class="person-detail-line person-detail-phone"></div>
      <div class="person-detail-line person-detail-card-number"></div>
      <div class="person-detail-line person-detail-card-details"></div>
      <div class="person-detail-line person-detail-comment person-detail-comment-row"></div>
    </div>
    <div class="person-copy-actions person-copy-actions-detailed">
      <button type="button" class="copy-chip" data-copy="phone">Телефон</button>
      <button type="button" class="copy-chip" data-copy="card">Карта</button>
      <button type="button" class="copy-chip" data-copy="phone-card">Тел+карта</button>
      <button type="button" class="copy-chip" data-copy="brief">Краткие данные</button>
      <button type="button" class="copy-chip" data-copy="full">Все данные</button>
    </div>`
    : "";
  card.innerHTML = detailed
    ? `
    <div class="person-head-row">
      <div class="person-line person-line-head">
        <div class="person-name">
          <button type="button" class="person-name-part person-first-name" data-action="edit"></button>
          <button type="button" class="person-name-part person-last-name" data-action="edit"></button>
        </div>
      </div>
    </div>
    <div class="person-line person-line-balance">
      <span class="person-balance"></span>
      <span class="row-sep">·</span>
      <span class="last-income"></span>
      <button class="bot-toggle" type="button" data-action="bot-toggle" aria-label="Использовать в боте"></button>
    </div>
    <div class="person-line person-line-stats">
      <span class="person-stats-line"></span>
    </div>
    ${detailsBlock}`
    : `
    <div class="person-card-top">
      <div class="person-line person-line-head">
        <div class="person-name">
          <button type="button" class="person-name-part person-first-name" data-action="edit"></button>
          <button type="button" class="person-name-part person-last-name" data-action="edit"></button>
        </div>
      </div>
      <div class="person-line person-line-balance">
        <span class="person-balance"></span>
        <span class="row-sep">·</span>
        <span class="last-income"></span>
        <button class="bot-toggle" type="button" data-action="bot-toggle" aria-label="Использовать в боте"></button>
      </div>
      ${topActionsHtml}
    </div>
    <div class="person-line person-line-stats">
      <span class="person-stats-line"></span>
    </div>`;
  const firstName = getPersonFirstName(person);
  const lastName = getPersonLastName(person);
  const firstNameBtn = card.querySelector(".person-first-name");
  const lastNameBtn = card.querySelector(".person-last-name");
  if (firstName) {
    firstNameBtn.textContent = firstName;
    firstNameBtn.hidden = false;
  } else {
    firstNameBtn.textContent = "";
    firstNameBtn.hidden = true;
  }
  if (lastName) {
    lastNameBtn.textContent = lastName;
    lastNameBtn.hidden = false;
  } else {
    lastNameBtn.textContent = "";
    lastNameBtn.hidden = true;
  }
  const botToggle = card.querySelector(".bot-toggle");
  renderBotToggleButton(botToggle, person);
  card.querySelector(".person-balance").textContent = formatMoney(person.balance);
  card.querySelector(".last-income").textContent = formatMoney(stats.lastIncomeAmount);
  card.querySelector(".person-stats-line").textContent = formatPersonPurchaseStats(stats);
  if (detailed) {
    fillPersonDetailsBlock(card, person);
  }
  return card;
}

function renderPeopleList(container, detailed) {
  container.innerHTML = "";
  let visiblePeople = getVisiblePeople();

  if (state.people.length > 0 && visiblePeople.length === 0 && !filtersAutoCleared) {
    filtersAutoCleared = true;
    state.activeFolderIds = [];
    state.activeFirstNames = [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(STORAGE_BACKUP_KEY, JSON.stringify(state));
    visiblePeople = getVisiblePeople();
  }

  if (state.people.length === 0) {
    container.append(createEmptyState("Нет карт", "Добавьте себя, жену, детей или друзей."));
    return;
  }

  if (visiblePeople.length === 0) {
    container.append(createEmptyState("Никого не найдено", "Выключите фильтры или измените папки и имена."));
    return;
  }

  const fragment = document.createDocumentFragment();
  visiblePeople.forEach((person) => {
    const stats = getPersonStats(person.id);
    fragment.append(buildPersonCard(person, stats, detailed));
  });

  container.append(fragment);
}

function sortPeopleByListOrder(people) {
  const order = new Map(state.people.map((person, index) => [person.id, index]));
  return [...people].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

function resetPersonDragSession(container) {
  if (!personDragSession) return;
  if (personDragSession.timer) clearTimeout(personDragSession.timer);
  if (personDragSession.card) {
    personDragSession.card.classList.remove("is-drag-ready");
  }
  const list = container || elements.peopleList;
  if (list) list.classList.remove("is-reorder-active");
  document.body.classList.remove("person-reorder-lock");
  stopPersonDragDocumentListeners();
  personDragSession = null;
}

function handlePersonDragPointerMove(event) {
  if (!personDragSession || event.pointerId !== personDragSession.pointerId) return;
  const container = elements.peopleList;
  if (!container) return;
  if (personDragSession.dragging) {
    event.preventDefault();
    updatePersonDragPosition(container, personDragSession.card, event.clientY);
    return;
  }
  if (personDragSession.timer) {
    const dx = event.clientX - personDragSession.startX;
    const dy = event.clientY - personDragSession.startY;
    if (Math.hypot(dx, dy) > PERSON_DRAG_MOVE_CANCEL_PX) {
      resetPersonDragSession(container);
    }
  }
}

function handlePersonDragPointerEnd(event) {
  if (!personDragSession || event.pointerId !== personDragSession.pointerId) return;
  const container = elements.peopleList;
  const wasDragging = personDragSession.dragging;
  if (wasDragging && container) {
    commitPeopleOrderFromDom(container);
    event.preventDefault();
  }
  resetPersonDragSession(container);
}

function handlePersonDragTouchMove(event) {
  if (!personDragSession?.dragging) return;
  event.preventDefault();
}

let personDragDocListenersBound = false;

function startPersonDragDocumentListeners() {
  if (personDragDocListenersBound) return;
  personDragDocListenersBound = true;
  document.addEventListener("pointermove", handlePersonDragPointerMove, { passive: false });
  document.addEventListener("pointerup", handlePersonDragPointerEnd);
  document.addEventListener("pointercancel", handlePersonDragPointerEnd);
  document.addEventListener("touchmove", handlePersonDragTouchMove, { passive: false });
}

function stopPersonDragDocumentListeners() {
  if (!personDragDocListenersBound) return;
  personDragDocListenersBound = false;
  document.removeEventListener("pointermove", handlePersonDragPointerMove);
  document.removeEventListener("pointerup", handlePersonDragPointerEnd);
  document.removeEventListener("pointercancel", handlePersonDragPointerEnd);
  document.removeEventListener("touchmove", handlePersonDragTouchMove);
}

function bindPeopleDragReorder() {
  const container = elements.peopleList;
  if (!container || container.dataset.dragBound === "1") return;
  container.dataset.dragBound = "1";

  function onLongPressReady() {
    if (!personDragSession || personDragSession.dragging) return;
    personDragSession.dragging = true;
    if (personDragSession.timer) {
      clearTimeout(personDragSession.timer);
      personDragSession.timer = null;
    }
    personDragSession.card.classList.add("is-drag-ready");
    container.classList.add("is-reorder-active");
    document.body.classList.add("person-reorder-lock");
    try {
      personDragSession.card.setPointerCapture(personDragSession.pointerId);
    } catch {
      // ignore capture errors
    }
    if (window.getSelection) {
      const selection = window.getSelection();
      if (selection) selection.removeAllRanges();
    }
    if (navigator.vibrate) navigator.vibrate(25);
  }

  container.addEventListener("selectstart", (event) => {
    if (personDragSession?.dragging) event.preventDefault();
  });

  container.addEventListener("dragstart", (event) => {
    if (event.target.closest(".person-card")) event.preventDefault();
  });

  container.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const card = event.target.closest(".person-card");
    if (!card || !container.contains(card)) return;
    if (event.target.closest("button, a, input, select, textarea, label")) {
      resetPersonDragSession(container);
      return;
    }

    resetPersonDragSession(container);
    startPersonDragDocumentListeners();
    const longPressMs = PERSON_DRAG_LONG_PRESS_MS;
    personDragSession = {
      personId: card.dataset.personId,
      card,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      timer: setTimeout(onLongPressReady, longPressMs),
    };
  });
}

function updatePersonDragPosition(container, draggedCard, clientY) {
  const others = [...container.querySelectorAll(".person-card")].filter((card) => card !== draggedCard);
  let insertBefore = null;
  others.forEach((card) => {
    if (insertBefore) return;
    const rect = card.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (clientY < mid) insertBefore = card;
  });
  if (insertBefore) {
    if (draggedCard !== insertBefore && draggedCard.nextElementSibling !== insertBefore) {
      container.insertBefore(draggedCard, insertBefore);
    }
    return;
  }
  if (draggedCard !== container.lastElementChild) {
    container.appendChild(draggedCard);
  }
}

function commitPeopleOrderFromDom(container) {
  const orderedVisibleIds = [...container.querySelectorAll(".person-card")]
    .map((card) => card.dataset.personId)
    .filter(Boolean);
  if (!orderedVisibleIds.length) return;

  const visibleSet = new Set(orderedVisibleIds);
  const byId = new Map(state.people.map((person) => [person.id, person]));
  const visiblePeople = orderedVisibleIds.map((id) => byId.get(id)).filter(Boolean);
  if (visiblePeople.length !== orderedVisibleIds.length) return;

  const previousOrder = state.people.map((person) => person.id).join("|");
  const remaining = state.people.filter((person) => !visibleSet.has(person.id));
  const firstVisibleIndex = state.people.findIndex((person) => visibleSet.has(person.id));
  let insertIndex = 0;
  if (firstVisibleIndex >= 0) {
    for (let i = 0; i < firstVisibleIndex; i += 1) {
      if (!visibleSet.has(state.people[i].id)) insertIndex += 1;
    }
  } else {
    insertIndex = remaining.length;
  }

  state.people = [
    ...remaining.slice(0, insertIndex),
    ...visiblePeople,
    ...remaining.slice(insertIndex),
  ];

  const nextOrder = state.people.map((person) => person.id).join("|");
  if (previousOrder === nextOrder) return;

  state.uiUpdatedAt = Date.now();
  markLocalEditPending();
  saveState();
}

function setPersonDetailLine(element, value) {
  if (!element) return;
  const text = String(value ?? "").trim();
  if (text) {
    element.textContent = text;
    element.hidden = false;
  } else {
    element.textContent = "";
    element.hidden = true;
  }
}

function fillPersonDetailsBlock(card, person) {
  setPersonDetailLine(card.querySelector(".person-detail-phone"), person.phone);
  setPersonDetailLine(card.querySelector(".person-detail-card-number"), person.cardNumber);
  setPersonDetailLine(card.querySelector(".person-detail-card-details"), person.cardDetails);
  setPersonDetailLine(card.querySelector(".person-detail-comment"), person.profileNote);
}

function formatPersonDetailsLine(person) {
  const parts = [];
  if (person.phone) parts.push(`Тел. ${person.phone}`);
  if (person.cardNumber) parts.push(`Карта ${person.cardNumber}`);
  if (person.cardDetails) parts.push(person.cardDetails);
  if (person.profileNote) parts.push(person.profileNote);
  return parts.length > 0 ? parts.join(" · ") : "Телефон и карта не указаны";
}

function renderFolders() {
  elements.folderList.innerHTML = "";
  renderSingleFilterToggle();

  if (state.folders.length === 0) {
    elements.folderList.append(createEmptyState("Нет банков", ""));
    return;
  }

  const activeIds = new Set(state.activeFolderIds);
  const fragment = document.createDocumentFragment();
  state.folders.forEach((folder) => {
    const chip = document.createElement("div");
    chip.className = `folder-chip${activeIds.has(folder.id) ? " active" : ""}`;
    chip.dataset.folderId = folder.id;
    chip.innerHTML = "<span></span>";
    chip.querySelector("span").textContent = `${folder.name} ${activeIds.has(folder.id) ? "✅" : "🚫"}`;
    fragment.append(chip);
  });

  elements.folderList.append(fragment);
}

function getFirstName(fullName) {
  const trimmed = String(fullName).trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

function getUniqueFirstNames() {
  const names = new Map();
  state.people.forEach((person) => {
    const firstName = getPersonFirstName(person);
    if (!firstName) return;
    if (!names.has(firstName)) {
      names.set(firstName, person.createdAt ?? 0);
    }
  });

  return [...names.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([firstName]) => firstName);
}

function renderFirstNameFilters() {
  elements.firstNameFilterList.innerHTML = "";
  const firstNames = getUniqueFirstNames();

  if (firstNames.length === 0) {
    elements.firstNameFilterList.append(createEmptyState("Нет имён", ""));
    return;
  }

  const activeNames = new Set(state.activeFirstNames);
  const fragment = document.createDocumentFragment();
  firstNames.forEach((firstName) => {
    const count = state.people.filter((person) => getPersonFirstName(person) === firstName).length;
    const chip = document.createElement("div");
    chip.className = `folder-chip${activeNames.has(firstName) ? " active" : ""}`;
    chip.dataset.firstName = firstName;
    chip.innerHTML = "<span></span>";
    chip.querySelector("span").textContent = `${firstName} (${count}) ${activeNames.has(firstName) ? "✅" : "🚫"}`;
    fragment.append(chip);
  });

  elements.firstNameFilterList.append(fragment);
}

function getVisiblePeople() {
  const activeFolderIds = state.folders
    .map((folder) => folder.id)
    .filter((id) => state.activeFolderIds.includes(id));
  const activeFirstNames = state.activeFirstNames.filter((name) =>
    state.people.some((person) => getPersonFirstName(person) === name)
  );

  let people = state.people;

  if (activeFolderIds.length > 0) {
    const addedIds = new Set();
    const folderPeople = [];
    activeFolderIds.forEach((folderId) => {
      people.forEach((person) => {
        const personFolderIds = Array.isArray(person.folderIds) ? person.folderIds : [];
        if (!addedIds.has(person.id) && personFolderIds.includes(folderId)) {
          folderPeople.push(person);
          addedIds.add(person.id);
        }
      });
    });
    people = folderPeople;
  }

  if (activeFirstNames.length === 0) {
    return sortPeopleByListOrder(people);
  }

  const addedIds = new Set();
  const namePeople = [];
  activeFirstNames.forEach((firstName) => {
    people.forEach((person) => {
      if (!addedIds.has(person.id) && getPersonFirstName(person) === firstName) {
        namePeople.push(person);
        addedIds.add(person.id);
      }
    });
  });

  return sortPeopleByListOrder(namePeople);
}

function activateFiltersForPerson(person, { isNew = false } = {}) {
  if (!person) return;
  const firstName = getPersonFirstName(person);
  const folderIds = Array.isArray(person.folderIds) ? person.folderIds : [];
  const hasNameFilters = state.activeFirstNames.length > 0;
  const hasFolderFilters = state.activeFolderIds.length > 0;

  if (!hasNameFilters && !hasFolderFilters) return;

  if (firstName && hasNameFilters) {
    if (state.singleFilterMode) {
      state.activeFirstNames = [firstName];
    } else if (!state.activeFirstNames.includes(firstName)) {
      state.activeFirstNames.push(firstName);
    }
  }

  if (hasFolderFilters) {
    if (folderIds.length === 0 && isNew) {
      state.activeFolderIds = [];
    } else if (folderIds.length > 0) {
      if (state.singleFilterMode) {
        state.activeFolderIds = [folderIds[0]];
      } else {
        folderIds.forEach((id) => {
          if (!state.activeFolderIds.includes(id)) state.activeFolderIds.push(id);
        });
      }
    }
  }
}

function handleFirstNameFilterClick(event) {
  const chip = event.target.closest(".folder-chip");
  if (!chip) return;

  toggleFirstName(chip.dataset.firstName);
}

function toggleFirstName(firstName) {
  if (state.activeFirstNames.includes(firstName)) {
    state.activeFirstNames = state.activeFirstNames.filter((name) => name !== firstName);
  } else if (state.singleFilterMode) {
    state.activeFirstNames = [firstName];
  } else {
    state.activeFirstNames.push(firstName);
  }
  saveState();
  renderFirstNameFilters();
  renderPeople();
}

function toggleSingleFilterMode() {
  state.singleFilterMode = !state.singleFilterMode;
  state.uiUpdatedAt = Date.now();
  saveState();
  renderSingleFilterToggle();
}

function handleFolderClick(event) {
  const chip = event.target.closest(".folder-chip");
  if (!chip) return;

  const folder = state.folders.find((item) => item.id === chip.dataset.folderId);
  if (!folder) return;

  toggleFolder(folder.id);
}

function openFolderDialog() {
  elements.folderNameInput.value = "";
  openAppDialog(elements.folderDialog);
}

function saveFolder(event) {
  event.preventDefault();
  const name = elements.folderNameInput.value.trim();
  if (!name) return;

  state.folders.push({
    id: makeId(),
    name,
    createdAt: Date.now(),
  });
  saveState();
  closeAppDialog(elements.folderDialog);
  render();
}

function openDeleteFolderDialog() {
  if (state.folders.length === 0) {
    alert("Папок пока нет.");
    return;
  }

  elements.deleteFolderSelect.innerHTML = "";
  state.folders.forEach((folder) => {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    elements.deleteFolderSelect.append(option);
  });
  openAppDialog(elements.deleteFolderDialog);
}

function deleteSelectedFolder(event) {
  event.preventDefault();
  const folder = state.folders.find((item) => item.id === elements.deleteFolderSelect.value);
  if (!folder) return;

  if (deleteFolder(folder)) {
    closeAppDialog(elements.deleteFolderDialog);
  }
}

function toggleFolder(folderId) {
  if (state.activeFolderIds.includes(folderId)) {
    state.activeFolderIds = state.activeFolderIds.filter((id) => id !== folderId);
  } else if (state.singleFilterMode) {
    state.activeFolderIds = [folderId];
  } else {
    state.activeFolderIds.push(folderId);
  }
  saveState();
  renderFolders();
  render();
}

function deleteFolder(folder) {
  const ok = confirm(`Удалить папку "${folder.name}"? Люди и история останутся.`);
  if (!ok) return false;

  markLocalEditPending();
  addDeletedFolderId(folder.id);
  state.folders = state.folders.filter((item) => item.id !== folder.id);
  state.activeFolderIds = state.activeFolderIds.filter((id) => id !== folder.id);
  state.uiUpdatedAt = Date.now();
  state.people = state.people.map((person) => ({
    ...person,
    folderIds: Array.isArray(person.folderIds)
      ? person.folderIds.filter((id) => id !== folder.id)
      : [],
  }));
  saveState({ skipPush: true });
  pushStateWithTombstones();
  render();
  return true;
}

function getPersonStats(personId) {
  const personHistory = state.history
    .filter((item) => item.personId === personId)
    .sort((a, b) => a.createdAt - b.createdAt);
  const now = Date.now();
  const day3 = 3 * 24 * 60 * 60 * 1000;
  const day7 = 7 * 24 * 60 * 60 * 1000;

  const incomes = personHistory.filter((item) => item.type === "income");
  const lastIncome = incomes[incomes.length - 1] ?? null;
  const lastIncomeIndex = lastIncome
    ? personHistory.findIndex((item) => item.id === lastIncome.id)
    : -1;

  const purchasesSinceIncome = personHistory
    .slice(lastIncomeIndex + 1)
    .filter((item) => item.type === "purchase");
  const purchasesTotal = purchasesSinceIncome.reduce((sum, item) => sum + item.amount, 0);
  const allPurchases = personHistory.filter((item) => item.type === "purchase");
  const purchasesAllTotal = allPurchases.reduce((sum, item) => sum + item.amount, 0);

  let incomesLast3Days = 0;
  let incomesLast7Days = 0;
  incomes.forEach((item) => {
    const age = now - item.createdAt;
    if (age <= day3) incomesLast3Days += 1;
    if (age <= day7) incomesLast7Days += 1;
  });

  const purchasesLast3Days = personHistory.filter(
    (item) => item.type === "purchase" && now - item.createdAt <= day3
  );
  const purchasesLast7Days = personHistory.filter(
    (item) => item.type === "purchase" && now - item.createdAt <= day7
  );

  return {
    lastIncomeAmount: lastIncome?.amount ?? 0,
    lastIncomeAt: lastIncome?.createdAt ?? null,
    purchasesTotal,
    purchasesCount: purchasesSinceIncome.length,
    purchasesAllTotal,
    purchasesAllCount: allPurchases.length,
    incomesLast3Days,
    incomesLast7Days,
    purchasesLast3DaysCount: purchasesLast3Days.length,
    purchasesLast3DaysTotal: purchasesLast3Days.reduce((sum, item) => sum + item.amount, 0),
    purchasesLast7DaysCount: purchasesLast7Days.length,
    purchasesLast7DaysTotal: purchasesLast7Days.reduce((sum, item) => sum + item.amount, 0),
  };
}

function renderFilters() {
  const selected = elements.personFilter.value || "all";
  elements.personFilter.innerHTML = '<option value="all">Все Люди</option>';
  const peopleById = new Map();

  state.people.forEach((person) => {
    peopleById.set(person.id, person.name);
  });
  state.history.forEach((item) => {
    if (!peopleById.has(item.personId)) {
      peopleById.set(item.personId, `${item.personName} (удален)`);
    }
  });
  getActiveHistoryEntries().forEach((item) => {
    if (!peopleById.has(item.personId)) {
      peopleById.set(item.personId, `${item.personName} (удален)`);
    }
  });

  peopleById.forEach((name, id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = name;
    elements.personFilter.append(option);
  });

  elements.personFilter.value = peopleById.has(selected) ? selected : "all";
}

function matchesCommentFilter(note, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return (note || "").toLowerCase().includes(normalizedQuery);
}

function getHistoryEntryDelta(entry) {
  if (entry?.type === "balance_set") return 0;
  const amount = Number(entry.amount || 0);
  if (entry.direction === "plus") return amount;
  if (entry.direction === "minus") return -amount;
  if (entry.type === "income") return amount;
  return -amount;
}

function historyTypeToDirection(type) {
  return type === "income" ? "plus" : "minus";
}

function findHistoryEntryRef(entryId) {
  const inCurrent = (state.history || []).find((entry) => entry.id === entryId);
  if (inCurrent) return inCurrent;
  for (const month of getHistoryMonths()) {
    const found = (month.history || []).find((entry) => entry.id === entryId);
    if (found) return found;
  }
  return null;
}

function getAllHistoryEntriesChronological() {
  const entries = [];
  getHistoryMonths().forEach((month) => {
    (month.history || []).forEach((entry) => entries.push(entry));
  });
  (state.history || []).forEach((entry) => entries.push(entry));
  return entries.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

function replayBalanceAfterForPerson(personId) {
  const personEntries = getAllHistoryEntriesChronological()
    .filter((entry) => entry.personId === personId);
  if (personEntries.length === 0) return;

  const first = personEntries[0];
  let balance = first.type === "balance_set"
    ? Number(first.balanceAfter || 0)
    : Number(first.balanceAfter || 0) - getHistoryEntryDelta(first);
  personEntries.forEach((entry) => {
    if (entry.type === "balance_set") {
      balance = Math.round(Number(entry.balanceAfter || balance) * 100) / 100;
      entry.balanceAfter = balance;
      return;
    }
    if (entry === first && first.type === "balance_set") return;
    balance = Math.round((balance + getHistoryEntryDelta(entry)) * 100) / 100;
    entry.balanceAfter = balance;
  });

  const person = state.people.find((item) => item.id === personId);
  if (person) {
    person.balance = balance;
    delete person.balanceManualAt;
  }
}

function changeHistoryEntryType(entryId, newType) {
  if (!["income", "purchase", "transfer"].includes(newType)) return;
  const entry = findHistoryEntryRef(entryId);
  if (!entry || entry.type === newType) return;

  entry.type = newType;
  entry.direction = historyTypeToDirection(newType);
  replayBalanceAfterForPerson(entry.personId);
  markLocalEditPending();
  saveState({ immediatePush: true });
  render();
}

function changeHistoryEntryNote(entryId, note) {
  const entry = findHistoryEntryRef(entryId);
  if (!entry) return;
  const normalized = String(note ?? "").trim();
  if ((entry.note || "") === normalized) return;

  entry.note = normalized;
  markLocalEditPending();
  saveState({ immediatePush: true });

  const commentQuery = elements.commentFilter?.value || "";
  if (commentQuery.trim() && !matchesCommentFilter(normalized, commentQuery)) {
    renderHistory();
  }
}

function handleHistoryTypeChange(event) {
  const select = event.target.closest(".history-type-select");
  if (!select) return;
  changeHistoryEntryType(select.dataset.historyId, select.value);
}

function handleHistoryNoteBlur(event) {
  const input = event.target.closest(".history-note-input");
  if (!input) return;
  changeHistoryEntryNote(input.dataset.historyId, input.value);
}

function handleHistoryNoteKeydown(event) {
  const input = event.target.closest(".history-note-input");
  if (!input || event.key !== "Enter") return;
  event.preventDefault();
  input.blur();
}

function renderHistory() {
  const sourceHistory = getActiveHistoryEntries();
  const personId = elements.personFilter.value;
  const type = elements.typeFilter.value;
  const commentQuery = elements.commentFilter?.value || "";
  const rows = sourceHistory
    .filter((item) => personId === "all" || item.personId === personId)
    .filter((item) => type === "all" || item.type === type)
    .filter((item) => matchesCommentFilter(item.note, commentQuery))
    .sort((a, b) => b.createdAt - a.createdAt);

  elements.historyList.innerHTML = "";
  if (rows.length === 0) {
    const hasHistory = sourceHistory.length > 0;
    const hasActiveFilters = personId !== "all" || type !== "all" || commentQuery.trim();
    const archiveLabel = activeHistoryPeriod != null
      ? getHistoryMonths().find((month) => month.index === activeHistoryPeriod)?.title
      : null;
    const title = hasHistory && hasActiveFilters
      ? "Ничего не найдено"
      : (archiveLabel ? `В «${archiveLabel}» пока нет операций` : "Истории пока нет");
    const hint = hasHistory && hasActiveFilters
      ? "Попробуйте другой фильтр или очистите поиск по комментарию."
      : "Операции появятся здесь после подтверждения.";
    elements.historyList.append(createEmptyState(title, hint));
    return;
  }

  const fragment = document.createDocumentFragment();
  rows.forEach((item) => {
    const row = document.createElement("article");
    row.className = "history-item";
    row.dataset.historyId = item.id;
    const sign = item.direction === "plus" ? "+" : "-";
    row.innerHTML = `
      <div class="history-line">
        <strong></strong>
        <span class="history-amount ${item.type}"></span>
      </div>
      <div class="history-meta">
        <select class="history-type-select" data-history-id="${item.id}" aria-label="Тип операции">
          <option value="income">Пополнение</option>
          <option value="purchase">Покупка</option>
          <option value="transfer">Перевод</option>
        </select>
        <span class="history-meta-date"></span>
      </div>
      <input
        class="history-note-input"
        type="text"
        data-history-id="${item.id}"
        maxlength="80"
        placeholder="Комментарий"
        aria-label="Комментарий к операции"
      >
    `;
    row.querySelector("strong").textContent = item.personName;
    if (item.type === "balance_set") {
      row.querySelector(".history-amount").textContent = `= ${formatMoney(item.balanceAfter)}`;
      row.querySelector(".history-amount").className = "history-amount balance_set";
    } else {
      row.querySelector(".history-amount").textContent = `${sign}${formatMoney(item.amount)}`;
    }
    if (item.type === "balance_set") {
      row.querySelector(".history-type-select").innerHTML = "<option value=\"balance_set\">Коррекция баланса</option>";
      row.querySelector(".history-type-select").disabled = true;
    }
    row.querySelector(".history-type-select").value = item.type;
    row.querySelector(".history-meta-date").textContent = formatDate(item.createdAt);
    row.querySelector(".history-note-input").value = item.note || "";
    fragment.append(row);
  });
  elements.historyList.append(fragment);
}

function handlePeopleClick(event) {
  const button = event.target.closest("button");
  const card = event.target.closest(".person-card");
  if (!button || !card) return;

  const person = state.people.find((item) => item.id === card.dataset.personId);
  if (!person) return;

  const action = button.dataset.action;
  if (action === "bot-toggle") toggleUseInBot(person);
  if (action === "edit") openPersonDialog(person);
  if (action === "income") openOperationDialog(person, "plus");
  if (action === "expense") openOperationDialog(person, "minus");
}

function handleDetailsPeopleClick(event) {
  const copyButton = event.target.closest("button[data-copy]");
  if (copyButton) {
    const card = event.target.closest(".person-card");
    if (!card) return;
    const person = state.people.find((item) => item.id === card.dataset.personId);
    if (!person) return;
    const stats = getPersonStats(person.id);
    const text = buildPersonCopyText(copyButton.dataset.copy, person, stats);
    copyText(text);
    return;
  }
  handlePeopleClick(event);
}

function handleDetailsCopyAllClick(event) {
  const copyButton = event.target.closest("button[data-copy-all]");
  if (!copyButton) return;
  copyText(buildAllPeopleCopyText(copyButton.dataset.copyAll));
}

function buildAllPeopleCopyText(mode) {
  const people = getVisiblePeople();
  if (people.length === 0) return "";

  const blocks = people.map((person) => {
    const stats = getPersonStats(person.id);
    return buildPersonCopyText(mode, person, stats).trim();
  }).filter(Boolean);

  return blocks.join("\n\n");
}

function openPersonDialog(person = null) {
  editingPersonId = person?.id ?? null;
  phoneAutoPrefixSuppressed = false;
  elements.personDialogTitle.textContent = person ? "Изменить карту" : "Добавить карту";
  elements.personFirstNameInput.value = person?.firstName ?? "";
  elements.personLastNameInput.value = person?.lastName ?? "";
  elements.personBalanceInput.value = person ? String(person.balance) : "";
  elements.personPhoneInput.value = person?.phone ?? "";
  elements.personCardNumberInput.value = formatCardNumberForInput(person?.cardNumber ?? "");
  elements.personCardDetailsInput.value = formatCardDetailsForInput(person?.cardDetails ?? "");
  elements.personProfileNoteInput.value = person?.profileNote ?? "";
  if (elements.personUseInBotCheckbox) {
    elements.personUseInBotCheckbox.checked = person ? getBotDisplayInBot(person) : false;
  }
  elements.deletePersonButton.hidden = !person;
  renderCardTintPicker(person?.cardTint ?? "");
  renderFolderPicker(person?.folderIds ?? []);
  openAppDialog(elements.personDialog);
}

function renderCardTintPicker(selectedTint = "") {
  const picker = elements.personCardTintPicker;
  if (!picker) return;
  const normalized = normalizeCardTint(selectedTint);
  picker.innerHTML = "";
  picker.dataset.selectedTint = normalized;

  PERSON_BANK_THEMES.forEach(({ id, label, short }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `bank-app-icon bank-app-icon--${id || "none"}`;
    button.dataset.tintId = id;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", id === normalized ? "true" : "false");
    if (id === normalized) button.classList.add("active");
    button.append(buildBankIconMark({ id, label, short }));
    button.addEventListener("click", () => {
      picker.dataset.selectedTint = id;
      picker.querySelectorAll(".bank-app-icon").forEach((item) => {
        const isActive = item.dataset.tintId === id;
        item.classList.toggle("active", isActive);
        item.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    });
    picker.append(button);
  });
}

function getSelectedCardTint() {
  return normalizeCardTint(elements.personCardTintPicker?.dataset.selectedTint);
}

function renderFolderPicker(selectedFolderIds = []) {
  elements.personFolderPicker.innerHTML = "";

  if (state.folders.length === 0) {
    elements.personFolderPicker.append(createEmptyState("Папок пока нет", "Сначала создайте папку наверху главного экрана."));
    return;
  }

  const selectedIds = new Set(selectedFolderIds);
  const fragment = document.createDocumentFragment();
  state.folders.forEach((folder) => {
    const label = document.createElement("label");
    label.className = "folder-choice";
    label.innerHTML = `
      <input type="checkbox" name="personFolder" value="">
      <span></span>
    `;
    const input = label.querySelector("input");
    input.value = folder.id;
    input.checked = selectedIds.has(folder.id);
    label.querySelector("span").textContent = folder.name;
    fragment.append(label);
  });

  elements.personFolderPicker.append(fragment);
}

function savePerson(event) {
  event.preventDefault();
  const now = Date.now();
  const firstName = elements.personFirstNameInput.value.trim();
  const lastName = elements.personLastNameInput.value.trim();
  const balance = parseAmount(elements.personBalanceInput.value);
  const phone = elements.personPhoneInput.value.trim();
  const cardNumber = elements.personCardNumberInput.value.trim();
  const cardDetails = elements.personCardDetailsInput.value.trim();
  const profileNote = elements.personProfileNoteInput.value.trim();
  const cardTint = getSelectedCardTint();
  const folderIds = [...elements.personFolderPicker.querySelectorAll("input:checked")]
    .map((input) => input.value);
  const name = formatPersonName(firstName, lastName);

  if (!firstName) return;
  if (balance < 0) {
    alert("Начальная сумма не может быть меньше нуля.");
    return;
  }

  markLocalEditPending();

  const existingPerson = editingPersonId
    ? state.people.find((item) => item.id === editingPersonId)
    : null;
  const balanceChanged = !existingPerson || balance !== Number(existingPerson.balance || 0);

  if (editingPersonId) {
    state.people = state.people.map((person) => {
      if (person.id !== editingPersonId) return person;
      let updated = touchPersonProfileFields(normalizePerson({
        ...person,
        firstName,
        lastName,
        name,
        balance,
        phone,
        cardNumber,
        cardDetails,
        profileNote,
        cardTint,
        folderIds,
      }), now);
      if (balanceChanged) {
        applyManualBalanceCorrection(editingPersonId, name, balance, now);
        updated = touchPersonBalanceField(updated, now);
        delete updated.balanceManualAt;
      }
      return updated;
    });
  } else {
    let newPerson = touchPersonProfileFields(normalizePerson({
      id: makeId(),
      firstName,
      lastName,
      name,
      balance,
      phone,
      cardNumber,
      cardDetails,
      profileNote,
      cardTint,
      folderIds,
      createdAt: now,
    }), now);
    newPerson = touchPersonBalanceField(newPerson, now);
    applyManualBalanceCorrection(newPerson.id, name, balance, now);
    delete newPerson.balanceManualAt;
    state.people.push(newPerson);
  }

  state.activeFirstNames = state.activeFirstNames.filter((activeName) =>
    state.people.some((person) => getPersonFirstName(person) === activeName)
  );

  const savedPerson = editingPersonId
    ? state.people.find((item) => item.id === editingPersonId)
    : state.people[state.people.length - 1];
  activateFiltersForPerson(savedPerson, { isNew: !editingPersonId });

  saveState({ immediatePush: true });
  closeAppDialog(elements.personDialog);
  render();

  const saved = editingPersonId
    ? state.people.find((item) => item.id === editingPersonId)
    : state.people[state.people.length - 1];

  if (!saved || !elements.personUseInBotCheckbox) return;

  const wantInBot = elements.personUseInBotCheckbox.checked;
  const botCheckboxChanged = wantInBot !== saved.useInBot;

  if (!botCheckboxChanged) return;

  const runBotSync = () => {
    if (wantInBot) {
      if (!alertIfBotProfileIncomplete(saved)) {
        touchPersonUseInBot(saved.id, false);
        if (elements.personUseInBotCheckbox) elements.personUseInBotCheckbox.checked = false;
        saveState({ skipPush: true });
        render();
        return;
      }
      touchPersonUseInBot(saved.id, true);
      saveState();
      render();
      queueBotExportUpsert(state.people.find((p) => p.id === saved.id));
    } else {
      disablePersonInBot(saved);
    }
  };

  if (!canPushBotNow()) {
    confirmOfflineBotSync().then((ok) => {
      if (!ok) {
        if (botCheckboxChanged && wantInBot) {
          touchPersonUseInBot(saved.id, false);
          saveState({ skipPush: true });
          render();
        }
        return;
      }
      runBotSync();
    });
    return;
  }

  runBotSync();
}

function wasPersonInBot(person) {
  if (!person) return false;
  if (person.botConfirmedInBot != null) return Boolean(person.botConfirmedInBot);
  return Boolean(person.useInBot);
}

function pushStateWithTombstones() {
  state.deletedPersonIds = [...getDeletedPersonIds()];
  state.deletedFolderIds = [...getDeletedFolderIds()];
  const json = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, json);
  localStorage.setItem(STORAGE_BACKUP_KEY, json);
  if (!window.FamilySync) return;
  if (FamilySync.cancelPendingPush) FamilySync.cancelPendingPush();
  if (FamilySync.pushImmediate) {
    FamilySync.pushImmediate(state).catch((error) => {
      const reason = FamilySync.getSyncBlockedReason?.();
      const msg = reason || error?.message || "ошибка";
      console.warn("push tombstones", error);
      alert(`Не отправлено в канал Telegram: ${msg}`);
    });
  } else if (FamilySync.push) {
    FamilySync.push(state);
  }
}

function deletePerson(person) {
  const ok = confirm(`Удалить "${person.name}"? История останется для просмотра.`);
  if (!ok) return false;

  const personSnapshot = normalizePerson({ ...person });
  const wasInBot = wasPersonInBot(personSnapshot);

  markLocalEditPending();
  addDeletedPersonId(personSnapshot.id);
  state.people = state.people.filter((item) => item.id !== person.id);
  state.uiUpdatedAt = Date.now();
  saveState({ skipPush: true });
  render();

  if (wasInBot) {
    removePersonFromBot(personSnapshot);
  } else {
    pushStateWithTombstones();
  }

  return true;
}

function removePersonFromBot(person) {
  const clearPayload = buildBotExportPayload("clear", person);
  if (clearPayload.slotIndex == null && person.botSlotIndex != null) {
    clearPayload.slotIndex = Number(person.botSlotIndex);
  }

  if (!canPushBotNow()) {
    localStorage.setItem(PENDING_BOT_REVISION_KEY, String(clearPayload.revision));
    localStorage.setItem(PENDING_BOT_AT_KEY, String(Date.now()));
    renderBotPendingBanner();
    return;
  }

  markLocalEditPending();
  pushBotExportPayload(clearPayload, { skipPendingMark: true })
    .then(() => {
      pushStateWithTombstones();
    })
    .catch(() => {});
}

function deleteEditingPerson() {
  const person = state.people.find((item) => item.id === editingPersonId);
  if (!person) return;

  if (deletePerson(person)) {
    closeAppDialog(elements.personDialog);
  }
}

function handleAmountKeypadClick(event) {
  const button = event.target.closest("button[data-digit], button[data-action]");
  if (!button || !currentOperation) return;
  const digit = button.dataset.digit;
  const action = button.dataset.action;
  if (digit != null) {
    appendAmountDigit(digit);
    return;
  }
  if (action === "backspace") {
    backspaceAmountEntry();
    return;
  }
  if (action === "enter") {
    finalizeAmountEntry();
    if (currentOperation.amount > 0) {
      elements.operationForm?.requestSubmit();
    }
  }
}

function appendAmountDigit(digit) {
  if (!currentOperation) return;
  if (amountEntryText.length >= 12) return;
  if (amountEntryText === "0") {
    amountEntryText = digit;
  } else {
    amountEntryText += digit;
  }
  applyAmountEntryText();
}

function backspaceAmountEntry() {
  amountEntryText = amountEntryText.slice(0, -1);
  applyAmountEntryText();
}

function applyAmountEntryText() {
  if (!currentOperation || !elements.selectedAmountInput) return;
  const amount = parseAmount(amountEntryText);
  currentOperation.amount = Math.max(0, amount);
  elements.selectedAmountInput.value = amountEntryText || "";
  elements.confirmOperationButton.disabled = amount <= 0;
}

function finalizeAmountEntry() {
  if (!currentOperation || !elements.selectedAmountInput) return;
  const amount = parseAmount(amountEntryText);
  currentOperation.amount = Math.max(0, amount);
  amountEntryText = amount > 0 ? String(amount).replace(".", ",") : "";
  elements.selectedAmountInput.value = amount > 0 ? formatMoney(amount) : "";
  elements.confirmOperationButton.disabled = amount <= 0;
}

function openOperationDialog(person, direction) {
  currentOperation = {
    personId: person.id,
    direction,
    amount: 0,
  };

  elements.operationPerson.textContent = person.name;
  elements.operationTitle.textContent = direction === "plus" ? "Пополнение" : "Покупка или перевод";
  elements.operationDialog.classList.toggle("is-income", direction === "plus");
  elements.transferToggleRow.hidden = direction === "plus";
  elements.transferCheckbox.checked = false;
  elements.noteInput.value = "";
  amountEntryText = "";
  updateSelectedAmount(0);
  openAppDialog(elements.operationDialog);
}

function closeOperationDialog() {
  currentOperation = null;
  amountEntryText = "";
  closeAppDialog(elements.operationDialog);
}

function clearAmountAll() {
  amountEntryText = "";
  updateSelectedAmount(0);
}

function updateSelectedAmount(amount) {
  if (!currentOperation) return;
  currentOperation.amount = Math.max(0, amount);
  amountEntryText = amount > 0 ? String(amount).replace(".", ",") : "";
  if (elements.selectedAmountInput) {
    elements.selectedAmountInput.value = amount > 0 ? formatMoney(amount) : "";
  }
  elements.confirmOperationButton.disabled = amount <= 0;
}

function confirmOperation(event) {
  event.preventDefault();
  finalizeAmountEntry();
  if (!currentOperation || currentOperation.amount <= 0) return;

  const person = state.people.find((item) => item.id === currentOperation.personId);
  if (!person) return;

  const type = currentOperation.direction === "plus"
    ? "income"
    : elements.transferCheckbox.checked
      ? "transfer"
      : "purchase";
  const delta = currentOperation.direction === "plus" ? currentOperation.amount : -currentOperation.amount;

  const idx = state.people.findIndex((item) => item.id === currentOperation.personId);
  if (idx < 0) return;
  state.people[idx].balance = Math.round((state.people[idx].balance + delta) * 100) / 100;
  state.people[idx] = touchPersonBalanceField(state.people[idx]);
  delete state.people[idx].balanceManualAt;

  state.history.push({
    id: makeId(),
    personId: state.people[idx].id,
    personName: state.people[idx].name,
    direction: currentOperation.direction,
    type,
    amount: currentOperation.amount,
    balanceAfter: state.people[idx].balance,
    note: elements.noteInput.value.trim(),
    createdAt: Date.now(),
    deviceId: getDeviceId(),
  });

  saveState({ immediatePush: true });
  currentOperation = null;
  closeAppDialog(elements.operationDialog);
  render();
}

function clearActiveHistory() {
  markLocalEditPending();
  const now = Date.now();
  state.history = [];
  state.historyClearedAtMs = Math.max(Number(state.historyClearedAtMs || 0), now);
}

function clearHistory() {
  if (activeHistoryPeriod != null) return;
  if (state.history.length === 0) return;
  const ok = confirm("Очистить всю историю текущего периода? Балансы людей не изменятся.");
  if (!ok) return;

  clearActiveHistory();
  saveState({ immediatePush: true });
  render();
}

function nextMonthArchive() {
  if (activeHistoryPeriod != null) return;
  if (state.history.length === 0) {
    alert("Нет операций для закрытия периода.");
    return;
  }
  const ok = confirm(
    "Закрыть период и начать новый месяц?\n\n" +
    "Все операции сохранятся в архив (Месяц 1, Месяц 2…), балансы не изменятся.",
  );
  if (!ok) return;

  markLocalEditPending();
  const now = Date.now();
  const months = getHistoryMonths().map((month) => ({
    ...month,
    history: [...(month.history || [])],
  }));
  const nextIndex = months.length > 0
    ? Math.max(...months.map((month) => Number(month.index) || 0)) + 1
    : 1;
  months.push({
    index: nextIndex,
    title: `Месяц ${nextIndex}`,
    archivedAt: now,
    history: [...state.history],
  });
  state.historyMonths = months;
  state.history = [];
  state.historyClearedAtMs = Math.max(Number(state.historyClearedAtMs || 0), now);
  activeHistoryPeriod = null;
  if (elements.historyPeriodSelect) elements.historyPeriodSelect.value = "current";
  saveState({ immediatePush: true });
  render();
}

function syncTabs(type) {
  document.querySelectorAll(".tab[data-type]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.type === type);
  });
}

const CARD_DETAILS_GROUP_GAP = "   ";
const CARD_DETAILS_ENTRY_DIGITS = 7;

function countNonSpaceCharsBefore(text, cursor) {
  let count = 0;
  const limit = Math.min(cursor, text.length);
  for (let i = 0; i < limit; i += 1) {
    if (text[i] !== " ") count += 1;
  }
  return count;
}

function countDigitsBefore(text, cursor) {
  let count = 0;
  const limit = Math.min(cursor, text.length);
  for (let i = 0; i < limit; i += 1) {
    if (text[i] >= "0" && text[i] <= "9") count += 1;
  }
  return count;
}

function restoreInputCursor(input, newValue, charsBeforeCursor) {
  let pos = 0;
  let seen = 0;
  for (let i = 0; i < newValue.length; i += 1) {
    if (newValue[i] !== " ") seen += 1;
    pos = i + 1;
    if (seen >= charsBeforeCursor) break;
  }
  if (seen < charsBeforeCursor) pos = newValue.length;
  input.setSelectionRange(pos, pos);
}

function restoreInputCursorAfterDigits(input, newValue, digitsBeforeCursor) {
  if (digitsBeforeCursor <= 0) {
    input.setSelectionRange(0, 0);
    return;
  }
  let pos = 0;
  let seen = 0;
  for (let i = 0; i < newValue.length; i += 1) {
    if (newValue[i] >= "0" && newValue[i] <= "9") {
      seen += 1;
      pos = i + 1;
      if (seen >= digitsBeforeCursor) break;
    }
  }
  if (seen < digitsBeforeCursor) pos = newValue.length;
  input.setSelectionRange(pos, pos);
}

function formatSingleCardDetailsEntry(digits) {
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  const expiry = `${digits.slice(0, 2)}/${digits.slice(2, 4)}`;
  let rest = digits.slice(4);
  const groups = [];
  while (rest.length > 0) {
    groups.push(rest.slice(0, 3));
    rest = rest.slice(3);
  }
  return `${expiry}${CARD_DETAILS_GROUP_GAP}${groups.join(CARD_DETAILS_GROUP_GAP)}`;
}

function formatCardDetailsFromDigits(digits) {
  const entries = [];
  for (let i = 0; i < digits.length; i += CARD_DETAILS_ENTRY_DIGITS) {
    entries.push(digits.slice(i, i + CARD_DETAILS_ENTRY_DIGITS));
  }
  return entries.map((entryDigits) => formatSingleCardDetailsEntry(entryDigits)).join(" / ");
}

function formatCardDetailsForInput(value) {
  const compact = String(value ?? "").replace(/\s/g, "");
  if (!compact) return "";
  if (/[^\d/]/.test(compact)) return compact;
  const digitsOnly = compact.replace(/\//g, "");
  if (!digitsOnly) return "";
  return formatCardDetailsFromDigits(digitsOnly);
}

function handlePhoneInput() {
  const input = elements.personPhoneInput;
  if (!input) return;
  const raw = input.value;

  if (!raw) {
    phoneAutoPrefixSuppressed = true;
    return;
  }

  if (raw === "9" && !phoneAutoPrefixSuppressed) {
    input.value = "+7 9";
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }
}

function handleCardDetailsInput() {
  const input = elements.personCardDetailsInput;
  if (!input) return;
  const raw = input.value;
  const cursor = input.selectionStart ?? raw.length;
  const digitsBeforeCursor = countDigitsBefore(raw, cursor);
  const compact = raw.replace(/\s/g, "");
  const newValue = /[^\d/]/.test(compact)
    ? compact
    : formatCardDetailsFromDigits(compact.replace(/\//g, ""));
  if (newValue === raw) return;
  input.value = newValue;
  restoreInputCursorAfterDigits(input, newValue, digitsBeforeCursor);
}

function formatCardDigitGroups(digits) {
  const parts = [];
  for (let i = 0; i < digits.length; i += 4) {
    parts.push(digits.slice(i, i + 4));
  }
  return parts.join(" ");
}

function formatCardNumberForInput(value) {
  const raw = String(value ?? "");
  const stripped = raw.replace(/\s/g, "");
  if (!stripped) return "";
  if (/[^\d]/.test(stripped)) return stripped;
  return formatCardDigitGroups(stripped);
}

function handleCardNumberInput() {
  const input = elements.personCardNumberInput;
  if (!input) return;
  const raw = input.value;
  const cursor = input.selectionStart ?? raw.length;
  const charsBeforeCursor = countNonSpaceCharsBefore(raw, cursor);
  const stripped = raw.replace(/\s/g, "");
  const newValue = /[^\d]/.test(stripped)
    ? stripped
    : formatCardDigitGroups(stripped);
  if (newValue === raw) return;
  input.value = newValue;
  restoreInputCursor(input, newValue, charsBeforeCursor);
}

function parseAmount(value) {
  const normalized = String(value)
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function getPeopleInBotOrder() {
  return [...state.people].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

function getPersonNumber(person) {
  const ordered = getPeopleInBotOrder();
  const idx = ordered.findIndex((p) => p.id === person.id);
  return idx >= 0 ? idx + 1 : null;
}

function getPersonPreferredSlotIndex(person) {
  const num = getPersonNumber(person);
  return num != null ? num - 1 : 0;
}

function getActiveBotPerson() {
  return state.people.find((person) => person.botPendingSync) || state.people.find((person) => person.useInBot);
}

function getBotPeople() {
  return state.people.filter((person) => person.useInBot);
}

function hasBotPendingSync() {
  return state.people.some((person) => person.botPendingSync);
}

function showBotSyncSuccessMessage() {
  if (!elements.botSuccessBanner) return;
  elements.botSuccessBanner.hidden = false;
  clearTimeout(botSuccessTimer);
  renderSyncNoticeRow();
  botSuccessTimer = setTimeout(() => {
    if (elements.botSuccessBanner) elements.botSuccessBanner.hidden = true;
    renderSyncNoticeRow();
  }, 2800);
}

function confirmOfflineBotSync() {
  const blocked = FamilySync.getSyncBlockedReason?.();
  if (blocked) {
    alert(
      `${blocked}\n\nОткройте «Код семьи» (строка статуса вверху) и нажмите «Сохранить».`,
    );
    return Promise.resolve(false);
  }
  if (!elements.botOfflineDialog) return Promise.resolve(true);
  const hint = elements.botOfflineDialog.querySelector(".dialog-hint");
  if (hint) {
    hint.textContent =
      "Telegram не отвечает (блокировка API, неверный токен, бот не в канале). "
      + "Запрос в бот ПК можно отложить. Для пополнений и трат main.py не нужен — "
      + "данные отправляются sync-ботом прямо в канал.";
  }
  openAppDialog(elements.botOfflineDialog);
  return new Promise((resolve) => {
    const onClose = () => {
      elements.botOfflineDialog.removeEventListener("close", onClose);
      resolve(elements.botOfflineDialog.returnValue === "confirm");
    };
    elements.botOfflineDialog.addEventListener("close", onClose);
  });
}

function refreshPersonBotToggles() {
  const updateList = (container) => {
    if (!container) return;
    container.querySelectorAll(".person-card").forEach((card) => {
      const person = state.people.find((item) => item.id === card.dataset.personId);
      if (!person) return;
      renderBotToggleButton(card.querySelector(".bot-toggle"), person);
    });
  };
  updateList(elements.peopleList);
  updateList(elements.detailsPeopleList);
}

function renderBotPendingBanner() {
  renderSyncNoticeRow();
  refreshPersonBotToggles();
}

function cancelBotPendingForPerson(personId) {
  state.people = state.people.map((person) => {
    if (person.id !== personId) return normalizePerson(person);
    const confirmed = person.botConfirmedInBot != null
      ? person.botConfirmedInBot
      : person.useInBot;
    return normalizePerson({
      ...person,
      botPendingSync: false,
      botPendingAction: null,
      useInBot: confirmed,
      botConfirmedInBot: confirmed,
    });
  });
  if (!hasBotPendingSync()) {
    localStorage.removeItem(PENDING_BOT_REVISION_KEY);
    localStorage.removeItem(PENDING_BOT_AT_KEY);
    if (window.FamilySync?.stopPendingBotPoll) {
      FamilySync.stopPendingBotPoll();
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderBotPendingBanner();
}

function clearBotPendingForPerson(personId) {
  state.people = state.people.map((person) => {
    if (person.id !== personId) return normalizePerson(person);
    return normalizePerson({
      ...person,
      botPendingSync: false,
      botPendingAction: null,
    });
  });
  clearBotSentRevision(personId);
  if (!hasBotPendingSync()) {
    localStorage.removeItem(PENDING_BOT_REVISION_KEY);
    localStorage.removeItem(PENDING_BOT_AT_KEY);
    if (window.FamilySync?.stopPendingBotPoll) {
      FamilySync.stopPendingBotPoll();
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderBotPendingBanner();
}

function clearBotPendingFlags() {
  state.people = state.people.map((person) => normalizePerson({
    ...person,
    botPendingSync: false,
    botPendingAction: null,
  }));
  localStorage.removeItem(PENDING_BOT_REVISION_KEY);
  localStorage.removeItem(PENDING_BOT_AT_KEY);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderBotPendingBanner();
  if (window.FamilySync?.stopPendingBotPoll) {
    FamilySync.stopPendingBotPoll();
  }
}

function getPendingBotAction(person) {
  if (person.botPendingAction === "clear" || person.botPendingAction === "upsert") {
    return person.botPendingAction;
  }
  return person.useInBot ? "upsert" : "clear";
}

function getNextBotRevision() {
  const next = Number(localStorage.getItem(BOT_REVISION_KEY) || 0) + 1;
  localStorage.setItem(BOT_REVISION_KEY, String(next));
  return next;
}

function getLastBotRevision() {
  return Number(localStorage.getItem(BOT_REVISION_KEY) || 0);
}

function canPushBotNow() {
  return isNetworkAvailable() && window.FamilySync?.isSyncReady?.();
}

function getCardNumberForBot(person) {
  const number = String(person?.cardNumber ?? "").trim();
  if (!number) return "";
  const firstLine = number.split("\n")[0].trim();
  const details = String(person?.cardDetails ?? "").trim();
  if (details && firstLine.length > details.length && firstLine.endsWith(` ${details}`)) {
    return firstLine.slice(0, -(details.length + 1)).trim();
  }
  return firstLine;
}

function getMissingBotProfileFields(person) {
  const missing = [];
  if (!String(person?.firstName ?? "").trim()) missing.push("Имя");
  if (!String(person?.lastName ?? "").trim()) missing.push("Фамилия");
  if (!String(person?.phone ?? "").trim()) missing.push("Номер");
  if (!getCardNumberForBot(person)) missing.push("Карта");
  return missing;
}

function alertIfBotProfileIncomplete(person) {
  const missing = getMissingBotProfileFields(person);
  if (!missing.length) return true;
  alert(`Сначала нужно заполнить недостающие данные: ${missing.join(", ")}.`);
  return false;
}

function exportPersonForBot(person) {
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    name: person.name,
    phone: person.phone,
    cardNumber: getCardNumberForBot(person),
  };
}

function buildBotExportPayload(action, person) {
  const revision = getNextBotRevision();
  const personNumber = person ? getPersonNumber(person) : null;
  const preferredSlotIndex = person ? getPersonPreferredSlotIndex(person) : null;
  const assignedSlot = person?.botSlotIndex != null ? Number(person.botSlotIndex) : null;
  const isClear = action === "clear";
  return {
    schemaVersion: 2,
    revision,
    updatedAtMs: Date.now(),
    groupId: null,
    personNumber,
    preferredSlotIndex,
    slotIndex: assignedSlot != null && Number.isFinite(assignedSlot) ? assignedSlot : null,
    activePersonId: person?.id ?? null,
    action,
    person: isClear ? null : (person ? exportPersonForBot(person) : null),
    pending: false,
    status: "pending",
    appliedAtMs: null,
    appliedRevision: null,
    assignedSlotIndex: null,
    error: null,
  };
}

function setUseInBotForPerson(personId, enabled) {
  touchPersonUseInBot(personId, enabled);
}

function markBotPendingForPerson(personId, action) {
  localStorage.removeItem(LAST_BOT_APPLY_KEY);
  localStorage.setItem(PENDING_BOT_AT_KEY, String(Date.now()));
  state.people = state.people.map((person) => {
    if (person.id === personId) {
      return normalizePerson({
        ...person,
        botPendingSync: true,
        botPendingAction: action,
        useInBot: action === "upsert" ? true : person.useInBot,
      });
    }
    return normalizePerson(person);
  });
}

function getBotSentRevisions() {
  try {
    const raw = localStorage.getItem(BOT_SENT_REVISIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setBotSentRevision(personId, revision, action) {
  if (!personId) return;
  const map = getBotSentRevisions();
  map[personId] = { revision, action, at: Date.now() };
  localStorage.setItem(BOT_SENT_REVISIONS_KEY, JSON.stringify(map));
}

function clearBotSentRevision(personId) {
  if (!personId) return;
  const map = getBotSentRevisions();
  if (!map[personId]) return;
  delete map[personId];
  localStorage.setItem(BOT_SENT_REVISIONS_KEY, JSON.stringify(map));
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForPersonBotApplied(personId, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const person = state.people.find((item) => item.id === personId);
      if (!person?.botPendingSync) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 2000);
    };
    check();
  });
}

function scheduleBotExportWorker() {
  if (botExportWorkerBusy) return;
  botExportWorkerBusy = true;
  runBotExportWorkerLoop()
    .catch((error) => console.warn("bot export worker", error))
    .finally(() => {
      botExportWorkerBusy = false;
      if (state.people.some((person) => person.botPendingSync)) {
        scheduleBotExportWorker();
      }
    });
}

async function runBotExportWorkerLoop() {
  while (state.people.some((person) => person.botPendingSync)) {
    if (!canPushBotNow()) {
      renderBotPendingBanner();
      break;
    }

    const pending = state.people.filter((person) => person.botPendingSync);
    if (!pending.length) break;

    const person = pending[0];
    const action = getPendingBotAction(person);
    const sent = getBotSentRevisions()[person.id];

    if (sent?.revision && sent.action === action) {
      const applied = await waitForPersonBotApplied(person.id, 45000);
      if (!applied && state.people.find((item) => item.id === person.id)?.botPendingSync) {
        if (window.FamilySync?.pullNow) {
          await FamilySync.pullNow().catch(() => {});
        }
        if (state.people.find((item) => item.id === person.id)?.botPendingSync) {
          clearBotSentRevision(person.id);
        }
      }
      continue;
    }

    if (window.FamilySync?.cancelPendingPush) {
      FamilySync.cancelPendingPush();
    }

    const payload = buildBotExportPayload(action, person);
    localStorage.setItem(PENDING_BOT_REVISION_KEY, String(payload.revision));
    localStorage.setItem(PENDING_BOT_AT_KEY, String(Date.now()));

    try {
      await pushBotExportPayload(payload, { skipPendingMark: true });
      setBotSentRevision(person.id, payload.revision, action);
    } catch (error) {
      console.warn("bot export send failed", error);
      if (window.FamilySync?.updateSyncStatus) {
        const msg = String(error?.message || "");
        FamilySync.updateSyncStatus(
          "online",
          msg.includes("429") || msg.includes("Too Many Requests")
            ? "Лимит Telegram — пауза, повтор…"
            : "Ошибка отправки в бот",
        );
      }
      await sleepMs(4500);
      break;
    }

    await waitForPersonBotApplied(person.id, 90000);
    const stillPending = state.people.find((item) => item.id === person.id);
    if (stillPending?.botPendingSync) {
      clearBotSentRevision(person.id);
      const inBot = resolvePersonInBotFlag(stillPending);
      state.people = state.people.map((item) => {
        if (item.id !== person.id) return normalizePerson(item);
        return normalizePerson({
          ...item,
          botPendingSync: false,
          botPendingAction: null,
          useInBot: inBot,
          botConfirmedInBot: inBot,
        });
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderBotPendingBanner();
      render();
      if (!hasBotPendingSync()) {
        localStorage.removeItem(PENDING_BOT_REVISION_KEY);
        localStorage.removeItem(PENDING_BOT_AT_KEY);
        if (window.FamilySync?.stopPendingBotPoll) {
          FamilySync.stopPendingBotPoll();
        }
      }
    } else if (stillPending) {
      clearBotSentRevision(person.id);
    }
  }
}

function pushBotExportPayload(payload, options = {}) {
  if (!window.FamilySync?.pushBotExport) return Promise.reject(new Error("no pushBotExport"));

  const personId = payload?.activePersonId;
  const pendingAction = payload?.action === "clear" ? "clear" : "upsert";
  const personStillInApp = personId && state.people.some((p) => p.id === personId);
  if (personStillInApp && !options.skipPendingMark) {
    markBotPendingForPerson(personId, pendingAction);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderBotPendingBanner();
  }
  if (payload?.revision != null) {
    localStorage.setItem(PENDING_BOT_REVISION_KEY, String(payload.revision));
  }

  const stateForPush = normalizeLoadedState(state);
  const send = window.FamilySync.pushWithBotExport
    ? FamilySync.pushWithBotExport(stateForPush, payload, { replaceRemote: true })
    : FamilySync.pushBotExport(payload);

  return send.then(() => {
    if (payload?.revision != null) {
      localStorage.setItem(BOT_EXPORT_SENT_REVISION_KEY, String(payload.revision));
    }
    if (!window.FamilySync?.pushWithBotExport) {
      FamilySync.push(state);
    }
  }).catch((error) => {
    console.warn("botExport push failed", error);
    throw error;
  });
}

function queueBotExportUpsert(person, options = {}) {
  if (!person) return;
  if (!options.skipPendingMark) {
    markBotPendingForPerson(person.id, "upsert");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderBotPendingBanner();
    render();
  }
  if (!canPushBotNow()) return;
  scheduleBotExportWorker();
}

function queueBotExportEdit(person, options = {}) {
  if (!person) return;
  if (!options.skipPendingMark) {
    markBotPendingForPerson(person.id, "upsert");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderBotPendingBanner();
    render();
  }
  if (!canPushBotNow()) return;
  scheduleBotExportWorker();
}

function queueBotExportClear(person, options = {}) {
  if (!person) return;
  if (!options.skipPendingMark) {
    markBotPendingForPerson(person.id, "clear");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderBotPendingBanner();
    render();
  }
  if (!canPushBotNow()) return;
  scheduleBotExportWorker();
}

function syncPersonToBot(person) {
  if (!person?.useInBot) return;
  if (!alertIfBotProfileIncomplete(person)) return;
  if (!canPushBotNow()) {
    markBotPendingForPerson(person.id, "upsert");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderBotPendingBanner();
    return;
  }
  queueBotExportEdit(person);
}

function syncAllBotPeople() {
  getBotPeople().forEach((person) => syncPersonToBot(person));
}

function syncActivePersonToBot() {
  const person = getActiveBotPerson();
  if (!person) return;
  syncPersonToBot(person);
}

function retryBotExportIfNeeded() {
  if (!hasBotPendingSync()) return;

  const pendingRev = Number(localStorage.getItem(PENDING_BOT_REVISION_KEY) || 0);
  const sentRev = Number(localStorage.getItem(BOT_EXPORT_SENT_REVISION_KEY) || 0);

  if (canPushBotNow() && pendingRev > 0 && pendingRev <= sentRev) {
    if (window.FamilySync?.pullNow) {
      FamilySync.pullNow().catch(() => {});
    }
  }

  if (!canPushBotNow()) return;
  scheduleBotExportWorker();
}

function disablePersonInBot(person) {
  markBotPendingForPerson(person.id, "clear");
  saveState({ skipPush: true });
  render();

  if (!canPushBotNow()) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderBotPendingBanner();
    return;
  }

  scheduleBotExportWorker();
}

function toggleUseInBot(person) {
  const freshPerson = () => state.people.find((item) => item.id === person.id) || person;

  if (person.botPendingSync) {
    if (person.botPendingAction === "clear") {
      const enableInBot = () => {
        const current = freshPerson();
        if (!alertIfBotProfileIncomplete(current)) return;
        touchPersonUseInBot(person.id, true);
        markBotPendingForPerson(person.id, "upsert");
        saveState({ skipPush: true });
        render();
        if (!canPushBotNow()) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          renderBotPendingBanner();
          return;
        }
        queueBotExportUpsert(state.people.find((p) => p.id === person.id));
      };
      if (!canPushBotNow()) {
        confirmOfflineBotSync().then((ok) => {
          if (!ok) return;
          enableInBot();
        });
        return;
      }
      enableInBot();
      return;
    }
    disablePersonInBot(person);
    return;
  }

  if (getBotDisplayInBot(person)) {
    if (!canPushBotNow()) {
      confirmOfflineBotSync().then((ok) => {
        if (!ok) return;
        disablePersonInBot(person);
      });
      return;
    }
    disablePersonInBot(person);
    return;
  }

  const enableInBot = () => {
    const current = freshPerson();
    if (!alertIfBotProfileIncomplete(current)) return;
    touchPersonUseInBot(person.id, true);
    markBotPendingForPerson(person.id, "upsert");
    saveState({ skipPush: true });
    render();
    if (!canPushBotNow()) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderBotPendingBanner();
      return;
    }
    queueBotExportUpsert(state.people.find((p) => p.id === person.id));
  };

  if (!canPushBotNow()) {
    confirmOfflineBotSync().then((ok) => {
      if (!ok) return;
      enableInBot();
    });
    return;
  }

  enableInBot();
}

function handleRemoteBotExport(botExport) {
  if (!botExport) return;

  const pendingRev = Number(localStorage.getItem(PENDING_BOT_REVISION_KEY) || 0);
  const appliedRev = Number(botExport.appliedRevision ?? botExport.revision ?? 0);
  const targetsPendingPerson = botExport.activePersonId
    && state.people.some((person) => person.id === botExport.activePersonId && person.botPendingSync);
  const applyKey = `${botExport.activePersonId}:${appliedRev}:${botExport.action}:${botExport.status}`;
  const seenKey = localStorage.getItem(LAST_BOT_APPLY_KEY);

  if (botExport.status === "applied" && botExport.activePersonId) {
    const slot = botExport.assignedSlotIndex;
    const isClear = botExport.action === "clear";
    state.people = state.people.map((person) => {
      if (person.id !== botExport.activePersonId) return normalizePerson(person);
      const inBot = !isClear;
      return normalizePerson({
        ...person,
        useInBot: inBot,
        botConfirmedInBot: inBot,
        botSlotIndex: isClear
          ? null
          : (slot != null && Number.isFinite(Number(slot)) ? Number(slot) : person.botSlotIndex),
        botPendingSync: false,
        botPendingAction: null,
      });
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(LAST_BOT_APPLY_KEY, applyKey);
    if (appliedRev > 0) {
      localStorage.setItem(LAST_APPLIED_BOT_REVISION_KEY, String(appliedRev));
    }
    if (targetsPendingPerson) {
      clearBotPendingForPerson(botExport.activePersonId);
      showBotSyncSuccessMessage();
      if (hasBotPendingSync()) {
        scheduleBotExportWorker();
      }
    }
    render();
    if (window.FamilySync?.updateSyncStatus && !localStorage.getItem(CLOUD_CONFIRM_FP_KEY)) {
      FamilySync.updateSyncStatus("synced", "Синхронизировано");
    }
    return;
  }

  if (botExport.status === "failed" && botExport.error) {
    console.warn("botExport failed:", botExport.error);
    if (targetsPendingPerson) {
      renderBotPendingBanner();
    }
  }
}

function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatMoney(value) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMoneyRub(value) {
  return `${formatMoney(value)}р`;
}

function formatPurchaseCount(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${count} покупок`;
  if (mod10 === 1) return `${count} покупка`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} покупки`;
  return `${count} покупок`;
}

function formatPersonPurchaseStats(stats) {
  const sincePart = `С пополнения ${formatMoneyRub(stats.purchasesTotal)} • ${formatPurchaseCount(stats.purchasesCount)}`;
  const totalPart = `Всего ${formatMoneyRub(stats.purchasesAllTotal)} - ${formatPurchaseCount(stats.purchasesAllCount)}`;
  return `${sincePart} - ${totalPart}`;
}

function formatPersonCardLine(person) {
  const parts = [];
  if (person.cardNumber) parts.push(person.cardNumber);
  if (person.cardDetails) parts.push(person.cardDetails);
  return parts.length > 0 ? parts.join(" ") : "—";
}

function formatLastIncomeStatsLine(stats) {
  if (!stats.lastIncomeAt) {
    return `Пополнений не было · ${formatPurchaseCount(stats.purchasesCount)} · ${formatMoneyRub(stats.purchasesTotal)}`;
  }
  return `Пополнение ${formatMoneyRub(stats.lastIncomeAmount)} · ${formatDate(stats.lastIncomeAt)} · ${formatPurchaseCount(stats.purchasesCount)} · ${formatMoneyRub(stats.purchasesTotal)}`;
}

function copyBlockWithName(person, lines) {
  const name = String(person?.name || "").trim() || "—";
  const data = (lines || []).map((line) => String(line ?? "").trim()).filter(Boolean);
  if (!data.length) return name;
  return [name, ...data].join("\n");
}

function buildPersonCopyText(mode, person, stats) {
  switch (mode) {
    case "phone":
      return copyBlockWithName(person, [person.phone]);
    case "card": {
      const cardParts = [];
      if (person.cardNumber) cardParts.push(person.cardNumber);
      if (person.cardDetails) cardParts.push(person.cardDetails);
      return copyBlockWithName(person, cardParts);
    }
    case "phone-card":
      return copyBlockWithName(person, [
        person.phone || "—",
        formatPersonCardLine(person),
      ]);
    case "brief":
      return copyBlockWithName(person, [
        formatMoney(person.balance),
        person.phone || "—",
        formatPersonCardLine(person),
        formatLastIncomeStatsLine(stats),
      ]);
    case "full":
      return copyBlockWithName(person, [
        formatMoney(person.balance),
        person.phone || "—",
        formatPersonCardLine(person),
        formatLastIncomeStatsLine(stats),
        `Пополнений за 3 дня: ${stats.incomesLast3Days}`,
        `Пополнений за 7 дней: ${stats.incomesLast7Days}`,
        `Покупки за 3 дня: ${formatPurchaseCount(stats.purchasesLast3DaysCount)} · ${formatMoneyRub(stats.purchasesLast3DaysTotal)}`,
        `Покупки за 7 дней: ${formatPurchaseCount(stats.purchasesLast7DaysCount)} · ${formatMoneyRub(stats.purchasesLast7DaysTotal)}`,
      ]);
    default:
      return "";
  }
}

async function copyText(text) {
  const value = String(text ?? "").trim();
  if (!value) {
    alert("Нечего копировать.");
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // fallback below
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function createEmptyState(title, text) {
  const node = elements.emptyStateTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("strong").textContent = title;
  const textNode = node.querySelector("span");
  if (text) {
    textNode.textContent = text;
  } else {
    textNode.remove();
  }
  return node;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // В APK (file://) service worker не работает и может ломать WebView
  if (window.location.protocol === "file:") return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`sw.js?v=${APP_BUILD}`).catch(() => {
      // Приложение продолжит работать без офлайн-кэша.
    });
  });
}

init();
