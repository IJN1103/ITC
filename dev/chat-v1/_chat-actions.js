/* ==========================================================================
 * CHAT SECTION: MESSAGE ACTIONS
 * PC 수정/삭제 버튼, 모바일 long-press 액션 시트, 메시지 수정/삭제, 텍스트 포맷팅
 * ========================================================================== */

function addMsgActions(div, uid, msgKey, channel, text, type) {
  if (!msgKey) return;
  if (type === 'system' || type === 'sys') return;
  const isMine = uid === St.myId;
  const isGM = St.isGM;
  if (!isMine && !isGM) return;
  div.dataset.msgKey = msgKey;
  div.dataset.channel = channel;
  div.dataset.msgText = text;
  const wrap = document.createElement('div');
  wrap.className = 'msg-actions';
  const canEdit = type !== 'dice' && type !== 'image' && type !== 'speak-as-image';
  const canMobileEdit = !!(canEdit && isMine);
  div.dataset.mobileCanEdit = canMobileEdit ? '1' : '0';
  div.dataset.mobileCanDelete = '1';
  if (canMobileEdit) {
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-act-btn';
    editBtn.textContent = '수정';
    editBtn.onclick = (e) => { e.stopPropagation(); editMsg(div); };
    wrap.appendChild(editBtn);
  }
  const delBtn = document.createElement('button');
  delBtn.className = 'msg-act-btn danger';
  delBtn.textContent = '삭제';
  delBtn.onclick = (e) => { e.stopPropagation(); deleteMsg(div); };
  wrap.appendChild(delBtn);
  div.appendChild(wrap);
  bindMobileMsgActions(div);
}

function isMobileMsgActionMode() {
  try {
    return window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch (e) {
    return false;
  }
}

function getTouchPoint(e) {
  const t = e?.touches?.[0] || e?.changedTouches?.[0] || e;
  return { x: Number(t?.clientX || 0), y: Number(t?.clientY || 0) };
}

function bindMobileMsgActions(div) {
  if (!div || div.dataset.mobileActionBound === '1') return;
  div.dataset.mobileActionBound = '1';

  let longPressTimer = 0;
  let startX = 0;
  let startY = 0;
  let moved = false;

  const clearLongPress = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = 0;
    }
  };

  const isIgnoredTarget = (target) => {
    if (!target) return false;
    return !!target.closest?.('button, input, textarea, select, a, .msg-actions, .msg-mobile-action-sheet, .msg-text.editing');
  };

  div.addEventListener('touchstart', (e) => {
    if (!isMobileMsgActionMode()) return;
    if (isIgnoredTarget(e.target)) return;
    clearLongPress();
    const pt = getTouchPoint(e);
    startX = pt.x;
    startY = pt.y;
    moved = false;
    longPressTimer = setTimeout(() => {
      longPressTimer = 0;
      if (moved || !div.isConnected) return;
      openMobileMsgActionSheet(div);
    }, 560);
  }, { passive: true });

  div.addEventListener('touchmove', (e) => {
    if (!longPressTimer) return;
    const pt = getTouchPoint(e);
    if (Math.abs(pt.x - startX) > 12 || Math.abs(pt.y - startY) > 12) {
      moved = true;
      clearLongPress();
    }
  }, { passive: true });

  div.addEventListener('touchend', clearLongPress, { passive: true });
  div.addEventListener('touchcancel', clearLongPress, { passive: true });

  div.addEventListener('contextmenu', (e) => {
    if (!isMobileMsgActionMode()) return;
    if (isIgnoredTarget(e.target)) return;
    e.preventDefault();
    clearLongPress();
    openMobileMsgActionSheet(div);
  });
}

function closeMobileMsgActionSheet() {
  const layer = document.getElementById('msg-mobile-action-layer');
  if (layer) layer.remove();
}

