FROM node:22-alpine

ARG BUILD_DATE
ENV APP_BUILD_DATE=$BUILD_DATE
RUN echo "Image built on: ${APP_BUILD_DATE}"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY views ./views
COPY public ./public

ENV ICAL_URL='webcal://calendar.bluesombrero.com/api/v1/Calendar?instancekey=leagues&portalId=80619&id=47088120&key=EOL5XG9Y'
ENV PORT=3000
EXPOSE 3000

USER node

CMD ["node", "server.js"]
