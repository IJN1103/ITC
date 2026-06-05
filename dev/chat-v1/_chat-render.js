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
    if (getRenderedNodeByKey(channel, key)) return;
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
    insertRenderedNodeInStoredOrder(channel, node, key);
  });

  removeDuplicateRenderedMessages(channel);
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



