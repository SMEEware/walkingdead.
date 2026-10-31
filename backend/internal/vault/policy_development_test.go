//go:build testcredentials

package vault

import (
	"path/filepath"
	"testing"
)

func TestDevelopmentCredentialsMarkDisposableVault(t *testing.T) {
	store, _, err := Create(filepath.Join(t.TempDir(), "vault"), "smee", []byte("password123"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if !store.Snapshot().Config.TestInstance || !store.CheckPassword("smee", []byte("password123")) {
		t.Fatal("development credentials did not create a marked test instance")
	}
}
