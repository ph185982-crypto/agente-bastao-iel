# Kit Avanteza — guia curto do visual "vidro"

Vale para toda a plataforma (Central, Comercial/Vendedor IA, Conteúdo…). Fonte única: `tokens.css` (nomes `--avz-*`
estáveis). Referência viva: a Central (`avanteza/src/app/globals.css`, `components/shell/*`, `tests/visual.test.ts`).

## Como usar num app

1. Copie `tokens.css` para o app (ex.: `src/styles/avanteza-tokens.css`) com o cabeçalho
   `/* cópia do kit (packages/avanteza-kit/tokens.css), não editar aqui */`. Mudou o kit? Copie de novo nos apps.
2. Tema no `<html>`: `data-theme="light|dark"` (apps com Tailwind põem também a classe `dark`). Aplique **antes da
   pintura** com um script inline no `<head>`: escolha lembrada (`localStorage`/cookie `avanteza-tema`) > sistema
   (`prefers-color-scheme`). Mesmo botão sol/lua em todos os apps (`aria-label` "Mudar para o tema claro/escuro").
3. Fonte: Plus Jakarta Sans via `next/font` com `variable: "--font-jakarta"` (400–800); use `var(--avz-font)`.
4. Fundo: `html { background: var(--avz-bg) }` e duas orbes fixas (`body::before/::after`, z-index -1):
   laranja no canto superior esquerdo (`rgba(255,106,31,var(--avz-orb-orange-a))`) e azul no inferior direito
   (`rgba(59,130,246,var(--avz-orb-blue-a))`), `radial-gradient(closest-side, …)`, animação lenta só de `transform`.
5. Superfícies de vidro: gradiente `rgb(var(--avz-glass-rgb) / var(--avz-glass-strong-a))` →
   `… / var(--avz-glass-a)`, borda `var(--avz-glass-border)`, `box-shadow: var(--avz-shadow)`,
   `backdrop-filter: blur(var(--avz-blur)) saturate(1.25)`. **Sempre** com fallback:
   `@supports not (backdrop-filter: blur(1px)) { … background: var(--avz-solid) }`. Diálogos, menus e popovers usam
   `var(--avz-solid-2)` (quase opacos: o conteúdo atrás não pode atrapalhar a leitura).
6. Forma: cartões `--avz-radius` (22px), diálogos/sidebar `--avz-radius-lg` (26px), campos `--avz-radius-md` (14px),
   botões e pílulas `--avz-radius-pill`. Sombras só as do kit (`--avz-shadow`, `--avz-shadow-sm`, `--avz-glow`).

## Regras de cor

- Texto: `--avz-text`, secundário `--avz-muted`, rótulos `--avz-heading`. Todos ≥ 4,5:1 no **pior caso do fundo**
  (pico da orbe + vidro empilhado) nos dois temas — cada app tem um teste que calcula isso.
- Laranja `--avz-orange` é **preenchimento** (botão principal, item ativo do menu, pílula de destaque) com texto
  **marinho** (`--avz-navy`), hover `--avz-orange-hover`. Laranja como texto/ícone/foco: só `--avz-accent-text`
  (queimado no claro, pêssego no escuro). Nunca laranja puro como texto sobre fundo claro; nunca branco sobre laranja.
- Sem hex soltos nas telas: cores vêm dos tokens. Exceções conhecidas: marcas de terceiros (Meta, WhatsApp…) e séries
  de gráficos, isoladas e listadas no teste de marca do app.

## Navegação (AppShell)

Sidebar de vidro flutuante (16px da borda, raio 26px) com grupos por departamento (rótulo em maiúsculas), ícones de
traço, item ativo laranja com texto marinho e brilho; recolhível a uma coluna de ícones de 72px com persistência
(`data-sidebar="collapsed"` no `<html>`, chave `avanteza-menu`, aplicada antes da pintura); no celular vira gaveta
com fundo escurecido (Esc fecha) e uma barra superior com menu, logo, sino e tema. Todo app tem o atalho **Central**
de volta a `app.avanteza.com.br`. Sob o mesmo domínio (ex.: `/comercial`), as chaves `avanteza-tema` e
`avanteza-menu` são compartilhadas: o tema e o menu acompanham a pessoa entre os módulos.

## Legado

`static/avanteza.css` e `static/marca.css` (apps Python antigos) ainda usam a cópia v2.0 "plana" (raio 6px, sem
sombras); migram para estes tokens quando forem tocados.
