/**
 * Multi-stage, WORKDIR /app, bind 0.0.0.0 — Render-style templates for Weehawk auto-generation.
 * All paths are absolute inside the image (/app).
 */

export type NodeTemplateVariant = 'next' | 'generic';

export function nodeMultiStageDockerfile(opts: {
  port: number;
  variant: NodeTemplateVariant;
}): string {
  const { port, variant } = opts;
  const portStr = String(port);

  if (variant === 'next') {
    return `# syntax=docker/dockerfile:1
# Weehawk auto-generated — Next.js (multi-stage, flat /app, Turbopack disabled for CI)
FROM node:20-bookworm AS builder
WORKDIR /app
COPY package.json package-lock.json* npm-shrinkwrap.json* ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NEXT_DISABLE_TURBOPACK=1
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=${portStr}
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app /app
EXPOSE ${portStr}
CMD ["npm", "run", "start"]
`;
  }

  return `# syntax=docker/dockerfile:1
# Weehawk auto-generated — Node.js (multi-stage, flat /app)
FROM node:20-bookworm AS builder
WORKDIR /app
COPY package.json package-lock.json* npm-shrinkwrap.json* ./
RUN npm ci
COPY . .
RUN npm run build --if-present
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=${portStr}
COPY --from=builder /app /app
EXPOSE ${portStr}
CMD ["npm", "start"]
`;
}

export function goDistrolessDockerfile(opts: { port: number }): string {
  const p = String(opts.port);
  return `# syntax=docker/dockerfile:1
# Weehawk auto-generated — Go (multi-stage, distroless)
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/server .

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=builder /out/server /app/server
ENV PORT=${p}
EXPOSE ${p}
USER nonroot:nonroot
ENTRYPOINT ["/app/server"]
`;
}

export function pythonAlpineDockerfile(opts: { port: number }): string {
  const p = String(opts.port);
  return `# syntax=docker/dockerfile:1
# Weehawk auto-generated — Python (multi-stage, Alpine)
FROM python:3.12-alpine AS builder
WORKDIR /app
ENV PYTHONUNBUFFERED=1
RUN pip install --upgrade pip
COPY requirements.txt* pyproject.toml* ./
COPY . .
RUN if [ -f requirements.txt ]; then \\
      pip install --no-cache-dir -r requirements.txt; \\
    elif [ -f pyproject.toml ]; then \\
      pip install --no-cache-dir .; \\
    else \\
      echo "Missing requirements.txt or pyproject.toml" && exit 1; \\
    fi

FROM python:3.12-alpine AS runner
WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV PORT=${p}
ENV HOST=0.0.0.0
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app /app
EXPOSE ${p}
CMD ["sh", "-c", "if [ -f main.py ]; then exec python main.py; elif [ -f app.py ]; then exec python app.py; else echo 'Add main.py or app.py' >&2; exit 1; fi"]
`;
}

export function staticNginxDockerfile(): string {
  return `# syntax=docker/dockerfile:1
# Weehawk auto-generated — static site (nginx)
FROM nginx:1.27-alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
}
