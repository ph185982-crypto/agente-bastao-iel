#!/usr/bin/env python
"""Template "mapa": explainer com mapa de satelite, rotas tracadas, rotulos e camera guiada pela fala.

Preparacao (uma vez):  python mapa.py --preparar
  - base: NASA Blue Marble NG (jun/2004, ~500 m/pixel) recortada no Brasil, oceano escurecido com
    brilho azul na costa (Natural Earth land), em piramide de tiles (dados/base/L{n}/x_y.jpg)
  - geo: rotas de mapa_rotas.yaml roteadas pela malha do Natural Earth 10m roads, fronteiras
    estaduais/nacionais, cidades e a "malha" do gancho (dados/base/geo.json)
  - fonte: instancia estatica Montserrat Bold Italic (fontes/Montserrat-BoldItalic.ttf)

Uso pelo fazer_reels.py: planejar() monta o roteiro visual; renderizar() gera o video do mapa.
"""
import hashlib
import heapq
import json
import math
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import yaml

AQUI = Path(__file__).resolve().parent
CFG = yaml.safe_load((AQUI / "config.yaml").read_text(encoding="utf-8"))
M = CFG["mapa"]
BASE = AQUI / M["base"]
NE = AQUI / "dados" / "ne"
TEMPLATE = AQUI / "mapa_template.html"
TILE = 1024
NIVEIS = 6


def norm(p: str) -> str:
    p = unicodedata.normalize("NFKD", str(p).lower())
    return "".join(c for c in p if c.isalnum())


def lonlat_px(lon, lat):
    """Coordenadas no nivel 0 da base (pixels), projecao equiretangular da Blue Marble."""
    return (lon - M["lon0"]) * M["px_por_grau"], (M["lat0"] - lat) * M["px_por_grau"]


def _dentro(bbox, margem=0.0):
    x0, y0, x1, y1 = bbox
    return (x1 > M["lon0"] - margem and x0 < M["lon1"] + margem
            and y1 > M["lat1"] - margem and y0 < M["lat0"] + margem)


# ---------------------------------------------------------------- fonte

def preparar_fonte():
    destino = AQUI / CFG["fonte"]["arquivo"]
    if destino.exists():
        return
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    f = TTFont(AQUI / "fontes" / "Montserrat-Italic-VF.ttf")
    f = instantiateVariableFont(f, {"wght": 800})
    nomes = f["name"]
    for rec in list(nomes.names):
        if rec.nameID in (1, 16):
            rec.string = "Montserrat"
        elif rec.nameID in (2, 17):
            rec.string = "Bold Italic"
        elif rec.nameID == 4:
            rec.string = "Montserrat Bold Italic"
        elif rec.nameID == 6:
            rec.string = "Montserrat-BoldItalic"
    f["OS/2"].usWeightClass = 700
    f["OS/2"].fsSelection = (f["OS/2"].fsSelection | 0b100001) & ~0b1000000  # italic + bold
    f["head"].macStyle = 0b11
    f.save(destino)
    print(f"fonte: {destino.name}")


# ---------------------------------------------------------------- base de satelite

