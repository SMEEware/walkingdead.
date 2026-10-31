package vault

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"golang.org/x/crypto/argon2"
	"walkingdead/internal/model"
)

const (
	filename    = "vault.json"
	maxFileSize = 64 << 20
	maxRecords  = 10000
	kdfMemory   = 64 * 1024
	kdfTime     = 3
	kdfThreads  = 1
)

var ErrLocked = errors.New("vault is already open by another process")
var ErrUnlock = errors.New("invalid credentials or damaged vault")

type keyEnvelope struct {
	Salt       []byte `json:"salt"`
	Memory     uint32 `json:"memory"`
	Time       uint32 `json:"time"`
	Threads    uint8  `json:"threads"`
	Nonce      []byte `json:"nonce"`
	Ciphertext []byte `json:"ciphertext"`
}

type document struct {
	Version    int         `json:"version"`
	Username   string      `json:"username"`
	Password   keyEnvelope `json:"password"`
	Recovery   keyEnvelope `json:"recovery"`
	Nonce      []byte      `json:"nonce"`
	Ciphertext []byte      `json:"ciphertext"`
}

type Store struct {
	mu       sync.RWMutex
	authMu   sync.Mutex
	dir      string
	lock     *os.File
	doc      document
	key      []byte
	state    model.State
	closed   bool
	poisoned bool
}

func Exists(dir string) bool {
	_, err := os.Lstat(filepath.Join(dir, filename))
	return err == nil || !errors.Is(err, os.ErrNotExist)
}

func Initialized(dir string) (bool, error) {
	if _, err := os.Lstat(filepath.Join(dir, filename)); errors.Is(err, os.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	if err := prepareDir(dir, false); err != nil {
		return false, err
	}
	data, err := readPrivate(filepath.Join(dir, filename))
	if err != nil {
		return false, err
	}
	defer clear(data)
	var d document
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&d); err != nil || !validDocument(d) {
		return false, errors.New("invalid vault metadata")
	}
	if err = decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return false, errors.New("invalid vault metadata")
	}
	return true, nil
}

func Create(dir, username string, password []byte) (*Store, string, error) {
	if err := validateIdentity(username, password); err != nil {
		return nil, "", err
	}
	if err := prepareDir(dir, true); err != nil {
		return nil, "", err
	}
	lock, err := acquireLock(dir)
	if err != nil {
		return nil, "", err
	}
	s := &Store{dir: dir, lock: lock, state: model.InitialState()}
	s.state.Config.TestInstance = TestCredentials
	ok := false
	defer func() {
		if !ok {
			_ = s.Close()
		}
	}()
	if Exists(dir) {
		return nil, "", errors.New("vault already exists; refusing to overwrite")
	}
	s.key = make([]byte, 32)
	if _, err = rand.Read(s.key); err != nil {
		return nil, "", err
	}
	recoveryBytes := make([]byte, 32)
	if _, err = rand.Read(recoveryBytes); err != nil {
		return nil, "", err
	}
	recovery := base64.RawURLEncoding.EncodeToString(recoveryBytes)
	clear(recoveryBytes)
	s.doc = document{Version: 1, Username: username}
	s.doc.Password, err = wrapKey(password, s.key, username, "password")
	if err != nil {
		return nil, "", err
	}
	s.doc.Recovery, err = wrapKey([]byte(recovery), s.key, username, "recovery")
	if err != nil {
		return nil, "", err
	}
	if err = s.persist(s.state, true); err != nil {
		return nil, "", err
	}
	ok = true
	return s, recovery, nil
}

func Open(dir string, password []byte) (*Store, error) { return unlock(dir, password, false) }

func Recover(dir string, recovery, newPassword []byte) (*Store, error) {
	if len(newPassword) < minimumPasswordBytes || len(newPassword) > 1024 {
		return nil, fmt.Errorf("password must contain %d to 1024 bytes", minimumPasswordBytes)
	}
	s, err := unlock(dir, recovery, true)
	if err != nil {
		return nil, err
	}
	envelope, err := wrapKey(newPassword, s.key, s.doc.Username, "password")
	if err != nil {
		_ = s.Close()
		return nil, err
	}
	s.doc.Password = envelope
	if err = s.persist(s.state, false); err != nil {
		_ = s.Close()
		return nil, err
	}
	return s, nil
}

func unlock(dir string, secret []byte, recovery bool) (*Store, error) {
	if len(secret) == 0 || len(secret) > 1024 {
		return nil, ErrUnlock
	}
	if err := prepareDir(dir, false); err != nil {
		return nil, err
	}
	lock, err := acquireLock(dir)
	if err != nil {
		return nil, err
	}
	s := &Store{dir: dir, lock: lock}
	ok := false
	defer func() {
		if !ok {
			_ = s.Close()
		}
	}()
	data, err := readPrivate(filepath.Join(dir, filename))
	if err != nil {
		return nil, err
	}
	defer clear(data)
	if err = s.load(data, secret, recovery); err != nil {
		return nil, err
	}
	ok = true
	return s, nil
}

