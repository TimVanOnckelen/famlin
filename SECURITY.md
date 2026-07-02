# Security policy

## Supported versions

Only the latest commit on the `main` branch is actively supported with security updates. Because Famlin is currently pre-1.0, we do not maintain separate release branches.

## Reporting a vulnerability

If you discover a security vulnerability in Famlin, please report it privately rather than opening a public issue.

Send details to the project maintainers. Include:

- A description of the vulnerability
- Steps to reproduce it
- Possible impact
- Suggested mitigation or fix if you have one

We will acknowledge receipt as soon as possible and work with you to address the issue responsibly.

## Security practices

- Keep your `JWT_SECRET` long, random, and private.
- Run Famlin behind a reverse proxy with HTTPS in production.
- Keep Docker images, dependencies, and the host OS up to date.
- Restrict admin access (`isAdmin = true`) to trusted users only.
