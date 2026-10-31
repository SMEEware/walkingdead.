package server

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"walkingdead/internal/model"
)

func TestMetricsArePrivateAndExcludeCapturedValues(t *testing.T) {
	s, store, _ := fixture(t)
	cookie := loginCookie(t, s)
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/metrics", nil, nil, "", ""), http.StatusUnauthorized)
	event := model.Event{ID: "private-event-id", SessionID: "private-session", SrcIP: "192.0.2.77", Service: "http", Severity: "low", Path: "/private-path", Payload: "captured-secret", TS: time.Now().UnixMilli()}
	if err := s.record(event); err != nil {
		t.Fatal(err)
	}
	call(t, s, http.MethodGet, "/api/v1/sessions/private-session", nil, cookie, "", "")
	call(t, s, http.MethodGet, "/api/v1/arbitrary-private-path", nil, cookie, "", "")
	w := call(t, s, http.MethodGet, "/api/v1/metrics", nil, cookie, "", "")
	requireStatus(t, w, http.StatusOK)
	if !strings.Contains(w.Header().Get("Content-Type"), "text/plain") {
		t.Fatalf("not Prometheus text: %s", w.Header().Get("Content-Type"))
	}
	for _, metric := range []string{"walkingdead_events_persisted_total", "walkingdead_storage_available 1", "walkingdead_retained_events 1", "walkingdead_management_requests_total", "walkingdead_capture_persist_duration_seconds", "go_goroutines"} {
		if !strings.Contains(w.Body.String(), metric) {
			t.Errorf("missing metric: %s", metric)
		}
	}
	if !strings.Contains(w.Body.String(), `route="GET /api/v1/sessions/{id}"`) {
		t.Fatal("request metrics lost the registered route template")
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("private metrics must not be cached")
	}
	for _, private := range []string{event.ID, event.SessionID, event.SrcIP, event.Path, event.Payload, "arbitrary-private-path", cookie.Value} {
		if strings.Contains(w.Body.String(), private) {
			t.Errorf("private value in metrics: %s", private)
		}
	}
	if err := store.Update(func(state *model.State) error {
		state.Keys = append(state.Keys, model.APIKey{ID: "reader", Hash: secretHash("wdk_metrics-restricted"), Scopes: []string{"events:read"}, ExpiresAt: time.Now().Add(time.Hour).UnixMilli()})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/metrics", nil, nil, "wdk_metrics-restricted", ""), http.StatusForbidden)
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/openapi", nil, nil, "wdk_metrics-restricted", ""), http.StatusForbidden)
}

func TestConcurrentMetricsScrapesAreBounded(t *testing.T) {
	s, _, _ := fixture(t)
	cookie := loginCookie(t, s)
	entered, release, done := make(chan struct{}, 2), make(chan struct{}), make(chan struct{}, 2)
	s.metricsState.registry.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{Name: "test_blocking_scrape", Help: "Blocks the two admitted test scrapes."}, func() float64 {
		entered <- struct{}{}
		<-release
		return 1
	}))
	defer func() {
		close(release)
		for range 2 {
			<-done
		}
	}()
	for range 2 {
		go func() {
			call(t, s, http.MethodGet, "/api/v1/metrics", nil, cookie, "", "")
			done <- struct{}{}
		}()
	}
	for range 2 {
		select {
		case <-entered:
		case <-time.After(3 * time.Second):
			t.Fatal("admitted scrapes did not reach the registry")
		}
	}
	w := call(t, s, http.MethodGet, "/api/v1/metrics", nil, cookie, "", "")
	requireStatus(t, w, http.StatusServiceUnavailable)
	if !strings.HasPrefix(w.Header().Get("Content-Type"), "text/plain") {
		t.Fatal("unexpected Prometheus overload response format")
	}
}

func TestFailureDiagnosticsExcludeRequestCredentialsAndEvidence(t *testing.T) {
	s, store, _ := fixture(t)
	cookie := loginCookie(t, s)
	var logs bytes.Buffer
	s.logger = slog.New(slog.NewJSONHandler(&logs, nil))
	store.Close()
	w := call(t, s, http.MethodGet, "/api/v1/health?private-evidence=value", nil, cookie, "", "")
	requireStatus(t, w, http.StatusServiceUnavailable)
	var record map[string]any
	if err := json.Unmarshal(logs.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	if record["request_id"] != w.Header().Get("X-Request-ID") || record["request_id"] == "" || record["route"] != "GET /api/v1/health" {
		t.Fatal("missing request correlation or route template")
	}
	for _, private := range []string{"private-evidence", "value", cookie.Value} {
		if strings.Contains(logs.String(), private) {
			t.Fatal("private request value in diagnostic log")
		}
	}
}
