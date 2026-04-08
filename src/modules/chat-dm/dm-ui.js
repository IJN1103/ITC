(function () {
  const ROOT = typeof window !== 'undefined' ? window : globalThis;

  function getStateRoot() {
    if (ROOT.St && typeof ROOT.St === 'object') return ROOT.St;
    if (typeof St !== 'undefined' && St && typeof St === 'object') {
      ROOT.St = St;
      return ROOT.St;
    }
    ROOT.St = {};
    return ROOT.St;
  }

  function getDmBar() { return document.getElementById('dm-channel-bar'); }
  function getDmListWrap() { return document.getElementById('dm-channel-list'); }
  function getAliasStorageKey(roomCode, gmUid) {
    return `itc_dm_aliases_${String(roomCode || '').trim()}_${String(gmUid || '').trim()}`;
  }

  function getAliasMap() {
    const state = ROOT.__DM_CHANNEL_STATE || (ROOT.__DM_CHANNEL_STATE = {});
    if (!state.gmAliasOverrides || typeof state.gmAliasOverrides !== 'object') state.gmAliasOverrides = {};
    return state.gmAliasOverrides;
  }

  function normalizeAlias(value) {
    return String(value || '').trim().slice(0, 8);
  }

  function getAliasLabel(uid, fallbackName = '플레이어') {
    const alias = normalizeAlias(getAliasMap()[String(uid || '').trim()] || '');
    return alias || String(fallbackName || '플레이어').trim() || '플레이어';
  }

  function persistAliasMapLocal(roomCode, gmUid, aliasMap) {
    try { localStorage.setItem(getAliasStorageKey(roomCode, gmUid), JSON.stringify(aliasMap || {})); } catch (e) {}
  }

  function loadAliasMapLocal(roomCode, gmUid) {
    try {
      return JSON.parse(localStorage.getItem(getAliasStorageKey(roomCode, gmUid)) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function applyAliasMap(aliasMap) {
    const target = getAliasMap();
    Object.keys(target).forEach((key) => { delete target[key]; });
    Object.entries(aliasMap || {}).forEach(([uid, name]) => {
      const safeUid = String(uid || '').trim();
      const safeName = normalizeAlias(name);
      if (!safeUid || !safeName) return;
      target[safeUid] = safeName;
    });
  }

  function ensureAliasSync() {
    const state = getStateRoot();
    const roomCode = String(state.roomCode || '').trim();
    const gmUid = String(state.myId || '').trim();
    if (!roomCode || !gmUid || !(typeof ROOT.isDmGmView === 'function' && ROOT.isDmGmView())) return;
    const syncState = ROOT.__DM_ALIAS_SYNC_STATE || (ROOT.__DM_ALIAS_SYNC_STATE = { roomCode: '', gmUid: '', unsubs: [] });
    if (syncState.roomCode === roomCode && syncState.gmUid === gmUid) return;
    (syncState.unsubs || []).forEach((unsub) => { try { if (typeof unsub === 'function') unsub(); } catch (e) {} });
    syncState.unsubs = [];
    syncState.roomCode = roomCode;
    syncState.gmUid = gmUid;

    const localMap = loadAliasMapLocal(roomCode, gmUid);
    applyAliasMap(localMap);

    if (window._FB?.CONFIGURED && typeof ROOT.getDmAliasStoragePath === 'function') {
      const rootPath = `users/${gmUid}/dmButtonAliases/${roomCode}`;
      try {
        const { db, ref, onValue } = window._FB;
        const unsub = onValue(ref(db, rootPath), (snap) => {
          const remoteMap = snap.val() || {};
          applyAliasMap(remoteMap);
          persistAliasMapLocal(roomCode, gmUid, getAliasMap());
          renderDmChannelButtons();
        });
        if (typeof unsub === 'function') syncState.unsubs.push(unsub);
      } catch (e) {}
    }
  }

  async function saveAlias(uid, alias) {
    const state = getStateRoot();
    const roomCode = String(state.roomCode || '').trim();
    const gmUid = String(state.myId || '').trim();
    const safeUid = String(uid || '').trim();
    const safeAlias = normalizeAlias(alias);
    if (!roomCode || !gmUid || !safeUid) return;
    const nextMap = { ...getAliasMap() };
    if (safeAlias) nextMap[safeUid] = safeAlias; else delete nextMap[safeUid];
    applyAliasMap(nextMap);
    persistAliasMapLocal(roomCode, gmUid, getAliasMap());
    renderDmChannelButtons();
    if (window._FB?.CONFIGURED && typeof ROOT.getDmAliasStoragePath === 'function') {
      try {
        const { db, ref, set } = window._FB;
        const path = ROOT.getDmAliasStoragePath(roomCode, safeUid, gmUid);
        if (path) await set(ref(db, path), safeAlias || null);
      } catch (e) {}
    }
  }

  function promptAliasEdit(uid, fallbackName) {
    const current = getAliasLabel(uid, '');
    const input = window.prompt('표시 이름을 입력하세요. (최대 8글자, 빈칸이면 초기화)', current || '');
    if (input === null) return;
    saveAlias(uid, input);
  }

  function getOtherPlayerEntries() {
    const state = getStateRoot();
    const players = state.players || {};
    return Object.entries(players)
      .filter(([uid, player]) => String(uid) !== String(state.myId || '') && String(player?.role || '').trim().toLowerCase() !== 'gm')
      .map(([uid, player]) => ({ uid: String(uid || '').trim(), name: String(player?.name || '').trim() || '플레이어' }))
      .filter((item) => item.uid);
  }

  function getSelectedParticipantIds() {
    return Array.isArray(ROOT.__DM_CHANNEL_STATE?.selectedParticipantIds) ? ROOT.__DM_CHANNEL_STATE.selectedParticipantIds.slice() : [];
  }

  function getChannelLabelForViewer(channel, viewerUid) {
    const state = getStateRoot();
    const players = state.players || {};
    const ids = Array.isArray(channel?.participantIds) ? channel.participantIds : [];
    const safeViewerUid = String(viewerUid || state.myId || '').trim();
    const others = ids.filter((uid) => uid !== safeViewerUid);
    if (!others.length) return 'DM';
    return others.map((uid) => String(players?.[uid]?.name || '플레이어').trim() || '플레이어').join('+');
  }

  function renderGmButtons(list) {
    const others = getOtherPlayerEntries();
    const selected = new Set(getSelectedParticipantIds());
    const currentKey = typeof ROOT.getCurrentDmChannelKey === 'function' ? ROOT.getCurrentDmChannelKey() : 'global';
    const isGlobal = typeof ROOT.isGlobalDmChannelKey === 'function' ? ROOT.isGlobalDmChannelKey(currentKey) : selected.size === 0;
    const items = [];
    items.push(`<button type="button" class="dm-channel-btn ${isGlobal ? 'is-active' : ''}" data-dm-role="global"><span class="dm-channel-label">전체</span><span class="dm-channel-dot" style="display:none"></span></button>`);
    others.forEach((player) => {
      const active = !isGlobal && selected.has(player.uid);
      items.push(`<button type="button" class="dm-channel-btn ${active ? 'is-active' : ''}" data-dm-role="player" data-uid="${player.uid.replace(/"/g, '&quot;')}"><span class="dm-channel-label">${getAliasLabel(player.uid, player.name).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span><span class="dm-channel-dot" style="display:none"></span></button>`);
    });
    list.innerHTML = items.join('');
    list.querySelector('[data-dm-role="global"]')?.addEventListener('click', () => {
      if (typeof ROOT.selectGlobalDmChannel === 'function') ROOT.selectGlobalDmChannel();
      renderDmChannelButtons();
    });
    list.querySelectorAll('[data-dm-role="player"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const uid = String(btn.dataset.uid || '').trim();
        if (!uid) return;
        const next = new Set(getSelectedParticipantIds());
        if (next.has(uid)) next.delete(uid); else next.add(uid);
        if (typeof ROOT.selectDmParticipants === 'function') ROOT.selectDmParticipants(Array.from(next));
        renderDmChannelButtons();
      });
      btn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const uid = String(btn.dataset.uid || '').trim();
        if (!uid) return;
        const fallbackName = String(btn.textContent || '').trim() || '플레이어';
        promptAliasEdit(uid, fallbackName);
      });
    });
  }

  function renderPlayerButtons(list) {
    const state = getStateRoot();
    const myId = String(state.myId || '').trim();
    const currentKey = typeof ROOT.getCurrentDmChannelKey === 'function' ? ROOT.getCurrentDmChannelKey() : 'global';
    const channels = typeof ROOT.getPlayerVisibleDmChannels === 'function' ? ROOT.getPlayerVisibleDmChannels(myId) : [];
    const items = [];
    items.push(`<button type="button" class="dm-channel-btn ${String(currentKey) === 'global' ? 'is-active' : ''}" data-dm-role="global"><span class="dm-channel-label">전체</span><span class="dm-channel-dot" style="display:none"></span></button>`);
    channels.forEach((channel) => {
      const active = String(currentKey) === String(channel.channelKey || '');
      const label = getChannelLabelForViewer(channel, myId);
      items.push(`<button type="button" class="dm-channel-btn ${active ? 'is-active' : ''}" data-dm-role="channel" data-channel-key="${String(channel.channelKey || '').replace(/"/g, '&quot;')}"><span class="dm-channel-label">${label.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span><span class="dm-channel-dot" style="display:none"></span></button>`);
    });
    list.innerHTML = items.join('');
    list.querySelector('[data-dm-role="global"]')?.addEventListener('click', () => {
      if (typeof ROOT.selectGlobalDmChannel === 'function') ROOT.selectGlobalDmChannel();
      renderDmChannelButtons();
    });
    list.querySelectorAll('[data-dm-role="channel"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const channelKey = String(btn.dataset.channelKey || '').trim();
        if (!channelKey) return;
        if (typeof ROOT.setCurrentDmChannelKey === 'function') ROOT.setCurrentDmChannelKey(channelKey);
        renderDmChannelButtons();
      });
    });
  }

  function renderDmChannelButtons() {
    const bar = getDmBar();
    const list = getDmListWrap();
    if (!bar || !list) return;
    ensureAliasSync();
    const visible = isChatTabActive();
    bar.style.display = visible ? 'inline-flex' : 'none';
    if (!visible) { list.innerHTML = ''; return; }
    if (typeof ROOT.isDmGmView === 'function' && ROOT.isDmGmView()) renderGmButtons(list);
    else renderPlayerButtons(list);
  }

  function scheduleBootRender() {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      try { renderDmChannelButtons(); } catch (e) {}
      if (tries >= 8) clearInterval(timer);
    }, 250);
  }

  ROOT.renderDmChannelButtons = renderDmChannelButtons;
  ROOT.refreshDmChannelButtons = renderDmChannelButtons;
  ROOT.getDmButtonAliasLabel = getAliasLabel;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleBootRender, { once: true });
  } else {
    scheduleBootRender();
  }
})();
