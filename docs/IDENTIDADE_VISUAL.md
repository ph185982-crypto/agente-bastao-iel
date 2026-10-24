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
