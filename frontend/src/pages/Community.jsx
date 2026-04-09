import React, { useState, useEffect } from 'react';
import { useLocation as useRouterLocation } from 'react-router-dom';
import { 
  Plus, Search, TrendingUp, 
  Award, Heart, Users, MapPin, 
  AlertCircle, HelpCircle, Megaphone,
  Loader2, Shield, Star, Hash, Map,
  MessageCircle, Bell, CheckCheck, Zap,
  Activity, ChevronRight, Sparkles
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import CommunityPost from '@/components/community/CommunityPost';
import CreatePostModal from '@/components/community/CreatePostModal';
import CommunityMap from '@/components/community/CommunityMap';
import DirectMessagePanel from '@/components/community/DirectMessagePanel';
import axios from 'axios';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation as useAppLocation } from '@/contexts/LocationContext';
import { getAuthHeadersForApi } from '@/utils/authHeaders';

const API_URL = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000') + '/api';

// Badge visual config — must mirror backend _compute_badge
const BADGE_CONFIG = {
  Guardian:  { emoji: '🌟', label: 'Guardian',  bg: 'bg-purple-100 text-purple-700 border-purple-200',  ring: 'ring-purple-400' },
  Saviour:   { emoji: '🛡️', label: 'Saviour',   bg: 'bg-indigo-100 text-indigo-700 border-indigo-200',  ring: 'ring-indigo-400' },
  Hero:      { emoji: '🦸', label: 'Hero',      bg: 'bg-blue-100   text-blue-700   border-blue-200',    ring: 'ring-blue-400'   },
  Responder: { emoji: '🤝', label: 'Responder', bg: 'bg-green-100  text-green-700  border-green-200',   ring: 'ring-green-400'  },
  Helper:    { emoji: '💚', label: 'Helper',    bg: 'bg-teal-100   text-teal-700   border-teal-200',    ring: 'ring-teal-400'   },
  Newcomer:  { emoji: '🌱', label: 'Newcomer',  bg: 'bg-gray-100   text-gray-600   border-gray-200',    ring: 'ring-gray-300'   },
};

