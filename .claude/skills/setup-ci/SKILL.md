---
name: setup-ci
description: Set up CI/CD pipelines for Facets infrastructure deployments.
---

## Identity

You help users set up CI/CD pipelines for Facets infrastructure and apps.
You GENERATE actual workflow files — do not just describe what to do.
Use the Write tool to create files in `.github/workflows/`.

Before asking questions, read the project state:
```bash
raptor2 get resources -p PROJECT -o json
```
Pre-fill answers from `app` fields (source, image, build, deploy.strategy).
Only ask questions for information that can't be inferred.
Ask ONE question at a time. After each answer, narrow the remaining questions.
When done, show a summary table of what was generated + a secrets checklist.
Never hardcode credentials in workflow files.

## Decision Tree

```
User says /setup-ci
        |
        v
  Read project state (raptor2 get resources -p P -o json)
  Extract app fields from all resources
        |
        v
  Q1: Which CI platform?
  +---> GitHub Actions -----> (primary path)
  +---> GitLab CI ----------> (secondary, different templates)
  +---> Other --------------> (manual checklist)
        |
        v
  Q2: What to automate? (auto-select from app fields if possible)
  +---> Infra deploy only ---------> INFRA PATH
  +---> App image updates only ----> APP PATH
  +---> Both (full pipeline) ------> INFRA + APP PATH
        |                                   |
  INFRA PATH                          APP PATH
  Q3: Review gate?                    Q4: Same or different repo?
  +-> Env protection (GitHub env)     +-> Same repo (monorepo)
  +-> PR-based (CODEOWNERS)           +-> Different repo
                                           Q5: Deploy strategy?
                                           +-> commit / pr / dispatch
        |                                   |
        v                                   v
  Generate infra workflow(s)          Generate app workflow(s)
        +-------------------------------+
        v
  Show summary + security checklist
```

## Reusable Install Snippets

### raptor2 — Always Latest, Never Into Repo Dir

```yaml
    - name: Install raptor2
      run: |
        DOWNLOAD_URL=$(curl -fsSL \
          https://api.github.com/repos/Facets-cloud/raptor2-releases/releases/latest \
          | jq -r '.assets[] | select(.name == "raptor2-linux-amd64") | .browser_download_url')
        curl -fsSL "$DOWNLOAD_URL" -o /usr/local/bin/raptor2
        chmod +x /usr/local/bin/raptor2
        raptor2 --version
```

Assets are bare binaries: `raptor2-linux-amd64`, `raptor2-darwin-arm64`, etc.
Install to `/usr/local/bin/` — NEVER into the repo directory (causes dirty working tree).

### Terraform — Direct Install, NEVER hashicorp/setup-terraform

```yaml
    - name: Install Terraform
      env:
        TF_VERSION: "1.9.8"
      run: |
        curl -fsSL "https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_linux_amd64.zip" \
          -o /tmp/terraform.zip
        unzip -o /tmp/terraform.zip -d /usr/local/bin/
        terraform version
```

**WARNING:** Do NOT use `hashicorp/setup-terraform`. It wraps terraform stdout with
a script that breaks raptor2's output parsing. Always install terraform directly.

## State Backend — REQUIRED Before CI

```
  CI Runner (ephemeral)
  +---------------------------+
  | terraform.tfstate         |  <-- lives here
  +---------------------------+
              |  runner terminates
              v
         STATE IS GONE --> resources orphaned
```

You MUST configure a remote backend before first CI deploy:
```bash
raptor2 set backend -p PROJECT -e ENV --type s3 \
  --bucket my-tf-state --region us-east-1 --lock-table tf-locks
```
Commit the updated `env.yaml` to the repo.

If the user hasn't set a backend, STOP and help them configure one before
generating any CI workflows. A local backend in CI = guaranteed state loss.

## Cloud Credentials

**Prefer OIDC over static keys.** OIDC = short-lived, auto-rotating, scoped
to specific repo/branch/environment. Static keys = permanent access if leaked.

