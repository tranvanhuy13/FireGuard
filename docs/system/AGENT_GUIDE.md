# Coding-agent workflow

The discoverable entry point is [AGENTS.md](../../AGENTS.md). This guide supports work in the current chat; it does not configure a running agent service or require multiple agents.

## Inspect

1. Understand the requested result and any constraints already given by the user.
2. Check `git status --short --branch`, then inspect relevant source and any applicable repository instructions.
3. Use `rg`/`rg --files` with virtual environments, dependencies and generated output excluded. Read the [file map](FILE_STRUCTURE.md) to locate the correct layer.
4. Check current behavior before assuming prior chat descriptions or older docs still match the checked-out branch.

## Implement

Work in the existing checkout unless isolation is needed or requested. Preserve user edits and existing configuration. For common requests:

| Task | Start with |
| --- | --- |
| Detection accuracy/classes | `backend/detection.py`, model metadata, representative labeled samples |
| Confirmation or confidence | `backend/detection_rules.py`, AI settings API/page |
| Camera lifecycle or performance | `backend/camera_manager.py`, `backend/inference_scheduler.py` |
| Analyze Video behavior | `backend/video_analyzer.py`, video routes, `VideoAnalysisModal.tsx` |
| Fake camera overlays | `CameraGrid.tsx`, explicit mock flags/service |
| Local model path | Startup environment loading, `.env.local.example`, backend Docker exclusions |
| Account behavior | `backend/auth/`, `backend/users/`, frontend auth context/client |
| Storage/notification behavior | `backend/storage.py`, `backend/notification.py`, deployment configuration |

Keep thread-owned state, lock ordering and generation checks intact. Importing `main.py` starts services, so use isolated imports/mocks for checks that should not open hardware or touch runtime data.

## Verify

Choose checks from [TESTING.md](TESTING.md). Prefer focused offline regressions for camera and video logic. Use a disposable configured environment for integration tests that alter records or start services. Validate Markdown links and referenced paths for documentation-only work.

Describe unresolved failures precisely. Distinguish unit/API-handler checks, real model inference, browser checks and physical-camera verification. Use measured FPS as a machine-specific observation rather than a promised rate.

## Git and handover

If a commit is requested, inspect the complete staged diff and include only task-related files. Resolve merges by preserving intended behavior from both branches, then check the integrated result; removing conflict markers alone is insufficient. Avoid force pushes unless explicitly required and authorized.

Summarize the change, verification and remaining limitations. Include the commit hash or remote result only when those actions were performed. Do not claim a deployment or physical-camera test that did not occur.

## Maintaining these instructions

Update this collection when source locations, behavior or standard commands change. Keep observed implementation details separate from recommended practices. Do not add unnecessary permission gates, delegation requirements or unrelated project policy.
