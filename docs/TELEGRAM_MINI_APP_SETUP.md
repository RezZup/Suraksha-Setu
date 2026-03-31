# Telegram Mini App Setup Guide

## 🚀 Overview

Suraksha Setu now supports **Telegram Mini Apps** for automatic Chat ID registration. This eliminates manual user input and provides a seamless experience for disaster alert subscriptions.

**Key Benefits:**
- ✅ Zero manual Chat ID entry
- ✅ Instant disaster alerts on Telegram
- ✅ Works completely free
- ✅ Production-ready

---

## 📋 Prerequisites

1. **Telegram Bot Token** (already created: from @BotFather)
   - Your token: `8127774414:AAH8XLOZiW0sbnQjaqj3FZ6s235VAtN4dag`
   - Your bot: `@settu9856bot`

2. **Suraksha Setu Backend** running and deployed
   - Backend URL: `https://yourdomain.com` (update below)
   - Frontend URL: `https://yourdomain.com/telegram-app`

3. **BotFather Access** to configure the bot

---

## ⚙️ Step 1: Configure Mini App with BotFather

### 1a. Open BotFather

Search for **@BotFather** in Telegram:
```
Open Telegram → Search "@BotFather" → Click Start
```

### 1b. Select Your Bot

Send:
```
/mybots
```

Then click your bot: **settu9856bot**

### 1c. Enable Mini App

Send:
```
/edit
```

Then select: **App**

### 1d. Set Mini App URL

Fill in:
```
URL: https://yourdomain.com/telegram-app
```

**Examples:**
- Local: `http://localhost:3000/telegram-app`
- Production: `https://suraksha-setu.example.com/telegram-app`
- Vercel/AWS: Update based on your deployment URL

### 1e. Save Configuration

BotFather will confirm Mini App is configured.

---

## ⚙️ Step 2: Add Mini App Button to Bot Menu

### 2a. In BotFather, Send:

```
/edit
```

Select: **Menu Button**

### 2b. Set Button Configuration

BotFather will prompt you to:

**Button Text:** `🔔 Enable Disaster Alerts`
**Button URL/App:** Select the Mini App you just configured

---

## ⚙️ Step 3: Verify Backend Endpoints

Your backend must have these endpoints (already implemented):

```bash
# Test endpoints are working:

# 1. Telegram Mini App Register
POST /api/telegram/mini-app/register
{
  "init_data": "<Telegram WebApp initData>",
  "firebase_token": "<optional firebase token>"
}

# Response:
{
  "success": true,
  "message": "Chat ID updated successfully",
  "chat_id": "123456789",
  "telegram_username": "username",
  "user_id": "firebase_uid"
}

# 2. Get User's Chat ID
GET /api/telegram/mini-app/chat-id?firebase_token=<token>

# Response:
{
  "chat_id": "123456789",
  "telegram_username": "username",
  "registered": true
}
```

---

## 🧪 Testing the Integration

### Test 1: Manual Testing

1. Open Telegram
2. Search for **@settu9856bot**
3. Click **"🔔 Enable Disaster Alerts"** button
4. Should see the Mini App loading
5. Should see "✅ Registration Successful" message

### Test 2: Chat ID Verification

1. In Telegram, search for: **@getidsbot**
2. Click Start
3. It shows your Chat ID
4. Test that alerts work using:
   ```bash
   python test_telegram_quick.py
   # Enter the Chat ID from above
   ```

### Test 3: Database Verification

```python
# In backend terminal:
from database import AsyncSessionLocal, User
from sqlalchemy import select

async def check():
    async with AsyncSessionLocal() as session:
        users = await session.execute(select(User).where(User.telegram_chat_id.isnot(None)))
        for u in users.scalars():
            print(f"User: {u.username}, Chat ID: {u.telegram_chat_id}")

# Run: asyncio.run(check())
```

---

## 🔐 Security Features

### Telegram Mini App Signature Verification

Your backend automatically:

1. **Validates HMAC-SHA256 signature** using `WebAppData` token
2. **Checks auth_date** (max 10 minutes old)
3. **Verifies user identity** without needing Firebase (but can use it too)
4. **Prevents spoofed requests** - only genuine Telegram Mini App data accepted

### Backend Validation Code

```python
# In telegram_service.py - validate_mini_app_data()

def validate_mini_app_data(self, init_data: str) -> Optional[Dict]:
    # 1. Parse init_data query string
    # 2. Extract hash and compute expected HMAC-SHA256
    # 3. Compare hashes using timing-safe comparison
    # 4. Check auth_date within 10-minute window
    # 5. Parse and return user data
```

---

## 📊 Architecture Flow

