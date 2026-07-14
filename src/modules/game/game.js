/**
 * ITC TRPG — Game Core 모듈
 * Firebase 리스너, 게임 진입, 플레이어 관리, 캐릭터 시트
 */

let _processedChatKeys = new Set();
let _processedChatKeysByChannel = new Map();
let _chatMessageSignaturesByChannel = new Map();
let _chatRecordsByChannel = new Map();
let _activeChatChannelKey = 'global';
let _activeChatChannelRoomCode = '';
let _activeChatChannelUnsubs = [];
let _popoutChatChannelWatchers = new Map();
// PHASE 6 NOTE — Popout-only chat channel watchers
// 본창 active listener와 별도로 팝아웃창이 보고 있는 채널을 수신하는 watcher 묶음이다.
// 팝아웃 채널 독립성을 유지하기 위해 이 watcher는 _activeChatChannelKey를 변경하지 않아야 한다.
let _activeChatChannelListenerVersion = 0;
let _dmChannelChangeSeq = 0;
let _chatHistoryCursorByChannel = new Map();
let _casualHistoryCursor = '';
let _processedCasualKeys = new Set();
let _firebaseUnsubs = [];
let _activeFirebaseRoomCode = '';
let _playerDigest = '';
let _roomAvatarSyncBound = false;
let _lastSyncedRoomAvatar = null;
let _typingState = {};
let _presenceHeartbeatTimer = null;
let _presenceUiTimer = null;
let _presenceServerOffsetMs = 0;
let _legacyDmRecoveryRooms = new Set();
let _lastAppliedBgmMapSignature = '';
let _lastAppliedBgmPlaybackSignature = '';
let _latestLegacyRoomMapState = { hasValue: false, mapState: { background: null, foreground: null, objects: [] }, layerState: null };
let _latestDedicatedRoomMapState = { hasValue: false, mapState: null };
let _latestDedicatedRoomLayerState = { hasValue: false, layerState: null };
let _dedicatedRoomMapStateSnapshotLoaded = false;
let _dedicatedRoomLayerStateSnapshotLoaded = false;
let _legacyRoomMapBackfillSignature = '';
let _legacyRoomMapBackfillTimer = null;
const ITC_PRESENCE_HEARTBEAT_MS = 15000;
const ITC_PRESENCE_STALE_MS = 45000;

let _lastChatDebugLogAt = 0;

function isItcChatDebugEnabled() {
  try {
    return window.ITC_DEBUG_CHAT === true || localStorage.getItem('ITC_DEBUG_CHAT') === 'true';
  } catch (e) {
    return window.ITC_DEBUG_CHAT === true;
  }
}

function logItcChatDebug(label, detail = {}, options = {}) {
  if (!isItcChatDebugEnabled()) return;
  const now = Date.now();
  if (options?.throttleMs && now - _lastChatDebugLogAt < options.throttleMs) return;
  _lastChatDebugLogAt = now;
  try {
    console.debug('[ITC_CHAT_DEBUG]', label, {
      roomCode: St.roomCode || '',
      activeChannelKey: _activeChatChannelKey || 'global',
      activeChannelRoomCode: _activeChatChannelRoomCode || '',
      listenerVersion: _activeChatChannelListenerVersion,
      activeListenerCount: _activeChatChannelUnsubs.length,
      ...detail,
    });
  } catch (e) {}
}

function getPresenceNowMs() {
  return Date.now() + (_presenceServerOffsetMs || 0);
}

function getPresenceServerTimestampValue() {
  return (window._FB?.CONFIGURED && typeof window._FB.serverTimestamp === 'function')
    ? window._FB.serverTimestamp()
    : Date.now();
}

function isPlayerPresenceOnline(id, player) {
  if (!player) return false;
  if (id === St.myId) return true;
  if (player.online !== true) return false;

  const lastSeen = Number(player.lastSeen || player.presenceAt || 0);
  if (!lastSeen) return false;

  return getPresenceNowMs() - lastSeen <= ITC_PRESENCE_STALE_MS;
}

function clearPresenceTimers() {
  if (_presenceHeartbeatTimer) {
    clearInterval(_presenceHeartbeatTimer);
    _presenceHeartbeatTimer = null;
  }
  if (_presenceUiTimer) {
    clearInterval(_presenceUiTimer);
    _presenceUiTimer = null;
  }
}

function refreshPlayerPresenceUi() {
  try {
    const players = St.players || {};
    Object.entries(players).forEach(([id, p]) => {
      const chip = document.getElementById('pchip-' + id);
      if (!chip) return;
      const online = isPlayerPresenceOnline(id, p || {});
      chip.classList.toggle('online', online);
      chip.classList.toggle('offline', !online);
    });
  } catch (e) {}
}

function writeMyPresenceOnline() {
  if (!window._FB?.CONFIGURED || !St.roomCode || !St.myId) return Promise.resolve();
  const { db, ref, update } = window._FB;
  return update(ref(db, `rooms/${St.roomCode}/players/${St.myId}`), {
    online: true,
    lastSeen: getPresenceServerTimestampValue(),
  }).catch(() => {});
}

function writeMyPresenceOffline(roomCode = St.roomCode, uid = St.myId) {
  if (!window._FB?.CONFIGURED || !roomCode || !uid) return Promise.resolve();
  const { db, ref, update } = window._FB;
  return update(ref(db, `rooms/${roomCode}/players/${uid}`), {
    online: false,
    lastSeen: getPresenceServerTimestampValue(),
  }).catch(() => {});
}

function setupMyPresence(code) {
  if (!window._FB?.CONFIGURED || !code || !St.myId) return;
  clearPresenceTimers();

  const { db, ref, onValue, onDisconnect, update } = window._FB;
  const uid = St.myId;
  const playerRef = ref(db, `rooms/${code}/players/${uid}`);

  try {
    trackFirebaseListener(onValue(ref(db, '.info/serverTimeOffset'), snap => {
      _presenceServerOffsetMs = Number(snap.val() || 0);
      refreshPlayerPresenceUi();
    }));
  } catch (e) {}

  try {
    trackFirebaseListener(onValue(ref(db, '.info/connected'), snap => {
      if (snap.val() !== true) return;
      try {
        onDisconnect(playerRef).update({
          online: false,
          lastSeen: getPresenceServerTimestampValue(),
        });
      } catch (e) {
        try { onDisconnect(ref(db, `rooms/${code}/players/${uid}/online`)).set(false); } catch (err) {}
      }
      update(playerRef, {
        online: true,
        lastSeen: getPresenceServerTimestampValue(),
      }).catch(() => {});
    }));
  } catch (e) {
    writeMyPresenceOnline();
  }

  writeMyPresenceOnline();
  _presenceHeartbeatTimer = setInterval(writeMyPresenceOnline, ITC_PRESENCE_HEARTBEAT_MS);
  _presenceUiTimer = setInterval(refreshPlayerPresenceUi, 10000);
}

window.itcChatDebugReport = function(channelKey = '') {
  const safeKey = String(channelKey || _activeChatChannelKey || 'global').trim() || 'global';
  const processed = _processedChatKeysByChannel.get(safeKey);
  const signatures = _chatMessageSignaturesByChannel.get(safeKey);
  const records = Array.isArray(_chatRecordsByChannel.get(safeKey)) ? _chatRecordsByChannel.get(safeKey) : [];
  const report = {
    roomCode: St.roomCode || '',
    activeChannelKey: _activeChatChannelKey || 'global',
    activeChannelRoomCode: _activeChatChannelRoomCode || '',
    requestedChannelKey: safeKey,
    listenerVersion: _activeChatChannelListenerVersion,
    activeChatChannelListenerCount: _activeChatChannelUnsubs.length,
    processedKeyCount: processed ? processed.size : 0,
    signatureCount: signatures ? signatures.size : 0,
    cachedRecordCount: records.length,
    oldestCachedKey: records[0]?._key || '',
    newestCachedKey: records[records.length - 1]?._key || '',
  };
  try {
    if (typeof window.itcChatRenderDebugReport === 'function') {
      report.render = window.itcChatRenderDebugReport('chat');
      report.casualRender = window.itcChatRenderDebugReport('casual');
    }
  } catch (e) {}
  try { console.log('[ITC_CHAT_DEBUG_REPORT]', report); } catch (e) {}
  return report;
};

function refreshTypingIndicators() {
  renderTypingIndicator('typing-chat', _typingState, 'chat');
  renderTypingIndicator('typing-casual', _typingState, 'casual');
}

function syncMyAvatarToRoom(avatarOverride = undefined, force = false) {
  if (!window._FB?.CONFIGURED || !St.roomCode || !St.myId) return Promise.resolve();
  const nextAvatar = avatarOverride !== undefined
    ? (avatarOverride || '')
    : (() => {
        try { return localStorage.getItem('itc_avatar_' + St.myId) || ''; } catch (e) { return ''; }
      })();
  let avatarStoragePath = '';
  try { avatarStoragePath = localStorage.getItem('itc_avatar_path_' + St.myId) || ''; } catch (e) {}

  if (!window._avatarCache) window._avatarCache = {};
  const avatarRuntime = window._itcAvatarRuntime || null;
  const previousAvatar = window._avatarCache[St.myId] || (St.myName ? window._avatarCache[St.myName] : '') || '';
  if (avatarRuntime?.rememberAvatar) avatarRuntime.rememberAvatar(St.myId, St.myName, nextAvatar);
  else {
    window._avatarCache[St.myId] = nextAvatar;
    if (St.myName) window._avatarCache[St.myName] = nextAvatar;
  }
  const avatarChangedForDom = String(previousAvatar || '') !== String(nextAvatar || '');

  if (!force && _lastSyncedRoomAvatar === nextAvatar) return Promise.resolve();
  _lastSyncedRoomAvatar = nextAvatar;

  const { db, ref, set, update } = window._FB;
  return Promise.all([
    set(ref(db, `rooms/${St.roomCode}/avatars/${St.myId}`), {
      value: nextAvatar,
      url: nextAvatar,
      storagePath: avatarStoragePath,
      updatedAt: Date.now(),
    }).catch(() => {}),
    update(ref(db, `rooms/${St.roomCode}/players/${St.myId}`), {
      avatar: nextAvatar,
      avatarUrl: nextAvatar,
      avatarStoragePath,
    }).catch(() => {}),
  ]).then(() => {
    if (avatarChangedForDom && typeof rerenderExistingChatAvatars === 'function') rerenderExistingChatAvatars();
  });
}

function bindRoomStabilityEvents() {
  if (_roomAvatarSyncBound) return;
  _roomAvatarSyncBound = true;

  document.addEventListener('itc:avatar-updated', (ev) => {
    const detail = ev?.detail || {};
    const targetUid = detail.uid || window._currentUser?.uid || St.myId;
    if (!targetUid || targetUid !== St.myId) return;
    const avatar = detail.avatar || '';
    try {
      if (detail.avatarStoragePath) localStorage.setItem('itc_avatar_path_' + St.myId, detail.avatarStoragePath);
      else localStorage.removeItem('itc_avatar_path_' + St.myId);
    } catch (e) {}
    _lastSyncedRoomAvatar = null;
    syncMyAvatarToRoom(avatar, true);
  });

  document.addEventListener('itc:dm-channel-change', handleDmChannelChange);
}

function refreshTopbarProfileSafe() {
  try {
    const navName = document.getElementById('user-name-nav');
    if (navName && St.myName) navName.textContent = St.myName;
  } catch (e) {}

  try {
    if (typeof refreshProfileAvatar === 'function') refreshProfileAvatar();
  } catch (e) {
    console.warn('[game] refreshProfileAvatar failed', e);
  }
}

function cleanupFirebaseListeners() {
  const cleanupRoomCode = String(_activeFirebaseRoomCode || St.roomCode || '').trim();
  const cleanupUid = String(St.myId || '').trim();
  try {
    if (typeof clearTypingState === 'function') clearTypingState(cleanupRoomCode, cleanupUid);
  } catch (e) {}
  clearPresenceTimers();
  _dmChannelChangeSeq += 1;
  cleanupActiveChatChannelListeners();
  cleanupPopoutChatChannelWatchers();
  _firebaseUnsubs.forEach(unsub => { try { if (typeof unsub === 'function') unsub(); } catch (e) {} });
  _firebaseUnsubs = [];
  _typingState = {};
  refreshTypingIndicators();
  try { if (typeof window.cleanupDmUnreadListener === 'function') window.cleanupDmUnreadListener(); } catch (e) {}
  try { if (typeof window.cleanupPopoutMirror === 'function') window.cleanupPopoutMirror(); } catch (e) {}
  _processedChatKeys.clear();
  _processedCasualKeys.clear();
  _chatHistoryCursorByChannel.clear();
  _casualHistoryCursor = '';
  _processedChatKeysByChannel = new Map();
  _chatMessageSignaturesByChannel = new Map();
  _chatRecordsByChannel = new Map();
  _lastAppliedBgmMapSignature = '';
  _lastAppliedBgmPlaybackSignature = '';
  _latestLegacyRoomMapState = { hasValue: false, mapState: { background: null, foreground: null, objects: [] }, layerState: null };
  _latestDedicatedRoomMapState = { hasValue: false, mapState: null };
  _latestDedicatedRoomLayerState = { hasValue: false, layerState: null };
  _dedicatedRoomMapStateSnapshotLoaded = false;
  _dedicatedRoomLayerStateSnapshotLoaded = false;
  _legacyRoomMapBackfillSignature = '';
  if (_legacyRoomMapBackfillTimer) {
    clearTimeout(_legacyRoomMapBackfillTimer);
    _legacyRoomMapBackfillTimer = null;
  }
  _activeChatChannelKey = 'global';
  _activeChatChannelRoomCode = '';
  window._itcActiveChatChannelKey = 'global';
  _activeFirebaseRoomCode = '';
  try {
    if (typeof resetRenderedMessages === 'function') {
      resetRenderedMessages('chat');
      resetRenderedMessages('casual');
    }
  } catch (e) {}
  try { if (typeof refreshDmChannelButtons === 'function') refreshDmChannelButtons(); } catch (e) {}
}

