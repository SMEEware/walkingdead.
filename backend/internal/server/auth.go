package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"net"
	"net/http"
	"slices"
	"strings"
	"time"

	"walkingdead/internal/model"
)

const cookieName = "wd_session"
const sessionLifetime = 8 * time.Hour

var validScopes = []string{"system:read", "system:write", "events:read", "keys:read", "keys:write", "data:write", "ai:run"}

type principalKey struct{}
type principal struct {
	Actor  string
	Owner  bool
	Scopes []string
}
type session struct {
	Username string
	Expires  time.Time
}
type rateWindow struct {
	Start time.Time
	Count int
}

func newID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		panic("cryptographic randomness unavailable")
	}
	return hex.EncodeToString(value[:])
}

func newSecret() string {
	var value [32]byte
	if _, err := rand.Read(value[:]); err != nil {
		panic("cryptographic randomness unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(value[:])
}

func secretHash(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func (s *Server) allowLogin(address string) bool {
	ip, _, err := net.SplitHostPort(address)
	if err != nil {
		ip = address
	}
	now := time.Now()
	s.authMu.Lock()
	defer s.authMu.Unlock()
	for key, rate := range s.loginRates {
		if now.Sub(rate.Start) > time.Minute {
			delete(s.loginRates, key)
		}
	}
	global := s.globalLogins
	if now.Sub(global.Start) > time.Minute {
		global = rateWindow{Start: now}
	}
	if global.Count >= 50 {
		return false
	}
	window, exists := s.loginRates[ip]
	if !exists {
		if len(s.loginRates) >= 1024 {
			return false
		}
		window = rateWindow{Start: now}
	}
	if window.Count >= 8 {
		return false
	}
	window.Count++
	global.Count++
	s.loginRates[ip], s.globalLogins = window, global
	return true
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if !s.store.Available() {
		fail(w, http.StatusServiceUnavailable, "The encrypted store is unavailable; resolve the storage failure and restart the daemon.")
		return
	}
	if !s.allowLogin(r.RemoteAddr) {
		w.Header().Set("Retry-After", "60")
		fail(w, http.StatusTooManyRequests, "Too many login attempts; retry in one minute.")
		return
	}
	select {
	case s.loginSlots <- struct{}{}:
		defer func() { <-s.loginSlots }()
	default:
		fail(w, http.StatusTooManyRequests, "Login verification is busy.")
		return
	}
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &input) {
		return
	}
	passwordOK := false
	if len(input.Username) <= 128 && len(input.Password) <= 1024 {
		passwordOK = s.store.CheckPassword(s.store.Username(), []byte(input.Password))
	}
	usernameOK := subtle.ConstantTimeCompare([]byte(input.Username), []byte(s.store.Username())) == 1
	if !passwordOK || !usernameOK {
		_ = s.store.Update(func(state *model.State) error { audit(state, "anonymous", "auth.login", "denied"); return nil })
		fail(w, http.StatusUnauthorized, "Invalid username or password.")
		return
	}
	secret := newSecret()
	now := time.Now()
	s.authMu.Lock()
	for key, entry := range s.sessions {
		if !entry.Expires.After(now) {
			delete(s.sessions, key)
		}
	}
	if len(s.sessions) >= 64 {
		s.authMu.Unlock()
		fail(w, http.StatusTooManyRequests, "Too many active sessions; revoke or wait for a session to expire.")
		return
	}
	s.sessions[secretHash(secret)] = session{Username: s.store.Username(), Expires: now.Add(sessionLifetime)}
	s.authMu.Unlock()
	if err := s.update("owner:"+s.store.Username(), "auth.login", func(state *model.State) error { return nil }); err != nil {
		s.authMu.Lock()
		delete(s.sessions, secretHash(secret))
		s.authMu.Unlock()
		fail(w, http.StatusInternalServerError, "Could not persist the login audit.")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: secret, Path: "/", HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteStrictMode, MaxAge: int(sessionLifetime.Seconds()), Expires: now.Add(sessionLifetime)})
	writeJSON(w, http.StatusOK, map[string]string{"username": s.store.Username()})
}

func (s *Server) authenticate(r *http.Request) (principal, bool) {
	if authorization := r.Header.Get("Authorization"); authorization != "" {
		if !strings.HasPrefix(authorization, "Bearer ") {
			return principal{}, false
		}
		secret := strings.TrimPrefix(authorization, "Bearer ")
		if len(secret) > 256 || !strings.HasPrefix(secret, "wdk_") {
			return principal{}, false
		}
		hash := secretHash(secret)
		now := time.Now().UnixMilli()
		for _, key := range s.store.APIKeys() {
			if subtle.ConstantTimeCompare([]byte(hash), []byte(key.Hash)) == 1 && key.RevokedAt == 0 && key.ExpiresAt > now {
				if now-key.LastUsedAt >= time.Minute.Milliseconds() {
					_ = s.store.Update(func(state *model.State) error {
						for i := range state.Keys {
							if state.Keys[i].ID == key.ID {
								state.Keys[i].LastUsedAt = now
							}
						}
						return nil
					})
				}
				return principal{Actor: "key:" + key.ID, Scopes: key.Scopes}, true
			}
		}
		return principal{}, false
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil || len(cookie.Value) > 256 {
		return principal{}, false
	}
	hash := secretHash(cookie.Value)
	s.authMu.Lock()
	entry, exists := s.sessions[hash]
	if exists && !entry.Expires.After(time.Now()) {
		delete(s.sessions, hash)
		exists = false
	}
	s.authMu.Unlock()
	if !exists {
		return principal{}, false
	}
	return principal{Actor: "owner:" + entry.Username, Owner: true, Scopes: validScopes}, true
}

func (s *Server) protect(scope string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.store.Available() && r.URL.Path != "/api/v1/auth/logout" {
			fail(w, http.StatusServiceUnavailable, "The encrypted store is unavailable; resolve the storage failure and restart the daemon.")
			return
		}
		identity, ok := s.authenticate(r)
		if !ok {
			fail(w, http.StatusUnauthorized, "Authentication required.")
			return
		}
		if scope != "" && !identity.Owner && !slices.Contains(identity.Scopes, scope) {
			fail(w, http.StatusForbidden, "The credential does not grant "+scope+".")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, identity)))
	}
}

