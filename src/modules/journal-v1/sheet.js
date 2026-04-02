/**
 * ITC TRPG — Character Sheet (CoC)
 * 캐릭터 시트 UI, 빠른 시트, 스탯/스킬, 전투, 저장
 */

function refreshSheetAssignBar(journal) {
  const bar = document.getElementById('sh-assign-bar');
  const ownerBar = document.getElementById('sh-owner-bar');
  const list = document.getElementById('sh-assign-list');
  if (!bar || !list) return;

  bar.style.display = St.isGM ? '' : 'none';

  if (ownerBar) {
    if (journal?.ownerId) {
      const players = St.players || {};
      const owner = players[journal.ownerId];
      ownerBar.textContent = `소유: ${owner?.name || '알 수 없음'}`;
      ownerBar.style.display = '';
    } else {
      ownerBar.style.display = 'none';
    }
  }

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


function initSheetUI() {
  const grid = document.getElementById('sh-stats-grid');
  if (grid && !grid.children.length) {
    COC_STATS.forEach(s => {
      const div = document.createElement('div');
      div.className = 'stat-card';
      div.innerHTML = `<div class="stat-name">${s.name}</div>
        <input class="stat-val" id="sh-${s.key}" type="number" min="0" max="99" placeholder="0" oninput="updateStatHalf('${s.key}')">
        <div class="stat-half" id="sh-${s.key}-half">½ — / ⅕ —</div>`;
      grid.appendChild(div);
    });
  }

  const wrap = document.getElementById('sh-skills-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const colHead = () => {
    const h = document.createElement('div');
    h.className = 'skill-col-head';
    h.innerHTML = '<span></span><span>기능명</span><span>기본</span><span>현재</span><span>½값</span>';
    return h;
  };

  const perCol = Math.ceil(COC_SKILLS.length / 3);
  [0, 1, 2].forEach(ci => {
    const col = document.createElement('div');
    col.className = 'skill-col-wrap';
    col.appendChild(colHead());
    COC_SKILLS.slice(ci * perCol, (ci + 1) * perCol).forEach((sk, li) => {
      const i = ci * perCol + li;
      const row = document.createElement('div');
      row.className = 'skill-row';
      row.innerHTML = `
        <input type="checkbox" class="skill-check" id="sk-check-${i}">
        <span class="skill-name" title="${sk.name}">${sk.name}</span>
        <span class="skill-base">${sk.base}</span>
        <input class="skill-input" id="sk-val-${i}" type="number" min="0" max="99" value="${sk.base}">
        <input class="skill-input half-val" id="sk-half-${i}" type="number" min="0" max="99" value="${Math.floor(sk.base / 2)}">`;
      col.appendChild(row);
    });
    wrap.appendChild(col);
  });
}

function updateStatHalf(key) {
  const val = parseInt(document.getElementById('sh-'+key)?.value) || 0;
  const el  = document.getElementById('sh-'+key+'-half');
  if (el) el.textContent = `½ ${Math.floor(val/2)} / ⅕ ${Math.floor(val/5)}`;
}



function getQuickSheetModalEl() { return document.getElementById('sheet-modal'); }

function clampQuickSheetRect(x, y, width, height) {
  const pad = 16;
  const minWidth = 420;
  const minHeight = 320;
  const maxWidth = Math.max(minWidth, window.innerWidth - pad * 2);
  const maxHeight = Math.max(minHeight, window.innerHeight - pad * 2);
  const safeWidth = Math.max(minWidth, Math.min(width, maxWidth));
  const safeHeight = Math.max(minHeight, Math.min(height, maxHeight));
  const maxX = Math.max(pad, window.innerWidth - pad - safeWidth);
  const maxY = Math.max(pad, window.innerHeight - pad - safeHeight);
  return {
    x: Math.min(Math.max(x, pad), maxX),
    y: Math.min(Math.max(y, pad), maxY),
    width: safeWidth,
    height: safeHeight,
  };
}

function applyQuickSheetState() {
  const overlay = document.getElementById('sheet-overlay');
  const modal = getQuickSheetModalEl();
  if (!overlay || !modal || !overlay.classList.contains('quick-view')) return;

  const rect = modal.getBoundingClientRect();
  const fallbackWidth = _quickSheetState.width ?? rect.width;
  const fallbackHeight = _quickSheetState.height ?? rect.height;
  const fallbackX = _quickSheetState.x ?? rect.left;
  const fallbackY = _quickSheetState.y ?? rect.top;
  const next = clampQuickSheetRect(fallbackX, fallbackY, fallbackWidth, fallbackHeight);

  _quickSheetState.x = next.x;
  _quickSheetState.y = next.y;
  _quickSheetState.width = next.width;
  _quickSheetState.height = next.height;

  modal.style.left = `${next.x}px`;
  modal.style.top = `${next.y}px`;
  modal.style.right = 'auto';
  modal.style.bottom = 'auto';
  modal.style.width = `${next.width}px`;
  modal.style.height = `${next.height}px`;
}

function resetQuickSheetStateFromLayout() {
  const modal = getQuickSheetModalEl();
  if (!modal) return;
  modal.style.left = '';
  modal.style.top = '';
  modal.style.right = '';
  modal.style.bottom = '';
  modal.style.width = '';
  modal.style.height = '';
  const rect = modal.getBoundingClientRect();
  _quickSheetState.x = rect.left;
  _quickSheetState.y = rect.top;
  _quickSheetState.width = rect.width;
  _quickSheetState.height = rect.height;
  applyQuickSheetState();
}

function initQuickSheetInteractions() {
  if (_quickSheetInteractionsBound) return;
  const modal = getQuickSheetModalEl();
  const head = document.querySelector('.sheet-head');
  if (!modal || !head) return;
  _quickSheetInteractionsBound = true;

  head.addEventListener('pointerdown', (event) => {
    const overlay = document.getElementById('sheet-overlay');
    if (!_sheetQuickViewMode || !overlay?.classList.contains('quick-view')) return;
    if (event.button !== 0) return;
    if (event.target.closest('button, input, textarea, select, label, a')) return;

    const rect = modal.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = _quickSheetState.x ?? rect.left;
    const originY = _quickSheetState.y ?? rect.top;

    const onMove = (moveEvent) => {
      const next = clampQuickSheetRect(
        originX + (moveEvent.clientX - startX),
        originY + (moveEvent.clientY - startY),
        _quickSheetState.width ?? rect.width,
        _quickSheetState.height ?? rect.height
      );
      _quickSheetState.x = next.x;
      _quickSheetState.y = next.y;
      applyQuickSheetState();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  modal.querySelectorAll('.sheet-resize-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => {
      const overlay = document.getElementById('sheet-overlay');
      if (!_sheetQuickViewMode || !overlay?.classList.contains('quick-view')) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const dir = handle.dataset.resizeDir || '';
      const rect = modal.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startRect = {
        x: _quickSheetState.x ?? rect.left,
        y: _quickSheetState.y ?? rect.top,
        width: _quickSheetState.width ?? rect.width,
        height: _quickSheetState.height ?? rect.height,
      };

      const onMove = (moveEvent) => {
        let nextX = startRect.x;
        let nextY = startRect.y;
        let nextWidth = startRect.width;
        let nextHeight = startRect.height;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        if (dir.includes('e')) nextWidth = startRect.width + dx;
        if (dir.includes('s')) nextHeight = startRect.height + dy;
        if (dir.includes('w')) { nextWidth = startRect.width - dx; nextX = startRect.x + dx; }
        if (dir.includes('n')) { nextHeight = startRect.height - dy; nextY = startRect.y + dy; }

        const clamped = clampQuickSheetRect(nextX, nextY, nextWidth, nextHeight);

        if (dir.includes('w') && !dir.includes('e')) {
          clamped.x = startRect.x + (startRect.width - clamped.width);
          clamped.x = Math.max(16, clamped.x);
        }
        if (dir.includes('n') && !dir.includes('s')) {
          clamped.y = startRect.y + (startRect.height - clamped.height);
          clamped.y = Math.max(16, clamped.y);
        }

        const finalRect = clampQuickSheetRect(clamped.x, clamped.y, clamped.width, clamped.height);
        _quickSheetState.x = finalRect.x;
        _quickSheetState.y = finalRect.y;
        _quickSheetState.width = finalRect.width;
        _quickSheetState.height = finalRect.height;
        applyQuickSheetState();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  });

  window.addEventListener('resize', () => {
    if (!_sheetQuickViewMode) return;
    applyQuickSheetState();
  });
}

function getQuickJournalMenuEl() { return document.getElementById('map-quick-journal-menu'); }
function getQuickJournalButtonEl() { return document.getElementById('map-quick-journal-btn'); }

function closeQuickJournalMenu() {
  const menu = getQuickJournalMenuEl();
  if (!menu) return;
  menu.style.display = 'none';
  menu.innerHTML = '';
}

function renderQuickJournalMenu() {
  const menu = getQuickJournalMenuEl();
  if (!menu) return;
  const list = loadJournals();
  if (!list.length) {
    menu.innerHTML = '<div class="map-quick-journal-empty">열 수 있는 저널이 없어요.</div>';
    menu.style.display = 'block';
    return;
  }
  menu.innerHTML = list.map(j => `<button type="button" class="map-quick-journal-item" data-jid="${esc(j.id)}">${esc(j.title || '무제 저널')}</button>`).join('');
  menu.querySelectorAll('.map-quick-journal-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeQuickJournalMenu();
      openQuickJournalSheet(btn.dataset.jid || '');
    });
  });
  menu.style.display = 'block';
}

function openQuickJournalSheet(journalId) {
  if (!journalId) return;
  _sheetQuickViewMode = true;
  openSheet(journalId);
  const overlay = document.getElementById('sheet-overlay');
  if (overlay) overlay.classList.add('quick-view');
  initQuickSheetInteractions();
  resetQuickSheetStateFromLayout();
  const btn = getQuickJournalButtonEl();
  if (btn) btn.classList.add('is-open');
}

function toggleQuickJournalView(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const overlay = document.getElementById('sheet-overlay');
  const menu = getQuickJournalMenuEl();
  const isQuickOpen = !!(overlay && overlay.classList.contains('open') && overlay.classList.contains('quick-view'));
  if (isQuickOpen) {
    closeSheet();
    return;
  }
  if (menu && menu.style.display !== 'none' && menu.innerHTML.trim()) {
    closeQuickJournalMenu();
    return;
  }
  if (St.speakAsJournalId) {
    openQuickJournalSheet(St.speakAsJournalId);
    return;
  }
  renderQuickJournalMenu();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#map-quick-journal-btn') || e.target.closest('#map-quick-journal-menu')) return;
  closeQuickJournalMenu();
});

