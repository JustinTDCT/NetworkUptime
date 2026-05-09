# NetworkUptime

NetworkUptime is a Docker-based network monitoring foundation with a server and headless agents. This first pass includes the deployment shape, configuration contracts, database schema, authentication primitives, and agent registration/check-in flow.

## Current Scope

- Server and agent TypeScript apps in a pnpm monorepo.
- HTTPS server support through configured TLS certificate and key files.
- SQLite-backed Prisma schema for users, settings, agents, monitors, monitor history, dependencies, and alert settings.
- Default admin bootstrap with username `admin` and password from `ADMIN_PASSWORD`, falling back to `admin`.
- Agent key authentication using a UUID shared secret stored hashed on the server.
- IP allow/block mode schema and enforcement for agent endpoints.

Monitor execution, alert delivery, and the web UI are intentionally left for the next implementation pass.

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
- `ADMIN_PASSWORD`: defaults to `admin` when unset.
- `TLS_CERT_FILE` and `TLS_KEY_FILE`: enable HTTPS listener.

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
- `POST /api/agents/register`
- `POST /api/agents/:id/check-in`
- `GET /api/agents`

Protected server routes require a logged-in admin token. Agent routes require `Authorization: Bearer <SERVER_AGENT_KEY>`.
