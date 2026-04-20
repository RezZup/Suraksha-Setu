import React, { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ─── Post type config ──────────────────────────────────────────────────────────
const TYPE_CONFIG = {
  emergency: { color: '#ef4444', bg: '#fef2f2', label: 'Emergency', emoji: '🆘', pulse: true  },
  help:      { color: '#f97316', bg: '#fff7ed', label: 'Help Needed', emoji: '🙏', pulse: false },
  offer:     { color: '#22c55e', bg: '#f0fdf4', label: 'Offering Help', emoji: '🤝', pulse: false },
  alert:     { color: '#eab308', bg: '#fefce8', label: 'Alert', emoji: '⚠️', pulse: false },
  general:   { color: '#3b82f6', bg: '#eff6ff', label: 'General', emoji: '📢', pulse: false },
};

// ─── Custom DivIcon marker ─────────────────────────────────────────────────────
const createPostIcon = (post) => {
  const cfg = TYPE_CONFIG[post.type] || TYPE_CONFIG.general;
  const photo = post.author_photo
    ? `<img src="${post.author_photo}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'" />`
    : `<span style="font-size:18px;line-height:44px">${cfg.emoji}</span>`;

  const pulseRing = cfg.pulse
    ? `<div style="
        position:absolute;top:-6px;left:-6px;right:-6px;bottom:-6px;
        border-radius:50%;border:3px solid ${cfg.color};
        animation:communityPulse 1.4s ease-out infinite;
        pointer-events:none;
      "></div>`
    : '';

  const html = `
    <div style="position:relative;width:44px;height:44px;">
      ${pulseRing}
      <div style="
        width:44px;height:44px;border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        background:${cfg.color};
        border:3px solid white;
        box-shadow:0 3px 10px rgba(0,0,0,0.35);
        overflow:hidden;display:flex;align-items:center;justify-content:center;
        transform-origin:center bottom;
      ">
        <div style="transform:rotate(45deg);width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:50%;">
          ${photo}
        </div>
      </div>
    </div>`;

  return L.divIcon({
    className: '',
    html,
    iconSize: [44, 52],
    iconAnchor: [22, 52],
    popupAnchor: [0, -56],
  });
};

// ─── User location dot ─────────────────────────────────────────────────────────
const createUserIcon = () =>
  L.divIcon({
    className: '',
    html: `<div style="
      width:20px;height:20px;border-radius:50%;
      background:#3b82f6;border:3px solid white;
      box-shadow:0 0 0 4px rgba(59,130,246,0.3);
    "></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

// ─── Set view on posts change ──────────────────────────────────────────────────
function BoundsAdjuster({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 12);
      return;
    }
    const bounds = L.latLngBounds(positions);
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 });
  }, [positions, map]);
  return null;
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function MapLegend() {
  return (
    <div style={{
      position: 'absolute', bottom: 24, left: 12, zIndex: 1000,
      background: 'white', borderRadius: 12, padding: '10px 14px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
          <span>{cfg.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Inject pulse keyframes once ──────────────────────────────────────────────
if (!document.getElementById('community-map-styles')) {
  const style = document.createElement('style');
  style.id = 'community-map-styles';
  style.textContent = `
    @keyframes communityPulse {
      0%   { transform: scale(1); opacity: 0.8; }
      70%  { transform: scale(2.2); opacity: 0; }
      100% { transform: scale(2.2); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

// ─── getTimeAgo helper ─────────────────────────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Main component ────────────────────────────────────────────────────────────
const CommunityMap = ({ posts, userLocation }) => {
  const backendBase = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

  const toAbsoluteUrl = (url) => {
    if (!url || typeof url !== 'string') return '';
    if (/^https?:\/\//i.test(url)) return url;
    return `${backendBase}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const resolveMediaUrl = (media) => {
    return (
      toAbsoluteUrl(media?.local_url || media?.backup_url)
      || toAbsoluteUrl(media?.url)
      || toAbsoluteUrl(media?.cdn_url)
      || ''
    );
  };

  const geotagged = useMemo(
    () => posts.filter(p => p.lat != null && p.lon != null),
    [posts]
  );

  const positions = useMemo(
    () => geotagged.map(p => [p.lat, p.lon]),
    [geotagged]
  );

  const center = userLocation
    ? [userLocation.lat, userLocation.lon]
    : geotagged.length > 0
      ? [geotagged[0].lat, geotagged[0].lon]
      : [20.5937, 78.9629]; // India center

  return (
    <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden' }}>
      <MapContainer
        center={center}
        zoom={userLocation ? 12 : 5}
        style={{ height: 520, width: '100%' }}
        zoomControl
        scrollWheelZoom
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {/* Adjust bounds whenever posts change */}
        {positions.length > 0 && <BoundsAdjuster positions={positions} />}

        {/* User location */}
        {userLocation && (
          <>
            <Marker position={[userLocation.lat, userLocation.lon]} icon={createUserIcon()}>
              <Popup>
                <div style={{ fontWeight: 600, fontSize: 13 }}>📍 Your Location</div>
              </Popup>
            </Marker>
            <Circle
              center={[userLocation.lat, userLocation.lon]}
              radius={1500}
              pathOptions={{ fillColor: '#3b82f6', fillOpacity: 0.08, color: '#3b82f6', weight: 1 }}
            />
          </>
        )}

        {/* Post markers */}
        {geotagged.map((post) => {
          const cfg = TYPE_CONFIG[post.type] || TYPE_CONFIG.general;
          return (
            <Marker
              key={post.id}
              position={[post.lat, post.lon]}
              icon={createPostIcon(post)}
            >
              <Popup minWidth={220} maxWidth={280}>
                <div style={{ fontFamily: 'inherit' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', overflow: 'hidden',
                      background: cfg.color, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {post.author_photo
                        ? <img src={post.author_photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ fontSize: 18 }}>{cfg.emoji}</span>
                      }
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.2 }}>{post.author}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{timeAgo(post.timestamp)}</div>
                    </div>
                    <span style={{
                      marginLeft: 'auto', padding: '2px 8px', borderRadius: 999, fontSize: 10,
                      fontWeight: 700, background: cfg.color, color: 'white', flexShrink: 0,
                    }}>
                      {cfg.label.toUpperCase()}
                    </span>
                  </div>

                  {/* Content */}
                  <p style={{ fontSize: 13, margin: '0 0 8px', lineHeight: 1.5, color: '#111827' }}>
                    {post.content?.length > 120 ? post.content.slice(0, 120) + '…' : post.content}
                  </p>

                  {/* Location */}
                  {post.location && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b7280' }}>
                      <span>📍</span>
                      <span>{post.location}</span>
                    </div>
                  )}

                  {/* Media thumbnail */}
                  {post.media?.length > 0 && post.media[0]?.type?.startsWith('image') && (
                    <img
                      src={resolveMediaUrl(post.media[0])}
                      alt="media"
                      style={{ width: '100%', marginTop: 8, borderRadius: 8, maxHeight: 140, objectFit: 'cover' }}
                    />
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Legend overlay */}
      <MapLegend />

      {/* No geotagged posts notice */}
      {geotagged.length === 0 && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'white', borderRadius: 12, padding: '16px 24px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 1000,
          textAlign: 'center', maxWidth: 260,
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🗺️</div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>No pinned posts yet</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Posts appear on the map when created with GPS location enabled.
          </div>
        </div>
      )}
    </div>
  );
};

export default CommunityMap;
