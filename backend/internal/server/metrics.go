package server

import (
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/felixge/httpsnoop"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type operationMetrics struct {
	handler     http.Handler
	registry    *prometheus.Registry
	requests    *prometheus.CounterVec
	duration    *prometheus.HistogramVec
	persisted   *prometheus.CounterVec
	failures    prometheus.Counter
	persistTime prometheus.Histogram
}

func newOperationMetrics(s *Server) *operationMetrics {
	m := &operationMetrics{
		registry:    prometheus.NewRegistry(),
		requests:    prometheus.NewCounterVec(prometheus.CounterOpts{Name: "walkingdead_management_requests_total", Help: "Completed management requests by bounded route, method and status."}, []string{"route", "method", "code"}),
		duration:    prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "walkingdead_management_request_duration_seconds", Help: "Completed non-stream management request duration."}, []string{"route", "method"}),
		persisted:   prometheus.NewCounterVec(prometheus.CounterOpts{Name: "walkingdead_events_persisted_total", Help: "Successfully persisted observations since process start."}, []string{"service", "severity"}),
		failures:    prometheus.NewCounter(prometheus.CounterOpts{Name: "walkingdead_capture_failures_total", Help: "Observations that could not be durably persisted."}),
		persistTime: prometheus.NewHistogram(prometheus.HistogramOpts{Name: "walkingdead_capture_persist_duration_seconds", Help: "Observation persistence duration including lock contention."}),
	}
	m.registry.MustRegister(m.requests, m.duration, m.persisted, m.failures, m.persistTime, collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{Namespace: "walkingdead"}))
	m.registry.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{Name: "walkingdead_storage_available", Help: "Whether the encrypted store is unlocked and healthy."}, func() float64 {
		if s.store.Available() {
			return 1
		}
		return 0
	}))
	m.registry.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{Name: "walkingdead_retained_events", Help: "Currently retained observations, bounded by retention."}, func() float64 { return float64(len(s.store.Snapshot().Events)) }))
	m.registry.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{Name: "walkingdead_http_collector_up", Help: "Whether the managed HTTP collector is running."}, func() float64 {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.running() {
			return 1
		}
		return 0
	}))
	m.handler = promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{EnableOpenMetrics: true, MaxRequestsInFlight: 2, Timeout: 10 * time.Second})
	return m
}

func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	s.metricsState.handler.ServeHTTP(w, r)
}

func boundedMetric(value string, allowed ...string) string {
	if slices.Contains(allowed, value) {
		return value
	}
	return "other"
}

func (s *Server) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		requestID := newID()
		w.Header().Set("X-Request-ID", requestID)
		captured := httpsnoop.CaptureMetrics(next, w, r)
		route := r.Pattern
		if route == "" || route == "/api/" {
			route = "unmatched"
		}
		method := boundedMetric(r.Method, "GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS")
		s.metricsState.requests.WithLabelValues(route, method, strconv.Itoa(captured.Code)).Inc()
		if route != "GET /api/v1/stream" {
			s.metricsState.duration.WithLabelValues(route, method).Observe(captured.Duration.Seconds())
		}
		if s.logger != nil && captured.Code >= 500 {
			s.logger.Log(r.Context(), slog.LevelWarn, "management request failed", "request_id", requestID, "route", route, "method", method, "status", captured.Code, "duration_seconds", captured.Duration.Seconds())
		}
	})
}
