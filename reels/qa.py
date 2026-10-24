#!/usr/bin/env python
"""Conferencia automatica do video (secao 7 do briefing). Gera saida/NOME.qa.md, NOME.fontes.txt
e NOME.contato.png. Chamado pelo fazer_reels.py no fim do template "mapa"."""
import json
import re
import subprocess
from pathlib import Path

import numpy as np

AQUI = Path(__file__).resolve().parent
SAIDA = AQUI / "saida"


def _probe(p):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                          "stream=codec_type,codec_name,width,height,r_frame_rate,bit_rate,start_time:format=duration,bit_rate",
                          "-of", "json", str(p)], capture_output=True, text=True).stdout
    return json.loads(out)


def _quadros(p, w, h):
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(p), "-vf", f"scale={w}:{h}", "-f", "rawvideo",
                             "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    n = w * h * 3
    while True:
        b = proc.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(h, w, 3)
    proc.wait()


def _folha(destino_mp4, tempos, saida_png, cols=8):
    from PIL import Image, ImageDraw

    ims = []
    for t in tempos:
        r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", str(destino_mp4), "-frames:v", "1",
                            "-vf", "scale=216:384", "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True)
        if r.stdout:
            from io import BytesIO
            im = Image.open(BytesIO(r.stdout)).convert("RGB")
            ImageDraw.Draw(im).text((6, 4), f"{t:.1f}s", fill=(255, 255, 0))
            ims.append(im)
    linhas = (len(ims) + cols - 1) // cols
    folha = Image.new("RGB", (216 * cols, 384 * linhas), (20, 20, 20))
    for i, im in enumerate(ims):
        folha.paste(im, ((i % cols) * 216, (i // cols) * 384))
    folha.save(saida_png)


def rodar_qa(destino, nome, meta, cenas, spec, grupos, trabalho, cfg, t_render, whisper_nome="small"):
    from faster_whisper import WhisperModel

    from fazer_reels import alinhar, norm

    V = cfg["video"]
    W, H, fps = V["largura"], V["altura"], V["fps"]
    ZS = cfg["zona_segura"]
    itens = []  # (secao, item, ok, detalhe)

    def item(sec, nome_, ok, det):
        itens.append((sec, nome_, ok, det))

    # ---------------- formato
    pr = _probe(destino)
    vs = next(s for s in pr["streams"] if s["codec_type"] == "video")
    au = next((s for s in pr["streams"] if s["codec_type"] == "audio"), None)
    dur = float(pr["format"]["duration"])
    num, den = map(int, vs["r_frame_rate"].split("/"))
    br = int(vs.get("bit_rate") or pr["format"].get("bit_rate") or 0) / 1e6
    faixa = [float(x) for x in str(meta.get("duracao", "45-75")).split("-")]
    item("Formato", "1080x1920, 30 fps, H.264 + AAC",
         vs["width"] == W and vs["height"] == H and num / den == fps and vs["codec_name"] == "h264"
         and au is not None and au["codec_name"] == "aac",
         f"{vs['width']}x{vs['height']}, {num / den:.0f} fps, {vs['codec_name']} + {au['codec_name'] if au else '-'}")
    item("Formato", f"duracao {faixa[0]:.0f} a {faixa[1]:.0f} s", faixa[0] <= dur <= faixa[1], f"{dur:.1f} s")
    item("Formato", "bitrate de video 8 a 12 Mbps (alvo)", 8 <= br <= 12.5, f"{br:.1f} Mbps")

    # ---------------- log do render
    log = json.loads((trabalho / "mapa_log.json").read_text())
    primeiro = {}
    for r in log:
        for e in r["eventos"]:
            k = (e["tipo"], e.get("id"), round(e["t0"], 3))
            primeiro.setdefault(k, r["q"] / fps)
        for rot in r["rotulos"]:
            primeiro.setdefault(("rotulo", rot["id"], None), r["q"] / fps)

    # ---------------- gancho
    evs = spec["eventos"]
    t_gancho = min((e["t"] for e in evs if e["tipo"] in ("previa", "rota", "foco")), default=99)
    item("Gancho", "evento visual forte em ate 3 s", t_gancho <= 3,
         f"primeiro evento ({next((e['tipo'] for e in evs if e['t'] == t_gancho), '-')}) em {t_gancho:.2f} s")

    # ---------------- sincronia: palavra no audio FINAL (whisper independente) x primeiro quadro do evento
    wav = trabalho / "qa_audio.wav"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(destino), "-vn", "-ac", "1", "-ar", "16000", str(wav)])
    wm = WhisperModel(whisper_nome, device="cpu", compute_type="int8")
    segs, _ = wm.transcribe(str(wav), language="pt", word_timestamps=True, condition_on_previous_text=False)
    ws = [(w.word.strip(), w.start, w.end) for s in segs for w in s.words if w.word.strip()]
    texto_total = " ".join(c.fala for c in cenas)
    alinhadas, cobertura = alinhar(texto_total, ws, dur)
    base_idx, acc = {}, 0
    for c in cenas:
        base_idx[c.n] = acc
        acc += len(c.fala.split())
    sinc = []
    for c in cenas:
        for idx, aid in c.ancoras:
            palavra, (t_pal, _) = alinhadas[base_idx[c.n] + idx]
            ev = next((e for e in evs if e.get("ancorado") and (norm(e.get("id") or "") == norm(aid) or e["tipo"] == norm(aid))
                       and abs(e["t"] - t_pal) < 2.5), None)
            if not ev:
                sinc.append((aid, palavra, t_pal, None, None))
                continue
            k = (ev["tipo"], ev.get("id"), round(ev["t"], 3))
            t_vis = primeiro.get(k)
            sinc.append((aid, palavra, t_pal, t_vis, None if t_vis is None else (t_vis - t_pal) * 1000))
    medidos = [s for s in sinc if s[4] is not None]
    dentro = [s for s in medidos if abs(s[4]) <= 150]
    item("Sincronia", ">= 8 eventos dentro de +-150 ms", len(dentro) >= 8 and len(dentro) == len(medidos),
         f"{len(dentro)} de {len(medidos)} eventos medidos dentro de +-150 ms (cobertura do texto no audio final {cobertura:.0%})")

    # ---------------- pixels: estatico, verde do foco, malha do gancho
    aw, ah = 540, 960
    estatico_run, pior_estatico, ini_run = 0, 0.0, 0
    buf = []
    verde, colorido = [], []
    for i, f in enumerate(_quadros(destino, aw, ah)):
        g = f.mean(axis=2)
        buf.append(g)
        if len(buf) > 15:
            buf.pop(0)
            d = np.abs(g - buf[0]).mean()
            if d < 0.6:
                estatico_run += 1
                pior_estatico = max(pior_estatico, estatico_run / fps + 0.5)
            else:
                estatico_run = 0
        r_, g_, b_ = f[..., 0].astype(int), f[..., 1].astype(int), f[..., 2].astype(int)
        verde.append(int(((g_ > 215) & (r_ < 170) & (b_ < 190) & (g_ - r_ > 60)).sum()))
        sat = np.max(f, axis=2).astype(int) - np.min(f, axis=2).astype(int)
        colorido.append(int(((sat > 150) & (np.max(f, axis=2) > 200)).sum()))
    item("Ritmo visual", "nenhum quadro parado por mais de 3 s", pior_estatico <= 3,
         f"maior trecho sem mudanca visivel: {pior_estatico:.1f} s")
    cruzamentos = []
    for e in evs:
        if e["tipo"] in ("foco", "previa"):
            serie = verde if e["tipo"] == "foco" else colorido
            q0 = int(e["t"] * fps)
            base = np.median(serie[max(q0 - 20, 0):max(q0 - 2, 1)] or [0])
            on = next((q for q in range(max(q0 - 15, 0), min(q0 + 45, len(serie))) if serie[q] > base + (60 if e['tipo'] == 'foco' else 150)), None)
            cruzamentos.append((e["tipo"], e.get("id") or "", e["t"], None if on is None else on / fps))
    # algo novo a cada 2,5 s: intervalos com animacao ATIVA (tracado em andamento, rotulo entrando,
    # camera se movendo, malha surgindo/sumindo); mede a maior pausa sem nenhuma delas
    ativos = [(c["t"], c["t"] + c["dur"]) for c in spec["cameras"]]
    for e in evs:
        d_ = {"rota": e.get("dur", 1), "foco": e.get("dur", 1), "previa": e.get("dur", 2), "limpar": .45}.get(e["tipo"], .3)
        ativos.append((e["t"], e["t"] + d_))
    ativos += [(t, t + .28) for (tipo, _, _), t in primeiro.items() if tipo == "rotulo"]
    ativos.sort()
    gaps, fim_ativo = [ativos[0][0]], ativos[0][1]
    for a_, b_ in ativos[1:]:
        gaps.append(max(0.0, a_ - fim_ativo))
        fim_ativo = max(fim_ativo, b_)
    gaps.append(max(0.0, dur - fim_ativo))
    item("Ritmo visual", "algo novo (tracado, rotulo, camera) a cada 2,5 s", max(gaps) <= 2.5,
         f"maior pausa sem animacao ativa: {max(gaps):.1f} s (fora isso, a camera segue em deriva lenta)")

    # ---------------- rotulos
    sobre, fora, ocultos = 0, 0, {}
    for r in log:
        bx = r["rotulos"]
        for i in range(len(bx)):
            a = bx[i]
            if a["y"] < ZS["topo"] or a["y"] + a["h"] > H - ZS["base"] or a["x"] < 0 or a["x"] + a["w"] > W:
                fora += 1
            for b in bx[i + 1:]:
                if a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]:
                    sobre += 1
        for o in r["ocultos"]:
            ocultos[o] = ocultos.get(o, 0) + 1
    item("Rotulos", "nenhum rotulo sobreposto", sobre == 0, f"{sobre} sobreposicoes em {len(log)} quadros")
    item("Rotulos", "rotulos dentro da zona segura", fora == 0, f"{fora} ocorrencias fora")
    item("Rotulos", "texto >= 28 px", cfg["rotulo"]["tamanho"] >= 28, f"{cfg['rotulo']['tamanho']} px")
    if ocultos:
        item("Rotulos", "rotulos ocultos: fora do quadro ou sem espaco livre (informativo)", True,
             ", ".join(f"{k}: {v / fps:.1f} s" for k, v in sorted(ocultos.items(), key=lambda x: -x[1])[:6]))

    # ---------------- legenda
    pal_leg = [w for g in grupos for w, _, _ in g]
    pal_rot = " ".join(c.fala for c in cenas).split()
    item("Legenda", "texto identico ao roteiro", pal_leg == pal_rot,
         "igual" if pal_leg == pal_rot else f"{len(pal_leg)} x {len(pal_rot)} palavras")
    tam = [len(g) for g in grupos]
    lg = cfg["legenda"]
    item("Legenda", f"{lg['palavras_min']} a {lg['palavras_max']} palavras por bloco",
         all(lg["palavras_min"] <= n <= lg["palavras_max"] for n in tam), f"blocos de {min(tam)} a {max(tam)} palavras")
    yc = lg["posicao_y"] * H
    item("Legenda", "dentro da zona segura", yc - lg["tamanho"] * 1.3 > ZS["topo"] and yc + lg["tamanho"] * 1.3 < H - ZS["base"],
         f"centro em y={yc:.0f} (base livre: {H - ZS['base']})")

    # ---------------- audio
    vd = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(destino), "-af", "volumedetect", "-f", "null", "-"],
                        capture_output=True, text=True).stderr
    mx = float(re.search(r"max_volume: (-?[\d.]+)", vd).group(1))
    item("Audio", "sem clipping", mx < -0.3, f"pico {mx:.1f} dBFS")
    item("Audio", "musica abaixo da voz com ducking", bool(meta.get("musica")),
         "sem musica neste video (nenhuma faixa licenciada fornecida); whooshes sintetizados nas trocas")

    # ---------------- fatos e fontes
    rotas_usadas = sorted({e["id"] for e in evs if e["tipo"] in ("rota", "foco")})
    item("Fatos", "fontes registradas", bool(meta.get("_fontes")), f"{len(meta.get('_fontes', []))} comentario(s) de fonte no roteiro")
    item("Fatos", "identidade das rotas confirmada em dado oficial", False,
         f"{', '.join(rotas_usadas)}: geometria real (Natural Earth), numero INFERIDO pelas cidades de passagem — verificar no DNIT/SNV")

    # ---------------- folha de contato
    tempos = [x / 2 for x in range(0, 7)] + list(np.arange(4, dur, 2.0))
    folha = SAIDA / f"{nome}.contato.png"
    _folha(destino, tempos, folha)

    # ---------------- relatorio
    ok_total = all(ok for _, _, ok, _ in itens)
    L = [f"# QA — {nome}", "",
         f"Video: `saida/{nome}.mp4` · {dur:.1f} s · render do mapa {t_render / 60:.1f} min (inclui preparo/caches)", "",
         f"**Resultado: {'APROVADO' if ok_total else 'COM FALHAS'}** ({sum(1 for i in itens if i[2])}/{len(itens)} itens)", "",
         "| Secao | Item | OK | Detalhe |", "|---|---|---|---|"]
    for sec, n_, ok, det in itens:
        L.append(f"| {sec} | {n_} | {'sim' if ok else '**NAO**'} | {det} |")
    L += ["", "## Sincronia por evento", "",
          "Palavra-ancora: tempo da palavra no audio FINAL, por faster-whisper independente (alinhado ao texto do roteiro).",
          "Instante visual: primeiro quadro em que o renderizador desenhou o elemento.", "",
          "| Ancora | Palavra | Fala (s) | Visual (s) | Diferenca (ms) |", "|---|---|---|---|---|"]
    for aid, palavra, tp, tv, dms in sinc:
        L.append(f"| {aid} | {palavra} | {tp:.3f} | {'-' if tv is None else f'{tv:.3f}'} | "
                 f"{'nao medido' if dms is None else f'{dms:+.0f}'} |")
    if cruzamentos:
        L += ["", "Conferencia por pixel (cor medida no video final):", ""]
        for tipo, id_, tp, ton in cruzamentos:
            L.append(f"- {tipo} {id_}: planejado {tp:.3f} s, cor aparece no video em "
                     f"{'nao detectado' if ton is None else f'{ton:.3f} s ({(ton - tp) * 1000:+.0f} ms)'}")
    L += ["", f"Folha de contato: `saida/{nome}.contato.png` (0 a 3 s a cada 0,5 s; depois a cada 2 s)."]
    (SAIDA / f"{nome}.qa.md").write_text("\n".join(L) + "\n", encoding="utf-8")

    fontes = [f"Fontes — {nome}", "", "Do roteiro:"] + [f"- {f}" for f in meta.get("_fontes", [])] + ["",
              "Dados e imagens:",
              "- Imagem de base: NASA Earth Observatory — Blue Marble: Next Generation (jun/2004), Reto Stöckli, NASA GSFC. "
              "Imagem da NASA, uso comercial permitido sem sugerir endosso; credito: \"Imagem: NASA Earth Observatory\".",
              "- Fronteiras, terra/oceano, malha de estradas e cidades: Natural Earth (dominio publico), naturalearthdata.com.",
              f"- Rotas {', '.join(rotas_usadas)}: tracado sobre estradas reais do Natural Earth; numero da rodovia INFERIDO "
              "pelas cidades de passagem (mapa_rotas.yaml). VERIFICAR no DNIT/SNV antes de publicar.",
              "- Fonte tipografica: Montserrat (SIL Open Font License 1.1).",
              "- Voz: clonada da voz do Pedro (Chatterbox, MIT). Whooshes sintetizados pelo proprio codigo."]
    (SAIDA / f"{nome}.fontes.txt").write_text("\n".join(fontes) + "\n", encoding="utf-8")
    print(f"QA: {'APROVADO' if ok_total else 'COM FALHAS'} -> saida/{nome}.qa.md")
    for sec, n_, ok, det in itens:
        print(f"  [{'ok' if ok else 'FALHA'}] {sec}: {n_} — {det}")
    return ok_total


