/**
 * ITC TRPG — Chat 모듈
 * 채팅, 잡담, 귓말, 타이핑, 이미지 업로드
 */


let _pendingChatImages = [];
const MAX_PENDING_CHAT_IMAGES = 4;
let _chatImageWideMode = false;

function ensureChatImageInputConfig() {
  const input = document.getElementById('chat-img-input');
  if (input) input.multiple = true;
  return input;
}

function loadChatImageWideMode() {
  try {
    _chatImageWideMode = localStorage.getItem('itc_chat_image_wide_mode') === '1';
  } catch (e) {
    _chatImageWideMode = false;
  }
}

function setChatImageWideMode(enabled) {
  _chatImageWideMode = !!enabled;
  try {
    localStorage.setItem('itc_chat_image_wide_mode', _chatImageWideMode ? '1' : '0');
  } catch (e) {}
  const checkbox = document.getElementById('chat-image-wide-toggle');
  if (checkbox) checkbox.checked = _chatImageWideMode;
}

function getChatImageWideMode() {
  const checkbox = document.getElementById('chat-image-wide-toggle');
  return checkbox ? !!checkbox.checked : _chatImageWideMode;
}

function getChatImageInlineStyle(isWide) {
  const sizeStyle = isWide
    ? 'max-width:min(100%, 560px);width:auto;'
    : 'max-width:220px;width:auto;';
  return `display:block;${sizeStyle}height:auto;margin-top:5px;border-radius:var(--r);border:1px solid var(--border);cursor:zoom-in`;
}

