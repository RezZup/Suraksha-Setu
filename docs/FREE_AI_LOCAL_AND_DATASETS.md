# Free AI (Ollama) + OpenAI Fallback

This setup gives you:
- Optional free-first inference using local Ollama (opt-in)
- OpenAI fallback for higher quality/reliability
- Region-aware adaptation guidance

## 1) Backend Environment

Add these to backend/.env:

```env
# Free AI routing
FREE_AI_ENABLED=false
FREE_AI_PROVIDER_ORDER=ollama
FREE_CHAT_FIRST=false
FREE_VISION_FIRST=false
FREE_STT_FIRST=false
FREE_CHAT_MIN_CHARS=40

# Local Ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_TIMEOUT_SECONDS=15
OLLAMA_MODEL_CHAT=llama3.1:8b-instruct-q4_K_M
OLLAMA_MODEL_VISION=llava:7b

# Existing OpenAI fallback (keep configured)
OPENAI_API_KEY=sk-...
OPENAI_MODEL_MINI=gpt-4o-mini
OPENAI_MODEL_HEAVY=gpt-4o
```

Set FREE_AI_ENABLED=true and FREE_*_FIRST=true only if you explicitly want to enable local Ollama paths.

## 2) Local Runtime Notes

- Install and run Ollama locally.
- Pull your models before starting backend:

```bash
ollama pull llama3.1:8b-instruct-q4_K_M
ollama pull llava:7b
```

- Keep OpenAI configured as fallback for cases where free output is weak or unavailable.

## 3) Region-Aware Training (LoRA)

Use:
- scripts/training/train_region_adapter.py

Expected JSONL:

```json
{"region":"odisha_coastal","instruction":"What to do during cyclone warning?","input":"Wind 120 km/h expected","output":"Move to nearest shelter, keep emergency kit, avoid coastal roads."}
```

Run in your preferred training environment:

```bash
pip install transformers datasets peft trl accelerate bitsandbytes
python scripts/training/train_region_adapter.py \
   --dataset_path data/region_train.jsonl \
   --output_dir artifacts/region-lora
```

## 4) Recommended Datasets

For disaster image/text understanding:
- xView2 (satellite disaster damage)
- CrisisMMD (multimodal disaster social media)
- FloodNet (flood scene segmentation/classification)
- MediaEval Flood-related multimedia tasks (historical benchmarks)

For misinformation/fake-content signals:
- Fakeddit (multimodal fake news)
- FakeNewsNet (text-centric fake-news patterns)

For local hazard context (India/regional):
- IMD weather alerts + local historical weather records
- CPCB AQI history (already used in your stack)
- USGS + national earthquake bulletins
- ISRO MOSDAC products (already integrated)

## 5) Region Mismatch Problem (Very Important)

If training data region is very different from your place, do this:

1. Region tokens in prompts:
   - Add tags like region=odisha_coastal, terrain=delta, season=monsoon.
2. Fine-tune with local samples:
   - Keep at least 20-30% local-region examples in each epoch.
3. Sample reweighting:
   - Give higher weight to local-region records during training.
4. Calibration by region:
   - Maintain separate thresholds per region (flood-prone vs dry zones).
5. Human-in-the-loop for high-risk outputs:
   - Suspected fake or critical alerts should require manual review.
6. Continuous learning loop:
   - Log false positives/false negatives by region and retrain monthly.

## 6) Practical Policy for Your App

- Low-risk community Q&A: free model response accepted.
- Safety-critical output (alerts, emergency classification, fake-image flags):
  - free model first,
  - OpenAI verification fallback,
  - manual review for uncertain or high-impact cases.

This gives low cost + good speed + safer decisions.
