/**
 * ITC TRPG — Game Core 모듈
 * Firebase 리스너, 게임 진입, 플레이어 관리, 캐릭터 시트
 */

let _processedChatKeys = new Set();
let _processedChatKeysByChannel = new Map();
let _chatMessageSignaturesByChannel = new Map();
let _chatRecordsByChannel = new Map();
let _activeChatChannelKey = 'global';
let _activeChatChannelUnsubs = [];
let _chatHistoryCursorByChannel = new Map();
let _casualHistoryCursor = '';
let _processedCasualKeys = new Set();
let _firebaseUnsubs = [];
let _playerDigest = '';
let _roomAvatarSyncBound = false;
let _lastSyncedRoomAvatar = null;
let _typingState = {};

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
  window._avatarCache[St.myId] = nextAvatar;
  if (St.myName) window._avatarCache[St.myName] = nextAvatar;

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
    if (typeof rerenderExistingChatAvatars === 'function') rerenderExistingChatAvatars();
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
  cleanupActiveChatChannelListeners();
  _firebaseUnsubs.forEach(unsub => { try { if (typeof unsub === 'function') unsub(); } catch (e) {} });
  _firebaseUnsubs = [];
  _typingState = {};
  refreshTypingIndicators();
  try { if (typeof window.cleanupDmUnreadListener === 'function') window.cleanupDmUnreadListener(); } catch (e) {}
  _processedChatKeys.clear();
  _processedCasualKeys.clear();
  _chatHistoryCursorByChannel.clear();
  _casualHistoryCursor = '';
  _processedChatKeysByChannel = new Map();
  _chatMessageSignaturesByChannel = new Map();
  _chatRecordsByChannel = new Map();
  _activeChatChannelKey = 'global';
  window._itcActiveChatChannelKey = 'global';
  try {
    if (typeof resetRenderedMessages === 'function') {
      resetRenderedMessages('chat');
      resetRenderedMessages('casual');
    }
  } catch (e) {}
  try { if (typeof refreshDmChannelButtons === 'function') refreshDmChannelButtons(); } catch (e) {}
}

function cleanupActiveChatChannelListeners() {
  _activeChatChannelUnsubs.forEach(unsub => { try { if (typeof unsub === 'function') unsub(); } catch (e) {} });
  _activeChatChannelUnsubs = [];
}

function trackActiveChatChannelListener(unsub) {
  if (typeof unsub === 'function') _activeChatChannelUnsubs.push(unsub);
}

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
    message?.nameColor || '',
    message?.standingImg || '',
    message?.tokenId || '',
    message?.standingLabel || '',
    !!message?.imageWide,
    !!message?.hideImageMeta,
    JSON.stringify(message?.imageMeta || null),
    message?.dmChannelKey || 'global',
  ]);
}


function resolveMessageChannelKey(message) {
  return String(message?.dmChannelKey || 'global').trim() || 'global';
}

function shouldShowChatMessageForChannel(channelKey = 'global', message = {}) {
  const safeChannelKey = String(channelKey || 'global').trim() || 'global';
  if (!message) return false;
  if (message.type === 'dm-bootstrap') return false;
  if (resolveMessageChannelKey(message) !== safeChannelKey) return false;
  if (message.type === 'whisper') return safeChannelKey === 'global' && (message.uid === St.myId || message.whisperTo === St.myId);
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
    nameColor: m.nameColor,
    standingImg: m.standingImg,
    tokenId: m.tokenId,
    standingLabel: m.standingLabel,
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
    nameColor: record.nameColor,
    msgKey: record._key,
    channel: 'chat',
    standingImg: record.standingImg,
    tokenId: record.tokenId,
    standingLabel: record.standingLabel,
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
  const visibleRecords = records.slice(-300);
  visibleRecords.forEach((record) => {
    const key = String(record?._key || '').trim();
    if (!key) return;
    appendChatMsg(makeChatRenderPayloadFromRecord({ ...record, _key: key }));
    processed.add(key);
    signatures.set(key, buildChatMessageSignature(record));
  });
}

