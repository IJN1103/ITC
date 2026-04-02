/**
 * ITC TRPG — Journal Core
 * 저널 유틸/아바타, CRUD, 목록, 드로어, 토큰 할당
 * + 시트/핸드아웃 공유 변수 선언
 */

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

function normalizeJournal(raw, idOverride) {
  const id = String(idOverride || raw?.id || '').trim();
  if (!id) return null;

  const createdAt = Number(raw?.createdAt || Date.now()) || Date.now();
  const updatedAt = Number(raw?.updatedAt || createdAt) || createdAt;
  const assignedTo = [...new Set((Array.isArray(raw?.assignedTo) ? raw.assignedTo : []).map(v => String(v || '').trim()).filter(Boolean))];
  const assignedTokenId = String(raw?.assignedTokenId || '').trim();
  const avatar = getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(
    raw?.avatar || raw?.sheet?.avatar || ''
  );
  const nameColor = String(raw?.nameColor || '').trim();
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
    nameColor: normalized.nameColor,
    sheet: normalized.sheet || {},
  };
  if (normalized.avatar) {
    payload.avatar = normalized.avatar;
    if (payload.sheet && typeof payload.sheet === 'object') payload.sheet.avatar = normalized.avatar;
  }
  return payload;
}

function sanitizeJournalMetaPatch(metaPatch = {}, currentJournal = null) {
  const current = currentJournal && typeof currentJournal === 'object' ? currentJournal : null;
  const assignedTo = metaPatch.assignedTo !== undefined
    ? [...new Set((Array.isArray(metaPatch.assignedTo) ? metaPatch.assignedTo : []).map(v => String(v || '').trim()).filter(Boolean))]
    : (current?.assignedTo || []);
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
  const nameColor = metaPatch.nameColor !== undefined
    ? String(metaPatch.nameColor || '').trim()
    : String(current?.nameColor || '').trim();

  const safe = {
    title,
    ownerId,
    createdAt,
    assignedTokenId,
    assignedTo,
    nameColor,
  };
  if (avatar) safe.avatar = avatar;
  return safe;
}


/* ── 시트 공유 상수/변수 (sheet.js에서 사용) ── */

const COC_STATS = [
  { key:'str', name:'근력(STR)' }, { key:'dex', name:'민첩(DEX)' },
  { key:'pow', name:'의지(POW)' }, { key:'con', name:'건강(CON)' },
  { key:'app', name:'외모(APP)' }, { key:'edu', name:'교육(EDU)' },
  { key:'siz', name:'체격(SIZ)' }, { key:'int', name:'지능(INT)' },
];


const COC_SKILLS = [
  { name:'감정', base:5 },    { name:'고고학', base:1 },
  { name:'관찰력', base:25 }, { name:'근접전(격투)', base:25 },
  { name:'기계수리', base:10 },{ name:'도약', base:20 },
  { name:'듣기', base:20 },   { name:'말재주', base:5 },
  { name:'마호', base:15 },   { name:'법률', base:5 },
  { name:'변장', base:5 },    { name:'사격(권총)', base:20 },
  { name:'사격(라이플/산탄)', base:25 }, { name:'설득', base:10 },
  { name:'손놀림', base:10 }, { name:'수영', base:20 },
  { name:'숨기', base:5 },    { name:'심리학', base:10 },
  { name:'언어(모국어)', base:0 }, { name:'역사', base:5 },
  { name:'열쇠공', base:1 },  { name:'오르기', base:20 },
  { name:'오컬트', base:5 },  { name:'위협', base:15 },
  { name:'은밀행동', base:20 },{ name:'응급처치', base:30 },
  { name:'의료', base:1 },    { name:'인류학', base:1 },
  { name:'자동차 운전', base:20 }, { name:'자료조사', base:20 },
  { name:'자연', base:10 },   { name:'재력', base:0 },
  { name:'전기수리', base:10 },{ name:'정신분석', base:1 },
  { name:'중장비 조작', base:1 }, { name:'추적', base:10 },
  { name:'크툴루 신화', base:0 }, { name:'투척', base:20 },
  { name:'항법', base:10 },   { name:'회계', base:5 },
  { name:'회피', base:0 },    { name:'언어(다른언어)', base:1 },
];


let _sheetJournalId = null;

let _sheetQuickViewMode = false;

