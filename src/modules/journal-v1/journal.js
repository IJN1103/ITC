
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

function getCloudinaryJournalConfig() {
  const cfg = window._ITC_CLOUDINARY || {};
  if (!cfg.cloudName || !cfg.unsignedPreset) return null;
  return cfg;
}

function blobFromCanvas(canvas, type = 'image/jpeg', quality = 0.82) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('blob 생성 실패'));
    }, type, quality);
  });
}

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
  const cfg = getCloudinaryJournalConfig();
  if (!cfg) throw new Error('Cloudinary 설정이 비어 있어요.');
  const blob = await makeJournalAvatarBlob(file);
  const form = new FormData();
  form.append('file', blob, `journal-avatar-${journalId || Date.now()}.jpg`);
  form.append('upload_preset', cfg.unsignedPreset);
  form.append('folder', 'itc/journal-avatars');
  if (journalId) form.append('public_id', `journal-${journalId}-${Date.now()}`);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.secure_url) {
    throw new Error(data?.error?.message || 'Cloudinary 업로드 실패');
  }
  return data.secure_url;
}


function journalKey() { return 'itc_journals_' + St.myId + '_' + St.roomCode; }

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
    Object.entries(data).forEach(([id, j]) => { j.id = id; _allJournals.push(j); });
    renderJournalList();
    saRefreshToolbar();
  }).catch(() => {});
}

function saveJournals(list) {
  if (!window._FB?.CONFIGURED) {
    localStorage.setItem(journalKey(), JSON.stringify(list));
    _allJournals = list;
    return;
  }
  const { db, ref, set } = window._FB;
  list.forEach(j => {
    if (!j.ownerId) j.ownerId = St.myId;
    set(ref(db, `rooms/${St.roomCode}/journals/${j.id}`), j);
  });
}

function saveJournalFB(journal) {
  if (!journal?.id) return;
  if (!journal.ownerId) journal.ownerId = St.myId;
  if (window._FB?.CONFIGURED) {
    const { db, ref, set } = window._FB;
    set(ref(db, `rooms/${St.roomCode}/journals/${journal.id}`), journal);
  } else {
    const idx = _allJournals.findIndex(j => j.id === journal.id);
    if (idx >= 0) _allJournals[idx] = journal; else _allJournals.push(journal);
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
      if (!j.ownerId) j.ownerId = St.myId;
      set(ref(db, `rooms/${St.roomCode}/journals/${j.id}`), j);
    });
    localStorage.removeItem(localKey);
  } catch(e) {}
}

