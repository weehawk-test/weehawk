# Build: docker build -t weehawk/webhook-agent:latest packages/weehawk-webhook-agent
# Runtime needs bash for user scripts dropped under WEEHAWK_HOOK_SCRIPTS_DIR.
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN go build -trimpath -ldflags="-s -w" -o /weehawk-webhook-agent .

FROM alpine:3.19
# docker-cli + compose v2 plugin: on-host redeploy scripts run `docker compose` / `docker stack` (needs /var/run/docker.sock mount at runtime).
RUN apk add --no-cache ca-certificates curl bash docker-cli docker-cli-compose
COPY --from=build /weehawk-webhook-agent /usr/local/bin/weehawk-webhook-agent
EXPOSE 8759
ENTRYPOINT ["/usr/local/bin/weehawk-webhook-agent"]
