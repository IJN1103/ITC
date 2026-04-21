function loadJournals() {
  if (St.isGM) return _allJournals.slice();
  return _allJournals.filter(j =>
    String(j.ownerId || '') === String(St.myId || '') ||
    (Array.isArray(j.assignedTo) && j.assignedTo.includes(St.myId)) ||
    (j.assignedMap && j.assignedMap[St.myId] === true)
  );
}

function canEditJournalEntry(journal) {
  if (!journal) return false;
  return !!St.isGM || String(journal.ownerId || '') === String(St.myId || '') || (Array.isArray(journal.assignedTo) && journal.assignedTo.includes(St.myId)) || (journal.assignedMap && journal.assignedMap[St.myId] === true);
}

function canEditJournalById(journalId) {
  if (!journalId) return false;
  const journal = _allJournals.find(j => j.id === journalId) || null;
  return canEditJournalEntry(journal);
}

function canDeleteJournalEntry(journal) {
  return !!St.isGM;
}

function canDeleteJournalById(journalId) {
  if (!journalId) return false;
  const journal = _allJournals.find(j => j.id === journalId) || null;
  return canDeleteJournalEntry(journal);
}

function fetchJournalsFromFB() {
  if (!window._FB?.CONFIGURED || !St.roomCode) return;
  const { db, ref, get } = window._FB;
  get(ref(db, `rooms/${St.roomCode}/journals`)).then(snap => {
    const data = snap.val() || {};
    _allJournals = [];
    Object.entries(data).forEach(([id, j]) => {
      const normalized = normalizeIncomingJournal(j, id);
      if (normalized) _allJournals.push(normalized);
    });
    renderJournalList();
    saRefreshToolbar();
  }).catch(() => {});
}

function saveJournals(list) {
  const normalizedList = (Array.isArray(list) ? list : []).map(j => normalizeJournal(j)).filter(Boolean);
  if (!window._FB?.CONFIGURED) {
    localStorage.setItem(journalKey(), JSON.stringify(normalizedList));
    _allJournals = normalizedList;
    return;
  }
  const { db, ref, set } = window._FB;
  normalizedList.forEach(j => {
    const payload = buildJournalStoragePayload(j);
    if (!payload) return;
    set(ref(db, `rooms/${St.roomCode}/journals/${j.id}`), payload);
  });
}

function saveJournalFB(journal) {
  const normalized = normalizeJournal(journal);
  if (!normalized) return;
  const payload = buildJournalStoragePayload(normalized);
  if (!payload) return;

  if (window._FB?.CONFIGURED) {
    const { db, ref, update } = window._FB;
    const remotePayload = { ...payload };
    if (!remotePayload.createdAt) remotePayload.createdAt = getJournalServerTimestamp();
    remotePayload.updatedAt = getJournalServerTimestamp();
    upsertLocalJournal({ ...normalized, updatedAt: Date.now() });
    update(ref(db, `rooms/${St.roomCode}/journals/${normalized.id}`), remotePayload);
  } else {
    upsertLocalJournal(normalized);
    localStorage.setItem(journalKey(), JSON.stringify(_allJournals));
  }
}

