(function () {
  const IMPORT_STATE = {
    lastValidated: null,
    pendingFile: null,
    isBusy: false,
  };

  function requireMapImportAccess() {
    if (typeof hasPerm === 'function' && hasPerm('manageMap') && hasPerm('createToken') && hasPerm('editToken')) return true;
    if (typeof showToast === 'function') showToast('맵세팅 적용 권한이 없어요. 맵 관리 + 토큰 생성/편집 권한이 필요해요.');
    return false;
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
      hint.textContent = '맵세팅용 ZIP 파일을 업로드해주세요.';
    }
    if (fileInput) fileInput.value = '';
    IMPORT_STATE.lastValidated = null;
    IMPORT_STATE.pendingFile = null;
  }

  function openMapImportModal() {
    if (!requireMapImportAccess()) return;
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
      if (item?.panelTokenId) return;
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
      el.style.transform = `rotate(${Number(item.angle || 0)}deg)`;
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

  function buildDefaultImportedMapLayerState(mapState) {
    const ids = [];
    if (mapState?.background?.url) ids.push('background');
    const objects = Array.isArray(mapState?.objects) ? mapState.objects : [];
    objects.forEach((item, index) => {
      ids.push(String(item?.layerId || `object:${item?.id || index + 1}`));
    });
    return {
      order: ids,
      visible: Object.fromEntries(ids.map((id) => [id, true])),
    };
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
      `맵 이미지: ${(room.backgroundUrl || room.foregroundUrl) ? '있음' : '없음'}`,
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


  function buildImportedPanelTokenId(roomCode, sourceItemId, index) {
    const safeRoom = String(roomCode || 'room').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'room';
    const safeSource = String(sourceItemId || index + 1).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || String(index + 1);
    return `mapimp_${safeRoom}_${safeSource}_${Date.now()}_${index + 1}`;
  }


  function parseImportedPanelClickAction(rawAction) {
    if (rawAction == null) return { panelActionType: 'none', panelActionText: '', raw: null };

    if (typeof rawAction === 'string') {
      const text = rawAction.trim();
      if (!text) return { panelActionType: 'none', panelActionText: '', raw: rawAction };
      return {
        panelActionType: text.startsWith('/') ? 'macro' : 'chat',
        panelActionText: text,
        raw: rawAction,
      };
    }

    if (typeof rawAction === 'object') {
      const type = String(rawAction.type || rawAction.actionType || '').trim().toLowerCase();
      const candidates = [rawAction.text, rawAction.message, rawAction.content, rawAction.command, rawAction.value]
        .map((value) => typeof value === 'string' ? value.trim() : '')
        .filter(Boolean);
      const text = candidates[0] || '';
      if (!text) return { panelActionType: 'none', panelActionText: '', raw: rawAction };
      if (type === 'macro' || type === 'command' || text.startsWith('/')) {
        return { panelActionType: 'macro', panelActionText: text, raw: rawAction };
      }
      if (type === 'chat' || type === 'message' || type === 'text') {
        return { panelActionType: 'chat', panelActionText: text, raw: rawAction };
      }
      return {
        panelActionType: text.startsWith('/') ? 'macro' : 'chat',
        panelActionText: text,
        raw: rawAction,
      };
    }

    return { panelActionType: 'none', panelActionText: '', raw: rawAction };
  }

  function buildImportedPanelToken(blueprint, roomCode, index) {
    const seed = blueprint?.panelTokenSeed || {};
    const importedClickAction = parseImportedPanelClickAction(seed.clickAction);
    const tokenId = buildImportedPanelTokenId(roomCode, seed.sourceItemId || blueprint?.id || '', index);
    return {
      id: tokenId,
      tokenCategory: 'panel',
      type: 'panel',
      name: String(seed.name || blueprint?.name || `오브젝트 ${index + 1}`),
      x: Number(seed.xCenterPct ?? seed.xPct ?? blueprint?.xCenterPct ?? blueprint?.xPct ?? 50),
      y: Number(seed.yCenterPct ?? seed.yPct ?? blueprint?.yCenterPct ?? blueprint?.yPct ?? 50),
      rotation: Number(seed.angle || blueprint?.angle || 0),
      memo: String(seed.memo || ''),
      panelWidth: Math.max(1, Number(seed.panelWidth || blueprint?.sourceWidth || 1) || 1),
      panelHeight: Math.max(1, Number(seed.panelHeight || blueprint?.sourceHeight || 1) || 1),
      panelPriority: Math.max(1, Number(seed.panelPriority || 1) || 1),
      panelImage: blueprint?.url || '',
      panelBackImage: blueprint?.coverUrl || '',
      panelFace: (blueprint?.coverUrl && seed?.sourceMeta?.closed === true) ? 'back' : 'front',
      panelLockPosition: !!seed.panelLockPosition,
      panelLockSize: !!seed.panelLockSize,
      panelActionType: importedClickAction.panelActionType,
      panelActionText: importedClickAction.panelActionText,
      mapLayerId: String(blueprint?.layerId || `object:${blueprint?.id || index + 1}`),
      importedMapObject: true,
      importedMapObjectMeta: {
        sourceItemId: String(seed.sourceItemId || blueprint?.id || ''),
        sourceLayerId: String(seed.sourceLayerId || blueprint?.layerId || ''),
        sourceImageName: String(seed.sourceImageName || blueprint?.imageName || ''),
        sourceCoverImageName: String(seed.sourceCoverImageName || blueprint?.coverImageName || ''),
        clickAction: importedClickAction.raw,
        visible: seed.visible !== false,
        sourceMeta: seed.sourceMeta || null,
        layoutPct: {
          x: Number(seed.xPct ?? blueprint?.xPct ?? 0),
          y: Number(seed.yPct ?? blueprint?.yPct ?? 0),
          width: Number(seed.widthPct ?? seed.wPct ?? blueprint?.wPct ?? 0),
          height: Number(seed.heightPct ?? seed.hPct ?? blueprint?.hPct ?? 0),
          xCenter: Number(seed.xCenterPct ?? blueprint?.xCenterPct ?? 0),
          yCenter: Number(seed.yCenterPct ?? blueprint?.yCenterPct ?? 0),
        },
      },
      ownerId: String(window.St?.myId || ''),
      ownerName: String(window.St?.myName || ''),
      createdBy: String(window.St?.myId || ''),
      createdByName: String(window.St?.myName || ''),
      tokenSize: 1,
    };
  }

  async function clearPreviousImportedPanelTokens(roomCode, objects) {
    const ids = Array.isArray(objects)
      ? objects.map((item) => String(item?.panelTokenId || '').trim()).filter(Boolean)
      : [];
    if (!ids.length || !window._FB?.CONFIGURED) return;
    const { db, ref, update } = window._FB;
    const payload = {};
    ids.forEach((id) => { payload[id] = null; });
    await update(ref(db, `rooms/${roomCode}/tokens`), payload);
  }

  async function saveImportedPanelTokens(roomCode, tokens) {
    if (!Array.isArray(tokens) || !tokens.length || !window._FB?.CONFIGURED) return;
    const { db, ref, update } = window._FB;
    const payload = {};
    tokens.forEach((token) => {
      if (!token?.id) return;
      payload[token.id] = token;
    });
    if (!Object.keys(payload).length) return;
    await update(ref(db, `rooms/${roomCode}/tokens`), payload);
  }

  function buildImportedMapObjects(itemsMap = {}, roomMeta = {}, sceneAspect = 1) {
    const rawItems = Object.entries(itemsMap)
      .map(([id, item]) => ({ id, ...(item || {}) }))
      .filter((item) => item.type === 'object' && item.visible !== false && String(item.imageUrl || '').trim());

    if (!rawItems.length) return [];

    const bounds = rawItems.reduce((acc, item) => {
      const x = Number(item.x || 0);
      const y = Number(item.y || 0);
      const w = Math.max(1, Number(item.width || 1));
      const h = Math.max(1, Number(item.height || 1));
      acc.left = Math.min(acc.left, x);
      acc.right = Math.max(acc.right, x + w);
      acc.top = Math.min(acc.top, y);
      acc.bottom = Math.max(acc.bottom, y + h);
      return acc;
    }, { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });

    const pad = 2;
    const roomFieldWidth = Number(roomMeta?.fieldWidth || 0);
    const roomFieldHeight = Number(roomMeta?.fieldHeight || 0);

    const rawSpanW = Math.max(1, (bounds.right - bounds.left) + pad * 2);
    const rawSpanH = Math.max(1, (bounds.bottom - bounds.top) + pad * 2);
    const spanW = roomFieldWidth > 0 ? roomFieldWidth : rawSpanW;
    const spanH = roomFieldHeight > 0 ? roomFieldHeight : rawSpanH;
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;

    const baseLeft = centerX - spanW / 2;
    const baseTop = centerY - spanH / 2;

    return rawItems
      .sort((a, b) => {
        const zDiff = Number(a.z || 0) - Number(b.z || 0);
        if (zDiff !== 0) return zDiff;
        const orderDiff = Number(a.order || 0) - Number(b.order || 0);
        if (orderDiff !== 0) return orderDiff;
        return String(a.id || '').localeCompare(String(b.id || ''));
      })
      .map((item) => {
        const x = Number(item.x || 0);
        const y = Number(item.y || 0);
        const w = Math.max(1, Number(item.width || 1));
        const h = Math.max(1, Number(item.height || 1));
        const objectId = String(item.id || '');
        const imageName = String(item.imageUrl || '').trim();
        const coverImageName = String(item.coverImageUrl || '').trim();
        const displayName = String(item.name || '').trim() || imageName || `오브젝트 ${Number(item.order || 0) || 0}`;
        const memo = String(item.memo || '');
        const angle = Number(item.angle || 0);
        const sourceZ = Number(item.z || 0);
        const sourceOrder = Number(item.order || 0);
        const xPct = ((x - baseLeft) / spanW) * 100;
        const yPct = ((y - baseTop) / spanH) * 100;
        const wPct = (w / spanW) * 100;
        const hPct = (h / spanH) * 100;
        return {
          id: objectId,
          layerId: `object:${objectId}`,
          name: displayName,
          imageName,
          coverImageName,
          memo,
          locked: item.locked === true,
          angle,
          sourceWidth: w,
          sourceHeight: h,
          sourceZ,
          sourceOrder,
          order: sourceOrder,
          xPct,
          yPct,
          wPct,
          hPct,
          xCenterPct: xPct + (wPct / 2),
          yCenterPct: yPct + (hPct / 2),
          panelTokenSeed: {
            sourceItemId: objectId,
            sourceLayerId: `object:${objectId}`,
            sourceImageName: imageName,
            sourceCoverImageName: coverImageName,
            name: displayName,
            memo,
            panelWidth: w,
            panelHeight: h,
            panelLockPosition: item.locked === true,
            panelLockSize: false,
            angle,
            visible: item.visible !== false,
            clickAction: item.clickAction || null,
            xPct,
            yPct,
            widthPct: wPct,
            heightPct: hPct,
            xCenterPct: xPct + (wPct / 2),
            yCenterPct: yPct + (hPct / 2),
            sourceMeta: {
              x,
              y,
              width: w,
              height: h,
              z: sourceZ,
              order: sourceOrder,
              locked: item.locked === true,
              closed: item.closed === true,
              freezed: item.freezed === true,
              active: item.active !== false,
              withoutOwner: item.withoutOwner === true,
            },
          },
        };
      });
  }

  async function handleMapImportFile(input) {
    if (!requireMapImportAccess()) {
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
    if (!requireMapImportAccess()) return;
    if (IMPORT_STATE.isBusy) return;
    const pendingFile = IMPORT_STATE.pendingFile;
    const validated = IMPORT_STATE.lastValidated;
    if (!pendingFile || !validated?.parsed) {
      setError('먼저 검사 완료된 맵세팅 ZIP을 선택해 주세요.');
      return;
    }
    const room = validated.parsed?.entities?.room || {};
    const mapImageName = String(room.backgroundUrl || room.foregroundUrl || '').trim();
    if (!mapImageName) {
      setError('이 맵세팅에는 맵 이미지가 없습니다.');
      return;
    }
    IMPORT_STATE.isBusy = true;
    try {
      setHint('세션 상태를 확인한 뒤 맵 이미지를 업로드하는 중이에요…');
      const { roomCode } = await ensureLiveRoomContext();
      const zip = await window.JSZip.loadAsync(pendingFile);
      const backgroundEntry = zip.file(mapImageName);
      if (!backgroundEntry) throw new Error('ZIP 안에서 맵 이미지 파일을 찾지 못했어요.');
      const blob = await backgroundEntry.async('blob');
      const backgroundSize = await getImageSizeFromBlob(blob);
      const ext = mapImageName.split('.').pop() || 'png';
      const uploadedUrl = await uploadMapLayerBlob(blob, roomCode, `map-bg-${Date.now()}.${ext}`);
      if (!uploadedUrl) throw new Error('맵 이미지 업로드에 실패했어요.');

      const dominantSize = backgroundSize || null;
      const sceneAspect = dominantSize?.width && dominantSize?.height
        ? (dominantSize.width / dominantSize.height)
        : 1;
      const objectBlueprints = buildImportedMapObjects(validated.parsed?.entities?.items || {}, room, sceneAspect);
      const importedObjects = [];
      const importedPanelTokens = [];
      for (let i = 0; i < objectBlueprints.length; i++) {
        const blueprint = objectBlueprints[i];
        const entry = zip.file(blueprint.imageName);
        if (!entry) continue;
        const objectBlob = await entry.async('blob');
        const objExt = blueprint.imageName.split('.').pop() || 'png';
        const objectUrl = await uploadMapLayerBlob(objectBlob, roomCode, `map-obj-${i + 1}-${Date.now()}.${objExt}`);
        if (!objectUrl) continue;
        let coverUrl = '';
        if (blueprint.coverImageName) {
          const coverEntry = zip.file(blueprint.coverImageName);
          if (coverEntry) {
            const coverBlob = await coverEntry.async('blob');
            const coverExt = blueprint.coverImageName.split('.').pop() || 'png';
            coverUrl = await uploadMapLayerBlob(coverBlob, roomCode, `map-obj-cover-${i + 1}-${Date.now()}.${coverExt}`) || '';
          }
        }
        const objectWithUrl = { ...blueprint, url: objectUrl, coverUrl };
        const panelToken = buildImportedPanelToken(objectWithUrl, roomCode, i);
        importedPanelTokens.push(panelToken);
        importedObjects.push({
          ...objectWithUrl,
          panelTokenId: panelToken.id,
          targetType: 'panel-token',
          previewUrl: objectUrl,
        });
      }

      await clearPreviousImportedPanelTokens(roomCode, window.St?.mapState?.objects || []);
      await saveImportedPanelTokens(roomCode, importedPanelTokens);

      const nextMapState = {
        background: {
          url: uploadedUrl,
          sourceName: mapImageName,
          fit: String(room.fieldObjectFit || 'contain').trim() || 'contain',
          importedAt: Date.now(),
        },
        foreground: null,
        objects: importedObjects,
      };
      const nextLayerState = buildDefaultImportedMapLayerState(nextMapState);
      const { db, ref, update } = window._FB;
      await update(ref(db, `rooms/${roomCode}/bgm`), {
        mapBackground: nextMapState.background.url,
        mapBackgroundFit: nextMapState.background.fit,
        mapBackgroundSourceName: nextMapState.background.sourceName || '',
        mapBackgroundImportedAt: nextMapState.background.importedAt || Date.now(),
        mapForeground: '',
        mapForegroundFit: '',
        mapForegroundSourceName: '',
        mapForegroundImportedAt: 0,
        mapObjects: nextMapState.objects || [],
        mapLayerState: nextLayerState,
      });
      if (window.St) window.St.mapLayerState = nextLayerState;
      setSummary(buildValidationSummary(pendingFile, validated.parsed) + `<br><br><b>맵 이미지 적용 완료</b><br>스크린 패널 ${importedPanelTokens.length}개 생성 / 레이어 항목 유지`);
      if (typeof showToast === 'function') showToast('맵 이미지 + 스크린 패널 적용 완료');
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
