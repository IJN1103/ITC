(function () {
  function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function objectEntries(value) {
    return Object.entries(asObject(value));
  }

  function boolCount(entries, predicate) {
    return entries.reduce((count, entry) => count + (predicate(entry[1], entry[0]) ? 1 : 0), 0);
  }

  function stringValue(value) {
    return String(value == null ? '' : value).trim();
  }

  function lower(value) {
    return stringValue(value).toLowerCase();
  }

  function hasImageExtension(value, extensions) {
    const clean = lower(value).split(/[?#]/)[0];
    return extensions.some((ext) => clean.endsWith(ext));
  }

  function collectResourceNames(zip) {
    return Object.values(zip?.files || {})
      .filter((entry) => entry && !entry.dir)
      .map((entry) => stringValue(entry.name));
  }

  function classifyItem(item) {
    const data = asObject(item);
    const type = lower(data.type) || 'unknown';
    const imageUrl = stringValue(data.imageUrl);
    const name = lower(data.name);
    const text = stringValue(data.text || data.content || data.message);

    const isText = type.includes('text') || (!imageUrl && !!text);
    const isScreenPanel = type.includes('screen') || type.includes('panel') || data.screenFixed === true || data.fixedToScreen === true;
    const isMarker = type.includes('marker') || name.includes('marker') || name.includes('마커');
    const isPrivate = data.private === true || data.isPrivate === true || data.secret === true || data.visible === false || lower(data.scope).includes('private');
    const isGmOnly = data.gmOnly === true || data.ownerOnly === true || lower(data.scope).includes('gm');

    return { type, imageUrl, isText, isScreenPanel, isMarker, isPrivate, isGmOnly };
  }

  function buildFeatureInventory(zip, parsed) {
    const entities = asObject(parsed?.entities);
    const room = asObject(entities.room);
    const items = objectEntries(entities.items);
    const effects = objectEntries(entities.effects);
    const scenes = objectEntries(entities.scenes);
    const characters = objectEntries(entities.characters);
    const roomMarkers = objectEntries(room.markers);
    const notes = objectEntries(entities.notes);
    const snapshots = objectEntries(entities.snapshots);
    const savedatas = objectEntries(entities.savedatas);
    const resourceNames = collectResourceNames(zip);

    const itemClasses = items.map(([id, item]) => ({ id, ...classifyItem(item), raw: asObject(item) }));
    const animatedNames = resourceNames.filter((name) => hasImageExtension(name, ['.gif', '.webp', '.apng']));
    const audioNames = resourceNames.filter((name) => hasImageExtension(name, ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']));

    const effectSoundCount = boolCount(effects, (effect) => !!stringValue(effect?.soundRef));
    const sceneSoundCount = boolCount(scenes, (scene) => !!stringValue(scene?.soundRef || scene?.mediaRef));
    const roomSoundCount = stringValue(room.soundRef || room.mediaRef) ? 1 : 0;
    const textItemCount = itemClasses.filter((item) => item.isText).length;
    const screenPanelCount = itemClasses.filter((item) => item.isScreenPanel).length;
    const markerLikeItemCount = itemClasses.filter((item) => item.isMarker).length;
    const privateItemCount = itemClasses.filter((item) => item.isPrivate).length;
    const gmOnlyItemCount = itemClasses.filter((item) => item.isGmOnly).length;

    const gridConfigured = room.displayGrid === true || room.alignWithGrid === true || Number(room.gridSize || 0) > 1
      || scenes.some(([, scene]) => scene?.displayGrid === true || scene?.alignWithGrid === true || Number(scene?.gridSize || 0) > 1);

    const features = {
      scenes: {
        count: scenes.length,
        status: scenes.length > 0 ? 'existing-connection-target' : 'absent',
        details: scenes.map(([id, scene]) => ({ id, name: stringValue(scene?.name) || '(이름 없음)', order: Number(scene?.order || 0), backgroundUrl: stringValue(scene?.backgroundUrl), foregroundUrl: stringValue(scene?.foregroundUrl) })),
      },
      screenPanels: {
        count: screenPanelCount,
        status: screenPanelCount > 0 ? 'needs-schema-confirmation' : 'not-detected',
      },
      cutins: {
        count: effects.length,
        status: effects.length > 0 ? 'existing-connection-target' : 'absent',
        withSound: effectSoundCount,
        details: effects.map(([id, effect]) => ({ id, name: stringValue(effect?.name) || '(이름 없음)', order: Number(effect?.order || 0), imageUrl: stringValue(effect?.imageUrl), soundRef: stringValue(effect?.soundRef), active: effect?.active === true })),
      },
      textObjects: {
        count: textItemCount + notes.length,
        itemCount: textItemCount,
        noteCount: notes.length,
        status: textItemCount + notes.length > 0 ? 'new-or-connection-work' : 'not-detected',
      },
      privateObjects: {
        count: privateItemCount + gmOnlyItemCount,
        privateCount: privateItemCount,
        gmOnlyCount: gmOnlyItemCount,
        status: privateItemCount + gmOnlyItemCount > 0 ? 'permission-review-required' : 'not-detected',
      },
      characters: {
        count: characters.length,
        status: characters.length > 0 ? 'existing-connection-target' : 'absent',
      },
      markers: {
        count: roomMarkers.length + markerLikeItemCount,
        roomMarkerCount: roomMarkers.length,
        itemMarkerCount: markerLikeItemCount,
        status: roomMarkers.length + markerLikeItemCount > 0 ? 'existing-or-new-connection-target' : 'absent',
      },
      grid: {
        count: gridConfigured ? 1 : 0,
        status: gridConfigured ? 'existing-feature-review' : 'not-configured',
        displayGrid: room.displayGrid === true,
        alignWithGrid: room.alignWithGrid === true,
        gridSize: Number(room.gridSize || 0),
      },
      animatedImages: {
        count: animatedNames.length,
        status: animatedNames.length > 0 ? 'upload-render-verification' : 'absent',
        files: animatedNames,
      },
      audio: {
        count: audioNames.length + effectSoundCount + sceneSoundCount + roomSoundCount,
        fileCount: audioNames.length,
        effectReferenceCount: effectSoundCount,
        sceneReferenceCount: sceneSoundCount,
        roomReferenceCount: roomSoundCount,
        status: audioNames.length + effectSoundCount + sceneSoundCount + roomSoundCount > 0 ? 'bgm-or-effect-connection-review' : 'absent',
        files: audioNames,
      },
      snapshots: { count: snapshots.length },
      savedatas: { count: savedatas.length },
    };

    return {
      featureCounts: {
        scenes: features.scenes.count,
        screenPanels: features.screenPanels.count,
        cutins: features.cutins.count,
        textObjects: features.textObjects.count,
        privateObjects: features.privateObjects.count,
        characters: features.characters.count,
        markers: features.markers.count,
        grid: features.grid.count,
        animatedImages: features.animatedImages.count,
        audio: features.audio.count,
      },
      features,
      rawEntityCounts: Object.fromEntries(Object.entries(entities).map(([key, value]) => [key, value && typeof value === 'object' ? Object.keys(value).length : 0])),
    };
  }

  function statusLabel(status) {
    const labels = {
      'existing-connection-target': '기존 기능 연결 대상',
      'existing-or-new-connection-target': '기존 기능 연결 또는 보강 대상',
      'needs-schema-confirmation': '실제 샘플 구조 확인 필요',
      'new-or-connection-work': '신규 구현 또는 기존 기능 연결 대상',
      'permission-review-required': '권한 구조 검토 필요',
      'existing-feature-review': '기존 기능 연결 가능성 검토',
      'upload-render-verification': '업로드·렌더 유지 검증 필요',
      'bgm-or-effect-connection-review': 'BGM·효과음 연결 검토',
      'not-detected': '현재 ZIP에서 감지되지 않음',
      'not-configured': '현재 ZIP에서 설정되지 않음',
      absent: '없음',
    };
    return labels[status] || status || '확인 필요';
  }

  function buildFeatureSummary(inventory, escapeHtml) {
    if (!inventory?.features) return '';
    const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
    const f = inventory.features;
    const rows = [
      ['여러 장면', f.scenes],
      ['스크린 패널', f.screenPanels],
      ['컷인·이펙트', f.cutins],
      ['텍스트 오브젝트', f.textObjects],
      ['비공개·GM 전용', f.privateObjects],
      ['캐릭터 배치', f.characters],
      ['마커', f.markers],
      ['그리드·스냅', f.grid],
      ['GIF·WebP', f.animatedImages],
      ['오디오', f.audio],
    ];
    const lines = [
      '<hr style="border:0;border-top:1px solid rgba(255,255,255,.15);margin:10px 0">',
      '<b>코코포리아 기능 목록 진단</b>',
      ...rows.map(([label, data]) => `${safe(label)}: ${Number(data?.count || 0)}개 — ${safe(statusLabel(data?.status))}`),
      '<span style="opacity:.72">이 결과는 기능을 변경하지 않고 ZIP 데이터만 분류한 것입니다.</span>',
    ];
    return lines.join('<br>');
  }

  function logFeatureInventory(inventory, fileName) {
    if (!inventory?.features) return;
    console.groupCollapsed(`[ITC 코코포리아 기능 목록] ${fileName || ''}`);
    console.table(Object.entries(inventory.features).map(([feature, data]) => ({
      feature,
      count: Number(data?.count || 0),
      status: statusLabel(data?.status),
    })));
    if (inventory.features.scenes.details?.length) console.table(inventory.features.scenes.details);
    if (inventory.features.cutins.details?.length) console.table(inventory.features.cutins.details);
    if (inventory.features.animatedImages.files?.length) console.info('애니메이션 이미지', inventory.features.animatedImages.files);
    if (inventory.features.audio.files?.length) console.info('오디오 파일', inventory.features.audio.files);
    console.groupEnd();
  }

  window.ITCCocofoliaFeatureDiagnostics = Object.freeze({
    buildFeatureInventory,
    buildFeatureSummary,
    logFeatureInventory,
    statusLabel,
  });
})();
