package protocol

import (
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

var ErrTransitionNotFound = errors.New("transition not found")

// Transition specifies explicit commanded endpoints, not measured lamp state.
type Transition struct {
	FromRGB         [3]int
	FromBrightness  int
	ToRGB           [3]int
	ToBrightness    int
	DurationSeconds int
}

type TransitionSnapshot struct {
	ID                    string `json:"id"`
	State                 string `json:"state"`
	ElapsedMS             int64  `json:"elapsedMs"`
	DurationMS            int64  `json:"durationMs"`
	PhysicalStateVerified bool   `json:"physical_state_verified"`
}

func (t Transition) Validate() error {
	if _, err := rgbBytes(t.FromRGB[:]); err != nil {
		return err
	}
	if _, err := rgbBytes(t.ToRGB[:]); err != nil {
		return err
	}
	if t.FromBrightness < 0 || t.FromBrightness > 100 || t.ToBrightness < 0 || t.ToBrightness > 100 {
		return fmt.Errorf("яркость перехода должна быть от 0 до 100")
	}
	if t.DurationSeconds < 1 || t.DurationSeconds > 60 {
		return fmt.Errorf("длительность перехода должна быть от 1 до 60 секунд")
	}
	return nil
}

func (t Transition) Duration() time.Duration { return time.Duration(t.DurationSeconds) * time.Second }

// Sample rounds a linear interpolation and clamps to the exact endpoints.
func (t Transition) Sample(elapsed time.Duration) ([3]int, int) {
	fraction := min(1.0, max(0.0, float64(elapsed)/float64(t.Duration())))
	interpolate := func(from, to int) int { return int(math.Round(float64(from) + float64(to-from)*fraction)) }
	var rgb [3]int
	for i := range rgb {
		rgb[i] = interpolate(t.FromRGB[i], t.ToRGB[i])
	}
	return rgb, interpolate(t.FromBrightness, t.ToBrightness)
}

func TransitionPackets(rgb [3]int, brightness int) [][]byte {
	return [][]byte{packet(0x03, byte(rgb[0]), byte(rgb[1]), byte(rgb[2])), packet(0x05, byte(brightness))}
}

func (t Transition) InitialPackets() [][]byte {
	return append([][]byte{packet(0x01, 1)}, TransitionPackets(t.FromRGB, t.FromBrightness)...)
}

func resolveTransition(args []string) (Action, error) {
	if len(args) != 5 {
		return Action{}, fmt.Errorf("transition: FROMHEX FROMPERCENT TOHEX TOPERCENT SECONDS")
	}
	decode := func(value string) ([3]int, error) {
		var rgb [3]int
		if len(value) != 6 {
			return rgb, fmt.Errorf("RGB: шесть HEX-цифр")
		}
		bytes, err := hex.DecodeString(value)
		if err != nil {
			return rgb, fmt.Errorf("RGB: шесть HEX-цифр")
		}
		for i := range rgb {
			rgb[i] = int(bytes[i])
		}
		return rgb, nil
	}
	from, err := decode(args[0])
	if err != nil {
		return Action{}, err
	}
	to, err := decode(args[2])
	if err != nil {
		return Action{}, err
	}
	values := make([]int, 3)
	for i, index := range []int{1, 3, 4} {
		if !brightnessPattern.MatchString(args[index]) {
			return Action{}, fmt.Errorf("параметр перехода должен быть целым числом")
		}
		values[i], err = strconv.Atoi(args[index])
		if err != nil {
			return Action{}, fmt.Errorf("некорректный параметр перехода")
		}
	}
	t := Transition{FromRGB: from, FromBrightness: values[0], ToRGB: to, ToBrightness: values[1], DurationSeconds: values[2]}
	if err := t.Validate(); err != nil {
		return Action{}, err
	}
	return Action{Route: fmt.Sprintf("transition/%s/%d/%s/%d/%d", strings.ToUpper(args[0]), values[0], strings.ToUpper(args[2]), values[1], values[2]), Transition: &t}, nil
}
