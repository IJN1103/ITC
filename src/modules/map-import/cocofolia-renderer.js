(function () {
  const WORLD_CONTAINER_ID = 'cocofolia-world-container';

  function toFiniteNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function getImportedCanvas(mapState = window.St?.mapState) {
    const canvas = mapState?.importedCanvas;
    if (!canvas || canvas.engine !== 'cocofolia-source-space') return null;
    return canvas;
  }

  function getWorldMetrics(mapState = window.St?.mapState) {
    const canvas = getImportedCanvas(mapState);
    if (!canvas) return null;
    const widthUnits = Math.max(1, toFiniteNumber(canvas.width, canvas?.sourceWorld?.contentBounds?.width || 1));
    const heightUnits = Math.max(1, toFiniteNumber(canvas.height, canvas?.sourceWorld?.contentBounds?.height || 1));
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

  function ensureWorldContainer(mapInner = document.getElementById('map-inner')) {
    if (!mapInner) return null;
    let container = document.getElementById(WORLD_CONTAINER_ID);
    if (!container || container.parentElement !== mapInner) {
      container = document.createElement('div');
      container.id = WORLD_CONTAINER_ID;
      container.className = 'cocofolia-world-container';
      mapInner.appendChild(container);
    }
    const metrics = getWorldMetrics();
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
    return token?.importedMapObject === true
      && source?.units === 'cocofolia-grid'
      && Number.isFinite(Number(source.x))
      && Number.isFinite(Number(source.y));
  }

  function getTokenSourceRect(token, mapState = window.St?.mapState) {
    if (!isSourceToken(token)) return null;
    const metrics = getWorldMetrics(mapState);
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
    return true;
  }

  function getTokenParent(token, mapInner = document.getElementById('map-inner')) {
    if (!mapInner) return null;
    if (!isSourceToken(token) || !getImportedCanvas()) return mapInner;
    return ensureWorldContainer(mapInner) || mapInner;
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
