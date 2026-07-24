#!/usr/bin/env python3
"""Split /tmp/all_prompts.json into per-reviewer files: /tmp/waves/w{NN}_p{MM}.json"""
import json
import re
from pathlib import Path

SRC = Path("/tmp/all_prompts.json")
OUT_DIR = Path("/tmp/waves")
OUT_DIR.mkdir(exist_ok=True)

data = json.loads(SRC.read_text())
WAVE_SIZE = 5

for i, prompt in enumerate(data):
    wave = i // WAVE_SIZE
    idx = i % WAVE_SIZE
    fname = OUT_DIR / f"w{wave:02d}_p{idx}.json"
    fname.write_text(json.dumps(prompt, ensure_ascii=False), encoding="utf-8")

print("waves", (len(data) + WAVE_SIZE - 1) // WAVE_SIZE, "prompts", len(data))
