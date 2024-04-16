
ARG ARCH=
FROM ${ARCH}mcr.microsoft.com/devcontainers/javascript-node:20-bookworm
WORKDIR /app/base-template

RUN npm install -g npm@latest
COPY . .
RUN rm -rf generated
RUN rm -rf node_modules

ENV PNPM_HOME /usr/local/binp
RUN npm install --global pnpm

RUN pnpm install

RUN pnpm envio codegen
CMD ./envio-entrypoint.sh