function openSheet(journalId) {
  _sheetIsNew = false;
  const existingWrap = document.getElementById('sh-skills-wrap');
  if (existingWrap) existingWrap.innerHTML = '';
  initSheetUI();
  _sheetJournalId = journalId;
  const list = loadJournals();
  const j    = list.find(x => x.id === journalId);
  const data = j?.sheet || {};

  ['name','player','job','age','residence','birthplace'].forEach(k => {
    const el = document.getElementById('sh-'+k);
    if (el) el.value = data[k] || '';
  });

  COC_STATS.forEach(s => {
    const el = document.getElementById('sh-'+s.key);
    if (el) { el.value = data[s.key] || ''; updateStatHalf(s.key); }
  });

  ['hp','hp-max','san','san-max','mp','mp-max','luck','db','build'].forEach(k => {
    const el = document.getElementById('sh-'+k);
    if (el) el.value = data[k.replace('-','_')] || '';
  });

  COC_SKILLS.forEach((sk, i) => {
    const ck  = document.getElementById('sk-check-'+i);
    const val = document.getElementById('sk-val-'+i);
    const hlf = document.getElementById('sk-half-'+i);
    const d   = data.skills?.[i] || {};
    if (ck)  ck.checked    = d.checked || false;
    if (val) val.value     = d.val  !== undefined ? d.val  : sk.base;
    if (hlf) hlf.value     = d.half !== undefined ? d.half : Math.floor(sk.base/2);
  });

  const notes = document.getElementById('sh-notes');
  if (notes) notes.value = data.notes || '';

  document.getElementById('sh-unarmed-skill').value = data.unarmed_skill || '근접전(격투)';
  document.getElementById('sh-unarmed-dmg').value   = data.unarmed_dmg   || '1d3+db';
  _combatRowCount = 0;
  const tbody = document.getElementById('sh-combat-rows');
  if (tbody) tbody.innerHTML = '';
  (data.combat_rows || []).forEach(row => {
    addCombatRow();
    const i = _combatRowCount - 1;
    document.getElementById('sh-w-name-'+i).value  = row.name  || '';
    document.getElementById('sh-w-skill-'+i).value = row.skill || '';
    document.getElementById('sh-w-dmg-'+i).value   = row.dmg   || '';
    document.getElementById('sh-w-range-'+i).value = row.range || '';
    document.getElementById('sh-w-atk-'+i).value   = row.atk   || '';
    document.getElementById('sh-w-ammo-'+i).value  = row.ammo  || '';
    document.getElementById('sh-w-mal-'+i).value   = row.mal   || '';
  });

  const eq = document.getElementById('sh-equipment'); if (eq) eq.value = data.equipment || '';
  const sp = document.getElementById('sh-spending');  if (sp) sp.value = data.spending  || '';
  const ca = document.getElementById('sh-cash');      if (ca) ca.value = data.cash      || '';
  const as = document.getElementById('sh-assets');    if (as) as.value = data.assets    || '';

  ['appearance','personality','ideology','wounds','people','phobias','places','tomes','treasures','encounters'].forEach(k => {
    const el = document.getElementById('sh-bs-'+k);
    if (el) el.value = data['bs_'+k] || '';
  });

  const hint = document.getElementById('sheet-hint');
  if (hint) hint.textContent = '';

  _sheetAvatarData = saGetAvatar(journalId) || data.avatar || null;
  _sheetAvatarStoredUrl = _sheetAvatarData || null;
  _sheetAvatarUploadPromise = null;
  if (_sheetAvatarData) saSetAvatar(journalId, _sheetAvatarData);  // 캐시 워밍
  refreshSheetAvatar(_sheetAvatarData, (data.name || j?.title || '?')[0]?.toUpperCase());

  refreshJournalTokenBar(j?.assignedTokenId || null);

  _sheetAssignedTo = j?.assignedTo || [];
  refreshSheetAssignBar(j);

  const delBtn = document.querySelector('.sheet-del-btn');
  if (delBtn) delBtn.style.display = '';
  document.getElementById('sheet-overlay').classList.add('open');
}

