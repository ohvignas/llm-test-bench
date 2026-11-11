FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
WORKDIR /opt/deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
RUN npx playwright install --with-deps chromium --only-shell
COPY files.mjs /opt/bench/files.mjs
USER node
WORKDIR /workspace
CMD ["sleep", "infinity"]
