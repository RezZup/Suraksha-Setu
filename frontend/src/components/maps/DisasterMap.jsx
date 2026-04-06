import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleMap, useJsApiLoader, Marker, InfoWindow, Polygon } from '@react-google-maps/api';
import { MapPin, AlertTriangle, Home, Navigation, Layers, X, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useLocation } from '@/contexts/LocationContext';
import { toast } from 'sonner';
import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const GOOGLE_MAPS_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY_HERE';

// Move libraries outside component to prevent re-renders
const GOOGLE_MAPS_LIBRARIES = ['places', 'marker'];

const mapContainerStyle = {
  width: '100%',
  height: '600px',
};

const defaultCenter = {
  lat: 20.5937, // India center
  lng: 78.9629,
};

const mapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: true,
  fullscreenControl: true,
  mapId: 'SURAKSHA_SETU_MAP', // Required for AdvancedMarkerElement
};

// Helper function to create marker icons
const createMarkerIcon = (type, data) => {
  switch (type) {
    case 'user':
      return {
        path: window.google?.maps?.SymbolPath?.CIRCLE || 0,
        fillColor: '#3B82F6',
        fillOpacity: 1,
        strokeColor: '#FFFFFF',
        strokeWeight: 3,
        scale: 10,
      };

    case 'alert':
      const color = data?.severity === 'critical' || data?.severity === 'red' ? '#EF4444' :
                    data?.severity === 'warning' || data?.severity === 'orange' ? '#F59E0B' :
                    data?.severity === 'info' || data?.severity === 'yellow' ? '#EAB308' : '#3B82F6';
      return {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="18" fill="${color}" stroke="white" stroke-width="3"/>
            <text x="20" y="28" font-size="24" text-anchor="middle" fill="white" font-weight="bold">!</text>
          </svg>
        `)}`,
        scaledSize: new window.google.maps.Size(40, 40),
      };

    case 'evacuation':
      return {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="18" fill="#10B981" stroke="white" stroke-width="3"/>
            <text x="20" y="27" font-size="18" text-anchor="middle">🏠</text>
          </svg>
        `)}`,
        scaledSize: new window.google.maps.Size(40, 40),
      };

    default:
      return null;
  }
};

