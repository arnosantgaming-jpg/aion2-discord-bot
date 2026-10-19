'use strict';
/**
 * One run of the bot (called every ~15 minutes by GitHub Actions):
 *   1. For every server: read new messages in the register channel and handle !gscs commands.
 *   2. Refresh GS/CP for every registered character (once per character, shared by all servers),
 *      with the battleground filter.
 *   3. For every server: update nicknames and the live leaderboard message.
 */
const cfg = require('../config');
const L = require('./lib');

const TEXT_CHANNELS = new Set([0, 5]); // text, announcement
const byId = (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
const fmt = n => (L.isGood(n) ? n.toLocaleString('en-US') : '—');

/** Full command list with examples, as a Discord embed. */
function commandsEmbed(p) {
  const line = (cmd, what, ex) => `**\`${cmd}\`**\n${what}\n↳ e.g. \`${ex}\``;
  return {
    title: '📖 GS/CP bot — all commands',
    color: 0xc9a227,
    description: `Post these in <#REG>. The bot answers within ~15 minutes.\nYou can also mention the bot instead of typing \`${p}\`.`,
    fields: [
      {
        name: '👤 Members',
        value: [
          line(`${p} <region> <server> <IGN>`, 'Register your main character (posting again replaces it).', `${p} as siel Arno`),
          line(`${p} remove`, 'Unregister yourself.', `${p} remove`),
          line(`${p} settings`, "Show this server's settings.", `${p} settings`),
          line(`${p} commands`, 'Show this list.', `${p} commands`),
        ].join('\n\n'),
      },
      {
        name: '🌏 Regions',
        value: '`as` Asia · `eu` Europe · `nae` NA East · `naw` NA West\nIGN capitals matter (`Arno` ≠ `arno`).',
      },
      {
        name: '🛠️ Admins (Manage Server)',
        value: [
          line(`${p} set nicknames on|off`, 'Rename members to IGN | GS | CP, or stop.', `${p} set nicknames on`),
          line(`${p} set leaderboard on|off|#channel`, 'Turn the live leaderboard on/off, or move it.', `${p} set leaderboard #rankings`),
          line(`${p} set format <text>`, 'Nickname format using {ign} {gs} {cp} {cpk}, or `default`.', `${p} set format {ign} [{cpk}]`),
          line(`${p} set register #channel`, 'Read sign-ups from another channel.', `${p} set register #sign-ups`),
          line(`${p} remove @member`, "Remove someone's registration.", `${p} remove @Zen`),
        ].join('\n\n'),
      },
    ],
    footer: { text: 'Nickname example: Arno | GS 2323 | CP 112,046' },
  };
}

function helpText(p) {
  return [
    '**AION 2 GS/CP tracker**',
    `• See every command with examples: \`${p} commands\``,
    `• Register your main: \`${p} <region> <server> <IGN>\` e.g. \`${p} as siel Arno\``,
    '  Regions: `as` (Asia), `eu` (Europe), `nae` (NA East), `naw` (NA West). Posting again replaces it.',
    `• Unregister: \`${p} remove\``,
    `• Current settings: \`${p} settings\``,
    '**Admins** (Manage Server):',
    `• \`${p} set nicknames on|off\` — rename members to IGN | GS | CP`,
    `• \`${p} set leaderboard on|off|#channel\` — live leaderboard message`,
    `• \`${p} set format <text>\` — nickname format with {ign} {gs} {cp} {cpk}, or \`default\``,
    `• \`${p} set register #channel\` — move sign-ups to another channel`,
    `• \`${p} remove @member\` — remove someone's registration`,
    'Changes are picked up every ~15 minutes.',
  ].join('\n');
}

function newGuild() {
  return {
    settings: { ...cfg.defaults },
    members: {},                 // userId -> { key, registeredAt }
    lastMessageId: null,
    registerChannelId: null,
    leaderboardChannelId: null,
    leaderboardMessageId: null,
  };
}

async function run({ discord, game, state, log = console.log, dryRun = false, now = Date.now() }) {
  const summary = { guilds: 0, commands: 0, registered: 0, refreshed: 0, held: 0, renamed: 0, leaderboards: 0, problems: [] };
  const me = await discord.me();
  if (!discord.ok(me)) throw new Error('Discord rejected the bot token (HTTP ' + me.status + '). Check the DISCORD_TOKEN secret.');
  const botId = me.data.id;
  const guilds = await discord.guilds();
  log(`Bot ${me.data.username} is in ${guilds.length} server(s)${dryRun ? ' (DRY RUN)' : ''}`);

  // ------------------------------------------------ phase 1: commands
  const ctx = [];
  for (const gl of guilds) {
    const g = state.guilds[gl.id] = state.guilds[gl.id] || newGuild();
    g.settings = { ...cfg.defaults, ...g.settings };
    const tag = `[${gl.name}]`;
    try {
      const [gi, ch] = await Promise.all([discord.guild(gl.id), discord.channels(gl.id)]);
      if (!discord.ok(gi) || !discord.ok(ch)) throw new Error(`can't read server info (HTTP ${gi.status}/${ch.status})`);
      const guild = gi.data, channels = ch.data.filter(c => TEXT_CHANNELS.has(c.type));
      const find = (id, name) => channels.find(c => c.id === id) || channels.find(c => c.name === name);
      const reg = find(g.registerChannelId, cfg.registerChannel);
      ctx.push({ gl, g, guild, channels, find, tag });
      summary.guilds++;
      if (!reg) { log(`${tag} no #${cfg.registerChannel} channel yet, skipping sign-ups`); continue; }
      g.registerChannelId = reg.id;
      const n = await handleCommands({ discord, game, state, g, guild, reg, channels, botId, tag, log, dryRun, now, summary });
      if (n) log(`${tag} handled ${n} command(s)`);
    } catch (err) {
      summary.problems.push(`${gl.name}: ${err.message}`);
      log(`${tag} ❌ ${err.message}`);
    }
  }

  // ------------------------------------------------ phase 2: refresh characters
  const used = new Set();
  for (const g of Object.values(state.guilds)) for (const m of Object.values(g.members)) used.add(m.key);
  for (const k of Object.keys(state.chars)) if (!used.has(k)) delete state.chars[k];   // forget unused
  const keys = [...used].filter(k => state.chars[k]);
  log(`Refreshing ${keys.length} character(s)`);
  await L.mapLimit(keys, cfg.apiConcurrency, async key => {
    const c = state.chars[key];
    const r = await refreshChar({ game, c, now, log });
    if (r === 'ok') summary.refreshed++;
    if (r === 'held') summary.held++;
  });

  // ------------------------------------------------ phase 3: nicknames + leaderboard
  for (const x of ctx) {
    try {
      await updateGuild({ discord, state, botId, ...x, log, dryRun, now, summary });
    } catch (err) {
      summary.problems.push(`${x.gl.name}: ${err.message}`);
      log(`${x.tag} ❌ ${err.message}`);
    }
  }
  return summary;
}

// ---------------------------------------------------------------- commands

async function handleCommands({ discord, game, state, g, guild, reg, channels, botId, tag, log, dryRun, now, summary }) {
  // Read new messages (oldest first).
  let msgs = [];
  if (g.lastMessageId) {
    let after = g.lastMessageId;
    for (let page = 0; page < 10; page++) {
      const r = await discord.messages(reg.id, `limit=100&after=${after}`);
      if (!discord.ok(r)) throw new Error(`can't read #${reg.name} (HTTP ${r.status}). Give the bot View Channel + Read Message History there.`);
      if (!r.data.length) break;
      msgs.push(...r.data);
      after = r.data.reduce((a, m) => (BigInt(m.id) > BigInt(a) ? m.id : a), after);
      if (r.data.length < 100) break;
    }
  } else {
    const r = await discord.messages(reg.id, `limit=${cfg.firstRunMessages}`);
    if (!discord.ok(r)) throw new Error(`can't read #${reg.name} (HTTP ${r.status}). Give the bot View Channel + Read Message History there.`);
    msgs = r.data;
  }
  msgs.sort(byId);
  if (!msgs.length) return 0;

  let handled = 0, emptyContent = 0;
  for (const m of msgs) {
    g.lastMessageId = m.id;
    if (!m.author || m.author.bot) continue;
    if (!m.content && !(m.attachments || []).length) emptyContent++;
    const cmd = L.parseCommand(m.content, { prefix: cfg.prefix, botId, regions: cfg.regions });
    if (!cmd) continue;
    handled++; summary.commands++;
    const say = async (text, emoji, embeds) => {
      if (dryRun) { log(`${tag}   (dry run) reply to ${m.author.username}: ${(text || embeds[0].title).split('\n')[0]}`); return; }
      await discord.reply(reg.id, m.id, text, embeds);
      if (emoji) await discord.react(reg.id, m.id, emoji);
    };
    try {
      await handleOne({ discord, game, state, g, guild, channels, m, cmd, say, tag, log, now, summary });
    } catch (err) {
      log(`${tag}   ⚠️ command from ${m.author.username} failed: ${err.message}`);
      await say('⚠️ Something went wrong handling that. Please try again later.', '⚠️');
    }
  }
  if (emptyContent >= 3 && !handled) {
    log(`${tag} ⚠️ messages arrive with no text: turn on "Message Content Intent" in the Discord Developer Portal (Bot page), ` +
        'or members can mention the bot instead of typing the prefix.');
  }
  return handled;
}

async function needAdmin({ discord, guild, m, say }) {
  const mem = m.member ? { ...m.member, user: m.author } : (await discord.member(guild.id, m.author.id)).data;
  if (L.isAdmin({ member: mem, guild })) return true;
  await say('❌ Only members with **Manage Server** can do that.', '❌');
  return false;
}

async function handleOne({ discord, game, state, g, guild, channels, m, cmd, say, tag, log, now, summary }) {
  const p = cfg.prefix;
  switch (cmd.type) {
    case 'help': return say(helpText(p));
    case 'commands': {
      const e = commandsEmbed(p);
      e.description = e.description.replace('<#REG>', `<#${g.registerChannelId}>`);
      return say(null, null, [e]);
    }
    case 'error': return say('❌ ' + cmd.error, '❌');

    case 'settings': {
      const s = g.settings;
      const lb = channels.find(c => c.id === g.leaderboardChannelId) || channels.find(c => c.name === cfg.leaderboardChannel);
      return say([
        '**Settings**',
        `• Nicknames: **${s.nicknames ? 'on' : 'off'}**`,
        `• Leaderboard: **${s.leaderboard ? 'on' : 'off'}**${lb ? ` in <#${lb.id}>` : ` (no #${cfg.leaderboardChannel} channel found)`}`,
        `• Nickname format: \`${s.format || cfg.formats[0]}\``,
        `• Registered members: **${Object.keys(g.members).length}**`,
      ].join('\n'));
    }

    case 'remove': {
      const target = cmd.target || m.author.id;
      if (cmd.target && cmd.target !== m.author.id && !(await needAdmin({ discord, guild, m, say }))) return;
      if (!g.members[target]) return say(cmd.target ? `<@${target}> isn't registered.` : "You aren't registered.", '❌');
      delete g.members[target];
      log(`${tag}   removed registration for ${target}`);
      return say(`✅ Removed ${cmd.target ? `<@${target}>'s` : 'your'} registration. (The current nickname stays until changed by hand.)`, '✅');
    }

    case 'set': {
      if (!(await needAdmin({ discord, guild, m, say }))) return;
      const v = cmd.value.trim(), lv = v.toLowerCase();
      const onoff = lv === 'on' || lv === 'true' || lv === 'yes' ? true : lv === 'off' || lv === 'false' || lv === 'no' ? false : null;
      const chan = (v.match(/^<#(\d+)>$/) || [])[1];
      if (cmd.key === 'nicknames' || cmd.key === 'nickname') {
        if (onoff === null) return say('❌ Use `on` or `off`.', '❌');
        g.settings.nicknames = onoff;
        return say(`✅ Nicknames turned **${onoff ? 'on' : 'off'}**.`, '✅');
      }
      if (cmd.key === 'leaderboard') {
        if (chan) {
          if (!channels.find(c => c.id === chan)) return say("❌ I can't see that channel.", '❌');
          g.leaderboardChannelId = chan; g.leaderboardMessageId = null; g.settings.leaderboard = true;
          return say(`✅ Leaderboard will be posted in <#${chan}>.`, '✅');
        }
        if (onoff === null) return say('❌ Use `on`, `off` or a #channel.', '❌');
        g.settings.leaderboard = onoff;
        return say(`✅ Leaderboard turned **${onoff ? 'on' : 'off'}**.`, '✅');
      }
      if (cmd.key === 'format') {
        if (lv === 'default' || lv === 'reset') { g.settings.format = null; return say('✅ Nickname format reset to default.', '✅'); }
        if (!v.includes('{ign}')) return say('❌ The format must include `{ign}`. You can also use `{gs}`, `{cp}`, `{cpk}`.', '❌');
        g.settings.format = v.slice(0, 64);
        const sample = L.buildNick('Arno', 2323, 112046, [g.settings.format, ...cfg.formats.slice(1)]);
        return say(`✅ Nickname format set. Example: \`${sample}\``, '✅');
      }
      if (cmd.key === 'register') {
        if (!chan || !channels.find(c => c.id === chan)) return say('❌ Mention a channel I can see, e.g. `#sign-ups`.', '❌');
        g.registerChannelId = chan; g.lastMessageId = null;
        return say(`✅ Sign-ups will be read from <#${chan}> from now on.`, '✅');
      }
      return say('❌ Unknown setting. Use `nicknames`, `leaderboard`, `format` or `register`.', '❌');
    }

    case 'register': {
      const key = L.charKey(cmd.region, cmd.server, cmd.ign);
      const owner = Object.entries(g.members).find(([uid, r]) => r.key === key && uid !== m.author.id);
      if (owner) return say(`❌ **${cmd.ign}** is already registered by <@${owner[0]}>. Ask an admin if that's wrong.`, '❌');

      let c = state.chars[key];
      if (!c) {
        const found = await game.lookup(cmd.region, cmd.server, cmd.ign);
        if (found === 'notfound') {
          return say(`❌ Couldn't find **${cmd.ign}** on **${cmd.server}** (${cfg.regionNames[cmd.region]}). ` +
            'Check the spelling, capitals and server.', '❌');
        }
        if (found.error) return say(`⚠️ Couldn't reach the character database right now (${found.error}). Please try again later.`, '⚠️');
        c = { region: cmd.region, server: cmd.server, ign: cmd.ign, ref: found.ref, status: 'new' };
      }
      const st = await game.stats(cmd.region, c.ref);
      if (st && st.cp !== undefined) {
        Object.assign(c, { gs: st.gs, cp: st.cp, level: st.level, cls: st.cls, name: st.name || c.ign, updatedAt: now, status: 'ok', pending: null });
      }
      state.chars[key] = c;
      g.members[m.author.id] = { key, registeredAt: now };
      summary.registered++;
      log(`${tag}   registered ${m.author.username} -> ${c.name || c.ign} (${cmd.server})`);
      const statsLine = L.isGood(c.cp) ? ` — ${c.cls ? c.cls + ' · ' : ''}GS **${fmt(c.gs)}** · CP **${fmt(c.cp)}**` : '';
      return say(`✅ Registered **${c.name || c.ign}** (${cmd.server}, ${cfg.regionNames[cmd.region]})${statsLine}. ` +
        'Your nickname and the leaderboard update on the next run.', '✅');
    }
  }
}

// ---------------------------------------------------------------- refresh

async function refreshChar({ game, c, now, log }) {
  let st = await game.stats(c.region, c.ref);
  if (st === 'stale') {                       // character recreated/renamed: look up again once
    const found = await game.lookup(c.region, c.server, c.ign);
    if (found === 'notfound') { c.status = 'notfound'; return 'notfound'; }
    if (found.error) return 'error';
    c.ref = found.ref;
    st = await game.stats(c.region, c.ref);
  }
  if (!st || st === 'stale' || st.error) return 'error';
  if (st.name && st.name.toLowerCase() !== L.clean(c.ign).toLowerCase()) { c.status = 'notfound'; return 'notfound'; }

  const v = L.boostVerdict({ prev: { gs: c.gs, cp: c.cp }, now: st, held: c.pending, at: now, f: cfg.boostFilter });
  if (v.action === 'hold') {
    if (!c.pending) c.pending = { gs: st.gs, cp: st.cp, firstSeen: now };
    log(`   ⏸️ ${c.name || c.ign}: CP ${fmt(c.cp)} → ${fmt(st.cp)}, GS ${fmt(c.gs)} → ${fmt(st.gs)} looks like a battleground boost; holding`);
    return 'held';
  }
  Object.assign(c, { gs: st.gs, cp: st.cp, level: st.level, cls: st.cls, name: st.name || c.ign, updatedAt: now, status: 'ok', pending: null });
  return 'ok';
}

// ---------------------------------------------------------------- nicknames + leaderboard

async function updateGuild({ discord, state, botId, gl, g, guild, find, tag, log, dryRun, now, summary }) {
  const entries = Object.entries(g.members);
  if (!entries.length) return;
  const formats = g.settings.format ? [g.settings.format, ...cfg.formats.slice(1)] : cfg.formats;

  const botMember = g.settings.nicknames ? await discord.member(gl.id, botId) : null;
  const botTop = botMember && discord.ok(botMember) ? L.topRolePosition(botMember.data.roles, guild) : 0;

  const rows = [], blocked = [];
  let renamed = 0;
  await L.mapLimit(entries, cfg.discordConcurrency, async ([uid, reg]) => {
    const c = state.chars[reg.key];
    if (!c || !L.isGood(c.cp)) return;
    const mr = await discord.member(gl.id, uid);
    if (mr.status === 404) { delete g.members[uid]; log(`${tag}   ${uid} left the server; registration removed`); return; }
    if (!discord.ok(mr)) return;
    const member = mr.data;
    rows.push({ uid, c });
    if (!g.settings.nicknames || c.status !== 'ok') return;
    if (uid === guild.owner_id) { blocked.push(member.user.username + ' (owner)'); return; }
    if (L.topRolePosition(member.roles, guild) >= botTop) { blocked.push(member.user.username + ' (role above bot)'); return; }
    const nick = L.buildNick(c.name || c.ign, c.gs, c.cp, formats);
    if (member.nick === nick) return;
    if (dryRun) { log(`${tag}   (dry run) ${member.user.username} → "${nick}"`); renamed++; return; }
    const r = await discord.setNick(gl.id, uid, nick);
    if (discord.ok(r)) { renamed++; } else { log(`${tag}   ❌ rename ${member.user.username}: HTTP ${r.status} ${(r.data && r.data.message) || ''}`); }
  });
  summary.renamed += renamed;
  if (renamed) log(`${tag} renamed ${renamed} member(s)`);
  if (blocked.length) log(`${tag} can't rename (Discord doesn't allow it): ${blocked.join(', ')}`);

  if (!g.settings.leaderboard) return;
  const ch = find(g.leaderboardChannelId, cfg.leaderboardChannel);
  if (!ch) { log(`${tag} leaderboard on but no #${cfg.leaderboardChannel} channel; skipping`); return; }
  g.leaderboardChannelId = ch.id;
  const body = { embeds: leaderboardEmbeds(rows, gl.name, now), allowed_mentions: { parse: [] } };
  if (dryRun) { log(`${tag}   (dry run) leaderboard with ${rows.length} member(s) in #${ch.name}`); return; }
  let r = g.leaderboardMessageId ? await discord.edit(ch.id, g.leaderboardMessageId, body) : { status: 404 };
  if (r.status === 404) {
    r = await discord.send(ch.id, body);
    if (discord.ok(r)) g.leaderboardMessageId = r.data.id;
  }
  if (discord.ok(r)) summary.leaderboards++;
  else log(`${tag} ❌ leaderboard: HTTP ${r.status} ${(r.data && r.data.message) || ''} (bot needs Send Messages + Embed Links in #${ch.name})`);
}

function leaderboardEmbeds(rows, guildName, now) {
  rows.sort((a, b) => (b.c.cp - a.c.cp) || ((b.c.gs || 0) - (a.c.gs || 0)));
  const lines = rows.map((r, i) =>
    `\`${String(i + 1).padStart(2)}.\` **${r.c.name || r.c.ign}** · ${r.c.cls || '?'} · GS ${fmt(r.c.gs)} · CP **${fmt(r.c.cp)}** · <@${r.uid}>`);
  if (!lines.length) lines.push(`Nobody registered yet. Use \`${cfg.prefix} <region> <server> <IGN>\` in #${cfg.registerChannel}.`);
  const chunks = [];
  let cur = '';
  for (const line of lines) {
    if ((cur + '\n' + line).length > 3900) { chunks.push(cur); cur = line; } else cur = cur ? cur + '\n' + line : line;
  }
  if (cur) chunks.push(cur);
  const embeds = chunks.slice(0, 10).map((d, i) => ({ description: d, color: 0xc9a227, ...(i === 0 ? { title: `🏆 ${guildName} — Combat Power` } : {}) }));
  embeds[embeds.length - 1].footer = { text: `${rows.length} registered · updated every ~15 min` };
  embeds[embeds.length - 1].timestamp = new Date(now).toISOString();
  return embeds;
}

module.exports = { run, helpText, commandsEmbed, leaderboardEmbeds, refreshChar };