function cleanupActiveChatChannelListeners() {
  const prevCount = _activeChatChannelUnsubs.length;
  _activeChatChannelListenerVersion += 1;
  _activeChatChannelUnsubs.forEach(unsub => { try { if (typeof unsub === 'function') unsub(); } catch (e) {} });
  _activeChatChannelUnsubs = [];
  logItcChatDebug('active-listener-cleanup', { previousListenerCount: prevCount });
}

function trackActiveChatChannelListener(unsub) {
  if (typeof unsub === 'function') {
    _activeChatChannelUnsubs.push(unsub);
    logItcChatDebug('active-listener-registered', { registeredListenerCount: _activeChatChannelUnsubs.length });
  }
}


function cleanupPopoutChatChannelWatchers() {
  const prevCount = _popoutChatChannelWatchers.size;
  _popoutChatChannelWatchers.forEach((watcher) => {
    try { if (typeof watcher?.unsub === 'function') watcher.unsub(); } catch (e) {}
  });
  _popoutChatChannelWatchers = new Map();
  logItcChatDebug('popout-channel-watch-cleanup', { previousWatcherCount: prevCount }, { throttleMs: 1000 });
}

function normalizePopoutWatchChannelKey(channelKey = 'global') {
  return String(channelKey || 'global').trim() || 'global';
}

function normalizePopoutWatchChannelKeyList(keys = []) {
  const source = Array.isArray(keys) ? keys : [];
  const result = [];
  const seen = new Set();
  source.forEach((key) => {
    const safeKey = normalizePopoutWatchChannelKey(key);
    if (!safeKey || seen.has(safeKey)) return;
    seen.add(safeKey);
    result.push(safeKey);
  });
  return result;
}

// PHASE 6-3 SECTION — Popout-only watcher lifecycle
// 팝아웃창이 채널을 바꾸거나 닫힌 뒤에도 이전 DM watcher가 남으면 불필요한 Firebase 구독이 누적될 수 있다.
// 본창 active listener와 별개로, 현재 열려 있는 팝아웃 채널만 보존하고 나머지는 정리한다.
function prunePopoutChatChannelWatchers(keepKeys = []) {
  const keepSet = new Set(normalizePopoutWatchChannelKeyList(keepKeys));
  let removed = 0;
  _popoutChatChannelWatchers.forEach((watcher, key) => {
    const safeKey = normalizePopoutWatchChannelKey(key);
    if (keepSet.has(safeKey)) return;
    try { if (typeof watcher?.unsub === 'function') watcher.unsub(); } catch (e) {}
    _popoutChatChannelWatchers.delete(key);
    removed += 1;
  });
  if (removed > 0) {
    logItcChatDebug('popout-channel-watch-prune', {
      keepKeys: Array.from(keepSet),
      removedWatcherCount: removed,
      remainingWatcherCount: _popoutChatChannelWatchers.size,
    }, { throttleMs: 1000 });
  }
}

function getPopoutChatWatcherDebugStatus() {
  try {
    return Array.from(_popoutChatChannelWatchers.entries()).map(([key, watcher]) => ({
      channelKey: normalizePopoutWatchChannelKey(key),
      roomCode: watcher?.roomCode || '',
      visibleCount: watcher?.visibleKeys instanceof Set ? watcher.visibleKeys.size : 0,
      hasUnsub: typeof watcher?.unsub === 'function',
    }));
  } catch (e) {
    return [];
  }
}

function notifyPopoutChatChannelCacheChanged(channelKey = 'global', count = 0) {
  const safeKey = normalizePopoutWatchChannelKey(channelKey);
  try { if (typeof window.forcePopoutSync === 'function') window.forcePopoutSync(); } catch (e) {}
  try {
    document.dispatchEvent(new CustomEvent('itc:popout-channel-cache-change', {
      detail: { channelKey: safeKey, count }
    }));
  } catch (e) {}
}

// PHASE 6 SECTION — Popout-only channel watch
// 팝아웃창이 전체/DM 중 어떤 채널을 보고 있는지와 무관하게 본창 채널은 유지한다.
// 이 함수는 해당 채널 메시지를 _chatRecordsByChannel에 캐시하고 forcePopoutSync로 팝아웃만 갱신한다.
function watchPopoutChatChannel(channelKey = 'global') {
  if (!window._FB?.CONFIGURED || !St.roomCode) return Promise.resolve([]);
  const safeKey = normalizePopoutWatchChannelKey(channelKey);
  const activeRoomCode = String(St.roomCode || '').trim();
  if (!activeRoomCode) return Promise.resolve([]);
  const existing = _popoutChatChannelWatchers.get(safeKey);
  if (existing && existing.roomCode === activeRoomCode) {
    return existing.ready || Promise.resolve(window.getChatRecordsForChannel ? window.getChatRecordsForChannel(safeKey) : []);
  }
  if (existing && typeof existing.unsub === 'function') {
    try { existing.unsub(); } catch (e) {}
  }

  const { db, ref, onValue, query, limitToLast, orderByChild, equalTo } = window._FB;
  if (!db || !ref || typeof onValue !== 'function') return Promise.resolve([]);
  const chatBaseRef = ref(db, `rooms/${activeRoomCode}/chat`);
  const listenLimit = safeKey === 'global' ? (window.ITC_CONFIG?.CHAT.GLOBAL_LISTEN_LIMIT ?? 900) : (window.ITC_CONFIG?.CHAT.DM_LISTEN_LIMIT ?? 450);
  const listenRef = (safeKey !== 'global' && query && orderByChild && equalTo && limitToLast)
    ? query(chatBaseRef, orderByChild('dmChannelKey'), equalTo(safeKey), limitToLast(listenLimit))
    : ((query && limitToLast) ? query(chatBaseRef, limitToLast(listenLimit)) : chatBaseRef);

  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const watcher = { roomCode: activeRoomCode, unsub: null, ready, visibleKeys: new Set() };
  _popoutChatChannelWatchers.set(safeKey, watcher);

  watcher.unsub = onValue(listenRef, (snap) => {
    if (String(St.roomCode || '').trim() !== activeRoomCode) return;
    const raw = snap.val() || {};
    const filtered = Object.entries(raw)
      .map(([k, m]) => ({ ...(m || {}), _key: k }))
      .filter((m) => shouldShowChatMessageForChannel(safeKey, m))
      .sort((a, b) => {
        const at = Number(a.time || a.timestamp || 0);
        const bt = Number(b.time || b.timestamp || 0);
        if (at && bt && at !== bt) return at - bt;
        return String(a._key || '').localeCompare(String(b._key || ''));
      });
    const nextKeys = new Set(filtered.map((m) => String(m?._key || '').trim()).filter(Boolean));
    watcher.visibleKeys.forEach((key) => {
      if (!nextKeys.has(key)) removeCachedChannelMessage(safeKey, key);
    });
    watcher.visibleKeys = nextKeys;
    cacheChannelMessages(safeKey, filtered, { merge: true, seed: false });
    notifyPopoutChatChannelCacheChanged(safeKey, filtered.length);
    if (resolveReady) {
      const done = resolveReady;
      resolveReady = null;
      done(window.getChatRecordsForChannel ? window.getChatRecordsForChannel(safeKey) : []);
    }
    logItcChatDebug('popout-channel-watch-snapshot', {
      channelKey: safeKey,
      rawCount: Object.keys(raw || {}).length,
      visibleCount: filtered.length,
    }, { throttleMs: 1000 });
  }, (err) => {
    console.warn('[popout] chat channel watch failed', safeKey, err);
    if (resolveReady) {
      const done = resolveReady;
      resolveReady = null;
      done(window.getChatRecordsForChannel ? window.getChatRecordsForChannel(safeKey) : []);
    }
  });

  return ready;
}

window.cleanupPopoutChatChannelWatchers = cleanupPopoutChatChannelWatchers;
window.prunePopoutChatChannelWatchers = prunePopoutChatChannelWatchers;
window.getPopoutChatWatcherDebugStatus = getPopoutChatWatcherDebugStatus;
window.watchPopoutChatChannel = watchPopoutChatChannel;
window.loadPopoutChatChannelSnapshot = watchPopoutChatChannel;

function getProcessedChatKeySet(channelKey = 'global') {
  const safeKey = String(channelKey || 'global').trim() || 'global';
  if (!_processedChatKeysByChannel.has(safeKey)) _processedChatKeysByChannel.set(safeKey, new Set());
  return _processedChatKeysByChannel.get(safeKey);
}

function getChatMessageSignatureStore(channelKey = 'global') {
  const safeKey = String(channelKey || 'global').trim() || 'global';
  if (!_chatMessageSignaturesByChannel.has(safeKey)) _chatMessageSignaturesByChannel.set(safeKey, new Map());
  return _chatMessageSignaturesByChannel.get(safeKey);
}

function buildChatMessageSignature(message = {}) {
  return JSON.stringify([
    message?.name || '',
    message?.text || '',
    message?.type || '',
    message?.uid || '',
    message?.time || 0,
    message?.speakAsAvatar || '',
    message?.speakAsJournalId || '',
    message?.whisperTo || '',
    message?.whisperToName || '',
    message?.whisperToJournal || '',
    message?.nameColor || '',
    message?.standingImg || '',
    message?.tokenId || '',
    message?.standingLabel || '',
    message?.dialoguePortrait || '',
    !!message?.showPortraitInDialogue,
    !!message?.imageWide,
    !!message?.hideImageMeta,
    JSON.stringify(message?.imageMeta || null),
    message?.dmChannelKey || 'global',
  ]);
}

function isChatKeyAtOrBeforeBoundary(key = '', boundaryKey = '') {
  const safeKey = String(key || '').trim();
  const safeBoundary = String(boundaryKey || '').trim();
  if (!safeKey || !safeBoundary) return false;
  return safeKey <= safeBoundary;
}


function resolveMessageChannelKey(message) {
  return String(message?.dmChannelKey || 'global').trim() || 'global';
}

function shouldShowChatMessageForChannel(channelKey = 'global', message = {}) {
  const safeChannelKey = String(channelKey || 'global').trim() || 'global';
  if (!message) return false;
  if (message.type === 'dm-bootstrap') return false;
  if (resolveMessageChannelKey(message) !== safeChannelKey) return false;
  if (message.type === 'whisper') return message.uid === St.myId || message.whisperTo === St.myId;
  return true;
}

function rebuildChatRecordCacheFromRaw(rawMessages = {}) {
  const grouped = new Map();
  Object.entries(rawMessages || {}).forEach(([key, message]) => {
    const safeMessage = { ...(message || {}), _key: key };
    const channelKey = resolveMessageChannelKey(safeMessage);
    if (!grouped.has(channelKey)) grouped.set(channelKey, []);
    grouped.get(channelKey).push(safeMessage);
  });
  grouped.forEach((records, channelKey) => {
    const filtered = records
      .filter((record) => shouldShowChatMessageForChannel(channelKey, record))
      .sort((a, b) => (a.time || 0) - (b.time || 0));
    cacheChannelMessages(channelKey, filtered);
  });
  Array.from(_chatRecordsByChannel.keys()).forEach((channelKey) => {
    if (!grouped.has(channelKey)) cacheChannelMessages(channelKey, []);
  });
}

function sortChatRecordsChronologically(records = []) {
  return (Array.isArray(records) ? records : []).slice().sort((a, b) => {
    const at = Number(a?.time || a?.timestamp || 0);
    const bt = Number(b?.time || b?.timestamp || 0);
    if (at && bt && at !== bt) return at - bt;
    return String(a?._key || '').localeCompare(String(b?._key || ''));
  });
}

function cacheChannelMessages(channelKey = 'global', records = [], options = {}) {
  const safeKey = String(channelKey || 'global').trim() || 'global';
  const incoming = (Array.isArray(records) ? records : []).map((record) => ({ ...record }));
  let next = incoming;
  if (options?.merge) {
    const merged = new Map();
    const previous = Array.isArray(_chatRecordsByChannel.get(safeKey)) ? _chatRecordsByChannel.get(safeKey) : [];
    previous.forEach((record) => {
      const key = String(record?._key || '').trim();
      if (key) merged.set(key, { ...record });
    });
    incoming.forEach((record) => {
      const key = String(record?._key || '').trim();
      if (key) merged.set(key, { ...record });
    });
    next = Array.from(merged.values());
  }
  const sorted = sortChatRecordsChronologically(next);
  _chatRecordsByChannel.set(safeKey, sorted);
  if (options?.seed !== false && safeKey === String(window._itcActiveChatChannelKey || 'global') && typeof window.seedChatHistoryStore === 'function') {
    try { window.seedChatHistoryStore('chat', sorted, { position: 'append' }); } catch (e) {}
  }
}

function removeCachedChannelMessage(channelKey = 'global', messageKey = '') {
  const safeKey = String(channelKey || 'global').trim() || 'global';
  const safeMessageKey = String(messageKey || '').trim();
  if (!safeMessageKey) return false;
  const records = Array.isArray(_chatRecordsByChannel.get(safeKey)) ? _chatRecordsByChannel.get(safeKey) : [];
  if (!records.length) return false;
  const next = records.filter((record) => String(record?._key || '') !== safeMessageKey);
  if (next.length === records.length) return false;
  _chatRecordsByChannel.set(safeKey, next);
  return true;
}


