const St = {
  roomCode: '', system: 'coc7', myName: '', myId: '',
  tokens: {}, playlist: [], currentTrack: -1, isPlaying: false, repeatMode: 'off',
  tool: 'select', character: {}, recentRooms: [],
  selectedCharId: null,
  isGM: false,
  descMode: false,
  whisperTo: null,
  whisperToName: null,
  whisperToJournal: null,
  myNameColor: '',
  casualNameColor: localStorage.getItem('itc_casual_name_color') || '',
  players: {},
  avatarShape: localStorage.getItem('itc_avatar_shape') || 'rounded',
  mapState: { background: null, foreground: null },
  mapLayerState: null,
};

/* 권한 체크 헬퍼 */
var _allJournals = [];
var _allHandouts = [];
function requireGM(action) {
  if (!St.isGM) {
    showToast('GM만 사용할 수 있는 기능이에요.');
    return false;
  }
  return true;
}

function setAvatarShape(shape) {
  St.avatarShape = shape;
  localStorage.setItem('itc_avatar_shape', shape);
  updateShapeBtns();

  const r = shape === 'circle' ? '50%' : '6px';

  document.querySelectorAll('.msg-avatar').forEach(el => {
    el.classList.remove('shape-circle', 'shape-rounded');
    el.classList.add(shape === 'circle' ? 'shape-circle' : 'shape-rounded');
  });
  document.querySelectorAll('.msg-avatar-inner').forEach(el => {
    el.style.borderRadius = r;
  });
  document.querySelectorAll('.msg-avatar img').forEach(el => {
    el.style.borderRadius = r;
  });

  showToast(shape === 'circle' ? '원형으로 변경됐어요' : '둥근 네모로 변경됐어요');
}

function updateShapeBtns() {
  const shape = St.avatarShape;
  const btnR = document.getElementById('shape-btn-rounded');
  const btnC = document.getElementById('shape-btn-circle');
  if (!btnR || !btnC) return;
  const on  = 'border-color:var(--accent);background:var(--a-dim);color:var(--accent)';
  const off = 'border-color:var(--border);background:var(--s2);color:var(--dim)';
  [btnR, btnC].forEach((btn, i) => {
    const isActive = (i === 0 && shape === 'rounded') || (i === 1 && shape === 'circle');
    btn.style.borderColor  = isActive ? 'var(--accent)' : 'var(--border)';
    btn.style.background   = isActive ? 'var(--a-dim)'  : 'var(--s2)';
    btn.style.color        = isActive ? 'var(--accent)' : 'var(--dim)';
  });
}

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
      background:var(--s3);border:1px solid var(--border2);border-radius:var(--r);
      padding:9px 18px;font-size:13px;color:var(--dim);z-index:999;
      animation:fadeUp .2s ease;pointer-events:none;white-space:nowrap`;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { if (t && t.isConnected) t.style.display = 'none'; }, 2200);
}

const SYS_LABELS = { coc7:'CoC 7판', dx3:'더블크로스 3rd', shinobigami:'시노비가미', insane:'인세인' };



function switchRightTab(tab) {
  _activeRightTab = tab;
  document.querySelectorAll('.rtab').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('.right-pane').forEach(p => p.classList.remove('on'));
  document.getElementById('rtab-' + tab).classList.add('on');
  document.getElementById('rpane-' + tab).classList.add('on');
  const shared = document.getElementById('shared-input-area');
  if (shared) shared.style.display = (tab === 'journal') ? 'none' : '';
  const saWrap = document.getElementById('speak-as-wrap');
  const casualBar = document.getElementById('casual-nick-bar');
  const colorWrap = document.getElementById('sa-color-wrap');
  const casualColorWrap = document.getElementById('casual-color-wrap');
  const descBtn = document.getElementById('desc-toggle-btn');
  const whisperWrap = document.getElementById('whisper-wrap');
  if (tab === 'casual') {
    if (saWrap) saWrap.style.display = 'none';
    if (casualBar) { casualBar.style.display = 'flex'; refreshCasualNickDisplay(); }
    if (colorWrap) colorWrap.style.display = 'none';
    if (casualColorWrap) casualColorWrap.style.display = '';
    if (descBtn) descBtn.style.display = 'none';
    if (whisperWrap) whisperWrap.style.display = 'none';
  } else {
    if (saWrap) saWrap.style.display = '';
    if (casualBar) casualBar.style.display = 'none';
    if (colorWrap) colorWrap.style.display = '';
    if (casualColorWrap) casualColorWrap.style.display = 'none';
    if (descBtn) descBtn.style.display = hasPerm('sendDesc') ? '' : 'none';
    if (whisperWrap) whisperWrap.style.display = '';
  }
  if (typeof refreshChatActionButtons === 'function') refreshChatActionButtons();
  if (tab === 'journal') {
    if (typeof renderJournalList === 'function') renderJournalList();
    if (typeof renderHandoutList === 'function') renderHandoutList();
  }
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


/* Chat message actions moved to src/modules/chat-v1/chat.js via dev/chat-v1/_chat-actions.js.
 * v1-core.js keeps only shared app/core helpers.
 */

window.addEventListener('DOMContentLoaded', () => {
  if (window.innerWidth < 700) {
    const brand = document.querySelector('.auth-brand');
    if (brand) brand.style.display = 'none';
  }
  initAuthScreen();
});
