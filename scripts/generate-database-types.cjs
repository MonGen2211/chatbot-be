const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const { getPoolConfig } = require('./postgres-config.cjs');
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

function columnType(column) {
  if (column.enum_values?.length) return column.enum_values.map(value => JSON.stringify(value)).join(' | ');
  if (['integer', 'smallint', 'real', 'double precision'].includes(column.data_type)) return 'number';
  if (column.data_type === 'boolean') return 'boolean';
  if (['json', 'jsonb'].includes(column.data_type)) return 'Json';
  if (column.data_type === 'ARRAY') {
    const type = column.udt_name.slice(1);
    return ['int2', 'int4', 'float4', 'float8'].includes(type) ? 'number[]' : type === 'bool' ? 'boolean[]' : 'string[]';
  }
  // pg returns int8/numeric as strings by default, preserving precision.
  if (['bigint', 'numeric', 'decimal', 'text', 'character varying', 'character', 'uuid', 'date',
    'timestamp with time zone', 'timestamp without time zone', 'time with time zone', 'time without time zone', 'inet'].includes(column.data_type)) return 'string';
  throw new Error(`Unsupported column type ${column.data_type}; extend the generator before regenerating.`);
}

(async () => {
  const pool = new Pool(getPoolConfig(process.env.DATABASE_URL, process.env.DATABASE_CA_FILE));
  try {
    const { rows } = await pool.query(`SELECT c.*, (
      SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typname = c.udt_name AND n.nspname = c.udt_schema
    ) AS enum_values FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position`);
    const tables = new Map();
    for (const column of rows) {
      if (!tables.has(column.table_name)) tables.set(column.table_name, []);
      tables.get(column.table_name).push(column);
    }
    for (const name of ['profiles', 'conversations', 'messages']) if (!tables.has(name)) throw new Error(`Missing table ${name}; run db:migrate first.`);
    const lines = [
      '// Generated from PostgreSQL public schema by npm run db:types. Do not edit manually.',
      'export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];',
      'export type Database = { public: { Tables: {',
    ];
    for (const [table, columns] of tables) {
      lines.push(`${JSON.stringify(table)}: {`);
      for (const kind of ['Row', 'Insert', 'Update']) {
        lines.push(`${kind}: {`);
        for (const column of columns) {
          const nullable = column.is_nullable === 'YES';
          const generated = column.is_generated === 'ALWAYS' || column.identity_generation === 'ALWAYS';
          const optional = kind === 'Update' || (kind === 'Insert' && (nullable || column.column_default !== null || column.is_identity === 'YES' || generated));
          const type = kind !== 'Row' && generated ? 'never' : `${columnType(column)}${nullable ? ' | null' : ''}`;
          lines.push(`  ${JSON.stringify(column.column_name)}${optional ? '?' : ''}: ${type};`);
        }
        lines.push('};');
      }
      lines.push('Relationships: [];', '};');
    }
    lines.push('}; Views: { [_ in never]: never }; Functions: { [_ in never]: never }; Enums: { [_ in never]: never }; CompositeTypes: { [_ in never]: never }; }; };',
      "export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];",
      "export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];",
      "export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];", '');
    const destination = path.resolve(__dirname, '../src/types/database.types.ts');
    await fs.writeFile(`${destination}.tmp`, lines.join('\n'), 'utf8');
    await fs.rename(`${destination}.tmp`, destination);
    console.log(`Generated public schema types (${tables.size} tables). No account/message rows were read.`);
  } finally { await pool.end(); }
})().catch(error => { console.error(error.code ? `Type generation failed (${error.code}).` : error.message); process.exitCode = 1; });
