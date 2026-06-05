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


