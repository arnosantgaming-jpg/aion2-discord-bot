'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { run } = require('../src/bot');
const State = require('../src/state');
const { fakeDiscord, fakeGame, msg } = require('./fakes');

const ADMIN = { id: '111111111111111111', username: 'arno' };
const MEMBER = { id: '222222222222222222', username: 'zen' };
const OTHER = { id: '333333333333333333', username: 'yam' };
const OWNER = { id: '999999999999999999', username: 'boss' };
const quiet = () => {};

function world() {
  const reg = { id: 'C1', name: 'gscs-register', messages: [] };
  const lb = { id: 'C2', name: 'gscs-leaderboard', messages: [] };
  const guild = {
    id: 'G1', name: 'Kopitiam', owner: OWNER.id,
    roles: [
      { id: 'G1', position: 0, permissions: '0' },            // @everyone
      { id: 'R_ADMIN', position: 10, permissions: String(1 << 5) }, // Manage Server, above bot
      { id: 'R_OFFICER', position: 3, permissions: String(1 << 5) }, // Manage Server, below bot
      { id: 'R_BOT', position: 5, permissions: '0' },
    ],
    channels: [reg, lb],
    members: {
      '100000000000000000': { username: 'GS Tracker', roles: ['R_BOT'] },
      [ADMIN.id]: { username: ADMIN.username, roles: ['R_OFFICER'] },
      [MEMBER.id]: { username: MEMBER.username, roles: [] },
      [OTHER.id]: { username: OTHER.username, roles: ['R_ADMIN'] },
      [OWNER.id]: { username: OWNER.username, roles: [] },
    },
  };
  const game = fakeGame({
    'as|siel|arno': { id: 'ID_ARNO', name: 'Arno', gs: 2323, cp: 112046 },
    'as|siel|zen': { id: 'ID_ZEN', name: 'Zen', gs: 1733, cp: 76123 },
    'as|siel|yam': { id: 'ID_YAM', name: 'Yam', gs: 1829, cp: 92419 },
    'as|siel|boss': { id: 'ID_BOSS', name: 'Boss', gs: 2500, cp: 150000 },
  });
  return { reg, lb, guild, game, discord: fakeDiscord({ guilds: [guild] }) };
}

test('members register, get renamed, and a leaderboard is posted then edited', async () => {
  const w = world();
  const state = State.empty();
  w.reg.messages.push(
    msg(ADMIN, '!gscs as siel Arno'),
    msg(MEMBER, '!gscs AS Siel zen'),                 // case-insensitive region/server
    msg(OTHER, 'hello everyone'),                      // ignored
    msg(OWNER, '!gscs as siel Boss'),
  );
  const s1 = await run({ discord: w.discord, game: w.game, state, log: quiet, now: 1e12 });
  assert.equal(s1.registered, 3);
  assert.equal(w.discord.replies.length, 3);
  assert.match(w.discord.replies[0].content, /Registered \*\*Arno\*\* \(siel, Asia\).*GS \*\*2,323\*\* · CP \*\*112,046\*\*/);
  assert.deepEqual(w.discord.renames.map(r => [r[1], r[2]]).sort(), [
    ['111111111111111111', 'Arno | GS 2323 | CP 112,046'],
    ['222222222222222222', 'Zen | GS 1733 | CP 76,123'],
  ], 'owner is never renamed');
  assert.equal(w.discord.sent.length, 1, 'leaderboard posted');
  const lb = w.discord.sent[0].body.embeds[0];
  assert.match(lb.title, /Kopitiam/);
  assert.match(lb.description.split('\n')[0], /Boss/, 'sorted by CP');
  assert.equal(lb.description.split('\n').length, 3);

  // Second run: no new messages; CP changes; leaderboard is edited, not re-posted.
  w.game.chars['as|siel|arno'].cp = 113000;
  const s2 = await run({ discord: w.discord, game: w.game, state, log: quiet, now: 1e12 + 9e5 });
  assert.equal(s2.commands, 0, 'old messages are not handled twice');
  assert.equal(w.discord.sent.length, 1);
  assert.equal(w.discord.edits.length, 1);
  assert.equal(w.guild.members['111111111111111111'].nick, 'Arno | GS 2323 | CP 113,000');
  assert.equal(w.game.calls.lookup, 3, 'characters looked up only once');
});

