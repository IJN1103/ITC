/**
 * ITC TRPG — Chat 모듈
 * 채팅, 잡담, 귓말, 타이핑, 이미지 업로드
 */

let _pendingChatImages = [];
let _pendingWideMode = false;
const MAX_PENDING_CHAT_IMAGES = 4;

function getPendingUploadHost() {
  const inputWrap = document.querySelector('.chat-input-wrap');
  if (!inputWrap || !inputWrap.parentElement) return null;
  return inputWrap.parentElement;
}

function ensurePendingUploadBox() {
  const host = getPendingUploadHost();
  if (!host) return null;
  let box = document.getElementById('chat-pending-upload-box');
  if (box) return box;
  box = document.createElement('div');
  box.id = 'chat-pending-upload-box';
  box.className = 'chat-pending-upload-box';
  host.insertBefore(box, document.querySelector('.chat-input-wrap'));
  return box;
}

function renderPendingUploadBox() {
  const box = ensurePendingUploadBox();
  if (!box) return;
  if (!_pendingChatImages.length) {
    box.innerHTML = '';
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  const thumbs = _pendingChatImages.map(item => `
    <div class="chat-pending-thumb">
      <img src="${esc(item.preview)}" alt="선택 이미지">
      <button type="button" class="chat-pending-remove" onclick="removePendingChatImage('${item.id}')">✕</button>
    </div>
  `).join('');
  box.innerHTML = `
    <div class="chat-pending-top">
      <div class="chat-pending-count">${_pendingChatImages.length}장 선택됨</div>
      <label class="chat-wide-toggle">
        <input type="checkbox" ${_pendingWideMode ? 'checked' : ''} onchange="togglePendingWideMode(this.checked)">
        <span>가로폭 채우기</span>
      </label>
    </div>
    <div class="chat-pending-grid">${thumbs}</div>
  `;
}

function togglePendingWideMode(checked) {
  _pendingWideMode = !!checked;
  _pendingChatImages.forEach(item => item.imageWide = _pendingWideMode);
  renderPendingUploadBox();
}

function removePendingChatImage(id) {
  const removed = _pendingChatImages.find(item => item.id === id);
  if (removed?.preview?.startsWith('blob:')) {
    try { URL.revokeObjectURL(removed.preview); } catch (e) {}
  }
  _pendingChatImages = _pendingChatImages.filter(item => item.id !== id);
  renderPendingUploadBox();
}

function clearPendingChatImages() {
  _pendingChatImages.forEach(item => {
    if (item?.preview?.startsWith('blob:')) {
      try { URL.revokeObjectURL(item.preview); } catch (e) {}
    }
  });
  _pendingChatImages = [];
  renderPendingUploadBox();
}

function scrollChatToLatest(force = false) {
  const paneId = _activeRightTab === 'casual' ? 'casual-messages' : 'chat-messages';
  const container = document.getElementById(paneId);
  if (!container) return;
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
  if (force || nearBottom) scrollChatToLatest();
}

async function prepareUploadDataUrl(file) {
  const isGif = file.type === 'image/gif';
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-failed'));
    reader.onload = ev => {
      const dataUrl = ev.target.result;
      if (isGif) {
        resolve(dataUrl);
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('image-load-failed'));
      img.onload = () => {
        const MAX = 1600;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          const r = Math.min(MAX / w, MAX / h);
          w = Math.round(w * r);
          h = Math.round(h * r);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

async function sendPendingChatImages() {
  if (!_pendingChatImages.length) return false;
  const batch = _pendingChatImages.slice();
  clearPendingChatImages();
  const saJId = St.speakAsJournalId;
  const saJournal = saJId ? loadJournals().find(x => x.id === saJId) : null;
  const saName = saJournal ? (saJournal.title || '무제') : null;
  const saAvatar = saJId ? saGetAvatar(saJId) : null;

  for (const item of batch) {
    try {
      const dataUrl = await prepareUploadDataUrl(item.file);
      if (saJournal) {
        const msg = {
          name: saName,
          text: dataUrl,
          type: 'speak-as-image',
          uid: St.myId,
          time: Date.now(),
          speakAsAvatar: saAvatar,
          speakAsJournalId: saJId,
          imageWide: !!item.imageWide,
        };
        if (window._FB?.CONFIGURED) {
          const { db, ref, push } = window._FB;
          await push(ref(db, `rooms/${St.roomCode}/chat`), msg);
        } else {
          appendChatMsg(msg.name, dataUrl, msg.type, St.myId, msg.time, saAvatar, saJId, null, null, null, null, 'chat', null, null, null, !!msg.imageWide);
        }
      } else {
        sendMessage(St.myName, dataUrl, 'image', { imageWide: !!item.imageWide });
      }
    } catch (e) {
      showToast('이미지 전송 중 오류가 발생했어요.');
    }
  }
  return true;
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
}

function toggleDescMode() {
  if (!hasPerm('sendDesc')) return;
  St.descMode = !St.descMode;
  const btn = document.getElementById('desc-toggle-btn');
  const inp = document.getElementById('chat-input');
  if (btn) btn.classList.toggle('active', St.descMode);
  if (inp) {
    inp.classList.toggle('desc-mode', St.descMode);
    inp.placeholder = St.descMode ? 'desc 입력 중… (Enter 전송)' : '메시지 입력 (Enter 전송)';
    inp.focus();
  }
}

async function sendChat() {
  const inp = document.getElementById('chat-input');
  const raw = (inp?.value || '').trim();

  if (!raw && _pendingChatImages.length) {
    await sendPendingChatImages();
    clearTypingState();
    return;
  }
  if (!raw) return;

  clearTypingState();

  if (St.descMode && hasPerm('sendDesc')) {
    inp.value = '';
    sendMessage(St.myName, raw, 'dsec');
    return;
  }

  const m = raw.match(/^\/desc\s*([\s\S]*)$/i);
  if (m) {
    inp.value = '';
    if (!hasPerm('sendDesc')) { showToast('desc 입력 권한이 없어요.'); return; }
    const content = m[1].trim();
    if (!content) return;
    sendMessage(St.myName, content, 'dsec');
    return;
  }

  const wm = raw.match(/^\/w\s+(\S+)\s+([\s\S]+)$/i);
  if (wm) {
    inp.value = '';
    const targetName = wm[1];
    const whisperText = wm[2].trim();
    if (!whisperText) return;
    const players = St.players || {};
    const target = Object.entries(players).find(([id, p]) => p.name === targetName);
    if (target) {
      sendWhisperMessage(St.myName, whisperText, target[0], targetName);
      return;
    }
    const jTarget = _allJournals.find(j => (j.title || '') === targetName);
    if (jTarget) {
      const ownerId = jTarget.ownerId;
      if (ownerId) {
        sendWhisperMessage(St.speakAsJournalId ? (loadJournals().find(x=>x.id===St.speakAsJournalId)?.title||St.myName) : St.myName, whisperText, ownerId, targetName);
        return;
      }
    }
    showToast(`'${targetName}' 대상을 찾을 수 없어요.`);
    return;
  }

  const cm = raw.match(/^\/choice\s*[\(\（](.+)[\)\）]$/i);
  if (cm) {
    inp.value = '';
    const options = cm[1].split(',').map(s => s.trim()).filter(Boolean);
    if (options.length < 2) { showToast('선택지를 2개 이상 입력해주세요.'); return; }
    const picked = options[Math.floor(Math.random() * options.length)];
    const senderName = St.speakAsJournalId ? (loadJournals().find(x=>x.id===St.speakAsJournalId)?.title || St.myName) : St.myName;
    sendMessage(senderName, `🎯 Choice [${options.join(', ')}] → ${picked}`, 'normal');
    return;
  }

  const dm = raw.match(/^\/(\d*d\d+.*)$/i);
  if (dm) {
    inp.value = '';
    const formula = dm[1].trim();
    rollFromFormula(formula);
    return;
  }

  if (St.whisperTo) {
    inp.value = '';
    const senderName = St.speakAsJournalId ? (loadJournals().find(x=>x.id===St.speakAsJournalId)?.title || St.myName) : St.myName;
    sendWhisperMessage(senderName, raw, St.whisperTo, St.whisperToName);
    return;
  }

  inp.value = '';
  if (_activeRightTab === 'casual') {
    sendCasualMsg(_casualNickname || St.myName, raw);
    return;
  }
  if (St.speakAsJournalId) {
    const j = loadJournals().find(x => x.id === St.speakAsJournalId);
    if (j) {
      saSendMessage(j, raw);
      return;
    }
    St.speakAsJournalId = null;
    saRefreshBtn();
  }
  sendMessage(St.myName, raw, 'normal');
}

function sendMessage(name, text, type = 'normal', extra = {}) {
  const msg = { name, text, type, uid: St.myId, time: Date.now(), ...extra };
  if (type === 'normal' && St.myNameColor && !msg.nameColor) msg.nameColor = St.myNameColor;
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    push(ref(db, `rooms/${St.roomCode}/chat`), msg);
  } else {
    appendChatMsg(name, text, type, St.myId, null, null, null, null, null, msg.nameColor || null, null, 'chat', null, null, null, !!msg.imageWide);
  }
}

function sendCasual() {
  const inp = document.getElementById('chat-input');
  const raw = inp.value.trim();
  if (!raw) return;
  inp.value = '';
  sendCasualMsg(St.myName, raw);
}

function sendCasualMsg(name, text) {
  const msg = { name, text, uid: St.myId, time: Date.now() };
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    push(ref(db, `rooms/${St.roomCode}/casual`), msg);
  } else {
    appendCasualMsg(name, text, St.myId, msg.time);
  }
}

function refreshCasualNickDisplay() {
  const el = document.getElementById('casual-nick-name');
  if (el) el.textContent = _casualNickname || St.myName;
  const avEl = document.getElementById('casual-nick-avatar');
  if (avEl) {
    const avSrc = localStorage.getItem('itc_avatar_' + St.myId) || '';
    if (avSrc) {
      avEl.innerHTML = `<img src="${avSrc}" alt="">`;
    } else {
      avEl.textContent = ((_casualNickname || St.myName || '?')[0] || '?').toUpperCase();
    }
  }
}

function editCasualNick() {
  const current = _casualNickname || St.myName;
  const newNick = prompt('잡담 닉네임을 입력하세요 (18자 이내)', current);
  if (newNick === null) return;
  const trimmed = newNick.trim().slice(0, 18);
  if (!trimmed) { showToast('닉네임을 입력해주세요.'); return; }
  _casualNickname = trimmed;
  try { localStorage.setItem('itc_casual_nick_' + St.myId, trimmed); } catch(e) {}
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, update } = window._FB;
    update(ref(db, `rooms/${St.roomCode}/players/${St.myId}`), { casualNick: trimmed });
  }
  refreshCasualNickDisplay();
}

