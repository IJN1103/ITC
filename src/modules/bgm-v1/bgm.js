/**
 * ITC TRPG — BGM 모듈
 * YouTube API 기반 배경음악
 */

let ytPlayer = null;
let ytReady = false;
let _bgmPendingTrackIndex = null;
let _bgmPendingShouldPlay = false;
let _bgmAddBusy = false;
let _bgmProgressTimer = null;
let _bgmProgressUserSeeking = false;
let _bgmProgressPreviewTimer = null;
let _lastAppliedBgmSeekAt = 0;
let _bgmExpanded = false;

const BGM_EMPTY_TITLE = '재생되고 있는 BGM이 없어요.';
const BGM_REPEAT_MODES = ['off', 'one', 'all'];
const BGM_REPEAT_TOAST = {
  off: '곡을 반복하지 않아요',
  one: '현재 곡만 반복해요',
  all: '플레이리스트 전체를 반복해요',
};
const BGM_REPEAT_TITLE = {
  off: '반복 없음',
  one: '현재 곡 반복',
  all: '플레이리스트 전체 반복',
};

window.onYouTubeIframeAPIReady = () => {
  ytReady = true;
  ytPlayer = new YT.Player('yt-player', {
    height: '1',
    width: '1',
    playerVars: { autoplay: 0, controls: 0, playsinline: 1 },
    events: {
      onReady: () => {
        applyStoredBgmVolume();
        flushPendingBgmTrack();
        startBgmProgressTimer();
        updateBgmProgressUI();
      },
      onStateChange: e => {
        if (e.data === YT.PlayerState.ENDED && canControlBgm()) handleBgmEnded();
      },
    },
  });
};

function canControlBgm() {
  // 1차 안정화 단계에서는 GM만 BGM 조작을 허용한다.
  // manageBgm 권한자는 BGM 기능 안정화 후 별도 단계에서 연결한다.
  return !!St.isGM;
}

function syncBgmPermissionUI() {
  const canControl = canControlBgm();
  document.querySelectorAll('.bgm-gm-control').forEach(el => {
    el.style.display = canControl ? '' : 'none';
  });
  document.querySelectorAll('.bgm-add').forEach(el => {
    el.style.display = canControl ? '' : 'none';
  });
  updateBgmProgressAccess();
}

function loadYTApi() {
  if (document.getElementById('yt-api-script')) return;
  const s = document.createElement('script');
  s.id = 'yt-api-script';
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
}

function extractVideoId(url) {
  const raw = String(url || '').trim();
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) return m[1];
  }
  return null;
}

async function fetchYouTubeTitle(videoId) {
  const fallback = `YouTube 영상 ${videoId}`;
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return fallback;
    const data = await res.json();
    const title = String(data?.title || '').trim();
    return title || fallback;
  } catch (err) {
    console.warn('youtube title fetch failed', err);
    return fallback;
  }
}

function getBgmPlaylist() {
  return Array.isArray(St.playlist) ? St.playlist : [];
}

function getCurrentBgmTrack() {
  const list = getBgmPlaylist();
  const idx = Number.isInteger(St.currentTrack) ? St.currentTrack : -1;
  return idx >= 0 && idx < list.length ? list[idx] : null;
}

