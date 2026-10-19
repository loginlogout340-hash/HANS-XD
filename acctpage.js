'use strict';
/** HANS-XD account pages: /signup, /login and /dashboard (self-contained HTML, no extra packages). */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
:root{--bg:#07110c;--card:rgba(18,30,24,.82);--line:#24382e;--text:#ecf5ef;--mute:#8fa89a;--accent:#25d366;--bad:#ff6b6b;--gold:#ffd166}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
background:radial-gradient(900px 500px at 85% -10%,rgba(37,211,102,.20),transparent 60%),radial-gradient(700px 500px at -10% 110%,rgba(18,161,80,.18),transparent 60%),var(--bg)}
.wrap{max-width:520px;margin:0 auto;padding:24px 16px 44px}
.top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:18px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;letter-spacing:-.3px;color:var(--text);text-decoration:none}
.logo{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-size:18px;font-weight:800;color:#04210f;background:linear-gradient(135deg,#5bf09a,#1fb85a)}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:20px;margin-bottom:14px;backdrop-filter:blur(8px)}
h1{margin:0 0 4px;font-size:26px;letter-spacing:-.4px}h2{margin:0 0 10px;font-size:16px;color:#8fe3b0}
.sub{margin:0 0 6px;color:var(--mute);font-size:14.5px}
label{display:block;margin:14px 0 6px;font-size:13px;color:var(--mute)}
input,select{width:100%;padding:13px 14px;font-size:16px;color:var(--text);background:#0a1510;border:1px solid var(--line);border-radius:12px;outline:none}
input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(37,211,102,.15)}
button{font:inherit}
.main{width:100%;margin-top:16px;padding:14px;font-size:16px;font-weight:700;color:#04210f;border:0;border-radius:12px;cursor:pointer;background:linear-gradient(135deg,#43e883,#1fb85a);box-shadow:0 8px 22px rgba(37,211,102,.25)}
.ghost{padding:10px 14px;font-size:14px;color:var(--text);background:transparent;border:1px solid var(--line);border-radius:11px;cursor:pointer}
button:disabled{opacity:.55;cursor:default}
.err{margin-top:12px;color:var(--bad);font-size:14px;min-height:1em}
.note{margin-top:12px;padding:11px 13px;font-size:14px;color:#b9f5cf;background:rgba(37,211,102,.10);border:1px solid rgba(37,211,102,.35);border-radius:12px}
.alt{margin-top:16px;text-align:center;color:var(--mute);font-size:14px}.alt a,a.l{color:#7be8a8}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between}
.pill{display:inline-block;padding:3px 10px;border-radius:99px;font-size:12.5px;border:1px solid var(--line)}
.on{color:#04210f;background:var(--accent);border-color:var(--accent)}.off{color:var(--mute)}.warn{color:#3a2a00;background:var(--gold);border-color:var(--gold)}
.big{font:700 34px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:3px;text-align:center;color:#eafff2;margin:8px 0}
.kv{display:grid;grid-template-columns:1fr auto;gap:6px 12px;font-size:15px}.kv span:nth-child(odd){color:var(--mute)}
.plans{display:grid;gap:10px;margin-top:10px}
.plan{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.02)}
.plan b{font-size:20px;color:var(--gold)}.plan small{display:block;color:var(--mute)}
.plan button{padding:9px 14px;border:0;border-radius:10px;font-weight:700;color:#04210f;background:var(--accent);cursor:pointer}
.hide{display:none!important}
.ref{font:700 20px/1.2 ui-monospace,Menlo,Consolas,monospace;color:var(--gold);letter-spacing:1px}
ol{margin:10px 0 0;padding-left:20px;color:#cfe0d6;font-size:14.5px}
`;

const head = (botName, title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#07110c"><title>${esc(title)} - ${esc(botName)}</title><style>${CSS}</style></head><body><div class="wrap">
<div class="top"><a class="brand" href="/"><span class="logo">XD</span>${esc(botName)}</a><span id="who"></span></div>`;

const COMMON_JS = `
var $=function(i){return document.getElementById(i)};
function api(p,b){return fetch(p,{method:b?'POST':'GET',credentials:'same-origin',headers:{'content-type':'application/json','x-xd':'1'},body:b?JSON.stringify(b):undefined}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok){var e=new Error(j.error||'Something went wrong.');e.status=r.status;throw e}return j})})}
function dt(t){return new Date(t).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
`;

function authPage(botName, mode, opts = {}) {
  const signup = mode === 'signup';
  return head(botName, signup ? 'Create account' : 'Log in') + `
<div class="card"><h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
<p class="sub">${signup ? 'One account to link your WhatsApp, manage your plan and invite friends.' : 'Log in to open your dashboard.'}</p>
<form id="f" autocomplete="on">
${signup ? '<label for="name">Your name</label><input id="name" name="name" autocomplete="name" maxlength="40" required>' : ''}
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required>
<label for="pw">Password${signup ? ' (at least 8 characters)' : ''}</label><input id="pw" name="pw" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="${signup ? 8 : 1}" required>
${signup ? '<label for="ref">Invite code (optional)</label><input id="ref" name="ref" maxlength="12" autocapitalize="characters" placeholder="XD..." >' : ''}
<button class="main" id="go" type="submit">${signup ? 'Sign up' : 'Log in'}</button><div class="err" id="e"></div></form>
${signup && opts.trialDays ? `<div class="note">New accounts get a free ${Number(opts.trialDays)}-day trial on their first number.</div>` : ''}
<div class="alt">${signup ? 'Already have an account? <a href="/login">Log in</a>' : 'New here? <a href="/signup">Create an account</a>'}</div></div>
<script>${COMMON_JS}
(function(){var q=new URLSearchParams(location.search);var r=q.get('ref');if($('ref')&&r)$('ref').value=r.toUpperCase().slice(0,12);
$('f').onsubmit=function(ev){ev.preventDefault();$('e').textContent='';$('go').disabled=true;
var b={email:$('email').value,password:$('pw').value};if($('name'))b.name=$('name').value;if($('ref'))b.ref=$('ref').value;
api('/api/auth/${signup ? 'signup' : 'login'}',b).then(function(){location.href='/dashboard'}).catch(function(e){$('e').textContent=e.message;$('go').disabled=false})}})();
</script></div></body></html>`;
}

function dashboardPage(botName) {
  return head(botName, 'Dashboard') + `
<div id="load" class="card sub">Loading...</div>
<div id="app" class="hide">
<div class="card"><div class="row"><div><h1 id="hi">Hello</h1><p class="sub" id="em"></p></div><button class="ghost" id="out">Log out</button></div></div>

<div class="card"><h2>Your bot</h2>
<div id="bot-none">
<p class="sub">Link your WhatsApp number. You get a pairing code to type in WhatsApp &gt; Linked devices &gt; Link with phone number.</p>
<label for="num">WhatsApp number with country code</label><input id="num" inputmode="numeric" placeholder="233241234567" autocomplete="tel">
<div id="accw"><label for="acc">Access code (only if you have one)</label><input id="acc" autocapitalize="characters" placeholder="Optional"></div>
<button class="main" id="pair">Get pairing code</button>
<div id="pcode" class="hide"><div class="big" id="pc"></div><ol><li>Open WhatsApp on that phone</li><li>Settings &gt; Linked devices &gt; Link a device</li><li>Choose "Link with phone number instead" and type the code</li></ol></div>
<div class="err" id="pe"></div>
<div class="alt">Already linked before? Send <b>.claim</b> to your bot and enter the code here:</div>
<div class="row" style="margin-top:8px"><input id="cl" inputmode="numeric" placeholder="6-digit code" style="flex:1"><button class="ghost" id="claim">Claim</button></div>
<div class="err" id="ce"></div>
</div>
<div id="bot-has" class="hide"><div class="kv"><span>Number</span><span id="bn"></span><span>Status</span><span id="bs"></span><span>Commands run</span><span id="bc"></span><span>Last active</span><span id="bl"></span></div>
<div class="row" style="margin-top:12px"><button class="ghost" id="repair">Link again</button><button class="ghost" id="unclaim">Remove from account</button></div></div></div>

<div class="card"><h2>Your plan</h2><div id="planbox"></div>
<div class="plans" id="plans"></div><div class="err" id="pye"></div>
<div id="nopay" class="sub hide">Online payment is off. <a class="l" href="/">Pay with Mobile Money on the main page</a>, or enter a code you were given:</div>
</div>

<div class="card"><h2>Invite friends</h2><p class="sub">Share your link. When a friend pays for the first time, you get bonus days.</p>
<div class="ref" id="rc"></div><div class="row" style="margin-top:10px"><span class="sub" id="rs"></span><button class="ghost" id="cp">Copy link</button></div></div>

<div class="card"><h2>Password</h2>
<label for="op">Current password</label><input id="op" type="password" autocomplete="current-password">
<label for="np">New password</label><input id="np" type="password" autocomplete="new-password" minlength="8">
<button class="ghost" id="chg" style="margin-top:12px">Change password</button><div class="err" id="ge"></div></div>
</div>
<script>${COMMON_JS}
var S=null,poll=null;
function show(){var u=S;$('load').classList.add('hide');$('app').classList.remove('hide');
$('hi').textContent='Hello, '+u.name;$('em').textContent=u.email;
var has=!!u.number;$('bot-none').classList.toggle('hide',has);$('bot-has').classList.toggle('hide',!has);
$('accw').classList.toggle('hide',!u.restricted);
if(has){$('bn').textContent='+'+u.number;var st=u.state;$('bs').innerHTML='<span class="pill '+(st==='connected'?'on':st==='pending'?'warn':'off')+'">'+(st==='connected'?'online':st==='pending'?'waiting for pairing':'not linked')+'</span>';
$('bc').textContent=u.stats?u.stats.commands:0;$('bl').textContent=u.stats&&u.stats.lastActive?dt(u.stats.lastActive):'-';
$('repair').classList.toggle('hide',st==='connected')}
var p=u.plan,pb=$('planbox');pb.textContent='';
var d=document.createElement('div');d.className='kv';
if(p){d.innerHTML='<span>Status</span><span><span class="pill '+(p.active?'on':'warn')+'">'+(p.active?'active':'ended')+'</span></span><span>'+(p.active?'Ends':'Ended')+'</span><span>'+dt(p.expiresAt)+'</span><span>Type</span><span>'+p.source+'</span>'}
else{d.innerHTML='<span>Status</span><span><span class="pill off">no plan yet</span></span>'}
pb.appendChild(d);
if(u.trialAvailable&&!p){var n=document.createElement('div');n.className='note';n.textContent='Free '+u.trialDays+'-day trial: it starts when you get your pairing code.';pb.appendChild(n)}
if(u.pendingDays){var n2=document.createElement('div');n2.className='note';n2.textContent=u.pendingDays+' bonus days are waiting. They are added when you link a number.';pb.appendChild(n2)}
var pl=$('plans');pl.textContent='';$('nopay').classList.toggle('hide',!!u.payments);
if(u.payments){u.plans.forEach(function(x){var r=document.createElement('div');r.className='plan';
var l=document.createElement('div');l.innerHTML='<b></b><small></small>';l.firstChild.textContent='GH\\u20B5'+x.price;l.lastChild.textContent=x.name;
var b=document.createElement('button');b.textContent='Pay';b.onclick=function(){if(!u.number&&!$('num').value){$('pye').textContent='Link a number first, or type it above.';return}
b.disabled=true;$('pye').textContent='';api('/api/me/pay/start',{plan:x.id,number:u.number||$('num').value}).then(function(j){location.href=j.url}).catch(function(e){$('pye').textContent=e.message;b.disabled=false})};
r.appendChild(l);r.appendChild(b);pl.appendChild(r)})}
var link=location.origin+'/signup?ref='+u.refCode;$('rc').textContent=u.refCode;
$('rs').textContent=u.refCount+' friend'+(u.refCount===1?'':'s')+' paid \\u00B7 '+u.bonusEarned+' bonus days earned';$('cp').onclick=function(){try{navigator.clipboard.writeText(link);$('cp').textContent='Copied'}catch(e){prompt('Copy your link',link)}};
$('who').innerHTML=''}
function load(){return api('/api/me').then(function(j){S=j;show();if(j.state==='pending'&&!poll)poll=setInterval(function(){api('/api/me').then(function(k){S=k;show();if(k.state!=='pending'){clearInterval(poll);poll=null}}).catch(function(){})},4000)}).catch(function(e){if(e.status===401)location.href='/login';else $('load').textContent=e.message})}
$('out').onclick=function(){api('/api/auth/logout',{}).then(function(){location.href='/login'})};
$('pair').onclick=function(){var b=$('pair');b.disabled=true;$('pe').textContent='';$('pcode').classList.add('hide');
api('/api/me/pair',{number:$('num').value,access:$('acc').value}).then(function(j){$('pc').textContent=j.code;$('pcode').classList.remove('hide');load()}).catch(function(e){$('pe').textContent=e.message}).then(function(){b.disabled=false})};
$('claim').onclick=function(){$('ce').textContent='';api('/api/me/claim',{code:$('cl').value}).then(load).catch(function(e){$('ce').textContent=e.message})};
$('unclaim').onclick=function(){if(confirm('Remove this number from your account? The bot stays linked.'))api('/api/me/detach',{}).then(load)};
$('repair').onclick=function(){api('/api/me/detach',{}).then(load)};
$('chg').onclick=function(){$('ge').textContent='';api('/api/auth/password',{old:$('op').value,password:$('np').value}).then(function(){location.href='/login'}).catch(function(e){$('ge').textContent=e.message})};
(function(){var q=new URLSearchParams(location.search),r=q.get('reference')||q.get('trxref');if(r){api('/api/pay/verify?ref='+encodeURIComponent(r)).then(function(){history.replaceState(null,'','/dashboard');load()}).catch(function(){history.replaceState(null,'','/dashboard');load()})}else load()})();
</script></div></body></html>`;
}

module.exports = { authPage, dashboardPage };
