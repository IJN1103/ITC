function getJournalServerTimestamp() {
  return (window._FB?.CONFIGURED && typeof window._FB.serverTimestamp === 'function')
    ? window._FB.serverTimestamp()
    : Date.now();
}


function getSharedJournalAvatarRuntime() {
  return {
    sanitizePersistentAvatarSrc(src) {
      const value = String(src || '').trim();
      if (!value) return '';
      if (/^data:image\//i.test(value) || /^blob:/i.test(value)) return '';
      return value;
    },
    readStoredAvatar(journalId) {
      if (!journalId) return '';
      try {
        const safe = this.sanitizePersistentAvatarSrc(localStorage.getItem('itc_av_' + journalId));
        if (!safe) localStorage.removeItem('itc_av_' + journalId);
        return safe;
      } catch (e) {
        return '';
      }
    },
  };
}

/**
 * ITC TRPG — Journal + Sheet 모듈
 * 저널 CRUD, 캐릭터 시트, 소유권/공유, 토큰 연결
 */

let _currentJournalId = null;
let _jdAssignedTokenId = null;
let _sheetIsNew = false;
let _sheetAssignedTo = [];

let _sheetAvatarData = null;
let _sheetAvatarStoredUrl = null;
let _sheetAvatarUploadPromise = null;

function getCloudinaryJournalConfig() { return _itcGetCloudinaryConfig(); }
function blobFromCanvas(canvas, type, quality) { return _itcCanvasToBlob(canvas, type || 'image/jpeg', quality || 0.82); }

async function makeJournalAvatarBlob(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const size = 256;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  const min = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - min) / 2);
  const sy = Math.floor((bitmap.height - min) / 2);
  ctx.drawImage(bitmap, sx, sy, min, min, 0, 0, size, size);
  if (typeof bitmap.close === 'function') bitmap.close();
  return blobFromCanvas(canvas, 'image/jpeg', 0.84);
}

async function uploadJournalAvatarToCloudinary(file, journalId) {
  const blob = await makeJournalAvatarBlob(file);
  const result = await _itcUploadToCloudinary({
    blob,
    folder: 'itc/journal-avatars',
    fileName: `journal-avatar-${journalId || Date.now()}.jpg`,
    publicId: journalId ? `journal-${journalId}-${Date.now()}` : undefined,
  });
  return result.url;
}


function journalKey() { return 'itc_journals_' + St.myId + '_' + St.roomCode; }
function handoutKey() { return 'itc_handouts_' + St.myId + '_' + St.roomCode; }

function sanitizeStoredJournalValue(value, path = []) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'function') return undefined;
  if (typeof value === 'string') {
    if (path[path.length - 1] === 'avatar') {
      return getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(value);
    }
    return value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const next = sanitizeStoredJournalValue(item, path);
      return next === undefined ? '' : next;
    });
  }
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => {
      const next = sanitizeStoredJournalValue(value[key], path.concat(key));
      if (next !== undefined) out[key] = next;
    });
    return out;
  }
  return value;
}

function normalizeUidList(listValue, mapValue) {
  const out = [];
  if (Array.isArray(listValue)) {
    listValue.forEach(v => {
      const uid = String(v || '').trim();
      if (uid) out.push(uid);
    });
  }
  if (mapValue && typeof mapValue === 'object' && !Array.isArray(mapValue)) {
    Object.entries(mapValue).forEach(([uid, enabled]) => {
      const safeUid = String(uid || '').trim();
      if (safeUid && enabled === true) out.push(safeUid);
    });
  }
  return [...new Set(out)];
}

function buildUidBoolMap(ids) {
  const out = {};
  normalizeUidList(ids, null).forEach(uid => { out[uid] = true; });
  return out;
}

