package server

import (
	"bytes"
	"cmp"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"walkingdead/internal/detect"
	"walkingdead/internal/model"
)

const maxBlocklist = 5000

type attacker struct {
	IP          string         `json:"ip"`
	FirstSeen   int64          `json:"firstSeen"`
	LastSeen    int64          `json:"lastSeen"`
	Events      int            `json:"events"`
	Sessions    int            `json:"sessions"`
	Services    []string       `json:"services"`
	Severity    string         `json:"severity"`
	Score       int            `json:"score"`
	Tags        []string       `json:"tags"`
	Tactics     []string       `json:"tactics"`
	Credentials int            `json:"credentials"`
	Commands    int            `json:"commands"`
	Compromised bool           `json:"compromised"`
	Blocked     bool           `json:"blocked"`
	BySeverity  map[string]int `json:"bySeverity"`
}

type counted struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

func topN(m map[string]int, n int) []counted {
	out := make([]counted, 0, len(m))
	for k, v := range m {
		out = append(out, counted{k, v})
	}
	slices.SortFunc(out, func(a, b counted) int {
		if c := cmp.Compare(b.Count, a.Count); c != 0 {
			return c
		}
		return cmp.Compare(a.Value, b.Value)
	})
	return out[:min(len(out), n)]
}

func buildAttackers(state model.State) []attacker {
	blocked := map[string]bool{}
	for _, b := range state.Blocklist {
		blocked[b.IP] = true
	}
	byIP := map[string][]model.Event{}
	for _, e := range state.Events {
		byIP[e.SrcIP] = append(byIP[e.SrcIP], e)
	}
	out := make([]attacker, 0, len(byIP))
	for ip, events := range byIP {
		a := attacker{IP: ip, FirstSeen: events[0].TS, LastSeen: events[0].TS, Events: len(events), Severity: "info", BySeverity: map[string]int{}, Blocked: blocked[ip], Services: []string{}, Tags: []string{}, Tactics: []string{}}
		sessions := map[string]bool{}
		for _, e := range events {
			a.FirstSeen = min(a.FirstSeen, e.TS)
			a.LastSeen = max(a.LastSeen, e.TS)
			sessions[e.SessionID] = true
			a.Severity = detect.Max(a.Severity, e.Severity)
			a.BySeverity[e.Severity]++
			if !slices.Contains(a.Services, e.Service) {
				a.Services = append(a.Services, e.Service)
			}
			for _, t := range e.Tags {
				if !slices.Contains(a.Tags, t) {
					a.Tags = append(a.Tags, t)
				}
			}
			for _, t := range e.Tactics {
				if !slices.Contains(a.Tactics, t) {
					a.Tactics = append(a.Tactics, t)
				}
			}
			if detect.IsCredential(e) {
				a.Credentials++
			}
			if e.Command != "" {
				a.Commands++
			}
			if e.Type == "auth_success" {
				a.Compromised = true
			}
		}
		a.Sessions = len(sessions)
		a.Score = detect.Score(events)
		slices.Sort(a.Services)
		out = append(out, a)
	}
	slices.SortFunc(out, func(a, b attacker) int {
		if c := cmp.Compare(b.Score, a.Score); c != 0 {
			return c
		}
		return cmp.Compare(b.LastSeen, a.LastSeen)
	})
	return out
}

func (s *Server) getAttackers(w http.ResponseWriter, r *http.Request) {
	list := buildAttackers(s.store.Snapshot())
	writeJSON(w, http.StatusOK, list[:min(len(list), boundedLimit(r, 500, 5000))])
}

func (s *Server) getAttacker(w http.ResponseWriter, r *http.Request) {
	ip := r.PathValue("ip")
	state := s.store.Snapshot()
	for _, a := range buildAttackers(state) {
		if a.IP != ip {
			continue
		}
		events := []model.Event{}
		for _, e := range state.Events {
			if e.SrcIP == ip {
				events = append(events, e)
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"attacker": a, "events": newestEvents(events)[:min(len(events), 500)]})
		return
	}
	fail(w, http.StatusNotFound, "No activity from this address.")
}

