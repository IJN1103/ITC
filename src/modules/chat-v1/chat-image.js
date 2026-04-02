/**
 * ITC TRPG — Chat Image
 * 이미지 업로드, 미리보기, 전송, Cloudinary
 */

function getChatImageClassName(imageWide = false) {
  return imageWide ? 'msg-image is-wide' : 'msg-image';
}

function getChatImageInlineStyle(imageWide = false) {
  return imageWide ? 'width:100%;max-width:none;height:auto;object-fit:contain;' : '';
}

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

const _pendingChatImages = [];
let _pendingChatImageWide = false;
let _pendingChatImageHideMeta = false;
let _chatUploadStatusDepth = 0;

function ensureChatUploadStatusEl() {
  const composer = document.querySelector('.chat-composer-stack');
  if (!composer) return null;
  let statusEl = document.getElementById('chat-upload-status');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'chat-upload-status';
    statusEl.className = 'chat-upload-status';
    statusEl.style.display = 'none';
    statusEl.setAttribute('aria-live', 'polite');
    statusEl.innerHTML = '<span class="chat-upload-status-spinner" aria-hidden="true"></span><span class="chat-upload-status-text">사진을 보내는 중입니다.</span>';
    composer.insertBefore(statusEl, composer.firstChild);
  } else if (statusEl.parentElement !== composer) {
    composer.insertBefore(statusEl, composer.firstChild);
  }
  return statusEl;
}

function showChatUploadStatus() {
  const statusEl = ensureChatUploadStatusEl();
  if (!statusEl) return;
  _chatUploadStatusDepth += 1;
  statusEl.style.display = 'flex';
  statusEl.classList.add('is-visible');
}

function hideChatUploadStatus(force = false) {
  const statusEl = document.getElementById('chat-upload-status');
  if (force) {
    _chatUploadStatusDepth = 0;
  } else if (_chatUploadStatusDepth > 0) {
    _chatUploadStatusDepth -= 1;
  }
  if (!statusEl) return;
  if (_chatUploadStatusDepth > 0) return;
  statusEl.classList.remove('is-visible');
  statusEl.style.display = 'none';
}
let _dragChatImageId = null;

