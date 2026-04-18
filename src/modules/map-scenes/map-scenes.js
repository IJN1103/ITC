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
    isApplyingScene: false,     // 씬 전환으로 라이브 맵을 교체하는 중에는 자동 저장 완전 차단
    sceneApplySeq: 0,           // 연속 더블클릭 시 오래된 적용 콜백 무효화
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
    // isEmpty 플래그: Firebase는 빈 객체를 저장하지 않으므로 "의도된 빈 상태"를 명시적으로 기록한다.
    if (raw && raw.isEmpty === true) out.isEmpty = true;
    return out;
  }

  function buildDefaultScene(){
    // 기본 씬: tokens 필드 생략 (방 최초 입장 시 기존 토큰 보존)
    return normalizeScene({ name:'기본 씬' });
  }

  function buildEmptyAddedScene(index){
    // + 버튼으로 추가하는 씬은 맵/토큰 모두 비어있는 상태를 isEmpty 플래그로 명시
    return normalizeScene({ name: '씬 ' + (index + 1), tokens: {}, isEmpty: true });
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

  function stableNormalize(value){
    if (value == null) return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return 0;
      return Math.round(value * 10000) / 10000;
    }
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(stableNormalize);
    const out = {};
    Object.keys(value).sort().forEach(function(key){
      if (typeof value[key] === 'function' || value[key] === undefined) return;
      out[key] = stableNormalize(value[key]);
    });
    return out;
  }

  function stableStringify(value){
    try { return JSON.stringify(stableNormalize(value)); } catch (_) { return ''; }
  }

  function beginSceneApplyGuard(durationMs){
    state.sceneApplySeq += 1;
    state.isApplyingScene = true;
    state.suppressAutoSaveUntil = Date.now() + Math.max(1200, Number(durationMs) || 2400);
    if (_autoSavePendingTimer) {
      clearTimeout(_autoSavePendingTimer);
      _autoSavePendingTimer = null;
    }
    _autoSavePendingSceneId = '';
    _autoSaveLastSig = '';
    return state.sceneApplySeq;
  }

  function isCurrentSceneApply(seq){
    return Number(seq) === Number(state.sceneApplySeq);
  }

  function resetAutoSaveBaselineSoon(seq, delayMs){
    window.setTimeout(function(){
      if (!isCurrentSceneApply(seq)) return;
      try { _autoSaveLastSig = currentRuntimeSignature(); } catch (_) { _autoSaveLastSig = ''; }
      state.isApplyingScene = false;
      state.suppressAutoSaveUntil = Math.max(state.suppressAutoSaveUntil, Date.now() + 350);
    }, Math.max(80, Number(delayMs) || 800));
  }

  function getCurrentRuntimeSnapshot(){
    const ms = ROOT.St?.mapState || {};
    const bg = ms.background ? {
      url: ms.background.url || '',
      fit: ms.background.fit || 'contain',
      sourceName: ms.background.sourceName || '',
      importedAt: ms.background.importedAt || 0,
    } : null;
    return {
      background: bg,
      objects: Array.isArray(ms.objects) ? deepCopy(ms.objects) : [],
      layerState: ROOT.St?.mapLayerState ? deepCopy(ROOT.St.mapLayerState) : null,
      tokens: (ROOT.St?.tokens && typeof ROOT.St.tokens === 'object') ? deepCopy(ROOT.St.tokens) : {},
    };
  }

  function getSceneHasMapData(scene){
    return !!(scene?.background?.url || (Array.isArray(scene?.objects) && scene.objects.length));
  }

  function getSceneEffectiveTokens(scene){
    if (!scene) return undefined;
    if (scene.tokens !== undefined) {
      return (scene.tokens && typeof scene.tokens === 'object') ? deepCopy(scene.tokens) : {};
    }
    if (scene.isEmpty === true) return {};
    return undefined;
  }

  function hasLayerStateData(layerState){
    if (!layerState || typeof layerState !== 'object') return false;
    try { return Object.keys(layerState).length > 0; } catch (_) { return false; }
  }

  function isSceneExplicitlyEmpty(scene){
    if (!scene) return false;
    const tokens = getSceneEffectiveTokens(scene);
    return scene.isEmpty === true
      && !scene?.background?.url
      && !(Array.isArray(scene?.objects) && scene.objects.length)
      && !hasLayerStateData(scene?.layerState)
      && (tokens === undefined || Object.keys(tokens || {}).length === 0);
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

  function buildSceneBgmPayload(scene){
    const background = scene?.background || null;
    const objects = Array.isArray(scene?.objects) ? deepCopy(scene.objects) : [];
    return {
      mapBackground: background?.url || '',
      mapBackgroundFit: background?.fit || 'contain',
      mapBackgroundSourceName: background?.sourceName || '',
      mapBackgroundImportedAt: background?.url ? (background?.importedAt || Date.now()) : 0,
      mapForeground: '',
      mapForegroundFit: '',
      mapForegroundSourceName: '',
      mapForegroundImportedAt: 0,
      mapObjects: objects,
      mapLayerState: scene?.layerState ? deepCopy(scene.layerState) : null,
    };
  }

  async function syncSceneMapToRoomBgm(scene){
    if (!ROOT.St?.isGM || !ROOT._FB?.CONFIGURED || !ROOT.St?.roomCode) return;
    try {
      const { db, ref, update } = ROOT._FB;
      await update(ref(db, `rooms/${ROOT.St.roomCode}/bgm`), buildSceneBgmPayload(scene));
    } catch (e) {
      console.warn('scene bgm sync failed', e);
    }
  }

  async function applySceneTokensToRuntime(scene, options){
    options = options || {};
    const effectiveTokens = getSceneEffectiveTokens(scene);
    if (effectiveTokens === undefined) return;
    try {
      const nextTokens = (effectiveTokens && typeof effectiveTokens === 'object') ? deepCopy(effectiveTokens) : {};
      const currentTokens = (ROOT.St?.tokens && typeof ROOT.St.tokens === 'object') ? ROOT.St.tokens : {};
      ROOT.St.tokens = deepCopy(nextTokens) || {};
      if (typeof ROOT.renderAllTokens === 'function') ROOT.renderAllTokens(ROOT.St.tokens);

      if (options.syncRoomTokens !== true) return;
      if (!ROOT.St?.isGM || !ROOT._FB?.CONFIGURED || !ROOT.St?.roomCode) return;

      const { db, ref, update } = ROOT._FB;
      const roomCode = ROOT.St.roomCode;
      const payload = {};
      Object.keys(currentTokens).forEach(function(tokenId){
        if (!Object.prototype.hasOwnProperty.call(nextTokens, tokenId)) {
          payload[`tokens/${tokenId}`] = null;
        }
      });
      Object.entries(nextTokens).forEach(function(entry){
        payload[`tokens/${entry[0]}`] = entry[1];
      });
      if (Object.keys(payload).length) {
        await update(ref(db, `rooms/${roomCode}`), payload);
      }
    } catch (e) {
      console.warn('scene token restore failed', e);
    }
  }

  async function applySceneToRuntime(scene, options){
    if (!scene) return false;
    options = options || {};
    applyMapPartToRuntime(scene);
    // isEmpty 플래그가 있으면 tokens가 누락됐더라도 "명시적 빈 씬"으로 간주한다.
    // 플레이어도 로컬 화면은 즉시 비우고, GM만 rooms/{code}/tokens 경로를 동기화한다.
    await applySceneTokensToRuntime(scene, { syncRoomTokens: options.syncRoomBgm === true });
    if (options.syncRoomBgm === true) {
      await syncSceneMapToRoomBgm(scene);
    }
    return true;
  }

  function buildSceneApplyKey(roomCode, activeId, scene){
    const sceneBody = {
      background: scene?.background || null,
      objects: Array.isArray(scene?.objects) ? scene.objects : [],
      layerState: scene?.layerState || null,
      tokens: scene?.tokens === undefined ? '__NO_TOKEN_FIELD__' : (scene.tokens || {}),
      isEmpty: scene?.isEmpty === true,
    };
    return [
      String(roomCode || '').trim(),
      String(activeId || scene?.id || '').trim(),
      Number(scene?.updatedAt || 0),
      stableStringify(sceneBody)
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
      // 첫 적용: 기본 씬은 기존 bgm/tokens 리스너와 충돌하지 않도록 맵세팅만 맞춘다.
      // 단, 명시적 빈 씬은 토큰 잔상이 남지 않아야 하므로 로컬 토큰까지 즉시 비운다.
      if (isSceneExplicitlyEmpty(scene)) {
        Promise.resolve(applySceneToRuntime(scene, { syncRoomBgm: ROOT.St?.isGM === true })).catch(function(e){
          console.warn('initial empty scene apply failed', e);
        });
      } else {
        applyMapPartToRuntime(scene);
      }
      state.syncAppliedKey = applyKey;
      return;
    }
    if (isSameSceneUpdate) {
      // 같은 LIVE 씬의 저장 내용이 갱신된 경우도 플레이어 화면에는 반영되어야 한다.
      // 명시적 빈 씬이면 토큰 잔상까지 제거하고, 그 외에는 맵 파트만 보정한다.
      if (isSceneExplicitlyEmpty(scene)) {
        Promise.resolve(applySceneToRuntime(scene, { syncRoomBgm: ROOT.St?.isGM === true })).catch(function(e){
          console.warn('same empty scene apply failed', e);
        });
      } else {
        applyMapPartToRuntime(scene);
      }
      state.syncAppliedKey = applyKey;
      return;
    }
    // 씬 전환: 선택한 씬이 현재 라이브 맵이 되도록 실제 런타임 상태를 교체한다.
    const applySeq = beginSceneApplyGuard(2800);
    runSceneFadeTransition(function(){
      if (!isCurrentSceneApply(applySeq)) return;
      Promise.resolve(applySceneToRuntime(scene, { syncRoomBgm: ROOT.St?.isGM === true })).then(function(applied){
        if (!isCurrentSceneApply(applySeq)) return;
        if (applied) state.syncAppliedKey = applyKey;
        resetAutoSaveBaselineSoon(applySeq, 900);
      }).catch(function(e){
        console.warn('scene runtime apply failed', e);
        resetAutoSaveBaselineSoon(applySeq, 900);
      });
    });
  }

  function cleanupSceneSync(){
    _sceneSyncUnsubs.forEach(function(unsub){ try { if (typeof unsub === 'function') unsub(); } catch (_) {} });
    _sceneSyncUnsubs = [];
    state.syncRoomCode = '';
    state.remoteScenes = [];
    state.remoteActiveSceneId = '';
    state.syncAppliedKey = '';
    // 방이 바뀌면 이전 방의 로컬 씬 목록/선택 상태가 새 방으로 넘어오지 않도록 전부 초기화
    state.scenes = [];
    state.selectedSceneId = '';
    state.activeSceneId = '';
    state.loadedRoomCode = '';
    state.isDirty = false;
    state.autoCreatedOnOpen = false;
    state.suppressAutoSaveUntil = 0;
    state.isApplyingScene = false;
    state.sceneApplySeq += 1;
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
  let _autoSavePendingSceneId = '';
  let _autoSaveLastSig = '';

  function stopActiveSceneAutoSave(){
    if (_autoSaveTimer) { clearInterval(_autoSaveTimer); _autoSaveTimer = null; }
    if (_autoSavePendingTimer) { clearTimeout(_autoSavePendingTimer); _autoSavePendingTimer = null; }
    _autoSavePendingSceneId = '';
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
    return stableStringify(getCurrentRuntimeSnapshot());
  }

  function getCurrentActiveSceneId(){
    return String(state.remoteActiveSceneId || state.activeSceneId || "").trim();
  }

  function canPersistActiveSceneTarget(sceneId, roomCode){
    const targetId = String(sceneId || "").trim();
    const activeId = getCurrentActiveSceneId();
    const currentRoomCode = String(ROOT.St?.roomCode || "").trim();
    if (!targetId || !activeId || targetId !== activeId) return false;
    if (!roomCode || roomCode !== currentRoomCode || roomCode !== state.syncRoomCode) return false;
    if (state.isApplyingScene) return false;
    if (Date.now() < state.suppressAutoSaveUntil) return false;
    if (!state.remoteScenes.some(function(s){ return s.id === targetId; }) && !state.scenes.some(function(s){ return s.id === targetId; })) return false;
    return true;
  }

  function autoSavePollTick(){
    if (!ROOT.St?.isGM) return;
    if (!ROOT._FB?.CONFIGURED) return;
    const roomCode = String(ROOT.St?.roomCode || '').trim();
    if (!roomCode || roomCode !== state.syncRoomCode) return;
    if (state.isApplyingScene) return;
    if (Date.now() < state.suppressAutoSaveUntil) return;
    if (!state.remoteActiveSceneId) return;

    const sig = currentRuntimeSignature();
    if (!_autoSaveLastSig) { _autoSaveLastSig = sig; return; }
    if (sig === _autoSaveLastSig) return;

    // 변경 감지됨 → 현재 activeSceneId를 함께 고정해서 debounce 중 씬이 바뀌면 저장하지 않는다.
    const targetSceneId = getCurrentActiveSceneId();
    if (!canPersistActiveSceneTarget(targetSceneId, roomCode)) return;
    _autoSaveLastSig = sig;
    _autoSavePendingSceneId = targetSceneId;
    if (_autoSavePendingTimer) clearTimeout(_autoSavePendingTimer);
    _autoSavePendingTimer = window.setTimeout(function(){
      const pendingSceneId = String(_autoSavePendingSceneId || '').trim();
      _autoSavePendingTimer = null;
      _autoSavePendingSceneId = '';
      if (!canPersistActiveSceneTarget(pendingSceneId, roomCode)) return;
      persistActiveSceneFromRuntime(pendingSceneId).catch(function(e){
        console.warn('persistActiveSceneFromRuntime failed', e);
      });
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  function buildRuntimeSceneSnapshot(sceneId){
    const targetId = String(sceneId || '').trim();
    if (!targetId) return null;
    const snapshot = getCurrentRuntimeSnapshot();
    const ms = { background: snapshot.background, objects: snapshot.objects };
    const tokens = snapshot.tokens || {};
    const existing = state.remoteScenes.find(function(s){ return s.id === targetId; })
      || state.scenes.find(function(s){ return s.id === targetId; })
      || {};
    const hasMap = !!(ms.background?.url || (Array.isArray(ms.objects) && ms.objects.length));
    const hasTokens = Object.keys(tokens).length > 0;
    const hasLayers = hasLayerStateData(snapshot.layerState);
    const isStillEmpty = !hasMap && !hasTokens && !hasLayers;
    const rawNext = {
      id: targetId,
      name: existing.name || '씬',
      createdAt: existing.createdAt || Date.now(),
      updatedAt: Date.now(),
      background: ms.background ? { url: ms.background.url || '', fit: ms.background.fit || 'contain', sourceName: ms.background.sourceName || '', importedAt: ms.background.importedAt || 0 } : null,
      objects: Array.isArray(ms.objects) ? deepCopy(ms.objects) : [],
      layerState: isStillEmpty ? null : (snapshot.layerState ? deepCopy(snapshot.layerState) : null),
      tokens: tokens,
    };
    if (isStillEmpty) rawNext.isEmpty = true;
    return normalizeScene(rawNext, targetId);
  }

  async function persistSceneFromRuntime(sceneId, options){
    options = options || {};
    if (!ROOT.St?.isGM || !ROOT._FB?.CONFIGURED) return null;
    if (state.isApplyingScene || Date.now() < state.suppressAutoSaveUntil) return null;
    const roomCode = String(ROOT.St?.roomCode || '').trim();
    if (!roomCode) return null;
    const targetId = String(sceneId || '').trim();
    if (!options.allowInactive && !canPersistActiveSceneTarget(targetId, roomCode)) return null;
    const nextScene = buildRuntimeSceneSnapshot(targetId);
    if (!nextScene) return null;
    const { db, ref, set } = ROOT._FB;
    try {
      if (!options.allowInactive && !canPersistActiveSceneTarget(nextScene.id, roomCode)) return null;
      await set(ref(db, `rooms/${roomCode}/mapScenes/${nextScene.id}`), nextScene);
      if (!options.allowInactive && !canPersistActiveSceneTarget(nextScene.id, roomCode)) return nextScene;
      const idx = state.scenes.findIndex(function(s){ return s.id === nextScene.id; });
      if (idx >= 0) state.scenes[idx] = nextScene;
      else state.scenes.push(nextScene);
      const ridx = state.remoteScenes.findIndex(function(s){ return s.id === nextScene.id; });
      if (ridx >= 0) state.remoteScenes[ridx] = nextScene;
      else state.remoteScenes.push(nextScene);
      renderSceneList();
      return nextScene;
    } catch (e) {
      console.warn('persistSceneFromRuntime set failed', e);
      throw e;
    }
  }

  async function persistActiveSceneFromRuntime(expectedSceneId){
    const activeId = String(expectedSceneId || getCurrentActiveSceneId()).trim();
    const roomCode = String(ROOT.St?.roomCode || '').trim();
    if (!activeId || !canPersistActiveSceneTarget(activeId, roomCode)) return null;
    return persistSceneFromRuntime(activeId);
  }

  /* ── context menu (capture / rename / delete) ──
     - 현재 맵 저장(capture): 지금 라이브 맵/토큰 상태를 선택 씬에 즉시 캡처한다.
     - 이름 편집/삭제: 씬 목록 메타 변경. 하단 '씬 설정 저장'과 같은 목록 관리 영역이다. */
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
      persistSceneFromRuntime(sceneId, { allowInactive: true }).then(function(saved){
        if (!saved) { ROOT.showToast('현재 맵을 저장할 수 있는 상태가 아니에요.'); return; }
        ROOT.showToast('현재 맵 상태를 이 씬에 즉시 저장했어요.');
      }).catch(function(e){
        ROOT.showToast('현재 맵 저장 실패: ' + (e?.message || e));
      });
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

  /* 더블클릭 즉시 반영: Firebase activeSceneId set + 현재 라이브 맵 데이터 교체 */
  async function activateSceneNow(sceneId){
    if (!ROOT.St?.isGM) { ROOT.showToast('GM만 씬 전환을 할 수 있어요.'); return; }
    if (!ROOT._FB?.CONFIGURED || !ROOT.St?.roomCode) {
      ROOT.showToast('방에 입장한 상태에서만 씬을 전환할 수 있어요.');
      return;
    }
    const localScene = state.scenes.find(function(s){ return s.id === sceneId; });
    const remoteScene = state.remoteScenes.find(function(s){ return s.id === sceneId; });
    const scene = remoteScene || localScene;
    if (!scene) {
      ROOT.showToast('전환할 씬 정보를 찾을 수 없어요.');
      return;
    }

    const applySeq = beginSceneApplyGuard(3200);
    state.activeSceneId = sceneId;
    state.selectedSceneId = sceneId;
    state.remoteActiveSceneId = sceneId;
    renderSceneList();

    const roomCode = ROOT.St.roomCode;
    const { db, ref, set } = ROOT._FB;
    const normalized = normalizeScene(scene, sceneId);

    try {
      // 1) 씬 레코드 보장: 새로 추가한 빈 씬도 즉시 Firebase에 존재해야 모든 클라이언트가 전환 가능하다.
      if (!remoteScene) {
        await set(ref(db, `rooms/${roomCode}/mapScenes/${sceneId}`), normalized);
      }

      // 2) activeSceneId 먼저 갱신: 플레이어/GM 모두 같은 LIVE 씬을 바라보게 한다.
      await set(ref(db, `rooms/${roomCode}/meta/activeSceneId`), sceneId);

      // 3) 실제 라이브 맵 데이터 교체: 기존 맵 기능들이 바라보는 bgm/tokens 경로까지 맞춘다.
      //    빈 씬이면 bgm은 비워지고, tokens는 빈 객체로 동기화되어 화면도 빈 맵이 된다.
      if (!isCurrentSceneApply(applySeq)) return;
      await applySceneToRuntime(normalized, { syncRoomBgm: true });
      if (!isCurrentSceneApply(applySeq)) return;
      state.syncAppliedKey = buildSceneApplyKey(roomCode, sceneId, normalized);

      // 4) 자동 저장 기준선을 전환 후 상태로 재설정해서 직전 씬 데이터가 새 씬에 덮이는 것을 막는다.
      resetAutoSaveBaselineSoon(applySeq, 900);
    } catch (e) {
      console.warn('activateSceneNow failed', e);
      ROOT.showToast('씬 전환 실패: ' + (e?.message || e));
      resetAutoSaveBaselineSoon(applySeq, 900);
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

  /* 목록 메타 저장 전용
     - 씬 추가/삭제/이름 변경/activeSceneId 같은 목록 설정을 저장한다.
     - 활성 씬의 맵/토큰 본문은 자동 저장 또는 우클릭 '현재 맵 저장'이 담당한다. */
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
      if (hint) hint.textContent = options.silent ? (options.hintText || '기본 씬을 준비하는 중...') : '씬 목록 설정 저장 중...';
      await persistSceneListMeta();
      state.autoCreatedOnOpen = false;
      if (hint) hint.textContent = options.silent ? (options.hintText || '기본 씬을 준비했어요.') : '씬 목록 설정이 저장됐어요 ✓';
      if (!options.silent) ROOT.showToast('씬 목록/이름 설정을 저장했어요.');
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
