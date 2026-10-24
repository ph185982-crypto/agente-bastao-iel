# Reels com a voz do Pedro (@pedro_destrava)

Gera Reels 9:16 (1080x1920, H.264/AAC, 30 fps) a partir de um roteiro `.md`, com a voz clonada,
legendas palavra a palavra e música de fundo opcional.

## Comandos

```bash
source reels-voz/bin/activate          # ou use reels-voz/bin/python direto

# 1) Só a voz
python gerar_voz.py "Texto a falar" -o saida.wav
python gerar_voz.py "Texto" -o x.wav --modelo xtts      # XTTS-v2: SÓ para comparar (não comercial)

# 2) Reel completo
python fazer_reels.py roteiros/rosetta.md               # -> saida/rosetta.mp4
```

Opções úteis do `fazer_reels.py`: `--refazer` (ignora o cache de voz), `--whisper medium` (tempos
mais precisos), `--fonte "Montserrat"` (fonte das legendas), `--device cuda` (se houver GPU).

## Pastas

| Pasta | Conteúdo |
|---|---|
| `amostras/minha-voz.wav` | referência da voz (24 kHz, mono, ~23 s, já limpa). Fora do git. |
| `roteiros/` | roteiros `.md` |
| `midia/` | imagens (.jpg/.png) ou clipes (.mp4/.mov) citados nos roteiros |
| `musica/` | trilhas citadas em `musica:` |
| `saida/` | vídeos finais (`.trabalho/` guarda voz e clipes intermediários) |
| `testes/` | comparações de voz |

Áudios, vídeos, mídia e o ambiente `reels-voz/` ficam fora do git (`.gitignore`).

## Formato do roteiro

```markdown
---
titulo: A pedra que decifrou o Egito
musica: arquivo.mp3        (opcional, fica em ./musica/)
---
## Cena 1
midia: foto.jpg            (opcional, fica em ./midia/)
texto-na-tela: Título curto (opcional)
fala: Texto exato que será falado.

## Cena 2
fala: Outra cena. Números como 1799 e 1.500 são lidos por extenso.
```

- Sem `midia` (ou arquivo inexistente): fundo de cor sólida com o `texto-na-tela` (ou as primeiras
  palavras da fala). Não dá erro.
- Imagem: zoom suave (entra/sai alternando). Clipe de vídeo: preenche a tela e repete se for curto.
- A duração de cada cena é a duração da fala + uma pausa curta; transição de 0,2 s.
- Com música: volume bem abaixo da fala e "ducking" (ela abaixa quando você fala).

## Voz: ajustes escolhidos ("v4")

Chatterbox multilíngue (MIT, uso comercial liberado), `exagero 0.25`, `cfg 0.3`, `temperatura 0.5`.
Nome que o modelo lê errado? Crie `pronuncias.json`: `{"Roseta": "Rozeta"}` (só muda a fala, não a legenda).

## Quando algo falhar

| Sintoma | O que fazer |
|---|---|
| Voz cortada ou palavra faltando | O script já tenta até 3 sementes por cena e avisa "cobertura". Se avisar, rode com `--refazer` ou reescreva a frase (frases curtas funcionam melhor). |
| Voz "rouca" ou diferente da sua | Regrave a referência: lugar silencioso, 15–20 cm do microfone, `.wav`/alta qualidade, 10–30 s sem engasgos. Salve em `amostras/minha-voz.wav`. |
| Palavra pronunciada errado | Use `pronuncias.json` (acima). |
| `No module named 'pkg_resources'` | `uv pip install --python reels-voz/bin/python "setuptools<81"` |
| Legenda com fonte errada | Instale a fonte e passe `--fonte "Nome da Fonte"`. |
| Lento | Sem GPU a voz leva ~2 min por 10 s de áudio. A voz fica em cache: refazer o vídeo é rápido. |
| `ffmpeg: command not found` | Instale o ffmpeg (com libass e libx264) fora do ambiente virtual. |
| Quer reinstalar tudo | `uv venv --python 3.11 reels-voz` e `uv pip install --python reels-voz/bin/python torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu`, depois `uv pip install --python reels-voz/bin/python chatterbox-tts coqui-tts faster-whisper "setuptools<81"` |

## Licenças

- **Chatterbox**: MIT, uso comercial liberado. É o padrão e o único para conteúdo final.
- **XTTS-v2**: pesos não comerciais (CPML). Só para comparação. Não publique com ele sem aprovação.
- **faster-whisper**: MIT (só mede os tempos das palavras).
- Você é a única voz clonada, com seu consentimento.
