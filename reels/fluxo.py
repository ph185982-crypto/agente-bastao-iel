#!/usr/bin/env python
"""Template "fluxo" ("A Conta"): grade de quadrados = o preco da venda; cada custo arranca seus
quadrados, o contador de saldo desce, o desconto encolhe a grade e o controle deslizante mostra o
ponto de equilibrio.

TODO valor e calculado aqui (Decimal) a partir de `entradas` e `cenario` do roteiro. O roteiro e
conferido contra o calculo: se divergir, o programa para e avisa (nunca ajusta a fala).
"""
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import unicodedata
from decimal import ROUND_FLOOR, Decimal as D
from pathlib import Path

import yaml

AQUI = Path(__file__).resolve().parent
CFG = yaml.safe_load((AQUI / "config.yaml").read_text(encoding="utf-8"))
F = CFG["fluxo"]
TEMPLATE = AQUI / "fluxo_template.html"
AVISO = "EXEMPLO ILUSTRATIVO"  # obrigatorio; nao existe parametro para remover


def norm(p: str) -> str:
    p = unicodedata.normalize("NFKD", str(p).lower())
    return "".join(c for c in p if c.isalnum())


# ---------------------------------------------------------------- numeros

def _kv(txt):
    return {k.strip(): v.strip() for k, v in (p.split("=", 1) for p in str(txt or "").split(";") if "=" in p)}


def calcular(meta):
    e = _kv(meta.get("entradas"))
    if "preco" not in e:
        sys.exit("Erro: 'entradas' precisa de preco=... no cabecalho do roteiro.")
    preco = D(e.pop("preco"))
    custos = []
    for k, v in e.items():
        if v.endswith("%"):
            custos.append({"id": k, "pct": D(v[:-1]) / 100, "fixo": None})
        else:
            custos.append({"id": k, "pct": None, "fixo": D(v)})

    def valores(p):
        return {x["id"]: (x["pct"] * p if x["pct"] is not None else x["fixo"]) for x in custos}

    def sobra(p):
        return p - sum(valores(p).values())

    c = _kv(meta.get("cenario"))
    d = D(c.get("desconto", "0%").rstrip("%")) / 100
    p2 = preco * (1 - d)
    soma_pct = sum((x["pct"] for x in custos if x["pct"] is not None), D(0))
    fixos = sum((x["fixo"] for x in custos if x["fixo"] is not None), D(0))
    lim = 1 - fixos / (preco * (1 - soma_pct))
    lim_baixo = (lim * 1000).to_integral_value(ROUND_FLOOR) / 1000  # 1 casa decimal em %, para BAIXO
    return {
        "preco": preco, "custos": custos, "valores1": valores(preco), "sobra1": sobra(preco),
        "desconto": d, "preco2": p2, "valores2": valores(p2), "sobra2": sobra(p2),
        "pct_antes": preco * soma_pct, "pct_depois": p2 * soma_pct, "soma_pct": soma_pct, "fixos": fixos,
        "limite": lim, "limite_baixo": lim_baixo,
        "sobra_no_limite": sobra(preco * (1 - lim_baixo)),
        "sobra_acima": sobra(preco * (1 - lim_baixo - D("0.001"))),
        "sobra_fn": sobra,
    }


def brl(v, sinal=False):
    v = D(v)
    neg = v < 0
    v = abs(v)
    txt = f"{v:.2f}".replace(".", ",") if v != v.to_integral_value() else f"{int(v)}"
    txt = re.sub(r"(\d)(?=(\d{3})+(?!\d))", r"\1.", txt.split(",")[0]) + ("," + txt.split(",")[1] if "," in txt else "")
    return ("-" if neg else "") + "R$ " + txt


def pct(f):
    v = D(f) * 100
    return (f"{v.normalize():f}".replace(".", ",")) + "%"


