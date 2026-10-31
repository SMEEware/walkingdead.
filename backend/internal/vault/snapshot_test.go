package vault

import (
	"fmt"
	"strings"
	"testing"
	"walkingdead/internal/model"
)

func TestSnapshotDetachesEveryMutableCollection(t *testing.T) {
	state := model.InitialState()
	state.Events = []model.Event{{ID: "original"}}
	state.Keys = []model.APIKey{{Scopes: []string{"events:read"}}}
	state.Notifications = []model.Notification{{Ref: map[string]string{"id": "original"}}}
	state.Summaries = []model.Summary{{Text: "original"}}
	state.Audits = []model.Audit{{Action: "original"}}
	copied, err := clone(state)
	if err != nil {
		t.Fatal(err)
	}
	copied.Events[0].ID = "changed"
	copied.Keys[0].Scopes[0] = "keys:write"
	copied.Notifications[0].Ref["id"] = "changed"
	copied.Summaries[0].Text = "changed"
	copied.Audits[0].Action = "changed"
	if state.Events[0].ID != "original" || state.Keys[0].Scopes[0] != "events:read" || state.Notifications[0].Ref["id"] != "original" || state.Summaries[0].Text != "original" || state.Audits[0].Action != "original" {
		t.Fatal("snapshot exposes mutable vault data")
	}
}

func BenchmarkSnapshotClone(b *testing.B) {
	state := model.InitialState()
	for i := range 10000 {
		state.Events = append(state.Events, model.Event{ID: fmt.Sprint(i), Message: strings.Repeat("observation ", 20), Payload: strings.Repeat("x", 256), SessionID: "retained-session", SrcIP: "192.0.2.1"})
	}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, err := clone(state); err != nil {
			b.Fatal(err)
		}
	}
}
