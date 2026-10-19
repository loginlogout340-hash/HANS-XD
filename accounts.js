'use strict';
/**
 * HANS-XD accounts: signup, login, sessions, referral codes, number claims.
 * Saved in DATA_DIR/accounts.json (the Railway Volume). Passwords are never stored, only a scrypt hash.
 * Sessions are random tokens; only a hash of each token is stored, the browser keeps the token in an HttpOnly cookie.
 *
 * Railway variables (all optional):
 *   TRIAL_DAYS         free trial length for a new account's first number (default 0 = no trial)
 *   TRIAL_DAILY_LIMIT  commands per day while on a trial plan (default 150)
 *   REF_BONUS_DAYS     days the referrer gets when a friend pays for the first time (default 5)
 *   REF_WELCOME_DAYS   extra days the friend gets on their first payment (default 0)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const codes = require('./codes');

const DIR = process.env.DATA_DIR || process.env.SESSION_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'accounts.json');
const DAY = 86400000;
const SESSION_DAYS = 30;
const MAX_ACCOUNTS = 20000;

class AccountError extends Error {}

let db = { users: {}, emails: {}, numbers: {}, refs: {}, sessions: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { /* first run */ }

let timer;
function flush() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { console.error('[accounts] could not save:', e.message); }
}
const save = () => { clearTimeout(timer); timer = setTimeout(flush, 300); };
process.on('beforeExit', flush);

const num = (n) => Math.max(0, Math.floor(Number(n) || 0));
const cfg = () => ({
  trialDays: num(process.env.TRIAL_DAYS),
  trialLimit: num(process.env.TRIAL_DAILY_LIMIT || 150),
  refBonus: num(process.env.REF_BONUS_DAYS === undefined ? 5 : process.env.REF_BONUS_DAYS),
  refWelcome: num(process.env.REF_WELCOME_DAYS),
});

/* ---------------- passwords and tokens ---------------- */
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cleanEmail = (e) => String(e || '').trim().toLowerCase().slice(0, 120);
const cleanNumber = (n) => String(n || '').replace(/\D/g, '');
const REF_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeRef() {
  for (;;) {
    const c = 'XD' + [...crypto.randomBytes(5)].map((x) => REF_ALPHA[x % REF_ALPHA.length]).join('');
    if (!db.refs[c]) return c;
  }
}

/* ---------------- signup / login ---------------- */
function signup({ name, email, password, ref }) {
  email = cleanEmail(email);
  name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new AccountError('Enter a valid email address.');
  if (name.length < 2) throw new AccountError('Enter your name.');
  if (String(password || '').length < 8) throw new AccountError('Your password must be at least 8 characters.');
  if (String(password).length > 200) throw new AccountError('That password is too long.');
  if (db.emails[email]) throw new AccountError('An account with this email already exists. Log in instead.');
  if (Object.keys(db.users).length >= MAX_ACCOUNTS) throw new AccountError('Signups are closed right now.');
  const id = crypto.randomBytes(9).toString('hex');
  const salt = crypto.randomBytes(16).toString('hex');
  const referrer = ref ? db.refs[String(ref).trim().toUpperCase()] : null;
  db.users[id] = {
    id, name, email, salt, hash: hashPw(password, salt), createdAt: Date.now(),
    refCode: null, referredBy: referrer || null, referralRewarded: false, refCount: 0, bonusEarned: 0, pendingDays: 0,
    number: null, trialUsed: false,
  };
  const code = makeRef();
  db.users[id].refCode = code;
  db.refs[code] = id;
  db.emails[email] = id;
  save();
  return db.users[id];
}

function login({ email, password }) {
  const u = db.users[db.emails[cleanEmail(email)]];
  // same work either way, so the answer time does not reveal which emails exist
  const salt = u ? u.salt : '0'.repeat(32);
  const h = hashPw(password || '', salt);
  if (!u || !safeEq(h, u.hash)) throw new AccountError('Wrong email or password.');
  return u;
}

