FROM debian:trixie-slim AS rtl-tcp

RUN apt-get update \
    && apt-get install -y --no-install-recommends rtl-sdr \
    && rm -rf /var/lib/apt/lists/*
EXPOSE 1234
ENTRYPOINT ["rtl_tcp"]
CMD ["-a", "0.0.0.0", "-p", "1234", "-d", "0", "-n", "1"]

FROM node:22-bookworm-slim AS app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY . .
RUN chown node:node /app \
    && install -d -o node -g node /app/web/js/plugins /data \
    && install -m 0755 docker/entrypoint.sh /usr/local/bin/fmdx-entrypoint

ENV FMDX_CONFIG_PATH=/data/config.json

USER node
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["tini", "--", "fmdx-entrypoint"]
CMD ["node", "."]
