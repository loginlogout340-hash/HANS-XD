'use strict';
/**
 * Daily command limits per linked number (in memory per day; the custom limits are saved in DATA_DIR/limits.json).
 *   - a number on a free TRIAL plan: TRIAL_DAILY_LIMIT commands a day (default 150)
 *   - the admin can set a limit for any number with .setlimit <number> <count|off>
 *   - paid plans, the admin's own bot and numbers linked with your ACCESS_CODE are unlimited
 */
const fs = require('fs');
const path = require('path');
const codes = require('./codes');

const DIR = process.env.DATA_DIR || process.env.SESSION_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'limits.json');
const ADMIN = String(process.env.ADMIN_NUMBER || '').replace(/\D/g, '');

let db = { custom: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { /* first run */ }
const save = () => {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { console.error('[usage] could not save:', e.message); }
};

let today = '';
let counts = new Map();
const utcDay = () => new Date().toISOString().slice(0, 10);
const roll = () => { const d = utcDay(); if (d !== today) { today = d; counts = new Map(); } };
const digits = (n) => String(n || '').replace(/\D/g, '');

/** the daily limit of a number, or 0 for unlimited */
function limitOf(number) {
  number = digits(number);
  if (!number || number === ADMIN) return 0;
  if (db.custom[number] !== undefined) return db.custom[number];
  const rec = codes.byNumber(number);
  if (rec && rec.active && rec.source === 'trial') return Math.max(1, Number(process.env.TRIAL_DAILY_LIMIT || 150) || 150);
  return 0;
}
/** counts one command; { ok:false } when the number used up its day */
function hit(number) {
  roll();
  number = digits(number);
  const limit = limitOf(number);
  const used = counts.get(number) || 0;
  if (limit && used >= limit) return { ok: false, used, limit };
  counts.set(number, used + 1);
  return { ok: true, used: used + 1, limit };
}
const usedToday = (number) => { roll(); return counts.get(digits(number)) || 0; };
function setCustom(number, n) {
  number = digits(number);
  if (n === null) delete db.custom[number]; else db.custom[number] = Math.max(1, Math.floor(n));
  save();
}
const customList = () => Object.entries(db.custom).map(([number, limit]) => ({ number, limit }));

module.exports = { limitOf, hit, usedToday, setCustom, customList };
