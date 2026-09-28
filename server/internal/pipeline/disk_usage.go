package pipeline

type StorageUsage struct {
	Path        string `json:"path"`
	UsedPercent int    `json:"usedPercent"`
	FreeBytes   uint64 `json:"freeBytes"`
	TotalBytes  uint64 `json:"totalBytes"`
}

type storageGuard struct {
	paths               []string
	criticalUsedPercent int
}

func usagePercent(total, free uint64) int {
	if total == 0 || free >= total {
		return 0
	}
	used := total - free
	return int((used*100 + total - 1) / total)
}
