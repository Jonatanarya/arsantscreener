//go:build linux

package pipeline

import "golang.org/x/sys/unix"

func readStorageUsage(path string) (StorageUsage, error) {
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return StorageUsage{}, err
	}
	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bavail * uint64(stat.Bsize)
	return StorageUsage{
		Path: path, UsedPercent: usagePercent(total, free),
		FreeBytes: free, TotalBytes: total,
	}, nil
}
