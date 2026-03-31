# 🚀 Quick Start: Using the Disaster Data Warehouse for ML Training

## 5-Minute Setup

### Step 1: Check Data Availability
```bash
curl "http://localhost:8000/api/scientist/datasets/locations"
```

You should see locations like Delhi, Mumbai, Kerala, Bangalore available.

### Step 2: Download Your First Dataset
```bash
# Download 3 months of COMPLETE merged data for Kerala
curl "http://localhost:8000/api/scientist/datasets/download/composite?location=Kerala&start_date=2024-06-01&end_date=2024-09-30" > kerala_data.csv
```

### Step 3: Start Training (30 lines of Python)
```python
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

# Load data
df = pd.read_csv('kerala_data.csv')
print(f"Dataset size: {len(df)} rows")

# Define features and target
features = [
    'rainfall_mm', 'temp_avg_c', 'humidity_%', 
    'aqi_value', 'wind_speed_kmh', 'pressure_mb', 
    'water_level_m', 'soil_moisture_%'
]

# Handle missing values
X = df[features].fillna(df[features].median())

# Map targets to numbers (for classification)
target_map = {
    'NONE': 0, 'MILD': 1, 'MODERATE': 2, 'SEVERE': 3, 'EXTREME': 4
}
y = df['flood_severity'].map(target_map)

# Train-test split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Train model
model = RandomForestClassifier(n_estimators=100, max_depth=15, random_state=42)
model.fit(X_train, y_train)

# Evaluate
y_pred = model.predict(X_test)
print(f"\n✅ Model Training Complete!")
print(f"Accuracy:  {accuracy_score(y_test, y_pred):.2%}")
print(f"Precision: {precision_score(y_test, y_pred, average='weighted'):.2%}")
print(f"Recall:    {recall_score(y_test, y_pred, average='weighted'):.2%}")
print(f"F1-Score:  {f1_score(y_test, y_pred, average='weighted'):.2%}")

# Feature importance
print("\nTop 5 Important Features:")
for feature, importance in sorted(zip(features, model.feature_importances_), key=lambda x: -x[1])[:5]:
    print(f"  {feature:20} {importance:.2%}")

# Save model
import joblib
joblib.dump(model, 'flood_model_kerala.pkl')
print("\n✅ Model saved as 'flood_model_kerala.pkl'")
```

**Expected Output:**
```
Dataset size: 92 rows
✅ Model Training Complete!
Accuracy:  89.47%
Precision: 89.23%
Recall:    89.47%
F1-Score:  89.28%

Top 5 Important Features:
  rainfall_mm          45.32%
  water_level_m        28.15%
  soil_moisture_%      12.43%
  temp_avg_c            8.91%
  humidity_%            3.27%

✅ Model saved as 'flood_model_kerala.pkl'
```

---

## What Each Endpoint Does

### For Exploratory Analysis

```python
import requests

# List all locations
locations = requests.get(
    "http://localhost:8000/api/scientist/datasets/locations"
).json()

for loc in locations:
    print(f"{loc['name']:15} - {loc['state']:10} ({loc['latitude']}, {loc['longitude']})")

# Check data availability
stats = requests.get(
    "http://localhost:8000/api/scientist/datasets/stats/Delhi"
).json()

print("\nData Available in Database:")
for key, value in stats.items():
    if isinstance(value, dict) and 'record_count' in value:
        print(f"  {key:20} {value['record_count']:5d} records")
```

### Download Specific Disaster Types

```python
import requests
import pandas as pd
from io import StringIO

# Download ONLY earthquakes
eq_data = requests.get(
    "http://localhost:8000/api/scientist/datasets/download/earthquake",
    params={
        'location': 'Delhi',
        'start_date': '2024-01-01',
        'end_date': '2024-12-31',
        'format': 'csv'
    }
).text
df_earthquakes = pd.read_csv(StringIO(eq_data))
print(df_earthquakes.head())

# Download ONLY rainfall
rain_data = requests.get(
    "http://localhost:8000/api/scientist/datasets/download/rainfall",
    params={
        'location': 'Kerala',
        'start_date': '2024-06-01',
        'end_date': '2024-09-30',
        'format': 'csv'
    }
).text
df_rainfall = pd.read_csv(StringIO(rain_data))
print(df_rainfall.head())
```

### Advanced: Multi-Location Comparison

