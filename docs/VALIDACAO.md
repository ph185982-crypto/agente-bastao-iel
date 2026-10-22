# Entrega e validação — 22/10/2026

## Ativação em produção — atualização

- Endereço: https://agente-bastao-iel.vercel.app/
- Código publicado: `d0ad005b9264b98796e46dfcad20a26b64d8cc33`.
- Deploy com banco: `dpl_CxBHKrHi1WKJ2Mh7RZxd9GG4QCgH`, estado `READY`, alias de produção atribuído.
- Neon: `pedro-destrava-db`, plano Free, conectado apenas a Production, separado do banco do `nexo-backend`.
- Instagram: Página Pedro Destrava vinculada ao `@pedro_destrava`; ID Graph API separado da identidade interna dos dados.

| Validação real em produção | Resultado |
|---|---|
| Login e proteção | Login aceito; API privada sem autenticação retorna 401 |
| Banco | PostgreSQL durável reconhecido; gravação e leitura conferem o hash |
| Recuperação | Conteúdo recuperado por outra sessão autenticada |
| Revisões | Atualização gera revisão 2; revisão anterior disponível no histórico |
| Conflito | Gravação com revisão antiga retorna 409 e não sobrescreve |
| Concorrência | Seis primeiras gravações simultâneas: uma aceita, cinco conflitos |
| Arquivos | PNG enviado e baixado com bytes idênticos |
| Arte | Render real retorna PNG 1080×1350 |
| IA | Extração de três afirmações em cenário fictício identificado, via Groq/openai/gpt-oss-120b |
| Tarefa durável | Resultado da IA recuperado pela API de tarefas como concluído |
| Instagram | Conta correta, cota consultada e armazenamento disponível; sem publicações em andamento |
| Limpeza | Conteúdos, imagens e tarefa temporários de teste removidos |

Não foi publicado nenhum post. A data de expiração do token não foi confirmada:
`META_APP_ID` e `META_APP_SECRET` ainda não estão configurados para essa consulta.
A interface pública abriu no navegador; a navegação autenticada por todos os botões
e o uso em iPhone ainda não foram verificados. Login e operações acima foram testados pela API real.
Os dois testes locais opcionais de PostgreSQL continuam pulados porque este ambiente
não resolve a conexão TCP com o banco; os testes reais acima usaram a API publicada.

Suíte após a correção do ID Meta: **262 testes, 260 aprovados, zero falhas, dois pulados**.
Os conteúdos existentes no navegador do Pedro ainda precisam ser sincronizados pelo próprio app.

## Registro anterior à ativação

## O que esta versão corrige

- Título e corpo entram na mesma auditoria; título alterado invalida a conferência.
- Títulos podem ser editados na tela, preservando versões anteriores. Números
  novos no título também reabrem as afirmações relacionadas.
- Há um botão para repetir a conferência mesmo quando a tentativa anterior falhou.
- Uma resposta de auditoria incompleta não é tratada como conferência concluída.
- A correção automática do texto cancela seu temporizador quando termina.
- A leitura segura de páginas e mídias preserva o DNS validado mesmo com proxy
  global; bloqueia também IPv4 privado mapeado em IPv6 e endereços link-local.
- `npm start` entrega a interface atual junto com a API, sem redirecionamento
  implícito para a hospedagem antiga.
- Os testes agora têm comandos de execução e dependências reproduzíveis.

## Evidências

Ambiente: Linux, Node.js 24.19.0. Instalação por `npm ci`.

| Validação | Resultado |
|---|---|
| Primeira execução da suíte | 251 aprovados, 2 falhas de DNS seguro, 2 pulados |
| Suíte após correções (`npm test`) | 258 aprovados, 0 falhas, 2 pulados; 260 testes |
| Artes determinísticas | PNG 1080×1350, medidas e limites conferidos pelos testes |
| Aprovação/publicação | Máquina de estados exercitada com Meta simulada, incluindo duplicidade e hash |
| Interface entregue pelo servidor | HTTP real local: página atual, JavaScript e health; API privada bloqueada sem configuração |
| PostgreSQL | Não executado: serviço indisponível; instalação local bloqueada por permissões |
| Navegador | Não executado: Chromium instalado, mas o sistema bloqueou a criação do socket ao iniciar |
| IA e Instagram reais | Nenhuma chamada; permanecem pendentes de configuração e validação autorizada |

O resultado automatizado não certifica toda a interface nem o uso em produção.
Nenhuma métrica de velocidade da IA real foi medida nesta entrega.

## Pendências de validação de interface e conteúdo

1. Executar as suítes de navegador em um ambiente com Chromium habilitado e os
   dois testes PostgreSQL com `PICO_TEST_PG` apontando para um banco novo de teste.
2. Manter o preview isolado; não conectar testes automaticamente ao banco de produção.
3. Enviar a foto original do Pedro e o encerramento aprovado (PNG 1080×1350).
4. Validar no iPhone: entrar, gerar, revisar, salvar, reabrir, aprovar e exportar.
   A publicação real requer a aprovação explícita da versão pelo Pedro.
5. A produção já foi publicada com autorização do Pedro a partir da branch de trabalho;
   `main` não foi alterada.

## Limites mantidos

- Reels não publicam: falta armazenamento de vídeo.
- Lotes precisam do app aberto; push ainda depende de teste em iPhone real.
- Facebook continua opcional/desligado; LinkedIn é apenas esqueleto.
- Memória editorial, entrada por áudio e demais itens futuros do roteiro não
  foram implementados nesta entrega de correção e validação.
- Banco criado no plano gratuito da integração existente, sem mudança de plano.
  O teste real de IA usou o Groq já configurado; não usou a API paga da OpenAI.
  Não foi feita medição completa de custo da operação.

## Recuperação

As tabelas do sistema foram inicializadas no banco novo. Nenhum conteúdo existente
do usuário foi excluído; a limpeza atingiu somente os dados temporários dos testes.
Faça backup em Ajustes. Para recuperar o código anterior, use rollback de deploy;
preserve o banco e suas variáveis de ambiente. Não remova o banco como parte de um rollback de código.
