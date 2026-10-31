//go:build darwin || linux

package main

import (
	"errors"
	"os"
	"syscall"
)

func validateSecretFile(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || !ok || owner.Uid != uint32(os.Getuid()) {
		return errors.New("credential files must be regular, owned by the current user, and inaccessible to group and others")
	}
	return nil
}
