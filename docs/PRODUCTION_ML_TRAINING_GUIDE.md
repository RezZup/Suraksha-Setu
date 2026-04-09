# Suraksha Setu Production ML Training Guide

This guide is written for team handoff. Share this file directly with your ML teammate.

It covers:
- exact training strategy for each disaster topic
- dataset options (internal + external)
- runnable code commands in this repo
- output artifact contract (what files must be returned)
- quality gates before deployment

---

## 1) Current State (Important)

Today, your API includes simulation/statistical outputs in scientist routes. Production-trained model artifacts are not yet plugged in as active inference for those endpoints.

That means the right next step is:
1. train real artifacts offline
2. validate metrics
3. hand over `.joblib` artifacts
4. integrate loading/inference path in API

This guide handles steps 1-3 fully.

---

## 2) Are We Using Different Models Per Topic?

Yes. You should use different models for each topic because each target behaves differently.

Recommended setup in this repo:

1. Flood Prediction
- Task: multi-class classification (severity class)
- Current training code: RandomForestClassifier pipeline
- Input profile: geo + temporal + source/status + impact fields
- Output: severity index (low/medium/high/critical)

2. Earthquake Risk
- Task: regression (next-event magnitude estimate)
- Current training code: HistGradientBoostingRegressor
- Input profile: lagged magnitudes, depth, inter-event interval, geo bins
- Output: predicted magnitude and threshold-based risk interpretation

3. Cyclone Trajectory
- Task: multi-output regression (next lat, lon, wind)
- Current training code: MultiOutput RandomForestRegressor
- Input profile: current storm point + time + wind + step interval
- Output: next-step track and wind estimate

4. AQI Forecast
- Task: regression (AQI at t+1)
- Current training code: HistGradientBoostingRegressor
- Input profile: AQI lags + pollutants + weather covariates + temporal context
- Output: next AQI estimate and error bands

---

## 3) Training Code Added In This Repo

Use these files:

1. Main trainer
- [backend/scripts/train_production_models.py](backend/scripts/train_production_models.py)

2. Prediction checker (artifact validation)
- [backend/scripts/predict_with_artifact.py](backend/scripts/predict_with_artifact.py)

3. ML-only dependency file
- [backend/scripts/requirements-ml.txt](backend/scripts/requirements-ml.txt)

4. Sample inputs and cyclone CSV template
- [backend/scripts/templates/README.md](backend/scripts/templates/README.md)
- [backend/scripts/templates/flood_sample_input.json](backend/scripts/templates/flood_sample_input.json)
- [backend/scripts/templates/earthquake_sample_input.json](backend/scripts/templates/earthquake_sample_input.json)
- [backend/scripts/templates/cyclone_sample_input.json](backend/scripts/templates/cyclone_sample_input.json)
- [backend/scripts/templates/aqi_sample_input.json](backend/scripts/templates/aqi_sample_input.json)
- [backend/scripts/templates/cyclone_tracks_template.csv](backend/scripts/templates/cyclone_tracks_template.csv)

---

## 4) Data Sources You Can Use

## A) Internal data (preferred first)

Your backend already stores training-ready records in:
- `earthquake_dataset`
- `flood_dataset`
- `aqi_dataset`
- `weather_dataset`
- `alerts` (cyclone fallback)

The trainer script reads directly from DB via SQLAlchemy models.

## B) External datasets (recommended for stronger models)

1. Earthquake
- USGS event feed/API (historical)
- URL pattern: `https://earthquake.usgs.gov/fdsnws/event/1/query`

2. Cyclone tracks
- IBTrACS global cyclone tracks (best for trajectory)
- NOAA IBTrACS data portal

3. AQI / air quality
- CPCB open station datasets (India)
- OpenWeather historical/forecast AQI where available

4. Weather reanalysis (high-value)
- ERA5 / ERA5-Land (rainfall, wind, pressure, temperature)

5. MOSDAC / ISRO
- Satellite-derived flood/cyclone-related data layers for feature enrichment

Note:
Cyclone model quality improves significantly if you provide true track sequences (storm_id + timestamp + lat + lon + wind_kmh) rather than generic alert points.

---

## 5) Environment Setup For Your Teammate

Run from repository root:

```powershell
cd backend
python -m venv .venv-ml
.\.venv-ml\Scripts\activate
pip install -r requirements.txt
pip install -r scripts\requirements-ml.txt
```

Ensure `backend/.env` has valid database access (`DATABASE_URL` or equivalent).

---

## 6) Training Commands

## Train all 4 models

```powershell
cd backend
python scripts/train_production_models.py --models all --min-rows 200 --test-size 0.2 --max-rows 200000
```

## Train only selected models

```powershell
python scripts/train_production_models.py --models flood_prediction,aqi_forecast
```

## Train cyclone with dedicated track CSV

```powershell
python scripts/train_production_models.py --models cyclone_trajectory --cyclone-csv scripts/templates/cyclone_tracks_template.csv --min-rows 80
```

Output directory (default):
- `backend/model_artifacts/`

