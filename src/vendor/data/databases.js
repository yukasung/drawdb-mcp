// SHIM (not upstream code).
//
// Upstream `src/data/databases.js` carries React icon components and i18n keys
// alongside the capability flags, which would drag the whole GUI toolchain in.
// `utils/exportAs/documentation.js` reads only `databases[db].name`, so this
// keeps the flags (transcribed verbatim from upstream) and the display name,
// and drops the presentation.
export const databases = {
  mysql: {
    name: "MySQL",
    label: "mysql",
    hasTypes: false,
    hasEnums: false,
    hasArrays: false,
    hasUnsignedTypes: true,
  },
  postgresql: {
    name: "PostgreSQL",
    label: "postgresql",
    hasTypes: true,
    hasEnums: true,
    hasArrays: true,
    hasUnsignedTypes: false,
  },
  transactsql: {
    name: "MSSQL",
    label: "transactsql",
    hasTypes: false,
    hasEnums: false,
    hasArrays: false,
    hasUnsignedTypes: false,
  },
  sqlite: {
    name: "SQLite",
    label: "sqlite",
    hasTypes: false,
    hasEnums: false,
    hasArrays: false,
    hasUnsignedTypes: false,
  },
  mariadb: {
    name: "MariaDB",
    label: "mariadb",
    hasTypes: false,
    hasEnums: false,
    hasArrays: false,
    hasUnsignedTypes: true,
  },
  oraclesql: {
    name: "Oracle",
    label: "oraclesql",
    hasTypes: false,
    hasEnums: false,
    hasArrays: false,
    hasUnsignedTypes: false,
  },
  generic: {
    name: "Generic",
    label: "generic",
    hasTypes: true,
    hasEnums: false,
    hasArrays: false,
    hasUnsignedTypes: false,
  },
};
