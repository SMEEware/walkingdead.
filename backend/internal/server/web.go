package server

import (
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

func (s *Server) broadcast() {
	s.streamMu.Lock()
	defer s.streamMu.Unlock()
	s.version++
	for stream := range s.streams {
		select {
		case stream <- struct{}{}:
		default:
		}
	}
}

func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	if _, ok := w.(http.Flusher); !ok {
		fail(w, http.StatusInternalServerError, "Streaming is unavailable.")
		return
	}
	changes := make(chan struct{}, 1)
	select {
	case <-s.shutdown:
		fail(w, http.StatusServiceUnavailable, "The server is shutting down.")
		return
	default:
	}
	s.streamMu.Lock()
	if len(s.streams) >= 64 {
		s.streamMu.Unlock()
		fail(w, http.StatusServiceUnavailable, "Too many event streams.")
		return
	}
	s.streams[changes] = struct{}{}
	s.streamMu.Unlock()
	defer func() { s.streamMu.Lock(); delete(s.streams, changes); s.streamMu.Unlock() }()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(w)
	send := func() bool {
		s.streamMu.Lock()
		version := s.version
		s.streamMu.Unlock()
		_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
		_, err := fmt.Fprintf(w, "event: event:update\ndata: {\"version\":%d}\n\n", version)
		if err != nil {
			return false
		}
		return controller.Flush() == nil
	}
	if !send() {
		return
	}
	timer := time.NewTicker(20 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-s.shutdown:
			return
		case <-r.Context().Done():
			return
		case _, open := <-changes:
			if !open {
				return
			}
			if _, ok := s.authenticate(r); !ok {
				return
			}
			if !send() {
				return
			}
		case <-timer.C:
			if _, ok := s.authenticate(r); !ok {
				return
			}
			if !send() {
				return
			}
		}
	}
}

func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.web == nil {
		http.Error(w, "The web UI has not been built. Use the CLI or build a release with the frontend.", http.StatusServiceUnavailable)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if strings.Contains(name, "\\") || strings.ContainsRune(name, 0) || strings.Contains(name, "..") || strings.HasPrefix(name, ".") {
		http.NotFound(w, r)
		return
	}
	for _, segment := range strings.Split(name, "/") {
		if strings.HasPrefix(segment, ".") {
			http.NotFound(w, r)
			return
		}
	}
	name = path.Clean(name)
	if name == "." {
		name = "index.html"
	}
	if !fs.ValidPath(name) {
		http.NotFound(w, r)
		return
	}
	info, err := fs.Stat(s.web, name)
	if err != nil || info.IsDir() {
		if path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}
		found := false
		for _, candidate := range []string{name + ".html", path.Join(name, "index.html")} {
			if candidateInfo, statErr := fs.Stat(s.web, candidate); statErr == nil && !candidateInfo.IsDir() {
				name, info = candidate, candidateInfo
				found = true
				break
			}
		}
		if !found {
			http.NotFound(w, r)
			return
		}
	}
	switch strings.ToLower(path.Ext(name)) {
	case ".html", ".js", ".css", ".json", ".txt", ".woff", ".woff2", ".ttf", ".otf", ".svg", ".ico", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".glb":
	default:
		http.NotFound(w, r)
		return
	}
	file, err := s.web.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	reader, ok := file.(io.ReadSeeker)
	if !ok {
		if info.Size() > 64<<20 {
			http.Error(w, "Asset unavailable", http.StatusInternalServerError)
			return
		}
		data, readErr := io.ReadAll(io.LimitReader(file, 64<<20))
		if readErr != nil {
			http.Error(w, "Asset unavailable", http.StatusInternalServerError)
			return
		}
		reader = bytes.NewReader(data)
	}
	if path.Ext(name) == ".html" {
		w.Header().Set("Cache-Control", "no-cache")
	} else if strings.HasPrefix(name, "_next/static/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	if path.Ext(name) == ".glb" {
		w.Header().Set("Content-Type", "model/gltf-binary")
	}
	http.ServeContent(w, r, name, info.ModTime(), reader)
}
