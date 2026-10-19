'use strict';
/**
 * HANS-XD xd1.js - more AI
 *   Memory      : .xd (AI that remembers you)  .remember  .memory  .forget  .persona
 *   Voice       : .aivoice <question>  (the AI answers with a voice note)
 *   Pictures    : .anime  .logo  .wallpaper  .portrait  .pixel  .cartoon  (AI pictures in a style)
 *   Writing     : .explain .eli5 .rewrite .grammar .email .caption .idea .poem .story .code .debug .recipe
 *                 .roast .compliment .pickupai .bio .slogan .rhyme .joke2 .lesson
 * Uses the same AI service as .ai (AI_URL / AI_KEY / AI_MODEL, or the free keyless one).
 * Memory is saved per user in sock.hm.db.aiMem (facts) and sock.hm.db.persona.
 */
const { hmOf, ai, ffmpeg, tmp, rm, BOT_NAME } = require('./xdutil');
const fs = require('fs');

const MAX_FACTS = 25;
const histories = new Map(); // chat -> last turns of .xd
const OWNER_NAME = process.env.OWNER_NAME || 'Hanson';

const unwrap = (m) => {
  let x = m || {};
  for (let i = 0; i < 4; i++) x = x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.viewOnceMessageV2?.message || x.documentWithCaptionMessage?.message || x;
  return x;
};
const asked = (ctx) => (ctx.text || '').trim() || (ctx.quoted && ctx.quoted.text) || '';

function systemFor(sock) {
  const db = hmOf(sock).db;
  const facts = (db.aiMem || []).map((f, i) => `${i + 1}. ${f}`).join('\n');
  return `You are ${BOT_NAME}, a smart, friendly WhatsApp assistant made by ${OWNER_NAME}. Reply in the same language as the user. Keep answers clear and short (under 150 words unless asked for more). No markdown headings.` +
    (db.persona ? `\nStyle you must use: ${db.persona}` : '') +
    (facts ? `\nThings the user asked you to remember about them (use them when they help, never list them unprompted):\n${facts}` : '');
}