const _quickSheetState = {
  x: null,
  y: null,
  width: null,
  height: null,
};
let _quickSheetInteractionsBound = false;

let _combatRowCount = 0;

/* ── 저널 CRUD / 목록 / 드로어 / 토큰 할당 ── */

function loadJournals() {
  if (St.isGM) return _allJournals.slice();
  return _allJournals.filter(j =>
    j.ownerId === St.myId ||
    (j.assignedTo && j.assignedTo.includes(St.myId))
  );
}

function fetchJournalsFromFB() {
  if (!window._FB?.CONFIGURED || !St.roomCode) return;
  const { db, ref, get } = window._FB;
  get(ref(db, `rooms/${St.roomCode}/journals`)).then(snap => {
    const data = snap.val() || {};
    _allJournals = [];
    Object.entries(data).forEach(([id, j]) => {
      const normalized = normalizeJournal(j, id);
      if (normalized) _allJournals.push(normalized);
    });
    renderJournalList();
    saRefreshToolbar();
  }).catch(() => {});
}

function saveJournals(list) {
  const normalizedList = (Array.isArray(list) ? list : []).map(j => normalizeJournal(j)).filter(Boolean);
  if (!window._FB?.CONFIGURED) {
    localStorage.setItem(journalKey(), JSON.stringify(normalizedList));
    _allJournals = normalizedList;
    return;
  }
  const { db, ref, set } = window._FB;
  normalizedList.forEach(j => {
    const payload = buildJournalStoragePayload(j);
    if (!payload) return;
    set(ref(db, `rooms/${St.roomCode}/journals/${j.id}`), payload);
  });
}

function saveJournalFB(journal) {
  const normalized = normalizeJournal(journal);
  if (!normalized) return;
  const payload = buildJournalStoragePayload(normalized);
  if (!payload) return;

  if (window._FB?.CONFIGURED) {
    const { db, ref, update } = window._FB;
    const remotePayload = { ...payload };
    if (!remotePayload.createdAt) remotePayload.createdAt = getJournalServerTimestamp();
    remotePayload.updatedAt = getJournalServerTimestamp();
    update(ref(db, `rooms/${St.roomCode}/journals/${normalized.id}`), remotePayload);
  } else {
    const idx = _allJournals.findIndex(j => j.id === normalized.id);
    if (idx >= 0) _allJournals[idx] = normalized;
    else _allJournals.push(normalized);
    localStorage.setItem(journalKey(), JSON.stringify(_allJournals));
  }
}

function saveJournalSheetFB(journalId, sheetData, metaPatch = {}) {
  if (!journalId) return;

  const currentJournal = _allJournals.find(j => j.id === journalId) || null;
  const safeMetaPatch = sanitizeJournalMetaPatch(metaPatch, currentJournal);
  const safeSheetData = sanitizeStoredJournalValue(sheetData || {}, ['sheet']) || {};
  const safeAvatar = getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(
    safeMetaPatch.avatar || safeSheetData.avatar || currentJournal?.avatar || currentJournal?.sheet?.avatar || ''
  );
  if (safeAvatar) safeSheetData.avatar = safeAvatar;
  else if ('avatar' in safeSheetData) delete safeSheetData.avatar;

  if (window._FB?.CONFIGURED) {
    const { db, ref, update, set } = window._FB;
    const remoteMetaPatch = { ...safeMetaPatch, updatedAt: getJournalServerTimestamp() };
    if (!remoteMetaPatch.createdAt && !currentJournal?.createdAt) {
      remoteMetaPatch.createdAt = getJournalServerTimestamp();
    }
    update(ref(db, `rooms/${St.roomCode}/journals/${journalId}`), remoteMetaPatch);
    set(ref(db, `rooms/${St.roomCode}/journals/${journalId}/sheet`), safeSheetData);
  } else {
    const nextJournal = normalizeJournal({
      ...(currentJournal || {}),
      id: journalId,
      ...safeMetaPatch,
      sheet: safeSheetData,
    }, journalId);
    const idx = _allJournals.findIndex(j => j.id === journalId);
    if (idx >= 0) _allJournals[idx] = nextJournal;
    else _allJournals.push(nextJournal);
    localStorage.setItem(journalKey(), JSON.stringify(_allJournals));
  }
}

