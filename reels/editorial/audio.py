#!/usr/bin/env python
"""AudioTrack do template editorial: trilha instrumental e efeitos SINTETIZADOS (sem direitos autorais),
narracao posicionada por cena, ducking da trilha na fala e normalizacao final para Instagram.

Gera em <trabalho>/audio/: musica.wav, efeitos.wav, narracao.wav (faixa preparada, pode ser trocada)
e mix.wav (final, -14 LUFS, pico -1.5 dBTP).
"""
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

SR = 44100
RNG = np.random.default_rng(23)


def _bp(x, lo, hi, ordem=2):
    return sosfilt(butter(ordem, [lo, hi], "bandpass", fs=SR, output="sos"), x)


def _lp(x, f, ordem=2):
    return sosfilt(butter(ordem, f, "lowpass", fs=SR, output="sos"), x)


def _hp(x, f, ordem=2):
    return sosfilt(butter(ordem, f, "highpass", fs=SR, output="sos"), x)


def _env(n, a, r):
    t = np.arange(n) / SR
    return np.clip(t / max(a, 1e-4), 0, 1) * np.exp(-t / r)


def _saw(f, n, fase=0.0):
    t = np.arange(n) / SR
    return 2 * ((t * f + fase) % 1) - 1


def _por(destino, sinal, t, ganho=1.0):
    i = int(t * SR)
    if i >= len(destino) or i + len(sinal) <= 0:
        return
    a = max(0, -i)
    s = sinal[a:]
    i = max(i, 0)
    n = min(len(s), len(destino) - i)
    destino[i:i + n] += s[:n] * ganho


# ---------------------------------------------------------------- trilha
def trilha(total, cenas, bpm=120, intensidades=None, pausas=()):
    n = int(total * SR)
    out = np.zeros(n)
    beat = 60 / bpm
    intens = np.zeros(n)
    for k, c in enumerate(cenas):   # curva de intensidade por cena (suavizada)
        v = (intensidades or [0.8] * len(cenas))[k]
        intens[int(c["inicio"] * SR):int(c["fim"] * SR)] = v
    for p0, p1 in pausas:            # pausa dramatica: trilha quase some
        intens[int(p0 * SR):int(p1 * SR)] = 0.05
    intens = _lp(intens, 2.0, 1)
    intens = np.clip(intens, 0, 1)
    # drone: D2 + A2 serrilhados, filtrados, com respiracao
    t = np.arange(n) / SR
    drone = 0.5 * _saw(73.42, n) + 0.5 * _saw(73.9, n, .3) + 0.35 * _saw(110.0, n, .1)
    drone = _lp(drone, 420) * (0.55 + 0.45 * intens) * (0.85 + 0.15 * np.sin(t * 2 * np.pi / 8))
    out += 0.16 * drone
    # pulso de baixo em colcheias (sobe com a intensidade)
    nota = np.array([36.71, 36.71, 43.65, 41.2])  # D1 D1 F1 E1 por compasso
    passos = int(total / (beat / 2))
    for k in range(passos):
        tt = k * beat / 2
        comp = int(tt / (beat * 4)) % 4
        f = nota[comp] * 2
        m = int(0.22 * SR)
        s = _lp(_saw(f, m), 300) * _env(m, .005, .09)
        _por(out, s, tt, 0.22 * intens[min(int(tt * SR), n - 1)] ** 1.2)
    # bateria: bumbo 1 e 3, palma 2 e 4, chimbal em colcheias (some quando a intensidade cai)
    for k in range(int(total / beat)):
        tt = k * beat
        i = min(int(tt * SR), n - 1)
        v = intens[i]
        if v < 0.4:
            continue
        m = int(.35 * SR)
        if k % 2 == 0:
            f = np.linspace(110, 42, m)
            kick = np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(m, .002, .12)
            _por(out, kick, tt, 0.55 * v)
        else:
            m2 = int(.2 * SR)
            clap = _bp(RNG.standard_normal(m2), 900, 3500) * _env(m2, .002, .05)
            _por(out, clap, tt, 0.22 * v)
        for h in (0, beat / 2):
            m3 = int(.05 * SR)
            hat = _hp(RNG.standard_normal(m3), 6500) * _env(m3, .001, .012)
            _por(out, hat, tt + h, 0.09 * v)
    # risers antes das viradas (subida de tensao)
    for c in cenas:
        if c.get("riser"):
            m = int(1.4 * SR)
            r = _bp(RNG.standard_normal(m), 600, 7000) * np.linspace(0, 1, m) ** 2.5
            _por(out, r, c["inicio"] - 1.4, 0.12)
    # fim: tudo diminui junto
    fade = np.ones(n)
    m = int(1.6 * SR)
    fade[-m:] = np.linspace(1, 0, m) ** 1.5
    return out * fade


