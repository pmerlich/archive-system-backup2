# frontend/Dockerfile — בונה את "קופסת" האתר (Next.js).
FROM node:20-alpine
WORKDIR /app

# סביבת NetFree (סינון שמיירט SSL): שהקונטיינר יסמוך על תעודת ה-CA של NetFree
COPY netfree-ca.crt /usr/local/share/ca-certificates/netfree.crt
RUN cat /usr/local/share/ca-certificates/netfree.crt >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/netfree.crt

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
