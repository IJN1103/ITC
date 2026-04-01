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

function renderMapStatusPanel(tokens = St.tokens) {
  const panel = document.getElementById('map-status-panel');
  if (!panel) return;
  const items = Object.values(tokens || {})
    .filter((token) => shouldShowTokenInStatusPanel(token))
    .sort((a, b) => Number(b?.initiative || 0) - Number(a?.initiative || 0));

  if (!items.length) {
    panel.innerHTML = '';
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'grid';
  panel.innerHTML = items.map((token) => {
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
    return `
      <div class="${cardClass}" data-token-id="${esc(String(token.id || ''))}">
        <div class="map-status-headbox">
          <div class="map-status-avatar-wrap">
            <div class="map-status-avatar">${imageHtml}</div>
            ${initiativeHtml}
          </div>
        </div>
        ${statsGridHtml}
      </div>`;
  }).join('');
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

function addToken() {
  if (!hasPerm('createToken')) { showToast('토큰 생성 권한이 없어요.'); return; }
  const name = document.getElementById('token-name').value.trim() || '?';
  const type = document.getElementById('token-type').value;
  const id = genId();
  const token = {
    id,
    name,
    type,
    x: 48 + Math.random()*12,
    y: 48 + Math.random()*12,
    ownerId: St.myId || '',
    ownerName: St.myName || '',
    createdBy: St.myId || '',
    createdByName: St.myName || '',
  };
  if (window._FB?.CONFIGURED) {
    const { db, ref, set } = window._FB;
    set(ref(db, `rooms/${St.roomCode}/tokens/${id}`), token);
  } else { St.tokens[id] = token; renderAllTokens(St.tokens); }
  closeModal('modal-token');
  document.getElementById('token-name').value = '';
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
  Object.values(tokens).forEach(t => createTokenEl(t));
  updateMultiTokenSelectionUI();
  renderMapStatusPanel(tokens);
  /* 게임 화면 진입 후 맵 크기가 정상 반영되도록 보장 */
  applyMapTransform();
}

/* ── Firebase onChild* 용 개별 토큰 업데이트 ── */

function addOrUpdateSingleToken(id, data) {
  if (_activeDragSession && _activeDragSession.targetIds.includes(id)) return;

  const existing = getTokenEl(id);

  /* ── fast path: 기존 요소가 있고 위치만 바뀐 경우 DOM 재생성 없이 처리 ── */
  if (existing && data) {
    const prev = existing._tokenSnapshot;
    if (prev
      && prev.name === (data.name || '')
      && prev.tokenImg === (data.tokenImg || '')
      && prev.type === (data.type || '')
      && prev.tokenSize === (data.tokenSize || 1)
      && prev.rotation === (data.rotation || 0)
      && prev.memo === (data.memo || '')
      && prev.standingAsToken === (!!data.standingAsToken)
      && prev.standingsKey === _standingsKey(data)
    ) {
      /* 위치만 갱신 */
      existing.style.left = storedTokenPercentToDisplay(data.x, 'x') + '%';
      existing.style.top = storedTokenPercentToDisplay(data.y, 'y') + '%';
      return;
    }
  }

  /* ── safe path: 구조 변경 → 완전 재생성 ── */
  if (existing) existing.remove();
  if (data) createTokenEl(data);
  syncMultiTokenSelectionWithTokens(St.tokens);
  updateMultiTokenSelectionUI();
  renderMapStatusPanel(St.tokens);
}

/* 스탠딩 배열의 fingerprint (변경 감지용) */
function _standingsKey(t) {
  if (!Array.isArray(t?.standings) || !t.standings.length) return '';
  return t.standings.map(s => (s.label || '') + '|' + (s.img || '')).join(',');
}

function removeSingleToken(id) {
  const el = getTokenEl(id);
  if (el) el.remove();
  setMultiTokenSelection(_multiSelectedTokenIds.filter(x => x !== id));
  renderMapStatusPanel(St.tokens);
}

function createTokenEl(t) {
  const inner = document.getElementById('map-inner');
  const el = document.createElement('div');
  el.className = `map-token ${t.type==='enemy'?'enemy':t.type==='npc'?'npc':''}`;
  el.id = 'tok-' + t.id;
  el.style.left = storedTokenPercentToDisplay(t.x, 'x') + '%'; el.style.top = storedTokenPercentToDisplay(t.y, 'y') + '%';
  if (t.rotation) el.style.transform = `translate(-50%,-50%) rotate(${t.rotation}deg)`;
  const sz = (t.tokenSize || 1);
  let tokenImgSrc = null;
  if (t.standingAsToken && t.standings && t.standings.length > 0) {
    const jForToken = _allJournals.find(j => j.assignedTokenId === t.id);
    const curLabel = jForToken ? _vnCurrentStanding[jForToken.id] : null;
    const curStanding = curLabel ? t.standings.find(s => s.label === curLabel && s.img) : null;
    tokenImgSrc = curStanding ? curStanding.img : (t.standings.find(s => s.img)?.img || t.tokenImg || null);
  } else {
    tokenImgSrc = t.tokenImg || null;
  }
  if (tokenImgSrc) {
    el.textContent = '';
    const img = document.createElement('img');
    img.src = tokenImgSrc;
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none;';
    el.appendChild(img);
    el.classList.add('has-img');
    const px = 36 * sz; el.style.width = px+'px'; el.style.height = 'auto'; el.style.minHeight = px+'px';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'token-name-label';
    nameLabel.textContent = t.name || '';
    el.appendChild(nameLabel);
  } else {
    el.textContent = t.name;
    if (sz > 1) { const px = 36 * sz; el.style.width = px+'px'; el.style.height = px+'px'; el.style.fontSize = Math.max(9, 11*sz)+'px'; }
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
  el.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); hideTokenMemoBubble(); if (typeof openTokenEdit === 'function') openTokenEdit(t.id); });
  el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); hideTokenMemoBubble(); showTokenCtx(e, t.id); });
  makeDraggable(el, t.id);
  /* fast path 비교용 스냅샷 저장 */
  el._tokenSnapshot = {
    name: t.name || '', tokenImg: t.tokenImg || '', type: t.type || '',
    tokenSize: t.tokenSize || 1, rotation: t.rotation || 0, memo: t.memo || '',
    standingAsToken: !!t.standingAsToken, standingsKey: _standingsKey(t),
  };
  inner.appendChild(el);
}

