'use strict';
/**
 * HANS-XD xd3.js - group tools and leveling
 *   Leveling : .rank [@user]  .leaderboard  .levelup on|off  .xpreset   (members earn XP by chatting)
 *   Groups   : .lock  .unlock  .lockinfo  .unlockinfo  .rules  .setrules <text>  .tagadmins  .topactive  .inactive
 * XP is saved per group in sock.hm.db.xp. Level-up messages are OFF until a group admin turns them on.
 */
const { hmOf, num, jidOf, targets } = require('./xdutil');

const XP_GAP_MS = 30000;          // a member earns XP at most once every 30 seconds
const KEEP_PER_GROUP = 500;       // members remembered per group (the quietest are dropped)
const LEVEL_DIV = 60;             // level = floor(sqrt(xp / 60)) + 1
const levelOf = (xp) => Math.floor(Math.sqrt(xp / LEVEL_DIV)) + 1;
const xpFor = (level) => (level - 1) * (level - 1) * LEVEL_DIV;
const last = new Map();           // group:user -> time of the last XP

const store = (sock) => {
  const db = hmOf(sock).db;
  return (db.xp ||= { groups: {} });
};
const group = (sock, jid) => (store(sock).groups[jid] ||= { on: false, users: {}, rules: '' });
const unwrap = (m) => {
  let x = m || {};
  for (let i = 0; i < 4; i++) x = x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.viewOnceMessageV2?.message || x.documentWithCaptionMessage?.message || x;
  return x;
};
const textOf = (c) => c.conversation || c.extendedTextMessage?.text || c.imageMessage?.caption || c.videoMessage?.caption || '';
const bar = (p) => { const n = Math.max(0, Math.min(10, Math.round(p * 10))); return '▰'.repeat(n) + '▱'.repeat(10 - n); };
const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
const tag = (n) => '@' + n;

