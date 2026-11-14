# Retrain AI Model

This branch updates the fire/smoke detection checkpoint for evaluation and prepares the next retraining iteration. No new training run has been completed on this branch.

## Current checkpoint

- Runtime path: `backend/best.pt`.
- Output classes: `fire` and `smoke`.
- SHA256: `d2b0be214f45fa01d2044b960c3cb4da4bf65c06a89cf0a1967b0d40e8db4b98`.
- The checkpoint is an externally pretrained evaluation baseline, not a newly trained project artifact. Provenance: https://huggingface.co/seawsurf/fire_yolo .

The existing Ultralytics detector interface and class-specific confirmation rules remain in use. Restart the backend to load a changed checkpoint.

## Published training data

The checkpoint configuration points to `FASDD_CV-3/data.yaml`, a FASDD_CV-derived dataset. Its published dataset card describes approximately 95,000 images: 12,500 fire-only, 23,300 smoke-only, 20,100 with both, and 39,100 background images. These are rounded dataset totals, not verified counts of images used for training.

FASDD includes varied lighting, near/far views, indoor/outdoor scenes and confusing non-fire/non-smoke examples. The specific training split manifest for this checkpoint has not been verified; the original paper's split must not be assumed to be the checkpoint's split. No evidence has been verified that this checkpoint was additionally trained on D-Fire, Pyro-SDIS or the project's v2 dataset.

Published training settings: YOLO26n initialization, configured 100 epochs, image size 640, batch 256, patience 30, 12 workers. A configured epoch limit is not proof that every epoch completed.

Sources: [dataset card](https://huggingface.co/datasets/seawsurf/fire_smoke_dataset_fasdd_cv), [training arguments](https://huggingface.co/seawsurf/fire_yolo/blob/main/args.yaml), and [FASDD paper](https://doi.org/10.1080/10095020.2024.2347922).

## Retraining and acceptance plan

1. Preserve the v2 checkpoint and dataset manifests as the baseline.
2. Audit labels and remap classes by name; split by camera/video/event and check exact and near duplicates across splits.
3. Keep the saved clean and degraded test sets fixed. Use only training data for fine-tuning and validation data for threshold/model selection.
4. Include representative indoor/outdoor fire, small flames, faint smoke and hard negatives such as glare, lamps, steam and orange objects.
5. Record source revisions, checkpoint hashes, package versions, training configuration and resulting checkpoint lineage.
6. Compare Precision, Recall, AP50 and AP50-95 separately for fire/smoke under a common validation configuration. Record missed events, false alarms per hour and notification latency on camera/video footage.
7. Promote a newly trained checkpoint only after evaluating held-out data and verifying camera capture, video playback and notifications. Keep a rollback copy.

## Manual testing

Use the existing Analyze Video upload flow. Test fire, small-fire, smoke and non-fire challenge clips separately. No source videos or private runtime files are included in this PR.

See [manual testing instructions](SEAWSURF_MANUAL_TEST.md) for the local evaluation setup and rollback procedure.

## Validation status

The candidate was loaded through the project's FireDetector, exposing both required classes. Sampled frames from three test videos decoded and inferred successfully. The focused real-time detection suite passed 16 tests during preparation. A full live camera-to-bot acceptance run and a new training run remain outstanding.
