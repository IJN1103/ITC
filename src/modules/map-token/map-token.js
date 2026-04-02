/**
 * ITC TRPG — Map Token
 * 토큰 CRUD, 렌더, 드래그, 선택, 상태패널, 메모, 컨텍스트메뉴
 */

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

function getTokenRenderSignature(token) {
  return JSON.stringify({
    name: String(token?.name || ''),
    tokenImg: String(token?.tokenImg || ''),
    type: String(token?.type || ''),
    tokenSize: Number(token?.tokenSize || 1),
    rotation: Number(token?.rotation || 0),
    memo: String(token?.memo || ''),
    standingAsToken: !!token?.standingAsToken,
    standingsKey: _standingsKey(token),
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
  if (_activeDragSession && _activeDragSession.targetIds.includes(id)) return;

  const existing = getTokenEl(id);

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
      return;
    }
  }

  if (existing) existing.remove();
  if (data) {
    createTokenEl(data);
    syncMapStatusCard(data, St.tokens);
    if (_teTokenId === id) refreshTokenOwnerBar(data);
  } else {
    removeMapStatusCard(id, St.tokens);
  }
  syncMultiTokenSelectionWithTokens(St.tokens);
  updateMultiTokenSelectionUI();
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
  removeMapStatusCard(id, St.tokens);
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
  refreshTokenLiveSnapshot(el, t);
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