async function tts(text, lang = 'en') {
  const r = await fetch('https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' + encodeURIComponent(lang) + '&q=' + encodeURIComponent(text), {
    headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('The voice service did not answer (HTTP ' + r.status + ').');
  return Buffer.from(await r.arrayBuffer());
}

/** one-shot writing helpers: name -> [description, system prompt, example] */
const WRITERS = {
  explain: ['Explain something simply', 'Explain the topic clearly in simple words with one small example. Max 120 words.', 'how a diesel engine works'],
  eli5: ['Explain it like I am 5', 'Explain the topic like the reader is five years old. Max 80 words, a fun comparison.', 'what is inflation'],
  rewrite: ['Rewrite a text to sound better', 'Rewrite the text so it is clearer and more natural. Keep the meaning and language. Reply with the rewritten text only.', 'i want to ask for for a leave'],
  grammar: ['Fix spelling and grammar', 'Correct the spelling and grammar of the text. Keep the meaning and language. Reply with the corrected text only.', 'me and him goes to school yesterday'],
  email: ['Write an email', 'Write a short, polite, professional email from the request. Include a subject line. Reply with the email only.', 'ask my lecturer for an extension'],
  caption: ['Write social media captions', 'Write 3 short catchy captions with emojis and hashtags for the described post.', 'my sunset photo at Takoradi beach'],
  idea: ['Get ideas', 'Give 5 short, practical, creative ideas for the request. One line each.', 'a project for welding students'],
  poem: ['Write a short poem', 'Write a short poem (8 lines max) about the topic. Reply with the poem only.', 'friendship'],
  story: ['Write a very short story', 'Write a short, vivid story (max 150 words) about the topic with a twist ending.', 'a lost phone'],
  code: ['Write code', 'You are a senior programmer. Give working code for the request in a single code block, then at most 3 short lines of explanation.', 'javascript function to reverse a string'],
  debug: ['Find the bug in code', 'You are a senior programmer. Find the bug(s) in the code, show the fixed code and say what was wrong in 2 short lines.', '(paste your code)'],
  recipe: ['Get a recipe', 'Give a simple recipe: ingredients list and short numbered steps. Max 150 words.', 'jollof rice for 4'],
  roast: ['A friendly roast', 'Write a funny, harmless, friendly roast (2-3 lines) of the person or thing named. No insults about race, religion, body, health or family.', 'my best friend who is always late'],
  compliment: ['A warm compliment', 'Write a sincere, warm compliment (2 lines) for the person described.', 'my teammate'],
  bio: ['Write a profile bio', 'Write 3 short, stylish bios (under 120 characters each) for the person described.', 'welding student who loves coding'],
  slogan: ['Create slogans', 'Create 5 short, catchy slogans for the business or idea.', 'a phone repair shop'],
  rhyme: ['Words that rhyme', 'List 12 words that rhyme with the given word. Words only, comma separated.', 'fire'],
  lesson: ['A quick lesson', 'Teach the topic as a mini lesson: a 1-line definition, 3 key points and one quiz question with its answer at the end.', 'oxy-acetylene welding'],
};
// each also answers when a reply is used instead of text

function register(add) {
  /* ----- AI with memory ----- */
  add('xd', 'AI', '<question>', `Ask ${BOT_NAME}: the AI that remembers you and keeps the chat going`, async (ctx) => {
    const q = asked(ctx);
    if (!q) throw new Error(`Ask something.\nExample: ${ctx.prefix}xd what should I cook today?\nTeach it about you with ${ctx.prefix}remember`);
    const key = ctx.jid + ':' + ctx.sender;
    const h = histories.get(key) || [];
    const answer = await ai().askAI([{ role: 'system', content: systemFor(ctx.sock) }, ...h.slice(-8), { role: 'user', content: q.slice(0, 3000) }]);
    h.push({ role: 'user', content: q.slice(0, 600) }, { role: 'assistant', content: answer.slice(0, 900) });
    histories.set(key, h.slice(-10));
    if (histories.size > 300) histories.delete(histories.keys().next().value);
    return answer;
  }, { aliases: ['xdai', 'hxd'] });

  add('remember', 'AI', '<something about you>', 'Teach the AI a fact about you (name, job, likes ...)', (ctx) => {
    const t = (ctx.text || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!t) throw new Error(`Tell me what to remember.\nExample: ${ctx.prefix}remember I study welding at Takoradi Technical University`);
    const { db, save } = hmOf(ctx.sock);
    const list = (db.aiMem ||= []);
    if (list.length >= MAX_FACTS) throw new Error(`Memory is full (${MAX_FACTS}). Remove one with ${ctx.prefix}forget <number>.`);
    list.push(t); save();
    return `🧠 Saved (#${list.length}). ${ctx.prefix}xd will use it from now on.`;
  }, { owner: true, aliases: ['remind-me', 'learn'] });

  add('memory', 'AI', '', 'See what the AI remembers about you', (ctx) => {
    const list = hmOf(ctx.sock).db.aiMem || [];
    if (!list.length) return `🧠 Nothing saved yet. Use ${ctx.prefix}remember <fact>.`;
    return '🧠 *What I remember*\n' + list.map((f, i) => `${i + 1}. ${f}`).join('\n') + `\n\nRemove one: ${ctx.prefix}forget <number>   Remove all: ${ctx.prefix}forget all`;
  }, { owner: true, aliases: ['mymemory', 'memories'] });

  add('forget', 'AI', '<number|all>', 'Remove something the AI remembers', (ctx) => {
    const { db, save } = hmOf(ctx.sock);
    const list = (db.aiMem ||= []);
    const a = (ctx.args[0] || '').toLowerCase();
    if (a === 'all') { db.aiMem = []; histories.clear(); save(); return '🧹 Memory cleared.'; }
    const i = parseInt(a, 10);
    if (!i || i < 1 || i > list.length) throw new Error(`Say which one: ${ctx.prefix}forget 2   (see the numbers with ${ctx.prefix}memory)`);
    const [gone] = list.splice(i - 1, 1); save();
    return `🧹 Forgot: ${gone}`;
  }, { owner: true, aliases: ['unremember'] });

  add('persona', 'AI', '<style | reset>', 'Choose how the AI talks (example: funny pidgin teacher)', (ctx) => {
    const { db, save } = hmOf(ctx.sock);
    const t = (ctx.text || '').trim().slice(0, 150);
    if (!t) return db.persona ? `🎭 Current style: ${db.persona}\nChange it: ${ctx.prefix}persona <style>   Reset: ${ctx.prefix}persona reset` : `🎭 No style set.\nExample: ${ctx.prefix}persona friendly Ghanaian big brother who jokes a lot`;
    if (t.toLowerCase() === 'reset') { delete db.persona; save(); return '🎭 Style reset.'; }
    db.persona = t; save();
    return `🎭 Done. ${ctx.prefix}xd will now talk like: ${t}`;
  }, { owner: true, aliases: ['aistyle'] });

  /* ----- voice answer ----- */
  add('aivoice', 'AI', '<question>', 'The AI answers with a voice note', async (ctx) => {
    const q = asked(ctx);
    if (!q) throw new Error(`Ask something.\nExample: ${ctx.prefix}aivoice tell me a fun fact about the moon`);
    const text = (await ai().askAI([
      { role: 'system', content: systemFor(ctx.sock) + '\nYour answer will be read aloud: use plain sentences, no emojis, no lists, under 45 words.' },
      { role: 'user', content: q.slice(0, 1500) },
    ])).replace(/[*_`#]/g, '').slice(0, 185);
    const mp3 = await tts(text);
    const inp = tmp('mp3'); const out = tmp('ogg');
    try {
      fs.writeFileSync(inp, mp3);
      await ffmpeg(['-i', inp, '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', out]);
      await ctx.sock.sendMessage(ctx.jid, { audio: fs.readFileSync(out), mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: ctx.msg });
    } finally { rm(inp, out); }
  }, { aliases: ['voiceai', 'talk'] });

  /* ----- pictures in a style ----- */
  const STYLES = {
    anime: ['anime style illustration, vibrant colors, detailed, studio quality', 'a samurai under cherry blossoms'],
    logo: ['minimal modern vector logo, flat design, clean white background, professional branding', 'a welding workshop called Spark'],
    wallpaper: ['ultra detailed phone wallpaper, 4k, cinematic lighting, vertical composition', 'neon city at night'],
    portrait: ['realistic studio portrait photo, soft lighting, 85mm lens, sharp focus', 'an old fisherman smiling'],
    pixel: ['pixel art, 16-bit retro game style', 'a dragon guarding gold'],
    cartoon: ['fun 3D cartoon style, Pixar-like, bright colors', 'a robot learning to cook'],
  };
  for (const [name, [style, example]] of Object.entries(STYLES)) {
    add(name, 'AI', '<description>', `AI picture in ${name} style`, async (ctx) => {
      const p = asked(ctx);
      if (!p) throw new Error(`Describe the picture.\nExample: ${ctx.prefix}${name} ${example}`);
      const img = await ai().makeImage(`${p.slice(0, 300)}, ${style}`);
      await ctx.sock.sendMessage(ctx.jid, { image: img, caption: `🎨 ${name}: ${p.slice(0, 90)}` }, { quoted: ctx.msg });
    }, { aliases: name === 'logo' ? ['makelogo'] : name === 'pixel' ? ['pixelart'] : [] });
  }

  /* ----- one-shot writing helpers ----- */
  for (const [name, [desc, system, example]] of Object.entries(WRITERS)) {
    add(name, 'AI', '<text> (or reply)', desc, async (ctx) => {
      const q = asked(ctx);
      if (!q) throw new Error(`Write what it is about, or reply to a message.\nExample: ${ctx.prefix}${name} ${example}`);
      return ai().askAI([
        { role: 'system', content: system + ' Reply in the same language as the request unless told otherwise. No markdown headings.' },
        { role: 'user', content: q.slice(0, 4000) },
      ]);
    });
  }
}

module.exports = { register, systemFor, WRITERS };
