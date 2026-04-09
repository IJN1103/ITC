/**
 * ITC TRPG — Dice 모듈
 * 다이스 버튼, 굴림, 수식 파서
 */

function getDiceServerTimestamp() {
  return (window._FB?.CONFIGURED && typeof window._FB.serverTimestamp === 'function')
    ? window._FB.serverTimestamp()
    : Date.now();
}

const DICE_CONFIGS = {
  coc7: [{l:'D100',s:100,i:'⬡'},{l:'D10',s:10,i:'◆'},{l:'D6',s:6,i:'■'},{l:'D4',s:4,i:'▲'},{l:'D8',s:8,i:'◈'},{l:'D20',s:20,i:'◉'}],
  dx3:  [{l:'DX',s:10,i:'◆',dx:true},{l:'D6',s:6,i:'■'},{l:'D10',s:10,i:'◆'}],
  shinobigami: [{l:'D6',s:6,i:'■'},{l:'2D6',s:6,i:'■■',c:2},{l:'D66',s:6,i:'◆◆',d66:true}],
  insane:      [{l:'D6',s:6,i:'■'},{l:'2D6',s:6,i:'■■',c:2},{l:'D66',s:6,i:'◆◆',d66:true}],
};

function renderDiceButtons(sys) {
  const container = document.getElementById('dice-btns');
  const cfgs = DICE_CONFIGS[sys] || DICE_CONFIGS.coc7;
  container.innerHTML = cfgs.map((d, i) => `
    <button class="dice-btn" onclick="rollDice(${i})" id="dBtn-${i}">
      <div class="d-icon">${d.i}</div>
      <div>${d.l}</div>
    </button>`).join('');
}

function rollDice(ci) {
  const cfgs = DICE_CONFIGS[St.system] || DICE_CONFIGS.coc7;
  const d = cfgs[ci];
  const count = parseInt(document.getElementById('dice-count').value) || 1;
  const isSecret = document.getElementById('secret-roll').checked;

  const btn = document.getElementById('dBtn-' + ci);
  if (btn) {
    btn.classList.add('rolling');
    setTimeout(() => { if (btn && btn.isConnected) btn.classList.remove('rolling'); }, 400);
  }

  let rolls = [], total = 0, detail = '';

  if (d.d66) {
    const a = Math.ceil(Math.random()*6), b = Math.ceil(Math.random()*6);
    total = a*10+b; rolls = [a,b]; detail = `D66 [${a}][${b}] = ${total}`;
  } else if (d.dx) {
    let pool = count, allRolls = [];
    while (pool > 0) {
      let next = 0;
      for (let i = 0; i < pool; i++) { const r = Math.ceil(Math.random()*10); allRolls.push(r); if (r===10) next++; }
      pool = next;
    }
    rolls = allRolls; total = Math.max(...allRolls);
    detail = `DX [${allRolls.join(',')}] 최고: ${total}`;
  } else {
    const n = d.c || count;
    for (let i = 0; i < n; i++) { const r = Math.ceil(Math.random()*d.s); rolls.push(r); }
    total = rolls.reduce((a,b)=>a+b,0);
    detail = `${d.l}${n>1?'×'+n:''}: [${rolls.join('+')}] = ${total}`;
  }

  const rollObj = { playerId: St.myId, player: St.myName, dice: d.l, total, rolls, detail, secret: isSecret, time: Date.now() };
  showRollResult(rollObj);

  const chatText = `🎲 ${d.l} → ${total}  (${rolls.join(', ')})`;
  if (!isSecret) {
    const speakAsContext = (typeof window.saGetSelectedJournalContext === 'function')
      ? window.saGetSelectedJournalContext(chatText) : null;
    const senderName = speakAsContext?.name || St.myName;
    const extra = speakAsContext
      ? { speakAsAvatar: speakAsContext.speakAsAvatar || null, speakAsJournalId: speakAsContext.speakAsJournalId || null, nameColor: speakAsContext.nameColor || '', tokenId: speakAsContext.tokenId || null, standingLabel: speakAsContext.standingLabel || '' }
      : null;
    sendMessage(senderName, chatText, 'dice', extra);
  }
  else addLocalMessage('dice', St.myName, `🎲 [비밀] ${d.l} → ${total}`);

  if (window._FB?.CONFIGURED && !isSecret) {
    const { db, ref, set } = window._FB;
    set(ref(db, `rooms/${St.roomCode}/lastRoll`), { ...rollObj, time: getDiceServerTimestamp() });
  }
}

