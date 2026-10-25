#!/usr/bin/env python
"""Renderiza um Reel do template editorial a partir de um reel.json.

Uso (da pasta reels/):
    reels-voz/bin/python editorial/render.py editorial/projetos/constituicao-1988/reel.json

Etapas: le o JSON e a narracao (cache da voz clonada) -> resolve os tempos de cada animacao pelas palavras
faladas -> monta legendas -> renderiza 1080x1920 quadro a quadro (Chromium, 4 processos) -> trilha e efeitos
sintetizados, ducking e loudness -> MP4 final + previa leve -> QA (formato, zona segura, sincronia, ritmo).
Saidas em saida/<nome>.* ; projeto editavel = reel.json + engine/reel.js + imagens/.
"""
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

AQUI = Path(__file__).resolve().parent          # reels/editorial
RAIZ = AQUI.parent                               # reels
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(AQUI))

import audio  # noqa: E402


def norm(p):
    p = unicodedata.normalize("NFKD", str(p).lower())
    return "".join(c for c in p if c.isalnum())


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- narracao (cache da voz clonada)
def carregar_narracao(cfg, cenas_cfg):
    from fazer_reels import parse_roteiro

    pasta = RAIZ / cfg["narracao"]["pasta"]
    _, cenas_rot = parse_roteiro(RAIZ / cfg["narracao"]["roteiro"])
    out = []
    for c_cfg, c_rot in zip(cenas_cfg, cenas_rot):
        wav, meta = pasta / f"cena_{c_rot.n:02d}.wav", pasta / f"cena_{c_rot.n:02d}.json"
        if wav.exists() and meta.exists():
            pal = json.loads(meta.read_text())["palavras"]
            import soundfile as sf
            dur = sf.info(str(wav)).duration
            out.append({"wav": wav, "palavras": pal, "dur": dur, "fala": c_rot.fala})
        else:
            log(f"AVISO: sem narracao para a cena {c_rot.n}; usando tempos padrao.")
            out.append(None)
    return out


# ---------------------------------------------------------------- ritmo: fala mais rapida e cenas compactas
def acelerar_narracao(cfg, narr, trabalho):
    """Corta pausas internas longas e acelera a fala (sem mudar o tom); realinha as palavras."""
    rt = cfg.get("ritmo", {})
    vel, pausa = rt.get("velocidade", 1.0), rt.get("pausa_max", None)
    if vel == 1.0 and pausa is None:
        return narr
    from faster_whisper import WhisperModel

    from fazer_reels import alinhar, palavras_whisper, refinar_inicios
    pasta = trabalho / "voz_rapida"
    pasta.mkdir(parents=True, exist_ok=True)
    wm = None
    out = []
    for i, n in enumerate(narr):
        if not n:
            out.append(n)
            continue
        dst, meta = pasta / f"cena_{i + 1:02d}.wav", pasta / f"cena_{i + 1:02d}.json"
        chave = json.dumps([vel, pausa, n["wav"].stat().st_mtime, n["fala"], "medium"])
        if not (dst.exists() and meta.exists() and json.loads(meta.read_text()).get("chave") == chave):
            filtros = []
            if pausa is not None:
                filtros.append(f"silenceremove=stop_periods=-1:stop_duration={pausa + .05}:stop_threshold=-38dB:stop_silence={pausa}")
            if vel != 1.0:
                filtros.append(f"atempo={vel}")
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(n["wav"]), "-af", ",".join(filtros), str(dst)], check=True)
            if wm is None:   # medium: tempos por palavra mais precisos que o small em clipes curtos
                wm = WhisperModel("medium", device="cpu", compute_type="int8")
            import soundfile as sf
            dur = sf.info(str(dst)).duration
            pal, cob = alinhar(n["fala"], palavras_whisper(wm, dst), dur)
            pal = refinar_inicios(pal, dst)
            meta.write_text(json.dumps({"chave": chave, "palavras": pal, "cobertura": cob}, ensure_ascii=False))
        import soundfile as sf
        m = json.loads(meta.read_text())
        out.append({**n, "wav": dst, "palavras": m["palavras"], "dur": sf.info(str(dst)).duration})
    antes = sum(n["dur"] for n in narr if n)
    depois = sum(n["dur"] for n in out if n)
    log(f"Narracao: {antes:.1f} s -> {depois:.1f} s (pausas cortadas e fala {vel:.2f}x)")
    return out


