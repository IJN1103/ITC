const COC_STATS = [
  { key:'str', name:'근력(STR)' }, { key:'dex', name:'민첩(DEX)' },
  { key:'pow', name:'의지(POW)' }, { key:'con', name:'건강(CON)' },
  { key:'app', name:'외모(APP)' }, { key:'edu', name:'교육(EDU)' },
  { key:'siz', name:'체격(SIZ)' }, { key:'int', name:'지능(INT)' },
];

const COC_STAT_LABEL_MAP = {
  '근력': 'str',
  '건강': 'con',
  '크기': 'siz',
  '민첩성': 'dex',
  '외모': 'app',
  '지능': 'int',
  '지능(아이디어)': 'int',
  '정신력': 'pow',
  '교육': 'edu',
  '이성': 'san',
  '행운': 'luck',
};

const COC_SKILL_IMPORT_ALIAS = {
  '근접전:격투': '근접전(격투)',
  '사격(라/산)': '사격(라이플/산탄)',
  '매혹': '마호',
  '일본어': '언어(모국어)',
};

const COC_RESOURCE_LABEL_MAP = {
  'HP': ['hp', 'hp_max'],
  'MP': ['mp', 'mp_max'],
  '이성': ['san', 'san_max'],
  '행운': ['luck', null],
};

const COC_PARAM_LABEL_MAP = {
  'DB': 'db',
  '체구': 'build',
};

const COC_SKILLS = [
  { name:'감정', base:5 },    { name:'고고학', base:1 },
  { name:'관찰력', base:25 }, { name:'근접전(격투)', base:25 },
  { name:'기계수리', base:10 },{ name:'도약', base:20 },
  { name:'듣기', base:20 },   { name:'말재주', base:5 },
  { name:'마호', base:15 },   { name:'법률', base:5 },
  { name:'변장', base:5 },    { name:'사격(권총)', base:20 },
  { name:'사격(라이플/산탄)', base:25 }, { name:'설득', base:10 },
  { name:'손놀림', base:10 }, { name:'수영', base:20 },
  { name:'숨기', base:5 },    { name:'심리학', base:10 },
  { name:'언어(모국어)', base:0 }, { name:'역사', base:5 },
  { name:'열쇠공', base:1 },  { name:'오르기', base:20 },
  { name:'오컬트', base:5 },  { name:'위협', base:15 },
  { name:'은밀행동', base:20 },{ name:'응급처치', base:30 },
  { name:'의료', base:1 },    { name:'인류학', base:1 },
  { name:'자동차 운전', base:20 }, { name:'자료조사', base:20 },
  { name:'자연', base:10 },   { name:'재력', base:0 },
  { name:'전기수리', base:10 },{ name:'정신분석', base:1 },
  { name:'중장비 조작', base:1 }, { name:'추적', base:10 },
  { name:'크툴루 신화', base:0 }, { name:'투척', base:20 },
  { name:'항법', base:10 },   { name:'회계', base:5 },
  { name:'회피', base:0 },    { name:'언어(다른언어)', base:1 },
];

function normalizeImportedCocSkillName(name = '') {
  const raw = String(name || '').trim();
  return COC_SKILL_IMPORT_ALIAS[raw] || raw;
}

function buildEmptyImportedCocSheet() {
  return {
    name: '', player: '', job: '', age: '', height: '', sex: '', nationality: '', residence: '', birthplace: '', first_language: '',
    str: 0, con: 0, siz: 0, dex: 0, app: 0, int: 0, pow: 0, edu: 0,
    hp: '', hp_max: '', san: '', san_max: '', mp: '', mp_max: '', luck: '', db: '', build: '',
    status_temp_insane: false, status_indefinite: false, status_major_wound: false, status_dying: false,
    skills: COC_SKILLS.map(sk => ({ checked: false, val: sk.base, half: Math.floor(sk.base / 2) })),
    customSkills: [],
    unarmed_skill: '근접전(격투)',
    unarmed_dmg: '1d3+db',
    combat_rows: [],
    equipment: '', spending: '', cash: '', assets: '', notes: '',
    bs_appearance: '', bs_personality: '', bs_ideology: '', bs_wounds: '', bs_people: '',
    bs_phobias: '', bs_places: '', bs_tomes: '', bs_treasures: '', bs_encounters: '',
  };
}

