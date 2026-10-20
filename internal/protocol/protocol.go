// Package protocol implements the MeRGBW LT-06 protocol whose power packets
// were confirmed on the user's lamp. RGB and brightness still need hardware QA.
package protocol

import (
	"encoding/hex"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type Preset struct {
	Label      string `json:"label"`
	RGB        []int  `json:"rgb"`
	Brightness int    `json:"brightness"`
}

type Action struct {
	Route   string
	Packets [][]byte
}

var slugPattern = regexp.MustCompile(`^[a-z0-9_-]{1,40}$`)
var brightnessPattern = regexp.MustCompile(`^[0-9]{1,3}$`)

// packet uses one's-complement addition with end-around carry, not sum mod 256.
func packet(command byte, payload ...byte) []byte {
	frame := append([]byte{0x55, command, 0xff, byte(5 + len(payload))}, payload...)
	sum := 0
	for _, value := range frame {
		sum += int(value)
	}
	for sum > 0xff {
		sum = (sum >> 8) + (sum & 0xff)
	}
	return append(frame, ^byte(sum))
}

func rgbBytes(rgb []int) ([]byte, error) {
	if len(rgb) != 3 {
		return nil, fmt.Errorf("RGB: нужны три целых числа [R, G, B]")
	}
	out := make([]byte, 3)
	for i, value := range rgb {
		if value < 0 || value > 255 {
			return nil, fmt.Errorf("RGB: каждое значение должно быть от 0 до 255")
		}
		out[i] = byte(value)
	}
	return out, nil
}

func ValidatePresets(presets map[string]Preset) error {
	if len(presets) == 0 {
		return fmt.Errorf("presets.json должен содержать хотя бы один пресет")
	}
	for slug, preset := range presets {
		if !slugPattern.MatchString(slug) {
			return fmt.Errorf("идентификатор пресета %q: допустимы a-z, 0-9, _ и -; длина 1–40", slug)
		}
		if strings.TrimSpace(preset.Label) == "" || strings.ContainsAny(preset.Label, "\r\n") {
			return fmt.Errorf("пресет %s: label должен содержать название в одну строку", slug)
		}
		if _, err := rgbBytes(preset.RGB); err != nil {
			return fmt.Errorf("пресет %s: %w", slug, err)
		}
		if preset.Brightness < 0 || preset.Brightness > 100 {
			return fmt.Errorf("пресет %s: brightness должен быть от 0 до 100", slug)
		}
	}
	return nil
}

// Resolve validates the entire command before producing any BLE packets.
// All supported commands are absolute, so a reconnect can safely repeat them.
func Resolve(args []string, presets map[string]Preset) (Action, error) {
	if len(args) == 0 {
		return Action{}, fmt.Errorf("нужна команда: on, off, color, brightness или preset")
	}
	name := args[0]
	if name == "on" || name == "off" {
		if len(args) != 1 {
			return Action{}, fmt.Errorf("команда %s не принимает параметров", name)
		}
		value := byte(0)
		if name == "on" {
			value = 1
		}
		return Action{Route: name, Packets: [][]byte{packet(0x01, value)}}, nil
	}
	if len(args) != 2 {
		return Action{}, fmt.Errorf("команды color, brightness и preset принимают один параметр")
	}
	value := args[1]
	on := packet(0x01, 1)
	switch name {
	case "color":
		color := strings.TrimPrefix(value, "#")
		if len(color) != 6 {
			return Action{}, fmt.Errorf("цвет: шесть HEX-цифр, например FF5000")
		}
		rgb, err := hex.DecodeString(color)
		if err != nil {
			return Action{}, fmt.Errorf("цвет: шесть HEX-цифр, например FF5000")
		}
		return Action{Route: "color/" + strings.ToUpper(color), Packets: [][]byte{on, packet(0x03, rgb...)}}, nil
	case "brightness":
		level, err := strconv.Atoi(value)
		if err != nil || !brightnessPattern.MatchString(value) || level > 100 {
			return Action{}, fmt.Errorf("яркость: целое число от 0 до 100")
		}
		return Action{Route: fmt.Sprintf("brightness/%d", level), Packets: [][]byte{on, packet(0x05, byte(level))}}, nil
	case "preset":
		preset, ok := presets[value]
		if !ok {
			keys := make([]string, 0, len(presets))
			for key := range presets {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			return Action{}, fmt.Errorf("неизвестный пресет; доступны: %s", strings.Join(keys, ", "))
		}
		rgb, err := rgbBytes(preset.RGB)
		if err != nil || preset.Brightness < 0 || preset.Brightness > 100 {
			return Action{}, fmt.Errorf("некорректные RGB/brightness у пресета %s", value)
		}
		return Action{Route: "preset/" + value, Packets: [][]byte{on, packet(0x03, rgb...), packet(0x05, byte(preset.Brightness))}}, nil
	default:
		return Action{}, fmt.Errorf("неизвестная команда; допустимы on, off, color, brightness, preset")
	}
}
