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
