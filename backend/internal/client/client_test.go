package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTransportKeepsCredentialsInHeadersAndRefusesRedirects(t *testing.T) {
	var origin string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" {
			t.Error("credential appeared in query")
		}
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Error("missing authorization")
		}
		if r.URL.Path == "/api/v1/system" {
			origin = r.Header.Get("Origin")
			w.Header().Set("Location", "/elsewhere")
			w.WriteHeader(http.StatusTemporaryRedirect)
			return
		}
		t.Error("redirect followed")
	}))
	defer server.Close()
	c, err := New(server.URL, "secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Do(http.MethodPut, "/system", map[string]bool{"running": true}); err == nil {
		t.Fatal("expected redirect error")
	}
	if origin != server.URL {
		t.Fatalf("wrong origin %q", origin)
	}
}

func TestOwnerSessionIsReused(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/auth/login" {
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["password"] != "correct" {
				t.Error("wrong password")
			}
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "test", Path: "/", HttpOnly: true})
			_, _ = w.Write([]byte(`{"username":"owner"}`))
			return
		}
		if _, err := r.Cookie("session"); err != nil {
			t.Error("missing session cookie")
		}
		_, _ = w.Write([]byte(`{"running":false}`))
	}))
	defer server.Close()
	c, _ := New(server.URL, "")
	if err := c.Login("owner", []byte("correct")); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Do(http.MethodGet, "/system", nil); err != nil {
		t.Fatal(err)
	}
}

func TestRejectsUnsafeURLs(t *testing.T) {
	for _, address := range []string{"http://example.com", "https://user:password@example.com", "https://example.com?key=secret", "file:///etc/passwd", "https://example.com/other"} {
		if _, err := New(address, ""); err == nil {
			t.Errorf("accepted %s", address)
		}
	}
}
