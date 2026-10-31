package collector

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"walkingdead/internal/model"
)

type Sensor interface {
	Address() string
	Done() <-chan struct{}
	Err() error
	Close(context.Context) error
}

const (
	maxTCPConnections = 64
	maxConnEvents     = 200
	idleTimeout       = 3 * time.Minute
	sessionLimit      = 15 * time.Minute
)

type handler func(*conn)

type TCP struct {
	service  string
	mode     string
	listener net.Listener
	record   func(model.Event) error
	handle   handler
	slots    chan struct{}
	done     chan struct{}
	wg       sync.WaitGroup
	mu       sync.Mutex
	err      error
	conns    map[net.Conn]struct{}
	closing  bool
}

var tcpHandlers = map[string]handler{
	"telnet": serveTelnet,
	"ftp":    serveFTP,
	"redis":  serveRedis,
	"mysql":  serveMySQL,
}

func ListenDecoy(service, address, mode string, record func(model.Event) error) (Sensor, error) {
	if record == nil {
		return nil, errors.New("an evidence recorder is required")
	}
	if mode != "passive" && mode != "interactive" && mode != "tarpit" {
		return nil, errors.New("unsupported decoy profile")
	}
	if service == "ssh" {
		return listenSSH(address, mode, record)
	}
	h, ok := tcpHandlers[service]
	if !ok {
		return nil, fmt.Errorf("unknown decoy %q", service)
	}
	return listenTCP(service, address, mode, record, h)
}

func listenTCP(service, address, mode string, record func(model.Event) error, h handler) (*TCP, error) {
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return nil, fmt.Errorf("bind %s decoy: %w", strings.ToUpper(service), err)
	}
	t := &TCP{service: service, mode: mode, listener: listener, record: record, handle: h, slots: make(chan struct{}, maxTCPConnections), done: make(chan struct{}), conns: map[net.Conn]struct{}{}}
	go t.serve()
	return t, nil
}

func (t *TCP) serve() {
	defer close(t.done)
	for {
		c, err := t.listener.Accept()
		if err != nil {
			t.mu.Lock()
			if !t.closing {
				t.err = err
			}
			t.mu.Unlock()
			return
		}
		select {
		case t.slots <- struct{}{}:
		default:
			_ = c.Close()
			continue
		}
		t.mu.Lock()
		t.conns[c] = struct{}{}
		t.mu.Unlock()
		t.wg.Add(1)
		go func() {
			defer func() {
				_ = c.Close()
				t.mu.Lock()
				delete(t.conns, c)
				t.mu.Unlock()
				<-t.slots
				t.wg.Done()
			}()
			cn := newConn(t.service, t.mode, c, t.record)
			cn.connected()
			t.handle(cn)
		}()
	}
}

func (t *TCP) Address() string       { return t.listener.Addr().String() }
func (t *TCP) Done() <-chan struct{} { return t.done }
func (t *TCP) Err() error            { t.mu.Lock(); defer t.mu.Unlock(); return t.err }

func (t *TCP) Close(ctx context.Context) error {
	t.mu.Lock()
	t.closing = true
	for c := range t.conns {
		_ = c.Close()
	}
	t.mu.Unlock()
	err := t.listener.Close()
	finished := make(chan struct{})
	go func() { t.wg.Wait(); close(finished) }()
	select {
	case <-finished:
	case <-ctx.Done():
		return ctx.Err()
	}
	return err
}

type conn struct {
	service  string
	mode     string
	raw      net.Conn
	reader   *bufio.Reader
	record   func(model.Event) error
	session  string
	ip       string
	started  time.Time
	events   int
	user     string
	attempts int
	mu       sync.Mutex
}

func newConn(service, mode string, raw net.Conn, record func(model.Event) error) *conn {
	ip, _, err := net.SplitHostPort(raw.RemoteAddr().String())
	if err != nil {
		ip = raw.RemoteAddr().String()
	}
	return &conn{service: service, mode: mode, raw: raw, reader: bufio.NewReaderSize(raw, 4096), record: record, session: randomID(), ip: ip, started: time.Now()}
}

func (c *conn) event(kind, severity, message string) model.Event {
	return model.Event{ID: randomID(), TS: time.Now().UnixMilli(), Service: c.service, Type: kind, Severity: severity, SrcIP: c.ip, Country: "Unknown", SessionID: c.session, SensorID: "local-" + c.service, Message: message}
}

func (c *conn) emit(e model.Event) bool {
	c.mu.Lock()
	if c.events >= maxConnEvents {
		c.mu.Unlock()
		return false
	}
	c.events++
	c.mu.Unlock()
	return c.record(e) == nil
}

func (c *conn) connected() {
	c.emit(c.event("connection", "info", fmt.Sprintf("%s connection opened from %s", strings.ToUpper(c.service), c.ip)))
}

func (c *conn) credentials(user, password, note string) {
	c.attempts++
	e := c.event("auth_fail", "low", fmt.Sprintf("%s login attempt for %q%s", strings.ToUpper(c.service), sanitize(user, 64), note))
	e.User, e.Password = sanitize(user, 128), sanitize(password, 128)
	c.emit(e)
}

func (c *conn) command(line, message string) {
	e := c.event("command", "info", message)
	e.Command = sanitize(line, 2048)
	e.User = c.user
	c.emit(e)
}

func (c *conn) alive() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return time.Since(c.started) < sessionLimit && c.events < maxConnEvents
}

func (c *conn) write(s string) error {
	_ = c.raw.SetWriteDeadline(time.Now().Add(20 * time.Second))
	if c.mode == "tarpit" {
		for i := 0; i < len(s); i++ {
			if _, err := c.raw.Write([]byte{s[i]}); err != nil {
				return err
			}
			time.Sleep(40 * time.Millisecond)
		}
		return nil
	}
	_, err := c.raw.Write([]byte(s))
	return err
}

func (c *conn) readLine(limit int) (string, error) {
	_ = c.raw.SetReadDeadline(time.Now().Add(idleTimeout))
	var b strings.Builder
	for {
		ch, err := c.reader.ReadByte()
		if err != nil {
			return b.String(), err
		}
		if ch == 0xff {
			if err := c.skipIAC(); err != nil {
				return b.String(), err
			}
			continue
		}
		if ch == '\n' {
			return strings.TrimRight(b.String(), "\r\x00"), nil
		}
		if ch == '\r' {
			if next, err := c.reader.Peek(1); err == nil && (next[0] == '\n' || next[0] == 0) {
				_, _ = c.reader.ReadByte()
			}
			return b.String(), nil
		}
		if b.Len() < limit {
			b.WriteByte(ch)
		}
	}
}

// skipIAC drops a telnet negotiation sequence that follows an IAC byte.
func (c *conn) skipIAC() error {
	cmd, err := c.reader.ReadByte()
	if err != nil {
		return err
	}
	switch {
	case cmd >= 251 && cmd <= 254:
		_, err = c.reader.ReadByte()
	case cmd == 250:
		for {
			b, e := c.reader.ReadByte()
			if e != nil {
				return e
			}
			if b == 0xff {
				if n, e := c.reader.ReadByte(); e != nil || n == 240 {
					return e
				}
			}
		}
	}
	return err
}

func (c *conn) pause() {
	if c.mode == "tarpit" {
		time.Sleep(2 * time.Second)
	}
}
