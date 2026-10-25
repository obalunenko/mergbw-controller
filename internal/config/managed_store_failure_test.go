package config

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

// Every collaborator remains a generated mock, delegating successful operations
// to a private synthetic filesystem; failures can occur before or after rename.
func faultStore(t *testing.T, root string, fail string, afterRename bool) *ManagedStore {
	t.Helper()
	disk, err := os.OpenRoot(root)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, disk.Close()) })
	real := &rootedFiles{disk}
	mocks := gomock.NewController(t)
	files := NewMockManagedFiles(mocks)
	pointerReplaced := false
	files.EXPECT().ReadFile(gomock.Any()).DoAndReturn(func(name string) ([]byte, error) {
		if pointerReplaced && "read:"+name == fail {
			return nil, errors.New("synthetic read failure")
		}
		return real.ReadFile(name)
	}).AnyTimes()
	files.EXPECT().Lstat(gomock.Any()).DoAndReturn(real.Lstat).AnyTimes()
	files.EXPECT().MkdirAll(gomock.Any(), gomock.Any()).DoAndReturn(real.MkdirAll).AnyTimes()
	files.EXPECT().Rename(gomock.Any(), gomock.Any()).DoAndReturn(func(old, new string) error {
		if "rename:"+new == fail {
			if afterRename {
				require.NoError(t, real.Rename(old, new))
			}
			return errors.New("synthetic failure")
		}
		err := real.Rename(old, new)
		if err == nil && new == "CURRENT.json" {
			pointerReplaced = true
		}
		return err
	}).AnyTimes()
	files.EXPECT().OpenFile(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(func(name string, flag int, mode fs.FileMode) (ManagedFile, error) {
		if "open:"+name == fail {
			return nil, errors.New("synthetic failure")
		}
		file, err := real.OpenFile(name, flag, mode)
		if err != nil {
			return nil, err
		}
		mock := NewMockManagedFile(mocks)
		mock.EXPECT().Write(gomock.Any()).DoAndReturn(func(data []byte) (int, error) {
			if "write:"+name == fail {
				return 0, errors.New("synthetic failure")
			}
			return file.Write(data)
		}).AnyTimes()
		mock.EXPECT().Sync().DoAndReturn(func() error {
			if "sync:"+name == fail {
				return errors.New("synthetic failure")
			}
			return file.Sync()
		}).AnyTimes()
		mock.EXPECT().Close().DoAndReturn(func() error {
			err := file.Close()
			if "close:"+name == fail {
				return errors.New("synthetic failure")
			}
			return err
		}).AnyTimes()
		return mock, nil
	}).AnyTimes()
	return NewManagedStore(files)
}
func TestManagedStoreEveryPairAndPointerFailpoint(t *testing.T) {
	candidate, tx := strings.Repeat("b", 32), strings.Repeat("c", 32)
	stage := filepath.Join("staging", tx)
	pointer := filepath.Join("staging", tx+".CURRENT.json")
	var failures []string
	for _, file := range []string{filepath.Join(stage, "settings.json"), filepath.Join(stage, "presets.json"), pointer} {
		for _, operation := range []string{"open:", "write:", "sync:", "close:"} {
			failures = append(failures, operation+file)
		}
	}
	for _, dir := range []string{stage, "generations", "."} {
		for _, op := range []string{"open:", "sync:", "close:"} {
			failures = append(failures, op+dir)
		}
	}
	failures = append(failures, "rename:"+filepath.Join("generations", candidate), "rename:CURRENT.json")
	for _, failure := range failures {
		t.Run(failure, func(t *testing.T) {
			directory := t.TempDir()
			baseline, err := OpenManagedStore(directory)
			require.NoError(t, err)
			defer baseline.Close()
			settings, err := PrepareManualSettings("AA:BB:CC:DD:EE:FF", nil)
			require.NoError(t, err)
			expected := strings.Repeat("a", 32)
			first, err := baseline.Stage(expected, strings.Repeat("d", 32), settings, DefaultPresets())
			require.NoError(t, err)
			_, err = baseline.Commit(*first, "")
			require.NoError(t, err)
			settings.Port++
			faulty := faultStore(t, directory, failure, false)
			staged, stageErr := faulty.Stage(candidate, tx, settings, DefaultPresets())
			if stageErr == nil {
				result, commitErr := faulty.Commit(*staged, expected)
				if strings.HasSuffix(failure, ":.") {
					require.NoError(t, commitErr)
					assert.Equal(t, Applied, result.Outcome)
					assert.True(t, result.DurabilityUnknown)
				} else {
					assert.Error(t, commitErr)
					assert.Equal(t, NotApplied, result.Outcome)
				}
			} else {
				assert.ErrorIs(t, stageErr, ErrStorageUnavailable)
			}
			active, err := baseline.Read()
			require.NoError(t, err)
			want := expected
			if strings.HasSuffix(failure, ":.") {
				want = candidate
			}
			assert.Equal(t, want, active.Generation)
			old, err := baseline.ReadGeneration(expected)
			require.NoError(t, err)
			assert.Equal(t, settings.AccessToken, old.Settings.AccessToken)
		})
	}
}
func TestManagedStorePointerErrorAfterReplacementAndLostReply(t *testing.T) {
	directory := t.TempDir()
	store, err := OpenManagedStore(directory)
	require.NoError(t, err)
	defer store.Close()
	candidate, tx := strings.Repeat("b", 32), strings.Repeat("c", 32)
	settings, err := PrepareManualSettings("AA:BB:CC:DD:EE:FF", nil)
	require.NoError(t, err)
	staged, err := store.Stage(candidate, tx, settings, DefaultPresets())
	require.NoError(t, err)
	faulty := faultStore(t, directory, "rename:CURRENT.json", true)
	result, err := faulty.Commit(*staged, "")
	require.NoError(t, err)
	assert.Equal(t, Applied, result.Outcome)
	assert.True(t, result.DurabilityUnknown)
	// Retrying only reconciliation cannot write another pair or rotate a secret.
	result, err = store.Commit(*staged, "")
	require.NoError(t, err)
	assert.Equal(t, Applied, result.Outcome)
	active, err := store.Read()
	require.NoError(t, err)
	assert.Equal(t, settings, active.Settings)
	assert.Equal(t, Applied, store.CheckOutcome(candidate, "").Outcome)
	unknown := store.CheckOutcome(strings.Repeat("d", 32), "")
	assert.Equal(t, CommitUnknown, unknown.Outcome)
	assert.True(t, unknown.ActiveStateKnown)
	require.NoError(t, os.WriteFile(filepath.Join(directory, "CURRENT.json"), []byte("{"), 0600))
	assert.False(t, store.CheckOutcome(candidate, "").ActiveStateKnown)
	_, err = store.Commit(*staged, "")
	assert.ErrorIs(t, err, ErrStorageUnavailable)
}

