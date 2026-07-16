FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
RUN addgroup -S -g 10001 addarr && adduser -S -D -H -u 10001 -G addarr addarr
WORKDIR /app
ENV NODE_ENV=production \
    CONFIG_UI_ENV_FILE=/app/config/.env \
    CONFIG_UI_RESTART_COMMAND="docker compose restart stremio-addarr"
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build --chown=addarr:addarr /app/dist ./dist
COPY --from=build --chown=addarr:addarr /app/assets ./assets
COPY --from=build --chown=addarr:addarr /app/docs ./docs
COPY --chown=addarr:addarr .env.example ./
RUN mkdir -p /app/config /app/data && chown -R addarr:addarr /app
USER addarr
EXPOSE 7010
CMD ["node", "dist/src/index.js"]
