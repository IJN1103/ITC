
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

