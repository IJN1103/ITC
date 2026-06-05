/* ==========================================================================
 * CHAT SECTION: IMAGE DISPLAY HELPERS
 * 채팅 이미지 class/style, 비율, placeholder 계산
 * ========================================================================== */

function getChatImageClassName(imageWide = false) {
  return imageWide ? 'msg-image is-wide' : 'msg-image';
}

function getChatImageInlineStyle(imageWide = false) {
  return imageWide ? 'width:100%;max-width:none;height:auto;object-fit:contain;' : '';
}


/* ==========================================================================
 * CHAT SECTION: DEFERRED IMAGE LOADING
 * IntersectionObserver 기반 lazy image 로딩과 깜빡임 방어
 * ========================================================================== */

const CHAT_IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
let _deferredChatImageObserver = null;

function normalizeChatImageMeta(imageMeta = null) {
  if (!imageMeta || typeof imageMeta !== 'object') return null;
  const width = Number(imageMeta.width || imageMeta.w || 0);
  const height = Number(imageMeta.height || imageMeta.h || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

function getChatImageShellStyle(imageWide = false, imageMeta = null) {
  const meta = normalizeChatImageMeta(imageMeta);
  const ratio = meta ? `${meta.width} / ${meta.height}` : (imageWide ? '16 / 9' : '4 / 3');
  return `aspect-ratio:${ratio};`;
}

function activateDeferredChatImage(img, force = false) {
  if (!(img instanceof HTMLImageElement)) return;
  if (img.dataset.chatLoaded === '1' && !force) return;
  const actualSrc = img.dataset.chatSrc || img.currentSrc || img.src || '';
  if (!actualSrc) return;
  const shell = img.closest('.msg-image-shell');
  const finalize = () => {
    if (shell) shell.classList.remove('is-loading');
    img.classList.add('is-ready');
  };
  if (shell) shell.classList.add('is-loading');
  img.dataset.chatLoaded = '1';
  img.addEventListener('load', finalize, { once: true });
  img.addEventListener('error', finalize, { once: true });
  img.src = actualSrc;
  if (img.complete) requestAnimationFrame(finalize);
}

function ensureDeferredChatImageObserver() {
  if (_deferredChatImageObserver || typeof IntersectionObserver === 'undefined') return _deferredChatImageObserver;
  _deferredChatImageObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      if (!(img instanceof HTMLImageElement)) return;
      activateDeferredChatImage(img);
      try { _deferredChatImageObserver.unobserve(img); } catch (e) {}
    });
  }, {
    root: null,
    rootMargin: '700px 0px',
    threshold: 0.01,
  });
  return _deferredChatImageObserver;
}

function primeDeferredChatImages(root = document) {
  const nodes = root instanceof HTMLElement
    ? root.querySelectorAll('img[data-chat-src]')
    : document.querySelectorAll('img[data-chat-src]');
  if (!nodes.length) return;
  const observer = ensureDeferredChatImageObserver();
  nodes.forEach((img) => {
    if (!(img instanceof HTMLImageElement)) return;
    if (!img.dataset.chatSrc) return;
    if (!observer) {
      activateDeferredChatImage(img, true);
      return;
    }
    observer.observe(img);
  });
}

function buildChatImageHtml(src, imageWide = false, imageMeta = null) {
  const meta = normalizeChatImageMeta(imageMeta);
  const extraSizeAttrs = meta ? ` width="${meta.width}" height="${meta.height}"` : '';
  const shellClass = imageWide ? 'msg-image-shell is-wide' : 'msg-image-shell';
  return `<div class="${shellClass}" style="${getChatImageShellStyle(imageWide, meta)}"><img class="${getChatImageClassName(imageWide)}" src="${CHAT_IMAGE_PLACEHOLDER}" data-chat-src="${esc(src)}" data-chat-loaded="0" alt="첨부 이미지" loading="lazy" decoding="async" fetchpriority="low"${extraSizeAttrs} style="${getChatImageInlineStyle(imageWide)}" onclick="openLightbox(this.dataset.chatSrc || this.currentSrc || this.src)"></div>`;
}
