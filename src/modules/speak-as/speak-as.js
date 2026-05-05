/**
 * ITC TRPG — Speak-As 모듈
 * 저널로 말하기, VN 대사창, 스탠딩, 색상, 귓말
 */

const _JAV = {};

function getSpeakAsServerTimestamp() {
  return (window._FB?.CONFIGURED && typeof window._FB.serverTimestamp === 'function')
    ? window._FB.serverTimestamp()
    : Date.now();
}

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


function saNormalizeNameColor(color) {
  return String(color || '').trim();
}

function saSetJournalNameColor(journalId, color) {
  const safeId = String(journalId || '').trim();
  if (!safeId) return '';
  const safeColor = saNormalizeNameColor(color);
  const j = (_allJournals || []).find(x => String(x.id || '') === safeId);
  if (j) {
    j.nameColor = safeColor;
    if (!j.sheet || typeof j.sheet !== 'object') j.sheet = {};
    j.sheet.nameColor = safeColor;
  }
  return safeColor;
}

function saGetJournalNameColor(journalId, fallbackJournal = null) {
  const safeId = String(journalId || fallbackJournal?.id || '').trim();
  const j = fallbackJournal || (safeId ? (_allJournals || []).find(x => String(x.id || '') === safeId) : null);
  const safeColor = saNormalizeNameColor(j?.nameColor || j?.sheet?.nameColor || '');
  if (safeId && safeColor) saSetJournalNameColor(safeId, safeColor);
  return safeColor;
}

function normalizeStandingLabel(value = '') {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .trim();
}

function normalizeStandingMatchKey(value = '') {
  return normalizeStandingLabel(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[.,!?;:，。！？；：、]+$/g, '')
    .trim()
    .toLowerCase();
}

function getStandingAtLabelFromText(text = '') {
  const match = String(text || '').match(/(^|\s)@([^\s@]+)/);
  if (!match) return '';
  return normalizeStandingLabel(match[2]).replace(/[.,!?;:，。！？；：、]+$/g, '').trim();
}

function findStandingByLabel(standings = [], label = '') {
  const key = normalizeStandingMatchKey(label);
  if (!key) return null;
  return (Array.isArray(standings) ? standings : []).find((standing) => {
    if (!standing?.img) return false;
    return normalizeStandingMatchKey(standing.label || '') === key;
  }) || null;
}

function applyStandingSelectionLocal(journalOrId, tokenId, standingLabel, options = {}) {
  const journalId = typeof journalOrId === 'string' ? journalOrId : String(journalOrId?.id || '');
  const safeTokenId = String(tokenId || '').trim();
  const safeLabel = String(standingLabel || '').trim();
  if (!journalId || !safeTokenId || !safeLabel || !St?.tokens?.[safeTokenId]) return null;

  const token = St.tokens[safeTokenId];
  const standing = findStandingByLabel(token.standings || [], safeLabel);
  const finalLabel = standing?.label || safeLabel;

  token.currentStandingLabel = finalLabel;
  token.currentStandingJournalId = journalId;
  _vnCurrentStanding[journalId] = finalLabel;

  if (options.render !== false) {
    if (typeof addOrUpdateSingleToken === 'function') addOrUpdateSingleToken(safeTokenId, token);
    else if (typeof updateTokenStandingOnMap === 'function') updateTokenStandingOnMap(journalId);
    if (typeof refreshQuickStandingMenuForToken === 'function') refreshQuickStandingMenuForToken(safeTokenId);
    else if (typeof refreshQuickStandingMenuIfOpen === 'function') refreshQuickStandingMenuIfOpen();
  }

  return { token, standing, label: finalLabel, tokenId: safeTokenId, journalId };
}

async function persistStandingSelection(command = {}) {
  const safeTokenId = String(command?.tokenId || '').trim();
  const safeJournalId = String(command?.journalId || '').trim();
  const safeLabel = String(command?.label || '').trim();
  if (!safeTokenId || !safeJournalId || !safeLabel || !window._FB?.CONFIGURED || !St.roomCode) return;
  const { db, ref, update } = window._FB;
  if (!db || !ref || typeof update !== 'function') return;
  await update(ref(db, `rooms/${St.roomCode}/tokens/${safeTokenId}`), {
    currentStandingLabel: safeLabel,
    currentStandingJournalId: safeJournalId,
  });
}