function loadCasualNick() {
  try { _casualNickname = localStorage.getItem('itc_casual_nick_' + St.myId) || ''; } catch(e) {}
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, get } = window._FB;
    get(ref(db, `rooms/${St.roomCode}/players/${St.myId}/casualNick`)).then(snap => {
      const val = snap.val();
      if (val) {
        _casualNickname = val;
        try { localStorage.setItem('itc_casual_nick_' + St.myId, val); } catch(e) {}
        refreshCasualNickDisplay();
      }
    }).catch(() => {});
  }
}

function loadMyNameColor() {
  try { St.myNameColor = localStorage.getItem('itc_name_color_' + St.myId) || ''; } catch(e) {}
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, get } = window._FB;
    get(ref(db, `rooms/${St.roomCode}/players/${St.myId}/nameColor`)).then(snap => {
      const val = snap.val();
      if (val) {
        St.myNameColor = val;
        try { localStorage.setItem('itc_name_color_' + St.myId, val); } catch(e) {}
      }
    }).catch(() => {});
  }
}

let _typingTimer = null;
let _lastTypingBroadcast = 0;
function broadcastTyping() {
  if (!window._FB?.CONFIGURED || !St.roomCode) return;
  const now = Date.now();
  if (now - _lastTypingBroadcast < 1500) return;
  _lastTypingBroadcast = now;
  const { db, ref, set, remove } = window._FB;
  const tab = _activeRightTab === 'casual' ? 'casual' : 'chat';
  let displayName = St.myName;
  if (tab === 'chat' && St.speakAsJournalId) {
    const j = loadJournals().find(x => x.id === St.speakAsJournalId);
    if (j) displayName = j.title || St.myName;
  } else if (tab === 'casual' && _casualNickname) {
    displayName = _casualNickname;
  }
  set(ref(db, `rooms/${St.roomCode}/typing/${St.myId}`), { name: displayName, tab, time: Date.now() });
  if (_typingTimer) clearTimeout(_typingTimer);
  _typingTimer = setTimeout(() => {
    remove(ref(db, `rooms/${St.roomCode}/typing/${St.myId}`));
    _typingTimer = null;
  }, 3000);
}

