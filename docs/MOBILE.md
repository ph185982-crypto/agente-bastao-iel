# Fluxo no celular

A entrada do app é a tela **Aprovar**. Um conteúdo aparece por vez. O carrossel ocupa a largura da tela e os slides podem ser deslizados; o Reel tem reprodução com controles. A decisão é **Aprovar e publicar** ou **Refazer**. Refazer abre os motivos e um comentário opcional. O conteúdo anterior permanece no histórico de versões.

## Produção

Em **Criar**, escolha carrossel ou Reel e cole uma matéria ou um texto. A capa, pesquisa, redação, conferência e arte são preparadas no servidor. Não há aprovação intermediária. A aprovação final cobre a revisão humana da versão exibida; verificações de conta, versão, contradições, origem dos números e arte continuam em vigor.

A produção grava uma etapa de cada vez no Postgres e envia a continuação para Vercel Queues. O consumidor é privado, tem novas tentativas em caso de falha e usa uma chave por tarefa e etapa para evitar mensagens duplicadas. Cada etapa tem uma reserva e controle de revisão para impedir trabalho concorrente. Reabrir o app também permite retomar tarefas paradas. Não há publicações sem aprovação.

## Notificações e instalação no iPhone

O manifesto e o Apple Touch Icon usam os novos arquivos `app-icon-*`. Instale pelo Safari, em Compartilhar → Adicionar à Tela de Início. Abra pelo ícone, vá a **Perfil**, toque em **Ativar notificações** e permita no iPhone. A permissão precisa de um toque no próprio aparelho; o servidor não pode concedê-la. **Enviar notificação de teste** envia apenas para a assinatura do aparelho atual.

As chaves VAPID ficam no ambiente da produção; assinaturas ficam no banco. O serviço envia avisos de conteúdo pronto e de publicação concluída. Assinaturas expiradas são removidas. O navegador não mantém arquivos do app em cache.

## Formatos e retorno

Foto editorial, Impacto e Revista são variações visuais identificadas por conteúdo. Fotos ilustrativas vêm da Pexels, com origem e licença registradas. Nenhum modelo de banco de imagem é apresentado como uma pessoa da notícia. O arquivo de encerramento previamente enviado continua sendo usado quando disponível.

Motivos de reprovação são registros duráveis e idempotentes. Eles orientam tamanho do texto, fotos, capa, voz e CTA das próximas versões. Aprovações indicam preferência; não são métricas de alcance. Perfil compara somente métricas retornadas pelo Instagram e não declara um vencedor sem dados suficientes.

## Reels

O renderizador padrão gera MP4 H.264 vertical em 1080×1920, com cenas, zoom suave e legendas por blocos. Narração em português é gerada por cena com a integração Google existente, alinhada aos quadros de cada trecho. O trabalho é dividido em trechos e unido no final, sem créditos de renderização de terceiros. O MP4 final é compactado quando necessário para respeitar o limite de entrega da hospedagem. Se a voz estiver indisponível após nova tentativa, a prévia informa explicitamente que o vídeo está sem voz. O autor decide após ver e ouvir a versão final.

A mídia final fica no banco e é entregue com URL assinada e suporte a requisições Range, necessário para a reprodução e navegação no vídeo. O publicador só aceita a mídia correspondente ao hash aprovado; uma nova URL assinada é criada ao publicar. A integração Shotstack permanece opcional, desativada por padrão.

## Validação desta entrega

- 280 testes: 278 passaram; 2 dependem de PostgreSQL local opcional.
- Concorrência, aprovação única, versão desatualizada, contradições e feedback durável testados.
- Publicação de Reel testada contra a Graph API simulada, sem publicar um post real.
- Três estilos renderizados em PNG 1080×1350.
- Trechos reais de MP4 renderizados e unidos; resolução, codec e duração conferidos com ffprobe.
- Busca Pexels e geração de voz em português verificadas com as integrações reais.
- O teste Shotstack recusou a geração por saldo insuficiente; o renderizador local resolve essa dependência.
- Versão publicada em produção na Vercel, com interface, manifesto, ícones, armazenamento e notificações configurados.
- A produção real executou leitura, pesquisa, redação, conferência e arte no servidor; nenhum conteúdo de teste foi aprovado ou publicado no Instagram.
- A conexão com o Instagram confirmou a conta `@pedro_destrava` e a consulta de métricas atualizou um post real, sem inventar resultados para os novos estilos.
- Um MP4 real de 64 segundos foi compactado para 3.381.871 bytes, com H.264 e 1080×1920 preservados.
- O recebimento da notificação no iPhone depende da permissão concedida no próprio aparelho e ainda precisa ser testado nele. A publicação real de um novo conteúdo depende da aprovação do autor.

## Correção da criação interrompida

O rascunho de MEI parou na auditoria após a IA responder HTTP 429 (limite temporário de tokens por minuto). A versão corrigida mantém o conteúdo em preparação, preserva a etapa e agenda uma nova tentativa com espera, até cinco vezes. Uma etapa concluída zera o contador. A tela informa que está aguardando a IA, sem mostrar detalhes internos do provedor. Erros de cota não disparam uma repetição imediata da mesma chamada em outro formato.

Os testes reproduzem o erro 429, verificam que não há chamada antes do prazo, conferem a retomada da etapa e validam que a fila recebe o prazo de espera. A correção de filas e de cota está concluída no código local; seu envio ao GitHub e a publicação na Vercel foram bloqueados pela revisão automática. O funcionamento dessa correção em produção ainda não foi validado.
