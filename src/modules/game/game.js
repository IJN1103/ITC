// 1. 파일 상단(전역 변수들이 있는 곳)에 아래 두 줄을 추가해 줍니다. 
// 이미 렌더링된 채팅의 고유 ID를 추적하여 중복 출력을 완벽히 차단합니다.
let _processedChatKeys = new Set();
let _processedCasualKeys = new Set();

// 2. 기존의 setupFirebaseListeners 함수를 아래 내용으로 덮어씌워 줍니다.
function setupFirebaseListeners() {
  if (!window._FB?.CONFIGURED) return;
  const { db, ref, onValue } = window._FB;
  const code = St.roomCode;

  // 방에 새로 입장할 때마다 추적 기록을 초기화합니다.
  _processedChatKeys.clear();
  _processedCasualKeys.clear();

  onValue(ref(db, `rooms/${code}/players`), snap => {
    const players = snap.val() || {};
    if (!players[St.myId] && St.roomCode) {
      alert('GM에 의해 방에서 강퇴되었습니다.');
      St.roomCode = '';
      document.getElementById('screen-game').style.display = 'none';
      document.getElementById('screen-lobby').style.display = 'flex';
      return;
    }
    renderPlayers(players);
  });

  // 🔥 [버그 수정됨] 메인 채팅방 동기화
  onValue(ref(db, `rooms/${code}/chat`), snap => {
    const msgs = snap.val() || {};
    const entries = Object.entries(msgs).map(([k, m]) => ({ ...m, _key: k }));
    const sorted = entries.sort((a,b) => a.time - b.time)
      .filter(m => {
        if (m.type === 'whisper') return m.uid === St.myId || m.whisperTo === St.myId;
        return true;
      });

    // 개수로 자르지 않고, 기록된 적 없는 고유 키(_key)만 화면에 렌더링합니다.
    sorted.forEach(m => {
      if (!_processedChatKeys.has(m._key)) {
        appendChatMsg(
          m.name, m.text, m.type, m.uid, m.time, 
          m.speakAsAvatar, m.speakAsJournalId, 
          m.whisperTo, m.whisperToName, m.nameColor, 
          m._key, 'chat', m.standingImgUrl, m.tokenId, m.standingLabel
        );
        _processedChatKeys.add(m._key);
      }
    });
  });

  // 🔥 [버그 수정됨] 잡담(Casual) 채팅방 동기화
  onValue(ref(db, `rooms/${code}/casual`), snap => {
    const msgs = snap.val() || {};
    const sorted = Object.entries(msgs).map(([k, m]) => ({ ...m, _key: k })).sort((a,b) => a.time - b.time);
    
    // 잡담 탭 역시 동일하게 고유 키 기반으로 중복을 방지합니다.
    sorted.forEach(m => {
      if (!_processedCasualKeys.has(m._key)) {
        appendCasualMsg(m.name, m.text, m.uid, m.time, m._key);
        _processedCasualKeys.add(m._key);
      }
    });
  });

  // ------------------------------------------------------------------
  // 이 아래에 있는 tokens, bgm, lastRoll 등의 기존 코드는 건드리지 말고 그대로 둡니다.
  // ------------------------------------------------------------------
  onValue(ref(db, `rooms/${code}/tokens`), snap => {
    const tokens = snap.val() || {};
    St.tokens = tokens;
    renderAllTokens(tokens);
  });

  onValue(ref(db, `rooms/${code}/bgm`), snap => {
    const bgm = snap.val();
    if (!bgm) return;
    if (bgm.playlist) { St.playlist = bgm.playlist; renderPlaylist(); }
    if (bgm.currentTrack !== undefined && bgm.currentTrack !== St.currentTrack) {
      St.currentTrack = bgm.currentTrack;
      playTrack(St.currentTrack);
    }
  });

  onValue(ref(db, `rooms/${code}/lastRoll`), snap => {
    const roll = snap.val();
    if (!roll || roll.playerId === St.myId || roll.secret) return;
    showRollResult(roll);
  });
  
  // (만약 typing 리스너 등 기타 로직이 더 있다면 그것들도 유지해 주세요)
}
