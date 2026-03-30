#!/usr/bin/env python3
"""
Test Telegram Bot Alerts
Get your Telegram Chat ID:
1. Open Telegram
2. Search for: @SurakshaSetuBot
3. Click /start
4. You'll get a message with your chat_id
"""
import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

async def test_telegram():
    """Test Telegram bot"""
    
    from telegram_service import TelegramService
    
    print("=" * 70)
    print("🤖 Telegram Bot Alert Test")
    print("=" * 70)
    
    telegram = TelegramService()
    
    print("\n✓ Telegram Configuration:")
    print(f"  Bot Token: {telegram.token[:20]}...")
    print(f"  Status: {'✅ READY' if telegram.enabled else '❌ NOT CONFIGURED'}")
    print(f"  Base URL: {telegram._base[:40]}...")
    
    if not telegram.enabled:
        print("\n❌ Telegram not configured!")
        print("  Set TELEGRAM_BOT_TOKEN in .env")
        return
    
    print("\n📱 Setup Instructions:")
    print("  1. Open Telegram app on your phone")
    print("  2. Search for: @SurakshaSetuBot")
    print("  3. Click /start")
    print("  4. You'll receive your Chat ID")
    print("  5. Note that Chat ID and enter below")
    
    chat_id = input("\n💬 Enter your Telegram Chat ID: ").strip()
    
    if not chat_id:
        print("\n❌ No chat ID provided!")
        return
    
    print(f"\n✓ Sending test alert to chat {chat_id}...")
    
    # Test alert data
    alert_data = {
        "alert_type": "Flood",
        "severity": "HIGH",
        "location_name": "Delhi, North Zone",
        "description": "Heavy rainfall detected. Take precautions.",
        "distance_km": 5.2,
    }
    
    # Send via Telegram
    message = f"""🚨 <b>Suraksha Setu Alert</b>

<b>Type:</b> {alert_data['alert_type']}
<b>Severity:</b> {alert_data['severity']}
📍 <b>Location:</b> {alert_data['location_name']}
<b>Distance:</b> {alert_data['distance_km']} km

<b>Details:</b>
{alert_data['description']}

Stay safe! Call 1078 (NDMA) for help."""
    
    result = await telegram.send_message(chat_id, message)
    
    if result:
        print(f"\n✅ Alert sent successfully!")
        print(f"  Message delivered to: {chat_id}")
    else:
        print(f"\n❌ Failed to send alert!")
        print(f"  Check: Chat ID is correct, bot is active")
    
    print("\n" + "=" * 70)
    print("💡 Telegram Advantages:")
    print("  ✓ Completely FREE")
    print("  ✓ Unlimited messages")
    print("  ✓ No approval process")
    print("  ✓ Better performance")
    print("  ✓ Can use channels and groups")
    print("  ✓ Already working in your system!")
    print("=" * 70)

if __name__ == "__main__":
    asyncio.run(test_telegram())
