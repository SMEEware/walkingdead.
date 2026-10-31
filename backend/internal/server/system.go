package server

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"time"

	"walkingdead/internal/collector"
	"walkingdead/internal/model"
)

var serviceNames = map[string]string{"http": "HTTP", "ssh": "SSH", "telnet": "Telnet", "ftp": "FTP", "redis": "Redis", "mysql": "MySQL"}

func allServices() []string { return append([]string{"http"}, model.DecoyIDs...) }

func validAddress(label, address string) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil || net.ParseIP(host) == nil {
		return fmt.Errorf("%s address must use a literal IP and port, such as 127.0.0.1:8088.", label)
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 0 || number > 65535 {
		return fmt.Errorf("%s port must be between 0 and 65535.", label)
	}
	return nil
}

func validateConfig(config model.Config) error {
	if config.Mode != "passive" && config.Mode != "interactive" && config.Mode != "tarpit" {
		return errors.New("Mode must be passive, interactive, or tarpit.")
	}
	if err := validAddress("HTTP", config.HTTPAddress); err != nil {
		return err
	}
	enabled := config.HTTPEnabled
	for id, decoy := range config.Decoys {
		if _, ok := model.DecoyDefaults[id]; !ok {
			return fmt.Errorf("Unknown decoy service %q.", id)
		}
		if err := validAddress(serviceNames[id], decoy.Address); err != nil {
			return err
		}
		enabled = enabled || decoy.Enabled
	}
	if config.Running && !enabled {
		return errors.New("Enable at least one decoy service before starting.")
	}
	hook := config.Webhook
	if hook.Format != "" && !slices.Contains([]string{"generic", "slack", "discord"}, hook.Format) {
		return errors.New("Webhook format must be generic, slack, or discord.")
	}
	if hook.MinSeverity != "" && !slices.Contains([]string{"low", "medium", "high", "critical"}, hook.MinSeverity) {
		return errors.New("Webhook severity must be low, medium, high, or critical.")
	}
	if hook.URL != "" {
		parsed, err := url.Parse(hook.URL)
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || len(hook.URL) > 512 {
			return errors.New("Webhook URL must be an absolute http(s) URL.")
		}
	}
	if hook.Enabled && hook.URL == "" {
		return errors.New("Set a webhook URL before enabling alerts.")
	}
	return nil
}

func (s *Server) running() bool { return len(s.collectors) > 0 }

func (s *Server) stopCollectors() {
	for id, c := range s.collectors {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := c.Close(ctx); err != nil {
			s.serviceErrors[id] = "The previous listener required a forced close."
		}
		cancel()
	}
	s.collectors = map[string]collector.Sensor{}
}

func (s *Server) configure(config model.Config, actor, action string) error {
	if err := validateConfig(config); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("The server is shutting down.")
	}
	if reflect.DeepEqual(config, s.store.Config()) && config.Running == s.running() {
		return nil
	}
	s.stopCollectors()
	s.serviceErrors = map[string]string{}
	s.lastError = ""
	started := map[string]collector.Sensor{}
	failures := []string{}
	if config.Running {
		start := func(id string, listen func() (collector.Sensor, error)) {
			sensor, err := listen()
			if err != nil {
				s.serviceErrors[id] = err.Error()
				failures = append(failures, serviceNames[id])
				return
			}
			started[id] = sensor
			if id == "http" {
				config.HTTPAddress = sensor.Address()
			} else {
				d := config.Decoys[id]
				d.Address = sensor.Address()
				config.Decoys[id] = d
			}
		}
		if config.HTTPEnabled {
			start("http", func() (collector.Sensor, error) {
				return collector.Listen(config.HTTPAddress, config.Mode, s.record)
			})
		}
		for _, id := range model.DecoyIDs {
			if d := config.Decoy(id); d.Enabled {
				if config.Decoys == nil {
					config.Decoys = map[string]model.DecoyConfig{}
				}
				config.Decoys[id] = d
				start(id, func() (collector.Sensor, error) {
					return collector.ListenDecoy(id, d.Address, config.Mode, s.record)
				})
			}
		}
		if len(started) == 0 {
			config.Running = false
		}
	}
	var startErr error
	if len(failures) > 0 {
		s.lastError = "Could not bind: " + strings.Join(failures, ", ") + "."
		startErr = errors.New(s.lastError)
	}
	err := s.store.Update(func(state *model.State) error {
		state.Config = config
		result := "success"
		if startErr != nil {
			result = "partial: " + startErr.Error()
		}
		audit(state, actor, action, result)
		return nil
	})
	if err != nil {
		for _, c := range started {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			_ = c.Close(ctx)
			cancel()
		}
		s.lastError = "Could not persist the listener configuration; listeners are stopped."
		s.broadcast()
		return errors.New(s.lastError)
	}
	s.collectors = started
	for id, c := range started {
		go s.watchCollector(id, c)
	}
	s.broadcast()
	if len(started) > 0 {
		return nil
	}
	return startErr
}

