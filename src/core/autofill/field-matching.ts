import type { AutofillField } from "./models";

/**
 * 字段匹配原语。
 *
 * 两种匹配方式服务于两类场景：
 *   {@link matchKeywordIndex} 精确相等 + 优先级，用于登录字段
 *   {@link attributesContain}  子串包含，用于卡片与身份字段
 *
 * 之所以分开，是因为两类字段的命名习惯差别很大：登录字段的 name/id 高度收敛
 * （就那么几种写法），精确匹配足够且误判少；卡片与身份字段则五花八门
 * （`billing_address_line1_input`），只能靠子串。
 */

/** 登录字段精确匹配时依次比对的属性。 */
const LOGIN_MATCH_PROPERTIES = [
  "htmlID",
  "htmlName",
  "label-left",
  "label-right",
  "label-tag",
  "label-aria",
  "placeholder",
] as const;

/** 卡片与身份字段做子串匹配时比对的属性，范围更宽。 */
const CONTAINS_MATCH_PROPERTIES = [
  "autoCompleteType",
  "data-stripe",
  "htmlName",
  "htmlID",
  "title",
  "label-tag",
  "placeholder",
  "label-left",
  "label-top",
  "label-right",
] as const;

/** `id=` 这类前缀限定只比对某一个属性。 */
const PROPERTY_PREFIXES: Record<string, string> = {
  id: "htmlID",
  name: "htmlName",
  placeholder: "placeholder",
};

/** `label=` 前缀会比对全部四种标签来源。 */
const LABEL_PROPERTIES = ["label-left", "label-right", "label-tag", "label-aria"] as const;

function readProperty(field: AutofillField, property: string): string | undefined {
  const value = (field as unknown as Record<string, unknown>)[property];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 单个属性与单个词条是否匹配。支持 `regex=` 与 `csv=` 两种写法。 */
export function propertyMatchesKeyword(
  field: AutofillField,
  property: string,
  keyword: string,
): boolean {
  const raw = readProperty(field, property);
  if (raw == null) {
    return false;
  }

  const value = raw.trim().replace(/\r\n|\r|\n/g, "");

  if (keyword.startsWith("regex=")) {
    try {
      return new RegExp(keyword.slice("regex=".length), "i").test(value);
    } catch {
      // 词条里的正则写错了不该让整次判定崩掉。
      return false;
    }
  }

  if (keyword.startsWith("csv=")) {
    return keyword
      .slice("csv=".length)
      .split(",")
      .some((entry) => entry.trim().toLowerCase() === value.toLowerCase());
  }

  return value.toLowerCase() === keyword;
}

/**
 * 在词条表中找出该字段命中的最高优先级。
 *
 * @returns 命中词条在表中的下标（越小越可信），未命中返回 -1
 */
export function matchKeywordIndex(field: AutofillField, keywords: readonly string[]): number {
  for (let index = 0; index < keywords.length; index++) {
    const keyword = keywords[index]!;

    if (keyword.includes("=")) {
      const [prefix] = keyword.split("=", 1);
      const value = keyword.slice((prefix?.length ?? 0) + 1);

      if (prefix != null && prefix in PROPERTY_PREFIXES) {
        if (propertyMatchesKeyword(field, PROPERTY_PREFIXES[prefix]!, value)) {
          return index;
        }
        continue;
      }

      if (prefix === "label") {
        if (LABEL_PROPERTIES.some((property) => propertyMatchesKeyword(field, property, value))) {
          return index;
        }
        continue;
      }
    }

    if (LOGIN_MATCH_PROPERTIES.some((property) => propertyMatchesKeyword(field, property, keyword))) {
      return index;
    }
  }

  return -1;
}

export function matchesAnyKeyword(field: AutofillField, keywords: readonly string[]): boolean {
  return matchKeywordIndex(field, keywords) !== -1;
}

/**
 * 字段的任一属性中是否包含给定片段。
 *
 * 匹配必须落在**词边界**上，不能是任意位置的子串。
 *
 * 反例说明为什么：词条 `l-name`（姓氏）去掉分隔符是 `lname`，而 `full-name`
 * 去掉分隔符是 `fullname`——后者恰好包含前者，于是"整名"字段会被判成"姓氏"。
 * 同理 `cc` 会命中 `cc-exp-month`、`cc-name` 等一切含 cc 的字段。
 *
 * 因此这里先把属性值切成词（按分隔符、驼峰、字母数字交界），记录每个词在
 * 拼接串中的起始位置，只有命中位置正好是某个词的开头才算数。
 */
export function attributesContain(field: AutofillField, needle: string): boolean {
  const target = stripSeparators(needle);
  if (target === "") {
    return false;
  }

  // 过短的词条（如 "cc"）作为子串会命中一切含它的字段——
  // "cc-exp"、"cc-month"、"cc-name" 全在开头就有 "cc"。因此短词条
  // 只在**整个归一化值就是它**时才命中（即字段名恰好叫 "cc"）。
  const requiresExactMatch = target.length < 3;

  return CONTAINS_MATCH_PROPERTIES.some((property) => {
    const value = readProperty(field, property);
    if (value == null) {
      return false;
    }

    const { normalized, boundaries } = tokenize(value);

    if (requiresExactMatch) {
      return normalized === target;
    }

    let index = normalized.indexOf(target);
    while (index !== -1) {
      if (boundaries.has(index)) {
        return true;
      }
      index = normalized.indexOf(target, index + 1);
    }
    return false;
  });
}

export function attributesContainAny(field: AutofillField, needles: readonly string[]): boolean {
  return needles.some((needle) => attributesContain(field, needle));
}

function stripSeparators(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * 切词并记录各词在拼接串中的起始位置。
 *
 * 同时处理三类分界：显式分隔符（`-` `_` 空格）、驼峰（`addressLine`）、
 * 字母与数字的交界（`line1`）——站点这三种写法都常见。
 */
function tokenize(value: string): { normalized: string; boundaries: Set<number> } {
  const parts = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part !== "")
    .map((part) => part.toLowerCase());

  const boundaries = new Set<number>();
  let offset = 0;
  for (const part of parts) {
    boundaries.add(offset);
    offset += part.length;
  }

  return { normalized: parts.join(""), boundaries };
}

/**
 * autocomplete 是否包含某个词元。
 *
 * 该属性可能是 `section-billing shipping cc-number` 这样的复合值，
 * 必须按空格拆开逐个比对，不能整体相等。
 */
export function autoCompleteIncludes(field: AutofillField, token: string): boolean {
  const raw = field.autoCompleteType;
  if (raw == null || raw === "") {
    return false;
  }
  return raw.trim().toLowerCase().split(/\s+/).includes(token.trim().toLowerCase());
}

export function autoCompleteIncludesAny(field: AutofillField, tokens: readonly string[]): boolean {
  return tokens.some((token) => autoCompleteIncludes(field, token));
}
