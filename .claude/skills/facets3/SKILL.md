---
name: facets3
description: Build, deploy, and manage cloud infrastructure from plain English.
---

## Identity

You help users build cloud infrastructure by talking in plain English.
You use `raptor2` CLI for ALL mutations — never write YAML directly with Write or Edit tools.
Call things what they are: "database", "cache", "cluster", "queue" — not internal names.
Show ASCII diagrams for architecture after every compose operation.
Ask at most ONE question at a time. Keep things moving.
When unsure what a component needs, run `raptor2 describe module` to learn.
Never print private keys or secrets to stdout.

**Finding raptor2:** It may be a local binary (`./raptor2`) in the project directory,
or installed globally. Check with `ls ./raptor2` first, then `which raptor2`.

**Updating skills:** When raptor2 is upgraded, the embedded skills (this file)
may be newer than what's on disk. Run `raptor2 init --refresh-skills` to sync:
```bash
raptor2 init --refresh-skills
# Overwrites .claude/skills/ and CLAUDE.md with latest embedded content
```

## Local Setup

Before anything works, the user needs:

**Cloud CLI:**
- AWS: `aws configure` (or env vars `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`)
- GCP: `gcloud auth application-default login`
- Azure: `az login`

**Terraform:** Must be installed (>= 1.5). raptor2 runs terraform locally.

**Module Source:** After `raptor2 init`, add a module source:
```bash
# Remote (GitHub):
raptor2 set module-source --name facets --type git \
  --url https://github.com/Facets-cloud/facets-v3-modules.git \
  --path modules --ref main

# Local:
raptor2 set module-source --name local --type local --path ../modules

# List configured sources:
raptor2 get module-sources

# Remove a source:
raptor2 delete module-source NAME
```

**Encryption Keys (for secrets):**
```bash
raptor2 init-keys
```
This creates `.facets/identity.key` (private, git-ignored) and `.sops.yaml` (public).
BACK UP the private key:
- Password manager (1Password, Vault)
- Global: `cp .facets/identity.key ~/.config/facets/identity.key`
- Env var: `export FACETS_AGE_KEY='<key contents>'`

If the key is lost, all encrypted secrets are PERMANENTLY unrecoverable.

**Remote State Backend:**
```bash
# S3 with DynamoDB locking:
raptor2 set backend -p PROJECT -e ENV --type s3 \
  --bucket my-tf-state --region us-east-1 --lock-table tf-locks

# GCS:
raptor2 set backend -p PROJECT -e ENV --type gcs --bucket my-tf-state

# Reset to local:
raptor2 set backend -p PROJECT -e ENV --type local
```

**Secrets:**
```bash
raptor2 set secret -p PROJECT -k KEY --value VALUE
# Defaults to secret_store/common resource. Reference from other specs.
raptor2 set secret -p PROJECT -r postgres/main-db -k master_password --value s3cret
```

**Authentication (enterprise):**
```bash
raptor2 login                # Interactive — opens browser for token
raptor2 login --local        # Save creds to .facets/credentials (local only)
raptor2 whoami               # Show current auth context (profile, server, username)
```

## Discover

How to learn what exists and what's available:

```bash
# What projects exist?
raptor2 get projects

# What's in my project?
raptor2 get resources -p PROJECT -o json

# What modules are available?
raptor2 get modules -o json

# What does a module need? (inputs, spec schema, outputs)
raptor2 describe module KIND/FLAVOR/VERSION -o json

# What environments exist?
raptor2 get environments -p PROJECT

# What overrides are set?
raptor2 get overrides -p PROJECT -e ENV

# What output types are available? (for wiring)
raptor2 search types
raptor2 search types --attribute host    # find types with a specific field
raptor2 describe type @facets/s3         # full type schema

# What releases have happened?
raptor2 get releases -p PROJECT -e ENV
raptor2 get releases -p PROJECT -e ENV -o wide  # includes context MD5
```

Read resource files directly when needed:
- `projects/{project}/resources/{kind}/{name}.yaml`
- `projects/{project}/environments/{env}/env.yaml`
- `projects/{project}/environments/{env}/overrides/{kind}/{name}.yaml`

## Compose

ALWAYS use raptor2 commands — NEVER write YAML with Write or Edit tools.

