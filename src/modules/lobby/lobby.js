
function getSharedAvatarRuntime() {
  if (window._itcAvatarRuntime) return window._itcAvatarRuntime;
  return {
    sanitizePersistentAvatarSrc(src) {
      const value = String(src || '').trim();
      if (!value) return '';
      if (/^data:image\//i.test(value) || /^blob:/i.test(value)) return '';
      return value;
    },
    readStoredAvatar(uid) {
      if (!uid) return '';
      try {
        const safe = this.sanitizePersistentAvatarSrc(localStorage.getItem('itc_avatar_' + uid));
        if (!safe) {
          localStorage.removeItem('itc_avatar_' + uid);
          localStorage.removeItem('itc_avatar_path_' + uid);
        }
        return safe;
      } catch (e) {
        return '';
      }
    },
    writeStoredAvatar(uid, src, storagePath = '') {
      if (!uid) return '';
      const safe = this.sanitizePersistentAvatarSrc(src);
      try {
        if (safe) {
          localStorage.setItem('itc_avatar_' + uid, safe);
          if (storagePath) localStorage.setItem('itc_avatar_path_' + uid, storagePath);
          else localStorage.removeItem('itc_avatar_path_' + uid);
        } else {
          localStorage.removeItem('itc_avatar_' + uid);
          localStorage.removeItem('itc_avatar_path_' + uid);
        }
      } catch (e) {}
      return safe;
    },
    rememberAvatar(uid, name, src) {
      window._avatarCache = window._avatarCache || {};
      const safe = this.sanitizePersistentAvatarSrc(src);
      if (uid) {
        if (safe) window._avatarCache[uid] = safe;
        else delete window._avatarCache[uid];
      }
      if (name) {
        if (safe) window._avatarCache[name] = safe;
        else delete window._avatarCache[name];
      }
      return safe;
    },
  };
}

/**
 * ITC TRPG — Lobby 모듈
 * 방 생성/입장, 캠페인, 캐릭터 선택
 */

let selectedSystem = 'coc7';
let _myCharsUnsub = null;

function showLobby() {
  document.getElementById('screen-auth').style.display  = 'none';
  document.getElementById('screen-game').style.display  = 'none';
  document.getElementById('screen-lobby').style.display = 'flex';
  document.getElementById('user-name-nav').textContent  = St.myName;
  refreshProfileAvatar();
  loadMyCharacters();
  loadMyCampaigns();
}

/* 내 캐릭터 목록 Firebase에서 로드 */
async function loadMyCharacters() {
  if (!window._FB?.CONFIGURED || !window._currentUser) return;
  const { db, ref, onValue } = window._FB;
  if (_myCharsUnsub) { _myCharsUnsub(); _myCharsUnsub = null; }
  _myCharsUnsub = onValue(ref(db, `users/${St.myId}/characters`), snap => {
    const chars = snap.val() || {};
    window._cachedChars = chars;
    renderCharCards(chars);
  });
}

function renderCharCards(chars) {
  const bar = document.getElementById('my-chars-bar');
  const row = document.getElementById('char-cards-row');
  const entries = Object.entries(chars);
  bar.style.display = entries.length > 0 ? 'block' : 'none';
  row.innerHTML = entries.map(([cid, ch]) => `
    <div onclick="selectMyChar('${cid}')" style="
      flex-shrink:0;width:130px;background:var(--s2);border:1px solid var(--border);
      border-radius:var(--rl);padding:12px;cursor:pointer;transition:var(--t);
      ${St.selectedCharId === cid ? 'border-color:var(--accent);background:var(--a-dim)' : ''}
    " onmouseover="this.style.borderColor='var(--border2)'" onmouseout="this.style.borderColor='${St.selectedCharId===cid?'var(--accent)':'var(--border)'}' ">
      <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:5px">${SYS_LABELS[ch.system]||ch.system}</div>
      <div style="font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ch.name||'이름 없음')}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px">${ch.job?esc(ch.job):''}</div>
    </div>`).join('');
}

function selectMyChar(cid) {
  St.selectedCharId = cid;
  if (!window._FB?.CONFIGURED || !window._currentUser) return;
  const { db, ref, get } = window._FB;
  get(ref(db, `users/${St.myId}/characters/${cid}`)).then(snap => {
    if (snap.exists()) {
      St.character = snap.val();
      St.system = snap.val().system || 'coc7';
      document.querySelectorAll('.sys-btn').forEach(b => b.classList.remove('selected'));
      const sysMap = {coc7:0,dx3:1,shinobigami:2,insane:3};
      const idx = sysMap[St.system] ?? 0;
      document.querySelectorAll('.sys-btn')[idx]?.classList.add('selected');
      selectedSystem = St.system;
    }
  });
  document.querySelectorAll('#char-cards-row > div').forEach((el,i) => {
    const id = Object.keys(window._cachedChars||{})[i];
    el.style.borderColor = (id === cid) ? 'var(--accent)' : 'var(--border)';
    el.style.background  = (id === cid) ? 'var(--a-dim)'  : 'var(--s2)';
  });
}

async function createNewCharacter() {
  const name = document.getElementById('new-char-name').value.trim();
  const sys  = document.getElementById('new-char-system').value;
  if (!name) { alert('캐릭터 이름을 입력해주세요.'); return; }
  if (!window._FB?.CONFIGURED || !window._currentUser) return;

  const { db, ref, push } = window._FB;
  const defaults = {
    coc7: { str:50,con:50,siz:50,dex:50,app:50,int:50,pow:50,edu:50, hp:10,hpMax:10,mp:10,mpMax:10,san:50,sanMax:50, skills:{도서관:20,심리학:10,의학:5,법률:5,역사:5,격투:25,권총:20,회피:25,은신:20,추적:10,설득:15,위협:15,오컬트:5,자연:10,수영:20,응급처치:30}, notes:'' },
    dx3:  { hp:30,hpMax:30,enc:5,encMax:5, notes:'' },
    shinobigami: { ninjutsu:Array(9).fill(''), notes:'' },
    insane: { hp:6,hpMax:6, notes:'' },
  };

  const charData = {
    name, system: sys, job:'',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...(defaults[sys] || {}),
  };

  await push(ref(db, `users/${St.myId}/characters`), charData);
  closeModal('modal-new-char');
  document.getElementById('new-char-name').value = '';
}

function selectSystem(sys, btn) {
  selectedSystem = sys;
  document.querySelectorAll('.sys-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, () => c[Math.floor(Math.random()*c.length)]).join('');
}
function genId() { return Math.random().toString(36).slice(2, 10); }

function getPlayerPayload(role) {
  const avatar = (() => {
    try {
      return getSharedAvatarRuntime().readStoredAvatar(St.myId);
    } catch (e) {
      return '';
    }
  })();
  const casualNick = (() => {
    try { return localStorage.getItem('itc_casual_nick_' + St.myId) || ''; } catch (e) { return ''; }
  })();
  const nameColor = (() => {
    try { return localStorage.getItem('itc_name_color_' + St.myId) || ''; } catch (e) { return ''; }
  })();

  return {
    name: St.myName,
    joinedAt: Date.now(),
    uid: St.myId,
    role,
    avatar,
    casualNick,
    nameColor,
    online: true,
    updatedAt: Date.now(),
  };
}

async function createRoom() {
  if (window._FB?.CONFIGURED && !window._currentUser) {
    alert('방을 만들려면 로그인이 필요합니다.');
    return;
  }
  const code = genCode();
  St.roomCode = code; St.system = selectedSystem;

  const titleInput = document.getElementById('room-title');
  const roomTitle = titleInput ? titleInput.value.trim() || '무제 세션' : '무제 세션';
  if (titleInput) titleInput.value = '';

  if (window._FB?.CONFIGURED) {
    const { db, ref, set } = window._FB;
    await set(ref(db, `rooms/${code}/meta`), {
      system: selectedSystem, createdAt: Date.now(),
      createdBy: St.myName, ownerId: St.myId, title: roomTitle,
    });
    await set(ref(db, `rooms/${code}/players/${St.myId}`), getPlayerPayload('gm'));
    await set(ref(db, `users/${St.myId}/rooms/${code}`), {
      code, title: roomTitle, system: selectedSystem,
      role: 'gm', ownerId: St.myId, joinedAt: Date.now(),
    });
    setupFirebaseListeners();
  }

  St.isGM = true;
  saveRecentRoom(code, selectedSystem);
  enterGame();
}

async function joinRoom() {
  if (window._FB?.CONFIGURED && !window._currentUser) {
    alert('방에 참가하려면 로그인이 필요합니다.');
    return;
  }
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length !== 6) { alert('방 코드는 6자리입니다.'); return; }

  if (window._FB?.CONFIGURED) {
    const { db, ref, get, set } = window._FB;
    let snap;
    try {
      snap = await get(ref(db, `rooms/${code}/meta`));
    } catch(e) {
      alert('방을 찾는 중 오류가 발생했습니다. 로그인 상태를 확인해 주세요.');
      return;
    }
    if (!snap.exists()) { alert('방을 찾을 수 없습니다. 코드를 다시 확인해 주세요.'); return; }

    const playersSnap = await get(ref(db, `rooms/${code}/players`));
    const playersData = playersSnap.exists() ? playersSnap.val() : {};
    const playerCount = Object.keys(playersData).length;
    const alreadyJoined = !!playersData[St.myId];
    if (playerCount >= 5 && !alreadyJoined) {
      alert('이 방은 이미 최대 인원(5명)에 도달했습니다.');
      return;
    }

    St.system = snap.val().system || 'coc7';
    St.roomCode = code;
    const meta = snap.val();
    const role = meta.ownerId === St.myId ? 'gm' : 'player';
    St.isGM = (role === 'gm');
    await set(ref(db, `rooms/${code}/players/${St.myId}`), getPlayerPayload(role));
    await set(ref(db, `users/${St.myId}/rooms/${code}`), {
      code, title: meta.title || '무제 세션',
      system: meta.system || 'coc7',
      role, ownerId: meta.ownerId || '', joinedAt: Date.now(),
    });
    setupFirebaseListeners();
  } else {
    St.roomCode = code; St.system = selectedSystem;
    St.isGM = false;
  }

  saveRecentRoom(code, St.system);
  enterGame();
}

/* 최근 방 */
function saveRecentRoom(code, sys) {
  const rooms = JSON.parse(localStorage.getItem('tt_recent') || '[]');
  const filtered = rooms.filter(r => r.code !== code);
  filtered.unshift({ code, sys, time: Date.now() });
  localStorage.setItem('tt_recent', JSON.stringify(filtered.slice(0, 5)));
}

function loadRecentRooms() {
  St.recentRooms = JSON.parse(localStorage.getItem('tt_recent') || '[]');
}

async function quickJoin(code) {
  document.getElementById('join-code').value = code;
  await joinRoom();
}

let _campaignUnsub = null;

function loadMyCampaigns() {
  if (!window._FB?.CONFIGURED || !window._currentUser) return;
  const { db, ref, onValue } = window._FB;

  if (_campaignUnsub) { _campaignUnsub(); _campaignUnsub = null; }

  _campaignUnsub = onValue(ref(db, `users/${St.myId}/rooms`), snap => {
    const rooms = snap.val() || {};
    renderCampaigns(rooms);
  });
}

function renderCampaigns(rooms) {
  const grid  = document.getElementById('campaign-grid');
  const count = document.getElementById('campaign-count');
  if (!grid) return;

  const entries = Object.entries(rooms).sort((a, b) => (b[1].joinedAt||0) - (a[1].joinedAt||0));
  count.textContent = entries.length ? `${entries.length}개` : '';

  if (!entries.length) {
    grid.innerHTML = '<div class="campaign-empty">아직 참가한 세션이 없어요.<br>방을 만들거나 코드로 참가해보세요!</div>';
    return;
  }

  grid.innerHTML = entries.map(([key, r]) => {
    const imgKey  = 'itc_cover_' + r.code;
    const imgData = localStorage.getItem(imgKey);
    const isGM    = r.role === 'gm' || r.ownerId === St.myId;

    const thumbHtml = imgData
      ? `<img src="${imgData}" alt="커버">`
      : `<div class="cc-thumb-placeholder"><div class="cc-ph-icon">🎲</div><span>${esc(SYS_LABELS[r.system] || r.system || '')}</span></div>`;

    const overlayHtml = isGM
      ? `<label class="cc-thumb-overlay" title="커버 이미지 변경" onclick="event.stopPropagation()">
           📷 커버 변경
           <input type="file" accept="image/*" style="display:none"
             onchange="handleCoverUpload(event,'${r.code}','${key}')">
         </label>`
      : '';

    return `
    <div class="campaign-card" onclick="enterCampaign('${r.code}')">
      <div class="cc-thumb">
        ${thumbHtml}
        ${overlayHtml}
      </div>
      <div class="cc-body">
        <div class="cc-role ${isGM ? 'gm' : 'pl'}">${isGM ? 'GM' : '플레이어'}</div>
        <div class="cc-title">${esc(r.title || '무제 세션')}</div>
        <div class="cc-sys">${SYS_LABELS[r.system] || r.system || ''}</div>
        <div class="cc-code"># ${esc(r.code)}</div>
        <button class="cc-enter" onclick="event.stopPropagation();enterCampaign('${r.code}')">입장 →</button>
      </div>
      ${isGM ? `<button class="cc-edit" onclick="openSessionEdit(event,'${r.code}','${key}','${esc(r.title||'무제 세션')}')" title="세션 설정">✎</button>` : ''}
      <button class="cc-del" onclick="removeCampaign(event,'${r.code}','${key}',${isGM ? 'true' : 'false'})" title="${isGM ? '세션 완전 삭제' : '목록에서 제거'}">✕</button>
    </div>`;
  }).join('');
}


function getCloudinaryConfig() { return _itcGetCloudinaryConfig(); }
function lobbyWithTimeout(promise, ms) { return _itcWithTimeout(promise, ms || 12000); }
function lobbyCanvasToBlob(canvas, type, quality) { return _itcCanvasToBlob(canvas, type || 'image/jpeg', quality || 0.82); }

async function uploadLobbyBlobToCloudinary(blob, folder = 'itc/session-covers') {
  const result = await _itcUploadToCloudinary({ blob, folder, timeout: 15000 });
  return result.url;
}

async function makeCoverBlobFromFile(file) {
  const bmp = await createImageBitmap(file);
  try {
    const W = 960, H = 540;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const srcR = bmp.width / bmp.height;
    const dstR = 16 / 9;
    let sx, sy, sw, sh;
    if (srcR > dstR) {
      sh = bmp.height;
      sw = Math.round(sh * dstR);
      sx = Math.round((bmp.width - sw) / 2);
      sy = 0;
    } else {
      sw = bmp.width;
      sh = Math.round(sw / dstR);
      sx = 0;
      sy = Math.round((bmp.height - sh) / 2);
    }
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, W, H);
    return await lobbyCanvasToBlob(canvas, 'image/jpeg', 0.82);
  } finally {
    if (bmp && typeof bmp.close === 'function') bmp.close();
  }
}

