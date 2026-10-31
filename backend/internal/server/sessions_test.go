package server

import (
	"encoding/json"
	"net/http"
	"testing"
	"walkingdead/internal/model"
)

func TestSessionSearchAndRetainedTimeline(t *testing.T) {
	s, store, _ := fixture(t)
	cookie := loginCookie(t, s)
	events := []model.Event{
		{ID: "early", SessionID: "session-a", SensorID: "local-http", SrcIP: "192.0.2.1", Service: "http", TS: 1704067199000, Severity: "low", Path: "/.env"},
		{ID: "late", SessionID: "session-a", SensorID: "local-http", SrcIP: "192.0.2.1", Service: "http", TS: 1704067201000, Severity: "high", Path: "/admin"},
		{ID: "other", SessionID: "session-b", SensorID: "local-http", SrcIP: "192.0.2.2", Service: "http", TS: 1704067202000, Severity: "info", Path: "/"},
	}
	if err := store.Update(func(state *model.State) error { state.Events = events; return nil }); err != nil {
		t.Fatal(err)
	}
	w := call(t, s, http.MethodGet, "/api/v1/sessions?q=admin&day=2024-01-01&limit=1", nil, cookie, "", "")
	requireStatus(t, w, http.StatusOK)
	var items []struct {
		ID         string `json:"id"`
		EventCount int    `json:"eventCount"`
		Severity   string `json:"severity"`
		LastSeenAt int64  `json:"lastSeenAt"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != "session-a" || items[0].EventCount != 2 || items[0].Severity != "high" || items[0].LastSeenAt != 1704067201000 {
		t.Fatalf("filtered sessions: %s", w.Body.String())
	}
	w = call(t, s, http.MethodGet, "/api/v1/sessions/session-a", nil, cookie, "", "")
	requireStatus(t, w, http.StatusOK)
	var detail struct {
		Events       []model.Event `json:"events"`
		RetainedOnly bool          `json:"retainedOnly"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if !detail.RetainedOnly || len(detail.Events) != 2 || detail.Events[0].ID != "early" || detail.Events[1].ID != "late" {
		t.Fatalf("timeline: %s", w.Body.String())
	}
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/sessions/missing", nil, cookie, "", ""), http.StatusNotFound)
	for _, query := range []string{"day=2024-02-31", "limit=zero", "offset=-1"} {
		requireStatus(t, call(t, s, http.MethodGet, "/api/v1/sessions?"+query, nil, cookie, "", ""), http.StatusBadRequest)
	}
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/sessions/session-a", nil, nil, "", ""), http.StatusUnauthorized)
	if err := store.Update(func(state *model.State) error {
		state.Keys = append(state.Keys, model.APIKey{ID: "restricted", Hash: secretHash("wdk_restricted"), Scopes: []string{"system:read"}, ExpiresAt: 4102444800000})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/sessions/session-a", nil, nil, "wdk_restricted", ""), http.StatusForbidden)
}
