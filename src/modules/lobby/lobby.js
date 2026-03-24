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
    try { return localStorage.getItem('itc_avatar_' + St.myId) || ''; } catch (e) { return ''; }
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
      <button class="cc-del" onclick="removeCampaign(event,'${r.code}','${key}')" title="목록에서 제거">✕</button>
    </div>`;
  }).join('');
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
    const m = document.getElementById('se-msg');
    if (m) { m.textContent = '이미지는 8MB 이하여야 해요.'; m.className = 'profile-msg err'; }
    return;
  }
  const capturedId = _sheetJournalId;  // 비동기 전에 캡처 (sheet 닫혀도 안전)
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const W = 960, H = 540;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const srcR = img.width / img.height;
      const dstR = 16 / 9;
      let sx, sy, sw, sh;
      if (srcR > dstR) {
        sh = img.height; sw = Math.round(sh * dstR);
        sx = Math.round((img.width - sw) / 2); sy = 0;
      } else {
        sw = img.width; sh = Math.round(sw / dstR);
        sx = 0; sy = Math.round((img.height - sh) / 2);
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

      const imgCont = document.getElementById('se-thumb-img');
      if (imgCont) imgCont.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;display:block">`;

      if (window._editSession) window._editSession.pendingCover = dataUrl;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
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

  if (sess.pendingCover) {
    localStorage.setItem('itc_cover_' + sess.code, sess.pendingCover);
    if (window._FB?.CONFIGURED) {
      const { db, ref, update } = window._FB;
      await update(ref(db, `rooms/${sess.code}/meta`),            { cover: sess.pendingCover });
      await update(ref(db, `users/${St.myId}/rooms/${sess.key}`), { cover: sess.pendingCover });
    }
  }

  if (window._FB?.CONFIGURED) {
    const { db, ref, update } = window._FB;
    await update(ref(db, `rooms/${sess.code}/meta`),            { title });
    await update(ref(db, `users/${St.myId}/rooms/${sess.key}`), { title });
  }

  if (msgEl) { msgEl.textContent = '저장됐어요!'; msgEl.className = 'profile-msg ok'; }
  setTimeout(() => closeModal('modal-session-edit'), 900);

  window._editSession = null;
  loadMyCampaigns(); // 카드 목록 갱신
}

async function removeCampaign(e, code, key) {
  e.stopPropagation();
  if (!confirm('세션 목록에서 제거할까요?\n(방 자체는 삭제되지 않아요)')) return;
  const { db, ref, remove } = window._FB;
  await remove(ref(db, `users/${St.myId}/rooms/${key}`));
}

function handleCoverUpload(e, code, key) {
  e.stopPropagation();
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    showToast('이미지는 8MB 이하여야 해요.');
    return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const OUT_W = 960, OUT_H = 540;
      canvas.width  = OUT_W;
      canvas.height = OUT_H;
      const ctx = canvas.getContext('2d');

      const srcRatio = img.width / img.height;
      const dstRatio = 16 / 9;
      let sx, sy, sw, sh;
      if (srcRatio > dstRatio) {
        sh = img.height;
        sw = Math.round(img.height * dstRatio);
        sx = Math.round((img.width - sw) / 2);
        sy = 0;
      } else {
        sw = img.width;
        sh = Math.round(img.width / dstRatio);
        sx = 0;
        sy = Math.round((img.height - sh) / 2);
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      localStorage.setItem('itc_cover_' + code, dataUrl);

      if (window._FB?.CONFIGURED) {
        const { db, ref, update } = window._FB;
        update(ref(db, `rooms/${code}/meta`), { cover: dataUrl });
        update(ref(db, `users/${St.myId}/rooms/${key}`), { cover: dataUrl });
      }

      loadMyCampaigns();
      showToast('커버 이미지가 업데이트됐어요!');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

