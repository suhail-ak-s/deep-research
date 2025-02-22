FROM node:22.14.0-alpine

WORKDIR /app

COPY . .
COPY package.json ./
COPY .env.local ./.env.local

RUN npm install tsx@4.19.3
RUN npm install

CMD ["npm", "run", "docker"]