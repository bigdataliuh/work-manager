# Alibaba Cloud Deployment Plan

## Target architecture

- Frontend: OSS static website hosting, optionally fronted by CDN
- API: ECS instance running the Node.js service in `server/index.js`
- Database: ApsaraDB RDS for MySQL
- Region: `cn-hangzhou`

## Resources to create

1. ECS instance in `cn-hangzhou`
2. RDS MySQL instance in `cn-hangzhou`
3. OSS bucket for the static frontend bundle
4. CDN domain for the frontend when a custom domain is ready

## Database setup

1. Create database `work_manager`
2. Create an application user with read/write permissions on that database
3. Run `server/schema.sql`

## API environment variables

Copy `.env.example` to `.env` on the ECS server and set:

- `PORT`
- `CORS_ORIGIN`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

## Local development

1. Install dependencies: `npm install`
2. Start the API: `npm run start`
3. In a second terminal, serve the frontend: `npm run start:web`

The frontend expects the API at `/api` by default. For local split-domain testing, set `window.WORK_MANAGER_API_BASE` before loading `app.js`.

## OSS frontend deployment

1. Run `npm run build`
2. Upload `index.html`, `app.js`, and `styles.css` to the OSS bucket
3. Enable static website hosting on the bucket
4. Configure CDN or a custom domain when ready

## ECS API deployment

1. Install Node.js 20+
2. Upload the repository or clone it on ECS
3. Create `.env`
4. Run `npm install --omit=dev`
5. Start the API with `npm run start`
6. Put the API behind Nginx and expose `443`

## Notes

- This version is intentionally single-user and uses one canonical server-side state document
- `localStorage` remains a local cache and backup source, not the source of truth
- GitHub Gist should be treated as legacy backup only, not active sync storage
