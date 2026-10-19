'use strict';
// AION 2 lookups: Shugo.gg (once per character, to find its ID) and NCSOFT's official API (live stats).
const cfg = require('../config');
const L = require('./lib');

const API = 'https://aion2.plaync.com/api/character/info';
const UA = 'Mozilla/5.0 (compatible; aion2-gscs-bot/1.0)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, json) {
  let lastErr;
  for (let attempt = 1; attempt <= cfg.retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html' } });
      clearTimeout(t);
      if (res.status === 404) return { status: 404 };
      if (res.status === 429 || res.status >= 500) { lastErr = 'HTTP ' + res.status; await sleep(attempt * 2000); continue; }
      if (!res.ok) return { status: res.status };
      return { status: res.status, body: json ? await res.json().catch(() => null) : await res.text() };
    } catch (err) {
      clearTimeout(t);
      lastErr = err.name === 'AbortError' ? 'timeout' : String(err.message || err);
      await sleep(attempt * 1500);
    }
  }
  return { status: 0, error: lastErr };
}

/** Find a character. Returns { ref } | 'notfound' | { error }. */
async function lookup(region, server, ign) {
  const url = `https://shugo.gg/character/global/${region}-${encodeURIComponent(server)}/${encodeURIComponent(L.clean(ign))}`;
  const r = await get(url, false);
  if (r.status === 404) return 'notfound';
  if (r.status !== 200) return { error: r.error || 'character site HTTP ' + r.status };
  const ref = L.parseId(r.body);
  return ref ? { ref } : { error: 'could not read character ID' };
}

/** Live stats. Returns stats object | 'stale' (ID no longer valid) | { error }. */
async function stats(region, ref) {
  const url = `${API}?lang=en-US&characterId=${encodeURIComponent(ref.id)}&serverId=${ref.serverId}&region=${region}`;
  const r = await get(url, true);
  if (r.status !== 200) return { error: r.error || 'game API HTTP ' + r.status };
  const v = L.parseApi(r.body);
  return v || 'stale';
}

module.exports = { lookup, stats };
