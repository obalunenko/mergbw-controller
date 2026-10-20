// Package controller serializes whole lighting sequences on one BLE connection.
// It has no native Bluetooth dependency, so its behavior can be tested offline.
package controller

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/obalunenko/mergbw-controller/internal/protocol"
)

type Link interface {
	Connect(context.Context) error
	Write(context.Context, []byte) error
	Connected() bool
	Close() error
	CanRetry(error) bool
}

type Controller struct {
	link      Link
	gate      chan struct{}
	closed    atomic.Bool
	lastWrite time.Time // protected by gate
	gap       time.Duration
}

func New(link Link) *Controller {
	c := &Controller{link: link, gate: make(chan struct{}, 1), gap: 80 * time.Millisecond}
	c.gate <- struct{}{}
	return c
}

func (c *Controller) acquire(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-c.gate:
		// select is not biased: cancellation may have happened at the same time.
		if err := ctx.Err(); err != nil {
			c.release()
			return err
		}
		return nil
	}
}

func (c *Controller) release() { c.gate <- struct{}{} }

func (c *Controller) Connected() bool { return c.link.Connected() }

func (c *Controller) Connect(ctx context.Context) error {
	if err := c.acquire(ctx); err != nil {
		return err
	}
	defer c.release()
	if c.closed.Load() {
		return fmt.Errorf("контроллер остановлен")
	}
	return c.link.Connect(ctx)
}

func wait(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return ctx.Err()
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return ctx.Err()
	}
}

// Execute waits for native operations to return. A context cancellation prevents
// later packets; it cannot revoke a packet already handed to CoreBluetooth.
func (c *Controller) Execute(ctx context.Context, action protocol.Action) error {
	if len(action.Packets) == 0 {
		return fmt.Errorf("пустая последовательность команд")
	}
	if err := c.acquire(ctx); err != nil {
		return err
	}
	defer c.release()
	if c.closed.Load() {
		return fmt.Errorf("контроллер остановлен")
	}
	for attempt := 0; attempt < 2; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := c.link.Connect(ctx)
		if err == nil {
			for _, frame := range action.Packets {
				if err = wait(ctx, time.Until(c.lastWrite.Add(c.gap))); err != nil {
					break
				}
				err = c.link.Write(ctx, frame)
				c.lastWrite = time.Now()
				if err != nil {
					break
				}
			}
		}
		if ctxErr := ctx.Err(); ctxErr != nil {
			return errors.Join(ctxErr, err)
		}
		if err == nil {
			return nil
		}
		if attempt == 1 || !c.link.CanRetry(err) {
			return err
		}
		// Every action contains absolute values; reconnect and repeat at most once.
		if closeErr := c.link.Close(); closeErr != nil {
			return errors.Join(err, fmt.Errorf("отключение перед повтором: %w", closeErr))
		}
		if err := wait(ctx, 200*time.Millisecond); err != nil {
			return err
		}
	}
	return fmt.Errorf("команда не выполнена")
}

func (c *Controller) Close(ctx context.Context) error {
	c.closed.Store(true)
	if err := c.acquire(ctx); err != nil {
		return err
	}
	defer c.release()
	return c.link.Close()
}
