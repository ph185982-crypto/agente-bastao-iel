#!/usr/bin/env python
"""Texturas proprias (procedurais): papel, granulacao e desgaste. Nada baixado, nada com licenca."""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).parent / "texturas"
OUT.mkdir(exist_ok=True)
rng = np.random.default_rng(42)
W, H = 1080, 1920


def ruido(w, h, escala):
    small = rng.standard_normal((max(h // escala, 2), max(w // escala, 2)))
    return np.asarray(Image.fromarray(small.astype(np.float32), mode="F").resize((w, h), Image.BICUBIC))


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32)


def papel(cor, nome, fibras=True, manchas=0.06, grao=6.0):
    base = np.ones((H, W, 3), np.float32) * hexrgb(cor)
    n = ruido(W, H, 180) * 0.5 + ruido(W, H, 40) * 0.3 + ruido(W, H, 6) * 0.2
    base *= (1 + manchas * n)[..., None]
    base += rng.normal(0, grao, (H, W, 1))
    if fibras:
        img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
        f = Image.new("L", (W, H), 0)
        from PIL import ImageDraw
        d = ImageDraw.Draw(f)
        for _ in range(900):
            x, y = rng.uniform(0, W), rng.uniform(0, H)
            a, L = rng.uniform(0, np.pi), rng.uniform(8, 40)
            d.line([(x, y), (x + L * np.cos(a), y + L * np.sin(a))], fill=int(rng.uniform(20, 60)), width=1)
        f = f.filter(ImageFilter.GaussianBlur(0.6))
        arr = np.asarray(img).astype(np.float32) - np.asarray(f, np.float32)[..., None] * 0.25
        base = arr
    # vinheta leve
    yy, xx = np.mgrid[0:H, 0:W]
    v = 1 - 0.18 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    base *= v[..., None]
    Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).save(OUT / f"{nome}.jpg", quality=92)


papel("#F7F3EA", "papel_marfim")
papel("#1457D9", "papel_azul", fibras=False, manchas=0.16, grao=9)
papel("#171717", "papel_carvao", fibras=False, manchas=0.35, grao=7)

# granulacao animada (4 quadros alternados), alfa
for k in range(4):
    g = rng.normal(128, 40, (H // 2, W // 2)).clip(0, 255).astype(np.uint8)
    Image.fromarray(g).resize((W, H), Image.NEAREST).save(OUT / f"grao_{k}.png")

# respingos/desgaste para texto (alfa: 255 = buraco)
sp = np.zeros((900, 1080), np.float32)
n = ruido(1080, 900, 3) + 0.6 * ruido(1080, 900, 14)
sp[n > 1.55] = 255
pts = rng.integers(0, [900, 1080], (5000, 2))
for y, x in pts:
    sp[y, x:x + rng.integers(1, 4)] = 255
alfa = Image.fromarray(sp.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.5))
rgba = Image.new("RGBA", alfa.size, (0, 0, 0, 0)); rgba.putalpha(alfa)   # alfa = buracos do desgaste
rgba.save(OUT / "desgaste.png")
print("texturas:", sorted(p.name for p in OUT.iterdir()))