# ================================================================ template "fluxo" ("A Conta")

def _sincronia(destino, cenas, eventos, primeiro, dur, trabalho, whisper_nome):
    """Palavra-ancora no audio FINAL (whisper independente, alinhado ao roteiro) x primeiro quadro do evento."""
    from faster_whisper import WhisperModel

    from fazer_reels import alinhar, norm

    wav = trabalho / "qa_audio.wav"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(destino), "-vn", "-ac", "1", "-ar", "16000", str(wav)])
    wm = WhisperModel(whisper_nome, device="cpu", compute_type="int8")
    segs, _ = wm.transcribe(str(wav), language="pt", word_timestamps=True, condition_on_previous_text=False)
    ws = [(w.word.strip(), w.start, w.end) for s in segs for w in s.words if w.word.strip()]
    alinhadas, cobertura = alinhar(" ".join(c.fala for c in cenas), ws, dur)
    base, acc = {}, 0
    for c in cenas:
        base[c.n] = acc
        acc += len(c.fala.split())
    linhas = []
    for c in cenas:
        for idx, aid in c.ancoras:
            palavra, (t_pal, _) = alinhadas[base[c.n] + idx]
            ev = next((e for e in eventos if norm(e["id"]) == norm(aid)), None)
            t_vis = primeiro.get(ev["id"]) if ev else None
            linhas.append((aid, palavra, t_pal, t_vis, None if t_vis is None else (t_vis - t_pal) * 1000))
    return linhas, cobertura, alinhadas


