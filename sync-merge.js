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
    "balance",
    "useInBot",
    "botSlotIndex",
  ];

  function mergeHistory(localHistory, remoteHistory) {
    const map = new Map();
    [...(localHistory || []), ...(remoteHistory || [])].forEach((item) => {
      if (!item?.id) return;
      const existing = map.get(item.id);
      if (!existing || Number(item.createdAt || 0) > Number(existing.createdAt || 0)) {
        map.set(item.id, { ...item });
      }
    });
    return [...map.values()].sort(
      (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0),
    );
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
      if (localPerson.botPendingSync) {
        merged.useInBot = localPerson.useInBot;
        merged.botConfirmedInBot = localPerson.botConfirmedInBot;
        merged.botSlotIndex = localPerson.botSlotIndex;
        merged.botPendingSync = true;
        merged.botPendingAction = localPerson.botPendingAction;
      } else {
        merged.botPendingSync = Boolean(localPerson.botPendingSync || remotePerson.botPendingSync);
        if (remotePerson.botConfirmedInBot != null || localPerson.botConfirmedInBot != null) {
          const localTime = fieldTime(localPerson, "useInBot");
          const remoteTime = fieldTime(remotePerson, "useInBot");
          if (remoteTime > localTime && remotePerson.botConfirmedInBot != null) {
            merged.botConfirmedInBot = remotePerson.botConfirmedInBot;
          } else if (localPerson.botConfirmedInBot != null) {
            merged.botConfirmedInBot = localPerson.botConfirmedInBot;
          }
        }
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

  function historyDelta(entry) {
    const amount = Number(entry.amount || 0);
    if (entry.direction === "plus") return amount;
    if (entry.direction === "minus") return -amount;
    if (entry.type === "income") return amount;
    return -amount;
  }

  function replayBalancesFromHistory(people, history) {
    const sorted = [...(history || [])].sort(
      (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0),
    );

    return (people || []).map((person) => {
      const personHistory = sorted.filter((h) => h.personId === person.id);
      if (personHistory.length === 0) {
        return { ...person, balance: Number(person.balance || 0) };
      }

      const first = personHistory[0];
      const firstDelta = historyDelta(first);
      let balance = Number(first.balanceAfter || 0) - firstDelta;
      personHistory.forEach((entry) => {
        balance += historyDelta(entry);
      });
      return { ...person, balance: Math.round(balance * 100) / 100 };
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
    const history = mergeHistory(localState?.history, remoteState?.history);
    let people = mergePeople(localState?.people, remoteState?.people);
    people = people.map((person) => ({
      ...person,
      folderIds: Array.isArray(person.folderIds)
        ? person.folderIds.filter((id) => folderIds.has(id))
        : [],
    }));
    people = replayBalancesFromHistory(people, history);

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

    const localUi = Number(localState?.uiUpdatedAt || 0);
    const remoteUi = Number(remoteState?.uiUpdatedAt || 0);

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
      folders,
      activeFolderIds,
      activeFirstNames,
      singleFilterMode: remoteUi >= localUi
        ? Boolean(remoteState?.singleFilterMode)
        : Boolean(localState?.singleFilterMode),
      botGroupId,
      uiUpdatedAt: Math.max(localUi, remoteUi),
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
    mergePeople,
    mergeFolders,
    replayBalancesFromHistory,
    PROFILE_FIELDS,
  };
})();