func (s *Server) getIntel(w http.ResponseWriter, r *http.Request) {
	state := s.store.Snapshot()
	users, passwords, pairs := map[string]int{}, map[string]int{}, map[string]int{}
	tags, tactics, paths, commands, agents, iocs, services := map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}
	var heat [7][24]int
	compromised := map[string]bool{}
	for _, e := range state.Events {
		services[e.Service]++
		t := time.UnixMilli(e.TS).UTC()
		heat[int(t.Weekday())][t.Hour()]++
		if detect.IsCredential(e) {
			users[e.User]++
			passwords[e.Password]++
			pairs[e.User+"\x00"+e.Password]++
		}
		for _, v := range e.Tags {
			tags[v]++
		}
		for _, v := range e.Tactics {
			tactics[v]++
		}
		if e.Path != "" {
			paths[e.Path]++
		}
		if e.Command != "" {
			commands[e.Command]++
		}
		if e.UserAgent != "" {
			agents[e.UserAgent]++
		}
		for _, v := range e.IOCs {
			iocs[v]++
		}
		if e.Type == "auth_success" {
			compromised[e.SrcIP] = true
		}
	}
	pairList := []map[string]any{}
	for _, p := range topN(pairs, 25) {
		u, pw, _ := strings.Cut(p.Value, "\x00")
		pairList = append(pairList, map[string]any{"user": u, "password": pw, "count": p.Count})
	}
	tacticList := []map[string]any{}
	for _, t := range topN(tactics, 30) {
		tacticList = append(tacticList, map[string]any{"id": t.Value, "name": detect.TacticName(t.Value), "count": t.Count})
	}
	heatmap := make([][]int, 7)
	for d := range heat {
		heatmap[d] = heat[d][:]
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"events": len(state.Events), "attackers": len(buildAttackers(state)), "compromised": len(compromised), "blocked": len(state.Blocklist),
		"services": topN(services, 10), "usernames": topN(users, 25), "passwords": topN(passwords, 25), "pairs": pairList,
		"tags": topN(tags, 30), "tactics": tacticList, "paths": topN(paths, 25), "commands": topN(commands, 25),
		"userAgents": topN(agents, 15), "iocs": topN(iocs, 50), "heatmap": heatmap,
	})
}

func addBlock(state *model.State, ip, reason, source string) bool {
	if net.ParseIP(ip) == nil || slices.ContainsFunc(state.Blocklist, func(b model.BlockEntry) bool { return b.IP == ip }) {
		return false
	}
	state.Blocklist = append(state.Blocklist, model.BlockEntry{IP: ip, Reason: sanitizeReason(reason), Source: source, CreatedAt: time.Now().UnixMilli()})
	if len(state.Blocklist) > maxBlocklist {
		state.Blocklist = append([]model.BlockEntry{}, state.Blocklist[len(state.Blocklist)-maxBlocklist:]...)
	}
	return true
}

func sanitizeReason(v string) string {
	v = strings.Map(func(r rune) rune {
		if r < 32 {
			return ' '
		}
		return r
	}, v)
	if len(v) > 200 {
		v = strings.ToValidUTF8(v[:200], "")
	}
	return v
}

func (s *Server) getBlocklist(w http.ResponseWriter, r *http.Request) {
	list := s.store.Snapshot().Blocklist
	if list == nil {
		list = []model.BlockEntry{}
	}
	slices.SortFunc(list, func(a, b model.BlockEntry) int { return cmp.Compare(b.CreatedAt, a.CreatedAt) })
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) postBlocklist(w http.ResponseWriter, r *http.Request) {
	var input struct {
		IP     string `json:"ip"`
		Reason string `json:"reason"`
	}
	if !decode(w, r, &input) {
		return
	}
	if net.ParseIP(input.IP) == nil {
		fail(w, http.StatusBadRequest, "Use a literal IPv4 or IPv6 address.")
		return
	}
	if input.Reason == "" {
		input.Reason = "Manual"
	}
	s.changed(w, r, "blocklist.add", func(state *model.State) error { addBlock(state, input.IP, input.Reason, "manual"); return nil })
}

func (s *Server) deleteBlock(w http.ResponseWriter, r *http.Request) {
	ip := r.PathValue("ip")
	s.changed(w, r, "blocklist.remove", func(state *model.State) error {
		state.Blocklist = slices.DeleteFunc(state.Blocklist, func(b model.BlockEntry) bool { return b.IP == ip })
		return nil
	})
}

