# Todo Summary Email — Design Spec

## Goal

Send a daily plain-text email summarizing all incomplete todos. Runs on a cron schedule via AWS EventBridge + Lambda. Configurable per environment (recipient, sender, schedule).

## Architecture

```
EventBridge (cron) --> Lambda (Node.js 20) --> PostgreSQL (RDS)
                                           --> SES (send email)
```

The Lambda runs inside the same VPC as the ECS backend to reach RDS.

## Lambda Function

**Location:** `backend/lambdas/todo-summary/`

**Files:**
- `index.js` — handler
- `package.json` — dependency: `pg`

**Logic:**
1. Connect to RDS using environment variables (same credentials as backend)
2. Query: `SELECT title, created_at FROM todos WHERE completed = false ORDER BY created_at DESC`
3. Format plain-text email:
   - Subject: `"Todo Summary: X incomplete items"`
   - Body: numbered list of todo titles with creation dates
4. Send via SES to configured recipient
5. Close DB connection and return

**Runtime config (environment variables):**
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL` — database connection
- `RECIPIENT_EMAIL` — who receives the summary
- `SENDER_EMAIL` — the "from" address

**Resource limits:**
- Memory: 128 MB
- Timeout: 30 seconds

## Infrastructure (Facets Resources)

### Lambda: `projects/todo/resources/lambda/todo-summary.yaml`
- Runtime: Node.js 20
- Handler: `index.handler`
- Memory: 128 MB, Timeout: 30s
- VPC: same subnets and security group as the ECS backend
- Environment variables: DB credentials (from secret store), RECIPIENT_EMAIL, SENDER_EMAIL

### EventBridge Rule: `projects/todo/resources/eventbridge_rule/todo-summary-schedule.yaml`
- Schedule expression: configurable per environment (e.g., `cron(0 8 * * ? *)` for 8 AM UTC daily)
- Target: the todo-summary Lambda function

### SES Email Identity: `projects/todo/resources/ses_email_identity/sender.yaml`
- Verified email identity for the sender address
- Note: recipient must also be verified if SES is in sandbox mode

### Security
- Lambda execution role needs: `ses:SendEmail`, VPC networking permissions, CloudWatch Logs
- Lambda security group must allow outbound to RDS on port 5432
- Facets Lambda module handles IAM role creation

## CI/CD

### Workflow: `.github/workflows/deploy-todo-summary-lambda.yml`

**Trigger:** Push to `main` with changes in `backend/lambdas/todo-summary/**`

**Steps:**
1. Checkout code
2. Install Node.js dependencies (`npm ci` in Lambda directory)
3. Package Lambda (zip code + node_modules)
4. Install raptor2
5. Update Lambda resource via raptor2
6. Deploy via `aws lambda update-function-code`

Follows the same pattern as existing backend and frontend deploy workflows.

## Per-Environment Configuration

| Variable | Example (dev) | Example (prod) |
|----------|---------------|-----------------|
| RECIPIENT_EMAIL | dev-team@example.com | rohit@example.com |
| SENDER_EMAIL | todos-dev@example.com | todos@example.com |
| Schedule | `cron(0 8 * * ? *)` | `cron(0 8 * * ? *)` |

Set via Facets resource YAMLs with environment overrides.

## Changes Summary

**New files:**
- `backend/lambdas/todo-summary/index.js`
- `backend/lambdas/todo-summary/package.json`
- `projects/todo/resources/lambda/todo-summary.yaml`
- `projects/todo/resources/eventbridge_rule/todo-summary-schedule.yaml`
- `projects/todo/resources/ses_email_identity/sender.yaml`
- `.github/workflows/deploy-todo-summary-lambda.yml`

**Existing file changes:** None. Entirely additive.
