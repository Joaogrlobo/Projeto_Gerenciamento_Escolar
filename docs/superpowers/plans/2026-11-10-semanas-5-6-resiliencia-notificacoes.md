# Semanas 5-6: Resiliência e Notificações Assíncronas — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar "Circuit Breaker e Resiliência" e "Sistema de notificações assíncrono" do plano de 8 semanas do DistriSchool.

**Architecture:** Chamadas HTTP entre serviços e o proxy do gateway passam por Circuit Breaker (opossum), com retry nas leituras internas. Eventos deixam de ser best-effort: são gravados numa tabela outbox na mesma transação do dado e enviados por um relay. Consumidores ganham fila de retry e DLQ funcional. O notification-service passa a entregar avisos em tempo real por WebSocket, com público por perfil e contador de não lidas.

**Tech Stack:** Node.js 20, Express 5, PostgreSQL (`pg`), RabbitMQ (`amqplib`), `opossum@^9.0.0`, `ws@^8`, React 18, `node:test`.

**Spec:** "Projeto Final: Plataforma de Gestão Escolar Distribuída DistriSchool" (PDF), linha "Semanas 5-6" e seções Resiliência, Modelos de Falha e Frontend.

## Global Constraints

- Backend continua em Node.js: Resilience4J (PDF) é substituído por `opossum`, seu equivalente.
- `opossum` fica em `^9.0.0`: a versão 10 exige Node 22+ e os Dockerfiles usam `node:20-alpine`.
- Mensageria continua em RabbitMQ; o PDF aceita "RabbitMQ/Kafka".
- Cada serviço é um contexto Docker separado: módulos comuns são copiados por serviço, como já ocorre com `messaging/rabbit.js`.
- Trabalhar na branch `feature/semanas-5-6-resiliencia`.
- Nunca incluir em commit a alteração local de porta `5439:5432` do `docker-compose.yml`.
- Orçamento de tempo: 3 tentativas de 1200 ms com esperas de 150 e 300 ms somam até 4050 ms por dependência; duas dependências em sequência precisam caber nos 10 s do gateway.
- Testes com `node --test`; serviços sem script `test` ganham `"test": "node --test"`.

## Fora do escopo

Portal de pais e alunos, avisos manuais, e-mail, gRPC, Kafka, Redis, Prometheus/Grafana (semana 7).

## Review Focus

- Um serviço que responde 503 porque *sua dependência* caiu não pode abrir o circuito do gateway para ele. Teste na Task 7.
- 404, 401 e 403 de uma dependência não contam como falha nem geram retry. Teste na Task 6.
- Fila durável já existente com argumentos antigos causa `PRECONDITION_FAILED` e deixa o consumidor em laço de reconexão. Migração na Task 1 e verificação na Task 11.
- Evento entregue duas vezes não pode gerar dois avisos em tempo real. Teste na Task 9.
- Token que expira com o WebSocket aberto deve encerrar a conexão com código 4401. Teste na Task 9.

---

### Task 1: Consumidor do notification-service com retry e DLQ funcional

Defeito confirmado no broker: `notification.events` tem o argumento literal `deadLetterExchange` em vez de `x-dead-letter-exchange`, então mensagens rejeitadas são descartadas. Além disso, qualquer erro, mesmo transitório, rejeita a mensagem sem nova tentativa.

**Files:**
- Modify: `services/notification-service/src/messaging/rabbit.js:89-92`
- Modify: `services/notification-service/src/messaging/consumer.js`
- Test: `services/notification-service/test/messaging.test.js`

**Interfaces:**
- Produces: `MAX_RETRIES = 5` e `RETRY_QUEUE = 'notification.events.retry'`, exportados por `consumer.js`.

- [ ] **Step 1: Atualizar e escrever os testes**

Trocar a expectativa da linha 113 para `{ durable: true, deadLetterExchange: 'distrischool.dlx' }` e adicionar:

