import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation as useAppLocation } from "@/contexts/LocationContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  User,
  Mail,
  Phone,
  MessageCircle,
  Bell,
  MapPin,
  Upload,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Send,
  Loader2,
  Link,
  Unlink,
  Shield,
  Camera,
  Navigation,
  Home,
  RefreshCw,
  Plus,
  Trash2,
} from "lucide-react";
import TelegramLinking from "@/components/profile/TelegramLinking";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";

// ── DiceBear avatar picker ──────────────────────────────────────────────────
const DICE_STYLES = [
  { id: "adventurer", label: "Adventurer" },
  { id: "avataaars", label: "Avataaars" },
  { id: "bottts", label: "Bottts" },
  { id: "fun-emoji", label: "Fun Emoji" },
  { id: "lorelei", label: "Lorelei" },
  { id: "notionists", label: "Notionists" },
  { id: "open-peeps", label: "Open Peeps" },
  { id: "pixel-art", label: "Pixel Art" },
];
const DICE_SEEDS = ["Hero", "Zara", "Ace", "Nova", "Brave", "Cosmo"];
const diceUrl = (style, seed) =>
  `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}&radius=50&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;

const getInitials = (name) => {
  if (!name) return "U";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

const Toast = ({ message, type = "success" }) => (
  <div
    className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-in slide-in-from-bottom-4 duration-300
      ${type === "success" ? "bg-green-600 text-white" : "bg-destructive text-white"}`}
  >
    {type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
    {message}
  </div>
);

const roleColors = {
  admin: "destructive",
  developer: "default",
  scientist: "secondary",
  student: "outline",
  citizen: "outline",
};

