'use strict';
/**
 * HANS-XD xd2.js - media tools and the smart downloader
 *   Smart download : .dl <link>   (picks the right downloader from the link)
 *   Audio effects  : .bass .nightcore .slowed .fast .deep .chipmunk .robot .echo .areverse .8d  (reply to audio, voice note or video)
 *   Video tools    : .tomp3 .gif .vmute .vspeed <0.5-4> .vreverse .cut <start> <end> .compress .thumb
 *   Picture tools  : .blur .grey .invert .mirror .rotate .pixelate .circle .meme top | bottom .stext <text>
 * Needs ffmpeg (in the Dockerfile) and sharp (in package.json). Heavy jobs go through limit.js.
 */
const { convert, media, sharpLib, ffmpeg, tmp, rm } = require('./xdutil');
const fs = require('fs');

const MAX_VIDEO_SECONDS = 120;

/* ---------------- smart downloader ---------------- */
const HOSTS = [
  [/(?:facebook\.com|fb\.watch|fb\.com)/i, 'fb'],
  [/tiktok\.com/i, 'tiktok'],
  [/instagram\.com/i, 'ig'],
  [/(?:youtube\.com|youtu\.be)/i, 'yt'],
  [/drive\.google\.com/i, 'gdrive'],
  [/mediafire\.com/i, 'mediafire'],
  [/mega\.nz/i, 'mega'],
  [/(?:twitter\.com|x\.com)/i, 'twitter2'],
  [/threads\.(?:net|com)/i, 'threads'],
  [/(?:pinterest\.|pin\.it)/i, 'pinterest'],
  [/(?:soundcloud\.com)/i, 'savefrom'],
  [/open\.spotify\.com/i, 'spotify'],
  [/terabox|1024tera/i, 'terabox'],
  [/github\.com\/[^/]+\/[^/]+/i, 'gitclone'],
  [/pastebin\.com/i, 'pastebin'],
];

/* ---------------- audio effects ---------------- */
// aresample first, so every input (48 kHz voice notes too) gets the same pitch change
const R = (f) => `aresample=44100,asetrate=${Math.round(44100 * f)},aresample=44100`;
const EFFECTS = {
  bass: ['Boost the bass', 'bass=g=16,acompressor=threshold=0.3:ratio=4,volume=0.9'],
  nightcore: ['Faster and higher (nightcore)', R(1.25)],
  slowed: ['Slowed and reverb', R(0.85) + ',aecho=0.8:0.88:60:0.4'],
  fast: ['Speed it up (1.5x, same pitch)', 'atempo=1.5'],
  deep: ['Deep voice', R(0.78)],
  chipmunk: ['Chipmunk voice', R(1.5)],
  robot: ['Robot voice', 'afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75'],
  echo: ['Add an echo', 'aecho=0.8:0.9:700|1100:0.4|0.25'],
  areverse: ['Play audio backwards', 'areverse'],
  '8d': ['8D audio (use headphones)', 'apulsator=hz=0.125'],
};

/* ---------------- picture helpers ---------------- */
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function wrap(text, perLine) {
  const words = String(text).trim().split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > perLine && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 5);
}
/** SVG with white outlined text, centered in the box (needs a font on the server: the Dockerfile adds one) */
function textSvg(text, w, h, { anchor = 'middle', y = 'center', max = 0.16 } = {}) {
  const lines = wrap(text.toUpperCase(), Math.max(8, Math.floor(w / 26)));
  const size = Math.max(18, Math.min(Math.floor(h * max), Math.floor(w / Math.max(8, Math.max(...lines.map((l) => l.length)) * 0.62))));
  const gap = Math.round(size * 1.15);
  const total = gap * lines.length;
  const top = y === 'top' ? size + 8 : y === 'bottom' ? h - total + size - 14 : (h - total) / 2 + size;
  const tspans = lines.map((l, i) => `<text x="${w / 2}" y="${Math.round(top + i * gap)}" text-anchor="${anchor}">${xml(l)}</text>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style>text{font-family:Impact,'DejaVu Sans',Arial,sans-serif;font-weight:900;font-size:${size}px;fill:#fff;stroke:#000;stroke-width:${Math.max(2, Math.round(size / 9))}px;paint-order:stroke;stroke-linejoin:round}</style>${tspans}</svg>`);
}
const asSticker = (sharp, input) => sharp(input).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 85 }).toBuffer();

