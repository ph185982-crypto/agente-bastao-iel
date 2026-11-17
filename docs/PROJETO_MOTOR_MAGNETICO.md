# Projeto Motor Magnético (@pedro_destrava)

Versão 2, revisada por uma banca de quatro especialistas (copywriter de resposta direta, editor de retenção,
estrategista de Instagram e de marca, engenheiro do app). Os quatro deram "aprovado com ajustes"; os ajustes já estão
neste texto. Objetivo: roteiros mais persuasivos, edição pensada corte a corte e conteúdo que segura a base, sem custo
novo e sem passo obrigatório novo para o Pedro. Não há promessa de viralização: o motor é medido contra a mediana do
próprio perfil.

## 1. O que já existe e o que falta

Já existe: pautas automáticas, roteirista com skill destilada de 40 especialistas, 12 formatos, fiscal de 15 critérios,
teleprompter, editor Destrava (cenas, legenda de uma palavra, sons, trilha, capa com o gancho, corte de pausas), legenda
do post, carrossel do vídeo, coleta de métricas por Reel e pesos 80/20 no placar.

Falta, e é o que o projeto entrega:
1. O roteiro nasce de UMA tentativa de gancho. Copywriter bom escreve vários e escolhe.
2. O roteirista escreve sem decidir antes o ângulo (crença, virada, inimigo, emoção).
3. A edição é decidida depois da gravação, por uma IA que não sabe a intenção de cada frase.
4. As métricas reais não enxergam as etiquetas do roteiro (tipo de gancho, emoção), então não ensinam nada ao motor.

## 2. Os motores

### Motor 1: Ângulo
Antes de escrever, uma chamada curta decide:
- crença atual do público, virada, inimigo (ideia, regra ou hábito; nunca pessoa) e o que está em jogo no bolso;
- emoção dominante (indignação no máximo em 1 de cada 3 roteiros);
- nível de consciência, que MUDA a abertura: não sabe do problema → abre por cena ou consequência; sabe do problema →
  abre pelo erro; sabe da solução → abre pela diferença entre as soluções;
- a objeção que o dono do negócio vai pensar ("se eu não der desconto, perco a venda").
O código recusa ângulo repetido (mesmo inimigo + mesma emoção) nos últimos 7 roteiros.

### Motor 2: Laboratório de ganchos
Na mesma chamada do ângulo, a IA devolve até 8 ganchos de tipos diferentes: contraste, número, erro que custa caro,
identidade, pergunta que dói, cena e reenquadramento.
- Número e confissão só se o fato estiver na pauta; sem isso, o tipo fica vazio. Cena sempre em "você", no presente,
  nunca como caso real inventado.
- O código só ELIMINA: mais de 9 palavras faladas, abertura proibida, vício de IA, nome de político ou partido, número
  fora da pauta, gancho que não compartilha nenhum substantivo com o payoff.
- Entre os que sobram, a banca escolhe com uma pergunta: qual deixa uma dúvida que só o vídeo responde?
- Os dois reservas prometem o mesmo payoff. Só assim o Pedro pode trocar o gancho com um toque (opcional, fase final).

### Motor 3: Roteiro
Batidas com função: gancho → aposta → virada → prova → objeção respondida → payoff → CTA.
Regras novas (o que a skill atual já cobre não se repete):
- o gancho anuncia a consequência da virada, sem explicar o mecanismo;
- prova sem número = uma cena única, com objeto, momento e fala do cliente;
- antes do payoff, uma fala diz a objeção com as palavras do dono e a responde;
- uma frase de print só, na virada, até 12 palavras, completa sozinha;
- o loop é feito pelo payoff, que repete palavras do gancho; depois, CTA de até 6 palavras;
- frase de até 12 palavras; a solução não pode sofrer do defeito que o roteiro critica.

### Motor 4: Direção
Fase própria (não cabe na chamada do roteiro num modelo gratuito). Para cada frase, direção compacta: tipo de cena,
texto de tela, palavra de ênfase e dica de gravação. A busca da imagem e o título continuam com o plano atual.
- Quando o Pedro grava pelo teleprompter, o servidor casa a direção com a fala por semelhança de texto; frase sem par
  cai no plano automático de hoje.
