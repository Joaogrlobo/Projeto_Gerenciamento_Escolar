# Arquitetura em camadas

## Visão geral

O DistriSchool organiza a lógica por domínio, mantendo a persistência de cada serviço isolada. O API Gateway é a entrada dos clientes e encaminha HTTP/JSON para os serviços. RabbitMQ desacopla eventos assíncronos, especialmente efeitos colaterais de notificação.

```text
Cliente / Frontend
       │ HTTP
       ▼
 API Gateway ── HTTP/JSON ──► user-service
       │                       student-service
       │                       staff-service
       │                       administrative-service
       │                       academic-service
       │
       └──────────────────────► notification-service

Serviços de domínio ── eventos ──► RabbitMQ ──► notification-service

Cada serviço de domínio ─────────► banco PostgreSQL próprio
```

O código dos serviços e os manifests de Compose/Kubernetes estão presentes em `services/`, `infra/` e `k8s/`. A arquitetura inclui os oito serviços de aplicação, PostgreSQL e RabbitMQ; a configuração de execução e os contratos estão documentados no [README](../README.md), em [API](api.md) e em [Mensageria](mensageria.md).

## Responsabilidades e dados

| Componente | Responsabilidade | Persistência/comunicação |
|---|---|---|
| `api-gateway` | Entrada de cliente, encaminhamento de rotas e políticas transversais como limite de login | Sem banco de domínio; HTTP interno |
| `user-service` | Registro, autenticação JWT e administração de usuários | PostgreSQL `users_db` |
| `student-service` | CRUD e busca de alunos | PostgreSQL `students_db` |
| `staff-service` | CRUD e busca de funcionários | PostgreSQL `staff_db` |
| `administrative-service` | Recursos e regras administrativas, incluindo conflitos | PostgreSQL `administrative_db`; chamada HTTP a staff quando necessário |
| `academic-service` | Notas, média ponderada, frequência e eventos acadêmicos | PostgreSQL `academic_db`; HTTP a aluno/admin e publicação RabbitMQ |
| `notification-service` | Consumo de eventos e consulta de notificações | PostgreSQL `notification_db`; RabbitMQ |
| RabbitMQ | Transporte assíncrono | Broker independente; management em 15672 no host |
| PostgreSQL | Instância de banco de dados | Bancos separados e volume local |

Compartilhar o processo PostgreSQL não significa compartilhar o banco lógico ou permitir acesso cruzado: cada serviço deve ser dono do próprio esquema e API.

## Camadas internas

Os serviços `user-service`, `student-service` e `staff-service` organizam-se conforme o fluxo:

```text
Route -> Controller -> Service -> Repository -> config/db
```

- **Route (`routes/`)**: associa método/caminho ao controller e middlewares de autenticação/autorização. Não contém SQL nem regras de negócio.
- **Controller (`controllers/`)**: traduz HTTP em chamadas ao service e serializa status/corpo. Não importa repositories nem acessa diretamente o banco.
- **Service (`services/`)**: valida dados e regras, coordena repositories e lança erros de aplicação. Não conhece `req`/`res` nem escreve SQL.
- **Repository (`repositories/`)**: executa SQL parametrizado, retorna resultados e não importa services nem implementa regras de domínio.
- **Configuração (`config/`)**: lê e valida variáveis de ambiente e mantém configuração de conexão.
- **Banco/esquema (`database/`)**: inicializa tabelas do próprio serviço; apenas o serviço de usuários executa seed administrativo.
- **Middlewares (`middlewares/`)**: autenticação JWT, checagem de perfil e tratamento de erros.
- **Aplicação e entrada (`app.js`, `index.js`)**: compõe Express, health check, routers, inicialização de banco e listener.

As camadas não devem ser saltadas: routes não acessam services/repositories de persistência diretamente; controllers não chamam repositories; repositories não importam services.

## Comunicação, autenticação e autorização

- Cliente → gateway: HTTP/JSON com JWT nas rotas protegidas.
- Gateway → serviços: HTTP interno de acordo com variáveis `*_SERVICE_URL`.
- Serviço → serviço síncrono: somente quando a regra exige dados de outro domínio; use a API do serviço proprietário, nunca seu banco.
- Serviço → notificação assíncrona: evento RabbitMQ; a resposta da ação produtora não deve aguardar o envio final de uma notificação.
- Os serviços E1 validam localmente JWT com segredo compartilhado e aplicam perfis em rotas. A tabela completa de contratos e perfis está em [docs/api.md](api.md).
- No Compose, `depends_on` com `service_healthy` estabelece uma condição de partida, não resiliência a falha em runtime.
- Resiliência em runtime: `resilience/` concentra o Circuit Breaker e as novas tentativas; `messaging/relay.js` envia os eventos da outbox ao RabbitMQ.

## Como adicionar um endpoint

1. Defina método, caminho, perfis, status e validações no contrato da API.
2. No repository, implemente consulta/alteração SQL parametrizada no banco do próprio domínio.
3. No service, implemente regra, normalização e tratamento de inexistência/conflito.
4. No controller, traduza entrada/saída HTTP sem expor dados internos.
5. Na route, associe middlewares e perfis; monte o router na aplicação ou gateway conforme a topologia.
6. Adicione/atualize testes, documentação do endpoint e, quando aplicável, schema/versionamento de evento.
7. Verifique status HTTP, autorização, efeito de persistência, limpeza de dados temporários e regressões sem alterar rotas públicas existentes.

## Limitações e evolução

A Entrega 2 implementa os serviços, o gateway, eventos RabbitMQ, notificações, frontend e manifests Kubernetes; a validação integrada está disponível em `scripts/smoke-test.ps1`. A Entrega 3 acrescenta Circuit Breaker, novas tentativas, outbox, DLQ e WebSocket, verificados por `scripts/chaos-test.sh`. E4 prevê CI/CD, monitoramento, testes de carga e documentação final (detalhes em [README](../README.md)).