function resolveStandingForJournal(journal, text = '') {
  const token = getJournalToken(journal);
  if (!journal?.id || !token) return null;

  const standings = Array.isArray(token.standings) ? token.standings : [];
  const hasStandings = standings.length > 0 && standings.some(s => s?.img);
  if (!hasStandings) return token.tokenImg ? { img: token.tokenImg, label: '', token, explicit: false } : null;

  const requestedLabel = getStandingAtLabelFromText(text);
  if (requestedLabel) {
    const found = findStandingByLabel(standings, requestedLabel);
    if (found) {
      const applied = applyStandingSelectionLocal(journal, token.id, found.label, { render: true });
      return { img: found.img, label: applied?.label || found.label, token, standing: found, explicit: true };
    }
  }

  if (token.currentStandingLabel) {
    const synced = findStandingByLabel(standings, token.currentStandingLabel);
    if (synced) {
      _vnCurrentStanding[journal.id] = synced.label;
      return { img: synced.img, label: synced.label, token, standing: synced, explicit: false };
    }
  }

  if (_vnCurrentStanding[journal.id]) {
    const prev = findStandingByLabel(standings, _vnCurrentStanding[journal.id]);
    if (prev) return { img: prev.img, label: prev.label, token, standing: prev, explicit: false };
  }

  const first = standings.find(s => s?.img);
  if (first) {
    _vnCurrentStanding[journal.id] = first.label;
    return { img: first.img, label: first.label, token, standing: first, explicit: false };
  }

  if (token.tokenImg) return { img: token.tokenImg, label: '', token, explicit: false };
  return null;
}

function saBuildMessageContext(journal, text = '') {
  if (!journal?.id) return null;
  const avatar = saGetAvatar(journal.id);
  const standingContext = resolveStandingForJournal(journal, text);
  const showPortrait = journal.showPortraitInDialogue === true || journal.sheet?.showPortraitInDialogue === true;
  const payload = {
    name: journal.title || '무제',
    speakAsAvatar: avatar,
    speakAsJournalId: journal.id,
    nameColor: saGetJournalNameColor(journal.id, journal),
    showPortraitInDialogue: !!showPortrait,
    dialoguePortrait: showPortrait && avatar ? avatar : '',
  };
  const assignedTokenId = journal.assignedTokenId || standingContext?.token?.id || '';
  if (assignedTokenId) {
    payload.tokenId = assignedTokenId;
    payload.standingLabel = standingContext?.label || _vnCurrentStanding[journal.id] || '';
    payload.standingImg = standingContext?.img || '';
    if (standingContext?.explicit && payload.standingLabel) {
      payload._standingCommand = {
        tokenId: assignedTokenId,
        journalId: journal.id,
        label: payload.standingLabel,
      };
    }
  }
  return payload;
}

function saGetSelectedJournalContext(text = '') {
  if (!St?.speakAsJournalId || typeof loadJournals !== 'function') return null;
  const journal = loadJournals().find(x => x.id === St.speakAsJournalId);
  if (!journal) return null;
  return saBuildMessageContext(journal, text);
}

