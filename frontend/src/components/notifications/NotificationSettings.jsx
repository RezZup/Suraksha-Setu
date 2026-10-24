import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Check, X, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import {
  isNotificationSupported,
  getNotificationPermission,
  initializePushNotifications,
  unsubscribeFromPushNotifications,
  showLocalNotification,
  getCurrentSubscription,
} from '@/utils/notifications';

const NotificationSettings = ({ compact = false }) => {
  const [permission, setPermission] = useState('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    checkNotificationStatus();
  }, []);

  const checkNotificationStatus = async () => {
    setSupported(isNotificationSupported());
    setPermission(getNotificationPermission());
    
    const subscription = await getCurrentSubscription();
    setIsSubscribed(!!subscription);
  };

  const handleEnableNotifications = async () => {
    setLoading(true);
    
    try {
      const result = await initializePushNotifications();
      
      if (result.success) {
        setPermission('granted');
        setIsSubscribed(true);
        toast.success('🔔 Notifications Enabled!', {
          description: 'You will receive instant disaster alerts',
        });

        // Show test notification
        setTimeout(() => {
          showLocalNotification('✅ Notifications Active', {
            body: 'You will now receive real-time disaster alerts',
            icon: '/logo192.png',
            tag: 'setup-complete',
          });
        }, 1000);
      } else {
        throw new Error(result.error || 'Failed to enable notifications');
      }
    } catch (error) {
      console.error('Error enabling notifications:', error);
      
      if (error.message.includes('denied')) {
        toast.error('Permission Denied', {
          description: 'Please enable notifications in your browser settings',
        });
      } else {
        toast.error('Failed to Enable Notifications', {
          description: error.message,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDisableNotifications = async () => {
    setLoading(true);
    
    try {
      await unsubscribeFromPushNotifications();
      setIsSubscribed(false);
      toast.success('Notifications Disabled', {
        description: 'You will no longer receive push notifications',
      });
    } catch (error) {
      console.error('Error disabling notifications:', error);
      toast.error('Failed to Disable Notifications', {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTestNotification = async () => {
    try {
      await showLocalNotification('🧪 Test Alert', {
        body: 'This is a test notification from DrishtiSetu',
        icon: '/logo192.png',
        badge: '/logo192.png',
        tag: 'test-notification',
        requireInteraction: false,
        actions: [
          { action: 'view', title: 'View' },
          { action: 'dismiss', title: 'Dismiss' },
        ],
      });
      toast.success('Test notification sent!');
    } catch (error) {
      toast.error('Failed to send test notification');
    }
  };

  if (!supported) {
    return (
      <Card className="p-4 bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
          <div>
            <h4 className="font-semibold text-yellow-900 dark:text-yellow-100">
              Notifications Not Supported
            </h4>
            <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
              Your browser doesn't support push notifications. Please use a modern browser like Chrome, Firefox, or Edge.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {isSubscribed ? (
          <>
            <Badge variant="default" className="gap-1 bg-green-600">
              <Bell className="w-3 h-3" />
              Notifications On
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisableNotifications}
              disabled={loading}
              className="h-6 px-2"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <BellOff className="w-3 h-3" />}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={handleEnableNotifications}
            disabled={loading}
            className="gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
            Enable Alerts
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold">Push Notifications</h3>
          </div>
          {permission === 'granted' && (
            <Badge variant="outline" className="gap-1">
              <Check className="w-3 h-3" />
              Enabled
            </Badge>
          )}
          {permission === 'denied' && (
            <Badge variant="destructive" className="gap-1">
              <X className="w-3 h-3" />
              Blocked
            </Badge>
          )}
        </div>

        {/* Status Display */}
        {isSubscribed ? (
          <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Check className="w-5 h-5 text-green-600" />
                <p className="font-semibold text-green-900 dark:text-green-100">
                  Notifications Active
                </p>
              </div>
              <p className="text-sm text-green-700 dark:text-green-300">
                You will receive instant alerts for disasters in your area, even when the app is closed.
              </p>
              <div className="flex gap-2 mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestNotification}
                  className="gap-2"
                >
                  <Bell className="w-4 h-4" />
                  Send Test
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisableNotifications}
                  disabled={loading}
                  className="gap-2 text-red-600 hover:text-red-700"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <BellOff className="w-4 h-4" />
                  )}
                  Disable
                </Button>
              </div>
            </div>
          </div>
        ) : permission === 'denied' ? (
          <div className="p-4 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <X className="w-5 h-5 text-red-600" />
                <p className="font-semibold text-red-900 dark:text-red-100">
                  Permission Denied
                </p>
              </div>
              <p className="text-sm text-red-700 dark:text-red-300">
                Notification permission was blocked. To enable alerts:
              </p>
              <ol className="text-sm text-red-700 dark:text-red-300 list-decimal list-inside space-y-1 mt-2">
                <li>Click the lock icon in your browser's address bar</li>
                <li>Find "Notifications" in the permissions list</li>
                <li>Change it to "Allow"</li>
                <li>Refresh this page</li>
              </ol>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-blue-600" />
                <p className="font-semibold text-blue-900 dark:text-blue-100">
                  Enable Instant Alerts
                </p>
              </div>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Get real-time disaster notifications even when the app is closed. Stay informed about:
              </p>
              <ul className="text-sm text-blue-700 dark:text-blue-300 list-disc list-inside space-y-1">
                <li>Severe weather warnings (cyclones, floods, heatwaves)</li>
                <li>Earthquake alerts in your region</li>
                <li>Air quality emergencies</li>
                <li>Evacuation notices</li>
              </ul>
              <Button
                onClick={handleEnableNotifications}
                disabled={loading}
                className="w-full gap-2 mt-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    <Bell className="w-4 h-4" />
                    Enable Push Notifications
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Info */}
        <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            💡 <strong>Privacy:</strong> Notifications are sent directly to your device. 
            We don't store personal information and you can disable them anytime.
          </p>
        </div>
      </div>
    </Card>
  );
};

export default NotificationSettings;