/** called for every message (more.js passive) */
async function passive(sock, m) {
  try {
    const jid = m?.key?.remoteJid;
    if (!jid || !jid.endsWith('@g.us') || m.key.fromMe || !m.message) return;
    const c = unwrap(m.message);
    if (c.protocolMessage || c.reactionMessage || c.senderKeyDistributionMessage) return;
    const body = textOf(c).trim();
    const who = num(m.key.participantAlt || m.key.participant || m.participant || '');
    if (!who) return;
    const g = group(sock, jid);
    const u = (g.users[who] ||= { xp: 0, msgs: 0, last: 0 });
    u.msgs++; u.last = Date.now();
    const k = jid + ':' + who;
    if (body && !/^[.!#\/$~,]\S/.test(body) && Date.now() - (last.get(k) || 0) >= XP_GAP_MS) {
      last.set(k, Date.now());
      if (last.size > 5000) last.delete(last.keys().next().value);
      const before = levelOf(u.xp);
      u.xp += 5 + Math.min(10, Math.floor(body.length / 40)) + Math.floor(Math.random() * 4);
      const after = levelOf(u.xp);
      if (after > before && g.on) {
        await sock.sendMessage(jid, { text: `🎉 ${tag(who)} reached *level ${after}*!`, mentions: [jidOf(who)] }, { quoted: m }).catch(() => {});
      }
    }
    const ids = Object.keys(g.users);
    if (ids.length > KEEP_PER_GROUP) {
      const drop = ids.sort((a, b) => g.users[a].xp - g.users[b].xp).slice(0, ids.length - KEEP_PER_GROUP);
      for (const d of drop) delete g.users[d];
    }
    hmOf(sock).save?.();
  } catch (e) { console.error('[xd3] passive:', e.message); }
}

function register(add) {
  /* ----- leveling ----- */
  add('rank', 'Group', '[@user]', 'Your level and XP in this group', (ctx) => {
    const g = group(ctx.sock, ctx.jid);
    const who = num(targets(ctx)[0] || ctx.sender);
    const u = g.users[who];
    if (!u) return `📊 ${tag(who)} has no XP yet. Chat in the group to earn some!`;
    const lvl = levelOf(u.xp), from = xpFor(lvl), to = xpFor(lvl + 1);
    const ranked = Object.entries(g.users).sort((a, b) => b[1].xp - a[1].xp).map(([k]) => k);
    return ctx.sock.sendMessage(ctx.jid, {
      text: `📊 *Rank card*\n${tag(who)}\n🏅 Rank: *#${ranked.indexOf(who) + 1}* of ${ranked.length}\n⭐ Level: *${lvl}*\n✨ XP: *${u.xp}*  (${to - u.xp} to level ${lvl + 1})\n${bar((u.xp - from) / (to - from))}\n💬 Messages: ${u.msgs}`,
      mentions: [jidOf(who)],
    }, { quoted: ctx.msg });
  }, { group: true, aliases: ['level', 'xp', 'mylevel'] });

  add('leaderboard', 'Group', '', 'Top 10 chatters in this group', (ctx) => {
    const g = group(ctx.sock, ctx.jid);
    const top = Object.entries(g.users).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
    if (!top.length) return '📊 Nobody has XP yet. Chat in the group to earn some!';
    return ctx.sock.sendMessage(ctx.jid, {
      text: '🏆 *Group leaderboard*\n\n' + top.map(([n, u], i) => `${medal(i)} ${tag(n)}  ·  level ${levelOf(u.xp)}  ·  ${u.xp} XP`).join('\n'),
      mentions: top.map(([n]) => jidOf(n)),
    }, { quoted: ctx.msg });
  }, { group: true, aliases: ['lb', 'top', 'toplevel'] });

  add('levelup', 'Group', 'on|off', 'Announce level-ups in this group', (ctx) => {
    const g = group(ctx.sock, ctx.jid);
    const v = (ctx.args[0] || '').toLowerCase();
    if (v !== 'on' && v !== 'off') return `🎉 Level-up messages are *${g.on ? 'ON' : 'OFF'}*.\nChange: ${ctx.prefix}levelup on|off`;
    g.on = v === 'on'; hmOf(ctx.sock).save?.();
    return `🎉 Level-up messages are now *${v.toUpperCase()}*.`;
  }, { group: true, admin: true, aliases: ['levelmsg'] });

  add('xpreset', 'Group', '', 'Reset everybody\'s XP in this group', (ctx) => {
    const g = group(ctx.sock, ctx.jid);
    g.users = {}; hmOf(ctx.sock).save?.();
    return '🧹 XP reset for this group.';
  }, { group: true, admin: true });

  add('topactive', 'Group', '', 'Members who sent the most messages (since the bot joined)', (ctx) => {
    const g = group(ctx.sock, ctx.jid);
    const top = Object.entries(g.users).sort((a, b) => b[1].msgs - a[1].msgs).slice(0, 10);
    if (!top.length) return '📊 No messages counted yet.';
    return ctx.sock.sendMessage(ctx.jid, {
      text: '💬 *Most active*\n\n' + top.map(([n, u], i) => `${medal(i)} ${tag(n)}  ·  ${u.msgs} messages`).join('\n'),
      mentions: top.map(([n]) => jidOf(n)),
    }, { quoted: ctx.msg });
  }, { group: true, aliases: ['active', 'mostactive'] });

  add('inactive', 'Group', '[days]', 'Members who have not chatted for a while (default 7 days)', async (ctx) => {
    const days = Math.max(1, Math.min(90, parseInt(ctx.args[0], 10) || 7));
    const g = group(ctx.sock, ctx.jid);
    const meta = await ctx.getGroup();
    const cut = Date.now() - days * 86400000;
    const quiet = meta.participants.map((p) => num(p.phoneNumber || p.id)).filter((n) => !(g.users[n] && g.users[n].last > cut)).slice(0, 40);
    if (!quiet.length) return `✅ Everyone chatted in the last ${days} day(s).`;
    return ctx.sock.sendMessage(ctx.jid, {
      text: `😴 *Quiet for ${days}+ days* (counted since the bot started watching)\n\n` + quiet.map((n) => tag(n)).join(' '),
      mentions: quiet.map(jidOf),
    }, { quoted: ctx.msg });
  }, { group: true, admin: true, aliases: ['quiet', 'ghosts'] });

  /* ----- lock / unlock ----- */
  add('lock', 'Group', '', 'Only admins can send messages', async (ctx) => {
    await ctx.sock.groupSettingUpdate(ctx.jid, 'announcement');
    return '🔒 Group locked: only admins can send messages.';
  }, { group: true, admin: true, botAdmin: true, aliases: ['adminonly', 'lockchat'] });

  add('unlock', 'Group', '', 'Everybody can send messages again', async (ctx) => {
    await ctx.sock.groupSettingUpdate(ctx.jid, 'not_announcement');
    return '🔓 Group unlocked: everybody can send messages.';
  }, { group: true, admin: true, botAdmin: true, aliases: ['unlockchat', 'allowall'] });

  add('lockinfo', 'Group', '', 'Only admins can edit the group name, picture and description', async (ctx) => {
    await ctx.sock.groupSettingUpdate(ctx.jid, 'locked');
    return '🔒 Only admins can edit the group info now.';
  }, { group: true, admin: true, botAdmin: true });

  add('unlockinfo', 'Group', '', 'Everybody can edit the group info', async (ctx) => {
    await ctx.sock.groupSettingUpdate(ctx.jid, 'unlocked');
    return '🔓 Everybody can edit the group info now.';
  }, { group: true, admin: true, botAdmin: true });

  /* ----- rules ----- */
  add('setrules', 'Group', '<text>', 'Write the group rules (shown with .rules)', (ctx) => {
    const t = (ctx.text || (ctx.quoted && ctx.quoted.text) || '').trim().slice(0, 1500);
    if (!t) throw new Error(`Write the rules after the command, or reply to a message.\nExample: ${ctx.prefix}setrules 1. Be respectful\\n2. No spam`);
    group(ctx.sock, ctx.jid).rules = t; hmOf(ctx.sock).save?.();
    return `📜 Rules saved. Members can read them with ${ctx.prefix}rules`;
  }, { group: true, admin: true });

  add('rules', 'Group', '', 'Show the group rules', (ctx) => {
    const r = group(ctx.sock, ctx.jid).rules;
    return r ? `📜 *Group rules*\n\n${r}` : `📜 No rules yet. An admin can add them with ${ctx.prefix}setrules <text>`;
  }, { group: true });

  add('tagadmins', 'Group', '[message]', 'Mention all the admins', async (ctx) => {
    const meta = await ctx.getGroup();
    const admins = meta.participants.filter((p) => p.admin).map((p) => p.phoneNumber || p.id);
    if (!admins.length) return 'No admins found.';
    return ctx.sock.sendMessage(ctx.jid, {
      text: `🛡️ *Admins*${ctx.text ? '\n' + ctx.text : ''}\n\n` + admins.map((a) => tag(num(a))).join(' '),
      mentions: admins,
    }, { quoted: ctx.msg });
  }, { group: true, aliases: ['admins2', 'calladmins'] });
}

module.exports = { register, passive, levelOf };
