FROM node:20.11.0 as build

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npx prisma generate
RUN npm run build

FROM node:20.11.0-slim

WORKDIR /app

RUN apt update && apt install libssl-dev -y --no-install-recommends

COPY --chown=node:node --from=build /app/entrypoint.sh entrypoint.sh
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/.env .env
COPY --chown=node:node --from=build /app/package*.json ./

RUN chmod +x entrypoint.sh
RUN npm install --omit=dev
COPY --chown=node:node --from=build /app/node_modules/.prisma/client  ./node_modules/.prisma/client

ENV NODE_ENV production

EXPOSE $HTTP_PORT

CMD ["./entrypoint.sh"]