function deleteJournalFB(id) {
  if (window._FB?.CONFIGURED) {
    const { db, ref, remove } = window._FB;
    remove(ref(db, `rooms/${St.roomCode}/journals/${id}`));
  } else {
    _allJournals = _allJournals.filter(j => j.id !== id);
    localStorage.setItem(journalKey(), JSON.stringify(_allJournals));
  }
}

function migrateLocalJournals() {
  if (!window._FB?.CONFIGURED || !St.roomCode) return;
  try {
    const localKey = 'itc_journals_' + St.myId + '_' + St.roomCode;
    const local = JSON.parse(localStorage.getItem(localKey) || '[]');
    if (local.length === 0) return;
    const { db, ref, set } = window._FB;
    local.forEach(j => {
      const normalized = normalizeJournal(j);
      const payload = buildJournalStoragePayload(normalized);
      if (!normalized || !payload) return;
      set(ref(db, `rooms/${St.roomCode}/journals/${normalized.id}`), payload);
    });
    localStorage.removeItem(localKey);
  } catch(e) {}
}

function setJournalListEmptyState(messageHtml) {
  const empty = document.getElementById('journal-empty');
  if (!empty) return;
  if (messageHtml) {
    empty.style.display = 'block';
    empty.innerHTML = messageHtml;
  } else {
    empty.style.display = 'none';
  }
}

