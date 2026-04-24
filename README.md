# Hyperlane Explorer

An interchain explorer for the Hyperlane protocol and network.

## Development

```sh
pnpm install       # Install dependencies
pnpm run dev       # Start Next.js dev server
pnpm run build     # Build for production
pnpm run test      # Run unit tests
pnpm run lint      # Lint check
```

## Self-Hosted Deployment (GKE)

This repo runs against a self-hosted indexer stack instead of the public Hyperlane Hasura API. The pipeline:

```
Hyperlane Scraper Agent → CloudSQL PostgreSQL → Hasura GraphQL → This Explorer
```

### Stack Components

| Component | Version | Purpose |
|-----------|---------|---------|
| `hyperlane-agent` scraper | `agents-v1.4.0` | Indexes on-chain messages into Postgres |
| Hasura GraphQL Engine | `v2.44.0` | GraphQL API layer over Postgres |
| This explorer | `v13.x` | Frontend UI |

### Environment Variables

Build-time (baked into Next.js bundle via Docker `ARG`):

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Hasura GraphQL endpoint (e.g. `https://hasura-explorer.<domain>/v1/graphql`) |
| `NEXT_PUBLIC_REGISTRY_URL` | Custom chain registry raw URL |
| `NEXT_PUBLIC_REGISTRY_BRANCH` | Registry branch, default `main` |

Runtime (Kubernetes secret):

| Variable | Description |
|----------|-------------|
| `EXPLORER_API_KEYS` | JSON map of chain name → block explorer API key |

### Docker Build

Local:
```sh
docker build \
  --build-arg NEXT_PUBLIC_REGISTRY_URL=https://raw.githubusercontent.com/<org>/<registry>/refs/heads/main \
  --build-arg NEXT_PUBLIC_API_URL=https://hasura-explorer.<domain>/v1/graphql \
  -t <image>:<tag> .
```

GCP Cloud Build:
```sh
gcloud builds submit --config=cloudbuild.yaml --project=<project>
```

Edit `cloudbuild.yaml` substitutions (`_IMAGE`, `_NEXT_PUBLIC_REGISTRY_URL`, `_NEXT_PUBLIC_API_URL`) before building.

### Database Schema

Apply the scraper's PostgreSQL schema before starting the scraper. The schema (translated from the upstream SeaORM migrations at `hyperlane-monorepo/rust/main/agents/scraper/migration`) creates:

- `domain` — chain metadata (name, chain_id, domain_id, is_test_net, is_deprecated)
- `block`, `cursor`, `transaction`
- `gas_payment` + `total_gas_payment` view
- `delivered_message`
- `message` + `message_view` (the view joins message with origin/destination tx data)

Apply via a one-shot `psql` pod:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: apply-schema
spec:
  restartPolicy: Never
  containers:
    - name: psql
      image: postgres:15-alpine
      command: ["sh", "-c", "psql $DATABASE_URL -f /sql/schema.sql"]
      env:
        - name: DATABASE_URL
          valueFrom: { secretKeyRef: { name: hasura-explorer-env, key: DATABASE_URL } }
      volumeMounts:
        - { name: sql, mountPath: /sql }
  volumes:
    - { name: sql, configMap: { name: hyperlane-schema } }
```

### Seed `domain` Table

The `domain` table must be seeded **only** with chains actually being scraped. Extra mainnet rows will cause the explorer to apply a default mainnet-only filter (`src/features/messages/queries/build.ts:buildDomainIdWhereClause`) and hide testnet messages.

For a testnet-only deployment (`HYP_CHAINSTOSCRAPE=arbitrumsepolia,sepolia,pruvtest,mantapacifictestnet,bsctestnet,kairos,fuji`):

```sql
INSERT INTO domain (id, created_at, updated_at, name, native_token, chain_id, is_test_net, is_deprecated) VALUES
  (421614,   NOW(), NOW(), 'arbitrumsepolia',    'ETH',  421614,  true, false),
  (11155111, NOW(), NOW(), 'sepolia',            'ETH',  11155111,true, false),
  (7336,     NOW(), NOW(), 'pruvtest',           'PRUV', 7336,    true, false),
  (3441006,  NOW(), NOW(), 'mantapacifictestnet','ETH',  3441006, true, false),
  (97,       NOW(), NOW(), 'bsctestnet',         'BNB',  97,      true, false),
  (1001,     NOW(), NOW(), 'kairos',             'KAIA', 1001,    true, false),
  (43113,    NOW(), NOW(), 'fuji',               'AVAX', 43113,   true, false);