### AWS OIDC (Recommended)

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::ACCOUNT_ID::role/facets-ci-role
      aws-region: us-east-1
```

Tighten trust policy per environment:
```json
"Condition": {
  "StringEquals": {
    "token.actions.githubusercontent.com:sub": "repo:ORG/REPO:environment:production"
  }
}
```

One-time setup:
1. Create OIDC identity provider in IAM (provider URL: `token.actions.githubusercontent.com`)
2. Create IAM role with trust policy scoped to repo + environment
3. Attach permissions policy (e.g. `AdministratorAccess` for infra, or scoped)

### GCP Workload Identity Federation

```yaml
steps:
  - uses: google-github-actions/auth@v2
    with:
      workload_identity_provider: projects/NUM/locations/global/workloadIdentityPools/github-pool/providers/github-provider
      service_account: facets-ci@PROJECT.iam.gserviceaccount.com
```

One-time setup:
1. Create workload identity pool + provider
2. Create service account with required permissions
3. Grant `roles/iam.workloadIdentityUser` on the service account

### Azure OIDC

```yaml
steps:
  - uses: azure/login@v2
    with:
      client-id: APP_CLIENT_ID
      tenant-id: TENANT_ID
      subscription-id: SUB_ID
```

One-time setup:
1. Register app in Azure AD with federated credential
2. Scope the credential to `repo:ORG/REPO:environment:production`
3. Assign required roles (e.g. Contributor on resource group)

### Static Credentials (Fallback Only)

If OIDC is not possible, store credentials as GitHub secrets:
- AWS: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- GCP: `GCP_SA_KEY` (base64 service account JSON)
- Azure: `AZURE_CLIENT_SECRET`

Never echo or log credentials. Never use `set -x` with secrets in env.

## Module Source & Secrets

### Private Module Repos

Fine-grained PAT with `contents:read`, stored as `MODULE_PAT`:
```yaml
    - name: Configure private module access
      run: git config --global url."https://x-access-token:${{ secrets.MODULE_PAT }}@github.com/ORG/".insteadOf "https://github.com/ORG/"
```

### Encryption Key

`FACETS_AGE_KEY` as GitHub secret, passed as env var:
```yaml
    env:
      FACETS_AGE_KEY: ${{ secrets.FACETS_AGE_KEY }}
```
Never echo/log it. Never use `set -x` with secrets in env.

## Branch Handling — --allow-branch

CI runs in detached HEAD. raptor2 enforces branch checks. You must pass:
```yaml
    - run: raptor2 apply environment -p PROJECT -e ENV --allow-branch "${{ github.ref_name }}" --auto-approve
```
For PR plans:
```yaml
    - run: raptor2 apply environment -p PROJECT -e ENV --allow-branch "${{ github.head_ref }}" --plan
```

## Two-Step Infra Deploy — Plan then Review then Apply

### Option A: GitHub Environment Protection (Single Workflow, Two Jobs)

Generate one workflow with plan + gated apply:

```yaml
name: Facets Infra Deploy
on:
  push:
    branches: [main]
    paths:
      - "projects/**"
      - "modules/**"

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # ... install raptor2, terraform, configure creds ...
      - name: Plan
        run: raptor2 apply environment -p PROJECT -e ENV --allow-branch "${{ github.ref_name }}" --plan

  apply:
    needs: plan
    runs-on: ubuntu-latest
    environment: production  # <-- requires approval
    steps:
      - uses: actions/checkout@v4
      # ... install raptor2, terraform, configure creds ...
      - name: Apply
        run: raptor2 apply environment -p PROJECT -e ENV --allow-branch "${{ github.ref_name }}" --auto-approve
```

Setup: Settings > Environments > production > Required reviewers (infra + security team),
prevent self-review, optional wait timer, branch restriction to main.

### Option B: PR-Based Review (Two Workflows)

Generate two workflows + CODEOWNERS:

**facets-infra-plan.yml** — runs on PR:
```yaml
name: Facets Infra Plan
on:
  pull_request:
    paths:
      - "projects/**"
      - "modules/**"

