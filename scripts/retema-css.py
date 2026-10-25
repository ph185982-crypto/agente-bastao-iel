#!/usr/bin/env python3
"""Troca, nas folhas de estilo do app, as cores azul-acinzentadas do tema antigo pelos tons da marca.
Só mexe em cores de matiz azul (190–260°); verdes, amarelos, vermelhos e o branco puro ficam como estão.
Uso: python3 scripts/retema-css.py static/*.css  (idempotente: roda de novo sem efeito)"""
import colorsys, re, sys

def para_hsl(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    hh, l, s = colorsys.rgb_to_hls(r, g, b)
    return hh * 360, s, l

def trocar(cor):
    hex6 = cor.lstrip('#')
    if len(hex6) not in (3, 6): return cor
    h, s, l = para_hsl(cor)
    if not (190 <= h <= 260) or s < 0.08: return cor
    if l >= 0.985: return cor                                   # branco quase puro
    if l >= 0.95: return '#F6F5F0'                              # fundo claro
    if l >= 0.90: return '#ECEAE1'                              # fundo de apoio
    if l >= 0.80: return '#DFDCD0'                              # linhas e bordas
    if l >= 0.62: return '#B5B3A8'                              # cinza claro (texto desativado)
    if l >= 0.34 and s >= 0.55: return '#2448FF'                # azul da marca
    if l >= 0.30: return '#686A73'                              # cinza de apoio
    if l >= 0.22: return '#3C3D44'                              # texto secundário forte
    return '#18191D'                                            # grafite

padrao = re.compile(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b')
for arq in sys.argv[1:]:
    if arq.endswith('marca.css'): continue
    txt = open(arq, encoding='utf-8').read()
    novo = padrao.sub(lambda m: trocar(m.group(0)), txt)
    # rgba azul-marinho de sombras: deixa neutro
    novo = re.sub(r'rgba\(\s*(?:10|16|20|28|27)\s*,\s*(?:27|36|62|40|44)\s*,\s*(?:51|62|117|80|75)\s*,', 'rgba(24,25,29,', novo)
    if novo != txt:
        open(arq, 'w', encoding='utf-8').write(novo); print('retemado', arq)
