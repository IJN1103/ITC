/**
 * ITC TRPG — Game Core 모듈
 * Firebase 리스너, 게임 진입, 플레이어 관리, 캐릭터 시트
 */

let _processedChatKeys = new Set();
let _processedCasualKeys = new Set();

function setupFirebaseListeners() {
  if (!window._FB?.CONFIGURED) return;
  const { db, ref, onValue } = window._FB;
  const code = St.roomCode;

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

  // 🔥 [완벽 버그 픽스] 사진 데이터만 따로 관리하는 전용 통로
  onValue(ref(db, `rooms/${code}/avatars`), snap => {
    const avatars = snap.val() || {};
    if (!window._avatarCache) window._avatarCache = {};

    Object.entries(avatars).forEach(([uid, rawValue]) => {
      const avatarSrc = (typeof rawValue === 'string') ? rawValue : (rawValue && rawValue.avatar) ? rawValue.avatar : '';
      if (!avatarSrc) return;

      localStorage.setItem('itc_avatar_' + uid, avatarSrc);
      window._avatarCache[uid] = avatarSrc;

      const playerName = (St.players && St.players[uid] && St.players[uid].name) ? St.players[uid].name : '';
      if (playerName) window._avatarCache[playerName] = avatarSrc;

      if (typeof refreshRenderedAvatars === 'function') {
        refreshRenderedAvatars(uid, playerName, avatarSrc);
      }
    });
  });

  onValue(ref(db, `rooms/${code}/chat`), snap => {
    const msgs = snap.val() || {};
    const entries = Object.entries(msgs).map(([k, m]) => ({ ...m, _key: k }));
    const sorted = entries.sort((a,b) => a.time - b.time)
      .filter(m => {
        if (m.type === 'whisper') return m.uid === St.myId || m.whisperTo === St.myId;
        return true;
      });
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const rendered = container.querySelectorAll('.chat-msg').length;

    if (rendered > sorted.length) {
      container.innerHTML = '';
      _processedChatKeys.clear();
    }

    sorted.forEach(m => {
      if (!_processedChatKeys.has(m._key)) {
        appendChatMsg(
          m.name, m.text, m.type || 'normal', m.uid, m.time, 
          m.speakAsAvatar || null, m.speakAsJournalId || null, 
          m.whisperTo || null, m.whisperToName || null, m.nameColor || null, 
          m._key, 'chat', m.standingImg || null, m.tokenId || null, m.standingLabel || null
        );
        _processedChatKeys.add(m._key);
      }
    });
  });

  onValue(ref(db, `rooms/${code}/tokens`), snap => {
    const tokens = snap.val() || {};
    St.tokens = tokens;
    renderAllTokens(tokens);
  });

  onValue(ref(db, `rooms/${code}/journals`), snap => {
    _allJournals = [];
    const data = snap.val() || {};
    Object.entries(data).forEach(([id, j]) => { j.id = id; _allJournals.push(j); });
    renderJournalList();
    saRefreshToolbar();
  });

  onValue(ref(db, `rooms/${code}/casual`), snap => {
    const msgs = snap.val() || {};
    const entries = Object.entries(msgs).map(([k, m]) => ({ ...m, _key: k }));
    const sorted = entries.sort((a,b) => a.time - b.time);
    const container = document.getElementById('casual-messages');
    if (!container) return;
    const rendered = container.querySelectorAll('.chat-msg').length;

    if (rendered > sorted.length) {
      container.innerHTML = '';
      _processedCasualKeys.clear();
    }

    sorted.forEach(m => {
      if (!_processedCasualKeys.has(m._key)) {
        appendCasualMsg(m.name, m.text, m.uid, m.time, m._key);
        _processedCasualKeys.add(m._key);
      }
    });
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

  const presRef = ref(db, `rooms/${code}/players/${St.myId}/online`);
  window._FB.set(presRef, true);
  window._FB.onDisconnect(presRef).set(false);

  onValue(ref(db, `rooms/${code}/typing`), snap => {
    const typing = snap.val() || {};
    renderTypingIndicator('typing-chat', typing, 'chat');
    renderTypingIndicator('typing-casual', typing, 'casual');
  });
}

async function enterGame() {
  sessionStorage.setItem('itc_session_code', St.roomCode);
  sessionStorage.setItem('itc_session_sys',  St.system);
  sessionStorage.setItem('itc_session_role', St.isGM ? 'gm' : 'player');

  document.getElementById('screen-auth').style.display  = 'none';
  document.getElementById('screen-lobby').style.display = 'none';
  document.getElementById('screen-game').style.display  = 'flex';

  document.getElementById('topbar-code').textContent = St.roomCode;
  document.getElementById('topbar-system').textContent = SYS_LABELS[St.system] || St.system;
  document.getElementById('room-code-disp').textContent = St.roomCode;
  document.getElementById('system-disp').textContent = SYS_LABELS[St.system];
  document.getElementById('myname-disp').textContent = St.myName;

  addPlayerChip(St.myId, St.myName, true, St.isGM ? 'gm' : 'player');
  renderDiceButtons(St.system);
  await initCharacter(St.system);
  initChatResize();

  const gmBadge = document.getElementById('gm-badge');
  if (gmBadge) gmBadge.style.display = St.isGM ? 'inline-flex' : 'none';
  refreshPermUI();
  const toolbar = document.getElementById('chat-toolbar');
  if (toolbar) toolbar.classList.add('gm-visible');
  const descBtn = document.getElementById('desc-toggle-btn');
  if (descBtn) descBtn.style.display = hasPerm('sendDesc') ? '' : 'none';
  saRefreshToolbar();
  St.descMode = false;
  St.speakAsJournalId = null;
  St.whisperTo = null;
  St.whisperToName = null;
  St.whisperToJournal = null;
  saRefreshBtn();
  refreshWhisperBtn();
  renderCharacterSheet(St.system);
  
  if (!window._avatarCache) window._avatarCache = {};
  const myAv = localStorage.getItem('itc_avatar_' + St.myId);
  if (myAv) {
    window._avatarCache[St.myId] = myAv;
    window._avatarCache[St.myName] = myAv;
    if (window._FB?.CONFIGURED) {
      window._FB.set(window._FB.ref(window._FB.db, `rooms/${St.roomCode}/avatars/${St.myId}`), myAv).catch(()=>{});
    }
  }

  // 🔥 [새로 추가된 마법의 로직] 2초마다 내 프사 변경을 감지해서 자동으로 남들에게 쏴줍니다.
  if (!window._avatarWatcher) {
    let _lastAv = myAv;
    window._avatarWatcher = setInterval(() => {
      if (!St.roomCode || !window._FB?.CONFIGURED) return;
      const currentAv = localStorage.getItem('itc_avatar_' + St.myId);
      if (currentAv && currentAv !== _lastAv) {
        _lastAv = currentAv;
        window._avatarCache[St.myId] = currentAv;
        window._avatarCache[St.myName] = currentAv;
        if (typeof refreshRenderedAvatars === 'function') {
          refreshRenderedAvatars(St.myId, St.myName, currentAv);
        }
        window._FB.set(window._FB.ref(window._FB.db, `rooms/${St.roomCode}/avatars/${St.myId}`), currentAv).catch(()=>{});
      }
    }, 2000);
  }

  addLocalMessage('system', '', `${St.myName}님이 입장했습니다 — ${SYS_LABELS[St.system]}`);
  migrateLocalJournals();
  loadCasualNick();
  loadMyNameColor();
  fetchJournalsFromFB();
}

function addPlayerChip(id, name, isMe, role, online) {
  const row = document.getElementById('players-row');
  if (document.getElementById('pchip-' + id)) return;
  const chip = document.createElement('div');
  const statusClass = online ? 'online' : 'offline';
  chip.className = 'p-chip' + (isMe ? ' me' : '') + ' ' + statusClass;
  chip.id = 'pchip-' + id;
  const roleTag = role === 'gm' ? `<span style="font-size:9px;margin-left:2px">GM</span>` : '';
  chip.innerHTML = `<div class="p-dot"></div><span>${esc(name)}</span>${roleTag}`;
  row.appendChild(chip);
}

function renderPlayers(players) {
  document.getElementById('players-row').innerHTML = '';
  St.players = players;
  refreshMyPerms();
  refreshPermUI();
  if (!window._avatarCache) window._avatarCache = {};
  
  Object.entries(players).forEach(([id, p]) => {
    const online = p.online || id === St.myId;
    addPlayerChip(id, p.name, id === St.myId, p.role, online);
    
    // 로컬에 백업해둔 프사가 있다면 일단 표시합니다. (실시간 교체는 맨 위 리스너가 담당)
    const av = localStorage.getItem('itc_avatar_' + id);
    if (av) {
      window._avatarCache[id] = av;
      window._avatarCache[p.name] = av;
      if (typeof refreshRenderedAvatars === 'function') {
        refreshRenderedAvatars(id, p.name, av);
      }
    }
  });
}

async function initCharacter(sys) {
  const defaults = {
    coc7: { name:'', job:'', age:'', str:50,con:50,siz:50,dex:50,app:50,int:50,pow:50,edu:50, hp:10,hpMax:10,mp:10,mpMax:10,san:50,sanMax:50, skills:{ 도서관:20,심리학:10,의학:5,법률:5,역사:5,격투:25,권총:20,회피:25,은신:20,추적:10,설득:15,위협:15,오컬트:5,자연:10,수영:20,응급처치:30 }, notes:'' },
    dx3:  { name:'', enclave:'', hp:30,hpMax:30,enc:5,encMax:5, notes:'' },
    shinobigami: { name:'', ryu:'', ninjutsu:Array(9).fill(''), notes:'' },
    insane: { name:'', job:'', hp:6,hpMax:6, notes:'' },
  };

  if (St.selectedCharId && window._FB?.CONFIGURED && window._currentUser) {
    const { db, ref, get } = window._FB;
    try {
      const snap = await get(ref(db, `users/${St.myId}/characters/${St.selectedCharId}`));
      if (snap.exists()) {
        St.character = snap.val();
        return;
      }
    } catch(e) {}
  }
  St.character = JSON.parse(JSON.stringify(defaults[sys] || {}));
}

function renderCharacterSheet(sys) {
  const c = document.getElementById('sheet-container');

  if (sys === 'coc7') {
    c.innerHTML = `
<div class="char-meta">
  <input placeholder="조사자 이름" id="ch-name" oninput="ch('name',this.value)" value="${esc(St.character.name||'')}">
  <input placeholder="직업" id="ch-job" oninput="ch('job',this.value)" value="${esc(St.character.job||'')}">
  <input placeholder="나이" id="ch-age" oninput="ch('age',this.value)" value="${esc(St.character.age||'')}">
</div>
<div class="sec">
  <div class="sec-title">능력치 <span style="font-size:9px;color:var(--muted)">클릭 → 판정</span></div>
  <div class="stat-grid">
    ${['str','con','siz','dex','app','int','pow','edu'].map(s => `
      <div class="stat-box" onclick="rollSkillCheck('${s.toUpperCase()}', +document.getElementById('ci-${s}').value)">
        <div class="sn">${s.toUpperCase()}</div>
        <div class="sv"><input id="ci-${s}" type="number" value="${St.character[s]||50}" min="1" max="99" oninput="ch('${s}',+this.value)"></div>
      </div>`).join('')}
  </div>
</div>
<div class="sec">
  <div class="sec-title">자원</div>
  <div class="res-row">
    <div class="res-box bar-hp"><div class="res-label">HP</div><div class="res-val"><input id="hp-cur" type="number" value="${St.character.hp||10}" oninput="ch('hp',+this.value);updateBar('hp')"><span>/</span><input id="hp-max" type="number" value="${St.character.hpMax||10}" oninput="ch('hpMax',+this.value);updateBar('hp')"></div><div class="bar"><div class="bar-fill" id="bar-hp"></div></div></div>
    <div class="res-box bar-mp"><div class="res-label">MP</div><div class="res-val"><input id="mp-cur" type="number" value="${St.character.mp||10}" oninput="ch('mp',+this.value);updateBar('mp')"><span>/</span><input id="mp-max" type="number" value="${St.character.mpMax||10}" oninput="ch('mpMax',+this.value);updateBar('mp')"></div><div class="bar"><div class="bar-fill" id="bar-mp"></div></div></div>
    <div class="res-box bar-san"><div class="res-label">SAN</div><div class="res-val"><input id="san-cur" type="number" value="${St.character.san||50}" oninput="ch('san',+this.value);updateBar('san')"><span>/</span><input id="san-max" type="number" value="${St.character.sanMax||50}" oninput="ch('sanMax',+this.value);updateBar('san')"></div><div class="bar"><div class="bar-fill" id="bar-san"></div></div></div>
  </div>
</div>
<div class="sec">
  <div class="sec-title">기술 <span style="font-size:9px;color:var(--muted)">클릭 → 판정</span></div>
  <div class="skill-list">
    ${Object.entries(St.character.skills||{}).map(([sk,val]) => `
      <div class="skill-row" onclick="rollSkillCheck('${sk}',+document.getElementById('sk-${sk}').value)">
        <span class="sk-n">${sk}</span>
        <div class="sk-v"><input id="sk-${sk}" type="number" value="${val}" min="1" max="99" oninput="chSkill('${sk}',+this.value)"></div>
        <span class="sk-pct">%</span>
      </div>`).join('')}
  </div>
</div>`;
    setTimeout(() => { updateBar('hp'); updateBar('mp'); updateBar('san'); }, 50);
  }

  else if (sys === 'dx3') {
    const syns = ['オルクス','バロール','エグザイル','サラマンダー','エンジェルハイロゥ','ノイマン','ブラックドッグ','モルフェウス','ハヌマーン','キュマイラ'];
    c.innerHTML = `
<div class="char-meta">
  <input placeholder="PC 이름" oninput="ch('name',this.value)" value="${esc(St.character.name||'')}">
  <input placeholder="인클레이브" oninput="ch('enclave',this.value)" value="${esc(St.character.enclave||'')}">
</div>
<div class="sec">
  <div class="sec-title">신드롬 (최대 3개)</div>
  <div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:6px">${syns.map(s=>`<div class="tag" onclick="this.classList.toggle('selected')">${s}</div>`).join('')}</div>
</div>
<div class="sec">
  <div class="sec-title">자원</div>
  <div class="res-row">
    <div class="res-box bar-hp"><div class="res-label">HP</div><div class="res-val"><input id="hp-cur" type="number" value="${St.character.hp||30}" oninput="ch('hp',+this.value);updateBar('hp')"><span>/</span><input id="hp-max" type="number" value="${St.character.hpMax||30}" oninput="ch('hpMax',+this.value);updateBar('hp')"></div><div class="bar"><div class="bar-fill" id="bar-hp"></div></div></div>
    <div class="res-box"><div class="res-label">인카네이션</div><div class="res-val"><input type="number" value="${St.character.enc||5}" oninput="ch('enc',+this.value)"><span>/</span><input type="number" value="${St.character.encMax||5}" oninput="ch('encMax',+this.value)"></div></div>
  </div>
</div>
<div class="sec">
  <div class="sec-title">능력치</div>
  <div class="stat-grid">
    ${['체술','감각','지각','의지','감정','사회','생명'].map(s=>`<div class="stat-box"><div class="sn">${s}</div><div class="sv"><input type="number" value="1" min="0" max="20"></div></div>`).join('')}
  </div>
</div>
<div class="sec">
  <div class="sec-title">파워 메모</div>
  <textarea class="notes-area" style="min-height:90px" placeholder="에픽스·파워를 여기에..."></textarea>
</div>`;
    setTimeout(() => updateBar('hp'), 50);
  }

  else if (sys === 'shinobigami') {
    c.innerHTML = `
<div class="char-meta">
  <input placeholder="닌자 이름" oninput="ch('name',this.value)" value="${esc(St.character.name||'')}">
  <input placeholder="유파" oninput="ch('ryu',this.value)" value="${esc(St.character.ryu||'')}">
</div>
<div class="sec">
  <div class="sec-title">비밀</div>
  <textarea class="notes-area" style="min-height:60px" placeholder="이 캐릭터의 비밀...">${esc(St.character.secret||'')}</textarea>
</div>
<div class="sec">
  <div class="sec-title">인법</div>
  <div class="ninjutsu-grid">
    ${Array.from({length:9},(_,i)=>`<div class="ninjutsu-cell"><input type="text" placeholder="인법 ${i+1}" value="${esc((St.character.ninjutsu||[])[i]||'')}" oninput="chNinjutsu(${i},this.value)"></div>`).join('')}
  </div>
</div>
<div class="sec">
  <div class="sec-title">자원</div>
  <div class="res-row">
    <div class="res-box bar-hp"><div class="res-label">생명력</div><div class="res-val"><input id="hp-cur" type="number" value="${St.character.hp||6}" oninput="ch('hp',+this.value);updateBar('hp')"><span>/</span><input id="hp-max" type="number" value="${St.character.hpMax||6}" oninput="ch('hpMax',+this.value);updateBar('hp')"></div><div class="bar"><div class="bar-fill" id="bar-hp"></div></div></div>
    <div class="res-box"><div class="res-label">공적점</div><div class="res-val"><input type="number" value="0" min="0"></div></div>
  </div>
</div>
<div class="sec">
  <div class="sec-title">감정</div>
  <div class="stat-grid">
    ${['집착','우정','애정','존경','신뢰','호의','질투','우월','의심','공포','증오','열등'].map(e=>`<div class="stat-box" style="cursor:default"><div class="sn" style="font-size:10px">${e}</div><div style="margin-top:3px"><input type="checkbox" style="accent-color:var(--accent)"></div></div>`).join('')}
  </div>
</div>`;
    setTimeout(() => updateBar('hp'), 50);
  }

  else if (sys === 'insane') {
    const areas = [
      ['폭력','격투','총기','도망','운동','제압','감각'],
      ['정보','도서관','관찰','추적','은신','교섭','미디어'],
      ['조사','증거','심리','해부','의학','과학','기억'],
      ['기술','해킹','기계','운전','폭발','제조','전기'],
      ['인류','역사','예술','신화','문화','언어','정치'],
      ['법술','접속','지배','보호','봉인','소환','조율'],
    ];
    c.innerHTML = `
<div class="char-meta">
  <input placeholder="캐릭터 이름" oninput="ch('name',this.value)" value="${esc(St.character.name||'')}">
  <input placeholder="직업" oninput="ch('job',this.value)" value="${esc(St.character.job||'')}">
</div>
<div class="sec">
  <div class="sec-title">자원</div>
  <div class="res-row">
    <div class="res-box bar-hp"><div class="res-label">생명력</div><div class="res-val"><input id="hp-cur" type="number" value="${St.character.hp||6}" oninput="ch('hp',+this.value);updateBar('hp')"><span>/</span><input id="hp-max" type="number" value="${St.character.hpMax||6}" oninput="ch('hpMax',+this.value);updateBar('hp')"></div><div class="bar"><div class="bar-fill" id="bar-hp"></div></div></div>
    <div class="res-box"><div class="res-label">정신력</div><div class="res-val"><input type="number" value="6" min="0"><span>/</span><input type="number" value="6" min="1"></div></div>
    <div class="res-box"><div class="res-label">광기도</div><div class="res-val"><input type="number" value="0" min="0"></div></div>
  </div>
</div>
<div class="sec">
  <div class="sec-title">특기</div>
  ${areas.map(row=>`<div style="display:flex;gap:2px;margin-bottom:2px;align-items:center"><span style="font-size:9px;color:var(--muted);width:36px;text-align:right;flex-shrink:0">${row[0]}</span>${row.slice(1).map(sk=>`<div class="insane-skill" onclick="this.classList.toggle('has')">${sk}</div>`).join('')}</div>`).join('')}
</div>
<div class="sec">
  <div class="sec-title">감정</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
    ${Array.from({length:4},(_,i)=>`<div class="res-box"><div class="res-label">감정 ${i+1}</div><input type="text" placeholder="+" style="background:none;border:none;border-bottom:1px solid var(--border);color:var(--text);width:100%;font:inherit;font-size:11px;padding:2px 0"></div>`).join('')}
  </div>
</div>`;
    setTimeout(() => updateBar('hp'), 50);
  }
}

function ch(key, val) { St.character[key] = val; autoSave(); }
function chSkill(sk, val) { if (!St.character.skills) St.character.skills = {}; St.character.skills[sk] = val; autoSave(); }
function chNinjutsu(i, val) { if (!St.character.ninjutsu) St.character.ninjutsu = Array(9).fill(''); St.character.ninjutsu[i] = val; autoSave(); }

function updateBar(type) {
  const map = { hp:['hp-cur','hp-max','bar-hp'], mp:['mp-cur','mp-max','bar-mp'], san:['san-cur','san-max','bar-san'] };
  const [ci, mi, bi] = map[type] || [];
  const cur = document.getElementById(ci), max = document.getElementById(mi), bar = document.getElementById(bi);
  if (!cur || !max || !bar) return;
  bar.style.width = Math.max(0, Math.min(100, (cur.value / max.value) * 100)) + '%';
}

function autoSave() {
  if (!window._FB?.CONFIGURED || !window._currentUser) return;
  const { db, ref, set } = window._FB;
  const uid = window._currentUser.uid;
  const charData = { ...St.character, updatedAt: Date.now() };

  if (St.roomCode) {
    set(ref(db, `rooms/${St.roomCode}/characters/${uid}`), charData);
  }
  if (St.selectedCharId) {
    set(ref(db, `users/${uid}/characters/${St.selectedCharId}`), charData);
  }
}

function saveCharacter() {
  autoSave();
  const btn = document.querySelector('.panel-header button');
  if (btn) { btn.textContent = '✓ 저장됨'; setTimeout(() => btn.textContent = '저장', 1500); }
}

async function leaveRoom() {
  if (!confirm('방에서 완전히 나가시겠습니까?\n(나중에 코드로 다시 입장할 수 있어요)')) return;
  if (window._FB?.CONFIGURED) {
    const { db, ref, remove, get } = window._FB;
    await remove(ref(db, `rooms/${St.roomCode}/players/${St.myId}`));
    const snap = await get(ref(db, `rooms/${St.roomCode}/players`));
    const remaining = snap.exists() ? Object.values(snap.val()).filter(p => p.online !== false) : [];
    if (remaining.length === 0) {
      await remove(ref(db, `rooms/${St.roomCode}`));
    }
  }
  sessionStorage.removeItem('itc_session_code');
  sessionStorage.removeItem('itc_session_sys');
  sessionStorage.removeItem('itc_session_role');

  St.roomCode = ''; St.isGM = false;
  
  if (window._avatarWatcher) {
    clearInterval(window._avatarWatcher);
    window._avatarWatcher = null;
  }
  
  closeModal('modal-settings');
  showLobby();
}
