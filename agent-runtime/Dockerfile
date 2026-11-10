FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
WORKDIR /controller
RUN mkdir -p /agent-control && chown 10001:10001 /agent-control
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund
COPY src ./src
EXPOSE 8090
CMD ["node", "src/server.mjs"]
