package vault

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"walkingdead/internal/model"
)

var testPassword = []byte("correct horse battery staple")

func newTestStore(t *testing.T) (*Store, string, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "vault")
	s, recovery, err := Create(dir, "owner", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s, dir, recovery
}

func TestEncryptedPersistenceAndAuthentication(t *testing.T) {
	s, dir, _ := newTestStore(t)
	if !Exists(dir) || s.Username() != "owner" {
		t.Fatal("missing vault owner")
	}
	if !s.CheckPassword("owner", testPassword) || s.CheckPassword("other", testPassword) || s.CheckPassword("owner", []byte("wrong")) {
		t.Fatal("password authentication failed")
	}
	err := s.Update(func(state *model.State) error {
		state.Keys = append(state.Keys, model.APIKey{ID: "key_1", Hash: "private-key-verifier"})
		state.Events = append(state.Events, model.Event{ID: "event_1", Payload: "secret-captured-command"})
		state.Config.Running = true
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "vault.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{string(testPassword), "private-key-verifier", "secret-captured-command", "event_1"} {
		if bytes.Contains(data, []byte(secret)) {
			t.Fatalf("plaintext leaked: %s", secret)
		}
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dir, testPassword)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	state := s.Snapshot()
	if !state.Config.Running || len(state.Keys) != 1 || state.Keys[0].Hash != "private-key-verifier" || state.Events[0].Payload != "secret-captured-command" {
		t.Fatal("encrypted state did not survive restart")
	}
	state.Keys[0].Hash = "changed"
	if s.Snapshot().Keys[0].Hash == "changed" {
		t.Fatal("Snapshot exposes mutable state")
	}
}

func TestExclusiveLockAndRefuseOverwrite(t *testing.T) {
	s, dir, _ := newTestStore(t)
	if second, err := Open(dir, testPassword); err == nil {
		second.Close()
		t.Fatal("second opener obtained lock")
	}
	if second, _, err := Create(dir, "owner", testPassword); err == nil {
		second.Close()
		t.Fatal("overwrote existing vault")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if second, _, err := Create(dir, "owner", testPassword); err == nil {
		second.Close()
		t.Fatal("overwrote unlocked vault")
	}
}

func TestWrongPasswordAndTamperingFailClosed(t *testing.T) {
	s, dir, _ := newTestStore(t)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if opened, err := Open(dir, []byte("wrong password")); err == nil {
		opened.Close()
		t.Fatal("wrong password opened vault")
	}
	path := filepath.Join(dir, "vault.json")
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err = json.Unmarshal(original, &doc); err != nil {
		t.Fatal(err)
	}
	doc["username"] = "attacker"
	data, _ := json.Marshal(doc)
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if opened, err := Open(dir, testPassword); err == nil {
		opened.Close()
		t.Fatal("modified metadata opened vault")
	}
	if err = os.WriteFile(path, original[:len(original)/2], 0600); err != nil {
		t.Fatal(err)
	}
	if opened, err := Open(dir, testPassword); err == nil {
		opened.Close()
		t.Fatal("truncated vault opened")
	}
}

func TestUpdateRollsBackOnCallbackAndWriteFailure(t *testing.T) {
	s, dir, _ := newTestStore(t)
	err := s.Update(func(state *model.State) error { state.Config.Running = true; return errors.New("rejected") })
	if err == nil || s.Snapshot().Config.Running {
		t.Fatal("callback failure committed")
	}
	held := dir + ".held"
	if err = os.Rename(dir, held); err != nil {
		t.Fatal(err)
	}
	err = s.Update(func(state *model.State) error { state.Config.Running = true; return nil })
	if restoreErr := os.Rename(held, dir); restoreErr != nil {
		t.Fatal(restoreErr)
	}
	if err == nil || s.Snapshot().Config.Running {
		t.Fatal("failed write committed in memory")
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(dir, testPassword)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if reopened.Snapshot().Config.Running {
		t.Fatal("failed write committed on disk")
	}
}

func TestRecoveryRewrapsExistingState(t *testing.T) {
	s, dir, code := newTestStore(t)
	if err := s.Update(func(state *model.State) error { state.Events = []model.Event{{ID: "preserved"}}; return nil }); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	newPassword := []byte("replacement password for owner")
	if opened, err := Recover(dir, []byte("invalid recovery"), newPassword); err == nil {
		opened.Close()
		t.Fatal("invalid recovery accepted")
	}
	recovered, err := Recover(dir, []byte(code), newPassword)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Snapshot().Events[0].ID != "preserved" {
		t.Fatal("recovery lost state")
	}
	if err = recovered.Close(); err != nil {
		t.Fatal(err)
	}
	if opened, err := Open(dir, testPassword); err == nil {
		opened.Close()
		t.Fatal("old password still opens recovered vault")
	}
	opened, err := Open(dir, newPassword)
	if err != nil {
		t.Fatal(err)
	}
	opened.Close()
}

func TestPrivatePermissionsAndSymlinkRejection(t *testing.T) {
	s, dir, _ := newTestStore(t)
	for _, path := range []string{dir, filepath.Join(dir, "vault.json"), filepath.Join(dir, ".vault.lock")} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm()&0077 != 0 {
			t.Fatalf("insecure permissions: %s", path)
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if opened, err := Open(dir, testPassword); err == nil {
		opened.Close()
		t.Fatal("public directory accepted")
	}
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(dir, link); err != nil {
		t.Fatal(err)
	}
	if opened, err := Open(link, testPassword); err == nil {
		opened.Close()
		t.Fatal("symlinked directory accepted")
	}
	if opened, err := Open(link+string(os.PathSeparator), testPassword); err == nil {
		opened.Close()
		t.Fatal("symlinked directory with trailing separator accepted")
	}
}

func TestBoundedStateAndClosedStore(t *testing.T) {
	s, _, _ := newTestStore(t)
	if err := s.Update(func(state *model.State) error {
		state.Events = make([]model.Event, 10005)
		state.Audits = make([]model.Audit, 10005)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	state := s.Snapshot()
	if len(state.Events) != 10000 || len(state.Audits) != 10000 {
		t.Fatal("snapshot retention is unbounded")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if s.CheckPassword("owner", testPassword) {
		t.Fatal("closed store authenticates")
	}
	if err := s.Update(func(*model.State) error { return nil }); err == nil {
		t.Fatal("closed store updates")
	}
}

func TestRejectsCiphertextEnvelopeAndKDFCorruption(t *testing.T) {
	s, dir, _ := newTestStore(t)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, filename)
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*document){
		func(d *document) { d.Ciphertext[0] ^= 1 },
		func(d *document) { d.Recovery.Ciphertext[0] ^= 1 },
		func(d *document) { d.Password.Memory = ^uint32(0) },
		func(d *document) { d.Password.Threads = 0 },
		func(d *document) { d.Nonce = d.Nonce[:1] },
	} {
		var d document
		if err = json.Unmarshal(original, &d); err != nil {
			t.Fatal(err)
		}
		mutate(&d)
		data, _ := json.Marshal(d)
		if err = os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
		if opened, openErr := Open(dir, testPassword); openErr == nil {
			opened.Close()
			t.Fatal("corruption accepted")
		}
	}
	if err = os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	opened, err := Open(dir, testPassword)
	if err != nil {
		t.Fatal("failed opens retained process lock:", err)
	}
	opened.Close()
}

func TestInitializationInspectionAndRandomNonces(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "missing")
	if yes, err := Initialized(dir); yes || err != nil {
		t.Fatal("missing vault reported initialized")
	}
	s, dir, _ := newTestStore(t)
	if yes, err := Initialized(dir); !yes || err != nil {
		t.Fatal("valid vault not reported initialized:", err)
	}
	before := append([]byte{}, s.doc.Nonce...)
	if bytes.Equal(s.doc.Password.Salt, s.doc.Recovery.Salt) || bytes.Equal(s.doc.Password.Nonce, s.doc.Recovery.Nonce) {
		t.Fatal("key wraps share random material")
	}
	if err := s.Update(func(*model.State) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(before, s.doc.Nonce) {
		t.Fatal("snapshot reused a nonce")
	}
}

func TestAvailabilityFailsClosed(t *testing.T) {
	s, _, _ := newTestStore(t)
	if !s.Available() {
		t.Fatal("unlocked vault unavailable")
	}
	s.mu.Lock()
	s.poisoned = true
	s.mu.Unlock()
	if s.Available() {
		t.Fatal("uncertain durability reported available")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if s.Available() {
		t.Fatal("closed vault reported available")
	}
}

func TestAPIKeysAreDetachedAndUnavailableWhenClosed(t *testing.T) {
	s, _, _ := newTestStore(t)
	if err := s.Update(func(state *model.State) error {
		state.Keys = []model.APIKey{{ID: "key_1", Hash: "private-verifier", Scopes: []string{"system:read"}}}
		state.Events = []model.Event{{ID: "unrelated-evidence"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	keys := s.APIKeys()
	if len(keys) != 1 || keys[0].Hash != "private-verifier" {
		t.Fatal("missing key metadata")
	}
	keys[0].Scopes[0] = "system:write"
	keys[0].Hash = "changed"
	if current := s.APIKeys(); current[0].Scopes[0] != "system:read" || current[0].Hash != "private-verifier" {
		t.Fatal("APIKeys exposes mutable state")
	}
	s.mu.Lock()
	s.poisoned = true
	s.mu.Unlock()
	if s.APIKeys() != nil {
		t.Fatal("unavailable store returned keys")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if s.APIKeys() != nil {
		t.Fatal("closed store returned keys")
	}
}

func TestAIConfigIsPrivateAndLegacyDefaultsStayDisabled(t *testing.T) {
	store, dir, _ := newTestStore(t)
	if err := store.Update(func(state *model.State) error { state.AI = model.AIConfig{}; return nil }); err != nil {
		t.Fatal(err)
	}
	legacy := store.AIConfig()
	if legacy.Enabled || !legacy.RedactIPs || legacy.Model != "deepseek-flash" {
		t.Fatal("unsafe legacy AI defaults")
	}
	if err := store.Update(func(state *model.State) error {
		state.AI = model.AIConfig{Key: "synthetic-provider-secret", Model: "deepseek-flash", RedactIPs: true}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "vault.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("synthetic-provider-secret")) {
		t.Fatal("provider key stored in plaintext")
	}
	config := store.AIConfig()
	config.Key = "mutated"
	if store.AIConfig().Key != "synthetic-provider-secret" {
		t.Fatal("AI config exposes mutable state")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if store.AIConfig().Key != "" {
		t.Fatal("closed store exposes provider credentials")
	}
}
