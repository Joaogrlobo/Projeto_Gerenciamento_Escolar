# Mensageria e eventos

## Papel do RabbitMQ

RabbitMQ é o broker dos eventos assíncronos entre os serviços de domínio. Quem publica registra o fato e segue em frente; quem consome processa no próprio ritmo. Consultas de dados continuam sendo atendidas pela API do serviço dono: nenhum serviço lê ou escreve no banco de outro.

O painel fica em `http://localhost:15672`, com as credenciais do `.env`. A porta AMQP `5672` é interna à rede do Compose.

## Fluxo de um evento

```text
Serviço de domínio
   │ mesma transação do dado
   ▼
tabela outbox_events ── relay (a cada 1 s) ──► exchange distrischool.events
                                                  │ roteia pelo tipo do evento
                                                  ▼
                                    fila ──► consumidor ──► ack
                                     │
                     erro transitório │ erro permanente ou tentativas esgotadas
                                     ▼                      ▼
                          fila .retry (5 s)         distrischool.dlx ──► distrischool.dlq
```

## Topologia

| Recurso | Tipo | Função |
|---|---|---|
| `distrischool.events` | exchange `topic` | Recebe todos os eventos de domínio |
| `notification.events` | fila, binding `#` | Alimenta o `notification-service` |
| `notification.events.retry` | fila, TTL 5 s | Devolve a mensagem à fila principal depois da espera |
| `academic.grade-average` | fila, binding `grade.*` | Recalcula médias no `academic-service` |
| `academic.grade-average.retry` | fila, TTL 5 s | Devolve a mensagem à fila de médias |
| `distrischool.dlx` / `distrischool.dlq` | exchange `topic` / fila | Guarda mensagens rejeitadas para análise |
| `distrischool.live` | exchange `fanout`, não durável | Repassa avisos já gravados a todas as réplicas do `notification-service` |

## Eventos publicados

| Serviço | Eventos |
|---|---|
| `user-service` | `user.registered`, `user.logged` |
| `student-service` | `student.created`, `student.updated`, `student.deleted` |
| `staff-service` | `employee.created`, `employee.updated`, `employee.deleted` |
| `administrative-service` | `class.created`, `teacher.assigned`, `schedule.updated` |
| `academic-service` | `grade.posted`, `grade.updated`, `grade.deleted`, `attendance.recorded`, `enrollment.created`, `enrollment.status_changed`, `average.calculated` |

Formato do envelope: `{ id, version, type, occurredAt, source, data }`. O `id` é um UUID usado para descartar duplicatas.

## Garantias de entrega

- **Outbox:** o evento é gravado na mesma transação do dado. Com o RabbitMQ fora do ar, a operação conclui e o relay envia o evento quando o broker voltar. O relay usa `FOR UPDATE SKIP LOCKED`, então várias réplicas não enviam a mesma linha ao mesmo tempo.
- **Pelo menos uma vez:** uma mensagem pode chegar duplicada. Os consumidores são idempotentes: `event_log.event_id` é único, e `academic_processed_events` registra os eventos de nota já processados.
- **Retry:** falhas transitórias são reenviadas a cada 5 s, até 5 vezes.
- **DLQ:** JSON inválido, evento inválido ou tentativas esgotadas vão para `distrischool.dlq`. O reprocessamento é manual, pelo painel do RabbitMQ.

## Notificações em tempo real

Depois de gravar um aviso, o `notification-service` publica em `distrischool.live`. Cada réplica tem uma fila exclusiva nessa exchange e entrega o aviso aos navegadores conectados a ela. Uma mensagem duplicada não gera novo aviso, porque só o registro realmente inserido é publicado.

Protocolo em `ws://localhost:8080/ws/notifications`: o cliente envia `{"type":"auth","token":"..."}` e recebe `{"type":"ready"}`; depois, `{"type":"notification","notification":{...}}`. Token ausente, inválido ou vencido encerra a conexão com o código `4401`.

## Limitações

- Mensagens na DLQ não são reprocessadas automaticamente.
- A entrega em tempo real não tem garantia própria: se o broker oscilar com o navegador conectado, o aviso aparece na próxima abertura da página de Notificações.
- A ordem entre eventos não é garantida. O cálculo de médias não depende dela, pois recalcula a partir do banco.
