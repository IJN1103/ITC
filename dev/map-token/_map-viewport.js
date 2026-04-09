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
  if (!token || token.hideList) return false;
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
      isPanning = false;
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
    e.preventDefault();
    const rect = mapEl.getBoundingClientRect();
    mapZoom(e.deltaY < 0 ? 1 : -1, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  let isPanning = false, panStartX, panStartY, panOriginX, panOriginY;

  mapEl.addEventListener('mousedown', e => {
    if (e.target.closest('.map-zoom') || e.target.closest('.map-add-token') || e.target.closest('.vn-dialog')) return;

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

    if (e.target.closest('.map-token')) return;
    if (e.button !== 0) return;

    hideTokenMemoBubble();
    clearMultiTokenSelection();
    isPanning = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panOriginX = _mapPanX; panOriginY = _mapPanY;
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
    _mapPanX = roundMapNumber(panOriginX + (e.clientX - panStartX));
    _mapPanY = roundMapNumber(panOriginY + (e.clientY - panStartY));
    applyMapTransform();
  });

  document.addEventListener('mouseup', () => {
    if (_tokenSelectionState.active) finishTokenSelection();
    if (isPanning) { isPanning = false; mapEl.classList.remove('panning'); }
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
