'use strict';
// Pure helpers (no network) so they can be unit-tested.

function clean(v) {
  return String(v == null ? '' : v).replace(/[ ​]/g, ' ').trim();
}

function isGood(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Character ID + server ID from a Shugo profile page. */
function parseId(html) {
  if (!html) return null;
  const m = html.match(/&quot;id&quot;:&quot;([^&]+)&quot;,&quot;serverId&quot;:(\d+)/) ||
            html.match(/"id":"([^"]+)","serverId":(\d+)/);
  return m ? { id: m[1], serverId: String(m[2]) } : null;
}

/** { gs, cp, name, level, cls } from NCSOFT's character/info JSON, or null. */
function parseApi(json) {
  const p = json && json.profile;
  if (!p || typeof p.combatPower !== 'number') return null;
  let gs = 0;
  const list = json.stat && json.stat.statList;
  if (Array.isArray(list)) {
    const il = list.find(s => s && s.type === 'ItemLevel');
    if (il) gs = Number(il.value) || 0;
  }
  return { gs, cp: p.combatPower, name: p.characterName || '', level: Number(p.characterLevel) || 0, cls: p.className || '' };
}

/**
 * Battleground filter.
 *  'accept'            normal change / drop / filter doesn't apply
 *  'hold'              huge jump, keep old numbers for now
 *  'accept-after-hold' huge jump has lasted holdHours, it's real
 */
function boostVerdict({ prev, now, held, at, f }) {
  if (!f || !f.enabled) return { action: 'accept' };
  if (!prev || !isGood(prev.cp) || prev.cp <= 0) return { action: 'accept' };
  if ((now.level || 0) < f.minLevel) return { action: 'accept' };
  const cpJump = now.cp > prev.cp * f.maxCpRatio;
  const gsJump = isGood(prev.gs) && prev.gs > 0 && now.gs > prev.gs * f.maxGsRatio;
  if (!cpJump && !gsJump) return { action: 'accept' };
  const heldHours = held ? (at - held.firstSeen) / 3600000 : 0;
  if (held && heldHours >= f.holdHours) return { action: 'accept-after-hold', heldHours };
  return { action: 'hold', heldHours };
}

/** Run async fn over items with at most `limit` in flight. Preserves order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------- nicknames

const MAX_NICK = 32;
const len = s => [...s].length;
const cut = (s, n) => [...s].slice(0, Math.max(0, n)).join('');

function cpShort(cp) {
  if (cp >= 1e6) return (Math.round(cp / 1e5) / 10) + 'm';
  if (cp >= 1e3) return (Math.round(cp / 100) / 10) + 'k';
  return String(cp);
}

function fill(tpl, ign, gs, cp) {
  return tpl.replace('{ign}', ign).replace('{gs}', String(gs))
    .replace('{cpk}', cpShort(cp)).replace('{cp}', cp.toLocaleString('en-US'));
}

/** First format that fits 32 chars; otherwise the last one with the IGN shortened. */
function buildNick(ign, gs, cp, formats) {
  ign = clean(ign);
  for (const tpl of formats) {
    const s = fill(tpl, ign, gs, cp);
    if (len(s) <= MAX_NICK) return s;
  }
  const last = formats[formats.length - 1];
  return fill(last, cut(ign, MAX_NICK - len(fill(last, '', gs, cp))), gs, cp);
}

// ---------------------------------------------------------------- commands

/**
 * Parses a message into a command, or null if it isn't one.
 *   !gscs <region> <server> <ign>       -> { type: 'register', region, server, ign }
 *   !gscs remove                         -> { type: 'remove' }
 *   !gscs remove <@user>                 -> { type: 'remove', target }
 *   !gscs settings                       -> { type: 'settings' }
 *   !gscs help                           -> { type: 'help' }
 *   !gscs set <key> <value...>           -> { type: 'set', key, value }
 * Works with the bot mentioned instead of the prefix too ("@Bot as siel Arno").
 */
function parseCommand(content, { prefix, botId, regions }) {
  let text = clean(content);
  const mention = botId ? new RegExp(`^<@!?${botId}>\\s*`) : null;
  if (text.toLowerCase().startsWith(prefix.toLowerCase())) text = text.slice(prefix.length);
  else if (mention && mention.test(text)) text = text.replace(mention, '');
  else return null;
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { type: 'help' };
  const head = parts[0].toLowerCase();

  if (head === 'help') return { type: 'help' };
  if (head === 'commands' || head === 'cmds' || head === 'list') return { type: 'commands' };
  if (head === 'settings') return { type: 'settings' };
  if (head === 'remove' || head === 'unregister') {
    if (!parts[1]) return { type: 'remove' };
    const m = parts[1].match(/^<@!?(\d+)>$/);
    return m ? { type: 'remove', target: m[1] }
      : { type: 'error', error: 'To remove someone, mention them: `' + prefix + ' remove @member`. To remove yourself: `' + prefix + ' remove`.' };
  }
  if (head === 'set') {
    if (parts.length < 3) return { type: 'error', error: 'Usage: `' + prefix + ' set <nicknames|leaderboard|format> <value>`' };
    return { type: 'set', key: parts[1].toLowerCase(), value: parts.slice(2).join(' ') };
  }
  if (parts.length < 3) {
    return { type: 'error', error: 'Usage: `' + prefix + ' <region> <server> <IGN>`, e.g. `' + prefix + ' as siel Arno`' };
  }
  const region = regions[head];
  if (!region) return { type: 'error', error: `Unknown region \`${parts[0]}\`. Use one of: as, eu, nae, naw.` };
  const server = parts[1].toLowerCase();
  if (!/^[a-z]+$/.test(server)) return { type: 'error', error: `\`${parts[1]}\` doesn't look like a server name (e.g. siel).` };
  const ign = parts.slice(2).join(' ');
  if (len(ign) > 32) return { type: 'error', error: 'That IGN is too long.' };
  return { type: 'register', region, server, ign };
}

/** Discord permission check from role bitfields. */
const PERM = { ADMINISTRATOR: 1n << 3n, MANAGE_GUILD: 1n << 5n };
function isAdmin({ member, guild }) {
  if (!member || !guild) return false;
  if (member.user && member.user.id === guild.owner_id) return true;
  const roles = new Map((guild.roles || []).map(r => [r.id, BigInt(r.permissions || '0')]));
  let p = roles.get(guild.id) || 0n; // @everyone
  for (const id of member.roles || []) p |= roles.get(id) || 0n;
  return (p & PERM.ADMINISTRATOR) !== 0n || (p & PERM.MANAGE_GUILD) !== 0n;
}

function topRolePosition(roleIds, guild) {
  const pos = new Map((guild.roles || []).map(r => [r.id, r.position]));
  return Math.max(0, ...(roleIds || []).map(id => pos.get(id) || 0));
}

const charKey = (region, server, ign) => `${region}|${server.toLowerCase()}|${clean(ign).toLowerCase()}`;

module.exports = {
  clean, isGood, parseId, parseApi, boostVerdict, mapLimit,
  cpShort, buildNick, parseCommand, isAdmin, topRolePosition, charKey,
};
