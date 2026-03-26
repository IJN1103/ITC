/**
 * ITC TRPG — Speak-As 모듈
 * 저널로 말하기, VN 대사창, 스탠딩, 색상, 귓말
 */

const _JAV = {};

function saIsEphemeralAvatarSrc(src) {
  return typeof src === 'string' && /^blob:/i.test(src);
}

function saSetAvatar(journalId, src) {
  if (!journalId || !src) return;
  _JAV[journalId] = src;
  try {
    if (saIsEphemeralAvatarSrc(src)) localStorage.removeItem('itc_av_' + journalId);
    else localStorage.setItem('itc_av_' + journalId, src);
  } catch(e) {}
}

function saGetAvatar(journalId) {
  if (!journalId) return null;
  if (_JAV[journalId]) return _JAV[journalId];
  try {
    const ls = localStorage.getItem('itc_av_' + journalId);
    if (ls && !saIsEphemeralAvatarSrc(ls)) { _JAV[journalId] = ls; return ls; }
    if (ls && saIsEphemeralAvatarSrc(ls)) localStorage.removeItem('itc_av_' + journalId);
  } catch(e) {}
  try {
    const j = _allJournals.find(x => x.id === journalId);
    const av = j?.avatar || j?.sheet?.avatar || null;
    if (av) { _JAV[journalId] = av; return av; }
  } catch(e) {}
  return null;
}

function saSendMessage(journal, text) {
  const avatar = saGetAvatar(journal.id);
  resolveStandingImage(journal, text); // 발신자 로컬 상태 업데이트용
  const msg = {
    name: journal.title || '무제',
    text,
    type: 'speak-as',
    uid: St.myId,
    time: Date.now(),
    speakAsAvatar: avatar,
    speakAsJournalId: journal.id,
    nameColor: journal.nameColor || '',
  };
  // base64 대신 토큰ID + 스탠딩 라벨만 전송 (수 바이트)
  if (journal.assignedTokenId) {
    msg.tokenId = journal.assignedTokenId;
    msg.standingLabel = _vnCurrentStanding[journal.id] || '';
  }
  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    push(ref(db, `rooms/${St.roomCode}/chat`), msg);
  } else {
    appendChatMsg(msg.name, text, 'speak-as', St.myId, msg.time, msg.speakAsAvatar, msg.speakAsJournalId, null, null, msg.nameColor, null, 'chat', null, msg.tokenId, msg.standingLabel);
  }
}

let _vnCurrentStanding = {};  // journalId → 현재 스탠딩 라벨
let _vnTimer = null;

function getJournalToken(journal) {
  const j = typeof journal === 'string' ? _allJournals.find(x => x.id === journal) : journal;
  if (!j?.assignedTokenId) return null;
  return St.tokens[j.assignedTokenId] || null;
}

function resolveStandingImage(journal, text) {
  const token = getJournalToken(journal);
  if (!token) return null;

  const standings = token.standings || [];
  const hasStandings = standings.length > 0 && standings.some(s => s.img);

  const atMatch = text.match(/@(\S+)/);
  if (atMatch && hasStandings) {
    const label = atMatch[1];
    const found = standings.find(s => s.label && s.label.replace(/^@/, '') === label && s.img);
    if (found) {
      _vnCurrentStanding[journal.id] = found.label;
      return found.img;
    }
  }

  if (hasStandings && _vnCurrentStanding[journal.id]) {
    const prev = standings.find(s => s.label === _vnCurrentStanding[journal.id] && s.img);
    if (prev) return prev.img;
  }

  if (hasStandings) {
    const first = standings.find(s => s.img);
    if (first) {
      _vnCurrentStanding[journal.id] = first.label;
      return first.img;
    }
  }

  if (token.tokenImg) return token.tokenImg;

  return null;
}

function cleanDialogueText(text) {
  return text.replace(/@\S+/g, '').trim();
}

