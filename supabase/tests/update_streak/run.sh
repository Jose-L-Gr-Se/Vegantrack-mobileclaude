#!/usr/bin/env bash
# Pruebas SQL de update_streak contra un Postgres DESECHABLE (nunca toca ninguna base real).
#   bash supabase/tests/update_streak/run.sh
# Contra otra migración (p. ej. para comprobar que los tests detectan el fallo antiguo):
#   STREAK_MIGRATION=supabase/migrations/20260929000000_close_update_streak_cross_user_vector.sql bash supabase/tests/update_streak/run.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
MIGRATION="${STREAK_MIGRATION:-$REPO/supabase/migrations/20260930000000_update_streak_chronological.sql}"
[[ "$MIGRATION" = /* ]] || MIGRATION="$REPO/$MIGRATION"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[[ -x "$PG_BIN/initdb" ]] || { echo "No se encuentra Postgres (PG_BIN)"; exit 2; }

WORK="$(mktemp -d /tmp/streak-test.XXXXXX)"
PORT=$((54000 + RANDOM % 900))
if [[ "$(id -u)" = 0 ]]; then chown postgres "$WORK"; AS_PG=(su -s /bin/bash postgres -c); else AS_PG=(bash -c); fi
pg() { "${AS_PG[@]}" "$*"; }
cleanup() { pg "$PG_BIN/pg_ctl -D $WORK/data -m immediate stop" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

pg "$PG_BIN/initdb -D $WORK/data -A trust -U postgres" >/dev/null 2>&1 || { echo "initdb falló"; exit 2; }
pg "$PG_BIN/pg_ctl -D $WORK/data -o '-p $PORT -k $WORK -c listen_addresses=' -l $WORK/log -w start" >/dev/null 2>&1 || { echo "arranque falló"; cat "$WORK/log"; exit 2; }

PSQL() { "$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d lab -X -q -t -A -v repo="$REPO" "$@"; }
"$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -X -q -c "create database lab" || exit 2

echo "── migración bajo prueba: ${MIGRATION#$REPO/}"
PSQL -v ON_ERROR_STOP=1 -f "$HERE/00_stub.sql" >/dev/null || { echo "stub falló"; exit 2; }
PSQL -v ON_ERROR_STOP=1 -f "$HERE/10_backfill_seed.sql" >/dev/null || exit 2
PSQL -v ON_ERROR_STOP=1 -f "$MIGRATION" >/dev/null 2>&1 || { echo "la migración falló al aplicarse"; PSQL -v ON_ERROR_STOP=1 -f "$MIGRATION" 2>&1 | tail -5; exit 2; }
PSQL -f "$HERE/20_backfill_assert.sql" >/dev/null
PSQL -v ON_ERROR_STOP=1 -f "$MIGRATION" >/dev/null 2>&1 || { echo "reaplicar la migración falló"; exit 2; }   # idempotencia de la migración
PSQL -f "$HERE/25_backfill_rerun_assert.sql" >/dev/null

# Variantes de la función bajo prueba para la concurrencia: extraídas de la propia migración.
FN="$(awk 'tolower($0) ~ /^create or replace function public\.update_streak\(/{p=1} p{print} p&&/^\$function\$;/{exit}' "$MIGRATION")"
[[ -n "$FN" ]] || { echo "no se pudo extraer la función de la migración"; exit 2; }
variant() { # $1 nombre, $2 con_sleep(1/0), $3 con_lock(1/0)
  local s="$FN"
  s="$(sed -E "s/public\.update_streak\(/public.$1(/" <<<"$s")"
  [[ "$2" = 1 ]] && s="$(awk '!d && tolower($0) ~ /^[ \t]*update profiles/{print "  perform pg_sleep(1);"; d=1} {print}' <<<"$s")"
  [[ "$3" = 0 ]] && s="$(grep -viE 'perform 1 from profiles .* for update' <<<"$s")"
  echo "$s"
}
{ variant update_streak_slow 1 1; variant update_streak_nolock_slow 1 0; variant update_streak_nolock 0 0; } | PSQL -v ON_ERROR_STOP=1 -f - >/dev/null || { echo "no se pudieron crear las variantes"; exit 2; }

PSQL -f "$HERE/30_scenarios.sql" > "$WORK/scenarios.out" 2>&1

# 05 / 14 · concurrencia real con dos sesiones solapadas. Estado inicial: días -5..-2 registrados.
# Sesión 1 registra el día -1 (llamada LENTA: 1 s entre lectura y escritura); 0,3 s después la
# sesión 2 registra HOY. Correcto = (0,6). Cada inserción se confirma ANTES de su llamada, como el cliente.
race() { # $1 función lenta (sesión 1)  $2 función rápida (sesión 2)
  PSQL -c "select t.setup(100, array[-5,-4,-3,-2])" >/dev/null
  ( PSQL -c "select t.as_user(100); insert into food_log(user_id,date) values (t.uid(100), t.today()-1)" >/dev/null
    PSQL -c "select t.as_user(100); select public.$1(t.uid(100), t.today()-1)" >/dev/null ) &
  sleep 0.3
  ( PSQL -c "select t.as_user(100); insert into food_log(user_id,date) values (t.uid(100), t.today())" >/dev/null
    PSQL -c "select t.as_user(100); select public.$2(t.uid(100), t.today())" >/dev/null ) &
  wait
  PSQL -c "select t.state(100)"
}
CTRL="$(race update_streak_nolock_slow update_streak_nolock)"
LOCK="$(race update_streak_slow update_streak)"
ORACLE="$(PSQL -c "select t.oracle(100)")"

report() { # etiqueta, obtenido, esperado, (invertir: 1 = esperamos que DIFIERA)
  local ok=0; if [[ "${4:-0}" = 1 ]]; then [[ "$2" != "$3" ]] && ok=1; else [[ "$2" = "$3" ]] && ok=1; fi
  if [[ $ok = 1 ]]; then echo "ok   $1"; else echo "FAIL $1   [obtenido $2 · esperado $([[ ${4:-0} = 1 ]] && echo "≠ ")$3]"; fi
}
{
  cat "$WORK/scenarios.out"
  echo "-- concurrencia real (dos sesiones solapadas; correcto = (0,6))"
  report "05 CONTROL sin FOR UPDATE: la carrera SÍ ocurre (deja un estado obsoleto)" "$CTRL" "(0,6)" 1
  report "14 CON FOR UPDATE: las llamadas solapadas convergen al valor correcto" "$LOCK" "(0,6)"
  report "14b CON FOR UPDATE: coincide con el oráculo independiente" "$LOCK" "$ORACLE"
} | tee "$WORK/all.out"
TOTAL_FAIL=$(grep -c '^FAIL' "$WORK/all.out")
echo "══ update_streak: $TOTAL_FAIL fallo(s)"
[[ "$TOTAL_FAIL" = 0 ]]
