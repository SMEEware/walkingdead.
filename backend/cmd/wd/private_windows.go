//go:build windows

package main

import (
	"errors"
	"os"

	"walkingdead/internal/winacl"
)

func privateFile(path string, _ os.FileInfo) error {
	if winacl.CheckPrivate(path, false) != nil {
		return errors.New("credential files must be regular files that only the current user, SYSTEM and Administrators can access")
	}
	return nil
}
