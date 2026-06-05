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


