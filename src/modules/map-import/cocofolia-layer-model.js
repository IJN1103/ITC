(function () {
  function classifyLayer(item = {}) {
    const type = String(item.type || 'object');
    const z = Number(item.z || 0);
    if (type === 'plane') return 'plane';
    if (z < 0) return 'back-object';
    if (item.marker === true) return 'marker';
    return 'object';
  }

  function buildLayerEntries(worldModel = null) {
    const items = Array.isArray(worldModel?.items) ? worldModel.items : [];
    return items
      .map((item, index) => ({
        id: `object:${item.id}`,
        sourceItemId: item.id,
        group: classifyLayer(item),
        sourceZ: Number(item.z || 0),
        sourceOrder: Number(item.order || index),
        stableOrder: index,
      }))
      .sort((a, b) => {
        const zDiff = a.sourceZ - b.sourceZ;
        if (zDiff !== 0) return zDiff;
        const orderDiff = a.sourceOrder - b.sourceOrder;
        if (orderDiff !== 0) return orderDiff;
        return a.stableOrder - b.stableOrder;
      })
      .map((entry, index) => ({
        ...entry,
        safeOrder: 1000 + index,
      }));
  }

  function getLayerEntryMap(worldModel = null) {
    return buildLayerEntries(worldModel).reduce((acc, entry) => {
      acc[entry.sourceItemId] = entry;
      return acc;
    }, {});
  }

  window.ITCCocofoliaLayerModel = Object.freeze({
    classifyLayer,
    buildLayerEntries,
    getLayerEntryMap,
  });
})();
