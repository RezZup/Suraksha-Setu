import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  CloudRain, 
  Sun, 
  Wind, 
  Droplets, 
  Thermometer, 
  CloudFog,
  ArrowUpRight,
  Calendar,
  Search,
  MapPin,
  Loader2,
  RefreshCw,
  AlertCircle,
  Eye,
  Sunrise,
  Sunset,
  Compass,
  Gauge,
  CloudDrizzle,
  Activity,
  TrendingUp,
  Zap
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, BarChart, Bar, Legend, ComposedChart } from 'recharts';
import { getWeatherByLocation, getAQIByLocation } from '@/services/weatherApi';
import axios from 'axios';
import { useLocation as useAppLocation } from '@/contexts/LocationContext';
import { readTimedCache, saveTimedCache } from '@/utils/locationCache';

const BACKEND = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const WEATHER_BOOTSTRAP_CACHE_KEY = 'weather_dashboard_bootstrap_v1';
const WEATHER_BOOTSTRAP_TTL_MS = 10 * 60 * 1000;

const Weather = () => {
  const { location: appLocation } = useAppLocation();
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState('');
  const [weatherData, setWeatherData] = useState(null);
  const [aqiData, setAQIData] = useState(null);
  const [aqiHistory, setAQIHistory] = useState(null);
  const [error, setError] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);

  const persistWeatherBootstrap = ({ weather, aqi, aqiHistory: history, currentLocationName }) => {
    saveTimedCache(
      WEATHER_BOOTSTRAP_CACHE_KEY,
      {
        weather,
        aqi,
        aqiHistory: history,
        currentLocationName,
      },
      WEATHER_BOOTSTRAP_TTL_MS
    );
  };

  const parseNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  // Quick access cities for India
  const quickAccessCities = [
    { name: 'Delhi', coords: { lat: 28.6139, lon: 77.2090 }, icon: '🏛️' },
    { name: 'Mumbai', coords: { lat: 19.0760, lon: 72.8777 }, icon: '🌊' },
    { name: 'Bangalore', coords: { lat: 12.9716, lon: 77.5946 }, icon: '💻' },
    { name: 'Chennai', coords: { lat: 13.0827, lon: 80.2707 }, icon: '🏖️' },
    { name: 'Kolkata', coords: { lat: 22.5726, lon: 88.3639 }, icon: '🎭' },
    { name: 'Hyderabad', coords: { lat: 17.3850, lon: 78.4867 }, icon: '💎' },
  ];

  // Cache-first startup, then refresh in background using shared app location.
  useEffect(() => {
    const cached = readTimedCache(WEATHER_BOOTSTRAP_CACHE_KEY);
    if (cached?.weather) {
      setWeatherData(cached.weather);
      setAQIData(cached.aqi || null);
      setAQIHistory(cached.aqiHistory || null);
      setCurrentLocation(cached.currentLocationName || null);
      setLoading(false);
    }

    const lat = Number(appLocation?.latitude ?? appLocation?.lat);
    const lon = Number(appLocation?.longitude ?? appLocation?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      loadWeatherData({ lat, lon }, { background: true });
      return;
    }

    loadAutoDetectWeather({ background: true });
  }, [appLocation]);

  const loadAutoDetectWeather = async ({ background = false } = {}) => {
    if (!background) setLoading(true);
    setError(null);
    
    try {
      const response = await axios.get(`${BACKEND}/api/weather/auto-detect`);
      
      if (response.data && response.data.location) {
        // Get complete weather data with hourly and daily forecasts
        const completeWeather = await getWeatherByLocation({
          lat: response.data.location.lat,
          lon: response.data.location.lon
        });
        
        // Merge AI insights from auto-detect with complete weather data
        completeWeather.ai_insights = response.data.ai_insights;
        
        setWeatherData(completeWeather);
        const detectedName = response.data.location?.display_name || 'Your Location';
        setCurrentLocation(detectedName);
        
        // Also load AQI and history
        try {
          const aqiData = await getAQIByLocation({
            lat: response.data.location.lat,
            lon: response.data.location.lon
          });
          setAQIData(aqiData);
          
          // Load 7-day AQI history
          const historyResponse = await axios.get(
            `${BACKEND}/api/aqi/history?lat=${response.data.location.lat}&lon=${response.data.location.lon}&days=7`
          );
          const nextHistory = historyResponse.data?.source === 'openweather' ? historyResponse.data : null;
          setAQIHistory(nextHistory);
          persistWeatherBootstrap({
            weather: completeWeather,
            aqi: aqiData,
            aqiHistory: nextHistory,
            currentLocationName: detectedName,
          });
        } catch (err) {
          console.error('AQI data fetch error:', err);
          setAQIData(null);
          setAQIHistory(null);
          persistWeatherBootstrap({
            weather: completeWeather,
            aqi: null,
            aqiHistory: null,
            currentLocationName: detectedName,
          });
        }
      }
    } catch (err) {
      console.error('Auto-detect failed:', err);
      setError('Unable to detect location. Please search for a city.');
    } finally {
      if (!background) setLoading(false);
    }
  };

  const loadWeatherData = async (locationQuery, { background = false } = {}) => {
    if (!background) setLoading(true);
    setError(null);
    
    try {
      const [weather, aqi] = await Promise.allSettled([
        getWeatherByLocation(locationQuery),
        getAQIByLocation(locationQuery)
      ]);

      if (weather.status === 'fulfilled' && weather.value) {
        setWeatherData(weather.value);
        let resolvedLocationName = currentLocation;
        if (weather.value.location) {
          resolvedLocationName = weather.value.location.display_name || weather.value.location.name || locationQuery;
          setCurrentLocation(resolvedLocationName);
        }
        let nextHistory = null;

        if (aqi.status === 'fulfilled' && aqi.value) {
          setAQIData(aqi.value);

          // Load 7-day AQI history
          try {
            const coords = weather.value.location;
            const historyResponse = await axios.get(
              `${BACKEND}/api/aqi/history?lat=${coords.lat}&lon=${coords.lon}&days=7`
            );
            nextHistory = historyResponse.data?.source === 'openweather' ? historyResponse.data : null;
            setAQIHistory(nextHistory);
          } catch (err) {
            console.error('AQI history fetch error:', err);
            setAQIHistory(null);
          }
        } else {
          console.error('AQI fetch failed:', aqi.reason || 'Unknown error');
          setAQIData(null); // Clear previous AQI data
          setAQIHistory(null);
        }

        persistWeatherBootstrap({
          weather: weather.value,
          aqi: aqi.status === 'fulfilled' ? aqi.value : null,
          aqiHistory: nextHistory,
          currentLocationName: resolvedLocationName,
        });
      } else {
        const cached = readTimedCache(WEATHER_BOOTSTRAP_CACHE_KEY);
        if (cached?.weather) {
          setWeatherData(cached.weather);
          setAQIData(cached.aqi || null);
          setAQIHistory(cached.aqiHistory || null);
          setCurrentLocation(cached.currentLocationName || currentLocation || 'Last known location');
          setError('Live weather is temporarily unavailable. Showing recent data.');
        } else {
          setError('Could not load weather data');
        }
      }
    } catch (err) {
      console.error('Error loading weather:', err);
      const cached = readTimedCache(WEATHER_BOOTSTRAP_CACHE_KEY);
      if (cached?.weather) {
        setWeatherData(cached.weather);
        setAQIData(cached.aqi || null);
        setAQIHistory(cached.aqiHistory || null);
        setCurrentLocation(cached.currentLocationName || currentLocation || 'Last known location');
        setError('Live weather request failed. Showing recent data.');
      } else {
        setError('Failed to load weather data. Please try again.');
      }
    } finally {
      if (!background) setLoading(false);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!location.trim()) return;
    await loadWeatherData(location);
  };

  const handleAutoDetect = () => {
    if (navigator.geolocation) {
      setLoading(true);
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            await loadWeatherData({
              lat: position.coords.latitude,
              lon: position.coords.longitude
            });
          } catch (err) {
            setError('Failed to get weather for your location');
          }
        },
        (error) => {
          setError('Unable to detect location. Please enable location services.');
          setLoading(false);
        }
      );
    } else {
      setError('Geolocation is not supported by your browser');
    }
  };

  const handleQuickCityClick = async (city) => {
    setCurrentLocation(city.name);
    setLocation(city.name);
    await loadWeatherData(city.coords);
  };

  // Transform hourly data from API - show next 24 hours from current time
  const hourlyData = (() => {
    if (!weatherData?.hourly) {
      return [];
    }

    // Find the current hour index in the API data
    const now = new Date();
    const currentHourIndex = weatherData.hourly.findIndex(hour => {
      const hourTime = new Date(hour.time);
      return hourTime >= now;
    });

    // Get next 24 hours from current time
    const startIndex = currentHourIndex >= 0 ? currentHourIndex : 0;
    return weatherData.hourly.slice(startIndex, startIndex + 24).map((hour) => ({
      time: new Date(hour.time).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }),
      temp: parseNumber(hour.temp ?? hour.temperature) != null ? Math.round(parseNumber(hour.temp ?? hour.temperature)) : null,
      rain: parseNumber(hour.rain) != null ? Math.round(parseNumber(hour.rain)) : null,
      humidity: parseNumber(hour.humidity) != null ? Math.round(parseNumber(hour.humidity)) : null
    }));
  })();

  // Map weather codes to icons
  const getWeatherIcon = (code) => {
    if (!code) return Sun;
    if (code >= 61 && code <= 67) return CloudRain;
    if (code >= 71 && code <= 77) return CloudFog;
    if (code >= 80 && code <= 99) return CloudRain;
    if (code >= 51 && code <= 57) return Droplets;
    return code <= 3 ? Sun : CloudFog;
  };

  // Transform daily forecast from API
  const forecast = weatherData?.daily?.slice(0, 7).map((day, index) => ({
    day: index === 0 ? 'Today' : new Date(day.date || day.time).toLocaleDateString('en-US', { weekday: 'short' }),
    icon: getWeatherIcon(day.weather_code),
    temp: parseNumber(day.high ?? day.temperature_max) != null ? `${Math.round(parseNumber(day.high ?? day.temperature_max))}°` : '--',
    tempLow: parseNumber(day.low ?? day.temperature_min) != null ? `${Math.round(parseNumber(day.low ?? day.temperature_min))}°` : '--',
    status: day.condition || 'N/A'
  })) || [];

  const current = weatherData?.current || {};
  const hasWeatherData = Boolean(weatherData?.current);
  const showWeatherSkeleton = loading || !hasWeatherData;
  const currentTemp = parseNumber(current.temperature) != null ? Math.round(parseNumber(current.temperature)) : null;
  const feelsLike = parseNumber(current.apparent_temperature) != null ? Math.round(parseNumber(current.apparent_temperature)) : null;
  const humidity = parseNumber(current.humidity) != null ? Math.round(parseNumber(current.humidity)) : null;
  const windSpeed = parseNumber(current.wind_speed) != null ? Math.round(parseNumber(current.wind_speed)) : null;
  const windDirection = parseNumber(current.wind_direction);
  const pressure = parseNumber(current.pressure) != null ? Math.round(parseNumber(current.pressure)) : null;
  const aqiValue = aqiData?.aqi ?? aqiData?.current?.aqi ?? null;
  const aqiStatus = aqiData?.aqi_label || aqiData?.current?.category || 'N/A';
  const pm25 = parseNumber(aqiData?.pm25 ?? aqiData?.current?.pm25);
  const pm10 = parseNumber(aqiData?.pm10 ?? aqiData?.current?.pm10);
  const uvIndex = parseNumber(current.uv_index);
  const precipitation = parseNumber(current.rain ?? current.precipitation);
  const visibility = parseNumber(current.visibility);
  const cloudCover = parseNumber(current.cloud_cover);
  const sunriseText = weatherData?.daily?.[0]?.sunrise
    ? new Date(weatherData.daily[0].sunrise).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : '--';
  const sunsetText = weatherData?.daily?.[0]?.sunset
    ? new Date(weatherData.daily[0].sunset).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : '--';
  const windDirectionLabel = (() => {
    if (windDirection == null) return 'N/A';
    if (windDirection >= 337.5 || windDirection < 22.5) return 'North';
    if (windDirection >= 22.5 && windDirection < 67.5) return 'Northeast';
    if (windDirection >= 67.5 && windDirection < 112.5) return 'East';
    if (windDirection >= 112.5 && windDirection < 157.5) return 'Southeast';
    if (windDirection >= 157.5 && windDirection < 202.5) return 'South';
    if (windDirection >= 202.5 && windDirection < 247.5) return 'Southwest';
    if (windDirection >= 247.5 && windDirection < 292.5) return 'West';
    return 'Northwest';
  })();

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Weather & AQI Station</h1>
          <p className="text-muted-foreground">Hyper-local weather data and air quality monitoring.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Search Location */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              type="text"
              placeholder="Search location..."
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-48"
            />
            <Button type="submit" size="icon" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </Button>
          </form>
          {/* Auto Detect Location */}
          <Button variant="outline" size="icon" onClick={handleAutoDetect} disabled={loading} title="Use my location">
            <MapPin className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={loadAutoDetectWeather} disabled={loading} title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg flex items-center gap-2"
        >
          <AlertCircle className="w-5 h-5" />
          {error}
        </motion.div>
      )}

      {/* Quick Access Cities */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap gap-2"
      >
        <span className="text-sm text-muted-foreground flex items-center gap-2">
          <Zap className="w-4 h-4" />
          Quick Access:
        </span>
        {quickAccessCities.map((city) => (
          <Button
            key={city.name}
            variant="outline"
            size="sm"
            onClick={() => handleQuickCityClick(city)}
            disabled={loading}
            className="gap-1 hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            <span>{city.icon}</span>
            {city.name}
          </Button>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Weather Card */}
        <Card className="lg:col-span-2 bg-gradient-to-br from-blue-600 to-blue-800 text-white border-none shadow-xl overflow-hidden relative">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Sun className="w-64 h-64" />
          </div>
          <CardContent className="p-8 relative z-10">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-semibold opacity-90">{currentLocation}</h2>
                <p className="text-blue-100">{new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </div>
              {current.is_severe && (
                <Badge variant="secondary" className="bg-white/20 hover:bg-white/30 text-white border-none">
                  Severe Weather Alert
                </Badge>
              )}
            </div>

            {showWeatherSkeleton ? (
              <div className="mt-8 space-y-6">
                <div className="flex items-end gap-6">
                  <Skeleton className="h-20 w-36 bg-white/20" />
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-48 bg-white/20" />
                    <Skeleton className="h-4 w-36 bg-white/20" />
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="bg-white/10 rounded-xl p-3">
                      <Skeleton className="h-4 w-16 bg-white/20 mb-2" />
                      <Skeleton className="h-8 w-14 bg-white/20 mb-1" />
                      <Skeleton className="h-3 w-20 bg-white/20" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="mt-8 flex items-center gap-8">
                  <div className="text-8xl font-bold tracking-tighter">
                    {currentTemp != null ? `${currentTemp}°` : '--'}
                  </div>
                  <div className="space-y-1">
                    <div className="text-2xl font-medium">{current.condition || 'Data unavailable'}</div>
                    <div className="text-blue-100">Feels like {feelsLike != null ? `${feelsLike}°` : '--'}</div>
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-white/10 rounded-xl p-3 backdrop-blur-sm hover:bg-white/15 transition-all"
                  >
                    <div className="flex items-center gap-2 text-blue-100 mb-1">
                      <Wind className="w-4 h-4" /> Wind
                    </div>
                    <div className="text-2xl font-bold">{windSpeed != null ? windSpeed : '--'}</div>
                    <div className="text-xs text-blue-200">km/h {windDirection != null ? windDirection : '--'}°</div>
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-white/10 rounded-xl p-3 backdrop-blur-sm hover:bg-white/15 transition-all"
                  >
                    <div className="flex items-center gap-2 text-blue-100 mb-1">
                      <Droplets className="w-4 h-4" /> Humidity
                    </div>
                    <div className="text-2xl font-bold">{humidity != null ? `${humidity}%` : '--'}</div>
                    <div className="text-xs text-blue-200">Dew {currentTemp != null && humidity != null ? `${Math.round(currentTemp - ((100 - humidity) / 5))}°` : '--'}</div>
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bg-white/10 rounded-xl p-3 backdrop-blur-sm hover:bg-white/15 transition-all"
                  >
                    <div className="flex items-center gap-2 text-blue-100 mb-1">
                      <Gauge className="w-4 h-4" /> Pressure
                    </div>
                    <div className="text-2xl font-bold">{pressure != null ? pressure : '--'}</div>
                    <div className="text-xs text-blue-200">hPa</div>
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="bg-white/10 rounded-xl p-3 backdrop-blur-sm hover:bg-white/15 transition-all"
                  >
                    <div className="flex items-center gap-2 text-blue-100 mb-1">
                      <Eye className="w-4 h-4" /> Visibility
                    </div>
                    <div className="text-2xl font-bold">{visibility != null ? visibility : '--'}</div>
                    <div className="text-xs text-blue-200">km</div>
                  </motion.div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* AQI Card - Compact Style */}
        <Card className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border-emerald-200 dark:border-emerald-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-600" />
              Air Quality Index
            </CardTitle>
          </CardHeader>
          <CardContent>
            {showWeatherSkeleton ? (
              <div className="space-y-4 py-4">
                <div className="flex justify-center">
                  <Skeleton className="h-36 w-36 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 15 }}
                  className="flex flex-col items-center justify-center py-4"
                >
                  <div className="relative w-36 h-36 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle
                        cx="72"
                        cy="72"
                        r="60"
                        stroke="currentColor"
                        strokeWidth="10"
                        fill="transparent"
                        className="text-muted/30"
                      />
                      <motion.circle
                        initial={{ strokeDashoffset: 377 }}
                        animate={{ strokeDashoffset: 377 - (377 * Math.min(aqiValue ?? 0, 500) / 500) }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        cx="72"
                        cy="72"
                        r="60"
                        stroke="currentColor"
                        strokeWidth="10"
                        fill="transparent"
                        strokeDasharray="377"
                        strokeLinecap="round"
                        className={
                          (aqiValue ?? 0) <= 50 ? 'text-green-500' :
                          (aqiValue ?? 0) <= 100 ? 'text-yellow-500' :
                          (aqiValue ?? 0) <= 150 ? 'text-orange-500' :
                          (aqiValue ?? 0) <= 200 ? 'text-red-500' :
                          'text-purple-500'
                        }
                      />
                    </svg>
                    <div className="absolute text-center">
                      <div className="text-3xl font-bold text-foreground">{aqiValue ?? '--'}</div>
                      <div className={`text-xs font-semibold uppercase tracking-wide ${
                        (aqiValue ?? 0) <= 50 ? 'text-green-600' :
                        (aqiValue ?? 0) <= 100 ? 'text-yellow-600' :
                        (aqiValue ?? 0) <= 150 ? 'text-orange-600' :
                        (aqiValue ?? 0) <= 200 ? 'text-red-600' :
                        'text-purple-600'
                      }`}>{aqiStatus}</div>
                    </div>
                  </div>
                </motion.div>

                <div className="space-y-3 mt-2">
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                    className="space-y-1"
                  >
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground font-medium">PM 2.5</span>
                      <span className="font-bold">{pm25 ?? '--'} <span className="text-xs text-muted-foreground">µg/m³</span></span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(pm25 ?? 0, 100)}%` }}
                        transition={{ duration: 0.8, delay: 0.3 }}
                        className={`h-full ${(pm25 ?? 0) <= 35 ? 'bg-green-500' : (pm25 ?? 0) <= 75 ? 'bg-yellow-500' : 'bg-red-500'}`}
                      />
                    </div>
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 }}
                    className="space-y-1"
                  >
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground font-medium">PM 10</span>
                      <span className="font-bold">{pm10 ?? '--'} <span className="text-xs text-muted-foreground">µg/m³</span></span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min((pm10 ?? 0) / 2, 100)}%` }}
                        transition={{ duration: 0.8, delay: 0.5 }}
                        className={`h-full ${(pm10 ?? 0) <= 50 ? 'bg-green-500' : (pm10 ?? 0) <= 100 ? 'bg-yellow-500' : 'bg-red-500'}`}
                      />
                    </div>
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 }}
                    className="p-3 bg-white/50 dark:bg-black/20 rounded-lg text-xs mt-4 border border-emerald-200 dark:border-emerald-800"
                  >
                    <div className="font-semibold text-foreground mb-1 flex items-center gap-1">
                      <Zap className="w-3 h-3" /> Health Advice
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                       {aqiValue == null ? 'AQI live data is currently unavailable for this location.' :
                        aqiValue <= 50 ? '✅ Air quality is excellent. Perfect for outdoor activities!' :
                       aqiValue <= 100 ? '😊 Air quality is acceptable. Enjoy your day!' :
                       aqiValue <= 150 ? '⚠️ Sensitive groups should limit prolonged outdoor exposure.' :
                       aqiValue <= 200 ? '🚫 Everyone should reduce outdoor activities.' :
                       '🆘 Health alert! Stay indoors and avoid all outdoor activities.'}
                    </p>
                  </motion.div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 7-Day AQI Trend Graph */}
      {aqiHistory && aqiHistory.history && aqiHistory.history.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 border-purple-200 dark:border-purple-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-purple-600" />
                7-Day AQI Trend
                <Badge variant="secondary" className="ml-auto">Live Data</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64" style={{ minHeight: '256px' }}>
                <ResponsiveContainer width="100%" height={256}>
                  <ComposedChart data={aqiHistory.history}>
                    <defs>
                      <linearGradient id="aqiGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 12 }}
                      tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    />
                    <YAxis 
                      label={{ value: 'AQI', angle: -90, position: 'insideLeft' }}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                      }}
                      labelFormatter={(date) => new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                      formatter={(value, name) => {
                        if (name === 'aqi') return [value, 'AQI'];
                        if (name === 'pm25') return [value + ' µg/m³', 'PM2.5'];
                        if (name === 'pm10') return [value + ' µg/m³', 'PM10'];
                        return [value, name];
                      }}
                    />
                    <Legend />
                    <Area 
                      type="monotone" 
                      dataKey="aqi" 
                      fill="url(#aqiGradient)" 
                      stroke="#a855f7" 
                      strokeWidth={3}
                      name="AQI"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="pm25" 
                      stroke="#f97316" 
                      strokeWidth={2}
                      dot={{ fill: '#f97316', r: 4 }}
                      name="PM2.5"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="pm10" 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      dot={{ fill: '#3b82f6', r: 4 }}
                      name="PM10"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4">
                {aqiHistory.history.slice(-3).map((day, idx) => (
                  <motion.div
                    key={`${day.date || 'day'}-${idx}`}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1 * idx }}
                    className="p-3 bg-white/50 dark:bg-black/20 rounded-lg border border-purple-200 dark:border-purple-800"
                  >
                    <div className="text-xs text-muted-foreground">
                      {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}
                    </div>
                    <div className="text-2xl font-bold mt-1">{day.aqi}</div>
                    <div className={`text-xs font-semibold uppercase ${
                      day.aqi <= 50 ? 'text-green-600' :
                      day.aqi <= 100 ? 'text-yellow-600' :
                      day.aqi <= 150 ? 'text-orange-600' :
                      day.aqi <= 200 ? 'text-red-600' :
                      'text-purple-600'
                    }`}>{day.category}</div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* AI Weather Assistant - Enhanced with Glass Morphism */}
      {weatherData?.ai_insights && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="relative overflow-hidden"
        >
          <Card className="border-2 border-violet-300 dark:border-violet-700 shadow-2xl bg-gradient-to-br from-violet-500/10 via-purple-500/10 to-fuchsia-500/10 dark:from-violet-500/20 dark:via-purple-500/20 dark:to-fuchsia-500/20 backdrop-blur-sm hover:shadow-violet-200 dark:hover:shadow-violet-900 transition-all">
            {/* Decorative Background Elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-violet-400/10 to-purple-400/10 rounded-full blur-3xl"></div>
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-fuchsia-400/10 to-pink-400/10 rounded-full blur-3xl"></div>
            
            <CardContent className="p-6 relative z-10">
              <div className="flex items-start gap-4">
                {/* Animated Icon */}
                <motion.div
                  animate={{ 
                    rotate: [0, 10, -10, 10, 0],
                    scale: [1, 1.05, 1, 1.05, 1]
                  }}
                  transition={{ duration: 3, repeat: Infinity, repeatDelay: 2 }}
                  className="flex-shrink-0 relative"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl blur-lg opacity-50"></div>
                  <div className="relative bg-gradient-to-br from-violet-500 to-purple-600 p-4 rounded-2xl shadow-xl">
                    <Zap className="w-7 h-7 text-white" />
                  </div>
                </motion.div>

                <div className="flex-1">
                  {/* Header */}
                  <div className="flex items-center gap-3 mb-4 flex-wrap">
                    <h3 className="text-2xl font-bold bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 bg-clip-text text-transparent">
                      AI Weather Assistant
                    </h3>
                    <Badge className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-none shadow-lg">
                      <span className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                        </span>
                        <span className="font-semibold">Powered by Gemini AI</span>
                      </span>
                    </Badge>
                  </div>

                  {/* AI Insights Content */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="relative"
                  >
                    <div className="bg-white dark:bg-gray-900 rounded-2xl border-2 border-violet-300 dark:border-violet-700 shadow-lg p-6">
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        {weatherData.ai_insights.split('\n').map((line, idx) => {
                          // Handle main headings with **text**
                          if (line.includes('**') && !line.trim().startsWith('*')) {
                            const formattedLine = line.split('**').map((part, i) => 
                              i % 2 === 1 ? <strong key={i} className="text-violet-700 dark:text-violet-300 font-bold">{part}</strong> : part
                            );
                            return (
                              <p key={idx} className="text-base text-foreground leading-relaxed mb-3">
                                {formattedLine}
                              </p>
                            );
                          }
                          // Handle bullet points with emoji
                          else if (line.trim().startsWith('*')) {
                            const bulletMatch = line.match(/^\*\s*(.*?):\s*\*\*(.*?)\*\*:\s*(.+)$/);
                            if (bulletMatch) {
                              const [, emoji, title, content] = bulletMatch;
                              return (
                                <div key={idx} className="flex gap-3 items-start mb-3 p-3 bg-violet-50 dark:bg-violet-950/20 rounded-lg">
                                  <span className="text-xl flex-shrink-0">{emoji}</span>
                                  <div>
                                    <span className="font-bold text-violet-700 dark:text-violet-300">{title}:</span>
                                    <span className="text-muted-foreground ml-2">{content}</span>
                                  </div>
                                </div>
                              );
                            }
                          }
                          // Regular lines
                          else if (line.trim()) {
                            return (
                              <p key={idx} className="text-base text-foreground/90 leading-relaxed mb-2">
                                {line}
                              </p>
                            );
                          }
                          return null;
                        })}
                      </div>
                    </div>
                  </motion.div>

                  {/* Bottom Badge */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                    className="mt-3 flex items-center gap-2 text-xs text-muted-foreground flex-wrap"
                  >
                    <div className="px-3 py-1 bg-violet-100 dark:bg-violet-900/30 rounded-full flex items-center gap-1.5">
                      <Activity className="w-3 h-3 text-violet-600" />
                      <span className="font-medium">Real-time Analysis</span>
                    </div>
                    <div className="px-3 py-1 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center gap-1.5">
                      <TrendingUp className="w-3 h-3 text-purple-600" />
                      <span className="font-medium">Personalized Insights</span>
                    </div>
                  </motion.div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Additional Weather Details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="hover:shadow-lg transition-all hover:-translate-y-1 border-orange-200 dark:border-orange-800 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/20">
            <CardContent className="p-4">
              {showWeatherSkeleton ? (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-8 w-14" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ) : (
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <Sun className="w-3 h-3" /> UV Index
                  </p>
                  <p className="text-3xl font-bold text-orange-600">{uvIndex != null ? uvIndex : '--'}</p>
                  <p className="text-xs font-semibold text-orange-600 mt-1">
                    {uvIndex == null ? 'N/A' :
                     uvIndex <= 2 ? '🟢 Low' : 
                     uvIndex <= 5 ? '🟡 Moderate' :
                     uvIndex <= 7 ? '🟠 High' : '🔴 Very High'}
                  </p>
                </div>
                <div className="p-2 bg-orange-500/20 rounded-xl">
                  <Sun className="w-6 h-6 text-orange-600" />
                </div>
              </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="hover:shadow-lg transition-all hover:-translate-y-1 border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20">
            <CardContent className="p-4">
              {showWeatherSkeleton ? (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-8 w-12" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ) : (
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <CloudDrizzle className="w-3 h-3" /> Precipitation
                  </p>
                  <p className="text-3xl font-bold text-blue-600">{precipitation != null ? precipitation : '--'}</p>
                  <p className="text-xs font-semibold text-blue-600 mt-1">mm / Last hour</p>
                </div>
                <div className="p-2 bg-blue-500/20 rounded-xl">
                  <Droplets className="w-6 h-6 text-blue-600" />
                </div>
              </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="hover:shadow-lg transition-all hover:-translate-y-1 border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-fuchsia-50 dark:from-purple-950/20 dark:to-fuchsia-950/20">
            <CardContent className="p-4">
              {showWeatherSkeleton ? (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ) : (
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <Eye className="w-3 h-3" /> Visibility
                  </p>
                  <p className="text-3xl font-bold text-purple-600">{visibility != null ? visibility : '--'}</p>
                  <p className="text-xs font-semibold text-purple-600 mt-1">
                    {visibility == null ? 'N/A' :
                     visibility >= 10 ? '👁️ Clear' : 
                     visibility >= 5 ? '😶‍🌫️ Moderate' : '🌫️ Poor'} km
                  </p>
                </div>
                <div className="p-2 bg-purple-500/20 rounded-xl">
                  <Eye className="w-6 h-6 text-purple-600" />
                </div>
              </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="hover:shadow-lg transition-all hover:-translate-y-1 border-slate-200 dark:border-slate-800 bg-gradient-to-br from-slate-50 to-gray-50 dark:from-slate-950/20 dark:to-gray-950/20">
            <CardContent className="p-4">
              {showWeatherSkeleton ? (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-8 w-14" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ) : (
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <CloudFog className="w-3 h-3" /> Cloud Cover
                  </p>
                  <p className="text-3xl font-bold text-slate-600">{cloudCover != null ? cloudCover : '--'}</p>
                  <p className="text-xs font-semibold text-slate-600 mt-1">
                    {cloudCover == null ? 'N/A' :
                     cloudCover <= 25 ? '☀️ Clear' :
                     cloudCover <= 75 ? '⛅ Partly' : '☁️ Cloudy'} %
                  </p>
                </div>
                <div className="p-2 bg-slate-500/20 rounded-xl">
                  <CloudFog className="w-6 h-6 text-slate-600" />
                </div>
              </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Sun & Moon Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
        >
          <Card className="border-2 border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Sunrise className="w-5 h-5 text-amber-600" />
                  Sun Schedule
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-white/50 dark:bg-black/20 rounded-xl">
                  <Sunrise className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground mb-1">Sunrise</p>
                  {showWeatherSkeleton ? <Skeleton className="h-6 w-20 mx-auto" /> : <p className="text-xl font-bold text-amber-600">{sunriseText}</p>}
                </div>
                <div className="text-center p-4 bg-white/50 dark:bg-black/20 rounded-xl">
                  <Sunset className="w-8 h-8 text-orange-500 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground mb-1">Sunset</p>
                  {showWeatherSkeleton ? <Skeleton className="h-6 w-20 mx-auto" /> : <p className="text-xl font-bold text-orange-600">{sunsetText}</p>}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.6 }}
        >
          <Card className="border-2 border-cyan-200 dark:border-cyan-800 bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-cyan-950/20 dark:to-blue-950/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Compass className="w-5 h-5 text-cyan-600" />
                  Wind Direction
                </h3>
              </div>
              <div className="flex items-center justify-center">
                <div className="relative w-32 h-32">
                  {/* Compass Circle */}
                  <div className="absolute inset-0 border-4 border-cyan-200 dark:border-cyan-800 rounded-full"></div>
                  <div className="absolute inset-2 border-2 border-cyan-100 dark:border-cyan-900 rounded-full"></div>
                  
                  {/* Cardinal Directions */}
                  <div className="absolute top-1 left-1/2 transform -translate-x-1/2 text-xs font-bold text-cyan-600">N</div>
                  <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2 text-xs font-bold text-cyan-600">S</div>
                  <div className="absolute left-1 top-1/2 transform -translate-y-1/2 text-xs font-bold text-cyan-600">W</div>
                  <div className="absolute right-1 top-1/2 transform -translate-y-1/2 text-xs font-bold text-cyan-600">E</div>
                  
                  {/* Wind Arrow */}
                  <motion.div
                    className="absolute inset-0 flex items-center justify-center"
                    animate={{ rotate: windDirection ?? 0 }}
                    transition={{ duration: 1, ease: "easeOut" }}
                  >
                    <div className="w-1 h-12 bg-gradient-to-t from-cyan-600 to-cyan-400 rounded-full relative">
                      <div className="absolute -top-2 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-8 border-l-transparent border-r-transparent border-b-cyan-600"></div>
                    </div>
                  </motion.div>
                  
                  {/* Center Dot */}
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-cyan-600 rounded-full"></div>
                </div>
                <div className="ml-6">
                  <p className="text-sm text-muted-foreground mb-1">Direction</p>
                  {showWeatherSkeleton ? <Skeleton className="h-8 w-20 mb-1" /> : <p className="text-2xl font-bold text-cyan-600">{windDirection != null ? `${windDirection}°` : '--'}</p>}
                  <p className="text-xs text-muted-foreground mt-1">
                    {showWeatherSkeleton ? '' : windDirectionLabel}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Forecast & Graphs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="lg:col-span-2"
        >
          <Card className="border-2 border-blue-200 dark:border-blue-800 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  <CardTitle className="text-lg">Weather Metrics (24-Hour Trend)</CardTitle>
                </div>
                <Badge variant="secondary" className="text-xs">
                  <Activity className="w-3 h-3 mr-1" />
                  Live Data
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="h-[450px]" style={{ minHeight: '450px' }}>
              <ResponsiveContainer width="100%" height={450}>
                <ComposedChart data={hourlyData}>
                  <defs>
                    <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="rainGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.6} />
                      <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.2} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#94a3b8" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    stroke="#cbd5e1"
                    axisLine={false}
                  />
                  <YAxis 
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: '#3b82f6' }}
                    tickLine={false}
                    axisLine={false}
                    stroke="#3b82f6"
                    label={{ 
                      value: 'Temp (°C)', 
                      angle: -90, 
                      position: 'insideLeft',
                      style: { fill: '#3b82f6', fontSize: 12, fontWeight: 600 }
                    }}
                  />
                  <YAxis 
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11, fill: '#10b981' }}
                    tickLine={false}
                    axisLine={false}
                    stroke="#10b981"
                    label={{ 
                      value: 'Rain (mm) / Humidity (%)', 
                      angle: 90, 
                      position: 'insideRight',
                      style: { fill: '#10b981', fontSize: 12, fontWeight: 600 }
                    }}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.98)',
                      borderRadius: '12px',
                      border: '2px solid #e5e7eb',
                      padding: '12px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                    }}
                    formatter={(value, name) => {
                      if (name === 'Temperature') return [`${value}°C`, '🌡️ Temperature'];
                      if (name === 'Rain') return [`${value} mm`, '💧 Rainfall'];
                      if (name === 'Humidity') return [`${value}%`, '💨 Humidity'];
                      return [value, name];
                    }}
                  />
                  <Legend 
                    verticalAlign="top" 
                    height={40}
                    iconType="line"
                    wrapperStyle={{
                      paddingBottom: '10px',
                      fontSize: '13px',
                      fontWeight: 600
                    }}
                  />
                  
                  {/* Temperature Line with Area */}
                  <Area 
                    yAxisId="left"
                    type="monotone" 
                    dataKey="temp" 
                    stroke="#3b82f6" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#tempGradient)"
                    name="Temperature"
                    dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, strokeWidth: 2 }}
                  />
                  
                  {/* Rain Bars */}
                  <Bar 
                    yAxisId="right"
                    dataKey="rain" 
                    fill="url(#rainGradient)"
                    name="Rain"
                    radius={[8, 8, 0, 0]}
                    maxBarSize={30}
                  />
                  
                  {/* Humidity Line (Dashed) */}
                  <Line 
                    yAxisId="right"
                    type="monotone" 
                    dataKey="humidity" 
                    stroke="#10b981" 
                    strokeWidth={2.5}
                    strokeDasharray="5 5"
                    name="Humidity"
                    dot={{ fill: '#10b981', strokeWidth: 2, r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <Card className="border-2 border-indigo-200 dark:border-indigo-800 shadow-lg h-full">
            <CardHeader className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 border-b border-indigo-200 dark:border-indigo-800">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-indigo-600" />
                7-Day Forecast
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[450px] overflow-y-auto pt-4">
              <div className="space-y-3">
                {forecast.map((day, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center justify-between p-3 hover:bg-muted/50 rounded-lg transition-all hover:shadow-sm"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className={`p-2 rounded-lg ${
                      index === 0 ? 'bg-blue-500/20' : 'bg-muted'
                    }`}>
                      <day.icon className={`w-5 h-5 ${
                        index === 0 ? 'text-blue-600' : 'text-muted-foreground'
                      }`} />
                    </div>
                    <span className={`font-medium ${
                      index === 0 ? 'text-foreground' : 'text-muted-foreground'
                    } w-16`}>{day.day}</span>
                    <span className="text-xs text-muted-foreground flex-1 text-left">{day.status}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">{day.temp}</span>
                    <span className="text-sm text-muted-foreground">{day.tempLow}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
        </motion.div>
      </div>
    </div>
  );
};

export default Weather;
