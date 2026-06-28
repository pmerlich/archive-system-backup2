# backend/Dockerfile — בונה את "קופסת" השרת (NestJS).
FROM node:20-alpine
WORKDIR /app

# סביבת NetFree (סינון שמיירט SSL): שהקונטיינר יסמוך על תעודת ה-CA של NetFree
COPY netfree-ca.crt /usr/local/share/ca-certificates/netfree.crt
RUN cat /usr/local/share/ca-certificates/netfree.crt >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/netfree.crt

# openssl נדרש ל-Prisma על Alpine
RUN apk add --no-cache openssl

# התקנת תלויות בשכבה נפרדת (ניצול מטמון Docker)
COPY package*.json ./
RUN npm install

# העתקת קוד המקור
COPY . .

# יצירת לקוח Prisma מתוך הסכמה
RUN npx prisma generate

# כלי הפקת גרסאות צפייה מוגנת (שלב 3.1): ImageMagick (תמונות), poppler-utils (PDF→תמונה), ffmpeg (וידאו/שמע).
# ממוקם אחרי npm/prisma כדי לא לפסול את שכבות המטמון הכבדות — בנייה מחדש מוסיפה רק שכבה זו.
RUN apk add --no-cache imagemagick poppler-utils ffmpeg font-dejavu font-noto-hebrew

# השרת מאזין על הפורט שמוגדר ב-.env (ברירת מחדל 4000)
EXPOSE 4000

CMD ["npm", "run", "start:dev"]
