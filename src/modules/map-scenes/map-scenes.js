/**
 * ITC TRPG — Map Scenes
 * 씬 데이터 구조 + GM 전용 설정창 UI + activeSceneId 기반 실제 씬 전환 연결
 * - 씬 전환 시 맵 영역에 페이드아웃/페이드인 효과를 덧입힌다.
 * - 씬에 tokens 스냅샷이 명시적으로 담긴 경우 전환 시 토큰 경로까지 교체한다 (GM만 set, 플레이어는 tokens 리스너로 자동 반영).
 * - 첫 적용(방 입장)은 페이드 없이 맵세팅만 반영하며 토큰 경로는 건드리지 않는다.
 */
(function(){
  const ROOT = window;
  const state = {
    scenes: [],
    selectedSceneId: '',
    activeSceneId: '',
    loadedRoomCode: '',
    isDirty: false,
    autoCreatedOnOpen: false,
    remoteScenes: [],
    remoteActiveSceneId: '',
    syncRoomCode: '',
    syncAppliedKey: '',
  };

  let _sceneSyncWatchTimer = null;
  let _sceneSyncUnsubs = [];

  /* ── fade transition (transient overlay) ── */
  const FADE_OUT_MS = 340;
  const FADE_SETTLE_MS = 40;
  const FADE_IN_MS = 320;
  let _sceneFadeActive = false;

  function runSceneFadeTransition(applyCallback){
    const area = document.getElementById('map-area');
    if (!area) {
      try { applyCallback(); } catch (e) { console.warn('scene apply failed', e); }
      return;
    }
    if (_sceneFadeActive) {
      // 이미 페이드 진행 중이면 새 전환은 즉시 적용만 수행 (누적/중첩 방지)
      try { applyCallback(); } catch (e) { console.warn('scene apply failed', e); }
      return;
    }
    _sceneFadeActive = true;
    // 잔여 오버레이 정리 (안전 장치)
    area.querySelectorAll(':scope > .map-scene-fade').forEach(function(n){
      try { n.remove(); } catch (_) {}
    });
    const overlay = document.createElement('div');
    overlay.className = 'map-scene-fade';
    overlay.setAttribute('aria-hidden', 'true');
    area.appendChild(overlay);
    // reflow 후 class 추가로 트랜지션 시작
    void overlay.offsetWidth;
    overlay.classList.add('is-visible');
    window.setTimeout(function(){
      try { applyCallback(); } catch (e) { console.warn('scene apply failed', e); }
      window.setTimeout(function(){
        overlay.classList.remove('is-visible');
        window.setTimeout(function(){
          try { if (overlay.isConnected) overlay.remove(); } catch (_) {}
          _sceneFadeActive = false;
        }, FADE_IN_MS + 40);
      }, FADE_SETTLE_MS);
    }, FADE_OUT_MS);
  }

  function makeSceneId(){
    return `scene_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
  }

  function normalizeScene(raw, id){
    const sceneId = String(id || raw?.id || '').trim() || makeSceneId();
    const out = {
      id: sceneId,
      name: String(raw?.name || '기본 씬').trim() || '기본 씬',
      background: raw?.background || null,
      objects: Array.isArray(raw?.objects) ? raw.objects : [],
      layerState: raw?.layerState || null,
      createdAt: Number(raw?.createdAt) || Date.now(),
      updatedAt: Number(raw?.updatedAt) || Date.now(),
    };
    // tokens 필드는 명시적으로 제공됐을 때만 포함한다 (기존 저장된 씬과의 호환을 위해).
    if (raw && Object.prototype.hasOwnProperty.call(raw, 'tokens') && raw.tokens !== undefined) {
      out.tokens = (raw.tokens && typeof raw.tokens === 'object') ? raw.tokens : {};
    }
    return out;
  }

  function buildDefaultScene(){
    // 최초 기본 씬은 tokens 필드를 의도적으로 남기지 않는다 (방 첫 입장 시 기존 토큰 보존).
    return normalizeScene({ name:'기본 씬' });
  }

  function buildEmptyAddedScene(index){
    // + 버튼으로 추가하는 씬은 "빈 페이지" (맵세팅/레이어/토큰 모두 비움)
    return normalizeScene({ name: '씬 ' + (index + 1), tokens: {} });
  }

  function ensureSceneMinimum(){
    if (!state.scenes.length) {
      const base = buildDefaultScene();
      state.scenes = [base];
      state.selectedSceneId = base.id;
      state.activeSceneId = base.id;
      state.isDirty = true;
      return;
    }
    if (!state.selectedSceneId || !state.scenes.some(s => s.id === state.selectedSceneId)) {
      state.selectedSceneId = state.scenes[0].id;
    }
    if (!state.activeSceneId || !state.scenes.some(s => s.id === state.activeSceneId)) {
      state.activeSceneId = state.scenes[0].id;
    }
  }

  function getMapScenesRefs(){
    if (!ROOT._FB?.CONFIGURED || !ROOT.St?.roomCode) return null;
    const { db, ref } = ROOT._FB;
    return {
      scenesRef: ref(db, `rooms/${ROOT.St.roomCode}/mapScenes`),
      activeRef: ref(db, `rooms/${ROOT.St.roomCode}/meta/activeSceneId`),
    };
  }

  function deepCopy(value){
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }

  function getSceneHasMapData(scene){
    return !!(scene?.background?.url || (Array.isArray(scene?.objects) && scene.objects.length));
  }

  function applyMapPartToRuntime(scene){
    // 맵 배경/포그라운드/오브젝트/레이어만 적용 (토큰은 별도 처리)
    if (!scene) return;
    ROOT.St.mapState = {
      background: scene.background ? deepCopy(scene.background) : null,
      foreground: null,
      objects: Array.isArray(scene.objects) ? deepCopy(scene.objects) : [],
    };
    ROOT.St.mapLayerState = scene.layerState ? deepCopy(scene.layerState) : null;
    if (typeof ROOT.applyImportedMapState === 'function') ROOT.applyImportedMapState(ROOT.St.mapState);
    if (typeof ROOT.refreshMapLayerManager === 'function') ROOT.refreshMapLayerManager();
  }

  function applySceneToRuntime(scene){
    if (!scene) return false;
    applyMapPartToRuntime(scene);
    // 씬에 토큰 스냅샷이 명시적으로 있으면 GM만 Firebase tokens 경로 교체.
    // (플레이어 측은 기존 tokens 리스너로 자동 반영됨)
    if (scene.tokens !== undefined && ROOT.St?.isGM && ROOT._FB?.CONFIGURED && ROOT.St?.roomCode) {
      try {
        const { db, ref, set } = ROOT._FB;
        const tokensData = (scene.tokens && typeof scene.tokens === 'object') ? deepCopy(scene.tokens) : {};
        set(ref(db, `rooms/${ROOT.St.roomCode}/tokens`), tokensData).catch(function(e){
          console.warn('scene token restore failed', e);
        });
      } catch (e) {
        console.warn('scene token restore failed', e);
      }
    }
    return true;
  }

  function syncActiveSceneToRuntime(){
    const roomCode = String(ROOT.St?.roomCode || '').trim();
    if (!roomCode || roomCode !== state.syncRoomCode) return;
    const activeId = String(state.remoteActiveSceneId || '').trim();
    if (!activeId) return;
    const scene = state.remoteScenes.find(s => s.id === activeId);
    if (!scene) return;
    const applyKey = [
      roomCode,
      activeId,
      Number(scene.updatedAt || 0),
      String(scene.background?.url || ''),
      Array.isArray(scene.objects) ? scene.objects.length : 0,
      scene.tokens === undefined ? 'no-tok' : ('tok-' + Object.keys(scene.tokens || {}).length)
    ].join('|');
    if (state.syncAppliedKey === applyKey) return;
    const isFirstApply = !state.syncAppliedKey;
    if (isFirstApply) {
      // 첫 적용: 페이드 없이 맵세팅만 반영 (토큰 경로는 건드리지 않아 방 입장 회귀 차단)
      applyMapPartToRuntime(scene);
      state.syncAppliedKey = applyKey;
      return;
    }
    // 전환 케이스: 페이드아웃 → 적용 → 페이드인
    runSceneFadeTransition(function(){
      if (applySceneToRuntime(scene)) state.syncAppliedKey = applyKey;
    });
  }

  function cleanupSceneSync(){
    _sceneSyncUnsubs.forEach(function(unsub){ try { if (typeof unsub === 'function') unsub(); } catch (_) {} });
    _sceneSyncUnsubs = [];
    state.syncRoomCode = '';
    state.remoteScenes = [];
    state.remoteActiveSceneId = '';
    state.syncAppliedKey = '';
  }

  function startSceneSyncForRoom(roomCode){
    const nextRoomCode = String(roomCode || '').trim();
    if (!ROOT._FB?.CONFIGURED || !nextRoomCode) {
      cleanupSceneSync();
      return;
    }
    if (state.syncRoomCode === nextRoomCode && _sceneSyncUnsubs.length) return;
    cleanupSceneSync();
    state.syncRoomCode = nextRoomCode;
    const { db, ref, onValue } = ROOT._FB;
    const scenesRef = ref(db, `rooms/${nextRoomCode}/mapScenes`);
    const activeRef = ref(db, `rooms/${nextRoomCode}/meta/activeSceneId`);
    const onScenes = onValue(scenesRef, function(snap){
      const rawScenes = snap.val() || {};
      state.remoteScenes = Object.entries(rawScenes).map(function(entry){
        return normalizeScene(entry[1], entry[0]);
      }).sort(function(a,b){ return (a.createdAt || 0) - (b.createdAt || 0); });
      syncActiveSceneToRuntime();
    });
    const onActive = onValue(activeRef, function(snap){
      state.remoteActiveSceneId = String(snap.val() || '').trim();
      syncActiveSceneToRuntime();
    });
    _sceneSyncUnsubs.push(onScenes, onActive);
  }

  function ensureSceneSyncWatch(){
    if (_sceneSyncWatchTimer) return;
    _sceneSyncWatchTimer = window.setInterval(function(){
      const roomCode = String(ROOT.St?.roomCode || '').trim();
      if (!roomCode || !ROOT._FB?.CONFIGURED) {
        if (state.syncRoomCode) cleanupSceneSync();
        return;
      }
      if (roomCode !== state.syncRoomCode) startSceneSyncForRoom(roomCode);
    }, 1000);
  }

  async function loadScenesFromRoom(){
    if (!ROOT.St?.roomCode || !ROOT._FB?.CONFIGURED) {
      state.scenes = [buildDefaultScene()];
      state.selectedSceneId = state.scenes[0].id;
      state.activeSceneId = state.scenes[0].id;
      state.loadedRoomCode = ROOT.St?.roomCode || '';
      state.isDirty = false;
      state.autoCreatedOnOpen = false;
      return;
    }
    const refs = getMapScenesRefs();
    if (!refs) return;
    const { get } = ROOT._FB;
    const [sceneSnap, activeSnap] = await Promise.all([get(refs.scenesRef), get(refs.activeRef)]);
    const rawScenes = sceneSnap.val() || {};
    const entries = Object.entries(rawScenes).map(([id, raw]) => normalizeScene(raw, id));
    state.scenes = entries.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
    state.activeSceneId = String(activeSnap.val() || '').trim();
    state.loadedRoomCode = ROOT.St.roomCode;
    state.isDirty = false;
    state.autoCreatedOnOpen = !entries.length;
    ensureSceneMinimum();
  }

  /* ── context menu ── */
  let _ctxTargetId = '';

  function showCtxMenu(x, y, sceneId){
    _ctxTargetId = sceneId;
    const ctx = document.getElementById('map-scene-ctx');
    if (!ctx) return;
    ctx.style.left = Math.min(x, window.innerWidth - 160) + 'px';
    ctx.style.top = Math.min(y, window.innerHeight - 120) + 'px';
    ctx.style.display = 'flex';
  }

  function hideCtxMenu(){
    const ctx = document.getElementById('map-scene-ctx');
    if (ctx) ctx.style.display = 'none';
    _ctxTargetId = '';
  }

  function handleCtxAction(action){
    const sceneId = _ctxTargetId;
    hideCtxMenu();
    if (!sceneId) return;

    if (action === 'capture') {
      const scene = state.scenes.find(s => s.id === sceneId);
      if (!scene) return;
      const ms = ROOT.St?.mapState || {};
      const hasMap = !!(ms.background?.url || (Array.isArray(ms.objects) && ms.objects.length));
      const tokensObj = (ROOT.St?.tokens && typeof ROOT.St.tokens === 'object') ? ROOT.St.tokens : {};
      const hasTokens = Object.keys(tokensObj).length > 0;
      if (!hasMap && !hasTokens) {
        ROOT.showToast('현재 맵에 저장할 데이터가 없어요. 맵세팅이나 토큰을 먼저 배치해 주세요.');
        return;
      }
      scene.background = ms.background ? { url: ms.background.url || '', fit: ms.background.fit || 'contain', sourceName: ms.background.sourceName || '' } : null;
      scene.objects = Array.isArray(ms.objects) ? JSON.parse(JSON.stringify(ms.objects)) : [];
      scene.layerState = ROOT.St?.mapLayerState ? JSON.parse(JSON.stringify(ROOT.St.mapLayerState)) : null;
      scene.tokens = JSON.parse(JSON.stringify(tokensObj));
      scene.updatedAt = Date.now();
      state.isDirty = true;
      renderSceneList();
      ROOT.showToast('"' + (scene.name || '씬') + '"에 현재 맵과 토큰 상태를 저장했어요. 씬 설정 저장을 눌러 반영하세요.');
    }

    if (action === 'rename') {
      const scene = state.scenes.find(s => s.id === sceneId);
      if (!scene) return;
      const input = window.prompt('씬 이름을 입력하세요. (최대 40글자)', scene.name || '');
      if (input === null) return;
      scene.name = String(input).trim().slice(0, 40) || '무제 씬';
      scene.updatedAt = Date.now();
      state.isDirty = true;
      renderSceneList();
    }

    if (action === 'delete') {
      if (state.scenes.length <= 1) {
        ROOT.showToast('씬은 최소 1개 이상 있어야 해요.');
        return;
      }
      const scene = state.scenes.find(s => s.id === sceneId);
      if (!window.confirm(`"${scene?.name || '선택한 씬'}" 씬을 정말 삭제하시겠습니까?`)) return;
      state.scenes = state.scenes.filter(s => s.id !== sceneId);
      if (state.activeSceneId === sceneId) state.activeSceneId = state.scenes[0]?.id || '';
      if (state.selectedSceneId === sceneId) state.selectedSceneId = state.scenes[0]?.id || '';
      ensureSceneMinimum();
      state.isDirty = true;
      renderSceneList();
    }
  }

  /* ── render ── */
  function renderSceneList(){
    const listEl = document.getElementById('map-scene-list');
    const emptyEl = document.getElementById('map-scene-empty');
    if (!listEl || !emptyEl) return;
    ensureSceneMinimum();
    emptyEl.style.display = 'none';
    listEl.innerHTML = state.scenes.map(function(scene, index){
      var isSelected = scene.id === state.selectedSceneId;
      var isActive = scene.id === state.activeSceneId;
      var hasMapData = getSceneHasMapData(scene);
      var tokenCount = (scene.tokens && typeof scene.tokens === 'object') ? Object.keys(scene.tokens).length : -1;
      var tokenLabel = tokenCount >= 0 ? (' · 토큰 ' + tokenCount + '개') : '';
      return '<button type="button" class="map-scene-item' + (isSelected ? ' is-selected' : '') + '" data-scene-id="' + scene.id + '">'
        + '<div class="map-scene-item-main">'
        + '<div class="map-scene-item-index">씬 ' + (index + 1) + '</div>'
        + '<div class="map-scene-item-name">' + ROOT.esc(scene.name || '무제 씬') + '</div>'
        + '<div class="map-scene-item-meta">' + (isActive ? '현재 표시 중' : '대기 중') + (hasMapData ? ' · 맵 저장됨' : '') + tokenLabel + '</div>'
        + '</div>'
        + (isActive ? '<span class="map-scene-badge">LIVE</span>' : '')
        + '</button>';
    }).join('');

    listEl.querySelectorAll('.map-scene-item').forEach(function(btn){
      btn.addEventListener('click', function(){
        state.selectedSceneId = btn.dataset.sceneId || '';
        renderSceneList();
      });
      btn.addEventListener('dblclick', function(e){
        e.preventDefault();
        var sid = btn.dataset.sceneId || '';
        if (!sid || state.activeSceneId === sid) return;
        state.activeSceneId = sid;
        state.isDirty = true;
        renderSceneList();
      });
      btn.addEventListener('contextmenu', function(e){
        e.preventDefault();
        e.stopPropagation();
        showCtxMenu(e.clientX, e.clientY, btn.dataset.sceneId || '');
      });
    });
  }

  function bindSceneModalEvents(){
    var addBtn = document.getElementById('map-scene-add-btn');
    var saveBtn = document.getElementById('map-scene-save-btn');
    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = '1';
      addBtn.addEventListener('click', function(){
        var next = buildEmptyAddedScene(state.scenes.length);
        state.scenes.push(next);
        state.selectedSceneId = next.id;
        if (!state.activeSceneId) state.activeSceneId = next.id;
        state.isDirty = true;
        renderSceneList();
      });
    }
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = '1';
      saveBtn.addEventListener('click', saveMapScenes);
    }
    var ctx = document.getElementById('map-scene-ctx');
    if (ctx && !ctx.dataset.bound) {
      ctx.dataset.bound = '1';
      ctx.querySelectorAll('.map-scene-ctx-item').forEach(function(item){
        item.addEventListener('click', function(){ handleCtxAction(item.dataset.action || ''); });
      });
    }
    if (!window._mapSceneCtxBound) {
      window._mapSceneCtxBound = true;
      document.addEventListener('click', function(e){
        if (!e.target.closest('#map-scene-ctx')) hideCtxMenu();
      });
    }
  }

  async function saveMapScenes(options){
    options = options || {};
    var hint = document.getElementById('map-scene-hint');
    ensureSceneMinimum();
    if (!ROOT.St?.isGM) { ROOT.showToast('GM만 장면 전환 설정을 저장할 수 있어요.'); return; }
    var refs = getMapScenesRefs();
    if (!refs) { ROOT.showToast('방에 입장한 상태에서만 저장할 수 있어요.'); return; }
    var payload = {};
    state.scenes.forEach(function(scene, index){
      var normalized = normalizeScene({ ...scene, name: scene.name || ('씬 ' + (index + 1)), updatedAt: Date.now() }, scene.id);
      payload[normalized.id] = normalized;
    });
    try {
      if (hint) hint.textContent = options.silent ? (options.hintText || '기본 씬을 준비하는 중...') : '저장 중...';
      var { set } = ROOT._FB;
      await Promise.all([
        set(refs.scenesRef, payload),
        set(refs.activeRef, state.activeSceneId || state.scenes[0].id),
      ]);
      state.isDirty = false;
      state.autoCreatedOnOpen = false;
      if (hint) hint.textContent = options.silent ? (options.hintText || '기본 씬을 준비했어요.') : '저장됐어요 ✓';
      if (!options.silent) ROOT.showToast('장면 전환 씬 설정을 저장했어요.');
      setTimeout(function(){
        var h = document.getElementById('map-scene-hint');
        if (h && h.isConnected && !state.isDirty) h.textContent = '';
      }, 1800);
    } catch (err) {
      console.error('saveMapScenes failed', err);
      if (hint) hint.textContent = '저장에 실패했어요.';
      if (!options.silent) ROOT.showToast('장면 전환 씬 저장에 실패했어요.');
    }
  }

  async function openMapSceneModal(){
    if (!ROOT.St?.isGM) { ROOT.showToast('GM만 장면 전환 설정을 열 수 있어요.'); return; }
    ROOT.openModal('modal-map-scenes');
    bindSceneModalEvents();
    ensureSceneSyncWatch();
    var roomChanged = state.loadedRoomCode !== String(ROOT.St?.roomCode || '');
    if (roomChanged || !state.scenes.length) {
      try { await loadScenesFromRoom(); } catch (e) { console.warn('loadScenesFromRoom failed', e); }
    }
    ensureSceneMinimum();
    if (state.autoCreatedOnOpen && ROOT._FB?.CONFIGURED && ROOT.St?.roomCode) {
      try { await saveMapScenes({ silent: true, hintText: '기본 씬을 준비했어요.' }); } catch (e) {}
    }
    renderSceneList();
  }

  function closeMapSceneModal(){
    hideCtxMenu();
    ROOT.closeModal('modal-map-scenes');
  }

  ensureSceneSyncWatch();
  ROOT.openMapSceneModal = openMapSceneModal;
  ROOT.closeMapSceneModal = closeMapSceneModal;
})();