func (s *Store) load(data, secret []byte, recovery bool) error {
	var err error
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&s.doc); err != nil {
		return ErrUnlock
	}
	if err = dec.Decode(new(any)); !errors.Is(err, io.EOF) {
		return ErrUnlock
	}
	if !validDocument(s.doc) {
		return ErrUnlock
	}
	envelope, purpose := s.doc.Password, "password"
	if recovery {
		envelope, purpose = s.doc.Recovery, "recovery"
	}
	s.key, err = unwrapKey(secret, envelope, s.doc.Username, purpose)
	if err != nil {
		return ErrUnlock
	}
	plaintext, err := openCipher(s.key, s.doc.Nonce, s.doc.Ciphertext, stateAAD(s.doc))
	if err != nil {
		return ErrUnlock
	}
	defer clear(plaintext)
	if err = json.Unmarshal(plaintext, &s.state); err != nil {
		return ErrUnlock
	}
	if s.state.Config.TestInstance && !TestCredentials {
		return errors.New("a development test vault cannot be opened by a release build")
	}
	if len(s.state.Events) > maxRecords || len(s.state.Audits) > maxRecords || len(s.state.Notifications) > maxRecords || len(s.state.Keys) > 1000 || len(s.state.Summaries) > 1000 {
		return ErrUnlock
	}
	return nil
}

func (s *Store) Username() string { s.mu.RLock(); defer s.mu.RUnlock(); return s.doc.Username }

func (s *Store) Available() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return !s.closed && !s.poisoned
}

func (s *Store) Config() model.Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed || s.poisoned {
		return model.Config{}
	}
	return s.state.Config.Clone()
}

func (s *Store) AIConfig() model.AIConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed || s.poisoned {
		return model.AIConfig{}
	}
	config := s.state.AI
	if config.Model == "" {
		config.Model, config.RedactIPs = "deepseek-flash", true
	}
	return config
}

func (s *Store) APIKeys() []model.APIKey {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed || s.poisoned {
		return nil
	}
	keys := make([]model.APIKey, len(s.state.Keys))
	copy(keys, s.state.Keys)
	for i := range keys {
		keys[i].Scopes = append([]string(nil), keys[i].Scopes...)
	}
	return keys
}

func (s *Store) CheckPassword(username string, password []byte) bool {
	if len(password) == 0 || len(password) > 1024 {
		return false
	}
	s.authMu.Lock()
	defer s.authMu.Unlock()
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed || s.poisoned || username != s.doc.Username {
		return false
	}
	key, err := unwrapKey(password, s.doc.Password, s.doc.Username, "password")
	if err != nil {
		return false
	}
	defer clear(key)
	return subtle.ConstantTimeCompare(key, s.key) == 1
}

func (s *Store) Snapshot() model.State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed || s.poisoned {
		return model.State{}
	}
	state, _ := clone(s.state)
	return state
}

func (s *Store) Update(change func(*model.State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.poisoned {
		return errors.New("vault is closed or storage durability is uncertain; restart is required")
	}
	next, err := clone(s.state)
	if err != nil {
		return err
	}
	if err = change(&next); err != nil {
		return err
	}
	if len(next.Events) > maxRecords {
		next.Events = next.Events[len(next.Events)-maxRecords:]
	}
	if len(next.Audits) > maxRecords {
		next.Audits = next.Audits[len(next.Audits)-maxRecords:]
	}
	if len(next.Notifications) > maxRecords {
		next.Notifications = next.Notifications[len(next.Notifications)-maxRecords:]
	}
	if len(next.Keys) > 1000 || len(next.Summaries) > 1000 {
		return errors.New("vault record limit exceeded")
	}
	// Detach callback-owned slices before making the durable state visible.
	next, err = clone(next)
	if err != nil {
		return err
	}
	if err = s.persist(next, false); err != nil {
		return err
	}
	s.state = next
	return nil
}

func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	clear(s.key)
	s.key = nil
	s.state = model.State{}
	if s.lock != nil {
		err := s.lock.Close()
		s.lock = nil
		return err
	}
	return nil
}

func validateIdentity(username string, password []byte) error {
	if username == "" || username != strings.TrimSpace(username) || len(username) > 128 || strings.ContainsAny(username, "\x00\r\n") {
		return errors.New("username must contain 1 to 128 bytes without surrounding whitespace or control characters")
	}
	if len(password) < minimumPasswordBytes || len(password) > 1024 {
		return fmt.Errorf("password must contain %d to 1024 bytes", minimumPasswordBytes)
	}
	return nil
}

func validEnvelope(e keyEnvelope) bool {
	return e.Memory == kdfMemory && e.Time == kdfTime && e.Threads == kdfThreads && len(e.Salt) == 32 && len(e.Nonce) == 12 && len(e.Ciphertext) == 48
}

