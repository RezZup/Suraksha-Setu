import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * WebSocket hook for real-time disaster alerts
 * Handles connection, reconnection, and message processing
 */
export const useWebSocket = (url, options = {}) => {
  const {
    onMessage = null,
    onConnect = null,
    onDisconnect = null,
    onError = null,
    autoReconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
    heartbeatInterval = 30000, // 30 seconds
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastMessage, setLastMessage] = useState(null);
  const [connectionStats, setConnectionStats] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const locationRef = useRef(null);
  const manualCloseRef = useRef(false);

  /**
   * Send message to WebSocket server
   */
  const sendMessage = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        return false;
      }
    }

    // Keep the latest location payload and send it once the socket reconnects.
    if (message?.type === 'set_location' && message?.location) {
      locationRef.current = message.location;
      return false;
    }

    console.warn('WebSocket not connected. Message not sent:', message);
    return false;
  }, []);

  /**
   * Set client location for targeted alerts
   */
  const setLocation = useCallback((location) => {
    locationRef.current = location;
    sendMessage({
      type: 'set_location',
      location: location,
    });
  }, [sendMessage]);

  /**
   * Request current alerts from server
   */
  const requestAlerts = useCallback(() => {
    sendMessage({
      type: 'request_alerts',
    });
  }, [sendMessage]);

  /**
   * Request connection statistics
   */
  const requestStats = useCallback(() => {
    sendMessage({
      type: 'get_stats',
    });
  }, [sendMessage]);

  /**
   * Start heartbeat to keep connection alive
   */
  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    heartbeatIntervalRef.current = setInterval(() => {
      sendMessage({ type: 'ping' });
    }, heartbeatInterval);
  }, [sendMessage, heartbeatInterval]);

  /**
   * Stop heartbeat
   */
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  /**
   * Connect to WebSocket server
   */
  const connect = useCallback(() => {
    if (!url) {
      return;
    }

    if (
      wsRef.current
      && (
        wsRef.current.readyState === WebSocket.OPEN
        || wsRef.current.readyState === WebSocket.CONNECTING
      )
    ) {
      console.log('WebSocket already connected');
      return;
    }

    try {
      console.log('Connecting to WebSocket:', url);
      manualCloseRef.current = false;
      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setReconnectAttempts(0);
        startHeartbeat();

        // Re-send location if it was set
        if (locationRef.current) {
          setLocation(locationRef.current);
        }

        if (onConnect) onConnect();
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('WebSocket message received:', message);
          setLastMessage(message);

          // Handle different message types
          if (message.type === 'new_alert') {
            // New disaster alert - notification removed as per user request
            // Alerts are displayed in the alerts page and dashboard instead
            console.log('New alert received:', message.title);
          } else if (message.type === 'pong') {
            // Heartbeat response (silent)
          } else if (message.type === 'connection') {
            // Welcome message
            console.log('Connection confirmed:', message.message);
          } else if (message.type === 'location_updated') {
            console.log('Location updated:', message.message);
          } else if (message.type === 'stats') {
            setConnectionStats(message.data);
          } else if (message.type === 'alerts_list') {
            console.log(`Received ${message.count} alerts`);
          }

          if (onMessage) onMessage(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      wsRef.current.onerror = (error) => {
        if (!manualCloseRef.current) {
          console.error('WebSocket error:', error);
        }
        // Don't show error toast - will handle in onclose if needed
        if (onError) onError(error);
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        stopHeartbeat();

        if (onDisconnect) onDisconnect();

        // Attempt reconnection with exponential backoff
        if (!manualCloseRef.current && autoReconnect && reconnectAttempts < maxReconnectAttempts) {
          // Exponential backoff: 3s, 6s, 12s, 24s, 48s (max 30s)
          const backoffDelay = Math.min(
            reconnectInterval * Math.pow(2, reconnectAttempts),
            30000
          );

          console.log(`Reconnecting in ${backoffDelay}ms... (Attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempts((prev) => prev + 1);
            connect();
          }, backoffDelay);
        }
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      if (onError) onError(error);
    }
  }, [url, onMessage, onConnect, onDisconnect, onError, autoReconnect, reconnectInterval, maxReconnectAttempts, reconnectAttempts, startHeartbeat, stopHeartbeat, setLocation]);

  /**
   * Disconnect from WebSocket server
   */
  const disconnect = useCallback(() => {
    manualCloseRef.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    stopHeartbeat();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
  }, [stopHeartbeat]);

  /**
   * Connect on mount, disconnect on unmount
   */
  useEffect(() => {
    if (!url) {
      disconnect();
      return () => {
        disconnect();
      };
    }

    connect();

    return () => {
      disconnect();
    };
  }, [url]); // Only reconnect if URL changes

  return {
    isConnected,
    lastMessage,
    connectionStats,
    reconnectAttempts,
    sendMessage,
    setLocation,
    requestAlerts,
    requestStats,
    connect,
    disconnect,
  };
};

export default useWebSocket;