function renderJournalList() {
  const container = document.getElementById('journal-list-container');
  const empty     = document.getElementById('journal-empty');
  if (!container) return;
  container.querySelectorAll('.journal-item').forEach(el => el.remove());
  if (!St.roomCode) {
    if (empty) { empty.style.display = 'block'; empty.textContent = '방에 입장하면 저널을 볼 수 있어요.'; }
    return;
  }
  const list = loadJournals();
  if (!list.length) { if (empty) { empty.style.display = 'block'; empty.innerHTML = '저널이 없어요.<br>위 + 버튼으로 새 저널을 만들어보세요.'; } return; }
  if (empty) empty.style.display = 'none';
  list.slice().reverse().forEach(j => {
    const div  = document.createElement('div');
    div.className = 'journal-item';
    div.onclick   = () => openSheet(j.id);
    const d   = new Date(j.updatedAt || j.createdAt);
    const ds  = `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    const pre = (j.body || '').replace(/\n/g,' ').slice(0,40) || '내용 없음';
    const initials = (j.title || '저').trim()[0]?.toUpperCase() || '?';
    const imgSrc    = saGetAvatar(j.id) || '';
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
    container.appendChild(div);
  });
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
  document.getElementById('journal-drawer').classList.add('open');
  setTimeout(() => titleEl.focus(), 100);
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

  document.getElementById('sheet-overlay').classList.add('open');
  setTimeout(() => document.getElementById('sh-name')?.focus(), 150);
}

function saveJournalFromDrawer() {
  if (!St.roomCode) { showToast('방에 입장한 상태에서만 저널을 저장할 수 있어요.'); return; }
  const title = (document.getElementById('jd-title').value || '').trim() || '무제 저널';
  const body  = document.getElementById('jd-body').value;
  const hint  = document.getElementById('jd-footer-hint');
  const existing = _allJournals.find(j => j.id === _currentJournalId);
  if (existing) {
    existing.title = title; existing.body = body; existing.updatedAt = Date.now();
    saveJournalFB(existing);
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

function refreshSheetAssignBar(journal) {
  const bar = document.getElementById('sh-assign-bar');
  const ownerBar = document.getElementById('sh-owner-bar');
  const list = document.getElementById('sh-assign-list');
  if (!bar || !list) return;

  bar.style.display = St.isGM ? '' : 'none';

  if (ownerBar) {
    if (journal?.ownerId) {
      const players = St.players || {};
      const owner = players[journal.ownerId];
      ownerBar.textContent = `소유: ${owner?.name || '알 수 없음'}`;
      ownerBar.style.display = '';
    } else {
      ownerBar.style.display = 'none';
    }
  }

  if (!St.isGM) return;
  list.innerHTML = '';
  const players = St.players || {};
  Object.entries(players).forEach(([uid, p]) => {
    if (p.role === 'gm') return;
    const assigned = _sheetAssignedTo.includes(uid);
    const btn = document.createElement('button');
    btn.style.cssText = 'font:inherit;font-size:10px;padding:3px 10px;border-radius:4px;cursor:pointer;transition:.15s ease;border:1px solid '+(assigned?'rgba(90,158,114,.4)':'var(--border)')+';background:'+(assigned?'rgba(90,158,114,.12)':'var(--s3)')+';color:'+(assigned?'var(--green)':'var(--muted)');
    btn.textContent = (assigned ? '✓ ' : '') + p.name;
    btn.onclick = () => {
      if (assigned) {
        _sheetAssignedTo = _sheetAssignedTo.filter(x => x !== uid);
      } else {
        _sheetAssignedTo.push(uid);
      }
      refreshSheetAssignBar(journal);
    };
    list.appendChild(btn);
  });
  if (Object.keys(players).filter(uid => players[uid].role !== 'gm').length === 0) {
    list.innerHTML = '<span style="font-size:10px;color:var(--muted)">플레이어가 없습니다</span>';
  }
}

function getMyTokens() {
  const tokens = St.tokens || {};
  return Object.values(tokens).filter(t => {
    return t.ownerId === St.myId || St.isGM;
  });
}

function refreshJournalTokenBar(tokenId) {
  _jdAssignedTokenId = tokenId || null;
  const assignedEl = document.getElementById('sh-token-assigned');
  const assignBtn = document.getElementById('sh-token-assign-btn');
  const chipEl = document.getElementById('sh-token-chip');

  if (_jdAssignedTokenId && St.tokens[_jdAssignedTokenId]) {
    const t = St.tokens[_jdAssignedTokenId];
    const imgSrc = t.tokenImg || null;
    const thumb = imgSrc
      ? `<img class="sh-token-chip-img" src="${imgSrc}" alt="">`
      : `<div class="sh-token-chip-dot">${esc((t.name||'?')[0])}</div>`;
    chipEl.innerHTML = `${thumb}<span>${esc(t.name)}</span>`;
    assignedEl.style.display = 'flex';
    assignBtn.style.display = 'none';
  } else {
    _jdAssignedTokenId = null;
    assignedEl.style.display = 'none';
    assignBtn.style.display = '';
  }
}

function toggleJournalTokenList(e) {
  e.stopPropagation();
  const dd = document.getElementById('sh-token-dropdown');
  if (!dd) return;
  const isOpen = dd.classList.contains('open');
  if (isOpen) { dd.classList.remove('open'); return; }
  renderJournalTokenList();
  const btn = document.getElementById('sh-token-assign-btn') || document.getElementById('sh-token-assigned');
  if (btn) {
    const rect = btn.getBoundingClientRect();
    let top = rect.bottom + 4;
    let left = rect.left + rect.width / 2 - 110;
    if (left < 8) left = 8;
    if (left + 220 > window.innerWidth) left = window.innerWidth - 228;
    if (top + 200 > window.innerHeight) top = rect.top - 204;
    dd.style.top = top + 'px';
    dd.style.left = left + 'px';
  }
  dd.classList.add('open');
}

function renderJournalTokenList() {
  const dd = document.getElementById('sh-token-dropdown');
  if (!dd) return;
  dd.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'jtd-header';
  header.textContent = '토큰 선택';
  dd.appendChild(header);

  const myTokens = getMyTokens();
  if (myTokens.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'jtd-empty';
    empty.textContent = '할당 가능한 토큰이 없어요';
    dd.appendChild(empty);
    return;
  }

  myTokens.forEach(t => {
    const item = document.createElement('div');
    item.className = 'jtd-item' + (_jdAssignedTokenId === t.id ? ' selected' : '');
    const imgSrc = t.tokenImg || null;
    const thumb = imgSrc
      ? `<img class="jtd-item-img" src="${imgSrc}" alt="">`
      : `<div class="jtd-item-dot">${esc((t.name||'?')[0])}</div>`;
    const typeLabel = t.type === 'enemy' ? '적' : t.type === 'npc' ? 'NPC' : 'PC';
    item.innerHTML = `${thumb}<div class="jtd-item-info"><div class="jtd-item-name">${esc(t.name)}</div><div class="jtd-item-type">${typeLabel}</div></div>`;
    item.onclick = (e) => { e.stopPropagation(); assignTokenToJournal(t.id); dd.classList.remove('open'); };
    dd.appendChild(item);
  });
}

function assignTokenToJournal(tokenId) {
  _jdAssignedTokenId = tokenId;
  refreshJournalTokenBar(tokenId);
}

function clearJournalToken() {
  _jdAssignedTokenId = null;
  refreshJournalTokenBar(null);
}

document.addEventListener('click', () => {
  document.getElementById('sh-token-dropdown')?.classList.remove('open');
});

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

function initSheetUI() {
  const grid = document.getElementById('sh-stats-grid');
  if (grid && !grid.children.length) {
    COC_STATS.forEach(s => {
      const div = document.createElement('div');
      div.className = 'stat-card';
      div.innerHTML = `<div class="stat-name">${s.name}</div>
        <input class="stat-val" id="sh-${s.key}" type="number" min="0" max="99" placeholder="0" oninput="updateStatHalf('${s.key}')">
        <div class="stat-half" id="sh-${s.key}-half">½ — / ⅕ —</div>`;
      grid.appendChild(div);
    });
  }

  const wrap = document.getElementById('sh-skills-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const colHead = () => {
    const h = document.createElement('div');
    h.className = 'skill-col-head';
    h.innerHTML = '<span></span><span>기능명</span><span>기본</span><span>현재</span><span>½값</span>';
    return h;
  };

  const perCol = Math.ceil(COC_SKILLS.length / 3);
  [0, 1, 2].forEach(ci => {
    const col = document.createElement('div');
    col.className = 'skill-col-wrap';
    col.appendChild(colHead());
    COC_SKILLS.slice(ci * perCol, (ci + 1) * perCol).forEach((sk, li) => {
      const i = ci * perCol + li;
      const row = document.createElement('div');
      row.className = 'skill-row';
      row.innerHTML = `
        <input type="checkbox" class="skill-check" id="sk-check-${i}">
        <span class="skill-name" title="${sk.name}">${sk.name}</span>
        <span class="skill-base">${sk.base}</span>
        <input class="skill-input" id="sk-val-${i}" type="number" min="0" max="99" value="${sk.base}">
        <input class="skill-input half-val" id="sk-half-${i}" type="number" min="0" max="99" value="${Math.floor(sk.base / 2)}">`;
      col.appendChild(row);
    });
    wrap.appendChild(col);
  });
}

function updateStatHalf(key) {
  const val = parseInt(document.getElementById('sh-'+key)?.value) || 0;
  const el  = document.getElementById('sh-'+key+'-half');
  if (el) el.textContent = `½ ${Math.floor(val/2)} / ⅕ ${Math.floor(val/5)}`;
}

function openSheet(journalId) {
  _sheetIsNew = false;
  const existingWrap = document.getElementById('sh-skills-wrap');
  if (existingWrap) existingWrap.innerHTML = '';
  initSheetUI();
  _sheetJournalId = journalId;
  const list = loadJournals();
  const j    = list.find(x => x.id === journalId);
  const data = j?.sheet || {};

  ['name','player','job','age','residence','birthplace'].forEach(k => {
    const el = document.getElementById('sh-'+k);
    if (el) el.value = data[k] || '';
  });

  COC_STATS.forEach(s => {
    const el = document.getElementById('sh-'+s.key);
    if (el) { el.value = data[s.key] || ''; updateStatHalf(s.key); }
  });

  ['hp','hp-max','san','san-max','mp','mp-max','luck','db','build'].forEach(k => {
    const el = document.getElementById('sh-'+k);
    if (el) el.value = data[k.replace('-','_')] || '';
  });

  COC_SKILLS.forEach((sk, i) => {
    const ck  = document.getElementById('sk-check-'+i);
    const val = document.getElementById('sk-val-'+i);
    const hlf = document.getElementById('sk-half-'+i);
    const d   = data.skills?.[i] || {};
    if (ck)  ck.checked    = d.checked || false;
    if (val) val.value     = d.val  !== undefined ? d.val  : sk.base;
    if (hlf) hlf.value     = d.half !== undefined ? d.half : Math.floor(sk.base/2);
  });

  const notes = document.getElementById('sh-notes');
  if (notes) notes.value = data.notes || '';

  document.getElementById('sh-unarmed-skill').value = data.unarmed_skill || '근접전(격투)';
  document.getElementById('sh-unarmed-dmg').value   = data.unarmed_dmg   || '1d3+db';
  _combatRowCount = 0;
  const tbody = document.getElementById('sh-combat-rows');
  if (tbody) tbody.innerHTML = '';
  (data.combat_rows || []).forEach(row => {
    addCombatRow();
    const i = _combatRowCount - 1;
    document.getElementById('sh-w-name-'+i).value  = row.name  || '';
    document.getElementById('sh-w-skill-'+i).value = row.skill || '';
    document.getElementById('sh-w-dmg-'+i).value   = row.dmg   || '';
    document.getElementById('sh-w-range-'+i).value = row.range || '';
    document.getElementById('sh-w-atk-'+i).value   = row.atk   || '';
    document.getElementById('sh-w-ammo-'+i).value  = row.ammo  || '';
    document.getElementById('sh-w-mal-'+i).value   = row.mal   || '';
  });

  const eq = document.getElementById('sh-equipment'); if (eq) eq.value = data.equipment || '';
  const sp = document.getElementById('sh-spending');  if (sp) sp.value = data.spending  || '';
  const ca = document.getElementById('sh-cash');      if (ca) ca.value = data.cash      || '';
  const as = document.getElementById('sh-assets');    if (as) as.value = data.assets    || '';

  ['appearance','personality','ideology','wounds','people','phobias','places','tomes','treasures','encounters'].forEach(k => {
    const el = document.getElementById('sh-bs-'+k);
    if (el) el.value = data['bs_'+k] || '';
  });

  const hint = document.getElementById('sheet-hint');
  if (hint) hint.textContent = '';

  _sheetAvatarData = saGetAvatar(journalId) || data.avatar || null;
  _sheetAvatarStoredUrl = _sheetAvatarData || null;
  _sheetAvatarUploadPromise = null;
  if (_sheetAvatarData) saSetAvatar(journalId, _sheetAvatarData);  // 캐시 워밍
  refreshSheetAvatar(_sheetAvatarData, (data.name || j?.title || '?')[0]?.toUpperCase());

  refreshJournalTokenBar(j?.assignedTokenId || null);

  _sheetAssignedTo = j?.assignedTo || [];
  refreshSheetAssignBar(j);

  const delBtn = document.querySelector('.sheet-del-btn');
  if (delBtn) delBtn.style.display = '';
  document.getElementById('sheet-overlay').classList.add('open');
}

function closeSheet() {
  document.getElementById('sheet-overlay').classList.remove('open');
  _sheetJournalId = null;
  _sheetIsNew = false;
  _jdAssignedTokenId = null;
  _sheetAssignedTo = [];
  _sheetAvatarUploadPromise = null;
  _sheetAvatarStoredUrl = null;
  if (_sheetAvatarData && /^blob:/i.test(_sheetAvatarData)) {
    try { URL.revokeObjectURL(_sheetAvatarData); } catch (e) {}
  }
  _sheetAvatarData = null;
  const hint = document.getElementById('sheet-hint');
  if (hint) hint.textContent = '';
  renderJournalList();
}

let _combatRowCount = 0;

async function handleSheetAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast('이미지는 10MB 이하여야 해요.'); input.value = ''; return; }

  const journalId = _sheetJournalId;
  const hint = document.getElementById('sheet-hint');
  const prevPreview = _sheetAvatarData;
  const prevStored = _sheetAvatarStoredUrl || _sheetAvatarData || null;
  const previewUrl = URL.createObjectURL(file);

  if (_sheetAvatarData && /^blob:/i.test(_sheetAvatarData)) {
    try { URL.revokeObjectURL(_sheetAvatarData); } catch (e) {}
  }
  _sheetAvatarData = previewUrl;
  refreshSheetAvatar(previewUrl);
  if (hint) hint.textContent = '아바타 업로드 중...';

  const task = uploadJournalAvatarToCloudinary(file, journalId)
    .then(url => {
      if (_sheetAvatarData === previewUrl) {
        try { URL.revokeObjectURL(previewUrl); } catch (e) {}
        _sheetAvatarData = url;
      }
      _sheetAvatarStoredUrl = url;
      if (journalId) {
        saSetAvatar(journalId, url);
        const target = _allJournals.find(x => x.id === journalId);
        if (target) {
          target.avatar = url;
          if (target.sheet && typeof target.sheet === 'object') target.sheet.avatar = url;
          saveJournalFB(target);
        }
        saRefreshToolbar();
        renderJournalList();
      }
      refreshSheetAvatar(url);
      if (hint) hint.textContent = '아바타 업로드 완료 ✓';
      setTimeout(() => {
        const liveHint = document.getElementById('sheet-hint');
        if (liveHint && liveHint.textContent === '아바타 업로드 완료 ✓') liveHint.textContent = '';
      }, 1800);
      return url;
    })
    .catch(err => {
      console.error('journal avatar upload failed', err);
      try { URL.revokeObjectURL(previewUrl); } catch (e) {}
      _sheetAvatarData = prevStored || prevPreview || null;
      _sheetAvatarStoredUrl = prevStored || null;
      refreshSheetAvatar(_sheetAvatarData);
      if (hint) hint.textContent = '';
      showToast('아바타 업로드에 실패했어요. 잠시 후 다시 시도해주세요.');
      return null;
    })
    .finally(() => {
      if (_sheetAvatarUploadPromise === task) _sheetAvatarUploadPromise = null;
    });

  _sheetAvatarUploadPromise = task;
  input.value = '';
  await task;
}

function refreshSheetAvatar(src, initials) {
  const el = document.getElementById('sh-avatar');
  if (!el) return;
  const imgSrc = src || _sheetAvatarData;
  if (imgSrc) {
    el.innerHTML = `<img src="${imgSrc}" alt="avatar"><div class="av-ov">📷</div>`;
  } else {
    const letter = initials || document.getElementById('sh-name')?.value?.trim()[0]?.toUpperCase() || '?';
    el.innerHTML = `<span>${letter}</span><div class="av-ov">📷</div>`;
  }
}

function addCombatRow() {
  const tbody = document.getElementById('sh-combat-rows');
  if (!tbody) return;
  const i = _combatRowCount++;
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid var(--border)';
  tr.innerHTML = `
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-name-${i}" placeholder="무기명" style="font-size:12px"></td>
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-skill-${i}" placeholder="기능명" style="font-size:12px"></td>
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-dmg-${i}" placeholder="1d6" style="font-size:12px;text-align:center"></td>
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-range-${i}" placeholder="—" style="font-size:12px;text-align:center"></td>
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-atk-${i}" placeholder="1" style="font-size:12px;text-align:center"></td>
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-ammo-${i}" placeholder="—" style="font-size:12px;text-align:center"></td>
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-mal-${i}" placeholder="—" style="font-size:12px;text-align:center"></td>`;
  tbody.appendChild(tr);
}

async function saveSheet() {
  if (!_sheetJournalId) return;
  const data = {};

  ['name','player','job','age','residence','birthplace'].forEach(k => {
    data[k] = document.getElementById('sh-'+k)?.value || '';
  });

  if (_sheetIsNew && !data.name.trim()) {
    showToast('저널 이름을 입력해주세요.');
    document.getElementById('sh-name')?.focus();
    return;
  }

  COC_STATS.forEach(s => {
    data[s.key] = parseInt(document.getElementById('sh-'+s.key)?.value) || 0;
  });

  ['hp','hp-max','san','san-max','mp','mp-max','luck','db','build'].forEach(k => {
    const key = k.replace('-','_');
    data[key] = document.getElementById('sh-'+k)?.value || '';
  });

  data.skills = COC_SKILLS.map((sk, i) => ({
    checked: document.getElementById('sk-check-'+i)?.checked || false,
    val:  parseInt(document.getElementById('sk-val-'+i)?.value)  ?? sk.base,
    half: parseInt(document.getElementById('sk-half-'+i)?.value) ?? Math.floor(sk.base/2),
  }));

  data.unarmed_skill = document.getElementById('sh-unarmed-skill')?.value || '';
  data.unarmed_dmg   = document.getElementById('sh-unarmed-dmg')?.value   || '';
  const rows = [];
  for (let i = 0; i < _combatRowCount; i++) {
    const n = document.getElementById('sh-w-name-'+i);
    if (!n) continue;
    rows.push({
      name:  n?.value || '',
      skill: document.getElementById('sh-w-skill-'+i)?.value || '',
      dmg:   document.getElementById('sh-w-dmg-'+i)?.value   || '',
      range: document.getElementById('sh-w-range-'+i)?.value  || '',
      atk:   document.getElementById('sh-w-atk-'+i)?.value    || '',
      ammo:  document.getElementById('sh-w-ammo-'+i)?.value   || '',
      mal:   document.getElementById('sh-w-mal-'+i)?.value    || '',
    });
  }
  data.combat_rows = rows;

  data.equipment = document.getElementById('sh-equipment')?.value || '';
  data.spending   = document.getElementById('sh-spending')?.value  || '';
  data.cash       = document.getElementById('sh-cash')?.value      || '';
  data.assets     = document.getElementById('sh-assets')?.value    || '';

  ['appearance','personality','ideology','wounds','people','phobias','places','tomes','treasures','encounters'].forEach(k => {
    data['bs_'+k] = document.getElementById('sh-bs-'+k)?.value || '';
  });

  if (_sheetAvatarUploadPromise) {
    const hint = document.getElementById('sheet-hint');
    if (hint) hint.textContent = '아바타 업로드 완료를 기다리는 중...';
    await _sheetAvatarUploadPromise;
  }

  const list = _allJournals;
  const existing = list.find(j => j.id === _sheetJournalId);
  if (existing) {
    const _keepAv = getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(
      _sheetAvatarStoredUrl
      || _sheetAvatarData
      || getSharedJournalAvatarRuntime().readStoredAvatar(_sheetJournalId)
      || existing.avatar
      || null
    );
    if (_keepAv) {
      data.avatar      = _keepAv;
      existing.avatar = _keepAv;
      saSetAvatar(_sheetJournalId, _keepAv);
    }
    existing.sheet     = data;
    existing.title     = data.name || existing.title;
    existing.updatedAt = Date.now();
    existing.assignedTokenId = _jdAssignedTokenId || null;
    if (_sheetAssignedTo !== undefined) existing.assignedTo = _sheetAssignedTo || [];
    saveJournalFB(existing);
  } else {
    const newJ = {
      id: _sheetJournalId,
      title: data.name || '무제 저널',
      body: '',
      sheet: data,
      ownerId: St.myId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assignedTokenId: _jdAssignedTokenId || null,
      assignedTo: _sheetAssignedTo || [],
    };
    const newAvatar = getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(_sheetAvatarStoredUrl || _sheetAvatarData || null);
    if (newAvatar) {
      newJ.avatar = newAvatar;
      data.avatar = newAvatar;
      saSetAvatar(_sheetJournalId, newAvatar);
    }
    saveJournalFB(newJ);
    if (_sheetIsNew) {
      _sheetIsNew = false;
      const delBtn = document.querySelector('.sheet-del-btn');
      if (delBtn) delBtn.style.display = '';
    }
  }

  const hint = document.getElementById('sheet-hint');
  if (hint) { hint.textContent = '저장됐어요 ✓'; setTimeout(() => { hint.textContent = ''; }, 2000); }

  closeSheet();
}

