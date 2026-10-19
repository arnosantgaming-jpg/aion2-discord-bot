// =====================================================================
//  Bot-wide defaults. Most things are changed per server with
//  "!gscs set ..." commands in Discord, so you rarely need to edit this.
// =====================================================================

module.exports = {
  prefix: '!gscs',

  // Channel names the bot looks for in each server (admins can override with commands).
  registerChannel: 'gscs-register',      // where members sign up and admins run commands
  leaderboardChannel: 'gscs-leaderboard', // where the live leaderboard message lives

  // Defaults for a server that hasn't changed anything yet.
  defaults: {
    nicknames: true,
    leaderboard: true,
    format: null,           // null = use `formats` below
  },

  // Region codes members can type, mapped to the game API region.
  regions: {
    as: 'as', asia: 'as',
    eu: 'eu', europe: 'eu',
    nae: 'nae', 'na-east': 'nae', naeast: 'nae', na: 'nae',
    naw: 'naw', 'na-west': 'naw', nawest: 'naw',
  },
  regionNames: { as: 'Asia', eu: 'Europe', nae: 'NA East', naw: 'NA West' },

  // Nickname formats: the first that fits Discord's 32-character limit is used.
  // {ign} {gs} {cp}=102,299 {cpk}=102.3k
  formats: [
    '{ign} | GS {gs} | CP {cp}',
    '{ign} | GS {gs} | CP {cpk}',
    '{ign} | {gs} | {cpk}',
  ],

  // Battleground filter: battleground mode boosts CP/GS a lot (e.g. 111k -> 300k).
  // A jump bigger than these ratios isn't saved until it has lasted holdHours. Drops always apply.
  boostFilter: {
    enabled: true,
    maxCpRatio: 1.5,
    maxGsRatio: 1.25,
    holdHours: 12,
    minLevel: 45,
  },

  // How far back to read the register channel the first time the bot sees a server.
  firstRunMessages: 50,

  // Request tuning
  apiConcurrency: 6,
  discordConcurrency: 3,
  retries: 3,
  timeoutMs: 15000,
};
