function getChatServerTimestamp() {
  return (window._FB?.CONFIGURED && typeof window._FB.serverTimestamp === 'function')
    ? window._FB.serverTimestamp()
    : Date.now();
}

/**
 * ITC TRPG — Chat 모듈
 * 채팅, 잡담, 귓말, 타이핑, 이미지 업로드
 */

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

function toggleDescMode() {
  if (!hasPerm('sendDesc')) return;
  St.descMode = !St.descMode;
  const btn = document.getElementById('desc-toggle-btn');
  const inp = document.getElementById('chat-input');
  if (btn) btn.classList.toggle('active', St.descMode);
  if (inp) {
    inp.classList.toggle('desc-mode', St.descMode);
    inp.placeholder = St.descMode ? 'desc 입력 중… (Enter 전송)' : '메시지 입력 (Enter 전송)';
    inp.focus();
  }
}

function refreshChatActionButtons() {
  const visible = _activeRightTab !== 'journal';
  const popoutBtn = document.getElementById('chat-popout-btn');
  const clearBtn = document.getElementById('chat-clear-btn');
  if (popoutBtn) popoutBtn.style.display = visible ? '' : 'none';
  if (clearBtn) clearBtn.style.display = (visible && !!St.isGM) ? '' : 'none';
  if (typeof refreshDmChannelButtons === 'function') refreshDmChannelButtons();
}

async function clearAllChatHistory() {
  if (!St.isGM) {
    showToast('GM만 사용할 수 있어요.');
    return;
  }
  if (!St.roomCode) return;
  const ok = window.confirm('채팅과 잡담 내역을 모두 지울까요? 이 작업은 되돌릴 수 없어요.');
  if (!ok) return;

  try {
    if (window._FB?.CONFIGURED) {
      const { db, ref, remove } = window._FB;
      await Promise.all([
        remove(ref(db, `rooms/${St.roomCode}/chat`)),
        remove(ref(db, `rooms/${St.roomCode}/casual`)),
      ]);
    }

    if (typeof resetRenderedMessages === 'function') {
      resetRenderedMessages('chat');
      resetRenderedMessages('casual');
    }
    try { if (typeof _processedChatKeys !== 'undefined') _processedChatKeys.clear(); } catch (e) {}
    try { if (typeof _processedCasualKeys !== 'undefined') _processedCasualKeys.clear(); } catch (e) {}

    const chatEl = document.getElementById('chat-messages');
    const casualEl = document.getElementById('casual-messages');
    if (chatEl) chatEl.innerHTML = '';
    if (casualEl) casualEl.innerHTML = '';
    showToast('채팅과 잡담 내역을 지웠어요.');
  } catch (err) {
    console.error('clearAllChatHistory failed', err);
    showToast('채팅 내역 삭제에 실패했어요.');
  }
}

const _renderState = {
  chat: {
    containerId: 'chat-messages',
    raf: 0,
    queue: [],
    map: new Map(),
    max: 120,
    maxMemory: 1200,
    loadStep: 28,
    storeOrder: [],
    storeMap: new Map(),
    scrollBound: false,
    scrollTick: 0,
    stickyToBottom: true,
    pendingBottomNotice: 0,
    virtualEnabled: false,
    virtualRaf: 0,
    virtualDirty: false,
    virtualForceStickBottom: false,
    topSpacer: null,
    bottomSpacer: null,
    renderedStart: 0,
    renderedEnd: 0,
    avgItemHeight: 76,
    itemHeights: new Map(),
    overscan: 10,
    minWindow: 26,
    historyLoader: null,
    historyLoading: false,
    historyExhausted: true,
  },
  casual: {
    containerId: 'casual-messages',
    raf: 0,
    queue: [],
    map: new Map(),
    max: 140,
    maxMemory: 700,
    loadStep: 36,
    storeOrder: [],
    storeMap: new Map(),
    scrollBound: false,
    scrollTick: 0,
    stickyToBottom: true,
    pendingBottomNotice: 0,
    virtualEnabled: false,
    virtualRaf: 0,
    virtualDirty: false,
    virtualForceStickBottom: false,
    topSpacer: null,
    bottomSpacer: null,
    renderedStart: 0,
    renderedEnd: 0,
    avgItemHeight: 76,
    itemHeights: new Map(),
    overscan: 10,
    minWindow: 26,
    historyLoader: null,
    historyLoading: false,
    historyExhausted: true,
  },
};

