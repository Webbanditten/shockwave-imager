FROM node:22.23.5-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22.23.5-alpine
WORKDIR /app
COPY --from=build /app/dist/shockwave-imager.cjs ./
COPY samples ./samples
ENV PORT=8096 NODE_ENV=production
USER node
EXPOSE 8096
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
CMD ["node", "shockwave-imager.cjs"]
