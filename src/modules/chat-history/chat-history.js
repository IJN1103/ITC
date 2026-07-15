import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getDatabase, ref, get, query, orderByKey, endBefore, limitToLast } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCOpAaGDNbfFy7pETmKA6Y2wUf2oj1wQRY',
  authDomain: 'project-itc-2d34d.firebaseapp.com',
  databaseURL: 'https://project-itc-2d34d-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'project-itc-2d34d',
  storageBucket: 'project-itc-2d34d.firebasestorage.app',
  messagingSenderId: '89572142319',
  appId: '1:89572142319:web:fbeb6c7bb8bf279dd0bf1a'
};

const params = new URLSearchParams(location.search);
const roomCode = String(params.get('room') || '').trim();
const initialType = ['global', 'casual', 'dm'].includes(params.get('type')) ? params.get('type') : 'global';
const requestedDmChannel = String(params.get('channel') || '').trim();
const PAGE_SIZE = 100;
const SCAN_SIZE = 320;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const listEl = document.getElementById('history-list');
const statusEl = document.getElementById('history-status');
const countEl = document.getElementById('history-count');
const emptyEl = document.getElementById('history-empty');
const loadingEl = document.getElementById('history-loading');
const errorEl = document.getElementById('history-error');
const titleEl = document.getElementById('history-title');
const tabButtons = [...document.querySelectorAll('[data-history-tab]')];
const dmPanelEl = document.getElementById('dm-channel-panel');
const dmListEl = document.getElementById('dm-channel-list');
const dmSummaryEl = document.getElementById('dm-channel-summary');

let currentUser = null;
let activeType = initialType;
let activeDmChannel = '';
let switching = false;
let accessReady = false;
let viewRevision = 0;
let unauthorizedRequestedDm = false;
let accessInfo = { isGm: false, ownerId: '', player: null };
let dmChannels = [];
const participantProfiles = new Map();
const baseStates = {
  global: { cursorKey: '', exhausted: false, loading: false, entries: [], keys: new Set() },
  casual: { cursorKey: '', exhausted: false, loading: false, entries: [], keys: new Set() }
};
const dmStates = new Map();

