(function () {
  const ROOT = typeof window !== 'undefined' ? window : globalThis;
  const GLOBAL_CHANNEL_KEY = 'global';
  const state = {
    roomCode: '',
    currentChannelKey: GLOBAL_CHANNEL_KEY,
    selectedParticipantIds: [],
    gmAliasOverrides: {},
    unreadByChannel: {},
    availableChannels: [],
  };

  function getStateRoot() {
    if (ROOT.St && typeof ROOT.St === 'object') return ROOT.St;
    if (typeof St !== 'undefined' && St && typeof St === 'object') {
      ROOT.St = St;
      return ROOT.St;
    }
    ROOT.St = {};
    return ROOT.St;
  }

  function uniqSortedIds(ids) {
    return Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))).sort();
  }

  function getCurrentRoomCode() {
    return String(state.roomCode || getStateRoot().roomCode || sessionStorage.getItem('itc_session_code') || document.getElementById('topbar-code')?.textContent || '').trim();
  }

  function getCurrentUserId() {
    return String(getStateRoot().myId || ROOT._currentUser?.uid || ROOT._FB?.auth?.currentUser?.uid || '').trim();
  }

  function isGmView() {
    const stateRoot = getStateRoot();
    const myId = String(stateRoot.myId || '').trim();
    const myRole = String(stateRoot.players?.[myId]?.role || '').trim().toLowerCase();
    const sessionRole = String(sessionStorage.getItem('itc_session_role') || '').trim().toLowerCase();
    return !!stateRoot.isGM || myRole === 'gm' || sessionRole === 'gm';
  }

  function isGlobalChannelKey(channelKey) {
    return String(channelKey || '').trim() === GLOBAL_CHANNEL_KEY;
  }
  function emitChannelChange(channelKey) {
    const nextKey = String(channelKey || GLOBAL_CHANNEL_KEY).trim() || GLOBAL_CHANNEL_KEY;
    try {
      document.dispatchEvent(new CustomEvent('itc:dm-channel-change', {
        detail: { channelKey: nextKey }
      }));
    } catch (e) {}
    try {
      if (typeof ROOT.switchActiveChatChannel === 'function') ROOT.switchActiveChatChannel(nextKey);
    } catch (e) {}
  }


  function buildDmChannelKey(participantIds) {
    const ids = uniqSortedIds(participantIds);
    if (!ids.length) return GLOBAL_CHANNEL_KEY;
    return `dm_${ids.join('_')}`;
  }

  function buildGmScopedDmChannelKey(selectedPlayerIds, gmUid) {
    const safeGmUid = String(gmUid || getCurrentUserId() || '').trim();
    const ids = uniqSortedIds([safeGmUid, ...uniqSortedIds(selectedPlayerIds)]);
    if (!safeGmUid || ids.length <= 1) return GLOBAL_CHANNEL_KEY;
    return buildDmChannelKey(ids);
  }

  function parseDmChannelKey(channelKey) {
    const raw = String(channelKey || '').trim();
    if (!raw || raw === GLOBAL_CHANNEL_KEY || !raw.startsWith('dm_')) return [];
    return uniqSortedIds(raw.slice(3).split('_'));
  }

  function getCurrentChannelKey() {
    return String(state.currentChannelKey || GLOBAL_CHANNEL_KEY).trim() || GLOBAL_CHANNEL_KEY;
  }

  function setCurrentChannelKey(channelKey) {
    const next = String(channelKey || GLOBAL_CHANNEL_KEY).trim() || GLOBAL_CHANNEL_KEY;
    state.currentChannelKey = next;
    ROOT._itcActiveChatChannelKey = state.currentChannelKey;
    const myId = getCurrentUserId();
    const parsed = isGlobalChannelKey(next) ? [] : parseDmChannelKey(next);
    state.selectedParticipantIds = parsed.filter((uid) => uid !== myId);
    emitChannelChange(state.currentChannelKey);
    return state.currentChannelKey;
  }

  function selectGlobalChannel() {
    state.selectedParticipantIds = [];
    state.currentChannelKey = GLOBAL_CHANNEL_KEY;
    ROOT._itcActiveChatChannelKey = state.currentChannelKey;
    emitChannelChange(state.currentChannelKey);
    return state.currentChannelKey;
  }

  function selectDmParticipants(participantIds) {
    const ids = uniqSortedIds(participantIds);
    state.selectedParticipantIds = ids;
    state.currentChannelKey = isGmView() ? buildGmScopedDmChannelKey(ids, getCurrentUserId()) : (ids.length ? buildDmChannelKey(ids) : GLOBAL_CHANNEL_KEY);
    ROOT._itcActiveChatChannelKey = state.currentChannelKey;
    emitChannelChange(state.currentChannelKey);
    return state.currentChannelKey;
  }

  function resetDmChannelState(roomCode) {
    state.roomCode = String(roomCode || '').trim();
    state.currentChannelKey = GLOBAL_CHANNEL_KEY;
    ROOT._itcActiveChatChannelKey = state.currentChannelKey;
    state.selectedParticipantIds = [];
    state.unreadByChannel = {};
    state.availableChannels = [];
    emitChannelChange(state.currentChannelKey);
  }

  function syncDmChannelRoom(roomCode) {
    const next = String(roomCode || '').trim();
    if (next && next !== state.roomCode) resetDmChannelState(next);
    if (!next && !state.roomCode) selectGlobalChannel();
    return state.roomCode;
  }

  function normalizeDmChannels(channels) {
    return (Array.isArray(channels) ? channels : []).map((channel) => {
      const participantIds = uniqSortedIds(channel?.participantIds || parseDmChannelKey(channel?.channelKey || ''));
      const channelKey = String(channel?.channelKey || buildDmChannelKey(participantIds) || '').trim();
      return { channelKey, participantIds, createdBy: String(channel?.createdBy || '').trim() };
    }).filter((channel) => channel.channelKey && !isGlobalChannelKey(channel.channelKey));
  }

  function setAvailableDmChannels(channels) {
    const next = normalizeDmChannels(channels);
    const prevSig = JSON.stringify(state.availableChannels || []);
    const nextSig = JSON.stringify(next || []);
    state.availableChannels = next;
    if (prevSig !== nextSig) {
      try {
        document.dispatchEvent(new CustomEvent('itc:dm-channel-catalog-change', {
          detail: { channels: state.availableChannels.slice() }
        }));
      } catch (e) {}
      try {
        if (typeof ROOT.refreshDmChannelButtons === 'function') ROOT.refreshDmChannelButtons();
      } catch (e) {}
    }
    return state.availableChannels.slice();
  }

  function getAvailableDmChannels() {
    return state.availableChannels.slice();
  }

  function getPlayerVisibleDmChannels(viewerUid) {
    const safeViewerUid = String(viewerUid || getCurrentUserId() || '').trim();
    if (!safeViewerUid) return [];
    return getAvailableDmChannels().filter((channel) => channel.participantIds.includes(safeViewerUid));
  }

  function getUnread(channelKey) {
    return !!state.unreadByChannel[String(channelKey || '').trim() || GLOBAL_CHANNEL_KEY];
  }

  function setUnread(channelKey, enabled) {
    const key = String(channelKey || '').trim() || GLOBAL_CHANNEL_KEY;
    if (!key || key === getCurrentChannelKey()) { delete state.unreadByChannel[key]; return false; }
    if (enabled) state.unreadByChannel[key] = true; else delete state.unreadByChannel[key];
    return !!state.unreadByChannel[key];
  }

  function clearUnread(channelKey) {
    delete state.unreadByChannel[String(channelKey || '').trim() || GLOBAL_CHANNEL_KEY];
  }

  function getAliasStoragePath(roomCode, targetUid, gmUid) {
    const safeRoomCode = String(roomCode || getCurrentRoomCode() || '').trim();
    const safeTargetUid = String(targetUid || '').trim();
    const safeGmUid = String(gmUid || getCurrentUserId() || '').trim();
    if (!safeRoomCode || !safeTargetUid || !safeGmUid) return '';
    return `users/${safeGmUid}/dmButtonAliases/${safeRoomCode}/${safeTargetUid}`;
  }

  ROOT.getGlobalDmChannelKey = () => GLOBAL_CHANNEL_KEY;
  ROOT.isGlobalDmChannelKey = isGlobalChannelKey;
  ROOT.buildDmChannelKey = buildDmChannelKey;
  ROOT.buildGmScopedDmChannelKey = buildGmScopedDmChannelKey;
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
  ROOT.isDmGmView = isGmView;
  ROOT.setAvailableDmChannels = setAvailableDmChannels;
  ROOT.getAvailableDmChannels = getAvailableDmChannels;
  ROOT.getPlayerVisibleDmChannels = getPlayerVisibleDmChannels;
  ROOT.__DM_CHANNEL_STATE = state;
})();
