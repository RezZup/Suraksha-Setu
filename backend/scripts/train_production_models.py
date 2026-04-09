"""
Train production-ready, topic-specific ML models for Suraksha Setu.

Models trained by this script:
1) Flood severity model (multi-class classification)
2) Earthquake next-event magnitude model (regression)
3) Cyclone next-step trajectory model (multi-output regression)
4) AQI t+1 forecast model (regression)

Outputs:
- model artifact files (.joblib) under backend/model_artifacts/
- training_summary.json with metrics and metadata

Usage (from backend/):
    python scripts/train_production_models.py --models all

Usage (from repository root):
    python backend/scripts/train_production_models.py --models all
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
)
from sklearn.model_selection import train_test_split
from sklearn.multioutput import MultiOutputRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sqlalchemy import desc, select


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# pylint: disable=wrong-import-position
from database import (  # noqa: E402
    AQIDataset,
    Alert,
    AsyncSessionLocal,
    EarthquakeDataset,
    FloodDataset,
    WeatherDataset,
    close_db,
)


LOGGER = logging.getLogger("production_ml_trainer")

SEVERITY_TO_INDEX = {
    "low": 0,
    "green": 0,
    "moderate": 1,
    "medium": 1,
    "warning": 1,
    "orange": 2,
    "high": 2,
    "severe": 2,
    "red": 3,
    "critical": 3,
    "extreme": 3,
}

AVAILABLE_MODELS = {
    "flood_prediction",
    "earthquake_risk",
    "cyclone_trajectory",
    "aqi_forecast",
}


@dataclass
class ModelTrainingResult:
    model_name: str
    status: str
    artifact_path: str | None = None
    rows_used: int = 0
    train_rows: int = 0
    test_rows: int = 0
    metrics: Dict[str, Any] | None = None
    reason: str | None = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "model_name": self.model_name,
            "status": self.status,
            "artifact_path": self.artifact_path,
            "rows_used": self.rows_used,
            "train_rows": self.train_rows,
            "test_rows": self.test_rows,
            "metrics": self.metrics or {},
            "reason": self.reason,
        }


def _json_default(value: Any):
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.ndarray,)):
        return value.tolist()
    if isinstance(value, (datetime, pd.Timestamp)):
        return value.isoformat()
    return str(value)


def _save_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, default=_json_default)


def _rows_to_df(rows: Iterable[Any], columns: List[str]) -> pd.DataFrame:
    materialized = []
    for row in rows:
        materialized.append({col: getattr(row, col, None) for col in columns})
    if not materialized:
        return pd.DataFrame(columns=columns)
    return pd.DataFrame(materialized)


def _parse_dt(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce", utc=True)


def _safe_float(value: Any, default: float = np.nan) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _split_time_ordered(
    df: pd.DataFrame,
    feature_cols: List[str],
    target_cols: List[str],
    test_size: float,
    min_test_rows: int = 40,
):
    ordered = df.sort_values("_sort_ts").reset_index(drop=True)
    split_idx = int(len(ordered) * (1 - test_size))
    split_idx = max(1, min(split_idx, len(ordered) - 1))

    train_df = ordered.iloc[:split_idx]
    test_df = ordered.iloc[split_idx:]

    if len(test_df) < min_test_rows and len(ordered) >= (min_test_rows + 50):
        split_idx = len(ordered) - min_test_rows
        train_df = ordered.iloc[:split_idx]
        test_df = ordered.iloc[split_idx:]

    x_train = train_df[feature_cols]
    y_train = train_df[target_cols] if len(target_cols) > 1 else train_df[target_cols[0]]
    x_test = test_df[feature_cols]
    y_test = test_df[target_cols] if len(target_cols) > 1 else test_df[target_cols[0]]
    return x_train, x_test, y_train, y_test


def _persist_artifact(
    output_dir: Path,
    model_name: str,
    pipeline: Any,
    metadata: Dict[str, Any],
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = output_dir / f"{model_name}.joblib"
    package = {
        "model_name": model_name,
        "pipeline": pipeline,
        "metadata": metadata,
    }
    joblib.dump(package, artifact_path)
    return artifact_path


async def _load_training_frames(max_rows: int) -> Dict[str, pd.DataFrame]:
    async with AsyncSessionLocal() as db:
        eq_stmt = select(EarthquakeDataset).order_by(desc(EarthquakeDataset.ingested_at)).limit(max_rows)
        fl_stmt = select(FloodDataset).order_by(desc(FloodDataset.ingested_at)).limit(max_rows)
        aqi_stmt = select(AQIDataset).order_by(desc(AQIDataset.ingested_at)).limit(max_rows)
        wx_stmt = select(WeatherDataset).order_by(desc(WeatherDataset.ingested_at)).limit(max_rows)
        alert_stmt = select(Alert).order_by(desc(Alert.created_at)).limit(max_rows)

        eq_rows = (await db.execute(eq_stmt)).scalars().all()
        fl_rows = (await db.execute(fl_stmt)).scalars().all()
        aqi_rows = (await db.execute(aqi_stmt)).scalars().all()
        wx_rows = (await db.execute(wx_stmt)).scalars().all()
        alert_rows = (await db.execute(alert_stmt)).scalars().all()

    return {
        "earthquake": _rows_to_df(eq_rows, [c.name for c in EarthquakeDataset.__table__.columns]),
        "flood": _rows_to_df(fl_rows, [c.name for c in FloodDataset.__table__.columns]),
        "aqi": _rows_to_df(aqi_rows, [c.name for c in AQIDataset.__table__.columns]),
        "weather": _rows_to_df(wx_rows, [c.name for c in WeatherDataset.__table__.columns]),
        "alerts": _rows_to_df(alert_rows, [c.name for c in Alert.__table__.columns]),
    }


def train_flood_model(
    flood_df: pd.DataFrame,
    output_dir: Path,
    min_rows: int,
    test_size: float,
    random_state: int,
) -> ModelTrainingResult:
    model_name = "flood_prediction"
    if flood_df.empty:
        return ModelTrainingResult(model_name=model_name, status="skipped", reason="flood_dataset is empty")

    df = flood_df.copy()
    df["event_time"] = _parse_dt(df.get("event_time"))
    if "event_date" in df.columns:
        df["event_time"] = df["event_time"].fillna(_parse_dt(df["event_date"]))

    df["severity_norm"] = df["severity"].astype(str).str.lower().str.strip()
    df["target"] = df["severity_norm"].map(SEVERITY_TO_INDEX)

    numeric_cols = ["lat", "lon", "casualties", "affected_population"]
    categorical_cols = ["source", "status", "location"]

    for col in numeric_cols:
        if col not in df.columns:
            df[col] = np.nan

    df = df.dropna(subset=["event_time", "target"])
    if len(df) < min_rows:
        return ModelTrainingResult(
            model_name=model_name,
            status="skipped",
            reason=f"not enough usable flood rows ({len(df)} < {min_rows})",
            rows_used=int(len(df)),
        )

    df["month"] = df["event_time"].dt.month
    df["day_of_year"] = df["event_time"].dt.dayofyear
    df["is_monsoon"] = df["month"].isin([6, 7, 8, 9]).astype(int)

    feature_cols = numeric_cols + categorical_cols + ["month", "day_of_year", "is_monsoon"]
    x = df[feature_cols]
    y = df["target"].astype(int)

    class_counts = y.value_counts(dropna=False)
    stratify = y if y.nunique() > 1 and class_counts.min() >= 2 else None
    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=test_size,
        random_state=random_state,
        stratify=stratify,
    )

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                numeric_cols + ["month", "day_of_year", "is_monsoon"],
            ),
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="constant", fill_value="unknown")),
                        ("onehot", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                categorical_cols,
            ),
        ]
    )

    model = RandomForestClassifier(
        n_estimators=450,
        max_depth=18,
        min_samples_leaf=2,
        class_weight="balanced_subsample",
        random_state=random_state,
        n_jobs=-1,
    )

    pipeline = Pipeline(steps=[("prep", preprocessor), ("model", model)])
    pipeline.fit(x_train, y_train)

    preds = pipeline.predict(x_test)

    labels = sorted(int(v) for v in y.unique())
    metrics = {
        "accuracy": float(accuracy_score(y_test, preds)),
        "f1_macro": float(f1_score(y_test, preds, average="macro")),
        "classification_report": classification_report(y_test, preds, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(y_test, preds, labels=labels).tolist(),
        "labels": labels,
        "class_distribution": {str(k): int(v) for k, v in class_counts.to_dict().items()},
    }

    artifact_path = _persist_artifact(
        output_dir,
        model_name,
        pipeline,
        {
            "task": "multiclass_classification",
            "target_name": "flood_severity_index",
            "target_mapping": {
                "low": 0,
                "medium": 1,
                "high": 2,
                "critical": 3,
            },
            "feature_columns": feature_cols,
            "source_tables": ["flood_dataset"],
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "metrics": metrics,
        },
    )

    return ModelTrainingResult(
        model_name=model_name,
        status="trained",
        artifact_path=str(artifact_path),
        rows_used=int(len(df)),
        train_rows=int(len(x_train)),
        test_rows=int(len(x_test)),
        metrics=metrics,
    )


def train_earthquake_model(
    earthquake_df: pd.DataFrame,
    output_dir: Path,
    min_rows: int,
    test_size: float,
    random_state: int,
) -> ModelTrainingResult:
    model_name = "earthquake_risk"
    if earthquake_df.empty:
        return ModelTrainingResult(model_name=model_name, status="skipped", reason="earthquake_dataset is empty")

    df = earthquake_df.copy()
    df["event_time"] = _parse_dt(df.get("event_time"))
    if "event_date" in df.columns:
        df["event_time"] = df["event_time"].fillna(_parse_dt(df["event_date"]))

    for col in ["lat", "lon", "magnitude", "depth_km"]:
        if col not in df.columns:
            df[col] = np.nan

    df = df.dropna(subset=["event_time", "lat", "lon", "magnitude", "depth_km"])
    if len(df) < min_rows:
        return ModelTrainingResult(
            model_name=model_name,
            status="skipped",
            reason=f"not enough usable earthquake rows ({len(df)} < {min_rows})",
            rows_used=int(len(df)),
        )

    df["lat_bin"] = df["lat"].round(1)
    df["lon_bin"] = df["lon"].round(1)
    df = df.sort_values(["lat_bin", "lon_bin", "event_time"]).reset_index(drop=True)

    grouped = df.groupby(["lat_bin", "lon_bin"], sort=False)
    df["prev_mag_1"] = grouped["magnitude"].shift(1)
    df["prev_mag_2"] = grouped["magnitude"].shift(2)
    df["prev_depth_1"] = grouped["depth_km"].shift(1)
    df["prev_event_time"] = grouped["event_time"].shift(1)
    df["hours_since_prev"] = (df["event_time"] - df["prev_event_time"]).dt.total_seconds() / 3600
    df["month"] = df["event_time"].dt.month
    df["day_of_year"] = df["event_time"].dt.dayofyear

    feature_cols = [
        "lat_bin",
        "lon_bin",
        "prev_mag_1",
        "prev_mag_2",
        "prev_depth_1",
        "hours_since_prev",
        "month",
        "day_of_year",
    ]
    df = df.dropna(subset=feature_cols + ["magnitude"])

    if len(df) < min_rows:
        return ModelTrainingResult(
            model_name=model_name,
            status="skipped",
            reason=f"not enough lagged earthquake rows ({len(df)} < {min_rows})",
            rows_used=int(len(df)),
        )

    df["_sort_ts"] = df["event_time"]
    x_train, x_test, y_train, y_test = _split_time_ordered(
        df,
        feature_cols,
        ["magnitude"],
        test_size=test_size,
        min_test_rows=60,
    )

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                feature_cols,
            )
        ]
    )

    regressor = HistGradientBoostingRegressor(
        max_depth=7,
        learning_rate=0.05,
        max_iter=400,
        random_state=random_state,
    )

    pipeline = Pipeline(steps=[("prep", preprocessor), ("model", regressor)])
    pipeline.fit(x_train, y_train)

    preds = pipeline.predict(x_test)
    mae = float(mean_absolute_error(y_test, preds))
    rmse = float(np.sqrt(mean_squared_error(y_test, preds)))
    r2 = float(r2_score(y_test, preds))
    strong_actual = np.array(y_test) >= 5.5
    strong_pred = np.array(preds) >= 5.5
    strong_match = float((strong_actual == strong_pred).mean()) if len(strong_actual) else 0.0

    metrics = {
        "mae": mae,
        "rmse": rmse,
        "r2": r2,
        "strong_event_threshold_magnitude": 5.5,
        "strong_event_match_rate": strong_match,
    }

    artifact_path = _persist_artifact(
        output_dir,
        model_name,
        pipeline,
        {
            "task": "regression",
            "target_name": "next_event_magnitude",
            "feature_columns": feature_cols,
            "source_tables": ["earthquake_dataset"],
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "metrics": metrics,
        },
    )

    return ModelTrainingResult(
        model_name=model_name,
        status="trained",
        artifact_path=str(artifact_path),
        rows_used=int(len(df)),
        train_rows=int(len(x_train)),
        test_rows=int(len(x_test)),
        metrics=metrics,
    )


def _extract_alert_lat_lon(location: Any) -> tuple[float | None, float | None]:
    if not isinstance(location, dict):
        return None, None

    lat = location.get("lat", location.get("latitude"))
    lon = location.get("lon", location.get("longitude"))
    try:
        if lat is None or lon is None:
            return None, None
        return float(lat), float(lon)
    except (TypeError, ValueError):
        return None, None


def _severity_to_wind(severity: Any) -> float:
    sev = str(severity or "").lower().strip()
    if sev in {"critical", "extreme", "red"}:
        return 160.0
    if sev in {"high", "severe", "orange"}:
        return 120.0
    if sev in {"medium", "moderate", "warning", "yellow"}:
        return 80.0
    return 55.0


def _assign_storm_ids_from_time_gaps(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    ordered = df.sort_values("timestamp").reset_index(drop=True)
    storm_ids: List[str] = []
    current_id = 0
    prev_row = None

    for _, row in ordered.iterrows():
        start_new = False
        if prev_row is None:
            start_new = True
        else:
            gap_h = (row["timestamp"] - prev_row["timestamp"]).total_seconds() / 3600
            dist_km = _haversine_km(prev_row["lat"], prev_row["lon"], row["lat"], row["lon"])
            if gap_h > 18 or dist_km > 450:
                start_new = True

        if start_new:
            current_id += 1
        storm_ids.append(f"storm_{current_id:04d}")
        prev_row = row

    ordered["storm_id"] = storm_ids
    return ordered


def _load_cyclone_tracks_from_alerts(alert_df: pd.DataFrame) -> pd.DataFrame:
    if alert_df.empty:
        return pd.DataFrame(columns=["storm_id", "timestamp", "lat", "lon", "wind_kmh", "source"])

    allowed = {"cyclone", "storm", "tropical_storm"}
    records = []

    for _, row in alert_df.iterrows():
        alert_type = str(row.get("alert_type") or "").lower().strip()
        if alert_type not in allowed:
            continue

        timestamp = pd.to_datetime(row.get("created_at"), errors="coerce", utc=True)
        lat, lon = _extract_alert_lat_lon(row.get("location"))
        if pd.isna(timestamp) or lat is None or lon is None:
            continue

        metadata = row.get("alert_metadata") if isinstance(row.get("alert_metadata"), dict) else {}
        wind = metadata.get("wind_speed_kmh", metadata.get("wind_kmh", metadata.get("wind_speed")))
        wind_kmh = _safe_float(wind, default=np.nan)
        if np.isnan(wind_kmh):
            wind_kmh = _severity_to_wind(row.get("severity"))

        records.append(
            {
                "timestamp": timestamp,
                "lat": float(lat),
                "lon": float(lon),
                "wind_kmh": float(wind_kmh),
                "source": row.get("source") or "alerts",
            }
        )

    if not records:
        return pd.DataFrame(columns=["storm_id", "timestamp", "lat", "lon", "wind_kmh", "source"])

    tracks = pd.DataFrame(records)
    tracks = _assign_storm_ids_from_time_gaps(tracks)
    return tracks


def _load_cyclone_tracks_from_csv(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    required = {"timestamp", "lat", "lon"}
    missing = required.difference(df.columns)
    if missing:
        raise ValueError(f"Cyclone CSV missing required columns: {sorted(missing)}")

    if "wind_kmh" not in df.columns:
        for candidate in ["wind_speed_kmh", "wind_speed", "wind"]:
            if candidate in df.columns:
                df["wind_kmh"] = df[candidate]
                break
    if "wind_kmh" not in df.columns:
        df["wind_kmh"] = 90.0

    df["timestamp"] = _parse_dt(df["timestamp"])
    df["lat"] = pd.to_numeric(df["lat"], errors="coerce")
    df["lon"] = pd.to_numeric(df["lon"], errors="coerce")
    df["wind_kmh"] = pd.to_numeric(df["wind_kmh"], errors="coerce")
    df = df.dropna(subset=["timestamp", "lat", "lon", "wind_kmh"]).copy()

    if "storm_id" not in df.columns:
        df = _assign_storm_ids_from_time_gaps(df)
    else:
        df["storm_id"] = df["storm_id"].astype(str)

    if "source" not in df.columns:
        df["source"] = "csv"

    return df[["storm_id", "timestamp", "lat", "lon", "wind_kmh", "source"]]


def _build_cyclone_supervised(tracks: pd.DataFrame) -> pd.DataFrame:
    rows = []

    for storm_id, group in tracks.groupby("storm_id"):
        g = group.sort_values("timestamp").reset_index(drop=True)
        if len(g) < 2:
            continue

        g["next_lat"] = g["lat"].shift(-1)
        g["next_lon"] = g["lon"].shift(-1)
        g["next_wind_kmh"] = g["wind_kmh"].shift(-1)
        g["next_timestamp"] = g["timestamp"].shift(-1)
        g["delta_hours"] = (g["next_timestamp"] - g["timestamp"]).dt.total_seconds() / 3600

        usable = g.dropna(subset=["next_lat", "next_lon", "next_wind_kmh", "delta_hours"])  # last row dropped
        for _, row in usable.iterrows():
            rows.append(
                {
                    "storm_id": storm_id,
                    "timestamp": row["timestamp"],
                    "lat": row["lat"],
                    "lon": row["lon"],
                    "wind_kmh": row["wind_kmh"],
                    "delta_hours": row["delta_hours"],
                    "month": row["timestamp"].month,
                    "hour": row["timestamp"].hour,
                    "next_lat": row["next_lat"],
                    "next_lon": row["next_lon"],
                    "next_wind_kmh": row["next_wind_kmh"],
                }
            )

    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)


def train_cyclone_model(
    alert_df: pd.DataFrame,
    output_dir: Path,
    min_rows: int,
    test_size: float,
    random_state: int,
    cyclone_csv: Path | None,
) -> ModelTrainingResult:
    model_name = "cyclone_trajectory"

    if cyclone_csv and cyclone_csv.exists():
        tracks = _load_cyclone_tracks_from_csv(cyclone_csv)
        source_note = f"csv:{cyclone_csv.name}"
    else:
        tracks = _load_cyclone_tracks_from_alerts(alert_df)
        source_note = "alerts_fallback"

    if tracks.empty:
        return ModelTrainingResult(
            model_name=model_name,
            status="skipped",
            reason="no cyclone tracks available (provide --cyclone-csv for better training)",
        )

    supervised = _build_cyclone_supervised(tracks)
    if supervised.empty or len(supervised) < min_rows:
        return ModelTrainingResult(
            model_name=model_name,
            status="skipped",
            reason=f"not enough cyclone sequence rows ({len(supervised)} < {min_rows})",
            rows_used=int(len(supervised)),
        )

    feature_cols = ["lat", "lon", "wind_kmh", "delta_hours", "month", "hour"]
    target_cols = ["next_lat", "next_lon", "next_wind_kmh"]

    supervised["_sort_ts"] = _parse_dt(supervised["timestamp"])
    x_train, x_test, y_train, y_test = _split_time_ordered(
        supervised,
        feature_cols,
        target_cols,
        test_size=test_size,
        min_test_rows=50,
    )

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                feature_cols,
            )
        ]
    )

    reg = MultiOutputRegressor(
        RandomForestRegressor(
            n_estimators=500,
            max_depth=16,
            min_samples_leaf=2,
            random_state=random_state,
            n_jobs=-1,
        )
    )
    pipeline = Pipeline(steps=[("prep", preprocessor), ("model", reg)])
    pipeline.fit(x_train, y_train)

    preds = pipeline.predict(x_test)
    pred_df = pd.DataFrame(preds, columns=target_cols)
    y_test_df = pd.DataFrame(y_test, columns=target_cols)

    mae_lat = float(mean_absolute_error(y_test_df["next_lat"], pred_df["next_lat"]))
    mae_lon = float(mean_absolute_error(y_test_df["next_lon"], pred_df["next_lon"]))
    mae_wind = float(mean_absolute_error(y_test_df["next_wind_kmh"], pred_df["next_wind_kmh"]))

    track_errors = []
    for i in range(len(pred_df)):
        track_errors.append(
            _haversine_km(
                float(y_test_df.iloc[i]["next_lat"]),
                float(y_test_df.iloc[i]["next_lon"]),
                float(pred_df.iloc[i]["next_lat"]),
                float(pred_df.iloc[i]["next_lon"]),
            )
        )

    metrics = {
        "mae_next_lat": mae_lat,
        "mae_next_lon": mae_lon,
        "mae_next_wind_kmh": mae_wind,
        "mean_track_error_km": float(np.mean(track_errors)) if track_errors else None,
        "median_track_error_km": float(np.median(track_errors)) if track_errors else None,
    }

    artifact_path = _persist_artifact(
        output_dir,
        model_name,
        pipeline,
        {
            "task": "multi_output_regression",
            "target_names": target_cols,
            "feature_columns": feature_cols,
            "source_tables": [source_note],
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "metrics": metrics,
        },
    )

    return ModelTrainingResult(
        model_name=model_name,
        status="trained",
        artifact_path=str(artifact_path),
        rows_used=int(len(supervised)),
        train_rows=int(len(x_train)),
        test_rows=int(len(x_test)),
        metrics=metrics,
    )


def _merge_weather_into_aqi(aqi_df: pd.DataFrame, weather_df: pd.DataFrame) -> pd.DataFrame:
    if aqi_df.empty:
        return aqi_df

    base = aqi_df.copy()
    base["lat_r"] = pd.to_numeric(base["lat"], errors="coerce").round(1)
    base["lon_r"] = pd.to_numeric(base["lon"], errors="coerce").round(1)
    base["ts_hour"] = _parse_dt(base["observation_time"]).dt.floor("h")

    if weather_df.empty:
        return base

    wx = weather_df.copy()
    wx["lat_r"] = pd.to_numeric(wx["lat"], errors="coerce").round(1)
    wx["lon_r"] = pd.to_numeric(wx["lon"], errors="coerce").round(1)
    wx["ts_hour"] = _parse_dt(wx["observation_time"]).dt.floor("h")

    wx_cols = [
        "lat_r",
        "lon_r",
        "ts_hour",
        "temperature",
        "humidity",
        "wind_speed",
        "pressure",
        "rain",
    ]

    wx = wx[wx_cols].drop_duplicates(subset=["lat_r", "lon_r", "ts_hour"], keep="last")
    merged = base.merge(wx, on=["lat_r", "lon_r", "ts_hour"], how="left")
    return merged


def train_aqi_model(
    aqi_df: pd.DataFrame,
    weather_df: pd.DataFrame,
    output_dir: Path,
    min_rows: int,
    test_size: float,
    random_state: int,
) -> ModelTrainingResult:
    model_name = "aqi_forecast"
    if aqi_df.empty:
        return ModelTrainingResult(model_name=model_name, status="skipped", reason="aqi_dataset is empty")

    df = _merge_weather_into_aqi(aqi_df, weather_df)

    df["observation_time"] = _parse_dt(df.get("observation_time"))
    df["aqi"] = pd.to_numeric(df.get("aqi"), errors="coerce")

    pollutant_cols = ["pm25", "pm10", "no2", "o3", "so2", "co"]
    for col in pollutant_cols:
        if col not in df.columns:
            df[col] = np.nan
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["observation_time", "aqi"])
    if len(df) < min_rows:
        return ModelTrainingResult(
            model_name=model_name,
            status="skipped",
            reason=f"not enough usable AQI rows ({len(df)} < {min_rows})",
            rows_used=int(len(df)),
        )

    df["city_key"] = (
        df.get("city").astype(str).str.strip().replace({"": np.nan})
    )
    missing_city = df["city_key"].isna()
    df.loc[missing_city, "city_key"] = (
        "loc_"
        + df.loc[missing_city, "lat"].round(2).astype(str)
        + "_"
        + df.loc[missing_city, "lon"].round(2).astype(str)
    )

    df = df.sort_values(["city_key", "observation_time"]).reset_index(drop=True)

    grouped = df.groupby("city_key", sort=False)
    for lag in [1, 3, 6, 12, 24]:
        df[f"aqi_lag_{lag}"] = grouped["aqi"].shift(lag)

    for col in ["pm25", "pm10", "no2", "o3"]:
        df[f"{col}_lag_1"] = grouped[col].shift(1)

    df["target_next_aqi"] = grouped["aqi"].shift(-1)
    df["hour"] = df["observation_time"].dt.hour
    df["day_of_week"] = df["observation_time"].dt.dayofweek
    df["month"] = df["observation_time"].dt.month
    df["_sort_ts"] = df["observation_time"]

    feature_cols = [
        "aqi",
        "aqi_lag_1",
        "aqi_lag_3",
        "aqi_lag_6",
        "aqi_lag_12",
        "aqi_lag_24",
        "pm25",
        "pm10",
        "no2",
        "o3",
        "so2",
        "co",
        "pm25_lag_1",
        "pm10_lag_1",
        "no2_lag_1",
        "o3_lag_1",
        "temperature",
        "humidity",
        "wind_speed",
        "pressure",
        "rain",
        "hour",
        "day_of_week",
        "month",
    ]

    for col in feature_cols:
        if col not in df.columns:
            df[col] = np.nan

    df = df.dropna(subset=["target_next_aqi"])
    if len(df) < min_rows:
        return ModelTrainingResult(
            model_name=model_name,
            status="skipped",
            reason=f"not enough lagged AQI rows ({len(df)} < {min_rows})",
            rows_used=int(len(df)),
        )

    x_train, x_test, y_train, y_test = _split_time_ordered(
        df,
        feature_cols,
        ["target_next_aqi"],
        test_size=test_size,
        min_test_rows=80,
    )

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(steps=[("imputer", SimpleImputer(strategy="median"))]),
                feature_cols,
            )
        ]
    )

    regressor = HistGradientBoostingRegressor(
        max_depth=8,
        learning_rate=0.05,
        max_iter=450,
        random_state=random_state,
    )

    pipeline = Pipeline(steps=[("prep", preprocessor), ("model", regressor)])
    pipeline.fit(x_train, y_train)

    preds = pipeline.predict(x_test)
    mae = float(mean_absolute_error(y_test, preds))
    rmse = float(np.sqrt(mean_squared_error(y_test, preds)))
    r2 = float(r2_score(y_test, preds))
    abs_err = np.abs(np.array(y_test) - np.array(preds))

    metrics = {
        "mae": mae,
        "rmse": rmse,
        "r2": r2,
        "within_15_aqi_pct": float((abs_err <= 15).mean()) if len(abs_err) else 0.0,
        "within_25_aqi_pct": float((abs_err <= 25).mean()) if len(abs_err) else 0.0,
    }

    artifact_path = _persist_artifact(
        output_dir,
        model_name,
        pipeline,
        {
            "task": "regression",
            "target_name": "aqi_t_plus_1",
            "feature_columns": feature_cols,
            "source_tables": ["aqi_dataset", "weather_dataset"],
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "metrics": metrics,
        },
    )

    return ModelTrainingResult(
        model_name=model_name,
        status="trained",
        artifact_path=str(artifact_path),
        rows_used=int(len(df)),
        train_rows=int(len(x_train)),
        test_rows=int(len(x_test)),
        metrics=metrics,
    )


async def run_training(args: argparse.Namespace) -> Dict[str, Any]:
    output_dir = Path(args.output_dir)
    model_set = _parse_model_selection(args.models)

    LOGGER.info("Loading datasets from database...")
    frames = await _load_training_frames(max_rows=args.max_rows)

    summary: Dict[str, Any] = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "output_dir": str(output_dir.resolve()),
        "requested_models": sorted(model_set),
        "dataset_row_counts": {k: int(len(v)) for k, v in frames.items()},
        "results": [],
    }

    if "flood_prediction" in model_set:
        try:
            result = train_flood_model(
                flood_df=frames["flood"],
                output_dir=output_dir,
                min_rows=args.min_rows,
                test_size=args.test_size,
                random_state=args.random_state,
            )
            summary["results"].append(result.to_dict())
            LOGGER.info("Flood model: %s", result.status)
        except Exception as exc:  # pragma: no cover - defensive failure capture
            LOGGER.exception("Flood model training failed")
            summary["results"].append(
                ModelTrainingResult(
                    model_name="flood_prediction",
                    status="failed",
                    reason=str(exc),
                ).to_dict()
            )

    if "earthquake_risk" in model_set:
        try:
            result = train_earthquake_model(
                earthquake_df=frames["earthquake"],
                output_dir=output_dir,
                min_rows=args.min_rows,
                test_size=args.test_size,
                random_state=args.random_state,
            )
            summary["results"].append(result.to_dict())
            LOGGER.info("Earthquake model: %s", result.status)
        except Exception as exc:  # pragma: no cover
            LOGGER.exception("Earthquake model training failed")
            summary["results"].append(
                ModelTrainingResult(
                    model_name="earthquake_risk",
                    status="failed",
                    reason=str(exc),
                ).to_dict()
            )

    if "cyclone_trajectory" in model_set:
        try:
            cyclone_csv = Path(args.cyclone_csv) if args.cyclone_csv else None
            result = train_cyclone_model(
                alert_df=frames["alerts"],
                output_dir=output_dir,
                min_rows=args.min_rows,
                test_size=args.test_size,
                random_state=args.random_state,
                cyclone_csv=cyclone_csv,
            )
            summary["results"].append(result.to_dict())
            LOGGER.info("Cyclone model: %s", result.status)
        except Exception as exc:  # pragma: no cover
            LOGGER.exception("Cyclone model training failed")
            summary["results"].append(
                ModelTrainingResult(
                    model_name="cyclone_trajectory",
                    status="failed",
                    reason=str(exc),
                ).to_dict()
            )

    if "aqi_forecast" in model_set:
        try:
            result = train_aqi_model(
                aqi_df=frames["aqi"],
                weather_df=frames["weather"],
                output_dir=output_dir,
                min_rows=args.min_rows,
                test_size=args.test_size,
                random_state=args.random_state,
            )
            summary["results"].append(result.to_dict())
            LOGGER.info("AQI model: %s", result.status)
        except Exception as exc:  # pragma: no cover
            LOGGER.exception("AQI model training failed")
            summary["results"].append(
                ModelTrainingResult(
                    model_name="aqi_forecast",
                    status="failed",
                    reason=str(exc),
                ).to_dict()
            )

    success_count = sum(1 for r in summary["results"] if r["status"] == "trained")
    skipped_count = sum(1 for r in summary["results"] if r["status"] == "skipped")
    failed_count = sum(1 for r in summary["results"] if r["status"] == "failed")
    summary["counts"] = {
        "trained": success_count,
        "skipped": skipped_count,
        "failed": failed_count,
    }

    summary_path = output_dir / "training_summary.json"
    _save_json(summary_path, summary)
    LOGGER.info("Training summary saved to: %s", summary_path)
    return summary


def _parse_model_selection(models_arg: str) -> set[str]:
    raw = {m.strip() for m in models_arg.split(",") if m.strip()}
    if not raw or raw == {"all"}:
        return set(AVAILABLE_MODELS)

    invalid = raw.difference(AVAILABLE_MODELS)
    if invalid:
        raise ValueError(f"Unknown models requested: {sorted(invalid)}")
    return raw


def parse_args() -> argparse.Namespace:
    default_output = str((BACKEND_DIR / "model_artifacts").resolve())

    parser = argparse.ArgumentParser(description="Train production-ready Suraksha Setu ML models")
    parser.add_argument(
        "--models",
        type=str,
        default="all",
        help="Comma-separated model IDs (all, flood_prediction, earthquake_risk, cyclone_trajectory, aqi_forecast)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=default_output,
        help="Directory to write .joblib artifacts and training summary",
    )
    parser.add_argument(
        "--min-rows",
        type=int,
        default=200,
        help="Minimum usable rows required to train a model",
    )
    parser.add_argument(
        "--max-rows",
        type=int,
        default=200000,
        help="Maximum rows fetched per source table",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Test split ratio in range (0,1)",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed for reproducibility",
    )
    parser.add_argument(
        "--cyclone-csv",
        type=str,
        default="",
        help="Optional cyclone tracks CSV path (columns: storm_id(optional),timestamp,lat,lon,wind_kmh)",
    )
    return parser.parse_args()


def configure_logging(verbose: bool = True) -> None:
    level = logging.INFO if verbose else logging.WARNING
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    )


async def _async_main(args: argparse.Namespace) -> int:
    if not (0 < args.test_size < 1):
        raise ValueError("--test-size must be in range (0,1)")

    summary = await run_training(args)

    trained = summary["counts"]["trained"]
    failed = summary["counts"]["failed"]
    LOGGER.info("Training completed. trained=%s failed=%s", trained, failed)

    await close_db()
    return 1 if failed > 0 else 0


def main() -> int:
    args = parse_args()
    configure_logging()

    try:
        return asyncio.run(_async_main(args))
    except Exception as exc:  # pragma: no cover
        LOGGER.exception("Training pipeline terminated with error: %s", exc)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