function closeSheet() {
  const overlay = document.getElementById('sheet-overlay');
  if (overlay) overlay.classList.remove('open', 'quick-view');
  const modal = getQuickSheetModalEl();
  if (modal) {
    modal.style.left = '';
    modal.style.top = '';
    modal.style.right = '';
    modal.style.bottom = '';
    modal.style.width = '';
    modal.style.height = '';
  }
  closeQuickJournalMenu();
  const quickBtn = getQuickJournalButtonEl();
  if (quickBtn) quickBtn.classList.remove('is-open');
  _sheetQuickViewMode = false;
  _sheetJournalId = null;
  _sheetIsNew = false;
  _jdAssignedTokenId = null;
  _sheetAssignedTo = [];
  _sheetAvatarUploadPromise = null;
  _sheetAvatarStoredUrl = null;
  if (_sheetAvatarData && /^blob:/i.test(_sheetAvatarData)) {
    try { URL.revokeObjectURL(_sheetAvatarData); } catch (e) {}
  }
  _sheetAvatarData = null;
  const hint = document.getElementById('sheet-hint');
  if (hint) hint.textContent = '';
  renderJournalList();
}



async function handleSheetAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast('이미지는 10MB 이하여야 해요.'); input.value = ''; return; }

  const journalId = _sheetJournalId;
  const hint = document.getElementById('sheet-hint');
  const prevPreview = _sheetAvatarData;
  const prevStored = _sheetAvatarStoredUrl || _sheetAvatarData || null;
  const previewUrl = URL.createObjectURL(file);

  if (_sheetAvatarData && /^blob:/i.test(_sheetAvatarData)) {
    try { URL.revokeObjectURL(_sheetAvatarData); } catch (e) {}
  }
  _sheetAvatarData = previewUrl;
  refreshSheetAvatar(previewUrl);
  if (hint) hint.textContent = '아바타 업로드 중...';

  const task = uploadJournalAvatarToCloudinary(file, journalId)
    .then(url => {
      if (_sheetAvatarData === previewUrl) {
        try { URL.revokeObjectURL(previewUrl); } catch (e) {}
        _sheetAvatarData = url;
      }
      _sheetAvatarStoredUrl = url;
      if (journalId) {
        saSetAvatar(journalId, url);
        const target = _allJournals.find(x => x.id === journalId);
        if (target) {
          target.avatar = url;
          if (target.sheet && typeof target.sheet === 'object') target.sheet.avatar = url;
          saveJournalFB(target);
        }
        saRefreshToolbar();
        renderJournalList();
      }
      refreshSheetAvatar(url);
      if (hint) hint.textContent = '아바타 업로드 완료 ✓';
      setTimeout(() => {
        const liveHint = document.getElementById('sheet-hint');
        if (liveHint && liveHint.isConnected && liveHint.textContent === '아바타 업로드 완료 ✓') liveHint.textContent = '';
      }, 1800);
      return url;
    })
    .catch(err => {
      console.error('journal avatar upload failed', err);
      try { URL.revokeObjectURL(previewUrl); } catch (e) {}
      _sheetAvatarData = prevStored || prevPreview || null;
      _sheetAvatarStoredUrl = prevStored || null;
      refreshSheetAvatar(_sheetAvatarData);
      if (hint) hint.textContent = '';
      showToast('아바타 업로드에 실패했어요. 잠시 후 다시 시도해주세요.');
      return null;
    })
    .finally(() => {
      if (_sheetAvatarUploadPromise === task) _sheetAvatarUploadPromise = null;
    });

  _sheetAvatarUploadPromise = task;
  input.value = '';
  await task;
}