function normalizeJournal(raw, idOverride) {
  const id = String(idOverride || raw?.id || '').trim();
  if (!id) return null;

  const createdAt = Number(raw?.createdAt || Date.now()) || Date.now();
  const updatedAt = Number(raw?.updatedAt || createdAt) || createdAt;
  const assignedTo = normalizeUidList(raw?.assignedTo, raw?.assignedMap);
  const assignedTokenId = String(raw?.assignedTokenId || '').trim();
  const avatar = getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(
    raw?.avatar || raw?.sheet?.avatar || ''
  );
  const nameColor = String(raw?.nameColor || raw?.sheet?.nameColor || '').trim();
  const safeSheet = sanitizeStoredJournalValue(raw?.sheet || {}, ['sheet']);

  if (avatar) safeSheet.avatar = avatar;
  else if (safeSheet && typeof safeSheet === 'object' && 'avatar' in safeSheet) delete safeSheet.avatar;

  return {
    id,
    title: String(raw?.title || '무제 저널').trim() || '무제 저널',
    body: typeof raw?.body === 'string' ? raw.body : '',
    ownerId: String(raw?.ownerId || St.myId || '').trim(),
    createdAt,
    updatedAt,
    assignedTokenId: assignedTokenId || null,
    assignedTo,
    assignedMap: buildUidBoolMap(assignedTo),
    avatar,
    nameColor,
    sheet: safeSheet && typeof safeSheet === 'object' ? safeSheet : {},
  };
}

function buildJournalStoragePayload(journal) {
  const normalized = normalizeJournal(journal);
  if (!normalized) return null;
  const payload = {
    title: normalized.title,
    body: normalized.body,
    ownerId: normalized.ownerId,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    assignedTokenId: normalized.assignedTokenId,
    assignedTo: normalized.assignedTo,
    assignedMap: buildUidBoolMap(normalized.assignedTo),
    nameColor: normalized.nameColor,
    sheet: normalized.sheet || {},
  };
  if (normalized.nameColor && payload.sheet && typeof payload.sheet === 'object') {
    payload.sheet.nameColor = normalized.nameColor;
  }
  if (normalized.avatar) {
    payload.avatar = normalized.avatar;
    if (payload.sheet && typeof payload.sheet === 'object') payload.sheet.avatar = normalized.avatar;
  }
  return payload;
}

function sanitizeJournalMetaPatch(metaPatch = {}, currentJournal = null) {
  const current = currentJournal && typeof currentJournal === 'object' ? currentJournal : null;
  const assignedTo = metaPatch.assignedTo !== undefined
    ? normalizeUidList(metaPatch.assignedTo, metaPatch.assignedMap)
    : normalizeUidList(current?.assignedTo || [], current?.assignedMap);
  const assignedTokenId = metaPatch.assignedTokenId !== undefined
    ? (String(metaPatch.assignedTokenId || '').trim() || null)
    : (current?.assignedTokenId || null);
  const avatar = metaPatch.avatar !== undefined
    ? getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(metaPatch.avatar)
    : getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(current?.avatar || current?.sheet?.avatar || '');
  const title = metaPatch.title !== undefined
    ? (String(metaPatch.title || '').trim() || '무제 저널')
    : (String(current?.title || '무제 저널').trim() || '무제 저널');
  const ownerId = metaPatch.ownerId !== undefined
    ? String(metaPatch.ownerId || St.myId || '').trim()
    : String(current?.ownerId || St.myId || '').trim();
  const createdAt = Number(metaPatch.createdAt || current?.createdAt || Date.now()) || Date.now();
  const hasNameColorPatch = Object.prototype.hasOwnProperty.call(metaPatch, 'nameColor');
  const patchNameColor = hasNameColorPatch ? String(metaPatch.nameColor || '').trim() : '';
  const currentNameColor = String(current?.nameColor || '').trim();

  const safe = {
    title,
    ownerId,
    createdAt,
    assignedTokenId,
    assignedTo,
    assignedMap: buildUidBoolMap(assignedTo),
  };
  if (hasNameColorPatch) safe.nameColor = patchNameColor;
  else if (currentNameColor) safe.nameColor = currentNameColor;
  if (avatar) safe.avatar = avatar;
  return safe;
}

