package server

import (
	"cmp"
	"net/http"
	"slices"
	"strconv"
	"time"

	"walkingdead/internal/model"
)

type dayStat struct {
	Day        string         `json:"day"`
	Total      int            `json:"total"`
	BySeverity map[string]int `json:"bySeverity"`
}

func dayOf(timestamp int64) string { return time.UnixMilli(timestamp).UTC().Format("2006-01-02") }
func validDay(day string) bool {
	value, err := time.Parse("2006-01-02", day)
	return err == nil && value.Format("2006-01-02") == day
}
func boundedLimit(r *http.Request, fallback, maximum int) int {
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 {
		return fallback
	}
	return min(limit, maximum)
}
func newestEvents(events []model.Event) []model.Event {
	if events == nil {
		events = []model.Event{}
	}
	slices.SortFunc(events, func(a, b model.Event) int { return cmp.Compare(b.TS, a.TS) })
	return events
}
func listDays(events []model.Event) []dayStat {
	days := map[string]*dayStat{}
	for _, event := range events {
		day := dayOf(event.TS)
		if days[day] == nil {
			days[day] = &dayStat{Day: day, BySeverity: map[string]int{"info": 0, "low": 0, "medium": 0, "high": 0, "critical": 0}}
		}
		days[day].Total++
		days[day].BySeverity[event.Severity]++
	}
	result := []dayStat{}
	for _, day := range days {
		result = append(result, *day)
	}
	slices.SortFunc(result, func(a, b dayStat) int { return cmp.Compare(b.Day, a.Day) })
	return result
}

func (s *Server) recentLogs(w http.ResponseWriter, r *http.Request) {
	filter, err := parseFilter(r)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	events := newestEvents(slices.DeleteFunc(s.store.Snapshot().Events, func(e model.Event) bool { return !filter.match(e) }))
	writeJSON(w, http.StatusOK, events[:min(len(events), boundedLimit(r, 400, maxEvents))])
}
func (s *Server) days(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, listDays(s.store.Snapshot().Events))
}
func (s *Server) dayLogs(w http.ResponseWriter, r *http.Request) {
	day := r.PathValue("day")
	if !validDay(day) {
		fail(w, http.StatusBadRequest, "Use an ISO date in UTC (YYYY-MM-DD).")
		return
	}
	events := []model.Event{}
	for _, event := range s.store.Snapshot().Events {
		if dayOf(event.TS) == day {
			events = append(events, event)
		}
	}
	writeJSON(w, http.StatusOK, newestEvents(events))
}

