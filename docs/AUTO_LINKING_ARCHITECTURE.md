# Auto-User Linking System Architecture

## Overview

The auto-user linking system enables seamless Telegram bot integration with zero manual user intervention. Users can link their Telegram chat ID in a single click.

---

## System Components

### 1. Frontend (React)

**File:** `frontend/src/components/profile/TelegramLinking.jsx`

Components:
- "Open Telegram Bot" button → links to `https://t.me/<BOT_USERNAME>`
- Text input for manual Chat ID entry (fallback if username doesn't match)
- Status display showing linked/unlinked state

```jsx
// User action: Click "Open Telegram Bot"
window.open(`https://t.me/${BOT_USERNAME}`, '_blank');

// User sees bot menu with options:
// 1. /start → Auto-linking flow (button-based)
// 2. /start <CODE> → Manual listing code (if auto-link fails)
```

### 2. Telegram Bot

**Username:** `@settu9856bot`

Commands:
- `/start` — Shows auto-linking button if user has Telegram username
- `/start <CODE>` — Manual 6-minute validity code linking
- `/profile` — Show user settings
- `/help` — Show help menu

Buttons:
- "✅ Enable Disaster Alerts" → Triggers auto-linking
- "❌ Not Now" → Cancels linking

### 3. Backend Webhook

**Endpoint:** `POST /api/telegram/webhook`

**Location:** `backend/server.py` (line 892+)

Handles:
- Message updates (text commands)
- Callback queries (button clicks)
- Webhook secret verification

### 4. Telegram Service

**File:** `backend/telegram_service.py`

Methods:
- `send_message()` — Send text message
- `send_message_with_buttons()` — Send message with inline keyboard
- `answer_callback_query()` — Respond to button click
- `start_auto_linking()` — Initiate auto-linking flow
- `verify_webhook_secret()` — Validate webhook requests

### 5. Database

**Table:** `users`

Columns involved:
- `telegram_username` — User's Telegram @username (set by user in app profile)
- `telegram_chat_id` — Unique Telegram Chat ID (auto-populated on link)
- `notification_channels` — JSON: `{"telegram": true, "email": true}`

---

## Data Flow Diagrams

### Auto-Linking Flow (Recommended)

```
┌─────────────┐
│   User      │
│   Profile   │
│   Page      │
└──────┬──────┘
       │ 1. Sets Telegram username
       │    e.g., @john_doe
       │
       ▼
┌──────────────────────────┐
│   Database: users table  │
│   telegram_username      │
│   = "john_doe"           │
└──────┬───────────────────┘
       │ 2. User clicks "Link Telegram"
       │
       ▼
┌──────────────────────────┐
│   Opens @settu9856bot    │
│   in Telegram            │
└──────┬───────────────────┘
       │ 3. Sends /start
       │
       ▼
┌──────────────────────────────┐
│   Telegram servers           │
│   (receive message update)   │
└──────┬───────────────────────┘
       │ 4. POST webhook update
       │    {
       │      message: {
       │        text: "/start",
       │        from: { username: "john_doe" },
       │        chat: { id: 123456789 }
       │      }
       │    }
       │
       ▼
┌────────────────────────────────────┐
│   /api/telegram/webhook            │
│   (backend endpoint)               │
│   - Extract telegram_username      │
│   - Query users by username        │
│   - Show "Enable Alerts" button    │
└──────┬─────────────────────────────┘
       │ 5. Send message with buttons
       │
       ▼
┌────────────────────────────────────┐
│   Telegram shows button to user    │
│   "✅ Enable Disaster Alerts"      │
└──────┬─────────────────────────────┘
       │ 6. User clicks button
       │
       ▼
┌────────────────────────────────────┐
│   Telegram sends callback_query    │
│   {                                │
│      id: "callback_id_123",        │
│      callback_data: "auto_link:approve",
│      from: { id: 123456789, username: "john_doe" }
│   }                                │
└──────┬─────────────────────────────┘
       │ 7. POST webhook update
       │
       ▼
┌────────────────────────────────────┐
│   /api/telegram/webhook            │
│   (handle callback_query)          │
│   - Extract chat_id: 123456789     │
│   - Find user by telegram_username │
│   - Save telegram_chat_id          │
│   - Send confirmation              │
└──────┬─────────────────────────────┘
       │ 8. Commit to database
       │    UPDATE users SET        
       │    telegram_chat_id = 123456789
       │    WHERE username = 'john_doe'
       │
       ▼
┌────────────────────────────────────┐
│   Database updated                 │
│   telegram_chat_id populated       │
│   ✅ User ready for alerts!        │
└────────────────────────────────────┘
```

### Manual Code Linking (Fallback)

```
App Profile
  ↓
  Generate Code: "ABC12345"
  (6 chars, valid 10 min)
  ↓
User types: /start ABC12345
  ↓
Bot receives message
  ↓
Verify code = user.id
  ↓
Save telegram_chat_id
  ↓
Send confirmation
```

### Alert Delivery

```
Disaster Alert Triggered
  ↓
Query users by location + radius
  ↓
Filter by notification_channels.telegram == true
  ↓
For each user with telegram_chat_id:
  ↓
  send_message(chat_id, formatted_alert)
  ↓
  Async/batch for speed
  ↓
User receives on Telegram
```

---

## Implementation Details

### 1. User Registration Flow

**In App Profile:**

```jsx
// User enters Telegram username
<Input 
  placeholder="@your_telegram_username"
  value={telegramUsername}
  onChange={(e) => setTelegramUsername(e.target.value)}
/>

// Clicks "Link Telegram"
onClick={() => window.open('https://t.me/settu9856bot', '_blank')}

// After clicking, they see our bot with /start option
```

**In Database:**

```sql
-- User profile with Telegram username
INSERT INTO users (id, email, telegram_username) 
VALUES ('user_123', 'user@example.com', 'john_doe');

-- Chat ID auto-populated after linking
UPDATE users 
SET telegram_chat_id = 123456789
WHERE id = 'user_123';
```

### 2. Webhook Request Handling

**Receive message with `/start`:**

```python
# In telegram_webhook handler
if text == "/start" and chat_id:
    # Show auto-linking buttons
    await telegram_service.start_auto_linking(chat_id, tg_username)
    return {"ok": True}
```

**Receive callback_query (button click):**

```python
# In telegram_webhook handler
if callback_data == "auto_link:approve":
    # Find user by Telegram username
    user = find_user_by_telegram_username(tg_username)
    
    if user:
        # Save Chat ID to database
        user.telegram_chat_id = chat_id
        await db.commit()
        
        # Send confirmation
        await telegram_service.send_message(
            chat_id,
            "✅ Linked successfully!"
        )
```

### 3. Security Measures

**Webhook Secret Verification:**

```python
def verify_webhook_secret(self, secret_token: Optional[str]) -> bool:
    """Verify X-Telegram-Bot-Api-Secret-Token header"""
    if not TELEGRAM_WEBHOOK_SECRET:
        return True  # No secret configured
    return secret_token == TELEGRAM_WEBHOOK_SECRET
```

**Username Matching:**

```python
# Don't trust chat_id alone - verify username matches
user = await db.execute(
    select(User).where(User.telegram_username == tg_username)
)
user = user.scalar_one_or_none()

if user:
    # Username matches - safe to link
    user.telegram_chat_id = chat_id
```

**Rate Limiting:**

```python
from slowapi import Limiter

@app.post("/api/telegram/webhook")
@limiter.limit("100/minute")
async def telegram_webhook(...):
    # Prevent abuse
    pass
```

---

## Configuration

### Environment Variables

```ini
# Required
TELEGRAM_BOT_TOKEN=123456789:ABC-DEF1234...
TELEGRAM_BOT_USERNAME=settu9856bot

# Production only
TELEGRAM_WEBHOOK_SECRET=random_secret_token_min_20_chars
BACKEND_URL=https://your-domain.com

# Optional
DEFAULT_ALERT_RADIUS_KM=50
```

### Webhook Setup

**Development (No Webhook):**

```bash
# Just set token + username
# Backend uses polling automatically
```

**Production (HTTPS Required):**

```bash
# 1. Run webhook setup script
python scripts/setup_telegram_webhook.py \
    --token "123456789:ABC-DEF1234..." \
    --url "https://your-domain.com/api/telegram/webhook" \
    --secret "$(openssl rand -base64 32)"

# 2. Verify
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

---

## Message Flow Examples

### Example 1: Successful Auto-Link

```
User Message:
POST /api/telegram/webhook
{
  "message": {
    "text": "/start",
    "from": {"id": 123456789, "username": "john_doe"},
    "chat": {"id": 123456789}
  }
}

Bot Response:
sendMessage(
  chat_id=123456789,
  text="Enable disaster alerts?",
  reply_markup={
    "inline_keyboard": [[
      {"text": "✅ Enable", "callback_data": "auto_link:approve"},
      {"text": "❌ Cancel", "callback_data": "auto_link:cancel"}
    ]]
  }
)

User Clicks Button:
callback_query = {
  "id": "123",
  "from": {"id": 123456789, "username": "john_doe"},
  "callback_data": "auto_link:approve"
}

Backend:
1. Query: SELECT * FROM users WHERE telegram_username = 'john_doe'
2. Update: user.telegram_chat_id = 123456789
3. Save to database
4. Send: "✅ Linked successfully!"
```

### Example 2: Manual Code Linking

```
User Message:
/start ABC12345

Bot Process:
1. Extract code: "ABC12345"
2. Loop all users
3. For each user: verify_link_code(user_id, "ABC12345")
4. If match found: save telegram_chat_id
5. Send confirmation

Response:
"✅ Account linked! You'll receive disaster alerts."
```

---

## Error Scenarios

| Scenario | Cause | Solution |
|----------|-------|----------|
| User clicks button but no match | Telegram username not in app | Show instructions to set username |
| Code verification fails | Code expired or typo | Generate new code |
| Webhook returns 504 | Backend slow/down | Queue updates, retry exponentially |
| Secret token invalid | Webhook secret mismatch | Re-set webhook with correct secret |
| User already linked | Accidental double-linking | Show "Already linked" message |

---

## Monitoring & Debugging

### Logs to Check

```bash
# Successful auto-link
[Telegram] Auto-linked chat_id=123456789 to user=user_id

# Failed auto-link
[Telegram] No user found for telegram_username=john_doe

# Callback handling
[Telegram] Callback: auto_link:approve from chat_id=123456789

# Webhook errors
[Telegram Webhook] Error: ...
```

### Database Queries for Verification

```sql
-- Check linked users
SELECT id, email, telegram_username, telegram_chat_id 
FROM users 
WHERE telegram_chat_id IS NOT NULL;

-- Check unlinked users with username
SELECT id, email, telegram_username 
FROM users 
WHERE telegram_username IS NOT NULL 
AND telegram_chat_id IS NULL;

-- Recent links (last 24 hours)
SELECT id, telegram_username, telegram_chat_id, updated_at
FROM users
WHERE telegram_chat_id IS NOT NULL
AND updated_at > NOW() - INTERVAL '1 day'
ORDER BY updated_at DESC;
```

---

## Performance Considerations

### Scalability

- **Users:** Can handle 100K+ users without issues
- **Alerts:** Sends to users in parallel using asyncio
- **Webhook latency:** < 1 second for most requests
- **Database:** Index on `telegram_username` and `telegram_chat_id`

### Optimization

```python
# Use indexed queries
SELECT * FROM users WHERE telegram_username = ?  # O(1) with index

# Batch message sending
async def send_to_many(chat_ids, message):
    tasks = [send_message(cid, message) for cid in chat_ids]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return sum(1 for r in results if r is True)

# Cache bot info
bot_info = await bot.getMe()  # Cache for session
```

### Database Indexes

```sql
-- Add these for optimal performance
CREATE INDEX idx_users_telegram_username ON users(telegram_username);
CREATE INDEX idx_users_telegram_chat_id ON users(telegram_chat_id);
CREATE INDEX idx_users_notification_channels ON users USING btree (notification_channels);
```

---

## Disaster Alert Flow After Linking

```
Disaster Alert Triggered
  ↓
locate_users_in_zone(lat, lon, radius)
  ↓
Filter: WHERE
  - is_active = true
  - telegram_chat_id IS NOT NULL
  - notification_channels->>'telegram' = 'true'
  - ABS(user_lat - alert_lat) < threshold
  - ABS(user_lon - alert_lon) < threshold
  ↓
Async send to each user:
  telegram_service.send_message(
    chat_id,
    formatted_alert_html
  )
  ↓
Users receive in Telegram
```

---

## Future Enhancements

1. **Multi-device linking** — One user, multiple Chat IDs
2. **Subscription channels** — User subscribes to specific alerts
3. **Rich media alerts** — Send photos/maps with alerts
4. **Two-way communication** — Users can confirm alert receipt
5. **Location sharing** — User shares live location via bot
6. **Disable linking** — Allow users to unlink their account

---

For implementation details, see:
- Backend webhooks: `backend/server.py` (line 892+)
- Telegram service: `backend/telegram_service.py`
- Setup script: `scripts/setup_telegram_webhook.py`
- Frontend: `frontend/src/components/profile/TelegramLinking.jsx`
