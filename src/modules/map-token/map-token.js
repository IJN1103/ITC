/**
 * ITC TRPG — Map + Token 모듈
 * 맵 줌/팬, 토큰 CRUD/드래그/편집
 */

let _mapScale = 1;
let _mapPanX = 0, _mapPanY = 0;

const MAP_LOGICAL_WIDTH = 1600;
const MAP_LOGICAL_HEIGHT = 900;

let _mapBaseWidth = MAP_LOGICAL_WIDTH;
let _mapBaseHeight = MAP_LOGICAL_HEIGHT;
let _mapViewportWidth = 0;
let _mapViewportHeight = 0;

function roundMapNumber(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const factor = 10 ** digits;
  return Math.round(num * factor) / factor;
}

/* ── 드래그 보호 상태 ── */
let _activeDragSession = null;
let _pendingTokenRender = false;

function refreshMapBaseSize() {
  /*
    토큰 좌표/거리 기준은 모든 플레이어에게 동일해야 하므로
    viewport 크기가 아니라 고정 논리 캔버스를 기준으로 유지한다.
    이전처럼 각 클라이언트 map-area 크기를 기준으로 삼으면
    화면 크기가 다른 플레이어끼리 같은 x/y 값이 서로 다른 픽셀 위치로 보일 수 있다.
  */
  _mapBaseWidth = MAP_LOGICAL_WIDTH;
  _mapBaseHeight = MAP_LOGICAL_HEIGHT;
  return { width: _mapBaseWidth, height: _mapBaseHeight };
}

function getMapBaseSize() {
  return refreshMapBaseSize();
}

function getMapExpansion() {
  const { width: baseW, height: baseH } = getMapBaseSize();
  return { x: 1, y: 1, baseW, baseH };
}

function storedTokenPercentToDisplay(value, axis = 'x') {
  return Number(value) || 0;
}

function displayTokenPercentToStored(value, axis = 'x') {
  return Number(value) || 0;
}

function getTokenStoredPercentMin(axis = 'x') {
  return -75;
}

function getTokenStoredPercentMax(axis = 'x') {
  return 175;
}

function clampTokenStoredPercent(value, axis = 'x') {
  return Math.max(getTokenStoredPercentMin(axis), Math.min(getTokenStoredPercentMax(axis), Number(value) || 0));
}

function syncRenderedTokenPositions() {
  if (!window.St?.tokens) return;
  const draggingIds = _activeDragSession ? new Set(_activeDragSession.targetIds) : null;
  Object.entries(St.tokens).forEach(([id, token]) => {
    if (draggingIds && draggingIds.has(id)) return; // 드래그 중인 토큰은 건너뜀
    const el = getTokenEl(id);
    if (!el || !token) return;
    if (typeof token.x === 'number') el.style.left = storedTokenPercentToDisplay(token.x, 'x') + '%';
    if (typeof token.y === 'number') el.style.top = storedTokenPercentToDisplay(token.y, 'y') + '%';
  });
}


let _teTokenImgBlob = null;

function getCloudinaryConfigForToken() { return _itcGetCloudinaryConfig(); }
function mapTokenWithTimeout(promise, ms) { return _itcWithTimeout(promise, ms); }
function mapTokenCanvasToBlob(canvas, type, quality) { return _itcCanvasToBlob(canvas, type, quality); }
function makeTokenImageBlob(file, max) { return _itcMakeImageBlob(file, max || 800); }

async function uploadTokenBlobToCloudinary(blob, folder = 'itc/tokens') {
  const result = await _itcUploadToCloudinary({ blob, folder });
  return result.url;
}

function revokeTokenPreviewUrl(url) { _itcRevokePreview(url); }

function cleanupTokenEditPendingAssets() {
  revokeTokenPreviewUrl(_teTokenImgData);
  _teTokenImgBlob = null;
  const list = document.getElementById('te-standing-list');
  if (list) {
    list.querySelectorAll('.te-standing-row').forEach((row) => {
      if (row._pendingPreviewUrl) revokeTokenPreviewUrl(row._pendingPreviewUrl);
      row._pendingPreviewUrl = '';
      row._pendingBlob = null;
    });
  }
}



let _multiSelectedTokenIds = [];
let _tokenSelectionState = {
  active: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
};


function ensureTokenSelectionBox() {
  const map = document.getElementById('map-area');
  if (!map) return null;
  let box = document.getElementById('map-token-selection-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'map-token-selection-box';
    box.className = 'map-token-selection-box';
    map.appendChild(box);
  }
  return box;
}

function updateTokenSelectionBox() {
  const box = ensureTokenSelectionBox();
  if (!box) return;
  if (!_tokenSelectionState.active) {
    box.style.display = 'none';
    return;
  }
  const x1 = Math.min(_tokenSelectionState.startX, _tokenSelectionState.currentX);
  const y1 = Math.min(_tokenSelectionState.startY, _tokenSelectionState.currentY);
  const x2 = Math.max(_tokenSelectionState.startX, _tokenSelectionState.currentX);
  const y2 = Math.max(_tokenSelectionState.startY, _tokenSelectionState.currentY);
  box.style.display = 'block';
  box.style.left = x1 + 'px';
  box.style.top = y1 + 'px';
  box.style.width = Math.max(0, x2 - x1) + 'px';
  box.style.height = Math.max(0, y2 - y1) + 'px';
}

function hideTokenSelectionBox() {
  const box = document.getElementById('map-token-selection-box');
  if (box) box.style.display = 'none';
}

function getTokenEl(tokenId) {
  return document.getElementById('tok-' + tokenId);
}

function getTokenIdsFromState(tokens = St.tokens) {
  return new Set(Object.keys(tokens || {}));
}

function normalizeMultiTokenSelection(ids, tokens = St.tokens) {
  const availableIds = getTokenIdsFromState(tokens);
  return Array.from(new Set((ids || []).filter((id) => id && availableIds.has(String(id)))));
}

function updateMultiTokenSelectionUI() {
  document.querySelectorAll('.map-token.multi-selected').forEach((el) => el.classList.remove('multi-selected'));
  _multiSelectedTokenIds = normalizeMultiTokenSelection(_multiSelectedTokenIds);
  _multiSelectedTokenIds.forEach((id) => {
    getTokenEl(id)?.classList.add('multi-selected');
  });
}

function clearMultiTokenSelection() {
  _multiSelectedTokenIds = [];
  updateMultiTokenSelectionUI();
}

function setMultiTokenSelection(ids) {
  _multiSelectedTokenIds = normalizeMultiTokenSelection(ids);
  updateMultiTokenSelectionUI();
}

function syncMultiTokenSelectionWithTokens(tokens = St.tokens) {
  const normalized = normalizeMultiTokenSelection(_multiSelectedTokenIds, tokens);
  const changed = normalized.length !== _multiSelectedTokenIds.length
    || normalized.some((id, index) => id !== _multiSelectedTokenIds[index]);
  _multiSelectedTokenIds = normalized;
  if (changed) updateMultiTokenSelectionUI();
}

function toggleTokenSelection(tokenId) {
  if (_multiSelectedTokenIds.includes(tokenId)) {
    setMultiTokenSelection(_multiSelectedTokenIds.filter((id) => id !== tokenId));
    return;
  }
  setMultiTokenSelection([..._multiSelectedTokenIds, tokenId]);
}

function getDragTargetIds(tokenId) {
  const normalizedSelection = normalizeMultiTokenSelection(_multiSelectedTokenIds);
  if (normalizedSelection.includes(tokenId)) return normalizedSelection;
  setMultiTokenSelection([tokenId]);
  return [tokenId];
}

function getTokenStartPosition(tokenId) {
  const targetEl = getTokenEl(tokenId);
  const token = St.tokens[tokenId] || {};
  return {
    left: typeof token.x === 'number' ? token.x : displayTokenPercentToStored(parseFloat(targetEl?.style.left) || 0, 'x'),
    top: typeof token.y === 'number' ? token.y : displayTokenPercentToStored(parseFloat(targetEl?.style.top) || 0, 'y'),
  };
}

function buildTokenDragSession(tokenId, startEvent) {
  const targetIds = getDragTargetIds(tokenId);
  const { width: natW, height: natH } = getMapBaseSize();
  const scale = _mapScale || 1;
  const startPos = {};
  targetIds.forEach((id) => {
    startPos[id] = getTokenStartPosition(id);
  });
  return {
    startClientX: startEvent.clientX,
    startClientY: startEvent.clientY,
    natW,
    natH,
    scale,
    targetIds,
    startPos,
  };
}

function applyTokenDragSession(session, moveEvent) {
  const dxPct = ((moveEvent.clientX - session.startClientX) / (session.natW * session.scale)) * 100;
  const dyPct = ((moveEvent.clientY - session.startClientY) / (session.natH * session.scale)) * 100;
  session.targetIds.forEach((id) => {
    const targetEl = getTokenEl(id);
    const pos = session.startPos[id];
    if (!targetEl || !pos) return;
    const nextLeft = clampTokenStoredPercent(pos.left + dxPct, 'x');
    const nextTop = clampTokenStoredPercent(pos.top + dyPct, 'y');
    targetEl.style.left = storedTokenPercentToDisplay(nextLeft, 'x') + '%';
    targetEl.style.top = storedTokenPercentToDisplay(nextTop, 'y') + '%';
  });
}

function collectDraggedTokenPositions(targetIds) {
  const patch = {};
  targetIds.forEach((id) => {
    const targetEl = getTokenEl(id);
    if (!targetEl) return;
    patch[id] = {
      x: clampTokenStoredPercent(displayTokenPercentToStored(parseFloat(targetEl.style.left) || 0, 'x'), 'x'),
      y: clampTokenStoredPercent(displayTokenPercentToStored(parseFloat(targetEl.style.top) || 0, 'y'), 'y'),
    };
  });
  return patch;
}

function applyTokenPositionPatchToState(positionPatch) {
  Object.entries(positionPatch || {}).forEach(([id, pos]) => {
    if (!St.tokens[id]) St.tokens[id] = {};
    St.tokens[id].x = pos.x;
    St.tokens[id].y = pos.y;
  });
}

