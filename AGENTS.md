# AGENTS.md

## Scope
This file applies to the whole repository.

## Project Facts
- Repository: `work-manager`
- Frontend is a static bundle served from `index.html`, `app.js`, and `styles.css`
- Backend entrypoint is `server/index.js`
- Production deployment currently runs on ECS
- Public traffic enters through Nginx on port `80`
- Nginx proxies:
  - `/` -> frontend service on `127.0.0.1:8080`
  - `/api/` -> backend service on `127.0.0.1:8787`
- Frontend API base must use `/api`, not a hard-coded public IP or port

## Source Of Truth
- Git is the only source of truth for code
- Local development happens in this repository first
- Server is a deployment target, not a source repository
- Do not treat server-side hotfixes as final state
- If a server-side emergency change is ever made, sync it back to local immediately and commit it to Git

## Required Workflow
1. Make changes locally in `C:\Users\RF\Code\work-manager`
2. Run the narrowest relevant validation before claiming success
3. Commit locally
4. Push to `origin/main`
5. Deploy from Git to the server
6. Verify the deployed result on the server and through the public endpoint

## Deployment Rules
- Do not manually edit application source files on the server as a normal workflow
- Do not develop inside the ECS deployment directory
- Keep server-only configuration out of Git, especially `.env`
- Production deployment directory is expected to be a clean Git checkout
- If deployment state and Git differ, reconcile back into Git before doing more feature work

## Validation
- For frontend or shared changes, at minimum run:
  - `npm run build`
- For deployment changes, verify at minimum:
  - `curl http://127.0.0.1/api/health` through Nginx when applicable
  - `curl http://127.0.0.1:8787/api/health` for direct backend health when debugging
  - public access to `/`
  - public access to `/api/health`
- Do not say something is deployed, fixed, or synced without command evidence

## Guardrails
- Prefer the smallest correct change
- Reuse existing project structure and patterns
- Do not commit secrets, tokens, passwords, or server `.env` files
- Do not change Nginx, PM2, or deployment layout casually; treat infra changes as explicit work
- Do not leave the repository in a dirty state after finishing unless the user asked for partial work

## Current Deployment Notes
- Local repo path: `C:\Users\RF\Code\work-manager`
- ECS clean deploy path: `/opt/work-manager-clean`
- Legacy server path `/opt/work-manager` is not the preferred active source
- Nginx config should keep `/api/` behind reverse proxy so the browser uses same-origin `/api`
