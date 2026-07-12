(function () {
  let _dragLayerId = null;
  let _dragCharTokenId = null; // 캐릭터 토큰 드래그용

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

  function getLayerPreviewImageUrl(src) {
    const raw = String(src || '').trim();
    if (!raw) return '';
    if (typeof _itcGetMapLayerThumbSrc === 'function') return _itcGetMapLayerThumbSrc(raw);
    return raw;
  }

  function getLayerEntries() {
    const state = getStateRoot().mapState || {};
    const entries = [];
    const sourceMode = state?.importedCanvas?.engine === 'cocofolia-source-space';
    if (state.background?.url) {
      entries.push({ id: 'background', name: '배경 이미지', sub: 'backgroundUrl', target: sourceMode ? 'cocofolia-world-background-layer' : 'map-bg-layer', previewUrl: state.background.url });
    }
    const objects = Array.isArray(state.objects) ? state.objects : [];
    const tokens = getStateRoot().tokens || {};
    const negativeObjects = [];
    const nonNegativeObjects = [];
    objects.forEach((item, index) => {
      const layerId = String(item?.layerId || `object:${item?.id || index + 1}`);
      const panelTokenId = String(item?.panelTokenId || '').trim();
      // 레이어 이름: 연결된 토큰 메모 우선, 없으면 NO TEXT
      let label = 'NO TEXT';
      if (panelTokenId && tokens[panelTokenId]) {
        const memo = String(tokens[panelTokenId]?.memo || '').trim();
        label = memo || 'NO TEXT';
      } else {
        const memo = String(item?.memo || '').trim();
        label = memo || 'NO TEXT';
      }
      const entry = {
        id: layerId,
        name: label,
        sub: `오브젝트 ${index + 1}`,
        target: panelTokenId ? `tok-${panelTokenId}` : `[data-map-layer-id="${layerId.replace(/"/g, '\"')}"]`,
        previewUrl: String(item?.previewUrl || item?.url || '').trim(),
        panelTokenId,
        sourceZ: Number(item?.sourceZ || 0),
      };
      (entry.sourceZ < 0 ? negativeObjects : nonNegativeObjects).push(entry);
    });
    entries.push(...negativeObjects);
    if (state.foreground?.url) {
      entries.push({ id: 'foreground', name: '전경 이미지', sub: 'foregroundUrl', target: sourceMode ? 'cocofolia-world-foreground-layer' : 'map-fg-layer', previewUrl: state.foreground.url });
    }
    entries.push(...nonNegativeObjects);
    return entries;
  }

  /* map-token.js의 isPanelToken과 완전히 동일한 판별 로직 */
  function _isLayerManagerPanelToken(token) {
    if (!token) return false;
    const type = String(token.type || '').trim();
    const category = String(token.tokenCategory || '').trim();
    if (type === 'panel' || category === 'panel' || token.panelToken === true) return true;
    if (token.importedMapObject === true) return true;
    if (token.panelImage || token.panelBackImage || token.panelWidth || token.panelHeight || token.panelFace) return true;
    return false;
  }

  /* 패널 토큰 / 캐릭터 토큰 섹션용 엔트리
     - mapState.objects와 연결된 panelTokenId 토큰은 맵세팅 레이어 섹션에서 처리하므로 제외
     - importedMapObject === true 토큰도 맵세팅 레이어가 관리하므로 제외 */
  function getTokenSectionEntries() {
    const stateRoot = getStateRoot();
    const tokens = stateRoot.tokens || {};
    const panel = [];
    const character = [];

    // 맵세팅 레이어와 연결된 panelTokenId 수집
    const state = stateRoot.mapState || {};
    const objects = Array.isArray(state.objects) ? state.objects : [];
    const importedPanelTokenIds = new Set(
      objects.map((item) => String(item?.panelTokenId || '').trim()).filter(Boolean)
    );

    Object.values(tokens).forEach((token) => {
      if (!token?.id) return;
      // 맵세팅 레이어가 이미 관리하는 토큰은 제외
      if (importedPanelTokenIds.has(String(token.id))) return;
      if (token.importedMapObject === true) return;

      const memo = String(token.memo || '').trim();
      const name = memo || 'NO TEXT';
      const entry = {
        id: `token:${token.id}`,
        tokenId: String(token.id),
        name,
        sub: token.name || '',
        previewUrl: token.tokenImg || token.panelImage || '',
        isTokenEntry: true,
      };
      if (_isLayerManagerPanelToken(token)) panel.push(entry);
      else character.push(entry);
    });
    return { panel, character };
  }


  function getAvailableLayerIds() {
    return getLayerEntries().map((entry) => entry.id);
  }

  function getDefaultLayerState() {
    const entries = getLayerEntries();
    const tokens = getStateRoot().tokens || {};
    // 코코폴리아 active:false 오브젝트는 importedMapObjectHidden:true로 임포트되므로
    // 기본 visible 값도 토큰의 실제 hidden 상태를 반영한다.
    const visible = {};
    entries.forEach((entry) => {
      const panelTokenId = String(entry.panelTokenId || '').trim();
      if (panelTokenId && tokens[panelTokenId]) {
        visible[entry.id] = !tokens[panelTokenId].importedMapObjectHidden;
      } else {
        visible[entry.id] = true;
      }
    });
    return {
      order: entries.map((e) => e.id),
      visible,
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

  function requestActiveSceneSave(reason) {
    const root = (typeof window !== 'undefined' ? window : globalThis);
    if (typeof root.requestActiveMapSceneSave !== 'function') return;
    try {
      root.requestActiveMapSceneSave(reason || 'map-layer-change', 260);
    } catch (e) {
      console.warn('requestActiveMapSceneSave failed', reason || '', e);
    }
  }

  function pushLocalRoomMapState(mapState, layerState, reason) {
    const root = (typeof window !== 'undefined' ? window : globalThis);
    if (typeof root._itcApplyRoomMapStateLocal !== 'function') return false;
    try {
      root._itcApplyRoomMapStateLocal(mapState, layerState, reason || 'map-layer-local');
      return true;
    } catch (e) {
      console.warn('pushLocalRoomMapState failed', reason || '', e);
      return false;
    }
  }

  function getDropInsertIndex(order, targetId, position) {
    const targetIndex = order.indexOf(targetId);
    if (targetIndex < 0) return order.length;
    return position === 'after' ? targetIndex + 1 : targetIndex;
  }

  function getLayerZIndex(layerId, orderIndex) {
    const id = String(layerId || '');
    if (id === 'background') return 0;
    return Math.max(1, Number(orderIndex || 0));
  }

  function syncImportedPanelTokenLocalState(entry, visible, zIndex, options = {}) {
    const panelTokenId = String(entry?.panelTokenId || '').trim();
    if (!panelTokenId) return;
    const stateRoot = getStateRoot();
    if (!stateRoot.tokens || typeof stateRoot.tokens !== 'object') return;
    const token = stateRoot.tokens[panelTokenId];
    if (!token) return;
    token.panelPriority = zIndex;
    // 가시성은 사용자 조작을 저장할 때만 토큰에 반영한다.
    // 실시간 mapLayerState 재수신/장면 복원 시 오래된 visible 값이
    // 최신 토큰 가시성을 다시 덮어쓰지 못하도록 한다.
    if (options.commitVisibility === true && typeof visible === 'boolean') {
      token.importedMapObjectHidden = !visible;
    }
  }

  function getCanonicalImportedPanelVisibility(entry, fallbackVisible = true) {
    const panelTokenId = String(entry?.panelTokenId || '').trim();
    const token = panelTokenId ? getStateRoot().tokens?.[panelTokenId] : null;
    if (token && typeof token.importedMapObjectHidden === 'boolean') {
      return !token.importedMapObjectHidden;
    }
    return fallbackVisible !== false;
  }

  function commitImportedPanelVisibilityFromLayerState(layerState) {
    const entries = getLayerEntries();
    const visibleMap = layerState?.visible && typeof layerState.visible === 'object'
      ? layerState.visible
      : {};
    entries.forEach((entry, index) => {
      if (!entry?.panelTokenId) return;
      if (typeof visibleMap[entry.id] !== 'boolean') return;
      const zIndex = getLayerZIndex(entry.id, index);
      syncImportedPanelTokenLocalState(entry, visibleMap[entry.id], zIndex, { commitVisibility: true });
    });
  }

  function resolveLayerElement(entry) {
    if (!entry?.target) return null;
    if (entry.target.startsWith('[')) return document.querySelector(entry.target);
    return document.getElementById(entry.target);
  }

  function setLayerElementVisibility(el, visible) {
    if (!el) return;
    if (visible) {
      el.classList.remove('map-layer-runtime-hidden');
      el.style.display = '';
      el.style.visibility = '';
      el.style.opacity = '';
      if (typeof window.ensureLazyMapLayerElementImage === 'function') {
        window.ensureLazyMapLayerElementImage(el);
      }
    } else {
      el.style.display = 'none';
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
      el.classList.add('map-layer-runtime-hidden');
      if (el.dataset?.itcMapLazyBgSrc) el.style.backgroundImage = '';
    }
  }

  function prefixTokenPayload(payload) {
    const result = {};
    Object.entries(payload || {}).forEach(([key, value]) => {
      const safeKey = String(key || '').trim();
      if (!safeKey) return;
      result[`tokens/${safeKey}`] = value;
    });
    return result;
  }

  function getMapObjectByLayerId(layerId) {
    const state = getStateRoot().mapState || {};
    const objects = Array.isArray(state.objects) ? state.objects : [];
    return objects.find((item, index) => String(item?.layerId || `object:${item?.id || index + 1}`) === String(layerId || '')) || null;
  }


  function removeImportedPanelTokensFromLocalState(panelTokenIds) {
    const ids = Array.isArray(panelTokenIds)
      ? panelTokenIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (!ids.length) return;
    const stateRoot = getStateRoot();
    stateRoot.tokens = stateRoot.tokens || {};
    ids.forEach((tokenId) => {
      delete stateRoot.tokens[tokenId];
      if (typeof removeSingleToken === 'function') removeSingleToken(tokenId);
      else document.getElementById(`tok-${tokenId}`)?.remove();
    });
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

    removeImportedPanelTokensFromLocalState(removed.map((item) => item?.panelTokenId));
    stateRoot.mapState = { ...currentState, objects: nextObjects };
    stateRoot.mapLayerState = nextLayerState;
    if (!pushLocalRoomMapState(stateRoot.mapState, nextLayerState, 'map-layer-delete-local')) {
      if (typeof applyImportedMapState === 'function') applyImportedMapState(stateRoot.mapState);
      applyMapLayerState();
    }
    renderMapLayerList();
    requestActiveSceneSave('map-layer-delete');

    if (!window._FB?.CONFIGURED) return;
    const roomCode = getLiveRoomCode();
    if (!roomCode || roomCode === 'local') return;

    const tokenDeletes = {};
    removed.forEach((item) => {
      const panelTokenId = String(item?.panelTokenId || '').trim();
      if (panelTokenId) tokenDeletes[panelTokenId] = null;
    });

    const payload = {
      mapState: stateRoot.mapState,
      mapLayerState: nextLayerState,
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
    const currentMapState = getStateRoot().mapState || {};
    const hasBackground = !!currentMapState.background?.url;
    const hasForeground = !!currentMapState.foreground?.url;
    if (!deletable.length && !hasBackground && !hasForeground) return;
    const removeLayerIds = new Set(deletable.map((item) => item.layerId));
    if (hasBackground) removeLayerIds.add('background');
    if (hasForeground) removeLayerIds.add('foreground');
    const stateRoot = getStateRoot();
    const currentState = stateRoot.mapState || {};
    const nextObjects = [];
    const nextLayerState = normalizeLayerState(stateRoot.mapLayerState || null);
    nextLayerState.order = nextLayerState.order.filter((layerId) => !removeLayerIds.has(layerId));
    if (nextLayerState.visible && typeof nextLayerState.visible === 'object') {
      removeLayerIds.forEach((layerId) => { delete nextLayerState.visible[layerId]; });
    }

    removeImportedPanelTokensFromLocalState(deletable.map((item) => item?.panelTokenId));
    stateRoot.mapState = { ...currentState, background: null, foreground: null, objects: nextObjects };
    stateRoot.mapLayerState = nextLayerState;
    if (!pushLocalRoomMapState(stateRoot.mapState, nextLayerState, 'map-layer-delete-all-local')) {
      if (typeof applyImportedMapState === 'function') applyImportedMapState(stateRoot.mapState);
      applyMapLayerState();
    }
    renderMapLayerList();
    requestActiveSceneSave('map-layer-delete');

    if (!window._FB?.CONFIGURED) return;
    const roomCode = getLiveRoomCode();
    if (!roomCode || roomCode === 'local') return;

    const tokenDeletes = {};
    deletable.forEach((item) => {
      if (item.panelTokenId) tokenDeletes[item.panelTokenId] = null;
    });

    const payload = {
      mapState: stateRoot.mapState,
      mapLayerState: nextLayerState,
      'bgm/mapBackground': '',
      'bgm/mapBackgroundFit': '',
      'bgm/mapBackgroundSourceName': '',
      'bgm/mapBackgroundImportedAt': 0,
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
    const currentMapState = getStateRoot().mapState || {};
    const hasBackground = !!currentMapState.background?.url;
    const hasForeground = !!currentMapState.foreground?.url;
    if (!count && !hasBackground && !hasForeground) {
      if (typeof showToast === 'function') showToast('삭제할 맵세팅 레이어가 없어요.');
      return;
    }
    const objectPart = count > 0 ? `오브젝트 레이어 ${count}개` : '';
    const bgPart = hasBackground ? '배경 이미지' : '';
    const fgPart = hasForeground ? '전경 이미지' : '';
    const targetLabel = [objectPart, bgPart, fgPart].filter(Boolean).join('와 ');
    const panelLine = count > 0 ? '\n연결된 맵세팅 패널도 함께 삭제됩니다.' : '';
    const ok = window.confirm(`맵세팅 ${targetLabel || '레이어'}를 전체 삭제할까요?${panelLine}`);
    if (!ok) return;
    deleteAllObjectLayers()
      .then(() => { if (typeof showToast === 'function') showToast('맵세팅 레이어와 배경 이미지를 모두 삭제했어요.'); })
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
    const safeEntries = Array.isArray(entries) ? entries : [];
    const objectCount = safeEntries.filter((entry) => canDeleteLayer(entry)).length;
    const hasBackground = safeEntries.some((entry) => String(entry?.id || '') === 'background');
    bar.innerHTML = (objectCount > 0 || hasBackground)
      ? '<button type="button" id="map-layer-delete-all" class="map-layer-bulk-delete">전체 삭제</button>'
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
    order.forEach((layerId, index) => {
      const item = objectMap.get(String(layerId || ''));
      const panelTokenId = String(item?.panelTokenId || '').trim();
      if (!panelTokenId) return;
      payload[`${panelTokenId}/panelPriority`] = getLayerZIndex(layerId, index);
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
    const tokens = stateRoot.tokens || {};
    const normalized = normalizeLayerState(stateRoot.mapLayerState || null);
    stateRoot.mapLayerState = normalized;
    normalized.order.forEach((id, index) => {
      const entry = entryMap.get(id);
      // panelToken의 importedMapObjectHidden이 명시적으로 설정된 경우 이를 우선한다.
      // layerState.visible은 사용자가 눈 아이콘으로 명시적으로 바꾼 경우에만 우선 적용.
      const fallbackVisible = typeof normalized.visible[id] === 'boolean'
        ? normalized.visible[id]
        : true;
      // 임포트 패널 토큰의 importedMapObjectHidden을 단일 기준으로 사용한다.
      // 장면/룸 상태에서 늦게 도착한 오래된 mapLayerState.visible 값은
      // 현재 토큰 가시성을 덮어쓰지 않는다.
      const visible = entry?.panelTokenId
        ? getCanonicalImportedPanelVisibility(entry, fallbackVisible)
        : fallbackVisible;
      normalized.visible[id] = visible;
      const zIndex = getLayerZIndex(id, index);
      syncImportedPanelTokenLocalState(entry, visible, zIndex);
      const el = resolveLayerElement(entry);
      if (!el) return;
      setLayerElementVisibility(el, visible);
      el.style.zIndex = String(zIndex);
    });
  }

  async function saveMapLayerState(nextState) {
    // 눈 아이콘 등 명시적 사용자 조작은 먼저 토큰 가시성에 반영한다.
    // 이후 normalize/apply 단계에서는 이 토큰 값을 단일 기준으로 사용한다.
    commitImportedPanelVisibilityFromLayerState(nextState);
    const normalized = normalizeLayerState(nextState);
    const stateRoot = getStateRoot();
    stateRoot.mapLayerState = normalized;
    applyMapLayerState();
    pushLocalRoomMapState(undefined, normalized, 'map-layer-state-local');
    requestActiveSceneSave('map-layer-state-change');
    if (!window._FB?.CONFIGURED) return;
    const roomCode = getLiveRoomCode();
    if (!roomCode || roomCode === 'local') return;
    const payload = {
      mapLayerState: normalized,
      'bgm/mapLayerState': normalized,
      ...prefixTokenPayload(getImportedPanelPriorityPayload(normalized.order)),
      ...prefixTokenPayload(getImportedPanelVisibilityPayload(normalized.visible)),
    };
    const { db, ref, update } = window._FB;
    await update(ref(db, `rooms/${roomCode}`), payload);
  }

  function createEyeIcon(isVisible) {
    return isVisible
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 18 18"/><path d="M10.58 10.58a2 2 0 1 0 2.83 2.83"/><path d="M9.88 4.24A10.94 10.94 0 0 1 12 4c4.29 0 7.92 2.5 9.54 6.11a1 1 0 0 1 0 .78 10.96 10.96 0 0 1-4.17 4.84"/><path d="M6.61 6.61A10.95 10.95 0 0 0 2.46 11.1a1 1 0 0 0 0 .8C4.08 15.5 7.71 18 12 18c1.5 0 2.93-.3 4.24-.85"/></svg>';
  }

  function buildLayerItemEl(entry, normalized, opts) {
    opts = opts || {};
    const id = entry.id;
    const item = document.createElement('div');
    const isBgEntry = String(entry?.id || '') === 'background';
    item.className = 'map-layer-item' + (opts.noMemo ? ' map-layer-item--token' : '') + (isBgEntry ? ' map-layer-item--background' : '');
    item.draggable = !entry.isTokenEntry;
    item.dataset.layerId = id;
    const previewUrl = getLayerPreviewImageUrl(entry.previewUrl);
    const previewHtml = previewUrl
      ? `<img class="map-layer-preview-img" src="${String(previewUrl).replace(/"/g, '&quot;')}" alt="" loading="lazy" decoding="async">`
      : '';
    const isVisible = entry.isTokenEntry
      ? !(getStateRoot().tokens?.[entry.tokenId]?.importedMapObjectHidden)
      : normalized.visible[id] !== false;
    const canDelete = !entry.isTokenEntry && canDeleteLayer(entry);
    item.innerHTML = `
      ${!entry.isTokenEntry ? '<div class="map-layer-handle">☰</div>' : '<div class="map-layer-handle map-layer-handle--spacer"></div>'}
      <div class="map-layer-preview ${entry.previewUrl ? 'has-image' : ''}" aria-hidden="true">${previewHtml}</div>
      <div class="map-layer-name">
        <span class="map-layer-label ${entry.name === 'NO TEXT' ? 'map-layer-label--notext' : ''}">${entry.name}</span>
        ${entry.sub ? `<span class="map-layer-sub">${entry.sub}</span>` : ''}
      </div>
      <button class="map-layer-eye ${isVisible ? '' : 'off'}" type="button">${createEyeIcon(isVisible)}</button>
      ${canDelete ? '<button class="map-layer-delete" type="button" title="레이어 삭제" aria-label="레이어 삭제">✕</button>' : ''}
    `;
    // 가시성 토글
    const eye = item.querySelector('.map-layer-eye');
    eye?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (entry.isTokenEntry) {
        // 토큰 섹션: 토큰 자체의 importedMapObjectHidden 토글
        const token = getStateRoot().tokens?.[entry.tokenId];
        if (!token) return;
        const nextHidden = !token.importedMapObjectHidden;
        token.importedMapObjectHidden = nextHidden;
        const el = document.getElementById(`tok-${entry.tokenId}`);
        if (el) setLayerElementVisibility(el, !nextHidden);
        if (window._FB?.CONFIGURED) {
          const roomCode = getLiveRoomCode();
          if (roomCode) {
            const { db, ref, update } = window._FB;
            update(ref(db, `rooms/${roomCode}/tokens/${entry.tokenId}`), { importedMapObjectHidden: nextHidden }).catch((e) => console.warn('token visibility sync failed', e));
          }
        }
        renderMapLayerList();
      } else {
        const next = normalizeLayerState(getStateRoot().mapLayerState || null);
        next.visible[id] = !(next.visible[id] !== false);
        await saveMapLayerState(next);
        renderMapLayerList();
      }
    });
    // 삭제 버튼 (맵세팅 레이어만)
    const del = item.querySelector('.map-layer-delete');
    del?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      confirmDeleteLayer(entry);
    });
    // 더블클릭: 연결된 패널 토큰 설정창 열기 (맵세팅 레이어)
    if (!entry.isTokenEntry && entry.panelTokenId) {
      item.classList.add('map-layer-item--dblclick');
      item.addEventListener('dblclick', (e) => {
        e.preventDefault(); e.stopPropagation();
        _openTokenEditAboveLayerModal(entry.panelTokenId);
      });
    }
    // 우클릭 컨텍스트 메뉴
    item.addEventListener('contextmenu', (e) => {
      showLayerItemCtx(e, entry);
    });
    // 드래그 (맵세팅 레이어만)
    if (!entry.isTokenEntry) {
      item.addEventListener('dragstart', (e) => {
        _dragLayerId = id;
        item.classList.add('dragging');
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); }
      });
      item.addEventListener('dragend', () => {
        _dragLayerId = null;
        item.classList.remove('dragging');
        delete item.dataset.dropPosition;
      });
      // dragover/drop: 리스트 레벨 이벤트 위임으로 통합 처리
    }
    return item;
  }


  /* ── 캐릭터 토큰 레이어 아이템 (드래그 핸들 + 눈 토글 + 삭제) ── */
  function buildTokenLayerItemEl(entry, isChar) {
    const item = document.createElement('div');
    item.className = 'map-layer-item map-layer-item--token map-layer-item--dblclick';
    item.draggable = true;
    item.style.userSelect = 'none';
    item.dataset.charTokenId = entry.tokenId;
    const previewUrl = getLayerPreviewImageUrl(entry.previewUrl);
    const previewHtml = previewUrl
      ? `<img class="map-layer-preview-img" src="${String(previewUrl).replace(/"/g,'&quot;')}" alt="" loading="lazy" decoding="async">`
      : '';
    const token = getStateRoot().tokens?.[entry.tokenId];
    const isVisible = !token?.importedMapObjectHidden;
    item.innerHTML = `
      <div class="map-layer-handle" title="드래그하여 순서 변경">☰</div>
      <div class="map-layer-preview ${entry.previewUrl ? 'has-image' : ''}" aria-hidden="true">${previewHtml}</div>
      <div class="map-layer-name">
        <span class="map-layer-label ${entry.name === 'NO TEXT' ? 'map-layer-label--notext' : ''}">${entry.name}</span>
        ${entry.sub ? `<span class="map-layer-sub">${entry.sub}</span>` : ''}
      </div>
      <button class="map-layer-eye ${isVisible ? '' : 'off'}" type="button">${createEyeIcon(isVisible)}</button>
      ${isChar ? '<button class="map-layer-delete" type="button" title="토큰 삭제" aria-label="토큰 삭제">✕</button>' : ''}
    `;
    // 눈 아이콘 토글
    const eye = item.querySelector('.map-layer-eye');
    eye?.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const t = getStateRoot().tokens?.[entry.tokenId];
      if (!t) return;
      const nextHidden = !t.importedMapObjectHidden;
      t.importedMapObjectHidden = nextHidden;
      const el = document.getElementById(`tok-${entry.tokenId}`);
      if (el) setLayerElementVisibility(el, !nextHidden);
      if (window._FB?.CONFIGURED) {
        const roomCode = getLiveRoomCode();
        if (roomCode) {
          const { db, ref, update } = window._FB;
          update(ref(db, `rooms/${roomCode}/tokens/${entry.tokenId}`), { importedMapObjectHidden: nextHidden })
            .catch((e) => console.warn('token visibility sync failed', e));
        }
      }
      renderMapLayerList();
    });
    // 삭제 버튼 (캐릭터 토큰만)
    if (isChar) {
      const del = item.querySelector('.map-layer-delete');
      del?.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const t = getStateRoot().tokens?.[entry.tokenId];
        if (!t) return;
        if (!window.confirm(`'${t.name || entry.sub || '이 토큰'}' 토큰을 삭제할까요?`)) return;
        if (typeof removeToken === 'function') {
          removeToken(entry.tokenId);
        } else {
          delete getStateRoot().tokens[entry.tokenId];
          document.getElementById(`tok-${entry.tokenId}`)?.remove();
          if (window._FB?.CONFIGURED) {
            const roomCode = getLiveRoomCode();
            if (roomCode) {
              const { db, ref, remove } = window._FB;
              remove(ref(db, `rooms/${roomCode}/tokens/${entry.tokenId}`))
                .catch((e) => console.warn('token delete failed', e));
            }
          }
        }
        renderMapLayerList();
      });
    }
    // 더블클릭: 설정창 열기
    item.addEventListener('dblclick', (e) => {
      e.preventDefault(); e.stopPropagation();
      _openTokenEditAboveLayerModal(entry.tokenId);
    });
    // 우클릭 컨텍스트 메뉴
    item.addEventListener('contextmenu', (e) => {
      showLayerItemCtx(e, entry);
    });
    // ── 드래그: 캐릭터 토큰 순서 변경 ──
    item.addEventListener('dragstart', (e) => {
      _dragCharTokenId = entry.tokenId;
      _dragLayerId = null; // 맵레이어 드래그와 충돌 방지
      item.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'char:' + entry.tokenId);
      }
    });
    item.addEventListener('dragend', () => {
      _dragCharTokenId = null;
      item.classList.remove('dragging');
      delete item.dataset.dropPosition;
    });
    // dragover/drop: 리스트 레벨 이벤트 위임으로 통합 처리
    return item;
  }

  /* ── 메인 렌더: 통합 단일 리스트 (스크린 패널 + 캐릭터 토큰 인터리브) ──
     _changeLayerOrderUnified와 완전히 동일한 순서 로직으로 구성하여
     UI에 표시된 순서 = 실제 z-order가 보장된다.
     통합 순서: [맵세팅 order 순서..., 캐릭터 panelPriority 오름차순...]
     단, 캐릭터 panelPriority < 1000이면 맵세팅 레이어 사이에 끼워서 표시 */
  function renderMapLayerList() {
    const stateRoot = getStateRoot();
    const tokens = stateRoot.tokens || {};
    const normalized = normalizeLayerState(stateRoot.mapLayerState || null);
    stateRoot.mapLayerState = normalized;

    const mapList  = document.getElementById('map-layer-list');
    const mapEmpty = document.getElementById('map-layer-empty');
    const mapCount = document.getElementById('layer-count-map');
    if (!mapList) return;

    // ── 맵세팅 레이어 엔트리 ──
    const mapEntries = getLayerEntries();
    const entryMap   = new Map(mapEntries.map(e => [e.id, e]));

    // ── 캐릭터 토큰 엔트리 ──
    const { character: charEntriesRaw } = getTokenSectionEntries();
    // panelPriority 오름차순 정렬
    const charEntries = charEntriesRaw
      .map(e => {
        const t = tokens[e.tokenId];
        return { ...e, _z: Number(t?.panelPriority || 1000) };
      })
      .sort((a, b) => a._z - b._z);

    // ── 통합 순서 배열 구성 (_changeLayerOrderUnified와 동일 로직) ──
    // panelPriority < 1000인 캐릭터 토큰은 맵세팅 레이어 사이에 끼워 넣는다.
    // panelPriority >= 1000인 캐릭터 토큰은 맵세팅 레이어 전부 뒤(UI 상 위)에 배치.
    const mapLayerCount = normalized.order.length;

    // 통합 배열: map items + char items (맵이 먼저, 캐릭이 뒤 - 뒤 = z 낮음 = UI 아래)
    // UI에서는 배열의 앞(index 0) = 가장 뒤(z 낮음), 뒤(last) = 가장 앞(z 높음)
    // → 배열을 reverse해서 렌더 (맨 앞 = 리스트 최상단)
    const mapItems  = normalized.order.map(id => ({ kind: 'map', id }));
    const charBelowMap = charEntries.filter(e => e._z < 1000);
    const charAboveMap = charEntries.filter(e => e._z >= 1000);

    // z < 1000인 캐릭터: 맵세팅 레이어 사이 인터리브
    // z >= 1000인 캐릭터: 맵 전체보다 위 (unified 배열 뒤쪽)
    // 통합 배열 (z 오름차순 = 뒤 → 앞 순서)
    let unified = [];
    // charBelowMap를 z 위치에 맞춰 맵 사이에 삽입
    let charBelowIdx = 0;
    for (let i = 0; i < mapItems.length; i++) {
      // 이 맵 레이어의 z = i
      // z가 i 미만인 캐릭터를 먼저 삽입
      while (charBelowIdx < charBelowMap.length && charBelowMap[charBelowIdx]._z <= i) {
        unified.push({ kind: 'char', entry: charBelowMap[charBelowIdx] });
        charBelowIdx++;
      }
      unified.push({ kind: 'map', id: mapItems[i].id });
    }
    // 남은 charBelow
    while (charBelowIdx < charBelowMap.length) {
      unified.push({ kind: 'char', entry: charBelowMap[charBelowIdx] });
      charBelowIdx++;
    }
    // charAboveMap (z >= 1000, 맵 전체보다 위)
    charAboveMap.forEach(e => unified.push({ kind: 'char', entry: e }));

    // UI는 z 높음 = 위 = 리스트 상단이므로 reverse
    const displayOrder = unified.slice().reverse();

    // ── 렌더 ──
    mapList.innerHTML = '';
    const bulkCol = document.getElementById('map-layer-bulk-actions-col');
    if (bulkCol) ensureMapLayerBulkActionsInto(bulkCol, mapEntries);

    const totalCount = mapEntries.length + charEntries.length;
    if (mapEmpty) mapEmpty.style.display = totalCount ? 'none' : '';
    if (mapCount) mapCount.textContent = String(totalCount);

    displayOrder.forEach(item => {
      if (item.kind === 'map') {
        const entry = entryMap.get(item.id);
        if (!entry) return;
        mapList.appendChild(buildLayerItemEl(entry, normalized));
      } else {
        const el = buildTokenLayerItemEl(item.entry, true);
        el.classList.add('map-layer-item--char');
        mapList.appendChild(el);
      }
    });

    // ── 리스트 레벨 이벤트 위임: 드래그/드롭 통합 처리 ──
    // renderMapLayerList 호출마다 아이템이 재생성되므로,
    // dragBound 플래그를 매번 초기화해 리스너를 재등록한다.
    // (리스너 중복을 막기 위해 cloneNode 대신 removeEventListener 패턴 사용)
    if (mapList._listDragHandler) {
      mapList.removeEventListener('dragover',  mapList._listDragHandler.over);
      mapList.removeEventListener('dragleave', mapList._listDragHandler.leave);
      mapList.removeEventListener('drop',      mapList._listDragHandler.drop);
    }

    // 드래그 중 커서가 자식 요소를 지나도 dropPosition이 안정적으로 유지되도록
    // 아이템 엘리먼트를 직접 찾아 CSS data attribute로 표시
    let _currentDropTarget = null;

    const onOver = (e) => {
      if (!_dragLayerId && !_dragCharTokenId) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      const targetItem = e.target.closest('.map-layer-item');
      if (!targetItem || !mapList.contains(targetItem)) return;
      if (targetItem !== _currentDropTarget) {
        if (_currentDropTarget) delete _currentDropTarget.dataset.dropPosition;
        _currentDropTarget = targetItem;
      }
      const rect = targetItem.getBoundingClientRect();
      targetItem.dataset.dropPosition = (e.clientY - rect.top) >= rect.height / 2 ? 'after' : 'before';
    };

    const onLeave = (e) => {
      // mapList 자체를 벗어날 때만 초기화 (자식 → 자식 이동은 무시)
      if (!mapList.contains(e.relatedTarget)) {
        if (_currentDropTarget) { delete _currentDropTarget.dataset.dropPosition; _currentDropTarget = null; }
      }
    };

    const onDrop = async (e) => {
      e.preventDefault();
      const targetItem = _currentDropTarget || e.target.closest('.map-layer-item');
      const dropPos = targetItem?.dataset.dropPosition === 'after' ? 'after' : 'before';
      if (_currentDropTarget) { delete _currentDropTarget.dataset.dropPosition; _currentDropTarget = null; }

      // ── 캐릭터 토큰 드래그 처리 ──
      if (_dragCharTokenId) {
        const charId = _dragCharTokenId;
        _dragCharTokenId = null;
        if (!targetItem) return;
        const targetLayerId  = targetItem.dataset.layerId;
        const targetCharId   = targetItem.dataset.charTokenId;
        if (targetCharId && targetCharId !== charId) {
          // 캐릭터 → 캐릭터
          _dropCharTokenOnto(charId, { tokenId: targetCharId }, dropPos);
        } else if (targetLayerId) {
          // 캐릭터 → 맵세팅 레이어
          _dropCharTokenOntoMapLayer(charId, targetLayerId, dropPos);
        }
        return;
      }

      // ── 맵세팅 레이어 드래그 처리 ──
      if (_dragLayerId) {
        const sourceId = _dragLayerId;
        _dragLayerId = null;
        const targetId = targetItem?.dataset.layerId;
        if (!targetId) {
          // 빈 영역에 드롭: 맨 끝으로
          const next = normalizeLayerState(getStateRoot().mapLayerState || null);
          const fromIndex = next.order.indexOf(sourceId);
          if (fromIndex >= 0 && fromIndex !== next.order.length - 1) {
            const moved = next.order.splice(fromIndex, 1)[0];
            next.order.push(moved);
            await saveMapLayerState(next);
            renderMapLayerList();
          }
          return;
        }
        if (sourceId === targetId) return;
        const next = normalizeLayerState(getStateRoot().mapLayerState || null);
        const order = next.order.filter(id => id !== sourceId);
        const insertIndex = getDropInsertIndex(order, targetId, dropPos);
        order.splice(insertIndex, 0, sourceId);
        if (order.join('|') === next.order.join('|')) return;
        next.order = order;
        await saveMapLayerState(next);
        renderMapLayerList();
      }
    };

    mapList._listDragHandler = { over: onOver, leave: onLeave, drop: onDrop };
    mapList.addEventListener('dragover',  onOver);
    mapList.addEventListener('dragleave', onLeave);
    mapList.addEventListener('drop',      onDrop);
  }

  /* bulk-actions를 지정 컨테이너에 렌더 (기존 ensureMapLayerBulkActions는 list.parentNode 의존) */
  function ensureMapLayerBulkActionsInto(container, entries) {
    if (!container) return;
    const safeEntries = Array.isArray(entries) ? entries : [];
    const objectCount = safeEntries.filter((e) => canDeleteLayer(e)).length;
    const hasBackground = safeEntries.some((e) => String(e?.id || '') === 'background');
    container.innerHTML = (objectCount > 0 || hasBackground)
      ? '<button type="button" id="map-layer-delete-all" class="map-layer-bulk-delete">전체 삭제</button>'
      : '';
    const btn = document.getElementById('map-layer-delete-all');
    btn?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      confirmDeleteAllObjectLayers();
    });
  }


  function canManageMapLayers() {
    if (typeof hasPerm === 'function') return !!hasPerm('manageMap');
    return !!getStateRoot().isGM;
  }

  function openMapLayerManager() {
    if (!canManageMapLayers()) {
      if (typeof showToast === 'function') showToast('맵 관리 권한이 없어요.');
      return;
    }
    refreshMapLayerManager();
    if (typeof openModal === 'function') openModal('modal-map-layers');
  }

  function refreshMapLayerManager() {
    applyMapLayerState();
    renderMapLayerList();
  }

  /* 레이어 모달 위에 토큰 편집창이 뜨도록:
     modal-map-layers의 z-index를 일시적으로 190으로 낮추고,
     토큰 편집창이 닫히면 원래대로 복원한다.
     (캐릭터 토큰 = te-overlay z-index:500 / 패널 토큰 = .overlay z-index:200
      둘 다 레이어 모달을 190으로 낮추면 확실히 앞에 뜬다.) */
  function _openTokenEditAboveLayerModal(tokenId) {
    if (typeof openTokenEdit !== 'function') return;

    const layerModal = document.getElementById('modal-map-layers');

    // 레이어 모달 z-index를 일시 낮춤
    if (layerModal) layerModal.style.zIndex = '190';

    const restore = () => {
      if (layerModal) layerModal.style.zIndex = '';
    };

    openTokenEdit(tokenId);

    // 토큰 편집창이 어떤 엘리먼트로 열렸는지 rAF 후 감지
    requestAnimationFrame(() => {
      // 케이스 A: 캐릭터 토큰 → te-overlay
      const teOverlay = document.getElementById('te-overlay');
      if (teOverlay && teOverlay.classList.contains('open')) {
        const onTeClose = () => {
          restore();
          teOverlay.removeEventListener('transitionend', onTeClose);
          observer.disconnect();
        };
        // classList에서 'open' 제거 감지
        const observer = new MutationObserver(() => {
          if (!teOverlay.classList.contains('open')) {
            restore();
            observer.disconnect();
          }
        });
        observer.observe(teOverlay, { attributes: true, attributeFilter: ['class'] });
        return;
      }
      // 케이스 B: 패널 토큰 → modal-panel-token-edit (.overlay)
      const panelModal = document.getElementById('modal-panel-token-edit');
      if (panelModal && panelModal.classList.contains('open')) {
        const observer = new MutationObserver(() => {
          if (!panelModal.classList.contains('open')) {
            restore();
            observer.disconnect();
          }
        });
        observer.observe(panelModal, { attributes: true, attributeFilter: ['class'] });
      }
    });
  }

  /* ── 레이어 박스 우클릭 컨텍스트 메뉴 ── */
  let _layerCtxEntry = null;  // 현재 우클릭된 엔트리

  function showLayerItemCtx(e, entry) {
    e.preventDefault();
    e.stopPropagation();
    _layerCtxEntry = entry;
    const ctx = document.getElementById('layer-item-ctx');
    if (!ctx) return;
    // 맵세팅 레이어(importedMapObject)는 order 배열 기반이므로 항상 활성
    // 캐릭터 토큰도 panelPriority 기반으로 항상 활성
    ctx.style.display = 'block';
    // 화면 경계 처리
    const x = Math.min(e.clientX, window.innerWidth - 180);
    const y = Math.min(e.clientY, window.innerHeight - 130);
    ctx.style.left = x + 'px';
    ctx.style.top  = y + 'px';
  }

  function hideLayerItemCtx() {
    const ctx = document.getElementById('layer-item-ctx');
    if (ctx) ctx.style.display = 'none';
    _layerCtxEntry = null;
  }

  window.layerItemCtxAction = function(action) {
    const entry = _layerCtxEntry;
    hideLayerItemCtx();
    if (!entry) return;

    // ── 캐릭터 토큰: 전체 통합 z-order 기준으로 재배치 ──
    // 레이어 매니저에서의 순서 조정은 스크린 패널과 캐릭터 토큰 전체를 하나의
    // 순서로 보고 처리한다. 캐릭터 토큰의 z 대역(1000+)은 유지하되,
    // 모든 가시 토큰을 통합 정렬 후 재배치한다.
    if (entry.isTokenEntry) {
      _changeLayerOrderUnified(entry.tokenId, action);
      return;
    }

    // ── 맵세팅 레이어: panelTokenId → importedMapObject 토큰, 또는 배경 직접 조작 ──
    const panelTokenId = String(entry.panelTokenId || '');
    if (panelTokenId && typeof _changeTokenLayerOrder === 'function') {
      _changeTokenLayerOrder(panelTokenId, action);
      return;
    }
    _shiftMapLayerOrder(entry.id, action);
  };

  /* 레이어 매니저 전용: 캐릭터 토큰을 스크린 패널 포함 전체 통합 순서로 이동
     - 스크린 패널(importedMapObject): layerState.order 인덱스 기반 z(1~N)
     - 캐릭터 토큰: panelPriority 기반 z(1000+)
     - 두 그룹을 현재 z-index 기준으로 정렬 후 타깃을 이동, 결과를 각 그룹에 역산 */
  /* 캐릭터 토큰 드래그 드롭: 다른 캐릭터 토큰 위에 드롭 */
  /* ── 통합 z-order 배열 빌더 ──
     renderMapLayerList 표시 순서, _changeLayerOrderUnified, _applyCharTokenDrop
     세 곳이 모두 동일한 순서로 배열을 구성해야 UI = 실제 z-order가 보장된다.
     panelPriority < 1000 캐릭터는 맵세팅 레이어 사이에 끼워 넣고,
     panelPriority >= 1000 캐릭터는 맵세팅 전체보다 뒤(z 높음)에 배치한다.
     반환: [{ kind:'map', layerId }, ... { kind:'char', tokenId, z } ...]
     순서: z 오름차순 (배열 앞 = z 낮음 = UI 하단) */
  function _buildUnifiedLayerOrder() {
    const stateRoot = getStateRoot();
    const tokens = stateRoot.tokens || {};
    const layerState = stateRoot.mapLayerState || {};
    const order = Array.isArray(layerState.order) ? layerState.order.slice() : [];

    const charItems = Object.values(tokens)
      .filter(t => t && t.id && !_isLayerManagerPanelToken(t) && !t.importedMapObject)
      .map(t => ({ kind: 'char', tokenId: t.id, z: Number(t.panelPriority || 1000) }))
      .sort((a, b) => a.z - b.z);

    const charBelow = charItems.filter(c => c.z < 1000);
    const charAbove = charItems.filter(c => c.z >= 1000);

    const unified = [];
    let ci = 0;
    for (let i = 0; i < order.length; i++) {
      while (ci < charBelow.length && charBelow[ci].z <= i) {
        unified.push(charBelow[ci]); ci++;
      }
      unified.push({ kind: 'map', layerId: order[i], mapIdx: i });
    }
    while (ci < charBelow.length) { unified.push(charBelow[ci]); ci++; }
    charAbove.forEach(c => unified.push(c));

    return { unified, order };
  }

  /* unified 배열을 이동시킨 뒤 각 항목의 z 재계산 + 저장 */
  function _applyUnifiedOrder(next, originalOrder) {
    const stateRoot = getStateRoot();
    const tokens = stateRoot.tokens || {};
    const layerState = stateRoot.mapLayerState || {};

    const mapCount = next.filter(it => it.kind === 'map').length;
    const nextMapOrder = next.filter(it => it.kind === 'map').map(it => it.layerId);
    const fbTokenPayload = {};

    next.forEach((item, globalIdx) => {
      if (item.kind !== 'char') return;
      const t = tokens[item.tokenId];
      if (!t) return;
      const newZ = globalIdx >= mapCount ? 1000 + (globalIdx - mapCount) : Math.max(1, globalIdx);
      t.panelPriority = newZ;
      const el = document.getElementById(`tok-${item.tokenId}`);
      if (el) el.style.zIndex = String(newZ);
      fbTokenPayload[`${item.tokenId}/panelPriority`] = newZ;
    });

    const mapOrderChanged = nextMapOrder.some((id, i) => id !== originalOrder[i]);
    const charChanged = Object.keys(fbTokenPayload).length > 0;
    if (!mapOrderChanged && !charChanged) return;

    if (mapOrderChanged) {
      const nextLayerState = { ...layerState, order: nextMapOrder };
      stateRoot.mapLayerState = nextLayerState;
      if (typeof applyMapLayerState === 'function') applyMapLayerState();
      if (typeof window.requestActiveMapSceneSave === 'function') window.requestActiveMapSceneSave('layer-order', 260);
      if (window._FB?.CONFIGURED) {
        const roomCode = getLiveRoomCode();
        if (roomCode) {
          const { db, ref, update } = window._FB;
          const payload = { mapLayerState: nextLayerState, 'bgm/mapLayerState': nextLayerState };
          Object.entries(fbTokenPayload).forEach(([k, v]) => { payload[`tokens/${k}`] = v; });
          update(ref(db, `rooms/${roomCode}`), payload).catch(e => console.warn('layer order sync failed', e));
        }
      }
    } else if (charChanged) {
      if (window._FB?.CONFIGURED) {
        const roomCode = getLiveRoomCode();
        if (roomCode) {
          const { db, ref, update } = window._FB;
          update(ref(db, `rooms/${roomCode}/tokens`), fbTokenPayload)
            .catch(e => console.warn('char order sync failed', e));
        }
      }
    }
    renderMapLayerList();
  }

  function _dropCharTokenOnto(dragTokenId, target, dropPos) {
    const { unified, order } = _buildUnifiedLayerOrder();
    const fromIdx = unified.findIndex(it => it.kind === 'char' && it.tokenId === dragTokenId);
    const toIdx   = unified.findIndex(it => it.kind === 'char' && it.tokenId === target.tokenId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const next = unified.slice();
    const [moved] = next.splice(fromIdx, 1);
    let ins = next.findIndex(it => it.kind === 'char' && it.tokenId === target.tokenId);
    ins = dropPos === 'after' ? ins + 1 : ins;
    next.splice(Math.max(0, Math.min(next.length, ins)), 0, moved);
    _applyUnifiedOrder(next, order);
  }

  function _dropCharTokenOntoMapLayer(dragTokenId, targetLayerId, dropPos) {
    const { unified, order } = _buildUnifiedLayerOrder();
    const fromIdx = unified.findIndex(it => it.kind === 'char' && it.tokenId === dragTokenId);
    const toIdx   = unified.findIndex(it => it.kind === 'map' && it.layerId === targetLayerId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = unified.slice();
    const [moved] = next.splice(fromIdx, 1);
    let ins = next.findIndex(it => it.kind === 'map' && it.layerId === targetLayerId);
    ins = dropPos === 'after' ? ins + 1 : ins;
    next.splice(Math.max(0, Math.min(next.length, ins)), 0, moved);
    _applyUnifiedOrder(next, order);
  }


  /* ── 통합 z-order 배열 빌더 ──
     renderMapLayerList 표시 순서, _changeLayerOrderUnified, _applyCharTokenDrop
     세 곳이 모두 동일한 순서로 배열을 구성해야 UI = 실제 z-order가 보장된다.
     panelPriority < 1000 캐릭터는 맵세팅 레이어 사이에 끼워 넣고,
     panelPriority >= 1000 캐릭터는 맵세팅 전체보다 뒤(z 높음)에 배치한다.
     반환: [{ kind:'map', layerId }, ... { kind:'char', tokenId, z } ...]
     순서: z 오름차순 (배열 앞 = z 낮음 = UI 하단) */
  function _changeLayerOrderUnified(tokenId, direction) {
    const { unified, order } = _buildUnifiedLayerOrder();
    const myIdx = unified.findIndex(it => it.kind === 'char' && it.tokenId === tokenId);
    if (myIdx < 0) return;

    const next = unified.slice();
    if (direction === 'layerFront') {
      if (myIdx === next.length - 1) { if (typeof showToast === 'function') showToast('이미 맨 앞입니다.'); return; }
      const [item] = next.splice(myIdx, 1); next.push(item);
    } else if (direction === 'layerBack') {
      if (myIdx === 0) { if (typeof showToast === 'function') showToast('이미 맨 뒤입니다.'); return; }
      const [item] = next.splice(myIdx, 1); next.unshift(item);
    } else if (direction === 'layerForward') {
      if (myIdx === next.length - 1) { if (typeof showToast === 'function') showToast('이미 맨 앞입니다.'); return; }
      [next[myIdx], next[myIdx + 1]] = [next[myIdx + 1], next[myIdx]];
    } else {
      if (myIdx === 0) { if (typeof showToast === 'function') showToast('이미 맨 뒤입니다.'); return; }
      [next[myIdx - 1], next[myIdx]] = [next[myIdx], next[myIdx - 1]];
    }
    _applyUnifiedOrder(next, order);
  }

  function _shiftMapLayerOrder(layerId, direction) {
    const stateRoot = getStateRoot();
    const layerState = stateRoot.mapLayerState;
    if (!layerState?.order) return;
    const order = layerState.order.slice();
    const idx = order.indexOf(layerId);
    if (idx < 0) { if (typeof showToast === 'function') showToast('레이어를 찾을 수 없어요.'); return; }
    let nextOrder;
    if (direction === 'layerFront') {
      nextOrder = [...order.filter(id => id !== layerId), layerId];
    } else if (direction === 'layerBack') {
      nextOrder = [layerId, ...order.filter(id => id !== layerId)];
    } else if (direction === 'layerForward') {
      if (idx === order.length - 1) { if (typeof showToast === 'function') showToast('이미 맨 앞입니다.'); return; }
      nextOrder = order.slice();
      [nextOrder[idx], nextOrder[idx + 1]] = [nextOrder[idx + 1], nextOrder[idx]];
    } else {
      if (idx === 0) { if (typeof showToast === 'function') showToast('이미 맨 뒤입니다.'); return; }
      nextOrder = order.slice();
      [nextOrder[idx - 1], nextOrder[idx]] = [nextOrder[idx], nextOrder[idx - 1]];
    }
    const nextLayerState = { ...layerState, order: nextOrder };
    stateRoot.mapLayerState = nextLayerState;
    if (typeof applyMapLayerState === 'function') applyMapLayerState();
    if (typeof window.requestActiveMapSceneSave === 'function') window.requestActiveMapSceneSave('layer-order', 260);
    if (window._FB?.CONFIGURED) {
      const roomCode = getLiveRoomCode();
      if (roomCode) {
        const { db, ref, update } = window._FB;
        update(ref(db, `rooms/${roomCode}`), {
          mapLayerState: nextLayerState,
          'bgm/mapLayerState': nextLayerState,
        }).catch(e => console.warn('layer order sync failed', e));
      }
    }
    renderMapLayerList();
  }

  // ctx 메뉴 외부 클릭 시 닫기 (1회 바인딩)
  if (!window._layerItemCtxOutsideBound) {
    window._layerItemCtxOutsideBound = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#layer-item-ctx')) hideLayerItemCtx();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideLayerItemCtx();
    });
  }

  // 맵 우클릭 컨텍스트 메뉴에서도 통합 순서 함수를 쓸 수 있도록 전역 노출
  window._changeLayerOrderUnifiedGlobal = _changeLayerOrderUnified;
  window.openMapLayerManager = openMapLayerManager;
  window.openMapLayerManagerModal = openMapLayerManager;
  window.refreshMapLayerManager = refreshMapLayerManager;
  window.applyMapLayerState = applyMapLayerState;
})();