function renderTypingIndicator(elId, typingData, tab) {
  const el = document.getElementById(elId);
  if (!el) return;
  const now = Date.now();
  const names = [];
  Object.entries(typingData).forEach(([uid, data]) => {
    if (uid === St.myId) return;
    if (data.tab !== tab) return;
    if (now - (data.time || 0) > 5000) return;
    names.push(data.name || '누군가');
  });
  if (names.length === 0) { el.textContent = ''; return; }
  if (names.length === 1) el.textContent = `${names[0]} is typing...`;
  else if (names.length === 2) el.textContent = `${names[0]}, ${names[1]} are typing...`;
  else el.textContent = `${names.length}명이 입력 중...`;
}

function clearTypingState() {
  if (!window._FB?.CONFIGURED || !St.roomCode) return;
  const { db, ref, remove } = window._FB;
  remove(ref(db, `rooms/${St.roomCode}/typing/${St.myId}`));
  if (_typingTimer) { clearTimeout(_typingTimer); _typingTimer = null; }
}

function saSendCasual(journal, text) {
  const name = journal.title || '무제';
  const avatar = saGetAvatar(journal.id);
  const msg = { name, text: text.replace(/@\S+/g,'').trim(), uid: St.myId, time: Date.now(), speakAsAvatar: avatar, speakAsJournalId: journal.id };
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    push(ref(db, `rooms/${St.roomCode}/casual`), msg);
  } else {
    appendCasualMsg(name, msg.text, St.myId, msg.time);
  }
}

