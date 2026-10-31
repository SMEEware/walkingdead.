package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"walkingdead/internal/detect"
	"walkingdead/internal/model"
)

const maxEventStreams = 32

type window struct {
	Events     int            `json:"events"`
	Sources    int            `json:"sources"`
	BySeverity map[string]int `json:"bySeverity"`
	ByService  map[string]int `json:"byService"`
}

func summarize(events []model.Event, since int64) window {
	w := window{BySeverity: map[string]int{"info": 0, "low": 0, "medium": 0, "high": 0, "critical": 0}, ByService: map[string]int{}}
	sources := map[string]bool{}
	for _, e := range events {
		if e.TS < since {
			continue
		}
		w.Events++
		w.BySeverity[e.Severity]++
		w.ByService[e.Service]++
		sources[e.SrcIP] = true
	}
	w.Sources = len(sources)
	return w
}

func threatLevel(events []model.Event, now int64) int {
	weights := map[string]float64{"info": 0.5, "low": 2, "medium": 6, "high": 14, "critical": 30}
	level := 0.0
	for _, e := range events {
		age := float64(now-e.TS) / float64(time.Hour/time.Millisecond)
		if age < 0 || age > 24 {
			continue
		}
		level += weights[e.Severity] / (1 + age*2)
	}
	return min(100, int(level))
}

func (s *Server) overview(w http.ResponseWriter, r *http.Request) {
	state := s.store.Snapshot()
	status := s.systemStatus()
	now := time.Now().UnixMilli()
	events := state.Events
	attackers := buildAttackers(state)
	result := map[string]any{
		"generatedAt": now,
		"running":     status["running"],
		"mode":        status["mode"],
		"autoBlock":   status["autoBlock"],
		"services":    status["services"],
		"threatLevel": threatLevel(events, now),
		"lastHour":    summarize(events, now-int64(time.Hour/time.Millisecond)),
		"last24h":     summarize(events, now-int64(24*time.Hour/time.Millisecond)),
		"retained":    len(events),
		"attackers":   len(attackers),
		"blocked":     len(state.Blocklist),
		"compromised": len(slices.DeleteFunc(slices.Clone(attackers), func(a attacker) bool { return !a.Compromised })),
	}
	if len(attackers) > 0 {
		result["topAttacker"] = attackers[0]
	}
	if latest := newestEvents(slices.Clone(events)); len(latest) > 0 {
		result["lastEvent"] = latest[0]
	}
	writeJSON(w, http.StatusOK, result)
}

type eventFilter struct {
	service, kind, ip, tag, minSeverity string
	since                               int64
}

func parseFilter(r *http.Request) (eventFilter, error) {
	q := r.URL.Query()
	f := eventFilter{service: q.Get("service"), kind: q.Get("type"), ip: q.Get("ip"), tag: q.Get("tag"), minSeverity: q.Get("minSeverity")}
	if f.minSeverity != "" && !slices.Contains([]string{"info", "low", "medium", "high", "critical"}, f.minSeverity) {
		return f, fmt.Errorf("minSeverity must be info, low, medium, high, or critical")
	}
	if raw := q.Get("since"); raw != "" {
		since, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || since < 0 {
			return f, fmt.Errorf("since must be a Unix timestamp in milliseconds")
		}
		f.since = since
	}
	return f, nil
}

func (f eventFilter) match(e model.Event) bool {
	return (f.service == "" || e.Service == f.service) &&
		(f.kind == "" || e.Type == f.kind) &&
		(f.ip == "" || e.SrcIP == f.ip) &&
		(f.tag == "" || slices.Contains(e.Tags, f.tag)) &&
		(f.minSeverity == "" || detect.Rank(e.Severity) >= detect.Rank(f.minSeverity)) &&
		e.TS >= f.since
}

type eventSubscriber struct {
	events chan model.Event
	filter eventFilter
}

func (s *Server) publish(e model.Event) {
	s.streamMu.Lock()
	defer s.streamMu.Unlock()
	for sub := range s.eventStreams {
		if !sub.filter.match(e) {
			continue
		}
		select {
		case sub.events <- e:
		default:
		}
	}
}

func (s *Server) eventStream(w http.ResponseWriter, r *http.Request) {
	filter, err := parseFilter(r)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	sub := &eventSubscriber{events: make(chan model.Event, 64), filter: filter}
	s.streamMu.Lock()
	if s.eventStreams == nil {
		s.eventStreams = map[*eventSubscriber]struct{}{}
	}
	if len(s.eventStreams) >= maxEventStreams {
		s.streamMu.Unlock()
		fail(w, http.StatusServiceUnavailable, "Too many event streams.")
		return
	}
	s.eventStreams[sub] = struct{}{}
	s.streamMu.Unlock()
	defer func() { s.streamMu.Lock(); delete(s.eventStreams, sub); s.streamMu.Unlock() }()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(w)
	write := func(name string, payload any) bool {
		data, err := json.Marshal(payload)
		if err != nil {
			return false
		}
		_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", name, strings.ReplaceAll(string(data), "\n", " ")); err != nil {
			return false
		}
		return controller.Flush() == nil
	}
	if !write("ready", map[string]any{"connectedAt": time.Now().UnixMilli()}) {
		return
	}
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-s.shutdown:
			return
		case <-r.Context().Done():
			return
		case e := <-sub.events:
			if !write("attack", e) {
				return
			}
		case <-ping.C:
			if _, ok := s.authenticate(r); !ok {
				return
			}
			if !write("ping", map[string]any{"ts": time.Now().UnixMilli()}) {
				return
			}
		}
	}
}
