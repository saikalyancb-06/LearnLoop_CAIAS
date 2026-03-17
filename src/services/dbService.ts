import { supabase } from "../lib/supabaseClient";
import type { TableInsert, TableName, TableRow, TableUpdate } from "../types/database";

type QueryOptions = {
  column?: string;
  ascending?: boolean;
  limit?: number;
};

async function listRecords<T extends TableName>(
  table: T,
  options: QueryOptions = {},
) {
  const {
    column = "created_at",
    ascending = false,
    limit,
  } = options;

  let query = supabase.from(table).select("*").order(column, { ascending });

  if (typeof limit === "number") {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as TableRow<T>[];
}

async function getRecordById<T extends TableName>(table: T, id: string) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data as TableRow<T>;
}

async function insertRecord<T extends TableName>(
  table: T,
  payload: TableInsert<T>,
) {
  const { data, error } = await supabase
    .from(table)
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as TableRow<T>;
}

async function updateRecord<T extends TableName>(
  table: T,
  id: string,
  payload: TableUpdate<T>,
) {
  const { data, error } = await supabase
    .from(table)
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as TableRow<T>;
}

async function deleteRecord<T extends TableName>(table: T, id: string) {
  const { error } = await supabase.from(table).delete().eq("id", id);

  if (error) {
    throw error;
  }
}

export const dbService = {
  listRecords,
  getRecordById,
  insertRecord,
  updateRecord,
  deleteRecord,
};
