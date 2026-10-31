//go:build windows

package main

import (
	"errors"

	"walkingdead/internal/winacl"
)

func validateSecretFile(path string) error {
	if err := winacl.CheckPrivate(path, false); err != nil {
		return errors.New("credential files must be regular files that only the current user, SYSTEM and Administrators can access")
	}
	return nil
}
