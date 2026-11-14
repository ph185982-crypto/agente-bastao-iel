# Modelos usados pelo editor de reels

| Arquivo | Para quê | Origem | Licença |
|---|---|---|---|
| `selfie_segmenter.tflite` (250 KB) | Recorte da pessoa (fundo × pessoa) para a cabeça "sair" da janela no formato Destrava | MediaPipe Image Segmenter — Selfie segmenter (float16), `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite` | Apache License 2.0 (Google) |

Roda em CPU com o LiteRT (`ai-edge-litert`), ~6 ms por quadro: entrada 256x256 RGB em [0,1], saída 256x256 com a confiança de "pessoa".
Nada é baixado em tempo de execução.
