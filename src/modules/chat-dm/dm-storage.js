(function () {
  const ROOT = typeof window !== 'undefined' ? window : globalThis;

  function normalizeRoomCode(roomCode) {
    return String(roomCode || ROOT.St?.roomCode || sessionStorage.getItem('itc_session_code') || '').trim();
  }

  function normalizeChannelKey(channelKey) {
    const key = String(channelKey || (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global') || 'global').trim();
    return key || 'global';
  }

  function isGlobal(channelKey) {
    return typeof ROOT.isGlobalDmChannelKey === 'function'
      ? ROOT.isGlobalDmChannelKey(channelKey)
      : String(channelKey || '').trim() === 'global';
  }

  function getDmMetaPath(roomCode, channelKey) {
    const safeRoomCode = normalizeRoomCode(roomCode);
    const safeChannelKey = normalizeChannelKey(channelKey);
    if (!safeRoomCode || isGlobal(safeChannelKey)) return '';
    return `rooms/${safeRoomCode}/dmChats/${safeChannelKey}/meta`;
  }

  function getDmMessagesPath(roomCode, channelKey) {
    const safeRoomCode = normalizeRoomCode(roomCode);
    const safeChannelKey = normalizeChannelKey(channelKey);
    if (!safeRoomCode) return '';
    if (isGlobal(safeChannelKey)) return `rooms/${safeRoomCode}/chat`;
    return `rooms/${safeRoomCode}/dmChats/${safeChannelKey}/messages`;
  }

  function getDmRootPath(roomCode, channelKey) {
    const safeRoomCode = normalizeRoomCode(roomCode);
    const safeChannelKey = normalizeChannelKey(channelKey);
    if (!safeRoomCode || isGlobal(safeChannelKey)) return '';
    return `rooms/${safeRoomCode}/dmChats/${safeChannelKey}`;
  }

  ROOT.getDmMetaPath = getDmMetaPath;
  ROOT.getDmMessagesPath = getDmMessagesPath;
  ROOT.getDmRootPath = getDmRootPath;
})();
