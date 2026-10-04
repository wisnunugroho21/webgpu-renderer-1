# Phase 44 default policy

The latest user instruction enables Phase 44 on supported adapters during cold renderer construction. Unsupported adapters remain disabled and allocate no cluster resources. The feature can be explicitly disabled; recovery preserves that choice. Existing batch eligibility and fallback rules are unchanged.

All 232 unit tests across 60 files, formatting, strict production build, complete GPU validation gate and the benchmark matrix pass. The matrix asserts `defaultEnabled === supported` and verifies exact enabled/disabled images, zero false-invisible clusters, deformation/transparency/object-indirect fallbacks, CPU LOD, shadows, disabled culling and unchanged warm resource-creation counts.

For the 200,000-triangle, 782-cluster fixture:

| Workload              | Disabled completion median | Enabled completion median | Rejected clusters |
| --------------------- | -------------------------: | ------------------------: | ----------------: |
| Mostly outside camera |                     2.0 ms |                    2.0 ms |               575 |
| Fully visible         |                     1.8 ms |                    2.3 ms |                 0 |

Mostly-outside color GPU median decreases from 1.31 to 1.11 ms; fully-visible color median increases from 1.18 to 1.31 ms. These are diagnostic Chrome measurements, including explicit queue-completion waits outside runtime rendering. They are workload-dependent; enabling the feature does not guarantee a frame-time improvement. Raw evidence and environment metadata: `results/phase44-default.json`.

Supported startup adds the existing fixed cluster storage: 4,456,528 GPU buffer bytes and a 3,145,728-byte CPU staging array, plus metadata and pipeline/bind-group objects. Resources remain retained while disabled and release on renderer disposal. No resource construction or synchronous GPU wait is introduced into steady-state rendering.
