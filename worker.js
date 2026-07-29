// cards — simplified MVP
// Direct OpenRouter calls (no proxy) + KV caching for exact-match prompts

const CSS = `
:root{--p:#c41e3a;--p2:#e63950;--bg:#0d0d0d;--cb:#1a1a2e;--t:#e8e8e8;--b:#2a2a3e;--s:0 8px 32px rgba(0,0,0,.4);--r:14px;--ch:200px;--cols:1;--sb:env(safe-area-inset-bottom)}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--t);min-height:100vh;padding-top:52px;padding-bottom:80px;overflow-x:hidden}
#topBar{position:fixed;top:0;left:0;right:0;height:52px;padding:0 12px;display:flex;align-items:center;justify-content:space-between;z-index:100;background:linear-gradient(180deg,var(--bg),transparent);backdrop-filter:blur(12px)}
.t-left,.t-right{display:flex;align-items:center;gap:8px}
#brand{font-weight:800;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;background:linear-gradient(135deg,var(--p),#ff6b6b);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.badge{background:var(--p);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;min-width:18px;text-align:center}
.icon-btn{width:34px;height:34px;border-radius:50%;border:1px solid var(--b);background:var(--cb);color:var(--t);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;font-size:13px}
.icon-btn:hover{transform:scale(1.1);border-color:var(--p)}
#grid{display:grid;grid-template-columns:repeat(var(--cols),1fr);gap:12px;padding:12px;max-width:900px;margin:0 auto;min-height:50vh}
.card{min-height:var(--ch);border-radius:var(--r);overflow:hidden;position:relative;background:var(--cb);border:1px solid var(--b);box-shadow:var(--s);transition:transform .2s,box-shadow .2s;touch-action:manipulation;cursor:pointer}
.card:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(196,30,58,.2)}
.card.sel{border-color:var(--p);box-shadow:0 0 0 2px var(--p),var(--s)}
.card.new{animation:slideIn .35s cubic-bezier(.16,1,.3,1)}
@keyframes slideIn{0%{opacity:0;transform:translateY(30px) scale(.95)}100%{opacity:1;transform:translateY(0) scale(1)}}
.card-body{position:relative;width:100%;height:100%;transition:transform .5s cubic-bezier(.4,0,.2,1);transform-style:preserve-3d;min-height:inherit}
.card.flip .card-body{transform:rotateY(180deg)}
.face{position:absolute;width:100%;height:100%;backface-visibility:hidden;display:flex;flex-direction:column;padding:14px;min-height:inherit;background:var(--cb);color:var(--t);font-size:14px;line-height:1.5;overflow:hidden}
.face.back{transform:rotateY(180deg)}
.face-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;border-bottom:1px solid var(--b);padding-bottom:6px;flex-shrink:0;font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:.4}
.face-h .actions{display:flex;gap:2px}
.face-h .actions button{background:none;border:none;color:var(--t);cursor:pointer;padding:4px;opacity:.4;border-radius:4px;transition:all .2s;min-width:28px;min-height:28px;font-size:11px}
.face-h .actions button:hover{opacity:1;background:rgba(255,255,255,.08)}
.face-c{flex:1;overflow-y:auto;word-wrap:break-word}
.face-c h1,.face-c h2,.face-c h3{color:var(--p);margin:.4em 0;font-size:1.1em}
.face-c p{margin-bottom:.6em}
.face-c ul,.face-c ol{margin-left:1.2em;margin-bottom:.6em}
.face-c blockquote{border-left:3px solid var(--p);padding-left:10px;margin:.8em 0;opacity:.8;font-style:italic}
.face-c code{background:rgba(255,255,255,.08);padding:2px 5px;border-radius:3px;font-family:monospace;font-size:.9em}
.face-c pre{background:rgba(255,255,255,.04);padding:10px;border-radius:6px;overflow-x:auto;margin:.8em 0;border:1px solid var(--b)}
.thinking{display:flex;align-items:center;justify-content:center;gap:10px;padding:20px;color:#888}
.thinking span{color:var(--p);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:1px;animation:pulse 1.5s infinite}
@keyframes pulse{0%{opacity:.3}50%{opacity:1}100%{opacity:.3}}
#selectionBar{position:fixed;top:0;left:0;right:0;background:var(--cb);border-bottom:1px solid var(--b);padding:8px 12px;z-index:200;display:none;align-items:center;justify-content:space-between;transform:translateY(-100%);transition:transform .3s}
#selectionBar.show{display:flex;transform:translateY(0)}
.sel-left,.sel-right{display:flex;align-items:center;gap:6px}
#selCount{font-weight:700;font-size:14px;margin-left:6px}
.sel-btn{background:var(--p);color:#fff;border:none;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px;transition:all .2s}
.sel-btn:hover{filter:brightness(1.2)}
.sel-btn.danger{background:#d32f2f}
.input-area{position:fixed;bottom:0;left:0;right:0;background:var(--cb);border-top:1px solid var(--b);padding:10px 12px;display:flex;gap:8px;z-index:100;align-items:center;padding-bottom:calc(10px + var(--sb))}
#input{flex:1;padding:10px 16px;border-radius:22px;border:1px solid var(--b);background:var(--bg);color:var(--t);font-size:15px;outline:none;transition:border .2s;height:42px}
#input:focus{border-color:var(--p)}
#sendBtn{background:var(--p);color:#fff;border:none;width:42px;height:42px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0;font-size:15px}
#sendBtn:hover{background:var(--p2);transform:scale(1.05)}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);z-index:300;display:none;align-items:center;justify-content:center}
.overlay.show{display:flex}
.modal{background:var(--cb);border-radius:16px;width:92%;max-width:520px;max-height:85vh;border:1px solid var(--b);display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden;animation:modalIn .25s ease}
@keyframes modalIn{0%{opacity:0;transform:scale(.9) translateY(20px)}100%{opacity:1;transform:scale(1) translateY(0)}}
.modal-h{padding:14px 18px;border-bottom:1px solid var(--b);display:flex;justify-content:space-between;align-items:center}
.modal-h h3{font-size:15px}
.modal-b{padding:18px;overflow-y:auto;display:flex;flex-direction:column;gap:16px}
.modal-f{padding:14px 18px;border-top:1px solid var(--b);display:flex;justify-content:flex-end;gap:10px}
.btn{padding:9px 16px;border-radius:8px;border:1px solid var(--b);cursor:pointer;font-size:13px;font-weight:600;background:transparent;color:var(--t);transition:all .2s}
.btn:hover{filter:brightness(1.2)}
.btn.primary{background:var(--p);color:#fff;border:none}
.ctx-menu{position:fixed;background:var(--cb);border:1px solid var(--b);border-radius:12px;padding:6px;display:none;flex-direction:column;z-index:400;box-shadow:0 10px 40px rgba(0,0,0,.6);min-width:180px}
.ctx-menu.show{display:flex;animation:menuIn .15s ease}
@keyframes menuIn{0%{opacity:0;transform:scale(.95)}100%{opacity:1;transform:scale(1)}}
.ctx-menu button{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:6px;cursor:pointer;color:var(--t);background:transparent;border:none;width:100%;text-align:left;font-size:13px;transition:background .1s}
.ctx-menu button:active{background:rgba(255,255,255,.08)}
.ctx-menu hr{height:1px;background:var(--b);margin:4px 0;border:none}
.ctx-menu .danger{color:#ff5252}
#toast{position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--cb);border:1px solid var(--b);color:var(--t);padding:8px 16px;border-radius:20px;font-size:12px;z-index:500;opacity:0;transition:all .3s;pointer-events:none;box-shadow:var(--s)}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
#fullscreen{flex-direction:column;padding:0;align-items:stretch;justify-content:flex-start;background:var(--bg)}
#fullscreen.show{display:flex}
.fs-header{padding:10px 14px;background:var(--cb);border-bottom:1px solid var(--b);display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
.fs-body{flex:1;overflow-y:auto;padding:20px 24px;font-size:1.1rem;line-height:1.7}
body.view-grid{--cols:2}
body.view-full{--cols:1}
body.view-full #grid{display:block;padding:0;gap:0}
body.view-full #grid .card{height:100vh;border-radius:0;border:none;min-height:unset}
@media(max-width:600px){
body.view-grid{--cols:2}
#grid{gap:8px;padding:8px}
.input-area{padding:8px 10px;padding-bottom:calc(8px + var(--sb))}
#input{padding:9px 14px;font-size:15px;height:40px}
#sendBtn{width:40px;height:40px;font-size:14px}
#topBar{height:48px;padding:0 10px}
.icon-btn{width:32px;height:32px;font-size:12px}
.card{min-height:160px}
.face{font-size:13px;padding:12px}
.ctx-menu{min-width:160px;left:50%!important;transform:translateX(-50%)!important;top:auto!important;bottom:70px}
}
`;

