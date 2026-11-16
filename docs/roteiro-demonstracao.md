# Roteiro de demonstração — Entregas até as semanas 5-6

Duração estimada: 20 a 25 minutos. Cobre o plano das semanas 1 a 6: serviços básicos e containers, API Gateway, RabbitMQ, frontend com CRUD, Circuit Breaker, resiliência e notificações assíncronas em tempo real.

## 0. Preparação (antes de começar)

```bash
docker compose up -d --build        # sobe os 10 containers
node scripts/seed-demo.js           # popula dados de exemplo (idempotente)
```

Deixe abertos:

| Aba | Endereço | Login |
|---|---|---|
| Frontend (janela 1) | http://localhost:3000 | `admin@distrischool.com` / `admin123` |
| Frontend (janela anônima) | http://localhost:3000 | `prof.ana@distrischool.com` / `Demo@123` |
| RabbitMQ Management | http://localhost:15672 | usuário e senha do `.env` |
| Terminal | raiz do projeto | — |

Dados que o seed cria (IDs fixos num banco recém-criado):

| Recurso | Conteúdo |
|---|---|
| Turmas | 1 = 6º Ano A (manhã), 2 = 8º Ano A (manhã), 3 = 7º Ano B (tarde) |
| Disciplinas | 1 = Matemática, 2 = Língua Portuguesa, 3 = Ciências, 4 = História, 5 = Inglês |
| Professores | 1 = Ana Souza (Mat.), 2 = Carlos Lima (Port.), 3 = Beatriz Rocha (Ciên.), 4 = Diego Martins (Hist.), 5 = Fernanda Alves (Ing.) |
| Técnicos | Juliana Pereira (Secretária), Roberto Nunes (Coordenador) |
| Alunos | 12 alunos, matrículas `DS2026001` a `DS2026012`, 4 por turma |
| Grade horária | 15 alocações: cada turma tem as 5 disciplinas, uma por dia (seg a sex) |
| Notas | Mat., Port. e Ciências: prova (peso 2) + trabalho (peso 1) por aluno, com médias já calculadas |
| Frequência | Semana passada inteira, com algumas faltas e atrasos |
| Logins extras (senha `Demo@123`) | `prof.ana@` (teacher), `secretaria@` (staff), `aluno.lucas@` (student) |

---

## 1. Abertura: arquitetura (2 min)

Mostrar no terminal:

```bash
docker compose ps
```

O que dizer:

- Arquitetura de microsserviços: **frontend → API Gateway (8080) → 6 serviços de domínio** (usuários, alunos, funcionários, administrativo, acadêmico, notificações).
- **Um banco por serviço** no PostgreSQL (`users_db`, `students_db`, `staff_db`, ...). Nenhum serviço acessa o banco de outro.
- Comunicação **síncrona via REST/HTTP** (cliente → gateway → serviço; e entre serviços, por exemplo o acadêmico consultando o aluno) e **assíncrona via RabbitMQ** (eventos).
- Só o gateway, o frontend e o painel do RabbitMQ têm porta publicada. Os serviços ficam na rede interna.
- Manifests de **Kubernetes (Minikube)** em `k8s/` para os mesmos serviços.

---

## 2. Semanas 1-2: autenticação, perfis e serviços básicos (3 min)

1. Na tela de login, entrar como **admin**. Explicar que o `user-service` emite um **JWT** e o gateway valida o token antes de encaminhar.
2. **Visão geral** (dashboard): mostrar o painel **Status dos serviços**, que vem do `GET /health/services` do gateway (status e estado do circuito de cada serviço).
3. Na **janela anônima**, entrar como **professora Ana**. Mostrar que o menu não tem **Turmas**, **Disciplinas** nem **Usuários**: são telas exclusivas do perfil admin.
4. Opcional, no terminal, mostrar que a API bloqueia sem token:

   ```bash
   curl -i localhost:8080/api/students        # 401 Token ausente ou inválido
   ```

---

## 3. Semanas 3-4: gateway, frontend e CRUD (10 min)

### 3.1 Alunos: CRUD completo

Menu **Alunos** (admin):

1. **Listar**: 12 alunos do seed.
2. **Buscar**: digitar `7º Ano B` no campo de busca. A busca filtra por nome, matrícula ou turma.
3. **Criar**: **Novo registro**
   - Matrícula `DS2026099`, Nome `Aluno Demonstração`, Data de nascimento `10/05/2014`, Turma `6º Ano A`, Contato `(11) 90000-0000`
   - **Cadastrar**
