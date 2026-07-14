(function () {
  function parserApi() {
    const api = window.ITCCocofoliaParser;
    if (!api) throw new Error('코코포리아 파서 모듈을 불러오지 못했어요.');
    return api;
  }

  function featureApi() {
    return window.ITCCocofoliaFeatureDiagnostics || null;
  }

  function sceneApi() {
    return window.ITCCocofoliaSceneDiagnostics || null;
  }

  function buildCocofoliaDiagnostics(zip, parsed) {
    const { normalizeCocofoliaZipPath, collectCocofoliaReferencedImages, isLikelyImageZipEntry } = parserApi();
    const room = parsed?.entities?.room || {};
    const items = parsed?.entities?.items || {};
    const markers = room?.markers || {};
    const zipFiles = Object.values(zip?.files || {}).filter((entry) => entry && !entry.dir);
    const zipPathMap = new Map();
    zipFiles.forEach((entry) => {
      const normalized = normalizeCocofoliaZipPath(entry.name);
      if (normalized && !zipPathMap.has(normalized)) zipPathMap.set(normalized, entry.name);
      const basename = normalized.split('/').pop();
      if (basename && !zipPathMap.has(basename)) zipPathMap.set(basename, entry.name);
    });

    const refs = collectCocofoliaReferencedImages(parsed);
    const matched = [];
    const missing = [];
    refs.forEach((refInfo) => {
      const basename = refInfo.normalized.split('/').pop();
      const actual = zipPathMap.get(refInfo.normalized) || zipPathMap.get(basename) || '';
      (actual ? matched : missing).push({ ...refInfo, actual });
    });

    const supportedTypes = new Set(['object', 'plane']);
    const typedItems = Object.entries(items).map(([id, item]) => ({ id, ...(item || {}) }));
    const supportedItems = typedItems.filter((item) => supportedTypes.has(String(item.type || '')) && String(item.imageUrl || '').trim());
    const unsupportedItems = typedItems.filter((item) => String(item.imageUrl || '').trim() && !supportedTypes.has(String(item.type || '')));
    const inactiveItems = [...supportedItems, ...Object.entries(markers).map(([id, marker]) => ({ id: `marker_${id}`, ...(marker || {}) }))]
      .filter((item) => item.visible === false || item.active === false);
    const negativeZItems = supportedItems.filter((item) => Number(item.z || 0) < 0);

    const fieldWidth = Number(room.fieldWidth || 0);
    const fieldHeight = Number(room.fieldHeight || 0);
    const fieldLeft = fieldWidth > 0 ? -fieldWidth / 2 : null;
    const fieldTop = fieldHeight > 0 ? -fieldHeight / 2 : null;
    const fieldRight = fieldWidth > 0 ? fieldWidth / 2 : null;
    const fieldBottom = fieldHeight > 0 ? fieldHeight / 2 : null;
    const outOfFieldItems = supportedItems.filter((item) => {
      if (!(fieldWidth > 0 && fieldHeight > 0)) return false;
      const x = Number(item.x || 0);
      const y = Number(item.y || 0);
      const w = Math.max(1, Number(item.width || 1));
      const h = Math.max(1, Number(item.height || 1));
      return x < fieldLeft || y < fieldTop || (x + w) > fieldRight || (y + h) > fieldBottom;
    });

    const typeCounts = {};
    typedItems.forEach((item) => {
      const type = String(item.type || 'unknown') || 'unknown';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    const featureInventory = featureApi()?.buildFeatureInventory(zip, parsed) || null;
    const sceneDiagnostics = sceneApi()?.buildSceneDiagnostics(parsed) || null;

    return {
      zipFileCount: zipFiles.length,
      zipImageCount: zipFiles.filter((entry) => isLikelyImageZipEntry(entry.name)).length,
      referenceCount: refs.length,
      matchedReferenceCount: matched.length,
      missingReferenceCount: missing.length,
      supportedObjectCount: supportedItems.length + Object.keys(markers).length,
      unsupportedObjectCount: unsupportedItems.length,
      inactiveObjectCount: inactiveItems.length,
      negativeZObjectCount: negativeZItems.length,
      outOfFieldObjectCount: outOfFieldItems.length,
      fieldWidth,
      fieldHeight,
      typeCounts,
      featureInventory,
      sceneDiagnostics,
      matched,
      missing,
      unsupportedItems: unsupportedItems.map((item) => ({ id: item.id, type: item.type, imageUrl: item.imageUrl || '' })),
      inactiveItems: inactiveItems.map((item) => ({ id: item.id, type: item.type || 'marker', active: item.active, visible: item.visible })),
      negativeZItems: negativeZItems.map((item) => ({ id: item.id, name: item.name || '', z: Number(item.z || 0), imageUrl: item.imageUrl || '' })),
      outOfFieldItems: outOfFieldItems.map((item) => ({ id: item.id, name: item.name || '', x: item.x, y: item.y, width: item.width, height: item.height, z: item.z || 0 })),
    };
  }

  function logCocofoliaDiagnostics(diagnostics, fileName) {
    if (!diagnostics) return;
    console.groupCollapsed(`[ITC 맵세팅 진단] ${fileName || ''}`);
    console.info('요약', {
      zipFiles: diagnostics.zipFileCount,
      zipImages: diagnostics.zipImageCount,
      references: diagnostics.referenceCount,
      matchedReferences: diagnostics.matchedReferenceCount,
      missingReferences: diagnostics.missingReferenceCount,
      supportedObjects: diagnostics.supportedObjectCount,
      unsupportedObjects: diagnostics.unsupportedObjectCount,
      inactiveObjects: diagnostics.inactiveObjectCount,
      negativeZObjects: diagnostics.negativeZObjectCount,
      outOfFieldObjects: diagnostics.outOfFieldObjectCount,
      field: `${diagnostics.fieldWidth || '?'} × ${diagnostics.fieldHeight || '?'}`,
      itemTypes: diagnostics.typeCounts,
    });
    if (diagnostics.missing.length) console.table(diagnostics.missing);
    if (diagnostics.unsupportedItems.length) console.table(diagnostics.unsupportedItems);
    if (diagnostics.inactiveItems.length) console.table(diagnostics.inactiveItems);
    if (diagnostics.negativeZItems.length) console.table(diagnostics.negativeZItems);
    if (diagnostics.outOfFieldItems.length) console.table(diagnostics.outOfFieldItems);
    console.groupEnd();
    featureApi()?.logFeatureInventory(diagnostics.featureInventory, fileName);
    sceneApi()?.logSceneDiagnostics(diagnostics.sceneDiagnostics, fileName);
  }

  function buildValidationSummary(file, parsed, escapeHtml, actionHtml, statusHtml) {
    const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
    const room = parsed?.entities?.room || {};
    const items = parsed?.entities?.items || {};
    const resources = parsed?.resources || {};
    const effects = parsed?.entities?.effects || {};
    const scenes = parsed?.entities?.scenes || {};
    const inventory = featureApi()?.buildFeatureInventory(null, parsed) || null;
    const version = parsed?.meta?.version || '알 수 없음';
    const itemCount = Object.keys(items).length;
    const resourceCount = Object.keys(resources).length;
    const sceneCount = Number(inventory?.features?.scenes?.count || Object.keys(scenes).length || 0);
    const cutinCount = Number(inventory?.features?.cutins?.count || Object.keys(effects).length || 0);
    const animatedCount = Number(inventory?.features?.animatedImages?.count || 0);
    const markerCount = Object.keys(room?.markers || {}).length;
    const headline = [
      `<div class="coco-check-head">`,
      `<b>검사 완료</b>`,
      `<span class="coco-check-file">${safe(file?.name || '')}</span>`,
      `</div>`,
      `<div class="coco-check-metrics">`,
      `<span>오브젝트 <b>${itemCount}</b></span>`,
      sceneCount ? `<span>장면 <b>${sceneCount}</b></span>` : '',
      cutinCount ? `<span>컷인 <b>${cutinCount}</b></span>` : '',
      animatedCount ? `<span>애니메이션 <b>${animatedCount}</b></span>` : '',
      markerCount ? `<span>마커 <b>${markerCount}</b></span>` : '',
      `</div>`,
    ].filter(Boolean).join('');
    const warnings = [];
    if (itemCount >= 80 || resourceCount >= 120) {
      warnings.push(`<div class="coco-check-warning">오브젝트나 리소스가 많은 ZIP입니다. 적용 직후 잠시 무거울 수 있습니다.</div>`);
    }
    const details = [
      `버전: ${safe(version)}`,
      `배경: ${room.backgroundUrl ? '있음' : '없음'} / 전경: ${room.foregroundUrl ? '있음' : '없음'}`,
      `렌더 방식: ${safe(room.fieldObjectFit || 'contain')}`,
      `그리드: ${room.displayGrid ? '표시' : '숨김'} / 정렬 ${room.alignWithGrid ? '켜짐' : '꺼짐'} / 크기 ${Number(room.gridSize || 0) || 0}`,
      `리소스: ${resourceCount}개`,
    ];
    return headline
      + warnings.join('')
      + String(actionHtml || '')
      + String(statusHtml || '')
      + `<details class="coco-check-details"><summary>기본 맵 정보</summary><div>${details.join('<br>')}</div></details>`;
  }

  function buildDiagnosticsStatus(diagnostics) {
    if (!diagnostics) return '';
    const hasProblems = diagnostics.missingReferenceCount > 0 || diagnostics.unsupportedObjectCount > 0;
    const statusText = hasProblems ? '추가 확인 필요' : '모든 기본 파일 연결 정상';
    const statusClass = hasProblems ? 'is-warning' : 'is-ok';
    return `<div class="coco-check-status ${statusClass}">${statusText}</div>`;
  }

  function buildDiagnosticsSummary(diagnostics, escapeHtml) {
    if (!diagnostics) return '';
    const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
    const hasProblems = diagnostics.missingReferenceCount > 0 || diagnostics.unsupportedObjectCount > 0;
    const problemLines = [];
    if (diagnostics.missingReferenceCount > 0) {
      const names = diagnostics.missing.slice(0, 4).map((item) => safe(item.raw)).join(', ');
      problemLines.push(`<span class="coco-check-warning">누락 파일: ${names}${diagnostics.missing.length > 4 ? ' 외' : ''}</span>`);
    }
    if (diagnostics.unsupportedObjectCount > 0) {
      const types = [...new Set(diagnostics.unsupportedItems.map((item) => String(item.type || 'unknown')))].join(', ');
      problemLines.push(`<span class="coco-check-warning">현재 미지원 타입: ${safe(types)}</span>`);
    }
    const diagnosticDetails = [
      `ZIP 이미지: ${diagnostics.zipImageCount}개 / 데이터 참조: ${diagnostics.referenceCount}개`,
      `파일 연결: ${diagnostics.matchedReferenceCount}개 성공 / ${diagnostics.missingReferenceCount}개 누락`,
      `지원 오브젝트: ${diagnostics.supportedObjectCount}개 / 미지원 타입: ${diagnostics.unsupportedObjectCount}개`,
      `필드 밖 배치: ${diagnostics.outOfFieldObjectCount}개 / 음수 레이어: ${diagnostics.negativeZObjectCount}개 / 비활성: ${diagnostics.inactiveObjectCount}개`,
      ...problemLines,
      `<span class="coco-check-note">세부 개발 정보는 콘솔의 ‘ITC 맵세팅 진단’에서 확인할 수 있습니다.</span>`,
    ];
    const featureSummary = featureApi()?.buildFeatureSummary(diagnostics.featureInventory, safe) || '';
    const sceneSummary = sceneApi()?.buildSceneSummary(diagnostics.sceneDiagnostics, safe) || '';
    return `<details class="coco-check-details"${hasProblems ? ' open' : ''}><summary>상세 호환 진단</summary><div>${diagnosticDetails.join('<br>')}</div></details>`
      + featureSummary
      + sceneSummary;
  }

  window.ITCCocofoliaDiagnostics = Object.freeze({
    buildCocofoliaDiagnostics,
    logCocofoliaDiagnostics,
    buildValidationSummary,
    buildDiagnosticsStatus,
    buildDiagnosticsSummary,
  });
})();
