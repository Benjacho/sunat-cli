# Security policy

## Reporting a vulnerability

Do not open a public issue for vulnerabilities, leaked credentials, taxpayer data, certificates, tokens, audit logs, or tax documents.

Use GitHub's private vulnerability reporting for this repository. Include the affected version, reproduction steps using synthetic data, and the expected impact. Do not attach real SUNAT records or credentials.

## Supported versions

Security fixes target the latest published version of `@crafter/sunat-cli`. Upgrade to the latest release before reporting an issue that may already be fixed.

## Local data

The CLI stores configuration, short-lived browser sessions, selected short-lived API session tokens, queues, and minimized audit records under `~/.sunat` with owner-only permissions. Other OAuth tokens remain in process memory. Treat exported command output, downloaded SIRE files, constancias, and explicit `--show-details` output as sensitive tax data.

On first run after upgrading, the CLI removes sensitive fields from legacy configuration and audit files. It also permanently removes legacy automatic screenshots under `~/.sunat/audit/screenshots`. Back up that directory before upgrading only if you have a legal retention requirement, and protect the backup as taxpayer data.