```js
test('declares retry queue that returns messages after 5s', ...);
// assertQueue('notification.events.retry',
//   { durable: true, messageTtl: 5000, deadLetterExchange: '', deadLetterRoutingKey: 'notification.events' })

test('sends transient failure to retry queue with incremented count', ...);
// properties.headers['x-retry-count'] = 2 → sendToQueue(RETRY_QUEUE, content, headers['x-retry-count'] === 3), ack 1x, nack 0x

test('dead-letters transient failure after MAX_RETRIES', ...);
// header = 5 → nack(message, false, false), sendToQueue 0x

test('dead-letters permanent failure immediately', ...);
// recordEvent lança BadRequestError → nack(message, false, false), sendToQueue 0x
// conteúdo 'não-json' → mesmo resultado
```

No teste existente `nacks failed events...`, o erro passa a ser `statusCode = 400`.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd services/notification-service && npm install && npm test`
Expected: FAIL nos quatro testes novos e na topologia.

- [ ] **Step 3: Implementar**

Em `rabbit.js`, usar a opção `deadLetterExchange` no primeiro nível e declarar a fila de retry antes do `consume`. Em `consumer.js`, erro é permanente se `error instanceof SyntaxError || error.statusCode === 400`. Transitório com `retries < MAX_RETRIES`: `sendToQueue` com `persistent: true` e depois `ack`. Demais casos: `nack(message, false, false)`. `retries` vem de `message.properties?.headers?.['x-retry-count'] ?? 0`.

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Migrar a fila local**

```bash
docker compose stop notification-service
docker compose exec rabbitmq rabbitmqctl delete_queue notification.events
docker compose up -d --build notification-service
curl -s -u "$RABBITMQ_USER:$RABBITMQ_PASSWORD" localhost:15672/api/queues/%2F/notification.events
```
Expected: `arguments` contém `"x-dead-letter-exchange":"distrischool.dlx"`.

- [ ] **Step 6: Commit**

```bash
git add services/notification-service
git commit -m "fix: corrige DLQ e adiciona retry no consumidor de notificacoes"
```

### Task 2: Consumidor do academic-service com retry e DLQ

`academic.grade-average` não tem dead-letter: mensagem rejeitada some, e o cálculo da média se perde.

**Files:**
- Create: `services/academic-service/src/messaging/consumer.js`
- Modify: `services/academic-service/src/messaging/rabbit.js:31-50,69-71`
- Modify: `services/academic-service/src/services/averages.service.js:33,53`
- Modify: `services/academic-service/package.json`
- Test: `services/academic-service/test/messaging.test.js`

**Interfaces:**
- Produces: `handleGradeMessage(channel, message, processEvent = processGradeEvent): Promise<void>`, `MAX_RETRIES = 5`, `RETRY_QUEUE = 'academic.grade-average.retry'`.

- [ ] **Step 1: Escrever os testes** com os mesmos quatro cenários da Task 1, chamando `handleGradeMessage` com `processEvent` falso, mais:

```js
test('declares academic queue with dead-letter exchange', ...);
// assertQueue('academic.grade-average', { durable: true, deadLetterExchange: 'distrischool.dlx' })
```

- [ ] **Step 2: Rodar e confirmar falha.** Run: `cd services/academic-service && npm install && npm test` — Expected: FAIL.

- [ ] **Step 3: Implementar.** Declarar `distrischool.dlx`, `distrischool.dlq` e o binding `#`, como no notification-service. Fila de retry: `messageTtl: 5000`, `deadLetterExchange: ''`, `deadLetterRoutingKey: 'academic.grade-average'`. `processGradeEvent` troca os dois `throw new Error` por `BadRequestError`. O `publishEvent('average.calculated')` continua após o `ack` até a Task 4.

