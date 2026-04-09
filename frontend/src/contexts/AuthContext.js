import React, { createContext, useState, useContext, useEffect } from 'react';
import { auth, loginWithEmail, loginWithGoogle, registerWithEmail, logout as firebaseLogout, isFirebaseConfigured, saveUserProfile, getUserProfile } from '../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';

const AuthContext = createContext(null);
const BACKEND = process.env.REACT_APP_BACKEND_URL || process.env.REACT_APP_API_URL || 'http://localhost:8000';

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Admin emails - configurable list of admin users
const ADMIN_EMAILS = [
  's.sam.11221177@gmail.com',
];

// Developer emails - full access to all dashboards and tools
const DEVELOPER_EMAILS = [
  'lightrex06@gmail.com',
];

const isAdminEmail = (email) => ADMIN_EMAILS.includes(email?.toLowerCase());
const isDeveloperEmail = (email) => DEVELOPER_EMAILS.includes(email?.toLowerCase());

const resolvePrivilegedRoleByEmail = (email) => {
  if (isDeveloperEmail(email)) return 'developer';
  if (isAdminEmail(email)) return 'admin';
  return null;
};

// Resolve user role: check Firestore profile first, then admin email list, then default
const resolveUserRole = async (firebaseUser, fallbackRole = 'citizen') => {
  // Privileged emails should always retain elevated access.
  const privilegedRole = resolvePrivilegedRoleByEmail(firebaseUser?.email);
  if (privilegedRole) return privilegedRole;

  try {
    const profile = await getUserProfile(firebaseUser.uid);
    if (profile?.role) return profile.role;
  } catch (e) {
    // Firestore lookup failed, fall through
  }
  return fallbackRole;
};

// ── Location helpers ──────────────────────────────────────────────────────────
const LOCATION_CACHE_KEY = 'user_location_cache';
const LOCATION_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

const readLocationCache = () => {
  try {
    const raw = localStorage.getItem(LOCATION_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (Date.now() > cached.expiresAt) {
      localStorage.removeItem(LOCATION_CACHE_KEY);
      return null;
    }
    return cached;
  } catch {
    return null;
  }
};

const writeLocationCache = (data) => {
  try {
    localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ ...data, expiresAt: Date.now() + LOCATION_CACHE_TTL }));
  } catch {}
};

const reverseGeocode = async (lat, lon) => {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    const city = a.city || a.town || a.village || a.county || a.state_district || '';
    const state = a.state || '';
    const country = a.country || 'India';
    const display = [city, state, country].filter(Boolean).join(', ');
    const fullAddress = data.display_name || display;
    return { city, state, country, display, fullAddress };
  } catch {
    return null;
  }
};