function openMobileMsgActionSheet(div) {
  if (!div || !div.isConnected || !isMobileMsgActionMode()) return;
  const canEdit = div.dataset.mobileCanEdit === '1';
  const canDelete = div.dataset.mobileCanDelete === '1';
  if (!canEdit && !canDelete) return;

  closeMobileMsgActionSheet();

  const layer = document.createElement('div');
  layer.id = 'msg-mobile-action-layer';
  layer.className = 'msg-mobile-action-layer';
  layer.innerHTML = `
    <div class="msg-mobile-action-backdrop" data-close="1"></div>
    <div class="msg-mobile-action-sheet" role="dialog" aria-modal="true" aria-label="채팅 메시지 작업">
      <div class="msg-mobile-action-title">메시지 작업</div>
      <div class="msg-mobile-action-list"></div>
      <button type="button" class="msg-mobile-action-btn muted" data-close="1">닫기</button>
    </div>
  `;

  const list = layer.querySelector('.msg-mobile-action-list');
  if (canEdit) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'msg-mobile-action-btn';
    editBtn.textContent = '수정';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMobileMsgActionSheet();
      editMsg(div);
    });
    list.appendChild(editBtn);
  }

  if (canDelete) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'msg-mobile-action-btn danger';
    delBtn.textContent = '삭제';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMobileMsgActionSheet();
      deleteMsg(div);
    });
    list.appendChild(delBtn);
  }

  layer.addEventListener('click', (e) => {
    if (e.target?.dataset?.close === '1') closeMobileMsgActionSheet();
  });
  document.body.appendChild(layer);
}

function editMsg(div) {
  const key = div.dataset.msgKey;
  const channel = div.dataset.channel || 'chat';
  const oldText = div.dataset.msgText || '';
  const textEl = div.querySelector('.msg-text');
  if (!textEl || textEl.contentEditable === 'true') return;

  textEl.textContent = oldText;
  textEl.contentEditable = 'true';
  textEl.classList.add('editing');
  textEl.focus();

  const range = document.createRange();
  range.selectNodeContents(textEl);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function finishEdit() {
    textEl.contentEditable = 'false';
    textEl.classList.remove('editing');
    const newText = textEl.textContent.trim();
    if (!newText) { textEl.innerHTML = fmtText(oldText); showToast('빈 메시지는 입력할 수 없어요.'); return; }
    if (newText === oldText) { textEl.innerHTML = fmtText(oldText); return; }
    div.dataset.msgText = newText;
    textEl.innerHTML = fmtText(newText);
    if (window._FB?.CONFIGURED) {
      const { db, ref, update } = window._FB;
      update(ref(db, `rooms/${St.roomCode}/${channel}/${key}`), { text: newText, edited: true });
    }
  }

  textEl.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEdit(); }
    if (e.key === 'Escape') { textEl.innerHTML = fmtText(oldText); textEl.contentEditable = 'false'; textEl.classList.remove('editing'); }
  };
  textEl.onblur = () => finishEdit();
}

async function deleteMsg(div) {
  const key = String(div?.dataset?.msgKey || '').trim();
  const channel = String(div?.dataset?.channel || 'chat').trim() || 'chat';
  if (!key) return;
  if (!confirm('이 메시지를 삭제할까요?')) return;
  const actionButtons = Array.from(div.querySelectorAll('.msg-act-btn'));
  actionButtons.forEach((btn) => { btn.disabled = true; });

  try {
    if (window._FB?.CONFIGURED) {
      const { db, ref, remove } = window._FB;
      if (!db || !ref || typeof remove !== 'function') throw new Error('Firebase remove helper missing');
      if (!St.roomCode) throw new Error('roomCode missing');
      await remove(ref(db, `rooms/${St.roomCode}/${channel}/${key}`));

      if (channel === 'chat') {
        const activeDmKey = String(window._itcActiveChatChannelKey || '').trim();
        if (activeDmKey && activeDmKey !== 'global') {
          try { await remove(ref(db, `rooms/${St.roomCode}/dmMessageIndex/${activeDmKey}/${key}`)); } catch (e) {}
          try { await remove(ref(db, `rooms/${St.roomCode}/dmChats/${activeDmKey}/messages/${key}`)); } catch (e) {}
        }
      }
    }

    if (channel === 'casual' && typeof removeCasualMsg === 'function') removeCasualMsg(key);
    else if (typeof removeChatMsg === 'function') removeChatMsg(key, channel);
  } catch (err) {
    console.error('deleteMsg failed', err);
    showToast('메시지 삭제에 실패했어요. 새로고침 후 다시 시도해주세요.');
    actionButtons.forEach((btn) => { btn.disabled = false; });
  }
}

function fmtText(str) {
  let s = esc(str);
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/\*(.+?)\*/g, '<i>$1</i>');
  s = s.replace(/\n/g, '<br>');
  return s;
}
