package server

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
	"time"

	"walkingdead/api"
	"walkingdead/internal/collector"
	"walkingdead/internal/detect"
	"walkingdead/internal/intelligence"
	"walkingdead/internal/model"
	"walkingdead/internal/vault"
)

const (
	maxEvents        = 10000
	maxAudits        = 1000
	maxNotifications = 300
	maxAPIBytes      = 1 << 20
)

type Options struct {
	WebFS          fs.FS
	AllowedOrigins []string
	Logger         *slog.Logger
}

type Server struct {
	metricsState    *operationMetrics
	logger          *slog.Logger
	startedAt       time.Time
	store           *vault.Store
	web             fs.FS
	origins         map[string]bool
	handler         http.Handler
	mu              sync.Mutex
	configMu        sync.Mutex
	collectors      map[string]collector.Sensor
	serviceErrors   map[string]string
	hooks           *webhookQueue
	lastError       string
	evidenceMu      sync.Mutex
	evidenceError   string
	eventSizes      map[string]int
	closed          bool
	authMu          sync.Mutex
	sessions        map[string]session
	loginRates      map[string]rateWindow
	globalLogins    rateWindow
	loginSlots      chan struct{}
	streamMu        sync.Mutex
	streams         map[chan struct{}]struct{}
	eventStreams    map[*eventSubscriber]struct{}
	version         int64
	shutdown        chan struct{}
	aiMu            sync.Mutex
	aiConfigMu      sync.Mutex
	aiRates         map[string]rateWindow
	aiGlobal        rateWindow
	aiSlots         chan struct{}
	aiContext       context.Context
	aiCancel        context.CancelFunc
	analyzerFactory func(string, string) analyzer
}

func New(store *vault.Store, options Options) (*Server, error) {
	if store == nil {
		return nil, errors.New("an unlocked vault is required")
	}
	s := &Server{store: store, web: options.WebFS, origins: map[string]bool{}, sessions: map[string]session{}, loginRates: map[string]rateWindow{}, loginSlots: make(chan struct{}, 2), streams: map[chan struct{}]struct{}{}, shutdown: make(chan struct{}), collectors: map[string]collector.Sensor{}, serviceErrors: map[string]string{}}
	s.hooks = newWebhookQueue(s)
	for _, origin := range options.AllowedOrigins {
		parsed, err := url.Parse(origin)
		if err != nil || !validDevelopmentOrigin(parsed) {
			return nil, errors.New("allowed origins must be explicit loopback HTTP(S) origins")
		}
		s.origins[origin] = true
	}
	s.aiRates = make(map[string]rateWindow)
	s.startedAt = time.Now()
	s.logger = options.Logger
	s.metricsState = newOperationMetrics(s)
	s.aiSlots = make(chan struct{}, 2)
	s.aiContext, s.aiCancel = context.WithCancel(context.Background())
	s.analyzerFactory = func(key, model string) analyzer { return intelligence.New(key, model) }
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/bootstrap", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"initialized": true})
	})
	mux.HandleFunc("POST /api/v1/auth/login", s.login)
	mux.HandleFunc("GET /api/v1/auth/session", s.protect("", s.currentSession))
	mux.HandleFunc("POST /api/v1/auth/logout", s.protect("", s.logout))
	mux.HandleFunc("GET /api/v1/system", s.protect("system:read", s.getSystem))
	mux.HandleFunc("GET /api/v1/health", s.protect("system:read", s.health))
	mux.HandleFunc("GET /api/v1/metrics", s.protect("system:read", s.metrics))
	mux.HandleFunc("GET /api/v1/openapi", s.protect("system:read", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(api.Document()))
	}))
	mux.HandleFunc("PUT /api/v1/system", s.protect("system:write", s.putSystem))
	mux.HandleFunc("GET /api/v1/keys", s.protect("keys:read", s.getKeys))
	mux.HandleFunc("POST /api/v1/keys", s.protect("keys:write", s.createKey))
	mux.HandleFunc("DELETE /api/v1/keys/{id}", s.protect("keys:write", s.revokeKey))
	mux.HandleFunc("GET /api/v1/logs/recent", s.protect("events:read", s.recentLogs))
	mux.HandleFunc("DELETE /api/v1/logs", s.protect("data:write", s.deleteLogs))
	mux.HandleFunc("GET /api/v1/days", s.protect("events:read", s.days))
	mux.HandleFunc("GET /api/v1/days/{day}/logs", s.protect("events:read", s.dayLogs))
	mux.HandleFunc("GET /api/v1/summaries", s.protect("events:read", s.getSummaries))
	mux.HandleFunc("PUT /api/v1/summaries", s.protect("data:write", s.putSummary))
	mux.HandleFunc("PUT /api/v1/days/{day}/summary", s.protect("data:write", s.putSummary))
	mux.HandleFunc("DELETE /api/v1/days/{day}/summary", s.protect("data:write", s.deleteSummary))
	mux.HandleFunc("GET /api/v1/notifications", s.protect("events:read", s.getNotifications))
	mux.HandleFunc("PUT /api/v1/notifications", s.protect("data:write", s.putNotifications))
	mux.HandleFunc("DELETE /api/v1/notifications", s.protect("data:write", s.deleteNotifications))
	mux.HandleFunc("POST /api/v1/notifications/read-all", s.protect("data:write", s.readNotifications))
	mux.HandleFunc("GET /api/v1/stats", s.protect("events:read", s.stats))
	mux.HandleFunc("GET /api/v1/export", s.protect("events:read", s.export))
	mux.HandleFunc("DELETE /api/v1/all", s.protect("data:write", s.clearAll))
	mux.HandleFunc("GET /api/v1/sessions", s.protect("events:read", s.getSessions))
	mux.HandleFunc("GET /api/v1/sessions/{id}", s.protect("events:read", s.getSession))
	mux.HandleFunc("GET /api/v1/audit", s.protect("system:read", s.getAudit))
	mux.HandleFunc("GET /api/v1/overview", s.protect("events:read", s.overview))
	mux.HandleFunc("GET /api/v1/events/stream", s.protect("events:read", s.eventStream))
	mux.HandleFunc("GET /api/v1/attackers", s.protect("events:read", s.getAttackers))
	mux.HandleFunc("GET /api/v1/attackers/{ip}", s.protect("events:read", s.getAttacker))
	mux.HandleFunc("GET /api/v1/intel", s.protect("events:read", s.getIntel))
	mux.HandleFunc("GET /api/v1/blocklist", s.protect("events:read", s.getBlocklist))
	mux.HandleFunc("POST /api/v1/blocklist", s.protect("data:write", s.postBlocklist))
	mux.HandleFunc("DELETE /api/v1/blocklist/{ip}", s.protect("data:write", s.deleteBlock))
	mux.HandleFunc("GET /api/v1/blocklist/export", s.protect("events:read", s.exportBlocklist))
	mux.HandleFunc("POST /api/v1/webhook/test", s.protect("system:write", s.testWebhook))
	mux.HandleFunc("GET /api/v1/stream", s.protect("events:read", s.stream))
	mux.HandleFunc("GET /api/v1/ai/settings", s.protect("ai:run", s.getAISettings))
	mux.HandleFunc("PUT /api/v1/ai/settings", s.protect("ai:run", s.putAISettings))
	mux.HandleFunc("POST /api/v1/ai", s.protect("ai:run", s.analyze))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, http.StatusNotFound, "API route not found.") })
	mux.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) { fail(w, http.StatusNotFound, "API route not found.") })
	mux.HandleFunc("/", s.static)
	s.handler = s.observe(s.middleware(mux))
	config := store.Config()
	if config.Running {
		if err := s.configure(config, "system", "system.resume"); err != nil && s.lastError == "" {
			s.lastError = err.Error()
		}
	}
	return s, nil
}

