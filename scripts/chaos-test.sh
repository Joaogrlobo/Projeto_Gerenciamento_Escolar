#!/usr/bin/env bash
# Derruba partes do ambiente Compose local e confere se o sistema se recupera.
# Use apenas em ambiente local: para e religa containers do projeto.
set -uo pipefail
cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
source .env
set +a

BASE_URL="${BASE_URL:-http://localhost:8080}"
RABBIT_URL="${RABBIT_URL:-http://localhost:15672}"
RUN_ID="CHAOS-$(date +%s)"
JSON='Content-Type: application/json'
FAILED=0
STUDENT_IDS=()
GRADE_IDS=()

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILED=1; }
field() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)" 2>/dev/null; }
sql() { docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$1" -Atc "$2"; }
queue_size() {
    docker compose exec -T rabbitmq rabbitmqctl -q list_queues name messages | awk -v q="$1" '$1 == q { print $2 }'
}

cleanup() {
    docker compose start student-service rabbitmq notification-service >/dev/null 2>&1
    sleep 2
    for id in "${GRADE_IDS[@]:-}"; do
        [ -n "$id" ] && curl -s -o /dev/null -X DELETE "$BASE_URL/api/academic/grades/$id" -H "$AUTH"
    done
    for id in "${STUDENT_IDS[@]:-}"; do
        [ -n "$id" ] && curl -s -o /dev/null -X DELETE "$BASE_URL/api/students/$id" -H "$AUTH"
    done
    sleep 2
    sql academic_db "DELETE FROM academic_averages WHERE subject = '$RUN_ID'" >/dev/null
    sql notification_db "DELETE FROM event_log WHERE message LIKE '%$RUN_ID%'" >/dev/null
}

create_student() {
    curl -s -X POST "$BASE_URL/api/students" -H "$AUTH" -H "$JSON" \
        -d "{\"registration\":\"$1\",\"name\":\"Teste de caos (apagar)\"}" -w '\n%{http_code}'
}

wait_for_notification() {
    for _ in $(seq 1 30); do
        [ "$(sql notification_db "SELECT count(*) FROM event_log WHERE message LIKE '%$1%'")" -ge 1 ] && return 0
        sleep 1
    done
    return 1
}

TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/login" -H "$JSON" \
    -d "$(python3 -c 'import json,os; print(json.dumps({"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}))')" | field "['token']")
if [ -z "$TOKEN" ]; then
    echo "FAIL  login do administrador"
    exit 1
fi
AUTH="Authorization: Bearer $TOKEN"
trap cleanup EXIT

# Topologia
QUEUES=$(docker compose exec -T rabbitmq rabbitmqctl -q list_queues name arguments)
if echo "$QUEUES" | grep -E '^notification\.events\s' | grep -q x-dead-letter-exchange \
    && echo "$QUEUES" | grep -E '^academic\.grade-average\s' | grep -q x-dead-letter-exchange; then
    pass "filas principais têm dead-letter configurado"
else
    fail "filas principais sem dead-letter (veja a migração de filas no README)"
fi

# Circuit Breaker
STUDENT_ID=$(create_student "$RUN_ID-base" | head -1 | field "['id']")
STUDENT_IDS+=("$STUDENT_ID")
GRADE="{\"student_id\":$STUDENT_ID,\"subject\":\"$RUN_ID\",\"value\":7}"
docker compose stop student-service >/dev/null 2>&1
ALL_503=1
for i in 1 2 3 4 5 6 7 8; do
    RESULT=$(curl -s -m 15 -o /dev/null -w '%{http_code} %{time_total}' -X POST "$BASE_URL/api/academic/grades" -H "$AUTH" -H "$JSON" -d "$GRADE")
    [ "${RESULT% *}" = "503" ] || ALL_503=0
    LAST_TIMES[i]="${RESULT#* }"
done
if [ "$ALL_503" = 1 ] && python3 -c "import sys; sys.exit(0 if float('${LAST_TIMES[7]}') < 0.3 and float('${LAST_TIMES[8]}') < 0.3 else 1)"; then
    pass "circuit breaker responde 503 imediato (${LAST_TIMES[8]}s)"
else
    fail "circuit breaker não abriu (última resposta em ${LAST_TIMES[8]}s)"
fi
if docker compose exec -T academic-service wget -qO- localhost:3004/health | grep -q '"student-service":"OPEN"'; then
    pass "health do academic mostra o circuito OPEN"
else
    fail "health do academic não mostra o circuito OPEN"
fi

# Recuperação
docker compose start student-service >/dev/null 2>&1
RECOVERED=0
for _ in $(seq 1 15); do
    BODY=$(curl -s -m 15 -X POST "$BASE_URL/api/academic/grades" -H "$AUTH" -H "$JSON" -d "$GRADE" -w '\n%{http_code}')
    if [ "$(echo "$BODY" | tail -1)" = "202" ]; then
        RECOVERED=1
        GRADE_IDS+=("$(echo "$BODY" | head -1 | field "['grade']['id']")")
        break
    fi
    sleep 2
done
[ "$RECOVERED" = 1 ] && pass "nota aceita após religar o serviço" || fail "serviço não se recuperou em 30 s"

# Outbox
docker compose stop rabbitmq >/dev/null 2>&1
RESPONSE=$(create_student "$RUN_ID-outbox")
STUDENT_IDS+=("$(echo "$RESPONSE" | head -1 | field "['id']")")
[ "$(echo "$RESPONSE" | tail -1)" = "201" ] && pass "aluno salvo com RabbitMQ parado" || fail "cadastro falhou com RabbitMQ parado"
[ "$(sql students_db 'SELECT count(*) FROM outbox_events')" -ge 1 ] && pass "evento guardado na outbox" || fail "evento não foi para a outbox"
docker compose start rabbitmq >/dev/null 2>&1
wait_for_notification "$RUN_ID-outbox" && pass "aviso entregue após religar o RabbitMQ" || fail "aviso não chegou em 30 s"

# Fila durável
docker compose stop notification-service >/dev/null 2>&1
RESPONSE=$(create_student "$RUN_ID-fila")
STUDENT_IDS+=("$(echo "$RESPONSE" | head -1 | field "['id']")")
sleep 3
docker compose start notification-service >/dev/null 2>&1
wait_for_notification "$RUN_ID-fila" && pass "aviso consumido após religar o serviço de notificações" || fail "aviso não foi consumido em 30 s"

# DLQ
BEFORE=$(queue_size distrischool.dlq)
curl -s -o /dev/null -u "$RABBITMQ_USER:$RABBITMQ_PASSWORD" -H "$JSON" -X POST \
    "$RABBIT_URL/api/exchanges/%2F/distrischool.events/publish" \
    -d '{"properties":{},"routing_key":"chaos.invalido","payload":"nao-json","payload_encoding":"string"}'
DLQ_OK=0
for _ in 1 2 3 4 5; do
    sleep 1
    [ "$(queue_size distrischool.dlq)" -gt "$BEFORE" ] && { DLQ_OK=1; break; }
done
[ "$DLQ_OK" = 1 ] && pass "mensagem inválida foi para a DLQ" || fail "mensagem inválida não chegou à DLQ"

[ "$FAILED" = 0 ] && echo "Resultado: todos os cenários passaram" || echo "Resultado: há cenários com falha"
exit "$FAILED"
