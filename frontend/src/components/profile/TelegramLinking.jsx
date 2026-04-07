import React, { useState } from 'react';
import { MessageCircle, ExternalLink, Check, X, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import axios from 'axios';

/**
 * TelegramLinking Component
 * ──────────────────────────
 * Allows users to link their Telegram Chat ID
 * 
 * Flow:
 * 1. User clicks "Open Telegram Bot"
 * 2. Opens @getidsbot to get Chat ID
 * 3. User pastes Chat ID in input field
 * 4. Auto-saves to database
 * 5. Shows confirmation
 */

export default function TelegramLinking({ userId, firebaseToken, currentChatId }) {
  const [chatId, setChatId] = useState(currentChatId || '');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

  const handleOpenBot = () => {
    // Open @getidsbot to help user get their Chat ID
    window.open('https://t.me/getidsbot', '_blank');
  };

  const handleLinkTelegram = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!chatId.trim()) {
      setError('Please enter your Telegram Chat ID');
      return;
    }

    if (!/^\d+$/.test(chatId.trim())) {
      setError('Chat ID must contain only numbers');
      return;
    }

    const token = firebaseToken || localStorage.getItem('auth_token') || '';
    if (!token) {
      setError('Please sign in again, then retry linking your Telegram Chat ID');
      return;
    }

    setLoading(true);

    try {
      const response = await axios.post(
        `${API_URL}/api/profile/telegram/link-chat-id`,
        {
          chat_id: chatId.trim(),
          firebase_token: firebaseToken,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.data.success) {
        setSuccess(true);
        setChatId(response.data.chat_id);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        err.message ||
        'Failed to save Telegram Chat ID'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 border-blue-200 dark:border-blue-800">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <div>
              <h3 className="text-lg font-semibold">Telegram Alerts</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Get disaster alerts on Telegram
              </p>
            </div>
          </div>
          {currentChatId && (
            <Badge className="bg-green-600 gap-1">
              <Check className="w-3 h-3" />
              Linked
            </Badge>
          )}
        </div>

        {/* Current Chat ID */}
        {currentChatId && (
          <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg border border-green-300 dark:border-green-700">
            <p className="text-sm text-green-800 dark:text-green-200">
              <strong>Chat ID:</strong> {currentChatId}
            </p>
          </div>
        )}

        {/* How it works */}
        <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h4 className="font-semibold text-sm mb-3">How to link:</h4>
          <ol className="text-sm space-y-2 text-gray-700 dark:text-gray-300">
            <li className="flex gap-2">
              <span className="font-bold text-blue-600">1.</span>
              <span>Click "Open Telegram Bot" button</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-blue-600">2.</span>
              <span>Search for @getidsbot or start it</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-blue-600">3.</span>
              <span>It will show your Chat ID (looks like: 123456789)</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-blue-600">4.</span>
              <span>Copy the number and paste it below</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-blue-600">5.</span>
              <span>Click "Link Telegram" - done! ✅</span>
            </li>
          </ol>
        </div>

        {/* Input Section */}
        <form onSubmit={handleLinkTelegram} className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Your Telegram Chat ID</label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="e.g., 123456789"
                value={chatId}
                onChange={(e) => setChatId(e.target.value.replace(/\D/g, ''))}
                disabled={loading}
                className="flex-1 text-lg tracking-wider"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleOpenBot}
                disabled={loading}
                title="Open Telegram bot to get your Chat ID"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Only numbers, no special characters
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900 rounded border border-red-300 dark:border-red-700 flex gap-2">
              <X className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="p-3 bg-green-100 dark:bg-green-900 rounded border border-green-300 dark:border-green-700 flex gap-2">
              <Check className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-green-800 dark:text-green-200">
                Chat ID linked successfully! You'll receive Telegram alerts.
              </p>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={loading || !chatId.trim()}
              className="flex-1 gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Link Telegram
                </>
              )}
            </Button>
          </div>
        </form>

        {/* Info Box */}
        <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg border border-blue-300 dark:border-blue-700">
          <p className="text-xs text-blue-800 dark:text-blue-200">
            <strong>💡 Tip:</strong> You can also click the "Enable Disaster Alerts" button in our Telegram bot (@settu9856bot) to auto-link your Chat ID instantly!
          </p>
        </div>
      </div>
    </Card>
  );
}