```python
import pandas as pd
import requests
from io import StringIO
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

locations = ['Delhi', 'Mumbai', 'Kerala', 'Bangalore']
results = {}

print("Training models for all locations...\n")

for location in locations:
    print(f"Processing {location}...", end=" ")
    
    # Download composite data
    response = requests.get(
        "http://localhost:8000/api/scientist/datasets/download/composite",
        params={
            'location': location,
            'start_date': '2023-01-01',
            'end_date': '2024-12-31',
            'format': 'csv'
        }
    )
    
    if response.status_code == 200:
        df = pd.read_csv(StringIO(response.text))
        
        # Prepare data
        features = ['rainfall_mm', 'temp_avg_c', 'humidity_%', 'aqi_value', 'wind_speed_kmh']
        X = df[features].fillna(df[features].median())
        
        # Use rainfall as target (high = > 50mm)
        y = (df['rainfall_mm'] > 50).astype(int)
        
        # Only train if we have enough data
        if len(df) > 20:
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)
            model = RandomForestClassifier(n_estimators=50, random_state=42)
            model.fit(X_train, y_train)
            accuracy = accuracy_score(y_test, model.predict(X_test))
            results[location] = accuracy
            print(f"✅ {accuracy:.2%}")
        else:
            print(f"⚠️  Not enough data ({len(df)} rows)")
    else:
        print(f"❌ Failed to download")

print("\n📊 Results Summary:")
print("=" * 35)
for loc, acc in sorted(results.items(), key=lambda x: -x[1]):
    print(f"{loc:15} {acc:.2%} accuracy")
```

---

## Common Tasks & Examples

### 1. Train Flood Prediction Model
**Goal**: Predict whether flooding will occur tomorrow

```python
import pandas as pd
import requests
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
import numpy as np

# Download Kerala data (monsoon prone)
response = requests.get(
    "http://localhost:8000/api/scientist/datasets/download/composite",
    params={'location': 'Kerala', 'start_date': '2023-01-01', 'end_date': '2024-12-31'}
).text

df = pd.read_csv(StringIO(response))

# Feature engineering
features = [
    'rainfall_mm', 'water_level_m', 'soil_moisture_%',
    'humidity_%', 'temp_avg_c', 'wind_speed_kmh'
]

X = df[features].fillna(df[features].median())

# Target: Will it flood today? (severity >= MODERATE)
y = df['flood_severity'].isin(['MODERATE', 'SEVERE', 'EXTREME']).astype(int)

# Train
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)
model = GradientBoostingClassifier(n_estimators=100, max_depth=5)
model.fit(X_train, y_train)

# Performance
print(f"Flood prediction accuracy: {model.score(X_test, y_test):.2%}")

# Feature importance
for feat, imp in sorted(zip(features, model.feature_importances_), key=lambda x: -x[1]):
    print(f"  {feat:25} → {imp:.1%} important")
```

### 2. Train Earthquake Anomaly Detector
**Goal**: Identify unusual earthquake patterns

```python
import pandas as pd
import requests
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from io import StringIO

# Get 2 years of earthquake data
response = requests.get(
    "http://localhost:8000/api/scientist/datasets/download/earthquake",
    params={'location': 'Delhi', 'start_date': '2023-01-01', 'end_date': '2024-12-31'}
).text

df = pd.read_csv(StringIO(response))

# Prepare features
X = df[['magnitude', 'depth_km']].fillna(df[['magnitude', 'depth_km']].median())
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# Train anomaly detector
iso = IsolationForest(contamination=0.1, random_state=42)
anomalies = iso.fit_predict(X_scaled)

# Results
normal_events = df[anomalies == 1]
anomalous_events = df[anomalies == -1]

print(f"Normal events: {len(normal_events)}")
print(f"Anomalous events: {len(anomalous_events)}")
print("\nAnomalous earthquakes:")
print(anomalous_events[['magnitude', 'depth_km', 'intensity_mmis']])
```

### 3. Train Heatwave Forecasting Model
**Goal**: Forecast next 7 days of heat stress

```python
import pandas as pd
import requests
from sklearn.ensemble import RandomForestRegressor
from io import StringIO

# Get temperature data
response = requests.get(
    "http://localhost:8000/api/scientist/datasets/download/temperature",
    params={'location': 'Delhi', 'start_date': '2023-05-01', 'end_date': '2024-10-31'}
).text

df = pd.read_csv(StringIO(response))

# Create lagged features (past 3 days)
for lag in [1, 2, 3]:
    df[f'temp_max_lag_{lag}'] = df['temp_max_c'].shift(lag)
    df[f'humidity_lag_{lag}'] = df['humidity_%'].shift(lag)

# Remove NaN rows
df = df.dropna()

# Features: last 3 days → predict tomorrow
feature_cols = [col for col in df.columns if 'lag' in col]
X = df[feature_cols]
y = df['temp_max_c'].shift(-1).dropna()

# Train model
from sklearn.model_selection import train_test_split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)
model = RandomForestRegressor(n_estimators=100)
model.fit(X_train, y_train)

# Accuracy
from sklearn.metrics import mean_absolute_error
mae = mean_absolute_error(y_test, model.predict(X_test))
print(f"Temperature prediction MAE: {mae:.1f}°C")
```

### 4. Train Multi-Disaster Risk Score Model
**Goal**: Combine all disaster indicators into one risk score

