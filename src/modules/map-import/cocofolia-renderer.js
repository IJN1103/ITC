(function () {
  const WORLD_CONTAINER_ID = 'cocofolia-world-container';

  function toFiniteNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function normalizeCanvas(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const engine = String(raw.engine || '');
    if (engine && engine !== 'cocofolia-source-space') return null;
    const width = toFiniteNumber(raw.width, 0);
    const height = toFiniteNumber(raw.height, 0);
    if (!(width > 0) || !(height > 0)) return null;
    return { ...raw, engine: 'cocofolia-source-space', width, height };
  }

  function getImportedCanvas(mapState = window.St?.mapState, token = null) {
    return normalizeCanvas(mapState?.importedCanvas)
      || normalizeCanvas(token?.importedMapObjectMeta?.sourceCanvas)
      || null;
  }

  function getWorldMetrics(mapState = window.St?.mapState, token = null) {
    const canvas = getImportedCanvas(mapState, token);
    if (!canvas) return null;
    const widthUnits = Math.max(1, toFiniteNumber(canvas.width, 1));
    const heightUnits = Math.max(1, toFiniteNumber(canvas.height, 1));
    const logicalWidth = Math.max(1, toFiniteNumber(canvas.logicalWidthPx, 1600));
    const pixelsPerUnit = Math.max(0.0001, toFiniteNumber(canvas.pixelsPerUnit, logicalWidth / widthUnits));
    const logicalHeight = Math.max(1, toFiniteNumber(canvas.logicalHeightPx, heightUnits * pixelsPerUnit));
    return {
      canvas,
      left: toFiniteNumber(canvas.left, 0),
      top: toFiniteNumber(canvas.top, 0),
      widthUnits,
      heightUnits,
      logicalWidth,
      logicalHeight,
      pixelsPerUnit,
    };
  }

  function ensureWorldContainer(mapInner = document.getElementById('map-inner'), token = null) {
    if (!mapInner) return null;
    let container = document.getElementById(WORLD_CONTAINER_ID);
    if (!container || container.parentElement !== mapInner) {
      container = document.createElement('div');
      container.id = WORLD_CONTAINER_ID;
      container.className = 'cocofolia-world-container';
      mapInner.appendChild(container);
    }
    const metrics = getWorldMetrics(window.St?.mapState, token);
    if (metrics) {
      container.style.width = `${metrics.logicalWidth}px`;
      container.style.height = `${metrics.logicalHeight}px`;
      container.hidden = false;
    } else {
      container.style.width = '100%';
      container.style.height = '100%';
      container.hidden = true;
    }
    return container;
  }

  function isSourceToken(token) {
    const source = token?.importedMapObjectMeta?.sourceSpace;
    const hasSourceCoordinates = source?.units === 'cocofolia-grid'
      && Number.isFinite(Number(source.x))
      && Number.isFinite(Number(source.y))
      && Number.isFinite(Number(source.width))
      && Number.isFinite(Number(source.height));
    if (!hasSourceCoordinates) return false;
    return token?.importedMapObject === true
      || token?.importedMapObject === 'true'
      || token?.importEngine === 'cocofolia-source-space'
      || !!token?.importedMapObjectMeta?.sourceItemId;
  }

  function getTokenSourceRect(token, mapState = window.St?.mapState) {
    if (!isSourceToken(token)) return null;
    const metrics = getWorldMetrics(mapState, token);
    if (!metrics) return null;
    const source = token.importedMapObjectMeta.sourceSpace;
    const width = Math.max(1, toFiniteNumber(source.width, token.panelWidth || 1));
    const height = Math.max(1, toFiniteNumber(source.height, token.panelHeight || 1));
    const x = toFiniteNumber(source.x, 0);
    const y = toFiniteNumber(source.y, 0);
    return {
      x,
      y,
      width,
      height,
      centerX: x + width / 2,
      centerY: y + height / 2,
      leftPx: (x - metrics.left) * metrics.pixelsPerUnit,
      topPx: (y - metrics.top) * metrics.pixelsPerUnit,
      centerXPx: ((x - metrics.left) + width / 2) * metrics.pixelsPerUnit,
      centerYPx: ((y - metrics.top) + height / 2) * metrics.pixelsPerUnit,
      widthPx: width * metrics.pixelsPerUnit,
      heightPx: height * metrics.pixelsPerUnit,
      metrics,
    };
  }

  function applyTokenSourceLayout(el, token, mapState = window.St?.mapState) {
    const rect = getTokenSourceRect(token, mapState);
    if (!el || !rect) return false;
    el.dataset.cocofoliaSourceToken = 'true';
    el.style.left = `${rect.centerXPx}px`;
    el.style.top = `${rect.centerYPx}px`;
    el.style.width = `${rect.widthPx}px`;
    el.style.height = `${rect.heightPx}px`;
    el.style.minWidth = '0';
    el.style.minHeight = '0';
    el.style.aspectRatio = '';
    window.ITCCocofoliaRenderDiagnostics?.inspect?.(el, token, 'source-layout-applied', rect);
    return true;
  }

  function getTokenParent(token, mapInner = document.getElementById('map-inner')) {
    if (!mapInner) return null;
    if (!isSourceToken(token) || !getImportedCanvas(window.St?.mapState, token)) return mapInner;
    return ensureWorldContainer(mapInner, token) || mapInner;
  }

  function sourcePositionFromCenterPx(token, centerXPx, centerYPx, mapState = window.St?.mapState) {
    const rect = getTokenSourceRect(token, mapState);
    if (!rect) return null;
    const x = rect.metrics.left + (toFiniteNumber(centerXPx, rect.centerXPx) / rect.metrics.pixelsPerUnit) - (rect.width / 2);
    const y = rect.metrics.top + (toFiniteNumber(centerYPx, rect.centerYPx) / rect.metrics.pixelsPerUnit) - (rect.height / 2);
    const xPct = ((x - rect.metrics.left) / rect.metrics.widthUnits) * 100;
    const yPct = ((y - rect.metrics.top) / rect.metrics.heightUnits) * 100;
    const widthPct = (rect.width / rect.metrics.widthUnits) * 100;
    const heightPct = (rect.height / rect.metrics.heightUnits) * 100;
    return {
      x,
      y,
      centerX: x + rect.width / 2,
      centerY: y + rect.height / 2,
      xCenterPct: xPct + widthPct / 2,
      yCenterPct: yPct + heightPct / 2,
      xPct,
      yPct,
      widthPct,
      heightPct,
    };
  }

  window.ITCCocofoliaRenderer = Object.freeze({
    getImportedCanvas,
    getWorldMetrics,
    ensureWorldContainer,
    isSourceToken,
    getTokenSourceRect,
    applyTokenSourceLayout,
    getTokenParent,
    sourcePositionFromCenterPx,
  });
})();
