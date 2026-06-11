
/* ==========================================================================
 * CHAT SECTION: CORE UTILITIES
 * Firebase serverTimestamp fallback 등 채팅 공통 유틸리티
 * ========================================================================== */

function getChatServerTimestamp() {
  return (window._FB?.CONFIGURED && typeof window._FB.serverTimestamp === 'function')
    ? window._FB.serverTimestamp()
    : Date.now();
}

/**
 * ITC TRPG — Chat 모듈
 *
 * dev/chat-v1/_chat-render.js 담당 범위:
 * - 입력창 resize / 한글 IME guard
 * - 채팅 렌더 상태, 메시지 저장 인덱스, DOM window 관리
 * - 이전 채팅 히스토리 로딩, 스크롤 위치 보존
 * - 채널 전환 시 렌더 상태 초기화/복구
 *
 * 주의:
 * - 이 파일은 build.sh에서 _chat-image.js, _chat-send.js와 합쳐져
 *   src/modules/chat-v1/chat.js가 됩니다.
 * - 기능 수정 시 src와 dev가 다시 어긋나지 않도록 dev 기준으로 수정해야 합니다.
 */


/* ==========================================================================
 * CHAT SECTION: INPUT RESIZE STATE
 * 본래창 채팅 입력창 PC resize 상태와 localStorage 높이 보존
 * ========================================================================== */

const _chatInputResizeState = {
  boundInput: null,
  dragging: false,
  edge: '',
  startY: 0,
  startHeight: 0,
  pointerId: null,
  docBound: false,
  storageKey: 'itc_chat_input_height',
};

function clampChatInputHeight(value, input = null) {
  const raw = Number(value || 0);
  const min = input ? Math.max(34, Number.parseFloat(getComputedStyle(input).minHeight || '34') || 34) : 34;
  const viewportMax = Math.max(96, Math.floor((window.innerHeight || 720) * 0.34));
  const max = Math.min(220, viewportMax);
  return Math.max(min, Math.min(max, raw || min));
}

function applyChatInputHeight(input, value, options = {}) {
  if (!input) return;
  const height = clampChatInputHeight(value, input);
  input.style.height = `${height}px`;
  input.style.overflowY = 'auto';
  if (!options.skipStore) {
    try { localStorage.setItem(_chatInputResizeState.storageKey, String(Math.round(height))); } catch (e) {}
  }
}

function getChatInputResizeEdge(event, input) {
  if (!event || !input || event.pointerType === 'touch') return '';
  const rect = input.getBoundingClientRect();
  const y = Number(event.clientY || 0) - rect.top;
  const edgeSize = 7;
  if (y >= 0 && y <= edgeSize) return 'top';
  if (rect.bottom - Number(event.clientY || 0) >= 0 && rect.bottom - Number(event.clientY || 0) <= edgeSize) return 'bottom';
  return '';
}

function bindChatInputResizeDocumentEvents() {
  if (_chatInputResizeState.docBound) return;
  _chatInputResizeState.docBound = true;

  document.addEventListener('pointermove', (event) => {
    const st = _chatInputResizeState;
    const input = st.boundInput;
    if (!st.dragging || !input) return;
    event.preventDefault();
    const dy = Number(event.clientY || 0) - Number(st.startY || 0);
    const next = st.edge === 'top'
      ? Number(st.startHeight || 0) - dy
      : Number(st.startHeight || 0) + dy;
    applyChatInputHeight(input, next);
  }, { passive: false });

  const stop = (event = null) => {
    const st = _chatInputResizeState;
    const input = st.boundInput;
    if (!st.dragging && !input) return;
    if (input) {
      input.classList.remove('is-resizing', 'resize-edge-hover');
      input.style.cursor = '';
      try {
        if (event && st.pointerId != null) input.releasePointerCapture(st.pointerId);
      } catch (e) {}
    }
    st.dragging = false;
    st.edge = '';
    st.boundInput = null;
    st.pointerId = null;
    document.body.classList.remove('chat-input-is-resizing');
  };

  document.addEventListener('pointerup', stop, true);
  document.addEventListener('pointercancel', stop, true);
  window.addEventListener('blur', stop);
}

function initChatInputResize(input = null) {
  const inp = input || document.getElementById('chat-input');
  if (!inp || inp.dataset.chatResizeBound === '1') return;
  inp.dataset.chatResizeBound = '1';
  inp.classList.add('chat-input-resizable');
  bindChatInputResizeDocumentEvents();

  try {
    const saved = Number(localStorage.getItem(_chatInputResizeState.storageKey) || 0);
    if (saved) applyChatInputHeight(inp, saved, { skipStore: true });
  } catch (e) {}

  inp.addEventListener('pointermove', (event) => {
    if (_chatInputResizeState.dragging) return;
    const edge = getChatInputResizeEdge(event, inp);
    inp.classList.toggle('resize-edge-hover', !!edge);
    inp.style.cursor = edge ? 'ns-resize' : '';
  });

  inp.addEventListener('pointerleave', () => {
    if (_chatInputResizeState.dragging) return;
    inp.classList.remove('resize-edge-hover');
    inp.style.cursor = '';
  });

  inp.addEventListener('pointerdown', (event) => {
    const edge = getChatInputResizeEdge(event, inp);
    if (!edge || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    _chatInputResizeState.dragging = true;
    _chatInputResizeState.edge = edge;
    _chatInputResizeState.boundInput = inp;
    _chatInputResizeState.pointerId = event.pointerId;
    _chatInputResizeState.startY = event.clientY;
    _chatInputResizeState.startHeight = inp.getBoundingClientRect().height;
    inp.classList.add('is-resizing');
    document.body.classList.add('chat-input-is-resizing');
    try { inp.setPointerCapture(event.pointerId); } catch (e) {}
  });
}


function scheduleChatInputResizeInit() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initChatInputResize(), { once: true });
  } else {
    setTimeout(() => initChatInputResize(), 0);
  }
}


/* ==========================================================================
 * CHAT SECTION: INPUT IME GUARD
 * 한글 IME 조합 입력, 마지막 글자 echo, 중복 전송 방어
 * ========================================================================== */

const _chatInputGuard = {
  boundInput: null,
  composing: false,
  compositionEndedAt: 0,
  pendingEnterToken: 0,
  lastEnterAt: 0,
  lastSubmitAt: 0,
  lastSubmitText: '',
  lastSubmitTail: '',
  lastSubmitChannel: '',
  lastSubmitTab: '',
  echoBlockUntil: 0,
  echoClearTimers: [],
};

function getChatInputGuard() {
  const inp = document.getElementById('chat-input');
  if (inp && _chatInputGuard.boundInput !== inp) {
    _chatInputGuard.boundInput = inp;
    _chatInputGuard.composing = false;

    inp.addEventListener('compositionstart', () => {
      _chatInputGuard.composing = true;
    });

    inp.addEventListener('compositionend', () => {
      _chatInputGuard.composing = false;
      _chatInputGuard.compositionEndedAt = Date.now();
    });

    inp.addEventListener('input', () => {
      clearChatImeEchoIfNeeded(inp);
    });

    initChatInputResize(inp);
  }
  return _chatInputGuard;
}

function getChatImeTail(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const chars = Array.from(trimmed);
  return chars[chars.length - 1] || '';
}

function isLikelyChatImeEcho(raw = '', channelKey = '') {
  const guard = getChatInputGuard();
  const now = Date.now();
  const text = String(raw || '').trim();
  if (!text || now > Number(guard.echoBlockUntil || 0)) return false;

  const lastText = String(guard.lastSubmitText || '').trim();
  if (!lastText || text === lastText) return false;

  const sameChannel = !guard.lastSubmitChannel || !channelKey || String(guard.lastSubmitChannel) === String(channelKey);
  if (!sameChannel) return false;

  const textLen = Array.from(text).length;
  if (text === guard.lastSubmitTail && lastText.endsWith(text)) return true;
  if (textLen <= 2 && Array.from(lastText).length > textLen && lastText.endsWith(text)) return true;
  return false;
}

function shouldSuppressChatSubmit(raw = '', channelKey = '') {
  const guard = getChatInputGuard();
  const now = Date.now();
  const text = String(raw || '').trim();
  if (!text) return false;

  if (isLikelyChatImeEcho(text, channelKey)) return true;

  const sameText = text === String(guard.lastSubmitText || '').trim();
  const sameChannel = !guard.lastSubmitChannel || !channelKey || String(guard.lastSubmitChannel) === String(channelKey);
  if (sameText && sameChannel && now - Number(guard.lastSubmitAt || 0) < 650) return true;

  return false;
}

function markChatSubmitForImeGuard(raw = '', channelKey = '') {
  const guard = getChatInputGuard();
  const text = String(raw || '').trim();
  if (!text) return;

  guard.lastSubmitAt = Date.now();
  guard.lastSubmitText = text;
  guard.lastSubmitTail = getChatImeTail(text);
  guard.lastSubmitChannel = String(channelKey || '').trim();
  guard.lastSubmitTab = String(typeof _activeRightTab !== 'undefined' ? _activeRightTab : '').trim();
  guard.echoBlockUntil = guard.lastSubmitAt + 1400;

  clearChatImeEchoTimers();
  const inp = document.getElementById('chat-input');
  if (!inp || !guard.lastSubmitTail) return;

  [40, 140, 320].forEach((delay) => {
    const timer = setTimeout(() => {
      clearChatImeEchoIfNeeded(inp);
    }, delay);
    guard.echoClearTimers.push(timer);
  });
}

function cancelChatSubmitForImeGuard(raw = '', channelKey = '') {
  const guard = getChatInputGuard();
  const text = String(raw || '').trim();
  if (!text) return;
  const sameText = text === String(guard.lastSubmitText || '').trim();
  const sameChannel = !guard.lastSubmitChannel || !channelKey || String(guard.lastSubmitChannel) === String(channelKey);
  if (sameText && sameChannel) {
    guard.echoBlockUntil = 0;
    guard.lastSubmitText = '';
    guard.lastSubmitTail = '';
  }
}

function clearChatImeEchoTimers() {
  const guard = getChatInputGuard();
  const timers = Array.isArray(guard.echoClearTimers) ? guard.echoClearTimers.splice(0) : [];
  timers.forEach((timer) => {
    try { clearTimeout(timer); } catch (e) {}
  });
}

function clearChatImeEchoIfNeeded(inp = null) {
  const guard = getChatInputGuard();
  const input = inp || document.getElementById('chat-input');
  if (!input) return;
  const now = Date.now();
  if (now > Number(guard.echoBlockUntil || 0)) return;
  const value = String(input.value || '').trim();
  if (!value) return;
  if (isLikelyChatImeEcho(value, guard.lastSubmitChannel || '')) {
    input.value = '';
  }
}

function chatKeydown(e) {
  if (e.key !== 'Enter' || e.shiftKey) return;

  const guard = getChatInputGuard();
  const now = Date.now();
  e.preventDefault();

  const isComposing = !!(e.isComposing || e.keyCode === 229 || guard.composing);
  const justComposed = now - Number(guard.compositionEndedAt || 0) < 70;

  if (isComposing || justComposed) {
    const token = ++guard.pendingEnterToken;
    setTimeout(() => {
      const latest = getChatInputGuard();
      if (token !== latest.pendingEnterToken || latest.composing) return;
      sendChat();
    }, isComposing ? 90 : 35);
    return;
  }

  if (now - Number(guard.lastEnterAt || 0) < 80) return;
  guard.lastEnterAt = now;
  sendChat();
}


