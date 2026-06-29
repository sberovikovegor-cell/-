/**
 * Слияние данных семьи: история операций суммируется по времени,
 * профиль человека — побеждает более позднее изменение поля.
 */
(function () {
  const PROFILE_FIELDS = [
    "firstName",
    "lastName",
    "name",
    "phone",
    "cardNumber",
    "cardDetails",
    "profileNote",
    "folderIds",
    "useInBot",
    "botSlotIndex",
  ];

  function mergeHistory(localHistory, remoteHistory, clearedAtMs = 0) {
    const effectiveClear = Number(clearedAtMs || 0);
    const map = new Map();
    [...(localHistory || []), ...(remoteHistory || [])].forEach((item) => {
      if (!item?.id) return;
      if (effectiveClear > 0 && Number(item.createdAt || 0) <= effectiveClear) return;
      const existing = map.get(item.id);
      if (!existing || Number(item.createdAt || 0) > Number(existing.createdAt || 0)) {
        map.set(item.id, { ...item });
      }
    });
    return [...map.values()].sort(
      (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0),
    );
  }

  function mergeHistoryMonths(localMonths, remoteMonths) {
    const map = new Map();
    [...(localMonths || []), ...(remoteMonths || [])].forEach((month) => {
      if (!month || month.index == null) return;
      const index = Number(month.index);
      if (!Number.isFinite(index) || index < 1) return;
      const existing = map.get(index);
      const mergedEntries = existing
        ? mergeHistory(existing.history, month.history, 0)
        : mergeHistory([], month.history, 0);
      map.set(index, {
        index,
        title: month.title || existing?.title || `Месяц ${index}`,
        archivedAt: Math.max(
          Number(existing?.archivedAt || 0),
          Number(month.archivedAt || 0),
        ),
        history: mergedEntries,
      });
    });
    return [...map.values()].sort((a, b) => a.index - b.index);
  }

  function mergeFolders(localFolders, remoteFolders) {
    const map = new Map();
    [...(localFolders || []), ...(remoteFolders || [])].forEach((folder) => {
      if (!folder?.id) return;
      const existing = map.get(folder.id);
      if (!existing || Number(folder.createdAt || 0) >= Number(existing.createdAt || 0)) {
        map.set(folder.id, { ...folder });
      }
    });
    return [...map.values()].sort(
      (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0),
    );
  }

  function fieldTime(person, field) {
    const ft = person?.fieldUpdatedAt || {};
    const t = ft[field];
    if (t != null && Number.isFinite(Number(t))) return Number(t);
    return Number(person?.createdAt || 0);
  }

  function pickField(localPerson, remotePerson, field) {
    const localTime = fieldTime(localPerson, field);
    const remoteTime = fieldTime(remotePerson, field);
    if (remoteTime > localTime) return remotePerson[field];
    if (localTime > remoteTime) return localPerson[field];
    return remotePerson[field] !== undefined ? remotePerson[field] : localPerson[field];
  }

  function mergeFieldUpdatedAt(localPerson, remotePerson) {
    const out = { ...(localPerson.fieldUpdatedAt || {}) };
    const remoteFt = remotePerson.fieldUpdatedAt || {};
    PROFILE_FIELDS.forEach((field) => {
      const lt = fieldTime(localPerson, field);
      const rt = fieldTime(remotePerson, field);
      if (rt >= lt && remoteFt[field] != null) out[field] = remoteFt[field];
      else if (lt > rt && out[field] == null) out[field] = lt;
    });
    return out;
  }

  function mergePeople(localPeople, remotePeople) {
    const map = new Map();
    [...(localPeople || []), ...(remotePeople || [])].forEach((person) => {
      if (!person?.id) return;
      map.set(person.id, person);
    });

    const ids = new Set([...(localPeople || []), ...(remotePeople || [])].map((p) => p.id));
    const result = [];

    ids.forEach((id) => {
      const localPerson = (localPeople || []).find((p) => p.id === id);
      const remotePerson = (remotePeople || []).find((p) => p.id === id);
      if (!localPerson) {
        result.push({ ...remotePerson });
        return;
      }
      if (!remotePerson) {
        result.push({ ...localPerson });
        return;
      }

      const merged = { ...localPerson };
      PROFILE_FIELDS.forEach((field) => {
        merged[field] = pickField(localPerson, remotePerson, field);
      });
      merged.fieldUpdatedAt = mergeFieldUpdatedAt(localPerson, remotePerson);

      const localManualAt = Number(localPerson.balanceManualAt || 0);
      const remoteManualAt = Number(remotePerson.balanceManualAt || 0);
      if (remoteManualAt > localManualAt) {
        merged.balance = Number(remotePerson.balance || 0);
        merged.balanceManualAt = remoteManualAt;
      } else if (localManualAt > remoteManualAt) {
        merged.balance = Number(localPerson.balance || 0);
        merged.balanceManualAt = localManualAt;
      } else if (localManualAt > 0 && remoteManualAt > 0) {
        const balanceTime = fieldTime(localPerson, "balance");
        const remoteBalanceTime = fieldTime(remotePerson, "balance");
        merged.balance = remoteBalanceTime > balanceTime
          ? Number(remotePerson.balance || 0)
          : Number(localPerson.balance || 0);
        merged.balanceManualAt = localManualAt;
      } else {
        delete merged.balanceManualAt;
      }
      const pickedUseInBot = Boolean(pickField(localPerson, remotePerson, "useInBot"));
      merged.useInBot = pickedUseInBot;
      merged.botSlotIndex = pickField(localPerson, remotePerson, "botSlotIndex");

      const localUseTime = fieldTime(localPerson, "useInBot");
      const remoteUseTime = fieldTime(remotePerson, "useInBot");
      const confirmedWinner = remoteUseTime > localUseTime ? remotePerson : localPerson;
      if (confirmedWinner.botConfirmedInBot != null) {
        merged.botConfirmedInBot = Boolean(confirmedWinner.botConfirmedInBot);
      } else {
        merged.botConfirmedInBot = pickedUseInBot;
      }

      // Ожидание ответа ПК-бота — только на этом устройстве, не через канал.
      if (localPerson.botPendingSync) {
        merged.botPendingSync = true;
        merged.botPendingAction = localPerson.botPendingAction;
        if (localPerson.botPendingAction === "upsert") {
          merged.useInBot = true;
          merged.botConfirmedInBot = localPerson.botConfirmedInBot != null
            ? Boolean(localPerson.botConfirmedInBot)
            : true;
        } else if (localPerson.botPendingAction === "clear") {
          merged.useInBot = Boolean(localPerson.useInBot);
          merged.botConfirmedInBot = localPerson.botConfirmedInBot != null
            ? Boolean(localPerson.botConfirmedInBot)
            : false;
        }
      } else {
        merged.botPendingSync = false;
        merged.botPendingAction = null;
      }
      merged.createdAt = Math.min(
        Number(localPerson.createdAt || Date.now()),
        Number(remotePerson.createdAt || Date.now()),
      );
      merged.id = id;
      result.push(merged);
    });

    return result;
  }

  function dedupePeopleById(people) {
    const map = new Map();
    (people || []).forEach((person) => {
      if (person?.id && !map.has(person.id)) {
        map.set(person.id, person);
      }
    });
    return [...map.values()];
  }

  function orderPeopleLike(templatePeople, mergedPeople) {
    const byId = new Map();
    (mergedPeople || []).forEach((person) => {
      if (person?.id) byId.set(person.id, person);
    });
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

  function historyDelta(entry) {
    if (entry?.type === "balance_set") return 0;
    const amount = Number(entry.amount || 0);
    if (entry.direction === "plus") return amount;
    if (entry.direction === "minus") return -amount;
    if (entry.type === "income") return amount;
    return -amount;
  }

  function collectAllHistory(appState) {
    const clearedAtMs = Number(appState?.historyClearedAtMs || 0);
    const fromMonths = [];
    (appState?.historyMonths || []).forEach((month) => {
      (month?.history || []).forEach((entry) => fromMonths.push(entry));
    });
    return mergeHistory(fromMonths, appState?.history || [], clearedAtMs);
  }

  function lastHistoryTimeForPerson(personId, history) {
    let max = 0;
    (history || []).forEach((entry) => {
      if (entry.personId === personId) {
        max = Math.max(max, Number(entry.createdAt || 0));
      }
    });
    return max;
  }

  function replayBalancesFromHistory(people, history) {
    const sorted = [...(history || [])].sort(
      (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0),
    );

    return (people || []).map((person) => {
      const pickedBalance = Number(person.balance || 0);
      const lastHistAt = lastHistoryTimeForPerson(person.id, sorted);
      const personHistory = sorted.filter((h) => h.personId === person.id);
      if (personHistory.length === 0) {
        return { ...person, balance: pickedBalance };
      }

      const first = personHistory[0];
      const firstDelta = historyDelta(first);
      let replayedBalance = first.type === "balance_set"
        ? Number(first.balanceAfter || 0)
        : Number(first.balanceAfter || 0) - firstDelta;
      personHistory.forEach((entry) => {
        if (entry.type === "balance_set") {
          replayedBalance = Number(entry.balanceAfter || replayedBalance);
          return;
        }
        if (entry === first && first.type === "balance_set") return;
        replayedBalance += historyDelta(entry);
      });
      replayedBalance = Math.round(replayedBalance * 100) / 100;

      const manualAt = Number(person.balanceManualAt || 0);
      if (manualAt > 0 && manualAt >= lastHistAt) {
        return { ...person, balance: pickedBalance };
      }
      return { ...person, balance: replayedBalance };
    });
  }

  function getRequiredDataEpoch() {
    return Number(window.FAMILY_TELEGRAM_CONFIG?.dataEpoch || 0);
  }

  function remoteMeetsDataEpoch(remoteState) {
    const required = getRequiredDataEpoch();
    if (!required) return true;
    return Number(remoteState?.dataEpoch || 0) >= required;
  }

  function filterRemoteToKnownIds(remoteState, localState) {
    if (!remoteState || !localState) return remoteState;
    const peopleIds = new Set((localState.people || []).map((p) => p.id).filter(Boolean));
    const historyIds = new Set((localState.history || []).map((h) => h.id).filter(Boolean));
    const folderIds = new Set((localState.folders || []).map((f) => f.id).filter(Boolean));
    return {
      ...remoteState,
      people: (remoteState.people || []).filter((p) => peopleIds.has(p.id)),
      history: (remoteState.history || []).filter((h) => historyIds.has(h.id)),
      folders: (remoteState.folders || []).filter((f) => folderIds.has(f.id)),
    };
  }

  function mergeStates(localState, remoteState) {
    const local = localState || {};
    const remote = remoteState || {};
    const required = getRequiredDataEpoch();
    const localWipe = Number(local.wipedAtMs || 0);
    const remoteWipe = Number(remote.wipedAtMs || 0);

    if (required > 0 && !remoteMeetsDataEpoch(remote)) {
      return {
        ...local,
        dataEpoch: Math.max(Number(local.dataEpoch || 0), required),
        wipedAtMs: Math.max(localWipe, remoteWipe),
        deletedPersonIds: [...new Set([...(local.deletedPersonIds || []), ...(remote.deletedPersonIds || [])])],
        deletedFolderIds: [...new Set([...(local.deletedFolderIds || []), ...(remote.deletedFolderIds || [])])],
      };
    }

    if (localWipe > 0 && localWipe > remoteWipe) {
      const trimmedRemote = filterRemoteToKnownIds(remote, local);
      return mergeStatesCore(local, trimmedRemote);
    }

    return mergeStatesCore(local, remote);
  }

  function mergeStatesCore(localState, remoteState) {
    const deletedPersonIds = [
      ...new Set([
        ...(localState?.deletedPersonIds || []),
        ...(remoteState?.deletedPersonIds || []),
      ]),
    ].filter(Boolean);
    const deletedFolderIds = [
      ...new Set([
        ...(localState?.deletedFolderIds || []),
        ...(remoteState?.deletedFolderIds || []),
      ]),
    ].filter(Boolean);
    const deletedPersonSet = new Set(deletedPersonIds);
    const deletedFolderSet = new Set(deletedFolderIds);

    let folders = mergeFolders(localState?.folders, remoteState?.folders)
      .filter((folder) => !deletedFolderSet.has(folder.id));
    const folderIds = new Set(folders.map((f) => f.id));
    const historyClearedAtMs = Math.max(
      Number(localState?.historyClearedAtMs || 0),
      Number(remoteState?.historyClearedAtMs || 0),
    );
    const historyMonths = mergeHistoryMonths(
      localState?.historyMonths,
      remoteState?.historyMonths,
    );
    const history = mergeHistory(
      localState?.history,
      remoteState?.history,
      historyClearedAtMs,
    );
    const fullHistory = collectAllHistory({
      history,
      historyMonths,
      historyClearedAtMs,
    });
    let people = dedupePeopleById(mergePeople(localState?.people, remoteState?.people));
    const localUi = Number(localState?.uiUpdatedAt || 0);
    const remoteUi = Number(remoteState?.uiUpdatedAt || 0);
    const localOrderAt = Number(localState?.peopleOrderUpdatedAt || 0);
    const remoteOrderAt = Number(remoteState?.peopleOrderUpdatedAt || 0);
    const orderTemplate = localOrderAt >= remoteOrderAt
      ? (localState?.people || [])
      : (remoteState?.people || []);
    people = orderPeopleLike(orderTemplate, people);
    people = people.map((person) => ({
      ...person,
      folderIds: Array.isArray(person.folderIds)
        ? person.folderIds.filter((id) => folderIds.has(id))
        : [],
    }));
    people = replayBalancesFromHistory(people, fullHistory);

    const peopleFirstNames = new Set(
      people.map(
        (p) => String(p.firstName ?? "").trim() || String(p.name ?? "").split(/\s+/)[0],
      ),
    );

    const remoteGroupId = remoteState?.botGroupId;
    const localGroupId = localState?.botGroupId;
    let botGroupId = remoteGroupId != null && remoteGroupId !== "" ? remoteGroupId : localGroupId;
    botGroupId = botGroupId != null && botGroupId !== "" ? Number(botGroupId) : null;
    if (!Number.isFinite(botGroupId)) botGroupId = null;

    const remoteActive = (remoteState?.activeFolderIds || []).filter((id) => folderIds.has(id));
    const localActive = (localState?.activeFolderIds || []).filter((id) => folderIds.has(id));
    const localNames = (localState?.activeFirstNames || []).filter((name) => peopleFirstNames.has(name));
    const remoteNames = (remoteState?.activeFirstNames || []).filter((name) => peopleFirstNames.has(name));

    const activeFolderIds = remoteUi > localUi
      ? (remoteActive.length ? remoteActive : localActive)
      : localActive;

    const activeFirstNames = remoteUi > localUi
      ? (remoteNames.length ? remoteNames : localNames)
      : localNames;

    if (deletedPersonSet.size) {
      people = people.filter((person) => !deletedPersonSet.has(person.id));
    }

    const required = getRequiredDataEpoch();
    const dataEpoch = Math.max(
      Number(localState?.dataEpoch || 0),
      Number(remoteState?.dataEpoch || 0),
      required,
    );

    return {
      people,
      history,
      historyMonths,
      historyClearedAtMs,
      folders,
      activeFolderIds,
      activeFirstNames,
      singleFilterMode: remoteUi >= localUi
        ? Boolean(remoteState?.singleFilterMode)
        : Boolean(localState?.singleFilterMode),
      botGroupId,
      uiUpdatedAt: Math.max(localUi, remoteUi),
      peopleOrderUpdatedAt: Math.max(localOrderAt, remoteOrderAt),
      wipedAtMs: Math.max(
        Number(localState?.wipedAtMs || 0),
        Number(remoteState?.wipedAtMs || 0),
      ),
      dataEpoch,
      deletedPersonIds,
      deletedFolderIds,
    };
  }

  window.FamilyMerge = {
    mergeStates,
    mergeHistory,
    mergeHistoryMonths,
    mergePeople,
    dedupePeopleById,
    orderPeopleLike,
    mergeFolders,
    replayBalancesFromHistory,
    collectAllHistory,
    PROFILE_FIELDS,
  };
})();
