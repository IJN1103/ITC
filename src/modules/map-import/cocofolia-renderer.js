(function () {
  const WORLD_CONTAINER_ID = 'cocofolia-world-container';
  const WORLD_BG_LAYER_ID = 'cocofolia-world-background-layer';
  const WORLD_FG_LAYER_ID = 'cocofolia-world-foreground-layer';
  let _lastValidWorldMetrics = null;

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

  function findFallbackSourceToken() {
    const tokens = window.St?.tokens;
    if (!tokens || typeof tokens !== 'object') return null;
    return Object.values(tokens).find((item) => {
      const source = item?.importedMapObjectMeta?.sourceSpace;
      const canvas = item?.importedMapObjectMeta?.sourceCanvas;
      return source?.units === 'cocofolia-grid' && canvas && typeof canvas === 'object';
    }) || null;
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

    // mapState와 tokens는 Firebase에서 서로 다른 시점에 도착할 수 있다.
    // applyMapTransform()이 token 없이 호출된 순간 mapState.importedCanvas가 잠시 비어 있어도
    // 이미 정상 렌더된 코코포리아 월드 전체를 hidden 처리하지 않는다.
    const fallbackToken = token || findFallbackSourceToken();
    const metrics = getWorldMetrics(window.St?.mapState, fallbackToken) || _lastValidWorldMetrics;
    if (metrics) {
      _lastValidWorldMetrics = metrics;
      container.style.width = `${metrics.logicalWidth}px`;
      container.style.height = `${metrics.logicalHeight}px`;
      container.hidden = false;
    } else {
      // 아직 한 번도 유효한 월드 정보를 받은 적이 없을 때만 기본 크기를 사용한다.
      // 기존 컨테이너를 숨기면 늦게 도착한 mapState 갱신 때 자식 오브젝트가 전부 사라진다.
      container.style.width = container.style.width || '100%';
      container.style.height = container.style.height || '100%';
      container.hidden = false;
    }
    return container;
  }


  function isLayerVisible(layerId) {
    const visible = window.St?.mapLayerState?.visible;
    if (!visible || typeof visible !== 'object') return true;
    return visible[String(layerId || '')] !== false;
  }

  function cssBackgroundImage(url) {
    const raw = String(url || '').trim();
    return raw ? `url(${JSON.stringify(raw)})` : '';
  }

  function ensureSourceFieldLayer(container, id, className) {
    if (!container) return null;
    let layer = document.getElementById(id);
    if (!layer || layer.parentElement !== container) {
      layer?.remove();
      layer = document.createElement('div');
      layer.id = id;
      layer.className = className;
      container.prepend(layer);
    }
    return layer;
  }

  function getFieldRectPx(metrics) {
    const field = metrics?.canvas?.field;
    if (!field) return null;
    const left = toFiniteNumber(field.left, 0);
    const top = toFiniteNumber(field.top, 0);
    const width = Math.max(1, toFiniteNumber(field.width, metrics.widthUnits));
    const height = Math.max(1, toFiniteNumber(field.height, metrics.heightUnits));
    return {
      leftPx: (left - metrics.left) * metrics.pixelsPerUnit,
      topPx: (top - metrics.top) * metrics.pixelsPerUnit,
      widthPx: width * metrics.pixelsPerUnit,
      heightPx: height * metrics.pixelsPerUnit,
    };
  }

  function applySourceFieldLayers(mapState = window.St?.mapState) {
    const fallbackToken = findFallbackSourceToken();
    const canvas = getImportedCanvas(mapState, fallbackToken);
    if (!canvas) return false;
    const mapInner = document.getElementById('map-inner');
    const container = ensureWorldContainer(mapInner, fallbackToken);
    const metrics = getWorldMetrics(mapState, fallbackToken) || _lastValidWorldMetrics;
    if (!container || !metrics) return false;

    mapInner?.classList.add('cocofolia-source-field-active');
    mapInner?.parentElement?.classList.add('cocofolia-source-field-active');

    const background = mapState?.background || null;
    const foreground = mapState?.foreground || null;
    const bgLayer = ensureSourceFieldLayer(container, WORLD_BG_LAYER_ID, 'cocofolia-world-background-layer');
    const fgLayer = ensureSourceFieldLayer(container, WORLD_FG_LAYER_ID, 'cocofolia-world-foreground-layer');

    if (bgLayer) {
      bgLayer.style.left = '0px';
      bgLayer.style.top = '0px';
      bgLayer.style.width = `${metrics.logicalWidth}px`;
      bgLayer.style.height = `${metrics.logicalHeight}px`;
      bgLayer.style.backgroundImage = cssBackgroundImage(background?.url);
      bgLayer.style.backgroundSize = 'cover';
      bgLayer.style.backgroundPosition = 'center center';
      bgLayer.style.display = background?.url && isLayerVisible('background') ? '' : 'none';
    }

    if (fgLayer) {
      const fieldRect = getFieldRectPx(metrics);
      if (foreground?.url && fieldRect) {
        const fit = String(foreground.fit || 'fill').trim() || 'fill';
        fgLayer.style.left = `${fieldRect.leftPx}px`;
        fgLayer.style.top = `${fieldRect.topPx}px`;
        fgLayer.style.width = `${fieldRect.widthPx}px`;
        fgLayer.style.height = `${fieldRect.heightPx}px`;
        fgLayer.style.backgroundImage = cssBackgroundImage(foreground.url);
        fgLayer.style.backgroundSize = fit === 'cover' ? 'cover' : (fit === 'contain' ? 'contain' : '100% 100%');
        fgLayer.style.backgroundPosition = 'center center';
        fgLayer.style.display = isLayerVisible('foreground') ? '' : 'none';
      } else {
        fgLayer.style.display = 'none';
        fgLayer.style.backgroundImage = '';
      }
    }

    const legacyBg = document.getElementById('map-bg-layer');
    const legacyFg = document.getElementById('map-fg-layer');
    const blur = document.getElementById('map-bg-blur-layer');
    if (legacyBg) legacyBg.style.display = 'none';
    if (legacyFg) legacyFg.style.display = 'none';
    if (blur) {
      // sourceFieldMode에서는 기존 일반 배경 분기를 건너뛰므로 후경 URL을 여기서 직접 유지한다.
      const blurVisible = !!background?.url && isLayerVisible('background');
      blur.style.backgroundImage = blurVisible ? cssBackgroundImage(background.url) : '';
      blur.style.backgroundSize = 'cover';
      blur.style.backgroundPosition = 'center center';
      blur.style.display = blurVisible ? '' : 'none';
      blur.classList.toggle('map-layer-runtime-hidden', !blurVisible);
    }
    return true;
  }

  function clearSourceFieldLayers() {
    const mapInner = document.getElementById('map-inner');
    const fallbackToken = findFallbackSourceToken();
    const stillSourceMode = !!getImportedCanvas(window.St?.mapState, fallbackToken);

    // Firebase에서 mapState와 tokens가 서로 다른 순서로 도착하는 짧은 순간에는
    // 코코포리아 전용 배경을 제거하거나 기존 일반 배경을 되살리지 않는다.
    if (stillSourceMode) {
      mapInner?.classList.add('cocofolia-source-field-active');
      mapInner?.parentElement?.classList.add('cocofolia-source-field-active');
      const legacyBg = document.getElementById('map-bg-layer');
      const blur = document.getElementById('map-bg-blur-layer');
      if (legacyBg) legacyBg.style.display = 'none';
      if (blur) {
        const background = window.St?.mapState?.background || null;
        const blurVisible = !!background?.url && isLayerVisible('background');
        blur.style.backgroundImage = blurVisible ? cssBackgroundImage(background.url) : '';
        blur.style.backgroundSize = 'cover';
        blur.style.backgroundPosition = 'center center';
        blur.style.display = blurVisible ? '' : 'none';
        blur.classList.toggle('map-layer-runtime-hidden', !blurVisible);
      }
      return;
    }

    document.getElementById(WORLD_BG_LAYER_ID)?.remove();
    document.getElementById(WORLD_FG_LAYER_ID)?.remove();
    mapInner?.classList.remove('cocofolia-source-field-active');
    mapInner?.parentElement?.classList.remove('cocofolia-source-field-active');
    const legacyBg = document.getElementById('map-bg-layer');
    const legacyFg = document.getElementById('map-fg-layer');
    const blur = document.getElementById('map-bg-blur-layer');
    if (legacyBg) legacyBg.style.display = '';
    if (legacyFg) legacyFg.style.display = '';
    if (blur) blur.style.display = '';
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
    applySourceFieldLayers,
    clearSourceFieldLayers,
  });
})();
