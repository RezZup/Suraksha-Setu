"""
Simple prediction helper for Suraksha Setu model artifacts.

Examples:
  python scripts/predict_with_artifact.py \
      --artifact model_artifacts/flood_prediction.joblib \
      --input-json '{"lat":19.07,"lon":72.87,"source":"GDACS","status":"active","location":"Mumbai","casualties":0,"affected_population":1200,"month":7,"day_of_year":190,"is_monsoon":1}'

  python scripts/predict_with_artifact.py \
      --artifact model_artifacts/aqi_forecast.joblib \
      --input-file scripts/templates/aqi_sample_input.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict

import joblib
import numpy as np
import pandas as pd


def _json_default(value: Any):
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.ndarray,)):
        return value.tolist()
    return str(value)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local prediction using a saved .joblib artifact")
    parser.add_argument("--artifact", required=True, help="Path to artifact .joblib file")
    parser.add_argument("--input-json", default="", help="Inline JSON object for one sample")
    parser.add_argument("--input-file", default="", help="Path to JSON file containing an object or array")
    parser.add_argument("--show-metadata", action="store_true", help="Print artifact metadata before prediction")
    return parser.parse_args()


def load_input(args: argparse.Namespace) -> pd.DataFrame:
    if args.input_json:
        payload = json.loads(args.input_json)
    elif args.input_file:
        with open(args.input_file, "r", encoding="utf-8") as f:
            payload = json.load(f)
    else:
        raise ValueError("Provide either --input-json or --input-file")

    if isinstance(payload, dict):
        return pd.DataFrame([payload])
    if isinstance(payload, list):
        return pd.DataFrame(payload)
    raise ValueError("Input payload must be a JSON object or array")


def main() -> int:
    args = parse_args()
    artifact_path = Path(args.artifact)
    if not artifact_path.exists():
        raise FileNotFoundError(f"Artifact not found: {artifact_path}")

    bundle: Dict[str, Any] = joblib.load(artifact_path)
    pipeline = bundle.get("pipeline")
    metadata = bundle.get("metadata", {})

    if pipeline is None:
        raise ValueError("Invalid artifact: missing 'pipeline'")

    if args.show_metadata:
        print(json.dumps(metadata, indent=2, default=_json_default))

    frame = load_input(args)
    preds = pipeline.predict(frame)

    output = {
        "artifact": str(artifact_path),
        "rows": len(frame),
        "predictions": preds.tolist() if hasattr(preds, "tolist") else list(preds),
    }

    if hasattr(pipeline, "predict_proba"):
        try:
            probs = pipeline.predict_proba(frame)
            if isinstance(probs, list):
                output["predict_proba"] = [p.tolist() for p in probs]
            else:
                output["predict_proba"] = probs.tolist()
        except Exception:
            pass

    print(json.dumps(output, indent=2, default=_json_default))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