const DisasterMap = () => {
  const { location } = useLocation();
  const [map, setMap] = useState(null);
  const [center, setCenter] = useState(defaultCenter);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [evacuationCenters, setEvacuationCenters] = useState([]);
  const [floodZones, setFloodZones] = useState([]);
  const [showAlerts, setShowAlerts] = useState(true);
  const [showEvacuationCenters, setShowEvacuationCenters] = useState(true);
  const [showFloodZones, setShowFloodZones] = useState(true);
  const [userLocation, setUserLocation] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  // Update center when user location changes
  useEffect(() => {
    if (location?.latitude && location?.longitude) {
      setCenter({
        lat: location.latitude,
        lng: location.longitude,
      });
      setUserLocation({
        lat: location.latitude,
        lng: location.longitude,
      });
    }
  }, [location]);

  // Fetch disaster data
  useEffect(() => {
    fetchDisasterData();
  }, []);

  const fetchDisasterData = async () => {
    setIsRefreshing(true);
    try {
      // Fetch alerts
      const alertsRes = await axios.get(`${API_URL}/api/alerts`);
      const alertsPayload = alertsRes.data?.alerts || alertsRes.data || [];
      const alertsData = (Array.isArray(alertsPayload) ? alertsPayload : [])
        .map((alert) => {
          const coords = alert.coordinates || alert.location_data || alert.location || {};
          const lat = coords?.lat ?? coords?.latitude;
          const lng = coords?.lon ?? coords?.lng ?? coords?.longitude;
          return {
            ...alert,
            position: lat != null && lng != null
              ? { lat: Number(lat), lng: Number(lng) }
              : null,
          };
        })
        .filter((alert) => alert.position);
      
      setAlerts(alertsData);

      // Fetch evacuation centers from API
      try {
        const evacuationRes = await axios.get(`${API_URL}/api/evacuation-centers`);
        if (Array.isArray(evacuationRes.data)) {
          setEvacuationCenters(evacuationRes.data.map(center => ({
            ...center,
            position: { 
              lat: center.coordinates.lat, 
              lng: center.coordinates.lon || center.coordinates.lng
            },
          })));
        }
      } catch (error) {
        console.error('Error fetching evacuation centers:', error);
        // Use fallback data
        setEvacuationCenters([
          {
            id: 'evac_1',
            name: 'Government School Shelter',
            type: 'School',
            capacity: 500,
            current_occupancy: 120,
            facilities: ['Medical Aid', 'Food', 'Water'],
            contact: '+91-XXXXXXXXXX',
            position: { lat: 28.6139, lng: 77.2090 },
          },
        ]);
      }

      // Fetch flood zones (will use fallback if API not available)
      try {
        const floodRes = await axios.get(`${API_URL}/api/flood-zones`);
        if (Array.isArray(floodRes.data)) {
          setFloodZones(floodRes.data.map(zone => ({
            ...zone,
            paths: zone.coordinates.map(coord => ({
              lat: coord[0],
              lng: coord[1]
            }))
          })));
        }
      } catch (error) {
        console.error('Error fetching flood zones:', error);
        // Set empty array as fallback
        setFloodZones([]);
      }
      
      toast.success('Map data refreshed');
    } catch (error) {
      console.error('Error fetching disaster data:', error);
      toast.error('Failed to fetch disaster data');
      // Use fallback data for alerts
      setAlerts([
        {
          id: 'alert_1',
          title: 'Cyclone Warning',
          severity: 'critical',
          description: 'Severe cyclone expected in coastal areas',
          position: { lat: 17.6868, lng: 83.2185 },
        },
        {
          id: 'alert_2',
          title: 'Flood Risk',
          severity: 'warning',
          description: 'Heavy rainfall may cause flooding',
          position: { lat: 26.8467, lng: 80.9462 },
        },
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const onLoad = useCallback((map) => {
    setMap(map);
  }, []);

  const onUnmount = useCallback(() => {
    setMap(null);
  }, []);

  const handleMyLocation = () => {
    if (userLocation) {
      setCenter(userLocation);
      map?.panTo(userLocation);
      map?.setZoom(12);
      toast.success('Centered on your location');
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const pos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setUserLocation(pos);
          setCenter(pos);
          map?.panTo(pos);
          map?.setZoom(12);
          toast.success('Location found');
        },
        () => {
          toast.error('Unable to get your location');
        }
      );
    } else {
      toast.error('Geolocation not supported');
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
      case 'red':
        return '#EF4444';
      case 'warning':
      case 'orange':
        return '#F59E0B';
      case 'info':
      case 'yellow':
        return '#EAB308';
      default:
        return '#3B82F6';
    }
  };

  if (loadError) {
    return (
      <Card className="p-6">
        <div className="text-center text-red-600">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4" />
          <p className="font-semibold">Error loading maps</p>
          <p className="text-sm mt-2">Please check your Google Maps API key configuration</p>
        </div>
      </Card>
    );
  }

  if (!isLoaded) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center h-[600px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-sm text-muted-foreground">Loading map...</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Map Controls */}
      <Card className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900 border-2 shadow-lg">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg shadow-md">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-lg">Interactive Disaster Map</h3>
              <p className="text-xs text-muted-foreground">Toggle layers and navigate</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={showAlerts ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowAlerts(!showAlerts)}
              className="gap-2 transition-all hover:scale-105 shadow-md"
            >
              <AlertTriangle className="w-4 h-4" />
              Alerts ({alerts.length})
            </Button>
            <Button
              variant={showEvacuationCenters ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowEvacuationCenters(!showEvacuationCenters)}
              className="gap-2 transition-all hover:scale-105 shadow-md"
            >
              <Home className="w-4 h-4" />
              Shelters ({evacuationCenters.length})
            </Button>
            <Button
              variant={showFloodZones ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowFloodZones(!showFloodZones)}
              className="gap-2 transition-all hover:scale-105 shadow-md"
            >
              <Layers className="w-4 h-4" />
              Flood Zones ({floodZones.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleMyLocation}
              className="gap-2 transition-all hover:scale-105 shadow-md hover:bg-blue-50"
            >
              <Navigation className="w-4 h-4" />
              My Location
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchDisasterData}
              disabled={isRefreshing}
              className="gap-2 transition-all hover:scale-105 shadow-md hover:bg-green-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {/* Map */}
      <Card className="overflow-hidden shadow-xl border-2 rounded-xl">
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={center}
          zoom={6}
          onLoad={onLoad}
          onUnmount={onUnmount}
          options={mapOptions}
        >
          {/* User Location Marker */}
          {userLocation && (
            <Marker
              position={userLocation}
              icon={createMarkerIcon('user')}
              title="Your Location"
              onClick={() => setSelectedMarker({ type: 'user', data: { title: 'Your Location' } })}
            />
          )}

          {/* Alert Markers */}
          {showAlerts && alerts.map((alert) => (
            <Marker
              key={alert.id}
              position={alert.position}
              icon={createMarkerIcon('alert', alert)}
              title={alert.title}
              onClick={() => setSelectedMarker({ type: 'alert', data: alert })}
            />
          ))}

          {/* Evacuation Center Markers */}
          {showEvacuationCenters && evacuationCenters.map((center) => (
            <Marker
              key={center.id}
              position={center.position}
              icon={createMarkerIcon('evacuation', center)}
              title={center.name}
              onClick={() => setSelectedMarker({ type: 'evacuation', data: center })}
            />
          ))}

          {/* Flood Zone Polygons */}
          {showFloodZones && floodZones.map((zone) => (
            <Polygon
              key={zone.id}
              paths={zone.paths}
              options={{
                fillColor: zone.risk_level === 'High' ? '#EF4444' : zone.risk_level === 'Moderate' ? '#F59E0B' : '#3B82F6',
                fillOpacity: 0.25,
                strokeColor: zone.risk_level === 'High' ? '#DC2626' : zone.risk_level === 'Moderate' ? '#D97706' : '#2563EB',
                strokeOpacity: 0.8,
                strokeWeight: 2,
              }}
              onClick={() => setSelectedMarker({ type: 'flood', data: zone })}
            />
          ))}

          {/* Info Window */}
          {selectedMarker && (
            <InfoWindow
              position={selectedMarker.type === 'flood' 
                ? { lat: selectedMarker.data.coordinates[0][0], lng: selectedMarker.data.coordinates[0][1] }
                : selectedMarker.type === 'user'
                ? userLocation
                : selectedMarker.data.position
              }
              onCloseClick={() => setSelectedMarker(null)}
            >
              <div className="p-2 max-w-xs">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-semibold text-sm">
                    {selectedMarker.type === 'alert' && selectedMarker.data.title}
                    {selectedMarker.type === 'evacuation' && selectedMarker.data.name}
                    {selectedMarker.type === 'flood' && `${selectedMarker.data.river} River - ${selectedMarker.data.location}`}
                    {selectedMarker.type === 'user' && 'Your Location'}
                  </h4>
                  {selectedMarker.type === 'alert' && (
                    <Badge 
                      variant={selectedMarker.data.severity === 'critical' ? 'destructive' : 'default'}
                      className="ml-2"
                    >
                      {selectedMarker.data.severity}
                    </Badge>
                  )}
                  {selectedMarker.type === 'flood' && (
                    <Badge 
                      variant={selectedMarker.data.risk_level === 'High' ? 'destructive' : selectedMarker.data.risk_level === 'Moderate' ? 'default' : 'secondary'}
                      className="ml-2"
                    >
                      {selectedMarker.data.risk_level}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-gray-600">
                  {selectedMarker.type === 'alert' && selectedMarker.data.description}
                  {selectedMarker.type === 'evacuation' && (
                    <>
                      <div><strong>Type:</strong> {selectedMarker.data.type}</div>
                      <div><strong>Capacity:</strong> {selectedMarker.data.capacity} ({selectedMarker.data.current_occupancy} occupied)</div>
                      <div><strong>Facilities:</strong> {selectedMarker.data.facilities?.join(', ')}</div>
                      <div><strong>Contact:</strong> {selectedMarker.data.contact}</div>
                    </>
                  )}
                  {selectedMarker.type === 'flood' && (
                    <>
                      <div><strong>Water Level:</strong> {selectedMarker.data.current_water_level}m (danger: {selectedMarker.data.danger_level}m)</div>
                      <div><strong>Trend:</strong> {selectedMarker.data.trend}</div>
                      <div><strong>At Risk:</strong> {selectedMarker.data.population_at_risk?.toLocaleString()} people</div>
                      <div><strong>Villages:</strong> {selectedMarker.data.affected_villages?.join(', ')}</div>
                    </>
                  )}
                  {selectedMarker.type === 'user' && `Coordinates: ${userLocation?.lat.toFixed(4)}, ${userLocation?.lng.toFixed(4)}`}
                </p>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </Card>

      {/* Legend */}
      <Card className="p-5 bg-gradient-to-br from-gray-50 to-blue-50 dark:from-gray-800 dark:to-gray-900 border-2 shadow-lg">
        <h3 className="font-bold mb-4 text-lg flex items-center gap-2">
          <div className="w-1 h-6 bg-gradient-to-b from-blue-600 to-purple-600 rounded"></div>
          Map Legend
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white dark:hover:bg-gray-700 transition-all cursor-pointer group">
            <div className="w-6 h-6 rounded-full bg-red-500 shadow-lg group-hover:scale-110 transition-transform flex items-center justify-center">
              <span className="text-white text-xs font-bold">!</span>
            </div>
            <div>
              <div className="font-semibold">Critical Alert</div>
              <div className="text-xs text-muted-foreground">Immediate action</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white dark:hover:bg-gray-700 transition-all cursor-pointer group">
            <div className="w-6 h-6 rounded-full bg-orange-500 shadow-lg group-hover:scale-110 transition-transform flex items-center justify-center">
              <span className="text-white text-xs font-bold">!</span>
            </div>
            <div>
              <div className="font-semibold">Warning</div>
              <div className="text-xs text-muted-foreground">Stay alert</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white dark:hover:bg-gray-700 transition-all cursor-pointer group">
            <div className="w-6 h-6 rounded-full bg-green-500 shadow-lg group-hover:scale-110 transition-transform flex items-center justify-center">
              <Home className="w-3 h-3 text-white" />
            </div>
            <div>
              <div className="font-semibold">Evacuation Center</div>
              <div className="text-xs text-muted-foreground">Safe shelter</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white dark:hover:bg-gray-700 transition-all cursor-pointer group">
            <div className="w-6 h-6 rounded-full bg-blue-500 shadow-lg group-hover:scale-110 transition-transform flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-white"></div>
            </div>
            <div>
              <div className="font-semibold">Your Location</div>
              <div className="text-xs text-muted-foreground">Current position</div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default DisasterMap;