function getSkillCheckOutcome(val, r) {
  const target = Math.max(0, Number(val) || 0);
  if (r === 1) {
    return { label: '크리티컬', className: 'j-crit', success: true };
  }
  if (r === 100) {
    return { label: '펌블', className: 'j-fumb', success: false };
  }
  if (target > 0 && r <= Math.floor(target / 5)) {
    return { label: '극단적 성공', className: 'j-succ', success: true };
  }
  if (target > 0 && r <= Math.floor(target / 2)) {
    return { label: '어려운 성공', className: 'j-succ', success: true };
  }
  if (target > 0 && r <= target) {
    return { label: '보통 성공', className: 'j-succ', success: true };
  }
  return { label: '실패', className: 'j-fail', success: false };
}

function renderSkillCheckResult(name, val, r, outcome) {
  showRollResult({ total: r, detail: `${name} 판정(${val}%): ${r}`, rolls: [r] });
  const judgmentEl = document.getElementById('roll-judgment');
  if (judgmentEl) judgmentEl.innerHTML = `<div class="roll-judgment ${outcome.className}">${outcome.label}</div>`;
}

function sendSkillCheckMessage(name, val, r, outcome) {
  const text = `🎲 ${name} 판정 → ${r} (목표치 ${val}||${outcome.label})`;
  const speakAsContext = (typeof window.saGetSelectedJournalContext === 'function')
    ? window.saGetSelectedJournalContext(text)
    : null;
  const senderName = speakAsContext?.name || St.myName;
  const extra = speakAsContext
    ? {
        speakAsAvatar: speakAsContext.speakAsAvatar || null,
        speakAsJournalId: speakAsContext.speakAsJournalId || null,
        nameColor: speakAsContext.nameColor || '',
        tokenId: speakAsContext.tokenId || null,
        standingLabel: speakAsContext.standingLabel || '',
      }
    : null;
  sendMessage(senderName, text, 'dice', extra);
}

function rollSkillCheck(name, val) {
  const target = Math.max(0, Number(val) || 0);
  const r = Math.ceil(Math.random() * 100);
  const outcome = getSkillCheckOutcome(target, r);
  renderSkillCheckResult(name, target, r, outcome);
  sendSkillCheckMessage(name, target, r, outcome);
}

function rollJournalSheetSkillCheck(name, val) {
  const target = Math.max(0, Number(val) || 0);
  if (!target) {
    showToast('판정할 기능치 값이 없어요.');
    return;
  }
  const r = Math.ceil(Math.random() * 100);
  const outcome = getSkillCheckOutcome(target, r);
  renderSkillCheckResult(name, target, r, outcome);
  sendSkillCheckMessage(name, target, r, outcome);
}

function showRollResult(roll) {
  const n = document.getElementById('roll-num');
  const strEl = document.getElementById('roll-str');
  if (!n || !strEl) return;
  n.style.opacity = '0';
  setTimeout(() => {
    if (!n || !n.isConnected) return;
    n.textContent = roll.total;
    n.style.opacity = '1';
  }, 120);
  strEl.textContent = roll.detail || '';
}

