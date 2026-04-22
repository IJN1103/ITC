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
  function isChatTabActive() { return typeof _activeRightTab !== 'undefined' ? _activeRightTab === 'chat' : true; }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getAliasStorageKey() {
    const state = getStateRoot();
    const roomCode = String(state.roomCode || state.roomId || '').trim();
    const gmUid = String(state.myId || '').trim();
    return `itc_dm_aliases::${gmUid}::${roomCode}`;
  }

  function loadAliases() {
    try {
      const raw = localStorage.getItem(getAliasStorageKey());
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveAliases(next) {
    try {
      localStorage.setItem(getAliasStorageKey(), JSON.stringify(next && typeof next === 'object' ? next : {}));
    } catch (e) {}
  }

  function sanitizeAlias(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 8);
  }

  function getAliasForUid(uid) {
    const map = loadAliases();
    return sanitizeAlias(map?.[String(uid || '').trim()] || '');
  }

  function setAliasForUid(uid, alias) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) return;
    const map = loadAliases();
    const safeAlias = sanitizeAlias(alias);
    if (safeAlias) map[safeUid] = safeAlias;
    else delete map[safeUid];
    saveAliases(map);
  }

  function getSeenStorageKey() {
    const state = getStateRoot();
    const roomCode = String(state.roomCode || state.roomId || '').trim();
    const myUid = String(state.myId || '').trim();
    return `itc_dm_seen::${myUid}::${roomCode}`;
  }

  function loadSeenMap() {
    try {
      const raw = localStorage.getItem(getSeenStorageKey());
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveSeenMap(next) {
    try {
      localStorage.setItem(getSeenStorageKey(), JSON.stringify(next && typeof next === 'object' ? next : {}));
    } catch (e) {}
  }

  function getMessageStamp(msg) {
    const direct = Number(msg?.updatedAt || msg?.createdAt || msg?.ts || msg?.time || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const parsed = Date.parse(String(msg?.updatedAt || msg?.createdAt || msg?.time || ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function getUnreadRuntime() {
    if (!ROOT.__DM_UI_UNREAD) ROOT.__DM_UI_UNREAD = { roomCode: '', off: null, latestByChannel: {} };
    return ROOT.__DM_UI_UNREAD;
  }

  function markChannelSeen(channelKey) {
    const key = String(channelKey || '').trim();
    if (!key || key === 'global') return;
    const runtime = getUnreadRuntime();
    const latest = Number(runtime.latestByChannel?.[key] || 0);
    if (!latest) {
      if (typeof ROOT.clearDmUnreadState === 'function') ROOT.clearDmUnreadState(key);
      return;
    }
    const seen = loadSeenMap();
    if (Number(seen[key] || 0) >= latest) {
      if (typeof ROOT.clearDmUnreadState === 'function') ROOT.clearDmUnreadState(key);
      return;
    }
    seen[key] = latest;
    saveSeenMap(seen);
    if (typeof ROOT.clearDmUnreadState === 'function') ROOT.clearDmUnreadState(key);
  }

  function channelHasUnread(channelKey) {
    return typeof ROOT.getDmUnreadState === 'function' ? !!ROOT.getDmUnreadState(channelKey) : false;
  }

  function playerHasUnread(uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) return false;
    const channels = typeof ROOT.getAvailableDmChannels === 'function' ? ROOT.getAvailableDmChannels() : [];
    return channels.some((channel) => Array.isArray(channel?.participantIds) && channel.participantIds.includes(safeUid) && channelHasUnread(channel.channelKey));
  }

  function rebuildUnreadState(raw) {
    const runtime = getUnreadRuntime();
    const latestByChannel = {};
    const state = getStateRoot();
    const myId = String(state.myId || '').trim();
    Object.values(raw && typeof raw === 'object' ? raw : {}).forEach((msg) => {
      const key = String(msg?.dmChannelKey || 'global').trim() || 'global';
      if (key === 'global') return;
      const type = String(msg?.type || '').trim();
      if (type === 'dm-bootstrap') return;
      if (type === 'whisper' && myId && String(msg?.uid || '') !== myId && String(msg?.whisperTo || '') !== myId) return;
      const stamp = getMessageStamp(msg);
      latestByChannel[key] = Math.max(Number(latestByChannel[key] || 0), stamp);
    });
    runtime.latestByChannel = latestByChannel;
    const seen = loadSeenMap();
    const currentKey = typeof ROOT.getCurrentDmChannelKey === 'function' ? ROOT.getCurrentDmChannelKey() : 'global';
    if (currentKey && currentKey !== 'global') {
      const latest = Number(latestByChannel[currentKey] || 0);
      if (latest && Number(seen[currentKey] || 0) < latest) {
        seen[currentKey] = latest;
        saveSeenMap(seen);
      }
    }
    Object.keys(latestByChannel).forEach((key) => {
      const unread = Number(latestByChannel[key] || 0) > Number(seen[key] || 0);
      if (typeof ROOT.setDmUnreadState === 'function') ROOT.setDmUnreadState(key, unread);
    });
  }

  function ensureUnreadSync() {
    const state = getStateRoot();
    const roomCode = String(state.roomCode || state.roomId || '').trim();
    const runtime = getUnreadRuntime();
    const fb = ROOT._FB || {};
    const dbRef = fb.db || (typeof db !== 'undefined' ? db : null);
    const refFn = fb.ref || (typeof ref === 'function' ? ref : null);
    const onValueFn = fb.onValue || (typeof onValue === 'function' ? onValue : null);
    if (!roomCode || !dbRef || typeof refFn !== 'function' || typeof onValueFn !== 'function') return;
    if (runtime.roomCode === roomCode && runtime.off) return;
    try { if (typeof runtime.off === 'function') runtime.off(); } catch (e) {}
    runtime.roomCode = roomCode;
    runtime.off = null;
    try {
      runtime.off = onValueFn(refFn(dbRef, `rooms/${roomCode}/chat`), (snap) => {
        rebuildUnreadState(snap.val() || {});
        try {
          document.dispatchEvent(new CustomEvent('itc:dm-unread-change', {
            detail: {
              roomCode,
              currentChannelKey: typeof ROOT.getCurrentDmChannelKey === 'function' ? ROOT.getCurrentDmChannelKey() : 'global',
            },
          }));
        } catch (e) {}
        try { renderDmChannelButtons(); } catch (e) {}
      });
    } catch (e) {}
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

  function getParticipantName(uid) {
    const state = getStateRoot();
    const safeUid = String(uid || '').trim();
    const player = state.players?.[safeUid] || {};
    const role = String(player?.role || '').trim().toLowerCase();
    if (role === 'gm') return 'GM';
    return String(player?.name || '플레이어').trim() || '플레이어';
  }

  function getChannelFullLabel(channel) {
    const ids = Array.isArray(channel?.participantIds) ? channel.participantIds : [];
    if (!ids.length) return 'DM';
    return ids.map((uid) => getParticipantName(uid)).join(' + ');
  }

  function getVisibleRoomListChannels() {
    const state = getStateRoot();
    const myId = String(state.myId || '').trim();
    const all = typeof ROOT.getAvailableDmChannels === 'function' ? ROOT.getAvailableDmChannels() : [];
    if (typeof ROOT.isDmGmView === 'function' && ROOT.isDmGmView()) return all;
    if (typeof ROOT.getPlayerVisibleDmChannels === 'function') return ROOT.getPlayerVisibleDmChannels(myId);
    return myId ? all.filter((channel) => Array.isArray(channel?.participantIds) && channel.participantIds.includes(myId)) : [];
  }

  function visibleRoomListHasUnread() {
    return getVisibleRoomListChannels().some((channel) => channelHasUnread(channel.channelKey));
  }

  function getDmRoomListPanel() {
    let panel = document.getElementById('dm-room-list-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'dm-room-list-panel';
    panel.className = 'dm-room-list-panel';
    panel.style.display = 'none';
    document.body.appendChild(panel);
    return panel;
  }

  function closeDmRoomListPanel() {
    const panel = document.getElementById('dm-room-list-panel');
    if (!panel) return;
    panel.style.display = 'none';
    panel.innerHTML = '';
  }

  function positionDmRoomListPanel(anchor, panel) {
    const rect = anchor?.getBoundingClientRect?.();
    if (!rect) return;
    const width = Math.min(260, Math.max(180, window.innerWidth - 24));
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
    const top = Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - 260));
    panel.style.width = `${width}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function renderDmRoomListPanel(anchor) {
    const panel = getDmRoomListPanel();
    const channels = getVisibleRoomListChannels();
    const currentKey = typeof ROOT.getCurrentDmChannelKey === 'function' ? ROOT.getCurrentDmChannelKey() : 'global';
    const rows = channels.map((channel) => {
      const key = String(channel?.channelKey || '').trim();
      const active = key && String(currentKey) === key;
      const unread = key && channelHasUnread(key);
      return `<button type="button" class="dm-room-list-item ${active ? 'is-active' : ''}" data-channel-key="${escapeHtml(key)}">`
        + `<span class="dm-room-list-name">${escapeHtml(getChannelFullLabel(channel))}</span>`
        + `<span class="dm-room-list-meta">${active ? '현재' : ''}</span>`
        + `<span class="dm-room-list-dot" style="${unread ? '' : 'display:none'}"></span>`
        + `</button>`;
    });
    panel.innerHTML = `
      <div class="dm-room-list-head">DM방 목록</div>
      <div class="dm-room-list-body">
        ${rows.length ? rows.join('') : '<div class="dm-room-list-empty">표시할 DM방이 없어요.</div>'}
      </div>
    `;
    panel.querySelectorAll('[data-channel-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const channelKey = String(btn.dataset.channelKey || '').trim();
        if (!channelKey) return;
        if (typeof ROOT.setCurrentDmChannelKey === 'function') ROOT.setCurrentDmChannelKey(channelKey);
        markChannelSeen(channelKey);
        closeDmRoomListPanel();
        renderDmChannelButtons();
      });
    });
    panel.style.display = 'block';
    positionDmRoomListPanel(anchor, panel);
  }

  function bindDmRoomListButton(list) {
    list.querySelector('[data-dm-role="room-list"]')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const panel = getDmRoomListPanel();
      if (panel.style.display === 'block') {
        closeDmRoomListPanel();
        return;
      }
      renderDmRoomListPanel(ev.currentTarget);
    });
  }

  function bindDmRoomListGlobalEvents() {
    if (ROOT.__DM_ROOM_LIST_EVENTS_BOUND) return;
    ROOT.__DM_ROOM_LIST_EVENTS_BOUND = true;
    document.addEventListener('click', (ev) => {
      const panel = document.getElementById('dm-room-list-panel');
      if (!panel || panel.style.display !== 'block') return;
      if (panel.contains(ev.target)) return;
      if (ev.target?.closest?.('[data-dm-role="room-list"]')) return;
      closeDmRoomListPanel();
    });
    window.addEventListener('resize', closeDmRoomListPanel);
  }

  function getDmRoomListButtonHtml() {
    const dotStyle = visibleRoomListHasUnread() ? '' : 'display:none';
    return `<button type="button" class="dm-channel-btn dm-room-list-toggle" data-dm-role="room-list" title="DM방 목록" aria-label="DM방 목록"><span class="dm-room-list-icon">⋮</span><span class="dm-channel-dot" style="${dotStyle}"></span></button>`;
  }

  function renderGmButtons(list) {
    const others = getOtherPlayerEntries();
    const selected = new Set(getSelectedParticipantIds());
    const currentKey = typeof ROOT.getCurrentDmChannelKey === 'function' ? ROOT.getCurrentDmChannelKey() : 'global';
    const isGlobal = typeof ROOT.isGlobalDmChannelKey === 'function' ? ROOT.isGlobalDmChannelKey(currentKey) : selected.size === 0;
    const items = [];
    items.push(`<button type="button" class="dm-channel-btn ${isGlobal ? 'is-active' : ''}" data-dm-role="global"><span class="dm-channel-label">전체</span><span class="dm-channel-dot" style="display:none"></span></button>`);
    items.push(getDmRoomListButtonHtml());
    others.forEach((player) => {
      const active = !isGlobal && selected.has(player.uid);
      const label = (getAliasForUid(player.uid) || player.name).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const dotStyle = playerHasUnread(player.uid) ? '' : 'display:none';
      items.push(`<button type="button" class="dm-channel-btn ${active ? 'is-active' : ''}" data-dm-role="player" data-uid="${player.uid.replace(/"/g, '&quot;')}"><span class="dm-channel-label">${label}</span><span class="dm-channel-dot" style="${dotStyle}"></span></button>`);
    });
    list.innerHTML = items.join('');
    bindDmRoomListButton(list);
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
        const nextKey = typeof ROOT.getCurrentDmChannelKey === 'function' ? ROOT.getCurrentDmChannelKey() : '';
        markChannelSeen(nextKey);
        renderDmChannelButtons();
      });
      btn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const uid = String(btn.dataset.uid || '').trim();
        if (!uid) return;
        const current = getAliasForUid(uid);
        const input = window.prompt('표시 이름을 입력해주세요. (최대 8글자, 빈칸 입력 시 초기화)', current);
        if (input === null) return;
        setAliasForUid(uid, input);
        renderDmChannelButtons();
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
    items.push(getDmRoomListButtonHtml());
    channels.forEach((channel) => {
      const active = String(currentKey) === String(channel.channelKey || '');
      const label = getChannelLabelForViewer(channel, myId);
      const dotStyle = channelHasUnread(channel.channelKey) ? '' : 'display:none';
      items.push(`<button type="button" class="dm-channel-btn ${active ? 'is-active' : ''}" data-dm-role="channel" data-channel-key="${String(channel.channelKey || '').replace(/"/g, '&quot;')}"><span class="dm-channel-label">${label.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span><span class="dm-channel-dot" style="${dotStyle}"></span></button>`);
    });
    list.innerHTML = items.join('');
    bindDmRoomListButton(list);
    list.querySelector('[data-dm-role="global"]')?.addEventListener('click', () => {
      if (typeof ROOT.selectGlobalDmChannel === 'function') ROOT.selectGlobalDmChannel();
      renderDmChannelButtons();
    });
    list.querySelectorAll('[data-dm-role="channel"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const channelKey = String(btn.dataset.channelKey || '').trim();
        if (!channelKey) return;
        if (typeof ROOT.setCurrentDmChannelKey === 'function') ROOT.setCurrentDmChannelKey(channelKey);
        markChannelSeen(channelKey);
        renderDmChannelButtons();
      });
    });
  }

  function renderDmChannelButtons() {
    const bar = getDmBar();
    const list = getDmListWrap();
    if (!bar || !list) return;
    ensureUnreadSync();
    const visible = isChatTabActive();
    bar.style.display = visible ? 'inline-flex' : 'none';
    if (!visible) { list.innerHTML = ''; closeDmRoomListPanel(); return; }
    markChannelSeen(typeof ROOT.getCurrentDmChannelKey === 'function' ? ROOT.getCurrentDmChannelKey() : 'global');
    if (typeof ROOT.isDmGmView === 'function' && ROOT.isDmGmView()) renderGmButtons(list);
    else renderPlayerButtons(list);
  }

  function scheduleBootRender() {
    bindDmRoomListGlobalEvents();
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      try { renderDmChannelButtons(); } catch (e) {}
      if (tries >= 8) clearInterval(timer);
    }, 250);
  }

  function cleanupDmUnreadListener() {
    const runtime = getUnreadRuntime();
    try { if (typeof runtime.off === 'function') runtime.off(); } catch (e) {}
    runtime.off = null;
    runtime.roomCode = '';
    runtime.latestByChannel = {};
  }

  ROOT.cleanupDmUnreadListener = cleanupDmUnreadListener;
  ROOT.renderDmChannelButtons = renderDmChannelButtons;
  ROOT.refreshDmChannelButtons = renderDmChannelButtons;
  ROOT.getDmButtonAlias = getAliasForUid;
  ROOT.setDmButtonAlias = setAliasForUid;
  ROOT.markDmChannelSeen = markChannelSeen;
  document.addEventListener('itc:dm-channel-catalog-change', () => {
    try { renderDmChannelButtons(); } catch (e) {}
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleBootRender, { once: true });
  } else {
    scheduleBootRender();
  }
})();
