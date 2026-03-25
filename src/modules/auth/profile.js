/**
 * ITC TRPG — Profile 모듈
 * 프로필 수정, 아바타 크롭, 닉네임/비밀번호 변경
 */

function initProfileModal() {
  const user = window._currentUser;
  if (!user) return;

  document.getElementById('profile-email').textContent = user.email || '—';

  const nickInput = document.getElementById('profile-nickname');
  if (nickInput) nickInput.value = user.displayName || St.myName || '';

  refreshProfileAvatar();

  showProfileMsg('', '');

  ['profile-pw-current','profile-pw-new','profile-pw-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function refreshProfileAvatar() {
  const user = window._currentUser;
  if (!user) return;

  const saved = (() => {
    try {
      return localStorage.getItem('itc_avatar_' + user.uid)
        || (window._avatarCache && (window._avatarCache[user.uid] || window._avatarCache[St.myName]))
        || user.photoURL
        || '';
    } catch (e) {
      return (window._avatarCache && (window._avatarCache[user.uid] || window._avatarCache[St.myName])) || user.photoURL || '';
    }
  })();
  const initials = (user.displayName || St.myName || '?')[0].toUpperCase();

  const navEl = document.getElementById('user-avatar');
  if (navEl) {
    if (saved) {
      navEl.innerHTML = `<img src="${saved}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
    } else {
      navEl.textContent = initials;
    }
  }

  const bigEl = document.getElementById('profile-avatar-big');
  if (bigEl) {
    if (saved) {
      bigEl.innerHTML = `<img src="${saved}" alt="avatar"><div class="av-overlay">📷</div>`;
    } else {
      bigEl.innerHTML = `<span>${initials}</span><div class="av-overlay">📷</div>`;
    }
  }
}




function withTimeout(promise, ms = 3500) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('timeout'));
    }, ms);
    Promise.resolve(promise).then((value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    }).catch((err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function getCloudinaryRuntimeConfig() {
  const cfg = window._ITC_CLOUDINARY || {};
  const cloudName = String(cfg.cloudName || '').trim();
  const unsignedPreset = String(cfg.unsignedPreset || '').trim();
  if (!cloudName || !unsignedPreset) return null;
  return { cloudName, unsignedPreset };
}

async function getStorageApiQuick() {
  const fb = window._FB;
  if (!fb?.CONFIGURED || typeof fb.ensureStorage !== 'function') return null;
  try {
    return await withTimeout(fb.ensureStorage(), 2200);
  } catch (err) {
    console.warn('storage api unavailable', err);
    return null;
  }
}

function inferStorageContentTypeFromDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;,]+)[;,]/i);
  return m ? m[1].toLowerCase() : 'image/jpeg';
}

function blobFromDataUrl(dataUrl) {
  const parts = String(dataUrl || '').split(',');
  if (parts.length < 2) throw new Error('이미지 데이터 형식이 올바르지 않아요.');
  const contentType = inferStorageContentTypeFromDataUrl(dataUrl);
  const binary = atob(parts[1]);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

async function uploadAvatarBlobToCloudinary(blob, fileName = 'avatar.jpg') {
  const cfg = getCloudinaryRuntimeConfig();
  if (!cfg || !blob) return null;
  const formData = new FormData();
  formData.append('file', blob, fileName);
  formData.append('upload_preset', cfg.unsignedPreset);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/image/upload`, {
      method: 'POST',
      body: formData,
      signal: controller?.signal,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.secure_url) {
      throw new Error(payload?.error?.message || 'cloudinary upload failed');
    }
    return {
      url: payload.secure_url,
      path: payload.public_id || '',
      contentType: blob.type || 'image/jpeg',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function uploadAvatarDataUrlToStorage(dataUrl, userId) {
  const avatarBlob = blobFromDataUrl(dataUrl);
  const uploadedCloudinary = await uploadAvatarBlobToCloudinary(avatarBlob, `avatar_${userId || 'user'}_${Date.now()}.jpg`);
  if (!uploadedCloudinary?.url) return null;
  return uploadedCloudinary;
}

function handleAvatarUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showProfileMsg('이미지는 5MB 이하여야 해요.', 'err');
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    window._crop = { img, scale: 1, ox: 0, oy: 0, drag: false, lx: 0, ly: 0, objectUrl };
    document.getElementById('crop-scale').value = 100;
    document.getElementById('crop-scale-val').textContent = '100%';
    document.getElementById('crop-zone').style.display = 'block';
    setTimeout(() => { setupCropCanvas(); drawCrop(); setupCropDrag(); }, 50);
  };
  img.onerror = () => {
    try { URL.revokeObjectURL(objectUrl); } catch (e) {}
    showProfileMsg('이미지를 불러오지 못했어요. 다시 시도해 주세요.', 'err');
  };
  img.src = objectUrl;
  input.value = '';
}

function setupCropCanvas() {
  const canvas = document.getElementById('crop-canvas');
  if (!canvas) return;
  canvas.width  = 220;
  canvas.height = 220;
}

function drawCrop() {
  const s = window._crop;
  if (!s) return;
  const canvas = document.getElementById('crop-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 220, 220);
  const sw = s.img.width  * s.scale;
  const sh = s.img.height * s.scale;
  const x  = (220 - sw) / 2 + s.ox;
  const y  = (220 - sh) / 2 + s.oy;
  ctx.drawImage(s.img, x, y, sw, sh);
}

function onCropScale(val) {
  if (!window._crop) return;
  window._crop.scale = parseInt(val) / 100;
  document.getElementById('crop-scale-val').textContent = val + '%';
  drawCrop();
}

function setupCropDrag() {
  const vp = document.getElementById('crop-viewport');
  if (!vp || vp._cropBound) return;
  vp._cropBound = true;

  vp.addEventListener('mousedown', e => {
    const s = window._crop; if (!s) return;
    e.preventDefault();
    s.drag = true; s.lx = e.clientX; s.ly = e.clientY;
    vp.style.cursor = 'grabbing';
  });
  vp.addEventListener('touchstart', e => {
    const s = window._crop; if (!s) return;
    e.preventDefault();
    s.drag = true; s.lx = e.touches[0].clientX; s.ly = e.touches[0].clientY;
  }, { passive: false });

  document.addEventListener('mousemove', e => {
    const s = window._crop; if (!s || !s.drag) return;
    s.ox += e.clientX - s.lx; s.oy += e.clientY - s.ly;
    s.lx = e.clientX; s.ly = e.clientY;
    drawCrop();
  });
  document.addEventListener('touchmove', e => {
    const s = window._crop; if (!s || !s.drag) return;
    e.preventDefault();
    s.ox += e.touches[0].clientX - s.lx; s.oy += e.touches[0].clientY - s.ly;
    s.lx = e.touches[0].clientX; s.ly = e.touches[0].clientY;
    drawCrop();
  }, { passive: false });

  document.addEventListener('mouseup',  () => { if (window._crop) { window._crop.drag = false; vp.style.cursor = 'grab'; } });
  document.addEventListener('touchend', () => { if (window._crop) window._crop.drag = false; });
}

async function syncAvatarToFirebase(avatarSrc, meta = null) {
  const user = window._currentUser;
  if (!user || !window._FB?.CONFIGURED) return;

  const { db, ref, update } = window._FB;
  const now = Date.now();
  const avatarValue = avatarSrc || '';
  const avatarStoragePath = meta?.path || '';
  try {
    await update(ref(db, `users/${user.uid}/profile`), {
      avatar: avatarValue,
      avatarUrl: avatarValue,
      avatarStoragePath,
      updatedAt: now,
    });
  } catch (e) {}

  if (St.roomCode) {
    try {
      await update(ref(db, `rooms/${St.roomCode}/players/${user.uid}`), {
        avatar: avatarValue,
        avatarUrl: avatarValue,
        avatarStoragePath,
        name: St.myName || user.displayName || '플레이어',
        updatedAt: now,
      });
    } catch (e) {}

    try {
      await update(ref(db, `rooms/${St.roomCode}/avatars/${user.uid}`), {
        value: avatarValue,
        url: avatarValue,
        storagePath: avatarStoragePath,
        updatedAt: now,
      });
    } catch (e) {}
  }

  window._avatarCache = window._avatarCache || {};
  if (avatarValue) {
    window._avatarCache[user.uid] = avatarValue;
    window._avatarCache[St.myName || user.displayName || '플레이어'] = avatarValue;
  }

  document.dispatchEvent(new CustomEvent('itc:avatar-updated', {
    detail: {
      uid: user.uid,
      name: St.myName || user.displayName || '플레이어',
      avatar: avatarValue,
      avatarStoragePath,
    }
  }));
}

async function applyCrop() {
  const s = window._crop;
  if (!s) return;

  const out = document.createElement('canvas');
  out.width = out.height = 256;
  const ctx = out.getContext('2d');
  const r = 256 / 220;
  const sw = s.img.width  * s.scale * r;
  const sh = s.img.height * s.scale * r;
  const x  = (256 - sw) / 2 + s.ox * r;
  const y  = (256 - sh) / 2 + s.oy * r;
  ctx.drawImage(s.img, x, y, sw, sh);

  let finalAvatarSrc = '';
  let uploadMeta = null;

  try {
    const avatarBlob = await new Promise((resolve, reject) => {
      out.toBlob((blob) => {
        if (!blob) {
          reject(new Error('avatar blob failed'));
          return;
        }
        resolve(blob);
      }, 'image/jpeg', 0.8);
    });
    const uploaded = await uploadAvatarBlobToCloudinary(avatarBlob, `avatar_${window._currentUser.uid || 'user'}_${Date.now()}.jpg`);
    if (uploaded?.url) {
      finalAvatarSrc = uploaded.url;
      uploadMeta = uploaded;
    }
  } catch (e) {
    console.warn('avatar upload failed', e);
  }

  if (!finalAvatarSrc) {
    showProfileMsg('프로필 사진 업로드에 실패했어요. 다시 시도해 주세요.', 'err');
    return;
  }

  localStorage.setItem('itc_avatar_' + window._currentUser.uid, finalAvatarSrc);
  try {
    if (uploadMeta?.path) localStorage.setItem('itc_avatar_path_' + window._currentUser.uid, uploadMeta.path);
    else localStorage.removeItem('itc_avatar_path_' + window._currentUser.uid);
  } catch (e) {}
  await syncAvatarToFirebase(finalAvatarSrc, uploadMeta);
  refreshProfileAvatar();
  document.getElementById('crop-zone').style.display = 'none';
  if (s.objectUrl) {
    try { URL.revokeObjectURL(s.objectUrl); } catch (e) {}
  }
  window._crop = null;
  showProfileMsg('프로필 사진이 업데이트됐어요!', 'ok');
}

async function saveNickname() {
  const user = window._currentUser;
  if (!user) return;
  const nick = document.getElementById('profile-nickname').value.trim();
  if (!nick)       { showProfileMsg('닉네임을 입력해 주세요.', 'err'); return; }
  if (nick.length > 12) { showProfileMsg('닉네임은 12자 이하로 입력해 주세요.', 'err'); return; }
  try {
    const { updateProfile } = window._FB;
    await updateProfile(user, { displayName: nick });
    St.myName = nick;
    document.getElementById('user-name-nav').textContent = nick;
    if (window._FB?.CONFIGURED) {
      const { db, ref, update } = window._FB;
      await update(ref(db, `users/${user.uid}/profile`), { name: nick, updatedAt: Date.now() });
      if (St.roomCode) {
        await update(ref(db, `rooms/${St.roomCode}/players/${user.uid}`), { name: nick, updatedAt: Date.now() });
      }
    }
    showProfileMsg('닉네임이 저장됐어요!', 'ok');
  } catch(e) {
    showProfileMsg('저장 중 오류가 발생했어요.', 'err');
  }
}

async function savePassword() {
  const user = window._currentUser;
  if (!user) return;
  const current = document.getElementById('profile-pw-current').value;
  const next    = document.getElementById('profile-pw-new').value;
  const confirm = document.getElementById('profile-pw-confirm').value;
  if (!current) { showProfileMsg('현재 비밀번호를 입력해 주세요.', 'err'); return; }
  if (!next)    { showProfileMsg('새 비밀번호를 입력해 주세요.', 'err'); return; }
  if (next.length < 6) { showProfileMsg('새 비밀번호는 6자 이상이어야 해요.', 'err'); return; }
  if (next !== confirm) { showProfileMsg('새 비밀번호가 일치하지 않아요.', 'err'); return; }
  try {
    const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const cred = EmailAuthProvider.credential(user.email, current);
    await reauthenticateWithCredential(user, cred);
    await updatePassword(user, next);
    ['profile-pw-current','profile-pw-new','profile-pw-confirm'].forEach(id => {
      document.getElementById(id).value = '';
    });
    showProfileMsg('비밀번호가 변경됐어요!', 'ok');
  } catch(e) {
    const msgs = {
      'auth/wrong-password':    '현재 비밀번호가 올바르지 않아요.',
      'auth/invalid-credential':'현재 비밀번호가 올바르지 않아요.',
      'auth/too-many-requests': '잠시 후 다시 시도해 주세요.',
    };
    showProfileMsg(msgs[e.code] || '변경 중 오류가 발생했어요.', 'err');
  }
}

function showProfileMsg(text, type) {
  const el = document.getElementById('profile-msg');
  if (!el) return;
  el.textContent = text;
  el.className = 'profile-msg' + (type ? ' ' + type : '');
}

let _activeRightTab = 'chat';
let _casualNickname = '';