function saveJournalSheetFB(journalId, sheetData, metaPatch = {}) {
  if (!journalId) return;

  const currentJournal = _allJournals.find(j => j.id === journalId) || null;
  const safeMetaPatch = sanitizeJournalMetaPatch(metaPatch, currentJournal);
  const safeSheetData = sanitizeStoredJournalValue(sheetData || {}, ['sheet']) || {};
  const safeAvatar = getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(
    safeMetaPatch.avatar || safeSheetData.avatar || currentJournal?.avatar || currentJournal?.sheet?.avatar || ''
  );
  if (safeAvatar) safeSheetData.avatar = safeAvatar;
  else if ('avatar' in safeSheetData) delete safeSheetData.avatar;

  if (window._FB?.CONFIGURED) {
    const { db, ref, update, set } = window._FB;
    const remoteMetaPatch = { ...safeMetaPatch, updatedAt: getJournalServerTimestamp() };
    if (!remoteMetaPatch.createdAt && !currentJournal?.createdAt) {
      remoteMetaPatch.createdAt = getJournalServerTimestamp();
    }
    const nextJournal = upsertLocalJournal({
      ...(currentJournal || {}),
      id: journalId,
      ...safeMetaPatch,
      sheet: safeSheetData,
    });
    if (nextJournal) {
      renderJournalList();
      saRefreshToolbar();
    }
    update(ref(db, `rooms/${St.roomCode}/journals/${journalId}`), remoteMetaPatch);
    set(ref(db, `rooms/${St.roomCode}/journals/${journalId}/sheet`), safeSheetData);
  } else {
    const nextJournal = upsertLocalJournal({
      ...(currentJournal || {}),
      id: journalId,
      ...safeMetaPatch,
      sheet: safeSheetData,
    });
    if (nextJournal) localStorage.setItem(journalKey(), JSON.stringify(_allJournals));
  }
}

function deleteJournalFB(id) {
  if (window._FB?.CONFIGURED) {
    const { db, ref, remove } = window._FB;
    remove(ref(db, `rooms/${St.roomCode}/journals/${id}`));
  } else {
    _allJournals = _allJournals.filter(j => j.id !== id);
    localStorage.setItem(journalKey(), JSON.stringify(_allJournals));
  }
}

function migrateLocalJournals() {
  if (!window._FB?.CONFIGURED || !St.roomCode) return;
  try {
    const localKey = 'itc_journals_' + St.myId + '_' + St.roomCode;
    const local = JSON.parse(localStorage.getItem(localKey) || '[]');
    if (local.length === 0) return;
    const { db, ref, set } = window._FB;
    local.forEach(j => {
      const normalized = normalizeJournal(j);
      const payload = buildJournalStoragePayload(normalized);
      if (!normalized || !payload) return;
      set(ref(db, `rooms/${St.roomCode}/journals/${normalized.id}`), payload);
    });
    localStorage.removeItem(localKey);
  } catch(e) {}
}

function setJournalListEmptyState(messageHtml) {
  const empty = document.getElementById('journal-empty');
  if (!empty) return;
  if (messageHtml) {
    empty.style.display = 'block';
    empty.innerHTML = messageHtml;
  } else {
    empty.style.display = 'none';
  }
}

