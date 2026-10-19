'use strict';
/**
 * HANS-XD xd4.js - economy and games
 *   Money  : .balance  .daily  .work  .deposit  .withdraw  .give  .richest
 *   Gamble : .slots <bet>  .betflip <bet> heads|tails  .dicebet <bet>
 *   Shop   : .shop  .buy <item>  .inventory
 *   Games  : .scramble  .mathquiz  .flagquiz   (just type the answer in the chat, no command needed)
 * Coins are saved per bot owner in sock.hm.db.eco (each person's bot has its own little economy).
 */
const { hmOf, num, jidOf, pick, rnd, targets, fmtMoney } = require('./xdutil');

const DAY = 86400000;
const COIN = '🪙';
const MAX_BET = 100000;
const money = (n) => `${COIN} ${fmtMoney(n)}`;

const eco = (sock) => (hmOf(sock).db.eco ||= { users: {} });
const user = (sock, id) => {
  const u = (eco(sock).users[id] ||= { wallet: 100, bank: 0, lastDaily: 0, streak: 0, lastWork: 0, buffs: {}, items: {}, won: 0, lost: 0 });
  u.buffs ||= {}; u.items ||= {};
  return u;
};
const saveEco = (sock) => hmOf(sock).save?.();
const luck = (u) => (u.buffs.luck && u.buffs.luck > Date.now() ? 0.06 : 0); // lucky charm
const fmtLeft = (ms) => { const m = Math.ceil(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

const SHOP = {
  charm: { name: '🍀 Lucky Charm', price: 800, desc: '+6% win chance in .slots, .betflip and .dicebet for 24 hours', use: (u) => { u.buffs.luck = Date.now() + DAY; } },
  double: { name: '💎 Double Daily', price: 500, desc: 'Your next .daily pays double', passive: true },
  vip: { name: '👑 VIP Badge', price: 5000, desc: 'A crown next to your name on .balance and .richest', passive: true },
};

function bet(ctx, u) {
  const a = (ctx.args[0] || '').toLowerCase();
  const n = a === 'all' ? Math.min(u.wallet, MAX_BET) : a === 'half' ? Math.floor(u.wallet / 2) : Math.floor(Number(a.replace(/[,k]/g, (c) => (c === 'k' ? '000' : ''))));
  if (!(n >= 10)) throw new Error(`Bet at least ${money(10)}.\nExample: ${ctx.prefix}${ctx.cmdName || 'slots'} 100   (or "all" / "half")`);
  if (n > MAX_BET) throw new Error(`The most you can bet is ${money(MAX_BET)}.`);
  if (n > u.wallet) throw new Error(`You only have ${money(u.wallet)} in your wallet.`);
  return n;
}

/* ---------------- quiz games ---------------- */
const WORDS = ['welding', 'machine', 'fabrication', 'electrode', 'workshop', 'engineer', 'hammer', 'whatsapp', 'network', 'keyboard', 'internet', 'database', 'battery', 'library', 'diamond', 'elephant', 'football', 'jollof', 'market', 'student', 'teacher', 'lecture', 'campus', 'project', 'science', 'pencil', 'window', 'garden', 'rainbow', 'thunder', 'mountain', 'island', 'captain', 'monkey', 'planet', 'rocket', 'castle', 'bridge', 'engine', 'wheel', 'copper', 'silver', 'golden', 'orange', 'banana', 'coconut', 'pepper', 'tomato', 'kitchen', 'doctor', 'nurse', 'driver'];
const FLAGS = [['🇬🇭', 'ghana'], ['🇳🇬', 'nigeria'], ['🇨🇮', 'ivory coast'], ['🇹🇬', 'togo'], ['🇧🇫', 'burkina faso'], ['🇿🇦', 'south africa'], ['🇰🇪', 'kenya'], ['🇪🇬', 'egypt'], ['🇲🇦', 'morocco'], ['🇸🇳', 'senegal'], ['🇨🇲', 'cameroon'], ['🇺🇬', 'uganda'], ['🇹🇿', 'tanzania'], ['🇪🇹', 'ethiopia'], ['🇧🇷', 'brazil'], ['🇦🇷', 'argentina'], ['🇫🇷', 'france'], ['🇩🇪', 'germany'], ['🇬🇧', 'united kingdom'], ['🇺🇸', 'united states'], ['🇨🇦', 'canada'], ['🇮🇳', 'india'], ['🇨🇳', 'china'], ['🇯🇵', 'japan'], ['🇰🇷', 'south korea'], ['🇮🇹', 'italy'], ['🇪🇸', 'spain'], ['🇵🇹', 'portugal'], ['🇳🇱', 'netherlands'], ['🇹🇷', 'turkey'], ['🇦🇺', 'australia'], ['🇲🇽', 'mexico']];
const shuffle = (w) => { for (let i = 0; i < 10; i++) { const s = [...w].sort(() => Math.random() - 0.5).join(''); if (s !== w) return s; } return w.split('').reverse().join(''); };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const games = (sock) => (hmOf(sock).xdGames ||= new Map()); // chat -> running game (kept in memory only)

function startGame(ctx, g) {
  const m = games(ctx.sock);
  if (m.has(ctx.jid) && m.get(ctx.jid).exp > Date.now()) throw new Error('A game is already running here. Answer it first!');
  m.set(ctx.jid, { ...g, exp: Date.now() + (g.secs || 45) * 1000 });
  setTimeout(() => {
    const cur = m.get(ctx.jid);
    if (cur && cur.id === g.id) { m.delete(ctx.jid); ctx.sock.sendMessage(ctx.jid, { text: `⏰ Time is up! The answer was *${g.show || g.answer}*.` }).catch(() => {}); }
  }, (g.secs || 45) * 1000 + 500).unref?.();
}

const unwrap = (m) => {
  let x = m || {};
  for (let i = 0; i < 4; i++) x = x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.viewOnceMessageV2?.message || x.documentWithCaptionMessage?.message || x;
  return x;
};
const textOf = (c) => c.conversation || c.extendedTextMessage?.text || '';

/** plain chat messages are checked against the running game of that chat */
async function passive(sock, m) {
  try {
    const jid = m?.key?.remoteJid;
    if (!jid || m.key.fromMe || !m.message || jid === 'status@broadcast') return;
    const g = games(sock).get(jid);
    if (!g || g.exp < Date.now()) return;
    const text = norm(textOf(unwrap(m.message)));
    if (!text || text !== norm(g.answer)) return;
    games(sock).delete(jid);
    const who = num(m.key.participantAlt || m.key.participant || jid);
    const u = user(sock, who);
    u.wallet += g.reward; saveEco(sock);
    await sock.sendMessage(jid, { text: `🎉 @${who} got it! The answer was *${g.show || g.answer}*.\n+${money(g.reward)}`, mentions: [jidOf(who)] }, { quoted: m });
  } catch (e) { console.error('[xd4] passive:', e.message); }
}

function register(add) {
  /* ----- money ----- */
  add('balance', 'Economy', '[@user]', 'See your wallet and bank', (ctx) => {
    const who = num(targets(ctx)[0] || ctx.sender);
    const u = user(ctx.sock, who);
    return ctx.sock.sendMessage(ctx.jid, {
      text: `💰 *Balance*${u.items.vip ? ' 👑' : ''}\n@${who}\n\n👛 Wallet: *${money(u.wallet)}*\n🏦 Bank: *${money(u.bank)}*\n📈 Net worth: *${money(u.wallet + u.bank)}*\n🎲 Won ${money(u.won)} · lost ${money(u.lost)}`,
      mentions: [jidOf(who)],
    }, { quoted: ctx.msg });
  }, { aliases: ['bal', 'wallet', 'coins'] });

  add('daily', 'Economy', '', 'Collect your daily coins (streaks pay more)', (ctx) => {
    const u = user(ctx.sock, num(ctx.sender));
    const wait = DAY - (Date.now() - u.lastDaily);
    if (wait > 0) return `⏳ Come back in *${fmtLeft(wait)}* for your next daily.`;
    u.streak = Date.now() - u.lastDaily < 2 * DAY ? u.streak + 1 : 1;
    let pay = 200 + Math.min(u.streak, 30) * 25 + rnd(0, 100);
    let extra = '';
    if (u.items.double > 0) { u.items.double--; if (!u.items.double) delete u.items.double; pay *= 2; extra = '\n💎 Double Daily used!'; }
    u.wallet += pay; u.lastDaily = Date.now(); saveEco(ctx.sock);
    return `🎁 *Daily reward*\n+${money(pay)}${extra}\n🔥 Streak: ${u.streak} day${u.streak === 1 ? '' : 's'}`;
  }, { aliases: ['claimdaily'] });

  add('work', 'Economy', '', 'Do a job and earn coins (every 30 minutes)', (ctx) => {
    const u = user(ctx.sock, num(ctx.sender));
    const wait = 30 * 60000 - (Date.now() - u.lastWork);
    if (wait > 0) return `😮‍💨 You are tired. Rest for *${fmtLeft(wait)}*.`;
    const jobs = ['fixed a neighbour\'s phone', 'welded a gate', 'sold pure water at the station', 'tutored a student', 'drove a trotro', 'designed a flyer', 'repaired a generator', 'cooked for a wedding', 'cleaned a shop', 'delivered packages', 'edited a video', 'built a small website'];
    const pay = rnd(60, 220);
    u.wallet += pay; u.lastWork = Date.now(); saveEco(ctx.sock);
    return `🛠️ You ${pick(jobs)} and earned *${money(pay)}*.`;
  }, { aliases: ['job', 'earn'] });

  add('deposit', 'Economy', '<amount|all>', 'Move coins into your bank (safe from gambling)', (ctx) => {
    const u = user(ctx.sock, num(ctx.sender));
    const a = (ctx.args[0] || '').toLowerCase();
    const n = a === 'all' ? u.wallet : Math.floor(Number(a));
    if (!(n > 0) || n > u.wallet) throw new Error(`Say how much (you have ${money(u.wallet)}).\nExample: ${ctx.prefix}deposit 500  or  ${ctx.prefix}deposit all`);
    u.wallet -= n; u.bank += n; saveEco(ctx.sock);
    return `🏦 Deposited *${money(n)}*. Bank: ${money(u.bank)}`;
  }, { aliases: ['dep'] });

  add('withdraw', 'Economy', '<amount|all>', 'Take coins out of your bank', (ctx) => {
    const u = user(ctx.sock, num(ctx.sender));
    const a = (ctx.args[0] || '').toLowerCase();
    const n = a === 'all' ? u.bank : Math.floor(Number(a));
    if (!(n > 0) || n > u.bank) throw new Error(`Say how much (bank: ${money(u.bank)}).\nExample: ${ctx.prefix}withdraw 500`);
    u.bank -= n; u.wallet += n; saveEco(ctx.sock);
    return `👛 Withdrew *${money(n)}*. Wallet: ${money(u.wallet)}`;
  }, { aliases: ['wd'] });

  add('give', 'Economy', '@user <amount>', 'Send coins to someone', (ctx) => {
    const to = num(targets(ctx)[0] || '');
    const n = Math.floor(Number(ctx.args.find((a) => /^\d{1,9}$/.test(a) && a.length < 8) || ctx.args[ctx.args.length - 1]));
    if (!to || !(n > 0)) throw new Error(`Mention the person and the amount.\nExample: ${ctx.prefix}give @user 200`);
    const me = num(ctx.sender);
    if (to === me) throw new Error('You cannot send coins to yourself.');
    const a = user(ctx.sock, me);
    if (n > a.wallet) throw new Error(`You only have ${money(a.wallet)} in your wallet.`);
    a.wallet -= n; user(ctx.sock, to).wallet += n; saveEco(ctx.sock);
    return ctx.sock.sendMessage(ctx.jid, { text: `💸 @${me} sent *${money(n)}* to @${to}`, mentions: [jidOf(me), jidOf(to)] }, { quoted: ctx.msg });
  }, { aliases: ['pay', 'send', 'transfer'] });

  add('richest', 'Economy', '', 'The richest people on this bot', (ctx) => {
    const top = Object.entries(eco(ctx.sock).users).map(([id, u]) => [id, u.wallet + u.bank, u.items.vip]).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!top.length) return 'Nobody has coins yet. Try .daily';
    return ctx.sock.sendMessage(ctx.jid, {
      text: '🏆 *Richest*\n\n' + top.map(([id, w, vip], i) => `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} @${id}${vip ? ' 👑' : ''}  ·  ${money(w)}`).join('\n'),
      mentions: top.map(([id]) => jidOf(id)),
    }, { quoted: ctx.msg });
  }, { aliases: ['rich', 'ecotop'] });

  /* ----- gambling ----- */
  add('slots', 'Economy', '<bet>', 'Spin the slot machine', (ctx) => {
    ctx.cmdName = 'slots';
    const u = user(ctx.sock, num(ctx.sender));
    const n = bet(ctx, u);
    const sym = ['🍒', '🍋', '🍇', '🔔', '⭐', '💎', '7️⃣'];
    const lucky = luck(u) > 0 && Math.random() < 0.12;
    const r = lucky ? (() => { const s = pick(sym); return [s, s, pick(sym)]; })() : [pick(sym), pick(sym), pick(sym)];
    let mult = 0;
    if (r[0] === r[1] && r[1] === r[2]) mult = r[0] === '7️⃣' ? 10 : r[0] === '💎' ? 6 : 4;
    else if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) mult = 1.5;
    const win = Math.floor(n * mult);
    u.wallet += win - n; if (win > n) u.won += win - n; else u.lost += n - win; saveEco(ctx.sock);
    return `🎰 | ${r.join(' | ')} |\n\n` + (mult >= 4 ? `🎉 JACKPOT! *+${money(win - n)}*` : mult ? `✅ You win *+${money(win - n)}*` : `❌ You lost *${money(n)}*`) + `\n👛 Wallet: ${money(u.wallet)}`;
  }, { aliases: ['slot', 'spin'] });

  add('betflip', 'Economy', '<bet> heads|tails', 'Flip a coin and double your bet', (ctx) => {
    ctx.cmdName = 'betflip';
    const u = user(ctx.sock, num(ctx.sender));
    const side = ctx.args.map((a) => a.toLowerCase()).find((a) => ['heads', 'tails', 'h', 't'].includes(a));
    if (!side) throw new Error(`Pick a side.\nExample: ${ctx.prefix}betflip 100 heads`);
    const n = bet(ctx, u);
    const pickHeads = side[0] === 'h';
    const win = Math.random() < 0.5 + luck(u);
    const landed = win ? pickHeads : !pickHeads;
    u.wallet += win ? n : -n; if (win) u.won += n; else u.lost += n; saveEco(ctx.sock);
    return `🪙 It landed on *${landed ? 'HEADS' : 'TAILS'}*\n` + (win ? `✅ You win *+${money(n)}*` : `❌ You lost *${money(n)}*`) + `\n👛 Wallet: ${money(u.wallet)}`;
  }, { aliases: ['cf', 'flipbet', 'headsortails'] });

  add('dicebet', 'Economy', '<bet>', 'Roll against the bot: higher roll wins', (ctx) => {
    ctx.cmdName = 'dicebet';
    const u = user(ctx.sock, num(ctx.sender));
    const n = bet(ctx, u);
    let me = rnd(1, 6), bot = rnd(1, 6);
    if (luck(u) > 0 && me <= bot && Math.random() < 0.3) me = Math.min(6, bot + 1);
    const res = me > bot ? 1 : me < bot ? -1 : 0;
    u.wallet += res * n; if (res > 0) u.won += n; if (res < 0) u.lost += n; saveEco(ctx.sock);
    return `🎲 You rolled *${me}*, the bot rolled *${bot}*\n` + (res > 0 ? `✅ You win *+${money(n)}*` : res < 0 ? `❌ You lost *${money(n)}*` : '🤝 A draw. Your bet is back.') + `\n👛 Wallet: ${money(u.wallet)}`;
  }, { aliases: ['rolldice', 'diceduel'] });

  /* ----- shop ----- */
  add('shop', 'Economy', '', 'See what you can buy', (ctx) => `🛒 *Shop*\n\n` + Object.entries(SHOP).map(([k, s]) => `${s.name}  ·  ${money(s.price)}\n   ${s.desc}\n   Buy: ${ctx.prefix}buy ${k}`).join('\n\n'), { aliases: ['store'] });

  add('buy', 'Economy', '<item>', 'Buy something from the shop', (ctx) => {
    const key = (ctx.args[0] || '').toLowerCase();
    const it = SHOP[key];
    if (!it) throw new Error(`Say what to buy: ${Object.keys(SHOP).join(', ')}\nSee prices with ${ctx.prefix}shop`);
    const u = user(ctx.sock, num(ctx.sender));
    if (key === 'vip' && u.items.vip) throw new Error('You already have the VIP badge.');
    if (u.wallet < it.price) throw new Error(`You need ${money(it.price)} (wallet: ${money(u.wallet)}).`);
    u.wallet -= it.price;
    if (it.use) it.use(u); else u.items[key] = (u.items[key] || 0) + 1;
    saveEco(ctx.sock);
    return `✅ Bought *${it.name}* for ${money(it.price)}.` + (key === 'charm' ? '\n🍀 Your luck boost is active for 24 hours!' : '');
  }, { aliases: ['purchase'] });

  add('inventory', 'Economy', '', 'See what you own', (ctx) => {
    const u = user(ctx.sock, num(ctx.sender));
    const rows = Object.entries(u.items).map(([k, n]) => `${SHOP[k] ? SHOP[k].name : k} × ${n}`);
    if (u.buffs.luck > Date.now()) rows.push(`🍀 Lucky Charm active for ${fmtLeft(u.buffs.luck - Date.now())}`);
    return rows.length ? '🎒 *Your items*\n\n' + rows.join('\n') : `🎒 You own nothing yet. See ${ctx.prefix}shop`;
  }, { aliases: ['inv', 'items'] });

  /* ----- chat games (answer by typing) ----- */
  add('scramble', 'Games', '', 'Unscramble the word (type the answer, 45 seconds)', (ctx) => {
    const w = pick(WORDS);
    startGame(ctx, { id: Date.now(), answer: w, reward: rnd(80, 160), secs: 45 });
    return `🔤 *Word scramble*\nUnscramble this word:\n\n*${shuffle(w).toUpperCase()}*\n\nJust type the answer in the chat. ⏱ 45 seconds`;
  }, { aliases: ['unscramble'] });

  add('mathquiz', 'Games', '[easy|hard]', 'Solve a quick sum (type the answer, 30 seconds)', (ctx) => {
    const hard = (ctx.args[0] || '').toLowerCase() === 'hard';
    const a = rnd(hard ? 12 : 2, hard ? 60 : 20), b = rnd(hard ? 12 : 2, hard ? 40 : 12);
    const op = pick(hard ? ['+', '-', '×'] : ['+', '-']);
    const ans = op === '+' ? a + b : op === '-' ? a - b : a * b;
    startGame(ctx, { id: Date.now(), answer: String(ans), reward: hard ? rnd(150, 260) : rnd(60, 120), secs: 30 });
    return `🧮 *Math quiz*${hard ? ' (hard)' : ''}\n\n*${a} ${op} ${b} = ?*\n\nType the answer in the chat. ⏱ 30 seconds`;
  }, { aliases: ['sumquiz', 'quickmath'] });

  add('flagquiz', 'Games', '', 'Name the country from its flag (type the answer, 30 seconds)', (ctx) => {
    const [flag, country] = pick(FLAGS);
    startGame(ctx, { id: Date.now(), answer: country, show: country, reward: rnd(80, 150), secs: 30 });
    return `🏳️ *Flag quiz*\nWhich country is this?\n\n${flag}\n\nType the country name in the chat. ⏱ 30 seconds`;
  }, { aliases: ['flag', 'guessflag'] });
}

module.exports = { register, passive };