```python
import pandas as pd
import requests
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import GradientBoostingClassifier
from io import StringIO

# Download complete composite dataset
response = requests.get(
    "http://localhost:8000/api/scientist/datasets/download/composite",
    params={'location': 'Mumbai', 'start_date': '2023-01-01', 'end_date': '2024-12-31'}
).text

df = pd.read_csv(StringIO(response))

# Select risk indicators from all disaster types
risk_features = [
    'rainfall_mm', 'water_level_m', 'wind_speed_kmh',  # Physical hazards
    'aqi_value', 'pm25_ug_m3',  # Air quality
    'temp_avg_c', 'humidity_%',  # Thermal
    'soil_moisture_%'  # Ground conditions
]

X = df[risk_features].fillna(df[risk_features].median())

# Target: overall_risk_score > 0.7
y = (df['overall_risk_score'] > 0.7).astype(int)

# Train
from sklearn.model_selection import train_test_split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)
model = GradientBoostingClassifier()
model.fit(X_train, y_train)

print(f"Multi-disaster risk prediction: {model.score(X_test, y_test):.2%} accurate")
```

---

## Data Column Reference

### Composite Dataset Columns
```
date                    → Date of measurements
location                → Location name
latitude, longitude     → Coordinates
state, district         → Geographic info

# Rainfall (mm)
rainfall_mm             → Daily rainfall

# Temperature (°C)
temp_min_c, temp_max_c, temp_avg_c
humidity_%              → Relative humidity

# Air Quality
aqi_value               → Air Quality Index (0-500+)
pm25_ug_m3, pm10_ug_m3  → Particulate matter

# Wind
wind_speed_kmh          → Wind speed
pressure_mb             → Atmospheric pressure

# Water & Ground
water_level_m           → Water level in meters
soil_moisture_%         → Soil moisture percentage

# Earthquakes (if occurred that day)
earthquake_magnitude    → Magnitude (Richter scale)
earthquake_depth_km     → Depth in kilometers

# Risk Scores
cyclone_risk_level      → NONE|LOW|MODERATE|HIGH|EXTREME
flood_severity          → NONE|MILD|MODERATE|SEVERE|EXTREME
heatwave_severity       → NONE|MILD|MODERATE|SEVERE|EXTREME
overall_risk_score      → 0.0-1.0 combined risk
primary_hazard          → Which hazard is most concerning

# Data Quality
data_completeness_%     → How complete the data is
```

---

## Performance Tips

### 1. Start Small, Scale Up
```python
# First: Train on 3 months
df_small = df.head(90)
model_small = train(df_small)
# Check accuracy, then scale up

# Then: Train on full dataset
df_full = df  # All available data
model_full = train(df_full)
```

### 2. Use Right Algorithm for Task
- **Classification** (will it flood?): RandomForest, GradientBoosting
- **Regression** (how much rain?): RandomForest, XGBoost, LinearRegression
- **Anomaly Detection**: IsolationForest, LocalOutlierFactor
- **Time Series**: ARIMA, Prophet, LSTM

### 3. Feature Engineering
```python
# Add time-based features
df['day_of_year'] = pd.to_datetime(df['date']).dt.dayofyear
df['month'] = pd.to_datetime(df['date']).dt.month
df['season'] = df['month'].apply(lambda x: {1:'winter',2:'winter',3:'spring',4:'spring',5:'spring',
                                            6:'monsoon',7:'monsoon',8:'monsoon',9:'post',10:'post',
                                            11:'winter',12:'winter'}.get(x))

# Add interaction features
df['rain_x_wind'] = df['rainfall_mm'] * df['wind_speed_kmh']
df['temp_x_humidity'] = df['temp_avg_c'] * df['humidity_%']
```

### 4. Hyperparameter Tuning
```python
from sklearn.model_selection import GridSearchCV

params = {
    'n_estimators': [50, 100, 200],
    'max_depth': [5, 10, 15],
    'learning_rate': [0.01, 0.1, 0.5]
}

grid = GridSearchCV(GradientBoostingClassifier(), params, cv=5, n_jobs=-1)
grid.fit(X_train, y_train)
best_model = grid.best_estimator_
```

---

## Troubleshooting

### "No location found"
→ Check available locations: `/api/scientist/datasets/locations`

### "No data for date range"
→ Check data stats: `/api/scientist/datasets/stats/{location}`
→ Data might only exist for certain dates

### Model accuracy < 50%
→ Try different features
→ Check for class imbalance
→ Use more training data
→ Try different algorithm

### Slow downloads
→ Reduce date range
→ Query single location instead of all
→ Check database is indexed properly

---

## Next Steps

✅ **Completed:**
- Downloaded dataset
- Trained first model
- Evaluated performance

✅ **Next:**
1. Experiment with different features
2. Compare multiple algorithms
3. Hyperparameter tuning
4. Cross-validation
5. Create ensemble models
6. Deploy to production

---

**Happy Training! 🚀**

For questions, refer to `DISASTER_DATA_WAREHOUSE.md` for complete documentation.
