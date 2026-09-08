FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm install typescript --no-save
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["--scenario", "happy-path"]
