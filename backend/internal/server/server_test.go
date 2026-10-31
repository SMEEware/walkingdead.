package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"walkingdead/internal/model"
	"walkingdead/internal/vault"
)

const testPassword = "correct horse battery staple"

func fixture(t *testing.T) (*Server, *vault.Store, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "instance")
	store, _, err := vault.Create(dir, "owner", []byte(testPassword))
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(store, Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.Close(ctx)
		_ = store.Close()
	})
	return s, store, dir
}

func call(t *testing.T, s *Server, method, target string, body any, cookie *http.Cookie, token, origin string) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
	}
	r := httptest.NewRequest(method, "http://localhost"+target, reader)
	if method != http.MethodGet {
		r.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}
func loginCookie(t *testing.T, s *Server) *http.Cookie {
	t.Helper()
	w := call(t, s, http.MethodPost, "/api/v1/auth/login", map[string]string{"username": "owner", "password": testPassword}, nil, "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("login: %d %s", w.Code, w.Body.String())
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("login did not set one cookie")
	}
	return cookies[0]
}
func requireStatus(t *testing.T, w *httptest.ResponseRecorder, status int) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("got %d, want %d: %s", w.Code, status, w.Body.String())
	}
}

func TestOwnerAuthAndMutationOrigin(t *testing.T) {
	s, store, _ := fixture(t)
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/system", nil, nil, "", ""), http.StatusUnauthorized)
	requireStatus(t, call(t, s, http.MethodPost, "/api/v1/auth/login", map[string]string{"username": "owner", "password": testPassword}, nil, "", "https://attacker.invalid"), http.StatusForbidden)
	cookie := loginCookie(t, s)
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Secure {
		t.Fatalf("unexpected local cookie security: %+v", cookie)
	}
	requireStatus(t, call(t, s, http.MethodPut, "/api/v1/system", map[string]bool{"running": true}, cookie, "", "https://attacker.invalid"), http.StatusForbidden)
	if store.Snapshot().Config.Running {
		t.Fatal("forbidden mutation changed listener state")
	}
	requireStatus(t, call(t, s, http.MethodPut, "/api/v1/system", map[string]string{"mode": "aggressive"}, cookie, "", "http://localhost"), http.StatusBadRequest)
	req := httptest.NewRequest(http.MethodDelete, "http://localhost/api/v1/logs", strings.NewReader("{}"))
	req.AddCookie(cookie)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, req)
	requireStatus(t, w, http.StatusForbidden)
	requireStatus(t, call(t, s, http.MethodPost, "/api/v1/auth/logout", nil, cookie, "", ""), http.StatusNoContent)
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/system", nil, cookie, "", ""), http.StatusUnauthorized)
	cookie = loginCookie(t, s)
	s.authMu.Lock()
	entry := s.sessions[secretHash(cookie.Value)]
	entry.Expires = time.Now().Add(-time.Second)
	s.sessions[secretHash(cookie.Value)] = entry
	s.authMu.Unlock()
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/auth/session", nil, cookie, "", ""), http.StatusUnauthorized)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/logs/recent", nil, cookie, "", ""), http.StatusServiceUnavailable)
}

