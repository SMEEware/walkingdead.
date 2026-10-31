package collector

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"slices"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"

	"walkingdead/internal/model"
)

var weakPasswords = []string{"root", "admin", "123456", "password", "toor", "1234", "12345", "12345678", "qwerty", "admin123", "raspberry", "ubnt", "test"}

func listenSSH(address, mode string, record func(model.Event) error) (*TCP, error) {
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		return nil, err
	}
	return listenTCP("ssh", address, mode, record, func(c *conn) { serveSSH(c, signer) })
}

func serveSSH(c *conn, signer ssh.Signer) {
	config := &ssh.ServerConfig{
		ServerVersion: "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.6",
		MaxAuthTries:  6,
		PasswordCallback: func(meta ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			c.credentials(meta.User(), string(password), " ("+sanitize(string(meta.ClientVersion()), 64)+")")
			c.pause()
			if c.mode == "interactive" && (slices.Contains(weakPasswords, string(password)) || c.attempts >= 3) {
				c.user = sanitize(meta.User(), 128)
				return nil, nil
			}
			return nil, fmt.Errorf("denied")
		},
		PublicKeyCallback: func(meta ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			e := c.event("auth_fail", "low", fmt.Sprintf("SSH public key offered for %q", sanitize(meta.User(), 64)))
			e.User = sanitize(meta.User(), 128)
			e.Payload = key.Type() + " " + ssh.FingerprintSHA256(key)
			c.emit(e)
			return nil, fmt.Errorf("denied")
		},
	}
	config.AddHostKey(signer)
	_ = c.raw.SetDeadline(time.Now().Add(30 * time.Second))
	server, channels, requests, err := ssh.NewServerConn(c.raw, config)
	if err != nil {
		return
	}
	defer server.Close()
	_ = c.raw.SetDeadline(time.Now().Add(sessionLimit))
	e := c.event("auth_success", "high", fmt.Sprintf("SSH session granted to %q; attacker entered the emulated shell", c.user))
	e.User = c.user
	c.emit(e)
	go ssh.DiscardRequests(requests)
	for ch := range channels {
		switch ch.ChannelType() {
		case "session":
			channel, reqs, err := ch.Accept()
			if err != nil {
				continue
			}
			go handleSession(c, channel, reqs)
		case "direct-tcpip":
			target := tunnelTarget(ch.ExtraData())
			ev := c.event("tunnel", "high", "SSH port-forwarding attempt to "+target)
			ev.Tags, ev.Tactics = []string{"proxy-abuse"}, []string{"T1090"}
			ev.IOCs = []string{target}
			c.emit(ev)
			_ = ch.Reject(ssh.Prohibited, "administratively prohibited")
		default:
			_ = ch.Reject(ssh.UnknownChannelType, "unsupported")
		}
	}
}

func handleSession(c *conn, channel ssh.Channel, reqs <-chan *ssh.Request) {
	defer channel.Close()
	for req := range reqs {
		switch req.Type {
		case "pty-req", "env", "window-change":
			_ = req.Reply(true, nil)
		case "exec":
			_ = req.Reply(true, nil)
			command := ""
			if len(req.Payload) > 4 {
				command = string(req.Payload[4:])
			}
			execOnce(c, channel, command)
			_, _ = channel.SendRequest("exit-status", false, []byte{0, 0, 0, 0})
			return
		case "shell":
			_ = req.Reply(true, nil)
			runShell(c, channel, func() (string, error) { return readTerminalLine(channel) })
			_, _ = channel.SendRequest("exit-status", false, []byte{0, 0, 0, 0})
			return
		case "subsystem":
			_ = req.Reply(false, nil)
			ev := c.event("command", "medium", "SSH subsystem requested: "+sanitize(string(req.Payload[min(4, len(req.Payload)):]), 64))
			c.emit(ev)
		default:
			_ = req.Reply(false, nil)
		}
	}
}

// readTerminalLine reads keystrokes from a raw pty, echoing them back like a terminal would.
func readTerminalLine(rw io.ReadWriter) (string, error) {
	var line []byte
	buf := make([]byte, 1)
	for {
		if _, err := rw.Read(buf); err != nil {
			return string(line), err
		}
		switch b := buf[0]; b {
		case '\r', '\n':
			_, _ = io.WriteString(rw, "\r\n")
			return string(line), nil
		case 127, 8:
			if len(line) > 0 {
				line = line[:len(line)-1]
				_, _ = io.WriteString(rw, "\b \b")
			}
		case 3:
			_, _ = io.WriteString(rw, "^C\r\n")
			return "", nil
		case 4:
			return "exit", nil
		default:
			if b >= 32 && len(line) < 4096 {
				line = append(line, b)
				_, _ = rw.Write(buf)
			}
		}
	}
}

func tunnelTarget(data []byte) string {
	if len(data) < 4 {
		return "unknown"
	}
	n := binary.BigEndian.Uint32(data[:4])
	if int(n)+8 > len(data) {
		return "unknown"
	}
	host := sanitize(string(data[4:4+n]), 255)
	port := binary.BigEndian.Uint32(data[4+n : 8+n])
	return net.JoinHostPort(strings.TrimSpace(host), fmt.Sprint(port))
}
