package managed

import (
	"context"
	"encoding/json/v2"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

type LaunchConfiguration struct {
	Generation string
	Directory  string
	Port       int
}

type Binding struct {
	LaunchID                string `json:"launchId"`
	ConfigurationGeneration string `json:"configurationGeneration"`
}

type Bootstrap struct {
	Binding
	Port            int    `json:"port"`
	ProtocolVersion int    `json:"protocolVersion"`
	BridgeVersion   string `json:"bridgeVersion"`
}

type BluetoothStatus struct {
	Binding
	Bluetooth     string `json:"bluetooth"`
	ErrorCategory Code   `json:"errorCategory,omitempty"`
}

type RuntimeStatus struct {
	Binding
	State         State `json:"state"`
	ErrorCategory Code  `json:"errorCategory,omitempty"`
}

type SupervisorOptions struct {
	Directory     string
	Worker        string
	Session       string
	BridgeVersion string
	Launcher      Launcher
	Clock         Clock
	Locker        Locker
	Listeners     ListenerFactory
}

type workerRun struct {
	binding        Binding
	configuration  LaunchConfiguration
	process        *Process
	spawned        chan struct{}
	ready          chan struct{}
	authorized     chan struct{}
	revoked        chan struct{}
	done           chan struct{}
	cleaned        chan struct{}
	blocked        chan struct{}
	stopOnce       sync.Once
	readyOnce      sync.Once
	authorizedOnce sync.Once
	revokedOnce    sync.Once
	intentional    bool
	failure        Code
	deadline       time.Time
}

type Supervisor struct {
	options       SupervisorOptions
	mutex         sync.Mutex
	operation     sync.Mutex
	lock          *os.File
	reservation   *Reservation
	port          int
	active        *workerRun
	status        RuntimeStatus
	leaseDeadline time.Time
	renew         chan struct{}
	parentGone    chan struct{}
	parentOnce    sync.Once
	monitorDone   chan struct{}
	Events        chan Frame
}

func NewSupervisor(options SupervisorOptions) (*Supervisor, error) {
	if !ValidID(options.Session) || !filepath.IsAbs(options.Worker) || !filepath.IsAbs(options.Directory) {
		return nil, ProtocolIncompatible
	}
	if options.Launcher == nil {
		options.Launcher = NativeLauncher{}
	}
	if options.Clock == nil {
		options.Clock = WallClock{}
	}
	if options.Locker == nil {
		options.Locker = FileLocker{}
	}
	if options.Listeners == nil {
		options.Listeners = LoopbackListeners{}
	}
	lock, err := options.Locker.Acquire(options.Directory)
	if err != nil {
		return nil, err
	}
	s := &Supervisor{options: options, lock: lock, status: RuntimeStatus{State: Unconfigured}, renew: make(chan struct{}, 1), parentGone: make(chan struct{}), monitorDone: make(chan struct{}), Events: make(chan Frame, MaxRequests)}
	timer := options.Clock.NewTimer(HostLease)
	go s.monitor(timer)
	return s, nil
}

func (s *Supervisor) emit(kind string, payload any) {
	id, err := NewID()
	if err != nil {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	frame := Frame{Version: ProtocolVersion, Session: s.options.Session, RequestID: id, Type: kind, Payload: data}
	// State is also queryable. A stalled parent cannot block process watches;
	// readiness still needs its exact private bootstrap and authorization.
	select {
	case s.Events <- frame:
	default:
	}
}

func (s *Supervisor) Status() RuntimeStatus { s.mutex.Lock(); defer s.mutex.Unlock(); return s.status }

func (s *Supervisor) setStatus(run *workerRun, state State, code Code) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if (run != nil && s.active != run) || (run == nil && s.active != nil) {
		return
	}
	status := RuntimeStatus{State: state, ErrorCategory: code}
	if run != nil {
		status.Binding = run.binding
	}
	if run != nil && state == Starting && (run.intentional || run.failure != "") {
		return
	}
	s.status = status
	s.emit("controller.state", status)
}

func (s *Supervisor) Watch(frame Frame) error {
	switch frame.Type {
	case "host.alive":
		var payload struct{}
		if err := DecodePayload(frame, &payload); err != nil {
			return err
		}
		s.mutex.Lock()
		s.leaseDeadline = s.options.Clock.Now().Add(HostLease)
		s.mutex.Unlock()
		select {
		case s.renew <- struct{}{}:
		default:
		}
		return nil
	case "runtime.revoked", "runtime.authorized":
		var binding Binding
		if err := DecodePayload(frame, &binding); err != nil {
			return err
		}
		s.mutex.Lock()
		run := s.active
		if run == nil || run.binding != binding {
			s.mutex.Unlock()
			return Code("stale_configuration")
		}
		if frame.Type == "runtime.revoked" {
			run.revokedOnce.Do(func() { close(run.revoked) })
			s.mutex.Unlock()
			return nil
		}
		select {
		case <-run.ready:
		default:
			s.mutex.Unlock()
			return ProtocolIncompatible
		}
		if s.status.State != Starting || run.failure != "" || run.intentional || !s.options.Clock.Now().Before(s.leaseDeadline) {
			s.mutex.Unlock()
			return HostUnavailable
		}
		if !s.options.Clock.Now().Before(run.deadline) {
			s.mutex.Unlock()
			return StartupTimeout
		}
		run.authorizedOnce.Do(func() { close(run.authorized) })
		s.status = RuntimeStatus{Binding: run.binding, State: Ready}
		s.emit("controller.state", s.status)
		s.mutex.Unlock()
		return nil
	}
	return ProtocolIncompatible
}

func (s *Supervisor) monitor(timer Timer) {
	defer close(s.monitorDone)
	defer timer.Stop()
	for {
		select {
		case <-s.parentGone:
			return
		case <-s.renew:
			s.mutex.Lock()
			remaining := s.leaseDeadline.Sub(s.options.Clock.Now())
			s.mutex.Unlock()
			timer.Reset(max(remaining, 0))
		case <-timer.C():
			s.mutex.Lock()
			remaining := s.leaseDeadline.Sub(s.options.Clock.Now())
			s.mutex.Unlock()
			if remaining > 0 {
				timer.Reset(remaining)
			} else {
				s.Fail(HostUnavailable)
			}
		}
	}
}

func (s *Supervisor) Fail(code Code) {
	s.mutex.Lock()
	run := s.active
	s.mutex.Unlock()
	if run == nil {
		s.setStatus(nil, Failed, code)
		return
	}
	s.failRun(run, code)
}

func (s *Supervisor) failRun(run *workerRun, code Code) {
	s.mutex.Lock()
	if s.active != run || run.intentional {
		s.mutex.Unlock()
		return
	}
	if run.failure == "" {
		run.failure = code
	}
	code = run.failure
	s.mutex.Unlock()
	s.setStatus(run, Failed, code)
	s.beginStop(run)
}

// reserveReplacement holds a new loopback listener before disturbing the old
// runtime. A nil reservation means the current owned listener is reusable.
func (s *Supervisor) reserveReplacement(port int) (*Reservation, error) {
	s.operation.Lock()
	defer s.operation.Unlock()
	select {
	case <-s.parentGone:
		return nil, HostUnavailable
	default:
	}
	if s.reservation != nil && s.port == port {
		return nil, nil
	}
	return s.options.Listeners.Listen(port)
}
func (s *Supervisor) adoptReservation(reservation *Reservation, port int) error {
	if reservation == nil {
		return nil
	}
	s.operation.Lock()
	defer s.operation.Unlock()
	select {
	case <-s.parentGone:
		return HostUnavailable
	default:
	}
	s.mutex.Lock()
	active := s.active
	s.mutex.Unlock()
	if active != nil {
		return CleanupFailed
	}
	if s.reservation != nil {
		_ = s.reservation.Close()
	}
	s.reservation = reservation
	s.port = port
	return nil
}

func (s *Supervisor) Start(ctx context.Context, configuration LaunchConfiguration) (Bootstrap, error) {
	s.operation.Lock()
	defer s.operation.Unlock()
	if !ValidID(configuration.Generation) || !filepath.IsAbs(configuration.Directory) {
		return Bootstrap{}, ProtocolIncompatible
	}
	if ctx.Err() != nil {
		return Bootstrap{}, StartupTimeout
	}
	s.mutex.Lock()
	if s.active != nil {
		s.mutex.Unlock()
		return Bootstrap{}, CleanupFailed
	}
	if !s.options.Clock.Now().Before(s.leaseDeadline) {
		s.mutex.Unlock()
		return Bootstrap{}, HostUnavailable
	}
	select {
	case <-s.parentGone:
		s.mutex.Unlock()
		return Bootstrap{}, HostUnavailable
	default:
	}
	s.mutex.Unlock()
	if s.reservation == nil || s.port != configuration.Port {
		reservation, err := s.options.Listeners.Listen(configuration.Port)
		if err != nil {
			return Bootstrap{}, err
		}
		if s.reservation != nil {
			_ = s.reservation.Close()
		}
		s.reservation = reservation
		s.port = configuration.Port
	}
	listenerFile, err := s.reservation.Duplicate()
	if err != nil {
		return Bootstrap{}, err
	}
	defer listenerFile.Close()
	lockFile, err := DuplicateFile(s.lock)
	if err != nil {
		return Bootstrap{}, err
	}
	defer lockFile.Close()
	launch, err := NewID()
	if err != nil {
		return Bootstrap{}, err
	}
	run := &workerRun{binding: Binding{LaunchID: launch, ConfigurationGeneration: configuration.Generation}, configuration: configuration, spawned: make(chan struct{}), ready: make(chan struct{}), authorized: make(chan struct{}), revoked: make(chan struct{}), done: make(chan struct{}), cleaned: make(chan struct{}), blocked: make(chan struct{})}
	s.mutex.Lock()
	if !s.options.Clock.Now().Before(s.leaseDeadline) {
		s.mutex.Unlock()
		return Bootstrap{}, HostUnavailable
	}
	select {
	case <-s.parentGone:
		s.mutex.Unlock()
		return Bootstrap{}, HostUnavailable
	default:
	}
	s.active = run
	run.deadline = s.options.Clock.Now().Add(StartupDeadline)
	s.mutex.Unlock()
	s.setStatus(run, Starting, "")
	timer := s.options.Clock.NewTimer(StartupDeadline)
	go s.readinessDeadline(run, timer)
	process, err := s.options.Launcher.Start(ProcessSpec{Executable: s.options.Worker, Arguments: []string{"--managed", "--listener-fd", "3", "--lock-fd", "4", "--data-dir", configuration.Directory, "serve"}, Files: []*os.File{listenerFile, lockFile}})
	if err != nil {
		s.mutex.Lock()
		category := safeCode(err)
		if category != "binary_missing" && category != "binary_incompatible" {
			category = SpawnFailed
		}
		run.failure = category
		s.mutex.Unlock()
		close(run.spawned)
		close(run.done)
		run.revokedOnce.Do(func() { close(run.revoked) })
		s.beginStop(run)
		<-run.cleaned
		return Bootstrap{}, category
	}
	run.process = process
	close(run.spawned)
	go func() {
		_ = process.Handle.Wait()
		close(run.done)
		s.mutex.Lock()
		unexpected := !run.intentional
		s.mutex.Unlock()
		if unexpected {
			s.failRun(run, WorkerExited)
		}
	}()
	go DrainDiagnostics(process.Errors)
	go s.readWorker(run)
	payload, err := json.Marshal(run.binding)
	if err == nil {
		id, idErr := NewID()
		err = idErr
		if err == nil {
			err = NewEncoder(process.Input).Write(Frame{Version: ProtocolVersion, Session: s.options.Session, RequestID: id, Type: "worker.bootstrap", Payload: payload})
		}
	}
	if err != nil {
		s.failRun(run, ProtocolIncompatible)
		return Bootstrap{}, ProtocolIncompatible
	}
	select {
	case <-run.ready:
		return Bootstrap{Binding: run.binding, Port: configuration.Port, ProtocolVersion: ProtocolVersion, BridgeVersion: s.options.BridgeVersion}, nil
	case <-run.done:
		return Bootstrap{}, WorkerExited
	case <-ctx.Done():
		s.failRun(run, StartupTimeout)
		return Bootstrap{}, StartupTimeout
	}
}

func (s *Supervisor) readWorker(run *workerRun) {
	decoder := NewDecoder(run.process.Output, s.options.Session)
	for {
		frame, err := decoder.Read()
		if err != nil {
			s.failRun(run, ProtocolIncompatible)
			return
		}
		if frame.Type != "worker.ready" {
			if frame.Type == "worker.bluetooth" {
				var status BluetoothStatus
				if DecodePayload(frame, &status) != nil || status.Binding != run.binding || (status.Bluetooth != "unknown" && status.Bluetooth != "connected" && status.Bluetooth != "disconnected") || (status.ErrorCategory != "" && status.ErrorCategory != "permission_denied" && status.ErrorCategory != "bluetooth_unavailable" && status.ErrorCategory != "backend_restart_required") {
					s.failRun(run, ProtocolIncompatible)
					return
				}
				s.mutex.Lock()
				if s.active == run && !run.intentional && run.failure == "" {
					s.emit("worker.bluetooth", status)
				}
				s.mutex.Unlock()
				continue
			}
			s.failRun(run, ProtocolIncompatible)
			return
		}
		var ready Bootstrap
		if DecodePayload(frame, &ready) != nil || ready.Binding != run.binding || ready.Port != run.configuration.Port || ready.ProtocolVersion != ProtocolVersion || ready.BridgeVersion != s.options.BridgeVersion {
			s.failRun(run, ProtocolIncompatible)
			return
		}
		s.mutex.Lock()
		if s.active == run && s.status.State == Starting && !run.intentional && run.failure == "" {
			s.emit("controller.bootstrap", ready)
			run.readyOnce.Do(func() { close(run.ready) })
		}
		s.mutex.Unlock()
	}
}

func (s *Supervisor) readinessDeadline(run *workerRun, timer Timer) {
	defer timer.Stop()
	select {
	case <-run.authorized:
	case <-run.cleaned:
	case <-timer.C():
		select {
		case <-run.authorized:
			return
		default:
			s.failRun(run, StartupTimeout)
		}
	}
}

func (s *Supervisor) beginStop(run *workerRun) {
	run.stopOnce.Do(func() {
		s.mutex.Lock()
		run.intentional = true
		failure := run.failure
		s.mutex.Unlock()
		s.setStatus(run, Stopping, failure)
		go func() {
			<-run.spawned
			if run.process != nil {
				_ = run.process.Input.Close()
				_ = run.process.Handle.Signal(syscall.SIGTERM)
				timer := s.options.Clock.NewTimer(StopGrace)
				select {
				case <-run.done:
				case <-timer.C():
					s.setStatus(run, CleanupBlocked, CleanupFailed)
					close(run.blocked)
					_ = run.process.Handle.Kill()
					<-run.done
				}
				timer.Stop()
				_ = run.process.Output.Close()
				_ = run.process.Errors.Close()
			}
			select {
			case <-run.revoked:
			case <-s.parentGone:
			}
			s.mutex.Lock()
			if s.active == run {
				s.active = nil
			}
			state := Stopped
			if run.failure != "" {
				state = Failed
			}
			s.status = RuntimeStatus{Binding: run.binding, State: state, ErrorCategory: run.failure}
			status := s.status
			s.emit("controller.state", status)
			s.mutex.Unlock()
			close(run.cleaned)
		}()
	})
}

func (s *Supervisor) Stop(ctx context.Context, parentGone bool) error {
	if parentGone {
		s.parentOnce.Do(func() { close(s.parentGone) })
	}
	s.mutex.Lock()
	run := s.active
	s.mutex.Unlock()
	if run == nil {
		return nil
	}
	s.beginStop(run)
	select {
	case <-run.cleaned:
		select {
		case <-run.blocked:
			return CleanupFailed
		default:
			return nil
		}
	case <-run.blocked:
		return CleanupFailed
	case <-ctx.Done():
		return CleanupFailed
	}
}

// AwaitCleanup joins the full reaping and transport-revocation barrier even
// when Stop has already reported cleanup_blocked to a mutating request.
func (s *Supervisor) AwaitCleanup(ctx context.Context) error {
	s.mutex.Lock()
	run := s.active
	s.mutex.Unlock()
	if run == nil {
		return nil
	}
	select {
	case <-run.cleaned:
		return nil
	case <-ctx.Done():
		return CleanupFailed
	}
}

// Close is used only after real lifetime EOF or a confirmed revocation/drain.
// It waits for actual reaping, including a child blocked before worker main.
func (s *Supervisor) Close() error {
	_ = s.Stop(context.Background(), true)
	// Stop may report cleanup_blocked before the owned handle has exited.
	// Closing the owner must still join actual Wait before releasing either FD.
	s.mutex.Lock()
	run := s.active
	s.mutex.Unlock()
	if run != nil {
		<-run.cleaned
	}
	<-s.monitorDone
	s.operation.Lock()
	defer s.operation.Unlock()
	if s.reservation != nil {
		_ = s.reservation.Close()
	}
	return s.lock.Close()
}
