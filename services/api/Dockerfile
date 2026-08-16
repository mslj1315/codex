FROM node:24-alpine AS admin-console-build

WORKDIR /build/apps/admin-console

COPY apps/admin-console/package.json apps/admin-console/package-lock.json ./
RUN npm ci

COPY apps/admin-console/ ./
RUN npm run build

FROM node:24-alpine

WORKDIR /app

COPY services/api/package.json services/api/package-lock.json ./
RUN npm ci

COPY services/api/tsconfig.json ./
COPY services/api/src ./src
COPY services/api/migrations ./migrations
COPY --from=admin-console-build /build/apps/admin-console/dist ./admin-console-dist

EXPOSE 3000

CMD ["npm", "start"]
