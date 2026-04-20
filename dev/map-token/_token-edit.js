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