func TestAPIKeyScopesExpiryAndRevocation(t *testing.T) {
	s, store, _ := fixture(t)
	cookie := loginCookie(t, s)
	create := func() map[string]any {
		w := call(t, s, http.MethodPost, "/api/v1/keys", map[string]any{"name": "reader", "scopes": []string{"events:read", "keys:write"}, "expiresInDays": 1}, cookie, "", "")
		requireStatus(t, w, http.StatusCreated)
		var key map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &key); err != nil {
			t.Fatal(err)
		}
		if _, leaked := key["hash"]; leaked {
			t.Fatal("key hash leaked")
		}
		return key
	}
	key := create()
	secret := key["key"].(string)
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/logs/recent", nil, nil, secret, ""), http.StatusOK)
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/system", nil, nil, secret, ""), http.StatusForbidden)
	requireStatus(t, call(t, s, http.MethodPost, "/api/v1/keys", map[string]any{"name": "escalation", "scopes": validScopes}, nil, secret, ""), http.StatusForbidden)
	requireStatus(t, call(t, s, http.MethodDelete, "/api/v1/keys/"+key["id"].(string), nil, nil, secret, ""), http.StatusForbidden)
	listed := call(t, s, http.MethodGet, "/api/v1/keys", nil, cookie, "", "")
	requireStatus(t, listed, http.StatusOK)
	if strings.Contains(listed.Body.String(), secret) || strings.Contains(listed.Body.String(), "\"hash\"") {
		t.Fatal("key material leaked in listing")
	}
	if err := store.Update(func(state *model.State) error {
		state.Keys[0].ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/logs/recent", nil, nil, secret, ""), http.StatusUnauthorized)
	key = create()
	secret = key["key"].(string)
	requireStatus(t, call(t, s, http.MethodDelete, "/api/v1/keys/"+key["id"].(string), nil, cookie, "", ""), http.StatusNoContent)
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/logs/recent", nil, nil, secret, ""), http.StatusUnauthorized)
}

func TestPortConflictAndStoppedState(t *testing.T) {
	s, store, _ := fixture(t)
	cookie := loginCookie(t, s)
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()
	address := occupied.Addr().String()
	requireStatus(t, call(t, s, http.MethodPut, "/api/v1/system", map[string]any{"running": true, "httpAddress": address}, cookie, "", ""), http.StatusConflict)
	if store.Snapshot().Config.Running {
		t.Fatal("bind failure persisted a running listener")
	}
	status := call(t, s, http.MethodGet, "/api/v1/system", nil, cookie, "", "")
	if !strings.Contains(status.Body.String(), "\"running\":false") || !strings.Contains(status.Body.String(), "\"error\"") {
		t.Fatalf("bind failure hidden: %s", status.Body.String())
	}
	occupied.Close()
	requireStatus(t, call(t, s, http.MethodPut, "/api/v1/system", map[string]bool{"running": true}, cookie, "", ""), http.StatusOK)
	requireStatus(t, call(t, s, http.MethodPut, "/api/v1/system", map[string]bool{"running": false}, cookie, "", ""), http.StatusOK)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		t.Fatalf("stop left the port bound: %v", err)
	}
	listener.Close()
}

