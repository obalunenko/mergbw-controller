package logging

import (
	"log/slog"
	"strings"
)

// RedactSecrets returns a slog ReplaceAttr function. Command URLs are never
// logged, and this is a final safeguard if a secret is repeated in an error or
// a user-supplied value. slog applies it to messages and nested group fields too.
func RedactSecrets(secrets ...string) func([]string, slog.Attr) slog.Attr {
	pairs := make([]string, 0, 2*len(secrets))
	for _, secret := range secrets {
		if secret != "" {
			pairs = append(pairs, secret, "[REDACTED]")
		}
	}
	replacer := strings.NewReplacer(pairs...)
	return func(_ []string, attr slog.Attr) slog.Attr {
		attr.Value = attr.Value.Resolve()
		switch attr.Value.Kind() {
		case slog.KindString:
			attr.Value = slog.StringValue(replacer.Replace(attr.Value.String()))
		case slog.KindAny:
			if err, ok := attr.Value.Any().(error); ok {
				attr.Value = slog.StringValue(replacer.Replace(err.Error()))
			}
		}
		return attr
	}
}