function extractCcfoliaCharacterPayload(rawText = '') {
  const raw = String(rawText || '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const candidate = raw.slice(start, end + 1).replace(/[“”]/g, '"');
  try {
    const parsed = JSON.parse(candidate);
    if (parsed?.kind === 'character' && parsed?.data && typeof parsed.data === 'object') return parsed;
  } catch (e) {}
  return null;
}

function buildJournalFromCcfoliaCharacter(parsed) {
  const data = parsed?.data;
  if (!data || typeof data !== 'object') return null;

  const sheet = buildEmptyImportedCocSheet();
  const skillIndexMap = new Map(COC_SKILLS.map((sk, i) => [normalizeImportedCocSkillName(sk.name), i]));
  const unmappedCommands = [];

  sheet.name = String(data.name || '').trim();
  sheet.player = String(data.memo || '').trim();

  (Array.isArray(data.status) ? data.status : []).forEach((entry) => {
    const label = String(entry?.label || '').trim();
    const mapped = COC_RESOURCE_LABEL_MAP[label];
    if (!mapped) return;
    const [curKey, maxKey] = mapped;
    if (curKey) sheet[curKey] = entry?.value ?? '';
    if (maxKey) sheet[maxKey] = entry?.max ?? entry?.value ?? '';
  });

  (Array.isArray(data.params) ? data.params : []).forEach((entry) => {
    const label = String(entry?.label || '').trim();
    const mapped = COC_PARAM_LABEL_MAP[label];
    if (mapped) sheet[mapped] = String(entry?.value ?? '').trim();
  });

  const commands = String(data.commands || '').replace(/\r/g, '');
  commands.split('\n').map(line => line.trim()).filter(Boolean).forEach((line) => {
    const check = line.match(/^CC<=\{?([^}\s]+)\}?\s+(.+)$/i);
    if (check) {
      const targetToken = String(check[1] || '').trim();
      const label = String(check[2] || '').trim();
      const numericTarget = /^\d+$/.test(targetToken) ? parseInt(targetToken, 10) : null;
      const statKey = COC_STAT_LABEL_MAP[label];
      if (statKey && numericTarget !== null) {
        sheet[statKey] = numericTarget;
        if (statKey === 'san' && !sheet.san_max) sheet.san_max = numericTarget;
        if (statKey === 'luck' && !sheet.luck) sheet.luck = numericTarget;
        return;
      }
      const normalizedSkillName = normalizeImportedCocSkillName(label);
      const skillIndex = skillIndexMap.get(normalizedSkillName);
      if (skillIndex !== undefined && numericTarget !== null) {
        sheet.skills[skillIndex] = {
          checked: sheet.skills[skillIndex]?.checked || false,
          val: numericTarget,
          half: Math.floor(numericTarget / 2),
          fifth: Math.floor(numericTarget / 5),
        };
        return;
      }
      if (label && numericTarget !== null) unmappedCommands.push(`${label}=${numericTarget}`);
      return;
    }

    const weapon = line.match(/^(.+?)\s+(.+)$/);
    if (weapon && /\d+d\d+/i.test(weapon[1])) {
      const dmg = weapon[1].trim();
      const name = weapon[2].trim();
      if (/비무장/.test(name)) {
        sheet.unarmed_dmg = dmg;
      } else {
        sheet.combat_rows.push({ name, skill: '', dmg, range: '', atk: '', ammo: '', mal: '' });
      }
    }
  });

  if (!sheet.san && sheet.san_max) sheet.san = sheet.san_max;
  if (!sheet.hp && sheet.hp_max) sheet.hp = sheet.hp_max;
  if (!sheet.mp && sheet.mp_max) sheet.mp = sheet.mp_max;

  if (unmappedCommands.length) {
    sheet.notes = `가져오지 못한 판정 항목: ${unmappedCommands.join(', ')}`;
  }

  const titleBase = sheet.name || String(data.name || '가져온 저널').trim() || '가져온 저널';
  const id = `j_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: titleBase,
    body: '',
    ownerId: St.myId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    assignedTo: [],
    assignedTokenId: null,
    nameColor: '',
    sheet,
  };
}

async function importCcfoliaApiToJournal(rawText = '') {
  const parsed = extractCcfoliaCharacterPayload(rawText);
  if (!parsed) return { handled: false, created: false };
  const journal = buildJournalFromCcfoliaCharacter(parsed);
  if (!journal) {
    showToast('CCFOLIA API 데이터를 해석하지 못했어요.');
    return { handled: true, created: false };
  }
  saveJournalFB(journal);
  try { await loadJournalsFB(); } catch (e) {}
  if (typeof renderJournalList === 'function') renderJournalList();
  if (typeof saRefreshToolbar === 'function') saRefreshToolbar();
  showToast(`저널 '${journal.title}'을(를) 가져왔어요.`);
  return { handled: true, created: true, journalId: journal.id, title: journal.title };
}

let _sheetJournalId = null;

function bindStatRollInteractions(grid) {
  if (!grid || grid.dataset.rollBound === '1') return;
  grid.dataset.rollBound = '1';
  grid.addEventListener('click', (event) => {
    const trigger = event.target.closest('.stat-roll-trigger');
    if (!trigger || !grid.contains(trigger)) return;
    event.preventDefault();
    event.stopPropagation();
    const key = trigger.dataset.statKey || '';
    const name = trigger.dataset.statName || '특성치';
    const input = document.getElementById('sh-' + key);
    const value = input ? parseInt(input.value, 10) || 0 : 0;
    if (typeof window.rollJournalSheetSkillCheck === 'function') {
      window.rollJournalSheetSkillCheck(name, value);
    }
  });
}

function bindResourceRollInteractions() {
  document.querySelectorAll('.resource-roll-trigger').forEach(btn => {
    if (btn.dataset.rollBound === '1') return;
    btn.dataset.rollBound = '1';
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const inputId = btn.dataset.rollInput || '';
      const name = btn.dataset.rollName || '판정';
      const input = inputId ? document.getElementById(inputId) : null;
      const value = input ? parseInt(input.value, 10) || 0 : 0;
      if (typeof window.rollJournalSheetSkillCheck === 'function') {
        window.rollJournalSheetSkillCheck(name, value);
      }
    });
  });
}

function bindSheetSkillRollInteractions(wrap) {
  if (!wrap || wrap.dataset.rollBound === '1') return;
  wrap.dataset.rollBound = '1';
  wrap.addEventListener('click', (event) => {
    const trigger = event.target.closest('.skill-roll-trigger');
    if (!trigger || !wrap.contains(trigger)) return;
    event.preventDefault();
    event.stopPropagation();
    const customIndex = trigger.dataset.customSkillIndex;
    if (customIndex !== undefined) {
      rollCustomSheetSkill(customIndex);
      return;
    }
    const index = trigger.dataset.skillIndex;
    const name = trigger.dataset.skillName || trigger.textContent || '기능치';
    const input = index !== undefined ? document.getElementById(`sk-val-${index}`) : null;
    const value = input ? parseInt(input.value, 10) || 0 : 0;
    if (typeof window.rollJournalSheetSkillCheck === 'function') {
      window.rollJournalSheetSkillCheck(name, value);
    }
  });
}

let _customSkillRowCount = 0;
let _customSkillColumns = [];
let _customSkillAddRowEl = null;

function getCustomSkillColumns() {
  const wrap = document.getElementById('sh-skills-wrap');
  const cols = wrap ? Array.from(wrap.querySelectorAll('.skill-col-wrap')) : [];
  if (cols.length) _customSkillColumns = cols;
  return _customSkillColumns;
}

function getCustomSkillTargetColumn() {
  const cols = getCustomSkillColumns();
  if (!cols.length) return null;
  return cols[_customSkillRowCount % cols.length] || cols[0];
}

function normalizeCustomSkillValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(999, n)) : '';
}

function readCustomSkillRowsFromSheet() {
  const rows = Array.from(document.querySelectorAll('.custom-skill-row'));
  return rows.map((row) => {
    const index = row.dataset.customSkillIndex;
    const name = document.getElementById(`sk-custom-name-${index}`)?.value?.trim() || '';
    const valRaw = document.getElementById(`sk-custom-val-${index}`)?.value ?? '';
    const halfRaw = document.getElementById(`sk-custom-half-${index}`)?.value ?? '';
    const quarterRaw = document.getElementById(`sk-custom-quarter-${index}`)?.value ?? '';
    const data = {
      checked: !!document.getElementById(`sk-custom-check-${index}`)?.checked,
      name,
      val: normalizeCustomSkillValue(valRaw),
      half: normalizeCustomSkillValue(halfRaw),
      quarter: normalizeCustomSkillValue(quarterRaw),
    };
    const hasAnyValue = data.name || data.val !== '' || data.half !== '' || data.quarter !== '' || data.checked;
    return hasAnyValue ? data : null;
  }).filter(Boolean);
}

function rollCustomSheetSkill(index) {
  const nameEl = document.getElementById(`sk-custom-name-${index}`);
  const editingEl = document.getElementById(`sk-custom-name-edit-${index}`);
  const valEl = document.getElementById(`sk-custom-val-${index}`);
  const name = (nameEl?.value || editingEl?.value || '').trim() || '추가 기능';
  const value = valEl ? parseInt(valEl.value, 10) || 0 : 0;
  if (typeof window.rollJournalSheetSkillCheck === 'function') {
    window.rollJournalSheetSkillCheck(name, value);
  }
}

function createCustomSkillNumberInput(index, kind, placeholder, value) {
  const input = document.createElement('input');
  input.className = kind === 'val' ? 'skill-input' : 'skill-input half-val';
  input.id = `sk-custom-${kind}-${index}`;
  input.type = 'number';
  input.min = '0';
  input.max = '999';
  input.placeholder = placeholder;
  input.value = value !== undefined && value !== null ? String(value) : '';
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    input.blur();
  });
  return input;
}

function renderCustomSkillNameButton(row, index) {
  const cell = row.querySelector('.custom-skill-name-cell');
  const hidden = document.getElementById(`sk-custom-name-${index}`);
  if (!cell || !hidden) return;
  const name = hidden.value.trim();
  cell.querySelectorAll('.custom-skill-name-input, .custom-skill-name-btn').forEach((el) => el.remove());
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'skill-name skill-roll-trigger custom-skill-name-btn';
  btn.dataset.customSkillIndex = String(index);
  btn.title = `${name || '추가 기능'} 판정`;
  btn.textContent = name || '기능명';
  cell.appendChild(btn);
}

function renderCustomSkillNameEditor(row, index, focus = false) {
  const cell = row.querySelector('.custom-skill-name-cell');
  const hidden = document.getElementById(`sk-custom-name-${index}`);
  if (!cell || !hidden) return;
  cell.querySelectorAll('.custom-skill-name-input, .custom-skill-name-btn').forEach((el) => el.remove());
  const input = document.createElement('input');
  input.className = 'custom-skill-name-input';
  input.id = `sk-custom-name-edit-${index}`;
  input.placeholder = '기능명';
  input.value = hidden.value;
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    hidden.value = input.value.trim();
    renderCustomSkillNameButton(row, index);
    document.getElementById(`sk-custom-val-${index}`)?.focus();
  });
  cell.appendChild(input);
  if (focus) input.focus();
}

function createCustomSheetSkillRow(skillData = {}) {
  const index = _customSkillRowCount++;
  const row = document.createElement('div');
  row.className = 'skill-row custom-skill-row';
  row.dataset.customSkillIndex = String(index);

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'skill-check custom-skill-check';
  check.id = `sk-custom-check-${index}`;
  check.checked = !!skillData.checked;

  const nameCell = document.createElement('div');
  nameCell.className = 'custom-skill-name-cell';

  const nameHidden = document.createElement('input');
  nameHidden.type = 'hidden';
  nameHidden.id = `sk-custom-name-${index}`;
  nameHidden.value = String(skillData.name || '');
  nameCell.appendChild(nameHidden);

  const valInput = createCustomSkillNumberInput(index, 'val', '현재', skillData.val);
  const halfInput = createCustomSkillNumberInput(index, 'half', '½', skillData.half);
  const quarterValue = skillData.quarter !== undefined ? skillData.quarter : skillData.fifth;
  const quarterInput = createCustomSkillNumberInput(index, 'quarter', '¼', quarterValue);

  row.appendChild(check);
  row.appendChild(nameCell);
  row.appendChild(valInput);
  row.appendChild(halfInput);
  row.appendChild(quarterInput);

  if (skillData.name) {
    renderCustomSkillNameButton(row, index);
  } else {
    renderCustomSkillNameEditor(row, index, false);
  }
  return row;
}

function ensureCustomSkillAddRow() {
  if (_customSkillAddRowEl && document.body.contains(_customSkillAddRowEl)) return _customSkillAddRowEl;

  const addRow = document.createElement('div');
  addRow.className = 'skill-row custom-skill-add-row';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'custom-skill-add-btn';
  addBtn.textContent = '+';
  addBtn.title = '추가 기능 입력';
  addBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    addCustomSheetSkillRow();
  });

  const blank = document.createElement('div');
  blank.className = 'custom-skill-add-blank';
  blank.setAttribute('aria-hidden', 'true');

  addRow.appendChild(addBtn);
  addRow.appendChild(blank);
  _customSkillAddRowEl = addRow;
  return addRow;
}

function moveCustomSkillAddRow() {
  const target = getCustomSkillTargetColumn();
  if (!target) return;
  target.appendChild(ensureCustomSkillAddRow());
}

function addCustomSheetSkillRow(skillData = {}) {
  const target = getCustomSkillTargetColumn();
  if (!target) return;

  const addRow = ensureCustomSkillAddRow();
  const row = createCustomSheetSkillRow(skillData || {});
  if (addRow.parentElement === target) {
    target.insertBefore(row, addRow);
  } else {
    target.appendChild(row);
  }
  moveCustomSkillAddRow();

  const modal = getQuickSheetModalEl();
  const editable = modal?.dataset.editable !== '0';
  row.querySelectorAll('input:not([type=checkbox]):not([type=hidden])').forEach((input) => { input.readOnly = !editable; });
  row.querySelectorAll('input[type=checkbox]').forEach((input) => { input.disabled = !editable; });
  if (editable && !skillData.name) renderCustomSkillNameEditor(row, row.dataset.customSkillIndex, true);
}

function renderCustomSheetSkillRows(customSkills = []) {
  document.querySelectorAll('.custom-skill-row, .custom-skill-add-row').forEach((el) => el.remove());
  _customSkillRowCount = 0;
  _customSkillAddRowEl = null;
  (Array.isArray(customSkills) ? customSkills : []).forEach((skill) => addCustomSheetSkillRow(skill || {}));
  moveCustomSkillAddRow();
}

function appendCustomSkillAddRow(wrap) {
  if (!wrap) return;
  _customSkillColumns = Array.from(wrap.querySelectorAll('.skill-col-wrap'));
  moveCustomSkillAddRow();
}

function initSheetUI() {
  const grid = document.getElementById('sh-stats-grid');
  if (grid && !grid.children.length) {
    COC_STATS.forEach(s => {
      const div = document.createElement('div');
      div.className = 'stat-card';
      div.innerHTML = `<button type="button" class="stat-name stat-roll-trigger" data-stat-key="${s.key}" data-stat-name="${s.name}" title="${s.name} 판정">${s.name}</button>
        <input class="stat-val" id="sh-${s.key}" type="number" min="0" max="99" placeholder="0" oninput="updateStatHalf('${s.key}')">
        <div class="stat-half" id="sh-${s.key}-half">½ — / ⅕ —</div>`;
      grid.appendChild(div);
    });
    bindStatRollInteractions(grid);
  }

  const wrap = document.getElementById('sh-skills-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  bindSheetSkillRollInteractions(wrap);

  const colHead = () => {
    const h = document.createElement('div');
    h.className = 'skill-col-head';
    h.innerHTML = '<span></span><span>기능명</span><span>현재</span><span>½값</span><span>⅕값</span>';
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
        <button type="button" class="skill-name skill-roll-trigger" title="${sk.name} 판정" data-skill-index="${i}" data-skill-name="${sk.name}">${sk.name}</button>
        <input class="skill-input" id="sk-val-${i}" type="number" min="0" max="99" value="${sk.base}" oninput="updateSkillFractions(${i})">
        <input class="skill-input half-val" id="sk-half-${i}" type="number" min="0" max="99" value="${Math.floor(sk.base / 2)}" readonly>
        <input class="skill-input half-val" id="sk-fifth-${i}" type="number" min="0" max="99" value="${Math.floor(sk.base / 5)}" readonly>`;
      col.appendChild(row);
    });
    wrap.appendChild(col);
  });
  appendCustomSkillAddRow(wrap);
  bindResourceRollInteractions();
}

