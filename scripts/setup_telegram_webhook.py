#!/usr/bin/env python3
"""
Telegram Webhook Setup Script
──────────────────────────────

This script helps configure Telegram webhooks for Suraksha Setu bot.

Usage:
    python scripts/setup_telegram_webhook.py --token <BOT_TOKEN> --url <WEBHOOK_URL> --secret <SECRET>

Examples:
    # Production setup
    python scripts/setup_telegram_webhook.py \
        --token "123456789:ABC-DEF1234ghIkl" \
        --url "https://suraksha-setu.com/api/telegram/webhook" \
        --secret "random_secret_token_min_20_chars"

    # Check current webhook status
    python scripts/setup_telegram_webhook.py --token "123456789:ABC-DEF1234ghIkl" --check

    # Delete webhook (back to polling)
    python scripts/setup_telegram_webhook.py --token "123456789:ABC-DEF1234ghIkl" --delete
"""

import sys
import argparse
import json
import httpx
import os
from pathlib import Path


class TelegramWebhookSetup:
    """Helper class for Telegram webhook configuration."""

    def __init__(self, token: str):
        """Initialize with bot token."""
        self.token = token
        self.api_url = f"https://api.telegram.org/bot{token}"

    def set_webhook(self, url: str, secret: str = "") -> bool:
        """
        Set webhook on Telegram servers.
        
        Args:
            url: HTTPS URL for webhook (must be public)
            secret: Optional secret token for verification
        
        Returns:
            True if successful, False otherwise
        """
        if not url.startswith("https://"):
            print("❌ Error: Webhook URL must use HTTPS!")
            return False

        payload = {
            "url": url,
            "max_connections": 40,
            "allowed_updates": ["message", "callback_query"],
        }

        if secret:
            payload["secret_token"] = secret

        try:
            response = httpx.post(
                f"{self.api_url}/setWebhook",
                data=payload,
                timeout=10.0
            )
            data = response.json()

            if data.get("ok"):
                print("✅ Webhook set successfully!")
                print(f"   Webhook URL: {url}")
                if secret:
                    print(f"   Secret token: {secret[:10]}...")
                return True
            else:
                print(f"❌ Failed to set webhook: {data.get('description')}")
                return False

        except Exception as e:
            print(f"❌ Error setting webhook: {e}")
            return False

    def get_webhook_info(self) -> dict:
        """Get current webhook information."""
        try:
            response = httpx.get(
                f"{self.api_url}/getWebhookInfo",
                timeout=10.0
            )
            data = response.json()

            if data.get("ok"):
                return data.get("result", {})
            else:
                print(f"❌ Error: {data.get('description')}")
                return {}

        except Exception as e:
            print(f"❌ Error getting webhook info: {e}")
            return {}

    def delete_webhook(self) -> bool:
        """Delete webhook and revert to polling."""
        try:
            response = httpx.post(
                f"{self.api_url}/deleteWebhook",
                timeout=10.0
            )
            data = response.json()

            if data.get("ok"):
                print("✅ Webhook deleted successfully!")
                print("   Bot will use polling mode for updates.")
                return True
            else:
                print(f"❌ Failed to delete webhook: {data.get('description')}")
                return False

        except Exception as e:
            print(f"❌ Error deleting webhook: {e}")
            return False

    def get_bot_info(self) -> dict:
        """Get basic bot information."""
        try:
            response = httpx.get(
                f"{self.api_url}/getMe",
                timeout=10.0
            )
            data = response.json()

            if data.get("ok"):
                return data.get("result", {})
            else:
                print(f"❌ Error: {data.get('description')}")
                return {}

        except Exception as e:
            print(f"❌ Error getting bot info: {e}")
            return {}

    def test_webhook(self, test_url: str) -> bool:
        """
        Test webhook by sending a test request.
        
        Args:
            test_url: HTTPS URL to test
        
        Returns:
            True if webhook responds with 200 OK
        """
        test_payload = {
            "update_id": 999999,
            "message": {
                "message_id": 1,
                "date": 0,
                "chat": {"id": 123456789, "type": "private"},
                "from": {"id": 123456789, "is_bot": False, "first_name": "Test"},
                "text": "/start",
            }
        }

        try:
            response = httpx.post(
                test_url,
                json=test_payload,
                headers={"Content-Type": "application/json"},
                timeout=10.0
            )

            if response.status_code == 200:
                print("✅ Webhook test successful (200 OK)!")
                return True
            else:
                print(f"❌ Webhook returned status {response.status_code}")
                print(f"   Response: {response.text}")
                return False

        except Exception as e:
            print(f"❌ Error testing webhook: {e}")
            return False


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Telegram Webhook Setup for Suraksha Setu"
    )
    parser.add_argument(
        "--token",
        required=True,
        help="Telegram Bot API token (from @BotFather)"
    )
    parser.add_argument(
        "--url",
        help="Webhook URL (must be HTTPS, e.g., https://domain.com/api/telegram/webhook)"
    )
    parser.add_argument(
        "--secret",
        help="Secret token for webhook verification (auto-generated if not provided)",
        default=""
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check current webhook status"
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help="Delete webhook (revert to polling)"
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Test webhook with a sample request"
    )
    parser.add_argument(
        "--info",
        action="store_true",
        help="Show bot information"
    )

    args = parser.parse_args()

    # Create setup helper
    setup = TelegramWebhookSetup(args.token)

    # Show bot info
    if args.info:
        print("\n📱 Bot Information:")
        print("─" * 50)
        info = setup.get_bot_info()
        if info:
            print(f"ID: {info.get('id')}")
            print(f"Username: @{info.get('username')}")
            print(f"First Name: {info.get('first_name')}")
            print(f"Is Bot: {info.get('is_bot')}")
            print(f"Can Edit Group: {info.get('can_edit_group_chat')}")
            print(f"Can Join Groups: {info.get('can_join_groups')}")
        return

    # Check webhook status
    if args.check:
        print("\n🔗 Webhook Status:")
        print("─" * 50)
        info = setup.get_webhook_info()
        if info:
            print(f"URL: {info.get('url', 'Not set')}")
            print(f"Pending Updates: {info.get('pending_update_count', 0)}")
            print(f"Max Connections: {info.get('max_connections', 'N/A')}")
            allowed = info.get('allowed_updates', [])
            print(f"Allowed Updates: {', '.join(allowed) if allowed else 'All'}")
            
            if info.get('url'):
                print("\n✅ Webhook is configured!")
            else:
                print("\n⚠️  No webhook set. Using polling mode.")
        return

    # Delete webhook
    if args.delete:
        print("\n🗑️  Deleting webhook...")
        print("─" * 50)
        setup.delete_webhook()
        return

    # Set webhook
    if args.url:
        if not args.secret:
            # Auto-generate secret if not provided
            import secrets
            args.secret = secrets.token_urlsafe(32)
            print("🔐 Generated secret token (save this for .env):")
            print(f"   {args.secret}\n")

        print("\n🚀 Setting webhook...")
        print("─" * 50)
        success = setup.set_webhook(args.url, args.secret)

        if success and args.test:
            print("\n🧪 Testing webhook...")
            print("─" * 50)
            setup.test_webhook(args.url)

        if success:
            print("\n📝 Update your backend/.env with:")
            print("─" * 50)
            print(f"TELEGRAM_BOT_TOKEN={args.token}")
            print(f"TELEGRAM_WEBHOOK_SECRET={args.secret}")
            print(f"BACKEND_URL={args.url.replace('/api/telegram/webhook', '')}")

        return

    # Show help if no action specified
    if not args.check and not args.delete and not args.info:
        parser.print_help()


if __name__ == "__main__":
    main()
