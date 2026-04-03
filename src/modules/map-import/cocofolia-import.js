(function () {
  const IMPORT_STATE = {
    lastValidated: null,
    pendingFile: null,
    isBusy: false,
  };

  function requireMapImportGM() {
    if (typeof requireGM === 'function') return requireGM('map import');
    if (!window.St?.isGM) {
      if (typeof showToast === 'function') showToast('GM만 사용할 수 있는 기능이에요.');
      return false;
    }
    return true;
  }

  function getModalElements() {
    return {
      summary: document.getElementById('map-import-summary'),
      error: document.getElementById('map-import-error'),
      hint: document.getElementById('map-import-hint'),
      fileInput: document.getElementById('map-import-file'),
    };
  }

  function resetMapImportUi() {
    const { summary, error, hint, fileInput } = getModalElements();
    if (summary) {
      summary.style.display = 'none';
      summary.innerHTML = '';
    }
    if (error) {
      error.style.display = 'none';
      error.textContent = '';
    }
    if (hint) {
      hint.style.display = '';
      hint.textContent = '지원 항목: 배경 + 전경 + image item 오브젝트 일부 import';
    }
    if (fileInput) fileInput.value = '';
    IMPORT_STATE.lastValidated = null;
    IMPORT_STATE.pendingFile = null;
  }

  function openMapImportModal() {
    if (!requireMapImportGM()) return;
    resetMapImportUi();
    if (typeof openModal === 'function') openModal('modal-map-import');
  }

  function setHint(message) {
    const { hint } = getModalElements();
    if (hint) {
      hint.style.display = '';
      hint.textContent = message;
    }
  }

  function getMapBackgroundLayer() {
    return document.getElementById('map-bg-layer');
  }

  function getMapForegroundLayer() {
    return document.getElementById('map-fg-layer');
  }

  function getMapInner() {
    return document.getElementById('map-inner');
  }

  function clearImportedMapObjects() {
    document.querySelectorAll('.map-import-object[data-map-layer-id]').forEach((el) => el.remove());
  }

  function applyImportedMapState(mapState) {
    const bgLayer = getMapBackgroundLayer();
    const fgLayer = getMapForegroundLayer();
    const mapInner = getMapInner();
    const background = mapState?.background || null;
    const foreground = mapState?.foreground || null;
    const objects = Array.isArray(mapState?.objects) ? mapState.objects : [];
    if (bgLayer) {
      if (!background?.url) {
        bgLayer.style.backgroundImage = '';
        bgLayer.style.backgroundSize = 'contain';
      } else {
        const fit = String(background.fit || 'contain').trim() || 'contain';
        bgLayer.style.backgroundImage = `url("${String(background.url).replace(/"/g, '%22')}")`;
        bgLayer.style.backgroundSize = fit === 'fill' ? '100% 100%' : (fit === 'cover' ? 'cover' : 'contain');
      }
    }
    if (fgLayer) {
      if (!foreground?.url) {
        fgLayer.style.backgroundImage = '';
        fgLayer.style.backgroundSize = 'contain';
      } else {
        const fit = String(foreground.fit || 'contain').trim() || 'contain';
        fgLayer.style.backgroundImage = `url("${String(foreground.url).replace(/"/g, '%22')}")`;
        fgLayer.style.backgroundSize = fit === 'fill' ? '100% 100%' : (fit === 'cover' ? 'cover' : 'contain');
      }
    }
    clearImportedMapObjects();
    if (!mapInner) return;
    objects.forEach((item, index) => {
      if (!item?.url) return;
      const el = document.createElement('div');
      const layerId = String(item.layerId || `object:${item.id || index + 1}`);
      el.className = 'map-import-object';
      el.dataset.mapLayerId = layerId;
      el.id = `map-layer-${layerId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      el.style.left = `${Number(item.xPct || 0)}%`;
      el.style.top = `${Number(item.yPct || 0)}%`;
      el.style.width = `${Number(item.wPct || 0)}%`;
      el.style.height = `${Number(item.hPct || 0)}%`;
      el.style.backgroundImage = `url("${String(item.url).replace(/"/g, '%22')}")`;
      el.style.transform = `translate(-50%, -50%) rotate(${Number(item.angle || 0)}deg)`;
      mapInner.appendChild(el);
    });
  }

  function pickLiveRoomCode() {
    const candidates = [
      String(window.St?.roomCode || '').trim(),
      String(sessionStorage.getItem('itc_session_code') || '').trim(),
      String(document.getElementById('topbar-code')?.textContent || '').trim(),
      String(document.getElementById('room-code-disp')?.textContent || '').trim(),
    ].filter(Boolean);

    return candidates.find((code) => code && code !== 'local' && /^[A-Z0-9]{4,10}$/i.test(code)) || '';
  }

  async function ensureLiveRoomContext() {
    const roomCode = pickLiveRoomCode();
    const myId = String(
      window.St?.myId ||
      window._currentUser?.uid ||
      window._FB?.auth?.currentUser?.uid ||
      ''
    ).trim();
    if (!window._FB?.CONFIGURED) {
      throw new Error('Firebase가 연결된 실제 세션 방에서만 맵세팅을 적용할 수 있어요.');
    }
    if (!roomCode) {
      throw new Error('현재 local 상태입니다. 실제 세션 방에 입장한 뒤 다시 시도해 주세요.');
    }
    if (window.St) window.St.roomCode = roomCode;
    if (window.St && myId) window.St.myId = myId;
    if (!myId) {
      throw new Error('로그인 정보가 확인되지 않아요. 다시 로그인 후 시도해 주세요.');
    }
    const { db, ref, get } = window._FB;
    const playerSnap = await get(ref(db, `rooms/${roomCode}/players/${myId}`));
    if (!playerSnap.exists()) {
      throw new Error('현재 계정이 이 방의 참가자로 확인되지 않아요. 방에 다시 입장한 뒤 시도해 주세요.');
    }
    return { roomCode, myId };
  }

  async function getImageSizeFromBlob(blob) {
    if (!blob) return null;
    try {
      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob);
        const size = { width: Number(bitmap.width || 0), height: Number(bitmap.height || 0) };
        if (typeof bitmap.close === 'function') bitmap.close();
        if (size.width > 0 && size.height > 0) return size;
      }
    } catch (err) {
      console.warn('image size detection via createImageBitmap failed', err);
    }
    return await new Promise((resolve) => {
      try {
        const objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const size = { width: Number(img.naturalWidth || 0), height: Number(img.naturalHeight || 0) };
          URL.revokeObjectURL(objectUrl);
          resolve(size.width > 0 && size.height > 0 ? size : null);
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(null);
        };
        img.src = objectUrl;
      } catch (err) {
        console.warn('image size detection via Image failed', err);
        resolve(null);
      }
    });
  }

  async function uploadMapLayerBlob(blob, roomCode, fileName) {
    if (typeof _itcUploadToCloudinary !== 'function') throw new Error('이미지 업로드 유틸을 찾지 못했어요.');
    const result = await _itcUploadToCloudinary({
      blob,
      folder: `itc/map-backgrounds/${roomCode || 'local'}`,
      fileName: fileName || `map-background-${Date.now()}.png`,
      timeout: 30000,
    });
    return result?.url || '';
  }

  function buildApplyActions() {
    return `<div style="display:flex;gap:8px;margin-top:10px"><button class="btn-primary" onclick="applyValidatedMapBackground()" style="flex:1">맵 이미지 적용</button></div>`;
  }

  function setError(message) {
    const { error, hint } = getModalElements();
    if (error) {
      error.style.display = '';
      error.textContent = message;
    }
    if (hint) hint.style.display = 'none';
  }

  function setSummary(html) {
    const { summary, hint, error } = getModalElements();
    if (summary) {
      summary.style.display = '';
      summary.innerHTML = html;
    }
    if (hint) hint.style.display = 'none';
    if (error) {
      error.style.display = 'none';
      error.textContent = '';
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ensureJsZipReady() {
    if (!window.JSZip) {
      throw new Error('ZIP 해제 라이브러리를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.');
    }
  }

  function buildValidationSummary(file, parsed) {
    const room = parsed?.entities?.room || {};
    const items = parsed?.entities?.items || {};
    const resources = parsed?.resources || {};
    const version = parsed?.meta?.version || '알 수 없음';
    const gridLabel = room.displayGrid ? '표시' : '숨김';
    return [
      `<b>검사 완료</b>`,
      `파일명: ${escapeHtml(file.name)}`,
      `버전: ${escapeHtml(version)}`,
      `배경 이미지: ${room.backgroundUrl ? '있음' : '없음'}`,
      `전경 이미지: ${room.foregroundUrl ? '있음' : '없음'}`,
      `item 수: ${Object.keys(items).length}개`,
      `리소스 수: ${Object.keys(resources).length}개`,
      `그리드: ${gridLabel} / 크기 ${Number(room.gridSize || 0) || 0}`,
      `배경 + 전경 + image item 오브젝트 일부를 실제 맵에 적용할 수 있습니다.`,
    ].join('<br>') + buildApplyActions();
  }

  function validateParsedCocofoliaData(data) {
    if (!data || typeof data !== 'object') throw new Error('__data.json 형식이 올바르지 않아요.');
    if (!data.meta || typeof data.meta !== 'object') throw new Error('meta 정보가 없어요.');
    if (!data.entities || typeof data.entities !== 'object') throw new Error('entities 정보가 없어요.');
    if (!data.resources || typeof data.resources !== 'object') throw new Error('resources 정보가 없어요.');
    if (!data.entities.room || typeof data.entities.room !== 'object') throw new Error('room 정보가 없어요.');
    if (!data.entities.items || typeof data.entities.items !== 'object') throw new Error('items 정보가 없어요.');
    return true;
  }

  async function parseCocofoliaZip(file) {
    ensureJsZipReady();
    const zip = await window.JSZip.loadAsync(file);
    const dataEntry = zip.file('__data.json');
    if (!dataEntry) throw new Error('코코포리아 ZIP이 아니에요. __data.json 파일이 없습니다.');
    const jsonText = await dataEntry.async('string');
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      throw new Error('__data.json을 읽었지만 JSON 파싱에 실패했어요.');
    }
    validateParsedCocofoliaData(parsed);
    return parsed;
  }

  function buildImportedMapObjects(itemsMap = {}, sceneAspect = 1) {
    const rawItems = Object.entries(itemsMap)
      .map(([id, item]) => ({ id, ...(item || {}) }))
      .filter((item) => item.type === 'object' && item.visible !== false && String(item.imageUrl || '').trim());

    if (!rawItems.length) return [];

    const bounds = rawItems.reduce((acc, item) => {
      const x = Number(item.x || 0);
      const y = Number(item.y || 0);
      const w = Math.max(1, Number(item.width || 1));
      const h = Math.max(1, Number(item.height || 1));
      acc.left = Math.min(acc.left, x - w / 2);
      acc.right = Math.max(acc.right, x + w / 2);
      acc.top = Math.min(acc.top, y - h / 2);
      acc.bottom = Math.max(acc.bottom, y + h / 2);
      return acc;
    }, { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });

    const pad = 2;
    const rawSpanW = Math.max(1, (bounds.right - bounds.left) + pad * 2);
    const rawSpanH = Math.max(1, (bounds.bottom - bounds.top) + pad * 2);
    const normalizedSceneAspect = Math.max(0.1, Number(sceneAspect || 1) || 1);
    let spanW = rawSpanW;
    let spanH = rawSpanH;
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    const currentAspect = rawSpanW / rawSpanH;
    if (currentAspect < normalizedSceneAspect) {
      spanW = rawSpanH * normalizedSceneAspect;
    } else if (currentAspect > normalizedSceneAspect) {
      spanH = rawSpanW / normalizedSceneAspect;
    }
    const baseLeft = centerX - spanW / 2;
    const baseTop = centerY - spanH / 2;

    return rawItems
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map((item) => {
        const x = Number(item.x || 0);
        const y = Number(item.y || 0);
        const w = Math.max(1, Number(item.width || 1));
        const h = Math.max(1, Number(item.height || 1));
        const objectId = String(item.id || '');
        const imageName = String(item.imageUrl || '').trim();
        const displayName = String(item.name || '').trim() || imageName || `오브젝트 ${Number(item.order || 0) || 0}`;
        return {
          id: objectId,
          layerId: `object:${objectId}`,
          name: displayName,
          imageName,
          angle: Number(item.angle || 0),
          order: Number(item.order || 0),
          xPct: ((x - baseLeft) / spanW) * 100,
          yPct: ((y - baseTop) / spanH) * 100,
          wPct: (w / spanW) * 100,
          hPct: (h / spanH) * 100,
        };
      });
  }

  async function handleMapImportFile(input) {
    if (!requireMapImportGM()) {
      if (input) input.value = '';
      return;
    }
    const file = input?.files?.[0];
    if (!file) return;
    if (IMPORT_STATE.isBusy) return;
    IMPORT_STATE.isBusy = true;
    const { hint } = getModalElements();
    try {
      if (!/\.zip$/i.test(file.name)) throw new Error('ZIP 파일만 업로드할 수 있어요.');
      if (hint) {
        hint.style.display = '';
        hint.textContent = '맵세팅 ZIP을 검사하는 중이에요…';
      }
      const parsed = await parseCocofoliaZip(file);
      IMPORT_STATE.lastValidated = { fileName: file.name, parsed };
      IMPORT_STATE.pendingFile = file;
      setSummary(buildValidationSummary(file, parsed));
      if (typeof showToast === 'function') showToast('맵세팅 ZIP 검사 완료');
    } catch (err) {
      console.error('map import validation failed', err);
      IMPORT_STATE.lastValidated = null;
      IMPORT_STATE.pendingFile = null;
      setError(err?.message || '맵세팅 ZIP 검사 중 오류가 발생했어요.');
    } finally {
      IMPORT_STATE.isBusy = false;
      if (input) input.value = '';
    }
  }

  async function applyValidatedMapBackground() {
    if (!requireMapImportGM()) return;
    if (IMPORT_STATE.isBusy) return;
    const pendingFile = IMPORT_STATE.pendingFile;
    const validated = IMPORT_STATE.lastValidated;
    if (!pendingFile || !validated?.parsed) {
      setError('먼저 검사 완료된 맵세팅 ZIP을 선택해 주세요.');
      return;
    }
    const room = validated.parsed?.entities?.room || {};
    const backgroundName = String(room.backgroundUrl || '').trim();
    if (!backgroundName) {
      setError('이 맵세팅에는 배경 이미지가 없습니다.');
      return;
    }
    IMPORT_STATE.isBusy = true;
    try {
      setHint('세션 상태를 확인한 뒤 배경 이미지를 업로드하는 중이에요…');
      const { roomCode } = await ensureLiveRoomContext();
      const zip = await window.JSZip.loadAsync(pendingFile);
      const backgroundEntry = zip.file(backgroundName);
      if (!backgroundEntry) throw new Error('ZIP 안에서 배경 이미지 파일을 찾지 못했어요.');
      const blob = await backgroundEntry.async('blob');
      const backgroundSize = await getImageSizeFromBlob(blob);
      const ext = backgroundName.split('.').pop() || 'png';
      const uploadedUrl = await uploadMapLayerBlob(blob, roomCode, `map-bg-${Date.now()}.${ext}`);
      if (!uploadedUrl) throw new Error('배경 이미지 업로드에 실패했어요.');

      let foregroundState = null;
      let foregroundSize = null;
      const foregroundName = String(room.foregroundUrl || '').trim();
      if (foregroundName) {
        const foregroundEntry = zip.file(foregroundName);
        if (!foregroundEntry) throw new Error('ZIP 안에서 전경 이미지 파일을 찾지 못했어요.');
        const foregroundBlob = await foregroundEntry.async('blob');
        foregroundSize = await getImageSizeFromBlob(foregroundBlob);
        const fgExt = foregroundName.split('.').pop() || 'png';
        const uploadedForegroundUrl = await uploadMapLayerBlob(foregroundBlob, roomCode, `map-fg-${Date.now()}.${fgExt}`);
        if (!uploadedForegroundUrl) throw new Error('전경 이미지 업로드에 실패했어요.');
        foregroundState = {
          url: uploadedForegroundUrl,
          sourceName: foregroundName,
          fit: String(room.fieldObjectFit || 'contain').trim() || 'contain',
          importedAt: Date.now(),
        };
      }

      const dominantSize = foregroundSize || backgroundSize || null;
      const sceneAspect = dominantSize?.width && dominantSize?.height
        ? (dominantSize.width / dominantSize.height)
        : 1;
      const objectBlueprints = buildImportedMapObjects(validated.parsed?.entities?.items || {}, sceneAspect);
      const importedObjects = [];
      for (let i = 0; i < objectBlueprints.length; i++) {
        const blueprint = objectBlueprints[i];
        const entry = zip.file(blueprint.imageName);
        if (!entry) continue;
        const objectBlob = await entry.async('blob');
        const objExt = blueprint.imageName.split('.').pop() || 'png';
        const objectUrl = await uploadMapLayerBlob(objectBlob, roomCode, `map-obj-${i + 1}-${Date.now()}.${objExt}`);
        if (!objectUrl) continue;
        importedObjects.push({ ...blueprint, url: objectUrl });
      }

      const nextMapState = {
        background: {
          url: uploadedUrl,
          sourceName: backgroundName,
          fit: String(room.fieldObjectFit || 'contain').trim() || 'contain',
          importedAt: Date.now(),
        },
        foreground: foregroundState,
        objects: importedObjects,
      };
      const { db, ref, update } = window._FB;
      await update(ref(db, `rooms/${roomCode}/bgm`), {
        mapBackground: nextMapState.background.url,
        mapBackgroundFit: nextMapState.background.fit,
        mapBackgroundSourceName: nextMapState.background.sourceName || '',
        mapBackgroundImportedAt: nextMapState.background.importedAt || Date.now(),
        mapForeground: nextMapState.foreground?.url || '',
        mapForegroundFit: nextMapState.foreground?.fit || '',
        mapForegroundSourceName: nextMapState.foreground?.sourceName || '',
        mapForegroundImportedAt: nextMapState.foreground?.importedAt || 0,
        mapObjects: nextMapState.objects || [],
      });
      setSummary(buildValidationSummary(pendingFile, validated.parsed) + `<br><br><b>맵 이미지 적용 완료</b><br>image item 오브젝트 ${importedObjects.length}개 반영`);
      if (typeof showToast === 'function') showToast('맵 이미지 + 오브젝트 적용 완료');
    } catch (err) {
      console.error('map background apply failed', err);
      setError(err?.message || '맵 이미지 적용 중 오류가 발생했어요.');
    } finally {
      IMPORT_STATE.isBusy = false;
    }
  }

  window.applyImportedMapState = applyImportedMapState;
  window.applyValidatedMapBackground = applyValidatedMapBackground;
  window.openMapImportModal = openMapImportModal;
  window.handleMapImportFile = handleMapImportFile;
})();