function updateSkillFractions(index) {
  const current = parseInt(document.getElementById(`sk-val-${index}`)?.value, 10) || 0;
  const halfEl = document.getElementById(`sk-half-${index}`);
  const fifthEl = document.getElementById(`sk-fifth-${index}`);
  if (halfEl) halfEl.value = Math.floor(current / 2);
  if (fifthEl) fifthEl.value = Math.floor(current / 5);
}

function updateStatHalf(key) {
  const val = parseInt(document.getElementById('sh-'+key)?.value) || 0;
  const el  = document.getElementById('sh-'+key+'-half');
  if (el) el.textContent = `½ ${Math.floor(val/2)} / ⅕ ${Math.floor(val/5)}`;
}


let _sheetQuickViewMode = false;

const _quickSheetState = {
  x: null,
  y: null,
  width: null,
  height: null,
};
let _quickSheetInteractionsBound = false;
let _quickSheetInteractionCleanup = null;

function getQuickSheetModalEl() { return document.getElementById('sheet-modal'); }

function setSheetEditorMode(editable) {
  const modal = getQuickSheetModalEl();
  if (!modal) return;
  modal.dataset.editable = editable ? '1' : '0';

  modal.querySelectorAll('input, textarea, select').forEach((el) => {
    const tag = String(el.tagName || '').toLowerCase();
    const type = String(el.type || '').toLowerCase();
    if (tag === 'select' || type === 'checkbox' || type === 'radio' || type === 'file') {
      el.disabled = !editable;
    } else {
      el.readOnly = !editable;
    }
  });

  const saveBtn = modal.querySelector('.btn-primary[onclick*="saveSheet"]');
  if (saveBtn) saveBtn.style.display = editable ? '' : 'none';

  const delBtn = modal.querySelector('.sheet-del-btn');
  if (delBtn) delBtn.style.display = canDeleteJournalById(_sheetJournalId) ? '' : 'none';

  const addCombatBtn = modal.querySelector('button[onclick*="addCombatRow"]');
  if (addCombatBtn) addCombatBtn.style.display = editable ? '' : 'none';

  modal.querySelectorAll('.custom-skill-add-row').forEach((row) => {
    row.style.display = editable ? '' : 'none';
  });

  modal.querySelectorAll('.custom-skill-add-btn').forEach((btn) => {
    btn.style.display = editable ? '' : 'none';
    btn.disabled = !editable;
  });

  const tokenAssignBtn = document.getElementById('sh-token-assign-btn');
  if (tokenAssignBtn) tokenAssignBtn.style.display = editable ? '' : 'none';

  const tokenClearBtn = modal.querySelector('.sh-token-clear');
  if (tokenClearBtn) tokenClearBtn.style.display = editable ? '' : 'none';

  const avatarEl = document.getElementById('sh-avatar');
  if (avatarEl) avatarEl.style.pointerEvents = editable ? '' : 'none';

  const avatarHint = modal.querySelector('.sh-avatar-hint');
  if (avatarHint) avatarHint.style.display = editable ? '' : 'none';
}

function clearQuickSheetInteractionCleanup() {
  if (typeof _quickSheetInteractionCleanup === 'function') {
    try { _quickSheetInteractionCleanup(); } catch (_) {}
  }
  _quickSheetInteractionCleanup = null;
}

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