function makeDraggable(el, tokenId) {
  el.addEventListener('mousedown', e => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      toggleTokenSelection(tokenId);
      return;
    }

    if (e.button !== 0) return;
    if (!hasPerm('moveToken')) { showToast('토큰 이동 권한이 없어요.'); return; }
    if (St.tool === 'erase') { removeToken(tokenId); return; }

    e.preventDefault();
    e.stopPropagation();
    hideTokenMemoBubble();

    const map = document.getElementById('map-area');
    if (!map) return;

    const dragSession = buildTokenDragSession(tokenId, e);
    _activeDragSession = dragSession; // ← 드래그 시작 표시

    const onMove = ev => {
      applyTokenDragSession(dragSession, ev);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      const patch = collectDraggedTokenPositions(dragSession.targetIds);
      _activeDragSession = null; // ← 드래그 종료 표시 (saveTokenPositionPatch 전에 해제)

      saveTokenPositionPatch(patch);
      syncMultiTokenSelectionWithTokens(St.tokens);

      /* 드래그 중 보류되었던 renderAllTokens 실행 */
      if (_pendingTokenRender) {
        _pendingTokenRender = false;
        renderAllTokens(St.tokens);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function removeToken(tokenId) {
  if (!hasPerm('editToken')) { showToast('토큰 편집 권한이 없어요.'); return; }
  setMultiTokenSelection(_multiSelectedTokenIds.filter((id) => id !== tokenId));
  const el = getTokenEl(tokenId);
  if (el) el.remove();
  delete St.tokens[tokenId];
  syncMultiTokenSelectionWithTokens(St.tokens);
  renderMapStatusPanel(St.tokens);
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
      openTokenEdit(id);
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
      renderMapStatusPanel(St.tokens);
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
  _teTokenId = tokenId;
  const t = St.tokens[tokenId];
  if (!t) return;

  refreshTokenOwnerBar(t);

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

function teAddStanding(label, img) {
  const list = document.getElementById('te-standing-list');
  const idx = list.children.length;
  const row = document.createElement('div');
  row.className = 'te-standing-row' + (img ? ' has-img' : '');
  if (img) row.dataset.img = img;
  const thumbContent = img
    ? `<img src="${img}" alt="">`
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
    row.remove();
    Array.from(list.children).forEach((r, i) => {
      const fileInput = r.querySelector('input[type=file]');
      if (fileInput) fileInput.setAttribute('onchange', `teHandleStandingImg(this,${i})`);
      const delBtn = r.querySelector('.te-st-del');
      if (delBtn) delBtn.setAttribute('onclick', `teRemoveStandingAt(${i})`);
    });
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
  const t = St.tokens[_teTokenId];
  if (!t) return;

  t.name = document.getElementById('te-name').value.trim() || '?';
  t.initiative = parseFloat(document.getElementById('te-initiative').value) || 0;
  t.memo = document.getElementById('te-memo').value;
  t.tokenSize = parseInt(document.getElementById('te-size').value) || 1;
  t.x = parseFloat(document.getElementById('te-x').value) || t.x;
  t.y = parseFloat(document.getElementById('te-y').value) || t.y;
  t.refUrl = document.getElementById('te-url').value.trim();
  t.chatPalette = document.getElementById('te-chatpal').value;
  t.hideStatus = document.getElementById('te-hide-status').checked;
  t.hideChat = document.getElementById('te-hide-chat').checked;
  t.hideList = document.getElementById('te-hide-list').checked;
  t.standingAsToken = document.getElementById('te-standing-as-token').checked;

  const hint = document.getElementById('te-hint');
  if (hint) hint.textContent = '이미지를 업로드하는 중이에요…';

  if (_teTokenImgBlob) {
    try {
      t.tokenImg = await uploadTokenBlobToCloudinary(_teTokenImgBlob, `itc/tokens/${St.roomCode}`);
    } catch (err) {
      console.error('token image upload failed', err);
      if (hint) hint.textContent = '토큰 이미지 업로드에 실패했어요.';
      return;
    }
  } else if (_teTokenImgData && !_teTokenImgData.startsWith('blob:')) {
    t.tokenImg = _teTokenImgData;
  } else if (!_teTokenImgData) {
    t.tokenImg = null;
  }

  t.standings = [];
  const standingRows = Array.from(document.getElementById('te-standing-list').querySelectorAll('.te-standing-row'));
  for (const row of standingRows) {
    const inputs = row.querySelectorAll('input[type="text"],input:not([type])');
    const label = inputs[0]?.value?.trim() || '';
    let img = row.dataset.img || '';
    if (row._pendingBlob) {
      try {
        img = await uploadTokenBlobToCloudinary(row._pendingBlob, `itc/standings/${St.roomCode}`);
      } catch (err) {
        console.error('standing image upload failed', err);
        if (hint) hint.textContent = '스탠딩 이미지 업로드에 실패했어요.';
        return;
      }
    } else if (img.startsWith('blob:')) {
      img = '';
    }
    if (label || img) t.standings.push({ label, img });
  }

  t.statuses = [];
  document.getElementById('te-status-list').querySelectorAll('.te-status-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const label = inputs[0]?.value?.trim() || '';
    const cur = parseFloat(inputs[1]?.value) || 0;
    const max = parseFloat(inputs[2]?.value) || 0;
    if (label) t.statuses.push({ label, cur, max });
  });

  t.params = [];
  document.getElementById('te-param-list').querySelectorAll('.te-param-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const label = inputs[0]?.value?.trim() || '';
    const value = inputs[1]?.value?.trim() || '';
    if (label) t.params.push({ label, value });
  });

  if (window._FB?.CONFIGURED) {
    const { db, ref, set } = window._FB;
    set(ref(db, `rooms/${St.roomCode}/tokens/${_teTokenId}`), t);
  } else {
    renderAllTokens(St.tokens);
  }

  if (hint) { hint.textContent = '저장됐어요 ✓'; setTimeout(() => { if(hint) hint.textContent=''; }, 2000); }
  cleanupTokenEditPendingAssets();
  _teTokenImgData = t.tokenImg || null;
  _teTokenImgBlob = null;
}

function deleteTokenFromEdit() {
  if (!_teTokenId || !confirm('이 토큰을 삭제할까요?')) return;
  const delId = _teTokenId;
  closeTokenEdit();
  const el = document.getElementById('tok-' + delId);
  if (el) el.remove();
  delete St.tokens[delId];
  syncMultiTokenSelectionWithTokens(St.tokens);
  renderMapStatusPanel(St.tokens);
  if (window._FB?.CONFIGURED) {
    const { db, ref, remove } = window._FB;
    remove(ref(db, `rooms/${St.roomCode}/tokens/${delId}`));
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
