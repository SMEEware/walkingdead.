//go:build darwin || linux

package vault

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func prepareDir(dir string, create bool) error {
	if create {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return err
		}
	}
	return checkPrivate(dir, true)
}

func checkPrivate(path string, directory bool) error {
	info, err := os.Lstat(filepath.Clean(path))
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || info.IsDir() != directory || (!directory && !info.Mode().IsRegular()) {
		return errors.New("vault paths must be real directories or regular files")
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !ok || owner.Uid != uint32(os.Getuid()) || info.Mode().Perm()&0077 != 0 {
		return fmt.Errorf("vault path must be owned by the current user with private permissions: %s", path)
	}
	return nil
}

func acquireLock(dir string) (*os.File, error) {
	path := filepath.Join(dir, ".vault.lock")
	fd, err := syscall.Open(path, syscall.O_CREAT|syscall.O_RDWR|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	if err = checkPrivate(path, false); err != nil {
		_ = f.Close()
		return nil, err
	}
	if err = syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, ErrLocked
	}
	return f, nil
}
