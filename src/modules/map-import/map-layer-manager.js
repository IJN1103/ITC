(function () {
  let _dragLayerId = null;

  function getStateRoot() {
    const root = (typeof window !== 'undefined' ? window : globalThis);
    if (root.St && typeof root.St === 'object') return root.St;
    if (typeof St !== 'undefined' && St && typeof St === 'object') {
      root.St = St;
      return root.St;
    }
    root.St = { roomCode: '', mapState: {}, mapLayerState: null, isGM: false };
    return root.St;
  }

  function getLayerEntries() {
    const state = getStateRoot().mapState || {};
    const entries = [];
    if (state.background?.url) {
      entries.push({ id: 'background', name: '배경 이미지', sub: 'backgroundUrl', target: 'map-bg-layer', previewUrl: state.background.url });
    }
    const objects = Array.isArray(state.objects) ? state.objects : [];
    objects.forEach((item, index) => {
      const layerId = String(item?.layerId || `object:${item?.id || index + 1}`);
      const label = String(item?.name || '').trim() || String(item?.imageName || '').trim() || `오브젝트 ${index + 1}`;
      entries.push({
        id: layerId,
        name: label,
        sub: `object ${index + 1}`,
        target: `[data-map-layer-id="${layerId.replace(/"/g, '\"')}"]`,
        previewUrl: String(item?.url || '').trim(),
      });
    });
    if (state.foreground?.url) {
      entries.push({ id: 'foreground', name: '전경 이미지', sub: 'foregroundUrl', target: 'map-fg-layer', previewUrl: state.foreground.url });
    }
    return entries;
  }

  function getAvailableLayerIds() {
    return getLayerEntries().map((entry) => entry.id);
  }

  function getDefaultLayerState() {
    const ids = getAvailableLayerIds();
    return {
      order: ids.slice(),
      visible: Object.fromEntries(ids.map((id) => [id, true])),
    };
  }

  function normalizeLayerState(raw) {
    const ids = getAvailableLayerIds();
    const defaults = getDefaultLayerState();
    if (!ids.length) return defaults;
    const rawOrder = Array.isArray(raw?.order) ? raw.order.map(String) : [];
    const order = rawOrder.filter((id) => ids.includes(id));
    ids.forEach((id) => {
      if (!order.includes(id)) order.push(id);
    });
    const visible = { ...defaults.visible };
    if (raw?.visible && typeof raw.visible === 'object') {
      ids.forEach((id) => {
        if (typeof raw.visible[id] === 'boolean') visible[id] = raw.visible[id];
      });
    }
    return { order, visible };
  }

  function getLiveRoomCode() {
    return String(
      getStateRoot().roomCode ||
      sessionStorage.getItem('itc_session_code') ||
      document.getElementById('topbar-code')?.textContent ||
      ''
    ).trim();
  }

  function getDropInsertIndex(order, targetId, position) {
    const targetIndex = order.indexOf(targetId);
    if (targetIndex < 0) return order.length;
    return position === 'after' ? targetIndex + 1 : targetIndex;
  }

  function resolveLayerElement(entry) {
    if (!entry?.target) return null;
    if (entry.target.startsWith('[')) return document.querySelector(entry.target);
    return document.getElementById(entry.target);
  }


  function getImportedPanelPriorityPayload(order) {
    const state = getStateRoot().mapState || {};
    const objects = Array.isArray(state.objects) ? state.objects : [];
    const objectMap = new Map(objects.map((item) => [String(item?.layerId || ''), item]));
    const payload = {};
    let nextPriority = 1000;
    order.forEach((layerId) => {
      const item = objectMap.get(String(layerId || ''));
      const panelTokenId = String(item?.panelTokenId || '').trim();
      if (!panelTokenId) return;
      payload[`${panelTokenId}/panelPriority`] = nextPriority;
      nextPriority += 1;
    });
    return payload;
  }

  async function syncImportedPanelLayerOrder(roomCode, order) {
    if (!window._FB?.CONFIGURED) return;
    const payload = getImportedPanelPriorityPayload(order);
    if (!Object.keys(payload).length) return;
    const { db, ref, update } = window._FB;
    await update(ref(db, `rooms/${roomCode}/tokens`), payload);
  }

  function applyMapLayerState() {
    const entries = getLayerEntries();
    const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
    const stateRoot = getStateRoot();
    const normalized = normalizeLayerState(stateRoot.mapLayerState || null);
    stateRoot.mapLayerState = normalized;
    normalized.order.forEach((id, index) => {
      const entry = entryMap.get(id);
      const el = resolveLayerElement(entry);
      if (!el) return;
      el.style.display = normalized.visible[id] === false ? 'none' : '';
      el.style.zIndex = String(index);
    });
  }

  async function saveMapLayerState(nextState) {
    const normalized = normalizeLayerState(nextState);
    getStateRoot().mapLayerState = normalized;
    applyMapLayerState();
    if (!window._FB?.CONFIGURED) return;
    const roomCode = getLiveRoomCode();
    if (!roomCode || roomCode === 'local') return;
    const { db, ref, update } = window._FB;
    await update(ref(db, `rooms/${roomCode}/bgm`), { mapLayerState: normalized });
    await syncImportedPanelLayerOrder(roomCode, normalized.order);
  }

  function createEyeIcon(isVisible) {
    return isVisible
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 18 18"/><path d="M10.58 10.58a2 2 0 1 0 2.83 2.83"/><path d="M9.88 4.24A10.94 10.94 0 0 1 12 4c4.29 0 7.92 2.5 9.54 6.11a1 1 0 0 1 0 .78 10.96 10.96 0 0 1-4.17 4.84"/><path d="M6.61 6.61A10.95 10.95 0 0 0 2.46 11.1a1 1 0 0 0 0 .8C4.08 15.5 7.71 18 12 18c1.5 0 2.93-.3 4.24-.85"/></svg>';
  }

  function renderMapLayerList() {
    const list = document.getElementById('map-layer-list');
    const empty = document.getElementById('map-layer-empty');
    if (!list || !empty) return;
    const entries = getLayerEntries();
    const stateRoot = getStateRoot();
    const normalized = normalizeLayerState(stateRoot.mapLayerState || null);
    stateRoot.mapLayerState = normalized;
    list.innerHTML = '';
    empty.style.display = entries.length ? 'none' : '';
    if (!entries.length) return;

    const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
    normalized.order.forEach((id) => {
      const entry = entryMap.get(id);
      if (!entry) return;
      const item = document.createElement('div');
      item.className = 'map-layer-item';
      item.draggable = true;
      item.dataset.layerId = id;
      const previewHtml = entry.previewUrl
        ? `<img class="map-layer-preview-img" src="${String(entry.previewUrl).replace(/"/g, '&quot;')}" alt="" loading="lazy" decoding="async">`
        : '';
      item.innerHTML = `
        <div class="map-layer-handle">☰</div>
        <div class="map-layer-preview ${entry.previewUrl ? 'has-image' : ''}" aria-hidden="true">${previewHtml}</div>
        <div class="map-layer-name"><span class="map-layer-label">${entry.name}</span><span class="map-layer-sub">${entry.sub}</span></div>
        <button class="map-layer-eye ${normalized.visible[id] === false ? 'off' : ''}" type="button">${createEyeIcon(normalized.visible[id] !== false)}</button>
      `;
      const eye = item.querySelector('.map-layer-eye');
      eye?.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = normalizeLayerState(getStateRoot().mapLayerState || null);
        next.visible[id] = !(next.visible[id] !== false);
        await saveMapLayerState(next);
        renderMapLayerList();
      });
      item.addEventListener('dragstart', (e) => {
        _dragLayerId = id;
        item.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', id);
        }
      });
      item.addEventListener('dragend', () => {
        _dragLayerId = null;
        item.classList.remove('dragging');
        delete item.dataset.dropPosition;
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        const rect = item.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        item.dataset.dropPosition = offsetY >= rect.height / 2 ? 'after' : 'before';
      });
      item.addEventListener('dragleave', () => {
        delete item.dataset.dropPosition;
      });
      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        const targetId = item.dataset.layerId;
        const dropPosition = item.dataset.dropPosition === 'after' ? 'after' : 'before';
        delete item.dataset.dropPosition;
        if (!_dragLayerId || !targetId || _dragLayerId === targetId) return;
        const next = normalizeLayerState(getStateRoot().mapLayerState || null);
        const order = next.order.filter((layerId) => layerId !== _dragLayerId);
        const insertIndex = getDropInsertIndex(order, targetId, dropPosition);
        order.splice(insertIndex, 0, _dragLayerId);
        if (order.join('|') === next.order.join('|')) return;
        next.order = order;
        await saveMapLayerState(next);
        renderMapLayerList();
      });
      list.appendChild(item);
    });
  }

  function openMapLayerManager() {
    if (typeof requireGM === 'function' && !requireGM('map layer manager')) return;
    refreshMapLayerManager();
    if (typeof openModal === 'function') openModal('modal-map-layers');
  }

  function refreshMapLayerManager() {
    applyMapLayerState();
    renderMapLayerList();
  }

  window.openMapLayerManager = openMapLayerManager;
  window.openMapLayerManagerModal = openMapLayerManager;
  window.refreshMapLayerManager = refreshMapLayerManager;
  window.applyMapLayerState = applyMapLayerState;
})();