/* ==========================================================================
 * CHAT SECTION: INPUT MODE AND ADMIN ACTIONS
 * desc 모드, 채팅 버튼 표시, GM 전체 삭제 처리
 * ========================================================================== */

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
    max: (window.ITC_CONFIG?.CHAT.DOM_MAX_VISIBLE ?? 320),
    maxMemory: (window.ITC_CONFIG?.CHAT.MEMORY_MAX ?? 2600),
    loadStep: (window.ITC_CONFIG?.CHAT.LOAD_STEP ?? 80),
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
    max: (window.ITC_CONFIG?.CHAT.DOM_MAX_VISIBLE ?? 180),
    maxMemory: (window.ITC_CONFIG?.CHAT.MEMORY_MAX ?? 1000),
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



/* ==========================================================================
 * CHAT SECTION: VIRTUAL WINDOW RENDERING
 * 대량 메시지용 가상 window 렌더링과 spacer 높이 계산
 * ========================================================================== */

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
  // offsetTop을 DOM 제거 전에 미리 캡처해야 정확한 값을 얻을 수 있음
  const anchorTop = anchorNode ? anchorNode.offsetTop : 0;
  const anchorOffset = anchorNode ? (prevScrollTop - anchorTop) : 0;

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


/* ==========================================================================
 * CHAT SECTION: DOM MUTATION AND RENDER QUEUE
 * 저장 메시지를 DOM 노드로 변환하고 append/replace/remove 처리
 * ========================================================================== */

function buildMessageNodeFromRecord(channel = 'chat', record) {
  if (!record) return null;
  if (channel === 'casual') {
    return buildCasualMsgElement(record.name, record.text, record.uid, record.timestamp, record._key, record.nameColor || '');
  }
  return buildChatMsgElement({ ...record, msgKey: record._key, channel });
}

function getRenderedMessageNodes(channel = 'chat') {
  const el = getRenderContainer(channel);
  if (!el) return [];
  return Array.from(el.children).filter((node) => {
    if (!(node instanceof HTMLElement)) return false;
    return node.classList.contains('chat-msg') && !!node.dataset.msgKey;
  });
}

function getRenderedMessageCount(channel = 'chat') {
  return getRenderedMessageNodes(channel).length;
}

function captureRenderedScrollAnchor(channel = 'chat') {
  const el = getRenderContainer(channel);
  if (!el) return null;
  const nodes = getRenderedMessageNodes(channel);
  if (!nodes.length) return null;
  const viewportTop = el.getBoundingClientRect().top;
  const visibleTop = el.scrollTop;
  const visibleBottom = visibleTop + el.clientHeight;
  let anchor = null;
  for (const node of nodes) {
    const nodeTop = node.offsetTop;
    const nodeBottom = nodeTop + (node.offsetHeight || 0);
    if (nodeBottom >= visibleTop - 4 && nodeTop <= visibleBottom + 4) {
      anchor = node;
      break;
    }
  }
  if (!anchor) anchor = nodes[0];
  const key = String(anchor?.dataset?.msgKey || '').trim();
  if (!key) return null;
  return {
    key,
    topDelta: anchor.getBoundingClientRect().top - viewportTop,
    scrollTop: el.scrollTop,
  };
}

function restoreRenderedScrollAnchor(channel = 'chat', anchor = null) {
  const el = getRenderContainer(channel);
  if (!el || !anchor?.key) return false;
  const node = getRenderedNodeByKey(channel, anchor.key);
  if (!node || node.parentNode !== el) return false;
  const viewportTop = el.getBoundingClientRect().top;
  const nextDelta = node.getBoundingClientRect().top - viewportTop;
  const diff = nextDelta - Number(anchor.topDelta || 0);
  if (Number.isFinite(diff) && Math.abs(diff) > 0.5) {
    el.scrollTop += diff;
  }
  return true;
}

