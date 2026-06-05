/* ==========================================================================
 * CHAT SECTION: IMAGE UPLOAD TRANSPORT
 * Cloudinary/Storage 업로드 경로와 timeout 보조 함수
 * ========================================================================== */

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