def compactar(cfg, narr):
    """Cada cena dura a fala + respiros curtos; as animacoes internas encolhem junto (fator 'ritmo')."""
    rt = cfg.get("ritmo", {})
    if rt.get("modo") != "compacto":
        return cfg
    t = 0.0
    for i, (c, n) in enumerate(zip(cfg["cenas"], narr)):
        ultima = i == len(cfg["cenas"]) - 1
        lead = rt.get("antes", {}).get(c["modelo"], rt.get("antes_padrao", .15))
        tail = rt.get("final", 1.7) if ultima else rt.get("depois", .3)
        dur = (n["dur"] if n else 2.0)
        c["inicio"] = round(t, 3)
        c["voz_atraso"] = lead
        fim = t + max(rt.get("cena_min", 1.6), lead + dur + tail)
        bpm = cfg.get("trilha", {}).get("sintetizada", {}).get("bpm")
        if bpm and not cfg.get("trilha", {}).get("arquivo"):   # corte cai na meia batida da trilha
            passo = 30 / bpm
            fim = -(-fim // passo) * passo
        c["fim"] = round(fim, 3)
        c["ritmo"] = rt.get("fator", {}).get(c["modelo"], rt.get("fator_padrao", .7))
        t = c["fim"]
    cfg["duration"] = round(round(t * cfg["fps"]) / cfg["fps"], 3)
    log(f"Linha do tempo compacta: {cfg['duration']:.1f} s")
    return cfg


# ---------------------------------------------------------------- tempos
ANTECIPAR = 0.0   # s: o texto entra um pouco antes da palavra (ritmo.antecipar no reel.json)


class Relogio:
    """Acha o tempo absoluto de uma palavra falada dentro da cena (busca em ordem)."""

    def __init__(self, cena, narr):
        self.cena, self.narr, self.pos = cena, narr, 0
        self.t0 = cena["inicio"] + cena.get("voz_atraso", 0.3)
        self.faltas = []

    def palavra(self, alvo, seq=True, padrao=None):
        if self.narr:
            pal = self.narr["palavras"]
            for i in range(self.pos if seq else 0, len(pal)):
                if norm(pal[i][0]).startswith(norm(alvo)) and norm(alvo):
                    if seq:
                        self.pos = i + 1
                    return round(self.t0 + pal[i][1][0] - ANTECIPAR, 3)
        self.faltas.append(alvo)
        return round(padrao if padrao is not None else self.cena["inicio"] + 0.5, 3)


def resolver(cfg, narr):
    cenas = []
    impactos, transicoes, sons, legendas, ancoras_qa = [], [], [], [], []
    for k, (c, n) in enumerate(zip(cfg["cenas"], narr)):
        c = json.loads(json.dumps(c))
        r = Relogio(c, n)
        ini = c["inicio"]
        q = c.get("ritmo", 1.0)   # animacoes internas encolhem no modo compacto
        padrao = lambda j: ini + 0.6 + j * 0.6  # noqa: E731
        for j, l in enumerate(c.get("texto", [])):
            if "ancora" in l:
                t_pal = r.palavra(l["ancora"], padrao=padrao(j))
                l["t"] = round(t_pal + l.get("atraso", 0), 3)
                ancoras_qa.append((c["id"], l["ancora"], t_pal, l["linha"] + (f" (+{l['atraso']} s de proposito)" if l.get("atraso") else "")))
            elif "palavras_ancoras" in l:
                l["ts"] = [r.palavra(a, padrao=padrao(j) + q * .3) for q, a in enumerate(l["palavras_ancoras"])]
                ancoras_qa += [(c["id"], a, tt, l["linha"]) for a, tt in zip(l["palavras_ancoras"], l["ts"])]
                l["t"] = l["ts"][0]
            else:
                l["t"] = padrao(j)
            if l.get("reticencias"):
                l["ret_t"] = r.palavra(l["reticencias"], seq=False)
            if l.get("sublinhar_ancora"):
                l["sub_t"] = r.palavra(l["sublinhar_ancora"], seq=False)
            if l.get("impacto"):
                impactos.append({"t": l["t"], "forca": 1.0})
            elif cfg.get("ritmo", {}).get("socos"):
                impactos.append({"t": l["t"], "forca": .35})
                sons.append({"tipo": "impacto", "t": l["t"]})
            if l.get("carimbo"):
                sons.append({"tipo": "carimbo", "t": l["t"] + .12})
        if "numero" in c:
            c["numero"]["t"] = r.palavra(c["numero"]["ancora"], seq=False, padrao=ini + 1) - c["numero"].get("antes", 0)
            ancoras_qa.append((c["id"], c["numero"]["ancora"], c["numero"]["t"], c["numero"]["valor"]))
            sons += [{"tipo": "tique", "t": c["numero"]["t"] + q * .13} for q in range(len(c["numero"]["valor"]))]
        if "retrato" in c:
            c["retrato"]["t"] = r.palavra(c["retrato"]["ancora"], seq=False, padrao=ini + 1)
            sons.append({"tipo": "whoosh", "t": c["retrato"]["t"] - .2})
        if "documento" in c and "ancora" in c["documento"]:
            c["documento"]["t"] = r.palavra(c["documento"]["ancora"], seq=False, padrao=ini + .8)
            c["documento"]["x_t"] = r.palavra(c["documento"]["x_ancora"], seq=False, padrao=ini + 3) + .3
            sons += [{"tipo": "papel", "t": c["documento"]["t"], "dur": .4}, {"tipo": "marcador", "t": c["documento"]["x_t"]},
                     {"tipo": "marcador", "t": c["documento"]["x_t"] + .16}]
        if "botao" in c:
            c["botao"]["ts"] = [r.palavra(a, seq=False) + .15 for a in c["botao"]["cliques"]]
            sons += [{"tipo": "botao", "t": tt} for tt in c["botao"]["ts"]]
        if "cta" in c:
            c["cta"]["t"] = r.palavra(c["cta"]["ancora"], seq=False, padrao=c["fim"] - 3)
            ancoras_qa.append((c["id"], c["cta"]["ancora"], c["cta"]["t"], "CTA"))
            sons += [{"tipo": "pop", "t": c["cta"]["t"] + .05}, {"tipo": "pop", "t": c["cta"]["t"] + .75}]
        for chave in ("barras", "marcos"):   # modelos "dado": itens que entram na palavra falada
            for j, it in enumerate(c.get(chave, [])):
                it["t"] = r.palavra(it["ancora"], seq=False, padrao=ini + .8 + j * .8)
                ancoras_qa.append((c["id"], it["ancora"], it["t"], chave))
                sons.append({"tipo": "papel" if chave == "barras" else "carimbo", "t": it["t"], "dur": .35})
        if "grade" in c:
            g = c["grade"]
            g["t"] = r.palavra(g["ancora"], seq=False, padrao=ini + 1)
            ancoras_qa.append((c["id"], g["ancora"], g["t"], "grade"))
            sons += [{"tipo": "pop", "t": g["t"] + i * g.get("passo", .09) * q} for i in range(g["preenchidos"])]
        if c["modelo"].startswith("dado_"):
            sons.append({"tipo": "whoosh", "t": ini + .02})
        # efeitos proprios de cada modelo
        m = c["modelo"]
        if m == "impacto_documento":
            sons += [{"tipo": "whoosh", "t": ini + .02}, {"tipo": "papel", "t": ini + .1, "dur": .9 * q}]
        if m == "numero_trava":
            lv = next((l for l in c["texto"] if l.get("documento_sobe")), None)
            if lv:
                sons.append({"tipo": "papel", "t": lv["t"] - .3, "dur": .5})
        if m == "assinatura":
            sons.append({"tipo": "caneta", "t": ini + .35 * q, "dur": 2.0 * q})
        if m == "documento_scanner":
            sons += [{"tipo": "scanner", "t": ini + .35 * q, "dur": 1.7 * q}, {"tipo": "whoosh", "t": ini + 1.8 * q},
                     {"tipo": "marcador", "t": ini + 2.55 * q}]
        if m == "tela_dividida":
            sons.append({"tipo": "whoosh", "t": ini + .05})
        if m in ("chamada_final", "cta_simples"):
            sons.append({"tipo": "whoosh", "t": ini + .3 * q})
        tr = c.get("transicao_saida")
        if tr and k + 1 < len(cfg["cenas"]):
            transicoes.append({"t": c["fim"], "tipo": tr})
            sons.append({"tipo": "whoosh", "t": c["fim"] - .2})
            if tr in ("folha", "rasgo"):
                sons.append({"tipo": "papel", "t": c["fim"] - .3, "dur": .5})
            if tr == "flash":
                impactos.append({"t": c["fim"], "forca": .6})
        if r.faltas:
            log(f"AVISO: cena {c['id']}: palavras-ancora nao encontradas: {', '.join(r.faltas)}")
        c["_voz_inicio"] = r.t0
        cenas.append(c)
    return cenas, impactos, transicoes, sons, ancoras_qa


def montar_legendas(cfg, cenas, narr):
    lg = cfg["legendas"]
    claras = {"numero_trava", "assinatura"}  # fundo claro: legenda precisa de fundo discreto
    out, escondidas = [], []
    for c, n in zip(cenas, narr):
        if not n or not lg.get("ativo", True):
            continue
        tela = {norm(w) for l in c.get("texto", []) for w in l["linha"].split()}
        if "numero" in c:
            tela.add(norm(c["numero"]["valor"]))
        for chave, campos in (("barras", ("rotulo", "texto")), ("marcos", ("ano", "rotulo"))):
            for it in c.get(chave, []):
                tela |= {norm(w) for f in campos for w in str(it[f]).split()}
        if "cta" in c:
            tela |= {norm(w) for w in (c["cta"]["texto"] + " " + c["cta"]["perfil"]).replace("@", " ").replace("_", " ").split()}
        pal = [(w, c["_voz_inicio"] + s, c["_voz_inicio"] + e) for w, (s, e) in n["palavras"]]
        grupos, atual = [], []
        for w in pal:
            atual.append(w)
            fim = re.search(r"[.!?,;:]$", w[0]) is not None
            if len(atual) >= lg["palavras_max"] or (fim and len(atual) >= lg["palavras_min"]):
                grupos.append(atual)
                atual = []
        if atual:
            if grupos and len(atual) < lg["palavras_min"] and len(grupos[-1]) + len(atual) <= lg["palavras_max"]:
                grupos[-1] += atual
            else:
                while grupos and len(atual) < lg["palavras_min"] and len(grupos[-1]) > lg["palavras_min"]:
                    atual.insert(0, grupos[-1].pop())   # empresta palavra do bloco anterior
                grupos.append(atual)
        destaque = norm(c.get("destaque_legenda", ""))
        for g in grupos:
            iguais = sum(1 for w in g if norm(w[0]) in tela) / len(g)
            if iguais >= lg.get("esconder_se_repetida", .7):
                escondidas.append((c["id"], " ".join(w[0] for w in g)))
                continue
            out.append({"t0": round(g[0][1], 3), "t1": round(g[-1][2] + .3, 3), "cena": c["id"],
                        "fundo": bool(c.get("fundo_legenda")) or c["modelo"] in claras,
                        "palavras": [{"txt": w[0].upper(), "t": round(w[1], 3),
                                      "destaque": "orange" if destaque and norm(w[0]).startswith(destaque) else None} for w in g]})
    for a, b in zip(out, out[1:]):   # sem sobreposicao entre blocos
        a["t1"] = min(a["t1"], b["t0"])
    return out, escondidas


# ---------------------------------------------------------------- render de quadros
def html(cfg, spec, trabalho, proj):
    imagens = {p.stem: p.resolve().as_uri() for p in (proj / "imagens").glob("*.png")}
    for p in (AQUI / "texturas").iterdir():
        imagens[p.stem] = p.resolve().as_uri()
    dados = {"spec": spec, "imagens": imagens,
             "fontes": {"titulo": (AQUI / cfg["fontes"]["titulo"]).resolve().as_uri(),
                        "apoio": (AQUI / cfg["fontes"]["apoio"]).resolve().as_uri()}}
    js = (AQUI / "engine" / "reel.js").read_text(encoding="utf-8").replace("/*__DADOS__*/null", json.dumps(dados, ensure_ascii=False))
    p = trabalho / "reel.html"
    p.write_text("<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0;background:#000;overflow:hidden}"
                 "canvas{display:block}</style></head><body><canvas id='c'></canvas><script>" + js + "</script></body></html>",
                 encoding="utf-8")
    return p


def _chromium():
    env = os.environ.get("CHROMIUM_PATH")
    if env:
        return env
    p = Path("/opt/pw-browsers/chromium")
    return str(p) if p.exists() else None


def trabalhador(pagina, pasta, k, n, fps, total):
    from playwright.sync_api import sync_playwright

    quadros = int(round(total * fps))
    registro = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=_chromium(), args=["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"])
        pg = b.new_page(viewport={"width": 1080, "height": 1920})
        pg.goto(Path(pagina).as_uri())
        pg.wait_for_function("window.pronto === true", timeout=180000)
        for i in range(k, quadros, n):
            info = pg.evaluate(f"seek({i / fps:.5f})")
            pg.screenshot(path=str(Path(pasta) / f"q{i:05d}.jpg"), type="jpeg", quality=93)
            registro.append({"q": i, **info})
        b.close()
    (Path(pasta) / f"log_{k}.json").write_text(json.dumps(registro))


