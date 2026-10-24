#!/usr/bin/env python
"""Monta um Reel 9:16 (1080x1920) a partir de um roteiro .md.

Uso: python fazer_reels.py roteiros/NOME.md [--modelo chatterbox|xtts]

Fluxo: le o roteiro -> gera a voz de cada cena (gerar_voz.py) -> mede as
duracoes -> usa faster-whisper para os tempos das palavras -> monta o video
com ffmpeg (zoom suave, transicao curta, legendas grandes, musica com ducking)
-> saida/NOME.mp4 (H.264, AAC, 30 fps).
"""
import argparse
import difflib
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
import warnings
from dataclasses import dataclass, field
from pathlib import Path

warnings.filterwarnings("ignore")

AQUI = Path(__file__).resolve().parent
MIDIA, MUSICA, SAIDA = AQUI / "midia", AQUI / "musica", AQUI / "saida"
W, H, FPS = 1080, 1920, 30
LEAD_PRIMEIRA = 0.15   # respiro antes da primeira fala
TRANS = 0.20           # duracao da transicao entre cenas
PAD = 0.35             # silencio depois de cada fala (precisa ser >= TRANS)
HOLD_FINAL = 0.5       # a ultima cena segura um pouco mais
LUFS_FALA, LUFS_MUSICA = -16, -24  # musica bem abaixo da fala (e ainda abaixa mais no ducking)
EXT_VIDEO = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}
CORES = ["1B2A41", "0C7C59", "7A306C", "B5451B", "2D3142", "14606B"]
AMARELO = "&H0000E5FF&"  # ASS usa BGR
TENTATIVAS_SEEDS = [7, 11, 23]
ALINHADOR = 2            # versao do alinhamento (numeros por extenso); muda -> realinha o cache
COBERTURA_MINIMA = 0.88  # fracao das palavras do roteiro que o Whisper deve reconhecer


@dataclass
class Cena:
    n: int
    fala: str
    midia: str = ""
    tela: str = ""
    visuais: list = field(default_factory=list)  # linhas 'visual:' (ver motion.py)
    extras: dict = field(default_factory=dict)   # camera/mostrar/destacar/... (templates mapa, grafico, fluxo)
    ancoras: list = field(default_factory=list)  # [(indice da palavra na fala, id)] vindos de {palavra} ou {palavra|id}


EXTRAS = ("camera", "mostrar", "destacar", "previa", "limpar", "dados", "escala", "entradas", "evento")


def extrair_ancoras(fala: str, marcador=False):
    """'A {BR-040} liga ao {Rio de Janeiro|rio}' -> ('A BR-040 liga ao Rio de Janeiro', [(1,'BR-040'),(4,'rio')]).

    marcador=True (template fluxo): um '{id}' solto entre espacos nao e falado; marca a PROXIMA palavra.
    'Primeiro, {produto} o custo' -> ('Primeiro, o custo', [(1,'produto')])."""
    limpo, ancoras, pos = "", [], 0
    for m in re.finditer(r"\{([^{}|]+)(?:\|([^{}]+))?\}", fala):
        solto = (m.start() == 0 or fala[m.start() - 1].isspace()) and (m.end() == len(fala) or fala[m.end()].isspace())
        if marcador and solto and not m.group(2):
            limpo += fala[pos:m.start()]
            ancoras.append((len(limpo.split()), m.group(1).strip()))
            pos = m.end()
            continue
        limpo += fala[pos:m.start()]
        idx = len(limpo.split()) if limpo.strip() else 0
        if limpo and not limpo[-1].isspace():
            idx -= 1  # chave colada a palavra anterior
        ancoras.append((idx, (m.group(2) or m.group(1)).strip()))
        limpo += m.group(1)
        pos = m.end()
    limpo += fala[pos:]
    return re.sub(r"\s+", " ", limpo).strip(), ancoras


# ---------------------------------------------------------------- roteiro