test('bad input, unknown characters and duplicate claims get clear replies', async () => {
  const w = world();
  const state = State.empty();
  w.reg.messages.push(
    msg(MEMBER, '!gscs siel Zen'),                   // missing region
    msg(MEMBER, '!gscs xx siel Zen'),                // bad region
    msg(MEMBER, '!gscs as siel Zenn'),               // not found
    msg(ADMIN, '!gscs as siel Arno'),
    msg(MEMBER, '!gscs as siel arno'),               // someone else's character
    msg(MEMBER, '!gscs help'),
  );
  await run({ discord: w.discord, game: w.game, state, log: quiet, now: 1e12 });
  const r = w.discord.replies.map(x => x.content);
  assert.match(r[0], /Usage/);
  assert.match(r[1], /Unknown region/);
  assert.match(r[2], /Couldn't find \*\*Zenn\*\*/);
  assert.match(r[3], /Registered \*\*Arno\*\*/);
  assert.match(r[4], /already registered by <@111111111111111111>/);
  assert.match(r[5], /Register your main/);
  assert.deepEqual(Object.keys(state.guilds.G1.members), ['111111111111111111']);
});

test('admin settings: only Manage Server can change them; nicknames off stops renames', async () => {
  const w = world();
  const state = State.empty();
  w.reg.messages.push(
    msg(MEMBER, '!gscs set nicknames off'),          // not admin
    msg(ADMIN, '!gscs set nicknames off'),           // officer has Manage Server
    msg(ADMIN, '!gscs set format {ign} [{cpk}]'),
    msg(MEMBER, '!gscs as siel Zen'),
    msg(MEMBER, '!gscs settings'),
  );
  await run({ discord: w.discord, game: w.game, state, log: quiet, now: 1e12 });
  const r = w.discord.replies.map(x => x.content);
  assert.match(r[0], /Only members with \*\*Manage Server\*\*/);
  assert.match(r[1], /Nicknames turned \*\*off\*\*/);
  assert.match(r[2], /Example: `Arno \[112k\]`/);
  assert.match(r[4], /Nicknames: \*\*off\*\*/);
  assert.equal(w.discord.renames.length, 0);

  w.reg.messages.push(msg(ADMIN, '!gscs set nicknames on'));
  await run({ discord: w.discord, game: w.game, state, log: quiet, now: 1e12 + 1 });
  assert.equal(w.guild.members['222222222222222222'].nick, 'Zen [76.1k]', 'custom format used');
});

test('remove: self, admin removing others, and members who left the server', async () => {
  const w = world();
  const state = State.empty();
  w.reg.messages.push(msg(ADMIN, '!gscs as siel Arno'), msg(MEMBER, '!gscs as siel Zen'), msg(OTHER, '!gscs as siel Yam'));
  await run({ discord: w.discord, game: w.game, state, log: quiet, now: 1e12 });
  assert.equal(Object.keys(state.guilds.G1.members).length, 3);

  w.reg.messages.push(msg(MEMBER, '!gscs remove <@333333333333333333>'), msg(ADMIN, '!gscs remove <@333333333333333333>'),
    msg(MEMBER, '!gscs remove'), msg(MEMBER, '!gscs remove @yam'));
  await run({ discord: w.discord, game: w.game, state, log: quiet, now: 1e12 + 1 });
  const r = w.discord.replies.slice(-4).map(x => x.content);
  assert.match(r[0], /Only members with/);
  assert.match(r[1], /Removed <@333333333333333333>'s registration/);
  assert.match(r[2], /Removed your registration/);
  assert.match(r[3], /mention them/, 'plain-text @name does not remove the sender');
  assert.deepEqual(Object.keys(state.guilds.G1.members), ['111111111111111111']);
  delete w.guild.members['111111111111111111'];                          // Arno leaves the server
  await run({ discord: w.discord, game: w.game, state, log: quiet, now: 1e12 + 2 });
  assert.deepEqual(Object.keys(state.guilds.G1.members), [], 'member who left is cleaned up');
  await run({ discord: w.discord, game: w.game, state, log: quiet, now: 1e12 + 3 });
  assert.deepEqual(Object.keys(state.chars), [], 'unused characters forgotten');
});

test('battleground boost is held, then discarded when it ends', async () => {
  const w = world();
  const state = State.empty();
  w.reg.messages.push(msg(ADMIN, '!gscs as siel Arno'));
  await run({ discord: w.discord, game: w.game, state, log: quiet, now: 1e12 });

  w.game.chars['as|siel|arno'].cp = 300000;           // in a battleground
  const s = await run({ discord: w.discord, game: w.game, state, log: quiet, now: 1e12 + 9e5 });
  assert.equal(s.held, 1);
  assert.equal(state.chars['as|siel|arno'].cp, 112046, 'boost not saved');
  assert.equal(w.guild.members['111111111111111111'].nick, 'Arno | GS 2323 | CP 112,046');

  w.game.chars['as|siel|arno'].cp = 112500;           // left the battleground
  await run({ discord: w.discord, game: w.game, state, log: quiet, now: 1e12 + 18e5 });
  assert.equal(state.chars['as|siel|arno'].cp, 112500);
  assert.equal(state.chars['as|siel|arno'].pending, null);
});

test('dry run changes nothing in Discord', async () => {
  const w = world();
  const state = State.empty();
  w.reg.messages.push(msg(ADMIN, '!gscs as siel Arno'));
  await run({ discord: w.discord, game: w.game, state, log: quiet, dryRun: true, now: 1e12 });
  assert.equal(w.discord.replies.length + w.discord.renames.length + w.discord.sent.length + w.discord.reactions.length, 0);
});

test('a server without the register channel is skipped without errors', async () => {
  const w = world();
  w.guild.channels = [w.lb];
  const s = await run({ discord: w.discord, game: w.game, state: State.empty(), log: quiet, now: 1e12 });
  assert.equal(s.problems.length, 0);
  assert.equal(s.commands, 0);
});

test('!gscs commands shows every command with examples', async () => {
  const w = world();
  w.reg.messages.push(msg(MEMBER, '!gscs commands'), msg(MEMBER, '!gscs cmds'), msg(MEMBER, '!gscs help'));
  await run({ discord: w.discord, game: w.game, state: State.empty(), log: quiet, now: 1e12 });
  const [a, b, h] = w.discord.replies;
  assert.equal(a.content, null);
  const e = a.embeds[0];
  assert.match(e.title, /all commands/);
  assert.match(e.description, /<#C1>/, 'points at the register channel');
  const all = e.fields.map(f => f.value).join('\n');
  for (const ex of ['!gscs as siel Arno', '!gscs remove', '!gscs settings', '!gscs set nicknames on',
    '!gscs set leaderboard #rankings', '!gscs set format {ign} [{cpk}]', '!gscs set register #sign-ups', '!gscs remove @Zen']) {
    assert.ok(all.includes('e.g. `' + ex + '`'), 'example for ' + ex);
  }
  for (const f of e.fields) assert.ok(f.value.length <= 1024, f.name + ' within Discord field limit');
  assert.ok(b.embeds, '!gscs cmds works too');
  assert.match(h.content, /!gscs commands/, 'help points to the full list');
});