function makeState() { return { cursorKey: '', exhausted: false, loading: false, entries: [], keys: new Set() }; }
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
function fmtText(value) {
  let s = esc(value);
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/\*(.+?)\*/g, '<i>$1</i>');
  return s.replace(/\n/g, '<br>');
}
function messageTime(record) {
  const value = Number(record?.time || record?.timestamp || 0);
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).format(date);
}
function visibleGlobal(record) {
  const channel = record?.dmChannelKey;
  if (!(channel == null || channel === '' || channel === 'global')) return false;
  if (record?.type !== 'whisper') return true;
  const uid = String(currentUser?.uid || '');
  return String(record?.uid || '') === uid || String(record?.whisperTo || '') === uid;
}
function resolveAvatar(record) {
  const direct = String(record?.speakAsAvatar || record?.avatar || '').trim();
  if (direct) return direct;
  const uid = String(record?.uid || '').trim();
  return uid ? String(participantProfiles.get(uid)?.avatar || '').trim() : '';
}
function createMessage(record, key) {
  const article = document.createElement('article');
  article.className = `history-message type-${String(record?.type || 'normal').replace(/[^a-z0-9_-]/gi, '')}`;
  article.dataset.key = key;
  const profile = participantProfiles.get(String(record?.uid || '')) || {};
  const name = record?.name || profile.name || '이름 없음';
  const type = record?.type || 'normal';
  let tag = '';
  if (type === 'whisper') {
    tag = String(record?.uid || '') === String(currentUser?.uid || '')
      ? `→ ${esc(record?.whisperToName || '?')}에게 귓말`
      : '→ 나에게 귓말';
  }
  const avatar = resolveAvatar(record);
  const avatarHtml = avatar
    ? `<img class="history-avatar" src="${esc(avatar)}" alt="">`
    : `<div class="history-avatar fallback">${esc(name.slice(0,1).toUpperCase() || '?')}</div>`;
  const isImage = type === 'image' || type === 'speak-as-image';
  const body = isImage
    ? `<img class="history-image" src="${esc(record?.text || '')}" alt="채팅 이미지" loading="lazy">`
    : `<div class="history-text">${fmtText(record?.text || '')}</div>`;
  article.innerHTML = `${avatarHtml}<div class="history-body"><div class="history-meta"><strong style="${record?.nameColor ? `color:${esc(record.nameColor)}` : ''}">${esc(name)}</strong>${tag ? `<span class="history-tag">${tag}</span>` : ''}<time>${esc(messageTime(record))}</time></div>${body}</div>`;
  return article;
}
function setError(message) { errorEl.hidden = !message; errorEl.textContent = message || ''; }
function normalizeParticipantIds(value) {
  const raw = Array.isArray(value) ? value : (value && typeof value === 'object' ? Object.values(value) : []);
  return Array.from(new Set(raw.map(uid => String(uid || '').trim()).filter(Boolean))).sort();
}
function currentState() {
  if (activeType !== 'dm') return baseStates[activeType];
  if (!activeDmChannel) return makeState();
  if (!dmStates.has(activeDmChannel)) dmStates.set(activeDmChannel, makeState());
  return dmStates.get(activeDmChannel);
}
function labelFor(type) {
  if (type === 'casual') return '잡담 기록';
  if (type === 'dm') {
    const room = dmChannels.find(item => item.channelKey === activeDmChannel);
    return room ? `DM 기록 · ${room.label}` : 'DM 기록';
  }
  return '일반 채팅 기록';
}
function updateUi() {
  const state = currentState();
  const dmWithoutRoom = activeType === 'dm' && !activeDmChannel;
  countEl.textContent = `${state.entries.length}개 표시`;
  emptyEl.hidden = dmWithoutRoom || state.entries.length > 0 || state.loading;
  loadingEl.hidden = !state.loading;
  statusEl.textContent = labelFor(activeType);
  tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.historyTab === activeType));
  dmPanelEl.hidden = activeType !== 'dm';
}
function renderActive() {
  listEl.innerHTML = '';
  if (activeType === 'dm' && !activeDmChannel) {
    const placeholder = document.createElement('div');
    placeholder.className = 'history-dm-placeholder';
    placeholder.innerHTML = dmChannels.length
      ? '<strong>DM 기록</strong><br><span>위에서 열람할 DM 방을 선택해 주세요.</span>'
      : '<strong>DM 기록</strong><br><span>접근 가능한 DM 방이 없습니다.</span>';
    listEl.appendChild(placeholder);
    updateUi();
    return;
  }
  const fragment = document.createDocumentFragment();
  currentState().entries.forEach(([key, record]) => fragment.appendChild(createMessage(record, key)));
  listEl.appendChild(fragment);
  updateUi();
}
async function verifyAccess(user) {
  if (!roomCode) throw new Error('방 코드가 없습니다.');
  const [playerSnap, metaSnap] = await Promise.all([
    get(ref(db, `rooms/${roomCode}/players/${user.uid}`)),
    get(ref(db, `rooms/${roomCode}/meta`))
  ]);
  const player = playerSnap.val() || null;
  const ownerId = String(metaSnap.val()?.ownerId || '');
  if (!playerSnap.exists() && ownerId !== user.uid) throw new Error('이 세션 방의 채팅 기록을 볼 권한이 없습니다.');
  const role = String(player?.role || '').trim().toLowerCase();
  accessInfo = { player, ownerId, isGm: ownerId === user.uid || role === 'gm' };
}
async function loadParticipantProfiles() {
  const [playersSnap, avatarsSnap] = await Promise.all([
    get(ref(db, `rooms/${roomCode}/players`)),
    get(ref(db, `rooms/${roomCode}/avatars`)).catch(() => null)
  ]);
  const players = playersSnap.val() || {};
  const avatars = avatarsSnap?.val?.() || {};
  Object.entries(players).forEach(([uid, player]) => {
    const p = player || {};
    const roomAvatar = avatars?.[uid];
    const avatar = String(p.avatarUrl || p.avatar || roomAvatar?.avatarUrl || roomAvatar?.avatar || roomAvatar || '').trim();
    participantProfiles.set(String(uid), { name: String(p.name || ''), avatar, role: String(p.role || '') });
  });
}
function dmChannelLabel(participantIds) {
  const myUid = String(currentUser?.uid || '');
  const names = participantIds
    .filter(uid => uid !== myUid)
    .map(uid => {
      const profile = participantProfiles.get(uid) || {};
      return String(profile.role || '').toLowerCase() === 'gm' ? 'GM' : (profile.name || '알 수 없는 사용자');
    });
  if (!names.length) return '개인 DM';
  return names.join(', ');
}
async function loadDmChannels() {
  const snap = await get(ref(db, `rooms/${roomCode}/dmChats`));
  const raw = snap.val() || {};
  const uid = String(currentUser?.uid || '');
  dmChannels = Object.entries(raw).map(([channelKey, node]) => {
    const meta = node?.meta || {};
    const participantIds = normalizeParticipantIds(meta.participantIds);
    return {
      channelKey: String(channelKey || '').trim(),
      participantIds,
      latestAt: Number(meta.latestAt || 0) || 0,
      label: dmChannelLabel(participantIds)
    };
  }).filter(item => item.channelKey && item.channelKey !== 'global' && (accessInfo.isGm || item.participantIds.includes(uid)))
    .sort((a, b) => b.latestAt - a.latestAt || a.label.localeCompare(b.label, 'ko'));

  if (requestedDmChannel) {
    if (dmChannels.some(item => item.channelKey === requestedDmChannel)) {
      activeDmChannel = requestedDmChannel;
    } else {
      activeDmChannel = '';
      unauthorizedRequestedDm = true;
    }
  } else if (activeDmChannel && !dmChannels.some(item => item.channelKey === activeDmChannel)) {
    activeDmChannel = '';
  } else if (!activeDmChannel && initialType === 'dm' && dmChannels.length === 1) {
    activeDmChannel = dmChannels[0].channelKey;
  }
  renderDmChannelButtons();
}
function renderDmChannelButtons() {
  dmListEl.innerHTML = '';
  dmSummaryEl.textContent = dmChannels.length ? `${dmChannels.length}개의 DM 방에 접근할 수 있습니다.` : '접근 가능한 DM 방이 없습니다.';
  if (!dmChannels.length) {
    const empty = document.createElement('div');
    empty.className = 'dm-channel-empty';
    empty.textContent = '표시할 DM 방이 없습니다.';
    dmListEl.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  dmChannels.forEach(room => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dm-channel-button';
    button.classList.toggle('active', room.channelKey === activeDmChannel);
    button.textContent = room.label;
    button.title = room.label;
    button.dataset.channelKey = room.channelKey;
    button.addEventListener('click', () => selectDmChannel(room.channelKey));
    fragment.appendChild(button);
  });
  dmListEl.appendChild(fragment);
}
async function fetchCasualPage(state) {
  const base = ref(db, `rooms/${roomCode}/casual`);
  const q = state.cursorKey ? query(base, orderByKey(), endBefore(state.cursorKey), limitToLast(PAGE_SIZE)) : query(base, orderByKey(), limitToLast(PAGE_SIZE));
  const snap = await get(q);
  const entries = Object.entries(snap.val() || {});
  if (entries.length) state.cursorKey = entries[0][0];
  state.exhausted = entries.length < PAGE_SIZE;
  return entries.map(([key, value]) => [key, value || {}]);
}
async function fetchDmPage(state, channelKey) {
  const safeChannelKey = String(channelKey || '').trim();
  if (!safeChannelKey || !dmChannels.some(item => item.channelKey === safeChannelKey)) {
    throw new Error('이 DM 방의 기록을 볼 권한이 없습니다.');
  }

  // 실제 DM 메시지는 일반 채팅과 동일한 rooms/{roomCode}/chat 경로에 저장되고,
  // dmChannelKey 값으로 각 DM 방을 구분한다. 기록 페이지에서도 같은 원본 경로를
  // 역방향으로 스캔해 현재 DM 방의 메시지만 최대 PAGE_SIZE개 수집한다.
  const base = ref(db, `rooms/${roomCode}/chat`);
  const collected = [];
  let scanCursor = state.cursorKey;
  let reachedEnd = false;

  for (let attempt = 0; attempt < 24 && collected.length < PAGE_SIZE && !reachedEnd; attempt += 1) {
    const q = scanCursor
      ? query(base, orderByKey(), endBefore(scanCursor), limitToLast(SCAN_SIZE))
      : query(base, orderByKey(), limitToLast(SCAN_SIZE));
    const snap = await get(q);
    const entries = Object.entries(snap.val() || {});

    if (!entries.length) {
      reachedEnd = true;
      break;
    }

    scanCursor = entries[0][0];

    for (let i = entries.length - 1; i >= 0 && collected.length < PAGE_SIZE; i -= 1) {
      const [key, value] = entries[i];
      const record = value || {};
      const channelKey = String(record.dmChannelKey || '').trim();
      if (channelKey !== safeChannelKey) continue;
      if (record.type === 'dm-bootstrap') continue;
      collected.push([key, record]);
    }

    if (entries.length < SCAN_SIZE) reachedEnd = true;
  }

  state.cursorKey = scanCursor || state.cursorKey;
  state.exhausted = reachedEnd;
  return collected.reverse();
}
async function fetchGlobalPage(state) {
  const base = ref(db, `rooms/${roomCode}/chat`);
  const collected = [];
  let scanCursor = state.cursorKey;
  let reachedEnd = false;
  for (let attempt = 0; attempt < 12 && collected.length < PAGE_SIZE && !reachedEnd; attempt += 1) {
    const q = scanCursor ? query(base, orderByKey(), endBefore(scanCursor), limitToLast(SCAN_SIZE)) : query(base, orderByKey(), limitToLast(SCAN_SIZE));
    const snap = await get(q);
    const entries = Object.entries(snap.val() || {});
    if (!entries.length) { reachedEnd = true; break; }
    scanCursor = entries[0][0];
    for (let i = entries.length - 1; i >= 0 && collected.length < PAGE_SIZE; i -= 1) {
      const [key, value] = entries[i];
      const record = value || {};
      if (visibleGlobal(record)) collected.push([key, record]);
    }
    if (entries.length < SCAN_SIZE) reachedEnd = true;
  }
  state.cursorKey = scanCursor || state.cursorKey;
  state.exhausted = reachedEnd;
  return collected.reverse();
}
async function loadAllRecords() {
  if (!accessReady) return;
  const requestType = activeType;
  const requestChannel = requestType === 'dm' ? activeDmChannel : '';
  if (requestType === 'dm' && !requestChannel) return;

  const state = requestType === 'dm'
    ? (dmStates.has(requestChannel) ? dmStates.get(requestChannel) : (dmStates.set(requestChannel, makeState()), dmStates.get(requestChannel)))
    : baseStates[requestType];
  if (!state || state.loading || state.exhausted) return;

  const requestRevision = viewRevision;
  state.loading = true;
  setError('');
  updateUi();

  try {
    let batchCount = 0;
    let previousCursor = state.cursorKey;

    while (!state.exhausted) {
      const entries = requestType === 'casual'
        ? await fetchCasualPage(state)
        : (requestType === 'dm'
          ? await fetchDmPage(state, requestChannel)
          : await fetchGlobalPage(state));

      const fresh = entries.filter(([key]) => !state.keys.has(key));
      fresh.forEach(([key]) => state.keys.add(key));
      if (fresh.length) state.entries = [...fresh, ...state.entries];

      batchCount += 1;
      const isCurrentView = requestRevision === viewRevision
        && requestType === activeType
        && (requestType !== 'dm' || requestChannel === activeDmChannel);

      if (isCurrentView) {
        countEl.textContent = `${state.entries.length}개 불러오는 중`;
        statusEl.textContent = `${labelFor(requestType)} · 전체 기록 불러오는 중`;
      }

      // 사용자가 다른 탭이나 DM 방으로 이동하면 현재 조회를 중단한다.
      // 지금까지 받은 데이터와 커서는 캐시에 남아 다시 돌아왔을 때 이어서 조회한다.
      if (!isCurrentView) break;

      // 필터 결과가 비어 있더라도 Firebase 스캔 커서가 앞으로 진행하면 계속 조회한다.
      // 커서가 진행하지 않는 예외 상황에서는 무한 반복을 막는다.
      if (!state.exhausted && state.cursorKey === previousCursor) {
        throw new Error('전체 기록 조회 커서가 진행되지 않아 불러오기를 중단했습니다.');
      }
      previousCursor = state.cursorKey;

      // 비정상적으로 큰 데이터나 손상된 커서로 인한 무한 요청 방지용 상한이다.
      if (batchCount >= 10000) {
        throw new Error('전체 기록의 양이 너무 많아 안전 상한에서 불러오기를 중단했습니다.');
      }
    }

    const isCurrentView = requestRevision === viewRevision
      && requestType === activeType
      && (requestType !== 'dm' || requestChannel === activeDmChannel);
    if (isCurrentView) renderActive();
  } catch (err) {
    console.error('[chat-history] load all failed', err);
    const isCurrentView = requestRevision === viewRevision
      && requestType === activeType
      && (requestType !== 'dm' || requestChannel === activeDmChannel);
    if (isCurrentView) {
      renderActive();
      setError(err?.message || '전체 기록을 불러오지 못했습니다.');
    }
  } finally {
    state.loading = false;
    const isCurrentView = requestRevision === viewRevision
      && requestType === activeType
      && (requestType !== 'dm' || requestChannel === activeDmChannel);
    if (isCurrentView) updateUi();
  }
}
async function selectDmChannel(channelKey) {
  const safeKey = String(channelKey || '').trim();
  if (!dmChannels.some(item => item.channelKey === safeKey)) return;
  activeDmChannel = safeKey;
  unauthorizedRequestedDm = false;
  viewRevision += 1;
  const nextParams = new URLSearchParams(location.search);
  nextParams.set('type', 'dm');
  nextParams.set('channel', safeKey);
  history.replaceState(null, '', `${location.pathname}?${nextParams.toString()}`);
  renderDmChannelButtons();
  renderActive();
  const state = currentState();
  if (!state.exhausted && !state.loading) void loadAllRecords();
}
async function switchType(nextType) {
  if (!['global', 'casual', 'dm'].includes(nextType) || switching || !accessReady) return;
  switching = true;
  try {
    activeType = nextType;
    viewRevision += 1;
    const nextParams = new URLSearchParams(location.search);
    nextParams.set('type', nextType);
    if (nextType === 'dm' && activeDmChannel) nextParams.set('channel', activeDmChannel);
    else nextParams.delete('channel');
    history.replaceState(null, '', `${location.pathname}?${nextParams.toString()}`);
    setError('');
    renderDmChannelButtons();
    renderActive();
    const state = currentState();
    if ((nextType !== 'dm' || activeDmChannel) && !state.exhausted && !state.loading) void loadAllRecords();
  } finally {
    switching = false;
  }
}

