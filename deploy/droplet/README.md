# Droplet deployment — `gitex-demos` (143.110.245.16)

CI builds the images, the droplet pulls them. Nothing is compiled on the
droplet: `next build` needs ~4 GB of RAM and the box has 957 Mi.

| | Where |
|---|---|
| Build | GitHub Actions → GHCR (`.github/workflows/deploy-droplet.yml`) |
| Run | droplet, `/opt/ckp` |
| MongoDB | Atlas (remote) |
| Supabase / Gemini / Drive | external services |

Host budget: **957 Mi RAM**, 25 GB disk, 4 GB swapfile kept only as OOM
insurance. The target is for swap usage to stay at **0 B**.

| Stage | Services | RAM (measured 2026-10-13) |
|---|---|---|
| 1 | web | 64–142 Mi |
| 2 | web + api + worker + redis | ~440 Mi total; host held 241–268 Mi available |

Measured during a full `scrape → extract → rank → generate` run: web 64 Mi,
api 184 Mi, worker 188 Mi peak (cap 450 Mi), redis 4 Mi. Swap sat at ~150 Mi,
no OOM kills, no restarts. **A resize is not required.**

The API container runs its own scheduler on startup (`scheduler: started,
cron: 30 0 * * *`), so the separate `beat` container is probably unnecessary —
verify before enabling the `scheduler` profile.

---

## One-time droplet setup

Already done on this host: Docker, nginx, ufw, journald caps, old LAMP stack
removed. What remains is the stack directory.

```bash
# on the droplet
mkdir -p /opt/ckp && cd /opt/ckp

# copy these four files from the repo (scp from your laptop, or paste)
#   deploy/droplet/docker-compose.yml  -> /opt/ckp/docker-compose.yml
#   deploy/droplet/deploy.sh           -> /opt/ckp/deploy.sh
#   deploy/droplet/env.production.example -> fill in as /opt/ckp/.env.production
#   deploy/droplet/env.api.example        -> fill in as /opt/ckp/.env.api (Stage 2)
chmod +x /opt/ckp/deploy.sh
```

From the laptop, in the repo root:

```bash
scp deploy/droplet/docker-compose.yml deploy/droplet/deploy.sh \
    root@143.110.245.16:/opt/ckp/
ssh root@143.110.245.16 "chmod +x /opt/ckp/deploy.sh"
```

### GHCR credentials

The images are private (they inherit repo visibility), so the droplet needs a
read-only token. GitHub → Settings → Developer settings → Personal access
tokens → **Tokens (classic)** → scope **`read:packages`** only.

```bash
# on the droplet
install -m 600 /dev/null /opt/ckp/.ghcr-env
nano /opt/ckp/.ghcr-env
```

```
GHCR_USER=your-github-username
GHCR_TOKEN=ghp_xxxxxxxxxxxx
```

### Environment files

```bash
install -m 600 /dev/null /opt/ckp/.env.production
nano /opt/ckp/.env.production        # use env.production.example as the guide
```

Two traps worth repeating:

- **No quotes around values.** Docker's `env_file` is not a shell; quotes become
  part of the value.
- **`DRIVE_SERVICE_ACCOUNT_KEY_JSON` must be one line.** Compact it:
  ```bash
  jq -c . /opt/ckp/drive-sa.json > /opt/ckp/drive-sa.min.json
  printf 'DRIVE_SERVICE_ACCOUNT_KEY_JSON=%s\n' "$(cat /opt/ckp/drive-sa.min.json)" \
    >> /opt/ckp/.env.production
  rm -f /opt/ckp/drive-sa.json
  chmod 600 /opt/ckp/.env.production /opt/ckp/drive-sa.min.json
  ```

Also do not create a file named `.env` in `/opt/ckp` — Compose auto-loads it for
variable interpolation and it will confuse things. The app files are
`.env.production` and `.env.api`.

---

## Deploying

1. GitHub → **Actions** → *Build & Push to GHCR (Droplet)* → **Run workflow**
   - `build_web`: ✅
   - `build_api`: only for Stage 2
   - `base_path`: leave **empty** (serves at `/`)
2. On the droplet:

```bash
cd /opt/ckp
./deploy.sh web          # Stage 1
./deploy.sh blog         # Stage 2
./deploy.sh status       # anytime: containers, memory, swap, disk
```

Pin an exact build instead of `latest`:

```bash
IMAGE_TAG=54d0c3f1234567 ./deploy.sh web
```

`deploy.sh` refuses to run if an env file is missing or not `chmod 600`, and
tails the container logs if the app fails to answer within 90 seconds.

---

## nginx and TLS