function trimRenderedMessages(channel = 'chat', direction = 'top', options = {}) {
  const state = getRenderState(channel);
  const el = getRenderContainer(channel);
  if (!el) return;
  if (state.virtualEnabled) return;
  const trimFromBottom = direction === 'bottom';
  const preserveKey = String(options?.preserveKey || '').trim();

  while (getRenderedMessageCount(channel) > state.max) {
    const nodes = getRenderedMessageNodes(channel);
    let removable = trimFromBottom ? nodes[nodes.length - 1] : nodes[0];
    if (!removable) break;

    if (preserveKey && String(removable.dataset.msgKey || '') === preserveKey && nodes.length > 1) {
      removable = trimFromBottom ? nodes[nodes.length - 2] : nodes[1];
    }
    if (!removable || (preserveKey && String(removable.dataset.msgKey || '') === preserveKey)) break;

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

  const anchor = captureRenderedScrollAnchor(channel);
  const prevTop = el.scrollTop;
  const frag = document.createDocumentFragment();

  keysToAdd.forEach(key => {
    if (getRenderedNodeByKey(channel, key)) return;
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

  trimRenderedMessages(channel, 'bottom', { preserveKey: anchor?.key || firstRenderedKey });
  primeDeferredChatImages(el);
  if (!restoreRenderedScrollAnchor(channel, anchor)) {
    el.scrollTop = prevTop;
  }
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
  const anchor = keepBottom ? null : captureRenderedScrollAnchor(channel);
  const frag = document.createDocumentFragment();
  keysToAdd.forEach(key => {
    if (getRenderedNodeByKey(channel, key)) return;
    const record = getStoredRecord(channel, key);
    const node = buildMessageNodeFromRecord(channel, record);
    if (!node) return;
    node.dataset.msgKey = key;
    state.map.set(key, node);
    frag.appendChild(node);
  });
  el.appendChild(frag);
  trimRenderedMessages(channel, 'top', { preserveKey: anchor?.key || '' });
  primeDeferredChatImages(el);
  if (keepBottom) requestAnimationFrame(() => scrollToBottom(el));
  else restoreRenderedScrollAnchor(channel, anchor);
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
  const anchor = (keepBottom || state.stickyToBottom) ? null : captureRenderedScrollAnchor(channel);
  const items = state.queue.splice(0, state.queue.length);

  items.forEach((item) => {
    const { node, key } = item;
    if (!node || !key) return;
    insertRenderedNodeInStoredOrder(channel, node, key);
  });

  removeDuplicateRenderedMessages(channel);
  trimRenderedMessages(channel, 'top', { preserveKey: anchor?.key || '' });
  primeDeferredChatImages(el);

  if (keepBottom || state.stickyToBottom) {
    state.pendingBottomNotice = 0;
    // 두 번 실행해서 레이아웃 안정화 후 정확한 scrollHeight 보장
    requestAnimationFrame(() => {
      scrollToBottom(el);
      requestAnimationFrame(() => {
        scrollToBottom(el);
        syncStickyState(channel, el);
      });
    });
  } else {
    state.pendingBottomNotice += items.length;
    restoreRenderedScrollAnchor(channel, anchor);
    syncStickyState(channel, el);
  }
}

function queueMessageRender(channel = 'chat', node, key = '', autoscroll = true) {
  const state = getRenderState(channel);
  const el = getRenderContainer(channel);
  if (!el || !node) return;
  const safeKey = String(key || node?.dataset?.msgKey || '').trim();
  if (safeKey) {
    node.dataset.msgKey = safeKey;
    const queuedIdx = state.queue.findIndex(item => item?.key === safeKey);
    if (queuedIdx >= 0) {
      state.queue[queuedIdx] = { node, key: safeKey };
    } else {
      state.queue.push({ node, key: safeKey });
    }
  } else {
    state.queue.push({ node, key: safeKey });
  }
  if (autoscroll) syncStickyState(channel, el);
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



/* ==========================================================================
 * CHAT SECTION: HISTORY PAGING AND CHANNEL ACTIVATION
 * 상단 스크롤 시 이전 채팅을 로드하고 채널 전환 시 렌더 상태를 재구성
 * ========================================================================== */

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


/* ==========================================================================
 * CHAT SECTION: IMAGE DISPLAY HELPERS
 * 채팅 이미지 class/style, 비율, placeholder 계산
 * ========================================================================== */

function getChatImageClassName(imageWide = false) {
  return imageWide ? 'msg-image is-wide' : 'msg-image';
}

function getChatImageInlineStyle(imageWide = false) {
  return imageWide ? 'width:100%;max-width:none;height:auto;object-fit:contain;' : '';
}


/* ==========================================================================
 * CHAT SECTION: DEFERRED IMAGE LOADING
 * IntersectionObserver 기반 lazy image 로딩과 깜빡임 방어
 * ========================================================================== */

const CHAT_IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
let _deferredChatImageObserver = null;

function normalizeChatImageMeta(imageMeta = null) {
  if (!imageMeta || typeof imageMeta !== 'object') return null;
  const width = Number(imageMeta.width || imageMeta.w || 0);
  const height = Number(imageMeta.height || imageMeta.h || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

function getChatImageShellStyle(imageWide = false, imageMeta = null) {
  const meta = normalizeChatImageMeta(imageMeta);
  const ratio = meta ? `${meta.width} / ${meta.height}` : (imageWide ? '16 / 9' : '4 / 3');
  return `aspect-ratio:${ratio};`;
}

function activateDeferredChatImage(img, force = false) {
  if (!(img instanceof HTMLImageElement)) return;
  if (img.dataset.chatLoaded === '1' && !force) return;
  const actualSrc = img.dataset.chatSrc || img.currentSrc || img.src || '';
  if (!actualSrc) return;
  const shell = img.closest('.msg-image-shell');
  const finalize = () => {
    if (shell) shell.classList.remove('is-loading');
    img.classList.add('is-ready');
  };
  if (shell) shell.classList.add('is-loading');
  img.dataset.chatLoaded = '1';
  img.addEventListener('load', finalize, { once: true });
  img.addEventListener('error', finalize, { once: true });
  img.src = actualSrc;
  if (img.complete) requestAnimationFrame(finalize);
}

function ensureDeferredChatImageObserver() {
  if (_deferredChatImageObserver || typeof IntersectionObserver === 'undefined') return _deferredChatImageObserver;
  _deferredChatImageObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      if (!(img instanceof HTMLImageElement)) return;
      activateDeferredChatImage(img);
      try { _deferredChatImageObserver.unobserve(img); } catch (e) {}
    });
  }, {
    root: null,
    rootMargin: '700px 0px',
    threshold: 0.01,
  });
  return _deferredChatImageObserver;
}

function primeDeferredChatImages(root = document) {
  const nodes = root instanceof HTMLElement
    ? root.querySelectorAll('img[data-chat-src]')
    : document.querySelectorAll('img[data-chat-src]');
  if (!nodes.length) return;
  const observer = ensureDeferredChatImageObserver();
  nodes.forEach((img) => {
    if (!(img instanceof HTMLImageElement)) return;
    if (!img.dataset.chatSrc) return;
    if (!observer) {
      activateDeferredChatImage(img, true);
      return;
    }
    observer.observe(img);
  });
}

function buildChatImageHtml(src, imageWide = false, imageMeta = null) {
  const meta = normalizeChatImageMeta(imageMeta);
  const extraSizeAttrs = meta ? ` width="${meta.width}" height="${meta.height}"` : '';
  const shellClass = imageWide ? 'msg-image-shell is-wide' : 'msg-image-shell';
  return `<div class="${shellClass}" style="${getChatImageShellStyle(imageWide, meta)}"><img class="${getChatImageClassName(imageWide)}" src="${CHAT_IMAGE_PLACEHOLDER}" data-chat-src="${esc(src)}" data-chat-loaded="0" alt="첨부 이미지" loading="lazy" decoding="async" fetchpriority="low"${extraSizeAttrs} style="${getChatImageInlineStyle(imageWide)}" onclick="openLightbox(this.dataset.chatSrc || this.currentSrc || this.src)"></div>`;
}

const _pendingChatImages = [];
let _pendingChatImageWide = false;
let _pendingChatImageHideMeta = false;
let _chatUploadStatusDepth = 0;


/* ==========================================================================
 * CHAT SECTION: IMAGE COMPOSER UI
 * 이미지 업로드 상태, pending queue, 프리뷰 순서/옵션 UI
 * ========================================================================== */

function ensureChatUploadStatusEl() {
  const composer = document.querySelector('.chat-composer-stack');
  if (!composer) return null;
  let statusEl = document.getElementById('chat-upload-status');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'chat-upload-status';
    statusEl.className = 'chat-upload-status';
    statusEl.style.display = 'none';
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.innerHTML = '<span class="chat-upload-status-spinner" aria-hidden="true"></span><span class="chat-upload-status-text">사진을 보내는 중입니다.</span>';
    composer.insertBefore(statusEl, composer.firstChild);
  } else if (statusEl.parentElement !== composer) {
    composer.insertBefore(statusEl, composer.firstChild);
  }
  return statusEl;
}

function showChatUploadStatus() {
  const statusEl = ensureChatUploadStatusEl();
  if (!statusEl) return;
  _chatUploadStatusDepth += 1;
  statusEl.style.display = 'flex';
  statusEl.classList.add('is-visible');
}

function hideChatUploadStatus(force = false) {
  const statusEl = document.getElementById('chat-upload-status');
  if (force) {
    _chatUploadStatusDepth = 0;
  } else if (_chatUploadStatusDepth > 0) {
    _chatUploadStatusDepth -= 1;
  }
  if (!statusEl) return;
  if (_chatUploadStatusDepth > 0) return;
  statusEl.classList.remove('is-visible');
  statusEl.style.display = 'none';
}
let _dragChatImageId = null;

function makePendingChatImageId() {
  return `pci_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getChatImageQueueEls() {
  return {
    wrap: document.getElementById('chat-image-queue'),
    list: document.getElementById('chat-image-preview-list'),
    wideToggle: document.getElementById('chat-image-wide-toggle'),
    hideMetaToggle: document.getElementById('chat-image-hide-meta-toggle'),
  };
}

function renderPendingChatImages() {
  const { wrap, list, wideToggle, hideMetaToggle } = getChatImageQueueEls();
  if (!wrap || !list) return;
  list.innerHTML = '';
  if (_pendingChatImages.length === 0) {
    wrap.style.display = 'none';
    if (wideToggle) wideToggle.checked = !!_pendingChatImageWide;
  if (hideMetaToggle) hideMetaToggle.checked = !!_pendingChatImageHideMeta;
    if (hideMetaToggle) hideMetaToggle.checked = !!_pendingChatImageHideMeta;
    return;
  }

  wrap.style.display = '';
  if (wideToggle) wideToggle.checked = !!_pendingChatImageWide;
  if (hideMetaToggle) hideMetaToggle.checked = !!_pendingChatImageHideMeta;

  _pendingChatImages.forEach((item, idx) => {
    const btn = document.createElement('div');
    btn.className = 'chat-image-preview-item';
    btn.draggable = true;
    btn.dataset.imageId = item.id;
    btn.innerHTML = `
      <img src="${esc(item.previewUrl)}" alt="첨부 이미지 ${idx + 1}">
      <span class="chat-image-preview-grab">↕</span>
      <span class="chat-image-preview-order">${idx + 1}</span>
      <button type="button" class="chat-image-preview-remove" title="첨부 취소">✕</button>
    `;
    const removeBtn = btn.querySelector('.chat-image-preview-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removePendingChatImage(item.id);
      });
    }
    btn.addEventListener('dragstart', () => {
      _dragChatImageId = item.id;
      btn.classList.add('dragging');
    });
    btn.addEventListener('dragend', () => {
      _dragChatImageId = null;
      btn.classList.remove('dragging');
      renderPendingChatImages();
    });
    btn.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      movePendingChatImage(_dragChatImageId, item.id);
    });
    list.appendChild(btn);
  });
}


function revokePreparedChatImagePreview(item) {
  if (!item || !item.previewUrl) return;
  if (item.previewKind === 'object-url') {
    try { URL.revokeObjectURL(item.previewUrl); } catch (e) {}
  }
}

function removePendingChatImage(imageId) {
  const idx = _pendingChatImages.findIndex(item => item.id === imageId);
  if (idx < 0) return;
  const [removed] = _pendingChatImages.splice(idx, 1);
  revokePreparedChatImagePreview(removed);
  renderPendingChatImages();
}

function movePendingChatImage(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const fromIdx = _pendingChatImages.findIndex(item => item.id === fromId);
  const toIdx = _pendingChatImages.findIndex(item => item.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = _pendingChatImages.splice(fromIdx, 1);
  _pendingChatImages.splice(toIdx, 0, moved);
  renderPendingChatImages();
}

function clearPendingChatImages() {
  _pendingChatImages.splice(0, _pendingChatImages.length).forEach(revokePreparedChatImagePreview);
  _pendingChatImageWide = false;
  _pendingChatImageHideMeta = false;
  renderPendingChatImages();
}

function togglePendingChatImageWide(checked) {
  _pendingChatImageWide = !!checked;
}

function togglePendingChatImageHideMeta(checked) {
  _pendingChatImageHideMeta = !!checked;
}


/* ==========================================================================
 * CHAT SECTION: IMAGE PREPARE AND ENCODE
 * 파일/캔버스/메타데이터 변환과 업로드용 Blob 생성
 * ========================================================================== */

function getCloudinaryRuntimeConfig() { return _itcGetCloudinaryConfig(); }

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result);
    reader.onerror = () => reject(new Error('이미지를 읽지 못했어요.'));
    reader.readAsDataURL(file);
  });
}

async function canvasToJpegBlob(canvas, quality = 0.84) {
  return _itcCanvasToBlob(canvas, 'image/jpeg', quality);
}

function isChatImageAlphaCapableMime(mime = '') {
  return /^image\/(png|webp)$/i.test(String(mime || '').trim());
}

function getChatImageUploadExtension(mime = '') {
  const safeMime = String(mime || '').toLowerCase();
  if (safeMime === 'image/png') return 'png';
  if (safeMime === 'image/webp') return 'webp';
  if (safeMime === 'image/gif') return 'gif';
  return 'jpg';
}

function makeChatImageUploadFileName(originalName = '', mime = 'image/jpeg') {
  const ext = getChatImageUploadExtension(mime);
  const fallbackBase = `chat_${Date.now()}`;
  const rawBase = String(originalName || fallbackBase).replace(/\.[^\/.]+$/, '').trim() || fallbackBase;
  return `${rawBase}.${ext}`;
}

async function canvasToChatImageBlob(canvas, mime = 'image/jpeg', quality = 0.84) {
  const safeMime = String(mime || '').toLowerCase();
  if (safeMime === 'image/png') {
    return _itcCanvasToBlob(canvas, 'image/png');
  }
  if (safeMime === 'image/webp') {
    try {
      return await _itcCanvasToBlob(canvas, 'image/webp', quality);
    } catch (err) {
      console.warn('webp 변환 실패: png로 대체합니다.', err);
      return _itcCanvasToBlob(canvas, 'image/png');
    }
  }
  return canvasToJpegBlob(canvas, quality);
}

function makePreparedChatImageBase(meta = {}) {
  return {
    id: makePendingChatImageId(),
    previewUrl: meta.previewUrl || '',
    previewKind: meta.previewKind || 'data-url',
    dataUrl: meta.dataUrl || '',
    uploadBlob: meta.uploadBlob || null,
    uploadMime: meta.uploadMime || '',
    uploadFileName: meta.uploadFileName || '',
    isGif: !!meta.isGif,
    width: meta.width || 0,
    height: meta.height || 0,
  };
}

async function fileToPreparedChatImage(file) {
  const isGif = file.type === 'image/gif';
  const maxSize = isGif ? 5 * 1024 * 1024 : 3 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error(isGif ? 'GIF는 5MB 이하만 가능해요.' : '이미지는 3MB 이하만 가능해요.');
  }

  const objectUrl = URL.createObjectURL(file);
  const rawMeta = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.width || 0, height: img.height || 0 });
      try { URL.revokeObjectURL(objectUrl); } catch (e) {}
    };
    img.onerror = () => {
      try { URL.revokeObjectURL(objectUrl); } catch (e) {}
      reject(new Error('이미지 처리에 실패했어요.'));
    };
    img.src = objectUrl;
  });

  if (isGif) {
    return makePreparedChatImageBase({
      previewUrl: URL.createObjectURL(file),
      previewKind: 'object-url',
      uploadBlob: file,
      uploadMime: file.type || 'image/gif',
      uploadFileName: file.name || `chat_${Date.now()}.gif`,
      isGif: true,
      width: rawMeta.width,
      height: rawMeta.height,
    });
  }

  const maxEdge = 1280;
  const fileMime = String(file.type || '').toLowerCase();
  const alphaCapable = isChatImageAlphaCapableMime(fileMime);
  const needsResize = rawMeta.width > maxEdge || rawMeta.height > maxEdge;
  const needsTransform = needsResize || (!alphaCapable && (fileMime !== 'image/jpeg' || file.size > 900 * 1024));

  if (!needsTransform) {
    const uploadMime = fileMime || 'image/jpeg';
    return makePreparedChatImageBase({
      previewUrl: URL.createObjectURL(file),
      previewKind: 'object-url',
      uploadBlob: file,
      uploadMime,
      uploadFileName: file.name || makeChatImageUploadFileName('', uploadMime),
      isGif: false,
      width: rawMeta.width,
      height: rawMeta.height,
    });
  }

  const dataUrl = await fileToDataUrl(file);
  const outputMime = alphaCapable ? fileMime : 'image/jpeg';
  const compressed = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      try {
        let w = img.width;
        let h = img.height;
        if (w > maxEdge || h > maxEdge) {
          const ratio = Math.min(maxEdge / w, maxEdge / h);
          w = Math.max(1, Math.round(w * ratio));
          h = Math.max(1, Math.round(h * ratio));
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('이미지 처리에 실패했어요.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const blob = await canvasToChatImageBlob(canvas, outputMime, 0.84);
        resolve({
          blob,
          mime: blob.type || outputMime,
          width: w,
          height: h,
          previewUrl: URL.createObjectURL(blob),
        });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('이미지 처리에 실패했어요.'));
    img.src = dataUrl;
  });

  const uploadMime = compressed.mime || compressed.blob?.type || outputMime || 'image/jpeg';
  return makePreparedChatImageBase({
    previewUrl: compressed.previewUrl,
    previewKind: 'object-url',
    dataUrl,
    uploadBlob: compressed.blob,
    uploadMime,
    uploadFileName: makeChatImageUploadFileName(file.name, uploadMime),
    isGif: false,
    width: compressed.width || rawMeta.width || 0,
    height: compressed.height || rawMeta.height || 0,
  });
}

async function queuePendingChatImages(files) {
  const incoming = Array.from(files || []).filter(Boolean);
  if (!incoming.length) return;
  const roomLeft = Math.max(0, 4 - _pendingChatImages.length);
  if (roomLeft <= 0) {
    showToast('이미지는 한 번에 최대 4장까지 첨부할 수 있어요.');
    return;
  }

  const picked = incoming.slice(0, roomLeft);
  if (incoming.length > roomLeft) {
    showToast('이미지는 한 번에 최대 4장까지 첨부할 수 있어요.');
  }

  for (const file of picked) {
    try {
      const prepared = await fileToPreparedChatImage(file);
      _pendingChatImages.push(prepared);
    } catch (err) {
      console.error('queuePendingChatImages failed', err);
      showToast(err?.message || '이미지를 첨부하지 못했어요.');
    }
  }
  renderPendingChatImages();
}


/* ==========================================================================
 * CHAT SECTION: IMAGE UPLOAD TRANSPORT
 * Cloudinary/Storage 업로드 경로와 timeout 보조 함수
 * ========================================================================== */

function withTimeout(promise, ms = 3500) { return _itcWithTimeout(promise, ms); }

async function getStorageApiQuick() {
  const fb = window._FB;
  if (!fb?.CONFIGURED || typeof fb.ensureStorage !== 'function') return null;
  try {
    return await withTimeout(fb.ensureStorage(), 2200);
  } catch (err) {
    console.warn('storage api unavailable', err);
    return null;
  }
}

function inferStorageContentTypeFromDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;,]+)[;,]/i);
  return m ? m[1].toLowerCase() : 'image/jpeg';
}

function blobFromDataUrl(dataUrl) {
  const parts = String(dataUrl || '').split(',');
  if (parts.length < 2) throw new Error('이미지 데이터 형식이 올바르지 않아요.');
  const contentType = inferStorageContentTypeFromDataUrl(dataUrl);
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: contentType }), contentType };
}

async function uploadChatImageBlobToCloudinary(blob, fileName = 'chat.jpg') {
  if (!_itcGetCloudinaryConfig() || !blob) return null;
  const result = await _itcUploadToCloudinary({ blob, fileName, timeout: 20000 });
  return { url: result.url, path: result.publicId, contentType: result.contentType };
}

async function uploadChatImageDataUrl(dataUrl, roomCode, preparedItem = null) {
  const uploadBlob = preparedItem?.uploadBlob || null;
  const uploadFileName = preparedItem?.uploadFileName || '';
  const blobInfo = uploadBlob
    ? { blob: uploadBlob, contentType: preparedItem?.uploadMime || uploadBlob.type || 'image/jpeg' }
    : blobFromDataUrl(dataUrl);

  const uploadedCloudinary = await uploadChatImageBlobToCloudinary(blobInfo.blob, uploadFileName || `chat_${Date.now()}.jpg`);
  if (!uploadedCloudinary?.url) return null;

  return {
    url: uploadedCloudinary.url,
    path: uploadedCloudinary.path || '',
    contentType: uploadedCloudinary.contentType || blobInfo.contentType || 'image/jpeg',
  };
}

/* ==========================================================================
 * CHAT SECTION: IMAGE SEND AND INIT
 * 준비된 이미지 메시지 전송, pending queue 전송, composer 바인딩
 * ========================================================================== */

async function sendPreparedChatImage(preparedOrDataUrl, imageWide = false, imageMeta = null, hideImageMeta = false) {
  const saJId = St.speakAsJournalId;
  const saJournal = saJId ? loadJournals().find(x => x.id === saJId) : null;
  const saName = saJournal ? (saJournal.title || '무제') : null;
  const saAvatar = saJId ? saGetAvatar(saJId) : null;
  const normalizedMeta = normalizeChatImageMeta(imageMeta);

  const prepared = (preparedOrDataUrl && typeof preparedOrDataUrl === 'object' && ('dataUrl' in preparedOrDataUrl || 'uploadBlob' in preparedOrDataUrl))
    ? preparedOrDataUrl
    : { dataUrl: String(preparedOrDataUrl || '') };
  const dataUrl = prepared.dataUrl || '';
  let finalSrc = '';
  let storageMeta = null;

  if (!St.roomCode) {
    throw new Error('이미지 업로드를 위한 방 정보가 없어요.');
  }

  const uploaded = await uploadChatImageDataUrl(dataUrl, St.roomCode, prepared);
  if (!uploaded?.url) {
    throw new Error('이미지 업로드에 실패했어요. 다시 시도해 주세요.');
  }
  finalSrc = uploaded.url;
  storageMeta = uploaded;

  if (saJournal) {
    const msg = {
      name: saName,
      text: finalSrc,
      type: 'speak-as-image',
      uid: St.myId,
      time: Date.now(),
      speakAsAvatar: saAvatar,
      speakAsJournalId: saJId,
      nameColor: (typeof saGetJournalNameColor === 'function' ? saGetJournalNameColor(saJId, saJournal) : (saJournal.nameColor || saJournal.sheet?.nameColor || '')),
      imageWide: !!imageWide,
      hideImageMeta: !!hideImageMeta,
      imageMeta: normalizedMeta,
      imageStoragePath: storageMeta?.path || '',
      imageContentType: storageMeta?.contentType || inferStorageContentTypeFromDataUrl(dataUrl),
    };
    const currentChannelKey = String(window._itcActiveChatChannelKey || (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global') || 'global').trim() || 'global';
    if (window._FB?.CONFIGURED) {
      const { db, ref, push } = window._FB;
      if (!St.roomCode) throw new Error('roomCode missing');
      const payload = { ...msg, dmChannelKey: currentChannelKey || 'global', time: getChatServerTimestamp() };
    return push(ref(db, `rooms/${St.roomCode}/chat`), payload)
      .then((pushedRef) => notifyDmMetaAfterChatPush(currentChannelKey, payload, pushedRef));
    }
    appendChatMsg({ name: msg.name, text: finalSrc, type: 'speak-as-image', uid: St.myId, timestamp: msg.time, speakAsAvatar: saAvatar, speakAsJournalId: saJId, nameColor: msg.nameColor || '', channel: 'chat', imageWide: !!imageWide, imageMeta: normalizedMeta, hideImageMeta: !!hideImageMeta });
    return Promise.resolve();
  }

  return sendMessage(St.myName, finalSrc, 'image', {
    imageWide: !!imageWide,
    hideImageMeta: !!hideImageMeta,
    imageMeta: normalizedMeta,
    imageStoragePath: storageMeta?.path || '',
    imageContentType: storageMeta?.contentType || inferStorageContentTypeFromDataUrl(dataUrl),
  });
}

async function sendPendingChatImages() {
  if (_activeRightTab === 'casual') {
    showToast('이미지 첨부는 메인 채팅에서만 보낼 수 있어요.');
    return false;
  }
  if (!_pendingChatImages.length) return true;
  const items = _pendingChatImages.splice(0, _pendingChatImages.length);
  renderPendingChatImages();
  showChatUploadStatus();
  try {
    for (const item of items) {
      await sendPreparedChatImage(item, _pendingChatImageWide, { width: item.width, height: item.height }, _pendingChatImageHideMeta);
      revokePreparedChatImagePreview(item);
    }
    _pendingChatImageWide = false;
    _pendingChatImageHideMeta = false;
    renderPendingChatImages();
    return true;
  } catch (err) {
    console.error('sendPendingChatImages failed', err);
    items.reverse().forEach(item => _pendingChatImages.unshift(item));
    renderPendingChatImages();
    showToast(err?.message || '이미지 업로드에 실패했어요. 잠시 후 다시 시도해 주세요.');
    throw err;
  } finally {
    hideChatUploadStatus();
  }
}

function initChatImageComposer() {
  ensureChatUploadStatusEl();
  renderPendingChatImages();
  bindMessageViewport('chat');
  bindMessageViewport('casual');
}



/* ==========================================================================
 * CHAT SECTION: MAIN SEND DISPATCH
 * 입력값/이미지/desc/귓말/주사위/저널 speak-as 분기 처리
 * ========================================================================== */

async function sendChat() {
  const inp = document.getElementById('chat-input');
  if (!inp) return;
  getChatInputGuard();
  const raw = inp.value.trim();
  const hasImages = _pendingChatImages.length > 0;
  const currentChannelKey = String(window._itcActiveChatChannelKey || (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global') || 'global').trim() || 'global';
  if (!raw && !hasImages) return;

  if (raw && !hasImages && shouldSuppressChatSubmit(raw, currentChannelKey)) {
    inp.value = '';
    try { clearTypingState(); } catch (e) {}
    return;
  }

  let imeGuardMarked = false;
  const restoreInput = () => {
    try { inp.value = raw; inp.focus(); } catch (e) {}
  };

  try {
    clearTypingState();
    if (raw && !hasImages) {
      markChatSubmitForImeGuard(raw, currentChannelKey);
      imeGuardMarked = true;
    }

    if (hasImages && _activeRightTab === 'casual') {
      showToast('이미지 첨부는 메인 채팅에서만 보낼 수 있어요.');
      return;
    }

    if (St.descMode && hasPerm('sendDesc')) {
      if (hasImages) {
        showToast('desc 모드에서는 이미지를 함께 보낼 수 없어요.');
        return;
      }
      inp.value = '';
      await sendMessage(St.myName, raw, 'desc');
      return;
    }

    const m = raw.match(/^\/desc\s*([\s\S]*)$/i);
    if (m) {
      if (hasImages) {
        showToast('desc 명령어와 이미지는 함께 보낼 수 없어요.');
        return;
      }
      if (!hasPerm('sendDesc')) { showToast('desc 입력 권한이 없어요.'); return; }
      const content = m[1].trim();
      if (!content) return;
      inp.value = '';
      await sendMessage(St.myName, content, 'desc');
      return;
    }

    const wm = raw.match(/^\/w\s+(\S+)\s+([\s\S]+)$/i);
    if (wm) {
      if (hasImages) {
        showToast('귓말과 이미지는 함께 보낼 수 없어요.');
        return;
      }
      const targetName = wm[1];
      const whisperText = wm[2].trim();
      if (!whisperText) return;
      const players = St.players || {};
      const target = Object.entries(players).find(([id, p]) => p.name === targetName);
      if (target) {
        inp.value = '';
        await sendWhisperMessage(St.myName, whisperText, target[0], targetName, { channelKey: currentChannelKey, speakAsJournalId: St.speakAsJournalId || null });
        return;
      }
      const jTarget = _allJournals.find(j => (j.title || '') === targetName);
      if (jTarget && jTarget.ownerId) {
        inp.value = '';
        const senderName = St.speakAsJournalId ? (loadJournals().find(x=>x.id===St.speakAsJournalId)?.title||St.myName) : St.myName;
        await sendWhisperMessage(senderName, whisperText, jTarget.ownerId, targetName, { channelKey: currentChannelKey, targetJournalId: jTarget.id || null, speakAsJournalId: St.speakAsJournalId || null });
        return;
      }
      showToast(`'${targetName}' 대상을 찾을 수 없어요.`);
      return;
    }

    const cm = raw.match(/^\/choice\s*[\(\（](.+)[\)\）]$/i);
    if (cm) {
      if (hasImages) {
        showToast('choice 명령어와 이미지는 함께 보낼 수 없어요.');
        return;
      }
      const options = cm[1].split(',').map(s => s.trim()).filter(Boolean);
      if (options.length < 2) { showToast('선택지를 2개 이상 입력해주세요.'); return; }
      const picked = options[Math.floor(Math.random() * options.length)];
      const senderName = St.speakAsJournalId ? (loadJournals().find(x=>x.id===St.speakAsJournalId)?.title || St.myName) : St.myName;
      inp.value = '';
      await sendMessage(senderName, `🎯 Choice [${options.join(', ')}] → ${picked}`, 'normal');
      return;
    }

    const dm = raw.match(/^\/(\d*d\d+.*)$/i);
    if (dm) {
      if (hasImages) {
        showToast('다이스 명령어와 이미지는 함께 보낼 수 없어요.');
        return;
      }
      inp.value = '';
      rollFromFormula(dm[1].trim());
      return;
    }

    if (St.whisperTo) {
      if (hasImages) {
        showToast('귓말 상태에서는 이미지를 함께 보낼 수 없어요.');
        return;
      }
      const senderName = St.speakAsJournalId ? (loadJournals().find(x=>x.id===St.speakAsJournalId)?.title || St.myName) : St.myName;
      inp.value = '';
      await sendWhisperMessage(senderName, raw, St.whisperTo, St.whisperToName, { channelKey: currentChannelKey, targetJournalId: St.whisperToJournal || null, speakAsJournalId: St.speakAsJournalId || null });
      return;
    }

    inp.value = '';
    if (raw) {
      if (_activeRightTab === 'casual') {
        await sendCasualMsg(_casualNickname || St.myName, raw);
      } else if (St.speakAsJournalId) {
        const j = loadJournals().find(x => x.id === St.speakAsJournalId);
        if (j) {
          if (typeof saSendMessage === 'function') {
            await saSendMessage(j, raw);
          }
        } else {
          St.speakAsJournalId = null;
          if (typeof saRefreshBtn === 'function') saRefreshBtn();
          await sendMessage(St.myName, raw, 'normal');
        }
      } else {
        await sendMessage(St.myName, raw, 'normal');
      }
    }

    if (hasImages) {
      await sendPendingChatImages();
    }
  } catch (err) {
    console.error('sendChat failed', err);
    if (imeGuardMarked) cancelChatSubmitForImeGuard(raw, currentChannelKey);
    restoreInput();
    showToast('메시지 전송에 실패했어요. 다시 시도해주세요.');
  }
}


/* ==========================================================================
 * CHAT SECTION: FIREBASE MESSAGE PUSH AND DM META
 * 실제 메시지 push와 DM latestAt meta 갱신
 * ========================================================================== */

function notifyDmMetaAfterChatPush(channelKey = 'global', message = {}, pushedRef = null) {
  const safeKey = String(channelKey || message?.dmChannelKey || 'global').trim() || 'global';
  if (!safeKey || safeKey === 'global') return Promise.resolve(pushedRef);
  try {
    if (typeof window.touchDmChannelMetaForMessage === 'function') {
      return Promise.resolve(window.touchDmChannelMetaForMessage(safeKey, message, pushedRef?.key || ''))
        .catch(() => {})
        .then(() => pushedRef);
    }
  } catch (e) {}
  return Promise.resolve(pushedRef);
}

function sendMessage(name, text, type = 'normal', extra = null) {
  const localTime = Date.now();
  const msg = { name, text, type, uid: St.myId, time: localTime };
  if (St.myNameColor) msg.nameColor = St.myNameColor;
  if (extra && typeof extra === 'object') Object.assign(msg, extra);
  const currentChannelKey = String(window._itcActiveChatChannelKey || (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global') || 'global').trim() || 'global';
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    if (!St.roomCode) return Promise.reject(new Error('roomCode missing'));
    const payload = { ...msg, dmChannelKey: currentChannelKey || 'global', time: getChatServerTimestamp() };
    return push(ref(db, `rooms/${St.roomCode}/chat`), payload)
      .then((pushedRef) => notifyDmMetaAfterChatPush(currentChannelKey, payload, pushedRef));
  }
  appendChatMsg({ ...msg, timestamp: msg.time, nameColor: msg.nameColor || null, channel: 'chat', imageWide: !!msg.imageWide, imageMeta: msg.imageMeta || null, hideImageMeta: !!msg.hideImageMeta });
  return Promise.resolve();
}


/* ==========================================================================
 * CHAT SECTION: CASUAL TAB SEND AND PROFILE STATE
 * 잡담탭 전송, 닉네임, 이름색 저장/동기화
 * ========================================================================== */

function sendCasual() {
  const inp = document.getElementById('chat-input');
  const raw = inp.value.trim();
  if (!raw) return;
  inp.value = '';
  sendCasualMsg(St.myName, raw);
}

function sendCasualMsg(name, text) {
  const localTime = Date.now();
  const msg = { name, text, uid: St.myId, time: localTime };
  if (St.casualNameColor) msg.nameColor = St.casualNameColor;
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    if (!St.roomCode) return Promise.reject(new Error('roomCode missing'));
    return push(ref(db, `rooms/${St.roomCode}/casual`), { ...msg, time: getChatServerTimestamp() });
  }
  appendCasualMsg(name, text, St.myId, msg.time, null, St.casualNameColor || '');
  return Promise.resolve();
}

function refreshCasualNickDisplay() {
  const el = document.getElementById('casual-nick-name');
  if (el) {
    el.textContent = _casualNickname || St.myName;
    el.style.color = St.casualNameColor || '';
  }
  const avEl = document.getElementById('casual-nick-avatar');
  if (avEl) {
    const avSrc = localStorage.getItem('itc_avatar_' + St.myId) || '';
    if (avSrc) {
      avEl.innerHTML = `<img src="${avSrc}" alt="">`;
    } else {
      avEl.textContent = ((_casualNickname || St.myName || '?')[0] || '?').toUpperCase();
    }
  }
}

function editCasualNick() {
  const current = _casualNickname || St.myName;
  const newNick = prompt('잡담 닉네임을 입력하세요 (18자 이내)', current);
  if (newNick === null) return;
  const trimmed = newNick.trim().slice(0, 18);
  if (!trimmed) { showToast('닉네임을 입력해주세요.'); return; }
  _casualNickname = trimmed;
  try { localStorage.setItem('itc_casual_nick_' + St.myId, trimmed); } catch(e) {}
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, update } = window._FB;
    update(ref(db, `rooms/${St.roomCode}/players/${St.myId}`), { casualNick: trimmed });
  }
  refreshCasualNickDisplay();
}

function loadCasualNick() {
  try { _casualNickname = localStorage.getItem('itc_casual_nick_' + St.myId) || ''; } catch(e) {}
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, get } = window._FB;
    get(ref(db, `rooms/${St.roomCode}/players/${St.myId}/casualNick`)).then(snap => {
      const val = snap.val();
      if (val) {
        _casualNickname = val;
        try { localStorage.setItem('itc_casual_nick_' + St.myId, val); } catch(e) {}
        refreshCasualNickDisplay();
      }
    }).catch(() => {});
  }
}

function loadCasualNameColor() {
  try { St.casualNameColor = localStorage.getItem('itc_casual_name_color') || ''; } catch(e) {}
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, get } = window._FB;
    get(ref(db, `rooms/${St.roomCode}/players/${St.myId}/casualNameColor`)).then(snap => {
      const val = snap.val();
      if (val) {
        St.casualNameColor = val;
        try { localStorage.setItem('itc_casual_name_color', val); } catch(e) {}
        refreshCasualNickDisplay();
      }
    }).catch(() => {});
  }
}

function loadMyNameColor() {
  try { St.myNameColor = localStorage.getItem('itc_name_color_' + St.myId) || ''; } catch(e) {}
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, get } = window._FB;
    get(ref(db, `rooms/${St.roomCode}/players/${St.myId}/nameColor`)).then(snap => {
      const val = snap.val();
      if (val) {
        St.myNameColor = val;
        try { localStorage.setItem('itc_name_color_' + St.myId, val); } catch(e) {}
      }
    }).catch(() => {});
  }
}

let _typingTimer = null;
let _lastTypingBroadcast = 0;
let _lastTypingRoomCode = '';
let _lastTypingUid = '';

/* ==========================================================================
 * CHAT SECTION: TYPING INDICATOR
 * typing 상태 broadcast, indicator 렌더링, timeout cleanup
 * ========================================================================== */

function broadcastTyping() {
  if (!window._FB?.CONFIGURED || !St.roomCode || !St.myId) return;
  const now = Date.now();
  if (now - _lastTypingBroadcast < 1500) return;
  _lastTypingBroadcast = now;
  const { db, ref, set, remove } = window._FB;
  const roomCode = String(St.roomCode || '').trim();
  const uid = String(St.myId || '').trim();
  if (!roomCode || !uid) return;
  const tab = _activeRightTab === 'casual' ? 'casual' : 'chat';
  let displayName = St.myName;
  if (tab === 'chat' && St.speakAsJournalId) {
    const j = loadJournals().find(x => x.id === St.speakAsJournalId);
    if (j) displayName = j.title || St.myName;
  } else if (tab === 'casual' && _casualNickname) {
    displayName = _casualNickname;
  }
  _lastTypingRoomCode = roomCode;
  _lastTypingUid = uid;
  set(ref(db, `rooms/${roomCode}/typing/${uid}`), { name: displayName, tab, time: getChatServerTimestamp() });
  if (_typingTimer) clearTimeout(_typingTimer);
  _typingTimer = setTimeout(() => {
    remove(ref(db, `rooms/${roomCode}/typing/${uid}`)).catch(() => {});
    if (_lastTypingRoomCode === roomCode && _lastTypingUid === uid) {
      _lastTypingRoomCode = '';
      _lastTypingUid = '';
    }
    _typingTimer = null;
  }, 3000);
}

function renderTypingIndicator(elId, typingData, tab) {
  const el = document.getElementById(elId);
  if (!el) return;
  const now = Date.now();
  const names = [];
  Object.entries(typingData).forEach(([uid, data]) => {
    if (uid === St.myId) return;
    if (data.tab !== tab) return;
    if (now - (data.time || 0) > 5000) return;
    names.push(data.name || '누군가');
  });
  if (names.length === 0) { el.textContent = ''; return; }
  if (names.length === 1) el.textContent = `${names[0]} is typing...`;
  else if (names.length === 2) el.textContent = `${names[0]}, ${names[1]} are typing...`;
  else el.textContent = `${names.length}명이 입력 중...`;
}

function clearTypingState(roomCodeOverride = '', uidOverride = '') {
  if (_typingTimer) { clearTimeout(_typingTimer); _typingTimer = null; }
  _lastTypingBroadcast = 0;
  const roomCode = String(roomCodeOverride || St.roomCode || _lastTypingRoomCode || '').trim();
  const uid = String(uidOverride || St.myId || _lastTypingUid || '').trim();
  _lastTypingRoomCode = '';
  _lastTypingUid = '';
  if (!window._FB?.CONFIGURED || !roomCode || !uid) return Promise.resolve();
  const { db, ref, remove } = window._FB;
  return remove(ref(db, `rooms/${roomCode}/typing/${uid}`)).catch(() => {});
}


/* ==========================================================================
 * CHAT SECTION: MESSAGE ACTIONS
 * PC 수정/삭제 버튼, 모바일 long-press 액션 시트, 메시지 수정/삭제, 텍스트 포맷팅
 * ========================================================================== */

function addMsgActions(div, uid, msgKey, channel, text, type) {
  if (!msgKey) return;
  if (type === 'system' || type === 'sys') return;
  const isMine = uid === St.myId;
  const isGM = St.isGM;
  if (!isMine && !isGM) return;
  div.dataset.msgKey = msgKey;
  div.dataset.channel = channel;
  div.dataset.msgText = text;
  const wrap = document.createElement('div');
  wrap.className = 'msg-actions';
  const canEdit = type !== 'dice' && type !== 'image' && type !== 'speak-as-image';
  const canMobileEdit = !!(canEdit && isMine);
  div.dataset.mobileCanEdit = canMobileEdit ? '1' : '0';
  div.dataset.mobileCanDelete = '1';
  if (canMobileEdit) {
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-act-btn';
    editBtn.textContent = '수정';
    editBtn.onclick = (e) => { e.stopPropagation(); editMsg(div); };
    wrap.appendChild(editBtn);
  }
  const delBtn = document.createElement('button');
  delBtn.className = 'msg-act-btn danger';
  delBtn.textContent = '삭제';
  delBtn.onclick = (e) => { e.stopPropagation(); deleteMsg(div); };
  wrap.appendChild(delBtn);
  div.appendChild(wrap);
  bindMobileMsgActions(div);
}

function isMobileMsgActionMode() {
  try {
    return window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch (e) {
    return false;
  }
}

function getTouchPoint(e) {
  const t = e?.touches?.[0] || e?.changedTouches?.[0] || e;
  return { x: Number(t?.clientX || 0), y: Number(t?.clientY || 0) };
}

function bindMobileMsgActions(div) {
  if (!div || div.dataset.mobileActionBound === '1') return;
  div.dataset.mobileActionBound = '1';

  let longPressTimer = 0;
  let startX = 0;
  let startY = 0;
  let moved = false;

  const clearLongPress = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = 0;
    }
  };

  const isIgnoredTarget = (target) => {
    if (!target) return false;
    return !!target.closest?.('button, input, textarea, select, a, .msg-actions, .msg-mobile-action-sheet, .msg-text.editing');
  };

  div.addEventListener('touchstart', (e) => {
    if (!isMobileMsgActionMode()) return;
    if (isIgnoredTarget(e.target)) return;
    clearLongPress();
    const pt = getTouchPoint(e);
    startX = pt.x;
    startY = pt.y;
    moved = false;
    longPressTimer = setTimeout(() => {
      longPressTimer = 0;
      if (moved || !div.isConnected) return;
      openMobileMsgActionSheet(div);
    }, 560);
  }, { passive: true });

  div.addEventListener('touchmove', (e) => {
    if (!longPressTimer) return;
    const pt = getTouchPoint(e);
    if (Math.abs(pt.x - startX) > 12 || Math.abs(pt.y - startY) > 12) {
      moved = true;
      clearLongPress();
    }
  }, { passive: true });

  div.addEventListener('touchend', clearLongPress, { passive: true });
  div.addEventListener('touchcancel', clearLongPress, { passive: true });

  div.addEventListener('contextmenu', (e) => {
    if (!isMobileMsgActionMode()) return;
    if (isIgnoredTarget(e.target)) return;
    e.preventDefault();
    clearLongPress();
    openMobileMsgActionSheet(div);
  });
}

function closeMobileMsgActionSheet() {
  const layer = document.getElementById('msg-mobile-action-layer');
  if (layer) layer.remove();
}

function openMobileMsgActionSheet(div) {
  if (!div || !div.isConnected || !isMobileMsgActionMode()) return;
  const canEdit = div.dataset.mobileCanEdit === '1';
  const canDelete = div.dataset.mobileCanDelete === '1';
  if (!canEdit && !canDelete) return;

  closeMobileMsgActionSheet();

  const layer = document.createElement('div');
  layer.id = 'msg-mobile-action-layer';
  layer.className = 'msg-mobile-action-layer';
  layer.innerHTML = `
    <div class="msg-mobile-action-backdrop" data-close="1"></div>
    <div class="msg-mobile-action-sheet" role="dialog" aria-modal="true" aria-label="채팅 메시지 작업">
      <div class="msg-mobile-action-title">메시지 작업</div>
      <div class="msg-mobile-action-list"></div>
      <button type="button" class="msg-mobile-action-btn muted" data-close="1">닫기</button>
    </div>
  `;

  const list = layer.querySelector('.msg-mobile-action-list');
  if (canEdit) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'msg-mobile-action-btn';
    editBtn.textContent = '수정';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMobileMsgActionSheet();
      editMsg(div);
    });
    list.appendChild(editBtn);
  }

  if (canDelete) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'msg-mobile-action-btn danger';
    delBtn.textContent = '삭제';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMobileMsgActionSheet();
      deleteMsg(div);
    });
    list.appendChild(delBtn);
  }

  layer.addEventListener('click', (e) => {
    if (e.target?.dataset?.close === '1') closeMobileMsgActionSheet();
  });
  document.body.appendChild(layer);
}

function editMsg(div) {
  const key = div.dataset.msgKey;
  const channel = div.dataset.channel || 'chat';
  const oldText = div.dataset.msgText || '';
  const textEl = div.querySelector('.msg-text');
  if (!textEl || textEl.contentEditable === 'true') return;

  textEl.textContent = oldText;
  textEl.contentEditable = 'true';
  textEl.classList.add('editing');
  textEl.focus();

  const range = document.createRange();
  range.selectNodeContents(textEl);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function finishEdit() {
    textEl.contentEditable = 'false';
    textEl.classList.remove('editing');
    const newText = textEl.textContent.trim();
    if (!newText) { textEl.innerHTML = fmtText(oldText); showToast('빈 메시지는 입력할 수 없어요.'); return; }
    if (newText === oldText) { textEl.innerHTML = fmtText(oldText); return; }
    div.dataset.msgText = newText;
    textEl.innerHTML = fmtText(newText);
    if (window._FB?.CONFIGURED) {
      const { db, ref, update } = window._FB;
      update(ref(db, `rooms/${St.roomCode}/${channel}/${key}`), { text: newText, edited: true });
    }
  }

  textEl.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEdit(); }
    if (e.key === 'Escape') { textEl.innerHTML = fmtText(oldText); textEl.contentEditable = 'false'; textEl.classList.remove('editing'); }
  };
  textEl.onblur = () => finishEdit();
}

async function deleteMsg(div) {
  const key = String(div?.dataset?.msgKey || '').trim();
  const channel = String(div?.dataset?.channel || 'chat').trim() || 'chat';
  if (!key) return;
  if (!confirm('이 메시지를 삭제할까요?')) return;
  const actionButtons = Array.from(div.querySelectorAll('.msg-act-btn'));
  actionButtons.forEach((btn) => { btn.disabled = true; });

  try {
    if (window._FB?.CONFIGURED) {
      const { db, ref, remove } = window._FB;
      if (!db || !ref || typeof remove !== 'function') throw new Error('Firebase remove helper missing');
      if (!St.roomCode) throw new Error('roomCode missing');
      await remove(ref(db, `rooms/${St.roomCode}/${channel}/${key}`));

      if (channel === 'chat') {
        const activeDmKey = String(window._itcActiveChatChannelKey || '').trim();
        if (activeDmKey && activeDmKey !== 'global') {
          try { await remove(ref(db, `rooms/${St.roomCode}/dmMessageIndex/${activeDmKey}/${key}`)); } catch (e) {}
          try { await remove(ref(db, `rooms/${St.roomCode}/dmChats/${activeDmKey}/messages/${key}`)); } catch (e) {}
        }
      }
    }

    if (channel === 'casual' && typeof removeCasualMsg === 'function') removeCasualMsg(key);
    else if (typeof removeChatMsg === 'function') removeChatMsg(key, channel);
  } catch (err) {
    console.error('deleteMsg failed', err);
    showToast('메시지 삭제에 실패했어요. 새로고침 후 다시 시도해주세요.');
    actionButtons.forEach((btn) => { btn.disabled = false; });
  }
}

function fmtText(str) {
  let s = esc(str);
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/\*(.+?)\*/g, '<i>$1</i>');
  s = s.replace(/\n/g, '<br>');
  return s;
}
/* ==========================================================================
 * CHAT SECTION: CASUAL TAB RENDERING
 * 잡담 메시지 DOM 생성/append/replace/remove
 * ========================================================================== */

function saSendCasual(journal, text) {
  const name = journal.title || '무제';
  const avatar = saGetAvatar(journal.id);
  const localTime = Date.now();
  const msg = { name, text: text.replace(/@\S+/g,'').trim(), uid: St.myId, time: localTime, speakAsAvatar: avatar, speakAsJournalId: journal.id };
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    push(ref(db, `rooms/${St.roomCode}/casual`), { ...msg, time: getChatServerTimestamp() });
  } else {
    appendCasualMsg(name, msg.text, St.myId, msg.time);
  }
}

function buildCasualMsgElement(name, text, uid, timestamp, msgKey, nameColor) {
  const d = timestamp ? new Date(timestamp) : new Date();
  const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  const avatarHtml = getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));
  const colorStyle = nameColor ? ` style="color:${esc(nameColor)}"` : '';
  const div = document.createElement('div');
  div.className = 'chat-msg msg-normal';
  div.dataset.avatarUid = uid || '';
  div.dataset.avatarName = name || '';
  div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${colorStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
  addMsgActions(div, uid, msgKey, 'casual', text, 'normal');
  return div;
}

function appendCasualMsg(name, text, uid, timestamp, msgKey, nameColor) {
  const safeKey = upsertStoredMessage('casual', msgKey, { name, text, uid, timestamp, nameColor });
  bindMessageViewport('casual');
  const div = buildCasualMsgElement(name, text, uid, timestamp, safeKey, nameColor);
  queueMessageRender('casual', div, safeKey, true);
  if (typeof _popoutWins !== 'undefined') {
    const av = getPopoutAvatarUrl(name, uid);
    const renderedTime = div.querySelector('.msg-time')?.textContent || '';
    _popoutWins.filter(w => w && !w.closed).forEach(w => { if (w.addMsg) w.addMsg(name, text, 'normal', 'casual', nameColor || '', av, renderedTime, fmtText(text)); });
  }
}

function replaceCasualMsg(name, text, uid, timestamp, msgKey, nameColor) {
  const safeKey = upsertStoredMessage('casual', msgKey, { name, text, uid, timestamp, nameColor });
  bindMessageViewport('casual');
  const div = buildCasualMsgElement(name, text, uid, timestamp, safeKey, nameColor);
  replaceRenderedMessage('casual', safeKey, div);
}

function removeCasualMsg(msgKey) {
  removeRenderedMessage('casual', msgKey);
}


/* ==========================================================================
 * CHAT SECTION: WHISPER SEND FLOW
 * 귓말 대상/저널 speak-as context 확인 및 전송
 * ========================================================================== */

function getActiveWhisperChannelKey(options = {}) {
  const fromOptions = String(options?.channelKey || '').trim();
  if (fromOptions) return fromOptions;
  return String(window._itcActiveChatChannelKey || (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global') || 'global').trim() || 'global';
}

function resolveWhisperSpeakAsContext(journalId, text = '') {
  const safeJournalId = String(journalId || '').trim();
  if (!safeJournalId) return null;

  const journalList = typeof loadJournals === 'function' ? loadJournals() : [];
  const journal = journalList.find(x => String(x.id || '') === safeJournalId)
    || (_allJournals || []).find(x => String(x.id || '') === safeJournalId)
    || null;

  let context = null;
  try {
    if (journal && typeof saBuildMessageContext === 'function') {
      context = saBuildMessageContext(journal, text);
    }
  } catch (e) {
    context = null;
  }

  const avatarFromResolver = typeof saGetAvatar === 'function' ? saGetAvatar(safeJournalId) : null;
  const avatar = context?.speakAsAvatar || avatarFromResolver || journal?.avatar || journal?.sheet?.avatar || '';

  return {
    name: context?.name || journal?.title || '',
    speakAsJournalId: safeJournalId,
    speakAsAvatar: avatar || '',
    nameColor: context?.nameColor || (typeof saGetJournalNameColor === 'function' ? saGetJournalNameColor(safeJournalId, journal) : (journal?.nameColor || journal?.sheet?.nameColor || ''))
  };
}

function sendWhisperMessage(senderName, text, targetUid, targetName, options = {}) {
  const localTime = Date.now();
  const channelKey = getActiveWhisperChannelKey(options);
  const speakAsJournalId = String(options?.speakAsJournalId || St.speakAsJournalId || '').trim();
  const targetJournalId = String(options?.targetJournalId || St.whisperToJournal || '').trim();
  const speakAsContext = resolveWhisperSpeakAsContext(speakAsJournalId, text);
  const msg = {
    name: speakAsContext?.name || senderName, text, type: 'whisper',
    uid: St.myId, time: localTime,
    whisperTo: targetUid, whisperToName: targetName,
    dmChannelKey: channelKey || 'global'
  };
  if (targetJournalId) msg.whisperToJournal = targetJournalId;
  if (speakAsContext) {
    msg.speakAsJournalId = speakAsContext.speakAsJournalId;
    if (speakAsContext.speakAsAvatar) msg.speakAsAvatar = speakAsContext.speakAsAvatar;
    if (speakAsContext.nameColor) msg.nameColor = speakAsContext.nameColor;
  } else if (St.myNameColor) {
    msg.nameColor = St.myNameColor;
  }
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    if (!St.roomCode) return Promise.reject(new Error('roomCode missing'));
    const payload = { ...msg, time: getChatServerTimestamp() };
    return push(ref(db, `rooms/${St.roomCode}/chat`), payload)
      .then((pushedRef) => notifyDmMetaAfterChatPush(channelKey, payload, pushedRef));
  }
  appendChatMsg({
    name: msg.name, text, type: 'whisper', uid: St.myId, timestamp: msg.time,
    whisperTo: targetUid, whisperToName: targetName, whisperToJournal: msg.whisperToJournal || null,
    speakAsJournalId: msg.speakAsJournalId || null, speakAsAvatar: msg.speakAsAvatar || null,
    nameColor: msg.nameColor || null, channel: 'chat'
  });
  return Promise.resolve();
}


/* ==========================================================================
 * CHAT SECTION: LEGACY IMAGE ENTRY AND LIGHTBOX
 * 기존 이미지 업로드 진입점과 이미지 lightbox
 * ========================================================================== */

async function handleChatImageUpload(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  try {
    await queuePendingChatImages(files);
  } finally {
    input.value = '';
  }
}

function openLightbox(src) {
  const lb = document.createElement('div');
  lb.className = 'img-lightbox';
  lb.innerHTML = `<img src="${src}" alt="이미지">`;
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

function addLocalMessage(type, name, text) { appendChatMsg({ name, text, type }); }


/* ==========================================================================
 * CHAT SECTION: AVATAR RESOLUTION AND CACHE
 * 프로필 이미지 fallback, 런타임 캐시, 기존 메시지 아바타 재렌더
 * ========================================================================== */

function resolveUserAvatarDisplaySrc(name, uid, size = 64) {
  let imgSrc = null;
  const avatarRuntime = window._itcAvatarRuntime || null;

  if (uid) {
    try { imgSrc = localStorage.getItem('itc_avatar_' + uid); } catch (e) { imgSrc = null; }
  }
  if (!imgSrc && name) {
    imgSrc = window._avatarCache?.[uid] || window._avatarCache?.[name];
  }
  if (avatarRuntime?.sanitizePersistentAvatarSrc) {
    imgSrc = avatarRuntime.sanitizePersistentAvatarSrc(imgSrc);
  }
  if (imgSrc && avatarRuntime?.getDisplayAvatarSrc) {
    imgSrc = avatarRuntime.getDisplayAvatarSrc(imgSrc, size);
  }
  return String(imgSrc || '').trim();
}

function getAvatarHtml(name, uid) {
  const avatarRuntime = window._itcAvatarRuntime || null;
  const imgSrc = resolveUserAvatarDisplaySrc(name, uid, 64);
  const initial = (name || '?')[0].toUpperCase();
  const shape_class = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
  const r = St.avatarShape === 'circle' ? '50%' : '6px';
  const dataSrcAttr = imgSrc ? ` data-avatar-src="${esc(imgSrc)}"` : ' data-avatar-src=""';
  const fallbackHtml = `<div class="msg-avatar-inner" style="border-radius:${r}">${esc(initial)}</div>`;
  if (imgSrc) {
    const safeSrc = esc(imgSrc);
    const isLoaded = !!(avatarRuntime?.isDisplayAvatarLoaded && avatarRuntime.isDisplayAvatarLoaded(imgSrc));
    const loadedClass = isLoaded ? ' is-loaded' : '';
    const onload = `this.classList.add('is-loaded');try{window._itcAvatarRuntime&&window._itcAvatarRuntime.markDisplayAvatarLoaded&&window._itcAvatarRuntime.markDisplayAvatarLoaded(this.currentSrc||this.src)}catch(e){}`;
    return `<div class="msg-avatar ${shape_class}" data-avatar-holder="1"${dataSrcAttr}>${fallbackHtml}<img class="msg-avatar-img${loadedClass}" src="${safeSrc}" alt="" decoding="async" loading="eager" style="border-radius:${r}" onload="${onload}" onerror="this.remove()"></div>`;
  }
  return `<div class="msg-avatar ${shape_class}" data-avatar-holder="1"${dataSrcAttr}>${fallbackHtml}</div>`;
}

function rerenderExistingChatAvatars() {
  document.querySelectorAll('.chat-msg').forEach(div => {
    const uid = div.dataset.avatarUid || div.dataset.uid || '';
    const name = div.dataset.avatarName || div.dataset.name || '';
    const holder = div.querySelector('[data-avatar-holder="1"]');
    if (!holder) return;
    const nextSrc = resolveUserAvatarDisplaySrc(name, uid || null, 64);
    const prevSrc = String(holder.dataset.avatarSrc || '').trim();
    if (prevSrc === nextSrc) return;
    holder.outerHTML = getAvatarHtml(name, uid || null);
  });

  refreshCasualNickDisplay();
}



/* ==========================================================================
 * CHAT SECTION: STANDARD CHAT MESSAGE DOM
 * 일반/이미지/귓말/desc 메시지 DOM 생성과 액션 버튼 연결
 * ========================================================================== */

function buildStandardChatImageSection(name, time, src, avatarHtml, imageWide = false, imageMeta = null, extraNameClass = '', extraNameStyle = '', hideImageMeta = false) {
  const imageHtml = buildChatImageHtml(src, imageWide, imageMeta);
  const safeNameClass = extraNameClass ? ` ${extraNameClass}` : '';
  if (hideImageMeta) {
    return `<div class="msg-image-only-wrap${imageWide ? ' is-wide' : ''}">${imageHtml}</div>`;
  }
  if (imageWide) {
    return `${avatarHtml}<div class="msg-wide-head"><div class="msg-meta"><span class="msg-name${safeNameClass}"${extraNameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div></div><div class="msg-wide-image-wrap">${imageHtml}</div>`;
  }
  return `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name${safeNameClass}"${extraNameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div>${imageHtml}</div>`;
}

function buildChatMsgElement(msg = {}) {
  const { name, text, type, uid, timestamp, speakAsAvatar, speakAsJournalId,
          whisperTo, whisperToName, whisperToJournal, nameColor, msgKey, channel,
          standingImg, tokenId, standingLabel,
          dialoguePortrait = '', showPortraitInDialogue = false,
          imageWide = false, imageMeta = null, hideImageMeta = false } = msg;
  const d = timestamp ? new Date(timestamp) : new Date();
  const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;

  if (type === 'system' || type === 'sys') {
    const div = document.createElement('div');
    div.className = 'chat-msg msg-sys';
    div.innerHTML = `<div class="msg-text">${fmtText(text)}</div>`;
    return div;
  }

  if (type === 'desc') {
    const div = document.createElement('div');
    div.className = 'chat-msg msg-dsec';
    div.innerHTML = `<div class="msg-body"><div class="msg-text">${fmtText(text)}</div></div>`;
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    return div;
  }

  if (type === 'whisper') {
    const r = St.avatarShape === 'circle' ? '50%' : '6px';
    const sc = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
    const finalAvatar = speakAsAvatar || (speakAsJournalId ? saGetAvatar(speakAsJournalId) : null);
    const avatarHtml = finalAvatar
      ? `<div class="msg-avatar ${sc} sa-avatar"><img src="${esc(finalAvatar)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:${r};display:block"></div>`
      : getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));
    const isMine = uid === St.myId;
    const tagText = isMine ? `→ ${esc(whisperToName || '?')}에게 귓말` : `→ 나에게 귓말`;
    const whisperNameColor = nameColor || (speakAsJournalId ? (typeof saGetJournalNameColor === 'function' ? saGetJournalNameColor(speakAsJournalId) : (_allJournals.find(x => x.id === speakAsJournalId)?.nameColor || _allJournals.find(x => x.id === speakAsJournalId)?.sheet?.nameColor || '')) : '');
    const nameStyle = whisperNameColor ? ` style="color:${esc(whisperNameColor)}"` : '';
    const div = document.createElement('div');
    div.className = 'chat-msg msg-whisper';
    div.dataset.avatarUid = uid || '';
    div.dataset.avatarName = name || '';
    if (whisperToJournal) div.dataset.whisperToJournal = whisperToJournal;
    div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${nameStyle}>${esc(name)}</span><span class="whisper-tag">${tagText}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    return div;
  }

  if (type === 'speak-as') {
    const r = St.avatarShape === 'circle' ? '50%' : '6px';
    const sc = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
    const finalAvatar = speakAsAvatar || (speakAsJournalId ? saGetAvatar(speakAsJournalId) : null);
    const avatarHtml = finalAvatar
      ? `<div class="msg-avatar ${sc} sa-avatar"><img src="${esc(finalAvatar)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:${r};display:block"></div>`
      : `<div class="msg-avatar ${sc} sa-avatar"><div class="msg-avatar-inner" style="border-radius:${r}">${esc((name || '?')[0].toUpperCase())}</div></div>`;
    const div = document.createElement('div');
    div.className = 'chat-msg msg-speak-as';
    const journalColor = nameColor || (speakAsJournalId ? (typeof saGetJournalNameColor === 'function' ? saGetJournalNameColor(speakAsJournalId) : (_allJournals.find(x => x.id === speakAsJournalId)?.nameColor || _allJournals.find(x => x.id === speakAsJournalId)?.sheet?.nameColor || '')) : '');
    const nameStyle = journalColor ? ` style="color:${journalColor}"` : '';
    div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name sa-msg-name"${nameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text.replace(/@\S+/g,'').trim())}</div></div>`;
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    return div;
  }

  if (type === 'speak-as-image') {
    const r = St.avatarShape === 'circle' ? '50%' : '6px';
    const sc = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
    const finalAvatar = speakAsAvatar || (speakAsJournalId ? saGetAvatar(speakAsJournalId) : null);
    const avatarHtml = finalAvatar
      ? `<div class="msg-avatar ${sc} sa-avatar"><img src="${esc(finalAvatar)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:${r};display:block"></div>`
      : `<div class="msg-avatar ${sc} sa-avatar"><div class="msg-avatar-inner" style="border-radius:${r}">${esc((name || '?')[0].toUpperCase())}</div></div>`;
    const div = document.createElement('div');
    div.className = `chat-msg msg-speak-as msg-image-msg${imageWide ? ' msg-image-wide-row' : ''}${hideImageMeta ? ' msg-image-hide-meta' : ''}`;
    const journalColor = nameColor || (speakAsJournalId ? (typeof saGetJournalNameColor === 'function' ? saGetJournalNameColor(speakAsJournalId) : (_allJournals.find(x => x.id === speakAsJournalId)?.nameColor || _allJournals.find(x => x.id === speakAsJournalId)?.sheet?.nameColor || '')) : '');
    const nameStyle = journalColor ? ` style="color:${esc(journalColor)}"` : '';
    div.innerHTML = buildStandardChatImageSection(name, time, text, avatarHtml, !!imageWide, imageMeta, 'sa-msg-name', nameStyle, !!hideImageMeta);
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    return div;
  }

  const defaultAvatarHtml = getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));
  const nameStyle = nameColor ? ` style="color:${nameColor}"` : '';

  if (type === 'image') {
    const div = document.createElement('div');
    div.className = `chat-msg msg-image-msg${imageWide ? ' msg-image-wide-row' : ''}${hideImageMeta ? ' msg-image-hide-meta' : ''}`;
    div.dataset.avatarUid = uid || '';
    div.dataset.avatarName = name || '';
    div.innerHTML = buildStandardChatImageSection(name, time, text, defaultAvatarHtml, !!imageWide, imageMeta, '', nameStyle, !!hideImageMeta);
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    return div;
  }

  const div = document.createElement('div');
  div.className = `chat-msg msg-${type}`;
  div.dataset.avatarUid = uid || '';
  div.dataset.avatarName = name || '';
  if (type === 'dice') {
    const diceMatch = text.match(/🎲\s*(.+?)\s*→\s*(\d+)\s*\(([^)]+)\)/);
    if (diceMatch) {
      const formula = diceMatch[1].trim();
      const result = diceMatch[2];
      const rawRolls = diceMatch[3].trim();
      const rollParts = rawRolls.split('||').map(part => part.trim()).filter(Boolean);
      const rolls = rollParts[0] || rawRolls;
      const judgmentMeta = getDiceJudgmentMeta(rollParts[1] || rawRolls);
      const judgmentHtml = judgmentMeta ? `<div class="dice-card-judgment roll-judgment ${judgmentMeta.className}">${esc(judgmentMeta.label)}</div>` : '';
      const skillCheckClass = formula.endsWith('판정') ? ' dice-card-skill-check' : '';
      const isSpeakAsDice = !!speakAsJournalId;
      const r = St.avatarShape === 'circle' ? '50%' : '6px';
      const sc = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
      const finalAvatar = speakAsAvatar || (speakAsJournalId ? saGetAvatar(speakAsJournalId) : null);
      const diceAvatarHtml = isSpeakAsDice
        ? (finalAvatar
            ? `<div class="msg-avatar ${sc} sa-avatar"><img src="${esc(finalAvatar)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:${r};display:block"></div>`
            : `<div class="msg-avatar ${sc} sa-avatar"><div class="msg-avatar-inner" style="border-radius:${r}">${esc((name || '?')[0].toUpperCase())}</div></div>`)
        : defaultAvatarHtml;
      const diceNameColor = isSpeakAsDice ? (nameColor || (typeof saGetJournalNameColor === 'function' ? saGetJournalNameColor(speakAsJournalId) : (_allJournals.find(x => x.id === speakAsJournalId)?.nameColor || _allJournals.find(x => x.id === speakAsJournalId)?.sheet?.nameColor || ''))) : nameColor;
      const diceNameStyle = diceNameColor ? ` style="color:${diceNameColor}"` : '';
      div.innerHTML = `${diceAvatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name${isSpeakAsDice ? ' sa-msg-name' : ''}"${diceNameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div><div class="dice-card${skillCheckClass}"><div class="dice-card-formula">${esc(formula)}</div><div class="dice-card-result">${esc(result)}</div>${judgmentHtml}<div class="dice-card-rolls">${esc(rolls)}</div></div></div>`;
    } else {
      div.innerHTML = `${defaultAvatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${nameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
    }
  } else {
    div.innerHTML = `${defaultAvatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${nameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
  }
  addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
  return div;
}


/* ==========================================================================
 * CHAT SECTION: DICE RESULT DISPLAY
 * 주사위 판정 메타와 대사 표시 텍스트 생성
 * ========================================================================== */

function getDiceJudgmentMeta(text = '') {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  if (normalized.includes('크리티컬')) return { label: '크리티컬', className: 'j-crit' };
  if (normalized.includes('펌블')) return { label: '펌블', className: 'j-fumb' };
  if (normalized.includes('극단적 성공')) return { label: '극단적 성공', className: 'j-succ' };
  if (normalized.includes('어려운 성공')) return { label: '어려운 성공', className: 'j-succ' };
  if (normalized.includes('보통 성공')) return { label: '보통 성공', className: 'j-succ' };
  if (normalized.includes('실패')) return { label: '실패', className: 'j-fail' };
  return null;
}

function formatDiceDialogueText(text = '') {
  const match = String(text || '').match(/🎲\s*(.+?)\s*→\s*(\d+)\s*\(([^)]+)\)/);
  if (!match) return String(text || '').trim();
  const formula = match[1].trim();
  const result = match[2].trim();
  const rawRolls = match[3].trim();
  const parts = rawRolls.split('||').map(part => part.trim()).filter(Boolean);
  const judgment = parts[1] || '';
  return `${formula} ${result}${judgment ? ` (${judgment})` : ''}`.trim();
}


