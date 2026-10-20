// sunset is a local Stream Deck / MeRGBW LT-06 bridge.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/ble"
	"github.com/obalunenko/mergbw-controller/internal/bridge"
	"github.com/obalunenko/mergbw-controller/internal/config"
	"github.com/obalunenko/mergbw-controller/internal/controller"
	"github.com/obalunenko/mergbw-controller/internal/logging"
	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

type lampLink struct{ *ble.Backend }

func (l lampLink) Connect(ctx context.Context) error {
	_, err := l.Backend.Connect(ctx)
	return err
}

func (l lampLink) CanRetry(err error) bool {
	for _, permanent := range []error{
		context.Canceled, context.DeadlineExceeded, ble.ErrIncompatible,
		ble.ErrPermission, ble.ErrNeedsRestart, ble.ErrWriteUncertain, ble.ErrInvalidPacket,
	} {
		if errors.Is(err, permanent) {
			return false
		}
	}
	return true
}

func usage() {
	fmt.Fprintln(os.Stderr, `MeRGBW LT-06 / Stream Deck — Go

./sunset [--data-dir PATH] --identity AA:BB:CC:DD:EE:FF init
./sunset [--data-dir PATH] serve
./sunset [--data-dir PATH] urls
./sunset [--data-dir PATH] inspect
./sunset [--data-dir PATH] send on|off
./sunset [--data-dir PATH] send color FF5000
./sunset [--data-dir PATH] send brightness 40
./sunset [--data-dir PATH] send preset sunset
./sunset [--data-dir PATH] dry-run on|off|color HEX|brightness N|preset NAME
./sunset --version

send использует уже работающий HTTP-сервис. Перед inspect остановите serve.
По умолчанию настройки и пресеты находятся рядом с исполняемым sunset.`)
}

func main() {
	configureLogging()
	if err := run(os.Args[1:]); err != nil {
		slog.Error("application.failed", "error", err)
		os.Exit(1)
	}
}

func configureLogging(secrets ...string) {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo, ReplaceAttr: logging.RedactSecrets(secrets...),
	})))
}

func run(args []string) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		executable = resolved
	}
	flags := flag.NewFlagSet("sunset", flag.ContinueOnError)
	directory := flags.String("data-dir", filepath.Dir(executable), "папка settings.json и presets.json")
	identity := flags.String("identity", "", "identity лампы из manufacturer data; обязательна при первой настройке")
	version := flags.Bool("version", false, "версия контроллера")
	flags.Usage = usage
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if *version {
		fmt.Println(bridge.Version)
		return nil
	}
	*directory, err = filepath.Abs(*directory)
	if err != nil {
		return err
	}
	args = flags.Args()
	if len(args) == 0 {
		usage()
		return nil
	}
	command := args[0]
	args = args[1:]
	if *identity != "" && command != "init" && command != "serve" {
		return fmt.Errorf("--identity применяется только при init или serve; остальные команды используют settings.json")
	}
	if command != "send" && command != "dry-run" && len(args) != 0 {
		return fmt.Errorf("подкоманда %s не принимает дополнительных параметров", command)
	}
	if command == "dry-run" {
		var presets map[string]protocol.Preset
		if len(args) > 0 && args[0] == "preset" {
			presets, err = config.LoadPresets(*directory)
			if err != nil {
				return err
			}
		}
		action, err := protocol.Resolve(args, presets)
		if err != nil {
			return err
		}
		fmt.Println("Команда:", action.Route)
		for _, frame := range action.Packets {
			fmt.Printf("% X\n", frame)
		}
		fmt.Println("Пакеты показаны; подключение к лампе и отправка не выполнялись.")
		return nil
	}
	var settings config.Settings
	var presets map[string]protocol.Preset
	switch command {
	case "init", "serve":
		settings, presets, err = config.Init(*directory, *identity)
	case "urls", "send", "inspect":
		settings, presets, err = config.Load(*directory)
	default:
		return fmt.Errorf("неизвестная подкоманда %q; вызовите ./sunset --help", command)
	}
	if err != nil {
		return err
	}
	configureLogging(settings.AccessToken)
	switch command {
	case "init", "urls":
		path, err := config.WriteURLs(*directory, settings, presets)
		if err != nil {
			return err
		}
		if command == "urls" {
			fmt.Print(config.URLs(settings, presets))
		} else {
			fmt.Println("Настройки готовы:", *directory)
			fmt.Println("URL для Stream Deck:", path)
		}
		return nil
	case "send":
		action, err := protocol.Resolve(args, presets)
		if err != nil {
			return err
		}
		return send(settings, action)
	case "inspect":
		backend, err := newBackend(settings)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), bridge.RequestTimeout)
		defer cancel()
		defer backend.Close()
		info, err := backend.Inspect(ctx)
		if err != nil {
			return err
		}
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(info)
	case "serve":
		if _, err := config.WriteURLs(*directory, settings, presets); err != nil {
			return err
		}
		return serve(settings, presets)
	}
	return nil
}

