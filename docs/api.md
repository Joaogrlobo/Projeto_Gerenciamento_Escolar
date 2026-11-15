# API e smoke test

## Endereço

As chamadas de serviço do cliente são encaminhadas pelo gateway em `http://localhost:8080`. As rotas abaixo são caminhos públicos do gateway, incluindo o prefixo `/api`. `/health` e `/health/services` são endpoints de diagnóstico do próprio gateway e não usam `/api`. As portas dos serviços de domínio não são a entrada HTTP do cliente.

Rotas protegidas usam `Authorization: Bearer <JWT>`. Login e registro são públicos. `401` indica ausência/token inválido; `403`, perfil não autorizado; `404`, recurso inexistente; `409`, duplicidade/conflito; `429`, limite de requisições. Os status específicos de sucesso estão na tabela e nos controllers dos serviços.

## Endpoints e perfis

### Gateway, autenticação e serviços da Entrega 1

| Método | Endpoint | Perfil |
|---|---|---|
| `GET` | `/health` | Público |
| `GET` | `/health/services` | Público |
| `POST` | `/api/auth/register` | Público |
| `POST` | `/api/auth/login` | Público; sujeito a rate limit |
| `GET` | `/api/auth/me` | Qualquer usuário autenticado |
| `POST` | `/api/users` | `admin` |
| `GET` | `/api/users` | `admin` |
| `GET` | `/api/students` | `admin`, `teacher`, `staff` |
| `POST` | `/api/students` | `admin`, `staff` |
| `GET` | `/api/students/:id` | `admin`, `teacher`, `staff` |
| `PUT` | `/api/students/:id` | `admin`, `staff` |
| `DELETE` | `/api/students/:id` | `admin` |
| `GET` | `/api/employees` | `admin`, `staff`, `teacher` |
| `POST` | `/api/employees` | `admin` |
| `GET` | `/api/employees/:id` | `admin`, `staff`, `teacher` |
| `PUT` | `/api/employees/:id` | `admin` |
| `DELETE` | `/api/employees/:id` | `admin` |

### Administração

| Método | Endpoint | Perfil |
|---|---|---|
| `GET` | `/api/administrative/classes` | `admin`, `staff`, `teacher` |
| `POST` | `/api/administrative/classes` | `admin` |
| `GET` | `/api/administrative/classes/:id` | `admin`, `staff`, `teacher` |
| `GET` | `/api/administrative/classes/:id/schedule` | `admin`, `staff`, `teacher` |
| `PUT`, `PATCH` | `/api/administrative/classes/:id` | `admin` |
| `DELETE` | `/api/administrative/classes/:id` | `admin` |
| `GET` | `/api/administrative/subjects` | `admin`, `staff`, `teacher` |
| `POST` | `/api/administrative/subjects` | `admin` |
| `GET` | `/api/administrative/subjects/:id` | `admin`, `staff`, `teacher` |
| `PUT`, `PATCH` | `/api/administrative/subjects/:id` | `admin` |
| `DELETE` | `/api/administrative/subjects/:id` | `admin` |
| `GET` | `/api/administrative/allocations` | `admin`, `staff`, `teacher` |
| `POST` | `/api/administrative/allocations` | `admin` |
| `DELETE` | `/api/administrative/allocations` | `admin` |
| `DELETE` | `/api/administrative/allocations/:id` | `admin` |
| `GET` | `/api/administrative/teachers/:teacherId/schedule` | `admin`, `staff`, `teacher` |

### Acadêmico

