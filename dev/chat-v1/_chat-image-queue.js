
const _pendingChatImages = [];
let _pendingChatImageWide = false;
let _pendingChatImageHideMeta = false;
let _chatUploadStatusDepth = 0;


/* ==========================================================================
 * CHAT SECTION: IMAGE COMPOSER UI
 * 이미지 업로드 상태, pending queue, 프리뷰 순서/옵션 UI
 * ========================================================================== */

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


