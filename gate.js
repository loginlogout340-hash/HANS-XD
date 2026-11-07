'use strict';
/**
 * HANS-XD channel gate.
 *
 *  1. FOOTER  - a channel link is added under the answer of every command.
 *  2. GATE    - a user must join BOTH channels before the bot works for them:
 *               - website: the pairing page and the dashboard show two "join" buttons, and the
 *                 server refuses to make a pairing code until both were tapped;
 *               - bot: after linking, the bot checks (with the user's own WhatsApp session) that
 *                 the number really follows both channels. If not, commands are blocked and the
 *                 user gets the two links and is told to send .joined
 *  3. .joined - re-checks right now.
 *
 * Railway variables:
 *   CHANNEL_1_LINK, CHANNEL_2_LINK   your two channel links (https://whatsapp.com/channel/...)  [needed for the gate]
 *   CHANNEL_1_NAME, CHANNEL_2_NAME   optional names shown on the buttons
 *   CHANNEL_GATE=off                 switch the gate off (the footer stays)
 *   FOOTER=off                       remove the footer under commands
 *   FOOTER_CHANNEL=1|2|both          which link goes under commands (default 1)
 *
 * Nothing in the other files had to change: index.js installs this file.
 */
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
const env = (k) => String(process.env[k] || '').trim();
const off = (v) => /^(off|false|0|no)$/i.test(String(v || ''));
const adminNumber = () => env('ADMIN_NUMBER').replace(/\D/g, '');
const isAdminNumber = (n) => !!adminNumber() && String(n) === adminNumber();