func (s *Server) changed(w http.ResponseWriter, r *http.Request, action string, apply func(*model.State) error) {
	if err := s.update(identity(r).Actor, action, apply); err != nil {
		fail(w, http.StatusInternalServerError, "Could not persist the change.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteLogs(w http.ResponseWriter, r *http.Request) {
	s.changed(w, r, "events.clear", func(state *model.State) error { state.Events = []model.Event{}; return nil })
}
func (s *Server) getSummaries(w http.ResponseWriter, r *http.Request) {
	summaries := s.store.Snapshot().Summaries
	if summaries == nil {
		summaries = []model.Summary{}
	}
	slices.SortFunc(summaries, func(a, b model.Summary) int { return cmp.Compare(b.Day, a.Day) })
	writeJSON(w, http.StatusOK, summaries)
}
func (s *Server) putSummary(w http.ResponseWriter, r *http.Request) {
	var summary model.Summary
	if !decode(w, r, &summary) {
		return
	}
	if r.PathValue("day") != "" && summary.Day != r.PathValue("day") {
		fail(w, http.StatusBadRequest, "Summary day does not match the URL.")
		return
	}
	if !validDay(summary.Day) || len(summary.Text) > 12000 || summary.LogCount < 0 || summary.CreatedAt <= 0 || summary.Source != "local" && summary.Source != "ai" {
		fail(w, http.StatusBadRequest, "Invalid summary.")
		return
	}
	if summary.Provider != "" && summary.Provider != "deepseek" || summary.Model != "" && summary.Model != "deepseek-flash" && summary.Model != "deepseek-v4-pro" || summary.InputTokens < 0 || summary.OutputTokens < 0 || summary.InputTokens > 10000000 || summary.OutputTokens > 10000000 {
		fail(w, http.StatusBadRequest, "Invalid summary provider or usage metadata.")
		return
	}
	s.changed(w, r, "summaries.save", func(state *model.State) error {
		found := false
		for i := range state.Summaries {
			if state.Summaries[i].Day == summary.Day {
				state.Summaries[i] = summary
				found = true
				break
			}
		}
		if !found {
			state.Summaries = append(state.Summaries, summary)
		}
		slices.SortFunc(state.Summaries, func(a, b model.Summary) int { return cmp.Compare(a.Day, b.Day) })
		var err error
		state.Summaries, err = retainBudget(state.Summaries, 366, maxSummaryBytes)
		return err
	})
}
func (s *Server) deleteSummary(w http.ResponseWriter, r *http.Request) {
	if !validDay(r.PathValue("day")) {
		fail(w, http.StatusBadRequest, "Invalid summary day.")
		return
	}
	s.changed(w, r, "summaries.delete", func(state *model.State) error {
		state.Summaries = slices.DeleteFunc(state.Summaries, func(summary model.Summary) bool { return summary.Day == r.PathValue("day") })
		return nil
	})
}
func (s *Server) getNotifications(w http.ResponseWriter, r *http.Request) {
	items := s.store.Snapshot().Notifications
	if items == nil {
		items = []model.Notification{}
	}
	slices.SortFunc(items, func(a, b model.Notification) int { return cmp.Compare(b.TS, a.TS) })
	writeJSON(w, http.StatusOK, items[:min(len(items), boundedLimit(r, 300, 300))])
}
func (s *Server) putNotifications(w http.ResponseWriter, r *http.Request) {
	var items []model.Notification
	if !decode(w, r, &items) {
		return
	}
	if len(items) > maxNotifications {
		fail(w, http.StatusBadRequest, "At most 300 notifications may be written at once.")
		return
	}
	for _, item := range items {
		if item.ID == "" || len(item.ID) > 128 || len(item.Title) > 300 || len(item.Body) > 10000 || len(item.Group) > 128 || item.TS <= 0 || !slices.Contains([]string{"alert", "system", "ai"}, item.Kind) || !slices.Contains([]string{"info", "low", "medium", "high", "critical"}, item.Severity) {
			fail(w, http.StatusBadRequest, "Invalid notification.")
			return
		}
		if len(item.Ref) > 3 {
			fail(w, http.StatusBadRequest, "Invalid notification reference.")
			return
		}
		for key, value := range item.Ref {
			if len(key) > 16 || len(value) > 128 {
				fail(w, http.StatusBadRequest, "Invalid notification reference.")
				return
			}
		}
	}
	s.changed(w, r, "notifications.save", func(state *model.State) error {
		byID := map[string]model.Notification{}
		for _, item := range state.Notifications {
			byID[item.ID] = item
		}
		for _, item := range items {
			byID[item.ID] = item
		}
		state.Notifications = []model.Notification{}
		for _, item := range byID {
			state.Notifications = append(state.Notifications, item)
		}
		slices.SortFunc(state.Notifications, func(a, b model.Notification) int { return cmp.Compare(a.TS, b.TS) })
		var err error
		state.Notifications, err = retainBudget(state.Notifications, maxNotifications, maxNotificationBytes)
		return err
	})
}
func (s *Server) deleteNotifications(w http.ResponseWriter, r *http.Request) {
	s.changed(w, r, "notifications.clear", func(state *model.State) error { state.Notifications = []model.Notification{}; return nil })
}
func (s *Server) readNotifications(w http.ResponseWriter, r *http.Request) {
	s.changed(w, r, "notifications.read", func(state *model.State) error {
		for i := range state.Notifications {
			state.Notifications[i].Read = true
		}
		return nil
	})
}
func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	state := s.store.Snapshot()
	writeJSON(w, http.StatusOK, map[string]int{"logs": len(state.Events), "days": len(listDays(state.Events)), "summaries": len(state.Summaries), "notifications": len(state.Notifications)})
}
func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	state := s.store.Snapshot()
	if state.Summaries == nil {
		state.Summaries = []model.Summary{}
	}
	if state.Notifications == nil {
		state.Notifications = []model.Notification{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"exportedAt": time.Now().UTC().Format(time.RFC3339), "logs": newestEvents(state.Events), "days": listDays(state.Events), "summaries": state.Summaries, "notifications": state.Notifications})
}
func (s *Server) clearAll(w http.ResponseWriter, r *http.Request) {
	s.changed(w, r, "evidence.clear", func(state *model.State) error {
		state.Events = []model.Event{}
		state.Summaries = []model.Summary{}
		state.Notifications = []model.Notification{}
		return nil
	})
}

func (s *Server) getAudit(w http.ResponseWriter, r *http.Request) {
	items := s.store.Snapshot().Audits
	if items == nil {
		items = []model.Audit{}
	}
	slices.SortFunc(items, func(a, b model.Audit) int { return cmp.Compare(b.TS, a.TS) })
	writeJSON(w, http.StatusOK, items)
}
