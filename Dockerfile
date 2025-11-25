FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Railway provides PORT
ENV PORT=3000

# Write tokens.json from env and start HTTP MCP server
CMD ["sh", "-c", "printf '%s' \"$TOKENS_JSON\" > /app/tokens.json && node http-server.js"]
