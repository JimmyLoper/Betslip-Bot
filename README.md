# Betslip Bot

A Discord bot for cappers to post, track, and settle bets. Supports AI-powered betslip scanning via Claude, manual entry, and multi-step ladder bets.

---

## Features

- **AI betslip scanning** — upload a screenshot and the bot parses bet details automatically (FanDuel, DraftKings, and more)
- **Manual bet entry** — enter description, risk, sport, and odds directly
- **Ladder bets** — post multi-step parlay ladders with per-step tracking
- **Settle workflow** — Win / Loss / Push buttons on each tracker message
- **Admin tools** — silently backfill bets, reset settled bets to pending

---

## Commands

| Command | Description |
|---|---|
| `/bet post` | Scan a betslip screenshot with AI and auto-create entries |
| `/bet manual` | Manually enter a bet with all details |
| `/bet edit` | Edit a previously posted bet message |
| `/betladder post` | Post a multi-step ladder bet |
| `/admin addbet` | Silently scan a betslip and add to tracker only (no public post) |
| `/admin resetbet` | Reset a settled bet back to pending |

---

## Setup

### 1. Install dependencies
```
npm install
```

### 2. Configure environment
Create a `.env` file in the project root:
```env
DISCORD_TOKEN=your_bot_token
APP_ID=your_application_id
GUILD_ID=your_guild_id
DATABASE_URL=your_postgres_connection_string
ANTHROPIC_API_KEY=your_anthropic_api_key
ADMIN_OVERRIDE_ID=discord_user_id_for_admin_commands
```

### 3. Set up the database
Run the table creation scripts in `utils/db.js` or your migration tool against the `DATABASE_URL` Postgres instance. The bot expects a `capper_info` table mapping Discord users to their tracker channels.

### 4. Deploy slash commands
```
npm run deploy
```

### 5. Start the bot
```
npm start
```

---

## Project Structure

```
commands/        Slash command handlers (bet, betladder, admin)
interactions/    Button and select menu handlers (settle, edit, delete, etc.)
utils/
  db.js          Postgres connection pool
  sbParsers.js   Claude system prompts for sportsbook-specific parsing
  calcPayout.js  Payout calculation helpers
  mapUnits.js    Maps unit strings to numeric values
  parseDescription.js  Parses raw description input from users
  pendingEdits.js / pendingOdds.js / pendingScans.js  In-memory state maps
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `discord.js` v14 | Discord API client |
| `pg` | PostgreSQL client |
| `@anthropic-ai/sdk` | Claude AI for betslip parsing |
| `dotenv` | Environment variable loading |
| `uuid` | Unique ID generation |
