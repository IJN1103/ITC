/* ==========================================================================
 * CHAT SECTION: MAIN SEND DISPATCH
 * 입력값/이미지/desc/귓말/주사위/저널 speak-as 분기 처리
 * ========================================================================== */

async function sendChat() {
  const inp = document.getElementById('chat-input');
  if (!inp) return;
  getChatInputGuard();
  const raw = inp.value.trim();
  const hasImages = _pendingChatImages.length > 0;
  const currentChannelKey = String(window._itcActiveChatChannelKey || (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global') || 'global').trim() || 'global';
  if (!raw && !hasImages) return;

  if (raw && !hasImages && shouldSuppressChatSubmit(raw, currentChannelKey)) {
    inp.value = '';
    try { clearTypingState(); } catch (e) {}
    return;
  }

  let imeGuardMarked = false;
  const restoreInput = () => {
    try { inp.value = raw; inp.focus(); } catch (e) {}
  };

  try {
    clearTypingState();
    if (raw && !hasImages) {
      markChatSubmitForImeGuard(raw, currentChannelKey);
      imeGuardMarked = true;
    }

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
        await sendWhisperMessage(St.myName, whisperText, target[0], targetName, { channelKey: currentChannelKey, speakAsJournalId: St.speakAsJournalId || null });
        return;
      }
      const jTarget = _allJournals.find(j => (j.title || '') === targetName);
      if (jTarget && jTarget.ownerId) {
        inp.value = '';
        const senderName = St.speakAsJournalId ? (loadJournals().find(x=>x.id===St.speakAsJournalId)?.title||St.myName) : St.myName;
        await sendWhisperMessage(senderName, whisperText, jTarget.ownerId, targetName, { channelKey: currentChannelKey, targetJournalId: jTarget.id || null, speakAsJournalId: St.speakAsJournalId || null });
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
      await sendWhisperMessage(senderName, raw, St.whisperTo, St.whisperToName, { channelKey: currentChannelKey, targetJournalId: St.whisperToJournal || null, speakAsJournalId: St.speakAsJournalId || null });
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
    if (imeGuardMarked) cancelChatSubmitForImeGuard(raw, currentChannelKey);
    restoreInput();
    showToast('메시지 전송에 실패했어요. 다시 시도해주세요.');
  }
}


/* ==========================================================================
 * CHAT SECTION: FIREBASE MESSAGE PUSH AND DM META
 * 실제 메시지 push와 DM latestAt meta 갱신
 * ========================================================================== */

function notifyDmMetaAfterChatPush(channelKey = 'global', message = {}, pushedRef = null) {
  const safeKey = String(channelKey || message?.dmChannelKey || 'global').trim() || 'global';
  if (!safeKey || safeKey === 'global') return Promise.resolve(pushedRef);
  try {
    if (typeof window.touchDmChannelMetaForMessage === 'function') {
      return Promise.resolve(window.touchDmChannelMetaForMessage(safeKey, message, pushedRef?.key || ''))
        .catch(() => {})
        .then(() => pushedRef);
    }
  } catch (e) {}
  return Promise.resolve(pushedRef);
}

function sendMessage(name, text, type = 'normal', extra = null) {
  const localTime = Date.now();
  const msg = { name, text, type, uid: St.myId, time: localTime };
  if (St.myNameColor) msg.nameColor = St.myNameColor;
  if (extra && typeof extra === 'object') Object.assign(msg, extra);
  const currentChannelKey = String(window._itcActiveChatChannelKey || (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global') || 'global').trim() || 'global';
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    if (!St.roomCode) return Promise.reject(new Error('roomCode missing'));
    const payload = { ...msg, dmChannelKey: currentChannelKey || 'global', time: getChatServerTimestamp() };
    return push(ref(db, `rooms/${St.roomCode}/chat`), payload)
      .then((pushedRef) => notifyDmMetaAfterChatPush(currentChannelKey, payload, pushedRef));
  }
  appendChatMsg({ ...msg, timestamp: msg.time, nameColor: msg.nameColor || null, channel: 'chat', imageWide: !!msg.imageWide, imageMeta: msg.imageMeta || null, hideImageMeta: !!msg.hideImageMeta });
  return Promise.resolve();
}


/* ==========================================================================
 * CHAT SECTION: CASUAL TAB SEND AND PROFILE STATE
 * 잡담탭 전송, 닉네임, 이름색 저장/동기화
 * ========================================================================== */

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
let _lastTypingRoomCode = '';
let _lastTypingUid = '';

/* ==========================================================================
 * CHAT SECTION: TYPING INDICATOR
 * typing 상태 broadcast, indicator 렌더링, timeout cleanup
 * ========================================================================== */

function broadcastTyping() {
  if (!window._FB?.CONFIGURED || !St.roomCode || !St.myId) return;
  const now = Date.now();
  if (now - _lastTypingBroadcast < 1500) return;
  _lastTypingBroadcast = now;
  const { db, ref, set, remove } = window._FB;
  const roomCode = String(St.roomCode || '').trim();
  const uid = String(St.myId || '').trim();
  if (!roomCode || !uid) return;
  const tab = _activeRightTab === 'casual' ? 'casual' : 'chat';
  let displayName = St.myName;
  if (tab === 'chat' && St.speakAsJournalId) {
    const j = loadJournals().find(x => x.id === St.speakAsJournalId);
    if (j) displayName = j.title || St.myName;
  } else if (tab === 'casual' && _casualNickname) {
    displayName = _casualNickname;
  }
  _lastTypingRoomCode = roomCode;
  _lastTypingUid = uid;
  set(ref(db, `rooms/${roomCode}/typing/${uid}`), { name: displayName, tab, time: getChatServerTimestamp() });
  if (_typingTimer) clearTimeout(_typingTimer);
  _typingTimer = setTimeout(() => {
    remove(ref(db, `rooms/${roomCode}/typing/${uid}`)).catch(() => {});
    if (_lastTypingRoomCode === roomCode && _lastTypingUid === uid) {
      _lastTypingRoomCode = '';
      _lastTypingUid = '';
    }
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

function clearTypingState(roomCodeOverride = '', uidOverride = '') {
  if (_typingTimer) { clearTimeout(_typingTimer); _typingTimer = null; }
  _lastTypingBroadcast = 0;
  const roomCode = String(roomCodeOverride || St.roomCode || _lastTypingRoomCode || '').trim();
  const uid = String(uidOverride || St.myId || _lastTypingUid || '').trim();
  _lastTypingRoomCode = '';
  _lastTypingUid = '';
  if (!window._FB?.CONFIGURED || !roomCode || !uid) return Promise.resolve();
  const { db, ref, remove } = window._FB;
  return remove(ref(db, `rooms/${roomCode}/typing/${uid}`)).catch(() => {});
}


/* ==========================================================================
 * CHAT SECTION: CASUAL TAB RENDERING
 * 잡담 메시지 DOM 생성/append/replace/remove
 * ========================================================================== */

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
    _popoutWins.filter(w => w && !w.closed).forEach(w => { if (w.addMsg) w.addMsg(name, text, 'normal', 'casual', nameColor || '', av, renderedTime, fmtText(text)); });
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


/* ==========================================================================
 * CHAT SECTION: WHISPER SEND FLOW
 * 귓말 대상/저널 speak-as context 확인 및 전송
 * ========================================================================== */

function getActiveWhisperChannelKey(options = {}) {
  const fromOptions = String(options?.channelKey || '').trim();
  if (fromOptions) return fromOptions;
  return String(window._itcActiveChatChannelKey || (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global') || 'global').trim() || 'global';
}

function resolveWhisperSpeakAsContext(journalId, text = '') {
  const safeJournalId = String(journalId || '').trim();
  if (!safeJournalId) return null;

  const journalList = typeof loadJournals === 'function' ? loadJournals() : [];
  const journal = journalList.find(x => String(x.id || '') === safeJournalId)
    || (_allJournals || []).find(x => String(x.id || '') === safeJournalId)
    || null;

  let context = null;
  try {
    if (journal && typeof saBuildMessageContext === 'function') {
      context = saBuildMessageContext(journal, text);
    }
  } catch (e) {
    context = null;
  }

  const avatarFromResolver = typeof saGetAvatar === 'function' ? saGetAvatar(safeJournalId) : null;
  const avatar = context?.speakAsAvatar || avatarFromResolver || journal?.avatar || journal?.sheet?.avatar || '';

  return {
    name: context?.name || journal?.title || '',
    speakAsJournalId: safeJournalId,
    speakAsAvatar: avatar || '',
    nameColor: context?.nameColor || (typeof saGetJournalNameColor === 'function' ? saGetJournalNameColor(safeJournalId, journal) : (journal?.nameColor || journal?.sheet?.nameColor || ''))
  };
}

function sendWhisperMessage(senderName, text, targetUid, targetName, options = {}) {
  const localTime = Date.now();
  const channelKey = getActiveWhisperChannelKey(options);
  const speakAsJournalId = String(options?.speakAsJournalId || St.speakAsJournalId || '').trim();
  const targetJournalId = String(options?.targetJournalId || St.whisperToJournal || '').trim();
  const speakAsContext = resolveWhisperSpeakAsContext(speakAsJournalId, text);
  const msg = {
    name: speakAsContext?.name || senderName, text, type: 'whisper',
    uid: St.myId, time: localTime,
    whisperTo: targetUid, whisperToName: targetName,
    dmChannelKey: channelKey || 'global'
  };
  if (targetJournalId) msg.whisperToJournal = targetJournalId;
  if (speakAsContext) {
    msg.speakAsJournalId = speakAsContext.speakAsJournalId;
    if (speakAsContext.speakAsAvatar) msg.speakAsAvatar = speakAsContext.speakAsAvatar;
    if (speakAsContext.nameColor) msg.nameColor = speakAsContext.nameColor;
  } else if (St.myNameColor) {
    msg.nameColor = St.myNameColor;
  }
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    if (!St.roomCode) return Promise.reject(new Error('roomCode missing'));
    const payload = { ...msg, time: getChatServerTimestamp() };
    return push(ref(db, `rooms/${St.roomCode}/chat`), payload)
      .then((pushedRef) => notifyDmMetaAfterChatPush(channelKey, payload, pushedRef));
  }
  appendChatMsg({
    name: msg.name, text, type: 'whisper', uid: St.myId, timestamp: msg.time,
    whisperTo: targetUid, whisperToName: targetName, whisperToJournal: msg.whisperToJournal || null,
    speakAsJournalId: msg.speakAsJournalId || null, speakAsAvatar: msg.speakAsAvatar || null,
    nameColor: msg.nameColor || null, channel: 'chat'
  });
  return Promise.resolve();
}


/* ==========================================================================
 * CHAT SECTION: LEGACY IMAGE ENTRY AND LIGHTBOX
 * 기존 이미지 업로드 진입점과 이미지 lightbox
 * ========================================================================== */

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


