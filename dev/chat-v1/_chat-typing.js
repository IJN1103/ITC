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


