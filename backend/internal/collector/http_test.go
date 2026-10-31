package collector

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"walkingdead/internal/model"
)

func closeCollector(t *testing.T, c *HTTP) {
	t.Helper()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := c.Close(ctx); err != nil {
			t.Errorf("close collector: %v", err)
		}
	})
}

func TestCaptureAcknowledgedAndSessionsUseActualConnection(t *testing.T) {
	var mu sync.Mutex
	events := []model.Event{}
	c, err := Listen("127.0.0.1:0", "interactive", func(event model.Event) error {
		mu.Lock()
		defer mu.Unlock()
		events = append(events, event)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	closeCollector(t, c)
	transport := &http.Transport{}
	t.Cleanup(transport.CloseIdleConnections)
	client := &http.Client{Transport: transport, Timeout: 2 * time.Second}
	for _, target := range []string{"/.env", "/api/v1/system"} {
		req, _ := http.NewRequest(http.MethodGet, "http://"+c.Address()+target, nil)
		req.Header.Set("X-Forwarded-For", "203.0.113.77")
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != http.StatusOK || !strings.Contains(string(body), "Administration") {
			t.Fatalf("unexpected decoy response: %d %s", res.StatusCode, body)
		}
		mu.Lock()
		count := len(events)
		mu.Unlock()
		if count == 0 {
			t.Fatal("success was returned before evidence was recorded")
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if len(events) != 2 || events[0].SessionID == "" || events[0].SessionID != events[1].SessionID {
		t.Fatalf("expected connection-bound session IDs: %+v", events)
	}
	if events[0].SrcIP != "127.0.0.1" || events[0].Type != "connection" || events[0].Severity != "info" {
		t.Fatalf("collector must record the raw observation; classification happens server-side: %+v", events[0])
	}
}

func TestRecorderFailureAndCaptureLimits(t *testing.T) {
	c, err := Listen("127.0.0.1:0", "passive", func(model.Event) error { return errors.New("disk unavailable") })
	if err != nil {
		t.Fatal(err)
	}
	closeCollector(t, c)
	res, err := http.Get("http://" + c.Address() + "/")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("unrecorded request acknowledged with %d", res.StatusCode)
	}
	var captured model.Event
	c2, err := Listen("127.0.0.1:0", "passive", func(event model.Event) error { captured = event; return nil })
	if err != nil {
		t.Fatal(err)
	}
	closeCollector(t, c2)
	res, err = http.Post("http://"+c2.Address()+"/login", "text/plain", strings.NewReader("hello\x00\x1b"+strings.Repeat("x", maxBody)))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized body returned %d", res.StatusCode)
	}
	if len(captured.Payload) > 4099 || strings.ContainsAny(captured.Payload, "\x00\x1b") {
		t.Fatalf("capture was not bounded and sanitized: %d bytes", len(captured.Payload))
	}
}

func TestTarpitIsBounded(t *testing.T) {
	c, err := Listen("127.0.0.1:0", "tarpit", func(model.Event) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	closeCollector(t, c)
	client := &http.Client{Timeout: 2 * time.Second}
	start := time.Now()
	res, err := client.Get("http://" + c.Address() + "/")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if elapsed := time.Since(start); elapsed < 200*time.Millisecond || elapsed > 1500*time.Millisecond {
		t.Fatalf("unexpected tarpit delay: %v", elapsed)
	}
}