def renderizar(pagina, trabalho, fps, total, n=4):
    pasta = trabalho / "quadros"
    pasta.mkdir(parents=True, exist_ok=True)
    for f in list(pasta.glob("q*.jpg")) + list(pasta.glob("log_*.json")):
        f.unlink()
    quadros = int(round(total * fps))
    log(f"Renderizando {quadros} quadros em {n} processos...")
    procs = [subprocess.Popen([sys.executable, "-I", str(Path(__file__).resolve()), "--trabalhador", str(pagina), str(pasta),
                               str(k), str(n), str(fps), f"{total:.4f}"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
             for k in range(n)]
    saidas = [p.communicate()[0] for p in procs]
    if any(p.returncode for p in procs):
        sys.exit("Erro no render:\n" + "\n".join(s[-2000:] for s in saidas))
    reg = []
    for f in pasta.glob("log_*.json"):
        reg += json.loads(f.read_text())
    reg.sort(key=lambda r: r["q"])
    faltam = [i for i in range(quadros) if not (pasta / f"q{i:05d}.jpg").exists()]
    if faltam:
        sys.exit(f"Erro: {len(faltam)} quadros nao foram gerados.")
    return pasta, reg


# ---------------------------------------------------------------- principal
def main(cfg_path):
    t_ini = time.time()
    cfg_path = Path(cfg_path).resolve()
    proj = cfg_path.parent
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    nome = cfg["nome"]
    trabalho = RAIZ / "saida" / ".trabalho" / f"{nome}-editorial"
    trabalho.mkdir(parents=True, exist_ok=True)
    global ANTECIPAR
    ANTECIPAR = cfg.get("ritmo", {}).get("antecipar", 0.0)
    narr = carregar_narracao(cfg, cfg["cenas"])
    narr = acelerar_narracao(cfg, narr, trabalho)
    cfg = compactar(cfg, narr)
    fps, total = cfg["fps"], float(cfg["duration"])
    cenas, impactos, transicoes, sons, ancoras_qa = resolver(cfg, narr)
    legendas, escondidas = montar_legendas(cfg, cenas, narr)
    # cenas: a fala precisa caber na janela de cada cena
    estouro = []
    for c, n in zip(cenas, narr):
        if n and c["_voz_inicio"] + n["dur"] > c["fim"] - .1:
            estouro.append((c["id"], round(c["_voz_inicio"] + n["dur"] - c["fim"], 2)))
    spec = {"w": 1080, "h": 1920, "fps": fps, "total": total, "cores": cfg["colors"], "zona_segura": cfg["zona_segura"],
            "cenas": cenas, "impactos": impactos, "transicoes": transicoes, "legendas": legendas,
            "legenda_px": cfg["legendas"]["tamanho"], "legenda_y": cfg["legendas"]["y"],
            "empurrao": cfg.get("ritmo", {}).get("empurrao", 0)}
    (trabalho / "spec.json").write_text(json.dumps(spec, ensure_ascii=False, indent=1))
    pagina = html(cfg, spec, trabalho, proj)
    pasta, reg = renderizar(pagina, trabalho, fps, total)
    (trabalho / "registro.json").write_text(json.dumps(reg))
    t_video = time.time() - t_ini

    log("Audio: trilha e efeitos sintetizados, narracao, ducking e loudness...")
    tr = cfg.get("trilha", {})
    pausa7 = []
    for c, n in zip(cenas, narr):   # pausa dramatica depois da frase da memoria
        if c["modelo"] == "tela_dividida" and n:
            fim = c["_voz_inicio"] + n["dur"]
            pausa7.append((fim + .05, min(fim + .45, c["fim"])))
    cen_aud = [{"inicio": c["inicio"], "fim": c["fim"], "riser": c["modelo"] in ("retrato_carimbo", "chamada_final", "cta_simples")} for c in cenas]
    if tr.get("arquivo"):
        import soundfile as sf
        y, _ = sf.read(str(proj / tr["arquivo"]))
        musica = (y.mean(axis=1) if y.ndim > 1 else y)[: int(total * audio.SR)]
    else:
        st = tr.get("sintetizada", {})
        musica = audio.trilha(total, cen_aud, st.get("bpm", 120), st.get("intensidade"), pausa7)
    sfx = audio.efeitos(sons, total)
    voz = audio.narracao([(n["wav"], c["_voz_inicio"]) for c, n in zip(cenas, narr) if n], total)
    mix = audio.mixar(trabalho / "audio", musica, sfx, voz, tr.get("loudness_lufs", -14))

    saida = RAIZ / "saida"
    final = saida / f"{nome}.mp4"
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", str(fps), "-i", str(pasta / "q%05d.jpg"), "-i", str(mix),
                        "-map", "0:v", "-map", "1:a", "-t", f"{total:.3f}",
                        "-af", "alimiter=limit=0.6:attack=1:release=40:level=false",   # segura picos do AAC (true peak) "-c:v", "libx264", "-preset", "slow", "-crf", "19",
                        "-maxrate", "9M", "-bufsize", "18M", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", str(fps),
                        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-movflags", "+faststart", str(final)],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit("Erro no MP4 final:\n" + r.stderr[-1500:])
    previa = saida / f"{nome}.previa.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(final), "-vf", "scale=540:960", "-c:v", "libx264", "-crf", "30",
                    "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", str(previa)])
    for f in pasta.glob("q*.jpg"):
        if int(f.stem[1:]) % 15:   # guarda 2 quadros por segundo para o QA visual; o resto sai
            f.unlink()
    import qa_editorial
    qa_editorial.rodar(final, previa, cfg, cenas, narr, legendas, escondidas, reg, ancoras_qa, estouro, trabalho, pasta,
                       t_video, time.time() - t_ini)


if __name__ == "__main__":
    if len(sys.argv) >= 8 and sys.argv[1] == "--trabalhador":
        trabalhador(sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]), float(sys.argv[7]))
    elif len(sys.argv) == 2:
        main(sys.argv[1])
    else:
        sys.exit(__doc__)
