
function getSharedAvatarRuntime() {
  if (window._itcAvatarRuntime) return window._itcAvatarRuntime;
  return {
    sanitizePersistentAvatarSrc(src) {
      const value = String(src || '').trim();
      if (!value) return '';
      if (/^data:image\//i.test(value) || /^blob:/i.test(value)) return '';
      return value;
    },
    readStoredAvatar(uid) {
      if (!uid) return '';
      try {
        const safe = this.sanitizePersistentAvatarSrc(localStorage.getItem('itc_avatar_' + uid));
        if (!safe) {
          localStorage.removeItem('itc_avatar_' + uid);
          localStorage.removeItem('itc_avatar_path_' + uid);
        }
        return safe;
      } catch (e) {
        return '';
      }
    },
    writeStoredAvatar(uid, src, storagePath = '') {
      if (!uid) return '';
      const safe = this.sanitizePersistentAvatarSrc(src);
      try {
        if (safe) {
          localStorage.setItem('itc_avatar_' + uid, safe);
          if (storagePath) localStorage.setItem('itc_avatar_path_' + uid, storagePath);
          else localStorage.removeItem('itc_avatar_path_' + uid);
        } else {
          localStorage.removeItem('itc_avatar_' + uid);
          localStorage.removeItem('itc_avatar_path_' + uid);
        }
      } catch (e) {}
      return safe;
    },
    rememberAvatar(uid, name, src) {
      window._avatarCache = window._avatarCache || {};
      const safe = this.sanitizePersistentAvatarSrc(src);
      if (uid) {
        if (safe) window._avatarCache[uid] = safe;
        else delete window._avatarCache[uid];
      }
      if (name) {
        if (safe) window._avatarCache[name] = safe;
        else delete window._avatarCache[name];
      }
      return safe;
    },
  };
}

/**
 * ITC TRPG — Popout 모듈
 * 채팅 분리 창 관리
 */

let _popoutWins = [];


function buildPopoutHtml() {
  const S = '<' + 'script>';
  const SE = '</' + 'script>';
  const rc = esc(St.roomCode);
  
  // Collect journal data for the popout
  const journals = loadJournals().map(j => ({
    id: j.id, title: j.title || '무제'
  }));
  const journalJson = JSON.stringify(journals);
  
  const css = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{font-family:'DM Sans',sans-serif;background:#101010;color:#e8e3da;font-size:14px;display:flex;flex-direction:column;height:100vh}
.tabs{display:flex;border-bottom:1px solid #1f1f1f;flex-shrink:0;background:#131313}
.tab{flex:1;background:none;border:none;border-bottom:2px solid transparent;color:#5a5751;padding:9px 4px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:.08em;text-transform:uppercase;text-align:center;transition:.18s ease}
.tab.on{color:#b89a60;border-bottom-color:#b89a60}
.tab:hover:not(.on){color:#8c8882}
.pdm{display:flex;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid #1f1f1f;overflow-x:auto;scrollbar-width:none;background:#121212;flex-shrink:0}
.pdm::-webkit-scrollbar{display:none}
.pdm-btn{position:relative;height:24px;padding:0 10px;border-radius:999px;border:1px solid #2b2b2b;background:#161616;color:#8c8882;font:inherit;font-size:10px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;transition:.18s ease;max-width:120px}
.pdm-btn:hover{border-color:#b89a60;color:#b89a60}
.pdm-btn.on{border-color:rgba(184,154,96,.45);background:rgba(184,154,96,.12);color:#b89a60}
.pdm-label{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:88px}
.pdm-dot{position:absolute;top:2px;right:2px;width:6px;height:6px;border-radius:50%;background:#b89a60;box-shadow:0 0 0 2px #161616;pointer-events:none}
.pane{display:none;flex:1;flex-direction:column;overflow:hidden}
.pane.on{display:flex}
.msgs{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:12px}
.msgs::-webkit-scrollbar{width:4px}
.msgs::-webkit-scrollbar-thumb{background:#262626;border-radius:2px}
.cm{display:flex;gap:10px;margin-bottom:2px}
.av{width:38px;height:38px;flex-shrink:0;border-radius:8px;background:#1e1e1e;border:1px solid #2e2e2e;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:#b89a60;overflow:hidden}
.av img{width:38px;height:38px;object-fit:cover;border-radius:8px;display:block}
.mb{flex:1;min-width:0}
.mn{display:flex;align-items:baseline;gap:6px;margin-bottom:3px}
.nn{font-size:13.5px;font-weight:600;color:#b89a60}
.tm{font-size:9px;color:#5a5751;font-family:'DM Mono',monospace}
.mt{font-size:14.5px;color:#8c8882;line-height:1.65;word-break:break-word}
.ms{justify-content:center}.ms .av{display:none}.ms .mt{color:#5a5751;font-size:12px;font-style:italic;text-align:center}
.dc{background:rgba(184,154,96,.1);border:1px solid rgba(184,154,96,.2);border-radius:8px;padding:10px 14px;text-align:center;margin-top:4px;max-width:70%}
.dc-f{font-size:10px;color:#5a5751;font-family:'DM Mono',monospace;letter-spacing:.08em;margin-bottom:4px}
.dc-r{font-size:34px;font-weight:800;color:#b89a60;font-family:'DM Mono',monospace;line-height:1.2}
.dc-d{font-size:14px;color:#8c8882;font-family:'DM Mono',monospace;margin-top:4px}
.j-list{flex:1;overflow-y:auto;padding:10px}
.j-item{padding:8px 10px;border:1px solid #1f1f1f;border-radius:6px;margin-bottom:6px}
.j-item b{font-size:13px;color:#e8e3da}
.j-item span{font-size:10px;color:#5a5751;display:block;margin-top:2px}
.ptb{border-top:1px solid #1f1f1f;padding:4px 8px;flex-shrink:0;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.sa-row{display:flex;align-items:center;width:100%;gap:4px}
.sa-btn{background:#161616;border:1px solid #1f1f1f;border-radius:6px;color:#8c8882;padding:3px 10px;font:inherit;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:5px;transition:.18s ease;height:28px}
.sa-btn:hover,.sa-btn.active{border-color:#b89a60;color:#b89a60}
.sa-btn .sa-av{width:16px;height:16px;border-radius:4px;object-fit:cover}
.tb-row{display:flex;gap:4px;width:100%}
.tb-btn{background:#161616;border:1px solid #1f1f1f;border-radius:6px;color:#8c8882;padding:3px 10px;font:inherit;font-size:11px;cursor:pointer;transition:.18s ease;height:26px}
.tb-btn:hover,.tb-btn.active{border-color:#b89a60;color:#b89a60}
.sa-dd{display:none;position:absolute;bottom:100%;left:0;right:0;background:#161616;border:1px solid #2e2e2e;border-radius:8px;max-height:200px;overflow-y:auto;z-index:50;margin-bottom:4px;box-shadow:0 -4px 12px rgba(0,0,0,.4)}
.sa-dd.open{display:flex;flex-direction:column}
.sa-dd-item{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;transition:.18s ease;font-size:12px;color:#e8e3da}
.sa-dd-item:hover{background:rgba(184,154,96,.08)}
.sa-dd-item.sel{color:#b89a60}
.sa-dd-av{width:20px;height:20px;border-radius:5px;background:#1e1e1e;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;overflow:hidden;border:1px solid #2e2e2e}
.sa-dd-av img{width:100%;height:100%;object-fit:cover}
.iw{padding:8px;display:flex;gap:6px;flex-shrink:0}
textarea{flex:1;background:#161616;border:1px solid #1f1f1f;border-radius:6px;color:#e8e3da;padding:7px 10px;font-size:13px;resize:none;height:34px;font-family:inherit;outline:none}
textarea:focus{border-color:#b89a60}
textarea::-webkit-scrollbar{width:3px}
textarea::-webkit-scrollbar-thumb{background:#2e2e2e;border-radius:2px}
.sb{width:34px;height:34px;background:#b89a60;border:none;border-radius:6px;color:#080808;cursor:pointer;font-size:15px;flex-shrink:0}
.dsec{justify-content:center}
.dsec .mb{text-align:center}
.dsec-text{font-size:14.5px;color:#8c8882;font-style:italic;line-height:1.65;border-top:1px solid #1f1f1f;border-bottom:1px solid #1f1f1f;padding:10px 0;margin:6px 0}
.sa-btn{display:inline-flex;align-items:center;gap:6px;background:none;border:none;border-radius:6px;color:#5a5751;font-family:inherit;font-size:12.5px;padding:4px 6px;cursor:pointer;transition:.18s ease;letter-spacing:.03em;max-width:180px}
.sa-btn:hover{color:#8c8882}
.sa-btn.active{color:#7c9ece}
.sa-icon{width:28px;height:28px;border-radius:6px;background:#1e1e1e;display:inline-flex;align-items:center;justify-content:center;font-size:14px;overflow:hidden;flex-shrink:0;border:1px solid #2e2e2e}
.sa-icon img{width:28px;height:28px;object-fit:cover;border-radius:6px}
.sa-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.desc-btn,.whisper-btn{display:inline-flex;align-items:center;gap:5px;background:none;border:1px solid #1f1f1f;border-radius:6px;color:#5a5751;font-family:inherit;font-size:11px;padding:4px 10px;cursor:pointer;transition:.18s ease;letter-spacing:.04em;height:26px;box-sizing:border-box}
.desc-btn:hover,.whisper-btn:hover{border-color:#2e2e2e;color:#8c8882}
.desc-btn.active{border-color:#b89a60;color:#b89a60}
.desc-btn.active .dot{background:#b89a60}
.whisper-btn.active{border-color:#9b59b6;color:#9b59b6}
.whisper-btn.active .w-dot{background:#9b59b6}
.dot{width:6px;height:6px;border-radius:50%;background:#5a5751;flex-shrink:0;transition:.18s ease}
textarea.desc-mode{border-color:#b89a60;background:rgba(184,154,96,.05)}
textarea.whisper-mode{border-color:#9b59b6;background:rgba(155,89,182,.05)}
`;

  const htmlBody = `
<div class="tabs" id="tabs"></div>
<div class="pane on" id="p-chat"><div class="pdm" id="pdm"></div><div class="msgs" id="pm-chat"></div></div>
<div class="pane" id="p-casual"><div class="msgs" id="pm-casual"></div></div>
<div class="pane" id="p-journal"><div class="j-list" id="pm-journal"></div></div>
<div class="ptb" id="ptb" style="position:relative">
  <div class="sa-row">
    <button class="sa-btn" id="pop-sa-btn" onclick="toggleSADD()"><span class="sa-icon" id="sa-icon-span"><svg width="11" height="11" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M2 12c0-2.21 2.239-4 5-4s5 1.79 5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span><span class="sa-name" id="sa-name-span">\ub098</span></button>
    <div style="margin-left:auto"></div>
  </div>
  <div class="tb-row">
    <button class="desc-btn" id="pop-desc-btn" onclick="popDesc()"><span class="dot"></span><span>desc</span></button>
    <button class="whisper-btn" id="pop-whisper-btn" onclick="toggleWhisperDD()"><span class="dot w-dot"></span><span id="pop-w-label">\uadc3\ub9d0</span></button>
  </div>
  <div class="sa-dd" id="sa-dd"></div>
  <div class="sa-dd" id="w-dd"></div>
</div>
<div class="iw" id="iw">
  <textarea id="pi" placeholder="\uba54\uc2dc\uc9c0 \uc785\ub825 (Enter \uc804\uc1a1)" rows="1"></textarea>
  <button class="sb" id="sb">\u27a4</button>
</div>
`;

  // Collect player data
  const playersObj = {};
  const pl = St.players || {};
  Object.entries(pl).forEach(([uid, p]) => {
    if (uid === St.myId) return;
    playersObj[uid] = { name: p.name, role: p.role };
  });
  const playersJson = JSON.stringify(playersObj).replace(/</g, '\\x3c');

  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ITC \u2014 ' + rc + '</title><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400&display=swap" rel=stylesheet><style>' + css + '</style></head><body>' + htmlBody + S + buildPopoutScript(journalJson, playersJson) + SE + '</body></html>';
}

function buildPopoutScript(journalJson, playersJson) {
  var L = [];
  L.push('(function(){');
  L.push('var aTab="chat",saJId=null,descMode=false,whisperUid=null,whisperName=null,popDmChannelKey="global";');
  L.push('var journals='+journalJson+',players='+playersJson+';');
  
  // switchTab
  L.push('var tabs=document.getElementById("tabs");');
  L.push('["채팅:chat","잡담:casual","저널:journal"].forEach(function(s,i){var p=s.split(":"),b=document.createElement("button");b.className="tab"+(i===0?" on":"");b.dataset.tab=p[1];b.textContent=p[0];b.onclick=function(){switchTab(p[1])};tabs.appendChild(b)});');
  L.push('function switchTab(t){aTab=t;document.querySelectorAll(".tab").forEach(function(b){b.classList.toggle("on",b.dataset.tab===t)});document.querySelectorAll(".pane").forEach(function(p){p.classList.toggle("on",p.id==="p-"+t)});document.getElementById("iw").style.display=t==="journal"?"none":"";document.getElementById("ptb").style.display=t==="journal"?"none":"";var pdm=document.getElementById("pdm");if(pdm)pdm.style.display=t==="chat"?"flex":"none"}');
  L.push('window.switchTab=switchTab;');
  L.push('function getOpenerState(){try{return window.opener||null}catch(e){return null}}');
  L.push('function getCurrentDmChannelKey(){return String(popDmChannelKey||"global").trim()||"global"}');
  L.push('function setCurrentDmChannelKey(key){popDmChannelKey=String(key||"global").trim()||"global";try{var op=getOpenerState();if(op&&typeof op.markDmChannelSeen==="function")op.markDmChannelSeen(popDmChannelKey);if(op&&typeof op.forcePopoutSync==="function")op.forcePopoutSync()}catch(e){}renderDmBar();syncDmUnreadDots();return popDmChannelKey}');
  L.push('window.getCurrentDmChannelKey=getCurrentDmChannelKey;window.setCurrentDmChannelKey=setCurrentDmChannelKey;');
  L.push('try{var __op=getOpenerState();if(__op&&typeof __op.getCurrentDmChannelKey==="function")popDmChannelKey=String(__op.getCurrentDmChannelKey()||"global")||"global"}catch(e){}');
  L.push('function escHtml(v){return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}');
  L.push('function normalizeMsgType(t){t=String(t||"normal").trim();if(t==="desc"||t==="dsec"||t==="msg-dsec")return "desc";if(t==="system")return "sys";return t||"normal"}');
  L.push('function fmtPopText(v){var s=escHtml(v);s=s.replace(/\\*\\*\\*([\\s\\S]+?)\\*\\*\\*/g,"<b><i>$1</i></b>");s=s.replace(/\\*\\*([\\s\\S]+?)\\*\\*/g,"<i>$1</i>");s=s.replace(/\\*([\\s\\S]+?)\\*/g,"<b>$1</b>");s=s.replace(/\\n/g,"<br>");return s}');
  L.push('function safeMsgHtml(text,fhtml){return fhtml?String(fhtml):fmtPopText(text)}');
  L.push('function renderDmBar(){var host=document.getElementById("pdm");if(!host)return;var op=getOpenerState();if(!op){host.innerHTML="";return}var currentKey=getCurrentDmChannelKey();var html=[];html.push(`<button type="button" class="pdm-btn ${currentKey==="global"?"on":""}" data-role="global"><span class="pdm-label">전체</span></button>`);try{if(op.isDmGmView&&op.isDmGmView()){var players=((op.St&&op.St.players)||{});var me=String((op.St&&op.St.myId)||"");var selected=(typeof op.parseDmChannelKey==="function"?op.parseDmChannelKey(currentKey):[]).filter(function(uid){return String(uid)!==me});Object.keys(players).forEach(function(uid){var p=players[uid]||{};if(String(uid)===me)return;if(String(p.role||"").toLowerCase()==="gm")return;var alias=(typeof op.getDmButtonAlias==="function"?op.getDmButtonAlias(uid):"")||"";var label=alias||String(p.name||"플레이어");html.push(`<button type="button" class="pdm-btn ${(selected.indexOf(uid)>=0&&currentKey!=="global")?"on":""}" data-role="player" data-uid="${escHtml(uid)}"><span class="pdm-label">${escHtml(label)}</span></button>`)})}else if(op.getPlayerVisibleDmChannels){var chans=op.getPlayerVisibleDmChannels((op.St&&op.St.myId)||"")||[];chans.forEach(function(ch){var ids=Array.isArray(ch.participantIds)?ch.participantIds:[];var me=String((op.St&&op.St.myId)||"");var players=((op.St&&op.St.players)||{});var label=ids.filter(function(uid){return String(uid)!==me}).map(function(uid){return String((players[uid]&&players[uid].name)||"플레이어")}).join("+")||"DM";html.push(`<button type="button" class="pdm-btn ${String(currentKey)===String(ch.channelKey||"")?"on":""}" data-role="channel" data-key="${escHtml(ch.channelKey||"")}"><span class="pdm-label">${escHtml(label)}</span></button>`)})}}catch(e){}host.innerHTML=html.join("");var g=host.querySelector("[data-role=global]");if(g)g.onclick=function(){try{setCurrentDmChannelKey("global");switchTab("chat")}catch(e){}};Array.from(host.querySelectorAll("[data-role=player]")).forEach(function(btn){btn.onclick=function(){try{var uid=btn.getAttribute("data-uid")||"";var op=getOpenerState();if(!op)return;var me=String((op.St&&op.St.myId)||"");var cur=(typeof op.parseDmChannelKey==="function"?op.parseDmChannelKey(getCurrentDmChannelKey()):[]).filter(function(id){return String(id)!==me});var i=cur.indexOf(uid);if(i>=0)cur.splice(i,1);else cur.push(uid);var next=(cur.length&&typeof op.buildGmScopedDmChannelKey==="function")?op.buildGmScopedDmChannelKey(cur,me):"global";setCurrentDmChannelKey(next||"global");switchTab("chat")}catch(e){}};btn.oncontextmenu=function(ev){try{ev.preventDefault();var op=getOpenerState();var uid=btn.getAttribute("data-uid")||"";if(!op||!uid||typeof op.getDmButtonAlias!=="function")return false;var current=(op.getDmButtonAlias(uid)||"");var input=window.prompt("표시 이름을 입력해주세요. (최대 8글자, 빈칸 입력 시 초기화)",current);if(input===null)return false;if(typeof op.setDmButtonAlias==="function")op.setDmButtonAlias(uid,input);if(typeof op.refreshDmChannelButtons==="function")op.refreshDmChannelButtons();renderDmBar();return false}catch(e){return false}}});Array.from(host.querySelectorAll("[data-role=channel]")).forEach(function(btn){btn.onclick=function(){try{var key=btn.getAttribute("data-key")||"global";setCurrentDmChannelKey(key);switchTab("chat")}catch(e){}}})}');
L.push('window.renderDmBar=renderDmBar;');
  L.push('function syncDmUnreadDots(){try{var host=document.getElementById("pdm");if(!host)return;var op=getOpenerState();if(!op||typeof op.getDmUnreadState!=="function")return;var chans=typeof op.getAvailableDmChannels==="function"?op.getAvailableDmChannels():[];Array.from(host.querySelectorAll("[data-role=player]")).forEach(function(btn){var uid=btn.getAttribute("data-uid")||"";var has=false;chans.forEach(function(ch){if(Array.isArray(ch.participantIds)&&ch.participantIds.indexOf(uid)>=0&&op.getDmUnreadState(ch.channelKey))has=true});var dot=btn.querySelector(".pdm-dot");if(has){if(!dot){dot=document.createElement("span");dot.className="pdm-dot";btn.appendChild(dot)}}else{if(dot)dot.remove()}});Array.from(host.querySelectorAll("[data-role=channel]")).forEach(function(btn){var key=btn.getAttribute("data-key")||"";var has=key&&op.getDmUnreadState(key);var dot=btn.querySelector(".pdm-dot");if(has){if(!dot){dot=document.createElement("span");dot.className="pdm-dot";btn.appendChild(dot)}}else{if(dot)dot.remove()}})}catch(e){}}');
  L.push('setInterval(function(){renderDmBar();syncDmUnreadDots()},400);');

  // addMsg
  L.push('window.addMsg=function(name,text,type,ch,nc,av,ts,fhtml){');
  L.push('type=normalizeMsgType(type);ch=ch||"chat";var c=document.getElementById("pm-"+ch)||document.getElementById("pm-chat");');
  L.push('var row=document.createElement("div");var isSys=type==="sys"||type==="system"||type==="desc";');
  L.push('if(type==="desc"){row.className="cm dsec";var mb=document.createElement("div");mb.className="mb";mb.style.textAlign="center";var mt=document.createElement("div");mt.className="mt dsec-text";mt.innerHTML=safeMsgHtml(text,fhtml);mb.appendChild(mt);row.appendChild(mb);c.appendChild(row);c.scrollTop=c.scrollHeight;return}');
  L.push('row.className="cm"+(isSys?" ms":"");');
  L.push('if(!isSys){var avD=document.createElement("div");avD.className="av";if(av){var img=document.createElement("img");img.src=av;avD.appendChild(img)}else{avD.textContent=(name||"?")[0].toUpperCase()}row.appendChild(avD)}');
  L.push('var mb=document.createElement("div");mb.className="mb";');
  L.push('if(!isSys){var mn=document.createElement("div");mn.className="mn";var nn=document.createElement("span");nn.className="nn";nn.textContent=name;if(nc)nn.style.color=nc;var tm=document.createElement("span");tm.className="tm";tm.textContent=ts||"";mn.appendChild(nn);mn.appendChild(tm);mb.appendChild(mn)}');
  L.push('var mt=document.createElement("div");mt.className="mt";mt.innerHTML=safeMsgHtml(text,fhtml);mb.appendChild(mt);');
  // dice card
  L.push('if(type==="dice"){var dm=text.match(/[\\u{1F3B2}\\u{1F3AF}]\\s*(.+?)\\s*\\u2192\\s*(\\d+)\\s*\\(([^)]+)\\)/u);if(dm){mt.style.display="none";var dc=document.createElement("div");dc.className="dc";["dc-f","dc-r","dc-d"].forEach(function(cls,i){var d=document.createElement("div");d.className=cls;d.textContent=dm[i+1];dc.appendChild(d)});mb.appendChild(dc)}}');
  L.push('row.appendChild(mb);c.appendChild(row);c.scrollTop=c.scrollHeight};');
  L.push('window.setMessages=function(ch,list){ch=ch||"chat";var c=document.getElementById("pm-"+ch)||document.getElementById("pm-chat");if(!c)return;c.innerHTML="";(Array.isArray(list)?list:[]).forEach(function(item){window.addMsg(item.name,item.text,normalizeMsgType(item.type),item.channel||ch,item.nameColor||"",item.avatar||"",item.time||"",item.fhtml||"")})};');

  // setJournals
  L.push('window.setJournals=function(list){journals=list;var c=document.getElementById("pm-journal");c.innerHTML="";list.forEach(function(j){var d=document.createElement("div");d.className="j-item";var b=document.createElement("b");b.textContent=j.title||"\\uBB34\\uC81C";var s=document.createElement("span");s.textContent=(j.body||"").slice(0,40)||"\\uB0B4\\uC6A9 \\uC5C6\\uC74C";d.appendChild(b);d.appendChild(s);c.appendChild(d)})};');

  // helper: get avatar from opener
  L.push('var _avCache={},_ncCache={};');
  L.push('function getAv(id){return _avCache[id]||""}');
  L.push('function getNc(id){return _ncCache[id]||""}');
  L.push('window.setAvatars=function(m){for(var k in m)_avCache[k]=m[k]};');
  L.push('window.setColors=function(m){_ncCache=m||{}};');

  // speak-as dropdown
  L.push('function toggleSADD(){var dd=document.getElementById("sa-dd");if(dd.classList.contains("open")){dd.classList.remove("open");return}dd.innerHTML="";');
  L.push('var none=document.createElement("div");none.className="sa-dd-item"+(saJId===null?" sel":"");');
  L.push('var nIcon=document.createElement("div");nIcon.className="sa-dd-av";var nSvg=document.createElementNS("http://www.w3.org/2000/svg","svg");nSvg.setAttribute("width","11");nSvg.setAttribute("height","11");nSvg.setAttribute("viewBox","0 0 14 14");nSvg.setAttribute("fill","none");var nc1=document.createElementNS("http://www.w3.org/2000/svg","circle");nc1.setAttribute("cx","7");nc1.setAttribute("cy","5");nc1.setAttribute("r","3");nc1.setAttribute("stroke","currentColor");nc1.setAttribute("stroke-width","1.5");nSvg.appendChild(nc1);var np1=document.createElementNS("http://www.w3.org/2000/svg","path");np1.setAttribute("d","M2 12c0-2.21 2.239-4 5-4s5 1.79 5 4");np1.setAttribute("stroke","currentColor");np1.setAttribute("stroke-width","1.5");np1.setAttribute("stroke-linecap","round");nSvg.appendChild(np1);nIcon.appendChild(nSvg);');
  L.push('none.appendChild(nIcon);var nTxt=document.createElement("span");nTxt.textContent="\\uB098";var mnc=getNc("_me");if(mnc)nTxt.style.color=mnc;none.appendChild(nTxt);');
  L.push('none.onclick=function(){setSA(null,"\\uB098");dd.classList.remove("open")};dd.appendChild(none);');
  L.push('journals.forEach(function(j){var item=document.createElement("div");item.className="sa-dd-item"+(saJId===j.id?" sel":"");var avd=document.createElement("div");avd.className="sa-dd-av";var jav=getAv(j.id);if(jav){var img=document.createElement("img");img.src=jav;avd.appendChild(img)}else{avd.textContent=(j.title||"?")[0].toUpperCase()}item.appendChild(avd);var sp=document.createElement("span");sp.textContent=j.title;var jnc=getNc(j.id);if(jnc)sp.style.color=jnc;item.appendChild(sp);item.onclick=function(){setSA(j.id,j.title);dd.classList.remove("open")};dd.appendChild(item)});');
  L.push('dd.classList.add("open")}');
  L.push('window.toggleSADD=toggleSADD;');

  // setSA
  L.push('function setSA(id,name){saJId=id;var nc=id?getNc(id):"";var av=id?getAv(id):"";var iconSpan=document.getElementById("sa-icon-span");var nameSpan=document.getElementById("sa-name-span");var btn=document.getElementById("pop-sa-btn");nameSpan.textContent=name;nameSpan.style.color=nc;iconSpan.innerHTML="";if(av){var img=document.createElement("img");img.style.cssText="width:28px;height:28px;object-fit:cover;border-radius:6px";img.src=av;iconSpan.appendChild(img)}else{var svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("width","11");svg.setAttribute("height","11");svg.setAttribute("viewBox","0 0 14 14");svg.setAttribute("fill","none");var c=document.createElementNS("http://www.w3.org/2000/svg","circle");c.setAttribute("cx","7");c.setAttribute("cy","5");c.setAttribute("r","3");c.setAttribute("stroke","currentColor");c.setAttribute("stroke-width","1.5");svg.appendChild(c);var p=document.createElementNS("http://www.w3.org/2000/svg","path");p.setAttribute("d","M2 12c0-2.21 2.239-4 5-4s5 1.79 5 4");p.setAttribute("stroke","currentColor");p.setAttribute("stroke-width","1.5");p.setAttribute("stroke-linecap","round");svg.appendChild(p);iconSpan.appendChild(svg)}if(id){btn.classList.add("active")}else{btn.classList.remove("active");nameSpan.style.color=getNc("_me")||""}if(window.opener){try{window.opener.saSetJournal(id)}catch(e){}}}');

  // desc toggle (local state)
  L.push('window.popDesc=function(){descMode=!descMode;var btn=document.getElementById("pop-desc-btn");var inp=document.getElementById("pi");btn.classList.toggle("active",descMode);if(descMode){inp.placeholder="desc \\uC785\\uB825 \\uC911\\u2026 (Enter \\uC804\\uC1A1)";inp.classList.add("desc-mode")}else{inp.placeholder="\\uBA54\\uC2DC\\uC9C0 \\uC785\\uB825 (Enter \\uC804\\uC1A1)";inp.classList.remove("desc-mode")}};');

  // whisper toggle (local state + dropdown)
  L.push('function toggleWhisperDD(){if(whisperUid){whisperUid=null;whisperName=null;refreshWhisperUI();return}var dd=document.getElementById("w-dd");if(dd.classList.contains("open")){dd.classList.remove("open");return}dd.innerHTML="";');
  L.push('var clear=document.createElement("div");clear.className="sa-dd-item"+(whisperUid===null?" sel":"");clear.textContent="\\uD83D\\uDD0A \\uC77C\\uBC18 \\uCC44\\uD305";clear.onclick=function(){whisperUid=null;whisperName=null;refreshWhisperUI();dd.classList.remove("open")};dd.appendChild(clear);');
  L.push('Object.keys(players).forEach(function(uid){var p=players[uid];if(p.isMe)return;var item=document.createElement("div");item.className="sa-dd-item"+(whisperUid===uid?" sel":"");item.textContent="\\uD83D\\uDD12 "+p.name+"\\uC5D0\\uAC8C \\uADC3\\uB9D0";item.onclick=function(){whisperUid=uid;whisperName=p.name;refreshWhisperUI();dd.classList.remove("open")};dd.appendChild(item)});');
  L.push('dd.classList.add("open")}');
  L.push('window.toggleWhisperDD=toggleWhisperDD;');

  L.push('function refreshWhisperUI(){var btn=document.getElementById("pop-whisper-btn");var lbl=document.getElementById("pop-w-label");var inp=document.getElementById("pi");if(whisperUid){btn.classList.add("active");lbl.textContent=whisperName+"\\uC5D0\\uAC8C";inp.placeholder=whisperName+"\\uC5D0\\uAC8C \\uADC3\\uB9D0 (Enter \\uC804\\uC1A1)";inp.classList.add("whisper-mode")}else{btn.classList.remove("active");lbl.textContent="\\uADC3\\uB9D0";if(!descMode)inp.placeholder="\\uBA54\\uC2DC\\uC9C0 \\uC785\\uB825 (Enter \\uC804\\uC1A1)";inp.classList.remove("whisper-mode")}}');

  // send with desc/whisper awareness
  L.push('function send(){var i=document.getElementById("pi");var t=i.value.trim();if(!t)return;i.value="";if(!window.opener)return;');
  L.push('if(descMode){if(window.opener.sendDescFromPopout){window.opener.sendDescFromPopout(t,getCurrentDmChannelKey())}else{window.opener.sendMessage(window.opener.St.myName,t,"desc")}return}');
  L.push('if(whisperUid){window.opener.sendWhisperMessage(saJId?(journals.find(function(j){return j.id===saJId})||{}).title||window.opener.St.myName:window.opener.St.myName,t,whisperUid,whisperName);return}');
  L.push('window.opener.sendChatFromPopout(t,aTab,getCurrentDmChannelKey())}');

  L.push('document.getElementById("sb").onclick=send;');
  L.push('document.getElementById("pi").onkeydown=function(ev){if(ev.key==="Enter"&&!ev.shiftKey){ev.preventDefault();send()}};');
  L.push('document.getElementById("pi").oninput=function(){if(window.opener&&window.opener.broadcastTyping)window.opener.broadcastTyping()};');
  L.push('document.addEventListener("click",function(e){if(!e.target.closest("#pop-sa-btn")&&!e.target.closest("#sa-dd"))document.getElementById("sa-dd").classList.remove("open");if(!e.target.closest("#pop-whisper-btn")&&!e.target.closest("#w-dd"))document.getElementById("w-dd").classList.remove("open")});');
  L.push('window._popReady=true;');
  L.push('})();');
  return L.join('\n');
}

function popoutChat() {
  _popoutWins = _popoutWins.filter(w => w && !w.closed);
  if (_popoutWins.length >= 3) { showToast('최대 3개까지 분리할 수 있어요.'); return; }

  const popHtml = buildPopoutHtml();
  const blob = new Blob([popHtml], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const pw = 420, ph2 = 680;
  const offset = _popoutWins.length * 30;
  const pl = window.screen.width - pw - 20 - offset;
  const pt = Math.floor((window.screen.height - ph2) / 2) + offset;
  const win = window.open(blobUrl, 'ITC_Pop_' + Date.now(), `width=${pw},height=${ph2},left=${pl},top=${pt},resizable=yes`);
  if (!win) { URL.revokeObjectURL(blobUrl); showToast('팝업 차단을 해제해 주세요!'); return; }
  _popoutWins.push(win);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);

  const extractMsgData = (m) => {
    const nameEl = m.querySelector('.msg-name');
    const textEl = m.querySelector('.msg-text');
    const timeEl = m.querySelector('.msg-time');
    const avImg = m.querySelector('.msg-avatar img');
    const type = m.classList.contains('msg-dice') ? 'dice' : m.classList.contains('msg-sys') ? 'sys' : (m.classList.contains('msg-dsec') || m.classList.contains('dsec')) ? 'desc' : 'normal';
    return { name: nameEl?.textContent||'', text: textEl?.textContent||'', type, nc: nameEl?.style?.color||'', av: avImg?.src||'', time: timeEl?.textContent||'', fhtml: textEl?.innerHTML||'' };
  };

  const extractPopoutPaneMsgData = (m, fallbackChannel = 'chat') => {
    const nameEl = m.querySelector('.msg-name');
    const textEl = m.querySelector('.msg-text');
    const timeEl = m.querySelector('.msg-time');
    const avImg = m.querySelector('.msg-avatar img');
    const type = m.classList.contains('msg-dice') ? 'dice' : m.classList.contains('msg-sys') ? 'sys' : (m.classList.contains('msg-dsec') || m.classList.contains('dsec')) ? 'desc' : 'normal';
    return {
      name: nameEl?.textContent || '',
      text: textEl?.textContent || '',
      type,
      channel: fallbackChannel,
      nameColor: nameEl?.style?.color || '',
      avatar: avImg?.src || '',
      time: timeEl?.textContent || '',
      fhtml: textEl?.innerHTML || '',
    };
  };

  const getPaneSnapshot = (selector, fallbackChannel) => Array.from(document.querySelectorAll(selector)).map((m) => extractPopoutPaneMsgData(m, fallbackChannel)).filter((d) => d.text || d.fhtml || d.type === 'desc');

  const formatPopoutMessageTime = (value) => {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())) return value.trim();
    const num = Number(value);
    const date = Number.isFinite(num) && num > 0 ? new Date(num) : new Date(String(value));
    if (!date || Number.isNaN(date.getTime())) return '';
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  };

  const syncPopoutWindow = (targetWin) => {
    if (!targetWin || targetWin.closed || !targetWin._popReady) return;
    try {
      const channelKey = typeof targetWin.getCurrentDmChannelKey === 'function' ? targetWin.getCurrentDmChannelKey() : (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global');
      const records = typeof window.getChatRecordsForChannel === 'function' ? window.getChatRecordsForChannel(channelKey) : [];
      const list = Array.isArray(records) ? records.map((m) => ({
        name: m.name || '',
        text: m.text || '',
        type: m.type || 'normal',
        channel: 'chat',
        nameColor: m.nameColor || '',
        avatar: m.speakAsAvatar || getPopoutAvatarUrl(m.name, m.uid),
        time: formatPopoutMessageTime(m.time),
        fhtml: typeof fmtText === 'function' ? fmtText(m.text || '') : '',
      })) : getPaneSnapshot('#chat-messages > div', 'chat');
      if (targetWin.setMessages) targetWin.setMessages('chat', list);
    } catch (e) {}
    try { if (targetWin.setMessages) targetWin.setMessages('casual', getPaneSnapshot('#casual-messages > div', 'casual')); } catch (e) {}
    try { targetWin.setJournals(loadJournals()); } catch(e){}
    try {
      const avMap = {}, ncMap = {};
      _allJournals.forEach(j => {
        const av = saGetAvatar(j.id);
        if (av) avMap[j.id] = av;
        if (j.nameColor) ncMap[j.id] = j.nameColor;
      });
      ncMap['_me'] = St.myNameColor || '';
      targetWin.setAvatars(avMap);
      targetWin.setColors(ncMap);
    } catch(e){}
  };

  const syncExisting = () => {
    if (!win || win.closed || !win._popReady) return;
    syncPopoutWindow(win);
  };

  const schedulePopoutSync = (() => {
    let timer = 0;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0;
        _popoutWins = _popoutWins.filter(w => w && !w.closed);
        _popoutWins.forEach(syncPopoutWindow);
      }, 40);
    };
  })();

  window.forcePopoutSync = schedulePopoutSync;

  const bindPopoutMirror = (() => {
    let bound = false;
    let chatObs = null;
    let casualObs = null;
    return () => {
      if (bound) return;
      bound = true;
      const chatEl = document.getElementById('chat-messages');
      const casualEl = document.getElementById('casual-messages');
      if (chatEl && typeof MutationObserver !== 'undefined') {
        chatObs = new MutationObserver(() => schedulePopoutSync());
        chatObs.observe(chatEl, { childList: true, subtree: true, characterData: true });
      }
      if (casualEl && typeof MutationObserver !== 'undefined') {
        casualObs = new MutationObserver(() => schedulePopoutSync());
        casualObs.observe(casualEl, { childList: true, subtree: true, characterData: true });
      }
      document.addEventListener('itc:dm-channel-change', schedulePopoutSync);
      document.addEventListener('itc:dm-unread-change', schedulePopoutSync);
      document.addEventListener('itc:dm-channel-catalog-change', schedulePopoutSync);
      document.addEventListener('itc:dm-active-channel-applied', schedulePopoutSync);
    };
  })();

  bindPopoutMirror();
  let tries = 0;
  const t = setInterval(() => { tries++; if ((win && win._popReady) || tries > 15) { clearInterval(t); syncExisting(); } }, 200);
  showToast('채팅이 새 창으로 분리됐어요! (' + _popoutWins.length + '/3)');
}

function getPopoutAvatarUrl(name, uid) {
  const cached = getSharedAvatarRuntime().sanitizePersistentAvatarSrc(window._avatarCache?.[name] || window._avatarCache?.[uid]);
  if (cached) return cached;
  try {
    const av = getSharedAvatarRuntime().readStoredAvatar(uid || '');
    if (av) return av;
  } catch (e) {}
  return '';
}

function sendDescFromPopout(text, channelKey = 'global') {
  const prevChannelKey = String(window._itcActiveChatChannelKey || 'global').trim() || 'global';
  const nextChannelKey = String(channelKey || 'global').trim() || 'global';
  window._itcActiveChatChannelKey = nextChannelKey;
  try {
    return sendMessage(St.myName, text, 'desc');
  } finally {
    window._itcActiveChatChannelKey = prevChannelKey;
  }
}
window.sendDescFromPopout = sendDescFromPopout;

function sendChatFromPopout(text, tab, channelKey = 'global') {
  if (tab === 'casual') { sendCasualMsg(_casualNickname || St.myName, text); return; }
  const prevChannelKey = String(window._itcActiveChatChannelKey || 'global').trim() || 'global';
  const nextChannelKey = String(channelKey || 'global').trim() || 'global';
  window._itcActiveChatChannelKey = nextChannelKey;
  try {
    if (St.speakAsJournalId) {
      const j = loadJournals().find(x => x.id === St.speakAsJournalId);
      if (j) return saSendMessage(j, text);
    }
    return sendMessage(St.myName, text, 'normal');
  } finally {
    window._itcActiveChatChannelKey = prevChannelKey;
  }
}

const _baseAppend = appendChatMsg;
appendChatMsg = function(msg = {}) {
  _baseAppend(msg);
};

const _baseReplace = typeof replaceChatMsg === 'function' ? replaceChatMsg : null;
if (_baseReplace) {
  replaceChatMsg = function(msg = {}) {
    _baseReplace(msg);
  };
}

const _baseRemove = typeof removeChatMsg === 'function' ? removeChatMsg : null;
if (_baseRemove) {
  removeChatMsg = function(msgKey, channel = 'chat') {
    _baseRemove(msgKey, channel);
  };
}
