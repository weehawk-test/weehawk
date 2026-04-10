# Sync with packages/weehawk-webhook-agent/Dockerfile — shipped via nest-cli assets for remote `docker build`.
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN go build -trimpath -ldflags="-s -w" -o /weehawk-webhook-agent .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates curl bash
COPY --from=build /weehawk-webhook-agent /usr/local/bin/weehawk-webhook-agent
EXPOSE 8759
ENTRYPOINT ["/usr/local/bin/weehawk-webhook-agent"]
