package intelligence

import (
	"encoding/json"
	"fmt"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"walkingdead/internal/model"
)

var (
	identifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	ipv4       = regexp.MustCompile(`(?:[0-9]{1,3}\.){3}[0-9]{1,3}`)
	ipv6       = regexp.MustCompile(`(?:[0-9A-Fa-f]{0,4}:){2,}[0-9A-Fa-f:.]*(?:%[A-Za-z0-9_.-]+)?`)
	secretLine = regexp.MustCompile(`(?im)("?(?:authorization|cookie|set-cookie|password|passwd|token|secret|api[_-]?key)"?\s*[:=]\s*)[^\r\n]+`)
	secretKey  = regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{8,}\b`)
)

type evidence struct {
	ID        string   `json:"id"`
	TS        int64    `json:"timestamp"`
	Service   string   `json:"service"`
	Type      string   `json:"type"`
	Severity  string   `json:"severity"`
	Source    string   `json:"source"`
	SessionID string   `json:"sessionId,omitempty"`
	SensorID  string   `json:"sensorId,omitempty"`
	Method    string   `json:"method,omitempty"`
	Path      string   `json:"path,omitempty"`
	Payload   string   `json:"payload,omitempty"`
	Command   string   `json:"command,omitempty"`
	Tags      []string `json:"tags,omitempty"`
	Tactics   []string `json:"mitreTechniques,omitempty"`
}

func prepare(input Input) (string, map[string]bool, int, int, error) {
	if (input.Task != "explain" && input.Task != "digest") || len(input.Events) == 0 || input.TotalEvents < 0 {
		return "", nil, 0, 0, ErrInvalidInput
	}
	if input.Day != "" {
		day, err := time.Parse("2006-01-02", input.Day)
		if err != nil || day.Format("2006-01-02") != input.Day {
			return "", nil, 0, 0, ErrInvalidInput
		}
	}
	if input.Task == "digest" && input.Day == "" {
		return "", nil, 0, 0, ErrInvalidInput
	}
	total := max(input.TotalEvents, len(input.Events))
	count := min(len(input.Events), maxEvents)
	redactor := &ipRedactor{sources: make(map[string]string)}
	ids := make(map[string]bool, count)
	events := make([]evidence, 0, count)
	for i := range count {
		index := i
		if len(input.Events) > count && count > 1 {
			index = i * (len(input.Events) - 1) / (count - 1)
		}
		item := input.Events[index]
		if !identifier.MatchString(item.ID) || ids[item.ID] {
			return "", nil, 0, 0, ErrInvalidInput
		}
		ids[item.ID] = true
		event := sanitize(item, input, redactor)
		events = append(events, event)
	}
	for len(events) > 0 {
		data := struct {
			Task             string     `json:"task"`
			Day              string     `json:"day,omitempty"`
			TotalEvents      int        `json:"totalEvents"`
			SampledEvents    int        `json:"sampledEvents"`
			IPsRedacted      bool       `json:"ipsRedacted"`
			PayloadsIncluded bool       `json:"payloadsIncluded"`
			Events           []evidence `json:"untrustedEvents"`
		}{input.Task, input.Day, total, len(events), input.RedactIPs, input.IncludePayloads, events}
		raw, err := json.Marshal(data)
		if err != nil {
			return "", nil, 0, 0, ErrInvalidInput
		}
		if len(raw) <= maxPromptBytes {
			return string(raw), ids, len(events), total, nil
		}
		delete(ids, events[len(events)-1].ID)
		events = events[:len(events)-1]
	}
	return "", nil, 0, 0, ErrInvalidInput
}

func sanitize(item model.Event, input Input, redactor *ipRedactor) evidence {
	source := bounded(item.SrcIP, 128)
	if input.RedactIPs && source != "" {
		source = redactor.source(source)
	}
	path, _, _ := strings.Cut(bounded(item.Path, 4096), "?")
	path, _, _ = strings.Cut(path, "#")
	if parsed, err := url.Parse(path); err == nil && parsed.IsAbs() {
		path = parsed.EscapedPath()
	}
	if decoded, err := url.PathUnescape(path); err == nil {
		path = decoded
	}
	path, _, _ = strings.Cut(path, "?")
	path, _, _ = strings.Cut(path, "#")
	path = secretKey.ReplaceAllString(path, "[redacted-secret]")
	if input.RedactIPs {
		path = redactor.text(path)
	}
	result := evidence{
		ID: item.ID, TS: item.TS, Service: bounded(item.Service, 32), Type: bounded(item.Type, 48),
		Severity: bounded(item.Severity, 16), Source: source, SessionID: safeID(item.SessionID),
		SensorID: safeID(item.SensorID), Method: bounded(item.Method, 16), Path: bounded(path, 240),
	}
	if item.Command != "" {
		command := secretLine.ReplaceAllString(bounded(item.Command, 2048), "${1}[redacted-secret]")
		command = secretKey.ReplaceAllString(command, "[redacted-secret]")
		if input.RedactIPs {
			command = redactor.text(command)
		}
		result.Command = bounded(command, 300)
	}
	for _, tag := range item.Tags[:min(len(item.Tags), 8)] {
		result.Tags = append(result.Tags, bounded(tag, 32))
	}
	for _, tactic := range item.Tactics[:min(len(item.Tactics), 8)] {
		result.Tactics = append(result.Tactics, bounded(tactic, 16))
	}
	if input.IncludePayloads {
		payload := secretLine.ReplaceAllString(bounded(item.Payload, 4096), "${1}[redacted-secret]")
		payload = secretKey.ReplaceAllString(payload, "[redacted-secret]")
		if input.RedactIPs {
			payload = redactor.text(payload)
		}
		result.Payload = bounded(payload, 400)
	}
	return result
}

func bounded(value string, limit int) string {
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, strings.ToValidUTF8(value, "�"))
	if len(value) <= limit {
		return value
	}
	value = value[:limit]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value
}

func safeID(value string) string {
	if identifier.MatchString(value) {
		return value
	}
	return ""
}

type ipRedactor struct {
	sources map[string]string
}

func (r *ipRedactor) source(value string) string {
	if ip, err := netip.ParseAddr(value); err == nil {
		value = ip.Unmap().String()
	}
	if pseudonym, ok := r.sources[value]; ok {
		return pseudonym
	}
	pseudonym := fmt.Sprintf("source-%02d", len(r.sources)+1)
	r.sources[value] = pseudonym
	return pseudonym
}

func (r *ipRedactor) text(value string) string {
	value = ipv6.ReplaceAllStringFunc(value, func(candidate string) string {
		trimmed := strings.TrimRight(candidate, ".")
		if _, err := netip.ParseAddr(trimmed); err != nil {
			return candidate
		}
		return r.source(trimmed) + candidate[len(trimmed):]
	})
	return ipv4.ReplaceAllStringFunc(value, func(candidate string) string {
		if _, err := netip.ParseAddr(candidate); err != nil {
			return candidate
		}
		return r.source(candidate)
	})
}
