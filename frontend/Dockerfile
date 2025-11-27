FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# dev by default; set FRONTEND_MODE=prod to build + preview
CMD ["sh", "-c", "if [ \"${FRONTEND_MODE}\" = \"prod\" ]; then npm run build && npm run preview -- --host 0.0.0.0 --port 5173; else npm run dev -- --host 0.0.0.0 --port 5173; fi"]