function syncJournalRuntimeCache(journal) {
  if (!journal || !journal.id) return;
  const safeAvatar = getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(journal.avatar || journal.sheet?.avatar || '');
  if (safeAvatar && typeof saSetAvatar === 'function') {
    saSetAvatar(journal.id, safeAvatar);
  }
}

function normalizeIncomingJournal(raw, idOverride) {
  const normalized = normalizeJournal(raw, idOverride);
  if (normalized) syncJournalRuntimeCache(normalized);
  return normalized;
}

function upsertLocalJournal(normalizedJournal) {
  const normalized = normalizeIncomingJournal(normalizedJournal, normalizedJournal?.id);
  if (!normalized) return null;
  const idx = _allJournals.findIndex(j => j.id === normalized.id);
  if (idx >= 0) _allJournals[idx] = normalized;
  else _allJournals.push(normalized);
  return normalized;
}

let _currentHandoutId = null;
let _handoutSyncOff = null;
let _handoutSyncRoom = '';
let _handoutSelectionRange = null;
let _handoutLastFontSize = 12;

function loadHandouts() {
  if (St.isGM) return _allHandouts.slice();
  return _allHandouts.filter(h => h && (h.ownerId === St.myId || (Array.isArray(h.allowedTo) && h.allowedTo.includes(St.myId))));
}

function normalizeHandout(raw, idOverride) {
  const id = String(idOverride || raw?.id || '').trim();
  if (!id) return null;
  return {
    id,
    title: String(raw?.title || '무제 핸드아웃').trim() || '무제 핸드아웃',
    contentHtml: sanitizeHandoutHtml(raw?.contentHtml || ''),
    ownerId: String(raw?.ownerId || St.myId || '').trim(),
    allowedTo: normalizeUidList(raw?.allowedTo, raw?.allowedMap),
    allowedMap: buildUidBoolMap(normalizeUidList(raw?.allowedTo, raw?.allowedMap)),
    createdAt: Number(raw?.createdAt || Date.now()),
    updatedAt: Number(raw?.updatedAt || Date.now()),
  };
}