func identity(r *http.Request) principal {
	value, _ := r.Context().Value(principalKey{}).(principal)
	return value
}

func (s *Server) currentSession(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"username": s.store.Username(), "scopes": identity(r).Scopes, "owner": identity(r).Owner})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if !identity(r).Owner {
		fail(w, http.StatusForbidden, "A login session is required.")
		return
	}
	if cookie, err := r.Cookie(cookieName); err == nil {
		s.authMu.Lock()
		delete(s.sessions, secretHash(cookie.Value))
		s.authMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	_ = s.update(identity(r).Actor, "auth.logout", func(state *model.State) error { return nil })
	w.WriteHeader(http.StatusNoContent)
}

func keyMetadata(key model.APIKey) model.APIKey { key.Hash = ""; return key }

func (s *Server) getKeys(w http.ResponseWriter, r *http.Request) {
	keys := []model.APIKey{}
	for _, key := range s.store.APIKeys() {
		keys = append(keys, keyMetadata(key))
	}
	writeJSON(w, http.StatusOK, keys)
}

func (s *Server) createKey(w http.ResponseWriter, r *http.Request) {
	if !identity(r).Owner {
		fail(w, http.StatusForbidden, "Only an owner login session may create API keys.")
		return
	}
	var input struct {
		Name          string   `json:"name"`
		Scopes        []string `json:"scopes"`
		ExpiresInDays int      `json:"expiresInDays"`
	}
	if !decode(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 80 || len(input.Scopes) == 0 || len(input.Scopes) > len(validScopes) {
		fail(w, http.StatusBadRequest, "Provide a key name and explicit valid scopes.")
		return
	}
	for _, scope := range input.Scopes {
		if !slices.Contains(validScopes, scope) {
			fail(w, http.StatusBadRequest, "Unknown API scope.")
			return
		}
	}
	if input.ExpiresInDays == 0 {
		input.ExpiresInDays = 30
	}
	if input.ExpiresInDays < 1 || input.ExpiresInDays > 365 {
		fail(w, http.StatusBadRequest, "API keys must expire within 1 to 365 days.")
		return
	}
	secret := "wdk_" + newSecret()
	now := time.Now()
	key := model.APIKey{ID: newID(), Name: input.Name, Prefix: secret[:12], Hash: secretHash(secret), Scopes: slices.Compact(slices.Sorted(slices.Values(input.Scopes))), CreatedAt: now.UnixMilli(), ExpiresAt: now.Add(time.Duration(input.ExpiresInDays) * 24 * time.Hour).UnixMilli()}
	if len(s.store.APIKeys()) >= 1000 {
		fail(w, http.StatusConflict, "The API key limit has been reached.")
		return
	}
	if err := s.update(identity(r).Actor, "keys.create", func(state *model.State) error { state.Keys = append(state.Keys, key); return nil }); err != nil {
		fail(w, http.StatusInternalServerError, "Could not persist the API key.")
		return
	}
	writeJSON(w, http.StatusCreated, struct {
		model.APIKey
		Key string `json:"key"`
	}{keyMetadata(key), secret})
}

func (s *Server) revokeKey(w http.ResponseWriter, r *http.Request) {
	if !identity(r).Owner {
		fail(w, http.StatusForbidden, "Only an owner login session may revoke API keys.")
		return
	}
	found := false
	err := s.update(identity(r).Actor, "keys.revoke", func(state *model.State) error {
		for i := range state.Keys {
			if state.Keys[i].ID == r.PathValue("id") {
				found = true
				if state.Keys[i].RevokedAt == 0 {
					state.Keys[i].RevokedAt = time.Now().UnixMilli()
				}
			}
		}
		return nil
	})
	if err != nil {
		fail(w, http.StatusInternalServerError, "Could not persist key revocation.")
		return
	}
	if !found {
		fail(w, http.StatusNotFound, "API key not found.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
