
async function sendChat() {
  const inp = document.getElementById('chat-input');
  if (!inp) return;
  const raw = inp.value.trim();
  const hasImages = _pendingChatImages.length > 0;
  if (!raw && !hasImages) return;

  const restoreInput = () => {
    try { inp.value = raw; inp.focus(); } catch (e) {}
  };

  try {
    clearTypingState();

    if (hasImages && _activeRightTab === 'casual') {
      showToast('이미지 첨부는 메인 채팅에서만 보낼 수 있어요.');
      return;
    }

    if (St.descMode && hasPerm('sendDesc')) {
      if (hasImages) {
        showToast('desc 모드에서는 이미지를 함께 보낼 수 없어요.');
        return;
      }
      inp.value = '';
      await sendMessage(St.myName, raw, 'desc');
      return;
    }

    const m = raw.match(/^\/desc\s*([\s\S]*)$/i);
    if (m) {
      if (hasImages) {
        showToast('desc 명령어와 이미지는 함께 보낼 수 없어요.');
        return;
      }
      if (!hasPerm('sendDesc')) { showToast('desc 입력 권한이 없어요.'); return; }
      const content = m[1].trim();
      if (!content) return;
      inp.value = '';
      await sendMessage(St.myName, content, 'desc');
      return;
    }

    const wm = raw.match(/^\/w\s+(\S+)\s+([\s\S]+)$/i);
    if (wm) {
      if (hasImages) {
        showToast('귓말과 이미지는 함께 보낼 수 없어요.');
        return;
      }
      const targetName = wm[1];
      const whisperText = wm[2].trim();
      if (!whisperText) return;
      const players = St.players || {};
      const target = Object.entries(players).find(([id, p]) => p.name === targetName);
      if (target) {
        inp.value = '';
        await sendWhisperMessage(St.myName, whisperText, target[0], targetName);
        return;
      }
      const jTarget = _allJournals.find(j => (j.title || '') === targetName);
      if (jTarget && jTarget.ownerId) {
        inp.value = '';
        const senderName = St.speakAsJournalId ? (loadJournals().find(x=>x.id===St.speakAsJournalId)?.title||St.myName) : St.myName;
        await sendWhisperMessage(senderName, whisperText, jTarget.ownerId, targetName);
        return;
      }
      showToast(`'${targetName}' 대상을 찾을 수 없어요.`);
      return;
    }

    const cm = raw.match(/^\/choice\s*[\(\（](.+)[\)\）]$/i);
    if (cm) {
      if (hasImages) {
        showToast('choice 명령어와 이미지는 함께 보낼 수 없어요.');
        return;
      }
      const options = cm[1].split(',').map(s => s.trim()).filter(Boolean);
      if (options.length < 2) { showToast('선택지를 2개 이상 입력해주세요.'); return; }
      const picked = options[Math.floor(Math.random() * options.length)];
      const senderName = St.speakAsJournalId ? (loadJournals().find(x=>x.id===St.speakAsJournalId)?.title || St.myName) : St.myName;
      inp.value = '';
      await sendMessage(senderName, `🎯 Choice [${options.join(', ')}] → ${picked}`, 'normal');
      return;
    }

    const dm = raw.match(/^\/(\d*d\d+.*)$/i);
    if (dm) {
      if (hasImages) {
        showToast('다이스 명령어와 이미지는 함께 보낼 수 없어요.');
        return;
      }
      inp.value = '';
      rollFromFormula(dm[1].trim());
      return;
    }

    if (St.whisperTo) {
      if (hasImages) {
        showToast('귓말 상태에서는 이미지를 함께 보낼 수 없어요.');
        return;
      }
      const senderName = St.speakAsJournalId ? (loadJournals().find(x=>x.id===St.speakAsJournalId)?.title || St.myName) : St.myName;
      inp.value = '';
      await sendWhisperMessage(senderName, raw, St.whisperTo, St.whisperToName);
      return;
    }

    inp.value = '';
    if (raw) {
      if (_activeRightTab === 'casual') {
        await sendCasualMsg(_casualNickname || St.myName, raw);
      } else if (St.speakAsJournalId) {
        const j = loadJournals().find(x => x.id === St.speakAsJournalId);
        if (j) {
          if (typeof saSendMessage === 'function') {
            await saSendMessage(j, raw);
          }
        } else {
          St.speakAsJournalId = null;
          if (typeof saRefreshBtn === 'function') saRefreshBtn();
          await sendMessage(St.myName, raw, 'normal');
        }
      } else {
        await sendMessage(St.myName, raw, 'normal');
      }
    }

    if (hasImages) {
      await sendPendingChatImages();
    }
  } catch (err) {
    console.error('sendChat failed', err);
    restoreInput();
    showToast('메시지 전송에 실패했어요. 다시 시도해주세요.');
  }
}

