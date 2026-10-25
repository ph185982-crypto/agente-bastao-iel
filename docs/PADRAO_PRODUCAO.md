# Padrão de produção do @pedro_destrava

Define como o motor escreve e revisa os carrosséis. Fonte única no código: `static/editorial.js`
(`VOZ`, `ESTRUTURA_PADRAO`, `FRASES_PROIBIDAS`, `padraoParaPrompt`, `CRITERIO_APROVACAO`), usada pelo prompt
de `backend/lib/redacao.js` e pelos gates de `static/qualityGates.js`. Nada aqui promete viralização: o padrão
organiza a produção; o resultado vem do público (aba Resultados).

## Objetivo e posicionamento

- Construir uma comunidade que acompanha a visão do Pedro: seguidores gerados, compartilhamentos, salvamentos e conversas relevantes.
- Posicionamento: “o cara que mostra a estratégia escondida por trás”.
- Voz autoral de direita (liberdade econômica, responsabilidade fiscal, família, iniciativa privada), com opinião clara
  **sempre sustentada por fatos**. A perspectiva orienta o enquadramento e nunca autoriza inventar manchete, depoimento,
  número ou documento. Fato, alegação, hipótese e opinião continuam distintos (modelo de evidências).
- Lógica: curiosidade → mecanismo e explicação → aplicação ao negócio só quando houver ligação concreta.

## Estrutura recorrente e as funções de slide

| Etapa | Função no código | O que o slide faz |
|---|---|---|
| FACE | `capa` | Protagonista ou situação real, assunto nomeado, tensão concreta. Capa curta e específica. |
| GAP | `contexto` | O que falta entender; UMA pergunta que o próximo slide responde; informação nova, sem repetir a capa. |
| PROVA | `prova` | Dado, documento, declaração ou exemplo verificável, com data, período, unidade e fonte. Exemplo fictício aparece como exemplo. |
| CONTRADIÇÃO OU CONSEQUÊNCIA | `comparacao` ou `consequencia` | Distância entre discurso e prática, ou a consequência do fato. Sem forçar contradição que a evidência não sustenta. |
| LEITURA DO PEDRO | `opiniao` (e `explicacao` do mecanismo) | Mecanismo, posição clara e consequência concreta, marcada como opinião. O penúltimo slide fecha o raciocínio e dá motivo para seguir. |
| CTA | `encerramento` | Encerramento fixo; uma chamada principal (seguir @pedro_destrava) com motivo específico da pauta. |

Quantidade: base de **6 a 7 slides contando o encerramento** (4–5 de conteúdo + fecho). Expande quando a pauta exige, sem tela para preencher espaço.

## Regras de texto e o que o código confere

| Regra | Onde | Tipo |
|---|---|---|
| Nunca usar “pensar antes de reagir” (e variações: pense, pensando, caixa alta) | gate `frase_proibida`; prompt; `problemas_de_forma` (gera uma 2ª tentativa); playbook (clichê) | **bloqueio** |
| Capa curta (até 12 palavras na arte; 4–10 no prompt) | `LIMITE_PALAVRAS`, prompt | sugestão (`excesso_texto`) |
| Miolo de 25 a 45 palavras como referência flexível | prompt; limite de 45 em `explicacao` | sugestão (não há mínimo: menos é bem-vindo se a mensagem está completa) |
| Segundo slide acrescenta, não repete a capa | `segundo_repete_capa`; `problemas_de_forma` | sugestão + volta para correção |
| Slides repetindo a mesma ideia | `repeticao` | sugestão |
| Base de 6–7 slides | `poucos_slides`, `muitos_slides` | sugestão |
| Posição do Pedro presente | `sem_leitura_do_pedro` | sugestão |
| Há prova com fonte | `sem_prova` e `slide_sem_base` | sugestão |
| Penúltimo slide fecha o raciocínio | `penultimo_nao_fecha`, `conclusao_fraca` | sugestão |
| Um CTA principal com motivo específico | `cta_varias_acoes` (bloqueio no editorial), `cta_generico`, `cta_sem_relacao` | bloqueio / sugestão |
| Legenda curta e complementar | `legenda_longa` (acima de 700 caracteres); prompt (até 600) | sugestão |
| Três hashtags relevantes quando aplicável | prompt (o código limita a 3) | — |
| Números, citações, atribuições, selo falso, conta errada | gates já existentes | **bloqueio** |

Os gates de estrutura só valem para carrossel de 3 telas ou mais; post único e peças de 1–2 telas não recebem esses avisos.

## Critério de aprovação (lista do Pedro)

| Pergunta | Quem confere |
|---|---|
| A capa faz parar? | **Você** (julgamento humano) |
| O segundo slide sustenta a curiosidade? | Código ajuda (`segundo_repete_capa`); confirme a pergunta do GAP |
| Cada tela acrescenta algo? | Código ajuda (`repeticao`, `segundo_repete_capa`) |
| As provas sustentam a conclusão? | Código (auditoria de textos, `fato_sem_fonte`, `sem_prova`); confirme que a conclusão não passa da evidência |
| A posição do Pedro está clara? | Código ajuda (`sem_leitura_do_pedro`) |
| Existe motivo para seguir o perfil? | Código ajuda (`cta_generico`, `penultimo_nao_fecha`) |
| A arte parece humana e é legível no celular? | **Você** (o código só bloqueia texto cortado, `texto_cortado`) |

## Dependências e decisões do Pedro

1. **Encerramento fixo (“Eu comecei o Pedro Destrava por isso”).** O arquivo aprovado ainda precisa estar na ferramenta
   (Ajustes → Encerramento). Sem ele, a arte usa um encerramento só de texto, sinalizado como provisório
   (`encerramento_provisorio`). Com o arquivo, ele entra **sem ser reconstruído**: o código não desenha outro rosto
   nem refaz o texto. **A troca da numeração para o total do carrossel não está implementada**: o número está dentro da
   imagem original e só dá para alterá-lo sabendo onde ele fica e com que fonte foi desenhado. Para fazer isso é preciso
   o arquivo original (ou as coordenadas, a fonte e a cor do número).
2. **Fontes.** O padrão anterior cita Montserrat Black/Bold e Inter. A arte atual usa **Manrope ExtraBold/Bold e Inter**
   (identidade Avanteza decidida antes). Nada foi trocado. Se você quiser Montserrat de volta nos títulos, é uma decisão
   sua: avise e a troca fica restrita a `backend/lib/arte.js` e aos arquivos em `backend/assets`.
3. **Foto do Pedro só no último slide, sem círculo.** O retrato depende do arquivo recortado (PNG com fundo transparente);
   ver `docs/IDENTIDADE_VISUAL.md`.
4. **Imagens.** Fotografias reais, prints e documentos legíveis dependem da busca de imagens e da origem registrada
   (`imagem_sem_origem` bloqueia). Imagem gerada por IA só pode ilustrar ideia, não representar registro real.
5. **Perspectiva política.** O posicionamento de direita orienta a interpretação. Se os fatos não sustentam a conclusão
   desejada, o briefing registra o conflito e propõe outro enquadramento em vez de forçar a tese.
