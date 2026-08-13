import { describe, expect, it } from "vitest";

import { parseCsv, parseCsvRecords, serializeCsv } from "./csv";

describe("parseCsv", () => {
  it("解析基本行列", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("引号内的逗号不分列", () => {
    expect(parseCsv('name,note\n"Smith, John",hi\n')).toEqual([
      ["name", "note"],
      ["Smith, John", "hi"],
    ]);
  });

  it("引号内的换行不分行", () => {
    // 自定义字段就是靠字段内换行编码的，这条必须成立。
    expect(parseCsv('a,b\n"line1\nline2",x\n')).toEqual([
      ["a", "b"],
      ["line1\nline2", "x"],
    ]);
  });

  it("双写引号表示字面引号", () => {
    expect(parseCsv('a\n"say ""hi"""\n')).toEqual([["a"], ['say "hi"']]);
  });

  it("兼容 CRLF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("末尾无换行也能收尾", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("结尾换行不产生空行", () => {
    expect(parseCsv("a\n1\n")).toEqual([["a"], ["1"]]);
  });

  it("剥离 UTF-8 BOM", () => {
    // 带 BOM 时首个表头会变成 "﻿name" 而匹配不上，Excel 导出的文件常有 BOM。
    expect(parseCsv("﻿name,value\nx,y\n")[0]).toEqual(["name", "value"]);
  });

  it("空字段保留为空串", () => {
    expect(parseCsv("a,b,c\n1,,3\n")[1]).toEqual(["1", "", "3"]);
  });
});

describe("parseCsvRecords", () => {
  it("按表头名称映射，不依赖列序", () => {
    const records = parseCsvRecords("name,login_password\nGitHub,secret\n");
    expect(records).toEqual([{ name: "GitHub", login_password: "secret" }]);
  });

  it("列序调换后仍正确映射", () => {
    const records = parseCsvRecords("login_password,name\nsecret,GitHub\n");
    expect(records[0]?.name).toBe("GitHub");
    expect(records[0]?.login_password).toBe("secret");
  });

  it("缺列时补空串而不是 undefined", () => {
    const records = parseCsvRecords("a,b,c\n1,2\n");
    expect(records[0]).toEqual({ a: "1", b: "2", c: "" });
  });

  it("跳过全空行", () => {
    expect(parseCsvRecords("a\n1\n\n2\n")).toHaveLength(2);
  });

  it("空输入得到空数组", () => {
    expect(parseCsvRecords("")).toEqual([]);
  });
});

describe("serializeCsv", () => {
  it("仅在必要时加引号", () => {
    const csv = serializeCsv(["a", "b"], [{ a: "plain", b: "has,comma" }]);
    expect(csv).toBe('a,b\nplain,"has,comma"\n');
  });

  it("转义引号与换行", () => {
    const csv = serializeCsv(["a"], [{ a: 'quote" and\nnewline' }]);
    expect(csv).toBe('a\n"quote"" and\nnewline"\n');
  });

  it("缺失的键输出空串", () => {
    expect(serializeCsv(["a", "b"], [{ a: "1" }])).toBe("a,b\n1,\n");
  });

  it("序列化后能原样解析回来", () => {
    const rows = [
      { name: "有,逗号", notes: '有"引号"', fields: "多\n行" },
      { name: "普通", notes: "", fields: "" },
    ];

    const parsed = parseCsvRecords(serializeCsv(["name", "notes", "fields"], rows));

    expect(parsed).toEqual(rows);
  });
});