/* ==========================================================================
 * CHAT SECTION: CHAT DOM APPLY HELPERS
 * 메인 채팅 append/replace/remove 진입점
 * ========================================================================== */

function appendChatMsg(msg = {}) {
  const actualChannel = msg.channel || 'chat';
  const safeKey = upsertStoredMessage(actualChannel, msg.msgKey, {
    name: msg.name, text: msg.text, type: msg.type, uid: msg.uid, timestamp: msg.timestamp,
    speakAsAvatar: msg.speakAsAvatar, speakAsJournalId: msg.speakAsJournalId,
    whisperTo: msg.whisperTo, whisperToName: msg.whisperToName, whisperToJournal: msg.whisperToJournal, nameColor: msg.nameColor,
    standingImg: msg.standingImg, tokenId: msg.tokenId, standingLabel: msg.standingLabel,
    dialoguePortrait: msg.dialoguePortrait, showPortraitInDialogue: msg.showPortraitInDialogue,
    imageWide: msg.imageWide, hideImageMeta: msg.hideImageMeta,
    imageMeta: normalizeChatImageMeta(msg.imageMeta)
  });
  bindMessageViewport(actualChannel);
  const div = buildChatMsgElement({ ...msg, msgKey: safeKey, channel: actualChannel });
  queueMessageRender(actualChannel, div, safeKey, true);
  if ((msg.type === 'speak-as' || (msg.type === 'dice' && msg.speakAsJournalId)) && (!msg.timestamp || Date.now() - msg.timestamp < 5000)) {
    const dialogueText = msg.type === 'dice' ? formatDiceDialogueText(msg.text) : msg.text;
    showDialogueBoxFromMsg(msg.name, dialogueText, msg.speakAsJournalId, msg.standingImg, msg.tokenId, msg.standingLabel, msg.dialoguePortrait, msg.showPortraitInDialogue);
  }
}

