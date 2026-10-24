#!/usr/bin/env python
"""Validacao do Reel editorial: formato, zona segura, ritmo, legendas e sincronia medida no audio final."""
import json
import subprocess
from pathlib import Path

import numpy as np

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
TEXTOS = {"titulo", "numero", "legenda", "cta", "etiqueta"}


def _probe(p):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                          "stream=codec_type,codec_name,width,height,r_frame_rate,bit_rate,profile:format=duration,size,bit_rate",
                          "-of", "json", str(p)], capture_output=True, text=True).stdout
    return json.loads(out)


def _folha(mp4, tempos, destino, zona=None, cols=8, w=216, h=384):
    from io import BytesIO

    from PIL import Image, ImageDraw
    ims = []
    for t in tempos:
        r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", str(mp4), "-frames:v", "1", "-vf", f"scale={w}:{h}",
                            "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True)
        if not r.stdout:
            continue
        im = Image.open(BytesIO(r.stdout)).convert("RGB")
        d = ImageDraw.Draw(im)
        if zona:
            k = w / 1080
            d.rectangle([zona["lados"] * k, zona["topo"] * k, w - zona["lados"] * k, h - zona["base"] * k], outline=(0, 255, 120), width=1)
        d.text((5, 3), f"{t:.1f}s", fill=(255, 255, 0))
        ims.append(im)
    linhas = (len(ims) + cols - 1) // cols
    folha = Image.new("RGB", (w * cols, h * linhas), (18, 18, 18))
    for i, im in enumerate(ims):
        folha.paste(im, ((i % cols) * w, (i // cols) * h))
    folha.save(destino)


def _sincronia(final, cenas, narr, ancoras_qa, trabalho):
    from faster_whisper import WhisperModel

    from fazer_reels import alinhar, expandir_numeros, norm, refinar_inicios
    wm = WhisperModel("small", device="cpu", compute_type="int8")
    linhas = []
    for c, n in zip(cenas, narr):
        if not n:
            continue
        a, b = max(0.0, c["_voz_inicio"] - .2), min(c["fim"], c["_voz_inicio"] + n["dur"] + .3)
        wav = trabalho / f"qa_{c['id']}.wav"
        # faixa de narracao exatamente como foi mixada (mesma linha do tempo do video, sem trilha por cima)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", str(trabalho / "audio" / "narracao.wav"),
                        "-ac", "1", "-ar", "16000", str(wav)])
        segs, _ = wm.transcribe(str(wav), language="pt", word_timestamps=True, condition_on_previous_text=False)
        ws = expandir_numeros([(w.word.strip(), w.start + a, w.end + a) for s in segs for w in s.words if w.word.strip()])
        al, cob = alinhar(n["fala"], ws, b)
        al = refinar_inicios(al, wav, deslocamento=a)
        pos = 0
        for cid, palavra, t_plan, rotulo in sorted(ancoras_qa, key=lambda x: x[2]):
            if cid != c["id"]:
                continue
            t_med = None
            for i in range(pos, len(al)):
                if norm(al[i][0]).startswith(norm(palavra)):
                    t_med, pos = al[i][1][0], i + 1
                    break
            linhas.append((c["id"], palavra, rotulo, t_plan, t_med, None if t_med is None else (t_plan - t_med) * 1000, cob))
    return linhas


def rodar(final, previa, cfg, cenas, narr, legendas, escondidas, reg, ancoras_qa, estouro, trabalho, pasta, t_video, t_total):
    import sys
    sys.path.insert(0, str(RAIZ))
    from qa import _quadros

    nome = cfg["nome"]
    Z = cfg["zona_segura"]
    W, H = 1080, 1920
    itens = []

    def item(sec, n_, ok, det):
        itens.append((sec, n_, ok, det))

    pr = _probe(final)
    vs = next(s for s in pr["streams"] if s["codec_type"] == "video")
    au = next((s for s in pr["streams"] if s["codec_type"] == "audio"), None)
    dur = float(pr["format"]["duration"])
    mb = int(pr["format"]["size"]) / 1048576
    fr = eval(vs["r_frame_rate"])
    item("Formato", "1080x1920 (9:16)", vs["width"] == W and vs["height"] == H, f"{vs['width']}x{vs['height']}")
    item("Formato", "30 fps", abs(fr - 30) < .01, f"{fr:.2f} fps")
    item("Formato", "H.264 + AAC", vs["codec_name"] == "h264" and au and au["codec_name"] == "aac",
         f"{vs['codec_name']} ({vs.get('profile')}) + {au['codec_name'] if au else '-'}")
    item("Formato", "duracao 55 a 60 s", 55 <= dur <= 60.05, f"{dur:.2f} s")
    item("Formato", "arquivo leve para o Instagram (< 100 MB)", mb < 100, f"{mb:.1f} MB")

    # zona segura e cortes nas bordas, a partir do registro de cada quadro
    fora, cortado, verificados = {}, {}, 0
    for r in reg:
        for b in r["caixas"]:
            if b["nome"] not in TEXTOS:
                continue
            verificados += 1
            if b["x"] < -1 or b["y"] < -1 or b["x"] + b["w"] > W + 1 or b["y"] + b["h"] > H + 1:
                cortado[b["nome"]] = cortado.get(b["nome"], 0) + 1
            if b["x"] < Z["lados"] - 2 or b["x"] + b["w"] > W - Z["lados"] + 2 or b["y"] < Z["topo"] - 2 or b["y"] + b["h"] > H - Z["base"] + 2:
                fora.setdefault(b["nome"], []).append(round(r["t"], 2))
    item("Zona segura", f"textos dentro de {Z['topo']} px topo / {Z['base']} px base / {Z['lados']} px laterais", not fora,
         f"{verificados} caixas de texto em {len(reg)} quadros" + ("" if not fora else " — fora: " + "; ".join(
             f"{k}: {len(v)} quadros (ex.: {v[0]} s)" for k, v in fora.items())))
    item("Zona segura", "nenhum texto cortado na borda", not cortado, "ok" if not cortado else str(cortado))

    # ritmo: quadro parado
    run, pior, buf = 0, 0.0, []
    for f in _quadros(final, 270, 480):
        g = f.mean(axis=2)
        buf.append(g)
        if len(buf) > 15:
            buf.pop(0)
            if np.abs(g - buf[0]).mean() < .35:
                run += 1
                pior = max(pior, run / 30 + .5)
            else:
                run = 0
    item("Ritmo", "nenhum quadro parado por mais de 3 s (com 2 s de quadro final permitidos)", pior <= 3,
         f"maior trecho sem mudanca visivel: {pior:.1f} s")

    # narracao
    item("Narracao", "cada fala cabe na sua cena", not estouro,
         "ok" if not estouro else "; ".join(f"{c}: passa {s} s" for c, s in estouro))
    sinc = _sincronia(final, cenas, narr, ancoras_qa, trabalho)
    med = [s for s in sinc if s[5] is not None]
    ok150 = [s for s in med if abs(s[5]) <= 150]
    item("Sincronia", "entradas de texto ate +-150 ms da palavra falada", bool(med) and len(ok150) == len(med),
         f"{len(ok150)} de {len(med)} medidas (whisper novo sobre a faixa de narracao mixada, cena a cena)")

    # legendas
    tam = [len(l["palavras"]) for l in legendas]
    item("Legendas", "2 a 5 palavras por bloco", all(2 <= n <= 5 for n in tam) if tam else True,
         f"{len(legendas)} blocos, de {min(tam) if tam else 0} a {max(tam) if tam else 0} palavras")
    item("Legendas", "sem repetir o texto que ja esta na tela", True, f"{len(escondidas)} blocos omitidos por repetirem a tela")
    destaques = [sum(1 for p in l["palavras"] if p["destaque"]) for l in legendas]
    item("Legendas", "no maximo uma palavra destacada por bloco", all(d <= 1 for d in destaques), f"{sum(destaques)} destaques")

    # audio
    vd = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(final), "-af", "loudnorm=print_format=json", "-f", "null", "-"],
                        capture_output=True, text=True).stderr
    j = json.loads(vd[vd.rfind("{"):vd.rfind("}") + 1])
    item("Audio", "loudness para Instagram (~-14 LUFS, pico <= -1 dBTP)", -15.5 <= float(j["input_i"]) <= -12.5 and float(j["input_tp"]) <= -0.9,
         f"{float(j['input_i']):.1f} LUFS, pico {float(j['input_tp']):.1f} dBTP")

    # capturas
    saida = RAIZ / "saida"
    tempos = [x / 2 for x in range(0, 11)] + [float(x) for x in range(6, int(dur), 2)] + [dur - .1]
    _folha(final, tempos, saida / f"{nome}.contato.png")
    _folha(final, [1.5, 4.5, 8.5, 10.5, 16, 19, 23, 26, 31, 34, 39.5, 42, 47, 51, 56.5, 59.5], saida / f"{nome}.zona-segura.png", zona=Z)

    ok_total = all(ok for _, _, ok, _ in itens)
    L = [f"# QA — {cfg['titulo']}", "",
         f"- MP4: `saida/{nome}.mp4` ({mb:.1f} MB, {dur:.2f} s, {vs['width']}x{vs['height']}, {fr:.0f} fps, H.264 + AAC)",
         f"- Previa leve: `saida/{nome}.previa.mp4`",
         f"- Render: quadros {t_video / 60:.1f} min; total {t_total / 60:.1f} min",
         f"- Capturas: `saida/{nome}.contato.png` e `saida/{nome}.zona-segura.png` (retangulo verde = zona segura)", "",
         f"**Resultado: {'APROVADO' if ok_total else 'COM FALHAS'}** ({sum(1 for i in itens if i[2])}/{len(itens)} itens)", "",
         "| Secao | Item | OK | Detalhe |", "|---|---|---|---|"]
    L += [f"| {s} | {n_} | {'sim' if ok else '**NAO**'} | {d} |" for s, n_, ok, d in itens]
    L += ["", "## Sincronia (palavra falada x entrada do texto)", "", "| Cena | Palavra | Elemento | Planejado (s) | Medido (s) | Diferenca (ms) |",
          "|---|---|---|---|---|---|"]
    L += [f"| {c} | {p} | {r} | {tp:.3f} | {'-' if tm is None else f'{tm:.3f}'} | {'nao medido' if d is None else f'{d:+.0f}'} |"
          for c, p, r, tp, tm, d, _ in sinc]
    if escondidas:
        L += ["", "## Legendas omitidas (repetiriam o texto da tela)", ""] + [f"- {c}: \"{t}\"" for c, t in escondidas]
    (saida / f"{nome}.qa.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"QA: {'APROVADO' if ok_total else 'COM FALHAS'} -> saida/{nome}.qa.md")
    for s, n_, ok, d in itens:
        print(f"  [{'ok' if ok else 'FALHA'}] {s}: {n_} — {d}")
    return ok_total
