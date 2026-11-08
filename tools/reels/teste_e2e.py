#!/usr/bin/env python3
"""Teste de ponta a ponta local do editor de reels, sem depender de vídeo real.

Gera um vídeo sintético (testsrc2 1280x720, 40 s, com um rosto de avatar deslocado para a direita) com fala em
português (gTTS; sem rede: espeak-ng; sem ele: tom com pausas e o teste fica PARCIAL), roda o editar.py nos
3 presets e confere: 1080x1920, 30 fps, áudio presente, duração menor que a entrada, ASS com palavras.
Também salva 2 quadros por preset para inspeção visual.

uso: python3 tools/reels/teste_e2e.py [pasta_saida] [--modelo small] [--so-video]"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, '..', '..'))
AVATAR = os.path.join(RAIZ, 'backend', 'assets', 'avatar.jpg')

# Fala com muletas isoladas, repetição e retomada, para exercitar os cortes
FRASES = [
    ('O governo gastou mais do que arrecadou pelo décimo ano seguido.', 1.3),
    ('é', 0.9),
    ('E a conta sempre chega para quem trabalha.', 1.6),
    ('A economia brasileira precisa', 0.7),
    ('A economia brasileira precisa de liberdade para crescer.', 1.4),
    ('hã', 0.8),
    ('Menos imposto, menos burocracia e mais gente produzindo.', 1.2),
    ('Eu eu acho que o caminho é esse.', 1.5),
    ('Manda esse vídeo para um amigo que ainda acredita em almoço grátis.', 0.5),
]
ROTEIRO = ' '.join(f for f, _ in FRASES if len(f) > 3)


def rodar(cmd):
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:4])}… falhou: {r.stderr[-800:]}")
    return r


def sondar(arq):
    out = rodar(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', arq]).stdout
    return json.loads(out)


def gerar_fala(pasta):
    """Devolve (wav, modo) com as frases separadas por silêncios. modo: 'gtts' | 'espeak' | 'tom' (parcial)."""
    pedacos = []
    modo = None
    try:
        from gtts import gTTS
        for i, (texto, _) in enumerate(FRASES):
            mp3 = os.path.join(pasta, f'f{i}.mp3')
            gTTS(texto, lang='pt', tld='com.br').save(mp3)
            pedacos.append(mp3)
        modo = 'gtts'
    except Exception as e:
        print(f"gTTS indisponível ({str(e)[:80]}); tentando espeak-ng", file=sys.stderr)
        pedacos = []
        if shutil.which('espeak-ng'):
            for i, (texto, _) in enumerate(FRASES):
                wav = os.path.join(pasta, f'f{i}.wav')
                rodar(['espeak-ng', '-v', 'pt-br', '-s', '150', '-w', wav, texto])
                pedacos.append(wav)
            modo = 'espeak'
        else:
            for i, (texto, _) in enumerate(FRASES):
                wav = os.path.join(pasta, f'f{i}.wav')
                dur = max(0.4, len(texto) * 0.06)
                rodar(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', f'sine=frequency={220 + 30 * i}:duration={dur:.2f}', '-ac', '1', '-ar', '16000', wav])
                pedacos.append(wav)
            modo = 'tom'
    # concatena com silêncio depois de cada frase (apad) e 1 s de silêncio inicial
    entradas, filtros, rotulos = [], [], []
    for i, (arq, (_, pausa)) in enumerate(zip(pedacos, FRASES)):
        entradas += ['-i', arq]
        filtros.append(f"[{i}:a]aformat=sample_rates=44100:channel_layouts=mono,apad=pad_dur={pausa}[s{i}]")
        rotulos.append(f"[s{i}]")
    filtros.append(''.join(rotulos) + f"concat=n={len(pedacos)}:v=0:a=1,adelay=1000:all=1[a]")
    fala = os.path.join(pasta, 'fala.wav')
    rodar(['ffmpeg', '-y', '-loglevel', 'error'] + entradas + ['-filter_complex', ';'.join(filtros), '-map', '[a]', fala])
    return fala, modo


def gerar_video(pasta, fala, duracao=None):
    """testsrc2 1280x720 + avatar (rosto) à direita, deslizando devagar, com a fala como trilha.
    A duração acompanha a fala (≈40 s com a gTTS) para a última frase não ficar truncada."""
    saida = os.path.join(pasta, 'entrada.mp4')
    if duracao is None:
        duracao = round(float(sondar(fala)['format']['duration']) + 0.8, 1)
    rodar(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', f'testsrc2=size=1280x720:rate=30:duration={duracao}',
           '-loop', '1', '-i', AVATAR, '-i', fala,
           '-filter_complex', "[1:v]scale=360:360[av];[0:v][av]overlay=x='760+40*sin(t/6)':y=120:shortest=1[v]",
           '-map', '[v]', '-map', '2:a', '-t', str(duracao), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
           '-c:a', 'aac', '-b:a', '128k', '-shortest', saida])
    return saida


def conferir(pasta_estilo, dur_entrada, modo):
    final = os.path.join(pasta_estilo, 'final.mp4')
    erros = []
    info = sondar(final)
    v = next(s for s in info['streams'] if s['codec_type'] == 'video')
    a = next((s for s in info['streams'] if s['codec_type'] == 'audio'), None)
    dur = float(info['format']['duration'])
    if (v['width'], v['height']) != (1080, 1920):
        erros.append(f"tamanho {v['width']}x{v['height']} (esperado 1080x1920)")
    if v.get('r_frame_rate') not in ('30/1', '30000/1000'):
        erros.append(f"fps {v.get('r_frame_rate')} (esperado 30)")
    if not a:
        erros.append('sem áudio')
    if dur >= dur_entrada:
        erros.append(f"duração {dur:.1f}s não é menor que a entrada {dur_entrada:.1f}s")
    ass = open(os.path.join(pasta_estilo, 'legendas.ass'), encoding='utf-8').read()
    n_dialogos = ass.count('Dialogue:')
    if modo != 'tom' and n_dialogos < 10:
        erros.append(f"ASS com poucas palavras ({n_dialogos} eventos)")
    if not os.path.exists(os.path.join(pasta_estilo, 'poster.jpg')):
        erros.append('sem poster.jpg')
    res = json.load(open(os.path.join(pasta_estilo, 'resultado.json'), encoding='utf-8'))
    return erros, {'duracao': round(dur, 2), 'eventos_ass': n_dialogos, 'palavras': res['palavras'], 'cortes': res['cortes'],
                   'tempos_s': res['tempos_s'], 'avisos': res['avisos'], 'texto': res['transcricao']['texto'][:160]}


def quadros(pasta_estilo, instantes=(2.0, 12.0)):
    saidas = []
    for t in instantes:
        q = os.path.join(pasta_estilo, f'quadro_{int(t)}s.jpg')
        rodar(['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(t), '-i', os.path.join(pasta_estilo, 'final.mp4'), '-frames:v', '1', '-q:v', '3', q])
        saidas.append(q)
    return saidas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pasta', nargs='?', default=os.path.join(tempfile.gettempdir(), 'reels-e2e'))
    ap.add_argument('--modelo', default=None, help='modelo do Whisper (padrão: regra da spec)')
    ap.add_argument('--estilos', default='hormozi,beast,caixa')
    ap.add_argument('--so-video', action='store_true', help='só gera o vídeo sintético')
    a = ap.parse_args()
    os.makedirs(a.pasta, exist_ok=True)
    fala, modo = gerar_fala(a.pasta)
    print(f"fala gerada por: {modo}" + (' (TESTE PARCIAL: sem voz real, só tons)' if modo == 'tom' else ''))
    entrada = gerar_video(a.pasta, fala)
    open(os.path.join(a.pasta, 'roteiro.txt'), 'w', encoding='utf-8').write(ROTEIRO)
    dur_entrada = float(sondar(entrada)['format']['duration'])
    print(f"entrada: {entrada} ({dur_entrada:.1f}s)")
    if a.so_video:
        return
    falhas = 0
    for estilo in a.estilos.split(','):
        pasta = os.path.join(a.pasta, estilo)
        t0 = time.time()
        cmd = [sys.executable, os.path.join(AQUI, 'editar.py'), entrada, pasta, '--estilo', estilo, '--roteiro', os.path.join(a.pasta, 'roteiro.txt'),
               '--opcoes', json.dumps({'broll': True, 'punch_in': True, 'remover_pausas': True, 'remover_muletas': True, 'musica': False})]
        if a.modelo:
            cmd += ['--modelo', a.modelo]
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if r.returncode != 0:
            print(f"[{estilo}] FALHOU:\n{r.stderr[-2000:]}")
            falhas += 1
            continue
        erros, resumo = conferir(pasta, dur_entrada, modo)
        qs = quadros(pasta)
        print(f"[{estilo}] {time.time() - t0:.1f}s total | {json.dumps(resumo, ensure_ascii=False)}")
        print(f"[{estilo}] quadros: {', '.join(qs)}")
        if erros:
            falhas += 1
            print(f"[{estilo}] ERROS: {erros}")
        else:
            print(f"[{estilo}] OK")
    if modo == 'tom':
        print('RESULTADO: PARCIAL (sem voz sintética disponível; só o grafo de render foi validado)')
    sys.exit(1 if falhas else 0)


if __name__ == '__main__':
    main()
