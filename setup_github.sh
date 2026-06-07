#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="${REPO_NAME:-stateful-agentic-sandbox-orchestrator}"
VISIBILITY="${VISIBILITY:-public}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is required. Install gh and run: gh auth login" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

OWNER="$(gh api user --jq .login)"
OWNER_ID="$(gh api user --jq .id)"

for file in README.md LICENSE; do
  if grep -q "OWNER_PLACEHOLDER" "$file"; then
    sed -i.bak "s/OWNER_PLACEHOLDER/$OWNER/g" "$file"
    rm -f "$file.bak"
  fi
done

git init
git config user.name "${GIT_AUTHOR_NAME:-$OWNER}"
git config user.email "${GIT_AUTHOR_EMAIL:-$OWNER_ID+$OWNER@users.noreply.github.com}"

git add .gitignore .env.example .nvmrc .python-version LICENSE
git commit -m "chore: initialize repository metadata"

git add infra/db/init.sql infra/policies/default-terminal-sandbox.yml packages/shared/contracts/run-request.schema.json
git commit -m "infra: add relational schema and run contract"

git add docker-compose.yml
git commit -m "infra: add isolated Docker Compose topology"

git add apps/web/package.json apps/web/package-lock.json apps/web/tsconfig.json apps/web/next.config.mjs apps/web/next-env.d.ts apps/web/Dockerfile apps/web/public apps/web/src/app/layout.tsx apps/web/src/app/page.tsx
git commit -m "feat(gateway): scaffold Next.js control plane"

git add apps/web/src/lib/policy.ts
git commit -m "feat(gateway): compile YAML policies into evidence constraints"

git add apps/web/src/lib/policy.test.ts
git commit -m "test(gateway): cover deterministic policy admission"

git add apps/web/src/lib/config.ts apps/web/src/lib/db.ts apps/web/src/lib/queue.ts apps/web/src/lib/runs.ts
git commit -m "feat(gateway): persist run admission and enqueue Redis stream work"

git add apps/web/src/app/api/runs/route.ts apps/web/src/app/api/runs/[id]/route.ts
git commit -m "feat(gateway): expose asynchronous run APIs"

git add apps/web/src/lib/runs.test.ts apps/web/src/app/api/runs/route.test.ts apps/web/src/app/api/runs/route.integration.test.ts apps/web/vitest.config.ts
git commit -m "test(gateway): add route and database integration coverage"

git add services/engine/pyproject.toml services/engine/Dockerfile services/engine/sandbox_engine/__init__.py services/engine/sandbox_engine/config.py services/engine/sandbox_engine/db.py services/engine/sandbox_engine/main.py
git commit -m "feat(engine): scaffold FastAPI runtime service"

git add services/engine/sandbox_engine/delta_sync.py
git commit -m "feat(engine): add delta workspace hydration"

git add services/engine/sandbox_engine/sandbox_runner.py
git commit -m "feat(engine): add bounded sandbox command runner"

git add services/engine/sandbox_engine/worker.py
git commit -m "feat(engine): consume Redis stream jobs"

git add services/engine/tests
git commit -m "test(engine): cover delta sync sandbox and worker behavior"

git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions pipeline"

git add README.md docs scripts setup_github.sh
git commit -m "docs: add case study demo and publication workflow"

if ! gh repo view "$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  gh repo create "$REPO_NAME" "--$VISIBILITY" --source=. --remote=origin
else
  git remote remove origin >/dev/null 2>&1 || true
  git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"
fi

git branch -M main
git push -u origin main

echo "Published $REPO_NAME to GitHub."