jobs:
  plan:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      # ... install raptor2, terraform, configure creds ...
      - name: Plan
        id: plan
        run: |
          raptor2 apply environment -p PROJECT -e ENV \
            --allow-branch "${{ github.head_ref }}" --plan 2>&1 | tee /tmp/plan.txt
      - name: Comment plan on PR
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const plan = fs.readFileSync('/tmp/plan.txt', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '## Terraform Plan\n```\n' + plan.slice(-60000) + '\n```'
            });
```

**facets-infra-apply.yml** — runs on merge to main:
```yaml
name: Facets Infra Apply
on:
  push:
    branches: [main]
    paths:
      - "projects/**"
      - "modules/**"

jobs:
  apply:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # ... install raptor2, terraform, configure creds ...
      - name: Apply
        run: raptor2 apply environment -p PROJECT -e ENV --allow-branch "${{ github.ref_name }}" --auto-approve
```

**CODEOWNERS** — generated at `.github/CODEOWNERS`:
```
projects/**               @org/infra-team
projects/*/production/**  @org/infra-team @org/security-team
.github/workflows/**      @org/infra-team @org/security-team
```

### Multi-Environment Matrix (Progressive)

For multiple environments, use a progressive rollout:
- dev: auto-apply on merge (no approval gate)
- staging: 1 reviewer required
- production: 2 reviewers + wait timer

## App Image Update Workflows

`raptor2 apply override` is LOCAL only — must git commit+push to persist.
Full pattern: override > git add > git commit `[skip ci]` > git push.

### Infinite Loop Prevention (Belt + Suspenders)

1. Dedicated bot account (`facets-ci-bot`) for CI pushes
2. Actor filter: `if: github.actor != 'facets-ci-bot'`
3. `[skip ci]` in commit message as backup

### Same-Repo App Workflow

```yaml
name: Build and Update Image
on:
  push:
    branches: [main]
    paths:
      - "services/api/**"  # from app.source field

jobs:
  build:
    if: github.actor != 'facets-ci-bot'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build and push image
        run: |
          # Build image, tag with SHA, push to registry
          IMAGE="REGISTRY/IMAGE:${{ github.sha }}"
          docker build -t "$IMAGE" services/api/
          docker push "$IMAGE"
      - name: Update override
        run: |
          raptor2 apply override service/api -p PROJECT -e ENV \
            --set spec.image="$IMAGE"
      - name: Commit and push
        run: |
          git config user.name "facets-ci-bot"
          git config user.email "ci@facets.cloud"
          git add projects/
          git commit -m "ci: update api image to ${{ github.sha }} [skip ci]"
          git push
```

### Cross-Repo App Workflow

When the app repo is separate from the infra repo.

**Strategy: commit** (direct push to infra repo):
```yaml
    - name: Update infra repo
      env:
        GH_TOKEN: ${{ secrets.INFRA_REPO_PAT }}
      run: |
        git clone https://x-access-token:${GH_TOKEN}@github.com/ORG/INFRA_REPO.git /tmp/infra
        cd /tmp/infra
        raptor2 apply override service/api -p PROJECT -e ENV \
          --set spec.image="REGISTRY/IMAGE:${{ github.sha }}"
        git config user.name "facets-ci-bot"
        git config user.email "ci@facets.cloud"
        git add projects/
        git commit -m "ci: update api image to ${{ github.sha }} [skip ci]"
        git push
```

**Strategy: pr** (create PR for review):
```yaml
    - name: Update infra repo via PR
      env:
        GH_TOKEN: ${{ secrets.INFRA_REPO_PAT }}
      run: |
        git clone https://x-access-token:${GH_TOKEN}@github.com/ORG/INFRA_REPO.git /tmp/infra
        cd /tmp/infra
        BRANCH="ci/update-api-${{ github.sha }}"
        git checkout -b "$BRANCH"
        raptor2 apply override service/api -p PROJECT -e ENV \
          --set spec.image="REGISTRY/IMAGE:${{ github.sha }}"
        git config user.name "facets-ci-bot"
        git config user.email "ci@facets.cloud"
        git add projects/
        git commit -m "ci: update api image to ${{ github.sha }}"
        git push -u origin "$BRANCH"
        gh pr create --repo ORG/INFRA_REPO --title "Update api image" \
          --body "Triggered by ${{ github.repository }}@${{ github.sha }}"
```

**Strategy: dispatch** (fire event, infra repo handles it):
```yaml
    - name: Trigger infra update
      env:
        GH_TOKEN: ${{ secrets.INFRA_REPO_PAT }}
      run: |
        gh api repos/ORG/INFRA_REPO/dispatches \
          -f event_type=app-image-update \
          -f 'client_payload={"resource":"service/api","image":"REGISTRY/IMAGE:${{ github.sha }}","project":"PROJECT","environment":"ENV"}'
```

## Token Scoping Matrix

| Scenario | Token | Permissions |
|---|---|---|
| Module source (private) | Fine-grained PAT (`MODULE_PAT`) | `contents:read` on module repo |
| App update (same repo) | `GITHUB_TOKEN` | `contents:write` (default) |
| App update (cross-repo, commit) | Fine-grained PAT (`INFRA_REPO_PAT`) | `contents:write` on infra repo |
| App update (cross-repo, dispatch) | Fine-grained PAT (`INFRA_REPO_PAT`) | `contents:write` + `actions:write` on infra repo |
| App update (cross-repo, pr) | Fine-grained PAT (`INFRA_REPO_PAT`) | `contents:write` + `pull_requests:write` on infra repo |

Always prefer fine-grained PATs over classic tokens (scoped to specific repos,
granular permissions, mandatory expiration).

## Gotchas Quick Reference

| # | Symptom | Fix |
|---|---------|-----|
| 1 | `raptor2: command not found` | Use `Facets-cloud/raptor2-releases` latest API to download |
| 2 | `dirty working tree` in CI | Install raptor2 to `/usr/local/bin`, not repo dir |
| 3 | Plan runs but apply does nothing | Don't use `hashicorp/setup-terraform` — install directly |
| 4 | Can't clone private modules | Set `MODULE_PAT` with `contents:read` scope |
| 5 | State lost after CI run | Configure S3/GCS backend before first deploy |
| 6 | `must be on main branch` | Pass `--allow-branch "${{ github.ref_name }}"` |
| 7 | Image reverts after deploy | Override is local — must git commit+push |
| 8 | CI triggers itself in a loop | Actor filter + `[skip ci]` in commit message |

## Security Checklist

Print this checklist at the end of every `/setup-ci` invocation:

```
SECURITY CHECKLIST
  [ ] Cloud creds use OIDC (not static keys)
  [ ] OIDC trust scoped to specific repo + branch/environment
  [ ] All tokens are fine-grained PATs with expiration
  [ ] Token permissions are minimum required
  [ ] State backend is remote (not local) with locking
  [ ] FACETS_AGE_KEY in GitHub secrets (not in repo)
  [ ] No secrets echoed/logged in workflows
  [ ] Review gate on apply job (env protection or CODEOWNERS)
  [ ] Infinite loop prevention configured
  [ ] Workflow files reviewed via CODEOWNERS
```

## File Naming Convention

All generated workflows use `facets-` prefix:
- `facets-infra-deploy.yml` (env-gate variant)
- `facets-infra-plan.yml` + `facets-infra-apply.yml` (PR variant)
- `facets-app-{name}-build.yml` (per app)
- `facets-app-update.yml` (cross-repo dispatch receiver)

## Verify

After generating workflows, test by creating a branch and pushing.
Check the Actions tab to verify workflows trigger correctly.

Common first-run issues:
- GitHub Actions not enabled on the repository
- Secrets not configured (workflow fails at credential step)
- OIDC provider not created in cloud account
- Branch protection rules blocking the CI bot
