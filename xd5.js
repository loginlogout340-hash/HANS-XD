'use strict';
/**
 * HANS-XD xd5.js - accounts, plans, referrals and limits
 *   Everyone : .claim (link this bot to your website account)  .myplan  .refer
 *   Admin bot: .plans  .addplan id | name | price | days   .delplan id   .giftdays <number> <days>
 *              .accounts   .setlimit <number> <count|off>   .limits
 */
// manager.js loads this file (through bot.js), so it is required lazily to avoid a circular import
const manager = new Proxy({}, { get: (_t, k) => require('./manager')[k] });
const codes = require('./codes');
const accounts = require('./accounts');
const usage = require('./usage');
const { num } = require('./xdutil');

const baseUrl = () => (process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '')).replace(/\/+$/, '');
const dt = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const left = (t) => { const d = Math.ceil((t - Date.now()) / 86400000); return d <= 0 ? 'ended' : d === 1 ? '1 day left' : d + ' days left'; };

function adminOnly(ctx) {
  if (!process.env.ADMIN_NUMBER) throw new Error('Admin tools are off. Add the Railway variable ADMIN_NUMBER.');
  if (!ctx.isMainOwner || !manager.isAdmin(ctx.config.owners[0])) throw new Error('This command only works on the admin bot.');
}

