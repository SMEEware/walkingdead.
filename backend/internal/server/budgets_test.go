package server

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"

	"walkingdead/internal/model"
)

func TestEvidenceByteBudgetEvictsOldestAndStillPersistsFreshCaptures(t *testing.T) {
	s, store, _ := fixture(t)
	if err := store.Update(func(state *model.State) error {
		for i := 0; i < 900; i++ {
			state.Events = append(state.Events, model.Event{ID: strconv.Itoa(i), TS: int64(i), Service: "http", Payload: strings.Repeat("<", 4096)})
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"fresh", "fresh-again"} {
		if err := s.record(model.Event{ID: id, TS: time.Now().UnixMilli(), Service: "http", Payload: "recent capture"}); err != nil {
			t.Fatalf("new capture wedged after retention: %v", err)
		}
		retained := store.Snapshot().Events
		encoded, err := json.Marshal(retained)
		if err != nil {
			t.Fatal(err)
		}
		if len(encoded) > maxEventBytes || len(retained) >= 902 || retained[0].ID == "0" || retained[len(retained)-1].ID != id {
			t.Fatalf("incorrect byte retention: %d encoded bytes, %d events", len(encoded), len(retained))
		}
	}
}

func TestSummaryAndNotificationBudgetsUseEncodedSize(t *testing.T) {
	summaries := []model.Summary{}
	for i := 0; i < 100; i++ {
		summaries = append(summaries, model.Summary{Day: strconv.Itoa(i), Text: strings.Repeat("<", 12000)})
	}
	retained, err := retainBudget(summaries, 366, maxSummaryBytes)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(retained)
	if len(encoded) > maxSummaryBytes || len(retained) == len(summaries) || retained[len(retained)-1].Day != "99" {
		t.Fatal("summary byte budget was not enforced on escaped JSON")
	}
	items := []model.Notification{}
	for i := 0; i < 100; i++ {
		items = append(items, model.Notification{ID: strconv.Itoa(i), Body: strings.Repeat("<", 10000)})
	}
	notifications, err := retainBudget(items, maxNotifications, maxNotificationBytes)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(notifications)
	if len(encoded) > maxNotificationBytes || len(notifications) == len(items) || notifications[len(notifications)-1].ID != "99" {
		t.Fatal("notification byte budget was not enforced on escaped JSON")
	}
}
