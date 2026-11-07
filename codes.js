'use strict';
/**
 * Paid access codes. Saved in DATA_DIR/paid-codes.json (the Railway Volume), so they survive redeploys.
 * One code per phone number. A new payment for the same number extends the same code.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'paid-codes.json');
const DAY = 86400000;

let db = { settings: { price: Number(process.env.PRICE_GHS) || 20, days: Number(process.env.PLAN_DAYS) || 30 }, codes: {}, refs: {}, members: {} };
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  db = { ...db, ...j, settings: { ...db.settings, ...(j.settings || {}) } };
} catch { /* first run */ }

let timer;
function flush() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE);
  } catch (e) { console.error('[codes] could not save:', e.message); }
}
const save = () => { clearTimeout(timer); timer = setTimeout(flush, 300); };

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  for (;;) {
    const b = crypto.randomBytes(6);
    const c = 'HM-' + [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
    if (!db.codes[c]) return c;
  }
}
const clean = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
const digits = (n) => String(n || '').replace(/\D/g, '');

const settings = () => ({ ...db.settings, plans: plans() });

/* ---------- plans (HANS-XD): several prices and lengths; the first plan is the default one ---------- */
const money = (n) => Math.round(Number(n) * 100) / 100;
function defaultPlans() {
  const p = db.settings.price, d = db.settings.days;
  return [
    { id: 'monthly', name: d + ' days', price: p, days: d },
    { id: 'weekly', name: '7 days', price: money(Math.max(1, p * 0.4)), days: 7 },
    { id: 'quarterly', name: '90 days', price: money(p * 2.5), days: 90 },
  ];
}
const plans = () => (Array.isArray(db.settings.plans) && db.settings.plans.length ? db.settings.plans : defaultPlans()).map((x) => ({ ...x }));
const plan = (id) => { const l = plans(); return l.find((x) => x.id === String(id || '')) || l[0]; };
function savePlan({ id, name, price, days }) {
  id = String(id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
  if (!id) throw new Error('Give the plan a short id (letters and numbers).');
  const p = Number(price), d = Math.floor(Number(days));
  if (!(p > 0 && p < 100000)) throw new Error('Bad price.');
  if (!(d >= 1 && d <= 366)) throw new Error('Days must be 1 to 366.');
  const list = db.settings.plans && db.settings.plans.length ? db.settings.plans : defaultPlans();
  const rec = { id, name: String(name || d + ' days').slice(0, 30), price: money(p), days: d };
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) list[i] = rec; else { if (list.length >= 8) throw new Error('At most 8 plans.'); list.push(rec); }
  db.settings.plans = list;
  save();
  return plans();
}
function removePlan(id) {
  const list = (db.settings.plans && db.settings.plans.length ? db.settings.plans : defaultPlans()).filter((x) => x.id !== id);
  if (!list.length) throw new Error('Keep at least one plan.');
  db.settings.plans = list;
  save();
  return plans();
}

/* listeners told about every real payment / manual code (accounts.js uses this for referral rewards) */
const listeners = [];
const onIssue = (fn) => listeners.push(fn);
function setSettings({ price, days }) {
  if (price != null) { const p = Number(price); if (!(p > 0 && p < 100000)) throw new Error('Bad price.'); db.settings.price = Math.round(p * 100) / 100; }
  if (days != null) { const d = Math.floor(Number(days)); if (!(d >= 1 && d <= 366)) throw new Error('Days must be 1 to 366.'); db.settings.days = d; }
  save();
  return settings();
}

/** Create a code for a number, or extend the number's existing one. ref makes payments idempotent. */
function issue({ number, days, ref, source }) {
  number = digits(number);
  if (number.length < 8 || number.length > 15) throw new Error('Bad phone number.');
  if (ref && db.refs[ref]) return { ...db.codes[db.refs[ref]], code: db.refs[ref], repeated: true };
  days = Math.floor(Number(days) || db.settings.days);
  const now = Date.now();
  let code = Object.keys(db.codes).find((c) => db.codes[c].number === number);
  if (code) {
    const rec = db.codes[code];
    rec.expiresAt = Math.max(now, rec.expiresAt) + days * DAY;
    rec.revoked = false;
  } else {
    code = makeCode();
    db.codes[code] = { number, createdAt: now, expiresAt: now + days * DAY, source: source || 'manual' };
  }
  if (ref) db.refs[ref] = code;
  save();
  const out = { ...db.codes[code], code };
  if (!['trial', 'referral', 'gift'].includes(source || 'manual')) for (const fn of listeners) { try { fn(out); } catch (e) { console.error('[codes] listener:', e.message); } }
  return out;
}

/** the newest code record of a number (or null): { code, number, expiresAt, source, active } */
function byNumber(number) {
  number = digits(number);
  const hit = Object.entries(db.codes).filter(([, r]) => r.number === number)[0];
  if (!hit) return null;
  const [code, r] = hit;
  return { code, ...r, active: !r.revoked && r.expiresAt > Date.now() };
}

const exists = (code) => !!db.codes[clean(code)];

/** { ok, reason } - reason is a message safe to show the visitor */
function check(code, number) {
  const c = clean(code), rec = db.codes[c];
  if (!rec || rec.revoked) return { ok: false, reason: 'This code is not valid.' };
  if (rec.number !== digits(number)) return { ok: false, reason: 'This code belongs to a different phone number.' };
  if (rec.expiresAt <= Date.now()) return { ok: false, reason: 'This code has expired. Pay again to renew it.' };
  return { ok: true, rec };
}

const list = () => Object.entries(db.codes).map(([code, r]) => ({ code, ...r, active: !r.revoked && r.expiresAt > Date.now(), member: !!db.members[r.number] }))
  .sort((a, b) => b.createdAt - a.createdAt);

function revoke(code) {
  const c = clean(code), rec = db.codes[c];
  if (!rec) return false;
  rec.revoked = true;
  rec.expiresAt = Math.min(rec.expiresAt, Date.now());
  save();
  return true;
}

/* numbers that linked with a paid code (they get removed when the time ends; owner-code users never are) */
function markMember(number) { db.members[digits(number)] = Date.now(); save(); }
function unmember(number) { delete db.members[digits(number)]; save(); }
function expiredMembers() {
  const out = [];
  for (const n of Object.keys(db.members)) {
    const rec = Object.values(db.codes).find((r) => r.number === n);
    if (!rec || rec.revoked || rec.expiresAt <= Date.now()) out.push(n);
  }
  return out;
}

process.on('beforeExit', flush);
module.exports = { settings, setSettings, plans, plan, savePlan, removePlan, onIssue, byNumber, issue, exists, check, list, revoke, markMember, unmember, expiredMembers, flush, DAY };
