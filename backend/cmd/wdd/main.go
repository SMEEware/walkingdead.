package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/term"
	"walkingdead/internal/model"
	"walkingdead/internal/server"
	"walkingdead/internal/vault"
	"walkingdead/internal/webui"
)

var version = "dev"
var errNotInitialized = errors.New("vault is not initialized")

func main() {
	if vault.TestCredentials {
		fmt.Fprintln(os.Stderr, "Development test-credentials build: management is restricted to loopback.")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdin, os.Stdout, os.Stderr); err != nil {
		if !errors.Is(err, errNotInitialized) {
			fmt.Fprintln(os.Stderr, "wdd:", err)
		}
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, input io.Reader, output, diagnostic io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: wdd init|initialized|serve|recover|backup|restore|verify|version [options]")
	}
	if args[0] == "version" {
		return json.NewEncoder(output).Encode(map[string]string{"version": version})
	}
	if args[0] != "init" && args[0] != "initialized" && args[0] != "serve" && args[0] != "recover" && args[0] != "backup" && args[0] != "restore" && args[0] != "verify" {
		return errors.New("unknown command; use init, initialized, serve, recover, backup, restore, verify, or version")
	}
	flags := flag.NewFlagSet("wdd "+args[0], flag.ContinueOnError)
	flags.SetOutput(diagnostic)
	dir := flags.String("data-dir", ".local/data", "private persistent vault directory")
	passwordFile := flags.String("password-file", "", "private password file, or - for explicit stdin; default is a hidden terminal prompt")
	var username, recoveryFile, listen, certFile, keyFile, httpAddress, backupPath string
	var origins stringList
	switch args[0] {
	case "init":
		flags.StringVar(&username, "username", "", "owner username")
	case "recover":
		flags.StringVar(&recoveryFile, "recovery-file", "", "private recovery-code file; default is a hidden terminal prompt")
	case "backup":
		flags.StringVar(&backupPath, "output", "", "new backup file inside a private existing directory")
	case "restore":
		flags.StringVar(&backupPath, "backup-file", "", "private encrypted backup file")
	case "serve":
		flags.StringVar(&listen, "listen", "127.0.0.1:8080", "management listen IP and port")
		flags.StringVar(&certFile, "tls-cert", "", "TLS certificate file")
		flags.StringVar(&keyFile, "tls-key", "", "private TLS key file")
		flags.StringVar(&httpAddress, "http-address", "", "override the persisted HTTP honeypot listen IP and port")
		flags.Var(&origins, "allowed-origin", "explicit development UI loopback origin; may be repeated")
	}
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	if (args[0] == "backup" || args[0] == "restore") && backupPath == "" {
		return errors.New("backup requires --output; restore requires --backup-file")
	}
	if args[0] == "initialized" {
		initialized, err := vault.Initialized(*dir)
		if err != nil {
			return err
		}
		if !initialized {
			return errNotInitialized
		}
		return nil
	}
	if args[0] == "init" && username == "" {
		return errors.New("--username is required")
	}
	if args[0] == "init" && vault.Exists(*dir) {
		return errors.New("vault already exists; refusing to overwrite")
	}
	if args[0] == "serve" {
		if (certFile == "") != (keyFile == "") {
			return errors.New("--tls-cert and --tls-key must be supplied together")
		}
		if err := validateListen(listen, certFile != ""); err != nil {
			return err
		}
		if httpAddress != "" {
			if err := validateIPPort(httpAddress); err != nil {
				return fmt.Errorf("--http-address: %w", err)
			}
		}
	}
	if args[0] == "recover" && recoveryFile == "-" && *passwordFile == "-" {
		return errors.New("recovery code and new password cannot share stdin")
	}
	passwordLabel := "Password"
	if args[0] == "recover" {
		passwordLabel = "New password"
	}
	password, err := readSecret(*passwordFile, passwordLabel, args[0] == "init" || args[0] == "recover", input, diagnostic)
	if err != nil {
		return err
	}
	defer clear(password)
	switch args[0] {
	case "backup", "verify":
		store, err := vault.Open(*dir, password)
		if err != nil {
			return err
		}
		defer store.Close()
		if args[0] == "backup" {
			if err = store.Backup(backupPath); err != nil {
				return err
			}
		}
		return json.NewEncoder(output).Encode(map[string]any{"operation": args[0], "verified": true, "dataDir": *dir})
	case "restore":
		store, err := vault.Restore(backupPath, *dir, password)
		if err != nil {
			return err
		}
		defer store.Close()
		return json.NewEncoder(output).Encode(map[string]any{"restored": true, "collectionStopped": true, "dataDir": *dir})
	case "init":
		store, recovery, err := vault.Create(*dir, username, password)
		if err != nil {
			return err
		}
		defer store.Close()
		return json.NewEncoder(output).Encode(map[string]string{"username": store.Username(), "dataDir": *dir, "recoveryCode": recovery})
	case "recover":
		recovery, err := readSecret(recoveryFile, "Recovery code", false, input, diagnostic)
		if err != nil {
			return err
		}
		defer clear(recovery)
		store, err := vault.Recover(*dir, recovery, password)
		if err != nil {
			return err
		}
		defer store.Close()
		return json.NewEncoder(output).Encode(map[string]any{"recovered": true, "username": store.Username()})
	default:
		store, err := vault.Open(*dir, password)
		if err != nil {
			return err
		}
		defer store.Close()
		clear(password)
		if httpAddress != "" {
			if err = store.Update(func(state *model.State) error { state.Config.HTTPAddress = httpAddress; return nil }); err != nil {
				return err
			}
		}
		return serve(ctx, store, listen, certFile, keyFile, origins, output)
	}
}

