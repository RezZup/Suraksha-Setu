import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  AlertTriangle, 
  Wind, 
  Droplets, 
  Thermometer, 
  CheckCircle2, 
  Filter,
  Search,
  ArrowUpDown,
  MapPin,
  Share2,
  Volume2,
  Loader
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from '@/hooks/use-toast';
import { cachedFetchJson } from '@/utils/requestCache';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { useLocation as useRouterLocation, useNavigate } from 'react-router-dom';
import { getAuthHeadersForApi } from '@/utils/authHeaders';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

const AlertCard = ({ alert, onFeedback }) => {
  const { t } = useTranslation();
  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'border-destructive bg-destructive/5';
      case 'high': return 'border-orange-500 bg-orange-500/5';
      case 'moderate': return 'border-yellow-500 bg-yellow-500/5';
      default: return 'border-blue-500 bg-blue-500/5';
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'cyclone': return Wind;
      case 'flood': return Droplets;
      case 'heat': return Thermometer;
      default: return AlertTriangle;
    }
  };

  const Icon = getIcon(alert.type);
  const severityBadgeClass =
    alert.severity === 'critical'
      ? 'bg-destructive text-destructive-foreground'
      : alert.severity === 'high'
      ? 'bg-orange-500 text-white'
      : alert.severity === 'moderate'
      ? 'bg-yellow-500 text-black'
      : 'bg-blue-500 text-white';

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`relative border-l-4 rounded-r-lg p-4 mb-4 bg-card shadow-sm hover:shadow-md transition-all ${getSeverityColor(alert.severity)}`}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-3 min-w-0">
            <div className={`p-2 rounded-full ${
              alert.severity === 'critical' ? 'bg-destructive/10 text-destructive' :
              alert.severity === 'high' ? 'bg-orange-500/10 text-orange-500' :
              'bg-blue-500/10 text-blue-500'
            }`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-bold text-foreground truncate">{alert.title}</h4>
                <Badge className={`text-[10px] font-semibold ${severityBadgeClass}`}>
                  {String(alert.severity || 'info').toUpperCase()}
                </Badge>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {String(alert.type || 'alert').replace(/_/g, ' ')}
                </Badge>
                {alert.severity === 'critical' && (
                  <span className="animate-pulse px-2 py-0.5 rounded text-[10px] font-bold bg-destructive text-destructive-foreground">
                    {t('alerts.live')}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{alert.message}</p>
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button variant="outline" size="icon" className="h-8 w-8">
              <Share2 className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8">
              <Volume2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" /> {alert.location}
          </span>
          <span>{alert.time}</span>
          <span className="font-medium text-foreground">{t('alerts.impact')}: {alert.impact}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
          {typeof alert.trustScore === 'number' ? (
            <Badge variant="outline" className="text-xs">
              {t('alerts.trustScore')}: {Math.round(alert.trustScore)}%
            </Badge>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => onFeedback(alert.id, 'accurate')}>
            {t('alerts.accurate')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onFeedback(alert.id, 'false_alarm')}>
            {t('alerts.falseAlarm')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onFeedback(alert.id, 'outdated')}>
            {t('alerts.outdated')}
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

const Alerts = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const routerLocation = useRouterLocation();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [filteredAlerts, setFilteredAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  
  // Filter states
  const [selectedSeverity, setSelectedSeverity] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedRegion, setSelectedRegion] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState('latest');
  const [feedMode, setFeedMode] = useState('all');
  const [showCreateAlert, setShowCreateAlert] = useState(false);
  const [creatingAlert, setCreatingAlert] = useState(false);
  const [createAlertForm, setCreateAlertForm] = useState({
    title: '',
    alert_type: 'weather',
    severity: 'warning',
    city: '',
    lat: '',
    lon: '',
    description: '',
  });
  
  const { toast } = useToast();
  const isPrivilegedUser = ['admin', 'developer'].includes(String(user?.role || '').toLowerCase());

  const submitFeedback = async (alertId, verdict) => {
    try {
      const token = localStorage.getItem('auth_token') || '';
      const res = await fetch(`${API_URL}/api/alerts/${alertId}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          verdict,
          user_id: user?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Failed to submit feedback');

      setAlerts((prev) =>
        prev.map((item) =>
          item.id === alertId
            ? {
                ...item,
                trustScore: data?.summary?.trust_score,
                feedbackCounts: data?.summary?.counts,
                feedbackTotal: data?.summary?.total,
              }
            : item
        )
      );

      toast({
        title: t('alerts.feedbackSubmitted'),
        description: t('alerts.feedbackThanks'),
      });
    } catch (err) {
      toast({
        title: t('alerts.feedbackSubmitError'),
        description: err?.message || t('alerts.feedbackTryAgain'),
        variant: 'destructive',
      });
    }
  };

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();

      if (selectedSeverity !== 'all') {
        params.append('severity', selectedSeverity);
      }
      if (selectedType !== 'all') {
        params.append('report_type', selectedType);
      }

      const data = await cachedFetchJson(
        `${API_URL}/api/alerts${params.toString() ? '?' + params.toString() : ''}`,
        { ttlMs: 45 * 1000 }
      );

      const formattedAlerts = (data.alerts || []).map(alert => ({
        id: alert.id || Math.random(),
        type: (alert.report_type || alert.type || alert.alert_type || 'info').toLowerCase(),
        severity: alert.severity?.toLowerCase() || 'info',
        title: alert.title || alert.alert_type || 'Alert',
        message: alert.description || alert.message || '',
        location: typeof alert.location === 'string'
          ? alert.location
          : alert.location_data?.city || alert.location_data?.name || alert.location_data?.state || 'Unknown Location',
        time: (alert.timestamp || alert.created_at)
          ? new Date(alert.timestamp || alert.created_at).toLocaleString()
          : t('alerts.recently'),
        sortTimestamp: alert.timestamp || alert.created_at || new Date().toISOString(),
        impact: alert.affected_population ? `Affecting ${alert.affected_population} people` : 'To be determined',
        trustScore: typeof alert.trust_score === 'number'
          ? alert.trust_score
          : (typeof alert.feedback?.trust_score === 'number' ? alert.feedback.trust_score : null),
        feedbackCounts: alert.feedback?.counts || null,
        feedbackTotal: alert.feedback?.total || 0,
      }));

      setAlerts(formattedAlerts);
      setFilteredAlerts(formattedAlerts);
      setError(null);
    } catch (err) {
      console.error('Error fetching alerts:', err);
      setError('Failed to load alerts. Showing sample data.');
      setAlerts([]);
      setFilteredAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [selectedSeverity, selectedType, t]);

  const handleCreateSystemAlert = async () => {
    if (!isPrivilegedUser) return;

    const title = createAlertForm.title.trim();
    const description = createAlertForm.description.trim();
    if (!title || !description) {
      toast({
        title: 'Missing fields',
        description: 'Title and description are required to send an alert.',
        variant: 'destructive',
      });
      return;
    }

    const payload = {
      alert_type: createAlertForm.alert_type,
      severity: createAlertForm.severity,
      title,
      description,
      source: 'admin',
      is_active: true,
      location: {
        city: createAlertForm.city || 'Unknown',
        lat: createAlertForm.lat !== '' ? Number(createAlertForm.lat) : null,
        lon: createAlertForm.lon !== '' ? Number(createAlertForm.lon) : null,
      },
    };

    setCreatingAlert(true);
    try {
      const res = await fetch(`${API_URL}/admin/alerts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeadersForApi(API_URL, 'admin'),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.detail || data?.error || 'Failed to create alert');
      }

      toast({
        title: 'Alert sent',
        description: 'System alert has been created and published.',
      });
      setCreateAlertForm({
        title: '',
        alert_type: 'weather',
        severity: 'warning',
        city: '',
        lat: '',
        lon: '',
        description: '',
      });
      await fetchAlerts();
    } catch (err) {
      toast({
        title: 'Failed to send alert',
        description: err?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setCreatingAlert(false);
    }
  };

  // Fetch alerts data
  useEffect(() => {
    fetchAlerts();
    
    // Refresh alerts every 2 minutes
    const interval = setInterval(fetchAlerts, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // Apply client-side region filter
  useEffect(() => {
    let filtered = alerts;
    
    if (selectedRegion !== 'all') {
      filtered = filtered.filter(a => 
        a.location.toLowerCase().includes(selectedRegion.toLowerCase())
      );
    }
    
    setFilteredAlerts(filtered);
  }, [selectedRegion, alerts]);

  useEffect(() => {
    const params = new URLSearchParams(routerLocation.search || '');
    const q = params.get('q') || '';
    setSearchQuery(q);
  }, [routerLocation.search]);

  const visibleAlerts = useMemo(() => {
    const rank = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
    let rows = [...filteredAlerts];

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      rows = rows.filter((a) =>
        [a.title, a.message, a.location, a.type]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(query))
      );
    }

    if (feedMode === 'priority') {
      rows = rows.filter((a) => ['critical', 'high'].includes(a.severity));
    }

    if (feedMode === 'trusted') {
      rows = rows.filter((a) => a.trustScore == null || a.trustScore >= 50);
    }

    rows.sort((a, b) => {
      if (sortMode === 'severity') {
        return (rank[a.severity] ?? 99) - (rank[b.severity] ?? 99);
      }
      if (sortMode === 'trust') {
        return Number(b.trustScore || 0) - Number(a.trustScore || 0);
      }
      return new Date(b.sortTimestamp).getTime() - new Date(a.sortTimestamp).getTime();
    });

    return rows;
  }, [filteredAlerts, searchQuery, sortMode, feedMode]);

  const resetFilters = () => {
    setSelectedSeverity('all');
    setSelectedType('all');
    setSelectedRegion('all');
    setSearchQuery('');
    setSortMode('latest');
    setFeedMode('all');
  };

  const alertStats = {
    critical: alerts.filter(a => a.severity === 'critical').length,
    high: alerts.filter(a => a.severity === 'high').length,
    moderate: alerts.filter(a => a.severity === 'moderate').length,
    low: alerts.filter(a => a.severity === 'low').length,
  };

  const alertTypes = ['cyclone', 'flood', 'heat', 'earthquake', 'drought', 'air_quality'];
  const regions = ['Odisha', 'Kerala', 'Maharashtra', 'Delhi', 'Bengal', 'Tamil Nadu', 'Gujarat'];

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('alerts.centerTitle')}</h1>
          <p className="text-muted-foreground">{t('alerts.centerSubtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            className="gap-2"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="w-4 h-4" /> {t('alerts.filters')}
          </Button>
          <Button
            variant="destructive"
            className="gap-2"
            onClick={() => {
              if (isPrivilegedUser) {
                setShowCreateAlert(v => !v);
              } else {
                navigate('/app/community');
              }
            }}
          >
            <AlertTriangle className="w-4 h-4" /> {isPrivilegedUser ? 'Send Alert' : t('alerts.report')}
          </Button>
        </div>
      </div>

      {isPrivilegedUser && showCreateAlert && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-lg">Create and Send Alert</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                value={createAlertForm.title}
                onChange={(e) => setCreateAlertForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Alert title"
              />
              <Input
                value={createAlertForm.city}
                onChange={(e) => setCreateAlertForm((prev) => ({ ...prev, city: e.target.value }))}
                placeholder="City / area"
              />
              <select
                value={createAlertForm.alert_type}
                onChange={(e) => setCreateAlertForm((prev) => ({ ...prev, alert_type: e.target.value }))}
                className="w-full px-3 py-2 border rounded-md bg-background text-foreground text-sm"
              >
                <option value="weather">Weather</option>
                <option value="flood">Flood</option>
                <option value="cyclone">Cyclone</option>
                <option value="earthquake">Earthquake</option>
                <option value="heatwave">Heatwave</option>
                <option value="wildfire">Wildfire</option>
              </select>
              <select
                value={createAlertForm.severity}
                onChange={(e) => setCreateAlertForm((prev) => ({ ...prev, severity: e.target.value }))}
                className="w-full px-3 py-2 border rounded-md bg-background text-foreground text-sm"
              >
                <option value="warning">Warning</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
              <Input
                type="number"
                step="any"
                value={createAlertForm.lat}
                onChange={(e) => setCreateAlertForm((prev) => ({ ...prev, lat: e.target.value }))}
                placeholder="Latitude (optional)"
              />
              <Input
                type="number"
                step="any"
                value={createAlertForm.lon}
                onChange={(e) => setCreateAlertForm((prev) => ({ ...prev, lon: e.target.value }))}
                placeholder="Longitude (optional)"
              />
            </div>

            <Textarea
              value={createAlertForm.description}
              onChange={(e) => setCreateAlertForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Describe the alert, impact, and immediate safety actions"
              className="min-h-[100px]"
            />

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreateAlert(false)} disabled={creatingAlert}>
                Cancel
              </Button>
              <Button onClick={handleCreateSystemAlert} disabled={creatingAlert}>
                {creatingAlert ? 'Sending...' : 'Send Alert'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t('alerts.critical')}</p>
            <p className="text-2xl font-bold text-destructive">{alertStats.critical}</p>
          </CardContent>
        </Card>
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t('alerts.high')}</p>
            <p className="text-2xl font-bold text-orange-500">{alertStats.high}</p>
          </CardContent>
        </Card>
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t('alerts.moderate')}</p>
            <p className="text-2xl font-bold text-yellow-500">{alertStats.moderate}</p>
          </CardContent>
        </Card>
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t('alerts.visibleAlerts')}</p>
            <p className="text-2xl font-bold text-primary">{visibleAlerts.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('alerts.searchPlaceholder')}
                className="pl-9"
              />
            </div>
            <div className="relative">
              <ArrowUpDown className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                className="w-full h-10 pl-9 pr-3 border rounded-md bg-background text-foreground text-sm"
              >
                <option value="latest">{t('alerts.sortLatest')}</option>
                <option value="severity">{t('alerts.sortSeverity')}</option>
                <option value="trust">{t('alerts.sortTrust')}</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={feedMode === 'all' ? 'default' : 'outline'} onClick={() => setFeedMode('all')}>
              {t('alerts.feedAll')}
            </Button>
            <Button size="sm" variant={feedMode === 'priority' ? 'default' : 'outline'} onClick={() => setFeedMode('priority')}>
              {t('alerts.feedPriority')}
            </Button>
            <Button size="sm" variant={feedMode === 'trusted' ? 'default' : 'outline'} onClick={() => setFeedMode('trusted')}>
              {t('alerts.feedTrusted')}
            </Button>
            <div className="text-xs text-muted-foreground ml-auto self-center">
              {t('alerts.autoRefresh')}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filter Panel */}
      {showFilters && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border rounded-lg p-4 space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Severity Filter */}
            <div>
              <label className="text-sm font-medium block mb-2">{t('alerts.severity')}</label>
              <select 
                value={selectedSeverity}
                onChange={(e) => setSelectedSeverity(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background text-foreground text-sm"
              >
                <option value="all">{t('alerts.allLevels')}</option>
                <option value="critical">{t('alerts.critical')}</option>
                <option value="high">{t('alerts.high')}</option>
                <option value="moderate">{t('alerts.moderate')}</option>
                <option value="low">{t('alerts.low')}</option>
              </select>
            </div>

            {/* Alert Type Filter */}
            <div>
              <label className="text-sm font-medium block mb-2">{t('alerts.alertType')}</label>
              <select 
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background text-foreground text-sm"
              >
                <option value="all">{t('alerts.allTypes')}</option>
                {alertTypes.map(type => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>

            {/* Region Filter */}
            <div>
              <label className="text-sm font-medium block mb-2">{t('alerts.region')}</label>
              <select 
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background text-foreground text-sm"
              >
                <option value="all">{t('alerts.allRegions')}</option>
                {regions.map(region => (
                  <option key={region} value={region}>{region}</option>
                ))}
              </select>
            </div>
          </div>

          <Button 
            variant="ghost" 
            size="sm"
            onClick={resetFilters}
            className="w-full"
          >
            {t('alerts.resetFilters')}
          </Button>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Alerts Feed */}
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : error ? (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="pt-6">
                <p className="text-sm text-destructive">{error}</p>
              </CardContent>
            </Card>
          ) : visibleAlerts.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>{t('alerts.noMatching')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('alerts.showingCount', { visible: visibleAlerts.length, total: alerts.length })}
              </p>
              {visibleAlerts.map(alert => (
                <AlertCard key={alert.id} alert={alert} onFeedback={submitFeedback} />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar Stats & Info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('alerts.severityDistribution')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-destructive font-medium">{t('alerts.critical')}</span>
                    <span>{alertStats.critical}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-destructive transition-all"
                      style={{ width: `${alerts.length > 0 ? (alertStats.critical / alerts.length) * 100 : 0}%` }}
                    ></div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-orange-500 font-medium">{t('alerts.high')}</span>
                    <span>{alertStats.high}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-orange-500 transition-all"
                      style={{ width: `${alerts.length > 0 ? (alertStats.high / alerts.length) * 100 : 0}%` }}
                    ></div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-yellow-500 font-medium">{t('alerts.moderate')}</span>
                    <span>{alertStats.moderate}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-yellow-500 transition-all"
                      style={{ width: `${alerts.length > 0 ? (alertStats.moderate / alerts.length) * 100 : 0}%` }}
                    ></div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-blue-500 font-medium">{t('alerts.low')}</span>
                    <span>{alertStats.low}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${alerts.length > 0 ? (alertStats.low / alerts.length) * 100 : 0}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                {t('alerts.feedStatus')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center text-sm bg-background/70 rounded-md p-2 border">
                <span className="text-muted-foreground">{t('alerts.totalAlerts')}</span>
                <span className="font-semibold">{alerts.length}</span>
              </div>
              <div className="flex justify-between items-center text-sm bg-background/70 rounded-md p-2 border">
                <span className="text-muted-foreground">{t('alerts.filteredAlerts')}</span>
                <span className="font-semibold">{visibleAlerts.length}</span>
              </div>
              <div className="flex justify-between items-center text-sm bg-background/70 rounded-md p-2 border">
                <span className="text-muted-foreground">{t('alerts.autoRefresh')}</span>
                <span className="font-semibold">{t('alerts.refreshInterval')}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Alerts;
