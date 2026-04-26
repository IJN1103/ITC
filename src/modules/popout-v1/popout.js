
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
.pdm-room-list-toggle{width:24px;min-width:24px;max-width:24px;padding:0}
.pdm-room-list-icon{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:12px;height:12px}
.pdm-room-list-icon span{display:block;width:10px;height:1px;border-radius:999px;background:currentColor;opacity:.88}
.pdm-room-list-panel{position:fixed;z-index:2000;display:none;max-height:260px;overflow:hidden;background:rgba(16,16,16,.98);border:1px solid #2b2b2b;border-radius:10px;box-shadow:0 14px 34px rgba(0,0,0,.45);color:#8c8882;backdrop-filter:blur(8px)}
.pdm-room-list-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px 7px;border-bottom:1px solid #1f1f1f;font-size:10px;letter-spacing:.12em;color:#b89a60;background:linear-gradient(180deg,rgba(184,154,96,.08),rgba(184,154,96,0))}
.pdm-room-list-head-note{font-size:9px;letter-spacing:.02em;color:#5a5751;white-space:nowrap}
.pdm-room-list-body{display:flex;flex-direction:column;gap:4px;max-height:218px;overflow-y:auto;padding:7px}
.pdm-room-list-row{display:flex;align-items:stretch;gap:4px;border:1px solid transparent;border-radius:7px;background:transparent;transition:.18s ease}
.pdm-room-list-row:hover{border-color:rgba(184,154,96,.32);background:rgba(184,154,96,.08)}
.pdm-room-list-row.on{border-color:rgba(184,154,96,.42);background:rgba(184,154,96,.12)}
.pdm-room-list-item{position:relative;flex:1;min-width:0;min-height:30px;border:0;border-radius:7px;background:transparent;color:#8c8882;display:flex;align-items:center;gap:8px;padding:6px 9px;text-align:left;cursor:pointer;transition:.18s ease;font:inherit}
.pdm-room-list-item:hover{color:#e8e3da}
.pdm-room-list-row.on .pdm-room-list-item{color:#b89a60}
.pdm-room-list-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
.pdm-room-list-meta{flex-shrink:0;font-size:9px;color:#b89a60;opacity:.8}
.pdm-room-list-delete{flex:0 0 26px;margin:3px 3px 3px 0;border:1px solid transparent;border-radius:6px;background:rgba(255,255,255,.03);color:#5a5751;font-size:15px;line-height:1;cursor:pointer;transition:.18s ease}
.pdm-room-list-delete:hover{border-color:rgba(220,90,90,.45);background:rgba(220,90,90,.12);color:#f0aaaa}
.pdm-room-list-delete:disabled{opacity:.45;cursor:wait}
.pdm-room-list-empty{padding:14px 10px;text-align:center;font-size:11px;color:#5a5751;line-height:1.5}
.pdm-toast{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2200;max-width:calc(100vw - 32px);padding:8px 12px;border:1px solid rgba(184,154,96,.35);border-radius:999px;background:rgba(18,18,18,.96);color:#e8e3da;font-size:11px;box-shadow:0 8px 28px rgba(0,0,0,.35);pointer-events:none}
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
.dsec{justify-content:center;margin:6px 0}
.dsec .mb{display:block;text-align:center;flex:none;width:100%}
.dsec-text{font-size:15px;font-weight:600;color:#e8e3da;font-style:normal;line-height:1.9;letter-spacing:.02em;border:0;padding:4px 12px;margin:0;display:block;text-align:center}
.pop-image-row{display:flex;gap:10px;margin-bottom:2px}
.pop-image-row.is-wide{display:block;width:100%}
.pop-image-row.hide-meta{display:block;padding-left:0}
.pop-image-row.hide-meta .av,.pop-image-row.hide-meta .mn{display:none!important}
.pop-img-wrap{display:inline-block;width:auto;max-width:min(220px,100%);margin-top:5px;border-radius:8px;overflow:hidden;background:transparent;vertical-align:top}
.pop-img-wrap.is-wide{display:block;width:100%;max-width:100%;overflow:visible}
.pop-img{display:block;width:100%;height:auto;max-width:min(220px,100%);max-height:360px;object-fit:contain;object-position:center center;border-radius:8px;cursor:zoom-in;border:1px solid #1f1f1f;background:transparent}
.pop-img.is-wide{display:block;width:100%;max-width:100%;height:auto;max-height:none;object-fit:contain}
.pop-img-only-wrap{display:block}
.pop-img-only-wrap.is-wide{width:100%}
.pop-wide-head{margin-bottom:8px}
.pop-wide-head .mn{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pop-wide-image-wrap{width:100%}
.pop-lightbox{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;cursor:zoom-out}
.pop-lightbox img{max-width:92vw;max-height:88vh;border-radius:12px;object-fit:contain}
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
.pop-casual-row{display:none;align-items:center;width:100%;gap:7px;min-height:30px}
.pop-casual-avatar{width:28px;height:28px;border-radius:6px;background:#1e1e1e;border:1px solid #2e2e2e;color:#b89a60;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;overflow:hidden;flex-shrink:0}
.pop-casual-avatar img{width:100%;height:100%;object-fit:cover;display:block}
.pop-casual-name{min-width:0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600;color:#e8e3da}
.pop-casual-edit-btn{background:none;border:none;color:#8c8882;cursor:pointer;padding:2px;transition:.18s ease;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.pop-casual-edit-btn:hover{color:#b89a60}
.pop-casual-color-wrap{position:relative;margin-left:auto;flex-shrink:0}
.pop-casual-color-btn{background:none;border:none;color:#8c8882;cursor:pointer;padding:2px 4px;transition:.18s ease;display:inline-flex;align-items:center;justify-content:center}
.pop-casual-color-btn:hover{color:#b89a60}
.pop-casual-color-icon{display:block;width:16px;height:16px;object-fit:contain;filter:none;opacity:1;transition:.18s ease;pointer-events:none}
.pop-casual-color-btn:hover .pop-casual-color-icon{filter:none;opacity:1;transform:scale(1.06)}
.pop-color-pop{display:none;position:absolute;right:0;bottom:calc(100% + 6px);width:156px;padding:8px;border:1px solid #2e2e2e;border-radius:9px;background:#161616;box-shadow:0 -4px 16px rgba(0,0,0,.4);z-index:80}
.pop-color-pop.open{display:block}
.pop-color-title{font-size:10px;color:#8c8882;margin-bottom:7px;letter-spacing:.04em}
.pop-color-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:5px}
.pop-color-swatch{width:18px;height:18px;border-radius:5px;border:1px solid rgba(255,255,255,.14);cursor:pointer;padding:0}
.pop-color-swatch.active{outline:2px solid #b89a60;outline-offset:1px}
.doc-pop{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:12px}
.doc-pop-sec{border:1px solid #1f1f1f;border-radius:9px;background:rgba(255,255,255,.015);overflow:hidden}
.doc-pop-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #1f1f1f;color:#b89a60;font-size:10px;letter-spacing:.12em;background:rgba(184,154,96,.05)}
.doc-pop-list{display:flex;flex-direction:column;gap:6px;padding:8px}
.doc-pop-empty{padding:12px 8px;text-align:center;font-size:11px;color:#5a5751;line-height:1.5}
.doc-pop-item{padding:8px 9px;border:1px solid #1f1f1f;border-radius:7px;background:#141414;cursor:pointer;transition:.18s ease}
.doc-pop-item:hover{border-color:rgba(184,154,96,.38);background:rgba(184,154,96,.07)}
.doc-pop-title{font-size:12.5px;color:#e8e3da;font-weight:600;line-height:1.35;word-break:break-word}
.doc-pop-preview{margin-top:4px;font-size:10.5px;color:#8c8882;line-height:1.45;word-break:break-word}
.doc-pop-meta{margin-top:5px;font-size:9px;color:#5a5751;text-align:right}
`;
  const colorIconSrc = esc(new URL('assets/ui/icon-name-color.png', window.location.href).href);

  const htmlBody = `
<div class="tabs" id="tabs"></div>
<div class="pane on" id="p-chat"><div class="pdm" id="pdm"></div><div class="msgs" id="pm-chat"></div></div>
<div class="pane" id="p-casual"><div class="msgs" id="pm-casual"></div></div>
<div class="pane" id="p-journal"><div class="doc-pop" id="pm-journal"></div></div>
<div class="ptb" id="ptb" style="position:relative">
  <div class="sa-row" id="pop-sa-row">
    <button class="sa-btn" id="pop-sa-btn" onclick="toggleSADD()"><span class="sa-icon" id="sa-icon-span"><svg width="11" height="11" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M2 12c0-2.21 2.239-4 5-4s5 1.79 5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span><span class="sa-name" id="sa-name-span">\ub098</span></button>
    <div style="margin-left:auto"></div>
  </div>
  <div class="pop-casual-row" id="pop-casual-row">
    <div class="pop-casual-avatar" id="pop-casual-avatar">?</div>
    <span class="pop-casual-name" id="pop-casual-name">\ub098</span>
    <button class="pop-casual-edit-btn" id="pop-casual-edit-btn" type="button" onclick="editPopCasualNick()" title="잡담 닉네임 변경" aria-label="잡담 닉네임 변경"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
    <div class="pop-casual-color-wrap">
      <button class="pop-casual-color-btn" id="pop-casual-color-btn" type="button" onclick="togglePopCasualColor(event)" title="잡담 이름 색상 설정" aria-label="잡담 이름 색상 설정"><img class="pop-casual-color-icon" src="${colorIconSrc}" alt="" aria-hidden="true"></button>
      <div class="pop-color-pop" id="pop-casual-color-pop"></div>
    </div>
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
    playersObj[uid] = { name: p.name, role: p.role, currentJournalId: p.currentJournalId || '', currentJournalName: p.currentJournalName || '' };
  });
  const playersJson = JSON.stringify(playersObj).replace(/</g, '\\x3c');

  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ITC \u2014 ' + rc + '</title><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400&display=swap" rel=stylesheet><style>' + css + '</style></head><body>' + htmlBody + S + buildPopoutScript(journalJson, playersJson) + SE + '</body></html>';
}

function buildPopoutScript(journalJson, playersJson) {
  var L = [];
  L.push('(function(){');
  L.push('var aTab="chat",saJId=null,descMode=false,whisperUid=null,whisperName=null,whisperJournalId=null,popDmChannelKey="global",popDmPendingTargetIds=null;');
  L.push('var journals='+journalJson+',players='+playersJson+';');
  
  // switchTab
  L.push('var tabs=document.getElementById("tabs");');
  L.push('["채팅:chat","잡담:casual","문서:journal"].forEach(function(s,i){var p=s.split(":"),b=document.createElement("button");b.className="tab"+(i===0?" on":"");b.dataset.tab=p[1];b.textContent=p[0];b.onclick=function(){switchTab(p[1])};tabs.appendChild(b)});');
  L.push('function switchTab(t){aTab=t;document.querySelectorAll(".tab").forEach(function(b){b.classList.toggle("on",b.dataset.tab===t)});document.querySelectorAll(".pane").forEach(function(p){p.classList.toggle("on",p.id==="p-"+t)});var iw=document.getElementById("iw"),ptb=document.getElementById("ptb"),saRow=document.getElementById("pop-sa-row"),casualRow=document.getElementById("pop-casual-row"),tools=document.querySelector(".tb-row"),pdm=document.getElementById("pdm"),sad=document.getElementById("sa-dd"),wdd=document.getElementById("w-dd"),ccp=document.getElementById("pop-casual-color-pop");if(sad)sad.classList.remove("open");if(wdd)wdd.classList.remove("open");if(ccp)ccp.classList.remove("open");if(t==="journal"){if(iw)iw.style.display="none";if(ptb)ptb.style.display="none"}else{if(iw)iw.style.display="";if(ptb)ptb.style.display=""}if(saRow)saRow.style.display=t==="chat"?"flex":"none";if(casualRow)casualRow.style.display=t==="casual"?"flex":"none";if(tools)tools.style.display=t==="chat"?"flex":"none";if(pdm)pdm.style.display=t==="chat"?"flex":"none";if(t==="casual"){descMode=false;whisperUid=null;whisperName=null;whisperJournalId=null;refreshWhisperUI();var db=document.getElementById("pop-desc-btn");if(db)db.classList.remove("active");refreshPopCasualProfile()}else if(t==="chat"){refreshWhisperUI()}}');
  L.push('window.switchTab=switchTab;');
  L.push('function getOpenerState(){try{return window.opener||null}catch(e){return null}}');
  L.push('function getCurrentDmChannelKey(){return String(popDmChannelKey||"global").trim()||"global"}');
  L.push('function setCurrentDmChannelKey(key){popDmChannelKey=String(key||"global").trim()||"global";popDmPendingTargetIds=null;try{var op=getOpenerState();if(op&&popDmChannelKey!=="global"&&op.isDmGmView&&op.isDmGmView()&&typeof op.ensureDmChannelMeta==="function")op.ensureDmChannelMeta(popDmChannelKey).catch(function(){});if(op&&typeof op.markDmChannelSeen==="function")op.markDmChannelSeen(popDmChannelKey);if(op&&typeof op.forcePopoutSync==="function")op.forcePopoutSync()}catch(e){}renderDmBar();syncDmUnreadDots();return popDmChannelKey}');
  L.push('window.getCurrentDmChannelKey=getCurrentDmChannelKey;window.setCurrentDmChannelKey=setCurrentDmChannelKey;');
  L.push('try{var __op=getOpenerState();if(__op&&typeof __op.getCurrentDmChannelKey==="function")popDmChannelKey=String(__op.getCurrentDmChannelKey()||"global")||"global"}catch(e){}');
  L.push('function escHtml(v){return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}');
  L.push('function normalizeMsgType(t){t=String(t||"normal").trim();if(t==="desc"||t==="dsec"||t==="msg-dsec")return "desc";if(t==="system")return "sys";return t||"normal"}');
  L.push('function fmtPopText(v){var s=escHtml(v);s=s.replace(/\\*\\*\\*([\\s\\S]+?)\\*\\*\\*/g,"<b><i>$1</i></b>");s=s.replace(/\\*\\*([\\s\\S]+?)\\*\\*/g,"<i>$1</i>");s=s.replace(/\\*([\\s\\S]+?)\\*/g,"<b>$1</b>");s=s.replace(/\\n/g,"<br>");return s}');
  L.push('function safeMsgHtml(text,fhtml){return fhtml?String(fhtml):fmtPopText(text)}');
  L.push('function cleanStandingCommandText(v){return String(v||"").replace(/@\\S+/g,"").trim()}');
  L.push('function displayHtmlForType(text,type,fhtml){if(normalizeMsgType(type)==="speak-as")return fmtPopText(cleanStandingCommandText(text));return safeMsgHtml(text,fhtml)}');
  L.push('function isImageMsgType(t){t=normalizeMsgType(t);return t==="image"||t==="speak-as-image"}');
  L.push('function normalizeImageMeta(meta){if(!meta||typeof meta!=="object")return null;var w=Number(meta.width||meta.w||0),h=Number(meta.height||meta.h||0);if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)return null;return{width:Math.round(w),height:Math.round(h)}}');
  L.push('function buildPopImageNode(src,imageWide,imageMeta){var safe=String(src||"").trim();if(!safe)return null;var meta=normalizeImageMeta(imageMeta);var ratio=meta?(meta.width+" / "+meta.height):(imageWide?"16 / 9":"4 / 3");var wrap=document.createElement("div");wrap.className="pop-img-wrap"+(imageWide?" is-wide":"");if(imageWide)wrap.style.aspectRatio=ratio;var img=document.createElement("img");img.className="pop-img"+(imageWide?" is-wide":"");img.src=safe;img.alt="첨부 이미지";img.loading="lazy";img.decoding="async";img.onclick=function(){openPopImage(img.currentSrc||img.src)};wrap.appendChild(img);return wrap}');
  L.push('window.openPopImage=function(src){src=String(src||"").trim();if(!src)return;var old=document.querySelector(".pop-lightbox");if(old)old.remove();var box=document.createElement("div");box.className="pop-lightbox";var img=document.createElement("img");img.src=src;box.appendChild(img);box.onclick=function(){box.remove()};document.body.appendChild(box)};');
  L.push("function normalizeIds(ids){var out=[],seen={};(Array.isArray(ids)?ids:[]).forEach(function(id){id=String(id||'').trim();if(!id||seen[id])return;seen[id]=true;out.push(id)});out.sort();return out}");
  L.push("function sameIdSet(a,b){a=normalizeIds(a);b=normalizeIds(b);if(a.length!==b.length)return false;for(var i=0;i<a.length;i++){if(a[i]!==b[i])return false}return true}");
  L.push("function getOpPlayers(){var op=getOpenerState();return (op&&op.St&&op.St.players)||players||{}}");
  L.push("function getMyUid(){var op=getOpenerState();return String((op&&op.St&&op.St.myId)||'').trim()}");
  L.push("function getGmEntry(){var ps=getOpPlayers();for(var uid in ps){if(String((ps[uid]&&ps[uid].role)||'').toLowerCase()==='gm'){return{uid:String(uid||'').trim(),name:'GM'}}}return null}");
  L.push("function getAllPlayerEntries(){var ps=getOpPlayers(),me=getMyUid(),arr=[];Object.keys(ps).forEach(function(uid){var p=ps[uid]||{};if(String(p.role||'').toLowerCase()==='gm')return;arr.push({uid:String(uid||'').trim(),name:String(p.name||'플레이어').trim()||'플레이어',isSelf:String(uid)===me})});return arr.filter(function(x){return x.uid})}");
  L.push("function getParticipantName(uid){var ps=getOpPlayers();var p=ps[String(uid||'')]||{};if(String(p.role||'').toLowerCase()==='gm')return 'GM';return String(p.name||'플레이어').trim()||'플레이어'}");
  L.push("function getChannelFullLabel(ch){var ids=Array.isArray(ch&&ch.participantIds)?ch.participantIds:[];if(!ids.length)return 'DM';return ids.map(function(uid){return getParticipantName(uid)}).join(' + ')}");
  L.push("function channelHasUnread(key){var op=getOpenerState();return !!(op&&typeof op.getDmUnreadState==='function'&&op.getDmUnreadState(key))}");
  L.push("function getVisiblePopDmChannels(){var op=getOpenerState(),me=getMyUid();if(!op)return[];var all=typeof op.getAvailableDmChannels==='function'?op.getAvailableDmChannels():[];if(op.isDmGmView&&op.isDmGmView())return all;if(typeof op.getPlayerVisibleDmChannels==='function')return op.getPlayerVisibleDmChannels(me)||[];return me?all.filter(function(ch){return Array.isArray(ch.participantIds)&&ch.participantIds.indexOf(me)>=0}):[]}");
  L.push("function visiblePopDmListHasUnread(){return getVisiblePopDmChannels().some(function(ch){return channelHasUnread(ch.channelKey)})}");
  L.push("function targetHasUnread(uid){uid=String(uid||'').trim();if(!uid)return false;return getVisiblePopDmChannels().some(function(ch){return Array.isArray(ch.participantIds)&&ch.participantIds.indexOf(uid)>=0&&channelHasUnread(ch.channelKey)})}");
  L.push("function findPopDmChannelByParticipants(ids){ids=normalizeIds(ids);var op=getOpenerState();var chans=op&&typeof op.getAvailableDmChannels==='function'?op.getAvailableDmChannels():[];return chans.find(function(ch){return sameIdSet(ch.participantIds||[],ids)})||null}");
  L.push("function getPlayerDisplayTargetIds(){var me=getMyUid();if(Array.isArray(popDmPendingTargetIds))return normalizeIds(popDmPendingTargetIds).filter(function(uid){return uid!==me});var op=getOpenerState();var parsed=op&&typeof op.parseDmChannelKey==='function'?op.parseDmChannelKey(getCurrentDmChannelKey()):[];return normalizeIds(parsed).filter(function(uid){return uid!==me})}");
  L.push("function showPopDmToast(msg){try{var op=getOpenerState();if(op&&typeof op.showToast==='function'){op.showToast(msg);return}}catch(e){}var old=document.querySelector('.pdm-toast');if(old)old.remove();var el=document.createElement('div');el.className='pdm-toast';el.textContent=msg;document.body.appendChild(el);setTimeout(function(){try{el.remove()}catch(e){}},1800)}");
  L.push("function closePopDmRoomList(){var p=document.getElementById('pdm-room-list-panel');if(p){p.style.display='none';p.innerHTML=''}}");
  L.push("function getPopDmRoomListPanel(){var p=document.getElementById('pdm-room-list-panel');if(p)return p;p=document.createElement('div');p.id='pdm-room-list-panel';p.className='pdm-room-list-panel';p.style.display='none';document.body.appendChild(p);return p}");
  L.push("function positionPopDmRoomList(anchor,panel){var r=anchor&&anchor.getBoundingClientRect&&anchor.getBoundingClientRect();if(!r)return;var w=Math.min(250,Math.max(190,window.innerWidth-20)),gap=8,h=Math.min(260,Math.max(120,panel.scrollHeight||150));var left=r.left,top=r.bottom+gap;if(top+h>window.innerHeight-10)top=Math.max(10,r.top-h-gap);left=Math.min(Math.max(10,left),Math.max(10,window.innerWidth-w-10));top=Math.min(Math.max(10,top),Math.max(10,window.innerHeight-h-10));panel.style.width=w+'px';panel.style.left=left+'px';panel.style.top=top+'px'}");
  L.push("function renderPopDmRoomList(anchor){var panel=getPopDmRoomListPanel(),op=getOpenerState(),channels=getVisiblePopDmChannels(),current=getCurrentDmChannelKey(),canDelete=!!(op&&op.isDmGmView&&op.isDmGmView());var rows=channels.map(function(ch){var key=String(ch.channelKey||'').trim(),active=key&&key===current,unread=key&&channelHasUnread(key);return '<div class=\"pdm-room-list-row '+(active?'on':'')+'\"><button type=\"button\" class=\"pdm-room-list-item\" data-channel-key=\"'+escHtml(key)+'\"><span class=\"pdm-room-list-name\">'+escHtml(getChannelFullLabel(ch))+'</span><span class=\"pdm-room-list-meta\">'+(active?'현재':'')+'</span>'+(unread?'<span class=\"pdm-dot\"></span>':'')+'</button>'+(canDelete?'<button type=\"button\" class=\"pdm-room-list-delete\" data-delete-channel-key=\"'+escHtml(key)+'\" title=\"DM방 삭제\" aria-label=\"DM방 삭제\">×</button>':'')+'</div>'});panel.innerHTML='<div class=\"pdm-room-list-head\"><span>DM방 목록</span>'+(canDelete?'<span class=\"pdm-room-list-head-note\">GM 삭제 가능</span>':'')+'</div><div class=\"pdm-room-list-body\">'+(rows.length?rows.join(''):'<div class=\"pdm-room-list-empty\">표시할 DM방이 없어요.</div>')+'</div>';Array.from(panel.querySelectorAll('[data-channel-key]')).forEach(function(btn){btn.onclick=function(){var key=String(btn.getAttribute('data-channel-key')||'').trim();if(!key)return;setCurrentDmChannelKey(key);closePopDmRoomList();switchTab('chat')}});Array.from(panel.querySelectorAll('[data-delete-channel-key]')).forEach(function(btn){btn.onclick=function(ev){ev.preventDefault();ev.stopPropagation();var key=String(btn.getAttribute('data-delete-channel-key')||'').trim();if(!key||!op||typeof op.deleteDmChannelWithMessages!=='function')return;var ch=channels.find(function(x){return String(x.channelKey||'')===key})||{};if(!window.confirm(getChannelFullLabel(ch)+' DM방과 해당 메시지 기록을 삭제할까요?\\n삭제 후에는 되돌릴 수 없습니다.'))return;btn.disabled=true;Promise.resolve(op.deleteDmChannelWithMessages(key)).then(function(){if(getCurrentDmChannelKey()===key)setCurrentDmChannelKey('global');closePopDmRoomList();renderDmBar();showPopDmToast('DM방을 삭제했어요.')}).catch(function(){btn.disabled=false;showPopDmToast('DM방 삭제에 실패했어요.')})}});panel.style.display='block';positionPopDmRoomList(anchor,panel)}");
  L.push("function getRoomListButtonHtml(){return '<button type=\"button\" class=\"pdm-btn pdm-room-list-toggle\" data-role=\"room-list\" title=\"DM방 목록\" aria-label=\"DM방 목록\"><span class=\"pdm-room-list-icon\" aria-hidden=\"true\"><span></span><span></span><span></span></span>'+(visiblePopDmListHasUnread()?'<span class=\"pdm-dot\"></span>':'')+'</button>'}");
  L.push("function attemptPopPlayerTargets(ids){var me=getMyUid();var targets=normalizeIds(ids).filter(function(uid){return uid!==me});popDmPendingTargetIds=targets;if(!targets.length){setCurrentDmChannelKey('global');closePopDmRoomList();return}var gm=getGmEntry(),gmUid=String((gm&&gm.uid)||'').trim();if(!gmUid||targets.indexOf(gmUid)<0){showPopDmToast('플레이어끼리만 디엠할 수 없어요.');renderDmBar();return}var ch=findPopDmChannelByParticipants([me].concat(targets));if(!ch||!ch.channelKey){showPopDmToast('GM이 해당 인원의 디엠방을 만들지 않았어요.');renderDmBar();return}setCurrentDmChannelKey(ch.channelKey);closePopDmRoomList();switchTab('chat')}");
  L.push("function renderDmBar(){var host=document.getElementById('pdm');if(!host)return;var op=getOpenerState();if(!op){host.innerHTML='';return}var currentKey=getCurrentDmChannelKey();var html=[];html.push(getRoomListButtonHtml());html.push('<button type=\"button\" class=\"pdm-btn '+(currentKey==='global'&&!Array.isArray(popDmPendingTargetIds)?'on':'')+'\" data-role=\"global\"><span class=\"pdm-label\">전체</span></button>');try{if(op.isDmGmView&&op.isDmGmView()){var ps=getOpPlayers(),me=getMyUid(),selected=(op.parseDmChannelKey?op.parseDmChannelKey(currentKey):[]).filter(function(uid){return uid!==me});Object.keys(ps).forEach(function(uid){var p=ps[uid]||{};if(String(uid)===me)return;if(String(p.role||'').toLowerCase()==='gm')return;var alias=(typeof op.getDmButtonAlias==='function'?op.getDmButtonAlias(uid):'')||'';var label=alias||String(p.name||'플레이어');html.push('<button type=\"button\" class=\"pdm-btn '+(selected.indexOf(uid)>=0&&currentKey!=='global'?'on':'')+'\" data-role=\"player\" data-uid=\"'+escHtml(uid)+'\"><span class=\"pdm-label\">'+escHtml(label)+'</span>'+(targetHasUnread(uid)?'<span class=\"pdm-dot\"></span>':'')+'</button>')})}else{var selectedTargets=getPlayerDisplayTargetIds(),gm=getGmEntry();if(gm&&gm.uid&&gm.uid!==getMyUid()){html.push('<button type=\"button\" class=\"pdm-btn '+(selectedTargets.indexOf(gm.uid)>=0?'on':'')+'\" data-role=\"target\" data-uid=\"'+escHtml(gm.uid)+'\"><span class=\"pdm-label\">GM</span>'+(targetHasUnread(gm.uid)?'<span class=\"pdm-dot\"></span>':'')+'</button>')}getAllPlayerEntries().forEach(function(pl){if(pl.isSelf)return;html.push('<button type=\"button\" class=\"pdm-btn '+(selectedTargets.indexOf(pl.uid)>=0?'on':'')+'\" data-role=\"target\" data-uid=\"'+escHtml(pl.uid)+'\"><span class=\"pdm-label\">'+escHtml(pl.name)+'</span>'+(targetHasUnread(pl.uid)?'<span class=\"pdm-dot\"></span>':'')+'</button>')})}}catch(e){}host.innerHTML=html.join('');var roomBtn=host.querySelector('[data-role=room-list]');if(roomBtn)roomBtn.onclick=function(ev){ev.preventDefault();ev.stopPropagation();var p=document.getElementById('pdm-room-list-panel');if(p&&p.style.display==='block'){closePopDmRoomList();return}renderPopDmRoomList(roomBtn)};var g=host.querySelector('[data-role=global]');if(g)g.onclick=function(){try{setCurrentDmChannelKey('global');closePopDmRoomList();switchTab('chat')}catch(e){}};Array.from(host.querySelectorAll('[data-role=player]')).forEach(function(btn){btn.onclick=function(){try{var uid=btn.getAttribute('data-uid')||'',me=getMyUid(),cur=(op.parseDmChannelKey?op.parseDmChannelKey(getCurrentDmChannelKey()):[]).filter(function(id){return id!==me});var i=cur.indexOf(uid);if(i>=0)cur.splice(i,1);else cur.push(uid);var next=(cur.length&&typeof op.buildGmScopedDmChannelKey==='function')?op.buildGmScopedDmChannelKey(cur,me):'global';setCurrentDmChannelKey(next||'global');closePopDmRoomList();switchTab('chat')}catch(e){}};btn.oncontextmenu=function(ev){try{ev.preventDefault();var uid=btn.getAttribute('data-uid')||'';if(!op||!uid||typeof op.getDmButtonAlias!=='function')return false;var current=(op.getDmButtonAlias(uid)||'');var input=window.prompt('표시 이름을 입력해주세요. (최대 8글자, 빈칸 입력 시 초기화)',current);if(input===null)return false;if(typeof op.setDmButtonAlias==='function')op.setDmButtonAlias(uid,input);if(typeof op.refreshDmChannelButtons==='function')op.refreshDmChannelButtons();renderDmBar();return false}catch(e){return false}}});Array.from(host.querySelectorAll('[data-role=target]')).forEach(function(btn){btn.onclick=function(){var uid=String(btn.getAttribute('data-uid')||'').trim();if(!uid)return;var next=getPlayerDisplayTargetIds();var i=next.indexOf(uid);if(i>=0)next.splice(i,1);else next.push(uid);attemptPopPlayerTargets(next)}})}");
  L.push("document.addEventListener('click',function(ev){var p=document.getElementById('pdm-room-list-panel');if(!p||p.style.display!=='block')return;if(p.contains(ev.target))return;if(ev.target&&ev.target.closest&&ev.target.closest('[data-role=\"room-list\"]'))return;closePopDmRoomList()});window.addEventListener('resize',closePopDmRoomList);");
L.push('window.renderDmBar=renderDmBar;');
  L.push("function syncDmUnreadDots(){try{var host=document.getElementById('pdm');if(!host)return;var roomBtn=host.querySelector('[data-role=room-list]');if(roomBtn){var dot=roomBtn.querySelector('.pdm-dot');var hasList=visiblePopDmListHasUnread();if(hasList&&!dot){dot=document.createElement('span');dot.className='pdm-dot';roomBtn.appendChild(dot)}else if(!hasList&&dot){dot.remove()}}Array.from(host.querySelectorAll('[data-role=player],[data-role=target]')).forEach(function(btn){var uid=btn.getAttribute('data-uid')||'';var has=targetHasUnread(uid);var dot=btn.querySelector('.pdm-dot');if(has&&!dot){dot=document.createElement('span');dot.className='pdm-dot';btn.appendChild(dot)}else if(!has&&dot){dot.remove()}})}catch(e){}}");
  L.push('setInterval(function(){renderDmBar();syncDmUnreadDots()},400);');

  // addMsg
  L.push('window.addMsg=function(name,text,type,ch,nc,av,ts,fhtml,imageWide,imageMeta,hideImageMeta){');
  L.push('type=normalizeMsgType(type);ch=ch||"chat";var c=document.getElementById("pm-"+ch)||document.getElementById("pm-chat");');
  L.push('var row=document.createElement("div");var isSys=type==="sys"||type==="system"||type==="desc";');
  L.push('if(type==="desc"){row.className="cm dsec";var mb=document.createElement("div");mb.className="mb";var mt=document.createElement("div");mt.className="mt dsec-text";mt.innerHTML=displayHtmlForType(text,type,fhtml);mb.appendChild(mt);row.appendChild(mb);c.appendChild(row);if(!window._popoutSuppressAutoscroll)c.scrollTop=c.scrollHeight;return}');
  L.push('if(isImageMsgType(type)){row.className="cm pop-image-row"+(imageWide?" is-wide":"")+(hideImageMeta?" hide-meta":"");var imageNode=buildPopImageNode(text,!!imageWide,imageMeta);if(!hideImageMeta){var avD=document.createElement("div");avD.className="av";if(av){var img=document.createElement("img");img.src=av;avD.appendChild(img)}else{avD.textContent=(name||"?")[0].toUpperCase()}row.appendChild(avD)}var mb=document.createElement("div");mb.className="mb";if(!hideImageMeta){if(imageWide){var head=document.createElement("div");head.className="pop-wide-head";var mn=document.createElement("div");mn.className="mn";var nn=document.createElement("span");nn.className="nn";nn.textContent=name||"";if(nc)nn.style.color=nc;var tm=document.createElement("span");tm.className="tm";tm.textContent=ts||"";mn.appendChild(nn);mn.appendChild(tm);head.appendChild(mn);mb.appendChild(head)}else{var mn2=document.createElement("div");mn2.className="mn";var nn2=document.createElement("span");nn2.className="nn";nn2.textContent=name||"";if(nc)nn2.style.color=nc;var tm2=document.createElement("span");tm2.className="tm";tm2.textContent=ts||"";mn2.appendChild(nn2);mn2.appendChild(tm2);mb.appendChild(mn2)}}var holder=document.createElement("div");holder.className=(hideImageMeta?"pop-img-only-wrap":"")+(imageWide?" is-wide":"");if(imageWide&&!hideImageMeta){holder.className="pop-wide-image-wrap"}if(imageNode){holder.appendChild(imageNode)}else{var fallback=document.createElement("div");fallback.className="mt";fallback.innerHTML=safeMsgHtml(text,"");holder.appendChild(fallback)}mb.appendChild(holder);row.appendChild(mb);c.appendChild(row);if(!window._popoutSuppressAutoscroll)c.scrollTop=c.scrollHeight;return}');
  L.push('row.className="cm"+(isSys?" ms":"");');
  L.push('if(!isSys){var avD=document.createElement("div");avD.className="av";if(av){var img=document.createElement("img");img.src=av;avD.appendChild(img)}else{avD.textContent=(name||"?")[0].toUpperCase()}row.appendChild(avD)}');
  L.push('var mb=document.createElement("div");mb.className="mb";');
  L.push('if(!isSys){var mn=document.createElement("div");mn.className="mn";var nn=document.createElement("span");nn.className="nn";nn.textContent=name;if(nc)nn.style.color=nc;var tm=document.createElement("span");tm.className="tm";tm.textContent=ts||"";mn.appendChild(nn);mn.appendChild(tm);mb.appendChild(mn)}');
  L.push('var mt=document.createElement("div");mt.className="mt";mt.innerHTML=displayHtmlForType(text,type,fhtml);mb.appendChild(mt);');
  // dice card
  L.push('if(type==="dice"){var dm=text.match(/[\\u{1F3B2}\\u{1F3AF}]\\s*(.+?)\\s*\\u2192\\s*(\\d+)\\s*\\(([^)]+)\\)/u);if(dm){mt.style.display="none";var dc=document.createElement("div");dc.className="dc";["dc-f","dc-r","dc-d"].forEach(function(cls,i){var d=document.createElement("div");d.className=cls;d.textContent=dm[i+1];dc.appendChild(d)});mb.appendChild(dc)}}');
  L.push('row.appendChild(mb);c.appendChild(row);if(!window._popoutSuppressAutoscroll)c.scrollTop=c.scrollHeight};');
  L.push('window.setMessages=function(ch,list){ch=ch||"chat";var c=document.getElementById("pm-"+ch)||document.getElementById("pm-chat");if(!c)return;var nearBottom=(c.scrollHeight-c.scrollTop-c.clientHeight)<=56;var prevHeight=c.scrollHeight;var prevTop=c.scrollTop;window._popoutSuppressAutoscroll=true;c.innerHTML="";(Array.isArray(list)?list:[]).forEach(function(item){window.addMsg(item.name,item.text,normalizeMsgType(item.type),item.channel||ch,item.nameColor||"",item.avatar||"",item.time||"",item.fhtml||"",!!item.imageWide,item.imageMeta||null,!!item.hideImageMeta)});window._popoutSuppressAutoscroll=false;if(nearBottom||prevHeight===0)c.scrollTop=c.scrollHeight;else c.scrollTop=prevTop+(c.scrollHeight-prevHeight)};');
  L.push('var _popOlderLoading={chat:false,casual:false};function bindOlderScroll(ch){var c=document.getElementById("pm-"+ch)||document.getElementById("pm-chat");if(!c||c.dataset.olderScrollBound==="1")return;c.dataset.olderScrollBound="1";c.addEventListener("scroll",function(){if(c.scrollTop>28||_popOlderLoading[ch])return;var op=getOpenerState();if(!op||typeof op.loadOlderMessagesForPopout!=="function")return;_popOlderLoading[ch]=true;var prevHeight=c.scrollHeight;var prevTop=c.scrollTop;Promise.resolve(op.loadOlderMessagesForPopout(ch,ch==="chat"?getCurrentDmChannelKey():"casual")).then(function(){try{if(op.forcePopoutSync)op.forcePopoutSync()}catch(e){}setTimeout(function(){if(c.scrollHeight>prevHeight)c.scrollTop=prevTop+(c.scrollHeight-prevHeight)},120)}).finally(function(){_popOlderLoading[ch]=false})},{passive:true})}bindOlderScroll("chat");bindOlderScroll("casual");');

  // document pane
  L.push('var handouts=[];function stripHtml(v){var d=document.createElement("div");d.innerHTML=String(v||"");return d.textContent||d.innerText||""}');
  L.push('function makeDocItem(kind,item){var d=document.createElement("div");d.className="doc-pop-item";var title=document.createElement("div");title.className="doc-pop-title";title.textContent=item.title||(kind==="handout"?"무제 핸드아웃":"무제 저널");var preview=document.createElement("div");preview.className="doc-pop-preview";var raw=kind==="handout"?stripHtml(item.contentHtml||""):(item.body||"");preview.textContent=(raw||"내용 없음").slice(0,56)+(raw&&raw.length>56?"…":"");var meta=document.createElement("div");meta.className="doc-pop-meta";var dt=new Date(item.updatedAt||item.createdAt||Date.now());meta.textContent=(dt.getMonth()+1)+"/"+dt.getDate()+" "+String(dt.getHours()).padStart(2,"0")+":"+String(dt.getMinutes()).padStart(2,"0");d.appendChild(title);d.appendChild(preview);d.appendChild(meta);d.onclick=function(){try{var op=getOpenerState();if(!op)return;if(kind==="handout"&&typeof op.openHandoutEditor==="function")op.openHandoutEditor(item.id);else if(kind==="journal"&&typeof op.openSheet==="function")op.openSheet(item.id)}catch(e){}};return d}');
  L.push('function renderDocSection(title,list,kind,emptyText){var sec=document.createElement("section");sec.className="doc-pop-sec";var head=document.createElement("div");head.className="doc-pop-head";head.textContent=title;var body=document.createElement("div");body.className="doc-pop-list";if(!list||!list.length){var emp=document.createElement("div");emp.className="doc-pop-empty";emp.textContent=emptyText;body.appendChild(emp)}else{list.forEach(function(item){body.appendChild(makeDocItem(kind,item))})}sec.appendChild(head);sec.appendChild(body);return sec}');
  L.push('function renderDocsPane(){var c=document.getElementById("pm-journal");if(!c)return;c.innerHTML="";c.appendChild(renderDocSection("저널",journals,"journal","저널이 없어요."));c.appendChild(renderDocSection("핸드아웃",handouts,"handout","표시할 핸드아웃이 없어요."))}');
  L.push('window.setDocuments=function(jList,hList){journals=Array.isArray(jList)?jList:[];handouts=Array.isArray(hList)?hList:[];renderDocsPane()};');
  L.push('window.setJournals=function(list){window.setDocuments(list,handouts||[])};');

  // helper: get avatar from opener
  L.push('var _avCache={},_ncCache={};');
  L.push('function getAv(id){return _avCache[id]||""}');
  L.push('function getNc(id){return _ncCache[id]||""}');
  L.push('window.setAvatars=function(m){for(var k in m)_avCache[k]=m[k]};');
  L.push('window.setColors=function(m){_ncCache=m||{}};');
  L.push('var POP_CASUAL_COLORS=["#b89a60","#e8c87a","#f5a623","#e74c3c","#e91e63","#ff6b6b","#9b59b6","#8e44ad","#3498db","#2980b9","#7c9ece","#1abc9c","#2ecc71","#27ae60","#f39c12","#e67e22","#95a5a6","#ecf0f1"];');
  L.push('function getPopCasualProfile(){try{var op=getOpenerState();if(op&&typeof op.getCasualProfileForPopout==="function")return op.getCasualProfileForPopout()}catch(e){}return{name:"나",color:"",avatar:""}}');
  L.push('function refreshPopCasualProfile(){var p=getPopCasualProfile(),av=document.getElementById("pop-casual-avatar"),name=document.getElementById("pop-casual-name");if(name){name.textContent=p.name||"나";name.style.color=p.color||""}if(av){av.innerHTML="";if(p.avatar){var img=document.createElement("img");img.src=p.avatar;av.appendChild(img)}else{av.textContent=((p.name||"?")[0]||"?").toUpperCase()}}}');
  L.push('window.refreshPopCasualProfile=refreshPopCasualProfile;');
  L.push('window.editPopCasualNick=function(){var p=getPopCasualProfile(),v=window.prompt("잡담 닉네임을 입력하세요 (18자 이내)",p.name||"나");if(v===null)return;var trimmed=String(v||"").trim().slice(0,18);if(!trimmed){showPopDmToast("닉네임을 입력해주세요.");return}try{var op=getOpenerState();if(op&&typeof op.setCasualNicknameFromPopout==="function")op.setCasualNicknameFromPopout(trimmed);else if(op&&typeof op.editCasualNick==="function")op.editCasualNick()}catch(e){}refreshPopCasualProfile()}');
  L.push('window.togglePopCasualColor=function(ev){if(ev&&ev.stopPropagation)ev.stopPropagation();var pop=document.getElementById("pop-casual-color-pop");if(!pop)return;if(pop.classList.contains("open")){pop.classList.remove("open");return}var p=getPopCasualProfile();pop.innerHTML="";var title=document.createElement("div");title.className="pop-color-title";title.textContent="잡담 이름 색상";pop.appendChild(title);var grid=document.createElement("div");grid.className="pop-color-grid";pop.appendChild(grid);POP_CASUAL_COLORS.forEach(function(color){var sw=document.createElement("button");sw.type="button";sw.className="pop-color-swatch"+(p.color===color?" active":"");sw.style.background=color;sw.onclick=function(e){e.stopPropagation();var directOk=false;try{var op=getOpenerState();if(op&&typeof op.setCasualNameColorFromPopout==="function"){var res=op.setCasualNameColorFromPopout(color);directOk=!!(res&&String(res.color||"").toLowerCase()===String(color).toLowerCase())}else if(op&&typeof op.setCasualNameColor==="function"){op.setCasualNameColor(color);directOk=true}}catch(err){}if(!directOk){try{var op2=getOpenerState();if(op2&&typeof op2.postMessage==="function")op2.postMessage({type:"ITC_POPOUT_CASUAL_COLOR",color:color},"*")}catch(err2){}}var name=document.getElementById("pop-casual-name");if(name)name.style.color=color;pop.classList.remove("open");setTimeout(refreshPopCasualProfile,60)};grid.appendChild(sw)});pop.classList.add("open")}');

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
  L.push('function toggleWhisperDD(){if(whisperUid){whisperUid=null;whisperName=null;whisperJournalId=null;refreshWhisperUI();return}var dd=document.getElementById("w-dd");if(dd.classList.contains("open")){dd.classList.remove("open");return}dd.innerHTML="";');
  L.push('var clear=document.createElement("div");clear.className="sa-dd-item"+(whisperUid===null?" sel":"");clear.textContent="\\uC77C\\uBC18 \\uCC44\\uD305";clear.onclick=function(){whisperUid=null;whisperName=null;whisperJournalId=null;refreshWhisperUI();dd.classList.remove("open")};dd.appendChild(clear);');
  L.push('Object.keys(players).forEach(function(uid){var p=players[uid];if(p.isMe)return;var item=document.createElement("div");item.className="sa-dd-item"+(whisperUid===uid&&!whisperJournalId?" sel":"");item.textContent=p.name+"\\uC5D0\\uAC8C \\uADC3\\uB9D0";item.onclick=function(){whisperUid=uid;whisperName=p.name;whisperJournalId=null;refreshWhisperUI();dd.classList.remove("open")};dd.appendChild(item);if(p.currentJournalId&&p.currentJournalName){var jItem=document.createElement("div");jItem.className="sa-dd-item"+(whisperUid===uid&&whisperJournalId===p.currentJournalId?" sel":"");jItem.style.paddingLeft="24px";jItem.textContent=p.currentJournalName+"\\uC5D0\\uAC8C \\uADC3\\uB9D0 ("+p.name+")";jItem.onclick=function(){whisperUid=uid;whisperName=p.currentJournalName;whisperJournalId=p.currentJournalId;refreshWhisperUI();dd.classList.remove("open")};dd.appendChild(jItem)}});');
  L.push('dd.classList.add("open")}');
  L.push('window.toggleWhisperDD=toggleWhisperDD;');

  L.push('function refreshWhisperUI(){var btn=document.getElementById("pop-whisper-btn");var lbl=document.getElementById("pop-w-label");var inp=document.getElementById("pi");if(whisperUid){btn.classList.add("active");lbl.textContent=whisperName+"\\uC5D0\\uAC8C";inp.placeholder=whisperName+"\\uC5D0\\uAC8C \\uADC3\\uB9D0 (Enter \\uC804\\uC1A1)";inp.classList.add("whisper-mode")}else{btn.classList.remove("active");lbl.textContent="\\uADC3\\uB9D0";if(!descMode)inp.placeholder="\\uBA54\\uC2DC\\uC9C0 \\uC785\\uB825 (Enter \\uC804\\uC1A1)";inp.classList.remove("whisper-mode")}}');

  // send with desc/whisper awareness
  L.push('function send(){var i=document.getElementById("pi");var t=i.value.trim();if(!t)return;i.value="";if(!window.opener)return;');
  L.push('if(descMode){if(window.opener.sendDescFromPopout){window.opener.sendDescFromPopout(t,getCurrentDmChannelKey())}else{window.opener.sendMessage(window.opener.St.myName,t,"desc")}return}');
  L.push('if(whisperUid){window.opener.sendWhisperMessage(saJId?(journals.find(function(j){return j.id===saJId})||{}).title||window.opener.St.myName:window.opener.St.myName,t,whisperUid,whisperName,{targetJournalId:whisperJournalId||null,speakAsJournalId:saJId||null,channelKey:getCurrentDmChannelKey()});return}');
  L.push('window.opener.sendChatFromPopout(t,aTab,getCurrentDmChannelKey())}');

  L.push('document.getElementById("sb").onclick=send;');
  L.push('document.getElementById("pi").onkeydown=function(ev){if(ev.key==="Enter"&&!ev.shiftKey){ev.preventDefault();send()}};');
  L.push('document.getElementById("pi").oninput=function(){if(window.opener&&window.opener.broadcastTyping)window.opener.broadcastTyping()};');
  L.push('document.addEventListener("click",function(e){if(!e.target.closest("#pop-sa-btn")&&!e.target.closest("#sa-dd"))document.getElementById("sa-dd").classList.remove("open");if(!e.target.closest("#pop-whisper-btn")&&!e.target.closest("#w-dd"))document.getElementById("w-dd").classList.remove("open");if(!e.target.closest("#pop-casual-color-btn")&&!e.target.closest("#pop-casual-color-pop")){var p=document.getElementById("pop-casual-color-pop");if(p)p.classList.remove("open")}});');
  L.push('renderDocsPane();refreshPopCasualProfile();window._popReady=true;');
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
    const imgEl = m.querySelector('.msg-image, .pop-img');
    const isImg = m.classList.contains('msg-image-msg') || m.classList.contains('pop-image-row') || !!imgEl;
    const type = isImg ? (m.classList.contains('msg-speak-as') ? 'speak-as-image' : 'image') : (m.classList.contains('msg-dice') ? 'dice' : m.classList.contains('msg-sys') ? 'sys' : (m.classList.contains('msg-dsec') || m.classList.contains('dsec')) ? 'desc' : 'normal');
    const imageSrc = imgEl?.dataset?.chatSrc || imgEl?.currentSrc || imgEl?.src || '';
    return { name: nameEl?.textContent||'', text: isImg ? imageSrc : (textEl?.textContent||''), type, nc: nameEl?.style?.color||'', av: avImg?.src||'', time: timeEl?.textContent||'', fhtml: isImg ? '' : (textEl?.innerHTML||''), imageWide: m.classList.contains('msg-image-wide-row') || m.classList.contains('is-wide'), hideImageMeta: m.classList.contains('msg-image-hide-meta') || m.classList.contains('hide-meta'), imageMeta: null };
  };

  const extractPopoutPaneMsgData = (m, fallbackChannel = 'chat') => {
    const nameEl = m.querySelector('.msg-name,.nn');
    const textEl = m.querySelector('.msg-text,.mt');
    const timeEl = m.querySelector('.msg-time,.tm');
    const avImg = m.querySelector('.msg-avatar img,.av img');
    const imgEl = m.querySelector('.msg-image, .pop-img');
    const isImg = m.classList.contains('msg-image-msg') || m.classList.contains('pop-image-row') || !!imgEl;
    const type = isImg ? (m.classList.contains('msg-speak-as') ? 'speak-as-image' : 'image') : (m.classList.contains('msg-dice') ? 'dice' : m.classList.contains('msg-sys') ? 'sys' : (m.classList.contains('msg-dsec') || m.classList.contains('dsec')) ? 'desc' : 'normal');
    const imageSrc = imgEl?.dataset?.chatSrc || imgEl?.currentSrc || imgEl?.src || '';
    return {
      name: nameEl?.textContent || '',
      text: isImg ? imageSrc : (textEl?.textContent || ''),
      type,
      channel: fallbackChannel,
      nameColor: nameEl?.style?.color || '',
      avatar: avImg?.src || '',
      time: timeEl?.textContent || '',
      fhtml: isImg ? '' : (textEl?.innerHTML || ''),
      imageWide: m.classList.contains('msg-image-wide-row') || m.classList.contains('is-wide'),
      hideImageMeta: m.classList.contains('msg-image-hide-meta') || m.classList.contains('hide-meta'),
      imageMeta: null,
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

  const normalizePopoutTransferRecord = (m = {}, fallbackChannel = 'chat') => {
    const msgType = m.type || 'normal';
    const isImage = msgType === 'image' || msgType === 'speak-as-image';
    return {
      name: m.name || '',
      text: m.text || '',
      type: msgType,
      channel: fallbackChannel,
      nameColor: m.nameColor || '',
      avatar: m.speakAsAvatar || (m.speakAsJournalId && typeof saGetAvatar === 'function' ? saGetAvatar(m.speakAsJournalId) : '') || m.avatar || getPopoutAvatarUrl(m.name, m.uid),
      time: formatPopoutMessageTime(m.time || m.timestamp),
      fhtml: isImage ? '' : (typeof fmtText === 'function' ? fmtText(m.text || '') : ''),
      imageWide: !!m.imageWide,
      hideImageMeta: !!m.hideImageMeta,
      imageMeta: m.imageMeta || null,
    };
  };

  const getStoredSnapshotForPopout = (channel = 'chat') => {
    if (typeof window.getChatRenderSnapshot !== 'function') return [];
    try {
      const list = window.getChatRenderSnapshot(channel, { limit: 0 });
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  };

  const syncPopoutWindow = (targetWin) => {
    if (!targetWin || targetWin.closed || !targetWin._popReady) return;
    try {
      const channelKey = typeof targetWin.getCurrentDmChannelKey === 'function' ? targetWin.getCurrentDmChannelKey() : (typeof getCurrentDmChannelKey === 'function' ? getCurrentDmChannelKey() : 'global');
      const records = typeof window.getChatRecordsForChannel === 'function' ? window.getChatRecordsForChannel(channelKey) : [];
      const list = Array.isArray(records)
        ? records.map((m) => normalizePopoutTransferRecord(m, 'chat'))
        : getPaneSnapshot('#chat-messages > div', 'chat');
      if (targetWin.setMessages) targetWin.setMessages('chat', list);
    } catch (e) {}
    try {
      if (targetWin.setMessages) {
        const casualSnapshot = getStoredSnapshotForPopout('casual');
        const casualList = casualSnapshot.length
          ? casualSnapshot.map((m) => normalizePopoutTransferRecord(m, 'casual'))
          : getPaneSnapshot('#casual-messages > div', 'casual');
        targetWin.setMessages('casual', casualList);
      }
    } catch (e) {}
    try { if (targetWin.setDocuments) targetWin.setDocuments(loadJournals(), typeof loadHandouts === 'function' ? loadHandouts() : []); else if (targetWin.setJournals) targetWin.setJournals(loadJournals()); } catch(e){}
    try { if (targetWin.refreshPopCasualProfile) targetWin.refreshPopCasualProfile(); } catch(e){}
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