def parse_roteiro(caminho: Path):
    texto = caminho.read_text(encoding="utf-8").lstrip("﻿")
    meta = {}
    m = re.match(r"\s*---\s*\n(.*?)\n---\s*\n?", texto, re.S)
    if m:
        for linha in m.group(1).splitlines():
            if ":" in linha:
                k, v = linha.split(":", 1)
                meta[k.strip().lower()] = v.strip()
        texto = texto[m.end():]
    meta["_fontes"] = [c.strip() for c in re.findall(r"<!--(.*?)-->", texto, re.S)]
    texto = re.sub(r"<!--.*?-->", "", texto, flags=re.S)  # comentarios = fontes, fora do parser
    blocos = re.split(r"^##\s*Cena[^\n]*$", texto, flags=re.M | re.I)[1:]
    cenas = []
    for i, bloco in enumerate(blocos, 1):
        campos, atual, visuais = {}, None, []
        for linha in bloco.strip().splitlines():
            k = re.match(r"^(m[ií]dia|texto-na-tela|fala|visual|" + "|".join(EXTRAS) + r")\s*:\s*(.*)$",
                         linha.strip(), re.I)
            if k:
                atual = k.group(1).lower().replace("í", "i")
                if atual == "visual":
                    visuais.append(k.group(2).strip())
                else:
                    campos[atual] = k.group(2).strip()
            elif atual == "visual" and linha.strip():
                visuais[-1] += " " + linha.strip()
            elif atual and linha.strip():
                campos[atual] += " " + linha.strip()
        if not campos.get("fala"):
            sys.exit(f"Erro: a Cena {i} do roteiro nao tem 'fala:'.")
        fala, ancoras = extrair_ancoras(campos["fala"], marcador=meta.get("template", "").startswith("fluxo"))
        cenas.append(Cena(i, fala, campos.get("midia", ""), campos.get("texto-na-tela", ""), visuais,
                          {k: campos[k] for k in EXTRAS if k in campos}, ancoras))
    if not cenas:
        sys.exit("Erro: nenhuma '## Cena N' encontrada no roteiro.")
    return meta, cenas


# ---------------------------------------------------------------- utilitarios

def rodar(cmd, cwd=None):
    r = subprocess.run([str(c) for c in cmd], cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"Erro no comando: {' '.join(map(str, cmd[:6]))} ...\n{r.stderr[-1500:]}")
    return r.stdout


