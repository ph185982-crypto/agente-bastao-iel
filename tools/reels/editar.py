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
import lib_reels as L  # noqa: E402

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
    filtro = L.filtro_rotacao(rot)
    w, h = int(v['width']), int(v['height'])
    if filtro.startswith('transpose') and filtro.count('transpose') == 1:
        w, h = h, w
    dur = float(info.get('format', {}).get('duration') or v.get('duration') or 0)
    fps = 30.0
    if v.get('avg_frame_rate') and '/' in v['avg_frame_rate']:
        n, d = v['avg_frame_rate'].split('/')
        fps = float(n) / float(d) if float(d) else 30.0
    return {'largura': w, 'altura': h, 'duracao': dur, 'rotacao': rot, 'filtro_rotacao': filtro, 'tem_audio': a is not None, 'fps': fps}


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
def amostrar_rostos(entrada, sonda, fps_amostra=3, largura_amostra=480):
    """Lê o vídeo a 3 fps em tons de cinza (via ffmpeg, já com a rotação aplicada) e acha o maior rosto por quadro.
    Devolve [(t, cx, cy)] suavizados; cx/cy normalizados em 0..1."""
    import cv2
    import numpy as np
    w, h = sonda['largura'], sonda['altura']
    hs = int(round(largura_amostra * h / w / 2) * 2)
    vf = ','.join(x for x in [sonda['filtro_rotacao'], f'fps={fps_amostra}', f'scale={largura_amostra}:{hs}', 'format=gray'] if x)
    p = subprocess.run(['ffmpeg', '-loglevel', 'error', '-noautorotate', '-i', entrada, '-vf', vf, '-f', 'rawvideo', '-'],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    quadros = np.frombuffer(p.stdout, dtype=np.uint8)
    n = len(quadros) // (largura_amostra * hs)
    if n == 0:
        return []
    quadros = quadros[:n * largura_amostra * hs].reshape(n, hs, largura_amostra)
    casc = cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml'))
    cxs, cys = [], []
    for q in quadros:
        q = cv2.equalizeHist(np.ascontiguousarray(q))
        rostos = casc.detectMultiScale(q, scaleFactor=1.1, minNeighbors=5, minSize=(36, 36))
        if len(rostos):
            x, y, rw, rh = max(rostos, key=lambda r: r[2] * r[3])
            cxs.append((x + rw / 2) / largura_amostra)
            cys.append((y + rh / 2) / hs)
        else:
            cxs.append(None)
            cys.append(None)
    achados = sum(1 for c in cxs if c is not None)
    log(f"rosto achado em {achados}/{n} amostras")
    if achados == 0:
        return []
    scx = L.suavizar_centros(cxs)
    scy = L.suavizar_centros(cys, inicial=0.45)
    return [((i + 0.5) / fps_amostra, scx[i], scy[i]) for i in range(n)]


# ----------------------------------------------------------------------------------------------------------------------
# 6. B-roll (Pexels Videos)
# ----------------------------------------------------------------------------------------------------------------------
def baixar_broll(pontos, pasta, chave, avisos):
    """Para cada ponto, busca um vídeo retrato ≥ 1080 no Pexels e baixa. Devolve [{..., arquivo}] só dos que deram certo."""
    out = []
    usados = set()
    for k, pt in enumerate(pontos):
        try:
            q = urllib.parse.urlencode({'query': pt['consulta'], 'orientation': 'portrait', 'size': 'medium', 'per_page': 6})
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


def medir_loudness(entrada, segmentos, centros, sonda, tmp):
    """Passo 1 do loudnorm: mede o áudio JÁ cortado (sem renderizar vídeo). Devolve o dict medido ou None."""
    filtros, _, ac = _filtros_segmentos(segmentos, centros, sonda, com_video=False)
    filtros.append(f"{ac}loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json[aout]")
    err = rodar(['ffmpeg', '-hide_banner', '-nostats', '-noautorotate', '-i', entrada, '-filter_complex', ';'.join(filtros),
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
    entradas = ['-noautorotate', '-i', entrada]
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
def editar(entrada, pasta, estilo='hormozi', roteiro='', opcoes=None, modelo=None):
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
        json.dump(tr, open(os.path.join(pasta, 'transcricao.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

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
        amostras = []
        if horizontal:
            try:
                amostras = amostrar_rostos(entrada, sonda)
            except Exception as e:
                avisos.append(f'detecção de rosto falhou: {str(e)[:120]}')
            if not amostras:
                avisos.append('nenhum rosto detectado: enquadramento central')
        centros = L.centro_por_segmento(amostras, segmentos, padrao=0.5) if amostras else [(0.5, 0.5)] * len(segmentos)

        # 6. b-roll
        cron.etapa('broll')
        brolls = []
        if opcoes.get('broll'):
            chave = os.environ.get('PEXELS_API_KEY', '').strip()
            if not chave:
                avisos.append('b-roll pulado: sem PEXELS_API_KEY')
            else:
                pontos = L.pontos_broll(frases, dur_final)
                brolls = baixar_broll(pontos, tmp, chave, avisos) if pontos else []
        musica = None
        if opcoes.get('musica'):
            faixas = sorted(f for f in (os.listdir(PASTA_MUSICA) if os.path.isdir(PASTA_MUSICA) else []) if f.lower().endswith(('.mp3', '.ogg', '.wav', '.m4a')))
            if faixas:
                musica = os.path.join(PASTA_MUSICA, faixas[0])
            else:
                avisos.append('música pulada: nenhuma faixa CC0 em tools/reels/musica/')

        # 7. legendas
        cron.etapa('legendas')
        ass = os.path.join(pasta, 'legendas.ass')
        open(ass, 'w', encoding='utf-8').write(L.gerar_ass(palavras_rm, estilo))

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
            rodar(['ffmpeg', '-y', '-loglevel', 'error', '-noautorotate', '-i', entrada, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
                   '-shortest', '-c:v', 'copy', '-c:a', 'aac', mudo])
            entrada = mudo
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
    a = ap.parse_args()
    roteiro = open(a.roteiro, encoding='utf-8').read() if a.roteiro and os.path.exists(a.roteiro) else ''
    try:
        opcoes = json.loads(a.opcoes or '{}')
    except json.JSONDecodeError as e:
        sys.exit(f"--opcoes não é JSON válido: {e}")
    r = editar(a.entrada, a.saida, a.estilo, roteiro, opcoes, a.modelo)
    print(json.dumps({'duracao_s': r['duracao_s'], 'cortes': r['cortes'], 'palavras': r['palavras'], 'avisos': r['avisos'], 'tempos_s': r['tempos_s']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