function saveTokenPositionPatch(positionPatch) {
  applyTokenPositionPatchToState(positionPatch);
  if (!(window._FB?.CONFIGURED && St.roomCode)) return;
  const { db, ref, update } = window._FB;
  const updates = {};
  Object.entries(positionPatch || {}).forEach(([id, pos]) => {
    updates[`rooms/${St.roomCode}/tokens/${id}/x`] = pos.x;
    updates[`rooms/${St.roomCode}/tokens/${id}/y`] = pos.y;
  });
  if (Object.keys(updates).length > 0) {
    update(ref(db), updates);
  }
}

function finishTokenSelection() {
  if (!_tokenSelectionState.active) return;
  const map = document.getElementById('map-area');
  const selected = [];

  const x1 = Math.min(_tokenSelectionState.startX, _tokenSelectionState.currentX);
  const y1 = Math.min(_tokenSelectionState.startY, _tokenSelectionState.currentY);
  const x2 = Math.max(_tokenSelectionState.startX, _tokenSelectionState.currentX);
  const y2 = Math.max(_tokenSelectionState.startY, _tokenSelectionState.currentY);

  if (map && (x2 - x1) > 6 && (y2 - y1) > 6) {
    const mapRect = map.getBoundingClientRect();
    document.querySelectorAll('.map-token').forEach((el) => {
      const tokenRect = el.getBoundingClientRect();
      const left = tokenRect.left - mapRect.left;
      const top = tokenRect.top - mapRect.top;
      const right = tokenRect.right - mapRect.left;
      const bottom = tokenRect.bottom - mapRect.top;
      const intersects = !(right < x1 || left > x2 || bottom < y1 || top > y2);
      if (intersects) {
        const tokenId = String(el.id || '').replace(/^tok-/, '');
        if (tokenId) selected.push(tokenId);
      }
    });
  }

  _tokenSelectionState.active = false;
  hideTokenSelectionBox();
  setMultiTokenSelection(selected);
}


function getTokenStatusPanelImage(token) {
  const standingImg = Array.isArray(token?.standings) ? token.standings.find((item) => item?.img)?.img : null;
  return standingImg || token?.tokenImg || '';
}

function hasVisibleTokenInitiative(token) {
  const raw = token?.initiative;
  if (raw === '' || raw == null) return false;
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0;
}

function getRenderableStatuses(token) {
  return Array.isArray(token?.statuses)
    ? token.statuses.filter((item) => String(item?.label || '').trim())
    : [];
}

function shouldShowTokenInStatusPanel(token) {
  if (!token || isPanelToken(token) || token.hideList) return false;
  if (!shouldRenderTokenForCurrentUser(token)) return false;
  if (hasVisibleTokenInitiative(token)) return true;
  if (getRenderableStatuses(token).length > 0) return true;
  return false;
}

