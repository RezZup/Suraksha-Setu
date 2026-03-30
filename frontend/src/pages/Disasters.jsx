import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
import { 
  Wind, 
  Droplets, 
  Activity, 
  Sun, 
  AlertTriangle, 
  MapPin, 
  Shield, 
  Navigation,
  Waves,
  MapPinOff,
  RefreshCw,
  Clock,
  Download,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from '@/hooks/use-toast';
import { cachedFetchJson } from '@/utils/requestCache';
import DataSectionLoader from '@/components/ui/DataSectionLoader';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

const SEVERITY_COLOR = {
  extreme: 'bg-red-500',
  high: 'bg-orange-500',
  moderate: 'bg-yellow-500',
  low: 'bg-green-500',
};

// Helper function to calculate distance between two coordinates using Haversine formula
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
};

// Fallback coordinates for locations without lat/lon
const LOCATION_COORDS = {
  'Odisha Coast': { lat: 19.8135, lon: 85.7595 },
  'Cuttack': { lat: 20.4625, lon: 85.8830 },
  'Bhubaneswar': { lat: 20.2961, lon: 85.8245 },
  'Kerala': { lat: 10.8505, lon: 76.2711 },
  'Mumbai': { lat: 19.0760, lon: 72.8777 },
  'Bangalore': { lat: 12.9716, lon: 77.5946 },
  'Chennai': { lat: 13.0827, lon: 80.2707 },
  'Kolkata': { lat: 22.5726, lon: 88.3639 },
  'Delhi': { lat: 28.7041, lon: 77.1025 },
  'Gujarat': { lat: 22.2587, lon: 71.1924 },
  'India': { lat: 20.5937, lon: 78.9629 },
};

const getDisasterCoords = (disaster) => {
  if (disaster.lat != null && disaster.lon != null) return { lat: disaster.lat, lon: disaster.lon };
  for (const [key, coords] of Object.entries(LOCATION_COORDS)) {
    if (disaster.location && disaster.location.includes(key)) return coords;
  }
  return LOCATION_COORDS['India'];
};

