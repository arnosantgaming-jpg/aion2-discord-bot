'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../src/lib');
const State = require('../src/state');
const cfg = require('../config');

const P = { prefix: '!gscs', botId: 'BOT', regions: cfg.regions };

test('parseCommand', () => {
  assert.deepEqual(L.parseCommand('!gscs as siel Arno', P), { type: 'register', region: 'as', server: 'siel', ign: 'Arno' });
  assert.deepEqual(L.parseCommand('!GSCS Asia SIEL Arno', P), { type: 'register', region: 'as', server: 'siel', ign: 'Arno' });
  assert.deepEqual(L.parseCommand('<@BOT> na-west siel Ace', P), { type: 'register', region: 'naw', server: 'siel', ign: 'Ace' });
  assert.deepEqual(L.parseCommand('!gscs remove <@!123>', P), { type: 'remove', target: '123' });
  assert.deepEqual(L.parseCommand('!gscs set leaderboard <#55>', P), { type: 'set', key: 'leaderboard', value: '<#55>' });
  assert.equal(L.parseCommand('hello !gscs', P), null);
  assert.equal(L.parseCommand('!gscs', P).type, 'help');
  assert.equal(L.parseCommand('!gscs commands', P).type, 'commands');
  assert.equal(L.parseCommand('!gscs LIST', P).type, 'commands');
  assert.equal(L.parseCommand('!gscs xx siel A', P).type, 'error');
  assert.equal(L.parseCommand('!gscs as si3l A', P).type, 'error');
});

test('buildNick keeps within 32 characters', () => {
  assert.equal(L.buildNick('Arno', 2323, 112046, cfg.formats), 'Arno | GS 2323 | CP 112,046');
  assert.equal(L.buildNick('Zeraphynez', 2712, 139736, cfg.formats), 'Zeraphynez | GS 2712 | CP 139.7k');
  const long = L.buildNick('ThisIsAVeryLongCharacterName', 2131, 95944, cfg.formats);
  assert.equal([...long].length, 32);
});

test('isAdmin uses owner, Administrator and Manage Server', () => {
  const guild = { id: 'G', owner_id: 'O', roles: [{ id: 'G', permissions: '0' }, { id: 'A', permissions: '8' }, { id: 'M', permissions: '32' }, { id: 'X', permissions: '2048' }] };
  assert.equal(L.isAdmin({ guild, member: { user: { id: 'O' }, roles: [] } }), true);
  assert.equal(L.isAdmin({ guild, member: { user: { id: 'u' }, roles: ['A'] } }), true);
  assert.equal(L.isAdmin({ guild, member: { user: { id: 'u' }, roles: ['M'] } }), true);
  assert.equal(L.isAdmin({ guild, member: { user: { id: 'u' }, roles: ['X'] } }), false);
});

test('boostVerdict', () => {
  const f = cfg.boostFilter, prev = { gs: 2323, cp: 111000 }, H = 36e5;
  assert.equal(L.boostVerdict({ prev, now: { level: 45, gs: 2330, cp: 112000 }, at: 0, f }).action, 'accept');
  assert.equal(L.boostVerdict({ prev, now: { level: 45, gs: 2323, cp: 300000 }, at: 0, f }).action, 'hold');
  assert.equal(L.boostVerdict({ prev, now: { level: 45, gs: 2323, cp: 300000 }, held: { firstSeen: 0 }, at: 13 * H, f }).action, 'accept-after-hold');
  assert.equal(L.boostVerdict({ prev, now: { level: 45, gs: 2000, cp: 90000 }, at: 0, f }).action, 'accept');
});

test('state is encrypted, round-trips, and refuses a wrong key', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gscs-')), 'state.enc');
  const s = State.empty();
  s.guilds.G1 = { members: { '123456789012345678': { key: 'as|siel|arno' } } };
  State.save(file, s, 'correct horse battery staple');
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('123456789012345678') && !raw.includes('arno'), 'nothing readable in the file');
  assert.deepEqual(State.load(file, 'correct horse battery staple').guilds.G1.members['123456789012345678'], { key: 'as|siel|arno' });
  assert.throws(() => State.load(file, 'wrong key wrong key'), /wrong STATE_KEY/);
  assert.deepEqual(State.load(file + '.missing', 'correct horse battery staple'), State.empty());
});
