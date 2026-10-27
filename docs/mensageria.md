# Mensageria e eventos

## Papel do RabbitMQ

RabbitMQ é o broker dos eventos assíncronos entre serviços de domínio e `notification-service`. O produtor persiste/aceita a operação local e publica um evento; o consumidor processa o evento e registra a notificação sem exigir chamada síncrona ao serviço de notificações pelo caminho da requisição original.

O Compose declara `rabbitmq:3.13-management-alpine`, credenciais de ambiente, porta de management `15672` e health check por `rabbitmq-diagnostics`. A porta AMQP `5672` é interna à rede Compose. Serviços consumidores/produtores configuram `RABBITMQ_URL` e dependem de `rabbitmq` saudável na inicialização. A condição `depends_on: service_healthy` ordena a partida; não reinicia automaticamente uma operação nem prova resiliência a uma falha posterior do broker.

## Fluxo lógico

```text
API Gateway
   │ HTTP/JSON
   ▼
Serviço de domínio ── publica evento ──► RabbitMQ ──► notification-service
       │                                                   │
       ▼                                                   ▼
 banco do domínio                                    banco de notificações
```

O gateway encaminha requisições HTTP. O broker é usado para efeitos colaterais assíncronos, como notificar sobre mudanças acadêmicas/administrativas. Consultas de dados continuam sendo atendidas pelo serviço proprietário; filas não substituem a API síncrona de leitura. Nenhum serviço deve ler ou escrever diretamente no banco de outro serviço.

## Eventos previstos

O esquema final dos eventos deve ser consolidado com a implementação. A tabela abaixo descreve os fatos de domínio esperados, não nomes de exchange/filas confirmados:

| Fato | Produtor lógico | Consumidor lógico | Dados mínimos sugeridos |
|---|---|---|---|
| Nota registrada/alterada | `academic-service` | `notification-service` | identificador do evento, aluno, disciplina, nota/peso, instante |
| Média calculada | `academic-service` | `notification-service` | identificador do evento, aluno, disciplina, média, instante |
| Presença registrada | `academic-service` | `notification-service` | identificador do evento, aluno, turma/disciplina, estado, data |
| Alteração administrativa relevante | `administrative-service` | `notification-service` | identificador do evento, tipo/recurso, referência e instante |

Eventos devem ser versionados e conter identificador único e timestamp. Recomenda-se consumidor idempotente, acknowledgements após persistência da notificação, política explícita para mensagens inválidas e retentativa com backoff/DLQ. Essas propriedades devem ser confirmadas no código e documentadas junto ao schema efetivamente adotado.

## Verificação do broker

RabbitMQ Management está disponível, no Compose, em `http://localhost:15672` e oferece API para consultar as filas do vhost `/`. Use as credenciais locais definidas no `.env`; nunca copie tokens, senhas ou URLs com credenciais para logs, documentação ou tickets.

O smoke test verifica autenticação no endpoint de management e presença de uma fila com nome relacionado a evento/domínio/notificação. O nome exato e as garantias de entrega não podem ser afirmados até a definição da topologia do código integrado. A consulta é observacional e não purga mensagens.

## Limitações e resiliência

- Os diretórios de serviços acadêmico, administrativo, notificações e gateway não estão presentes nesta cópia; exchanges, routing keys, nomes de filas e payloads ainda não puderam ser confirmados.
- As condições de saúde do Compose cobrem startup; disponibilidade de runtime, reconexão, retentativas, DLQ e outbox transacional não foram comprovadas.
- O smoke test não para broker/consumidor e não injeta falhas. A confirmação de desacoplamento operacional requer teste de integração controlado que interrompa dependências e valide a persistência/entrega após recuperação, sem afetar ambientes compartilhados.
- O smoke test cria registros temporários via API e remove os recursos identificados; eventos publicados podem já ter sido consumidos. Ele não remove nem purga mensagens da fila.
