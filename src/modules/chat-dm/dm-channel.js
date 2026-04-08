(function () {
  const ROOT = typeof window !== 'undefined' ? window : globalThis;
  const GLOBAL_CHANNEL_KEY = 'global';
  const state = {
    roomCode: '',
    currentChannelKey: GLOBAL_CHANNEL_KEY,
    selectedParticipantIds: [],
    gmAliasOverrides: {},
    unreadByChannel: {},
  };

  function getStateRoot() {
    if (ROOT.St && typeof ROOT.St === 'object') return ROOT.St;
    ROOT.St = {};
    return ROOT.St;
  }

  function uniqSortedIds(ids) {
    return Array.from(new Set((Array.isArray(ids) ? ids : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean))).sort();
  }

  function getCurrentRoomCode() {
    return String(
      state.roomCode ||
      getStateRoot().roomCode ||
      sessionStorage.getItem('itc_session_code') ||
      document.getElementById('topbar-code')?.textContent ||
      ''
    ).trim();
  }

  function getCurrentGmUid() {
    return String(getStateRoot().myId || ROOT._currentUser?.uid || ROOT._FB?.auth?.currentUser?.uid || '').trim();
  }

  function isGlobalChannelKey(channelKey) {
    return String(channelKey || '').trim() === GLOBAL_CHANNEL_KEY;
  }

  function buildDmChannelKey(participantIds) {
    const ids = uniqSortedIds(participantIds);
    if (!ids.length) return GLOBAL_CHANNEL_KEY;
    return `dm_${ids.join('_')}`;
  }

  function parseDmChannelKey(channelKey) {
    const raw = String(channelKey || '').trim();
    if (!raw || raw === GLOBAL_CHANNEL_KEY) return [];
    if (!raw.startsWith('dm_')) return [];
    return uniqSortedIds(raw.slice(3).split('_'));
  }

  function getCurrentChannelKey() {
    return String(state.currentChannelKey || GLOBAL_CHANNEL_KEY).trim() || GLOBAL_CHANNEL_KEY;
  }

  function setCurrentChannelKey(channelKey) {
    const next = String(channelKey || GLOBAL_CHANNEL_KEY).trim() || GLOBAL_CHANNEL_KEY;
    state.currentChannelKey = next;
    state.selectedParticipantIds = isGlobalChannelKey(next) ? [] : parseDmChannelKey(next);
    return state.currentChannelKey;
  }

  function selectGlobalChannel() {
    state.selectedParticipantIds = [];
    state.currentChannelKey = GLOBAL_CHANNEL_KEY;
    return state.currentChannelKey;
  }

  function selectDmParticipants(participantIds) {
    const ids = uniqSortedIds(participantIds);
    state.selectedParticipantIds = ids;
    state.currentChannelKey = ids.length ? buildDmChannelKey(ids) : GLOBAL_CHANNEL_KEY;
    return state.currentChannelKey;
  }

  function resetDmChannelState(roomCode) {
    state.roomCode = String(roomCode || '').trim();
    state.currentChannelKey = GLOBAL_CHANNEL_KEY;
    state.selectedParticipantIds = [];
    state.unreadByChannel = {};
  }

  function syncDmChannelRoom(roomCode) {
    const next = String(roomCode || '').trim();
    if (next && next !== state.roomCode) resetDmChannelState(next);
    if (!next && !state.roomCode) selectGlobalChannel();
    return state.roomCode;
  }

  function getUnread(channelKey) {
    return !!state.unreadByChannel[String(channelKey || '').trim() || GLOBAL_CHANNEL_KEY];
  }

  function setUnread(channelKey, enabled) {
    const key = String(channelKey || '').trim() || GLOBAL_CHANNEL_KEY;
    if (!key || key === getCurrentChannelKey()) {
      delete state.unreadByChannel[key];
      return false;
    }
    if (enabled) state.unreadByChannel[key] = true;
    else delete state.unreadByChannel[key];
    return !!state.unreadByChannel[key];
  }

  function clearUnread(channelKey) {
    const key = String(channelKey || '').trim() || GLOBAL_CHANNEL_KEY;
    delete state.unreadByChannel[key];
  }

  function getAliasStoragePath(roomCode, targetUid, gmUid) {
    const safeRoomCode = String(roomCode || getCurrentRoomCode() || '').trim();
    const safeTargetUid = String(targetUid || '').trim();
    const safeGmUid = String(gmUid || getCurrentGmUid() || '').trim();
    if (!safeRoomCode || !safeTargetUid || !safeGmUid) return '';
    return `users/${safeGmUid}/dmButtonAliases/${safeRoomCode}/${safeTargetUid}`;
  }

  ROOT.getGlobalDmChannelKey = () => GLOBAL_CHANNEL_KEY;
  ROOT.isGlobalDmChannelKey = isGlobalChannelKey;
  ROOT.buildDmChannelKey = buildDmChannelKey;
  ROOT.parseDmChannelKey = parseDmChannelKey;
  ROOT.getCurrentDmChannelKey = getCurrentChannelKey;
  ROOT.setCurrentDmChannelKey = setCurrentChannelKey;
  ROOT.selectGlobalDmChannel = selectGlobalChannel;
  ROOT.selectDmParticipants = selectDmParticipants;
  ROOT.resetDmChannelState = resetDmChannelState;
  ROOT.syncDmChannelRoom = syncDmChannelRoom;
  ROOT.getDmUnreadState = getUnread;
  ROOT.setDmUnreadState = setUnread;
  ROOT.clearDmUnreadState = clearUnread;
  ROOT.getDmAliasStoragePath = getAliasStoragePath;
  ROOT.__DM_CHANNEL_STATE = state;
})();