function getBgmThumbnailUrl(track) {
  const videoId = track?.videoId ? String(track.videoId) : '';
  return videoId ? `https://img.youtube.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : '';
}

function getBgmRepeatMode() {
  return BGM_REPEAT_MODES.includes(St.repeatMode) ? St.repeatMode : 'off';
}

function getBgmDuration() {
  try {
    const duration = ytPlayer?.getDuration?.();
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch (_) {
    return 0;
  }
}

function getBgmCurrentTime() {
  try {
    const current = ytPlayer?.getCurrentTime?.();
    return Number.isFinite(current) && current >= 0 ? current : 0;
  } catch (_) {
    return 0;
  }
}

function updateBgmProgressAccess() {
  const slider = document.getElementById('bgm-progress-slider');
  if (!slider) return;
  const canSeek = canControlBgm() && !!getCurrentBgmTrack();
  slider.disabled = !canSeek;
  slider.title = canSeek ? '재생 위치 이동' : '재생 위치 보기';
}

function setBgmProgressValue(current, duration) {
  const slider = document.getElementById('bgm-progress-slider');
  if (!slider || _bgmProgressUserSeeking) return;
  const ratio = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;
  slider.value = String(Math.round(ratio * 1000));
}

function updateBgmProgressUI() {
  const track = getCurrentBgmTrack();
  if (!track || !ytReady || !ytPlayer) {
    setBgmProgressValue(0, 0);
    updateBgmProgressAccess();
    return;
  }
  setBgmProgressValue(getBgmCurrentTime(), getBgmDuration());
  updateBgmProgressAccess();
}

function startBgmProgressTimer() {
  if (_bgmProgressTimer) return;
  _bgmProgressTimer = setInterval(updateBgmProgressUI, 700);
}

function seekBgmPlayer(seconds, tries = 0) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  if (!ytReady || !ytPlayer) {
    loadYTApi();
    if (tries < 8) setTimeout(() => seekBgmPlayer(safeSeconds, tries + 1), 250);
    return;
  }
  try {
    ytPlayer.seekTo(safeSeconds, true);
    if (St.isPlaying) ytPlayer.playVideo();
    updateBgmProgressUI();
  } catch (err) {
    if (tries < 8) setTimeout(() => seekBgmPlayer(safeSeconds, tries + 1), 250);
    else console.warn('bgm seek failed', err);
  }
}

function applyRemoteBgmSeek(seek) {
  const updatedAt = Number(seek?.updatedAt || 0);
  const seconds = Number(seek?.seconds || 0);
  if (!updatedAt || updatedAt <= _lastAppliedBgmSeekAt) return;
  _lastAppliedBgmSeekAt = updatedAt;
  setTimeout(() => seekBgmPlayer(seconds), 180);
}

function previewBgmSeek(value) {
  if (!canControlBgm()) return;
  const slider = document.getElementById('bgm-progress-slider');
  if (!slider || slider.disabled) return;
  _bgmProgressUserSeeking = true;
  slider.value = String(Math.max(0, Math.min(1000, Number(value) || 0)));
  clearTimeout(_bgmProgressPreviewTimer);
  _bgmProgressPreviewTimer = setTimeout(() => {
    _bgmProgressUserSeeking = false;
    updateBgmProgressUI();
  }, 1800);
}

async function commitBgmSeek(value) {
  if (!canControlBgm()) { updateBgmProgressUI(); return; }
  const slider = document.getElementById('bgm-progress-slider');
  if (!slider || slider.disabled || !getCurrentBgmTrack()) { updateBgmProgressUI(); return; }
  const duration = getBgmDuration();
  if (!duration) { updateBgmProgressUI(); return; }
  const ratio = Math.max(0, Math.min(1000, Number(value) || 0)) / 1000;
  const seconds = Math.max(0, Math.min(duration, duration * ratio));
  const updatedAt = Date.now();
  clearTimeout(_bgmProgressPreviewTimer);
  _bgmProgressUserSeeking = false;
  _lastAppliedBgmSeekAt = updatedAt;
  seekBgmPlayer(seconds);
  await writeBgmState({ seek: { seconds: Math.round(seconds * 10) / 10, updatedAt, by: St.myId || '' } });
}

async function writeBgmState(payload) {
  if (!window._FB?.CONFIGURED || !St.roomCode) return;
  const { db, ref, update } = window._FB;
  await update(ref(db, `rooms/${St.roomCode}/bgm`), payload);
}

function setBgmTitle(track) {
  const titleEl = document.getElementById('bgm-title');
  if (titleEl) titleEl.textContent = track?.name || BGM_EMPTY_TITLE;
  renderBgmExpandedNowPlaying(track);
}

function renderBgmExpandedNowPlaying(track = getCurrentBgmTrack()) {
  const safeTrack = track || null;
  const titleEl = document.getElementById('bgm-expanded-current-title');
  const stateEl = document.getElementById('bgm-expanded-current-state');
  const thumbEl = document.getElementById('bgm-expanded-thumb');

  if (titleEl) titleEl.textContent = safeTrack?.name || BGM_EMPTY_TITLE;
  if (stateEl) stateEl.textContent = safeTrack ? (St.isPlaying ? '재생 중' : '일시정지') : '대기 중';

  if (!thumbEl) return;
  const thumbUrl = getBgmThumbnailUrl(safeTrack);
  if (thumbUrl) {
    thumbEl.classList.remove('empty');
    thumbEl.style.backgroundImage = `url("${thumbUrl}")`;
    thumbEl.innerHTML = '';
  } else {
    thumbEl.classList.add('empty');
    thumbEl.style.backgroundImage = '';
    thumbEl.innerHTML = '<span>NO BGM</span>';
  }
}

function renderBgmExpandedPlaylist() {
  const listEl = document.getElementById('bgm-expanded-playlist');
  const countEl = document.getElementById('bgm-expanded-count');
  if (!listEl && !countEl) return;

  const list = getBgmPlaylist();
  if (countEl) countEl.textContent = `${list.length}곡`;
  if (!listEl) return;

  if (!list.length) {
    listEl.innerHTML = `<div class="bgm-expanded-empty">${esc(BGM_EMPTY_TITLE)}</div>`;
    return;
  }

  listEl.innerHTML = list.map((track, i) => `
    <div class="bgm-expanded-track ${i === St.currentTrack ? 'current' : ''}">
      <div class="bgm-expanded-track-index">${i + 1}</div>
      <div class="bgm-expanded-track-title">${esc(track?.name || `BGM ${i + 1}`)}</div>
    </div>`).join('');
}

function syncBgmExpandedPanelState() {
  const panel = document.getElementById('bgm-expanded-panel');
  const bar = document.getElementById('bgm-bar');
  const btn = document.getElementById('bgm-expand-btn');

  if (panel) {
    panel.classList.toggle('open', _bgmExpanded);
    panel.setAttribute('aria-hidden', _bgmExpanded ? 'false' : 'true');
  }
  if (bar) bar.classList.toggle('expanded', _bgmExpanded);
  if (btn) {
    btn.textContent = _bgmExpanded ? '▼' : '▲';
    btn.setAttribute('aria-expanded', _bgmExpanded ? 'true' : 'false');
    btn.title = _bgmExpanded ? 'BGM 접기' : 'BGM 펼치기';
  }
}

function renderBgmExpandedUI() {
  renderBgmExpandedNowPlaying();
  renderBgmExpandedPlaylist();
  syncBgmExpandedPanelState();
}

function getLoadedYoutubeVideoId() {
  try {
    const data = ytPlayer?.getVideoData?.();
    return data?.video_id || '';
  } catch (_) {
    return '';
  }
}

function ensureYoutubeReadyForTrack(idx, shouldPlay) {
  _bgmPendingTrackIndex = idx;
  _bgmPendingShouldPlay = !!shouldPlay;
  loadYTApi();
}

function flushPendingBgmTrack() {
  if (_bgmPendingTrackIndex === null) return;
  const idx = _bgmPendingTrackIndex;
  const shouldPlay = _bgmPendingShouldPlay;
  _bgmPendingTrackIndex = null;
  _bgmPendingShouldPlay = false;
  playTrack(idx, { fromRemote: true, shouldPlay });
}

function applyBgmPlayerState(track, shouldPlay) {
  if (!track?.videoId) return;
  if (!ytReady || !ytPlayer) {
    ensureYoutubeReadyForTrack(St.currentTrack, shouldPlay);
    return;
  }
  const loadedId = getLoadedYoutubeVideoId();
  try {
    if (loadedId !== track.videoId) {
      if (shouldPlay) ytPlayer.loadVideoById(track.videoId);
      else ytPlayer.cueVideoById(track.videoId);
    } else if (shouldPlay) {
      ytPlayer.playVideo();
    } else {
      ytPlayer.pauseVideo();
    }
  } catch (err) {
    console.warn('bgm player state failed', err);
  }
}

function applyStoredBgmVolume() {
  const slider = document.getElementById('vol-slider');
  const stored = localStorage.getItem('itc_bgm_volume');
  const parsed = Number.parseInt(stored || slider?.value || '60', 10);
  const volume = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 60;
  if (slider) slider.value = String(volume);
  if (ytReady && ytPlayer) ytPlayer.setVolume(volume);
}

async function addBgmTrack() {
  if (!canControlBgm()) { showToast('BGM은 GM만 조작할 수 있어요.'); return; }
  if (_bgmAddBusy) return;

  const urlEl = document.getElementById('yt-url-input');
  const btn = document.getElementById('bgm-add-track-btn');
  const urlInp = urlEl?.value?.trim() || '';
  const vid = extractVideoId(urlInp);
  if (!vid) { alert('올바른 YouTube URL 또는 영상 ID를 입력해 주세요.'); return; }

  const current = getCurrentBgmTrack();
  if (current?.videoId === vid) {
    showToast('같은 곡이 이미 재생되고 있어요.');
    return;
  }

  _bgmAddBusy = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '제목 불러오는 중...';
  }

  try {
    const title = await fetchYouTubeTitle(vid);
    const nextPlaylist = getBgmPlaylist().slice();
    const track = { videoId: vid, name: title, addedAt: Date.now() };
    nextPlaylist.push(track);
    const nextIndex = nextPlaylist.length - 1;

    St.playlist = nextPlaylist;
    St.currentTrack = nextIndex;
    St.isPlaying = true;
    renderPlaylist();
    setBgmTitle(track);
    updatePlayBtn();

    await writeBgmState({
      playlist: nextPlaylist,
      currentTrack: nextIndex,
      isPlaying: true,
      seek: { seconds: 0, updatedAt: Date.now(), by: St.myId || '' },
    });
    playTrack(nextIndex, { fromRemote: true, shouldPlay: true });

    if (urlEl) urlEl.value = '';
    showToast('BGM을 추가하고 재생합니다.');
  } catch (err) {
    console.error('add bgm failed', err);
    showToast('BGM 추가에 실패했어요. 다시 시도해 주세요.');
  } finally {
    _bgmAddBusy = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = '+ BGM 추가';
    }
  }
}

function renderPlaylist() {
  const listEl = document.getElementById('playlist');
  const list = getBgmPlaylist();
  renderBgmExpandedPlaylist();
  renderBgmExpandedNowPlaying();

  if (!listEl) return;
  if (!list.length) {
    listEl.innerHTML = `<div class="pl-empty">${esc(BGM_EMPTY_TITLE)}</div>`;
    setBgmTitle(null);
    return;
  }
  listEl.innerHTML = list.map((t, i) => `
    <div class="pl-item ${i === St.currentTrack ? 'current' : ''}" onclick="playTrack(${i})">
      <span class="pl-name">${esc(t.name || `BGM ${i + 1}`)}</span>
      <button class="pl-del" onclick="event.stopPropagation();removeTrack(${i})" title="삭제">✕</button>
    </div>`).join('');
}

async function playTrack(idx, options = {}) {
  const fromRemote = options && options.fromRemote === true;
  const shouldPlay = options.shouldPlay !== false;
  const list = getBgmPlaylist();
  if (!fromRemote && !canControlBgm()) { showToast('BGM은 GM만 조작할 수 있어요.'); return; }
  if (idx < 0 || idx >= list.length) return;

  St.currentTrack = idx;
  St.isPlaying = !!shouldPlay;
  const track = list[idx];
  setBgmTitle(track);
  renderPlaylist();
  updatePlayBtn();
  applyBgmPlayerState(track, shouldPlay);

  updateBgmProgressAccess();
  updateBgmProgressUI();

  if (!fromRemote) {
    await writeBgmState({
      currentTrack: idx,
      isPlaying: !!shouldPlay,
      seek: { seconds: 0, updatedAt: Date.now(), by: St.myId || '' },
    });
  }
}

async function setBgmPlaying(playing, options = {}) {
  const fromRemote = options && options.fromRemote === true;
  if (!fromRemote && !canControlBgm()) { showToast('BGM은 GM만 조작할 수 있어요.'); return; }
  const track = getCurrentBgmTrack();
  if (!track) {
    St.isPlaying = false;
    setBgmTitle(null);
    updatePlayBtn();
    if (!fromRemote) await writeBgmState({ isPlaying: false });
    return;
  }

  St.isPlaying = !!playing;
  setBgmTitle(track);
  updatePlayBtn();
  updateBgmProgressAccess();
  applyBgmPlayerState(track, St.isPlaying);
  if (!fromRemote) await writeBgmState({ isPlaying: St.isPlaying });
}

async function bgmToggle() {
  if (!canControlBgm()) { showToast('BGM은 GM만 조작할 수 있어요.'); return; }
  const list = getBgmPlaylist();
  if (St.currentTrack === -1 && list.length) {
    await playTrack(0, { shouldPlay: true });
    return;
  }
  if (!getCurrentBgmTrack()) {
    showToast(BGM_EMPTY_TITLE);
    return;
  }
  await setBgmPlaying(!St.isPlaying);
}

function updatePlayBtn() {
  const btn = document.getElementById('bgm-playbtn');
  if (btn) {
    btn.textContent = St.isPlaying ? 'Ⅱ' : '▶';
    btn.classList.toggle('playing', !!St.isPlaying);
  }
  renderBgmExpandedNowPlaying();
}

function updateRepeatBtn() {
  const mode = getBgmRepeatMode();
  const btn = document.getElementById('bgm-repeat-btn');
  if (!btn) return;
  btn.dataset.mode = mode;
  btn.title = BGM_REPEAT_TITLE[mode] || BGM_REPEAT_TITLE.off;
  btn.textContent = mode === 'one' ? '1' : (mode === 'all' ? 'ALL' : '↻');
  btn.classList.toggle('active', mode !== 'off');
}

async function toggleBgmRepeat() {
  if (!canControlBgm()) { showToast('BGM은 GM만 조작할 수 있어요.'); return; }
  const current = getBgmRepeatMode();
  const next = BGM_REPEAT_MODES[(BGM_REPEAT_MODES.indexOf(current) + 1) % BGM_REPEAT_MODES.length];
  St.repeatMode = next;
  updateRepeatBtn();
  showToast(BGM_REPEAT_TOAST[next]);
  await writeBgmState({ repeatMode: next });
}

async function handleBgmEnded() {
  const list = getBgmPlaylist();
  if (!list.length || St.currentTrack < 0) {
    await setBgmPlaying(false);
    return;
  }

  const mode = getBgmRepeatMode();
  if (mode === 'one') {
    await playTrack(St.currentTrack, { shouldPlay: true });
    return;
  }

  const isLast = St.currentTrack >= list.length - 1;
  if (isLast && mode !== 'all') {
    await setBgmPlaying(false);
    return;
  }

  const nextIndex = isLast ? 0 : St.currentTrack + 1;
  await playTrack(nextIndex, { shouldPlay: true });
}

async function bgmNext() {
  if (!canControlBgm()) { showToast('BGM은 GM만 조작할 수 있어요.'); return; }
  const list = getBgmPlaylist();
  if (!list.length) { showToast(BGM_EMPTY_TITLE); return; }
  const nextIndex = St.currentTrack < 0 ? 0 : (St.currentTrack + 1) % list.length;
  await playTrack(nextIndex, { shouldPlay: true });
}

async function bgmPrev() {
  if (!canControlBgm()) { showToast('BGM은 GM만 조작할 수 있어요.'); return; }
  const list = getBgmPlaylist();
  if (!list.length) { showToast(BGM_EMPTY_TITLE); return; }
  const prevIndex = St.currentTrack <= 0 ? list.length - 1 : St.currentTrack - 1;
  await playTrack(prevIndex, { shouldPlay: true });
}

function setVolume(v) {
  const parsed = Number.parseInt(v, 10);
  const volume = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 60;
  localStorage.setItem('itc_bgm_volume', String(volume));
  if (ytReady && ytPlayer) ytPlayer.setVolume(volume);
}

async function removeTrack(i) {
  if (!canControlBgm()) { showToast('BGM은 GM만 조작할 수 있어요.'); return; }
  const list = getBgmPlaylist();
  if (i < 0 || i >= list.length) return;
  if (!confirm('이 BGM을 삭제할까요?')) return;

  const removingCurrent = i === St.currentTrack;
  const nextPlaylist = list.slice();
  nextPlaylist.splice(i, 1);

  let nextTrack = St.currentTrack;
  let nextPlaying = St.isPlaying;
  if (!nextPlaylist.length || removingCurrent) {
    nextTrack = -1;
    nextPlaying = false;
  } else if (St.currentTrack > i) {
    nextTrack = St.currentTrack - 1;
  }

  St.playlist = nextPlaylist;
  St.currentTrack = nextTrack;
  St.isPlaying = nextPlaying;
  renderPlaylist();
  updatePlayBtn();
  if (nextTrack === -1) {
    setBgmTitle(null);
    try { ytPlayer?.pauseVideo?.(); } catch (_) {}
  }

  updateBgmProgressAccess();
  updateBgmProgressUI();

  await writeBgmState({
    playlist: nextPlaylist,
    currentTrack: nextTrack,
    isPlaying: nextPlaying,
    seek: { seconds: 0, updatedAt: Date.now(), by: St.myId || '' },
  });
}

function syncBgmRemoteState(bgm = {}) {
  const nextPlaylist = Array.isArray(bgm.playlist) ? bgm.playlist : [];
  const nextTrack = Number.isInteger(bgm.currentTrack) ? bgm.currentTrack : -1;
  const hasRemotePlaying = Object.prototype.hasOwnProperty.call(bgm, 'isPlaying');
  const nextPlaying = hasRemotePlaying ? bgm.isPlaying === true : nextTrack >= 0;
  const nextRepeat = BGM_REPEAT_MODES.includes(bgm.repeatMode) ? bgm.repeatMode : 'off';
  const remoteSeek = bgm.seek && typeof bgm.seek === 'object' ? bgm.seek : null;

  St.playlist = nextPlaylist;
  St.repeatMode = nextRepeat;

  if (!nextPlaylist.length || nextTrack < 0 || nextTrack >= nextPlaylist.length) {
    St.currentTrack = -1;
    St.isPlaying = false;
    renderPlaylist();
    setBgmTitle(null);
    updatePlayBtn();
    updateRepeatBtn();
    updateBgmProgressAccess();
    updateBgmProgressUI();
    try { ytPlayer?.pauseVideo?.(); } catch (_) {}
    return;
  }

  const changedTrack = nextTrack !== St.currentTrack;
  St.currentTrack = nextTrack;
  renderPlaylist();
  setBgmTitle(nextPlaylist[nextTrack]);
  updateRepeatBtn();

  if (changedTrack) {
    playTrack(nextTrack, { fromRemote: true, shouldPlay: nextPlaying });
  } else {
    setBgmPlaying(nextPlaying, { fromRemote: true });
  }
  if (remoteSeek) applyRemoteBgmSeek(remoteSeek);
  updateBgmProgressAccess();
  updateBgmProgressUI();
}

function toggleBgmExpanded() {
  _bgmExpanded = !_bgmExpanded;
  renderBgmExpandedUI();
}

// 초기 UI 안전 반영
setTimeout(() => {
  applyStoredBgmVolume();
  updatePlayBtn();
  updateRepeatBtn();
  syncBgmPermissionUI();
  startBgmProgressTimer();
  updateBgmProgressUI();
  renderBgmExpandedUI();
  if (!getCurrentBgmTrack()) setBgmTitle(null);
}, 0);
