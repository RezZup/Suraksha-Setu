import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  AlertTriangle, 
  Wind, 
  Droplets, 
  Thermometer, 
  Info, 
  CheckCircle2, 
  XCircle,
  Filter,
  MapPin,
  Share2,
  Volume2,
  Loader
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from '@/hooks/use-toast';
import { cachedFetchJson } from '@/utils/requestCache';
import { useAuth } from '@/contexts/AuthContext';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

const AlertCard = ({ alert, onFeedback }) => {
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

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`relative border-l-4 rounded-r-lg p-4 mb-4 bg-card shadow-sm hover:shadow-md transition-all ${getSeverityColor(alert.severity)}`}
    >
      <div className="flex justify-between items-start">
        <div className="flex gap-3">
          <div className={`p-2 rounded-full ${
            alert.severity === 'critical' ? 'bg-destructive/10 text-destructive' : 
            alert.severity === 'high' ? 'bg-orange-500/10 text-orange-500' : 
            'bg-blue-500/10 text-blue-500'
          }`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-foreground">{alert.title}</h4>
              {alert.severity === 'critical' && (
                <span className="animate-pulse px-2 py-0.5 rounded text-[10px] font-bold bg-destructive text-destructive-foreground">
                  LIVE
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {alert.location}
              </span>
              <span>{alert.time}</span>
              <span className="font-medium text-foreground">Impact: {alert.impact}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {typeof alert.trustScore === 'number' ? (
                <Badge variant="outline" className="text-xs">
                  Trust Score: {Math.round(alert.trustScore)}%
                </Badge>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => onFeedback(alert.id, 'accurate')}>
                Accurate
              </Button>
              <Button size="sm" variant="outline" onClick={() => onFeedback(alert.id, 'false_alarm')}>
                False Alarm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onFeedback(alert.id, 'outdated')}>
                Outdated
              </Button>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8">
            <Share2 className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8">
            <Volume2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

const Alerts = () => {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [filteredAlerts, setFilteredAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  
  // Filter states
  const [selectedSeverity, setSelectedSeverity] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedRegion, setSelectedRegion] = useState('all');
  
  const { toast } = useToast();

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
        title: 'Feedback submitted',
        description: 'Thanks for helping improve alert quality.',
      });
    } catch (err) {
      toast({
        title: 'Could not submit feedback',
        description: err?.message || 'Please try again in a moment.',
        variant: 'destructive',
      });
    }
  };

  // Fetch alerts data
  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        
        // Apply filters to API request
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
        
        // Format data for display
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
            : 'Recently',
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
    };

    fetchAlerts();
    
    // Refresh alerts every 2 minutes
    const interval = setInterval(fetchAlerts, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [selectedSeverity, selectedType]);

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

  const resetFilters = () => {
    setSelectedSeverity('all');
    setSelectedType('all');
    setSelectedRegion('all');
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
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Alerts Center</h1>
          <p className="text-muted-foreground">Real-time emergency notifications and AI-driven insights.</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            className="gap-2"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="w-4 h-4" /> Filters
          </Button>
          <Button variant="destructive" className="gap-2">
            <AlertTriangle className="w-4 h-4" /> Report
          </Button>
        </div>
      </div>

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
              <label className="text-sm font-medium block mb-2">Severity</label>
              <select 
                value={selectedSeverity}
                onChange={(e) => setSelectedSeverity(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background text-foreground text-sm"
              >
                <option value="all">All Levels</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="moderate">Moderate</option>
                <option value="low">Low</option>
              </select>
            </div>

            {/* Alert Type Filter */}
            <div>
              <label className="text-sm font-medium block mb-2">Alert Type</label>
              <select 
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background text-foreground text-sm"
              >
                <option value="all">All Types</option>
                {alertTypes.map(type => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>

            {/* Region Filter */}
            <div>
              <label className="text-sm font-medium block mb-2">Region</label>
              <select 
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background text-foreground text-sm"
              >
                <option value="all">All Regions</option>
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
            Reset Filters
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
          ) : filteredAlerts.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>No alerts match your filters.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Showing {filteredAlerts.length} of {alerts.length} alerts
              </p>
              {filteredAlerts.map(alert => (
                <AlertCard key={alert.id} alert={alert} onFeedback={submitFeedback} />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar Stats & Info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Alert Severity Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-destructive font-medium">Critical</span>
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
                    <span className="text-orange-500 font-medium">High</span>
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
                    <span className="text-yellow-500 font-medium">Moderate</span>
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
                    <span className="text-blue-500 font-medium">Low</span>
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
                Feed Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center text-sm bg-background/70 rounded-md p-2 border">
                <span className="text-muted-foreground">Total Alerts</span>
                <span className="font-semibold">{alerts.length}</span>
              </div>
              <div className="flex justify-between items-center text-sm bg-background/70 rounded-md p-2 border">
                <span className="text-muted-foreground">Filtered Alerts</span>
                <span className="font-semibold">{filteredAlerts.length}</span>
              </div>
              <div className="flex justify-between items-center text-sm bg-background/70 rounded-md p-2 border">
                <span className="text-muted-foreground">Auto Refresh</span>
                <span className="font-semibold">2 min</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Alerts;
