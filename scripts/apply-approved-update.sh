#!/bin/sh
set -eu

project_directory=${1:-.}
cd "$project_directory"

compose_files="-f compose.yaml -f compose.sessions.yaml"
app_container=$(docker compose $compose_files ps -q app)
if [ -z "$app_container" ]; then
  echo "MediaDeck app container is not running." >&2
  exit 1
fi

approved_image=$(docker compose $compose_files exec -T app node -e \
  "const p=JSON.parse(require('node:fs').readFileSync('/data/runtime/approved-update.json','utf8'));if(!p.image)process.exit(2);process.stdout.write(p.image)")
approved_version=$(docker compose $compose_files exec -T app node -e \
  "const p=JSON.parse(require('node:fs').readFileSync('/data/runtime/approved-update.json','utf8'));if(!p.version)process.exit(2);process.stdout.write(p.version)")
previous_image=$(docker inspect --format '{{.Config.Image}}' "$app_container")
previous_version=$(docker compose $compose_files exec -T app node -e \
  "process.stdout.write(process.env.APP_VERSION || 'unknown')")

rollback_file=.mediadeck-update-rollback
printf 'MEDIADECK_IMAGE=%s\nAPP_VERSION=%s\n' \
  "$previous_image" "$previous_version" > "$rollback_file"
chmod 600 "$rollback_file"

case "$approved_image" in
  *@sha256:????????????????????????????????????????????????????????????????) ;;
  *)
    echo "The approved image is not pinned to a sha256 digest." >&2
    exit 1
    ;;
esac

echo "Pulling approved MediaDeck $approved_version image..."
docker pull "$approved_image"

export MEDIADECK_IMAGE=$approved_image
export APP_VERSION=$approved_version
docker compose $compose_files up -d --no-build app

port=${MEDIADECK_PORT:-8080}
attempt=0
healthy=false
while [ "$attempt" -lt 30 ]; do
  if docker compose $compose_files exec -T app node -e \
    "fetch('http://127.0.0.1:3000/api/v1/operations/diagnostics').then(async r=>{const d=await r.json();if(!r.ok||d.status!=='healthy')process.exit(1)}).catch(()=>process.exit(1))"
  then
    healthy=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 2
done

if [ "$healthy" != "true" ]; then
  echo "The updated container did not become healthy; rolling back." >&2
  export MEDIADECK_IMAGE=$previous_image
  export APP_VERSION=$previous_version
  docker compose $compose_files up -d --no-build app
  exit 1
fi

environment_file=.env
temporary_file=$(mktemp "${environment_file}.XXXXXX")
if [ -f "$environment_file" ]; then
  awk '
    !/^MEDIADECK_IMAGE=/ &&
    !/^APP_VERSION=/
  ' "$environment_file" > "$temporary_file"
fi
printf 'MEDIADECK_IMAGE=%s\nAPP_VERSION=%s\n' \
  "$approved_image" "$approved_version" >> "$temporary_file"
chmod 600 "$temporary_file"
mv "$temporary_file" "$environment_file"

echo "MediaDeck $approved_version is healthy on loopback port $port."
echo "Previous image retained for rollback: $previous_image"