function register(add) {
  /* ----- for every user ----- */
  add('claim', 'Account', '', 'Get a 6-digit code to link this bot to your website account', (ctx) => {
    if (!ctx.isMainOwner) throw new Error('Only the owner of this bot can do this.');
    const code = accounts.makeClaim(ctx.config.owners[0]);
    const url = baseUrl();
    return `🪪 *Link to your account*\nYour code: *${code}* (valid 10 minutes)\n\n1. Open ${url ? url + '/dashboard' : 'the website dashboard'}\n2. Log in (or sign up)\n3. Type this code under "Already linked before?"\n\nNever share this code with anyone.`;
  }, { aliases: ['linkaccount'] });

  add('myplan', 'Account', '', 'See your plan, days left and today\'s usage', (ctx) => {
    const n = ctx.config.owners[0];
    if (manager.isAdmin(n)) return '👑 You are the admin. No plan, no limits.';
    const rec = codes.byNumber(n);
    const lim = usage.limitOf(n);
    const lines = ['🪪 *Your plan*'];
    if (rec) lines.push(`Type: ${rec.source === 'trial' ? 'free trial' : rec.source === 'paystack' ? 'paid' : rec.source}`, `Status: ${rec.active ? '✅ active' : '⛔ ended'}`, `${rec.active ? 'Ends' : 'Ended'}: ${dt(rec.expiresAt)}${rec.active ? ' (' + left(rec.expiresAt) + ')' : ''}`);
    else lines.push('Plan: unlimited (linked with the owner access code)');
    lines.push(lim ? `Today: ${usage.usedToday(n)}/${lim} commands` : 'Daily limit: none');
    const url = baseUrl();
    if (url) lines.push(`\nManage or renew: ${url}/dashboard`);
    return lines.join('\n');
  }, { aliases: ['plan', 'subscription', 'expiry'] });

  add('refer', 'Account', '', 'Your invite code: earn bonus days when friends pay', (ctx) => {
    const u = accounts.owner(ctx.config.owners[0]);
    const url = baseUrl();
    if (!u) return `🎁 Invite friends and earn bonus days.\nFirst link this bot to a website account: send ${ctx.prefix}claim and follow the steps${url ? ' at ' + url + '/dashboard' : ''}.`;
    return `🎁 *Invite friends*\nYour code: *${u.refCode}*\n${url ? 'Your link: ' + url + '/signup?ref=' + u.refCode + '\n' : ''}\n👥 Friends who paid: ${u.refCount}\n🎉 Bonus days earned: ${u.bonusEarned}\nYou get bonus days each time a friend pays for the first time.`;
  }, { owner: true, aliases: ['referral', 'invitecode'] });

  /* ----- admin bot only ----- */
  add('plans', 'Admin', '', 'List the plans', (ctx) => {
    adminOnly(ctx);
    return '💳 *Plans*\n\n' + codes.plans().map((p, i) => `${i === 0 ? '⭐' : '•'} *${p.id}*  ·  ${p.name}  ·  GH₵${p.price}  ·  ${p.days} days`).join('\n') + `\n\nAdd or change: ${ctx.prefix}addplan id | name | price | days\nRemove: ${ctx.prefix}delplan id`;
  });

  add('addplan', 'Admin', 'id | name | price | days', 'Add or change a plan', (ctx) => {
    adminOnly(ctx);
    const [id, name, price, days] = ctx.text.split('|').map((x) => x.trim());
    if (!id || !price || !days) throw new Error(`Usage: ${ctx.prefix}addplan vip | VIP year | 150 | 365`);
    codes.savePlan({ id, name, price, days });
    return `✅ Plan *${id}* saved.\n` + codes.plans().map((p) => `• ${p.id}: GH₵${p.price} / ${p.days} days`).join('\n');
  });

  add('delplan', 'Admin', 'id', 'Remove a plan', (ctx) => {
    adminOnly(ctx);
    if (!ctx.args[0]) throw new Error(`Usage: ${ctx.prefix}delplan weekly`);
    codes.removePlan(ctx.args[0].toLowerCase());
    return '🗑️ Removed. Plans now: ' + codes.plans().map((p) => p.id).join(', ');
  });

  add('giftdays', 'Admin', '<number> <days>', 'Give a user extra days for free', async (ctx) => {
    adminOnly(ctx);
    const n = num(ctx.args[0] || ''); const d = Math.floor(Number(ctx.args[1]));
    if (n.length < 8 || !(d >= 1 && d <= 366)) throw new Error(`Usage: ${ctx.prefix}giftdays 233241234567 30`);
    const r = codes.issue({ number: n, days: d, source: 'gift' });
    manager.sendFromAdmin(n, `🎁 You received *${d} free days* on ${process.env.BOT_NAME || 'HANS-XD'}! Your plan now ends on ${dt(r.expiresAt)}.`);
    return `✅ Gave +${n} ${d} days. Ends ${dt(r.expiresAt)}.`;
  });

  add('accounts', 'Admin', '', 'How many website accounts exist and the newest ones', (ctx) => {
    adminOnly(ctx);
    const l = accounts.list();
    return `🪪 *Accounts: ${l.length}*\n\n` + (l.slice(0, 10).map((a) => `• ${a.name} · ${a.email}${a.number ? ' · +' + a.number : ''}`).join('\n') || 'None yet.');
  });

  add('setlimit', 'Admin', '<number> <count|off>', 'Set a daily command limit for one number', (ctx) => {
    adminOnly(ctx);
    const n = num(ctx.args[0] || ''); const v = (ctx.args[1] || '').toLowerCase();
    if (n.length < 8 || !v) throw new Error(`Usage: ${ctx.prefix}setlimit 233241234567 100   (or "off" to remove)`);
    if (v === 'off') { usage.setCustom(n, null); return `✅ Custom limit removed for +${n}.`; }
    const c = Math.floor(Number(v));
    if (!(c >= 1 && c <= 100000)) throw new Error('Give a number from 1 to 100000, or "off".');
    usage.setCustom(n, c);
    return `✅ +${n} can run ${c} commands a day.`;
  });

  add('limits', 'Admin', '', 'See the custom daily limits', (ctx) => {
    adminOnly(ctx);
    const l = usage.customList();
    return '⏱️ *Custom limits*\n\n' + (l.map((x) => `• +${x.number}: ${x.limit}/day`).join('\n') || 'None.') + `\n\nTrial plans: ${process.env.TRIAL_DAILY_LIMIT || 150}/day`;
  });
}

module.exports = { register };
