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
const DEVICE_ID_KEY = "family-counter-device-id";
const APP_BUILD = "68";

function blurActiveInput() {
  const active = document.activeElement;
  if (active && active !== document.body && typeof active.blur === "function") {
    active.blur();
  }
}
const QUICK_AMOUNTS = [1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000];
const TYPE_LABELS = {
  income: "Пополнение",
  purchase: "Покупка",
  transfer: "Перевод",
};

function showBootError(message) {
  const text = String(message || "ошибка");
  if (window.__bootLog) window.__bootLog(text);
  const banner = document.querySelector("#syncAlertBanner");
  if (banner) {
    banner.hidden = false;
    banner.textContent = `Ошибка: ${text}`;
  }
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
  showBootError(String(event.reason?.message || event.reason || "ошибка"));
});

let state;
try {
  state = loadState();
} catch (error) {
  console.error("loadState failed", error);
  showBootError(error?.message || String(error));
  state = getDefaultState();
}
let editingPersonId = null;
let currentOperation = null;
let amountChangeStack = [];
let deferredInstallPrompt = null;
let activeView = "main";
let botSuccessTimer = null;
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
  selectedAmount: document.querySelector("#selectedAmount"),
  addAmountModeButton: document.querySelector("#addAmountModeButton"),
  subtractAmountModeButton: document.querySelector("#subtractAmountModeButton"),
  amountButtons: document.querySelector("#amountButtons"),
  manualAmountInput: document.querySelector("#manualAmountInput"),
  addManualAmountButton: document.querySelector("#addManualAmountButton"),
  undoAmountButton: document.querySelector("#undoAmountButton"),
  clearAmountButton: document.querySelector("#clearAmountButton"),
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
};

init();