const NearbyDisastersView = () => {
  const [userLocation, setUserLocation] = useState(null);
  const [nearbyDisasters, setNearbyDisasters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { toast } = useToast();
  const { userLocation: cachedLocation, detectLocation } = useAuth();

  useEffect(() => {
    fetchNearbyDisasters();
  }, []);

  const fetchDisastersForCoords = useCallback(async (latitude, longitude) => {
    const data = await cachedFetchJson(`${API_URL}/api/disasters`, { ttlMs: 60 * 1000 });
    const disasters = data.disasters || [];
    return disasters
      .map(disaster => {
        const coords = getDisasterCoords(disaster);
        return { ...disaster, distance: calculateDistance(latitude, longitude, coords.lat, coords.lon) };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 10);
  }, []);

  const fetchNearbyDisasters = async () => {
    try {
      setLoading(true);
      setError(null);

      // Use already-known location from AuthContext to avoid re-prompting
      if (cachedLocation?.lat && cachedLocation?.lon) {
        setUserLocation(cachedLocation);
        const results = await fetchDisastersForCoords(cachedLocation.lat, cachedLocation.lon);
        setNearbyDisasters(results);
        return;
      }

      // No cached location — try browser geolocation
      if (!navigator.geolocation) {
        setError('Geolocation not supported. Using default location.');
        loadDefaultLocation();
        return;
      }

      await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            const loc = { lat: latitude, lon: longitude };
            setUserLocation(loc);
            try {
              const results = await fetchDisastersForCoords(latitude, longitude);
              setNearbyDisasters(results);
            } catch (err) {
              console.error('Error fetching disasters:', err);
              setError('Failed to load nearby disasters.');
            }
            resolve();
          },
          async (err) => {
            console.error('Geolocation error:', err);
            // Try via detectLocation (AuthContext retries with IP fallback)
            try {
              const loc = await detectLocation();
              if (loc?.lat && loc?.lon) {
                setUserLocation(loc);
                const results = await fetchDisastersForCoords(loc.lat, loc.lon);
                setNearbyDisasters(results);
                resolve();
                return;
              }
            } catch (_) {}
            setError('Location unavailable. Showing disasters near Delhi.');
            loadDefaultLocation();
            resolve();
          },
          { timeout: 8000, maximumAge: 300000 }
        );
      });
    } catch (err) {
      console.error('Error in fetchNearbyDisasters:', err);
      setError('An error occurred while fetching nearby disasters.');
    } finally {
      setLoading(false);
    }
  };

  const loadDefaultLocation = async () => {
    try {
      setUserLocation({ lat: 28.7041, lon: 77.1025, city: 'Delhi' }); // Delhi default
      const data = await cachedFetchJson(`${API_URL}/api/disasters`, { ttlMs: 60 * 1000 });
      const disasters = (data.disasters || [])
        .map(disaster => {
          const coords = getDisasterCoords(disaster);
          const distance = calculateDistance(28.7041, 77.1025, coords.lat, coords.lon);
          return { ...disaster, distance };
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 10);
      setNearbyDisasters(disasters);
    } catch (err) {
      console.error('Error loading default location:', err);
    }
  };

  if (loading) {
    return (
      <DataSectionLoader
        variant="nearby"
        title="Finding nearby hazards"
        subtitle="Fetching your location and matching active events"
      />
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <Card className="border-orange-500/50 bg-orange-500/5">
          <CardContent className="pt-6">
            <p className="text-sm text-orange-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {userLocation && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Navigation className="w-5 h-5" />
              Your Location
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              <p>Latitude: {userLocation.lat?.toFixed(4)}, Longitude: {userLocation.lon?.toFixed(4)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <h3 className="text-lg font-semibold mb-4">Nearest Disasters to Your Location</h3>
        <div className="space-y-3">
          {nearbyDisasters.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center">
                <MapPinOff className="w-12 h-12 mx-auto text-muted-foreground mb-2 opacity-50" />
                <p className="text-muted-foreground">No nearby disasters found.</p>
              </CardContent>
            </Card>
          ) : (
            nearbyDisasters.map((disaster, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-semibold">{disaster.title || disaster.disaster_type}</h4>
                        <p className="text-sm text-muted-foreground">{disaster.location}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-white text-xs ${SEVERITY_COLOR[disaster.severity] || 'bg-gray-500'}`}>
                          {disaster.severity || 'unknown'}
                        </Badge>
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <Navigation className="w-3 h-3" />
                          {disaster.distance} km from you
                        </Badge>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">{disaster.description}</p>
                    <div className="flex items-center gap-4 text-xs flex-wrap">
                      <span className="text-muted-foreground">{disaster.date || new Date().toLocaleDateString()}</span>
                      {disaster.source && (
                        <Badge variant="outline" className="text-[10px]">{disaster.source}</Badge>
                      )}
                      {disaster.casualties != null && (
                        <span className="font-medium text-destructive">Casualties: {disaster.casualties}</span>
                      )}
                      {disaster.magnitude != null && (
                        <span className="font-medium">M{disaster.magnitude.toFixed(1)}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))
          )}
        </div>
      </div>

      <Button 
        variant="outline" 
        className="w-full"
        onClick={fetchNearbyDisasters}
      >
        <Navigation className="w-4 h-4 mr-2" />
        Refresh Location & Nearby Disasters
      </Button>
    </div>
  );
};

const DisasterCard = ({ title, value, subtext, icon: Icon, color }) => (
  <Card>
    <CardContent className="p-6 flex items-center gap-4">
      <div className={`p-3 rounded-full ${color} bg-opacity-10`}>
        <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{title}</p>
        <h4 className="text-2xl font-bold">{value}</h4>
        <p className="text-xs text-muted-foreground">{subtext}</p>
      </div>
    </CardContent>
  </Card>
);

const CycloneView = () => {
  const [cyclones, setCyclones] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cachedFetchJson(`${API_URL}/api/disasters?disaster_type=cyclone`, { ttlMs: 60 * 1000 })
      .then(data => { setCyclones(data.disasters || []); })
      .catch(e => console.error('Cyclone fetch error:', e))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <DataSectionLoader
      variant="timeline"
      title="Loading cyclone feed"
      subtitle="Collecting live cyclone tracks and history"
    />
  );

  const active = cyclones.filter(c => c.status === 'active');
  const historical = cyclones.filter(c => c.status !== 'active');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DisasterCard
          title="Active Cyclones"
          value={active.length}
          subtext={active.length ? 'Live GDACS tracking' : 'No active cyclones'}
          icon={Wind}
          color="bg-indigo-500"
        />
        <DisasterCard
          title="Recent Events"
          value={historical.length}
          subtext="Last 30 days (historical)"
          icon={Activity}
          color="bg-blue-500"
        />
        <DisasterCard
          title="Alert Level"
          value={active.length ? (active[0].severity?.toUpperCase() || 'ACTIVE') : 'NONE'}
          subtext={active.length ? active[0].title : 'All clear'}
          icon={AlertTriangle}
          color={active.length ? 'bg-destructive' : 'bg-green-500'}
        />
      </div>

      {active.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center py-16">
            <Wind className="w-14 h-14 mx-auto text-muted-foreground opacity-30 mb-4" />
            <p className="text-lg font-semibold">No Active Cyclones</p>
            <p className="text-sm text-muted-foreground mt-1">
              No live cyclone alerts in South Asia at this time. Data sourced from GDACS.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {active.map((c, i) => (
            <Card key={c.id || i} className="border-orange-500/30 bg-orange-500/5">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-semibold">{c.title}</h4>
                    <p className="text-sm text-muted-foreground">{c.location}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-white ${SEVERITY_COLOR[c.severity] || 'bg-gray-500'}`}>
                      {c.severity}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{c.source}</Badge>
                  </div>
                </div>
                <p className="text-sm">{c.description}</p>
                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
                  <span>{c.date}</span>
                  {c.casualties != null && (
                    <span className="text-destructive font-medium">Deaths: {c.casualties}</span>
                  )}
                  {c.affected_population != null && (
                    <span>Affected: {c.affected_population.toLocaleString()}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {historical.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Cyclone History</CardTitle>
            <CardDescription>Past events from historical records</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {historical.slice(0, 6).map((c, i) => (
              <div key={c.id || i} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium text-sm">{c.title}</p>
                  <p className="text-xs text-muted-foreground">{c.location} · {c.date}</p>
                </div>
                <div className="flex items-center gap-2">
                  {c.casualties != null && (
                    <span className="text-xs text-destructive">Deaths: {c.casualties}</span>
                  )}
                  <Badge className={`text-white text-xs ${SEVERITY_COLOR[c.severity] || 'bg-gray-500'}`}>
                    {c.severity}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground text-right">
        Live data: GDACS Global Disaster Alert · Historical: IMD/NOAA records
      </p>
    </div>
  );
};

const FloodView = () => {
  const [floods, setFloods] = useState([]);
  const [rainfall, setRainfall] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [floodRes, weatherRes] = await Promise.all([
          cachedFetchJson(`${API_URL}/api/disasters?disaster_type=flood`, { ttlMs: 60 * 1000 }),
          cachedFetchJson('https://api.open-meteo.com/v1/forecast?latitude=20.59&longitude=78.96&daily=precipitation_sum,rain_sum,precipitation_hours&timezone=Asia%2FKolkata&forecast_days=7', { ttlMs: 10 * 60 * 1000 }),
        ]);
        setFloods(floodRes.disasters || []);
        setRainfall(weatherRes.daily || null);
      } catch (e) {
        console.error('Flood data fetch error:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) return (
    <DataSectionLoader
      variant="flood"
      title="Loading flood intelligence"
      subtitle="Syncing rainfall forecasts and flood alerts"
    />
  );

  const active = floods.filter(f => f.status === 'active');
  const historical = floods.filter(f => f.status !== 'active');
  const todayRain = rainfall?.precipitation_sum?.[0] ?? null;
  const maxRain = rainfall?.precipitation_sum ? Math.max(...rainfall.precipitation_sum, 1) : 1;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DisasterCard
          title="Active Flood Alerts"
          value={active.length}
          subtext={active.length ? 'Live GDACS alerts' : 'No active alerts'}
          icon={Waves}
          color="bg-blue-500"
        />
        <DisasterCard
          title="Rainfall Today"
          value={todayRain != null ? `${todayRain.toFixed(1)} mm` : '—'}
          subtext="Central India (Open-Meteo)"
          icon={Droplets}
          color="bg-cyan-500"
        />
        <DisasterCard
          title="Historical Events"
          value={historical.length}
          subtext="On record"
          icon={MapPin}
          color="bg-orange-500"
        />
      </div>

      {/* 7-day precipitation forecast chart */}
      {rainfall?.time && (
        <Card>
          <CardHeader>
            <CardTitle>7-Day Precipitation Forecast</CardTitle>
            <CardDescription>Central India · Source: Open-Meteo</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {rainfall.time.map((date, i) => {
                const mm = rainfall.precipitation_sum?.[i] ?? 0;
                const pct = Math.min(100, (mm / maxRain) * 100);
                const barColor = mm > 30 ? 'bg-blue-600' : mm > 10 ? 'bg-blue-400' : mm > 2 ? 'bg-sky-300' : 'bg-gray-200';
                return (
                  <div key={`${date || 'rain'}-${i}`} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-24 shrink-0">{date}</span>
                    <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                      <div
                        className={`h-3 rounded-full transition-all ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium w-16 text-right shrink-0">
                      {mm.toFixed(1)} mm
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {active.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center py-16">
            <Waves className="w-14 h-14 mx-auto text-muted-foreground opacity-30 mb-4" />
            <p className="text-lg font-semibold">No Active Flood Alerts</p>
            <p className="text-sm text-muted-foreground mt-1">
              No live flood events reported for South Asia. Data sourced from GDACS.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {active.map((f, i) => (
            <Card key={f.id || i} className="border-blue-500/30 bg-blue-500/5">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-semibold">{f.title}</h4>
                    <p className="text-sm text-muted-foreground">{f.location}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-white ${SEVERITY_COLOR[f.severity] || 'bg-gray-500'}`}>
                      {f.severity}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{f.source}</Badge>
                  </div>
                </div>
                <p className="text-sm">{f.description}</p>
                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
                  <span>{f.date}</span>
                  {f.casualties != null && (
                    <span className="text-destructive font-medium">Deaths: {f.casualties}</span>
                  )}
                  {f.affected_population != null && (
                    <span>Affected: {f.affected_population.toLocaleString()}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {historical.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Flood History</CardTitle>
            <CardDescription>Past events from historical records</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {historical.slice(0, 6).map((f, i) => (
              <div key={f.id || i} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium text-sm">{f.title}</p>
                  <p className="text-xs text-muted-foreground">{f.location} · {f.date}</p>
                </div>
                <div className="flex items-center gap-2">
                  {f.casualties != null && (
                    <span className="text-xs text-destructive">Deaths: {f.casualties}</span>
                  )}
                  <Badge className={`text-white text-xs ${SEVERITY_COLOR[f.severity] || 'bg-gray-500'}`}>
                    {f.severity}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground text-right">
        Live alerts: GDACS · Rainfall forecast: Open-Meteo
      </p>
    </div>
  );
};

const EarthquakeView = () => {
  const [quakes, setQuakes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [latest, setLatest] = useState(null);

  useEffect(() => {
    cachedFetchJson(`${API_URL}/api/disasters?disaster_type=earthquake`, { ttlMs: 60 * 1000 })
      .then(data => {
        const list = (data.disasters || []).filter(d => d.source === 'USGS' || d.type === 'earthquake');
        setQuakes(list);
        setLatest(list[0] || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <DataSectionLoader
      variant="quake"
      title="Loading earthquake events"
      subtitle="Fetching latest USGS and regional seismic updates"
    />
  );

  return (
  <div className="space-y-6">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <DisasterCard 
        title="Latest Magnitude" 
        value={latest ? `M${latest.magnitude?.toFixed(1) || '—'}` : '—'} 
        subtext={latest?.location || 'No recent data'} 
        icon={Activity} 
        color="bg-orange-500" 
      />
      <DisasterCard 
        title="Depth" 
        value={latest ? `${latest.depth_km ?? '—'} km` : '—'} 
        subtext={latest?.depth_km < 70 ? 'Shallow (higher impact)' : 'Deep'} 
        icon={Navigation} 
        color="bg-yellow-500" 
      />
      <DisasterCard 
        title="Events (30 days)" 
        value={quakes.filter(q => q.source === 'USGS').length || quakes.length}
        subtext="M≥4.0 in South Asia" 
        icon={MapPin} 
        color="bg-red-500" 
      />
    </div>
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Recent Earthquakes
          <Badge variant="outline" className="text-xs">Live · USGS</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {quakes.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No recent earthquake data available.</p>
        ) : (
          <div className="space-y-3">
            {quakes.slice(0, 8).map((q, i) => {
              const mag = q.magnitude ?? 0;
              const color = mag >= 6 ? 'text-red-600 bg-red-100' : mag >= 5 ? 'text-orange-600 bg-orange-100' : 'text-yellow-700 bg-yellow-100';
              const sevLabel = mag >= 6 ? 'Strong' : mag >= 5 ? 'Moderate' : 'Light';
              return (
                <div key={q.id || i} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${color}`}>
                      {mag.toFixed(1)}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{q.location}</p>
                      <p className="text-xs text-muted-foreground">{q.date} · Depth {q.depth_km ?? '?'} km</p>
                    </div>
                  </div>
                  <Badge variant="outline">{sevLabel}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  </div>
  );
};

const HEAT_CITIES = [
  { name: 'Delhi', lat: 28.61, lon: 77.20 },
  { name: 'Mumbai', lat: 19.07, lon: 72.87 },
  { name: 'Chennai', lat: 13.08, lon: 80.27 },
  { name: 'Kolkata', lat: 22.57, lon: 88.36 },
  { name: 'Hyderabad', lat: 17.38, lon: 78.48 },
  { name: 'Ahmedabad', lat: 23.02, lon: 72.57 },
];

const HeatView = () => {
  const [cityData, setCityData] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHeatData = async () => {
      try {
        const cityResults = await Promise.all(
          HEAT_CITIES.map(city =>
            cachedFetchJson(
              `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,apparent_temperature,uv_index&timezone=Asia%2FKolkata`,
              { ttlMs: 10 * 60 * 1000 }
            )
              .then(d => ({
                name: city.name,
                temp: d.current?.temperature_2m ?? null,
                feelsLike: d.current?.apparent_temperature ?? null,
                uvIndex: d.current?.uv_index ?? null,
              }))
              .catch(() => ({ name: city.name, temp: null, feelsLike: null, uvIndex: null }))
          )
        );
        setCityData(cityResults);

        // 7-day forecast for Delhi
        const fData = await cachedFetchJson(
          'https://api.open-meteo.com/v1/forecast?latitude=28.61&longitude=77.20&daily=temperature_2m_max,temperature_2m_min,uv_index_max&timezone=Asia%2FKolkata&forecast_days=7',
          { ttlMs: 10 * 60 * 1000 }
        );
        setForecast(fData.daily || null);
      } catch (e) {
        console.error('Heat data fetch error:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchHeatData();
  }, []);

  if (loading) return (
    <DataSectionLoader
      variant="heatwave"
      title="Loading heatwave monitor"
      subtitle="Analyzing temperature and UV patterns"
    />
  );

  const withData = cityData.filter(c => c.temp != null);
  const hottest = withData.reduce((max, c) => (c.temp > (max?.temp ?? -999) ? c : max), null);

  const heatColor = (temp) => {
    if (temp == null) return 'text-muted-foreground';
    if (temp >= 44) return 'text-red-700';
    if (temp >= 40) return 'text-red-500';
    if (temp >= 35) return 'text-orange-500';
    if (temp >= 30) return 'text-yellow-600';
    return 'text-green-600';
  };
  const heatBg = (temp) => {
    if (temp == null) return '';
    if (temp >= 44) return 'bg-red-100 border-red-300 dark:bg-red-950/40 dark:border-red-800';
    if (temp >= 40) return 'bg-orange-100 border-orange-300 dark:bg-orange-950/40 dark:border-orange-800';
    if (temp >= 35) return 'bg-yellow-100 border-yellow-300 dark:bg-yellow-950/40 dark:border-yellow-800';
    return 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800';
  };
  const heatLabel = (temp) => {
    if (temp == null) return 'N/A';
    if (temp >= 44) return 'Extreme Heat';
    if (temp >= 40) return 'Severe Heat';
    if (temp >= 35) return 'Hot';
    if (temp >= 30) return 'Warm';
    return 'Normal';
  };
  const uvLabel = (uv) => {
    if (uv == null) return '—';
    if (uv >= 11) return 'Extreme';
    if (uv >= 8) return 'Very High';
    if (uv >= 6) return 'High';
    if (uv >= 3) return 'Moderate';
    return 'Low';
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DisasterCard
          title="Hottest City"
          value={hottest ? `${hottest.temp?.toFixed(1)}°C` : '—'}
          subtext={hottest?.name || 'No data'}
          icon={Sun}
          color="bg-orange-500"
        />
        <DisasterCard
          title="Feels Like"
          value={hottest ? `${hottest.feelsLike?.toFixed(1)}°C` : '—'}
          subtext="Apparent temperature"
          icon={Activity}
          color="bg-red-500"
        />
        <DisasterCard
          title="UV Index"
          value={hottest ? (hottest.uvIndex?.toFixed(0) ?? '—') : '—'}
          subtext={hottest ? uvLabel(hottest.uvIndex) : 'No data'}
          icon={AlertTriangle}
          color={hottest?.uvIndex >= 8 ? 'bg-red-500' : 'bg-yellow-500'}
        />
      </div>

      {/* City comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Current Temperatures — Major Cities</CardTitle>
          <CardDescription>Live data sourced from Open-Meteo</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {cityData.map(city => (
              <div key={city.name} className={`p-4 rounded-lg border ${heatBg(city.temp)}`}>
                <p className="font-semibold text-sm mb-1">{city.name}</p>
                <p className={`text-2xl font-bold ${heatColor(city.temp)}`}>
                  {city.temp != null ? `${city.temp.toFixed(1)}°C` : '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Feels {city.feelsLike != null ? `${city.feelsLike.toFixed(1)}°C` : '—'}
                </p>
                <div className="flex items-center justify-between mt-2">
                  <Badge variant="outline" className="text-[10px]">{heatLabel(city.temp)}</Badge>
                  <span className="text-xs text-muted-foreground">UV {city.uvIndex?.toFixed(0) ?? '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 7-day Delhi forecast */}
      {forecast?.time && (
        <Card>
          <CardHeader>
            <CardTitle>7-Day Temperature Forecast</CardTitle>
            <CardDescription>Delhi NCR · Open-Meteo</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {forecast.time.map((date, i) => {
                const max = forecast.temperature_2m_max?.[i] ?? 0;
                const min = forecast.temperature_2m_min?.[i] ?? 0;
                const uv = forecast.uv_index_max?.[i] ?? 0;
                const pct = Math.min(100, (max / 50) * 100);
                const barColor = max >= 44 ? 'bg-red-600' : max >= 40 ? 'bg-orange-500' : max >= 35 ? 'bg-yellow-500' : 'bg-green-400';
                return (
                  <div key={`${date || 'temp'}-${i}`} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-24 shrink-0">{date}</span>
                    <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                      <div
                        className={`h-3 rounded-full transition-all ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium w-28 text-right shrink-0">
                      {min.toFixed(0)}° / {max.toFixed(0)}°C · UV {uv.toFixed(0)}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground text-right">
        Temperature &amp; UV data: Open-Meteo (WMO-compliant, updated hourly)
      </p>
    </div>
  );
};

const TYPE_ICON = { cyclone: '🌀', flood: '🌊', earthquake: '🫨', heatwave: '🔥', landslide: '⛰️' };
const TYPE_COLOR = {
  cyclone:   'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/40',
  flood:     'border-blue-400 bg-blue-50 dark:bg-blue-950/40',
  earthquake:'border-orange-400 bg-orange-50 dark:bg-orange-950/40',
  heatwave:  'border-red-400 bg-red-50 dark:bg-red-950/40',
  landslide: 'border-yellow-400 bg-yellow-50 dark:bg-yellow-950/40',
};

const TimelineView = () => {
  const [disasters, setDisasters] = useState([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    cachedFetchJson(`${API_URL}/api/disasters`, { ttlMs: 60 * 1000 })
      .then(data => {
        const list = (data.disasters || [])
          .filter(d => d.date)
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        setDisasters(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const scroll = (dir) => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: dir * 320, behavior: 'smooth' });
    }
  };

  // Group by year-month
  const grouped = disasters.reduce((acc, d) => {
    const key = d.date.slice(0, 7); // "2024-05"
    if (!acc[key]) acc[key] = [];
    acc[key].push(d);
    return acc;
  }, {});
  const months = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  if (loading) return (
    <DataSectionLoader
      variant="timeline"
      title="Building disaster timeline"
      subtitle="Ordering events across recent months"
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Disaster Timeline</h3>
          <p className="text-sm text-muted-foreground">{disasters.length} events — scroll horizontally through history</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => scroll(-1)}><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="outline" size="icon" onClick={() => scroll(1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>

      {/* Horizontal scroll container */}
      <div
        ref={scrollRef}
        className="overflow-x-auto pb-4 cursor-grab active:cursor-grabbing select-none"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div className="flex gap-6 w-max px-1 py-2">
          {months.map(month => {
            const [yr, mo] = month.split('-');
            const label = new Date(parseInt(yr), parseInt(mo) - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
            return (
              <div key={month} className="flex flex-col gap-3" style={{ minWidth: 280 }}>
                {/* Month header */}
                <div className="sticky top-0 bg-background/90 backdrop-blur-sm py-1 z-10">
                  <Badge variant="secondary" className="text-xs font-semibold px-3 py-1">{label}</Badge>
                  <div className="h-0.5 bg-border mt-2" />
                </div>
                {/* Events in that month */}
                {grouped[month].map((d, i) => (
                  <motion.div
                    key={d.id || i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className={`border-l-4 rounded-lg p-3 ${TYPE_COLOR[d.type] || 'border-gray-300 bg-muted/30'}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-sm font-semibold leading-tight flex gap-1.5">
                        <span>{TYPE_ICON[d.type] || '⚠️'}</span>
                        <span className="line-clamp-2">{d.title}</span>
                      </span>
                      <Badge className={`text-white text-[10px] shrink-0 ${SEVERITY_COLOR[d.severity] || 'bg-gray-500'}`}>
                        {d.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">{d.location} · {d.date}</p>
                    {d.casualties != null && (
                      <p className="text-xs text-destructive font-medium">Deaths: {d.casualties.toLocaleString()}</p>
                    )}
                    {d.affected_population != null && (
                      <p className="text-xs text-muted-foreground">Affected: {d.affected_population.toLocaleString()}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{d.description}</p>
                  </motion.div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-2 border-t">
        {Object.entries(TYPE_ICON).map(([type, icon]) => (
          <span key={type} className="text-xs text-muted-foreground flex items-center gap-1">
            {icon} {type.charAt(0).toUpperCase() + type.slice(1)}
          </span>
        ))}
      </div>
    </div>
  );
};

const Disasters = () => {
  const pdfRef = useRef(null);

  const exportToPDF = async () => {
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: html2canvas } = await import('html2canvas');
      const el = pdfRef.current;
      if (!el) return;
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.setFontSize(18);
      pdf.setTextColor(30, 30, 30);
      pdf.text('Suraksha Setu — Disaster Summary Report', 14, 16);
      pdf.setFontSize(9);
      pdf.setTextColor(120, 120, 120);
      pdf.text(`Generated: ${new Date().toLocaleString()}`, 14, 23);
      pdf.addImage(imgData, 'PNG', 0, 28, pdfWidth, Math.min(pdfHeight, 260));
      pdf.save(`disaster-report-${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (e) {
      console.error('PDF export failed:', e);
      alert('PDF export failed. Please try again.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Disaster Management</h1>
          <p className="text-muted-foreground">Real-time monitoring and response coordination.</p>
        </div>
        <Button variant="outline" onClick={exportToPDF} className="gap-2">
          <Download className="w-4 h-4" />
          Export PDF Report
        </Button>
      </div>

      <div ref={pdfRef}>
      <Tabs defaultValue="nearby" className="w-full">
        <TabsList className="grid w-full grid-cols-6 lg:w-[600px] mb-6">
          <TabsTrigger value="nearby" className="flex items-center gap-1">
            <MapPin className="w-4 h-4" />
            <span className="hidden sm:inline">Nearby</span>
          </TabsTrigger>
          <TabsTrigger value="timeline" className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            <span className="hidden sm:inline">Timeline</span>
          </TabsTrigger>
          <TabsTrigger value="cyclone">Cyclone</TabsTrigger>
          <TabsTrigger value="flood">Flood</TabsTrigger>
          <TabsTrigger value="earthquake">Quake</TabsTrigger>
          <TabsTrigger value="heat">Heat</TabsTrigger>
        </TabsList>
        
        <TabsContent value="nearby">
          <NearbyDisastersView />
        </TabsContent>
        <TabsContent value="timeline">
          <TimelineView />
        </TabsContent>
        <TabsContent value="cyclone">
          <CycloneView />
        </TabsContent>
        <TabsContent value="flood">
          <FloodView />
        </TabsContent>
        <TabsContent value="earthquake">
          <EarthquakeView />
        </TabsContent>
        <TabsContent value="heat">
          <HeatView />
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
};

export default Disasters;
