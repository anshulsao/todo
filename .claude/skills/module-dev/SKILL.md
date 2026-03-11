---
name: module-dev
description: Write, validate, and test Facets IaC modules for the raptor2 CLI.
---

## Identity

You write Terraform modules that plug into the Facets v3 platform via `raptor2`.
A module is 5 files that must agree with each other. This guide teaches the contract.

**Updating skills:** If raptor2 was upgraded, run `raptor2 init --refresh-skills`
to get the latest skill content on disk.

## Mental Model

A Facets module is a standard Terraform module with a fixed interface:

```
                    raptor2 codegen
                         |
  facets.yaml            |          variables.tf
  (user-facing           v          (Terraform
   JSON Schema)     +----------+     type contract)
        |           | instance |------------|
        |           | inputs   |            |
        v           | env      |            v
  User writes       +----------+     Terraform reads
  spec YAML                          var.instance.spec
```

raptor2 reads facets.yaml to show users the schema, then injects their values
into `var.instance.spec` during codegen. Terraform validates `var.instance`
against the type constraint in variables.tf at plan time.

**The two schemas must agree.** facets.yaml is the user-facing schema (what fields
exist, their types, defaults, UI hints). variables.tf is the Terraform-facing
contract (what Terraform actually accepts). If facets.yaml defines a field that
variables.tf doesn't declare, `terraform plan` fails with "argument not expected".

## The 5 Files

```
modules/{intent}/{flavor}/{version}/
+-- facets.yaml      <-- Module definition: spec schema, inputs, outputs, sample
+-- variables.tf     <-- Terraform interface: var.instance, var.inputs, var.environment
+-- main.tf          <-- Terraform resources (your actual infrastructure code)
+-- outputs.tf       <-- Output structure: local.output_attributes + local.output_interfaces
+-- locals.tf        <-- (optional) Complex local computations
```

## Step-by-Step: Writing a Module

### Step 0: Discover What Exists

Before writing anything, understand the ecosystem:

```bash
# What output types can I consume as inputs?
raptor2 search types
raptor2 search types --attribute host          # find types with a specific field

# Full schema of a type (attributes, types, descriptions, providers)
raptor2 describe type @facets/aws_cloud_account
raptor2 describe type @facets/kubernetes-details

# How does an existing similar module work?
raptor2 describe module s3/standard/1.0 -o yaml
raptor2 describe module postgres/aws-rds/1.0 -o yaml

# List all available modules:
raptor2 get modules
```

### Step 0.5: Scaffold with `raptor2 create module` (Recommended)

Instead of writing all 4 files by hand, scaffold them:

```bash
raptor2 create module INTENT/FLAVOR/VERSION \
  --cloud CLOUD \
  --description "Module description" \
  --input NAME=TYPE[:providers=P1,P2] \
  --output NAME=TYPE
```

**Example:**
```bash
raptor2 create module s3/custom/1.0 \
  --cloud aws \
  --description "Custom S3 bucket with encryption" \
  --input cloud_account=@facets/aws_cloud_account:providers=aws \
  --output default=@facets/s3
```

This creates `modules/s3/custom/1.0/` with all 4 files:

| File | What the scaffold provides |
|------|---------------------------|
| `facets.yaml` | Intent, flavor, version, clouds, inputs, outputs, empty spec skeleton, sample |
| `variables.tf` | `var.instance` (spec=any), `var.instance_name`, `var.environment`, `var.inputs` with one key per input |
| `main.tf` | `locals { spec = var.instance.spec }` + TODO comment for resources |
| `outputs.tf` | **Pre-filled** attribute/interface keys from the type registry with `null # TODO` placeholders |

**The big win is outputs.tf** — the scaffold looks up each `--output` type in the registry
and pre-fills all attribute keys and interface blocks. You just replace `null` with real values.

**Flag reference:**

