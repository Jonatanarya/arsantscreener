// Package migrations exposes the database migration files to the migration
// command. Embedding keeps production deployments self-contained: the binary
// and the schema definition always have the same version.
package migrations

import "embed"

// Files contains every forward and rollback migration.
//
//go:embed *.up.sql *.down.sql
var Files embed.FS
