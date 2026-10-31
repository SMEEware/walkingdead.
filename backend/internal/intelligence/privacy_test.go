package intelligence

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	"walkingdead/internal/model"
)

func TestPrivacyPseudonymsRemainConsistentAcrossMetadataAndPayload(t *testing.T) {
	in := input()
	in.Events[0].Path = "/lookup/192.0.2.8/%5B2001%3Adb8%3A%3A7%5D?token=query-secret"
	in.Events[0].Payload = "visited 192.0.2.8 and [2001:db8::7]\nAuthorization: Bearer credential-secret\nCookie: session=cookie-secret\npassword=body-secret\napi_key=api-secret\nsk-synthetic_secret_token"
	in.IncludePayloads = true
	prompt, _, _, _, err := prepare(in)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"192.0.2.8", "2001:db8::7", "query-secret", "credential-secret", "cookie-secret", "body-secret", "api-secret", "sk-synthetic_secret_token"} {
		if strings.Contains(prompt, forbidden) {
			t.Fatalf("sensitive value survived redaction: %s", forbidden)
		}
	}
	if strings.Count(prompt, "source-01") != 3 || strings.Count(prompt, "source-02") != 2 {
		t.Fatalf("pseudonym correlation lost: %s", prompt)
	}
}

func TestPayloadsAreExplicitAndBoundedWhileQueryIsAlwaysRemoved(t *testing.T) {
	in := input()
	in.RedactIPs = false
	in.IncludePayloads = true
	in.Events[0].Payload = strings.Repeat("é", 300)
	in.Events[0].Path = "https://user:secret@example.invalid/admin%3Fpassword=encoded-secret"
	prompt, _, _, _, err := prepare(in)
	if err != nil {
		t.Fatal(err)
	}
	var data struct {
		Events []evidence `json:"untrustedEvents"`
	}
	if json.Unmarshal([]byte(prompt), &data) != nil || len(data.Events) != 1 || data.Events[0].Path != "/admin" || len(data.Events[0].Payload) != 400 || !utf8.ValidString(data.Events[0].Payload) || data.Events[0].Source != "192.0.2.8" {
		t.Fatalf("unexpected explicit payload or path: %s", prompt)
	}
	for _, secret := range []string{"user:secret", "encoded-secret", "username-secret", "message-secret"} {
		if strings.Contains(prompt, secret) {
			t.Fatalf("private data leaked: %s", secret)
		}
	}
}

func TestPromptSamplesAcrossInputAndNeverExceedsBudget(t *testing.T) {
	in := Input{Task: "digest", Day: "2026-10-18", RedactIPs: true, IncludePayloads: true, TotalEvents: 1000}
	for i := range 200 {
		in.Events = append(in.Events, model.Event{ID: fmt.Sprintf("event-%d", i), SrcIP: "192.0.2.8", Path: "/" + strings.Repeat("<", 1000), Payload: strings.Repeat("<", 1000)})
	}
	prompt, ids, sampled, total, err := prepare(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(prompt) > maxPromptBytes || sampled > maxEvents || sampled < 1 || len(ids) != sampled || total != 1000 || !ids["event-0"] {
		t.Fatalf("prompt budget failure: bytes=%d sample=%d IDs=%d total=%d", len(prompt), sampled, len(ids), total)
	}
	var data struct {
		Events []evidence `json:"untrustedEvents"`
	}
	if json.Unmarshal([]byte(prompt), &data) != nil || len(data.Events) != sampled {
		t.Fatal("invalid sampled prompt")
	}
	for _, event := range data.Events {
		if !ids[event.ID] {
			t.Fatal("reference map differs from transmitted evidence")
		}
	}
	in.IncludePayloads = false
	in.Events = in.Events[:100]
	for i := range in.Events {
		in.Events[i].Path = "/admin"
	}
	_, ids, sampled, _, err = prepare(in)
	if err != nil || sampled != maxEvents || !ids["event-99"] {
		t.Fatal("sampling failed to span the full input")
	}
}

func TestRenderedProviderTextCannotCreateMarkdownActions(t *testing.T) {
	content := strings.Replace(validAnalysis(), "Administrative request", "[click](javascript:alert(1))", 1)
	result, err := validate(content, map[string]bool{"event-1": true})
	if err != nil {
		t.Fatal(err)
	}
	text := render(result)
	if !strings.Contains(text, `\[click\]\(javascript:alert\(1\)\)`) {
		t.Fatalf("provider supplied active Markdown: %s", text)
	}
}
