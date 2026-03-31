# 🚨 SURAKSHA SETU - COMMUNITY ALERT ROUTING SYSTEM
## Complete Implementation Guide

---

## 📋 OVERVIEW

The Community Alert Routing System provides:

1. **Automatic Alert Detection** - Detects help, emergency, alert, and warning posts in community
2. **AI-Generated Messages** - Creates brief 2-sentence context messages using Sarvam AI
3. **Smart Geographic Routing** - Finds nearby users and sends Telegram alerts
4. **SMS for Major Events Only** - Minimizes SMS usage to critical events only
5. **Admin Broadcast System** - Admins can send alerts to all users, by pincode, or specific users

---

## 🎯 HOW IT WORKS

### Step 1: User Posts in Community

```
POST /api/community/posts
{
    "content": "🚑 HELP! Medical emergency at Central Park. Someone needs an ambulance!",
    "type": "emergency",
    "author": "John Doe",
    "lat": 28.6139,
    "lon": 77.2090,
    "location": "Central Park, Delhi",
    "pincode": "110001"
}
```

### Step 2: Alert Detection

The system automatically detects alert keywords:
- **CRITICAL**: emergency, critical, disaster, attack, earthquake, trapped
- **HIGH**: help, urgent, alert, fire, flood, injury, medical, danger
- **MEDIUM**: warning

### Step 3: Nearby Users Discovery

System finds all active users with:
- ✅ Telegram chat ID linked
- ✅ Location information available  
- ✅ Within 5km radius (configurable)

### Step 4: AI Context Generation

Sarvam AI generates brief message:
```
"🚑 Medical emergency at Central Park - unconscious person. 
If you're nearby and can help safely, please respond immediately."
```

### Step 5: Telegram Notification

All nearby users receive:
```
🚨 EMERGENCY

🚑 Medical emergency at Central Park - unconscious person. 
If you're nearby and can help safely, please respond immediately.

📍 Location: Central Park, Delhi
👤 By: John Doe
⏰ Just Now

💬 Open app for details
```

### Step 6: SMS Sent (Major Events Only)

**SMS ONLY sent for these alert types:**
- 🌍 earthquake
- 🌊 flood
- 💥 disaster
- ⚔️ attack
- 🆘 emergency

**NOT sent for:** help, urgent, alert, warning, fire, injury, medical

---

## 🔧 SETUP & CONFIGURATION

### 1. Environment Variables

```bash
# Telegram Bot (required)
TELEGRAM_BOT_TOKEN=8127774414:AAH8XLOZiW0sbnQjaqj3FZ6s235VAtN4dag
TELEGRAM_BOT_USERNAME=settu9856bot

# SMS Service (optional, for SMS alerts)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+1234567890

# AI Context Generation (optional)
SARVAM_API_KEY=your_sarvam_key

# Alert Radius (default: 5km)
DEFAULT_ALERT_RADIUS_KM=5
```

### 2. Database Fields

Users need these fields populated:
```
- telegram_chat_id: String (from Telegram Mini App or manual registration)
- location: JSON {
    "lat": float,
    "lon": float,
    "name": string,
    "pincode": string,
    "author": string
}
- is_active: Boolean (true)
- phone: String (optional, for SMS)
```

### 3. Run the Backend

