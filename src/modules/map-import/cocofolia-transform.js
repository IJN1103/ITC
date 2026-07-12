(function () {
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
      return { panelActionType: text.startsWith('/') ? 'macro' : 'chat', panelActionText: text, raw: rawAction };
    }
    if (typeof rawAction === 'object') {
      const type = String(rawAction.type || rawAction.actionType || '').trim().toLowerCase();
      const candidates = [rawAction.text, rawAction.message, rawAction.content, rawAction.command, rawAction.value]
        .map((value) => typeof value === 'string' ? value.trim() : '')
        .filter(Boolean);
      const text = candidates[0] || '';
      if (!text) return { panelActionType: 'none', panelActionText: '', raw: rawAction };
      if (type === 'macro' || type === 'command' || text.startsWith('/')) return { panelActionType: 'macro', panelActionText: text, raw: rawAction };
      if (type === 'chat' || type === 'message' || type === 'text') return { panelActionType: 'chat', panelActionText: text, raw: rawAction };
      return { panelActionType: text.startsWith('/') ? 'macro' : 'chat', panelActionText: text, raw: rawAction };
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

  function collectSupportedMapItems(itemsMap = {}, roomMeta = {}) {
    const rawItems = Object.entries(itemsMap)
      .map(([id, item]) => ({ id, ...(item || {}), _markerPanel: false }))
      .filter((item) => (item.type === 'object' || item.type === 'plane') && item.visible !== false && String(item.imageUrl || '').trim());
    const markerItems = Object.entries(roomMeta?.markers || {})
      .map(([id, marker]) => ({
        id: `marker_${id}`,
        ...(marker || {}),
        type: 'object',
        _markerPanel: true,
        _markerText: String(marker?.text || ''),
        _clickAction: marker?.clickAction || null,
      }))
      .filter((item) => String(item.imageUrl || '').trim());
    return [...rawItems, ...markerItems];
  }

  function buildImportedCanvasModel(itemsMap = {}, roomMeta = {}) {
    const allRawItems = collectSupportedMapItems(itemsMap, roomMeta);
    const fieldWidth = Math.max(0, Number(roomMeta?.fieldWidth || 0));
    const fieldHeight = Math.max(0, Number(roomMeta?.fieldHeight || 0));
    const fieldLeft = fieldWidth > 0 ? -(fieldWidth / 2) : 0;
    const fieldTop = fieldHeight > 0 ? -(fieldHeight / 2) : 0;
    const fieldRight = fieldLeft + fieldWidth;
    const fieldBottom = fieldTop + fieldHeight;

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
    }, {
      left: fieldWidth > 0 ? fieldLeft : Infinity,
      right: fieldWidth > 0 ? fieldRight : -Infinity,
      top: fieldHeight > 0 ? fieldTop : Infinity,
      bottom: fieldHeight > 0 ? fieldBottom : -Infinity,
    });

    if (!Number.isFinite(bounds.left) || !Number.isFinite(bounds.right) || !Number.isFinite(bounds.top) || !Number.isFinite(bounds.bottom)) {
      bounds.left = -20;
      bounds.right = 20;
      bounds.top = -15;
      bounds.bottom = 15;
    }

    const pad = Math.max(2, Math.min(8, Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) * 0.0125));
    const left = bounds.left - pad;
    const top = bounds.top - pad;
    const width = Math.max(1, (bounds.right - bounds.left) + pad * 2);
    const height = Math.max(1, (bounds.bottom - bounds.top) + pad * 2);
    const toPctX = (value) => ((Number(value || 0) - left) / width) * 100;
    const toPctY = (value) => ((Number(value || 0) - top) / height) * 100;

    return {
      version: 2,
      mode: 'cocofolia-expanded',
      left,
      top,
      width,
      height,
      aspect: width / height,
      // map-token.js의 고정 논리 폭(1600px)과 동일한 기준을 사용한다.
      // 코코포리아 1칸을 X/Y 모두 같은 픽셀 크기로 변환해,
      // 확장 캔버스의 가로·세로 비율이나 CSS % 계산에 의해
      // 패널 크기가 달라지는 것을 막는다.
      logicalWidthPx: 1600,
      logicalHeightPx: 1600 / (width / height),
      pixelsPerUnit: 1600 / width,
      padding: pad,
      field: {
        left: fieldLeft,
        top: fieldTop,
        width: fieldWidth || width,
        height: fieldHeight || height,
        xPct: fieldWidth > 0 ? toPctX(fieldLeft) : 0,
        yPct: fieldHeight > 0 ? toPctY(fieldTop) : 0,
        widthPct: fieldWidth > 0 ? (fieldWidth / width) * 100 : 100,
        heightPct: fieldHeight > 0 ? (fieldHeight / height) * 100 : 100,
      },
      // PHASE 3-2: 월드 전체를 자동 맞춤하지 않고 코코포리아의 기본 필드를
      // 초기 카메라 대상으로 사용한다. 필드 밖 오브젝트는 월드에 남아 있으며
      // 맵 드래그/축소 시 확인할 수 있다.
      camera: {
        version: 1,
        mode: 'field-fit',
        fit: 'contain',
        targetLeft: fieldWidth > 0 ? fieldLeft : left,
        targetTop: fieldHeight > 0 ? fieldTop : top,
        targetWidth: fieldWidth > 0 ? fieldWidth : width,
        targetHeight: fieldHeight > 0 ? fieldHeight : height,
        paddingRatio: 0,
      },
    };
  }

  function buildImportedMapObjects(itemsMap = {}, roomMeta = {}, canvasModel = null) {
    const allRawItems = collectSupportedMapItems(itemsMap, roomMeta);
    if (!allRawItems.length) return [];
    const canvas = canvasModel && typeof canvasModel === 'object'
      ? canvasModel
      : buildImportedCanvasModel(itemsMap, roomMeta);
    const spanW = Math.max(1, Number(canvas.width || 1));
    const spanH = Math.max(1, Number(canvas.height || 1));
    const baseLeft = Number(canvas.left || 0);
    const baseTop = Number(canvas.top || 0);
    const pixelsPerUnit = Math.max(0.0001, Number(canvas.pixelsPerUnit || (1600 / spanW)) || (1600 / spanW));

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
        const widthPx = w * pixelsPerUnit;
        const heightPx = h * pixelsPerUnit;
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
          widthPx,
          heightPx,
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
            widthPx,
            heightPx,
            pixelsPerUnit,
            sourceMeta: {
              x, y, width: w, height: h, z: sourceZ, order: sourceOrder,
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

  window.ITCCocofoliaTransform = Object.freeze({
    buildImportedPanelTokenId,
    parseImportedPanelClickAction,
    buildImportedPanelToken,
    buildImportedCanvasModel,
    buildImportedMapObjects,
  });
})();