func TestEvidencePersistsAndDaemonRestartResumes(t *testing.T) {
	s, store, dir := fixture(t)
	cookie := loginCookie(t, s)
	w := call(t, s, http.MethodPut, "/api/v1/system", map[string]any{"running": true, "httpAddress": "127.0.0.1:0", "mode": "interactive"}, cookie, "", "")
	requireStatus(t, w, http.StatusOK)
	address := store.Snapshot().Config.HTTPAddress
	client := &http.Client{Timeout: 2 * time.Second}
	request, _ := http.NewRequest(http.MethodPost, "http://"+address+"/login", strings.NewReader("username=intruder&password=observed"))
	request.Header.Set("X-Forwarded-For", "203.0.113.99")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("decoy login returned %d", response.StatusCode)
	}
	events := store.Snapshot().Events
	if len(events) != 1 || events[0].SrcIP != "127.0.0.1" || events[0].SessionID == "" || events[0].Payload != "username=intruder&password=observed" {
		t.Fatalf("missing real evidence: %+v", events)
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "vault.json")); err != nil || bytes.Contains(raw, []byte("intruder")) {
		t.Fatal("evidence is missing or exposed in the vault file")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.Close(ctx); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := vault.Open(dir, []byte(testPassword))
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	restarted, err := New(reopened, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close(ctx)
	if !restarted.systemStatus()["running"].(bool) || len(reopened.Snapshot().Events) != 1 {
		t.Fatal("restart lost evidence or did not resume the configured listener")
	}
	cookie = loginCookie(t, restarted)
	requireStatus(t, call(t, restarted, http.MethodDelete, "/api/v1/all", nil, cookie, "", ""), http.StatusNoContent)
	if len(reopened.Snapshot().Events) != 0 || !reopened.Snapshot().Config.Running || len(reopened.Snapshot().Audits) == 0 {
		t.Fatal("clear all damaged config or cleared the operational audit")
	}
	if err := reopened.Update(func(state *model.State) error {
		for i := 0; i < maxEvents; i++ {
			state.Events = append(state.Events, model.Event{ID: strconv.Itoa(i), TS: int64(i), Service: "http"})
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := restarted.record(model.Event{ID: "newest", TS: time.Now().UnixMilli(), Service: "http"}); err != nil {
		t.Fatal(err)
	}
	retained := reopened.Snapshot().Events
	if len(retained) != maxEvents || retained[0].ID != "1" || retained[len(retained)-1].ID != "newest" {
		t.Fatal("retention did not preserve the newest evidence within its bound")
	}
}

func TestStaticRoutesAndAPISeparation(t *testing.T) {
	s, _, _ := fixture(t)
	s.web = fstest.MapFS{"index.html": {Data: []byte("home")}, "logs.html": {Data: []byte("logs page")}, "_next/static/app.js": {Data: []byte("window.ready=true")}, "assets/test.glb": {Data: []byte("glTF")}, "secrets.env": {Data: []byte("hidden")}, "nested/.secret.json": {Data: []byte("hidden")}}
	for _, target := range []string{"/", "/logs", "/logs/", "/_next/static/app.js", "/assets/test.glb"} {
		requireStatus(t, call(t, s, http.MethodGet, target, nil, nil, "", ""), http.StatusOK)
	}
	for _, target := range []string{"/missing", "/api/v1/missing", "/secrets.env", "/nested/.secret.json"} {
		w := call(t, s, http.MethodGet, target, nil, nil, "", "")
		requireStatus(t, w, http.StatusNotFound)
		if w.Body.String() == "home" {
			t.Fatal("missing API or asset fell back to the UI")
		}
	}
}

func TestStreamAuthenticatesAndCleansUpAfterCancellation(t *testing.T) {
	s, _, _ := fixture(t)
	cookie := loginCookie(t, s)
	httpServer := httptest.NewServer(s.Handler())
	defer httpServer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, httpServer.URL+"/api/v1/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.AddCookie(cookie)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("stream unavailable: %d", response.StatusCode)
	}
	line, err := bufio.NewReader(response.Body).ReadString('\n')
	if err != nil || line != "event: event:update\n" {
		t.Fatalf("missing initial invalidation event: %q %v", line, err)
	}
	cancel()
	deadline := time.Now().Add(time.Second)
	for {
		s.streamMu.Lock()
		active := len(s.streams)
		s.streamMu.Unlock()
		if active == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("canceled SSE client was retained")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestConfiguredDevelopmentCORSIsExactAndCredentialsAreRestricted(t *testing.T) {
	_, store, _ := fixture(t)
	if _, err := New(store, Options{AllowedOrigins: []string{"*"}}); err == nil {
		t.Fatal("wildcard development origin accepted")
	}
	if _, err := New(store, Options{AllowedOrigins: []string{"https://attacker.invalid"}}); err == nil {
		t.Fatal("non-loopback development origin accepted")
	}
	dev, err := New(store, Options{AllowedOrigins: []string{"http://127.0.0.1:3000"}})
	if err != nil {
		t.Fatal(err)
	}
	defer dev.Close(context.Background())
	w := call(t, dev, http.MethodOptions, "/api/v1/system", nil, nil, "", "http://127.0.0.1:3000")
	requireStatus(t, w, http.StatusNoContent)
	if w.Header().Get("Access-Control-Allow-Origin") != "http://127.0.0.1:3000" || w.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatal("configured credentialed CORS was not exact")
	}
	w = call(t, dev, http.MethodOptions, "/api/v1/system", nil, nil, "", "http://127.0.0.1:3001")
	requireStatus(t, w, http.StatusForbidden)
	if w.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Fatal("credentials allowed for an unconfigured origin")
	}
}
