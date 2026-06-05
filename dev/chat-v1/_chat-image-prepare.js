/* ==========================================================================
 * CHAT SECTION: IMAGE PREPARE AND ENCODE
 * 파일/캔버스/메타데이터 변환과 업로드용 Blob 생성
 * ========================================================================== */

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

function isChatImageAlphaCapableMime(mime = '') {
  return /^image\/(png|webp)$/i.test(String(mime || '').trim());
}

function getChatImageUploadExtension(mime = '') {
  const safeMime = String(mime || '').toLowerCase();
  if (safeMime === 'image/png') return 'png';
  if (safeMime === 'image/webp') return 'webp';
  if (safeMime === 'image/gif') return 'gif';
  return 'jpg';
}

function makeChatImageUploadFileName(originalName = '', mime = 'image/jpeg') {
  const ext = getChatImageUploadExtension(mime);
  const fallbackBase = `chat_${Date.now()}`;
  const rawBase = String(originalName || fallbackBase).replace(/\.[^\/.]+$/, '').trim() || fallbackBase;
  return `${rawBase}.${ext}`;
}

async function canvasToChatImageBlob(canvas, mime = 'image/jpeg', quality = 0.84) {
  const safeMime = String(mime || '').toLowerCase();
  if (safeMime === 'image/png') {
    return _itcCanvasToBlob(canvas, 'image/png');
  }
  if (safeMime === 'image/webp') {
    try {
      return await _itcCanvasToBlob(canvas, 'image/webp', quality);
    } catch (err) {
      console.warn('webp 변환 실패: png로 대체합니다.', err);
      return _itcCanvasToBlob(canvas, 'image/png');
    }
  }
  return canvasToJpegBlob(canvas, quality);
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
  const fileMime = String(file.type || '').toLowerCase();
  const alphaCapable = isChatImageAlphaCapableMime(fileMime);
  const needsResize = rawMeta.width > maxEdge || rawMeta.height > maxEdge;
  const needsTransform = needsResize || (!alphaCapable && (fileMime !== 'image/jpeg' || file.size > 900 * 1024));

  if (!needsTransform) {
    const uploadMime = fileMime || 'image/jpeg';
    return makePreparedChatImageBase({
      previewUrl: URL.createObjectURL(file),
      previewKind: 'object-url',
      uploadBlob: file,
      uploadMime,
      uploadFileName: file.name || makeChatImageUploadFileName('', uploadMime),
      isGif: false,
      width: rawMeta.width,
      height: rawMeta.height,
    });
  }

  const dataUrl = await fileToDataUrl(file);
  const outputMime = alphaCapable ? fileMime : 'image/jpeg';
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
        const blob = await canvasToChatImageBlob(canvas, outputMime, 0.84);
        resolve({
          blob,
          mime: blob.type || outputMime,
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

  const uploadMime = compressed.mime || compressed.blob?.type || outputMime || 'image/jpeg';
  return makePreparedChatImageBase({
    previewUrl: compressed.previewUrl,
    previewKind: 'object-url',
    dataUrl,
    uploadBlob: compressed.blob,
    uploadMime,
    uploadFileName: makeChatImageUploadFileName(file.name, uploadMime),
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