| Flag | Format | Example |
|------|--------|---------|
| `--cloud` | Cloud name(s) | `--cloud aws` or `--cloud aws --cloud gcp` |
| `--description` | Free text | `--description "Custom S3 bucket"` |
| `--input` | `NAME=TYPE[:providers=P1,P2]` | `--input cloud_account=@facets/aws_cloud_account:providers=aws` |
| `--output` | `NAME=TYPE` | `--output default=@facets/s3` |

After scaffolding, proceed to Steps 1-4 below to fill in the details.

### Step 1: facets.yaml

This is the module's identity + user-facing configuration schema.

```yaml
intent: s3                              # What kind of resource (noun)
flavor: standard                        # Implementation variant
version: '1.0'                          # Always quoted string
description: AWS S3 bucket with encryption and versioning
intentDetails:
  type: Storage                         # Category for catalog UI
  description: AWS S3 Object Storage
  displayName: S3 Bucket
  iconUrl: https://...                  # SVG icon URL
clouds:
- aws                                   # Which clouds this works on

inputs:                                 # Dependencies on other modules
  cloud_account:
    type: '@facets/aws_cloud_account'   # Must match a real output type
    displayName: Cloud Account
    description: AWS credentials for deployment
    optional: false
    providers:                          # Terraform providers this input supplies
    - aws

outputs:                                # What this module exposes
  default:
    type: '@facets/s3'                  # Must match a registered type schema
    title: S3 Bucket Details

spec:                                   # JSON Schema for user configuration
  type: object
  properties:
    encryption_enabled:
      type: boolean
      default: true                     # Defaults are injected by raptor2
    bucket_policy_json:
      type: string
      x-ui-yaml-editor: true           # UI hint: show YAML editor
  required: []                          # Only list truly required fields
```

**Key rules:**
- `inputs.*.type` must be a real type from `raptor2 search types`
- `outputs.*.type` must be a real type from `raptor2 search types` (or create one with `raptor2 create type`)
- `spec` is JSON Schema — standard `type`, `properties`, `default`, `enum`, `required`, `minimum`, `maximum`, `pattern`
- `version` must be a quoted string (`'1.0'` not `1.0`)

### Step 2: variables.tf

This is the Terraform-side contract. It declares what raptor2's codegen will pass in.

**CRITICAL RULES:**

1. **`var.instance.spec` should use `any` type** — this avoids type constraint mismatches
   with facets.yaml. Use `try()` in main.tf to safely access fields.

2. **`var.inputs` must declare each input** from facets.yaml. Use `any` for each input
   to avoid structural mismatches with source modules.

3. **Always include all 4 variables:** `instance`, `instance_name`, `environment`, `inputs`.

```hcl
variable "instance" {
  description = "Facets instance object containing spec and metadata"
  type = object({
    kind    = string
    flavor  = string
    version = string
    metadata = object({
      name = string
    })
    spec = any                          # <-- ALWAYS use 'any' for spec
  })
}

variable "instance_name" {
  description = "Name of the resource instance"
  type        = string
}

variable "environment" {
  description = "Environment details"
  type = object({
    name        = string
    unique_name = string
    cloud_tags  = map(string)
  })
}

variable "inputs" {
  description = "Input dependencies from other modules"
  type = object({
    cloud_account = any                 # <-- 'any' avoids shape mismatch
  })
}
```

