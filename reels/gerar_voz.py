#!/usr/bin/env python
"""Gera voz clonada a partir de texto.

Uso: python gerar_voz.py "texto" -o saida.wav [--modelo chatterbox|xtts]

Padrao: Chatterbox multilingue (MIT, uso comercial liberado).
XTTS-v2 so serve para comparacao: os pesos sao NAO COMERCIAIS (CPML).
"""
import argparse
import os
import re
import sys
from pathlib import Path

import torch
import torchaudio

AQUI = Path(__file__).resolve().parent
REF_PADRAO = AQUI / "amostras" / "minha-voz.wav"
MAX_CHARS = 220  # trechos longos degradam a qualidade; quebramos por frase


def dividir_texto(texto: str, limite: int = MAX_CHARS) -> list[str]:
    frases = [f.strip() for f in re.split(r"(?<=[.!?…])\s+", texto.strip()) if f.strip()]
    trechos, atual = [], ""
    for f in frases:
        if atual and len(atual) + len(f) + 1 > limite:
            trechos.append(atual)
            atual = f
        else:
            atual = f"{atual} {f}".strip()
    if atual:
        trechos.append(atual)
    return trechos or [texto]


def escolher_dispositivo(pedido: str) -> str:
    if pedido != "auto":
        return pedido
    return "cuda" if torch.cuda.is_available() else "cpu"


def gerar_chatterbox(trechos, ref, lang, device, exagero, cfg):
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    modelo = ChatterboxMultilingualTTS.from_pretrained(device=device)
    pecas = []
    for i, t in enumerate(trechos, 1):
        print(f"[chatterbox {i}/{len(trechos)}] {t[:60]}", file=sys.stderr)
        kw = dict(language_id=lang, exaggeration=exagero, cfg_weight=cfg)
        if ref:
            kw["audio_prompt_path"] = str(ref)
        wav = modelo.generate(t, **kw)
        pecas.append(wav.cpu())
    return torch.cat(pecas, dim=-1), modelo.sr


def gerar_xtts(trechos, ref, lang, device):
    print("AVISO: pesos do XTTS-v2 sao NAO COMERCIAIS (CPML). Use so para comparar.",
          file=sys.stderr)
    os.environ.setdefault("COQUI_TOS_AGREED", "1")
    from TTS.api import TTS

    if not ref:
        sys.exit("XTTS precisa de uma amostra de voz (--ref).")
    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
    pecas = []
    for i, t in enumerate(trechos, 1):
        print(f"[xtts {i}/{len(trechos)}] {t[:60]}", file=sys.stderr)
        wav = tts.tts(text=t, speaker_wav=str(ref), language=lang)
        pecas.append(torch.tensor(wav).unsqueeze(0))
    return torch.cat(pecas, dim=-1), tts.synthesizer.output_sample_rate


def main():
    p = argparse.ArgumentParser(description="Gera voz clonada (padrao: Chatterbox).")
    p.add_argument("texto")
    p.add_argument("-o", "--saida", default="saida.wav")
    p.add_argument("--modelo", choices=["chatterbox", "xtts"], default="chatterbox")
    p.add_argument("--ref", default=str(REF_PADRAO), help="WAV de referencia da voz")
    p.add_argument("--lang", default="pt")
    p.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    p.add_argument("--exagero", type=float, default=0.5, help="Chatterbox: expressividade")
    p.add_argument("--cfg", type=float, default=0.5, help="Chatterbox: cfg_weight (ritmo)")
    a = p.parse_args()

    ref = Path(a.ref)
    if not ref.exists():
        print(f"AVISO: referencia {ref} nao encontrada; usando a voz padrao do modelo.",
              file=sys.stderr)
        ref = None

    device = escolher_dispositivo(a.device)
    trechos = dividir_texto(a.texto)
    if a.modelo == "chatterbox":
        wav, sr = gerar_chatterbox(trechos, ref, a.lang, device, a.exagero, a.cfg)
    else:
        wav, sr = gerar_xtts(trechos, ref, a.lang, device)

    saida = Path(a.saida)
    saida.parent.mkdir(parents=True, exist_ok=True)
    torchaudio.save(str(saida), wav, sr)
    print(f"{saida} ({wav.shape[-1] / sr:.1f}s, {sr} Hz)")


if __name__ == "__main__":
    main()
