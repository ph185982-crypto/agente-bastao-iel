#!/usr/bin/env python3
"""Editor automático de reels: vídeo bruto → final.mp4 (1080x1920, 30 fps) + poster.jpg + resultado.json.

uso: python3 tools/reels/editar.py entrada.mp4 pasta_saida --estilo hormozi --roteiro roteiro.txt \
        --opcoes '{"broll":true,"punch_in":true,"remover_pausas":true,"remover_muletas":true,"musica":false}'

Etapas (docs/VIDEOS_E_RECICLAGEM_SPEC.md → "Worker de edição"):
 1. ffprobe + rotação; áudio WAV 16 kHz mono limpo.
 2. Transcrição faster-whisper (palavras com tempo), initial_prompt com o roteiro.
 3. Cortes: silêncios, muletas, repetições, retomadas (fica a última).
 4. Enquadramento 9:16 (rosto via OpenCV Haar quando a fonte é horizontal).
 5. Punch-in estático alternado por frase.
 6. B-roll do Pexels Videos (opcional, precisa de PEXELS_API_KEY).
 7. Legendas ASS com palavra ativa (presets hormozi / beast / caixa).
 8. Render único no ffmpeg; 9. loudnorm em 2 passos; 10. poster + resultado.json.
Tudo gratuito e de código aberto; roda em CPU."""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_reels as L
import lib_montagem as M  # noqa: E402
import lib_destrava as D  # noqa: E402

RAIZ = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
FONTES = os.path.join(RAIZ, 'backend', 'assets')
PASTA_MUSICA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'musica')
OPCOES_PADRAO = {'broll': True, 'musica': False, 'punch_in': True, 'remover_pausas': True, 'remover_muletas': True}


def log(msg):
    print(f"[editar] {msg}", file=sys.stderr, flush=True)


def rodar(cmd, **kw):
    """Roda um comando e devolve o stderr (o ffmpeg escreve tudo lá). Levanta erro com o fim do log se falhar."""
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors='replace', **kw)
    if r.returncode != 0:
        raise RuntimeError(f"falhou: {' '.join(cmd[:3])}… → {r.stderr[-1500:]}")
    return r.stderr


class Cronometro:
    """Mede o tempo de cada etapa para o resultado.json e para o relatório."""

    def __init__(self):
        self.tempos = {}
        self._t = None
        self._nome = None

    def etapa(self, nome):
        self.fechar()
        self._nome, self._t = nome, time.perf_counter()
        log(f"etapa: {nome}")

    def fechar(self):
        if self._nome:
            self.tempos[self._nome] = round(time.perf_counter() - self._t, 2)
            log(f"  {self._nome}: {self.tempos[self._nome]} s")
            self._nome = None


# ----------------------------------------------------------------------------------------------------------------------
# 1. Sonda e áudio
# ----------------------------------------------------------------------------------------------------------------------
def sondar(entrada):
    """ffprobe → {largura, altura, duracao, rotacao, tem_audio, fps}. Largura/altura já consideram a rotação."""
    out = subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', entrada],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True).stdout
    info = json.loads(out)
    v = next((s for s in info['streams'] if s.get('codec_type') == 'video'), None)
    if not v:
        raise RuntimeError('o arquivo não tem vídeo')
    a = next((s for s in info['streams'] if s.get('codec_type') == 'audio'), None)
    rot = 0
    for sd in v.get('side_data_list', []) or []:
        if 'rotation' in sd:
            rot = float(sd['rotation'])
    if not rot and (v.get('tags') or {}).get('rotate'):
        rot = -float(v['tags']['rotate'])   # a tag antiga tem o sinal invertido em relação ao side_data
    filtro = ''   # a rotação fica com o ffmpeg (autorotate): girar na mão dependia do sinal do ffprobe, que muda por versão
    w, h = int(v['width']), int(v['height'])
    dims = dimensoes_reais(entrada)
    if dims:
        w, h = dims
    elif int(round(abs(rot))) % 180 == 90:
        w, h = h, w
    dur = float(info.get('format', {}).get('duration') or v.get('duration') or 0)
    fps = 30.0
    if v.get('avg_frame_rate') and '/' in v['avg_frame_rate']:
        n, d = v['avg_frame_rate'].split('/')
        fps = float(n) / float(d) if float(d) else 30.0
    return {'largura': w, 'altura': h, 'duracao': dur, 'rotacao': rot, 'filtro_rotacao': filtro, 'tem_audio': a is not None, 'fps': fps}


def dimensoes_reais(entrada):
    """Largura x altura do 1º quadro como o ffmpeg o entrega (já girado). Lê o cabeçalho do PNG; None se falhar."""
    try:
        png = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', entrada, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=60).stdout
        if png[:8] == b'\x89PNG\r\n\x1a\n':
            return int.from_bytes(png[16:20], 'big'), int.from_bytes(png[20:24], 'big')
    except Exception:
        pass
    return None


def extrair_audio(entrada, wav, tem_audio):
    """WAV 16 kHz mono limpo (passa-alta 80 Hz + redução de ruído) para o Whisper e o silencedetect."""
    if tem_audio:
        rodar(['ffmpeg', '-y', '-loglevel', 'error', '-i', entrada, '-vn', '-ac', '1', '-ar', '16000',
               '-af', 'highpass=f=80,afftdn=nf=-25', wav])
    else:
        rodar(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '1', wav])


def detectar_silencios(wav, ruido='-35dB', dur='0.35'):
    err = rodar(['ffmpeg', '-hide_banner', '-nostats', '-i', wav, '-af', f'silencedetect=noise={ruido}:d={dur}', '-f', 'null', '-'])
    return L.parse_silencedetect(err)


# ----------------------------------------------------------------------------------------------------------------------
# 2. Transcrição
# ----------------------------------------------------------------------------------------------------------------------
def transcrever(wav, duracao, roteiro, modelo=None):
    """faster-whisper em CPU int8. `small` por padrão, `medium` se o vídeo tem ≤ 90 s (cabe no tempo do worker)."""
    from faster_whisper import WhisperModel
    nome = modelo or os.environ.get('REELS_MODELO') or ('medium' if duracao <= 90 else 'small')
    log(f"modelo whisper: {nome}")
    m = WhisperModel(nome, device='cpu', compute_type='int8', cpu_threads=max(1, os.cpu_count() or 1))
    segs, info = m.transcribe(wav, language='pt', word_timestamps=True, vad_filter=True, beam_size=5,
                              initial_prompt=L.montar_initial_prompt(roteiro),
                              vad_parameters={'min_silence_duration_ms': 300})
    palavras, frases = [], []
    for i, s in enumerate(segs):
        frases.append({'t0': round(s.start, 3), 't1': round(s.end, 3), 'texto': s.text.strip()})
        for w in s.words or []:
            if not w.word.strip():
                continue
            palavras.append({'t0': round(w.start, 3), 't1': round(w.end, 3), 'w': w.word.strip(), 'p': round(w.probability, 2), 'seg': i})
    return {'modelo': nome, 'palavras': palavras, 'frases': frases, 'idioma': info.language}


# ----------------------------------------------------------------------------------------------------------------------
# 4. Rosto
# ----------------------------------------------------------------------------------------------------------------------
def detectar_rostos(entrada, sonda, fps_amostra=6, largura_amostra=480):
    """Lê o vídeo a 6 fps em tons de cinza (via ffmpeg, já com a rotação aplicada) e acha o maior rosto por quadro.
    Devolve as amostras CRUAS [(t, cx, cy, altura)] (tudo normalizado 0..1; None quando não achou rosto)."""
    import cv2
    import numpy as np
    w, h = sonda['largura'], sonda['altura']
    hs = int(round(largura_amostra * h / w / 2) * 2)
    vf = ','.join(x for x in [sonda['filtro_rotacao'], f'fps={fps_amostra}', f'scale={largura_amostra}:{hs}', 'format=gray'] if x)
    p = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', entrada, '-vf', vf, '-f', 'rawvideo', '-'],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    quadros = np.frombuffer(p.stdout, dtype=np.uint8)
    n = len(quadros) // (largura_amostra * hs)
    if n == 0:
        return []
    quadros = quadros[:n * largura_amostra * hs].reshape(n, hs, largura_amostra)
    casc = cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml'))
    cru = []
    for i, q in enumerate(quadros):
        q = cv2.equalizeHist(np.ascontiguousarray(q))
        rostos = casc.detectMultiScale(q, scaleFactor=1.1, minNeighbors=5, minSize=(36, 36))
        t = round((i + 0.5) / fps_amostra, 3)
        if len(rostos):
            x, y, rw, rh = max(rostos, key=lambda r: r[2] * r[3])
            cru.append((t, (x + rw / 2) / largura_amostra, (y + rh / 2) / hs, rh / hs))
        else:
            cru.append((t, None, None, None))
    log(f"rosto achado em {sum(1 for c in cru if c[1] is not None)}/{n} amostras")
    return cru


