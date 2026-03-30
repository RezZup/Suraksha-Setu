#!/usr/bin/env python3
"""
Test Twilio WhatsApp Sandbox
To use this:
1. Go to https://console.twilio.com/us/account/messaging/services
2. Select Messaging > Try it out > WhatsApp Sandbox
3. Scan the QR code with your phone
4. Send "join <code>" message shown on the page
5. Then run this test
"""
import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

async def test_whatsapp_sandbox():
    """Test WhatsApp Sandbox"""
    
    from sms_service import SMSService
    
    print("=" * 70)
    print("Twilio WhatsApp Sandbox Test")
    print("=" * 70)
    
    sms_service = SMSService()
    
    print("\n✓ Twilio WhatsApp Sandbox Configuration:")
    print(f"  Account SID: {sms_service.account_sid[:10]}...")
    print(f"  WhatsApp From: {sms_service.whatsapp_from}")
    print(f"  Status: {'✅ READY' if sms_service.is_whatsapp_available else '❌ NOT READY'}")
    
    print("\n📱 Setup Instructions:")
    print("  1. Go to: https://console.twilio.com/us/account/messaging/services")
    print("  2. Click: Messaging > Try it out > WhatsApp Sandbox")
    print("  3. Scan the QR code with WhatsApp from your phone")
    print("  4. Text 'join <code>' to confirm (code shown on Twilio console)")
    print("  5. Your phone is now in the sandbox!")
    print("  6. Run this test again...")
    
    if sms_service.is_whatsapp_available:
        # The custom number where you verified in sandbox
        # This should be the phone number where you scanned the QR code
        your_phone = input("\n📲 Enter your WhatsApp phone number (e.g., +917999952770): ").strip()
        
        if not your_phone:
            print("\n❌ No phone number provided!")
            return
        
        print(f"\n✓ Sending test WhatsApp to {your_phone}...")
        
        message = "🚨 Suraksha Setu WhatsApp Sandbox Test: This message confirms WhatsApp integration is working! No action needed. Reply 'hi' to confirm."
        
        result = await sms_service.send_whatsapp(your_phone, message)
        
        print(f"\n  Result:")
        print(f"  To: {result.get('to')}")
        print(f"  Success: {result.get('success')}")
        print(f"  Mock: {result.get('mock')}")
        
        if result.get('sid'):
            print(f"  Message SID: {result['sid']}")
            print(f"\n✅ WhatsApp Message Sent Successfully!")
        
        if result.get('error'):
            print(f"\n❌ Error: {result['error']}")
            if "Invalid From and To pair" in result['error']:
                print("\n⚠️  Phone number not in sandbox!")
                print("  Remember: You must scan the QR code and send 'join <code>' first")
            elif "not a valid" in result['error']:
                print("\n⚠️  Invalid phone number format!")
                print("  Use international format: +1234567890")
    else:
        print("\n❌ WhatsApp not configured!")
        print("  Check: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM in .env")
    
    print("\n" + "=" * 70)

if __name__ == "__main__":
    asyncio.run(test_whatsapp_sandbox())
