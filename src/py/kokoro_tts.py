"""Kokoro TTS helper. Reads a JSON spec on stdin and writes one 24 kHz WAV per item.

Spec: {"lang_code": "a", "voice": "af_heart", "speed": 1.0, "items": [{"text": "...", "out": "/abs/path.wav"}]}
"""
import json
import sys
import warnings

warnings.filterwarnings("ignore")

import numpy as np
import soundfile as sf
from kokoro import KPipeline

SAMPLE_RATE = 24000


def main() -> None:
    spec = json.load(sys.stdin)
    pipeline = KPipeline(lang_code=spec["lang_code"], repo_id="hexgrad/Kokoro-82M")
    for item in spec["items"]:
        chunks = [np.asarray(audio) for _, _, audio in pipeline(item["text"], voice=spec["voice"], speed=spec["speed"])]
        if not chunks:
            raise SystemExit(f"Kokoro produced no audio for: {item['text'][:60]}")
        sf.write(item["out"], np.concatenate(chunks), SAMPLE_RATE)


if __name__ == "__main__":
    main()
