FROM node:22-slim

WORKDIR /app

# Install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source and config
COPY src/ ./src/
COPY config/ ./config/

EXPOSE 8080
ENV NODE_ENV=production

CMD ["node", "src/server.js"]