```bash
cd backend
python -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

Check startup logs:
```
✅ Telegram Bot service initialized (@settu9856bot)
✅ Alert Router initialized
✅ Suraksha Setu Backend Online
```

---

## 📱 COMMUNITY POST RESPONSE

When a community post is created with location and alert keywords detected:

### Response Includes:

```json
{
    "success": true,
    "post": {
        "id": "post_abc123",
        "content": "HELP! Medical emergency...",
        "type": "emergency",
        "location": "Central Park",
        "timestamp": "2026-03-31T12:20:00Z",
        "alert_routing": {
            "post_id": "post_abc123",
            "alert_type": "help_request",
            "severity": "high",
            "telegram_sent": 12,
            "telegram_failed": 0,
            "sms_sent": 0,
            "sms_failed": 0,
            "nearby_users": 12
        }
    }
}
```

---

## 👨‍💼 ADMIN BROADCAST SYSTEM

### Admin Endpoint: Send Broadcast

**Endpoint:**
```
POST /admin/broadcast/send?auth_token=<firebase_admin_token>
```

**Required:** Firebase Admin Token (user.user_type == "admin")

**Request Body:**
```json
{
    "title": "Critical Alert",
    "message": "All residents in downtown area must evacuate immediately. Assembly point: Town Hall.",
    "alert_type": "disaster",
    "severity": "critical",
    "target_type": "all|pincode|user_ids",
    "target_value": null,
    "radius_km": 5,
    "use_telegram": true,
    "use_sms": true,
    "send_immediately": true
}
```

**Response:**
```json
{
    "broadcast_id": "bc_12345",
    "status": "completed",
    "message_sent": 145,
    "sms_sent": 0,
    "users_targeted": 150,
    "items": [
        {
            "user_id": "user_1",
            "channel": "telegram",
            "status": "sent"
        },
        ...
    ]
}
```

### Target Types

#### 1. Broadcast to ALL Users
```json
{
    "target_type": "all",
    "use_telegram": true,
    "use_sms": true
}
```

#### 2. Broadcast by Pincode
```json
{
    "target_type": "pincode",
    "target_value": "110001",
    "use_telegram": true,
    "use_sms": false
}
```

#### 3. Broadcast to Specific Users
```json
{
    "target_type": "user_ids",
    "target_value": "user_1,user_2,user_3",
    "use_telegram": true,
    "use_sms": false
}
```

### Admin Test Broadcast

Send test message to verify Telegram setup:

```
GET /admin/broadcast/test?auth_token=<token>&user_id=<target_user_id>
```

Response:
```json
{
    "success": true,
    "user_id": "user_123",
    "message": "Test message sent",
    "telegram_chat_id": "123456789..."
}
```

---

## 🎓 USE CASES

### Scenario 1: Community Help Request

**User Post:**
```
"HELP! I'm stuck in traffic jam on NH-1. The route got blocked 
due to an accident. Anyone near who can help navigate alternate routes?"
```

**System Response:**
1. ✅ Detects keyword: "HELP"
2. ✅ Finds 8 users within 5km
3. ✅ Generates AI message: "Traffic jam on NH-1 with accident. 
   If you're nearby, consider alternate routes via airport road."
4. ✅ Sends Telegram to 8 users
5. ❌ No SMS (not a major event)

---

### Scenario 2: Major Earthquake

**User Post:**
```
"EARTHQUAKE! 6.5 magnitude earthquake detected. 
Everyone take shelter under tables immediately!"
```

**System Response:**
1. ✅ Detects keyword: "EARTHQUAKE" (CRITICAL)
2. ✅ Finds 45 users within 5km
3. ✅ Generates AI message: "6.5 magnitude earthquake detected. 
   Take immediate shelter. Follow official evacuation procedures."
4. ✅ Sends Telegram to 45 users
5. ✅ Sends SMS to all 45 users with phones

---

### Scenario 3: Admin Area Evacuation

**Admin Broadcast:**
```
Admin issues broadcast:
- Title: "Evacuation Order - Downtown Zone"
- Message: "Due to chemical leak, all residents in downtown 
  must evacuate to Assembly Point A immediately"