function newSession(uid) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  // forget expired sessions and keep at most 10 per account
  for (const [k, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[k];
  const mine = Object.entries(db.sessions).filter(([, s]) => s.uid === uid).sort((a, b) => a[1].exp - b[1].exp);
  while (mine.length >= 10) delete db.sessions[mine.shift()[0]];
  db.sessions[sha(token)] = { uid, exp: now + SESSION_DAYS * DAY };
  save();
  return token;
}
function userOf(token) {
  if (!token) return null;
  const s = db.sessions[sha(token)];
  if (!s || s.exp < Date.now()) return null;
  return db.users[s.uid] || null;
}
function endSession(token) { if (token && db.sessions[sha(token)]) { delete db.sessions[sha(token)]; save(); } }
function changePassword(u, oldPw, newPw) {
  if (!safeEq(hashPw(oldPw || '', u.salt), u.hash)) throw new AccountError('Your current password is wrong.');
  if (String(newPw || '').length < 8) throw new AccountError('The new password must be at least 8 characters.');
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = hashPw(newPw, u.salt);
  for (const [k, s] of Object.entries(db.sessions)) if (s.uid === u.id) delete db.sessions[k]; // log out everywhere
  save();
}

/* ---------------- numbers ---------------- */
const owner = (number) => db.users[db.numbers[cleanNumber(number)]] || null;
/** an account takes a number (only after the number was proven: pairing code used, or a .claim code) */
function attach(u, number) {
  number = cleanNumber(number);
  const other = owner(number);
  if (other && other.id !== u.id) throw new AccountError('This number belongs to another account.');
  if (u.number && u.number !== number) delete db.numbers[u.number];
  u.number = number;
  db.numbers[number] = u.id;
  // referral days that were waiting for a number
  if (u.pendingDays > 0) {
    const d = u.pendingDays; u.pendingDays = 0;
    try { codes.issue({ number, days: d, source: 'referral' }); } catch { u.pendingDays = d; }
  }
  save();
}
function detach(u) { if (u.number) delete db.numbers[u.number]; u.number = null; save(); }
const canClaim = (u, number) => { const o = owner(number); return !o || o.id === u.id; };

/** one free trial per account, only if the number never had a plan */
function startTrial(u, number) {
  const days = cfg().trialDays;
  if (!days || u.trialUsed || codes.byNumber(number)) return null;
  u.trialUsed = true;
  save();
  return codes.issue({ number, days, source: 'trial' });
}

/* ---------------- .claim codes (an existing bot owner proves the number from WhatsApp) ---------------- */
const claims = new Map(); // code -> { number, exp }
function makeClaim(number) {
  for (const [k, v] of claims) if (v.exp < Date.now()) claims.delete(k);
  for (const [k, v] of claims) if (v.number === number) claims.delete(k);
  const code = String(crypto.randomInt(100000, 1000000));
  claims.set(code, { number: cleanNumber(number), exp: Date.now() + 10 * 60000 });
  return code;
}
function useClaim(u, code) {
  const c = claims.get(String(code || '').trim());
  if (!c || c.exp < Date.now()) throw new AccountError('That code is wrong or expired. Send .claim to your bot for a new one.');
  attach(u, c.number);
  claims.delete(String(code).trim());
  return c.number;
}

/* ---------------- referrals ---------------- */
/** called by codes.js when a real payment (not a trial or referral) is recorded for a number */
function onPaid(number, rec) {
  try {
    const u = owner(number);
    if (!u || !u.referredBy || u.referralRewarded) return;
    const ref = db.users[u.referredBy];
    u.referralRewarded = true;
    const { refBonus, refWelcome } = cfg();
    if (ref && refBonus > 0) {
      ref.refCount++; ref.bonusEarned += refBonus;
      if (ref.number) codes.issue({ number: ref.number, days: refBonus, source: 'referral' });
      else ref.pendingDays += refBonus;
    }
    if (refWelcome > 0 && rec && rec.number) codes.issue({ number: rec.number, days: refWelcome, source: 'referral' });
    save();
  } catch (e) { console.error('[accounts] referral:', e.message); }
}
codes.onIssue((rec) => onPaid(rec.number, rec));

/* ---------------- views ---------------- */
function publicUser(u) {
  const plan = u.number ? codes.byNumber(u.number) : null;
  return {
    name: u.name, email: u.email, number: u.number, refCode: u.refCode, refCount: u.refCount, bonusEarned: u.bonusEarned,
    pendingDays: u.pendingDays, trialAvailable: !!cfg().trialDays && !u.trialUsed, trialDays: cfg().trialDays,
    plan: plan ? { active: plan.active, expiresAt: plan.expiresAt, source: plan.source } : null,
    createdAt: u.createdAt,
  };
}
const list = () => Object.values(db.users).map((u) => ({
  id: u.id, name: u.name, email: u.email, number: u.number, createdAt: u.createdAt, refCount: u.refCount, referredBy: u.referredBy ? db.users[u.referredBy]?.email || '' : '',
})).sort((a, b) => b.createdAt - a.createdAt);
const count = () => Object.keys(db.users).length;

module.exports = {
  AccountError, signup, login, newSession, userOf, endSession, changePassword, attach, detach, canClaim, owner,
  startTrial, makeClaim, useClaim, publicUser, list, count, cfg, flush, SESSION_DAYS,
};