```bash
# on the droplet, one time
mkdir -p /etc/ssl/ckp
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/ckp/privkey.pem -out /etc/ssl/ckp/fullchain.pem \
  -subj "/CN=143.110.245.16" -addext "subjectAltName=IP:143.110.245.16"
chmod 600 /etc/ssl/ckp/privkey.pem

cp nginx-ckp.conf /etc/nginx/sites-available/ckp
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/ckp /etc/nginx/sites-enabled/ckp
nginx -t && systemctl reload nginx

ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable
```

**HTTPS is mandatory.** The interview module calls `getUserMedia` and
`MediaRecorder`, which browsers expose only in a secure context. Over plain HTTP
the camera does not exist. The self-signed cert shows a warning testers click
through once; swap in Let's Encrypt the moment a real domain points here:

```bash
certbot --nginx -d portal.example.com
# then update APP_URL + NEXT_PUBLIC_APP_URL in .env.production and:
./deploy.sh web
```

No rebuild is needed for a URL change — both values are read server-side only.

Don't bother with `nip.io`/`sslip.io`: they aren't on the Public Suffix List, so
Let's Encrypt's per-domain cap is shared across everyone using them.

---

## Supabase allowlist

Supabase dashboard → **Authentication** → **URL Configuration**:

- Site URL: `https://143.110.245.16`
- Redirect URLs: `https://143.110.245.16/**`

Skip this and login silently bounces to localhost.

---

## Stage 2 notes

The blog module is deliberately not the 9-container `fetch-blogs/docker-compose.prod.yml`:

| Default | Here | Why |
|---|---|---|
| 5 Celery worker containers | 1 unified worker, `-c 2` | saves ~400 Mi |
| local `mongo:7` | Atlas | saves ~877 MB image and its RAM |
| `flower` dashboard | dropped | not needed in production |
| `fastapi run --workers 4` | `--workers 1` | each worker is a full ~180 Mi process |
| `MONGO_URI` hardcoded in `environment:` | `env_file` only | Compose's `environment:` silently overrides `env_file`, which would point the stack at a mongo container that doesn't exist here |

After `./deploy.sh blog`, trigger a crawl and watch memory:

```bash
# Note AUTH_SECRET_KEY, not APP_SECRET_KEY: cfg.SECRET_KEY lives in
# AuthSettings (src/core/config.py:104) whose env_prefix is "AUTH_".
curl -fsS -X POST http://127.0.0.1:8000/api/v1/pipeline/jobs \
  -H "X-Internal-Token: $(grep '^AUTH_SECRET_KEY=' /opt/ckp/.env.api | cut -d= -f2)"

watch -n 5 'free -h; swapon --show; docker stats --no-stream --format "{{.Name}} {{.MemUsage}}"'
```

**Decision gate:** if `available` stays above ~150 Mi and swap stays at **0 B**
through a full crawl, the box is fine. If swap starts climbing, either move the
pipeline back to a workstation or take the reversible RAM resize:

```bash
# from a machine with doctl + an API token
doctl compute droplet-action power-off <id> --wait
doctl compute droplet-action resize    <id> --size s-1vcpu-2gb --wait   # no disk flag = reversible
doctl compute droplet-action power-on  <id> --wait
```

---

## Troubleshooting

```bash
cd /opt/ckp
docker compose logs --tail=80 web
docker compose logs --tail=80 api
docker compose logs --tail=80 worker
./deploy.sh status
```

| Symptom | Likely cause |
|---|---|
| Container restart-loops immediately | malformed `.env.production` (quotes, or multi-line Drive JSON) |
| `401` from the blog API | `AUTH_SECRET_KEY` ≠ `BLOG_INTERNAL_TOKEN` |
| `fetch failed` from `/api/digests/*` | `BLOG_SERVICE_URL` must be `http://api:8000/api/v1` — inside the web container `127.0.0.1` is the container itself |
| `Connection refused` to `localhost:27017` | `MONGODB_URI` (legacy name) unset; the digest routes use it, `MONGO_URI` only covers the health check |
| `/shared/tech-keywords.json` not found | the `./shared:/shared:ro` mount is missing on `api`/`worker` |
| Digest routes return empty but data exists | `src/storage/mongodb.py` hardcodes database `creole_knowledge`; the cluster holds `knowledge_portal` |
| `429 Gemini API quota exceeded` | free-tier daily limit; not an infrastructure fault. Wait for reset or raise the plan |
| `504` on Synthesize | `proxy_read_timeout` below the route's `maxDuration = 600` |
| Login redirects to localhost | Supabase URL Configuration not updated |
| Camera/mic missing in browser | page served over HTTP, or cert not accepted |
| Gemini calls fail | wrong `GEMINI_MODEL` name |
| Everything slows to a crawl | swap in use — check `swapon --show` |
| `denied` on `docker compose pull` | GHCR PAT missing `read:packages`, or expired |
