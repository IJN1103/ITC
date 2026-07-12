(function () {
  function toFiniteNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function normalizeWorldItem(raw = {}, id = '', index = 0) {
    const width = Math.max(1, toFiniteNumber(raw.width, 1));
    const height = Math.max(1, toFiniteNumber(raw.height, 1));
    const x = toFiniteNumber(raw.x, 0);
    const y = toFiniteNumber(raw.y, 0);
    return {
      id: String(id || raw.id || `item_${index + 1}`),
      type: String(raw.type || 'object'),
      name: String(raw.name || ''),
      imageUrl: String(raw.imageUrl || ''),
      coverImageUrl: String(raw.coverImageUrl || ''),
      x,
      y,
      width,
      height,
      right: x + width,
      bottom: y + height,
      centerX: x + (width / 2),
      centerY: y + (height / 2),
      z: toFiniteNumber(raw.z, 0),
      order: toFiniteNumber(raw.order, index),
      angle: toFiniteNumber(raw.angle, 0),
      opacity: Math.max(0, Math.min(1, toFiniteNumber(raw.opacity, 1))),
      locked: raw.locked === true,
      freezed: raw.freezed === true,
      closed: raw.closed === true,
      active: raw.active !== false,
      visible: raw.visible !== false,
      marker: raw._markerPanel === true,
      markerText: String(raw._markerText || ''),
      clickAction: raw._clickAction || raw.clickAction || null,
      raw,
    };
  }

  function collectWorldItems(itemsMap = {}, roomMeta = {}) {
    const itemEntries = Object.entries(itemsMap || {})
      .map(([id, item], index) => normalizeWorldItem({ ...(item || {}), _markerPanel: false }, id, index))
      .filter((item) => (item.type === 'object' || item.type === 'plane') && item.visible && item.imageUrl);

    const markerEntries = Object.entries(roomMeta?.markers || {})
      .map(([id, marker], index) => normalizeWorldItem({
        ...(marker || {}),
        type: 'object',
        _markerPanel: true,
        _markerText: String(marker?.text || ''),
        _clickAction: marker?.clickAction || null,
      }, `marker_${id}`, itemEntries.length + index))
      .filter((item) => item.imageUrl);

    return [...itemEntries, ...markerEntries];
  }

  function buildWorldBounds(items = [], roomMeta = {}) {
    const fieldWidth = Math.max(0, toFiniteNumber(roomMeta?.fieldWidth, 0));
    const fieldHeight = Math.max(0, toFiniteNumber(roomMeta?.fieldHeight, 0));
    const fieldLeft = fieldWidth > 0 ? -(fieldWidth / 2) : 0;
    const fieldTop = fieldHeight > 0 ? -(fieldHeight / 2) : 0;
    const fieldRight = fieldLeft + fieldWidth;
    const fieldBottom = fieldTop + fieldHeight;

    const bounds = items.reduce((acc, item) => {
      acc.left = Math.min(acc.left, item.x);
      acc.right = Math.max(acc.right, item.right);
      acc.top = Math.min(acc.top, item.y);
      acc.bottom = Math.max(acc.bottom, item.bottom);
      return acc;
    }, {
      left: fieldWidth > 0 ? fieldLeft : Infinity,
      right: fieldWidth > 0 ? fieldRight : -Infinity,
      top: fieldHeight > 0 ? fieldTop : Infinity,
      bottom: fieldHeight > 0 ? fieldBottom : -Infinity,
    });

    if (![bounds.left, bounds.right, bounds.top, bounds.bottom].every(Number.isFinite)) {
      bounds.left = -20;
      bounds.right = 20;
      bounds.top = -15;
      bounds.bottom = 15;
    }

    return {
      field: {
        left: fieldLeft,
        top: fieldTop,
        right: fieldRight,
        bottom: fieldBottom,
        width: fieldWidth || Math.max(1, bounds.right - bounds.left),
        height: fieldHeight || Math.max(1, bounds.bottom - bounds.top),
        centerX: fieldLeft + ((fieldWidth || Math.max(1, bounds.right - bounds.left)) / 2),
        centerY: fieldTop + ((fieldHeight || Math.max(1, bounds.bottom - bounds.top)) / 2),
      },
      content: {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: Math.max(1, bounds.right - bounds.left),
        height: Math.max(1, bounds.bottom - bounds.top),
      },
    };
  }

  function buildWorldModel(itemsMap = {}, roomMeta = {}) {
    const items = collectWorldItems(itemsMap, roomMeta);
    const bounds = buildWorldBounds(items, roomMeta);
    return {
      version: 1,
      engine: 'cocofolia-source-space',
      units: 'cocofolia-grid',
      field: bounds.field,
      contentBounds: bounds.content,
      items,
    };
  }

  window.ITCCocofoliaWorld = Object.freeze({
    toFiniteNumber,
    normalizeWorldItem,
    collectWorldItems,
    buildWorldBounds,
    buildWorldModel,
  });
})();