function init() {
  try {
    renderAppVersion();
    renderAmountButtons();
    bindEvents();
    setupSyncDialogMode();
    reconcileStaleBotPending();
    initFamilySync();
    if (hasBotPendingSync()) {
      scheduleBotExportWorker();
    }
    render();
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

  FamilySync.onLocalStateMerged = (mergedState) => {
    const localBefore = applyDeletedPersonFilter(normalizeLoadedState(state));
    const normalizedRemote = applyDeletedPersonFilter(
      normalizeLoadedState(filterRemotePeople(mergedState)),
    );
    applySyncMetaFromRemote(normalizedRemote);
    state = applyDeletedPersonFilter(normalizeLoadedState(normalizedRemote));
    state = mergePeoplePreservingLocalEdits(localBefore, normalizedRemote, state);
    state = dropRemoteOnlyGhosts(localBefore, normalizedRemote, state);
    state = preserveLocalBotFields(localBefore, state);
    state = applyDeletedPersonFilter(state);
    state = preferLocalFiltersWhenShrunk(localBefore, normalizedRemote, state);
    state = scrubFiltersToPeople(state);
    state = applyDeletedFolderFilter(state);
    reconcileDeletedPersonIds(normalizedRemote);
    reconcileDeletedFolderIds(normalizedRemote);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(STORAGE_BACKUP_KEY, JSON.stringify(state));
    render();
    if (hasBotPendingSync() && FamilySync.pullNow) {
      FamilySync.pullNow().catch(() => {});
    }
  };

  FamilySync.onBotExportRemote = handleRemoteBotExport;
  FamilySync.onOnline = () => {
    retryBotExportIfNeeded();
    if (!hasBotPendingSync() && FamilySync.isSyncReady()) {
      FamilySync.push(state);
    }
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

function startCloudSync() {
  if (!window.FamilySync?.initFirebase) return;

  const started = FamilySync.initFirebase((remoteState, remoteVersion) => {
    applyRemoteState(remoteState, remoteVersion ?? 0);
  }, { delayInitialPullMs: 3000 });

  if (started && FamilySync.isConfigured()) {
    setTimeout(() => {
      if (hasBotPendingSync()) return;
      if (window.FamilySync?.push) FamilySync.push(state);
    }, 800);
  }
}

function applyRemoteState(remoteState, remoteVersion = 0) {
  if (!window.FamilySync?.mergeStates) return;
  const normalizedRemote = applyDeletedPersonFilter(
    normalizeLoadedState(filterRemotePeople(remoteState)),
  );
  applySyncMetaFromRemote(normalizedRemote);
  const localBefore = applyDeletedPersonFilter(normalizeLoadedState(state));
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
  state.deletedPersonIds = [...getDeletedPersonIds()];
  state.deletedFolderIds = [...getDeletedFolderIds()];
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

  return { ...mergedState, people: [...byId.values()] };
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
  }
}

function isNetworkAvailable() {
  if (window.FamilySync?.isNetworkAvailable) {
    return window.FamilySync.isNetworkAvailable();
  }
  if (navigator.onLine) return true;
  if (window.location.protocol === "file:") return true;
  return false;
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
  elements.syncDialog.close();
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

function bindEvents() {
  if (!elements.addPersonButton) {
    showBootError("Не загрузился интерфейс (index.html)");
    return;
  }
  elements.addPersonButton.addEventListener("click", () => openPersonDialog());
  elements.detailsToggleButton.addEventListener("click", toggleDetailsView);
  elements.historyToggleButton.addEventListener("click", toggleHistoryView);
  bindSyncDialogOpen();
  elements.cancelSyncButton.addEventListener("click", () => elements.syncDialog.close());
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
  elements.cancelPersonButton.addEventListener("click", () => elements.personDialog.close());
  elements.personForm.addEventListener("submit", savePerson);
  elements.addFolderButton.addEventListener("click", openFolderDialog);
  elements.deleteFolderButton.addEventListener("click", openDeleteFolderDialog);
  elements.cancelFolderButton.addEventListener("click", () => elements.folderDialog.close());
  elements.folderForm.addEventListener("submit", saveFolder);
  elements.cancelDeleteFolderButton.addEventListener("click", () => elements.deleteFolderDialog.close());
  elements.deleteFolderForm.addEventListener("submit", deleteSelectedFolder);
  elements.folderList.addEventListener("click", handleFolderClick);
  elements.firstNameFilterList.addEventListener("click", handleFirstNameFilterClick);
  elements.singleFilterToggle.addEventListener("click", toggleSingleFilterMode);
  elements.deletePersonButton.addEventListener("click", deleteEditingPerson);

  elements.clearHistoryButton.addEventListener("click", clearHistory);
  elements.personFilter.addEventListener("change", renderHistory);
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
  elements.detailsPeopleList.addEventListener("click", handleDetailsPeopleClick);
  elements.detailsCopyAll.addEventListener("click", handleDetailsCopyAllClick);
  elements.operationForm.addEventListener("submit", confirmOperation);
  elements.cancelOperationButton.addEventListener("click", closeOperationDialog);
  elements.exitOperationButton.addEventListener("click", closeOperationDialog);
  elements.addManualAmountButton.addEventListener("click", addManualAmount);
  elements.undoAmountButton.addEventListener("click", undoAmountInput);
  elements.clearAmountButton.addEventListener("click", clearAmountAll);
  elements.manualAmountInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addManualAmount();
    }
  });
  elements.resetAmountButton.addEventListener("click", clearAmountAll);
  elements.addAmountModeButton.addEventListener("click", () => setAmountMode("plus"));
  elements.subtractAmountModeButton.addEventListener("click", () => setAmountMode("minus"));

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
}

function getDefaultState() {
  return {
    people: [],
    history: [],
    folders: [],
    activeFolderIds: [],
    activeFirstNames: [],
    singleFilterMode: false,
    botGroupId: null,
    uiUpdatedAt: 0,
    deletedPersonIds: [],
    deletedFolderIds: [],
  };
}