const JS = `
const ge = id => document.getElementById(id);
const qs = s => document.querySelector(s);
const qsa = s => [...document.querySelectorAll(s)];

class App {
 constructor(){
  this.cards=[];this.hist=[];this.sel=new Set();this.ctxId=null;this.fsId=null;this.stId=null;this.pCtx=null;
  this.theme={name:'cards',primary:'#c41e3a',bg:'#0d0d0d',cardBg:'#1a1a2e',text:'#e8e8e8',border:'#2a2a3e',locked:false};
  this.settings={view:'list'};
  this.load();this.applyTheme();this.applyView();this.bind();this.render();
 }

 bind(){
  ge('sendBtn').onclick=()=>this.send();
  ge('input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();this.send()}};
  ge('viewFab').onclick=()=>this.cycleView();
  ge('undoBtn').onclick=()=>this.undo();
  ge('cancelSel').onclick=()=>this.clearSel();
  ge('mergeSel').onclick=()=>this.prompt('merge');
  ge('deleteSel').onclick=()=>this.bulkDel();
  ge('splitSel').onclick=()=>this.prompt('split');
  ge('promptGo').onclick=()=>this.execPrompt();
  ge('ctxMenu').onclick=e=>{
   const b=e.target.closest('button');if(!b||!this.ctxId)return;
   const a=b.dataset.act;
   if(a==='undo')this.undo(); else this.handleAction(a,this.ctxId);
   this.closeCtx();
  };
  qsa('.overlay').forEach(o=>o.onclick=e=>{if(e.target===o)this.closeModal(o.id)});
 }

 save(){try{localStorage.setItem('ai_ncards',JSON.stringify({cards:this.cards,theme:this.theme,settings:this.settings}))}catch(e){}}
 load(){try{const d=JSON.parse(localStorage.getItem('ai_ncards'));if(!d)return;this.cards=d.cards||[];this.theme={...this.theme,...d.theme};this.settings={...this.settings,...d.settings}}catch(e){}}
 pushHist(t){if(this.hist.length>10)this.hist.shift();this.hist.push({cards:JSON.parse(JSON.stringify(this.cards)),theme:{...this.theme},ts:Date.now(),action:t})}
 undo(){if(!this.hist.length)return toast('Nothing to undo');const s=this.hist.pop();this.cards=s.cards;if(!this.theme.locked)this.theme=s.theme;this.save();this.render();this.applyTheme();toast('Undid: '+s.action)}

 addCard(q,r){const id=crypto.randomUUID(),c={id,q,r};this.cards.push(c);this.pushHist('Add');this.renderCard(c,true);return id}
 delCard(id){this.cards=this.cards.filter(c=>c.id!==id);qs(\`[data-id="\${id}"]\`)?.remove();if(this.fsId===id)this.closeFs();this.save()}
 updCard(id,q,r){const c=this.cards.find(x=>x.id===id);if(!c)return;if(q!==null)c.q=q;if(r!==null)c.r=r;const el=qs(\`[data-id="\${id}"]\`);if(el){if(q!==null)el.querySelector('.face:first-child .face-c').innerHTML=this.md(q);if(r!==null)el.querySelector('.face:last-child .face-c').innerHTML=this.md(r)}this.save()}

 render(){const g=ge('grid');g.innerHTML='';this.updCount();this.cards.forEach(c=>this.renderCard(c,false))}
 renderCard(card,isNew){
  const g=ge('grid');const div=document.createElement('div');
  div.className='card'+(isNew?' new':'');div.dataset.id=card.id;div.tabIndex=0;
  const isStream=card.r==='...';
  const rHtml=isStream?'<div class="thinking"><span>Thinking</span></div>':this.md(card.r);
  div.innerHTML=\`<div class="card-body"><div class="face"><div class="face-h"><span>Request</span><div class="actions"><button onclick="app.openCtx('\${card.id}',event)"><i class="fas fa-ellipsis-v"></i></button><button onclick="app.toggleSel('\${card.id}',event)"><i class="fas fa-check-circle"></i></button></div></div><div class="face-c">\${this.md(card.q)}</div></div><div class="face back"><div class="face-h"><span>Response</span><div class="actions"><button onclick="app.readTTS('\${card.id}',event)"><i class="fas fa-volume-up"></i></button><button onclick="app.openCtx('\${card.id}',event)"><i class="fas fa-ellipsis-v"></i></button></div></div><div class="face-c">\${rHtml}</div></div></div>\`;
  this.attachEv(div,card.id);g.appendChild(div);this.updCount();
 }

 attachEv(div,id){
  div.onclick=e=>{if(e.target.closest('button')||e.target.closest('.actions'))return;if(this.sel.size){e.stopPropagation();this.toggleSel(id,e);return}div.classList.toggle('flip')};
  let lastTap=0;div.ontouchend=e=>{const t=Date.now()-lastTap;if(t<300&&t>0){if(!e.target.closest('button')){this.openFs(id);e.preventDefault()}}lastTap=Date.now()};
  div.ondblclick=e=>{if(!e.target.closest('button'))this.openFs(id)};
  div.oncontextmenu=e=>{e.preventDefault();this.openCtx(id,e)};
 }

 toggleSel(id,e){if(e)e.stopPropagation();if(this.sel.has(id)){this.sel.delete(id);qs(\`[data-id="\${id}"]\`)?.classList.remove('sel')}else{this.sel.add(id);qs(\`[data-id="\${id}"]\`)?.classList.add('sel')}this.updSelBar()}
 clearSel(){this.sel.clear();qsa('.card.sel').forEach(c=>c.classList.remove('sel'));this.updSelBar()}
 bulkDel(){if(!this.sel.size)return;this.pushHist('Delete');const n=this.sel.size;[...this.sel].forEach(id=>this.delCard(id));this.clearSel();toast('Deleted '+n+' cards')}
 updSelBar(){const b=ge('selectionBar');if(this.sel.size){b.classList.add('show');ge('selCount').textContent=this.sel.size}else b.classList.remove('show')}

 openCtx(id,e){if(e)e.preventDefault();this.ctxId=id;const m=ge('ctxMenu');const x=e?e.clientX:100,y=e?e.clientY:100;m.style.left=Math.min(x,window.innerWidth-200)+'px';m.style.top=Math.min(y,window.innerHeight-300)+'px';m.classList.add('show')}
 closeCtx(){ge('ctxMenu').classList.remove('show');this.ctxId=null}

 handleAction(act,id){
  if(act==='merge'||act==='split'||act==='magic'||act==='continue')this.prompt(act,id);
  else if(act==='delete')this.delCard(id);
  else if(act==='view')this.openFs(id);
 }

 prompt(act,id){
  this.pCtx=act;this.stId=id;ge('promptInput').value='';
  const titles={merge:'Merge Cards',split:'Split Card',magic:'Magic Rewrite',continue:'Continue'};
  ge('promptTitle').textContent=titles[act]||act;
  const descs={merge:'Merge selected cards into one:',split:'Split this card into multiple:',magic:'AI will rewrite this card:',continue:'Continue from this card:'};
  ge('promptDesc').textContent=descs[act]||'';
  if(act==='merge')ge('promptInput').value='Merge these cards into a single card.\\n\\n'+this.cards.filter(c=>this.sel.has(c.id)).map(c=>c.q+'\\n'+c.r).join('\\n---\\n');
  if(act==='continue'){const c=this.cards.find(x=>x.id===id);if(c)ge('promptInput').value='Continue from:\\n'+c.r}
  if(act==='magic'){const c=this.cards.find(x=>x.id===id);if(c)ge('promptInput').value='Rewrite this card:\\nRequest: '+c.q+'\\nResponse: '+c.r}
  if(act==='split'){const c=this.cards.find(x=>x.id===id);if(c)ge('promptInput').value='Split this card into multiple cards:\\n'+c.q+'\\n'+c.r}
  this.openModal('modalPrompt');
 }

 execPrompt(){
  const q=ge('promptInput').value.trim();if(!q)return;
  this.closeModal('modalPrompt');
  if(this.pCtx==='merge'){this.pushHist('Merge');[...this.sel].forEach(id=>this.delCard(id));this.clearSel();this.send(q)}
  else if(this.pCtx==='split'){this.pushHist('Split');this.send(q)}
  else if(this.pCtx==='magic'||this.pCtx==='continue'){this.pushHist(this.pCtx);this.send(q)}
  this.stId=null;this.pCtx=null;
 }

 async send(text){
  const q=text||ge('input').value.trim();if(!q)return;
  ge('input').value='';
  const id=this.addCard(q,'...');
  try{
   const resp=await fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:q,cards:this.cards.filter(c=>c.id!==id).map(c=>({q:c.q,r:c.r}))})});
   if(!resp.ok)throw new Error('HTTP '+resp.status);
   const data=await resp.json();
   this.updCard(id,null,data.response||'(no response)');
   this.checkActions(data.response);
  }catch(e){this.updCard(id,null,'Error: '+e.message);toast('Error: '+e.message)}
 }

 checkActions(text){
  if(!text)return;
  if(text.includes('!action:clear!')){this.pushHist('Clear');this.cards=[];this.render();this.save()}
  if(text.includes('!action:view:grid!'))this.setView('grid');
  const tm=text.match(/!theme:([^!]+)!/);if(tm)this.parseTheme(tm[1]);
  const bg=text.match(/!bg:(#[0-9a-fA-F]+)!/);if(bg){this.theme.bg=bg[1];this.applyTheme();this.save()}
  const tx=text.match(/!text:(#[0-9a-fA-F]+)!/);if(tx){this.theme.text=tx[1];this.applyTheme();this.save()}
 }

 parseTheme(str){
  const parts=str.split(',');if(parts[0])this.theme.name=parts[0];
  if(parts[1])this.theme.primary=parts[1];if(parts[2])this.theme.bg=parts[2];
  if(parts[3])this.theme.cardBg=parts[3];if(parts[4])this.theme.text=parts[4];
  if(parts[5])this.theme.border=parts[5];this.applyTheme();this.save();
 }

 applyTheme(){const r=document.documentElement.style;r.setProperty('--p',this.theme.primary);r.setProperty('--p2',this.theme.primary);r.setProperty('--bg',this.theme.bg);r.setProperty('--cb',this.theme.cardBg);r.setProperty('--t',this.theme.text);r.setProperty('--b',this.theme.border)}

 cycleView(){const views=['list','grid','full'];const i=views.indexOf(this.settings.view);this.setView(views[(i+1)%views.length])}
 setView(v){this.settings.view=v;document.body.className='view-'+v;this.save();toast('View: '+v)}
 applyView(){document.body.className='view-'+(this.settings.view||'list')}

 openFs(id){this.fsId=id;const c=this.cards.find(x=>x.id===id);if(!c)return;ge('fsBody').innerHTML=this.md(c.r);ge('fullscreen').classList.add('show')}
 closeFs(){ge('fullscreen').classList.remove('show');this.fsId=null}

 readTTS(id,e){if(e)e.stopPropagation();const c=this.cards.find(x=>x.id===id);if(!c)return;if('speechSynthesis'in window){speechSynthesis.speak(new SpeechSynthesisUtterance(c.r))}else toast('TTS not supported')}

 openModal(id){ge(id).classList.add('show')}
 closeModal(id){ge(id).classList.remove('show')}

 md(text){if(!text)return'';return text
   .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
   .replace(/^### (.*)$/gm,'<h3>$1</h3>')
   .replace(/^## (.*)$/gm,'<h2>$1</h2>')
   .replace(/^# (.*)$/gm,'<h1>$1</h1>')
   .replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>')
   .replace(/\\*(.+?)\\*/g,'<em>$1</em>')
   .replace(/\`(.+?)\`/g,'<code>$1</code>')
   .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g,'<pre><code>$1</code></pre>')
   .replace(/^\\> (.*)$/gm,'<blockquote>$1</blockquote>')
   .replace(/^- (.*)$/gm,'<li>$1</li>')
   .replace(/^(\\d+)\\. (.*)$/gm,'<li>$2</li>')
   .replace(/\\n/g,'<br>')}

 updCount(){const n=this.cards.length;ge('count').textContent=n}
}

const toast=(msg)=>{const t=ge('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2000)};
const app=new App();
`;

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>cards</title>
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="view-list">
<div id="topBar">
 <div class="t-left"><span id="brand">ai-ncards</span><span class="badge" id="count">0</span></div>
 <div class="t-right">
  <button class="sel-btn" id="mergeSel"><i class="fas fa-code-branch"></i> Merge</button>
  <button class="sel-btn" id="splitSel"><i class="fas fa-expand"></i> Split</button>
  <button class="sel-btn danger" id="deleteSel"><i class="fas fa-trash"></i> Delete</button>
 </div>
