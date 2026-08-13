FROM node:24-alpine AS provider-console-build

WORKDIR /build/apps/provider-console

COPY apps/provider-console/package.json apps/provider-console/package-lock.json ./
RUN npm ci

COPY apps/provider-console/ ./
RUN npm run build

FROM node:24-alpine

WORKDIR /app

COPY services/api/package.json services/api/package-lock.json ./
RUN npm ci

COPY services/api/tsconfig.json ./
COPY services/api/src ./src
COPY services/api/migrations ./migrations
COPY --from=provider-console-build /build/apps/provider-console/dist ./provider-console-dist

EXPOSE 3000

CMD ["npm", "start"]
