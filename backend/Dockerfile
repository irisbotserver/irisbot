FROM node:20-slim

WORKDIR /app

# Install dependencies for Baileys/Chrome if needed (for ffmpeg, etc.)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --production

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

# Expose port
EXPOSE 3001

# Command to run (assuming ecosystem.config.js for PM2 or just node)
CMD ["node", "src/server.js"]
