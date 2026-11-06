# Referências de copywriting (skills públicas do GitHub)

Pesquisa feita em 06/11/2026 a pedido do Pedro: skills de IA (formato SKILL.md) baseadas nos grandes copywriters.
Os arquivos copiados aqui são de repositórios com licença MIT (cópia da licença em cada pasta). Os demais ficam só
como link: não têm licença, então usamos as ideias com as nossas palavras, sem copiar o texto.

| Repositório | Licença | O que tem | Como usamos |
|---|---|---|---|
| [srstomp/copyskills](https://github.com/srstomp/copyskills) | MIT | 15 skills; anti-slop (vícios de texto de IA), fórmulas de gancho, carrossel slide a slide | `copyskills/` aqui; adaptado em `backend/lib/mentes/antiIA.js` (detector em português + regras no prompt) |
| [lisovet/claude-skills](https://github.com/lisovet/claude-skills) — copywriting-strategist | MIT | Ângulos estratégicos com os 10 mestres; níveis de consciência e sofisticação (Schwartz); gatilhos emocionais | `copywriting-strategist/` aqui; "mercado saturado → identificação" entrou nas regras |
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | MIT | ~50 skills de marketing (copywriting, social, marketing-psychology) | Só link. O Pedro pode instalar no Claude dele: `npx skills add coreyhaines31/marketingskills` |
| [karausab590-ops/copywriting-guru-skills](https://github.com/karausab590-ops/copywriting-guru-skills) | sem licença | Uma skill por copywriter (Schwartz, Ogilvy, Halbert, Kennedy, Sugarman, Ray Edwards) | Só leitura; confirmou o que já está em `backend/lib/mentes` |
| [gist boringmarketer — Direct Response Copy Skill](https://gist.github.com/boringmarketer/96192770df22ac2a9ff4aed72b4c20f4) | sem licença | ~10 mil palavras com Schwartz, Hopkins, Ogilvy, Halbert, Caples, Sugarman, Collier; lista de "AI tells" | Só leitura |

Achado principal aplicado: o problema de qualidade dos nossos carrosséis é a FÓRMULA repetida ("não é X, é Y",
"quem paga a conta", "discurso"), que as listas anti-slop apontam como a marca nº 1 de texto de IA, e o tema
saturado (nível 5 de sofisticação de Schwartz), em que só identificação e história param o dedo.