function readLocalHandouts() {
  try {
    const raw = JSON.parse(localStorage.getItem(handoutKey()) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(h => normalizeHandout(h)).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function persistLocalHandouts() {
  try { localStorage.setItem(handoutKey(), JSON.stringify(_allHandouts)); } catch (e) {}
}

function setHandoutStateFromData(data) {
  const next = [];
  Object.entries(data || {}).forEach(([id, value]) => {
    const normalized = normalizeHandout(value, id);
    if (normalized) next.push(normalized);
  });
  next.sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  _allHandouts = next;
  persistLocalHandouts();
  renderHandoutList();
}

function fetchHandoutsFromFB() {
  if (!St.roomCode) return;
  if (!window._FB?.CONFIGURED) {
    _allHandouts = readLocalHandouts();
    renderHandoutList();
    return;
  }
  const { db, ref, get, onValue, off } = window._FB;
  const path = `rooms/${St.roomCode}/handouts`;
  const targetRef = ref(db, path);
  get(targetRef).then(snap => {
    setHandoutStateFromData(snap.val() || {});
  }).catch(err => {
    console.error('handout initial fetch failed', err);
    _allHandouts = readLocalHandouts();
    renderHandoutList();
  });
  if (_handoutSyncOff && _handoutSyncRoom !== St.roomCode) {
    try { _handoutSyncOff(); } catch (e) {}
    _handoutSyncOff = null;
  }
  if (_handoutSyncRoom === St.roomCode && _handoutSyncOff) return;
  _handoutSyncRoom = St.roomCode;
  _handoutSyncOff = () => { try { off(targetRef); } catch (e) {} };
  onValue(targetRef, snap => {
    setHandoutStateFromData(snap.val() || {});
  }, err => {
    console.error('handout realtime sync failed', err);
  });
}

function migrateLocalHandouts() {
  if (!window._FB?.CONFIGURED || !St.roomCode) return;
  const local = readLocalHandouts();
  if (!local.length) return;
  const { db, ref, update } = window._FB;
  const payload = {};
  local.forEach(h => { payload[h.id] = { title: h.title, contentHtml: h.contentHtml, ownerId: h.ownerId, allowedTo: h.allowedTo, allowedMap: buildUidBoolMap(h.allowedTo), createdAt: h.createdAt, updatedAt: h.updatedAt }; });
  update(ref(db, `rooms/${St.roomCode}/handouts`), payload).then(() => {
    try { localStorage.removeItem(handoutKey()); } catch (e) {}
  }).catch(err => console.error('handout local migration failed', err));
}

function stripHandoutText(rawHtml) {
  const div = document.createElement('div');
  div.innerHTML = String(rawHtml || '');
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

function sanitizeHandoutHtml(rawHtml) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(rawHtml || '');
  const allowed = new Set(['DIV','P','BR','STRONG','B','EM','I','U','UL','OL','LI','BLOCKQUOTE','SPAN','IMG']);
  const safeUrl = v => /^https?:\/\//i.test(String(v || '').trim()) ? String(v || '').trim() : '';
  const walk = (node) => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === 1) {
        const tag = child.tagName.toUpperCase();
        if (!allowed.has(tag)) {
          const frag = document.createDocumentFragment();
          while (child.firstChild) frag.appendChild(child.firstChild);
          child.replaceWith(frag);
          walk(node);
          return;
        }
        [...child.attributes].forEach(attr => {
          const name = attr.name.toLowerCase();
          if (tag === 'IMG' && name === 'src') {
            const clean = safeUrl(attr.value);
            if (clean) child.setAttribute('src', clean); else child.remove();
            return;
          }
          if (tag === 'IMG' && name === 'alt') return;
          if (name === 'style') {
            const rules = [];
            String(attr.value || '').split(';').forEach(rule => {
              const [rawName, rawVal] = rule.split(':');
              const key = String(rawName || '').trim().toLowerCase();
              const val = String(rawVal || '').trim().toLowerCase();
              if (key === 'text-align' && /^(left|center|right)$/.test(val)) rules.push(`text-align:${val}`);
              if (key === 'font-size') {
                const m = val.match(/^(\d{1,2})(pt|px)$/);
                if (m) {
                  const num = Number(m[1]);
                  const unit = m[2];
                  if ((unit === 'pt' && num >= 8 && num <= 36) || (unit === 'px' && num >= 10 && num <= 48)) rules.push(`font-size:${num}${unit}`);
                }
              }
            });
            if (rules.length) child.setAttribute('style', rules.join(';'));
            else child.removeAttribute('style');
            return;
          }
          child.removeAttribute(attr.name);
        });
        if (tag === 'IMG') {
          child.setAttribute('loading', 'lazy');
          if (!child.getAttribute('alt')) child.setAttribute('alt', 'handout image');
        }
        walk(child);
      } else if (child.nodeType === 8) {
        child.remove();
      }
    });
  };
  walk(tpl.content);
  return tpl.innerHTML.trim();
}

