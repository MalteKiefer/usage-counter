# syntax=docker/dockerfile:1

# Pin the base image by digest before releasing, e.g. node:24-alpine@sha256:<digest>
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    OIL_DB=/data/oil.db
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/src/lib ./src/lib
COPY --from=build /app/dist ./dist
# The runtime needs only node. Removing npm and corepack keeps their bundled dependencies out of the image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && mkdir -p /data && chown 1000:1000 /data
USER 1000:1000
VOLUME ["/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/objects').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server/index.js"]
