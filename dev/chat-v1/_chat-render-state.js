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


/* ==========================================================================
 * CHAT SECTION: RENDER STATE
 * 채팅/잡담/DM 채널별 렌더 큐, 캐시, 스크롤 상태 저장
 * ========================================================================== */

const _renderState = {
  chat: {
    containerId: 'chat-messages',
    raf: 0,
    queue: [],
    map: new Map(),
    max: 320,
    maxMemory: 2600,
    loadStep: 80,
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
    max: 180,
    maxMemory: 1000,
    loadStep: 48,
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


/* ==========================================================================
 * CHAT SECTION: MESSAGE KEY AND ORDER INDEX
 * Firebase key/timestamp 기준 저장 메시지 정렬 및 중복 DOM 방어
 * ========================================================================== */

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

function getRenderedNodeByKey(channel = 'chat', key = '') {
  const safeKey = String(key || '').trim();
  if (!safeKey) return null;
  const state = getRenderState(channel);
  const mapped = state.map.get(safeKey);
  if (mapped && mapped.parentNode) return mapped;
  const el = getRenderContainer(channel);
  if (!el) return null;
  try {
    return el.querySelector(`.chat-msg[data-msg-key="${CSS.escape(safeKey)}"]`);
  } catch (e) {
    return null;
  }
}

function getStoredMessageSortTime(record = {}) {
  const n = Number(record?.timestamp || record?.time || 0);
  return Number.isFinite(n) ? n : 0;
}

function compareStoredMessageKeys(channel = 'chat', leftKey = '', rightKey = '') {
  const state = getRenderState(channel);
  const left = state.storeMap.get(leftKey) || {};
  const right = state.storeMap.get(rightKey) || {};
  const lt = getStoredMessageSortTime(left);
  const rt = getStoredMessageSortTime(right);
  if (lt && rt && lt !== rt) return lt - rt;
  return String(leftKey || '').localeCompare(String(rightKey || ''));
}

function insertStoredKeyInOrder(channel = 'chat', key = '') {
  const safeKey = String(key || '').trim();
  if (!safeKey) return;
  const state = getRenderState(channel);
  const prevIdx = state.storeOrder.indexOf(safeKey);
  if (prevIdx >= 0) state.storeOrder.splice(prevIdx, 1);

  let insertAt = state.storeOrder.length;
  for (let i = 0; i < state.storeOrder.length; i += 1) {
    if (compareStoredMessageKeys(channel, safeKey, state.storeOrder[i]) < 0) {
      insertAt = i;
      break;
    }
  }
  state.storeOrder.splice(insertAt, 0, safeKey);
}

function insertRenderedNodeInStoredOrder(channel = 'chat', node, key = '') {
  const state = getRenderState(channel);
  const el = getRenderContainer(channel);
  if (!el || !node) return false;
  const safeKey = String(key || node?.dataset?.msgKey || '').trim();
  if (!safeKey) {
    el.appendChild(node);
    return true;
  }

  const current = getRenderedNodeByKey(channel, safeKey);
  if (current && current !== node && current.parentNode === el) {
    el.replaceChild(node, current);
    state.map.set(safeKey, node);
    return true;
  }

  const orderIndex = state.storeOrder.indexOf(safeKey);
  if (orderIndex < 0) {
    el.appendChild(node);
    state.map.set(safeKey, node);
    return true;
  }

  for (let i = orderIndex + 1; i < state.storeOrder.length; i += 1) {
    const nextKey = state.storeOrder[i];
    const nextNode = state.map.get(nextKey) || getRenderedNodeByKey(channel, nextKey);
    if (nextNode && nextNode.parentNode === el && nextNode !== node) {
      el.insertBefore(node, nextNode);
      state.map.set(safeKey, node);
      return true;
    }
  }

  el.appendChild(node);
  state.map.set(safeKey, node);
  return true;
}

function removeDuplicateRenderedMessages(channel = 'chat') {
  const state = getRenderState(channel);
  const el = getRenderContainer(channel);
  if (!el) return;
  const seen = new Set();
  Array.from(el.querySelectorAll('.chat-msg[data-msg-key]')).forEach((node) => {
    const key = String(node?.dataset?.msgKey || '').trim();
    if (!key) return;
    if (seen.has(key)) {
      node.remove();
      return;
    }
    seen.add(key);
    state.map.set(key, node);
  });
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



