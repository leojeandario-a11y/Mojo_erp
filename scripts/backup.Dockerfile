FROM node:22-bookworm-slim AS node-runtime

FROM postgres:16-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends libatomic1 libgcc-s1 libstdc++6 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY scripts/backup-encrypted.mjs ./scripts/backup-encrypted.mjs
COPY scripts/restore-encrypted.mjs ./scripts/restore-encrypted.mjs
COPY src/lib/backup-crypto.mjs ./src/lib/backup-crypto.mjs
ENTRYPOINT ["node", "/app/scripts/backup-encrypted.mjs"]
