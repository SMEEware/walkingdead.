package collector

import (
	"fmt"
	"io"
	"regexp"
	"strings"
)

const hostname = "srv-prod-01"

var fakeFiles = map[string]string{
	"/etc/passwd":         "root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nbin:x:2:2:bin:/bin:/usr/sbin/nologin\nsys:x:3:3:sys:/dev:/usr/sbin/nologin\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\nmysql:x:112:117:MySQL Server,,,:/nonexistent:/bin/false\ndeploy:x:1000:1000:deploy,,,:/home/deploy:/bin/bash\n",
	"/etc/issue":          "Ubuntu 22.04.3 LTS \\n \\l\n\n",
	"/etc/os-release":     "PRETTY_NAME=\"Ubuntu 22.04.3 LTS\"\nNAME=\"Ubuntu\"\nVERSION_ID=\"22.04\"\nVERSION=\"22.04.3 LTS (Jammy Jellyfish)\"\nID=ubuntu\nID_LIKE=debian\n",
	"/proc/cpuinfo":       "processor\t: 0\nvendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Xeon(R) Gold 6248R CPU @ 3.00GHz\ncpu MHz\t\t: 2999.998\ncache size\t: 36608 KB\ncpu cores\t: 4\n\nprocessor\t: 1\nvendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Xeon(R) Gold 6248R CPU @ 3.00GHz\n",
	"/proc/meminfo":       "MemTotal:       16384000 kB\nMemFree:         9123456 kB\nMemAvailable:   12345678 kB\n",
	"/root/.bash_history": "apt update\nsystemctl restart nginx\nmysql -u root -p\n",
	".bash_history":       "apt update\nsystemctl restart nginx\nmysql -u root -p\n",
}

var lsOutput = "backup.sql  deploy.sh  docker-compose.yml  .env  notes.txt  www\n"

var downloadPattern = regexp.MustCompile(`(?i)(?:https?|ftp|tftp)://\S+`)

// runShell drives an emulated root shell until the client exits or idles out.
func runShell(c *conn, rw io.ReadWriter, readLine func() (string, error)) {
	prompt := "root@" + hostname + ":~# "
	_, _ = io.WriteString(rw, "Welcome to Ubuntu 22.04.3 LTS (GNU/Linux 5.15.0-91-generic x86_64)\r\n\r\n * Documentation:  https://help.ubuntu.com\r\n\r\nLast login: Tue Oct 28 07:41:12 2026 from 10.0.4.17\r\n")
	for c.alive() {
		if _, err := io.WriteString(rw, prompt); err != nil {
			return
		}
		line, err := readLine()
		line = strings.TrimSpace(line)
		if line != "" {
			c.command(line, "Shell command: "+sanitize(line, 160))
			out, exit := respond(line)
			if out != "" {
				_, _ = io.WriteString(rw, strings.ReplaceAll(out, "\n", "\r\n"))
			}
			if exit {
				_, _ = io.WriteString(rw, "logout\r\n")
				return
			}
		}
		if err != nil {
			return
		}
	}
}

func execOnce(c *conn, w io.Writer, line string) {
	c.command(line, "Remote command: "+sanitize(line, 160))
	out, _ := respond(line)
	_, _ = io.WriteString(w, out)
}

func respond(line string) (string, bool) {
	var out strings.Builder
	for _, part := range splitCommands(line) {
		text, exit := one(part)
		out.WriteString(text)
		if exit {
			return out.String(), true
		}
	}
	return out.String(), false
}

func splitCommands(line string) []string {
	replacer := strings.NewReplacer("&&", ";", "||", ";", "\n", ";")
	parts := []string{}
	for _, p := range strings.Split(replacer.Replace(line), ";") {
		if p = strings.TrimSpace(p); p != "" {
			parts = append(parts, p)
		}
	}
	return parts
}

