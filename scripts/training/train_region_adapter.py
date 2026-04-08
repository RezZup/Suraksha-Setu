"""
Region-aware LoRA fine-tuning script.

This trains a lightweight adapter so model behavior matches your local region language,
risk patterns, and response style.

Expected dataset format (JSONL):
{"region":"odisha_coastal","instruction":"What should I do if cyclone warning is issued?","input":"Wind speed expected 120 km/h","output":"Move to shelter..."}

Example run:
python scripts/training/train_region_adapter.py \
    --dataset_path data/region_train.jsonl \
    --output_dir artifacts/region-lora
"""

# pyright: reportMissingImports=false

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass

from datasets import load_dataset
from peft import LoraConfig, get_peft_model
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments,
)
from trl import SFTTrainer


DEFAULT_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"


@dataclass
class TrainConfig:
    model_name: str
    dataset_path: str
    output_dir: str
    max_seq_len: int
    batch_size: int
    grad_accum: int
    lr: float
    epochs: int


def _build_prompt(region: str, instruction: str, user_input: str, output: str) -> str:
    region = (region or "unknown_region").strip().lower().replace(" ", "_")
    return (
        "<|system|>\n"
        "You are Suraksha Setu disaster assistant. "
        "Respect local region context, language style, and practical constraints.\n"
        f"Region: {region}\n"
        "</s>\n"
        "<|user|>\n"
        f"Instruction: {instruction}\n"
        f"Context: {user_input or ''}\n"
        "</s>\n"
        "<|assistant|>\n"
        f"{output}\n"
        "</s>"
    )


def _prepare_dataset(path: str):
    ds = load_dataset("json", data_files=path, split="train")

    def _map_row(row):
        text = _build_prompt(
            region=row.get("region", "unknown_region"),
            instruction=row.get("instruction", ""),
            user_input=row.get("input", ""),
            output=row.get("output", ""),
        )
        return {"text": text}

    return ds.map(_map_row, remove_columns=ds.column_names)


def train(cfg: TrainConfig):
    use_4bit = True
    quant = BitsAndBytesConfig(
        load_in_4bit=use_4bit,
        bnb_4bit_compute_dtype="float16",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_quant_type="nf4",
    )

    tokenizer = AutoTokenizer.from_pretrained(cfg.model_name, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        cfg.model_name,
        quantization_config=quant,
        device_map="auto",
    )

    lora = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )

    model = get_peft_model(model, lora)
    train_ds = _prepare_dataset(cfg.dataset_path)

    args = TrainingArguments(
        output_dir=cfg.output_dir,
        per_device_train_batch_size=cfg.batch_size,
        gradient_accumulation_steps=cfg.grad_accum,
        learning_rate=cfg.lr,
        num_train_epochs=cfg.epochs,
        logging_steps=20,
        save_steps=200,
        fp16=True,
        bf16=False,
        report_to=[],
        gradient_checkpointing=True,
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_ds,
        dataset_text_field="text",
        max_seq_length=cfg.max_seq_len,
        args=args,
    )

    trainer.train()
    trainer.model.save_pretrained(cfg.output_dir)
    tokenizer.save_pretrained(cfg.output_dir)
    print(f"Saved region adapter to: {cfg.output_dir}")


def parse_args() -> TrainConfig:
    p = argparse.ArgumentParser()
    p.add_argument("--model_name", default=os.getenv("TRAIN_BASE_MODEL", DEFAULT_MODEL))
    p.add_argument("--dataset_path", required=True)
    p.add_argument("--output_dir", required=True)
    p.add_argument("--max_seq_len", type=int, default=1024)
    p.add_argument("--batch_size", type=int, default=2)
    p.add_argument("--grad_accum", type=int, default=8)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--epochs", type=int, default=2)
    a = p.parse_args()

    return TrainConfig(
        model_name=a.model_name,
        dataset_path=a.dataset_path,
        output_dir=a.output_dir,
        max_seq_len=a.max_seq_len,
        batch_size=a.batch_size,
        grad_accum=a.grad_accum,
        lr=a.lr,
        epochs=a.epochs,
    )


if __name__ == "__main__":
    config = parse_args()
    train(config)