function renderHandoutAccessList(selectedIds) {
  const wrap = document.getElementById('hd-access-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  const players = Object.entries(St.players || {}).filter(([uid, p]) => uid !== St.myId && String(p?.role || '').toLowerCase() !== 'gm');
  if (!players.length) {
    wrap.innerHTML = '<div class="hd-access-empty">플레이어가 입장하면 여기에서 열람 권한을 줄 수 있어요.</div>';
    return;
  }
  players.forEach(([uid, player]) => {
    const label = document.createElement('label');
    label.className = 'hd-access-chip' + (ids.includes(uid) ? ' on' : '');
    label.innerHTML = `<input type="checkbox" value="${esc(uid)}" ${ids.includes(uid) ? 'checked' : ''}><span>${esc(player?.name || '플레이어')}</span>`;
    const input = label.querySelector('input');
    input.onchange = () => label.classList.toggle('on', input.checked);
    wrap.appendChild(label);
  });
}

function getSelectedHandoutReaders() {
  return [...document.querySelectorAll('#hd-access-list input[type="checkbox"]:checked')].map(el => el.value);
}

function renderHandoutList() {
  const container = document.getElementById('handout-list-container');
  const empty = document.getElementById('handout-empty');
  if (!container) return;
  container.querySelectorAll('.handout-item').forEach(el => el.remove());
  if (!St.roomCode) {
    if (empty) { empty.style.display = 'block'; empty.textContent = '방에 입장하면 핸드아웃을 볼 수 있어요.'; }
    return;
  }
  const list = loadHandouts();
  if (!list.length) {
    if (empty) {
      empty.style.display = 'block';
      empty.innerHTML = St.isGM ? '핸드아웃이 없어요.<br>위 + 버튼으로 새 핸드아웃을 만들어보세요.' : '아직 열람 가능한 핸드아웃이 없어요.';
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  list.forEach(h => {
    const div = document.createElement('div');
    div.className = 'handout-item';
    div.onclick = () => openHandoutEditor(h.id);
    const d = new Date(h.updatedAt || h.createdAt || Date.now());
    const preview = stripHandoutText(h.contentHtml || '').slice(0, 80) || '내용 없음';
    const canEdit = !!St.isGM;
    const allowed = (h.allowedTo || []).map(uid => St.players?.[uid]?.name).filter(Boolean);
    div.innerHTML = `<div class="handout-icon">📄</div><div class="handout-item-body"><div class="handout-item-title">${esc(h.title || '무제 핸드아웃')}${canEdit ? '<span class="handout-item-badge">편집 가능</span>' : ''}</div><div class="handout-item-preview">${esc(preview)}${stripHandoutText(h.contentHtml || '').length > 80 ? '…' : ''}</div><div class="handout-item-meta"><span>${allowed.length ? '열람: ' + esc(allowed.join(', ')) : 'GM 전용'}</span><span>${(d.getMonth()+1)}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}</span></div></div>`;
    container.appendChild(div);
  });
}

function setHandoutEditorMode(canEdit) {
  const editor = document.getElementById('hd-body');
  const viewer = document.getElementById('hd-body-view');
  const toolbar = document.getElementById('hd-toolbar');
  const access = document.getElementById('hd-access-bar');
  const saveBtn = document.getElementById('hd-save-btn');
  const delBtn = document.getElementById('hd-del-btn');
  const title = document.getElementById('hd-title');
  const editable = !!canEdit;
  if (editor) editor.contentEditable = editable ? 'true' : 'false';
  if (viewer) viewer.style.display = editable ? 'none' : 'block';
  if (editor) editor.style.display = editable ? 'block' : 'none';
  if (toolbar) toolbar.style.display = editable ? 'flex' : 'none';
  if (access) access.style.display = editable ? 'block' : 'none';
  if (saveBtn) saveBtn.style.display = editable ? '' : 'none';
  if (delBtn) delBtn.style.display = editable ? '' : 'none';
  if (title) title.readOnly = !editable;
}

function openHandoutEditor(id) {
  const overlay = document.getElementById('handout-drawer');
  const titleEl = document.getElementById('hd-title');
  const editorEl = document.getElementById('hd-body');
  const viewerEl = document.getElementById('hd-body-view');
  const metaEl = document.getElementById('hd-meta-date');
  const hintEl = document.getElementById('hd-footer-hint');
  if (!overlay || !titleEl || !editorEl || !viewerEl) return;
  let handout = null;
  if (id) {
    handout = _allHandouts.find(h => h.id === id);
    if (!handout) return;
    const canRead = St.isGM || handout.ownerId === St.myId || (Array.isArray(handout.allowedTo) && handout.allowedTo.includes(St.myId));
    if (!canRead) { showToast('이 핸드아웃을 열람할 권한이 없어요.'); return; }
    _currentHandoutId = handout.id;
    titleEl.value = handout.title || '';
    const safeHtml = sanitizeHandoutHtml(handout.contentHtml || '');
    editorEl.innerHTML = safeHtml || '';
    viewerEl.innerHTML = safeHtml || '<p style="color:var(--muted)">내용이 없어요.</p>';
    renderHandoutAccessList(handout.allowedTo || []);
    const d = new Date(handout.updatedAt || handout.createdAt || Date.now());
    metaEl.textContent = `마지막 수정: ${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    setHandoutEditorMode(!!St.isGM);
  } else {
    if (!requireGM()) return;
    _currentHandoutId = 'h_' + Date.now();
    titleEl.value = '';
    editorEl.innerHTML = '';
    viewerEl.innerHTML = '';
    renderHandoutAccessList([]);
    metaEl.textContent = '새 핸드아웃';
    setHandoutEditorMode(true);
  }
  if (hintEl) hintEl.textContent = '';
  updateHandoutFontLabel(handout?.contentHtml || '' );
  overlay.classList.add('open');
  setTimeout(() => {
    if (!titleEl || !titleEl.isConnected || titleEl.readOnly) return;
    titleEl.focus();
  }, 60);
}

function closeHandoutDrawer() {
  document.getElementById('handout-drawer')?.classList.remove('open');
  _currentHandoutId = null;
  _handoutSelectionRange = null;
}

function createNewHandout() {
  if (!St.roomCode) { showToast('방에 입장한 상태에서만 핸드아웃을 만들 수 있어요.'); return; }
  if (!requireGM()) return;
  openHandoutEditor(null);
}

function restoreHandoutSelection() {
  const editor = document.getElementById('hd-body');
  if (!editor) return null;
  editor.focus();
  const sel = window.getSelection();
  if (_handoutSelectionRange && sel) {
    try { sel.removeAllRanges(); sel.addRange(_handoutSelectionRange); } catch (e) {}
  }
  return getHandoutSelectionRange();
}

function closeHandoutMenus() {
  document.getElementById('hd-align-menu')?.classList.remove('open');
  document.getElementById('hd-font-menu')?.classList.remove('open');
}

function toggleHandoutAlignMenu(event) {
  event?.stopPropagation?.();
  captureHandoutSelection();
  const menu = document.getElementById('hd-align-menu');
  const fontMenu = document.getElementById('hd-font-menu');
  fontMenu?.classList.remove('open');
  menu?.classList.toggle('open');
}

function toggleHandoutFontMenu(event) {
  event?.stopPropagation?.();
  captureHandoutSelection();
  const menu = document.getElementById('hd-font-menu');
  const alignMenu = document.getElementById('hd-align-menu');
  alignMenu?.classList.remove('open');
  menu?.classList.toggle('open');
}

function applyHandoutTextAlignFromMenu(align) {
  applyHandoutTextAlign(align);
  closeHandoutMenus();
}

function updateHandoutFontLabel(sourceHtml = null) {
  const label = document.getElementById('hd-font-size-label');
  if (!label) return;
  if (sourceHtml != null) {
    const match = String(sourceHtml || '').match(/font-size\s*:\s*(\d{1,2})pt/i);
    if (match) _handoutLastFontSize = Number(match[1]) || _handoutLastFontSize;
  }
  label.textContent = `${_handoutLastFontSize}pt`;
}

function applyHandoutInlineFormat(command) {
  const editor = document.getElementById('hd-body');
  if (!editor || editor.contentEditable !== 'true') return;
  restoreHandoutSelection();
  try { document.execCommand(command, false, null); } catch (e) {}
  captureHandoutSelection();
}

function normalizeHandoutLists(root) {
  if (!root) return;
  root.querySelectorAll('ul, ol').forEach(list => {
    list.querySelectorAll('p').forEach(p => {
      const frag = document.createDocumentFragment();
      while (p.firstChild) frag.appendChild(p.firstChild);
      p.replaceWith(frag);
    });
    list.querySelectorAll('li').forEach(li => {
      if (!li.innerHTML.trim()) li.innerHTML = '<br>';
    });
  });
}

function toggleHandoutBulletList() {
  const editor = document.getElementById('hd-body');
  if (!editor || editor.contentEditable !== 'true') return;
  restoreHandoutSelection();
  try {
    document.execCommand('styleWithCSS', false, false);
  } catch (e) {}
  try {
    document.execCommand('insertUnorderedList', false, null);
  } catch (e) {}
  normalizeHandoutLists(editor);
  captureHandoutSelection();
}

function captureHandoutSelection() {
  const editor = document.getElementById('hd-body');
  const sel = window.getSelection();
  if (!editor || !sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  _handoutSelectionRange = range.cloneRange();
}

function triggerHandoutImagePicker() {
  captureHandoutSelection();
  document.getElementById('hd-image-input')?.click();
}

async function uploadHandoutImageToCloudinary(file, handoutId) {
  const result = await _itcUploadToCloudinary({
    blob: file,
    folder: `itc/handouts/${St.roomCode || 'common'}`,
    fileName: `handout-${handoutId || Date.now()}-${Date.now()}.png`,
  });
  return result.url;
}

async function handleHandoutImage(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const hint = document.getElementById('hd-footer-hint');
  try {
    if (hint) hint.textContent = '이미지 업로드 중...';
    const url = await uploadHandoutImageToCloudinary(file, _currentHandoutId);
    const editor = document.getElementById('hd-body');
    editor?.focus();
    if (_handoutSelectionRange) {
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(_handoutSelectionRange); }
    }
    const html = `<p><img src="${esc(url)}" alt="handout image"></p><p><br></p>`;
    try { document.execCommand('insertHTML', false, html); }
    catch (e) { editor?.insertAdjacentHTML('beforeend', html); }
    if (hint) hint.textContent = '이미지 추가 완료 ✓';
    setTimeout(() => { const el = document.getElementById('hd-footer-hint'); if (el && el.textContent === '이미지 추가 완료 ✓') el.textContent = ''; }, 1600);
  } catch (err) {
    console.error('handout image upload failed', err);
    if (hint) hint.textContent = '';
    showToast('핸드아웃 이미지 업로드에 실패했어요.');
  } finally {
    input.value = '';
  }
}

function getHandoutSelectionRange() {
  const editor = document.getElementById('hd-body');
  const sel = window.getSelection();
  if (!editor || !sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return null;
  return range;
}

function applyHandoutTextAlign(align) {
  const editor = document.getElementById('hd-body');
  if (!editor || editor.contentEditable !== 'true') return;
  const valid = /^(left|center|right)$/.test(align) ? align : 'left';
  const range = restoreHandoutSelection();
  if (!range) return;
  const blocks = new Set();
  const addBlock = node => {
    let cur = node?.nodeType === 1 ? node : node?.parentElement;
    while (cur && cur !== editor) {
      if (/^(P|DIV|LI|BLOCKQUOTE)$/.test(cur.tagName)) { blocks.add(cur); return; }
      cur = cur.parentElement;
    }
    blocks.add(editor);
  };
  addBlock(range.startContainer);
  addBlock(range.endContainer);
  blocks.forEach(el => el.style.textAlign = valid);
  captureHandoutSelection();
}

function applyHandoutFontSize(value) {
  const editor = document.getElementById('hd-body');
  if (!editor || editor.contentEditable !== 'true') return;
  const size = Math.max(6, Math.min(18, Math.round(Number(value || 0))));
  if (!Number.isFinite(size)) return;
  const range = restoreHandoutSelection();
  if (!range) return;
  if (range.collapsed) {
    const span = document.createElement('span');
    span.style.fontSize = `${size}pt`;
    span.innerHTML = '&#8203;';
    range.insertNode(span);
    range.setStart(span.firstChild || span, 1);
    range.collapse(true);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  } else {
    const span = document.createElement('span');
    span.style.fontSize = `${size}pt`;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      sel.addRange(newRange);
    }
  }
  _handoutLastFontSize = size;
  updateHandoutFontLabel();
  closeHandoutMenus();
  captureHandoutSelection();
}

function applyHandoutFontSizePreset(size) {
  applyHandoutFontSize(size);
}

async function saveHandoutFB(handout) {
  const normalized = normalizeHandout(handout);
  if (!normalized) return false;
  const payload = {
    title: normalized.title,
    contentHtml: normalized.contentHtml,
    ownerId: normalized.ownerId,
    allowedTo: normalized.allowedTo,
    allowedMap: buildUidBoolMap(normalized.allowedTo),
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
  };
  const remotePayload = {
    ...payload,
    createdAt: payload.createdAt || getJournalServerTimestamp(),
    updatedAt: getJournalServerTimestamp(),
  };
  if (window._FB?.CONFIGURED && St.roomCode) {
    try {
      const { db, ref, set } = window._FB;
      await set(ref(db, `rooms/${St.roomCode}/handouts/${normalized.id}`), remotePayload);
    } catch (err) {
      console.error('handout save failed', err, payload);
      return false;
    }
  }
  const idx = _allHandouts.findIndex(h => h.id === normalized.id);
  if (idx >= 0) _allHandouts[idx] = normalized; else _allHandouts.unshift(normalized);
  persistLocalHandouts();
  renderHandoutList();
  return true;
}

async function saveHandoutFromDrawer() {
  if (!_currentHandoutId || !requireGM()) return;
  const title = (document.getElementById('hd-title')?.value || '').trim() || '무제 핸드아웃';
  const contentHtml = sanitizeHandoutHtml(document.getElementById('hd-body')?.innerHTML || '');
  const existing = _allHandouts.find(h => h.id === _currentHandoutId);
  const payload = normalizeHandout(existing ? { ...existing, title, contentHtml, allowedTo: getSelectedHandoutReaders(), updatedAt: Date.now() } : { id: _currentHandoutId, title, contentHtml, allowedTo: getSelectedHandoutReaders(), ownerId: St.myId, createdAt: Date.now(), updatedAt: Date.now() });
  const hint = document.getElementById('hd-footer-hint');
  if (hint) hint.textContent = '저장 중...';
  const ok = await saveHandoutFB(payload);
  if (!ok) {
    if (hint) hint.textContent = '';
    showToast('핸드아웃 저장에 실패했어요.');
    return;
  }
  if (hint) hint.textContent = '저장됐어요 ✓';
  fetchHandoutsFromFB();
  setTimeout(() => {
    const overlay = document.getElementById('handout-drawer');
    if (!overlay || !overlay.isConnected) return;
    closeHandoutDrawer();
  }, 120);
}

function deleteHandoutFromDrawer() {
  if (!_currentHandoutId || !requireGM()) return;
  if (!confirm('이 핸드아웃을 삭제할까요?')) return;
  const id = _currentHandoutId;
  _allHandouts = _allHandouts.filter(h => h.id !== id);
  persistLocalHandouts();
  renderHandoutList();
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, remove } = window._FB;
    remove(ref(db, `rooms/${St.roomCode}/handouts/${id}`)).catch(err => {
      console.error('handout delete failed', err);
      showToast('핸드아웃 삭제에 실패했어요.');
    });
  }
  closeHandoutDrawer();
}

document.addEventListener('selectionchange', () => {
  const overlay = document.getElementById('handout-drawer');
  const editor = document.getElementById('hd-body');
  if (!overlay || !editor || !overlay.classList.contains('open') || editor.contentEditable !== 'true') return;
  captureHandoutSelection();
});

document.addEventListener('click', (event) => {
  const toolbar = document.getElementById('hd-toolbar');
  if (!toolbar || !toolbar.contains(event.target)) closeHandoutMenus();
});