def amostrar_rostos(entrada, sonda, cru=None):
    """Centros do rosto suavizados [(t, cx, cy)] (zona morta + passo máximo), para os formatos com crop fixo por trecho.
    Usa as amostras cruas de `detectar_rostos` (lê o vídeo se não vierem)."""
    cru = detectar_rostos(entrada, sonda) if cru is None else cru
    if not any(c[1] is not None for c in cru):
        return []
    scx = L.suavizar_centros([c[1] for c in cru])
    scy = L.suavizar_centros([c[2] for c in cru], inicial=0.45)
    return [(c[0], scx[i], scy[i]) for i, c in enumerate(cru)]


MODELO_PESSOA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'modelos', 'selfie_segmenter.tflite')


def mascara_cabeca(janela, destino, largura, altura, faixa, inicios, avisos):
    """Máscara (cinza, 0–255) da faixa de `faixa` linhas no TOPO do vídeo da janela estendida: ali só aparece a pessoa
    que atravessa a borda de cima da janela (a cabeça "sai" da janela, como na referência).
    Segmentação de pessoa local e gratuita: MediaPipe selfie_segmenter (Apache 2.0) no LiteRT, ~6 ms por quadro em CPU.
    Só fica o que está ligado à pessoa DENTRO da janela (nada solto no fundo); o topo da faixa esmaece; a máscara é
    suavizada no tempo e zera a cada corte (`inicios` = índice do 1º quadro de cada trecho). Devolve o caminho ou None."""
    try:
        import cv2
        import numpy as np
        from ai_edge_litert.interpreter import Interpreter
    except Exception as e:   # sem a biblioteca: o vídeo sai igual, só sem a cabeça para fora
        avisos.append(f'recorte da cabeça desligado (segmentação indisponível: {str(e)[:80]})')
        return None
    if not os.path.exists(MODELO_PESSOA):
        avisos.append('recorte da cabeça desligado: modelo de segmentação não encontrado')
        return None
    it = Interpreter(model_path=MODELO_PESSOA, num_threads=max(1, os.cpu_count() or 1))
    it.allocate_tensors()
    ent, sai = it.get_input_details()[0], it.get_output_details()[0]
    lado_a, lado_l = int(ent['shape'][1]), int(ent['shape'][2])
    ler = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-i', janela, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    gravar = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', f'{largura}x{faixa}',
                               '-framerate', '30', '-i', '-', '-c:v', 'ffv1', destino], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    tam = largura * altura * 3
    inicios = set(inicios)
    esmaece = np.clip(np.arange(faixa, dtype=np.float32) / 24.0, 0, 1)[:, None]   # topo da faixa some aos poucos
    nucleo = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    vazio = np.zeros((faixa, largura), np.uint8).tobytes()
    media, i, com_cabeca = None, 0, 0
    try:
        while True:
            buf = ler.stdout.read(tam)
            if len(buf) < tam:
                break
            q = np.frombuffer(buf, np.uint8).reshape(altura, largura, 3)
            x = cv2.resize(q, (lado_l, lado_a), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
            it.set_tensor(ent['index'], x[None])
            it.invoke()
            m = it.get_tensor(sai['index'])[0, :, :, 0]
            media = m if (media is None or i in inicios) else 0.6 * m + 0.4 * media   # tira o tremor sem arrastar
            # mapa em alta (bicúbico: sem degraus), alfa suave na borda da pessoa
            mm = cv2.resize(media, (largura, altura), interpolation=cv2.INTER_CUBIC)[:faixa + 8]
            alfa = np.clip((mm[:faixa] - 0.35) / 0.3, 0, 1)
            # só o que está ligado à pessoa dentro da janela (limiar baixo: a área mantida contém a borda suave inteira)
            b = (mm > 0.2).astype(np.uint8)
            _, rot = cv2.connectedComponents(b, connectivity=8)
            na_borda = np.unique(rot[faixa:][b[faixa:] > 0])
            na_borda = na_borda[na_borda > 0]
            if len(na_borda):
                ligado = cv2.dilate(np.isin(rot[:faixa], na_borda).astype(np.uint8), nucleo).astype(np.float32)
                ligado = cv2.GaussianBlur(ligado, (0, 0), 2.0)
                alfa = np.clip(cv2.GaussianBlur(alfa * ligado, (0, 0), 1.2), 0, 1) * esmaece
                gravar.stdin.write((alfa * 255).astype(np.uint8).tobytes())
                com_cabeca += 1
            else:
                gravar.stdin.write(vazio)
            i += 1
    finally:
        try:
            gravar.stdin.close()
        except Exception:
            pass
        gravar.wait()
        ler.stdout.close()
        ler.wait()
    log(f"recorte da cabeça: {i} quadros, cabeça fora da janela em {com_cabeca}")
    if gravar.returncode != 0 or i == 0:
        avisos.append('recorte da cabeça desligado: a máscara não foi gerada')
        return None
    return destino


# ----------------------------------------------------------------------------------------------------------------------
# 6. B-roll (Pexels Videos)
# ----------------------------------------------------------------------------------------------------------------------
def _credencial_app():
    """Credencial para falar com o app: CRON_SECRET se houver; senão um token OIDC novo do GitHub Actions (vale poucos minutos)."""
    seg = os.environ.get('CRON_SECRET', '').strip()
    if seg:
        return seg
    url = os.environ.get('ACTIONS_ID_TOKEN_REQUEST_URL'); tok = os.environ.get('ACTIONS_ID_TOKEN_REQUEST_TOKEN')
    if not url or not tok:
        raise RuntimeError('sem credencial para o app (CRON_SECRET ou OIDC)')
    req = urllib.request.Request(url + ('&' if '?' in url else '?') + 'audience=agente-bastao-iel', headers={'Authorization': 'Bearer ' + tok})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode('utf-8'))['value']


def baixar_broll(pontos, pasta, chave, avisos):
    """Para cada ponto, busca um vídeo retrato ≥ 1080 no Pexels e baixa. Devolve [{..., arquivo}] só dos que deram certo."""
    out = []
    usados = set()
    for k, pt in enumerate(pontos):
        try:
            q = urllib.parse.urlencode({'query': pt['consulta'], 'orientation': 'portrait', 'size': 'medium', 'per_page': 6})
            if chave == '__app__':   # sem chave do Pexels aqui: pede ao app, que guarda a chave (autentica com o token OIDC do runner)
                req = urllib.request.Request(f"{os.environ['BROLL_URL']}?{q}", headers={'Authorization': 'Bearer ' + _credencial_app(), 'User-Agent': 'agente-bastao-reels/1.0'})
            else:
                req = urllib.request.Request(f'https://api.pexels.com/videos/search?{q}', headers={'Authorization': chave, 'User-Agent': 'agente-bastao-reels/1.0'})
            with urllib.request.urlopen(req, timeout=20) as r:
                dados = json.loads(r.read().decode('utf-8'))
            escolhido = None
            for v in dados.get('videos', []):
                if v.get('id') in usados:
                    continue
                arq = L.escolher_arquivo_pexels(v)
                if arq:
                    escolhido = (v, arq)
                    break
            if not escolhido:
                avisos.append(f"b-roll: nada em retrato ≥1080 para '{pt['consulta']}'")
                continue
            v, arq = escolhido
            destino = os.path.join(pasta, f'broll_{k}.mp4')
            req = urllib.request.Request(arq['link'], headers={'User-Agent': 'agente-bastao-reels/1.0'})
            with urllib.request.urlopen(req, timeout=60) as r, open(destino, 'wb') as f:
                shutil.copyfileobj(r, f, 1024 * 256)
            usados.add(v.get('id'))
            out.append(dict(pt, arquivo=destino, pexels_id=v.get('id'), autor=(v.get('user') or {}).get('name')))
            log(f"b-roll {k}: '{pt['consulta']}' → pexels #{v.get('id')} ({arq['width']}x{arq['height']})")
        except Exception as e:  # rede instável não derruba a edição
            avisos.append(f"b-roll '{pt['consulta']}': {str(e)[:120]}")
    return out