function buildJournalListItem(j) {
  const div = document.createElement('div');
  div.className = 'journal-item';
  div.dataset.journalId = j.id;
  div.onclick = () => openSheet(j.id);
  const d = new Date(j.updatedAt || j.createdAt);
  const ds = `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  const pre = (j.body || '').replace(/\n/g,' ').slice(0,40) || '내용 없음';
  const initials = (j.title || '저').trim()[0]?.toUpperCase() || '?';
  const imgSrc = saGetAvatar(j.id) || '';
  const avatarHtml = imgSrc
    ? `<div class="journal-avatar"><img src="${imgSrc}" alt="avatar"></div>`
    : `<div class="journal-avatar">${esc(initials)}</div>`;
  const players = St.players || {};
  const grantedNames = (j.assignedTo || []).map(uid => players[uid]?.name).filter(Boolean);
  const grantTag = grantedNames.length > 0 ? `<span style="font-size:9px;color:var(--green);margin-left:4px">(권한: ${esc(grantedNames.join(', '))})</span>` : '';
  const canDelete = canDeleteJournalEntry(j);
  const delHtml = canDelete ? `<button class="journal-item-del" data-jid="${j.id}" onclick="event.stopPropagation();deleteJournalById(this.dataset.jid)" title="삭제">🗑</button>` : '';
  div.innerHTML = `${avatarHtml}<div class="journal-item-body">
    <div class="journal-item-title">${esc(j.title||'무제 저널')}${grantTag}</div>
    <div class="journal-item-meta"><span style="color:var(--dim);font-size:11px">${esc(pre)}${(j.body||'').length>40?'…':''}</span><span>${ds}</span></div>
  </div>${delHtml}`;
  return div;
}

function syncJournalListItem(journalId) {
  const container = document.getElementById('journal-list-container');
  if (!container) return;
  if (!St.roomCode) {
    container.querySelectorAll('.journal-item').forEach(el => el.remove());
    setJournalListEmptyState('방에 입장하면 저널을 볼 수 있어요.');
    saRefreshToolbar();
    return;
  }

  const visibleList = loadJournals();
  const orderedList = visibleList.slice().reverse();
  if (!orderedList.length) {
    container.querySelectorAll('.journal-item').forEach(el => el.remove());
    setJournalListEmptyState('저널이 없어요.<br>위 + 버튼으로 새 저널을 만들어보세요.');
    saRefreshToolbar();
    return;
  }

  const idx = orderedList.findIndex(item => item.id === journalId);
  const existing = container.querySelector(`.journal-item[data-journal-id="${journalId}"]`);

  if (idx === -1) {
    if (existing) existing.remove();
    setJournalListEmptyState('');
    saRefreshToolbar();
    return;
  }

  const nextItem = buildJournalListItem(orderedList[idx]);
  if (existing) existing.replaceWith(nextItem);

  const children = Array.from(container.querySelectorAll('.journal-item'));
  const targetIndex = existing ? idx : idx;
  const anchor = children[targetIndex] || null;
  if (!existing) {
    if (anchor) container.insertBefore(nextItem, anchor);
    else container.appendChild(nextItem);
  } else {
    const refreshedChildren = Array.from(container.querySelectorAll('.journal-item'));
    const currentIndex = refreshedChildren.indexOf(nextItem);
    if (currentIndex !== idx) {
      const desiredAnchor = refreshedChildren[idx] || null;
      if (desiredAnchor) container.insertBefore(nextItem, desiredAnchor);
      else container.appendChild(nextItem);
    }
  }

  setJournalListEmptyState('');
  saRefreshToolbar();
}

function removeJournalListItem(journalId) {
  const container = document.getElementById('journal-list-container');
  if (!container) return;
  const existing = container.querySelector(`.journal-item[data-journal-id="${journalId}"]`);
  if (existing) existing.remove();

  if (!St.roomCode) setJournalListEmptyState('방에 입장하면 저널을 볼 수 있어요.');
  else if (!loadJournals().length) setJournalListEmptyState('저널이 없어요.<br>위 + 버튼으로 새 저널을 만들어보세요.');
  else setJournalListEmptyState('');
  saRefreshToolbar();
}

function renderJournalList() {
  const container = document.getElementById('journal-list-container');
  if (!container) return;
  container.querySelectorAll('.journal-item').forEach(el => el.remove());
  if (!St.roomCode) {
    setJournalListEmptyState('방에 입장하면 저널을 볼 수 있어요.');
    return;
  }
  const list = loadJournals();
  if (!list.length) {
    setJournalListEmptyState('저널이 없어요.<br>위 + 버튼으로 새 저널을 만들어보세요.');
    return;
  }
  setJournalListEmptyState('');
  const frag = document.createDocumentFragment();
  list.slice().reverse().forEach(j => frag.appendChild(buildJournalListItem(j)));
  container.appendChild(frag);
  saRefreshToolbar();
}

function openJournalEditor(id) {
  const titleEl = document.getElementById('jd-title');
  const bodyEl  = document.getElementById('jd-body');
  const metaEl  = document.getElementById('jd-meta-date');
  const hintEl  = document.getElementById('jd-footer-hint');

  if (id) {
    const j = loadJournals().find(j => j.id === id);
    if (!j) return;
    _currentJournalId = id;
    titleEl.value = j.title || '';
    bodyEl.value  = j.body  || '';
    const d = new Date(j.updatedAt || j.createdAt);
    metaEl.textContent = `마지막 수정: ${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  } else {
    _currentJournalId = 'j_' + Date.now();
    titleEl.value = ''; bodyEl.value = '';
    metaEl.textContent = '새 저널';
  }

  if (hintEl) hintEl.textContent = '';
  const delBtn = document.querySelector('#journal-drawer .jd-del-btn');
  if (delBtn) delBtn.style.display = canDeleteJournalById(_currentJournalId) ? '' : 'none';
  const drawer = document.getElementById('journal-drawer');
  if (drawer) drawer.classList.add('open');
  setTimeout(() => {
    if (!titleEl || !titleEl.isConnected) return;
    titleEl.focus();
  }, 100);
}

