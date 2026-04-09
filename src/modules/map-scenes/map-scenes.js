/**
 * ITC TRPG — Map Scenes (Stage 1)
 * 씬 데이터 구조 + GM 전용 설정창 UI 뼈대
 */
(function(){
  const ROOT = window;
  const state = {
    scenes: [],
    selectedSceneId: '',
    activeSceneId: '',
    loadedRoomCode: '',
    isDirty: false,
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
    if (!state.selectedSceneId || !state.scenes.some(scene => scene.id === state.selectedSceneId)) {
      state.selectedSceneId = state.scenes[0].id;
    }
    if (!state.activeSceneId || !state.scenes.some(scene => scene.id === state.activeSceneId)) {
      state.activeSceneId = state.scenes[0].id;
    }
  }

  function getSelectedScene(){
    return state.scenes.find(scene => scene.id === state.selectedSceneId) || null;
  }

  function getMapScenesRefs(){
    if (!ROOT._FB?.CONFIGURED || !ROOT.St?.roomCode) return null;
    const { db, ref } = ROOT._FB;
    const roomCode = ROOT.St.roomCode;
    return {
      scenesRef: ref(db, `rooms/${roomCode}/mapScenes`),
      activeRef: ref(db, `rooms/${roomCode}/meta/activeSceneId`),
    };
  }

  async function loadScenesFromRoom(){
    if (!ROOT.St?.roomCode) {
      state.scenes = [buildDefaultScene()];
      state.selectedSceneId = state.scenes[0].id;
      state.activeSceneId = state.scenes[0].id;
      state.loadedRoomCode = '';
      state.isDirty = false;
      return;
    }
    if (!ROOT._FB?.CONFIGURED) {
      state.scenes = [buildDefaultScene()];
      state.selectedSceneId = state.scenes[0].id;
      state.activeSceneId = state.scenes[0].id;
      state.loadedRoomCode = ROOT.St.roomCode;
      state.isDirty = false;
      return;
    }
    const refs = getMapScenesRefs();
    if (!refs) return;
    const { get } = ROOT._FB;
    const [sceneSnap, activeSnap] = await Promise.all([get(refs.scenesRef), get(refs.activeRef)]);
    const rawScenes = sceneSnap.val() || {};
    const entries = Object.entries(rawScenes).map(([id, raw]) => normalizeScene(raw, id));
    state.scenes = entries.sort((a,b)=> (a.createdAt||0) - (b.createdAt||0));
    state.activeSceneId = String(activeSnap.val() || '').trim();
    state.loadedRoomCode = ROOT.St.roomCode;
    state.isDirty = false;
    ensureSceneMinimum();
  }

  function renderSceneList(){
    const listEl = document.getElementById('map-scene-list');
    const emptyEl = document.getElementById('map-scene-empty');
    if (!listEl || !emptyEl) return;
    ensureSceneMinimum();
    if (!state.scenes.length) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = state.scenes.map(scene => {
      const isSelected = scene.id === state.selectedSceneId;
      const isActive = scene.id === state.activeSceneId;
      return `
        <button type="button" class="map-scene-item${isSelected ? ' is-selected' : ''}" data-scene-id="${scene.id}">
          <div class="map-scene-item-main">
            <div class="map-scene-item-name">${ROOT.esc(scene.name || '무제 씬')}</div>
            <div class="map-scene-item-meta">${isActive ? '현재 표시 중' : '대기 중'}</div>
          </div>
          ${isActive ? '<span class="map-scene-badge">LIVE</span>' : ''}
        </button>`;
    }).join('');
    listEl.querySelectorAll('.map-scene-item').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedSceneId = btn.dataset.sceneId || '';
        renderMapSceneModal();
      });
    });
  }

  function renderSceneForm(){
    const nameInput = document.getElementById('map-scene-name-input');
    const activeSelect = document.getElementById('map-scene-active-select');
    const preview = document.getElementById('map-scene-preview-body');
    const deleteBtn = document.getElementById('map-scene-delete-btn');
    const selected = getSelectedScene();
    if (!nameInput || !activeSelect || !preview || !deleteBtn) return;

    activeSelect.innerHTML = state.scenes.map(scene => `<option value="${scene.id}">${ROOT.esc(scene.name || '무제 씬')}</option>`).join('');
    activeSelect.value = state.activeSceneId || (state.scenes[0]?.id || '');

    if (selected) {
      nameInput.value = selected.name || '';
      preview.textContent = [
        `씬 ID: ${selected.id}`,
        `배경 저장 여부: ${selected.background ? '있음' : '없음'}`,
        `오브젝트 수: ${Array.isArray(selected.objects) ? selected.objects.length : 0}`,
        `레이어 상태 저장 여부: ${selected.layerState ? '있음' : '없음'}`,
        '',
        '※ 현재 단계에서는 씬 구조 / 이름 / 현재 씬 선택 정보만 관리합니다.',
      ].join('\n');
    } else {
      nameInput.value = '';
      preview.textContent = '씬을 선택해주세요.';
    }
    deleteBtn.disabled = state.scenes.length <= 1;
  }

  function renderMapSceneModal(){
    renderSceneList();
    renderSceneForm();
    const hint = document.getElementById('map-scene-hint');
    if (hint && !state.isDirty) hint.textContent = '';
  }

  function bindSceneModalEvents(){
    const addBtn = document.getElementById('map-scene-add-btn');
    const deleteBtn = document.getElementById('map-scene-delete-btn');
    const saveBtn = document.getElementById('map-scene-save-btn');
    const nameInput = document.getElementById('map-scene-name-input');
    const activeSelect = document.getElementById('map-scene-active-select');
    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = '1';
      addBtn.addEventListener('click', () => {
        const next = normalizeScene({ name: `씬 ${state.scenes.length + 1}` });
        state.scenes.push(next);
        state.selectedSceneId = next.id;
        if (!state.activeSceneId) state.activeSceneId = next.id;
        state.isDirty = true;
        renderMapSceneModal();
      });
    }
    if (deleteBtn && !deleteBtn.dataset.bound) {
      deleteBtn.dataset.bound = '1';
      deleteBtn.addEventListener('click', () => {
        if (state.scenes.length <= 1) {
          ROOT.showToast('씬은 최소 1개 이상 있어야 해요.');
          return;
        }
        const currentId = state.selectedSceneId;
        state.scenes = state.scenes.filter(scene => scene.id !== currentId);
        ensureSceneMinimum();
        if (state.activeSceneId === currentId) state.activeSceneId = state.scenes[0].id;
        state.selectedSceneId = state.scenes[0].id;
        state.isDirty = true;
        renderMapSceneModal();
      });
    }
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = '1';
      saveBtn.addEventListener('click', saveMapScenes);
    }
    if (nameInput && !nameInput.dataset.bound) {
      nameInput.dataset.bound = '1';
      nameInput.addEventListener('input', () => {
        const selected = getSelectedScene();
        if (!selected) return;
        selected.name = String(nameInput.value || '').trim() || '무제 씬';
        selected.updatedAt = Date.now();
        state.isDirty = true;
        renderMapSceneModal();
      });
    }
    if (activeSelect && !activeSelect.dataset.bound) {
      activeSelect.dataset.bound = '1';
      activeSelect.addEventListener('change', () => {
        state.activeSceneId = String(activeSelect.value || '').trim();
        state.isDirty = true;
        renderMapSceneModal();
      });
    }
  }

  async function saveMapScenes(){
    const hint = document.getElementById('map-scene-hint');
    ensureSceneMinimum();
    if (!ROOT.St?.isGM) {
      ROOT.showToast('GM만 장면 전환 설정을 저장할 수 있어요.');
      return;
    }
    const refs = getMapScenesRefs();
    if (!refs) {
      ROOT.showToast('방에 입장한 상태에서만 저장할 수 있어요.');
      return;
    }
    const { set } = ROOT._FB;
    const payload = {};
    state.scenes.forEach((scene, index) => {
      const normalized = normalizeScene({ ...scene, name: scene.name || `씬 ${index + 1}`, updatedAt: Date.now() }, scene.id);
      payload[normalized.id] = normalized;
    });
    try {
      if (hint) hint.textContent = '저장 중...';
      await Promise.all([
        set(refs.scenesRef, payload),
        set(refs.activeRef, state.activeSceneId || state.scenes[0].id),
      ]);
      state.isDirty = false;
      if (hint) hint.textContent = '저장됐어요 ✓';
      ROOT.showToast('장면 전환 씬 설정을 저장했어요.');
      setTimeout(() => {
        const nextHint = document.getElementById('map-scene-hint');
        if (nextHint && nextHint.isConnected && !state.isDirty) nextHint.textContent = '';
      }, 1800);
    } catch (err) {
      console.error('saveMapScenes failed', err);
      if (hint) hint.textContent = '저장에 실패했어요.';
      ROOT.showToast('장면 전환 씬 저장에 실패했어요.');
    }
  }

  async function openMapSceneModal(){
    if (!ROOT.St?.isGM) {
      ROOT.showToast('GM만 장면 전환 설정을 열 수 있어요.');
      return;
    }
    ROOT.openModal('modal-map-scenes');
    bindSceneModalEvents();
    const roomChanged = state.loadedRoomCode !== String(ROOT.St?.roomCode || '');
    if (roomChanged || !state.scenes.length) await loadScenesFromRoom();
    renderMapSceneModal();
  }

  function closeMapSceneModal(){
    ROOT.closeModal('modal-map-scenes');
  }

  ROOT.openMapSceneModal = openMapSceneModal;
  ROOT.closeMapSceneModal = closeMapSceneModal;
})();