func TestManagedStoreFailedAttemptCannotRetryMutation(t *testing.T) {
	directory := t.TempDir()
	store, err := OpenManagedStore(directory)
	require.NoError(t, err)
	defer store.Close()
	settings, err := PrepareManualSettings("AA:BB:CC:DD:EE:FF", nil)
	require.NoError(t, err)
	candidate, tx := strings.Repeat("a", 32), strings.Repeat("b", 32)
	staged, err := store.Stage(candidate, tx, settings, DefaultPresets())
	require.NoError(t, err)
	faulty := faultStore(t, directory, "rename:CURRENT.json", false)
	result, err := faulty.Commit(*staged, "")
	assert.Error(t, err)
	assert.Equal(t, NotApplied, result.Outcome)
	forged := *staged
	forged.Generation = strings.Repeat("e", 32)
	_, forgedErr := faulty.Commit(forged, "")
	assert.ErrorIs(t, forgedErr, ErrInvalidConfiguration)
	// Removing the obstruction cannot cause a second application of the attempt.
	again, err := faulty.Commit(*staged, "")
	assert.Error(t, err)
	assert.Equal(t, result, again)
	active, err := store.Read()
	require.NoError(t, err)
	assert.Nil(t, active)
}

func TestManagedStoreUnreadableAfterPointerCommitIsUnknownUntilReadOnlyRecovery(t *testing.T) {
	directory := t.TempDir()
	store, err := OpenManagedStore(directory)
	require.NoError(t, err)
	defer store.Close()
	settings, err := PrepareManualSettings("AA:BB:CC:DD:EE:FF", nil)
	require.NoError(t, err)
	candidate, tx := strings.Repeat("a", 32), strings.Repeat("b", 32)
	staged, err := store.Stage(candidate, tx, settings, DefaultPresets())
	require.NoError(t, err)
	faulty := faultStore(t, directory, "read:CURRENT.json", false)
	result, err := faulty.Commit(*staged, "")
	assert.ErrorIs(t, err, ErrStorageUnavailable)
	assert.Equal(t, CommitUnknown, result.Outcome)
	assert.False(t, result.ActiveStateKnown)
	_, err = faulty.Stage(strings.Repeat("c", 32), strings.Repeat("d", 32), settings, DefaultPresets())
	assert.ErrorIs(t, err, ErrStorageUnavailable)
	recovered := store.CheckOutcome(candidate, "")
	assert.Equal(t, Applied, recovered.Outcome)
	assert.True(t, recovered.ActiveStateKnown)
}
