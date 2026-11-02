# Cortes para Reels (rodam no servidor ou na máquina, sem custo)

1. `python3 tools/reels/transcrever.py video.mp4 transcricao.json --inicio 12:30 --fim 35:00`
   Whisper (faster-whisper) com palavras e tempos. Use `--inicio/--fim` para transcrever só a participação do Pedro.
2. Escolher os trechos (30 a 60 s, começando por um gancho) e escrever `cortes.json`:
   `[{"id":"c1","inicio":"31:12.5","fim":"31:58","foco":0.5,"modo":"crop"}]`
3. `python3 tools/reels/cortar.py video.mp4 transcricao.json cortes.json saida/`
   Tira pausas maiores que 0,4 s, enquadra em 9:16 (1080x1920), legenda palavra a palavra (Anton, branco, palavra ativa amarela) e normaliza o áudio.

Nada é publicado daqui: os MP4 vão para aprovação do Pedro antes de qualquer envio ao Instagram.
