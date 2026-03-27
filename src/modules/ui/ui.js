/**
 * ITC TRPG — UI 모듈
 * 모달, 권한, 설정, 패널, 리사이즈
 */

function openModal(id) {
  document.getElementById(id).classList.add('open');
  if (id === 'modal-settings') renderSettingsModal();
  if (id === 'modal-profile')  initProfileModal();
}

const PERMS = [
  { key: 'moveToken',   label: '토큰 이동',   desc: '맵에서 토큰을 드래그하여 이동' },
  { key: 'createToken', label: '토큰 생성',   desc: '맵에 새 토큰을 추가' },
  { key: 'editToken',   label: '토큰 편집',   desc: '토큰 우클릭 편집/삭제' },
  { key: 'manageMap',   label: '맵 관리',     desc: '맵 배경 업로드 및 변경' },
  { key: 'manageBgm',   label: 'BGM 관리',    desc: 'BGM 추가/삭제/변경' },
  { key: 'sendDesc',    label: 'desc 입력',   desc: '/desc 지문 명령어 사용' },
];

let _myPerms = {};

const ALL_PLAYER_PERMS = PERMS.reduce((acc, pm) => {
  acc[pm.key] = true;
  return acc;
}, {});

function getStoredChatFontSize() {
  const raw = parseFloat(localStorage.getItem('itc_chat_font_size') || '14.5');
  if (!Number.isFinite(raw)) return 14.5;
  return Math.max(12, Math.min(20, raw));
}

function applyChatFontSize(size) {
  const next = Math.max(12, Math.min(20, parseFloat(size) || 14.5));
  document.documentElement.style.setProperty('--chat-font-size', next + 'px');
  localStorage.setItem('itc_chat_font_size', String(next));
  const slider = document.getElementById('chat-font-size-slider');
  const value = document.getElementById('chat-font-size-value');
  const preview = document.getElementById('chat-font-preview');
  if (slider) slider.value = String(next);
  if (value) value.textContent = `${next % 1 === 0 ? next.toFixed(0) : next.toFixed(1)}px`;
  if (preview) preview.style.fontSize = next + 'px';
}

function syncChatFontSizeUI() {
  applyChatFontSize(getStoredChatFontSize());
}

function setChatFontSize(size) {
  applyChatFontSize(size);
}

async function setPlayerPermPreset(uid, enabled) {
  if (!St.isGM || !window._FB?.CONFIGURED) return;
  const { db, ref, update } = window._FB;
  const payload = {};
  Object.keys(ALL_PLAYER_PERMS).forEach((key) => {
    payload[key] = enabled ? true : null;
  });
  await update(ref(db, `rooms/${St.roomCode}/players/${uid}/permissions`), payload);
  renderSettingsModal();
}

function hasPerm(key) {
  if (St.isGM) return true;
  return !!_myPerms[key];
}

function refreshMyPerms() {
  if (St.isGM) { _myPerms = {}; return; }
  const me = St.players?.[St.myId];
  _myPerms = me?.permissions || {};
}

function refreshPermUI() {
  const addToken = document.getElementById('map-add-token');
  if (addToken) addToken.style.display = hasPerm('createToken') ? '' : 'none';
  document.querySelectorAll('.bgm-add').forEach(el => { el.style.display = hasPerm('manageBgm') ? '' : 'none'; });
  const descBtn = document.getElementById('desc-toggle-btn');
  if (descBtn) descBtn.style.display = hasPerm('sendDesc') ? '' : 'none';
  const endBtn = document.getElementById('btn-end-room');
  if (endBtn) endBtn.style.display = St.isGM ? '' : 'none';
  const gmMgmt = document.getElementById('gm-player-mgmt');
  if (gmMgmt) gmMgmt.style.display = St.isGM ? 'block' : 'none';
}

function getPlayerPerms(player) {
  if (player.role === 'gm') return PERMS.reduce((o, p) => ({ ...o, [p.key]: true }), {});
  return player.permissions || {};
}

