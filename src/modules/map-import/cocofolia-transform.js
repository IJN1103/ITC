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

  function buildImportedMapObjects(itemsMap = {}, roomMeta = {}, sceneAspect = 1) {
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
    buildImportedMapObjects,
  });
})();
