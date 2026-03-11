# Infrastructure Project

Describe what you need in plain English. Say `/facets3` to get started.

## Prerequisites
- Cloud CLI authenticated (`aws configure` / `gcloud auth` / `az login`)
- Terraform installed (>= 1.5)
- raptor2 in PATH (download from https://github.com/Facets-cloud/raptor2-releases)

## Secrets
Run `raptor2 init-keys` to generate encryption keys before storing secrets.
Back up `.facets/identity.key` — if lost, encrypted secrets are unrecoverable.