def testar(calc, meta):
    """Testes da secao 4. Retorna [(nome, ok, detalhe)]."""
    t = []
    t.append(("sobra no limite (arredondado para baixo) e positiva", calc["sobra_no_limite"] > 0,
              f"{pct(calc['limite_baixo'])}: {brl(calc['sobra_no_limite'].quantize(D('0.001')))}"))
    t.append(("0,1 ponto acima do limite ja da prejuizo", calc["sobra_acima"] < 0,
              f"{pct(calc['limite_baixo'] + D('0.001'))}: {brl(calc['sobra_acima'].quantize(D('0.001')))}"))
    t.append(("limite arredondado nao passa do exato", calc["limite_baixo"] <= calc["limite"],
              f"exato {calc['limite'] * 100:.2f}% -> {pct(calc['limite_baixo'])}"))
    exemplo = _kv(meta.get("entradas")) == _kv("preco=100; produto=45; comissao=20%; frete=10; imposto=6%; anuncio=8") \
        and _kv(meta.get("cenario")) == _kv("desconto=25%")
    if exemplo:  # resultados esperados do briefing para este exemplo
        v2 = calc["valores2"]
        for nome, real, esperado in [
            ("sobra normal", calc["sobra1"], D(11)), ("preco com 25%", calc["preco2"], D(75)),
            ("comissao com 25%", v2["comissao"], D(15)), ("imposto com 25%", v2["imposto"], D("4.5")),
            ("sobra com 25%", calc["sobra2"], D("-7.5")), ("custos % antes", calc["pct_antes"], D(26)),
            ("custos % depois", calc["pct_depois"], D("19.5")),
            ("queda dos custos %", calc["pct_antes"] - calc["pct_depois"], D("6.5")),
            ("perda de sobra", calc["sobra1"] - calc["sobra2"], D("18.5")),
            ("desconto maximo", calc["limite_baixo"], D("0.148")),
        ]:
            t.append((f"{nome} = {esperado}", real == esperado, f"calculado {real.normalize()}"))
    return t


def _falado(v):
    """Formas faladas aceitas para um valor em reais (ex.: 6,50 -> 'seis e cinquenta' ou 'seis reais e cinquenta')."""
    from num2words import num2words

    v = abs(D(v))
    inteiro = int(v)
    cent = int((v - inteiro) * 100)
    base = num2words(inteiro, lang="pt_BR").replace(",", "")
    alts = {base, base.replace("catorze", "quatorze"), base.replace("quatorze", "catorze")}
    if cent:
        c = num2words(cent, lang="pt_BR")
        return {f"{a} e {c}" for a in alts} | {f"{a} reais e {c}" for a in alts}
    return alts


def _pct_falado(f):
    from num2words import num2words

    v = D(f) * 100
    inteiro = int(v)
    dec = (v - inteiro).normalize()
    base = num2words(inteiro, lang="pt_BR")
    alts = {base, base.replace("catorze", "quatorze"), base.replace("quatorze", "catorze")}
    if dec:
        dig = " ".join(num2words(int(x), lang="pt_BR") for x in str(dec).split(".")[1])
        alts = {f"{a} vírgula {dig}" for a in alts}
    return {f"{a} por cento" for a in alts}


def conferir_roteiro(cenas, calc):
    """Confere os numeros escritos na tela e falados contra o calculo. Lista de divergencias."""
    probs = []
    esperado_tela, esperado_fala = {}, {}
    p, v1, v2 = calc["preco"], calc["valores1"], calc["valores2"]
    esperado_tela["preco"] = [brl(p)]
    esperado_fala["preco"] = [_falado(p)]
    for x in calc["custos"]:
        k = x["id"]
        esperado_tela[k] = [brl(v1[k])] + ([pct(x["pct"])] if x["pct"] is not None else [])
        esperado_fala[k] = [_falado(v1[k])]
    esperado_tela["sobra"] = [brl(calc["sobra1"])]
    esperado_fala["sobra"] = [_falado(calc["sobra1"]), _pct_falado(calc["sobra1"] / p)]
    esperado_tela["desconto"] = ["-" + pct(calc["desconto"])]
    esperado_fala["desconto"] = [_pct_falado(calc["desconto"])]
    queda = calc["pct_antes"] - calc["pct_depois"]
    esperado_tela["prejuizo"] = ["-" + brl(p - calc["preco2"]), "-" + brl(queda), brl(calc["sobra2"])]
    esperado_fala["prejuizo"] = [_falado(p - calc["preco2"]), _falado(queda), _falado(calc["sobra2"])]
    esperado_tela["limite"] = [pct(calc["limite_baixo"])]
    esperado_fala["limite"] = [_pct_falado(calc["limite_baixo"])]
    for c in cenas:
        ids = [a for _, a in c.ancoras]
        tela = c.tela.replace("−", "-")
        fala = c.fala.lower()
        for k in ids:
            for s in esperado_tela.get(k, []):
                if s not in tela:
                    probs.append(f"Cena {c.n} ({k}): texto-na-tela '{c.tela}' nao traz '{s}' (calculado).")
            for alts in esperado_fala.get(k, []):
                if not any(a in fala for a in alts):
                    probs.append(f"Cena {c.n} ({k}): a fala nao diz '{sorted(alts)[0]}' (calculado).")
    return probs