- As dicas de gravação (gesto, pausa, objeto) aparecem no teleprompter num campo separado, fora do texto lido.

Regras de edição fixas, em código, no editor (roda no GitHub Actions, sem custo de servidor):
1. Ritmo por eventos: de 0 a 3 s, algo novo a cada 1 s; de 3 a 10 s, a cada 2,5 s; depois, a cada 4 s. Nenhuma cena
   passa de 5 s. Item de lista que acende conta como evento.
2. Texto do gancho inteiro na tela desde o quadro zero; trilha desde o segundo zero.
3. Nunca duas cenas do mesmo tipo seguidas.
4. Close no rosto: no máximo 3 por vídeo, de 1,2 a 3,5 s, com 6 s ou mais entre eles, liberado a partir de 2,5 s.
5. Frase de print vira cartão com a frase inteira (dá para tirar print) e fica 0,6 s depois da fala.
6. Zoom na palavra de ênfase (1,00 → 1,08 em 0,1 s, segura 0,6 s), no máximo 1 a cada 5 s. Aproximação lenta contínua
   (1,00 → 1,04) na janela e no close.
7. Sons: impacto no máximo 3 por vídeo (abertura, frase de print, número); whoosh só na troca de layout; 1 s ou mais
   entre sons.
8. Silêncio de 0,3 s na trilha antes da virada e da frase de print; a trilha volta no clima novo depois do silêncio.
9. Pausa acima de 0,35 s cai para 0,15 s; uma pausa marcada por vídeo (antes da virada) fica com até 0,6 s.
10. Etiqueta pequena no topo com a promessa aberta, da aposta até o payoff.
11. Fim em loop: último bloco no layout do primeiro, com o título do gancho de volta, sem escurecer, corte seco na
    última palavra, trilha some em 0,15 s.

### Motor 5: Pacote
- Capa e legenda do post já existem; passam a nascer do roteiro (gancho curto na capa; legenda abre com os termos de
  busca do tema e NÃO faz pergunta, para não competir com o pedido do vídeo).
- Um pedido por vídeo: envio em no máximo metade dos Reels; o restante alterna salvar e comentar, conforme o formato.
- Comentário fixado e story: o app entrega o TEXTO pronto para copiar (o app não publica comentário nem figurinha).
  Um story só, opcional, depois de publicar. Sem enquete antes do Reel (ela entrega a virada).
- Nome de político ou partido proibido também em capa, legenda, comentário e story.

### Motor 6: Aprendizado
Sem IA. Com cerca de 3 Reels por semana a amostra é pequena, então as regras são conservadoras:
- cada vídeo guarda as etiquetas do roteiro (começa com formato e tipo de gancho; emoção e duração depois);
- janela dos últimos 30 Reels, uma etiqueta por vez, métrica lida com 7 dias de idade;
- nota do vídeo, sempre dividida pelo alcance: envios 40%, tempo assistido sobre a duração 35%, curtidas 15%,
  salvamentos 10%. Comentários ficam fora (briga infla o número);
- "indício" só com 6 ou mais Reels na etiqueta; "regra" com 8 ou mais. Antes disso, 50/50 e "sem dado" no resumo.
  Depois, no máximo 70/30;
- o motor otimiza dentro de cada pilar, nunca entre pilares (opinião continua com a cota do playbook);
- continuação só para vídeo no quarto superior de envios por alcance, e ela se entende sozinha, sem "parte 2" no gancho;
- resumo semanal de 3 linhas no app, com seguidores por mil alcançados.
Séries com dia fixo ficam fora por enquanto (não há base no app nem cadência que sustente).

## 3. A banca dentro do motor
Continua sendo UMA chamada de IA por roteiro, com papéis e notas separadas. Cada papel devolve só a nota, a frase mais
fraca (citada literalmente) e a reescrita.
- Copywriter: gancho, promessa = entrega, objeção, frase de print, CTA.
- Diretor: a cena combina com o sentido da frase?
- Tom e marca: soa como o Pedro, firme sem ataque pessoal.
O que é aritmética ou regra sai da IA e vira código: número fora da pauta, político e partido, palavras de promessa,
ritmo (palavras ÷ 2,7 por segundo), tipos repetidos, orçamento de sons.