function buildDmChannelCatalogFromChat(rawMessages = {}) {
  const map = new Map();
  Object.values(rawMessages || {}).forEach((message) => {
    const channelKey = String(message?.dmChannelKey || 'global').trim() || 'global';
    if (!channelKey || channelKey === 'global') return;
    if (map.has(channelKey)) return;
    const participantIds = Array.isArray(message?.participantIds)
      ? message.participantIds
      : (typeof parseDmChannelKey === 'function' ? parseDmChannelKey(channelKey) : []);
    map.set(channelKey, {
      channelKey,
      participantIds: Array.from(new Set((participantIds || []).map((id) => String(id || '').trim()).filter(Boolean))).sort(),
      createdBy: String(message?.createdBy || message?.uid || '').trim(),
    });
  });
  return Array.from(map.values());
}

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

async function ensureDmChannelMeta(channelKey = 'global') {
  const safeKey = String(channelKey || 'global').trim() || 'global';
  if (!window._FB?.CONFIGURED || !St.roomCode || safeKey === 'global') return;
  const participantIds = typeof parseDmChannelKey === 'function' ? parseDmChannelKey(safeKey) : [];
  if (!participantIds.length) return;
  const { db, ref, update, serverTimestamp } = window._FB;
  await update(ref(db, `rooms/${St.roomCode}/dmChats/${safeKey}/meta`), {
    participantIds,
    createdBy: St.myId || '',
    updatedAt: typeof serverTimestamp === 'function' ? serverTimestamp() : Date.now(),
  }).catch(() => {});

  const bootstrapKey = `__dm_bootstrap__${safeKey}`;
  await update(ref(db, `rooms/${St.roomCode}/chat`), {
    [bootstrapKey]: {
      type: 'dm-bootstrap',
      dmChannelKey: safeKey,
      participantIds,
      createdBy: St.myId || '',
      uid: St.myId || '',
      name: '',
      text: '',
      time: typeof serverTimestamp === 'function' ? serverTimestamp() : Date.now(),
    }
  }).catch(() => {});
}

function syncAvailableDmChannels(entries = []) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeDmChannelEntry(entry?.channelKey, { meta: entry }))
    .filter((item) => item.channelKey && item.channelKey !== 'global');
  if (typeof setAvailableDmChannels === 'function') setAvailableDmChannels(normalized);
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

  const pageLimit = 120;
  const collected = [];
  let exhausted = false;
  let guard = 0;

  while (guard < 4 && collected.length < 50 && cursorKey) {
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
    if (matched.length > 0) break;
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

  const pageLimit = 80;
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
  const safeChannelKey = String(channelKey || 'global').trim() || 'global';
  const { db, ref, onValue, query, limitToLast } = window._FB;
  cleanupActiveChatChannelListeners();
  _activeChatChannelKey = safeChannelKey;
  window._itcActiveChatChannelKey = safeChannelKey;
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

  const processed = getProcessedChatKeySet(safeChannelKey);
  const signatures = getChatMessageSignatureStore(safeChannelKey);
  const listenRef = (query && limitToLast)
    ? query(ref(db, `rooms/${St.roomCode}/chat`), limitToLast(300))
    : ref(db, `rooms/${St.roomCode}/chat`);

  const shouldShowChatMessage = (m) => shouldShowChatMessageForChannel(safeChannelKey, m);

  const makePayload = (key, m) => ({
    name: m.name, text: m.text, type: m.type || 'normal', uid: m.uid, timestamp: m.time,
    speakAsAvatar: m.speakAsAvatar, speakAsJournalId: m.speakAsJournalId,
    whisperTo: m.whisperTo, whisperToName: m.whisperToName, nameColor: m.nameColor,
    msgKey: key, channel: 'chat', standingImg: m.standingImg, tokenId: m.tokenId,
    standingLabel: m.standingLabel, imageWide: !!m.imageWide, imageMeta: m.imageMeta,
    hideImageMeta: !!m.hideImageMeta,
  });

  trackActiveChatChannelListener(onValue(listenRef, snap => {
    const msgs = snap.val() || {};
    const filtered = Object.entries(msgs)
      .map(([k, m]) => ({ ...m, _key: k }))
      .filter((m) => shouldShowChatMessage(m))
      .sort((a, b) => (a.time || 0) - (b.time || 0));

    cacheChannelMessages(safeChannelKey, filtered, { merge: true });
    const nextKeys = new Set(filtered.map((m) => m._key));
    Array.from(processed).forEach((key) => {
      if (!nextKeys.has(key)) {
        removeChatMsg(key, 'chat');
        signatures.delete(key);
      }
    });

    filtered.forEach((m) => {
      const nextSig = buildChatMessageSignature(m);
      const prevSig = signatures.get(m._key);
      const payload = makePayload(m._key, m);
      if (!processed.has(m._key)) appendChatMsg(payload);
      else if (prevSig !== nextSig) replaceChatMsg(payload);
      signatures.set(m._key, nextSig);
    });

    processed.clear();
    nextKeys.forEach((key) => processed.add(key));
    Array.from(signatures.keys()).forEach((key) => {
      if (!nextKeys.has(key)) signatures.delete(key);
    });
  }));
}

