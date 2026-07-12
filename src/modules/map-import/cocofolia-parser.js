(function () {
  function ensureJsZipReady() {
    if (!window.JSZip) {
      throw new Error('ZIP 해제 라이브러리를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.');
    }
  }

  function validateParsedCocofoliaData(data) {
    if (!data || typeof data !== 'object') throw new Error('__data.json 형식이 올바르지 않아요.');
    if (!data.meta || typeof data.meta !== 'object') throw new Error('meta 정보가 없어요.');
    if (!data.entities || typeof data.entities !== 'object') throw new Error('entities 정보가 없어요.');
    if (!data.resources || typeof data.resources !== 'object') throw new Error('resources 정보가 없어요.');
    if (!data.entities.room || typeof data.entities.room !== 'object') throw new Error('room 정보가 없어요.');
    if (!data.entities.items || typeof data.entities.items !== 'object') throw new Error('items 정보가 없어요.');
    return true;
  }

  async function parseCocofoliaZip(file) {
    ensureJsZipReady();
    const zip = await window.JSZip.loadAsync(file);
    const dataEntry = zip.file('__data.json');
    if (!dataEntry) throw new Error('코코포리아 ZIP이 아니에요. __data.json 파일이 없습니다.');
    const jsonText = await dataEntry.async('string');
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      throw new Error('__data.json을 읽었지만 JSON 파싱에 실패했어요.');
    }
    validateParsedCocofoliaData(parsed);
    return parsed;
  }

  function normalizeCocofoliaZipPath(value) {
    return decodeURIComponent(String(value || '').trim())
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\//, '')
      .toLowerCase();
  }

  function collectCocofoliaReferencedImages(parsed) {
    const room = parsed?.entities?.room || {};
    const items = parsed?.entities?.items || {};
    const effects = parsed?.entities?.effects || {};
    const refs = [];
    const pushRef = (kind, ownerId, value) => {
      const raw = String(value || '').trim();
      if (!raw) return;
      refs.push({ kind, ownerId: String(ownerId || ''), raw, normalized: normalizeCocofoliaZipPath(raw) });
    };

    pushRef('background', 'room', room.backgroundUrl);
    pushRef('foreground', 'room', room.foregroundUrl);
    Object.entries(items).forEach(([id, item]) => {
      pushRef('item', id, item?.imageUrl);
      pushRef('item-cover', id, item?.coverImageUrl);
    });
    Object.entries(room?.markers || {}).forEach(([id, marker]) => {
      pushRef('marker', id, marker?.imageUrl);
      pushRef('marker-cover', id, marker?.coverImageUrl);
    });
    Object.entries(effects).forEach(([id, effect]) => {
      pushRef('effect', id, effect?.imageUrl);
      pushRef('effect-sound', id, effect?.soundRef);
    });
    return refs;
  }

  function isLikelyImageZipEntry(name) {
    return /\.(png|jpe?g|webp|gif|svg)$/i.test(String(name || ''));
  }

  window.ITCCocofoliaParser = Object.freeze({
    ensureJsZipReady,
    validateParsedCocofoliaData,
    parseCocofoliaZip,
    normalizeCocofoliaZipPath,
    collectCocofoliaReferencedImages,
    isLikelyImageZipEntry,
  });
})();