def duracao(caminho: Path) -> float:
    out = rodar(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=nw=1:nk=1", caminho])
    return float(out.strip())


def norm(p: str) -> str:
    p = unicodedata.normalize("NFKD", p.lower())
    return "".join(c for c in p if c.isalnum())


def tempo_ass(t: float) -> str:
    t = max(t, 0)
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


# ---------------------------------------------------------------- voz + tempos

def aparar_silencio(wav, sr, limiar=0.01, margem=0.06):
    import torch

    ativo = (wav.abs().max(dim=0).values > limiar).nonzero()
    if len(ativo) == 0:
        return wav
    ini = max(int(ativo[0]) - int(margem * sr), 0)
    fim = min(int(ativo[-1]) + int(margem * sr), wav.shape[-1])
    return wav[:, ini:fim]


def expandir_numeros(ws):
    """O Whisper escreve '45', 'R$ 6,50', '14,8%'; o roteiro escreve por extenso. Expande os numeros em
    palavras (dividindo o tempo do token) para o alinhamento casar palavra a palavra."""
    from num2words import num2words

    out, moeda = [], False
    for w, s, e in ws:
        tok = w.strip()
        if tok in ("R$", "R$:"):
            moeda = True
            continue
        m = re.fullmatch(r"(R\$)?([\d.]+)(?:,(\d+))?(%)?([.,!?;:]*)", tok)
        if not m:
            out.append((tok, s, e))
            moeda = False
            continue
        moeda = moeda or bool(m.group(1))
        inteiro = int(m.group(2).replace(".", "") or 0)
        partes = num2words(inteiro, lang="pt_BR").replace(",", "").split()
        if m.group(3):
            dec = m.group(3)
            if moeda and len(dec) == 2:
                partes += ["reais", "e"] + num2words(int(dec), lang="pt_BR").split()
            else:
                partes += ["vírgula"] + " ".join(num2words(int(d), lang="pt_BR") for d in dec).split()
        elif moeda:
            partes += ["reais"]
        if m.group(4):
            partes += ["por", "cento"]
        partes[-1] += m.group(5)
        passo = (e - s) / len(partes)
        out += [(p_, s + i * passo, s + (i + 1) * passo) for i, p_ in enumerate(partes)]
        moeda = False
    return out


def palavras_whisper(whisper, caminho: Path):
    segs, _ = whisper.transcribe(str(caminho), language="pt", word_timestamps=True,
                                 vad_filter=False, condition_on_previous_text=False)
    return expandir_numeros([(w.word.strip(), w.start, w.end) for s in segs for w in s.words if w.word.strip()])


def alinhar(fala: str, ws, dur: float):
    """Mapeia as palavras do roteiro aos tempos do Whisper. Retorna (tempos, cobertura)."""
    ps = fala.split()
    a, b = [norm(p) for p in ps], [norm(w[0]) for w in ws]
    tempos = [None] * len(ps)
    casadas = 0
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                tempos[i1 + k] = (ws[j1 + k][1], ws[j1 + k][2])
                casadas += 1
        elif tag == "replace" and i2 - i1 == j2 - j1:
            for k in range(i2 - i1):
                tempos[i1 + k] = (ws[j1 + k][1], ws[j1 + k][2])
                if difflib.SequenceMatcher(None, a[i1 + k], b[j1 + k]).ratio() >= 0.7:
                    casadas += 1
    cobertura = casadas / max(len(ps), 1)
    # interpola as palavras sem tempo, proporcional ao tamanho
    i = 0
    while i < len(ps):
        if tempos[i] is not None:
            i += 1
            continue
        j = i
        while j < len(ps) and tempos[j] is None:
            j += 1
        t0 = tempos[i - 1][1] if i > 0 else (ws[0][1] if ws else 0.0)
        t1 = tempos[j][0] if j < len(ps) else (ws[-1][2] if ws else dur)
        t1 = max(t1, t0 + 0.05 * (j - i))
        pesos = [max(len(a[k]), 1) for k in range(i, j)]
        acum = t0
        for k, peso in zip(range(i, j), pesos):
            passo = (t1 - t0) * peso / sum(pesos)
            tempos[k] = (acum, acum + passo)
            acum += passo
        i = j
    # garante ordem crescente
    ult = 0.0
    for k, (s, e) in enumerate(tempos):
        s = max(s, ult)
        e = max(e, s + 0.04)
        tempos[k] = (s, e)
        ult = s
    return list(zip(ps, tempos)), cobertura


def gerar_vozes(cenas, trabalho: Path, args):
    import torchaudio
    from faster_whisper import WhisperModel

    print("Carregando Whisper (tempos das palavras)...")
    whisper = WhisperModel(args.whisper, device="cpu", compute_type="int8")
    sint = None
    resultado = {}
    for c in cenas:
        wav_path = trabalho / f"cena_{c.n:02d}.wav"
        meta_path = trabalho / f"cena_{c.n:02d}.json"
        chave = hashlib.sha1(json.dumps([c.fala, args.modelo, args.ref], ensure_ascii=False)
                             .encode()).hexdigest()[:16]
        if wav_path.exists() and meta_path.exists():
            meta = json.loads(meta_path.read_text())
            if meta.get("chave") == chave:
                if meta.get("alinhador") != ALINHADOR:
                    palavras, cob = alinhar(c.fala, palavras_whisper(whisper, wav_path), duracao(wav_path))
                    meta.update(palavras=palavras, alinhador=ALINHADOR, cobertura=cob)
                    meta_path.write_text(json.dumps(meta, ensure_ascii=False))
                    print(f"[cena {c.n}] voz em cache, realinhada (cobertura {cob:.0%})")
                else:
                    print(f"[cena {c.n}] voz em cache")
                resultado[c.n] = meta["palavras"]
                continue
        if sint is None:
            from gerar_voz import Sintetizador

            print("Carregando o modelo de voz (pode levar um minuto)...")
            sint = Sintetizador(args.modelo, args.ref, device=args.device)
        melhor = None
        for seed in TENTATIVAS_SEEDS:
            print(f"[cena {c.n}] sintetizando (seed {seed}): {c.fala[:60]}")
            wav = aparar_silencio(sint.sintetizar(c.fala, seed), sint.sr)
            tmp = trabalho / f"cena_{c.n:02d}_tmp.wav"
            torchaudio.save(str(tmp), wav, sint.sr)
            dur = duracao(tmp)
            palavras, cob = alinhar(c.fala, palavras_whisper(whisper, tmp), dur)
            print(f"           {dur:.1f}s, cobertura do texto {cob:.0%}")
            if melhor is None or cob > melhor[0]:
                melhor = (cob, tmp.read_bytes(), palavras)
            if cob >= COBERTURA_MINIMA:
                break
        if melhor[0] < COBERTURA_MINIMA:
            print(f"AVISO: cena {c.n} com cobertura {melhor[0]:.0%}; ouça o trecho antes de publicar.")
        wav_path.write_bytes(melhor[1])
        (trabalho / f"cena_{c.n:02d}_tmp.wav").unlink(missing_ok=True)
        meta_path.write_text(json.dumps({"chave": chave, "palavras": melhor[2], "alinhador": ALINHADOR,
                                         "cobertura": melhor[0]}, ensure_ascii=False))
        resultado[c.n] = melhor[2]
    return resultado


# ---------------------------------------------------------------- video

def achar_midia(nome: str):
    if not nome:
        return None
    for cand in (MIDIA / nome, Path(nome)):
        if cand.is_file():
            return cand
    print(f"AVISO: midia '{nome}' nao encontrada em {MIDIA}; usando fundo de cor.")
    return None


def renderizar_cena(c: Cena, dur: float, idx: int, trabalho: Path) -> tuple[Path, bool]:
    """Gera o clipe mudo da cena. Retorna (arquivo, usou_midia)."""
    saida = trabalho / f"video_{c.n:02d}.mp4"
    quadros = int(round(dur * FPS))
    midia = achar_midia(c.midia)
    comum = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
             "-pix_fmt", "yuv420p", "-r", str(FPS), "-frames:v", str(quadros)]
    if midia is None:
        rodar(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
               f"color=c=0x{CORES[idx % len(CORES)]}:s={W}x{H}:r={FPS}", *comum, saida])
        return saida, False
    if midia.suffix.lower() in EXT_VIDEO:
        vf = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS}"
        rodar(["ffmpeg", "-y", "-v", "error", "-stream_loop", "-1", "-i", midia, "-vf", vf,
               *comum, saida])
    else:
        z = (f"1+0.12*on/{quadros}" if idx % 2 == 0 else f"1.12-0.12*on/{quadros}")
        vf = (f"scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,"
              f"zoompan=z='{z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s={W}x{H}:fps={FPS}")
        rodar(["ffmpeg", "-y", "-v", "error", "-framerate", str(FPS), "-loop", "1", "-i", midia,
               "-vf", vf, *comum, saida])
    return saida, True


