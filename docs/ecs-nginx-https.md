# ECS Nginx + Domain + HTTPS Deployment

This document assumes:

- The repository is deployed on the ECS host under `/var/www/work-manager/current`
- The API runs on `127.0.0.1:8787`
- Nginx serves the frontend and reverse proxies `/api/*`
- The database is Alibaba Cloud RDS over the VPC private endpoint

## 1. DNS

Create DNS records for the domain you want to expose:

- `A @` -> `47.96.74.166`
- `A www` -> `47.96.74.166`

Wait until DNS resolves publicly before requesting the certificate.

## 2. Prepare the ECS host

Install Nginx and Certbot:

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

If the image is CentOS / Alibaba Cloud Linux, use the equivalent `yum` or `dnf` packages instead.

Open inbound rules on the ECS security group:

- `80/tcp`
- `443/tcp`
- keep `22/tcp` restricted to trusted source IPs

## 3. Deploy the application files

Recommended layout:

```text
/var/www/work-manager/
  current/
    index.html
    app.js
    styles.css
    server/
    package.json
    package-lock.json
    .env
```

Build locally before upload:

```bash
npm run build
```

On ECS:

```bash
cd /var/www/work-manager/current
npm install --omit=dev
```

## 4. Configure environment variables

Create `.env` from `.env.example` and set production values:

```env
PORT=8787
CORS_ORIGIN=https://your-domain.com
DB_HOST=rm-bp18im9s0s260c50w.mysql.rds.aliyuncs.com
DB_PORT=3306
DB_USER=work_manager_app
DB_PASSWORD=replace_with_real_password
DB_NAME=work_manager
DB_CONNECTION_LIMIT=10
```

`CORS_ORIGIN` should be the final HTTPS origin, not the ECS IP.

## 5. Run the API with pm2

Upload `deploy/pm2/ecosystem.config.cjs` to the server with the repo, then run:

```bash
cd /var/www/work-manager/current
npx pm2 start deploy/pm2/ecosystem.config.cjs
npx pm2 save
npx pm2 startup
```

Verify:

```bash
curl http://127.0.0.1:8787/api/health
```

## 6. Configure Nginx

Copy `deploy/nginx/work-manager.conf` to `/etc/nginx/sites-available/work-manager.conf` and replace:

- `your-domain.com`
- certificate paths after Certbot issues the certificate

Enable the site:

```bash
sudo mkdir -p /var/www/certbot
sudo cp deploy/nginx/work-manager.conf /etc/nginx/sites-available/work-manager.conf
sudo ln -sf /etc/nginx/sites-available/work-manager.conf /etc/nginx/sites-enabled/work-manager.conf
sudo nginx -t
sudo systemctl reload nginx
```

At this point HTTP should redirect once the domain is pointed correctly.

## 7. Issue the HTTPS certificate

Run Certbot after DNS is effective and Nginx serves the domain on port 80:

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

Then validate renewal:

```bash
sudo certbot renew --dry-run
```

## 8. Final verification

Verify these paths from the public internet:

- `https://your-domain.com/`
- `https://your-domain.com/api/health`

Expected API response:

```json
{
  "ok": true,
  "service": "work-manager-api"
}
```

## 9. Recommended next hardening

- Restrict the Node.js process to localhost only and expose only Nginx publicly
- Remove direct public access to the API port in the ECS security group
- Back up the RDS schema and credentials outside the instance
- Add deployment steps for rolling updates under `/var/www/work-manager/releases`
- Add application logs and Nginx log rotation monitoring
