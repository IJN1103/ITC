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


