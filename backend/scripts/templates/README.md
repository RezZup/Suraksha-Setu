# Model Input Templates

These files help you quickly test saved model artifacts with `predict_with_artifact.py`.

- `flood_sample_input.json`
- `earthquake_sample_input.json`
- `cyclone_sample_input.json`
- `aqi_sample_input.json`
- `cyclone_tracks_template.csv` (for training cyclone model)

Example:

```powershell
cd backend
python scripts/predict_with_artifact.py --artifact model_artifacts/aqi_forecast.joblib --input-file scripts/templates/aqi_sample_input.json --show-metadata
```
