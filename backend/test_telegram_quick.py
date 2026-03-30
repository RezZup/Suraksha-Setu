#!/usr/bin/env python3
"""
Quick Telegram Test - Simple Message
"""
import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

async def quick_test():
    """Quick telegram test"""
    from telegram_service import TelegramService
    
    print("=" * 70)
    print("🤖 Telegram Bot - Quick Test")
    print("=" * 70)
    
    telegram = TelegramService()
    
    if not telegram.enabled:
        print("\n❌ Telegram not configured!")
        return
    
    print("\n✓ Bot Status: ✅ READY")
    print(f"  Token: {telegram.token[:20]}...")
    
    print("\n📱 Setup Telegram (if not already done):")
    print("  1. Open Telegram")
    print("  2. Search for: @SurakshaSetuBot")
    print("  3. Click /start")
    
    chat_id = input("\n💬 Enter your Telegram Chat ID: ").strip()
    
    if not chat_id:
        print("\n❌ No chat ID!")
        return
    
    print(f"\n✓ Sending test message to {chat_id}...")
    
    test_message = """🚨 <b>Suraksha Setu Test Alert</b>

✅ Telegram integration is <b>WORKING PERFECTLY!</b>

<b>Advantages:</b>
• 🆓 Completely FREE
• 📱 Unlimited messages
• ⚡ Super fast delivery
• ✅ No approval process

Type /help for more information.

Stay safe!"""
    
    result = await telegram.send_message(chat_id, test_message)
    
    if result:
        print("\n✅ Message sent successfully!")
        print("\nYou should see the alert in your Telegram chat within seconds!")
    else:
        print("\n❌ Failed to send!")
        print("   - Check chat ID is correct")
        print("   - Make sure you clicked /start with @SurakshaSetuBot")
    
    print("\n" + "=" * 70)

if __name__ == "__main__":
    asyncio.run(quick_test())