function setSessionEditMessage(text, type = '') {
  const m = document.getElementById('se-msg');
  if (!m) return;
  m.textContent = text || '';
  m.className = type ? `profile-msg ${type}` : 'profile-msg';
}

function revokeSessionEditPreview() {
  const sess = window._editSession;
  if (sess?._pendingCoverPreview && String(sess._pendingCoverPreview).startsWith('blob:')) {
    try { URL.revokeObjectURL(sess._pendingCoverPreview); } catch (e) {}
  }
  if (sess) sess._pendingCoverPreview = '';
}

async function enterCampaign(code) {
  document.getElementById('join-code').value = code;
  await joinRoom();
}

function openSessionEdit(e, code, key, title) {
  e.stopPropagation();
  window._editSession = { code, key };

  const titleEl = document.getElementById('se-title-input');
  if (titleEl) titleEl.value = title;

  const imgContainer = document.getElementById('se-thumb-img');
  const saved = localStorage.getItem('itc_cover_' + code);
  if (imgContainer) {
    if (saved) {
      imgContainer.innerHTML = `<img src="${saved}" style="width:100%;height:100%;object-fit:cover;display:block">`;
    } else {
      imgContainer.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;color:var(--muted);font-size:12px;background:var(--s2)"><span style="font-size:24px;opacity:.4">🎲</span><span>커버 없음</span></div>`;
    }
  }

  const msgEl = document.getElementById('se-msg');
  if (msgEl) { msgEl.textContent = ''; msgEl.className = 'profile-msg'; }

  openModal('modal-session-edit');
}

function handleSessionCoverUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    setSessionEditMessage('이미지는 8MB 이하여야 해요.', 'err');
    return;
  }
  const sess = window._editSession || (window._editSession = {});
  revokeSessionEditPreview();
  const previewUrl = URL.createObjectURL(file);
  const imgCont = document.getElementById('se-thumb-img');
  if (imgCont) imgCont.innerHTML = `<img src="${previewUrl}" style="width:100%;height:100%;object-fit:cover;display:block">`;
  sess.pendingCoverFile = file;
  sess._pendingCoverPreview = previewUrl;
  setSessionEditMessage('커버 이미지를 적용할 준비가 됐어요. 저장을 누르면 업로드돼요.', 'ok');
  input.value = '';
}


async function saveSessionEdit() {
  const sess = window._editSession;
  if (!sess) return;

  const title  = document.getElementById('se-title-input')?.value.trim();
  const msgEl  = document.getElementById('se-msg');

  if (!title) {
    if (msgEl) { msgEl.textContent = '세션 이름을 입력해 주세요.'; msgEl.className = 'profile-msg err'; }
    return;
  }

  let finalCover = null;
  if (sess.pendingCoverFile) {
    try {
      setSessionEditMessage('커버 이미지를 업로드하는 중이에요…', '');
      const coverBlob = await makeCoverBlobFromFile(sess.pendingCoverFile);
      finalCover = await uploadLobbyBlobToCloudinary(coverBlob, `itc/session-covers/${sess.code}`);
    } catch (err) {
      console.error('session cover upload failed', err);
      setSessionEditMessage('커버 업로드에 실패했어요. 다시 시도해 주세요.', 'err');
      return;
    }
    localStorage.setItem('itc_cover_' + sess.code, finalCover);
    if (window._FB?.CONFIGURED) {
      const { db, ref, update } = window._FB;
      await update(ref(db, `rooms/${sess.code}/meta`),            { cover: finalCover });
      await update(ref(db, `users/${St.myId}/rooms/${sess.key}`), { cover: finalCover });
    }
  }

  if (window._FB?.CONFIGURED) {
    const { db, ref, update } = window._FB;
    await update(ref(db, `rooms/${sess.code}/meta`),            { title });
    await update(ref(db, `users/${St.myId}/rooms/${sess.key}`), { title });
  }

  if (msgEl) { msgEl.textContent = '저장됐어요!'; msgEl.className = 'profile-msg ok'; }
  setTimeout(() => closeModal('modal-session-edit'), 900);

  revokeSessionEditPreview();
  window._editSession = null;
  loadMyCampaigns(); // 카드 목록 갱신
}