function getDefaultQuickSheetRect() {
  const pad = 16;
  const gap = 12;
  const quickBtn = getQuickJournalButtonEl();
  const btnRect = quickBtn?.getBoundingClientRect();
  const chatPanel = document.getElementById('panel-right');
  const chatRect = chatPanel?.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const baseHeight = Math.round((chatRect?.height || viewportHeight) * 0.6);
  let targetHeight = Math.max(320, Math.min(baseHeight, viewportHeight - pad * 2));
  let targetWidth = Math.round(targetHeight * 1.18);

  if (chatRect && chatRect.left > pad + 280) {
    const availableWidth = Math.max(420, chatRect.left - gap - pad * 2);
    targetWidth = Math.min(targetWidth, availableWidth);
  } else {
    targetWidth = Math.min(targetWidth, viewportWidth - pad * 2);
  }

  targetWidth = Math.max(420, Math.min(targetWidth, 760, viewportWidth - pad * 2));

  if (btnRect && btnRect.width && btnRect.height) {
    const availableBelow = viewportHeight - btnRect.bottom - gap - pad;
    if (availableBelow >= 320) targetHeight = Math.min(targetHeight, availableBelow);
    const x = btnRect.right - targetWidth;
    const y = btnRect.bottom + gap;
    return clampQuickSheetRect(x, y, targetWidth, targetHeight);
  }

  let x;
  if (chatRect && chatRect.left > pad + 280) {
    x = chatRect.left - targetWidth - gap;
  } else {
    x = viewportWidth - targetWidth - pad;
  }

  let y;
  if (chatRect) {
    y = chatRect.top + Math.max(16, Math.round((chatRect.height - targetHeight) / 2));
  } else {
    y = Math.max(pad, Math.round((viewportHeight - targetHeight) / 2));
  }

  return clampQuickSheetRect(x, y, targetWidth, targetHeight);
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
  clearQuickSheetInteractionCleanup();
  const modal = getQuickSheetModalEl();
  if (!modal) return;
  modal.style.left = '';
  modal.style.top = '';
  modal.style.right = '';
  modal.style.bottom = '';
  modal.style.width = '';
  modal.style.height = '';

  if (_sheetQuickViewMode) {
    const preferred = getDefaultQuickSheetRect();
    _quickSheetState.x = preferred.x;
    _quickSheetState.y = preferred.y;
    _quickSheetState.width = preferred.width;
    _quickSheetState.height = preferred.height;
    applyQuickSheetState();
    return;
  }

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
    event.preventDefault();
    clearQuickSheetInteractionCleanup();

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
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('blur', onUp);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (_quickSheetInteractionCleanup === cleanup) _quickSheetInteractionCleanup = null;
    };
    const onUp = () => { cleanup(); };
    const onVisibilityChange = () => { if (document.hidden) onUp(); };
    _quickSheetInteractionCleanup = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('blur', onUp);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  modal.querySelectorAll('.sheet-resize-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => {
      const overlay = document.getElementById('sheet-overlay');
      if (!_sheetQuickViewMode || !overlay?.classList.contains('quick-view')) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      clearQuickSheetInteractionCleanup();
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
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('blur', onUp);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        if (_quickSheetInteractionCleanup === cleanup) _quickSheetInteractionCleanup = null;
      };
      const onUp = () => { cleanup(); };
      const onVisibilityChange = () => { if (document.hidden) onUp(); };
      _quickSheetInteractionCleanup = cleanup;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('blur', onUp);
      document.addEventListener('visibilitychange', onVisibilityChange);
    });
  });

  window.addEventListener('resize', () => {
    if (!_sheetQuickViewMode) return;
    applyQuickSheetState();
  });
}

function getQuickJournalMenuEl() { return document.getElementById('map-quick-journal-menu'); }
function getQuickJournalButtonEl() { return document.getElementById('map-quick-journal-btn'); }
function getQuickStandingMenuEl() { return document.getElementById('map-quick-standing-menu'); }
function getQuickStandingButtonEl() { return document.getElementById('map-quick-standing-btn'); }

function closeQuickStandingMenu() {
  const menu = getQuickStandingMenuEl();
  if (!menu) return;
  menu.style.display = 'none';
  menu.innerHTML = '';
  getQuickStandingButtonEl()?.classList.remove('is-open');
}

function isQuickStandingMenuOpen() {
  const menu = getQuickStandingMenuEl();
  return !!(menu && menu.style.display !== 'none' && menu.innerHTML.trim());
}

function refreshQuickStandingMenuIfOpen() {
  if (!isQuickStandingMenuOpen()) return;
  renderQuickStandingMenu();
}

function refreshQuickStandingMenuForToken(tokenId) {
  if (!isQuickStandingMenuOpen()) return;
  const ctx = getSelectedQuickStandingContext();
  const currentTokenId = String(ctx?.token?.id || '');
  if (!currentTokenId || currentTokenId === String(tokenId || '')) renderQuickStandingMenu();
}

function getQuickStandingCloseButtonHtml() {
  return '<button type="button" class="map-quick-standing-close-btn" title="닫기" aria-label="스탠딩 퀵뷰 닫기">×</button>';
}

function bindQuickStandingCloseButton(menu) {
  const closeBtn = menu?.querySelector('.map-quick-standing-close-btn');
  if (!closeBtn) return;
  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeQuickStandingMenu();
  });
}

function getStandingQuickEmptyHtml(message) {
  return `
    <div class="map-quick-standing-head">
      <span>스탠딩 퀵뷰</span>
      <div class="map-quick-standing-head-actions">${getQuickStandingCloseButtonHtml()}</div>
    </div>
    <div class="map-quick-standing-empty">${esc(message)}</div>
  `;
}

function normalizeQuickStandingLabel(label) {
  return String(label || '').trim();
}

function getQuickStandingDisplayLabel(label) {
  const clean = normalizeQuickStandingLabel(label).replace(/^@+/, '').trim();
  return '@' + (clean || '스탠딩');
}

function getSelectedQuickStandingContext() {
  const journalId = String(St?.speakAsJournalId || '').trim();
  if (!journalId) return { error: '먼저 저널을 선택해주세요.' };
  const journal = loadJournals().find(j => String(j.id) === journalId);
  if (!journal) return { error: '선택한 저널을 찾을 수 없어요.' };
  const tokenId = String(journal.assignedTokenId || '').trim();
  if (!tokenId) return { journal, error: '이 저널에 연결된 토큰이 없어요.' };
  const token = St.tokens?.[tokenId] || null;
  if (!token) return { journal, error: '연결된 토큰을 찾을 수 없어요.' };
  if (typeof shouldRenderTokenForCurrentUser === 'function' && !shouldRenderTokenForCurrentUser(token)) return { journal, error: '이 저널에 연결된 토큰은 비공개 상태예요.' };
  const standings = Array.isArray(token.standings) ? token.standings.filter(s => s && (s.img || s.label)) : [];
  if (!standings.length) return { journal, token, error: '이 토큰에 등록된 스탠딩이 없어요.' };
  return { journal, token, standings };
}

function canChangeQuickStanding(journal, token) {
  if (St.isGM) return true;
  const myId = String(St.myId || '');
  if (!myId || !journal || !token) return false;
  if (String(token.ownerId || '') === myId) return true;
  if (typeof hasPerm === 'function' && hasPerm('editToken')) return true;
  if (String(journal.ownerId || '') === myId) return true;
  if (Array.isArray(journal.assignedTo) && journal.assignedTo.map(String).includes(myId)) return true;
  if (journal.assignedMap && journal.assignedMap[myId] === true) return true;
  return false;
}

function canEditQuickStandingCrop(journal, token) {
  if (St.isGM) return true;
  const myId = String(St.myId || '');
  if (!myId || !token) return false;
  if (String(token.ownerId || '') === myId) return true;
  if (typeof hasPerm === 'function' && hasPerm('editToken')) return true;
  return false;
}

