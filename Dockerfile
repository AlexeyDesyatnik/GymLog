# The production image (#15): the server and the built app together, so the two are always the
# same version. Built on the developer's computer by deploy/prod.sh, never on the server.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/client packages/client
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN npm ci --omit=dev && npm cache clean --force
# Node runs the TypeScript sources as they are.
COPY packages/shared/src packages/shared/src
COPY packages/server/src packages/server/src
COPY packages/server/drizzle packages/server/drizzle
COPY --from=build /app/packages/client/dist packages/client/dist
ENV SERVER_HOST=0.0.0.0 SERVER_PORT=3000 CLIENT_DIR=/app/packages/client/dist
USER node
EXPOSE 3000
CMD ["node", "packages/server/src/main.ts"]