func (s *Server) watchCollector(id string, current collector.Sensor) {
	<-current.Done()
	if err := current.Err(); err != nil {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.collectors[id] != current || s.closed {
			return
		}
		delete(s.collectors, id)
		s.serviceErrors[id] = "The listener stopped unexpectedly."
		if len(s.collectors) == 0 {
			s.lastError = "All decoy listeners stopped unexpectedly."
			_ = s.update("system", "collector.failed", func(state *model.State) error { state.Config.Running = false; return nil })
		} else {
			s.broadcast()
		}
	}
}

func portOf(address string) int {
	_, port, _ := net.SplitHostPort(address)
	n, _ := strconv.Atoi(port)
	return n
}

func (s *Server) systemStatus() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.store.Snapshot()
	hits := map[string]int{}
	for _, event := range state.Events {
		hits[event.Service]++
	}
	services := []map[string]any{}
	for _, id := range allServices() {
		address, enabled := state.Config.HTTPAddress, state.Config.HTTPEnabled
		if id != "http" {
			d := state.Config.Decoy(id)
			address, enabled = d.Address, d.Enabled
		}
		_, active := s.collectors[id]
		entry := map[string]any{"id": id, "name": serviceNames[id], "port": portOf(address), "address": address, "enabled": enabled, "active": active, "hits": hits[id]}
		if msg := s.serviceErrors[id]; msg != "" {
			entry["error"] = msg
		}
		services = append(services, entry)
	}
	hook := state.Config.Webhook
	if hook.Format == "" {
		hook.Format = "generic"
	}
	if hook.MinSeverity == "" {
		hook.MinSeverity = "high"
	}
	status := map[string]any{
		"running": s.running(), "mode": state.Config.Mode, "autoBlock": state.Config.AutoBlock,
		"httpAddress": state.Config.HTTPAddress, "httpEnabled": state.Config.HTTPEnabled,
		"services":     services,
		"webhook":      map[string]any{"enabled": hook.Enabled, "url": hook.URL, "format": hook.Format, "minSeverity": hook.MinSeverity},
		"capabilities": map[string]any{"autoBlock": true, "services": allServices()},
	}
	if s.lastError != "" {
		status["error"] = s.lastError
	}
	s.evidenceMu.Lock()
	if s.evidenceError != "" {
		status["error"] = s.evidenceError
	}
	s.evidenceMu.Unlock()
	return status
}

func (s *Server) getSystem(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.systemStatus())
}

func (s *Server) putSystem(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Running     *bool                        `json:"running"`
		Mode        *string                      `json:"mode"`
		AutoBlock   *bool                        `json:"autoBlock"`
		HTTPAddress *string                      `json:"httpAddress"`
		HTTPEnabled *bool                        `json:"httpEnabled"`
		Decoys      map[string]model.DecoyConfig `json:"decoys"`
		Webhook     *model.Webhook               `json:"webhook"`
	}
	if !decode(w, r, &input) {
		return
	}
	s.configMu.Lock()
	defer s.configMu.Unlock()
	config := s.store.Config()
	if input.Running != nil {
		config.Running = *input.Running
	}
	if input.Mode != nil {
		config.Mode = *input.Mode
	}
	if input.AutoBlock != nil {
		config.AutoBlock = *input.AutoBlock
	}
	if input.HTTPAddress != nil {
		config.HTTPAddress = *input.HTTPAddress
	}
	if input.HTTPEnabled != nil {
		config.HTTPEnabled = *input.HTTPEnabled
	}
	for id, d := range input.Decoys {
		if config.Decoys == nil {
			config.Decoys = map[string]model.DecoyConfig{}
		}
		if d.Address == "" {
			d.Address = config.Decoy(id).Address
		}
		config.Decoys[id] = d
	}
	if input.Webhook != nil {
		config.Webhook = *input.Webhook
	}
	if config.Running && !config.HTTPEnabled && !slices.ContainsFunc(model.DecoyIDs, func(id string) bool { return config.Decoy(id).Enabled }) {
		config.Running = false
	}
	if err := validateConfig(config); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.configure(config, identity(r).Actor, "system.configure"); err != nil {
		fail(w, http.StatusConflict, fmt.Sprintf("Listener configuration failed: %s", err))
		return
	}
	writeJSON(w, http.StatusOK, s.systemStatus())
}
