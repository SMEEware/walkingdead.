package server

import (
	"net/http"
	"time"
)

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	system := s.systemStatus()
	state := s.store.Snapshot()
	status, code := "ready", http.StatusOK
	if _, failed := system["error"]; failed {
		status, code = "degraded", http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]any{
		"status": status, "storage": "available", "uptimeSeconds": int64(time.Since(s.startedAt).Seconds()),
		"system": system, "retainedEvents": len(state.Events), "retainedSummaries": len(state.Summaries),
		"limits": map[string]int{"events": maxEvents, "eventBytes": maxEventBytes, "summaries": 366, "summaryBytes": maxSummaryBytes},
	})
}