def preparar_base():
    from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
    import numpy as np
    import shapefile
    from scipy import ndimage

    Image.MAX_IMAGE_PIXELS = None
    marca = BASE / "L0" / "pronto"
    recorte = json.dumps([M["lon0"], M["lat0"], M["lon1"], M["lat1"], M["px_por_grau"]])
    if marca.exists() and marca.read_text() == recorte:
        return
    ppd = M["px_por_grau"]
    W = int(round((M["lon1"] - M["lon0"]) * ppd))
    H = int(round((M["lat0"] - M["lat1"]) * ppd))
    print(f"base: recortando Blue Marble {W}x{H} px...")
    # B1: lon -90..0, lat 90..0 | B2: lon -90..0, lat 0..-90 (21600 px = 90 graus)
    x0 = int((M["lon0"] + 90) * ppd)
    terra = Image.new("RGB", (W, H))
    b1 = Image.open(AQUI / "dados" / "bmng_B1.jpg")
    y_ini = int((90 - M["lat0"]) * ppd)
    parte1 = b1.crop((x0, y_ini, x0 + W, 21600))
    terra.paste(parte1, (0, 0))
    h1 = parte1.size[1]
    del b1, parte1
    b2 = Image.open(AQUI / "dados" / "bmng_B2.jpg")
    parte2 = b2.crop((x0, 0, x0 + W, min(H - h1, 21600)))
    terra.paste(parte2, (0, h1))
    del b2, parte2

    print("base: mascara de terra (Natural Earth 10m land)...")
    mask = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(mask)
    sf = shapefile.Reader(str(NE / "ne_10m_land"))
    for shp in sf.shapes():
        if not _dentro(shp.bbox, 2):
            continue
        partes = list(shp.parts) + [len(shp.points)]
        for k in range(len(partes) - 1):
            anel = shp.points[partes[k]:partes[k + 1]]
            pts = [lonlat_px(x, y) for x, y in anel]
            # shapefile: anel exterior no sentido horario (area < 0); buraco no anti-horario
            d.polygon(pts, fill=0 if shapefile.signed_area(anel) >= 0 else 255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))

    print("base: oceano escuro com brilho na costa...")
    f = 4
    pequena = np.asarray(mask.resize((W // f, H // f), Image.BILINEAR)) > 127
    dist = ndimage.distance_transform_edt(~pequena)  # distancia ate a terra (px na escala 1/4)
    km_px = 111.0 / ppd * f
    borda = np.exp(-dist * km_px / 9.0)          # aro fino e claro
    halo = np.exp(-dist * km_px / 160.0)         # azul profundo que some no preto
    r = 4 + 20 * halo + 70 * borda
    g = 8 + 45 * halo + 150 * borda
    b = 14 + 95 * halo + 230 * borda
    oceano = np.clip(np.dstack([r, g, b]), 0, 255).astype(np.uint8)
    oceano = Image.fromarray(oceano).resize((W, H), Image.BILINEAR)
    del dist, pequena

    print("base: ajuste de cor da terra...")
    terra = ImageEnhance.Color(terra).enhance(1.18)
    terra = ImageEnhance.Contrast(terra).enhance(1.10)
    base = Image.composite(terra, oceano, mask)
    del terra, oceano, mask

    print("base: piramide de tiles...")
    nivel = base
    for n in range(NIVEIS):
        pasta = BASE / f"L{n}"
        pasta.mkdir(parents=True, exist_ok=True)
        w, h = nivel.size
        for ty in range(0, h, TILE):
            for tx in range(0, w, TILE):
                nivel.crop((tx, ty, min(tx + TILE, w), min(ty + TILE, h))).save(
                    pasta / f"{tx // TILE}_{ty // TILE}.jpg", quality=90)
        (pasta / "info.json").write_text(json.dumps({"w": w, "h": h, "escala": 1 / 2 ** n}))
        nivel = nivel.resize((max(w // 2, 1), max(h // 2, 1)), Image.LANCZOS)
    for n in range(NIVEIS):
        (BASE / f"L{n}" / "pronto").write_text(recorte)


# ---------------------------------------------------------------- geometria

def _douglas(pts, tol):
    if len(pts) < 3:
        return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy) or 1e-9
    dmax, imax = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x1 * y0 - y1 * x0) / L
        if d > dmax:
            dmax, imax = d, i
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return _douglas(pts[: imax + 1], tol)[:-1] + _douglas(pts[imax:], tol)


def _chaikin(pts, n=2):
    for _ in range(n):
        novo = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            novo += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]),
                     (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        novo.append(pts[-1])
        pts = novo
    return pts


def _km(a, b):
    la = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * math.cos(la), a[1] - b[1]) * 111.2


def cidades():
    import shapefile

    sf = shapefile.Reader(str(NE / "ne_10m_populated_places_simple"))
    out = {}
    for s in sf.iterShapeRecords():
        r = s.record.as_dict()
        if r["adm0_a3"] == "BRA":
            out[r["name"]] = (r["longitude"], r["latitude"])
    return out


def preparar_geo():
    import shapefile
    from scipy.spatial import cKDTree

    destino = BASE / "geo.json"
    rotas_cfg = yaml.safe_load((AQUI / "mapa_rotas.yaml").read_text(encoding="utf-8"))["rotas"]
    chave = hashlib.sha1(json.dumps([rotas_cfg, M], sort_keys=True).encode()).hexdigest()[:12]
    if destino.exists() and json.loads(destino.read_text()).get("chave") == chave:
        return
    print("geo: grafo da malha Natural Earth...")
    sf = shapefile.Reader(str(NE / "ne_10m_roads"))
    nos, adj, malha = {}, {}, []

    def no(p):
        k = (round(p[0], 3), round(p[1], 3))
        if k not in nos:
            nos[k] = len(nos)
            adj[nos[k]] = []
        return nos[k]

    coords = {}
    for s in sf.iterShapeRecords():
        if not _dentro(s.shape.bbox, -0.3):
            continue
        tipo = s.record["type"]
        peso = 0.85 if tipo == "Major Highway" else 1.0
        partes = list(s.shape.parts) + [len(s.shape.points)]
        for k in range(len(partes) - 1):
            pts = s.shape.points[partes[k]:partes[k + 1]]
            if len(pts) < 2:
                continue
            malha.append({"tipo": tipo, "pts": [lonlat_px(*p) for p in _douglas(pts, 0.01)]})
            ids = [no(p) for p in pts]
            for a, b, pa, pb in zip(ids, ids[1:], pts, pts[1:]):
                coords[a], coords[b] = pa, pb
                w = _km(pa, pb) * peso
                adj[a].append((b, w))
                adj[b].append((a, w))
    # liga pontas soltas (lacunas da malha) com penalidade
    ids = list(coords)
    arv = cKDTree([coords[i] for i in ids])
    for i in ids:
        if len(adj[i]) <= 1:
            for j in arv.query_ball_point(coords[i], 0.08):
                j = ids[j]
                if j != i:
                    w = _km(coords[i], coords[j]) * 3 + 1
                    adj[i].append((j, w))
                    adj[j].append((i, w))

    def mais_perto(p):
        return ids[arv.query(p)[1]]

    def dijkstra(a, b):
        dist, ant, fila = {a: 0}, {}, [(0, a)]
        while fila:
            d, u = heapq.heappop(fila)
            if u == b:
                break
            if d > dist[u]:
                continue
            for v, w in adj[u]:
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v], ant[v] = nd, u
                    heapq.heappush(fila, (nd, v))
        if b not in dist:
            return None
        caminho = [b]
        while caminho[-1] != a:
            caminho.append(ant[caminho[-1]])
        return [coords[i] for i in reversed(caminho)]

    cid = cidades()
    rotas = {}
    for nome, r in rotas_cfg.items():
        pts = []
        for a, b in zip(r["passa_por"], r["passa_por"][1:]):
            trecho = dijkstra(mais_perto(cid[a]), mais_perto(cid[b]))
            if not trecho:
                sys.exit(f"geo: nao achei caminho {a} -> {b} para {nome}")
            pts += trecho if not pts else trecho[1:]
        pts = [cid[r["passa_por"][0]]] + pts + [cid[r["passa_por"][-1]]]
        pts = _chaikin(_douglas(pts, 0.012), 2)
        km = sum(_km(a, b) for a, b in zip(pts, pts[1:]))
        rotas[nome] = {"pts": [lonlat_px(*p) for p in pts], "categoria": r.get("categoria", ""),
                       "km": round(km), "passa_por": r["passa_por"]}
        print(f"geo: {nome}: {km:.0f} km por {len(pts)} pontos")

    linhas = []
    for arq, tipo in (("ne_10m_admin_1_states_provinces_lines", "estado"),
                      ("ne_10m_admin_0_boundary_lines_land", "pais")):
        for s in shapefile.Reader(str(NE / arq)).shapes():
            if not s.points or not _dentro(s.bbox):
                continue
            partes = list(s.parts) + [len(s.points)]
            for k in range(len(partes) - 1):
                pts = _douglas(s.points[partes[k]:partes[k + 1]], 0.02)
                linhas.append({"tipo": tipo, "pts": [lonlat_px(*p) for p in pts]})

    destino.write_text(json.dumps({
        "chave": chave, "rotas": rotas, "linhas": linhas, "malha": malha,
        "cidades": {n: lonlat_px(*c) for n, c in cid.items()},
    }))


def preparar():
    preparar_fonte()
    preparar_base()
    preparar_geo()


# ---------------------------------------------------------------- planejamento (roteiro -> eventos)

def _lista(v):
    return [x.strip() for x in str(v or "").split(",") if x.strip()]


def _camera(texto, geo, anterior):
    """'foco=Brasília zoom=3' -> {cx, cy, escala}. zoom 1 = Brasil inteiro na largura."""
    kv = {k: v.strip() for k, v in re.findall(r"(\w+)\s*=\s*(.*?)(?=\s+\w+\s*=|$)", texto or "")}
    foco = kv.get("foco", "").strip()
    zoom = kv.get("zoom", "1").strip()
    W = CFG["video"]["largura"]
    brasil_largura = 39.5 * M["px_por_grau"]  # ~ -74 a -34.5
    cx, cy = lonlat_px(-52.5, -14.5)
    escala = W / brasil_largura
    alvo_bbox = None
    if foco:
        chave = {norm(k): k for k in list(geo["rotas"]) + list(geo["cidades"])}
        k = chave.get(norm(foco))
        if norm(foco) == "brasil":
            pass
        elif k in geo["rotas"]:
            xs = [p[0] for p in geo["rotas"][k]["pts"]]
            ys = [p[1] for p in geo["rotas"][k]["pts"]]
            alvo_bbox = (min(xs), min(ys), max(xs), max(ys))
            cx, cy = (alvo_bbox[0] + alvo_bbox[2]) / 2, (alvo_bbox[1] + alvo_bbox[3]) / 2
        elif k in geo["cidades"]:
            cx, cy = geo["cidades"][k]
        elif re.match(r"^-?\d+(\.\d+)?,-?\d+(\.\d+)?$", foco):
            lon, lat = map(float, foco.split(","))
            cx, cy = lonlat_px(lon, lat)
        else:
            print(f"AVISO: foco '{foco}' desconhecido; usando o Brasil inteiro.")
    if zoom == "auto" and alvo_bbox:
        H = CFG["video"]["altura"]
        bw, bh = alvo_bbox[2] - alvo_bbox[0], alvo_bbox[3] - alvo_bbox[1]
        escala = min(W * 0.72 / max(bw, 1), (H - 900) / max(bh, 1))
    elif zoom != "auto":
        escala *= float(zoom)
    return {"cx": cx, "cy": cy, "escala": escala}


def planejar(cenas, palavras, offsets, starts, durs, total):
    geo = json.loads((BASE / "geo.json").read_text())
    tc = M["transicao_camera"]
    cams, eventos, cortes = [], [], []
    ant = None
    nomes_rotas = {norm(k): k for k in geo["rotas"]}
    nomes_cid = {norm(k): k for k in geo["cidades"]}
    for i, c in enumerate(cenas):
        ex = c.extras
        pal = palavras[c.n]
        fala_ini = offsets[c.n]

        def ancora(ident):
            for idx, aid in c.ancoras:
                if norm(aid) == norm(ident) and idx < len(pal):
                    return fala_ini + pal[idx][1][0]
            return None

        cam = _camera(ex.get("camera", ""), geo, ant)
        t_cam = starts[i] if i > 0 else 0.0
        cams.append({"t": t_cam, "dur": tc if i > 0 else 0.01, **cam})
        if i > 0:
            cortes.append(t_cam)
        ant = cam
        seq = 0
        for tipo, campo in (("rota", "mostrar"), ("foco", "destacar")):
            for ident in _lista(ex.get(campo)):
                t = ancora(ident)
                if t is None:
                    t = fala_ini + 0.25 + 0.55 * seq
                seq += 1
                if norm(ident) in nomes_rotas:
                    k = nomes_rotas[norm(ident)]
                    eventos.append({"tipo": tipo, "id": k, "t": t, "dur": min(2.2, 0.6 + geo["rotas"][k]["km"] / 900),
                                    "ancorado": ancora(ident) is not None})
                elif norm(ident) in nomes_cid:
                    k = nomes_cid[norm(ident)]
                    eventos.append({"tipo": "cidade", "id": k, "t": t, "foco": tipo == "foco",
                                    "ancorado": ancora(ident) is not None})
                else:
                    print(f"AVISO: '{ident}' nao e rota (mapa_rotas.yaml) nem cidade conhecida.")
        if str(ex.get("previa", "")).lower() in ("sim", "true", "1"):
            t = ancora("previa") or fala_ini
            eventos.append({"tipo": "previa", "t": t, "dur": 2.4, "ancorado": ancora("previa") is not None})
        tl = ancora("limpar")
        if tl is not None or str(ex.get("limpar", "")).lower() in ("sim", "true", "1"):
            eventos.append({"tipo": "limpar", "t": tl if tl is not None else starts[i], "ancorado": tl is not None})
    return {"w": CFG["video"]["largura"], "h": CFG["video"]["altura"], "fps": CFG["video"]["fps"],
            "total": total, "cameras": cams, "eventos": sorted(eventos, key=lambda e: e["t"]),
            "cortes": cortes, "cfg": CFG}


# ---------------------------------------------------------------- render

def _chromium():
    env = os.environ.get("CHROMIUM_PATH")
    if env:
        return env
    padrao = Path("/opt/pw-browsers/chromium")
    return str(padrao) if padrao.exists() else None


def _html(spec, trabalho: Path) -> Path:
    info = {n: json.loads((BASE / f"L{n}" / "info.json").read_text()) for n in range(NIVEIS)}
    dados = {"spec": spec, "niveis": info, "tile": TILE,
             "base": (BASE).as_uri(), "fonte": (AQUI / CFG["fonte"]["arquivo"]).as_uri()}
    html = TEMPLATE.read_text(encoding="utf-8").replace("/*__DADOS__*/null", json.dumps(dados))
    html = html.replace("/*__GEO__*/null", (BASE / "geo.json").read_text())
    p = trabalho / "mapa.html"
    p.write_text(html, encoding="utf-8")
    return p


def trabalhador(html, pasta, k, n, fps, total):
    from playwright.sync_api import sync_playwright

    quadros = int(total * fps) + 1
    log = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=_chromium(),
                              args=["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"])
        pg = b.new_page(viewport={"width": CFG["video"]["largura"], "height": CFG["video"]["altura"]})
        pg.goto(Path(html).as_uri())
        pg.wait_for_function("window.pronto === true", timeout=120000)
        for i in range(k, quadros, n):
            info = pg.evaluate(f"seek({i / fps:.5f})")
            pg.screenshot(path=str(Path(pasta) / f"m{i:05d}.jpg"), type="jpeg", quality=93)
            log.append({"q": i, **info})
        b.close()
    (Path(pasta) / f"log_{k}.json").write_text(json.dumps(log))


