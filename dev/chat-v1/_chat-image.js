/* ==========================================================================
 * CHAT SECTION: IMAGE SEND AND INIT
 * 준비된 이미지 메시지 전송, pending queue 전송, composer 바인딩
 * ========================================================================== */

async function sendPreparedChatImage(preparedOrDataUrl, imageWide = false, imageMeta = null, hideImageMeta = false) {
  const saJId = St.speakAsJournalId;
  const saJournal = saJId ? loadJournals().find(x => x.id === saJId) : null;
  const saName = saJournal ? (saJournal.title || '무제') : null;
  const saAvatar = saJId ? saGetAvatar(saJId) : null;
  const normalizedMeta = normalizeChatImageMeta(imageMeta);

  const prepared = (preparedOrDataUrl && typeof preparedOrDataUrl === 'object' && ('dataUrl' in preparedOrDataUrl || 'uploadBlob' in preparedOrDataUrl))
    ? preparedOrDataUrl
    : { dataUrl: String(preparedOrDataUrl || '') };
  const dataUrl = prepared.dataUrl || '';
  let finalSrc = '';
  let storageMeta = null;

  if (!St.roomCode) {
    throw new Error('이미지 업로드를 위한 방 정보가 없어요.');
  }

  const uploaded = await uploadChatImageDataUrl(dataUrl, St.roomCode, prepared);
  if (!uploaded?.url) {
    throw new Error('이미지 업로드에 실패했어요. 다시 시도해 주세요.');
  }
  finalSrc = uploaded.url;
  storageMeta = uploaded;

  if (saJournal) {
    const msg = {
      name: saName,
      text: finalSrc,
      type: 'speak-as-image',
      uid: St.myId,
      time: Date.now(),
      speakAsAvatar: saAvatar,
      speakAsJournalId: saJId,
      nameColor: (typeof saGetJournalNameColor === 'function' ? saGetJournalNameColor(saJId, saJournal) : (saJournal.nameColor || saJournal.sheet?.nameColor || '')),
      imageWide: !!imageWide,
      hideImageMeta: !!hideImageMeta,
      imageMeta: normalizedMeta,
      imageStoragePath: storageMeta?.path || '',
      imageContentType: storageMeta?.contentType || inferStorageContentTypeFromDataUrl(dataUrl),
    };
    const currentChannelKey = String(window._itcActiveChatChannelKey || (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global') || 'global').trim() || 'global';
    if (window._FB?.CONFIGURED) {
      const { db, ref, push } = window._FB;
      if (!St.roomCode) throw new Error('roomCode missing');
      const payload = { ...msg, dmChannelKey: currentChannelKey || 'global', time: getChatServerTimestamp() };
    return push(ref(db, `rooms/${St.roomCode}/chat`), payload)
      .then((pushedRef) => notifyDmMetaAfterChatPush(currentChannelKey, payload, pushedRef));
    }
    appendChatMsg({ name: msg.name, text: finalSrc, type: 'speak-as-image', uid: St.myId, timestamp: msg.time, speakAsAvatar: saAvatar, speakAsJournalId: saJId, nameColor: msg.nameColor || '', channel: 'chat', imageWide: !!imageWide, imageMeta: normalizedMeta, hideImageMeta: !!hideImageMeta });
    return Promise.resolve();
  }

  return sendMessage(St.myName, finalSrc, 'image', {
    imageWide: !!imageWide,
    hideImageMeta: !!hideImageMeta,
    imageMeta: normalizedMeta,
    imageStoragePath: storageMeta?.path || '',
    imageContentType: storageMeta?.contentType || inferStorageContentTypeFromDataUrl(dataUrl),
  });
}

async function sendPendingChatImages() {
  if (_activeRightTab === 'casual') {
    showToast('이미지 첨부는 메인 채팅에서만 보낼 수 있어요.');
    return false;
  }
  if (!_pendingChatImages.length) return true;
  const items = _pendingChatImages.splice(0, _pendingChatImages.length);
  renderPendingChatImages();
  showChatUploadStatus();
  try {
    for (const item of items) {
      await sendPreparedChatImage(item, _pendingChatImageWide, { width: item.width, height: item.height }, _pendingChatImageHideMeta);
      revokePreparedChatImagePreview(item);
    }
    _pendingChatImageWide = false;
    _pendingChatImageHideMeta = false;
    renderPendingChatImages();
    return true;
  } catch (err) {
    console.error('sendPendingChatImages failed', err);
    items.reverse().forEach(item => _pendingChatImages.unshift(item));
    renderPendingChatImages();
    showToast(err?.message || '이미지 업로드에 실패했어요. 잠시 후 다시 시도해 주세요.');
    throw err;
  } finally {
    hideChatUploadStatus();
  }
}

function initChatImageComposer() {
  ensureChatUploadStatusEl();
  renderPendingChatImages();
  bindMessageViewport('chat');
  bindMessageViewport('casual');
}