function replaceChatMsg(msg = {}) {
  const actualChannel = msg.channel || 'chat';
  const safeKey = upsertStoredMessage(actualChannel, msg.msgKey, {
    name: msg.name, text: msg.text, type: msg.type, uid: msg.uid, timestamp: msg.timestamp,
    speakAsAvatar: msg.speakAsAvatar, speakAsJournalId: msg.speakAsJournalId,
    whisperTo: msg.whisperTo, whisperToName: msg.whisperToName, whisperToJournal: msg.whisperToJournal,
    speakAsAvatar: msg.speakAsAvatar, speakAsJournalId: msg.speakAsJournalId, nameColor: msg.nameColor,
    standingImg: msg.standingImg, tokenId: msg.tokenId, standingLabel: msg.standingLabel,
    dialoguePortrait: msg.dialoguePortrait, showPortraitInDialogue: msg.showPortraitInDialogue,
    imageWide: msg.imageWide, hideImageMeta: msg.hideImageMeta,
    imageMeta: normalizeChatImageMeta(msg.imageMeta)
  });
  bindMessageViewport(actualChannel);
  const div = buildChatMsgElement({ ...msg, msgKey: safeKey, channel: actualChannel });
  replaceRenderedMessage(actualChannel, safeKey, div);
}

function removeChatMsg(msgKey, channel = 'chat') {
  removeRenderedMessage(channel, msgKey);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initChatImageComposer);
} else {
  initChatImageComposer();
}