function updateTokenStandingOnMap(journalId) {
  const j = _allJournals.find(x => x.id === journalId);
  if (!j?.assignedTokenId) return;
  const t = St.tokens[j.assignedTokenId];
  if (!t || !t.standingAsToken) return;
  const el = document.getElementById('tok-' + t.id);
  if (!el) return;
  const curLabel = _vnCurrentStanding[journalId];
  const standings = t.standings || [];
  const curStanding = curLabel ? standings.find(s => s.label === curLabel && s.img) : null;
  const newSrc = curStanding ? curStanding.img : (standings.find(s => s.img)?.img || t.tokenImg || null);
  if (!newSrc) return;
  const img = el.querySelector('img');
  if (img) { img.src = newSrc; }
}

function showDialogueBox(journal, text) {
  const dialog = document.getElementById('vn-dialog');
  const nameEl = document.getElementById('vn-name');
  const textEl = document.getElementById('vn-text');
  const standingEl = document.getElementById('vn-standing');
  if (!dialog || !nameEl || !textEl || !standingEl) return;

  if (_vnTimer) { clearTimeout(_vnTimer); _vnTimer = null; }

  const name = journal.title || '무제';
  const standingImg = resolveStandingImage(journal, text);
  updateTokenStandingOnMap(journal.id);
  const cleanText = cleanDialogueText(text);

  nameEl.textContent = name;
  textEl.innerHTML = esc(cleanText).replace(/\n/g, '<br>');

  if (standingImg) {
    standingEl.innerHTML = `<img src="${standingImg}" alt="">`;
    standingEl.style.display = '';
    dialog.classList.add('has-standing');
  } else {
    standingEl.innerHTML = '';
    standingEl.style.display = 'none';
    dialog.classList.remove('has-standing');
  }

  dialog.classList.add('open');

  _vnTimer = setTimeout(() => hideDialogueBox(), 15000);
}

function hideDialogueBox() {
  const dialog = document.getElementById('vn-dialog');
  if (dialog) dialog.classList.remove('open');
  if (_vnTimer) { clearTimeout(_vnTimer); _vnTimer = null; }
}

function showDialogueBoxFromMsg(name, text, journalId, standingImg, tokenId, standingLabel) {
  const journal = journalId ? _allJournals.find(x => x.id === journalId) : null;
  const dialog = document.getElementById('vn-dialog');
  const nameEl = document.getElementById('vn-name');
  const textEl = document.getElementById('vn-text');
  const standingEl = document.getElementById('vn-standing');
  if (!dialog) return;
  if (_vnTimer) { clearTimeout(_vnTimer); _vnTimer = null; }

  nameEl.textContent = (journal?.title || name || '???');
  const cleanText = cleanDialogueText(text);
  textEl.innerHTML = esc(cleanText).replace(/\n/g, '<br>');

  // 스탠딩 resolve: 3단계 fallback
  let finalStanding = null;

  // 1단계: 저널 기반 resolve (발신자/수신자 공통)
  if (journal) {
    finalStanding = resolveStandingImage(journal, text);
    updateTokenStandingOnMap(journal.id);
  }

  // 2단계: tokenId + standingLabel 기반 직접 resolve (수신자용)
  if (!finalStanding && tokenId) {
    const token = St.tokens[tokenId];
    if (token) {
      const standings = token.standings || [];
      if (standingLabel) {
        const found = standings.find(s => s.label === standingLabel && s.img);
        if (found) finalStanding = found.img;
      }
      if (!finalStanding) {
        const first = standings.find(s => s.img);
        if (first) finalStanding = first.img;
      }
      if (!finalStanding && token.tokenImg) finalStanding = token.tokenImg;
    }
  }

  // 3단계: 레거시 base64 fallback (이전 메시지 호환)
  if (!finalStanding && standingImg) finalStanding = standingImg;

  if (finalStanding) {
    standingEl.innerHTML = `<img src="${finalStanding}" alt="">`;
    standingEl.style.display = '';
    dialog.classList.add('has-standing');
  } else {
    standingEl.innerHTML = '';
    standingEl.style.display = 'none';
    dialog.classList.remove('has-standing');
  }

  dialog.classList.add('open');
  _vnTimer = setTimeout(() => hideDialogueBox(), 15000);
}

function toggleSpeakAsDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('speak-as-dropdown');
  if (!dd) return;
  if (dd.classList.contains('open')) { dd.classList.remove('open'); return; }
  saBuildDropdown();
  dd.classList.add('open');
}

function saBuildDropdown() {
  const dd = document.getElementById('speak-as-dropdown');
  if (!dd) return;
  dd.innerHTML = '';

  const hdr = document.createElement('div');
  hdr.className = 'sa-dd-header';
  hdr.textContent = '누구로 말할까요?';
  dd.appendChild(hdr);

  const self = document.createElement('div');
  self.className = 'sa-dd-item' + (!St.speakAsJournalId ? ' selected' : '');
  self.innerHTML = `<div class="sa-dd-icon"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M2 12c0-2.21 2.239-4 5-4s5 1.79 5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div><span>나 (기본)</span>`;
  self.onclick = () => saSetJournal(null);
  dd.appendChild(self);

  const journals = loadJournals();
  if (journals.length) {
    const sep = document.createElement('div');
    sep.className = 'sa-dd-sep';
    dd.appendChild(sep);
    journals.forEach(j => {
      const item = document.createElement('div');
      item.className = 'sa-dd-item' + (St.speakAsJournalId === j.id ? ' selected' : '');
      const av = saGetAvatar(j.id);
      const init = (j.title || '?')[0].toUpperCase();
      const iconHtml = av
        ? `<div class="sa-dd-icon"><img src="${esc(av)}" alt=""></div>`
        : `<div class="sa-dd-icon">${esc(init)}</div>`;
      item.innerHTML = `${iconHtml}<span>${esc(j.title || '무제')}</span>`;
      item.onclick = () => saSetJournal(j.id);
      dd.appendChild(item);
    });
  } else {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:11px;color:var(--muted);padding:6px 10px 8px';
    empty.textContent = '저장된 저널이 없어요.';
    dd.appendChild(empty);
  }
}

function saSetJournal(journalId) {
  St.speakAsJournalId = journalId;
  document.getElementById('speak-as-dropdown')?.classList.remove('open');
  saRefreshBtn();
  document.getElementById('chat-input')?.focus();
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, update } = window._FB;
    const j = journalId ? loadJournals().find(x => x.id === journalId) : null;
    update(ref(db, `rooms/${St.roomCode}/players/${St.myId}`), {
      currentJournalId: journalId || null,
      currentJournalName: j?.title || null
    });
  }
}

