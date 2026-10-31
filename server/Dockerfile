FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY server.js ./
RUN mkdir -p /data

ENV PORT=8787
ENV DATA_DIR=/data
EXPOSE 8787

CMD ["node", "server.js"]