def montar_narracao(cenas, wavs_dir: Path, offsets, total: float, destino: Path):
    import torch
    import torchaudio

    sr = 24000
    base = torch.zeros(1, int(total * sr) + sr)
    for c in cenas:
        wav, s = torchaudio.load(str(wavs_dir / f"cena_{c.n:02d}.wav"))
        if s != sr:
            wav = torchaudio.functional.resample(wav, s, sr)
        ini = int(offsets[c.n] * sr)
        fim = min(ini + wav.shape[-1], base.shape[-1])
        base[:, ini:fim] += wav[:1, : fim - ini]
    torchaudio.save(str(destino), base[:, : int(total * sr)], sr)


def agrupar(palavras, max_pal=3, max_chars=20):
    grupos, atual = [], []
    for p in palavras:
        atual.append(p)
        texto = " ".join(x[0] for x in atual)
        if len(atual) >= max_pal or len(texto) >= max_chars or re.search(r"[.!?;:]$", p[0]):
            grupos.append(atual)
            atual = []
    if atual:
        grupos.append(atual)
    return grupos


def limpar(p: str) -> str:
    return p.strip(" ,").upper().replace("{", "(").replace("}", ")")


def construir_ass(cenas, palavras, offsets, starts, durs, usou_midia, args, destino: Path,
                  com_motion=False):
    cab = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Legenda,{args.fonte},108,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,7,2,2,60,60,480,1
Style: Tela,{args.fonte},72,&H00FFFFFF,&H00FFFFFF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,3,14,0,8,70,70,230,1
Style: Chave,{args.fonte},124,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,8,3,5,70,70,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    for i, c in enumerate(cenas):
        visivel_ini = starts[i] + (TRANS if i > 0 else 0)
        visivel_fim = starts[i] + durs[i] - (TRANS if i < len(cenas) - 1 else 0)
        chave = c.tela
        if not usou_midia[i] and not chave:
            chave = " ".join(c.fala.split()[:5]).rstrip(".,;:")
        if com_motion:
            chave = ""  # o texto-na-tela vira o titulo animado da camada de motion
        if chave:
            estilo = "Tela" if usou_midia[i] else "Chave"
            ev.append(f"Dialogue: 0,{tempo_ass(visivel_ini)},{tempo_ass(visivel_fim)},{estilo},,0,0,0,,"
                      f"{{\\fad(180,180)}}{chave.upper() if estilo == 'Chave' else chave}")
    # legendas palavra a palavra (grupos curtos, palavra atual em amarelo)
    todos = []
    for i, c in enumerate(cenas):
        for p, (s, e) in palavras[c.n]:
            todos.append((p, offsets[c.n] + s, offsets[c.n] + e))
    grupos = agrupar(todos)
    for gi, g in enumerate(grupos):
        prox_grupo = grupos[gi + 1][0][1] if gi + 1 < len(grupos) else None
        for wi, (p, s, e) in enumerate(g):
            if wi + 1 < len(g):
                fim = g[wi + 1][1]
            else:
                fim = e + 0.25
                if prox_grupo is not None:
                    fim = min(fim, prox_grupo)
            partes = [("{\\1c" + AMARELO + "}" if k == wi else "{\\1c&H00FFFFFF&}") + limpar(q[0])
                      for k, q in enumerate(g)]
            ev.append(f"Dialogue: 1,{tempo_ass(s)},{tempo_ass(max(fim, s + 0.05))},Legenda,,0,0,0,,"
                      + " ".join(partes))
    destino.write_text(cab + "\n".join(ev) + "\n", encoding="utf-8")


