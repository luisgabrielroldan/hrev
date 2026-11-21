//go:build !windows

package store

import (
	"errors"
	"os"
	"syscall"
)

// lockExclusive takes an exclusive lock on f without a wait. It gives ErrLocked when another process holds the lock.
func lockExclusive(f *os.File) error {
	err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if errors.Is(err, syscall.EWOULDBLOCK) {
		return ErrLocked
	}
	return err
}
