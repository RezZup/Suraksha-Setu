import React, { useState, useEffect, useCallback } from 'react';

import { 
  ShieldCheck, 
  Users, 
  AlertTriangle, 
  Server, 
  Check, 
  X,
  MoreHorizontal,
  Settings,
  Undo2,
  Phone,
  MessageSquare,
  Shield,
  FileWarning,
  RefreshCw,
  Send,
  Bot,
  Radio,
  Database
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import UserManagement from "@/components/admin/UserManagement";
import { useTranslation } from 'react-i18next';
import { cachedFetchJson } from '@/utils/requestCache';
import { getAuthHeadersForApi } from '@/utils/authHeaders';
import { Skeleton } from 'boneyard-js/react';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const ADMIN_DASHBOARD_SNAPSHOT_KEY = 'admin_dashboard_snapshot_v1';
const ADMIN_DASHBOARD_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

const readAdminSnapshot = () => {
  try {
    const raw = localStorage.getItem(ADMIN_DASHBOARD_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || Date.now() - Number(parsed.savedAt) > ADMIN_DASHBOARD_SNAPSHOT_TTL_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writeAdminSnapshot = (payload) => {
  try {
    localStorage.setItem(
      ADMIN_DASHBOARD_SNAPSHOT_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        ...payload,
      })
    );
  } catch {
    // Ignore storage quota/private mode failures.
  }
};

const snapshotAtBoot = readAdminSnapshot();

const AdminDashboard = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('overview');
  const [alerts, setAlerts] = useState(() => snapshotAtBoot?.alerts || []);
  const [pendingAlerts, setPendingAlerts] = useState(() => snapshotAtBoot?.pendingAlerts || []);
  const [safetyStatus, setSafetyStatus] = useState(() => snapshotAtBoot?.safetyStatus || null);
  const [smsStatus, setSmsStatus] = useState(() => snapshotAtBoot?.smsStatus || null);
  const [incidents, setIncidents] = useState(() => snapshotAtBoot?.incidents || []);
  const [smsLogs, setSmsLogs] = useState(() => snapshotAtBoot?.smsLogs || []);
  const [retractReason, setRetractReason] = useState('');
  const [retractingId, setRetractingId] = useState(null);
  const [actionFeedback, setActionFeedback] = useState('');
  const [stats, setStats] = useState(() => snapshotAtBoot?.stats || null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => snapshotAtBoot?.lastUpdated ? new Date(snapshotAtBoot.lastUpdated) : null);
  const [systemLogs, setSystemLogs] = useState(() => snapshotAtBoot?.systemLogs || []);
  const [reports, setReports] = useState(() => snapshotAtBoot?.reports || []);
  const [reportFilter, setReportFilter] = useState('pending');
  const [verificationPosts, setVerificationPosts] = useState(() => snapshotAtBoot?.verificationPosts || []);
  const [verificationFilter, setVerificationFilter] = useState('pending_admin_review');
  const [verificationNotes, setVerificationNotes] = useState({});
  const [verificationReports, setVerificationReports] = useState({});
  const [verificationNotifyChannels, setVerificationNotifyChannels] = useState({});
  const [verificationNotifyRadiusKm, setVerificationNotifyRadiusKm] = useState({});
  const [verificationUpdatingId, setVerificationUpdatingId] = useState(null);
  const [alertForm, setAlertForm] = useState({
    title: '',
    alert_type: 'weather',
    severity: 'warning',
    city: '',
    lat: '',
    lon: '',
    description: '',
    pincode: '',
  });

  // Telegram state
  const [telegramStats, setTelegramStats] = useState(() => snapshotAtBoot?.telegramStats || null);
  const [tgTestChatId, setTgTestChatId] = useState('');
  const [tgTestMsg, setTgTestMsg] = useState('');
  const [tgBroadcastMsg, setTgBroadcastMsg] = useState('');
  const [tgBroadcastAlertId, setTgBroadcastAlertId] = useState('');
  const [tgSending, setTgSending] = useState(false);
  const [tgFeedback, setTgFeedback] = useState('');

  // Multi-channel broadcast state
  const [broadcastChannelStats, setBroadcastChannelStats] = useState(() => snapshotAtBoot?.broadcastChannelStats || null);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastPrompt, setBroadcastPrompt] = useState('');
  const [broadcastSeverity, setBroadcastSeverity] = useState('warning');
  const [broadcastAlertId, setBroadcastAlertId] = useState('');
  const [broadcastGenerating, setBroadcastGenerating] = useState(false);
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastFeedback, setBroadcastFeedback] = useState('');
  const [broadcastChannels, setBroadcastChannels] = useState({
    telegram: true,
    sms: true,
    email: true,
    push: false,
    websocket: false,
  });
  const [dataSummary, setDataSummary] = useState(() => snapshotAtBoot?.dataSummary || null);
  const [ingestionRunning, setIngestionRunning] = useState(false);
  const [ingestionMode, setIngestionMode] = useState('');
  const [mosdacBackfillDays, setMosdacBackfillDays] = useState(7);
  const [mosdacBackfillLimit, setMosdacBackfillLimit] = useState(80);

  const getAuthHeaders = () => {
    return getAuthHeadersForApi(API_URL, 'admin');
  };

  const fetchData = useCallback(async (forceRefresh = false) => {
    setIsRefreshing(true);
    try {
      const authHeaders = getAuthHeaders();
      const authFetch = { fetchOptions: { headers: authHeaders } };
      const [alertsRes, pendingRes, safetyRes, smsRes, incidentRes, smsLogRes, statsRes, logsRes, tgRes, bcRes, verificationRes, dataSummaryRes] = await Promise.allSettled([
        cachedFetchJson(`${API_URL}/admin/alerts`, { ttlMs: 30 * 1000, forceRefresh, ...authFetch }),
        cachedFetchJson(`${API_URL}/admin/alerts/pending`, { ttlMs: 30 * 1000, forceRefresh, ...authFetch }),
        cachedFetchJson(`${API_URL}/admin/safety/status`, { ttlMs: 30 * 1000, forceRefresh, ...authFetch }),
        cachedFetchJson(`${API_URL}/api/sms/status`, { ttlMs: 30 * 1000, forceRefresh, ...authFetch }),
        cachedFetchJson(`${API_URL}/admin/incidents?limit=20`, { ttlMs: 30 * 1000, forceRefresh, ...authFetch }),
        cachedFetchJson(`${API_URL}/api/sms/audit-log?limit=20`, { ttlMs: 30 * 1000, forceRefresh, ...authFetch }),
        cachedFetchJson(`${API_URL}/admin/stats`, { ttlMs: 30 * 1000, forceRefresh, ...authFetch }),
        cachedFetchJson(`${API_URL}/admin/logs?limit=10`, { ttlMs: 30 * 1000, forceRefresh, ...authFetch }),
        cachedFetchJson(`${API_URL}/admin/telegram/stats`, { ttlMs: 30 * 1000, forceRefresh, ...authFetch }),
        cachedFetchJson(`${API_URL}/admin/broadcast/channels`, { ttlMs: 30 * 1000, forceRefresh, ...authFetch }),
        cachedFetchJson(`${API_URL}/admin/community-verification/posts?status=all&limit=100`, { ttlMs: 30 * 1000, forceRefresh, ...authFetch }),
        cachedFetchJson(`${API_URL}/admin/data/summary?recent_hours=24`, { ttlMs: 30 * 1000, forceRefresh, ...authFetch }),
      ]);
      if (alertsRes.status === 'fulfilled') setAlerts(alertsRes.value?.alerts || alertsRes.value || []);
      if (pendingRes.status === 'fulfilled') setPendingAlerts(pendingRes.value?.pending_alerts || []);
      if (safetyRes.status === 'fulfilled') setSafetyStatus(safetyRes.value);
      if (smsRes.status === 'fulfilled') setSmsStatus(smsRes.value);
      if (incidentRes.status === 'fulfilled') setIncidents(incidentRes.value?.incidents || []);
      if (smsLogRes.status === 'fulfilled') setSmsLogs(smsLogRes.value?.logs || []);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
      if (logsRes.status === 'fulfilled') setSystemLogs(logsRes.value?.logs || []);
      if (tgRes.status === 'fulfilled') setTelegramStats(tgRes.value);
      if (bcRes.status === 'fulfilled') setBroadcastChannelStats(bcRes.value);
      if (verificationRes.status === 'fulfilled') setVerificationPosts(verificationRes.value?.posts || []);
      if (dataSummaryRes.status === 'fulfilled') setDataSummary(dataSummaryRes.value);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Admin fetch error:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const fetchReports = useCallback(async (status = reportFilter) => {
    try {
      const data = await cachedFetchJson(
        `${API_URL}/admin/reports?status=${status}&limit=50`,
        {
          ttlMs: 20 * 1000,
          fetchOptions: { headers: getAuthHeaders() },
        }
      );
      setReports(data?.reports || []);
    } catch (err) {
      console.error('Reports fetch error:', err);
    }
  }, [reportFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);
  // Fetch reports when tab or filter changes
  useEffect(() => { if (activeTab === 'reports') fetchReports(); }, [activeTab, fetchReports]);
  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => { fetchData(); if (activeTab === 'reports') fetchReports(); }, 30000);
    return () => clearInterval(interval);
  }, [fetchData, fetchReports, activeTab]);

  useEffect(() => {
    if (!lastUpdated) return;
    writeAdminSnapshot({
      alerts,
      pendingAlerts,
      safetyStatus,
      smsStatus,
      incidents,
      smsLogs,
      stats,
      systemLogs,
      reports,
      verificationPosts,
      telegramStats,
      broadcastChannelStats,
      dataSummary,
      lastUpdated: lastUpdated.toISOString(),
    });
  }, [
    alerts,
    pendingAlerts,
    safetyStatus,
    smsStatus,
    incidents,
    smsLogs,
    stats,
    systemLogs,
    reports,
    verificationPosts,
    telegramStats,
    broadcastChannelStats,
    dataSummary,
    lastUpdated,
  ]);

  const filteredVerificationPosts = verificationFilter === 'all'
    ? verificationPosts
    : verificationPosts.filter((post) => (post?.verification?.status || 'pending_admin_review') === verificationFilter);

  const getMediaPreviewUrl = (mediaItem) => {
    if (!mediaItem || !mediaItem.url) return '';
    return mediaItem.url.startsWith('http') ? mediaItem.url : `${API_URL}${mediaItem.url}`;
  };

  const handleVerificationAction = async (postId, status) => {
    const adminComment = (verificationNotes[postId] || '').trim();
    const reportToUser = (verificationReports[postId] || '').trim();
    const notifyConfig = verificationNotifyChannels[postId] || { sms: true, telegram: true };
    const notifyChannels = Object.entries(notifyConfig)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([channel]) => channel);
    const rawRadius = verificationNotifyRadiusKm[postId];
    const parsedRadius = Number(rawRadius);
    const notifyRadiusKm = Number.isFinite(parsedRadius) && parsedRadius > 0
      ? Math.min(50, Math.max(1, parsedRadius))
      : 10;

    setVerificationUpdatingId(postId);
    try {
      const res = await fetch(`${API_URL}/admin/community-verification/posts/${postId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          status,
          admin_comment: adminComment || undefined,
          report_to_user: reportToUser || undefined,
          notify_channels: status === 'approved' ? notifyChannels : undefined,
          notify_radius_km: status === 'approved' ? notifyRadiusKm : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.detail || data?.error || 'Verification update failed');
      }

      const delivery = data?.delivery;
      if (status === 'approved' && delivery) {
        const smsStats = delivery?.sms || {};
        const tgStats = delivery?.telegram || {};
        const inAppStats = delivery?.in_app || {};
        const alertCenter = delivery?.alert_center || {};
        const smsText = smsStats?.requested ? `SMS ${smsStats?.sent || 0}/${smsStats?.total || 0}` : 'SMS skipped';
        const tgText = tgStats?.requested ? `Telegram ${tgStats?.sent || 0}/${tgStats?.total || 0}` : 'Telegram skipped';
        const inAppText = `In-app ${inAppStats?.queued || 0}/${inAppStats?.total || 0}`;
        const alertText = alertCenter?.alert_id ? 'Alert Center updated' : 'Alert Center skipped';
        setActionFeedback(`Community post approved and published. ${smsText} | ${tgText} | ${inAppText} | ${alertText}`);
      } else {
        setActionFeedback(`Community post updated: ${data?.verification?.status_label || status}`);
      }
      await fetchData(true);
    } catch (err) {
      setActionFeedback(`Error: ${err.message}`);
    } finally {
      setVerificationUpdatingId(null);
    }
  };

  const handleReportAction = async (reportId, status) => {
    try {
      await fetch(`${API_URL}/admin/reports/${reportId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ status }),
      });
      setActionFeedback(`Report marked as ${status}`);
      fetchReports();
    } catch (err) { setActionFeedback(`Error: ${err.message}`); }
  };

  const handleRetract = async (alertId) => {
    if (!retractReason.trim()) { setActionFeedback('Please provide a retraction reason'); return; }
    try {
      const res = await fetch(`${API_URL}/admin/alerts/retract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ alert_id: alertId, reason: retractReason, admin_user_id: 'admin' }),
      });
      const data = await res.json();
      if (data.success) {
        setActionFeedback(`Alert retracted. Correction SMS sent.`);
        setRetractingId(null);
        setRetractReason('');
        fetchData();
      } else {
        setActionFeedback(`Retraction failed: ${data.error || data.detail}`);
      }
    } catch (err) { setActionFeedback(`Error: ${err.message}`); }
  };

  const handleApprove = async (alertId, approved) => {
    try {
      const res = await fetch(`${API_URL}/admin/alerts/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ alert_id: alertId, approved, admin_user_id: 'admin' }),
      });
      const data = await res.json();
      setActionFeedback(`Alert ${approved ? 'approved' : 'rejected'}: ${data.message}`);
      fetchData();
    } catch (err) { setActionFeedback(`Error: ${err.message}`); }
  };

  const handleResetFP = async (eventType) => {
    try {
      await fetch(`${API_URL}/admin/safety/reset/${eventType}`, { method: 'POST', headers: getAuthHeaders() });
      setActionFeedback(`False positives reset for ${eventType}`);
      fetchData();
    } catch (err) { setActionFeedback(`Error: ${err.message}`); }
  };

  const handleCreateAlert = async () => {
    try {
      const payload = {
        alert_type: alertForm.alert_type,
        severity: alertForm.severity,
        title: alertForm.title,
        description: alertForm.description,
        source: 'admin',
        is_active: true,
        location: {
          city: alertForm.city || 'Unknown',
          lat: alertForm.lat ? Number(alertForm.lat) : null,
          lon: alertForm.lon ? Number(alertForm.lon) : null,
        },
        pincode: alertForm.pincode || undefined,
      };
      const res = await fetch(`${API_URL}/admin/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || data.error || 'Failed to create alert');
      setActionFeedback('Alert created successfully');
      setAlertForm({ title: '', alert_type: 'weather', severity: 'warning', city: '', lat: '', lon: '', description: '', pincode: '' });
      fetchData();
    } catch (err) {
      setActionFeedback(`Error: ${err.message}`);
    }
  };

  const handleToggleAlertActive = async (alert) => {
    try {
      const res = await fetch(`${API_URL}/admin/alerts/${alert.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ is_active: !alert.is_active }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || data.error || 'Update failed');
      setActionFeedback(`Alert ${!alert.is_active ? 'activated' : 'deactivated'}`);
      fetchData();
    } catch (err) {
      setActionFeedback(`Error: ${err.message}`);
    }
  };

  const handleDeleteAlert = async (alertId) => {
    try {
      const res = await fetch(`${API_URL}/admin/alerts/${alertId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || data.error || 'Delete failed');
      setActionFeedback('Alert deleted');
      fetchData();
    } catch (err) {
      setActionFeedback(`Error: ${err.message}`);
    }
  };

  const handleTelegramTest = async () => {
    if (!tgTestChatId.trim() || !tgTestMsg.trim()) return;
    setTgSending(true);
    setTgFeedback('');
    try {
      const res = await fetch(`${API_URL}/admin/telegram/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ chat_id: tgTestChatId.trim(), message: tgTestMsg.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to send test message');
      setTgFeedback(`✅ Test message sent to ${data.chat_id}`);
      setTgTestMsg('');
    } catch (err) {
      setTgFeedback(`❌ ${err.message}`);
    } finally {
      setTgSending(false);
    }
  };

  const handleTelegramBroadcast = async () => {
    if (!tgBroadcastMsg.trim() && !tgBroadcastAlertId) return;
    setTgSending(true);
    setTgFeedback('');
    try {
      const res = await fetch(`${API_URL}/admin/telegram/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          message: tgBroadcastMsg.trim(),
          alert_id: tgBroadcastAlertId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Broadcast failed');
      setTgFeedback(`✅ Broadcast sent to ${data.sent}/${data.total} Telegram users`);
      setTgBroadcastMsg('');
      setTgBroadcastAlertId('');
    } catch (err) {
      setTgFeedback(`❌ ${err.message}`);
    } finally {
      setTgSending(false);
    }
  };

  const handleGenerateBroadcastMessage = async () => {
    const prompt = broadcastPrompt.trim();
    if (!prompt) {
      setBroadcastFeedback('Enter a prompt first to generate a message.');
      return;
    }

    setBroadcastGenerating(true);
    setBroadcastFeedback('');

    try {
      const res = await fetch(`${API_URL}/admin/broadcast/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          prompt,
          severity: broadcastSeverity,
          audience: 'citizens in affected area',
          language: 'English',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'AI generation failed');

      const generated = data?.generated || {};
      const generatedTitle = (generated?.title || '').trim();
      const generatedMessage = (generated?.message || '').trim();
      const generatedActions = Array.isArray(generated?.key_actions) ? generated.key_actions : [];
      const generatedAdminNotes = (generated?.admin_notes || '').trim();

      if (!generatedMessage) throw new Error('AI returned an empty message');

      const messageParts = [generatedMessage];
      if (generatedActions.length > 0) {
        messageParts.push('');
        messageParts.push('Immediate actions:');
        generatedActions.slice(0, 5).forEach((action, index) => {
          messageParts.push(`${index + 1}. ${action}`);
        });
      }
      if (generatedAdminNotes) {
        messageParts.push('');
        messageParts.push(`Admin note: ${generatedAdminNotes}`);
      }

      setBroadcastTitle(generatedTitle || `Admin ${broadcastSeverity === 'critical' ? 'Emergency' : 'Update'}`);
      setBroadcastMessage(messageParts.join('\n'));
      setBroadcastFeedback(`✅ Detailed message generated with ${data?.provider || 'OpenRouter'} (${data?.model || 'gpt-4o-mini'}). Review and send when ready.`);
    } catch (err) {
      setBroadcastFeedback(`❌ ${err.message}`);
    } finally {
      setBroadcastGenerating(false);
    }
  };

  const handleMultiChannelBroadcast = async () => {
    const selectedChannels = Object.entries(broadcastChannels)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);

    if (!broadcastMessage.trim() && !broadcastAlertId) {
      setBroadcastFeedback('Enter or generate a message, or select an alert template.');
      return;
    }

    if (selectedChannels.length === 0) {
      setBroadcastFeedback('Select at least one broadcast channel.');
      return;
    }

    setBroadcastSending(true);
    setBroadcastFeedback('');

    try {
      const payload = {
        title: broadcastTitle.trim() || 'Admin Broadcast',
        message: broadcastMessage.trim(),
        severity: broadcastSeverity,
        alert_type: 'admin_update',
        alert_id: broadcastAlertId || undefined,
        channels: selectedChannels,
      };

      const res = await fetch(`${API_URL}/admin/broadcast/multi-channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Broadcast failed');

      const summary = Object.entries(data?.results || {})
        .map(([channel, result]) => `${channel}: ${result?.sent || 0}/${result?.total || 0}`)
        .join(' | ');

      setBroadcastFeedback(`✅ Broadcast sent. ${summary}`);
      setBroadcastAlertId('');
      fetchData();
    } catch (err) {
      setBroadcastFeedback(`❌ ${err.message}`);
    } finally {
      setBroadcastSending(false);
    }
  };

  const handleRunIngestion = async (mode) => {
    setIngestionRunning(true);
    setIngestionMode(mode);
    try {
      const payload = {
        source_mode: mode,
        mosdac_days_back: Math.max(1, Math.min(Number(mosdacBackfillDays) || 7, 30)),
        mosdac_limit_per_tile: Math.max(5, Math.min(Number(mosdacBackfillLimit) || 80, 300)),
      };
      const res = await fetch(`${API_URL}/admin/data/ingest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Ingestion run failed');

      const stepKeys = Object.keys(data?.steps || {});
      const okSteps = stepKeys.filter((key) => data?.steps?.[key]?.success).length;
      setActionFeedback(`Ingestion completed (${mode}). ${okSteps}/${stepKeys.length} step(s) succeeded.`);

      if (data?.data_summary) {
        setDataSummary(data.data_summary);
      }
      fetchData(true);
    } catch (err) {
      setActionFeedback(`Error: ${err.message}`);
    } finally {
      setIngestionRunning(false);
      setIngestionMode('');
    }
  };

  const activeAlerts = Array.isArray(alerts) ? alerts.filter(a => a.is_active && !a.retracted) : [];
  const handleManualRefresh = () => {
    fetchData();
    if (activeTab === 'reports') fetchReports();
  };

  const initialLoading = isRefreshing && !lastUpdated;

  return (
    <Skeleton
      name="admin-dashboard-page"
      loading={initialLoading}
      fallback={(
        <div className="space-y-4 py-2">
          <div className="h-20 rounded-xl bg-primary/10 animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="h-28 rounded-xl bg-primary/10 animate-pulse" />
            <div className="h-28 rounded-xl bg-primary/10 animate-pulse" />
            <div className="h-28 rounded-xl bg-primary/10 animate-pulse" />
            <div className="h-28 rounded-xl bg-primary/10 animate-pulse" />
          </div>
          <div className="h-[360px] rounded-xl bg-primary/10 animate-pulse" />
        </div>
      )}
    >
    <div className="max-w-7xl mx-auto space-y-6 pb-6">
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-sm border-b -mx-4 px-4 py-4 md:mx-0 md:px-0 md:border-0 md:bg-transparent md:backdrop-blur-none">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('admin.systemAdministration')}</h1>
          <p className="text-muted-foreground">{t('admin.manageSystem')}</p>
        </div>
          <div className="flex items-center gap-2">
            <Badge variant={stats?.system_status === 'operational' ? 'default' : 'secondary'} className="h-8 px-3">
              {stats?.system_status === 'operational' ? 'System Healthy' : 'Status Unknown'}
            </Badge>
            <Button variant="outline" onClick={handleManualRefresh} disabled={isRefreshing} className="gap-2 h-8">
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing' : 'Refresh'}
            </Button>
          </div>
        </div>
        {lastUpdated && (
          <p className="text-xs text-muted-foreground mt-2">Last updated: {lastUpdated.toLocaleTimeString()}</p>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="w-full max-w-full h-auto p-1.5 flex flex-wrap md:flex-nowrap gap-1 overflow-x-auto justify-start">
          <TabsTrigger value="overview" className="gap-2">
            <Server className="w-4 h-4" />
            {t('admin.overview')}
          </TabsTrigger>
          <TabsTrigger value="ingestion" className="gap-2">
            <Database className="w-4 h-4" />
            Data Ingestion
          </TabsTrigger>
          <TabsTrigger value="safety" className="gap-2">
            <Shield className="w-4 h-4" />
            {t('admin.alertSafety')}
          </TabsTrigger>
          <TabsTrigger value="sms" className="gap-2">
            <Phone className="w-4 h-4" />
            {t('admin.sms')}
          </TabsTrigger>
          <TabsTrigger value="telegram" className="gap-2">
            <Bot className="w-4 h-4" />
            Telegram
          </TabsTrigger>
          <TabsTrigger value="broadcast" className="gap-2">
            <Radio className="w-4 h-4" />
            Broadcast
          </TabsTrigger>
          <TabsTrigger value="verification" className="gap-2">
            <ShieldCheck className="w-4 h-4" />
            Community Verify
            {(stats?.pending_post_verifications || 0) > 0 && (
              <span className="ml-1 bg-destructive text-destructive-foreground text-xs rounded-full px-1.5 py-0.5 font-bold">
                {stats.pending_post_verifications}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <FileWarning className="w-4 h-4" />
            {t('admin.reports')}
            {stats?.pending_reports > 0 && (
              <span className="ml-1 bg-destructive text-destructive-foreground text-xs rounded-full px-1.5 py-0.5 font-bold">
                {stats.pending_reports}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="w-4 h-4" />
            {t('admin.users')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* System Health Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="hover:shadow-sm transition-shadow">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-full bg-green-100 text-green-600">
              <Server className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">System Status</p>
              <h4 className="text-xl font-bold text-green-600">{stats?.system_status === 'operational' ? 'Operational' : 'Unknown'}</h4>
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-sm transition-shadow">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-full bg-blue-100 text-blue-600">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active Users</p>
              <h4 className="text-xl font-bold">{stats?.active_users ?? 0}</h4>
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-sm transition-shadow">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-full bg-orange-100 text-orange-600">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Pending Alerts</p>
              <h4 className="text-xl font-bold">{stats?.pending_alerts ?? 0}</h4>
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-sm transition-shadow">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-full bg-purple-100 text-purple-600">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active Alerts</p>
              <h4 className="text-xl font-bold">{stats?.active_alerts ?? 0}</h4>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Extra stats row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="hover:shadow-sm transition-shadow">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-full bg-indigo-100 text-indigo-600">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Community Posts</p>
              <h4 className="text-xl font-bold">{stats?.total_posts ?? 0}</h4>
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-sm transition-shadow">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-full bg-teal-100 text-teal-600">
              <Phone className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Registered Phones</p>
              <h4 className="text-xl font-bold">{stats?.registered_phones ?? 0}</h4>
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-sm transition-shadow">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-full bg-rose-100 text-rose-600">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Incidents</p>
              <h4 className="text-xl font-bold">{stats?.incidents ?? 0}</h4>
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-sm transition-shadow">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-full bg-amber-100 text-amber-600">
              <Settings className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">AI Calls Today</p>
              <h4 className="text-xl font-bold">{stats?.ai_calls_today ?? 0}</h4>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Approvals - real data */}
        <Card>
          <CardHeader>
            <CardTitle>Pending Alert Approvals</CardTitle>
            <CardDescription>Alerts requiring admin review before activation.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alert</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingAlerts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">No pending approvals</TableCell>
                  </TableRow>
                )}
                {pendingAlerts.map(alert => (
                  <TableRow key={alert.id}>
                    <TableCell className="font-medium">
                      <div>{alert.title}</div>
                      <div className="text-xs text-muted-foreground">{alert.created_at ? new Date(alert.created_at).toLocaleString() : ''}</div>
                    </TableCell>
                    <TableCell>{alert.alert_type || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={alert.severity === 'critical' ? 'destructive' : 'outline'}>
                        {alert.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="icon" variant="ghost" onClick={() => handleApprove(alert.id, true)} className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50">
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleApprove(alert.id, false)} className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50">
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* System Logs - real data */}
        <Card>
          <CardHeader>
            <CardTitle>System Logs</CardTitle>
            <CardDescription>Recent alerts, incidents, and system events.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {systemLogs.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No recent activity</p>
              )}
              {systemLogs.map((log, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <div className={`mt-0.5 w-2 h-2 rounded-full ${
                    log.color === 'red' ? 'bg-red-500' :
                    log.color === 'yellow' ? 'bg-yellow-500' :
                    log.color === 'green' ? 'bg-green-500' : 'bg-blue-500'
                  }`}></div>
                  <div className="flex-1">
                    <p className="font-medium">{log.title}</p>
                    <p className="text-muted-foreground">{log.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">{log.time ? new Date(log.time).toLocaleString() : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
        </TabsContent>

        <TabsContent value="ingestion" className="space-y-6">
          {actionFeedback && (
            <Alert className="border-blue-200 bg-blue-50">
              <AlertDescription className="text-blue-800">{actionFeedback}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Run Source Ingestion (Admin)</CardTitle>
              <CardDescription>
                Trigger real data fetch from MOSDAC and other sources, store to DB, and update existing records.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <Button
                  onClick={() => handleRunIngestion('all')}
                  disabled={ingestionRunning}
                  className="justify-start"
                >
                  {ingestionRunning && ingestionMode === 'all' ? 'Running...' : 'Run All Sources'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleRunIngestion('mosdac')}
                  disabled={ingestionRunning}
                  className="justify-start"
                >
                  {ingestionRunning && ingestionMode === 'mosdac' ? 'Running...' : 'Run MOSDAC Poll'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleRunIngestion('weather_aqi')}
                  disabled={ingestionRunning}
                  className="justify-start"
                >
                  {ingestionRunning && ingestionMode === 'weather_aqi' ? 'Running...' : 'Run Weather + AQI'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleRunIngestion('disasters')}
                  disabled={ingestionRunning}
                  className="justify-start"
                >
                  {ingestionRunning && ingestionMode === 'disasters' ? 'Running...' : 'Run USGS + GDACS'}
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border rounded-lg p-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">MOSDAC Backfill Days</label>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={mosdacBackfillDays}
                    onChange={(e) => setMosdacBackfillDays(Math.max(1, Math.min(30, Number(e.target.value) || 7)))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">MOSDAC Limit Per Tile</label>
                  <Input
                    type="number"
                    min={5}
                    max={300}
                    value={mosdacBackfillLimit}
                    onChange={(e) => setMosdacBackfillLimit(Math.max(5, Math.min(300, Number(e.target.value) || 80)))}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    variant="destructive"
                    onClick={() => handleRunIngestion('mosdac_backfill')}
                    disabled={ingestionRunning}
                    className="w-full"
                  >
                    {ingestionRunning && ingestionMode === 'mosdac_backfill' ? 'Backfilling...' : 'Run MOSDAC Backfill'}
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                All actions persist fetched data into dataset tables and update admin-visible DB counts below.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Database Data Volume</CardTitle>
              <CardDescription>
                Current row counts by dataset and top source split (window: last {dataSummary?.recent_window_hours || 24}h).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-dashed">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Total Rows (all datasets)</p>
                    <p className="text-2xl font-bold">{dataSummary?.totals?.rows_total ?? 0}</p>
                  </CardContent>
                </Card>
                <Card className="border-dashed">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Rows in Last 24h</p>
                    <p className="text-2xl font-bold">{dataSummary?.totals?.rows_recent ?? 0}</p>
                  </CardContent>
                </Card>
                <Card className="border-dashed">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Avg Ingestion Quality</p>
                    <p className="text-2xl font-bold">{dataSummary?.ingestion_logs?.average_quality_score ?? 0}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dataset</TableHead>
                      <TableHead>Total Rows</TableHead>
                      <TableHead>Last 24h</TableHead>
                      <TableHead>Last Seen</TableHead>
                      <TableHead>Top Sources</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(dataSummary?.datasets || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          No data summary available yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {(dataSummary?.datasets || []).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell>{row.rows_total ?? 0}</TableCell>
                        <TableCell>{row.rows_recent ?? 0}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.last_seen ? new Date(row.last_seen).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell className="text-xs">
                          {(row.sources || []).slice(0, 3).map((s) => `${s.source}: ${s.rows}`).join(' | ') || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="text-xs text-muted-foreground">
                Ingestion status: {Object.entries(dataSummary?.ingestion_logs?.status_breakdown || {})
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ') || 'no logs'}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════ COMMUNITY VERIFICATION TAB ═══════ */}
        <TabsContent value="verification" className="space-y-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-xl font-semibold">Community Alert Verification</h2>
              <p className="text-sm text-muted-foreground">
                Review community alert and emergency posts before making them public.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {[
                ['pending_admin_review', 'Pending'],
                ['in_review', 'In Review'],
                ['needs_info', 'Need Info'],
                ['approved', 'Approved'],
                ['rejected', 'Rejected'],
                ['all', 'All'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setVerificationFilter(value)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${verificationFilter === value ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted'}`}
                >
                  {label}
                </button>
              ))}
              <Button size="sm" variant="outline" onClick={fetchData} className="gap-1">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </div>
          </div>

          {actionFeedback && (
            <Alert className="border-blue-200 bg-blue-50">
              <AlertDescription className="text-blue-800">{actionFeedback}</AlertDescription>
            </Alert>
          )}

          {filteredVerificationPosts.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                No community posts found for this verification state.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredVerificationPosts.map((post) => {
                const verification = post?.verification || {};
                const status = verification?.status || 'pending_admin_review';
                const statusLabel = verification?.status_label || status;
                const progress = Math.max(0, Math.min(100, Number(verification?.progress_percent || 0)));
                const statusBadgeClass = {
                  pending_admin_review: 'bg-amber-100 text-amber-700 border-amber-300',
                  in_review: 'bg-blue-100 text-blue-700 border-blue-300',
                  needs_info: 'bg-orange-100 text-orange-700 border-orange-300',
                  approved: 'bg-emerald-100 text-emerald-700 border-emerald-300',
                  rejected: 'bg-rose-100 text-rose-700 border-rose-300',
                }[status] || 'bg-slate-100 text-slate-700 border-slate-300';

                const imageMedia = (post?.media || []).find((item) => String(item?.type || '').startsWith('image/'));
                const imageUrl = getMediaPreviewUrl(imageMedia);
                const imageAnalysis = post?.image_analysis || {};
                const locationLabel = post?.location?.name || post?.location?.city || post?.location?.pincode || 'Unknown location';

                const noteValue = verificationNotes[post.id] ?? verification?.admin_comment ?? '';
                const reportValue = verificationReports[post.id] ?? verification?.report_to_user ?? '';
                const notifyChannels = verificationNotifyChannels[post.id] || { sms: true, telegram: true };
                const notifyRadius = verificationNotifyRadiusKm[post.id] ?? 10;

                return (
                  <Card key={post.id}>
                    <CardContent className="p-4 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-sm">{post?.location?.author || 'Community Member'}</p>
                          <p className="text-xs text-muted-foreground">
                            {String(post?.type || '').toUpperCase()} • {locationLabel} • {post?.created_at ? new Date(post.created_at).toLocaleString() : ''}
                          </p>
                        </div>
                        <Badge className={`border ${statusBadgeClass}`}>
                          {statusLabel}
                        </Badge>
                      </div>

                      <p className="text-sm whitespace-pre-wrap">{post?.content || ''}</p>

                      {imageUrl && (
                        <div className="space-y-2">
                          <img
                            src={imageUrl}
                            alt="Community evidence"
                            className="w-full max-h-80 object-cover rounded-md border"
                          />
                          <p className="text-xs text-muted-foreground">Evidence image submitted by user.</p>
                        </div>
                      )}

                      {imageAnalysis?.disaster_type && (
                        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                          <p>
                            AI analysis: <strong className="text-foreground capitalize">{imageAnalysis.disaster_type}</strong>
                            {' '}• severity <strong className="text-foreground capitalize">{imageAnalysis.severity || 'unknown'}</strong>
                            {' '}• confidence {Math.round((Number(imageAnalysis.confidence || 0) || 0) * 100)}%
                          </p>
                          <p className="mt-1">Authenticity: {imageAnalysis.authenticity || 'uncertain'}</p>
                        </div>
                      )}

                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">Verification Progress</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {verification?.message || 'Waiting for admin action.'}
                        </p>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium mb-1 block">Admin comment (visible update)</label>
                          <textarea
                            className="w-full min-h-[84px] border rounded-md p-2 text-sm bg-background"
                            placeholder="Add context for user/community..."
                            value={noteValue}
                            onChange={(e) => setVerificationNotes((prev) => ({ ...prev, [post.id]: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium mb-1 block">Report to user (decision reason)</label>
                          <textarea
                            className="w-full min-h-[84px] border rounded-md p-2 text-sm bg-background"
                            placeholder="Explain why approved/rejected/needs info..."
                            value={reportValue}
                            onChange={(e) => setVerificationReports((prev) => ({ ...prev, [post.id]: e.target.value }))}
                          />
                        </div>
                      </div>

                      <div className="rounded-md border bg-muted/20 p-3">
                        <p className="text-xs font-medium">Nearby notifications on approval</p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Choose delivery channels and radius used when you click Approve & Publish.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={Boolean(notifyChannels.sms)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setVerificationNotifyChannels((prev) => ({
                                  ...prev,
                                  [post.id]: {
                                    ...(prev[post.id] || { sms: true, telegram: true }),
                                    sms: checked,
                                  },
                                }));
                              }}
                            />
                            SMS
                          </label>
                          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={Boolean(notifyChannels.telegram)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setVerificationNotifyChannels((prev) => ({
                                  ...prev,
                                  [post.id]: {
                                    ...(prev[post.id] || { sms: true, telegram: true }),
                                    telegram: checked,
                                  },
                                }));
                              }}
                            />
                            Telegram
                          </label>
                          <div className="flex items-center gap-2 text-sm">
                            <span>Radius</span>
                            <Input
                              type="number"
                              min={1}
                              max={50}
                              step={1}
                              value={notifyRadius}
                              onChange={(e) => {
                                const raw = e.target.value;
                                if (raw === '') {
                                  setVerificationNotifyRadiusKm((prev) => ({ ...prev, [post.id]: '' }));
                                  return;
                                }
                                const next = Number(raw);
                                setVerificationNotifyRadiusKm((prev) => ({
                                  ...prev,
                                  [post.id]: Number.isFinite(next) ? Math.min(50, Math.max(1, next)) : 10,
                                }));
                              }}
                              className="h-8 w-24"
                            />
                            <span className="text-xs text-muted-foreground">km</span>
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-2">
                          In-app real-time delivery is also attempted for the same nearby radius.
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={verificationUpdatingId === post.id}
                          onClick={() => handleVerificationAction(post.id, 'in_review')}
                        >
                          Mark In Review
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={verificationUpdatingId === post.id}
                          onClick={() => handleVerificationAction(post.id, 'needs_info')}
                        >
                          Request More Info
                        </Button>
                        <Button
                          size="sm"
                          disabled={verificationUpdatingId === post.id}
                          onClick={() => handleVerificationAction(post.id, 'approved')}
                        >
                          {verificationUpdatingId === post.id ? 'Updating...' : 'Approve & Publish'}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={verificationUpdatingId === post.id}
                          onClick={() => handleVerificationAction(post.id, 'rejected')}
                        >
                          Reject
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ═══════ COMMUNITY REPORTS TAB ═══════ */}
        <TabsContent value="reports" className="space-y-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-xl font-semibold">Community Reports</h2>
              <p className="text-sm text-muted-foreground">User-submitted reports about harmful posts or behavior.</p>
            </div>
            <div className="flex gap-2">
              {['pending', 'reviewed', 'resolved', 'all'].map(f => (
                <button
                  key={f}
                  onClick={() => { setReportFilter(f); fetchReports(f); }}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors capitalize ${reportFilter === f ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted'}`}
                >
                  {f}
                </button>
              ))}
              <Button size="sm" variant="outline" onClick={() => fetchReports()} className="gap-1">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </div>
          </div>
          {actionFeedback && (
            <Alert className="border-blue-200 bg-blue-50">
              <AlertDescription className="text-blue-800">{actionFeedback}</AlertDescription>
            </Alert>
          )}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reporter</TableHead>
                    <TableHead>Reported User</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No reports found{reportFilter !== 'all' ? ` with status "${reportFilter}"` : ''}
                      </TableCell>
                    </TableRow>
                  )}
                  {reports.map(report => (
                    <TableRow key={report.id}>
                      <TableCell className="text-sm font-medium">{report.reporter_name}</TableCell>
                      <TableCell className="text-sm">{report.reported_user_name}</TableCell>
                      <TableCell>
                        <Badge variant={report.reason === 'harassment' || report.reason === 'false_emergency' ? 'destructive' : 'outline'} className="capitalize">
                          {report.reason.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{report.description || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={report.status === 'pending' ? 'destructive' : report.status === 'resolved' ? 'default' : 'secondary'} className="capitalize">
                          {report.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {report.created_at ? new Date(report.created_at).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {report.status === 'pending' && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => handleReportAction(report.id, 'reviewed')} className="h-7 text-xs">
                                Review
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => handleReportAction(report.id, 'resolved')} className="h-7 text-xs">
                                Resolve
                              </Button>
                            </>
                          )}
                          {report.status !== 'pending' && (
                            <Button size="sm" variant="ghost" onClick={() => handleReportAction(report.id, 'resolved')} className="h-7 text-xs text-muted-foreground">
                              Close
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <UserManagement />
        </TabsContent>

        {/* ═══════ TELEGRAM TAB ═══════ */}
        <TabsContent value="telegram" className="space-y-6">
          {/* Stats row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6 flex items-center gap-4">
                <div className={`p-3 rounded-full ${telegramStats?.enabled ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                  <Bot className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Bot Status</p>
                  <h4 className="text-xl font-bold">{telegramStats?.enabled ? 'Active' : 'Inactive'}</h4>
                  {telegramStats?.bot_username && (
                    <p className="text-xs text-muted-foreground">@{telegramStats.bot_username}</p>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-full bg-green-100 text-green-600">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Linked Users</p>
                  <h4 className="text-xl font-bold">{telegramStats?.linked_users ?? 0}</h4>
                  <p className="text-xs text-muted-foreground">{telegramStats?.percentage ?? 0}% of total users</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-full bg-purple-100 text-purple-600">
                  <Radio className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Users</p>
                  <h4 className="text-xl font-bold">{telegramStats?.total_users ?? 0}</h4>
                  <p className="text-xs text-muted-foreground">registered accounts</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {tgFeedback && (
            <Alert className={tgFeedback.startsWith('✅') ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
              <AlertDescription className={tgFeedback.startsWith('✅') ? 'text-green-800' : 'text-red-800'}>{tgFeedback}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Test Message */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Send className="w-5 h-5" /> Send Test Message
                </CardTitle>
                <CardDescription>
                  Send a direct message to a specific Telegram chat ID. Get your chat ID by messaging @userinfobot on Telegram.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Telegram Chat ID</label>
                  <Input
                    placeholder="e.g. 123456789"
                    value={tgTestChatId}
                    onChange={e => setTgTestChatId(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Message</label>
                  <textarea
                    className="w-full border rounded-md p-2 text-sm min-h-[80px] resize-y bg-background"
                    placeholder="Type your test message here..."
                    value={tgTestMsg}
                    onChange={e => setTgTestMsg(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleTelegramTest}
                  disabled={tgSending || !tgTestChatId.trim() || !tgTestMsg.trim()}
                  className="w-full gap-2"
                >
                  <Send className="w-4 h-4" />
                  {tgSending ? 'Sending...' : 'Send Test Message'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  ℹ️ Users must link their Telegram by messaging @{telegramStats?.bot_username || 'SurakshaSetuBot'} first.
                </p>
              </CardContent>
            </Card>

            {/* Broadcast */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Radio className="w-5 h-5" /> Broadcast to All Users
                </CardTitle>
                <CardDescription>
                  Send an alert or custom message to all {telegramStats?.linked_users ?? 0} Telegram-linked users at once.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Broadcast as Alert (optional)</label>
                  <select
                    className="w-full border rounded-md p-2 text-sm bg-background"
                    value={tgBroadcastAlertId}
                    onChange={e => setTgBroadcastAlertId(e.target.value)}
                  >
                    <option value="">— Custom message (no alert) —</option>
                    {alerts.slice(0, 30).map(a => (
                      <option key={a.id} value={a.id}>
                        [{a.severity?.toUpperCase()}]{a.is_active ? ' [ACTIVE]' : ''} {a.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Custom Message (optional)</label>
                  <textarea
                    className="w-full border rounded-md p-2 text-sm min-h-[80px] resize-y bg-background"
                    placeholder="Type your broadcast message..."
                    value={tgBroadcastMsg}
                    onChange={e => setTgBroadcastMsg(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    If alert template is selected, Telegram will send alert card format. Keep message for quick custom broadcast.
                  </p>
                </div>
                <Button
                  onClick={handleTelegramBroadcast}
                  disabled={tgSending || (!tgBroadcastMsg.trim() && !tgBroadcastAlertId)}
                  className="w-full gap-2"
                  variant={tgBroadcastAlertId ? 'destructive' : 'default'}
                >
                  <Radio className="w-4 h-4" />
                  {tgSending ? 'Broadcasting...' : `Broadcast to ${telegramStats?.linked_users ?? 0} Users`}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* How to link Telegram */}
          <Card>
            <CardHeader>
              <CardTitle>How Users Link Their Telegram</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>User goes to their Profile page → click <strong>"Link Telegram"</strong></li>
                <li>They get a unique link code (8-char, 10-min expiry)</li>
                <li>They open Telegram, message <strong>@{telegramStats?.bot_username || 'SurakshaSetuBot'}</strong> with: <code className="bg-muted px-1 rounded">/start &lt;CODE&gt;</code></li>
                <li>Bot confirms linking, user receives alerts automatically based on location & radius</li>
              </ol>
              <div className="mt-4 p-3 bg-muted rounded-lg text-xs">
                <strong>Bot webhook URL (set once via BotFather):</strong><br />
                <code>{API_URL}/api/telegram/webhook</code>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════ MULTI-CHANNEL BROADCAST TAB ═══════ */}
        <TabsContent value="broadcast" className="space-y-6">
          {broadcastFeedback && (
            <Alert className={broadcastFeedback.startsWith('✅') ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
              <AlertDescription className={broadcastFeedback.startsWith('✅') ? 'text-green-800' : 'text-red-800'}>
                {broadcastFeedback}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Send className="w-5 h-5" /> Broadcast Composer
                </CardTitle>
                <CardDescription>
                  Create one message and dispatch to selected channels (Telegram, SMS, Email, Push, WebSocket).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium mb-1 block">Title</label>
                    <Input
                      value={broadcastTitle}
                      onChange={(e) => setBroadcastTitle(e.target.value)}
                      placeholder="e.g. Heavy Rain Advisory"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Severity</label>
                    <select
                      value={broadcastSeverity}
                      onChange={(e) => setBroadcastSeverity(e.target.value)}
                      className="w-full border rounded-md p-2 text-sm bg-background"
                    >
                      <option value="info">Info</option>
                      <option value="warning">Warning</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">Use Existing Alert Template (optional)</label>
                  <select
                    value={broadcastAlertId}
                    onChange={(e) => setBroadcastAlertId(e.target.value)}
                    className="w-full border rounded-md p-2 text-sm bg-background"
                  >
                    <option value="">— No template —</option>
                    {alerts.slice(0, 30).map((a) => (
                      <option key={a.id} value={a.id}>
                        [{a.severity?.toUpperCase()}]{a.is_active ? ' [ACTIVE]' : ''} {a.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">Broadcast Message</label>
                  <textarea
                    className="w-full border rounded-md p-3 text-sm min-h-[140px] resize-y bg-background"
                    placeholder="Type your public message, or generate one using AI below..."
                    value={broadcastMessage}
                    onChange={(e) => setBroadcastMessage(e.target.value)}
                  />
                </div>

                <div className="border rounded-lg p-3 bg-muted/40 space-y-3">
                  <label className="text-sm font-medium block">AI Message Generator</label>
                  <Input
                    value={broadcastPrompt}
                    onChange={(e) => setBroadcastPrompt(e.target.value)}
                    placeholder="Describe situation (location, risk, timeline, desired tone)..."
                  />
                  <Button
                    onClick={handleGenerateBroadcastMessage}
                    disabled={broadcastGenerating || !broadcastPrompt.trim()}
                    variant="outline"
                    className="gap-2"
                  >
                    <Bot className="w-4 h-4" />
                    {broadcastGenerating ? 'Generating...' : 'Generate Message with AI'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Channels & Dispatch</CardTitle>
                <CardDescription>
                  Choose available channels and send one click broadcast.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { key: 'telegram', label: 'Telegram' },
                  { key: 'sms', label: 'SMS' },
                  { key: 'email', label: 'Email' },
                  { key: 'push', label: 'Push' },
                  { key: 'websocket', label: 'WebSocket' },
                ].map((ch) => {
                  const stats = broadcastChannelStats?.[ch.key];
                  const enabled = stats?.enabled !== false;
                  return (
                    <label key={ch.key} className={`flex items-center justify-between p-2 rounded-md border ${enabled ? '' : 'opacity-50'}`}>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!broadcastChannels[ch.key]}
                          disabled={!enabled}
                          onChange={(e) => setBroadcastChannels((prev) => ({ ...prev, [ch.key]: e.target.checked }))}
                        />
                        <span className="text-sm font-medium">{ch.label}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{stats?.recipients ?? 0}</span>
                    </label>
                  );
                })}

                <Button
                  className="w-full gap-2"
                  onClick={handleMultiChannelBroadcast}
                  disabled={broadcastSending || (!broadcastMessage.trim() && !broadcastAlertId)}
                >
                  <Radio className="w-4 h-4" />
                  {broadcastSending ? 'Broadcasting...' : 'Send Multi-Channel Broadcast'}
                </Button>

                <p className="text-xs text-muted-foreground">
                  Tip: choose Telegram + SMS for urgent updates; add Email for detailed advisories.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ═══════ ALERT SAFETY TAB ═══════ */}
        <TabsContent value="safety" className="space-y-6">
          {actionFeedback && (
            <Alert className="border-blue-200 bg-blue-50">
              <AlertDescription className="text-blue-800">{actionFeedback}</AlertDescription>
            </Alert>
          )}

          {/* Safety Engine Status */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-3">
                  <Shield className="w-5 h-5 text-green-600" />
                  <h3 className="font-semibold">Thresholds</h3>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Auto-notify</span><Badge variant="outline" className="bg-red-50 text-red-700">≥ 0.70</Badge></div>
                  <div className="flex justify-between"><span>Admin review</span><Badge variant="outline" className="bg-yellow-50 text-yellow-700">0.45–0.70</Badge></div>
                  <div className="flex justify-between"><span>Monitor only</span><Badge variant="outline" className="bg-green-50 text-green-700">&lt; 0.45</Badge></div>
                  <div className="flex justify-between"><span>Vision auto</span><Badge variant="outline">≥ 0.85</Badge></div>
                  <div className="flex justify-between"><span>Vision review</span><Badge variant="outline">≥ 0.60</Badge></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-3">
                  <FileWarning className="w-5 h-5 text-orange-600" />
                  <h3 className="font-semibold">False Positives</h3>
                </div>
                {safetyStatus ? (
                  <div className="space-y-2 text-sm">
                    {Object.entries(safetyStatus.false_positive_counts || {}).length > 0 ? (
                      Object.entries(safetyStatus.false_positive_counts).map(([type, count]) => (
                        <div key={type} className="flex justify-between items-center">
                          <span>{type}: <strong>{count}</strong>/3</span>
                          <Button size="sm" variant="ghost" onClick={() => handleResetFP(type)} className="h-7 text-xs gap-1">
                            <RefreshCw className="w-3 h-3" /> Reset
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground">No false positives recorded</p>
                    )}
                    {safetyStatus.auto_disabled_types?.length > 0 && (
                      <div className="mt-2 p-2 bg-red-50 rounded text-red-700 text-xs">
                        <strong>⚠️ Auto-disabled:</strong> {safetyStatus.auto_disabled_types.join(', ')}
                      </div>
                    )}
                  </div>
                ) : <p className="text-sm text-muted-foreground">Loading...</p>}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-3">
                  <AlertTriangle className="w-5 h-5 text-blue-600" />
                  <h3 className="font-semibold">Active Alerts</h3>
                </div>
                <div className="text-3xl font-bold">{activeAlerts.length}</div>
                <p className="text-sm text-muted-foreground mt-1">{pendingAlerts.length} pending review</p>
              </CardContent>
            </Card>
          </div>

          {/* Active Alerts with Retract */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Undo2 className="w-5 h-5" /> Alert Retraction (One-Click)
              </CardTitle>
              <CardDescription>Retract wrong alerts instantly. Correction SMS sent to all affected users.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Alert</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeAlerts.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No active alerts</TableCell></TableRow>
                  )}
                  {activeAlerts.map(alert => (
                    <TableRow key={alert.id}>
                      <TableCell className="font-medium max-w-[200px] truncate">{alert.title}</TableCell>
                      <TableCell>
                        <Badge variant={alert.severity === 'critical' ? 'destructive' : 'outline'}>
                          {alert.severity}
                        </Badge>
                      </TableCell>
                      <TableCell>{alert.source || '—'}</TableCell>
                      <TableCell className="text-xs">{alert.created_at ? new Date(alert.created_at).toLocaleString() : '—'}</TableCell>
                      <TableCell className="text-right">
                        {retractingId === alert.id ? (
                          <div className="flex items-center gap-2 justify-end">
                            <Input
                              placeholder="Reason for retraction"
                              value={retractReason}
                              onChange={e => setRetractReason(e.target.value)}
                              className="h-8 w-48 text-xs"
                            />
                            <Button size="sm" variant="destructive" onClick={() => handleRetract(alert.id)} className="h-8 text-xs">
                              Confirm Retract
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setRetractingId(null); setRetractReason(''); }} className="h-8 text-xs">
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setRetractingId(alert.id)} className="h-8 text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50">
                            <Undo2 className="w-3 h-3" /> Retract
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Alert CRUD Management */}
          <Card>
            <CardHeader>
              <CardTitle>Alert Data Management (CRUD)</CardTitle>
              <CardDescription>Create, edit status, and remove alerts directly from admin dashboard.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input placeholder="Alert title" value={alertForm.title} onChange={(e) => setAlertForm((p) => ({ ...p, title: e.target.value }))} />
                <Input placeholder="Type (weather/flood/aqi)" value={alertForm.alert_type} onChange={(e) => setAlertForm((p) => ({ ...p, alert_type: e.target.value }))} />
                <Input placeholder="Severity (info/warning/critical)" value={alertForm.severity} onChange={(e) => setAlertForm((p) => ({ ...p, severity: e.target.value }))} />
                <Input placeholder="City" value={alertForm.city} onChange={(e) => setAlertForm((p) => ({ ...p, city: e.target.value }))} />
                <Input placeholder="Latitude" value={alertForm.lat} onChange={(e) => setAlertForm((p) => ({ ...p, lat: e.target.value }))} />
                <Input placeholder="Longitude" value={alertForm.lon} onChange={(e) => setAlertForm((p) => ({ ...p, lon: e.target.value }))} />
              </div>
              <Input placeholder="Description" value={alertForm.description} onChange={(e) => setAlertForm((p) => ({ ...p, description: e.target.value }))} />
              <Input placeholder="Target Pincode (optional — e.g. 400001)" value={alertForm.pincode} onChange={(e) => setAlertForm((p) => ({ ...p, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) }))} maxLength={6} />
              <Button onClick={handleCreateAlert} disabled={!alertForm.title || !alertForm.description}>Create Alert</Button>

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          No alerts available yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {alerts.slice(0, 10).map((alert) => (
                      <TableRow key={alert.id}>
                        <TableCell className="font-medium max-w-[240px] truncate">{alert.title}</TableCell>
                        <TableCell>{alert.alert_type}</TableCell>
                        <TableCell><Badge variant={alert.severity === 'critical' ? 'destructive' : 'outline'}>{alert.severity}</Badge></TableCell>
                        <TableCell>{alert.is_active ? 'Active' : 'Inactive'}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleToggleAlertActive(alert)}>
                              {alert.is_active ? 'Deactivate' : 'Activate'}
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => handleDeleteAlert(alert.id)}>
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Pending Review */}
          <Card>
            <CardHeader>
              <CardTitle>Pending Admin Review (Medium Confidence)</CardTitle>
              <CardDescription>Alerts between 0.45–0.70 confidence require manual review.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Alert</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingAlerts.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No pending reviews</TableCell></TableRow>
                  )}
                  {pendingAlerts.map(alert => (
                    <TableRow key={alert.id}>
                      <TableCell className="font-medium">{alert.title}</TableCell>
                      <TableCell>{alert.alert_type}</TableCell>
                      <TableCell><Badge variant="outline">{alert.severity}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => handleApprove(alert.id, true)} className="h-8 text-xs text-green-600 hover:bg-green-50 gap-1">
                            <Check className="w-3 h-3" /> Approve
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleApprove(alert.id, false)} className="h-8 text-xs text-red-600 hover:bg-red-50 gap-1">
                            <X className="w-3 h-3" /> Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Incident Logs */}
          <Card>
            <CardHeader>
              <CardTitle>Incident Logs</CardTitle>
              <CardDescription>Audit trail of retractions, false positives, and corrective actions.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {incidents.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No incidents recorded</p>}
                {incidents.map(inc => (
                  <div key={inc.id} className="flex items-start gap-3 text-sm border-b pb-3 last:border-0">
                    <div className={`mt-0.5 w-2 h-2 rounded-full ${inc.type === 'retraction' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                    <div className="flex-1">
                      <p className="font-medium">{inc.type}: {inc.reason}</p>
                      <p className="text-muted-foreground text-xs">{inc.action}</p>
                      <p className="text-xs text-muted-foreground mt-1">{inc.created_at ? new Date(inc.created_at).toLocaleString() : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════ SMS TAB ═══════ */}
        <TabsContent value="sms" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6 flex items-center gap-4">
                <div className={`p-3 rounded-full ${smsStatus?.twilio_available ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'}`}>
                  <Phone className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Twilio</p>
                  <h4 className="text-xl font-bold">{smsStatus?.twilio_available ? 'Connected' : 'Mock Mode'}</h4>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-full bg-blue-100 text-blue-600">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Registered Phones</p>
                  <h4 className="text-xl font-bold">{smsStatus?.registered_phones ?? '—'}</h4>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-full bg-purple-100 text-purple-600">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">SMS Sent</p>
                  <h4 className="text-xl font-bold">{smsLogs.reduce((acc, l) => acc + (l.sent || 0), 0)}</h4>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>SMS Dispatch Audit Log</CardTitle>
              <CardDescription>Every SMS sent or retracted, with timestamps and phone counts.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Alert Type</TableHead>
                    <TableHead>Risk Score</TableHead>
                    <TableHead>Phones</TableHead>
                    <TableHead>Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {smsLogs.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No SMS dispatched yet</TableCell></TableRow>
                  )}
                  {smsLogs.map((log, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}</TableCell>
                      <TableCell>
                        <Badge variant={log.type === 'retraction' ? 'destructive' : 'default'}>{log.type}</Badge>
                      </TableCell>
                      <TableCell>{log.alert_type || '—'}</TableCell>
                      <TableCell>{log.risk_score?.toFixed(2) || '—'}</TableCell>
                      <TableCell>{log.phones_count}</TableCell>
                      <TableCell className="text-green-600 font-semibold">{log.sent}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </Skeleton>
  );
};

export default AdminDashboard;