# ----------------------------------------------------------------------------------------------------------------------
# 8/9. Render
# ----------------------------------------------------------------------------------------------------------------------
def _filtros_segmentos(segmentos, centros, sonda, com_video=True):
    """Trechos → cadeias trim/atrim por segmento + concat. Devolve (lista de filtros, rótulo vídeo, rótulo áudio)."""
    partes = []
    rot = sonda['filtro_rotacao']
    for i, (seg, (cx, cy)) in enumerate(zip(segmentos, centros)):
        a, b = seg['a'], seg['b']
        dur = b - a
        if com_video:
            w, h, x, y = L.geometria_crop(sonda['largura'], sonda['altura'], seg['zoom'], cx, cy)
            cadeia = [f"trim=start={a:.3f}:end={b:.3f}", 'setpts=PTS-STARTPTS']
            if rot:
                cadeia.append(rot)
            # setsar=1: o zoom gera SARs ligeiramente diferentes por segmento e o concat exige iguais
            cadeia += [f"scale={w}:{h}:flags=bicubic", f"crop={L.LARGURA}:{L.ALTURA}:{x}:{y}", 'setsar=1']
            partes.append(f"[0:v]{','.join(cadeia)}[v{i}]")
        acad = [f"atrim=start={a:.3f}:end={b:.3f}", 'asetpts=PTS-STARTPTS']
        if seg['fade_in']:
            acad.append('afade=t=in:st=0:d=0.01')
        if seg['fade_out'] and dur > 0.03:
            acad.append(f"afade=t=out:st={max(0, dur - 0.01):.3f}:d=0.01")
        partes.append(f"[0:a]{','.join(acad)}[a{i}]")
    n = len(segmentos)
    if com_video:
        partes.append(''.join(f"[v{i}][a{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[vc][ac]")
        return partes, '[vc]', '[ac]'
    partes.append(''.join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[ac]")
    return partes, None, '[ac]'


def _filtros_montagem(segmentos, centros, sonda):
    """Como _filtros_segmentos, mas cada trecho sai em DOIS enquadramentos do mesmo instante: tela cheia 1080x1920
    (com punch-in) e meia tela 1080x960 (rosto para a tela dividida). Devolve (filtros, [vF], [vH], [ac])."""
    partes = []
    for i, (seg, (cx, cy)) in enumerate(zip(segmentos, centros)):
        a, b = seg['a'], seg['b']; dur = b - a
        w, h, x, y = L.geometria_crop(sonda['largura'], sonda['altura'], seg['zoom'], cx, cy)
        wm, hm, xm, ym = L.geometria_crop(sonda['largura'], sonda['altura'], 1.0, cx, max(0.0, cy - 0.04), L.LARGURA, M.METADE)
        partes.append(f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS,fps=30,split[s{i}a][s{i}b]")
        partes.append(f"[s{i}a]scale={w}:{h}:flags=bicubic,crop={L.LARGURA}:{L.ALTURA}:{x}:{y},setsar=1[f{i}]")
        partes.append(f"[s{i}b]scale={wm}:{hm}:flags=bicubic,crop={L.LARGURA}:{M.METADE}:{xm}:{ym},setsar=1[h{i}]")
        acad = [f"atrim=start={a:.3f}:end={b:.3f}", 'asetpts=PTS-STARTPTS']
        if seg['fade_in']:
            acad.append('afade=t=in:st=0:d=0.01')
        if seg['fade_out'] and dur > 0.03:
            acad.append(f"afade=t=out:st={max(0, dur - 0.01):.3f}:d=0.01")
        partes.append(f"[0:a]{','.join(acad)}[a{i}]")
    n = len(segmentos)
    partes.append(''.join(f"[f{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[vF]")
    partes.append(''.join(f"[h{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[vH]")
    partes.append(''.join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[ac]")
    return partes, '[vF]', '[vH]', '[ac]'


def pedir_plano(frases, titulo, avisos):
    """Plano visual por frase (nome da ideia, tipo de cena, busca da imagem em inglês), feito no app pela IA gratuita
    (backend/lib/videos/plano.js). Sem app ou se falhar: None (o editor usa as regras automáticas). Teste local: o
    arquivo em REELS_PLANO_LOCAL ({"cenas": [...]})."""
    if not frases:
        return None
    local = os.environ.get('REELS_PLANO_LOCAL')
    if local:
        cenas = json.load(open(local, encoding='utf-8')).get('cenas')
        return cenas if isinstance(cenas, list) else None
    url = os.environ.get('PLANO_URL')
    if not url:
        return None
    corpo = json.dumps({'id': os.environ.get('REELS_JOB_ID', ''), 'titulo': titulo or '', 'frases': [f['texto'] for f in frases]}, ensure_ascii=False).encode('utf-8')
    try:
        req = urllib.request.Request(url, data=corpo, method='POST', headers={'Authorization': 'Bearer ' + _credencial_app(), 'Content-Type': 'application/json', 'User-Agent': 'agente-bastao-reels/1.0'})
        with urllib.request.urlopen(req, timeout=75) as r:
            d = json.loads(r.read().decode('utf-8'))
        cenas = d.get('cenas')
        if isinstance(cenas, list) and len(cenas) == len(frases):
            log(f"plano visual: {len(cenas)} cenas ({d.get('fonte') or 'ia'})")
            return cenas
        avisos.append('plano visual veio incompleto: usei as regras automáticas')
    except Exception as e:   # o vídeo sai do mesmo jeito, com as regras de sempre
        avisos.append(f'plano visual indisponível ({str(e)[:90]}): usei as regras automáticas')
    return None


def _wav_mono(caminho, onda, sr):
    import numpy as np
    import wave
    pcm = (np.clip(onda, -1, 1) * 32767).astype(np.int16)
    with wave.open(caminho, 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(sr); f.writeframes(pcm.tobytes())
    return caminho


def trilha_efeitos(caminho, eventos, duracao, sr=48000):
    """Sons curtos gerados aqui (nenhum arquivo de terceiros): 'whoosh' na troca de cena, 'pop' quando um elemento entra
    (item da lista, cartão, ícone) e 'impacto' no número gigante e na abertura. `eventos` = [(t, tipo)] (D.efeitos)."""
    import numpy as np
    n = int(duracao * sr) + sr
    out = np.zeros(n, dtype=np.float32)
    rng = np.random.default_rng(7)
    d = int(0.28 * sr)
    env = np.sin(np.linspace(0, np.pi, d)) ** 2
    whoosh = (np.convolve(rng.standard_normal(d), np.ones(9) / 9, mode='same') * env * 0.12).astype(np.float32)
    d = int(0.09 * sr); tt = np.arange(d) / sr
    f = 420 + 680 * np.exp(-tt / 0.012)   # tom que cai rápido: "pop"
    pop = np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-tt / 0.025) * np.minimum(1, tt / 0.002)
    pop = ((pop + rng.standard_normal(d) * np.exp(-tt / 0.002) * 0.3) * 0.13).astype(np.float32)
    d = int(0.32 * sr); tt = np.arange(d) / sr
    f = 45 + 50 * np.exp(-tt / 0.05)      # grave que cai: "impacto"
    imp = np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-tt / 0.11) * np.minimum(1, tt / 0.003)
    imp = ((imp + rng.standard_normal(d) * np.exp(-tt / 0.004) * 0.25) * 0.25).astype(np.float32)
    sons = {'whoosh': (whoosh, 0.12), 'pop': (pop, 0.0), 'impacto': (imp, 0.0)}   # (onda, quanto começa antes do instante)
    for t, tipo in eventos:
        w, adiant = sons.get(tipo, sons['pop'])
        i = int(max(0.0, t - adiant) * sr)
        if i + len(w) < n:
            out[i:i + len(w)] += w
    return _wav_mono(caminho, out, sr)


def trilha_musical(caminho, duracao, sr=44100, bpm=92):
    """Trilha de fundo GERADA aqui (não é de ninguém: o Instagram não tem o que silenciar): pad suave em lá menor
    (Am–F–C–G), baixo nos tempos 1 e 3 e um pulso macio que faz o pad 'respirar'. O volume final e o abaixar sozinho
    quando há fala ficam na mistura (renderizar_destrava)."""
    import numpy as np
    n = int((duracao + 1.0) * sr)
    beat = 60.0 / bpm; compasso = 4 * beat
    acordes = [(57, 60, 64, 69), (53, 57, 60, 65), (48, 52, 55, 60), (55, 59, 62, 67)]   # Am, F, C, G (MIDI)

    def hz(m):
        return 440.0 * 2 ** ((m - 69) / 12)
    pad = np.zeros(n, np.float32)
    for k in range(int(n / sr / compasso) + 2):
        i0 = int(k * compasso * sr)
        if i0 >= n:
            break
        i1 = min(n, int(((k + 1) * compasso + 0.8) * sr))   # cauda de 0,8 s cruza com o próximo acorde
        tt = np.arange(i1 - i0) / sr
        env = np.minimum(1.0, tt / 0.6) * np.exp(-np.maximum(0.0, tt - compasso) / 0.35)
        seg = np.zeros(i1 - i0, np.float32)
        for m in acordes[k % 4]:
            for det in (-0.0012, 0.0012):   # dois osciladores levemente desafinados (coro)
                ph = 2 * np.pi * hz(m) * (1 + det) * tt
                seg += (np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)).astype(np.float32)
        pad[i0:i1] += seg * env / 8.0
    baixo = np.zeros(n, np.float32); kick = np.zeros(n, np.float32); bomba = np.ones(n, np.float32)
    for k in range(int(n / sr / beat) + 1):
        i0 = int(k * beat * sr)
        if i0 >= n:
            break
        L_ = min(n - i0, int(0.35 * sr)); tt = np.arange(L_) / sr
        bomba[i0:i0 + L_] *= (1 - 0.3 * np.exp(-tt / 0.12)).astype(np.float32)
        if k % 2 == 0:
            f = 52 + 60 * np.exp(-tt / 0.03)
            kick[i0:i0 + L_] += (np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-tt / 0.12)).astype(np.float32)
            Lb = min(n - i0, int(beat * 1.8 * sr)); tb = np.arange(Lb) / sr
            fb = hz(acordes[(k // 4) % 4][0] - 12)
            baixo[i0:i0 + Lb] += (np.sin(2 * np.pi * fb * tb) * np.exp(-tb / 0.5) * np.minimum(1, tb / 0.01)).astype(np.float32)
    mix = pad * bomba * 0.55 + baixo * 0.35 + kick * 0.16
    mix = mix / (np.max(np.abs(mix)) + 1e-9) * 0.6
    return _wav_mono(caminho, mix, sr)


def trilha_whoosh(caminho, instantes, duracao, volume=0.18, sr=48000):
    """Gera (sem arquivo de terceiros) um 'whoosh' de 0,28 s em cada troca de layout: ruído filtrado com envelope."""
    import numpy as np
    import wave
    n = int(duracao * sr) + sr
    trilha = np.zeros(n, dtype=np.float32)
    d = int(0.28 * sr)
    rng = np.random.default_rng(7)
    ruido = rng.standard_normal(d).astype(np.float32)
    # passa-baixa móvel simples (média) que vai abrindo: soa como passagem de ar
    env = np.sin(np.linspace(0, np.pi, d)) ** 2
    suave = np.convolve(ruido, np.ones(9) / 9, mode='same')
    w = (suave * env * volume).astype(np.float32)
    for t in instantes:
        i = int(max(0.0, t - 0.12) * sr)
        if i + d < n:
            trilha[i:i + d] += w
    pcm = (np.clip(trilha, -1, 1) * 32767).astype(np.int16)
    with wave.open(caminho, 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(sr); f.writeframes(pcm.tobytes())
    return caminho


def renderizar_montagem(entrada, saida, segmentos, centros, sonda, ass_legenda, blocos, ass_topo, ass_cheio, medido, whoosh=None, brolls_topo=()):
    """Render da montagem dinâmica em etapas (memória baixa — um grafo único segurava o vídeo inteiro várias vezes):
    1) vídeo cortado em dois enquadramentos (tela cheia e meia tela) + áudio; 2) quadros animados (topo e cheio);
    3) um clipe por bloco (rosto / dividida / cartão); 4) junta os clipes, queima as legendas e mistura voz + whoosh."""
    tmp = os.path.dirname(ass_topo)
    dur = sum(sg['b'] - sg['a'] for sg in segmentos)
    fontes_esc = FONTES.replace('\\', '/').replace(':', '\\:').replace("'", "\\'")
    def esc(p):
        return p.replace('\\', '/').replace(':', '\\:').replace("'", "\\'")
    enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30']
    # 1) cortes nos dois enquadramentos
    cheio, meia, voz = os.path.join(tmp, 'cheio.mp4'), os.path.join(tmp, 'meia.mp4'), os.path.join(tmp, 'voz.wav')
    # um trecho por comando (busca exata com -ss/-t na entrada): memória constante, qualquer duração de vídeo
    listas = {'f': [], 'h': [], 'a': []}
    for i, (seg, (cx, cy)) in enumerate(zip(segmentos, centros)):
        a, b = seg['a'], seg['b']; d = b - a
        w, h, x, y = L.geometria_crop(sonda['largura'], sonda['altura'], seg['zoom'], cx, cy)
        wm, hm, xm, ym = L.geometria_crop(sonda['largura'], sonda['altura'], 1.0, cx, max(0.0, cy - 0.04), L.LARGURA, M.METADE)
        fo, ho, ao = (os.path.join(tmp, f'seg_{i:03d}.{e}') for e in ('f.mp4', 'h.mp4', 'a.wav'))
        af = ['afade=t=in:st=0:d=0.03'] if seg['fade_in'] else []
        if seg['fade_out'] and d > 0.06:
            af.append(f"afade=t=out:st={max(0, d - 0.03):.3f}:d=0.03")
        rodar(['ffmpeg', '-y', '-hide_banner', '-nostats', '-loglevel', 'error', '-ss', f"{a:.3f}", '-t', f"{d:.3f}", '-i', entrada,
               '-filter_complex', f"[0:v]fps=30,split[a][b];[a]scale={w}:{h}:flags=bicubic,crop={L.LARGURA}:{L.ALTURA}:{x}:{y},setsar=1[f];"
               f"[b]scale={wm}:{hm}:flags=bicubic,crop={L.LARGURA}:{M.METADE}:{xm}:{ym},setsar=1[h]",
               '-map', '[f]', '-t', f"{d:.3f}", *enc, fo, '-map', '[h]', '-t', f"{d:.3f}", *enc, ho,
               '-map', '0:a', '-t', f"{d:.3f}", *(['-af', ','.join(af)] if af else []), '-ar', '48000', '-ac', '2', ao])
        listas['f'].append(fo); listas['h'].append(ho); listas['a'].append(ao)
    for chave, destino in (('f', cheio), ('h', meia), ('a', voz)):
        lst = os.path.join(tmp, f'lista_{chave}.txt')
        with open(lst, 'w') as fl:
            fl.write(''.join(f"file '{n}'\n" for n in listas[chave]))
        rodar(['ffmpeg', '-y', '-hide_banner', '-nostats', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', destino])
    # 2) quadros animados
    topo, cartao = os.path.join(tmp, 'topo.mp4'), os.path.join(tmp, 'cartao.mp4')
    entradas = ['-f', 'lavfi', '-i', f"color=c=0x18191D:s={L.LARGURA}x{M.METADE}:r=30:d={dur + 0.5:.3f}"]
    grafo = ["[0:v]format=yuv420p,drawbox=x=0:y=0:w=iw:h=6:color=0xFDE047@1:t=fill[g0]"]; atual = '[g0]'
    for k, b in enumerate(brolls_topo):
        entradas += ['-i', b['arquivo']]
        d0 = b['t1'] - b['t0']
        grafo.append(f"[{k + 1}:v]trim=duration={d0:.3f},setpts=PTS-STARTPTS,fps=30,scale={L.LARGURA}:{M.METADE}:force_original_aspect_ratio=increase,"
                     f"crop={L.LARGURA}:{M.METADE},eq=brightness=-0.08,format=yuv420p,setpts=PTS+{b['t0']:.3f}/TB[br{k}]")
        grafo.append(f"{atual}[br{k}]overlay=0:0:eof_action=pass:enable='between(t,{b['t0']:.3f},{b['t1']:.3f})'[g{k + 1}]"); atual = f"[g{k + 1}]"
    grafo.append(f"{atual}ass=filename='{esc(ass_topo)}':fontsdir='{fontes_esc}'[gout]")
    rodar(['ffmpeg', '-y', '-hide_banner', '-nostats', '-loglevel', 'error', *entradas, '-filter_complex', ';'.join(grafo), '-map', '[gout]', '-t', f"{dur:.3f}", *enc, topo])
    if any(b['layout'] == 'cartao' for b in blocos):
        rodar(['ffmpeg', '-y', '-hide_banner', '-nostats', '-loglevel', 'error', '-f', 'lavfi', '-i', f"color=c=0x18191D:s={L.LARGURA}x{L.ALTURA}:r=30:d={dur + 0.5:.3f}",
               '-vf', f"format=yuv420p,ass=filename='{esc(ass_cheio)}':fontsdir='{fontes_esc}'", '-t', f"{dur:.3f}", *enc, cartao])
    # 3) um clipe por bloco (corte exato por trim, sem depender de keyframe)
    lista = os.path.join(tmp, 'blocos.txt'); nomes = []
    for i, b in enumerate(blocos):
        out = os.path.join(tmp, f'bloco_{i:03d}.mp4'); d = b['t1'] - b['t0']
        cort = f"trim=start={b['t0']:.3f}:end={b['t1']:.3f},setpts=PTS-STARTPTS"
        if b['layout'] == 'dividida':
            cmd = ['-i', topo, '-i', meia, '-filter_complex', f"[0:v]{cort}[t];[1:v]{cort}[h];[t][h]vstack,setsar=1,format=yuv420p[v]", '-map', '[v]']
        elif b['layout'] == 'cartao':
            cmd = ['-i', cartao, '-filter_complex', f"[0:v]{cort},setsar=1,format=yuv420p[v]", '-map', '[v]']
        else:
            cmd = ['-i', cheio, '-filter_complex', f"[0:v]{cort},setsar=1,format=yuv420p[v]", '-map', '[v]']
        rodar(['ffmpeg', '-y', '-hide_banner', '-nostats', '-loglevel', 'error', *cmd, '-t', f"{d:.3f}", *enc, out])
        nomes.append(out)
    with open(lista, 'w') as f:
        f.write(''.join(f"file '{n}'\n" for n in nomes))
    # 4) junta, legenda e áudio final
    entradas = ['-f', 'concat', '-safe', '0', '-i', lista, '-i', voz]
    # Voz gravada baixa (celular longe, rua): o loudnorm linear não consegue subir 20 dB sem estourar o pico e o vídeo
    # saía a -26 LUFS. Primeiro um ganho de fala (dynaudnorm), depois o loudnorm dinâmico em -14 LUFS.
    voz_f = 'highpass=f=70,dynaudnorm=f=250:g=15:p=0.9:m=20,' + filtro_loudnorm(None)
    if whoosh:
        entradas += ['-i', whoosh]
        a_f = f"[1:a]{voz_f}[vz];[2:a]aresample=48000[wh];[vz][wh]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]"
    else:
        a_f = f"[1:a]{voz_f}[aout]"
    rodar(['ffmpeg', '-y', '-hide_banner', '-nostats', '-loglevel', 'error', *entradas, '-filter_complex',
           f"[0:v]fps=30,format=yuv420p,ass=filename='{esc(ass_legenda)}':fontsdir='{fontes_esc}'[vout];{a_f}",
           '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', '30', '-pix_fmt', 'yuv420p',
           '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', '-shortest', saida])


def _pgm_arredondado(caminho, w, h, r):
    """Máscara (PGM cinza) de retângulo de cantos arredondados: 255 dentro, 0 fora. Sem PIL."""
    import numpy as np
    y, x = np.mgrid[0:h, 0:w]
    dx = np.maximum(np.maximum(r - x, x - (w - 1 - r)), 0)
    dy = np.maximum(np.maximum(r - y, y - (h - 1 - r)), 0)
    dentro = (dx * dx + dy * dy) <= r * r
    img = np.where(dentro, 255, 0).astype(np.uint8)
    with open(caminho, 'wb') as f:
        f.write(f"P5 {w} {h} 255\n".encode()); f.write(img.tobytes())
    return caminho


def _fundo_destrava(caminho):
    """Fundo quase preto com grade de pontos sutil e vinheta (como a referência)."""
    rodar(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', f"color=c=0x0B0B0E:s={D.W}x{D.H}:d=1",
           '-vf', "format=gray,geq=lum='if(lt(mod(X,26),3)*lt(mod(Y,26),3),30,12)',format=rgb24,vignette=angle=PI/5",
           '-frames:v', '1', caminho])
    return caminho


def _zoom_lento(w, h, d, quanto=0.08):
    """Filtros do 'Ken Burns': a imagem de banco cobre w×h e vai aproximando devagar (quanto=8% ao longo de d s)."""
    return (f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},"
            f"scale=w='trunc({w}*(1+{quanto}*t/{max(d, 0.5):.3f})/2)*2':h='trunc({h}*(1+{quanto}*t/{max(d, 0.5):.3f})/2)*2':eval=frame,crop={w}:{h}")


# Voz: passa-alta, menos ruído de rua, menos "embolado" (250 Hz), mais presença (4 kHz) e brilho, sem chiado no "s";
# depois o ganho de fala e o loudnorm (-14 LUFS). Tudo no ffmpeg, sem custo.
VOZ_FILTRO = ('highpass=f=80,afftdn=nr=10:nf=-50:tn=1,equalizer=f=250:t=q:w=1.1:g=-2,equalizer=f=4000:t=q:w=1.2:g=3,'
              'highshelf=f=9500:g=2.5,deesser=i=0.35,dynaudnorm=f=250:g=15:p=0.9:m=20,')


def renderizar_destrava(entrada, saida, segmentos, sonda, blocos, palavras_rm, dur, tmp, brolls, whoosh=None, trilha=None,
                        altura_rosto=None, avisos=None, musica=None):
    """Formato Destrava: fundo escuro com gráficos em cima e o Pedro numa janela embaixo, com o rosto centralizado (o
    recorte segue o rosto quadro a quadro) e a cabeça saindo pela borda de cima; close em tela cheia e cena de banco nos
    blocos certos; legenda de uma palavra; tela final. Render em etapas (memória constante)."""
    avisos = [] if avisos is None else avisos
    fontes_esc = FONTES.replace('\\', '/').replace(':', '\\:').replace("'", "\\'")
    def esc(p):
        return p.replace('\\', '/').replace(':', '\\:').replace("'", "\\'")
    enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30']
    J, R = D.JANELA, D.RECORTE
    # 1) cortes em dois enquadramentos que seguem o rosto: janela ESTENDIDA (948x(150+600): a faixa de cima é por onde a
    #    cabeça sai; a fonte ganha 150 linhas pretas em cima para o rosto poder ficar no centro mesmo no alto do quadro)
    #    e close (1080x1920, zoom 1,22, rosto no alto).
    _, wj, hj = D.escala_janela(sonda['largura'], sonda['altura'], altura_rosto)
    _, wc, hc = D.escala_close(sonda['largura'], sonda['altura'])
    listas = {'j': [], 'c': [], 'a': []}
    inicios, quadros = [], 0
    for i, seg in enumerate(segmentos):
        a, b = seg['a'], seg['b']; d = b - a
        xj, yj = L.chaves_crop(trilha, a, b, wj, hj, J['w'], J['h'] + R, J['w'] / 2, R + D.ROSTO_JANELA * J['h'], topo=R)
        xc, yc = L.chaves_crop(trilha, a, b, wc, hc, L.LARGURA, L.ALTURA, L.LARGURA / 2, D.ROSTO_CLOSE)
        jo, co, ao = (os.path.join(tmp, f'd{i:03d}.{e}') for e in ('j.mp4', 'c.mp4', 'a.wav'))
        af = ['afade=t=in:st=0:d=0.03'] if seg['fade_in'] else []
        if seg['fade_out'] and d > 0.06:
            af.append(f"afade=t=out:st={max(0, d - 0.03):.3f}:d=0.03")
        rodar(['ffmpeg', '-y', '-hide_banner', '-nostats', '-loglevel', 'error', '-ss', f"{a:.3f}", '-t', f"{d:.3f}", '-i', entrada,
               '-filter_complex', f"[0:v]fps=30,split[x][y];"
               f"[x]scale={wj}:{hj}:flags=bicubic,pad={wj}:{hj + R}:0:{R}:black,crop={J['w']}:{J['h'] + R}:x='{xj}':y='{yj}',setsar=1[j];"
               f"[y]scale={wc}:{hc}:flags=bicubic,crop={L.LARGURA}:{L.ALTURA}:x='{xc}':y='{yc}',setsar=1[c]",
               '-map', '[j]', '-t', f"{d:.3f}", *enc, jo, '-map', '[c]', '-t', f"{d:.3f}", *enc, co,
               '-map', '0:a', '-t', f"{d:.3f}", *(['-af', ','.join(af)] if af else []), '-ar', '48000', '-ac', '2', ao])
        listas['j'].append(jo); listas['c'].append(co); listas['a'].append(ao)
        inicios.append(quadros); quadros += max(1, int(round(d * 30)))
    janela, close, voz = os.path.join(tmp, 'janela.mp4'), os.path.join(tmp, 'close.mp4'), os.path.join(tmp, 'voz.wav')
    for chave, destino in (('j', janela), ('c', close), ('a', voz)):
        lst = os.path.join(tmp, f'lista_{chave}.txt')
        with open(lst, 'w') as fl:
            fl.write(''.join(f"file '{n}'\n" for n in listas[chave]))
        rodar(['ffmpeg', '-y', '-hide_banner', '-nostats', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', destino])
    # 2) peças fixas + máscara da cabeça (só com rosto achado: sem rosto não há o que tirar da janela)
    fundo = _fundo_destrava(os.path.join(tmp, 'fundo.png'))
    m_jan = _pgm_arredondado(os.path.join(tmp, 'm_jan.pgm'), J['w'], J['h'], J['raio'])
    cabeca = mascara_cabeca(janela, os.path.join(tmp, 'cabeca.mkv'), J['w'], J['h'] + R, R, inicios, avisos) if (trilha and R) else None
    ass_g = os.path.join(tmp, 'graficos.ass'); ass_f = os.path.join(tmp, 'final.ass')
    open(ass_g, 'w', encoding='utf-8').write(D.ass_graficos(blocos))
    open(ass_f, 'w', encoding='utf-8').write(D.ass_final(blocos, palavras_rm, dur))
    if os.environ.get('REELS_DEPURAR'):
        shutil.copy(ass_g, os.path.join(os.path.dirname(saida), 'graficos.ass'))
    # 3) composição única, em fluxo (sem divisões que seguram o vídeo na memória). Janela e máscara andam quadro a quadro
    #    (setpts=N/30: a máscara foi feita lendo a janela na mesma ordem).
    entradas = ['-loop', '1', '-framerate', '30', '-t', f"{dur:.3f}", '-i', fundo, '-i', janela, '-i', close,
                '-loop', '1', '-framerate', '30', '-t', f"{dur:.3f}", '-i', m_jan]
    if cabeca:
        entradas += ['-i', cabeca]
    g = [f"[0:v]format=yuv420p[bg]",
         f"[1:v]setpts=N/(30*TB){',split[je][jt];[je]' if cabeca else ','}crop={J['w']}:{J['h']}:0:{R},format=yuva420p[jv];"
         f"[3:v]format=gray[jm];[jv][jm]alphamerge[jr]",
         f"[bg][jr]overlay={J['x']}:{J['y']}:shortest=0:eof_action=pass[v0]"]
    atual = '[v0]'; k = 5 if cabeca else 4; n = 0
    for br in brolls:
        b = br['bloco']; d0 = b['t1'] - b['t0']
        if b['tipo'] in ('imagem', 'titulo'):
            q = D.INSET_IMAGEM if b['tipo'] == 'imagem' else D.INSET_TITULO
            mk = _pgm_arredondado(os.path.join(tmp, f'm_ins{n}.pgm'), q['w'], q['h'], q['raio'])
            entradas += ['-i', br['arquivo'], '-loop', '1', '-framerate', '30', '-t', f"{d0:.3f}", '-i', mk]
            g.append(f"[{k}:v]trim=duration={d0:.3f},setpts=PTS-STARTPTS,fps=30,{_zoom_lento(q['w'], q['h'], d0)},"
                     f"format=yuva420p[bv{n}];[{k + 1}:v]format=gray[bm{n}];[bv{n}][bm{n}]alphamerge,setpts=PTS+{b['t0']:.3f}/TB[bi{n}]")
            g.append(f"{atual}[bi{n}]overlay={q['x']}:{q['y']}:eof_action=pass:enable='between(t,{b['t0']:.3f},{b['t1']:.3f})'[v{n + 1}]")
            k += 2
        else:   # broll em tela cheia: entra depois dos gráficos (abaixo)
            continue
        atual = f"[v{n + 1}]"; n += 1
    g.append(f"{atual}ass=filename='{esc(ass_g)}':fontsdir='{fontes_esc}'[vg]")
    atual = '[vg]'
    # cabeça saindo da janela: a faixa de cima do vídeo estendido, só onde está a pessoa, por cima dos gráficos e da borda
    if cabeca:
        g.append(f"[jt]crop={J['w']}:{R}:0:0,format=yuva420p[ct];[4:v]setpts=N/(30*TB),format=gray[cm];[ct][cm]alphamerge[cb];"
                 f"{atual}[cb]overlay={J['x']}:{J['y'] - R}:eof_action=pass[vk]")
        atual = '[vk]'
    # close em tela cheia nos blocos 'rosto'
    rostos = [b for b in blocos if b['layout'] == 'rosto']
    if rostos:
        cond = '+'.join(f"between(t,{b['t0']:.3f},{b['t1'] - 0.001:.3f})" for b in rostos)
        g.append(f"[2:v]format=yuv420p[cl];{atual}[cl]overlay=0:0:eof_action=pass:enable='{cond}'[vc]"); atual = '[vc]'
    else:
        g.append("[2:v]nullsink")
    m = 0
    for br in brolls:
        b = br['bloco']
        if b['tipo'] != 'broll':
            continue
        d0 = b['t1'] - b['t0']
        entradas += ['-i', br['arquivo']]
        g.append(f"[{k}:v]trim=duration={d0:.3f},setpts=PTS-STARTPTS,fps=30,{_zoom_lento(L.LARGURA, L.ALTURA, d0, 0.06)},"
                 f"eq=brightness=-0.06,format=yuv420p,setpts=PTS+{b['t0']:.3f}/TB[fb{m}]")
        g.append(f"{atual}[fb{m}]overlay=0:0:eof_action=pass:enable='between(t,{b['t0']:.3f},{b['t1']:.3f})'[vb{m}]")
        atual = f"[vb{m}]"; k += 1; m += 1
    g.append(f"{atual}ass=filename='{esc(ass_f)}':fontsdir='{fontes_esc}',format=yuv420p[vout]")
    sem_video = os.path.join(tmp, 'mudo.mp4')
    rodar(['ffmpeg', '-y', '-hide_banner', '-nostats', '-loglevel', 'error', *entradas, '-filter_complex', ';'.join(g),
           '-map', '[vout]', '-t', f"{dur:.3f}", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', '30', '-pix_fmt', 'yuv420p', sem_video])
    # 4) áudio: voz tratada (VOZ_FILTRO + loudnorm) + efeitos (whoosh/pop/impacto) + trilha opcional que abaixa sozinha
    #    quando há fala (sidechain) + limitador no fim (a soma não estoura)
    ent = ['-i', sem_video, '-i', voz]
    partes = [f"[1:a]{VOZ_FILTRO}{filtro_loudnorm(None)}[vz0]"]
    mistura = ['[vz]']
    if musica:
        partes[0] = partes[0].replace('[vz0]', ',asplit=2[vz][lado]')
    else:
        partes[0] = partes[0].replace('[vz0]', '[vz]')
    k = 2
    if whoosh:
        ent += ['-i', whoosh]
        partes.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo[fx]"); mistura.append('[fx]'); k += 1
    if musica:
        ent += ['-i', musica]
        partes.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=45,lowpass=f=2600,"
                      f"afade=t=in:st=0:d=1.2,afade=t=out:st={max(0.0, dur - 1.8):.3f}:d=1.8,loudnorm=I=-31:TP=-9:LRA=7,aresample=48000[mu0]")
        partes.append("[mu0][lado]sidechaincompress=threshold=0.03:ratio=6:attack=25:release=450:makeup=1[mu]"); mistura.append('[mu]')
    if len(mistura) > 1:
        partes.append(''.join(mistura) + f"amix=inputs={len(mistura)}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=disabled[aout]")
    else:
        partes.append("[vz]anull[aout]")
    rodar(['ffmpeg', '-y', '-hide_banner', '-nostats', '-loglevel', 'error', *ent, '-filter_complex', ';'.join(partes), '-map', '0:v', '-map', '[aout]',
           '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', '-shortest', saida])


def medir_loudness(entrada, segmentos, centros, sonda, tmp):
    """Passo 1 do loudnorm: mede o áudio JÁ cortado (sem renderizar vídeo). Devolve o dict medido ou None."""
    filtros, _, ac = _filtros_segmentos(segmentos, centros, sonda, com_video=False)
    filtros.append(f"{ac}loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json[aout]")
    err = rodar(['ffmpeg', '-hide_banner', '-nostats', '-i', entrada, '-filter_complex', ';'.join(filtros),
                 '-map', '[aout]', '-f', 'null', '-'])
    m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', err, re.S)
    if not m:
        return None
    med = json.loads(m.group(0))
    try:
        if float(med['input_i']) < -70:   # áudio praticamente mudo: o modo linear não ajuda
            return None
    except (KeyError, ValueError):
        return None
    return med


def filtro_loudnorm(medido):
    base = 'loudnorm=I=-14:TP=-1.5:LRA=11'
    if medido:
        base += (f":measured_I={medido['input_i']}:measured_TP={medido['input_tp']}:measured_LRA={medido['input_lra']}"
                 f":measured_thresh={medido['input_thresh']}:offset={medido['target_offset']}:linear=true")
    return base + ',aresample=48000'


def renderizar(entrada, saida, segmentos, centros, sonda, ass, brolls, medido, musica=None):
    """Render único: trechos → crop/punch-in → b-roll → legendas → x264; áudio com loudnorm (2º passo) e AAC."""
    filtros, vc, ac = _filtros_segmentos(segmentos, centros, sonda)
    entradas = ['-i', entrada]
    filtros.append(f"{vc}fps=30,format=yuv420p[vb0]")
    atual = '[vb0]'
    for k, b in enumerate(brolls):
        entradas += ['-i', b['arquivo']]
        d, s = b['duracao'], b['inicio']
        filtros.append(f"[{k + 1}:v]trim=duration={d:.3f},setpts=PTS-STARTPTS,fps=30,"
                       f"scale={L.LARGURA}:{L.ALTURA}:force_original_aspect_ratio=increase,crop={L.LARGURA}:{L.ALTURA},format=yuva420p,"
                       f"fade=t=in:st=0:d=0.15:alpha=1,fade=t=out:st={max(0, d - 0.15):.3f}:d=0.15:alpha=1,setpts=PTS+{s:.3f}/TB[b{k}]")
        filtros.append(f"{atual}[b{k}]overlay=0:0:eof_action=pass:enable='between(t,{s:.3f},{s + d:.3f})'[vb{k + 1}]")
        atual = f"[vb{k + 1}]"
    ass_esc = ass.replace('\\', '/').replace(':', '\\:').replace("'", "\\'")
    fontes_esc = FONTES.replace('\\', '/').replace(':', '\\:').replace("'", "\\'")
    filtros.append(f"{atual}ass=filename='{ass_esc}':fontsdir='{fontes_esc}'[vout]")
    if musica:
        entradas += ['-stream_loop', '-1', '-i', musica]
        filtros.append(f"[{len(brolls) + 1}:a]volume=0.08,aresample=48000[mus]")
        filtros.append(f"{ac}{filtro_loudnorm(medido)}[voz];[voz][mus]amix=inputs=2:duration=first:dropout_transition=0[aout]")
    else:
        filtros.append(f"{ac}{filtro_loudnorm(medido)}[aout]")
    cmd = ['ffmpeg', '-y', '-hide_banner', '-nostats', '-loglevel', 'error'] + entradas + [
        '-filter_complex', ';'.join(filtros), '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', '30', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', '-shortest', saida]
    rodar(cmd)


def poster(final, destino):
    rodar(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '1', '-i', final, '-frames:v', '1', '-q:v', '2', destino])


# ----------------------------------------------------------------------------------------------------------------------
# Pipeline
# ----------------------------------------------------------------------------------------------------------------------
def editar(entrada, pasta, estilo='hormozi', roteiro='', opcoes=None, modelo=None, titulo=''):
    opcoes = {**OPCOES_PADRAO, **(opcoes or {})}
    if estilo not in L.PRESETS:
        raise ValueError(f"estilo inválido: {estilo} (use {', '.join(L.PRESETS)})")
    os.makedirs(pasta, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='reels_')
    avisos = []
    cron = Cronometro()
    try:
        # 1. sonda + áudio
        cron.etapa('sonda_e_audio')
        sonda = sondar(entrada)
        log(f"fonte {sonda['largura']}x{sonda['altura']} {sonda['duracao']:.1f}s rot={sonda['rotacao']} áudio={sonda['tem_audio']}")
        if not sonda['tem_audio']:
            avisos.append('vídeo sem áudio: sem transcrição nem cortes por fala')
        wav = os.path.join(tmp, 'audio.wav')
        extrair_audio(entrada, wav, sonda['tem_audio'])
        silencios = detectar_silencios(wav) if (sonda['tem_audio'] and opcoes['remover_pausas']) else []

        # 2. transcrição
        cron.etapa('transcricao')
        tr = transcrever(wav, sonda['duracao'], roteiro, modelo) if sonda['tem_audio'] else {'modelo': None, 'palavras': [], 'frases': []}
        palavras = tr['palavras']
        log(f"{len(tr['frases'])} frases, {len(palavras)} palavras")
        if sonda['tem_audio'] and not palavras:
            avisos.append('nenhuma palavra reconhecida: legendas vazias')
        # legenda conferida com o roteiro do teleprompter: grafia certa, trecho que o Whisper trocou e palavra inventada no fim
        if roteiro and palavras:
            palavras, conf = L.alinhar_com_roteiro(palavras, roteiro)
            tr['conferencia_roteiro'] = conf
            for c in conf['corrigidas']:
                log(f"legenda corrigida pelo roteiro: “{c['de']}” → “{c['para']}”")
            for r in conf['removidas']:
                log(f"palavra tirada da legenda: “{r['w']}” ({r['motivo']})")
        json.dump(tr, open(os.path.join(pasta, 'transcricao.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        falta = L.roteiro_incompleto(roteiro, palavras)
        if falta:
            avisos.append(f"o vídeo termina antes do fim do roteiro: a fala para em “{falta['parou_em']}” e falta “{falta['faltou']}…”. "
                          "A gravação foi interrompida no celular (ex.: o iPhone conectou no Bluetooth/CarPlay do carro). Grave o final de novo.")

        # 3. cortes
        cron.etapa('cortes')
        trechos, detalhes = L.montar_trechos(sonda['duracao'], silencios, palavras,
                                             remover_pausas=opcoes['remover_pausas'], remover_muletas=opcoes['remover_muletas'],
                                             remover_retomadas=opcoes['remover_muletas'])
        dur_final = L.duracao_total(trechos)
        log(f"{len(trechos)} trechos mantidos, {dur_final:.1f}s de {sonda['duracao']:.1f}s; {detalhes}")
        palavras_rm = L.remapear_tempos(palavras, trechos, detalhes.get('cortes_palavras', ()))
        encaixadas = sum(1 for p in palavras_rm if p.get('encaixada'))
        if encaixadas:
            log(f"{encaixadas} palavra(s) curta(s) encaixada(s) na borda do trecho vizinho")
        frases = L.frases_remapeadas(palavras_rm)
        inicios_frases = [f['t0'] for f in tr['frases']]
        segmentos = L.planejar_segmentos(trechos, inicios_frases, punch_in=bool(opcoes['punch_in']))

        # 4. enquadramento
        cron.etapa('enquadramento')
        horizontal = sonda['largura'] > sonda['altura']
        amostras, cru = [], []
        if horizontal or opcoes.get('montagem', True):   # formato destrava/montagem: a janela e o close seguem o rosto
            try:
                cru = detectar_rostos(entrada, sonda)
                amostras = amostrar_rostos(entrada, sonda, cru=cru)
            except Exception as e:
                avisos.append(f'detecção de rosto falhou: {str(e)[:120]}')
            if not amostras:
                avisos.append('nenhum rosto detectado: enquadramento central')
        centros = L.centro_por_segmento(amostras, segmentos, padrao=0.5) if amostras else [(0.5, 0.5)] * len(segmentos)
        # formato destrava: trilha do rosto quadro a quadro (o recorte acompanha o rosto) e o tamanho típico do rosto
        trilha = L.trilha_rosto(cru) if amostras else None
        alturas = sorted(c[3] for c in cru if c[3])
        altura_rosto = alturas[len(alturas) // 2] if alturas else None

        # 5. montagem: formato 'destrava' (padrão, referência do Pedro de 14/11) ou a montagem v2; sem IA
        montagem = bool(opcoes.get('montagem', True)) and bool(palavras_rm)
        formato = opcoes.get('formato') or 'destrava'
        destrava = montagem and formato == 'destrava'
        blocos = []
        plano = None
        if destrava:
            por_seg = {}
            for p in palavras_rm:
                f = por_seg.setdefault(p.get('seg', 0), {'n0': p['n0'], 'n1': p['n1'], 'palavras': []})
                f['n1'] = p['n1']; f['palavras'].append({'n0': p['n0'], 'n1': p['n1'], 'w': p['w'].strip()})
            frases_d = D.frases_por_pontuacao([{'n0': p['n0'], 'n1': p['n1'], 'w': p['w'].strip()} for p in palavras_rm])
            chave_tmp = os.environ.get('PEXELS_API_KEY', '').strip() or os.environ.get('BROLL_URL', '') or os.environ.get('REELS_BROLL_LOCAL', '')
            titulo_video = titulo if titulo and not re.match(r'^(v[ií]deo|grava[cç][aã]o) ', titulo, re.I) else ''
            plano = pedir_plano(frases_d, titulo_video, avisos)
            blocos = D.planejar(frases_d, dur_final, titulo_video, broll=bool(opcoes.get('broll')) and bool(chave_tmp), plano=plano)
            log('destrava: ' + ' | '.join(f"{b['t0']:.1f}-{b['t1']:.1f} {b['layout']}/{b['tipo']}:{b.get('cabeca') or b.get('chave', '')}" for b in blocos))
        elif montagem:
            por_seg = {}
            for p in palavras_rm:
                f = por_seg.setdefault(p.get('seg', 0), {'n0': p['n0'], 'n1': p['n1'], 'palavras': []})
                f['n1'] = p['n1']; f['palavras'].append({'n0': p['n0'], 'w': p['w'].strip()})
            frases_m = [dict(f, texto=' '.join(x['w'] for x in f['palavras'])) for f in sorted(por_seg.values(), key=lambda f: f['n0'])]
            blocos = M.planejar_blocos(frases_m, dur_final)
            log('montagem: ' + ' | '.join(f"{b['t0']:.1f}-{b['t1']:.1f} {b['layout']}:{b['chave']}" for b in blocos))

        # 6. b-roll (Pexels): na montagem entra no quadro de cima de metade das telas divididas
        cron.etapa('broll')
        brolls = []; brolls_topo = []
        chave_px = os.environ.get('PEXELS_API_KEY', '').strip() or ('__app__' if os.environ.get('BROLL_URL') else '') or ('__local__' if os.environ.get('REELS_BROLL_LOCAL') else '')
        brolls_destrava = []
        if destrava:
            pedidos = D.precisa_broll(blocos) if (opcoes.get('broll') and chave_px) else []
            # busca da imagem: a do plano visual (inglês, pelo sentido da frase); sem plano, a palavra-chave traduzida
            pontos = [{'inicio': b['t0'], 'duracao': round(b['t1'] - b['t0'], 3), 'texto': b['texto'],
                       'consulta': b.get('busca') or L.palavra_chave(b.get('titulo') if b['tipo'] == 'titulo' else b['texto']), 'bloco': b} for b in pedidos]
            if os.environ.get('REELS_BROLL_LOCAL') and pontos:   # teste local: um arquivo no lugar do banco de imagens
                baixados = [dict(pt, arquivo=os.environ['REELS_BROLL_LOCAL']) for pt in pontos]
            else:
                baixados = baixar_broll(pontos, tmp, chave_px, avisos) if pontos else []
            ok = {id(r['bloco']) for r in baixados}
            for b in blocos:
                if b['tipo'] in ('titulo', 'imagem', 'broll') and id(b) not in ok:
                    D.sem_broll(b)
            brolls_destrava = [{'arquivo': r['arquivo'], 'bloco': r['bloco'], 'consulta': r['consulta'], 'pexels_id': r.get('pexels_id')} for r in baixados]
        elif opcoes.get('broll'):
            if not chave_px:
                avisos.append('b-roll pulado: sem PEXELS_API_KEY')
            elif montagem:
                divididas = [b for b in blocos if b['layout'] == 'dividida']
                pontos = [{'inicio': b['t0'], 'duracao': round(b['t1'] - b['t0'], 3), 'texto': b['texto'], 'consulta': L.palavra_chave(b['texto']), 'bloco': b}
                          for b in divididas[1::2]]
                for r in (baixar_broll(pontos, tmp, chave_px, avisos) if pontos else []):
                    r['bloco']['broll'] = True
                    brolls_topo.append({'arquivo': r['arquivo'], 't0': r['bloco']['t0'], 't1': r['bloco']['t1'], 'consulta': r['consulta'], 'pexels_id': r.get('pexels_id')})
            else:
                pontos = L.pontos_broll(frases, dur_final)
                brolls = baixar_broll(pontos, tmp, chave_px, avisos) if pontos else []
        musica = None
        if opcoes.get('musica'):
            # trilha gerada aqui (sem direitos de terceiros); uma faixa CC0 em tools/reels/musica/ vale só no formato simples
            faixas = sorted(f for f in (os.listdir(PASTA_MUSICA) if os.path.isdir(PASTA_MUSICA) else []) if f.lower().endswith(('.mp3', '.ogg', '.wav', '.m4a')))
            musica = os.path.join(PASTA_MUSICA, faixas[0]) if (faixas and not destrava) else trilha_musical(os.path.join(tmp, 'musica.wav'), dur_final)

        # 7. legendas (mudam de lugar conforme o layout) e quadros animados
        cron.etapa('legendas')
        ass = os.path.join(pasta, 'legendas.ass')
        open(ass, 'w', encoding='utf-8').write(D.ass_final(blocos, palavras_rm, dur_final) if destrava else L.gerar_ass(palavras_rm, estilo, posicao=M.posicao_legenda(blocos) if montagem else None))
        if montagem and not destrava:
            ass_topo = os.path.join(tmp, 'quadros_topo.ass'); ass_cheio = os.path.join(tmp, 'quadros_cheio.ass')
            open(ass_topo, 'w', encoding='utf-8').write(M.ass_graficos(blocos, 'topo'))
            open(ass_cheio, 'w', encoding='utf-8').write(M.ass_graficos(blocos, 'cheio'))

        # 9a. loudness (passo 1)
        cron.etapa('loudnorm_medida')
        medido = None
        if sonda['tem_audio']:
            try:
                medido = medir_loudness(entrada, segmentos, centros, sonda, tmp)
            except Exception as e:
                avisos.append(f'loudnorm 1º passo falhou (segue em 1 passo): {str(e)[:120]}')

        # 8. render
        cron.etapa('render')
        final = os.path.join(pasta, 'final.mp4')
        if not sonda['tem_audio']:
            # cria uma faixa muda para o grafo de áudio não quebrar
            mudo = os.path.join(tmp, 'mudo.mp4')
            rodar(['ffmpeg', '-y', '-loglevel', 'error', '-i', entrada, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
                   '-shortest', '-c:v', 'copy', '-c:a', 'aac', mudo])
            entrada = mudo
        if destrava:
            sons = trilha_efeitos(os.path.join(tmp, 'efeitos.wav'), D.efeitos(blocos), dur_final) if opcoes.get('sons', True) else None
            renderizar_destrava(entrada, final, segmentos, sonda, blocos, palavras_rm, dur_final, tmp, brolls_destrava, sons,
                                trilha=trilha, altura_rosto=altura_rosto, avisos=avisos, musica=musica)
            brolls = [{'inicio': r['bloco']['t0'], 'duracao': round(r['bloco']['t1'] - r['bloco']['t0'], 2), 'consulta': r['consulta'], 'pexels_id': r.get('pexels_id')} for r in brolls_destrava]
        elif montagem:
            whoosh = trilha_whoosh(os.path.join(tmp, 'whoosh.wav'), M.trocas(blocos), dur_final) if opcoes.get('sons', True) else None
            renderizar_montagem(entrada, final, segmentos, centros, sonda, ass, blocos, ass_topo, ass_cheio, medido, whoosh, brolls_topo)
            brolls = [{'inicio': b['t0'], 'duracao': round(b['t1'] - b['t0'], 2), 'consulta': b['consulta'], 'pexels_id': b.get('pexels_id')} for b in brolls_topo]
        else:
            renderizar(entrada, final, segmentos, centros, sonda, ass, brolls, medido, musica)

        # 10. poster + resultado
        cron.etapa('poster')
        poster(final, os.path.join(pasta, 'poster.jpg'))
        cron.fechar()
        fim = sondar(final)
        resultado = {
            'duracao_s': round(fim['duracao'], 2), 'largura': fim['largura'], 'altura': fim['altura'],
            'cortes': detalhes['cortes'], 'palavras': len(palavras_rm), 'estilo': estilo, 'opcoes': opcoes,
            'transcricao': {'texto': ' '.join(f['texto'] for f in frases), 'frases': frases},
            'detalhes_cortes': {k: v for k, v in detalhes.items() if k != 'cortes_palavras'}, 'duracao_original_s': round(sonda['duracao'], 2),
            'broll': [{'inicio': b['inicio'], 'duracao': b['duracao'], 'consulta': b['consulta'], 'pexels_id': b.get('pexels_id')} for b in brolls],
            'modelo_whisper': tr.get('modelo'), 'tempos_s': cron.tempos, 'avisos': avisos,
            'montagem': [{'t0': b['t0'], 't1': b['t1'], 'layout': b['layout'], 'tipo': b.get('tipo'), 'chave': b.get('cabeca') or b.get('chave'), 'icone': b.get('icone'), 'busca': b.get('busca')} for b in blocos],
            'formato': 'destrava' if destrava else ('montagem' if montagem else 'simples'),
            'plano_visual': bool(plano),
            'legenda_conferida': {'corrigidas': tr.get('conferencia_roteiro', {}).get('corrigidas', []),
                                  'removidas': tr.get('conferencia_roteiro', {}).get('removidas', [])} if tr.get('conferencia_roteiro') else None,
        }
        json.dump(resultado, open(os.path.join(pasta, 'resultado.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        log(f"pronto: {final} ({resultado['duracao_s']}s, {resultado['palavras']} palavras, {resultado['cortes']} cortes)")
        return resultado
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description='Edita um vídeo falado em reel 9:16 com legendas.')
    ap.add_argument('entrada')
    ap.add_argument('saida')
    ap.add_argument('--estilo', default='hormozi', choices=sorted(L.PRESETS))
    ap.add_argument('--roteiro', help='arquivo .txt com o texto lido (ajuda o Whisper)')
    ap.add_argument('--opcoes', default='{}', help='JSON: broll, punch_in, remover_pausas, remover_muletas, musica')
    ap.add_argument('--modelo', help='força o modelo do Whisper (tiny/base/small/medium)')
    ap.add_argument('--titulo', default='', help='título do vídeo (vira o título animado do formato destrava)')
    a = ap.parse_args()
    roteiro = open(a.roteiro, encoding='utf-8').read() if a.roteiro and os.path.exists(a.roteiro) else ''
    try:
        opcoes = json.loads(a.opcoes or '{}')
    except json.JSONDecodeError as e:
        sys.exit(f"--opcoes não é JSON válido: {e}")
    r = editar(a.entrada, a.saida, a.estilo, roteiro, opcoes, a.modelo, a.titulo)
    print(json.dumps({'duracao_s': r['duracao_s'], 'cortes': r['cortes'], 'palavras': r['palavras'], 'avisos': r['avisos'], 'tempos_s': r['tempos_s']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