- Alert Type: disaster
- Target: All users in pincode 110001
- Use Telegram: YES
- Use SMS: YES
```

**Results:**
- ✅ 234 users in pincode 110001 receive Telegram message
- ✅ 156 users with phone numbers receive SMS
- ✅ Delivery tracked and reported

---

## 📊 MONITORING & LOGS

### Check Backend Logs

Look for alert routing entries:

```
✅ Alert detected: help_request in post abc123
📍 Found 12 users within 5km
📱 Sent Telegram alerts: 12 succeeded, 0 failed
📞 Sent SMS to 0 users
✅ Alert routed: Telegram=12, SMS=0, Users=12
```

### Track Delivery

Each alert response includes:
- `alert_routing.telegram_sent` - Successful Telegram sends
- `alert_routing.telegram_failed` - Failed Telegram sends
- `alert_routing.sms_sent` - Successful SMS sends
- `alert_routing.nearby_users` - Total users found

---

## 🔐 SECURITY & PRIVACY

### User Privacy
- ✅ Geographic data only used for 5km radius calculation
- ✅ No location data shared between users
- ✅ Telegram chat ID not used for any other purpose
- ✅ SMS only to users with registered phone numbers

### Admin Controls
- ✅ Only admins (user_type == "admin") can use broadcast
- ✅ Firebase token required for all admin operations
- ✅ All broadcasts logged with admin user_id
- ✅ SMS throttling prevents spam

### Alert Safety
- ✅ Keywords validated before routing
- ✅ Duplicate alerts deduplicated
- ✅ User preferences respected (notification_channels)
- ✅ Failed sends logged for manual review

---

## ⚠️ SMS USAGE OPTIMIZATION

**Goal: Use LEAST SMS possible**

### SMS Only Sent For:
1. 🌍 **Earthquake** - Major natural disaster
2. 🌊 **Flood** - Major natural disaster
3. 💥 **Disaster** - Major natural disaster
4. ⚔️ **Attack** - Emergency situation
5. 🆘 **Emergency** - Life-threatening situation

### SMS NOT Sent For:
- ❌ Help requests (non-critical)
- ❌ Urgent (not critical)
- ❌ Alerts (informational)
- ❌ Warnings (precautionary)
- ❌ Fire (unless broadcast admin)
- ❌ Medical (unless emergency keyword)

### Admin Override
Admins can force SMS with `use_sms: true` in broadcast regardless of event type.

---

## 🧪 TESTING

### Test Alert Keyword Detection

```bash
python test_alert_routing.py
```

Output shows:
- ✅ 15+ keywords configured
- ✅ Critical/High/Medium severity levels
- ✅ SMS major events identified
- ✅ Workflow example

### Test with Real Community Post

1. Create a test user with location and Telegram chat ID
2. Make community post with alert keyword:
   ```
   POST /api/community/posts
   {
       "content": "HELP! Emergency at my location",
       "type": "emergency",
       "lat": 28.6139,
       "lon": 77.2090,
       "location": "Test Location",
       "author": "Test User"
   }
   ```
3. Check response includes `alert_routing` object
4. Verify Telegram message received

---

## 🚀 DEPLOYMENT CHECKLIST

- [x] Alert Router initialized in backend
- [x] Telegram bot token configured
- [x] Community post integration added
- [x] Admin broadcast endpoints created
- [x] AI context generation ready
- [x] SMS limited to major events
- [x] Database schema supports location
- [x] Tests passing
- [x] Documentation complete

---

## 📞 SUPPORT & TROUBLESHOOTING

### Issue: Alerts not being sent

Check logs for:
```
❌ Error finding nearby users
❌ Alert routing failed
❌ Telegram send failed
```

### Issue: SMS being sent too often

Verify alert keyword is in SMS_MAJOR_EVENTS:
```python
SMS_MAJOR_EVENTS = ["earthquake", "flood", "disaster", "attack", "emergency"]
```

### Issue: Admin broadcast not working

Verify:
1. User is admin (user_type == "admin")
2. Firebase token is valid
3. Target users have telegram_chat_id
4. Backend is running

---

## 📈 METRICS & KPIs

Track these metrics:
- Alerts detected per day
- Users notified per alert (average)
- Telegram delivery rate
- SMS delivery rate
- Admin broadcast usage
- Response time to nearby users

---

## 🎉 SYSTEM READY

✅ **Status**: PRODUCTION READY

The Community Alert Routing System is fully implemented and tested.

**Next Steps:**
1. Deploy to production
2. Register users with Telegram
3. Train admins on broadcast system
4. Monitor alerts and delivery metrics
5. Adjust radius/keywords based on feedback

---

*Last Updated: March 31, 2026*
*Version: 1.0*
