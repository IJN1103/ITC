/* ==========================================================================
 * CHAT SECTION: MESSAGE STORE AND SNAPSHOT
 * 렌더 이전 단계의 메시지 정규화, 메모리 캐시, 팝아웃 전달용 스냅샷
 * ========================================================================== */

function upsertStoredMessage(channel = 'chat', key, record, options = {}) {
  const state = getRenderState(channel);
  const safeKey = makeStoredMessageKey(channel, key);
  const previous = state.storeMap.get(safeKey) || {};
  const nextRecord = { ...previous, ...(record || {}), _key: safeKey };
  state.storeMap.set(safeKey, nextRecord);
  insertStoredKeyInOrder(channel, safeKey);

  while (state.storeOrder.length > state.maxMemory) {
    const dropKey = state.storeOrder.shift();
    if (!dropKey) break;
    state.storeMap.delete(dropKey);
    state.itemHeights.delete(dropKey);
    const dropNode = state.map.get(dropKey);
    if (dropNode && dropNode.parentNode) dropNode.remove();
    state.map.delete(dropKey);
  }
  return safeKey;
}

function storeMessageRecord(channel = 'chat', record = {}, key = '', options = {}) {
  if (channel === 'casual') {
    return upsertStoredMessage(channel, key, {
      name: record.name,
      text: record.text,
      uid: record.uid,
      timestamp: record.timestamp,
      nameColor: record.nameColor,
    }, options);
  }
  return upsertStoredMessage(channel, key, {
    name: record.name,
    text: record.text,
    type: record.type,
    uid: record.uid,
    timestamp: record.timestamp,
    speakAsAvatar: record.speakAsAvatar,
    speakAsJournalId: record.speakAsJournalId,
    whisperTo: record.whisperTo,
    whisperToName: record.whisperToName,
    whisperToJournal: record.whisperToJournal,
    nameColor: record.nameColor,
    standingImg: record.standingImg,
    tokenId: record.tokenId,
    standingLabel: record.standingLabel,
    dialoguePortrait: record.dialoguePortrait,
    showPortraitInDialogue: record.showPortraitInDialogue,
    imageWide: record.imageWide,
    hideImageMeta: record.hideImageMeta,
    imageMeta: normalizeChatImageMeta(record.imageMeta),
  }, options);
}


function coerceHistoryRecordForStore(record = {}) {
  return {
    name: record.name,
    text: record.text,
    type: record.type,
    uid: record.uid,
    timestamp: record.timestamp || record.time,
    speakAsAvatar: record.speakAsAvatar,
    speakAsJournalId: record.speakAsJournalId,
    whisperTo: record.whisperTo,
    whisperToName: record.whisperToName,
    whisperToJournal: record.whisperToJournal,
    nameColor: record.nameColor,
    standingImg: record.standingImg,
    tokenId: record.tokenId,
    standingLabel: record.standingLabel,
    dialoguePortrait: record.dialoguePortrait,
    showPortraitInDialogue: record.showPortraitInDialogue,
    imageWide: !!record.imageWide,
    hideImageMeta: !!record.hideImageMeta,
    imageMeta: normalizeChatImageMeta(record.imageMeta),
  };
}

function seedChatHistoryStore(channel = 'chat', records = [], options = {}) {
  const list = Array.isArray(records) ? records : [];
  if (!list.length) return 0;
  const position = options?.position === 'prepend' ? 'prepend' : 'append';
  const ordered = list
    .map((record) => ({ ...(record || {}), _key: String(record?._key || record?.msgKey || '').trim() }))
    .filter((record) => !!record._key)
    .sort((a, b) => {
      const at = Number(a.time || a.timestamp || 0);
      const bt = Number(b.time || b.timestamp || 0);
      if (at && bt && at !== bt) return at - bt;
      return String(a._key).localeCompare(String(b._key));
    });
  const applyList = position === 'prepend' ? ordered.slice().reverse() : ordered;
  let count = 0;
  applyList.forEach((record) => {
    storeMessageRecord(channel, coerceHistoryRecordForStore(record), record._key, { position });
    count += 1;
  });
  return count;
}

function getOldestStoredMessageKey(channel = 'chat') {
  const state = getRenderState(channel);
  return state.storeOrder[0] || '';
}

function getNewestStoredMessageKey(channel = 'chat') {
  const state = getRenderState(channel);
  return state.storeOrder[state.storeOrder.length - 1] || '';
}


function removeStoredMessage(channel = 'chat', key) {
  const state = getRenderState(channel);
  if (!key) return;
  const idx = state.storeOrder.indexOf(key);
  if (idx >= 0) state.storeOrder.splice(idx, 1);
  state.storeMap.delete(key);
}

function getStoredRecord(channel = 'chat', key) {
  const state = getRenderState(channel);
  return state.storeMap.get(key) || null;
}

function normalizeStoredRecordForSnapshot(channel = 'chat', key = '', record = {}) {
  const safeChannel = String(channel || 'chat').trim() || 'chat';
  const safeType = safeChannel === 'casual' ? 'normal' : (record.type || 'normal');
  return {
    _key: key || record._key || record.msgKey || '',
    name: record.name || '',
    text: record.text || '',
    type: safeType,
    uid: record.uid || '',
    timestamp: record.timestamp || record.time || 0,
    time: record.timestamp || record.time || 0,
    speakAsAvatar: record.speakAsAvatar || '',
    speakAsJournalId: record.speakAsJournalId || '',
    whisperTo: record.whisperTo || '',
    whisperToName: record.whisperToName || '',
    whisperToJournal: record.whisperToJournal || '',
    nameColor: record.nameColor || '',
    standingImg: record.standingImg || '',
    tokenId: record.tokenId || '',
    standingLabel: record.standingLabel || '',
    dialoguePortrait: record.dialoguePortrait || '',
    showPortraitInDialogue: record.showPortraitInDialogue === true,
    imageWide: !!record.imageWide,
    hideImageMeta: !!record.hideImageMeta,
    imageMeta: normalizeChatImageMeta(record.imageMeta),
    channel: safeChannel,
  };
}

function getChatRenderSnapshot(channel = 'chat', options = {}) {
  const state = getRenderState(channel);
  const limit = Math.max(0, Number(options?.limit || 0) || 0);
  const keys = limit > 0 ? state.storeOrder.slice(-limit) : state.storeOrder.slice();
  return keys
    .map((key) => {
      const record = state.storeMap.get(key);
      if (!record) return null;
      return normalizeStoredRecordForSnapshot(channel, key, record);
    })
    .filter(Boolean);
}


