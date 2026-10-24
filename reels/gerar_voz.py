#!/usr/bin/env python
"""Gera voz clonada a partir de texto.

Uso: python gerar_voz.py "texto" -o saida.wav [--modelo chatterbox|xtts]

Padrao: Chatterbox multilingue (MIT, uso comercial liberado), com os ajustes
"v4" escolhidos para a voz do Pedro (calma, pouca aspereza).
XTTS-v2 so serve para comparacao: os pesos sao NAO COMERCIAIS (CPML).
"""
import argparse
import json
import os
import re
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
import torch
import torchaudio

AQUI = Path(__file__).resolve().parent
REF_PADRAO = AQUI / "amostras" / "minha-voz.wav"
PRONUNCIAS = AQUI / "pronuncias.json"  # {"Roseta": "Rozeta"} - so afeta a fala
MAX_CHARS = 220  # trechos longos degradam a qualidade; quebramos por frase

# Ajustes v4 (escolhidos de ouvido): menos expressivo, ritmo e temperatura baixos.
EXAGERO, CFG, TEMPERATURA = 0.25, 0.3, 0.5


def normalizar_texto(texto: str) -> str:
    """Prepara o texto para a sintese: numeros por extenso e pronuncias."""
    from num2words import num2words

    def rodovia(m):  # BR-040 -> "bê-érre zero quarenta"; BR-101 -> "bê-érre cento e um"
        d = m.group(2)
        falado = ("zero " if d.startswith("0") else "") + num2words(int(d), lang="pt_BR").replace(",", "")
        return f"{'bê-érre' if m.group(1).upper() == 'BR' else m.group(1)} {falado}"

    texto = re.sub(r"\b(BR|SP|MG|RJ|GO|BA|PR|SC|RS)-?(\d{3})\b", rodovia, texto)
    texto = re.sub(r"(?<=\d)\.(?=\d{3}\b)", "", texto)  # 1.500 -> 1500
    texto = re.sub(r"(\d+)\s*%", r"\1 por cento", texto)
    texto = re.sub(
        r"\d+", lambda m: num2words(int(m.group()), lang="pt_BR").replace(",", ""), texto
    )
    if PRONUNCIAS.exists():
        for palavra, falada in json.loads(PRONUNCIAS.read_text(encoding="utf-8")).items():
            texto = re.sub(rf"\b{re.escape(palavra)}\b", falada, texto)
    return re.sub(r"\s+", " ", texto).strip()


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


class Sintetizador:
    """Carrega o modelo uma vez e gera varias falas com a mesma voz."""

    def __init__(self, modelo="chatterbox", ref=REF_PADRAO, lang="pt", device="auto",
                 exagero=EXAGERO, cfg=CFG, temperatura=TEMPERATURA):
        self.modelo, self.lang = modelo, lang
        self.device = escolher_dispositivo(device)
        self.exagero, self.cfg, self.temperatura = exagero, cfg, temperatura
        ref = Path(ref)
        if not ref.exists():
            print(f"AVISO: referencia {ref} nao encontrada; usando a voz padrao do modelo.",
                  file=sys.stderr)
            ref = None
        self.ref = ref
        if modelo == "chatterbox":
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS

            self._m = ChatterboxMultilingualTTS.from_pretrained(device=self.device)
            self.sr = self._m.sr
        else:
            print("AVISO: pesos do XTTS-v2 sao NAO COMERCIAIS (CPML). Use so para comparar.",
                  file=sys.stderr)
            if not ref:
                sys.exit("XTTS precisa de uma amostra de voz (--ref).")
            os.environ.setdefault("COQUI_TOS_AGREED", "1")
            from TTS.api import TTS

            self._m = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(self.device)
            self.sr = self._m.synthesizer.output_sample_rate

    def sintetizar(self, texto: str, seed: int = 7) -> torch.Tensor:
        """Devolve um tensor [1, amostras] na taxa self.sr."""
        torch.manual_seed(seed)
        pecas = []
        for t in dividir_texto(normalizar_texto(texto)):
            if self.modelo == "chatterbox":
                kw = dict(language_id=self.lang, exaggeration=self.exagero,
                          cfg_weight=self.cfg, temperature=self.temperatura)
                if self.ref:
                    kw["audio_prompt_path"] = str(self.ref)
                pecas.append(self._m.generate(t, **kw).cpu())
            else:
                wav = self._m.tts(text=t, speaker_wav=str(self.ref), language=self.lang)
                pecas.append(torch.tensor(wav).unsqueeze(0))
        return torch.cat(pecas, dim=-1)


def main():
    p = argparse.ArgumentParser(description="Gera voz clonada (padrao: Chatterbox).")
    p.add_argument("texto")
    p.add_argument("-o", "--saida", default="saida.wav")
    p.add_argument("--modelo", choices=["chatterbox", "xtts"], default="chatterbox")
    p.add_argument("--ref", default=str(REF_PADRAO), help="WAV de referencia da voz")
    p.add_argument("--lang", default="pt")
    p.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    p.add_argument("--exagero", type=float, default=EXAGERO, help="Chatterbox: expressividade")
    p.add_argument("--cfg", type=float, default=CFG, help="Chatterbox: cfg_weight (ritmo)")
    p.add_argument("--temperatura", type=float, default=TEMPERATURA)
    p.add_argument("--seed", type=int, default=7)
    a = p.parse_args()

    s = Sintetizador(a.modelo, a.ref, a.lang, a.device, a.exagero, a.cfg, a.temperatura)
    wav = s.sintetizar(a.texto, a.seed)
    saida = Path(a.saida)
    saida.parent.mkdir(parents=True, exist_ok=True)
    torchaudio.save(str(saida), wav, s.sr)
    print(f"{saida} ({wav.shape[-1] / s.sr:.1f}s, {s.sr} Hz)")


if __name__ == "__main__":
    main()