function ensureChatRenderState(channel = 'chat') {
  const safeChannel = String(channel || 'chat').trim() || 'chat';
  if (_renderState[safeChannel]) return _renderState[safeChannel];
  const base = _renderState.chat;
  _renderState[safeChannel] = {
    containerId: 'chat-messages',
    raf: 0,
    queue: [],
    map: new Map(),
    max: base.max,
    maxMemory: base.maxMemory,
    loadStep: base.loadStep,
    storeOrder: [],
    storeMap: new Map(),
    scrollBound: false,
    scrollTick: 0,
    stickyToBottom: true,
    pendingBottomNotice: 0,
    virtualEnabled: base.virtualEnabled,
    virtualRaf: 0,
    virtualDirty: false,
    virtualForceStickBottom: false,
    topSpacer: null,
    bottomSpacer: null,
    renderedStart: 0,
    renderedEnd: 0,
    avgItemHeight: base.avgItemHeight,
    itemHeights: new Map(),
    overscan: base.overscan,
    minWindow: base.minWindow,
    historyLoader: null,
    historyLoading: false,
    historyExhausted: true,
  };
  return _renderState[safeChannel];
}

function getRenderState(channel = 'chat') {
  const safeChannel = String(channel || 'chat').trim() || 'chat';
  if (safeChannel === 'casual') return _renderState.casual;
  return ensureChatRenderState(safeChannel);
}

function getRenderContainer(channel = 'chat') {
  const state = getRenderState(channel);
  return document.getElementById(state.containerId);
}

function isNearBottom(el, threshold = 56) {
  if (!el) return true;
  return (el.scrollHeight - el.scrollTop - el.clientHeight) <= threshold;
}

function isNearTop(el, threshold = 56) {
  if (!el) return true;
  return el.scrollTop <= threshold;
}

