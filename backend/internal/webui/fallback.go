//go:build !webui

package webui

import "io/fs"

func FS() fs.FS { return nil }
