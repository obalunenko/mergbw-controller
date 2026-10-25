package managed

import (
	"bytes"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"io"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testFrame() Frame {
	return Frame{Version: 1, Session: strings.Repeat("a", 32), RequestID: strings.Repeat("b", 32), Type: "host.alive", Payload: jsontext.Value(`{}`)}
}

func TestControlRoundTripAndEOF(t *testing.T) {
	frame := testFrame()
	var buffer bytes.Buffer
	require.NoError(t, NewEncoder(&buffer).Write(frame))
	decoder := NewDecoder(&buffer, frame.Session)
	got, err := decoder.Read()
	require.NoError(t, err)
	assert.Equal(t, frame, got)
	_, err = decoder.Read()
	assert.ErrorIs(t, err, io.EOF)
}

func TestControlRejectsInvalidBoundaries(t *testing.T) {
	for _, name := range []string{"version", "session", "request", "type", "array", "missing payload"} {
		t.Run(name, func(t *testing.T) {
			frame := testFrame()
			switch name {
			case "version":
				frame.Version = 2
			case "session":
				frame.Session = "invalid"
			case "request":
				frame.RequestID = "invalid"
			case "type":
				frame.Type = "unknown"
			case "array":
				frame.Payload = jsontext.Value(`[]`)
			case "missing payload":
				frame.Payload = nil
			}
			data, err := json.Marshal(frame)
			require.NoError(t, err)
			_, err = NewDecoder(strings.NewReader(string(data)+"\n"), strings.Repeat("a", 32)).Read()
			assert.ErrorIs(t, err, ProtocolIncompatible)
		})
	}
	frame := testFrame()
	data, err := json.Marshal(frame)
	require.NoError(t, err)
	for _, input := range []string{string(data), strings.Repeat("x", MaxFrameBytes) + "\n", string(data[:len(data)-1]) + `,"unknown":true}` + "\n", strings.Replace(string(data), `"v":1`, `"v":1,"v":1`, 1) + "\n"} {
		_, err := NewDecoder(strings.NewReader(input), frame.Session).Read()
		assert.ErrorIs(t, err, ProtocolIncompatible)
	}
	_, err = NewDecoder(strings.NewReader(string(data)+"\n"), strings.Repeat("c", 32)).Read()
	assert.ErrorIs(t, err, ProtocolIncompatible)
}

func TestRequestsBoundedAndReleased(t *testing.T) {
	var requests Requests
	for n := range MaxRequests {
		require.NoError(t, requests.Add(fmt.Sprintf("%032x", n)))
	}
	assert.Error(t, requests.Add(fmt.Sprintf("%032x", 99)))
	assert.ErrorIs(t, requests.Add(fmt.Sprintf("%032x", 0)), ProtocolIncompatible)
	requests.Done(fmt.Sprintf("%032x", 0))
	require.NoError(t, requests.Add(fmt.Sprintf("%032x", 99)))
}

func TestIDsAreOpaqueAndDiagnosticsAreDiscarded(t *testing.T) {
	a, err := NewID()
	require.NoError(t, err)
	b, err := NewID()
	require.NoError(t, err)
	assert.True(t, ValidID(a))
	assert.NotEqual(t, a, b)
	DrainDiagnostics(strings.NewReader(strings.Repeat("private_token\n", 100000)))
}