| Método | Endpoint | Perfil |
|---|---|---|
| `GET` | `/api/academic/enrollments` | `admin`, `teacher`, `staff` |
| `POST` | `/api/academic/enrollments` | `admin`, `staff` |
| `GET` | `/api/academic/enrollments/:id` | `admin`, `teacher`, `staff` |
| `PATCH`, `PUT` | `/api/academic/enrollments/:id/status` | `admin`, `staff` |
| `GET` | `/api/academic/grades` | `admin`, `teacher`, `staff` |
| `POST` | `/api/academic/grades` | `admin`, `teacher` |
| `GET` | `/api/academic/grades/:id` | `admin`, `teacher`, `staff` |
| `PUT` | `/api/academic/grades/:id` | `admin`, `teacher` |
| `DELETE` | `/api/academic/grades/:id` | `admin`, `teacher` |
| `GET` | `/api/academic/attendance` | `admin`, `teacher`, `staff` |
| `POST` | `/api/academic/attendance` | `admin`, `teacher` |
| `PUT` | `/api/academic/attendance/bulk` | `admin`, `teacher` |
| `GET` | `/api/academic/attendance/summary` | `admin`, `teacher`, `staff` |
| `GET` | `/api/academic/students/:id/average` | `admin`, `teacher`, `staff` |
| `GET` | `/api/academic/students/:id/attendance` | `admin`, `teacher`, `staff` |

### Notificações

| Método | Endpoint | Perfil |
|---|---|---|
| `GET` | `/api/notifications` | `admin`, `staff`, `teacher` |
| `GET` | `/api/notifications/unread-count` | `admin`, `staff`, `teacher` |
| `POST` | `/api/notifications/seen` | `admin`, `staff`, `teacher` |
| WebSocket | `/ws/notifications` | Token enviado na primeira mensagem |

Cada perfil recebe apenas os tipos de evento do seu público, definidos em `services/notification-service/src/services/audience.js`. O protocolo do WebSocket está em [mensageria.md](mensageria.md).

Com o Circuit Breaker aberto, o gateway responde `503` com o header `Retry-After` e não chama o serviço. `GET /health/services` informa `status` e `circuit` (`CLOSED`, `OPEN` ou `HALF_OPEN`) de cada serviço.

O endpoint de notificações aceita os parâmetros de consulta `type` e `limit`. O serviço não expõe neste contrato rota pública de criação ou exclusão de notificações. A administração das filas ocorre pela API de RabbitMQ Management em `http://localhost:15672`, fora do gateway.

## Smoke test da Fase 7

Na raiz do repositório, com o Compose ativo e `.env` local:

```powershell
./scripts/smoke-test.ps1 -BaseUrl http://localhost:8080
```

O script não exibe valores lidos de `.env`, credenciais, tokens ou corpos/respostas. Identificadores incluem timestamp; cada caso imprime `PASS`/`FAIL` e status HTTP e falhas geram código de saída não zero. As requisições de API usam o gateway e seus caminhos `/api`; as únicas exceções são health checks do próprio gateway e a API necessária do RabbitMQ Management.

Os casos cobrem autenticação e permissões da Entrega 1; CRUD/pesquisa de alunos e funcionários; classes, disciplinas e alocações administrativas; conflitos de professor/turma/sala, horários adjacentes, hora inválida e professor inexistente; inscrição e capacidade; rejeição de nota 11; média ponderada de `7 × peso 1` e `9 × peso 3` (8,5) consultada por polling em até 10 segundos; frequência em lote com presença, ausência e atraso (66,67%); perfis de professor/aluno; evento/notificação `grade.posted`; filas e consumidores; publicação com RabbitMQ parado, reinício e observação de notificação pós-recuperação; rate limit por último e espera pela janela.

O teste de desconexão para e reinicia apenas o serviço `rabbitmq` do projeto Compose local, e restaura-o em `finally` antes da limpeza. Use apenas em ambiente local isolado. O script limpa em ordem inversa de dependências. Para registros sem operação HTTP de exclusão (inscrições, frequência, médias calculadas e log de eventos), a limpeza pontual remove apenas os IDs gerados pelo próprio teste usando `psql` dentro do container PostgreSQL; nunca limpa filas inteiras nem dados preexistentes.

O contrato de campos de corpo não é reproduzido aqui: os serviços podem evoluir e a tabela documenta somente rotas e permissões efetivamente montadas. Em caso de divergência entre API e teste, confira rotas/controllers e corrija a implementação conforme a especificação da fase, sem introduzir campos presumidos na documentação.

Inscrições, frequência e notificações não têm endpoint HTTP de exclusão. O cleanup pontual desses dados usa somente identificadores únicos do teste no banco local, sem apagar mensagens ou dados de outras execuções.