function appendCasualMsg(name, text, uid, timestamp, msgKey) {
  const container = document.getElementById('casual-messages');
  if (!container) return;
  const d = timestamp ? new Date(timestamp) : new Date();
  const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  const avatarHtml = getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));
  const div = document.createElement('div');
  div.className = 'chat-msg msg-normal';
  div.dataset.avatarUid = uid || '';
  div.dataset.avatarName = name || '';
  div.dataset.msgKey = msgKey || '';
  div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name">${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
  addMsgActions(div, uid, msgKey, 'casual', text, 'normal');
  container.appendChild(div);
  scrollChatToLatest();
  if (typeof _popoutWins !== 'undefined') {
    const av = getPopoutAvatarUrl(name, uid);
    _popoutWins.filter(w => w && !w.closed).forEach(w => { if (w.addMsg) w.addMsg(name, text, 'normal', 'casual', '', av, time, fmtText(text)); });
  }
}

function sendWhisperMessage(senderName, text, targetUid, targetName) {
  const msg = {
    name: senderName, text, type: 'whisper',
    uid: St.myId, time: Date.now(),
    whisperTo: targetUid, whisperToName: targetName
  };
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    push(ref(db, `rooms/${St.roomCode}/chat`), msg);
  } else {
    appendChatMsg(msg.name, text, 'whisper', St.myId, msg.time, null, null, targetUid, targetName);
  }
}

function handleChatImageUpload(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;

  const roomLeft = MAX_PENDING_CHAT_IMAGES - _pendingChatImages.length;
  if (roomLeft <= 0) {
    showToast(`이미지는 최대 ${MAX_PENDING_CHAT_IMAGES}장까지 선택할 수 있어요.`);
    input.value = '';
    return;
  }

  const selected = files.slice(0, roomLeft);
  if (files.length > roomLeft) {
    showToast(`이미지는 최대 ${MAX_PENDING_CHAT_IMAGES}장까지 선택할 수 있어요.`);
  }

  selected.forEach(file => {
    const isGif = file.type === 'image/gif';
    const maxSize = isGif ? 5 * 1024 * 1024 : 3 * 1024 * 1024;
    if (file.size > maxSize) {
      showToast(isGif ? 'GIF는 5MB 이하만 가능해요.' : '이미지는 3MB 이하만 가능해요.');
      return;
    }
    if (!file.type.startsWith('image/')) return;
    const id = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    _pendingChatImages.push({ id, file, preview: URL.createObjectURL(file), imageWide: _pendingWideMode });
  });

  renderPendingUploadBox();
  input.value = '';
}