export default function Profile() {
  const { user } = useAuth();
  const { gpsPincode, homePincode: ctxHomePincode, setHomePincodeAndSave, detectLocation } = useAppLocation();
  const fileInputRef = useRef(null);

  const [dbProfile, setDbProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Form state — seeded from Firebase then DB
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [notifEmail, setNotifEmail] = useState("");
  const [telegramUsername, setTelegramUsername] = useState("");
  const [radiusKm, setRadiusKm] = useState(50);
  const [channels, setChannels] = useState({ telegram: true, email: true });
  const [customAvatar, setCustomAvatar] = useState(null); // uploaded avatar URL
  const [showDicePicker, setShowDicePicker] = useState(false);

  const [homePincodeInput, setHomePincodeInput] = useState("");
  const [savedLocations, setSavedLocations] = useState([]);
  const [newSavedName, setNewSavedName] = useState("");
  const [newSavedPincode, setNewSavedPincode] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);

  // Telegram linking
  const [telegramLink, setTelegramLink] = useState(null);
  const [linkingTelegram, setLinkingTelegram] = useState(false);
  const [copied, setCopied] = useState(false);

  const [testingEmail, setTestingEmail] = useState(false);

  // The avatar to display: custom upload > Firebase photoURL > initials
  const displayAvatar = customAvatar || dbProfile?.avatar_url || user?.photoURL || null;
  const displayName = fullName || user?.name || "";
  const displayEmail = user?.email || dbProfile?.email || "";
  const displayRole = user?.role || dbProfile?.user_type || "citizen";
  const telegramLinked = dbProfile?.telegram_linked || false;
  const authToken = localStorage.getItem("auth_token") || "";

  // ── Helpers ────────────────────────────────────────────────────────────────

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const getAuthHeaders = () => {
    const t = localStorage.getItem("auth_token") || "";
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  // ── Data ───────────────────────────────────────────────────────────────────

  const loadProfile = async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`${BACKEND}/api/profile/${user.id}`);
      const data = await res.json();
      const p = data.profile;
      setDbProfile(p);
      // Prefer DB data, fall back to Firebase auth data
      setFullName(p.full_name || user?.name || "");
      setBio(p.bio || "");
      setPhone(p.phone || "");
      setNotifEmail(p.notification_email || user?.email || "");
      setTelegramUsername(p.telegram_username || "");
      setRadiusKm(p.notification_radius_km ?? 50);
      setChannels(p.notification_channels || { telegram: true, email: true });
      setHomePincodeInput(p.home_pincode || "");
      setSavedLocations(Array.isArray(p.saved_locations) ? p.saved_locations : []);
      if (p.avatar_url) setCustomAvatar(p.avatar_url);
      else {
        const cached = localStorage.getItem("user_avatar_url");
        if (cached) setCustomAvatar(cached);
      }
    } catch {
      // Even if backend is down, show Firebase data
      setFullName(user?.name || "");
      setNotifEmail(user?.email || "");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [user?.id]); // eslint-disable-line

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${BACKEND}/api/profile/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          full_name: fullName,
          bio,
          phone,
          notification_email: notifEmail,
          telegram_username: telegramUsername,
          notification_radius_km: radiusKm,
          notification_channels: channels,
          home_pincode: homePincodeInput || undefined,
          gps_pincode: gpsPincode || undefined,
          avatar_url: customAvatar || undefined,
          // Sync Firebase data so backend can create the user row if needed
          firebase_display_name: user?.name,
          firebase_email: user?.email,
          firebase_photo_url: user?.photoURL,
          firebase_role: user?.role,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      await loadProfile();
      // Sync chosen avatar to localStorage so the sidebar/header picks it up
      if (customAvatar) localStorage.setItem("user_avatar_url", customAvatar);
      showToast("Profile saved!");
    } catch {
      showToast("Failed to save profile", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleAddSavedLocation = async () => {
    const name = newSavedName.trim();
    const pincode = newSavedPincode.trim();

    if (!name) {
      showToast("Enter a location name", "error");
      return;
    }
    if (pincode && pincode.length !== 6) {
      showToast("Pincode must be 6 digits", "error");
      return;
    }

    setSavingLocation(true);
    try {
      const res = await fetch(`${BACKEND}/api/profile/${user.id}/saved-locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          name,
          pincode: pincode || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Could not save location");

      setSavedLocations(data.saved_locations || []);
      setNewSavedName("");
      setNewSavedPincode("");
      showToast("Saved location added");
    } catch (err) {
      showToast(err?.message || "Failed to add location", "error");
    } finally {
      setSavingLocation(false);
    }
  };

  const handleSetDefaultSavedLocation = async (locationId) => {
    try {
      const res = await fetch(`${BACKEND}/api/profile/${user.id}/saved-locations/${locationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ is_default: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Could not update default location");
      setSavedLocations(data.saved_locations || []);
      showToast("Default location updated");
    } catch (err) {
      showToast(err?.message || "Failed to update location", "error");
    }
  };

  const handleDeleteSavedLocation = async (locationId) => {
    try {
      const res = await fetch(`${BACKEND}/api/profile/${user.id}/saved-locations/${locationId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Could not delete location");
      setSavedLocations(data.saved_locations || []);
      showToast("Saved location removed");
    } catch (err) {
      showToast(err?.message || "Failed to delete location", "error");
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${BACKEND}/api/profile/${user.id}/avatar`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCustomAvatar(data.avatar_url);
      setDbProfile((p) => ({ ...p, avatar_url: data.avatar_url }));
      localStorage.setItem("user_avatar_url", data.avatar_url);
      showToast("Photo updated!");
    } catch {
      showToast("Upload failed", "error");
    }
  };

  const handleGetTelegramLink = async () => {
    setLinkingTelegram(true);
    try {
      // Ensure user exists in DB first
      await fetch(`${BACKEND}/api/profile/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          firebase_display_name: user?.name,
          firebase_email: user?.email,
          firebase_photo_url: user?.photoURL,
          firebase_role: user?.role,
        }),
      });
      const res = await fetch(`${BACKEND}/api/profile/${user.id}/telegram-link`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Telegram bot not configured");
      setTelegramLink(data);
    } catch (err) {
      showToast(err.message || "Could not get Telegram link", "error");
    } finally {
      setLinkingTelegram(false);
    }
  };

  const handleUnlinkTelegram = async () => {
    try {
      await fetch(`${BACKEND}/api/profile/${user.id}/telegram-unlink`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      setDbProfile((p) => ({ ...p, telegram_linked: false }));
      setTelegramLink(null);
      showToast("Telegram unlinked");
    } catch {
      showToast("Failed to unlink Telegram", "error");
    }
  };

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(telegramLink?.deep_link || "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    try {
      const res = await fetch(`${BACKEND}/api/profile/${user.id}/test-email`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || "Failed");
      showToast("Test email sent!");
    } catch (err) {
      showToast(err.message || "Email test failed", "error");
    } finally {
      setTestingEmail(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* ── Hero header ─────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-primary/80 via-primary/60 to-indigo-600/80 shadow-xl">
        {/* background blur layer */}
        {displayAvatar && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-20 blur-xl scale-110"
            style={{ backgroundImage: `url(${displayAvatar})` }}
          />
        )}
        <div className="relative px-6 py-8 flex flex-col sm:flex-row items-center sm:items-end gap-5">
          {/* Avatar with upload overlay */}
          <div className="relative group shrink-0">
            <Avatar className="h-28 w-28 border-4 border-white/60 shadow-2xl ring-2 ring-white/30">
              <AvatarImage src={displayAvatar} alt={displayName} referrerPolicy="no-referrer" />
              <AvatarFallback className="text-3xl bg-white/20 text-white font-bold backdrop-blur">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              title="Change photo"
            >
              <Camera className="h-7 w-7 text-white" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          </div>

          {/* Name / email / role */}
          <div className="text-center sm:text-left flex-1 text-white">
            <h1 className="text-2xl font-bold drop-shadow">{displayName || "Your Name"}</h1>
            <p className="text-white/75 text-sm mt-0.5">{displayEmail}</p>
            <div className="flex flex-wrap gap-2 mt-3 justify-center sm:justify-start">
              <Badge className="bg-white/20 text-white border-white/30 capitalize gap-1 hover:bg-white/30">
                <Shield className="h-3 w-3" />
                {displayRole}
              </Badge>
              {telegramLinked && (
                <Badge className="bg-[#0088cc]/70 text-white border-[#0088cc]/50 gap-1">
                  <MessageCircle className="h-3 w-3" />
                  Telegram linked
                </Badge>
              )}
              {user?.emailVerified && (
                <Badge className="bg-green-500/50 text-white border-green-400/40 gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Verified
                </Badge>
              )}
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-white text-primary hover:bg-white/90 sm:self-end shrink-0"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save Changes
          </Button>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────── */}
      <Tabs defaultValue="personal">
        <TabsList className="w-full">
          <TabsTrigger value="personal" className="flex-1">
            <User className="h-4 w-4 mr-1.5" /> Personal
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex-1">
            <Bell className="h-4 w-4 mr-1.5" /> Notifications
          </TabsTrigger>
          <TabsTrigger value="alerts" className="flex-1">
            <MapPin className="h-4 w-4 mr-1.5" /> Alert Settings
          </TabsTrigger>
        </TabsList>

        {/* Personal tab */}
        <TabsContent value="personal" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Personal Information</CardTitle>
              <CardDescription>Your display name and bio. Photo is synced from your Google/Firebase account and can also be uploaded manually.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Display Name</Label>
                <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={displayEmail} disabled className="opacity-60" />
                <p className="text-xs text-muted-foreground">Email is managed by your Firebase account.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell us a little about yourself..."
                  className="resize-none"
                  rows={3}
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground text-right">{bio.length}/500</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 9876543210" className="pl-9" />
                </div>
              </div>
              <div className="pt-1 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4" />
                  Upload Photo
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowDicePicker(true)}>
                  <Camera className="h-4 w-4" />
                  Choose Avatar
                </Button>
                {user?.photoURL && !customAvatar && (
                  <p className="text-xs text-muted-foreground mt-2 w-full">Currently showing your Google profile photo.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications tab */}
        <TabsContent value="notifications" className="space-y-4 mt-4">
          {/* Email */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="h-4 w-4" /> Email Notifications
              </CardTitle>
              <CardDescription>Receive HTML disaster alerts at your chosen email address.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="notifEmail">Alert Email</Label>
                <Input id="notifEmail" type="email" value={notifEmail} onChange={(e) => setNotifEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <Button variant="outline" size="sm" onClick={handleTestEmail} disabled={testingEmail || !notifEmail} className="gap-2">
                {testingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send Test Email
              </Button>
            </CardContent>
          </Card>

          {/* Telegram */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageCircle className="h-4 w-4" /> Telegram Bot
              </CardTitle>
              <CardDescription>Link your Telegram account to receive instant disaster alerts.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="tgUser">Telegram Username (optional)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-sm text-muted-foreground">@</span>
                  <Input id="tgUser" value={telegramUsername} onChange={(e) => setTelegramUsername(e.target.value.replace(/^@/, ""))} placeholder="yourusername" className="pl-7" />
                </div>
              </div>

              {telegramLinked ? (
                <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="text-sm font-medium">Telegram account linked</span>
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive gap-1.5" onClick={handleUnlinkTelegram}>
                    <Unlink className="h-3.5 w-3.5" /> Unlink
                  </Button>
                </div>
              ) : (
                !telegramLink ? (
                  <Button variant="outline" size="sm" onClick={handleGetTelegramLink} disabled={linkingTelegram} className="gap-2">
                    {linkingTelegram ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link className="h-4 w-4" />}
                    Generate Link Code
                  </Button>
                ) : (
                  <div className="p-4 bg-muted rounded-lg space-y-3">
                    <p className="text-sm font-medium">Step 1 — Open our bot:</p>
                    <a href={telegramLink.deep_link} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-[#0088cc] text-white rounded-lg text-sm font-medium hover:bg-[#007ab3] transition-colors">
                      <MessageCircle className="h-4 w-4" /> Open @{telegramLink.bot_username}
                    </a>
                    <p className="text-sm font-medium mt-2">Step 2 — Send this command:</p>
                    <div className="flex items-center gap-2 bg-background border rounded-md px-3 py-2">
                      <code className="text-sm flex-1 font-mono text-primary">/start {telegramLink.code}</code>
                      <button onClick={handleCopyCommand} className="text-muted-foreground hover:text-foreground transition-colors">
                        {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">{telegramLink.instruction}</p>
                    <Button variant="ghost" size="sm" onClick={() => setTelegramLink(null)} className="text-xs">Cancel</Button>
                  </div>
                )
              )}
            </CardContent>
          </Card>

          {/* Direct Chat ID Linking - NEW METHOD */}
          <TelegramLinking
            userId={user.uid}
            firebaseToken={authToken}
            currentChatId={dbProfile?.telegram_chat_id}
          />
        </TabsContent>

        {/* Alert Settings tab */}
        <TabsContent value="alerts" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Alert Radius</CardTitle>
              <CardDescription>Receive notifications for disasters within this distance from your location.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Radius</Label>
                <span className="text-lg font-bold text-primary">{radiusKm} km</span>
              </div>
              <Slider value={[radiusKm]} onValueChange={([v]) => setRadiusKm(v)} min={10} max={200} step={5} className="w-full" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>10 km (local)</span><span>100 km</span><span>200 km (regional)</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notification Channels</CardTitle>
              <CardDescription>Choose how you want to be notified when an alert matches your area.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Email Alerts</p>
                    <p className="text-xs text-muted-foreground">HTML alert emails</p>
                  </div>
                </div>
                <Switch checked={channels.email} onCheckedChange={(v) => setChannels((c) => ({ ...c, email: v }))} disabled={!notifEmail} />
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <MessageCircle className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Telegram Alerts</p>
                    <p className="text-xs text-muted-foreground">Instant messages from @SurakshaSetuBot</p>
                  </div>
                </div>
                <Switch checked={channels.telegram} onCheckedChange={(v) => setChannels((c) => ({ ...c, telegram: v }))} disabled={!telegramLinked} />
              </div>
            </CardContent>
          </Card>

          {/* Pincode Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pincode Targeting</CardTitle>
              <CardDescription>Alerts and community posts will be targeted to these pincodes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* GPS Pincode — read-only */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Navigation className="h-3.5 w-3.5 text-primary" />
                  GPS Pincode
                  <span className="text-xs text-muted-foreground font-normal">(auto-detected)</span>
                </Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 rounded-md border bg-muted/50 text-sm font-mono tracking-widest">
                    {gpsPincode || <span className="text-muted-foreground italic text-xs font-sans tracking-normal">Not yet detected</span>}
                  </div>
                  <Button variant="outline" size="sm" onClick={detectLocation} title="Re-detect GPS location">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Detected automatically when you open the app using your device GPS.</p>
              </div>

              {/* Home Pincode — editable */}
              <div className="space-y-1.5">
                <Label htmlFor="home-pincode" className="flex items-center gap-1.5 text-sm">
                  <Home className="h-3.5 w-3.5 text-primary" />
                  Home Pincode
                </Label>
                <Input
                  id="home-pincode"
                  value={homePincodeInput}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setHomePincodeInput(val);
                  }}
                  placeholder="e.g. 400001"
                  maxLength={6}
                  inputMode="numeric"
                  className="font-mono tracking-widest"
                />
                <p className="text-xs text-muted-foreground">Your permanent home area. Alerts and community posts for this pincode will be shown to you.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saved Locations</CardTitle>
              <CardDescription>Add important locations like home, office, or family areas for quick switching.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Input
                  value={newSavedName}
                  onChange={(e) => setNewSavedName(e.target.value)}
                  placeholder="Location name (e.g. Office)"
                />
                <Input
                  value={newSavedPincode}
                  onChange={(e) => setNewSavedPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="Pincode (optional)"
                  inputMode="numeric"
                  className="font-mono tracking-widest"
                />
                <Button type="button" onClick={handleAddSavedLocation} disabled={savingLocation} className="gap-2">
                  {savingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add Location
                </Button>
              </div>

              {savedLocations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No saved locations yet. Add one for faster alert targeting.</p>
              ) : (
                <div className="space-y-2">
                  {savedLocations.map((loc) => (
                    <div key={loc.id} className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <p className="text-sm font-medium flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-primary" />
                          {loc.name}
                        </p>
                        {loc.pincode ? <p className="text-xs text-muted-foreground font-mono">PIN: {loc.pincode}</p> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {loc.is_default ? (
                          <Badge variant="secondary">Default</Badge>
                        ) : (
                          <Button type="button" variant="outline" size="sm" onClick={() => handleSetDefaultSavedLocation(loc.id)}>
                            Set default
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => handleDeleteSavedLocation(loc.id)}
                          title="Delete saved location"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Alert Settings
          </Button>
        </TabsContent>
      </Tabs>

      {/* ── DiceBear Avatar Picker Dialog ────────────────── */}
      <Dialog open={showDicePicker} onOpenChange={setShowDicePicker}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Choose Your Avatar
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2 mb-3">
            Pick any avatar — it will be saved across your entire profile. Click one to select it, then save your profile.
          </p>
          <div className="space-y-5">
            {DICE_STYLES.map((style) => (
              <div key={style.id}>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{style.label}</p>
                <div className="flex flex-wrap gap-3">
                  {DICE_SEEDS.map((seed) => {
                    const url = diceUrl(style.id, seed);
                    const isSelected = customAvatar === url;
                    return (
                      <button
                        key={seed}
                        onClick={() => {
                          setCustomAvatar(url);
                          setShowDicePicker(false);
                        }}
                        className={`rounded-full border-2 transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary ${isSelected ? "border-primary ring-2 ring-primary scale-110" : "border-transparent hover:border-primary/50"}`}
                        title={`${style.label} — ${seed}`}
                      >
                        <img
                          src={url}
                          alt={`${style.label} ${seed}`}
                          className="w-14 h-14 rounded-full bg-muted"
                          loading="lazy"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button variant="outline" onClick={() => setShowDicePicker(false)}>Cancel</Button>
            <Button onClick={() => { setShowDicePicker(false); showToast("Avatar selected! Click Save Changes to save it."); }}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