function register(add) {
  /* ----- smart downloader ----- */
  add('dl', 'Downloader', '<link>', 'Paste any supported link and the right downloader runs (YouTube, TikTok, Instagram, Facebook, X ...)', async (ctx) => {
    const link = ((ctx.text || '').match(/https?:\/\/\S+/) || [ctx.quoted && ctx.quoted.text && (ctx.quoted.text.match(/https?:\/\/\S+/) || [])[0]])[0];
    if (!link) throw new Error(`Send a link.\nExample: ${ctx.prefix}dl https://vm.tiktok.com/xxxx\nWorks with: YouTube, TikTok, Instagram, Facebook, X, Pinterest, Threads, MediaFire, MEGA, Google Drive, Spotify, TeraBox, SoundCloud, GitHub, Pastebin.`);
    const hit = HOSTS.find(([re]) => re.test(link));
    if (!hit) throw new Error('I do not know that site yet. Supported: YouTube, TikTok, Instagram, Facebook, X, Pinterest, Threads, MediaFire, MEGA, Google Drive, Spotify, TeraBox, SoundCloud, GitHub, Pastebin.');
    const cmd = require('./commands').commands.find((c) => c.name === hit[1]);
    if (!cmd) throw new Error('That downloader is not available on this bot.');
    const rest = (ctx.text || '').replace(link, '').trim();
    const text = (link + ' ' + rest).trim();
    return cmd.run({ ...ctx, text, args: text.split(/\s+/) });
  }, { aliases: ['download', 'get', 'savelink'] });

  /* ----- audio effects ----- */
  for (const [name, [desc, filter]] of Object.entries(EFFECTS)) {
    add(name, 'Media', '(reply to audio / voice note / video)', desc, async (ctx) => {
      const buf = await media(ctx, 'an audio, voice note or video');
      const out = await convert(buf, 'mp3', (i, o) => ['-i', i, '-vn', '-t', '600', '-af', filter, '-c:a', 'libmp3lame', '-q:a', '4', o]);
      await ctx.sock.sendMessage(ctx.jid, { audio: out, mimetype: 'audio/mpeg' }, { quoted: ctx.msg });
    }, { aliases: name === 'slowed' ? ['slowedreverb', 'slow'] : name === 'nightcore' ? ['nc'] : [] });
  }

  /* ----- video tools ----- */
  add('tomp3', 'Media', '(reply to a video or voice note)', 'Turn a video or voice note into an mp3 audio', async (ctx) => {
    const buf = await media(ctx, 'a video or voice note');
    const out = await convert(buf, 'mp3', (i, o) => ['-i', i, '-vn', '-c:a', 'libmp3lame', '-q:a', '3', o]);
    await ctx.sock.sendMessage(ctx.jid, { audio: out, mimetype: 'audio/mpeg' }, { quoted: ctx.msg });
  }, { aliases: ['extractaudio', 'video2mp3'] });

  add('gif', 'Media', '(reply to a short video)', 'Turn a video into a looping GIF-style clip', async (ctx) => {
    const buf = await media(ctx, 'a short video');
    const out = await convert(buf, 'mp4', (i, o) => ['-i', i, '-t', '10', '-an', '-vf', 'scale=480:-2,fps=15', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', o]);
    await ctx.sock.sendMessage(ctx.jid, { video: out, gifPlayback: true, caption: '🎞️' }, { quoted: ctx.msg });
  }, { aliases: ['togif'] });

  add('vmute', 'Media', '(reply to a video)', 'Remove the sound from a video', async (ctx) => {
    const buf = await media(ctx, 'a video');
    const out = await convert(buf, 'mp4', (i, o) => ['-i', i, '-an', '-c:v', 'copy', o]);
    await ctx.sock.sendMessage(ctx.jid, { video: out, caption: '🔇' }, { quoted: ctx.msg });
  }, { aliases: ['removeaudio', 'silence'] });

  add('vspeed', 'Media', '<0.5 to 4> (reply to a video)', 'Change the speed of a video (example: .vspeed 2)', async (ctx) => {
    const f = Number(ctx.args[0] || 2);
    if (!(f >= 0.5 && f <= 4)) throw new Error(`Give a speed from 0.5 to 4.\nExample: ${ctx.prefix}vspeed 2`);
    const buf = await media(ctx, 'a video');
    // atempo only accepts 0.5-2 per step, so a factor above 2 is split in two
    const at = f > 2 ? `atempo=2,atempo=${(f / 2).toFixed(3)}` : `atempo=${f}`;
    const out = await convert(buf, 'mp4', (i, o) => ['-i', i, '-t', String(MAX_VIDEO_SECONDS * 2), '-filter_complex', `[0:v]setpts=PTS/${f}[v];[0:a]${at}[a]`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-pix_fmt', 'yuv420p', o]).catch(() =>
      convert(buf, 'mp4', (i, o) => ['-i', i, '-t', String(MAX_VIDEO_SECONDS * 2), '-an', '-vf', `setpts=PTS/${f}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', o])); // video without sound
    await ctx.sock.sendMessage(ctx.jid, { video: out, caption: `⏩ ${f}x` }, { quoted: ctx.msg });
  }, { aliases: ['videospeed'] });

  add('vreverse', 'Media', '(reply to a short video)', 'Play a video backwards (up to 20 seconds)', async (ctx) => {
    const buf = await media(ctx, 'a short video');
    const out = await convert(buf, 'mp4', (i, o) => ['-i', i, '-t', '20', '-vf', 'reverse', '-af', 'areverse', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-pix_fmt', 'yuv420p', o]).catch(() =>
      convert(buf, 'mp4', (i, o) => ['-i', i, '-t', '20', '-an', '-vf', 'reverse', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', o]));
    await ctx.sock.sendMessage(ctx.jid, { video: out, caption: '⏪' }, { quoted: ctx.msg });
  }, { aliases: ['reversevideo'] });

  add('cut', 'Media', '<start> <end> (reply to audio or video)', 'Cut a part out of audio or video (example: .cut 0:10 0:25)', async (ctx) => {
    const sec = (t) => { const p = String(t || '').split(':').map(Number); if (p.some((x) => !(x >= 0))) return NaN; return p.length === 1 ? p[0] : p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2]; };
    const a = sec(ctx.args[0]), b = sec(ctx.args[1]);
    if (!(a >= 0) || !(b > a)) throw new Error(`Give the start and end.\nExample: ${ctx.prefix}cut 0:10 0:25  (10 seconds to 25 seconds)`);
    if (b - a > 300) throw new Error('A cut can be 5 minutes at most.');
    const buf = await media(ctx, 'an audio or video');
    const isVideo = /^(?:....ftyp|\x1aE\xdf\xa3)/s.test(buf.slice(0, 12).toString('latin1')); // mp4 / webm start
    if (isVideo) {
      const out = await convert(buf, 'mp4', (i, o) => ['-ss', String(a), '-to', String(b), '-i', i, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-pix_fmt', 'yuv420p', o]);
      await ctx.sock.sendMessage(ctx.jid, { video: out, caption: '✂️' }, { quoted: ctx.msg });
    } else {
      const out = await convert(buf, 'mp3', (i, o) => ['-ss', String(a), '-to', String(b), '-i', i, '-vn', '-c:a', 'libmp3lame', '-q:a', '3', o]);
      await ctx.sock.sendMessage(ctx.jid, { audio: out, mimetype: 'audio/mpeg' }, { quoted: ctx.msg });
    }
  }, { aliases: ['trim'] });

  add('compress', 'Media', '(reply to a video)', 'Make a video smaller (480p)', async (ctx) => {
    const buf = await media(ctx, 'a video');
    const out = await convert(buf, 'mp4', (i, o) => ['-i', i, '-t', String(MAX_VIDEO_SECONDS * 3), '-vf', 'scale=-2:480', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-c:a', 'aac', '-b:a', '64k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', o], 240000);
    await ctx.sock.sendMessage(ctx.jid, { video: out, caption: `📦 ${(buf.length / 1048576).toFixed(1)}MB → ${(out.length / 1048576).toFixed(1)}MB` }, { quoted: ctx.msg });
  }, { aliases: ['smallvideo'] });

  add('thumb', 'Media', '[second] (reply to a video)', 'Get a picture from a video (example: .thumb 5)', async (ctx) => {
    const s = Math.max(0, Math.min(3600, Number(ctx.args[0]) || 1));
    const buf = await media(ctx, 'a video');
    const out = await convert(buf, 'jpg', (i, o) => ['-ss', String(s), '-i', i, '-frames:v', '1', '-q:v', '2', o]);
    await ctx.sock.sendMessage(ctx.jid, { image: out, caption: `🖼️ at ${s}s` }, { quoted: ctx.msg });
  }, { aliases: ['frame', 'videoframe'] });

  /* ----- picture tools (sharp) ----- */
  const pic = (name, desc, usage, fn, aliases = []) => add(name, 'Media', usage, desc, async (ctx) => {
    const sharp = sharpLib();
    const buf = await media(ctx, 'a picture');
    const out = await fn(sharp, buf, ctx);
    await ctx.sock.sendMessage(ctx.jid, out.sticker ? { sticker: out.sticker } : { image: out.image || out, caption: out.caption || '' }, { quoted: ctx.msg });
  }, { aliases });

  const img = (sharp, buf) => sharp(buf, { animated: false }).rotate(); // .rotate() applies the photo's own orientation
  pic('blur', 'Blur a picture', '[1-30] (reply to a picture)', (sharp, buf, ctx) => img(sharp, buf).blur(Math.max(1, Math.min(30, Number(ctx.args[0]) || 8))).jpeg({ quality: 88 }).toBuffer(), ['blurpic']);
  pic('grey', 'Make a picture black and white', '(reply to a picture)', (sharp, buf) => img(sharp, buf).greyscale().jpeg({ quality: 88 }).toBuffer(), ['gray', 'bw']);
  pic('invert', 'Invert the colours of a picture', '(reply to a picture)', (sharp, buf) => img(sharp, buf).negate({ alpha: false }).jpeg({ quality: 88 }).toBuffer(), ['negative']);
  pic('mirror', 'Mirror a picture left to right', '(reply to a picture)', (sharp, buf) => img(sharp, buf).flop().jpeg({ quality: 88 }).toBuffer(), ['fliph']);
  pic('rotate', 'Rotate a picture', '[90|180|270] (reply to a picture)', (sharp, buf, ctx) => img(sharp, buf).rotate(((Number(ctx.args[0]) || 90) % 360 + 360) % 360, { background: '#000000' }).jpeg({ quality: 88 }).toBuffer(), ['turn']);
  pic('pixelate', 'Pixelate a picture', '[size 4-60] (reply to a picture)', async (sharp, buf, ctx) => {
    const m = await sharp(buf).rotate().metadata();
    const block = Math.max(4, Math.min(60, Number(ctx.args[0]) || 16));
    const small = await sharp(buf).rotate().resize(Math.max(2, Math.round(m.width / block)), null, { kernel: 'nearest' }).toBuffer();
    return sharp(small).resize(m.width, null, { kernel: 'nearest' }).jpeg({ quality: 88 }).toBuffer();
  }, ['pixel2', 'mosaic']);
  pic('circle', 'Cut a picture into a round sticker', '(reply to a picture)', async (sharp, buf) => {
    const s = 512;
    const face = await sharp(buf).rotate().resize(s, s, { fit: 'cover' }).toBuffer();
    const mask = Buffer.from(`<svg width="${s}" height="${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}"/></svg>`);
    const png = await sharp(face).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    return { sticker: await asSticker(sharp, png) };
  }, ['roundsticker', 'circlesticker']);

  pic('meme', 'Put meme text on a picture (top | bottom)', 'top text | bottom text (reply to a picture)', async (sharp, buf, ctx) => {
    const [top, bottom] = (ctx.text || '').split('|').map((x) => x.trim());
    if (!top && !bottom) throw new Error(`Write the text.\nExample: ${ctx.prefix}meme when the code works | but you do not know why\n(reply to a picture)`);
    const base = await sharp(buf).rotate().resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const m = await sharp(base).metadata();
    const layers = [];
    const band = Math.round(m.height * 0.34);
    if (top) layers.push({ input: textSvg(top, m.width, band, { y: 'top' }), top: 0, left: 0 });
    if (bottom) layers.push({ input: textSvg(bottom, m.width, band, { y: 'bottom' }), top: m.height - band, left: 0 });
    return { image: await sharp(base).composite(layers).jpeg({ quality: 90 }).toBuffer(), caption: '' };
  }, ['memegen']);

  add('stext', 'Media', '<text>', 'Turn text into a sticker', async (ctx) => {
    const t = (ctx.text || (ctx.quoted && ctx.quoted.text) || '').trim().slice(0, 120);
    if (!t) throw new Error(`Write the text.\nExample: ${ctx.prefix}stext good morning`);
    const sharp = sharpLib();
    const png = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: textSvg(t, 512, 512, { y: 'center', max: 0.2 }), top: 0, left: 0 }]).png().toBuffer();
    await ctx.sock.sendMessage(ctx.jid, { sticker: await asSticker(sharp, png) }, { quoted: ctx.msg });
  }, { aliases: ['textsticker', 'ttp'] });
}

module.exports = { register, EFFECTS, HOSTS, textSvg };
