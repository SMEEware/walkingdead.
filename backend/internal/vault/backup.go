package vault

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

func (s *Store) Backup(path string) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed || s.poisoned {
		return errors.New("cannot back up an unavailable vault")
	}
	parent := filepath.Dir(path)
	if err := checkPrivate(parent, true); err != nil {
		return err
	}
	data, err := json.Marshal(s.doc)
	if err != nil {
		return err
	}
	defer clear(data)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	complete := false
	defer func() {
		file.Close()
		if !complete {
			os.Remove(path)
		}
	}()
	if _, err = file.Write(data); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	dir, err := os.Open(parent)
	if err != nil {
		return err
	}
	defer dir.Close()
	if err = dir.Sync(); err != nil {
		return err
	}
	complete = true
	return nil
}

func Restore(source, destination string, password []byte) (*Store, error) {
	if len(password) == 0 || len(password) > 1024 {
		return nil, ErrUnlock
	}
	data, err := readPrivate(source)
	if err != nil {
		return nil, err
	}
	defer clear(data)
	if err = prepareDir(destination, true); err != nil {
		return nil, err
	}
	lock, err := acquireLock(destination)
	if err != nil {
		return nil, err
	}
	store := &Store{dir: destination, lock: lock}
	complete := false
	defer func() {
		if !complete {
			store.Close()
		}
	}()
	if Exists(destination) {
		return nil, errors.New("vault already exists; restore requires an uninitialized destination")
	}
	if err = store.load(data, password, false); err != nil {
		return nil, err
	}
	store.state.Config.Running = false
	if err = store.persist(store.state, true); err != nil {
		return nil, err
	}
	complete = true
	return store, nil
}
