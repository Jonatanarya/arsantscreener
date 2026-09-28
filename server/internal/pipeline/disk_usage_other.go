//go:build !linux

package pipeline

import "fmt"

func readStorageUsage(path string) (StorageUsage, error) {
	return StorageUsage{}, fmt.Errorf("storage usage is not supported on this operating system for %q", path)
}
