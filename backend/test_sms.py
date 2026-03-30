#!/usr/bin/env python3
"""
Test SMS and WhatsApp functionality
"""
import asyncio
import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

async def test_sms_service():
    """Test SMS service configuration and send a test SMS"""
    
    from sms_service import SMSService
    
    print("=" * 60)
    print("SMS & WhatsApp Service Test")
    print("=" * 60)
    
    # Initialize SMS Service
    sms_service = SMSService()
    
    # Check configuration
    print("\n✓ Configuration Status:")
    print(f"  Account SID: {sms_service.account_sid[:10]}..." if sms_service.account_sid else "  Account SID: ❌ NOT CONFIGURED")
    print(f"  Auth Token: {sms_service.auth_token[:10]}..." if sms_service.auth_token else "  Auth Token: ❌ NOT CONFIGURED")
    print(f"  From Number: {sms_service.from_number}" if sms_service.from_number else "  From Number: ❌ NOT CONFIGURED")
    print(f"  WhatsApp From: {sms_service.whatsapp_from}" if sms_service.whatsapp_from else "  WhatsApp From: ❌ NOT CONFIGURED")
    
    print(f"\n✓ Service Status:")
    print(f"  SMS Available: {'✅ YES' if sms_service.is_available else '❌ NO'}")
    print(f"  WhatsApp Available: {'✅ YES' if sms_service.is_whatsapp_available else '❌ NO'}")
    
    # Test SMS sending
    if sms_service.is_available:
        print("\n✓ Sending Test SMS...")
        test_phone = "+917999952770"  # Your provided number
        test_message = "🚨 Suraksha Setu Test Alert: SMS service is working correctly! No action needed."
        
        result = await sms_service.send_sms(test_phone, test_message)
        
        print(f"\n  To: {result.get('to')}")
        print(f"  Success: {result.get('success')}")
        print(f"  Mock: {result.get('mock')}")
        if result.get('sid'):
            print(f"  SID: {result['sid']}")
        if result.get('error'):
            print(f"  Error: {result['error']}")
        
        if result.get('success'):
            print("\n✅ SMS sent successfully!")
        else:
            print("\n❌ SMS failed!")
    else:
        print("\n⚠️  SMS service not available (running in mock mode)")
        print("   To enable: Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER in .env")
    
    # Test WhatsApp sending
    if sms_service.is_whatsapp_available:
        print("\n✓ Sending Test WhatsApp...")
        result = await sms_service.send_whatsapp(test_phone, "Test WhatsApp message")
        print(f"  Success: {result.get('success')}")
        if result.get('success'):
            print("✅ WhatsApp sent successfully!")
    else:
        print("\n⚠️  WhatsApp service not available")
    
    print("\n" + "=" * 60)
    print("Test Complete!")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_sms_service())
