/**
 * ITC TRPG — 공통 이미지 유틸리티
 * Cloudinary 업로드, 이미지 리사이즈, blob/timeout 헬퍼
 *
 * 모든 모듈에서 중복되던 코드를 한 곳에 모음.
 * 각 모듈은 기존 함수명을 유지한 채 이 파일의 함수를 호출.
 */

/* ── Cloudinary 설정 ── */

function _itcGetCloudinaryConfig() {
  const cfg = window._ITC_CLOUDINARY || {};
  const cloudName = String(cfg.cloudName || '').trim();
  const unsignedPreset = String(cfg.unsignedPreset || '').trim();
  if (!cloudName || !unsignedPreset) return null;
  return { cloudName, unsignedPreset };
}

/* ── Timeout 래퍼 ── */

function _itcWithTimeout(promise, ms = 15000) {
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

/* ── Canvas → Blob ── */

function _itcCanvasToBlob(canvas, type = 'image/jpeg', quality = 0.84) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('blob 생성 실패'));
    }, type, quality);
  });
}

/* ── ObjectURL 안전 해제 ── */

function _itcRevokePreview(url) {
  if (url && String(url).startsWith('blob:')) {
    try { URL.revokeObjectURL(url); } catch (e) {}
  }
}



/* ── Cloudinary 표시용 변환 URL ──
 * 저장된 원본 URL은 바꾸지 않고, 화면 표시 단계에서만 더 가벼운 파생 URL을 사용한다.
 */

function _itcIsCloudinaryUploadUrl(src) {
  const raw = String(src || '').trim();
  if (!raw) return false;
  try {
    const cfg = (typeof _itcGetCloudinaryConfig === 'function' ? _itcGetCloudinaryConfig() : null) || window._ITC_CLOUDINARY || {};
    const cloudName = String(cfg.cloudName || '').trim();
    const url = new URL(raw, window.location.href);
    return url.protocol === 'https:'
      && url.hostname === 'res.cloudinary.com'
      && url.pathname.includes('/image/upload/')
      && (!cloudName || url.pathname.startsWith(`/${cloudName}/image/upload/`));
  } catch (e) {
    return false;
  }
}

function _itcCloudinaryUrlAlreadyTransformed(pathAfterUpload) {
  const firstSegment = String(pathAfterUpload || '').split('/')[0] || '';
  if (!firstSegment || /^v\d+$/i.test(firstSegment)) return false;
  return /(^|,)(a_|ar_|b_|bo_|c_|co_|dpr_|e_|f_|fl_|g_|h_|o_|q_|r_|t_|w_|x_|y_|z_)/.test(firstSegment);
}

function _itcGetCloudinaryImageVariant(src, opts = {}) {
  const raw = String(src || '').trim();
  if (!raw || !_itcIsCloudinaryUploadUrl(raw)) return raw;

  const cacheKey = JSON.stringify([raw, opts]);
  _itcGetCloudinaryImageVariant._cache = _itcGetCloudinaryImageVariant._cache || new Map();
  if (_itcGetCloudinaryImageVariant._cache.has(cacheKey)) return _itcGetCloudinaryImageVariant._cache.get(cacheKey);

  let result = raw;
  try {
    const url = new URL(raw, window.location.href);
    const marker = '/image/upload/';
    const idx = url.pathname.indexOf(marker);
    if (idx < 0) return raw;

    const before = url.pathname.slice(0, idx + marker.length);
    const after = url.pathname.slice(idx + marker.length);
    if (!after || _itcCloudinaryUrlAlreadyTransformed(after)) return raw;

    const parts = [];
    const format = opts.format === false ? '' : String(opts.format || 'auto').trim();
    const quality = opts.quality === false ? '' : String(opts.quality || 'auto').trim();
    const width = Math.max(1, parseInt(opts.width, 10) || 0);
    const height = Math.max(1, parseInt(opts.height, 10) || 0);
    const crop = String(opts.crop || (width && height ? 'fill' : 'limit')).trim();

    if (format) parts.push(`f_${format}`);
    if (quality) parts.push(`q_${quality}`);
    if (width) parts.push(`w_${width}`);
    if (height) parts.push(`h_${height}`);
    if (crop) parts.push(`c_${crop}`);

    if (parts.length) {
      url.pathname = `${before}${parts.join(',')}/${after}`;
      result = url.toString();
    }
  } catch (e) {
    result = raw;
  }

  _itcGetCloudinaryImageVariant._cache.set(cacheKey, result);
  return result;
}

function _itcGetMapLayerThumbSrc(src) {
  return _itcGetCloudinaryImageVariant(src, { width: 96, height: 96, crop: 'fill' });
}

function _itcGetMapSceneThumbSrc(src) {
  return _itcGetCloudinaryImageVariant(src, { width: 360, height: 203, crop: 'fill' });
}

function _itcGetMapDisplayImageSrc(src, max = 2048) {
  const px = Math.max(512, Math.min(2560, parseInt(max, 10) || 2048));
  return _itcGetCloudinaryImageVariant(src, { width: px, height: px, crop: 'limit' });
}

if (typeof window !== 'undefined') {
  window._itcIsCloudinaryUploadUrl = _itcIsCloudinaryUploadUrl;
  window._itcGetCloudinaryImageVariant = _itcGetCloudinaryImageVariant;
  window._itcGetMapLayerThumbSrc = _itcGetMapLayerThumbSrc;
  window._itcGetMapSceneThumbSrc = _itcGetMapSceneThumbSrc;
  window._itcGetMapDisplayImageSrc = _itcGetMapDisplayImageSrc;
}

/* ── Cloudinary 업로드 (공통) ──
 *
 * 반환: { url: string, publicId: string, contentType: string }
 * 옵션:
 *   blob      - 업로드할 Blob (필수)
 *   folder    - Cloudinary 폴더 (선택)
 *   fileName  - 파일명 (선택)
 *   publicId  - 커스텀 public_id (선택)
 *   timeout   - ms (기본 20000)
 */

async function _itcUploadToCloudinary(opts = {}) {
  const cfg = _itcGetCloudinaryConfig();
  if (!cfg) throw new Error('cloudinary-config-missing');
  const { blob, folder, fileName, publicId, timeout = 20000 } = opts;
  if (!blob) throw new Error('empty-upload-blob');

  const form = new FormData();
  form.append('file', blob, fileName || undefined);
  form.append('upload_preset', cfg.unsignedPreset);
  if (folder) form.append('folder', folder);
  if (publicId) form.append('public_id', publicId);

  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/image/upload`;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      body: form,
      signal: controller?.signal,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.secure_url) {
      throw new Error(payload?.error?.message || 'cloudinary upload failed');
    }
    return {
      url: payload.secure_url,
      publicId: payload.public_id || '',
      contentType: blob.type || 'image/jpeg',
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('timeout');
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ── 이미지 리사이즈 → Blob ──
 *
 * file: File 또는 Blob
 * max: 최대 가로/세로 px (기본 800)
 * 반환: Blob (jpeg 또는 png)
 */

async function _itcMakeImageBlob(file, max = 800) {
  const bmp = await createImageBitmap(file);
  try {
    let w = bmp.width, h = bmp.height;
    if (w > max || h > max) {
      const r = Math.min(max / w, max / h);
      w = Math.round(w * r);
      h = Math.round(h * r);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const isPng = /png/i.test(file.type || '');
    return await _itcCanvasToBlob(canvas, isPng ? 'image/png' : 'image/jpeg', isPng ? undefined : 0.9);
  } finally {
    if (bmp && typeof bmp.close === 'function') bmp.close();
  }
}
