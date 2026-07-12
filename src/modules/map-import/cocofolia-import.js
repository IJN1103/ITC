(function () {
  const IMPORT_STATE = {
    lastValidated: null,
    pendingFile: null,
    isBusy: false,
    lastDiagnostics: null,
  };

  function canManageMapImport() {
    if (typeof hasPerm === 'function') return !!hasPerm('manageMap');
    return !!window.St?.isGM;
  }

  function requireMapImportPermission() {
    if (canManageMapImport()) return true;
    if (typeof showToast === 'function') showToast('맵 관리 권한이 없어요.');
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
    IMPORT_STATE.lastDiagnostics = null;
  }

  function openMapImportModal() {
    if (!requireMapImportPermission()) return;
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

  function getMapDisplayImageUrl(src, max = 2048) {
    const raw = String(src || '').trim();
    if (!raw) return '';
    if (typeof _itcGetMapDisplayImageSrc === 'function') return _itcGetMapDisplayImageSrc(raw, max);
    return raw;
  }

  function cssImageUrl(src) {
    return String(src || '').replace(/"/g, '%22');
  }

  function buildCssBackgroundImage(src) {
    const raw = String(src || '').trim();
    return raw ? `url("${cssImageUrl(raw)}")` : '';
  }

  function setLazyMapLayerBackground(el, src, max = 1600, shouldLoadNow = true) {
    if (!el) return;
    const displaySrc = getMapDisplayImageUrl(src, max);
    if (!displaySrc) {
      delete el.dataset.itcMapLazyBgSrc;
      el.style.backgroundImage = '';
      return;
    }
    const next = String(displaySrc || '').trim();
    el.dataset.itcMapLazyBgSrc = next;
    if (shouldLoadNow && !el.classList.contains('map-layer-runtime-hidden')) {
      el.style.backgroundImage = buildCssBackgroundImage(next);
    } else {
      el.style.backgroundImage = '';
    }
  }

  function ensureLazyMapLayerElementImage(el) {
    if (!el) return;
    const lazyBg = String(el.dataset?.itcMapLazyBgSrc || '').trim();
    if (lazyBg && !el.style.backgroundImage) {
      el.style.backgroundImage = buildCssBackgroundImage(lazyBg);
    }
    const imgs = el.matches?.('img[data-itc-map-lazy-src]')
      ? [el]
      : Array.from(el.querySelectorAll?.('img[data-itc-map-lazy-src]') || []);
    imgs.forEach((img) => {
      const src = String(img.dataset.itcMapLazySrc || '').trim();
      if (!src || img.getAttribute('src') === src) return;
      img.src = src;
    });
  }

  function clearLazyMapLayerElementImage(el) {
    if (!el) return;
    const lazyBg = String(el.dataset?.itcMapLazyBgSrc || '').trim();
    if (lazyBg && el.style.backgroundImage) {
      el.style.backgroundImage = '';
    }
  }

  function isMapLayerVisible(layerId) {
    const visible = window.St?.mapLayerState?.visible;
    if (!visible || typeof visible !== 'object') return true;
    return visible[String(layerId || '')] !== false;
  }

  function applyMapLayerElementVisibility(el, visible) {
    if (!el) return;
    if (visible) {
      el.classList.remove('map-layer-runtime-hidden');
      el.style.display = '';
      el.style.visibility = '';
      el.style.opacity = '';
      ensureLazyMapLayerElementImage(el);
    } else {
      el.style.display = 'none';
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
      el.classList.add('map-layer-runtime-hidden');
      clearLazyMapLayerElementImage(el);
    }
  }

  function clearImportedMapObjects() {
    document.querySelectorAll('.map-import-object[data-map-layer-id]').forEach((el) => el.remove());
  }

  function applyImportedMapState(mapState) {
    const bgLayer = getMapBackgroundLayer();
    const blurLayer = document.getElementById('map-bg-blur-layer');
    const fgLayer = getMapForegroundLayer();
    const mapInner = getMapInner();
    const background = mapState?.background || null;
    const foreground = mapState?.foreground || null;
    const objects = Array.isArray(mapState?.objects) ? mapState.objects : [];
    if (bgLayer) {
      if (!background?.url) {
        setLazyMapLayerBackground(bgLayer, '');
        bgLayer.style.backgroundSize = 'contain';
        if (blurLayer) { blurLayer.style.backgroundImage = ''; blurLayer.style.display = 'none'; }
      } else {
        const fit = String(background.fit || 'contain').trim() || 'contain';
        const bgVisible = isMapLayerVisible('background');
        setLazyMapLayerBackground(bgLayer, background.url, 2048, bgVisible);
        bgLayer.style.backgroundSize = fit === 'fill' ? '100% 100%' : (fit === 'cover' ? 'cover' : 'contain');
        bgLayer.style.backgroundPosition = 'center center';
        // 블러 배경: map-area 전체를 cover로 채워 줌아웃 시 흰 배경 노출 방지
        // fit에 관계없이 항상 표시 (블러 레이어는 map-inner 밖, map-area 직속이므로
        // 줌/팬으로 map-inner가 축소돼도 항상 화면 전체를 덮음)
        if (blurLayer) {
          // background.blur === false이면 블러 레이어 끄기
          const blurEnabled = background.blur !== false;
          const blurSrc = buildCssBackgroundImage(getMapDisplayImageUrl(background.url, 2048));
          blurLayer.style.backgroundImage = blurSrc;
          blurLayer.style.display = (bgVisible && blurEnabled) ? '' : 'none';
          blurLayer.classList.toggle('map-layer-runtime-hidden', !(bgVisible && blurEnabled));
        }
      }
      const bgFinalVisible = !!background?.url && isMapLayerVisible('background');
      applyMapLayerElementVisibility(bgLayer, bgFinalVisible);
      // 블러 레이어도 배경 가시성에 연동
      if (blurLayer) {
        blurLayer.style.display = bgFinalVisible ? '' : 'none';
        blurLayer.classList.toggle('map-layer-runtime-hidden', !bgFinalVisible);
      }
    }
    if (fgLayer) {
      if (!foreground?.url) {
        setLazyMapLayerBackground(fgLayer, '');
        fgLayer.style.backgroundSize = 'contain';
        fgLayer.style.backgroundPosition = 'center center';
      } else {
        const fit = String(foreground.fit || 'contain').trim() || 'contain';
        // FG는 Cloudinary 리사이즈 변환 없이 원본 URL 직접 사용
        // (c_limit 등 크기 변환이 적용되면 cover 정렬이 어긋남)
        const fgUrl = foreground.url;
        if (fgLayer.dataset.itcMapLazyBgSrc !== fgUrl || !fgLayer.style.backgroundImage) {
          fgLayer.dataset.itcMapLazyBgSrc = fgUrl;
          fgLayer.style.backgroundImage = buildCssBackgroundImage(fgUrl);
        }
        fgLayer.style.backgroundSize = fit === 'fill' ? '100% 100%' : (fit === 'cover' ? 'cover' : 'contain');
        fgLayer.style.backgroundPosition = 'center center';
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
      const layerVisible = isMapLayerVisible(layerId);
      setLazyMapLayerBackground(el, item.url, 1600, layerVisible);
      el.style.transform = `rotate(${Number(item.angle || 0)}deg)`;
      applyMapLayerElementVisibility(el, layerVisible);
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
      timeout: 90000,
      retries: 2,
      retryDelay: 1600,
    });
    return result?.url || '';
  }


  async function runWithConcurrency(items, limit, worker, onProgress) {
    const source = Array.isArray(items) ? items : [];
    if (source.length === 0) return [];
    const concurrency = Math.max(1, Math.min(Number(limit) || 1, source.length));
    const results = new Array(source.length);
    let nextIndex = 0;
    let completed = 0;

    async function consume() {
      while (true) {
        const index = nextIndex++;
        if (index >= source.length) return;
        results[index] = await worker(source[index], index);
        completed += 1;
        if (typeof onProgress === 'function') onProgress(completed, source.length);
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => consume()));
    return results;
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
    const importPanel = document.getElementById('ms-import-panel');
    if (importPanel) importPanel.style.display = '';
    const { error, hint } = getModalElements();
    if (error) {
      error.style.display = '';
      error.textContent = message;
    }
    if (hint) hint.style.display = 'none';
  }

  function setSummary(html) {
    // 인라인 패널 표시 (파일 선택 후 결과 표시 시)
    const importPanel = document.getElementById('ms-import-panel');
    if (importPanel) importPanel.style.display = '';
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
    const itemCount = Object.keys(items).length;
    const resourceCount = Object.keys(resources).length;
    const lines = [
      `<b>검사 완료</b>`,
      `파일명: ${escapeHtml(file.name)}`,
      `버전: ${escapeHtml(version)}`,
      `배경 이미지: ${room.backgroundUrl ? '있음' : '없음'} / 포그라운드: ${room.foregroundUrl ? '있음' : '없음'}`,
      `렌더 방식: ${room.fieldObjectFit || 'contain'} / 그리드 정렬: ${room.alignWithGrid ? '켜짐' : '꺼짐'}`,
      `오브젝트: ${Object.keys(items || {}).length}개 / 마커 패널: ${Object.keys(room?.markers || {}).length}개`,
      Object.keys(parsed?.entities?.effects || {}).length > 0
        ? `컷인: ${Object.keys(parsed?.entities?.effects || {}).length}개 (자동 임포트)` : null,
      `item 수: ${itemCount}개`,
      `리소스 수: ${resourceCount}개`,
      `그리드: ${gridLabel} / 크기 ${Number(room.gridSize || 0) || 0}`,
      `배경 + 전경 + image item 오브젝트 일부를 실제 맵에 적용할 수 있습니다.`,
    ];
    if (itemCount >= 80 || resourceCount >= 120) {
      lines.push(`<span style="color:#e6c58a">주의: 오브젝트/리소스 수가 많은 ZIP입니다. 적용 직후 몇 초간 업로드와 렌더링이 무거울 수 있어요.</span>`);
    }
    return lines.filter(Boolean).join('<br>') + buildApplyActions();
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

  function normalizeCocofoliaZipPath(value) {
    return decodeURIComponent(String(value || '').trim())
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\//, '')
      .toLowerCase();
  }

  function collectCocofoliaReferencedImages(parsed) {
    const room = parsed?.entities?.room || {};
    const items = parsed?.entities?.items || {};
    const effects = parsed?.entities?.effects || {};
    const refs = [];
    const pushRef = (kind, ownerId, value) => {
      const raw = String(value || '').trim();
      if (!raw) return;
      refs.push({ kind, ownerId: String(ownerId || ''), raw, normalized: normalizeCocofoliaZipPath(raw) });
    };

    pushRef('background', 'room', room.backgroundUrl);
    pushRef('foreground', 'room', room.foregroundUrl);
    Object.entries(items).forEach(([id, item]) => {
      pushRef('item', id, item?.imageUrl);
      pushRef('item-cover', id, item?.coverImageUrl);
    });
    Object.entries(room?.markers || {}).forEach(([id, marker]) => {
      pushRef('marker', id, marker?.imageUrl);
      pushRef('marker-cover', id, marker?.coverImageUrl);
    });
    Object.entries(effects).forEach(([id, effect]) => {
      pushRef('effect', id, effect?.imageUrl);
      pushRef('effect-sound', id, effect?.soundRef);
    });
    return refs;
  }

  function isLikelyImageZipEntry(name) {
    return /\.(png|jpe?g|webp|gif|svg)$/i.test(String(name || ''));
  }

  function buildCocofoliaDiagnostics(zip, parsed) {
    const room = parsed?.entities?.room || {};
    const items = parsed?.entities?.items || {};
    const markers = room?.markers || {};
    const zipFiles = Object.values(zip?.files || {}).filter((entry) => entry && !entry.dir);
    const zipPathMap = new Map();
    zipFiles.forEach((entry) => {
      const normalized = normalizeCocofoliaZipPath(entry.name);
      if (normalized && !zipPathMap.has(normalized)) zipPathMap.set(normalized, entry.name);
      const basename = normalized.split('/').pop();
      if (basename && !zipPathMap.has(basename)) zipPathMap.set(basename, entry.name);
    });

    const refs = collectCocofoliaReferencedImages(parsed);
    const matched = [];
    const missing = [];
    refs.forEach((refInfo) => {
      const basename = refInfo.normalized.split('/').pop();
      const actual = zipPathMap.get(refInfo.normalized) || zipPathMap.get(basename) || '';
      (actual ? matched : missing).push({ ...refInfo, actual });
    });

    const supportedTypes = new Set(['object', 'plane']);
    const typedItems = Object.entries(items).map(([id, item]) => ({ id, ...(item || {}) }));
    const supportedItems = typedItems.filter((item) => supportedTypes.has(String(item.type || '')) && String(item.imageUrl || '').trim());
    const unsupportedItems = typedItems.filter((item) => String(item.imageUrl || '').trim() && !supportedTypes.has(String(item.type || '')));
    const inactiveItems = [...supportedItems, ...Object.entries(markers).map(([id, marker]) => ({ id: `marker_${id}`, ...(marker || {}) }))]
      .filter((item) => item.visible === false || item.active === false);
    const negativeZItems = supportedItems.filter((item) => Number(item.z || 0) < 0);

    const fieldWidth = Number(room.fieldWidth || 0);
    const fieldHeight = Number(room.fieldHeight || 0);
    const fieldLeft = fieldWidth > 0 ? -fieldWidth / 2 : null;
    const fieldTop = fieldHeight > 0 ? -fieldHeight / 2 : null;
    const fieldRight = fieldWidth > 0 ? fieldWidth / 2 : null;
    const fieldBottom = fieldHeight > 0 ? fieldHeight / 2 : null;
    const outOfFieldItems = supportedItems.filter((item) => {
      if (!(fieldWidth > 0 && fieldHeight > 0)) return false;
      const x = Number(item.x || 0);
      const y = Number(item.y || 0);
      const w = Math.max(1, Number(item.width || 1));
      const h = Math.max(1, Number(item.height || 1));
      return x < fieldLeft || y < fieldTop || (x + w) > fieldRight || (y + h) > fieldBottom;
    });

    const typeCounts = {};
    typedItems.forEach((item) => {
      const type = String(item.type || 'unknown') || 'unknown';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    return {
      zipFileCount: zipFiles.length,
      zipImageCount: zipFiles.filter((entry) => isLikelyImageZipEntry(entry.name)).length,
      referenceCount: refs.length,
      matchedReferenceCount: matched.length,
      missingReferenceCount: missing.length,
      supportedObjectCount: supportedItems.length + Object.keys(markers).length,
      unsupportedObjectCount: unsupportedItems.length,
      inactiveObjectCount: inactiveItems.length,
      negativeZObjectCount: negativeZItems.length,
      outOfFieldObjectCount: outOfFieldItems.length,
      fieldWidth,
      fieldHeight,
      typeCounts,
      matched,
      missing,
      unsupportedItems: unsupportedItems.map((item) => ({ id: item.id, type: item.type, imageUrl: item.imageUrl || '' })),
      inactiveItems: inactiveItems.map((item) => ({ id: item.id, type: item.type || 'marker', active: item.active, visible: item.visible })),
      negativeZItems: negativeZItems.map((item) => ({ id: item.id, name: item.name || '', z: Number(item.z || 0), imageUrl: item.imageUrl || '' })),
      outOfFieldItems: outOfFieldItems.map((item) => ({ id: item.id, name: item.name || '', x: item.x, y: item.y, width: item.width, height: item.height, z: item.z || 0 })),
    };
  }

  function logCocofoliaDiagnostics(diagnostics, fileName) {
    if (!diagnostics) return;
    const label = `[ITC 맵세팅 진단] ${fileName || ''}`;
    console.groupCollapsed(label);
    console.info('요약', {
      zipFiles: diagnostics.zipFileCount,
      zipImages: diagnostics.zipImageCount,
      references: diagnostics.referenceCount,
      matchedReferences: diagnostics.matchedReferenceCount,
      missingReferences: diagnostics.missingReferenceCount,
      supportedObjects: diagnostics.supportedObjectCount,
      unsupportedObjects: diagnostics.unsupportedObjectCount,
      inactiveObjects: diagnostics.inactiveObjectCount,
      negativeZObjects: diagnostics.negativeZObjectCount,
      outOfFieldObjects: diagnostics.outOfFieldObjectCount,
      field: `${diagnostics.fieldWidth || '?'} × ${diagnostics.fieldHeight || '?'}`,
      itemTypes: diagnostics.typeCounts,
    });
    if (diagnostics.missing.length) console.table(diagnostics.missing);
    if (diagnostics.unsupportedItems.length) console.table(diagnostics.unsupportedItems);
    if (diagnostics.inactiveItems.length) console.table(diagnostics.inactiveItems);
    if (diagnostics.negativeZItems.length) console.table(diagnostics.negativeZItems);
    if (diagnostics.outOfFieldItems.length) console.table(diagnostics.outOfFieldItems);
    console.groupEnd();
  }

  function buildDiagnosticsSummary(diagnostics) {
    if (!diagnostics) return '';
    const status = diagnostics.missingReferenceCount > 0 || diagnostics.unsupportedObjectCount > 0
      ? '<span style="color:#e6c58a">추가 확인 필요</span>'
      : '<span style="color:#9fd6a3">기본 파일 연결 정상</span>';
    const lines = [
      `<hr style="border:0;border-top:1px solid rgba(255,255,255,.15);margin:10px 0">`,
      `<b>호환 진단: ${status}</b>`,
      `ZIP 이미지: ${diagnostics.zipImageCount}개 / 데이터 참조: ${diagnostics.referenceCount}개`,
      `파일 연결: ${diagnostics.matchedReferenceCount}개 성공 / ${diagnostics.missingReferenceCount}개 누락`,
      `지원 오브젝트: ${diagnostics.supportedObjectCount}개 / 미지원 타입: ${diagnostics.unsupportedObjectCount}개`,
      `필드 밖 배치: ${diagnostics.outOfFieldObjectCount}개 / 음수 레이어: ${diagnostics.negativeZObjectCount}개 / 비활성: ${diagnostics.inactiveObjectCount}개`,
    ];
    if (diagnostics.missingReferenceCount > 0) {
      const names = diagnostics.missing.slice(0, 4).map((item) => escapeHtml(item.raw)).join(', ');
      lines.push(`<span style="color:#f0a5a5">누락 파일: ${names}${diagnostics.missing.length > 4 ? ' 외' : ''}</span>`);
    }
    if (diagnostics.unsupportedObjectCount > 0) {
      const types = [...new Set(diagnostics.unsupportedItems.map((item) => String(item.type || 'unknown')))].join(', ');
      lines.push(`<span style="color:#e6c58a">현재 미지원 타입: ${escapeHtml(types)}</span>`);
    }
    lines.push(`<span style="opacity:.72">상세 내용은 개발자 콘솔의 ‘ITC 맵세팅 진단’에서 확인할 수 있습니다.</span>`);
    return lines.join('<br>');
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
      // 코코폴리아 active:false = 비활성(숨김) 상태로 임포트. visible:true여도 active가 false면 처음에 숨긴다.
      importedMapObjectHidden: seed?.sourceMeta?.active === false,
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
          sourceWidth: Number(seed.panelWidth ?? blueprint?.sourceWidth ?? 0),
          sourceHeight: Number(seed.panelHeight ?? blueprint?.sourceHeight ?? 0),
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
    // ── items: type=object인 일반 맵 레이어 오브젝트 ──
    const rawItems = Object.entries(itemsMap)
      .map(([id, item]) => ({ id, ...(item || {}), _markerPanel: false }))
      .filter((item) => (item.type === 'object' || item.type === 'plane') && item.visible !== false && String(item.imageUrl || '').trim());

    // ── markers: 코코폴리아 '마커 패널' → 이미지가 있으면 스크린 패널로 변환 ──
    // markers는 items와 별도 키(room.markers)에 저장되며 type 필드가 없음
    const markerItems = Object.entries(roomMeta?.markers || {})
      .map(([id, marker]) => ({
        id: `marker_${id}`,
        ...(marker || {}),
        type: 'object',         // items와 동일하게 취급
        _markerPanel: true,     // 마커 출처 표시
        _markerText: String(marker?.text || ''),
        _clickAction: marker?.clickAction || null,
      }))
      .filter((item) => String(item.imageUrl || '').trim());

    const allRawItems = [...rawItems, ...markerItems];
    if (!allRawItems.length) return [];

    const bounds = allRawItems.reduce((acc, item) => {
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

    // 코코포리아의 필드 좌표 원점은 필드 중앙이다.
    // fieldWidth/fieldHeight가 있는 경우 오브젝트 전체 bounds를 기준으로 재중앙화하면
    // 큰 장식 패널 하나 때문에 모든 레이어의 Y 위치가 밀리므로 필드 원점을 그대로 사용한다.
    const baseLeft = roomFieldWidth > 0 ? -(roomFieldWidth / 2) : (centerX - spanW / 2);
    const baseTop = roomFieldHeight > 0 ? -(roomFieldHeight / 2) : (centerY - spanH / 2);

    return allRawItems
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
          isMarkerPanel: item._markerPanel === true,
          markerText: item._markerText || '',
          markerClickAction: item._clickAction || null,
          panelTokenSeed: {
            sourceItemId: objectId,
            sourceLayerId: `object:${objectId}`,
            sourceImageName: imageName,
            sourceCoverImageName: coverImageName,
            name: displayName,
            memo: item._markerPanel ? (item._markerText || memo) : memo,
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

  // 단일 이미지(PNG/JPG)인지 판별
  function isImageFile(file) {
    return /\.(png|jpe?g|webp|gif)$/i.test(file.name) || String(file.type).startsWith('image/');
  }

  async function handleMapImportFile(input) {
    if (!requireMapImportPermission()) {
      if (input) input.value = '';
      return;
    }
    const file = input?.files?.[0];
    if (!file) return;
    if (IMPORT_STATE.isBusy) return;
    IMPORT_STATE.isBusy = true;
    const { hint } = getModalElements();
    try {
      if (isImageFile(file)) {
        // 단일 이미지: 검사 없이 바로 적용 준비
        if (hint) { hint.style.display = ''; hint.textContent = '이미지 파일을 확인하는 중이에요…'; }
        // 이미지 크기 확인
        const imgSize = await getImageSizeFromBlob(file);
        const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
        const imgW = imgSize?.width || 1920;
        const imgH = imgSize?.height || 1080;
        // 비율에 따라 fit 자동 결정: 가로세로 비율 1.6 이상(가로가 긴 이미지)은 fill,
        // 정사각형이나 세로가 긴 이미지는 contain으로 원본 비율 보존
        const imgRatio = imgW / imgH;
        const fit = imgRatio >= 1.6 ? 'fill' : 'contain';
        const fitLabel = fit === 'fill' ? 'fill (화면 채움)' : 'contain (비율 유지)';
        // 단일 이미지용 minimal parsed 구조 생성
        const pseudoParsed = {
          _isSingleImage: true,
          _imageFile: file,
          _imageExt: ext,
          _imageFit: fit,
          entities: {
            room: { backgroundUrl: '__single_image__', foregroundUrl: null, fieldObjectFit: fit, fieldWidth: imgW, fieldHeight: imgH, alignWithGrid: false, markers: {} },
            items: {},
          },
        };
        IMPORT_STATE.lastValidated = { fileName: file.name, parsed: pseudoParsed };
        IMPORT_STATE.pendingFile = file;
        const fitStr = `${imgW}×${imgH} px`;
        setSummary(`<b>단일 이미지 업로드</b><br>파일: ${file.name}<br>크기: ${fitStr}<br>렌더 방식: ${fitLabel}` + buildApplyActions());
        if (typeof showToast === 'function') showToast('이미지 파일 확인 완료');
      } else if (/\.zip$/i.test(file.name)) {
        if (hint) { hint.style.display = ''; hint.textContent = '맵세팅 ZIP을 검사하는 중이에요…'; }
        const parsed = await parseCocofoliaZip(file);
        const zip = await window.JSZip.loadAsync(file);
        const diagnostics = buildCocofoliaDiagnostics(zip, parsed);
        IMPORT_STATE.lastValidated = { fileName: file.name, parsed, diagnostics };
        IMPORT_STATE.lastDiagnostics = diagnostics;
        IMPORT_STATE.pendingFile = file;
        logCocofoliaDiagnostics(diagnostics, file.name);
        setSummary(buildValidationSummary(file, parsed) + buildDiagnosticsSummary(diagnostics));
        if (typeof showToast === 'function') showToast('맵세팅 ZIP 검사 완료');
      } else {
        throw new Error('ZIP 또는 이미지 파일(PNG/JPG)만 업로드할 수 있어요.');
      }
    } catch (err) {
      console.error('map import validation failed', err);
      IMPORT_STATE.lastValidated = null;
      IMPORT_STATE.pendingFile = null;
      setError(err?.message || '파일 검사 중 오류가 발생했어요.');
    } finally {
      IMPORT_STATE.isBusy = false;
      if (input) input.value = '';
    }
  }

  async function applyValidatedMapBackground() {
    if (!requireMapImportPermission()) return;
    if (IMPORT_STATE.isBusy) return;
    const pendingFile = IMPORT_STATE.pendingFile;
    const validated = IMPORT_STATE.lastValidated;
    if (!pendingFile || !validated?.parsed) {
      setError('먼저 검사 완료된 맵세팅 파일을 선택해 주세요.');
      return;
    }

    // ── 단일 이미지 업로드 경로 ──
    if (validated.parsed._isSingleImage) {
      IMPORT_STATE.isBusy = true;
      try {
        setHint('이미지를 업로드하는 중이에요…');
        const { roomCode } = await ensureLiveRoomContext();
        const ext = validated.parsed._imageExt || 'png';
        const fit = validated.parsed._imageFit || 'contain';
        // File은 Blob의 서브클래스 — 이중 래핑하지 않고 그대로 전달
        const uploadedUrl = await uploadMapLayerBlob(pendingFile, roomCode, `map-bg-${Date.now()}.${ext}`);
        if (!uploadedUrl) throw new Error('이미지 업로드에 실패했어요.');
        const nextMapState = {
          background: { url: uploadedUrl, sourceName: pendingFile.name, fit, importedAt: Date.now() },
          foreground: null,
          objects: [],
        };
        await clearPreviousImportedPanelTokens(roomCode, window.St?.mapState?.objects || []);
        const nextLayerState = buildDefaultImportedMapLayerState(nextMapState);
        if (window._FB?.CONFIGURED) {
          const { db, ref, update } = window._FB;
          await update(ref(db, `rooms/${roomCode}`), {
            mapState: nextMapState,
            mapLayerState: nextLayerState,
            'bgm/mapBackground': uploadedUrl,
            'bgm/mapBackgroundFit': fit,
            'bgm/mapBackgroundSourceName': pendingFile.name,
            'bgm/mapBackgroundImportedAt': Date.now(),
            'bgm/mapForeground': '',
            'bgm/mapForegroundFit': '',
            'bgm/mapForegroundSourceName': '',
            'bgm/mapForegroundImportedAt': 0,
            'bgm/mapObjects': [],
            'bgm/mapLayerState': nextLayerState,
          });
        }
        if (window.St) { window.St.mapState = nextMapState; window.St.mapLayerState = nextLayerState; }
        if (typeof window._itcApplyRoomMapStateLocal === 'function') {
          window._itcApplyRoomMapStateLocal(nextMapState, nextLayerState, 'map-import-single-image');
        } else {
          applyImportedMapState(nextMapState);
          if (typeof refreshMapLayerManager === 'function') refreshMapLayerManager();
        }
        if (typeof showToast === 'function') showToast('맵 이미지가 적용됐어요.');
        IMPORT_STATE.pendingFile = null;
        IMPORT_STATE.lastValidated = null;
        if (typeof window.hideMapImportPanel === 'function') window.hideMapImportPanel();
      } catch (err) {
        setError(err?.message || '이미지 업로드 중 오류가 발생했어요.');
        console.error('single image apply failed', err);
      } finally {
        IMPORT_STATE.isBusy = false;
      }
      return;
    }

    // ── ZIP 업로드 경로 (기존) ──
    const room = validated.parsed?.entities?.room || {};
    const bgImageName = String(room.backgroundUrl || '').trim();
    const fgImageName = String(room.foregroundUrl || '').trim();
    const mapImageName = bgImageName || fgImageName;
    if (!mapImageName) {
      setError('이 맵세팅에는 맵 이미지가 없습니다.');
      return;
    }
    IMPORT_STATE.isBusy = true;
    try {
      setHint('세션 상태를 확인한 뒤 맵 이미지를 업로드하는 중이에요…');
      const { roomCode } = await ensureLiveRoomContext();
      const zip = await window.JSZip.loadAsync(pendingFile);

      // ── 배경 이미지 업로드 ──
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

      // ── 포그라운드 + 오브젝트 제한형 병렬 업로드 (최대 3개) ──
      const objectBlueprints = buildImportedMapObjects(validated.parsed?.entities?.items || {}, room, sceneAspect);
      const uploadTasks = [];

      if (fgImageName && fgImageName !== mapImageName) {
        uploadTasks.push({ type: 'foreground', imageName: fgImageName });
      }
      objectBlueprints.forEach((blueprint, index) => {
        uploadTasks.push({ type: 'object', blueprint, index });
      });

      const uploadResults = await runWithConcurrency(
        uploadTasks,
        3,
        async (task) => {
          if (task.type === 'foreground') {
            const fgEntry = zip.file(task.imageName);
            if (!fgEntry) return { type: 'foreground', url: '' };
            const fgBlob = await fgEntry.async('blob');
            const fgExt = task.imageName.split('.').pop() || 'png';
            const url = await uploadMapLayerBlob(fgBlob, roomCode, `map-fg-${Date.now()}.${fgExt}`) || '';
            return { type: 'foreground', url };
          }

          const { blueprint, index } = task;
          const entry = zip.file(blueprint.imageName);
          if (!entry) return { type: 'object', index, value: null };
          const objectBlob = await entry.async('blob');
          const rawExt = String(blueprint.imageName.split('.').pop() || 'png').toLowerCase();
          const objExt = rawExt === 'svg' ? 'svg' : rawExt === 'jpeg' || rawExt === 'jpg' ? 'jpg' : 'png';
          const mimeMap = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
          const mimeType = mimeMap[rawExt] || 'image/png';
          const uploadBlob = new Blob([objectBlob], { type: mimeType });
          const objectUrl = await uploadMapLayerBlob(uploadBlob, roomCode, `map-obj-${index + 1}-${Date.now()}.${objExt}`);
          if (!objectUrl) return { type: 'object', index, value: null };

          let coverUrl = '';
          if (blueprint.coverImageName) {
            const coverEntry = zip.file(blueprint.coverImageName);
            if (coverEntry) {
              const coverBlob = await coverEntry.async('blob');
              const coverExt = blueprint.coverImageName.split('.').pop() || 'png';
              coverUrl = await uploadMapLayerBlob(coverBlob, roomCode, `map-obj-cover-${index + 1}-${Date.now()}.${coverExt}`) || '';
            }
          }

          const objectWithUrl = { ...blueprint, url: objectUrl, coverUrl };
          const panelToken = buildImportedPanelToken(objectWithUrl, roomCode, index);
          return {
            type: 'object',
            index,
            value: {
              panelToken,
              importedObject: {
                ...objectWithUrl,
                panelTokenId: panelToken.id,
                targetType: 'panel-token',
                previewUrl: objectUrl,
              },
            },
          };
        },
        (completed, total) => {
          setHint(`포그라운드와 맵세팅 오브젝트를 업로드하는 중이에요… (${completed}/${total})`);
        }
      );

      let uploadedFgUrl = null;
      const orderedObjectResults = new Array(objectBlueprints.length);
      uploadResults.forEach((result) => {
        if (result?.type === 'foreground') uploadedFgUrl = result.url || null;
        if (result?.type === 'object' && Number.isInteger(result.index)) {
          orderedObjectResults[result.index] = result.value || null;
        }
      });

      const importedObjects = [];
      const importedPanelTokens = [];
      orderedObjectResults.forEach((result) => {
        if (!result) return;
        importedPanelTokens.push(result.panelToken);
        importedObjects.push(result.importedObject);
      });

      await clearPreviousImportedPanelTokens(roomCode, window.St?.mapState?.objects || []);
      await saveImportedPanelTokens(roomCode, importedPanelTokens);

      // ── effects(컷인) 처리 ──
      // 코코폴리아 effects → 웹사이트 컷인 목록으로 자동 임포트
      const rawEffects = validated.parsed?.entities?.effects || {};
      const effectEntries = Object.entries(rawEffects)
        .filter(([, e]) => e?.imageUrl && String(e.imageUrl).trim())
        .sort((a, b) => (a[1].order || 0) - (b[1].order || 0));

      if (effectEntries.length > 0) {
        setHint(`컷인 이미지 ${effectEntries.length}개를 업로드하는 중이에요…`);
        const importedCutins = {};

        for (const [effId, eff] of effectEntries) {
          try {
            setHint(`컷인 이미지를 업로드하는 중이에요… (${Object.keys(importedCutins).length + 1}/${effectEntries.length})`);
            const effEntry = zip.file(eff.imageUrl);
            if (!effEntry) continue;
            const effBlob = await effEntry.async('blob');
            const rawExt = String(eff.imageUrl.split('.').pop() || 'png').toLowerCase();
            // Blob은 이미 Blob이므로 이중 래핑 없이 그대로 사용
            const effUrl = await uploadMapLayerBlob(effBlob, roomCode, `cutin-${effId.slice(0, 8)}-${Date.now()}.${rawExt}`);
            if (!effUrl) continue;

            // 트리거: name에서 '＞ ' 접두사 제거한 전체 문자열을 트리거로 사용
            // (last_word만 사용하면 "보통 성공"/"어려운 성공" 등이 모두 "성공"으로 충돌)
            const rawName = String(eff.name || '').replace(/^[\uFF1E>\s]+/, '').trim();
            const trigger = rawName; // 전체 이름을 트리거로 사용

            // 사운드: soundRef가 있으면 ZIP에서 업로드 (없으면 빈 문자열)
            let soundUrl = '';
            if (eff.soundRef && zip.file(eff.soundRef)) {
              try {
                const sndBlob = await zip.file(eff.soundRef).async('blob');
                const sndExt = String(eff.soundRef.split('.').pop() || 'mp3').toLowerCase();
                soundUrl = await uploadMapLayerBlob(sndBlob, roomCode, `cutin-snd-${effId.slice(0,8)}-${Date.now()}.${sndExt}`) || '';
              } catch(e) {}
            }

            importedCutins[effId] = {
              name: rawName,        // 표시용 이름 (원본에서 접두사 제거)
              trigger,              // 채팅 트리거 (rawName 전체)
              imageUrl: effUrl,
              soundUrl,
              volume: 0.8,
              duration: 3,
              importedFrom: 'cocofolia',
              createdAt: Date.now(),
            };
          } catch(e) {
            console.warn(`[cutin] effect ${effId} 처리 실패`, e);
          }
        }

        // Firebase cutins에 저장
        // update로 각 항목을 경로별로 저장 (기존 수동 컷인 유지, cocofolia 것만 교체)
        if (Object.keys(importedCutins).length > 0 && window._FB?.CONFIGURED) {
          const { db, ref: fbRef, update: fbUpdate, get: fbGet } = window._FB;
          try {
            // 기존 컷인 읽기 → importedFrom=cocofolia인 것 삭제 후 새 것 추가
            const cutinsRef = fbRef(db, `rooms/${roomCode}/cutins`);
            const snap = await fbGet(cutinsRef);
            const existingCutins = snap.val() || {};
            // update payload: 기존 cocofolia 항목은 null(삭제), 새 항목은 값 설정
            const updatePayload = {};
            Object.entries(existingCutins).forEach(([k, v]) => {
              if (v?.importedFrom === 'cocofolia') updatePayload[`rooms/${roomCode}/cutins/${k}`] = null;
            });
            Object.entries(importedCutins).forEach(([k, v]) => {
              updatePayload[`rooms/${roomCode}/cutins/${k}`] = v;
            });
            const { ref: rootRef } = window._FB;
            await fbUpdate(rootRef(db), updatePayload);
            if (typeof window._subscribeCutins === 'function') window._subscribeCutins(roomCode);
          } catch(e) {
            console.warn('[cutin] Firebase 저장 실패', e);
          }
        }
      }

      const fit = String(room.fieldObjectFit || 'contain').trim() || 'contain';
      const alignWithGrid = !!room.alignWithGrid;
      const nextMapState = {
        // 코코포리아 필드는 배경 원본 비율을 논리 캔버스 비율로 사용한다.
        // 고정 16:9 캔버스에 강제로 맞출 때 발생하던 세로 눌림을 방지한다.
        importedCanvasAspect: Number.isFinite(sceneAspect) && sceneAspect > 0 ? sceneAspect : null,
        importedFieldWidth: Number(room.fieldWidth || 0) || null,
        importedFieldHeight: Number(room.fieldHeight || 0) || null,
        background: {
          url: uploadedUrl,
          sourceName: mapImageName,
          fit,
          alignWithGrid,
          importedAt: Date.now(),
        },
        foreground: uploadedFgUrl ? {
          url: uploadedFgUrl,
          sourceName: fgImageName,
          fit,
          alignWithGrid,
          importedAt: Date.now(),
        } : null,
        objects: importedObjects,
      };
      const nextLayerState = buildDefaultImportedMapLayerState(nextMapState);
      const { db, ref, update } = window._FB;
      await update(ref(db, `rooms/${roomCode}`), {
        mapState: nextMapState,
        mapLayerState: nextLayerState,
        'bgm/mapBackground': nextMapState.background.url,
        'bgm/mapBackgroundFit': nextMapState.background.fit,
        'bgm/mapBackgroundSourceName': nextMapState.background.sourceName || '',
        'bgm/mapBackgroundImportedAt': nextMapState.background.importedAt || Date.now(),
        'bgm/mapForeground': nextMapState.foreground?.url || '',
        'bgm/mapForegroundFit': nextMapState.foreground?.fit || '',
        'bgm/mapForegroundSourceName': nextMapState.foreground?.sourceName || '',
        'bgm/mapForegroundImportedAt': nextMapState.foreground?.importedAt || 0,
        'bgm/mapObjects': nextMapState.objects || [],
        'bgm/mapLayerState': nextLayerState,
      });
      if (window.St) {
        window.St.mapState = nextMapState;
        window.St.mapLayerState = nextLayerState;
      }
      if (typeof window._itcApplyRoomMapStateLocal === 'function') {
        try {
          window._itcApplyRoomMapStateLocal(nextMapState, nextLayerState, 'map-import-local');
        } catch (e) {
          console.warn('map import local map state apply failed', e);
          applyImportedMapState(nextMapState);
          if (typeof refreshMapLayerManager === 'function') refreshMapLayerManager();
        }
      } else {
        applyImportedMapState(nextMapState);
        if (typeof refreshMapLayerManager === 'function') refreshMapLayerManager();
      }
      if (validated.diagnostics) {
        const uploadDiagnostics = {
          ...validated.diagnostics,
          attemptedObjectUploads: objectBlueprints.length,
          successfulObjectUploads: importedObjects.length,
          failedObjectUploads: Math.max(0, objectBlueprints.length - importedObjects.length),
          foregroundRequested: !!(fgImageName && fgImageName !== mapImageName),
          foregroundUploaded: !!uploadedFgUrl,
        };
        console.groupCollapsed(`[ITC 맵세팅 업로드 결과] ${validated.fileName || pendingFile.name || ''}`);
        console.info(uploadDiagnostics);
        if (uploadDiagnostics.failedObjectUploads > 0) {
          console.warn(`오브젝트 업로드 ${uploadDiagnostics.failedObjectUploads}개가 실패하거나 ZIP에서 연결되지 않았습니다.`);
        }
        console.groupEnd();
      }
      const cutinCount = Object.keys(validated.parsed?.entities?.effects || {}).filter(k => validated.parsed?.entities?.effects[k]?.imageUrl).length;
      const cutinNote = cutinCount > 0 ? ` / 컷인 ${cutinCount}개 임포트` : '';
      if (typeof showToast === 'function') showToast(`맵 이미지 + 스크린 패널${cutinNote} 적용 완료`);
      if (typeof window.hideMapImportPanel === 'function') window.hideMapImportPanel();
    } catch (err) {
      console.error('map background apply failed', err);
      setError(err?.message || '맵 이미지 적용 중 오류가 발생했어요.');
    } finally {
      IMPORT_STATE.isBusy = false;
    }
  }

  window.applyImportedMapState = applyImportedMapState;
  window.ensureLazyMapLayerElementImage = ensureLazyMapLayerElementImage;
  window.applyValidatedMapBackground = applyValidatedMapBackground;
  window.openMapImportModal = openMapImportModal;
  window.handleMapImportFile = handleMapImportFile;
})();
