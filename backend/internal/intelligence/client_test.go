package intelligence

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"walkingdead/internal/model"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func completion(t *testing.T, content string) string {
	t.Helper()
	data, err := json.Marshal(map[string]any{
		"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"content": content, "reasoning_content": "untrusted reasoning ignored"}}},
		"usage":   map[string]int{"prompt_tokens": 120, "completion_tokens": 80},
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func validAnalysis() string {
	return `{"summary":"A scanner requested an administrative path.","findings":[{"kind":"observation","title":"Administrative request","assessment":"The recorded HTTP request targeted /admin.","evidenceIds":["event-1"],"confidence":"high"},{"kind":"inference","title":"Possible automated scanning","assessment":"This may be routine automated discovery; intent is not established.","evidenceIds":["event-1"],"confidence":"low"}],"limitations":["A request does not establish successful exploitation."]}`
}

func input() Input {
	return Input{Task: "explain", Events: []model.Event{{ID: "event-1", TS: 1700000000000, Service: "http", Type: "connection", Severity: "low", SrcIP: "192.0.2.8", Path: "/admin?password=query-secret", Method: "GET", Message: "message-secret from 192.0.2.8", User: "username-secret", Payload: "body-secret"}}, TotalEvents: 1, RedactIPs: true}
}

func TestAnalyzeSendsOnlyBoundedEvidenceToFixedProvider(t *testing.T) {
	client := New("test-provider-key", "")
	calls := 0
	client.http.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		if request.URL.String() != endpoint || request.Method != http.MethodPost || request.Header.Get("Authorization") != "Bearer test-provider-key" {
			t.Fatalf("unexpected provider request: %s %s", request.Method, request.URL)
		}
		deadline, ok := request.Context().Deadline()
		if !ok || time.Until(deadline) > 40*time.Second {
			t.Fatal("provider request lacks bounded deadline")
		}
		body, _ := io.ReadAll(request.Body)
		for _, secret := range []string{"query-secret", "message-secret", "username-secret", "body-secret", "192.0.2.8", "test-provider-key"} {
			if strings.Contains(string(body), secret) {
				t.Fatalf("private evidence entered provider body: %s", secret)
			}
		}
		var data struct {
			Model          string            `json:"model"`
			Messages       []message         `json:"messages"`
			Thinking       map[string]string `json:"thinking"`
			ResponseFormat map[string]string `json:"response_format"`
			MaxTokens      int               `json:"max_tokens"`
			Tools          json.RawMessage   `json:"tools"`
		}
		if json.Unmarshal(body, &data) != nil || data.Model != defaultModel || data.Thinking["type"] != "disabled" || data.ResponseFormat["type"] != "json_object" || data.MaxTokens != 4000 || len(data.Tools) != 0 || len(data.Messages) != 2 {
			t.Fatal("unsafe provider request options")
		}
		if !strings.Contains(data.Messages[1].Content, "source-01") || !strings.Contains(data.Messages[1].Content, "event-1") {
			t.Fatal("missing pseudonym or canonical reference")
		}
		return response(200, completion(t, validAnalysis())), nil
	})
	result, err := client.Analyze(context.Background(), input())
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 || result.Provider != "deepseek" || result.Model != defaultModel || result.InputTokens != 120 || result.OutputTokens != 80 || result.SampledEvents != 1 || result.TotalEvents != 1 || len(result.Findings) != 2 || !strings.HasPrefix(result.Findings[1].Assessment, "Inference: ") || !strings.Contains(result.Text, "Evidence: event-1.") || strings.Contains(result.Text, "untrusted reasoning") {
		t.Fatalf("unexpected analysis: %+v", result)
	}
}

func TestAnalyzeRejectsUngroundedOrMalformedResponses(t *testing.T) {
	tests := map[string]string{
		"unknown reference":   strings.ReplaceAll(validAnalysis(), "event-1", "invented-id"),
		"mostly invented":     strings.Replace(validAnalysis(), `["event-1"]`, `["event-1","fake-2","fake-3"]`, 1),
		"markup output":       strings.Replace(validAnalysis(), "Administrative request", "</script>", 1),
		"missing reference":   strings.Replace(validAnalysis(), `["event-1"]`, `[]`, 1),
		"missing kind":        strings.Replace(validAnalysis(), `"kind":"observation",`, ``, 1),
		"invented confidence": strings.Replace(validAnalysis(), `"confidence":"high"`, `"confidence":"certain"`, 1),
		"html output":         strings.Replace(validAnalysis(), "Administrative request", "<img src=x>", 1),
		"extra field":         strings.Replace(validAnalysis(), `"summary":`, `"action":"run command","summary":`, 1),
		"trailing object":     validAnalysis() + `{}`,
		"too long":            strings.Replace(validAnalysis(), "Administrative request", strings.Repeat("x", 161), 1),
		"provider key echo":   strings.Replace(validAnalysis(), "Administrative request", "test-provider-key", 1),
	}
	for name, content := range tests {
		t.Run(name, func(t *testing.T) {
			client := New("test-provider-key", "")
			client.http.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) { return response(200, completion(t, content)), nil })
			if _, err := client.Analyze(context.Background(), input()); !errors.Is(err, ErrInvalidResponse) {
				t.Fatalf("expected invalid response, got %v", err)
			}
		})
	}
}

