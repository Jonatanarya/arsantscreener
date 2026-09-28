package store

import "testing"

func TestBrokerHealthStatus(t *testing.T) {
	tests := []struct {
		fresh int
		total int
		want  string
	}{
		{300, 300, "healthy"},
		{285, 300, "degraded"},
		{284, 300, "critical"},
		{0, 300, "critical"},
		{0, 0, "critical"},
	}
	for _, test := range tests {
		if got := brokerHealthStatus(test.fresh, test.total); got != test.want {
			t.Fatalf("brokerHealthStatus(%d,%d)=%q, want %q", test.fresh, test.total, got, test.want)
		}
	}
}
