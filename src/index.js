'use strict';
/**
 * Entry point for GitHub Actions.
 * Env:
 *   DISCORD_TOKEN  bot token (required)
 *   STATE_KEY      long random password that encrypts the saved registrations (required)
 *   STATE_FILE     where the encrypted state lives (default state/state.enc)
 *   DRY_RUN=1      read and fetch everything, but don't reply, rename, post or save
 */
const fs = require('fs');
const State = require('./state');
const { createDiscord } = require('./discord');
const game = require('./game');
const { run } = require('./bot');

(async () => {
  const t0 = Date.now();
  const token = process.env.DISCORD_TOKEN, key = process.env.STATE_KEY;
  const file = process.env.STATE_FILE || 'state/state.enc';
  const dryRun = process.env.DRY_RUN === '1';
  const missing = [!token && 'DISCORD_TOKEN', !key && 'STATE_KEY'].filter(Boolean);
  if (missing.length) throw new Error('Missing secret(s): ' + missing.join(', '));

  const state = State.load(file, key);
  console.log(`===== AION 2 GS/CP bot ${new Date().toISOString()} =====`);
  const s = await run({ discord: createDiscord(token, console.log), game, state, log: console.log, dryRun });
  if (!dryRun) State.save(file, state, key);

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`===== DONE in ${secs}s: ${s.guilds} server(s) | ${s.commands} command(s), ${s.registered} new registration(s) | ` +
    `${s.refreshed} refreshed, ${s.held} held (battleground?) | ${s.renamed} renamed | ${s.leaderboards} leaderboard(s) =====`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### AION 2 GS/CP bot${dryRun ? ' (dry run)' : ''}\n\n| Servers | Commands | New sign-ups | Refreshed | Held | Renamed | Leaderboards | Time |\n|---|---|---|---|---|---|---|---|\n` +
      `| ${s.guilds} | ${s.commands} | ${s.registered} | ${s.refreshed} | ${s.held} | ${s.renamed} | ${s.leaderboards} | ${secs}s |\n` +
      (s.problems.length ? `\n**Problems:**\n${s.problems.map(p => '- ' + p).join('\n')}\n` : ''));
  }
})().catch(err => {
  console.error('❌ FATAL:', err.message || err);
  process.exit(1);
});
