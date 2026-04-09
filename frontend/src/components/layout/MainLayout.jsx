import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link, useLocation as useRouterLocation, Outlet, useNavigate } from 'react-router-dom';
import { useLocation } from '@/contexts/LocationContext';
import { 
  LayoutDashboard, 
  Map, 
  Bell, 
  CloudRain, 
  Flame, 
  Users, 
  GraduationCap, 
  Microscope, 
  ShieldAlert,
  BarChart3,
  Menu,
  X,
  Search,
  UserCircle,
  Phone,
  LogOut,
  MessageSquare,
  Heart,
  CheckCheck
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from '@/contexts/AuthContext';
import BrandWatermark from '@/components/layout/BrandWatermark';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useTranslation } from 'react-i18next';
import { getAuthHeadersForApi } from '@/utils/authHeaders';
import useWebSocket from '@/hooks/useWebSocket';

const SidebarItem = ({ icon: Icon, label, path, active, collapsed }) => (
  <Link 
    to={path}
    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group
      ${active 
        ? 'bg-primary/10 text-primary font-medium' 
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
  >
    <Icon className={`h-5 w-5 ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
    {!collapsed && <span>{label}</span>}
    {collapsed && <div className="absolute left-16 bg-popover text-popover-foreground px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 pointer-events-none shadow-md z-50 whitespace-nowrap border">{label}</div>}
  </Link>
);

const MainLayout = () => {
  const routerLocation = useRouterLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { alerts } = useLocation();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAlertsDropdown, setShowAlertsDropdown] = useState(false);
  const [headerSearchTerm, setHeaderSearchTerm] = useState('');
  const [showSearchMenu, setShowSearchMenu] = useState(false);
  const [searchHighlight, setSearchHighlight] = useState(0);
  const alertsDropdownRef = useRef(null);
  const searchBoxRef = useRef(null);

  // Community notifications
  const [communityNotifs, setCommunityNotifs] = useState([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [notifFilter, setNotifFilter] = useState('all');
  const BACKEND = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
  const COMMUNITY_API = `${BACKEND}/api/community`;
  const currentUserId = user?.id || user?.uid;
  const bellSocketClientIdRef = useRef(`bell_${Math.random().toString(36).slice(2, 12)}`);

  const fetchBellNotifications = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const res = await fetch(`${COMMUNITY_API}/notifications/${currentUserId}?limit=20`, {
        headers: getAuthHeadersForApi(BACKEND, 'citizen'),
      });
      if (res.ok) {
        const data = await res.json();
        setCommunityNotifs(data.notifications || []);
        setUnreadNotifCount(data.unread_count || 0);
      }
    } catch (e) {
      // silent
    }
  }, [BACKEND, COMMUNITY_API, currentUserId]);

  const handleBellSocketMessage = useCallback((message) => {
    if (!message || !currentUserId) return;

    if (message.type === 'in_app_notification' && message.notification) {
      const incoming = message.notification;
      if (String(incoming.user_id || '') !== String(currentUserId)) return;

      setCommunityNotifs((prev) => {
        if (prev.some((item) => item.id === incoming.id)) return prev;
        return [incoming, ...prev].slice(0, 30);
      });

      if (!incoming.is_read) {
        setUnreadNotifCount((prev) => prev + 1);
      }
    }

    if (message.type === 'in_app_refresh') {
      fetchBellNotifications();
    }
  }, [currentUserId, fetchBellNotifications]);

  const bellSocketUrl = currentUserId
    ? `${BACKEND.replace('http://', 'ws://').replace('https://', 'wss://')}/api/ws/${bellSocketClientIdRef.current}_${encodeURIComponent(currentUserId)}`
    : null;

  const {
    isConnected: bellSocketConnected,
    sendMessage: sendBellSocketMessage,
  } = useWebSocket(bellSocketUrl, {
    onMessage: handleBellSocketMessage,
    autoReconnect: true,
    reconnectInterval: 2000,
    maxReconnectAttempts: 12,
  });

  useEffect(() => {
    if (!currentUserId) {
      setCommunityNotifs([]);
      setUnreadNotifCount(0);
      return;
    }

    fetchBellNotifications();
    const iv = setInterval(fetchBellNotifications, 30000);
    return () => clearInterval(iv);
  }, [currentUserId, fetchBellNotifications]);

  useEffect(() => {
    if (!currentUserId || !bellSocketConnected) return;
    sendBellSocketMessage({
      type: 'subscribe_user',
      user_id: currentUserId,
    });
  }, [currentUserId, bellSocketConnected, sendBellSocketMessage]);

  const markAllNotifsRead = async () => {
    if (!currentUserId || unreadNotifCount === 0) return;
    try {
      await fetch(`${COMMUNITY_API}/notifications/read-all/${currentUserId}`, {
        method: 'POST',
        headers: getAuthHeadersForApi(BACKEND, 'citizen'),
      });
      setCommunityNotifs(n => n.map(x => ({ ...x, is_read: true })));
      setUnreadNotifCount(0);
    } catch (e) { /* silent */ }
  };

  // ── Push notification registration (for proximity community alerts) ───────
  useEffect(() => {
    if (!currentUserId) return;
    const registerPush = async () => {
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        // Request permission
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return;
        // Get VAPID public key
        const keyRes = await fetch(`${BACKEND}/api/push/vapid-public-key`);
        if (!keyRes.ok) return;
        const { public_key } = await keyRes.json();
        // Register SW
        const reg = await navigator.serviceWorker.ready;
        // Convert VAPID key
        const raw = atob(public_key.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, ''));
        const uint8 = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) uint8[i] = raw.charCodeAt(i);
        // Subscribe
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: uint8 });
        // Get current GPS position for proximity
        let lat = null; let lon = null;
        try {
          const pos = await new Promise((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000, enableHighAccuracy: true })
          );
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
        } catch {}
        // Send subscription + location to backend
        await fetch(`${BACKEND}/api/notifications/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub.toJSON(), user_id: currentUserId, user_lat: lat, user_lon: lon }),
        });
      } catch (e) { /* silent — push not critical */ }
    };
    registerPush();
  }, [currentUserId, BACKEND]);

  // Close alerts dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (alertsDropdownRef.current && !alertsDropdownRef.current.contains(event.target)) {
        setShowAlertsDropdown(false);
      }
    };

    if (showAlertsDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAlertsDropdown]);

  const getInitials = (name) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  // Prefer custom/DiceBear avatar saved in localStorage over Firebase photoURL
  const displayAvatar = localStorage.getItem('user_avatar_url') || user?.photoURL || null;

  const getUserTypeLabel = (type) => {
    const labels = {
      student: t('role.student'),
      scientist: t('role.scientist'),
      admin: t('role.admin'),
      citizen: t('role.citizen')
    };
    return labels[type] || t('role.user');
  };

  const notificationFilters = [
    { key: 'all', label: 'All' },
    { key: 'messages', label: 'Messages' },
    { key: 'alerts', label: 'Alerts' },
    { key: 'broadcasts', label: 'Broadcasts' },
  ];

  const getNotificationCategory = (notif) => {
    const type = String(notif?.type || '').toLowerCase();
    if (['dm', 'direct_message', 'message', 'comment', 'reply', 'like'].includes(type)) {
      return 'messages';
    }
    if (['broadcast', 'admin_broadcast'].includes(type)) {
      return 'broadcasts';
    }
    return 'alerts';
  };

  const filteredCommunityNotifs = useMemo(() => {
    if (notifFilter === 'all') return communityNotifs;
    return communityNotifs.filter((n) => getNotificationCategory(n) === notifFilter);
  }, [communityNotifs, notifFilter]);

  const visibleSystemAlerts = useMemo(() => {
    if (notifFilter !== 'all' && notifFilter !== 'alerts') return [];
    return (alerts || []).slice(0, 5);
  }, [alerts, notifFilter]);

  const resolveNotifDestination = (notif) => {
    const type = String(notif?.type || '').toLowerCase();
    if (['dm', 'direct_message', 'message'].includes(type)) {
      const params = new URLSearchParams({ dm: '1' });
      if (notif?.from_user_id) params.set('partner_id', String(notif.from_user_id));
      if (notif?.from_name) params.set('partner_name', String(notif.from_name));
      if (notif?.from_photo) params.set('partner_photo', String(notif.from_photo));
      if (notif?.post_id) params.set('post_id', String(notif.post_id));
      if (notif?.message) params.set('post_snippet', String(notif.message).slice(0, 180));
      return `/app/community?${params.toString()}`;
    }
    if (['broadcast', 'admin_broadcast', 'admin_review', 'system_alert', 'alert'].includes(type)) {
      return '/app/alerts';
    }
    return '/app/community';
  };

  const handleNotificationClick = async (notif) => {
    if (!notif) return;

    if (currentUserId && notif.id && !notif.is_read) {
      try {
        await fetch(`${COMMUNITY_API}/notifications/${notif.id}/read`, {
          method: 'POST',
          headers: getAuthHeadersForApi(BACKEND, 'citizen'),
        });
      } catch (e) {
        // silent
      }
      setCommunityNotifs((prev) => prev.map((item) => (item.id === notif.id ? { ...item, is_read: true } : item)));
      setUnreadNotifCount((prev) => Math.max(0, prev - 1));
    }

    navigate(resolveNotifDestination(notif));
    setShowAlertsDropdown(false);
  };

  const renderNotifIcon = (notifType) => {
    const type = String(notifType || '').toLowerCase();
    if (type === 'comment') return <MessageSquare className="w-3 h-3 text-blue-500 shrink-0" />;
    if (type === 'reply') return <MessageSquare className="w-3 h-3 text-indigo-500 shrink-0" />;
    if (type === 'like') return <Heart className="w-3 h-3 text-red-500 shrink-0" />;
    if (['dm', 'direct_message', 'message'].includes(type)) return <MessageSquare className="w-3 h-3 text-emerald-500 shrink-0" />;
    if (['broadcast', 'admin_broadcast'].includes(type)) return <Bell className="w-3 h-3 text-orange-500 shrink-0" />;
    if (type === 'admin_review') return <ShieldAlert className="w-3 h-3 text-violet-500 shrink-0" />;
    return <Bell className="w-3 h-3 text-muted-foreground shrink-0" />;
  };

  // Base navigation items for all users (citizen)
  const baseNavItems = [
    { icon: LayoutDashboard, label: t('nav.dashboard'), path: '/app/dashboard' },
    { icon: Map, label: t('nav.map'), path: '/app/map' },
    { icon: Bell, label: t('nav.alerts'), path: '/app/alerts' },
    { icon: CloudRain, label: t('nav.weather'), path: '/app/weather' },
    { icon: Flame, label: t('nav.disasters'), path: '/app/disasters' },
    { icon: BarChart3, label: t('nav.analytics'), path: '/app/analytics' },
    { icon: Users, label: t('nav.community'), path: '/app/community' },
    { icon: Phone, label: t('nav.contacts'), path: '/app/critical-contacts' },
    { icon: UserCircle, label: t('nav.myProfile'), path: '/app/profile' },
  ];

  // Role-specific navigation items
  const roleNavItems = {
    student: { icon: GraduationCap, label: t('nav.studentPortal'), path: '/app/student' },
    scientist: { icon: Microscope, label: t('nav.scientistPortal'), path: '/app/scientist' },
    admin: { icon: ShieldAlert, label: t('nav.adminDashboard'), path: '/app/admin' },
  };

  // Build navigation items based on user role
  const getNavItems = () => {
    const items = [...baseNavItems];
    const userRole = user?.role || 'citizen';

    if (userRole === 'developer') {
      // Developer sees ALL tabs for testing
      items.push(roleNavItems.student);
      items.push(roleNavItems.scientist);
      items.push(roleNavItems.admin);
    } else if (userRole === 'admin') {
      // Admin sees all tabs
      items.push(roleNavItems.student);
      items.push(roleNavItems.scientist);
      items.push(roleNavItems.admin);
    } else if (userRole === 'student') {
      // Student sees base + student tab
      items.push(roleNavItems.student);
    } else if (userRole === 'scientist') {
      // Scientist sees base + scientist tab
      items.push(roleNavItems.scientist);
    }
    // Citizen sees only base tabs

    return items;
  };

  const navItems = getNavItems();

  const searchableItems = useMemo(() => {
    const q = headerSearchTerm.trim().toLowerCase();
    if (!q) return [];

    const pageHits = navItems
      .filter((item) => item.label.toLowerCase().includes(q))
      .map((item) => ({
        type: 'page',
        key: `page:${item.path}`,
        label: item.label,
        description: t('layout.searchGoToPage'),
        value: item.path,
      }));

    const alertHits = (alerts || [])
      .filter((a) => [a?.title, a?.description, a?.location].some((v) => String(v || '').toLowerCase().includes(q)))
      .slice(0, 4)
      .map((a, idx) => ({
        type: 'alert',
        key: `alert:${a?.id || idx}`,
        label: a?.title || t('nav.alerts'),
        description: `${t('layout.searchInAlerts')} ${String(a?.severity || '').toUpperCase()}`.trim(),
        value: a?.title || '',
      }));

    const communityHits = (communityNotifs || [])
      .filter((n) => [n?.title, n?.message].some((v) => String(v || '').toLowerCase().includes(q)))
      .slice(0, 3)
      .map((n, idx) => ({
        type: 'community',
        key: `community:${n?.id || idx}`,
        label: n?.title || t('nav.community'),
        description: t('layout.searchInCommunity'),
        value: '/app/community',
      }));

    return [...pageHits, ...alertHits, ...communityHits].slice(0, 8);
  }, [headerSearchTerm, navItems, alerts, communityNotifs, t]);

  const selectSearchItem = (item) => {
    if (!item) return;
    if (item.type === 'page') {
      navigate(item.value);
    } else if (item.type === 'alert') {
      navigate(`/app/alerts?q=${encodeURIComponent(item.value)}`);
    } else {
      navigate(item.value || '/app/community');
    }
    setShowSearchMenu(false);
    setHeaderSearchTerm('');
    setSearchHighlight(0);
  };

  const submitSearch = () => {
    const q = headerSearchTerm.trim();
    if (!q) return;
    if (searchableItems.length > 0) {
      selectSearchItem(searchableItems[Math.min(searchHighlight, searchableItems.length - 1)]);
      return;
    }
    navigate(`/app/alerts?q=${encodeURIComponent(q)}`);
    setShowSearchMenu(false);
    setHeaderSearchTerm('');
    setSearchHighlight(0);
  };

  const handleSearchKeyDown = (event) => {
    if (!showSearchMenu && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setShowSearchMenu(true);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSearchHighlight((prev) => Math.min(prev + 1, Math.max(0, searchableItems.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSearchHighlight((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      submitSearch();
    } else if (event.key === 'Escape') {
      setShowSearchMenu(false);
    }
  };

  useEffect(() => {
    setSearchHighlight(0);
  }, [headerSearchTerm]);

  useEffect(() => {
    const handleSearchClickOutside = (event) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target)) {
        setShowSearchMenu(false);
      }
    };
    document.addEventListener('mousedown', handleSearchClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleSearchClickOutside);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      {/* Sidebar */}
      <aside 
        className={`fixed inset-y-0 left-0 z-50 bg-card border-r border-border transition-all duration-300 ease-in-out flex flex-col
          ${collapsed ? 'w-16' : 'w-64'}
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        <div className="h-16 flex items-center px-4 border-b border-border justify-between">
          {!collapsed && (
            <div className="flex items-center gap-3 font-bold text-xl tracking-tight">
              <img src="/main_logo.png" alt="Suraksha Setu" className="h-12 w-12 object-contain" />
              <span className="text-primary">Suraksha<span className="text-foreground"> Setu</span></span>
            </div>
          )}
          {collapsed && <img src="/main_logo.png" alt="Logo" className="h-12 w-12 object-contain mx-auto" />}
          <Button 
            variant="ghost" 
            size="icon" 
            className="hidden md:flex h-8 w-8 ml-auto" 
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            className="md:hidden h-8 w-8 ml-auto" 
            onClick={() => setMobileMenuOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {navItems.map((item) => (
            <SidebarItem 
              key={item.path} 
              {...item} 
              active={routerLocation.pathname === item.path} 
              collapsed={collapsed}
            />
          ))}
        </div>

        <div className="p-4 border-t border-border">
          {!collapsed ? (
            <button
              onClick={() => navigate('/app/profile')}
              className="w-full flex items-center gap-3 rounded-lg p-2 hover:bg-muted transition-colors text-left"
            >
              <Avatar className="h-9 w-9 border border-border shrink-0">
                <AvatarImage src={displayAvatar} alt={user?.name} referrerPolicy="no-referrer" />
                <AvatarFallback>{user ? getInitials(user.name) : 'U'}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-sm font-medium truncate">{user?.name || 'User'}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">{user ? getUserTypeLabel(user.user_type) : 'Citizen'}</span>
                  {user?.role && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                      {user.role}
                    </Badge>
                  )}
                </div>
              </div>
              <UserCircle className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          ) : (
            <button
              onClick={() => navigate('/app/profile')}
              className="w-full flex justify-center p-1 rounded-lg hover:bg-muted transition-colors"
              title="My Profile"
            >
              <Avatar className="h-8 w-8 border border-border">
                <AvatarImage src={displayAvatar} alt={user?.name} referrerPolicy="no-referrer" />
                <AvatarFallback className="text-xs">{user?.name?.charAt(0) || 'U'}</AvatarFallback>
              </Avatar>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main 
        className={`flex-1 flex flex-col min-h-screen transition-all duration-300 ease-in-out
          ${collapsed ? 'md:ml-16' : 'md:ml-64'}
        `}
      >
        {/* Header */}
        <header className="h-16 sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon" 
              className="md:hidden" 
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div ref={searchBoxRef} className="hidden md:flex items-center relative max-w-md w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                value={headerSearchTerm}
                onChange={(e) => {
                  setHeaderSearchTerm(e.target.value);
                  setShowSearchMenu(true);
                }}
                onFocus={() => setShowSearchMenu(true)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('layout.searchPlaceholder')}
                className="pl-9 bg-muted/50 border-none focus-visible:ring-1"
              />
              {showSearchMenu && headerSearchTerm.trim() && (
                <div className="absolute top-11 left-0 right-0 rounded-lg border bg-popover shadow-xl z-50 overflow-hidden">
                  {searchableItems.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-muted-foreground">
                      {t('layout.searchNoResults')}
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-auto">
                      {searchableItems.map((item, index) => (
                        <button
                          key={item.key}
                          type="button"
                          className={`w-full text-left px-3 py-2.5 border-b last:border-b-0 transition-colors ${index === searchHighlight ? 'bg-muted' : 'hover:bg-muted/70'}`}
                          onClick={() => selectSearchItem(item)}
                        >
                          <p className="text-sm font-medium truncate">{item.label}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{item.description}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/40 border-t">
                    {t('layout.searchHint')}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Dynamic Alert Badge - Only show if there are critical alerts */}
            {alerts && alerts.length > 0 && alerts.some(a => a.severity === 'critical' || a.severity === 'red') && (
              <div 
                className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-destructive/10 text-destructive rounded-full text-sm font-medium animate-pulse cursor-pointer hover:bg-destructive/20 transition-colors"
                onClick={() => navigate('/app/alerts')}
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
                </span>
                {alerts.find(a => a.severity === 'critical' || a.severity === 'red')?.title || 'Critical Alert'}
              </div>
            )}
            {/* Language Switcher */}
            <LanguageSwitcher />
            {/* Bell Icon with Alerts Dropdown */}
            <div className="relative" ref={alertsDropdownRef}>
              <Button 
                variant="ghost" 
                size="icon" 
                className="relative"
                onClick={() => { setShowAlertsDropdown(!showAlertsDropdown); if (!showAlertsDropdown) markAllNotifsRead(); }}
              >
                <Bell className="h-5 w-5 text-muted-foreground" />
                {(alerts?.length > 0 || unreadNotifCount > 0) && (
                  <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white border-2 border-background">
                    {(unreadNotifCount + (alerts?.length || 0)) > 9 ? '9+' : (unreadNotifCount + (alerts?.length || 0))}
                  </span>
                )}
              </Button>
              
              {/* Alerts + Notifications Dropdown */}
              {showAlertsDropdown && (
                <div className="absolute right-0 top-12 w-96 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-4 py-3 flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Bell className="w-4 h-4" />
                      Notifications
                      {(unreadNotifCount + (alerts?.length || 0)) > 0 && (
                        <span className="bg-white/25 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                          {unreadNotifCount + (alerts?.length || 0)}
                        </span>
                      )}
                    </h3>
                    <div className="flex items-center gap-1">
                      {unreadNotifCount > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-white hover:bg-white/20 rounded-lg"
                          title="Mark all read"
                          onClick={markAllNotifsRead}
                        >
                          <CheckCheck className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-white hover:bg-white/20 rounded-lg"
                        onClick={() => setShowAlertsDropdown(false)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="px-3 py-2 border-b bg-muted/20 flex flex-wrap gap-1.5">
                    {notificationFilters.map((filter) => (
                      <button
                        key={filter.key}
                        type="button"
                        onClick={() => setNotifFilter(filter.key)}
                        className={`px-2 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                          notifFilter === filter.key
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted'
                        }`}
                      >
                        {filter.label}
                      </button>
                    ))}
                    {!bellSocketConnected && currentUserId && (
                      <span className="ml-auto text-[10px] text-muted-foreground">Live reconnecting...</span>
                    )}
                  </div>

                  <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
                    {/* Community notifications */}
                    {filteredCommunityNotifs.length > 0 && (
                      <div>
                        <div className="px-3 py-1.5 bg-muted/50 border-b">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent Activity</span>
                        </div>
                        {filteredCommunityNotifs.map((n) => (
                          <div
                            key={n.id}
                            className={`p-3 border-b hover:bg-muted/40 cursor-pointer transition-colors flex items-start gap-3 ${!n.is_read ? 'bg-blue-50/60 dark:bg-blue-900/10' : ''}`}
                            onClick={() => handleNotificationClick(n)}
                          >
                            <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${!n.is_read ? 'bg-blue-500' : 'bg-transparent'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                {renderNotifIcon(n.type)}
                                <p className="text-xs font-semibold text-foreground truncate">{n.title}</p>
                              </div>
                              <p className="text-[11px] text-muted-foreground line-clamp-2">{n.message}</p>
                              <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                                {n.timestamp ? new Date(n.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* System Alerts */}
                    {visibleSystemAlerts.length > 0 && (
                      <div>
                        <div className="px-3 py-1.5 bg-muted/50 border-b">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Disaster Alerts</span>
                        </div>
                        {visibleSystemAlerts.map((alert, idx) => (
                          <div
                            key={alert.id || idx}
                            className="p-3 hover:bg-muted/50 cursor-pointer transition-colors border-b last:border-0"
                            onClick={() => { navigate('/app/alerts'); setShowAlertsDropdown(false); }}
                          >
                            <div className="flex items-start gap-2">
                              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                                alert.severity === 'critical' || alert.severity === 'red'
                                  ? 'bg-red-500 animate-pulse'
                                  : alert.severity === 'warning' || alert.severity === 'orange'
                                  ? 'bg-orange-500'
                                  : 'bg-blue-500'
                              }`} />
                              <div className="flex-1 min-w-0">
                                <h4 className="text-xs font-semibold text-foreground truncate">{alert.title}</h4>
                                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{alert.description || alert.message}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  {alert.location || 'Unknown'} · {alert.issued_at || alert.time ? new Date(alert.issued_at || alert.time).toLocaleTimeString() : ''}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Empty state */}
                    {visibleSystemAlerts.length === 0 && filteredCommunityNotifs.length === 0 && (
                      <div className="p-8 text-center text-muted-foreground">
                        <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm font-medium">All caught up!</p>
                        <p className="text-xs mt-1">No notifications right now.</p>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-border p-2 bg-muted/30 flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-xs hover:bg-muted"
                      onClick={() => { navigate('/app/alerts'); setShowAlertsDropdown(false); }}
                    >
                      View All Alerts
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-xs hover:bg-muted"
                      onClick={() => { navigate('/app/community'); setShowAlertsDropdown(false); }}
                    >
                      Go to Community
                    </Button>
                  </div>
                </div>
              )}
            </div>
            
            {/* User Profile Dropdown with Logout */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                  <Avatar className="h-8 w-8 border-2 border-primary/20">
                    <AvatarImage src={displayAvatar} alt={user?.name} referrerPolicy="no-referrer" />
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                      {user ? getInitials(user.name) : 'U'}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user?.name || 'User'}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/app/profile')} className="cursor-pointer">
                  <UserCircle className="mr-2 h-4 w-4" />
                  <span>My Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Badge variant="outline" className="mr-2 text-xs">
                    {user?.role || 'citizen'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {getUserTypeLabel(user?.role || 'citizen')}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  className="text-destructive focus:text-destructive cursor-pointer"
                  onClick={async () => {
                    try {
                      await logout();
                      navigate('/login');
                    } catch (error) {
                      console.error('Logout error:', error);
                    }
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Logout</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-6 overflow-y-auto">
          <Outlet />
        </div>
      </main>

      {/* Brand Watermark - Bottom Right Logo */}
      <BrandWatermark />
    </div>
  );
};

export default MainLayout;
