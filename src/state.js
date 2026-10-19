'use strict';
/**
 * Bot memory: registrations, settings and bookkeeping for every server.
 * Saved as one AES-256-GCM encrypted file so a public repo never exposes Discord IDs.
 * The workflow keeps this file on a separate "state" branch.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = 1;

function keyFrom(secret) {
  if (!secret || secret.length < 16) throw new Error('STATE_KEY secret is missing or shorter than 16 characters');
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(obj, secret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return JSON.stringify({ v: VERSION, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}

function decrypt(text, secret) {
  const box = JSON.parse(text);
  const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  const out = Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]);
  return JSON.parse(out.toString('utf8'));
}

function empty() {
  return { v: VERSION, guilds: {}, chars: {} };
}

/** Load from file; a missing file means a fresh start. A wrong key is an error (never silently wipe data). */
function load(file, secret) {
  if (!fs.existsSync(file)) return empty();
  try {
    const s = decrypt(fs.readFileSync(file, 'utf8'), secret);
    s.guilds = s.guilds || {}; s.chars = s.chars || {};
    return s;
  } catch (err) {
    throw new Error(`Could not decrypt ${file}: wrong STATE_KEY? (${err.message}). ` +
      'Refusing to continue so existing registrations are not overwritten.');
  }
}

function save(file, state, secret) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encrypt(state, secret));
}

module.exports = { load, save, encrypt, decrypt, empty };