function sendMessage(name, text, type = 'normal', extra = null) {
  const localTime = Date.now();
  const msg = { name, text, type, uid: St.myId, time: localTime };
  if ((type === 'normal' || type === 'desc') && St.myNameColor) msg.nameColor = St.myNameColor;
  if (extra && typeof extra === 'object') Object.assign(msg, extra);
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    if (!St.roomCode) return Promise.reject(new Error('roomCode missing'));
    return push(ref(db, `rooms/${St.roomCode}/chat`), { ...msg, time: getChatServerTimestamp() });
  }
  appendChatMsg({ name, text, type, uid: St.myId, timestamp: msg.time, nameColor: msg.nameColor || null, channel: 'chat', imageWide: !!msg.imageWide, imageMeta: msg.imageMeta || null, hideImageMeta: !!msg.hideImageMeta });
  return Promise.resolve();
}

function sendCasual() {
  const inp = document.getElementById('chat-input');
  const raw = inp.value.trim();
  if (!raw) return;
  inp.value = '';
  sendCasualMsg(St.myName, raw);
}

function sendCasualMsg(name, text) {
  const localTime = Date.now();
  const msg = { name, text, uid: St.myId, time: localTime };
  if (St.casualNameColor) msg.nameColor = St.casualNameColor;
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    if (!St.roomCode) return Promise.reject(new Error('roomCode missing'));
    return push(ref(db, `rooms/${St.roomCode}/casual`), { ...msg, time: getChatServerTimestamp() });
  }
  appendCasualMsg(name, text, St.myId, msg.time, null, St.casualNameColor || '');
  return Promise.resolve();
}

