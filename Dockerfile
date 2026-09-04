FROM node:20-slim

# Install Inkscape untuk konversi file vector (EPS, AI, CDR)
RUN apt-get update && apt-get install -y inkscape && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