/* ==========================================================================
 * CHAT SECTION: POPOUT AND EXTERNAL CASUAL SYNC
 * 팝아웃/외부 호출에서 잡담 프로필과 이름색 동기화
 * ========================================================================== */

function getCasualProfileForPopout() {
  let avatar = '';
  try {
    avatar = window._itcAvatarRuntime?.readStoredAvatar?.(St.myId) || localStorage.getItem('itc_avatar_' + St.myId) || '';
  } catch (e) {
    avatar = '';
  }
  return {
    name: _casualNickname || St.myName || '나',
    color: St.casualNameColor || '',
    avatar,
  };
}

function setCasualNicknameFromPopout(name) {
  const trimmed = String(name || '').trim().slice(0, 18);
  if (!trimmed) return getCasualProfileForPopout();
  _casualNickname = trimmed;
  try { localStorage.setItem('itc_casual_nick_' + St.myId, trimmed); } catch(e) {}
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, update } = window._FB;
    update(ref(db, `rooms/${St.roomCode}/players/${St.myId}`), { casualNick: trimmed });
  }
  refreshCasualNickDisplay();
  if (typeof window.forcePopoutSync === 'function') window.forcePopoutSync();
  return getCasualProfileForPopout();
}

function normalizeCasualNameColor(color) {
  const safe = String(color || '').trim();
  if (!safe) return '';
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(safe) ? safe : '';
}