// PHASE 6 SECTION — Popout channel cache access
// popout.js가 독립 채널 메시지를 읽는 공개 getter. 원본 캐시 보호를 위해 복사본만 반환한다.
window.getChatRecordsForChannel = function(channelKey = 'global') {
  const safeKey = String(channelKey || 'global').trim() || 'global';
  const records = Array.isArray(_chatRecordsByChannel.get(safeKey)) ? _chatRecordsByChannel.get(safeKey) : [];
  return records.map((record) => ({ ...record }));
};

function normalizeChatRecordForRender(key, m = {}) {
  return {
    ...(m || {}),
    _key: key,
    name: m.name,
    text: m.text,
    type: m.type || 'normal',
    uid: m.uid,
    time: m.time || m.timestamp || 0,
    speakAsAvatar: m.speakAsAvatar,
    speakAsJournalId: m.speakAsJournalId,
    whisperTo: m.whisperTo,
    whisperToName: m.whisperToName,
    whisperToJournal: m.whisperToJournal,
    nameColor: m.nameColor,
    standingImg: m.standingImg,
    tokenId: m.tokenId,
    standingLabel: m.standingLabel,
    dialoguePortrait: m.dialoguePortrait || '',
    showPortraitInDialogue: m.showPortraitInDialogue === true,
    imageWide: !!m.imageWide,
    hideImageMeta: !!m.hideImageMeta,
    imageMeta: m.imageMeta || null,
    dmChannelKey: m.dmChannelKey || 'global',
  };
}

function makeChatRenderPayloadFromRecord(record = {}) {
  return {
    name: record.name,
    text: record.text,
    type: record.type || 'normal',
    uid: record.uid,
    timestamp: record.time || record.timestamp,
    speakAsAvatar: record.speakAsAvatar,
    speakAsJournalId: record.speakAsJournalId,
    whisperTo: record.whisperTo,
    whisperToName: record.whisperToName,
    whisperToJournal: record.whisperToJournal,
    nameColor: record.nameColor,
    msgKey: record._key,
    channel: 'chat',
    standingImg: record.standingImg,
    tokenId: record.tokenId,
    standingLabel: record.standingLabel,
    dialoguePortrait: record.dialoguePortrait || '',
    showPortraitInDialogue: record.showPortraitInDialogue === true,
    imageWide: !!record.imageWide,
    imageMeta: record.imageMeta,
    hideImageMeta: !!record.hideImageMeta,
  };
}

function restoreCachedChannelMessages(channelKey = 'global') {
  const safeKey = String(channelKey || 'global').trim() || 'global';
  const records = Array.isArray(_chatRecordsByChannel.get(safeKey)) ? _chatRecordsByChannel.get(safeKey) : [];
  if (typeof resetRenderedMessages === 'function') resetRenderedMessages('chat');
  if (typeof window.seedChatHistoryStore === 'function') {
    try { window.seedChatHistoryStore('chat', records, { position: 'append' }); } catch (e) {}
  }
  const processed = getProcessedChatKeySet(safeKey);
  const signatures = getChatMessageSignatureStore(safeKey);
  processed.clear();
  signatures.clear();
  const visibleRecords = records.slice(-320);
  visibleRecords.forEach((record) => {
    const key = String(record?._key || '').trim();
    if (!key) return;
    appendChatMsg(makeChatRenderPayloadFromRecord({ ...record, _key: key }));
    processed.add(key);
    signatures.set(key, buildChatMessageSignature(record));
  });
}