func serve(ctx context.Context, store *vault.Store, address, certFile, keyFile string, origins []string, output io.Writer) error {
	var tlsConfig *tls.Config
	if certFile != "" {
		if err := validateSecretFile(keyFile); err != nil {
			return fmt.Errorf("TLS key: %w", err)
		}
		certificate, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return err
		}
		tlsConfig = &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{certificate}}
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	defer listener.Close()
	application, err := server.New(store, server.Options{WebFS: webui.FS(), AllowedOrigins: origins, Logger: slog.New(slog.NewJSONHandler(os.Stderr, nil))})
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = application.Close(closeCtx)
	}()
	httpServer := &http.Server{Handler: application.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 * 1024, TLSConfig: tlsConfig}
	defer httpServer.Close()
	protocol := "http"
	if tlsConfig != nil {
		protocol = "https"
	}
	if err = json.NewEncoder(output).Encode(map[string]string{"version": version, "listen": protocol + "://" + listener.Addr().String()}); err != nil {
		return err
	}
	result := make(chan error, 1)
	go func() {
		if tlsConfig != nil {
			result <- httpServer.ServeTLS(listener, "", "")
		} else {
			result <- httpServer.Serve(listener)
		}
	}()
	select {
	case err = <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		collectorErr := application.Close(shutdownCtx)
		shutdownErr := httpServer.Shutdown(shutdownCtx)
		if shutdownErr != nil {
			_ = httpServer.Close()
		}
		serveErr := <-result
		if !errors.Is(serveErr, http.ErrServerClosed) {
			return serveErr
		}
		return errors.Join(collectorErr, shutdownErr)
	}
}

func validateListen(address string, secure bool) error {
	if err := validateIPPort(address); err != nil {
		return err
	}
	host, _, _ := net.SplitHostPort(address)
	ip := net.ParseIP(host)
	if vault.TestCredentials && (ip == nil || !ip.IsLoopback()) {
		return errors.New("development test builds can only bind management to loopback")
	}
	if !secure && (ip == nil || !ip.IsLoopback()) {
		return errors.New("TLS is required when management listens beyond loopback")
	}
	return nil
}

func validateIPPort(address string) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return errors.New("listen address must be an IP literal and port")
	}
	if host != "" && net.ParseIP(host) == nil {
		return errors.New("listen host must be an IP literal")
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 0 || n > 65535 {
		return errors.New("invalid listen port")
	}
	return nil
}

func readSecret(path, label string, confirm bool, input io.Reader, diagnostic io.Writer) ([]byte, error) {
	if path != "" {
		var reader io.Reader = input
		if path != "-" {
			if err := validateSecretFile(path); err != nil {
				return nil, err
			}
			f, err := os.Open(path)
			if err != nil {
				return nil, err
			}
			defer f.Close()
			reader = f
		}
		data, err := io.ReadAll(io.LimitReader(reader, 1027))
		if err != nil {
			return nil, err
		}
		if len(data) > 1026 {
			clear(data)
			return nil, errors.New("credential exceeds size limit")
		}
		data = bytes.TrimSuffix(data, []byte("\n"))
		data = bytes.TrimSuffix(data, []byte("\r"))
		if len(data) == 0 || len(data) > 1024 {
			clear(data)
			return nil, errors.New("credential must contain 1 to 1024 bytes")
		}
		return data, nil
	}
	f, ok := input.(*os.File)
	if !ok || !term.IsTerminal(int(f.Fd())) {
		return nil, errors.New("a terminal or explicit --password-file is required; use - to read stdin")
	}
	fmt.Fprint(diagnostic, label+": ")
	secret, err := term.ReadPassword(int(f.Fd()))
	fmt.Fprintln(diagnostic)
	if err != nil {
		return nil, err
	}
	if len(secret) == 0 || len(secret) > 1024 {
		clear(secret)
		return nil, errors.New("credential must contain 1 to 1024 bytes")
	}
	if confirm {
		fmt.Fprint(diagnostic, "Confirm "+strings.ToLower(label)+": ")
		repeated, readErr := term.ReadPassword(int(f.Fd()))
		fmt.Fprintln(diagnostic)
		matches := bytes.Equal(secret, repeated)
		clear(repeated)
		if readErr != nil {
			clear(secret)
			return nil, readErr
		}
		if !matches {
			clear(secret)
			return nil, errors.New("credentials do not match")
		}
	}
	return secret, nil
}

type stringList []string

func (s *stringList) String() string         { return strings.Join(*s, ",") }
func (s *stringList) Set(value string) error { *s = append(*s, value); return nil }
