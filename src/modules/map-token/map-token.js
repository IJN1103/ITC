/**
 * ITC TRPG — Map + Token 모듈
 * 맵 줌/팬, 토큰 CRUD/드래그/편집
 */

let _mapScale = 1;
let _mapPanX = 0, _mapPanY = 0;


let _teTokenImgBlob = null;

function getCloudinaryConfigForToken() {
  const cfg = window._ITC_CLOUDINARY || {};
  if (!cfg.cloudName || !cfg.unsignedPreset) return null;
  return cfg;
}

function mapTokenWithTimeout(promise, ms = 15000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('timeout'));
    }, ms);
    Promise.resolve(promise).then((value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    }).catch((err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function mapTokenCanvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('blob 생성 실패'));
    }, type, quality);
  });
}

async function makeTokenImageBlob(file, max = 800) {
  const bmp = await createImageBitmap(file);
  try {
    let w = bmp.width, h = bmp.height;
    if (w > max || h > max) {
      const r = Math.min(max / w, max / h);
      w = Math.round(w * r);
      h = Math.round(h * r);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const isPng = /png/i.test(file.type || '');
    return await mapTokenCanvasToBlob(canvas, isPng ? 'image/png' : 'image/jpeg', isPng ? undefined : 0.9);
  } finally {
    if (bmp && typeof bmp.close === 'function') bmp.close();
  }
}

async function uploadTokenBlobToCloudinary(blob, folder = 'itc/tokens') {
  const cfg = getCloudinaryConfigForToken();
  if (!cfg) return null;
  const form = new FormData();
  form.append('file', blob);
  form.append('upload_preset', cfg.unsignedPreset);
  form.append('folder', folder);
  const url = `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`;
  const res = await mapTokenWithTimeout(fetch(url, { method: 'POST', body: form }), 20000);
  if (!res.ok) throw new Error(`cloudinary upload failed: ${res.status}`);
  const json = await res.json();
  if (!json?.secure_url) throw new Error('cloudinary secure_url missing');
  return json.secure_url;
}

function revokeTokenPreviewUrl(url) {
  if (url && String(url).startsWith('blob:')) {
    try { URL.revokeObjectURL(url); } catch (e) {}
  }
}

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

function updateMultiTokenSelectionUI() {
  document.querySelectorAll('.map-token.multi-selected').forEach((el) => el.classList.remove('multi-selected'));
  _multiSelectedTokenIds.forEach((id) => {
    document.getElementById('tok-' + id)?.classList.add('multi-selected');
  });
}

function clearMultiTokenSelection() {
  _multiSelectedTokenIds = [];
  updateMultiTokenSelectionUI();
}

function setMultiTokenSelection(ids) {
  _multiSelectedTokenIds = Array.from(new Set((ids || []).filter(Boolean)));
  updateMultiTokenSelectionUI();
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
  setMultiTokenSelection(selected);
}

function applyMapTransform() {
  const inner = document.getElementById('map-inner');
  if (inner) inner.style.transform = `translate(${_mapPanX}px,${_mapPanY}px) scale(${_mapScale})`;
}

function mapZoom(dir, cx, cy) {
  const map = document.getElementById('map-area');
  if (!map) return;
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
      e.preventDefault();
      return;
    }

    if (e.target.closest('.map-token')) return;
    if (e.button !== 0) return;

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

  mapEl.addEventListener('auxclick', e => {
    if (e.button === 1) e.preventDefault();
  });
});

function addToken() {
  if (!hasPerm('createToken')) { showToast('토큰 생성 권한이 없어요.'); return; }
  const name = document.getElementById('token-name').value.trim() || '?';
  const type = document.getElementById('token-type').value;
  const id = genId();
  const token = { id, name, type, x: 48 + Math.random()*12, y: 48 + Math.random()*12 };
  if (window._FB?.CONFIGURED) {
    const { db, ref, set } = window._FB;
    set(ref(db, `rooms/${St.roomCode}/tokens/${id}`), token);
  } else { St.tokens[id] = token; renderAllTokens(St.tokens); }
  closeModal('modal-token');
  document.getElementById('token-name').value = '';
}

