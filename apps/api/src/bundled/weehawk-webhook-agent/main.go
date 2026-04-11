// Weehawk webhook agent: minimal HTTP trigger that runs bash scripts dropped by the API
// under /opt/weehawk-scripts/webhooks/{token}.sh (same contract as Weehawk’s remote URL builder).
//
// Environment (align with apps/api RemoteServersService + your deployment):
//
//	WEEHAWK_HOOK_LISTEN — bind address, default ":8759"
//	  If unset, WEEHAWK_REMOTE_WEBHOOK_HTTP_PORT is used as ":{port}" (same name as the API).
//	WEEHAWK_HOOK_SCRIPTS_DIR — default "/opt/weehawk-scripts/webhooks"
//	WEEHAWK_HOOK_PATH_PREFIX — URL segment before token, default "hooks" → path /hooks/{token}
//	  Falls back to WEEHAWK_REMOTE_WEBHOOK_URL_PATH_PREFIX (same name as the API).
//	WEEHAWK_HOOK_TIMEOUT — script timeout, default "180s"
//	WEEHAWK_HOOK_ALLOW_ANY_HOST — if "1"/"true"/"yes", accept any Host on / and /hooks/… (default: require Host to contain "weehawk-webhook")
//
// Example: curl -X POST "https://weehawk-webhook.example.com/hooks/<64-hex-token>"
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var tokenRe = regexp.MustCompile(`^[a-f0-9]{64}$`)

func env(key, fallback string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	return v
}

func listenAddr() string {
	if v := strings.TrimSpace(os.Getenv("WEEHAWK_HOOK_LISTEN")); v != "" {
		return v
	}
	if p := strings.TrimSpace(os.Getenv("WEEHAWK_REMOTE_WEBHOOK_HTTP_PORT")); p != "" {
		if strings.HasPrefix(p, ":") {
			return p
		}
		return ":" + p
	}
	return ":8759"
}

func pathPrefix() string {
	if v := strings.Trim(strings.TrimSpace(os.Getenv("WEEHAWK_HOOK_PATH_PREFIX")), "/"); v != "" {
		return v
	}
	if v := strings.Trim(strings.TrimSpace(os.Getenv("WEEHAWK_REMOTE_WEBHOOK_URL_PATH_PREFIX")), "/"); v != "" {
		return v
	}
	return "hooks"
}

func parseTimeout(s string) time.Duration {
	d, err := time.ParseDuration(strings.TrimSpace(s))
	if err != nil || d <= 0 {
		return 180 * time.Second
	}
	return d
}

func resolveScript(scriptsDir, token string) (string, error) {
	if !tokenRe.MatchString(token) {
		return "", errors.New("invalid token")
	}
	base, err := filepath.Abs(scriptsDir)
	if err != nil {
		return "", err
	}
	joined := filepath.Join(base, token+".sh")
	abs, err := filepath.Abs(joined)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(base, abs)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", errors.New("invalid path")
	}
	st, err := os.Stat(abs)
	if err != nil || st.IsDir() {
		return "", errors.New("script not found")
	}
	return abs, nil
}

type responseBody struct {
	OK     bool   `json:"ok"`
	Output string `json:"output"`
	Error  string `json:"error,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, body responseBody) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

const requiredWebhookHostSubstring = "weehawk-webhook"

func envTruthy(key string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	return v == "1" || v == "true" || v == "yes"
}

func requestHostName(r *http.Request) string {
	host := strings.TrimSpace(r.Host)
	if host == "" {
		return ""
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		return strings.ToLower(h)
	}
	return strings.ToLower(host)
}

// Triggers (not /healthz) must hit a Host containing weehawk-webhook unless WEEHAWK_HOOK_ALLOW_ANY_HOST is set.
func webhookTriggerHostAllowed(r *http.Request) bool {
	if envTruthy("WEEHAWK_HOOK_ALLOW_ANY_HOST") {
		return true
	}
	h := requestHostName(r)
	if h == "" {
		return false
	}
	return strings.Contains(h, requiredWebhookHostSubstring)
}

func main() {
	listen := listenAddr()
	scriptsDir := env("WEEHAWK_HOOK_SCRIPTS_DIR", "/opt/weehawk-scripts/webhooks")
	prefix := pathPrefix()
	timeout := parseTimeout(env("WEEHAWK_HOOK_TIMEOUT", "900s"))

	urlPrefix := "/" + prefix

	mux := http.NewServeMux()

	handler := func(w http.ResponseWriter, r *http.Request) {
		// Normalize doubled slashes from proxies (e.g. //hooks/token)
		p := path.Clean(r.URL.Path)
		if p == "." {
			p = "/"
		} else if !strings.HasPrefix(p, "/") {
			p = "/" + p
		}

		if p == "/healthz" {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = w.Write([]byte("ok\n"))
			return
		}

		if !webhookTriggerHostAllowed(r) {
			writeJSON(w, http.StatusForbidden, responseBody{
				OK:     false,
				Error:  "host not allowed",
				Output: "Use a Host containing " + requiredWebhookHostSubstring + " (e.g. weehawk-webhook.example.com). Set WEEHAWK_HOOK_ALLOW_ANY_HOST=1 to disable.",
			})
			return
		}

		if p == "/" {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"service": "weehawk-webhook-agent",
				"trigger": urlPrefix + "/<64-hex-token>",
				"healthz": "/healthz",
			})
			return
		}
		if p == urlPrefix || p == urlPrefix+"/" {
			writeJSON(w, http.StatusNotFound, responseBody{
				OK:     false,
				Error:  "missing token",
				Output: "Use " + urlPrefix + "/<your-webhook-token> (GET or POST).",
			})
			return
		}
		if !strings.HasPrefix(p, urlPrefix+"/") {
			writeJSON(w, http.StatusNotFound, responseBody{
				OK:     false,
				Error:  "path not found",
				Output: "Expected path prefix " + urlPrefix + "/ ; got " + p,
			})
			return
		}
		rest := strings.TrimPrefix(p, urlPrefix+"/")
		token := strings.TrimSpace(strings.Split(rest, "/")[0])

		scriptPath, err := resolveScript(scriptsDir, token)
		if err != nil {
			writeJSON(w, http.StatusNotFound, responseBody{OK: false, Error: "unknown or invalid webhook"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()

		cmd := exec.CommandContext(ctx, "bash", scriptPath)
		cmd.Env = os.Environ()
		out, runErr := cmd.CombinedOutput()
		outStr := strings.TrimSpace(string(out))
		if len(outStr) > 32000 {
			outStr = outStr[:32000] + "…"
		}

		if runErr != nil {
			if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(runErr, context.DeadlineExceeded) {
				writeJSON(w, http.StatusGatewayTimeout, responseBody{
					OK:     false,
					Output: outStr,
					Error:  "script timed out",
				})
				return
			}
			msg := outStr
			if msg == "" {
				msg = runErr.Error()
			}
			writeJSON(w, http.StatusInternalServerError, responseBody{
				OK:     false,
				Output: msg,
				Error:  "script failed",
			})
			return
		}

		writeJSON(w, http.StatusOK, responseBody{OK: true, Output: outStr})
	}

	mux.HandleFunc("/", handler)

	log.Printf("weehawk-webhook-agent listening on %s (prefix %s/, scripts %s)", listen, urlPrefix, scriptsDir)
	if err := http.ListenAndServe(listen, mux); err != nil {
		log.Fatal(err)
	}
}
