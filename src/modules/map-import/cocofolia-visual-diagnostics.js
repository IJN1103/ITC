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

  const boundaryState = {
    report: null,
    candidates: [],
    panel: null,
  };

  function cssUrl(value) {
    const text = String(value || '').trim();
    const match = text.match(/^url\(["']?(.*?)["']?\)$/i);
    return match ? match[1] : text;
  }

  function elementSummary(el, label, kind, row = null) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const img = el.matches('img') ? el : el.querySelector('img');
    const imgStyle = img ? getComputedStyle(img) : null;
    return {
      key: row?.id || el.id || `${kind}:${label}`,
      label,
      kind,
      element: el,
      tokenId: row?.id || el.dataset?.tokenId || '',
      file: row ? fileLabel(row) : '',
      sourceType: row?.source?.type || '',
      sourceZ: row?.source?.z ?? '',
      sourceSize: row?.source ? `${round(row.source.width)} × ${round(row.source.height)}` : '',
      parent: el.parentElement?.id || el.parentElement?.className || '',
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      zIndex: cs.zIndex,
      width: round(rect.width),
      height: round(rect.height),
      objectFit: imgStyle?.objectFit || '',
      backgroundSize: cs.backgroundSize,
      backgroundPosition: cs.backgroundPosition,
      backgroundImage: cssUrl(cs.backgroundImage),
      overflow: cs.overflow,
      hidden: !!el.hidden,
    };
  }

  function findTokenElement(row) {
    const tokenId = String(row?.id || '');
    if (!tokenId) return null;
    try {
      return document.querySelector(`[data-token-id="${CSS.escape(tokenId)}"]`);
    } catch (_) {
      return null;
    }
  }

  function collectBoundaryCandidates(report) {
    const candidates = [];
    const fixed = [
      ['기존 블러 배경', 'legacy-blur', document.getElementById('map-bg-blur-layer')],
      ['기존 일반 배경', 'legacy-background', document.getElementById('map-bg-layer')],
      ['코코포리아 월드 배경', 'source-background', document.getElementById('cocofolia-world-background-layer')],
      ['코코포리아 전경', 'source-foreground', document.getElementById('cocofolia-world-foreground-layer')],
      ['기존 일반 전경', 'legacy-foreground', document.getElementById('map-fg-layer')],
    ];
    fixed.forEach(([label, kind, el]) => {
      const item = elementSummary(el, label, kind);
      if (item) candidates.push(item);
    });

    (report?.largeBackdrop || []).forEach((row, index) => {
      const el = findTokenElement(row);
      const item = elementSummary(el, `대형 오브젝트 ${index + 1}`, 'large-object', row);
      if (item) candidates.push(item);
    });

    const unique = new Map();
    candidates.forEach((item) => {
      if (!unique.has(item.key)) unique.set(item.key, item);
    });
    return Array.from(unique.values());
  }

  function candidateLogRow(item, index) {
    return {
      번호: index + 1,
      후보: item.label,
      종류: item.kind,
      파일: item.file,
      원본유형: item.sourceType,
      Z: item.sourceZ,
      원본크기: item.sourceSize,
      화면크기: `${item.width} × ${item.height}`,
      부모: item.parent,
      display: item.display,
      visibility: item.visibility,
      opacity: item.opacity,
      zIndex: item.zIndex,
      objectFit: item.objectFit,
      backgroundSize: item.backgroundSize,
      overflow: item.overflow,
      이미지URL: item.backgroundImage,
    };
  }

  function restoreCandidate(item) {
    if (!item?.element) return;
    const el = item.element;
    if (el.dataset.itcBoundaryPrevVisibility !== undefined) {
      el.style.visibility = el.dataset.itcBoundaryPrevVisibility;
      delete el.dataset.itcBoundaryPrevVisibility;
    }
    el.classList.remove('itc-boundary-diagnostic-hidden', 'itc-boundary-diagnostic-highlight');
  }

  function setCandidateVisible(index, visible) {
    const item = boundaryState.candidates[index];
    if (!item?.element) return false;
    const el = item.element;
    if (visible) {
      restoreCandidate(item);
    } else {
      if (el.dataset.itcBoundaryPrevVisibility === undefined) {
        el.dataset.itcBoundaryPrevVisibility = el.style.visibility || '';
      }
      el.style.visibility = 'hidden';
      el.classList.add('itc-boundary-diagnostic-hidden');
    }
    updateBoundaryPanel();
    return true;
  }

  function highlightCandidate(index) {
    boundaryState.candidates.forEach((item, i) => {
      item.element?.classList.toggle('itc-boundary-diagnostic-highlight', i === index);
    });
  }

  function restoreAllCandidates() {
    boundaryState.candidates.forEach(restoreCandidate);
    updateBoundaryPanel();
  }

  function ensureBoundaryStyles() {
    if (document.getElementById('itc-boundary-diagnostic-style')) return;
    const style = document.createElement('style');
    style.id = 'itc-boundary-diagnostic-style';
    style.textContent = `
      .itc-boundary-diagnostic-highlight{outline:4px solid #00e5ff!important;outline-offset:-4px!important;filter:drop-shadow(0 0 8px #00e5ff)!important;}
      #itc-boundary-diagnostic-panel{position:fixed;left:12px;bottom:12px;z-index:2147483600;width:min(390px,calc(100vw - 24px));max-height:58vh;overflow:auto;background:rgba(20,22,27,.96);color:#fff;border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:10px;font:12px/1.45 system-ui,sans-serif;box-shadow:0 10px 32px rgba(0,0,0,.38)}
      #itc-boundary-diagnostic-panel .itc-bd-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-weight:700}
      #itc-boundary-diagnostic-panel .itc-bd-row{display:grid;grid-template-columns:28px 1fr auto auto;align-items:center;gap:6px;padding:6px 0;border-top:1px solid rgba(255,255,255,.1)}
      #itc-boundary-diagnostic-panel button{font:inherit;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:#30343d;color:#fff;padding:3px 7px;cursor:pointer}
      #itc-boundary-diagnostic-panel .itc-bd-sub{color:#aeb6c7;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    `;
    document.head.appendChild(style);
  }

  function closeBoundaryPanel() {
    restoreAllCandidates();
    boundaryState.panel?.remove();
    boundaryState.panel = null;
  }

  function updateBoundaryPanel() {
    const panel = boundaryState.panel;
    if (!panel) return;
    const body = panel.querySelector('[data-boundary-body]');
    if (!body) return;
    body.textContent = '';
    boundaryState.candidates.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'itc-bd-row';
      const visible = getComputedStyle(item.element).visibility !== 'hidden';
      row.innerHTML = `<b>${index + 1}</b><div><div>${item.label}</div><div class="itc-bd-sub">${item.file || item.kind} · ${item.width}×${item.height}</div></div>`;
      const highlight = document.createElement('button');
      highlight.textContent = '표시';
      highlight.onclick = () => highlightCandidate(index);
      const toggle = document.createElement('button');
      toggle.textContent = visible ? '숨김' : '복원';
      toggle.onclick = () => setCandidateVisible(index, !visible);
      row.append(highlight, toggle);
      body.appendChild(row);
    });
  }

  function openBoundaryPanel(report = boundaryState.report) {
    if (!report) return false;
    ensureBoundaryStyles();
    boundaryState.report = report;
    boundaryState.candidates = collectBoundaryCandidates(report);
    closeBoundaryPanel();
    boundaryState.report = report;
    boundaryState.candidates = collectBoundaryCandidates(report);

    const panel = document.createElement('div');
    panel.id = 'itc-boundary-diagnostic-panel';
    panel.innerHTML = `<div class="itc-bd-head"><span>사각형 경계 후보 확인</span><span><button data-restore-all>전체 복원</button> <button data-close>닫기</button></span></div><div>각 후보의 <b>숨김</b>을 눌러 경계가 사라지는 번호를 확인해 주세요.</div><div data-boundary-body></div>`;
    panel.querySelector('[data-restore-all]').onclick = restoreAllCandidates;
    panel.querySelector('[data-close]').onclick = closeBoundaryPanel;
    document.body.appendChild(panel);
    boundaryState.panel = panel;
    updateBoundaryPanel();

    console.groupCollapsed(`[ITC 큰 사각형 경계 DOM 진단] 후보 ${boundaryState.candidates.length}개`);
    console.table(boundaryState.candidates.map(candidateLogRow));
    console.info('화면 좌측 아래 진단 패널에서 후보를 하나씩 숨겨 경계를 만드는 요소를 확인해 주세요.');
    console.groupEnd();
    return true;
  }

  const originalPrint = print;
  print = function enhancedPrint(report) {
    originalPrint(report);
    boundaryState.report = report;
    setTimeout(() => openBoundaryPanel(report), 80);
  };

  function reset() {
    clearTimeout(timer);
    lastSignature = '';
    closeBoundaryPanel();
    boundaryState.report = null;
    boundaryState.candidates = [];
  }

  window.ITCCocofoliaBoundaryDiagnostics = Object.freeze({
    open: openBoundaryPanel,
    close: closeBoundaryPanel,
    restoreAll: restoreAllCandidates,
    hide: (number) => setCandidateVisible(Math.max(0, Number(number) - 1), false),
    show: (number) => setCandidateVisible(Math.max(0, Number(number) - 1), true),
    highlight: (number) => highlightCandidate(Math.max(0, Number(number) - 1)),
  });
  window.ITCCocofoliaVisualDiagnostics = Object.freeze({ consume, reset, buildReport });
})();