func (s *Server) exportBlocklist(w http.ResponseWriter, r *http.Request) {
	list := s.store.Snapshot().Blocklist
	format := r.URL.Query().Get("format")
	var b bytes.Buffer
	ips4, ips6 := []string{}, []string{}
	for _, e := range list {
		if net.ParseIP(e.IP).To4() != nil {
			ips4 = append(ips4, e.IP)
		} else {
			ips6 = append(ips6, e.IP)
		}
	}
	contentType, ext := "text/plain; charset=utf-8", "txt"
	switch format {
	case "", "txt":
		for _, e := range list {
			b.WriteString(e.IP + "\n")
		}
	case "iptables":
		ext = "sh"
		b.WriteString("#!/bin/sh\n")
		for _, ip := range ips4 {
			fmt.Fprintf(&b, "iptables -I INPUT -s %s -j DROP\n", ip)
		}
		for _, ip := range ips6 {
			fmt.Fprintf(&b, "ip6tables -I INPUT -s %s -j DROP\n", ip)
		}
	case "nftables":
		ext = "nft"
		b.WriteString("table inet walkingdead {\n  set blocked4 { type ipv4_addr; flags interval; elements = { " + strings.Join(orNone(ips4, "0.0.0.0/32"), ", ") + " } }\n")
		b.WriteString("  set blocked6 { type ipv6_addr; flags interval; elements = { " + strings.Join(orNone(ips6, "::/128"), ", ") + " } }\n")
		b.WriteString("  chain input { type filter hook input priority -10; ip saddr @blocked4 drop; ip6 saddr @blocked6 drop; }\n}\n")
	case "pf":
		ext = "conf"
		b.WriteString("table <walkingdead> persist { " + strings.Join(append(ips4, ips6...), " ") + " }\nblock drop in quick from <walkingdead>\n")
	case "csv":
		contentType, ext = "text/csv; charset=utf-8", "csv"
		cw := csv.NewWriter(&b)
		_ = cw.Write([]string{"ip", "source", "created_at", "reason"})
		for _, e := range list {
			_ = cw.Write([]string{e.IP, e.Source, time.UnixMilli(e.CreatedAt).UTC().Format(time.RFC3339), csvSafe(e.Reason)})
		}
		cw.Flush()
	default:
		fail(w, http.StatusBadRequest, "Format must be txt, iptables, nftables, pf, or csv.")
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", "attachment; filename=walkingdead-blocklist."+ext)
	_, _ = w.Write(b.Bytes())
}

func orNone(v []string, placeholder string) []string {
	if len(v) == 0 {
		return []string{placeholder}
	}
	return v
}

func csvSafe(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		return "'" + v
	}
	return v
}

func (s *Server) testWebhook(w http.ResponseWriter, r *http.Request) {
	hook := s.store.Config().Webhook
	if hook.URL == "" {
		fail(w, http.StatusBadRequest, "Configure a webhook URL first.")
		return
	}
	event := model.Event{ID: newID(), TS: time.Now().UnixMilli(), Service: "ssh", Type: "test", Severity: "high", SrcIP: "203.0.113.7", Message: "Test alert from Walking Dead", Tags: []string{"test"}}
	if err := sendWebhook(r.Context(), hook, event, false); err != nil {
		fail(w, http.StatusBadGateway, "Webhook delivery failed: "+err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type webhookQueue struct {
	s       *Server
	ch      chan hookItem
	once    sync.Once
	ctx     context.Context
	cancel  context.CancelFunc
	mu      sync.Mutex
	window  time.Time
	sent    int
	dropped int
}

type hookItem struct {
	event   model.Event
	blocked bool
}

func newWebhookQueue(s *Server) *webhookQueue {
	q := &webhookQueue{s: s, ch: make(chan hookItem, 64)}
	q.ctx, q.cancel = context.WithCancel(context.Background())
	go q.run()
	return q
}

func (q *webhookQueue) push(e model.Event, blocked bool) {
	hook := q.s.store.Config().Webhook
	min := hook.MinSeverity
	if min == "" {
		min = "high"
	}
	if !hook.Enabled || hook.URL == "" || detect.Rank(e.Severity) < detect.Rank(min) {
		return
	}
	select {
	case q.ch <- hookItem{e, blocked}:
	default:
	}
}

func (q *webhookQueue) run() {
	for {
		select {
		case <-q.ctx.Done():
			return
		case item := <-q.ch:
			q.mu.Lock()
			if time.Since(q.window) > time.Minute {
				q.window, q.sent = time.Now(), 0
			}
			allowed := q.sent < 20
			q.sent++
			q.mu.Unlock()
			if !allowed {
				continue
			}
			ctx, cancel := context.WithTimeout(q.ctx, 8*time.Second)
			if err := sendWebhook(ctx, q.s.store.Config().Webhook, item.event, item.blocked); err != nil && q.s.logger != nil {
				q.s.logger.Warn("webhook delivery failed", "error", err.Error())
			}
			cancel()
		}
	}
}

func (q *webhookQueue) close() { q.once.Do(q.cancel) }

var webhookClient = &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func sendWebhook(ctx context.Context, hook model.Webhook, e model.Event, blocked bool) error {
	text := fmt.Sprintf("[%s] %s via %s from %s: %s", strings.ToUpper(e.Severity), e.Type, strings.ToUpper(e.Service), e.SrcIP, e.Message)
	if len(e.Tags) > 0 {
		text += " (" + strings.Join(e.Tags, ", ") + ")"
	}
	if blocked {
		text += " (added to blocklist)"
	}
	var payload any
	switch hook.Format {
	case "slack":
		payload = map[string]string{"text": text}
	case "discord":
		payload = map[string]string{"content": text, "username": "Walking Dead"}
	default:
		payload = map[string]any{"source": "walkingdead", "text": text, "blocked": blocked, "event": e}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, hook.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "walkingdead-alerts/1")
	res, err := webhookClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed")
	}
	_ = res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("endpoint returned HTTP %d", res.StatusCode)
	}
	return nil
}
