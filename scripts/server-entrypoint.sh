#!/bin/sh
set -eu

db_path="${DATABASE_URL#file:}"

if [ "$db_path" != "$DATABASE_URL" ] && [ -s "$db_path" ]; then
  if ! deploy_output="$(pnpm --filter @networkuptime/db prisma:migrate:deploy 2>&1)"; then
    echo "$deploy_output"
    case "$deploy_output" in
      *P3005*) ;;
      *) exit 1 ;;
    esac

    echo "Baselining the initial migration for databases created by earlier db push builds."
    pnpm --filter @networkuptime/db prisma:migrate:resolve:init
    pnpm --filter @networkuptime/db prisma:migrate:deploy
  else
    echo "$deploy_output"
  fi
else
  pnpm --filter @networkuptime/db prisma:migrate:deploy
fi

exec pnpm --filter @networkuptime/server start