function makePendingChatImageId() {
  return `pci_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getChatImageQueueEls() {
  return {
    wrap: document.getElementById('chat-image-queue'),
    list: document.getElementById('chat-image-preview-list'),
    wideToggle: document.getElementById('chat-image-wide-toggle'),
    hideMetaToggle: document.getElementById('chat-image-hide-meta-toggle'),
  };
}

function renderPendingChatImages() {
  const { wrap, list, wideToggle, hideMetaToggle } = getChatImageQueueEls();
  if (!wrap || !list) return;
  list.innerHTML = '';
  if (_pendingChatImages.length === 0) {
    wrap.style.display = 'none';
    if (wideToggle) wideToggle.checked = !!_pendingChatImageWide;
  if (hideMetaToggle) hideMetaToggle.checked = !!_pendingChatImageHideMeta;
    if (hideMetaToggle) hideMetaToggle.checked = !!_pendingChatImageHideMeta;
    return;
  }

  wrap.style.display = '';
  if (wideToggle) wideToggle.checked = !!_pendingChatImageWide;
  if (hideMetaToggle) hideMetaToggle.checked = !!_pendingChatImageHideMeta;

  _pendingChatImages.forEach((item, idx) => {
    const btn = document.createElement('div');
    btn.className = 'chat-image-preview-item';
    btn.draggable = true;
    btn.dataset.imageId = item.id;
    btn.innerHTML = `
      <img src="${esc(item.previewUrl)}" alt="첨부 이미지 ${idx + 1}">
      <span class="chat-image-preview-grab">↕</span>
      <span class="chat-image-preview-order">${idx + 1}</span>
      <button type="button" class="chat-image-preview-remove" title="첨부 취소">✕</button>
    `;
    const removeBtn = btn.querySelector('.chat-image-preview-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removePendingChatImage(item.id);
      });
    }
    btn.addEventListener('dragstart', () => {
      _dragChatImageId = item.id;
      btn.classList.add('dragging');
    });
    btn.addEventListener('dragend', () => {
      _dragChatImageId = null;
      btn.classList.remove('dragging');
      renderPendingChatImages();
    });
    btn.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      movePendingChatImage(_dragChatImageId, item.id);
    });
    list.appendChild(btn);
  });
}


function revokePreparedChatImagePreview(item) {
  if (!item || !item.previewUrl) return;
  if (item.previewKind === 'object-url') {
    try { URL.revokeObjectURL(item.previewUrl); } catch (e) {}
  }
}

function removePendingChatImage(imageId) {
  const idx = _pendingChatImages.findIndex(item => item.id === imageId);
  if (idx < 0) return;
  const [removed] = _pendingChatImages.splice(idx, 1);
  revokePreparedChatImagePreview(removed);
  renderPendingChatImages();
}

function movePendingChatImage(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const fromIdx = _pendingChatImages.findIndex(item => item.id === fromId);
  const toIdx = _pendingChatImages.findIndex(item => item.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = _pendingChatImages.splice(fromIdx, 1);
  _pendingChatImages.splice(toIdx, 0, moved);
  renderPendingChatImages();
}

function clearPendingChatImages() {
  _pendingChatImages.splice(0, _pendingChatImages.length).forEach(revokePreparedChatImagePreview);
  _pendingChatImageWide = false;
  _pendingChatImageHideMeta = false;
  renderPendingChatImages();
}

function togglePendingChatImageWide(checked) {
  _pendingChatImageWide = !!checked;
}

function togglePendingChatImageHideMeta(checked) {
  _pendingChatImageHideMeta = !!checked;
}

function getCloudinaryRuntimeConfig() { return _itcGetCloudinaryConfig(); }

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result);
    reader.onerror = () => reject(new Error('이미지를 읽지 못했어요.'));
    reader.readAsDataURL(file);
  });
}

async function canvasToJpegBlob(canvas, quality = 0.84) {
  return _itcCanvasToBlob(canvas, 'image/jpeg', quality);
}

function makePreparedChatImageBase(meta = {}) {
  return {
    id: makePendingChatImageId(),
    previewUrl: meta.previewUrl || '',
    previewKind: meta.previewKind || 'data-url',
    dataUrl: meta.dataUrl || '',
    uploadBlob: meta.uploadBlob || null,
    uploadMime: meta.uploadMime || '',
    uploadFileName: meta.uploadFileName || '',
    isGif: !!meta.isGif,
    width: meta.width || 0,
    height: meta.height || 0,
  };
}

async function fileToPreparedChatImage(file) {
  const isGif = file.type === 'image/gif';
  const maxSize = isGif ? 5 * 1024 * 1024 : 3 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error(isGif ? 'GIF는 5MB 이하만 가능해요.' : '이미지는 3MB 이하만 가능해요.');
  }

  const objectUrl = URL.createObjectURL(file);
  const rawMeta = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.width || 0, height: img.height || 0 });
      try { URL.revokeObjectURL(objectUrl); } catch (e) {}
    };
    img.onerror = () => {
      try { URL.revokeObjectURL(objectUrl); } catch (e) {}
      reject(new Error('이미지 처리에 실패했어요.'));
    };
    img.src = objectUrl;
  });

  if (isGif) {
    return makePreparedChatImageBase({
      previewUrl: URL.createObjectURL(file),
      previewKind: 'object-url',
      uploadBlob: file,
      uploadMime: file.type || 'image/gif',
      uploadFileName: file.name || `chat_${Date.now()}.gif`,
      isGif: true,
      width: rawMeta.width,
      height: rawMeta.height,
    });
  }

  const maxEdge = 1280;
  const needsResize = rawMeta.width > maxEdge || rawMeta.height > maxEdge;
  const needsCompress = file.type !== 'image/jpeg' || file.size > 900 * 1024 || needsResize;

  if (!needsCompress) {
    return makePreparedChatImageBase({
      previewUrl: URL.createObjectURL(file),
      previewKind: 'object-url',
      uploadBlob: file,
      uploadMime: file.type || 'image/jpeg',
      uploadFileName: file.name || `chat_${Date.now()}.jpg`,
      isGif: false,
      width: rawMeta.width,
      height: rawMeta.height,
    });
  }

  const dataUrl = await fileToDataUrl(file);
  const compressed = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      try {
        let w = img.width;
        let h = img.height;
        if (w > maxEdge || h > maxEdge) {
          const ratio = Math.min(maxEdge / w, maxEdge / h);
          w = Math.max(1, Math.round(w * ratio));
          h = Math.max(1, Math.round(h * ratio));
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('이미지 처리에 실패했어요.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const blob = await canvasToJpegBlob(canvas, 0.84);
        resolve({
          blob,
          width: w,
          height: h,
          previewUrl: URL.createObjectURL(blob),
        });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('이미지 처리에 실패했어요.'));
    img.src = dataUrl;
  });

  return makePreparedChatImageBase({
    previewUrl: compressed.previewUrl,
    previewKind: 'object-url',
    dataUrl,
    uploadBlob: compressed.blob,
    uploadMime: 'image/jpeg',
    uploadFileName: `chat_${Date.now()}.jpg`,
    isGif: false,
    width: compressed.width || rawMeta.width || 0,
    height: compressed.height || rawMeta.height || 0,
  });
}

async function queuePendingChatImages(files) {
  const incoming = Array.from(files || []).filter(Boolean);
  if (!incoming.length) return;
  const roomLeft = Math.max(0, 4 - _pendingChatImages.length);
  if (roomLeft <= 0) {
    showToast('이미지는 한 번에 최대 4장까지 첨부할 수 있어요.');
    return;
  }

  const picked = incoming.slice(0, roomLeft);
  if (incoming.length > roomLeft) {
    showToast('이미지는 한 번에 최대 4장까지 첨부할 수 있어요.');
  }

  for (const file of picked) {
    try {
      const prepared = await fileToPreparedChatImage(file);
      _pendingChatImages.push(prepared);
    } catch (err) {
      console.error('queuePendingChatImages failed', err);
      showToast(err?.message || '이미지를 첨부하지 못했어요.');
    }
  }
  renderPendingChatImages();
}

function withTimeout(promise, ms = 3500) { return _itcWithTimeout(promise, ms); }

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
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: contentType }), contentType };
}

async function uploadChatImageBlobToCloudinary(blob, fileName = 'chat.jpg') {
  if (!_itcGetCloudinaryConfig() || !blob) return null;
  const result = await _itcUploadToCloudinary({ blob, fileName, timeout: 20000 });
  return { url: result.url, path: result.publicId, contentType: result.contentType };
}

async function uploadChatImageDataUrl(dataUrl, roomCode, preparedItem = null) {
  const uploadBlob = preparedItem?.uploadBlob || null;
  const uploadFileName = preparedItem?.uploadFileName || '';
  const blobInfo = uploadBlob
    ? { blob: uploadBlob, contentType: preparedItem?.uploadMime || uploadBlob.type || 'image/jpeg' }
    : blobFromDataUrl(dataUrl);

  const uploadedCloudinary = await uploadChatImageBlobToCloudinary(blobInfo.blob, uploadFileName || `chat_${Date.now()}.jpg`);
  if (!uploadedCloudinary?.url) return null;

  return {
    url: uploadedCloudinary.url,
    path: uploadedCloudinary.path || '',
    contentType: uploadedCloudinary.contentType || blobInfo.contentType || 'image/jpeg',
  };
}

async function sendPreparedChatImage(preparedOrDataUrl, imageWide = false, imageMeta = null, hideImageMeta = false) {
  const saJId = St.speakAsJournalId;
  const saJournal = saJId ? loadJournals().find(x => x.id === saJId) : null;
  const saName = saJournal ? (saJournal.title || '무제') : null;
  const saAvatar = saJId ? saGetAvatar(saJId) : null;
  const normalizedMeta = normalizeChatImageMeta(imageMeta);

  const prepared = (preparedOrDataUrl && typeof preparedOrDataUrl === 'object' && ('dataUrl' in preparedOrDataUrl || 'uploadBlob' in preparedOrDataUrl))
    ? preparedOrDataUrl
    : { dataUrl: String(preparedOrDataUrl || '') };
  const dataUrl = prepared.dataUrl || '';
  let finalSrc = '';
  let storageMeta = null;

  if (!St.roomCode) {
    throw new Error('이미지 업로드를 위한 방 정보가 없어요.');
  }

  const uploaded = await uploadChatImageDataUrl(dataUrl, St.roomCode, prepared);
  if (!uploaded?.url) {
    throw new Error('이미지 업로드에 실패했어요. 다시 시도해 주세요.');
  }
  finalSrc = uploaded.url;
  storageMeta = uploaded;

  if (saJournal) {
    const msg = {
      name: saName,
      text: finalSrc,
      type: 'speak-as-image',
      uid: St.myId,
      time: Date.now(),
      speakAsAvatar: saAvatar,
      speakAsJournalId: saJId,
      imageWide: !!imageWide,
      hideImageMeta: !!hideImageMeta,
      imageMeta: normalizedMeta,
      imageStoragePath: storageMeta?.path || '',
      imageContentType: storageMeta?.contentType || inferStorageContentTypeFromDataUrl(dataUrl),
    };
    if (window._FB?.CONFIGURED) {
      const { db, ref, push } = window._FB;
      if (!St.roomCode) throw new Error('roomCode missing');
      return push(ref(db, `rooms/${St.roomCode}/chat`), { ...msg, time: getChatServerTimestamp() });
    }
    appendChatMsg({ name: msg.name, text: finalSrc, type: 'speak-as-image', uid: St.myId, timestamp: msg.time, speakAsAvatar: saAvatar, speakAsJournalId: saJId, channel: 'chat', imageWide: !!imageWide, imageMeta: normalizedMeta, hideImageMeta: !!hideImageMeta });
    return Promise.resolve();
  }

  return sendMessage(St.myName, finalSrc, 'image', {
    imageWide: !!imageWide,
    hideImageMeta: !!hideImageMeta,
    imageMeta: normalizedMeta,
    imageStoragePath: storageMeta?.path || '',
    imageContentType: storageMeta?.contentType || inferStorageContentTypeFromDataUrl(dataUrl),
  });
}

async function sendPendingChatImages() {
  if (_activeRightTab === 'casual') {
    showToast('이미지 첨부는 메인 채팅에서만 보낼 수 있어요.');
    return false;
  }
  if (!_pendingChatImages.length) return true;
  const items = _pendingChatImages.splice(0, _pendingChatImages.length);
  renderPendingChatImages();
  showChatUploadStatus();
  try {
    for (const item of items) {
      await sendPreparedChatImage(item, _pendingChatImageWide, { width: item.width, height: item.height }, _pendingChatImageHideMeta);
      revokePreparedChatImagePreview(item);
    }
    _pendingChatImageWide = false;
    _pendingChatImageHideMeta = false;
    renderPendingChatImages();
    return true;
  } catch (err) {
    console.error('sendPendingChatImages failed', err);
    items.reverse().forEach(item => _pendingChatImages.unshift(item));
    renderPendingChatImages();
    showToast(err?.message || '이미지 업로드에 실패했어요. 잠시 후 다시 시도해 주세요.');
    throw err;
  } finally {
    hideChatUploadStatus();
  }
}

function initChatImageComposer() {
  ensureChatUploadStatusEl();
  renderPendingChatImages();
  bindMessageViewport('chat');
  bindMessageViewport('casual');
}

