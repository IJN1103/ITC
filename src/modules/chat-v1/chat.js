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
    maxMemory: 360,
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
  },
  casual: {
    containerId: 'casual-messages',
    raf: 0,
    queue: [],
    map: new Map(),
    max: 140,
    maxMemory: 260,
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
  },
};

function getRenderState(channel = 'chat') {
  return _renderState[channel] || _renderState.chat;
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

function upsertStoredMessage(channel = 'chat', key, record) {
  const state = getRenderState(channel);
  const safeKey = makeStoredMessageKey(channel, key);
  const existing = state.storeMap.has(safeKey);

  if (!existing) {
    state.storeOrder.push(safeKey);
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

function buildMessageNodeFromRecord(channel = 'chat', record) {
  if (!record) return null;
  if (channel === 'casual') {
    return buildCasualMsgElement(record.name, record.text, record.uid, record.timestamp, record._key);
  }
  return buildChatMsgElement(
    record.name, record.text, record.type, record.uid, record.timestamp,
    record.speakAsAvatar, record.speakAsJournalId, record.whisperTo, record.whisperToName,
    record.nameColor, record._key, channel, record.standingImg, record.tokenId,
    record.standingLabel, !!record.imageWide, record.imageMeta || null
  );
}

function trimRenderedMessages(channel = 'chat') {
  const state = getRenderState(channel);
  const el = getRenderContainer(channel);
  if (!el) return;
  if (state.virtualEnabled) return;
  while (el.children.length > state.max) {
    let removable = el.firstElementChild;
    if (removable && removable.classList.contains('chat-history-notice')) {
      removable = removable.nextElementSibling;
    }
    if (!removable) break;
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

  trimRenderedMessages(channel);
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

      if (isNearTop(el, 28)) prependStoredWindow(channel);
      else if (isNearBottom(el, 28)) {
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
  if (!el) return;
  el.innerHTML = '';
  if (state.virtualEnabled) ensureVirtualElements(channel);
  ensureHistoryNotice(channel);
  syncStickyState(channel, el);
}

function getChatImageClassName(imageWide = false) {
  return imageWide ? 'msg-image is-wide' : 'msg-image';
}

function getChatImageInlineStyle(imageWide = false) {
  return imageWide ? 'width:100%;max-width:none;height:auto;object-fit:contain;' : '';
}

const CHAT_IMAGE_PLACEHOLDER = 'about:blank';
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
let _dragChatImageId = null;

function makePendingChatImageId() {
  return `pci_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getChatImageQueueEls() {
  return {
    wrap: document.getElementById('chat-image-queue'),
    list: document.getElementById('chat-image-preview-list'),
    wideToggle: document.getElementById('chat-image-wide-toggle'),
  };
}

function renderPendingChatImages() {
  const { wrap, list, wideToggle } = getChatImageQueueEls();
  if (!wrap || !list) return;
  list.innerHTML = '';
  if (_pendingChatImages.length === 0) {
    wrap.style.display = 'none';
    if (wideToggle) wideToggle.checked = !!_pendingChatImageWide;
    return;
  }

  wrap.style.display = '';
  if (wideToggle) wideToggle.checked = !!_pendingChatImageWide;

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
  renderPendingChatImages();
}

function togglePendingChatImageWide(checked) {
  _pendingChatImageWide = !!checked;
}

function getCloudinaryRuntimeConfig() {
  const cfg = window._ITC_CLOUDINARY || {};
  const cloudName = String(cfg.cloudName || '').trim();
  const unsignedPreset = String(cfg.unsignedPreset || '').trim();
  if (!cloudName || !unsignedPreset) return null;
  return { cloudName, unsignedPreset };
}

async function loadChatImageFromFile(file) {
  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({
      img,
      objectUrl,
      width: img.width || 0,
      height: img.height || 0,
    });
    img.onerror = () => {
      try { URL.revokeObjectURL(objectUrl); } catch (e) {}
      reject(new Error('이미지 처리에 실패했어요.'));
    };
    img.src = objectUrl;
  });
}

async function canvasToJpegBlob(canvas, quality = 0.84) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('이미지 처리에 실패했어요.'));
        return;
      }
      resolve(blob);
    }, 'image/jpeg', quality);
  });
}

function makePreparedChatImageBase(meta = {}) {
  return {
    id: makePendingChatImageId(),
    previewUrl: meta.previewUrl || '',
    previewKind: meta.previewKind || 'object-url',
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

  const loaded = await loadChatImageFromFile(file);
  const rawMeta = { width: loaded.width, height: loaded.height };

  if (isGif) {
    return makePreparedChatImageBase({
      previewUrl: loaded.objectUrl,
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
  const needsResize = rawMeta.width > maxEdge || rawMeta.height > maxEdge;
  const needsCompress = file.type !== 'image/jpeg' || file.size > 900 * 1024 || needsResize;

  if (!needsCompress) {
    return makePreparedChatImageBase({
      previewUrl: loaded.objectUrl,
      previewKind: 'object-url',
      uploadBlob: file,
      uploadMime: file.type || 'image/jpeg',
      uploadFileName: file.name || `chat_${Date.now()}.jpg`,
      isGif: false,
      width: rawMeta.width,
      height: rawMeta.height,
    });
  }

  try {
    let w = loaded.img.width;
    let h = loaded.img.height;
    if (w > maxEdge || h > maxEdge) {
      const ratio = Math.min(maxEdge / w, maxEdge / h);
      w = Math.max(1, Math.round(w * ratio));
      h = Math.max(1, Math.round(h * ratio));
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이미지 처리에 실패했어요.');
    ctx.drawImage(loaded.img, 0, 0, w, h);
    const blob = await canvasToJpegBlob(canvas, 0.84);
    return makePreparedChatImageBase({
      previewUrl: URL.createObjectURL(blob),
      previewKind: 'object-url',
      uploadBlob: blob,
      uploadMime: 'image/jpeg',
      uploadFileName: `chat_${Date.now()}.jpg`,
      isGif: false,
      width: w || rawMeta.width || 0,
      height: h || rawMeta.height || 0,
    });
  } finally {
    try { URL.revokeObjectURL(loaded.objectUrl); } catch (e) {}
  }
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

function withTimeout(promise, ms = 3500) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('timeout'));
    }, ms);
    Promise.resolve(promise).then((value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    }).catch((err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

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

async function uploadChatImageBlobToCloudinary(blob, fileName = 'chat.jpg') {
  const cfg = getCloudinaryRuntimeConfig();
  if (!cfg || !blob) return null;
  const formData = new FormData();
  formData.append('file', blob, fileName);
  formData.append('upload_preset', cfg.unsignedPreset);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/image/upload`, {
      method: 'POST',
      body: formData,
      signal: controller?.signal,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.secure_url) {
      throw new Error(payload?.error?.message || 'cloudinary upload failed');
    }
    return {
      url: payload.secure_url,
      path: payload.public_id || '',
      contentType: blob.type || 'image/jpeg',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function uploadPreparedChatImage(preparedItem) {
  const uploadBlob = preparedItem?.uploadBlob || null;
  if (!uploadBlob) throw new Error('이미지 업로드 데이터가 없어요.');
  const uploadFileName = preparedItem?.uploadFileName || `chat_${Date.now()}.jpg`;
  const uploadedCloudinary = await uploadChatImageBlobToCloudinary(uploadBlob, uploadFileName);
  if (!uploadedCloudinary?.url) return null;
  return {
    url: uploadedCloudinary.url,
    path: uploadedCloudinary.path || '',
    contentType: uploadedCloudinary.contentType || preparedItem?.uploadMime || uploadBlob.type || 'image/jpeg',
  };
}

function sanitizeAvatarSrc(src, storageKey = '') {
  const safe = typeof src === 'string' ? src.trim() : '';
  if (!safe) return '';
  if (/^data:image\//i.test(safe)) {
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch (e) {}
    }
    return '';
  }
  return safe;
}

async function sendPreparedChatImage(preparedOrDataUrl, imageWide = false, imageMeta = null) {
  const saJId = St.speakAsJournalId;
  const saJournal = saJId ? loadJournals().find(x => x.id === saJId) : null;
  const saName = saJournal ? (saJournal.title || '무제') : null;
  const saAvatar = saJId ? saGetAvatar(saJId) : null;
  const normalizedMeta = normalizeChatImageMeta(imageMeta);

  const prepared = (preparedOrDataUrl && typeof preparedOrDataUrl === 'object' && 'uploadBlob' in preparedOrDataUrl)
    ? preparedOrDataUrl
    : null;
  let finalSrc = '';
  let storageMeta = null;

  if (!St.roomCode) {
    throw new Error('이미지 업로드를 위한 방 정보가 없어요.');
  }

  if (!prepared?.uploadBlob) {
    throw new Error('이미지 업로드 데이터가 없어요.');
  }

  const uploaded = await uploadPreparedChatImage(prepared);
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
      imageWide: !!imageWide,
      imageMeta: normalizedMeta,
      imageStoragePath: storageMeta?.path || '',
      imageContentType: storageMeta?.contentType || prepared?.uploadMime || prepared?.uploadBlob?.type || 'image/jpeg',
    };
    if (window._FB?.CONFIGURED) {
      const { db, ref, push } = window._FB;
      if (!St.roomCode) throw new Error('roomCode missing');
      return push(ref(db, `rooms/${St.roomCode}/chat`), msg);
    }
    appendChatMsg(msg.name, finalSrc, 'speak-as-image', St.myId, msg.time, saAvatar, saJId, null, null, null, null, 'chat', null, null, null, !!imageWide, normalizedMeta);
    return Promise.resolve();
  }

  return sendMessage(St.myName, finalSrc, 'image', {
    imageWide: !!imageWide,
    imageMeta: normalizedMeta,
    imageStoragePath: storageMeta?.path || '',
    imageContentType: storageMeta?.contentType || prepared?.uploadMime || prepared?.uploadBlob?.type || 'image/jpeg',
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
  try {
    for (const item of items) {
      await sendPreparedChatImage(item, _pendingChatImageWide, { width: item.width, height: item.height });
      revokePreparedChatImagePreview(item);
    }
    return true;
  } catch (err) {
    console.error('sendPendingChatImages failed', err);
    items.reverse().forEach(item => _pendingChatImages.unshift(item));
    renderPendingChatImages();
    showToast(err?.message || '이미지 업로드에 실패했어요. 잠시 후 다시 시도해 주세요.');
    throw err;
  }
}

function initChatImageComposer() {
  renderPendingChatImages();
  bindMessageViewport('chat');
  bindMessageViewport('casual');
}


async function sendChat() {
  const inp = document.getElementById('chat-input');
  if (!inp) return;
  const raw = inp.value.trim();
  const hasImages = _pendingChatImages.length > 0;
  if (!raw && !hasImages) return;

  const restoreInput = () => {
    try { inp.value = raw; inp.focus(); } catch (e) {}
  };

  try {
    clearTypingState();

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
        await sendWhisperMessage(St.myName, whisperText, target[0], targetName);
        return;
      }
      const jTarget = _allJournals.find(j => (j.title || '') === targetName);
      if (jTarget && jTarget.ownerId) {
        inp.value = '';
        const senderName = St.speakAsJournalId ? (loadJournals().find(x=>x.id===St.speakAsJournalId)?.title||St.myName) : St.myName;
        await sendWhisperMessage(senderName, whisperText, jTarget.ownerId, targetName);
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
      await sendWhisperMessage(senderName, raw, St.whisperTo, St.whisperToName);
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
    restoreInput();
    showToast('메시지 전송에 실패했어요. 다시 시도해주세요.');
  }
}

function sendMessage(name, text, type = 'normal', extra = null) {
  const msg = { name, text, type, uid: St.myId, time: Date.now() };
  if ((type === 'normal' || type === 'desc') && St.myNameColor) msg.nameColor = St.myNameColor;
  if (extra && typeof extra === 'object') Object.assign(msg, extra);
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    if (!St.roomCode) return Promise.reject(new Error('roomCode missing'));
    return push(ref(db, `rooms/${St.roomCode}/chat`), msg);
  }
  appendChatMsg(name, text, type, St.myId, msg.time, null, null, null, null, msg.nameColor || null, null, 'chat', null, null, null, !!msg.imageWide, msg.imageMeta || null);
  return Promise.resolve();
}

function sendCasual() {
  const inp = document.getElementById('chat-input');
  const raw = inp.value.trim();
  if (!raw) return;
  inp.value = '';
  sendCasualMsg(St.myName, raw);
}

function sendCasualMsg(name, text) {
  const msg = { name, text, uid: St.myId, time: Date.now() };
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    if (!St.roomCode) return Promise.reject(new Error('roomCode missing'));
    return push(ref(db, `rooms/${St.roomCode}/casual`), msg);
  }
  appendCasualMsg(name, text, St.myId, msg.time);
  return Promise.resolve();
}

function refreshCasualNickDisplay() {
  const el = document.getElementById('casual-nick-name');
  if (el) el.textContent = _casualNickname || St.myName;
  const avEl = document.getElementById('casual-nick-avatar');
  if (avEl) {
    const avSrc = sanitizeAvatarSrc(localStorage.getItem('itc_avatar_' + St.myId) || '', 'itc_avatar_' + St.myId);
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
function broadcastTyping() {
  if (!window._FB?.CONFIGURED || !St.roomCode) return;
  const now = Date.now();
  if (now - _lastTypingBroadcast < 1500) return;
  _lastTypingBroadcast = now;
  const { db, ref, set, remove } = window._FB;
  const tab = _activeRightTab === 'casual' ? 'casual' : 'chat';
  let displayName = St.myName;
  if (tab === 'chat' && St.speakAsJournalId) {
    const j = loadJournals().find(x => x.id === St.speakAsJournalId);
    if (j) displayName = j.title || St.myName;
  } else if (tab === 'casual' && _casualNickname) {
    displayName = _casualNickname;
  }
  set(ref(db, `rooms/${St.roomCode}/typing/${St.myId}`), { name: displayName, tab, time: Date.now() });
  if (_typingTimer) clearTimeout(_typingTimer);
  _typingTimer = setTimeout(() => {
    remove(ref(db, `rooms/${St.roomCode}/typing/${St.myId}`));
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

function clearTypingState() {
  if (!window._FB?.CONFIGURED || !St.roomCode) return;
  const { db, ref, remove } = window._FB;
  remove(ref(db, `rooms/${St.roomCode}/typing/${St.myId}`));
  if (_typingTimer) { clearTimeout(_typingTimer); _typingTimer = null; }
}

function saSendCasual(journal, text) {
  const name = journal.title || '무제';
  const avatar = saGetAvatar(journal.id);
  const msg = { name, text: text.replace(/@\S+/g,'').trim(), uid: St.myId, time: Date.now(), speakAsAvatar: avatar, speakAsJournalId: journal.id };
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    push(ref(db, `rooms/${St.roomCode}/casual`), msg);
  } else {
    appendCasualMsg(name, msg.text, St.myId, msg.time);
  }
}

function buildCasualMsgElement(name, text, uid, timestamp, msgKey) {
  const d = timestamp ? new Date(timestamp) : new Date();
  const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  const avatarHtml = getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));
  const div = document.createElement('div');
  div.className = 'chat-msg msg-normal';
  div.dataset.avatarUid = uid || '';
  div.dataset.avatarName = name || '';
  div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name">${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
  addMsgActions(div, uid, msgKey, 'casual', text, 'normal');
  return div;
}

function appendCasualMsg(name, text, uid, timestamp, msgKey) {
  const safeKey = upsertStoredMessage('casual', msgKey, { name, text, uid, timestamp });
  bindMessageViewport('casual');
  const div = buildCasualMsgElement(name, text, uid, timestamp, safeKey);
  queueMessageRender('casual', div, safeKey, true);
  if (typeof _popoutWins !== 'undefined') {
    const av = getPopoutAvatarUrl(name, uid);
    const renderedTime = div.querySelector('.msg-time')?.textContent || '';
    _popoutWins.filter(w => w && !w.closed).forEach(w => { if (w.addMsg) w.addMsg(name, text, 'normal', 'casual', '', av, renderedTime, fmtText(text)); });
  }
}

function replaceCasualMsg(name, text, uid, timestamp, msgKey) {
  const safeKey = upsertStoredMessage('casual', msgKey, { name, text, uid, timestamp });
  bindMessageViewport('casual');
  const div = buildCasualMsgElement(name, text, uid, timestamp, safeKey);
  replaceRenderedMessage('casual', safeKey, div);
}

function removeCasualMsg(msgKey) {
  removeRenderedMessage('casual', msgKey);
}

function sendWhisperMessage(senderName, text, targetUid, targetName) {
  const msg = {
    name: senderName, text, type: 'whisper',
    uid: St.myId, time: Date.now(),
    whisperTo: targetUid, whisperToName: targetName
  };
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    if (!St.roomCode) return Promise.reject(new Error('roomCode missing'));
    return push(ref(db, `rooms/${St.roomCode}/chat`), msg);
  }
  appendChatMsg(msg.name, text, 'whisper', St.myId, msg.time, null, null, targetUid, targetName);
  return Promise.resolve();
}

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

function addLocalMessage(type, name, text) { appendChatMsg(name, text, type); }

function getAvatarHtml(name, uid) {
  let imgSrc = null;

  if (uid) {
    imgSrc = sanitizeAvatarSrc(localStorage.getItem('itc_avatar_' + uid), 'itc_avatar_' + uid);
  }
  if (!imgSrc && name) {
    imgSrc = sanitizeAvatarSrc(window._avatarCache?.[uid] || window._avatarCache?.[name] || '');
  }

  const initial = (name || '?')[0].toUpperCase();
  const shape_class = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
  const r = St.avatarShape === 'circle' ? '50%' : '6px';
  if (imgSrc) {
    return `<div class="msg-avatar ${shape_class}" data-avatar-holder="1"><img src="${imgSrc}" alt="${esc(initial)}" style="border-radius:${r}"></div>`;
  }
  return `<div class="msg-avatar ${shape_class}" data-avatar-holder="1"><div class="msg-avatar-inner" style="border-radius:${r}">${esc(initial)}</div></div>`;
}

function rerenderExistingChatAvatars() {
  document.querySelectorAll('.chat-msg').forEach(div => {
    const uid = div.dataset.avatarUid || div.dataset.uid || '';
    const name = div.dataset.avatarName || div.dataset.name || '';
    const holder = div.querySelector('[data-avatar-holder="1"]');
    if (!holder) return;
    holder.outerHTML = getAvatarHtml(name, uid || null);
  });

  refreshCasualNickDisplay();
}


function buildStandardChatImageSection(name, time, src, avatarHtml, imageWide = false, imageMeta = null, extraNameClass = '', extraNameStyle = '') {
  const imageHtml = buildChatImageHtml(src, imageWide, imageMeta);
  const safeNameClass = extraNameClass ? ` ${extraNameClass}` : '';
  if (imageWide) {
    return `${avatarHtml}<div class="msg-wide-head"><div class="msg-meta"><span class="msg-name${safeNameClass}"${extraNameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div></div><div class="msg-wide-image-wrap">${imageHtml}</div>`;
  }
  return `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name${safeNameClass}"${extraNameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div>${imageHtml}</div>`;
}

function buildChatMsgElement(name, text, type, uid, timestamp, speakAsAvatar, speakAsJournalId, whisperTo, whisperToName, nameColor, msgKey, channel, standingImg, tokenId, standingLabel, imageWide = false, imageMeta = null) {
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
    const avatarHtml = getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));
    const isMine = uid === St.myId;
    const tagText = isMine ? `→ ${esc(whisperToName || '?')}에게 귓말` : `→ 나에게 귓말`;
    const div = document.createElement('div');
    div.className = 'chat-msg msg-whisper';
    div.dataset.avatarUid = uid || '';
    div.dataset.avatarName = name || '';
    div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name">${esc(name)}</span><span class="whisper-tag">${tagText}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
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
    const journalColor = nameColor || (speakAsJournalId ? (_allJournals.find(x => x.id === speakAsJournalId)?.nameColor || '') : '');
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
    div.className = `chat-msg msg-speak-as msg-image-msg${imageWide ? ' msg-image-wide-row' : ''}`;
    div.innerHTML = buildStandardChatImageSection(name, time, text, avatarHtml, !!imageWide, imageMeta, 'sa-msg-name');
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    return div;
  }

  const avatarHtml = getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));

  if (type === 'image') {
    const div = document.createElement('div');
    div.className = `chat-msg msg-image-msg${imageWide ? ' msg-image-wide-row' : ''}`;
    div.dataset.avatarUid = uid || '';
    div.dataset.avatarName = name || '';
    div.innerHTML = buildStandardChatImageSection(name, time, text, avatarHtml, !!imageWide, imageMeta);
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    return div;
  }

  const div = document.createElement('div');
  div.className = `chat-msg msg-${type}`;
  div.dataset.avatarUid = uid || '';
  div.dataset.avatarName = name || '';
  const nameStyle = nameColor ? ` style="color:${nameColor}"` : '';
  if (type === 'dice') {
    const diceMatch = text.match(/🎲\s*(.+?)\s*→\s*(\d+)\s*\(([^)]+)\)/);
    if (diceMatch) {
      const formula = diceMatch[1].trim();
      const result = diceMatch[2];
      const rolls = diceMatch[3].trim();
      div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${nameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div><div class="dice-card"><div class="dice-card-formula">${esc(formula)}</div><div class="dice-card-result">${esc(result)}</div><div class="dice-card-rolls">${esc(rolls)}</div></div></div>`;
    } else {
      div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${nameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
    }
  } else {
    div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${nameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
  }
  addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
  return div;
}

function appendChatMsg(name, text, type, uid, timestamp, speakAsAvatar, speakAsJournalId, whisperTo, whisperToName, nameColor, msgKey, channel, standingImg, tokenId, standingLabel, imageWide = false, imageMeta = null) {
  const actualChannel = channel || 'chat';
  const safeKey = upsertStoredMessage(actualChannel, msgKey, {
    name, text, type, uid, timestamp, speakAsAvatar, speakAsJournalId,
    whisperTo, whisperToName, nameColor, standingImg, tokenId, standingLabel, imageWide, imageMeta: normalizeChatImageMeta(imageMeta)
  });
  bindMessageViewport(actualChannel);
  const div = buildChatMsgElement(name, text, type, uid, timestamp, speakAsAvatar, speakAsJournalId, whisperTo, whisperToName, nameColor, safeKey, actualChannel, standingImg, tokenId, standingLabel, imageWide, imageMeta);
  queueMessageRender(actualChannel, div, safeKey, true);
  if (type === 'speak-as' && (!timestamp || Date.now() - timestamp < 5000)) {
    showDialogueBoxFromMsg(name, text, speakAsJournalId, standingImg, tokenId, standingLabel);
  }
}

function replaceChatMsg(name, text, type, uid, timestamp, speakAsAvatar, speakAsJournalId, whisperTo, whisperToName, nameColor, msgKey, channel, standingImg, tokenId, standingLabel, imageWide = false, imageMeta = null) {
  const actualChannel = channel || 'chat';
  const safeKey = upsertStoredMessage(actualChannel, msgKey, {
    name, text, type, uid, timestamp, speakAsAvatar, speakAsJournalId,
    whisperTo, whisperToName, nameColor, standingImg, tokenId, standingLabel, imageWide, imageMeta: normalizeChatImageMeta(imageMeta)
  });
  bindMessageViewport(actualChannel);
  const div = buildChatMsgElement(name, text, type, uid, timestamp, speakAsAvatar, speakAsJournalId, whisperTo, whisperToName, nameColor, safeKey, actualChannel, standingImg, tokenId, standingLabel, imageWide, imageMeta);
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

window.chatKeydown = chatKeydown;
window.sendChat = sendChat;
window.handleChatImageUpload = handleChatImageUpload;
window.togglePendingChatImageWide = togglePendingChatImageWide;
window.clearPendingChatImages = clearPendingChatImages;
window.refreshChatActionButtons = refreshChatActionButtons;
window.clearAllChatHistory = clearAllChatHistory;
window.toggleDescMode = toggleDescMode;
window.broadcastTyping = broadcastTyping;
window.queueMessageRender = queueMessageRender;
window.replaceRenderedMessage = replaceRenderedMessage;
window.removeRenderedMessage = removeRenderedMessage;
window.resetRenderedMessages = resetRenderedMessages;
window.getChatImageClassName = getChatImageClassName;
window.getChatImageInlineStyle = getChatImageInlineStyle;
