package server

import (
	"encoding/json"

	"walkingdead/internal/model"
)

const (
	maxEventBytes        = 16 << 20
	maxSummaryBytes      = 4 << 20
	maxNotificationBytes = 2 << 20
)

func (s *Server) retainEvents(state *model.State) error {
	if s.eventSizes == nil {
		s.eventSizes = make(map[string]int)
	}
	total := 2
	for _, event := range state.Events {
		size, known := s.eventSizes[event.ID]
		if !known {
			encoded, err := json.Marshal(event)
			if err != nil {
				return err
			}
			size = len(encoded)
			s.eventSizes[event.ID] = size
		}
		total += size + 1
	}
	if len(state.Events) > 0 {
		total--
	}
	start := 0
	for len(state.Events)-start > maxEvents || total > maxEventBytes {
		if start == len(state.Events) {
			break
		}
		total -= s.eventSizes[state.Events[start].ID] + 1
		start++
	}
	if start > 0 {
		state.Events = append([]model.Event{}, state.Events[start:]...)
	}
	if len(s.eventSizes) > 2*len(state.Events)+1024 {
		retained := make(map[string]int, len(state.Events))
		for _, event := range state.Events {
			retained[event.ID] = s.eventSizes[event.ID]
		}
		s.eventSizes = retained
	}
	return nil
}

func retainBudget[T any](items []T, count, byteLimit int) ([]T, error) {
	sizes := make([]int, len(items))
	total := 2
	for i, item := range items {
		encoded, err := json.Marshal(item)
		if err != nil {
			return nil, err
		}
		sizes[i] = len(encoded)
		total += sizes[i] + 1
	}
	if len(items) > 0 {
		total--
	}
	start := 0
	for len(items)-start > count || total > byteLimit {
		if start == len(items) {
			break
		}
		total -= sizes[start] + 1
		start++
	}
	return append([]T{}, items[start:]...), nil
}
