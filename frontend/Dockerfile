FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# dev server (port is set in compose command)
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
