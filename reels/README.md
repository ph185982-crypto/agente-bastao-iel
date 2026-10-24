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

Opções úteis do `fazer_reels.py`: `--motion auto|manual|off` (gráficos animados, padrão `auto`),
`--refazer` (ignora o cache de voz), `--whisper medium` (tempos mais precisos),
`--fonte "Montserrat"` (fonte das legendas), `--device cuda` (se houver GPU).

## Pastas

| Pasta | Conteúdo |
|---|---|
| `amostras/minha-voz.wav` | referência da voz (24 kHz, mono, ~23 s, já limpa). Fora do git. |
| `roteiros/` | roteiros `.md` |
| `motion.py`, `motion_template.html` | motor dos gráficos animados |
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

## Motion graphics (gráficos animados)

Além da voz e das legendas, cada cena ganha uma camada de motion: fundo animado (brilhos, grade, formas
flutuantes), barra de progresso no topo, "cortina" na troca de cena e elementos que **entram na palavra
falada**. Funciona sozinho (`--motion auto`) e dá para controlar linha a linha com `visual:` no roteiro.

| `visual:` | Exemplo | O que aparece |
|---|---|---|
| `titulo` | `titulo: Roseta, Egito` | faixa no topo, palavras "pulando" (o `texto-na-tela` já vira isso) |
| `destaque` | `destaque: A chave era a repetição` | frase com marca-texto varrendo |
| `numero` | `numero: 1799 \| Ano da descoberta` · `numero: 20 \| anos depois` | número em anel (ano = pop; quantidade = contagem) |
| `icone` | `icone: 🏺 \| Egito Antigo` · `icone: pedra` | emoji grande com órbita (aceita emoji ou palavra: pedra, rei, fogo...) |
| `linha-do-tempo` | `linha-do-tempo: 1799 Pedra achada; 1822 Decifrada` | linha vertical com marcos |
| `lista` | `lista: Hieróglifos; Demótico; Grego` | cartões numerados deslizando |
| `comparacao` | `comparacao: Egito x Roma` | dois cartões com VS |
| `grafico` | `grafico: Egito=80; Roma=60%` | barras que crescem |

- Sincronia: termine com `@palavra` para entrar naquela palavra da fala. Nas listas, linha do tempo e gráfico
  vale **por item**: `linha-do-tempo: 1799 Achada @pista; 1822 Decifrada @Champollion`.
- Pode repetir `visual:` na mesma cena. Elementos do centro aparecem um de cada vez.
- Sem `visual:` (modo `auto`): números da fala viram `numero` e palavras-chave (pedra, guerra, rei, ouro...)
  viram `icone`, cada um na sua palavra. `--motion manual` usa só o que o roteiro pede; `--motion off` desliga.
- O motion é desenhado por um Chromium sem tela (`motion.py` + `motion_template.html`), quadro a quadro.
  Leva ~3 min para 30 s de vídeo em CPU de 4 núcleos e fica em cache enquanto o roteiro não mudar.
  Precisa de `playwright` (já no venv) e um Chromium: `playwright install chromium` ou `CHROMIUM_PATH=/caminho/chrome`.

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
| Lento | Sem GPU a voz leva ~2 min por 10 s de áudio e o motion ~3 min por 30 s. Voz e motion ficam em cache: refazer só o texto/legenda é rápido. |
| `Executable doesn't exist` (motion) | `playwright install chromium` (dentro do venv) ou defina `CHROMIUM_PATH`. |
| Emoji aparece como quadradinho | Instale uma fonte de emoji (Noto Color Emoji) ou use `icone` só com palavras que você testou. |
| `AVISO: ancora '@x' nao encontrada` | A palavra não está na fala daquela cena; confira a grafia (acentos não importam). |
| `ffmpeg: command not found` | Instale o ffmpeg (com libass e libx264) fora do ambiente virtual. |
| Quer reinstalar tudo | `uv venv --python 3.11 reels-voz` e `uv pip install --python reels-voz/bin/python torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu`, depois `uv pip install --python reels-voz/bin/python chatterbox-tts coqui-tts faster-whisper playwright "setuptools<81"` |

## Licenças

- **Chatterbox**: MIT, uso comercial liberado. É o padrão e o único para conteúdo final.
- **XTTS-v2**: pesos não comerciais (CPML). Só para comparação. Não publique com ele sem aprovação.
- **faster-whisper**: MIT (só mede os tempos das palavras).
- Você é a única voz clonada, com seu consentimento.