4. **Validação**: tentar cadastrar de novo com a mesma matrícula. O sistema responde com **conflito (409)**.
5. **Editar**: **Editar** no aluno criado, mudar o nome para `Aluno Demonstração Editado` e clicar em **Salvar alterações**.
6. **Excluir** fica para o fim da seção 3.6, porque antes o aluno vai ser matriculado e receber nota.

### 3.2 Funcionários: CRUD e filtro por tipo

Menu **Funcionários**:

1. Usar o filtro de tipo: **Professor** e **Equipe administrativa**.
2. **Novo registro**: Tipo `Professor`, Nome `Professor Demo`, E-mail `prof.demo@distrischool.com`, Disciplinas `Geografia` → **Cadastrar**.
3. **Editar** a qualificação e **Excluir** (o navegador pede confirmação).

### 3.3 Turmas e Disciplinas (admin)

1. Menu **Turmas**: mostrar as 3 turmas, com turno e capacidade. Opcional: criar `9º Ano A`.
2. Menu **Disciplinas**: mostrar as 5 disciplinas e a carga horária. Opcional: criar `Geografia`, 40 h.

### 3.4 Alocações: regra de negócio com conflito de horário

Menu **Alocações**:

1. Consultar os **Horários da turma** `1` (6º Ano A): uma disciplina por dia.
2. **Nova alocação com conflito**: turma `3`, disciplina `1`, professor `1`, dia `1`, das `08:00` às `09:00`, sala `Sala 105` → **Criar alocação**.
   - Resultado: **"Conflito de horário: já existe uma alocação para a turma ou professor neste período."** A professora Ana já dá aula no 6º Ano A na segunda, das 07:30 às 09:10. (A API responde 409 com o motivo exato, "professor já possui uma alocação nesse período", mas a tela mostra uma mensagem genérica.)
3. Corrigir para dia `1`, das `15:30` às `16:20` → criado. Isso gera o evento `teacher.assigned`.

### 3.5 Matrícula

Menu **Matrículas** → **Nova matrícula**:

- ID do aluno: o ID do `Aluno Demonstração`. **A tela de Alunos não mostra o ID**, então pegue antes no terminal:

  ```bash
  docker compose exec postgres psql -U postgres -d students_db -Atc "select id from students where registration='DS2026099'"
  ```
- ID da turma `1`, Data `hoje` → **Matricular aluno**.
- Explicar que o `academic-service` **consulta o `student-service` e o `administrative-service`** (chamada síncrona entre serviços) para validar o aluno, a turma e a **capacidade**.

### 3.6 Notas e média assíncrona (ponto alto)

Menu **Notas**:

1. **Selecione a matrícula** de um aluno do seed para mostrar notas e pesos já lançados.
2. Selecionar a matrícula do `Aluno Demonstração`:
   - Avaliação `Matemática`, Nota `9`, Peso `2` → **Registrar nota**
   - Avaliação `Matemática`, Nota `6`, Peso `1` → **Registrar nota**
3. Explicar que a API responde **202 Accepted**: a nota é gravada e o evento `grade.posted` vai para o RabbitMQ. O cálculo da **média ponderada** acontece de forma **assíncrona** no consumidor `academic.grade-average`. Resultado: (9×2 + 6×1) / 3 = **8,0**.
   - Atenção: o selo "Média" no topo da tela é calculado no navegador e mistura todas as disciplinas da matrícula. Ele não é a média assíncrona. Para mostrar a média calculada pelo backend, use o terminal (troque `ID` pelo ID do aluno):

     ```bash
     curl -s -H "Authorization: Bearer $TOKEN" "localhost:8080/api/academic/students/ID/average?subject=Matem%C3%A1tica"
     ```

     O `$TOKEN` é obtido como na seção 4.2.
4. **Editar** uma nota e **Excluir** outra (com confirmação). A média é recalculada.
5. Voltar em **Alunos** e **Excluir** o `Aluno Demonstração` para fechar o ciclo do CRUD.

### 3.7 Frequência

Menu **Frequência**:

1. **Resumo de frequência**: informar a turma `1` e consultar. Mostra presentes, ausentes, atrasos e o percentual da semana passada.
2. **Registro em lote**: turma `1`, data `hoje`, IDs dos alunos `1, 2, 3, 4`, registro `Presente` → **Registrar frequência**.

### 3.8 RabbitMQ por dentro

No painel http://localhost:15672:

