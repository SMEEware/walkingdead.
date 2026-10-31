package collector

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"slices"
	"strconv"
	"strings"
	"time"
)

type connRW struct{ c *conn }

func (w connRW) Read(p []byte) (int, error)  { return w.c.reader.Read(p) }
func (w connRW) Write(p []byte) (int, error) { return len(p), w.c.write(string(p)) }

func serveTelnet(c *conn) {
	_ = c.write("\xff\xfb\x01\xff\xfb\x03\xff\xfd\x18\r\nUbuntu 22.04.3 LTS\r\n\r\n")
	for try := 0; try < 3 && c.alive(); try++ {
		if c.write(hostname+" login: ") != nil {
			return
		}
		user, err := c.readLine(128)
		if err != nil {
			return
		}
		_ = c.write("Password: ")
		password, err := c.readLine(128)
		if err != nil {
			return
		}
		_ = c.write("\r\n")
		c.credentials(user, password, "")
		c.pause()
		if c.mode == "interactive" && (slices.Contains(weakPasswords, password) || try == 2) {
			c.user = sanitize(user, 128)
			e := c.event("auth_success", "high", fmt.Sprintf("Telnet session granted to %q; attacker entered the emulated shell", c.user))
			e.User = c.user
			c.emit(e)
			runShell(c, connRW{c}, func() (string, error) { return c.readLine(4096) })
			return
		}
		time.Sleep(time.Second)
		_ = c.write("\r\nLogin incorrect\r\n")
	}
}

func serveFTP(c *conn) {
	if c.write("220 (vsFTPd 3.0.5)\r\n") != nil {
		return
	}
	user := ""
	for c.alive() {
		line, err := c.readLine(1024)
		if err != nil {
			return
		}
		verb, arg, _ := strings.Cut(strings.TrimSpace(line), " ")
		verb = strings.ToUpper(verb)
		switch verb {
		case "USER":
			user = arg
			_ = c.write("331 Please specify the password.\r\n")
		case "PASS":
			c.credentials(user, arg, "")
			c.pause()
			_ = c.write("530 Login incorrect.\r\n")
		case "QUIT":
			_ = c.write("221 Goodbye.\r\n")
			return
		case "SYST":
			_ = c.write("215 UNIX Type: L8\r\n")
		case "FEAT":
			_ = c.write("211-Features:\r\n EPRT\r\n EPSV\r\n PASV\r\n UTF8\r\n211 End\r\n")
		case "AUTH":
			_ = c.write("530 Please login with USER and PASS.\r\n")
		case "":
		default:
			c.command(line, "FTP command before login: "+sanitize(verb, 16))
			_ = c.write("530 Please login with USER and PASS.\r\n")
		}
	}
}

func serveRedis(c *conn) {
	authed := c.mode == "interactive"
	for c.alive() {
		args, err := readRESP(c)
		if err != nil || len(args) == 0 {
			return
		}
		line := strings.Join(args, " ")
		cmd := strings.ToUpper(args[0])
		if cmd == "AUTH" {
			pw := args[len(args)-1]
			u := ""
			if len(args) > 2 {
				u = args[1]
			}
			c.credentials(u, pw, "")
			c.pause()
			if c.mode == "interactive" {
				_ = c.write("+OK\r\n")
			} else {
				_ = c.write("-WRONGPASS invalid username-password pair or user is disabled.\r\n")
			}
			continue
		}
		c.command(line, "Redis command: "+sanitize(cmd, 32))
		if cmd == "QUIT" {
			_ = c.write("+OK\r\n")
			return
		}
		if !authed && cmd != "PING" && cmd != "HELLO" {
			_ = c.write("-NOAUTH Authentication required.\r\n")
			continue
		}
		c.pause()
		switch cmd {
		case "PING":
			_ = c.write("+PONG\r\n")
		case "INFO":
			info := "# Server\r\nredis_version:6.2.14\r\nredis_mode:standalone\r\nos:Linux 5.15.0-91-generic x86_64\r\narch_bits:64\r\ntcp_port:6379\r\nuptime_in_days:41\r\n# Clients\r\nconnected_clients:3\r\n# Memory\r\nused_memory_human:1.21M\r\n# Keyspace\r\ndb0:keys=12,expires=0,avg_ttl=0\r\n"
			_ = c.write("$" + strconv.Itoa(len(info)) + "\r\n" + info + "\r\n")
		case "CONFIG", "SET", "SLAVEOF", "REPLICAOF", "SAVE", "BGSAVE", "FLUSHALL", "FLUSHDB", "SELECT", "CLIENT", "DEL", "EXPIRE":
			_ = c.write("+OK\r\n")
		case "GET":
			_ = c.write("$-1\r\n")
		case "KEYS", "SCAN":
			_ = c.write("*0\r\n")
		case "DBSIZE":
			_ = c.write(":12\r\n")
		case "MODULE":
			_ = c.write("-ERR Error loading the extension. Please check the server logs.\r\n")
		case "EVAL", "EVALSHA":
			_ = c.write("-ERR user_script:1: Script attempted to access nonexistent global variable\r\n")
		default:
			_ = c.write("-ERR unknown command '" + sanitize(args[0], 32) + "'\r\n")
		}
	}
}

