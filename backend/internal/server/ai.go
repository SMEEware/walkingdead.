package server

import (
	"cmp"
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"walkingdead/internal/intelligence"
	"walkingdead/internal/model"
)

const maxAIEvents = 80

type analyzer interface {
	Analyze(context.Context, intelligence.Input) (intelligence.Result, error)
}

func normalizeAI(config model.AIConfig) model.AIConfig {
	if config.Model == "" {
		config.Model = "deepseek-flash"
		config.RedactIPs = true
	}
	return config
}

func aiSettings(config model.AIConfig) map[string]any {
	config = normalizeAI(config)
	return map[string]any{"provider": "deepseek", "enabled": config.Enabled, "configured": config.Key != "", "model": config.Model, "redactIps": config.RedactIPs, "includePayloads": config.IncludePayloads, "maxEvents": maxAIEvents, "maxOutputTokens": 1200}
}

func (s *Server) getAISettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, aiSettings(s.store.AIConfig()))
}

func (s *Server) putAISettings(w http.ResponseWriter, r *http.Request) {
	if !identity(r).Owner {
		fail(w, http.StatusForbidden, "Only an owner login session may configure AI.")
		return
	}
	var input struct {
		Enabled         *bool   `json:"enabled"`
		Model           *string `json:"model"`
		RedactIPs       *bool   `json:"redactIps"`
		IncludePayloads *bool   `json:"includePayloads"`
		ProviderKey     *string `json:"providerKey"`
		ClearKey        bool    `json:"clearKey"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.ClearKey && input.ProviderKey != nil {
		fail(w, http.StatusBadRequest, "Choose either a new provider key or clearKey.")
		return
	}
	s.aiConfigMu.Lock()
	defer s.aiConfigMu.Unlock()
	config := normalizeAI(s.store.AIConfig())
	if input.ClearKey {
		config.Key = ""
		config.Enabled = false
	}
	if input.ProviderKey != nil {
		key := strings.TrimSpace(*input.ProviderKey)
		if key == "" || len(key) > 1024 || strings.ContainsAny(key, "\r\n\x00") {
			fail(w, http.StatusBadRequest, "Provide a valid provider key or use clearKey.")
			return
		}
		config.Key = key
	}
	if input.Model != nil {
		config.Model = *input.Model
	}
	if config.Model != "deepseek-flash" && config.Model != "deepseek-v4-pro" {
		fail(w, http.StatusBadRequest, "Choose deepseek-flash or deepseek-v4-pro.")
		return
	}
	if input.RedactIPs != nil {
		config.RedactIPs = *input.RedactIPs
	}
	if input.IncludePayloads != nil {
		config.IncludePayloads = *input.IncludePayloads
	}
	if input.Enabled != nil {
		config.Enabled = *input.Enabled
	}
	if config.Enabled && config.Key == "" {
		fail(w, http.StatusBadRequest, "Configure a provider key before enabling AI.")
		return
	}
	if err := s.update(identity(r).Actor, "ai.settings", func(state *model.State) error { state.AI = config; return nil }); err != nil {
		fail(w, http.StatusInternalServerError, "Could not persist AI settings.")
		return
	}
	writeJSON(w, http.StatusOK, aiSettings(config))
}

// reserveAI bounds work before copying evidence or opening a provider connection.
func (s *Server) reserveAI(actor string) bool {
	now := time.Now()
	s.aiMu.Lock()
	defer s.aiMu.Unlock()
	for key, window := range s.aiRates {
		if now.Sub(window.Start) >= time.Minute {
			delete(s.aiRates, key)
		}
	}
	window, exists := s.aiRates[actor]
	if !exists {
		if len(s.aiRates) >= 1024 {
			return false
		}
		window = rateWindow{Start: now}
	}
	global := s.aiGlobal
	if now.Sub(global.Start) >= time.Hour {
		global = rateWindow{Start: now}
	}
	if window.Count >= 5 || global.Count >= 30 {
		return false
	}
	select {
	case s.aiSlots <- struct{}{}:
	default:
		return false
	}
	window.Count++
	global.Count++
	s.aiRates[actor], s.aiGlobal = window, global
	return true
}

func (s *Server) aiAudit(actor, task, result string) error {
	err := s.store.Update(func(state *model.State) error { audit(state, actor, "ai."+task, result); return nil })
	if err == nil {
		s.broadcast()
	}
	return err
}

func severityRank(value string) int {
	switch value {
	case "critical":
		return 4
	case "high":
		return 3
	case "medium":
		return 2
	case "low":
		return 1
	default:
		return 0
	}
}

func selectedDay(events []model.Event, day string) ([]model.Event, int) {
	selected := []model.Event{}
	for _, event := range events {
		if dayOf(event.TS) == day {
			selected = append(selected, event)
		}
	}
	total := len(selected)
	slices.SortFunc(selected, func(a, b model.Event) int {
		if priority := cmp.Compare(severityRank(b.Severity), severityRank(a.Severity)); priority != 0 {
			return priority
		}
		if recency := cmp.Compare(b.TS, a.TS); recency != 0 {
			return recency
		}
		return cmp.Compare(a.ID, b.ID)
	})
	selected = selected[:min(len(selected), maxAIEvents)]
	slices.SortFunc(selected, func(a, b model.Event) int {
		if timestamp := cmp.Compare(a.TS, b.TS); timestamp != 0 {
			return timestamp
		}
		return cmp.Compare(a.ID, b.ID)
	})
	return selected, total
}

func (s *Server) analyze(w http.ResponseWriter, r *http.Request) {
	actor := identity(r)
	if !actor.Owner && !slices.Contains(actor.Scopes, "events:read") {
		fail(w, http.StatusForbidden, "AI analysis also requires events:read.")
		return
	}
	var input struct {
		Task    string `json:"task"`
		EventID string `json:"eventId"`
		Day     string `json:"day"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Task == "explain" {
		if input.EventID == "" || len(input.EventID) > 128 || input.Day != "" {
			fail(w, http.StatusBadRequest, "Explain requires one eventId and no day.")
			return
		}
	} else if input.Task == "digest" {
		if !validDay(input.Day) || input.EventID != "" {
			fail(w, http.StatusBadRequest, "Digest requires one UTC day and no eventId.")
			return
		}
	} else {
		fail(w, http.StatusBadRequest, "Choose the explain or digest task.")
		return
	}
	config := normalizeAI(s.store.AIConfig())
	if !config.Enabled || config.Key == "" {
		fail(w, http.StatusServiceUnavailable, "AI is disabled or its provider key is not configured.")
		return
	}
	select {
	case <-s.shutdown:
		fail(w, http.StatusServiceUnavailable, "The server is shutting down.")
		return
	default:
	}
	if !s.reserveAI(actor.Actor) {
		w.Header().Set("Retry-After", "60")
		fail(w, http.StatusTooManyRequests, "AI request or concurrency limit reached; retry later.")
		return
	}
	defer func() { <-s.aiSlots }()
	state := s.store.Snapshot()
	if state.Config.Mode == "" {
		fail(w, http.StatusServiceUnavailable, "The encrypted store is unavailable.")
		return
	}
	events := []model.Event{}
	total := 0
	if input.Task == "explain" {
		for _, event := range state.Events {
			if event.ID == input.EventID {
				events = append(events, event)
				break
			}
		}
		total = len(events)
	} else {
		events, total = selectedDay(state.Events, input.Day)
	}
	if len(events) == 0 {
		fail(w, http.StatusNotFound, "No retained evidence matches that reference.")
		return
	}
	if err := s.aiAudit(actor.Actor, input.Task, "requested"); err != nil {
		fail(w, http.StatusInternalServerError, "Could not persist the AI request audit.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	stopShutdown := context.AfterFunc(s.aiContext, cancel)
	defer stopShutdown()
	defer cancel()
	if s.aiContext.Err() != nil {
		cancel()
	}
	result, err := s.analyzerFactory(config.Key, config.Model).Analyze(ctx, intelligence.Input{Task: input.Task, Day: input.Day, Events: events, TotalEvents: total, RedactIPs: config.RedactIPs, IncludePayloads: config.IncludePayloads})
	if err == nil && ctx.Err() != nil {
		err = ctx.Err()
	}
	if err != nil {
		outcome := "failed"
		status, message := http.StatusBadGateway, "The provider could not return a valid analysis."
		switch {
		case errors.Is(ctx.Err(), context.DeadlineExceeded):
			outcome = "timeout"
			status, message = http.StatusGatewayTimeout, "AI analysis exceeded its time limit."
		case errors.Is(ctx.Err(), context.Canceled):
			outcome = "canceled"
			status, message = http.StatusRequestTimeout, "AI analysis was canceled."
		case errors.Is(err, intelligence.ErrUnavailable):
			status, message = http.StatusServiceUnavailable, "The AI provider is unavailable or unconfigured."
		case errors.Is(err, intelligence.ErrInvalidInput):
			status, message = http.StatusBadRequest, "The selected evidence exceeds supported analysis limits."
		case errors.Is(err, intelligence.ErrInvalidResponse):
			message = "The provider returned an invalid evidence-linked analysis."
		}
		var providerError *intelligence.ProviderError
		if errors.As(err, &providerError) {
			switch providerError.StatusCode {
			case http.StatusUnauthorized, http.StatusForbidden:
				message = "DeepSeek rejected the configured provider key or account access."
			case http.StatusPaymentRequired:
				status, message = http.StatusServiceUnavailable, "DeepSeek reported insufficient account balance."
			case http.StatusTooManyRequests:
				status, message = http.StatusTooManyRequests, "DeepSeek rate limit reached; retry later."
				w.Header().Set("Retry-After", "60")
			}
		}
		_ = s.aiAudit(actor.Actor, input.Task, outcome)
		fail(w, status, message)
		return
	}
	if err := s.aiAudit(actor.Actor, input.Task, "success"); err != nil {
		fail(w, http.StatusInternalServerError, "Could not persist the AI result audit.")
		return
	}
	if total > len(events) {
		result.Limitations = append(result.Limitations, "The server selected up to 80 events by severity, then recency, and supplied them in chronological order; this is not a complete day transcript.")
	}
	writeJSON(w, http.StatusOK, result)
}