## 4. Custo e esforço
- IA: só gratuita. Cada roteiro passa de 2 para 4 chamadas (ângulo e ganchos, roteiro, direção, banca). Risco real: a
  cota diária gratuita render menos roteiros por dia. Mitigação: ângulo e ganchos são reaproveitados na reescrita.
- Servidor: mais fases = mais rodadas do piloto. As regras de edição rodam no GitHub Actions, fora da Vercel.
- Pedro: nenhum passo obrigatório novo.

## 5. Exemplo revisado pela banca

Pauta (opinião, sem número): dar desconto para fechar venda. Crença: "desconto ajuda a vender". Virada: "desconto
ensina o cliente a esperar". Objeção: "se eu não der, ele compra do vizinho".

| # | Fala | Cena | Texto de tela | Corte, zoom e som | Gravação |
|---|------|------|---------------|-------------------|----------|
| 1 | "O desconto de hoje estraga a sua venda do mês que vem." | Janela, título inteiro no quadro zero | DESCONTO ESTRAGA A PRÓXIMA VENDA | Impacto na abertura; trilha tensa desde 0 s | Olho na câmera |
| 2 | "E o dinheiro que você perde na hora é o de menos." | Close no rosto | etiqueta no topo: O EFEITO PIOR | Whoosh na troca | Inclina para a frente |
| 3 | "O cliente pede desconto. Você dá. Ele fecha." | Janela, lista que acende | PEDE · VOCÊ DÁ · FECHA | Cada item é um evento | Conta nos dedos |
| 4 | "Parece vitória. Mas você acabou de ensinar uma coisa pra ele." | Janela, ícone X | VOCÊ ENSINOU O CLIENTE | Pausa de 0,5 s antes do "mas" | Pausa marcada |
| 5 | "Mês que vem ele volta, olha o preço e pergunta: faz aquele precinho de novo?" | Cena cheia 2 s, depois gráfico que desce | ELE ESPERA → O PREÇO CAI | Corte para tela cheia | Fala em off |
| 6 | "Quem vende no desconto treina o cliente a nunca pagar preço cheio." | Cartão de frase (VERDADE), frase inteira | a frase completa | Silêncio de 0,3 s antes; zoom e impacto em "nunca" | Fala devagar |
| 7 | "Aí você pensa: se eu não der, ele compra do vizinho." | Close no rosto | (sem texto) | Trilha volta animada depois do silêncio | Tom de conversa |
| 8 | "Então segura o preço e entrega mais: algo que custa pouco pra você e vale muito pra ele." | Janela, comparação | TIRAR DO PREÇO × ENTREGAR MAIS | Whoosh | Mão abre para o lado |
| 9 | "Instalação incluída. Troca sem burocracia." | Janela, lista | INSTALAÇÃO · TROCA FÁCIL | Itens acendem | Conta nos dedos |
| 10 | "Assim a venda de hoje não estraga a do mês que vem." | Layout da linha 1, título do gancho de volta | DESCONTO ESTRAGA A PRÓXIMA VENDA | A etiqueta sai; sem escurecer | Olho na câmera |
| 11 | "Manda pra quem deu desconto essa semana." | Mesmo layout | (legenda) | Corte seco na última palavra | Aponta para a câmera |

## 6. Ordem de entrega (recomendada pelo engenheiro)
1. Banca com papéis + ângulo + laboratório de ganchos. Tamanho médio. Melhora o roteiro já.
2. Etiquetas do roteiro no vídeo e no placar. Pequeno. Antecipado para começar a juntar dado.
3. Roteiro com as regras novas + direção em fase própria + dicas no teleprompter. Grande.
4. Regras de edição no editor (ênfase, tipo repetido, silêncio e troca de trilha, etiqueta, loop). Médio.
5. Pacote (capa e legenda a partir do roteiro, textos de comentário e story) e troca de gancho. Pequeno a médio.
6. Resumo semanal e continuação. Médio.
