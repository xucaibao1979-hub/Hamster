FROM node:24-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm@11.25.0 && pnpm install --frozen-lockfile
COPY app app
COPY app/globals.css app/globals.css
COPY lib lib
COPY deploy deploy
COPY public public
RUN node deploy/build.mjs

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
COPY --from=build /app/internal-dist ./internal-dist
COPY lib ./lib
COPY deploy/server.mjs ./deploy/server.mjs
COPY deploy/users.mjs ./deploy/users.mjs
COPY deploy/access.mjs ./deploy/access.mjs
COPY deploy/operations.mjs ./deploy/operations.mjs
COPY deploy/attachments.mjs ./deploy/attachments.mjs
COPY deploy/flow-undo.mjs ./deploy/flow-undo.mjs
COPY deploy/database-backups.mjs ./deploy/database-backups.mjs
COPY deploy/backup-retention.mjs ./deploy/backup-retention.mjs
COPY deploy/backup-database.mjs ./deploy/backup-database.mjs
COPY deploy/restore-database.mjs ./deploy/restore-database.mjs
COPY deploy/sync.mjs ./deploy/sync.mjs
COPY deploy/repair-holder-status.mjs ./deploy/repair-holder-status.mjs
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "deploy/server.mjs"]
