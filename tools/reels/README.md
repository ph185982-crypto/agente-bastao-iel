# Editor automático de reels (`tools/reels`)

Transforma um vídeo falado (celular, teleprompter, corte de live) em um reel 9:16 pronto para aprovação:
1080x1920, 30 fps, pausas e muletas cortadas, rosto enquadrado, punch-in por frase, legendas palavra a palavra,
áudio em −14 LUFS. Tudo gratuito e de código aberto (ffmpeg + libass, faster-whisper, OpenCV), em CPU.
Contrato: `docs/VIDEOS_E_RECICLAGEM_SPEC.md` → "Worker de edição". Nada é publicado daqui: o resultado vai para a fila de aprovação do app.

## Arquivos
| Arquivo | Para quê |
|---|---|
| `editar.py` | Pipeline completo (CLI). Escreve `final.mp4`, `poster.jpg`, `legendas.ass`, `transcricao.json`, `resultado.json`. |
| `lib_reels.py` | Funções puras testáveis: cortes (silêncio, muletas, repetições, retomadas), remapeamento de tempos, punch-in, suavização do rosto, blocos de legenda, geração do ASS, pontos de b-roll. |
| `lib_reels.test.py` | `python3 tools/reels/lib_reels.test.py` |
| `teste_e2e.py` | Teste local de ponta a ponta com vídeo sintético (testsrc2 + fala gTTS) nos 3 presets. |
| `worker.js` / `worker.test.js` | Worker do GitHub Actions: fila → download → `editar.py` → Blob (client token) → resultado. `node --test tools/reels/worker.test.js` |
| `requirements.txt` | faster-whisper, opencv-python-headless, numpy (versões fixas). |
| `transcrever.py`, `cortar.py` | Ferramentas antigas de recorte manual de lives (continuam funcionando). |
| `musica/` | (vazia) só faixas CC0 commitadas aqui podem virar trilha; sem faixa, `musica` fica desligada. |

## Uso
```bash
python3 -m pip install -r tools/reels/requirements.txt      # ffmpeg precisa estar instalado (apt install ffmpeg)
python3 tools/reels/editar.py entrada.mp4 saida/ --estilo hormozi --roteiro roteiro.txt \
  --opcoes '{"broll":true,"punch_in":true,"remover_pausas":true,"remover_muletas":true,"musica":false}'
```
- `--estilo`: `hormozi` (Poppins ExtraBold caixa-alta, palavra ativa amarela), `beast` (Anton amarelo com contorno grosso), `caixa` (Inter Bold sobre caixa preta).
- `--roteiro`: texto que o Pedro leu; vira `initial_prompt` do Whisper (até 200 palavras).
- `--modelo`: força o modelo do Whisper (padrão: `medium` se o vídeo tem ≤ 90 s, senão `small`; também via `REELS_MODELO`).
- B-roll só com `PEXELS_API_KEY` no ambiente (Pexels Videos, retrato ≥ 1080, 1 clipe a cada ~18 s, nunca nos 3 primeiros segundos).
- Fontes: `backend/assets/*.ttf` via `fontsdir` do libass; nada é baixado.

## Como o render funciona
Um único `ffmpeg`: cada trecho mantido vira `trim/atrim` com crop fixo (rosto) e zoom (punch-in) e tudo é
`concat`-enado; `afade` de 10 ms só nas emendas reais; b-roll por `overlay` com fade de 150 ms; legendas pelo filtro `ass`;
`libx264 -preset veryfast -crf 20`, AAC 160k. O `loudnorm` é em 2 passos: o 1º mede só o áudio já cortado (rápido), o 2º entra no render.

## Teste local
```bash
python3 tools/reels/lib_reels.test.py
node --test tools/reels/worker.test.js
python3 tools/reels/teste_e2e.py /tmp/reels-e2e --modelo small    # gera vídeo sintético e roda os 3 presets
```