const WIPE_STORAGE_KEYS = [
  STORAGE_KEY,
  STORAGE_BACKUP_KEY,
  DELETED_PERSON_IDS_KEY,
  DELETED_FOLDER_IDS_KEY,
  BOT_REVISION_KEY,
  PENDING_BOT_REVISION_KEY,
  BOT_EXPORT_SENT_REVISION_KEY,
  LAST_APPLIED_BOT_REVISION_KEY,
  PENDING_BOT_AT_KEY,
  LAST_BOT_APPLY_KEY,
  LOCAL_PUSH_REVISION_KEY,
  BOT_SENT_REVISIONS_KEY,
  "family-counter-local-version",
  "family-counter-family-code",
  "family-counter-telegram-token",
  "family-counter-telegram-chat",
  "family-counter-telegram-secret",
  "family-counter-server-url",
];

function wipeAllAppData(options = {}) {
  const pushToCloud = Boolean(options.pushToCloud);
  const message = pushToCloud
    ? "Удалить ВСЕ карты, банки и историю на телефоне и ЗАМЕНИТЬ данные в Telegram на пустое состояние? Другие телефоны при синхронизации тоже очистятся."
    : "Удалить ВСЕ данные только на этом телефоне? (Карты, банки, история, фильтры)";
  if (!confirm(message)) return;

  WIPE_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  state = getDefaultState();
  state.uiUpdatedAt = Date.now();
  editingPersonId = null;
  currentOperation = null;
  saveState({ skipPush: true });
  render();

  if (pushToCloud && window.FamilySync) {
    markLocalEditPending();
    if (FamilySync.pushImmediate) {
      FamilySync.pushImmediate(state)
        .then(() => alert("Данные очищены и отправлены в облако Telegram."))
        .catch(() => alert("Данные очищены на телефоне. Облако: нет сети или ошибка отправки."));
    } else if (FamilySync.push) {
      FamilySync.push(state);
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
  const filtered = applyDeletedPersonFilter(applyDeletedFolderFilter(loaded));
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
  const people = Array.isArray(withTombstones.people)
    ? withTombstones.people.map((person) => normalizePerson({
      ...person,
      folderIds: Array.isArray(person.folderIds)
        ? person.folderIds.filter((id) => folderIds.has(id))
        : [],
    }))
    : [];
  const existingFirstNames = new Set(people.map((person) => getPersonFirstName(person)));
  const botGroupId = withTombstones.botGroupId != null && withTombstones.botGroupId !== ""
    ? Number(withTombstones.botGroupId)
    : null;
  return {
    people,
    history: Array.isArray(withTombstones.history) ? withTombstones.history : [],
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
    deletedPersonIds: Array.isArray(withTombstones.deletedPersonIds)
      ? withTombstones.deletedPersonIds.filter(Boolean)
      : [],
    deletedFolderIds: Array.isArray(withTombstones.deletedFolderIds)
      ? withTombstones.deletedFolderIds.filter(Boolean)
      : [],
  };
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
    : (pending ? false : Boolean(person.useInBot));
  const useInBot = pending ? Boolean(person.useInBot) : confirmed;

  return {
    ...person,
    firstName,
    lastName,
    name: formatPersonName(firstName, lastName),
    phone: String(person.phone ?? "").trim(),
    cardNumber: String(person.cardNumber ?? "").trim(),
    cardDetails: String(person.cardDetails ?? "").trim(),
    profileNote: String(person.profileNote ?? "").trim(),
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

function touchPersonProfileFields(person, at = Date.now()) {
  return touchPersonFields(person, [
    "firstName",
    "lastName",
    "name",
    "phone",
    "cardNumber",
    "cardDetails",
    "profileNote",
    "folderIds",
    "balance",
  ], at);
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
  if (person.botConfirmedInBot != null) return Boolean(person.botConfirmedInBot);
  if (person.botPendingSync) return false;
  return Boolean(person.useInBot);
}

function getBotDisplayInBot(person) {
  return getBotConfirmedInBot(person);
}

function renderBotToggleButton(botToggle, person) {
  const pending = Boolean(person.botPendingSync);
  const displayInBot = getBotDisplayInBot(person);
  const slotLabel = person.botSlotIndex != null
    ? person.botSlotIndex + 1
    : (getPersonNumber(person) || "");
  botToggle.textContent = displayInBot
    ? (slotLabel ? `В боте ${slotLabel}` : "В боте")
    : "Не в боте";
  botToggle.classList.remove("active", "inactive", "pending");
  if (pending) {
    botToggle.classList.add("pending");
  } else if (displayInBot) {
    botToggle.classList.add("active");
  } else {
    botToggle.classList.add("inactive");
  }
}

function renderSyncAlertBanner() {
  if (!elements.syncAlertBanner) return;
  const alert = state.syncAlert;
  const health = state.syncHealth;
  const msg = alert?.message || (health && !health.ok ? health.message : "");
  if (!msg) {
    elements.syncAlertBanner.hidden = true;
    elements.syncAlertBanner.textContent = "";
    return;
  }
  elements.syncAlertBanner.hidden = false;
  elements.syncAlertBanner.textContent = `⚠️ Синхронизация: ${msg}`;
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

function saveState(options = {}) {
  state.deletedPersonIds = [...getDeletedPersonIds()];
  state.deletedFolderIds = [...getDeletedFolderIds()];
  const json = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, json);
  localStorage.setItem(STORAGE_BACKUP_KEY, json);
  if (!options.skipPush && window.FamilySync?.push) {
    FamilySync.push(state);
  }
}

function render() {
  renderBotPendingBanner();
  renderSyncAlertBanner();
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
  activeView = activeView === "history" ? "main" : "history";
  updateViewMode();
}

function toggleDetailsView() {
  activeView = activeView === "details" ? "main" : "details";
  updateViewMode();
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
  card.className = "person-card";
  card.dataset.personId = person.id;
  const detailsLine = detailed
    ? `
    <div class="person-line person-line-details"><span class="person-details-line"></span></div>
    <div class="person-copy-actions">
      <button type="button" class="copy-chip" data-copy="phone">Телефон</button>
      <button type="button" class="copy-chip" data-copy="card">Карта</button>
      <button type="button" class="copy-chip" data-copy="phone-card">Тел+карта</button>
      <button type="button" class="copy-chip" data-copy="brief">Краткие данные</button>
      <button type="button" class="copy-chip" data-copy="full">Все данные</button>
    </div>`
    : "";
  card.innerHTML = `
    <div class="person-head-row">
      <div class="person-line person-line-head">
        <button class="bot-toggle" type="button" data-action="bot-toggle" aria-label="Использовать в боте"></button>
        <span class="person-name"></span>
        <button class="edit-link" type="button" data-action="edit">Изм.</button>
      </div>
      <div class="person-top-actions">
        <button class="mini minus" type="button" data-action="expense">Трата</button>
        <button class="mini plus" type="button" data-action="income">Пополнить</button>
      </div>
    </div>
    <div class="person-line person-line-balance">
      <span class="person-balance"></span>
      <span class="row-sep">·</span>
      <span class="last-income"></span>
    </div>
    <div class="person-line person-line-stats">
      <span class="person-stats-line"></span>
    </div>
    ${detailsLine}
  `;
  card.querySelector(".person-name").textContent = person.name;
  const botToggle = card.querySelector(".bot-toggle");
  renderBotToggleButton(botToggle, person);
  card.querySelector(".person-balance").textContent = formatMoney(person.balance);
  card.querySelector(".last-income").textContent = formatMoney(stats.lastIncomeAmount);
  card.querySelector(".person-stats-line").textContent = formatPersonPurchaseStats(stats);
  if (detailed) {
    card.querySelector(".person-details-line").textContent = formatPersonDetailsLine(person);
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
    return people;
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

  return namePeople;
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
  elements.folderDialog.close();
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
    elements.deleteFolderDialog.close();
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

function renderHistory() {
  const personId = elements.personFilter.value;
  const type = elements.typeFilter.value;
  const commentQuery = elements.commentFilter?.value || "";
  const rows = state.history
    .filter((item) => personId === "all" || item.personId === personId)
    .filter((item) => type === "all" || item.type === type)
    .filter((item) => matchesCommentFilter(item.note, commentQuery))
    .sort((a, b) => b.createdAt - a.createdAt);

  elements.historyList.innerHTML = "";
  if (rows.length === 0) {
    const hasHistory = state.history.length > 0;
    const hasActiveFilters = personId !== "all" || type !== "all" || commentQuery.trim();
    const title = hasHistory && hasActiveFilters ? "Ничего не найдено" : "Истории пока нет";
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
    const sign = item.direction === "plus" ? "+" : "-";
    const note = item.note ? ` · ${item.note}` : "";
    row.innerHTML = `
      <div class="history-line">
        <strong></strong>
        <span class="history-amount ${item.type}"></span>
      </div>
      <div class="history-meta"></div>
    `;
    row.querySelector("strong").textContent = item.personName;
    row.querySelector(".history-amount").textContent = `${sign}${formatMoney(item.amount)}`;
    row.querySelector(".history-meta").textContent = `${TYPE_LABELS[item.type]} · ${formatDate(item.createdAt)}${note}`;
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

  if (mode === "phone") {
    return people.map((person) => person.phone).filter(Boolean).join("\n");
  }

  const blocks = people.map((person) => {
    const stats = getPersonStats(person.id);
    return buildPersonCopyText(mode, person, stats).trim();
  }).filter(Boolean);

  return blocks.join("\n\n");
}

function openPersonDialog(person = null) {
  editingPersonId = person?.id ?? null;
  elements.personDialogTitle.textContent = person ? "Изменить карту" : "Добавить карту";
  elements.personFirstNameInput.value = person?.firstName ?? "";
  elements.personLastNameInput.value = person?.lastName ?? "";
  elements.personBalanceInput.value = person ? String(person.balance) : "";
  elements.personPhoneInput.value = person?.phone ?? "";
  elements.personCardNumberInput.value = person?.cardNumber ?? "";
  elements.personCardDetailsInput.value = person?.cardDetails ?? "";
  elements.personProfileNoteInput.value = person?.profileNote ?? "";
  if (elements.personUseInBotCheckbox) {
    elements.personUseInBotCheckbox.checked = Boolean(person?.useInBot);
  }
  elements.deletePersonButton.hidden = !person;
  renderFolderPicker(person?.folderIds ?? []);
  openAppDialog(elements.personDialog);
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
  const folderIds = [...elements.personFolderPicker.querySelectorAll("input:checked")]
    .map((input) => input.value);
  const name = formatPersonName(firstName, lastName);

  if (!firstName) return;
  if (balance < 0) {
    alert("Начальная сумма не может быть меньше нуля.");
    return;
  }

  markLocalEditPending();

  if (editingPersonId) {
    state.people = state.people.map((person) =>
      person.id === editingPersonId
        ? touchPersonProfileFields(normalizePerson({
          ...person,
          firstName,
          lastName,
          name,
          balance,
          phone,
          cardNumber,
          cardDetails,
          profileNote,
          folderIds,
        }), now)
        : person
    );
  } else {
    const newPerson = touchPersonProfileFields(normalizePerson({
      id: makeId(),
      firstName,
      lastName,
      name,
      balance,
      phone,
      cardNumber,
      cardDetails,
      profileNote,
      folderIds,
      createdAt: now,
    }), now);
    state.people.push(newPerson);
  }

  state.activeFirstNames = state.activeFirstNames.filter((activeName) =>
    state.people.some((person) => getPersonFirstName(person) === activeName)
  );

  const savedPerson = editingPersonId
    ? state.people.find((item) => item.id === editingPersonId)
    : state.people[state.people.length - 1];
  activateFiltersForPerson(savedPerson, { isNew: !editingPersonId });

  saveState();
  elements.personDialog.close();
  render();

  const saved = editingPersonId
    ? state.people.find((item) => item.id === editingPersonId)
    : state.people[state.people.length - 1];

  if (!saved || !elements.personUseInBotCheckbox) return;

  const wantInBot = elements.personUseInBotCheckbox.checked;
  const botCheckboxChanged = wantInBot !== saved.useInBot;
  const profileEditWhileInBot = saved.useInBot && !botCheckboxChanged;

  if (!botCheckboxChanged && !profileEditWhileInBot) return;

  const runBotSync = () => {
    if (botCheckboxChanged) {
      if (wantInBot) {
        touchPersonUseInBot(saved.id, true);
        saveState();
        render();
        queueBotExportUpsert(state.people.find((p) => p.id === saved.id));
      } else {
        disablePersonInBot(saved);
      }
    } else if (profileEditWhileInBot) {
      syncPersonToBot(saved);
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
    elements.personDialog.close();
  }
}

function renderAmountButtons() {
  const fragment = document.createDocumentFragment();
  QUICK_AMOUNTS.forEach((amount) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.amount = String(amount);
    button.textContent = `+${formatMoney(amount)}`;
    button.addEventListener("click", () => {
      if (!currentOperation) return;
      const multiplier = currentOperation.amountMode === "minus" ? -1 : 1;
      applyAmountChange(currentOperation.amount + amount * multiplier);
    });
    fragment.append(button);
  });
  elements.amountButtons.append(fragment);
}

function openOperationDialog(person, direction) {
  currentOperation = {
    personId: person.id,
    direction,
    amount: 0,
    amountMode: "plus",
  };

  elements.operationPerson.textContent = person.name;
  elements.operationTitle.textContent = direction === "plus" ? "Пополнение" : "Покупка или перевод";
  elements.operationDialog.classList.toggle("is-income", direction === "plus");
  elements.transferToggleRow.hidden = direction === "plus";
  elements.transferCheckbox.checked = false;
  elements.noteInput.value = "";
  elements.manualAmountInput.value = "";
  amountChangeStack = [];
  setAmountMode("plus");
  updateSelectedAmount(0);
  openAppDialog(elements.operationDialog);
}

function closeOperationDialog() {
  currentOperation = null;
  amountChangeStack = [];
  elements.operationDialog.close();
}

function addManualAmount() {
  if (!currentOperation) return;
  const amount = parseAmount(elements.manualAmountInput.value);
  if (amount <= 0) return;
  const multiplier = currentOperation.amountMode === "minus" ? -1 : 1;
  applyAmountChange(currentOperation.amount + amount * multiplier);
  elements.manualAmountInput.value = "";
}

function pushAmountState() {
  if (!currentOperation) return;
  amountChangeStack.push(currentOperation.amount);
}

function applyAmountChange(amount) {
  pushAmountState();
  updateSelectedAmount(amount);
}

function undoAmountInput() {
  const manualValue = elements.manualAmountInput.value;
  if (manualValue.length > 0) {
    elements.manualAmountInput.value = manualValue.slice(0, -1);
    return;
  }
  if (amountChangeStack.length === 0) return;
  updateSelectedAmount(amountChangeStack.pop());
}

function clearAmountAll() {
  elements.manualAmountInput.value = "";
  amountChangeStack = [];
  updateSelectedAmount(0);
}

function updateSelectedAmount(amount) {
  if (!currentOperation) return;
  currentOperation.amount = Math.max(0, amount);
  elements.selectedAmount.textContent = formatMoney(currentOperation.amount);
  elements.confirmOperationButton.disabled = currentOperation.amount <= 0;
}

function setAmountMode(mode) {
  if (!currentOperation) return;
  currentOperation.amountMode = mode;
  const isMinus = mode === "minus";
  elements.addAmountModeButton.classList.toggle("active", !isMinus);
  elements.subtractAmountModeButton.classList.toggle("active", isMinus);
  elements.amountButtons.querySelectorAll("button").forEach((button) => {
    const amount = Number(button.dataset.amount);
    button.textContent = `${isMinus ? "-" : "+"}${formatMoney(amount)}`;
  });
  elements.addManualAmountButton.textContent = isMinus ? "Убавить" : "Добавить";
}

function confirmOperation(event) {
  event.preventDefault();
  if (!currentOperation || currentOperation.amount <= 0) return;

  const person = state.people.find((item) => item.id === currentOperation.personId);
  if (!person) return;

  const type = currentOperation.direction === "plus"
    ? "income"
    : elements.transferCheckbox.checked
      ? "transfer"
      : "purchase";
  const delta = currentOperation.direction === "plus" ? currentOperation.amount : -currentOperation.amount;

  person.balance += delta;
  state.history.push({
    id: makeId(),
    personId: person.id,
    personName: person.name,
    direction: currentOperation.direction,
    type,
    amount: currentOperation.amount,
    balanceAfter: person.balance,
    note: elements.noteInput.value.trim(),
    createdAt: Date.now(),
    deviceId: getDeviceId(),
  });

  saveState();
  currentOperation = null;
  elements.operationDialog.close();
  render();
}

function clearHistory() {
  if (state.history.length === 0) return;
  const ok = confirm("Очистить всю историю? Балансы людей не изменятся.");
  if (!ok) return;

  state.history = [];
  saveState();
  render();
}

function syncTabs(type) {
  document.querySelectorAll(".tab[data-type]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.type === type);
  });
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
  botSuccessTimer = setTimeout(() => {
    if (elements.botSuccessBanner) elements.botSuccessBanner.hidden = true;
  }, 2000);
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

function renderBotPendingBanner() {
  if (!elements.botPendingBanner) return;
  const pending = hasBotPendingSync();
  if (!pending || canPushBotNow()) {
    elements.botPendingBanner.hidden = true;
    elements.botPendingBanner.textContent = "";
    return;
  }
  elements.botPendingBanner.hidden = false;
  elements.botPendingBanner.textContent =
    "Запрос в бот отложен — нужна связь с Telegram (main.py только для бота ПК с картами)";
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

let botExportWorkerBusy = false;

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
    if (!state.people.find((item) => item.id === person.id)?.botPendingSync) {
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
    ? FamilySync.pushWithBotExport(stateForPush, payload)
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
  if (person.botPendingSync) {
    if (person.botPendingAction === "clear") {
      const enableInBot = () => {
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
    if (window.FamilySync?.updateSyncStatus) {
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
  const sincePart = `С последнего пополнения ${formatMoneyRub(stats.purchasesTotal)} • ${formatPurchaseCount(stats.purchasesCount)}`;
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

function buildPersonCopyText(mode, person, stats) {
  switch (mode) {
    case "phone":
      return person.phone || "";
    case "card":
      const cardParts = [];
      if (person.cardNumber) cardParts.push(person.cardNumber);
      if (person.cardDetails) cardParts.push(person.cardDetails);
      return cardParts.join("\n");
    case "phone-card":
      return [
        person.name,
        person.phone || "—",
        formatPersonCardLine(person),
      ].join("\n");
    case "brief":
      return [
        `${person.name} ${formatMoney(person.balance)}`,
        person.phone || "—",
        formatPersonCardLine(person),
        formatLastIncomeStatsLine(stats),
      ].join("\n");
    case "full":
      return [
        `${person.name} ${formatMoney(person.balance)}`,
        person.phone || "—",
        formatPersonCardLine(person),
        formatLastIncomeStatsLine(stats),
        `Пополнений за 3 дня: ${stats.incomesLast3Days}`,
        `Пополнений за 7 дней: ${stats.incomesLast7Days}`,
        `Покупки за 3 дня: ${formatPurchaseCount(stats.purchasesLast3DaysCount)} · ${formatMoneyRub(stats.purchasesLast3DaysTotal)}`,
        `Покупки за 7 дней: ${formatPurchaseCount(stats.purchasesLast7DaysCount)} · ${formatMoneyRub(stats.purchasesLast7DaysTotal)}`,
      ].join("\n");
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

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`sw.js?v=${APP_BUILD}`)
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              worker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });

        if (registration.waiting && navigator.serviceWorker.controller) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
      })
      .catch(() => {
        // Приложение продолжит работать без офлайн-кэша.
      });
  });
}