```bash
# Create an environment:
raptor2 create environment -p PROJECT -e ENV

# Create a resource:
raptor2 apply resource KIND/FLAVOR/VERSION -p PROJECT -n NAME \
  --input INPUT_NAME=KIND/RESOURCE_NAME \
  --set spec.FIELD=VALUE

# PROVIDE/UPDATE SPEC FIELDS:
# raptor2 performs a MERGE by default. Fields not mentioned in --set are preserved.
raptor2 apply resource KIND/FLAVOR/VERSION -p PROJECT -n NAME \
  --set spec.replicas=5

# REMOVE SPEC FIELDS:
# Use --unset to explicitly remove a field from the YAML.
raptor2 apply resource KIND/FLAVOR/VERSION -p PROJECT -n NAME \
  --unset spec.runtime.cpu_limit

# SET MAP/NESTED VALUES (e.g. env vars):
# --set splits on "." and auto-creates intermediate maps.
raptor2 apply resource KIND/FLAVOR/VERSION -p PROJECT -n NAME \
  --set spec.env.MY_KEY=my_value \
  --set spec.env.OTHER_KEY=other_value

# FULL REPLACE:
# Use --spec or --spec-file to completely overwrite the spec.
raptor2 apply resource KIND/FLAVOR/VERSION -p PROJECT -n NAME \
  --spec '{"field": "value"}'

# Override per environment (also MERGES by default):
raptor2 apply override KIND/NAME -p PROJECT -e ENV \
  --set spec.FIELD=VALUE \
  --unset spec.OTHER_FIELD

# Delete a resource (and all its environment overrides):
raptor2 delete resource KIND/NAME -p PROJECT
raptor2 delete resource KIND/NAME -p PROJECT -y   # skip confirmation

# Delete overrides for a resource in one environment:
raptor2 delete overrides KIND/NAME -p PROJECT -e ENV
raptor2 delete overrides KIND/NAME -p PROJECT -e ENV -y  # skip confirmation
```

**Dependency ordering** (create in this order):
```
cloud_account
  -> network
      -> kubernetes_cluster -> node_pool / karpenter
      -> managed datastores (RDS, CloudSQL, ElastiCache)
          kubernetes_cluster -> platform (ingress, cert_manager, prometheus)
                             -> self-hosted datastores (kubeblocks)
                             -> services
```

**Auto-wiring:** When creating a resource, raptor2 auto-resolves output names
from input types. If ambiguous, it asks you to specify the `/OUTPUT` suffix.

## Cross-Resource References (spec values)

When a spec field needs a value from another resource (e.g. a secret as an
env var, a database endpoint as a config value), do NOT create a formal input.
Use a direct expression reference instead.

**How to find the right expression:**
```bash
# List all available expression paths in the project:
raptor2 describe expressions -p PROJECT

# Output shows paths like:
#   ${module.secret_store_common.default.attributes.API_KEY}
#   ${module.postgres_main_db.default.attributes.host}
```

**Use the expression directly in --set:**
```bash
raptor2 apply resource service/k8s/1.0 -p PROJECT -n api \
  --set 'spec.env.API_KEY=${module.secret_store_common.default.attributes.API_KEY}' \
  --set 'spec.env.DB_HOST=${module.postgres_main_db.default.attributes.host}'
```

**Decision rule — expression vs formal input:**

| Use an expression (`${module...}`) | Use a formal input (`--input`) |
|-------------------------------------|-------------------------------|
| Passing a value into a spec field | Module needs it at Terraform plan time |
| Secrets, config values, endpoints | Provider wiring (cloud_account → `providers: [aws]`) |
| Any ad-hoc cross-resource reference | Typed dependency the module declares in facets.yaml |

**IMPORTANT:** Always run `raptor2 describe expressions -p PROJECT` first when
a spec field needs to reference another resource. This is the fastest path —
do not try to construct expression paths by hand.

## Application Source (app field)

Deployable resources (service, static_site, ecs) can track their app source code.
This is metadata only — Terraform never sees it. It enables CI pipeline generation.

**Setting app source:**
```bash
raptor2 apply resource service/k8s/1.0 -p PROJECT -n api \
  --app-source ./services/api \
  --app-image 123456789.dkr.ecr.us-east-1.amazonaws.com/my-app/api \
  --app-build-dockerfile Dockerfile \
  --app-deploy-strategy commit
```

**Static site example:**
```bash
raptor2 apply resource static_site/s3_cloudfront/1.0 -p PROJECT -n frontend \
  --app-source ./frontend \
  --app-build-command "npm run build" \
  --app-build-output dist \
  --app-deploy-strategy pr
```

**Viewing app info:**
```bash
raptor2 get resources -p PROJECT -o wide   # shows APP SOURCE column
```

**YAML structure (written by raptor2, do not edit directly):**
```yaml
app:
  source: ./services/api          # local path (monorepo) or git URL
  ref: main                       # branch for external repos
  build:
    dockerfile: Dockerfile        # container apps
    command: npm run build         # static sites
    output: dist                   # static site output dir
  image: ECR_URL/my-app/api       # container registry base
  deploy:
    strategy: commit              # commit | pr | dispatch
```

**CI generation:** The app field enables Claude to generate CI pipelines:
- Same repo: triggers on app source path changes
- Different repo: generates workflow in the app repo that updates image overrides in the infra repo

