package vault

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"walkingdead/internal/model"
)

func TestEncryptedBackupRestoreAndRefuseOverwrite(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "source")
	store, _, err := Create(dir, "owner", []byte("correct horse battery staple"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Update(func(state *model.State) error {
		state.Events = []model.Event{{ID: "preserved-event", Payload: "private-captured-evidence"}}
		state.AI.Key = "synthetic-provider-secret"
		state.Config.Running = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	backupDir := filepath.Join(t.TempDir(), "backups")
	if err := os.Mkdir(backupDir, 0700); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(backupDir, "snapshot.wdbackup")
	if err := store.Backup(backup); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(backup)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"private-captured-evidence", "synthetic-provider-secret"} {
		if bytes.Contains(original, []byte(secret)) {
			t.Fatal("backup leaked plaintext")
		}
	}
	if err := store.Backup(backup); err == nil {
		t.Fatal("backup overwrote an existing file")
	}
	unchanged, _ := os.ReadFile(backup)
	if !bytes.Equal(original, unchanged) {
		t.Fatal("existing backup changed")
	}
	destination := filepath.Join(t.TempDir(), "restored")
	restored, err := Restore(backup, destination, []byte("correct horse battery staple"))
	if err != nil {
		t.Fatal(err)
	}
	state := restored.Snapshot()
	if len(state.Events) != 1 || state.Events[0].ID != "preserved-event" || state.AI.Key != "synthetic-provider-secret" || state.Config.Running {
		t.Fatal("restore lost evidence/configuration or resumed collection")
	}
	if err := restored.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(destination, []byte("correct horse battery staple"))
	if err != nil {
		t.Fatal(err)
	}
	reopened.Close()
	if restored, err := Restore(backup, destination, []byte("correct horse battery staple")); err == nil {
		restored.Close()
		t.Fatal("restore overwrote an initialized vault")
	}
	wrong := filepath.Join(t.TempDir(), "wrong-password")
	if restored, err := Restore(backup, wrong, []byte("wrong-password")); err == nil {
		restored.Close()
		t.Fatal("restore accepted a wrong password")
	}
	if Exists(wrong) {
		t.Fatal("failed restore left a vault")
	}
	damaged := filepath.Join(backupDir, "damaged.wdbackup")
	if err := os.WriteFile(damaged, append(original, []byte("trailing")...), 0600); err != nil {
		t.Fatal(err)
	}
	broken := filepath.Join(t.TempDir(), "damaged")
	if restored, err := Restore(damaged, broken, []byte("correct horse battery staple")); err == nil {
		restored.Close()
		t.Fatal("restore accepted a damaged backup")
	}
	if Exists(broken) {
		t.Fatal("damaged restore left a vault")
	}
}
