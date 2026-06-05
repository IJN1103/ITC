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


