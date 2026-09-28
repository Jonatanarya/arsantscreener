package pipeline

import "testing"

func TestUsagePercentRoundsUp(t *testing.T) {
	if got := usagePercent(100, 11); got != 89 {
		t.Fatalf("usagePercent = %d, want 89", got)
	}
	if got := usagePercent(100, 10); got != 90 {
		t.Fatalf("usagePercent = %d, want 90", got)
	}
}
