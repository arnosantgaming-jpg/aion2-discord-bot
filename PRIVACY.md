# Privacy Policy — AION 2 GS/CP bot

_Last updated: 19 October 2026_

This explains what the bot stores when it is added to a Discord server. "We" means whoever runs this
copy of the bot.

## What the bot stores

When you register with `!gscs`, the bot saves:

- your Discord user ID and the server ID you registered in;
- the region, game server and character name (IGN) you entered;
- that character's public game data: Gear Score, Combat Power, class, level, and when it was last updated;
- each server's bot settings (nicknames on/off, leaderboard channel, nickname format).

It does **not** store messages, usernames, emails, or anything else.

## Where it's stored

All of this is kept in one encrypted file in the bot's GitHub repository (on a branch called `state`).
It is encrypted with a key only the bot operator has, so even if the repository is public the contents
can't be read.

## How it's used

Only to show your character's Gear Score and Combat Power in your server nickname and on the server's
leaderboard. It is not sold, shared, or used for anything else. Game data comes from public AION 2
character information (NCSOFT's character site, located via Shugo.gg).

## What the bot reads

The bot reads messages only in the channel set up for sign-ups (#gscs-register by default), and only
acts on messages starting with `!gscs` or mentioning the bot. It reads member info (roles, nickname) only
for registered members, to rename them.

## Removing your data

- Post `!gscs remove` to delete your registration.
- If you leave the server, your registration is deleted automatically on the next run.
- Server admins can remove any registration with `!gscs remove @member`.
- If the bot is removed from a server, contact the bot operator to delete that server's data.

## Contact

Message the bot operator (the person or community that gave you the invite link).
