#!/usr/bin/env python3
"""Corta trechos, tira as pausas, enquadra em 9:16 e queima legendas palavra a palavra (estilo reels).
uso: python3 cortar.py video.mp4 transcricao.json cortes.json pasta_saida
cortes.json: [{"id":"c1","inicio":"31:12.5","fim":"31:58","foco":0.5,"modo":"crop"|"blur","titulo":"..."}]
 - foco: posição horizontal (0 a 1) do rosto no vídeo original, usada no enquadramento 9:16.
 - modo "crop" (padrão) corta o lado; "blur" mantém o quadro inteiro sobre fundo desfocado."""
import json, os, re, subprocess, sys

FONTES = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'backend', 'assets')
PAUSA_MAX = 0.40      # pausas maiores que isso são cortadas
FOLGA_ANTES, FOLGA_DEPOIS = 0.08, 0.14
AMARELO = '&H0000E6FF&'  # BGR do amarelo #FFE600


def seg(t):
    s = 0.0
    for x in str(t).split(':'): s = s * 60 + float(x)
    return s


def ass_t(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def intervalos(palavras):
    """Mantém só a fala: junta palavras com pausa curta e corta o resto."""
    iv = []
    for w in palavras:
        a, b = w['t0'] - FOLGA_ANTES, w['t1'] + FOLGA_DEPOIS
        if iv and a - iv[-1][1] <= PAUSA_MAX: iv[-1][1] = max(iv[-1][1], b)
        else: iv.append([a, b])
    return iv


def grupos(pal, maxp=3):
    g, cur = [], []
    for i, w in enumerate(pal):
        cur.append(w)
        fim_frase = re.search(r'[.!?;:]$', w['w']) or (i + 1 < len(pal) and pal[i + 1]['n0'] - w['n1'] > 0.25)
        if len(cur) >= maxp or fim_frase: g.append(cur); cur = []
    if cur: g.append(cur)
    return g


def legenda_ass(pal, caminho):
    cab = ("[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\n\n[V4+ Styles]\n"
           "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n"
           "Style: L,Anton,104,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,1,0,1,9,3,2,70,70,560,1\n\n"
           "[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n")
    ev = []; gs = grupos(pal)
    for gi, g in enumerate(gs):
        prox = gs[gi + 1][0]['n0'] if gi + 1 < len(gs) else None
        for i, w in enumerate(g):
            ini = w['n0']
            if i + 1 < len(g): fim = g[i + 1]['n0']
            else: fim = min(prox, g[-1]['n1'] + 0.35) if prox is not None else g[-1]['n1'] + 0.10   # nunca invade o grupo seguinte
            txt = ' '.join((f"{{\\c{AMARELO}}}{x['w'].upper()}{{\\c&H00FFFFFF&}}" if j == i else x['w'].upper()) for j, x in enumerate(g))
            ev.append(f"Dialogue: 0,{ass_t(ini)},{ass_t(max(fim, ini + 0.08))},L,,0,0,0,,{txt}")
    open(caminho, 'w', encoding='utf-8').write(cab + '\n'.join(ev) + '\n')


def cortar(video, tr, c, saida):
    ini, fim = seg(c['inicio']), seg(c['fim'])
    pal = [dict(w) for w in tr['palavras'] if w['t0'] >= ini - 0.05 and w['t1'] <= fim + 0.05]
    if not pal: raise SystemExit(f"{c['id']}: sem fala nesse trecho")
    iv = intervalos(pal)
    # novo relógio (sem as pausas) para as legendas
    acum, mapa = 0.0, []
    for a, b in iv: mapa.append((a, b, acum)); acum += b - a
    for w in pal:
        for a, b, off in mapa:
            if a <= (w['t0'] + w['t1']) / 2 <= b:
                w['n0'] = off + max(w['t0'], a) - a; w['n1'] = off + min(w['t1'], b) - a; break
        else: w['n0'] = w['n1'] = 0
    pal = [w for w in pal if 'n0' in w and w['n1'] > 0]
    ass = os.path.join(saida, f"{c['id']}.ass"); legenda_ass(pal, ass)
    foco = float(c.get('foco', 0.5)); modo = c.get('modo', 'crop')
    n = len(iv); partes = []
    for i, (a, b) in enumerate(iv):
        partes.append(f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS[v{i}];[0:a]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS[a{i}]")
    cat = ''.join(f"[v{i}][a{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[vc][ac]"
    if modo == 'blur':
        quadro = "[vc]split[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:5[b];[fg]scale=1080:-2[f];[b][f]overlay=(W-w)/2:(H-h)/2[q]"
    else:
        quadro = f"[vc]scale=-2:1920,crop=1080:1920:'max(0,min(iw-1080,iw*{foco:.3f}-540))':0[q]"
    fdir = os.path.abspath(FONTES).replace(':', '\\:')
    graf = ';'.join(partes) + ';' + cat + ';' + quadro + f";[q]ass='{ass}':fontsdir='{fdir}'[vf];[ac]loudnorm=I=-16:TP=-1.5:LRA=11[af]"
    out = os.path.join(saida, f"{c['id']}.mp4")
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', video, '-filter_complex', graf, '-map', '[vf]', '-map', '[af]', '-r', '30',
                    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], check=True)
    dur = acum
    print(f"{c['id']}: {dur:.1f}s (de {fim - ini:.1f}s, {n} blocos) -> {out}")
    return out


if __name__ == '__main__':
    video, trj, cj, saida = sys.argv[1:5]
    tr = json.load(open(trj)); os.makedirs(saida, exist_ok=True)
    for c in json.load(open(cj)): cortar(video, tr, c, saida)