func (s *Server) Handler() http.Handler { return s.handler }

func (s *Server) Close(ctx context.Context) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	if s.aiCancel != nil {
		s.aiCancel()
	}
	close(s.shutdown)
	sensors := s.collectors
	s.collectors = map[string]collector.Sensor{}
	s.mu.Unlock()
	s.hooks.close()
	s.authMu.Lock()
	clear(s.sessions)
	s.authMu.Unlock()
	s.streamMu.Lock()
	for stream := range s.streams {
		close(stream)
		delete(s.streams, stream)
	}
	s.streamMu.Unlock()
	var errs []error
	for _, c := range sensors {
		errs = append(errs, c.Close(ctx))
	}
	return errors.Join(errs...)
}

func (s *Server) record(event model.Event) error {
	started := time.Now()
	detect.Analyze(&event)
	autoBlock := false
	err := s.store.Update(func(state *model.State) error {
		state.Events = append(state.Events, event)
		if state.Config.AutoBlock && detect.Rank(event.Severity) >= detect.Rank("high") {
			autoBlock = addBlock(state, event.SrcIP, "Automatic: "+event.Message, "auto")
		}
		return s.retainEvents(state)
	})
	s.metricsState.persistTime.Observe(time.Since(started).Seconds())
	if err == nil {
		s.metricsState.persisted.WithLabelValues(boundedMetric(event.Service, "http", "ssh", "telnet", "ftp", "redis", "mysql"), boundedMetric(event.Severity, "info", "low", "medium", "high", "critical")).Inc()
		s.evidenceMu.Lock()
		s.evidenceError = ""
		s.evidenceMu.Unlock()
		s.hooks.push(event, autoBlock)
		s.publish(event)
		s.broadcast()
	} else {
		s.metricsState.failures.Inc()
		s.evidenceMu.Lock()
		s.evidenceError = "Evidence could not be persisted; decoy requests receive HTTP 503. Check storage and restart after resolving the failure."
		s.evidenceMu.Unlock()
		s.broadcast()
	}
	return err
}

func audit(state *model.State, actor, action, result string) {
	state.Audits = append(state.Audits, model.Audit{ID: newID(), TS: time.Now().UnixMilli(), Actor: actor, Action: action, Result: result})
	if len(state.Audits) > maxAudits {
		state.Audits = append([]model.Audit{}, state.Audits[len(state.Audits)-maxAudits:]...)
	}
}

func (s *Server) update(actor, action string, apply func(*model.State) error) error {
	err := s.store.Update(func(state *model.State) error {
		if err := apply(state); err != nil {
			return err
		}
		audit(state, actor, action, "success")
		return nil
	})
	if err == nil {
		s.broadcast()
	}
	return err
}
