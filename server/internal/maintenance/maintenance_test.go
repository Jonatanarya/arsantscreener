package maintenance

import "testing"

func TestDefaultPolicyIsValid(t *testing.T) {
	if err := DefaultPolicy().Validate(); err != nil {
		t.Fatalf("default policy must be valid: %v", err)
	}
}

func TestPolicyRejectsUnsafeRange(t *testing.T) {
	policy := DefaultPolicy()
	policy.RawIngestDays = 0
	if err := policy.Validate(); err == nil {
		t.Fatal("expected invalid retention period")
	}
}