function getMapStatusSortedTokens(tokens = St.tokens) {
  return Object.values(tokens || {})
    .filter((token) => shouldShowTokenInStatusPanel(token))
    .sort((a, b) => {
      const diff = Number(b?.initiative || 0) - Number(a?.initiative || 0);
      if (diff) return diff;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
}

function getTokenStatusPanelSignature(token) {
  return JSON.stringify({
    id: String(token?.id || ''),
    name: String(token?.name || ''),
    hideList: !!token?.hideList,
    hideStatus: !!token?.hideStatus,
    initiative: hasVisibleTokenInitiative(token) ? Number(token?.initiative || 0) : null,
    image: String(getTokenStatusPanelImage(token) || ''),
    statuses: getRenderableStatuses(token).map((item) => ({
      label: String(item?.label || '').trim(),
      cur: item?.cur ?? '',
      max: item?.max ?? '',
    })),
    visibility: normalizeTokenVisibility(token),
  });
}

function buildMapStatusCard(token) {
  const card = document.createElement('div');
  const privateMode = !!token.hideStatus;
  const image = getTokenStatusPanelImage(token);
  const statuses = getRenderableStatuses(token);
  const showInitiative = hasVisibleTokenInitiative(token);
  const initiativeText = showInitiative ? String(token.initiative) : '';
  const imageHtml = image
    ? `<img src="${esc(image)}" alt="">`
    : `<div class="map-status-avatar-fallback">${esc((token.name || '?').slice(0, 1))}</div>`;
  const statusHtml = statuses.map((item) => {
    const label = privateMode ? '??' : esc(String(item.label || '').trim());
    const cur = privateMode ? '??' : esc(item.cur != null ? String(item.cur) : '');
    const max = privateMode ? '??' : esc(item.max != null ? String(item.max) : '');
    const valueText = max !== '' ? `${cur}/${max}` : `${cur}`;
    return `<div class="map-status-stat-box"><div class="map-status-stat-label">${label}</div><div class="map-status-stat-value">${valueText}</div></div>`;
  }).join('');
  const cardClass = statuses.length ? 'map-status-card' : 'map-status-card no-stats';
  const initiativeHtml = showInitiative
    ? `<div class="map-status-initiative-badge">${esc(initiativeText)}</div>`
    : '';
  const statsGridHtml = statuses.length
    ? `<div class="map-status-stats-grid">${statusHtml}</div>`
    : '';
  card.className = cardClass;
  card.dataset.tokenId = String(token.id || '');
  card.dataset.statusSignature = getTokenStatusPanelSignature(token);
  card.innerHTML = `
    <div class="map-status-headbox">
      <div class="map-status-avatar-wrap">
        <div class="map-status-avatar">${imageHtml}</div>
        ${initiativeHtml}
      </div>
    </div>
    ${statsGridHtml}
  `;
  return card;
}

function syncMapStatusPanelVisibility() {
  const panel = document.getElementById('map-status-panel');
  if (!panel) return;
  panel.style.display = panel.children.length ? 'grid' : 'none';
  if (!panel.children.length) panel.innerHTML = '';
}

function syncMapStatusPanelOrder(tokens = St.tokens) {
  const panel = document.getElementById('map-status-panel');
  if (!panel) return;
  const orderedIds = getMapStatusSortedTokens(tokens).map((token) => String(token.id || ''));
  orderedIds.forEach((id) => {
    const card = panel.querySelector(`[data-token-id="${CSS.escape(id)}"]`);
    if (card) panel.appendChild(card);
  });
  syncMapStatusPanelVisibility();
}

function syncMapStatusCard(token, tokens = St.tokens) {
  const panel = document.getElementById('map-status-panel');
  if (!panel || !token) return;
  const tokenId = String(token.id || '');
  const existing = panel.querySelector(`[data-token-id="${CSS.escape(tokenId)}"]`);
  if (!shouldShowTokenInStatusPanel(token)) {
    if (existing) existing.remove();
    syncMapStatusPanelOrder(tokens);
    return;
  }
  const nextSignature = getTokenStatusPanelSignature(token);
  if (existing && existing.dataset.statusSignature === nextSignature) {
    syncMapStatusPanelOrder(tokens);
    return;
  }
  const nextCard = buildMapStatusCard(token);
  if (existing) existing.replaceWith(nextCard);
  else panel.appendChild(nextCard);
  syncMapStatusPanelOrder(tokens);
}

function removeMapStatusCard(tokenId, tokens = St.tokens) {
  const panel = document.getElementById('map-status-panel');
  if (!panel) return;
  const existing = panel.querySelector(`[data-token-id="${CSS.escape(String(tokenId || ''))}"]`);
  if (existing) existing.remove();
  syncMapStatusPanelOrder(tokens);
}

function renderMapStatusPanel(tokens = St.tokens) {
  const panel = document.getElementById('map-status-panel');
  if (!panel) return;
  const items = getMapStatusSortedTokens(tokens);

  if (!items.length) {
    panel.innerHTML = '';
    panel.style.display = 'none';
    return;
  }

  panel.innerHTML = '';
  items.forEach((token) => {
    panel.appendChild(buildMapStatusCard(token));
  });
  panel.style.display = 'grid';
}

function syncMapViewportMetrics(map = document.getElementById('map-area')) {
  if (!map) return { width: _mapViewportWidth || 0, height: _mapViewportHeight || 0 };
  const width = map.clientWidth || map.offsetWidth || 0;
  const height = map.clientHeight || map.offsetHeight || 0;
  if (width > 0) _mapViewportWidth = width;
  if (height > 0) _mapViewportHeight = height;
  return { width: _mapViewportWidth || 0, height: _mapViewportHeight || 0 };
}

function preserveMapViewportCenterOnResize(map = document.getElementById('map-area')) {
  if (!map) return false;
  const next = {
    width: map.clientWidth || map.offsetWidth || 0,
    height: map.clientHeight || map.offsetHeight || 0,
  };
  const prevWidth = _mapViewportWidth || next.width;
  const prevHeight = _mapViewportHeight || next.height;

  if (!(next.width > 0 && next.height > 0)) {
    syncMapViewportMetrics(map);
    return false;
  }

  if (prevWidth === next.width && prevHeight === next.height) {
    syncMapViewportMetrics(map);
    return false;
  }

  const scale = _mapScale || 1;
  const logicalCenterX = ((prevWidth / 2) - _mapPanX) / scale;
  const logicalCenterY = ((prevHeight / 2) - _mapPanY) / scale;

  _mapPanX = roundMapNumber((next.width / 2) - (logicalCenterX * scale));
  _mapPanY = roundMapNumber((next.height / 2) - (logicalCenterY * scale));
  syncMapViewportMetrics(map);
  return true;
}

function applyMapTransform() {
  const inner = document.getElementById('map-inner');
  const map = document.getElementById('map-area');
  if (!inner || !map) return;
  const { width: baseW, height: baseH } = refreshMapBaseSize();
  inner.style.width = baseW + 'px';
  inner.style.height = baseH + 'px';
  inner.style.transformOrigin = '0 0';
  inner.style.transform = `translate(${_mapPanX}px,${_mapPanY}px) scale(${_mapScale})`;
  syncMapViewportMetrics(map);
  syncRenderedTokenPositions();
  if (_tokenMemoBubbleTokenId) {
    const tokenEl = getTokenEl(_tokenMemoBubbleTokenId);
    if (tokenEl) positionTokenMemoBubble(tokenEl);
    else hideTokenMemoBubble();
  }
}

function mapZoom(dir, cx, cy) {
  const map = document.getElementById('map-area');
  if (!map) return;
  hideTokenMemoBubble();
  const rect = map.getBoundingClientRect();
  if (cx === undefined) { cx = rect.width / 2; cy = rect.height / 2; }
  const prevScale = _mapScale;
  _mapScale = roundMapNumber(Math.max(0.2, Math.min(4, _mapScale + dir * 0.15)));
  const ratio = _mapScale / prevScale;
  _mapPanX = roundMapNumber(cx - ratio * (cx - _mapPanX));
  _mapPanY = roundMapNumber(cy - ratio * (cy - _mapPanY));
  applyMapTransform();
}

document.addEventListener('DOMContentLoaded', () => {
  const mapEl = document.getElementById('map-area');
  if (!mapEl) return;

  const finishTransientMapInteractions = (options = {}) => {
    if (_tokenSelectionState.active) finishTokenSelection();
    if (isPanning) {
      if (panMoved && panSourceTokenId) markSuppressPanelTokenClick(panSourceTokenId);
      isPanning = false;
      panSourceTokenId = '';
      panMoved = false;
      mapEl.classList.remove('panning');
    }
    if (options.flushDrag !== false && typeof _activeDragCleanup === 'function') {
      _activeDragCleanup({ save: true });
    }
  };

  refreshMapBaseSize();
  syncMapViewportMetrics(mapEl);
  applyMapTransform();
  window.addEventListener('resize', () => {
    preserveMapViewportCenterOnResize(mapEl);
    applyMapTransform();
  });
  window.addEventListener('blur', () => {
    finishTransientMapInteractions({ flushDrag: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) finishTransientMapInteractions({ flushDrag: true });
  });

  mapEl.addEventListener('wheel', e => {
    if (_tokenSelectionState.active || _activeDragSession) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    const rect = mapEl.getBoundingClientRect();
    mapZoom(e.deltaY < 0 ? 1 : -1, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  let isPanning = false, panStartX, panStartY, panOriginX, panOriginY;
  let panSourceTokenId = '';
  let panMoved = false;

  mapEl.addEventListener('mousedown', e => {
    if (e.target.closest('.map-zoom') || e.target.closest('.map-add-token') || e.target.closest('.map-layer-btn') || e.target.closest('.map-control-btn') || e.target.closest('.vn-dialog')) return;

    if (e.button === 1 && !e.target.closest('.map-token')) {
      const rect = mapEl.getBoundingClientRect();
      _tokenSelectionState.active = true;
      _tokenSelectionState.startX = e.clientX - rect.left;
      _tokenSelectionState.startY = e.clientY - rect.top;
      _tokenSelectionState.currentX = _tokenSelectionState.startX;
      _tokenSelectionState.currentY = _tokenSelectionState.startY;
      updateTokenSelectionBox();
      e.preventDefault();
      return;
    }

    const mapTokenEl = e.target.closest('.map-token');
    if (mapTokenEl && !shouldPanMapFromLockedMapSettingToken(getTokenFromElement(mapTokenEl))) return;
    if (e.button !== 0) return;

    hideTokenMemoBubble();
    clearMultiTokenSelection();
    isPanning = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panOriginX = _mapPanX; panOriginY = _mapPanY;
    panSourceTokenId = mapTokenEl ? getTokenIdFromElement(mapTokenEl) : '';
    panMoved = false;
    mapEl.classList.add('panning');
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (_tokenSelectionState.active) {
      const rect = mapEl.getBoundingClientRect();
      _tokenSelectionState.currentX = e.clientX - rect.left;
      _tokenSelectionState.currentY = e.clientY - rect.top;
      updateTokenSelectionBox();
      return;
    }
    if (!isPanning) return;
    if (!panMoved && (Math.abs(e.clientX - panStartX) > 3 || Math.abs(e.clientY - panStartY) > 3)) {
      panMoved = true;
    }
    _mapPanX = roundMapNumber(panOriginX + (e.clientX - panStartX));
    _mapPanY = roundMapNumber(panOriginY + (e.clientY - panStartY));
    applyMapTransform();
  });

  document.addEventListener('mouseup', () => {
    if (_tokenSelectionState.active) finishTokenSelection();
    if (isPanning) {
      if (panMoved && panSourceTokenId) markSuppressPanelTokenClick(panSourceTokenId);
      isPanning = false;
      panSourceTokenId = '';
      panMoved = false;
      mapEl.classList.remove('panning');
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _tokenSelectionState.active) {
      _tokenSelectionState.active = false;
      hideTokenSelectionBox();
    }
  });

  mapEl.addEventListener('auxclick', e => {
    if (e.button === 1) e.preventDefault();
  });
});

let _tokenMemoBubbleEl = null;
let _tokenMemoBubbleTokenId = null;

function ensureTokenMemoBubble() {
  if (_tokenMemoBubbleEl) return _tokenMemoBubbleEl;
  const bubble = document.createElement('div');
  bubble.id = 'token-memo-bubble';
  bubble.style.cssText = [
    'position:fixed',
    'left:-9999px',
    'top:-9999px',
    'z-index:99999',
    'max-width:min(320px, calc(100vw - 32px))',
    'padding:8px 10px',
    'border-radius:10px',
    'background:var(--s1, #101010)',
    'color:#f3efe6',
    'font-size:12px',
    'line-height:1.5',
    'white-space:pre-wrap',
    'word-break:break-word',
    'box-shadow:0 8px 22px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.12), 0 0 8px rgba(255,255,255,0.22), 0 0 16px rgba(255,255,255,0.10)',
    'border:1px solid rgba(255,255,255,0.10)',
    'pointer-events:none',
    'opacity:0',
    'transform:translate(-50%, -100%)',
    'transition:opacity .08s ease'
  ].join(';');
  document.body.appendChild(bubble);
  _tokenMemoBubbleEl = bubble;
  return bubble;
}

function hideTokenMemoBubble() {
  if (!_tokenMemoBubbleEl) return;
  _tokenMemoBubbleEl.style.opacity = '0';
  _tokenMemoBubbleEl.style.left = '-9999px';
  _tokenMemoBubbleEl.style.top = '-9999px';
  _tokenMemoBubbleTokenId = null;
}

function positionTokenMemoBubble(tokenEl) {
  const bubble = ensureTokenMemoBubble();
  const rect = tokenEl.getBoundingClientRect();
  const bubbleRect = bubble.getBoundingClientRect();
  const gap = 12;
  let left = rect.left + (rect.width / 2);
  let top = rect.top - gap;
  const minX = 16 + bubbleRect.width / 2;
  const maxX = window.innerWidth - 16 - bubbleRect.width / 2;
  left = Math.max(minX, Math.min(maxX, left));
  if (top - bubbleRect.height < 12) {
    top = rect.bottom + bubbleRect.height + gap;
    bubble.style.transform = 'translate(-50%, 0)';
  } else {
    bubble.style.transform = 'translate(-50%, -100%)';
  }
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}


function getTokenOwnerDisplay(token) {
  if (!token?.ownerId) return '없음';
  const players = St.players || {};
  const owner = players[token.ownerId];
  const ownerName = token.ownerName || owner?.name || '알 수 없음';
  return token.ownerId === St.myId ? `${ownerName} (나)` : ownerName;
}

function refreshTokenOwnerBar(token) {
  const bar = document.getElementById('te-owner-bar');
  if (!bar) return;
  if (!token) {
    bar.style.display = 'none';
    bar.textContent = '';
    return;
  }
  bar.style.display = '';
  bar.innerHTML = `<span style="color:var(--muted)">소유자:</span> ${esc(getTokenOwnerDisplay(token))}`;
}

function showTokenMemoBubble(tokenEl, memo, tokenId) {
  const content = String(memo || '').trim();
  if (!content) return;
  const bubble = ensureTokenMemoBubble();
  bubble.textContent = content;
  positionTokenMemoBubble(tokenEl);
  bubble.style.opacity = '1';
  _tokenMemoBubbleTokenId = tokenId || null;
}

function createCharacterToken(name, type, options = {}) {
  if (!hasPerm('createToken')) { showToast('토큰 생성 권한이 없어요.'); return; }
  const id = genId();
  const token = {
    id,
    name: String(name || '?').trim() || '?',
    type: String(type || 'pc').trim() || 'pc',
    x: 48 + Math.random()*12,
    y: 48 + Math.random()*12,
    ownerId: St.myId || '',
    ownerName: St.myName || '',
    createdBy: St.myId || '',
    createdByName: St.myName || '',
    visibility: 'public',
  };
  if (window._FB?.CONFIGURED) {
    const { db, ref, set } = window._FB;
    set(ref(db, `rooms/${St.roomCode}/tokens/${id}`), token);
  } else {
    St.tokens[id] = token;
    renderAllTokens(St.tokens);
  }
  if (options.closeModal !== false) closeModal('modal-token');
  const nameInput = document.getElementById('token-name');
  if (nameInput) nameInput.value = '';
}

function addBlankCharacterToken() {
  createCharacterToken('?', 'pc', { closeModal: false });
}

function addToken() {
  const nameInput = document.getElementById('token-name');
  const typeInput = document.getElementById('token-type');
  createCharacterToken(nameInput?.value || '?', typeInput?.value || 'pc');
}

function addPanelToken() {
  if (!hasPerm('createToken')) { showToast('토큰 생성 권한이 없어요.'); return; }
  const input = document.getElementById('panel-token-name');
  const name = String(input?.value ?? '').trim();
  const id = genId();
  const token = {
    id,
    name,
    type: 'panel',
    tokenCategory: 'panel',
    panelToken: true,
    x: 50,
    y: 50,
    rotation: 0,
    ownerId: St.myId || '',
    ownerName: St.myName || '',
    createdBy: St.myId || '',
    createdByName: St.myName || '',
    visibility: 'public',
    panelFace: 'front',
    panelImage: '',
    panelBackImage: '',
    panelWidth: 240,
    panelHeight: 135,
    panelPriority: 1,
    panelLockPosition: false,
    panelLockSize: false,
    panelActionType: 'none',
    panelActionText: '',
  };
  St.tokens[id] = token;
  renderAllTokens(St.tokens);
  if (window._FB?.CONFIGURED) {
    const { db, ref, set } = window._FB;
    set(ref(db, `rooms/${St.roomCode}/tokens/${id}`), token).catch((err) => {
      console.error('panel token create failed', err);
      showToast('패널 토큰 생성에 실패했어요.');
    });
  }
  closeModal('modal-panel-token');
  if (input) input.value = '';
}

function renderAllTokens(tokens) {
  /* 드래그 중이면 전체 re-render를 보류 (드래그 끝나면 자동 실행) */
  if (_activeDragSession) {
    _pendingTokenRender = true;
    return;
  }
  _pendingTokenRender = false;
  hideTokenMemoBubble();
  const inner = document.getElementById('map-inner');
  if (inner) inner.querySelectorAll('.map-token').forEach(t => t.remove());
  syncMultiTokenSelectionWithTokens(tokens);
  Object.values(tokens).filter(shouldRenderTokenForCurrentUser).forEach(t => createTokenEl(t));
  updateMultiTokenSelectionUI();
  renderMapStatusPanel(tokens);
  /* 게임 화면 진입 후 맵 크기가 정상 반영되도록 보장 */
  applyMapTransform();
  if (Object.values(tokens || {}).some(isImportedMapSettingToken)) requestImportedMapLayerStateApply();
  if (typeof refreshQuickStandingMenuIfOpen === 'function') refreshQuickStandingMenuIfOpen();
}

/* ── Firebase onChild* 용 개별 토큰 업데이트 ── */

function getTokenRenderSignature(token) {
  return JSON.stringify({
    name: String(token?.name || ''),
    tokenImg: String(token?.tokenImg || ''),
    type: String(token?.type || ''),
    tokenCategory: String(token?.tokenCategory || ''),
    panelToken: !!token?.panelToken,
    tokenSize: Number(token?.tokenSize || 1),
    rotation: Number(token?.rotation || 0),
    memo: String(token?.memo || ''),
    standingAsToken: !!token?.standingAsToken,
    currentStandingLabel: String(token?.currentStandingLabel || ''),
    currentStandingJournalId: String(token?.currentStandingJournalId || ''),
    visibility: normalizeTokenVisibility(token),
    standingsKey: _standingsKey(token),
    panelFace: String(token?.panelFace || ''),
    panelImage: String(token?.panelImage || ''),
    panelBackImage: String(token?.panelBackImage || ''),
    panelWidth: Number(token?.panelWidth || 0),
    panelHeight: Number(token?.panelHeight || 0),
    panelPriority: Number(token?.panelPriority || 0),
    panelActionType: String(token?.panelActionType || ''),
    panelActionText: String(token?.panelActionText || ''),
    importedMapObjectHidden: !!token?.importedMapObjectHidden,
    importedLayoutKey: JSON.stringify(token?.importedMapObjectMeta?.layoutPct || null),
  });
}

function getTokenStatusSignature(token) {
  return JSON.stringify({
    ownerId: String(token?.ownerId || ''),
    ownerName: String(token?.ownerName || ''),
    hideList: !!token?.hideList,
    hideStatus: !!token?.hideStatus,
    initiative: token?.initiative ?? '',
    statuses: getRenderableStatuses(token).map((item) => ({
      label: String(item?.label || '').trim(),
      cur: item?.cur ?? '',
      max: item?.max ?? '',
    })),
    image: String(getTokenStatusPanelImage(token) || ''),
    name: String(token?.name || ''),
  });
}

function refreshTokenLiveSnapshot(el, token) {
  if (!el) return;
  el._tokenSnapshot = {
    renderSignature: getTokenRenderSignature(token),
    statusSignature: getTokenStatusSignature(token),
  };
}

function syncExistingTokenPosition(el, data) {
  if (!el || !data) return;
  el.style.left = storedTokenPercentToDisplay(data.x, 'x') + '%';
  el.style.top = storedTokenPercentToDisplay(data.y, 'y') + '%';
  if (data.rotation) el.style.transform = `translate(-50%,-50%) rotate(${data.rotation}deg)`;
  else el.style.transform = '';
}

function addOrUpdateSingleToken(id, data) {
  if (_activeDragSession && _activeDragSession.targetIds.includes(id)) {
    _pendingTokenRender = true;
    return;
  }

  const existing = getTokenEl(id);

  if (data && !shouldRenderTokenForCurrentUser(data)) {
    if (existing) existing.remove();
    removeMapStatusCard(id, St.tokens);
    syncMultiTokenSelectionWithTokens(St.tokens);
    updateMultiTokenSelectionUI();
    if (typeof refreshQuickStandingMenuForToken === 'function') refreshQuickStandingMenuForToken(id);
    return;
  }

  if (existing && data) {
    const prev = existing._tokenSnapshot || {};
    const nextRenderSignature = getTokenRenderSignature(data);
    const nextStatusSignature = getTokenStatusSignature(data);

    if (prev.renderSignature === nextRenderSignature) {
      syncExistingTokenPosition(existing, data);
      if (prev.statusSignature !== nextStatusSignature) {
        syncMapStatusCard(data, St.tokens);
      }
      refreshTokenLiveSnapshot(existing, data);
      if (_teTokenId === id) refreshTokenOwnerBar(data);
      requestImportedMapLayerStateApplyForToken(data);
      return;
    }
  }

  if (existing) existing.remove();
  if (data) {
    createTokenEl(data);
    syncMapStatusCard(data, St.tokens);
    requestImportedMapLayerStateApplyForToken(data);
    if (_teTokenId === id) refreshTokenOwnerBar(data);
  } else {
    removeMapStatusCard(id, St.tokens);
  }
  syncMultiTokenSelectionWithTokens(St.tokens);
  updateMultiTokenSelectionUI();
  if (typeof refreshQuickStandingMenuForToken === 'function') refreshQuickStandingMenuForToken(id);
}

/* 스탠딩 배열의 fingerprint (변경 감지용) */
function _standingsKey(t) {
  if (!Array.isArray(t?.standings) || !t.standings.length) return '';
  return t.standings.map(s => (s.label || '') + '|' + (s.img || '')).join(',');
}

function removeSingleToken(id) {
  cancelPanelTokenClickAction(id);
  if (_pteTokenId === id) closePanelTokenEdit();
  if (_activeDragSession && _activeDragSession.targetIds.includes(id)) {
    _pendingTokenRender = true;
    return;
  }
  const el = getTokenEl(id);
  if (el) el.remove();
  setMultiTokenSelection(_multiSelectedTokenIds.filter(x => x !== id));
  removeMapStatusCard(id, St.tokens);
}

let _activeDragCleanup = null;


function isTrueLike(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function getTokenIdFromElement(el) {
  const rawId = String(el?.id || '');
  return rawId ? rawId.replace(/^tok-/, '') : '';
}

function getTokenFromElement(el) {
  const tokenId = getTokenIdFromElement(el);
  return tokenId ? (St.tokens?.[tokenId] || null) : null;
}

function isImportedMapSettingToken(token) {
  if (!token) return false;
  if (token.importedMapObject === true) return true;
  if (token.importedMapObjectMeta && typeof token.importedMapObjectMeta === 'object') return true;
  const mapLayerId = String(token.mapLayerId || '').trim();
  if (mapLayerId.startsWith('object:')) return true;
  return false;
}

function isTokenPositionLocked(token) {
  if (!token) return false;
  const sourceMeta = token.importedMapObjectMeta?.sourceMeta || {};
  return !!(
    isTrueLike(token.panelLockPosition) ||
    isTrueLike(token.lockPosition) ||
    isTrueLike(token.positionLocked) ||
    isTrueLike(token.locked) ||
    isTrueLike(sourceMeta.locked) ||
    isTrueLike(sourceMeta.freezed)
  );
}

function shouldPanMapFromLockedMapSettingToken(token) {
  return isImportedMapSettingToken(token) && isTokenPositionLocked(token);
}

function shouldShowLockedTokenToast(token) {
  return isTokenPositionLocked(token) && !shouldPanMapFromLockedMapSettingToken(token);
}

let _mapLayerStateApplyHandle = null;
function requestImportedMapLayerStateApply() {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const applyFn = root?.applyMapLayerState || (typeof applyMapLayerState === 'function' ? applyMapLayerState : null);
  if (typeof applyFn !== 'function') return;
  if (_mapLayerStateApplyHandle !== null) return;

  const run = () => {
    _mapLayerStateApplyHandle = null;
    const latestApplyFn = root?.applyMapLayerState || (typeof applyMapLayerState === 'function' ? applyMapLayerState : null);
    if (typeof latestApplyFn !== 'function') return;
    try {
      latestApplyFn();
    } catch (err) {
      console.warn('applyMapLayerState after imported token render failed', err);
    }
  };

  if (typeof root?.requestAnimationFrame === 'function') {
    _mapLayerStateApplyHandle = root.requestAnimationFrame(run);
  } else if (typeof root?.setTimeout === 'function') {
    _mapLayerStateApplyHandle = root.setTimeout(run, 0);
  }
}

function requestImportedMapLayerStateApplyForToken(token) {
  if (!isImportedMapSettingToken(token)) return;
  requestImportedMapLayerStateApply();
}

function isPanelToken(token) {
  if (!token) return false;
  const type = String(token.type || '').trim();
  const category = String(token.tokenCategory || '').trim();
  if (type === 'panel' || category === 'panel' || token.panelToken === true) return true;
  if (token.importedMapObject === true) return true;
  if (token.panelImage || token.panelBackImage || token.panelWidth || token.panelHeight || token.panelFace) return true;
  return false;
}

function normalizeTokenVisibility(tokenOrValue) {
  const raw = typeof tokenOrValue === 'string' ? tokenOrValue : tokenOrValue?.visibility;
  return String(raw || '').trim() === 'private' ? 'private' : 'public';
}

function shouldRenderTokenForCurrentUser(token) {
  if (!token) return false;
  if (St?.isGM) return true;
  return normalizeTokenVisibility(token) !== 'private';
}

function getPanelTokenImageSource(token) {
  if (!isPanelToken(token)) return '';
  const face = String(token?.panelFace || 'front').trim() || 'front';
  if (face === 'back' && token?.panelBackImage) return String(token.panelBackImage || '').trim();
  return String(token?.panelImage || token?.panelBackImage || '').trim();
}


const PANEL_TOKEN_CLICK_DELAY_MS = 320;
let _panelTokenClickTimers = new Map();

function normalizePanelTokenActionType(value) {
  const type = String(value || 'none').trim().toLowerCase();
  return (type === 'chat' || type === 'macro') ? type : 'none';
}

function getPanelTokenAction(token) {
  const type = normalizePanelTokenActionType(token?.panelActionType);
  const text = String(token?.panelActionText || '').trim();
  if (type === 'none') return { type: 'none', text: '' };
  return { type, text };
}

function validatePanelTokenActionConfig(type, text, options = {}) {
  const silent = !!options.silent;
  const normalizedType = normalizePanelTokenActionType(type);
  const raw = String(text || '').trim();

  if (normalizedType === 'none') return true;
  if (!raw) {
    if (!silent) showToast('클릭 액션 내용을 입력해 주세요.');
    return false;
  }
  if (normalizedType === 'chat' && raw.startsWith('/')) {
    if (!silent) showToast('채팅 보내기에는 /로 시작하는 매크로를 넣을 수 없어요.');
    return false;
  }
  if (normalizedType === 'macro' && !raw.startsWith('/')) {
    if (!silent) showToast('매크로는 /로 시작해야 해요. 예: /1d10, /choice(a,b)');
    return false;
  }
  return true;
}

function cancelPanelTokenClickAction(tokenId) {
  const key = String(tokenId || '');
  if (!key) return;
  const timer = _panelTokenClickTimers.get(key);
  if (timer) clearTimeout(timer);
  _panelTokenClickTimers.delete(key);
}

function markSuppressPanelTokenClick(tokenId, ms = 420) {
  const el = getTokenEl(tokenId);
  if (el) el._suppressPanelClickUntil = Date.now() + ms;
  cancelPanelTokenClickAction(tokenId);
}

function markSuppressPanelTokenClicks(tokenIds, ms = 420) {
  (tokenIds || []).forEach((id) => markSuppressPanelTokenClick(id, ms));
}

async function sendPanelTokenChatMessage(text) {
  const raw = String(text || '').trim();
  if (!raw) return;

  if (St.speakAsJournalId && typeof loadJournals === 'function' && typeof saSendMessage === 'function') {
    const journal = loadJournals().find((j) => j.id === St.speakAsJournalId);
    if (journal) {
      await saSendMessage(journal, raw);
      return;
    }
    St.speakAsJournalId = null;
    if (typeof saRefreshBtn === 'function') saRefreshBtn();
  }

  if (typeof sendMessage === 'function') {
    await sendMessage(St.myName, raw, 'normal');
    return;
  }
  showToast('채팅 전송 함수를 찾지 못했어요.');
}

async function executePanelTokenAction(tokenId) {
  const token = St.tokens?.[tokenId];
  if (!isPanelToken(token)) return;
  if (St.tool === 'erase') return;

  const action = getPanelTokenAction(token);
  if (action.type === 'none') return;
  if (!validatePanelTokenActionConfig(action.type, action.text)) return;

  if (action.type === 'chat') {
    await sendPanelTokenChatMessage(action.text);
    return;
  }

  if (action.type === 'macro') {
    const choiceMatch = action.text.match(/^\/choice\s*[\(\（](.+)[\)\）]$/i);
    if (choiceMatch) {
      const options = choiceMatch[1].split(',').map((item) => item.trim()).filter(Boolean);
      if (options.length < 2) {
        showToast('choice 선택지를 2개 이상 입력해 주세요.');
        return;
      }
      const picked = options[Math.floor(Math.random() * options.length)];
      await sendPanelTokenChatMessage(`🎯 Choice [${options.join(', ')}] → ${picked}`);
      return;
    }

    const diceMatch = action.text.match(/^\/(\d*d\d+.*)$/i);
    if (diceMatch && typeof rollFromFormula === 'function') {
      rollFromFormula(diceMatch[1].trim());
      return;
    }

    showToast('지원하지 않는 매크로예요. 예: /1d10, /choice(a,b)');
  }
}

function schedulePanelTokenClickAction(tokenId, event) {
  const key = String(tokenId || '');
  if (!key) return;
  if (event && event.button != null && event.button !== 0) return;

  const token = St.tokens?.[key];
  if (!isPanelToken(token)) return;
  const action = getPanelTokenAction(token);
  if (action.type === 'none') return;

  const el = getTokenEl(key);
  if (el && Date.now() < Number(el._suppressPanelClickUntil || 0)) return;

  cancelPanelTokenClickAction(key);
  const timer = setTimeout(() => {
    _panelTokenClickTimers.delete(key);
    executePanelTokenAction(key).catch((err) => {
      console.error('panel token action failed', err);
      showToast('패널 토큰 액션 실행에 실패했어요.');
    });
  }, PANEL_TOKEN_CLICK_DELAY_MS);
  _panelTokenClickTimers.set(key, timer);
}

function applyPanelTokenSize(el, token) {
  if (!el || !token) return;
  const layout = token?.importedMapObjectMeta?.layoutPct || null;
  const widthPct = Number(layout?.width);
  const heightPct = Number(layout?.height);
  if (Number.isFinite(widthPct) && widthPct > 0 && Number.isFinite(heightPct) && heightPct > 0) {
    el.style.width = widthPct + '%';
    el.style.height = heightPct + '%';
    el.style.minWidth = '0';
    el.style.minHeight = '0';
    return;
  }
  const pxW = Math.max(24, Number(token?.panelWidth || 0) || 0);
  const pxH = Math.max(24, Number(token?.panelHeight || 0) || 0);
  if (pxW > 0) el.style.width = pxW + 'px';
  if (pxH > 0) el.style.height = pxH + 'px';
  el.style.minWidth = '0';
  el.style.minHeight = '0';
}

function createTokenEl(t) {
  const inner = document.getElementById('map-inner');
  const el = document.createElement('div');
  const isPanel = isPanelToken(t);
  el.className = `map-token ${isPanel ? 'panel-token' : ''} ${(!isPanel && t.type==='enemy')?'enemy':(!isPanel && t.type==='npc')?'npc':''}`.trim();
  el.id = 'tok-' + t.id;
  if (isPanel) {
    const priority = Number(t.panelPriority || 1);
    el.style.zIndex = String(Number.isFinite(priority) ? Math.max(1, priority) : 1);
    if (t.importedMapObjectHidden) el.style.display = 'none';
  }
  el.style.left = storedTokenPercentToDisplay(t.x, 'x') + '%'; el.style.top = storedTokenPercentToDisplay(t.y, 'y') + '%';
  if (t.rotation) el.style.transform = `translate(-50%,-50%) rotate(${t.rotation}deg)`;
  const sz = (t.tokenSize || 1);
  let tokenImgSrc = '';
  if (isPanel) {
    tokenImgSrc = getPanelTokenImageSource(t);
  } else if (t.standingAsToken && t.standings && t.standings.length > 0) {
    const jForToken = _allJournals.find(j => j.assignedTokenId === t.id);
    const syncedLabel = String(t.currentStandingLabel || '').trim();
    const localLabel = jForToken ? String((typeof _vnCurrentStanding !== 'undefined' ? _vnCurrentStanding : null)?.[jForToken.id] || '').trim() : '';
    const curLabel = syncedLabel || localLabel;
    const curStanding = curLabel ? t.standings.find(s => s.label === curLabel && s.img) : null;
    tokenImgSrc = curStanding ? curStanding.img : (t.standings.find(s => s.img)?.img || t.tokenImg || null);
    if (jForToken && syncedLabel && (typeof _vnCurrentStanding !== 'undefined' ? _vnCurrentStanding : null)) (typeof _vnCurrentStanding !== 'undefined' ? _vnCurrentStanding : null)[jForToken.id] = syncedLabel;
  } else {
    tokenImgSrc = t.tokenImg || '';
  }
  if (tokenImgSrc) {
    el.textContent = '';
    const img = document.createElement('img');
    img.src = tokenImgSrc;
    if (isPanel) {
      img.className = 'panel-token-display-img';
      img.style.cssText = 'width:100%;height:100%;object-fit:fill;pointer-events:none;display:block;';
      el.classList.add('panel-token-has-image');
      applyPanelTokenSize(el, t);
    } else {
      img.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none;';
      el.classList.add('has-img');
      const px = 36 * sz; el.style.width = px+'px'; el.style.height = 'auto'; el.style.minHeight = px+'px';
      const nameLabel = document.createElement('span');
      nameLabel.className = 'token-name-label';
      nameLabel.textContent = t.name || '';
      el.appendChild(nameLabel);
    }
    el.appendChild(img);
    if (isPanel) {
      if (!t.importedMapObject) {
        const panelName = String(t.name || '').trim();
        if (panelName) {
          const nameLabel = document.createElement('span');
          nameLabel.className = 'token-name-label';
          nameLabel.textContent = panelName;
          el.appendChild(nameLabel);
        }
      }
    }
  } else {
    el.textContent = isPanel ? String(t.name || '').trim() : t.name;
    if (isPanel) {
      applyPanelTokenSize(el, t);
    } else if (sz > 1) {
      const px = 36 * sz; el.style.width = px+'px'; el.style.height = px+'px'; el.style.fontSize = Math.max(9, 11*sz)+'px';
    }
  }
  if (_multiSelectedTokenIds.includes(String(t.id))) el.classList.add('multi-selected');
  const memoText = String(t.memo || '').trim();
  if (memoText) {
    el.addEventListener('mouseenter', () => showTokenMemoBubble(el, memoText, t.id));
    el.addEventListener('mousemove', () => {
      if (_tokenMemoBubbleTokenId === t.id) positionTokenMemoBubble(el);
    });
    el.addEventListener('mouseleave', () => {
      if (_tokenMemoBubbleTokenId === t.id) hideTokenMemoBubble();
    });
  }
  el.addEventListener('click', e => {
    if (!isPanelToken(t)) return;
    schedulePanelTokenClickAction(t.id, e);
  });
  el.addEventListener('dblclick', e => {
    e.preventDefault();
    e.stopPropagation();
    cancelPanelTokenClickAction(t.id);
    hideTokenMemoBubble();
    if (isPanelToken(t) && t.panelImage && t.panelBackImage) {
      togglePanelTokenFace(t.id);
      return;
    }
    if (typeof openTokenEdit === 'function') openTokenEdit(t.id);
  });
  el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); cancelPanelTokenClickAction(t.id); hideTokenMemoBubble(); showTokenCtx(e, t.id); });
  makeDraggable(el, t.id);
  refreshTokenLiveSnapshot(el, t);
  inner.appendChild(el);
  requestImportedMapLayerStateApplyForToken(t);
}

function makeDraggable(el, tokenId) {
  el.addEventListener('mousedown', e => {
    cancelPanelTokenClickAction(tokenId);
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      toggleTokenSelection(tokenId);
      return;
    }

    if (e.button !== 0) return;
    const dragToken = St.tokens[tokenId];
    if (shouldPanMapFromLockedMapSettingToken(dragToken)) {
      return;
    }
    if (!hasPerm('moveToken')) { showToast('토큰 이동 권한이 없어요.'); return; }
    if (St.tool === 'erase') { removeToken(tokenId); return; }
    if (shouldShowLockedTokenToast(dragToken)) {
      showToast('위치가 고정된 패널 토큰이에요.');
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    hideTokenMemoBubble();

    const map = document.getElementById('map-area');
    if (!map) return;

    const dragSession = buildTokenDragSession(tokenId, e);
    _activeDragSession = dragSession;

    let didMove = false;
    const onMove = ev => {
      if (!didMove && (Math.abs(ev.clientX - dragSession.startClientX) > 3 || Math.abs(ev.clientY - dragSession.startClientY) > 3)) {
        didMove = true;
      }
      applyTokenDragSession(dragSession, ev);
    };

    let finalized = false;
    const finalizeDrag = (options = {}) => {
      if (finalized) return;
      finalized = true;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (_activeDragCleanup === finalizeDrag) _activeDragCleanup = null;

      const shouldSave = options.save !== false;
      if (didMove) markSuppressPanelTokenClicks(dragSession.targetIds);
      const patch = (shouldSave && didMove) ? collectDraggedTokenPositions(dragSession.targetIds) : null;
      _activeDragSession = null;

      if (patch && Object.keys(patch).length) saveTokenPositionPatch(patch);
      syncMultiTokenSelectionWithTokens(St.tokens);

      if (_pendingTokenRender) {
        _pendingTokenRender = false;
        renderAllTokens(St.tokens);
      }
    };

    const onUp = () => finalizeDrag({ save: true });
    _activeDragCleanup = finalizeDrag;

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function removeToken(tokenId) {
  cancelPanelTokenClickAction(tokenId);
  if (!hasPerm('editToken')) { showToast('토큰 편집 권한이 없어요.'); return; }
  setMultiTokenSelection(_multiSelectedTokenIds.filter((id) => id !== tokenId));
  const el = getTokenEl(tokenId);
  if (el) el.remove();
  delete St.tokens[tokenId];
  syncMultiTokenSelectionWithTokens(St.tokens);
  removeMapStatusCard(tokenId, St.tokens);
  if (window._FB?.CONFIGURED) {
    const { db, ref, remove } = window._FB;
    remove(ref(db, `rooms/${St.roomCode}/tokens/${tokenId}`));
  }
}

let _ctxTokenId = null;

function showTokenCtx(e, tokenId) {
  if (!hasPerm('editToken')) { showToast('토큰 편집 권한이 없어요.'); return; }
  _ctxTokenId = tokenId;
  const menu = document.getElementById('tok-ctx');
  menu.classList.add('open');
  let x = e.clientX, y = e.clientY;
  const mw = menu.offsetWidth || 170, mh = menu.offsetHeight || 300;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
}

function hideTokenCtx() {
  document.getElementById('tok-ctx')?.classList.remove('open');
  _ctxTokenId = null;
}

document.addEventListener('click', () => hideTokenCtx());
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.map-token') && !e.target.closest('.tok-ctx')) hideTokenCtx();
});

function tokCtxAction(action) {
  const id = _ctxTokenId;
  hideTokenCtx();
  if (!id) return;
  const t = St.tokens[id];
  if (!t) return;

  switch (action) {
    case 'edit':
      if (isPanelToken(t)) openPanelTokenEdit(id);
      else openTokenEdit(id);
      break;
    case 'rotate': {
      t.rotation = ((t.rotation || 0) + 45) % 360;
      const el = getTokenEl(id);
      if (el) el.style.transform = `translate(-50%,-50%) rotate(${t.rotation}deg)`;
      if (window._FB?.CONFIGURED) {
        const { db, ref, update } = window._FB;
        update(ref(db, `rooms/${St.roomCode}/tokens/${id}`), { rotation: t.rotation });
      }
      break;
    }
    case 'toBack': {
      const el = getTokenEl(id);
      if (el) el.style.zIndex = '1';
      break;
    }
    case 'own': {
      t.ownerId = St.myId;
      t.ownerName = St.myName;
      refreshTokenOwnerBar(t);
      if (window._FB?.CONFIGURED) {
        const { db, ref, update } = window._FB;
        update(ref(db, `rooms/${St.roomCode}/tokens/${id}`), { ownerId: St.myId, ownerName: St.myName });
      }
      showToast(`${t.name} 토큰의 소유 권한을 가져왔어요.`);
      break;
    }
    case 'duplicate': {
      const newId = genId();
      const dup = JSON.parse(JSON.stringify(t));
      dup.id = newId; dup.x = (t.x || 50) + 2; dup.y = (t.y || 50) + 2;
      if (window._FB?.CONFIGURED) {
        const { db, ref, set } = window._FB;
        set(ref(db, `rooms/${St.roomCode}/tokens/${newId}`), dup);
      } else {
        St.tokens[newId] = dup; renderAllTokens(St.tokens);
      }
      showToast('토큰이 복제됐어요.');
      break;
    }
    case 'copy':
      navigator.clipboard?.writeText(JSON.stringify(t, null, 2)).then(() => showToast('토큰 데이터가 클립보드에 복사됐어요.')).catch(() => showToast('복사 실패'));
      break;
    case 'delete':
      if (!confirm(`'${t.name}' 토큰을 삭제할까요?`)) return;
      const delEl = getTokenEl(id);
      if (delEl) delEl.remove();
      delete St.tokens[id];
      syncMultiTokenSelectionWithTokens(St.tokens);
      removeMapStatusCard(id, St.tokens);
      if (window._FB?.CONFIGURED) {
        const { db, ref, remove } = window._FB;
        remove(ref(db, `rooms/${St.roomCode}/tokens/${id}`));
      }
      break;
    case 'copyId':
      navigator.clipboard?.writeText(id).then(() => showToast('토큰 ID 복사됨: ' + id)).catch(() => showToast('복사 실패'));
      break;
  }
}

let _teTokenId = null;
let _teTokenImgData = null;

function openTokenEdit(tokenId) {
  const t = St.tokens[tokenId];
  if (!t) return;
  if (isPanelToken(t)) {
    openPanelTokenEdit(tokenId);
    return;
  }
  _teTokenId = tokenId;

  refreshTokenOwnerBar(t);
  setTokenVisibilityToggleState('te-visibility-toggle', t.visibility || 'public');

  document.getElementById('te-name').value = t.name || '';
  document.getElementById('te-initiative').value = t.initiative || 0;
  document.getElementById('te-memo').value = t.memo || '';
  document.getElementById('te-size').value = t.tokenSize || 1;
  document.getElementById('te-x').value = Math.round((t.x || 0) * 10) / 10;
  document.getElementById('te-y').value = Math.round((t.y || 0) * 10) / 10;
  document.getElementById('te-url').value = t.refUrl || '';
  document.getElementById('te-chatpal').value = t.chatPalette || '';
  document.getElementById('te-hide-status').checked = t.hideStatus || false;
  document.getElementById('te-hide-chat').checked = t.hideChat || false;
  document.getElementById('te-hide-list').checked = t.hideList || false;
  document.getElementById('te-standing-as-token').checked = t.standingAsToken || false;

  _teTokenImgData = t.tokenImg || null;
  teRefreshTokenImgPreview();

  const sl = document.getElementById('te-standing-list');
  sl.innerHTML = '';
  (t.standings || []).forEach((s, i) => teAddStanding(s.label, s.img));

  const stl = document.getElementById('te-status-list');
  stl.innerHTML = '';
  (t.statuses || []).forEach(s => teAddStatus(s.label, s.cur, s.max));

  const pl = document.getElementById('te-param-list');
  pl.innerHTML = '';
  (t.params || []).forEach(p => teAddParam(p.label, p.value));

  document.getElementById('te-hint').textContent = '';
  document.getElementById('te-overlay').classList.add('open');
}

function closeTokenEdit() {
  cleanupTokenEditPendingAssets();
  document.getElementById('te-overlay').classList.remove('open');
  refreshTokenOwnerBar(null);
  _teTokenId = null;
  _teTokenImgData = null;
}

function setTokenVisibilityToggleState(toggleId, visibility) {
  const el = document.getElementById(toggleId);
  if (!el) return;
  const normalized = normalizeTokenVisibility(visibility);
  el.dataset.visibility = normalized;
  el.classList.toggle('is-private', normalized === 'private');
  el.classList.toggle('is-public', normalized !== 'private');
  el.style.display = St?.isGM ? 'inline-flex' : 'none';
}

function getTokenVisibilityToggleState(toggleId, fallback = 'public') {
  const el = document.getElementById(toggleId);
  return normalizeTokenVisibility(el?.dataset?.visibility || fallback);
}

function toggleTokenVisibilityDraft(kind) {
  if (!St?.isGM) return;
  const toggleId = kind === 'panel' ? 'pte-visibility-toggle' : 'te-visibility-toggle';
  const current = getTokenVisibilityToggleState(toggleId, 'public');
  setTokenVisibilityToggleState(toggleId, current === 'private' ? 'public' : 'private');
}

function teRefreshTokenImgPreview() {
  const wrap = document.getElementById('te-token-img');
  const txt = document.getElementById('te-token-img-text');
  const clearBtn = document.getElementById('te-img-clear');
  if (_teTokenImgData) {
    wrap.innerHTML = `<img src="${_teTokenImgData}" alt="token">`;
    if (clearBtn) clearBtn.style.display = '';
  } else {
    wrap.innerHTML = '<span id="te-token-img-text">📷</span>';
    if (clearBtn) clearBtn.style.display = 'none';
  }
}

async function teHandleTokenImg(input) {
  const file = input.files[0]; if (!file) return;
  if (file.size > 3*1024*1024) { showToast('이미지는 3MB 이하만 가능해요.'); return; }
  try {
    const blob = await makeTokenImageBlob(file, 800);
    revokeTokenPreviewUrl(_teTokenImgData);
    _teTokenImgBlob = blob;
    _teTokenImgData = URL.createObjectURL(blob);
    teRefreshTokenImgPreview();
  } catch (err) {
    console.error('token image prepare failed', err);
    showToast('토큰 이미지를 준비하지 못했어요. 다시 시도해 주세요.');
  } finally {
    input.value = '';
  }
}


function teClearTokenImg() {
  revokeTokenPreviewUrl(_teTokenImgData);
  _teTokenImgBlob = null;
  _teTokenImgData = null;
  teRefreshTokenImgPreview();
}

function teSetStandingRowImage(row, img, idx) {
  if (!row) return;
  const safeImg = img || '';
  row.dataset.img = safeImg;
  row.dataset.savedImg = safeImg;
  row.classList.toggle('has-img', !!safeImg);
  const thumb = row.querySelector('.te-st-thumb');
  if (thumb) {
    const thumbContent = safeImg
      ? `<img src="${esc(safeImg)}" alt="">`
      : `<span class="st-placeholder">📷</span>`;
    thumb.innerHTML = `${thumbContent}<input type="file" accept="image/*" style="display:none" onchange="teHandleStandingImg(this,${idx})">`;
  }
}

function teRefreshStandingIndexes() {
  const list = document.getElementById('te-standing-list');
  if (!list) return;
  Array.from(list.children).forEach((r, i) => {
    const fileInput = r.querySelector('input[type=file]');
    if (fileInput) fileInput.setAttribute('onchange', `teHandleStandingImg(this,${i})`);
    const delBtn = r.querySelector('.te-st-del');
    if (delBtn) delBtn.setAttribute('onclick', `teRemoveStandingAt(${i})`);
  });
}

function teAddStanding(label, img) {
  const list = document.getElementById('te-standing-list');
  const idx = list.children.length;
  const row = document.createElement('div');
  row.className = 'te-standing-row' + (img ? ' has-img' : '');
  row.dataset.img = img || '';
  row.dataset.savedImg = img || '';
  const thumbContent = img
    ? `<img src="${esc(img)}" alt="">`
    : `<span class="st-placeholder">📷</span>`;
  row.innerHTML = `
    <div class="te-st-thumb" onclick="this.querySelector('input[type=file]').click()" title="이미지 업로드">
      ${thumbContent}
      <input type="file" accept="image/*" style="display:none" onchange="teHandleStandingImg(this,${idx})">
    </div>
    <div class="te-st-fields">
      <label>라벨</label>
      <input placeholder="@미소" value="${esc(label||'')}">
    </div>
    <div class="te-st-actions">
      <button class="te-st-del" onclick="teRemoveStandingAt(${idx})" title="삭제">🗑</button>
      <span class="te-st-check">✓</span>
    </div>`;
  list.appendChild(row);
}
function teRemoveStanding() {
  const list = document.getElementById('te-standing-list');
  if (list.lastChild) list.removeChild(list.lastChild);
}
function teRemoveStandingAt(idx) {
  const list = document.getElementById('te-standing-list');
  const row = list.children[idx];
  if (row && confirm('이 스탠딩을 삭제할까요?')) {
    if (row._pendingPreviewUrl) revokeTokenPreviewUrl(row._pendingPreviewUrl);
    row.remove();
    teRefreshStandingIndexes();
  }
}
async function teHandleStandingImg(input, idx) {
  const file = input.files[0]; if (!file) return;
  if (file.size > 3*1024*1024) { showToast('이미지는 3MB 이하만 가능해요.'); return; }
  try {
    const blob = await makeTokenImageBlob(file, 800);
    const list = document.getElementById('te-standing-list');
    const row = list.children[idx];
    if (!row) return;
    if (row._pendingPreviewUrl) revokeTokenPreviewUrl(row._pendingPreviewUrl);
    const previewUrl = URL.createObjectURL(blob);
    row._pendingBlob = blob;
    row._pendingPreviewUrl = previewUrl;
    row.dataset.img = previewUrl;
    row.classList.add('has-img');
    const thumb = row.querySelector('.te-st-thumb');
    if (thumb) thumb.innerHTML = `<img src="${previewUrl}" alt=""><input type="file" accept="image/*" style="display:none" onchange="teHandleStandingImg(this,${idx})">`;
  } catch (err) {
    console.error('standing image prepare failed', err);
    showToast('스탠딩 이미지를 준비하지 못했어요. 다시 시도해 주세요.');
  } finally {
    input.value = '';
  }
}


function teAddStatus(label, cur, max) {
  const list = document.getElementById('te-status-list');
  const row = document.createElement('div');
  row.className = 'te-status-row';
  row.innerHTML = `
    <input style="flex:1" placeholder="라벨" value="${esc(label||'')}">
    <input style="width:55px" type="number" placeholder="현재값" value="${cur!=null?cur:''}">
    <input style="width:55px" type="number" placeholder="최대값" value="${max!=null?max:''}">`;
  list.appendChild(row);
}
function teRemoveStatus() {
  const list = document.getElementById('te-status-list');
  if (list.lastChild) list.removeChild(list.lastChild);
}

function teAddParam(label, value) {
  const list = document.getElementById('te-param-list');
  const row = document.createElement('div');
  row.className = 'te-param-row';
  row.innerHTML = `
    <input style="flex:1" placeholder="라벨" value="${esc(label||'')}">
    <input style="flex:1" placeholder="값" value="${esc(value||'')}">`;
  list.appendChild(row);
}
function teRemoveParam() {
  const list = document.getElementById('te-param-list');
  if (list.lastChild) list.removeChild(list.lastChild);
}

async function saveTokenEdit() {
  if (!_teTokenId) return;
  const originalToken = St.tokens[_teTokenId];
  if (!originalToken) return;
  const nextToken = {
    ...originalToken,
    statuses: Array.isArray(originalToken.statuses) ? originalToken.statuses.slice() : [],
    params: Array.isArray(originalToken.params) ? originalToken.params.slice() : [],
    standings: Array.isArray(originalToken.standings) ? originalToken.standings.slice() : [],
  };

  nextToken.name = document.getElementById('te-name').value.trim() || '?';
  nextToken.initiative = parseFloat(document.getElementById('te-initiative').value) || 0;
  nextToken.memo = document.getElementById('te-memo').value;
  nextToken.tokenSize = parseInt(document.getElementById('te-size').value) || 1;
  nextToken.x = parseFloat(document.getElementById('te-x').value) || originalToken.x;
  nextToken.y = parseFloat(document.getElementById('te-y').value) || originalToken.y;
  nextToken.refUrl = document.getElementById('te-url').value.trim();
  nextToken.chatPalette = document.getElementById('te-chatpal').value;
  nextToken.hideStatus = document.getElementById('te-hide-status').checked;
  nextToken.hideChat = document.getElementById('te-hide-chat').checked;
  nextToken.hideList = document.getElementById('te-hide-list').checked;
  nextToken.standingAsToken = document.getElementById('te-standing-as-token').checked;
  nextToken.visibility = St?.isGM ? getTokenVisibilityToggleState('te-visibility-toggle', originalToken.visibility || 'public') : normalizeTokenVisibility(originalToken);

  const hint = document.getElementById('te-hint');
  if (hint) hint.textContent = '이미지를 업로드하는 중이에요…';

  if (_teTokenImgBlob) {
    try {
      nextToken.tokenImg = await uploadTokenBlobToCloudinary(_teTokenImgBlob, `itc/tokens/${St.roomCode}`);
    } catch (err) {
      console.error('token image upload failed', err);
      if (hint) hint.textContent = '토큰 이미지 업로드에 실패했어요.';
      return;
    }
  } else if (_teTokenImgData && !_teTokenImgData.startsWith('blob:')) {
    nextToken.tokenImg = _teTokenImgData;
  } else if (!_teTokenImgData) {
    nextToken.tokenImg = null;
  }

  const standingRows = Array.from(document.getElementById('te-standing-list').querySelectorAll('.te-standing-row'));
  const nextStandings = [];
  const savedStandingImages = [];
  for (const [idx, row] of standingRows.entries()) {
    const inputs = row.querySelectorAll('input[type="text"],input:not([type])');
    const label = inputs[0]?.value?.trim() || '';
    const savedImg = row.dataset.savedImg || '';
    let img = row.dataset.img || savedImg || '';
    if (row._pendingBlob) {
      try {
        img = await uploadTokenBlobToCloudinary(row._pendingBlob, `itc/standings/${St.roomCode}`);
      } catch (err) {
        console.error('standing image upload failed', err);
        if (hint) hint.textContent = '스탠딩 이미지 업로드에 실패했어요.';
        return;
      }
    } else if (img.startsWith('blob:')) {
      // 저장 완료 후 같은 편집창에서 다시 저장하는 경우, revoke된 blob URL 때문에
      // 기존 이미지가 빈 값으로 덮이는 것을 막고 마지막 Cloudinary URL을 보존한다.
      img = savedImg || '';
    }
    savedStandingImages.push({ row, idx, img });
    if (label || img) nextStandings.push({ label, img });
  }
  nextToken.standings = nextStandings;

  nextToken.statuses = [];
  document.getElementById('te-status-list').querySelectorAll('.te-status-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const label = inputs[0]?.value?.trim() || '';
    const cur = parseFloat(inputs[1]?.value) || 0;
    const max = parseFloat(inputs[2]?.value) || 0;
    if (label) nextToken.statuses.push({ label, cur, max });
  });

  nextToken.params = [];
  document.getElementById('te-param-list').querySelectorAll('.te-param-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const label = inputs[0]?.value?.trim() || '';
    const value = inputs[1]?.value?.trim() || '';
    if (label) nextToken.params.push({ label, value });
  });

  try {
    if (window._FB?.CONFIGURED) {
      const { db, ref, set } = window._FB;
      await set(ref(db, `rooms/${St.roomCode}/tokens/${_teTokenId}`), nextToken);
    } else {
      St.tokens[_teTokenId] = nextToken;
      renderAllTokens(St.tokens);
    }
  } catch (err) {
    console.error('token save failed', err);
    if (hint) hint.textContent = '토큰 저장에 실패했어요.';
    return;
  }

  St.tokens[_teTokenId] = nextToken;
  savedStandingImages.forEach(({ row, idx, img }) => {
    if (row._pendingPreviewUrl) revokeTokenPreviewUrl(row._pendingPreviewUrl);
    row._pendingPreviewUrl = '';
    row._pendingBlob = null;
    teSetStandingRowImage(row, img, idx);
  });
  teRefreshStandingIndexes();
  if (hint) { hint.textContent = '저장됐어요 ✓'; setTimeout(() => { if(hint) hint.textContent=''; }, 2000); }
  cleanupTokenEditPendingAssets();
  _teTokenImgData = nextToken.tokenImg || null;
  _teTokenImgBlob = null;
  teRefreshTokenImgPreview();
}

function deleteTokenFromEdit() {
  if (!_teTokenId || !confirm('이 토큰을 삭제할까요?')) return;
  const delId = _teTokenId;
  closeTokenEdit();
  const el = document.getElementById('tok-' + delId);
  if (el) el.remove();
  delete St.tokens[delId];
  syncMultiTokenSelectionWithTokens(St.tokens);
  removeMapStatusCard(delId, St.tokens);
  if (window._FB?.CONFIGURED) {
    const { db, ref, remove } = window._FB;
    remove(ref(db, `rooms/${St.roomCode}/tokens/${delId}`));
  }
}


let _pteTokenId = null;
let _pteFrontData = null;
let _pteBackData = null;
let _pteFrontBlob = null;
let _pteBackBlob = null;
let _panelTokenAdvancedOpen = true;

function cleanupPanelTokenEditPendingAssets() {
  revokeTokenPreviewUrl(_pteFrontData);
  revokeTokenPreviewUrl(_pteBackData);
  _pteFrontData = null;
  _pteBackData = null;
  _pteFrontBlob = null;
  _pteBackBlob = null;
}

function setPanelTokenPreview(previewId, url, emptyText, clearFnName) {
  const wrap = document.getElementById(previewId);
  if (!wrap) return;
  wrap.classList.toggle('has-image', !!url);
  if (url) {
    wrap.innerHTML = `<img src="${esc(url)}" alt=""><button class="panel-token-preview-delete" type="button" onclick="event.stopPropagation(); ${clearFnName}()">×</button>`;
  } else {
    wrap.textContent = emptyText;
  }
}

function refreshPanelTokenPreviews() {
  setPanelTokenPreview('pte-front-preview', _pteFrontData, '이미지 없음', 'clearPanelTokenFrontImg');
  setPanelTokenPreview('pte-back-preview', _pteBackData, '뒷면 이미지 없음', 'clearPanelTokenBackImg');
}

function openPanelTokenEdit(tokenId) {
  const t = St.tokens[tokenId];
  if (!t) return;
  _pteTokenId = tokenId;
  setTokenVisibilityToggleState('pte-visibility-toggle', t.visibility || 'public');
  cleanupPanelTokenEditPendingAssets();
  _pteFrontData = t.panelImage || '';
  _pteBackData = t.panelBackImage || '';

  const setValue = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
  const setChecked = (id, value) => { const el = document.getElementById(id); if (el) el.checked = !!value; };
  setValue('pte-name', t.name || '');
  setValue('pte-width', Math.max(1, Number(t.panelWidth || 240) || 240));
  setValue('pte-height', Math.max(1, Number(t.panelHeight || 135) || 135));
  setValue('pte-priority', Math.max(1, Number(t.panelPriority || 1) || 1));
  setValue('pte-memo', t.memo || '');
  setChecked('pte-lock-pos', !!(t.panelLockPosition ?? t.lockPosition));
  setChecked('pte-lock-size', !!(t.panelLockSize ?? t.lockSize));
  setValue('pte-action-type', String(t.panelActionType || 'none'));
  setValue('pte-action-text', String(t.panelActionText || ''));
  refreshPanelTokenPreviews();
  syncPanelTokenLockUi();
  syncPanelTokenActionUi();
  openModal('modal-panel-token-edit');
}

function closePanelTokenEdit() {
  if (_pteTokenId) cancelPanelTokenClickAction(_pteTokenId);
  cleanupPanelTokenEditPendingAssets();
  _pteTokenId = null;
  closeModal('modal-panel-token-edit');
}

function syncPanelTokenLockUi() {
  const locked = !!document.getElementById('pte-lock-size')?.checked;
  ['pte-width', 'pte-height'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });
}

function syncPanelTokenActionUi() {
  const type = String(document.getElementById('pte-action-type')?.value || 'none');
  const wrap = document.getElementById('pte-action-text-wrap');
  const help = document.getElementById('pte-action-help');
  const label = document.getElementById('pte-action-text-label');
  if (wrap) wrap.style.display = type === 'none' ? 'none' : '';
  if (label) label.textContent = type === 'macro' ? 'Macro to run' : 'Text to be sent';
  if (help) {
    help.textContent = type === 'macro'
      ? '패널 클릭 시 매크로/다이스 명령을 실행합니다.'
      : type === 'chat'
        ? '패널 클릭 시 입력한 문장을 채팅으로 보냅니다.'
        : '패널 클릭 시 별도 동작을 하지 않습니다.';
  }
}

function togglePanelTokenAdvanced() {
  _panelTokenAdvancedOpen = !_panelTokenAdvancedOpen;
  const body = document.getElementById('panel-token-advanced-body');
  const arrow = document.getElementById('panel-token-advanced-arrow');
  if (body) body.style.display = _panelTokenAdvancedOpen ? '' : 'none';
  if (arrow) arrow.textContent = _panelTokenAdvancedOpen ? '▴' : '▾';
}

async function preparePanelTokenImage(input, side) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('이미지는 5MB 이하만 가능해요.'); input.value = ''; return; }
  try {
    const blob = await makeTokenImageBlob(file, 1600);
    const previewUrl = URL.createObjectURL(blob);
    if (side === 'front') {
      revokeTokenPreviewUrl(_pteFrontData);
      _pteFrontBlob = blob;
      _pteFrontData = previewUrl;
    } else {
      revokeTokenPreviewUrl(_pteBackData);
      _pteBackBlob = blob;
      _pteBackData = previewUrl;
    }
    refreshPanelTokenPreviews();
  } catch (err) {
    console.error('panel token image prepare failed', err);
    showToast('패널 이미지를 준비하지 못했어요. 다시 시도해 주세요.');
  } finally {
    input.value = '';
  }
}

