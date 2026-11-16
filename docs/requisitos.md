# Requisitos do SchoolFlow

## Objetivo e escopo

O SchoolFlow é um sistema distribuído de gestão escolar. Os serviços de usuário, aluno e funcionário formam a Entrega 1; gateway, administração, acadêmico, notificações e mensageria expandem o sistema. Esta fase documenta as rotas e os casos de validação da Fase 7. A tabela completa de verbos, endpoints e perfis está em [docs/api.md](api.md).

## Requisitos funcionais

### Entrega 1: autenticação e cadastros

- **RF01:** permitir login e emissão de JWT, identificação do usuário autenticado e cadastro público conforme a política de perfis.
- **RF02:** disponibilizar administração de usuários a `admin`.
- **RF03:** permitir CRUD e pesquisa de alunos, aplicando os papéis previstos por endpoint.
- **RF04:** permitir CRUD e pesquisa de funcionários, aplicando os papéis previstos por endpoint.
- **RF05:** proteger rotas com JWT, rejeitar token ausente/inválido (`401`) e negar papel não autorizado (`403`).
- **RF06:** disponibilizar saúde do gateway e dos serviços por `GET /health` e `GET /health/services`.

### Administração

- **RF07:** disponibilizar consultas e operações de turmas em `/api/administrative/classes`, incluindo horário por turma.
- **RF08:** disponibilizar consultas e operações de disciplinas em `/api/administrative/subjects`.
- **RF09:** disponibilizar consultas, criação e remoção de alocações em `/api/administrative/allocations` e consulta de horário de professor em `/api/administrative/teachers/:teacherId/schedule`.
- **RF10:** rejeitar conflitos de horário para professor, turma ou sala; permitir faixas adjacentes sem sobreposição.
- **RF11:** rejeitar horário inválido, referência a professor inexistente e operações não permitidas ao perfil estudante.

### Acadêmico

- **RF12:** permitir consultar/criar inscrições e alterar seu status em `/api/academic/enrollments`, observando o limite de capacidade da turma.
- **RF13:** permitir consultar e registrar notas em `/api/academic/grades`, rejeitando nota 11.
- **RF14:** calcular média ponderada de forma assíncrona e consultável em `/api/academic/students/:id/average`; caso de referência: notas 7 e 9 com pesos 1 e 3, resultado 8,5 em até dez segundos.
- **RF15:** permitir registro em lote de frequência e consultas em `/api/academic/attendance`, `/api/academic/attendance/summary` e `/api/academic/students/:id/attendance`; o caso de referência contém presença, ausência e atraso e resulta em 66,67%.
- **RF16:** aplicar perfis de professor e estudante aos endpoints acadêmicos.

### Eventos, notificações e operação

- **RF17:** publicar e consumir eventos escolares pelo RabbitMQ, mantendo a API de notificações em `/api/notifications`.
- **RF18:** verificar o recebimento de uma notificação do tipo `grade.posted`.
- **RF19:** confirmar existência das filas e consumidores no RabbitMQ Management.
- **RF20:** verificar que uma criação administrativa não falha quando RabbitMQ está parado, restaurar o broker e observar uma segunda notificação após reconexão.
- **RF21:** aplicar rate limit ao login como último caso do smoke test e aguardar a janela liberar uma nova autenticação.
- **RF22:** executar smoke test com `BaseUrl`, dados únicos, relatório `PASS`/`FAIL` com status HTTP, limpeza dos registros gerados mesmo em falha e código de saída não zero quando houver falhas.
- **RF23:** entregar notificações em tempo real por WebSocket aos perfis `admin`, `staff` e `teacher`, conforme o público de cada tipo de evento.
- **RF24:** informar a quantidade de notificações não lidas por usuário e permitir marcá-las como vistas.
- **RF25:** executar teste de caos em `scripts/chaos-test.sh` com relatório `PASS`/`FAIL` e religamento do que foi parado.

## Contratos de rota e perfis

Os endpoints de cliente estão sob `/api` e passam pelo gateway. As únicas exceções são os endpoints de diagnóstico próprios do gateway (`/health` e `/health/services`) e chamadas à API de management do RabbitMQ. Os caminhos e perfis documentados são:

- autenticação e usuários: `/api/auth/*`, `/api/users`;
- alunos: `/api/students` e `/api/students/:id`;
- funcionários: `/api/employees` e `/api/employees/:id`;
- administração: `/api/administrative/classes`, `/api/administrative/subjects`, `/api/administrative/allocations` e `/api/administrative/teachers/:teacherId/schedule`;
- acadêmico: `/api/academic/enrollments`, `/api/academic/grades`, `/api/academic/attendance`, `/api/academic/attendance/summary` e `/api/academic/students/:id/{average,attendance}`;
- notificações: `GET /api/notifications`, `GET /api/notifications/unread-count` e `POST /api/notifications/seen` para `admin`, `staff` e `teacher`.

Verbos HTTP e papéis permitidos por operação estão na [tabela completa da API](api.md). Esta especificação documental não inventa ou reproduz campos de requisição/resposta; esses formatos pertencem aos contratos de cada serviço.

## Requisitos não funcionais

- **RNF01 — Isolamento:** cada serviço é proprietário do próprio banco/esquema; comunicação síncrona usa HTTP e eventos assíncronos usam RabbitMQ.
- **RNF02 — Segurança:** JWT e credenciais são lidos do ambiente; `.env`, tokens e senhas não devem ser impressos nem versionados.
- **RNF03 — Gateway:** clientes usam o gateway publicado, não portas internas de serviços.
- **RNF04 — Conflitos:** falhas de unicidade/agenda/capacidade devem ser informadas com status apropriado, sem detalhes de banco.
- **RNF05 — Assincronia:** média e notificações devem ser consultáveis por polling sem bloquear a operação produtora por todo o processamento.
- **RNF06 — Resiliência:** chamadas entre serviços usam até 3 tentativas e Circuit Breaker; o gateway mantém um Circuit Breaker por serviço; eventos são gravados em outbox na transação do dado; consumidores usam retry e DLQ.
- **RNF07 — Limpeza:** smoke test deve remover só registros gerados no próprio run e não purgar filas/dados preexistentes.

## Limitações de limpeza e execução

Nem todos os domínios oferecem exclusão HTTP: usuários não têm rota de exclusão, inscrições têm apenas alteração de status, frequência tem operações de lote e notificações só têm consulta. Para garantir remoção física de dados temporários, o smoke test usa `psql` dentro do container PostgreSQL somente para IDs e identificadores únicos que ele próprio registrou. A ordem de limpeza respeita dependências e o usuário administrador seed é preservado.

O caso de RabbitMQ parado interrompe e depois inicia o container local `rabbitmq`. A rotina de restauração ocorre em `finally`; o teste deve ser usado apenas no Compose local isolado e nunca em um ambiente compartilhado. O rate limit é o último caso funcional, após limpeza.

## Status de implementação

A árvore contém o código dos serviços de E1 e os módulos de gateway, administração, acadêmico e notificações. A presença de arquivos não garante que todas as rotas e fluxos estejam integrados ao Compose. A Fase 7 deve ser executada em ambiente local completo após a implementação dos contratos. Não executar esse smoke test durante validação estática: ele cria registros, para/reinicia o broker e aguarda o limite de login expirar.