function openLightbox(src) {
  const lb = document.createElement('div');
  lb.className = 'img-lightbox';
  lb.innerHTML = `<img src="${src}" alt="이미지">`;
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

function addLocalMessage(type, name, text) { appendChatMsg(name, text, type); }

function resolveAvatarSrc(name, uid) {
  if (uid && St.players?.[uid]?.avatar) return St.players[uid].avatar;
  if (uid && window._avatarCache?.[uid]) return window._avatarCache[uid];
  if (uid) {
    const localAvatar = localStorage.getItem('itc_avatar_' + uid);
    if (localAvatar) return localAvatar;
  }
  if (name && window._avatarCache?.[name]) return window._avatarCache[name];
  return null;
}

function getAvatarHtml(name, uid) {
  const imgSrc = resolveAvatarSrc(name, uid);
  const initial = (name || '?')[0].toUpperCase();
  const shape_class = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
  const r = St.avatarShape === 'circle' ? '50%' : '6px';
  if (imgSrc) {
    return `<div class="msg-avatar ${shape_class}"><img src="${imgSrc}" alt="${esc(initial)}" style="border-radius:${r}"></div>`;
  }
  return `<div class="msg-avatar ${shape_class}"><div class="msg-avatar-inner" style="border-radius:${r}">${esc(initial)}</div></div>`;
}

function refreshRenderedAvatars() {
  document.querySelectorAll('.chat-msg[data-avatar-name]').forEach(el => {
    const name = el.dataset.avatarName || '';
    const uid = el.dataset.avatarUid || '';
    const avatarEl = el.querySelector('.msg-avatar');
    if (!avatarEl) return;
    avatarEl.outerHTML = getAvatarHtml(name, uid);
  });
}

function appendChatMsg(name, text, type, uid, timestamp, speakAsAvatar, speakAsJournalId, whisperTo, whisperToName, nameColor, msgKey, channel, standingImg, tokenId, standingLabel, imageWide) {
  const container = document.getElementById('chat-messages');
  const d = timestamp ? new Date(timestamp) : new Date();
  const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;

  if (type === 'system' || type === 'sys') {
    const div = document.createElement('div');
    div.className = 'chat-msg msg-sys';
    div.innerHTML = `<div class="msg-text">${fmtText(text)}</div>`;
    container.appendChild(div);
    scrollChatToLatest();
    return;
  }

  if (type === 'dsec') {
    const div = document.createElement('div');
    div.className = 'chat-msg msg-dsec';
    div.innerHTML = `<div class="msg-body"><div class="msg-text">${fmtText(text)}</div></div>`;
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    container.appendChild(div);
    scrollChatToLatest();
    return;
  }

  if (type === 'whisper') {
    const avatarHtml = getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));
    const isMine = uid === St.myId;
    const tagText = isMine ? `→ ${esc(whisperToName || '?')}에게 귓말` : `→ 나에게 귓말`;
    const div = document.createElement('div');
    div.className = 'chat-msg msg-whisper';
    div.dataset.avatarUid = uid || '';
    div.dataset.avatarName = name || '';
  div.dataset.msgKey = msgKey || '';
    div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name">${esc(name)}</span><span class="whisper-tag">${tagText}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    container.appendChild(div);
    scrollChatToLatest();
    return;
  }

  if (type === 'speak-as') {
    const r = St.avatarShape === 'circle' ? '50%' : '6px';
    const sc = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
    const _finalAv = speakAsAvatar || (speakAsJournalId ? saGetAvatar(speakAsJournalId) : null);
    let avHtml;
    if (_finalAv) {
      avHtml = `<div class="msg-avatar ${sc} sa-avatar"><img src="${esc(_finalAv)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:${r};display:block"></div>`;
    } else {
      avHtml = `<div class="msg-avatar ${sc} sa-avatar"><div class="msg-avatar-inner" style="border-radius:${r}">${esc((name||'?')[0].toUpperCase())}</div></div>`;
    }
    const d2 = document.createElement('div');
    d2.className = 'chat-msg msg-speak-as';
    const _jColor = nameColor || (speakAsJournalId ? (_allJournals.find(x => x.id === speakAsJournalId)?.nameColor || '') : '');
    const _nameStyle = _jColor ? ` style="color:${_jColor}"` : '';
    d2.innerHTML = `${avHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name sa-msg-name"${_nameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text.replace(/@\S+/g,'').trim())}</div></div>`;
    addMsgActions(d2, uid, msgKey, channel || 'chat', text, type);
    container.appendChild(d2);
    scrollChatToLatest();
    if (!timestamp || Date.now() - timestamp < 5000) {
      showDialogueBoxFromMsg(name, text, speakAsJournalId, standingImg, tokenId, standingLabel);
    }
    return;
  }
  if (type === 'speak-as-image') {
    const r = St.avatarShape === 'circle' ? '50%' : '6px';
    const sc = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
    const _finalAv = speakAsAvatar || (speakAsJournalId ? saGetAvatar(speakAsJournalId) : null);
    let avHtml;
    if (_finalAv) {
      avHtml = `<div class="msg-avatar ${sc} sa-avatar"><img src="${esc(_finalAv)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:${r};display:block"></div>`;
    } else {
      avHtml = `<div class="msg-avatar ${sc} sa-avatar"><div class="msg-avatar-inner" style="border-radius:${r}">${esc((name||'?')[0].toUpperCase())}</div></div>`;
    }
    const d2 = document.createElement('div');
    d2.className = `chat-msg msg-speak-as msg-image-msg ${imageWide ? 'msg-image-wide-row' : ''}`;
    d2.dataset.avatarUid = uid || ''; d2.dataset.avatarName = name || ''; d2.dataset.msgKey = msgKey || ''; d2.innerHTML = `${avHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name sa-msg-name">${esc(name)}</span><span class="msg-time">${time}</span></div><img class="msg-image ${imageWide ? 'is-wide' : ''}" src="${esc(text)}" alt="첨부 이미지" onclick="openLightbox(this.src)"></div>`;
    container.appendChild(d2);
    scrollChatToLatest();
    return;
  }

  const avatarHtml = getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));

  if (type === 'image') {
    const div = document.createElement('div');
    div.className = `chat-msg msg-image-msg ${imageWide ? 'msg-image-wide-row' : ''}`;
    div.dataset.avatarUid = uid || '';
    div.dataset.avatarName = name || '';
  div.dataset.msgKey = msgKey || '';
    div.dataset.msgKey = msgKey || ''; div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name">${esc(name)}</span><span class="msg-time">${time}</span></div><img class="msg-image ${imageWide ? 'is-wide' : ''}" src="${esc(text)}" alt="첨부 이미지" onclick="openLightbox(this.src)"></div>`;
    container.appendChild(div);
    scrollChatToLatest();
    return;
  }

  const div = document.createElement('div');
  div.className = `chat-msg msg-${type}`;
  div.dataset.avatarUid = uid || '';
  div.dataset.avatarName = name || '';
  div.dataset.msgKey = msgKey || '';
  const _nc = nameColor ? ` style="color:${nameColor}"` : '';
  if (type === 'dice') {
    const diceMatch = text.match(/🎲\s*(.+?)\s*→\s*(\d+)\s*\(([^)]+)\)/);
    if (diceMatch) {
      const formula = diceMatch[1].trim();
      const result = diceMatch[2];
      const rolls = diceMatch[3].trim();
      div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${_nc}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div><div class="dice-card"><div class="dice-card-formula">${esc(formula)}</div><div class="dice-card-result">${esc(result)}</div><div class="dice-card-rolls">${esc(rolls)}</div></div></div>`;
    } else {
      div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${_nc}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
    }
  } else {
    div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${_nc}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
  }
  addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
  container.appendChild(div);
  scrollChatToLatest();
}



function upsertChatMessageFromRemote(msg, channel = "chat") {
  const container = document.getElementById(channel === "casual" ? "casual-messages" : "chat-messages");
  if (!container) return;
  const key = msg?._key;
  if (!key) return;
  const existing = container.querySelector(`.chat-msg[data-msg-key="${key}"]`);
  if (existing) existing.remove();
  if (channel === "casual") {
    appendCasualMsg(msg.name, msg.text, msg.uid, msg.time, key);
    return;
  }
  appendChatMsg(msg.name, msg.text, msg.type || "normal", msg.uid, msg.time, msg.speakAsAvatar || null, msg.speakAsJournalId || null, msg.whisperTo || null, msg.whisperToName || null, msg.nameColor || null, key, channel, msg.standingImg || null, msg.tokenId || null, msg.standingLabel || null, !!msg.imageWide);
}

function removeChatMessageFromRemote(key, channel = "chat") {
  const container = document.getElementById(channel === "casual" ? "casual-messages" : "chat-messages");
  if (!container || !key) return;
  const el = container.querySelector(`.chat-msg[data-msg-key="${key}"]`);
  if (el) el.remove();
}
