# FireGuard agent instructions

This file applies to the repository. Start with [the documentation index](docs/system/README.md), then read only the guides relevant to the task:

- [File structure](docs/system/FILE_STRUCTURE.md)
- [Runtime architecture](docs/system/ARCHITECTURE.md)
- [Development rules](docs/system/DEVELOPMENT_RULES.md)
- [Agent workflow](docs/system/AGENT_GUIDE.md)
- [Configuration and local setup](docs/system/CONFIGURATION.md)
- [Verification commands and test side effects](docs/system/TESTING.md)

Preserve unrelated working-tree changes. Prefer the current checkout; create or switch branches only when the task requires it. Keep changes focused and follow the user's requested scope. Commit, push, and deploy only when requested or authorized by the ongoing task.

Do not include secrets, runtime databases, uploaded videos, or generated snapshots in changes. Preserve tracked model weights unless the task explicitly changes the model. Keep local overrides in `backend/.env.local`, which must remain ignored by Git and excluded from Docker builds.

Detection rules belong in `backend/app/detection/rules.py`; model serialization belongs in `backend/app/detection/scheduler.py`. Preserve camera priority, cancellation, generation checks, and the separation between uploaded-video results and camera notifications. Do not add simulated detection boxes or confidence values to real camera views.

Use the focused offline tests for camera/detection work. Full backend pytest runs have database and startup side effects; inspect the testing guide first. For frontend code, run TypeScript and relevant lint checks. Documentation-only changes need link/path checks rather than application startup.

Keep documentation consistent with changed behavior. Report what changed, what was checked, and anything not verified. Treat code as the source of current behavior when older documents disagree; identify the mismatch instead of assuming the older description is implemented.
