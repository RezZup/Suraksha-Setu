import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  MapPin,
  Loader2,
  Wind,
  Activity,
  CloudRain,
  AlertCircle,
  Layers,
  Navigation,
  Info,
  Hospital,
  Shield,
  Flame,
  Building2,
  Waves,
  Sun,
  Mountain,
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import Map2D from '@/components/maps/Map2D';
import {
  getWeatherByLocation,
  getAQIByLocation,
  getRainfallTrends,
  getRealtimeAQIStations,
  getCycloneTrack
} from '@/services/weatherApi';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import axios from 'axios';
import { useLocation as useAppLocation } from '@/contexts/LocationContext';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const ALERT_GEOCODE_BATCH_SIZE = 6;
const ALERT_GEOCODE_MAX_MISSING = 60;

const SERVICE_OPTIONS = [
  { id: 'hospital', label: 'Hospitals', icon: Hospital, accent: 'text-red-500' },
  { id: 'police', label: 'Police', icon: Shield, accent: 'text-blue-600' },
  { id: 'fire_station', label: 'Fire Stations', icon: Flame, accent: 'text-orange-500' },
  { id: 'disaster_management_center', label: 'Disaster Mgmt', icon: Building2, accent: 'text-violet-500' },
  { id: 'emergency_center', label: 'Emergency Centers', icon: AlertCircle, accent: 'text-sky-500' },
  { id: 'help_center', label: 'Help Centers', icon: MapPin, accent: 'text-emerald-500' },
];

const DISASTER_OPTIONS = [
  { id: 'heavy_rain', label: 'Heavy Rain', icon: CloudRain },
  { id: 'flood', label: 'Flood', icon: Waves },
  { id: 'tsunami', label: 'Tsunami', icon: Waves },
  { id: 'volcano', label: 'Volcano', icon: Mountain },
  { id: 'heatwave', label: 'Heatwave', icon: Sun },
  { id: 'fire', label: 'Fire', icon: Flame },
  { id: 'cyclone', label: 'Cyclone', icon: Wind },
  { id: 'earthquake', label: 'Earthquake', icon: Mountain },
  { id: 'landslide', label: 'Landslide', icon: Mountain },
  { id: 'drought', label: 'Drought', icon: Sun },
  { id: 'other', label: 'Other', icon: AlertCircle },
];

const ALERT_SEVERITY_OPTIONS = [
  { id: 'critical', label: 'Critical', accent: 'text-red-600' },
  { id: 'warning', label: 'Warning', accent: 'text-amber-600' },
  { id: 'info', label: 'Info', accent: 'text-blue-600' },
  { id: 'other', label: 'Other', accent: 'text-slate-600' },
];

const makeFilterState = (options) =>
  options.reduce((acc, option) => {
    acc[option.id] = true;
    return acc;
  }, {});

const normalizeAlertSeverity = (raw) => {
  const value = String(raw || '').toLowerCase();
  if (['critical', 'red', 'high', 'emergency'].includes(value)) return 'critical';
  if (['warning', 'orange', 'moderate'].includes(value)) return 'warning';
  if (['info', 'yellow', 'advisory', 'low'].includes(value)) return 'info';
  return 'other';
};

const toCoordPair = (latValue, lonValue) => {
  const lat = Number(latValue);
  const lon = Number(lonValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
};

const extractAlertCoordinates = (alert) => {
  const candidates = [
    toCoordPair(alert?.coordinates?.lat ?? alert?.coordinates?.latitude, alert?.coordinates?.lon ?? alert?.coordinates?.lng ?? alert?.coordinates?.longitude),
    toCoordPair(alert?.position?.lat ?? alert?.position?.latitude, alert?.position?.lon ?? alert?.position?.lng ?? alert?.position?.longitude),
    toCoordPair(alert?.location_data?.lat ?? alert?.location_data?.latitude, alert?.location_data?.lon ?? alert?.location_data?.lng ?? alert?.location_data?.longitude),
    toCoordPair(alert?.location?.lat ?? alert?.location?.latitude, alert?.location?.lon ?? alert?.location?.lng ?? alert?.location?.longitude),
    toCoordPair(alert?.lat ?? alert?.latitude, alert?.lon ?? alert?.lng ?? alert?.longitude),
  ];

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }

  if (typeof alert?.location === 'string') {
    const match = alert.location.match(/^\s*([\-\d.]+)\s*,\s*([\-\d.]+)\s*$/);
    if (match) {
      return toCoordPair(match[1], match[2]);
    }
  }

  return null;
};

