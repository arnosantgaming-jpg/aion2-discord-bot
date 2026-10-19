'use strict';
// In-memory stand-ins for Discord and the game API, used by the tests.

let seq = 1000n;
const nextId = () => String(++seq);

function fakeDiscord({ guilds }) {
  const sent = [], replies = [], reactions = [], renames = [], edits = [];
  const g = id => guilds.find(x => x.id === id);
  const ok = r => r.status >= 200 && r.status < 300;
  const api = {
    sent, replies, reactions, renames, edits, ok,
    async me() { return { status: 200, data: { id: '100000000000000000', username: 'GS Tracker' } }; },
    async guilds() { return guilds.map(x => ({ id: x.id, name: x.name })); },
    async guild(id) { const x = g(id); return { status: 200, data: { id, owner_id: x.owner, roles: x.roles } }; },
    async channels(id) { return { status: 200, data: g(id).channels.map(c => ({ id: c.id, name: c.name, type: 0 })) }; },
    async member(gid, uid) {
      const m = g(gid).members[uid];
      return m ? { status: 200, data: { user: { id: uid, username: m.username }, nick: m.nick || null, roles: m.roles || [] } } : { status: 404, data: { message: 'Unknown Member' } };
    },
    async setNick(gid, uid, nick) { g(gid).members[uid].nick = nick; renames.push([gid, uid, nick]); return { status: 200, data: {} }; },
    async messages(cid, q) {
      const ch = guilds.flatMap(x => x.channels).find(c => c.id === cid);
      const after = (q.match(/after=(\d+)/) || [])[1];
      const limit = +(q.match(/limit=(\d+)/) || [0, 50])[1];
      let list = ch.messages.filter(m => !after || BigInt(m.id) > BigInt(after));
      list = list.slice(-limit).reverse();             // newest first, like Discord
      return { status: 200, data: list };
    },
    async send(cid, body) { const id = nextId(); sent.push({ cid, id, body }); return { status: 200, data: { id } }; },
    async edit(cid, mid, body) {
      if (!sent.find(s => s.id === mid)) return { status: 404, data: {} };
      edits.push({ cid, mid, body }); return { status: 200, data: { id: mid } };
    },
    async react(cid, mid, emoji) { reactions.push([mid, emoji]); return { status: 204, data: null }; },
    async reply(cid, mid, content, embeds) { replies.push({ mid, content, embeds }); return { status: 200, data: { id: nextId() } }; },
  };
  return api;
}

function msg(author, content, extra = {}) {
  return { id: nextId(), author: { id: author.id, username: author.username, bot: false }, content, ...extra };
}

/** Characters: key `${region}|${server}|${ign lower}` -> { id, gs, cp, level, cls, name } */
function fakeGame(chars) {
  const calls = { lookup: 0, stats: 0 };
  return {
    calls, chars,
    async lookup(region, server, ign) {
      calls.lookup++;
      const c = chars[`${region}|${server}|${ign.toLowerCase()}`];
      return c ? { ref: { id: c.id, serverId: '1501' } } : 'notfound';
    },
    async stats(region, ref) {
      calls.stats++;
      const c = Object.values(chars).find(x => x.id === ref.id);
      return c ? { gs: c.gs, cp: c.cp, level: c.level || 45, cls: c.cls || 'Gladiator', name: c.name } : 'stale';
    },
  };
}

module.exports = { fakeDiscord, fakeGame, msg, nextId };
