/* ==========================================================================
 * CHAT SECTION: STANDARD CHAT MESSAGE DOM
 * 일반/이미지/귓말/desc 메시지 DOM 생성과 액션 버튼 연결
 * ========================================================================== */

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
          whisperTo, whisperToName, whisperToJournal, nameColor, msgKey, channel,
          standingImg, tokenId, standingLabel,
          dialoguePortrait = '', showPortraitInDialogue = false,
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
    const r = St.avatarShape === 'circle' ? '50%' : '6px';
    const sc = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
    const finalAvatar = speakAsAvatar || (speakAsJournalId ? saGetAvatar(speakAsJournalId) : null);
    const avatarHtml = finalAvatar
      ? `<div class="msg-avatar ${sc} sa-avatar"><img src="${esc(finalAvatar)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:${r};display:block"></div>`
      : getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));
    const isMine = uid === St.myId;
    const tagText = isMine ? `→ ${esc(whisperToName || '?')}에게 귓말` : `→ 나에게 귓말`;
    const whisperNameColor = nameColor || (speakAsJournalId ? (typeof saGetJournalNameColor === 'function' ? saGetJournalNameColor(speakAsJournalId) : (_allJournals.find(x => x.id === speakAsJournalId)?.nameColor || _allJournals.find(x => x.id === speakAsJournalId)?.sheet?.nameColor || '')) : '');
    const nameStyle = whisperNameColor ? ` style="color:${esc(whisperNameColor)}"` : '';
    const div = document.createElement('div');
    div.className = 'chat-msg msg-whisper';
    div.dataset.avatarUid = uid || '';
    div.dataset.avatarName = name || '';
    if (whisperToJournal) div.dataset.whisperToJournal = whisperToJournal;
    div.innerHTML = `${avatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${nameStyle}>${esc(name)}</span><span class="whisper-tag">${tagText}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
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
    const journalColor = nameColor || (speakAsJournalId ? (typeof saGetJournalNameColor === 'function' ? saGetJournalNameColor(speakAsJournalId) : (_allJournals.find(x => x.id === speakAsJournalId)?.nameColor || _allJournals.find(x => x.id === speakAsJournalId)?.sheet?.nameColor || '')) : '');
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
    const journalColor = nameColor || (speakAsJournalId ? (typeof saGetJournalNameColor === 'function' ? saGetJournalNameColor(speakAsJournalId) : (_allJournals.find(x => x.id === speakAsJournalId)?.nameColor || _allJournals.find(x => x.id === speakAsJournalId)?.sheet?.nameColor || '')) : '');
    const nameStyle = journalColor ? ` style="color:${esc(journalColor)}"` : '';
    div.innerHTML = buildStandardChatImageSection(name, time, text, avatarHtml, !!imageWide, imageMeta, 'sa-msg-name', nameStyle, !!hideImageMeta);
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    return div;
  }

  const defaultAvatarHtml = getAvatarHtml(name, uid || (name === St.myName ? St.myId : null));
  const nameStyle = nameColor ? ` style="color:${nameColor}"` : '';

  if (type === 'image') {
    const div = document.createElement('div');
    div.className = `chat-msg msg-image-msg${imageWide ? ' msg-image-wide-row' : ''}${hideImageMeta ? ' msg-image-hide-meta' : ''}`;
    div.dataset.avatarUid = uid || '';
    div.dataset.avatarName = name || '';
    div.innerHTML = buildStandardChatImageSection(name, time, text, defaultAvatarHtml, !!imageWide, imageMeta, '', nameStyle, !!hideImageMeta);
    addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
    return div;
  }

  const div = document.createElement('div');
  div.className = `chat-msg msg-${type}`;
  div.dataset.avatarUid = uid || '';
  div.dataset.avatarName = name || '';
  if (type === 'dice') {
    const diceMatch = text.match(/🎲\s*(.+?)\s*→\s*(\d+)\s*\(([^)]+)\)/);
    if (diceMatch) {
      const formula = diceMatch[1].trim();
      const result = diceMatch[2];
      const rawRolls = diceMatch[3].trim();
      const rollParts = rawRolls.split('||').map(part => part.trim()).filter(Boolean);
      const rolls = rollParts[0] || rawRolls;
      const judgmentMeta = getDiceJudgmentMeta(rollParts[1] || rawRolls);
      const judgmentHtml = judgmentMeta ? `<div class="dice-card-judgment roll-judgment ${judgmentMeta.className}">${esc(judgmentMeta.label)}</div>` : '';
      const skillCheckClass = formula.endsWith('판정') ? ' dice-card-skill-check' : '';
      const isSpeakAsDice = !!speakAsJournalId;
      const r = St.avatarShape === 'circle' ? '50%' : '6px';
      const sc = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
      const finalAvatar = speakAsAvatar || (speakAsJournalId ? saGetAvatar(speakAsJournalId) : null);
      const diceAvatarHtml = isSpeakAsDice
        ? (finalAvatar
            ? `<div class="msg-avatar ${sc} sa-avatar"><img src="${esc(finalAvatar)}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:${r};display:block"></div>`
            : `<div class="msg-avatar ${sc} sa-avatar"><div class="msg-avatar-inner" style="border-radius:${r}">${esc((name || '?')[0].toUpperCase())}</div></div>`)
        : defaultAvatarHtml;
      const diceNameColor = isSpeakAsDice ? (nameColor || (typeof saGetJournalNameColor === 'function' ? saGetJournalNameColor(speakAsJournalId) : (_allJournals.find(x => x.id === speakAsJournalId)?.nameColor || _allJournals.find(x => x.id === speakAsJournalId)?.sheet?.nameColor || ''))) : nameColor;
      const diceNameStyle = diceNameColor ? ` style="color:${diceNameColor}"` : '';
      div.innerHTML = `${diceAvatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name${isSpeakAsDice ? ' sa-msg-name' : ''}"${diceNameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div><div class="dice-card${skillCheckClass}"><div class="dice-card-formula">${esc(formula)}</div><div class="dice-card-result">${esc(result)}</div>${judgmentHtml}<div class="dice-card-rolls">${esc(rolls)}</div></div></div>`;
    } else {
      div.innerHTML = `${defaultAvatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${nameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
    }
  } else {
    div.innerHTML = `${defaultAvatarHtml}<div class="msg-body"><div class="msg-meta"><span class="msg-name"${nameStyle}>${esc(name)}</span><span class="msg-time">${time}</span></div><div class="msg-text">${fmtText(text)}</div></div>`;
  }
  addMsgActions(div, uid, msgKey, channel || 'chat', text, type);
  return div;
}


/* ==========================================================================
 * CHAT SECTION: DICE RESULT DISPLAY
 * 주사위 판정 메타와 대사 표시 텍스트 생성
 * ========================================================================== */

function getDiceJudgmentMeta(text = '') {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  if (normalized.includes('크리티컬')) return { label: '크리티컬', className: 'j-crit' };
  if (normalized.includes('펌블')) return { label: '펌블', className: 'j-fumb' };
  if (normalized.includes('극단적 성공')) return { label: '극단적 성공', className: 'j-succ' };
  if (normalized.includes('어려운 성공')) return { label: '어려운 성공', className: 'j-succ' };
  if (normalized.includes('보통 성공')) return { label: '보통 성공', className: 'j-succ' };
  if (normalized.includes('실패')) return { label: '실패', className: 'j-fail' };
  return null;
}

function formatDiceDialogueText(text = '') {
  const match = String(text || '').match(/🎲\s*(.+?)\s*→\s*(\d+)\s*\(([^)]+)\)/);
  if (!match) return String(text || '').trim();
  const formula = match[1].trim();
  const result = match[2].trim();
  const rawRolls = match[3].trim();
  const parts = rawRolls.split('||').map(part => part.trim()).filter(Boolean);
  const judgment = parts[1] || '';
  return `${formula} ${result}${judgment ? ` (${judgment})` : ''}`.trim();
}


/* ==========================================================================
 * CHAT SECTION: CHAT DOM APPLY HELPERS
 * 메인 채팅 append/replace/remove 진입점
 * ========================================================================== */

function appendChatMsg(msg = {}) {
  const actualChannel = msg.channel || 'chat';
  const safeKey = upsertStoredMessage(actualChannel, msg.msgKey, {
    name: msg.name, text: msg.text, type: msg.type, uid: msg.uid, timestamp: msg.timestamp,
    speakAsAvatar: msg.speakAsAvatar, speakAsJournalId: msg.speakAsJournalId,
    whisperTo: msg.whisperTo, whisperToName: msg.whisperToName, whisperToJournal: msg.whisperToJournal,
    speakAsAvatar: msg.speakAsAvatar, speakAsJournalId: msg.speakAsJournalId, nameColor: msg.nameColor,
    standingImg: msg.standingImg, tokenId: msg.tokenId, standingLabel: msg.standingLabel,
    dialoguePortrait: msg.dialoguePortrait, showPortraitInDialogue: msg.showPortraitInDialogue,
    imageWide: msg.imageWide, hideImageMeta: msg.hideImageMeta,
    imageMeta: normalizeChatImageMeta(msg.imageMeta)
  });
  bindMessageViewport(actualChannel);
  const div = buildChatMsgElement({ ...msg, msgKey: safeKey, channel: actualChannel });
  queueMessageRender(actualChannel, div, safeKey, true);
  if ((msg.type === 'speak-as' || (msg.type === 'dice' && msg.speakAsJournalId)) && (!msg.timestamp || Date.now() - msg.timestamp < 5000)) {
    const dialogueText = msg.type === 'dice' ? formatDiceDialogueText(msg.text) : msg.text;
    showDialogueBoxFromMsg(msg.name, dialogueText, msg.speakAsJournalId, msg.standingImg, msg.tokenId, msg.standingLabel, msg.dialoguePortrait, msg.showPortraitInDialogue);
  }
}

function replaceChatMsg(msg = {}) {
  const actualChannel = msg.channel || 'chat';
  const safeKey = upsertStoredMessage(actualChannel, msg.msgKey, {
    name: msg.name, text: msg.text, type: msg.type, uid: msg.uid, timestamp: msg.timestamp,
    speakAsAvatar: msg.speakAsAvatar, speakAsJournalId: msg.speakAsJournalId,
    whisperTo: msg.whisperTo, whisperToName: msg.whisperToName, whisperToJournal: msg.whisperToJournal,
    speakAsAvatar: msg.speakAsAvatar, speakAsJournalId: msg.speakAsJournalId, nameColor: msg.nameColor,
    standingImg: msg.standingImg, tokenId: msg.tokenId, standingLabel: msg.standingLabel,
    dialoguePortrait: msg.dialoguePortrait, showPortraitInDialogue: msg.showPortraitInDialogue,
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


/* ==========================================================================
 * CHAT SECTION: POPOUT AND EXTERNAL CASUAL SYNC
 * 팝아웃/외부 호출에서 잡담 프로필과 이름색 동기화
 * ========================================================================== */

function getCasualProfileForPopout() {
  let avatar = '';
  try {
    avatar = window._itcAvatarRuntime?.readStoredAvatar?.(St.myId) || localStorage.getItem('itc_avatar_' + St.myId) || '';
  } catch (e) {
    avatar = '';
  }
  return {
    name: _casualNickname || St.myName || '나',
    color: St.casualNameColor || '',
    avatar,
  };
}

function setCasualNicknameFromPopout(name) {
  const trimmed = String(name || '').trim().slice(0, 18);
  if (!trimmed) return getCasualProfileForPopout();
  _casualNickname = trimmed;
  try { localStorage.setItem('itc_casual_nick_' + St.myId, trimmed); } catch(e) {}
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, update } = window._FB;
    update(ref(db, `rooms/${St.roomCode}/players/${St.myId}`), { casualNick: trimmed });
  }
  refreshCasualNickDisplay();
  if (typeof window.forcePopoutSync === 'function') window.forcePopoutSync();
  return getCasualProfileForPopout();
}

function normalizeCasualNameColor(color) {
  const safe = String(color || '').trim();
  if (!safe) return '';
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(safe) ? safe : '';
}

function applyCasualNameColorFromExternal(color, options = {}) {
  const safeColor = normalizeCasualNameColor(color);
  if (!safeColor) return getCasualProfileForPopout();
  const prevColor = St.casualNameColor || '';
  St.casualNameColor = safeColor;
  try { localStorage.setItem('itc_casual_name_color', safeColor); } catch(e) {}
  if (window._FB?.CONFIGURED && St.roomCode && St.myId) {
    const { db, ref, update } = window._FB;
    update(ref(db, `rooms/${St.roomCode}/players/${St.myId}`), { casualNameColor: safeColor }).catch(() => {});
  }
  refreshCasualNickDisplay();
  if (typeof window.forcePopoutSync === 'function') window.forcePopoutSync();
  if (!options.silent && prevColor !== safeColor && typeof showToast === 'function') {
    showToast('잡담 이름 색상이 변경됐어요.');
  }
  return getCasualProfileForPopout();
}

function setCasualNameColorFromPopout(color) {
  return applyCasualNameColorFromExternal(color);
}

window.addEventListener('message', (event) => {
  const data = event?.data || null;
  if (!data || data.type !== 'ITC_POPOUT_CASUAL_COLOR') return;
  applyCasualNameColorFromExternal(data.color);
});

window.getCasualProfileForPopout = getCasualProfileForPopout;
window.setCasualNicknameFromPopout = setCasualNicknameFromPopout;
window.setCasualNameColorFromPopout = setCasualNameColorFromPopout;

window.clearTypingState = clearTypingState;
window.chatKeydown = chatKeydown;
window.sendChat = sendChat;
window.handleChatImageUpload = handleChatImageUpload;
window.togglePendingChatImageWide = togglePendingChatImageWide;
window.togglePendingChatImageHideMeta = togglePendingChatImageHideMeta;
window.clearPendingChatImages = clearPendingChatImages;
window.refreshChatActionButtons = refreshChatActionButtons;
window.clearAllChatHistory = clearAllChatHistory;
window.toggleDescMode = toggleDescMode;
scheduleChatInputResizeInit();
window.initChatInputResize = initChatInputResize;
window.broadcastTyping = broadcastTyping;
window.queueMessageRender = queueMessageRender;
window.getRenderedNodeByKey = getRenderedNodeByKey;
window.replaceRenderedMessage = replaceRenderedMessage;
window.removeRenderedMessage = removeRenderedMessage;
window.resetRenderedMessages = resetRenderedMessages;
window.activateChatRenderChannel = activateChatRenderChannel;
window.storeMessageRecord = storeMessageRecord;
window.prependStoredWindow = prependStoredWindow;
window.configureHistoryPaging = configureHistoryPaging;
window.requestOlderHistory = requestOlderHistory;
window.prependStoredWindow = prependStoredWindow;
window.seedChatHistoryStore = seedChatHistoryStore;
window.getOldestStoredMessageKey = getOldestStoredMessageKey;
window.getNewestStoredMessageKey = getNewestStoredMessageKey;
window.getChatRenderSnapshot = getChatRenderSnapshot;
window.getChatImageClassName = getChatImageClassName;
window.getChatImageInlineStyle = getChatImageInlineStyle;