# ---------------------------------------------------------------- efeitos
def efeito(tipo, dur=None):
    if tipo == "impacto":
        m = int(.9 * SR)
        f = np.linspace(90, 30, m)
        boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(m, .002, .25)
        crack = _bp(RNG.standard_normal(m), 1500, 8000) * _env(m, .001, .03)
        return boom + .5 * crack
    if tipo == "whoosh":
        m = int(.55 * SR)
        x = RNG.standard_normal(m)
        env = np.sin(np.linspace(0, np.pi, m)) ** 2
        return (_bp(x, 400, 2500) * (1 - np.linspace(0, 1, m)) + _bp(x, 2000, 8000) * np.linspace(0, 1, m)) * env
    if tipo == "papel":
        m = int((dur or .5) * SR)
        x = np.zeros(m)
        for _ in range(int(m / SR * 40)):
            i = RNG.integers(0, max(m - 800, 1))
            x[i:i + 800] += _hp(RNG.standard_normal(800), 1800) * _env(800, .001, .008)
        return x
    if tipo == "caneta":
        m = int((dur or 2.0) * SR)
        x = _bp(RNG.standard_normal(m), 2500, 7500)
        mod = 0.5 + 0.5 * np.abs(np.sin(np.arange(m) / SR * 2 * np.pi * 7))
        return x * mod * 0.6
    if tipo == "botao":
        m = int(.25 * SR)
        clique = _hp(RNG.standard_normal(m), 3000) * _env(m, .0005, .004)
        baque = np.sin(2 * np.pi * 140 * np.arange(m) / SR) * _env(m, .001, .03)
        return clique + .8 * baque
    if tipo == "scanner":
        m = int((dur or 1.7) * SR)
        t = np.arange(m) / SR
        tom = np.sin(2 * np.pi * (900 + 600 * t / (dur or 1.7)) * t) * 0.3
        ruido = _bp(RNG.standard_normal(m), 3000, 9000) * (0.5 + 0.5 * np.sin(2 * np.pi * 16 * t))
        env = np.clip(t / .05, 0, 1) * np.clip(((dur or 1.7) - t) / .1, 0, 1)
        return (tom + .5 * ruido) * env
    if tipo == "carimbo":
        m = int(.5 * SR)
        thud = np.sin(2 * np.pi * np.cumsum(np.linspace(80, 40, m)) / SR) * _env(m, .001, .09)
        clack = _bp(RNG.standard_normal(m), 600, 4000) * _env(m, .0005, .02)
        return thud + .7 * clack
    if tipo == "tique":
        m = int(.06 * SR)
        return _bp(RNG.standard_normal(m), 2500, 7000) * _env(m, .0005, .01)
    if tipo == "pop":
        m = int(.3 * SR)
        t = np.arange(m) / SR
        return np.sin(2 * np.pi * (500 + 900 * t / .3) * t) * _env(m, .002, .07)
    if tipo == "marcador":
        m = int(.35 * SR)
        return _bp(RNG.standard_normal(m), 1200, 5000) * np.sin(np.linspace(0, np.pi, m)) * .5
    raise ValueError(tipo)


NIVEL = {"impacto": -14, "whoosh": -22, "papel": -24, "caneta": -26, "botao": -20, "scanner": -26,
         "carimbo": -16, "tique": -28, "pop": -24, "marcador": -26}


def efeitos(lista, total):
    out = np.zeros(int(total * SR))
    for e in lista:
        s = efeito(e["tipo"], e.get("dur"))
        s = s / (np.sqrt(np.mean(s ** 2)) + 1e-9) * 10 ** (NIVEL[e["tipo"]] / 20)
        _por(out, s, e["t"])
    return out


# ---------------------------------------------------------------- narracao e mix
def narracao(trechos, total):
    """trechos: [(arquivo_wav, t_inicio)] -> faixa unica (mono, SR)."""
    out = np.zeros(int(total * SR))
    for arq, t0 in trechos:
        y, sr = sf.read(str(arq))
        if y.ndim > 1:
            y = y.mean(axis=1)
        if sr != SR:
            import librosa
            y = librosa.resample(y, orig_sr=sr, target_sr=SR)
        _por(out, y, t0)
    return out


def _rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)


def mixar(pasta: Path, musica, sfx, voz, lufs=-14.0):
    pasta.mkdir(parents=True, exist_ok=True)
    falando = np.abs(voz) > 1e-4
    if falando.any():   # voz a ~-18 dBFS RMS na fala
        voz = voz / (np.sqrt(np.mean(voz[falando] ** 2)) + 1e-12) * 10 ** (-18 / 20)
    musica = musica / (np.sqrt(np.mean(musica ** 2)) + 1e-12) * 10 ** (-27 / 20)
    sf.write(pasta / "narracao.wav", voz.astype(np.float32), SR)
    sf.write(pasta / "musica.wav", musica.astype(np.float32), SR)
    sf.write(pasta / "efeitos.wav", sfx.astype(np.float32), SR)
    # ducking automatico: trilha e efeitos abaixam quando ha voz (ffmpeg sidechaincompress)
    filtro = ("[0:a]asplit=3[v][s1][s2];"
              "[1:a][s1]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=350[m];"
              "[2:a][s2]sidechaincompress=threshold=0.02:ratio=3:attack=5:release=200[e];"
              "[v][m][e]amix=inputs=3:normalize=0[out]")
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(pasta / "narracao.wav"), "-i", str(pasta / "musica.wav"),
                        "-i", str(pasta / "efeitos.wav"), "-filter_complex", filtro, "-map", "[out]",
                        str(pasta / "mix_bruto.wav")], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("Erro na mixagem:\n" + r.stderr[-1500:])
    # normalizacao em passo separado (loudnorm no mesmo grafo do asplit/amix trunca o audio)
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(pasta / "mix_bruto.wav"), "-af",
                        f"loudnorm=I={lufs}:TP=-1.5:LRA=9,aresample=44100", "-ac", "2", str(pasta / "mix.wav")],
                       capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("Erro na normalizacao:\n" + r.stderr[-1500:])
    return pasta / "mix.wav"