function clampQuickStandingCropValue(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizeQuickStandingThumbCrop(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cx = clampQuickStandingCropValue(raw.cx, 0, 1, 0.5);
  const cy = clampQuickStandingCropValue(raw.cy, 0, 1, 0.5);
  const zoom = clampQuickStandingCropValue(raw.zoom, 1, 3, 1);
  return {
    cx: Math.round(cx * 1000) / 1000,
    cy: Math.round(cy * 1000) / 1000,
    zoom: Math.round(zoom * 1000) / 1000,
  };
}

function getQuickStandingIndividualThumbCrop(standing = null) {
  return normalizeQuickStandingThumbCrop(standing?.quickStandingCrop || standing?.thumbCrop || null);
}

function hasQuickStandingIndividualThumbCrop(standing = null) {
  return !!getQuickStandingIndividualThumbCrop(standing);
}

function getQuickStandingThumbCrop(token, standing = null) {
  return getQuickStandingIndividualThumbCrop(standing)
    || normalizeQuickStandingThumbCrop(token?.quickStandingCrop || token?.standingQuickCrop || null);
}

function getQuickStandingThumbImgStyle(crop) {
  const safe = normalizeQuickStandingThumbCrop(crop);
  if (!safe) return '';
  const cx = Math.round(safe.cx * 10000) / 100;
  const cy = Math.round(safe.cy * 10000) / 100;
  const zoom = Math.round(safe.zoom * 1000) / 1000;
  return ` style="object-position:${cx}% ${cy}%;transform:scale(${zoom});transform-origin:${cx}% ${cy}%;"`;
}

function getQuickStandingCropIconSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.1 10.2 4.6 6.7a2.4 2.4 0 1 1 1.4-1.4l9.4 9.4 2.3-2.3a1 1 0 0 1 1.4 1.4l-3.1 3.1 3.3 3.3a1 1 0 0 1-1.4 1.4L12.8 16l-2.7 2.7a3.3 3.3 0 1 1-1.4-1.4l2.4-2.4-2.7-2.7-2.4 2.4a3.3 3.3 0 1 1-1.4-1.4l3.1-3.1Zm-2.9 9.6a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6Zm0-6.4a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6Z"/></svg>`;
}

function getQuickStandingCurrentLabel(journal, token, standings) {
  const current = normalizeQuickStandingLabel(token?.currentStandingLabel || '');
  if (current && standings.some(s => normalizeQuickStandingLabel(s.label) === current)) return current;
  const local = normalizeQuickStandingLabel((typeof _vnCurrentStanding !== 'undefined' ? _vnCurrentStanding : null)?.[journal.id] || '');
  if (local && standings.some(s => normalizeQuickStandingLabel(s.label) === local)) return local;
  const first = standings.find(s => s.img || s.label);
  return normalizeQuickStandingLabel(first?.label || '');
}

function bindQuickStandingMenuScrollGuard(menu) {
  if (!menu || menu.dataset.scrollGuardBound === '1') return;
  menu.dataset.scrollGuardBound = '1';
  menu.addEventListener('wheel', (e) => {
    const grid = menu.querySelector('.map-quick-standing-grid');
    if (grid && grid.scrollHeight > grid.clientHeight) {
      grid.scrollTop += e.deltaY;
      e.preventDefault();
    }
    e.stopPropagation();
  }, { passive: false });
  menu.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  menu.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  });
  menu.addEventListener('touchmove', (e) => {
    e.stopPropagation();
  }, { passive: true });
}

function closeQuickStandingCropContextMenu(menu = null) {
  const root = menu || getQuickStandingMenuEl();
  root?.querySelector('.map-quick-standing-context-menu')?.remove();
}

function showQuickStandingCropContextMenu(menu, journal, token, standing, standingIndex, event) {
  if (!menu || !journal || !token || !standing) return;
  if (!canEditQuickStandingCrop(journal, token)) return;
  closeQuickStandingCropContextMenu(menu);
  const rect = menu.getBoundingClientRect();
  const boxWidth = 172;
  const boxHeight = 76;
  const left = Math.max(8, Math.min((event?.clientX || rect.left) - rect.left, Math.max(8, rect.width - boxWidth - 8)));
  const top = Math.max(8, Math.min((event?.clientY || rect.top) - rect.top, Math.max(8, rect.height - boxHeight - 8)));
  const hasIndividualCrop = hasQuickStandingIndividualThumbCrop(standing);
  const context = document.createElement('div');
  context.className = 'map-quick-standing-context-menu';
  context.style.left = `${left}px`;
  context.style.top = `${top}px`;
  context.innerHTML = `
    <button type="button" data-action="edit">개별 크롭 영역 지정</button>
    <button type="button" data-action="reset"${hasIndividualCrop ? '' : ' disabled'}>개별 크롭 초기화</button>
  `;
  context.addEventListener('click', (e) => e.stopPropagation());
  context.addEventListener('pointerdown', (e) => e.stopPropagation());
  context.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = btn.dataset.action;
      closeQuickStandingCropContextMenu(menu);
      if (action === 'edit') {
        renderQuickStandingCropEditor({ standingIndex });
      } else if (action === 'reset' && hasIndividualCrop) {
        await saveQuickStandingIndividualThumbCrop(journal, token, standingIndex, null);
      }
    });
  });
  menu.appendChild(context);
  window.setTimeout(() => {
    const close = () => closeQuickStandingCropContextMenu(menu);
    document.addEventListener('click', close, { once: true });
    document.addEventListener('contextmenu', close, { once: true });
  }, 0);
}

function renderQuickStandingMenu() {
  const menu = getQuickStandingMenuEl();
  if (!menu) return;
  bindQuickStandingMenuScrollGuard(menu);
  const ctx = getSelectedQuickStandingContext();
  getQuickStandingButtonEl()?.classList.add('is-open');
  if (ctx.error) {
    menu.innerHTML = getStandingQuickEmptyHtml(ctx.error);
    bindQuickStandingCloseButton(menu);
    menu.style.display = 'flex';
    return;
  }
  const { journal, token, standings } = ctx;
  const canChange = canChangeQuickStanding(journal, token);
  const canCrop = canEditQuickStandingCrop(journal, token);
  const currentLabel = getQuickStandingCurrentLabel(journal, token, standings);
  const title = String(journal?.title || '무제 저널').trim() || '무제 저널';
  menu.innerHTML = `
    <div class="map-quick-standing-head">
      <span>${esc(title)} 스탠딩</span>
      <div class="map-quick-standing-head-actions">
        ${canCrop ? `<button type="button" class="map-quick-standing-crop-btn" title="크롭 기능" aria-label="스탠딩 썸네일 크롭">${getQuickStandingCropIconSvg()}</button>` : ''}
        ${canChange ? '' : '<em>보기 전용</em>'}
        ${getQuickStandingCloseButtonHtml()}
      </div>
    </div>
    <div class="map-quick-standing-grid">
      ${standings.map((standing, index) => {
        const label = normalizeQuickStandingLabel(standing.label || '');
        const active = currentLabel && label === currentLabel;
        const src = String(standing.img || '').trim();
        const displayLabel = getQuickStandingDisplayLabel(label);
        const hasIndividualCrop = hasQuickStandingIndividualThumbCrop(standing);
        const cropStyle = getQuickStandingThumbImgStyle(getQuickStandingThumbCrop(token, standing));
        return `<button type="button" class="map-quick-standing-card${active ? ' active' : ''}${canChange ? '' : ' disabled'}${hasIndividualCrop ? ' has-individual-crop' : ''}" data-standing-index="${index}" ${canChange ? '' : 'disabled'}>
          <span class="map-quick-standing-thumb${cropStyle ? ' cropped' : ''}">${src ? `<img src="${esc(src)}" alt=""${cropStyle}>` : '<span class="map-quick-standing-fallback">?</span>'}</span>
          ${hasIndividualCrop ? '<span class="map-quick-standing-crop-badge">개별</span>' : ''}
          <span class="map-quick-standing-label">${esc(displayLabel)}</span>
        </button>`;
      }).join('')}
    </div>`;
  bindQuickStandingCloseButton(menu);
  const cropBtn = menu.querySelector('.map-quick-standing-crop-btn');
  if (cropBtn) {
    cropBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      renderQuickStandingCropEditor();
    });
  }
  menu.querySelectorAll('.map-quick-standing-card').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeQuickStandingCropContextMenu(menu);
      const idx = Number(btn.dataset.standingIndex);
      const standing = standings[idx];
      if (!standing || !canChange) return;
      await selectQuickStanding(journal, token, standing);
    });
    if (canCrop) {
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number(btn.dataset.standingIndex);
        const standing = standings[idx];
        if (!standing) return;
        showQuickStandingCropContextMenu(menu, journal, token, standing, idx, e);
      });
    }
  });
  menu.style.display = 'flex';
}