function renderAllTokens(tokens) {
  const inner = document.getElementById('map-inner');
  const validIds = new Set(Object.keys(tokens || {}));
  if (_multiSelectedTokenIds.length) {
    _multiSelectedTokenIds = _multiSelectedTokenIds.filter((id) => validIds.has(String(id)));
  }
  if (inner) inner.querySelectorAll('.map-token').forEach(t => t.remove());
  Object.values(tokens).forEach(t => createTokenEl(t));
  updateMultiTokenSelectionUI();
}

function createTokenEl(t) {
  const inner = document.getElementById('map-inner');
  const el = document.createElement('div');
  el.className = `map-token ${t.type==='enemy'?'enemy':t.type==='npc'?'npc':''}`;
  el.id = 'tok-' + t.id;
  el.style.left = t.x + '%'; el.style.top = t.y + '%';
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
  if (t.statuses && t.statuses.length > 0) {
    const hp = t.statuses[0];
    if (hp.max > 0) {
      const pct = Math.max(0, Math.min(100, (hp.cur / hp.max) * 100));
      const bar = document.createElement('div'); bar.className = 'token-hp-bar';
      const fill = document.createElement('div'); fill.className = 'token-hp-fill'; fill.style.width = pct + '%';
      if (pct <= 25) fill.style.background = 'var(--red)';
      else if (pct <= 50) fill.style.background = '#f0ad4e';
      bar.appendChild(fill); el.appendChild(bar);
    }
  }
  if (_multiSelectedTokenIds.includes(t.id)) el.classList.add('multi-selected');
  el.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); if (typeof openTokenEdit === 'function') openTokenEdit(t.id); });
  el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showTokenCtx(e, t.id); });
  makeDraggable(el, t.id);
  inner.appendChild(el);
}

function getSelectedDragTokenIds(tokenId) {
  const selectedIds = _multiSelectedTokenIds.includes(tokenId)
    ? _multiSelectedTokenIds.slice()
    : [tokenId];
  return Array.from(new Set((selectedIds || []).filter((id) => St.tokens[id] && document.getElementById('tok-' + id))));
}

function getMapDragMetrics(map) {
  return {
    width: Math.max(1, map?.offsetWidth || 1),
    height: Math.max(1, map?.offsetHeight || 1),
    scale: Math.max(0.0001, _mapScale || 1),
  };
}

function getTokenPercentPosition(tokenId) {
  const targetEl = document.getElementById('tok-' + tokenId);
  const token = St.tokens[tokenId] || {};
  return {
    x: typeof token.x === 'number' ? token.x : (parseFloat(targetEl?.style.left) || 0),
    y: typeof token.y === 'number' ? token.y : (parseFloat(targetEl?.style.top) || 0),
  };
}

function clampTokenPercent(value) {
  return Math.max(0, Math.min(100, value));
}

function createTokenDragSession(tokenId, event, map) {
  const targetIds = getSelectedDragTokenIds(tokenId);
  if (!targetIds.length) return null;

  return {
    map,
    startClientX: event.clientX,
    startClientY: event.clientY,
    metrics: getMapDragMetrics(map),
    targetIds,
    startPositions: targetIds.reduce((acc, id) => {
      acc[id] = getTokenPercentPosition(id);
      return acc;
    }, {}),
    latestPositions: {},
  };
}

function applyTokenDragSession(session, event) {
  if (!session) return;

  const dxPct = ((event.clientX - session.startClientX) / (session.metrics.width * session.metrics.scale)) * 100;
  const dyPct = ((event.clientY - session.startClientY) / (session.metrics.height * session.metrics.scale)) * 100;

  session.targetIds.forEach((id) => {
    const targetEl = document.getElementById('tok-' + id);
    const startPos = session.startPositions[id];
    if (!targetEl || !startPos) return;

    const nextX = clampTokenPercent(startPos.x + dxPct);
    const nextY = clampTokenPercent(startPos.y + dyPct);

    targetEl.style.left = nextX + '%';
    targetEl.style.top = nextY + '%';
    session.latestPositions[id] = { x: nextX, y: nextY };
  });
}

