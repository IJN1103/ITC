/**
 * ITC TRPG — Map Scenes
 * 씬 데이터 구조 + GM 전용 설정창 UI + activeSceneId 기반 실제 씬 전환 연결
 *
 * 설계 (현재 라운드):
 * - 더블클릭 = 즉시 Firebase activeSceneId set → 모든 사용자 실시간 전환 (페이드 포함).
 * - 활성 씬이 정해진 이후, GM이 맵/토큰을 편집하면 내부 watcher가 debounce로
 *   해당 씬의 background/objects/layerState/tokens 를 Firebase에 자동 저장한다.
 * - "씬 설정 저장" 버튼은 씬 이름/추가/삭제 같은 목록 메타 정보 저장용으로 축소된다.
 * - 첫 적용(방 입장)은 페이드 없이 맵세팅만 반영, 토큰 경로는 건드리지 않는다.
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
    suppressAutoSaveUntil: 0,  // 씬 전환 직후 일시적으로 자동 저장 보류 (다단 변경 안정화용)
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
      try { applyCallback(); } catch (e) { console.warn('scene apply failed', e); }
      return;
    }
    _sceneFadeActive = true;
    area.querySelectorAll(':scope > .map-scene-fade').forEach(function(n){
      try { n.remove(); } catch (_) {}
    });
    const overlay = document.createElement('div');
    overlay.className = 'map-scene-fade';
    overlay.setAttribute('aria-hidden', 'true');
    area.appendChild(overlay);
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
    if (raw && Object.prototype.hasOwnProperty.call(raw, 'tokens') && raw.tokens !== undefined) {
      out.tokens = (raw.tokens && typeof raw.tokens === 'object') ? raw.tokens : {};
    }
    return out;
  }

  function buildDefaultScene(){
    // 기본 씬: tokens 필드 생략 (방 최초 입장 시 기존 토큰 보존)
    return normalizeScene({ name:'기본 씬' });
  }

  function buildEmptyAddedScene(index){
    // + 버튼으로 추가하는 씬은 맵/토큰 모두 비어있는 상태 명시
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

  /* ── apply helpers ── */
  function applyMapPartToRuntime(scene){
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

  function syncSceneTokensToRuntime(scene){
    if (!ROOT.St?.isGM || !ROOT._FB?.CONFIGURED || !ROOT.St?.roomCode) return;
    if (!scene || scene.tokens === undefined) return;
    try {
      const { db, ref, set, remove } = ROOT._FB;
      const roomCode = ROOT.St.roomCode;
      const nextTokens = (scene.tokens && typeof scene.tokens === 'object') ? deepCopy(scene.tokens) : {};
      const currentTokens = (ROOT.St?.tokens && typeof ROOT.St.tokens === 'object') ? ROOT.St.tokens : {};
      const currentIds = Object.keys(currentTokens);
      const nextIds = new Set(Object.keys(nextTokens));

      currentIds.forEach(function(tokenId){
        if (!nextIds.has(tokenId)) {
          remove(ref(db, `rooms/${roomCode}/tokens/${tokenId}`)).catch(function(e){
            console.warn('scene token remove failed', tokenId, e);
          });
        }
      });
      Object.entries(nextTokens).forEach(function(entry){
        const tokenId = entry[0];
        const tokenData = entry[1];
        set(ref(db, `rooms/${roomCode}/tokens/${tokenId}`), tokenData).catch(function(e){
          console.warn('scene token restore failed', tokenId, e);
        });
      });
    } catch (e) {
      console.warn('scene token restore failed', e);
    }
  }

  function applySceneToRuntime(scene){
    if (!scene) return false;
    applyMapPartToRuntime(scene);
    if (scene.tokens !== undefined && ROOT.St?.isGM && ROOT._FB?.CONFIGURED && ROOT.St?.roomCode) {
      syncSceneTokensToRuntime(scene);
    }
    return true;
  }

  function buildSceneApplyKey(roomCode, activeId, scene){
    return [
      String(roomCode || '').trim(),
      String(activeId || scene?.id || '').trim(),
      Number(scene?.updatedAt || 0),
      String(scene?.background?.url || ''),
      Array.isArray(scene?.objects) ? scene.objects.length : 0,
      scene?.tokens === undefined ? 'no-tok' : ('tok-' + Object.keys(scene.tokens || {}).length)
    ].join('|');
  }

  function syncActiveSceneToRuntime(){
    const roomCode = String(ROOT.St?.roomCode || '').trim();
    if (!roomCode || roomCode !== state.syncRoomCode) return;
    const activeId = String(state.remoteActiveSceneId || '').trim();
    if (!activeId) return;
    const scene = state.remoteScenes.find(s => s.id === activeId);
    if (!scene) return;
    const applyKey = buildSceneApplyKey(roomCode, activeId, scene);
    if (state.syncAppliedKey === applyKey) return;
    const isFirstApply = !state.syncAppliedKey;
    const isSameSceneUpdate = !isFirstApply && state.syncAppliedKey.split('|')[1] === activeId;

    if (isFirstApply) {
      // 첫 적용: 페이드 없이 맵세팅만 (토큰 경로 보존)
      applyMapPartToRuntime(scene);
      state.syncAppliedKey = applyKey;
      return;
    }
    if (isSameSceneUpdate) {
      // 동일 씬의 내부 업데이트(자동 저장으로 인한 자기 에코 등)는 페이드 없이 조용히 키만 갱신
      state.syncAppliedKey = applyKey;
      return;
    }
    // 씬 전환
    state.suppressAutoSaveUntil = Date.now() + 1500; // 전환 직후 1.5초간 자동 저장 억제
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
    stopActiveSceneAutoSave();
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
    startActiveSceneAutoSave(nextRoomCode);
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

  /* ── 활성 씬 자동 저장 watcher ──
     GM 클라이언트에서만 동작. 맵/토큰 변경을 감지해 현재 활성 씬 레코드를 갱신한다.
     기존 토큰/맵 모듈을 수정하지 않기 위해 polling + 시그니처 비교 방식을 사용. */
  const AUTO_SAVE_POLL_MS = 600;
  const AUTO_SAVE_DEBOUNCE_MS = 900;
  let _autoSaveTimer = null;
  let _autoSavePendingTimer = null;
  let _autoSaveLastSig = '';

  function stopActiveSceneAutoSave(){
    if (_autoSaveTimer) { clearInterval(_autoSaveTimer); _autoSaveTimer = null; }
    if (_autoSavePendingTimer) { clearTimeout(_autoSavePendingTimer); _autoSavePendingTimer = null; }
    _autoSaveLastSig = '';
  }

  function startActiveSceneAutoSave(roomCode){
    stopActiveSceneAutoSave();
    if (!roomCode) return;
    _autoSaveTimer = window.setInterval(function(){
      try { autoSavePollTick(); } catch (e) { console.warn('autoSavePollTick failed', e); }
    }, AUTO_SAVE_POLL_MS);
  }

  function currentRuntimeSignature(){
    const ms = ROOT.St?.mapState || {};
    const layer = ROOT.St?.mapLayerState || null;
    const tokens = (ROOT.St?.tokens && typeof ROOT.St.tokens === 'object') ? ROOT.St.tokens : {};
    let tokenSig = '';
    try {
      const ids = Object.keys(tokens).sort();
      tokenSig = ids.map(function(id){
        const t = tokens[id] || {};
        return id + ':' + Number(t.x||0).toFixed(2) + ',' + Number(t.y||0).toFixed(2) + ',' + (t.rotation||0) + ',' + (t.panelFace||'') + ',' + (t.panelImage?1:0) + ',' + (t.panelBackImage?1:0) + ',' + (t.panelWidth||0) + ',' + (t.panelHeight||0) + ',' + (t.memo?1:0) + ',' + (t.name||'');
      }).join('|');
    } catch (_) { tokenSig = ''; }
    const objs = Array.isArray(ms.objects) ? ms.objects : [];
    const objSig = objs.length + ':' + objs.map(function(o){ return (o?.id||'') + (o?.url?1:0); }).join(',');
    const bgSig = String(ms.background?.url || '') + '|' + String(ms.background?.fit || '');
    const layerSig = layer ? JSON.stringify(layer).length + '' : '0';
    return [bgSig, objSig, layerSig, tokenSig].join('||');
  }

  function autoSavePollTick(){
    if (!ROOT.St?.isGM) return;
    if (!ROOT._FB?.CONFIGURED) return;
    const roomCode = String(ROOT.St?.roomCode || '').trim();
    if (!roomCode || roomCode !== state.syncRoomCode) return;
    if (Date.now() < state.suppressAutoSaveUntil) return;
    if (!state.remoteActiveSceneId) return;

    const sig = currentRuntimeSignature();
    if (!_autoSaveLastSig) { _autoSaveLastSig = sig; return; }
    if (sig === _autoSaveLastSig) return;

    // 변경 감지됨 → debounce
    _autoSaveLastSig = sig;
    if (_autoSavePendingTimer) clearTimeout(_autoSavePendingTimer);
    _autoSavePendingTimer = window.setTimeout(function(){
      _autoSavePendingTimer = null;
      persistActiveSceneFromRuntime().catch(function(e){
        console.warn('persistActiveSceneFromRuntime failed', e);
      });
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  async function persistActiveSceneFromRuntime(){
    if (!ROOT.St?.isGM || !ROOT._FB?.CONFIGURED) return;
    const roomCode = String(ROOT.St?.roomCode || '').trim();
    if (!roomCode) return;
    const activeId = String(state.remoteActiveSceneId || '').trim();
    if (!activeId) return;
    const { db, ref, set } = ROOT._FB;
    const ms = ROOT.St?.mapState || {};
    const tokens = (ROOT.St?.tokens && typeof ROOT.St.tokens === 'object') ? deepCopy(ROOT.St.tokens) : {};

    // 기존 씬 객체를 베이스로 업데이트
    const existing = state.remoteScenes.find(function(s){ return s.id === activeId; }) || {};
    const nextScene = normalizeScene({
      id: activeId,
      name: existing.name || '씬',
      createdAt: existing.createdAt || Date.now(),
      updatedAt: Date.now(),
      background: ms.background ? { url: ms.background.url || '', fit: ms.background.fit || 'contain', sourceName: ms.background.sourceName || '' } : null,
      objects: Array.isArray(ms.objects) ? deepCopy(ms.objects) : [],
      layerState: ROOT.St?.mapLayerState ? deepCopy(ROOT.St.mapLayerState) : null,
      tokens: tokens,
    }, activeId);

    try {
      await set(ref(db, `rooms/${roomCode}/mapScenes/${activeId}`), nextScene);
      // 로컬 상태도 업데이트
      const idx = state.scenes.findIndex(function(s){ return s.id === activeId; });
      if (idx >= 0) state.scenes[idx] = nextScene;
      else state.scenes.push(nextScene);
    } catch (e) {
      console.warn('persistActiveSceneFromRuntime set failed', e);
    }
  }

  /* ── context menu (rename / delete 만 유지, capture 제거) ── */
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
      // 레거시 UI 잔존 시 대비: 즉시 수동 저장 한 번 수행
      ROOT.showToast('활성 씬은 편집 시 자동 저장됩니다.');
      return;
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
      const wasActive = state.activeSceneId === sceneId;
      state.scenes = state.scenes.filter(s => s.id !== sceneId);
      if (wasActive) state.activeSceneId = state.scenes[0]?.id || '';
      if (state.selectedSceneId === sceneId) state.selectedSceneId = state.scenes[0]?.id || '';
      ensureSceneMinimum();
      state.isDirty = true;
      renderSceneList();
      // 활성 씬이 삭제됐으면 그 즉시 새 활성 씬으로 전환 (Firebase에서 해당 레코드도 제거)
      removeSceneFromFirebase(sceneId, wasActive ? state.activeSceneId : null);
    }
  }

  async function removeSceneFromFirebase(sceneId, newActiveId){
    if (!ROOT._FB?.CONFIGURED || !ROOT.St?.isGM) return;
    const roomCode = String(ROOT.St?.roomCode || '').trim();
    if (!roomCode) return;
    try {
      const { db, ref, remove, set } = ROOT._FB;
      await remove(ref(db, `rooms/${roomCode}/mapScenes/${sceneId}`));
      if (newActiveId) {
        await set(ref(db, `rooms/${roomCode}/meta/activeSceneId`), newActiveId);
      }
    } catch (e) {
      console.warn('removeSceneFromFirebase failed', e);
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
        activateSceneNow(sid);
      });
      btn.addEventListener('contextmenu', function(e){
        e.preventDefault();
        e.stopPropagation();
        showCtxMenu(e.clientX, e.clientY, btn.dataset.sceneId || '');
      });
    });
  }

  /* 더블클릭 즉시 반영: Firebase activeSceneId set → onValue 리스너가 페이드+적용 */
  async function activateSceneNow(sceneId){
    if (!ROOT.St?.isGM) { ROOT.showToast('GM만 씬 전환을 할 수 있어요.'); return; }
    if (!ROOT._FB?.CONFIGURED || !ROOT.St?.roomCode) {
      ROOT.showToast('방에 입장한 상태에서만 씬을 전환할 수 있어요.');
      return;
    }
    state.activeSceneId = sceneId;
    state.selectedSceneId = sceneId;
    renderSceneList();
    const roomCode = ROOT.St.roomCode;
    const { db, ref, set } = ROOT._FB;

    // 1) 해당 씬 레코드를 항상 먼저 보장 (로컬 state 기준으로 set — 이미 있으면 덮어쓰는데 내용이 동일해 무해)
    //    단, remoteScenes에 이미 존재하면 본문은 건드리지 않고 activeSceneId만 변경 (기존 저장 내용 보호)
    const remoteHasScene = state.remoteScenes.some(function(s){ return s.id === sceneId; });
    if (!remoteHasScene) {
      const localScene = state.scenes.find(function(s){ return s.id === sceneId; });
      if (localScene) {
        const normalized = normalizeScene({ ...localScene, updatedAt: Date.now() }, sceneId);
        try {
          await set(ref(db, `rooms/${roomCode}/mapScenes/${sceneId}`), normalized);
        } catch (e) {
          console.warn('activateSceneNow: scene create failed', e);
          ROOT.showToast('씬 레코드 생성 실패: ' + (e?.message || e));
          return;
        }
      }
    }

    // 2) activeSceneId 업데이트
    try {
      await set(ref(db, `rooms/${roomCode}/meta/activeSceneId`), sceneId);
    } catch (e) {
      console.warn('activateSceneNow: activeSceneId set failed', e);
      ROOT.showToast('씬 전환 실패: ' + (e?.message || e));
    }
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
        // 새 씬도 바로 Firebase에 반영 (자동 저장 플로우 일원화)
        persistSceneListMeta().catch(function(){});
      });
    }
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = '1';
      saveBtn.addEventListener('click', function(){ saveMapScenes(); });
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

  /* 목록 메타 (이름/추가/삭제) 만 저장 - 활성 씬 본문은 자동 저장이 담당 */
  async function persistSceneListMeta(){
    if (!ROOT.St?.isGM || !ROOT._FB?.CONFIGURED || !ROOT.St?.roomCode) return;
    ensureSceneMinimum();
    const { db, ref, set, remove } = ROOT._FB;
    const roomCode = ROOT.St.roomCode;
    // 기존 Firebase 씬 목록 (remoteScenes 캐시 사용, 별도 get 호출 회피)
    const existingIds = new Set(state.remoteScenes.map(function(s){ return s.id; }));
    const localIds = new Set(state.scenes.map(function(s){ return s.id; }));

    // 1) 로컬에 새로 추가된 씬: 전체 레코드 set
    const tasks = [];
    state.scenes.forEach(function(scene, index){
      const normalized = normalizeScene({ ...scene, name: scene.name || ('씬 ' + (index + 1)) }, scene.id);
      if (!existingIds.has(normalized.id)) {
        tasks.push(set(ref(db, `rooms/${roomCode}/mapScenes/${normalized.id}`), normalized));
      } else if (scene.name !== (state.remoteScenes.find(function(s){ return s.id === scene.id; })?.name)) {
        // 이름만 변경된 경우: 이름과 updatedAt 두 필드만 set
        tasks.push(set(ref(db, `rooms/${roomCode}/mapScenes/${normalized.id}/name`), normalized.name));
        tasks.push(set(ref(db, `rooms/${roomCode}/mapScenes/${normalized.id}/updatedAt`), Date.now()));
      }
    });

    // 2) 로컬에서 삭제된 씬: remove
    existingIds.forEach(function(id){
      if (!localIds.has(id)) {
        tasks.push(remove(ref(db, `rooms/${roomCode}/mapScenes/${id}`)));
      }
    });

    // 3) activeSceneId
    if (!state.activeSceneId) state.activeSceneId = state.scenes[0]?.id || '';
    if (state.activeSceneId) {
      tasks.push(set(ref(db, `rooms/${roomCode}/meta/activeSceneId`), state.activeSceneId));
    }

    await Promise.all(tasks);
    state.isDirty = false;
  }

  async function saveMapScenes(options){
    options = options || {};
    var hint = document.getElementById('map-scene-hint');
    ensureSceneMinimum();
    if (!ROOT.St?.isGM) { ROOT.showToast('GM만 장면 전환 설정을 저장할 수 있어요.'); return; }
    if (!ROOT._FB?.CONFIGURED || !ROOT.St?.roomCode) { ROOT.showToast('방에 입장한 상태에서만 저장할 수 있어요.'); return; }
    try {
      if (hint) hint.textContent = options.silent ? (options.hintText || '기본 씬을 준비하는 중...') : '저장 중...';
      await persistSceneListMeta();
      state.autoCreatedOnOpen = false;
      if (hint) hint.textContent = options.silent ? (options.hintText || '기본 씬을 준비했어요.') : '저장됐어요 ✓';
      if (!options.silent) ROOT.showToast('장면 전환 씬 목록을 저장했어요.');
      setTimeout(function(){
        var h = document.getElementById('map-scene-hint');
        if (h && h.isConnected && !state.isDirty) h.textContent = '';
      }, 1800);
    } catch (err) {
      console.error('saveMapScenes failed', err);
      if (hint) hint.textContent = '저장에 실패했어요.';
      if (!options.silent) ROOT.showToast('저장 실패: ' + (err?.message || err));
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