function getDefaultQuickStandingThumbCrop() {
  return { cx: 0.5, cy: 0.5, zoom: 1 };
}

function getQuickStandingCropPreviewStyle(crop) {
  const safe = normalizeQuickStandingThumbCrop(crop) || getDefaultQuickStandingThumbCrop();
  const cx = Math.round(safe.cx * 10000) / 100;
  const cy = Math.round(safe.cy * 10000) / 100;
  const zoom = Math.round(safe.zoom * 1000) / 1000;
  return `object-position:${cx}% ${cy}%;transform:scale(${zoom});transform-origin:${cx}% ${cy}%;`;
}

function updateQuickStandingCropPreview(menu, crop) {
  const img = menu?.querySelector('.map-quick-standing-crop-image');
  const range = menu?.querySelector('.map-quick-standing-crop-range');
  const value = menu?.querySelector('.map-quick-standing-crop-value');
  const safe = normalizeQuickStandingThumbCrop(crop) || getDefaultQuickStandingThumbCrop();
  if (img) img.setAttribute('style', getQuickStandingCropPreviewStyle(safe));
  if (range) range.value = String(Math.round(safe.zoom * 100));
  if (value) value.textContent = `${Math.round(safe.zoom * 100)}%`;
}

async function saveQuickStandingThumbCrop(journal, token, crop) {
  if (!journal?.id || !token?.id) return;
  if (!canEditQuickStandingCrop(journal, token)) {
    showToast('스탠딩 크롭 설정 권한이 없어요.');
    return;
  }
  const safeCrop = crop ? normalizeQuickStandingThumbCrop(crop) : null;
  const prevCrop = token.quickStandingCrop || null;
  try {
    if (safeCrop) token.quickStandingCrop = safeCrop;
    else delete token.quickStandingCrop;
    if (St.tokens && St.tokens[token.id]) {
      if (safeCrop) St.tokens[token.id].quickStandingCrop = safeCrop;
      else delete St.tokens[token.id].quickStandingCrop;
    }
    if (window._FB?.CONFIGURED && St.roomCode) {
      const { db, ref, update } = window._FB;
      await update(ref(db, `rooms/${St.roomCode}/tokens/${token.id}`), { quickStandingCrop: safeCrop });
    }
    renderQuickStandingMenu();
    showToast(safeCrop ? '스탠딩 썸네일 크롭을 저장했어요.' : '스탠딩 썸네일 크롭을 초기화했어요.');
  } catch (err) {
    if (prevCrop) token.quickStandingCrop = prevCrop;
    else delete token.quickStandingCrop;
    if (St.tokens && St.tokens[token.id]) {
      if (prevCrop) St.tokens[token.id].quickStandingCrop = prevCrop;
      else delete St.tokens[token.id].quickStandingCrop;
    }
    console.error('quick standing crop save failed', err);
    showToast('스탠딩 크롭 저장에 실패했어요.');
  }
}

async function saveQuickStandingIndividualThumbCrop(journal, token, standingIndex, crop) {
  if (!journal?.id || !token?.id) return;
  if (!canEditQuickStandingCrop(journal, token)) {
    showToast('스탠딩 크롭 설정 권한이 없어요.');
    return;
  }
  const index = Number(standingIndex);
  const standings = Array.isArray(token.standings) ? token.standings : [];
  const standing = standings[index];
  if (!Number.isInteger(index) || index < 0 || !standing) {
    showToast('개별 크롭을 적용할 스탠딩을 찾을 수 없어요.');
    return;
  }
  const safeCrop = crop ? normalizeQuickStandingThumbCrop(crop) : null;
  const prevQuickCrop = standing.quickStandingCrop || null;
  const prevThumbCrop = standing.thumbCrop || null;
  try {
    if (safeCrop) standing.quickStandingCrop = safeCrop;
    else delete standing.quickStandingCrop;
    delete standing.thumbCrop;
    if (St.tokens && St.tokens[token.id] && Array.isArray(St.tokens[token.id].standings) && St.tokens[token.id].standings[index]) {
      if (safeCrop) St.tokens[token.id].standings[index].quickStandingCrop = safeCrop;
      else delete St.tokens[token.id].standings[index].quickStandingCrop;
      delete St.tokens[token.id].standings[index].thumbCrop;
    }
    if (window._FB?.CONFIGURED && St.roomCode) {
      const { db, ref, update } = window._FB;
      await update(ref(db, `rooms/${St.roomCode}/tokens/${token.id}/standings/${index}`), { quickStandingCrop: safeCrop, thumbCrop: null });
    }
    renderQuickStandingMenu();
    showToast(safeCrop ? '개별 스탠딩 크롭을 저장했어요.' : '개별 스탠딩 크롭을 초기화했어요.');
  } catch (err) {
    if (prevQuickCrop) standing.quickStandingCrop = prevQuickCrop;
    else delete standing.quickStandingCrop;
    if (prevThumbCrop) standing.thumbCrop = prevThumbCrop;
    else delete standing.thumbCrop;
    if (St.tokens && St.tokens[token.id] && Array.isArray(St.tokens[token.id].standings) && St.tokens[token.id].standings[index]) {
      if (prevQuickCrop) St.tokens[token.id].standings[index].quickStandingCrop = prevQuickCrop;
      else delete St.tokens[token.id].standings[index].quickStandingCrop;
      if (prevThumbCrop) St.tokens[token.id].standings[index].thumbCrop = prevThumbCrop;
      else delete St.tokens[token.id].standings[index].thumbCrop;
    }
    console.error('quick standing individual crop save failed', err);
    showToast('개별 스탠딩 크롭 저장에 실패했어요.');
  }
}

function bindQuickStandingCropEditor(menu, journal, token, cropState) {
  if (!menu || !cropState) return;
  const preview = menu.querySelector('.map-quick-standing-crop-preview');
  const range = menu.querySelector('.map-quick-standing-crop-range');
  const backBtn = menu.querySelector('.map-quick-standing-crop-back');
  const saveBtn = menu.querySelector('.map-quick-standing-crop-save');
  const resetBtn = menu.querySelector('.map-quick-standing-crop-reset');
  const clampCrop = () => {
    cropState.crop.cx = clampQuickStandingCropValue(cropState.crop.cx, 0, 1, 0.5);
    cropState.crop.cy = clampQuickStandingCropValue(cropState.crop.cy, 0, 1, 0.5);
    cropState.crop.zoom = clampQuickStandingCropValue(cropState.crop.zoom, 1, 3, 1);
  };
  if (backBtn) {
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      renderQuickStandingMenu();
    });
  }
  if (range) {
    range.addEventListener('input', () => {
      cropState.crop.zoom = clampQuickStandingCropValue(Number(range.value) / 100, 1, 3, 1);
      updateQuickStandingCropPreview(menu, cropState.crop);
    });
  }
  if (preview) {
    const startDrag = (e) => {
      e.preventDefault();
      e.stopPropagation();
      cropState.dragging = true;
      cropState.lastX = e.clientX;
      cropState.lastY = e.clientY;
      preview.setPointerCapture?.(e.pointerId);
      preview.classList.add('dragging');
    };
    const moveDrag = (e) => {
      if (!cropState.dragging) return;
      e.preventDefault();
      const rect = preview.getBoundingClientRect();
      const zoom = Math.max(1, Number(cropState.crop.zoom) || 1);
      const dx = e.clientX - cropState.lastX;
      const dy = e.clientY - cropState.lastY;
      cropState.lastX = e.clientX;
      cropState.lastY = e.clientY;
      cropState.crop.cx -= dx / Math.max(1, rect.width * zoom);
      cropState.crop.cy -= dy / Math.max(1, rect.height * zoom);
      clampCrop();
      updateQuickStandingCropPreview(menu, cropState.crop);
    };
    const endDrag = (e) => {
      if (!cropState.dragging) return;
      cropState.dragging = false;
      preview.classList.remove('dragging');
      try { preview.releasePointerCapture?.(e.pointerId); } catch (_) {}
    };
    preview.addEventListener('pointerdown', startDrag);
    preview.addEventListener('pointermove', moveDrag);
    preview.addEventListener('pointerup', endDrag);
    preview.addEventListener('pointerleave', endDrag);
    preview.addEventListener('pointercancel', endDrag);
  }
  if (saveBtn) {
    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      clampCrop();
      if (Number.isInteger(cropState.standingIndex)) {
        await saveQuickStandingIndividualThumbCrop(journal, token, cropState.standingIndex, cropState.crop);
      } else {
        await saveQuickStandingThumbCrop(journal, token, cropState.crop);
      }
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (Number.isInteger(cropState.standingIndex)) {
        await saveQuickStandingIndividualThumbCrop(journal, token, cropState.standingIndex, null);
      } else {
        await saveQuickStandingThumbCrop(journal, token, null);
      }
    });
  }
}

