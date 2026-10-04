# DistriSchool

Sistema distribuído para gestão escolar, organizado em serviços independentes para usuários e autenticação, alunos e funcionários. Cada serviço tem seu próprio banco PostgreSQL e expõe uma API REST protegida por JWT quando necessário.

## Arquitetura

| Serviço | Porta | Banco de dados | Função |
|---|---:|---|---|
| `user-service` | 3001 | `users_db` | Cadastro e autenticação, emissão de JWT e gestão de usuários |
| `student-service` | 3002 | `students_db` | Cadastro, consulta, atualização e remoção de alunos |
| `staff-service` | 3003 | `staff_db` | Cadastro, consulta, atualização e remoção de funcionários |
| PostgreSQL | 5432 | — | Persistência dos três bancos dos serviços |

## Pré-requisitos

- Docker Desktop com Docker Compose v2.
- PowerShell no Windows (ou shell compatível com os comandos Docker).
- Para executar localmente sem containers: Node.js LTS e npm.
- Para Kubernetes local: Minikube e `kubectl`.

## Como executar com Docker Compose

Na raiz do projeto, crie o arquivo de configuração local e inicie os serviços:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
docker compose ps
```

Edite `.env` antes de usar em ambientes compartilhados: configure senhas e um `JWT_SECRET` próprios. O `.env` está no `.gitignore` e não deve ser enviado ao repositório.

Confira a disponibilidade dos serviços:

```powershell
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3002/health
Invoke-RestMethod http://localhost:3003/health
```

Os bancos são criados pelo script `infra/postgres/init.sql` na primeira inicialização do volume do PostgreSQL.

## Como testar a API

Os exemplos abaixo usam PowerShell e os valores de administrador configurados em `.env`:

```powershell
$config = @{}
Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
        $config[$matches[1].Trim()] = $matches[2].Trim()
    }
}

$login = Invoke-RestMethod -Method Post `
    -Uri http://localhost:3001/auth/login `
    -ContentType 'application/json' `
    -Body (@{
        email = $config['ADMIN_EMAIL']
        password = $config['ADMIN_PASSWORD']
    } | ConvertTo-Json)

$headers = @{ Authorization = "Bearer $($login.token)" }
```

Criar e consultar um aluno:

```powershell
$aluno = Invoke-RestMethod -Method Post `
    -Uri http://localhost:3002/students `
    -Headers $headers `
    -ContentType 'application/json' `
    -Body (@{
        registration = '2026001'
        name = 'João Lima'
        birth_date = '2012-05-10'
        class_name = '7A'
    } | ConvertTo-Json)

Invoke-RestMethod -Uri 'http://localhost:3002/students?q=João' -Headers $headers
```

Criar um funcionário:

```powershell
Invoke-RestMethod -Method Post `
    -Uri http://localhost:3003/employees `
    -Headers $headers `
    -ContentType 'application/json' `
    -Body (@{
        type = 'teacher'
        name = 'Ana Souza'
        email = 'ana@escola.com'
        qualification = 'Mestre em Matemática'
        subjects = 'Matemática'
    } | ConvertTo-Json)
```

Para acompanhar os logs do serviço de usuários:

```powershell
docker compose logs -f user-service
```

## Kubernetes (Minikube)

Inicie o cluster e construa as imagens diretamente no Minikube:

```powershell
minikube start --driver=docker
minikube image build -t distrischool/user-service:0.1 services/user-service
minikube image build -t distrischool/student-service:0.1 services/student-service
minikube image build -t distrischool/staff-service:0.1 services/staff-service
```

Crie o namespace, o secret a partir do `.env` local e a configuração de inicialização do PostgreSQL:

```powershell
kubectl apply -f k8s/00-namespace.yaml

$config = @{}
Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
        $config[$matches[1].Trim()] = $matches[2].Trim()
    }
}
kubectl -n distrischool delete secret distrischool-secrets --ignore-not-found
kubectl -n distrischool create secret generic distrischool-secrets `
    "--from-literal=postgres-password=$($config['POSTGRES_PASSWORD'])" `
    "--from-literal=jwt-secret=$($config['JWT_SECRET'])" `
    "--from-literal=admin-email=$($config['ADMIN_EMAIL'])" `
    "--from-literal=admin-password=$($config['ADMIN_PASSWORD'])"

kubectl -n distrischool delete configmap postgres-init --ignore-not-found
kubectl -n distrischool create configmap postgres-init --from-file=infra/postgres/init.sql
kubectl apply -f k8s/10-postgres.yaml
kubectl -n distrischool rollout status deployment/postgres --timeout=180s
kubectl apply -f k8s/user-service.yaml -f k8s/student-service.yaml -f k8s/staff-service.yaml
kubectl -n distrischool rollout status deployment/user-service --timeout=180s
kubectl -n distrischool rollout status deployment/student-service --timeout=180s
kubectl -n distrischool rollout status deployment/staff-service --timeout=180s
kubectl -n distrischool get pods -o wide
```

Para acessar a API localmente, execute cada encaminhamento em uma janela PowerShell separada:

```powershell
kubectl -n distrischool port-forward svc/user-service 3001:3001
kubectl -n distrischool port-forward svc/student-service 3002:3002
kubectl -n distrischool port-forward svc/staff-service 3003:3003
```

## Endpoints e permissões

Todas as rotas de alunos e funcionários exigem JWT, exceto `/health`. Os papéis autorizados são verificados pelo middleware de cada serviço.

| Método e rota | Acesso |
|---|---|
| `GET /health` (cada serviço) | Público |
| `POST /auth/register` | Público; papel solicitado é limitado a `student` ou `parent`; valores não permitidos viram `student` |
| `POST /auth/login` | Público |
| `GET /auth/me` | Qualquer usuário autenticado |
| `POST /users`, `GET /users` | `admin` |
| `GET /students`, `GET /students/:id` | `admin`, `teacher`, `staff` |
| `POST /students`, `PUT /students/:id` | `admin`, `staff` |
| `DELETE /students/:id` | `admin` |
| `GET /employees`, `GET /employees/:id` | `admin`, `staff`, `teacher` |
| `POST /employees`, `PUT /employees/:id`, `DELETE /employees/:id` | `admin` |

Os papéis `student` e `parent` não têm acesso autorizado às rotas de alunos ou funcionários no código atual. O cadastro público cria contas, mas não há rotas específicas de consulta de aluno/pais nesta entrega.

## Estrutura de pastas

```text
.
├── docs/                  # Requisitos do projeto
├── infra/postgres/        # Inicialização dos bancos
├── k8s/                   # Namespace, PostgreSQL e serviços Kubernetes
└── services/
    ├── user-service/
    ├── student-service/
    └── staff-service/
```

Cada serviço possui `Dockerfile`, dependências npm e código em `src/`, com rotas, conexão ao banco e middleware de autenticação.

## Roadmap

- **Entrega 2:** API Gateway, mensageria com Kafka ou RabbitMQ e frontend básico em React.
- **Entrega 3:** Circuit Breaker, mecanismos de resiliência e notificações assíncronas.
- **Entrega 4:** CI/CD com GitHub Actions, monitoramento com Prometheus/Grafana, testes de carga, documentação final e vídeo de apresentação.
