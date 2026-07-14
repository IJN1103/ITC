(function () {
  const FALLBACK_POLICY_ID = 'first-scene-objects-rest-background';
  const FALLBACK_POLICY_LABEL = '첫 장면에 공통 오브젝트 포함 / 나머지 장면은 배경만 생성';

  function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function stringValue(value) {
    return String(value == null ? '' : value).trim();
  }

  function numberOrZero(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function objectEntries(value) {
    return Object.entries(asObject(value));
  }

  function buildSceneDiagnostics(parsed) {
    const entities = asObject(parsed?.entities);
    const room = asObject(entities.room);
    const scenes = objectEntries(entities.scenes)
      .map(([id, raw], sourceIndex) => {
        const scene = asObject(raw);
        const markers = asObject(scene.markers);
        const directFields = [];
        const extensionFields = [];

        if (stringValue(scene.name)) directFields.push('name');
        directFields.push('order');
        if (stringValue(scene.backgroundUrl)) directFields.push('background');

        if (stringValue(scene.foregroundUrl)) extensionFields.push('foreground');
        if (numberOrZero(scene.fieldWidth) > 0 || numberOrZero(scene.fieldHeight) > 0) extensionFields.push('fieldSize');
        if (stringValue(scene.fieldObjectFit)) extensionFields.push('fieldObjectFit');
        if (scene.displayGrid === true || scene.alignWithGrid === true || numberOrZero(scene.gridSize) > 1) extensionFields.push('grid');
        if (Object.keys(markers).length) extensionFields.push('markers');
        if (stringValue(scene.text)) extensionFields.push('text');
        if (stringValue(scene.mediaRef)) extensionFields.push('mediaRef');
        if (stringValue(scene.soundRef)) extensionFields.push('soundRef');
        if (scene.locked === true) extensionFields.push('locked');

        return {
          id,
          sourceIndex,
          name: stringValue(scene.name) || '(이름 없음)',
          order: numberOrZero(scene.order),
          backgroundUrl: stringValue(scene.backgroundUrl),
          foregroundUrl: stringValue(scene.foregroundUrl),
          fieldWidth: numberOrZero(scene.fieldWidth),
          fieldHeight: numberOrZero(scene.fieldHeight),
          fieldObjectFit: stringValue(scene.fieldObjectFit) || 'contain',
          displayGrid: scene.displayGrid === true,
          alignWithGrid: scene.alignWithGrid === true,
          gridSize: numberOrZero(scene.gridSize),
          markerCount: Object.keys(markers).length,
          hasText: !!stringValue(scene.text),
          mediaRef: stringValue(scene.mediaRef),
          soundRef: stringValue(scene.soundRef),
          locked: scene.locked === true,
          directFields,
          extensionFields,
        };
      })
      .sort((a, b) => (a.order - b.order) || (a.sourceIndex - b.sourceIndex));

    const items = objectEntries(entities.items);
    const effects = objectEntries(entities.effects);
    const snapshots = objectEntries(entities.snapshots);
    const savedatas = objectEntries(entities.savedatas);

    const itemSceneLinkFields = ['sceneId', 'sceneID', 'sceneRef', 'sceneIds', 'scenes'];
    const linkedItems = items.filter(([, item]) => itemSceneLinkFields.some((key) => {
      const value = item?.[key];
      return Array.isArray(value) ? value.length > 0 : !!stringValue(value);
    }));
    const effectSceneLinkFields = ['sceneId', 'sceneID', 'sceneRef', 'sceneIds', 'scenes'];
    const linkedEffects = effects.filter(([, effect]) => effectSceneLinkFields.some((key) => {
      const value = effect?.[key];
      return Array.isArray(value) ? value.length > 0 : !!stringValue(value);
    }));

    const directMappingFields = ['장면 이름', '순서', '배경 이미지'];
    const extensionNeeds = new Set();
    scenes.forEach((scene) => scene.extensionFields.forEach((field) => extensionNeeds.add(field)));

    const objectBindingStatus = linkedItems.length > 0
      ? '장면별 오브젝트 연결 필드 감지'
      : '장면별 오브젝트 소속 정보 없음';
    const cutinBindingStatus = linkedEffects.length > 0
      ? '장면별 컷인 연결 필드 감지'
      : '장면별 컷인 연결 정보 없음';
    const roomActiveSceneId = stringValue(room.sceneId);

    return {
      sceneCount: scenes.length,
      scenes,
      directMappingFields,
      extensionNeeds: Array.from(extensionNeeds),
      roomActiveSceneId,
      itemCount: items.length,
      linkedItemCount: linkedItems.length,
      effectCount: effects.length,
      linkedEffectCount: linkedEffects.length,
      snapshotCount: snapshots.length,
      savedataCount: savedatas.length,
      objectBindingStatus,
      cutinBindingStatus,
      canCreateSceneCards: scenes.length > 0,
      canBindPerSceneObjects: linkedItems.length > 0 || snapshots.length > 0 || savedatas.length > 0,
      canBindPerSceneCutins: linkedEffects.length > 0,
      requiresSharedObjectFallback: scenes.length > 0 && linkedItems.length === 0 && snapshots.length === 0 && savedatas.length === 0,
      fallbackPolicy: {
        id: FALLBACK_POLICY_ID,
        label: FALLBACK_POLICY_LABEL,
        confirmed: true,
        appliesOnlyWhenSceneBindingsMissing: true,
        firstSceneIncludesSharedObjects: true,
        laterScenesBackgroundOnly: true,
        sourceBindingsTakePriority: true,
      },
      plannedSceneCards: scenes.map((scene, index) => ({
        sceneId: scene.id,
        name: scene.name,
        order: scene.order,
        backgroundUrl: scene.backgroundUrl,
        includeSharedObjects: index === 0,
        backgroundOnly: index > 0,
      })),
    };
  }

  function buildSceneSummary(diagnostics, escapeHtml) {
    if (!diagnostics || diagnostics.sceneCount <= 0) return '';
    const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
    const sceneRows = diagnostics.scenes.map((scene) => {
      const background = scene.backgroundUrl ? '배경 있음' : '배경 없음';
      const extension = scene.extensionFields.length ? ` / 추가 변환 ${scene.extensionFields.length}항목` : '';
      return `<div class="coco-scene-row"><b>${safe(scene.name)}</b><span>순서 ${scene.order || '-'}</span><small>${background}${extension}</small></div>`;
    }).join('');
    const bindingClass = diagnostics.requiresSharedObjectFallback ? 'coco-check-warning' : 'coco-check-note';
    const bindingText = diagnostics.requiresSharedObjectFallback
      ? '이 ZIP에는 장면별 오브젝트 소속 정보가 없습니다. 확정 정책에 따라 첫 장면에만 공통 오브젝트를 포함하고, 이후 장면은 배경만 생성합니다.'
      : diagnostics.objectBindingStatus;
    const policyText = diagnostics.requiresSharedObjectFallback
      ? `확정 연결 정책: ${safe(diagnostics.fallbackPolicy?.label || FALLBACK_POLICY_LABEL)}`
      : '원본 장면별 연결 정보가 감지되면 해당 정보를 우선 사용합니다.';
    const extensionText = diagnostics.extensionNeeds.length
      ? `추가 연결 검토: ${diagnostics.extensionNeeds.map(safe).join(', ')}`
      : '추가 연결이 필요한 장면 속성 없음';

    return `<details class="coco-check-details coco-scene-diagnostics"><summary>장면 연결 구조 진단 (${diagnostics.sceneCount}개)</summary><div>`
      + sceneRows
      + `<div class="coco-check-note">기존 장면 카드에 직접 연결 가능: ${diagnostics.directMappingFields.map(safe).join(', ')}</div>`
      + `<div class="coco-check-note">${extensionText}</div>`
      + `<div class="${bindingClass}">${safe(bindingText)}</div>`
      + `<div class="coco-check-note"><b>${policyText}</b></div>`
      + `<div class="coco-check-note">※ 맵 이미지 적용 시 확정 정책에 따라 기존 장면 전환 설정창에 장면 카드를 생성합니다.</div>`
      + `<div class="coco-check-note">${safe(diagnostics.cutinBindingStatus)}</div>`
      + `</div></details>`;
  }

  function logSceneDiagnostics(diagnostics, fileName) {
    if (!diagnostics || diagnostics.sceneCount <= 0) return;
    console.groupCollapsed(`[ITC 코코포리아 장면 연결 진단] ${fileName || ''}`);
    console.info('연결 요약', {
      sceneCount: diagnostics.sceneCount,
      canCreateSceneCards: diagnostics.canCreateSceneCards,
      canBindPerSceneObjects: diagnostics.canBindPerSceneObjects,
      canBindPerSceneCutins: diagnostics.canBindPerSceneCutins,
      roomActiveSceneId: diagnostics.roomActiveSceneId || '(없음)',
      itemCount: diagnostics.itemCount,
      linkedItemCount: diagnostics.linkedItemCount,
      effectCount: diagnostics.effectCount,
      linkedEffectCount: diagnostics.linkedEffectCount,
      snapshotCount: diagnostics.snapshotCount,
      savedataCount: diagnostics.savedataCount,
      requiresSharedObjectFallback: diagnostics.requiresSharedObjectFallback,
      fallbackPolicy: diagnostics.fallbackPolicy,
    });
    console.table(diagnostics.scenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      order: scene.order,
      background: scene.backgroundUrl || '',
      foreground: scene.foregroundUrl || '',
      field: `${scene.fieldWidth || '?'} × ${scene.fieldHeight || '?'}`,
      objectFit: scene.fieldObjectFit,
      grid: scene.displayGrid || scene.alignWithGrid ? `${scene.gridSize || 1}` : '꺼짐',
      markers: scene.markerCount,
      text: scene.hasText,
      mediaRef: scene.mediaRef || '',
      soundRef: scene.soundRef || '',
      locked: scene.locked,
      directFields: scene.directFields.join(', '),
      extensionFields: scene.extensionFields.join(', '),
    })));
    console.info('오브젝트 연결', diagnostics.objectBindingStatus);
    console.info('컷인 연결', diagnostics.cutinBindingStatus);
    if (diagnostics.requiresSharedObjectFallback) {
      console.info('확정 fallback 정책', diagnostics.fallbackPolicy);
      console.table(diagnostics.plannedSceneCards);
      console.warn('장면별 소속 정보가 없으므로 첫 장면에만 공통 오브젝트를 포함하고, 이후 장면은 배경만 생성하는 정책을 사용합니다.');
    }
    console.groupEnd();
  }

  window.ITCCocofoliaSceneDiagnostics = Object.freeze({
    buildSceneDiagnostics,
    buildSceneSummary,
    logSceneDiagnostics,
  });
})();