function renderQuickStandingCropEditor(options = {}) {
  const menu = getQuickStandingMenuEl();
  if (!menu) return;
  bindQuickStandingMenuScrollGuard(menu);
  const ctx = getSelectedQuickStandingContext();
  getQuickStandingButtonEl()?.classList.add('is-open');
  if (ctx.error) {
    menu.innerHTML = getStandingQuickEmptyHtml(ctx.error);
    bindQuickStandingCloseButton(menu);
    menu.style.display = 'flex';
    return;
  }
  const { journal, token, standings } = ctx;
  if (!canEditQuickStandingCrop(journal, token)) {
    showToast('스탠딩 크롭 설정 권한이 없어요.');
    renderQuickStandingMenu();
    return;
  }
  const requestedIndex = Number(options?.standingIndex);
  const isIndividual = Number.isInteger(requestedIndex) && requestedIndex >= 0;
  const standingIndex = isIndividual ? requestedIndex : null;
  const baseStanding = isIndividual ? standings[standingIndex] : standings[0];
  if (!baseStanding) {
    showToast(isIndividual ? '개별 크롭 기준으로 사용할 스탠딩을 찾을 수 없어요.' : '크롭 기준으로 사용할 스탠딩 이미지가 없어요.');
    renderQuickStandingMenu();
    return;
  }
  const baseImg = String(baseStanding.img || '').trim();
  if (!baseImg) {
    showToast('크롭 기준으로 사용할 스탠딩 이미지가 없어요.');
    renderQuickStandingMenu();
    return;
  }
  const title = String(journal?.title || '무제 저널').trim() || '무제 저널';
  const baseLabel = getQuickStandingDisplayLabel(baseStanding.label || (isIndividual ? '선택한 스탠딩' : '첫 번째 스탠딩'));
  const currentCrop = isIndividual
    ? (getQuickStandingIndividualThumbCrop(baseStanding) || normalizeQuickStandingThumbCrop(token?.quickStandingCrop || null) || getDefaultQuickStandingThumbCrop())
    : (normalizeQuickStandingThumbCrop(token?.quickStandingCrop || null) || getDefaultQuickStandingThumbCrop());
  const cropState = { crop: { ...currentCrop }, dragging: false, lastX: 0, lastY: 0, standingIndex };
  menu.innerHTML = `
    <div class="map-quick-standing-head crop-mode">
      <button type="button" class="map-quick-standing-crop-back" aria-label="스탠딩 목록으로 돌아가기">‹</button>
      <span>${esc(title)} ${isIndividual ? '개별 크롭' : '크롭 기능'}</span>
      <div class="map-quick-standing-head-actions">${getQuickStandingCloseButtonHtml()}</div>
    </div>
    <div class="map-quick-standing-crop-editor">
      <div class="map-quick-standing-crop-preview" title="드래그해서 썸네일 중심을 조정">
        <img class="map-quick-standing-crop-image" src="${esc(baseImg)}" alt="" style="${getQuickStandingCropPreviewStyle(cropState.crop)}">
        <span class="map-quick-standing-crop-frame" aria-hidden="true"></span>
      </div>
      <div class="map-quick-standing-crop-meta">
        <span>${isIndividual ? '개별 이미지' : '기준 이미지'}</span>
        <strong>${esc(baseLabel)}</strong>
      </div>
      <label class="map-quick-standing-crop-slider">
        <span>크기</span>
        <input type="range" min="100" max="300" step="1" value="${Math.round(cropState.crop.zoom * 100)}" class="map-quick-standing-crop-range">
        <em class="map-quick-standing-crop-value">${Math.round(cropState.crop.zoom * 100)}%</em>
      </label>
      <p class="map-quick-standing-crop-help">${isIndividual ? '이미지를 드래그해 이 스탠딩 하나에만 적용할 썸네일 중심을 맞춥니다. 저장하면 전체 크롭보다 개별 크롭이 우선 적용됩니다.' : '이미지를 드래그해 썸네일 중심을 맞추고, 크기로 확대 비율을 조정합니다. 저장하면 이 토큰의 모든 스탠딩 퀵뷰 썸네일에 같은 영역이 적용됩니다.'}</p>
      <div class="map-quick-standing-crop-actions">
        <button type="button" class="map-quick-standing-crop-reset">초기화</button>
        <button type="button" class="map-quick-standing-crop-save primary">저장</button>
      </div>
    </div>`;
  updateQuickStandingCropPreview(menu, cropState.crop);
  bindQuickStandingCloseButton(menu);
  bindQuickStandingCropEditor(menu, journal, token, cropState);
  menu.style.display = 'flex';
}

async function selectQuickStanding(journal, token, standing) {
  if (!journal?.id || !token?.id || !standing) return;
  if (!canChangeQuickStanding(journal, token)) {
    showToast('스탠딩 변경 권한이 없어요.');
    return;
  }
  const label = normalizeQuickStandingLabel(standing.label || '');
  if (!label) {
    showToast('이름이 없는 스탠딩은 선택할 수 없어요.');
    return;
  }
  const patch = {
    currentStandingLabel: label,
    currentStandingJournalId: journal.id,
  };
  const prevLabel = token.currentStandingLabel || '';
  const prevJournalId = token.currentStandingJournalId || '';
  try {
    token.currentStandingLabel = label;
    token.currentStandingJournalId = journal.id;
    if ((typeof _vnCurrentStanding !== 'undefined' ? _vnCurrentStanding : null)) (typeof _vnCurrentStanding !== 'undefined' ? _vnCurrentStanding : null)[journal.id] = label;
    if (window._FB?.CONFIGURED && St.roomCode) {
      const { db, ref, update } = window._FB;
      await update(ref(db, `rooms/${St.roomCode}/tokens/${token.id}`), patch);
    } else {
      St.tokens[token.id] = { ...token };
    }
    if (typeof addOrUpdateSingleToken === 'function') addOrUpdateSingleToken(token.id, St.tokens[token.id] || token);
    else if (typeof renderAllTokens === 'function') renderAllTokens(St.tokens);
    if (typeof saRefreshToolbar === 'function') saRefreshToolbar();
    renderQuickStandingMenu();
    showToast(`${getQuickStandingDisplayLabel(label)} 스탠딩으로 변경했어요.`);
  } catch (err) {
    token.currentStandingLabel = prevLabel;
    token.currentStandingJournalId = prevJournalId;
    if (typeof addOrUpdateSingleToken === 'function') addOrUpdateSingleToken(token.id, St.tokens[token.id] || token);
    console.error('standing quick select failed', err);
    showToast('스탠딩 변경에 실패했어요.');
  }
}

function toggleQuickStandingView(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const menu = getQuickStandingMenuEl();
  if (menu && menu.style.display !== 'none' && menu.innerHTML.trim()) return;
  closeQuickJournalMenu();
  renderQuickStandingMenu();
}


function closeQuickJournalMenu() {
  const menu = getQuickJournalMenuEl();
  if (!menu) return;
  menu.style.display = 'none';
  menu.innerHTML = '';
}

function getQuickJournalAvatarHtml(journal) {
  const title = String(journal?.title || '무제 저널').trim() || '무제 저널';
  const fallback = title[0]?.toUpperCase() || '?';
  const avatarSrc = getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(
    (typeof saGetAvatar === 'function' ? saGetAvatar(journal.id) : '')
    || journal?.avatar
    || journal?.sheet?.avatar
    || ''
  );
  if (avatarSrc) {
    return `<span class="map-quick-journal-avatar" aria-hidden="true"><img src="${esc(avatarSrc)}" alt=""></span>`;
  }
  return `<span class="map-quick-journal-avatar fallback" aria-hidden="true">${esc(fallback)}</span>`;
}

