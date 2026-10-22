# Entrega e validação — 22/10/2026

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

## Para concluir a ativação

1. Executar as suítes de navegador em um ambiente com Chromium habilitado e os
   dois testes PostgreSQL com `PICO_TEST_PG` apontando para um banco novo de teste.
2. Confirmar `APP_ACCESS_CODE`, conexão do banco, provedor de IA e configuração
   Meta no ambiente de preview, sem expor valores em chat ou arquivos versionados.
3. Enviar a foto original do Pedro e o encerramento aprovado (PNG 1080×1350).
4. Validar no iPhone: entrar, gerar, revisar, salvar, reabrir, aprovar e exportar.
   A publicação real requer a aprovação explícita da versão pelo Pedro.
5. Somente depois solicitar autorização para promover a branch para `main`.

## Limites mantidos

- Reels não publicam: falta armazenamento de vídeo.
- Lotes precisam do app aberto; push ainda depende de teste em iPhone real.
- Facebook continua opcional/desligado; LinkedIn é apenas esqueleto.
- Memória editorial, entrada por áudio e demais itens futuros do roteiro não
  foram implementados nesta entrega de correção e validação.
- Nenhum serviço foi contratado, plano alterado ou conta criada. Testes não
  consumiram APIs pagas; custo da operação real continua desconhecido.

## Recuperação

As alterações não incluem migração nem exclusão de dados. Faça backup em Ajustes
antes da ativação. Para recuperar o código anterior, reverta os commits desta
entrega na branch de trabalho. Conteúdos e versões existentes são preservados.
