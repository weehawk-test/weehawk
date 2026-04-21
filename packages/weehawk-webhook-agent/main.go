// Weehawk webhook agent: minimal HTTP trigger that runs bash scripts dropped by the API
// under /opt/weehawk-scripts/webhooks/{token}.sh (same contract as Weehawk’s remote URL builder).
//
// Environment (align with apps/api RemoteServersService + your deployment):
//
//	WEEHAWK_HOOK_LISTEN — bind address, default ":8759"
//	  If unset, WEEHAWK_REMOTE_WEBHOOK_HTTP_PORT is used as ":{port}" (same name as the API).
//	WEEHAWK_HOOK_SCRIPTS_DIR — default "/opt/weehawk-scripts/webhooks"
//	WEEHAWK_HOOK_PATH_PREFIX — URL segment before token, default "weehawk-hooks" → /weehawk-hooks/{token}
//	  Falls back to WEEHAWK_REMOTE_WEBHOOK_URL_PATH_PREFIX (same name as the API).
//	WEEHAWK_HOOK_TIMEOUT — script timeout, default "180s"
//	WEEHAWK_HOOK_ALLOW_ANY_HOST — if "1"/"true"/"yes", accept any Host on / and /weehawk-hooks/… (default: host must be present)
//
// Example: curl -X POST "https://example.com/weehawk-hooks/<64-hex-token>"
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
	return "weehawk-hooks"
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

// Triggers (not /<prefix>/healthz) must include a Host header unless WEEHAWK_HOOK_ALLOW_ANY_HOST is set.
func webhookTriggerHostAllowed(r *http.Request) bool {
	if envTruthy("WEEHAWK_HOOK_ALLOW_ANY_HOST") {
		return true
	}
	h := requestHostName(r)
	if h == "" {
		return false
	}
	return true
}

func main() {
	listen := listenAddr()
	scriptsDir := env("WEEHAWK_HOOK_SCRIPTS_DIR", "/opt/weehawk-scripts/webhooks")
	prefix := pathPrefix()
	timeout := parseTimeout(env("WEEHAWK_HOOK_TIMEOUT", "180s"))

	urlPrefix := "/" + prefix
	healthzPath := urlPrefix + "/healthz"

	mux := http.NewServeMux()

	handler := func(w http.ResponseWriter, r *http.Request) {
		// Normalize doubled slashes from proxies (e.g. //hooks/token)
		p := path.Clean(r.URL.Path)
		if p == "." {
			p = "/"
		} else if !strings.HasPrefix(p, "/") {
			p = "/" + p
		}

		if p == healthzPath {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = w.Write([]byte("ok\n"))
			return
		}

		if !webhookTriggerHostAllowed(r) {
			writeJSON(w, http.StatusForbidden, responseBody{
				OK:     false,
				Error:  "host not allowed",
				Output: "Provide a valid Host header (or set WEEHAWK_HOOK_ALLOW_ANY_HOST=1 to skip host checks).",
			})
			return
		}

		if p == "/" {
			writeJSON(w, http.StatusNotFound, responseBody{
				OK:     false,
				Error:  "path not found",
				Output: "Not found.",
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

		// Run the script in the background so GitHub/GitLab get an immediate response
		// and don't hit their short webhook timeout (~10s).
		go func(script string, dur time.Duration) {
			ctx, cancel := context.WithTimeout(context.Background(), dur)
			defer cancel()

			cmd := exec.CommandContext(ctx, "bash", script)
			cmd.Env = os.Environ()
			out, runErr := cmd.CombinedOutput()
			outStr := strings.TrimSpace(string(out))
			if len(outStr) > 4000 {
				outStr = outStr[len(outStr)-4000:]
			}

			if runErr != nil {
				if errors.Is(ctx.Err(), context.DeadlineExceeded) {
					log.Printf("[webhook] script timed out after %s: %s", dur, script)
				} else {
					log.Printf("[webhook] script failed: %s — %s | %s", script, runErr, outStr)
				}
				return
			}
			log.Printf("[webhook] script OK: %s | %s", script, outStr)
		}(scriptPath, timeout)

		writeJSON(w, http.StatusAccepted, responseBody{OK: true, Output: "script started in background"})
	}

	mux.HandleFunc("/", handler)

	log.Printf("weehawk-webhook-agent listening on %s (prefix %s/, scripts %s)", listen, urlPrefix, scriptsDir)
	if err := http.ListenAndServe(listen, mux); err != nil {
		log.Fatal(err)
	}
}
