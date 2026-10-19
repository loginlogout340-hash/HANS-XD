'use strict';
/** Small helpers shared by the HANS-XD command files (xd1.js ... xd5.js). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const heavy = require('./limit').run;

const hmOf = (sock) => sock.hm;
const num = (j = '') => String(j).split('@')[0].split(':')[0].replace(/\D/g, '');
const jidOf = (d) => d + '@s.whatsapp.net';
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const BOT_NAME = process.env.BOT_NAME || 'HANS-XD';

/** the people a command is about: @mentions, the replied person, or numbers typed after it (digits only) */
function targets(ctx) {
  if (ctx.mentioned && ctx.mentioned.length) return ctx.mentioned;
  if (ctx.quoted && ctx.quoted.participant) return [ctx.quoted.participant];
  return ctx.args.map((a) => a.replace(/\D/g, '')).filter((d) => d.length >= 7).map(jidOf);
}

const tmp = (ext) => path.join(os.tmpdir(), 'xd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.' + ext);
const rm = (...f) => f.forEach((x) => fs.unlink(x, () => {}));
function ffmpeg(args, timeout = 120000) {
  return new Promise((ok, no) => heavy('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { timeout }, (err, _o, e) => (err
    ? no(new Error(String(e || err.message).split('\n').filter(Boolean).slice(-1)[0] || 'ffmpeg failed'))
    : ok())));
}
/** run ffmpeg on a buffer: build(inPath, outPath) returns the ffmpeg arguments; returns the output buffer */
async function convert(buf, outExt, build, timeout) {
  const inp = tmp('in'); const out = tmp(outExt);
  try {
    fs.writeFileSync(inp, buf);
    await ffmpeg(build(inp, out), timeout);
    return fs.readFileSync(out);
  } finally { rm(inp, out); }
}
/** the media the command was sent with, or replied to (friendly error when there is none) */
async function media(ctx, what) {
  try { return await ctx.downloadMedia(); } catch { throw new Error(`Reply to ${what}, or send it with the command as its caption.`); }
}
const sharpLib = () => {
  try { return require('sharp'); } catch { throw new Error('The picture tool is missing on the server (add "sharp" to package.json and redeploy).'); }
};
const ai = () => require('./more2');
const fmtMoney = (n) => Number(n).toLocaleString('en-US');

module.exports = { hmOf, num, jidOf, pick, rnd, targets, tmp, rm, ffmpeg, convert, media, sharpLib, ai, fmtMoney, BOT_NAME };