export const detectUserLocation = () =>
  new Promise((resolve) => {
    // 1. Return cache immediately if fresh
    const cached = readLocationCache();
    if (cached) { resolve(cached); return; }

    if (!navigator.geolocation) { resolve(null); return; }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        const geo = await reverseGeocode(lat, lon);
        const result = {
          lat, lon, accuracy,
          city: geo?.city || '',
          state: geo?.state || '',
          country: geo?.country || 'India',
          display: geo?.display || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
          fullAddress: geo?.fullAddress || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
        };
        writeLocationCache(result);
        resolve(result);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
// ─────────────────────────────────────────────────────────────────────────────

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [userLocation, setUserLocation] = useState(() => readLocationCache());

  const syncBackendUserProfile = async (firebaseUser, idToken, role) => {
    if (!firebaseUser?.uid || !idToken) return;

    try {
      await fetch(`${BACKEND}/api/profile/${firebaseUser.uid}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firebase_display_name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
          firebase_email: firebaseUser.email || '',
          firebase_photo_url: firebaseUser.photoURL || undefined,
          firebase_role: role || 'citizen',
        }),
      });
    } catch (err) {
      // Best-effort sync only; auth should continue even if backend is temporarily unreachable.
      console.warn('Backend user sync skipped:', err?.message || err);
    }
  };

  // Check Firebase configuration on mount
  useEffect(() => {
    if (!isFirebaseConfigured) {
      console.error('❌ Firebase is not properly configured');
      setError('Firebase configuration error. Please check console for details.');
      setFirebaseReady(false);
      setLoading(false);
    } else {
      setFirebaseReady(true);
    }
  }, []);

  useEffect(() => {
    // Check for persisted session first
    const storedUser = localStorage.getItem('auth_user');
    const storedToken = localStorage.getItem('auth_token');
    const tokenExpiry = localStorage.getItem('auth_token_expiry');

    // Validate token expiry
    if (storedUser && storedToken && tokenExpiry) {
      const expiryTime = parseInt(tokenExpiry, 10);
      if (Date.now() < expiryTime) {
        try {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
          setToken(storedToken);
          setLoading(false);
          console.log('Session restored for:', parsedUser.email);
          // Detect/refresh GPS location in background after session restore
          detectUserLocation().then((loc) => { if (loc) setUserLocation(loc); }).catch(() => {});
          return;
        } catch (e) {
          console.error('Failed to restore session:', e);
          // Clear invalid session data
          localStorage.removeItem('auth_user');
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_token_expiry');
        }
      } else {
        console.log('Session expired, clearing stored data');
        localStorage.removeItem('auth_user');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_token_expiry');
      }
    }

    // Firebase authentication state listener
    if (!auth || !firebaseReady) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // User is signed in
        const idToken = await firebaseUser.getIdToken();

        // Resolve role from Firestore profile or admin email list
        const userRole = await resolveUserRole(firebaseUser);

        const userData = {
          id: firebaseUser.uid,
          email: firebaseUser.email,
          name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
          photoURL: firebaseUser.photoURL,
          role: userRole,
          emailVerified: firebaseUser.emailVerified
        };

        setUser(userData);
        setToken(idToken);

        // Store in localStorage with 1-hour expiry
        const expiryTime = Date.now() + (60 * 60 * 1000); // 1 hour
        localStorage.setItem('auth_token', idToken);
        localStorage.setItem('auth_user', JSON.stringify(userData));
        localStorage.setItem('auth_token_expiry', expiryTime.toString());

        // Ensure Firebase-authenticated users always exist in backend DB.
        await syncBackendUserProfile(firebaseUser, idToken, userRole);

        // Detect location in background (uses cache if fresh)
        detectUserLocation().then((loc) => { if (loc) setUserLocation(loc); });
      } else {
        // User is signed out
        setUser(null);
        setToken(null);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        localStorage.removeItem('auth_token_expiry');
      }
      setLoading(false);
    });

    // Cleanup subscription on unmount
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [firebaseReady]);

  const login = async (email, password) => {
    if (!firebaseReady || !auth) {
      throw new Error('Firebase authentication is not configured. Please check your Firebase setup.');
    }
    try {
      setError(null);
      setLoading(true);
      const firebaseUser = await loginWithEmail(email, password);
      const idToken = await firebaseUser.getIdToken();

      // Resolve role from Firestore profile or admin email list
      const userRole = await resolveUserRole(firebaseUser);

      const userData = {
        id: firebaseUser.uid,
        email: firebaseUser.email,
        name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
        photoURL: firebaseUser.photoURL,
        role: userRole,
        emailVerified: firebaseUser.emailVerified
      };

      // Store with expiry
      const expiryTime = Date.now() + (60 * 60 * 1000); // 1 hour
      localStorage.setItem('auth_token', idToken);
      localStorage.setItem('auth_user', JSON.stringify(userData));
      localStorage.setItem('auth_token_expiry', expiryTime.toString());

      setUser(userData);
      setToken(idToken);

      await syncBackendUserProfile(firebaseUser, idToken, userRole);
      return userData;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const register = async (email, password, displayName, role = 'citizen', phone = '') => {
    if (!firebaseReady || !auth) {
      throw new Error('Firebase authentication is not configured. Please check your Firebase setup.');
    }
    try {
      setError(null);
      setLoading(true);
      const firebaseUser = await registerWithEmail(email, password, displayName);
      const idToken = await firebaseUser.getIdToken();

      // Use selected role unless this email is privileged.
      const userRole = resolvePrivilegedRoleByEmail(firebaseUser.email) || role;

      // Normalize phone number
      const normalizedPhone = phone.replace(/[\s\-]/g, '');
      const phoneWithCode = normalizedPhone.startsWith('+91') ? normalizedPhone : `+91${normalizedPhone}`;

      const userData = {
        id: firebaseUser.uid,
        email: firebaseUser.email,
        name: displayName || email.split('@')[0],
        photoURL: firebaseUser.photoURL,
        role: userRole,
        phone: phoneWithCode,
        emailVerified: firebaseUser.emailVerified
      };

      // Save user profile with phone to Firestore
      await saveUserProfile(firebaseUser.uid, {
        email: firebaseUser.email,
        name: displayName || email.split('@')[0],
        role: userRole,
        phone: phoneWithCode,
        smsAlerts: true,
        createdAt: new Date().toISOString(),
      });

      // Also register phone on backend for SMS alerts
      try {
        const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
        await fetch(`${API_URL}/api/users/register-phone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          body: JSON.stringify({ uid: firebaseUser.uid, phone: phoneWithCode, email: firebaseUser.email, name: displayName }),
        });
      } catch (backendErr) {
        console.warn('Backend phone registration deferred:', backendErr.message);
      }

      // Store with expiry
      const expiryTime = Date.now() + (60 * 60 * 1000); // 1 hour
      localStorage.setItem('auth_token', idToken);
      localStorage.setItem('auth_user', JSON.stringify(userData));
      localStorage.setItem('auth_token_expiry', expiryTime.toString());

      setUser(userData);
      setToken(idToken);

      await syncBackendUserProfile(firebaseUser, idToken, userRole);
      return userData;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    if (!firebaseReady || !auth) {
      throw new Error('Firebase authentication is not configured. Please check your Firebase setup.');
    }
    try {
      setError(null);
      setLoading(true);
      const firebaseUser = await loginWithGoogle();
      const idToken = await firebaseUser.getIdToken();

      // Resolve role from Firestore profile or admin email list
      const userRole = await resolveUserRole(firebaseUser);

      const userData = {
        id: firebaseUser.uid,
        email: firebaseUser.email,
        name: firebaseUser.displayName || 'User',
        photoURL: firebaseUser.photoURL,
        role: userRole,
        emailVerified: true
      };

      // Store with expiry
      const expiryTime = Date.now() + (60 * 60 * 1000); // 1 hour
      localStorage.setItem('auth_token', idToken);
      localStorage.setItem('auth_user', JSON.stringify(userData));
      localStorage.setItem('auth_token_expiry', expiryTime.toString());

      setUser(userData);
      setToken(idToken);

      await syncBackendUserProfile(firebaseUser, idToken, userRole);
      return userData;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    if (!firebaseReady || !auth) {
      // Still allow logout even if Firebase is down
      setUser(null);
      setToken(null);
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      localStorage.removeItem('auth_token_expiry');
      // location cache is kept — same device, same location likely
      return;
    }
    try {
      setError(null);
      await firebaseLogout();
      setUser(null);
      setToken(null);
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      localStorage.removeItem('auth_token_expiry');
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const refreshToken = async () => {
    if (!firebaseReady || !auth) {
      console.warn('Cannot refresh token: Firebase not configured');
      return null;
    }
    if (auth.currentUser) {
      const idToken = await auth.currentUser.getIdToken(true);
      const expiryTime = Date.now() + (60 * 60 * 1000); // 1 hour
      setToken(idToken);
      localStorage.setItem('auth_token', idToken);
      localStorage.setItem('auth_token_expiry', expiryTime.toString());
      return idToken;
    }
    return null;
  };



  const value = {
    user,
    token,
    login,
    register,
    signInWithGoogle,
    logout,
    refreshToken,
    loading,
    error,
    isAuthenticated: !!user,
    firebaseReady,
    userLocation,
    detectLocation: () => detectUserLocation().then((loc) => { if (loc) setUserLocation(loc); return loc; }),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