async function removeCampaign(e, code, key, isGM = false) {
  e.stopPropagation();
  if (!window._FB?.CONFIGURED) return;

  const { db, ref, remove, get, update } = window._FB;

  if (isGM) {
    if (!confirm('이 세션을 완전히 삭제할까요?\n삭제하면 방 자체와 참가자 목록에서 모두 사라져요.')) return;

    try {
      const playersSnap = await get(ref(db, `rooms/${code}/players`));
      const playerIds = playersSnap.exists() ? Object.keys(playersSnap.val() || {}) : [];

      /* 각 유저의 rooms 목록에서 제거 */
      for (const uid of playerIds) {
        try { await remove(ref(db, `users/${uid}/rooms/${code}`)); } catch (e) {}
      }
      /* 방 자체 삭제 */
      await remove(ref(db, `rooms/${code}`));

      try { localStorage.removeItem('itc_cover_' + code); } catch (err) {}
      try {
        const recent = JSON.parse(localStorage.getItem('tt_recent') || '[]').filter((room) => room.code !== code);
        localStorage.setItem('tt_recent', JSON.stringify(recent));
      } catch (err) {}

      showToast('세션이 완전히 삭제됐어요.');
    } catch (err) {
      console.error('campaign delete failed', err);
      showToast('세션 삭제에 실패했어요. 다시 시도해 주세요.');
    }
    return;
  }

  if (!confirm('세션 목록에서 제거할까요?\n(방 자체는 삭제되지 않아요)')) return;
  try {
    await remove(ref(db, `users/${St.myId}/rooms/${key}`));
  } catch (err) {
    console.error('campaign remove failed', err);
    showToast('세션 목록에서 제거하지 못했어요. 다시 시도해 주세요.');
  }
}

async function handleCoverUpload(e, code, key) {
  e.stopPropagation();
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    showToast('이미지는 8MB 이하여야 해요.');
    return;
  }
  try {
    showToast('커버 이미지를 업로드하는 중이에요…');
    const coverBlob = await makeCoverBlobFromFile(file);
    const coverUrl = await uploadLobbyBlobToCloudinary(coverBlob, `itc/session-covers/${code}`);
    localStorage.setItem('itc_cover_' + code, coverUrl);
    if (window._FB?.CONFIGURED) {
      const { db, ref, update } = window._FB;
      await update(ref(db, `rooms/${code}/meta`), { cover: coverUrl });
      await update(ref(db, `users/${St.myId}/rooms/${key}`), { cover: coverUrl });
    }
    loadMyCampaigns();
    showToast('커버 이미지가 업데이트됐어요!');
  } catch (err) {
    console.error('campaign cover upload failed', err);
    showToast('커버 이미지 업로드에 실패했어요. 다시 시도해 주세요.');
  } finally {
    e.target.value = '';
  }
}