func one(cmd string) (string, bool) {
	if i := strings.Index(cmd, "|"); i >= 0 {
		cmd = strings.TrimSpace(cmd[:i])
	}
	fields := strings.Fields(cmd)
	if len(fields) == 0 {
		return "", false
	}
	name := fields[0]
	if strings.HasSuffix(name, "busybox") && len(fields) > 1 {
		fields = fields[1:]
		name = fields[0]
	}
	args := strings.Join(fields[1:], " ")
	switch name {
	case "exit", "logout", "quit":
		return "", true
	case "whoami":
		return "root\n", false
	case "id":
		return "uid=0(root) gid=0(root) groups=0(root)\n", false
	case "hostname":
		return hostname + "\n", false
	case "pwd":
		return "/root\n", false
	case "uname":
		switch {
		case strings.Contains(args, "-a"):
			return "Linux " + hostname + " 5.15.0-91-generic #101-Ubuntu SMP Tue Nov 14 13:30:08 UTC 2023 x86_64 x86_64 x86_64 GNU/Linux\n", false
		case strings.Contains(args, "-m"), strings.Contains(args, "-p"):
			return "x86_64\n", false
		case strings.Contains(args, "-r"):
			return "5.15.0-91-generic\n", false
		}
		return "Linux\n", false
	case "nproc":
		return "4\n", false
	case "uptime", "w":
		return " 07:52:31 up 41 days,  3:12,  1 user,  load average: 0.08, 0.11, 0.09\n", false
	case "free":
		return "               total        used        free      shared  buff/cache   available\nMem:           16000        3891        8910          21        3198       11801\nSwap:           2047           0        2047\n", false
	case "ls", "dir", "ll":
		if strings.Contains(args, "/") && !strings.Contains(args, "/root") {
			return "bin  boot  dev  etc  home  lib  media  mnt  opt  proc  root  run  sbin  srv  sys  tmp  usr  var\n", false
		}
		return lsOutput, false
	case "cat", "head", "tail", "more", "less":
		for _, f := range fields[1:] {
			if body, ok := fakeFiles[f]; ok {
				return body, false
			}
			if f == ".env" || f == "/root/.env" {
				return "APP_ENV=production\nDB_HOST=10.0.4.21\nDB_USER=app\nDB_PASSWORD=Spring2024!\nAWS_ACCESS_KEY_ID=AKIA2HONEYTOKEN7Q4X\n", false
			}
			if !strings.HasPrefix(f, "-") {
				return name + ": " + f + ": No such file or directory\n", false
			}
		}
		return "", false
	case "echo":
		return strings.Trim(args, "\"'") + "\n", false
	case "cd", "export", "unset", "history", "clear", "sleep", "chmod", "chown", "rm", "mkdir", "touch", "kill", "pkill", "nohup", "crontab", "sh", "bash", "enable", "system", "shell", "linuxshell", "cp", "mv":
		return "", false
	case "ps":
		return "    PID TTY          TIME CMD\n   2231 pts/0    00:00:00 bash\n   2245 pts/0    00:00:00 ps\n", false
	case "wget":
		if u := downloadPattern.FindString(args); u != "" {
			file := u[strings.LastIndex(u, "/")+1:]
			if file == "" {
				file = "index.html"
			}
			return fmt.Sprintf("--2026-10-30 07:52:31--  %s\nResolving... connected.\nHTTP request sent, awaiting response... 200 OK\nLength: 1337 (1.3K) [application/octet-stream]\nSaving to: '%s'\n\n%s          100%%[===================>]   1.31K  --.-KB/s    in 0s\n\n", u, file, file), false
		}
		return "wget: missing URL\n", false
	case "curl", "tftp", "ftpget":
		return "", false
	case "apt", "apt-get", "yum":
		return "E: Could not open lock file /var/lib/dpkg/lock-frontend - open (11: Resource temporarily unavailable)\n", false
	case "sudo", "su":
		if len(fields) > 1 {
			return one(strings.Join(fields[1:], " "))
		}
		return "", false
	}
	if strings.HasPrefix(name, "./") || strings.HasPrefix(name, "/tmp/") {
		return "", false
	}
	return "-bash: " + name + ": command not found\n", false
}
