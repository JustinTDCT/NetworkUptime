# NetworkUptime

NetworkUptime is a Docker-based network monitoring foundation with a server and headless agents. This first pass includes the deployment shape, configuration contracts, database schema, authentication primitives, a basic web UI, monitor management, and agent registration/check-in flow.

## Current Scope

- Server and agent TypeScript apps in a pnpm monorepo.
- HTTPS server support through configured TLS certificate and key files.
- SQLite-backed Prisma schema with deployable migrations for users, settings, agents, monitors, monitor history, dependencies, and alert settings.
- Default admin bootstrap with username `admin` and a password from `ADMIN_PASSWORD` or `ADMIN_PASSWORD_FILE`.
- Agent key authentication using a UUID shared secret stored hashed on the server.
- IP allow/block mode schema and enforcement for agent endpoints.
- Basic dashboard at `https://localhost:8443`.
- Agent-driven `up/down` monitor checks with result history.
- Consecutive-cycle alert state evaluation with parent monitor suppression.
- Optional webhook notification for alert state changes.
- HTTP/HTTPS content monitors with scan-and-approve response signatures.

Additional notification providers and richer HTTP matching rules are intentionally left for later implementation passes.

## Local Docker Start

Copy the example environment and choose real secrets before running outside local development:

```sh
cp .env.example .env
docker compose up --build server
```

To run a local agent beside the server:

```sh
docker compose --profile agent up --build
```

The Docker server image generates a development self-signed certificate. The agent profile sets `NODE_TLS_REJECT_UNAUTHORIZED=0` so local check-ins work against that certificate. Use a real certificate and remove that setting for production.

The server stores SQLite data in the `server-data` Docker volume at `/data/networkuptime.db`. Startup runs `prisma migrate deploy`; existing development databases created before migrations are baselined automatically on first boot.

Open the UI at:

```text
https://localhost:8443
```

The local development certificate is self-signed, so your browser will ask you to continue through a certificate warning.

## Configuration

The server can be configured with environment variables or a JSON config file:

```sh
NETWORKUPTIME_CONFIG=/app/config/server.json pnpm --filter @networkuptime/server start
```

See `config/server.example.json` and `config/agent.example.json` for the file formats.

Important server variables:

- `SERVER_ADDRESS`: HTTPS URL agents should use to reach the server, including a port if needed.
- `SERVER_PORT`: server listen port.
- `SERVER_AGENT_KEY`: UUID key agents use to authenticate.
- `ADMIN_USERNAME`: defaults to `admin`.
- `ADMIN_PASSWORD`: initial admin password. It must be at least 12 characters and include lowercase, uppercase, and a number.
- `ADMIN_PASSWORD_FILE`: optional file path for the initial admin password, useful with Docker secrets.
- `TLS_CERT_FILE` and `TLS_KEY_FILE`: enable HTTPS listener.
- `ALERT_WEBHOOK_URL`: optional webhook target for alert notifications.

## Database Operations

Create and apply local schema migrations while developing:

```sh
pnpm prisma:migrate:dev
```

Apply committed migrations in deployed environments:

```sh
pnpm prisma:migrate:deploy
```

Back up the SQLite database file:

```sh
DATABASE_URL=file:/data/networkuptime.db BACKUP_DIR=/data/backups pnpm backup:sqlite
```

Important agent variables:

- `AGENT_NAME`: friendly agent name shown in the UI later.
- `AGENT_DESCRIPTION`: location or purpose text.
- `SERVER_URL`: server URL the agent phones home to.
- `SERVER_KEY`: UUID agent key from server settings.
- `AGENT_STATE_PATH`: persisted UUID identity file path.

## API Foundation

- `GET /health`
- `POST /api/auth/login`
- `GET /api/settings/server`
- `PUT /api/settings/server`
- `GET /api/settings/alerts`
- `PUT /api/settings/alerts`
- `POST /api/agents/register`
- `POST /api/agents/:id/check-in`
- `GET /api/agents/:id/monitors`
- `POST /api/agents/:id/checks`
- `GET /api/agents`
- `GET /api/monitors`
- `POST /api/monitors`
- `PUT /api/monitors/:id`
- `DELETE /api/monitors/:id`
- `POST /api/monitors/:id/approve-http-signature`
- `GET /api/alerts/events`

Protected server routes require a logged-in admin token. Agent routes require `Authorization: Bearer <SERVER_AGENT_KEY>`.
