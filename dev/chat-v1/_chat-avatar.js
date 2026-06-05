/* ==========================================================================
 * CHAT SECTION: AVATAR RESOLUTION AND CACHE
 * 프로필 이미지 fallback, 런타임 캐시, 기존 메시지 아바타 재렌더
 * ========================================================================== */

function resolveUserAvatarDisplaySrc(name, uid, size = 64) {
  let imgSrc = null;
  const avatarRuntime = window._itcAvatarRuntime || null;

  if (uid) {
    try { imgSrc = localStorage.getItem('itc_avatar_' + uid); } catch (e) { imgSrc = null; }
  }
  if (!imgSrc && name) {
    imgSrc = window._avatarCache?.[uid] || window._avatarCache?.[name];
  }
  if (avatarRuntime?.sanitizePersistentAvatarSrc) {
    imgSrc = avatarRuntime.sanitizePersistentAvatarSrc(imgSrc);
  }
  if (imgSrc && avatarRuntime?.getDisplayAvatarSrc) {
    imgSrc = avatarRuntime.getDisplayAvatarSrc(imgSrc, size);
  }
  return String(imgSrc || '').trim();
}

function getAvatarHtml(name, uid) {
  const avatarRuntime = window._itcAvatarRuntime || null;
  const imgSrc = resolveUserAvatarDisplaySrc(name, uid, 64);
  const initial = (name || '?')[0].toUpperCase();
  const shape_class = St.avatarShape === 'circle' ? 'shape-circle' : 'shape-rounded';
  const r = St.avatarShape === 'circle' ? '50%' : '6px';
  const dataSrcAttr = imgSrc ? ` data-avatar-src="${esc(imgSrc)}"` : ' data-avatar-src=""';
  const fallbackHtml = `<div class="msg-avatar-inner" style="border-radius:${r}">${esc(initial)}</div>`;
  if (imgSrc) {
    const safeSrc = esc(imgSrc);
    const isLoaded = !!(avatarRuntime?.isDisplayAvatarLoaded && avatarRuntime.isDisplayAvatarLoaded(imgSrc));
    const loadedClass = isLoaded ? ' is-loaded' : '';
    const onload = `this.classList.add('is-loaded');try{window._itcAvatarRuntime&&window._itcAvatarRuntime.markDisplayAvatarLoaded&&window._itcAvatarRuntime.markDisplayAvatarLoaded(this.currentSrc||this.src)}catch(e){}`;
    return `<div class="msg-avatar ${shape_class}" data-avatar-holder="1"${dataSrcAttr}>${fallbackHtml}<img class="msg-avatar-img${loadedClass}" src="${safeSrc}" alt="" decoding="async" loading="eager" style="border-radius:${r}" onload="${onload}" onerror="this.remove()"></div>`;
  }
  return `<div class="msg-avatar ${shape_class}" data-avatar-holder="1"${dataSrcAttr}>${fallbackHtml}</div>`;
}

function rerenderExistingChatAvatars() {
  document.querySelectorAll('.chat-msg').forEach(div => {
    const uid = div.dataset.avatarUid || div.dataset.uid || '';
    const name = div.dataset.avatarName || div.dataset.name || '';
    const holder = div.querySelector('[data-avatar-holder="1"]');
    if (!holder) return;
    const nextSrc = resolveUserAvatarDisplaySrc(name, uid || null, 64);
    const prevSrc = String(holder.dataset.avatarSrc || '').trim();
    if (prevSrc === nextSrc) return;
    holder.outerHTML = getAvatarHtml(name, uid || null);
  });

  refreshCasualNickDisplay();
}