function closeJournalDrawer() {
  document.getElementById('journal-drawer').classList.remove('open');
  renderJournalList();
}

function closeJournalEditor() { closeJournalDrawer(); }

function createNewJournal() {
  if (!St.roomCode) { showToast('방에 입장한 상태에서만 저널을 만들 수 있어요.'); return; }
  const newId = 'j_' + Date.now();
  _sheetJournalId = newId;
  _sheetIsNew = true;
  _sheetAvatarData = null;
  _jdAssignedTokenId = null;

  const existingWrap = document.getElementById('sh-skills-wrap');
  if (existingWrap) existingWrap.innerHTML = '';
  initSheetUI();

  ['name','player','job','age','height','sex','nationality','residence','birthplace','first_language'].forEach(k => {
    const el = document.getElementById('sh-'+k);
    if (el) el.value = '';
  });
  COC_STATS.forEach(s => {
    const el = document.getElementById('sh-'+s.key);
    if (el) { el.value = ''; updateStatHalf(s.key); }
  });
  ['hp','hp-max','san','san-max','mp','mp-max','luck','db','build'].forEach(k => {
    const el = document.getElementById('sh-'+k);
    if (el) el.value = '';
  });
  COC_SKILLS.forEach((sk, i) => {
    const ck = document.getElementById('sk-check-'+i);
    const val = document.getElementById('sk-val-'+i);
    const hlf = document.getElementById('sk-half-'+i);
    if (ck) ck.checked = false;
    if (val) val.value = sk.base;
    if (hlf) hlf.value = Math.floor(sk.base/2);
  });
  const notes = document.getElementById('sh-notes');
  if (notes) notes.value = '';
  document.getElementById('sh-unarmed-skill').value = '근접전(격투)';
  document.getElementById('sh-unarmed-dmg').value = '1d3+db';
  _combatRowCount = 0;
  const tbody = document.getElementById('sh-combat-rows');
  if (tbody) tbody.innerHTML = '';
  ['equipment','spending','cash','assets'].forEach(k => {
    const el = document.getElementById('sh-'+k);
    if (el) el.value = '';
  });
  ['appearance','personality','ideology','wounds','people','phobias','places','tomes','treasures','encounters'].forEach(k => {
    const el = document.getElementById('sh-bs-'+k);
    if (el) el.value = '';
  });

  refreshSheetAvatar(null, '?');
  refreshJournalTokenBar(null);
  _sheetAssignedTo = [];
  refreshSheetAssignBar(null);

  const hint = document.getElementById('sheet-hint');
  if (hint) hint.textContent = '';
  setSheetEditorMode(true);
  const delBtn = document.querySelector('.sheet-del-btn');
  if (delBtn) delBtn.style.display = 'none';

  const overlay = document.getElementById('sheet-overlay');
  if (overlay) overlay.classList.add('open');
  setTimeout(() => {
    const nameEl = document.getElementById('sh-name');
    if (nameEl && nameEl.isConnected) nameEl.focus();
  }, 150);
}

