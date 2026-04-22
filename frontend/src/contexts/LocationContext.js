import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import axios from 'axios';
import useWebSocket from '@/hooks/useWebSocket';
import { useAuth } from '@/contexts/AuthContext';
import { readLocationCache, saveLocationCache, clearLocationCache } from '@/utils/locationCache';

const LocationContext = createContext();

export const useLocation = () => {
  const context = useContext(LocationContext);
  if (!context) {
    throw new Error('useLocation must be used within LocationProvider');
  }
  return context;
};

const BACKEND = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

export const LocationProvider = ({ children }) => {
  const { user, token } = useAuth();
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [alerts, setAlerts] = useState([]);

  // gpsPincode  = auto-detected from GPS on app open (read-only)
  // homePincode = user-set "home" pincode saved in profile
  const [gpsPincode, setGpsPincode] = useState(() => localStorage.getItem('gps_pincode') || '');
  const [homePincode, setHomePincode] = useState(() => localStorage.getItem('home_pincode') || '');

  const clientIdRef = useRef(
    sessionStorage.getItem('ws_client_id') || (() => {
      const id = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      sessionStorage.setItem('ws_client_id', id);
      return id;
    })()
  );
  const profileSyncStateRef = useRef({ inFlight: false, lastAttemptAt: 0 });

  const wsUrl =
    BACKEND.replace('http://', 'ws://').replace('https://', 'wss://') +
    `/api/ws/${clientIdRef.current}`;

  const {
    isConnected: wsConnected,
    lastMessage: wsMessage,
    setLocation: wsSetLocation,
    requestAlerts: wsRequestAlerts,
  } = useWebSocket(wsUrl, {
    onMessage: (message) => {
      if (message.type === 'new_alert') {
        setAlerts((prev) => {
          if (prev.some((a) => a.id === message.id)) return prev;
          return [message, ...prev];
        });
      } else if (message.type === 'alerts_list') {
        setAlerts(message.alerts || []);
      }
    },
    autoReconnect: true,
    maxReconnectAttempts: 5,
    reconnectInterval: 3000,
  });

  useEffect(() => {
    const cached = readLocationCache();
    if (cached) {
      setLocation(cached);
      localStorage.setItem('userLocation', JSON.stringify(cached));
    } else {
      const saved = localStorage.getItem('userLocation');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setLocation(parsed);
          saveLocationCache(parsed);
        } catch {}
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!location) {
      detectLocation();
      return;
    }

    // Cached location renders immediately, then refresh in background.
    detectLocation({ background: true });
  }, []); // eslint-disable-line

  useEffect(() => {
    if (location && wsConnected) {
      wsSetLocation({
        latitude: location.latitude,
        longitude: location.longitude,
        city: location.city,
        state: location.state,
        pin_code: location.gps_pincode || gpsPincode || location.pin_code,
      });
    }
  }, [location, wsConnected, wsSetLocation, gpsPincode]);

  useEffect(() => {
    if (location?.latitude && location?.longitude) {
      fetchNearbyAlerts(location.latitude, location.longitude);
    }
  }, [location]);

  // Persist latest location + pincode into backend user profile so proximity alerts work for all logged-in accounts.
  useEffect(() => {
    if (!user?.id || !token || !location) return;

    const gpsLat = location.latitude ?? location.lat;
    const gpsLon = location.longitude ?? location.lon;
    if (gpsLat == null || gpsLon == null) return;

    const payload = {
      gps_lat: Number(gpsLat),
      gps_lon: Number(gpsLon),
      gps_pincode: gpsPincode || location.gps_pincode || location.pin_code || undefined,
      gps_city: location.city || undefined,
      gps_state: location.state || undefined,
      home_pincode: homePincode || undefined,
    };

    const signature = JSON.stringify(payload);
    const syncKey = `profile_location_sync_${user.id}`;
    if (localStorage.getItem(syncKey) === signature) return;

    const now = Date.now();
    if (profileSyncStateRef.current.inFlight) return;
    if (now - profileSyncStateRef.current.lastAttemptAt < 15000) return;

    const sync = async () => {
      profileSyncStateRef.current.inFlight = true;
      profileSyncStateRef.current.lastAttemptAt = Date.now();
      try {
        await axios.put(`${BACKEND}/api/profile/${user.id}`, payload, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        });
        localStorage.setItem(syncKey, signature);
      } catch (e) {
        console.warn('Profile location sync failed:', e?.message || e);
      } finally {
        profileSyncStateRef.current.inFlight = false;
      }
    };

    sync();
  }, [user, token, location, gpsPincode, homePincode]);

  const detectLocation = async ({ background = false } = {}) => {
    if (!background) setLoading(true);
    setError(null);
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => { await updateLocationByCoords(pos.coords.latitude, pos.coords.longitude, { silent: background }); },
          async (geoErr) => {
            console.warn('Geolocation failed, using IP detection:', geoErr.message);
            await detectLocationByIP({ silent: background });
          }
        );
      } else {
        await detectLocationByIP({ silent: background });
      }
    } catch {
      setError('Failed to detect location');
      if (!background) setLoading(false);
    }
  };

  const detectLocationByIP = async ({ silent = false } = {}) => {
    try {
      const res = await axios.get(`${BACKEND}/api/location/current`, { timeout: 10000 });
      const ld = {
        latitude: res.data.lat, longitude: res.data.lon,
        city: res.data.city, state: res.data.region || res.data.country,
        pin_code: res.data.zip || null, method: 'ip',
      };
      setLocation(ld);
      localStorage.setItem('userLocation', JSON.stringify(ld));
      saveLocationCache(ld);
      setError(null);
    } catch (err) {
      setError(err.code === 'ECONNABORTED' ? 'Connection timeout.' : 'Unable to detect location automatically.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const updateLocationByCoords = async (latitude, longitude, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await axios.post(
        `${BACKEND}/api/location/update`,
        { latitude, longitude, enable_alerts: true, alert_severity: ['warning', 'critical'] },
        { timeout: 10000 }
      );
      if (res.data.success) {
        const ld = { ...res.data.location, method: 'gps' };
        setLocation(ld);
        localStorage.setItem('userLocation', JSON.stringify(ld));
        saveLocationCache(ld);
        setError(null);
        
        // Reverse-geocode for pincode (optional, don't fail if it times out)
        try {
          const rgRes = await axios.get(`${BACKEND}/api/location/reverse-geocode`, {
            params: { lat: latitude, lon: longitude }, 
            timeout: 5000,  // Reduced timeout to 5 seconds
          });
          
          if (rgRes.data.success && rgRes.data.pincode) {
            const pc = rgRes.data.pincode;
            setGpsPincode(pc);
            localStorage.setItem('gps_pincode', pc);
            setLocation((prev) => {
              if (!prev) return prev;
              const next = {
                ...prev,
                gps_pincode: pc,
                city: prev.city || rgRes.data.city,
                state: prev.state || rgRes.data.state,
              };
              localStorage.setItem('userLocation', JSON.stringify(next));
              saveLocationCache(next);
              return next;
            });
          }
        } catch (rgErr) { 
          // Log warning but don't fail - user can still set location via PIN
          console.warn('Reverse geocode timeout (this is OK):', rgErr.message); 
        }
      }
    } catch (err) {
      setError(err.code === 'ECONNABORTED' ? 'Connection timeout.' : 'Unable to update location.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const updateLocationByPincode = async (pinCode) => {
    setLoading(true);
    setError(null);
    try {
      if (!pinCode || !/^\d{6}$/.test(pinCode)) throw new Error('PIN code must be 6 digits');
      const vRes = await axios.post(`${BACKEND}/api/location/validate-pincode`, { pin_code: pinCode }, { timeout: 10000 });
      if (!vRes.data?.is_valid) throw new Error('Invalid PIN code');
      const uRes = await axios.post(
        `${BACKEND}/api/location/update`,
        { pin_code: pinCode, enable_alerts: true, alert_severity: ['warning', 'critical'] },
        { timeout: 10000 }
      );
      if (uRes.data.success) {
        const ld = { ...uRes.data.location, method: 'pincode' };
        setLocation(ld);
        localStorage.setItem('userLocation', JSON.stringify(ld));
        saveLocationCache(ld);
        setHomePincode(pinCode);
        localStorage.setItem('home_pincode', pinCode);
        setError(null);
        setLoading(false);
        return { success: true, location: ld };
      }
      setLoading(false);
      return { success: true };
    } catch (err) {
      let msg = 'Unable to verify PIN code. Please try again.';
      if (err.code === 'ECONNABORTED') msg = 'Request timeout.';
      else if (err.response?.status === 400) msg = err.response?.data?.detail || 'Invalid PIN code';
      else if (err.response?.status >= 500) msg = 'Server error. Please try again later.';
      else if (err.message) msg = err.message;
      setError(msg);
      setLoading(false);
      return { success: false, error: msg };
    }
  };

  const setHomePincodeAndSave = (pincode) => {
    setHomePincode(pincode);
    localStorage.setItem('home_pincode', pincode);
  };

  const fetchNearbyAlerts = async (latitude, longitude, radiusKm = 50) => {
    const fetchGlobalAlerts = async () => {
      try {
        const globalRes = await axios.get(`${BACKEND}/api/alerts`, { timeout: 10000 });
        const globalAlerts = Array.isArray(globalRes?.data?.alerts) ? globalRes.data.alerts : [];
        setAlerts(globalAlerts.slice(0, 50));
      } catch {
        setAlerts([]);
      }
    };

    try {
      const res = await axios.get(`${BACKEND}/api/location/nearby-alerts`, {
        params: { lat: latitude, lon: longitude, radius_km: radiusKm },
      });
      const nearbyAlerts = Array.isArray(res?.data?.alerts) ? res.data.alerts : [];
      if (nearbyAlerts.length > 0) {
        setAlerts(nearbyAlerts);
        return;
      }

      // Fallback: show latest active alerts even when no geocoded matches are found.
      await fetchGlobalAlerts();
    } catch {
      await fetchGlobalAlerts();
    }
  };

  const clearLocation = () => {
    setLocation(null);
    localStorage.removeItem('userLocation');
    clearLocationCache();
    setAlerts([]);
  };

  const refreshNearbyAlerts = () => {
    if (location?.latitude && location?.longitude) {
      fetchNearbyAlerts(location.latitude, location.longitude);
      if (wsConnected) wsRequestAlerts();
    }
  };

  const value = {
    location, loading, error, alerts, wsConnected,
    gpsPincode, homePincode, setHomePincodeAndSave,
    detectLocation, updateLocationByPincode, updateLocationByCoords,
    clearLocation, refreshNearbyAlerts,
  };

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
};
