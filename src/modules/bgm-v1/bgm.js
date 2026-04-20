/**
 * ITC TRPG — BGM 모듈
 * YouTube API 기반 배경음악
 */

let ytPlayer = null, ytReady = false;

window.onYouTubeIframeAPIReady = () => {
  ytReady = true;
  ytPlayer = new YT.Player('yt-player', {
    height:'1', width:'1',
    playerVars: { autoplay:0, controls:0 },
    events: {
      onReady: () => { if (ytPlayer) ytPlayer.setVolume(60); },
      onStateChange: e => { if (e.data === YT.PlayerState.ENDED && hasPerm('manageBgm')) bgmNext(); },
    }
  });
};

function loadYTApi() {
  if (document.getElementById('yt-api-script')) return;
  const s = document.createElement('script');
  s.id = 'yt-api-script'; s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
}

function extractVideoId(url) {
  const patterns = [/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/, /^([A-Za-z0-9_-]{11})$/];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}

function addBgmTrack() {
  if (!hasPerm('manageBgm')) { showToast('BGM 관리 권한이 없어요.'); return; }
  const urlInp  = document.getElementById('yt-url-input').value.trim();
  const nameInp = document.getElementById('yt-name-input').value.trim();
  const vid = extractVideoId(urlInp);
  if (!vid) { alert('올바른 YouTube URL 또는 영상 ID를 입력해 주세요.'); return; }
  const track = { videoId: vid, name: nameInp || `트랙 ${St.playlist.length+1}` };
  St.playlist.push(track);
  if (window._FB?.CONFIGURED) { const { db, ref, set } = window._FB; set(ref(db, `rooms/${St.roomCode}/bgm/playlist`), St.playlist); }
  renderPlaylist();
  document.getElementById('yt-url-input').value = '';
  document.getElementById('yt-name-input').value = '';
  if (!ytReady) loadYTApi();
}

function renderPlaylist() {
  document.getElementById('playlist').innerHTML = St.playlist.map((t,i) => `
    <div class="pl-item ${i===St.currentTrack?'current':''}" onclick="playTrack(${i})">
      <span class="pl-name">♪ ${esc(t.name)}</span>
      <button class="pl-del" onclick="event.stopPropagation();removeTrack(${i})">✕</button>
    </div>`).join('');
}

function playTrack(idx, options = {}) {
  const fromRemote = options && options.fromRemote === true;
  if (!fromRemote && !hasPerm('manageBgm')) { showToast('BGM 관리 권한이 없어요.'); return; }
  if (idx < 0 || idx >= St.playlist.length) return;
  St.currentTrack = idx;
  const t = St.playlist[idx];
  document.getElementById('bgm-title').textContent = t.name;
  if (ytReady && ytPlayer) { ytPlayer.loadVideoById(t.videoId); ytPlayer.playVideo(); St.isPlaying = true; updatePlayBtn(); }
  renderPlaylist();
  if (!fromRemote && window._FB?.CONFIGURED) { const { db, ref, set } = window._FB; set(ref(db, `rooms/${St.roomCode}/bgm/currentTrack`), idx); }
}
function bgmToggle() {
  if (!hasPerm('manageBgm')) { showToast('BGM 관리 권한이 없어요.'); return; }
  if (!ytReady || !ytPlayer) { loadYTApi(); return; }
  if (St.isPlaying) { ytPlayer.pauseVideo(); St.isPlaying = false; }
  else {
    if (St.currentTrack === -1 && St.playlist.length) playTrack(0);
    else { ytPlayer.playVideo(); St.isPlaying = true; }
  }
  updatePlayBtn();
}

function updatePlayBtn() {
  const btn = document.getElementById('bgm-playbtn');
  btn.textContent = St.isPlaying ? '⏸' : '▶';
  btn.classList.toggle('playing', St.isPlaying);
}

function bgmNext() { if (!hasPerm('manageBgm')) { showToast('BGM 관리 권한이 없어요.'); return; } if (St.playlist.length) playTrack((St.currentTrack+1) % St.playlist.length); }
function bgmPrev() { if (!hasPerm('manageBgm')) { showToast('BGM 관리 권한이 없어요.'); return; } if (St.playlist.length) playTrack(St.currentTrack<=0 ? St.playlist.length-1 : St.currentTrack-1); }
function setVolume(v) { if (ytReady && ytPlayer) ytPlayer.setVolume(parseInt(v)); }
function removeTrack(i) {
  if (!hasPerm('manageBgm')) { showToast('BGM 관리 권한이 없어요.'); return; }
  St.playlist.splice(i,1);
  if (St.currentTrack >= i) St.currentTrack = Math.max(-1, St.currentTrack-1);
  renderPlaylist();
  if (window._FB?.CONFIGURED) { const { db, ref, set } = window._FB; set(ref(db, `rooms/${St.roomCode}/bgm/playlist`), St.playlist); }
}

