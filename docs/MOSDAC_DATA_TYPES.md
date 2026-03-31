# MOSDAC Data Types & Datasets

## What is MOSDAC?
**MOSDAC** = Meteorological and Oceanographic Satellite Data Archival Centre (India's official satellite data provider)

---

## 📡 Current Data Being Fetched

### 1. **CYCLONE TRACKING DATA** 🌪️

**Datasets Used:**
- `3SCAT_L2B` → Scatterometer data (wind analysis)
- `3RIMG_L1B` → Satellite imagery

**Data Includes:**
- Cyclone location (latitude, longitude)
- Wind speed patterns
- Cloud formation
- Movement trajectory
- Timestamp of satellite pass

**Lookback Period:** Last 14 days

**Example Response:**
```json
{
  "cyclone_entries": [
    {
      "dataset_id": "3SCAT_L2B",
      "filename": "cyclone_track_20240401_0600.nc",
      "time": "2024-04-01T06:00:00Z",
      "latitude_range": [12.5, 25.8],
      "longitude_range": [70.2, 90.5],
      "wind_speed": "120-150 kmph",
      "data_points": 15000
    }
  ]
}
```

---

### 2. **FLOOD MONITORING DATA** 🌊

**Datasets Used:**
- `3RIMG_L2B_RAIN` → Rainfall estimates (satellite-derived)
- `3SMAP_L3_SM` → Soil moisture levels

**Data Includes:**
- Rainfall intensity (millimeters/hour)
- Soil moisture (percentage saturation)
- Vegetation index (flood risk indicator)
- Flood extent (water body mapping)
- Timestamp

**Lookback Period:** Last 14 days

**Example Response:**
```json
{
  "flood_entries": [
    {
      "dataset_id": "3RIMG_L2B_RAIN",
      "filename": "rainfall_20240401_1200.tif",
      "time": "2024-04-01T12:00:00Z",
      "rainfall_mm": 45.2,
      "affected_area_km2": 1250,
      "soil_moisture_percent": "92%"
    }
  ]
}
```

---

### 3. **WEATHER SATELLITE DATA** 🌤️

**Datasets Available:**
- `3RIMG_L2B_SST` → Sea Surface Temperature
- `3RIMG_L2B_CLOUD` → Cloud cover analysis
- `3INSAT_L1B_VIS` → Visible light imagery
- `3INSAT_L1B_IR` → Infrared imagery

**Data Includes:**
- Temperature gradients
- Cloud patterns
- Atmospheric pressure
- Humidity levels
- Visibility

**Example Response:**
```json
{
  "weather_data": {
    "location": {"lat": 28.6139, "lon": 77.2090},
    "timestamp": "2024-04-01T15:00:00Z",
    "sea_surface_temp": 28.5,
    "cloud_cover_percent": 65,
    "atmospheric_pressure": 1013.2,
    "visibility_km": 8
  }
}
```

---

## 📊 Data Structure from MOSDAC API

### Common Response Format:
```json
{
  "entries": [
    {
      "id": "unique_identifier",
      "datasetId": "3RIMG_L2B_SST",
      "filename": "data_file_20240401_090000.ncd",
      "timeStamp": "2024-04-01T09:00:00Z",
      "metadata": {
        "resolution": "1km",
        "spatial_coverage": "India",
        "temporal_coverage": "30 minutes",
        "quality_flag": "good",
        "processing_level": "L2B"
      }
    }
  ]
}
```

---

## 🎯 How We're Currently Using MOSDAC Data

### In Disasters Route (`disasters_route_mosdac.py`):

```python
# 1. Fetch cyclone data for past 14 days
cyclone_entries = await mosdac_service.get_cyclone_data(days_back=14)
cyclone_disasters = transform_cyclone_data(cyclone_entries)
# Result: List of cyclone events with location, wind speed, status

# 2. Fetch flood data for past 14 days
flood_entries = await mosdac_service.get_flood_data(days_back=14)
flood_disasters = transform_flood_data(flood_entries)
# Result: List of flood events with location, rainfall, area affected

# 3. Merge with historical baseline data
disasters = merge_with_existing_disasters(mosdac_disasters, historical_disasters)
# Result: Combined list returned to API clients
```

---

## 📋 Available MOSDAC Datasets (Full List)

### **Land/Weather:**
| Dataset ID | Type | Description |
|-----------|------|-------------|
| 3RIMG_L1B | Imagery | Raw satellite imagery (visible + IR) |
| 3RIMG_L2B_RAIN | Rainfall | Satellite-derived rainfall estimates |
| 3RIMG_L2B_SST | Temperature | Sea surface temperature |
| 3RIMG_L2B_CLOUD | Cloud | Cloud cover and type analysis |
| 3INSAT_L1B_VIS | Visible | Visible light satellite data |
| 3INSAT_L1B_IR | Infrared | Infrared thermal data |

### **Ocean/Wind:**
| Dataset ID | Type | Description |
|-----------|------|-------------|
| 3SCAT_L2B | Wind | Scatterometer (ocean wind vectors) |
| 3SMAP_L3_SM | Soil | Soil moisture levels |
| 3AMSR_L2B_SST | Temperature | Advanced microwave SST |

### **Resolution & Coverage:**
- **Spatial Resolution:** 1km to 25km (varies by dataset)
- **Geographic Coverage:** India (±25N, ±95E)
- **Temporal Resolution:** 30 min (visible), 4 hours (microwave)
- **Historical Archive:** Last 20+ years available

---

## 🔄 Authentication & Access

### Current Credentials (in `.env`):
```
MOSDAC_USERNAME=samrat12
MOSDAC_PASSWORD=Sam@1217
MOSDAC_CACHE_TTL=3600
```

### Token Management:
- ✅ Auto-refresh every 23 hours
- ✅ Cached responses (1 hour)
- ✅ Automatic retry on failure
- ✅ Graceful fallback to historical data if MOSDAC unavailable

---

## 💾 Raw Data Format

### What We Get Back from MOSDAC:

**File Types:**
- `.nc` (NetCDF) - Scientific data format with multiple variables
- `.tif` (GeoTIFF) - Satellite imagery with geospatial metadata
- `.h5` (HDF5) - Hierarchical scientific data

**Typical File Size:**
- Weather satellite image: 50-200 MB
- Cyclone track data: 5-50 MB
- Flood mapping: 20-100 MB

**Data Structure (NetCDF):**
```
MOSDAC_cyclone_track.nc
├─ latitude[] (array: -5 to 35)
├─ longitude[] (array: 60 to 100)
├─ time[] (timestamp of observation)
├─ wind_speed[lat,lon,time]
├─ cloud_density[lat,lon,time]
└─ metadata (satellite name, processing details)
```

---

## 🎯 Current Implementation Status

### ✅ Working:
- Cyclone data fetching (14-day lookback)
- Flood data fetching (14-day lookback)
- Authentication & token management
- Response caching

### ⚠️ Limited:
- Only cyclone & flood types (earthquakes from GDACS/USGS instead)
- No real-time alerts (only historical data from past 14 days)
- Data transformation is basic (metadata extraction only)

### ❌ Not Implemented Yet:
- Heatwave detection from satellite data
- Storm surge prediction
- Landslide risk mapping
- Real-time anomaly detection

---

## 📊 Example API Response (/api/disasters):

```json
{
  "disasters": [
    {
      "id": "mosdac_cyclone_20240401",
      "type": "cyclone",
      "title": "Cyclone Track Data",
      "location": "Bay of Bengal",
      "date": "2024-04-01T09:00:00Z",
      "severity": "high",
      "source": "MOSDAC",
      "wind_speed": "140 kmph",
      "latitude": 15.2,
      "longitude": 88.5,
      "affected_area_km2": 50000
    },
    {
      "id": "mosdac_flood_20240330",
      "type": "flood",
      "title": "Heavy Rainfall",
      "location": "Western Ghats",
      "date": "2024-03-30T12:00:00Z",
      "severity": "medium",
      "source": "MOSDAC",
      "rainfall_mm": 85,
      "affected_area_km2": 12500
    }
  ]
}
```

---

## 🚀 Optimization Ideas for Future

### 1. **Process Satellite Images:**
- Extract actual flood extent (pixel analysis)
- Detect cloud patterns automatically
- Calculate actual damage area

### 2. **Real-Time Processing:**
- Stream data updates every 30 minutes
- Alert users when threshold exceeded

### 3. **ML Integration:**
- Train model for heatwave detection
- Predict cyclone intensification
- Flood risk scoring

### 4. **Store in Our Cache:**
From the optimization plan we discussed:
```python
# Backend cron every 30 min:
cyclone_data = await mosdac_service.get_cyclone_data()
for entry in cyclone_data:
    cache_entry = DisasterCache(
        disaster_type="cyclone",
        latitude=entry.lat,
        longitude=entry.lon,
        raw_data=entry
    )
    db.add(cache_entry)
await db.commit()
```

---

## Summary

**MOSDAC provides:**
- 🌪️ **Cyclone tracking** → Wind speed, cloud patterns, movement
- 🌊 **Flood monitoring** → Rainfall, soil moisture, water extent
- 🌤️ **Weather data** → Temperature, cloud cover, atmospheric conditions
- 📡 **Raw satellite imagery** → Visible + infrared data for analysis

**Current use:** 14-day lookback for cyclones & floods merged with historical baseline

**Potential:** Real-time disaster detection, ML-based risk scoring, automated alerts
