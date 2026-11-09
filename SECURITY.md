# Security policy — local Docker fork

## Reporting

Use GitHub's private vulnerability reporting in the repository Security tab if available. If it is unavailable, contact the maintainer through their GitHub profile before sharing technical details. Do not publish an exploit involving API credentials or private data in a public issue. Always use dummy credentials and a minimal reproduction.

Include the commit/version, affected tool, browser and OS, reproduction steps, whether generated content is required, and the impact observed. Never attach an API key, password, session cookie, database or backup.

## Security model

This fork's Docker edition adds single-account authentication, server-side sessions, request Origin/CSRF validation, encrypted OpenRouter storage and a fixed-target API relay. The browser cannot read back the persisted OpenRouter key. Other providers retain their original credential mechanisms.

The application binds to loopback by default. Each installation has one administrator; it does not isolate multiple users or tenants. It is not ready to be exposed as a public shared service merely by changing a port binding. Remote deployments require their own HTTPS, proxy, identity, storage and isolation review.

The encryption key is in a separate Docker volume from SQLite. Someone controlling Docker or both volumes can decrypt the credential. Protect backups of both volumes. Local password recovery requires access to Docker and invalidates existing sessions; it has no public HTTP endpoint.

Treat generated or imported code as untrusted. Prompt Gallery HTML previews use sandboxed contexts. Notebook Lab and Algorithm Visualizer still execute JavaScript with the page's privileges; such code can act through the authenticated session even though it cannot directly read the vault secret. Use trusted code in those modules.

Cloudflare analytics is removed from locally served application pages. The local file API constrains paths to the data root and excludes secrets; it is not an arbitrary system filesystem API. The upstream private CLI-agent bridge is not included.

The historical static edition described in README.upstream.md has a different storage and security model. Serving this fork with a generic static server bypasses the new authentication and server vault; use the documented Docker entry point.

## Maintenance

Run a current reviewed commit, back up both volumes before updates, and keep Docker and dependencies maintained. The project does not claim a complete security certification. See README.md and docs/OPERATIONS.md for operation and recovery commands.