function applyCasualNameColorFromExternal(color, options = {}) {
  const safeColor = normalizeCasualNameColor(color);
  if (!safeColor) return getCasualProfileForPopout();
  const prevColor = St.casualNameColor || '';
  St.casualNameColor = safeColor;
  try { localStorage.setItem('itc_casual_name_color', safeColor); } catch(e) {}
  if (window._FB?.CONFIGURED && St.roomCode && St.myId) {
    const { db, ref, update } = window._FB;
    update(ref(db, `rooms/${St.roomCode}/players/${St.myId}`), { casualNameColor: safeColor }).catch(() => {});
  }
  refreshCasualNickDisplay();
  if (typeof window.forcePopoutSync === 'function') window.forcePopoutSync();
  if (!options.silent && prevColor !== safeColor && typeof showToast === 'function') {
    showToast('잡담 이름 색상이 변경됐어요.');
  }
  return getCasualProfileForPopout();
}

function setCasualNameColorFromPopout(color) {
  return applyCasualNameColorFromExternal(color);
}

window.addEventListener('message', (event) => {
  const data = event?.data || null;
  if (!data || data.type !== 'ITC_POPOUT_CASUAL_COLOR') return;
  applyCasualNameColorFromExternal(data.color);
});

window.getCasualProfileForPopout = getCasualProfileForPopout;
window.setCasualNicknameFromPopout = setCasualNicknameFromPopout;
window.setCasualNameColorFromPopout = setCasualNameColorFromPopout;

