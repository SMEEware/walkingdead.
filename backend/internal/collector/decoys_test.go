package collector

import (
	"bufio"
	"context"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"walkingdead/internal/model"
)

type sink struct {
	mu     sync.Mutex
	events []model.Event
}

func (s *sink) record(e model.Event) error {
	s.mu.Lock()
	s.events = append(s.events, e)
	s.mu.Unlock()
	return nil
}
func (s *sink) find(match func(model.Event) bool) bool {
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		for _, e := range s.events {
			if match(e) {
				s.mu.Unlock()
				return true
			}
		}
		s.mu.Unlock()
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

func start(t *testing.T, service, mode string) (Sensor, *sink) {
	t.Helper()
	s := &sink{}
	sensor, err := ListenDecoy(service, "127.0.0.1:0", mode, s.record)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = sensor.Close(ctx)
	})
	return sensor, s
}

func TestSSHCapturesCredentialsAndExec(t *testing.T) {
	sensor, s := start(t, "ssh", "interactive")
	client, err := ssh.Dial("tcp", sensor.Address(), &ssh.ClientConfig{User: "root", Auth: []ssh.AuthMethod{ssh.Password("123456")}, HostKeyCallback: ssh.InsecureIgnoreHostKey(), Timeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	session, err := client.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	out, _ := session.Output("uname -a; whoami")
	if !strings.Contains(string(out), "root") || !strings.Contains(string(out), "Linux") {
		t.Fatalf("unexpected shell output %q", out)
	}
	if !s.find(func(e model.Event) bool { return e.User == "root" && e.Password == "123456" }) {
		t.Fatal("credentials not recorded")
	}
	if !s.find(func(e model.Event) bool { return e.Command == "uname -a; whoami" }) {
		t.Fatal("command not recorded")
	}
}

func TestSSHPassiveRejects(t *testing.T) {
	sensor, s := start(t, "ssh", "passive")
	_, err := ssh.Dial("tcp", sensor.Address(), &ssh.ClientConfig{User: "admin", Auth: []ssh.AuthMethod{ssh.Password("admin")}, HostKeyCallback: ssh.InsecureIgnoreHostKey(), Timeout: 3 * time.Second})
	if err == nil {
		t.Fatal("passive SSH must never grant a session")
	}
	if !s.find(func(e model.Event) bool { return e.User == "admin" && e.Type == "auth_fail" }) {
		t.Fatal("attempt not recorded")
	}
}

func TestTelnetShell(t *testing.T) {
	sensor, s := start(t, "telnet", "interactive")
	c, err := net.Dial("tcp", sensor.Address())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	r := bufio.NewReader(c)
	readUntil(t, r, "login: ")
	_, _ = io.WriteString(c, "root\r\n")
	readUntil(t, r, "Password: ")
	_, _ = io.WriteString(c, "root\r\n")
	readUntil(t, r, "# ")
	_, _ = io.WriteString(c, "cat /etc/passwd\r\n")
	readUntil(t, r, "root:x:0:0")
	if !s.find(func(e model.Event) bool { return e.Command == "cat /etc/passwd" }) {
		t.Fatal("command not recorded")
	}
}

func TestLineProtocols(t *testing.T) {
	ftp, fs := start(t, "ftp", "passive")
	exchange(t, ftp.Address(), "220", []string{"USER anonymous", "PASS guest@"}, "530")
	if !fs.find(func(e model.Event) bool { return e.User == "anonymous" && e.Password == "guest@" }) {
		t.Fatal("ftp credentials not recorded")
	}
	redis, rs := start(t, "redis", "interactive")
	exchange(t, redis.Address(), "", []string{"*4\r\n$6\r\nCONFIG\r\n$3\r\nSET\r\n$3\r\ndir\r\n$13\r\n/var/spool/cr"}, "")
	if !rs.find(func(e model.Event) bool { return strings.HasPrefix(e.Command, "CONFIG SET dir") }) {
		t.Fatal("redis command not recorded")
	}
}

func TestMySQLHandshake(t *testing.T) {
	sensor, s := start(t, "mysql", "passive")
	c, err := net.Dial("tcp", sensor.Address())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	head := make([]byte, 4)
	if _, err := io.ReadFull(c, head); err != nil {
		t.Fatal(err)
	}
	greeting := make([]byte, int(head[0])|int(head[1])<<8)
	_, _ = io.ReadFull(c, greeting)
	body := append(make([]byte, 32), []byte("dbadmin\x00\x00")...)
	_, _ = c.Write(append([]byte{byte(len(body)), 0, 0, 1}, body...))
	resp, _ := io.ReadAll(io.LimitReader(c, 512))
	if !strings.Contains(string(resp), "Access denied for user 'dbadmin'") {
		t.Fatalf("unexpected response %q", resp)
	}
	if !s.find(func(e model.Event) bool { return e.User == "dbadmin" }) {
		t.Fatal("mysql user not recorded")
	}
}

func exchange(t *testing.T, address, greeting string, lines []string, want string) {
	t.Helper()
	c, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	r := bufio.NewReader(c)
	if greeting != "" {
		readUntil(t, r, greeting)
	}
	for _, l := range lines {
		_, _ = io.WriteString(c, l+"\r\n")
	}
	if want != "" {
		readUntil(t, r, want)
	}
}

func readUntil(t *testing.T, r *bufio.Reader, want string) {
	t.Helper()
	var seen strings.Builder
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		b, err := r.ReadByte()
		if err != nil {
			break
		}
		seen.WriteByte(b)
		if strings.Contains(seen.String(), want) {
			return
		}
	}
	t.Fatalf("did not see %q in %q", want, seen.String())
}