function renderSettingsModal() {
  const roleEl = document.getElementById('role-disp');
  if (roleEl) roleEl.textContent = St.isGM ? 'GM (방장)' : '플레이어';

  const gmSection = document.getElementById('gm-player-mgmt');
  const endBtn    = document.getElementById('btn-end-room');
  if (gmSection) gmSection.style.display = St.isGM ? 'block' : 'none';
  if (endBtn)    endBtn.style.display    = St.isGM ? '' : 'none';

  updateShapeBtns();
  if (typeof syncChatFontSizeUI === 'function') syncChatFontSizeUI();

  if (!window._FB?.CONFIGURED) return;
  const { db, ref, get } = window._FB;
  get(ref(db, `rooms/${St.roomCode}/players`)).then(snap => {
    const players = snap.val() || {};
    const list = document.getElementById('player-mgmt-list');
    if (!list) return;
    list.innerHTML = '';

    Object.entries(players).forEach(([uid, p]) => {
      const isGM = p.role === 'gm';
      const isMe = uid === St.myId;
      const perms = getPlayerPerms(p);

      const card = document.createElement('div');
      card.style.cssText = 'background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;';

      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
      const nameDiv = document.createElement('div');
      nameDiv.style.cssText = 'flex:1;font-size:13px;font-weight:600;color:var(--text)';
      nameDiv.textContent = p.name;
      if (isMe) { const me = document.createElement('span'); me.style.cssText='font-size:10px;color:var(--muted);margin-left:4px'; me.textContent='(나)'; nameDiv.appendChild(me); }
      header.appendChild(nameDiv);

      const roleTag = document.createElement('div');
      roleTag.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:4px;' + (isGM ? 'background:rgba(184,154,96,.15);color:var(--accent);border:1px solid rgba(184,154,96,.3)' : 'background:var(--s3);color:var(--muted);border:1px solid var(--border)');
      roleTag.textContent = isGM ? 'GM' : '플레이어';
      header.appendChild(roleTag);

      if (St.isGM && !isMe && !isGM) {
        const kickBtn = document.createElement('button');
        kickBtn.style.cssText = 'background:none;border:1px solid rgba(200,92,92,.3);border-radius:4px;color:var(--red);font:inherit;font-size:10px;padding:2px 8px;cursor:pointer';
        kickBtn.textContent = '강퇴';
        kickBtn.onclick = () => kickPlayer(uid, p.name);
        header.appendChild(kickBtn);
      }

      card.appendChild(header);

      if (isGM) {
        const allPerms = document.createElement('div');
        allPerms.style.cssText = 'font-size:10px;color:var(--dim);padding:4px 0';
        allPerms.textContent = '모든 권한 보유';
        card.appendChild(allPerms);
      } else {
        if (St.isGM) {
          const bulkRow = document.createElement('div');
          bulkRow.style.cssText = 'display:flex;gap:6px;margin-top:2px;margin-bottom:6px';

          const grantBtn = document.createElement('button');
          grantBtn.style.cssText = 'flex:1;font:inherit;font-size:10px;padding:5px 8px;border-radius:6px;cursor:pointer;transition:.15s ease;border:1px solid rgba(90,158,114,.35);background:rgba(90,158,114,.10);color:var(--green)';
          grantBtn.textContent = '권한 모두 부여';
          grantBtn.onclick = () => setPlayerPermPreset(uid, true);
          bulkRow.appendChild(grantBtn);

          const revokeBtn = document.createElement('button');
          revokeBtn.style.cssText = 'flex:1;font:inherit;font-size:10px;padding:5px 8px;border-radius:6px;cursor:pointer;transition:.15s ease;border:1px solid rgba(200,92,92,.28);background:rgba(200,92,92,.08);color:var(--red)';
          revokeBtn.textContent = '권한 모두 회수';
          revokeBtn.onclick = () => setPlayerPermPreset(uid, false);
          bulkRow.appendChild(revokeBtn);

          card.appendChild(bulkRow);
        }

        const permWrap = document.createElement('div');
        permWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px';
        PERMS.forEach(pm => {
          const has = !!perms[pm.key];
          if (St.isGM) {
            const btn = document.createElement('button');
            btn.title = pm.desc;
            btn.style.cssText = 'font:inherit;font-size:10px;padding:3px 8px;border-radius:4px;cursor:pointer;transition:.15s ease;border:1px solid '+(has?'rgba(90,158,114,.4)':'var(--border)')+';background:'+(has?'rgba(90,158,114,.12)':'var(--s3)')+';color:'+(has?'var(--green)':'var(--muted)');
            btn.textContent = (has?'\u2713 ':'')+pm.label;
            btn.onclick = () => togglePerm(uid, pm.key, !has);
            permWrap.appendChild(btn);
          } else {
            const span = document.createElement('span');
            span.style.cssText = 'font-size:10px;padding:3px 8px;border-radius:4px;border:1px solid '+(has?'rgba(90,158,114,.4)':'var(--border)')+';background:'+(has?'rgba(90,158,114,.12)':'var(--s3)')+';color:'+(has?'var(--green)':'var(--muted)');
            span.textContent = (has?'\u2713 ':'\u2715 ')+pm.label;
            permWrap.appendChild(span);
          }
        });
        card.appendChild(permWrap);
      }

      list.appendChild(card);
    });
  });
}

async function togglePerm(uid, permKey, value) {
  if (!St.isGM || !window._FB?.CONFIGURED) return;
  const { db, ref, update } = window._FB;
  const updates = {};
  updates[permKey] = value || null;
  await update(ref(db, `rooms/${St.roomCode}/players/${uid}/permissions`), updates);
  renderSettingsModal();
}

async function kickPlayer(uid, name) {
  if (!St.isGM) return;
  if (!confirm(`${name}님을 강퇴하시겠습니까?`)) return;
  const { db, ref, remove } = window._FB;
  await remove(ref(db, `rooms/${St.roomCode}/players/${uid}`));
  sendMessage('시스템', `${name}님이 GM에 의해 강퇴되었습니다.`, 'sys');
  renderSettingsModal();
}