def renderizar(spec, trabalho: Path, workers=None):
    """Gera trabalho/mapa.mp4 (sem audio) e trabalho/mapa_log.json (rotulos por quadro, para o QA)."""
    destino = trabalho / "mapa.mp4"
    chave = hashlib.sha1((json.dumps(spec, sort_keys=True) + TEMPLATE.read_text(encoding="utf-8")
                          + Path(__file__).read_text(encoding="utf-8")
                          + (BASE / "geo.json").read_text()).encode()).hexdigest()[:16]
    marca = trabalho / "mapa.chave"
    if destino.exists() and marca.exists() and marca.read_text() == chave:
        print("Mapa em cache.")
        return destino
    pasta = trabalho / "quadros_mapa"
    pasta.mkdir(exist_ok=True)
    for f in list(pasta.glob("m*.jpg")) + list(pasta.glob("log_*.json")):
        f.unlink()
    html = _html(spec, trabalho)
    fps, total = spec["fps"], spec["total"]
    n = workers or max(1, min(4, os.cpu_count() or 1))
    quadros = int(total * fps) + 1
    print(f"Renderizando mapa: {quadros} quadros em {n} processos...")
    procs = [subprocess.Popen([sys.executable, "-I", str(Path(__file__).resolve()), "--trabalhador",
                               str(html), str(pasta), str(k), str(n), str(fps), f"{total:.4f}"],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
             for k in range(n)]
    saidas = [p.communicate()[0] for p in procs]
    if any(p.returncode for p in procs):
        sys.exit("Erro ao renderizar o mapa:\n" + "\n".join(s[-1500:] for s in saidas))
    faltam = [i for i in range(quadros) if not (pasta / f"m{i:05d}.jpg").exists()]
    if faltam:
        sys.exit(f"Erro: {len(faltam)} quadros do mapa nao foram gerados (ex.: {faltam[:3]}).")
    log = []
    for f in sorted(pasta.glob("log_*.json")):
        log += json.loads(f.read_text())
    (trabalho / "mapa_log.json").write_text(json.dumps(sorted(log, key=lambda r: r["q"])))
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", str(fps), "-i", str(pasta / "m%05d.jpg"),
                        "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", str(destino)],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit("Erro ao codificar o mapa:\n" + r.stderr[-1500:])
    for f in pasta.glob("m*.jpg"):
        f.unlink()
    marca.write_text(chave)
    return destino


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--preparar":
        preparar()
    elif len(sys.argv) >= 8 and sys.argv[1] == "--trabalhador":
        trabalhador(sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]),
                    float(sys.argv[7]))
    else:
        sys.exit(__doc__)
