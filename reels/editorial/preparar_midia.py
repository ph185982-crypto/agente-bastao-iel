#!/usr/bin/env python
"""Prepara as camadas de imagem a partir dos frames de referencia (recortes + inpainting local com OpenCV).

Uso: python editorial/preparar_midia.py editorial/projetos/constituicao-1988/midia.json
O JSON lista, por camada: frame de origem, recorte (coordenadas no frame), limpeza (cor a remover por
inpainting) e borda rasgada opcional. Nada e gerado do zero: so recortes e remocao do que vai ser animado.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter

RNG = np.random.default_rng(11)


def mascara_cor(img_bgr, cor):
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    if cor == "laranja":
        m = cv2.inRange(hsv, (5, 120, 140), (22, 255, 255))
    elif cor == "azul_tinta":
        m = cv2.inRange(hsv, (100, 90, 60), (130, 255, 255))
    else:
        raise ValueError(cor)
    return cv2.dilate(m, np.ones((5, 5), np.uint8), iterations=2)


def borda_rasgada(w, h, lados="tblr", amp=14, passo=9):
    """Mascara alfa com bordas de papel rasgado."""
    m = Image.new("L", (w, h), 0)
    from PIL import ImageDraw
    pts = []
    def linha(x0, y0, x1, y1, nx, ny, ativa):
        n = max(int(max(abs(x1 - x0), abs(y1 - y0)) / passo), 2)
        out = []
        for i in range(n + 1):
            u = i / n
            j = RNG.uniform(0, amp) if ativa else 0
            out.append((x0 + (x1 - x0) * u + nx * j, y0 + (y1 - y0) * u + ny * j))
        return out
    pts += linha(0, 0, w, 0, 0, 1, "t" in lados)
    pts += linha(w, 0, w, h, -1, 0, "r" in lados)
    pts += linha(w, h, 0, h, 0, -1, "b" in lados)
    pts += linha(0, h, 0, 0, 1, 0, "l" in lados)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m.filter(ImageFilter.GaussianBlur(0.8))


def main(cfg_path):
    cfg = json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    base = Path(cfg_path).parent
    frames = {k: Path(v) for k, v in cfg["frames"].items()}
    escala = cfg.get("escala", 1080 / 941)
    limpos = {}
    for nome, c in cfg["camadas"].items():
        fr = c["frame"]
        chave = (fr, tuple(c.get("limpar", [])))
        if chave not in limpos:
            img = cv2.imread(str(frames[fr]))
            for cor in c.get("limpar", []):
                m = mascara_cor(img, cor)
                if "limpar_area" in c:  # restringe a remocao a uma area do frame
                    x0, y0, x1, y1 = c["limpar_area"]
                    area = np.zeros_like(m); area[y0:y1, x0:x1] = 255
                    m = cv2.bitwise_and(m, area)
                img = cv2.inpaint(img, m, 9, cv2.INPAINT_TELEA)
            limpos[chave] = img
        img = limpos[chave]
        x0, y0, x1, y1 = c["recorte"]
        crop = Image.fromarray(cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2RGB))
        W, H = round(crop.width * escala * c.get("zoom", 1)), round(crop.height * escala * c.get("zoom", 1))
        crop = crop.resize((W, H), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.2, 60, 2))
        if c.get("rasgado"):
            crop.putalpha(borda_rasgada(W, H, c["rasgado"]))
        destino = base / "imagens" / f"{nome}.png"
        crop.save(destino)
        print(f"{nome}: {W}x{H}")


if __name__ == "__main__":
    main(sys.argv[1])
