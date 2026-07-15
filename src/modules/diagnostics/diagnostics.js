/**
 * ITC TRPG — Runtime Diagnostics
 * Read-only diagnostics helpers for listener/state/error tracing.
 * This module must not alter gameplay state or Firebase data.
 */
(function initItcRuntimeDiagnostics() {
  'use strict';

  const STORAGE_KEY = 'ITC_DIAGNOSTICS_ENABLED';
  const MAX_EVENTS = 200;
  const MAX_EXECUTION_PATH = 80;
  const events = [];
  let enabled = false;
  let errorBound = false;
  let rejectionBound = false;

  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }

  function safeText(value, maxLength = 2000) {
    let text = '';
    try {
      if (value instanceof Error) text = value.stack || value.message || String(value);
      else if (typeof value === 'string') text = value;
      else text = JSON.stringify(value);
    } catch (e) {
      try { text = String(value); } catch (err) { text = '[unserializable]'; }
    }
    if (text.length > maxLength) return text.slice(0, maxLength) + '…';
    return text;
  }

  function pushEvent(type, detail = {}) {
    if (!enabled) return;
    events.push({ at: nowIso(), type: String(type || 'event'), detail });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  }

  function handleWindowError(event) {
    pushEvent('window-error', {
      message: safeText(event?.message || event?.error || ''),
      source: String(event?.filename || ''),
      line: Number(event?.lineno || 0),
      column: Number(event?.colno || 0),
    });
  }

  function handleUnhandledRejection(event) {
    pushEvent('unhandled-rejection', { reason: safeText(event?.reason || '') });
  }

  function bindErrorCapture() {
    if (!errorBound) {
      window.addEventListener('error', handleWindowError);
      errorBound = true;
    }
    if (!rejectionBound) {
      window.addEventListener('unhandledrejection', handleUnhandledRejection);
      rejectionBound = true;
    }
  }

  function unbindErrorCapture() {
    if (errorBound) {
      window.removeEventListener('error', handleWindowError);
      errorBound = false;
    }
    if (rejectionBound) {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      rejectionBound = false;
    }
  }

  function getState() {
    const st = window.St || {};
    return {
      roomCode: String(st.roomCode || ''),
      myId: String(st.myId || ''),
      myName: String(st.myName || ''),
      isGM: !!(st.isGM || st.role === 'gm'),
      activeMainTab: String(st.activeTab || window.aTab || ''),
      activeDmChannelKey: String(window._itcActiveChatChannelKey || 'global'),
      playerCount: st.players && typeof st.players === 'object' ? Object.keys(st.players).length : 0,
      firebaseConfigured: !!window._FB?.CONFIGURED,
      online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
      visibility: String(document.visibilityState || ''),
    };
  }

  function callStatus(fnName, fallback) {
    try {
      const fn = window[fnName];
      if (typeof fn === 'function') return fn();
    } catch (e) {
      return { error: safeText(e) };
    }
    return fallback;
  }

  function getExecutionPath() {
    return events
      .filter((entry) => {
        const type = String(entry?.type || '');
        return type.startsWith('chat-')
          || type.startsWith('listener-')
          || type.startsWith('popout-')
          || type.startsWith('firebase-')
          || type.startsWith('room-');
      })
      .slice(-MAX_EXECUTION_PATH);
  }

  function buildWarnings(chat, popoutWatchers) {
    const warnings = [];
    try {
      const listenerCount = Number(chat?.activeChatChannelListenerCount || 0);
      const channelKey = String(chat?.activeChannelKey || 'global');
      const expectedMax = channelKey === 'global' ? 6 : 3;
      if (listenerCount > expectedMax) {
        warnings.push({
          code: 'active-chat-listener-count-high',
          channelKey,
          listenerCount,
          expectedMax,
        });
      }
    } catch (e) {}

    try {
      const watcherKeys = (Array.isArray(popoutWatchers) ? popoutWatchers : [])
        .map((item) => `${String(item?.roomCode || '')}:${String(item?.channelKey || '')}`);
      const duplicates = watcherKeys.filter((key, index) => key && watcherKeys.indexOf(key) !== index);
      if (duplicates.length) {
        warnings.push({
          code: 'duplicate-popout-watcher',
          watcherKeys: Array.from(new Set(duplicates)),
        });
      }
    } catch (e) {}

    return warnings;
  }

  function getStatus() {
    const chat = callStatus('itcChatDebugReport', null);
    const popoutWatchers = callStatus('getPopoutChatWatcherDebugStatus', []);
    const report = {
      generatedAt: nowIso(),
      diagnosticsEnabled: enabled,
      state: getState(),
      chat,
      popout: callStatus('getPopoutChatSyncDebugStatus', null),
      popoutWatchers,
      bgm: callStatus('getBgmDebugStatus', null),
      warnings: buildWarnings(chat, popoutWatchers),
      recentExecutionPath: getExecutionPath(),
      recentEvents: events.slice(),
    };
    try { console.log('[ITC_DIAGNOSTICS]', report); } catch (e) {}
    return report;
  }

  function start() {
    enabled = true;
    bindErrorCapture();
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch (e) {}
    pushEvent('diagnostics-started', getState());
    return getStatus();
  }

  function stop() {
    pushEvent('diagnostics-stopped', getState());
    enabled = false;
    unbindErrorCapture();
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    return { diagnosticsEnabled: false, capturedEventCount: events.length };
  }

  function clear() {
    events.length = 0;
    return { cleared: true };
  }

  function exportReport() {
    const report = getStatus();
    const room = report.state.roomCode || 'no-room';
    const filename = `itc-diagnostics-${room}-${Date.now()}.json`;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { filename, eventCount: report.recentEvents.length };
  }

  window.ITCDiagnostics = Object.freeze({
    getStatus,
    start,
    stop,
    clear,
    exportReport,
    record(type, detail) { pushEvent(type, detail || {}); },
    isEnabled() { return enabled; },
    getEventCount() { return events.length; },
  });
  window.getItcDiagnosticStatus = getStatus;
  window.startItcDiagnostics = start;
  window.stopItcDiagnostics = stop;
  window.clearItcDiagnosticLog = clear;
  window.exportItcDiagnosticReport = exportReport;

  try {
    enabled = localStorage.getItem(STORAGE_KEY) === 'true';
  } catch (e) {
    enabled = false;
  }
  if (enabled) bindErrorCapture();
})();
