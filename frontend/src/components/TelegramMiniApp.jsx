import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuth } from 'firebase/auth';
import '../styles/TelegramMiniApp.css';

/**
 * TelegramMiniApp Component
 * ───────────────────────────
 * Handles automatic Chat ID registration from Telegram Mini App.
 * 
 * Flow:
 * 1. User opens @settu9856bot → clicks "Enable Disaster Alerts"
 * 2. Telegram launches this Mini App with window.Telegram.WebApp.initData
 * 3. Component extracts initData and calls /api/telegram/mini-app/register
 * 4. Backend validates signature and auto-registers Chat ID
 * 5. User is authenticated and ready for disaster alerts!
 * 
 * Usage: Add this route to your app:
 *   <Route path="/telegram-app" element={<TelegramMiniApp />} />
 * 
 * Then set your Mini App URL in BotFather to:
 *   https://yourdomain.com/telegram-app
 */

export default function TelegramMiniApp() {
  const navigate = useNavigate();
  const auth = getAuth();
  const [status, setStatus] = useState('initializing'); // initializing, registering, success, error
  const [message, setMessage] = useState('');
  const [userData, setUserData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const registerFromTelegram = async () => {
      try {
        // Check if we're in Telegram Mini App context
        if (!window.Telegram || !window.Telegram.WebApp) {
          setStatus('error');
          setError('❌ This app must be opened from Telegram. @settu9856bot → "Enable Disaster Alerts"');
          return;
        }

        const webApp = window.Telegram.WebApp;
        const initData = webApp.initData;

        if (!initData) {
          setStatus('error');
          setError('❌ Telegram initData not available. Please open from Telegram.');
          return;
        }

        console.log('📱 Telegram Mini App detected. Registering...');
        setStatus('registering');
        setMessage('🔐 Verifying with Telegram...');

        // Get Firebase token if user is logged in
        let firebaseToken = null;
        if (auth.currentUser) {
          firebaseToken = await auth.currentUser.getIdToken();
        }

        // Call backend to register
        const response = await fetch(
          `${process.env.REACT_APP_API_URL || 'http://localhost:8000'}/api/telegram/mini-app/register`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              init_data: initData,
              firebase_token: firebaseToken,
            }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || 'Registration failed');
        }

        // Success!
        setStatus('success');
        setMessage(data.message);
        setUserData({
          chat_id: data.chat_id,
          telegram_username: data.telegram_username,
          user_id: data.user_id,
        });

        console.log('✅ Chat ID registered:', data.chat_id);

        // Notify Telegram app
        webApp.showPopup({
          title: '✅ Success!',
          message: `Your Chat ID (${data.chat_id}) is now linked for disaster alerts!`,
          buttons: [{ id: 'ok', text: 'OK' }],
        });

        // Close Mini App after 2 seconds
        setTimeout(() => {
          webApp.close();
        }, 2000);
      } catch (err) {
        console.error('❌ Telegram registration error:', err);
        setStatus('error');
        setError(`❌ ${err.message || 'Registration failed'}`);

        if (window.Telegram?.WebApp) {
          window.Telegram.WebApp.showAlert(`Error: ${err.message}`);
        }
      }
    };

    registerFromTelegram();
  }, [auth]);

  return (
    <div className="telegram-mini-app">
      {/* Header */}
      <div className="telegram-header">
        <h1>🚨 Suraksha Setu Alerts</h1>
        <p>Disaster Alert System</p>
      </div>

      {/* Status Container */}
      <div className={`telegram-status-container telegram-status-${status}`}>
        {/* Loading State */}
        {status === 'initializing' && (
          <div className="telegram-loader">
            <div className="spinner"></div>
            <p>🔄 Initializing...</p>
          </div>
        )}

        {status === 'registering' && (
          <div className="telegram-loader">
            <div className="spinner"></div>
            <p>{message}</p>
          </div>
        )}

        {/* Success State */}
        {status === 'success' && (
          <div className="telegram-success">
            <div className="success-icon">✅</div>
            <h2>Registration Successful!</h2>
            <p>{message}</p>
            
            {userData && (
              <div className="telegram-info">
                <div className="info-item">
                  <span className="info-label">Chat ID:</span>
                  <span className="info-value">{userData.chat_id}</span>
                </div>
                {userData.telegram_username && (
                  <div className="info-item">
                    <span className="info-label">Username:</span>
                    <span className="info-value">@{userData.telegram_username}</span>
                  </div>
                )}
              </div>
            )}

            <div className="telegram-next-steps">
              <h3>📌 What's Next:</h3>
              <ul>
                <li>✅ Your Chat ID is now linked</li>
                <li>📍 Set your location in the Suraksha Setu app</li>
                <li>🔔 Receive real-time disaster alerts on Telegram</li>
              </ul>
            </div>

            <p className="telegram-footer">Closing in 2 seconds...</p>
          </div>
        )}

        {/* Error State */}
        {status === 'error' && (
          <div className="telegram-error">
            <div className="error-icon">⚠️</div>
            <h2>Registration Failed</h2>
            <p className="error-message">{error}</p>

            <div className="telegram-error-help">
              <h3>How to fix this:</h3>
              <ol>
                <li>Open <strong>Telegram</strong> app</li>
                <li>Search for <strong>@settu9856bot</strong></li>
                <li>Click <strong>"Enable Disaster Alerts"</strong> button</li>
                <li>Wait for the app to load</li>
              </ol>
            </div>

            <button
              className="telegram-retry-btn"
              onClick={() => {
                setStatus('initializing');
                setError(null);
                window.location.reload();
              }}
            >
              🔄 Retry
            </button>
          </div>
        )}
      </div>

      {/* Tips Section */}
      <div className="telegram-tips">
        <h3>💡 Tips:</h3>
        <ul>
          <li>This link connects your Telegram account for disaster alerts</li>
          <li>You'll receive instant notifications on Telegram</li>
          <li>Works completely free with @settu9856bot</li>
        </ul>
      </div>
    </div>
  );
}