Expected output files:
1. `flood_prediction.joblib`
2. `earthquake_risk.joblib`
3. `cyclone_trajectory.joblib`
4. `aqi_forecast.joblib`
5. `training_summary.json`

---

## 7) Artifact Validation (Before Handoff)

Use prediction checker:

```powershell
cd backend
python scripts/predict_with_artifact.py --artifact model_artifacts/flood_prediction.joblib --input-file scripts/templates/flood_sample_input.json --show-metadata
```

Repeat for each artifact:

```powershell
python scripts/predict_with_artifact.py --artifact model_artifacts/earthquake_risk.joblib --input-file scripts/templates/earthquake_sample_input.json --show-metadata
python scripts/predict_with_artifact.py --artifact model_artifacts/cyclone_trajectory.joblib --input-file scripts/templates/cyclone_sample_input.json --show-metadata
python scripts/predict_with_artifact.py --artifact model_artifacts/aqi_forecast.joblib --input-file scripts/templates/aqi_sample_input.json --show-metadata
```

If prediction runs and metadata is present, artifact packaging is correct.

---

## 8) Quality Gates (Minimum To Accept Model)

Accept only if these thresholds are satisfied (baseline):

1. Flood classifier
- Accuracy >= 0.75
- Macro F1 >= 0.70

2. Earthquake regressor
- MAE <= 0.7 magnitude units
- R2 >= 0.35 (or better with larger data)

3. Cyclone trajectory
- Mean track error <= 120 km for next-step prediction
- Wind MAE <= 20 km/h

4. AQI forecaster
- MAE <= 20 AQI
- R2 >= 0.50
- Within +/-15 AQI >= 0.55

If any model fails threshold:
1. improve data quality/volume
2. add better features
3. retune hyperparameters
4. retrain

---

## 9) What Teammate Must Send Back

Your teammate should hand over one zip containing:

1. All `.joblib` files from `backend/model_artifacts/`
2. `training_summary.json`
3. A short `MODEL_REPORT.md` including:
- training date/time
- data rows used per model
- train/test split method
- final metrics per model
- known limitations

Recommended zip name:
`suraksha_setu_ml_artifacts_YYYYMMDD.zip`

---

## 10) Optional Advanced Upgrades (After Baseline)

1. Flood
- Try XGBoost / LightGBM multiclass
- Add rainfall aggregates and river-level features

2. Earthquake
- Build region/time-window forecasting labels
- Add clustering + anomaly score features

3. Cyclone
- Replace point-wise RF with sequence model (LSTM/Temporal Fusion Transformer)
- Add SST and pressure fields from meteorological data

4. AQI
- Multi-horizon forecasts (t+1, t+6, t+24)
- Add station-level traffic/industrial proxies if available

---

## 11) Production Inference Contract (For API Integrator)

Each artifact contains:
- `pipeline`
- `metadata`

Inference pattern:

```python
import joblib
import pandas as pd

bundle = joblib.load("backend/model_artifacts/aqi_forecast.joblib")
pipeline = bundle["pipeline"]
features = pd.DataFrame([input_payload])
pred = pipeline.predict(features)
```

Important:
The incoming feature keys must match the model metadata `feature_columns`.

---

## 12) Suggested Retraining Schedule

1. Weekly
- Run data-quality and drift checks

2. Monthly
- Full retraining for AQI and flood

3. Quarterly
- Full retraining for earthquake and cyclone

4. Trigger-based immediate retraining
- major monsoon/cyclone season shifts
- sudden metric degradation
- new region onboarding

---

## 13) Troubleshooting

1. "Not enough rows"
- Lower `--min-rows` for initial baseline
- Ingest more data first

2. Cyclone model skipped
- Provide `--cyclone-csv` with proper storm tracks

3. Bad metrics
- Check label quality (`severity`, timestamps, coordinates)
- Remove duplicate/noisy events
- Add feature engineering (lags, weather joins, geospatial bins)

4. Dependency conflicts
- Use separate ML venv as shown in setup section

---

## 14) One-Command Handoff Recipe For Teammate

```powershell
cd backend
python -m venv .venv-ml
.\.venv-ml\Scripts\activate
pip install -r requirements.txt
pip install -r scripts\requirements-ml.txt
python scripts/train_production_models.py --models all --min-rows 200 --test-size 0.2
python scripts/predict_with_artifact.py --artifact model_artifacts/flood_prediction.joblib --input-file scripts/templates/flood_sample_input.json --show-metadata
python scripts/predict_with_artifact.py --artifact model_artifacts/earthquake_risk.joblib --input-file scripts/templates/earthquake_sample_input.json --show-metadata
python scripts/predict_with_artifact.py --artifact model_artifacts/cyclone_trajectory.joblib --input-file scripts/templates/cyclone_sample_input.json --show-metadata
python scripts/predict_with_artifact.py --artifact model_artifacts/aqi_forecast.joblib --input-file scripts/templates/aqi_sample_input.json --show-metadata
```

Then send `backend/model_artifacts/` to the API integration owner.
