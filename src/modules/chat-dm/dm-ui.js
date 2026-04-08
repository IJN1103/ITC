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

  function getOtherPlayerEntries() {
    const state = getStateRoot();
    const players = state.players || {};
    return Object.entries(players)
      .filter(([uid]) => String(uid) !== String(state.myId || ''))
      .map(([uid, player]) => ({
        uid: String(uid || '').trim(),
        name: String(player?.name || '').trim() || '플레이어',
      }))
      .filter((item) => item.uid);
  }

  function isChatTabActive() {
    return typeof _activeRightTab !== 'undefined' ? _activeRightTab === 'chat' : true;
  }

  function getSelectedParticipantIds() {
    return Array.isArray(ROOT.__DM_CHANNEL_STATE?.selectedParticipantIds)
      ? ROOT.__DM_CHANNEL_STATE.selectedParticipantIds.slice()
      : [];
  }

  function renderDmChannelButtons() {
    const bar = getDmBar();
    const list = getDmListWrap();
    if (!bar || !list) return;

    const state = getStateRoot();
    const visible = !!state.isGM && isChatTabActive();
    bar.style.display = visible ? '' : 'none';
    if (!visible) {
      list.innerHTML = '';
      return;
    }

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

  ROOT.renderDmChannelButtons = renderDmChannelButtons;
  ROOT.refreshDmChannelButtons = renderDmChannelButtons;
})();
