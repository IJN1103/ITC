(function () {
  const seen = new Map();
  let summaryTimer = 0;

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
  }

  function px(value) {
    const n = Number.parseFloat(String(value || ''));
    return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
  }

  function tokenKey(token) {
    return String(token?.id || token?.importedMapObjectMeta?.sourceItemId || token?.name || 'unknown');
  }

  function collect(el, token, stage, plannedRect = null) {
    if (!el || !token?.importedMapObject) return null;
    const source = token?.importedMapObjectMeta?.sourceSpace || null;
    const layout = token?.importedMapObjectMeta?.layoutPct || null;
    const computed = window.getComputedStyle ? getComputedStyle(el) : null;
    const bounds = el.getBoundingClientRect?.() || null;
    const parent = el.parentElement;
    const parentBounds = parent?.getBoundingClientRect?.() || null;
    return {
      id: tokenKey(token),
      name: String(token?.name || ''),
      stage: String(stage || ''),
      rendererSelected: el.dataset.cocofoliaSourceToken === 'true' ? 'source' : 'legacy',
      parent: parent?.id || parent?.className || '',
      source: source ? {
        x: num(source.x), y: num(source.y), width: num(source.width), height: num(source.height),
        units: source.units || '', z: num(source.z), order: num(source.order),
      } : null,
      stored: {
        x: num(token.x), y: num(token.y), panelWidth: num(token.panelWidth), panelHeight: num(token.panelHeight),
        layoutWidthPct: num(layout?.width), layoutHeightPct: num(layout?.height),
        layoutWidthPx: num(layout?.widthPx), layoutHeightPx: num(layout?.heightPx),
      },
      planned: plannedRect ? {
        leftPx: num(plannedRect.leftPx), topPx: num(plannedRect.topPx),
        centerXPx: num(plannedRect.centerXPx), centerYPx: num(plannedRect.centerYPx),
        widthPx: num(plannedRect.widthPx), heightPx: num(plannedRect.heightPx),
        pixelsPerUnit: num(plannedRect.metrics?.pixelsPerUnit),
      } : null,
      inline: {
        left: el.style.left || '', top: el.style.top || '', width: el.style.width || '', height: el.style.height || '',
        transform: el.style.transform || '', zIndex: el.style.zIndex || '',
      },
      computed: computed ? {
        leftPx: px(computed.left), topPx: px(computed.top), widthPx: px(computed.width), heightPx: px(computed.height),
        transform: computed.transform, objectFit: el.querySelector('img') ? getComputedStyle(el.querySelector('img')).objectFit : '',
      } : null,
      viewport: bounds ? {
        left: num(bounds.left), top: num(bounds.top), width: num(bounds.width), height: num(bounds.height),
        parentWidth: num(parentBounds?.width), parentHeight: num(parentBounds?.height),
      } : null,
    };
  }

  function scheduleSummary() {
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => {
      const rows = Array.from(seen.values()).filter(Boolean);
      if (!rows.length) return;
      const compact = rows.map((row) => ({
        name: row.name,
        renderer: row.rendererSelected,
        source: row.source ? `${row.source.width}×${row.source.height}` : '없음',
        planned: row.planned ? `${row.planned.widthPx}×${row.planned.heightPx}` : '없음',
        final: row.computed ? `${row.computed.widthPx}×${row.computed.heightPx}` : '없음',
        parent: row.parent,
        objectFit: row.computed?.objectFit || '',
      }));
      console.groupCollapsed(`[ITC 코코포리아 렌더 경로 진단] ${rows.length}개 오브젝트`);
      console.table(compact);
      console.info('상세 데이터', rows);
      const sourceCount = rows.filter((row) => row.rendererSelected === 'source').length;
      const missingSourceCount = rows.filter((row) => !row.source).length;
      const overwritten = rows.filter((row) => row.planned && row.computed
        && (Math.abs((row.planned.widthPx || 0) - (row.computed.widthPx || 0)) > 1
          || Math.abs((row.planned.heightPx || 0) - (row.computed.heightPx || 0)) > 1));
      console.info({ sourceRendererCount: sourceCount, legacyRendererCount: rows.length - sourceCount, missingSourceSpaceCount: missingSourceCount, sizeMismatchCount: overwritten.length });
      if (overwritten.length) console.warn('계산 크기와 최종 DOM 크기가 다른 오브젝트', overwritten);
      console.groupEnd();
    }, 180);
  }

  function inspect(el, token, stage = 'after-render', plannedRect = null) {
    if (!el || !token?.importedMapObject) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const row = collect(el, token, stage, plannedRect);
        if (!row) return;
        seen.set(tokenKey(token), row);
        scheduleSummary();
      });
    });
  }

  function reset() {
    seen.clear();
    clearTimeout(summaryTimer);
  }

  window.ITCCocofoliaRenderDiagnostics = Object.freeze({ inspect, reset });
})();
