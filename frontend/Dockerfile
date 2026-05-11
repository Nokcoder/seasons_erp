# /seasons_erp/frontend/Dockerfile

# Stage 1: Build the React/Vite app
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine
# Copy the built Vite files (Vite outputs to 'dist')
COPY --from=builder /app/dist /usr/share/nginx/html
# Copy our custom routing rules
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]