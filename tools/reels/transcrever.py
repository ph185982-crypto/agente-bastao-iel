#!/usr/bin/env python3
"""Transcreve um trecho de um vídeo com palavras e tempos (Whisper, grátis, roda no próprio servidor).
uso: python3 transcrever.py video.mp4 saida.json [--inicio 12:30] [--fim 35:00] [--modelo small]
Os tempos do JSON são do vídeo ORIGINAL (já somados ao --inicio)."""
import argparse, json, subprocess, tempfile, os, sys


def seg(t):
    if t is None: return None
    p = [float(x) for x in str(t).split(':')]
    s = 0.0
    for x in p: s = s * 60 + x
    return s


ap = argparse.ArgumentParser()
ap.add_argument('video'); ap.add_argument('saida')
ap.add_argument('--inicio'); ap.add_argument('--fim'); ap.add_argument('--modelo', default='small')
a = ap.parse_args()
ini = seg(a.inicio) or 0.0; fim = seg(a.fim)
wav = os.path.join(tempfile.mkdtemp(), 'a.wav')
cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(ini)] + (['-to', str(fim - ini)] if fim else []) + ['-i', a.video, '-vn', '-ac', '1', '-ar', '16000', wav]
# -ss antes de -i e -to relativo: a duração é fim-inicio
if fim: cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(ini), '-t', str(fim - ini), '-i', a.video, '-vn', '-ac', '1', '-ar', '16000', wav]
subprocess.run(cmd, check=True)
from faster_whisper import WhisperModel
m = WhisperModel(a.modelo, device='cpu', compute_type='int8')
segs, info = m.transcribe(wav, language='pt', word_timestamps=True, vad_filter=True, beam_size=5)
out = {'duracao': info.duration, 'inicio': ini, 'palavras': [], 'frases': []}
for s in segs:
    out['frases'].append({'t0': round(s.start + ini, 2), 't1': round(s.end + ini, 2), 'texto': s.text.strip()})
    for w in s.words or []:
        out['palavras'].append({'t0': round(w.start + ini, 2), 't1': round(w.end + ini, 2), 'w': w.word.strip(), 'p': round(w.probability, 2)})
json.dump(out, open(a.saida, 'w'), ensure_ascii=False, indent=1)
print(f"{len(out['frases'])} frases, {len(out['palavras'])} palavras -> {a.saida}", file=sys.stderr)