</div>
<div class="input-area">
 <input type="text" id="input" placeholder="Type a prompt..." autocomplete="off">
 <button id="sendBtn"><i class="fas fa-paper-plane"></i></button>
</div>
<div class="overlay" id="modalPrompt">
 <div class="modal">
  <div class="modal-h"><h3 id="promptTitle">Prompt</h3><button class="btn" onclick="app.closeModal('modalPrompt')"><i class="fas fa-times"></i></button></div>
  <div class="modal-b">
   <small id="promptDesc"></small>
   <textarea id="promptInput" placeholder="Enter prompt..."></textarea>
  </div>
  <div class="modal-f"><button class="btn" onclick="app.closeModal('modalPrompt')">Cancel</button><button class="btn primary" id="promptGo">Go</button></div>
 </div>
</div>
<div class="overlay" id="fullscreen">
 <div class="fs-header">
  <div class="fs-left"><button class="icon-btn" onclick="app.closeFs()"><i class="fas fa-arrow-left"></i></button></div>
 </div>
 <div class="fs-body" id="fsBody"></div>
</div>
<div class="ctx-menu" id="ctxMenu">
 <button data-act="magic"><i class="fas fa-magic"></i> Magic Rewrite</button>
 <button data-act="continue"><i class="fas fa-forward"></i> Continue</button>
 <button data-act="split"><i class="fas fa-expand"></i> Split</button>
 <hr>
 <button data-act="view"><i class="fas fa-expand-arrows-alt"></i> Fullscreen</button>
 <button data-act="undo"><i class="fas fa-undo"></i> Undo</button>
 <hr>
 <button class="danger" data-act="delete"><i class="fas fa-trash"></i> Delete</button>