async function endRoom() {
  if (!St.isGM || !window._FB?.CONFIGURED || !St.roomCode) return;
  if (!confirm('방을 종료하면 세션이 완전히 삭제되고 모든 플레이어 목록에서도 사라집니다. 계속하시겠습니까?')) return;

  const { db, ref, get, update } = window._FB;

  try {
    const roomCode = St.roomCode;
    const playersSnap = await get(ref(db, `rooms/${roomCode}/players`));
    const playerIds = playersSnap.exists() ? Object.keys(playersSnap.val() || {}) : [];
    const updates = {};

    playerIds.forEach((uid) => {
      updates[`users/${uid}/rooms/${roomCode}`] = null;
    });
    updates[`rooms/${roomCode}`] = null;

    await update(ref(db), updates);

    try { localStorage.removeItem('itc_cover_' + roomCode); } catch (err) {}
    try {
      const recent = JSON.parse(localStorage.getItem('tt_recent') || '[]').filter((room) => room.code !== roomCode);
      localStorage.setItem('tt_recent', JSON.stringify(recent));
    } catch (err) {}

    sessionStorage.removeItem('itc_session_code');
    sessionStorage.removeItem('itc_session_sys');
    sessionStorage.removeItem('itc_session_role');

    location.reload();
  } catch (err) {
    console.error('end room failed', err);
    showToast('방 종료에 실패했어요. 다시 시도해 주세요.');
  }
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target===o) o.classList.remove('open'); }));
syncChatFontSizeUI();

function togglePanel(side) { document.getElementById(`panel-${side}`).classList.toggle('collapsed'); }

function toggleChatPanel() {
  const panel = document.getElementById('panel-right');
  const isCollapsed = panel.classList.contains('collapsed');
  if (!isCollapsed) {
    panel._savedWidth = panel.style.width || '';
    panel._savedMinWidth = panel.style.minWidth || '';
    panel.style.width = '';
    panel.style.minWidth = '';
  }
  panel.classList.toggle('collapsed');
  if (isCollapsed && panel._savedWidth) {
    panel.style.width = panel._savedWidth;
    panel.style.minWidth = panel._savedMinWidth;
  }
  const btn = document.getElementById('chat-toggle-btn');
  if (btn) btn.textContent = panel.classList.contains('collapsed') ? '▶' : '◀';
}

function switchPanelTab(tab, btn) {
  document.querySelectorAll('.ptab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  if (tab === 'notes') {
    document.getElementById('sheet-container').innerHTML = `<textarea class="notes-area" style="min-height:340px;width:100%" placeholder="세션 노트..." oninput="ch('notes',this.value)">${esc(St.character.notes||'')}</textarea>`;
  } else {
    renderCharacterSheet(St.system);
  }
}

function copyRoomCode() {
  navigator.clipboard.writeText(St.roomCode).then(() => {
    const el = document.getElementById('topbar-code');
    el.textContent = '✓ 복사됨';
    setTimeout(() => el.textContent = St.roomCode, 1500);
  });
}

/* 로비로 돌아가기 (방은 유지) */
async function goToLobby() {
  if (St.roomCode && !confirm('로비로 돌아갈까요?\n방은 유지되며 나중에 다시 입장할 수 있어요.')) return;
  if (window._FB?.CONFIGURED && St.roomCode) {
    const { db, ref, update } = window._FB;
    await update(ref(db, `rooms/${St.roomCode}/players/${St.myId}`), { online: false });
  }
  if (_campaignUnsub) { _campaignUnsub(); _campaignUnsub = null; }
  sessionStorage.removeItem('itc_session_code');
  sessionStorage.removeItem('itc_session_sys');
  sessionStorage.removeItem('itc_session_role');

  sessionStorage.removeItem('itc_session_code');
  sessionStorage.removeItem('itc_session_sys');
  sessionStorage.removeItem('itc_session_role');
  St.roomCode = ''; St.isGM = false;
  closeModal('modal-settings');
  showLobby();
}


function initChatResize() {
  const handle = document.getElementById('chat-resize-handle');
  const panel  = document.getElementById('panel-right');
  if (!handle || !panel) return;

  let startX, startW;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startX = e.clientX;
    startW = panel.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e) {
      const maxW = Math.floor(window.innerWidth * 0.5);
      const minW = 15;
      const delta = startX - e.clientX;
      const newW  = Math.max(minW, Math.min(maxW, startW + delta));
      panel.style.width    = newW + 'px';
      panel.style.minWidth = newW + 'px';
    }

    function onUp() {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem('itc_chat_width', panel.offsetWidth);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  const saved = localStorage.getItem('itc_chat_width');
  if (saved) {
    const w   = parseInt(saved);
    const max = Math.floor(window.innerWidth * 0.5);
    if (w >= 15 && w <= max) {
      panel.style.width    = w + 'px';
      panel.style.minWidth = w + 'px';
    }
  }
}

