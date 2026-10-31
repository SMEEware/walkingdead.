package collector

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode"

	"walkingdead/internal/model"
)

const maxBody = 16 << 10

type sessionKey struct{}

type HTTP struct {
	server      *http.Server
	listener    net.Listener
	mode        string
	record      func(model.Event) error
	slots       chan struct{}
	done        chan struct{}
	mu          sync.Mutex
	err         error
	connections map[net.Conn]struct{}
}

func Listen(address, mode string, record func(model.Event) error) (*HTTP, error) {
	if record == nil {
		return nil, errors.New("an evidence recorder is required")
	}
	if mode != "passive" && mode != "interactive" && mode != "tarpit" {
		return nil, errors.New("unsupported HTTP profile")
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return nil, fmt.Errorf("bind HTTP decoy: %w", err)
	}
	c := &HTTP{listener: listener, mode: mode, record: record, slots: make(chan struct{}, 32), done: make(chan struct{}), connections: make(map[net.Conn]struct{})}
	c.server = &http.Server{
		Handler:           http.HandlerFunc(c.serveHTTP),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       8 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       15 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ConnContext: func(ctx context.Context, _ net.Conn) context.Context {
			return context.WithValue(ctx, sessionKey{}, randomID())
		},
		ConnState: func(connection net.Conn, state http.ConnState) {
			c.mu.Lock()
			closeConnection := false
			if state == http.StateNew {
				if len(c.connections) >= 128 {
					closeConnection = true
				} else {
					c.connections[connection] = struct{}{}
				}
			}
			if state == http.StateClosed || state == http.StateHijacked {
				delete(c.connections, connection)
			}
			c.mu.Unlock()
			if closeConnection {
				_ = connection.Close()
			}
		},
	}
	go func() {
		err := c.server.Serve(listener)
		c.mu.Lock()
		if !errors.Is(err, http.ErrServerClosed) {
			c.err = err
		}
		c.mu.Unlock()
		close(c.done)
	}()
	return c, nil
}

func (c *HTTP) Address() string       { return c.listener.Addr().String() }
func (c *HTTP) Done() <-chan struct{} { return c.done }
func (c *HTTP) Err() error            { c.mu.Lock(); defer c.mu.Unlock(); return c.err }

func (c *HTTP) Close(ctx context.Context) error {
	err := c.server.Shutdown(ctx)
	if err != nil {
		_ = c.server.Close()
	}
	return err
}

func (c *HTTP) serveHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	select {
	case c.slots <- struct{}{}:
		defer func() { <-c.slots }()
	default:
		http.Error(w, "Service unavailable", http.StatusServiceUnavailable)
		return
	}
	body, readErr := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	tooLarge := len(body) > maxBody
	if tooLarge {
		body = body[:maxBody]
	}
	if readErr != nil {
		body = nil
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	session, _ := r.Context().Value(sessionKey{}).(string)
	if session == "" {
		session = randomID()
	}
	requestPath := sanitize(r.URL.RequestURI(), 1024)
	event := model.Event{
		ID: randomID(), TS: time.Now().UnixMilli(), Service: "http", Type: "connection", Severity: "info",
		SrcIP: ip, Country: "Unknown", SessionID: session, SensorID: "local-http",
		Method: sanitize(r.Method, 32), Path: requestPath,
		Message:   fmt.Sprintf("Observed HTTP %s %s", sanitize(r.Method, 32), requestPath),
		Payload:   sanitize(string(body), 4096),
		UserAgent: sanitize(r.UserAgent(), 512),
	}
	if values, err := url.ParseQuery(string(body)); err == nil && r.Method == http.MethodPost {
		for _, k := range []string{"username", "user", "login", "email", "log", "uname"} {
			if v := values.Get(k); v != "" {
				event.User = sanitize(v, 128)
				break
			}
		}
		for _, k := range []string{"password", "pass", "passwd", "pwd", "pw"} {
			if v := values.Get(k); v != "" {
				event.Password = sanitize(v, 128)
				break
			}
		}
	}
	lowerPath := strings.ToLower(r.URL.Path)
	if r.Method == http.MethodPost && (strings.Contains(lowerPath, "login") || strings.Contains(lowerPath, "auth")) {
		event.Message = "Observed HTTP login submission: " + requestPath
	}
	if tooLarge {
		event.Message += " (request body exceeded capture limit)"
	}
	if readErr != nil {
		event.Message += " (request body could not be read)"
	}
	if err := c.record(event); err != nil {
		http.Error(w, "Service unavailable", http.StatusServiceUnavailable)
		return
	}
	if tooLarge {
		http.Error(w, "Request too large", http.StatusRequestEntityTooLarge)
		return
	}
	if readErr != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if c.mode == "tarpit" {
		timer := time.NewTimer(250 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-r.Context().Done():
			return
		}
	}
	if c.mode == "interactive" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, "<!doctype html><title>Administration</title><h1>Sign in</h1><p>Invalid credentials.</p>")
			return
		}
		_, _ = io.WriteString(w, "<!doctype html><title>Administration</title><h1>Administration</h1><form method=post action=/login><label>User <input name=username autocomplete=off></label><label>Password <input name=password type=password autocomplete=off></label><button>Sign in</button></form>")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, "Service available\n")
}

func sanitize(value string, limit int) string {
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, value)
	if len(value) > limit {
		value = value[:limit]
		return strings.ToValidUTF8(value, "") + "…"
	}
	return value
}

func randomID() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		panic("cryptographic randomness unavailable")
	}
	return hex.EncodeToString(bytes[:])
}
