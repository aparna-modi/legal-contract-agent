FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 5000

CMD ["node", "server.js"]
