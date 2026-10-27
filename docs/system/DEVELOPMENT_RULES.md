# Development rules

These are maintenance guidelines for changes to this repository. For current runtime behavior, see [architecture](ARCHITECTURE.md); for commands and limitations, see [testing](TESTING.md).

## Scope and source control

- Inspect the branch and working tree before editing. Preserve unrelated staged and unstaged changes.
- Use focused edits instead of unrelated rewrites. Do not change runtime configuration or replace model weights merely to make a check pass.
- Keep `.env.local`, credentials, runtime databases, uploaded videos and snapshots out of commits. Existing tracked model changes require intentional review; ignore patterns do not untrack files.
- Commit, push, merge and deploy when the task authorizes those actions. Do not automatically include unrelated edits in a commit.

## Detection and concurrency

- Put class normalization, confidence filtering and confirmation policy in `detection_rules.py` so videos and cameras agree.
- Keep one model owner through `InferenceScheduler`; do not call the shared YOLO model concurrently from capture/video threads.
- Preserve camera priority and latest-frame processing. Avoid unbounded frame or event queues.
- Preserve camera activation, generation checks and device lease release. Disabled cameras must not publish new frames or process stale-session results.
- Keep periodic snapshot frequency, detection-log throttling, alarm-event cooldown and notification-channel cooldown conceptually separate.
- Maintain independent fire/smoke confirmation and event cooldowns. Count a class once per frame, regardless of how many boxes it has.
- Never add generated confidence values or fake fire/smoke boxes to real camera views. Keep explicitly mocked data within the mock service and existing mock flags.
- Do not route uploaded-video findings through camera alarm notifications. Preserve cancellation, retained-source ownership and cleanup when changing video jobs.

## API and frontend

- Update the backend payload, TypeScript interface, consumers and relevant docs together when a contract changes.
- Keep timestamps, frames and boxes synchronized. Do not show a stale detection badge as fresh data.
- Clean up WebSockets, timers, uploads and event handlers on disconnect/unmount. Ignore responses from superseded jobs.
- Use existing URL configuration instead of hard-coded deployment addresses in new components.
- Follow the language provider and English/Vietnamese locale structure for new translated UI text. Do not broaden this task into a translation rewrite of unrelated existing strings.
- Distinguish UI role gates from server-side authorization. Do not silently weaken or claim nonexistent backend enforcement.

## Configuration and storage

- Preserve environment priority: process environment, backend `.env.local`, shared `.env`, then defaults.
- Resolve relative model paths against the backend directory. Do not put machine-specific absolute paths in committed defaults.
- Exclude private local overrides from Git and Docker build contexts. Keep templates free of secrets.
- Use the storage abstraction for model retrieval/snapshots rather than adding storage-provider logic to UI or inference rules.

## Verification and documentation

Use checks appropriate to the change; reversible documentation/cosmetic edits do not need new implementation-mirroring tests. Behavior changes should have focused regression coverage when it will catch real failures. Report checks actually run and their results. Do not equate synthetic tests or blank-frame FPS with smoke/fire detection accuracy.

Keep architecture, environment templates and feature documentation synchronized when affected. Document known differences between existing prose and actual implementation instead of repeating stale claims.
