package dbmigrate

import "testing"

func TestLoadMigrationsIsSequential(t *testing.T) {
	loaded, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if len(loaded) < 17 {
		t.Fatalf("loaded %d migrations, want at least 17", len(loaded))
	}
	for index, migration := range loaded {
		want := uint64(index + 1)
		if migration.Version != want {
			t.Fatalf("migration[%d].Version = %d, want %d", index, migration.Version, want)
		}
		if len(migration.Checksum) != 64 {
			t.Fatalf("migration %d checksum length = %d", migration.Version, len(migration.Checksum))
		}
		if migration.SQL == "" {
			t.Fatalf("migration %d SQL is empty", migration.Version)
		}
	}
}
