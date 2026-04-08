(function () {
  const ROOT = typeof window !== 'undefined' ? window : globalThis;

  function getStateRoot() {
    if (ROOT.St && typeof ROOT.St === 'object') return ROOT.St;
    ROOT.St = {};
    return ROOT.St;
  }

  function getDmBar() {
    return document.getElementById('dm-channel-bar');
  }

  function getDmListWrap() {
    return document.getElementById('dm-channel-list');
  }

  function isChatTabActive() {
    return typeof _activeRightTab !== 'undefined' ? _activeRightTab === 'chat' : true;
  }

  function getOtherPlayerEntries() {
    const state = getStateRoot();
    const players = state.players || {};
    return Object.entries(players)
      .filter(([uid, player]) => {
        if (String(uid) === String(state.myId || '')) return false;
        return String(player?.role || '').trim().toLowerCase() !== 'gm';
      })
      .map(([uid, player]) => ({
        uid: String(uid || '').trim(),
        name: String(player?.name || '').trim() || '플레이어',
      }))
      .filter((item) => item.uid);
  }

  function getSelectedParticipantIds() {
    return Array.isArray(ROOT.__DM_CHANNEL_STATE?.selectedParticipantIds)
      ? ROOT.__DM_CHANNEL_STATE.selectedParticipantIds.slice()
      : [];
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
    const isGlobal = typeof ROOT.isGlobalDmChannelKey === 'function'
      ? ROOT.isGlobalDmChannelKey(typeof ROOT.getCurrentDmChannelKey === 'function' ? ROOT.getCurrentDmChannelKey() : 'global')
      : selected.size === 0;

    const items = [];
    items.push(`
      <button type="button" class="dm-channel-btn ${isGlobal ? 'is-active' : ''}" data-dm-role="global">
        <span class="dm-channel-label">전체</span>
        <span class="dm-channel-dot" style="display:none"></span>
      </button>
    `);

    others.forEach((player) => {
      const active = !isGlobal && selected.has(player.uid);
      items.push(`
        <button type="button" class="dm-channel-btn ${active ? 'is-active' : ''}" data-dm-role="player" data-uid="${player.uid.replace(/"/g, '&quot;')}">
          <span class="dm-channel-label">${player.name.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
          <span class="dm-channel-dot" style="display:none"></span>
        </button>
      `);
    });

    list.innerHTML = items.join('');

    list.querySelectorAll('.dm-channel-btn[data-dm-role="global"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (typeof ROOT.selectGlobalDmChannel === 'function') ROOT.selectGlobalDmChannel();
        renderDmChannelButtons();
      });
    });

    list.querySelectorAll('.dm-channel-btn[data-dm-role="player"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const uid = String(btn.dataset.uid || '').trim();
        if (!uid) return;
        const next = new Set(getSelectedParticipantIds());
        if (next.has(uid)) next.delete(uid); else next.add(uid);
        const ids = Array.from(next);
        if (typeof ROOT.selectDmParticipants === 'function') ROOT.selectDmParticipants(ids);
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
    items.push(`
      <button type="button" class="dm-channel-btn ${String(currentKey) === 'global' ? 'is-active' : ''}" data-dm-role="global">
        <span class="dm-channel-label">전체</span>
        <span class="dm-channel-dot" style="display:none"></span>
      </button>
    `);

    channels.forEach((channel) => {
      const active = String(currentKey) === String(channel.channelKey || '');
      const label = getChannelLabelForViewer(channel, myId);
      items.push(`
        <button type="button" class="dm-channel-btn ${active ? 'is-active' : ''}" data-dm-role="channel" data-channel-key="${String(channel.channelKey || '').replace(/"/g, '&quot;')}">
          <span class="dm-channel-label">${label.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
          <span class="dm-channel-dot" style="display:none"></span>
        </button>
      `);
    });

    list.innerHTML = items.join('');

    list.querySelectorAll('.dm-channel-btn[data-dm-role="global"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (typeof ROOT.selectGlobalDmChannel === 'function') ROOT.selectGlobalDmChannel();
        renderDmChannelButtons();
      });
    });

    list.querySelectorAll('.dm-channel-btn[data-dm-role="channel"]').forEach((btn) => {
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

    const visible = isChatTabActive();
    bar.style.display = visible ? 'flex' : 'none';
    if (!visible) {
      list.innerHTML = '';
      return;
    }

    if (typeof ROOT.isDmGmView === 'function' && ROOT.isDmGmView()) renderGmButtons(list);
    else renderPlayerButtons(list);
  }

  ROOT.renderDmChannelButtons = renderDmChannelButtons;
  ROOT.refreshDmChannelButtons = renderDmChannelButtons;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(renderDmChannelButtons, 0), { once: true });
  } else {
    setTimeout(renderDmChannelButtons, 0);
  }
})();