function refreshCasualNickDisplay() {
  const el = document.getElementById('casual-nick-name');
  if (el) {
    el.textContent = _casualNickname || St.myName;
    el.style.color = St.casualNameColor || '';
  }
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

function loadCasualNameColor() {
  try { St.casualNameColor = localStorage.getItem('itc_casual_name_color') || ''; } catch(e) {}
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, get } = window._FB;
    get(ref(db, `rooms/${St.roomCode}/players/${St.myId}/casualNameColor`)).then(snap => {
      const val = snap.val();
      if (val) {
        St.casualNameColor = val;
        try { localStorage.setItem('itc_casual_name_color', val); } catch(e) {}
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
  set(ref(db, `rooms/${St.roomCode}/typing/${St.myId}`), { name: displayName, tab, time: getChatServerTimestamp() });
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
  const localTime = Date.now();
  const msg = { name, text: text.replace(/@\S+/g,'').trim(), uid: St.myId, time: localTime, speakAsAvatar: avatar, speakAsJournalId: journal.id };
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    push(ref(db, `rooms/${St.roomCode}/casual`), { ...msg, time: getChatServerTimestamp() });
  } else {
    appendCasualMsg(name, msg.text, St.myId, msg.time);
  }
}

function buildCasualMsgElement(name, text, uid, timestamp, msgKey, nameColor) {
  const d = timestamp ? new Date(timestamp) : new Date();
  const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  const avatarHtml = getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));
  const colorStyle = nameColor ? ` style="color:${esc(nameColor)}"` : '';
  const div = document.createElement('div');
  div.className = 'chat-msg msg-normal';
  div.dataset.avatarUid = uid || '';
  div.dataset.avatarName = name || '';
  div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${colorStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
  addMsgActions(div, uid, msgKey, 'casual', text, 'normal');
  return div;
}

function appendCasualMsg(name, text, uid, timestamp, msgKey, nameColor) {
  const safeKey = upsertStoredMessage('casual', msgKey, { name, text, uid, timestamp, nameColor });
  bindMessageViewport('casual');
  const div = buildCasualMsgElement(name, text, uid, timestamp, safeKey, nameColor);
  queueMessageRender('casual', div, safeKey, true);
  if (typeof _popoutWins !== 'undefined') {
    const av = getPopoutAvatarUrl(name, uid);
    const renderedTime = div.querySelector('.msg-time')?.textContent || '';
    _popoutWins.filter(w => w && !w.closed).forEach(w => { if (w.addMsg) w.addMsg(name, text, 'normal', 'casual', '', av, renderedTime, fmtText(text)); });
  }
}

function replaceCasualMsg(name, text, uid, timestamp, msgKey, nameColor) {
  const safeKey = upsertStoredMessage('casual', msgKey, { name, text, uid, timestamp, nameColor });
  bindMessageViewport('casual');
  const div = buildCasualMsgElement(name, text, uid, timestamp, safeKey, nameColor);
  replaceRenderedMessage('casual', safeKey, div);
}

function removeCasualMsg(msgKey) {
  removeRenderedMessage('casual', msgKey);
}

function sendWhisperMessage(senderName, text, targetUid, targetName) {
  const localTime = Date.now();
  const msg = {
    name: senderName, text, type: 'whisper',
    uid: St.myId, time: localTime,
    whisperTo: targetUid, whisperToName: targetName
  };
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    if (!St.roomCode) return Promise.reject(new Error('roomCode missing'));
    return push(ref(db, `rooms/${St.roomCode}/chat`), { ...msg, time: getChatServerTimestamp() });
  }
  appendChatMsg({ name: msg.name, text, type: 'whisper', uid: St.myId, timestamp: msg.time, whisperTo: targetUid, whisperToName: targetName });
  return Promise.resolve();
}

async function handleChatImageUpload(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  try {
    await queuePendingChatImages(files);
  } finally {
    input.value = '';
  }
}