function handleDmChannelChange(ev) {
  const detail = ev?.detail || {};
  const nextChannelKey = String(detail.channelKey || (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global') || 'global').trim() || 'global';
  if (!St.roomCode || !window._FB?.CONFIGURED) return;
  const runner = nextChannelKey === 'global' ? Promise.resolve() : ensureDmChannelMeta(nextChannelKey).catch((err) => {
    console.error('ensureDmChannelMeta failed', err);
  });
  runner.finally(() => {
    switchActiveChatChannel(nextChannelKey);
  });
}

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
  _processedChatKeysByChannel = new Map();
  _chatMessageSignaturesByChannel = new Map();
  _chatRecordsByChannel = new Map();
  _activeChatChannelKey = 'global';
  window._itcActiveChatChannelKey = 'global';
}

function trackFirebaseListener(unsub) {
  if (typeof unsub === 'function') _firebaseUnsubs.push(unsub);
}

function digestPlayers(players) {
  return JSON.stringify(Object.keys(players || {}).sort().map(id => {
    const p = players[id] || {};
    return [id, p.name || '', p.role || '', !!p.online, p.avatar || '', p.casualNick || '', p.nameColor || ''];
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
    if (nextDigest === _playerDigest) return;
    _playerDigest = nextDigest;
    renderPlayers(players);
    if (typeof refreshDmChannelButtons === 'function') refreshDmChannelButtons();
  }));

  trackFirebaseListener(onValue(ref(db, `rooms/${code}/chat`), snap => {
    const rawMessages = snap.val() || {};
    syncAvailableDmChannels(buildDmChannelCatalogFromChat(rawMessages));
    rebuildChatRecordCacheFromRaw(rawMessages);
  }));
  const initialChatChannelKey = typeof getCurrentDmChannelKey === 'function'
    ? getCurrentDmChannelKey()
    : 'global';
  switchActiveChatChannel(initialChatChannelKey || 'global');

  const casualBaseRef = ref(db, `rooms/${code}/casual`);
  const casualRef = (query && limitToLast) ? query(casualBaseRef, limitToLast(100)) : casualBaseRef;

  const addCasualRecord = (key, m) => {
    if (!m || _processedCasualKeys.has(key)) return;
    appendCasualMsg(m.name, m.text, m.uid, m.time, key);
    _processedCasualKeys.add(key);
  };

  const changeCasualRecord = (key, m) => {
    if (!m) return;
    replaceCasualMsg(m.name, m.text, m.uid, m.time, key);
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
  trackFirebaseListener(onChildAdded(journalsRef, snap => {
    const id = snap.key;
    const j = snap.val() || {};
    j.id = id;
    const idx = _allJournals.findIndex(x => x.id === id);
    if (idx >= 0) _allJournals[idx] = j; else _allJournals.push(j);
    if (typeof syncJournalListItem === 'function') syncJournalListItem(id);
    else { renderJournalList(); saRefreshToolbar(); }
  }));
  trackFirebaseListener(onChildChanged(journalsRef, snap => {
    const id = snap.key;
    const j = snap.val() || {};
    j.id = id;
    const idx = _allJournals.findIndex(x => x.id === id);
    if (idx >= 0) _allJournals[idx] = j; else _allJournals.push(j);
    if (typeof syncJournalListItem === 'function') syncJournalListItem(id);
    else { renderJournalList(); saRefreshToolbar(); }
  }));
  trackFirebaseListener(onChildRemoved(journalsRef, snap => {
    _allJournals = _allJournals.filter(x => x.id !== snap.key);
    if (typeof removeJournalListItem === 'function') removeJournalListItem(snap.key);
    else { renderJournalList(); saRefreshToolbar(); }
  }));

  trackFirebaseListener(onValue(ref(db, `rooms/${code}/bgm`), snap => {
    const bgm = snap.val() || {};
    if (bgm.playlist) { St.playlist = bgm.playlist; renderPlaylist(); }
    if (bgm.currentTrack !== undefined && bgm.currentTrack !== St.currentTrack) {
      St.currentTrack = bgm.currentTrack;
      playTrack(St.currentTrack);
    }
    St.mapState = {
      background: bgm.mapBackground ? {
        url: bgm.mapBackground,
        fit: bgm.mapBackgroundFit || 'contain',
        sourceName: bgm.mapBackgroundSourceName || '',
      } : null,
      foreground: null,
      objects: Array.isArray(bgm.mapObjects) ? bgm.mapObjects : [],
    };
    St.mapLayerState = bgm.mapLayerState || null;
    if (typeof applyImportedMapState === 'function') applyImportedMapState(St.mapState);
    if (typeof refreshMapLayerManager === 'function') refreshMapLayerManager();
  }));

  trackFirebaseListener(onValue(ref(db, `rooms/${code}/lastRoll`), snap => {
    const roll = snap.val();
    if (!roll || roll.playerId === St.myId || roll.secret) return;
    showRollResult(roll);
  }));

  const presRef = ref(db, `rooms/${code}/players/${St.myId}/online`);
  window._FB.set(presRef, true);
  window._FB.onDisconnect(presRef).set(false);

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
  
  Object.entries(players).forEach(([id, p]) => {
    const online = p.online || id === St.myId;
    addPlayerChip(id, p.name, id === St.myId, p.role, online);

    const av = p.avatarUrl || p.avatar || localStorage.getItem('itc_avatar_' + id);
    if (av) {
      localStorage.setItem('itc_avatar_' + id, av);
      if (p.avatarStoragePath) {
        try { localStorage.setItem('itc_avatar_path_' + id, p.avatarStoragePath); } catch (e) {}
      }
      window._avatarCache[id] = av;
      window._avatarCache[p.name] = av;
    }
  });

  if (typeof rerenderExistingChatAvatars === 'function') {
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
    console.warn('[game] sheet-container not found; skip renderCharacterSheet');
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
  cleanupFirebaseListeners();
  if (window._FB?.CONFIGURED) {
    const { db, ref, remove, get } = window._FB;
    await remove(ref(db, `rooms/${St.roomCode}/players/${St.myId}`));
    const snap = await get(ref(db, `rooms/${St.roomCode}/players`));
    const remaining = snap.exists() ? Object.values(snap.val()).filter(p => p.online !== false) : [];
    if (remaining.length === 0) {
      await remove(ref(db, `rooms/${St.roomCode}`));
    }
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
  const { db, ref, set } = window._FB;
  set(ref(db, `rooms/${St.roomCode}/players/${St.myId}/online`), true);
});