function refreshSheetAvatar(src, initials) {
  const el = document.getElementById('sh-avatar');
  if (!el) return;
  const imgSrc = src || _sheetAvatarData;
  if (imgSrc) {
    el.innerHTML = `<img src="${imgSrc}" alt="avatar"><div class="av-ov">📷</div>`;
  } else {
    const letter = initials || document.getElementById('sh-name')?.value?.trim()[0]?.toUpperCase() || '?';
    el.innerHTML = `<span>${letter}</span><div class="av-ov">📷</div>`;
  }
}

function addCombatRow() {
  const tbody = document.getElementById('sh-combat-rows');
  if (!tbody) return;
  const i = _combatRowCount++;
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid var(--border)';
  tr.innerHTML = `
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-name-${i}" placeholder="무기명" style="font-size:12px"></td>
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-skill-${i}" placeholder="기능명" style="font-size:12px"></td>
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-dmg-${i}" placeholder="1d6" style="font-size:12px;text-align:center"></td>
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-range-${i}" placeholder="—" style="font-size:12px;text-align:center"></td>
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-atk-${i}" placeholder="1" style="font-size:12px;text-align:center"></td>
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-ammo-${i}" placeholder="—" style="font-size:12px;text-align:center"></td>
    <td style="padding:3px 4px"><input class="sh-input" id="sh-w-mal-${i}" placeholder="—" style="font-size:12px;text-align:center"></td>`;
  tbody.appendChild(tr);
}