function saSendMessage(journal, text) {
  const context = saBuildMessageContext(journal, text);
  if (!context) return Promise.resolve();
  const { _standingCommand, ...sendContext } = context;
  const msg = {
    ...sendContext,
    text,
    type: 'speak-as',
    uid: St.myId,
    time: Date.now(),
  };

  const standingPromise = _standingCommand
    ? persistStandingSelection(_standingCommand).catch((err) => {
        console.warn('[standing] @ standing persist failed', err);
        if (typeof showToast === 'function') showToast('스탠딩 변경 저장에 실패했어요. 권한을 확인해 주세요.');
      })
    : Promise.resolve();

  if (window._FB?.CONFIGURED) {
    const { db, ref, push } = window._FB;
    const currentChannelKey = String(window._itcActiveChatChannelKey || (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global') || 'global').trim() || 'global';
    const payload = { ...msg, dmChannelKey: currentChannelKey, time: getSpeakAsServerTimestamp() };
    const chatPromise = push(ref(db, `rooms/${St.roomCode}/chat`), payload)
      .then((pushedRef) => {
        if (currentChannelKey && currentChannelKey !== 'global' && typeof window.touchDmChannelMetaForMessage === 'function') {
          return window.touchDmChannelMetaForMessage(currentChannelKey, payload, pushedRef?.key || '').then(() => pushedRef);
        }
        return pushedRef;
      })
      .catch((err) => {
        console.warn('[dm] speak-as message send/meta update failed', err);
        throw err;
      });
    return Promise.allSettled([standingPromise, chatPromise]).then((results) => {
      const chatResult = results[1];
      if (chatResult?.status === 'rejected') throw chatResult.reason;
      return chatResult?.value || null;
    });
  }

  appendChatMsg({ ...msg, timestamp: msg.time, channel: 'chat' });
  return standingPromise;
}

let _vnCurrentStanding = {};  // journalId → 현재 스탠딩 라벨
let _vnTimer = null;

function getJournalToken(journal) {
  const j = typeof journal === 'string' ? _allJournals.find(x => x.id === journal) : journal;
  if (!j?.assignedTokenId) return null;
  return St.tokens[j.assignedTokenId] || null;
}

function resolveStandingImage(journal, text) {
  return resolveStandingForJournal(journal, text)?.img || null;
}

function cleanDialogueText(text) {
  return String(text || '').replace(/@\S+/g, '').trim();
}

function formatDialogueText(text) {
  const raw = String(text || '');
  if (typeof fmtText === 'function') return fmtText(raw);
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/\n/g, '<br>');
}

function resolveDialoguePortrait(journal, explicitPortrait = '', explicitEnabled = null) {
  const isEnabled = explicitEnabled === true
    || journal?.showPortraitInDialogue === true
    || journal?.sheet?.showPortraitInDialogue === true;
  if (!isEnabled) return '';
  const src = explicitPortrait || (journal?.id ? saGetAvatar(journal.id) : '') || journal?.avatar || journal?.sheet?.avatar || '';
  return typeof src === 'string' && src.trim() && !saIsEphemeralAvatarSrc(src) ? src.trim() : '';
}

function renderDialoguePortrait(dialog, journal, explicitPortrait = '', explicitEnabled = null) {
  const portraitEl = document.getElementById('vn-portrait');
  if (!dialog || !portraitEl) return;
  const src = resolveDialoguePortrait(journal, explicitPortrait, explicitEnabled);
  portraitEl.textContent = '';
  dialog.classList.remove('has-portrait');
  if (!src) return;
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  portraitEl.appendChild(img);
  dialog.classList.add('has-portrait');
}

function updateTokenStandingOnMap(journalId) {
  const j = _allJournals.find(x => x.id === journalId);
  if (!j?.assignedTokenId) return;
  const t = St.tokens[j.assignedTokenId];
  if (!t || !t.standingAsToken) return;
  const el = document.getElementById('tok-' + t.id);
  if (!el) return;
  const curLabel = String(t.currentStandingLabel || _vnCurrentStanding[journalId] || '').trim();
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
  textEl.innerHTML = formatDialogueText(cleanText);
  renderDialoguePortrait(dialog, journal);

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

function showDialogueBoxFromMsg(name, text, journalId, standingImg, tokenId, standingLabel, dialoguePortrait = '', showPortraitInDialogue = null) {
  const journal = journalId ? _allJournals.find(x => x.id === journalId) : null;
  const dialog = document.getElementById('vn-dialog');
  const nameEl = document.getElementById('vn-name');
  const textEl = document.getElementById('vn-text');
  const standingEl = document.getElementById('vn-standing');
  if (!dialog) return;
  if (_vnTimer) { clearTimeout(_vnTimer); _vnTimer = null; }

  nameEl.textContent = (journal?.title || name || '???');
  const cleanText = cleanDialogueText(text);
  textEl.innerHTML = formatDialogueText(cleanText);
  renderDialoguePortrait(dialog, journal, dialoguePortrait, showPortraitInDialogue);

  // 스탠딩 resolve: 3단계 fallback
  let finalStanding = null;

  // 1단계: 메시지에 저장된 tokenId + standingLabel을 먼저 사용한다.
  // 수신자가 이후 다른 스탠딩을 선택해도 과거 메시지의 스탠딩이 바뀌어 보이지 않게 한다.
  if (tokenId) {
    const token = St.tokens[tokenId];
    if (token) {
      const standings = token.standings || [];
      if (standingLabel) {
        const found = findStandingByLabel(standings, standingLabel);
        if (found) {
          finalStanding = found.img;
          if (journalId) applyStandingSelectionLocal(journalId, tokenId, found.label, { render: true });
        }
      }
      if (!finalStanding && !standingLabel) {
        const first = standings.find(s => s.img);
        if (first) finalStanding = first.img;
      }
      if (!finalStanding && token.tokenImg) finalStanding = token.tokenImg;
    }
  }

  // 2단계: 현재 저널/토큰 상태 기반 resolve
  if (!finalStanding && journal) {
    finalStanding = resolveStandingImage(journal, text);
    updateTokenStandingOnMap(journal.id);
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
  if (typeof refreshQuickStandingMenuIfOpen === 'function') refreshQuickStandingMenuIfOpen();
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
      nameEl.style.color = saGetJournalNameColor(j.id, j) || '';
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

function renderColorPalettePopup(popup, title, currentColor, onPick) {
  popup.innerHTML = '<div class="sa-color-popup-title">' + title + '</div><div class="sa-color-grid"></div>';
  const grid = popup.querySelector('.sa-color-grid');
  SA_COLORS.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'sa-color-swatch' + (currentColor === color ? ' active' : '');
    swatch.style.background = color;
    swatch.onclick = (ev) => { ev.stopPropagation(); onPick(color); popup.classList.remove('open'); };
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
  const currentColor = j ? (saGetJournalNameColor(j.id, j) || '#b89a60') : (St.myNameColor || '#b89a60');
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
  const safeColor = saNormalizeNameColor(color);
  const jId = String(St.speakAsJournalId || '').trim();
  if (jId) {
    const j = (_allJournals || []).find(x => String(x.id || '') === jId);
    if (!j) return;
    const prevColor = saGetJournalNameColor(jId, j);
    saSetJournalNameColor(jId, safeColor);
    saRefreshToolbar();
    if (typeof renderJournalList === 'function') renderJournalList();
    const savePromise = typeof saveJournalNameColorFB === 'function'
      ? saveJournalNameColorFB(jId, safeColor)
      : Promise.resolve();
    Promise.resolve(savePromise).then(() => {
      if (typeof saRefreshBtn === 'function') saRefreshBtn();
    }).catch((err) => {
      console.error('journal nameColor save failed', err);
      saSetJournalNameColor(jId, prevColor);
      if (typeof fetchJournalsFromFB === 'function') fetchJournalsFromFB();
      saRefreshToolbar();
      showToast('저널 이름 색상 저장에 실패했어요. 권한을 확인해 주세요.');
    });
  } else {
    St.myNameColor = safeColor;
    try { localStorage.setItem('itc_name_color_' + St.myId, safeColor); } catch(e) {}
    if (window._FB?.CONFIGURED && St.roomCode) {
      const { db, ref, update } = window._FB;
      update(ref(db, `rooms/${St.roomCode}/players/${St.myId}`), { nameColor: safeColor });
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


function getNameColorProfileForPopout() {
  const jId = String(St.speakAsJournalId || '').trim();
  if (jId) return { journalId: jId, color: saGetJournalNameColor(jId) || '' };
  return { journalId: '', color: St.myNameColor || '' };
}

function setNameColorFromPopout(color) {
  setNameColor(color);
  return getNameColorProfileForPopout();
}

window.getNameColorProfileForPopout = getNameColorProfileForPopout;
window.setNameColorFromPopout = setNameColorFromPopout;

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
  clear.innerHTML = `<span>일반 채팅</span>`;
  clear.onclick = (e) => { e.stopPropagation(); clearWhisper(); dd.classList.remove('open'); };
  dd.appendChild(clear);

  const players = St.players || {};
  Object.entries(players).forEach(([id, p]) => {
    if (id === St.myId) return;
    const roleTag = p.role === 'gm' ? '<span class="w-dd-role">GM</span>' : '';
    const item = document.createElement('div');
    item.className = 'w-dd-item' + (St.whisperTo === id && !St.whisperToJournal ? ' selected' : '');
    item.innerHTML = `<span>${esc(p.name)}에게 귓말</span>${roleTag}`;
    item.onclick = (e) => { e.stopPropagation(); selectWhisperTarget(id, p.name, null); dd.classList.remove('open'); };
    dd.appendChild(item);

    if (p.currentJournalName && p.currentJournalId) {
      const jItem = document.createElement('div');
      jItem.className = 'w-dd-item' + (St.whisperTo === id && St.whisperToJournal === p.currentJournalId ? ' selected' : '');
      jItem.style.paddingLeft = '24px';
      jItem.innerHTML = `<span>${esc(p.currentJournalName)}에게 귓말</span><span class="w-dd-role">${esc(p.name)}</span>`;
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



window.saBuildMessageContext = saBuildMessageContext;
window.saGetSelectedJournalContext = saGetSelectedJournalContext;
