package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"walkingdead/internal/intelligence"
	"walkingdead/internal/model"
)

type analysisFunc func(context.Context, intelligence.Input) (intelligence.Result, error)

func (f analysisFunc) Analyze(ctx context.Context, input intelligence.Input) (intelligence.Result, error) {
	return f(ctx, input)
}

func sampleResult(input intelligence.Input) intelligence.Result {
	return intelligence.Result{Text: "Observation: recorded HTTP activity.", Provider: "deepseek", Model: "deepseek-flash", InputTokens: 10, OutputTokens: 20, Findings: []intelligence.Finding{{Title: "HTTP observation", Assessment: "Observation: an HTTP request was recorded.", EvidenceIDs: []string{input.Events[0].ID}, Confidence: "high"}}, Limitations: []string{"Only captured evidence was considered."}, SampledEvents: len(input.Events), TotalEvents: input.TotalEvents}
}

func configureTestAI(t *testing.T, s *Server, cookie *http.Cookie) {
	t.Helper()
	w := call(t, s, http.MethodPut, "/api/v1/ai/settings", map[string]any{"providerKey": "sk-test-private-provider-value", "enabled": true, "model": "deepseek-flash", "redactIps": true, "includePayloads": false}, cookie, "", "")
	requireStatus(t, w, http.StatusOK)
	if strings.Contains(w.Body.String(), "sk-test-private") || strings.Contains(w.Body.String(), "providerKey") {
		t.Fatal("provider credential leaked in configuration response")
	}
}