function buildJournalListItem(j) {
  const div = document.createElement('div');
  div.className = 'journal-item';
  div.dataset.journalId = j.id;
  div.onclick = () => openSheet(j.id);
  const d = new Date(j.updatedAt || j.createdAt);
  const ds = `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  const pre = (j.body || '').replace(/\n/g,' ').slice(0,40) || '내용 없음';
  const initials = (j.title || '저').trim()[0]?.toUpperCase() || '?';
  const imgSrc = saGetAvatar(j.id) || '';
  const avatarHtml = imgSrc
    ? `<div class="journal-avatar"><img src="${imgSrc}" alt="avatar"></div>`
    : `<div class="journal-avatar">${esc(initials)}</div>`;
  const players = St.players || {};
  const ownerName = j.ownerId && players[j.ownerId] ? players[j.ownerId].name : '';
  const ownerTag = ownerName && j.ownerId !== St.myId ? `<span style="font-size:9px;color:var(--muted);margin-left:4px">(${esc(ownerName)})</span>` : '';
  const assignedNames = (j.assignedTo || []).map(uid => players[uid]?.name).filter(Boolean);
  const assignTag = assignedNames.length > 0 ? `<span style="font-size:9px;color:var(--green);margin-left:4px">(부여: ${esc(assignedNames.join(', '))})</span>` : '';
  const canDelete = St.isGM || j.ownerId === St.myId;
  const delHtml = canDelete ? `<button class="journal-item-del" data-jid="${j.id}" onclick="event.stopPropagation();deleteJournalById(this.dataset.jid)" title="삭제">🗑</button>` : '';
  div.innerHTML = `${avatarHtml}<div class="journal-item-body">
    <div class="journal-item-title">${esc(j.title||'무제 저널')}${ownerTag}${assignTag}</div>
    <div class="journal-item-meta"><span style="color:var(--dim);font-size:11px">${esc(pre)}${(j.body||'').length>40?'…':''}</span><span>${ds}</span></div>
  </div>${delHtml}`;
  return div;
}

function syncJournalListItem(journalId) {
  const container = document.getElementById('journal-list-container');
  if (!container) return;
  if (!St.roomCode) {
    container.querySelectorAll('.journal-item').forEach(el => el.remove());
    setJournalListEmptyState('방에 입장하면 저널을 볼 수 있어요.');
    saRefreshToolbar();
    return;
  }

  const visibleList = loadJournals();
  const orderedList = visibleList.slice().reverse();
  if (!orderedList.length) {
    container.querySelectorAll('.journal-item').forEach(el => el.remove());
    setJournalListEmptyState('저널이 없어요.<br>위 + 버튼으로 새 저널을 만들어보세요.');
    saRefreshToolbar();
    return;
  }

  const idx = orderedList.findIndex(item => item.id === journalId);
  const existing = container.querySelector(`.journal-item[data-journal-id="${journalId}"]`);

  if (idx === -1) {
    if (existing) existing.remove();
    setJournalListEmptyState('');
    saRefreshToolbar();
    return;
  }

  const nextItem = buildJournalListItem(orderedList[idx]);
  if (existing) existing.replaceWith(nextItem);

  const children = Array.from(container.querySelectorAll('.journal-item'));
  const targetIndex = existing ? idx : idx;
  const anchor = children[targetIndex] || null;
  if (!existing) {
    if (anchor) container.insertBefore(nextItem, anchor);
    else container.appendChild(nextItem);
  } else {
    const refreshedChildren = Array.from(container.querySelectorAll('.journal-item'));
    const currentIndex = refreshedChildren.indexOf(nextItem);
    if (currentIndex !== idx) {
      const desiredAnchor = refreshedChildren[idx] || null;
      if (desiredAnchor) container.insertBefore(nextItem, desiredAnchor);
      else container.appendChild(nextItem);
    }
  }

  setJournalListEmptyState('');
  saRefreshToolbar();
}

function removeJournalListItem(journalId) {
  const container = document.getElementById('journal-list-container');
  if (!container) return;
  const existing = container.querySelector(`.journal-item[data-journal-id="${journalId}"]`);
  if (existing) existing.remove();

  if (!St.roomCode) setJournalListEmptyState('방에 입장하면 저널을 볼 수 있어요.');
  else if (!loadJournals().length) setJournalListEmptyState('저널이 없어요.<br>위 + 버튼으로 새 저널을 만들어보세요.');
  else setJournalListEmptyState('');
  saRefreshToolbar();
}

function renderJournalList() {
  const container = document.getElementById('journal-list-container');
  if (!container) return;
  container.querySelectorAll('.journal-item').forEach(el => el.remove());
  if (!St.roomCode) {
    setJournalListEmptyState('방에 입장하면 저널을 볼 수 있어요.');
    return;
  }
  const list = loadJournals();
  if (!list.length) {
    setJournalListEmptyState('저널이 없어요.<br>위 + 버튼으로 새 저널을 만들어보세요.');
    return;
  }
  setJournalListEmptyState('');
  const frag = document.createDocumentFragment();
  list.slice().reverse().forEach(j => frag.appendChild(buildJournalListItem(j)));
  container.appendChild(frag);
  saRefreshToolbar();
}

function openJournalEditor(id) {
  const titleEl = document.getElementById('jd-title');
  const bodyEl  = document.getElementById('jd-body');
  const metaEl  = document.getElementById('jd-meta-date');
  const hintEl  = document.getElementById('jd-footer-hint');

  if (id) {
    const j = loadJournals().find(j => j.id === id);
    if (!j) return;
    _currentJournalId = id;
    titleEl.value = j.title || '';
    bodyEl.value  = j.body  || '';
    const d = new Date(j.updatedAt || j.createdAt);
    metaEl.textContent = `마지막 수정: ${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  } else {
    _currentJournalId = 'j_' + Date.now();
    titleEl.value = ''; bodyEl.value = '';
    metaEl.textContent = '새 저널';
  }

  if (hintEl) hintEl.textContent = '';
  const drawer = document.getElementById('journal-drawer');
  if (drawer) drawer.classList.add('open');
  setTimeout(() => {
    if (!titleEl || !titleEl.isConnected) return;
    titleEl.focus();
  }, 100);
}

function closeJournalDrawer() {
  document.getElementById('journal-drawer').classList.remove('open');
  renderJournalList();
}

function closeJournalEditor() { closeJournalDrawer(); }

