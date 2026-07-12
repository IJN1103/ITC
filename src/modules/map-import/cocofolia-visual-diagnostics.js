(function () {
  let lastSignature = '';
  let timer = 0;

  function n(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function round(value) {
    return Math.round(n(value) * 1000) / 1000;
  }

  function rectOf(row) {
    const s = row?.source;
    if (!s) return null;
    const left = n(s.x);
    const top = n(s.y);
    const width = Math.max(0, n(s.width));
    const height = Math.max(0, n(s.height));
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  function intersects(a, b) {
    return !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function containsPoint(rect, x, y) {
    return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function getField(rows) {
    const field = rows.find((row) => row?.sourceCanvas?.field?.width > 0 && row?.sourceCanvas?.field?.height > 0)?.sourceCanvas?.field;
    if (field) {
      return {
        left: n(field.left), top: n(field.top), width: n(field.width), height: n(field.height),
        right: n(field.left) + n(field.width), bottom: n(field.top) + n(field.height),
      };
    }
    return { left: -20, top: -15, width: 40, height: 30, right: 20, bottom: 15 };
  }

  function fileLabel(row) {
    return row?.sourceImageName || row?.name || row?.sourceItemId || row?.id || '';
  }

  function compactRow(row, field) {
    const rect = rectOf(row);
    const fieldArea = Math.max(1, field.width * field.height);
    const areaRatio = rect ? (rect.width * rect.height) / fieldArea : 0;
    return {
      파일: fileLabel(row),
      이름: row?.name || '',
      유형: row?.source?.type || row?.layer?.group || '',
      그룹: row?.layer?.group || '',
      Z: row?.source?.z ?? row?.layer?.sourceZ ?? '',
      순서: row?.source?.order ?? row?.layer?.sourceOrder ?? '',
      좌표: rect ? `${round(rect.left)}, ${round(rect.top)}` : '',
      크기: rect ? `${round(rect.width)} × ${round(rect.height)}` : '',
      필드대비면적: `${round(areaRatio * 100)}%`,
      투명도: row?.source?.opacity ?? '미기록',
      objectFit: row?.computed?.objectFit || '',
      부모: row?.parent || '',
    };
  }

  function buildReport(inputRows) {
    const unique = new Map();
    (Array.isArray(inputRows) ? inputRows : []).forEach((row) => {
      if (row?.id) unique.set(String(row.id), row);
    });
    const rows = Array.from(unique.values()).filter((row) => row?.source);
    if (!rows.length) return null;
    const field = getField(rows);
    const centerX = field.left + field.width / 2;
    const centerY = field.top + field.height / 2;
    const fieldArea = Math.max(1, field.width * field.height);

    const largeBackdrop = rows.filter((row) => {
      const r = rectOf(row);
      if (!r) return false;
      const areaRatio = (r.width * r.height) / fieldArea;
      const largeAxis = r.width >= field.width * 1.4 || r.height >= field.height * 1.4;
      const backgroundGroup = ['plane', 'back-object'].includes(String(row?.layer?.group || ''));
      return areaRatio >= 1.25 || (largeAxis && backgroundGroup);
    }).sort((a, b) => n(a?.source?.z) - n(b?.source?.z) || n(a?.source?.order) - n(b?.source?.order));

    const centerStack = rows.filter((row) => containsPoint(rectOf(row), centerX, centerY))
      .sort((a, b) => n(a?.source?.z) - n(b?.source?.z) || n(a?.source?.order) - n(b?.source?.order));

    const fieldOverlap = rows.filter((row) => intersects(rectOf(row), field))
      .sort((a, b) => n(a?.source?.z) - n(b?.source?.z) || n(a?.source?.order) - n(b?.source?.order));

    return { rows, field, centerX, centerY, largeBackdrop, centerStack, fieldOverlap };
  }

  function print(report) {
    if (!report) return;
    const signature = report.rows.map((row) => [row.id, row.source?.z, row.source?.order, row.computed?.objectFit].join(':')).sort().join('|');
    if (signature === lastSignature) return;
    lastSignature = signature;

    console.groupCollapsed('[ITC 코코포리아 시각 차이 진단] 중앙 프레임 / 큰 사각형 경계');
    console.info('기준 필드', {
      left: report.field.left, top: report.field.top,
      width: report.field.width, height: report.field.height,
      centerX: report.centerX, centerY: report.centerY,
    });

    console.groupCollapsed(`① 큰 사각형 경계 후보 ${report.largeBackdrop.length}개`);
    if (report.largeBackdrop.length) console.table(report.largeBackdrop.map((row) => compactRow(row, report.field)));
    else console.info('자동 기준에 해당하는 대형 배경 후보가 없습니다.');
    console.groupEnd();

    console.groupCollapsed(`② 중앙 프레임 중심을 덮는 오브젝트 ${report.centerStack.length}개 (뒤→앞 순서)`);
    if (report.centerStack.length) console.table(report.centerStack.map((row) => compactRow(row, report.field)));
    else console.info('필드 중심점을 덮는 오브젝트가 없습니다.');
    console.groupEnd();

    console.groupCollapsed(`참고: 기본 필드와 겹치는 전체 오브젝트 ${report.fieldOverlap.length}개`);
    console.table(report.fieldOverlap.map((row) => compactRow(row, report.field)));
    console.groupEnd();

    console.info('판단 방법', [
      '큰 사각형 경계는 ① 후보 중 필드보다 매우 크고 plane/back-object인 항목을 우선 확인합니다.',
      '중앙 프레임 내부 차이는 ② 표의 뒤→앞 순서와 파일명을 코코포리아 화면과 비교합니다.',
      '이번 진단은 좌표·비율·레이어 표시 상태를 변경하지 않습니다.',
    ]);
    console.groupEnd();
  }

  function consume(rows) {
    clearTimeout(timer);
    timer = setTimeout(() => print(buildReport(rows)), 350);
  }

  function reset() {
    clearTimeout(timer);
    lastSignature = '';
  }

  window.ITCCocofoliaVisualDiagnostics = Object.freeze({ consume, reset, buildReport });
})();
