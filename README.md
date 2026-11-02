# 𝑫𝑹𝑨𝑮𝑶𝑵 𝑹𝑰𝑺𝑬 — Bot Controller & Music Swarm

A high-performance Discord multi-bot controller and synchronized audio system.

---

## 📚 Installation & Setup

1. **Prerequisites**: [Node.js (v18+)](https://nodejs.org/en/) and FFmpeg.
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure bot tokens**:
   Add your bot tokens and Owner IDs into [config.json](file:///c:/Users/HP/Downloads/FLEXY/ganil/config.json) or `tokens.txt`:
   ```json
   {
       "prefix": ".",
       "ownerid": ["1527609131043917874"],
       "tokens": ["BOT_TOKEN_1", "BOT_TOKEN_2"],
       "trustedAdmins": []
   }
   ```
4. **Start the bots**:
   Run `start.bat` or:
   ```bash
   npm start
   ```

---

## 🎨 Bot Profile & Customization Commands (BP)

- `.bp` — Show bot profile overview (display name, username, bio, avatar, banner status).
- `.bp avatar <URL or attach image>` (or `.setavatar`) — Change bot avatar across all bots and save to `bot-avatar.png`.
- `.bp banner <URL or attach image>` (or `.setbanner`) — Change bot banner across all bots and save to `bot-banner.png`.
- `.bp bio <text>` (or `.setbio`) — Change bot bio / about me description across all bots.
- `.bp username <new_username>` (or `.setusername`) — Change bot account username across all bots (rate-limited by Discord to 2 changes/hour).
- `.bp name <new_display_name>` (or `.setname`) — Change global display name and server nicknames across all bots and guilds.

---

## ⚡ Multi-Bot Swarm & Controller Commands

- `.say <message>` — Make all bots repeat the message in the current text channel.
- `.relay <channel_id_or_name> <message>` — Send text to a specific text channel.
- `.follow <target>` — Make all bots follow the target across voice channels (auto-moves bots when target switches VC). Use `.follow stop` to disable.
- `.stop` — Make all bots stop their current action (stops playback, clears queue, cancels follow mode, terminates channel spam and DM spam).
- `.stopspam` / `.stop_spam` — Stop normal channel spam actions.
- `.stopdm` / `.stop_dm` — Stop DM spam actions.
- `.jump` — Make all bots perform a synchronized voice jump action.
- `.spam <count> <message>` — Make all bots spam messages in the channel (rate-limited safely, cancelable anytime with `.stopspam` or `.stop`).
- `.dmspam <user_id> <count> <message>` — Send a personal DM to a user a set number of times across all bots.

---

## 🎶 Voice & Music Playback Commands

- `.join` / `.leave` — Join or leave a voice channel.
- `.play <song or URL>` (or `.p`) — High-performance music playback (YouTube search & URLs, SoundCloud, direct URLs) across all bots in the swarm.
- `.pause` / `.resume` / `.skip` — Control synchronized playback.
- `.volume <0-10000>` (or `.v`, `.vol`) — Adjust synchronized audio volume (0% to 10,000% / 100x amplification).
- `.gain <0-60>` — Adjust digital output gain (0 to +60 dB).
- `.bass <0-60>` (or `.bb`) — Adjust sub-bass boost level (0 to +60 dB).
- `.boost` / `.maxvol` — Instant maximum volume preset (2500% Volume, +30dB Gain, +24dB Bass).
- `.earrape` — Extreme loudness mode (10,000% Volume, +50dB Gain, +40dB Bass).
- `.boost reset` — Reset audio to standard clean studio levels.

---

## 📊 System & Status Commands

- `.status` — Show real-time connection status, gateway ping (ms), voice channel, and guild count for each bot instance.
- `.botinfo` — Show bot details and current runtime status.
- `.help` — Display list of all available commands.

---

## 👑 Owner Only Commands

- `.trust <user_id>` — Add a user as trusted admin.
- `.untrust <user_id>` — Remove a user from trusted admins.
- `.trusted` — Show owner and trusted admins list.