function getDmChannelTimestampValue(message = {}) {
  const candidates = [message.time, message.timestamp, message.createdAt, message.updatedAt];
  for (const value of candidates) {
    const numeric = Number(value || 0);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function buildDmChannelCatalogFromChat(rawMessages = {}) {
  const map = new Map();
  Object.entries(rawMessages || {}).forEach(([messageKey, message]) => {
    const channelKey = String(message?.dmChannelKey || 'global').trim() || 'global';
    if (!channelKey || channelKey === 'global') return;
    const participantIds = Array.isArray(message?.participantIds)
      ? message.participantIds
      : (typeof parseDmChannelKey === 'function' ? parseDmChannelKey(channelKey) : []);
    const normalizedParticipants = Array.from(new Set((participantIds || []).map((id) => String(id || '').trim()).filter(Boolean))).sort();
    if (normalizedParticipants.length <= 1) return;
    const previous = map.get(channelKey) || {
      channelKey,
      participantIds: normalizedParticipants,
      createdBy: '',
      latestAt: 0,
      latestMessageKey: '',
      latestSenderUid: '',
      latestType: '',
      messageKeys: [],
      visibleMessageCount: 0,
    };
    const safeMessageKey = String(messageKey || '').trim();
    if (safeMessageKey) previous.messageKeys.push(safeMessageKey);
    if (!previous.createdBy) previous.createdBy = String(message?.createdBy || message?.uid || '').trim();

    const isBootstrap = String(message?.type || '').trim() === 'dm-bootstrap';
    if (!isBootstrap) {
      previous.visibleMessageCount += 1;
      const ts = getDmChannelTimestampValue(message);
      if (ts >= Number(previous.latestAt || 0)) {
        previous.latestAt = ts || Number(previous.latestAt || 0);
        previous.latestMessageKey = safeMessageKey;
        previous.latestSenderUid = String(message?.uid || '').trim();
        previous.latestType = String(message?.type || 'normal').trim() || 'normal';
      }
    }
    map.set(channelKey, previous);
  });
  return Array.from(map.values());
}

function scheduleLegacyDmMetaRecovery(reason = '') {
  if (!window._FB?.CONFIGURED || !St.roomCode) return;
  if (!isCurrentUserRoomGm()) return;
  const roomKey = String(St.roomCode || '').trim();
  if (!roomKey || _legacyDmRecoveryRooms.has(roomKey)) return;
  _legacyDmRecoveryRooms.add(roomKey);
  window.setTimeout(() => {
    recoverLegacyDmMetaFromChatOnce(reason).catch((err) => {
      console.warn('[dm] legacy dm meta recovery failed', err);
    });
  }, 700);
}

async function recoverLegacyDmMetaFromChatOnce(reason = '') {
  if (!window._FB?.CONFIGURED || !St.roomCode) return { recovered: 0, indexed: 0 };
  if (!isCurrentUserRoomGm()) return { recovered: 0, indexed: 0 };
  const { db, ref, get, update } = window._FB;
  if (!db || !ref || !get || !update) return { recovered: 0, indexed: 0 };

  const roomCode = String(St.roomCode || '').trim();
  const [chatSnap, dmSnap] = await Promise.all([
    get(ref(db, `rooms/${roomCode}/chat`)).catch((err) => {
      console.warn('[dm] legacy recovery chat read failed', err);
      return null;
    }),
    get(ref(db, `rooms/${roomCode}/dmChats`)).catch(() => null),
  ]);
  const rawMessages = chatSnap?.val?.() || {};
  const existingDmChats = dmSnap?.val?.() || {};
  const catalog = buildDmChannelCatalogFromChat(rawMessages);
  const rootUpdates = {};
  let recovered = 0;
  let indexed = 0;

  catalog.forEach((entry) => {
    const channelKey = String(entry?.channelKey || '').trim();
    if (!channelKey || channelKey === 'global') return;
    const participantIds = Array.isArray(entry?.participantIds) ? entry.participantIds.filter(Boolean) : [];
    if (participantIds.length <= 1) return;

    (entry.messageKeys || []).forEach((messageKey) => {
      const safeMessageKey = String(messageKey || '').trim();
      if (!safeMessageKey) return;
      rootUpdates[`rooms/${roomCode}/dmMessageIndex/${channelKey}/${safeMessageKey}`] = true;
      indexed += 1;
    });

    const existingMeta = existingDmChats?.[channelKey]?.meta || null;
    const hasExistingParticipants = Array.isArray(existingMeta?.participantIds) && existingMeta.participantIds.length > 1;
    if (hasExistingParticipants) return;
    if (Number(entry.visibleMessageCount || 0) <= 0) return;

    rootUpdates[`rooms/${roomCode}/dmChats/${channelKey}/meta/participantIds`] = participantIds;
    rootUpdates[`rooms/${roomCode}/dmChats/${channelKey}/meta/createdBy`] = String(entry.createdBy || St.myId || '');
    rootUpdates[`rooms/${roomCode}/dmChats/${channelKey}/meta/latestAt`] = Number(entry.latestAt || 0) || Date.now();
    rootUpdates[`rooms/${roomCode}/dmChats/${channelKey}/meta/latestMessageKey`] = String(entry.latestMessageKey || '');
    rootUpdates[`rooms/${roomCode}/dmChats/${channelKey}/meta/latestSenderUid`] = String(entry.latestSenderUid || '');
    rootUpdates[`rooms/${roomCode}/dmChats/${channelKey}/meta/latestType`] = String(entry.latestType || 'normal');
    rootUpdates[`rooms/${roomCode}/dmChats/${channelKey}/meta/updatedAt`] = Date.now();
    recovered += 1;
  });

  if (Object.keys(rootUpdates).length) await update(ref(db), rootUpdates);
  if (recovered && typeof showToast === 'function') {
    showToast(`이전 DM방 ${recovered}개를 복구했어요.`);
  }
  try {
    logItcChatDebug('legacy-dm-recovery', { reason, recovered, indexed });
  } catch (e) {}
  return { recovered, indexed };
}

window.recoverLegacyDmMetaFromChatOnce = recoverLegacyDmMetaFromChatOnce;

function normalizeDmChannelEntry(channelKey, raw = {}) {
  const participantIds = Array.isArray(raw?.meta?.participantIds)
    ? raw.meta.participantIds
    : (typeof parseDmChannelKey === 'function' ? parseDmChannelKey(channelKey) : []);
  return {
    channelKey: String(channelKey || '').trim(),
    participantIds: Array.from(new Set((participantIds || []).map((id) => String(id || '').trim()).filter(Boolean))).sort(),
    createdBy: String(raw?.meta?.createdBy || '').trim(),
  };
}

function isCurrentUserRoomGm() {
  const myRole = String(St.players?.[St.myId]?.role || '').trim().toLowerCase();
  return !!St.isGM || myRole === 'gm';
}

function normalizeDmParticipantIdsForMeta(channelKey = 'global') {
  const parsed = typeof parseDmChannelKey === 'function' ? parseDmChannelKey(channelKey) : [];
  return Array.from(new Set((Array.isArray(parsed) ? parsed : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)))
    .sort();
}

function getDmMetaWriteTimestamp() {
  return (window._FB?.CONFIGURED && typeof window._FB.serverTimestamp === 'function')
    ? window._FB.serverTimestamp()
    : Date.now();
}

async function touchDmChannelMetaForMessage(channelKey = 'global', message = {}, messageKey = '') {
  const safeKey = String(channelKey || message?.dmChannelKey || 'global').trim() || 'global';
  if (!safeKey || safeKey === 'global') return;
  if (!window._FB?.CONFIGURED || !St.roomCode) return;
  const { db, ref, update } = window._FB;
  if (!db || !ref || typeof update !== 'function') return;
  const participantIds = normalizeDmParticipantIdsForMeta(safeKey);
  const stamp = getDmMetaWriteTimestamp();
  const safeMessageKey = String(messageKey || message?._key || '').trim();
  const rootUpdates = {
    [`rooms/${St.roomCode}/dmChats/${safeKey}/meta/latestAt`]: stamp,
    [`rooms/${St.roomCode}/dmChats/${safeKey}/meta/latestMessageKey`]: safeMessageKey,
    [`rooms/${St.roomCode}/dmChats/${safeKey}/meta/latestSenderUid`]: String(message?.uid || St.myId || ''),
    [`rooms/${St.roomCode}/dmChats/${safeKey}/meta/latestType`]: String(message?.type || 'normal'),
    [`rooms/${St.roomCode}/dmChats/${safeKey}/meta/updatedAt`]: stamp,
  };
  if (safeMessageKey) {
    rootUpdates[`rooms/${St.roomCode}/dmMessageIndex/${safeKey}/${safeMessageKey}`] = true;
  }
  if (isCurrentUserRoomGm()) {
    rootUpdates[`rooms/${St.roomCode}/dmChats/${safeKey}/meta/participantIds`] = participantIds;
    rootUpdates[`rooms/${St.roomCode}/dmChats/${safeKey}/meta/createdBy`] = String(message?.createdBy || St.myId || '');
  }
  await update(ref(db), rootUpdates).catch((err) => {
    console.warn('[dm] failed to update channel meta/index', err);
  });
}

window.touchDmChannelMetaForMessage = touchDmChannelMetaForMessage;

function clearDmChannelRuntimeCache(channelKey = 'global') {
  const safeKey = String(channelKey || 'global').trim() || 'global';
  _processedChatKeysByChannel.delete(safeKey);
  _chatMessageSignaturesByChannel.delete(safeKey);
  _chatRecordsByChannel.delete(safeKey);
  _chatHistoryCursorByChannel.delete(safeKey);
  try { if (typeof clearDmUnreadState === 'function') clearDmUnreadState(safeKey); } catch (e) {}
}

async function collectLegacyDmMessageIdsByQuery(channelKey = 'global') {
  const safeKey = String(channelKey || 'global').trim() || 'global';
  if (!safeKey || safeKey === 'global') return [];
  if (!window._FB?.CONFIGURED || !St.roomCode) return [];
  const { db, ref, get, query, orderByChild, equalTo } = window._FB;
  if (!db || !ref || !get || typeof query !== 'function' || typeof orderByChild !== 'function' || typeof equalTo !== 'function') return [];

  const snap = await get(query(
    ref(db, `rooms/${St.roomCode}/chat`),
    orderByChild('dmChannelKey'),
    equalTo(safeKey)
  )).catch((err) => {
    console.warn('[dm] failed to query legacy dm messages', err);
    return null;
  });
  const rawMessages = snap?.val?.() || {};
  return Object.entries(rawMessages || {})
    .filter(([, message]) => String(message?.dmChannelKey || 'global').trim() === safeKey)
    .map(([messageId]) => String(messageId || '').trim())
    .filter(Boolean);
}

async function deleteDmChannelWithMessages(channelKey = 'global') {
  const safeKey = String(channelKey || 'global').trim() || 'global';
  if (!safeKey || safeKey === 'global') throw new Error('Invalid DM channel key');
  if (!window._FB?.CONFIGURED || !St.roomCode) throw new Error('Firebase is not ready');
  if (!isCurrentUserRoomGm()) throw new Error('Only GM can delete DM rooms');

  const { db, ref, get, update } = window._FB;
  if (!db || !ref || !get || !update) throw new Error('Firebase helpers are missing');

  const messageIdsToDelete = new Set();
  const rootUpdates = {};

  const indexSnap = await get(ref(db, `rooms/${St.roomCode}/dmMessageIndex/${safeKey}`)).catch((err) => {
    console.warn('[dm] failed to read dm message index', err);
    return null;
  });
  const indexedMessages = indexSnap?.val?.() || {};
  Object.keys(indexedMessages || {}).forEach((messageId) => {
    const safeMessageId = String(messageId || '').trim();
    if (safeMessageId) {
      messageIdsToDelete.add(safeMessageId);
      rootUpdates[`rooms/${St.roomCode}/dmMessageIndex/${safeKey}/${safeMessageId}`] = null;
    }
  });

  const legacyMessageIds = await collectLegacyDmMessageIdsByQuery(safeKey);
  legacyMessageIds.forEach((messageId) => {
    messageIdsToDelete.add(messageId);
    rootUpdates[`rooms/${St.roomCode}/dmMessageIndex/${safeKey}/${messageId}`] = null;
  });

  messageIdsToDelete.forEach((messageId) => {
    rootUpdates[`rooms/${St.roomCode}/chat/${messageId}`] = null;
    rootUpdates[`rooms/${St.roomCode}/dmChats/${safeKey}/messages/${messageId}`] = null;
  });

  const dmMessagesSnap = await get(ref(db, `rooms/${St.roomCode}/dmChats/${safeKey}/messages`)).catch(() => null);
  const rawDmMessages = dmMessagesSnap?.val?.() || {};
  Object.keys(rawDmMessages || {}).forEach((messageId) => {
    const safeMessageId = String(messageId || '').trim();
    if (safeMessageId) rootUpdates[`rooms/${St.roomCode}/dmChats/${safeKey}/messages/${safeMessageId}`] = null;
  });

  rootUpdates[`rooms/${St.roomCode}/dmChats/${safeKey}/meta`] = null;

  if (Object.keys(rootUpdates).length) {
    await update(ref(db), rootUpdates);
  }

  clearDmChannelRuntimeCache(safeKey);
  if (String(window._itcActiveChatChannelKey || 'global') === safeKey) {
    if (typeof selectGlobalDmChannel === 'function') selectGlobalDmChannel();
    else switchActiveChatChannel('global');
  }
  try { if (typeof refreshDmChannelButtons === 'function') refreshDmChannelButtons(); } catch (e) {}
}

async function ensureDmChannelMeta(channelKey = 'global') {
  const safeKey = String(channelKey || 'global').trim() || 'global';
  if (!window._FB?.CONFIGURED || !St.roomCode || safeKey === 'global') return;
  const participantIds = typeof parseDmChannelKey === 'function' ? parseDmChannelKey(safeKey) : [];
  if (!participantIds.length) return;
  const { db, ref, get, update, serverTimestamp } = window._FB;
  if (!db || !ref || !update) return;

  const metaRef = ref(db, `rooms/${St.roomCode}/dmChats/${safeKey}/meta`);
  const existingSnap = typeof get === 'function' ? await get(metaRef).catch(() => null) : null;
  const existingMeta = existingSnap?.exists?.() ? (existingSnap.val() || {}) : null;

  if (existingMeta && typeof existingMeta === 'object') {
    const updates = {};
    const currentParticipants = Array.isArray(existingMeta.participantIds)
      ? existingMeta.participantIds.map((id) => String(id || '').trim()).filter(Boolean).sort()
      : [];
    const nextParticipants = participantIds.map((id) => String(id || '').trim()).filter(Boolean).sort();
    if (JSON.stringify(currentParticipants) !== JSON.stringify(nextParticipants)) {
      updates.participantIds = nextParticipants;
    }
    if (!String(existingMeta.createdBy || '').trim()) {
      updates.createdBy = St.myId || '';
    }
    if (Object.keys(updates).length) {
      await update(metaRef, updates).catch(() => {});
    }
    return;
  }

  const stamp = typeof serverTimestamp === 'function' ? serverTimestamp() : Date.now();
  await update(metaRef, {
    participantIds,
    createdBy: St.myId || '',
    createdAt: stamp,
    updatedAt: stamp,
  }).catch(() => {});

  const bootstrapKey = `__dm_bootstrap__${safeKey}`;
  const bootstrapMessage = {
    type: 'dm-bootstrap',
    dmChannelKey: safeKey,
    participantIds,
    createdBy: St.myId || '',
    uid: St.myId || '',
    name: '',
    text: '',
    time: stamp,
  };
  await update(ref(db), {
    [`rooms/${St.roomCode}/chat/${bootstrapKey}`]: bootstrapMessage,
    [`rooms/${St.roomCode}/dmMessageIndex/${safeKey}/${bootstrapKey}`]: true,
  }).catch(() => {});
}

function syncAvailableDmChannels(entries = []) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeDmChannelEntry(entry?.channelKey, { meta: entry }))
    .filter((item) => item.channelKey && item.channelKey !== 'global');
  if (typeof setAvailableDmChannels === 'function') setAvailableDmChannels(normalized);
  const currentKey = String(window._itcActiveChatChannelKey || (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global') || 'global').trim() || 'global';
  if (currentKey !== 'global' && !normalized.some((item) => item.channelKey === currentKey)) {
    clearDmChannelRuntimeCache(currentKey);
    if (typeof selectGlobalDmChannel === 'function') selectGlobalDmChannel();
    else switchActiveChatChannel('global');
  }
  if (typeof refreshDmChannelButtons === 'function') refreshDmChannelButtons();
}

function getOldestCachedChatKey(channelKey = 'global') {
  const safeKey = String(channelKey || 'global').trim() || 'global';
  const records = Array.isArray(_chatRecordsByChannel.get(safeKey)) ? _chatRecordsByChannel.get(safeKey) : [];
  return records[0]?._key || '';
}

async function loadOlderChatHistoryForChannel(channelKey = 'global') {
  if (!window._FB?.CONFIGURED || !St.roomCode) return { count: 0, exhausted: true };
  const { db, ref, get, query, orderByKey, endBefore, limitToLast } = window._FB;
  if (!db || !ref || !get || !query || !orderByKey || !endBefore || !limitToLast) return { count: 0, exhausted: true };

  const safeKey = String(channelKey || 'global').trim() || 'global';
  let cursorKey = _chatHistoryCursorByChannel.get(safeKey) || '';
  if (!cursorKey && safeKey === String(window._itcActiveChatChannelKey || 'global')) {
    try { cursorKey = typeof window.getOldestStoredMessageKey === 'function' ? window.getOldestStoredMessageKey('chat') : ''; } catch (e) {}
  }
  if (!cursorKey) cursorKey = getOldestCachedChatKey(safeKey);
  if (!cursorKey) return { count: 0, exhausted: true };

  const pageLimit = safeKey === 'global' ? 420 : 260;
  const targetVisibleCount = safeKey === 'global' ? 160 : 110;
  const maxScanPages = safeKey === 'global' ? 18 : 12;
  const collected = [];
  let exhausted = false;
  let guard = 0;

  while (guard < maxScanPages && collected.length < targetVisibleCount && cursorKey) {
    guard += 1;
    const snap = await get(query(ref(db, `rooms/${St.roomCode}/chat`), orderByKey(), endBefore(cursorKey), limitToLast(pageLimit)));
    const raw = snap.val() || {};
    const entries = Object.entries(raw).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    if (!entries.length) {
      exhausted = true;
      break;
    }
    cursorKey = entries[0][0];
    _chatHistoryCursorByChannel.set(safeKey, cursorKey);
    const matched = entries
      .map(([key, value]) => normalizeChatRecordForRender(key, value || {}))
      .filter((record) => shouldShowChatMessageForChannel(safeKey, record));
    collected.push(...matched);
    if (entries.length < pageLimit) {
      exhausted = true;
      break;
    }
    if (matched.length > 0 && collected.length >= targetVisibleCount) break;
  }

  if (!collected.length) return { count: 0, exhausted };
  const ordered = sortChatRecordsChronologically(collected);
  cacheChannelMessages(safeKey, ordered, { merge: true, seed: false });
  if (safeKey === String(window._itcActiveChatChannelKey || 'global') && typeof window.seedChatHistoryStore === 'function') {
    window.seedChatHistoryStore('chat', ordered, { position: 'prepend' });
  }
  return { count: ordered.length, exhausted };
}

async function loadOlderCasualHistory() {
  if (!window._FB?.CONFIGURED || !St.roomCode) return { count: 0, exhausted: true };
  const { db, ref, get, query, orderByKey, endBefore, limitToLast } = window._FB;
  if (!db || !ref || !get || !query || !orderByKey || !endBefore || !limitToLast) return { count: 0, exhausted: true };

  let cursorKey = _casualHistoryCursor || '';
  if (!cursorKey) {
    try { cursorKey = typeof window.getOldestStoredMessageKey === 'function' ? window.getOldestStoredMessageKey('casual') : ''; } catch (e) {}
  }
  if (!cursorKey) return { count: 0, exhausted: true };

  const pageLimit = 120;
  const snap = await get(query(ref(db, `rooms/${St.roomCode}/casual`), orderByKey(), endBefore(cursorKey), limitToLast(pageLimit)));
  const entries = Object.entries(snap.val() || {}).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (!entries.length) return { count: 0, exhausted: true };
  _casualHistoryCursor = entries[0][0];
  const records = entries.map(([key, value]) => ({ ...(value || {}), _key: key, timestamp: value?.time || value?.timestamp || 0 }));
  if (typeof window.seedChatHistoryStore === 'function') {
    window.seedChatHistoryStore('casual', records, { position: 'prepend' });
  }
  return { count: records.length, exhausted: entries.length < pageLimit };
}

window.deleteDmChannelWithMessages = deleteDmChannelWithMessages;
window.ensureDmChannelMeta = ensureDmChannelMeta;

window.loadOlderMessagesForPopout = async function(channel = 'chat', channelKey = 'global') {
  const safeChannel = String(channel || 'chat').trim() || 'chat';
  if (safeChannel === 'casual') {
    const result = await loadOlderCasualHistory();
    if (result.count > 0 && typeof window.prependStoredWindow === 'function') {
      try { window.prependStoredWindow('casual', result.count); } catch (e) {}
    }
    return result;
  }
  return loadOlderChatHistoryForChannel(channelKey || 'global');
};

function switchActiveChatChannel(channelKey = 'global') {
  if (!window._FB?.CONFIGURED || !St.roomCode) return;
  const activeRoomCode = String(St.roomCode || '').trim();
  if (!activeRoomCode) return;
  const safeChannelKey = String(channelKey || 'global').trim() || 'global';
  const { db, ref, onValue, onChildAdded, onChildChanged, onChildRemoved, query, limitToLast, orderByChild, equalTo } = window._FB;
  if (safeChannelKey === _activeChatChannelKey && _activeChatChannelUnsubs.length > 0 && _activeChatChannelRoomCode === activeRoomCode) {
    window._itcActiveChatChannelKey = safeChannelKey;
    logItcChatDebug('switch-active-channel-skip-same', { channelKey: safeChannelKey, roomCode: activeRoomCode }, { throttleMs: 1000 });
    try {
      document.dispatchEvent(new CustomEvent('itc:dm-active-channel-applied', {
        detail: { channelKey: safeChannelKey }
      }));
    } catch (e) {}
    try { if (typeof refreshDmChannelButtons === 'function') refreshDmChannelButtons(); } catch (e) {}
    return;
  }
  cleanupActiveChatChannelListeners();
  _activeChatChannelKey = safeChannelKey;
  _activeChatChannelRoomCode = activeRoomCode;
  window._itcActiveChatChannelKey = safeChannelKey;
  logItcChatDebug('switch-active-channel', { channelKey: safeChannelKey });
  _chatHistoryCursorByChannel.delete(safeChannelKey);
  restoreCachedChannelMessages(safeChannelKey);
  if (typeof configureHistoryPaging === 'function') {
    configureHistoryPaging('chat', { loadOlder: () => loadOlderChatHistoryForChannel(safeChannelKey), exhausted: false });
  }
  try {
    document.dispatchEvent(new CustomEvent('itc:dm-active-channel-applied', {
      detail: { channelKey: safeChannelKey }
    }));
  } catch (e) {}
  try { if (typeof refreshDmChannelButtons === 'function') refreshDmChannelButtons(); } catch (e) {}

  const listenerVersion = _activeChatChannelListenerVersion;
  let hasSeenSnapshot = false;
  let newestSeenKey = '';
  const processed = getProcessedChatKeySet(safeChannelKey);
  const signatures = getChatMessageSignatureStore(safeChannelKey);
  const chatBaseRef = ref(db, `rooms/${activeRoomCode}/chat`);
  const activeListenLimit = safeChannelKey === 'global' ? 900 : 450;
  const listenRef = (safeChannelKey !== 'global' && query && orderByChild && equalTo && limitToLast)
    ? query(chatBaseRef, orderByChild('dmChannelKey'), equalTo(safeChannelKey), limitToLast(activeListenLimit))
    : ((query && limitToLast) ? query(chatBaseRef, limitToLast(activeListenLimit)) : chatBaseRef);

  const shouldShowChatMessage = (m) => shouldShowChatMessageForChannel(safeChannelKey, m);

  const makePayload = (key, m) => ({
    name: m.name, text: m.text, type: m.type || 'normal', uid: m.uid, timestamp: m.time,
    speakAsAvatar: m.speakAsAvatar, speakAsJournalId: m.speakAsJournalId,
    whisperTo: m.whisperTo, whisperToName: m.whisperToName, whisperToJournal: m.whisperToJournal, nameColor: m.nameColor,
    speakAsAvatar: m.speakAsAvatar, speakAsJournalId: m.speakAsJournalId,
    msgKey: key, channel: 'chat', standingImg: m.standingImg, tokenId: m.tokenId,
    standingLabel: m.standingLabel,
    dialoguePortrait: m.dialoguePortrait || '', showPortraitInDialogue: m.showPortraitInDialogue === true,
    imageWide: !!m.imageWide, imageMeta: m.imageMeta,
    hideImageMeta: !!m.hideImageMeta,
  });

  // OPT-1B — 공개 일반 채팅은 최근 120개만 개별 child 이벤트로 수신한다.
  // 일반/DM 혼합 저장 경로는 유지하되 현재 'global' 값과 구버전의 누락(null) 공개 메시지를 서버 쿼리에서 선별한다.
  if (safeChannelKey === 'global' && typeof onChildAdded === 'function' && typeof onChildChanged === 'function' && typeof onChildRemoved === 'function' && query && orderByChild && equalTo && limitToLast) {
    const globalListenLimit = 120;
    const globalListenRefs = [
      query(chatBaseRef, orderByChild('dmChannelKey'), equalTo('global'), limitToLast(globalListenLimit)),
      query(chatBaseRef, orderByChild('dmChannelKey'), equalTo(null), limitToLast(globalListenLimit)),
    ];

    const isCurrentGlobalListener = () => (
      listenerVersion === _activeChatChannelListenerVersion
      && String(St.roomCode || '').trim() === activeRoomCode
      && String(window._itcActiveChatChannelKey || 'global').trim() === 'global'
    );

    const applyGlobalRecord = (snap, mode = 'added') => {
      if (!isCurrentGlobalListener()) return;
      const key = String(snap?.key || '').trim();
      if (!key) return;
      const message = { ...(snap.val() || {}), _key: key };
      if (!shouldShowChatMessage(message)) return;

      const nextSig = buildChatMessageSignature(message);
      const prevSig = signatures.get(key);
      const payload = makePayload(key, message);
      const alreadyProcessed = processed.has(key);

      cacheChannelMessages('global', [message], { merge: true, seed: false });
      if (!alreadyProcessed) {
        appendChatMsg(payload);
        processed.add(key);
      } else if (prevSig !== nextSig) {
        replaceChatMsg(payload);
      }
      signatures.set(key, nextSig);
      if (!newestSeenKey || key > newestSeenKey) newestSeenKey = key;

      logItcChatDebug(`active-global-child-${mode}`, {
        channelKey: 'global',
        messageKey: key,
        cachedCount: Array.isArray(_chatRecordsByChannel.get('global')) ? _chatRecordsByChannel.get('global').length : 0,
      }, { throttleMs: 250 });
    };

    globalListenRefs.forEach((globalListenRef) => {
      trackActiveChatChannelListener(onChildAdded(globalListenRef, (snap) => applyGlobalRecord(snap, 'added')));
      trackActiveChatChannelListener(onChildChanged(globalListenRef, (snap) => applyGlobalRecord(snap, 'changed')));
      trackActiveChatChannelListener(onChildRemoved(globalListenRef, (snap) => {
        if (!isCurrentGlobalListener()) return;
        const key = String(snap?.key || '').trim();
        if (!key) return;
        const removedMessage = { ...(snap.val() || {}), _key: key };
        if (!shouldShowChatMessage(removedMessage)) return;
        removeCachedChannelMessage('global', key);
        removeChatMsg(key, 'chat');
        processed.delete(key);
        signatures.delete(key);
        logItcChatDebug('active-global-child-removed', { channelKey: 'global', messageKey: key }, { throttleMs: 250 });
      }));
    });

    logItcChatDebug('active-global-child-listeners-ready', {
      channelKey: 'global',
      listenLimit: globalListenLimit,
      listenerCount: _activeChatChannelUnsubs.length,
    });
    return;
  }

  trackActiveChatChannelListener(onValue(listenRef, snap => {
    const currentRoomCode = String(St.roomCode || '').trim();
    if (listenerVersion !== _activeChatChannelListenerVersion || currentRoomCode !== activeRoomCode) {
      if (currentRoomCode !== activeRoomCode) {
        logItcChatDebug('stale-listener-room-ignored', {
          channelKey: safeChannelKey,
          snapshotRoomCode: activeRoomCode,
          currentRoomCode,
        }, { throttleMs: 1000 });
        return;
      }
      logItcChatDebug('stale-listener-snapshot-ignored', {
        channelKey: safeChannelKey,
        snapshotListenerVersion: listenerVersion,
        currentListenerVersion: _activeChatChannelListenerVersion,
      }, { throttleMs: 1000 });
      return;
    }
    const msgs = snap.val() || {};
    const filtered = Object.entries(msgs)
      .map(([k, m]) => ({ ...m, _key: k }))
      .filter((m) => shouldShowChatMessage(m))
      .sort((a, b) => {
        const at = Number(a.time || 0);
        const bt = Number(b.time || 0);
        if (at && bt && at !== bt) return at - bt;
        return String(a._key || '').localeCompare(String(b._key || ''));
      });

    const previousNewestKey = newestSeenKey;
    cacheChannelMessages(safeChannelKey, filtered, { merge: true });
    const nextKeys = new Set(filtered.map((m) => m._key));
    let removedFromActiveChannel = 0;
    Array.from(processed).forEach((key) => {
      if (!nextKeys.has(key)) {
        removeChatMsg(key, 'chat');
        signatures.delete(key);
        removedFromActiveChannel += 1;
      }
    });

    const debugStats = {
      rawCount: Object.keys(msgs || {}).length,
      visibleCount: filtered.length,
      appended: 0,
      replaced: 0,
      skippedDuplicate: 0,
      skippedLateOlder: 0,
      removed: removedFromActiveChannel,
      previousNewestKey,
      nextNewestKey: '',
    };

    filtered.forEach((m) => {
      const nextSig = buildChatMessageSignature(m);
      const prevSig = signatures.get(m._key);
      const payload = makePayload(m._key, m);
      const alreadyProcessed = processed.has(m._key);
      const isLateOlderSnapshotItem = hasSeenSnapshot && !alreadyProcessed && isChatKeyAtOrBeforeBoundary(m._key, previousNewestKey);
      if (!alreadyProcessed && !isLateOlderSnapshotItem) {
        appendChatMsg(payload);
        debugStats.appended += 1;
      } else if (alreadyProcessed && prevSig !== nextSig) {
        replaceChatMsg(payload);
        debugStats.replaced += 1;
      } else if (isLateOlderSnapshotItem) {
        debugStats.skippedLateOlder += 1;
        logItcChatDebug('late-older-message-skip', {
          channelKey: safeChannelKey,
          messageKey: m._key,
          previousNewestKey,
          type: m.type || 'normal',
          time: m.time || 0,
          name: m.name || '',
        }, { throttleMs: 500 });
      } else if (alreadyProcessed) {
        debugStats.skippedDuplicate += 1;
      }
      signatures.set(m._key, nextSig);
    });

    processed.clear();
    nextKeys.forEach((key) => processed.add(key));
    Array.from(signatures.keys()).forEach((key) => {
      if (!nextKeys.has(key)) signatures.delete(key);
    });
    if (filtered.length) {
      newestSeenKey = filtered.reduce((maxKey, item) => {
        const itemKey = String(item?._key || '');
        return itemKey > maxKey ? itemKey : maxKey;
      }, newestSeenKey);
    }
    debugStats.nextNewestKey = newestSeenKey;
    logItcChatDebug('active-channel-snapshot', { channelKey: safeChannelKey, ...debugStats });
    hasSeenSnapshot = true;
  }));

  if (typeof onChildRemoved === 'function') {
    trackActiveChatChannelListener(onChildRemoved(chatBaseRef, snap => {
      if (listenerVersion !== _activeChatChannelListenerVersion || String(St.roomCode || '').trim() !== activeRoomCode) return;
      const key = String(snap.key || '').trim();
      if (!key) return;
      const removedMessage = { ...(snap.val() || {}), _key: key };
      if (!shouldShowChatMessage(removedMessage)) return;
      removeCachedChannelMessage(safeChannelKey, key);
      removeChatMsg(key, 'chat');
      processed.delete(key);
      signatures.delete(key);
      logItcChatDebug('active-channel-child-removed', { channelKey: safeChannelKey, messageKey: key }, { throttleMs: 500 });
    }));
  }
}

function handleDmChannelChange(ev) {
  const detail = ev?.detail || {};
  const nextChannelKey = String(detail.channelKey || (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global') || 'global').trim() || 'global';
  const roomCodeAtRequest = String(St.roomCode || '').trim();
  if (!roomCodeAtRequest || !window._FB?.CONFIGURED) return;

  const changeSeq = ++_dmChannelChangeSeq;
  const myRole = String(St.players?.[St.myId]?.role || '').trim().toLowerCase();
  const canCreateDmChannel = !!St.isGM || myRole === 'gm';
  const runner = (nextChannelKey === 'global' || !canCreateDmChannel) ? Promise.resolve() : ensureDmChannelMeta(nextChannelKey).catch((err) => {
    console.error('ensureDmChannelMeta failed', err);
  });
  runner.finally(() => {
    if (changeSeq !== _dmChannelChangeSeq) return;
    if (roomCodeAtRequest !== String(St.roomCode || '').trim()) return;
    const wantedChannelKey = String((typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : nextChannelKey) || 'global').trim() || 'global';
    const activeKey = String(window._itcActiveChatChannelKey || 'global').trim() || 'global';
    if (wantedChannelKey !== nextChannelKey && activeKey !== nextChannelKey) return;
    switchActiveChatChannel(nextChannelKey);
  });
}


function buildBgmPlaybackState(bgm = {}) {
  const source = bgm && typeof bgm === 'object' ? bgm : {};
  const playback = {
    playlist: Array.isArray(source.playlist) ? source.playlist : [],
    currentTrack: Number.isInteger(source.currentTrack) ? source.currentTrack : -1,
    repeatMode: source.repeatMode || 'off',
    seek: source.seek && typeof source.seek === 'object' ? source.seek : null,
    playlistUpdatedAt: Number(source.playlistUpdatedAt || 0),
    playbackPosition: Number(source.playbackPosition || 0),
    playbackStartedAt: Number(source.playbackStartedAt || 0),
    playbackUpdatedAt: Number(source.playbackUpdatedAt || 0),
    playbackBy: source.playbackBy || '',
  };
  if (Object.prototype.hasOwnProperty.call(source, 'isPlaying')) playback.isPlaying = source.isPlaying === true;
  return playback;
}

function buildBgmPlaybackSignature(bgm = {}) {
  try {
    return JSON.stringify(buildBgmPlaybackState(bgm));
  } catch (e) {
    return `${Date.now()}:${Math.random()}`;
  }
}

function applyBgmPlaybackStateIfChanged(bgm = {}) {
  const signature = buildBgmPlaybackSignature(bgm);
  if (signature && signature === _lastAppliedBgmPlaybackSignature) return;
  _lastAppliedBgmPlaybackSignature = signature;

  const playback = buildBgmPlaybackState(bgm);
  if (typeof syncBgmRemoteState === 'function') {
    try {
      syncBgmRemoteState(playback);
    } catch (e) {
      console.warn('[game] syncBgmRemoteState failed', e);
    }
    return;
  }

  if (Array.isArray(playback.playlist)) {
    St.playlist = playback.playlist;
    try { if (typeof renderPlaylist === 'function') renderPlaylist(); } catch (e) {}
  }
  if (playback.currentTrack !== undefined && playback.currentTrack !== St.currentTrack) {
    try { if (typeof playTrack === 'function') playTrack(playback.currentTrack, { fromRemote: true }); } catch (e) {}
  }
}

function cloneRoomMapValue(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (e) {
    return fallback;
  }
}

function normalizeRuntimeMapState(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const background = source.background && typeof source.background === 'object' && source.background.url
    ? {
      url: source.background.url,
      fit: source.background.fit || 'contain',
      sourceName: source.background.sourceName || '',
      importedAt: source.background.importedAt || 0,
    }
    : null;
  const foreground = source.foreground && typeof source.foreground === 'object' && source.foreground.url
    ? {
      url: source.foreground.url,
      fit: source.foreground.fit || 'cover',  // FG는 BG와 동일하게 cover 기본값
      sourceName: source.foreground.sourceName || '',
      importedAt: source.foreground.importedAt || 0,
    }
    : null;
  return {
    background,
    foreground,
    objects: Array.isArray(source.objects) ? cloneRoomMapValue(source.objects, []) : [],
  };
}

function buildLegacyRoomMapStateFromBgm(bgm = {}) {
  const source = bgm && typeof bgm === 'object' ? bgm : {};
  return {
    mapState: {
      background: source.mapBackground ? {
        url: source.mapBackground,
        fit: source.mapBackgroundFit || 'contain',
        sourceName: source.mapBackgroundSourceName || '',
        importedAt: source.mapBackgroundImportedAt || 0,
      } : null,
      foreground: source.mapForeground ? {
        url: source.mapForeground,
        fit: source.mapForegroundFit || 'cover',  // FG는 BG와 동일하게 cover 기본값
        sourceName: source.mapForegroundSourceName || '',
        importedAt: source.mapForegroundImportedAt || 0,
      } : null,
      objects: Array.isArray(source.mapObjects) ? cloneRoomMapValue(source.mapObjects, []) : [],
    },
    layerState: source.mapLayerState && typeof source.mapLayerState === 'object'
      ? cloneRoomMapValue(source.mapLayerState, null)
      : null,
  };
}

function buildEffectiveRoomMapState() {
  const fallback = _latestLegacyRoomMapState?.hasValue
    ? _latestLegacyRoomMapState
    : { mapState: { background: null, foreground: null, objects: [] }, layerState: null };
  const hasDedicatedMapState = !!_latestDedicatedRoomMapState?.hasValue;
  const hasDedicatedLayerState = !!_latestDedicatedRoomLayerState?.hasValue;

  const mapState = hasDedicatedMapState
    ? normalizeRuntimeMapState(_latestDedicatedRoomMapState.mapState || {})
    : normalizeRuntimeMapState(fallback.mapState || {});

  let layerState = null;
  if (hasDedicatedMapState) {
    // mapState 전용 경로가 존재하면 새 경로를 기준으로 삼는다.
    // 단, mapLayerState listener가 아직 첫 snapshot을 받기 전에는 기존 legacy layerState로 임시 보정해
    // 새로고침 직후 배경/오브젝트가 순간적으로 모두 켜지는 깜빡임을 줄인다.
    layerState = _dedicatedRoomLayerStateSnapshotLoaded
      ? (hasDedicatedLayerState ? cloneRoomMapValue(_latestDedicatedRoomLayerState.layerState, null) : null)
      : cloneRoomMapValue(fallback.layerState, null);
  } else if (hasDedicatedLayerState) {
    layerState = cloneRoomMapValue(_latestDedicatedRoomLayerState.layerState, null);
  } else {
    layerState = cloneRoomMapValue(fallback.layerState, null);
  }
  return { mapState, layerState };
}

function applyEffectiveRoomMapStateIfChanged(reason = '') {
  if (!_latestLegacyRoomMapState?.hasValue && !_latestDedicatedRoomMapState?.hasValue && !_latestDedicatedRoomLayerState?.hasValue) return;
  const effective = buildEffectiveRoomMapState();
  let signature = '';
  try {
    signature = JSON.stringify(effective);
  } catch (e) {
    signature = `${Date.now()}:${Math.random()}`;
  }
  // 두 스냅샷(mapState + mapLayerState)이 모두 도착한 후에만 signature 캐시로 중복 방지
  // 아직 로드 중이면 항상 apply해서 빈 맵 방지
  const bothSnapshotsLoaded = _dedicatedRoomMapStateSnapshotLoaded && _dedicatedRoomLayerStateSnapshotLoaded;
  if (bothSnapshotsLoaded && signature && signature === _lastAppliedBgmMapSignature) return;
  _lastAppliedBgmMapSignature = signature;
  St.mapState = effective.mapState;
  St.mapLayerState = effective.layerState;
  if (typeof applyImportedMapState === 'function') applyImportedMapState(St.mapState);
  if (typeof refreshMapLayerManager === 'function') refreshMapLayerManager();
  try {
    if (window.ITC_DEBUG_MAP === true || localStorage.getItem('ITC_DEBUG_MAP') === 'true') {
      console.debug('[ITC_MAP_DEBUG] room-map-applied', {
        reason,
        dedicatedMapState: !!_latestDedicatedRoomMapState?.hasValue,
        dedicatedLayerState: !!_latestDedicatedRoomLayerState?.hasValue,
      });
    }
  } catch (e) {}
}

function hasUsefulRoomMapStatePayload(mapState, layerState) {
  const normalized = normalizeRuntimeMapState(mapState || {});
  if (normalized.background?.url || normalized.foreground?.url) return true;
  if (Array.isArray(normalized.objects) && normalized.objects.length > 0) return true;
  if (layerState && typeof layerState === 'object') {
    if (Array.isArray(layerState.order) && layerState.order.length > 0) return true;
    if (layerState.visible && typeof layerState.visible === 'object' && Object.keys(layerState.visible).length > 0) return true;
  }
  return false;
}

function canWriteRoomMapStateForBackfill() {
  try {
    if (St?.isGM) return true;
    const myRole = String(St?.players?.[St.myId]?.role || '').trim().toLowerCase();
    if (myRole === 'gm') return true;
    if (typeof hasPerm === 'function' && hasPerm('manageMap')) return true;
  } catch (e) {}
  return false;
}

function scheduleLegacyRoomMapBackfill(reason = 'legacy-room-map-backfill') {
  if (!window._FB?.CONFIGURED || !St?.roomCode) return;
  if (!canWriteRoomMapStateForBackfill()) return;
  if (!_dedicatedRoomMapStateSnapshotLoaded) return;
  if (_latestDedicatedRoomMapState?.hasValue) return;
  if (!_latestLegacyRoomMapState?.hasValue) return;
  const legacyMapState = normalizeRuntimeMapState(_latestLegacyRoomMapState.mapState || {});
  const legacyLayerState = cloneRoomMapValue(_latestLegacyRoomMapState.layerState, null);
  if (!hasUsefulRoomMapStatePayload(legacyMapState, legacyLayerState)) return;

  let signature = '';
  try {
    signature = JSON.stringify({ roomCode: St.roomCode, mapState: legacyMapState, layerState: legacyLayerState });
  } catch (e) {
    signature = `${St.roomCode || ''}:${Date.now()}`;
  }
  if (signature && signature === _legacyRoomMapBackfillSignature) return;
  _legacyRoomMapBackfillSignature = signature;
  if (_legacyRoomMapBackfillTimer) clearTimeout(_legacyRoomMapBackfillTimer);
  _legacyRoomMapBackfillTimer = setTimeout(async () => {
    _legacyRoomMapBackfillTimer = null;
    if (!window._FB?.CONFIGURED || !St?.roomCode) return;
    if (!canWriteRoomMapStateForBackfill()) return;
    if (_latestDedicatedRoomMapState?.hasValue) return;
    try {
      const { db, ref, update } = window._FB;
      await update(ref(db, `rooms/${St.roomCode}`), {
        mapState: legacyMapState,
        mapLayerState: legacyLayerState || null,
      });
      if (window.ITC_DEBUG_MAP === true || localStorage.getItem('ITC_DEBUG_MAP') === 'true') {
        console.debug('[ITC_MAP_DEBUG] legacy map state backfilled', { reason });
      }
    } catch (e) {
      console.warn('[game] legacy map state backfill failed', e);
    }
  }, 450);
}

function applyLegacyBgmMapStateIfChanged(bgm = {}) {
  _latestLegacyRoomMapState = {
    hasValue: true,
    ...buildLegacyRoomMapStateFromBgm(bgm),
  };
  scheduleLegacyRoomMapBackfill('legacy-bgm-map');
  applyEffectiveRoomMapStateIfChanged('legacy-bgm-map');
}

function applyDedicatedRoomMapStateSnapshot(snap) {
  _dedicatedRoomMapStateSnapshotLoaded = true;
  _latestDedicatedRoomMapState = {
    hasValue: !!snap?.exists?.(),
    mapState: snap?.exists?.() ? normalizeRuntimeMapState(snap.val() || {}) : null,
  };
  scheduleLegacyRoomMapBackfill('dedicated-mapState-empty');
  applyEffectiveRoomMapStateIfChanged('dedicated-mapState');
}

function applyDedicatedRoomLayerStateSnapshot(snap) {
  _dedicatedRoomLayerStateSnapshotLoaded = true;
  _latestDedicatedRoomLayerState = {
    hasValue: !!snap?.exists?.(),
    layerState: snap?.exists?.() ? cloneRoomMapValue(snap.val(), null) : null,
  };
  applyEffectiveRoomMapStateIfChanged('dedicated-mapLayerState');
}

function applyLocalRoomMapState(mapState, layerState, reason = 'local-room-map-state') {
  const hasMapStateArg = arguments.length >= 1 && mapState !== undefined;
  const hasLayerStateArg = arguments.length >= 2 && layerState !== undefined;

  if (hasMapStateArg) {
    _latestDedicatedRoomMapState = {
      hasValue: true,
      mapState: normalizeRuntimeMapState(mapState || {}),
    };
  }
  if (hasLayerStateArg) {
    _latestDedicatedRoomLayerState = {
      hasValue: true,
      layerState: cloneRoomMapValue(layerState, null),
    };
  }
  applyEffectiveRoomMapStateIfChanged(reason || 'local-room-map-state');
}

try {
  window._itcApplyRoomMapStateLocal = applyLocalRoomMapState;
} catch (e) { console.warn('[ITC] applyRoomMapState 등록 실패', e); }

function resetRoomScopedUiState() {
  if (window.St) {
    St.tokens = {};
    St.mapState = { background: null, foreground: null, objects: [] };
    St.mapLayerState = null;
  }
  try {
    if (typeof renderAllTokens === 'function') renderAllTokens(St.tokens || {});
  } catch (e) {
    console.warn('[game] renderAllTokens reset failed', e);
  }
  try {
    if (typeof applyImportedMapState === 'function') {
      applyImportedMapState({ background: null, foreground: null, objects: [] });
    }
  } catch (e) {
    console.warn('[game] applyImportedMapState reset failed', e);
  }
  try {
    if (typeof refreshMapLayerManager === 'function') refreshMapLayerManager();
  } catch (e) {
    console.warn('[game] refreshMapLayerManager reset failed', e);
  }
  cleanupPopoutChatChannelWatchers();
  _processedChatKeysByChannel = new Map();
  _chatMessageSignaturesByChannel = new Map();
  _chatRecordsByChannel = new Map();
  _lastAppliedBgmMapSignature = '';
  _lastAppliedBgmPlaybackSignature = '';
  _latestLegacyRoomMapState = { hasValue: false, mapState: { background: null, foreground: null, objects: [] }, layerState: null };
  _latestDedicatedRoomMapState = { hasValue: false, mapState: null };
  _latestDedicatedRoomLayerState = { hasValue: false, layerState: null };
  _dedicatedRoomMapStateSnapshotLoaded = false;
  _dedicatedRoomLayerStateSnapshotLoaded = false;
  _legacyRoomMapBackfillSignature = '';
  if (_legacyRoomMapBackfillTimer) {
    clearTimeout(_legacyRoomMapBackfillTimer);
    _legacyRoomMapBackfillTimer = null;
  }
  _activeChatChannelKey = 'global';
  _activeChatChannelRoomCode = '';
  window._itcActiveChatChannelKey = 'global';
}

function trackFirebaseListener(unsub) {
  if (typeof unsub === 'function') _firebaseUnsubs.push(unsub);
}

function digestPlayers(players) {
  return JSON.stringify(Object.keys(players || {}).sort().map(id => {
    const p = players[id] || {};
    return [
      id,
      p.name || '',
      p.role || '',
      !!p.online,
      p.avatar || '',
      p.casualNick || '',
      p.nameColor || '',
      p.currentJournalId || '',
      p.currentJournalName || '',
      !!p.permissions?.moveToken,
      !!p.permissions?.createToken,
      !!p.permissions?.editToken,
      !!p.permissions?.manageMap,
      !!p.permissions?.manageBgm,
      !!p.permissions?.sendDesc,
    ];
  }));
}

function setupFirebaseListeners() {
  if (!window._FB?.CONFIGURED) return;
  cleanupFirebaseListeners();
  resetRoomScopedUiState();
  bindRoomStabilityEvents();
  _lastSyncedRoomAvatar = null;

  const { db, ref, onValue, onChildAdded, onChildChanged, onChildRemoved, query, limitToLast } = window._FB;
  const code = St.roomCode;
  _activeFirebaseRoomCode = String(code || '').trim();

  _processedChatKeys.clear();
  _processedCasualKeys.clear();
  if (typeof resetRenderedMessages === 'function') {
    resetRenderedMessages('chat');
    resetRenderedMessages('casual');
  }
  if (typeof configureHistoryPaging === 'function') {
    configureHistoryPaging('casual', { loadOlder: loadOlderCasualHistory, exhausted: false });
  }

  trackFirebaseListener(onValue(ref(db, `rooms/${code}/players`), snap => {
    const players = snap.val() || {};

    if (!players[St.myId] && St.roomCode) {
      alert('GM에 의해 방에서 강퇴되었습니다.');
      cleanupFirebaseListeners();
      St.roomCode = '';
      document.getElementById('screen-game').style.display = 'none';
      document.getElementById('screen-lobby').style.display = 'flex';
      return;
    }
    const nextDigest = digestPlayers(players);
    if (nextDigest === _playerDigest) {
      St.players = players;
      refreshMyPerms();
      refreshPlayerPresenceUi();
      scheduleLegacyDmMetaRecovery('players-listener-same');
      return;
    }
    _playerDigest = nextDigest;
    renderPlayers(players);
    scheduleLegacyDmMetaRecovery('players-listener');
    if (typeof refreshDmChannelButtons === 'function') refreshDmChannelButtons();
  }));

  trackFirebaseListener(onValue(ref(db, `rooms/${code}/dmChats`), snap => {
    const rawChannels = snap.val() || {};
    const channels = Object.entries(rawChannels || {})
      .map(([channelKey, raw]) => normalizeDmChannelEntry(channelKey, raw || {}))
      .filter((entry) => entry.channelKey && entry.channelKey !== 'global' && Array.isArray(entry.participantIds) && entry.participantIds.length > 1);
    syncAvailableDmChannels(channels);
    scheduleLegacyDmMetaRecovery('dmChats-listener');
  }));
  const initialChatChannelKey = typeof getCurrentDmChannelKey === 'function'
    ? getCurrentDmChannelKey()
    : 'global';
  switchActiveChatChannel(initialChatChannelKey || 'global');

  const casualBaseRef = ref(db, `rooms/${code}/casual`);
  const casualRef = (query && limitToLast) ? query(casualBaseRef, limitToLast(window.ITC_CONFIG?.CHAT.CASUAL_LISTEN_LIMIT ?? 160)) : casualBaseRef;

  const addCasualRecord = (key, m) => {
    if (!m || _processedCasualKeys.has(key)) return;
    appendCasualMsg(m.name, m.text, m.uid, m.time, key, m.nameColor || '');
    _processedCasualKeys.add(key);
  };

  const changeCasualRecord = (key, m) => {
    if (!m) return;
    replaceCasualMsg(m.name, m.text, m.uid, m.time, key, m.nameColor || '');
    _processedCasualKeys.add(key);
  };

  const removeCasualRecord = (key) => {
    removeCasualMsg(key);
    _processedCasualKeys.delete(key);
  };

  if (onChildAdded && onChildChanged && onChildRemoved) {
    trackFirebaseListener(onChildAdded(casualRef, snap => addCasualRecord(snap.key, snap.val() || {})));
    trackFirebaseListener(onChildChanged(casualRef, snap => changeCasualRecord(snap.key, snap.val() || {})));
    trackFirebaseListener(onChildRemoved(casualRef, snap => removeCasualRecord(snap.key)));
  } else {
    trackFirebaseListener(onValue(casualRef, snap => {
      const msgs = snap.val() || {};
      if (typeof resetRenderedMessages === 'function') resetRenderedMessages('casual');
      _processedCasualKeys.clear();
      Object.entries(msgs).map(([k, m]) => ({ ...m, _key: k })).sort((a, b) => (a.time || 0) - (b.time || 0)).forEach(m => addCasualRecord(m._key, m));
    }));
  }

  /* ── 토큰: 개별 변경 감지 ── */
  St.tokens = {};
  const tokensRef = ref(db, `rooms/${code}/tokens`);
  trackFirebaseListener(onChildAdded(tokensRef, snap => {
    const id = snap.key;
    const raw = snap.val() || {};
    const data = typeof normalizeIncomingMapToken === 'function' ? normalizeIncomingMapToken(raw, id) : { ...raw, id };
    St.tokens[id] = data;
    if (typeof addOrUpdateSingleToken === 'function') addOrUpdateSingleToken(id, data);
  }));
  trackFirebaseListener(onChildChanged(tokensRef, snap => {
    const id = snap.key;
    const raw = snap.val() || {};
    const data = typeof normalizeIncomingMapToken === 'function' ? normalizeIncomingMapToken(raw, id) : { ...raw, id };
    St.tokens[id] = data;
    if (typeof addOrUpdateSingleToken === 'function') addOrUpdateSingleToken(id, data);
  }));
  trackFirebaseListener(onChildRemoved(tokensRef, snap => {
    const id = snap.key;
    delete St.tokens[id];
    if (typeof removeSingleToken === 'function') removeSingleToken(id);
  }));

  /* ── 저널: 개별 변경 감지 ── */
  _allJournals = [];
  const journalsRef = ref(db, `rooms/${code}/journals`);
  const upsertJournalFromSnapshot = (snap) => {
    const id = snap.key;
    const raw = snap.val() || {};
    const normalized = typeof normalizeIncomingJournal === 'function'
      ? normalizeIncomingJournal(raw, id)
      : (typeof normalizeJournal === 'function' ? normalizeJournal(raw, id) : { ...raw, id });
    if (!normalized) return;
    const idx = _allJournals.findIndex(x => x.id === id);
    if (idx >= 0) _allJournals[idx] = normalized;
    else _allJournals.push(normalized);
    if (typeof syncJournalListItem === 'function') syncJournalListItem(id);
    else { renderJournalList(); saRefreshToolbar(); }
    if (String(St.speakAsJournalId || '') === String(id) && typeof saRefreshBtn === 'function') saRefreshBtn();
    if (String(St.speakAsJournalId || '') === String(id) && typeof refreshQuickStandingMenuIfOpen === 'function') refreshQuickStandingMenuIfOpen();
  };
  trackFirebaseListener(onChildAdded(journalsRef, upsertJournalFromSnapshot));
  trackFirebaseListener(onChildChanged(journalsRef, upsertJournalFromSnapshot));
  trackFirebaseListener(onChildRemoved(journalsRef, snap => {
    const removedId = String(snap.key || '');
    _allJournals = _allJournals.filter(x => x.id !== snap.key);
    if (typeof removeJournalListItem === 'function') removeJournalListItem(snap.key);
    else { renderJournalList(); saRefreshToolbar(); }
    if (String(St.speakAsJournalId || '') === removedId && typeof refreshQuickStandingMenuIfOpen === 'function') refreshQuickStandingMenuIfOpen();
  }));

  trackFirebaseListener(onValue(ref(db, `rooms/${code}/bgm`), snap => {
    const bgm = snap.val() || {};
    applyBgmPlaybackStateIfChanged(bgm);
    applyLegacyBgmMapStateIfChanged(bgm);
  }));

  trackFirebaseListener(onValue(ref(db, `rooms/${code}/mapState`), snap => {
    applyDedicatedRoomMapStateSnapshot(snap);
  }));

  trackFirebaseListener(onValue(ref(db, `rooms/${code}/mapLayerState`), snap => {
    applyDedicatedRoomLayerStateSnapshot(snap);
  }));

  trackFirebaseListener(onValue(ref(db, `rooms/${code}/lastRoll`), snap => {
    const roll = snap.val();
    if (!roll || roll.playerId === St.myId || roll.secret) return;
    showRollResult(roll);
  }));

  setupMyPresence(code);

  _typingState = {};
  trackFirebaseListener(onChildAdded(ref(db, `rooms/${code}/typing`), snap => {
    _typingState[snap.key] = snap.val() || {};
    refreshTypingIndicators();
  }));
  trackFirebaseListener(onChildChanged(ref(db, `rooms/${code}/typing`), snap => {
    _typingState[snap.key] = snap.val() || {};
    refreshTypingIndicators();
  }));
  trackFirebaseListener(onChildRemoved(ref(db, `rooms/${code}/typing`), snap => {
    delete _typingState[snap.key];
    refreshTypingIndicators();
  }));
}

async function enterGame() {
  sessionStorage.setItem('itc_session_code', St.roomCode);
  sessionStorage.setItem('itc_session_sys',  St.system);
  sessionStorage.setItem('itc_session_role', St.isGM ? 'gm' : 'player');

  document.getElementById('screen-auth').style.display  = 'none';
  document.getElementById('screen-lobby').style.display = 'none';
  document.getElementById('screen-game').style.display  = 'flex';

  /* 게임 화면이 visible 된 직후 맵 크기 확정 */
  if (typeof applyMapTransform === 'function') applyMapTransform();

  document.getElementById('topbar-code').textContent = St.roomCode;
  document.getElementById('topbar-system').textContent = SYS_LABELS[St.system] || St.system;
  document.getElementById('room-code-disp').textContent = St.roomCode;
  document.getElementById('system-disp').textContent = SYS_LABELS[St.system];
  document.getElementById('myname-disp').textContent = St.myName;
  refreshTopbarProfileSafe();
  if (typeof syncDmChannelRoom === 'function') syncDmChannelRoom(St.roomCode);
  if (typeof refreshDmChannelButtons === 'function') refreshDmChannelButtons();

  _playerDigest = '';
  addPlayerChip(St.myId, St.myName, true, St.isGM ? 'gm' : 'player');
  renderDiceButtons(St.system);
  await initCharacter(St.system);
  initChatResize();

  const gmBadge = document.getElementById('gm-badge');
  if (gmBadge) gmBadge.style.display = St.isGM ? 'inline-flex' : 'none';
  refreshPermUI();
  if (typeof refreshChatActionButtons === 'function') refreshChatActionButtons();
  const toolbar = document.getElementById('chat-toolbar');
  if (toolbar) toolbar.classList.add('gm-visible');
  const descBtn = document.getElementById('desc-toggle-btn');
  if (descBtn) descBtn.style.display = hasPerm('sendDesc') ? '' : 'none';
  saRefreshToolbar();
  St.descMode = false;
  St.speakAsJournalId = null;
  St.whisperTo = null;
  St.whisperToName = null;
  St.whisperToJournal = null;
  saRefreshBtn();
  refreshWhisperBtn();
  renderCharacterSheet(St.system);
  
  if (!window._avatarCache) window._avatarCache = {};
  bindRoomStabilityEvents();
  syncMyAvatarToRoom(undefined, true);

  addLocalMessage('system', '', `${St.myName}님이 입장했습니다 — ${SYS_LABELS[St.system]}`);
  migrateLocalJournals();
  if (typeof migrateLocalHandouts === 'function') migrateLocalHandouts();
  loadCasualNick();
  loadMyNameColor();
  fetchJournalsFromFB();
  if (typeof fetchHandoutsFromFB === 'function') fetchHandoutsFromFB();
}

function addPlayerChip(id, name, isMe, role, online) {
  const row = document.getElementById('players-row');
  if (document.getElementById('pchip-' + id)) return;
  const chip = document.createElement('div');
  const statusClass = online ? 'online' : 'offline';
  chip.className = 'p-chip' + (isMe ? ' me' : '') + ' ' + statusClass;
  chip.id = 'pchip-' + id;
  const roleTag = role === 'gm' ? `<span style="font-size:9px;margin-left:2px">GM</span>` : '';
  chip.innerHTML = `<div class="p-dot"></div><span>${esc(name)}</span>${roleTag}`;
  row.appendChild(chip);
}

function renderPlayers(players) {
  document.getElementById('players-row').innerHTML = '';
  St.players = players;
  refreshMyPerms();
  refreshPermUI();
  if (!window._avatarCache) window._avatarCache = {};
  
  let avatarCacheChanged = false;
  Object.entries(players).forEach(([id, p]) => {
    const online = isPlayerPresenceOnline(id, p || {});
    addPlayerChip(id, p.name, id === St.myId, p.role, online);

    const avatarRuntime = window._itcAvatarRuntime || null;
    const rawAvatar = p.avatarUrl || p.avatar || (() => { try { return localStorage.getItem('itc_avatar_' + id); } catch (e) { return ''; } })();
    const av = avatarRuntime?.sanitizePersistentAvatarSrc ? avatarRuntime.sanitizePersistentAvatarSrc(rawAvatar) : rawAvatar;
    const prevById = String(window._avatarCache[id] || '').trim();
    const prevByName = p.name ? String(window._avatarCache[p.name] || '').trim() : '';
    if (av) {
      try { localStorage.setItem('itc_avatar_' + id, av); } catch (e) {}
      if (p.avatarStoragePath) {
        try { localStorage.setItem('itc_avatar_path_' + id, p.avatarStoragePath); } catch (e) {}
      }
      if (avatarRuntime?.rememberAvatar) avatarRuntime.rememberAvatar(id, p.name, av);
      else {
        window._avatarCache[id] = av;
        if (p.name) window._avatarCache[p.name] = av;
      }
      if (prevById !== av || (p.name && prevByName !== av)) avatarCacheChanged = true;
    } else {
      try {
        localStorage.removeItem('itc_avatar_' + id);
        localStorage.removeItem('itc_avatar_path_' + id);
      } catch (e) {}
      if (prevById || prevByName) avatarCacheChanged = true;
      delete window._avatarCache[id];
      if (p.name) delete window._avatarCache[p.name];
    }
  });

  if (avatarCacheChanged && typeof rerenderExistingChatAvatars === 'function') {
    rerenderExistingChatAvatars();
  }
}

async function initCharacter(sys) {
  const defaults = {
    coc7: { name:'', job:'', age:'', str:50,con:50,siz:50,dex:50,app:50,int:50,pow:50,edu:50, hp:10,hpMax:10,mp:10,mpMax:10,san:50,sanMax:50, skills:{ 도서관:20,심리학:10,의학:5,법률:5,역사:5,격투:25,권총:20,회피:25,은신:20,추적:10,설득:15,위협:15,오컬트:5,자연:10,수영:20,응급처치:30 }, notes:'' },
    dx3:  { name:'', enclave:'', hp:30,hpMax:30,enc:5,encMax:5, notes:'' },
    shinobigami: { name:'', ryu:'', ninjutsu:Array(9).fill(''), notes:'' },
    insane: { name:'', job:'', hp:6,hpMax:6, notes:'' },
  };

  if (St.selectedCharId && window._FB?.CONFIGURED && window._currentUser) {
    const { db, ref, get } = window._FB;
    try {
      const snap = await get(ref(db, `users/${St.myId}/characters/${St.selectedCharId}`));
      if (snap.exists()) {
        St.character = snap.val();
        return;
      }
    } catch(e) {}
  }
  St.character = JSON.parse(JSON.stringify(defaults[sys] || {}));
}

function renderCharacterSheet(sys) {
  const c = document.getElementById('sheet-container');
  if (!c) {
    console.debug('[game] sheet-container not found; skip renderCharacterSheet');
    return;
  }

  if (sys === 'coc7') {
    c.innerHTML = `
<div class="char-meta">
  <input placeholder="조사자 이름" id="ch-name" oninput="ch('name',this.value)" value="${esc(St.character.name||'')}">
  <input placeholder="직업" id="ch-job" oninput="ch('job',this.value)" value="${esc(St.character.job||'')}">
  <input placeholder="나이" id="ch-age" oninput="ch('age',this.value)" value="${esc(St.character.age||'')}">
</div>
<div class="sec">
  <div class="sec-title">능력치 <span style="font-size:9px;color:var(--muted)">클릭 → 판정</span></div>
  <div class="stat-grid">
    ${['str','con','siz','dex','app','int','pow','edu'].map(s => `
      <div class="stat-box" onclick="rollSkillCheck('${s.toUpperCase()}', +document.getElementById('ci-${s}').value)">
        <div class="sn">${s.toUpperCase()}</div>
        <div class="sv"><input id="ci-${s}" type="number" value="${St.character[s]||50}" min="1" max="99" oninput="ch('${s}',+this.value)"></div>
      </div>`).join('')}
  </div>
</div>
<div class="sec">
  <div class="sec-title">자원</div>
  <div class="res-row">
    <div class="res-box bar-hp"><div class="res-label">HP</div><div class="res-val"><input id="hp-cur" type="number" value="${St.character.hp||10}" oninput="ch('hp',+this.value);updateBar('hp')"><span>/</span><input id="hp-max" type="number" value="${St.character.hpMax||10}" oninput="ch('hpMax',+this.value);updateBar('hp')"></div><div class="bar"><div class="bar-fill" id="bar-hp"></div></div></div>
    <div class="res-box bar-mp"><div class="res-label">MP</div><div class="res-val"><input id="mp-cur" type="number" value="${St.character.mp||10}" oninput="ch('mp',+this.value);updateBar('mp')"><span>/</span><input id="mp-max" type="number" value="${St.character.mpMax||10}" oninput="ch('mpMax',+this.value);updateBar('mp')"></div><div class="bar"><div class="bar-fill" id="bar-mp"></div></div></div>
    <div class="res-box bar-san"><div class="res-label">SAN</div><div class="res-val"><input id="san-cur" type="number" value="${St.character.san||50}" oninput="ch('san',+this.value);updateBar('san')"><span>/</span><input id="san-max" type="number" value="${St.character.sanMax||50}" oninput="ch('sanMax',+this.value);updateBar('san')"></div><div class="bar"><div class="bar-fill" id="bar-san"></div></div></div>
  </div>
</div>
<div class="sec">
  <div class="sec-title">기술 <span style="font-size:9px;color:var(--muted)">클릭 → 판정</span></div>
  <div class="skill-list">
    ${Object.entries(St.character.skills||{}).map(([sk,val]) => `
      <div class="skill-row" onclick="rollSkillCheck('${sk}',+document.getElementById('sk-${sk}').value)">
        <span class="sk-n">${sk}</span>
        <div class="sk-v"><input id="sk-${sk}" type="number" value="${val}" min="1" max="99" oninput="chSkill('${sk}',+this.value)"></div>
        <span class="sk-pct">%</span>
      </div>`).join('')}
  </div>
</div>`;
    setTimeout(() => { updateBar('hp'); updateBar('mp'); updateBar('san'); }, 50);
  }

  else if (sys === 'dx3') {
    const syns = ['オルクス','バロール','エグザイル','サラマンダー','エンジェルハイロゥ','ノイマン','ブラックドッグ','モルフェウス','ハヌマーン','キュマイラ'];
    c.innerHTML = `
<div class="char-meta">
  <input placeholder="PC 이름" oninput="ch('name',this.value)" value="${esc(St.character.name||'')}">
  <input placeholder="인클레이브" oninput="ch('enclave',this.value)" value="${esc(St.character.enclave||'')}">
</div>
<div class="sec">
  <div class="sec-title">신드롬 (최대 3개)</div>
  <div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:6px">${syns.map(s=>`<div class="tag" onclick="this.classList.toggle('selected')">${s}</div>`).join('')}</div>
</div>
<div class="sec">
  <div class="sec-title">자원</div>
  <div class="res-row">
    <div class="res-box bar-hp"><div class="res-label">HP</div><div class="res-val"><input id="hp-cur" type="number" value="${St.character.hp||30}" oninput="ch('hp',+this.value);updateBar('hp')"><span>/</span><input id="hp-max" type="number" value="${St.character.hpMax||30}" oninput="ch('hpMax',+this.value);updateBar('hp')"></div><div class="bar"><div class="bar-fill" id="bar-hp"></div></div></div>
    <div class="res-box"><div class="res-label">인카네이션</div><div class="res-val"><input type="number" value="${St.character.enc||5}" oninput="ch('enc',+this.value)"><span>/</span><input type="number" value="${St.character.encMax||5}" oninput="ch('encMax',+this.value)"></div></div>
  </div>
</div>
<div class="sec">
  <div class="sec-title">능력치</div>
  <div class="stat-grid">
    ${['체술','감각','지각','의지','감정','사회','생명'].map(s=>`<div class="stat-box"><div class="sn">${s}</div><div class="sv"><input type="number" value="1" min="0" max="20"></div></div>`).join('')}
  </div>
</div>
<div class="sec">
  <div class="sec-title">파워 메모</div>
  <textarea class="notes-area" style="min-height:90px" placeholder="에픽스·파워를 여기에..."></textarea>
</div>`;
    setTimeout(() => updateBar('hp'), 50);
  }

  else if (sys === 'shinobigami') {
    c.innerHTML = `
<div class="char-meta">
  <input placeholder="닌자 이름" oninput="ch('name',this.value)" value="${esc(St.character.name||'')}">
  <input placeholder="유파" oninput="ch('ryu',this.value)" value="${esc(St.character.ryu||'')}">
</div>
<div class="sec">
  <div class="sec-title">비밀</div>
  <textarea class="notes-area" style="min-height:60px" placeholder="이 캐릭터의 비밀...">${esc(St.character.secret||'')}</textarea>
</div>
<div class="sec">
  <div class="sec-title">인법</div>
  <div class="ninjutsu-grid">
    ${Array.from({length:9},(_,i)=>`<div class="ninjutsu-cell"><input type="text" placeholder="인법 ${i+1}" value="${esc((St.character.ninjutsu||[])[i]||'')}" oninput="chNinjutsu(${i},this.value)"></div>`).join('')}
  </div>
</div>
<div class="sec">
  <div class="sec-title">자원</div>
  <div class="res-row">
    <div class="res-box bar-hp"><div class="res-label">생명력</div><div class="res-val"><input id="hp-cur" type="number" value="${St.character.hp||6}" oninput="ch('hp',+this.value);updateBar('hp')"><span>/</span><input id="hp-max" type="number" value="${St.character.hpMax||6}" oninput="ch('hpMax',+this.value);updateBar('hp')"></div><div class="bar"><div class="bar-fill" id="bar-hp"></div></div></div>
    <div class="res-box"><div class="res-label">공적점</div><div class="res-val"><input type="number" value="0" min="0"></div></div>
  </div>
</div>
<div class="sec">
  <div class="sec-title">감정</div>
  <div class="stat-grid">
    ${['집착','우정','애정','존경','신뢰','호의','질투','우월','의심','공포','증오','열등'].map(e=>`<div class="stat-box" style="cursor:default"><div class="sn" style="font-size:10px">${e}</div><div style="margin-top:3px"><input type="checkbox" style="accent-color:var(--accent)"></div></div>`).join('')}
  </div>
</div>`;
    setTimeout(() => updateBar('hp'), 50);
  }

  else if (sys === 'insane') {
    const areas = [
      ['폭력','격투','총기','도망','운동','제압','감각'],
      ['정보','도서관','관찰','추적','은신','교섭','미디어'],
      ['조사','증거','심리','해부','의학','과학','기억'],
      ['기술','해킹','기계','운전','폭발','제조','전기'],
      ['인류','역사','예술','신화','문화','언어','정치'],
      ['법술','접속','지배','보호','봉인','소환','조율'],
    ];
    c.innerHTML = `
<div class="char-meta">
  <input placeholder="캐릭터 이름" oninput="ch('name',this.value)" value="${esc(St.character.name||'')}">
  <input placeholder="직업" oninput="ch('job',this.value)" value="${esc(St.character.job||'')}">
</div>
<div class="sec">
  <div class="sec-title">자원</div>
  <div class="res-row">
    <div class="res-box bar-hp"><div class="res-label">생명력</div><div class="res-val"><input id="hp-cur" type="number" value="${St.character.hp||6}" oninput="ch('hp',+this.value);updateBar('hp')"><span>/</span><input id="hp-max" type="number" value="${St.character.hpMax||6}" oninput="ch('hpMax',+this.value);updateBar('hp')"></div><div class="bar"><div class="bar-fill" id="bar-hp"></div></div></div>
    <div class="res-box"><div class="res-label">정신력</div><div class="res-val"><input type="number" value="6" min="0"><span>/</span><input type="number" value="6" min="1"></div></div>
    <div class="res-box"><div class="res-label">광기도</div><div class="res-val"><input type="number" value="0" min="0"></div></div>
  </div>
</div>
<div class="sec">
  <div class="sec-title">특기</div>
  ${areas.map(row=>`<div style="display:flex;gap:2px;margin-bottom:2px;align-items:center"><span style="font-size:9px;color:var(--muted);width:36px;text-align:right;flex-shrink:0">${row[0]}</span>${row.slice(1).map(sk=>`<div class="insane-skill" onclick="this.classList.toggle('has')">${sk}</div>`).join('')}</div>`).join('')}
</div>
<div class="sec">
  <div class="sec-title">감정</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
    ${Array.from({length:4},(_,i)=>`<div class="res-box"><div class="res-label">감정 ${i+1}</div><input type="text" placeholder="+" style="background:none;border:none;border-bottom:1px solid var(--border);color:var(--text);width:100%;font:inherit;font-size:11px;padding:2px 0"></div>`).join('')}
  </div>
</div>`;
    setTimeout(() => updateBar('hp'), 50);
  }
}

function ch(key, val) { St.character[key] = val; autoSave(); }
function chSkill(sk, val) { if (!St.character.skills) St.character.skills = {}; St.character.skills[sk] = val; autoSave(); }
function chNinjutsu(i, val) { if (!St.character.ninjutsu) St.character.ninjutsu = Array(9).fill(''); St.character.ninjutsu[i] = val; autoSave(); }

function updateBar(type) {
  const map = { hp:['hp-cur','hp-max','bar-hp'], mp:['mp-cur','mp-max','bar-mp'], san:['san-cur','san-max','bar-san'] };
  const [ci, mi, bi] = map[type] || [];
  const cur = document.getElementById(ci), max = document.getElementById(mi), bar = document.getElementById(bi);
  if (!cur || !max || !bar) return;
  bar.style.width = Math.max(0, Math.min(100, (cur.value / max.value) * 100)) + '%';
}

function autoSave() {
  if (!window._FB?.CONFIGURED || !window._currentUser) return;
  const { db, ref, set } = window._FB;
  const uid = window._currentUser.uid;
  const charData = { ...St.character, updatedAt: Date.now() };

  if (St.roomCode) {
    set(ref(db, `rooms/${St.roomCode}/characters/${uid}`), charData);
  }
  if (St.selectedCharId) {
    set(ref(db, `users/${uid}/characters/${St.selectedCharId}`), charData);
  }
}

function saveCharacter() {
  autoSave();
  const btn = document.querySelector('.panel-header button');
  if (btn) { btn.textContent = '✓ 저장됨'; setTimeout(() => btn.textContent = '저장', 1500); }
}

async function leaveRoom() {
  if (!confirm('방에서 완전히 나가시겠습니까?\n(나중에 코드로 다시 입장할 수 있어요)')) return;
  if (typeof clearTypingState === 'function') clearTypingState();
  await writeMyPresenceOffline();
  cleanupFirebaseListeners();
  if (window._FB?.CONFIGURED) {
    const { db, ref, remove } = window._FB;
    await remove(ref(db, `rooms/${St.roomCode}/players/${St.myId}`));
  }
  sessionStorage.removeItem('itc_session_code');
  sessionStorage.removeItem('itc_session_sys');
  sessionStorage.removeItem('itc_session_role');

  St.roomCode = ''; St.isGM = false;
  _lastSyncedRoomAvatar = null;
  if (typeof clearPendingChatImages === 'function') clearPendingChatImages();
  resetRoomScopedUiState();
  
  closeModal('modal-settings');
  showLobby();
}

window.setupFirebaseListeners = setupFirebaseListeners;
window.syncMyAvatarToRoom = syncMyAvatarToRoom;
window.enterGame = enterGame;

/* ── 탭 복귀 시 presence 재동기화 ── */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!window._FB?.CONFIGURED || !St.roomCode || !St.myId) return;
  writeMyPresenceOnline();
});


window.addEventListener('pagehide', () => {
  writeMyPresenceOffline();
});

window.addEventListener('beforeunload', () => {
  writeMyPresenceOffline();
});
