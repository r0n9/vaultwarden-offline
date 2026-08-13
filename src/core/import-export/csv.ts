/**
 * RFC 4180 CSV 解析与序列化。
 *
 * 不引第三方库：CSV 看着简单，坑都在引号与换行上，而这些规则本身不到 100 行
 * 就能写清楚——为它引一个依赖，反而给"零网络、零意外代码"的承诺添麻烦。
 */

/** 解析为二维数组。支持引号包裹、字段内换行、双写转义引号。 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // 去掉 UTF-8 BOM，否则第一个表头会带上不可见字符而匹配不上。
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i] as string;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          // 双写的引号代表一个字面引号。
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // 兼容 CRLF 与孤立的 CR。
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // 末尾没有换行时，收尾最后一行；但要避免把结尾换行误读成一个空行。
  if (field.length > 0 || row.length > 0) {
    endRow();
  }

  return rows;
}

/** 按表头把 CSV 解析成对象数组。列以**名称**而非位置匹配，容忍列序差异。 */
export function parseCsvRecords(input: string): Record<string, string>[] {
  const rows = parseCsv(input).filter((row) => row.some((cell) => cell.trim() !== ""));
  const header = rows.shift();

  if (header == null) {
    return [];
  }

  const columns = header.map((name) => name.trim());

  return rows.map((row) => {
    const record: Record<string, string> = {};
    columns.forEach((name, index) => {
      record[name] = row[index] ?? "";
    });
    return record;
  });
}

/** 仅在必要时加引号，与 Bitwarden 导出的观感保持一致。 */
function escapeCell(value: string): string {
  if (value === "") {
    return "";
  }
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function serializeCsv(columns: readonly string[], rows: Record<string, string>[]): string {
  const lines = [columns.map(escapeCell).join(",")];

  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(row[column] ?? "")).join(","));
  }

  return `${lines.join("\n")}\n`;
}