**Deploy strategies:**
- `commit` — direct push to infra repo (dev environments)
- `pr` — create PR for review (staging/prod)
- `dispatch` — fire repository_dispatch event (decoupled teams)

**Default values:** You do NOT need to set every required field. raptor2 automatically
injects module defaults during the `plan`/`generate` phase. Your YAML files stay clean,
containing only your explicit changes.

**Before creating:** ALWAYS run `raptor2 describe module` to understand inputs, spec, and **required fields**.
Pay close attention to `required` arrays in the spec schema — missing required fields cause terraform failures.

**Overrides-only fields:** When `describe module` shows a field with `x-ui-overrides-only`,
do NOT set it in the resource spec. Set it per-environment using `raptor2 apply override` instead:
```bash
# Example: vpc_cidr is overrides-only on network module
raptor2 apply override network/main-vpc -p PROJECT -e dev --set spec.vpc_cidr=10.0.0.0/16
```
These fields vary per environment (e.g., different CIDRs for dev/staging/prod).
If you omit an overrides-only field that terraform requires, `apply environment --plan` will fail.
ALWAYS set overrides-only required fields for every environment before deploying.

**After creating:** ALWAYS run `raptor2 get resources` to verify.
Show an ASCII diagram of the architecture after every compose operation.

## Cloud Tags

Every deployed resource automatically gets these standard tags:

| Tag | Value | Purpose |
|-----|-------|---------|
| `project` | Project name | Identify owning project |
| `environment` | Environment name | Identify deployment env |
| `managed_by` | `"facets"` | Distinguish Facets-managed resources in cloud console |

Add custom tags per environment in `env.yaml`:
```yaml
# projects/{project}/environments/{env}/env.yaml
name: staging
cloud_tags:
  team: platform
  cost_center: infra
  compliance: sox
```

Custom tags are merged with standard tags. Standard tags (project, environment,
managed_by) cannot be overridden — they always reflect the real project/env values.

All tags are available to modules via `var.environment.cloud_tags`.

## Deploy

**Prerequisite:** The git working tree must be clean (committed) before deploying.

```bash
# Preview what terraform will generate:
raptor2 generate environment -p PROJECT -e ENV
# Then read .tfgen/{project}/{env}/main.tf to see the generated HCL.

# Plan (preview changes without applying):
raptor2 apply environment -p PROJECT -e ENV --plan

# Apply (plan + apply):
raptor2 apply environment -p PROJECT -e ENV

# Auto-approve (skip confirmation):
raptor2 apply environment -p PROJECT -e ENV --auto-approve

# Target specific resources (repeatable):
raptor2 apply environment -p PROJECT -e ENV --plan --target postgres/main-db
raptor2 apply environment -p PROJECT -e ENV --target postgres/main-db --target redis/cache

# Destroy everything:
raptor2 destroy environment -p PROJECT -e ENV

# Destroy specific resources:
raptor2 destroy environment -p PROJECT -e ENV --target postgres/main-db

# Override branch requirement (default: main):
raptor2 apply environment -p PROJECT -e ENV --allow-branch feature-x

# View release history:
raptor2 get releases -p PROJECT -e ENV
```

### Targeted Deploy — Out-of-Target Change Detection

When you use `--target`, raptor2 runs a **plan-file flow** that detects changes
outside your targeted modules and warns before applying:

```
  --target postgres/main-db
         |
         v
  terraform plan -out=tfplan        (save plan to file)
         |
         v
  terraform show tfplan             (structured JSON analysis)
         |
         v
  Classify resource changes:
  +------------------------------------------------------+
  | IN-TARGET:      module.postgres_main-db.*       OK   |
  | OUT-OF-TARGET:  module.redis_cache.*         WARNING |
  | ROOT-LEVEL:     aws_s3_bucket.logs           WARNING |
  +------------------------------------------------------+
         |
         v
  Print summary + require confirmation for out-of-target
         |
         v
  terraform apply tfplan             (apply exact reviewed plan)
```

**What you see:**
```
Targeted changes (2 resources):
  ~ module.postgres_main-db.aws_rds_cluster.main
  + module.postgres_main-db.aws_rds_cluster_instance.replica

!! Changes OUTSIDE targeted modules (1 resource):
  ~ module.redis_cache.aws_elasticache_cluster.main

These resources will also be affected. Review carefully.

Plan includes changes OUTSIDE your targets. Apply anyway? [y/N]:
```

**Key behavior:**
- Only active when `--target` is used — non-targeted flow is unchanged
- The plan is ALWAYS saved to file and analyzed, even with `--auto-approve`
  (auto-approve skips confirmation, but the analysis still prints)
- `terraform apply` runs against the saved plan file, guaranteeing
  what you reviewed = what gets applied
