package model

type Config struct {
	Running      bool                   `json:"running"`
	Mode         string                 `json:"mode"`
	AutoBlock    bool                   `json:"autoBlock"`
	HTTPAddress  string                 `json:"httpAddress"`
	HTTPEnabled  bool                   `json:"httpEnabled"`
	Decoys       map[string]DecoyConfig `json:"decoys,omitempty"`
	Webhook      Webhook                `json:"webhook"`
	TestInstance bool                   `json:"testInstance,omitempty"`
}

type DecoyConfig struct {
	Enabled bool   `json:"enabled"`
	Address string `json:"address"`
}

type Webhook struct {
	Enabled     bool   `json:"enabled"`
	URL         string `json:"url,omitempty"`
	Format      string `json:"format"`
	MinSeverity string `json:"minSeverity"`
}

type BlockEntry struct {
	IP        string `json:"ip"`
	Reason    string `json:"reason"`
	Source    string `json:"source"`
	CreatedAt int64  `json:"createdAt"`
}

var DecoyIDs = []string{"ssh", "telnet", "ftp", "redis", "mysql"}

var DecoyDefaults = map[string]string{
	"ssh":    "127.0.0.1:2222",
	"telnet": "127.0.0.1:2323",
	"ftp":    "127.0.0.1:2121",
	"redis":  "127.0.0.1:6380",
	"mysql":  "127.0.0.1:3307",
}

func (c Config) Decoy(id string) DecoyConfig {
	if d, ok := c.Decoys[id]; ok {
		return d
	}
	return DecoyConfig{Address: DecoyDefaults[id]}
}

func (c Config) Clone() Config {
	out := c
	out.Decoys = make(map[string]DecoyConfig, len(c.Decoys))
	for k, v := range c.Decoys {
		out.Decoys[k] = v
	}
	return out
}

type AIConfig struct {
	Enabled         bool   `json:"enabled"`
	Key             string `json:"key,omitempty"`
	Model           string `json:"model"`
	RedactIPs       bool   `json:"redactIps"`
	IncludePayloads bool   `json:"includePayloads"`
}

type Event struct {
	ID        string   `json:"id"`
	TS        int64    `json:"ts"`
	Service   string   `json:"service"`
	Type      string   `json:"type"`
	Severity  string   `json:"severity"`
	SrcIP     string   `json:"srcIp"`
	Country   string   `json:"country"`
	Message   string   `json:"message"`
	User      string   `json:"user,omitempty"`
	Payload   string   `json:"payload,omitempty"`
	SessionID string   `json:"sessionId"`
	SensorID  string   `json:"sensorId"`
	Method    string   `json:"method,omitempty"`
	Path      string   `json:"path,omitempty"`
	Password  string   `json:"password,omitempty"`
	Command   string   `json:"command,omitempty"`
	UserAgent string   `json:"userAgent,omitempty"`
	Tags      []string `json:"tags,omitempty"`
	Tactics   []string `json:"tactics,omitempty"`
	IOCs      []string `json:"iocs,omitempty"`
}

type APIKey struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Prefix     string   `json:"prefix"`
	Hash       string   `json:"hash,omitempty"`
	Scopes     []string `json:"scopes"`
	CreatedAt  int64    `json:"createdAt"`
	ExpiresAt  int64    `json:"expiresAt"`
	LastUsedAt int64    `json:"lastUsedAt"`
	RevokedAt  int64    `json:"revokedAt"`
}

type Audit struct {
	ID     string `json:"id"`
	TS     int64  `json:"ts"`
	Actor  string `json:"actor"`
	Action string `json:"action"`
	Result string `json:"result"`
}

type Summary struct {
	Day          string `json:"day"`
	Source       string `json:"source"`
	Text         string `json:"text"`
	LogCount     int    `json:"logCount"`
	CreatedAt    int64  `json:"createdAt"`
	Provider     string `json:"provider,omitempty"`
	Model        string `json:"model,omitempty"`
	InputTokens  int    `json:"inputTokens,omitempty"`
	OutputTokens int    `json:"outputTokens,omitempty"`
}

type Notification struct {
	ID       string            `json:"id"`
	TS       int64             `json:"ts"`
	Kind     string            `json:"kind"`
	Severity string            `json:"severity"`
	Title    string            `json:"title"`
	Body     string            `json:"body"`
	Read     bool              `json:"read"`
	Count    int               `json:"count,omitempty"`
	Group    string            `json:"group,omitempty"`
	Ref      map[string]string `json:"ref,omitempty"`
}

type State struct {
	Config        Config         `json:"config"`
	AI            AIConfig       `json:"ai"`
	Events        []Event        `json:"events"`
	Keys          []APIKey       `json:"keys"`
	Audits        []Audit        `json:"audits"`
	Summaries     []Summary      `json:"summaries"`
	Notifications []Notification `json:"notifications"`
	Blocklist     []BlockEntry   `json:"blocklist,omitempty"`
}

func InitialState() State {
	return State{Config: Config{Mode: "passive", HTTPAddress: "127.0.0.1:8088", HTTPEnabled: true, Webhook: Webhook{Format: "generic", MinSeverity: "high"}}, AI: AIConfig{Model: "deepseek-flash", RedactIPs: true}, Events: []Event{}, Keys: []APIKey{}, Audits: []Audit{}, Summaries: []Summary{}, Notifications: []Notification{}}
}
