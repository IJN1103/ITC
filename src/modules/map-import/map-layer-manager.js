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
      const panelTokenId = String(item?.panelTokenId || '').trim();
      entries.push({
        id: layerId,
        name: label,
        sub: `object ${index + 1}`,
        target: panelTokenId ? `tok-${panelTokenId}` : `[data-map-layer-id="${layerId.replace(/"/g, '\"')}"]`,
        previewUrl: String(item?.previewUrl || item?.url || '').trim(),
        panelTokenId,
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

  function getMapObjectByLayerId(layerId) {
    const state = getStateRoot().mapState || {};
    const objects = Array.isArray(state.objects) ? state.objects : [];
    return objects.find((item, index) => String(item?.layerId || `object:${item?.id || index + 1}`) === String(layerId || '')) || null;
  }

  function canDeleteLayer(entry) {
    if (!entry?.id) return false;
    const item = getMapObjectByLayerId(entry.id);
    return !!item;
  }

  async function deleteMapLayerEntry(layerId) {
    const id = String(layerId || '').trim();
    if (!id) return;
    const stateRoot = getStateRoot();
    const currentState = stateRoot.mapState || {};
    const currentObjects = Array.isArray(currentState.objects) ? currentState.objects : [];
    const removed = [];
    const nextObjects = currentObjects.filter((item, index) => {
      const itemLayerId = String(item?.layerId || `object:${item?.id || index + 1}`);
      if (itemLayerId === id) {
        removed.push(item);
        return false;
      }
      return true;
    });
    if (!removed.length) return;

    const nextLayerState = normalizeLayerState(stateRoot.mapLayerState || null);
    nextLayerState.order = nextLayerState.order.filter((layerId) => layerId !== id);
    if (nextLayerState.visible && typeof nextLayerState.visible === 'object') {
      delete nextLayerState.visible[id];
    }

    stateRoot.mapState = { ...currentState, objects: nextObjects };
    stateRoot.mapLayerState = nextLayerState;
    if (typeof applyImportedMapState === 'function') applyImportedMapState(stateRoot.mapState);
    applyMapLayerState();
    renderMapLayerList();

    if (!window._FB?.CONFIGURED) return;
    const roomCode = getLiveRoomCode();
    if (!roomCode || roomCode === 'local') return;

    const tokenDeletes = {};
    removed.forEach((item) => {
      const panelTokenId = String(item?.panelTokenId || '').trim();
      if (panelTokenId) tokenDeletes[panelTokenId] = null;
    });

    const payload = {
      'bgm/mapObjects': nextObjects,
      'bgm/mapLayerState': nextLayerState,
    };
    Object.entries(tokenDeletes).forEach(([tokenId, value]) => {
      payload[`tokens/${tokenId}`] = value;
    });
    const { db, ref, update } = window._FB;
    await update(ref(db, `rooms/${roomCode}`), payload);
  }

  function confirmDeleteLayer(entry) {
    if (!entry?.id || !canDeleteLayer(entry)) return;
    const label = String(entry?.name || '이 레이어').trim() || '이 레이어';
    const ok = window.confirm(`'${label}' 레이어를 삭제할까요?
연결된 맵세팅 패널도 함께 삭제됩니다.`);
    if (!ok) return;
    deleteMapLayerEntry(entry.id)
      .then(() => { if (typeof showToast === 'function') showToast('맵세팅 레이어를 삭제했어요.'); })
      .catch((err) => {
        console.error('deleteMapLayerEntry failed', err);
        if (typeof showToast === 'function') showToast('레이어 삭제 중 오류가 발생했어요.');
        if (typeof refreshMapLayerManager === 'function') refreshMapLayerManager();
      });
  }

  function getDeletableObjectLayers() {
    const state = getStateRoot().mapState || {};
    const objects = Array.isArray(state.objects) ? state.objects : [];
    return objects.map((item, index) => ({
      layerId: String(item?.layerId || `object:${item?.id || index + 1}`),
      panelTokenId: String(item?.panelTokenId || '').trim(),
    }));
  }

  async function deleteAllObjectLayers() {
    const deletable = getDeletableObjectLayers();
    if (!deletable.length) return;
    const removeLayerIds = new Set(deletable.map((item) => item.layerId));
    const stateRoot = getStateRoot();
    const currentState = stateRoot.mapState || {};
    const nextObjects = [];
    const nextLayerState = normalizeLayerState(stateRoot.mapLayerState || null);
    nextLayerState.order = nextLayerState.order.filter((layerId) => !removeLayerIds.has(layerId));
    if (nextLayerState.visible && typeof nextLayerState.visible === 'object') {
      removeLayerIds.forEach((layerId) => { delete nextLayerState.visible[layerId]; });
    }

    stateRoot.mapState = { ...currentState, objects: nextObjects };
    stateRoot.mapLayerState = nextLayerState;
    if (typeof applyImportedMapState === 'function') applyImportedMapState(stateRoot.mapState);
    applyMapLayerState();
    renderMapLayerList();

    if (!window._FB?.CONFIGURED) return;
    const roomCode = getLiveRoomCode();
    if (!roomCode || roomCode === 'local') return;

    const tokenDeletes = {};
    deletable.forEach((item) => {
      if (item.panelTokenId) tokenDeletes[item.panelTokenId] = null;
    });

    const payload = {
      'bgm/mapObjects': nextObjects,
      'bgm/mapLayerState': nextLayerState,
    };
    Object.entries(tokenDeletes).forEach(([tokenId, value]) => {
      payload[`tokens/${tokenId}`] = value;
    });
    const { db, ref, update } = window._FB;
    await update(ref(db, `rooms/${roomCode}`), payload);
  }

  function confirmDeleteAllObjectLayers() {
    const count = getDeletableObjectLayers().length;
    if (!count) {
      if (typeof showToast === 'function') showToast('삭제할 맵세팅 오브젝트 레이어가 없어요.');
      return;
    }
    const ok = window.confirm(`맵세팅 오브젝트 레이어 ${count}개를 모두 삭제할까요?
배경/전경은 유지되고, 연결된 맵세팅 패널만 함께 삭제됩니다.`);
    if (!ok) return;
    deleteAllObjectLayers()
      .then(() => { if (typeof showToast === 'function') showToast('맵세팅 오브젝트 레이어를 모두 삭제했어요.'); })
      .catch((err) => {
        console.error('deleteAllObjectLayers failed', err);
        if (typeof showToast === 'function') showToast('전체삭제 중 오류가 발생했어요.');
        if (typeof refreshMapLayerManager === 'function') refreshMapLayerManager();
      });
  }

  function ensureMapLayerBulkActions(list, entries) {
    const modal = document.getElementById('modal-map-layers');
    if (!modal || !list) return;
    let bar = document.getElementById('map-layer-bulk-actions');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'map-layer-bulk-actions';
      bar.className = 'map-layer-bulk-actions';
      list.parentNode?.insertBefore(bar, list);
    }
    const objectCount = Array.isArray(entries) ? entries.filter((entry) => canDeleteLayer(entry)).length : 0;
    bar.innerHTML = objectCount > 0
      ? '<button type="button" id="map-layer-delete-all" class="map-layer-bulk-delete">오브젝트 전체삭제</button>'
      : '';
    const btn = document.getElementById('map-layer-delete-all');
    btn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      confirmDeleteAllObjectLayers();
    });
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


  function getImportedPanelVisibilityPayload(visibleMap) {
    const state = getStateRoot().mapState || {};
    const objects = Array.isArray(state.objects) ? state.objects : [];
    const payload = {};
    objects.forEach((item) => {
      const layerId = String(item?.layerId || '').trim();
      const panelTokenId = String(item?.panelTokenId || '').trim();
      if (!layerId || !panelTokenId) return;
      payload[`${panelTokenId}/importedMapObjectHidden`] = visibleMap[layerId] === false;
    });
    return payload;
  }

  async function syncImportedPanelVisibility(roomCode, visibleMap) {
    if (!window._FB?.CONFIGURED) return;
    const payload = getImportedPanelVisibilityPayload(visibleMap);
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
    const payload = {
      'bgm/mapLayerState': normalized,
      ...getImportedPanelPriorityPayload(normalized.order),
      ...getImportedPanelVisibilityPayload(normalized.visible),
    };
    const { db, ref, update } = window._FB;
    await update(ref(db, `rooms/${roomCode}`), payload);
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
    ensureMapLayerBulkActions(list, entries);
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
      const canDelete = canDeleteLayer(entry);
      item.innerHTML = `
        <div class="map-layer-handle">☰</div>
        <div class="map-layer-preview ${entry.previewUrl ? 'has-image' : ''}" aria-hidden="true">${previewHtml}</div>
        <div class="map-layer-name"><span class="map-layer-label">${entry.name}</span><span class="map-layer-sub">${entry.sub}</span></div>
        <button class="map-layer-eye ${normalized.visible[id] === false ? 'off' : ''}" type="button">${createEyeIcon(normalized.visible[id] !== false)}</button>
        ${canDelete ? '<button class="map-layer-delete" type="button" title="레이어 삭제" aria-label="레이어 삭제">✕</button>' : ''}
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
      const del = item.querySelector('.map-layer-delete');
      del?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        confirmDeleteLayer(entry);
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