const normalizeDisasterType = (item) => {
  const raw = [item?.type, item?.title, item?.description].filter(Boolean).join(' ').toLowerCase();
  if (raw.includes('heavy_rain') || raw.includes('heavy rain') || raw.includes('rainfall') || raw.includes('cloudburst') || raw.includes('monsoon')) return 'heavy_rain';
  if (raw.includes('flood') || raw.includes('inundation')) return 'flood';
  if (raw.includes('tsunami')) return 'tsunami';
  if (raw.includes('volcano') || raw.includes('volcanic')) return 'volcano';
  if (raw.includes('heatwave') || raw.includes('heat wave') || raw.includes('extreme heat')) return 'heatwave';
  if (raw.includes('wildfire') || raw.includes('forest fire') || raw.includes('fire')) return 'fire';
  if (raw.includes('cyclone') || raw.includes('hurricane') || raw.includes('typhoon') || raw.includes('storm')) return 'cyclone';
  if (raw.includes('earthquake') || raw.includes('seismic')) return 'earthquake';
  if (raw.includes('landslide')) return 'landslide';
  if (raw.includes('drought')) return 'drought';
  return 'other';
};

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const MapView = () => {
  const {
    location: appLocation,
    gpsPincode,
    homePincode,
    detectLocation: detectAppLocation,
  } = useAppLocation();
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [center, setCenter] = useState([20.5937, 78.9629]); // India center
  const [searchRadius, setSearchRadius] = useState(null);
  const [radiusKm, setRadiusKm] = useState(10);
  const [locationLabel, setLocationLabel] = useState('');
  const [weatherData, setWeatherData] = useState(null);
  const [aqiData, setAQIData] = useState(null);
  const [aqiStations, setAQIStations] = useState([]);
  const [rainfallData, setRainfallData] = useState(null);
  const [cycloneTrack, setCycloneTrack] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [allDisasters, setAllDisasters] = useState([]);
  const [emergencyServices, setEmergencyServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [serviceSource, setServiceSource] = useState('');
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [serviceFilters, setServiceFilters] = useState(() => makeFilterState(SERVICE_OPTIONS));
  const [disasterFilters, setDisasterFilters] = useState(() => makeFilterState(DISASTER_OPTIONS));
  const [alertFilters, setAlertFilters] = useState(() => makeFilterState(ALERT_SEVERITY_OPTIONS));
  const [unmappedAlertsCount, setUnmappedAlertsCount] = useState(0);
  const [error, setError] = useState(null);
  const geocodeCacheRef = useRef(new Map());
  const didBootstrapLocationRef = useRef(false);
  const defaultLoadStartedRef = useRef(false);

  const [showLayers, setShowLayers] = useState({
    aqi: true,
    aqiHeatMap: false,
    rainfall: true,
    cyclone: true,
    emergencyServices: true,
    disasterMarkers: true,
    disasterHeatmap: false,
  });

  const filteredAlerts = (alerts || []).filter((a) => {
    const severity = a?.normalizedSeverity || normalizeAlertSeverity(a?.severity);
    if (!alertFilters[severity]) return false;

    const coords = a?.position || extractAlertCoordinates(a);
    if (!coords) return false;

    if (!searchRadius || !center) return true;
    return haversineKm(center[0], center[1], Number(coords.lat), Number(coords.lon)) <= radiusKm;
  });

  const filteredDisasters = (allDisasters || []).filter((d) => {
    if (!showLayers.disasterMarkers) return false;
    const category = d?.normalizedType || normalizeDisasterType(d);
    if (!disasterFilters[category]) return false;
    if (!searchRadius || !center) return true;
    if (d?.lat == null || d?.lon == null) return false;
    return haversineKm(center[0], center[1], Number(d.lat), Number(d.lon)) <= radiusKm;
  });

  const filteredEmergencyServices = (emergencyServices || []).filter((s) => {
    if (!showLayers.emergencyServices) return false;
    return !!serviceFilters[s?.service_type || 'help_center'];
  });

  const serviceCountByType = useMemo(() => {
    const counts = {};
    for (const option of SERVICE_OPTIONS) counts[option.id] = 0;
    for (const service of emergencyServices) {
      const key = service?.service_type || 'help_center';
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [emergencyServices]);

  const disasterCountByType = useMemo(() => {
    const counts = {};
    for (const option of DISASTER_OPTIONS) counts[option.id] = 0;
    for (const disaster of allDisasters) {
      const key = disaster?.normalizedType || 'other';
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [allDisasters]);

  const alertCountBySeverity = useMemo(() => {
    const counts = {};
    for (const option of ALERT_SEVERITY_OPTIONS) counts[option.id] = 0;
    for (const alert of alerts) {
      const key = alert?.normalizedSeverity || normalizeAlertSeverity(alert?.severity);
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [alerts]);

  const prioritizedAlerts = useMemo(() => {
    const rank = { critical: 0, warning: 1, info: 2, other: 3 };
    return [...filteredAlerts].sort((a, b) => {
      const aRank = rank[a?.normalizedSeverity || normalizeAlertSeverity(a?.severity)] ?? 99;
      const bRank = rank[b?.normalizedSeverity || normalizeAlertSeverity(b?.severity)] ?? 99;
      if (aRank !== bRank) return aRank - bRank;
      return String(b?.created_at || '').localeCompare(String(a?.created_at || ''));
    });
  }, [filteredAlerts]);

  useEffect(() => {
    let cancelled = false;

    const fetchAllDisasterPoints = async () => {
      try {
        const response = await fetch(`${API_URL}/api/disasters?all_points=true&limit=5000`);
        const data = await response.json();
        const rows = (data.disasters || [])
          .filter((d) => d?.lat != null && d?.lon != null)
          .map((d) => ({ ...d, normalizedType: normalizeDisasterType(d) }));
        if (!cancelled) {
          setAllDisasters(rows);
        }
      } catch {
        if (!cancelled) {
          setAllDisasters([]);
        }
      }
    };

    fetchAlerts();
    fetchAllDisasterPoints();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrapFromCurrentLocation = async () => {
      if (didBootstrapLocationRef.current) return;

      const lat = Number(appLocation?.latitude ?? appLocation?.lat);
      const lon = Number(appLocation?.longitude ?? appLocation?.lon);
      const preferredPincode = String(
        gpsPincode ||
        appLocation?.gps_pincode ||
        homePincode ||
        appLocation?.pin_code ||
        ''
      ).trim();

      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        if (cancelled) return;
        didBootstrapLocationRef.current = true;
        setCenter([lat, lon]);
        setSearchRadius(radiusKm * 1000);
        setLocationLabel(preferredPincode ? `PIN ${preferredPincode}` : (appLocation?.city || 'My Location'));
        if (preferredPincode) setSearchQuery(preferredPincode);
        await loadLocationData(lat, lon);
        return;
      }

      if (preferredPincode) {
        if (cancelled) return;
        setSearchQuery(preferredPincode);
        try {
          const geoRes = await axios.post(`${API_URL}/api/location/search`, { query: preferredPincode });
          const geoData = geoRes.data;
          if (geoData?.success && geoData?.lat && geoData?.lon) {
            if (cancelled) return;
            didBootstrapLocationRef.current = true;
            setCenter([geoData.lat, geoData.lon]);
            setSearchRadius(radiusKm * 1000);
            setLocationLabel(`PIN ${preferredPincode}`);
            await loadLocationData(geoData.lat, geoData.lon);
            return;
          }
        } catch {
          // Fall back to default center when PIN geocode fails.
        }
      }

      if (!defaultLoadStartedRef.current) {
        defaultLoadStartedRef.current = true;
        await loadLocationData(center[0], center[1]);
      }

      if (!appLocation) {
        detectAppLocation({ background: true });
      }
    };

    bootstrapFromCurrentLocation();

    return () => {
      cancelled = true;
    };
  }, [appLocation, gpsPincode, homePincode, radiusKm, detectAppLocation]);

  useEffect(() => {
    let isStale = false;

    const fetchNearbyServices = async () => {
      try {
        setServicesLoading(true);
        const categories = SERVICE_OPTIONS.map(option => option.id).join(',');
        const res = await axios.get(`${API_URL}/api/location/nearby-services`, {
          params: {
            lat: center[0],
            lon: center[1],
            radius_km: radiusKm,
            categories,
          },
        });
        if (isStale) return;
        const rows = Array.isArray(res.data?.services) ? res.data.services : [];
        setEmergencyServices(rows);
        setServiceSource(res.data?.source || '');
      } catch (err) {
        if (!isStale) {
          setEmergencyServices([]);
          setServiceSource('');
        }
      } finally {
        if (!isStale) setServicesLoading(false);
      }
    };

    if (Number.isFinite(center?.[0]) && Number.isFinite(center?.[1])) {
      fetchNearbyServices();
    }

    return () => {
      isStale = true;
    };
  }, [center, radiusKm]);

  const fetchAlerts = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/alerts`, {
        params: { limit: 5000 },
      });
      const data = res.data?.alerts || res.data || [];
      const rows = Array.isArray(data) ? data : [];

      const geocodeLocationText = async (text) => {
        const key = String(text || '').trim().toLowerCase();
        if (!key || key.length < 3) return null;

        if (geocodeCacheRef.current.has(key)) {
          return geocodeCacheRef.current.get(key);
        }

        try {
          const geoRes = await axios.post(`${API_URL}/api/location/search`, { query: key });
          const geoData = geoRes.data;
          const pair = toCoordPair(geoData?.lat, geoData?.lon);
          geocodeCacheRef.current.set(key, pair);
          return pair;
        } catch {
          geocodeCacheRef.current.set(key, null);
          return null;
        }
      };

      const normalized = await Promise.all(
        rows.map(async (alert, index) => {
          const coords = extractAlertCoordinates(alert);
          const normalizedSeverity = normalizeAlertSeverity(alert?.severity);

          return {
            ...alert,
            __mapKey: `${alert?.id || 'alert'}_${index}`,
            normalizedSeverity,
            position: coords ? { lat: coords.lat, lon: coords.lon } : null,
            coordinates: coords
              ? { lat: coords.lat, lon: coords.lon }
              : alert?.coordinates,
          };
        })
      );

      setAlerts(normalized);
      setUnmappedAlertsCount(normalized.filter((a) => !a.position).length);

      // Geocode some missing-location alerts in small batches so map becomes interactive quickly.
      const pendingGeocode = normalized
        .filter((a) => !a.position && typeof a?.location === 'string')
        .slice(0, ALERT_GEOCODE_MAX_MISSING);

      for (let i = 0; i < pendingGeocode.length; i += ALERT_GEOCODE_BATCH_SIZE) {
        const batch = pendingGeocode.slice(i, i + ALERT_GEOCODE_BATCH_SIZE);
        const resolvedBatch = await Promise.all(
          batch.map(async (alert) => {
            const coords = await geocodeLocationText(alert.location);
            if (!coords) return null;
            return {
              ...alert,
              position: { lat: coords.lat, lon: coords.lon },
              coordinates: { lat: coords.lat, lon: coords.lon },
            };
          })
        );

        const updates = new Map(
          resolvedBatch
            .filter(Boolean)
            .map((item) => [item.__mapKey, item])
        );

        if (updates.size > 0) {
          setAlerts((prev) => prev.map((item) => updates.get(item.__mapKey) || item));
          setUnmappedAlertsCount((prev) => Math.max(0, prev - updates.size));
        }
      }
    } catch (e) {
      console.error('Failed to fetch alerts:', e);
    }
  };

  const loadLocationData = async (lat, lon) => {
    setLoading(true);
    setError(null);
    try {
      const [weather, aqi, rainfall, stations, cyclone] = await Promise.allSettled([
        getWeatherByLocation({ lat, lon }),
        getAQIByLocation({ lat, lon }),
        getRainfallTrends(lat, lon),
        getRealtimeAQIStations(lat, lon),
        getCycloneTrack()
      ]);

      if (weather.status === 'fulfilled') setWeatherData(weather.value);
      if (aqi.status === 'fulfilled') setAQIData(aqi.value);
      if (rainfall.status === 'fulfilled') setRainfallData(rainfall.value);
      if (stations.status === 'fulfilled') setAQIStations(stations.value);
      if (cyclone.status === 'fulfilled' && cyclone.value) setCycloneTrack(cyclone.value);
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Failed to load some data');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    setLoading(true);
    setError(null);
    setSearchRadius(null);

    try {
      // Geocode by pincode/address/city using backend location search endpoint
      const geoRes = await axios.post(`${API_URL}/api/location/search`, { query });
      const geoData = geoRes.data;
      if (geoData?.success && geoData?.lat && geoData?.lon) {
        setCenter([geoData.lat, geoData.lon]);
        setSearchRadius(radiusKm * 1000);
        setLocationLabel(geoData.display_name || query);
        await loadLocationData(geoData.lat, geoData.lon);
        return;
      }

      // Coordinates (lat, lon)
      const coordMatch = query.match(/^([\-\d.]+),\s*([\-\d.]+)$/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lon = parseFloat(coordMatch[2]);
        setCenter([lat, lon]);
        setSearchRadius(radiusKm * 1000);
        setLocationLabel(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
        await loadLocationData(lat, lon);
        return;
      }

      setError('Location not found');
    } catch (err) {
      console.error('Search error:', err);
      setError('Location not found. Try PIN code, city name, or coordinates (lat, lon)');
    } finally {
      setLoading(false);
    }
  };

  const handleMyLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported by your browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setCenter([lat, lon]);
        setSearchRadius(radiusKm * 1000);
        setLocationLabel('My Location');
        await loadLocationData(lat, lon);
      },
      () => setError('Unable to get your location')
    );
  };

  const handleMapMoved = (nextCenter) => {
    if (!Array.isArray(nextCenter) || nextCenter.length < 2) return;
    const nextLat = Number(nextCenter[0]);
    const nextLon = Number(nextCenter[1]);
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLon)) return;

    const latDelta = Math.abs(nextLat - center[0]);
    const lonDelta = Math.abs(nextLon - center[1]);
    if (latDelta < 0.001 && lonDelta < 0.001) return;

    setCenter([Number(nextLat.toFixed(6)), Number(nextLon.toFixed(6))]);
    setSearchRadius(radiusKm * 1000);
    setLocationLabel('Map Center');
  };

  const rainfallChartData = rainfallData?.daily_trends?.slice(0, 7).map(day => ({
    date: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    rainfall: day.rainfall,
  })) || [];

  const rainfallMapData = rainfallData?.daily_trends?.slice(0, 5).map((day) => ({
    lat: center[0] + (Math.random() - 0.5) * 0.5,
    lon: center[1] + (Math.random() - 0.5) * 0.5,
    intensity: day.probability,
    amount: day.rainfall,
  })) || [];

  return (
    <div className="h-screen flex flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Live Map</h1>
          <p className="text-muted-foreground">Search by PIN code, address, city, or coordinates — shows results within selected radius</p>
        </div>
        {searchRadius && locationLabel && (
          <Badge variant="outline" className="gap-1 text-sm px-3 py-1">
            <MapPin className="w-3.5 h-3.5" />
            {locationLabel} · {radiusKm} km radius
          </Badge>
        )}
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="flex-1">
              <Input
                placeholder="Enter PIN code (e.g. 110001), city name, or coordinates (lat, lon)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span className="ml-2">Search</span>
            </Button>
            <Button type="button" variant="outline" onClick={handleMyLocation} disabled={loading} title="Use my location">
              <Navigation className="w-4 h-4" />
            </Button>
          </form>
          <div className="mt-3 flex items-center gap-2">
            <Label htmlFor="radius-km" className="text-sm whitespace-nowrap">Range</Label>
            <Input
              id="radius-km"
              type="number"
              min={1}
              max={500}
              value={radiusKm}
              onChange={(e) => {
                const next = Math.max(1, Math.min(500, Number(e.target.value) || 10));
                setRadiusKm(next);
                if (searchRadius) setSearchRadius(next * 1000);
              }}
              className="w-28"
            />
            <span className="text-sm text-muted-foreground">km</span>
          </div>
          {error && (
            <div className="mt-2 flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0">
        {/* Map */}
        <div className="lg:col-span-3 relative rounded-lg overflow-hidden border border-border bg-muted/30">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-50">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          )}

          <div className="absolute top-3 right-3 z-[900] flex flex-col items-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="gap-2 shadow-md"
              onClick={() => setShowInfoPanel((prev) => !prev)}
            >
              <Info className="w-4 h-4" />
              Map Info
            </Button>

            {showInfoPanel && (
              <Card className="w-[300px] max-h-[420px] overflow-y-auto shadow-xl border border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Map Filters</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Emergency Services</Label>
                      <Badge variant="outline">{filteredEmergencyServices.length}</Badge>
                    </div>
                    {SERVICE_OPTIONS.map((option) => {
                      const Icon = option.icon;
                      return (
                        <label key={option.id} className="flex items-center justify-between gap-2 text-sm cursor-pointer">
                          <div className="flex items-center gap-2 min-w-0">
                            <Checkbox
                              checked={!!serviceFilters[option.id]}
                              onCheckedChange={(checked) => setServiceFilters((prev) => ({ ...prev, [option.id]: Boolean(checked) }))}
                            />
                            <Icon className={`w-4 h-4 ${option.accent}`} />
                            <span className="truncate">{option.label}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">{serviceCountByType[option.id] || 0}</span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Disaster Types</Label>
                      <Badge variant="outline">{filteredDisasters.length}</Badge>
                    </div>
                    {DISASTER_OPTIONS.map((option) => {
                      const Icon = option.icon;
                      return (
                        <label key={option.id} className="flex items-center justify-between gap-2 text-sm cursor-pointer">
                          <div className="flex items-center gap-2 min-w-0">
                            <Checkbox
                              checked={!!disasterFilters[option.id]}
                              onCheckedChange={(checked) => setDisasterFilters((prev) => ({ ...prev, [option.id]: Boolean(checked) }))}
                            />
                            <Icon className="w-4 h-4 text-muted-foreground" />
                            <span className="truncate">{option.label}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">{disasterCountByType[option.id] || 0}</span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Showing resources inside {radiusKm} km from the selected location.
                    {serviceSource ? ` Source: ${serviceSource}.` : ''}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <Map2D
            center={center}
            aqiStations={aqiStations}
            cycloneTrack={cycloneTrack}
            rainfallData={rainfallMapData}
            showLayers={showLayers}
            searchRadius={searchRadius}
            alerts={filteredAlerts}
            disasters={filteredDisasters}
            emergencyServices={filteredEmergencyServices}
            onMapMoved={handleMapMoved}
          />
        </div>

        {/* Side Panel */}
        <div className="lg:col-span-1 space-y-4 overflow-y-auto">
          {/* Layer Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Layers className="w-5 h-5" />
                Layers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-yellow-500" />
                  <Label className="text-sm">AQI Stations</Label>
                </div>
                <Switch 
                  checked={showLayers.aqi}
                  onCheckedChange={(checked) => setShowLayers(prev => ({ ...prev, aqi: checked }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-purple-500" />
                  <Label className="text-sm">AQI Heat Map</Label>
                </div>
                <Switch 
                  checked={showLayers.aqiHeatMap}
                  onCheckedChange={(checked) => setShowLayers(prev => ({ ...prev, aqiHeatMap: checked }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CloudRain className="w-4 h-4 text-blue-500" />
                  <Label className="text-sm">Rainfall Zones</Label>
                </div>
                <Switch 
                  checked={showLayers.rainfall}
                  onCheckedChange={(checked) => setShowLayers(prev => ({ ...prev, rainfall: checked }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wind className="w-4 h-4 text-red-500" />
                  <Label className="text-sm">Cyclone Path</Label>
                </div>
                <Switch 
                  checked={showLayers.cyclone}
                  onCheckedChange={(checked) => setShowLayers(prev => ({ ...prev, cyclone: checked }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Hospital className="w-4 h-4 text-red-500" />
                  <Label className="text-sm">Emergency Services</Label>
                </div>
                <Switch
                  checked={showLayers.emergencyServices}
                  onCheckedChange={(checked) => setShowLayers(prev => ({ ...prev, emergencyServices: checked }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  <Label className="text-sm">Disaster Markers</Label>
                </div>
                <Switch
                  checked={showLayers.disasterMarkers}
                  onCheckedChange={(checked) => setShowLayers(prev => ({ ...prev, disasterMarkers: checked }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <Label className="text-sm">Disaster Heatmap</Label>
                </div>
                <Switch 
                  checked={showLayers.disasterHeatmap}
                  onCheckedChange={(checked) => setShowLayers(prev => ({ ...prev, disasterHeatmap: checked }))}
                />
              </div>
              <div className="text-xs text-muted-foreground pt-2 border-t border-border/60">
                Nearby services: {servicesLoading ? 'loading...' : filteredEmergencyServices.length}
              </div>
            </CardContent>
          </Card>

          {/* Alert Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-500" />
                Alert Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {ALERT_SEVERITY_OPTIONS.map((option) => (
                <label key={option.id} className="flex items-center justify-between gap-2 text-sm cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={!!alertFilters[option.id]}
                      onCheckedChange={(checked) => setAlertFilters((prev) => ({ ...prev, [option.id]: Boolean(checked) }))}
                    />
                    <span className={option.accent}>{option.label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{alertCountBySeverity[option.id] || 0}</span>
                </label>
              ))}
              <div className="text-xs text-muted-foreground pt-2 border-t border-border/60">
                Pinned alerts: {filteredAlerts.length} / {alerts.length}
              </div>
              <div className="text-xs text-muted-foreground">
                Alerts without map location: {unmappedAlertsCount}
              </div>
            </CardContent>
          </Card>

          {/* Weather Info */}
          {weatherData && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Current Weather</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-3xl font-bold">{weatherData.current?.temperature}°C</div>
                <div className="text-muted-foreground">{weatherData.current?.condition}</div>
                <div className="grid grid-cols-2 gap-2 text-sm mt-4">
                  <div>
                    <div className="text-muted-foreground">Humidity</div>
                    <div className="font-medium">{weatherData.current?.humidity}%</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Wind</div>
                    <div className="font-medium">{weatherData.current?.wind_speed} km/h</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* AQI Info */}
          {aqiData && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Air Quality</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-3xl font-bold">{aqiData.current?.aqi}</div>
                  <Badge 
                    variant="secondary" 
                    style={{ backgroundColor: aqiData.current?.color }}
                    className="text-white"
                  >
                    {aqiData.current?.category}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">Primary: {aqiData.current?.primary_pollutant}</div>
              </CardContent>
            </Card>
          )}

          {/* Rainfall Chart */}
          {rainfallChartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">7-Day Rainfall</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={rainfallChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="rainfall" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Alerts List */}
          {filteredAlerts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Active Alerts in View</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {prioritizedAlerts.slice(0, 6).map((alert, i) => (
                  <div key={alert.id || i} className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
                    <AlertCircle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${alert.normalizedSeverity === 'critical' ? 'text-red-500' : alert.normalizedSeverity === 'warning' ? 'text-yellow-500' : 'text-blue-500'}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{alert.title || alert.type}</p>
                      <p className="text-xs text-muted-foreground truncate">{alert.location || alert.description}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default MapView;