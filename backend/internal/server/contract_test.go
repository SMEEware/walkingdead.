package server

import (
	"bytes"
	"context"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/legacy"
	"walkingdead/internal/intelligence"
	"walkingdead/internal/model"
)

func TestOpenAPIListsEveryManagementOperation(t *testing.T) {
	doc, err := openapi3.NewLoader().LoadFromFile("../../api/openapi.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = doc.Validate(context.Background()); err != nil {
		t.Fatal(err)
	}
	expected := map[string]bool{}
	for path, item := range doc.Paths.Map() {
		for method := range item.Operations() {
			expected[method+" /api/v1"+path] = true
		}
	}
	source, err := parser.ParseFile(token.NewFileSet(), "server.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	ast.Inspect(source, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) < 2 {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "HandleFunc" {
			return true
		}
		literal, ok := call.Args[0].(*ast.BasicLit)
		if !ok {
			return true
		}
		pattern, err := strconv.Unquote(literal.Value)
		if err != nil || !strings.Contains(pattern, " /api/v1/") {
			return true
		}
		if !expected[pattern] {
			t.Errorf("operation missing from OpenAPI: %s", pattern)
		}
		delete(expected, pattern)
		return true
	})
	for pattern := range expected {
		t.Errorf("OpenAPI documents an unregistered operation: %s", pattern)
	}
}

func TestActualResponsesMatchOpenAPI(t *testing.T) {
	doc, err := openapi3.NewLoader().LoadFromFile("../../api/openapi.json")
	if err != nil {
		t.Fatal(err)
	}
	doc.Servers = openapi3.Servers{{URL: "http://localhost/api/v1"}}
	router, err := legacy.NewRouter(doc)
	if err != nil {
		t.Fatal(err)
	}
	s, _, _ := fixture(t)
	cookie := loginCookie(t, s)
	now := time.Now().UnixMilli()
	day := dayOf(now)
	event := model.Event{ID: "contract-event", SessionID: "contract-session", SensorID: "local-http", TS: now, Service: "http", Type: "connection", Severity: "info", SrcIP: "192.0.2.1", Country: "Unknown", Method: "GET", Path: "/admin", Message: "Observed HTTP GET /admin"}
	if err = s.record(event); err != nil {
		t.Fatal(err)
	}
	s.analyzerFactory = func(string, string) analyzer {
		return analysisFunc(func(_ context.Context, input intelligence.Input) (intelligence.Result, error) {
			return sampleResult(input), nil
		})
	}
	createdKeyID := ""
	tests := []struct {
		method, path string
		body         any
	}{
		{"GET", "/bootstrap", nil}, {"GET", "/auth/session", nil}, {"GET", "/system", nil}, {"PUT", "/system", map[string]any{"mode": "passive"}},
		{"GET", "/health", nil}, {"GET", "/metrics", nil}, {"GET", "/openapi", nil}, {"GET", "/keys", nil},
		{"POST", "/keys", map[string]any{"name": "contract-reader", "scopes": []string{"events:read"}}},
		{"GET", "/logs/recent", nil}, {"GET", "/days", nil}, {"GET", "/days/" + day + "/logs", nil}, {"GET", "/sessions?q=admin", nil}, {"GET", "/sessions/contract-session", nil},
		{"PUT", "/days/" + day + "/summary", model.Summary{Day: day, Source: "local", Text: "Observed metadata.", LogCount: 1, CreatedAt: now}},
		{"GET", "/summaries", nil}, {"GET", "/notifications", nil}, {"GET", "/stats", nil}, {"GET", "/export", nil}, {"GET", "/audit", nil}, {"GET", "/ai/settings", nil},
		{"PUT", "/ai/settings", map[string]any{"providerKey": "synthetic-contract-key", "enabled": true}},
		{"POST", "/ai", map[string]string{"task": "explain", "eventId": event.ID}},
		{"POST", "/ai", map[string]string{"task": "digest", "day": day}},
		{"PUT", "/summaries", model.Summary{Day: day, Source: "local", Text: "Reviewed metadata.", LogCount: 1, CreatedAt: now}},
		{"PUT", "/notifications", []model.Notification{}},
		{"POST", "/notifications/read-all", nil},
		{"DELETE", "/days/" + day + "/summary", nil},
		{"DELETE", "/notifications", nil},
		{"DELETE", "/logs", nil},
		{"DELETE", "/all", nil},
		{"DELETE", "/keys/{createdKeyId}", nil},
		{"POST", "/auth/logout", nil},
	}
	for _, test := range tests {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			var body []byte
			if test.body != nil {
				body, err = json.Marshal(test.body)
				if err != nil {
					t.Fatal(err)
				}
			}
			path := strings.ReplaceAll(test.path, "{createdKeyId}", createdKeyID)
			request := httptest.NewRequest(test.method, "http://localhost/api/v1"+path, bytes.NewReader(body))
			request.AddCookie(cookie)
			if test.method != "GET" {
				request.Header.Set("Content-Type", "application/json")
			}
			route, params, err := router.FindRoute(request)
			if err != nil {
				t.Fatal(err)
			}
			input := &openapi3filter.RequestValidationInput{Request: request, PathParams: params, Route: route, Options: &openapi3filter.Options{AuthenticationFunc: func(context.Context, *openapi3filter.AuthenticationInput) error { return nil }}}
			if err = openapi3filter.ValidateRequest(context.Background(), input); err != nil {
				t.Fatal(err)
			}
			request.Body = io.NopCloser(bytes.NewReader(body))
			response := httptest.NewRecorder()
			s.Handler().ServeHTTP(response, request)
			if test.method == "POST" && test.path == "/keys" {
				var key struct {
					ID string `json:"id"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &key); err != nil {
					t.Fatal(err)
				}
				createdKeyID = key.ID
			}
			if response.Code >= 400 {
				t.Fatalf("unexpected response %d: %s", response.Code, response.Body.String())
			}
			if err = openapi3filter.ValidateResponse(context.Background(), &openapi3filter.ResponseValidationInput{RequestValidationInput: input, Status: response.Code, Header: response.Header(), Body: io.NopCloser(bytes.NewReader(response.Body.Bytes()))}); err != nil {
				t.Fatal(err)
			}
		})
	}
}
