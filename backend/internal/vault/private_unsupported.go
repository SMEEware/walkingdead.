//go:build !darwin && !linux && !windows

package vault

import (
	"errors"
	"os"
)

func prepareDir(string, bool) error {
	return errors.New("private vault storage is currently supported on Linux and macOS")
}
func checkPrivate(string, bool) error      { return prepareDir("", false) }
func acquireLock(string) (*os.File, error) { return nil, prepareDir("", false) }
