---
titulo: A conta da Black Friday
template: fluxo
entradas: preco=100; produto=45; comissao=20%; frete=10; imposto=6%; anuncio=8
cenario: desconto=25%
---

<!-- fontes (ignorar no parser):
- EXEMPLO ILUSTRATIVO. Todos os valores de entrada são hipotéticos e vão aparecer na tela com o aviso "exemplo ilustrativo". Substituir por dados reais de cliente (com autorização) quando houver.
- Regra do exemplo: comissão e imposto acompanham o preço (percentuais); produto, frete e anúncio são fixos por unidade.
- Conta feita em código (não pelo texto): sobra normal = 100 - (45 + 20 + 10 + 6 + 8) = 11. Com 25% de desconto: preço 75; comissão 15; imposto 4,50; sobra = 75 - (45 + 15 + 10 + 4,50 + 8) = -7,50. Custos que acompanham o preço caem 6,50 (de 26 para 19,50). Perda de sobra: 18,50.
- Desconto máximo sem prejuízo: 1 - 63 / (100 x 0,74) = 14,86%. Arredondar PARA BAIXO: 14,8%.
- Black Friday 2026: 27/11/2026 (Central do Varejo).
-->

## Cena 1
texto-na-tela: Você vende por R$ 100. Quanto sobra?
fala: Você vende um produto por cem reais. {preco} Quanto sobra no seu bolso?
evento: grade de 100 quadrados monta em onda; etiqueta "R$ 100"; aviso "exemplo ilustrativo"

## Cena 2
texto-na-tela: Produto: R$ 45
fala: Primeiro, {produto} o custo do produto: quarenta e cinco reais.
evento: tira 45 quadrados (cor produto); saldo 100 para 55

## Cena 3
texto-na-tela: Comissão da plataforma: 20% = R$ 20
fala: Depois, {comissao} a comissão da plataforma: vinte reais.
evento: tira 20 quadrados (vermelho); saldo 55 para 35

## Cena 4
texto-na-tela: Frete: R$ 10
fala: O {frete} frete: dez.
evento: tira 10 quadrados (amarelo); saldo 35 para 25

## Cena 5
texto-na-tela: Imposto: 6% = R$ 6
fala: O {imposto} imposto: seis.
evento: tira 6 quadrados (roxo); saldo 25 para 19

## Cena 6
texto-na-tela: Anúncio: R$ 8
fala: E o {anuncio} anúncio: oito.
evento: tira 8 quadrados (azul claro); saldo 19 para 11

## Cena 7
texto-na-tela: Sobra: R$ 11
fala: Sobraram {sobra} onze reais. Onze por cento.
evento: 11 quadrados verdes brilham; contador "R$ 11 (11%)" pulsa

## Cena 8
texto-na-tela: Black Friday: -25%
fala: Agora chega a Black Friday, e você dá {desconto} vinte e cinco por cento de desconto.
evento: carimbo "-25%" com impacto; grade encolhe de 100 para 75 quadrados

## Cena 9
texto-na-tela: Preço -R$ 25 · Custos -R$ 6,50 · Sobra: -R$ 7,50
fala: O preço cai vinte e cinco reais, mas os custos só caem seis e cinquenta. Produto, frete e anúncio continuam iguais. {prejuizo} Resultado: você paga sete reais e cinquenta pra vender.
evento: faltam quadrados para cobrir os custos; os que faltam surgem em vermelho (buraco); contador cruza o zero e fica negativo; tela esquenta para vermelho por um instante

## Cena 10
texto-na-tela: Desconto máximo: 14,8%
fala: Nesse exemplo, o limite é {limite} catorze vírgula oito por cento de desconto. Passou disso, é prejuízo.
evento: controle deslizante vai de 0 a 25%; contador de sobra desce ao vivo; marca "ponto de equilíbrio" em 14,8% onde o contador chega a zero

## Cena 11
texto-na-tela: Faça a conta antes.
fala: Faça a conta antes de dar o desconto. Manda esse vídeo pra quem vai vender na Black Friday.
evento: fecho limpo com a frase; sem promessa de isca (calculadora ainda não existe)
