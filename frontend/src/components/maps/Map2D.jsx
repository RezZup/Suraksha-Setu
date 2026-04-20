import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const FLATICON_ICONS = {
  hospital: 'https://cdn-icons-png.flaticon.com/512/3448/3448513.png',
  police: 'https://cdn-icons-png.flaticon.com/512/1022/1022331.png',
  fire_station: 'https://cdn-icons-png.flaticon.com/512/599/599502.png',
  disaster_management_center: 'https://cdn-icons-png.flaticon.com/512/1256/1256650.png',
  emergency_center: 'https://cdn-icons-png.flaticon.com/512/2776/2776000.png',
  help_center: 'https://cdn-icons-png.flaticon.com/512/869/869869.png',
  heavy_rain: 'https://cdn-icons-png.flaticon.com/512/2840/2840269.png',
  flood: 'https://cdn-icons-png.flaticon.com/512/483/483361.png',
  tsunami: 'https://cdn-icons-png.flaticon.com/512/2204/2204346.png',
  volcano: 'https://cdn-icons-png.flaticon.com/512/2204/2204304.png',
  heatwave: 'https://cdn-icons-png.flaticon.com/512/3480/3480417.png',
  fire: 'https://cdn-icons-png.flaticon.com/512/1695/1695213.png',
  cyclone: 'https://cdn-icons-png.flaticon.com/512/3105/3105807.png',
  earthquake: 'https://cdn-icons-png.flaticon.com/512/1684/1684375.png',
  landslide: 'https://cdn-icons-png.flaticon.com/512/4820/4820785.png',
  drought: 'https://cdn-icons-png.flaticon.com/512/1146/1146869.png',
  other: 'https://cdn-icons-png.flaticon.com/512/1146/1146860.png',
  alert_critical: 'https://cdn-icons-png.flaticon.com/512/2776/2776067.png',
  alert_warning: 'https://cdn-icons-png.flaticon.com/512/1256/1256650.png',
  alert_info: 'https://cdn-icons-png.flaticon.com/512/3448/3448513.png',
};

const ALERT_ICON_CACHE = new Map();
const DISASTER_ICON_CACHE = new Map();
const SERVICE_ICON_CACHE = new Map();

function useProgressiveMarkers(items, batchSize = 250) {
  const safeItems = Array.isArray(items) ? items : [];
  const [visibleCount, setVisibleCount] = useState(() => Math.min(batchSize, safeItems.length));

  useEffect(() => {
    const total = safeItems.length;
    let active = true;
    let timeoutHandle = null;
    let frameHandle = null;

    setVisibleCount(Math.min(batchSize, total));

    if (total <= batchSize) {
      return () => {
        active = false;
      };
    }

    const scheduleNext = () => {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        frameHandle = window.requestAnimationFrame(step);
      } else {
        timeoutHandle = setTimeout(step, 16);
      }
    };

    const step = () => {
      if (!active) return;

      setVisibleCount((prev) => {
        if (prev >= total) return prev;
        const next = Math.min(prev + batchSize, total);
        if (next < total) {
          scheduleNext();
        }
        return next;
      });
    };

    scheduleNext();

    return () => {
      active = false;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      if (frameHandle !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frameHandle);
      }
    };
  }, [safeItems, batchSize]);

  return safeItems.slice(0, visibleCount);
}

