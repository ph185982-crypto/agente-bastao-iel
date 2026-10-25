# Identidade visual da arte (Pedro Destrava)

A arte dos carrosséis segue a identidade definida pelo Pedro (a mesma direção da Avanteza).
Tudo é desenhado por `backend/lib/arte.js`, de forma determinística: mesma entrada, mesmo PNG.

| Item | Valor |
|---|---|
| Azul principal | `#2448FF` (capas, fundos de impacto) |
| Laranja de destaque | `#FF7043` (só como ponto de atenção: colchetes sobre fundo escuro, filete, marcador) |
| Branco quente | `#F6F5F0` (fundo claro; texto sobre azul e grafite) |
| Grafite | `#18191D` (texto sobre claro; fundo da opinião) |
| Cinza de apoio | `#686A73` (fontes e créditos sobre fundo claro) |
| Títulos | Manrope ExtraBold 800 (capa 88–116 px; internos 64–84 px) |
| Subtítulos / rótulos | Manrope Bold 700 |
| Texto | Inter Regular 400 (apoio 36–44 px); destaques Inter Bold/SemiBold |
| Fontes e créditos | Inter SemiBold 24–28 px |
| Margens | 80 px (a identidade pede pelo menos 72) |

## Regras aplicadas pelo código

- Texto que não cabe **não é espremido**: abaixo do mínimo do papel a arte sai com `cabe:false` e a revisão bloqueia. Encurte o texto.
- **Uma expressão em destaque por tela**, enquadrada por colchetes `[ ]` (azul no fundo claro, laranja no fundo escuro). Os demais `**destaques**` do texto viram texto comum.
- Fundos alternam por função: capa, contexto, prova, explicação e comparação em claro; consequência e encerramento em azul; opinião em grafite. `slide.fundo` (`claro`, `azul`, `grafite`) força um fundo.
- Sem rótulos internos ("contexto", "explicação"); só a opinião leva a marca "minha leitura".
- Tela com só uma frase curta (até 170 caracteres, sem título) vira manchete em letra de título.
- Capa fotográfica: foto em cima e painel azul chapado embaixo (sem gradiente); o texto nunca depende da foto.
- Encerramento: o arquivo aprovado pelo Pedro entra sem ser reconstruído; sem ele, sai um encerramento tipográfico sinalizado como provisório.
- Nenhum selo de verificação, ícone decorativo, efeito 3D ou brilho. O logotipo da Avanteza **não é redigitado**: só entra quando houver o arquivo final.

As fontes ficam em `backend/assets` (Manrope e Inter, licença SIL OFL; ver `backend/assets/FONTES-LICENCAS.md`).
Os módulos antigos (Editor de Vídeo, cortes de TV) ainda usam Poppins e PT Serif e não foram alterados.

## Onde a identidade vale

- **Mesa (fluxo completo)**: layouts de `arte.js` (capa, explicação, prova, comparação, encerramento, capa com foto).
- **Estúdio de um toque** (`design: 'editorial_2026'`, `editorialStudio.js`): mesmas cores, Manrope e Inter e colchetes.
  A estrutura das composições (capa, texto, número, recorte, comparação, pergunta, manifesto, encerramento) é a do Codex e não mudou.
  Estilos que dependiam de serifa ou de outra cor de acento (`revista`) agora seguem a identidade.
- **Encerramento com o retrato do Pedro**: o arquivo `backend/assets/template-editor-viral.png` traz o azul-marinho antigo no fundo.
  Enquanto não houver um retrato recortado (PNG com fundo transparente), esse slide mantém `#0A1B33` para não aparecer uma caixa escura sobre o azul.
- **Não alterados**: Editor de Vídeo, cortes de TV, vídeos em movimento (`motionLocal.js`) e os estilos experimentais `impacto`/`foto_editorial`
  desenhados por `renderExperimental`: continuam com Poppins e a paleta anterior.

## Interface do app (Estúdio)

O app segue a mesma identidade da arte, definida em `static/marca.css` (última folha carregada; as demais só mantêm a estrutura).

| Item | Valor |
|---|---|
| Fundo | branco quente `#F6F5F0`; cartões `#FCFBF8` com borda `#DFDCD0`, sem sombra |
| Ação principal | azul `#2448FF` (aprovar, criar, publicar) |
| Atenção | laranja `#FF7043`: só contadores, avisos e os colchetes |
| Estrutura | grafite `#18191D` (trilho lateral no computador, abas e botões secundários) |
| Títulos | Manrope ExtraBold; texto em Inter (fontes em `static/*.woff2`, subconjunto latino) |
| Marca | colchetes `[ ]`: rótulos em caixa alta e uma palavra de destaque por título (`<span class="br">`) |
| Logotipo do app | `[P]` em `static/logo-app.svg` e ícones PNG, gerados por `node scripts/gerar-icones.js` |

- Celular: barra de navegação inferior com marcador azul na aba ativa. Computador: trilho grafite à esquerda.
- A tela **Aprovar** mostra o trilho do fluxo (roteiros → em preparação → carrosséis para validar → publicados) e o estado do monitor.
- As folhas antigas foram retematizadas por `python3 scripts/retema-css.py static/*.css` (troca cores azul-acinzentadas pelos tons da marca; pode rodar de novo sem efeito).
- A aba **Ferramentas** (módulo antigo, estilos em linha) recebeu só o essencial; ainda não foi redesenhada por dentro.
- Divergência registrada: o padrão de produção anterior cita Montserrat; o app e a arte usam Manrope e Inter (identidade Avanteza). Trocar é decisão do Pedro.

## Visual "Reportagem" dos carrosséis

Além da identidade acima, os carrosséis podem sair no visual **Reportagem** (marinho, amarelo, vermelho, Anton, rosto recortado). É o padrão; troque em Perfil → Visual dos carrosséis. Detalhes e regras em `TEMA_REPORTAGEM.md`.
