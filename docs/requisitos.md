# Requisitos do DistriSchool

## Objetivo

O DistriSchool é um sistema distribuído para apoiar a gestão escolar. A primeira entrega separa autenticação e usuários, alunos e funcionários em serviços REST independentes, com persistência PostgreSQL.

## Requisitos funcionais

### Usuários e autenticação

- **RF01:** permitir login por e-mail e senha e emitir um token JWT com validade limitada.
- **RF02:** permitir cadastro público de usuários com os papéis `student` e `parent`; qualquer papel público inválido deve resultar em cadastro como `student`, sem permitir criação pública de administradores.
- **RF03:** disponibilizar a identificação do usuário autenticado.
- **RF04:** permitir que um administrador crie usuários dos papéis `admin`, `teacher`, `student`, `parent` e `staff`, e consulte a lista de usuários.
- **RF05:** criar automaticamente o usuário administrador inicial quando `ADMIN_EMAIL` e `ADMIN_PASSWORD` estiverem configurados.
- **RF06:** rejeitar e-mails duplicados e senhas menores que seis caracteres no cadastro.

### Alunos

- **RF07:** permitir cadastrar aluno com matrícula e nome obrigatórios, além de data de nascimento, endereço, contato, turma e estado ativo opcionais.
- **RF08:** permitir consultar alunos e filtrar por nome, matrícula ou turma.
- **RF09:** permitir consultar, atualizar e excluir aluno pelo identificador.
- **RF10:** rejeitar matrícula duplicada e informar quando um aluno não existe.

### Funcionários

- **RF11:** permitir cadastrar funcionários dos tipos `teacher` e `admin_staff`, com nome e e-mail obrigatórios.
- **RF12:** permitir consultar e filtrar funcionários por tipo, nome ou e-mail.
- **RF13:** permitir consultar, atualizar e excluir funcionário pelo identificador.
- **RF14:** rejeitar tipos inválidos e e-mails duplicados.

### Operação

- **RF15:** expor um endpoint `/health` em cada serviço.
- **RF16:** permitir executar os serviços e os bancos com Docker Compose.
- **RF17:** disponibilizar manifests Kubernetes para PostgreSQL e para os três serviços.

## Requisitos não funcionais

- **RNF01 — Separação:** cada serviço executa independentemente e mantém seu próprio banco PostgreSQL (`users_db`, `students_db` ou `staff_db`).
- **RNF02 — API:** os serviços expõem endpoints HTTP/JSON e usam as portas 3001, 3002 e 3003.
- **RNF03 — Autenticação:** as rotas protegidas validam JWT assinado com `JWT_SECRET`.
- **RNF04 — Autorização:** as operações verificam os papéis permitidos; a ausência de token retorna 401 e papel sem permissão retorna 403.
- **RNF05 — Persistência:** dados são armazenados em PostgreSQL; a matrícula do aluno e o e-mail de usuário/funcionário são únicos em suas respectivas bases.
- **RNF06 — Empacotamento:** cada serviço tem imagem Docker própria e dependências Node.js declaradas em `package.json` e `package-lock.json`.
- **RNF07 — Configuração:** credenciais e segredo JWT devem ser fornecidos por variáveis de ambiente; `.env` local não deve ser versionado.
- **RNF08 — Saúde:** cada serviço responde em `/health`, e o Compose aguarda o estado saudável do PostgreSQL antes de iniciar as APIs.

## Arquitetura implementada

| Componente | Responsabilidade | Persistência |
|---|---|---|
| `user-service` | Registro, login, JWT e administração de usuários | PostgreSQL `users_db` |
| `student-service` | CRUD e pesquisa de alunos | PostgreSQL `students_db` |
| `staff-service` | CRUD e pesquisa de funcionários | PostgreSQL `staff_db` |
| PostgreSQL | Servidor de dados compartilhado, com bancos separados por serviço | Volume Docker ou PVC Kubernetes |

Os serviços de alunos e funcionários validam o token JWT localmente com o mesmo segredo compartilhado. A autorização por perfil é aplicada nas rotas. A comunicação síncrona entre clientes e serviços usa HTTP/JSON; gateway e mensageria não fazem parte desta entrega.

## Perfis e permissões implementados

| Recurso | `admin` | `teacher` | `staff` | `student` | `parent` |
|---|---:|---:|---:|---:|---:|
| `/auth/me` com token válido | Sim | Sim | Sim | Sim | Sim |
| Listar usuários (`GET /users`) | Sim | Não | Não | Não | Não |
| Criar usuário administrativo (`POST /users`) | Sim | Não | Não | Não | Não |
| Consultar alunos (`GET /students`, `GET /students/:id`) | Sim | Sim | Sim | Não | Não |
| Criar/editar aluno | Sim | Não | Sim | Não | Não |
| Excluir aluno | Sim | Não | Não | Não | Não |
| Consultar funcionários (`GET /employees`, `GET /employees/:id`) | Sim | Sim | Sim | Não | Não |
| Criar/editar/excluir funcionário | Sim | Não | Não | Não | Não |

Login e cadastro são públicos. O cadastro público aceita `student` ou `parent`; se outro papel for solicitado, a conta é criada como `student`. Os endpoints `/health` também são públicos. Não há, nesta entrega, endpoint dedicado para que estudantes ou responsáveis consultem seus próprios registros.