function saveJournalFromDrawer() {
  if (!St.roomCode) { showToast('방에 입장한 상태에서만 저널을 저장할 수 있어요.'); return; }
  const title = (document.getElementById('jd-title').value || '').trim() || '무제 저널';
  const body  = document.getElementById('jd-body').value;
  const hint  = document.getElementById('jd-footer-hint');
  const existing = _allJournals.find(j => j.id === _currentJournalId);
  if (existing && !canEditJournalEntry(existing)) { showToast('저널 접근 권한이 있는 플레이어만 저장할 수 있어요.'); return; }
  if (existing) {
    existing.title = title;
    existing.body = body;
    existing.updatedAt = Date.now();
    saveJournalFB({
      ...existing,
      id: _currentJournalId,
      ownerId: existing.ownerId || St.myId,
      title,
      body,
      createdAt: existing.createdAt || Date.now(),
      updatedAt: existing.updatedAt,
    });
  } else {
    saveJournalFB({ id: _currentJournalId, title, body, ownerId: St.myId, createdAt: Date.now(), updatedAt: Date.now() });
  }
  const d = new Date();
  document.getElementById('jd-meta-date').textContent =
    `마지막 수정: ${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  if (hint) { hint.textContent = '저장됐어요 ✓'; setTimeout(() => { if(hint) hint.textContent=''; }, 2000); }
}

function saveJournal() { saveJournalFromDrawer(); }

function deleteJournalFromDrawer() {
  if (!_currentJournalId) return;
  if (!canDeleteJournalById(_currentJournalId)) { showToast('저널 삭제는 GM만 할 수 있어요.'); return; }
  if (!confirm('이 저널을 삭제할까요?')) return;
  const _delId = _currentJournalId;
  deleteJournalFB(_delId);
  if (St.speakAsJournalId === _delId) { St.speakAsJournalId = null; saRefreshBtn(); }
  try { localStorage.removeItem('itc_av_' + _delId); } catch(e) {}
  delete _JAV[_delId];
  closeJournalDrawer();
}
function deleteJournal() { deleteJournalFromDrawer(); }

function deleteJournalById(id) {
  if (!id) return;
  if (!canDeleteJournalById(id)) { showToast('저널 삭제는 GM만 할 수 있어요.'); return; }
  if (!confirm('이 저널을 삭제할까요?')) return;
  deleteJournalFB(id);
  if (St.speakAsJournalId === id) { St.speakAsJournalId = null; saRefreshBtn(); }
  try { localStorage.removeItem('itc_av_' + id); } catch(e) {}
  delete _JAV[id];
  renderJournalList();
}

function deleteSheetJournal() {
  if (!_sheetJournalId) return;
  if (!canDeleteJournalById(_sheetJournalId)) { showToast('저널 삭제는 GM만 할 수 있어요.'); return; }
  if (!confirm('이 저널을 삭제할까요?')) return;
  const delId = _sheetJournalId;
  deleteJournalFB(delId);
  if (St.speakAsJournalId === delId) { St.speakAsJournalId = null; saRefreshBtn(); }
  try { localStorage.removeItem('itc_av_' + delId); } catch(e) {}
  delete _JAV[delId];
  closeSheet();
  renderJournalList();
}

function refreshSheetAssignBar(journal) {
  const bar = document.getElementById('sh-assign-bar');
  const ownerBar = document.getElementById('sh-owner-bar');
  const list = document.getElementById('sh-assign-list');
  if (!bar || !list) return;

  bar.style.display = St.isGM ? '' : 'none';

  if (ownerBar) ownerBar.style.display = 'none';

  if (!St.isGM) return;
  list.innerHTML = '';
  const players = St.players || {};
  Object.entries(players).forEach(([uid, p]) => {
    if (p.role === 'gm') return;
    const assigned = _sheetAssignedTo.includes(uid);
    const btn = document.createElement('button');
    btn.style.cssText = 'font:inherit;font-size:10px;padding:3px 10px;border-radius:4px;cursor:pointer;transition:.15s ease;border:1px solid '+(assigned?'rgba(90,158,114,.4)':'var(--border)')+';background:'+(assigned?'rgba(90,158,114,.12)':'var(--s3)')+';color:'+(assigned?'var(--green)':'var(--muted)');
    btn.textContent = (assigned ? '✓ ' : '') + p.name;
    btn.onclick = () => {
      if (assigned) {
        _sheetAssignedTo = _sheetAssignedTo.filter(x => x !== uid);
      } else {
        _sheetAssignedTo.push(uid);
      }
      refreshSheetAssignBar(journal);
    };
    list.appendChild(btn);
  });
  if (Object.keys(players).filter(uid => players[uid].role !== 'gm').length === 0) {
    list.innerHTML = '<span style="font-size:10px;color:var(--muted)">플레이어가 없습니다</span>';
  }
}

function getMyTokens() {
  const tokens = St.tokens || {};
  return Object.values(tokens).filter(t => {
    return t.ownerId === St.myId || St.isGM;
  });
}

function refreshJournalTokenBar(tokenId) {
  _jdAssignedTokenId = tokenId || null;
  const assignedEl = document.getElementById('sh-token-assigned');
  const assignBtn = document.getElementById('sh-token-assign-btn');
  const chipEl = document.getElementById('sh-token-chip');

  if (_jdAssignedTokenId && St.tokens[_jdAssignedTokenId]) {
    const t = St.tokens[_jdAssignedTokenId];
    const imgSrc = t.tokenImg || null;
    const thumb = imgSrc
      ? `<img class="sh-token-chip-img" src="${imgSrc}" alt="">`
      : `<div class="sh-token-chip-dot">${esc((t.name||'?')[0])}</div>`;
    chipEl.innerHTML = `${thumb}<span>${esc(t.name)}</span>`;
    assignedEl.style.display = 'flex';
    assignBtn.style.display = 'none';
  } else {
    _jdAssignedTokenId = null;
    assignedEl.style.display = 'none';
    assignBtn.style.display = '';
  }
}

function toggleJournalTokenList(e) {
  e.stopPropagation();
  const dd = document.getElementById('sh-token-dropdown');
  if (!dd) return;
  const isOpen = dd.classList.contains('open');
  if (isOpen) { dd.classList.remove('open'); return; }
  renderJournalTokenList();
  const btn = document.getElementById('sh-token-assign-btn') || document.getElementById('sh-token-assigned');
  if (btn) {
    const rect = btn.getBoundingClientRect();
    let top = rect.bottom + 4;
    let left = rect.left + rect.width / 2 - 110;
    if (left < 8) left = 8;
    if (left + 220 > window.innerWidth) left = window.innerWidth - 228;
    if (top + 200 > window.innerHeight) top = rect.top - 204;
    dd.style.top = top + 'px';
    dd.style.left = left + 'px';
  }
  dd.classList.add('open');
}

function renderJournalTokenList() {
  const dd = document.getElementById('sh-token-dropdown');
  if (!dd) return;
  dd.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'jtd-header';
  header.textContent = '토큰 선택';
  dd.appendChild(header);

  const myTokens = getMyTokens();
  if (myTokens.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'jtd-empty';
    empty.textContent = '할당 가능한 토큰이 없어요';
    dd.appendChild(empty);
    return;
  }

  myTokens.forEach(t => {
    const item = document.createElement('div');
    item.className = 'jtd-item' + (_jdAssignedTokenId === t.id ? ' selected' : '');
    const imgSrc = t.tokenImg || null;
    const thumb = imgSrc
      ? `<img class="jtd-item-img" src="${imgSrc}" alt="">`
      : `<div class="jtd-item-dot">${esc((t.name||'?')[0])}</div>`;
    const typeLabel = t.type === 'enemy' ? '적' : t.type === 'npc' ? 'NPC' : 'PC';
    item.innerHTML = `${thumb}<div class="jtd-item-info"><div class="jtd-item-name">${esc(t.name)}</div><div class="jtd-item-type">${typeLabel}</div></div>`;
    item.onclick = (e) => { e.stopPropagation(); assignTokenToJournal(t.id); dd.classList.remove('open'); };
    dd.appendChild(item);
  });
}

function assignTokenToJournal(tokenId) {
  _jdAssignedTokenId = tokenId;
  refreshJournalTokenBar(tokenId);
}

function clearJournalToken() {
  _jdAssignedTokenId = null;
  refreshJournalTokenBar(null);
}

document.addEventListener('click', () => {
  document.getElementById('sh-token-dropdown')?.classList.remove('open');
});

