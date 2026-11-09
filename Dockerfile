FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=5050
EXPOSE 5050

CMD ["node", "src/server.js"]
