//go:build !testcredentials

package vault

import (
	"path/filepath"
	"testing"
	"walkingdead/internal/model"
)

func TestReleaseRejectsWeakTestPasswordAndDevelopmentVault(t *testing.T) {
	if store, _, err := Create(filepath.Join(t.TempDir(), "weak"), "smee", []byte("password123")); err == nil {
		store.Close()
		t.Fatal("release accepted development password")
	}
	store, dir, _ := newTestStore(t)
	if err := store.Update(func(state *model.State) error { state.Config.TestInstance = true; return nil }); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if opened, err := Open(dir, testPassword); err == nil {
		opened.Close()
		t.Fatal("release opened a development vault")
	}
}