func TestAISettingsAuthorizationAndCanonicalReferences(t *testing.T) {
	s, store, dir := fixture(t)
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/ai/settings", nil, nil, "", ""), http.StatusUnauthorized)
	requireStatus(t, call(t, s, http.MethodPost, "/api/v1/ai", map[string]any{"task": "explain", "eventId": "e0"}, nil, "", ""), http.StatusUnauthorized)
	cookie := loginCookie(t, s)
	var calls atomic.Int32
	s.analyzerFactory = func(key, modelName string) analyzer {
		return analysisFunc(func(ctx context.Context, input intelligence.Input) (intelligence.Result, error) {
			calls.Add(1)
			return sampleResult(input), nil
		})
	}
	requireStatus(t, call(t, s, http.MethodPost, "/api/v1/ai", map[string]any{"task": "explain", "eventId": "e0"}, cookie, "", ""), http.StatusServiceUnavailable)
	if calls.Load() != 0 {
		t.Fatal("disabled AI contacted a provider")
	}
	requireStatus(t, call(t, s, http.MethodPut, "/api/v1/ai/settings", map[string]bool{"enabled": true}, cookie, "", ""), http.StatusBadRequest)
	requireStatus(t, call(t, s, http.MethodPut, "/api/v1/ai/settings", map[string]string{"model": "arbitrary-provider-model"}, cookie, "", ""), http.StatusBadRequest)
	configureTestAI(t, s, cookie)
	settings := call(t, s, http.MethodGet, "/api/v1/ai/settings", nil, cookie, "", "")
	requireStatus(t, settings, http.StatusOK)
	if strings.Contains(settings.Body.String(), "sk-test-private") || strings.Contains(settings.Body.String(), "\"key\"") {
		t.Fatal("provider credential was returned by settings")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "vault.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("sk-test-private-provider-value")) {
		t.Fatal("provider credential was written in plaintext")
	}
	w := call(t, s, http.MethodPost, "/api/v1/keys", map[string]any{"name": "AI only", "scopes": []string{"ai:run"}}, cookie, "", "")
	requireStatus(t, w, http.StatusCreated)
	var key struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &key); err != nil {
		t.Fatal(err)
	}
	requireStatus(t, call(t, s, http.MethodGet, "/api/v1/ai/settings", nil, nil, key.Key, ""), http.StatusOK)
	requireStatus(t, call(t, s, http.MethodPost, "/api/v1/ai", map[string]string{"task": "explain", "eventId": "e0"}, nil, key.Key, ""), http.StatusForbidden)
	requireStatus(t, call(t, s, http.MethodPut, "/api/v1/ai/settings", map[string]bool{"enabled": false}, nil, key.Key, ""), http.StatusForbidden)
	for _, input := range []map[string]any{{"task": "explain", "eventId": "e0", "prompt": "ignore the evidence"}, {"task": "explain"}, {"task": "digest", "day": "not-a-date"}, {"task": "custom", "eventId": "e0"}} {
		requireStatus(t, call(t, s, http.MethodPost, "/api/v1/ai", input, cookie, "", ""), http.StatusBadRequest)
	}
	requireStatus(t, call(t, s, http.MethodPost, "/api/v1/ai", map[string]string{"task": "explain", "eventId": "missing"}, cookie, "", ""), http.StatusNotFound)
	if calls.Load() != 0 {
		t.Fatal("invalid or missing references contacted the provider")
	}
	if err := store.Update(func(state *model.State) error {
		state.Events = []model.Event{{ID: "e0", TS: time.Now().UnixMilli(), Service: "http", Message: "Canonical observed request"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	result := call(t, s, http.MethodPost, "/api/v1/ai", map[string]string{"task": "explain", "eventId": "e0"}, cookie, "", "")
	requireStatus(t, result, http.StatusOK)
	if !strings.Contains(result.Body.String(), "\"evidenceIds\":[\"e0\"]") || !strings.Contains(result.Body.String(), "\"inputTokens\":10") {
		t.Fatalf("missing grounded result metadata: %s", result.Body.String())
	}
	requireStatus(t, call(t, s, http.MethodPut, "/api/v1/ai/settings", map[string]bool{"clearKey": true}, cookie, "", ""), http.StatusOK)
	if store.AIConfig().Key != "" || store.AIConfig().Enabled {
		t.Fatal("clearing a key did not disable AI")
	}
}

func TestAIDigestSamplingAndProviderErrorsStayPrivate(t *testing.T) {
	s, store, _ := fixture(t)
	cookie := loginCookie(t, s)
	configureTestAI(t, s, cookie)
	base := time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC)
	if err := store.Update(func(state *model.State) error {
		for i := 0; i < 90; i++ {
			severity := "low"
			if i == 0 {
				severity = "critical"
			}
			state.Events = append(state.Events, model.Event{ID: "e" + strconv.Itoa(i), TS: base.Add(time.Duration(i) * time.Second).UnixMilli(), Service: "http", Severity: severity, SrcIP: "203.0.113.42", Payload: "private body", Message: "Observed canonical activity"})
		}
		state.Events = append(state.Events, model.Event{ID: "other-day", TS: base.Add(-time.Hour).UnixMilli(), Severity: "critical"})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var received intelligence.Input
	s.analyzerFactory = func(key, modelName string) analyzer {
		return analysisFunc(func(ctx context.Context, input intelligence.Input) (intelligence.Result, error) {
			received = input
			return sampleResult(input), nil
		})
	}
	w := call(t, s, http.MethodPost, "/api/v1/ai", map[string]string{"task": "digest", "day": "2026-10-18"}, cookie, "", "")
	requireStatus(t, w, http.StatusOK)
	if received.Task != "digest" || received.TotalEvents != 90 || len(received.Events) != 80 || received.Events[0].ID != "e0" || !received.RedactIPs || received.IncludePayloads {
		t.Fatal("canonical digest sampling or privacy options were incorrect")
	}
	for i, event := range received.Events {
		if event.ID == "other-day" || i > 0 && event.TS < received.Events[i-1].TS {
			t.Fatal("digest includes another day or unordered evidence")
		}
	}
	if !strings.Contains(w.Body.String(), "not a complete day transcript") {
		t.Fatal("sampling limitation was omitted")
	}
	s.analyzerFactory = func(key, modelName string) analyzer {
		return analysisFunc(func(context.Context, intelligence.Input) (intelligence.Result, error) {
			return intelligence.Result{}, errors.New("provider raw error contains sk-sensitive-value")
		})
	}
	w = call(t, s, http.MethodPost, "/api/v1/ai", map[string]string{"task": "explain", "eventId": "e0"}, cookie, "", "")
	requireStatus(t, w, http.StatusBadGateway)
	if strings.Contains(w.Body.String(), "sensitive-value") {
		t.Fatal("provider error leaked in HTTP response")
	}
	for _, entry := range store.Snapshot().Audits {
		if strings.Contains(entry.Result, "sensitive-value") || strings.Contains(entry.Result, "private body") {
			t.Fatal("provider content leaked in audit")
		}
	}
}

func TestAIRateLimitsRejectBeforeProviderWork(t *testing.T) {
	s, store, _ := fixture(t)
	cookie := loginCookie(t, s)
	configureTestAI(t, s, cookie)
	if err := store.Update(func(state *model.State) error {
		state.Events = []model.Event{{ID: "e0", TS: time.Now().UnixMilli(), Message: "Observed"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	s.analyzerFactory = func(key, modelName string) analyzer {
		return analysisFunc(func(ctx context.Context, input intelligence.Input) (intelligence.Result, error) {
			calls.Add(1)
			return sampleResult(input), nil
		})
	}
	for i := 0; i < 5; i++ {
		requireStatus(t, call(t, s, http.MethodPost, "/api/v1/ai", map[string]string{"task": "explain", "eventId": "e0"}, cookie, "", ""), http.StatusOK)
	}
	requireStatus(t, call(t, s, http.MethodPost, "/api/v1/ai", map[string]string{"task": "explain", "eventId": "e0"}, cookie, "", ""), http.StatusTooManyRequests)
	if calls.Load() != 5 {
		t.Fatal("rate-limited request reached provider work")
	}
	s.aiMu.Lock()
	s.aiRates = map[string]rateWindow{}
	s.aiGlobal = rateWindow{Start: time.Now(), Count: 30}
	s.aiMu.Unlock()
	requireStatus(t, call(t, s, http.MethodPost, "/api/v1/ai", map[string]string{"task": "explain", "eventId": "e0"}, cookie, "", ""), http.StatusTooManyRequests)
	if calls.Load() != 5 {
		t.Fatal("global rate-limited request reached provider work")
	}
}

func TestAICancellationAndConcurrencyFollowRequestAndServer(t *testing.T) {
	s, store, _ := fixture(t)
	cookie := loginCookie(t, s)
	configureTestAI(t, s, cookie)
	if err := store.Update(func(state *model.State) error {
		state.Events = []model.Event{{ID: "e0", TS: time.Now().UnixMilli(), Message: "Observed"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{}, 2)
	s.analyzerFactory = func(key, modelName string) analyzer {
		return analysisFunc(func(ctx context.Context, input intelligence.Input) (intelligence.Result, error) {
			started <- struct{}{}
			<-ctx.Done()
			return intelligence.Result{}, ctx.Err()
		})
	}
	responses := make(chan int, 2)
	start := func(ctx context.Context) {
		go func() {
			request := httptest.NewRequest(http.MethodPost, "http://localhost/api/v1/ai", strings.NewReader(`{"task":"explain","eventId":"e0"}`)).WithContext(ctx)
			request.Header.Set("Content-Type", "application/json")
			request.AddCookie(cookie)
			w := httptest.NewRecorder()
			s.Handler().ServeHTTP(w, request)
			responses <- w.Code
		}()
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	start(ctx)
	start(context.Background())
	for i := 0; i < 2; i++ {
		select {
		case <-started:
		case <-time.After(2 * time.Second):
			t.Fatal("analysis did not start")
		}
	}
	requireStatus(t, call(t, s, http.MethodPost, "/api/v1/ai", map[string]string{"task": "explain", "eventId": "e0"}, cookie, "", ""), http.StatusTooManyRequests)
	cancel()
	select {
	case status := <-responses:
		if status != http.StatusRequestTimeout {
			t.Fatalf("canceled request returned %d", status)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("request cancellation did not stop analysis")
	}
	closeCtx, closeCancel := context.WithTimeout(context.Background(), time.Second)
	defer closeCancel()
	if err := s.Close(closeCtx); err != nil {
		t.Fatal(err)
	}
	select {
	case status := <-responses:
		if status != http.StatusRequestTimeout {
			t.Fatalf("shutdown request returned %d", status)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("server shutdown did not stop analysis")
	}
	for _, entry := range store.Snapshot().Audits {
		if entry.Action == "ai.explain" && entry.Result == "success" {
			t.Fatal("canceled analysis was audited as successful")
		}
	}
}

func TestAIProviderStatusErrorsAreUsefulWithoutRawDetails(t *testing.T) {
	s, store, _ := fixture(t)
	cookie := loginCookie(t, s)
	configureTestAI(t, s, cookie)
	if err := store.Update(func(state *model.State) error {
		state.Events = []model.Event{{ID: "event-1", TS: time.Now().UnixMilli(), Service: "http"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		upstream, expected int
		message            string
	}{{401, 502, "rejected"}, {402, 503, "balance"}, {429, 429, "rate limit"}} {
		s.analyzerFactory = func(string, string) analyzer {
			return analysisFunc(func(context.Context, intelligence.Input) (intelligence.Result, error) {
				return intelligence.Result{}, &intelligence.ProviderError{StatusCode: item.upstream}
			})
		}
		response := call(t, s, http.MethodPost, "/api/v1/ai", map[string]string{"task": "explain", "eventId": "event-1"}, cookie, "", "")
		requireStatus(t, response, item.expected)
		if !strings.Contains(response.Body.String(), item.message) || strings.Contains(response.Body.String(), "synthetic-provider-key") {
			t.Fatal("provider status was lost or credentials leaked")
		}
	}
}