/* ---------------- the two channels ---------------- */
function linkOf(i) {
  let v = env('CHANNEL_' + i + '_LINK').replace(/^["']+|["']+$/g, '').trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try { new URL(v); } catch { return null; }
  return v;
}
function channels() {
  const out = [];
  for (const i of [1, 2]) {
    const link = linkOf(i);
    if (!link) continue;
    const m = link.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i);
    out.push({ n: i, name: env('CHANNEL_' + i + '_NAME') || 'Channel ' + i, link, code: m ? m[1] : null });
  }
  return out;
}
/** the gate needs both links */
const gateOn = () => channels().length === 2 && !off(env('CHANNEL_GATE'));

/* ---------------- footer under every command ---------------- */
function footerText() {
  if (off(env('FOOTER'))) return '';
  const chs = channels();
  if (!chs.length) return '';
  const want = env('FOOTER_CHANNEL').toLowerCase() || '1';
  let list = want === 'both' ? chs : chs.filter((c) => String(c.n) === want);
  if (!list.length) list = [chs[0]];
  return list.length === 1 ? `📢 *Join our channel:*\n${list[0].link}` : '📢 *Join our channels:*\n' + list.map((c) => c.link).join('\n');
}
// silent commands must stay silent
const NO_FOOTER = new Set(['retrieve', 'savestatus', 'joined']);
// the menu caption is so long that WhatsApp hides its end behind "Read more": the link goes in its own message under it
const SEPARATE = new Set(['menu']);

/** adds the footer to the first text / picture / video / file message sent while a command runs */
function decorate(jid, content) {
  const st = als.getStore();
  if (!st || st.done || jid !== st.jid || !content || typeof content !== 'object') return content;
  if (content.react || content.delete || content.edit || content.forward || content.poll || content.contacts || content.location || content.sticker || content.audio) return content;
  if (typeof content.text === 'string' && content.text) { st.done = true; return { ...content, text: content.text + '\n\n' + st.footer }; }
  if (content.image || content.video || content.document) {
    st.done = true;
    const cap = typeof content.caption === 'string' && content.caption ? content.caption + '\n\n' : '';
    return { ...content, caption: cap + st.footer };
  }
  return content;
}
function wrapSock(sock) {
  if (!sock || sock.__xdGate || typeof sock.sendMessage !== 'function') return;
  sock.__xdGate = true;
  const raw = sock.sendMessage.bind(sock);
  sock.sendMessage = (jid, content, opts) => {
    let c = content;
    try { c = decorate(jid, content); } catch (e) { console.error('[gate] footer:', e.message); }
    return raw(jid, c, opts);
  };
}

/* ---------------- does this number follow both channels? ---------------- */
const OK_TTL = 10 * 60000; // a "yes" is trusted for 10 minutes
const BAD_TTL = 20000;      // a "no" is checked again after 20 seconds
const cache = new Map();    // number -> { ok, missing, unknown, t }
const pending = new Map();  // number -> promise (several commands at once ask once)
const timeout = (ms) => new Promise((_r, rej) => setTimeout(() => rej(new Error('timeout')), ms).unref());
let warnedUnknown = false;

/** 'yes' | 'no' | 'unknown' (unknown = WhatsApp did not say; the bot is then NOT blocked) */
async function followState(sock, ch) {
  if (!ch.code || !sock || typeof sock.newsletterMetadata !== 'function') return 'unknown';
  try {
    const m = await Promise.race([sock.newsletterMetadata('invite', ch.code), timeout(15000)]);
    const role = m && ((m.viewer_metadata && m.viewer_metadata.role) || (m.viewerMetadata && m.viewerMetadata.role));
    if (process.env.DEBUG_EXTRA) console.log('[gate]', ch.link, 'role =', role);
    if (!role) return 'unknown';
    return /^(SUBSCRIBER|ADMIN|OWNER)$/i.test(String(role)) ? 'yes' : 'no';
  } catch (e) {
    if (process.env.DEBUG_EXTRA) console.log('[gate] check failed for', ch.link, e.message);
    return 'unknown';
  }
}
async function runCheck(sock, number) {
  const chs = channels();
  const states = await Promise.all(chs.map((c) => followState(sock, c)));
  const missing = chs.filter((_c, i) => states[i] === 'no');
  const res = { ok: missing.length === 0, missing, unknown: states.includes('unknown'), t: Date.now() };
  if (res.unknown && !warnedUnknown) {
    warnedUnknown = true;
    console.warn('[gate] WhatsApp did not say whether +' + number + ' follows the channels (only whatsapp.com/channel links can be checked). Such numbers are not blocked.');
  }
  cache.set(number, res);
  return res;
}
async function check(sock, number, force) {
  const hit = cache.get(number);
  if (!force && hit && Date.now() - hit.t < (hit.ok ? OK_TTL : BAD_TTL)) return hit;
  if (!pending.has(number)) pending.set(number, runCheck(sock, number).finally(() => pending.delete(number)));
  return pending.get(number);
}

const lockText = (prefix, missing) => {
  const chs = channels();
  const show = missing && missing.length && missing.length < chs.length ? missing : chs;
  return '🔒 *This bot is locked*\nThe owner must join ' + (show.length === 1 ? 'this channel' : 'BOTH channels') + ' first:\n\n'
    + show.map((c) => `${c.n === 1 ? '1️⃣' : '2️⃣'} ${c.name}\n${c.link}`).join('\n\n')
    + `\n\nAfter joining, send *${prefix}joined* to unlock.`;
};

/* ---------------- block the commands of a locked bot ---------------- */
const LOCK_EXEMPT = new Set(['joined', 'unlink']);
const lockedAt = new Map();
async function allowed(ctx, cmd) {
  if (!gateOn()) return true;
  const number = ctx.config && ctx.config.owners && ctx.config.owners[0];
  if (!number || isAdminNumber(number) || LOCK_EXEMPT.has(cmd.name)) return true;
  let st;
  try { st = await check(ctx.sock, number, false); } catch (e) { console.error('[gate] check:', e.message); return true; } // never lock anyone out because of our own error
  if (st.ok) return true;
  const now = Date.now();
  if (now - (lockedAt.get(ctx.jid) || 0) > 20000) { // one lock message per chat every 20 seconds
    lockedAt.set(ctx.jid, now);
    if (lockedAt.size > 500) lockedAt.delete(lockedAt.keys().next().value);
    try { await ctx.reply(lockText(ctx.prefix, st.missing)); } catch { /* ignore */ }
  }
  return false;
}

/** wraps every command: lock check first, then the footer. Call after bot.js has loaded. */
function wrapCommands(commands) {
  for (const c of commands) {
    if (c.__xdGate) continue;
    c.__xdGate = true;
    const orig = c.run;
    c.run = async function gated(ctx) {
      if (!(await allowed(ctx, c))) return undefined;
      const number = ctx.config && ctx.config.owners && ctx.config.owners[0];
      const footer = isAdminNumber(number) || NO_FOOTER.has(c.name) ? '' : footerText();
      if (!footer) return orig.call(this, ctx);
      wrapSock(ctx.sock);
      const separate = SEPARATE.has(c.name);
      const store = { jid: ctx.jid, done: separate, footer };
      const out = await als.run(store, () => orig.call(this, ctx));
      // most commands return their answer as text: the footer goes under it
      if (typeof out === 'string' && out) return separate || !store.done ? out + '\n\n' + footer : out;
      if (separate) { try { await ctx.sock.sendMessage(ctx.jid, { text: footer }); } catch { /* ignore */ } }
      return out;
    };
  }
}

/** the .joined command (extra.js calls register(add) once; index.js adds this to it) */
function register(add) {
  add('joined', 'General', '', 'Check that you joined both channels', async (ctx) => {
    if (!gateOn()) return '✅ Nothing to check right now.';
    const number = ctx.config.owners[0];
    if (isAdminNumber(number)) return '👑 You are the admin. Nothing to check.';
    const st = await check(ctx.sock, number, true);
    return st.ok ? '✅ Thank you! Both channels are joined. Your bot is unlocked.' : lockText(ctx.prefix, st.missing);
  }, { aliases: ['verify', 'checkjoin'] });
}

/* ---------------- website ---------------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COOKIE_OK = /(?:^|;\s*)xd_gate=1(?:;|$)/;

function widget() {
  const chs = channels();
  const buttons = chs.map((c) => `<a class="xdg-b" href="${esc(c.link)}" target="_blank" rel="noopener" data-n="${c.n}">&#128226; ${esc(c.name)}<em></em></a>`).join('');
  return `<style>
#xdg{box-sizing:border-box;max-width:560px;margin:12px auto;padding:14px 16px;border:1px solid #2a3a33;border-radius:14px;background:#101a16;color:#e8f1ec;font:15px/1.45 system-ui,sans-serif}
#xdg b{display:block;margin-bottom:6px;color:#8fe3b0}
#xdg .xdg-b{display:block;margin:8px 0;padding:11px 12px;border-radius:10px;background:#25d366;color:#04210f;font-weight:600;text-decoration:none;text-align:center}
#xdg .xdg-b.ok{background:#1b2a23;color:#8fe3b0;border:1px solid #2a3a33}
#xdg #xdg-s{margin-top:6px;color:#8aa196;font-size:13px}
</style>
<div id="xdg"><b>Step 1: join both channels</b>${buttons}<div id="xdg-s"></div></div>
<script>(function(){
var box=document.getElementById('xdg');if(!box||!document.body)return;
document.body.insertBefore(box,document.body.firstChild);
var st=document.getElementById('xdg-s'),links=box.querySelectorAll('a[data-n]'),mem={};
function get(n){if(mem[n])return true;try{return localStorage.getItem('xdg'+n)==='1'}catch(e){return false}}
function set(n){mem[n]=true;try{localStorage.setItem('xdg'+n,'1')}catch(e){}}
function refresh(){var all=true;
for(var i=0;i<links.length;i++){var n=links[i].getAttribute('data-n'),ok=get(n);links[i].className='xdg-b'+(ok?' ok':'');links[i].querySelector('em').textContent=ok?' \\u2713':'';if(!ok)all=false}
if(all)document.cookie='xd_gate=1; Path=/; Max-Age=31536000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');
st.textContent=all?'\\u2705 Done. You can now get your pairing code.':'Tap both buttons, join each channel, then come back here.'}
for(var i=0;i<links.length;i++)links[i].addEventListener('click',function(){set(this.getAttribute('data-n'));setTimeout(refresh,300)});
refresh()})();</script>`;
}

/** puts the two join buttons on the pairing page and the dashboard, and refuses pairing until both were tapped */
function installWeb(server) {
  const originals = server.listeners('request');
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    try {
      if (gateOn()) {
        const url = String(req.url || '').split('?')[0];
        if (req.method === 'POST' && (url === '/api/pair' || url === '/api/me/pair') && !COOKIE_OK.test(req.headers.cookie || '')) {
          req.resume();
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          return void res.end(JSON.stringify({ error: 'Join both channels first: tap the two green buttons at the top of the page, join each channel, then try again.' }));
        }
        if (req.method === 'GET' && (url === '/' || url === '/dashboard')) {
          const end = res.end;
          res.end = function (chunk, ...rest) {
            if (typeof chunk === 'string') {
              const i = chunk.lastIndexOf('</body>');
              if (i >= 0) chunk = chunk.slice(0, i) + widget() + chunk.slice(i);
            }
            return end.call(this, chunk, ...rest);
          };
        }
      }
    } catch (e) { console.error('[gate] web:', e.message); }
    for (const l of originals) l.call(server, req, res);
  });
}

const summary = () => {
  const chs = channels();
  return `channels: ${chs.length}/2 set, gate ${gateOn() ? 'ON' : 'off'}, footer ${footerText() ? 'ON' : 'off'}`;
};

module.exports = { register, wrapCommands, installWeb, footerText, channels, gateOn, check, summary };