const createFlaticonPin = ({
  iconUrl,
  fallbackLabel,
  background,
  ringColor,
  size = 32,
  pinShape = false,
}) => {
  const wrapperStyle = pinShape
    ? `
      width:${size}px;
      height:${size}px;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      border:2px solid white;
      background:${background};
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
      display:flex;
      align-items:center;
      justify-content:center;
    `
    : `
      width:${size}px;
      height:${size}px;
      border-radius:50%;
      border:2px solid white;
      background:${background};
      box-shadow:0 0 0 3px ${ringColor}55, 0 2px 8px rgba(0,0,0,0.35);
      display:flex;
      align-items:center;
      justify-content:center;
    `;

  const innerStyle = pinShape ? 'transform:rotate(45deg);' : '';

  return L.divIcon({
    className: pinShape ? 'custom-service-marker' : 'custom-flaticon-marker',
    html: `
      <div style="${wrapperStyle}">
        <div style="${innerStyle} display:flex; align-items:center; justify-content:center; width:${Math.round(size * 0.6)}px; height:${Math.round(size * 0.6)}px;">
          <img src="${iconUrl}" alt="" style="width:${Math.round(size * 0.52)}px;height:${Math.round(size * 0.52)}px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';" />
          <span style="display:none; align-items:center; justify-content:center; color:white; font-size:${Math.max(10, Math.round(size * 0.3))}px; font-weight:700;">${fallbackLabel}</span>
        </div>
      </div>
    `,
    iconSize: pinShape ? [size, size + 10] : [size, size],
    iconAnchor: pinShape ? [Math.round(size / 2), size] : [Math.round(size / 2), Math.round(size / 2)],
    popupAnchor: pinShape ? [0, -Math.round(size * 0.8)] : [0, -Math.round(size * 0.6)],
  });
};

// AQI Heat Map Layer Component
function AQIHeatMap({ stations }) {
  const map = useMap();

  useEffect(() => {
    if (!stations || stations.length === 0) return;

    // Create canvas overlay for heat map effect
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    const bounds = map.getBounds();
    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '400';
    
    // Draw heat circles for each station
    stations.forEach(station => {
      if (!station.lat || !station.lon) return;
      
      const point = map.latLngToContainerPoint([station.lat, station.lon]);
      const aqi = station.aqi || 0;
      
      // Determine color based on AQI
      let color;
      if (aqi <= 50) color = 'rgba(0, 228, 0, 0.4)';
      else if (aqi <= 100) color = 'rgba(255, 255, 0, 0.4)';
      else if (aqi <= 150) color = 'rgba(255, 126, 0, 0.4)';
      else if (aqi <= 200) color = 'rgba(255, 0, 0, 0.4)';
      else if (aqi <= 300) color = 'rgba(143, 63, 151, 0.4)';
      else color = 'rgba(126, 0, 35, 0.4)';
      
      // Draw gradient circle
      const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 50);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 50, 0, Math.PI * 2);
      ctx.fill();
    });
    
    // Add canvas to map pane
    const mapPane = map.getPane('overlayPane');
    mapPane.appendChild(canvas);
    
    // Cleanup on unmount or stations change
    return () => {
      if (mapPane.contains(canvas)) {
        mapPane.removeChild(canvas);
      }
    };
  }, [stations, map]);

  return null;
}

