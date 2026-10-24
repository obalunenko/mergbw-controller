package managed

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"io"
	"regexp"
	"sync"
	"time"
)

const (
	ProtocolVersion = 1
	MaxFrameBytes   = 64 * 1024
	MaxRequests     = 16
	HostLease       = 10 * time.Second
	StartupDeadline = 15 * time.Second
	StopGrace       = 10 * time.Second
)

type State string

const (
	Unconfigured   State = "unconfigured"
	Starting       State = "starting"
	Ready          State = "ready"
	Stopping       State = "stopping"
	Stopped        State = "stopped"
	Failed         State = "failed"
	CleanupBlocked State = "cleanup_blocked"
)

// Code is deliberately safe to display. Never wrap native, JSON or path errors
// into a Code or a private protocol diagnostic.
type Code string

func (c Code) Error() string { return string(c) }

const (
	InstanceBusy         Code = "instance_busy"
	PortConflict         Code = "port_conflict"
	ProtocolIncompatible Code = "protocol_incompatible"
	SpawnFailed          Code = "spawn_failed"
	HostUnavailable      Code = "host_unavailable"
	StartupTimeout       Code = "startup_timeout"
	WorkerExited         Code = "worker_exited"
	CleanupFailed        Code = "cleanup_blocked"
)

type Frame struct {
	Version   int            `json:"v"`
	Session   string         `json:"session"`
	RequestID string         `json:"requestId"`
	Type      string         `json:"type"`
	Payload   jsontext.Value `json:"payload"`
}

var idPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

func ValidID(id string) bool { return idPattern.MatchString(id) }

func NewID() (string, error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", Code("random_failed")
	}
	return hex.EncodeToString(id[:]), nil
}

var frameTypes = map[string]bool{
	"session.open": true, "host.alive": true,
	"configuration.prepareManual": true, "configuration.prepareImport": true,
	"configuration.apply": true, "configuration.cancel": true, "configuration.read": true, "configuration.check": true,
	"controller.start": true, "controller.restart": true, "controller.stop": true,
	"controller.state": true, "controller.bootstrap": true,
	"runtime.authorized": true, "runtime.revoked": true, "result": true,
	"worker.bootstrap": true, "worker.ready": true, "worker.bluetooth": true, "worker.stop": true,
}

type Decoder struct {
	reader  *bufio.Reader
	session string
}

func NewDecoder(reader io.Reader, session string) *Decoder {
	return &Decoder{reader: bufio.NewReaderSize(reader, MaxFrameBytes+1), session: session}
}
func (d *Decoder) Read() (Frame, error) {
	line, err := d.reader.ReadSlice('\n')
	if errors.Is(err, io.EOF) && len(line) == 0 {
		return Frame{}, io.EOF
	}
	if err != nil || len(line) > MaxFrameBytes {
		return Frame{}, ProtocolIncompatible
	}
	var frame Frame
	if json.Unmarshal(bytes.TrimSuffix(line, []byte{'\n'}), &frame, json.RejectUnknownMembers(true)) != nil {
		return Frame{}, ProtocolIncompatible
	}
	if !validFrame(frame) || (d.session != "" && frame.Session != d.session) {
		return Frame{}, ProtocolIncompatible
	}
	if d.session == "" {
		d.session = frame.Session
	}
	return frame, nil
}
func validFrame(frame Frame) bool {
	return frame.Version == ProtocolVersion && ValidID(frame.Session) && ValidID(frame.RequestID) && frameTypes[frame.Type] && len(frame.Payload) > 0 && frame.Payload[0] == '{'
}

type Encoder struct {
	writer io.Writer
	mutex  sync.Mutex
}

func NewEncoder(writer io.Writer) *Encoder { return &Encoder{writer: writer} }
func (e *Encoder) Write(frame Frame) error {
	if !validFrame(frame) {
		return ProtocolIncompatible
	}
	data, err := json.Marshal(frame)
	if err != nil || len(data)+1 > MaxFrameBytes {
		return ProtocolIncompatible
	}
	data = append(data, '\n')
	e.mutex.Lock()
	defer e.mutex.Unlock()
	n, err := e.writer.Write(data)
	if err != nil || n != len(data) {
		return Code("control_write_failed")
	}
	return nil
}

type Requests struct {
	mutex   sync.Mutex
	pending map[string]bool
}

func (r *Requests) Add(id string) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	if !ValidID(id) || r.pending[id] {
		return ProtocolIncompatible
	}
	if len(r.pending) >= MaxRequests {
		return Code("control_busy")
	}
	if r.pending == nil {
		r.pending = make(map[string]bool)
	}
	r.pending[id] = true
	return nil
}
func (r *Requests) Done(id string) { r.mutex.Lock(); defer r.mutex.Unlock(); delete(r.pending, id) }

// DrainDiagnostics consumes arbitrary stderr using bounded memory, without
// echoing native error text or secrets to any logger or control channel.
func DrainDiagnostics(reader io.Reader) { _, _ = io.Copy(io.Discard, reader) }
