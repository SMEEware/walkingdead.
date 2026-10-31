package api

import _ "embed"

//go:embed openapi.json
var document string

func Document() string { return document }