// Disaster Density Heatmap Layer
function DisasterHeatmap({ disasters }) {
  const map = useMap();

  useEffect(() => {
    if (!disasters || disasters.length === 0) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '399';

    const severityWeight = { extreme: 1.0, high: 0.75, moderate: 0.5, low: 0.25 };

    disasters.forEach(d => {
      if (!d.lat || !d.lon) return;
      const point = map.latLngToContainerPoint([d.lat, d.lon]);
      const weight = severityWeight[d.severity] ?? 0.3;
      const radius = 60;

      const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
      gradient.addColorStop(0, `rgba(239,68,68,${0.55 * weight})`);
      gradient.addColorStop(0.4, `rgba(249,115,22,${0.35 * weight})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });

    const pane = map.getPane('overlayPane');
    pane.appendChild(canvas);
    return () => { if (pane.contains(canvas)) pane.removeChild(canvas); };
  }, [disasters, map]);

  return null;
}

// Fix Leaflet default marker icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom AQI Marker Icon
const createAQIIcon = (aqi, category) => {
  let color = '#00e400';
  if (aqi > 300) color = '#7e0023';
  else if (aqi > 200) color = '#8f3f97';
  else if (aqi > 150) color = '#ff0000';
  else if (aqi > 100) color = '#ff7e00';
  else if (aqi > 50) color = '#ffff00';

  return L.divIcon({
    className: 'custom-aqi-marker',
    html: `<div style="
      background-color: ${color};
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: 3px solid white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 11px;
      color: ${aqi > 100 ? 'white' : 'black'};
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    ">${aqi}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
};

// Custom alert marker icon
const createAlertIcon = (alert) => {
  const severity = String(alert?.severity || '').toLowerCase();
  const isCritical = severity === 'critical' || severity === 'red' || severity === 'high';
  const isWarning = severity === 'warning' || severity === 'orange' || severity === 'moderate';
  const iconKey = isCritical ? 'alert_critical' : isWarning ? 'alert_warning' : 'alert_info';
  const ringColor = isCritical ? '#DC2626' : isWarning ? '#F59E0B' : '#2563EB';
  const bg = isCritical ? '#EF4444' : isWarning ? '#F59E0B' : '#3B82F6';

  const cacheKey = `${iconKey}:${ringColor}:${bg}`;
  const cached = ALERT_ICON_CACHE.get(cacheKey);
  if (cached) return cached;

  const icon = createFlaticonPin({
    iconUrl: FLATICON_ICONS[iconKey],
    fallbackLabel: '!',
    background: bg,
    ringColor,
    size: 32,
    pinShape: false,
  });
  ALERT_ICON_CACHE.set(cacheKey, icon);
  return icon;
};

const DISASTER_ICON_META = {
  heavy_rain: { label: 'RN', color: '#2563EB', iconKey: 'heavy_rain' },
  flood: { label: 'FL', color: '#1D4ED8', iconKey: 'flood' },
  tsunami: { label: 'TS', color: '#0EA5E9', iconKey: 'tsunami' },
  volcano: { label: 'VO', color: '#B45309', iconKey: 'volcano' },
  heatwave: { label: 'HW', color: '#DC2626', iconKey: 'heatwave' },
  fire: { label: 'FR', color: '#EA580C', iconKey: 'fire' },
  earthquake: { label: 'EQ', color: '#A855F7', iconKey: 'earthquake' },
  cyclone: { label: 'CY', color: '#7C3AED', iconKey: 'cyclone' },
  landslide: { label: 'LS', color: '#92400E', iconKey: 'landslide' },
  drought: { label: 'DR', color: '#CA8A04', iconKey: 'drought' },
  other: { label: 'AL', color: '#0F766E', iconKey: 'other' },
};

const normalizeDisasterType = (rawType = '') => {
  const t = String(rawType || '').toLowerCase();
  if (t.includes('heavy_rain') || t.includes('heavy rain') || t.includes('rainfall') || t.includes('cloudburst')) return 'heavy_rain';
  if (t.includes('flood')) return 'flood';
  if (t.includes('tsunami')) return 'tsunami';
  if (t.includes('volcano') || t.includes('volcanic')) return 'volcano';
  if (t.includes('heatwave') || t.includes('heat wave') || t.includes('extreme heat')) return 'heatwave';
  if (t.includes('fire') || t.includes('wildfire') || t.includes('forest_fire')) return 'fire';
  if (t.includes('earthquake') || t.includes('seismic')) return 'earthquake';
  if (t.includes('cyclone') || t.includes('storm') || t.includes('hurricane') || t.includes('typhoon')) return 'cyclone';
  if (t.includes('landslide')) return 'landslide';
  if (t.includes('drought')) return 'drought';
  return 'other';
};

const createDisasterIcon = (severity = 'low', type = 'disaster') => {
  const normalized = normalizeDisasterType(type);
  const meta = DISASTER_ICON_META[normalized] || DISASTER_ICON_META.other;
  const severityRing = severity === 'extreme' || severity === 'high' ? '#DC2626'
    : severity === 'moderate' ? '#EA580C'
    : '#1D4ED8';

  const cacheKey = `${normalized}:${severityRing}:${meta.color}`;
  const cached = DISASTER_ICON_CACHE.get(cacheKey);
  if (cached) return cached;

  const icon = createFlaticonPin({
    iconUrl: FLATICON_ICONS[meta.iconKey],
    fallbackLabel: meta.label,
    background: meta.color,
    ringColor: severityRing,
    size: 34,
    pinShape: false,
  });
  DISASTER_ICON_CACHE.set(cacheKey, icon);
  return icon;
};

const SERVICE_ICON_META = {
  hospital: { label: 'H', color: '#DC2626', iconKey: 'hospital' },
  police: { label: 'P', color: '#1D4ED8', iconKey: 'police' },
  fire_station: { label: 'F', color: '#EA580C', iconKey: 'fire_station' },
  disaster_management_center: { label: 'DM', color: '#7C3AED', iconKey: 'disaster_management_center' },
  emergency_center: { label: 'E', color: '#0EA5E9', iconKey: 'emergency_center' },
  help_center: { label: '?', color: '#16A34A', iconKey: 'help_center' },
};

const createEmergencyServiceIcon = (serviceType = 'help_center') => {
  const meta = SERVICE_ICON_META[serviceType] || SERVICE_ICON_META.help_center;
  const cached = SERVICE_ICON_CACHE.get(serviceType);
  if (cached) return cached;

  const icon = createFlaticonPin({
    iconUrl: FLATICON_ICONS[meta.iconKey],
    fallbackLabel: meta.label,
    background: meta.color,
    ringColor: meta.color,
    size: 32,
    pinShape: true,
  });
  SERVICE_ICON_CACHE.set(serviceType, icon);
  return icon;
};

// Component to recenter map
function MapRecenter({ center, searchRadius }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      const zoom = searchRadius ? 12 : 6;
      map.setView(center, zoom);
    }
  }, [center, searchRadius, map]);
  return null;
}

function MapInteractionSync({ onMapMoved }) {
  useMapEvents({
    moveend: (event) => {
      if (!onMapMoved) return;
      const c = event.target.getCenter();
      onMapMoved([c.lat, c.lng]);
    },
  });
  return null;
}

const Map2D = ({ center, aqiStations, cycloneTrack, rainfallData, showLayers, searchRadius, alerts, disasters, emergencyServices, onMapMoved }) => {
  const [mapCenter, setMapCenter] = useState(center || [20.5937, 78.9629]); // Default: India

  const validAlerts = useMemo(() => (
    (alerts || [])
      .map((alert) => {
        const lat = Number(alert.coordinates?.lat ?? alert.position?.lat ?? alert.lat);
        const lon = Number(alert.coordinates?.lon ?? alert.coordinates?.lng ?? alert.position?.lng ?? alert.position?.lon ?? alert.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return { ...alert, __lat: lat, __lon: lon };
      })
      .filter(Boolean)
  ), [alerts]);

  const validDisasters = useMemo(() => (
    (disasters || [])
      .map((item) => {
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return { ...item, __lat: lat, __lon: lon };
      })
      .filter(Boolean)
  ), [disasters]);

  const validEmergencyServices = useMemo(() => (
    (emergencyServices || [])
      .map((service) => {
        const lat = Number(service.lat);
        const lon = Number(service.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return { ...service, __lat: lat, __lon: lon };
      })
      .filter(Boolean)
  ), [emergencyServices]);

  const renderedAlerts = useProgressiveMarkers(validAlerts, 250);
  const renderedDisasters = useProgressiveMarkers(validDisasters, 250);
  const renderedEmergencyServices = useProgressiveMarkers(validEmergencyServices, 250);

  useEffect(() => {
    if (center) {
      setMapCenter(center);
    }
  }, [center]);

  return (
    <MapContainer
      center={mapCenter}
      zoom={6}
      style={{ height: '100%', width: '100%' }}
      className="rounded-lg"
    >
      <MapRecenter center={mapCenter} searchRadius={searchRadius} />
      <MapInteractionSync onMapMoved={onMapMoved} />
      
      {/* Base Map Layer */}
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />

      {/* Center Location Marker */}
      {center && (
        <Marker position={center}>
          <Popup>
            <div className="text-sm">
              <strong>Selected Location</strong>
              <br />
              Lat: {center[0].toFixed(4)}
              <br />
              Lon: {center[1].toFixed(4)}
            </div>
          </Popup>
        </Marker>
      )}

      {/* Disaster Density Heatmap */}
      {showLayers?.disasterHeatmap && disasters && disasters.length > 0 && (
        <DisasterHeatmap disasters={disasters} />
      )}

      {/* AQI Heat Map Overlay */}
      {showLayers?.aqiHeatMap && aqiStations && aqiStations.length > 0 && (
        <AQIHeatMap stations={aqiStations} />
      )}

      {/* AQI Station Markers */}
      {showLayers?.aqi && aqiStations && aqiStations.length > 0 && aqiStations.map((station, index) => (
        station.lat && station.lon && (
          <Marker
            key={`aqi-${index}`}
            position={[station.lat, station.lon]}
            icon={createAQIIcon(station.aqi, station.category)}
          >
            <Popup>
              <div className="text-sm">
                <strong>{station.name}</strong>
                <br />
                AQI: <span style={{ color: station.color, fontWeight: 'bold' }}>{station.aqi}</span>
                <br />
                Category: {station.category}
                {station.pollutants && (
                  <>
                    <br />
                    <br />
                    <strong>Pollutants:</strong>
                    {station.pollutants.pm25 && <><br />PM2.5: {station.pollutants.pm25.toFixed(1)} µg/m³</>}
                    {station.pollutants.pm10 && <><br />PM10: {station.pollutants.pm10.toFixed(1)} µg/m³</>}
                  </>
                )}
              </div>
            </Popup>
          </Marker>
        )
      ))}

      {/* Rainfall Zones (circles) */}
      {showLayers?.rainfall && rainfallData && rainfallData.length > 0 && rainfallData.map((zone, index) => {
        const intensity = zone.intensity || 0;
        const amount = zone.amount || 0;
        const radius = Math.max(intensity * 5000, 1000); // Minimum 1km radius
        
        return zone.lat && zone.lon && !isNaN(zone.lat) && !isNaN(zone.lon) && !isNaN(radius) ? (
          <Circle
            key={`rain-${index}`}
            center={[zone.lat, zone.lon]}
            radius={radius}
            pathOptions={{
              color: 'blue',
              fillColor: '#3b82f6',
              fillOpacity: Math.min(0.3 * (intensity / 100), 0.5),
            }}
          >
            <Popup>
              <div className="text-sm">
                <strong>Rainfall Zone</strong>
                <br />
                Intensity: {intensity}%
                <br />
                Amount: {amount}mm
              </div>
            </Popup>
          </Circle>
        ) : null;
      })}

      {/* Cyclone Track Path */}
      {showLayers?.cyclone && cycloneTrack && cycloneTrack.length > 0 && (
        <>
          <Polyline
            positions={cycloneTrack.filter(point => point.lat && point.lon && !isNaN(point.lat) && !isNaN(point.lon)).map(point => [point.lat, point.lon])}
            pathOptions={{
              color: '#dc2626',
              weight: 3,
              dashArray: '10, 10',
            }}
          />
          {cycloneTrack.map((point, index) => {
            const intensity = point.intensity || 50;
            const radius = Math.max(intensity * 1000, 5000); // Minimum 5km radius
            
            return point.lat && point.lon && !isNaN(point.lat) && !isNaN(point.lon) && !isNaN(radius) ? (
              <Circle
                key={`cyclone-${index}`}
                center={[point.lat, point.lon]}
                radius={radius}
                pathOptions={{
                  color: '#dc2626',
                  fillColor: '#ef4444',
                  fillOpacity: 0.3,
                }}
              >
                <Popup>
                  <div className="text-sm">
                    <strong>Cyclone Position</strong>
                    <br />
                    Time: {point.time || 'Unknown'}
                    <br />
                    Intensity: {intensity}
                    <br />
                    Wind Speed: {point.wind_speed || 'N/A'} km/h
                  </div>
                </Popup>
              </Circle>
            ) : null;
          })}
        </>
      )}

      {/* 10km Search Radius Circle */}
      {searchRadius && center && (
        <Circle
          center={center}
          radius={searchRadius}
          pathOptions={{
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.06,
            weight: 2,
            dashArray: '8, 4',
          }}
        >
          <Popup>
            <div className="text-sm">
              <strong>Search Area</strong>
              <br />
              Radius: {(searchRadius / 1000).toFixed(0)} km
            </div>
          </Popup>
        </Circle>
      )}

      {/* Alert Markers */}
      {renderedAlerts.length > 0 && renderedAlerts.map((alert, index) => {
        return (
          <Marker key={`alert-${alert.id || alert.__mapKey || index}`} position={[alert.__lat, alert.__lon]} icon={createAlertIcon(alert)} zIndexOffset={900}>
            <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
              <div className="text-xs">
                <div><strong>{alert.title || alert.type || 'Alert'}</strong></div>
                {alert.severity && <div>Severity: {String(alert.severity).toUpperCase()}</div>}
              </div>
            </Tooltip>
            <Popup>
              <div className="text-sm">
                <strong>{alert.title || alert.type || 'Alert'}</strong>
                <br />
                {alert.severity && <><span style={{color: alert.severity === 'critical' ? '#EF4444' : '#F59E0B', fontWeight: 'bold'}}>{alert.severity}</span><br/></>}
                {alert.description || alert.location || ''}
              </div>
            </Popup>
          </Marker>
        );
      })}

      {/* Disaster Markers */}
      {renderedDisasters.length > 0 && renderedDisasters.map((d, index) => {
        return (
          <Marker
            key={`disaster-${d.id || index}`}
            position={[d.__lat, d.__lon]}
            icon={createDisasterIcon(d.severity, d.type)}
            zIndexOffset={700}
          >
            <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
              <div className="text-xs">
                <div><strong>{d.title || d.type || 'Disaster'}</strong></div>
                {d.type && <div>Type: {d.type}</div>}
                {d.severity && <div>Severity: {d.severity}</div>}
              </div>
            </Tooltip>
            <Popup>
              <div className="text-sm">
                <strong>{d.title || d.type || 'Disaster'}</strong>
                <br />
                {d.type && <><span><strong>Type:</strong> {d.type}</span><br /></>}
                {d.severity && <><span><strong>Severity:</strong> {d.severity}</span><br /></>}
                {d.location && <><span><strong>Location:</strong> {d.location}</span><br /></>}
                {d.date && <><span><strong>Date:</strong> {d.date}</span><br /></>}
                {d.description || ''}
              </div>
            </Popup>
          </Marker>
        );
      })}

      {/* Emergency Services Markers */}
      {showLayers?.emergencyServices && renderedEmergencyServices.length > 0 && renderedEmergencyServices.map((s, index) => {
        return (
          <Marker
            key={`service-${s.id || index}`}
            position={[s.__lat, s.__lon]}
            icon={createEmergencyServiceIcon(s.service_type)}
            zIndexOffset={600}
          >
            <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
              <div className="text-xs">
                <div><strong>{s.name || 'Emergency Service'}</strong></div>
                <div>{String(s.service_type || 'help_center').replace(/_/g, ' ')}</div>
              </div>
            </Tooltip>
            <Popup>
              <div className="text-sm">
                <strong>{s.name || 'Emergency Service'}</strong>
                <br />
                <span><strong>Type:</strong> {String(s.service_type || 'help_center').replace(/_/g, ' ')}</span>
                <br />
                {typeof s.distance_km === 'number' && (
                  <>
                    <span><strong>Distance:</strong> {s.distance_km.toFixed(2)} km</span>
                    <br />
                  </>
                )}
                {s.address && <><span><strong>Address:</strong> {s.address}</span><br /></>}
                {s.source && <span><strong>Source:</strong> {s.source}</span>}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
};

export default Map2D;
