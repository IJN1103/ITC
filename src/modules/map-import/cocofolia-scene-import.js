(function () {
  const ROOT = window;

  function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function deepCopy(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function hashText(value) {
    const source = String(value || 'cocofolia');
    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function safeIdPart(value) {
    const clean = String(value || '')
      .normalize('NFKC')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 42);
    return clean || 'scene';
  }

  function sortSourceScenes(rawScenes) {
    return Object.entries(asObject(rawScenes))
      .map(function (entry, sourceIndex) {
        const id = String(entry[0] || '');
        const raw = asObject(entry[1]);
        const orderNum = Number(raw.order);
        return {
          id,
          raw,
          sourceIndex,
          order: Number.isFinite(orderNum) ? orderNum : sourceIndex + 1,
        };
      })
      .sort(function (a, b) {
        return (a.order - b.order) || (a.sourceIndex - b.sourceIndex) || a.id.localeCompare(b.id);
      });
  }

  function defaultSceneName(rawName, index, total) {
    const original = text(rawName);
    if (original) return original;
    const digits = Math.max(2, String(Math.max(1, total)).length);
    return `장면 ${String(index + 1).padStart(digits, '0')}`;
  }

  function buildStableSceneId(importKey, sourceSceneId, index) {
    return `coco_${safeIdPart(importKey)}_${safeIdPart(sourceSceneId || String(index + 1))}`;
  }

  function isMeaningfulScene(raw) {
    const scene = asObject(raw);
    const backgroundUrl = text(scene?.background?.url || scene?.mapBackground || scene?.backgroundUrl);
    const foregroundUrl = text(scene?.foreground?.url || scene?.mapForeground || scene?.foregroundUrl);
    const objects = Array.isArray(scene.objects) ? scene.objects : [];
    const tokens = asObject(scene.tokens);
    const layerState = asObject(scene.layerState);
    return !!(backgroundUrl || foregroundUrl || objects.length || Object.keys(tokens).length || Object.keys(layerState).length);
  }

  function mapTokensById(tokens) {
    const out = {};
    (Array.isArray(tokens) ? tokens : []).forEach(function (token) {
      if (!token?.id) return;
      out[token.id] = deepCopy(token);
    });
    return out;
  }

  function buildSceneRecords(options) {
    const opts = options || {};
    const scenes = sortSourceScenes(opts.rawScenes);
    if (!scenes.length) return { importKey: '', records: [], firstSceneId: '' };

    const fileName = text(opts.fileName) || 'cocofolia.zip';
    const importKey = `zip_${hashText(fileName.toLowerCase())}`;
    const backgroundByName = opts.backgroundByName && typeof opts.backgroundByName.get === 'function'
      ? opts.backgroundByName
      : new Map();
    const backgroundMetaByName = opts.backgroundMetaByName && typeof opts.backgroundMetaByName.get === 'function'
      ? opts.backgroundMetaByName
      : new Map();
    const firstMapState = asObject(opts.firstMapState);
    const firstLayerState = opts.firstLayerState ? deepCopy(opts.firstLayerState) : null;
    const firstTokens = mapTokensById(opts.firstTokens);
    const now = Number(opts.now) || Date.now();

    const records = scenes.map(function (entry, index) {
      const raw = entry.raw;
      const imageName = text(raw.backgroundUrl);
      const uploadedUrl = text(backgroundByName.get(imageName));
      const imageMeta = asObject(backgroundMetaByName.get(imageName));
      const sceneId = buildStableSceneId(importKey, entry.id, index);
      const name = defaultSceneName(raw.name, index, scenes.length);
      const fit = text(raw.fieldObjectFit) || text(firstMapState?.background?.fit) || 'contain';
      const background = uploadedUrl ? {
        url: uploadedUrl,
        fit,
        sourceName: imageName,
        importedAt: now,
      } : (index === 0 && firstMapState.background ? deepCopy(firstMapState.background) : null);

      const record = {
        id: sceneId,
        name,
        order: index + 1,
        createdAt: now,
        updatedAt: now,
        background,
        foreground: null,
        objects: index === 0 && Array.isArray(firstMapState.objects) ? deepCopy(firstMapState.objects) : [],
        layerState: index === 0 ? firstLayerState : null,
        tokens: index === 0 ? firstTokens : {},
        tokensEmpty: index > 0,
        importedFrom: 'cocofolia',
        importSourceName: fileName,
        importKey,
        sourceSceneId: entry.id,
        sourceSceneOrder: entry.order,
        sourceSceneName: text(raw.name),
        cocofoliaScenePolicy: index === 0 ? 'shared-objects' : 'background-only',
      };

      if (index === 0) {
        if (firstMapState.importedCanvas) record.importedCanvas = deepCopy(firstMapState.importedCanvas);
        if (Number(firstMapState.importedCanvasAspect || firstMapState.importedCanvas?.aspect || 0) > 0) {
          record.importedCanvasAspect = Number(firstMapState.importedCanvasAspect || firstMapState.importedCanvas?.aspect);
        }
        if (Number(firstMapState.importedFieldWidth || 0) > 0) record.importedFieldWidth = Number(firstMapState.importedFieldWidth);
        if (Number(firstMapState.importedFieldHeight || 0) > 0) record.importedFieldHeight = Number(firstMapState.importedFieldHeight);
        if (firstMapState.foreground) record.foreground = deepCopy(firstMapState.foreground);
      } else {
        const width = Number(raw.fieldWidth || imageMeta.width || 0);
        const height = Number(raw.fieldHeight || imageMeta.height || 0);
        if (width > 0) record.importedFieldWidth = width;
        if (height > 0) record.importedFieldHeight = height;
        const aspect = imageMeta.width > 0 && imageMeta.height > 0
          ? imageMeta.width / imageMeta.height
          : (width > 0 && height > 0 ? width / height : 0);
        if (aspect > 0) record.importedCanvasAspect = aspect;
      }

      return record;
    });

    return {
      importKey,
      records,
      firstSceneId: records[0]?.id || '',
    };
  }

  async function persistSceneRecords(options) {
    const opts = options || {};
    const roomCode = text(opts.roomCode);
    const records = Array.isArray(opts.records) ? opts.records : [];
    const importKey = text(opts.importKey);
    const firstSceneId = text(opts.firstSceneId || records[0]?.id);
    if (!roomCode || !records.length || !ROOT._FB?.CONFIGURED) return { saved: 0, firstSceneId: '' };

    const { db, ref, get, update } = ROOT._FB;
    const scenesRef = ref(db, `rooms/${roomCode}/mapScenes`);
    const snap = await get(scenesRef);
    const existing = asObject(snap.val());
    const payload = {};
    const nextIds = new Set(records.map(function (scene) { return scene.id; }));

    Object.entries(existing).forEach(function (entry) {
      const id = entry[0];
      const scene = asObject(entry[1]);
      const belongsToImport = text(scene.importKey) === importKey || id.startsWith(`coco_${safeIdPart(importKey)}_`);
      if (belongsToImport && !nextIds.has(id)) payload[`mapScenes/${id}`] = null;
    });

    // 비어 있는 자동 기본 씬만 제거한다. 사용자가 저장한 기존 장면은 유지한다.
    const defaultScene = asObject(existing.default);
    const isUntouchedDefault = existing.default
      && text(defaultScene.name || '기본 씬') === '기본 씬'
      && !isMeaningfulScene(defaultScene);
    if (isUntouchedDefault) {
      payload['mapScenes/default'] = null;
    }

    const retainedScenes = Object.entries(existing).filter(function (entry) {
      const id = entry[0];
      const scene = asObject(entry[1]);
      if (id === 'default' && isUntouchedDefault) return false;
      if (text(scene.importKey) === importKey || id.startsWith(`coco_${safeIdPart(importKey)}_`)) return false;
      return true;
    });
    let maxOrder = retainedScenes.reduce(function (max, entry) {
      const order = Number(entry[1]?.order);
      return Number.isFinite(order) ? Math.max(max, order) : max;
    }, 0);

    records.forEach(function (scene, index) {
      const next = deepCopy(scene);
      next.order = maxOrder + index + 1;
      payload[`mapScenes/${next.id}`] = next;
    });
    if (firstSceneId) payload['meta/activeSceneId'] = firstSceneId;

    await update(ref(db, `rooms/${roomCode}`), payload);
    return { saved: records.length, firstSceneId };
  }

  ROOT.ITCCocofoliaSceneImport = Object.freeze({
    sortSourceScenes,
    defaultSceneName,
    buildSceneRecords,
    persistSceneRecords,
  });
})();