function handlePanelTokenFrontImg(input) { preparePanelTokenImage(input, 'front'); }
function handlePanelTokenBackImg(input) { preparePanelTokenImage(input, 'back'); }
function clearPanelTokenFrontImg() { revokeTokenPreviewUrl(_pteFrontData); _pteFrontData = ''; _pteFrontBlob = null; refreshPanelTokenPreviews(); }
function clearPanelTokenBackImg() { revokeTokenPreviewUrl(_pteBackData); _pteBackData = ''; _pteBackBlob = null; refreshPanelTokenPreviews(); }

async function savePanelTokenEdit() {
  if (!_pteTokenId) return;
  const t = St.tokens[_pteTokenId];
  if (!t) return;
  const name = String(document.getElementById('pte-name')?.value ?? '').trim();
  const width = Math.max(1, Number(document.getElementById('pte-width')?.value || t.panelWidth || 240) || 240);
  const height = Math.max(1, Number(document.getElementById('pte-height')?.value || t.panelHeight || 135) || 135);
  const priority = Math.max(1, Number(document.getElementById('pte-priority')?.value || t.panelPriority || 1) || 1);
  let frontUrl = _pteFrontData || '';
  let backUrl = _pteBackData || '';

  try {
    if (_pteFrontBlob) frontUrl = await uploadTokenBlobToCloudinary(_pteFrontBlob, `itc/panels/${St.roomCode}`);
    else if (frontUrl.startsWith('blob:')) frontUrl = t.panelImage || '';
    if (_pteBackBlob) backUrl = await uploadTokenBlobToCloudinary(_pteBackBlob, `itc/panels/${St.roomCode}`);
    else if (backUrl.startsWith('blob:')) backUrl = t.panelBackImage || '';
  } catch (err) {
    console.error('panel token image upload failed', err);
    showToast('패널 이미지 업로드에 실패했어요.');
    return;
  }

  const actionType = normalizePanelTokenActionType(document.getElementById('pte-action-type')?.value || 'none');
  const actionText = String(document.getElementById('pte-action-text')?.value || '').trim();
  if (!validatePanelTokenActionConfig(actionType, actionText)) return;

  const next = {
    ...t,
    name,
    type: 'panel',
    tokenCategory: 'panel',
    panelToken: true,
    memo: document.getElementById('pte-memo')?.value || '',
    visibility: St?.isGM ? getTokenVisibilityToggleState('pte-visibility-toggle', t.visibility || 'public') : normalizeTokenVisibility(t),
    panelWidth: width,
    panelHeight: height,
    panelPriority: priority,
    panelImage: frontUrl,
    panelBackImage: backUrl,
    panelFace: (t.panelFace === 'back' && backUrl) ? 'back' : 'front',
    panelLockPosition: !!document.getElementById('pte-lock-pos')?.checked,
    panelLockSize: !!document.getElementById('pte-lock-size')?.checked,
    panelActionType: actionType,
    panelActionText: actionType === 'none' ? '' : actionText,
  };

  St.tokens[_pteTokenId] = next;
  addOrUpdateSingleToken(_pteTokenId, next);
  if (window._FB?.CONFIGURED) {
    const { db, ref, set } = window._FB;
    try {
      await set(ref(db, `rooms/${St.roomCode}/tokens/${_pteTokenId}`), next);
    } catch (err) {
      console.error('panel token save failed', err);
      showToast('패널 토큰 저장에 실패했어요.');
      return;
    }
  }
  cleanupPanelTokenEditPendingAssets();
  _pteFrontData = next.panelImage || '';
  _pteBackData = next.panelBackImage || '';
  showToast('패널 토큰이 저장됐어요.');
}

