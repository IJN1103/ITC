/**
 * ITC TRPG — Map Viewport
 * 좌표계, 줌/팬, transform, 맵 이벤트
 */

let _mapScale = 1;
let _mapPanX = 0, _mapPanY = 0;

const MAP_LOGICAL_WIDTH = 1600;
const MAP_LOGICAL_HEIGHT = 900;

let _mapBaseWidth = MAP_LOGICAL_WIDTH;
let _mapBaseHeight = MAP_LOGICAL_HEIGHT;

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

function getTokenStoredPercentMax(axis = 'x') {
  return 100;
}

function clampTokenStoredPercent(value, axis = 'x') {
  return Math.max(0, Math.min(getTokenStoredPercentMax(axis), Number(value) || 0));
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



function applyMapTransform() {
  const inner = document.getElementById('map-inner');
  const map = document.getElementById('map-area');
  if (!inner || !map) return;
  const { width: baseW, height: baseH } = refreshMapBaseSize();
  inner.style.width = baseW + 'px';
  inner.style.height = baseH + 'px';
  inner.style.transformOrigin = '0 0';
  inner.style.transform = `translate(${_mapPanX}px,${_mapPanY}px) scale(${_mapScale})`;
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
  _mapScale = Math.max(0.2, Math.min(4, _mapScale + dir * 0.15));
  const ratio = _mapScale / prevScale;
  _mapPanX = cx - ratio * (cx - _mapPanX);
  _mapPanY = cy - ratio * (cy - _mapPanY);
  applyMapTransform();
}

document.addEventListener('DOMContentLoaded', () => {
  const mapEl = document.getElementById('map-area');
  if (!mapEl) return;

  refreshMapBaseSize();
  applyMapTransform();
  window.addEventListener('resize', () => {
    applyMapTransform();
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
    _mapPanX = panOriginX + (e.clientX - panStartX);
    _mapPanY = panOriginY + (e.clientY - panStartY);
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