function rollFromFormula(formula) {
  formula = formula.replace(/\s/g, '').toLowerCase();

  // 수식을 +/- 기준으로 토큰 분리: "1d100+2d20-5" → ["+1d100", "+2d20", "-5"]
  const tokens = [];
  let buf = '';
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if ((ch === '+' || ch === '-') && i > 0) {
      tokens.push(buf);
      buf = ch;
    } else {
      buf += ch;
    }
  }
  if (buf) tokens.push(buf);

  if (tokens.length === 0) { showToast('올바른 수식이 아니에요. 예: /1d100, /2d6+3, /3d6*6'); return; }

  let grandTotal = 0;
  const allDetails = [];
  const allRolls = [];
  let labelParts = [];
  let valid = true;

  for (const token of tokens) {
    // 부호 분리
    let sign = 1;
    let expr = token;
    if (expr.startsWith('+')) { expr = expr.slice(1); }
    else if (expr.startsWith('-')) { sign = -1; expr = expr.slice(1); }

    // NdS 패턴 (NdS*M, NdS/M 포함)
    const diceMatch = expr.match(/^(\d+)?d(\d+)(?:([*/])(\d+))?$/);
    if (diceMatch) {
      const count = parseInt(diceMatch[1] || '1');
      const sides = parseInt(diceMatch[2]);
      const mulOp = diceMatch[3] || '';
      const mulVal = parseInt(diceMatch[4] || '0');
      if (count < 1 || count > 100 || sides < 1 || sides > 10000) { valid = false; break; }
      if (mulOp && (mulVal < 1 || mulVal > 10000)) { valid = false; break; }
      if (mulOp === '/' && mulVal === 0) { valid = false; break; }
      const rolls = [];
      for (let i = 0; i < count; i++) rolls.push(Math.ceil(Math.random() * sides));
      let sum = rolls.reduce((a, b) => a + b, 0);
      const rawSum = sum;
      if (mulOp === '*') sum = sum * mulVal;
      else if (mulOp === '/') sum = Math.floor(sum / mulVal);
      grandTotal += sign * sum;
      allRolls.push(...rolls);
      const mulSuffix = mulOp ? `${mulOp}${mulVal}` : '';
      allDetails.push((sign < 0 ? '-' : (allDetails.length > 0 ? '+' : '')) + `${count}d${sides}[${rolls.join(',')}]${mulSuffix}`);
      labelParts.push((sign < 0 ? '-' : (labelParts.length > 0 ? '+' : '')) + `${count}d${sides}${mulSuffix}`);
      continue;
    }

    // 상수 (N*M, N/M 포함)
    const constMatch = expr.match(/^(\d+)(?:([*/])(\d+))?$/);
    if (constMatch) {
      let num = parseInt(constMatch[1]);
      const cOp = constMatch[2] || '';
      const cVal = parseInt(constMatch[3] || '0');
      if (cOp === '*') num = num * cVal;
      else if (cOp === '/') num = cVal === 0 ? 0 : Math.floor(num / cVal);
      grandTotal += sign * num;
      const display = cOp ? `${constMatch[1]}${cOp}${cVal}` : String(num);
      allDetails.push((sign < 0 ? '-' : (allDetails.length > 0 ? '+' : '')) + display);
      labelParts.push((sign < 0 ? '-' : (labelParts.length > 0 ? '+' : '')) + display);
      continue;
    }

    valid = false;
    break;
  }

  if (!valid) {
    showToast('올바른 수식이 아니에요. 예: /1d100, /2d6+3, /3d6*6');
    return;
  }

  const label = labelParts.join('');
  const detail = allDetails.join(' ') + ' = ' + grandTotal;
  const rollObj = { playerId: St.myId, player: St.myName, dice: label, total: grandTotal, rolls: allRolls, detail, time: Date.now() };
  const chatText = `🎲 ${label} → ${grandTotal}  (${detail})`;
  const speakAsContext = (typeof window.saGetSelectedJournalContext === 'function')
    ? window.saGetSelectedJournalContext(chatText) : null;
  const senderName = speakAsContext?.name || St.myName;
  const extra = speakAsContext
    ? { speakAsAvatar: speakAsContext.speakAsAvatar || null, speakAsJournalId: speakAsContext.speakAsJournalId || null, nameColor: speakAsContext.nameColor || '', tokenId: speakAsContext.tokenId || null, standingLabel: speakAsContext.standingLabel || '' }
    : null;
  showRollResult(rollObj);
  sendMessage(senderName, chatText, 'dice', extra);
  if (window._FB?.CONFIGURED) {
    const { db, ref, set } = window._FB;
    set(ref(db, `rooms/${St.roomCode}/lastRoll`), { ...rollObj, time: getDiceServerTimestamp() });
  }
}

