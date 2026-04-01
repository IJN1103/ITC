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
  if (!isSecret) sendMessage(St.myName, chatText, 'dice');
  else addLocalMessage('dice', St.myName, `🎲 [비밀] ${d.l} → ${total}`);

  if (window._FB?.CONFIGURED && !isSecret) {
    const { db, ref, set } = window._FB;
    set(ref(db, `rooms/${St.roomCode}/lastRoll`), { ...rollObj, time: getDiceServerTimestamp() });
  }
}

function rollSkillCheck(name, val) {
  const r = Math.ceil(Math.random()*100);
  let j = '', jc = '';
  if (r <= 5 || r <= Math.floor(val/5)) { j='극성공!'; jc='j-exs'; }
  else if (r <= Math.floor(val/2))       { j='어려운 성공'; jc='j-succ'; }
  else if (r <= val)                     { j='성공'; jc='j-succ'; }
  else if (r >= 96)                      { j='치명적 실패!'; jc='j-fumb'; }
  else                                   { j='실패'; jc='j-fail'; }

  showRollResult({ total:r, detail:`${name}(${val}%): ${r}`, rolls:[r] });
  document.getElementById('roll-judgment').innerHTML = `<div class="roll-judgment ${jc}">${j}</div>`;
  sendMessage(St.myName, `🎲 ${name}(${val}%) → ${r} — ${j}`, 'dice');
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

  if (tokens.length === 0) { showToast('올바른 수식이 아니에요. 예: /1d100, /2d6+3'); return; }

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

    // NdS 패턴
    const diceMatch = expr.match(/^(\d+)?d(\d+)$/);
    if (diceMatch) {
      const count = parseInt(diceMatch[1] || '1');
      const sides = parseInt(diceMatch[2]);
      if (count < 1 || count > 100 || sides < 1 || sides > 10000) { valid = false; break; }
      const rolls = [];
      for (let i = 0; i < count; i++) rolls.push(Math.ceil(Math.random() * sides));
      const sum = rolls.reduce((a, b) => a + b, 0);
      grandTotal += sign * sum;
      allRolls.push(...rolls);
      allDetails.push((sign < 0 ? '-' : (allDetails.length > 0 ? '+' : '')) + `${count}d${sides}[${rolls.join(',')}]`);
      labelParts.push((sign < 0 ? '-' : (labelParts.length > 0 ? '+' : '')) + `${count}d${sides}`);
      continue;
    }

    // 상수
    const num = parseInt(expr);
    if (!isNaN(num)) {
      grandTotal += sign * num;
      allDetails.push((sign < 0 ? '-' : (allDetails.length > 0 ? '+' : '')) + String(num));
      labelParts.push((sign < 0 ? '-' : (labelParts.length > 0 ? '+' : '')) + String(num));
      continue;
    }

    valid = false;
    break;
  }

  if (!valid) {
    showToast('올바른 수식이 아니에요. 예: /1d100, /2d6+3, /1d100+2d20');
    return;
  }

  const label = labelParts.join('');
  const detail = allDetails.join(' ') + ' = ' + grandTotal;
  const rollObj = { playerId: St.myId, player: St.myName, dice: label, total: grandTotal, rolls: allRolls, detail, time: Date.now() };
  showRollResult(rollObj);
  sendMessage(St.myName, `🎲 ${label} → ${grandTotal}  (${detail})`, 'dice');
  if (window._FB?.CONFIGURED) {
    const { db, ref, set } = window._FB;
    set(ref(db, `rooms/${St.roomCode}/lastRoll`), { ...rollObj, time: getDiceServerTimestamp() });
  }
}

