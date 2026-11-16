# SchoolFlow

Sistema distribuído para gestão escolar com API Gateway, serviços administrativos e acadêmicos, notificações assíncronas por RabbitMQ e interface web. Consulte [Requisitos](docs/requisitos.md), [API](docs/api.md) e [Mensageria](docs/mensageria.md) para os contratos e fluxos.

## Componentes e portas

| Componente | Porta publicada | Responsabilidade |
|---|---:|---|
| API Gateway | 8080 | Entrada HTTP para os clientes; encaminhamento e políticas transversais |
| `user-service` | 3001 (interna) | Cadastro, login, JWT e gestão de usuários |
| `student-service` | 3002 (interna) | Cadastro e consulta de alunos |
| `staff-service` | 3003 (interna) | Cadastro e consulta de funcionários |
| `academic-service` | 3004 (interna) | Notas, média ponderada e frequência |
| `administrative-service` | 3005 (interna) | Recursos e regras administrativas |
| `notification-service` | 3006 (interna) | Consumo de eventos e consulta de notificações |
| RabbitMQ Management | 15672 | Administração e inspeção das filas |
| PostgreSQL | 5432 | Persistência em bancos separados por serviço |
| Frontend | 3000 | Interface web |

As portas internas dos serviços não são publicadas pelo Compose; o acesso de cliente deve ocorrer pelo gateway.

## Pré-requisitos

- Docker Desktop com Docker Compose v2.
- PowerShell 5.1 ou posterior.
- `.env` local preenchido com as variáveis de `.env.example`. Troque as credenciais de exemplo antes de usar em qualquer ambiente compartilhado. Não versione nem compartilhe `.env`.

## Executar

Na raiz do projeto:

```powershell
Copy-Item .env.example .env
# Edite .env localmente para definir credenciais próprias.
docker compose up -d --build
docker compose ps
```

O PostgreSQL e o RabbitMQ possuem verificações de saúde. Os serviços dependentes aguardam as condições declaradas no Compose. Para encerrar o ambiente:

```powershell
docker compose down
```

O comando acima preserva o volume de dados. Remova volumes somente quando tiver certeza de que deseja apagar dados locais.

## Kubernetes (Minikube)

Os manifests em `k8s/` cobrem PostgreSQL, RabbitMQ e os oito serviços de aplicação. Antes de aplicar, crie no namespace `distrischool` o Secret `distrischool-secrets` com as chaves referenciadas pelos manifests, usando os valores locais de `.env` sem versioná-los. Construa as imagens e aplique os recursos:

```powershell
$services = @('user-service', 'student-service', 'staff-service', 'academic-service', 'administrative-service', 'notification-service', 'api-gateway', 'frontend')
foreach ($service in $services) {
    minikube image build -t "distrischool/$service`:0.3" "services\$service"
}
kubectl apply -f k8s/
```

O ConfigMap `postgres-init` cria os seis bancos ao inicializar um volume PostgreSQL vazio; atualizar o ConfigMap não recria bancos em um volume já inicializado.

## Smoke test

Com o ambiente ativo e `.env` presente na pasta atual:

```powershell
./scripts/smoke-test.ps1 -BaseUrl http://localhost:8080
```

O script lê credenciais diretamente de `.env` sem mostrá-las, usa identificadores únicos, imprime um resultado `PASS`/`FAIL` com status HTTP, tenta remover os registros que criou e termina com código diferente de zero em caso de falha. A limitação de requisições é verificada por último e o script aguarda até a janela liberar um login válido. A validação de resiliência interrompe temporariamente o RabbitMQ e o reinicia ao final do caso. Os contratos e limitações conhecidas estão documentados em [docs/api.md](docs/api.md).

## Teste de caos

Com o ambiente ativo, o script derruba serviços de propósito e confere a recuperação. Use apenas em ambiente local:

```bash
bash scripts/chaos-test.sh
```

Ele cobre a configuração das filas, a abertura e o fechamento do Circuit Breaker, o envio de eventos após uma queda do RabbitMQ, a retenção de mensagens com o serviço de notificações parado e o desvio de mensagens inválidas para a DLQ. Imprime `PASS`/`FAIL`, religa o que parou e remove os dados que criou. A mensagem inválida do último caso permanece na DLQ.

## Atualizando um ambiente já existente

As filas `notification.events` e `academic.grade-average` mudaram de configuração. O RabbitMQ recusa redeclarar uma fila durável com argumentos diferentes, então remova as antigas uma única vez. Mensagens ainda na fila são perdidas:

```bash
docker compose stop notification-service academic-service
docker compose exec rabbitmq rabbitmqctl delete_queue notification.events
docker compose exec rabbitmq rabbitmqctl delete_queue academic.grade-average
docker compose up -d --build
```

Depois de `git pull`, sempre suba com `--build`; sem ele, o Docker reaproveita as imagens antigas. No Kubernetes, execute os mesmos `delete_queue` com `kubectl -n distrischool exec deployment/rabbitmq --`, depois de atualizar as imagens para a tag `0.3`.

## Documentação

- [Requisitos e status de implementação](docs/requisitos.md)
- [Arquitetura em camadas e serviços](docs/arquitetura-camadas.md)
- [Contratos da API, endpoints e perfis](docs/api.md)
- [RabbitMQ, filas e eventos](docs/mensageria.md)

## Estrutura

```text
.
├── docs/
├── infra/postgres/
├── k8s/
├── scripts/
│   └── smoke-test.ps1
└── services/
    ├── api-gateway/
    ├── administrative-service/
    ├── academic-service/
    ├── notification-service/
    ├── user-service/
    │   └── src/
    │       ├── app.js, index.js
    │       ├── config/       # env.js, db.js
    │       ├── controllers/
    │       ├── database/     # schema.js
    │       ├── errors/
    │       ├── middlewares/
    │       ├── repositories/
    │       ├── routes/
    │       └── services/     # inclui o seed administrativo
    ├── student-service/
    │   └── src/              # app, config, controllers, database,
    │                         # errors, middlewares, repositories, routes, services
    ├── staff-service/
    │   └── src/              # mesma organização em camadas do student-service
    └── frontend/
```

Cada serviço de domínio mantém seu próprio banco de dados e expõe endpoints HTTP/JSON. O gateway é o ponto de entrada dos clientes; as chamadas internas síncronas permanecem HTTP e os eventos assíncronos usam RabbitMQ quando aplicável.

## Roadmap

- **Entrega 2 (E2):** API Gateway, serviços acadêmico e administrativo, mensageria RabbitMQ, notificações e frontend básico.
- **Entrega 3 (E3, implementada):** Circuit Breaker, retentativas, outbox transacional, DLQ e notificações em tempo real por WebSocket.
- **Entrega 4 (E4):** CI/CD com GitHub Actions, monitoramento Prometheus/Grafana, testes de carga, documentação final e vídeo de apresentação.
