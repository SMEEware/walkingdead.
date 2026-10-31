package winacl

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRestrictMakesDirectoriesAndFilesPrivate(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "vault")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := Restrict(dir); err != nil {
		t.Fatal(err)
	}
	if err := CheckPrivate(dir, true); err != nil {
		t.Fatalf("restricted directory reported as shared: %v", err)
	}
	file := filepath.Join(dir, "state")
	if err := os.WriteFile(file, []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := CheckPrivate(file, false); err != nil {
		t.Fatalf("file inside a restricted directory must inherit privacy: %v", err)
	}
	if CheckPrivate(dir, false) == nil || CheckPrivate(file, true) == nil {
		t.Fatal("kind mismatch must be rejected")
	}
}