```
┌─────────────────┐
│  User Opens     │
│  Telegram Bot   │
└────────┬────────┘
         │
         ↓
┌─────────────────────────────────┐
│ Sees Button:                    │
│ "🔔 Enable Disaster Alerts"     │
└────────┬────────────────────────┘
         │
         ↓
┌──────────────────────────────────┐
│ Clicks Button → Mini App Loads   │
│ window.Telegram.WebApp.initData  │
└────────┬─────────────────────────┘
         │
         ↓
┌──────────────────────────────────────────┐
│ POST /api/telegram/mini-app/register     │
│ • initData                               │
│ • firebase_token (optional)              │
└────────┬─────────────────────────────────┘
         │
         ↓
┌──────────────────────────────────────────┐
│ Backend Validates:                       │
│ 1. HMAC-SHA256 signature ✅              │
│ 2. auth_date within 10 min ✅           │
│ 3. Extract user data ✅                 │
└────────┬─────────────────────────────────┘
         │
         ↓
┌──────────────────────────────────────────┐
│ Update User:                             │
│ • telegram_chat_id = extracted_id       │
│ • telegram_username = extracted_name    │
└────────┬─────────────────────────────────┘
         │
         ↓
┌──────────────────────────────────────────┐
│ Response: ✅ Success                     │
│ Frontend shows success message           │
│ Mini App closes automatically            │
└──────────────────────────────────────────┘
```

---

## 🚨 Alert Flow - Users Receive Notifications

```
┌──────────────────────────────┐
│ Disaster Detected            │
│ Location: (lat, lon)         │
└────────┬─────────────────────┘
         │
         ↓
┌────────────────────────────────────────┐
│ Query Database:                        │
│ 1. Find users in location/pincode      │
│ 2. Get their telegram_chat_id          │
│ 3. Check Alert Radius                  │
└────────┬───────────────────────────────┘
         │
         ↓
┌────────────────────────────────────────┐
│ Send Telegram Message:                 │
│ notify_pincode_users() or              │
│ notify_nearby_users()                  │
└────────┬───────────────────────────────┘
         │
         ↓
┌────────────────────────────────────────┐
│ 🚨 Alert appears in user's Telegram    │
│ with formattedalert info + helpline    │
└────────────────────────────────────────┘
```

---

## 🔧 Troubleshooting

### Issue: "Invalid Mini App data. Signature verification failed"

**Cause:** Mini App data wasn't sent properly or token is wrong

**Solution:**
1. Verify bot token is correct in `.env`
2. Ensure Mini App URL is exactly configured in BotFather
3. Check Mini App is opened from Telegram (not browser)

### Issue: "Telegram initData not available"

**Cause:** App wasn't opened from Telegram Mini App context

**Solution:**
1. Open **@settu9856bot** in Telegram
2. Click the **"🔔 Enable Disaster Alerts"** button
3. Don't open the URL directly in browser

### Issue: Chat ID shows but alerts not received

**Cause:** User location or notification channels not configured

**Solution:**
1. User must set their location in Suraksha Setu app
2. User must enable Telegram in notification preferences
3. Alert must be within their notification radius

### Issue: "This app must be opened from Telegram"

**Cause:** Trying to access Mini App directly via browser URL

**Solution:**
1. Only accessible from within Telegram
2. Use **@settu9856bot** → click "Enable Disaster Alerts" button

---

## 📱 Environment Variables Required

Add to `backend/.env`:

```bash
# Telegram Bot (already set)
TELEGRAM_BOT_TOKEN=8127774414:AAH8XLOZiW0sbnQjaqj3FZ6s235VAtN4dag
TELEGRAM_BOT_USERNAME=settu9856bot

# Alert radius for notifications
DEFAULT_ALERT_RADIUS_KM=50
```

Add to `frontend/.env.local`:

```bash
# Backend URL for Mini App API calls
REACT_APP_API_URL=https://yourdomain.com
# or for local: REACT_APP_API_URL=http://localhost:8000
```

---

## ✅ Deployment Checklist

- [ ] **Backend**: Deploy `telegram_service.py` (Mini App validation)
- [ ] **Backend**: Deploy `routes/telegram.py` (API endpoints)
- [ ] **Frontend**: Deploy `TelegramMiniApp.jsx` component
- [ ] **Frontend**: Add route `/telegram-app` to `App.js`
- [ ] **Frontend**: Deploy CSS styles `TelegramMiniApp.css`
- [ ] **BotFather**: Configure Mini App URL with deployed frontend URL
- [ ] **BotFather**: Add "Enable Disaster Alerts" button to menu
- [ ] **Testing**: Test with real Telegram account
- [ ] **Database**: Verify Chat IDs being stored correctly
- [ ] **Alerts**: Send test disaster alert to verify messages received

---

## 🎯 Next Steps

1. **Deploy backend** with new Telegram routes
2. **Deploy frontend** with TelegramMiniApp component
3. **Configure BotFather** with Mini App URL
4. **Test with @settu9856bot** → "Enable Disaster Alerts"
5. **Monitor logs** for successful registrations
6. **Send test alerts** to verify notifications

---

## 📖 Related Features

- **Email Alerts**: User can also register email address
- **SMS Alerts**: SMS alerts already working with Twilio
- **Push Notifications**: Web push alerts configured
- **Location Services**: Users can set multiple locations
- **Alert Radius**: Customizable per-user notification range

---

## 🆘 Support

For issues or questions:

1. **Check logs**: Backend logs show registration attempts
2. **Verify database**: Check `User.telegram_chat_id` is populated
3. **Test manually**: Use `test_telegram_quick.py` script
4. **Review security**: Ensure HMAC signature validation passes

---

**Happy alerting! 🚨 Suraksha Setu + Telegram Mini Apps = Zero-friction disaster alerts** 🎉
