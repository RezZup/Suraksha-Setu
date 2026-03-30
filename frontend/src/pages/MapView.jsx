import React, { useState, useEffect } from 'react';
import { 
  Search,
  MapPin,
  Loader2,
  Wind,
  Activity,
  CloudRain,
  AlertCircle,
  Layers,
  Navigation
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

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
  const [error, setError] = useState(null);

  const [showLayers, setShowLayers] = useState({
    aqi: true,
    aqiHeatMap: false,
    rainfall: true,
    cyclone: true,
    disasterHeatmap: false,
  });

  const [allDisasters, setAllDisasters] = useState([]);

  const filteredAlerts = (alerts || []).filter((a) => {
    if (!searchRadius || !center) return true;
    const lat = a?.coordinates?.lat ?? a?.position?.lat;
    const lon = a?.coordinates?.lon ?? a?.coordinates?.lng ?? a?.position?.lon ?? a?.position?.lng;
    if (lat == null || lon == null) return false;
    return haversineKm(center[0], center[1], Number(lat), Number(lon)) <= radiusKm;
  });

  const filteredDisasters = (allDisasters || []).filter((d) => {
    if (!searchRadius || !center) return true;
    if (d?.lat == null || d?.lon == null) return false;
    return haversineKm(center[0], center[1], Number(d.lat), Number(d.lon)) <= radiusKm;
  });

  useEffect(() => {
    loadLocationData(center[0], center[1]);
    fetchAlerts();
    fetch(`${API_URL}/api/disasters`)
      .then(r => r.json())
      .then(data => setAllDisasters((data.disasters || []).filter(d => d.lat && d.lon)))
      .catch(() => {});
  }, []);

  const fetchAlerts = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/alerts`);
      const data = res.data?.alerts || res.data || [];
      setAlerts(Array.isArray(data) ? data : []);
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
          <Map2D
            center={center}
            aqiStations={aqiStations}
            cycloneTrack={cycloneTrack}
            rainfallData={rainfallMapData}
            showLayers={showLayers}
            searchRadius={searchRadius}
            alerts={alerts}
            alerts={filteredAlerts}
            disasters={filteredDisasters}
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
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <Label className="text-sm">Disaster Heatmap</Label>
                </div>
                <Switch 
                  checked={showLayers.disasterHeatmap}
                  onCheckedChange={(checked) => setShowLayers(prev => ({ ...prev, disasterHeatmap: checked }))}
                />
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
          {alerts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Active Alerts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {alerts.slice(0, 5).map((alert, i) => (
                  <div key={alert.id || i} className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
                    <AlertCircle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${alert.severity === 'critical' ? 'text-red-500' : 'text-yellow-500'}`} />
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