function scrollToBottom(el) {
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

function makeStoredMessageKey(channel = 'chat', key = '') {
  return key || `__local_${channel}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getRenderedKeyList(channel = 'chat') {
  const el = getRenderContainer(channel);
  if (!el) return [];
  return Array.from(el.children)
    .map(node => node?.dataset?.msgKey || '')
    .filter(Boolean);
}

function syncStickyState(channel = 'chat', el = null) {
  const target = el || getRenderContainer(channel);
  const state = getRenderState(channel);
  state.stickyToBottom = isNearBottom(target);
  const notice = target ? target.querySelector('.chat-history-notice') : null;
  if (notice) {
    notice.style.display = state.pendingBottomNotice > 0 ? '' : 'none';
    if (state.pendingBottomNotice > 0) {
      notice.textContent = `새 메시지 ${state.pendingBottomNotice}개 · 아래로 이동`;
    }
  }
}


function isVirtualChannel(channel = 'chat') {
  return !!getRenderState(channel).virtualEnabled;
}

function ensureVirtualElements(channel = 'chat') {
  const state = getRenderState(channel);
  const el = getRenderContainer(channel);
  if (!el || !state.virtualEnabled) return null;

  ensureHistoryNotice(channel);

  let topSpacer = el.querySelector('.chat-virtual-spacer-top');
  let bottomSpacer = el.querySelector('.chat-virtual-spacer-bottom');

  if (!topSpacer) {
    topSpacer = document.createElement('div');
    topSpacer.className = 'chat-virtual-spacer chat-virtual-spacer-top';
    topSpacer.style.cssText = 'height:0;pointer-events:none;flex:0 0 auto;';
    const notice = el.querySelector('.chat-history-notice');
    if (notice && notice.parentNode === el) el.insertBefore(topSpacer, notice.nextSibling);
    else el.prepend(topSpacer);
  }

  if (!bottomSpacer) {
    bottomSpacer = document.createElement('div');
    bottomSpacer.className = 'chat-virtual-spacer chat-virtual-spacer-bottom';
    bottomSpacer.style.cssText = 'height:0;pointer-events:none;flex:0 0 auto;';
    el.appendChild(bottomSpacer);
  }

  state.topSpacer = topSpacer;
  state.bottomSpacer = bottomSpacer;
  return { el, topSpacer, bottomSpacer };
}

function getVirtualRenderedNodes(channel = 'chat') {
  const state = getRenderState(channel);
  const el = getRenderContainer(channel);
  if (!el) return [];
  return Array.from(el.children).filter(node => {
    if (!(node instanceof HTMLElement)) return false;
    if (node === state.topSpacer || node === state.bottomSpacer) return false;
    if (node.classList.contains('chat-history-notice')) return false;
    return node.classList.contains('chat-msg');
  });
}

function estimateItemHeight(channel = 'chat', key = '') {
  const state = getRenderState(channel);
  return state.itemHeights.get(key) || state.avgItemHeight || 76;
}

function sumEstimatedHeights(channel = 'chat', start = 0, end = 0) {
  const state = getRenderState(channel);
  if (start >= end) return 0;
  let total = 0;
  for (let i = start; i < end; i += 1) {
    total += estimateItemHeight(channel, state.storeOrder[i]);
  }
  return total;
}

function updateMeasuredHeights(channel = 'chat') {
  const state = getRenderState(channel);
  const nodes = getVirtualRenderedNodes(channel);
  if (!nodes.length) return;
  let total = 0;
  let count = 0;
  nodes.forEach((node) => {
    const key = node?.dataset?.msgKey || '';
    if (!key) return;
    const h = Math.max(24, Math.round(node.getBoundingClientRect().height || node.offsetHeight || 0));
    if (!h) return;
    state.itemHeights.set(key, h);
    total += h;
    count += 1;
  });
  if (count > 0) {
    state.avgItemHeight = Math.max(44, Math.round(total / count));
  }
}

function renderVirtualWindow(channel = 'chat', options = {}) {
  const state = getRenderState(channel);
  if (!state.virtualEnabled) return false;
  const shell = ensureVirtualElements(channel);
  if (!shell) return false;

  const { el, topSpacer, bottomSpacer } = shell;
  const total = state.storeOrder.length;
  const prevScrollTop = el.scrollTop;
  const oldNodes = getVirtualRenderedNodes(channel);
  const anchorNode = oldNodes[0] || null;
  const anchorKey = anchorNode?.dataset?.msgKey || '';
  const anchorOffset = anchorNode ? (prevScrollTop - anchorNode.offsetTop) : 0;

  if (!total) {
    oldNodes.forEach(node => node.remove());
    state.map.clear();
    state.renderedStart = 0;
    state.renderedEnd = 0;
    topSpacer.style.height = '0px';
    bottomSpacer.style.height = '0px';
    syncStickyState(channel, el);
    return true;
  }

  const approxHeight = Math.max(44, state.avgItemHeight || 76);
  const viewportCount = Math.max(state.minWindow, Math.ceil((el.clientHeight || 640) / approxHeight) + (state.overscan * 2));
  let start = 0;
  let end = total;

  if (options.forceStickBottom || state.stickyToBottom) {
    end = total;
    start = Math.max(0, end - viewportCount);
  } else {
    const approxIndex = Math.max(0, Math.floor(prevScrollTop / approxHeight));
    start = Math.max(0, approxIndex - state.overscan);
    end = Math.min(total, start + viewportCount);
    start = Math.max(0, end - viewportCount);
  }

  const nextKeys = state.storeOrder.slice(start, end);
  oldNodes.forEach(node => node.remove());
  state.map.clear();

  const frag = document.createDocumentFragment();
  nextKeys.forEach((key) => {
    const record = getStoredRecord(channel, key);
    const node = buildMessageNodeFromRecord(channel, record);
    if (!node) return;
    node.dataset.msgKey = key;
    state.map.set(key, node);
    frag.appendChild(node);
  });

  bottomSpacer.parentNode.insertBefore(frag, bottomSpacer);
  state.renderedStart = start;
  state.renderedEnd = end;

  updateMeasuredHeights(channel);

  topSpacer.style.height = `${sumEstimatedHeights(channel, 0, start)}px`;
  bottomSpacer.style.height = `${sumEstimatedHeights(channel, end, total)}px`;
  primeDeferredChatImages(el);

  if (options.forceStickBottom || state.stickyToBottom) {
    scrollToBottom(el);
    state.pendingBottomNotice = 0;
  } else if (anchorKey && nextKeys.includes(anchorKey)) {
    const restored = state.map.get(anchorKey);
    if (restored) {
      el.scrollTop = restored.offsetTop + anchorOffset;
    }
  }

  syncStickyState(channel, el);
  return true;
}

function scheduleVirtualRender(channel = 'chat', options = {}) {
  const state = getRenderState(channel);
  if (!state.virtualEnabled) return;
  state.virtualDirty = true;
  if (options.forceStickBottom) state.virtualForceStickBottom = true;
  if (state.virtualRaf) return;
  state.virtualRaf = requestAnimationFrame(() => {
    state.virtualRaf = 0;
    if (!state.virtualDirty) return;
    state.virtualDirty = false;
    const forceStickBottom = !!state.virtualForceStickBottom;
    state.virtualForceStickBottom = false;
    renderVirtualWindow(channel, { forceStickBottom });
  });
}

function upsertStoredMessage(channel = 'chat', key, record, options = {}) {
  const state = getRenderState(channel);
  const safeKey = makeStoredMessageKey(channel, key);
  const existing = state.storeMap.has(safeKey);
  const position = options?.position === 'prepend' ? 'prepend' : 'append';

  if (!existing) {
    if (position === 'prepend') state.storeOrder.unshift(safeKey);
    else state.storeOrder.push(safeKey);
  }
  state.storeMap.set(safeKey, { ...(record || {}), _key: safeKey });

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
    nameColor: record.nameColor,
    standingImg: record.standingImg,
    tokenId: record.tokenId,
    standingLabel: record.standingLabel,
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
    nameColor: record.nameColor,
    standingImg: record.standingImg,
    tokenId: record.tokenId,
    standingLabel: record.standingLabel,
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
    nameColor: record.nameColor || '',
    standingImg: record.standingImg || '',
    tokenId: record.tokenId || '',
    standingLabel: record.standingLabel || '',
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

function buildMessageNodeFromRecord(channel = 'chat', record) {
  if (!record) return null;
  if (channel === 'casual') {
    return buildCasualMsgElement(record.name, record.text, record.uid, record.timestamp, record._key);
  }
  return buildChatMsgElement({ ...record, msgKey: record._key, channel });
}

function trimRenderedMessages(channel = 'chat', direction = 'top') {
  const state = getRenderState(channel);
  const el = getRenderContainer(channel);
  if (!el) return;
  if (state.virtualEnabled) return;
  const trimFromBottom = direction === 'bottom';
  while (el.children.length > state.max) {
    let removable = trimFromBottom ? el.lastElementChild : el.firstElementChild;
    if (!removable) break;
    if (removable.classList.contains('chat-history-notice')) {
      removable = trimFromBottom ? removable.previousElementSibling : removable.nextElementSibling;
    }
    if (!removable) break;
    if (!removable.classList.contains('chat-msg')) {
      removable = trimFromBottom ? removable.previousElementSibling : removable.nextElementSibling;
      if (!removable) break;
    }
    const key = removable.dataset.msgKey || '';
    if (key) state.map.delete(key);
    removable.remove();
  }
}

function ensureHistoryNotice(channel = 'chat') {
  const el = getRenderContainer(channel);
  if (!el) return null;
  let notice = el.querySelector('.chat-history-notice');
  if (!notice) {
    notice = document.createElement('button');
    notice.type = 'button';
    notice.className = 'chat-history-notice';
    notice.style.cssText = 'display:none;width:100%;margin:0 0 8px;padding:8px 10px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.04);color:#cfd3dc;font-size:12px;cursor:pointer;';
    notice.addEventListener('click', () => {
      const target = getRenderContainer(channel);
      if (!target) return;
      scrollToBottom(target);
      const state = getRenderState(channel);
      state.pendingBottomNotice = 0;
      syncStickyState(channel, target);
    });
    el.prepend(notice);
  }
  return notice;
}

function prependStoredWindow(channel = 'chat', count = 0) {
  const state = getRenderState(channel);
  if (state.virtualEnabled) return false;
  const el = getRenderContainer(channel);
  if (!el || !state.storeOrder.length) return false;

  const renderedKeys = getRenderedKeyList(channel);
  const firstRenderedKey = renderedKeys[0] || '';
  const firstIndex = firstRenderedKey ? state.storeOrder.indexOf(firstRenderedKey) : state.storeOrder.length;
  if (firstIndex <= 0) return false;

  const step = Math.max(1, count || state.loadStep);
  const start = Math.max(0, firstIndex - step);
  const keysToAdd = state.storeOrder.slice(start, firstIndex);
  if (!keysToAdd.length) return false;

  const prevHeight = el.scrollHeight;
  const prevTop = el.scrollTop;
  const frag = document.createDocumentFragment();

  keysToAdd.forEach(key => {
    const record = getStoredRecord(channel, key);
    const node = buildMessageNodeFromRecord(channel, record);
    if (!node) return;
    node.dataset.msgKey = key;
    state.map.set(key, node);
    frag.appendChild(node);
  });

  const notice = ensureHistoryNotice(channel);
  if (notice && notice.parentNode === el) {
    el.insertBefore(frag, notice.nextSibling);
  } else {
    el.prepend(frag);
  }

  trimRenderedMessages(channel, 'bottom');
  primeDeferredChatImages(el);
  const nextHeight = el.scrollHeight;
  el.scrollTop = prevTop + (nextHeight - prevHeight);
  return true;
}

function appendStoredWindow(channel = 'chat', count = 0) {
  const state = getRenderState(channel);
  if (state.virtualEnabled) return false;
  const el = getRenderContainer(channel);
  if (!el || !state.storeOrder.length) return false;

  const renderedKeys = getRenderedKeyList(channel);
  const lastRenderedKey = renderedKeys[renderedKeys.length - 1] || '';
  const lastIndex = lastRenderedKey ? state.storeOrder.indexOf(lastRenderedKey) : -1;
  if (lastIndex >= state.storeOrder.length - 1) return false;

  const step = Math.max(1, count || state.loadStep);
  const end = Math.min(state.storeOrder.length, lastIndex + 1 + step);
  const keysToAdd = state.storeOrder.slice(lastIndex + 1, end);
  if (!keysToAdd.length) return false;

  const keepBottom = isNearBottom(el);
  const frag = document.createDocumentFragment();
  keysToAdd.forEach(key => {
    const record = getStoredRecord(channel, key);
    const node = buildMessageNodeFromRecord(channel, record);
    if (!node) return;
    node.dataset.msgKey = key;
    state.map.set(key, node);
    frag.appendChild(node);
  });
  el.appendChild(frag);
  trimRenderedMessages(channel);
  primeDeferredChatImages(el);
  if (keepBottom) requestAnimationFrame(() => scrollToBottom(el));
  return true;
}

function flushMessageRender(channel = 'chat') {
  const state = getRenderState(channel);
  state.raf = 0;
  const el = getRenderContainer(channel);
  if (!el || state.queue.length === 0) return;
  if (state.virtualEnabled) {
    const items = state.queue.splice(0, state.queue.length);
    if (!state.stickyToBottom) state.pendingBottomNotice += items.length;
    scheduleVirtualRender(channel, { forceStickBottom: state.stickyToBottom });
    syncStickyState(channel, el);
    return;
  }

  ensureHistoryNotice(channel);
  const keepBottom = isNearBottom(el);
  const items = state.queue.splice(0, state.queue.length);

  items.forEach((item) => {
    const { node, key } = item;
    if (!node || !key) return;
    const current = state.map.get(key);
    if (current && current.parentNode === el) {
      el.replaceChild(node, current);
      state.map.set(key, node);
      return;
    }
    state.map.set(key, node);
    el.appendChild(node);
  });

  trimRenderedMessages(channel);
  primeDeferredChatImages(el);

  if (keepBottom || state.stickyToBottom) {
    state.pendingBottomNotice = 0;
    requestAnimationFrame(() => {
      scrollToBottom(el);
      syncStickyState(channel, el);
    });
  } else {
    state.pendingBottomNotice += items.length;
    syncStickyState(channel, el);
  }
}

function queueMessageRender(channel = 'chat', node, key = '', autoscroll = true) {
  const state = getRenderState(channel);
  const el = getRenderContainer(channel);
  if (!el || !node) return;
  if (state.virtualEnabled) {
    if (autoscroll) syncStickyState(channel, el);
    state.queue.push({ node, key });
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => flushMessageRender(channel));
    return;
  }
  if (key) node.dataset.msgKey = key;
  if (autoscroll) syncStickyState(channel, el);
  state.queue.push({ node, key });
  if (state.raf) return;
  state.raf = requestAnimationFrame(() => flushMessageRender(channel));
}

function replaceRenderedMessage(channel = 'chat', key, node) {
  const state = getRenderState(channel);
  const el = getRenderContainer(channel);
  if (!el || !key || !node) return;
  if (state.virtualEnabled) {
    scheduleVirtualRender(channel, { forceStickBottom: state.stickyToBottom });
    return;
  }
  const current = state.map.get(key) || el.querySelector(`.chat-msg[data-msg-key="${CSS.escape(key)}"]`);
  node.dataset.msgKey = key;
  if (current && current.parentNode === el) {
    const keepBottom = isNearBottom(el);
    el.replaceChild(node, current);
    state.map.set(key, node);
    primeDeferredChatImages(el);
    if (keepBottom) requestAnimationFrame(() => scrollToBottom(el));
  } else {
    const safeKey = upsertStoredMessage(channel, key, getStoredRecord(channel, key) || {});
    queueMessageRender(channel, node, safeKey, true);
  }
}

function removeRenderedMessage(channel = 'chat', key) {
  const state = getRenderState(channel);
  const el = getRenderContainer(channel);
  if (!el || !key) return;
  if (state.virtualEnabled) {
    state.itemHeights.delete(key);
    removeStoredMessage(channel, key);
    scheduleVirtualRender(channel, { forceStickBottom: state.stickyToBottom });
    return;
  }
  const current = state.map.get(key) || el.querySelector(`.chat-msg[data-msg-key="${CSS.escape(key)}"]`);
  if (current) current.remove();
  state.map.delete(key);
  removeStoredMessage(channel, key);
  syncStickyState(channel, el);
}


function configureHistoryPaging(channel = 'chat', options = {}) {
  const state = getRenderState(channel);
  state.historyLoader = typeof options.loadOlder === 'function' ? options.loadOlder : null;
  state.historyLoading = false;
  state.historyExhausted = !!options.exhausted || !state.historyLoader;
}

async function requestOlderHistory(channel = 'chat') {
  const state = getRenderState(channel);
  if (!state.historyLoader || state.historyLoading || state.historyExhausted) return 0;
  state.historyLoading = true;
  try {
    const result = await state.historyLoader();
    const count = Number(typeof result === 'number' ? result : (result?.count || 0)) || 0;
    if (typeof result === 'object' && result && Object.prototype.hasOwnProperty.call(result, 'exhausted')) {
      state.historyExhausted = !!result.exhausted;
    } else if (count <= 0) {
      state.historyExhausted = true;
    }
    return count;
  } catch (err) {
    console.error(`requestOlderHistory(${channel}) failed`, err);
    return 0;
  } finally {
    state.historyLoading = false;
  }
}

function bindMessageViewport(channel = 'chat') {
  const state = getRenderState(channel);
  const el = getRenderContainer(channel);
  if (!el || state.scrollBound) return;
  state.scrollBound = true;
  ensureHistoryNotice(channel);
  if (state.virtualEnabled) ensureVirtualElements(channel);
  el.addEventListener('scroll', () => {
    if (state.scrollTick) cancelAnimationFrame(state.scrollTick);
    state.scrollTick = requestAnimationFrame(() => {
      state.scrollTick = 0;
      const wasSticky = state.stickyToBottom;
      syncStickyState(channel, el);

      if (state.virtualEnabled) {
        if (state.stickyToBottom) {
          state.pendingBottomNotice = 0;
        }
        const approxHeight = Math.max(44, state.avgItemHeight || 76);
        const bufferPx = approxHeight * Math.max(4, state.overscan - 2);
        const currentTop = sumEstimatedHeights(channel, 0, state.renderedStart);
        const currentBottom = sumEstimatedHeights(channel, state.renderedEnd, state.storeOrder.length);
        const shouldShiftUp = el.scrollTop < Math.max(0, currentTop - bufferPx);
        const visibleBottom = el.scrollTop + el.clientHeight;
        const currentWindowBottom = currentTop + currentBottom + sumEstimatedHeights(channel, state.renderedStart, state.renderedEnd);
        const shouldShiftDown = visibleBottom > Math.max(0, currentWindowBottom - currentBottom - bufferPx);
        if (!wasSticky || !state.stickyToBottom || state.storeOrder.length !== (state.renderedEnd - state.renderedStart)) {
          if (shouldShiftUp || shouldShiftDown || state.stickyToBottom) {
            scheduleVirtualRender(channel, { forceStickBottom: state.stickyToBottom });
          }
        }
        return;
      }

      if (isNearTop(el, 28)) {
        if (!prependStoredWindow(channel)) {
          requestOlderHistory(channel).then((loadedCount) => {
            if (loadedCount > 0) {
              if (state.virtualEnabled) scheduleVirtualRender(channel, { forceStickBottom: false });
              else prependStoredWindow(channel, loadedCount);
            }
            syncStickyState(channel, el);
          });
        }
      } else if (isNearBottom(el, 28)) {
        if (appendStoredWindow(channel)) {
          requestAnimationFrame(() => syncStickyState(channel, el));
        } else {
          state.pendingBottomNotice = 0;
          syncStickyState(channel, el);
        }
      }
    });
  }, { passive: true });
}

function resetRenderedMessages(channel = 'chat') {
  const state = getRenderState(channel);
  const el = getRenderContainer(channel);
  if (state.raf) {
    cancelAnimationFrame(state.raf);
    state.raf = 0;
  }
  if (state.scrollTick) {
    cancelAnimationFrame(state.scrollTick);
    state.scrollTick = 0;
  }
  if (state.virtualRaf) {
    cancelAnimationFrame(state.virtualRaf);
    state.virtualRaf = 0;
  }
  state.queue = [];
  state.map.clear();
  state.storeOrder = [];
  state.storeMap.clear();
  state.itemHeights.clear();
  state.pendingBottomNotice = 0;
  state.stickyToBottom = true;
  state.virtualDirty = false;
  state.virtualForceStickBottom = false;
  state.renderedStart = 0;
  state.renderedEnd = 0;
  state.topSpacer = null;
  state.bottomSpacer = null;
  state.historyLoading = false;
  state.historyExhausted = !state.historyLoader;
  if (!el) return;
  el.innerHTML = '';
  if (state.virtualEnabled) ensureVirtualElements(channel);
  ensureHistoryNotice(channel);
  syncStickyState(channel, el);
}

function activateChatRenderChannel(channel = 'chat') {
  const safeChannel = String(channel || 'chat').trim() || 'chat';
  const el = document.getElementById('chat-messages');
  if (!el) return;

  Object.keys(_renderState).forEach((key) => {
    if (key === 'casual') return;
    const state = getRenderState(key);
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    if (state.scrollTick) {
      cancelAnimationFrame(state.scrollTick);
      state.scrollTick = 0;
    }
    if (state.virtualRaf) {
      cancelAnimationFrame(state.virtualRaf);
      state.virtualRaf = 0;
    }
    state.queue = [];
    state.map.clear();
    state.topSpacer = null;
    state.bottomSpacer = null;
  });

  const state = getRenderState(safeChannel);
  el.innerHTML = '';
  if (state.virtualEnabled) {
    ensureVirtualElements(safeChannel);
    scheduleVirtualRender(safeChannel, { forceStickBottom: true });
  } else {
    ensureHistoryNotice(safeChannel);
    appendStoredWindow(safeChannel, Math.max(state.loadStep, state.storeOrder.length || 0));
    requestAnimationFrame(() => {
      scrollToBottom(el);
      syncStickyState(safeChannel, el);
    });
  }
}