</div>
<div id="toast"></div>
<script src="/script.js"></script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/chat" && request.method === "POST") {
      return handleChat(request, env);
    }

    if (path === "/style.css") {
      return new Response(CSS, { headers: { "Content-Type": "text/css" } });
    }

    if (path === "/script.js") {
      return new Response(JS, { headers: { "Content-Type": "application/javascript" } });
    }

    return new Response(HTML, { headers: { "Content-Type": "text/html" } });
  },
};

async function handleChat(request, env) {
  try {
    const body = await request.json();
    const prompt = body.prompt || "";
    const contextCards = body.cards || [];

    let contextMsg = "";
    if (contextCards.length > 0) {
      contextMsg = "\n\nExisting cards:\n" + contextCards.map(c => `Request: ${c.q}\nResponse: ${c.r}`).join("\n---\n");
    }

    const fullPrompt = prompt + contextMsg;

    // KV cache: exact-match lookup
    const cacheKey = await hashKey(fullPrompt);
    if (env.KV) {
      const cached = await env.KV.get(cacheKey);
      if (cached) {
        return new Response(JSON.stringify({ response: cached, cached: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Call OpenRouter directly (no proxy)
    const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://ai.nspired.cc",
        "X-Title": "cards",
      },
      body: JSON.stringify({
        model: "inclusionai/ling-2.6-flash",
        messages: [
          { role: "system", content: "You are ai-ncards, a card-based document builder. Keep responses concise. Support actions: !action:merge! !action:clear! !action:view:grid! and theme: !theme:Name,Primary,Bg,CardBg,Text,Border!" },
          { role: "user", content: fullPrompt },
        ],
        max_tokens: 2000,
      }),
    });

    if (!orResponse.ok) {
      const errText = await orResponse.text();
      return new Response(JSON.stringify({ error: `OpenRouter error: ${orResponse.status}`, detail: errText }), {
        status: orResponse.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const orData = await orResponse.json();
    const responseText = orData.choices?.[0]?.message?.content || "(no response)";

    // Cache in KV (TTL: 1 hour)
    if (env.KV) {
      await env.KV.put(cacheKey, responseText, { expirationTtl: 3600 });
    }

    return new Response(JSON.stringify({ response: responseText, cached: false }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function hashKey(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = [...new Uint8Array(hashBuffer)];
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
