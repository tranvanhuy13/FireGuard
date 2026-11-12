# FireGuard system documentation

These guides describe the current repository and the practices used to maintain it. Paths are relative to the repository root unless a command specifies another working directory. Existing feature documentation remains in place and is linked below.

## Guides

| Guide | Contents |
| --- | --- |
| [File structure](FILE_STRUCTURE.md) | Directories, modules, pages, configuration files, and generated assets |
| [Architecture](ARCHITECTURE.md) | Camera capture, inference, video playback, events, storage, and account flows |
| [Development rules](DEVELOPMENT_RULES.md) | Implementation boundaries and behavior to preserve |
| [Agent guide](AGENT_GUIDE.md) | How a coding agent should inspect, change, verify, and hand over work |
| [Configuration](CONFIGURATION.md) | Local startup, environment precedence, model paths, storage, and deployment files |
| [Testing](TESTING.md) | Focused checks, integration prerequisites, and test side effects |

The root [AGENTS.md](../../AGENTS.md) is the discoverable entry point for coding agents.

- [MySQL/Aiven migration](../MYSQL_AIVEN_MIGRATION.md): configuration, schema, legacy import, deployment and verification.
- [Supabase Storage](../SUPABASE_STORAGE.md): private file storage, Render configuration and verification.
- [Private alert evidence](../PRIVATE_ALERT_EVIDENCE.md): account ownership, seven-day retention, local/Docker migration and rollout.

## Existing references

- [Real-time detection and playback API](../REALTIME_DETECTION.md)
- [Backend local configuration](../../backend/LOCAL_DEVELOPMENT.md)
- [Frontend README](../../frontend/README.md)
- [API contract](../API_CONTRACT.md): a historical reference; verify access-control claims against the current routes.

## Reading order

For a new contributor, read file structure, architecture, and configuration. For a change, read the relevant development rules and testing instructions. Update these guides alongside changes to module boundaries, API behavior, startup configuration, or verification commands.