function saRefreshBtn() {
  const btn    = document.getElementById('speak-as-btn');
  const iconEl = document.getElementById('sa-icon');
  const nameEl = document.getElementById('sa-name');
  const inp    = document.getElementById('chat-input');
  if (!btn || !iconEl || !nameEl) return;

  if (St.speakAsJournalId) {
    const j  = loadJournals().find(x => x.id === St.speakAsJournalId);
    const av = saGetAvatar(St.speakAsJournalId);
    if (j) {
      btn.classList.add('active');
      nameEl.textContent = j.title || '무제';
      nameEl.style.color = j.nameColor || '';
      iconEl.innerHTML = av
        ? `<img src="${esc(av)}" alt="" style="width:16px;height:16px;object-fit:cover;border-radius:4px;display:block">`
        : esc((j.title || '?')[0].toUpperCase());
      if (inp && !St.descMode) inp.placeholder = `${esc(j.title || '무제')} 로 말하기… (Enter 전송)`;
      return;
    }
    St.speakAsJournalId = null; // 저널이 삭제됐으면 초기화
  }
  btn.classList.remove('active');
  nameEl.textContent = '나';
  nameEl.style.color = St.myNameColor || '';
  iconEl.innerHTML = `<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M2 12c0-2.21 2.239-4 5-4s5 1.79 5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  if (inp && !St.descMode) inp.placeholder = '메시지 입력 (Enter 전송)';
}

function saRefreshToolbar() {
  const wrap    = document.getElementById('speak-as-wrap');
  const toolbar = document.getElementById('chat-toolbar');
  if (!wrap || !toolbar) return;
  const hasJ = loadJournals().length > 0;
  wrap.style.display = hasJ ? '' : 'none';
  toolbar.classList.add('gm-visible');
  saRefreshBtn();
}

document.addEventListener('click', () => {
  document.getElementById('speak-as-dropdown')?.classList.remove('open');
  document.getElementById('whisper-dropdown')?.classList.remove('open');
  document.getElementById('sa-color-popup')?.classList.remove('open');
  document.getElementById('casual-color-popup')?.classList.remove('open');
});

const SA_COLORS = [
  '#b89a60','#e8c87a','#f5a623','#e74c3c','#e91e63','#ff6b6b',
  '#9b59b6','#8e44ad','#3498db','#2980b9','#7c9ece','#1abc9c',
  '#2ecc71','#27ae60','#f39c12','#e67e22','#95a5a6','#ecf0f1',
];

function renderColorPalettePopup(popup, title, currentColor, onSelect) {
  if (!popup) return;
  popup.innerHTML = `<div class="sa-color-popup-title">${title}</div><div class="sa-color-grid"></div>`;
  const grid = popup.querySelector('.sa-color-grid');
  SA_COLORS.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'sa-color-swatch' + (currentColor === color ? ' active' : '');
    swatch.style.background = color;
    swatch.onclick = (ev) => { ev.stopPropagation(); onSelect(color); popup.classList.remove('open'); };
    grid.appendChild(swatch);
  });
}

function toggleColorPalette(e) {
  e.stopPropagation();
  const popup = document.getElementById('sa-color-popup');
  if (!popup) return;
  document.getElementById('casual-color-popup')?.classList.remove('open');
  if (popup.classList.contains('open')) { popup.classList.remove('open'); return; }
  const jId = St.speakAsJournalId;
  const j = jId ? loadJournals().find(x => x.id === jId) : null;
  const currentColor = j ? (j.nameColor || '#b89a60') : (St.myNameColor || '#b89a60');
  renderColorPalettePopup(popup, '채팅 이름 색상', currentColor, setNameColor);
  popup.classList.add('open');
}

function toggleCasualColorPalette(e) {
  e.stopPropagation();
  const popup = document.getElementById('casual-color-popup');
  if (!popup) return;
  document.getElementById('sa-color-popup')?.classList.remove('open');
  if (popup.classList.contains('open')) { popup.classList.remove('open'); return; }
  renderColorPalettePopup(popup, '잡담 이름 색상', St.casualNameColor || '#b89a60', setCasualNameColor);
  popup.classList.add('open');
}

function setNameColor(color) {
  const jId = St.speakAsJournalId;
  if (jId) {
    const j = _allJournals.find(x => x.id === jId);
    if (!j) return;
    j.nameColor = color;
    saveJournalFB(j);
    saRefreshBtn();
  } else {
    St.myNameColor = color;
    try { localStorage.setItem('itc_name_color_' + St.myId, color); } catch(e) {}
    if (window._FB?.CONFIGURED && St.roomCode) {
      const { db, ref, update } = window._FB;
      update(ref(db, `rooms/${St.roomCode}/players/${St.myId}`), { nameColor: color });
    }
  }
  showToast('이름 색상이 변경됐어요.');
}

function setCasualNameColor(color) {
  St.casualNameColor = color;
  try { localStorage.setItem('itc_casual_name_color', color); } catch(e) {}
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, update } = window._FB;
    update(ref(db, `rooms/${St.roomCode}/players/${St.myId}`), { casualNameColor: color });
  }
  if (typeof refreshCasualNickDisplay === 'function') refreshCasualNickDisplay();
  showToast('잡담 이름 색상이 변경됐어요.');
}

function toggleWhisperDropdown(e) {
  e.stopPropagation();
  if (St.whisperTo) { clearWhisper(); return; }
  const dd = document.getElementById('whisper-dropdown');
  if (!dd) return;
  const isOpen = dd.classList.contains('open');
  document.getElementById('speak-as-dropdown')?.classList.remove('open');
  if (isOpen) { dd.classList.remove('open'); return; }
  renderWhisperDropdown();
  dd.classList.add('open');
}

function renderWhisperDropdown() {
  const dd = document.getElementById('whisper-dropdown');
  if (!dd) return;
  dd.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'w-dd-header';
  header.textContent = '귓말 대상 선택';
  dd.appendChild(header);

  const clear = document.createElement('div');
  clear.className = 'w-dd-item' + (!St.whisperTo ? ' selected' : '');
  clear.innerHTML = `<span>🔊 일반 채팅</span>`;
  clear.onclick = (e) => { e.stopPropagation(); clearWhisper(); dd.classList.remove('open'); };
  dd.appendChild(clear);

  const players = St.players || {};
  Object.entries(players).forEach(([id, p]) => {
    if (id === St.myId) return;
    const roleTag = p.role === 'gm' ? '<span class="w-dd-role">GM</span>' : '';
    const item = document.createElement('div');
    item.className = 'w-dd-item' + (St.whisperTo === id && !St.whisperToJournal ? ' selected' : '');
    item.innerHTML = `<span>🔒 ${esc(p.name)}에게 귓말</span>${roleTag}`;
    item.onclick = (e) => { e.stopPropagation(); selectWhisperTarget(id, p.name, null); dd.classList.remove('open'); };
    dd.appendChild(item);

    if (p.currentJournalName && p.currentJournalId) {
      const jItem = document.createElement('div');
      jItem.className = 'w-dd-item' + (St.whisperTo === id && St.whisperToJournal === p.currentJournalId ? ' selected' : '');
      jItem.style.paddingLeft = '24px';
      jItem.innerHTML = `<span>🔒 ${esc(p.currentJournalName)}에게 귓말</span><span class="w-dd-role">${esc(p.name)}</span>`;
      jItem.onclick = (e) => { e.stopPropagation(); selectWhisperTarget(id, p.currentJournalName, p.currentJournalId); dd.classList.remove('open'); };
      dd.appendChild(jItem);
    }
  });

  if (Object.keys(players).filter(id => id !== St.myId).length === 0) {
    const empty = document.createElement('div');
    empty.className = 'w-dd-item';
    empty.style.color = 'var(--muted)';
    empty.innerHTML = '<span>다른 플레이어가 없어요</span>';
    dd.appendChild(empty);
  }
}

function selectWhisperTarget(uid, name, journalId) {
  St.whisperTo = uid;
  St.whisperToName = name;
  St.whisperToJournal = journalId || null;
  if (St.descMode) toggleDescMode();
  refreshWhisperBtn();
  const inp = document.getElementById('chat-input');
  if (inp) {
    inp.classList.add('whisper-mode');
    inp.placeholder = `${name}에게 귓말 (Enter 전송)`;
    inp.focus();
  }
}

function clearWhisper() {
  St.whisperTo = null;
  St.whisperToName = null;
  St.whisperToJournal = null;
  refreshWhisperBtn();
  const inp = document.getElementById('chat-input');
  if (inp) {
    inp.classList.remove('whisper-mode');
    inp.placeholder = '메시지 입력 (Enter 전송)';
  }
}

function refreshWhisperBtn() {
  const btn = document.getElementById('whisper-btn');
  const label = document.getElementById('w-label');
  if (!btn) return;
  if (St.whisperTo) {
    btn.classList.add('active');
    if (label) label.textContent = `→ ${St.whisperToName}`;
  } else {
    btn.classList.remove('active');
    if (label) label.textContent = '귓말';
  }
}

