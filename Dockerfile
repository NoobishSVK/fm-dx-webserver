FROM node:22-bookworm-slim AS redsea-build

ARG REDSEA_VERSION=v1.3.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        git \
        libliquid-dev \
        libsndfile1-dev \
        meson \
        ninja-build \
        nlohmann-json3-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${REDSEA_VERSION}" https://github.com/windytan/redsea.git /src/redsea
RUN meson setup /src/redsea/build /src/redsea --buildtype=release --prefix=/usr/local \
    && meson compile -C /src/redsea/build \
    && DESTDIR=/redsea-install meson install -C /src/redsea/build

FROM debian:trixie-slim AS rtl-tcp

RUN apt-get update \
    && apt-get install -y --no-install-recommends rtl-sdr \
    && rm -rf /var/lib/apt/lists/*
EXPOSE 1234
ENTRYPOINT ["rtl_tcp"]
CMD ["-a", "0.0.0.0", "-p", "1234", "-d", "0"]

FROM node:22-bookworm-slim AS app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        libliquid1 \
        libsndfile1 \
        tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY . .
COPY --from=redsea-build /redsea-install/usr/local/bin/redsea /usr/local/bin/redsea
RUN chown node:node /app \
    && install -d -o node -g node /app/web/js/plugins /data \
    && install -m 0755 docker/entrypoint.sh /usr/local/bin/fmdx-entrypoint

ENV FMDX_CONFIG_PATH=/data/config.json \
    FMDX_DEVICE=sdr \
    RTL_TCP_ENABLED=true \
    RTL_TCP_HOST=rtl_tcp \
    RTL_TCP_PORT=1234

USER node
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["tini", "--", "fmdx-entrypoint"]
CMD ["node", "."]
