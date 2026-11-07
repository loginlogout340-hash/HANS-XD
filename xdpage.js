'use strict';
/**
 * The HANS-XD pairing website (served at "/" by gate.js while the channel gate is on).
 *
 *   Step 1  open and join both channels
 *   Step 2  type the WhatsApp number and get the pairing code   (unlocked only after step 1)
 *   Step 3  link it in WhatsApp; the page waits and shows when the bot is connected
 *
 * It talks to the same API as the old page:  POST /api/pair  and  GET /api/status?number=
 * module.exports = ({ botName, channels, strict, minutes }) => html string
 */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TEMPLATE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#06100c">
<title>__NAME__ - link your WhatsApp</title>
<style>
:root{color-scheme:dark;--bg:#06100c;--card:#0d1a14;--line:#1f3329;--tx:#e9f3ee;--mu:#8da69a;--ac:#2bd46b;--ac2:#1fa855;--bad:#ff7b7b}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0}
body{background:radial-gradient(1100px 480px at 50% -8%,#0f2a1d 0,transparent 62%),var(--bg);color:var(--tx);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;min-height:100vh}
.w{max-width:520px;margin:0 auto;padding:28px 16px 56px}
.logo{width:72px;height:72px;margin:0 auto 14px;border-radius:20px;background:linear-gradient(135deg,#52e88a,#1fa855);color:#05200f;font-weight:800;font-size:40px;display:grid;place-items:center}
h1{text-align:center;margin:0;font-size:30px;letter-spacing:.5px}
.sub{text-align:center;color:var(--mu);margin:8px 0 22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;margin-bottom:14px}
.card.off{opacity:.5}
.head{display:flex;gap:10px;align-items:center;margin:0 0 6px;font-weight:700;font-size:17px}
.num{width:28px;height:28px;border-radius:50%;background:#14301f;color:var(--ac);display:grid;place-items:center;font-size:14px;flex:none}
.card.done .num{background:var(--ac);color:#05200f}
.hint{color:var(--mu);font-size:14px;margin:0 0 10px}
a.ch{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:52px;padding:12px 14px;margin:8px 0;border:1px solid var(--line);border-radius:12px;background:#0a1510;color:var(--tx);text-decoration:none;font-weight:600}
a.ch .tag{font-size:13px;font-weight:600;padding:4px 10px;border-radius:999px;background:#14301f;color:var(--ac);white-space:nowrap}
a.ch.ok{border-color:var(--ac2)}
a.ch.ok .tag{background:var(--ac);color:#05200f}
label{display:block;color:var(--mu);font-size:14px;margin:4px 0 6px}
input{width:100%;min-height:52px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:#07110c;color:var(--tx);font:inherit;font-size:18px;letter-spacing:.5px}
input:focus{outline:2px solid var(--ac2);outline-offset:1px}
button{width:100%;min-height:52px;margin-top:12px;border:0;border-radius:12px;background:linear-gradient(180deg,#3ce57a,#25c460);color:#04210f;font:inherit;font-weight:700;font-size:17px;cursor:pointer}
button:disabled{background:#1a2a21;color:#5d7a6c;cursor:not-allowed}
button.alt{background:transparent;color:var(--tx);border:1px solid var(--line);font-weight:600}
.err{color:var(--bad);margin:12px 0 0;font-size:15px}
.code{font:700 38px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:4px;text-align:center;margin:10px 0 4px;color:var(--ac)}
.left{text-align:center;color:var(--mu);font-size:14px;margin:0 0 6px}
ol{margin:12px 0 0;padding-left:20px;color:var(--tx)}
ol li{margin:4px 0}
.ok-box{border:1px solid var(--ac2);background:#0b2216;border-radius:12px;padding:14px;margin-top:12px}
.note{color:var(--mu);font-size:13px;margin-top:10px}
</style>
</head>
<body>
<div class="w">
  <div class="logo">H</div>
  <h1>__NAME__</h1>
  <p class="sub">Your own WhatsApp bot. Free. Link your number in minutes.</p>

  <div class="card" id="k1">
    <div class="head"><span class="num">1</span>Join both channels</div>
    <p class="hint">Tap each button, then tap Follow in WhatsApp and come back here.</p>
__CHANNELS__
  </div>

  <div class="card off" id="k2">
    <div class="head"><span class="num">2</span>Get your pairing code</div>
    <label for="num">Your WhatsApp number (with country code)</label>
    <input id="num" type="tel" inputmode="numeric" autocomplete="tel" placeholder="233241234567">
    <button id="go" type="button" disabled>Get pairing code</button>
    <div class="err" id="err" hidden></div>
  </div>

  <div class="card" id="k3" hidden>
    <div class="head"><span class="num">3</span>Link it in WhatsApp</div>
    <div class="code" id="code"></div>
    <p class="left" id="left"></p>
    <button id="copy" type="button" class="alt">Copy code</button>
    <ol>
      <li>Open WhatsApp, then Settings, then Linked devices.</li>
      <li>Tap Link a device, then Link with phone number instead.</li>
      <li>Type the code above.</li>
    </ol>
    <p class="note" id="wait">Waiting for you to link...</p>
    <div class="ok-box" id="done" hidden>
      <b>Connected!</b> Open WhatsApp and send <b>.menu</b> to any chat.<br>
      <span id="after"></span>
    </div>
    <button id="again" type="button" class="alt" hidden>Get a new code</button>
  </div>

  <p class="note" style="text-align:center">After you link, the bot checks that your number really follows both channels.</p>
</div>

<script>
(function(){
var DATA=__DATA__;
var CH=DATA.channels,STRICT=DATA.strict,MINS=DATA.minutes;
var $=function(i){return document.getElementById(i)};
var mem={};
function get(k){if(mem[k])return true;try{return localStorage.getItem(k)==='1'}catch(e){return false}}
function put(k){mem[k]=true;try{localStorage.setItem(k,'1')}catch(e){}}
function digits(v){return String(v||'').replace(/\D/g,'')}
function validNum(n){return n.length>=8&&n.length<=15&&n.charAt(0)!=='0'}
function allOpened(){for(var i=0;i<CH.length;i++)if(!get('xdg'+CH[i].n))return false;return true}
var busy=false,tick=null,poll=null,endAt=0,raw='',number='';

function render(){
  var all=allOpened();
  for(var i=0;i<CH.length;i++){
    var ok=get('xdg'+CH[i].n);
    $('c'+CH[i].n).className='ch'+(ok?' ok':'');
    $('t'+CH[i].n).textContent=ok?'Opened \u2713':'Tap to join';
  }
  $('k1').className='card'+(all?' done':'');
  $('k2').className='card'+(all?'':' off');
  if(all){document.cookie='xd_gate=1; Path=/; Max-Age=31536000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'')}
  $('go').disabled=busy||!all||!validNum(digits($('num').value));
}
function err(t){var e=$('err');e.textContent=t;e.hidden=false}
function noErr(){$('err').hidden=true}
function stop(){clearInterval(tick);clearInterval(poll);tick=null;poll=null}

function mmss(ms){var s=Math.max(0,Math.round(ms/1000));var m=Math.floor(s/60);s=s%60;return m+':'+(s<10?'0':'')+s}
function expired(){
  stop();
  $('left').textContent='This code has expired.';
  $('wait').hidden=true;
  $('again').hidden=false;
}
function connected(){
  stop();
  $('wait').hidden=true;
  $('left').hidden=true;
  $('done').hidden=false;
  $('after').textContent=STRICT
    ?'The bot now checks that you follow both channels. If you did not join, you have '+MINS+' minutes, then the bot is removed from your WhatsApp.'
    :'The bot now checks that you follow both channels. If you did not join, it stays locked until you join and send .joined';
}
function showCode(code,n){
  noErr();
  raw=code.replace(/-/g,'');number=n;
  $('code').textContent=code;
  $('k3').hidden=false;
  $('done').hidden=true;$('again').hidden=true;$('wait').hidden=false;$('left').hidden=false;
  endAt=Date.now()+4*60*1000;
  stop();
  $('left').textContent='Valid for '+mmss(endAt-Date.now());
  tick=setInterval(function(){
    var left=endAt-Date.now();
    if(left<=0){expired();return}
    $('left').textContent='Valid for '+mmss(left);
  },1000);
  poll=setInterval(function(){
    fetch('/api/status?number='+encodeURIComponent(number)).then(function(r){return r.json()}).then(function(j){
      if(j&&j.state==='connected')connected();
      else if(j&&j.state==='none'&&Date.now()-(endAt-4*60*1000)>20000)expired();
    }).catch(function(){});
  },4000);
  try{$('k3').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){}
}
function reset(){busy=false;$('go').textContent='Get pairing code';render()}

for(var i=0;i<CH.length;i++){
  (function(n){
    $('c'+n).addEventListener('click',function(){put('xdg'+n);setTimeout(render,400)});
  })(CH[i].n);
}
$('num').addEventListener('input',function(){noErr();render()});
$('go').addEventListener('click',function(){
  if(busy)return;
  var n=digits($('num').value);
  noErr();
  if(!allOpened()){err('Open both channels first (step 1).');return}
  if(!validNum(n)){err('Type your number with the country code: digits only, no + and no leading 0. Example: 233241234567');return}
  busy=true;$('go').disabled=true;$('go').textContent='Making your code...';
  fetch('/api/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({number:n,access:''})})
    .then(function(r){return r.json().catch(function(){return{}}).then(function(j){return{ok:r.ok,j:j||{}}})})
    .then(function(x){
      reset();
      if(!x.ok||!x.j.code){err(x.j.error||'Something went wrong. Please try again in a minute.');return}
      showCode(x.j.code,n);
    })
    .catch(function(){reset();err('Cannot reach the server. Check your internet and try again.')});
});
$('copy').addEventListener('click',function(){
  var b=$('copy');
  function ok(){b.textContent='Copied \u2713';setTimeout(function(){b.textContent='Copy code'},1800)}
  try{navigator.clipboard.writeText(raw).then(ok,function(){b.textContent=raw})}catch(e){b.textContent=raw}
});
$('again').addEventListener('click',function(){stop();$('k3').hidden=true;$('num').focus();render()});
render();
})();
</script>
</body>
</html>`;

module.exports = function page({ botName, channels, strict, minutes }) {
  const chs = (channels || []).slice(0, 2);
  const links = chs.map((c) => `    <a class="ch" id="c${c.n}" href="${esc(c.link)}" target="_blank" rel="noopener"><span>&#128226; ${esc(c.name)}</span><span class="tag" id="t${c.n}">Tap to join</span></a>`).join('\n');
  const data = JSON.stringify({ channels: chs.map((c) => ({ n: c.n })), strict: !!strict, minutes: Number(minutes) || 10 }).replace(/</g, '\\u003c');
  return TEMPLATE
    .replace(/__NAME__/g, () => esc(botName || 'HANS-XD'))
    .replace('__CHANNELS__', () => links)
    .replace('__DATA__', () => data);
};
