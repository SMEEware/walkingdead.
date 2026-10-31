//go:build !darwin && !linux && !windows

package main

import "errors"

func validateSecretFile(string) error {
	return errors.New("daemon credential files are currently supported on Linux and macOS")
}