def construir_ass_mapa(cenas, palavras, offsets, destino: Path, cfg):
    """Legenda da referencia: branca, negrito italico, sem caixa, 2 a 5 palavras, troca com a fala."""
    lg = cfg["legenda"]
    mv = round(H - lg["posicao_y"] * H - lg["tamanho"] / 2)
    cab = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Leg,{cfg["fonte"]["familia"]},{lg["tamanho"]},&H00FFFFFF,&H00FFFFFF,&H64000000,&H78000000,-1,-1,0,0,100,100,0,0,1,1.2,{lg["sombra"]},2,60,60,{mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    todos = [(p, offsets[c.n] + s_, offsets[c.n] + e_) for c in cenas for p, (s_, e_) in palavras[c.n]]
    grupos, atual = [], []
    for w in todos:
        atual.append(w)
        txt = " ".join(x[0] for x in atual)
        fim_frase = re.search(r"[.!?;:]$", w[0]) is not None
        if len(atual) >= lg["palavras_max"] or len(txt) >= 24 or (fim_frase and len(atual) >= lg["palavras_min"]):
            grupos.append(atual)
            atual = []
    if atual:
        grupos.append(atual)
    # nada de bloco com 1 palavra quando da para juntar
    for k in range(len(grupos) - 1, 0, -1):
        if len(grupos[k]) < lg["palavras_min"] and len(grupos[k - 1]) + len(grupos[k]) <= lg["palavras_max"]:
            grupos[k - 1] += grupos.pop(k)
    ev = []
    for k, g in enumerate(grupos):
        ini = g[0][1]
        fim = g[-1][2] + 0.25
        if k + 1 < len(grupos) and grupos[k + 1][0][1] - g[-1][2] < 0.6:
            fim = grupos[k + 1][0][1]
        txt = " ".join(x[0] for x in g).replace("{", "(").replace("}", ")")
        ev.append(f"Dialogue: 0,{tempo_ass(ini)},{tempo_ass(fim)},Leg,,0,0,0,,{{\\blur0.8}}{txt}")
    destino.write_text(cab + "\n".join(ev) + "\n", encoding="utf-8")
    return grupos


def gerar_whooshes(tempos, total: float, destino: Path, db: float, sr=44100):
    """Whoosh sintetizado (ruido filtrado com envelope), centrado em cada tempo. Sem licenca envolvida."""
    import numpy as np
    import soundfile as sf
    from scipy.signal import butter, sosfilt

    rng = np.random.default_rng(7)
    faixa = np.zeros(int((total + 1) * sr), dtype=np.float32)
    dur = 0.7
    n = int(dur * sr)
    env = np.sin(np.linspace(0, np.pi, n)) ** 2 * np.linspace(0.6, 1.0, n)
    for t in tempos:
        ruido = rng.standard_normal(n)
        baixo = sosfilt(butter(4, [300, 2200], "bandpass", fs=sr, output="sos"), ruido)
        alto = sosfilt(butter(4, [1800, 7000], "bandpass", fs=sr, output="sos"), ruido)
        mix = np.linspace(0, 1, n)  # sobe o brilho ao longo do whoosh
        w = (baixo * (1 - mix) + alto * mix) * env
        w = w / (np.sqrt(np.mean(w ** 2)) + 1e-9) * 10 ** (db / 20)
        i0 = max(int((t - dur * 0.55) * sr), 0)
        faixa[i0:i0 + n] += w[: len(faixa) - i0].astype(np.float32)
    sf.write(destino, faixa[: int(total * sr)], sr)


def montar_mapa_final(mapa_mp4: Path, narracao: Path, sfx: Path, musica, total, destino: Path,
                      trabalho: Path, cfg):
    entradas = ["-i", mapa_mp4, "-i", narracao, "-i", sfx]
    if musica:
        entradas += ["-stream_loop", "-1", "-i", musica]
    fontsdir = (AQUI / cfg["fonte"]["arquivo"]).parent
    filtros = [f"[0:v]ass=legendas.ass:fontsdir={fontsdir}[vout]",
               "[1:a]asplit=2[v1][v2]",
               "[2:a][v2]sidechaincompress=threshold=0.015:ratio=6:attack=8:release=300[sfxd]",
               "[v1][sfxd]amix=inputs=2:duration=first:normalize=0[voz]"]
    if musica:
        filtros += ["[voz]asplit=2[fala][lado]",
                    f"[3:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,afade=t=out:st={max(total - 1.2, 0):.3f}:d=1.2[mus]",
                    "[mus][lado]sidechaincompress=threshold=0.03:ratio=4:attack=15:release=450[duck]",
                    "[fala][duck]amix=inputs=2:duration=first:normalize=0[aout]"]
    else:
        filtros.append("[voz]anull[aout]")
    v = cfg["video"]
    rodar(["ffmpeg", "-y", "-v", "error", *entradas, "-filter_complex", ";".join(filtros),
           "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}",
           "-c:v", "libx264", "-preset", "slow", "-b:v", v["bitrate"], "-maxrate", "12M", "-bufsize", "20M",
           "-pix_fmt", "yuv420p", "-r", str(v["fps"]), "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
           "-movflags", "+faststart", destino], cwd=trabalho)


def normalizar_volume(origem: Path, destino: Path, lufs: float):
    """Normaliza em passo separado: loudnorm dentro do grafo com asplit/amix trunca o audio."""
    rodar(["ffmpeg", "-y", "-v", "error", "-i", origem, "-af",
           f"loudnorm=I={lufs}:TP=-1.5:LRA=11,aresample=44100", "-ac", "1", destino])


def montar_video(videos, narracao: Path, musica, total, starts, destino: Path, trabalho: Path,
                 motion: tuple | None = None):
    entradas = []
    for v in videos:
        entradas += ["-i", v]
    entradas += ["-i", narracao]
    i_nar = len(videos)
    if musica:
        entradas += ["-stream_loop", "-1", "-i", musica]
    if motion:  # (fundo, elementos): WebM VP9 com alpha, precisa do decodificador libvpx
        i_motion = i_nar + 1 + (1 if musica else 0)
        for arq in motion:
            entradas += ["-c:v", "libvpx-vp9", "-i", arq]
    filtros, ult = [], "0:v"
    for k in range(1, len(videos)):
        saida = f"v{k}"
        filtros.append(f"[{ult}][{k}:v]xfade=transition=fade:duration={TRANS}:offset={starts[k]:.3f}[{saida}]")
        ult = saida
    if motion:  # motion graphics entre o video e as legendas
        filtros.append(f"[{i_motion}:v]scale={W}:{H}:flags=bicubic,format=rgba[mbg]")
        filtros.append(f"[{ult}][mbg]overlay=format=auto:shortest=0[vbg]")
        filtros.append(f"[vbg][{i_motion + 1}:v]overlay=format=auto:shortest=0[vmot]")
        ult = "vmot"
    filtros.append(f"[{ult}]ass=legendas.ass[vout]")
    if musica:
        i_mus = i_nar + 1
        filtros += [
            f"[{i_nar}:a]asplit=2[fala][lado]",
            f"[{i_mus}:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,"
            f"afade=t=out:st={max(total - 1.2, 0):.3f}:d=1.2[mus]",
            "[mus][lado]sidechaincompress=threshold=0.03:ratio=4:attack=15:release=450[duck]",
            "[fala][duck]amix=inputs=2:duration=first:normalize=0[aout]",
        ]
    else:
        filtros.append(f"[{i_nar}:a]anull[aout]")
    rodar(["ffmpeg", "-y", "-v", "error", *entradas, "-filter_complex", ";".join(filtros),
           "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}",
           "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
           "-r", str(FPS), "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
           "-movflags", "+faststart", destino], cwd=trabalho)


# ---------------------------------------------------------------- principal

def main():
    p = argparse.ArgumentParser(description="Monta um Reel 9:16 a partir de um roteiro .md")
    p.add_argument("roteiro", type=Path)
    p.add_argument("--modelo", choices=["chatterbox", "xtts"], default="chatterbox")
    p.add_argument("--ref", default=str(AQUI / "amostras" / "minha-voz.wav"))
    p.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    p.add_argument("--whisper", default="small", help="modelo faster-whisper (tiny/base/small/medium)")
    p.add_argument("--fonte", default="Inter", help="fonte das legendas (precisa estar instalada)")
    p.add_argument("--refazer", action="store_true", help="ignora o cache de voz")
    p.add_argument("--so-voz", action="store_true", help="so gera/atualiza a voz das cenas (cache) e para")
    p.add_argument("--motion", choices=["auto", "manual", "off"], default="auto",
                   help="graficos animados: auto (explicitos + automaticos), manual (so 'visual:'), off")
    a = p.parse_args()

    if not a.roteiro.is_file():
        sys.exit(f"Roteiro nao encontrado: {a.roteiro}")
    nome = a.roteiro.stem
    meta, cenas = parse_roteiro(a.roteiro)
    trabalho = SAIDA / ".trabalho" / nome
    trabalho.mkdir(parents=True, exist_ok=True)
    if a.refazer:
        for f in trabalho.glob("cena_*"):
            f.unlink()
    print(f"== {meta.get('titulo', nome)}: {len(cenas)} cenas ==")
    if meta.get("template", "").startswith("fluxo"):   # contas e roteiro conferidos ANTES da voz
        import fluxo

        calc = fluxo.calcular(meta)
        falhas = [f"{n_}: {d_}" for n_, ok, d_ in fluxo.testar(calc, meta) if not ok]
        if falhas:
            sys.exit("Testes de numeros falharam:\n- " + "\n- ".join(falhas))
        probs = fluxo.conferir_roteiro(cenas, calc)
        if probs:
            sys.exit("O roteiro diverge do calculo (nada foi ajustado; corrija o roteiro ou as entradas):\n- "
                     + "\n- ".join(probs))
        print("Numeros conferidos: testes ok e roteiro coerente com o calculo.")

    palavras = gerar_vozes(cenas, trabalho, a)
    if a.so_voz:
        return

    durs_audio = {c.n: duracao(trabalho / f"cena_{c.n:02d}.wav") for c in cenas}
    print("Duracoes:", ", ".join(f"cena {n}: {d:.1f}s" for n, d in durs_audio.items()))

    # linha do tempo: cada cena tem [lead][fala][pad]; a proxima comeca TRANS antes do fim
    starts, durs, offsets, t = [], [], {}, 0.0
    for i, c in enumerate(cenas):
        lead = LEAD_PRIMEIRA if i == 0 else TRANS
        d = lead + durs_audio[c.n] + PAD + (HOLD_FINAL if i == len(cenas) - 1 else 0)
        starts.append(t)
        durs.append(d)
        offsets[c.n] = t + lead
        t += d - TRANS
    total = starts[-1] + durs[-1]

    if meta.get("template", "").split()[0:1] == ["fluxo"]:
        return fazer_fluxo(a, meta, cenas, palavras, offsets, starts, durs, total, trabalho, nome)
    if meta.get("template", "").split()[0:1] == ["mapa"]:
        return fazer_mapa(a, meta, cenas, palavras, offsets, starts, durs, total, trabalho, nome)

    videos, usou = [], []
    for i, c in enumerate(cenas):
        print(f"[cena {c.n}] renderizando video ({durs[i]:.1f}s)")
        v, u = renderizar_cena(c, durs[i], i, trabalho)
        videos.append(v)
        usou.append(u)

    bruta = trabalho / "narracao_bruta.wav"
    narracao = trabalho / "narracao.wav"
    montar_narracao(cenas, trabalho, offsets, total, bruta)
    normalizar_volume(bruta, narracao, LUFS_FALA)
    com_motion = a.motion != "off"
    construir_ass(cenas, palavras, offsets, starts, durs, usou, a, trabalho / "legendas.ass",
                  com_motion=com_motion)

    motion_mov = None
    if com_motion:
        import motion

        spec = motion.planejar(cenas, palavras, offsets, starts, durs, usou, total, a.motion)
        print(f"Motion: {len(spec['elementos'])} elementos animados em {len(cenas)} cenas")
        motion_mov = motion.renderizar(spec, trabalho / "motion.mov", FPS)

    musica = None
    if meta.get("musica"):
        cand = MUSICA / meta["musica"]
        if cand.is_file():
            musica = trabalho / "musica.wav"
            normalizar_volume(cand, musica, LUFS_MUSICA)
        else:
            print(f"AVISO: musica '{meta['musica']}' nao encontrada em {MUSICA}; seguindo sem musica.")

    SAIDA.mkdir(exist_ok=True)
    destino = SAIDA / f"{nome}.mp4"
    print("Montando o video final...")
    montar_video(videos, narracao, musica, total, starts, destino, trabalho, motion_mov)
    print(f"\nPronto: {destino} ({total:.1f}s)")


def fazer_mapa(a, meta, cenas, palavras, offsets, starts, durs, total, trabalho, nome):
    import time

    import yaml

    import mapa
    import qa

    cfg = yaml.safe_load((AQUI / "config.yaml").read_text(encoding="utf-8"))
    t0 = time.time()
    mapa.preparar()
    bruta = trabalho / "narracao_bruta.wav"
    narracao = trabalho / "narracao.wav"
    montar_narracao(cenas, trabalho, offsets, total, bruta)
    normalizar_volume(bruta, narracao, LUFS_FALA)
    grupos = construir_ass_mapa(cenas, palavras, offsets, trabalho / "legendas.ass", cfg)
    spec = mapa.planejar(cenas, palavras, offsets, starts, durs, total)
    print(f"Mapa: {len(spec['eventos'])} eventos, {len(spec['cameras'])} enquadramentos")
    mapa_mp4 = mapa.renderizar(spec, trabalho)
    t_render = time.time() - t0
    sfx = trabalho / "sfx.wav"
    tempos_sfx = spec["cortes"] + [e["t"] for e in spec["eventos"] if e["tipo"] in ("previa", "limpar")]
    gerar_whooshes(tempos_sfx, total, sfx, cfg["audio"]["whoosh_db"])
    musica = None
    if meta.get("musica"):
        cand = MUSICA / meta["musica"]
        if cand.is_file():
            musica = trabalho / "musica.wav"
            normalizar_volume(cand, musica, LUFS_MUSICA)
        else:
            print(f"AVISO: musica '{meta['musica']}' nao encontrada em {MUSICA}; seguindo sem musica.")
    destino = SAIDA / f"{nome}.mp4"
    print("Montando o video final...")
    montar_mapa_final(mapa_mp4, narracao, sfx, musica, total, destino, trabalho, cfg)
    print(f"Video: {destino} ({total:.1f}s). Rodando o QA...")
    qa.rodar_qa(destino, nome, meta, cenas, spec, grupos, trabalho, cfg, t_render, a.whisper)


def fazer_fluxo(a, meta, cenas, palavras, offsets, starts, durs, total, trabalho, nome):
    import time

    import yaml

    import fluxo
    import qa

    cfg = yaml.safe_load((AQUI / "config.yaml").read_text(encoding="utf-8"))
    calc = fluxo.calcular(meta)
    t0 = time.time()
    bruta = trabalho / "narracao_bruta.wav"
    narracao = trabalho / "narracao.wav"
    montar_narracao(cenas, trabalho, offsets, total, bruta)
    normalizar_volume(bruta, narracao, LUFS_FALA)
    grupos = construir_ass_mapa(cenas, palavras, offsets, trabalho / "legendas.ass", cfg)
    spec = fluxo.planejar(cenas, palavras, offsets, starts, durs, total, calc, meta)
    print(f"Fluxo: {len(spec['pecas1']) + len(spec['pecas2'])} quadrados animados, {len(spec['eventos'])} eventos ancorados")
    mp4 = fluxo.renderizar(spec, trabalho)
    t_render = time.time() - t0
    sfx = trabalho / "sfx.wav"
    fluxo.gerar_sons(spec["sons"], total, sfx)
    musica = None
    if meta.get("musica"):
        cand = MUSICA / meta["musica"]
        if cand.is_file():
            musica = trabalho / "musica.wav"
            normalizar_volume(cand, musica, LUFS_MUSICA)
        else:
            print(f"AVISO: musica '{meta['musica']}' nao encontrada em {MUSICA}; seguindo sem musica.")
    destino = SAIDA / f"{nome}.mp4"
    print("Montando o video final...")
    montar_mapa_final(mp4, narracao, sfx, musica, total, destino, trabalho, cfg)
    print(f"Video: {destino} ({total:.1f}s). Rodando o QA...")
    qa.rodar_qa_fluxo(destino, nome, meta, cenas, spec, grupos, trabalho, cfg, t_render, calc, a.whisper)


if __name__ == "__main__":
    sys.path.insert(0, str(AQUI))
    main()
