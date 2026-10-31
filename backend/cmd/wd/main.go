package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	"golang.org/x/term"
	"walkingdead/internal/client"
)

var version = "dev"

func secret(path, prompt string) ([]byte, error) {
	if path == "" {
		if !term.IsTerminal(int(os.Stdin.Fd())) {
			return nil, errors.New("use --password-file for non-interactive authentication")
		}
		fmt.Fprint(os.Stderr, prompt)
		value, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		return value, err
	}
	var reader io.Reader = os.Stdin
	if path != "-" {
		before, err := os.Lstat(path)
		if err != nil {
			return nil, err
		}
		if err := privateFile(path, before); err != nil {
			return nil, err
		}
		file, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		defer file.Close()
		after, err := file.Stat()
		if err != nil || !os.SameFile(before, after) {
			return nil, errors.New("credential file changed while opening")
		}
		reader = file
	}
	data, err := io.ReadAll(io.LimitReader(reader, 4097))
	if err != nil {
		return nil, err
	}
	if len(data) > 4096 {
		return nil, errors.New("credential exceeds 4096 bytes")
	}
	data = []byte(strings.TrimRight(string(data), "\r\n"))
	if len(data) == 0 {
		return nil, errors.New("credential is empty")
	}
	return data, nil
}

func execute(args []string) error {
	flags := flag.NewFlagSet("wd", flag.ContinueOnError)
	address := flags.String("url", "http://127.0.0.1:8080", "Management server URL")
	keyFile := flags.String("key-file", "", "Private API key file")
	username := flags.String("username", "", "Owner username for this command")
	passwordFile := flags.String("password-file", "", "Private password file, or - for stdin")
	flags.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: wd [connection flags] status|overview|health|api-schema|logs|sessions|attackers|intel|blocklist|audit|system|keys|ai|version\nConnection flags must precede the command.")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		return err
	}
	command := flags.Args()
	if len(command) == 0 {
		flags.Usage()
		return errors.New("a command is required")
	}
	if command[0] == "version" {
		fmt.Println(version)
		return nil
	}
	if *keyFile != "" && (*username != "" || *passwordFile != "") {
		return errors.New("choose API key or owner authentication")
	}
	token := ""
	if *keyFile != "" {
		value, err := secret(*keyFile, "")
		if err != nil {
			return err
		}
		token = string(value)
		clear(value)
	}
	c, err := client.New(*address, token)
	if err != nil {
		return err
	}
	if token == "" {
		if *username == "" {
			return errors.New("provide --key-file or --username")
		}
		password, err := secret(*passwordFile, "Password: ")
		if err != nil {
			return err
		}
		err = c.Login(*username, password)
		clear(password)
		if err != nil {
			return err
		}
		defer func() { _, _ = c.Do(http.MethodPost, "/auth/logout", nil) }()
	}
	method, path := http.MethodGet, ""
	var body any
	raw := false
	switch command[0] {
	case "attackers":
		path = "/attackers"
		if len(command) == 2 {
			path += "/" + url.PathEscape(command[1])
		} else if len(command) > 2 {
			return errors.New("usage: attackers [IP]")
		}
	case "intel":
		path = "/intel"
	case "overview":
		path = "/overview"
	case "blocklist":
		path = "/blocklist"
		if len(command) < 2 {
			return errors.New("usage: blocklist list|add <ip> [reason]|remove <ip>|export [--format txt|iptables|nftables|pf|csv]")
		}
		switch command[1] {
		case "list":
		case "add":
			if len(command) < 3 {
				return errors.New("blocklist add requires an IP address")
			}
			method, body = http.MethodPost, map[string]string{"ip": command[2], "reason": strings.Join(command[3:], " ")}
		case "remove":
			if len(command) != 3 {
				return errors.New("blocklist remove requires an IP address")
			}
			method, path = http.MethodDelete, path+"/"+url.PathEscape(command[2])
		case "export":
			f := flag.NewFlagSet("blocklist export", flag.ContinueOnError)
			format := f.String("format", "txt", "txt, iptables, nftables, pf or csv")
			if err := f.Parse(command[2:]); err != nil {
				return err
			}
			path, raw = path+"/export?format="+url.QueryEscape(*format), true
		default:
			return errors.New("unknown blocklist operation")
		}
	case "status":
		path = "/system"
	case "health":
		path = "/health"
	case "api-schema":
		if len(command) != 1 {
			return errors.New("api-schema accepts no arguments")
		}
		path = "/openapi"
	case "logs":
		f := flag.NewFlagSet("logs", flag.ContinueOnError)
		limit := f.Int("limit", 100, "Maximum returned events")
		service := f.String("service", "", "Only this decoy service")
		severity := f.String("min-severity", "", "Minimum severity")
		ip := f.String("ip", "", "Only this source address")
		tag := f.String("tag", "", "Only events with this detection tag")
		if err := f.Parse(command[1:]); err != nil {
			return err
		}
		if *limit < 1 || *limit > 10000 {
			return errors.New("limit must be between 1 and 10000")
		}
		query := url.Values{"limit": {fmt.Sprint(*limit)}}
		for key, value := range map[string]string{"service": *service, "minSeverity": *severity, "ip": *ip, "tag": *tag} {
			if value != "" {
				query.Set(key, value)
			}
		}
		path = "/logs/recent?" + query.Encode()
	case "sessions":
		path = "/sessions"
		f := flag.NewFlagSet("sessions", flag.ContinueOnError)
		query := f.String("query", "", "Search source, session or request metadata")
		day := f.String("day", "", "Filter by UTC day")
		limit := f.Int("limit", 100, "Maximum sessions")
		if err := f.Parse(command[1:]); err != nil {
			return err
		}
		if f.NArg() > 1 {
			return errors.New("usage: sessions [--query TEXT] [--day YYYY-MM-DD] [--limit N] [SESSION_ID]")
		}
		if f.NArg() == 1 {
			path += "/" + url.PathEscape(f.Arg(0))
		} else {
			if *limit < 1 || *limit > 10000 {
				return errors.New("limit must be between 1 and 10000")
			}
			path += "?" + url.Values{"q": {*query}, "day": {*day}, "limit": {fmt.Sprint(*limit)}}.Encode()
		}
	case "audit":
		path = "/audit"
	case "ai":
		if len(command) < 2 {
			return errors.New("usage: ai status|configure [options]|explain EVENT_ID|digest YYYY-MM-DD")
		}
		path = "/ai/settings"
		switch command[1] {
		case "status":
			if len(command) != 2 {
				return errors.New("ai status accepts no arguments")
			}
		case "configure":
			f := flag.NewFlagSet("ai configure", flag.ContinueOnError)
			providerKeyFile := f.String("provider-key-file", "", "Private DeepSeek key file, or - for stdin")
			enabled := f.Bool("enabled", false, "Enable explicit AI requests")
			model := f.String("model", "", "DeepSeek model ID")
			redactIPs := f.Bool("redact-ips", true, "Pseudonymize IPs sent to the provider")
			payloads := f.Bool("include-payloads", false, "Include bounded raw capture excerpts")
			clearKey := f.Bool("clear-key", false, "Remove the provider key and disable AI")
			if err := f.Parse(command[2:]); err != nil {
				return err
			}
			if f.NArg() != 0 {
				return errors.New("unexpected AI configuration arguments")
			}
			patch := map[string]any{}
			f.Visit(func(flag *flag.Flag) {
				switch flag.Name {
				case "enabled":
					patch["enabled"] = *enabled
				case "model":
					patch["model"] = *model
				case "redact-ips":
					patch["redactIps"] = *redactIPs
				case "include-payloads":
					patch["includePayloads"] = *payloads
				case "clear-key":
					patch["clearKey"] = *clearKey
				}
			})
			if *providerKeyFile != "" {
				if *providerKeyFile == "-" && *passwordFile == "-" {
					return errors.New("owner password and provider key cannot share stdin")
				}
				value, err := secret(*providerKeyFile, "")
				if err != nil {
					return err
				}
				patch["providerKey"] = string(value)
				clear(value)
				defer delete(patch, "providerKey")
			}
			if len(patch) == 0 {
				return errors.New("provide at least one AI configuration option")
			}
			method, body = http.MethodPut, patch
		case "explain", "digest":
			if len(command) != 3 {
				return errors.New("ai explain requires an event ID; ai digest requires a UTC day")
			}
			request := map[string]string{"task": command[1]}
			if command[1] == "explain" {
				request["eventId"] = command[2]
			} else {
				request["day"] = command[2]
			}
			method, path, body = http.MethodPost, "/ai", request
		default:
			return errors.New("unknown AI operation")
		}
	case "system":
		if len(command) < 2 {
			return errors.New("usage: system start|stop|mode <passive|interactive|tarpit>|autoblock on|off|decoy <http|ssh|telnet|ftp|redis|mysql> on|off [--address host:port]|configure --http-address <host:port>")
		}
		method, path = http.MethodPut, "/system"
		switch command[1] {
		case "start":
			body = map[string]bool{"running": true}
		case "stop":
			body = map[string]bool{"running": false}
		case "mode":
			if len(command) != 3 {
				return errors.New("system mode requires a mode")
			}
			body = map[string]string{"mode": command[2]}
		case "autoblock":
			if len(command) != 3 || (command[2] != "on" && command[2] != "off") {
				return errors.New("usage: system autoblock on|off")
			}
			body = map[string]bool{"autoBlock": command[2] == "on"}
		case "decoy":
			if len(command) < 4 || (command[3] != "on" && command[3] != "off") {
				return errors.New("usage: system decoy <service> on|off [--address host:port]")
			}
			f := flag.NewFlagSet("decoy", flag.ContinueOnError)
			address := f.String("address", "", "Bind address")
			if err := f.Parse(command[4:]); err != nil {
				return err
			}
			enabled := command[3] == "on"
			if command[2] == "http" {
				patch := map[string]any{"httpEnabled": enabled}
				if *address != "" {
					patch["httpAddress"] = *address
				}
				body = patch
			} else {
				body = map[string]any{"decoys": map[string]any{command[2]: map[string]any{"enabled": enabled, "address": *address}}}
			}
		case "configure":
			f := flag.NewFlagSet("configure", flag.ContinueOnError)
			bind := f.String("http-address", "", "HTTP decoy bind address")
			if err := f.Parse(command[2:]); err != nil {
				return err
			}
			if *bind == "" {
				return errors.New("--http-address is required")
			}
			body = map[string]string{"httpAddress": *bind}
		default:
			return errors.New("unknown system operation")
		}
	case "keys":
		if len(command) < 2 {
			return errors.New("usage: keys list|create|revoke <id>")
		}
		path = "/keys"
		switch command[1] {
		case "list":
		case "create":
			f := flag.NewFlagSet("keys create", flag.ContinueOnError)
			name := f.String("name", "", "Key name")
			scopes := f.String("scopes", "system:read,events:read", "Comma-separated scopes")
			days := f.Int("expires", 30, "Lifetime in days")
			if err := f.Parse(command[2:]); err != nil {
				return err
			}
			if *name == "" {
				return errors.New("--name is required")
			}
			method = http.MethodPost
			body = map[string]any{"name": *name, "scopes": strings.Split(*scopes, ","), "expiresInDays": *days}
		case "revoke":
			if len(command) != 3 {
				return errors.New("key id is required")
			}
			method = http.MethodDelete
			path += "/" + url.PathEscape(command[2])
		default:
			return errors.New("unknown key operation")
		}
	default:
		return errors.New("unknown command")
	}
	if raw {
		text, err := c.DoRaw(method, path, body)
		if err != nil {
			return err
		}
		_, err = os.Stdout.Write(text)
		return err
	}
	result, err := c.Do(method, path, body)
	if err != nil {
		return err
	}
	if len(result) == 0 {
		return nil
	}
	var decoded any
	if err := json.Unmarshal(result, &decoded); err != nil {
		return err
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(decoded)
}

func main() {
	if err := execute(os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		fmt.Fprintln(os.Stderr, "wd:", err)
		os.Exit(1)
	}
}
