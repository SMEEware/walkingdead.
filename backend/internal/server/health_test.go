package server

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestHealthIsPrivateAndReportsStorageFailure(t *testing.T) {
	s, store, _ := fixture(t)
	cookie := loginCookie(t, s)
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/health", nil, nil, "", ""), http.StatusUnauthorized)
	w := call(t, s, http.MethodGet, "/api/v1/health", nil, cookie, "", "")
	requireStatus(t, w, http.StatusOK)
	var result struct {
		Status         string `json:"status"`
		Storage        string `json:"storage"`
		RetainedEvents int    `json:"retainedEvents"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "ready" || result.Storage != "available" || result.RetainedEvents != 0 {
		t.Fatalf("unexpected health: %s", w.Body.String())
	}
	s.evidenceMu.Lock()
	s.evidenceError = "storage failure"
	s.evidenceMu.Unlock()
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/health", nil, cookie, "", ""), http.StatusServiceUnavailable)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/health", nil, cookie, "", ""), http.StatusServiceUnavailable)
}