function renderQuickJournalMenu() {
  const menu = getQuickJournalMenuEl();
  if (!menu) return;
  const list = loadJournals();
  if (!list.length) {
    menu.innerHTML = '<div class="map-quick-journal-empty">열 수 있는 저널이 없어요.</div>';
    menu.style.display = 'flex';
    return;
  }
  menu.innerHTML = list.map(j => {
    const title = String(j?.title || '무제 저널').trim() || '무제 저널';
    return `<button type="button" class="map-quick-journal-item" data-jid="${esc(j.id)}">${getQuickJournalAvatarHtml(j)}<span class="map-quick-journal-name">${esc(title)}</span></button>`;
  }).join('');
  menu.querySelectorAll('.map-quick-journal-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeQuickJournalMenu();
      openQuickJournalSheet(btn.dataset.jid || '');
    });
  });
  menu.style.display = 'flex';
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
  closeQuickStandingMenu();
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

// 스탠딩 퀵뷰는 외부 클릭이나 Escape로 닫지 않고, 패널 우측 상단 X 버튼으로만 닫습니다.

function openSheet(journalId) {
  _sheetIsNew = false;
  const existingWrap = document.getElementById('sh-skills-wrap');
  if (existingWrap) existingWrap.innerHTML = '';
  initSheetUI();
  _sheetJournalId = journalId;
  const list = loadJournals();
  const j    = list.find(x => x.id === journalId);
  const data = j?.sheet || {};

  ['name','player','job','age','height','sex','nationality','residence','birthplace','first_language'].forEach(k => {
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

  ['status-temp-insane','status-indefinite','status-major-wound','status-dying'].forEach(k => {
    const el = document.getElementById('sh-'+k);
    if (el) el.checked = !!data[k.replace(/-/g, '_')];
  });

  COC_SKILLS.forEach((sk, i) => {
    const ck  = document.getElementById('sk-check-'+i);
    const val = document.getElementById('sk-val-'+i);
    const hlf = document.getElementById('sk-half-'+i);
    const fif = document.getElementById('sk-fifth-'+i);
    const d   = data.skills?.[i] || {};
    if (ck)  ck.checked    = d.checked || false;
    if (val) val.value     = d.val  !== undefined ? d.val  : sk.base;
    if (hlf) hlf.value     = d.half !== undefined ? d.half : Math.floor((d.val !== undefined ? d.val : sk.base)/2);
    if (fif) fif.value     = d.fifth !== undefined ? d.fifth : Math.floor((d.val !== undefined ? d.val : sk.base)/5);
  });
  renderCustomSheetSkillRows(data.customSkills || []);

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
  const portraitToggle = document.getElementById('sh-show-portrait-dialogue');
  if (portraitToggle) portraitToggle.checked = j?.showPortraitInDialogue === true || data.showPortraitInDialogue === true;

  refreshJournalTokenBar(j?.assignedTokenId || null);

  _sheetAssignedTo = j?.assignedTo || [];
  refreshSheetAssignBar(j);

  const canEditSheet = canEditJournalEntry(j);
  setSheetEditorMode(canEditSheet);

  const delBtn = document.querySelector('.sheet-del-btn');
  if (delBtn) delBtn.style.display = canDeleteJournalById(journalId) ? '' : 'none';
  document.getElementById('sheet-overlay').classList.add('open');
}

function closeSheet() {
  clearQuickSheetInteractionCleanup();
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
  closeQuickStandingMenu();
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

let _combatRowCount = 0;

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
  const targetJournalId = _sheetJournalId;
  const existingJournal = _allJournals.find(j => j.id === _sheetJournalId) || null;
  if (existingJournal && !canEditJournalEntry(existingJournal)) {
    showToast('저널 접근 권한이 있는 플레이어만 저장할 수 있어요.');
    return;
  }
  const targetAssignedTokenId = _jdAssignedTokenId || null;
  const targetAssignedTo = Array.isArray(_sheetAssignedTo) ? [..._sheetAssignedTo] : (_sheetAssignedTo || []);
  const data = {};

  ['name','player','job','age','height','sex','nationality','residence','birthplace','first_language'].forEach(k => {
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

  ['status-temp-insane','status-indefinite','status-major-wound','status-dying'].forEach(k => {
    data[k.replace(/-/g, '_')] = !!document.getElementById('sh-'+k)?.checked;
  });

  data.skills = COC_SKILLS.map((sk, i) => ({
    checked: document.getElementById('sk-check-'+i)?.checked || false,
    val: parseInt(document.getElementById('sk-val-'+i)?.value, 10) || sk.base,
    half: parseInt(document.getElementById('sk-half-'+i)?.value, 10) || Math.floor((parseInt(document.getElementById('sk-val-'+i)?.value, 10) || sk.base)/2),
    fifth: parseInt(document.getElementById('sk-fifth-'+i)?.value, 10) || Math.floor((parseInt(document.getElementById('sk-val-'+i)?.value, 10) || sk.base)/5),
  }));
  data.customSkills = readCustomSkillRowsFromSheet();

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

  data.showPortraitInDialogue = !!document.getElementById('sh-show-portrait-dialogue')?.checked;

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
      || getSharedJournalAvatarRuntime().readStoredAvatar(targetJournalId)
      || existing.avatar
      || null
    );
    if (_keepAv) {
      data.avatar = _keepAv;
      existing.avatar = _keepAv;
      saSetAvatar(targetJournalId, _keepAv);
    }

    const metaPatch = {
      ownerId: existing.ownerId || St.myId,
      title: data.name || existing.title,
      updatedAt: Date.now(),
      assignedTokenId: targetAssignedTokenId,
      showPortraitInDialogue: !!data.showPortraitInDialogue,
    };
    if (_sheetAssignedTo !== undefined) metaPatch.assignedTo = targetAssignedTo;
    if (_keepAv) metaPatch.avatar = _keepAv;

    existing.sheet = data;
    existing.title = metaPatch.title;
    existing.updatedAt = metaPatch.updatedAt;
    existing.assignedTokenId = metaPatch.assignedTokenId;
    existing.showPortraitInDialogue = !!metaPatch.showPortraitInDialogue;
    if (_sheetAssignedTo !== undefined) existing.assignedTo = metaPatch.assignedTo;

    saveJournalSheetFB(targetJournalId, data, metaPatch);
  } else {
    const newJ = {
      id: targetJournalId,
      title: data.name || '무제 저널',
      body: '',
      sheet: data,
      ownerId: St.myId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assignedTokenId: targetAssignedTokenId,
      assignedTo: targetAssignedTo,
      showPortraitInDialogue: !!data.showPortraitInDialogue,
    };
    const newAvatar = getSharedJournalAvatarRuntime().sanitizePersistentAvatarSrc(_sheetAvatarStoredUrl || _sheetAvatarData || null);
    if (newAvatar) {
      newJ.avatar = newAvatar;
      data.avatar = newAvatar;
      saSetAvatar(targetJournalId, newAvatar);
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


window.importCcfoliaApiToJournal = importCcfoliaApiToJournal;

function openJournalApiImportModal() {
  if (!St.roomCode) { showToast('방에 입장한 상태에서만 가져올 수 있어요.'); return; }
  const overlay = document.getElementById('journal-api-overlay');
  const input = document.getElementById('journal-api-input');
  if (!overlay || !input) return;
  overlay.classList.add('open');
  setTimeout(() => { if (input && input.isConnected) input.focus(); }, 20);
}

function closeJournalApiImportModal() {
  const overlay = document.getElementById('journal-api-overlay');
  const input = document.getElementById('journal-api-input');
  if (overlay) overlay.classList.remove('open');
  if (input) input.value = '';
}

async function submitJournalApiImport() {
  const input = document.getElementById('journal-api-input');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) { showToast('API 코드를 붙여넣어 주세요.'); input.focus(); return; }
  const result = await importCcfoliaApiToJournal(raw);
  if (!result?.handled) {
    showToast('올바른 CCFOLIA character API 코드가 아니에요.');
    input.focus();
    return;
  }
  if (!result?.created) return;
  closeJournalApiImportModal();
}

window.openJournalApiImportModal = openJournalApiImportModal;
window.closeJournalApiImportModal = closeJournalApiImportModal;
window.submitJournalApiImport = submitJournalApiImport;