function getPendingChatImageBox() {
  const inputWrap = document.querySelector('.chat-input-wrap');
  if (!inputWrap || !inputWrap.parentNode) return null;
  let box = document.getElementById('chat-pending-image-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'chat-pending-image-box';
    box.style.display = 'none';
    box.style.margin = '0 10px 8px';
    box.style.padding = '8px';
    box.style.border = '1px solid var(--border)';
    box.style.borderRadius = '10px';
    box.style.background = 'var(--panel, rgba(255,255,255,0.04))';
    box.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px;">
        <div style="min-width:0;">
          <div id="chat-pending-image-summary" style="font-size:12px;opacity:.8;">0장 선택됨</div>
          <label style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;opacity:.82;cursor:pointer;user-select:none;">
            <input id="chat-image-wide-toggle" type="checkbox" onchange="setChatImageWideMode(this.checked)" style="margin:0;accent-color:var(--accent,#8b5cf6);">
            <span>가로 제한 해제</span>
          </label>
        </div>
        <button type="button" onclick="clearPendingChatImage()" title="선택한 이미지 전체 취소" style="border:1px solid var(--border);background:transparent;color:inherit;border-radius:8px;padding:4px 8px;cursor:pointer;line-height:1;">전체 취소</button>
      </div>
      <div id="chat-pending-image-list" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
    `;
    inputWrap.parentNode.insertBefore(box, inputWrap);
  }
  const checkbox = document.getElementById('chat-image-wide-toggle');
  if (checkbox) checkbox.checked = _chatImageWideMode;
  return box;
}

function refreshPendingChatImageBox() {
  ensureChatImageInputConfig();
  const box = getPendingChatImageBox();
  if (!box) return;
  const list = document.getElementById('chat-pending-image-list');
  const summary = document.getElementById('chat-pending-image-summary');
  if (!_pendingChatImages.length) {
    box.style.display = 'none';
    if (list) list.innerHTML = '';
    return;
  }
  if (summary) {
    const count = _pendingChatImages.length;
    summary.textContent = `${count}장 선택됨`; 
  }
  if (list) {
    list.innerHTML = _pendingChatImages.map((item, index) => `
      <div style="width:84px;min-width:84px;">
        <div style="position:relative;">
          <img src="${item.dataUrl}" alt="선택한 이미지 ${index + 1}" style="display:block;width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid var(--border);background:#111;">
          <button type="button" onclick="removePendingChatImage(${index})" title="이 이미지 취소" style="position:absolute;top:4px;right:4px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.65);color:#fff;border-radius:999px;width:22px;height:22px;cursor:pointer;line-height:1;">✕</button>
        </div>
        <div style="font-size:11px;opacity:.85;margin-top:4px;word-break:break-all;">${esc(item.fileName || `이미지 ${index + 1}`)}</div>
      </div>
    `).join('');
  }
  box.style.display = 'block';
}

function addPendingChatImages(items) {
  if (!items.length) return;
  const available = MAX_PENDING_CHAT_IMAGES - _pendingChatImages.length;
  if (available <= 0) {
    showToast('이미지는 한 번에 최대 4장까지 보낼 수 있어요.');
    return;
  }
  const accepted = items.slice(0, available);
  _pendingChatImages = _pendingChatImages.concat(accepted);
  if (accepted.length < items.length) {
    showToast('이미지는 한 번에 최대 4장까지 보낼 수 있어요.');
  }
  refreshPendingChatImageBox();
}

function removePendingChatImage(index) {
  if (index < 0 || index >= _pendingChatImages.length) return;
  _pendingChatImages.splice(index, 1);
  refreshPendingChatImageBox();
}

function clearPendingChatImage() {
  _pendingChatImages = [];
  const input = ensureChatImageInputConfig();
  if (input) input.value = '';
  refreshPendingChatImageBox();
}

function sendPreparedChatImage(dataUrl, wideMode = false) {
  if (!dataUrl) return;
  const saJId = St.speakAsJournalId;
  const saJournal = saJId ? loadJournals().find(x => x.id === saJId) : null;
  const saName = saJournal ? (saJournal.title || '무제') : null;
  const saAvatar = saJId ? saGetAvatar(saJId) : null;

  if (saJournal) {
    const msg = {
      name: saName, text: dataUrl, type: 'speak-as-image',
      uid: St.myId, time: Date.now(), imageWide: !!wideMode,
      speakAsAvatar: saAvatar, speakAsJournalId: saJId
    };
    if (window._FB?.CONFIGURED) {
      const { db, ref, push } = window._FB;
      push(ref(db, `rooms/${St.roomCode}/chat`), msg);
    } else {
      appendChatMsg(msg.name, dataUrl, 'speak-as-image', St.myId, msg.time, saAvatar, saJId, null, null, null, null, null, null, null, null, !!wideMode);
    }
  } else {
    sendMessage(St.myName, dataUrl, 'image', { imageWide: !!wideMode });
  }
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
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

function sendChat() {
  const inp = document.getElementById('chat-input');
  const raw = inp.value.trim();
  const pendingImages = _pendingChatImages.slice();
  if (!raw && !pendingImages.length) return;
  clearTypingState();

  if (pendingImages.length) {
    const imageWide = getChatImageWideMode();
    pendingImages.forEach(item => sendPreparedChatImage(item.dataUrl, imageWide));
    clearPendingChatImage();
    if (!raw) return;
  }

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

function sendMessage(name, text, type = 'normal', extra = null) {
  const msg = { name, text, type, uid: St.myId, time: Date.now(), ...(extra || {}) };
  if (type === 'normal' && St.myNameColor) msg.nameColor = St.myNameColor;
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    push(ref(db, `rooms/${St.roomCode}/chat`), msg);
  } else {
    appendChatMsg(name, text, type, St.myId, null, null, null, null, null, msg.nameColor || null, null, null, null, null, null, !!msg.imageWide);
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
  div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name">${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
  addMsgActions(div, uid, msgKey, 'casual', text, 'normal');
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result);
    reader.onerror = () => reject(new Error('파일을 읽는 중 오류가 발생했어요.'));
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
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
      if (!ctx) {
        reject(new Error('이미지 처리에 실패했어요.'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('이미지를 불러오지 못했어요.'));
    img.src = dataUrl;
  });
}

async function handleChatImageUpload(input) {
  ensureChatImageInputConfig();
  const files = Array.from(input.files || []);
  if (!files.length) return;

  const remainingSlots = MAX_PENDING_CHAT_IMAGES - _pendingChatImages.length;
  if (remainingSlots <= 0) {
    showToast('이미지는 한 번에 최대 4장까지 보낼 수 있어요.');
    input.value = '';
    return;
  }

  const selectedFiles = files.slice(0, remainingSlots);
  if (selectedFiles.length < files.length) {
    showToast('이미지는 한 번에 최대 4장까지 보낼 수 있어요.');
  }

  const prepared = [];
  for (const file of selectedFiles) {
    const isGif = file.type === 'image/gif';
    const maxSize = isGif ? 5 * 1024 * 1024 : 3 * 1024 * 1024;
    if (file.size > maxSize) {
      showToast(`${file.name} 파일은 ${isGif ? '5MB 이하 GIF' : '3MB 이하 이미지'}만 가능해요.`);
      continue;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const finalDataUrl = isGif ? dataUrl : await compressImageDataUrl(dataUrl);
      prepared.push({ dataUrl: finalDataUrl, fileName: file.name });
    } catch (err) {
      console.error(err);
      showToast(`${file.name} 이미지를 준비하지 못했어요.`);
    }
  }

  addPendingChatImages(prepared);
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

function appendChatMsg(name, text, type, uid, timestamp, speakAsAvatar, speakAsJournalId, whisperTo, whisperToName, nameColor, msgKey, channel, standingImg, tokenId, standingLabel, imageWide = false) {
  const container = document.getElementById('chat-messages');
  const d = timestamp ? new Date(timestamp) : new Date();
  const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;

  if (type === 'system' || type === 'sys') {
    const div = document.createElement('div');
    div.className = 'chat-msg msg-sys';
    div.innerHTML = `<div class="msg-text">${fmtText(text)}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return;
  }

  if (type === 'dsec') {
    const div = document.createElement('div');
    div.className = 'chat-msg msg-dsec';
    div.innerHTML = `<div class="msg-body"><div class="msg-text">${fmtText(text)}</div></div>`;
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
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
    div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name">${esc(name)}</span><span class="whisper-tag">${tagText}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
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
    container.scrollTop = container.scrollHeight;
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
    d2.className = 'chat-msg msg-speak-as msg-image-msg';
    d2.innerHTML = `${avHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name sa-msg-name">${esc(name)}</span><span class="msg-time">${time}</span></div><img class="msg-image" src="${esc(text)}" alt="첨부 이미지" style="${getChatImageInlineStyle(imageWide)}" onclick="openLightbox(this.src)"></div>`;
    container.appendChild(d2);
    container.scrollTop = container.scrollHeight;
    return;
  }

  const avatarHtml = getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));

  if (type === 'image') {
    const div = document.createElement('div');
    div.className = 'chat-msg msg-image-msg';
    div.dataset.avatarUid = uid || '';
    div.dataset.avatarName = name || '';
    div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name">${esc(name)}</span><span class="msg-time">${time}</span></div><img class="msg-image" src="${esc(text)}" alt="첨부 이미지" style="${getChatImageInlineStyle(imageWide)}" onclick="openLightbox(this.src)"></div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return;
  }

  const div = document.createElement('div');
  div.className = `chat-msg msg-${type}`;
  div.dataset.avatarUid = uid || '';
  div.dataset.avatarName = name || '';
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
  container.scrollTop = container.scrollHeight;
}


window.clearPendingChatImage = clearPendingChatImage;
window.removePendingChatImage = removePendingChatImage;
window.setChatImageWideMode = setChatImageWideMode;

loadChatImageWideMode();
ensureChatImageInputConfig();
