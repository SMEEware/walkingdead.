package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"walkingdead/internal/vault"
)

func TestInitAndRecoveryFromPrivateFiles(t *testing.T) {
	dir := t.TempDir()
	passwordFile := filepath.Join(dir, "password")
	if err := os.WriteFile(passwordFile, []byte("long test password for vault\n"), 0600); err != nil {
		t.Fatal(err)
	}
	dataDir := filepath.Join(dir, "data")
	var output, diagnostics bytes.Buffer
	if err := run(context.Background(), []string{"init", "--data-dir", dataDir, "--username", "owner", "--password-file", passwordFile}, strings.NewReader(""), &output, &diagnostics); err != nil {
		t.Fatal(err)
	}
	var result struct {
		RecoveryCode string `json:"recoveryCode"`
	}
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.RecoveryCode) < 40 || strings.Contains(output.String(), "long test password") {
		t.Fatal("invalid init output")
	}
	if err := run(context.Background(), []string{"init", "--data-dir", dataDir, "--username", "owner", "--password-file", passwordFile}, strings.NewReader(""), &output, &diagnostics); err == nil {
		t.Fatal("overwrote vault")
	}
	recoveryFile := filepath.Join(dir, "recovery")
	if err := os.WriteFile(recoveryFile, []byte(result.RecoveryCode), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(passwordFile, []byte("new test password for vault"), 0600); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	if err := run(context.Background(), []string{"recover", "--data-dir", dataDir, "--recovery-file", recoveryFile, "--password-file", passwordFile}, strings.NewReader(""), &output, &diagnostics); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(output.String(), result.RecoveryCode) {
		t.Fatal("recovery code redisplayed")
	}
}

func TestInitializedIsQuietAndServeReleasesPort(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	var output, diagnostic bytes.Buffer
	if err := run(context.Background(), []string{"initialized", "--data-dir", dir}, strings.NewReader(""), &output, &diagnostic); !errors.Is(err, errNotInitialized) {
		t.Fatal("missing initialization not reported")
	}
	store, _, err := vault.Create(dir, "owner", []byte("long test password for vault"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err = run(context.Background(), []string{"initialized", "--data-dir", dir}, strings.NewReader(""), &output, &diagnostic); err != nil || output.Len() != 0 || diagnostic.Len() != 0 {
		t.Fatal("initialized status was not quiet:", err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { result <- serve(ctx, store, address, "", "", nil, io.Discard) }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		connection, dialErr := net.DialTimeout("tcp", address, 50*time.Millisecond)
		if dialErr == nil {
			connection.Close()
			break
		}
		if time.Now().After(deadline) {
			cancel()
			t.Fatal("management listener did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case err = <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown did not complete")
	}
	listener, err = net.Listen("tcp", address)
	if err != nil {
		t.Fatal("listener not released:", err)
	}
	listener.Close()
}

func TestCredentialFilesAndNetworkPolicy(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(path, []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := readSecret(path, "Password", false, strings.NewReader(""), &bytes.Buffer{}); err == nil {
		t.Fatal("public password file accepted")
	}
	if _, err := readSecret("", "Password", false, strings.NewReader("secret"), &bytes.Buffer{}); err == nil {
		t.Fatal("implicit non-TTY stdin accepted")
	}
	secret, err := readSecret("-", "Password", false, strings.NewReader("explicit stdin\n"), &bytes.Buffer{})
	if err != nil || string(secret) != "explicit stdin" {
		t.Fatal("explicit stdin unavailable")
	}
	for _, tc := range []struct {
		address string
		tls     bool
		valid   bool
	}{{"127.0.0.1:8080", false, true}, {"[::1]:8080", false, true}, {"0.0.0.0:8080", false, false}, {":8080", false, false}, {"0.0.0.0:8080", true, true}, {"example.com:8080", true, false}} {
		if err := validateListen(tc.address, tc.tls); (err == nil) != tc.valid {
			t.Errorf("validateListen(%q,%v): %v", tc.address, tc.tls, err)
		}
	}
}