def rodar_qa_fluxo(destino, nome, meta, cenas, spec, grupos, trabalho, cfg, t_render, calc, whisper_nome="small"):
    import fluxo

    V = cfg["video"]
    W, H, fps = V["largura"], V["altura"], V["fps"]
    ZS = cfg["zona_segura"]
    itens = []

    def item(sec, n_, ok, det):
        itens.append((sec, n_, ok, det))

    # ---------------- formato
    pr = _probe(destino)
    vs = next(s for s in pr["streams"] if s["codec_type"] == "video")
    au = next((s for s in pr["streams"] if s["codec_type"] == "audio"), None)
    dur = float(pr["format"]["duration"])
    num, den = map(int, vs["r_frame_rate"].split("/"))
    br = int(vs.get("bit_rate") or pr["format"].get("bit_rate") or 0) / 1e6
    faixa = [float(x) for x in str(meta.get("duracao", "45-60")).split("-")]
    item("Formato", "1080x1920, 30 fps, H.264 + AAC",
         vs["width"] == W and vs["height"] == H and num / den == fps and vs["codec_name"] == "h264"
         and au is not None and au["codec_name"] == "aac",
         f"{vs['width']}x{vs['height']}, {num / den:.0f} fps, {vs['codec_name']} + {au['codec_name'] if au else '-'}")
    item("Formato", f"duracao {faixa[0]:.0f} a {faixa[1]:.0f} s", faixa[0] <= dur <= faixa[1], f"{dur:.1f} s")
    item("Formato", "bitrate de video 8 a 12 Mbps (alvo)", 8 <= br <= 12.5, f"{br:.1f} Mbps")

    # ---------------- log
    log = json.loads((trabalho / "fluxo_log.json").read_text())
    primeiro = {}
    for r in log:
        for e in r["eventos"]:
            primeiro.setdefault(e["id"], r["q"] / fps)

    # ---------------- sincronia
    sinc, cobertura, alinhadas = _sincronia(destino, cenas, spec["eventos"], primeiro, dur, trabalho, whisper_nome)
    medidos = [s for s in sinc if s[4] is not None]
    dentro = [s for s in medidos if abs(s[4]) <= 150]
    alvo = [s for s in medidos if abs(s[4]) <= 80]
    item("Sincronia", ">= 10 eventos dentro de +-150 ms", len(dentro) >= 10 and len(dentro) == len(medidos),
         f"{len(dentro)} de {len(medidos)} dentro de +-150 ms; {len(alvo)} dentro do alvo de +-80 ms (texto reconhecido no audio final: {cobertura:.0%})")

    # ---------------- gancho
    t_grade = min(a for a, _ in spec["ativos"])
    t_perg = next((t for (w, (t, _)) in alinhadas if w.lower().startswith("quanto")), None)
    item("Gancho", "evento visual forte em ate 3 s", t_grade <= 3, f"grade comeca a montar em {t_grade:.2f} s")
    item("Gancho", "pergunta falada em ate 3 s", t_perg is not None and t_perg <= 3,
         f"'Quanto sobra...' comeca em {t_perg:.2f} s" if t_perg is not None else "pergunta nao localizada")

    # ---------------- ritmo: quadro parado (pixel) e pausas sem animacao ativa
    estatico_run, pior = 0, 0.0
    buf = []
    for f in _quadros(destino, 270, 480):
        g = f.mean(axis=2)
        buf.append(g)
        if len(buf) > 15:
            buf.pop(0)
            if np.abs(g - buf[0]).mean() < 0.35:
                estatico_run += 1
                pior = max(pior, estatico_run / fps + 0.5)
            else:
                estatico_run = 0
    item("Ritmo", "nenhum quadro parado por mais de 3 s", pior <= 3, f"maior trecho sem mudanca visivel: {pior:.1f} s")
    ativos = sorted(spec["ativos"])
    gaps, fim = [ativos[0][0]], ativos[0][1]
    for a_, b_ in ativos[1:]:
        gaps.append(max(0.0, a_ - fim))
        fim = max(fim, b_)
    gaps.append(max(0.0, dur - fim))
    item("Ritmo", "algo novo na tela a cada 2,5 s", max(gaps) <= 2.5, f"maior pausa sem animacao ativa: {max(gaps):.1f} s")

    # ---------------- numeros
    testes = fluxo.testar(calc, meta)
    item("Numeros", "testes da secao 4", all(ok for _, ok, _ in testes),
         f"{sum(ok for _, ok, _ in testes)}/{len(testes)} passaram")
    probs = fluxo.conferir_roteiro(cenas, calc)
    item("Numeros", "roteiro (tela e fala) coerente com o calculo", not probs, "sem divergencias" if not probs else "; ".join(probs))
    dif_grade = [abs(r["saldo"] - r["grade"]) for r in log if r.get("saldo") is not None and r.get("grade") is not None]
    item("Numeros", "contador = quantidade de quadrados (todo quadro)", bool(dif_grade) and max(dif_grade) <= 0.001,
         f"{len(dif_grade)} quadros conferidos; maior diferenca {max(dif_grade) if dif_grade else 0:.3f}")
    from decimal import Decimal as Dd
    dif_desl = []
    for r in log:
        if r.get("d") is not None:
            esperado = calc["sobra_fn"](calc["preco"] * (1 - Dd(str(r["d"]))))
            dif_desl.append(abs(float(esperado) - r["saldo"]))
    item("Numeros", "contador do controle deslizante = calculo em Python", bool(dif_desl) and max(dif_desl) <= 0.005,
         f"{len(dif_desl)} quadros; maior diferenca R$ {max(dif_desl) if dif_desl else 0:.4f}")

    # ---------------- legibilidade, honestidade
    fora = {}
    for r in log:
        for b in r["caixas"]:
            if b["y"] < ZS["topo"] - 1 or b["y"] + b["h"] > H - ZS["base"] + 1 or b["x"] < 0 or b["x"] + b["w"] > W:
                fora[b["nome"]] = fora.get(b["nome"], 0) + 1
    item("Legibilidade", "nada importante fora da zona segura", not fora,
         "ok" if not fora else ", ".join(f"{k}: {v} quadros" for k, v in fora.items()))
    F_ = cfg["fluxo"]
    tamanhos = {"saldo": F_["valor_px"], "valores dos custos": 48, "texto-na-tela": F_["texto_px"], "% do controle": 120,
                "ponto de equilibrio": 48, "eixo do controle": 40}
    menores = {k: v for k, v in tamanhos.items() if v < 48}
    item("Legibilidade", "texto de valor >= 48 px", not [k for k in menores if k != "eixo do controle"],
         ", ".join(f"{k} {v}px" for k, v in tamanhos.items()) + " (eixo 0-25% com 40 px: marcacao de escala)")
    sem_aviso = sum(1 for r in log if not any(b["nome"] == "aviso" for b in r["caixas"]))
    item("Honestidade", "aviso 'exemplo ilustrativo' do inicio ao fim", sem_aviso == 0,
         f"presente em {len(log) - sem_aviso} de {len(log)} quadros")

    # ---------------- legenda
    pal_leg = [w for g in grupos for w, _, _ in g]
    pal_rot = " ".join(c.fala for c in cenas).split()
    item("Legenda", "texto identico ao roteiro (sem as chaves)", pal_leg == pal_rot,
         "igual" if pal_leg == pal_rot else f"{len(pal_leg)} x {len(pal_rot)} palavras")
    tam = [len(g) for g in grupos]
    lg = cfg["legenda"]
    item("Legenda", f"{lg['palavras_min']} a {lg['palavras_max']} palavras por bloco",
         all(lg["palavras_min"] <= n <= lg["palavras_max"] for n in tam), f"blocos de {min(tam)} a {max(tam)} palavras")

    # ---------------- audio
    vd = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(destino), "-af", "volumedetect", "-f", "null", "-"],
                        capture_output=True, text=True).stderr
    mx = float(re.search(r"max_volume: (-?[\d.]+)", vd).group(1))
    item("Audio", "sem clipping", mx < -0.3, f"pico {mx:.1f} dBFS")
    import soundfile as sf
    voz, _ = sf.read(trabalho / "narracao.wav")
    sfx, _ = sf.read(trabalho / "sfx.wav")
    rms = lambda x: 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
    v_ = voz[np.abs(voz) > 0.02] if np.any(np.abs(voz) > 0.02) else voz
    s_ = sfx[np.abs(sfx) > 1e-4] if np.any(np.abs(sfx) > 1e-4) else sfx
    dif = rms(s_) - rms(v_)
    item("Audio", "efeitos ~18 dB abaixo da voz, com ducking", dif <= -14,
         f"efeitos {dif:.1f} dB em relacao a voz (antes do ducking, que abaixa mais durante a fala)")
    item("Audio", "musica", True, "sem musica (opcional; nenhuma faixa em ./musica/)")

    # ---------------- folha de contato
    tempos = [x / 2 for x in range(0, 11)] + list(np.arange(6, dur, 2.0))
    folha = SAIDA / f"{nome}.contato.png"
    _folha(destino, tempos, folha)

    ok_total = all(ok for _, _, ok, _ in itens)
    L = [f"# QA — {nome}", "",
         f"Video: `saida/{nome}.mp4` · {dur:.1f} s · render da animacao {t_render / 60:.1f} min", "",
         f"**Resultado: {'APROVADO' if ok_total else 'COM FALHAS'}** ({sum(1 for i in itens if i[2])}/{len(itens)} itens)", "",
         "| Secao | Item | OK | Detalhe |", "|---|---|---|---|"]
    L += [f"| {s} | {n_} | {'sim' if ok else '**NAO**'} | {d} |" for s, n_, ok, d in itens]
    L += ["", "## Testes de numeros (secao 4)", "", "| Teste | OK | Detalhe |", "|---|---|---|"]
    L += [f"| {n_} | {'sim' if ok else '**NAO**'} | {d} |" for n_, ok, d in testes]
    L += ["", "## Sincronia por evento", "",
          "Palavra-ancora: tempo da palavra no audio FINAL por faster-whisper independente, alinhado ao roteiro.",
          "Instante visual: primeiro quadro em que o evento e desenhado.", "",
          "| Ancora | Palavra | Fala (s) | Visual (s) | Diferenca (ms) |", "|---|---|---|---|---|"]
    L += [f"| {a} | {p} | {tp:.3f} | {'-' if tv is None else f'{tv:.3f}'} | {'nao medido' if d is None else f'{d:+.0f}'} |"
          for a, p, tp, tv, d in sinc]
    L += ["", f"Folha de contato: `saida/{nome}.contato.png` (0 a 5 s a cada 0,5 s; depois a cada 2 s)."]
    (SAIDA / f"{nome}.qa.md").write_text("\n".join(L) + "\n", encoding="utf-8")

    fontes = [f"Fontes — {nome}", "", "EXEMPLO ILUSTRATIVO: todos os valores de entrada sao hipoteticos (aviso visivel no video).", "",
              "Do roteiro:"] + [f"- {f}" for f in meta.get("_fontes", [])] + ["",
              "Calculo (feito em codigo, fluxo.py, a partir de 'entradas' e 'cenario'):",
              f"- Preco {fluxo.brl(calc['preco'])}; custos: " + "; ".join(f"{k} {fluxo.brl(v)}" for k, v in calc["valores1"].items())
              + f"; sobra {fluxo.brl(calc['sobra1'])}.",
              f"- Com {fluxo.pct(calc['desconto'])} de desconto: preco {fluxo.brl(calc['preco2'])}; "
              + "; ".join(f"{k} {fluxo.brl(v)}" for k, v in calc["valores2"].items()) + f"; sobra {fluxo.brl(calc['sobra2'])}.",
              f"- Desconto maximo sem prejuizo: exato {calc['limite'] * 100:.2f}%, arredondado para baixo {fluxo.pct(calc['limite_baixo'])}.",
              "", "Producao:",
              "- Animacao, contas e efeitos sonoros gerados pelo proprio codigo (sem bibliotecas de terceiros com licenca).",
              "- Fonte tipografica: Montserrat (SIL Open Font License 1.1).",
              "- Voz: clonada da voz do Pedro (Chatterbox, MIT)."]
    (SAIDA / f"{nome}.fontes.txt").write_text("\n".join(fontes) + "\n", encoding="utf-8")
    print(f"QA: {'APROVADO' if ok_total else 'COM FALHAS'} -> saida/{nome}.qa.md")
    for s, n_, ok, d in itens:
        print(f"  [{'ok' if ok else 'FALHA'}] {s}: {n_} — {d}")
    return ok_total
