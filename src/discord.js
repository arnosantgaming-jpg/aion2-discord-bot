'use strict';
// Minimal Discord REST client (no gateway needed: the bot runs on a schedule).

const API = 'https://discord.com/api/v10';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function createDiscord(token, log = () => {}) {
  async function call(method, path, body, { reason } = {}) {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const headers = { Authorization: 'Bot ' + token, 'User-Agent': 'DiscordBot (https://github.com, 1.0) aion2-gscs-bot' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(reason);
      let res;
      try {
        res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
      } catch (err) {
        if (attempt === 6) return { status: 0, data: { message: String(err.message || err) } };
        await sleep(1000 * attempt); continue;
      }
      if (res.status === 429) {
        const j = await res.json().catch(() => ({}));
        const wait = Math.ceil((j.retry_after || 1) * 1000) + 250;
        log(`   Discord rate limit, waiting ${(wait / 1000).toFixed(1)}s`);
        await sleep(wait); continue;
      }
      if (res.status >= 500 && attempt < 6) { await sleep(1000 * attempt); continue; }
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      return { status: res.status, data };
    }
    return { status: 429, data: { message: 'rate limited too many times' } };
  }

  const ok = r => r.status >= 200 && r.status < 300;

  return {
    call, ok,
    me: () => call('GET', '/users/@me'),
    async guilds() {
      const out = []; let after = '0';
      for (;;) {
        const r = await call('GET', `/users/@me/guilds?limit=200&after=${after}`);
        if (!ok(r)) throw new Error('Could not list servers: HTTP ' + r.status + ' ' + (r.data && r.data.message || ''));
        out.push(...r.data);
        if (r.data.length < 200) return out;
        after = r.data[r.data.length - 1].id;
      }
    },
    guild: id => call('GET', `/guilds/${id}`),
    channels: id => call('GET', `/guilds/${id}/channels`),
    member: (gid, uid) => call('GET', `/guilds/${gid}/members/${uid}`),
    setNick: (gid, uid, nick) => call('PATCH', `/guilds/${gid}/members/${uid}`, { nick }, { reason: 'AION 2 GS/CP' }),
    messages: (cid, q) => call('GET', `/channels/${cid}/messages?${q}`),
    send: (cid, body) => call('POST', `/channels/${cid}/messages`, body),
    edit: (cid, mid, body) => call('PATCH', `/channels/${cid}/messages/${mid}`, body),
    react: (cid, mid, emoji) => call('PUT', `/channels/${cid}/messages/${mid}/reactions/${encodeURIComponent(emoji)}/@me`),
    reply: (cid, mid, content, embeds) => call('POST', `/channels/${cid}/messages`, {
      ...(content ? { content } : {}), ...(embeds ? { embeds } : {}),
      message_reference: { message_id: mid, fail_if_not_exists: false }, allowed_mentions: { parse: [] },
    }),
  };
}

module.exports = { createDiscord };