# ---------------------------------------------------------------- plano da animacao

def planejar(cenas, palavras, offsets, starts, durs, total, calc, meta):
    rnd = random.Random(7)
    G = F["grade"]
    passo = G["celula"] + G["espaco"]

    def slot_xy(i):
        return G["x0"] + (i % G["colunas"]) * passo, G["y0"] + (i // G["colunas"]) * passo

    ancoras = {}
    cena_de = {}
    for c in cenas:
        pal = palavras[c.n]
        for idx, aid in c.ancoras:
            if idx < len(pal):
                ancoras[aid] = offsets[c.n] + pal[idx][1][0]
                cena_de[aid] = c

    def palavra_em(c, texto, depois=0.0):
        pal = palavras[c.n]
        for w, (s, _e) in pal:
            if norm(w).startswith(norm(texto)) and offsets[c.n] + s >= depois:
                return offsets[c.n] + s
        return None

    falta = [k for k in ["preco", "sobra", "desconto", "prejuizo", "limite"] + [x["id"] for x in calc["custos"]]
             if k not in ancoras]
    if falta:
        sys.exit(f"Erro: faltam ancoras no roteiro: {', '.join(falta)}")

    idx_cena = {c.n: i for i, c in enumerate(cenas)}
    ini_cena = {c.n: starts[i] for i, c in enumerate(cenas)}
    fim_cena = {c.n: starts[i] + durs[i] for i, c in enumerate(cenas)}

    custos = [x["id"] for x in calc["custos"]]
    cores = {k: F["cores"].get(k, "#FFFFFF") for k in custos}
    nomes = {k: F["nomes"].get(k, k.capitalize()) for k in custos}
    chips = []
    for j, k in enumerate(custos):
        x = calc["custos"][j]
        chips.append({"id": k, "nome": nomes[k], "cor": cores[k], "y": G["y0"] + j * (F["chip"]["altura"] + F["chip"]["espaco"]),
                      "v1": float(calc["valores1"][k]), "v2": float(calc["valores2"][k]),
                      "pct": None if x["pct"] is None else float(x["pct"] * 100),
                      "t_entra": ancoras[k]})

    # ---- fase 1: grade com `preco` unidades; cada custo consome do fim para o comeco
    def consumir(fill, ordem, tempos, fase, cor_de):
        pecas, i, falta_total = [], len(fill) - 1, D(0)
        for k, (t_ini, t_fim) in zip(ordem, tempos):
            resta = D(str(ordem[k]))
            lista = []
            while resta > 0 and i >= 0:
                if fill[i] <= 0:
                    i -= 1
                    continue
                tira = min(fill[i], resta)
                lista.append({"slot": i, "a": float(fill[i] - tira), "b": float(fill[i]), "custo": k,
                              "u": float(tira), "fase": fase})
                fill[i] -= tira
                resta -= tira
                if fill[i] <= 0:
                    i -= 1
            n = len(lista)
            for m, pc in enumerate(lista):
                frac = m / max(n - 1, 1)
                pc["t0"] = round(t_ini + (t_fim - t_ini) * frac + rnd.uniform(-0.03, 0.03), 4)
                pc["t1"] = round(pc["t0"] + 0.5 + rnd.uniform(0, 0.15), 4)
                pc["curva"] = round(rnd.uniform(-160, 160), 1)
                pecas.append(pc)
            falta_total += resta
        return pecas, fill, falta_total

    n1 = int(calc["preco"].to_integral_value(rounding="ROUND_CEILING"))
    fill1 = [D(1)] * n1
    if calc["preco"] != n1:
        fill1[-1] = calc["preco"] - (n1 - 1)
    ordem1 = {k: calc["valores1"][k] for k in custos}
    tempos1 = []
    for k in custos:
        t = ancoras[k]
        n = float(calc["valores1"][k])
        tempos1.append((t, t + min(1.0, 0.25 + 0.018 * n)))
    pecas1, fill_rest1, _ = consumir(fill1, ordem1, tempos1, 1, cores)

    # ---- fase 2: desconto; grade com preco2 unidades
    c9 = cena_de["prejuizo"]
    t_reset = ancoras["desconto"] + 0.55
    t_caem = palavra_em(c9, "caem") or (ini_cena[c9.n] + 1.5)
    t_igual = {k: palavra_em(c9, nomes[k], depois=t_caem) for k in custos}
    t_come = palavra_em(c9, "continuam") or (t_caem + 2.0)
    t_prej = ancoras["prejuizo"]
    n2 = int(calc["preco2"].to_integral_value(rounding="ROUND_CEILING"))
    fill2 = [D(1)] * n2
    if calc["preco2"] != n2:
        fill2[-1] = calc["preco2"] - (n2 - 1)
    ordem2 = {k: calc["valores2"][k] for k in custos}
    t_come = ini_cena[c9.n] + 0.45          # os custos comem a venda menor enquanto a voz explica
    janela = max(1.2, t_prej - 0.3 - t_come)
    tot2 = float(sum(calc["valores2"].values()))
    tempos2, acc = [], t_come
    for k in custos:
        dur = janela * float(calc["valores2"][k]) / tot2
        tempos2.append((acc, acc + dur * 0.85))
        acc += dur
    pecas2, fill_rest2, deficit = consumir(fill2, ordem2, tempos2, 2, cores)
    for ch in chips:  # quanto de cada custo a venda menor NAO cobre (calculado, nao por tempo)
        pago = sum(D(str(p["u"])) for p in pecas2 if p["custo"] == ch["id"])
        ch["falta2"] = float(calc["valores2"][ch["id"]] - pago)
    # o que falta vira quadrados vermelhos (o "buraco"), um por unidade, o ultimo parcial
    vermelhos, u, j = [], D(deficit), 0
    while u > 0:
        tam = min(D(1), u)
        vermelhos.append({"slot": n2 + j, "u": float(tam), "t": round(t_prej + 0.05 + 0.07 * j, 4)})
        u -= tam
        j += 1

    # ---- cena 10: controle deslizante
    c10 = cena_de["limite"]
    t_lim = ancoras["limite"]
    t_slider0 = ini_cena[c10.n] + 0.35
    t_passou = palavra_em(c10, "passou") or (t_lim + 1.2)
    # ---- cena final
    c_fim = cenas[-1]
    t_fecho = ini_cena[c_fim.n] + 0.15
    t_sub = palavra_em(c_fim, "desconto") or (t_fecho + 1.2)

    telas = []
    for i, c in enumerate(cenas):
        if c is c_fim:
            continue
        telas.append({"txt": c.tela, "t0": starts[i] + (0.15 if i else 0.05),
                      "t1": starts[i] + durs[i] - (0.2 if i < len(cenas) - 1 else 0)})

    eventos = [{"id": k, "t": round(t, 4), "ancorado": True} for k, t in ancoras.items()]
    sons = [{"tipo": "sweep", "t": 0.05}, {"tipo": "pulso", "t": ancoras["preco"]},
            {"tipo": "sobe", "t": ancoras["sobra"]}, {"tipo": "baque", "t": ancoras["desconto"] + 0.12},
            {"tipo": "desce", "t": t_prej}, {"tipo": "ping", "t": t_lim}]
    for grupo in (pecas1, pecas2):
        for m, pc in enumerate(sorted(grupo, key=lambda p: p["t0"])):
            if m % 4 == 0:
                sons.append({"tipo": "tique", "t": pc["t0"]})
    lim_pct = float(calc["limite_baixo"] * 100)
    for q in range(1, 26):  # tique a cada ponto percentual do controle
        if q < lim_pct:
            t = t_slider0 + (t_lim - t_slider0) * _inv_ease(q / lim_pct)
        else:
            t = t_lim + 1.4 * _inv_ease((q - lim_pct) / (25 - lim_pct))
        sons.append({"tipo": "tique_leve", "t": round(t, 4)})

    ativos = ([(0.05, 0.9), (ancoras["preco"], ancoras["preco"] + 0.4), (ancoras["sobra"], ancoras["sobra"] + 1.2),
               (ancoras["desconto"], t_reset + 0.7), (t_caem, t_caem + 0.8), (t_prej, t_prej + 0.9),
               (t_slider0, t_lim + 1.4), (t_passou, t_passou + 0.5), (t_fecho, t_fecho + 0.8), (t_sub, t_sub + 0.6)]
              + [(t, t + 0.5) for t in t_igual.values() if t] + [(c["t_entra"], c["t_entra"] + 0.45) for c in chips]
              + [(p["t0"], p["t1"]) for p in pecas1 + pecas2] + [(tl["t0"], tl["t0"] + 0.4) for tl in telas])

    return {
        "w": CFG["video"]["largura"], "h": CFG["video"]["altura"], "fps": CFG["video"]["fps"], "total": total,
        "cfg": CFG, "aviso": AVISO, "grade": G, "n1": n1, "n2": n2,
        "fill1_final": [float(x) for x in fill_rest1], "pecas1": pecas1, "pecas2": pecas2, "vermelhos": vermelhos,
        "chips": chips, "telas": telas, "eventos": eventos, "sons": sons, "ativos": ativos,
        "t": {"preco": ancoras["preco"], "sobra": ancoras["sobra"], "desconto": ancoras["desconto"], "reset": t_reset,
              "caem": t_caem, "igual": t_igual, "come": t_come, "prejuizo": t_prej, "slider0": t_slider0,
              "limite": t_lim, "passou": t_passou, "fecho": t_fecho, "sub": t_sub,
              "cena9": ini_cena[c9.n], "cena10": ini_cena[c10.n], "cena7_fim": t_reset},
        "num": {"preco": float(calc["preco"]), "preco2": float(calc["preco2"]), "sobra1": float(calc["sobra1"]),
                "sobra2": float(calc["sobra2"]), "desconto": float(calc["desconto"]), "soma_pct": float(calc["soma_pct"]),
                "fixos": float(calc["fixos"]), "limite_baixo": float(calc["limite_baixo"]), "deficit": float(deficit)},
        "fecho": cenas[-1].tela or "Faça a conta antes.",
    }


def _inv_ease(y):
    """Inverso de out3 (1-(1-x)^3): em que fracao do tempo o controle chega a y."""
    y = min(max(y, 0.0), 1.0)
    return 1 - (1 - y) ** (1 / 3)


# ---------------------------------------------------------------- sons sintetizados

def gerar_sons(sons, total, destino: Path, sr=44100):
    import numpy as np
    import soundfile as sf
    from scipy.signal import butter, sosfilt

    rng = np.random.default_rng(3)
    faixa = np.zeros(int((total + 1) * sr), dtype=np.float64)
    db = F["som_db"]

    def env(n, ataque=0.01, solta=None):
        t = np.arange(n) / sr
        a = np.clip(t / ataque, 0, 1)
        r = np.exp(-t / (solta or (n / sr / 4)))
        return a * r

    def tom(f0, f1, dur, forma="sen"):
        n = int(dur * sr)
        f = np.linspace(f0, f1, n)
        fase = 2 * np.pi * np.cumsum(f) / sr
        return np.sin(fase) + 0.25 * np.sin(2 * fase)

    for s in sons:
        tipo = s["tipo"]
        if tipo == "sweep":
            n = int(0.9 * sr)
            ruido = sosfilt(butter(2, [400, 6000], "bandpass", fs=sr, output="sos"), rng.standard_normal(n))
            w = ruido * np.linspace(0, 1, n) ** 2 * np.hanning(n * 2)[n:] ** 0.3 + 0.4 * tom(220, 880, 0.9) * np.linspace(0, 1, n) ** 3
            nivel = db
        elif tipo == "pulso":
            w = tom(70, 48, 0.45) * env(int(0.45 * sr), 0.005, 0.12)
            nivel = db + 2
        elif tipo in ("tique", "tique_leve"):
            n = int(0.05 * sr)
            w = sosfilt(butter(2, [2500, 7000], "bandpass", fs=sr, output="sos"), rng.standard_normal(n)) * env(n, 0.001, 0.008)
            nivel = db - (4 if tipo == "tique" else 8)
        elif tipo == "sobe":
            w = tom(523, 1046, 0.45) * env(int(0.45 * sr), 0.01, 0.25)
            nivel = db - 2
        elif tipo == "desce":
            w = tom(440, 196, 0.6) * env(int(0.6 * sr), 0.01, 0.35)
            nivel = db - 2
        elif tipo == "baque":
            n = int(0.5 * sr)
            w = tom(60, 38, 0.5) * env(n, 0.002, 0.14) + 0.5 * sosfilt(butter(2, 300, "lowpass", fs=sr, output="sos"), rng.standard_normal(n)) * env(n, 0.001, 0.04)
            nivel = db + 3
        elif tipo == "ping":
            w = tom(1318, 1318, 0.5) * env(int(0.5 * sr), 0.002, 0.15)
            nivel = db - 1
        else:
            continue
        w = w / (np.sqrt(np.mean(w ** 2)) + 1e-9) * 10 ** (nivel / 20)
        i0 = max(int(s["t"] * sr), 0)
        faixa[i0:i0 + len(w)] += w[: len(faixa) - i0]
    pico = np.max(np.abs(faixa)) if len(faixa) else 0
    if pico > 0.7:
        faixa *= 0.7 / pico
    sf.write(destino, faixa[: int(total * sr)].astype(np.float32), sr)


# ---------------------------------------------------------------- render (Chromium, quadro a quadro)

def _chromium():
    env = os.environ.get("CHROMIUM_PATH")
    if env:
        return env
    padrao = Path("/opt/pw-browsers/chromium")
    return str(padrao) if padrao.exists() else None


def _html(spec, trabalho: Path) -> Path:
    dados = {"spec": spec,
             "fonte_it": (AQUI / CFG["fonte"]["arquivo"]).as_uri(),
             "fonte": (AQUI / F["fonte_texto"]).as_uri()}
    html = TEMPLATE.read_text(encoding="utf-8").replace("/*__DADOS__*/null", json.dumps(dados))
    p = trabalho / "fluxo.html"
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
            pg.screenshot(path=str(Path(pasta) / f"f{i:05d}.jpg"), type="jpeg", quality=94)
            log.append({"q": i, **info})
        b.close()
    (Path(pasta) / f"log_{k}.json").write_text(json.dumps(log))


def renderizar(spec, trabalho: Path, workers=None):
    destino = trabalho / "fluxo.mp4"
    chave = hashlib.sha1((json.dumps(spec, sort_keys=True) + TEMPLATE.read_text(encoding="utf-8")
                          + Path(__file__).read_text(encoding="utf-8")).encode()).hexdigest()[:16]
    marca = trabalho / "fluxo.chave"
    if destino.exists() and marca.exists() and marca.read_text() == chave:
        print("Animacao em cache.")
        return destino
    pasta = trabalho / "quadros_fluxo"
    pasta.mkdir(exist_ok=True)
    for f in list(pasta.glob("f*.jpg")) + list(pasta.glob("log_*.json")):
        f.unlink()
    html = _html(spec, trabalho)
    fps, total = spec["fps"], spec["total"]
    n = workers or max(1, min(4, os.cpu_count() or 1))
    quadros = int(total * fps) + 1
    print(f"Renderizando animacao: {quadros} quadros em {n} processos...")
    procs = [subprocess.Popen([sys.executable, "-I", str(Path(__file__).resolve()), "--trabalhador",
                               str(html), str(pasta), str(k), str(n), str(fps), f"{total:.4f}"],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
             for k in range(n)]
    saidas = [p.communicate()[0] for p in procs]
    if any(p.returncode for p in procs):
        sys.exit("Erro ao renderizar:\n" + "\n".join(s[-1500:] for s in saidas))
    faltam = [i for i in range(quadros) if not (pasta / f"f{i:05d}.jpg").exists()]
    if faltam:
        sys.exit(f"Erro: {len(faltam)} quadros nao foram gerados (ex.: {faltam[:3]}).")
    log = []
    for f in sorted(pasta.glob("log_*.json")):
        log += json.loads(f.read_text())
    (trabalho / "fluxo_log.json").write_text(json.dumps(sorted(log, key=lambda r: r["q"])))
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", str(fps), "-i", str(pasta / "f%05d.jpg"),
                        "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", str(destino)],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit("Erro ao codificar:\n" + r.stderr[-1500:])
    for f in pasta.glob("f*.jpg"):
        f.unlink()
    marca.write_text(chave)
    return destino


if __name__ == "__main__":
    if len(sys.argv) >= 8 and sys.argv[1] == "--trabalhador":
        trabalhador(sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]),
                    float(sys.argv[7]))
    else:
        sys.exit(__doc__)