- **Exchanges** → `distrischool.events` (topic): todos os eventos passam por ela.
- **Queues** → `notification.events`, `academic.grade-average`, as filas `.retry` (TTL de 5 s) e `distrischool.dlq`. Mostrar o gráfico de mensagens processadas.

---

## 4. Semanas 5-6: resiliência e notificações (8 min)

### 4.1 Notificações em tempo real (WebSocket)

1. Na **janela anônima** (professora Ana), abrir **Notificações**.
2. Na janela do **admin**, lançar uma nota (seção 3.6) ou criar uma alocação.
3. A notificação aparece **na hora** na janela da professora, sem recarregar a página, e o contador do menu sobe.
4. Explicar o fluxo: o serviço grava o evento na **outbox** (mesma transação do dado). O relay publica no RabbitMQ, o `notification-service` consome e grava, e o aviso chega ao navegador pelo **WebSocket** `/ws/notifications`.
5. Mostrar o **filtro por perfil**: a professora recebe eventos de sala de aula (notas, frequência, alocações), mas não recebe "aluno criado", que só a equipe administrativa vê.

### 4.2 Circuit Breaker no gateway

No terminal (use um token de admin):

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@distrischool.com","password":"admin123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

docker compose stop student-service

for i in 1 2 3 4 5 6 7; do
  curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" -H "Authorization: Bearer $TOKEN" localhost:8080/api/students
done
```

O que acontece:

- As **5 primeiras** chamadas retornam 503 depois de ~5 s cada, tentando alcançar o serviço.
- Com 5 falhas, o circuito **abre**. Da 6ª em diante, o 503 é **imediato (~5 ms)**, com o header `Retry-After: 10`, e o gateway nem tenta chamar o serviço.
- No frontend, **recarregue** a **Visão geral** (ela não se atualiza sozinha). O card `student-service` mostra **DOWN · Circuito aberto**. Outras telas, como Funcionários e Turmas, continuam funcionando: **a falha fica isolada**.

Recuperação:

```bash
docker compose start student-service
sleep 12
curl -s localhost:8080/health/services     # UP / HALF_OPEN: aguardando uma requisição de teste
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" localhost:8080/api/students   # 200
curl -s localhost:8080/health/services     # UP / CLOSED
```

Explicar os estados **CLOSED → OPEN → HALF_OPEN → CLOSED**.

### 4.3 Outbox: nenhum evento se perde com o RabbitMQ fora

```bash
docker compose stop rabbitmq
```

1. No frontend, cadastrar um aluno. **Funciona normalmente (201)**.
2. Explicar que o evento ficou guardado na tabela `outbox_events`, na mesma transação do cadastro.

   ```bash
   docker compose exec postgres psql -U postgres -d students_db -c "select type, created_at from outbox_events;"
   ```

3. `docker compose start rabbitmq`. Em poucos segundos, o relay envia o evento e a notificação aparece.

### 4.4 Teste de caos automatizado (fechamento técnico)

```bash
bash scripts/chaos-test.sh
```

Roda em ~1 min e imprime `PASS` para: filas com dead-letter, Circuit Breaker abrindo (503 imediato), recuperação após religar o serviço, outbox com RabbitMQ parado, fila durável com o serviço de notificações parado e mensagem inválida desviada para a **DLQ**. No final, mostrar a mensagem na fila `distrischool.dlq` no painel do RabbitMQ.

---

## 5. Encerramento (1 min)

Resumo do entregue:

| Semanas | Entregue |
|---|---|
| 1-2 | Serviços de usuários (JWT e perfis), alunos e funcionários; Docker Compose e manifests Kubernetes |
| 3-4 | API Gateway (roteamento, autenticação, rate limit, health), RabbitMQ, serviços administrativo e acadêmico, frontend React |
| 5-6 | Circuit Breaker, retry com fila de espera, outbox transacional, DLQ, notificações assíncronas e em tempo real por WebSocket |

Próximos passos (semanas 7-8): CI/CD com GitHub Actions, Prometheus/Grafana, testes de carga, documentação final e vídeo.

---

## Plano B

| Problema | Ação |
|---|---|
| Tela vazia ou erro de rede | `docker compose ps`; se algum serviço estiver parado, `docker compose up -d` |
| Login bloqueado (429) | Rate limit de login: aguarde 1 minuto |
| Circuito ainda OPEN após religar | Aguarde ~10 s (tempo de reset) e repita a chamada |
| Precisa reiniciar do zero | `docker compose down -v && docker compose up -d --build && node scripts/seed-demo.js` (**apaga todos os dados locais**) |
