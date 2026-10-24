# Template editorial (Reels 9:16 com motion design)

Gera Reels de ~60 s no padrão editorial (papel rasgado, documentos em paralaxe, texto entrando palavra
a palavra, carimbos, marca-texto, transições de impacto, legendas dinâmicas) com narração na voz clonada.

## Gerar de novo

```bash
cd reels
reels-voz/bin/python editorial/render.py editorial/projetos/constituicao-1988/reel.json
```
Saídas em `saida/`: `<nome>.mp4` (final), `<nome>.previa.mp4` (leve), `<nome>.qa.md` (validação),
`<nome>.contato.png` e `<nome>.zona-segura.png` (capturas), `<nome>.fontes.txt`.

## Novo assunto (sem mexer no código)

1. Copie `editorial/projetos/constituicao-1988/` para `editorial/projetos/<novo>/`.
2. Imagens: coloque os frames de referência em `referencia/`, ajuste `midia.json` (recortes, limpeza por
   cor, borda rasgada) e rode `reels-voz/bin/python editorial/preparar_midia.py editorial/projetos/<novo>/midia.json`.
   Ou ponha PNGs prontos direto em `imagens/`.
3. Narração: escreva `roteiros/<novo>.md` (uma `## Cena` com `fala:` por cena) e gere a voz:
   `reels-voz/bin/python fazer_reels.py roteiros/<novo>.md --so-voz`.
4. Edite `reel.json`: título, perfil, cores, cenas (modelo, início/fim, textos, palavra-âncora de cada
   linha, cor por palavra, imagens, CTA). Rode o comando acima.

## Modelos de cena (`modelo` no reel.json)

| Modelo | Uso |
|---|---|
| `impacto_documento` | gancho: documento avança, fragmentos, texto em 3 tempos com impacto |
| `numero_trava` | número que rola e trava + documento que sobe + sublinhado |
| `suspense_papel` | papel rasgado, palavra gigante, palavras uma a uma, reticências pulsando, botões |
| `retrato_carimbo` | retrato que sobe, título em bloco, carimbo, documento com X desenhado |
| `assinatura` | close na caneta, assinatura escrita, título lateral, câmera controlada |
| `documento_scanner` | registro esquemático, scanner, lupa, marca-texto, título com impacto |
| `tela_dividida` | duas metades que se aproximam, palavra fixa, última palavra em destaque |
| `chamada_final` | pergunta em 3 tempos, faixa CTA que sobe e pulsa, seta que cresce |

## Componentes (engine/reel.js)

`MotionReel`, `Scene` (MODELOS), `KineticText`, `PaperReveal`, `ArchivePhoto`, `DocumentParallax`,
`ImpactTransition`, `DynamicCaptions`, `EndCard`; áudio em `audio.py` (`AudioTrack`: trilha, efeitos,
ducking, loudness); validação em `qa_editorial.py`.

## Regras de sincronia

Cada linha de texto tem `ancora` (palavra falada) ou `palavras_ancoras` (uma por palavra). O render acha o
tempo dessas palavras na narração e entra o texto nelas. Legendas repetidas com a tela são omitidas
automaticamente (`esconder_se_repetida`). Trilha própria: ponha um arquivo em `trilha.arquivo`.
