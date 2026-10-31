package client

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	base   string
	origin string
	token  string
	http   *http.Client
}

func New(address, token string) (*Client, error) {
	u, err := url.Parse(address)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("invalid management URL")
	}
	local := u.Hostname() == "localhost"
	if ip := net.ParseIP(u.Hostname()); ip != nil {
		local = ip.IsLoopback()
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return nil, errors.New("remote management requires HTTPS; HTTP is permitted only on loopback")
	}
	if u.Path != "" && u.Path != "/" && u.Path != "/api/v1" && u.Path != "/api/v1/" {
		return nil, errors.New("management URL must use the root or /api/v1 path")
	}
	if strings.ContainsAny(token, "\r\n") {
		return nil, errors.New("invalid API key")
	}
	jar, _ := cookiejar.New(nil)
	origin := u.Scheme + "://" + u.Host
	return &Client{base: origin + "/api/v1", origin: origin, token: token, http: &http.Client{
		Timeout: 55 * time.Second, Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

func (c *Client) Login(username string, password []byte) error {
	_, err := c.Do(http.MethodPost, "/auth/login", map[string]string{"username": username, "password": string(password)})
	return err
}

func (c *Client) Do(method, path string, body any) (json.RawMessage, error) {
	return c.do(method, path, body, true)
}

// DoRaw returns the response body unchanged, for text exports such as firewall rules.
func (c *Client) DoRaw(method, path string, body any) ([]byte, error) {
	return c.do(method, path, body, false)
}

func (c *Client) do(method, path string, body any, requireJSON bool) (json.RawMessage, error) {
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		return nil, errors.New("invalid API path")
	}
	var data []byte
	var err error
	if body != nil {
		data, err = json.Marshal(body)
		if err != nil {
			return nil, err
		}
	}
	req, err := http.NewRequest(method, c.base+path, bytes.NewReader(data))
	if err != nil {
		return nil, errors.New("cannot construct management request")
	}
	req.Header.Set("Accept", "application/json")
	if method != http.MethodGet {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", c.origin)
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("management request failed: %w", err)
	}
	defer res.Body.Close()
	content, err := io.ReadAll(io.LimitReader(res.Body, 32<<20+1))
	if err != nil {
		return nil, errors.New("cannot read management response")
	}
	if len(content) > 32<<20 {
		return nil, errors.New("management response exceeds 32 MiB")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var failure struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(content, &failure)
		if failure.Error == "" {
			failure.Error = http.StatusText(res.StatusCode)
		}
		if len(failure.Error) > 1024 {
			failure.Error = failure.Error[:1024]
		}
		return nil, fmt.Errorf("API %d: %q", res.StatusCode, failure.Error)
	}
	if !requireJSON {
		return content, nil
	}
	if len(bytes.TrimSpace(content)) == 0 {
		return json.RawMessage(`{}`), nil
	}
	if !json.Valid(content) {
		return nil, errors.New("management server returned invalid JSON")
	}
	return content, nil
}