tabButtons.forEach(btn => btn.addEventListener('click', () => switchType(btn.dataset.historyTab)));
try {
  const channel = new BroadcastChannel('itc_theme_sync');
  channel.onmessage = (event) => {
    const theme = event?.data?.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  };
} catch (e) {}
function applyAvatarShape(value) {
  const shape = value === 'circle' ? 'circle' : 'rounded';
  document.documentElement.setAttribute('data-avatar-shape', shape);
}
applyAvatarShape(localStorage.getItem('itc_avatar_shape'));
window.addEventListener('storage', (event) => {
  if (event.key === 'itc_avatar_shape') applyAvatarShape(event.newValue);
});

titleEl.textContent = '전체 기록';
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    statusEl.textContent = '로그인 필요';
    setError('로그인 상태를 확인할 수 없습니다. 메인 사이트에 로그인한 뒤 다시 열어 주세요.');
    return;
  }
  currentUser = user;
  try {
    await verifyAccess(user);
    await loadParticipantProfiles();
    await loadDmChannels();
    accessReady = true;
    statusEl.textContent = '기록 불러오는 중';
    renderActive();
    if (unauthorizedRequestedDm && activeType === 'dm') {
      setError('요청한 DM 방의 기록을 볼 권한이 없거나 해당 DM 방이 존재하지 않습니다.');
    }
    if (activeType !== 'dm' || activeDmChannel) await loadAllRecords();
  } catch (err) {
    statusEl.textContent = '접근 불가';
    setError(err?.message || '기록 접근 권한을 확인하지 못했습니다.');
  }
});
