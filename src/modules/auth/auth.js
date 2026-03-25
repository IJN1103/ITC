/**
 * ITC TRPG — Auth 모듈
 * 로그인, 회원가입, Google 로그인, 로그아웃
 */

function sanitizePersistentAvatarSrc(src) {
  const value = String(src || '').trim();
  if (!value) return '';
  if (/^data:image\//i.test(value) || /^blob:/i.test(value)) return '';
  return value;
}

function initAuthScreen() {
  const fb = window._FB;

  if (!fb?.CONFIGURED) {
    document.getElementById('screen-auth').style.display = 'flex';
    document.getElementById('auth-form-main').style.display = 'none';
    document.getElementById('local-banner').style.display = 'block';
    return;
  }

  window._onAuthReady = async user => {
    St.myName = user.displayName || user.email?.split('@')[0] || '플레이어';
    St.myId   = user.uid;
    await loadUserProfile(user);
    if (typeof refreshProfileAvatar === 'function') {
      try { refreshProfileAvatar(); } catch (e) {}
    }
    loadRecentRooms();

    const savedCode = sessionStorage.getItem('itc_session_code');
    const savedSys  = sessionStorage.getItem('itc_session_sys');
    const savedRole = sessionStorage.getItem('itc_session_role');
    if (savedCode && window._FB?.CONFIGURED) {
      const { db, ref, get } = window._FB;
      try {
        const snap = await get(ref(db, `rooms/${savedCode}/meta`));
        if (snap.exists()) {
          St.roomCode = savedCode;
          St.system   = savedSys || snap.val().system || 'coc7';
          St.isGM     = savedRole === 'gm' || snap.val().ownerId === St.myId;
          setupFirebaseListeners();
          enterGame();
          return;
        }
      } catch(e) {}
      sessionStorage.removeItem('itc_session_code');
      sessionStorage.removeItem('itc_session_sys');
      sessionStorage.removeItem('itc_session_role');
    }

    showLobby();
  };
  if (window._currentUser) window._onAuthReady(window._currentUser);
}

/* 유저 프로필 로드 / 최초 생성 */
async function loadUserProfile(user) {
  if (!window._FB?.CONFIGURED) return;
  const { db, ref, get, set, update } = window._FB;
  const profileRef = ref(db, `users/${user.uid}/profile`);
  const snap = await get(profileRef);

  const baseProfile = {
    name: user.displayName || user.email?.split('@')[0] || '플레이어',
    email: user.email || '',
  };

  if (!snap.exists()) {
    await set(profileRef, {
      ...baseProfile,
      avatar: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (typeof refreshProfileAvatar === 'function') {
      try { refreshProfileAvatar(); } catch (e) {}
    }
    return;
  }

  const profile = snap.val() || {};
  St.myName = profile.name || baseProfile.name;

  const rawAvatarSrc = profile.avatarUrl || profile.avatar || '';
  const avatarSrc = sanitizePersistentAvatarSrc(rawAvatarSrc);

  if (avatarSrc) {
    try { localStorage.setItem('itc_avatar_' + user.uid, avatarSrc); } catch (e) {}
    try {
      if (profile.avatarStoragePath) localStorage.setItem('itc_avatar_path_' + user.uid, profile.avatarStoragePath);
      else localStorage.removeItem('itc_avatar_path_' + user.uid);
    } catch (e) {}
    window._avatarCache = window._avatarCache || {};
    window._avatarCache[user.uid] = avatarSrc;
    window._avatarCache[St.myName] = avatarSrc;
  } else {
    try { localStorage.removeItem('itc_avatar_' + user.uid); } catch (e) {}
    try { localStorage.removeItem('itc_avatar_path_' + user.uid); } catch (e) {}
    window._avatarCache = window._avatarCache || {};
    delete window._avatarCache[user.uid];
  }

  const patch = {};
  if (rawAvatarSrc && !avatarSrc) {
    patch.avatar = '';
    patch.avatarUrl = '';
    patch.avatarStoragePath = '';
  }
  if (!profile.name && baseProfile.name) patch.name = baseProfile.name;
  if (!profile.email && baseProfile.email) patch.email = baseProfile.email;
  if (Object.keys(patch).length) {
    patch.updatedAt = Date.now();
    await update(profileRef, patch);
  }

  if (typeof refreshProfileAvatar === 'function') {
    try { refreshProfileAvatar(); } catch (e) {}
  }
}


function switchAuthTab(tab, btn) {
  document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('form-signin').classList.toggle('hidden', tab !== 'signin');
  document.getElementById('form-signup').classList.toggle('hidden', tab !== 'signup');
}

function setLoading(prefix, on) {
  document.getElementById(prefix + '-spin').style.display = on ? 'inline-block' : 'none';
  document.getElementById(prefix + '-label').textContent  = on ? '처리 중...' : (prefix === 'si' ? '로그인' : '계정 만들기');
  document.getElementById(prefix + '-btn').disabled = on;
}

function showErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4000);
}

const FB_ERR = {
  'auth/user-not-found':       '등록된 이메일이 없습니다.',
  'auth/wrong-password':       '비밀번호가 올바르지 않습니다.',
  'auth/invalid-credential':   '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/email-already-in-use': '이미 사용 중인 이메일입니다.',
  'auth/weak-password':        '비밀번호는 6자 이상이어야 합니다.',
  'auth/invalid-email':        '이메일 형식이 올바르지 않습니다.',
  'auth/popup-closed-by-user': '팝업이 닫혔습니다. 다시 시도해 주세요.',
};
function fbErr(code) { return FB_ERR[code] || '오류가 발생했습니다. 다시 시도해 주세요.'; }

async function doSignIn() {
  const email = document.getElementById('si-email').value.trim();
  const pw    = document.getElementById('si-pw').value;
  if (!email || !pw) { showErr('signin-err', '이메일과 비밀번호를 입력해 주세요.'); return; }
  setLoading('si', true);
  try {
    const { auth, signInWithEmailAndPassword } = window._FB;
    const cred = await signInWithEmailAndPassword(auth, email, pw);
    await loadUserProfile(cred.user);
  } catch(e) {
    setLoading('si', false);
    showErr('signin-err', fbErr(e.code));
  }
}

async function doSignUp() {
  const name  = document.getElementById('su-name').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const pw    = document.getElementById('su-pw').value;

  if (!name)  { showErr('signup-err', '닉네임을 입력해 주세요.'); return; }
  if (!email) { showErr('signup-err', '이메일을 입력해 주세요.'); return; }
  if (!pw)    { showErr('signup-err', '비밀번호를 입력해 주세요.'); return; }

  // 🔥 [추가된 부분] 파이어베이스는 비밀번호가 6자리 미만이면 에러를 냅니다. 미리 안내하기!
  if (pw.length < 6) {
    showErr('signup-err', '비밀번호는 6자 이상으로 설정해 주세요.');
    return;
  }

  setLoading('su', true);
  try {
    const { auth, createUserWithEmailAndPassword, updateProfile } = window._FB;
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await updateProfile(cred.user, { displayName: name });
    St.myName = name; 
    St.myId = cred.user.uid;

    // 🔥 [추가된 부분] 가입 성공 시 로딩을 끄고, 비밀번호 칸을 비운 뒤 로비 화면으로 보내주기
    setLoading('su', false);
    document.getElementById('su-pw').value = '';
    if (typeof showLobby === 'function') showLobby();

  } catch(e) {
    setLoading('su', false);
    // 🔥 [추가된 부분] 원인 모를 에러가 날 때 무조건 뭉뚱그려 말하지 않고, 진짜 원인(e.code)을 출력하게 만들기
    let errorReason = fbErr(e.code);
    if (errorReason === '오류가 발생했습니다. 다시 시도해 주세요.' || !errorReason) {
      errorReason = `가입 실패 (${e.code}). 파이어베이스 설정을 확인해 주세요.`;
    }
    showErr('signup-err', errorReason);
  }
}

async function doGoogleSignIn() {
  try {
    const { auth, GoogleAuthProvider, signInWithPopup } = window._FB;
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch(e) {
    showErr('signin-err', fbErr(e.code));
    showErr('signup-err', fbErr(e.code));
  }
}

async function doSignOut() {
  const { auth, signOut } = window._FB;
  await signOut(auth);
  location.reload();
}

/* localLogin removed — Firebase required */

function showSetupGuide() { openModal('modal-setup-guide'); }
