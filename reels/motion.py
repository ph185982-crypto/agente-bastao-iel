#!/usr/bin/env python
"""Camada de motion graphics: elementos animados sincronizados com a fala.

O fazer_reels.py chama planejar() para montar o "spec" (o que aparece e quando) e
renderizar() para gerar um video com transparencia (PNG em MOV) que o ffmpeg
sobrepoe ao video. As animacoes sao desenhadas por um Chromium sem tela, quadro a
quadro (motion_template.html), entao o resultado e identico a cada execucao.

Uso interno: python motion.py --trabalhador spec.json pasta_quadros k N fps
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

AQUI = Path(__file__).resolve().parent
TEMPLATE = AQUI / "motion_template.html"
ACENTOS = ["#FFC53D", "#38BDF8", "#FF5D8F", "#4ADE80", "#C084FC", "#FB923C"]
TIPOS = {"titulo", "destaque", "numero", "icone", "linha-do-tempo", "lista", "comparacao", "grafico"}
ZONA_TOPO = {"titulo", "destaque"}
MULTI = {"linha-do-tempo", "lista", "grafico"}


UNIDADES = {"anos", "ano", "dias", "meses", "semanas", "horas", "seculos", "mil", "km", "metros", "milhas",
            "soldados", "pessoas", "vezes", "reais", "dolares", "anos.", "mortos", "habitantes"}


def _modo(valor: int, bruto: str, proxima: str) -> str:
    """'ano' (pop-in) so para 1000-2100 sem ponto e sem unidade depois; senao conta de 0 ate o valor."""
    if 1000 <= valor <= 2100 and "." not in bruto and norm(proxima) not in UNIDADES:
        return "ano"
    return "contar"


def _item_ancora(texto: str):
    """'Pedra encontrada @Champollion' -> ('Pedra encontrada', 'Champollion')."""
    m = re.search(r"\s@(\S+)\s*$", texto)
    return (texto[: m.start()].strip(), m.group(1)) if m else (texto.strip(), None)

# palavra (sem acento, minuscula) -> emoji. Gatilho automatico quando a fala cita a palavra.
EMOJIS = {
    "pedra": "🪨", "rocha": "🪨", "egito": "🏺", "farao": "🏺", "piramide": "🔺", "piramides": "🔺",
    "napoleao": "⚔️", "soldado": "⚔️", "soldados": "⚔️", "guerra": "⚔️", "batalha": "⚔️",
    "exercito": "⚔️", "espada": "🗡️", "rei": "👑", "rainha": "👑", "imperador": "👑",
    "imperio": "👑", "coroa": "👑", "navio": "⛵", "navios": "⛵", "caravela": "⛵", "ouro": "🪙",
    "tesouro": "🪙", "moeda": "🪙", "moedas": "🪙", "dinheiro": "💰", "fogo": "🔥", "incendio": "🔥",
    "livro": "📖", "livros": "📖", "texto": "📜", "escrita": "📜", "escrito": "📜",
    "manuscrito": "📜", "pergaminho": "📜", "cientista": "🔬", "ciencia": "🔬", "descoberta": "🔬",
    "cerebro": "🧠", "mente": "🧠", "mapa": "🗺️", "viagem": "🗺️", "mundo": "🌍", "terra": "🌍",
    "castelo": "🏰", "vulcao": "🌋", "peste": "🦠", "doenca": "🦠", "lua": "🌙", "sol": "☀️",
    "estrela": "⭐", "estrelas": "⭐", "segredo": "🔍", "misterio": "🔍", "escondido": "🔍",
    "bomba": "💣", "igreja": "⛪", "coracao": "❤️", "morte": "💀", "morreu": "💀", "veneno": "☠️",
    "tempo": "⏳", "seculos": "⏳", "civilizacao": "🏛️", "roma": "🏛️", "grecia": "🏛️",
    "grego": "🏛️", "chave": "🔑", "lingua": "🗣️", "idioma": "🗣️", "olho": "👁️", "ideia": "💡",
}


def norm(p: str) -> str:
    p = unicodedata.normalize("NFKD", p.lower())
    return "".join(c for c in p if c.isalnum())


def achar_emoji(valor: str) -> str:
    v = valor.strip()
    return EMOJIS.get(norm(v), v)


# ---------------------------------------------------------------- roteiro: linha "visual:"

def parse_visual(linha: str):
    """'numero: 1799 | Ano da descoberta @1799' -> dict do elemento (ou None)."""
    ancora = None
    if ":" not in linha:
        print(f"AVISO: 'visual: {linha}' sem tipo (use 'tipo: conteudo'); ignorado.")
        return None
    tipo, resto = linha.split(":", 1)
    tipo, resto = norm(tipo.replace("-", "")), resto.strip()
    aliases = {"titulo": "titulo", "destaque": "destaque", "numero": "numero", "icone": "icone",
               "linhadotempo": "linha-do-tempo", "timeline": "linha-do-tempo", "lista": "lista",
               "comparacao": "comparacao", "grafico": "grafico"}
    if tipo not in aliases:
        print(f"AVISO: tipo de visual '{tipo}' desconhecido; ignorado. Tipos: {', '.join(sorted(TIPOS))}")
        return None
    tipo = aliases[tipo]
    if tipo not in MULTI:  # nos de varios itens, a ancora (@palavra) vale por item
        m = re.search(r"\s@(\S+)\s*$", resto)
        if m:
            ancora, resto = m.group(1), resto[: m.start()]
    e = {"tipo": tipo, "ancora": ancora}
    partes = [p.strip() for p in resto.split("|", 1)]
    if tipo in ("titulo", "destaque"):
        e["texto"] = resto
    elif tipo == "numero":
        tok = partes[0].split()
        bruto = tok[0] if tok else "0"
        digitos = re.sub(r"[^\d]", "", bruto)
        if not digitos:
            print(f"AVISO: numero sem digitos em 'visual: {linha}'; ignorado.")
            return None
        v = int(digitos)
        e.update(valor=v, modo=_modo(v, bruto, " ".join(tok[1:]) or (partes[1] if len(partes) > 1 else "")),
                 sufixo=re.sub(r"[\d.]", "", bruto) if re.sub(r"[\d.]", "", bruto) in ("%", "+", "x") else "",
                 rotulo=partes[1] if len(partes) > 1 else " ".join(tok[1:]))
    elif tipo == "icone":
        e.update(emoji=achar_emoji(partes[0]), rotulo=partes[1] if len(partes) > 1 else "")
    elif tipo == "linha-do-tempo":
        itens = []
        for it in resto.split(";"):
            it, anc = _item_ancora(it)
            if it:
                a, _, t = it.partition(" ")
                itens.append({"ano": a, "texto": t.strip(), "ancora": anc})
        e["itens"] = itens
    elif tipo == "lista":
        e["itens"] = []
        for i in resto.split(";"):
            t, anc = _item_ancora(i)
            if t:
                e["itens"].append({"texto": t, "ancora": anc})
    elif tipo == "comparacao":
        a, b = (re.split(r"\s+(?:x|vs\.?|versus)\s+", resto, maxsplit=1, flags=re.I) + [""])[:2]
        e.update(a=a.strip(), b=b.strip())
    elif tipo == "grafico":
        itens = []
        for it in resto.split(";"):
            it, anc = _item_ancora(it)
            if "=" in it:
                r, v = it.rsplit("=", 1)
                d = re.sub(r"[^\d]", "", v)
                if d:
                    itens.append({"rotulo": r.strip(), "valor": int(d), "sufixo": "%" if "%" in v else "",
                                  "ancora": anc})
        e["itens"] = itens
    vazio = (not e.get("texto", "x") or not e.get("itens", [1]) or (tipo == "comparacao" and not e["b"]))
    if vazio:
        print(f"AVISO: 'visual: {tipo}' sem conteudo suficiente; ignorado.")
        return None
    return e


# ---------------------------------------------------------------- planejamento

def _ancora(palavras_cena, token):
    alvo = norm(token)
    if not alvo:
        return None
    for w, (s, _e) in palavras_cena:
        if norm(w) == alvo:
            return s
    for w, (s, _e) in palavras_cena:
        if norm(w).startswith(alvo) or alvo.startswith(norm(w)) and len(norm(w)) >= 4:
            return s
    return None


def _auto(c, palavras_cena, anterior_emoji):
    """Elementos automaticos: numeros e palavras-chave citados na fala."""
    out, emoji_usado = [], None
    for i, (w, (s, _e)) in enumerate(palavras_cena):
        if re.search(r"\d", w) and len([o for o in out if o["tipo"] == "numero"]) < 2:
            digitos = re.sub(r"[^\d]", "", w)
            if not digitos or len(digitos) > 9:
                continue
            v = int(digitos)
            prox = palavras_cena[i + 1][0].strip(" ,.;:!?") if i + 1 < len(palavras_cena) else ""
            modo = _modo(v, w.strip(" ,.;:!?"), prox)
            out.append({"tipo": "numero", "valor": v, "modo": modo, "sufixo": "",
                        "rotulo": "" if modo == "ano" or not prox.isalpha() else prox, "_t": s})
    for w, (s, _e) in palavras_cena:
        k = norm(w)
        em = EMOJIS.get(k) or EMOJIS.get(k.rstrip("s"))
        if em and em != anterior_emoji:
            out.append({"tipo": "icone", "emoji": em, "rotulo": "", "_t": s})
            emoji_usado = em
            break
    return out, emoji_usado


def planejar(cenas, palavras, offsets, starts, durs, usou_midia, total, modo="auto"):
    """Monta o spec. modo: 'auto' (explicito + automatico) ou 'manual' (so o que o roteiro pede)."""
    spec_cenas, elementos, cortes = [], [], []
    emoji_ant = None
    for i, c in enumerate(cenas):
        accent = ACENTOS[i % len(ACENTOS)]
        ini, fim = starts[i], starts[i] + durs[i]
        spec_cenas.append({"start": ini, "end": fim, "accent": accent,
                           "fundo": "leve" if usou_midia[i] else "cheio"})
        if i + 1 < len(cenas):
            cortes.append({"t": starts[i + 1], "accent": ACENTOS[(i + 1) % len(ACENTOS)]})
        vis0 = ini + (0.2 if i > 0 else 0.0)
        vis1 = fim - (0.2 if i < len(cenas) - 1 else 0.0)
        pal = palavras[c.n]
        dur_fala = (pal[-1][1][1] if pal else 1.0)

        if c.tela:
            elementos.append({"tipo": "titulo", "texto": c.tela, "t0": vis0 + 0.1, "t1": vis1,
                              "accent": accent})

        explicitos = [e for e in (parse_visual(v) for v in c.visuais) if e]
        if explicitos:
            itens = explicitos
        elif modo == "auto":
            itens, emoji_ant_novo = _auto(c, pal, emoji_ant)
            emoji_ant = emoji_ant_novo or emoji_ant
        else:
            itens = []

        topo = [e for e in itens if e["tipo"] in ZONA_TOPO]
        centro = [e for e in itens if e["tipo"] not in ZONA_TOPO]
        for e in topo:
            e["accent"] = accent
            e["t0"] = vis0 + 0.15
            e["t1"] = vis1
            elementos.append(e)
        # elementos do centro: um de cada vez, na ordem; cada um entra na palavra-ancora
        n = len(centro)
        for k, e in enumerate(centro):
            t = None
            if e.get("ancora"):
                t = _ancora(pal, e["ancora"])
                if t is None:
                    print(f"AVISO: ancora '@{e['ancora']}' nao encontrada na fala da cena {c.n}.")
            if t is None and e["tipo"] in MULTI and e["itens"][0].get("ancora"):
                t = _ancora(pal, e["itens"][0]["ancora"])
            if t is None:
                t = e.pop("_t", None)
            if t is None:
                t = 0.25 + k * max(dur_fala - 0.6, 0.4) / max(n, 1)
            e.pop("_t", None)
            # entra um instante antes da palavra para a animacao "bater" com a fala
            e["t0"] = min(max(offsets[c.n] + t - 0.1, vis0 + 0.2), max(vis1 - 1.0, vis0 + 0.2))
            e["accent"] = accent
            e["accent2"] = ACENTOS[(i + 3) % len(ACENTOS)]
            if e["tipo"] in MULTI:  # cada item entra na sua palavra; sem ancora, 0,75 s depois do anterior
                anterior = -0.75
                for it in e["itens"]:
                    ti = _ancora(pal, it["ancora"]) if it.get("ancora") else None
                    if it.get("ancora") and ti is None:
                        print(f"AVISO: ancora '@{it['ancora']}' nao encontrada na fala da cena {c.n}.")
                    dt = max(offsets[c.n] + ti - 0.1 - e["t0"], anterior + 0.35) if ti is not None else anterior + 0.75
                    it["dt"] = round(max(dt, 0.0), 3)
                    anterior = it["dt"]
        centro.sort(key=lambda e: e["t0"])
        for k, e in enumerate(centro):
            e["t1"] = vis1 if k + 1 == len(centro) else max(centro[k + 1]["t0"] + 0.12, e["t0"] + 0.9)
            e["t1"] = min(e["t1"], vis1)
            elementos.append(e)
    return {"w": 1080, "h": 1920, "total": total, "cenas": spec_cenas, "elementos": elementos,
            "cortes": cortes}


# ---------------------------------------------------------------- renderizacao

def _chromium():
    env = os.environ.get("CHROMIUM_PATH")
    if env:
        return env
    padrao = Path("/opt/pw-browsers/chromium")
    return str(padrao) if padrao.exists() else None


def _html(spec: dict) -> str:
    return TEMPLATE.read_text(encoding="utf-8").replace(
        "/*__SPEC__*/null", json.dumps(spec, ensure_ascii=False))


def trabalhador(spec_path, pasta, k, n, fps):
    """Renderiza os quadros k, k+n, k+2n... em duas camadas: fundo (meia resolucao) e elementos."""
    from playwright.sync_api import sync_playwright

    spec = json.loads(Path(spec_path).read_text(encoding="utf-8"))
    total_quadros = int(spec["total"] * fps) + 1
    html = _html(spec)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=_chromium(), args=["--no-sandbox", "--disable-gpu"])
        pg_bg = b.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=0.5)
        pg_fg = b.new_page(viewport={"width": 1080, "height": 1920})
        for pg in (pg_bg, pg_fg):
            pg.set_content(html)
            pg.wait_for_timeout(200)
        for i in range(k, total_quadros, n):
            if i % 2 == 0:  # o fundo e lento: 15 quadros/s bastam (metade do custo)
                pg_bg.evaluate(f"seek({i / fps:.5f}, 'bg')")
                pg_bg.screenshot(path=str(Path(pasta) / f"b{i // 2:05d}.png"), omit_background=True)
            pg_fg.evaluate(f"seek({i / fps:.5f}, 'fg')")
            pg_fg.screenshot(path=str(Path(pasta) / f"f{i:05d}.png"), omit_background=True)
        b.close()


def _codificar(pasta: Path, prefixo: str, destino: Path, fps, crf):
    """PNGs com alpha -> WebM VP9 com alpha (bem menor que PNG em MOV)."""
    return subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-framerate", str(fps), "-i", str(pasta / f"{prefixo}%05d.png"),
         "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", str(crf),
         "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-auto-alt-ref", "0", str(destino)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def renderizar(spec: dict, destino: Path, fps=30, workers=None):
    """Gera destino_bg.webm e destino_fg.webm (VP9 com alpha). Cache: refaz so se spec/template mudarem.

    `destino` e o prefixo (ex.: .../motion.mov -> motion_bg.webm, motion_fg.webm).
    Retorna (bg, fg)."""
    bg_path, fg_path = destino.with_name("motion_bg.webm"), destino.with_name("motion_fg.webm")
    chave = hashlib.sha1((json.dumps(spec, sort_keys=True, ensure_ascii=False)
                          + TEMPLATE.read_text(encoding="utf-8")
                          + Path(__file__).read_text(encoding="utf-8")).encode()).hexdigest()[:16]
    marca = destino.with_suffix(".chave")
    if bg_path.exists() and fg_path.exists() and marca.exists() and marca.read_text() == chave:
        print("Motion em cache.")
        return bg_path, fg_path
    pasta = destino.parent / "quadros_motion"
    pasta.mkdir(exist_ok=True)
    for f in pasta.glob("*.png"):
        f.unlink()
    spec_path = destino.parent / "motion_spec.json"
    spec_path.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    n = workers or max(1, min(4, os.cpu_count() or 1))
    quadros = int(spec["total"] * fps) + 1
    print(f"Renderizando motion: {quadros} quadros em {n} processos (leva alguns minutos)...")
    procs = [subprocess.Popen([sys.executable, "-I", str(Path(__file__).resolve()), "--trabalhador",
                               str(spec_path), str(pasta), str(k), str(n), str(fps)],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
             for k in range(n)]
    saidas = [p.communicate()[0] for p in procs]
    if any(p.returncode for p in procs):
        sys.exit("Erro ao renderizar o motion:\n" + "\n".join(s[-1200:] for s in saidas))
    esperados = {"b": (quadros + 1) // 2, "f": quadros}
    for pref, total in esperados.items():
        faltam = [i for i in range(total) if not (pasta / f"{pref}{i:05d}.png").exists()]
        if faltam:
            sys.exit(f"Erro: {len(faltam)} quadros do motion nao foram gerados (ex.: {faltam[:3]}).")
    enc = [_codificar(pasta, "b", bg_path, fps / 2, 34), _codificar(pasta, "f", fg_path, fps, 24)]
    saidas = [e.communicate()[0] for e in enc]
    if any(e.returncode for e in enc):
        sys.exit("Erro ao empacotar o motion:\n" + "\n".join(s[-1200:] for s in saidas))
    for f in pasta.glob("*.png"):
        f.unlink()
    marca.write_text(chave)
    return bg_path, fg_path


if __name__ == "__main__":
    if len(sys.argv) >= 7 and sys.argv[1] == "--trabalhador":
        trabalhador(sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]))
    else:
        sys.exit(__doc__)
