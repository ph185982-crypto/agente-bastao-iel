# Edição automática de vídeo curto (Reels/TikTok/Shorts) com IA: estado da arte e especificação

Pesquisa feita em 14/11/2026. Objetivo: melhorar o editor automático `tools/reels/worker.js`
(Node.js + ffmpeg + Whisper rodando em GitHub Actions), sem APIs pagas.

**Legenda de confiabilidade**
- **[V] Verificado**: lido na página/README/código da fonte citada nesta data.
- **[I] Inferido**: recomendação nossa, derivada das fontes ou de prática comum de ffmpeg/ASS. Precisa de teste.

> Observação de método: a API do GitHub ficou bloqueada nesta sessão. As estrelas foram lidas
> na página pública de cada repositório (valor arredondado que o GitHub exibe, ex.: "5.9k").
> A data do último commit **não** aparece nesse HTML, então "atividade" só foi confirmada quando
> o README diz algo explícito (arquivado, sem manutenção etc.).

---

## 1. Panorama dos projetos open source

### 1.1 Tabela

| Projeto | Estrelas [V] | Licença [V] | O que faz | Relevância para nós |
|---|---|---|---|---|
| [anthropics/skills](https://github.com/anthropics/skills) | ~194k | Apache-2.0 na maioria (por skill) | Coleção oficial de Agent Skills. **Nenhuma skill de vídeo** mencionada na página | Baixa (só o formato de skill) |
| [harry0703/MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) | ~143k | MIT | Tema → roteiro (LLM) → termos de busca → stock Pexels/Pixabay → TTS → legendas → música | Alta: busca de B-roll por LLM, defaults de legenda/música |
| [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) | ~84k | Apache-2.0 | HTML/CSS/GSAP → MP4 (Chrome headless + ffmpeg), "Built for agents"; plugin/skills para Claude Code | Média: gerar cartões animados se aceitarmos Chrome no worker |
| [remotion-dev/remotion](https://github.com/remotion-dev/remotion) | ~73k | Licença própria (empresa pode precisar pagar) | Vídeo programático com React | Média: referência de legendas TikTok; licença é um risco |
| [browser-use/video-use](https://github.com/browser-use/video-use) | ~31k | MIT | **Skill para Claude Code** que edita vídeo bruto: transcrição por palavra → LLM gera EDL → render ffmpeg → autoavaliação | **Muito alta**: regras de corte, padding, fades, legendas, áudio |
| [m-bain/whisperX](https://github.com/m-bain/whisperX) | ~25k | BSD-2-Clause | Whisper + VAD + alinhamento forçado wav2vec2 → timestamps por palavra precisos | Alta: tem modelo PT (`jonatasgrosman/wav2vec2-large-xlsr-53-portuguese`) [V] |
| [motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas) | ~20k | MIT | Animações com TypeScript | Baixa/média |
| [RayVentura/ShortGPT](https://github.com/RayVentura/ShortGPT) | ~8.2k | MIT | Framework de automação de Shorts; "EditingEngine" com markup JSON que o LLM edita; Pexels | Média: ideia do EDL em JSON |
| [remotion-dev/skills](https://github.com/remotion-dev/skills) | ~7k | não exibida | Agent Skills oficiais da Remotion (inclui `remotion-captions`) | Média |
| [Anil-matcha/AI-Youtube-Shorts-Generator](https://github.com/SamurAIGPT/AI-Youtube-Shorts-Generator) | ~6.1k | MIT | Vídeo longo → LLM pontua trechos 0–100 por "viralidade" → recorte 9:16 com rastreamento de rosto (OpenCV) | Média: seleção de trechos, crop de rosto |
| [WyattBlue/auto-editor](https://github.com/WyattBlue/auto-editor) | ~5.9k | Unlicense (domínio público) | Corte automático de silêncio/movimento | **Alta**: parâmetros de referência de silêncio |
| [mifi/editly](https://github.com/mifi/editly) | ~5.6k | MIT | Edição declarativa em JSON (Node), camadas `title`, `subtitle`, `news-title`, `slide-in-text` | Média: modelo de EDL em Node |
| [redotvideo/revideo](https://github.com/redotvideo/revideo) | ~4.2k | MIT | Fork do Motion Canvas com API de render headless | Baixa/média |
| [tnfe/FFCreator](https://github.com/tnfe/FFCreator) | ~3.2k | MIT | Biblioteca Node de vídeo baseada em ffmpeg | Baixa |
| [carykh/jumpcutter](https://github.com/carykh/jumpcutter) | ~3.1k | MIT | Jump cut clássico (sem manutenção, diz o README) | Baixa: só referência histórica |
| [jianfch/stable-ts](https://github.com/jianfch/stable-ts) | ~2.3k | MIT | Timestamps estáveis do Whisper, export **ASS karaokê** | Média: **arquivado em 30/05/2026** [V] |
| [ClipsAI/clipsai](https://github.com/ClipsAI/clipsai) | ~571 | MIT | Achar clipes em vídeo longo + resize 9:16 seguindo o falante (pyannote) | Baixa |
| [francozanardi/pycaps](https://github.com/francozanardi/pycaps) | ~232 | MIT | Legendas animadas com CSS (`.word-being-narrated`), fade/pop/slide, emoji, SFX | Média: catálogo de efeitos |
| [chrislema/videoeditor](https://github.com/chrislema/videoeditor) | não verificado | não verificado | 8 skills Markdown para Claude Code: silêncio, zoom dinâmico, cor, áudio, legendas | Média: cadência de zoom |
| [6missedcalls/video-editing-skill](https://github.com/6missedcalls/video-editing-skill) | 53 | MIT | Skill Claude: legendas (Hormozi/standard/minimal) + `jumpcut.sh` | Baixa (mas defaults úteis) |
| [SamurAIGPT/Text-To-Video-AI](https://github.com/SamurAIGPT/Text-To-Video-AI) | contagem inconsistente na leitura | MIT | Roteiro → legendas cronometradas → **LLM gera palavras-chave visuais por janela de 2–4 s** → Pexels | **Alta**: prompt de B-roll por trecho |

Outras skills de vídeo para Claude Code achadas em índices (não verificadas a fundo):
[csoop/video-use / jump-cut-vad](https://github.com/csoop/video-use) (Silero VAD),
[louisedesadeleer/cut-video](https://www.tella.com/skills/cut-video) (remove "ums" mas mantém risadas),
[NeverSight video-edit](https://openskillindex.com/skills/neversight-learn-skills-dev-video-edit),
artigo do [Chris Lema](https://chrislema.com/claude-code-skills-for-video-editing),
guia da [Kapwing](https://www.kapwing.com/resources/how-to-edit-videos-with-claude-code-free-ai-video-editing-skill/).

### 1.2 O que importa de cada um (resumo)

- **video-use** é a referência mais próxima do que fazemos: o LLM **não assiste o vídeo**, lê uma
  transcrição por palavra compactada ("takes_packed.md", frases quebradas em silêncio ≥ 0,5 s) e
  devolve um **EDL JSON**; o render é ffmpeg; depois ele **se autoavalia** em cada corte
  (salto visual, estalo de áudio, legenda escondida) e re-renderiza até 3 vezes. [V]
- **auto-editor / jumpcutter** são o método "burro" de volume: limiar de áudio + margem. Bons
  como pré-filtro, ruins sozinhos (cortam no meio de palavra baixa). [V]/[I]
- **MoneyPrinterTurbo / ShortGPT / Text-To-Video-AI** são o modelo "LLM → termos de busca em
  inglês → Pexels". [V]
- **Remotion / HyperFrames / Motion Canvas / Revideo / editly** são motores de composição. Para
  nosso worker (ffmpeg puro) servem como referência de design, não como dependência. [I]

---

## 2. Metodologia extraída

### 2.1 Remoção de silêncio e vícios de linguagem

| Fonte | Parâmetro | Valor [V] |
|---|---|---|
| auto-editor | `--edit audio:threshold` | `0.04` (amplitude linear, ~ -28 dBFS) |
| auto-editor | `--margin` (sobra antes/depois da fala) | `0.2s` |
| auto-editor | `--smooth MINCUT,MINCLIP` | `0.2s,0.1s` (não corta silêncio < 0,2 s; descarta trecho falado < 0,1 s) |
| auto-editor | velocidade | fala a 1×; silêncio cortado (`--when-silent cut`) |
| jumpcutter | `silent_threshold` / `frame_margin` / `sounded_speed` / `silent_speed` | `0.03` / `1` quadro / `1.00` / `5.00` |
| 6missedcalls `jumpcut.sh` | `--threshold` / `--duration` / `--padding` | `-30 dB` / `0.5 s` / `0.1 s` |
| Chris Lema | silêncio | > 0,5 s é encurtado para **0,3 s** de pausa natural (não zerado) |
| video-use | regra 6 | **nunca cortar dentro de palavra**: encaixar todo corte em limite de palavra |
| video-use | regra 7 | **padding de 30–200 ms** em toda borda (timestamps derivam 50–100 ms) |
| video-use | exemplo real | **50 ms antes** da 1ª palavra mantida, **80 ms depois** da última |
| video-use | candidatos | silêncio ≥ 400 ms = corte limpo; 150–400 ms = usável com checagem; < 150 ms = inseguro |
| video-use | regra 3 | **fade de áudio de 30 ms** em cada borda de segmento (evita "clique") |
| video-use | regra 8 | ASR por palavra, literal; **não** usar modo frase/SRT (perde lacunas) |

**Recomendação para o worker [I]:**
1. Whisper com `word_timestamps` (ou whisperX se couber no tempo do Actions). Usar
   `initial_prompt` com vícios em PT ("é... éé, hum, tipo, né, então, assim") para o Whisper
   **não apagar** os vícios da transcrição. O video-use avisa que Whisper "normaliza" fillers [V];
   o truque do prompt é prática comum, não verificada aqui [I].
2. Lacuna entre palavras ≥ **0,40 s** → corte. Deixar **0,08 s** depois da última palavra e
   **0,05 s** antes da próxima (valores do video-use). Resultado: pausa residual ≈ 0,13 s, que soa
   humano. Para tom mais calmo, deixar até 0,25 s.
3. Lacuna 0,15–0,40 s: manter (é respiração natural). Não cortar < 0,15 s.
4. Vícios isolados ("é", "hum", "tipo" sozinho entre pausas) → remover a palavra + padding.
   Palavras repetidas ("eu eu acho") e falsos inícios → deixar o LLM decidir no EDL.
5. Cruzar com volume: se o Whisper marca palavra mas o RMS da janela < -40 dBFS, é alucinação
   → tratar como silêncio [I].
6. Segmento falado final < 0,3 s depois dos cortes → fundir com vizinho (equivalente ao MINCLIP) [I].
7. `afade` de 30 ms in/out em cada segmento. [V]

### 2.2 Velocidade
- Nenhuma ferramenta de referência acelera a fala por padrão: auto-editor e jumpcutter mantêm 1×. [V]
- MoneyPrinterTurbo permite ajustar velocidade, sem default documentado. [V]
- **Recomendação [I]:** 1,0× por padrão. Opcional `atempo=1.05–1.10` + `setpts=PTS/1.07` para
  falantes lentos; acima de 1,15 a voz fica artificial em PT.

### 2.3 Zoom / punch-in em jump cut
- Chris Lema [V]: três níveis: normal **1,0×**, ênfase **1,25×**, crítico **1,6×**; distribuição alvo
  **~40 / 35 / 25 %**; seções de **3 a 7 s**; recorte centrado no rosto (OpenCV).
- video-use: lista "speed ramps, punch-ins, split-screen, PiP" como técnicas livres, sem números. [V]
- **Recomendação [I]** (1,6× fica pixelado em vídeo de celular 1080p): alternar a cada corte de
  silêncio entre **1,00×** e **1,12×**; usar **1,20×** só em frase de ênfase. Nunca dois zooms
  iguais seguidos. Zoom lento contínuo (Ken Burns) só em B-roll/cartão, não no rosto.

### 2.4 Troca de layout e escolha de B-roll
- Text-To-Video-AI [V]: o LLM recebe roteiro + legendas cronometradas e devolve
  `[[[t1,t2],["kw1","kw2","kw3"]], ...]`, com 3 palavras-chave **concretas e visuais**, **em inglês**,
  cobrindo **2–4 s** cada, intervalos contíguos. Exemplo do prompt: "emotional moment" = ruim,
  "crying child" = bom.
- MoneyPrinterTurbo [V]: LLM gera N termos de busca cronológicos em inglês; duração de clipe
  padrão **5 s** (`video_clip_duration`, 1–15); música `bgm_volume=0.2`; legenda branca
  `font_size=60`, contorno preto 1,5, posição `bottom`.
- ShortGPT [V]: "EditingEngine" com linguagem de marcação JSON que o LLM manipula.
- video-use [V]: cartões explicativos **mínimo 3 s, típico 5–7 s**; segurar o último quadro ≥ 1 s;
  revelar um elemento por vez; o "payoff" da animação cai **no timestamp da palavra-chave**
  (começar `reveal_duration` antes); easing `ease_out_cubic`, nunca linear.
- **Regra de ritmo [I]** (síntese): alguma mudança visual a cada **2–4 s** (corte, zoom, troca
  de layout ou entrada de gráfico); troca de **layout** a cada 1–2 frases (4–8 s); nunca mais de
  ~8 s seguidos de rosto sem nenhum evento; cartão de tela cheia no máximo 2–3 por minuto.

### 2.5 Legendas animadas
- video-use estilo `bold-overlay` [V]: blocos de **~2 palavras**, MAIÚSCULAS, quebra em pontuação e
  pausas ≥ **0,3 s**; se o bloco ficaria < **0,35 s**, cresce para 3 palavras; contorno branco/preto;
  **legenda é o ÚLTIMO filtro** (senão overlay cobre); tempos no timeline de saída:
  `t_saida = palavra.inicio - seg.inicio + seg.offset`.
- video-use estilo "natural" [V]: 4–7 palavras, caixa de frase, para narrativo/educativo.
- Remotion `createTikTokStyleCaptions` [V]: agrupa por `combineTokensWithinMilliseconds`
  (exemplo da doc: **1200**; valor baixo = palavra a palavra); `breakOnSilenceAfterMilliseconds`
  quebra página em pausas; cada token tem `fromMs/toMs` para destacar a palavra ativa.
- stable-ts [V]: `to_ass(word_level=True, karaoke=True|False, highlight_color='00ff00', tag=...)`.
- pycaps [V]: classe `.word-being-narrated` para a palavra falada; animações fade/pop/slide.
- **Recomendação [I]:** 2–3 palavras por tela (máx. 4 e máx. ~18 caracteres por linha, 1 linha);
  palavra ativa em amarelo `#FFD400` (ou cor da marca) com "pop" 100→115→105 % em 120 ms;
  palavras de ênfase (EDL) em verde/laranja e sempre MAIÚSCULAS.

### 2.6 Zonas seguras (Reels/TikTok/Shorts, 1080×1920)
Não há especificação oficial para orgânico; fontes divergem [V]
([reap.video](https://reap.video/blog/short-form-video-safe-zones),
[hopperhq](https://www.hopperhq.com/blog/instagram-reel-size/),
[revid.ai](https://www.revid.ai/instagram-reels-safe-zone)):
topo 220–290 px, base 320–670 px, direita ~120 px (botões), laterais 10–15 %.
**Usar [I]:** área útil `x 90–960`, `y 280–1400`. Legenda centrada em `y ≈ 1150–1250`
(rosto) ou na **costura** `y ≈ 960` (layout dividido). Nada importante abaixo de `y = 1450`.

### 2.7 Gancho nos primeiros 3 s
- AI-Youtube-Shorts-Generator [V]: LLM avalia "hooks, emotional peaks, opinion bombs,
  revelations, conflict, quotable lines" e dá nota 0–100 + linha de gancho.
- video-use [V]: gancho que mostra visualmente o assunto nos 3 primeiros segundos, dirigido pelos
  mesmos dados do áudio; arquétipo HOOK → PROBLEM → SOLUTION → BENEFIT → EXAMPLE → CTA.
- **Recomendação [I]:** 0–3 s sempre com (a) texto-gancho grande no topo (layout `dividida` ou
  `cartao` curto ≤ 1,5 s) e (b) primeira frase sem nenhum silêncio residual (padding 30 ms);
  zoom 1,12× no primeiro quadro; opcionalmente reordenar a frase mais forte para o início.

### 2.8 Som
- video-use [V]: **poucos efeitos** (~8 em 18 s soa "desenhado"; ~20 soa genérico); cada efeito
  ligado a algo visível; alinhar o transiente ao quadro (descontar o "ataque" do arquivo);
  **ducking de -12 a -15 dB** da música sob a fala; master **loudnorm 2 passadas, -14 LUFS,
  true peak ≤ -1 dBTP**; medir com `ebur128`.
- MoneyPrinterTurbo [V]: `bgm_volume=0.2` (≈ -14 dB).
- **Recomendação [I]:** whoosh curto (≤ 0,4 s, -18 dB) só em troca de layout; "pop" sutil em
  número/cartão; música a -22..-26 LUFS sob a voz via `sidechaincompress`.

### 2.9 Rotação de vídeo de celular (causa clássica de saída de cabeça para baixo)
Fatos [V] ([doc ffmpeg](https://ffmpeg.org/ffmpeg.html), [trac #8329](https://trac.ffmpeg.org/ticket/8329),
[trac #9895](https://trac.ffmpeg.org/ticket/9895), [Blender T98480](https://developer.blender.org/T98480)):
- Celulares gravam o sensor "deitado" e gravam um **display matrix** (side data) dizendo como girar.
- O ffmpeg CLI **auto-rotaciona por padrão** (`-noautorotate` desliga); `-display_rotation`
  define rotação em graus anti-horários; há bugs conhecidos com 180° e alguns Androids.

Armadilhas e regras [I]:
1. **Rotação dupla**: ler `rotation` no ffprobe e aplicar `transpose` manual **enquanto o
   autorotate está ligado** gira duas vezes. Com 180° o resultado é o vídeo de cabeça para baixo.
   Faça uma coisa ou outra, nunca as duas.
2. `width/height` do ffprobe são do quadro **codificado** (antes de girar). Com ±90° troque-os
   antes de calcular crop de rosto.
3. `-c copy` preserva o display matrix; arquivo re-encodado com autorotate fica "assado" e sem
   matrix. Misturar os dois tipos num concat dá orientação inconsistente.
4. A rotação pode vir em `side_data_list[].rotation` (novo) **ou** na tag `rotate` (antigo). Ler ambos.
5. **Solução robusta**: um único passe de normalização **no início**, com autorotate ligado,
   gerando `norm.mp4` 1080×1920 sem side data; todo o resto do pipeline usa só `norm.mp4`.
   Validar com ffprobe: sem rotação e `height > width`. Se falhar, abortar com erro claro.

---

## 3. Especificação para implementar

### 3.1 Pipeline proposto [I]

```
0. ffprobe → orientação, fps, duração
1. normalizar   → norm.mp4 (1080x1920, 30fps, CFR, rotação assada, áudio 48k)
2. transcrever  → words.json (Whisper word-level; whisperX se houver tempo)
3. cortes       → keep.json (silêncio/vícios por palavra + padding)          [determinístico]
4. EDL LLM      → edl.json (frases → layout, busca visual, cartões, ênfases) [LLM, validado por schema]
5. assets       → Pexels (portrait) + cartões/gráficos gerados (ffmpeg drawtext/ASS)
6. render seg.  → um mp4 por frase (layout aplicado), com afade 30 ms
7. concat       → concat demuxer (-c copy, mesmos parâmetros de codec)
8. legendas     → captions.ass no timeline de saída, queimadas POR ÚLTIMO
9. áudio        → música com ducking + SFX + loudnorm -14 LUFS / -1 dBTP
10. autoverificação → ffprobe (duração, rotação), ebur128, frames nas bordas de corte
```

### 3.2 Parâmetros recomendados (resumo)

| Item | Valor | Origem |
|---|---|---|
| Silêncio mínimo para cortar | 0,40 s | video-use [V] |
| Padding antes da fala / depois da fala | 0,05 s / 0,08 s (faixa 0,03–0,20) | video-use [V] |
| Pausa residual alvo | 0,10–0,30 s | Chris Lema 0,3 s [V] / video-use [V] |
| Limiar de energia (fallback sem Whisper) | -30 dB, mín. 0,5 s | 6missedcalls [V] / auto-editor 0,04 [V] |
| Fade de áudio por segmento | 30 ms | video-use [V] |
| Velocidade da fala | 1,0× (opcional ≤ 1,10×) | auto-editor/jumpcutter [V] / [I] |
| Punch-in | alternar 1,00 ↔ 1,12×; ênfase 1,20× | [I] (Lema usa 1,25/1,6 [V]) |
| Mudança visual | a cada 2–4 s | Text-To-Video-AI 2–4 s/keyword [V] / [I] |
| B-roll por janela | 2–5 s | Text-To-Video-AI [V], MoneyPrinterTurbo 5 s [V] |
| Cartão de texto | 1,5–3 s (gancho/número); explicativo 3–7 s | video-use [V] / [I] |
| Legenda | 2–3 palavras, MAIÚSCULAS, quebra em pausa ≥ 0,3 s, bloco ≥ 0,35 s | video-use [V] |
| Loudness final | -14 LUFS integrado, TP ≤ -1 dBTP | video-use [V] |
| Ducking da música | -12 a -15 dB sob a fala | video-use [V] |

### 3.3 Schema do EDL (uma entrada por frase)

O LLM recebe a transcrição **já cortada** (tempos no timeline de saída, frase por linha com
`[ini-fim]`) e devolve só o JSON abaixo. O worker valida e corrige (ex.: limita cartões, força
alternância). Layouts: `rosto` (falante tela cheia), `dividida` (gráfico/B-roll em cima, rosto
embaixo), `cartao` (tela cheia de texto/número, voz continua por baixo).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "EDL Reels v1",
  "type": "object",
  "required": ["versao", "duracao", "gancho", "frases"],
  "properties": {
    "versao": { "const": 1 },
    "duracao": { "type": "number", "description": "segundos, timeline de saída" },
    "gancho": {
      "type": "object",
      "required": ["texto"],
      "properties": {
        "texto": { "type": "string", "maxLength": 40, "description": "texto grande 0–3 s" },
        "layout": { "enum": ["dividida", "cartao"], "default": "dividida" }
      }
    },
    "paleta": {
      "type": "object",
      "properties": {
        "fundo": { "type": "string", "default": "#0E0E10" },
        "texto": { "type": "string", "default": "#FFFFFF" },
        "destaque": { "type": "string", "default": "#FFD400" },
        "enfase": { "type": "string", "default": "#2BD576" }
      }
    },
    "frases": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "ini", "fim", "texto", "layout"],
        "properties": {
          "id": { "type": "integer" },
          "ini": { "type": "number" },
          "fim": { "type": "number" },
          "texto": { "type": "string" },
          "layout": { "enum": ["rosto", "dividida", "cartao"] },
          "zoom": { "enum": [1.0, 1.12, 1.2], "default": 1.0 },
          "visual": {
            "type": "object",
            "description": "obrigatório se layout=dividida",
            "properties": {
              "tipo": { "enum": ["broll", "numero", "lista", "icone", "texto"] },
              "busca_en": {
                "type": "array", "items": { "type": "string" }, "maxItems": 3,
                "description": "termos concretos e visuais em inglês para Pexels (ex.: 'hands counting money')"
              },
              "titulo": { "type": "string", "maxLength": 32 },
              "numero": { "type": "string", "description": "ex.: '73%', 'R$ 2.400', '3x'" },
              "itens": { "type": "array", "items": { "type": "string" }, "maxItems": 3 }
            }
          },
          "cartao": {
            "type": "object",
            "description": "obrigatório se layout=cartao",
            "properties": {
              "linhas": { "type": "array", "items": { "type": "string", "maxLength": 18 }, "maxItems": 3 },
              "numero": { "type": "string" },
              "animacao": { "enum": ["pop", "subir", "contador", "digitar"], "default": "pop" }
            }
          },
          "enfase": {
            "type": "array", "items": { "type": "string" },
            "description": "palavras exatas da frase que ficam coloridas/maiores na legenda"
          },
          "sfx": { "enum": ["nenhum", "whoosh", "pop", "ding"], "default": "nenhum" }
        }
      }
    }
  }
}
```

**Regras do prompt do LLM [I]** (baseadas em Text-To-Video-AI e video-use [V]):
- Termos de busca **concretos e visuais, em inglês**, 2–4 palavras; nunca abstratos.
- `cartao` só para número, estatística, lista curta ou frase de impacto; ≤ 3 por minuto.
- Nunca dois `cartao` seguidos; nunca mais de 2 frases `rosto` seguidas acima de 8 s no total.
- `enfase`: 1–2 palavras por frase, só as que carregam o sentido (número, verbo forte, negação).
- 1ª frase: layout `dividida` com `gancho.texto`; última frase: `rosto` (CTA olhando para a câmera).

**Validação no worker [I]:** se `busca_en` falhar no Pexels (0 resultados ou vídeo < duração),
cair para `tipo: "texto"` com `titulo` gerado; se `cartao.linhas` passar de 18 caracteres,
quebrar ou reduzir a fonte; recalcular `ini/fim` pelo índice da frase, nunca confiar nos tempos do LLM.

### 3.4 Pexels (sem custo)
[V] `GET https://api.pexels.com/v1/videos/search?query=...&orientation=portrait&size=medium&per_page=15`
(máx. 80), header `Authorization: <chave>`. Limite padrão **200 req/h e 20.000 req/mês**.
Pedem crédito ao fotógrafo e link para a Pexels. `video_files[]` traz `quality`, `width`,
`height`, `link`.
[I] Escolher o arquivo com `height ≥ 960` mais próximo de 1080 de largura; pular vídeos já usados
no mesmo Reel; cache por termo no runner (`actions/cache`).

### 3.5 Filtros ffmpeg

Convenções: `norm.mp4` já está 1080×1920, 30 fps, rotação assada. `D` = duração da frase.
`FY` = centro vertical do rosto em pixels (detecção de rosto ou heurística `0.38*1920`).

#### a) Normalização e rotação
```bash
# Inspeção (ler as duas formas de rotação)
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate:stream_side_data=rotation:stream_tags=rotate \
  -of json in.mov

# Normalizar: autorotate LIGADO (padrão), sem transpose manual
ffmpeg -y -i in.mov \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p" \
  -c:v libx264 -preset veryfast -crf 18 -c:a aac -ar 48000 -ac 2 \
  -metadata:s:v:0 rotate=0 norm.mp4
# Depois: ffprobe norm.mp4 deve mostrar sem side_data de rotação e height>width.
```
Se o vídeo continuar errado (bug com 180° citado no trac), alternativa explícita [I]:
`ffmpeg -noautorotate -i in.mov -vf "transpose=..."` (90° horário = `transpose=1`;
90° anti-horário = `transpose=2`; 180° = `hflip,vflip`) **e nada de autorotate**.
Lembrete: `rotation=-90` no ffprobe significa girar 90° no sentido horário para exibir.

#### b) Cortes sem estalo (por segmento mantido)
```bash
ffmpeg -y -ss $INI -to $FIM -i norm.mp4 \
  -af "afade=t=in:st=0:d=0.03,afade=t=out:st=$(echo "$FIM-$INI-0.03"|bc):d=0.03" \
  -c:v libx264 -preset veryfast -crf 18 -c:a aac seg_001.mp4
```
(`-ss` antes de `-i` com re-encode é preciso no ffmpeg moderno [I]. Concat depois com
`-f concat -safe 0 -i lista.txt -c copy`, todos os segmentos com o mesmo codec/fps/tamanho.)

#### c) Punch-in (layout `rosto`)
Zoom "duro" por segmento, centrado no rosto (barato e sem tremor):
```
[0:v]crop=w=iw/Z:h=ih/Z:x=(iw-ow)/2:y=max(0\,min(ih-oh\,FY-oh*0.42)),scale=1080:1920:flags=lanczos,setsar=1[v]
```
Com `Z=1.12` → recorte 964×1714 reescalado. Zoom suave contínuo (opcional, 0→4 % na frase) [I]:
```
[0:v]scale=w='trunc(1080*(1+0.04*t/D)/2)*2':h=-2:eval=frame,crop=1080:1920:(iw-ow)/2:(ih-oh)/2[v]
```
(`zoompan` em vídeo tende a tremer por arredondamento; se usar, faça upscale antes [I].)

#### d) Tela dividida 1080×1920 (`dividida`)
Topo 1080×960 = B-roll ou gráfico; base 1080×960 = rosto recortado do `norm.mp4`.
```bash
ffmpeg -y -ss $INI -t $D -i norm.mp4 -stream_loop -1 -i broll.mp4 -filter_complex "
[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1,fps=30,
     trim=duration=$D,setpts=PTS-STARTPTS[top];
[0:v]crop=1080:960:0:'max(0,min(1920-960,$FY-380))',setsar=1[bot];
[top][bot]vstack=inputs=2[stack];
[stack]drawbox=x=0:y=956:w=1080:h=8:color=0xFFD400@1:t=fill[v]" \
-map "[v]" -map 0:a -af "afade=t=in:st=0:d=0.03,afade=t=out:st=$(echo "$D-0.03"|bc):d=0.03" \
-c:v libx264 -preset veryfast -crf 18 -c:a aac -shortest seg_007.mp4
```
- Recorte do rosto: janela 1080×960 com o rosto ~40 % abaixo do topo dela (`FY-380`). Se o
  rosto ocupar pouco da tela, usar `crop=810:720:...,scale=1080:960` (zoom 1,33×) [I].
- Topo como **gráfico gerado** (sem B-roll): trocar `[1:v]` por
  `color=c=0x0E0E10:s=1080x960:d=$D:r=30` + `drawtext`/ASS (ver item e).
- Título sobre o B-roll: `drawbox` semitransparente + `drawtext` no topo do `[top]`
  (y ≥ 280 por causa da zona segura).
- A legenda vai **depois**, sobre o vídeo concatenado, centrada na costura (`y≈960`).

#### e) Cartão de tela cheia animado (`cartao`)
Opção 1, ASS sobre cor sólida (um motor só, com pop e fade) [I]:
```bash
ffmpeg -y -f lavfi -i "color=c=0x0E0E10:s=1080x1920:r=30:d=$D" -ss $INI -t $D -i norm.mp4 \
  -filter_complex "[0:v]ass=cartao_007.ass[v]" -map "[v]" -map 1:a \
  -c:v libx264 -preset veryfast -crf 18 -c:a aac -shortest seg_007.mp4
```
`cartao_007.ass` (evento com pop de escala + fade; cores ASS são `&HBBGGRR&`):
```
Dialogue: 0,0:00:00.00,0:00:02.50,Card,,0,0,0,,{\an5\pos(540,860)\fad(80,120)\fscx60\fscy60\t(0,140,\fscx112\fscy112)\t(140,240,\fscx100\fscy100)}73%
Dialogue: 0,0:00:00.25,0:00:02.50,CardSub,,0,0,0,,{\an5\pos(540,1060)\fad(120,120)\move(540,1110,540,1060,0,220)}DOS CLIENTES VOLTAM
```
Opção 2, contador com `drawtext` (número subindo até N em 0,8 s) [I]:
```
drawtext=fontfile=/caminho/Montserrat-ExtraBold.ttf:fontsize=220:fontcolor=0xFFD400:
  x=(w-text_w)/2:y=(h-text_h)/2-120:text='%{eif\:min(73\,73*t/0.8)\:d}'
```
(Testado no ffmpeg local: `%%` dentro do `text` dá "Stray %". Desenhe o sufixo "%" / "R$"
num segundo `drawtext` com `text='%'` e `expansion=none`, ou no ASS.)
Cartões ≤ 3 s; a voz continua por baixo (é um "insert", não pausa a fala).

#### f) Legendas karaokê ASS (palavra ativa colorida + pop)
Cabeçalho (`PlayResX/Y` igual ao vídeo, para coordenadas em pixels):
```
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Montserrat ExtraBold,86,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,5,90,150,0,1
Style: Card,Montserrat ExtraBold,200,&H0000D4FF,&H0000D4FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,90,90,0,1
Style: CardSub,Montserrat ExtraBold,78,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,90,90,0,1
```
Geração (uma linha `Dialogue` **por palavra ativa**, mais controle que `\k`) [I]:
```
# bloco "VOCÊ PERDE CLIENTES" (palavras 0,00–0,28 / 0,28–0,61 / 0,61–1,10), rosto → pos(540,1180)
Dialogue: 0,0:00:00.00,0:00:00.28,Cap,,0,0,0,,{\an5\pos(540,1180)}{\c&H0000D4FF&\fscx85\fscy85\t(0,90,\fscx112\fscy112)\t(90,160,\fscx100\fscy100)}VOCÊ{\r} PERDE CLIENTES
Dialogue: 0,0:00:00.28,0:00:00.61,Cap,,0,0,0,,{\an5\pos(540,1180)}VOCÊ {\c&H0000D4FF&\t(0,90,\fscx112\fscy112)\t(90,160,\fscx100\fscy100)}PERDE{\r} CLIENTES
Dialogue: 0,0:00:00.61,0:00:01.10,Cap,,0,0,0,,{\an5\pos(540,1180)}VOCÊ PERDE {\c&H0076D52B&\fscx118\fscy118}CLIENTES{\r}
```
- Palavra ativa: `#FFD400` → `&H0000D4FF&`; ênfase (EDL): `#2BD576` → `&H0076D52B&` e escala fixa 118 %.
- Primeira palavra do bloco entra com pop (85→112→100 %); as seguintes só "pulsam".
- Agrupamento: 2–3 palavras; quebrar em pontuação ou pausa ≥ 0,3 s; bloco < 0,35 s absorve a
  próxima palavra; máx. ~18 caracteres. Sem lacunas entre eventos (fim de um = início do próximo)
  para não piscar. Em pausa > 0,6 s, apagar a legenda.
- Posição: `rosto` → `\pos(540,1180)`; `dividida` → `\pos(540,960)` (na costura);
  `cartao` → sem legenda (o cartão já é o texto) ou legenda pequena em `y=1500`.
- Queimar por último, com pasta de fontes:
  `-vf "ass=captions.ass:fontsdir=./fonts"` (fonte precisa existir; libass troca em silêncio
  pela fallback; o video-use alerta "fonts fail silently" [V]).
- Mudar o escalonamento de uma palavra empurra as vizinhas na mesma linha; manter ≤ 118 % [I].

#### g) Áudio final (música com ducking, SFX, loudness)
```
[1:a]volume=0.25,aloop=loop=-1:size=2e9,atrim=duration=$TOTAL[mus];
[0:a]asplit=2[voz][sc];
[mus][sc]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=350[musd];
[voz][musd][2:a]amix=inputs=3:normalize=0:duration=first,
 loudnorm=I=-14:TP=-1:LRA=11[aout]
```
`[2:a]` = trilha de SFX já posicionada (`adelay=ms|ms` por efeito + `amix`). Para precisão, rodar
o `loudnorm` em 2 passadas (1ª com `print_format=json`, 2ª com `measured_*`) como o video-use
recomenda [V]. Verificar: `ffmpeg -i out.mp4 -af ebur128=peak=true -f null -`.

### 3.6 Autoverificação no worker (inspirada no video-use [V])
1. `ffprobe out.mp4`: 1080×1920, sem rotação, duração = soma dos segmentos (± 0,1 s).
2. `ebur128`: integrado -15..-13 LUFS, pico ≤ -1 dBTP.
3. Extrair 1 quadro 0,1 s antes e depois de cada corte (`-ss T -frames:v 1`) e montar um
   mosaico (`tile`) para revisão/log; opcionalmente pedir ao LLM com visão para checar
   "rosto cortado, legenda coberta, quadro preto".
4. Conferir que nenhuma legenda cai dentro de `y > 1450` ou `x > 960`.
5. Falhou → registrar motivo e re-renderizar com fallback (ex.: `dividida` → `rosto`).

---

## 4. Prioridades de implementação [I]
1. Normalização única de rotação + validação (resolve o vídeo de cabeça para baixo).
2. Cortes por palavra com padding 50/80 ms e fades de 30 ms (maior ganho de "naturalidade").
3. Legendas ASS karaokê 2–3 palavras na posição por layout.
4. EDL do LLM com `rosto`/`dividida`/`cartao` + Pexels portrait + fallback de texto.
5. Punch-in alternado; som (ducking, poucos SFX, -14 LUFS).
6. Autoverificação com mosaico de cortes.

## 5. Fontes
- video-use: https://github.com/browser-use/video-use (SKILL.md em `raw.githubusercontent.com/browser-use/video-use/main/SKILL.md`)
- auto-editor: https://github.com/WyattBlue/auto-editor e https://auto-editor.com/ref/options
- jumpcutter: https://github.com/carykh/jumpcutter (`jumpcutter.py`, argumentos)
- MoneyPrinterTurbo: https://github.com/harry0703/MoneyPrinterTurbo (`app/models/schema.py`, `app/services/llm.py`)
- Text-To-Video-AI: https://github.com/SamurAIGPT/Text-To-Video-AI (`utility/video/video_search_query_generator.py`)
- ShortGPT: https://github.com/RayVentura/ShortGPT
- AI-Youtube-Shorts-Generator: https://github.com/SamurAIGPT/AI-Youtube-Shorts-Generator
- ClipsAI: https://github.com/ClipsAI/clipsai
- Remotion: https://github.com/remotion-dev/remotion · skills: https://github.com/remotion-dev/skills · legendas: https://www.remotion.dev/docs/captions/create-tiktok-style-captions
- HyperFrames: https://github.com/heygen-com/hyperframes
- Motion Canvas: https://github.com/motion-canvas/motion-canvas · Revideo: https://github.com/redotvideo/revideo
- editly: https://github.com/mifi/editly · FFCreator: https://github.com/tnfe/FFCreator
- whisperX: https://github.com/m-bain/whisperX (`whisperx/alignment.py`, modelo `pt`)
- stable-ts: https://github.com/jianfch/stable-ts · pycaps: https://github.com/francozanardi/pycaps
- anthropics/skills: https://github.com/anthropics/skills
- Skills de vídeo da comunidade: https://chrislema.com/claude-code-skills-for-video-editing ·
  https://github.com/chrislema/videoeditor · https://github.com/6missedcalls/video-editing-skill ·
  https://www.kapwing.com/resources/how-to-edit-videos-with-claude-code-free-ai-video-editing-skill/
- Pexels API: https://www.pexels.com/api/documentation/
- ffmpeg (autorotate/display_rotation): https://ffmpeg.org/ffmpeg.html · https://trac.ffmpeg.org/ticket/8329 ·
  https://trac.ffmpeg.org/ticket/9895 · https://e-chocoball.blogspot.com/2025/08/software-ffmpeg-rotation-renew.html
- Zonas seguras: https://reap.video/blog/short-form-video-safe-zones · https://www.hopperhq.com/blog/instagram-reel-size/ ·
  https://www.revid.ai/instagram-reels-safe-zone