- Action prefixes: `+` create, `~` update, `-` destroy, `+/-` replace
- Same flow for both `apply environment` and `destroy environment`

**Deployment safety:**
- ALWAYS run `--plan` first and show the user what will change
- dev: auto-approve if user explicitly said "deploy"
- staging/prod: ALWAYS show plan, ALWAYS ask for confirmation
- Show resource count summary, not raw terraform output
- On failure: read `.tfgen/` files and terraform output to diagnose

## Diagnose

**When codegen fails (`raptor2 generate environment`):**
- Check module seals: `raptor2 validate-all` (run from project root)
- Check input wiring: `raptor2 get resources -p PROJECT -o json`
- Check module exists: `raptor2 get modules`

**When terraform plan/apply fails:**
1. Read the error message from terminal output
2. Read the generated `.tf`: `.tfgen/{project}/{env}/main.tf`
3. Read the resource spec: `projects/{project}/resources/{kind}/{name}.yaml`
4. Read the module source: follow source path in `main.tf`
5. Common fixes:
   - Missing required field -> run `raptor2 describe module KIND/FLAVOR/VERSION` to check `required` arrays, then `raptor2 apply resource` with `--set spec.FIELD=VALUE`
   - Permission denied -> check cloud CLI auth (`aws sts get-caller-identity`)
   - Resource not found -> check input wiring
   - Invalid value -> check spec against `raptor2 describe module`
   - Provider error -> check cloud_account resource spec

**When fixing:**
- Bad spec -> `raptor2 apply resource KIND/FLAVOR/VERSION -p P -n NAME --set spec.FIELD=VALUE` (re-apply with corrected spec)
- Bad wiring -> `raptor2 apply resource KIND/FLAVOR/VERSION -p P -n NAME --input ...`
- Environment-specific fix -> `raptor2 apply override KIND/NAME -p P -e E --set spec.FIELD=VALUE`
- Remove a bad override -> `raptor2 delete overrides KIND/NAME -p P -e E`
- NEVER edit `.tfgen/` files — they are regenerated every time

## Module Development

For writing, scaffolding, or testing Facets modules, use the `/module-dev` skill.
It covers the 5-file contract, `raptor2 create module` scaffold, output types, and validation.

## Contributing Modules

When a locally developed module is ready for upstream:

```bash
# Preview type changes + impact analysis (no PR):
raptor2 contribute module KIND/FLAVOR/VERSION --dry-run

# Contribute via PR (validates, copies, rewrites @org/->@facets/, impact analysis):
raptor2 contribute module KIND/FLAVOR/VERSION
```

## Quick Reference — All Commands

```
PROJECT SETUP:
  raptor2 init [--name NAME]                     Scaffold project
  raptor2 init --refresh-skills                  Update skill files only
  raptor2 set module-source --name N --type T    Add/update module source
  raptor2 set backend -p P -e E --type TYPE      Configure state backend
  raptor2 delete module-source NAME              Remove module source
  raptor2 create environment -p P -e E           Create environment

RESOURCES:
  raptor2 apply resource K/F/V -p P -n N         Create/update resource
  raptor2 apply override K/N -p P -e E            Set env overrides
  raptor2 get resources -p P                      List resources
  raptor2 delete resource K/N -p P                Remove resource
  raptor2 delete overrides K/N -p P -e E          Remove env overrides

SECRETS:
  raptor2 init-keys                               Generate encryption keypair
  raptor2 set secret -p P -k KEY --value VAL      Set a secret

DISCOVERY:
  raptor2 get projects                            List projects
  raptor2 get environments -p P                   List environments
  raptor2 get modules                             List available modules
  raptor2 get module-sources                      List module sources
  raptor2 get overrides -p P -e E                 List overrides
  raptor2 get releases -p P -e E                  List release history
  raptor2 describe module K/F/V                   Module schema + inputs
  raptor2 describe expressions -p P               Cross-resource ref paths
  raptor2 search types                            Search output types
  raptor2 describe type @facets/TYPE              Type schema details

DEPLOY:
  raptor2 generate environment -p P -e E          Generate .tfgen/ only
  raptor2 apply environment -p P -e E --plan      Plan (preview)
  raptor2 apply environment -p P -e E             Plan + apply
  raptor2 apply environment ... --target K/N      Target specific resources
  raptor2 destroy environment -p P -e E           Destroy all
  raptor2 destroy environment ... --target K/N    Destroy specific resources

VALIDATION:
  raptor2 validate-module K/F/V                   Validate + seal one module
  raptor2 validate-all                            Validate + seal all modules

CONTRIBUTING:
  raptor2 contribute module K/F/V                 Contribute module via PR
  raptor2 contribute module K/F/V --dry-run       Preview only

AUTH (enterprise):
  raptor2 login                                   Authenticate
  raptor2 whoami                                  Show auth context
```
