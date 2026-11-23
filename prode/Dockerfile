FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=8080 PRODE_DB=/data/prode.db
VOLUME /data
EXPOSE 8080
CMD ["node", "server/server.js"]