func readRESP(c *conn) ([]string, error) {
	line, err := c.readLine(8192)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(line, "*") {
		return strings.Fields(line), nil
	}
	n, err := strconv.Atoi(line[1:])
	if err != nil || n < 0 || n > 64 {
		return nil, fmt.Errorf("bad array")
	}
	args := make([]string, 0, n)
	for i := 0; i < n; i++ {
		head, err := c.readLine(32)
		if err != nil || !strings.HasPrefix(head, "$") {
			return nil, fmt.Errorf("bad bulk")
		}
		size, err := strconv.Atoi(head[1:])
		if err != nil || size < 0 || size > 65536 {
			return nil, fmt.Errorf("bad size")
		}
		buf := make([]byte, size+2)
		if _, err := io.ReadFull(c.reader, buf); err != nil {
			return nil, err
		}
		args = append(args, string(buf[:size]))
	}
	return args, nil
}

func serveMySQL(c *conn) {
	salt := []byte("8Hq@1d!x^Lk3Pz0Q#vTm")
	var p bytes.Buffer
	p.WriteByte(10)
	p.WriteString("5.7.42-0ubuntu0.18.04.1\x00")
	_ = binary.Write(&p, binary.LittleEndian, uint32(time.Now().Unix()%100000))
	p.Write(salt[:8])
	p.WriteByte(0)
	_ = binary.Write(&p, binary.LittleEndian, uint16(0xf7ff))
	p.WriteByte(33)
	_ = binary.Write(&p, binary.LittleEndian, uint16(2))
	_ = binary.Write(&p, binary.LittleEndian, uint16(0x81ff))
	p.WriteByte(21)
	p.Write(make([]byte, 10))
	p.Write(salt[8:])
	p.WriteByte(0)
	p.WriteString("mysql_native_password\x00")
	if writePacket(c, 0, p.Bytes()) != nil {
		return
	}
	_ = c.raw.SetReadDeadline(time.Now().Add(30 * time.Second))
	header := make([]byte, 4)
	if _, err := io.ReadFull(c.reader, header); err != nil {
		return
	}
	size := int(header[0]) | int(header[1])<<8 | int(header[2])<<16
	if size < 33 || size > 4096 {
		return
	}
	body := make([]byte, size)
	if _, err := io.ReadFull(c.reader, body); err != nil {
		return
	}
	user := ""
	rest := body[32:]
	if i := bytes.IndexByte(rest, 0); i >= 0 {
		user = string(rest[:i])
		rest = rest[i+1:]
	}
	hasPassword := len(rest) > 0 && rest[0] > 0
	using := "NO"
	note := " (no password)"
	if hasPassword {
		using, note = "YES", " (hashed password)"
	}
	c.credentials(user, "", note)
	c.pause()
	msg := fmt.Sprintf("Access denied for user '%s'@'%s' (using password: %s)", sanitize(user, 64), c.ip, using)
	var e bytes.Buffer
	e.WriteByte(0xff)
	_ = binary.Write(&e, binary.LittleEndian, uint16(1045))
	e.WriteString("#28000" + msg)
	_ = writePacket(c, header[3]+1, e.Bytes())
}

func writePacket(c *conn, seq byte, payload []byte) error {
	h := []byte{byte(len(payload)), byte(len(payload) >> 8), byte(len(payload) >> 16), seq}
	return c.write(string(append(h, payload...)))
}