```

If you need to clean up extra domains later:
```sql
DELETE FROM domain WHERE name NOT IN ('arbitrumsepolia','sepolia','pruvtest','mantapacifictestnet','bsctestnet','kairos','fuji');
```

### Hasura Setup

After applying the schema, track tables and grant anonymous select permissions via the Hasura metadata API:

```bash
ADMIN_SECRET=$(kubectl get secret hasura-explorer-env -o jsonpath='{.data.ADMIN_SECRET}' | base64 -d)
HASURA_URL=http://hasura-explorer.<namespace>.svc.cluster.local:8080

# Track tables
for table in domain message_view; do
  curl -s -X POST $HASURA_URL/v1/metadata \
    -H "Content-Type: application/json" \
    -H "x-hasura-admin-secret: $ADMIN_SECRET" \
    -d "{\"type\":\"pg_track_table\",\"args\":{\"source\":\"default\",\"table\":\"$table\"}}"
done

# Anonymous select permissions
for table in domain message_view; do
  curl -s -X POST $HASURA_URL/v1/metadata \
    -H "Content-Type: application/json" \
    -H "x-hasura-admin-secret: $ADMIN_SECRET" \
    -d "{\"type\":\"pg_create_select_permission\",\"args\":{\"source\":\"default\",\"table\":\"$table\",\"role\":\"anonymous\",\"permission\":{\"columns\":\"*\",\"filter\":{}}}}"
done
```

### Custom Chain Registry

Chains outside the canonical Hyperlane registry (`hyperlane-xyz/hyperlane-registry`) must be added to a fork pointed to by `NEXT_PUBLIC_REGISTRY_URL`. Add entries to `chains/metadata.yaml` in alphabetical order:

```yaml
pruvtest:
  chainId: 7336
  displayName: Pruv Testnet
  domainId: 7336
  isTestnet: true
  name: pruvtest
  nativeToken:
    decimals: 18
    name: PRUV
    symbol: PRUV
  protocol: ethereum
  rpcUrls:
    - http: https://rpc.pruv.network
```

After pushing registry changes, restart the explorer pod to pick up the new metadata:

```sh
kubectl rollout restart deployment/hyperlane-explorer -n <namespace>
```

### Kubernetes / ArgoCD

The Helm values for the explorer (`argo-apps/accounts/<env>/apps/hyperlane-explorer/values.yaml`) reference the image tag built by Cloud Build:

```yaml
image:
  repository: asia-southeast2-docker.pkg.dev/<project>/sto/staging/hyperlane-explorer
  tag: v13.2.0
externalSecret:
  enabled: true
  secretName: hyperlane-explorer-env
  secretManagerName: <gsm-secret-name>
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: hyperlane-explorer.<domain>
```

Deployment flow:
1. Commit code changes, bump `_IMAGE` tag in `cloudbuild.yaml`.
2. Run `gcloud builds submit --config=cloudbuild.yaml` — make sure the commit is pushed first (build pulls from local workspace).
3. Bump `tag:` in the ArgoCD values file to match.
4. Commit/push to argo-apps — ArgoCD syncs automatically.

## Troubleshooting

### Explorer shows "no results found"

1. Check Hasura has data:
   ```bash
   curl -s -X POST https://hasura-explorer.<domain>/v1/graphql \
     -H "Content-Type: application/json" \
     -d '{"query":"{ message_view_aggregate { aggregate { count } } }"}'
   ```
2. Check the `domain` table contains **only** chains being scraped. Extra mainnet rows trigger a mainnet-only WHERE clause that excludes testnet messages.
3. Check `NEXT_PUBLIC_API_URL` is baked into the correct build — the explorer is a Next.js app, env vars must be set at build time.
4. Verify the fix in `src/features/messages/queries/build.ts` is present (guard `mainnetDomainIds.length > 0` on the default filter). Required for testnet-only deployments.

### Destinations show as "Unknown"

The destination chain is not in the custom registry. Add it to `chains/metadata.yaml` in your registry fork and restart the explorer pod.

### Scraper errors `relation "cursor" does not exist`

Database schema not applied. Run the schema SQL via one-shot `psql` pod before the scraper starts.

## Learn more

- [Hyperlane documentation](https://docs.hyperlane.xyz)
- [Hyperlane monorepo](https://github.com/hyperlane-xyz/hyperlane-monorepo) (scraper source)
- [Hyperlane registry](https://github.com/hyperlane-xyz/hyperlane-registry) (canonical chain metadata)