func newBackend(settings config.Settings) (*ble.Backend, error) {
	return ble.New(ble.Config{
		Identity: settings.DeviceIdentity, ScanTimeout: 12 * time.Second, ConnectTimeout: 12 * time.Second,
	})
}

func send(settings config.Settings, action protocol.Action) (result error) {
	started := time.Now()
	logger := slog.Default().With("component", "cli", "command", action.Route, "address", settings.Address())
	logger.Info("http.command.sending")
	var requestID string
	defer func() {
		fields := []any{"duration_ms", time.Since(started).Milliseconds()}
		if requestID != "" {
			fields = append(fields, "request_id", requestID)
		}
		if result != nil {
			logger.Error("http.command.failed", append(fields, "error", result)...)
		} else {
			logger.Info("http.command.completed", fields...)
		}
	}()
	client := &http.Client{
		Timeout:       75 * time.Second,
		Transport:     &http.Transport{Proxy: nil},
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
	defer client.CloseIdleConnections()
	response, err := client.Get(settings.BaseURL() + "/" + action.Route)
	if err != nil {
		// url.Error includes the local secret; show only its underlying error.
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err
		}
		return fmt.Errorf("HTTP-контроллер недоступен: %w; запустите run.command", err)
	}
	defer response.Body.Close()
	requestID = response.Header.Get("X-Request-ID")
	body, err := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	if err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	fmt.Print(string(body))
	return nil
}

func serve(settings config.Settings, presets map[string]protocol.Preset) error {
	// Claim the local port before attempting a BLE connection.
	listener, err := net.Listen("tcp4", settings.Address())
	if err != nil {
		return fmt.Errorf("не удалось открыть %s: %w; проверьте, не запущен ли другой контроллер", settings.Address(), err)
	}
	defer listener.Close()
	backend, err := newBackend(settings)
	if err != nil {
		return err
	}
	lamp := controller.New(lampLink{backend})
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	server := &http.Server{
		Handler: bridge.New(settings, presets, lamp), ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 10 * time.Second, WriteTimeout: 75 * time.Second, IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 8 * 1024,
		BaseContext:    func(net.Listener) context.Context { return ctx },
		ErrorLog:       slog.NewLogLogger(slog.Default().With("component", "http").Handler(), slog.LevelError),
	}
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.Serve(listener) }()
	slog.Info("service.started", "address", settings.Address(), "identity", settings.DeviceIdentity, "version", bridge.Version)
	slog.Info("service.instructions", "hint", "URL кнопок — в streamdeck-buttons.txt. Отключите nRF Connect и закройте MeRGBW на телефоне. Для остановки — Ctrl+C.")
	// Preconnect through the same gate used by HTTP commands. No light commands.
	go func() {
		connectCtx, cancel := context.WithTimeout(ctx, bridge.RequestTimeout)
		defer cancel()
		if err := lamp.Connect(connectCtx); err != nil {
			if ctx.Err() == nil {
				hint := "Следующая команда попробует подключиться."
				if errors.Is(err, ble.ErrNeedsRestart) {
					hint = "Остановите и снова запустите run.command."
				}
				slog.Warn("bluetooth.unavailable", "identity", settings.DeviceIdentity, "error", err, "hint", hint)
			}
			return
		}
	}()
	var serveErr error
	select {
	case <-ctx.Done():
	case serveErr = <-serverErrors:
		stop()
	}
	slog.Info("service.stopping")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Warn("http.shutdown.failed", "error", err)
		if err := server.Close(); err != nil {
			slog.Error("http.close.failed", "error", err)
		}
	}
	// The native library may wait for OS callbacks; bound process shutdown, not
	// command execution. Exiting the process releases any remaining BLE session.
	closeCtx, closeCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer closeCancel()
	closed := make(chan error, 1)
	go func() { closed <- lamp.Close(closeCtx) }()
	select {
	case err := <-closed:
		if err != nil {
			slog.Error("bluetooth.shutdown.failed", "error", err)
		}
	case <-closeCtx.Done():
		slog.Warn("bluetooth.shutdown.timeout", "error", closeCtx.Err(), "hint", "Завершаю процесс: Bluetooth ещё ожидает ответ ОС.")
	}
	if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
		return serveErr
	}
	slog.Info("service.stopped")
	return nil
}
