//go:build !windows

package main

import (
	"errors"
	"os"
)

func privateFile(_ string, info os.FileInfo) error {
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return errors.New("credential files must be regular files with owner-only permissions (chmod 600)")
	}
	return nil
}