**Why `spec = any`?**
facets.yaml defines the USER-FACING schema (what's valid to configure).
variables.tf defines the TERRAFORM CONTRACT (what the code accepts).
These are different concerns. If you use a strict `object({...})` type for spec,
any field in facets.yaml that isn't in the type constraint causes a terraform crash.
The `any` approach lets facets.yaml be the single source of truth for the schema,
and your Terraform code uses `try()` to safely access fields.

**When to use strict types instead of `any`:**
Only for `var.inputs` when you want Terraform to validate the input shape at plan time
and you're confident the source module's output structure won't change. Even then,
make nested fields `optional(...)` generously.

### Step 3: main.tf

Standard Terraform resources. Access user config via `var.instance.spec` with `try()`:

```hcl
locals {
  spec = var.instance.spec

  # ALWAYS use try() for optional fields with sensible defaults
  encryption_enabled = try(local.spec.encryption_enabled, true)
  versioning_enabled = try(local.spec.versioning_enabled, false)
  force_destroy      = try(local.spec.force_destroy, false)
  custom_tags        = try(local.spec.tags, {})

  all_tags = merge(var.environment.cloud_tags, local.custom_tags, {
    Name          = var.instance_name
    resource_type = var.instance.kind
  })
}

resource "aws_s3_bucket" "main" {
  bucket        = var.instance_name
  force_destroy = local.force_destroy
  tags          = local.all_tags
}
```

**Accessing inputs:**
```hcl
# Input attributes (what the source module exposes)
locals {
  cloud_account = var.inputs.cloud_account
  aws_role_arn  = try(local.cloud_account.attributes.aws_iam_role, "")
}
```

**Pattern: `try()` with defaults matches facets.yaml defaults.**
If facets.yaml says `default: true`, your Terraform should say `try(local.spec.field, true)`.
This way the behavior is identical whether raptor2 injects the default or not.

### Step 4: outputs.tf

Outputs follow a rigid structure. They must match the output type schema.

```hcl
locals {
  # Keys here must match the @facets/s3 type schema attributes
  output_attributes = {
    bucket_name = aws_s3_bucket.main.id
    bucket_arn  = aws_s3_bucket.main.arn
    region      = aws_s3_bucket.main.region
  }

  # Interface keys must match the type schema interfaces
  output_interfaces = {}
}

# Output name must match facets.yaml outputs key ("default")
output "default" {
  value = {
    attributes = local.output_attributes
    interfaces = local.output_interfaces
  }
}
```

**Check what attributes/interfaces the type expects:**
```bash
raptor2 describe type @facets/s3
# Shows: bucket_name (string), bucket_arn (string), region (string), ...
```

Every attribute in the type schema should appear in `output_attributes`.
Missing attributes = WARNING during `validate-module`.
Extra attributes = WARNING (not error, but keep it clean).

### Step 5: Validate and Seal

```bash
# From the directory containing your modules/ folder:
raptor2 validate-module KIND/FLAVOR/VERSION

# Example:
raptor2 validate-module s3/standard/1.0

# Validate all modules in the repo:
raptor2 validate-all
```

This type-checks outputs against the schema registry and writes a `.seal` file.
The seal is required before `raptor2 apply environment` will accept the module.

### Step 6: Test Your Module

```bash
# 0. Scaffold the module (generates all 4 files with pre-filled outputs)
raptor2 create module YOUR_INTENT/YOUR_FLAVOR/YOUR_VERSION \
  --cloud aws --description "..." \
  --input cloud_account=@facets/aws_cloud_account:providers=aws \
  --output default=@facets/YOUR_TYPE

# 1. Register your local modules directory
raptor2 set module-source --name local --type local --path ./modules

# 2. Verify module is discovered
raptor2 get modules | grep YOUR_INTENT

# 3. Validate and seal
raptor2 validate-module YOUR_INTENT/YOUR_FLAVOR/YOUR_VERSION

# 4. Create a resource from it
raptor2 apply resource YOUR_INTENT/YOUR_FLAVOR/YOUR_VERSION \
  -p PROJECT -n test \
  --input cloud_account=cloud_account/default \
  --set spec.field=value

# 5. Generate and inspect the Terraform
raptor2 generate environment -p PROJECT -e ENV
# Read .tfgen/{project}/{env}/main.tf to verify codegen output

# 6. Plan (catches type mismatches, missing fields, etc.)
raptor2 apply environment -p PROJECT -e ENV --plan

# 7. Target just your module for faster iteration:
raptor2 apply environment -p PROJECT -e ENV --plan --target YOUR_INTENT/test
# Shows targeted changes + warns about any out-of-target side effects
```

### Step 7: Contribute to Upstream

When your module is ready, contribute it to the official modules repo via PR:

```bash
# Preview what will happen (no PR created):
raptor2 contribute module KIND/FLAVOR/VERSION --dry-run

# Create a PR with type changes + impact analysis:
raptor2 contribute module KIND/FLAVOR/VERSION
```

This command:
1. Validates your local module
2. Clones the upstream git module source
3. Copies the module, rewriting `@org/` type refs to `@facets/`
4. Copies changed type schemas to upstream `outputs/`
5. Runs impact analysis on affected upstream modules
6. Creates a branch, commits, pushes, and opens a GitHub PR

## x-ui-* Annotations (UI Hints)

These are Facets-only annotations in facets.yaml. **Terraform knows nothing about them.**
They control raptor2 validation and the Facets UI.

| Annotation | Effect |
|------------|--------|
| `x-ui-visible-if: {field: spec.type, values: [cronjob]}` | Field only shown/validated when condition met |
| `x-ui-overrides-only: true` | Field must be set per-environment, not in blueprint |
| `x-ui-override-disable: true` | Field locked at blueprint level, cannot override |
| `x-ui-required-if: {field: spec.X, values: [Y]}` | Conditionally required |
| `x-ui-yaml-editor: true` | Show YAML editor in UI |
| `x-ui-skip: true` | Internally managed, warn if user sets it |
| `x-ui-order: [field1, field2]` | Display order in UI |
| `x-ui-placeholder: "example"` | Placeholder text in UI |

**IMPORTANT:** `x-ui-visible-if` controls validation but does NOT affect Terraform.
If facets.yaml has a conditional field (like `cronjob` visible only when `type=cronjob`),
the field is still part of the schema. If `ApplyDefaults` injects it, Terraform sees it.
Keep your `var.instance.spec = any` to avoid issues.

## Output Type Schemas

Output types define the contract between modules. A module producing `@facets/s3`
must output the attributes defined in the `@facets/s3` schema.

**Using existing types:**
```bash
raptor2 search types                    # list all
raptor2 search types --attribute host   # find types with a specific attribute
raptor2 describe type @facets/s3        # full schema with types
```

**Creating a custom type (for new module kinds):**
```bash
raptor2 create type my-cache \
  --attribute endpoint:string \
  --attribute port:string \
  --attribute connection_string:string
# Creates types/my-cache/outputs.yaml with @org/my-cache
```

**Type tiers:**
- `@facets/*` — Official types from module sources (immutable)
- `@org/*` — Organization types in `{repo}/types/` (user-defined)
- `@local/*` — Inline types defined in facets.yaml outputs (module-scoped)

## Cross-Resource References (Expressions)

When testing modules that consume values from other modules, use expression
references in spec fields rather than hardcoding:

```bash
# Discover all available expression paths:
raptor2 describe expressions -p PROJECT

# Use in resource spec:
raptor2 apply resource service/k8s/1.0 -p PROJECT -n api \
  --set 'spec.env.DB_HOST=${module.postgres_main_db.default.attributes.host}'
```

Expressions use native Terraform module references (`${module.KIND_NAME.OUTPUT.PATH}`).
raptor2 codegen passes them through as-is — no transformation needed.

## Environment Object Reference

Every module receives `var.environment` with these fields:

| Field | Type | Value | Example |
|-------|------|-------|---------|
| `name` | string | Environment name | `"staging"` |
| `unique_name` | string | `{project}-{env}` | `"ecommerce-staging"` |
| `namespace` | string | Same as unique_name | `"ecommerce-staging"` |
| `cloud_tags` | map(string) | Merged tags (standard + custom) | See below |
| `global_variables` | object | Reserved for future use | `{}` |

### Standard Cloud Tags (always present)

| Tag | Value | Purpose |
|-----|-------|---------|
| `project` | Project name | Identify owning project |
| `environment` | Environment name | Identify deployment env |
| `managed_by` | `"facets"` | Distinguish Facets-managed resources |

Users can add custom tags in `env.yaml`:
```yaml
cloud_tags:
  team: platform
  cost_center: infra
```

Custom tags merge with standard tags. Standard tags cannot be overridden.

### Naming Conventions

**Use `var.environment.unique_name` as the naming anchor.**
Pattern: `{instance_name}-{unique_name}` or `{unique_name}-{instance_name}`

Common patterns:
- `substr("${var.instance_name}-${var.environment.unique_name}", 0, 63)` — length limit
- `"${var.environment.unique_name}-${var.instance_name}"` — prefix with env
- `md5("${var.environment.unique_name}-${var.instance_name}")` — hash for brevity

### Tagging Best Practice

Always merge environment tags with any resource-specific tags:
```hcl
all_tags = merge(var.environment.cloud_tags, {
  Name          = var.instance_name
  resource_type = var.instance.kind
})
```

## Gotchas

1. **facets.yaml spec <> variables.tf spec type**
   facets.yaml is the user schema. variables.tf is the Terraform contract.
   Use `spec = any` in variables.tf to avoid conflicts.

2. **`try()` is your friend**
   Always `try(local.spec.field, default)` for optional fields.
   Never assume a spec field exists.

3. **Output names must match facets.yaml**
   If facets.yaml says `outputs: { default: ... }`, outputs.tf must have `output "default" {}`.

4. **Output attribute keys must match the type schema**
   `raptor2 describe type @facets/s3` shows what keys the schema expects.

5. **No `required_providers` blocks**
   Providers are passed in via inputs. Don't declare `required_providers` in your module.

6. **Seal before deploy**
   `raptor2 validate-module` writes `.seal`. Without it, `apply environment` refuses.

7. **`depends_on` only when no attribute reference exists**
   If resource B reads an attribute from resource A, Terraform infers the dependency.
   Only add explicit `depends_on` when there's a side-effect dependency with no data flow.

8. **Targeted deploys for fast iteration**
   Use `--target KIND/NAME` during development to plan/apply just your module.
   raptor2 will warn if your changes affect resources outside the target.

## Reference: Complete Minimal Module

A minimal S3 module with one input, one output, and a few spec fields:

**facets.yaml** — identity + schema:
```yaml
intent: s3
flavor: standard
version: '1.0'
description: AWS S3 bucket
clouds: [aws]
inputs:
  cloud_account:
    type: '@facets/aws_cloud_account'
    displayName: Cloud Account
    optional: false
    providers: [aws]
outputs:
  default:
    type: '@facets/s3'
    title: S3 Bucket Details
spec:
  type: object
  properties:
    versioning_enabled:
      type: boolean
      default: false
  required: []
```

**variables.tf** — Terraform interface:
```hcl
variable "instance" {
  type = object({
    kind = string, flavor = string, version = string
    metadata = object({ name = string })
    spec = any
  })
}
variable "instance_name" { type = string }
variable "environment" {
  type = object({ name = string, unique_name = string, cloud_tags = map(string) })
}
variable "inputs" {
  type = object({ cloud_account = any })
}
```

**main.tf** — resources:
```hcl
locals {
  spec       = var.instance.spec
  versioning = try(local.spec.versioning_enabled, false)
}
resource "aws_s3_bucket" "main" {
  bucket = var.instance_name
  tags   = var.environment.cloud_tags
}
resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id
  versioning_configuration { status = local.versioning ? "Enabled" : "Suspended" }
}
```

**outputs.tf** — expose attributes matching @facets/s3:
```hcl
locals {
  output_attributes = {
    bucket_name = aws_s3_bucket.main.id
    bucket_arn  = aws_s3_bucket.main.arn
    region      = aws_s3_bucket.main.region
  }
  output_interfaces = {}
}
output "default" {
  value = { attributes = local.output_attributes, interfaces = local.output_interfaces }
}
```
