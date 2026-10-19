# AION 2 GS/CP Discord bot

A free Discord bot that tracks your community's AION 2 **Gear Score** and **Combat Power**.
Members register their main character with one message; the bot keeps their **nickname** and a
**live leaderboard** up to date using NCSOFT's official character data.

- No Google Sheets, no server to run: it runs on **GitHub Actions** every 15 minutes.
- One bot can serve many Discord servers; every server has its own members and settings.
- Battleground boosts are filtered out automatically (huge temporary CP/GS jumps are ignored).
- Registrations are stored **encrypted** in the repo, so a public repo doesn't expose anyone.

> Because it runs on a schedule, the bot answers within **about 15 minutes**, not instantly.

---

## For members

In the **#gscs-register** channel:

| Message | What it does |
|---|---|
| `!gscs <region> <server> <IGN>` | Register (or change) your main, e.g. `!gscs as siel Arno` |
| `!gscs remove` | Unregister yourself |
| `!gscs settings` | Show this server's settings |
| `!gscs commands` | Show every command with examples (also `!gscs cmds` / `!gscs list`) |
| `!gscs help` | Short help |

Regions: `as` (Asia), `eu` (Europe), `nae` (NA East), `naw` (NA West). IGN capitals matter.
The bot replies ✅ with your GS/CP (or ❌ with the reason). Your nickname becomes e.g.
`Arno | GS 2323 | CP 112,046` and you appear on the leaderboard.

## For server admins

Anyone with **Manage Server** can run these in #gscs-register:

| Message | What it does |
|---|---|
| `!gscs set nicknames on` / `off` | Rename members to IGN + GS + CP, or stop |
| `!gscs set leaderboard on` / `off` | Show or stop the live leaderboard |
| `!gscs set leaderboard #channel` | Post the leaderboard in another channel |
| `!gscs set format {ign} [{cpk}]` | Custom nickname format (`{ign}` `{gs}` `{cp}` `{cpk}`), or `default` |
| `!gscs set register #channel` | Read sign-ups from another channel |
| `!gscs remove @member` | Remove someone's registration |

### Adding the bot to your server

1. Open the bot's invite link (from whoever runs the bot) and pick your server.
2. Create two text channels: **#gscs-register** and **#gscs-leaderboard**.
3. **Server Settings → Roles**: drag the bot's role **above** your members' roles
   (Discord only lets a bot rename people below it; it can never rename the server owner).
4. Post `!gscs commands` in #gscs-register. The bot answers on its next run with every command and an example of each.

---

## Running your own copy (about 15 minutes)

### 1. Create the Discord bot

1. <https://discord.com/developers/applications> → **New Application** → name it.
2. **Bot** page:
   - **Reset Token** → copy it (shown once; keep it private).
   - Turn on **Message Content Intent** → **Save**. (Needed to read `!gscs` messages.
     Members can also mention the bot instead, e.g. `@GS Tracker as siel Arno`, which works without it.)
3. **General Information** → copy the **Application ID**.
4. Your invite link (replace `APP_ID`):
   ```
   https://discord.com/oauth2/authorize?client_id=APP_ID&scope=bot&permissions=134302784
   ```
   Permissions: View Channels, Send Messages, Embed Links, Read Message History, Add Reactions, Manage Nicknames.

### 2. Create the GitHub repo

1. Click **Use this template** (or fork / upload these files) to make your own **public** repo.
   Public repos get unlimited free Actions minutes; a private repo would run out at a 15-minute schedule.
2. Make sure `.github/workflows/bot.yml` is included.

### 3. Add two secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `DISCORD_TOKEN` | the bot token from step 1 |
| `STATE_KEY` | a long random password (30+ characters) you make up, e.g. from a password manager |

`STATE_KEY` encrypts the saved registrations. **Keep a copy somewhere safe**: if it's lost or changed,
the bot can't read its saved data and stops (it never overwrites it), and you'd have to start fresh by
deleting the `state` branch.

### 4. Turn it on

1. **Actions** tab → enable workflows if asked.
2. **GS/CP bot → Run workflow**, tick **Dry run** → check the log looks right.
3. Run it again without Dry run. From then on it runs every 15 minutes by itself.

---

## How it works

Every run:
1. For each server, reads new messages in #gscs-register and handles `!gscs` commands.
2. Refreshes every registered character's GS/CP from NCSOFT (looked up once via Shugo.gg, then cached).
3. Updates nicknames (if on) and edits the leaderboard message (if on).
4. Saves its memory, encrypted, to the `state` branch (always a single commit).

**Battleground filter:** a jump of more than +50% CP or +25% GS is held, not saved, until it has lasted
12 hours (battleground boosts are temporary). Drops always apply. Tune in `config.js` → `boostFilter`.

## Limits and good to know

- Answers take up to ~15 minutes (plus GitHub's occasional schedule delays).
- Members who leave the server are removed automatically.
- GitHub pauses scheduled workflows in repos with no activity for 60 days; re-enable from the Actions tab.
- GitHub Actions is meant for running a project's own automation. A small community bot is fine; if your
  public bot grows large, consider moving it to a dedicated host.
- The bot only reads the register channel and only changes nicknames and its own messages.
  See [PRIVACY.md](PRIVACY.md) and [TERMS.md](TERMS.md).

## Troubleshooting

| Log says | Fix |
|---|---|
| `Discord rejected the bot token` | Re-copy the token into `DISCORD_TOKEN` |
| `Missing secret(s)` | Add `DISCORD_TOKEN` and `STATE_KEY` |
| `Could not decrypt … wrong STATE_KEY?` | Put back the original `STATE_KEY` (or delete the `state` branch to start over) |
| `no #gscs-register channel yet` | Create the channel, or `!gscs set register #channel` |
| `messages arrive with no text` | Turn on **Message Content Intent** (setup step 1.2) |
| `can't read #…` | Give the bot View Channel + Read Message History in that channel |
| `can't rename … (role above bot)` | Move the bot's role higher in Server Settings → Roles |
| `leaderboard: HTTP 403` | Give the bot Send Messages + Embed Links in the leaderboard channel |

## Development

```bash
npm test                                   # no dependencies needed (Node 20+)
DISCORD_TOKEN=... STATE_KEY=... DRY_RUN=1 node src/index.js
```

MIT licensed.