function deletePanelTokenFromEdit() {
  if (!_pteTokenId || !confirm('이 패널 토큰을 삭제할까요?')) return;
  const id = _pteTokenId;
  closePanelTokenEdit();
  removeToken(id);
}

function togglePanelTokenFace(tokenId) {
  const t = St.tokens[tokenId];
  if (!isPanelToken(t) || !t.panelBackImage) return;
  const nextFace = String(t.panelFace || 'front') === 'back' ? 'front' : 'back';
  t.panelFace = nextFace;
  addOrUpdateSingleToken(tokenId, t);
  if (window._FB?.CONFIGURED) {
    const { db, ref, update } = window._FB;
    update(ref(db, `rooms/${St.roomCode}/tokens/${tokenId}`), { panelFace: nextFace }).catch((err) => console.error('panel face update failed', err));
  }
}

function setTool(t) {
  if (t === 'erase' && !hasPerm('editToken')) { showToast('토큰 편집 권한이 없어요.'); return; }
  St.tool = t;
  document.getElementById('tool-select').classList.toggle('on', t === 'select');
  const eraseBtn = document.getElementById('tool-erase');
  if (eraseBtn) eraseBtn.classList.toggle('on', t === 'erase');
}



window.addEventListener('scroll', () => hideTokenMemoBubble(), true);
