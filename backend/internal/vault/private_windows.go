//go:build windows

package vault

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"

	"walkingdead/internal/winacl"
)

func prepareDir(dir string, create bool) error {
	if create {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return err
		}
		if err := winacl.Restrict(dir); err != nil {
			return err
		}
	}
	return checkPrivate(dir, true)
}

func checkPrivate(path string, directory bool) error {
	return winacl.CheckPrivate(filepath.Clean(path), directory)
}

func acquireLock(dir string) (*os.File, error) {
	path := filepath.Join(dir, ".vault.lock")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = checkPrivate(path, false); err != nil {
		_ = f.Close()
		return nil, err
	}
	var overlapped windows.Overlapped
	if err = windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &overlapped); err != nil {
		_ = f.Close()
		return nil, ErrLocked
	}
	return f, nil
}
