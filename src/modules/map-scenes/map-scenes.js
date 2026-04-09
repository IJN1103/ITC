/**
 * ITC TRPG — Map Scenes (Stage 1)
 * 씬 데이터 구조 + GM 전용 설정창 UI
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
  };

  function makeSceneId(){
    return `scene_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
  }

  function normalizeScene(raw, id){
    const sceneId = String(id || raw?.id || '').trim() || makeSceneId();
    return {
      id: sceneId,
      name: String(raw?.name || '기본 씬').trim() || '기본 씬',
      background: raw?.background || null,
      objects: Array.isArray(raw?.objects) ? raw.objects : [],
      layerState: raw?.layerState || null,
      createdAt: Number(raw?.createdAt) || Date.now(),
      updatedAt: Number(raw?.updatedAt) || Date.now(),
    };
  }

  function buildDefaultScene(){
    return normalizeScene({ name:'기본 씬' });
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
    ctx.style.left = Math.min(x, window.innerWidth - 140) + 'px';
    ctx.style.top = Math.min(y, window.innerHeight - 90) + 'px';
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
      return '<button type="button" class="map-scene-item' + (isSelected ? ' is-selected' : '') + '" data-scene-id="' + scene.id + '">'
        + '<div class="map-scene-item-main">'
        + '<div class="map-scene-item-index">씬 ' + (index + 1) + '</div>'
        + '<div class="map-scene-item-name">' + ROOT.esc(scene.name || '무제 씬') + '</div>'
        + '<div class="map-scene-item-meta">' + (isActive ? '현재 표시 중' : '대기 중') + '</div>'
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
        var next = normalizeScene({ name: '씬 ' + (state.scenes.length + 1) });
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

  ROOT.openMapSceneModal = openMapSceneModal;
  ROOT.closeMapSceneModal = closeMapSceneModal;
})();