window.clearTypingState = clearTypingState;
window.chatKeydown = chatKeydown;
window.sendChat = sendChat;
window.handleChatImageUpload = handleChatImageUpload;
window.togglePendingChatImageWide = togglePendingChatImageWide;
window.togglePendingChatImageHideMeta = togglePendingChatImageHideMeta;
window.clearPendingChatImages = clearPendingChatImages;
window.refreshChatActionButtons = refreshChatActionButtons;
window.clearAllChatHistory = clearAllChatHistory;
window.toggleDescMode = toggleDescMode;
scheduleChatInputResizeInit();
window.initChatInputResize = initChatInputResize;
window.broadcastTyping = broadcastTyping;
window.queueMessageRender = queueMessageRender;

// 외부(game.js 등)에서 스토어 내 메시지 존재 확인
window.isMessageAlreadyInStore = function(channel, key) {
  try {
    const state = getRenderState(channel || 'chat');
    return state.storeMap.has(makeStoredMessageKey(channel || 'chat', key));
  } catch(e) { return false; }
};

// 채널 전환 시 모든 채널 렌더 큐 즉시 플러시
window.flushAllRenderQueues = function() {
  try {
    ['chat', 'casual', 'dm'].forEach(ch => {
      try {
        const state = getRenderState(ch);
        if (state && state.queue && state.queue.length > 0) {
          if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
          state.queue.length = 0;
        }
      } catch(e) {}
    });
  } catch(e) {}
};
window.getRenderedNodeByKey = getRenderedNodeByKey;
window.replaceRenderedMessage = replaceRenderedMessage;
window.removeRenderedMessage = removeRenderedMessage;
window.resetRenderedMessages = resetRenderedMessages;
window.activateChatRenderChannel = activateChatRenderChannel;
window.storeMessageRecord = storeMessageRecord;
window.prependStoredWindow = prependStoredWindow;
window.configureHistoryPaging = configureHistoryPaging;
window.requestOlderHistory = requestOlderHistory;
window.prependStoredWindow = prependStoredWindow;
window.seedChatHistoryStore = seedChatHistoryStore;
window.getOldestStoredMessageKey = getOldestStoredMessageKey;
window.getNewestStoredMessageKey = getNewestStoredMessageKey;
window.getChatRenderSnapshot = getChatRenderSnapshot;
window.getChatImageClassName = getChatImageClassName;
window.getChatImageInlineStyle = getChatImageInlineStyle;
