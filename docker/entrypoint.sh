#!/bin/sh
set -eu

config_path="${FMDX_CONFIG_PATH:-/data/config.json}"

if [ ! -f "$config_path" ]; then
  cp /app/docker/config.example.json "$config_path"

  if [ -n "${FMDX_ADMIN_PASSWORD:-}" ]; then
    admin_password="$FMDX_ADMIN_PASSWORD"
    generated_password=false
  else
    admin_password="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("base64url"))')"
    generated_password=true
  fi

  FMDX_BOOTSTRAP_ADMIN_PASSWORD="$admin_password" node -e '
    const fs = require("node:fs");
    const configPath = process.argv[1];
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.password = {
      ...(config.password || {}),
      adminPass: process.env.FMDX_BOOTSTRAP_ADMIN_PASSWORD
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  ' "$config_path"

  if [ "$generated_password" = true ]; then
    printf '%s\n' "Generated FM-DX administrator password: $admin_password" >&2
    printf '%s\n' "Save this password now; it is shown only when the configuration is created." >&2
  fi
fi

exec "$@"
