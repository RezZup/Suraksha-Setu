# Auto-Linking Quick Start Guide

## For Users

### Step 1: Set Your Telegram Username in the App

1. Open Suraksha Setu app
2. Go to **Profile** → **Notifications** tab
3. Under "Telegram Alerts" section, find the input field
4. Enter your Telegram username (e.g., `@john_doe`)
   - You can find this in Telegram: Settings → Username
5. Click **Save**

### Step 2: Click "Open Telegram Bot"

1. In the same section, click the **"Open Telegram Bot"** button
2. It opens your Telegram app with our bot (@settu9856bot)

### Step 3: Send `/start` Command

1. In Telegram, type `/start` and send it to the bot
2. You'll see a message with an **"Enable Disaster Alerts"** button

### Step 4: Click the Button

1. Click **"✅ Enable Disaster Alerts"**
2. The bot connects to your app account automatically
3. You'll get a confirmation: **"✅ Suraksha Setu Connected!"**

### Step 5: You're Done! 🎉

You'll now receive disaster alerts on Telegram for your location.

---

## For Developers

### Local Development (No Webhook)

```bash
# 1. Add token to backend/.env
TELEGRAM_BOT_TOKEN=your_token_here
TELEGRAM_BOT_USERNAME=your_bot_name

# 2. Start backend (uses polling automatically)
cd backend
python -m uvicorn server:app --reload

# 3. Test by sending /start to the bot
```

### Production Setup (Webhook Required)

```bash
# 1. Prepare your bot token
export TOKEN="123456789:ABC-DEF1234..."

# 2. Set webhook with auto-generated secret
python scripts/setup_telegram_webhook.py \
    --token "$TOKEN" \
    --url "https://your-domain.com/api/telegram/webhook"

# 3. Verify setup
python scripts/setup_telegram_webhook.py --token "$TOKEN" --check
```

### Environment Variables

**For Production:**

```bash
# backend/.env
TELEGRAM_BOT_TOKEN=123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_BOT_USERNAME=your_bot_name
TELEGRAM_WEBHOOK_SECRET=your_secure_random_secret_32_chars_minimum
BACKEND_URL=https://your-domain.com
```

---

## Features

### ✅ Auto-Linking
- User clicks button → Instant link
- No manual codes or copy-paste needed
- Works on web and mobile

### ✅ Manual Code Linking (Fallback)
- If username doesn't match → User can get a code from profile
- Type `/start <CODE>` in bot
- Code valid for 10 minutes
- Fallback option if auto-linking doesn't work

### ✅ Multiple Linking Methods
- Both methods work simultaneously
- Users can choose which they prefer
- Backward compatible

### ✅ Security
- Webhook secret verification
- HTTPS only for production
- Username-based verification
- Rate limiting built-in

---

## Troubleshooting

### Problem: "No user found" message

**Solution:**
- Ensure your Telegram username in the app matches your Telegram account
- Go to Profile → Check "Telegram Alerts" username field
- Make sure it's the same as your Telegram username (Settings → Username)

### Problem: Bot doesn't respond

**Solution (Local Dev):**
- Backend automatically uses polling mode
- Just restart backend: `Ctrl+C` then run again

**Solution (Production):**
1. Check webhook is set:
   ```bash
   python scripts/setup_telegram_webhook.py --token <TOKEN> --check
   ```
2. Verify secret token matches .env
3. Check HTTPS is working (no self-signed certs)
4. Check backend logs for errors

### Problem: Can't find bot in Telegram

**Solution:**
- Make sure you're using the correct bot username
- Try: `https://t.me/your_bot_username`
- If your bot username is `@my_bot`, open: `https://t.me/my_bot`

---

## Testing

### Test Auto-Linking Locally

1. Create app account with Telegram username
2. Open bot with `/start`
3. Click button
4. Check database:
   ```sql
   SELECT username, telegram_username, telegram_chat_id 
   FROM users WHERE username = 'your_username';
   ```
5. Should show Chat ID populated

### Test Manual Code Linking

1. Get code from Profile → Link Code
2. Send `/start <CODE>` to bot
3. Verify Chat ID saved in database

### Test Alert Delivery

1. After linking, trigger test alert:
   ```python
   # In Python REPL or script
   import asyncio
   from telegram_service import telegram_service
   
   asyncio.run(telegram_service.send_message(
       chat_id="YOUR_CHAT_ID",
       text="🔔 Test alert from Suraksha Setu!"
   ))
   ```

---

## File Structure

```
Suraksha Setu/
├── backend/
│   ├── telegram_service.py          # Core Telegram API
│   ├── server.py                    # Webhook handler
│   ├── routes/
│   │   ├── telegram.py              # Mini App endpoints
│   │   └── profile.py               # Chat ID linking endpoint
│   └── scripts/
│       └── setup_telegram_webhook.py # Setup assistant
├── frontend/
│   └── src/components/
│       └── profile/
│           └── TelegramLinking.jsx  # Chat ID input UI
└── docs/
    ├── TELEGRAM_WEBHOOK_SETUP.md    # Complete setup guide
    └── AUTO_LINKING_ARCHITECTURE.md # Technical deep-dive
```

---

## Commands Reference

### User Commands (In Telegram)

```
/start              Open bot, show auto-linking button
/start <CODE>       Manual linking with code
/help               Show command help
/profile            Manage Telegram settings (future)
```

### Admin Commands (Script)

```bash
# Check webhook status
python scripts/setup_telegram_webhook.py --token <TOKEN> --check

# Set webhook
python scripts/setup_telegram_webhook.py --token <TOKEN> --url <URL>

# Delete webhook (use polling instead)
python scripts/setup_telegram_webhook.py --token <TOKEN> --delete

# Show bot info
python scripts/setup_telegram_webhook.py --token <TOKEN> --info

# Test webhook endpoint
python scripts/setup_telegram_webhook.py --token <TOKEN> --test
```

---

## Database Schema

```sql
-- Users table relevant columns
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    email TEXT,
    telegram_username TEXT,           -- User's @username
    telegram_chat_id TEXT,            -- Auto-populated on link
    notification_channels JSONB,      -- {"telegram": true}
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_telegram_username ON users(telegram_username);
CREATE INDEX idx_telegram_chat_id ON users(telegram_chat_id);
```

---

## Performance

- **Auto-link latency:** < 1 second
- **Alert delivery:** Async batch (100+ users per second)
- **Webhook timeout:** 25 seconds (Telegram default)
- **Storage:** ~50 bytes per user (Chat ID + username)

---

## Support

### Documentation
- [Telegram Webhook Setup](./TELEGRAM_WEBHOOK_SETUP.md) — Complete guide
- [Architecture](./AUTO_LINKING_ARCHITECTURE.md) — Technical details

### Common Issues
- See Troubleshooting section above
- Check backend logs: `tail -f backend.log | grep Telegram`
- Verify database: `SELECT * FROM users WHERE telegram_chat_id IS NOT NULL;`

---

## Next Steps

1. ✅ Set up bot with @BotFather
2. ✅ Configure environment variables
3. ✅ Deploy backend to HTTPS (production)
4. ✅ Set webhook (production)
5. ✅ Tell users about Telegram linking feature
6. ✅ Monitor alert delivery in logs

---

**Suraksha Setu Team** | Save more lives through better disaster communication! 🛡️