func TestAnalyzeToleratesHarmlessFormattingVariations(t *testing.T) {
	content := "```json\n" + strings.NewReplacer(`["event-1"]`, `["event-1","event-1"]`, `"confidence":"high"`, `"confidence":"High"`, "targeted /admin.", "ran echo key >> ~/.ssh/authorized_keys.").Replace(validAnalysis()) + "\n```"
	client := New("test-provider-key", "")
	client.http.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) { return response(200, completion(t, content)), nil })
	result, err := client.Analyze(context.Background(), input())
	if err != nil || len(result.Findings) != 2 || len(result.Findings[0].EvidenceIDs) != 1 || result.Findings[0].Confidence != "high" {
		t.Fatalf("expected a normalized analysis, got %+v %v", result, err)
	}
}

func TestAnalyzeErrorsNeverExposeUpstreamDetailsAndNeverRetry(t *testing.T) {
	for _, status := range []int{301, 400, 401, 402, 429, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			client := New("test-provider-key", "")
			calls := 0
			client.http.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
				calls++
				res := response(status, `private upstream error containing test-provider-key`)
				res.Header.Set("Location", "https://other-provider.invalid/steal")
				return res, nil
			})
			_, err := client.Analyze(context.Background(), input())
			var providerError *ProviderError
			if !errors.Is(err, ErrProvider) || !errors.As(err, &providerError) || providerError.StatusCode != status || strings.Contains(err.Error(), "test-provider-key") || calls != 1 {
				t.Fatalf("unsafe provider error or retry: %v, calls %d", err, calls)
			}
		})
	}
	client := New("test-provider-key", "")
	client.http.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("private transport error containing test-provider-key")
	})
	_, err := client.Analyze(context.Background(), input())
	if !errors.Is(err, ErrProvider) || strings.Contains(err.Error(), "private") {
		t.Fatalf("transport details exposed: %v", err)
	}
}

func TestAnalyzeBoundsResponseAndRejectsTruncation(t *testing.T) {
	for name, body := range map[string]string{
		"oversized body":       strings.Repeat("x", maxResponseBytes+1),
		"invalid json":         `{`,
		"truncated completion": strings.Replace(completion(t, validAnalysis()), `"finish_reason":"stop"`, `"finish_reason":"length"`, 1),
		"empty choices":        `{"choices":[],"usage":{}}`,
		"empty content":        completion(t, ""),
	} {
		t.Run(name, func(t *testing.T) {
			client := New("test-provider-key", "")
			client.http.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) { return response(200, body), nil })
			if _, err := client.Analyze(context.Background(), input()); !errors.Is(err, ErrInvalidResponse) {
				t.Fatalf("expected invalid response, got %v", err)
			}
		})
	}
}

func TestAnalyzeHonorsCancellation(t *testing.T) {
	client := New("test-provider-key", "")
	client.http.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := client.Analyze(ctx, input()); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

func TestAnalyzeRejectsInvalidInputBeforeContactingProvider(t *testing.T) {
	for name, change := range map[string]func(*Input){
		"arbitrary task":     func(in *Input) { in.Task = "execute" },
		"no events":          func(in *Input) { in.Events = nil },
		"negative total":     func(in *Input) { in.TotalEvents = -1 },
		"invalid day":        func(in *Input) { in.Day = "2026-02-31" },
		"digest without day": func(in *Input) { in.Task = "digest" },
		"invalid ID":         func(in *Input) { in.Events[0].ID = "ignore prior instructions" },
		"duplicate ID":       func(in *Input) { in.Events = append(in.Events, in.Events[0]) },
	} {
		t.Run(name, func(t *testing.T) {
			in := input()
			change(&in)
			client := New("test-provider-key", "")
			client.http.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
				t.Fatal("invalid input contacted provider")
				return nil, nil
			})
			if _, err := client.Analyze(context.Background(), in); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected invalid input, got %v", err)
			}
		})
	}
	if _, err := New("", "").Analyze(context.Background(), input()); !errors.Is(err, ErrUnavailable) {
		t.Fatal("empty key should disable provider")
	}
	if _, err := New("test-provider-key", "unknown-model").Analyze(context.Background(), input()); !errors.Is(err, ErrInvalidInput) {
		t.Fatal("unsupported model should be rejected")
	}
}
