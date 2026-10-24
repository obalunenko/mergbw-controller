//go:build darwin || linux

package managed

import (
	"net"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// DialAppControl connects only to the private, current-user endpoint created by
// this plugin run. It must succeed before any session or worker is admitted.
func DialAppControl(path string) (net.Conn, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || filepath.Base(path) != "control.sock" {
		return nil, HostUnavailable
	}
	for _, entry := range []struct {
		path string
		kind os.FileMode
		mode os.FileMode
	}{
		{filepath.Dir(path), os.ModeDir, 0700},
		{path, os.ModeSocket, 0600},
	} {
		info, err := os.Lstat(entry.path)
		if err != nil || info.Mode().Type() != entry.kind || info.Mode()&(os.ModePerm|os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != entry.mode {
			return nil, HostUnavailable
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != uint32(os.Getuid()) {
			return nil, HostUnavailable
		}
	}
	connection, err := net.DialTimeout("unix", path, 3*time.Second)
	if err != nil {
		return nil, HostUnavailable
	}
	return connection, nil
}
