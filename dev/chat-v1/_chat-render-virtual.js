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


