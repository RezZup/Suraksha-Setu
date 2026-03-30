# Telegram Bot Webhook Setup Guide

## Overview

This guide explains how to set up a **production-ready** Telegram bot webhook for Suraksha Setu. Webhooks allow real-time communication between Telegram and your backend, enabling automatic user linking and message handling.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [Step-by-Step Setup](#step-by-step-setup)
4. [Auto-Linking Flow](#auto-linking-flow)
5. [Security Best Practices](#security-best-practices)
6. [Troubleshooting](#troubleshooting)
7. [Commands Reference](#commands-reference)

---

## Quick Start

### For Local Development (Testing Only)

Use **polling** (no webhook needed):

```bash
# Backend automatically uses polling if no TELEGRAM_WEBHOOK_SECRET is set
# Just ensure your bot token is in .env:
TELEGRAM_BOT_TOKEN=your_token_here
TELEGRAM_BOT_USERNAME=your_bot_username
```

### For Production (HTTPS Required)

```bash
# 1. Get a bot token from @BotFather
# 2. Set webhook on your deployed server (HTTPS required)
# 3. Add to backend/.env:

TELEGRAM_BOT_TOKEN=123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_BOT_USERNAME=YourBotName
TELEGRAM_WEBHOOK_SECRET=random_secret_token_min_20_chars_abcd1234
BACKEND_URL=https://your-domain.com
```

---

## Architecture

### Data Flow

```
User sends message to bot
           ↓
    Telegram servers
           ↓
    POST /api/telegram/webhook
           ↓
Backend processes update
           ↓
Database operations (link user, save Chat ID)
           ↓
Auto-response via Bot API
           ↓
Message appears in Telegram
```

### Two Linking Methods

#### 1. **Auto-Linking (Recommended for Production)**

- User: `/start` → clicks "Enable Alerts" button
- Backend: Verifies Telegram username matches app user
- Result: Instant linking, 100% automatic

**Pros:**
- Zero manual entry
- Better UX
- Faster

**Cons:**
- Requires user to have Telegram username set in app

#### 2. **Manual Linking (Fallback)**

- User: Gets code from app profile
- User: Types `/start <CODE>` in bot
- Backend: Verifies code matches user ID
- Result: Chat ID saved

**Pros:**
- Works without username
- Backwards compatible

**Cons:**
- Manual step required
- Code expires in 10 minutes

---

## Step-by-Step Setup

### Prerequisites

- A Telegram bot token (from @BotFather)
- HTTPS domain (production requirement)
- Backend server with public IP
- SSL certificate (Let's Encrypt free option works)

### Step 1: Create/Update Bot with @BotFather

1. Open Telegram, search for `@BotFather`
2. Send `/start`
3. Choose:
   - `/newbot` (to create new bot), OR
   - `/mybots` (to edit existing bot)

**Save the token:** `123456789:ABC-DEF1234...`

### Step 2: Configure Bot Settings

```bash
# In @BotFather, send:
/mybots
→ Select your bot
→ Bot Settings
  → Commands (add /start, etc.)
  → Description
  → About
```

Example `/start` command:
```
start - Connect to Suraksha Setu for disaster alerts
help - Get help and instructions
profile - Manage your Telegram settings
```

### Step 3: Prepare Backend Environment

Edit `backend/.env`:

```ini
# Required
TELEGRAM_BOT_TOKEN=123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_BOT_USERNAME=YourBotName

# Production only
TELEGRAM_WEBHOOK_SECRET=your_secure_random_secret_at_least_20_chars_long
BACKEND_URL=https://your-domain.com

# Optional
DEFAULT_ALERT_RADIUS_KM=50
```

### Step 4: Set Webhook on Telegram Servers

Once your backend is deployed to HTTPS:

```bash
# Option A: Using curl (easiest)
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -d "url=https://your-domain.com/api/telegram/webhook" \
  -d "secret_token=your_secure_random_secret"

# Option B: In Python
import httpx

token = "123456789:ABC-DEF1234..."
url = "https://your-domain.com/api/telegram/webhook"
secret = "your_secure_random_secret"

response = httpx.post(
    f"https://api.telegram.org/bot{token}/setWebhook",
    data={
        "url": url,
        "secret_token": secret,
        "max_connections": 40,
        "allowed_updates": ["message", "callback_query"],
    }
)
print(response.json())
```

### Step 5: Verify Webhook

```bash
# Check webhook info
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo" | python -m json.tool

# Example response:
# {
#   "ok": true,
#   "result": {
#     "url": "https://your-domain.com/api/telegram/webhook",
#     "has_custom_certificate": false,
#     "pending_update_count": 0,
#     "max_connections": 40,
#     "allowed_updates": ["message", "callback_query"]
#   }
# }
```

### Step 6: Test Auto-Linking Flow

1. **Email yourself your Telegram username** (so you know it)
2. **Create account in Suraksha Setu app** with that Telegram username in profile
3. **Search bot in Telegram:** `@your_bot_name`
4. **Send:** `/start`
5. **Click:** "Enable Disaster Alerts" button
6. **Verify:** You get success message, Chat ID saved in database

---

## Auto-Linking Flow

### User Journey

```
1. User opens app, goes to Profile → Notifications
   ↓
2. Enters Telegram username (e.g., @john_doe)
   ↓
3. Saves profile
   ↓
4. Opens Telegram, searches for bot
   ↓
5. Sends /start command
   ↓
6. Sees "Enable Disaster Alerts" button
   ↓
7. Clicks button
   ↓
8. Backend receives callback_query
   → Matches Telegram username with app user
   → Saves Chat ID
   → Sends ✅ confirmation
   ↓
9. User now gets disaster alerts!
```

### Database Update

```sql
-- Before
SELECT telegram_username, telegram_chat_id FROM users 
WHERE username = 'john_doe';
-- john_doe | NULL | NULL

-- After clicking button
-- john_doe | john_doe | 123456789

-- Now eligible for Telegram alerts:
SELECT * FROM users 
WHERE telegram_chat_id IS NOT NULL 
AND notification_channels->>'telegram' = 'true';
```

---

## Security Best Practices

### 1. **Webhook Secret Token**

Always set `TELEGRAM_WEBHOOK_SECRET` in production:

```bash
# Generate secure random secret (Linux/Mac)
openssl rand -base64 32
# Output: abc123def456ghi789jkl012mno345pqrstu/vwx=

# Use in .env
TELEGRAM_WEBHOOK_SECRET=abc123def456ghi789jkl012mno345pqrstu/vwx=
```

**How it works:**
- You set secret when registering webhook
- Telegram sends `X-Telegram-Bot-Api-Secret-Token` header with every request
- Backend verifies header matches secret
- Protects against spoofed webhook requests

### 2. **HTTPS Required**

- Telegram **only** accepts HTTPS URLs for webhooks
- Use free SSL:
  - **Let's Encrypt** (recommended)
  - **Cloudflare** (free SSL with proxy)
  - **AWS ACM** (for AWS deployments)

### 3. **Rate Limiting**

Add rate limiting to webhook endpoint:

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@app.post("/api/telegram/webhook")
@limiter.limit("100/minute")
async def telegram_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    # Your code
    pass
```

### 4. **Input Validation**

- Always validate `callback_data` contains expected values
- Sanitize text inputs before using in database
- Check `chat_id` is numeric

### 5. **Error Handling**

- Always return 200 OK to Telegram (even if error occurs)
- Log errors for debugging, but don't expose to user
- Use try-except to prevent crashes

---

## Troubleshooting

### Webhook Not Receiving Updates

**Check:**

```bash
# 1. Verify webhook is set
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"

# 2. Check pending updates
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"

# 3. Test your HTTPS endpoint
curl -X POST https://your-domain.com/api/telegram/webhook \
  -H "X-Telegram-Bot-Api-Secret-Token: your_secret" \
  -H "Content-Type: application/json" \
  -d '{"update_id": 123, "message": {"text": "/start"}}'
```

**Solutions:**

- Ensure BACKEND_URL uses HTTPS
- Check firewall allows port 443
- Verify SSL certificate is valid
- Check backend logs for errors

### Users Can't Auto-Link

**Check:**

```bash
# Verify user exists
SELECT username, telegram_username, telegram_chat_id FROM users 
WHERE email = 'user@example.com';

# Should show:
# | john_doe | john_doe | NULL |  ← Ready to auto-link
# | jane_doe | NULL | NULL |      ← No Telegram username set
```

**Solutions:**

- Ensure user has Telegram username in app profile
- Test manual linking as fallback
- Check webhook secret matches
- Verify callback handler logs

### Webhook Returns 504 or Timeout

**Causes:**

- Backend slow/unresponsive
- Database connection timeout
- External API call slow

**Solutions:**

```python
# Add timeout to all HTTP calls
async with httpx.AsyncClient(timeout=10.0) as client:
    # Your code

# Make database operations async
await db.execute(select(...))
await db.commit()

# Use background tasks for slow operations
from fastapi import BackgroundTasks

@app.post("/api/telegram/webhook")
async def telegram_webhook(..., background_tasks: BackgroundTasks):
    # Fast path: return 200 immediately
    background_tasks.add_task(slow_operation, data)
    return {"ok": True}

async def slow_operation(data):
    # Slow logic (analytics, notifications, etc.)
    pass
```

---

## Commands Reference

### Common BotFather Commands

```
/start              Open BotFather menu
/newbot             Create new bot
/mybots             List your bots
/setcommands        Set command descriptions
/setdescription     Set bot description
/deletebot          Delete a bot
/logout             Logout
```

### Webhook Management

```bash
# Set webhook
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://your-domain.com/api/telegram/webhook" \
  -d "secret_token=your_secret"

# Get webhook info
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"

# Delete webhook (back to polling)
curl -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"

# Get updates (polling - only if no webhook)
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

### Telegram API Methods

```
sendMessage              Send text message
sendMessageWithButtons   Send message with inline buttons
answerCallbackQuery      Respond to button click
editMessageText          Edit existing message
deleteMessage            Delete message
getMe                    Get bot info
```

---

## Environment Variables Summary

| Variable | Required | Production | Description |
|----------|----------|-----------|------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | ✅ | Bot token from @BotFather |
| `TELEGRAM_BOT_USERNAME` | ✅ | ✅ | Bot username (without @) |
| `TELEGRAM_WEBHOOK_SECRET` | ❌ | ✅ | Secret for webhook verification |
| `BACKEND_URL` | ❌ | ✅ | HTTPS domain for webhook URL |
| `DEFAULT_ALERT_RADIUS_KM` | ❌ | ❌ | Alert radius (default: 50km) |

---

## Monitoring & Logs

### View Webhook Activity

```bash
# Backend logs
tail -f backend.log | grep "Telegram"

# Expected output:
# [Telegram] Linked chat_id=123456789 to user=user_id
# [Telegram] Auto-linked chat_id=123456789 to user=user_id
# [Telegram] Callback: auto_link:approve from chat_id=123456789
```

### Metrics to Track

- ✅ **Successful links:** database queries
- ⚠️ **Failed links:** check logs for username mismatches
- 📊 **Alert delivery:** count messages sent vs. failures
- ⏱️ **Webhook response time:** should be < 1 second

---

## FAQ

**Q: How often should I set the webhook?**
A: Once during deployment. Telegram remembers it until you delete it.

**Q: Do I need a special SSL certificate?**
A: No, any valid HTTPS certificate works (Let's Encrypt is free).

**Q: Can I use localhost webhook?**
A: No, only public HTTPS URLs work. Use ngrok for testing.

**Q: What if my webhook goes down?**
A: Telegram queues up to ~1000 updates, then discards old ones.

**Q: How do I switch from polling to webhooks?**
A: Delete old webhook, set new one with `/api/telegram/webhook` endpoint.

---

## Next Steps

1. Deploy backend to HTTPS
2. Set webhook on Telegram
3. Test auto-linking flow
4. Monitor logs
5. Roll out to users

---

For issues, check logs or open an issue on GitHub.
