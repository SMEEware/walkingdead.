package server

import (
	"cmp"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"walkingdead/internal/model"
)

type sessionView struct {
	ID         string `json:"id"`
	SrcIP      string `json:"srcIp"`
	Service    string `json:"service"`
	SensorID   string `json:"sensorId"`
	StartedAt  int64  `json:"startedAt"`
	EndedAt    int64  `json:"endedAt"`
	LastSeenAt int64  `json:"lastSeenAt"`
	EventCount int    `json:"eventCount"`
	Severity   string `json:"severity"`
}

func describeSession(events []model.Event) sessionView {
	first := events[0]
	result := sessionView{ID: first.SessionID, SrcIP: first.SrcIP, Service: first.Service, SensorID: first.SensorID, StartedAt: first.TS, EndedAt: first.TS, Severity: "info", EventCount: len(events)}
	for _, event := range events {
		result.StartedAt = min(result.StartedAt, event.TS)
		result.EndedAt = max(result.EndedAt, event.TS)
		if severityRank(event.Severity) > severityRank(result.Severity) {
			result.Severity = event.Severity
		}
	}
	result.LastSeenAt = result.EndedAt
	return result
}

func (s *Server) getSessions(w http.ResponseWriter, r *http.Request) {
	day, query := r.URL.Query().Get("day"), strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if day != "" && !validDay(day) || len(query) > 256 {
		fail(w, http.StatusBadRequest, "Use a valid UTC day and a search of at most 256 bytes.")
		return
	}
	limit, offset := maxEvents, 0
	for key, target := range map[string]*int{"limit": &limit, "offset": &offset} {
		if value := r.URL.Query().Get(key); value != "" {
			number, err := strconv.Atoi(value)
			if err != nil || number < 0 || key == "limit" && number < 1 {
				fail(w, http.StatusBadRequest, "Use positive limit and non-negative offset values.")
				return
			}
			*target = number
		}
	}
	limit = min(limit, maxEvents)
	grouped := map[string][]model.Event{}
	for _, event := range s.store.Snapshot().Events {
		if event.SessionID != "" {
			grouped[event.SessionID] = append(grouped[event.SessionID], event)
		}
	}
	result := []sessionView{}
	for _, events := range grouped {
		matchesDay, matchesQuery := day == "", query == ""
		for _, event := range events {
			matchesDay = matchesDay || dayOf(event.TS) == day
			matchesQuery = matchesQuery || strings.Contains(strings.ToLower(event.SessionID+" "+event.SrcIP+" "+event.SensorID+" "+event.Method+" "+event.Path+" "+event.Message), query)
		}
		if matchesDay && matchesQuery {
			result = append(result, describeSession(events))
		}
	}
	slices.SortFunc(result, func(a, b sessionView) int {
		if order := cmp.Compare(b.LastSeenAt, a.LastSeenAt); order != 0 {
			return order
		}
		return cmp.Compare(a.ID, b.ID)
	})
	w.Header().Set("X-Total-Count", strconv.Itoa(len(result)))
	offset = min(offset, len(result))
	writeJSON(w, http.StatusOK, result[offset:offset+min(limit, len(result)-offset)])
}

func (s *Server) getSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if len(id) > 128 {
		fail(w, http.StatusBadRequest, "Invalid session ID.")
		return
	}
	events := []model.Event{}
	for _, event := range s.store.Snapshot().Events {
		if event.SessionID == id {
			events = append(events, event)
		}
	}
	if len(events) == 0 {
		fail(w, http.StatusNotFound, "No retained events for this session.")
		return
	}
	slices.SortFunc(events, func(a, b model.Event) int {
		if order := cmp.Compare(a.TS, b.TS); order != 0 {
			return order
		}
		return cmp.Compare(a.ID, b.ID)
	})
	writeJSON(w, http.StatusOK, map[string]any{"session": describeSession(events), "events": events, "retainedOnly": true})
}