function openLightbox(src) {
  const lb = document.createElement('div');
  lb.className = 'img-lightbox';
  lb.innerHTML = `<img src="${src}" alt="이미지">`;
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

function addLocalMessage(type, name, text) { appendChatMsg({ name, text, type }); }

function getAvatarHtml(name, uid) {
  let imgSrc = null;

  if (uid) {
    imgSrc = localStorage.getItem('itc_avatar_' + uid);
  }
  if (!imgSrc && name) {
    imgSrc = window._avatarCache?.[uid] || window._avatarCache?.[name];
  }

  const initial = (name || '?')[0].toUpperCase();
  const shape_class = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
  const r = St.avatarShape === 'circle' ? '50%' : '6px';
  if (imgSrc) {
    return `<div class="msg-avatar ${shape_class}" data-avatar-holder="1"><img src="${imgSrc}" alt="${esc(initial)}" style="border-radius:${r}"></div>`;
  }
  return `<div class="msg-avatar ${shape_class}" data-avatar-holder="1"><div class="msg-avatar-inner" style="border-radius:${r}">${esc(initial)}</div></div>`;
}

function rerenderExistingChatAvatars() {
  document.querySelectorAll('.chat-msg').forEach(div => {
    const uid = div.dataset.avatarUid || div.dataset.uid || '';
    const name = div.dataset.avatarName || div.dataset.name || '';
    const holder = div.querySelector('[data-avatar-holder="1"]');
    if (!holder) return;
    holder.outerHTML = getAvatarHtml(name, uid || null);
  });

  refreshCasualNickDisplay();
}


function buildStandardChatImageSection(name, time, src, avatarHtml, imageWide = false, imageMeta = null, extraNameClass = '', extraNameStyle = '', hideImageMeta = false) {
  const imageHtml = buildChatImageHtml(src, imageWide, imageMeta);
  const safeNameClass = extraNameClass ? ` ${extraNameClass}` : '';
  if (hideImageMeta) {
    return `<div class="msg-image-only-wrap${imageWide ? ' is-wide' : ''}">${imageHtml}</div>`;
  }
  if (imageWide) {
    return `${avatarHtml}<div class="msg-wide-head"><div class="msg-meta"><span class="msg-name${safeNameClass}"${extraNameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div></div><div class="msg-wide-image-wrap">${imageHtml}</div>`;
  }
  return `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name${safeNameClass}"${extraNameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div>${imageHtml}</div>`;
}

function buildChatMsgElement(msg = {}) {
  const { name, text, type, uid, timestamp, speakAsAvatar, speakAsJournalId,
          whisperTo, whisperToName, nameColor, msgKey, channel,
          standingImg, tokenId, standingLabel,
          imageWide = false, imageMeta = null, hideImageMeta = false } = msg;
  const d = timestamp ? new Date(timestamp) : new Date();
  const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;

  if (type === 'system' || type === 'sys') {
    const div = document.createElement('div');
    div.className = 'chat-msg msg-sys';
    div.innerHTML = `<div class="msg-text">${fmtText(text)}</div>`;
    return div;
  }

  if (type === 'desc') {
    const div = document.createElement('div');
    div.className = 'chat-msg msg-dsec';
    div.innerHTML = `<div class="msg-body"><div class="msg-text">${fmtText(text)}</div></div>`;
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    return div;
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
    return div;
  }

  if (type === 'speak-as') {
    const r = St.avatarShape === 'circle' ? '50%' : '6px';
    const sc = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
    const finalAvatar = speakAsAvatar || (speakAsJournalId ? saGetAvatar(speakAsJournalId) : null);
    const avatarHtml = finalAvatar
      ? `<div class="msg-avatar ${sc} sa-avatar"><img src="${esc(finalAvatar)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:${r};display:block"></div>`
      : `<div class="msg-avatar ${sc} sa-avatar"><div class="msg-avatar-inner" style="border-radius:${r}">${esc((name || '?')[0].toUpperCase())}</div></div>`;
    const div = document.createElement('div');
    div.className = 'chat-msg msg-speak-as';
    const journalColor = nameColor || (speakAsJournalId ? (_allJournals.find(x => x.id === speakAsJournalId)?.nameColor || '') : '');
    const nameStyle = journalColor ? ` style="color:${journalColor}"` : '';
    div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name sa-msg-name"${nameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text.replace(/@\S+/g,'').trim())}</div></div>`;
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    return div;
  }

  if (type === 'speak-as-image') {
    const r = St.avatarShape === 'circle' ? '50%' : '6px';
    const sc = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
    const finalAvatar = speakAsAvatar || (speakAsJournalId ? saGetAvatar(speakAsJournalId) : null);
    const avatarHtml = finalAvatar
      ? `<div class="msg-avatar ${sc} sa-avatar"><img src="${esc(finalAvatar)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:${r};display:block"></div>`
      : `<div class="msg-avatar ${sc} sa-avatar"><div class="msg-avatar-inner" style="border-radius:${r}">${esc((name || '?')[0].toUpperCase())}</div></div>`;
    const div = document.createElement('div');
    div.className = `chat-msg msg-speak-as msg-image-msg${imageWide ? ' msg-image-wide-row' : ''}${hideImageMeta ? ' msg-image-hide-meta' : ''}`;
    div.innerHTML = buildStandardChatImageSection(name, time, text, avatarHtml, !!imageWide, imageMeta, 'sa-msg-name', '', !!hideImageMeta);
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    return div;
  }

  const avatarHtml = getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));

  if (type === 'image') {
    const div = document.createElement('div');
    div.className = `chat-msg msg-image-msg${imageWide ? ' msg-image-wide-row' : ''}${hideImageMeta ? ' msg-image-hide-meta' : ''}`;
    div.dataset.avatarUid = uid || '';
    div.dataset.avatarName = name || '';
    div.innerHTML = buildStandardChatImageSection(name, time, text, avatarHtml, !!imageWide, imageMeta, '', '', !!hideImageMeta);
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    return div;
  }

  const div = document.createElement('div');
  div.className = `chat-msg msg-${type}`;
  div.dataset.avatarUid = uid || '';
  div.dataset.avatarName = name || '';
  const nameStyle = nameColor ? ` style="color:${nameColor}"` : '';
  if (type === 'dice') {
    const diceMatch = text.match(/🎲\s*(.+?)\s*→\s*(\d+)\s*\(([^)]+)\)/);
    if (diceMatch) {
      const formula = diceMatch[1].trim();
      const result = diceMatch[2];
      const rolls = diceMatch[3].trim();
      div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${nameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div><div class="dice-card"><div class="dice-card-formula">${esc(formula)}</div><div class="dice-card-result">${esc(result)}</div><div class="dice-card-rolls">${esc(rolls)}</div></div></div>`;
    } else {
      div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${nameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
    }
  } else {
    div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${nameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
  }
  addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
  return div;
}

function appendChatMsg(msg = {}) {
  const actualChannel = msg.channel || 'chat';
  const safeKey = upsertStoredMessage(actualChannel, msg.msgKey, {
    name: msg.name, text: msg.text, type: msg.type, uid: msg.uid, timestamp: msg.timestamp,
    speakAsAvatar: msg.speakAsAvatar, speakAsJournalId: msg.speakAsJournalId,
    whisperTo: msg.whisperTo, whisperToName: msg.whisperToName, nameColor: msg.nameColor,
    standingImg: msg.standingImg, tokenId: msg.tokenId, standingLabel: msg.standingLabel,
    imageWide: msg.imageWide, hideImageMeta: msg.hideImageMeta,
    imageMeta: normalizeChatImageMeta(msg.imageMeta)
  });
  bindMessageViewport(actualChannel);
  const div = buildChatMsgElement({ ...msg, msgKey: safeKey, channel: actualChannel });
  queueMessageRender(actualChannel, div, safeKey, true);
  if (msg.type === 'speak-as' && (!msg.timestamp || Date.now() - msg.timestamp < 5000)) {
    showDialogueBoxFromMsg(msg.name, msg.text, msg.speakAsJournalId, msg.standingImg, msg.tokenId, msg.standingLabel);
  }
}

function replaceChatMsg(msg = {}) {
  const actualChannel = msg.channel || 'chat';
  const safeKey = upsertStoredMessage(actualChannel, msg.msgKey, {
    name: msg.name, text: msg.text, type: msg.type, uid: msg.uid, timestamp: msg.timestamp,
    speakAsAvatar: msg.speakAsAvatar, speakAsJournalId: msg.speakAsJournalId,
    whisperTo: msg.whisperTo, whisperToName: msg.whisperToName, nameColor: msg.nameColor,
    standingImg: msg.standingImg, tokenId: msg.tokenId, standingLabel: msg.standingLabel,
    imageWide: msg.imageWide, hideImageMeta: msg.hideImageMeta,
    imageMeta: normalizeChatImageMeta(msg.imageMeta)
  });
  bindMessageViewport(actualChannel);
  const div = buildChatMsgElement({ ...msg, msgKey: safeKey, channel: actualChannel });
  replaceRenderedMessage(actualChannel, safeKey, div);
}

function removeChatMsg(msgKey, channel = 'chat') {
  removeRenderedMessage(channel, msgKey);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initChatImageComposer);
} else {
  initChatImageComposer();
}

window.chatKeydown = chatKeydown;
window.sendChat = sendChat;
window.handleChatImageUpload = handleChatImageUpload;
window.togglePendingChatImageWide = togglePendingChatImageWide;
window.togglePendingChatImageHideMeta = togglePendingChatImageHideMeta;
window.clearPendingChatImages = clearPendingChatImages;
window.refreshChatActionButtons = refreshChatActionButtons;
window.clearAllChatHistory = clearAllChatHistory;
window.toggleDescMode = toggleDescMode;
window.broadcastTyping = broadcastTyping;
window.queueMessageRender = queueMessageRender;
window.replaceRenderedMessage = replaceRenderedMessage;
window.removeRenderedMessage = removeRenderedMessage;
window.resetRenderedMessages = resetRenderedMessages;
window.storeMessageRecord = storeMessageRecord;
window.prependStoredWindow = prependStoredWindow;
window.configureHistoryPaging = configureHistoryPaging;
window.getChatImageClassName = getChatImageClassName;
window.getChatImageInlineStyle = getChatImageInlineStyle;
