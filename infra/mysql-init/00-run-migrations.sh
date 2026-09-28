#!/bin/sh
set -eu

mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" "${MYSQL_DATABASE}" <<'SQL'
CREATE TABLE IF NOT EXISTS arsant_schema_migrations (
  version BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  checksum CHAR(64) NOT NULL,
  dirty TINYINT(1) NOT NULL DEFAULT 0,
  applied_at DATETIME NOT NULL,
  KEY idx_arsant_schema_dirty (dirty, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL

for migration in /migrations/*.up.sql; do
  filename=$(basename "$migration")
  version=$(printf '%s' "$filename" | sed -E 's/^0*([0-9]+)_.*/\1/')
  name=$(printf '%s' "$filename" | sed -E 's/^[0-9]+_(.*)\.up\.sql$/\1/')
  checksum=$(sha256sum "$migration" | cut -d' ' -f1)
  echo "Applying $filename"
  mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" "${MYSQL_DATABASE}" \
    -e "INSERT INTO arsant_schema_migrations (version,name,checksum,dirty,applied_at) VALUES (${version},'${name}','${checksum}',1,UTC_TIMESTAMP())"
  mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" "${MYSQL_DATABASE}" < "$migration"
  mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" "${MYSQL_DATABASE}" \
    -e "UPDATE arsant_schema_migrations SET dirty=0,applied_at=UTC_TIMESTAMP() WHERE version=${version}"
done
