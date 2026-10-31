// Package detect classifies captured decoy activity into tags, MITRE ATT&CK
// techniques, indicators of compromise and a severity.
package detect

import (
	"math"
	"net/url"
	"regexp"
	"slices"
	"strings"

	"walkingdead/internal/model"
)

type rule struct {
	tag      string
	severity string
	tactic   string
	any      []string
}

var severityRank = map[string]int{"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}

func Rank(severity string) int { return severityRank[severity] }

func Max(a, b string) string {
	if Rank(b) > Rank(a) {
		return b
	}
	return a
}

var httpRules = []rule{
	{"log4shell", "critical", "T1190", []string{"${jndi:", "${${", "%24%7bjndi"}},
	{"command-injection", "critical", "T1059", []string{";wget", "|wget", ";curl", "|curl", "$(", "`", "/bin/sh", "/bin/bash", "cmd.exe", "powershell", ";sh ", "|sh", "nc -e", "busybox"}},
	{"sql-injection", "high", "T1190", []string{"union select", "union all select", "' or '1'='1", "' or 1=1", "\" or 1=1", "or 1=1--", "sleep(", "benchmark(", "information_schema", "xp_cmdshell", "waitfor delay", "extractvalue(", "updatexml("}},
	{"path-traversal", "high", "T1083", []string{"../", "..\\", "..%2f", "%2e%2e", "/etc/passwd", "/etc/shadow", "win.ini", "boot.ini"}},
	{"exploit-probe", "high", "T1190", []string{"/cgi-bin/", "boaform", "/hnap1", "/gponform", "/vendor/phpunit", "/_ignition", "/solr/admin", "/struts", ".action", "/jmx-console", "/invoker/", "/autodiscover", "/owa/", "/remote/fgt_lang", "/cgi-bin/luci", "/setup.cgi", "/shell?", "/actuator/gateway"}},
	{"xss", "medium", "T1189", []string{"<script", "onerror=", "onload=", "javascript:", "<svg", "alert("}},
	{"secret-harvesting", "medium", "T1552.001", []string{"/.env", "/.git", "/.aws", "/.ssh", "id_rsa", "wp-config", "config.php", "/.docker", "/.npmrc", "/.htpasswd", "credentials", "/backup", ".sql", ".bak"}},
	{"cms-probe", "low", "T1595.002", []string{"wp-admin", "wp-login", "xmlrpc.php", "wp-content", "/wordpress", "phpmyadmin", "/pma", "/joomla", "/drupal", "/magento"}},
	{"admin-panel-probe", "low", "T1595.002", []string{"/admin", "/manager/html", "/actuator", "/console", "/dashboard", "/login", "/user/login", "/api/v1/pods", "/server-status", "/.well-known/security.txt"}},
}

var scannerAgents = []string{"nmap", "masscan", "zgrab", "nikto", "sqlmap", "nuclei", "gobuster", "dirbuster", "dirb", "wpscan", "feroxbuster", "ffuf", "censys", "shodan", "expanse", "internet-measurement", "httpx", "fuzz", "hydra", "metasploit"}
var toolAgents = []string{"curl/", "wget/", "python-requests", "python-urllib", "go-http-client", "libwww-perl", "okhttp", "java/", "aiohttp", "scrapy"}

var commandRules = []rule{
	{"cryptominer", "critical", "T1496", []string{"xmrig", "minerd", "stratum+tcp", "cpuminer", "nicehash", "monero", "kdevtmpfsi", "kinsing"}},
	{"malware-download", "critical", "T1105", []string{"wget ", "curl ", "tftp ", "ftpget ", "busybox wget", "lwp-download", "fetch "}},
	{"defense-evasion", "high", "T1070", []string{"history -c", "unset histfile", "rm -rf /var/log", "rm -rf /tmp/*", "chattr", "shred ", "> /var/log", "export histfile=/dev/null", "pkill -9", "kill -9"}},
	{"persistence", "high", "T1053", []string{"crontab", "/etc/cron", "authorized_keys", ".bashrc", "/etc/rc.local", "systemctl enable", "/etc/init.d", "useradd", "passwd "}},
	{"execution", "high", "T1059.004", []string{"chmod +x", "chmod 777", "chmod 755", "sh -c", "bash -c", "./", "nohup ", "perl -e", "python -c", "python3 -c"}},
	{"botnet", "high", "T1584.005", []string{"/bin/busybox", "mirai", "ecchi", "gafgyt", "tsunami", "mozi", "enable\nsystem", "shell\nsh"}},
	{"discovery", "low", "T1082", []string{"uname", "whoami", "id", "cat /proc/cpuinfo", "nproc", "free -m", "lscpu", "hostname", "ifconfig", "ip a", "w", "uptime", "cat /etc/issue", "ps aux", "netstat", "ls"}},
}

var redisRules = []rule{
	{"redis-exploit", "critical", "T1190", []string{"config set dir", "config set dbfilename", "slaveof", "replicaof", "module load", "eval ", "system.exec", "flushall"}},
	{"redis-recon", "low", "T1082", []string{"info", "config get", "keys *", "client list", "dbsize"}},
}

var defaultCredentials = map[string][]string{
	"root":          {"root", "toor", "123456", "password", "admin", "12345", "1234", "default", "pass", "", "xc3511", "vizxv", "888888", "54321", "juantech"},
	"admin":         {"admin", "password", "1234", "12345", "123456", "admin123", "", "default", "pass", "smcadmin"},
	"pi":            {"raspberry"},
	"ubnt":          {"ubnt"},
	"user":          {"user", "password", "1234"},
	"guest":         {"guest", ""},
	"support":       {"support"},
	"oracle":        {"oracle"},
	"postgres":      {"postgres"},
	"test":          {"test", "test123"},
	"ftp":           {"ftp", ""},
	"anonymous":     {"", "anonymous", "guest"},
	"administrator": {"administrator", "password", "admin"},
	"sa":            {"", "sa", "password"},
}

var urlPattern = regexp.MustCompile(`(?i)\b(?:https?|ftp|tftp)://[^\s'"<>;|&)]+`)
var ipPortPattern = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b`)
var wordPattern = regexp.MustCompile(`[a-z0-9_]+`)

func apply(e *model.Event, haystack string, rules []rule, wordBoundary bool) {
	text := strings.ToLower(haystack)
	words := map[string]bool{}
	if wordBoundary {
		for _, w := range wordPattern.FindAllString(text, -1) {
			words[w] = true
		}
	}
	for _, r := range rules {
		for _, needle := range r.any {
			hit := strings.Contains(text, needle)
			if hit && wordBoundary && r.tag == "discovery" && !strings.Contains(needle, " ") && !strings.Contains(needle, "/") {
				hit = words[needle]
			}
			if hit {
				tag(e, r.tag, r.severity, r.tactic)
				break
			}
		}
	}
}

func tag(e *model.Event, name, severity, tactic string) {
	if !slices.Contains(e.Tags, name) {
		e.Tags = append(e.Tags, name)
	}
	if tactic != "" && !slices.Contains(e.Tactics, tactic) {
		e.Tactics = append(e.Tactics, tactic)
	}
	e.Severity = Max(e.Severity, severity)
}

// Analyze enriches the event in place. It never lowers an existing severity.
func Analyze(e *model.Event) {
	if e.Severity == "" {
		e.Severity = "info"
	}
	if e.Service == "http" {
		decoded := e.Path
		if u, err := url.QueryUnescape(e.Path); err == nil {
			decoded += " " + u
		}
		apply(e, decoded+" "+e.Payload, httpRules, false)
		ua := strings.ToLower(e.UserAgent)
		if strings.Contains(ua, "() {") {
			tag(e, "shellshock", "critical", "T1190")
		}
		apply(e, ua, httpRules[:2], false)
		for _, s := range scannerAgents {
			if strings.Contains(ua, s) {
				tag(e, "scanner", "low", "T1595")
				break
			}
		}
		for _, s := range toolAgents {
			if strings.Contains(ua, s) {
				tag(e, "automated-client", "info", "T1595")
				break
			}
		}
		if ua == "" {
			tag(e, "no-user-agent", "info", "")
		}
		if e.Method == "POST" && (strings.Contains(strings.ToLower(e.Path), "login") || strings.Contains(strings.ToLower(e.Payload), "password=") || strings.Contains(strings.ToLower(e.Payload), "passwd=")) {
			tag(e, "credential-attempt", "medium", "T1110")
		}
		if e.Method != "" && !slices.Contains([]string{"GET", "POST", "HEAD", "PUT", "DELETE", "OPTIONS", "PATCH"}, e.Method) {
			tag(e, "unusual-method", "low", "T1595")
		}
	}
	if e.Command != "" {
		if e.Service == "redis" {
			apply(e, e.Command, redisRules, false)
		} else {
			apply(e, e.Command, commandRules, true)
		}
	}
	if e.Service == "http" || e.Command != "" {
		for _, m := range urlPattern.FindAllString(e.Command+" "+e.Payload+" "+e.Path+" "+e.UserAgent, -1) {
			ioc(e, strings.TrimRight(m, ".,"))
		}
		if e.Command != "" {
			for _, m := range ipPortPattern.FindAllString(e.Command, -1) {
				if !strings.HasPrefix(m, "127.") && !strings.HasPrefix(m, "0.") {
					ioc(e, m)
				}
			}
		}
	}
	if IsCredential(*e) {
		tag(e, "credential-attempt", "low", "T1110")
		if pw, ok := defaultCredentials[strings.ToLower(e.User)]; ok && slices.Contains(pw, e.Password) {
			tag(e, "default-credentials", "medium", "T1110.001")
		}
	}
	if len(e.Tags) > 0 && e.Type == "connection" {
		switch {
		case Rank(e.Severity) >= 3:
			e.Type = "exploit"
		case slices.Contains(e.Tags, "credential-attempt"):
			e.Type = "auth_fail"
		case Rank(e.Severity) >= 1:
			e.Type = "scan"
		}
	}
}

// IsCredential reports whether the event is a login attempt rather than activity by an authenticated user.
func IsCredential(e model.Event) bool {
	return e.Type == "auth_fail" || (e.Service == "http" && e.Password != "")
}

func ioc(e *model.Event, value string) {
	if len(value) > 512 || slices.Contains(e.IOCs, value) || len(e.IOCs) >= 16 {
		return
	}
	e.IOCs = append(e.IOCs, value)
}

var tacticNames = map[string]string{
	"T1190":     "Exploit Public-Facing Application",
	"T1059":     "Command and Scripting Interpreter",
	"T1059.004": "Unix Shell",
	"T1083":     "File and Directory Discovery",
	"T1189":     "Drive-by Compromise",
	"T1552.001": "Credentials In Files",
	"T1595":     "Active Scanning",
	"T1595.002": "Vulnerability Scanning",
	"T1110":     "Brute Force",
	"T1110.001": "Password Guessing",
	"T1496":     "Resource Hijacking",
	"T1105":     "Ingress Tool Transfer",
	"T1070":     "Indicator Removal",
	"T1053":     "Scheduled Task/Job",
	"T1584.005": "Botnet",
	"T1082":     "System Information Discovery",
}

func TacticName(id string) string { return tacticNames[id] }

// Score weighs an attacker's events: worst severity first, then volume, breadth and technique variety.
func Score(events []model.Event) int {
	base := map[string]float64{"info": 4, "low": 18, "medium": 38, "high": 58, "critical": 72}
	worst := "info"
	tags := map[string]bool{}
	services := map[string]bool{}
	for _, e := range events {
		worst = Max(worst, e.Severity)
		services[e.Service] = true
		for _, t := range e.Tags {
			tags[t] = true
		}
	}
	score := base[worst] + min(12, 3*math.Log1p(float64(len(events)))) + 4*float64(len(services)-1) + min(10, float64(len(tags)))
	return min(100, int(math.Round(score)))
}