async function saveSheet() {
  if (!_sheetJournalId) return;
  const data = {};

  ['name','player','job','age','residence','birthplace'].forEach(k => {
    data[k] = document.getElementById('sh-'+k)?.value || '';
  });

  if (_sheetIsNew && !data.name.trim()) {
    showToast('저널 이름을 입력해주세요.');
    document.getElementById('sh-name')?.focus();
    return;
  }

  COC_STATS.forEach(s => {
    data[s.key] = parseInt(document.getElementById('sh-'+s.key)?.value) || 0;
  });

  ['hp','hp-max','san','san-max','mp','mp-max','luck','db','build'].forEach(k => {
    const key = k.replace('-','_');
    data[key] = document.getElementById('sh-'+k)?.value || '';
  });

  data.skills = COC_SKILLS.map((sk, i) => ({
    checked: document.getElementById('sk-check-'+i)?.checked || false,
    val:  parseInt(document.getElementById('sk-val-'+i)?.value)  ?? sk.base,
    half: parseInt(document.getElementById('sk-half-'+i)?.value) ?? Math.floor(sk.base/2),
  }));

  data.unarmed_skill = document.getElementById('sh-unarmed-skill')?.value || '';
  data.unarmed_dmg   = document.getElementById('sh-unarmed-dmg')?.value   || '';
  const rows = [];
  for (let i = 0; i < _combatRowCount; i++) {
    const n = document.getElementById('sh-w-name-'+i);
    if (!n) continue;
    rows.push({
      name:  n?.value || '',
      skill: document.getElementById('sh-w-skill-'+i)?.value || '',
      dmg:   document.getElementById('sh-w-dmg-'+i)?.value   || '',
      range: document.getElementById('sh-w-range-'+i)?.value  || '',
      atk:   document.getElementById('sh-w-atk-'+i)?.value    || '',
      ammo:  document.getElementById('sh-w-ammo-'+i)?.value   || '',
      mal:   document.getElementById('sh-w-mal-'+i)?.value    || '',
    });
  }
  data.combat_rows = rows;

  data.equipment = document.getElementById('sh-equipment')?.value || '';
  data.spending   = document.getElementById('sh-spending')?.value  || '';
  data.cash       = document.getElementById('sh-cash')?.value      || '';
  data.assets     = document.getElementById('sh-assets')?.value    || '';

  ['appearance','personality','ideology','wounds','people','phobias','places','tomes','treasures','encounters'].forEach(k => {
    data['bs_'+k] = document.getElementById('sh-bs-'+k)?.value || '';
  });

  if (_sheetAvatarUploadPromise) {
    const hint = document.getElementById('sheet-hint');
    if (hint) hint.textContent = '아바타 업로드 완료를 기다리는 중...';
    await _sheetAvatarUploadPromise;
  }

  const list = _allJournals;
  const existing = list.find(j => j.id === _sheetJournalId);
  if (existing) {
    const _keepAv = getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(
      _sheetAvatarStoredUrl
      || _sheetAvatarData
      || getSharedJournalAvatarRuntime().readStoredAvatar(_sheetJournalId)
      || existing.avatar
      || null
    );
    if (_keepAv) {
      data.avatar = _keepAv;
      existing.avatar = _keepAv;
      saSetAvatar(_sheetJournalId, _keepAv);
    }

    const metaPatch = {
      ownerId: existing.ownerId || St.myId,
      title: data.name || existing.title,
      updatedAt: Date.now(),
      assignedTokenId: _jdAssignedTokenId || null,
    };
    if (_sheetAssignedTo !== undefined) metaPatch.assignedTo = _sheetAssignedTo || [];
    if (_keepAv) metaPatch.avatar = _keepAv;

    existing.sheet = data;
    existing.title = metaPatch.title;
    existing.updatedAt = metaPatch.updatedAt;
    existing.assignedTokenId = metaPatch.assignedTokenId;
    if (_sheetAssignedTo !== undefined) existing.assignedTo = metaPatch.assignedTo;

    saveJournalSheetFB(_sheetJournalId, data, metaPatch);
  } else {
    const newJ = {
      id: _sheetJournalId,
      title: data.name || '무제 저널',
      body: '',
      sheet: data,
      ownerId: St.myId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assignedTokenId: _jdAssignedTokenId || null,
      assignedTo: _sheetAssignedTo || [],
    };
    const newAvatar = getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(_sheetAvatarStoredUrl || _sheetAvatarData || null);
    if (newAvatar) {
      newJ.avatar = newAvatar;
      data.avatar = newAvatar;
      saSetAvatar(_sheetJournalId, newAvatar);
    }
    saveJournalFB(newJ);
    if (_sheetIsNew) {
      _sheetIsNew = false;
      const delBtn = document.querySelector('.sheet-del-btn');
      if (delBtn) delBtn.style.display = '';
    }
  }

  const hint = document.getElementById('sheet-hint');
  if (hint) { hint.textContent = '저장됐어요 ✓'; setTimeout(() => { if (hint && hint.isConnected) hint.textContent = ''; }, 2000); }

  closeSheet();
}