function createNewJournal() {
  if (!St.roomCode) { showToast('방에 입장한 상태에서만 저널을 만들 수 있어요.'); return; }
  const newId = 'j_' + Date.now();
  _sheetJournalId = newId;
  _sheetIsNew = true;
  _sheetAvatarData = null;
  _jdAssignedTokenId = null;

  const existingWrap = document.getElementById('sh-skills-wrap');
  if (existingWrap) existingWrap.innerHTML = '';
  initSheetUI();

  ['name','player','job','age','residence','birthplace'].forEach(k => {
    const el = document.getElementById('sh-'+k);
    if (el) el.value = '';
  });
  COC_STATS.forEach(s => {
    const el = document.getElementById('sh-'+s.key);
    if (el) { el.value = ''; updateStatHalf(s.key); }
  });
  ['hp','hp-max','san','san-max','mp','mp-max','luck','db','build'].forEach(k => {
    const el = document.getElementById('sh-'+k);
    if (el) el.value = '';
  });
  COC_SKILLS.forEach((sk, i) => {
    const ck = document.getElementById('sk-check-'+i);
    const val = document.getElementById('sk-val-'+i);
    const hlf = document.getElementById('sk-half-'+i);
    if (ck) ck.checked = false;
    if (val) val.value = sk.base;
    if (hlf) hlf.value = Math.floor(sk.base/2);
  });
  const notes = document.getElementById('sh-notes');
  if (notes) notes.value = '';
  document.getElementById('sh-unarmed-skill').value = '근접전(격투)';
  document.getElementById('sh-unarmed-dmg').value = '1d3+db';
  _combatRowCount = 0;
  const tbody = document.getElementById('sh-combat-rows');
  if (tbody) tbody.innerHTML = '';
  ['equipment','spending','cash','assets'].forEach(k => {
    const el = document.getElementById('sh-'+k);
    if (el) el.value = '';
  });
  ['appearance','personality','ideology','wounds','people','phobias','places','tomes','treasures','encounters'].forEach(k => {
    const el = document.getElementById('sh-bs-'+k);
    if (el) el.value = '';
  });

  refreshSheetAvatar(null, '?');
  refreshJournalTokenBar(null);
  _sheetAssignedTo = [];
  refreshSheetAssignBar(null);

  const hint = document.getElementById('sheet-hint');
  if (hint) hint.textContent = '';
  const delBtn = document.querySelector('.sheet-del-btn');
  if (delBtn) delBtn.style.display = 'none';

  const overlay = document.getElementById('sheet-overlay');
  if (overlay) overlay.classList.add('open');
  setTimeout(() => {
    const nameEl = document.getElementById('sh-name');
    if (nameEl && nameEl.isConnected) nameEl.focus();
  }, 150);
}

function saveJournalFromDrawer() {
  if (!St.roomCode) { showToast('방에 입장한 상태에서만 저널을 저장할 수 있어요.'); return; }
  const title = (document.getElementById('jd-title').value || '').trim() || '무제 저널';
  const body  = document.getElementById('jd-body').value;
  const hint  = document.getElementById('jd-footer-hint');
  const existing = _allJournals.find(j => j.id === _currentJournalId);
  if (existing) {
    existing.title = title;
    existing.body = body;
    existing.updatedAt = Date.now();
    saveJournalFB({
      ...existing,
      id: _currentJournalId,
      ownerId: existing.ownerId || St.myId,
      title,
      body,
      createdAt: existing.createdAt || Date.now(),
      updatedAt: existing.updatedAt,
    });
  } else {
    saveJournalFB({ id: _currentJournalId, title, body, ownerId: St.myId, createdAt: Date.now(), updatedAt: Date.now() });
  }
  const d = new Date();
  document.getElementById('jd-meta-date').textContent =
    `마지막 수정: ${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  if (hint) { hint.textContent = '저장됐어요 ✓'; setTimeout(() => { if(hint) hint.textContent=''; }, 2000); }
}

function saveJournal() { saveJournalFromDrawer(); }

function deleteJournalFromDrawer() {
  if (!_currentJournalId || !confirm('이 저널을 삭제할까요?')) return;
  const _delId = _currentJournalId;
  deleteJournalFB(_delId);
  if (St.speakAsJournalId === _delId) { St.speakAsJournalId = null; saRefreshBtn(); }
  try { localStorage.removeItem('itc_av_' + _delId); } catch(e) {}
  delete _JAV[_delId];
  closeJournalDrawer();
}
function deleteJournal() { deleteJournalFromDrawer(); }

function deleteJournalById(id) {
  if (!id || !confirm('이 저널을 삭제할까요?')) return;
  deleteJournalFB(id);
  if (St.speakAsJournalId === id) { St.speakAsJournalId = null; saRefreshBtn(); }
  try { localStorage.removeItem('itc_av_' + id); } catch(e) {}
  delete _JAV[id];
  renderJournalList();
}

function deleteSheetJournal() {
  if (!_sheetJournalId || !confirm('이 저널을 삭제할까요?')) return;
  const delId = _sheetJournalId;
  deleteJournalFB(delId);
  if (St.speakAsJournalId === delId) { St.speakAsJournalId = null; saRefreshBtn(); }
  try { localStorage.removeItem('itc_av_' + delId); } catch(e) {}
  delete _JAV[delId];
  closeSheet();
  renderJournalList();
}