const Community = () => {
  const routerLocation = useRouterLocation();
  const { user } = useAuth();
  const { gpsPincode, homePincode } = useAppLocation();
  const getAuthHeaders = () => getAuthHeadersForApi(API_URL, 'citizen');

  // Effective pincode: prefer home, fall back to GPS
  const effectivePincode = homePincode || gpsPincode;
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [showDMPanel, setShowDMPanel] = useState(false);
  const [dmInitialPartner, setDmInitialPartner] = useState(null);
  const [dmInitialPostId, setDmInitialPostId] = useState(null);
  const [dmInitialPostSnippet, setDmInitialPostSnippet] = useState(null);
  const [posts, setPosts] = useState([]);
  const [filteredPosts, setFilteredPosts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [hideResolved, setHideResolved] = useState(true);
  const [sortBy, setSortBy] = useState('recent');
  const [activeTab, setActiveTab] = useState('feed');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(routerLocation.search || '');
    if (params.get('dm') !== '1') return;

    const partnerId = params.get('partner_id');
    if (!partnerId) return;

    setDmInitialPartner({
      id: partnerId,
      name: params.get('partner_name') || 'Community Member',
      photo: params.get('partner_photo') || null,
    });
    setDmInitialPostId(params.get('post_id') || null);
    setDmInitialPostSnippet(params.get('post_snippet') || null);
    setShowDMPanel(true);
  }, [routerLocation.search]);

  const handleCloseDMPanel = () => {
    setShowDMPanel(false);
    setDmInitialPartner(null);
    setDmInitialPostId(null);
    setDmInitialPostSnippet(null);
  };

  // Auto-seed pincode filter from user's location context on first load
  useEffect(() => {
    if (effectivePincode && !activePin) {
      setActivePin(effectivePincode);
    }
  }, [effectivePincode]); // eslint-disable-line

  // Pincode filter
  const [pincodeInput, setPincodeInput] = useState('');
  const [activePin, setActivePin] = useState('');

  // User GPS for map
  const [userLocation, setUserLocation] = useState(null);
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => {}
      );
    }
  }, []);

  // Sidebar live data
  const [leaderboard, setLeaderboard] = useState([]);
  const [trendingTags, setTrendingTags] = useState([]);
  const [urgentPosts, setUrgentPosts] = useState([]);
  const [badgeByUser, setBadgeByUser] = useState({});

  // Fetch posts from backend
  const fetchPosts = async (pin = activePin) => {
    try {
      setLoading(true);
      const params = { limit: 50 };
      if (filterType !== 'all') params.type = filterType;
      if (pin) params.pincode = pin;
      const response = await axios.get(`${API_URL}/community/posts`, {
        params,
        headers: getAuthHeaders(),
      });
      setPosts(response.data.posts || []);
      setFilteredPosts(response.data.posts || []);
    } catch (error) {
      console.error('Error fetching posts:', error);
      setPosts([]);
      setFilteredPosts([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const res = await axios.get(`${API_URL}/community/leaderboard`);
      const board = res.data.leaderboard || [];
      setLeaderboard(board);
      // Build badge lookup: user_id → badge info
      const map = {};
      board.forEach(u => { if (u.user_id) map[u.user_id] = u.badge; });
      setBadgeByUser(map);
    } catch (e) {
      console.error('Leaderboard fetch error:', e);
    }
  };

  const fetchTrending = async () => {
    try {
      const res = await axios.get(`${API_URL}/community/trending-tags`);
      setTrendingTags(res.data.tags || []);
    } catch (e) {
      console.error('Trending tags fetch error:', e);
    }
  };

  const fetchUrgentPosts = async () => {
    try {
      const [helpRes, offerRes] = await Promise.all([
        axios.get(`${API_URL}/community/posts`, { params: { type: 'help', limit: 3 } }),
        axios.get(`${API_URL}/community/posts`, { params: { type: 'offer', limit: 3 } }),
      ]);
      const helps = (helpRes.data.posts || []).slice(0, 3);
      const offers = (offerRes.data.posts || []).slice(0, 2);
      setUrgentPosts([...helps, ...offers].slice(0, 5));
    } catch (e) {
      console.error('Urgent posts fetch error:', e);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, [filterType]);

  useEffect(() => {
    fetchLeaderboard();
    fetchTrending();
    fetchUrgentPosts();
  }, []);

  const applyPin = () => {
    const pin = pincodeInput.trim();
    setActivePin(pin);
    fetchPosts(pin);
  };

  const clearPin = () => {
    setPincodeInput('');
    setActivePin('');
    fetchPosts('');
  };

  // Filter and search posts
  useEffect(() => {
    let filtered = [...posts];

    // Apply type filter
    if (filterType !== 'all') {
      filtered = filtered.filter(post => post.type === filterType);
    }

    // Optionally hide resolved posts from the feed by default
    if (hideResolved) {
      filtered = filtered.filter(post => !post.is_resolved);
    }

    // Apply search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(post => 
        post.content.toLowerCase().includes(query) ||
        post.title?.toLowerCase().includes(query) ||
        post.author.toLowerCase().includes(query) ||
        post.location.toLowerCase().includes(query) ||
        post.tags?.some(tag => tag.toLowerCase().includes(query))
      );
    }

    // Apply sorting
    switch (sortBy) {
      case 'recent':
        filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        break;
      case 'popular':
        filtered.sort((a, b) => b.likes - a.likes);
        break;
      case 'commented':
        filtered.sort((a, b) => (b.comments?.length || 0) - (a.comments?.length || 0));
        break;
      default:
        break;
    }

    setFilteredPosts(filtered);
  }, [posts, filterType, hideResolved, searchQuery, sortBy]);

  const handlePostCreated = async (newPost) => {
    try {
      // Attach the user's pincode so the backend can do targeted delivery
      const postWithPincode = {
        ...newPost,
        pincode: newPost.pincode || effectivePincode || undefined,
      };
      const response = await axios.post(`${API_URL}/community/posts`, postWithPincode, {
        headers: getAuthHeaders(),
      });

      if (response.data.success && response.data.post) {
        setPosts((prev) => [response.data.post, ...prev]);
        if (response.data.post.verification_requires_admin_review) {
          toast.success('Post submitted for admin verification. You can track progress in your post card.');
        } else {
          toast.success('Post published!');
        }
      }
    } catch (error) {
      console.error('Error creating post:', error);
      toast.error('Failed to publish post');
    }
  };

  const handlePostLike = async (postId, liked) => {
    try {
      const response = await axios.post(`${API_URL}/community/posts/${postId}/like`, null, {
        params: {
          unlike: !liked,
          liker_id: user?.id,
          liker_name: user?.name || user?.displayName,
          liker_photo: user?.photoURL,
        }
      });
      if (response.data.success) {
        setPosts(posts.map(post => 
          post.id === postId 
            ? { ...post, likedByUser: response.data.liked, likes: response.data.likes }
            : post
        ));
      }
    } catch (error) {
      console.error('Error liking post:', error);
    }
  };

  const handlePostSave = async (postId, saved) => {
    try {
      const response = await axios.post(`${API_URL}/community/posts/${postId}/save`, null, {
        params: { unsave: !saved }
      });
      if (response.data.success) {
        setPosts(posts.map(post => 
          post.id === postId 
            ? { ...post, savedByUser: response.data.saved }
            : post
        ));
      }
    } catch (error) {
      console.error('Error saving post:', error);
    }
  };

  const handlePostDelete = async (postId) => {
    if (window.confirm('Are you sure you want to delete this post?')) {
      try {
        const response = await axios.delete(`${API_URL}/community/posts/${postId}`, {
          headers: getAuthHeaders(),
        });
        if (response.data.success) {
          setPosts(posts.filter(post => post.id !== postId));
        }
      } catch (error) {
        console.error('Error deleting post:', error);
      }
    }
  };

  const handlePostShare = (postId) => {
    console.log('Shared post:', postId);
  };

  const savedPosts = posts.filter(post => post.savedByUser);
  const myPosts = posts.filter(post =>
    (user?.id && post.user_id === user.id) ||
    (user?.name && post.author === user.name) ||
    (user?.email && post.author === user.email)
  );

  const getStatsData = () => {
    return {
      totalPosts: posts.length,
      totalHelps: posts.filter(p => p.type === 'help').length,
      totalOffers: posts.filter(p => p.type === 'offer').length,
      totalAlerts: posts.filter(p => p.type === 'alert' || p.type === 'emergency').length,
    };
  };

  const stats = getStatsData();

  return (
    <div className="max-w-7xl mx-auto space-y-0">

      {/* ── Hero Banner ─────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 text-white mb-6 shadow-xl">
        {/* Decorative circles */}
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/5" />
        <div className="absolute -bottom-8 -left-8 w-36 h-36 rounded-full bg-white/5" />

        <div className="relative px-6 py-8 md:px-10">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            {/* Left: Title + desc + stats */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-white/20 p-2 rounded-xl">
                  <Users className="w-6 h-6" />
                </div>
                <span className="text-white/70 text-sm font-semibold uppercase tracking-wider">Community Hub</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold mb-2 leading-tight">
                Help Each Other.<br className="hidden sm:block" /> Stay Connected.
              </h1>
              <p className="text-white/70 text-sm mb-5">
                Report emergencies, offer resources, and support your neighbors.
              </p>

              {/* Inline stats */}
              <div className="flex flex-wrap gap-4">
                {[
                  { icon: Activity, label: 'Posts', value: stats.totalPosts, color: 'bg-white/15' },
                  { icon: AlertCircle, label: 'Needs Help', value: stats.totalHelps, color: 'bg-red-500/40' },
                  { icon: Sparkles, label: 'Offering', value: stats.totalOffers, color: 'bg-green-500/40' },
                  { icon: Zap, label: 'Alerts', value: stats.totalAlerts, color: 'bg-orange-500/40' },
                ].map(({ icon: Icon, label, value, color }) => (
                  <div key={label} className={cn('flex items-center gap-2 px-3 py-2 rounded-xl', color)}>
                    <Icon className="w-4 h-4" />
                    <span className="font-bold text-base">{value}</span>
                    <span className="text-white/70 text-xs">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: CTA buttons */}
            <div className="flex flex-col gap-2 min-w-[180px]">
              <Button
                size="lg"
                className="bg-white text-indigo-700 hover:bg-white/90 font-semibold shadow-lg gap-2"
                onClick={() => setIsCreateModalOpen(true)}
              >
                <Plus className="w-4 h-4" /> Create Post
              </Button>
              <Button
                size="sm"
                className="bg-white/20 hover:bg-white/30 border border-white/30 gap-2"
                onClick={() => setShowDMPanel(true)}
              >
                <MessageCircle className="w-4 h-4" /> Messages
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-white/70 hover:text-white hover:bg-white/10 gap-2 justify-start"
                onClick={() => setIsCreateModalOpen(true)}
              >
                <AlertCircle className="w-4 h-4 text-red-300" /> Report Emergency
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Main Column ───────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Search & Filters Card */}
          <Card className="shadow-sm">
            <CardContent className="p-4 space-y-3">
              {/* Search row */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search posts, people, tags or locations…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Type filter pills */}
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: '🌐 All', active: 'bg-indigo-600 text-white' },
                  { value: 'emergency', label: '🆘 Emergency', active: 'bg-red-600 text-white' },
                  { value: 'help', label: '🙏 Help', active: 'bg-orange-500 text-white' },
                  { value: 'offer', label: '💚 Offer', active: 'bg-green-600 text-white' },
                  { value: 'alert', label: '⚠️ Alert', active: 'bg-yellow-500 text-white' },
                  { value: 'general', label: '💬 General', active: 'bg-blue-500 text-white' },
                ].map(({ value, label, active }) => (
                  <button
                    key={value}
                    onClick={() => setFilterType(value)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                      filterType === value
                        ? active + ' border-transparent shadow-sm'
                        : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                    )}
                  >
                    {label}
                  </button>
                ))}
                <button
                  onClick={() => setHideResolved((v) => !v)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                    hideResolved
                      ? 'bg-emerald-600 text-white border-transparent shadow-sm'
                      : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                  )}
                  title={hideResolved ? 'Showing only active posts' : 'Showing active and resolved posts'}
                >
                  {hideResolved ? '✅ Hide Resolved' : '📂 Show Resolved'}
                </button>
              </div>

              {/* Bottom row: sort + pincode */}
              <div className="flex flex-col sm:flex-row gap-2">
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="sm:w-44 h-9 text-sm">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">🕐 Most Recent</SelectItem>
                    <SelectItem value="popular">🔥 Most Popular</SelectItem>
                    <SelectItem value="commented">💬 Most Discussed</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex gap-2 flex-1">
                  <div className="relative flex-1">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Pincode filter (e.g. 751001)"
                      value={pincodeInput}
                      onChange={e => setPincodeInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && applyPin()}
                      className="pl-8 h-9 text-sm"
                      maxLength={10}
                    />
                  </div>
                  <Button size="sm" className="h-9" onClick={applyPin} disabled={!pincodeInput.trim()}>
                    Apply
                  </Button>
                  {activePin && (
                    <Button size="sm" variant="outline" className="h-9 gap-1 text-muted-foreground" onClick={clearPin}>
                      ✕ {activePin}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Feed Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4 h-10">
              <TabsTrigger value="feed" className="text-sm">
                <Activity className="w-3.5 h-3.5 mr-1.5" />Feed
              </TabsTrigger>
              <TabsTrigger value="map" className="text-sm">
                <Map className="w-3.5 h-3.5 mr-1.5" />Map
              </TabsTrigger>
              <TabsTrigger value="saved" className="text-sm">
                Saved {savedPosts.length > 0 && <span className="ml-1 bg-primary/15 text-primary text-[10px] px-1.5 py-0.5 rounded-full">{savedPosts.length}</span>}
              </TabsTrigger>
              <TabsTrigger value="my-posts" className="text-sm">
                Mine {myPosts.length > 0 && <span className="ml-1 bg-primary/15 text-primary text-[10px] px-1.5 py-0.5 rounded-full">{myPosts.length}</span>}
              </TabsTrigger>
            </TabsList>

            {/* Feed Tab */}
            <TabsContent value="feed" className="space-y-3 mt-4">
              {loading ? (
                <Card>
                  <CardContent className="p-12 text-center">
                    <Loader2 className="w-10 h-10 mx-auto mb-4 text-primary animate-spin" />
                    <p className="text-muted-foreground font-medium">Loading community posts…</p>
                  </CardContent>
                </Card>
              ) : filteredPosts.length > 0 ? (
                filteredPosts.map((post) => (
                  <CommunityPost
                    key={post.id}
                    post={post}
                    currentUserId={user?.id}
                    currentUserName={user?.name || user?.email}
                    currentUserPhoto={user?.photoURL}
                    authorBadge={badgeByUser[post.user_id]}
                    onLike={handlePostLike}
                    onDelete={handlePostDelete}
                    onShare={handlePostShare}
                    onSave={handlePostSave}
                  />
                ))
              ) : (
                <Card>
                  <CardContent className="p-12 text-center">
                    <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                      <Search className="w-7 h-7 text-muted-foreground" />
                    </div>
                    <p className="font-semibold mb-1">No posts found</p>
                    <p className="text-sm text-muted-foreground">
                      {searchQuery ? 'Try a different search term' : 'Be the first to post in your area!'}
                    </p>
                    {!searchQuery && (
                      <Button className="mt-4 gap-2" onClick={() => setIsCreateModalOpen(true)}>
                        <Plus className="w-4 h-4" /> Create Post
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Map Tab */}
            <TabsContent value="map" className="mt-4">
              <Card className="overflow-hidden shadow-sm">
                <CardHeader className="pb-2 border-b">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <Map className="w-4 h-4 text-primary" />
                    Community Map
                    <Badge variant="secondary" className="ml-auto font-normal">
                      {posts.filter(p => p.lat && p.lon).length} pinned
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <CommunityMap posts={posts} userLocation={userLocation} />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Saved Tab */}
            <TabsContent value="saved" className="space-y-3 mt-4">
              {savedPosts.length > 0 ? (
                savedPosts.map((post) => (
                  <CommunityPost
                    key={post.id}
                    post={post}
                    currentUserId={user?.id}
                    currentUserName={user?.name || user?.email}
                    currentUserPhoto={user?.photoURL}
                    authorBadge={badgeByUser[post.user_id]}
                    onLike={handlePostLike}
                    onDelete={handlePostDelete}
                    onShare={handlePostShare}
                    onSave={handlePostSave}
                  />
                ))
              ) : (
                <Card>
                  <CardContent className="p-12 text-center">
                    <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                      <Heart className="w-7 h-7 text-muted-foreground" />
                    </div>
                    <p className="font-semibold mb-1">No saved posts</p>
                    <p className="text-sm text-muted-foreground">Bookmark posts to find them here later.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* My Posts Tab */}
            <TabsContent value="my-posts" className="space-y-3 mt-4">
              {myPosts.length > 0 ? (
                myPosts.map((post) => (
                  <CommunityPost
                    key={post.id}
                    post={post}
                    currentUserId={user?.id}
                    currentUserName={user?.name || user?.email}
                    currentUserPhoto={user?.photoURL}
                    authorBadge={badgeByUser[post.user_id]}
                    onLike={handlePostLike}
                    onDelete={handlePostDelete}
                    onShare={handlePostShare}
                    onSave={handlePostSave}
                  />
                ))
              ) : (
                <Card>
                  <CardContent className="p-12 text-center">
                    <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                      <Plus className="w-7 h-7 text-muted-foreground" />
                    </div>
                    <p className="font-semibold mb-1">No posts yet</p>
                    <p className="text-sm text-muted-foreground mb-4">Share something with your community.</p>
                    <Button onClick={() => setIsCreateModalOpen(true)} className="gap-2">
                      <Plus className="w-4 h-4" /> Create Your First Post
                    </Button>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* ── Sidebar ───────────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Quick Actions */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-500" /> Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/15 border border-red-100 dark:border-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/25 transition-colors text-left"
              >
                <div className="bg-red-100 dark:bg-red-900/30 p-1.5 rounded-lg">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Report Emergency</p>
                  <p className="text-xs opacity-70">Immediate danger or crisis</p>
                </div>
                <ChevronRight className="w-4 h-4 ml-auto opacity-50" />
              </button>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-orange-50 dark:bg-orange-900/15 border border-orange-100 dark:border-orange-900/30 text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/25 transition-colors text-left"
              >
                <div className="bg-orange-100 dark:bg-orange-900/30 p-1.5 rounded-lg">
                  <HelpCircle className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Request Help</p>
                  <p className="text-xs opacity-70">Need resources or support</p>
                </div>
                <ChevronRight className="w-4 h-4 ml-auto opacity-50" />
              </button>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-green-50 dark:bg-green-900/15 border border-green-100 dark:border-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/25 transition-colors text-left"
              >
                <div className="bg-green-100 dark:bg-green-900/30 p-1.5 rounded-lg">
                  <Heart className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Offer Help</p>
                  <p className="text-xs opacity-70">Share skills or resources</p>
                </div>
                <ChevronRight className="w-4 h-4 ml-auto opacity-50" />
              </button>
            </CardContent>
          </Card>

          {/* Urgent Needs & Offers */}
          {urgentPosts.length > 0 && (
            <Card className="shadow-sm border-orange-200 dark:border-orange-900/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                  Urgent Near You
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {urgentPosts.map((p, i) => {
                  const isOffer = p.type === 'offer';
                  return (
                    <button
                      key={p.id || i}
                      onClick={() => { setActiveTab('feed'); setFilterType(p.type); }}
                      className={cn(
                        'w-full text-left p-3 rounded-xl border transition-colors',
                        isOffer
                          ? 'bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30 hover:bg-green-100/60'
                          : 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30 hover:bg-red-100/60'
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge className={cn('text-[10px] h-4 px-1.5', isOffer ? 'bg-green-600' : 'bg-red-600')}>
                          {isOffer ? 'OFFER' : 'NEED'}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {p.timestamp ? new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      <p className="text-xs font-medium line-clamp-2 mb-1">{p.content}</p>
                      {p.location && (
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <MapPin className="w-2.5 h-2.5" />
                          <span className="truncate">{p.location}</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Leaderboard */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Award className="w-4 h-4 text-yellow-500" /> Local Heroes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {leaderboard.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">
                  Be the first community hero!
                </p>
              ) : (
                leaderboard.map((hero, i) => {
                  const bCfg = BADGE_CONFIG[hero.badge?.name] || BADGE_CONFIG.Newcomer;
                  return (
                    <div key={hero.user_id} className={cn(
                      'flex items-center gap-3 p-2.5 rounded-xl transition-colors',
                      i === 0 && 'bg-yellow-50 dark:bg-yellow-900/10',
                      i === 1 && 'bg-gray-50 dark:bg-gray-900/10',
                      i === 2 && 'bg-orange-50 dark:bg-orange-900/10',
                    )}>
                      <div className={cn(
                        'font-bold w-7 h-7 flex items-center justify-center rounded-full text-xs shrink-0 shadow-sm',
                        i === 0 && 'bg-yellow-400 text-yellow-900',
                        i === 1 && 'bg-gray-300 text-gray-700',
                        i === 2 && 'bg-orange-400 text-orange-900',
                        i > 2 && 'bg-muted text-muted-foreground',
                      )}>
                        {hero.rank}
                      </div>
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={hero.photo || `https://api.dicebear.com/7.x/avataaars/svg?seed=${hero.name}`} />
                        <AvatarFallback>{hero.name?.[0] || '?'}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{hero.name}</p>
                        <p className="text-[10px] text-muted-foreground">{hero.helpful_posts} helpful posts</p>
                      </div>
                      <span className={cn(
                        'text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0',
                        bCfg.bg
                      )}>
                        {bCfg.emoji}
                      </span>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Trending Topics */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="w-4 h-4 text-blue-500" /> Trending Topics
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {trendingTags.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">No trending tags yet</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {trendingTags.map((topic, i) => (
                    <button
                      key={i}
                      onClick={() => setSearchQuery(topic.tag)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-muted hover:bg-muted/70 rounded-full text-xs font-medium transition-colors"
                    >
                      <Hash className="w-3 h-3 text-muted-foreground" />
                      {topic.tag}
                      <span className="ml-0.5 text-muted-foreground">·{topic.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Community Guidelines */}
          <Card className="shadow-sm bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-2">
                <Shield className="w-3.5 h-3.5" /> Community Guidelines
              </CardTitle>
            </CardHeader>
            <CardContent className="text-[11px] text-muted-foreground space-y-1.5 pt-0">
              {['Be respectful and helpful', 'Verify before posting', 'Use correct post types', 'Add location for local help', 'Report false information'].map(g => (
                <div key={g} className="flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-blue-400 shrink-0" /> {g}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Create Post Modal */}
      <CreatePostModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onPostCreated={handlePostCreated}
      />

      {/* DM Inbox Panel */}
      <DirectMessagePanel
        isOpen={showDMPanel}
        onClose={handleCloseDMPanel}
        myUserId={user?.id || user?.uid}
        myName={user?.name || user?.displayName || user?.email}
        myPhoto={user?.photoURL}
        initialPartner={dmInitialPartner}
        initialPostId={dmInitialPostId}
        initialPostSnippet={dmInitialPostSnippet}
      />
    </div>
  );
};

export default Community;
