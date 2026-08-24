# nf-core/actions — build plan

Centralised GitHub Actions for nf-core pipelines. Pipelines keep thin stub
workflows that call the reusable workflows here, pinned to the major tag
(`@v1`). All logic, and all security fixes, live here and reach every pipeline
when the tag moves.

## Principles

1. **One place.** A value in a pipeline repo needs a 141-repo campaign to
   change. A value here needs a tag move. Keep values here.
2. **Config precedence.** Every setting resolves in this order: workflow input →
   `.nf-core.yml` in the calling repo → built-in default. A fallback to the
   built-in default logs a warning to the Actions log.
3. **Version gating.** `.nf-core.yml` records the template version. Central code
   reads it and can change behaviour for old pipelines instead of breaking them.
4. **Trust boundary.** Jobs that run pull request code get no secrets and
   read-only scopes. Jobs that hold credentials never run pull request code.
   Data crosses between them as a validated artifact.
5. **TypeScript for logic.** Shell steps handle process invocation only.
   Parsing, validation and decisions live in bundled TypeScript actions: faster,
   testable, and free of shell injection.
6. **Third parties pinned by SHA.** Pipelines pin nf-core by tag; nf-core pins
   external actions by commit SHA. The trust chain ends at code nf-core reviews.

## Repository layout

```
actions/<name>/          Composite or TypeScript action, with its own action.yml
src/actions/<name>/      TypeScript source for that action
src/lib/                 Shared library code (config, github, exec helpers)
__tests__/               Unit tests, mirroring src/
.github/workflows/       Reusable workflows called by pipelines, plus this repo's own CI
```

## Stages

Each stage is specified, implemented and tested on its own, then reviewed for
simplification and correctness before the next stage starts.

| #   | Stage                                       | Delivers                                                                                                                                                                         | Status |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 0   | Foundation                                  | Monorepo build (multi-entry bundling), lint, type-check, test, this repo's own CI, release workflow with a moving major tag, governance files. All template boilerplate removed. | Done   |
| 1   | `read-config` action                        | Resolves settings by input → `.nf-core.yml` → default, with warnings. Exposes the template version for gating. Every later stage depends on this.                                | Done   |
| 2   | `get-shards` action                         | Replaces the vendored bash action. Runs an nf-test dry run, parses the count, emits the shard matrix. Fixes the shell injection in the current version.                          | Done   |
| 3   | `nf-test` action                            | Runs one nf-test shard and parses TAP into a job summary. Tool setup stays in the stage-4 workflow.                                                                              | Done   |
| 4   | `nf-test.yml` workflow                      | Reusable workflow: shard discovery, test matrix, pass confirmation, failure reporting. Covers the ARM and GPU variants through config, not separate files.                       | Done   |
| 5   | `fix-linting.yml` workflow                  | Hardened three-job design: gate on commenter, run the fixer unprivileged, validate and push the patch in a separate job. Includes the patch validation action.                   | Done   |
| 6   | `linting.yml` workflow                      | nf-core lint, prettier, editorconfig, plus the Nextflow lint check.                                                                                                              | Done   |
| 7   | `pr-comment.yml` workflow                   | Posts and updates comments from artifacts produced by unprivileged workflows.                                                                                                    | Done   |
| 8   | `template-version-comment.yml` workflow     | Compares the pipeline's template version against the current release and reports it on the pull request.                                                                         | Done   |
| 9   | `branch.yml` + `clean-up.yml` workflows     | Branch protection check for release pull requests; stale issue and pull request handling.                                                                                        | Done   |
| 10  | `download_pipeline.yml` workflow            | Tests `nf-core pipelines download` against the pipeline, including the stub run.                                                                                                 | Done   |
| 11  | `awstest.yml` + `awsfulltest.yml` workflows | Launches small and full tests on Seqera Platform. Adds the reviewer permission check the security review requires.                                                               | Done   |
| 12  | `release-announcements.yml` workflow        | Posts release announcements to the configured channels.                                                                                                                          | Done   |

## Out of scope for now

Cloud test workflows specific to single pipelines (`cloud_tests_full.yml`,
`cloud_tests_small.yml` in rnaseq) stay in those pipelines. They are still out
of scope now that stage 12 is done, for the same reason as before: the shared
workflows above need more time proven in production first.

**What a future stage needs to cover.** rnaseq's `cloud_tests_small.yml` and
`cloud_tests_full.yml` each launch on AWS, Azure, and GCP, chosen through a
`workflow_dispatch` `platform` input (`all`, `aws`, `azure`, or `gcp`), one job
per provider. Stage 11's `awstest.yml`/`awsfulltest.yml` already cover the AWS
job of each: the same `test`/`test_full` profiles, the same `outdir` and
`workdir` construction from a pipeline name and a commit SHA, and (for the full
test) the same `aligner` parameter matrix. What they do not cover is Azure and
GCP: each provider needs its own compute environment and bucket variables
(`TOWER_CE_AZURE_CPU`/`TOWER_BUCKET_AZURE`/`TOWER_IGENOMES_BASE_AZURE`,
`TOWER_CE_GCP_CPU`/`TOWER_BUCKET_GCP`, mirroring the AWS ones `awstest.yml`
already reads from `vars`), and Azure's launch additionally passes
`igenomes_base`, which AWS's does not. A future stage would extend
`awstest.yml`/`awsfulltest.yml` with a `provider` input (or add sibling
`azuretest.yml`/`gcptest.yml` workflows sharing their jobs' shape), and would
need to decide whether the `platform: all` case becomes a matrix inside one
workflow or three separate calls from the stub — the same "call it more than
once for more than one parameter set" pattern `awsfulltest.yml`'s own `aligner`
matrix already establishes for a single provider.

## Follow-ups

### Depends on another repository or team

- nf-core/tools' `NFCoreYamlConfig` Pydantic model rebuilds `.nf-core.yml` from
  known fields, and does not know about the `ci:` block. A rebuild could
  silently drop it. Needs a pull request against nf-core/tools adding `ci:` as
  an optional, permissive field.
- `.github/actionlint.yaml` ignores one error so the `$/` sibling-action
  references lint clean. actionlint v1.7.12 is its latest release (2026-03-30)
  and predates the `$/` announcement (2026-07-30), so there is nothing newer to
  upgrade to yet. Checked 2026-08-24. Remove the ignore once a release
  recognises `$/`.

### Open decision for the team

- A contributor with write access can open a same-repository pull request that
  reads the Sentieon secrets, for the pipelines whose stub passes them. This
  matches behaviour before the migration and is documented in README.md's
  "Sentieon secret exposure" section. Whether to restrict it further, for
  example by gating on an approval the way `awsfulltest.yml` now does, is open.

### Rollout task

- rnaseq should set `ci.nextflow_lint: true`. It already runs that check today
  from its own `nextflow-lint.yml`, and the setting defaults to `false` so that
  adopting `@v1` cannot hand any other pipeline a new failing check.