func validDocument(d document) bool {
	return d.Version == 1 && d.Username != "" && len(d.Username) <= 128 && validEnvelope(d.Password) && validEnvelope(d.Recovery) && len(d.Nonce) == 12 && len(d.Ciphertext) >= 16
}

func aad(username, purpose string) []byte {
	return []byte("walkingdead:vault:v1:" + purpose + ":" + username)
}

func stateAAD(d document) []byte {
	header, _ := json.Marshal(struct {
		Version  int         `json:"version"`
		Username string      `json:"username"`
		Password keyEnvelope `json:"password"`
		Recovery keyEnvelope `json:"recovery"`
	}{d.Version, d.Username, d.Password, d.Recovery})
	return append([]byte("walkingdead:vault:state:"), header...)
}

func wrapKey(secret, key []byte, username, purpose string) (keyEnvelope, error) {
	e := keyEnvelope{Salt: make([]byte, 32), Memory: kdfMemory, Time: kdfTime, Threads: kdfThreads}
	if _, err := rand.Read(e.Salt); err != nil {
		return e, err
	}
	derived := argon2.IDKey(secret, e.Salt, e.Time, e.Memory, e.Threads, 32)
	defer clear(derived)
	var err error
	e.Nonce, e.Ciphertext, err = seal(derived, key, aad(username, purpose))
	return e, err
}

func unwrapKey(secret []byte, e keyEnvelope, username, purpose string) ([]byte, error) {
	if !validEnvelope(e) {
		return nil, ErrUnlock
	}
	derived := argon2.IDKey(secret, e.Salt, e.Time, e.Memory, e.Threads, 32)
	defer clear(derived)
	return openCipher(derived, e.Nonce, e.Ciphertext, aad(username, purpose))
}

func seal(key, plaintext, additional []byte) ([]byte, []byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, nil, err
	}
	return nonce, gcm.Seal(nil, nonce, plaintext, additional), nil
}

func openCipher(key, nonce, ciphertext, additional []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(nonce) != gcm.NonceSize() || len(ciphertext) < gcm.Overhead() {
		return nil, ErrUnlock
	}
	return gcm.Open(nil, nonce, ciphertext, additional)
}

func clone(state model.State) (model.State, error) {
	state.Events = slices.Clone(state.Events)
	state.Keys = slices.Clone(state.Keys)
	for i := range state.Keys {
		state.Keys[i].Scopes = slices.Clone(state.Keys[i].Scopes)
	}
	state.Config = state.Config.Clone()
	state.Blocklist = slices.Clone(state.Blocklist)
	state.Audits = slices.Clone(state.Audits)
	state.Summaries = slices.Clone(state.Summaries)
	state.Notifications = slices.Clone(state.Notifications)
	for i := range state.Notifications {
		state.Notifications[i].Ref = maps.Clone(state.Notifications[i].Ref)
	}
	return state, nil
}

func (s *Store) persist(state model.State, initial bool) error {
	plaintext, err := json.Marshal(state)
	if err != nil {
		return err
	}
	defer clear(plaintext)
	if len(plaintext) > maxFileSize/2 {
		return errors.New("vault snapshot exceeds size limit")
	}
	next := s.doc
	next.Nonce, next.Ciphertext, err = seal(s.key, plaintext, stateAAD(next))
	if err != nil {
		return err
	}
	data, err := json.Marshal(next)
	if err != nil {
		return err
	}
	defer clear(data)
	if err = atomicWrite(s.dir, data, initial); err != nil {
		var uncertain *durabilityError
		if errors.As(err, &uncertain) {
			s.poisoned = true
		}
		return err
	}
	s.doc = next
	return nil
}

func readPrivate(path string) ([]byte, error) {
	if err := checkPrivate(path, false); err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() > maxFileSize {
		return nil, errors.New("vault exceeds size limit")
	}
	data, err := io.ReadAll(io.LimitReader(f, maxFileSize+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxFileSize {
		clear(data)
		return nil, errors.New("vault exceeds size limit")
	}
	return data, nil
}

func atomicWrite(dir string, data []byte, initial bool) error {
	if err := prepareDir(dir, false); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".vault-write-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	path := filepath.Join(dir, filename)
	if initial {
		if err = os.Link(name, path); err != nil {
			return fmt.Errorf("create vault: %w", err)
		}
	} else if err = os.Rename(name, path); err != nil {
		return fmt.Errorf("replace vault: %w", err)
	}
	d, err := os.Open(dir)
	if err != nil {
		return &durabilityError{err}
	}
	defer d.Close()
	if err = d.Sync(); err != nil {
		return &durabilityError{err}
	}
	return nil
}

type durabilityError struct{ err error }

func (e *durabilityError) Error() string {
	return "vault write durability is uncertain; restart is required: " + e.err.Error()
}
func (e *durabilityError) Unwrap() error { return e.err }