- [ ] **Step 4: Rodar e confirmar sucesso.** Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/academic-service
git commit -m "fix: adiciona retry e DLQ ao consumidor de medias"
```

### Task 3: Outbox em student, staff e user

**Files (repetir em cada um dos três serviços):**
- Create: `src/messaging/relay.js`
- Modify: `src/messaging/publisher.js`, `src/messaging/rabbit.js`, `src/config/db.js`, `src/database/schema.js`, `src/index.js`, `src/repositories/*.repository.js`, `src/services/*.service.js`, `package.json`
- Test: `test/outbox.test.js`

**Interfaces:**
- Produces:
  - `publishEvent(type: string, data: object, database = pool): Promise<void>`: grava em `outbox_events`, não fala com o broker.
  - `createRelay({ pool, publish, batchSize = 50, intervalMs = 1000 }): { tick(): Promise<number>, start(): void, stop(): void }`
  - `withTransaction(fn: (client) => Promise<T>): Promise<T>` em `config/db.js`
  - Repositórios de escrita aceitam `database = pool` como último parâmetro.

- [ ] **Step 1: Escrever os testes** (no student-service; copiar para os outros dois)

```js
test('publishEvent inserts envelope into outbox using given client', ...);
// query contém 'INSERT INTO outbox_events'; envelope tem id (UUID), version 1, type, occurredAt, source 'student-service', data

test('tick publishes in id order, deletes rows and commits', ...);
// linhas 1,2 → publish chamado em ordem; DELETE com [1,2]; COMMIT; retorno 2

test('tick rolls back and keeps rows when publish fails', ...);
// publish rejeita → ROLLBACK, nenhum DELETE, retorno 0, sem lançar

test('tick locks rows with SKIP LOCKED', ...);
// SELECT casa /FOR UPDATE SKIP LOCKED/

test('createStudent does not commit student when outbox insert fails', ...);
// withTransaction falso; publishEvent rejeita → createStudent rejeita
```

- [ ] **Step 2: Rodar e confirmar falha.** Run: `cd services/student-service && npm install && npm test` — Expected: FAIL.

- [ ] **Step 3: Implementar**

Acrescentar ao `schema.js`:

```sql
CREATE TABLE IF NOT EXISTS outbox_events (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID UNIQUE NOT NULL,
  type TEXT NOT NULL,
  envelope JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

O limite de 2000 ms por publicação passa do `publisher.js` para o `publish` usado pelo relay. O relay registra no log só a primeira falha de uma sequência. `index.js` inicia o relay depois de `init(schema)`. Escritas e `publishEvent` ficam no mesmo `withTransaction`; o `user.logged` usa o `pool` padrão.

- [ ] **Step 4: Rodar e confirmar sucesso** nos três serviços. Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/student-service services/staff-service services/user-service
git commit -m "feat: adiciona transactional outbox em alunos, funcionarios e usuarios"
```

### Task 4: Outbox no academic-service

**Files:**
- Create: `services/academic-service/src/messaging/relay.js`
- Modify: `src/messaging/publisher.js`, `src/messaging/consumer.js`, `src/messaging/rabbit.js`, `src/database/schema.js`, `src/index.js`
- Modify: `src/repositories/grades.repository.js:36,47,58`, `src/repositories/attendance.repository.js:4`
- Modify: `src/services/grades.service.js`, `enrollments.service.js`, `attendance.service.js`, `averages.service.js`
- Test: `services/academic-service/test/outbox.test.js`

**Interfaces:**
- Consumes: contratos `publishEvent` e `createRelay` da Task 3; `enrollments.repository.transaction` como `withTransaction`.

- [ ] **Step 1: Escrever os testes**: copiar os quatro testes de relay/publisher da Task 3 e adicionar:

```js
test('processGradeEvent writes average.calculated in the same transaction', ...);
// client falso: INSERT INTO outbox_events ocorre antes do COMMIT

test('duplicate grade event writes no average event', ...);
// INSERT em academic_processed_events com rowCount 0 → nenhum insert na outbox

test('handleGradeMessage acks without publishing directly', ...);
```

- [ ] **Step 2: Rodar e confirmar falha.** Run: `cd services/academic-service && npm test` — Expected: FAIL.

- [ ] **Step 3: Implementar.** `enrollments` e `attendance` incluem o evento dentro da transação; em `attendance.bulkUpsert`, os inserts da outbox usam o mesmo client de `upsertMany`. `processGradeEvent` passa a gravar `average.calculated` antes do `COMMIT`, e o `consumer.js` só dá `ack`.

- [ ] **Step 4: Rodar e confirmar sucesso.** Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/academic-service
git commit -m "feat: adiciona transactional outbox no servico academico"
```

### Task 5: Outbox no administrative-service

**Files:**
- Create: `services/administrative-service/src/messaging/relay.js`
- Modify: `src/messaging/publisher.js`, `src/messaging/rabbit.js`, `src/config/db.js`, `src/database/schema.js`, `src/index.js`
- Modify: `src/repositories/classes.repository.js`, `subjects.repository.js`, `allocations.repository.js`
- Modify: `src/services/allocations.service.js`, `classes.service.js`, `subjects.service.js`
- Test: `services/administrative-service/test/outbox.test.js`

**Interfaces:**
- Consumes: contratos da Task 3; `withScheduleLock(operation)` já entrega o client transacional.

- [ ] **Step 1: Escrever os testes**: copiar os quatro testes de relay/publisher e adicionar:

```js
test('createAllocation writes teacher.assigned and schedule.updated inside schedule lock', ...);
// os dois publishEvent recebem o mesmo client de withScheduleLock
```

- [ ] **Step 2: Rodar e confirmar falha.** Run: `cd services/administrative-service && npm install && npm test` — Expected: FAIL.
- [ ] **Step 3: Implementar**, com os eventos de `classes` e `subjects` em `withTransaction`.
- [ ] **Step 4: Rodar e confirmar sucesso.** Run: `npm test` — Expected: PASS, incluindo os testes já existentes.
- [ ] **Step 5: Commit**

```bash
git add services/administrative-service
git commit -m "feat: adiciona transactional outbox no servico administrativo"
```

### Task 6: Retry e Circuit Breaker entre serviços

**Files:**
- Create: `services/academic-service/src/resilience/resilient-call.js`, `services/administrative-service/src/resilience/resilient-call.js`
- Modify: `services/academic-service/src/clients/dependencies.client.js:13-19`, `services/academic-service/src/app.js`
- Modify: `services/administrative-service/src/services/teachers.service.js:7-13`, `services/administrative-service/src/app.js`
- Test: `services/academic-service/test/resilience.test.js`, `services/administrative-service/test/resilience.test.js`

**Interfaces:**
- Produces:
  - `createResilientCall(name, { attempts = 3, backoffMs = [150, 300], resetTimeoutMs = 10000, volumeThreshold = 5, errorThresholdPercentage = 50, onUnavailable }): ((fn) => Promise<T>) & { state(): 'CLOSED'|'OPEN'|'HALF_OPEN' }`
  - `circuitStates(): Record<string, string>`

- [ ] **Step 1: Escrever os testes**

```js
test('retries 503 and succeeds on third attempt', ...);      // fn chamada 3x
test('does not retry 404', ...);                             // fn chamada 1x, lança NotFoundError
test('4xx never opens the circuit', ...);                    // 10x 404 → state() === 'CLOSED'
test('opens after 5 failures and stops calling', ...);       // attempts:1; 6ª chamada: statusCode 503, fn não chamada; 'OPEN'
test('half-open closes after a success', ...);               // resetTimeoutMs:50; após 60 ms, sucesso → 'CLOSED'
test('student circuit does not block class lookups', ...);   // getStudent abre; getCourse chama fetch
test('each attempt is limited to 1200 ms', ...);             // getEntity usa AbortSignal.timeout(1200)
```

- [ ] **Step 2: Rodar e confirmar falha.** Run: `cd services/academic-service && npm install opossum@^9.0.0 && npm test` — Expected: FAIL.

- [ ] **Step 3: Implementar**

Um breaker por dependência (`student-service`, `administrative-service`, `staff-service`), com `timeout: false` e `errorFilter: err => err.statusCode < 500`. O breaker envolve o laço de retry: circuito aberto falha na hora e não tenta de novo. Só `statusCode === 503` gera retry. `EOPENBREAKER` vira `onUnavailable()`. A rota `/health` passa a incluir `circuits: circuitStates()`.

- [ ] **Step 4: Rodar e confirmar sucesso** nos dois serviços. Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/academic-service services/administrative-service
git commit -m "feat: adiciona retry e circuit breaker nas chamadas entre servicos"
```

### Task 7: Circuit Breaker no gateway

**Files:**
- Create: `services/api-gateway/src/resilience/proxy-breakers.js`
- Modify: `services/api-gateway/src/app.js:46-64,86-111`, `services/api-gateway/src/config/env.js`
- Modify: `services/frontend/src/pages/DashboardPage.jsx`
- Test: `services/api-gateway/test/circuit.test.js`

**Interfaces:**
- Produces: `getBreaker(service): CircuitBreaker`, `circuitStates(): Record<string, string>`; `/health/services` devolve `services[nome] = { status, circuit }`; `config.circuitResetMs` (env `CIRCUIT_RESET_MS`, padrão `10000`).

- [ ] **Step 1: Escrever os testes**

```js
test('opens after connection failures and short-circuits', ...);
// porta fechada: após 5 falhas, resposta 503, header retry-after: '10',
// body { error: 'Serviço temporariamente indisponível' }

test('upstream 503 responses never open the circuit', ...);
// upstream responde 503 10x → 10 hits no upstream; circuit 'CLOSED'

test('POST body reaches upstream intact through the breaker', ...);
test('recovers after reset window', ...);       // CIRCUIT_RESET_MS=50
test('health/services reports circuit state', ...);
```

- [ ] **Step 2: Rodar e confirmar falha.** Run: `cd services/api-gateway && npm install opossum@^9.0.0 && npm test` — Expected: FAIL.

- [ ] **Step 3: Implementar**

Breaker por serviço, não por rota. A action dispara o proxy e devolve uma Promise resolvida no `close` da resposta. Ela rejeita só se `res.locals.upstreamFailed` estiver ligado, o que acontece no handler `on.error` e no timeout de 10 s. O gateway nunca reenvia requisições. No dashboard, exibir "Circuito aberto" quando `circuit !== 'CLOSED'`.

- [ ] **Step 4: Rodar e confirmar sucesso.** Run: `npm test && (cd ../frontend && npm install && npm run build)` — Expected: PASS e build sem erro.

- [ ] **Step 5: Commit**

```bash
git add services/api-gateway services/frontend
git commit -m "feat: adiciona circuit breaker por servico no gateway"
```

### Task 8: Público por perfil, mensagens e não lidas

**Files:**
- Create: `services/notification-service/src/services/audience.js`
- Modify: `src/database/schema.js`, `src/repositories/notifications.repository.js`, `src/services/notifications.service.js`, `src/controllers/notifications.controller.js`, `src/routes/notifications.routes.js`
- Test: `services/notification-service/test/notifications.test.js`

**Interfaces:**
- Produces:
  - `rolesFor(type: string): string[]`
  - `insert(event)` devolve `{ event_id, type, message, occurred_at, received_at, audience }` ou `null` em duplicata
  - `list(type, limit, role)`, `countUnread(role, userId)`, `markSeen(userId)`
  - `GET /notifications` (admin, staff, teacher), `GET /notifications/unread-count` → `{ count }`, `POST /notifications/seen` → 204

| Eventos | Público |
|---|---|
| `user.logged` | ninguém (fica só no log) |
| `user.registered`, tipo desconhecido | admin |
| `student.*`, `employee.*`, `enrollment.*`, `class.created` | admin, staff |
| `grade.*`, `average.calculated`, `attendance.recorded`, `teacher.assigned`, `schedule.updated` | admin, staff, teacher |

- [ ] **Step 1: Escrever os testes**

```js
test('rolesFor maps each event family', ...);        // todas as linhas da tabela
test('formatMessage covers new event types', ...);
// 'student.updated' → /Aluno atualizado/; 'student.deleted' → /Aluno removido/
// 'employee.created' → /Funcionário cadastrado/; 'average.calculated' → /Média atualizada/
// 'grade.updated' → /Nota alterada/; 'grade.deleted' → /Nota removida/
test('list filters by role', ...);                   // SQL contém '= ANY(audience)', parâmetro 'teacher'
test('unread count uses user cursor', ...);          // sem cursor, conta tudo do perfil
test('student role receives 403', ...);
test('user.logged is stored with empty audience', ...);
```

- [ ] **Step 2: Rodar e confirmar falha.** Run: `cd services/notification-service && npm test` — Expected: FAIL.

- [ ] **Step 3: Implementar**

```sql
ALTER TABLE event_log ADD COLUMN IF NOT EXISTS audience TEXT[] NOT NULL DEFAULT '{admin}';
CREATE TABLE IF NOT EXISTS notification_cursors (
  user_id INTEGER PRIMARY KEY,
  seen_at TIMESTAMPTZ NOT NULL
);
```

O id do usuário vem de `req.user.sub`.

- [ ] **Step 4: Rodar e confirmar sucesso.** Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/notification-service
git commit -m "feat: adiciona publico por perfil e contador de nao lidas"
```

### Task 9: Entrega em tempo real por WebSocket

Com mais de uma réplica, o evento pode ser consumido por uma réplica enquanto o navegador está ligado a outra. Por isso, depois de gravar, cada réplica publica numa exchange `fanout`, e todas repassam aos seus clientes.

**Files:**
- Create: `services/notification-service/src/realtime/hub.js`
- Modify: `services/notification-service/src/messaging/rabbit.js`, `src/messaging/consumer.js`, `src/index.js`
- Modify: `services/api-gateway/src/app.js`, `services/api-gateway/src/index.js`
- Test: `services/notification-service/test/realtime.test.js`, `services/api-gateway/test/websocket.test.js`

**Interfaces:**
- Consumes: `insert` da Task 8.
- Produces:
  - `createHub({ jwtSecret, authTimeoutMs = 5000, heartbeatMs = 30000 }): { attach(server), broadcast(notification), close() }`
  - Protocolo em `/ws/notifications`: cliente envia `{"type":"auth","token":"..."}`; servidor responde `{"type":"ready"}` e depois `{"type":"notification","notification":{event_id,type,message,occurred_at,received_at}}`. Falha de autenticação ou token vencido: fechamento com código `4401`.
  - `publishLive(notification): void`, exchange `distrischool.live` do tipo `fanout`
  - `app.handleUpgrade(req, socket, head)` no gateway

- [ ] **Step 1: Escrever os testes**

```js
test('closes with 4401 when no auth arrives in time', ...);   // authTimeoutMs: 50
test('closes with 4401 on invalid token', ...);
test('delivers only to roles in the audience', ...);          // teacher recebe; student não
test('does not expose audience or payload', ...);
test('closes with 4401 when token expires', ...);             // exp em 1 s
test('duplicate event is acked without live push', ...);      // recordEvent → null; publishLive 0x; ack 1x
test('live publish failure still acks', ...);                 // publishLive lança; ack 1x; sendToQueue 0x
test('empty audience is not pushed', ...);
// gateway
test('proxies websocket upgrade to notification-service', ...);
test('destroys upgrades on other paths', ...);
```

- [ ] **Step 2: Rodar e confirmar falha.** Run: `cd services/notification-service && npm install ws@^8 && npm test` — Expected: FAIL.

- [ ] **Step 3: Implementar**

Hub com `maxPayload: 4096` e heartbeat por ping. Cada réplica cria fila exclusiva anônima ligada a `distrischool.live`, com `noAck: true`. A autenticação é feita pela primeira mensagem porque o navegador não envia header em WebSocket e URLs ficam em logs. No gateway: proxy dedicado com `.upgrade`, sem montar em rota HTTP, e `index.js` faz `server.on('upgrade', app.handleUpgrade)`. Instalar `ws` como devDependency no gateway.

- [ ] **Step 4: Rodar e confirmar sucesso** nos dois serviços. Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/notification-service services/api-gateway
git commit -m "feat: entrega notificacoes em tempo real por websocket"
```

### Task 10: Frontend em tempo real

O frontend não tem framework de testes; a verificação é por build e roteiro manual.

**Files:**
- Create: `services/frontend/src/realtime/NotificationsProvider.jsx`
- Modify: `services/frontend/src/main.jsx`, `src/App.jsx:45-57` e rota `/notifications`, `src/pages/AcademicPages.jsx` (página de notificações), `src/styles.css`

**Interfaces:**
- Consumes: protocolo da Task 9 e rotas da Task 8.
- Produces: `useNotifications(): { unread: number, connected: boolean, latest: Notification[], markSeen(): Promise<void> }`

- [ ] **Step 1: Implementar o provider**

URL derivada de `API_URL`, trocando `http` por `ws`. Só conecta para `admin`, `staff` e `teacher`. Reconexão de 1 s dobrando até 30 s. Em `4401`, não reconecta e dispara `school:unauthorized`. A cada `ready`, busca `/api/notifications/unread-count`. Encerrar o socket no logout e no cleanup do efeito.

- [ ] **Step 2: Ligar a interface**

Item "Notificações" para os três perfis, com badge de não lidas. Toast de 6 s por aviso novo. A página insere avisos de `latest` no topo sem duplicar `event_id`, remove o botão "Atualizar" e chama `markSeen()` ao abrir.

- [ ] **Step 3: Verificar build.** Run: `cd services/frontend && npm install && npm run build` — Expected: build sem erro.

- [ ] **Step 4: Roteiro manual** com `docker compose up -d --build`

Em duas janelas, entrar como admin e cadastrar um aluno em uma delas. Expected: toast e badge aparecem na outra sem recarregar. Abrir Notificações zera o badge. `docker compose restart notification-service` reconecta sozinho. Entrar como teacher: `student.created` não aparece, e `grade.posted` aparece.

- [ ] **Step 5: Commit**

```bash
git add services/frontend
git commit -m "feat: exibe notificacoes em tempo real no frontend"
```

### Task 11: Teste de caos, Kubernetes e documentação

**Files:**
- Create: `scripts/chaos-test.sh`
- Modify: `k8s/*.yaml` e `k8s/service.template` (tag `0.3`), `k8s/notification-service.yaml` (`replicas: 2`)
- Modify: `README.md`, `docs/mensageria.md`, `docs/api.md`, `docs/requisitos.md`, `docs/arquitetura-camadas.md`

- [ ] **Step 1: Escrever `scripts/chaos-test.sh`**

Lê `.env`, imprime `PASS`/`FAIL` por caso, termina com código diferente de zero se algo falhar e sempre religa o que parou (`trap`). Cenários:

| Caso | Ação | Esperado |
|---|---|---|
| Topologia | consultar filas pela API de gerenciamento | `notification.events` e `academic.grade-average` com `x-dead-letter-exchange` |
| Circuit Breaker | parar `student-service`, enviar 8 `POST /api/academic/grades` | 503 em todos; as 2 últimas em menos de 300 ms; circuito `OPEN` no `/health` do academic |
| Recuperação | religar `student-service` | nota aceita em até 30 s |
| Outbox | parar `rabbitmq`, criar aluno | 201; linha em `outbox_events`; aviso em até 30 s após religar |
| Fila durável | parar `notification-service`, criar aluno, religar | aviso em até 30 s |
| DLQ | publicar JSON inválido pela API de gerenciamento | `distrischool.dlq` incrementa em até 5 s |

- [ ] **Step 2: Rodar.** Run: `docker compose up -d --build && bash scripts/chaos-test.sh` — Expected: todos `PASS`, código de saída 0.

- [ ] **Step 3: Atualizar manifests e documentação**

Registrar a migração de filas da Task 1 no README, comandos em bash ao lado dos de PowerShell, novas rotas em `docs/api.md` e topologia real em `docs/mensageria.md`, removendo o texto que diz que os serviços não estão presentes nesta cópia.

- [ ] **Step 4: Validar.** Run: `python3 -c "import yaml,glob;[list(yaml.safe_load_all(open(f))) for f in glob.glob('k8s/*.yaml')]"` — Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add scripts/chaos-test.sh k8s README.md docs
git commit -m "docs: adiciona teste de caos e atualiza manifests e documentacao"
```
