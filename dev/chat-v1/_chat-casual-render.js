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