function commitTokenDragSession(session) {
  if (!session) return;

  const finalPositions = {};
  session.targetIds.forEach((id) => {
    const pos = session.latestPositions[id] || session.startPositions[id];
    if (!pos) return;
    finalPositions[id] = { x: pos.x, y: pos.y };
    if (!St.tokens[id]) St.tokens[id] = {};
    St.tokens[id].x = pos.x;
    St.tokens[id].y = pos.y;
  });

  if (window._FB?.CONFIGURED && St.roomCode && Object.keys(finalPositions).length) {
    const { db, ref, update } = window._FB;
    const patch = {};
    Object.entries(finalPositions).forEach(([id, pos]) => {
      patch[`${id}/x`] = pos.x;
      patch[`${id}/y`] = pos.y;
    });
    update(ref(db, `rooms/${St.roomCode}/tokens`), patch);
  }
}

function makeDraggable(el, tokenId) {
  el.addEventListener('mousedown', e => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      if (_multiSelectedTokenIds.includes(tokenId)) {
        setMultiTokenSelection(_multiSelectedTokenIds.filter(id => id !== tokenId));
      } else {
        setMultiTokenSelection([..._multiSelectedTokenIds, tokenId]);
      }
      return;
    }

    if (e.button !== 0) return;
    if (!hasPerm('moveToken')) { showToast('토큰 이동 권한이 없어요.'); return; }
    if (St.tool === 'erase') { removeToken(tokenId); return; }

    e.preventDefault();
    e.stopPropagation();

    const map = document.getElementById('map-area');
    if (!map) return;

    if (!_multiSelectedTokenIds.includes(tokenId)) {
      setMultiTokenSelection([tokenId]);
    }

    const dragSession = createTokenDragSession(tokenId, e, map);
    if (!dragSession) return;

    const onMove = ev => {
      applyTokenDragSession(dragSession, ev);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      commitTokenDragSession(dragSession);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function removeToken(tokenId) {
  if (!hasPerm('editToken')) { showToast('토큰 편집 권한이 없어요.'); return; }
  _multiSelectedTokenIds = _multiSelectedTokenIds.filter((id) => id !== tokenId);
  const el = document.getElementById('tok-' + tokenId);
  if (el) el.remove();
  if (window._FB?.CONFIGURED) {
    const { db, ref, remove } = window._FB;
    remove(ref(db, `rooms/${St.roomCode}/tokens/${tokenId}`));
  } else delete St.tokens[tokenId];
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
      const el = document.getElementById('tok-' + id);
      if (el) el.style.transform = `translate(-50%,-50%) rotate(${t.rotation}deg)`;
      if (window._FB?.CONFIGURED) {
        const { db, ref, update } = window._FB;
        update(ref(db, `rooms/${St.roomCode}/tokens/${id}`), { rotation: t.rotation });
      }
      break;
    }
    case 'toBack': {
      const el = document.getElementById('tok-' + id);
      if (el) el.style.zIndex = '1';
      break;
    }
    case 'own': {
      t.ownerId = St.myId;
      t.ownerName = St.myName;
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
      const el = document.getElementById('tok-' + id);
      if (el) el.remove();
      if (window._FB?.CONFIGURED) {
        const { db, ref, remove } = window._FB;
        remove(ref(db, `rooms/${St.roomCode}/tokens/${id}`));
      } else { delete St.tokens[id]; }
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
  if (window._FB?.CONFIGURED) {
    const { db, ref, remove } = window._FB;
    remove(ref(db, `rooms/${St.roomCode}/tokens/${delId}`));
  } else {
    delete St.tokens[delId];
    renderAllTokens(St.tokens);
  }
}

function setTool(t) {
  if (t === 'erase' && !hasPerm('editToken')) { showToast('토큰 편집 권한이 없어요.'); return; }
  St.tool = t;
  document.getElementById('tool-select').classList.toggle('on', t === 'select');
  const eraseBtn = document.getElementById('tool-erase');
  if (eraseBtn) eraseBtn.classList.toggle('on', t === 'erase');
}

