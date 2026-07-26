#!/bin/sh
set -eu

config_path="${FMDX_CONFIG_PATH:-/data/config.json}"

if [ ! -f "$config_path" ]; then
  cp /app/docker/config.example.json "$config_path"
fi

exec "$@"
